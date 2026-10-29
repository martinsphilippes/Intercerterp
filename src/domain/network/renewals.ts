import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import type { Ctx } from "@/lib/core/ctx";
import { notify } from "@/lib/core/notify";
import { addDays, diffDays, formatDate, today } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { CERT_OPEN_STATUSES } from "../accounting/common";
import { certificationSettings } from "../accounting/certificates";
import { allNodes, computeVisible, isPlatform, networkSettings, nodeOfCompany } from "./common";
import { certTypeKey, sameCertType } from "./sales";
import { CONTACT_CHANNELS, CONTACT_CHANNEL_LABEL, CONTACT_RESULTS, CONTACT_RESULT_LABEL } from "./renewal-options";

export { CONTACT_CHANNELS, CONTACT_CHANNEL_LABEL, CONTACT_RESULTS, CONTACT_RESULT_LABEL };

/**
 * Renovações por camada (§45).
 *
 * Fonte: os certificados conhecidos (`accounting_certificates`) das empresas que são nós da rede — os emitidos pelas
 * vendas dos parceiros e os da carteira dos escritórios-contadores (emitidos pela Tela 67 ou informados). Cada
 * certificado pertence ao nó da empresa em que está (o nó que vendeu, ou o contador).
 *
 * Situações (função pura `renewalSituation`): vence em 90/60/30/7 dias; vencido (até 30 dias após o vencimento — ainda
 * recuperável); perdido (mais de 30 dias vencido sem renovação); renovado (nova emissão do mesmo titular e tipo,
 * em qualquer canal da rede). Taxa de renovação do período = renovados ÷ certificados com vencimento no período.
 *
 * Alerta "ninguém agiu" (rotina diária `network.renewals`): certificado a ≤ N dias (parâmetro, padrão 7) do
 * vencimento — ou vencido há até 30 dias — sem contato registrado e sem renovação aberta avisa o responsável do nó E o
 * nível imediatamente acima; a 90/60/30 dias, aviso ao vendedor (ou ao responsável do cliente no contador).
 * Idempotente por certificado + vencimento + marco.
 */

export const RECOVERABLE_DAYS = 30;
export type RenewalSituation = "due_90" | "due_60" | "due_30" | "due_7" | "expired" | "lost" | "renewed" | "ok";

export const RENEWAL_SITUATIONS: Array<{ value: RenewalSituation; label: string; tone: "good" | "warn" | "bad" | "info" | "neutral" | "accent" }> = [
  { value: "due_90", label: "Vence em até 90 dias", tone: "info" },
  { value: "due_60", label: "Vence em até 60 dias", tone: "info" },
  { value: "due_30", label: "Vence em até 30 dias", tone: "warn" },
  { value: "due_7", label: "Vence em até 7 dias", tone: "accent" },
  { value: "expired", label: "Vencido (recuperável)", tone: "bad" },
  { value: "lost", label: "Perdido", tone: "neutral" },
  { value: "renewed", label: "Renovado", tone: "good" },
  { value: "ok", label: "Em dia (mais de 90 dias)", tone: "good" },
];
export const RENEWAL_SITUATION_LABEL: Record<string, string> = Object.fromEntries(RENEWAL_SITUATIONS.map((s) => [s.value, s.label]));

/** Situação de renovação (função pura). */
export function renewalSituation(daysLeft: number, renewed: boolean): RenewalSituation {
  if (renewed) return "renewed";
  if (daysLeft < -RECOVERABLE_DAYS) return "lost";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 7) return "due_7";
  if (daysLeft <= 30) return "due_30";
  if (daysLeft <= 60) return "due_60";
  if (daysLeft <= 90) return "due_90";
  return "ok";
}

/** Pendente = ainda pode ser renovado (a vencer em 90 dias ou vencido recuperável). */
export const isPending = (s: RenewalSituation) => s === "due_90" || s === "due_60" || s === "due_30" || s === "due_7" || s === "expired";

export interface RenewalRow {
  id: string;
  companyId: string;
  nodeId: string;
  nodeName: string;
  level: string;
  channel: "network" | "firm";
  sellerUserId: string | null;
  sellerName: string | null;
  holderName: string;
  holderDoc: string | null;
  productKey: string | null;
  productLabel: string;
  validTo: string;
  daysLeft: number;
  situation: RenewalSituation;
  renewedBy: { id: string; validTo: string; productLabel: string } | null;
  openRequest: { id: string; protocol: string; status: string } | null;
  lastContact: { date: string; channel: string; result: string; nextAction: string | null; userName: string | null } | null;
  contacts: number;
  /** cliente (cert_customers ou accounting_clients) para o botão Renovar */
  clientId: string;
  renewHref: string;
}

interface World {
  nodes: Doc[];
  rows: RenewalRow[];
}

/** Carrega os certificados da rede e calcula as situações (todas as empresas-nó, ou só uma). */
export async function renewalWorld(store: Store, ref = today(), onlyCompanyId?: string | null): Promise<World> {
  const base = unscoped(store);
  const nodes = await allNodes(store);
  const nodeByCompany = new Map(nodes.map((n) => [n.nodeCompanyId, n]));
  const settings = await certificationSettings(store);
  const certs = (await listAll(base, "accounting_certificates", onlyCompanyId ? { filters: [["eq", "companyId", onlyCompanyId]] } : {}, 100000)).filter((c) => nodeByCompany.has(c.companyId) && c.validTo);
  // para "renovado" a comparação é na rede toda (o titular pode renovar por outro canal)
  const holders = [...new Set(certs.map((c) => c.holderDoc).filter(Boolean))];
  const allSame = onlyCompanyId && holders.length ? await listAll(base, "accounting_certificates", { filters: [["eq", "holderDoc", holders]] }, 100000) : certs;
  const byHolder = new Map<string, Doc[]>();
  for (const c of allSame) if (c.holderDoc) byHolder.set(c.holderDoc, [...(byHolder.get(c.holderDoc) ?? []), c]);
  const reqs = holders.length ? await listAll(base, "certificate_requests", { filters: [["eq", "holderDoc", holders]] }, 100000) : [];
  const contacts = await listAll(base, "cert_renewal_contacts", onlyCompanyId ? { filters: [["eq", "companyId", onlyCompanyId]] } : {}, 100000);
  const contactsBy = new Map<string, Doc[]>();
  for (const k of contacts) contactsBy.set(k.certificateId, [...(contactsBy.get(k.certificateId) ?? []), k]);
  const users = new Map((await listAll(base, "users", {}, 100000)).map((u) => [u.id, u]));
  const firmClients = new Map<string, Doc>();
  for (const companyId of new Set(certs.filter((c) => c.channel !== "network").map((c) => c.companyId))) {
    for (const cl of await listAll(base, "accounting_clients", { filters: [["eq", "companyId", companyId]] }, 100000)) firmClients.set(cl.id, cl);
  }
  const typeOf = (c: Doc) => {
    const p = settings.catalog.find((x) => x.key === c.product);
    return certTypeKey(c.productType ?? p?.type, c.holderType ?? p?.holder, c.holderDoc);
  };
  const rows: RenewalRow[] = [];
  for (const c of certs) {
    const node = nodeByCompany.get(c.companyId)!;
    const validTo = String(c.validTo).slice(0, 10);
    const t = typeOf(c);
    const newer = (byHolder.get(c.holderDoc) ?? []).filter((o) => o.id !== c.id && o.validTo && String(o.validTo).slice(0, 10) > validTo && String(o.createdAt) >= String(c.createdAt) && sameCertType(t, typeOf(o)));
    newer.sort((a, b) => String(a.validTo).localeCompare(String(b.validTo)));
    const renewedBy = newer[0] ?? null;
    const daysLeft = diffDays(ref, validTo);
    const open = reqs.filter((r) => r.companyId === c.companyId && r.holderDoc === c.holderDoc && CERT_OPEN_STATUSES.includes(r.status) && (r.previousCertificateId === c.id || (sameCertType(t, certTypeKey(r.productType, r.holderType, r.holderDoc)) && String(r.createdAt) >= addDays(validTo, -120)))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
    const ks = (contactsBy.get(c.id) ?? []).sort((a, b) => String(b.contactDate).localeCompare(String(a.contactDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const isNetwork = c.channel === "network";
    const request = c.requestId ? reqs.find((r) => r.id === c.requestId) : null;
    const sellerUserId = c.sellerUserId ?? request?.sellerUserId ?? (isNetwork ? null : (firmClients.get(c.clientId)?.responsibleUserId ?? null));
    const clientId = c.customerId ?? c.clientId;
    rows.push({
      id: c.id, companyId: c.companyId, nodeId: node.id, nodeName: node.name, level: node.level, channel: isNetwork ? "network" : "firm",
      sellerUserId, sellerName: sellerUserId ? (users.get(sellerUserId)?.name ?? null) : null, holderName: c.holderName ?? "—", holderDoc: c.holderDoc ?? null, productKey: c.product ?? null, productLabel: c.productLabel ?? "Certificado digital",
      validTo, daysLeft, situation: renewalSituation(daysLeft, Boolean(renewedBy)), renewedBy: renewedBy ? { id: renewedBy.id, validTo: String(renewedBy.validTo).slice(0, 10), productLabel: renewedBy.productLabel } : null,
      openRequest: open ? { id: open.id, protocol: open.protocol, status: open.status } : null,
      lastContact: ks[0] ? { date: ks[0].contactDate, channel: ks[0].channel, result: ks[0].result, nextAction: ks[0].nextAction ?? null, userName: ks[0].userName ?? null } : null, contacts: ks.length,
      clientId,
      renewHref: isNetwork
        ? `/rede/vendas/nova?cliente=${encodeURIComponent(clientId)}&produto=${encodeURIComponent(c.product ?? "")}&anterior=${encodeURIComponent(c.id)}`
        : `/contabil/certificados/nova?cliente=${encodeURIComponent(clientId)}&kind=renewal&previous=${encodeURIComponent(c.id)}`,
    });
  }
  return { nodes, rows };
}

// ---------------------------------------------------------------------------------------------------------- visibilidade

export interface RenewalViewer {
  platform: boolean;
  myNode: Doc | null;
  visible: Set<string>;
  /** vendedor sem "ver tudo": só os certificados em que é o vendedor */
  onlySellerUserId: string | null;
  /** escritório: só os clientes da carteira visível (null = todos) */
  firmClientIds: Set<string> | null;
  canContact: boolean;
}

export async function renewalViewer(ctx: Ctx): Promise<RenewalViewer> {
  const platform = isPlatform(ctx);
  const nodes = await allNodes(ctx.store);
  const myNode = await nodeOfCompany(ctx.store, ctx.companyId);
  const company = await ctx.store.get("companies", ctx.companyId);
  const firm = company?.kind === "accounting";
  if (!platform) {
    if (!myNode) throw new BusinessError("Sua empresa não faz parte da rede de certificação.", "not_partner");
    if (firm ? !canDo(ctx.user, "accounting.certificates") : !canDo(ctx.user, "network.renewals") && !canDo(ctx.user, "network.sales_all")) throw new PermissionError();
  }
  let firmClientIds: Set<string> | null = null;
  if (firm && !platform) {
    const { visibleClientIds } = await import("../accounting/team");
    firmClientIds = await visibleClientIds(ctx);
  }
  const all = canDo(ctx.user, "network.sales_all");
  return {
    platform, myNode, visible: computeVisible(nodes, myNode?.id ?? null, platform),
    onlySellerUserId: !platform && !firm && !all ? ctx.user.id : null, firmClientIds,
    canContact: !platform ? (firm ? canDo(ctx.user, "accounting.certificates") : canDo(ctx.user, "network.renewals")) : true,
  };
}

export function rowVisible(v: RenewalViewer, r: RenewalRow): boolean {
  if (v.platform) return true;
  if (!v.visible.has(r.nodeId)) return false;
  if (r.nodeId === v.myNode?.id) {
    if (v.onlySellerUserId && r.sellerUserId !== v.onlySellerUserId) return false;
    if (v.firmClientIds && !v.firmClientIds.has(r.clientId)) return false;
    return true;
  }
  // descendentes: só quem vê todo o nó (o vendedor fica com as próprias)
  return !v.onlySellerUserId;
}

export interface RenewalFilter {
  level?: string | null;
  nodeId?: string | null;
  sellerUserId?: string | null;
  productKey?: string | null;
  situation?: string | null;
  from?: string | null;
  to?: string | null;
}

export function defaultPeriod(ref = today()) {
  return { from: addDays(ref, -RECOVERABLE_DAYS), to: addDays(ref, 90) };
}

export function filterRows(rows: RenewalRow[], nodes: Doc[], f: RenewalFilter, ref = today()): RenewalRow[] {
  const p = { ...defaultPeriod(ref), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) };
  const subtree = f.nodeId ? new Set(nodes.filter((n) => n.id === f.nodeId || (n.path ?? []).includes(f.nodeId!)).map((n) => n.id)) : null;
  return rows.filter((r) => {
    if (r.validTo < p.from || r.validTo > p.to) return false;
    if (f.level && r.level !== f.level) return false;
    if (subtree && !subtree.has(r.nodeId)) return false;
    if (f.sellerUserId && r.sellerUserId !== f.sellerUserId) return false;
    if (f.productKey && r.productKey !== f.productKey) return false;
    if (f.situation && (f.situation === "pending" ? !isPending(r.situation) : r.situation !== f.situation)) return false;
    return true;
  });
}

export interface RenewalTotals {
  total: number;
  renewed: number;
  pending: number;
  lost: number;
  /** renovados ÷ total (0..1); null sem certificados */
  rate: number | null;
  byIdle: number;
}

export function totalsOf(rows: RenewalRow[], idleDays = 7): RenewalTotals {
  const renewed = rows.filter((r) => r.situation === "renewed").length;
  return {
    total: rows.length, renewed, pending: rows.filter((r) => isPending(r.situation)).length, lost: rows.filter((r) => r.situation === "lost").length,
    rate: rows.length ? renewed / rows.length : null, byIdle: rows.filter((r) => idleCandidate(r, idleDays)).length,
  };
}

/** "Ninguém agiu": a ≤ N dias (ou vencido recuperável), sem contato registrado e sem renovação aberta. */
export function idleCandidate(r: RenewalRow, idleDays: number): boolean {
  if (!(r.situation === "due_7" || r.situation === "due_30" || r.situation === "expired")) return false;
  if (r.daysLeft > idleDays) return false;
  if (r.openRequest) return false;
  const since = addDays(r.validTo, -90);
  return !(r.lastContact && r.lastContact.date >= since);
}

export interface LayerNode {
  nodeId: string;
  name: string;
  level: string;
  /** certificados do próprio nó (sem os de baixo) */
  own: RenewalTotals;
  /** do nó + descendentes */
  all: RenewalTotals;
  children: LayerNode[];
  /** por vendedor (certificados do próprio nó) */
  sellers: Array<{ sellerUserId: string | null; sellerName: string; totals: RenewalTotals }>;
}

/** Visão por camada: a partir de um nó (ou da raiz da rede), totais do nó e dos descendentes, expandindo os filhos. */
export function layerTree(rows: RenewalRow[], nodes: Doc[], rootNodeId: string | null, visible: Set<string>, idleDays = 7): LayerNode[] {
  const build = (n: Doc): LayerNode => {
    const desc = new Set(nodes.filter((x) => x.id === n.id || (x.path ?? []).includes(n.id)).map((x) => x.id));
    const own = rows.filter((r) => r.nodeId === n.id);
    const bySeller = new Map<string, RenewalRow[]>();
    for (const r of own) bySeller.set(r.sellerUserId ?? "", [...(bySeller.get(r.sellerUserId ?? "") ?? []), r]);
    return {
      nodeId: n.id, name: n.name, level: n.level, own: totalsOf(own, idleDays), all: totalsOf(rows.filter((r) => desc.has(r.nodeId)), idleDays),
      children: nodes.filter((c) => c.parentNodeId === n.id && visible.has(c.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")).map(build),
      sellers: [...bySeller.entries()].map(([k, xs]) => ({ sellerUserId: k || null, sellerName: xs[0].sellerName ?? "Sem vendedor", totals: totalsOf(xs, idleDays) })).sort((a, b) => a.sellerName.localeCompare(b.sellerName, "pt-BR")),
    };
  };
  const roots = rootNodeId ? nodes.filter((n) => n.id === rootNodeId) : nodes.filter((n) => !n.parentNodeId && visible.has(n.id));
  return roots.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")).map(build);
}

/** Painel de renovações de quem olha. */
export async function renewalPanel(ctx: Ctx, f: RenewalFilter = {}, ref = today()) {
  const v = await renewalViewer(ctx);
  const w = await renewalWorld(ctx.store, ref);
  const { idleAlertDays } = await networkSettings(ctx.store);
  const visibleRows = w.rows.filter((r) => rowVisible(v, r));
  const rows = filterRows(visibleRows, w.nodes, f, ref).sort((a, b) => a.daysLeft - b.daysLeft || a.holderName.localeCompare(b.holderName, "pt-BR"));
  // a visão por camada usa o período e os filtros de produto/vendedor, mas não o filtro de situação (a taxa precisa do total)
  const layerRows = filterRows(visibleRows, w.nodes, { ...f, situation: null, level: null, nodeId: null }, ref);
  const layers = layerTree(layerRows, w.nodes, v.platform ? null : (v.myNode?.id ?? null), v.visible, idleAlertDays);
  return { viewer: v, rows, totals: totalsOf(filterRows(visibleRows, w.nodes, { ...f, situation: null }, ref), idleAlertDays), layers, nodes: w.nodes.filter((n) => v.visible.has(n.id)), idleAlertDays, period: { ...defaultPeriod(ref), ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}) } };
}

// -------------------------------------------------------------------------------------------------------------- contato


/** Registra um contato de renovação (mostra que o nó agiu) — só o nó dono do certificado. */
export async function registerRenewalContact(ctx: Ctx, certificateId: string, input: { contactDate?: string | null; channel: string; result: string; notes?: string | null; nextAction?: string | null; nextActionDate?: string | null }): Promise<Doc> {
  const v = await renewalViewer(ctx);
  if (!v.canContact) throw new PermissionError();
  const cert = await unscoped(ctx.store).get("accounting_certificates", certificateId);
  if (!cert || cert.companyId !== ctx.companyId) throw new BusinessError("Certificado não encontrado no seu nó (o contato é registrado por quem é responsável pelo certificado).", "not_found");
  const w = await renewalWorld(ctx.store, today(), ctx.companyId);
  const row = w.rows.find((r) => r.id === cert.id);
  if (!row || !rowVisible(v, row)) throw new BusinessError("Certificado não encontrado.", "not_found");
  const date = input.contactDate || today();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today(), "A data do contato não pode estar no futuro.");
  assert(CONTACT_CHANNELS.some((c) => c.value === input.channel), "Escolha o canal do contato.");
  assert(CONTACT_RESULTS.some((c) => c.value === input.result), "Escolha o resultado do contato.");
  const nextActionDate = input.nextActionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.nextActionDate) ? input.nextActionDate : null;
  const row2 = await unscoped(ctx.store).create("cert_renewal_contacts", {
    companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, certificateId: cert.id, nodeId: row.nodeId, contactDate: date, channel: input.channel, result: input.result,
    notes: input.notes?.trim()?.slice(0, 500) || null, nextAction: input.nextAction?.trim()?.slice(0, 200) || null, nextActionDate, userName: ctx.user.name,
  });
  await audit(ctx, { module: "admin", action: "network.renewal_contact", entityType: "accounting_certificate", entityId: cert.id, summary: `Contato de renovação com ${cert.holderName} (${CONTACT_CHANNEL_LABEL[input.channel]}): ${CONTACT_RESULT_LABEL[input.result]}${row2.nextAction ? ` · próxima ação: ${row2.nextAction}${nextActionDate ? ` em ${formatDate(nextActionDate)}` : ""}` : ""}`, after: { date, channel: input.channel, result: input.result } });
  return row2;
}

export async function renewalContacts(ctx: Ctx, certificateId: string): Promise<Doc[]> {
  const v = await renewalViewer(ctx);
  const cert = await unscoped(ctx.store).get("accounting_certificates", certificateId);
  if (!cert) return [];
  const w = await renewalWorld(ctx.store, today(), cert.companyId);
  const row = w.rows.find((r) => r.id === cert.id);
  if (!row || !rowVisible(v, row)) return [];
  return listAll(unscoped(ctx.store), "cert_renewal_contacts", { filters: [["eq", "certificateId", certificateId]], orderBy: [{ field: "contactDate", dir: "desc" }] });
}

// ---------------------------------------------------------------------------------------------------------------- rotina

/**
 * Rotina diária (por empresa-nó): avisos de 90/60/30 dias ao vendedor/contador responsável e o alerta "ninguém agiu"
 * ao responsável do nó e ao nível imediatamente acima. Idempotente por certificado + vencimento + marco + destinatário.
 */
export async function notifyRenewalAlerts(store: Store, companyId: string, ref = today()): Promise<{ alerts: number }> {
  const node = await nodeOfCompany(store, companyId);
  if (!node) return { alerts: 0 };
  const company = await unscoped(store).get("companies", companyId);
  const firm = company?.kind === "accounting";
  const { idleAlertDays } = await networkSettings(store);
  const w = await renewalWorld(store, ref, companyId);
  const parent = node.parentNodeId ? w.nodes.find((n) => n.id === node.parentNodeId) : null;
  const base = unscoped(store);
  let alerts = 0;
  const link = (r: RenewalRow) => `/rede/renovacoes?cert=${r.id}`;
  for (const r of w.rows) {
    if (r.situation === "renewed" || r.situation === "lost" || r.situation === "ok") continue;
    // marcos ao vendedor/contador responsável
    const band = r.daysLeft > 60 ? "90" : r.daysLeft > 30 ? "60" : r.daysLeft > idleAlertDays ? "30" : null;
    if (band && !r.openRequest) {
      alerts += await notify(base, {
        companyId, type: "deadline", priority: band === "30" ? "high" : "normal", title: `Renovação: certificado de ${r.holderName} vence em ${r.daysLeft} dia(s)`,
        body: `${r.productLabel} · validade ${formatDate(r.validTo)}. Entre em contato e abra a renovação (marco de ${band} dias).`, link: link(r),
        originType: "accounting_certificate", originId: r.id, occurrenceKey: `renewal:${r.id}:${r.validTo}:${band}`,
        audience: r.sellerUserId ? { userIds: [r.sellerUserId] } : firm ? { action: "accounting.certificates" } : { action: "network.renewals" },
      }).catch(() => 0);
    }
    if (!idleCandidate(r, idleAlertDays)) continue;
    const when = r.daysLeft < 0 ? `venceu há ${-r.daysLeft} dia(s)` : `vence em ${r.daysLeft} dia(s)`;
    alerts += await notify(base, {
      companyId, type: "deadline", priority: "high", title: `Ninguém agiu: certificado de ${r.holderName} ${when}`,
      body: `${r.productLabel} · validade ${formatDate(r.validTo)}. Sem contato registrado nem renovação aberta${r.sellerName ? ` (vendedor ${r.sellerName})` : ""}.`, link: link(r),
      originType: "accounting_certificate", originId: r.id, occurrenceKey: `renewal-idle:${r.id}:${r.validTo}:node`,
      audience: firm ? { action: "accounting.all_clients" } : { action: "network.sales_all" },
    }).catch(() => 0);
    if (parent) {
      alerts += await notify(base, {
        companyId: parent.nodeCompanyId, type: "deadline", priority: "high", title: `Ninguém agiu em ${node.name}: certificado de ${r.holderName} ${when}`,
        body: `${r.productLabel} · validade ${formatDate(r.validTo)}. ${node.name} não registrou contato nem abriu a renovação.`, link: `/rede/renovacoes?no=${node.id}`,
        originType: "accounting_certificate", originId: r.id, occurrenceKey: `renewal-idle:${r.id}:${r.validTo}:parent`,
        audience: { action: "network.sales_all" },
      }).catch(() => 0);
    }
  }
  return { alerts };
}
