import { findOne, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { notify } from "@/lib/core/notify";
import { nextNumber } from "@/lib/core/numbering";
import { readFile, saveFile } from "@/lib/core/files";
import { getSetting, setSetting } from "@/lib/core/settings";
import { diffDays, formatDate, formatDateTime, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { getClient } from "./clients";
import { CERT_KIND_LABEL, CERT_OPEN_STATUSES, CERT_STATUS_LABEL, CHARGE_CHANNEL_LABEL, requireFirm, VALIDATION_MODE_LABEL, type CertStatus } from "./common";
import { visibleClientIds } from "./team";

/**
 * Certificados digitais dos clientes do escritório (Tela 67 do Portal do Contador).
 *
 * Três atores, três lados:
 *  - ESCRITÓRIO (operação "accounting.certificates"): abre a solicitação, envia/reenvia a cobrança, pede a emissão,
 *    registra a autorização do titular quando o cliente não usa o ERP e baixa o certificado autorizado.
 *  - EQUIPE DE CERTIFICAÇÃO INTERCERT (operação "certification.operate"; administradores da plataforma): confirma o
 *    pagamento com a referência, agenda/aprova a validação do titular (ICP-Brasil), registra a emissão (arquivo .pfx)
 *    ou a falha e mantém o catálogo e as instruções de pagamento.
 *  - TITULAR (empresa vinculada no ERP, operação "admin.integrations"): autoriza o escritório a acompanhar seus
 *    certificados e, por solicitação, a baixar o arquivo. Permissão independente do vínculo fiscal.
 *
 * Nada aqui é simulado: cada etapa é uma ação real de quem responde por ela, com autor, momento e referência no
 * histórico do protocolo (auditoria da empresa do escritório). A cobrança é da Intercert, separada da mensalidade do
 * ERP; o link de pagamento automático depende da credencial da plataforma (ver docs/pendencias-externas.md) — até lá,
 * as instruções de pagamento vão na mensagem e a confirmação é feita pela equipe com a referência da transação.
 */

export const PLATFORM_SCOPE = "platform";
export const CERT_DUE_SOON_DAYS = 30;

export { CERT_PRODUCT_TYPES, CERT_HOLDERS, CERT_SUPPLIERS } from "./cert-catalog";
import { CERT_PRODUCT_TYPES, CERT_HOLDERS, CERT_SUPPLIERS } from "./cert-catalog";

export interface CertProduct {
  key: string;
  label: string;
  months: number;
  /** centavos — preço da cobrança da Intercert ao escritório (Tela 67) */
  price: number;
  active: boolean;
  // rede de certificação (§43) — campos opcionais (catálogos salvos antes continuam válidos)
  /** centavos — custo pago pela Intercert à AC de 1º nível (base do preço em cascata e da DRE) */
  acCost?: number | null;
  type?: "a1" | "a3" | "birdid" | "outro" | null;
  holder?: "pf" | "pj" | null;
  supplier?: "soluti" | "serpro" | null;
  /** padrão "a rede pode alterar o preço de venda" (false = preço fixo, como o BirdID) */
  editable?: boolean | null;
  /**
   * §45: produto GRATUITO (preço R$ 0, sem cobrança — vai direto à validação). Uso: BirdID gratuito com validade longa
   * (o titular passa a ter BirdID e depois renova sem nova videoconferência). Só pela venda gratuita da rede.
   */
  free?: boolean | null;
}

/** Catálogo padrão (vale só enquanto nenhum catálogo foi salvo): produtos parecidos com os do InterSuite. */
export const DEFAULT_CERT_CATALOG: CertProduct[] = [
  { key: "ecnpj_a1_12m", label: "e-CNPJ A1 · 12 meses", months: 12, price: 19900, active: true, acCost: 9000, type: "a1", holder: "pj", supplier: "soluti", editable: true },
  { key: "ecnpj_a3_36m", label: "e-CNPJ A3 · 36 meses", months: 36, price: 33000, active: true, acCost: 15000, type: "a3", holder: "pj", supplier: "soluti", editable: true },
  { key: "ecpf_a1_12m", label: "e-CPF A1 · 12 meses", months: 12, price: 15000, active: true, acCost: 6000, type: "a1", holder: "pf", supplier: "soluti", editable: true },
  { key: "ecpf_a3_36m", label: "e-CPF A3 · 36 meses", months: 36, price: 25000, active: true, acCost: 11000, type: "a3", holder: "pf", supplier: "serpro", editable: true },
  { key: "birdid_12m", label: "BirdID (nuvem) · 12 meses", months: 12, price: 9900, active: true, acCost: 4000, type: "birdid", holder: "pf", supplier: "soluti", editable: false },
  // §45: BirdID gratuito (R$ 0, validade de 5 anos) — só pela venda gratuita da rede, um ativo por CPF
  { key: "birdid_free_60m", label: "BirdID gratuito · 5 anos", months: 60, price: 0, active: true, acCost: 0, type: "birdid", holder: "pf", supplier: "soluti", editable: false, free: true },
];

export interface CertificationSettings {
  catalog: CertProduct[];
  /** instruções de pagamento incluídas na cobrança (chave Pix, dados bancários, prazo) */
  paymentInstructions: string;
  /** base do link de pagamento (ex.: https://pagamento.intercert.com.br) — o protocolo é acrescentado ao final */
  paymentUrlBase: string | null;
}

const DEFAULT_SETTINGS: CertificationSettings = { catalog: DEFAULT_CERT_CATALOG, paymentInstructions: "", paymentUrlBase: process.env.CERT_PAYMENT_URL_BASE?.trim() || null };

/** Parâmetros da certificação (plataforma, não por empresa): catálogo, instruções e link de pagamento. */
export async function certificationSettings(store: Store): Promise<CertificationSettings> {
  const saved = await getSetting<Partial<CertificationSettings> | null>(unscoped(store), PLATFORM_SCOPE, null, "certification", null);
  const catalog = Array.isArray(saved?.catalog) && saved!.catalog.length ? saved!.catalog : DEFAULT_CERT_CATALOG;
  return { catalog, paymentInstructions: saved?.paymentInstructions ?? DEFAULT_SETTINGS.paymentInstructions, paymentUrlBase: saved?.paymentUrlBase ?? DEFAULT_SETTINGS.paymentUrlBase };
}

export async function saveCertificationSettings(ctx: Ctx, input: Partial<CertificationSettings>): Promise<CertificationSettings> {
  // equipe de certificação ou plataforma da rede (o catálogo guarda o custo AC da rede de certificação — §43)
  if (!canDo(ctx.user, "certification.operate")) requireAction(ctx, "network.manage");
  const before = await certificationSettings(ctx.store);
  const prevByKey = new Map(before.catalog.map((p) => [p.key, p]));
  const pick = <T extends string>(v: unknown, allowed: readonly { value: T }[]): T | null => (allowed.some((a) => a.value === v) ? (v as T) : null);
  const catalog = (input.catalog ?? before.catalog).map((p) => {
    const key = String(p.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    // campos da rede ausentes no envio (formulário antigo) mantêm o valor salvo do mesmo produto
    const prev: Partial<CertProduct> = prevByKey.get(key) ?? {};
    const has = (f: keyof CertProduct) => Object.prototype.hasOwnProperty.call(p, f);
    const acRaw = has("acCost") ? p.acCost : prev.acCost;
    return {
      key,
      label: String(p.label ?? "").trim(),
      months: Math.max(1, Math.round(Number(p.months) || 12)),
      price: Math.max(0, Math.round(Number(p.price) || 0)),
      active: p.active !== false,
      acCost: acRaw == null || (acRaw as unknown) === "" ? null : Math.max(0, Math.round(Number(acRaw) || 0)),
      type: pick(has("type") ? p.type : prev.type, CERT_PRODUCT_TYPES),
      holder: pick(has("holder") ? p.holder : prev.holder, CERT_HOLDERS),
      supplier: pick(has("supplier") ? p.supplier : prev.supplier, CERT_SUPPLIERS),
      editable: (has("editable") ? p.editable : prev.editable) !== false,
      free: (has("free") ? p.free : prev.free) === true,
    };
  });
  assert(catalog.length > 0, "Informe ao menos um produto no catálogo.");
  for (const p of catalog) {
    assert(p.key, "Produto sem identificador.");
    assert(p.label, `Produto ${p.key} sem descrição.`);
    if (p.free) assert(p.price === 0 && !p.acCost, `Produto ${p.label}: produto gratuito tem preço e custo AC zerados.`);
    else assert(p.price > 0, `Produto ${p.label}: informe o valor.`);
    assert(p.acCost == null || p.acCost <= p.price, `Produto ${p.label}: o custo pago à AC não pode passar do preço de venda.`);
  }
  assert(new Set(catalog.map((p) => p.key)).size === catalog.length, "Identificadores de produto repetidos.");
  assert(catalog.some((p) => p.active), "Mantenha ao menos um produto ativo.");
  const urlBase = (input.paymentUrlBase ?? before.paymentUrlBase ?? "")?.trim() || null;
  assert(!urlBase || /^https:\/\/[^\s]+$/.test(urlBase), "O link de pagamento precisa começar com https://");
  const value: CertificationSettings = { catalog, paymentInstructions: String(input.paymentInstructions ?? before.paymentInstructions ?? "").trim().slice(0, 1000), paymentUrlBase: urlBase };
  await setSetting(unscoped(ctx.store), PLATFORM_SCOPE, null, "certification", value, ctx.user.id);
  await audit(ctx, { module: "admin", action: "certification.settings", entityType: "setting", entityId: "certification", summary: `Parâmetros da certificação digital alterados (${catalog.length} produto(s))`, before, after: value });
  return value;
}

export function productByKey(settings: CertificationSettings, key: string): CertProduct | null {
  return settings.catalog.find((p) => p.key === key) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Autorização de acompanhamento (titular no ERP)

/** A empresa vinculada autorizou o escritório a acompanhar e solicitar seus certificados digitais? */
export async function certificateTrackingAuthorized(store: Store, companyId: string): Promise<boolean> {
  const { getIntegration } = await import("../integrations");
  const integ = await getIntegration(unscoped(store), companyId, null, "accounting");
  return integ?.config?.certificatesTracking === true;
}

/** Empresa (titular): liga/desliga a autorização de acompanhamento de certificados pelo escritório vinculado. */
export async function setCertificateTracking(ctx: Ctx, allowed: boolean): Promise<void> {
  requireAction(ctx, "admin.integrations");
  requirePerm(ctx, "admin", "edit");
  const { companyAccountingLink } = await import("./link");
  const link = await companyAccountingLink(ctx.store, ctx.companyId);
  if (!link) throw new BusinessError("A empresa não está vinculada a um escritório contábil.", "not_linked");
  const { getIntegration } = await import("../integrations");
  const integ = await getIntegration(ctx.store, ctx.companyId, null, "accounting");
  if (!integ) throw new BusinessError("Integração da contabilidade não encontrada.", "not_linked");
  const before = integ.config?.certificatesTracking === true;
  if (before === allowed) return;
  await ctx.store.update("integrations", integ.id, { config: { ...(integ.config ?? {}), certificatesTracking: allowed, certificatesTrackingAt: nowIso() } });
  await audit(ctx, {
    module: "admin", action: allowed ? "certificates.tracking_granted" : "certificates.tracking_revoked", entityType: "integration", entityId: "accounting",
    summary: allowed ? `Escritório ${link.firm.tradeName || link.firm.name} autorizado a acompanhar e solicitar certificados digitais` : `Autorização de acompanhamento de certificados retirada do escritório ${link.firm.tradeName || link.firm.name}`,
    before: { certificatesTracking: before }, after: { certificatesTracking: allowed },
  });
  // o escritório fica sabendo pela central de notificações e pelo histórico do cliente
  const base = unscoped(ctx.store);
  await base.create("audit_logs", {
    companyId: link.firm.id, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: "Empresa vinculada", module: "accounting",
    action: allowed ? "certificates.tracking_granted" : "certificates.tracking_revoked", entityType: "accounting_client", entityId: link.client.id,
    summary: allowed ? `${link.client.name} autorizou o acompanhamento de certificados digitais` : `${link.client.name} retirou a autorização de acompanhamento de certificados digitais`,
    before: null, after: { certificatesTracking: allowed }, reason: null, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [],
  }).catch(() => undefined);
  await notify(base, {
    companyId: link.firm.id, type: "info", priority: "normal",
    title: allowed ? `${link.client.name} autorizou o acompanhamento de certificados` : `${link.client.name} retirou a autorização de certificados`,
    body: allowed ? "Você já pode abrir solicitações e acompanhar as validades deste cliente em Certificados digitais." : "Solicitações e validades deste cliente deixam de ficar disponíveis até nova autorização.",
    link: `/contabil/certificados?cliente=${link.client.id}`, originType: "accounting_client", originId: link.client.id, occurrenceKey: `cert-tracking:${link.client.id}:${nowIso()}`,
    audience: link.client.responsibleUserId ? { userIds: [link.client.responsibleUserId] } : { module: "accounting" },
  }).catch(() => 0);
}

/** Escritório: o cliente pode ter certificados acompanhados? (cliente sem ERP: sempre; vinculado: só com autorização) */
export async function clientTrackingAllowed(ctx: Ctx, client: Doc): Promise<{ allowed: boolean; linked: boolean }> {
  const linked = client.linkStatus === "active" && Boolean(client.linkedCompanyId);
  if (!linked) return { allowed: true, linked: false };
  return { allowed: await certificateTrackingAuthorized(ctx.store, client.linkedCompanyId), linked: true };
}

async function assertTrackingAllowed(ctx: Ctx, client: Doc) {
  const t = await clientTrackingAllowed(ctx, client);
  if (!t.allowed) throw new BusinessError(`${client.name} ainda não autorizou o escritório a acompanhar seus certificados digitais. Prepare o pedido de acesso: o administrador da empresa autoriza em Administração → Integrações → Contabilidade.`, "tracking_not_authorized");
}

/** Escritório: pede à empresa vinculada a autorização de acompanhamento (notifica os administradores dela). */
export async function requestTrackingAccess(ctx: Ctx, clientId: string): Promise<void> {
  requireAction(ctx, "accounting.certificates");
  const firm = await requireFirm(ctx);
  const client = await getClient(ctx, clientId);
  const t = await clientTrackingAllowed(ctx, client);
  if (!t.linked) throw new BusinessError("Cliente sem vínculo com uma empresa do ERP: o acompanhamento é registrado pelo próprio escritório.", "not_linked");
  if (t.allowed) return;
  const base = unscoped(ctx.store);
  await notify(base, {
    companyId: client.linkedCompanyId, type: "info", priority: "high",
    title: `${firm.tradeName || firm.name} pede autorização para acompanhar seus certificados digitais`,
    body: "Autorize (ou não) em Administração → Integrações → Contabilidade → Certificados digitais. A permissão é independente das demais autorizações do escritório.",
    link: "/administracao/integracoes/accounting", originType: "accounting_client", originId: client.id, occurrenceKey: `cert-tracking-request:${client.id}:${today()}`,
    audience: { action: "admin.integrations" },
  });
  await audit(ctx, { module: "accounting", action: "certificates.tracking_requested", entityType: "accounting_client", entityId: client.id, summary: `Pedido de autorização de acompanhamento de certificados enviado a ${client.name}` });
  await base.create("audit_logs", {
    companyId: client.linkedCompanyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: "Escritório contábil", module: "admin", action: "certificates.tracking_requested",
    entityType: "integration", entityId: "accounting", summary: `${firm.tradeName || firm.name} pediu autorização para acompanhar os certificados digitais da empresa`,
    before: null, after: null, reason: null, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [],
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// Solicitações

export interface CertRequestInput {
  clientId: string;
  kind: "new" | "renewal";
  product: string;
  /** centavos; vazio = preço do catálogo */
  amount?: number | null;
  dueDate: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  previousCertificateId?: string | null;
  responsibleUserId?: string | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const pad = (n: number) => `CERT-${String(n).padStart(4, "0")}`;

/** Situação exibida: a cobrança vencida é um alerta dentro de "aguardando pagamento". */
export function requestDisplayStatus(r: Doc, ref = today()): string {
  if (r.status === "awaiting_payment" && r.dueDate && r.dueDate < ref) return "overdue";
  return r.status;
}

export function requestIsOpen(r: Doc): boolean {
  return CERT_OPEN_STATUSES.includes(r.status);
}

/** §45: venda de um parceiro da rede (Master/Regional/Revenda e vendedores) — o mesmo ciclo da Tela 67, outro "lado". */
export function isNetworkSale(r: Doc | Record<string, any>): boolean {
  return r.channel === "network";
}

/** Lado "dono" da solicitação: o escritório (Tela 67) ou o parceiro que vendeu (vendedor ou quem vê todo o nó). */
export function isOwnerActor(ctx: Ctx, r: Doc): boolean {
  if (r.companyId !== ctx.companyId) return false;
  if (!isNetworkSale(r)) return canDo(ctx.user, "accounting.certificates");
  return canDo(ctx.user, "network.sell") && (canDo(ctx.user, "network.sales_all") || r.sellerUserId === ctx.user.id);
}

/** Próxima ação e responsável por ela, conforme a etapa — a mesma régua das telas. */
export function requestNextAction(r: Doc, ref = today()): { label: string; owner: "firm" | "team" | "company" | "none" } {
  const display = requestDisplayStatus(r, ref);
  switch (display) {
    case "overdue": return { label: "Atualizar o vencimento e reenviar a cobrança", owner: "firm" };
    case "awaiting_payment": return { label: (r.chargeSends ?? 0) > 0 ? "Aguardar a confirmação do pagamento" : "Enviar a cobrança ao cliente", owner: (r.chargeSends ?? 0) > 0 ? "team" : "firm" };
    case "validation": return { label: r.validationStatus === "scheduled" ? "Validar o titular na data agendada" : r.validationStatus === "rejected" ? "Reagendar a validação do titular" : "Agendar a validação do titular", owner: "team" };
    case "ready_to_issue": return { label: "Pedir a emissão do certificado", owner: "firm" };
    case "issuing": return { label: "Registrar a emissão (arquivo) ou a falha", owner: "team" };
    case "issue_failed": return { label: "Tentar a emissão novamente (sem nova cobrança)", owner: "firm" };
    case "awaiting_authorization": return { label: r.linkedCompanyId ? "Aguardar a autorização de download pelo titular no ERP" : "Registrar a autorização do titular", owner: r.linkedCompanyId ? "company" : "firm" };
    case "ready_to_download": return { label: "Baixar o certificado (confirmação de senha)", owner: "firm" };
    case "downloaded": return { label: "Concluído — download registrado", owner: "none" };
    default: return { label: "Cancelada", owner: "none" };
  }
}

async function openRequestOf(store: Store, clientId: string): Promise<Doc | null> {
  const rows = await listAll(store, "certificate_requests", { filters: [["eq", "clientId", clientId]] }, 200);
  return rows.filter(requestIsOpen).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

export async function createCertificateRequest(ctx: Ctx, input: CertRequestInput): Promise<Doc> {
  requirePerm(ctx, "accounting", "create");
  requireAction(ctx, "accounting.certificates");
  await requireFirm(ctx);
  const client = await getClient(ctx, input.clientId);
  if (client.status === "closed") throw new BusinessError("Cliente encerrado: reative-o antes de solicitar um certificado.", "closed");
  await assertTrackingAllowed(ctx, client);
  const open = await openRequestOf(ctx.store, client.id);
  if (open) throw new BusinessError(`Já existe um atendimento em andamento para ${client.name}: ${open.protocol} (${CERT_STATUS_LABEL[open.status]}). Acompanhe-o em vez de abrir outro.`, "open_request");
  assert(input.kind === "new" || input.kind === "renewal", "Tipo de solicitação inválido.");
  const settings = await certificationSettings(ctx.store);
  const product = productByKey(settings, input.product);
  if (!product || !product.active) throw new BusinessError("Produto inválido ou inativo no catálogo.", "product");
  if (product.free) throw new BusinessError("Produto gratuito: a emissão gratuita é feita pela venda gratuita da rede de certificação, não pela cobrança do escritório.", "product");
  // §45: escritório que é nó CONTADOR da rede vende pelo preço da rede (padrão do nó; alterável só se a regra permitir,
  // nunca abaixo do mínimo) e a solicitação guarda o retrato da cascata; fora da rede, o catálogo como antes
  const { firmNetworkPricing } = await import("../network/sales");
  const net = await firmNetworkPricing(ctx, product, input.amount == null || input.amount === 0 ? null : Math.round(input.amount));
  const amount = net ? net.amount : input.amount == null || input.amount === 0 ? product.price : Math.round(input.amount);
  assert(amount > 0, "Informe o valor da cobrança.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) && input.dueDate >= today(), "O vencimento da cobrança não pode ser anterior a hoje.");
  const contactEmail = (input.contactEmail ?? client.email ?? "").trim().toLowerCase() || null;
  if (contactEmail) assert(EMAIL_RE.test(contactEmail), "E-mail de contato inválido.");
  if (input.previousCertificateId) {
    const prev = await ctx.store.get("accounting_certificates", input.previousCertificateId);
    assert(prev && prev.clientId === client.id, "Certificado anterior não pertence a este cliente.");
  }
  const linked = client.linkStatus === "active" && client.linkedCompanyId ? client.linkedCompanyId : null;
  const seq = await nextNumber(ctx.store, `cert_request:${ctx.companyId}`);
  const data = {
    companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId: client.id, protocol: pad(seq), kind: input.kind, product: product.key, productLabel: product.label, months: product.months,
    holderName: client.name, holderDoc: client.doc ?? null, linkedCompanyId: linked, contactEmail, contactPhone: input.contactPhone?.trim() || client.phone || null, amount, dueDate: input.dueDate,
    status: "awaiting_payment" satisfies CertStatus, responsibleUserId: input.responsibleUserId || client.responsibleUserId || ctx.user.id, previousCertificateId: input.previousCertificateId || null, notes: input.notes?.trim() || null,
    chargeSends: 0, emissionAttempts: 0, downloads: 0, downloadAuthorized: false, validationStatus: "pending",
    productType: product.type ?? null, holderType: product.holder ?? null,
    ...(net ? { channel: "firm", sellerNodeId: net.cascade.sellerNodeId, sellerUserId: ctx.user.id, sellerName: ctx.user.name, cascade: net.sellerView, listPrice: net.cascade.listPrice, minPrice: net.cascade.minPrice, discount: 0 } : {}),
  };
  // §46: na rede, a solicitação, o retrato completo (registro da plataforma — a solicitação guarda só a visão do
  // escritório) e o plano de liquidação em camadas vão na mesma transação, com a reserva do saldo pré-pago
  let row: Doc;
  if (net) {
    const { createFirmNetworkRequest } = await import("../network/sales");
    row = await createFirmNetworkRequest(ctx, data, net.cascade);
  } else row = await ctx.store.create("certificate_requests", data);
  await audit(ctx, {
    module: "accounting", action: "certificate.request", entityType: "certificate_request", entityId: row.id, summary: `Solicitação ${row.protocol} criada: ${CERT_KIND_LABEL[input.kind]} de ${product.label} para ${client.name} — ${formatMoney(amount)}, vencimento ${formatDate(input.dueDate)}${net ? ` · preço da rede (custo ${formatMoney(net.cascade.sellerCost)}, margem ${formatMoney(amount - net.cascade.sellerCost)})` : ""}`,
    after: { kind: input.kind, product: product.key, amount, dueDate: input.dueDate, ...(net ? { sellerNodeId: net.cascade.sellerNodeId, cascade: net.sellerView } : {}) }, related: [`accounting_client:${client.id}`],
  });
  return row;
}

export async function getCertificateRequest(ctx: Ctx, id: string): Promise<Doc> {
  requirePerm(ctx, "accounting", "view");
  const r = await ctx.store.get("certificate_requests", id);
  if (!r || r.companyId !== ctx.companyId || isNetworkSale(r)) throw new BusinessError("Solicitação não encontrada.", "not_found");
  const visible = await visibleClientIds(ctx);
  if (visible && !visible.has(r.clientId)) throw new BusinessError("Esta solicitação não está na sua carteira.", "forbidden");
  return r;
}

export interface CertRequestFilter {
  clientId?: string | null;
  /** situação, "open" (em atendimento) ou "overdue" (cobrança vencida) */
  status?: string | null;
}

export async function listCertificateRequests(ctx: Ctx, f: CertRequestFilter = {}): Promise<Doc[]> {
  requirePerm(ctx, "accounting", "view");
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (f.clientId) filters.push(["eq", "clientId", f.clientId]);
  const rows = (await listAll(ctx.store, "certificate_requests", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] }, 5000)).filter((r) => !isNetworkSale(r));
  const visible = await visibleClientIds(ctx);
  const ref = today();
  return rows
    .filter((r) => !visible || visible.has(r.clientId))
    .filter((r) => !f.status || (f.status === "open" ? requestIsOpen(r) : f.status === "overdue" ? requestDisplayStatus(r, ref) === "overdue" : r.status === f.status));
}

// ---------------------------------------------------------------------------------------------------------------------
// Histórico e notificações (o protocolo vive na empresa do escritório; a equipe e o titular escrevem lá)

interface EventInput {
  action: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  related?: string[];
  role?: string;
}

async function logEvent(ctx: Ctx, r: Doc, input: EventInput) {
  const related = [isNetworkSale(r) ? `cert_customer:${r.clientId}` : `accounting_client:${r.clientId}`, ...(input.related ?? [])];
  if (ctx.companyId === r.companyId) {
    await audit(ctx, { module: isNetworkSale(r) ? "admin" : "accounting", action: input.action, entityType: "certificate_request", entityId: r.id, summary: input.summary, before: input.before, after: input.after, reason: input.reason ?? null, related });
    return;
  }
  await unscoped(ctx.store).create("audit_logs", {
    companyId: r.companyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: input.role ?? "Equipe de certificação", module: isNetworkSale(r) ? "admin" : "accounting", action: input.action,
    entityType: "certificate_request", entityId: r.id, summary: input.summary, before: input.before ?? null, after: input.after ?? null, reason: input.reason ?? null, result: "success",
    ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related,
  }).catch(() => undefined);
}

async function notifyFirm(store: Store, r: Doc, input: { title: string; body?: string; priority?: "low" | "normal" | "high" | "critical"; key: string }) {
  await notify(unscoped(store), {
    companyId: r.companyId, type: "info", priority: input.priority ?? "normal", title: input.title, body: input.body, link: isNetworkSale(r) ? `/rede/vendas/${r.id}` : `/contabil/certificados/${r.id}`,
    originType: "certificate_request", originId: r.id, occurrenceKey: `cert:${r.id}:${input.key}`,
    audience: r.responsibleUserId ? { userIds: [r.responsibleUserId] } : isNetworkSale(r) ? { action: "network.sales_all" } : { module: "accounting" },
  }).catch(() => 0);
}

async function notifyTeam(store: Store, r: Doc, input: { title: string; body?: string; key: string }) {
  await notify(unscoped(store), {
    companyId: r.companyId, type: "info", priority: "normal", title: input.title, body: input.body, link: `/administracao/certificacao/${r.id}`,
    originType: "certificate_request", originId: r.id, occurrenceKey: `cert-team:${r.id}:${input.key}`, audience: { action: "certification.operate" },
  }).catch(() => 0);
}

/** Leitura pela equipe (qualquer escritório) ou pelo escritório dono. */
async function loadForActor(ctx: Ctx, id: string, actor: "firm" | "team" | "firm_or_team"): Promise<Doc> {
  const r = await unscoped(ctx.store).get("certificate_requests", id);
  if (!r) throw new BusinessError("Solicitação não encontrada.", "not_found");
  const isTeam = canDo(ctx.user, "certification.operate");
  // "firm" = o lado dono: o escritório (Tela 67) ou o parceiro que vendeu (§45)
  const isFirm = isOwnerActor(ctx, r);
  if (actor === "team" && !isTeam) throw new PermissionError();
  if (actor === "firm" && !isFirm) throw new PermissionError();
  if (actor === "firm_or_team" && !isTeam && !isFirm) throw new PermissionError();
  if (isFirm && !isTeam && !isNetworkSale(r)) await getCertificateRequest(ctx, id); // carteira visível
  return r;
}

async function patch(ctx: Ctx, r: Doc, data: Record<string, any>): Promise<Doc> {
  return unscoped(ctx.store).update("certificate_requests", r.id, data);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cobrança

/** Texto da cobrança enviado ao cliente (prévia idêntica ao envio). */
export function chargeMessage(r: Doc, settings: CertificationSettings): { subject: string; text: string; link: string | null } {
  const link = settings.paymentUrlBase ? `${settings.paymentUrlBase.replace(/\/+$/, "")}/${r.protocol}` : null;
  const lines = [
    `Olá, ${r.holderName}.`,
    `Sua solicitação ${r.protocol} de ${r.productLabel} (${CERT_KIND_LABEL[r.kind] ?? r.kind}) está pronta para pagamento: ${formatMoney(r.amount)}, pagamento único, vencimento em ${formatDate(r.dueDate)}.`,
    settings.paymentInstructions ? settings.paymentInstructions : null,
    link ? `Link de pagamento: ${link}` : null,
    "Após a confirmação do pagamento, acompanharemos a validação do titular e a emissão do certificado.",
    "Esta cobrança é da certificação digital e não se confunde com a mensalidade do ERP.",
  ].filter(Boolean) as string[];
  return { subject: `Certificado digital — ${r.protocol} — ${r.productLabel}`, text: lines.join("\n\n"), link };
}

export interface SendChargeInput {
  channel: "email" | "whatsapp" | "phone" | "other";
  to?: string | null;
  /** novo vencimento (obrigatório quando a cobrança venceu) */
  dueDate?: string | null;
  message?: string | null;
}

export async function sendCertificateCharge(ctx: Ctx, id: string, input: SendChargeInput): Promise<{ channel: string; to: string; delivered: boolean; message?: string }> {
  const r = await loadForActor(ctx, id, "firm");
  if (r.status !== "awaiting_payment") throw new BusinessError(`A cobrança só pode ser enviada enquanto a solicitação aguarda pagamento (situação atual: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const ref = today();
  let dueDate = r.dueDate;
  if (input.dueDate) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) && input.dueDate >= ref, "O novo vencimento não pode ser anterior a hoje.");
    dueDate = input.dueDate;
  }
  if (dueDate < ref) throw new BusinessError("A cobrança venceu. Atualize o vencimento antes de reenviar ao cliente.", "overdue");
  assert(["email", "whatsapp", "phone", "other"].includes(input.channel), "Canal inválido.");
  const to = (input.to ?? (input.channel === "email" ? r.contactEmail : r.contactPhone) ?? "").trim();
  assert(to, input.channel === "email" ? "Informe o e-mail do cliente." : "Informe o destinatário (telefone ou contato).");
  if (input.channel === "email") assert(EMAIL_RE.test(to), "E-mail do cliente inválido.");
  const settings = await certificationSettings(ctx.store);
  const next = dueDate !== r.dueDate ? { ...r, dueDate } : r;
  const msg = chargeMessage(next, settings);
  let delivered = true;
  let detail: string | undefined;
  if (input.channel === "email") {
    const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const html = `${msg.text.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("")}${input.message ? `<p>${esc(input.message)}</p>` : ""}`;
    const { sendEmail } = await import("@/lib/core/email");
    const res = await sendEmail(ctx.companyId, { to, subject: msg.subject, html });
    if (!res.delivered) {
      await logEvent(ctx, r, { action: "certificate.charge_failed", summary: `Cobrança de ${r.protocol} NÃO enviada por e-mail para ${to}: ${res.message ?? res.channel}`, after: { channel: "email", to } });
      throw new BusinessError(`E-mail não enviado (${res.channel}): ${res.message ?? "sem detalhes"}. Registre o envio manual por outro canal ou configure o canal de e-mail em Administração → Integrações.`, "email_failed");
    }
    detail = res.channel;
  } else {
    // envio manual identificado: o escritório enviou o texto por WhatsApp/telefone/outro e registra quem, quando e para quem
    delivered = true;
  }
  const after = await patch(ctx, r, { dueDate, chargeSends: (r.chargeSends ?? 0) + 1, chargeSentAt: nowIso(), chargeChannel: input.channel, chargeTo: to, chargeLink: msg.link });
  await logEvent(ctx, r, {
    action: (r.chargeSends ?? 0) > 0 ? "certificate.charge_resent" : "certificate.charge_sent",
    summary: `${(r.chargeSends ?? 0) > 0 ? "Reenvio da" : "Envio da"} cobrança de ${r.protocol} (${formatMoney(r.amount)}, vencimento ${formatDate(dueDate)}) por ${CHARGE_CHANNEL_LABEL[input.channel]} para ${to}${dueDate !== r.dueDate ? ` — vencimento atualizado de ${formatDate(r.dueDate)}` : ""}`,
    after: { channel: input.channel, to, dueDate, sends: after.chargeSends, link: msg.link, message: input.message?.trim() || null },
  });
  if ((r.chargeSends ?? 0) === 0) await notifyTeam(ctx.store, after, { title: `Cobrança enviada — ${r.protocol} (${r.holderName})`, body: `${formatMoney(r.amount)}, vencimento ${formatDate(dueDate)}. Confirme o pagamento quando a transação chegar.`, key: "charge" });
  return { channel: input.channel, to, delivered, message: detail };
}

export async function confirmCertificatePayment(ctx: Ctx, id: string, input: { ref: string; paidAt?: string | null; amount?: number | null }): Promise<Doc> {
  const r = await loadForActor(ctx, id, "team");
  if (r.status !== "awaiting_payment") throw new BusinessError(`Pagamento só pode ser confirmado em solicitação aguardando pagamento (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const paymentRef = String(input.ref ?? "").trim();
  assert(paymentRef, "Informe a referência da transação (comprovante, id do gateway ou número do Pix).");
  const paidAt = input.paidAt?.trim() || nowIso();
  const amount = input.amount != null && input.amount > 0 ? Math.round(input.amount) : r.amount;
  // §46: venda com preço da rede tem o plano de liquidação calculado sobre o valor cobrado — não muda na confirmação
  if (r.sellerNodeId && amount !== r.amount) throw new BusinessError(`Venda da rede: o valor pago (${formatMoney(amount)}) precisa ser o valor cobrado (${formatMoney(r.amount)}). Diferenças são tratadas pelo estorno e uma nova venda.`, "amount");
  const after = await patch(ctx, r, { status: "validation", validationStatus: "pending", paymentConfirmedAt: paidAt, paymentRef, paymentBy: ctx.user.id, amount });
  await logEvent(ctx, r, { action: "certificate.payment_confirmed", summary: `Pagamento confirmado — ${formatMoney(amount)} · referência ${paymentRef}`, after: { paymentRef, paidAt, amount } });
  if (r.couponId) {
    // §45: o uso do cupom reservado na venda passa a consumido (conta no limite de forma definitiva)
    const { consumeCouponUse } = await import("../network/coupons");
    await consumeCouponUse(ctx.store, r);
  }
  if (r.sellerNodeId) {
    // §46: lançamentos de todas as camadas (baixa do cliente, carteira, acúmulo para o fechamento, split, custo AC)
    const { onSalePaid } = await import("../network/ledger");
    await onSalePaid(ctx, after);
  }
  await notifyFirm(ctx.store, after, { title: `Pagamento confirmado — ${r.protocol} (${r.holderName})`, body: `Referência ${paymentRef}. A solicitação segue para a validação do titular pela equipe de certificação.`, key: "paid" });
  return after;
}

// ---------------------------------------------------------------------------------------------------------------------
// Validação do titular (equipe de certificação)

export async function scheduleCertificateValidation(ctx: Ctx, id: string, input: { at: string; mode: "video" | "in_person"; notes?: string | null }): Promise<Doc> {
  const r = await loadForActor(ctx, id, "team");
  if (r.status !== "validation") throw new BusinessError(`A validação só é agendada após a confirmação do pagamento (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const at = new Date(input.at);
  assert(!Number.isNaN(at.getTime()), "Informe data e hora da validação.");
  assert(input.mode === "video" || input.mode === "in_person", "Modalidade inválida.");
  const reschedule = r.validationStatus === "scheduled";
  const after = await patch(ctx, r, { validationStatus: "scheduled", validationAt: at.toISOString(), validationMode: input.mode, validationNotes: input.notes?.trim() || null });
  await logEvent(ctx, r, { action: reschedule ? "certificate.validation_rescheduled" : "certificate.validation_scheduled", summary: `Validação do titular ${reschedule ? "reagendada" : "agendada"} para ${formatDateTime(at.toISOString())} (${VALIDATION_MODE_LABEL[input.mode]})`, after: { at: at.toISOString(), mode: input.mode, notes: input.notes ?? null } });
  await notifyFirm(ctx.store, after, { title: `Validação do titular ${reschedule ? "reagendada" : "agendada"} — ${r.protocol}`, body: `${formatDateTime(at.toISOString())} · ${VALIDATION_MODE_LABEL[input.mode]}. Avise o titular de ${r.holderName}.`, key: `validation:${at.toISOString()}` });
  return after;
}

export async function approveCertificateValidation(ctx: Ctx, id: string, input: { notes?: string | null } = {}): Promise<Doc> {
  const r = await loadForActor(ctx, id, "team");
  if (r.status !== "validation") throw new BusinessError(`Não há validação pendente (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const after = await patch(ctx, r, { status: "ready_to_issue", validationStatus: "approved", validatedAt: nowIso(), validatedBy: ctx.user.id, validationNotes: input.notes?.trim() || r.validationNotes || null });
  await logEvent(ctx, r, { action: "certificate.validation_approved", summary: `Validação do titular aprovada${input.notes ? ` — ${input.notes}` : ""}`, after: { notes: input.notes ?? null } });
  await notifyFirm(ctx.store, after, { title: `Titular validado — ${r.protocol} (${r.holderName})`, body: "Peça a emissão do certificado na solicitação.", key: "validated" });
  return after;
}

export async function rejectCertificateValidation(ctx: Ctx, id: string, input: { reason: string }): Promise<Doc> {
  const r = await loadForActor(ctx, id, "team");
  if (r.status !== "validation") throw new BusinessError(`Não há validação pendente (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const reason = String(input.reason ?? "").trim();
  assert(reason, "Informe o motivo da recusa (documento faltante, titular ausente, divergência).");
  const after = await patch(ctx, r, { validationStatus: "rejected", validationNotes: reason });
  await logEvent(ctx, r, { action: "certificate.validation_rejected", summary: `Validação do titular não concluída: ${reason}`, reason, after: { reason } });
  await notifyFirm(ctx.store, after, { title: `Validação pendente — ${r.protocol} (${r.holderName})`, body: `${reason}. A equipe de certificação reagendará a validação; oriente o titular.`, priority: "high", key: `rejected:${nowIso()}` });
  return after;
}

// ---------------------------------------------------------------------------------------------------------------------
// Emissão

export async function requestCertificateEmission(ctx: Ctx, id: string): Promise<Doc> {
  const r = await loadForActor(ctx, id, "firm_or_team");
  if (!["ready_to_issue", "issue_failed"].includes(r.status)) throw new BusinessError(`A emissão só pode ser pedida com pagamento confirmado e titular validado (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const retry = r.status === "issue_failed";
  const after = await patch(ctx, r, { status: "issuing", emissionRequestedAt: nowIso(), emissionAttempts: (r.emissionAttempts ?? 0) + 1 });
  await logEvent(ctx, r, { action: retry ? "certificate.emission_retry" : "certificate.emission_requested", summary: retry ? `Nova tentativa de emissão pedida (tentativa ${after.emissionAttempts}, sem nova cobrança)` : "Emissão do certificado solicitada à certificadora", after: { attempt: after.emissionAttempts }, role: ctx.companyId === r.companyId ? undefined : "Equipe de certificação" });
  await notifyTeam(ctx.store, after, { title: `${retry ? "Nova tentativa de emissão" : "Emissão solicitada"} — ${r.protocol} (${r.holderName})`, body: `${r.productLabel}. Registre o arquivo emitido ou a falha na fila da certificação.`, key: `issue:${after.emissionAttempts}` });
  return after;
}

export interface EmissionInput {
  file?: { name: string; data: Buffer } | null;
  /** senha do .pfx, usada só para ler titular/validade; nunca é gravada */
  password?: string | null;
  serial?: string | null;
  issuer?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export async function registerCertificateEmission(ctx: Ctx, id: string, input: EmissionInput): Promise<Doc> {
  const r = await loadForActor(ctx, id, "team");
  if (!["issuing", "ready_to_issue", "issue_failed"].includes(r.status)) throw new BusinessError(`A emissão só pode ser registrada após a validação do titular (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  assert(input.file?.data?.length, "Anexe o arquivo do certificado emitido (.pfx/.p12).");
  assert(/\.(pfx|p12)$/i.test(input.file!.name), "O arquivo precisa ser .pfx ou .p12.");
  let serial = input.serial?.trim() || null;
  let issuer = input.issuer?.trim() || null;
  let validFrom = input.validFrom?.trim() || null;
  let validTo = input.validTo?.trim() || null;
  if (input.password) {
    const { parsePfx } = await import("../fiscal/config");
    const info = parsePfx(input.file!.data, input.password);
    if (r.holderDoc && info.cnpj && info.cnpj !== r.holderDoc) throw new BusinessError(`O certificado é de outro titular (CNPJ ${formatDoc(info.cnpj)}); a solicitação é de ${formatDoc(r.holderDoc)}.`, "holder_mismatch");
    serial = serial ?? info.serial;
    issuer = issuer ?? info.issuer;
    validFrom = validFrom ?? info.validFrom.slice(0, 10);
    validTo = validTo ?? info.validTo.slice(0, 10);
  }
  assert(validTo && /^\d{4}-\d{2}-\d{2}$/.test(validTo), "Informe a validade do certificado (ou a senha do arquivo para lê-la).");
  validFrom = validFrom && /^\d{4}-\d{2}-\d{2}$/.test(validFrom) ? validFrom : today();
  assert(validTo > validFrom, "A validade final precisa ser posterior ao início.");
  const firmCtx: Ctx = { ...ctx, companyId: r.companyId, branchId: null, store: scopeStore(unscoped(ctx.store), r.companyId) };
  const file = await saveFile(firmCtx, { bucket: "documents", name: input.file!.name, mime: "application/x-pkcs12", data: input.file!.data, entityType: "certificate_request", entityId: r.id, kind: "certificate_issued", branchId: null });
  const cert = await firmCtx.store.create("accounting_certificates", {
    companyId: r.companyId, branchId: null, createdBy: ctx.user.id, clientId: r.clientId, holderName: r.holderName, holderDoc: r.holderDoc ?? null, product: r.product, productLabel: r.productLabel,
    serial, issuer, validFrom, validTo, source: "issued", requestId: r.id, fileId: file.id, notes: null, active: true,
    channel: isNetworkSale(r) ? "network" : "firm", customerId: isNetworkSale(r) ? r.clientId : null, sellerNodeId: r.sellerNodeId ?? null, sellerUserId: r.sellerUserId ?? null, productType: r.productType ?? null, holderType: r.holderType ?? null,
  });
  if (isNetworkSale(r)) {
    const { onNetworkSaleIssued } = await import("../network/sales");
    await onNetworkSaleIssued(ctx.store, r, { validTo });
  }
  // a renovação substitui o anterior no acompanhamento; o histórico do anterior permanece
  if (r.previousCertificateId) await firmCtx.store.update("accounting_certificates", r.previousCertificateId, { active: false }).catch(() => undefined);
  const status: CertStatus = r.downloadAuthorized ? "ready_to_download" : "awaiting_authorization";
  const after = await patch(ctx, r, { status, issuedAt: nowIso(), issuedBy: ctx.user.id, serial, issuer, validFrom, validTo, fileId: file.id, fileName: input.file!.name, certificateId: cert.id, emissionFailedAt: null, emissionFailure: null });
  await logEvent(ctx, r, { action: "certificate.issued", summary: `Certificado emitido — ${r.productLabel}, válido de ${formatDate(validFrom)} a ${formatDate(validTo)}${serial ? ` · série ${serial}` : ""}. ${r.downloadAuthorized ? "Pronto para baixar." : "Aguardando autorização de download pelo titular."}`, after: { serial, issuer, validFrom, validTo, fileId: file.id }, related: [`file:${file.id}`, `accounting_certificate:${cert.id}`] });
  await notifyFirm(ctx.store, after, { title: `Certificado emitido — ${r.protocol} (${r.holderName})`, body: r.downloadAuthorized ? "Pronto para baixar na solicitação (com confirmação de senha)." : (r.linkedCompanyId ? "Aguardando o titular autorizar o download pelo escritório no ERP." : "Registre a autorização do titular na solicitação para liberar o download."), priority: "high", key: "issued" });
  if (r.linkedCompanyId) {
    await notify(unscoped(ctx.store), {
      companyId: r.linkedCompanyId, type: "info", priority: "high", title: `Certificado digital emitido — ${r.productLabel}`,
      body: r.downloadAuthorized ? "O escritório contábil já pode baixá-lo; você também pode baixar em Administração → Integrações → Contabilidade." : "Para o escritório contábil baixar o arquivo, autorize em Administração → Integrações → Contabilidade → Certificados digitais.",
      link: "/administracao/integracoes/accounting", originType: "certificate_request", originId: r.id, occurrenceKey: `cert-company:${r.id}:issued`, audience: { action: "admin.integrations" },
    }).catch(() => 0);
  }
  return after;
}

export async function registerCertificateEmissionFailure(ctx: Ctx, id: string, input: { reason: string }): Promise<Doc> {
  const r = await loadForActor(ctx, id, "team");
  if (r.status !== "issuing") throw new BusinessError(`Só uma emissão em andamento pode falhar (situação: ${CERT_STATUS_LABEL[r.status]}).`, "status");
  const reason = String(input.reason ?? "").trim();
  assert(reason, "Informe o retorno da certificadora (motivo da falha).");
  const after = await patch(ctx, r, { status: "issue_failed", emissionFailedAt: nowIso(), emissionFailure: reason });
  await logEvent(ctx, r, { action: "certificate.emission_failed", summary: `Falha na emissão (tentativa ${r.emissionAttempts ?? 1}): ${reason}. O pagamento continua confirmado.`, reason, after: { reason } });
  await notifyFirm(ctx.store, after, { title: `Falha na emissão — ${r.protocol} (${r.holderName})`, body: `${reason}. Você pode pedir nova tentativa na solicitação, sem nova cobrança.`, priority: "high", key: `failed:${nowIso()}` });
  return after;
}

// ---------------------------------------------------------------------------------------------------------------------
// Autorização de download e entrega

/** Titular (empresa vinculada no ERP): autoriza o escritório a baixar o certificado desta solicitação. */
export async function authorizeCertificateDownloadByCompany(ctx: Ctx, id: string): Promise<Doc> {
  requireAction(ctx, "admin.integrations");
  requirePerm(ctx, "admin", "edit");
  const r = await unscoped(ctx.store).get("certificate_requests", id);
  if (!r || r.linkedCompanyId !== ctx.companyId) throw new BusinessError("Solicitação não encontrada para esta empresa.", "not_found");
  if (r.status === "cancelled") throw new BusinessError("Solicitação cancelada.", "status");
  if (r.downloadAuthorized) return r;
  const status: CertStatus = r.status === "awaiting_authorization" ? "ready_to_download" : r.status;
  const after = await patch(ctx, r, { downloadAuthorized: true, downloadAuthorizedAt: nowIso(), downloadAuthorizedBy: "company", status });
  await logEvent(ctx, r, { action: "certificate.download_authorized", summary: `Titular autorizou o download do certificado pelo escritório (${ctx.user.name})`, after: { by: "company" }, role: "Empresa vinculada" });
  await audit(ctx, { module: "admin", action: "certificate.download_authorized", entityType: "integration", entityId: "accounting", summary: `Download do certificado ${r.protocol} (${r.productLabel}) autorizado ao escritório contábil`, after: { requestId: r.id } });
  await notifyFirm(ctx.store, after, { title: `Download autorizado — ${r.protocol} (${r.holderName})`, body: status === "ready_to_download" ? "O certificado está pronto para baixar na solicitação." : "A autorização vale assim que o certificado for emitido.", key: "authorized" });
  return after;
}

/** Escritório: registra a autorização do titular quando o cliente NÃO usa o ERP (com evidência e quem/quando). */
export async function recordCertificateAuthorization(ctx: Ctx, id: string, input: { notes: string; evidence?: { name: string; data: Buffer; mime: string } | null }): Promise<Doc> {
  const r = await loadForActor(ctx, id, "firm");
  if (r.linkedCompanyId) throw new BusinessError("Cliente vinculado ao ERP: a autorização de download é dada pelo administrador da empresa em Administração → Integrações → Contabilidade.", "linked");
  if (r.status === "cancelled") throw new BusinessError("Solicitação cancelada.", "status");
  const notes = String(input.notes ?? "").trim();
  assert(notes.length >= 10, "Descreva como o titular autorizou (ex.: termo assinado em 10/10, e-mail do sócio), com ao menos 10 caracteres.");
  let evidenceId: string | null = r.downloadAuthEvidenceFileId ?? null;
  if (input.evidence?.data?.length) {
    const f = await saveFile(ctx, { bucket: "documents", name: input.evidence.name, mime: input.evidence.mime || "application/octet-stream", data: input.evidence.data, entityType: "certificate_request", entityId: r.id, kind: "certificate_auth_evidence", branchId: null });
    evidenceId = f.id;
  }
  const status: CertStatus = r.status === "awaiting_authorization" ? "ready_to_download" : r.status;
  const after = await patch(ctx, r, { downloadAuthorized: true, downloadAuthorizedAt: nowIso(), downloadAuthorizedBy: "firm", downloadAuthNotes: notes, downloadAuthEvidenceFileId: evidenceId, status });
  await logEvent(ctx, r, { action: "certificate.download_authorized", summary: `Autorização do titular registrada pelo escritório: ${notes}${evidenceId ? " (com evidência anexada)" : ""}`, after: { by: "firm", notes, evidenceId }, related: evidenceId ? [`file:${evidenceId}`] : [] });
  return after;
}

/** Escritório: pede ao titular (empresa vinculada) a autorização de download desta solicitação. */
export async function requestDownloadAuthorization(ctx: Ctx, id: string): Promise<void> {
  const r = await loadForActor(ctx, id, "firm");
  if (!r.linkedCompanyId) throw new BusinessError("Cliente sem vínculo com o ERP: registre a autorização do titular diretamente na solicitação.", "not_linked");
  if (r.downloadAuthorized) return;
  const firm = await requireFirm(ctx);
  await notify(unscoped(ctx.store), {
    companyId: r.linkedCompanyId, type: "info", priority: "high", title: `${firm.tradeName || firm.name} pede autorização para baixar o certificado ${r.productLabel}`,
    body: `Solicitação ${r.protocol}. Autorize em Administração → Integrações → Contabilidade → Certificados digitais; a entrega continua disponível ao próprio titular.`,
    link: "/administracao/integracoes/accounting", originType: "certificate_request", originId: r.id, occurrenceKey: `cert-auth-request:${r.id}:${today()}`, audience: { action: "admin.integrations" },
  });
  await logEvent(ctx, r, { action: "certificate.authorization_requested", summary: `Pedido de autorização de download enviado ao titular (${r.holderName})` });
}

async function confirmPassword(ctx: Ctx, password: string) {
  assert(String(password ?? "").length > 0, "Confirme sua senha para baixar o certificado.");
  const { getAuth } = await import("@/lib/auth/provider");
  const auth = getAuth();
  try {
    const s = await auth.login(ctx.user.email, password, false);
    await auth.logout(s.secret).catch(() => undefined);
  } catch {
    throw new BusinessError("Senha incorreta. A confirmação de identidade é obrigatória para baixar o certificado.", "password");
  }
}

/**
 * Download do certificado emitido: pelo escritório (com autorização do titular) ou pelo próprio titular (empresa
 * vinculada, operação "fiscal.configure"). Exige a confirmação da senha do usuário e registra cada download.
 */
export async function downloadIssuedCertificate(ctx: Ctx, id: string, input: { password: string }): Promise<{ request: Doc; name: string; data: Buffer }> {
  const r = await unscoped(ctx.store).get("certificate_requests", id);
  if (!r) throw new BusinessError("Solicitação não encontrada.", "not_found");
  const asFirm = isOwnerActor(ctx, r);
  const asHolder = Boolean(r.linkedCompanyId) && r.linkedCompanyId === ctx.companyId && canDo(ctx.user, "fiscal.configure");
  if (!asFirm && !asHolder) throw new PermissionError();
  if (asFirm && !isNetworkSale(r)) await getCertificateRequest(ctx, id);
  if (!r.fileId || !["awaiting_authorization", "ready_to_download", "downloaded"].includes(r.status)) throw new BusinessError("O certificado ainda não foi emitido.", "not_issued");
  if (asFirm && !r.downloadAuthorized) throw new BusinessError("O titular ainda não autorizou o download pelo escritório. A entrega permanece disponível ao próprio titular.", "not_authorized");
  await confirmPassword(ctx, input.password);
  const firmCtx: Ctx = { ...ctx, companyId: r.companyId, branchId: null, store: scopeStore(unscoped(ctx.store), r.companyId) };
  const { meta, data } = await readFile(firmCtx, r.fileId);
  const after = await patch(ctx, r, { downloads: (r.downloads ?? 0) + 1, lastDownloadAt: nowIso(), lastDownloadBy: ctx.user.id, status: r.status === "ready_to_download" ? "downloaded" : r.status });
  await logEvent(ctx, r, { action: "certificate.downloaded", summary: `Download nº ${after.downloads} do certificado por ${ctx.user.name} (${asFirm ? "escritório" : "titular"}) — identidade confirmada`, after: { downloads: after.downloads, by: asFirm ? "firm" : "company" }, related: [`file:${r.fileId}`], role: asFirm ? undefined : "Empresa vinculada" });
  if (asHolder) await audit(ctx, { module: "fiscal", action: "certificate.downloaded", entityType: "integration", entityId: "accounting", summary: `Download do certificado ${r.protocol} (${r.productLabel}) pelo titular — identidade confirmada`, related: [`file:${r.fileId}`] });
  return { request: after, name: String(meta.name), data };
}

export async function cancelCertificateRequest(ctx: Ctx, id: string, input: { reason: string }): Promise<Doc> {
  const r = await loadForActor(ctx, id, "firm_or_team");
  // venda sem cobrança (gratuita ou voucher presente — §45) pode ser cancelada enquanto o titular não foi validado
  const noCharge = Number(r.amount ?? 0) === 0 && Boolean(r.free || r.gift) && r.status === "validation";
  if (r.status !== "awaiting_payment" && !noCharge) throw new BusinessError("Só solicitações ainda não pagas podem ser canceladas. Com pagamento confirmado, fale com a equipe de certificação.", "status");
  const reason = String(input.reason ?? "").trim();
  assert(reason, "Informe o motivo do cancelamento.");
  const after = await patch(ctx, r, { status: "cancelled", cancelledAt: nowIso(), cancelledBy: ctx.user.id, cancelReason: reason });
  await logEvent(ctx, r, { action: "certificate.cancelled", summary: `Solicitação ${r.protocol} cancelada: ${reason}`, reason, after: { reason }, role: ctx.companyId === r.companyId ? undefined : "Equipe de certificação" });
  // §45: estorno do resgate de voucher, liberação do cupom reservado e do BirdID gratuito (idempotentes)
  if (r.voucherRedemptionId || r.couponId || r.free) {
    const { onSaleCancelled } = await import("../network/sales");
    await onSaleCancelled(ctx, after);
  }
  if (r.sellerNodeId) {
    // §46: libera as reservas da carteira pré-paga e cancela o título do cliente
    const { onSaleCancelledFinance } = await import("../network/ledger");
    await onSaleCancelledFinance(ctx, after);
  }
  return after;
}

// ---------------------------------------------------------------------------------------------------------------------
// Certificados conhecidos (validades e renovações)

export interface KnownCertificate {
  id: string;
  clientId: string;
  clientName: string;
  holderDoc: string | null;
  productLabel: string;
  serial: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysLeft: number | null;
  validity: "expired" | "due_soon" | "ok" | "unknown";
  source: "issued" | "manual" | "erp";
  requestId: string | null;
  /** solicitação em andamento do cliente (acompanhar) */
  openRequest: { id: string; protocol: string; status: string } | null;
  branchName?: string | null;
}

export function validityOf(validTo: string | null | undefined, ref = today()): { daysLeft: number | null; validity: KnownCertificate["validity"] } {
  if (!validTo) return { daysLeft: null, validity: "unknown" };
  const daysLeft = diffDays(ref, validTo.slice(0, 10));
  return { daysLeft, validity: daysLeft < 0 ? "expired" : daysLeft <= CERT_DUE_SOON_DAYS ? "due_soon" : "ok" };
}

export async function registerKnownCertificate(ctx: Ctx, clientId: string, input: { holderName?: string | null; productLabel?: string | null; serial?: string | null; issuer?: string | null; validFrom?: string | null; validTo: string; notes?: string | null }): Promise<Doc> {
  requireAction(ctx, "accounting.certificates");
  await requireFirm(ctx);
  const client = await getClient(ctx, clientId);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.validTo ?? ""), "Informe a validade do certificado.");
  const validFrom = input.validFrom && /^\d{4}-\d{2}-\d{2}$/.test(input.validFrom) ? input.validFrom : null;
  if (validFrom) assert(input.validTo > validFrom, "A validade final precisa ser posterior ao início.");
  const row = await ctx.store.create("accounting_certificates", {
    companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId: client.id, holderName: input.holderName?.trim() || client.name, holderDoc: client.doc ?? null, product: "manual",
    productLabel: input.productLabel?.trim() || "Certificado digital", serial: input.serial?.trim() || null, issuer: input.issuer?.trim() || null, validFrom, validTo: input.validTo, source: "manual", requestId: null, fileId: null, notes: input.notes?.trim() || null, active: true,
  });
  await audit(ctx, { module: "accounting", action: "certificate.known", entityType: "accounting_certificate", entityId: row.id, summary: `Certificado de ${client.name} registrado: ${row.productLabel}, válido até ${formatDate(input.validTo)}`, after: { validTo: input.validTo, serial: row.serial }, related: [`accounting_client:${client.id}`] });
  return row;
}

export async function listKnownCertificates(ctx: Ctx, f: { clientId?: string | null; attention?: boolean } = {}): Promise<KnownCertificate[]> {
  requirePerm(ctx, "accounting", "view");
  const visible = await visibleClientIds(ctx);
  const clientFilters: any[] = [["eq", "companyId", ctx.companyId]];
  const clients = (await listAll(ctx.store, "accounting_clients", { filters: clientFilters }, 5000)).filter((c) => (!visible || visible.has(c.id)) && (!f.clientId || c.id === f.clientId));
  const byId = new Map(clients.map((c) => [c.id, c]));
  const requests = (await listAll(ctx.store, "certificate_requests", { filters: [["eq", "companyId", ctx.companyId]] }, 5000)).filter((r) => byId.has(r.clientId) && requestIsOpen(r));
  const openByClient = new Map<string, Doc>();
  for (const r of requests) if (!openByClient.has(r.clientId) || String(r.createdAt) > String(openByClient.get(r.clientId)!.createdAt)) openByClient.set(r.clientId, r);
  const ref = today();
  const out: KnownCertificate[] = [];
  const known = (await listAll(ctx.store, "accounting_certificates", { filters: [["eq", "companyId", ctx.companyId]] }, 5000)).filter((k) => k.active !== false && byId.has(k.clientId));
  for (const k of known) {
    const open = openByClient.get(k.clientId);
    out.push({ id: k.id, clientId: k.clientId, clientName: byId.get(k.clientId)!.name, holderDoc: k.holderDoc ?? null, productLabel: k.productLabel ?? "Certificado digital", serial: k.serial ?? null, issuer: k.issuer ?? null, validFrom: k.validFrom ?? null, validTo: k.validTo ?? null, ...validityOf(k.validTo, ref), source: k.source === "issued" ? "issued" : "manual", requestId: k.requestId ?? null, openRequest: open ? { id: open.id, protocol: open.protocol, status: open.status } : null });
  }
  // certificado de emissão fiscal das empresas vinculadas (leitura autorizada pelo titular)
  const { linkedCompanyReader } = await import("./link");
  const { certificateDaysLeft } = await import("../fiscal/config");
  for (const c of clients) {
    if (c.linkStatus !== "active" || !c.linkedCompanyId) continue;
    if (!(await certificateTrackingAuthorized(ctx.store, c.linkedCompanyId))) continue;
    const reader = await linkedCompanyReader(ctx, c).catch(() => null);
    if (!reader) continue;
    const cfgs = await listAll(reader, "fiscal_configs", { filters: [["eq", "companyId", c.linkedCompanyId]] });
    for (const cfg of cfgs) {
      if (!cfg.certificate?.validTo) continue;
      const branch = cfg.branchId ? await reader.get("branches", cfg.branchId) : null;
      const validTo = String(cfg.certificate.validTo).slice(0, 10);
      const open = openByClient.get(c.id);
      out.push({ id: `erp:${cfg.id}`, clientId: c.id, clientName: c.name, holderDoc: cfg.certificate.cnpj ?? c.doc ?? null, productLabel: "Certificado A1 de emissão fiscal", serial: cfg.certificate.serial ?? null, issuer: cfg.certificate.issuer ?? null, validFrom: cfg.certificate.validFrom ? String(cfg.certificate.validFrom).slice(0, 10) : null, validTo, daysLeft: certificateDaysLeft(cfg.certificate, ref), validity: validityOf(validTo, ref).validity, source: "erp", requestId: null, openRequest: open ? { id: open.id, protocol: open.protocol, status: open.status } : null, branchName: branch?.name ?? (cfg.branchId ? "Filial" : "Empresa") });
    }
  }
  const rows = f.attention ? out.filter((k) => k.validity === "expired" || k.validity === "due_soon") : out;
  return rows.sort((a, b) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999) || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

/** Indicadores da Tela 67 e do painel da carteira. */
export async function certificateOverview(ctx: Ctx): Promise<{ needRenewal: number; awaitingPayment: number; overdueCharges: number; readyToDownload: number; open: number; awaitingAuthorization: number }> {
  const [known, requests] = await Promise.all([listKnownCertificates(ctx, { attention: true }), listCertificateRequests(ctx, { status: "open" })]);
  const ref = today();
  return {
    needRenewal: new Set(known.map((k) => k.clientId)).size,
    awaitingPayment: requests.filter((r) => r.status === "awaiting_payment").length,
    overdueCharges: requests.filter((r) => requestDisplayStatus(r, ref) === "overdue").length,
    readyToDownload: requests.filter((r) => r.status === "ready_to_download").length,
    awaitingAuthorization: requests.filter((r) => r.status === "awaiting_authorization").length,
    open: requests.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fila da equipe e lado da empresa

export async function listCertificationQueue(ctx: Ctx, f: { status?: string | null; firmId?: string | null } = {}): Promise<Array<Doc & { firmName: string }>> {
  requireAction(ctx, "certification.operate");
  const base = unscoped(ctx.store);
  const filters: any[] = [];
  if (f.firmId) filters.push(["eq", "companyId", f.firmId]);
  const rows = await listAll(base, "certificate_requests", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] }, 10000);
  const ref = today();
  const firms = new Map<string, string>();
  const out: Array<Doc & { firmName: string }> = [];
  for (const r of rows) {
    if (f.status && !(f.status === "open" ? requestIsOpen(r) : f.status === "overdue" ? requestDisplayStatus(r, ref) === "overdue" : r.status === f.status)) continue;
    if (!firms.has(r.companyId)) firms.set(r.companyId, (await base.get("companies", r.companyId))?.tradeName || (await base.get("companies", r.companyId))?.name || "Escritório");
    out.push({ ...r, firmName: firms.get(r.companyId)! });
  }
  return out;
}

export async function teamCertificateRequest(ctx: Ctx, id: string): Promise<Doc & { firmName: string }> {
  requireAction(ctx, "certification.operate");
  const base = unscoped(ctx.store);
  const r = await base.get("certificate_requests", id);
  if (!r) throw new BusinessError("Solicitação não encontrada.", "not_found");
  const firm = await base.get("companies", r.companyId);
  return { ...r, firmName: firm?.tradeName || firm?.name || "Escritório" };
}

/** Empresa vinculada: solicitações de certificado abertas pelo escritório para ela (acompanhamento e autorização). */
export async function companyCertificateRequests(store: Store, companyId: string): Promise<Doc[]> {
  return listAll(unscoped(store), "certificate_requests", { filters: [["eq", "linkedCompanyId", companyId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 500);
}

// ---------------------------------------------------------------------------------------------------------------------
// Alertas diários do escritório (rotina)

export async function notifyCertificateDeadlines(store: Store, firmId: string, ref = today()): Promise<{ alerts: number }> {
  const firm = await unscoped(store).get("companies", firmId);
  if (!firm || firm.kind !== "accounting") return { alerts: 0 };
  const { systemCtx } = await import("@/lib/core/ctx");
  const ctx = systemCtx(store, firmId);
  const known = await listKnownCertificates(ctx, { attention: true });
  const clients = new Map((await listAll(ctx.store, "accounting_clients", { filters: [["eq", "companyId", firmId]] }, 5000)).map((c) => [c.id, c]));
  let alerts = 0;
  for (const k of known) {
    const days = k.daysLeft ?? 0;
    const band = days < 0 ? "expired" : days <= 7 ? "7" : "30";
    const responsible = clients.get(k.clientId)?.responsibleUserId ?? null;
    alerts += await notify(store, {
      companyId: firmId, type: "deadline", priority: days < 0 ? "critical" : days <= 7 ? "high" : "normal",
      title: days < 0 ? `Certificado VENCIDO — ${k.clientName}` : `Certificado de ${k.clientName} vence em ${days} dia(s)`,
      body: `${k.productLabel}${k.branchName ? ` (${k.branchName})` : ""} · validade ${formatDate(k.validTo)}. ${k.openRequest ? `Solicitação em andamento: ${k.openRequest.protocol}.` : "Abra a renovação em Certificados digitais."}`,
      link: k.openRequest ? `/contabil/certificados/${k.openRequest.id}` : `/contabil/certificados?tab=validades&cliente=${k.clientId}`,
      originType: "accounting_client", originId: k.clientId, occurrenceKey: `cert-validity:${k.id}:${k.validTo}:${band}`,
      audience: responsible ? { userIds: [responsible] } : { module: "accounting" },
    }).catch(() => 0);
  }
  const overdue = await listCertificateRequests(ctx, { status: "overdue" });
  for (const r of overdue) {
    alerts += await notify(store, {
      companyId: firmId, type: "receivable_overdue", priority: "high", title: `Cobrança do certificado vencida — ${r.protocol} (${r.holderName})`,
      body: `${formatMoney(r.amount)}, vencimento ${formatDate(r.dueDate)}. Atualize o vencimento e reenvie ao cliente, ou cancele a solicitação.`,
      link: `/contabil/certificados/${r.id}`, originType: "certificate_request", originId: r.id, occurrenceKey: `cert-overdue:${r.id}:${r.dueDate}`,
      audience: r.responsibleUserId ? { userIds: [r.responsibleUserId] } : { module: "accounting" },
    }).catch(() => 0);
  }
  return { alerts };
}

