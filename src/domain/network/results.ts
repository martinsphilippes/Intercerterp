import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, PermissionError } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { monthEnd, monthStart, today } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { networkSettings, networkViewer, nodeOfCompany, type Viewer } from "./common";
import { flowKey, maskPlan, nextClosingDay, type Party, type SalePlan } from "./billing-plan";
import { agreementHistory, canBillChild, effectiveAgreement, walletIdOf, walletMoves, walletRecharges, type AgreementView } from "./billing";
import { closingEntries, getClosing, relationClosings, relationPreview, relationTerms, saleEntries, saleFinance, type ClosingPreview } from "./ledger";
import { saleCascade } from "./sales";

/**
 * Leitura do financeiro em camadas (§46): DRE por camada (linhas da carteira pré-paga), "Resultado da rede" por nó e
 * produto, financeiro de uma relação pai→filho (modalidade, carteira, prévia e fechamentos) e o detalhe do fechamento.
 *
 * Visibilidade (§45): a plataforma vê tudo (inclusive o custo AC e a receita da Intercert); um nó vê o próprio
 * resultado e o dos parceiros abaixo — nunca o resultado do pai nem custos acima dele.
 */

// ------------------------------------------------------------------------------------------------------ DRE da empresa

export interface NetworkDreItem {
  group: string;
  lineKey: string;
  label: string;
  date: string;
  amount: number;
}

/**
 * Itens da rede para o DRE da empresa que não passam por título: os DÉBITOS da carteira pré-paga (custo para quem
 * vende, receita para quem está acima), na data de cada venda paga — e os estornos, com o sinal inverso. A recarga é
 * adiantamento (fora do resultado), então não há dupla contagem.
 */
export async function networkDreItems(store: Store, companyId: string, from: string, to: string): Promise<NetworkDreItem[]> {
  const base = unscoped(store);
  const settings = await networkSettings(store);
  const isPlat = settings.platformCompanyId === companyId;
  if (!isPlat && !(await nodeOfCompany(store, companyId))) return [];
  const out: NetworkDreItem[] = [];
  const inRange = (e: Doc) => e.settlement === "wallet" && String(e.date) >= from && String(e.date) <= to;
  for (const e of (await listAll(base, "cert_fin_entries", { filters: [["eq", "payerCompanyId", companyId], ["eq", "settlement", "wallet"]] })).filter(inRange)) {
    out.push({ group: "Custo dos serviços", lineKey: "__network_prepaid_cost", label: "Custo de certificados — débitos de créditos pré-pagos", date: e.date, amount: -Number(e.amount) });
  }
  for (const e of (await listAll(base, "cert_fin_entries", { filters: [["eq", "payeeCompanyId", companyId], ["eq", "settlement", "wallet"]] })).filter(inRange)) {
    out.push({ group: "Receita bruta", lineKey: "__network_prepaid_revenue", label: "Vendas aos parceiros abaixo — consumo de créditos pré-pagos", date: e.date, amount: Number(e.amount) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- resultado da rede

export interface LayerRow {
  key: string; // nodeId ou "platform"
  name: string;
  level: string;
  depth: number;
  sales: number;
  /** recebido do cliente final (quando cobra) */
  clientRevenue: number;
  /** recebido dos parceiros abaixo (custo deles) */
  belowRevenue: number;
  commissionIn: number;
  /** pago ao nível acima (custo) */
  costUp: number;
  commissionOut: number;
  acCost: number;
  revenue: number;
  cost: number;
  margin: number;
}

export interface ProductRow {
  productKey: string;
  productLabel: string;
  sales: number;
  clientPaid: number;
  /** custo do nível acima do nó raiz da visão (plataforma: custo AC) */
  rootCost: number | null;
  margins: Record<string, number>;
}

export interface NetworkResult {
  from: string;
  to: string;
  platform: boolean;
  rootNodeId: string | null;
  rows: LayerRow[];
  products: ProductRow[];
  totals: { sales: number; clientPaid: number; acCost: number | null; sumMargins: number; difference: number | null };
  reversed: number;
}

const emptyRow = (key: string, name: string, level: string, depth: number): LayerRow => ({ key, name, level, depth, sales: 0, clientRevenue: 0, belowRevenue: 0, commissionIn: 0, costUp: 0, commissionOut: 0, acCost: 0, revenue: 0, cost: 0, margin: 0 });

/** Quem consulta o financeiro da rede (plataforma, ou nó com a operação de consulta/financeiro). */
function assertFinanceReader(ctx: Ctx, v: Viewer) {
  if (v.platform) return;
  if (!v.myNode) throw new BusinessError("Sua empresa não é um parceiro da rede de certificação.", "not_partner");
  if (!canDo(ctx.user, "network.finance_view") && !canDo(ctx.user, "network.billing") && !can(ctx.user, "finance", "view")) throw new PermissionError();
}

/**
 * Resultado da rede no período (data do pagamento): por camada (vendas, receita, custo, margem) e por produto. Fonte:
 * o plano de liquidação de cada venda paga (estornadas ficam fora). Um nó vê só ele e os parceiros abaixo.
 */
export async function networkResult(ctx: Ctx, f: { from?: string | null; to?: string | null; nodeId?: string | null } = {}): Promise<NetworkResult> {
  const v = await networkViewer(ctx);
  assertFinanceReader(ctx, v);
  const from = f.from || monthStart(today());
  const to = f.to || monthEnd(today());
  let root = v.platform ? null : v.myNode!.id;
  if (f.nodeId && (v.platform || v.visible.has(f.nodeId))) root = f.nodeId;
  const scope = root ? new Set(v.nodes.filter((n) => n.id === root || (n.path ?? []).includes(root!)).map((n) => n.id)) : null;
  const showPlatform = v.platform && !root;
  const base = unscoped(ctx.store);
  const fins = (await listAll(base, "cert_sale_finance", { filters: [["between", "paidDate", from, to]] })).filter((x) => x.status === "paid" || x.status === "reversed");
  const rows = new Map<string, LayerRow>();
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const rowOf = (key: string) => {
    let r = rows.get(key);
    if (!r) {
      const n = key === "platform" ? null : byId.get(key);
      r = emptyRow(key, n?.name ?? (key === "platform" ? "Intercert (plataforma)" : "—"), n?.level ?? "platform", n ? Number(n.depth ?? 0) + 1 : 0);
      rows.set(key, r);
    }
    return r;
  };
  const inScope = (p: Party) => (p.type === "platform" ? showPlatform : p.type === "node" ? (scope ? scope.has(p.nodeId!) : true) : false);
  const products = new Map<string, ProductRow>();
  let clientPaid = 0;
  let acTotal = 0;
  let sales = 0;
  let reversed = 0;
  for (const fin of fins) {
    if (fin.status === "reversed") {
      reversed++;
      continue;
    }
    const plan = fin.plan as SalePlan;
    const path: string[] = fin.pathNodeIds ?? [];
    if (scope && !path.some((id) => scope.has(id)) && !(fin.referrerNodeId && scope.has(fin.referrerNodeId))) continue;
    const snap = { levels: path.map((id) => ({ nodeId: id, name: byId.get(id)?.name ?? "—", level: byId.get(id)?.level ?? "", cost: 0 })) };
    const seen = maskPlan(plan, snap, { platform: v.platform && !root, myNodeId: root });
    const flows = v.platform && !root ? plan.flows : seen.flows;
    sales++;
    if (inScope({ type: "node", nodeId: fin.sellerNodeId, name: "" })) rowOf(fin.sellerNodeId).sales++;
    const prod: ProductRow = products.get(fin.productKey) ?? { productKey: fin.productKey, productLabel: fin.productLabel, sales: 0, clientPaid: 0, rootCost: 0, margins: {} };
    prod.sales++;
    for (const fl of flows) {
      if (fl.settlement === "covered" && fl.kind !== "cost") continue;
      if (fl.kind === "client") {
        clientPaid += fl.amount;
        prod.clientPaid += fl.amount;
      }
      if (fl.kind === "ac_cost") {
        acTotal += fl.amount;
        if (showPlatform) prod.rootCost = (prod.rootCost ?? 0) + fl.amount;
      }
      // custo pago pelo nó raiz ao nível acima (o nó vê o próprio custo)
      if (root && fl.kind === "cost" && fl.payer.nodeId === root) prod.rootCost = (prod.rootCost ?? 0) + fl.amount;
      if (inScope(fl.payer)) {
        const r = rowOf(fl.payer.type === "platform" ? "platform" : fl.payer.nodeId!);
        if (fl.kind === "cost") r.costUp += fl.amount;
        else if (fl.kind === "commission" || fl.kind === "referral") r.commissionOut += fl.amount;
        else if (fl.kind === "ac_cost") r.acCost += fl.amount;
      }
      if (inScope(fl.payee)) {
        const r = rowOf(fl.payee.type === "platform" ? "platform" : fl.payee.nodeId!);
        if (fl.kind === "client") r.clientRevenue += fl.amount;
        else if (fl.kind === "cost") r.belowRevenue += fl.amount;
        else r.commissionIn += fl.amount;
      }
    }
    for (const [k, val] of Object.entries(v.platform && !root ? plan.earnings : seen.earnings)) {
      if (k === "platform" ? !showPlatform : scope ? !scope.has(k) : false) continue;
      prod.margins[k] = (prod.margins[k] ?? 0) + val;
    }
    products.set(fin.productKey, prod);
  }
  for (const r of rows.values()) {
    r.revenue = r.clientRevenue + r.belowRevenue + r.commissionIn;
    r.cost = r.costUp + r.commissionOut + r.acCost;
    r.margin = r.revenue - r.cost;
  }
  const list = [...rows.values()].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name, "pt-BR"));
  const sumMargins = list.reduce((a, r) => a + r.margin, 0);
  return {
    from, to, platform: v.platform, rootNodeId: root, rows: list, products: [...products.values()].sort((a, b) => b.clientPaid - a.clientPaid),
    totals: { sales, clientPaid, acCost: showPlatform ? acTotal : null, sumMargins, difference: showPlatform ? clientPaid - sumMargins - acTotal : null },
    reversed,
  };
}

// ---------------------------------------------------------------------------------------- financeiro de uma relação

export interface RelationFinance {
  child: Doc;
  parentName: string;
  agreement: AgreementView;
  history: Doc[];
  wallet: Doc | null;
  moves: Doc[];
  recharges: Doc[];
  previews: Array<ClosingPreview & { label: string; direction: "child_pays" | "parent_pays"; nextClosing: string | null }>;
  closings: Doc[];
  canBill: boolean;
  canRecharge: boolean;
  /** quem olha é o próprio filho */
  asChild: boolean;
}

/**
 * Financeiro da relação do nó `childNodeId` com o pai: para o pai (e níveis acima, em consulta), a plataforma e o
 * próprio filho ("Meu financeiro com o nível acima").
 */
export async function relationFinance(ctx: Ctx, childNodeId: string): Promise<RelationFinance> {
  const v = await networkViewer(ctx);
  const child = v.nodes.find((n) => n.id === childNodeId);
  if (!child || (!v.platform && !v.visible.has(child.id))) throw new BusinessError("Parceiro não encontrado.", "not_found");
  const asChild = v.myNode?.id === child.id;
  if (!v.platform && !canDo(ctx.user, "network.finance_view") && !canDo(ctx.user, "network.billing") && !(asChild && can(ctx.user, "finance", "view"))) throw new PermissionError();
  const parent = child.parentNodeId ? v.nodes.find((n) => n.id === child.parentNodeId) ?? null : null;
  const parentName = parent?.name ?? "Intercert (plataforma)";
  const [agreement, history] = await Promise.all([effectiveAgreement(ctx.store, child.id), agreementHistory(ctx.store, child.id)]);
  const wid = walletIdOf(child.id, child.parentNodeId ?? null);
  const wallet = await unscoped(ctx.store).get("cert_wallets", wid);
  const [moves, recharges] = wallet ? await Promise.all([walletMoves(ctx.store, wid), walletRecharges(ctx.store, wid)]) : [[], []];
  const childParty: Party = { type: "node", nodeId: child.id, name: child.name };
  const parentParty: Party = parent ? { type: "node", nodeId: parent.id, name: parent.name } : { type: "platform", nodeId: null, name: "Intercert (plataforma)" };
  const keys = [
    { key: flowKey("cost", childParty, parentParty), label: `Custo devido por ${child.name} a ${parentName}`, direction: "child_pays" as const },
    { key: flowKey("commission", parentParty, childParty), label: `Comissão devida por ${parentName} a ${child.name}`, direction: "parent_pays" as const },
  ];
  const previews = [];
  for (const k of keys) {
    const p = await relationPreview(ctx.store, k.key);
    const terms = await relationTerms(ctx.store, child.id, k.direction === "child_pays" ? "cost" : "commission");
    previews.push({ ...p, label: k.label, direction: k.direction, nextClosing: nextClosingDay(terms, today()) });
  }
  const canBill = await canBillChild(ctx, child);
  return {
    child, parentName, agreement, history, wallet, moves, recharges, previews, closings: await relationClosings(ctx.store, keys.map((k) => k.key)), canBill,
    canRecharge: canBill || (asChild && canDo(ctx.user, "network.billing")), asChild,
  };
}

/** Fechamento visível a quem olha? (plataforma; nó parte do fechamento; ou as duas pontas abaixo do nó). */
export async function readClosing(ctx: Ctx, id: string): Promise<{ closing: Doc; entries: Doc[]; mineCompanyId: string | null }> {
  const v = await networkViewer(ctx);
  const c = await getClosing(ctx.store, id);
  if (!c) throw new BusinessError("Fechamento não encontrado.", "not_found");
  const party = (nodeId: string | null) => Boolean(nodeId && v.myNode && nodeId === v.myNode.id);
  const below = (type: string, nodeId: string | null) => type === "node" && nodeId != null && v.visible.has(nodeId);
  const ok = v.platform || party(c.payerNodeId) || party(c.payeeNodeId) || (below(c.payerType, c.payerNodeId) && below(c.payeeType, c.payeeNodeId) && v.myNode?.id !== undefined);
  if (!ok || (!v.platform && !canDo(ctx.user, "network.finance_view") && !canDo(ctx.user, "network.billing") && !can(ctx.user, "finance", "view"))) throw new BusinessError("Fechamento não encontrado.", "not_found");
  return { closing: c, entries: await closingEntries(ctx.store, c), mineCompanyId: c.payableCompanyId === ctx.companyId || c.receivableCompanyId === ctx.companyId ? ctx.companyId : null };
}

/** Fechamentos em que a empresa (ou a plataforma) é parte — lista da tela de financeiro da rede. */
export async function listClosings(ctx: Ctx): Promise<Doc[]> {
  const v = await networkViewer(ctx);
  assertFinanceReader(ctx, v);
  const all = await listAll(unscoped(ctx.store), "cert_closings", { orderBy: [{ field: "createdAt", dir: "desc" }] }, 5000);
  if (v.platform) return all;
  const me = v.myNode!.id;
  return all.filter((c) => c.payerNodeId === me || c.payeeNodeId === me || (c.payerType === "node" && c.payeeType === "node" && v.visible.has(c.payerNodeId) && v.visible.has(c.payeeNodeId)));
}

/** Lançamentos e plano de uma venda, mascarados para quem olha (tela da venda). */
export async function saleFinanceView(ctx: Ctx, requestId: string): Promise<{ plan: ReturnType<typeof maskPlan> | null; status: string | null; issues: string[]; entries: Doc[]; collectorName: string | null; referrerName: string | null } | null> {
  const fin = await saleFinance(ctx.store, requestId);
  if (!fin) return null;
  const v = await networkViewer(ctx);
  const snap = await saleCascade(ctx.store, requestId);
  const levels = snap?.levels ?? (fin.pathNodeIds ?? []).map((id: string) => ({ nodeId: id, name: "", level: "", cost: 0 }));
  const masked = maskPlan(fin.plan as SalePlan, { levels }, { platform: v.platform, myNodeId: v.myNode?.id ?? null });
  const keys = new Set(masked.flows.map((f) => f.key));
  const entries = (await saleEntries(ctx.store, requestId)).filter((e) => keys.has(e.flowKey));
  const collector = fin.collectorNodeId ? v.nodes.find((n) => n.id === fin.collectorNodeId) : null;
  const collectorVisible = v.platform || !fin.collectorNodeId || v.visible.has(fin.collectorNodeId) || fin.collectorNodeId === v.myNode?.parentNodeId;
  return { plan: masked, status: fin.status, issues: v.platform ? fin.issues ?? [] : [], entries, collectorName: collectorVisible ? (collector?.name ?? "Intercert (plataforma)") : "Parceiro acima na rede", referrerName: fin.referrerName ?? null };
}

/**
 * "Fechar período agora" (prévia → confirmar): fecha até hoje uma das relações do filho com o pai. Quem fecha: o pai
 * (network.billing) ou a plataforma.
 */
export async function closeRelationNow(ctx: Ctx, childNodeId: string, relationKey: string): Promise<{ closing: Doc | null; carried: number | null }> {
  const v = await networkViewer(ctx);
  const child = v.nodes.find((n) => n.id === childNodeId);
  if (!child || (!v.platform && !v.visible.has(child.id))) throw new BusinessError("Parceiro não encontrado.", "not_found");
  if (!(await canBillChild(ctx, child))) throw new PermissionError("Somente o parceiro de cima (operação de financeiro da rede) ou a plataforma fecha o período.");
  const parent = child.parentNodeId ? v.nodes.find((n) => n.id === child.parentNodeId) : null;
  const cp: Party = { type: "node", nodeId: child.id, name: child.name };
  const pp: Party = parent ? { type: "node", nodeId: parent.id, name: parent.name } : { type: "platform", nodeId: null, name: "" };
  if (![flowKey("cost", cp, pp), flowKey("commission", pp, cp)].includes(relationKey)) throw new BusinessError("Relação inválida para este parceiro.", "relation");
  const { closeRelation } = await import("./ledger");
  return closeRelation(ctx, relationKey, today(), { manual: true });
}
