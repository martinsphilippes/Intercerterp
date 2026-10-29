import { detId, findOne, isConflict, listAll } from "@/lib/db";
import { ConflictError, type Doc, type Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { nextNumber } from "@/lib/core/numbering";
import { notify } from "@/lib/core/notify";
import { formatDoc, isValidCnpj, isValidCpf, onlyDigits } from "@/lib/core/text";
import { addDays, diffDays, formatDate, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { CERT_OPEN_STATUSES, CERT_STATUS_LABEL, type CertStatus } from "../accounting/common";
import { certificationSettings, isNetworkSale, isOwnerActor, requestDisplayStatus, type CertProduct } from "../accounting/certificates";
import { NETWORK_SCOPE, isPlatform, networkSettings, networkViewer, nodeOfCompany } from "./common";
import { cascadeChain } from "./prices";
import { maskCascade, quotePrice, sellerView, type CascadeSnapshot, type MaskedCascade, type PriceQuote } from "./cascade";
import { applicableCoupon, ensureHolderCounter, releaseCouponUse, reserveCouponInTx } from "./coupons";
import { redeemableLots, redeemInTx, reverseRedemption, usableVoucherCode, voucherBalances } from "./vouchers";
import { afterSaleOpened, buildSalePlan, prepareSaleFinance, saleFinanceInTx, walletConflictMessage } from "./ledger";

/**
 * Venda de certificado pela rede (§45).
 *
 * O parceiro (Master, Regional, Revenda e os vendedores dela) vende pelo MESMO ciclo da Tela 67 (cobrança →
 * confirmação do pagamento → validação do titular → emissão → download): a venda é uma `certificate_requests` com
 * `channel = "network"`, na empresa do parceiro, e o cliente é um cadastro próprio do parceiro (`cert_customers`). Todo
 * o resto do ciclo (equipe de certificação, emissão, download protegido) é o código da Tela 67, sem duplicar regra.
 *
 * Toda venda (do parceiro e do escritório-contador) registra o vendedor na rede e o RETRATO IMUTÁVEL da cascata
 * (`cascade`, ver ./cascade.ts) — base do financeiro em cascata (etapa 3) e das comissões.
 *
 * Visibilidade: o vendedor (sem "network.sales_all") vê só as próprias vendas e clientes; gestor/administrador do nó
 * vê tudo do nó; os níveis acima veem as vendas dos descendentes (consulta, com os custos mascarados); a plataforma vê
 * tudo.
 */

export const DUPLICATE_VALID_DAYS = 60;
const padCustomer = (n: number) => `CL-${String(n).padStart(4, "0")}`;
const padProtocol = (n: number) => `CERT-${String(n).padStart(4, "0")}`;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ------------------------------------------------------------------------------------------------------------ vendedor

/** Nó vendedor da empresa ativa (parceiro ativo, não contador — o contador vende pela Tela 67). */
export async function requireSellerNode(ctx: Ctx): Promise<Doc> {
  requireAction(ctx, "network.sell");
  const node = await nodeOfCompany(ctx.store, ctx.companyId);
  if (!node) throw new BusinessError("Sua empresa não é um parceiro da rede de certificação.", "not_partner");
  if (node.level === "contador") throw new BusinessError("O escritório contador vende pela tela Certificados digitais da carteira.", "firm");
  if (node.status !== "active") throw new BusinessError("Seu nó da rede não está ativo: novas vendas estão bloqueadas.", "inactive");
  return node;
}

const seesAll = (ctx: Ctx) => canDo(ctx.user, "network.sales_all");

// ------------------------------------------------------------------------------------------------------------ clientes

export interface CertCustomerInput {
  personType: "PF" | "PJ";
  doc: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: { street?: string | null; number?: string | null; district?: string | null; cityName?: string | null; uf?: string | null; zip?: string | null } | null;
  hasBirdId?: boolean;
  birdIdValidTo?: string | null;
  notes?: string | null;
}

/** O usuário vê este cliente? (vendedor: os que cadastrou ou para quem já vendeu; quem vê tudo do nó: todos) */
async function customerVisible(ctx: Ctx, c: Doc): Promise<boolean> {
  if (c.companyId !== ctx.companyId) return false;
  if (seesAll(ctx) || isPlatform(ctx)) return true;
  if (c.ownerUserId === ctx.user.id) return true;
  return Boolean(await findOne(ctx.store, "certificate_requests", [["eq", "companyId", ctx.companyId], ["eq", "clientId", c.id], ["eq", "sellerUserId", ctx.user.id]]));
}

export async function getCertCustomer(ctx: Ctx, id: string): Promise<Doc> {
  if (!canDo(ctx.user, "network.sell") && !seesAll(ctx)) throw new PermissionError();
  const c = await ctx.store.get("cert_customers", id);
  if (!c || !(await customerVisible(ctx, c))) throw new BusinessError("Cliente não encontrado.", "not_found");
  return c;
}

export async function listCertCustomers(ctx: Ctx, f: { q?: string | null } = {}): Promise<Doc[]> {
  if (!canDo(ctx.user, "network.sell") && !seesAll(ctx)) throw new PermissionError();
  const rows = await listAll(ctx.store, "cert_customers", { filters: [["eq", "companyId", ctx.companyId]], orderBy: [{ field: "name", dir: "asc" }] }, 20000);
  let visible = rows;
  if (!seesAll(ctx) && !isPlatform(ctx)) {
    const mine = new Set((await listAll(ctx.store, "certificate_requests", { filters: [["eq", "companyId", ctx.companyId], ["eq", "sellerUserId", ctx.user.id]] }, 20000)).map((r) => r.clientId));
    visible = rows.filter((c) => c.ownerUserId === ctx.user.id || mine.has(c.id));
  }
  const q = String(f.q ?? "").trim().toLowerCase();
  const qd = onlyDigits(q);
  return q ? visible.filter((c) => String(c.name).toLowerCase().includes(q) || (qd && String(c.doc).includes(qd)) || String(c.code ?? "").toLowerCase() === q) : visible;
}

export async function saveCertCustomer(ctx: Ctx, id: string | null, input: CertCustomerInput): Promise<Doc> {
  requireAction(ctx, "network.sell");
  const node = await nodeOfCompany(ctx.store, ctx.companyId);
  if (!node || node.level === "contador") throw new BusinessError("Cadastro de clientes de certificado é dos parceiros da rede.", "not_partner");
  const personType = input.personType === "PJ" ? "PJ" : "PF";
  const doc = onlyDigits(input.doc);
  assert(personType === "PF" ? isValidCpf(doc) : isValidCnpj(doc), personType === "PF" ? "CPF inválido: confira os dígitos." : "CNPJ inválido: confira os dígitos.");
  const name = String(input.name ?? "").trim();
  assert(name.length >= 3, "Informe o nome do titular (pessoa) ou a razão social (empresa).");
  const email = String(input.email ?? "").trim().toLowerCase() || null;
  if (email) assert(EMAIL_RE.test(email), "E-mail inválido.");
  const phone = onlyDigits(input.phone) || null;
  if (phone) assert(phone.length >= 10 && phone.length <= 13, "Telefone com DDD (10 ou 11 dígitos).");
  const birdIdValidTo = input.birdIdValidTo && /^\d{4}-\d{2}-\d{2}$/.test(input.birdIdValidTo) ? input.birdIdValidTo : null;
  const address = input.address ? Object.fromEntries(Object.entries(input.address).map(([k, v]) => [k, String(v ?? "").trim() || null])) : null;
  if (address?.uf) assert(/^[A-Za-z]{2}$/.test(String(address.uf)), "UF com 2 letras.");
  const data = { personType, doc, name, email, phone, address, hasBirdId: Boolean(input.hasBirdId) || Boolean(birdIdValidTo), birdIdValidTo, notes: input.notes?.trim()?.slice(0, 1000) || null };
  if (id) {
    const before = await getCertCustomer(ctx, id);
    if (before.doc !== doc) {
      const dup = await findOne(ctx.store, "cert_customers", [["eq", "companyId", ctx.companyId], ["eq", "doc", doc]]);
      if (dup && dup.id !== id) throw new BusinessError(`Já existe cliente com este ${personType === "PF" ? "CPF" : "CNPJ"} no parceiro.`, "duplicate");
    }
    const after: Doc = await ctx.store.update("cert_customers", id, data);
    await audit(ctx, { module: "admin", action: "network.customer_update", entityType: "cert_customer", entityId: id, summary: `Cliente de certificado ${after.code} ${name} alterado`, before: { name: before.name, doc: before.doc, email: before.email, phone: before.phone, hasBirdId: before.hasBirdId }, after: data });
    return after;
  }
  const dup = await findOne(ctx.store, "cert_customers", [["eq", "companyId", ctx.companyId], ["eq", "doc", doc]]);
  if (dup) throw new BusinessError(`Já existe cliente com este ${personType === "PF" ? "CPF" : "CNPJ"} no parceiro${(await customerVisible(ctx, dup)) ? ` (${dup.code} ${dup.name})` : " (cadastrado por outro vendedor — peça ao gestor do parceiro)"}.`, "duplicate");
  const seq = await nextNumber(ctx.store, `cert_customer:${ctx.companyId}`);
  let row: Doc;
  try {
    row = await ctx.store.create("cert_customers", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, code: padCustomer(seq), ...data, ownerUserId: ctx.user.id, nodeId: node.id, active: true });
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Já existe cliente com este documento no parceiro.", "duplicate");
    throw e;
  }
  await audit(ctx, { module: "admin", action: "network.customer_create", entityType: "cert_customer", entityId: row.id, summary: `Cliente de certificado ${row.code} ${name} (${formatDoc(doc)}) cadastrado`, after: data });
  return row;
}

// --------------------------------------------------------------------------------------------------------- duplicidade

export interface DuplicateInfo {
  kind: "certificate" | "request";
  productLabel: string;
  validTo: string | null;
  daysLeft: number | null;
  status: string | null;
  protocol: string | null;
  /** registro da própria empresa (mostra o protocolo e o link) */
  sameCompany: boolean;
  requestId: string | null;
  where: string;
}

/** Tipo comparável de um certificado/produto: tipo (A1/A3/BirdID) + titular (PF/PJ). */
export function certTypeKey(type: string | null | undefined, holder: string | null | undefined, doc?: string | null): { type: string | null; holder: string | null } {
  const h = holder ?? (doc ? (onlyDigits(doc).length === 11 ? "pf" : onlyDigits(doc).length === 14 ? "pj" : null) : null);
  return { type: type ?? null, holder: h };
}

/** Mesmo tipo de certificado? (tipo desconhecido — certificado informado à mão — compara só o titular) */
export function sameCertType(a: { type: string | null; holder: string | null }, b: { type: string | null; holder: string | null }): boolean {
  if (a.holder && b.holder && a.holder !== b.holder) return false;
  if (!a.type || !b.type) return true;
  return a.type === b.type;
}

/**
 * Proteção contra venda repetida: certificado do mesmo tipo/titular válido por MAIS de 60 dias, ou outra solicitação
 * em aberto do mesmo produto para o mesmo documento (em qualquer canal da rede). Renovação antecipada (≤ 60 dias) não
 * avisa. Registros de outra empresa aparecem sem protocolo (só produto e validade).
 */
export async function findDuplicates(store: Store, input: { holderDoc: string; product: CertProduct; viewerCompanyId: string; ignorePreviousId?: string | null; ref?: string }): Promise<DuplicateInfo[]> {
  const doc = onlyDigits(input.holderDoc);
  if (!doc) return [];
  const ref = input.ref ?? today();
  const base = unscoped(store);
  const settings = await certificationSettings(store);
  const want = certTypeKey(input.product.type, input.product.holder, doc);
  const out: DuplicateInfo[] = [];
  for (const c of await listAll(base, "accounting_certificates", { filters: [["eq", "holderDoc", doc]] })) {
    if (c.active === false || !c.validTo) continue;
    const days = diffDays(ref, String(c.validTo).slice(0, 10));
    if (days <= DUPLICATE_VALID_DAYS) continue;
    const p = settings.catalog.find((x) => x.key === c.product);
    if (!sameCertType(want, certTypeKey(c.productType ?? p?.type, c.holderType ?? p?.holder, doc))) continue;
    out.push({ kind: "certificate", productLabel: c.productLabel ?? "Certificado digital", validTo: c.validTo, daysLeft: days, status: null, protocol: null, sameCompany: c.companyId === input.viewerCompanyId, requestId: c.companyId === input.viewerCompanyId ? c.requestId ?? null : null, where: c.companyId === input.viewerCompanyId ? "neste parceiro" : "em outro canal da rede" });
  }
  for (const r of await listAll(base, "certificate_requests", { filters: [["eq", "holderDoc", doc]] })) {
    if (!CERT_OPEN_STATUSES.includes(r.status) || r.product !== input.product.key) continue;
    const same = r.companyId === input.viewerCompanyId;
    out.push({ kind: "request", productLabel: r.productLabel, validTo: null, daysLeft: null, status: r.status, protocol: same ? r.protocol : null, sameCompany: same, requestId: same ? r.id : null, where: same ? "neste parceiro" : "em outro canal da rede" });
  }
  return out;
}

export function describeDuplicate(d: DuplicateInfo): string {
  if (d.kind === "certificate") return `${d.productLabel} válido até ${formatDate(d.validTo)} (${d.daysLeft} dias) ${d.where}`;
  return `solicitação em aberto de ${d.productLabel}${d.protocol ? ` (${d.protocol}, ${CERT_STATUS_LABEL[d.status ?? ""] ?? d.status})` : ""} ${d.where}`;
}

// ------------------------------------------------------------------------------------------------------------- cotação

export interface NetworkSaleInput {
  customerId: string;
  productKey: string;
  /** centavos; null = preço padrão do nó */
  price?: number | null;
  couponCode?: string | null;
  /** usar voucher: do saldo do nó ou por código */
  voucher?: "none" | "balance" | "code" | null;
  voucherCode?: string | null;
  dueDate?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  previousCertificateId?: string | null;
  /** confirmação da venda apesar do aviso de duplicidade (motivo auditado, ≥ 10 caracteres) */
  duplicateReason?: string | null;
  /** §46: contador (nó abaixo do vendedor) que indicou o cliente — comissão de indicação */
  referrerNodeId?: string | null;
  idemKey?: string | null;
}

export interface SaleQuote {
  product: CertProduct;
  free: boolean;
  gift: boolean;
  terms: { cost: number; minPrice: number; defaultPrice: number; canEdit: boolean } | null;
  price: PriceQuote | null;
  coupon: Doc | null;
  voucher: { lot: Doc; code: Doc | null } | null;
  voucherAvailable: number;
  duplicates: DuplicateInfo[];
  freeClaim: Doc | null;
  levels: Array<{ nodeId: string; name: string; level: string; cost: number }>;
  acCost: number | null;
  errors: string[];
}

const freeClaimId = (doc: string) => detId("cert_free_claim", "birdid", doc);

/** Reivindicação de BirdID gratuito ativa? (solicitação em aberto, ou emitido e ainda válido) */
async function activeFreeClaim(store: Store, doc: string, ref = today()): Promise<Doc | null> {
  const claim = await unscoped(store).get("cert_free_claims", freeClaimId(doc));
  if (!claim || claim.status === "released") return null;
  if (claim.status === "issued" && claim.validTo && String(claim.validTo) < ref) return null;
  return claim;
}

/** Cotação da venda (preço, cupom, voucher, avisos) — a mesma régua da tela e do servidor. Não grava nada. */
export async function quoteNetworkSale(ctx: Ctx, node: Doc, customer: Doc, input: NetworkSaleInput): Promise<SaleQuote> {
  const settings = await certificationSettings(ctx.store);
  const product = settings.catalog.find((p) => p.key === input.productKey && p.active);
  if (!product) throw new BusinessError("Produto inválido ou inativo no catálogo.", "product");
  const errors: string[] = [];
  const ref = today();
  const free = product.free === true;
  const duplicates = await findDuplicates(ctx.store, { holderDoc: customer.doc, product, viewerCompanyId: ctx.companyId, ref });
  const base: SaleQuote = { product, free, gift: false, terms: null, price: null, coupon: null, voucher: null, voucherAvailable: 0, duplicates, freeClaim: null, levels: [], acCost: null, errors };
  if (free) {
    if (product.type !== "birdid" || customer.personType !== "PF") errors.push("A venda gratuita é do BirdID de pessoa física (CPF).");
    if (input.couponCode || (input.voucher && input.voucher !== "none")) errors.push("Venda gratuita não usa cupom nem voucher.");
    const claim = await activeFreeClaim(ctx.store, customer.doc, ref);
    if (claim) {
      base.freeClaim = claim;
      errors.push(claim.status === "issued" ? `Este CPF já tem um BirdID gratuito ativo (válido até ${formatDate(claim.validTo)}). Limite: um BirdID gratuito ativo por titular.` : "Este CPF já tem um BirdID gratuito em andamento. Limite: um BirdID gratuito ativo por titular.");
    }
    const ids = [...(node.path ?? []), node.id];
    const v = await networkViewer(ctx);
    base.levels = ids.map((id) => { const n = v.nodes.find((x) => x.id === id); return { nodeId: id, name: n?.name ?? "—", level: n?.level ?? "", cost: 0 }; });
    base.acCost = 0;
    base.price = { requestedPrice: 0, discount: 0, capped: false, belowMin: 0, finalPrice: 0, errors: [] };
    base.terms = { cost: 0, minPrice: 0, defaultPrice: 0, canEdit: false };
    return base;
  }
  const chain = await cascadeChain(ctx.store, node.id, product.key, ref);
  if (!chain) {
    errors.push(`Seu nó ainda não tem preço da rede para ${product.label}: fale com o parceiro acima.`);
    return base;
  }
  const mine = chain.levels[chain.levels.length - 1];
  base.terms = { cost: mine.cost, minPrice: mine.minPrice, defaultPrice: mine.defaultPrice, canEdit: mine.canEdit };
  base.levels = chain.levels.map((l) => ({ nodeId: l.nodeId, name: l.name, level: l.level, cost: l.cost }));
  base.acCost = chain.acCost;
  // voucher
  const mode = input.voucher ?? "none";
  base.voucherAvailable = (await voucherBalances(ctx.store, node.id, ref)).products.find((p) => p.productKey === product.key)?.available ?? 0;
  if (mode === "code") {
    try {
      const { code, lot } = await usableVoucherCode(ctx.store, input.voucherCode ?? "", node.id, product.key, ref);
      base.voucher = { lot, code };
      base.gift = code.gift === true;
    } catch (e: any) {
      errors.push(e.message);
    }
  } else if (mode === "balance") {
    const lots = await redeemableLots(ctx.store, node.id, product.key, ref);
    if (!lots.length) errors.push(`Sem saldo de voucher disponível para ${product.label}.`);
    else base.voucher = { lot: lots[0], code: null };
  }
  // cupom
  if (input.couponCode?.trim()) {
    try {
      base.coupon = await applicableCoupon(ctx.store, input.couponCode, { sellerNode: node, sellerUserId: ctx.user.id, productKey: product.key, date: ref });
      if (base.coupon.maxPerHolder) {
        const h = await unscoped(ctx.store).get("cert_coupon_holders", detId("cert_coupon_holder", base.coupon.id, customer.doc));
        if (h && Number(h.count ?? 0) >= base.coupon.maxPerHolder) errors.push(`Cupom ${base.coupon.code}: este titular já usou o limite de ${base.coupon.maxPerHolder} vez(es).`);
      }
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  base.price = quotePrice({ ...base.terms, requested: input.price ?? null, gift: base.gift, coupon: base.coupon ? { kind: base.coupon.kind, valueBps: base.coupon.valueBps, valueCents: base.coupon.valueCents, issuedAbove: base.coupon.issuerNodeId !== node.id } : null }, formatMoney);
  errors.push(...base.price.errors);
  return base;
}

/** Retrato da cascata a partir da cotação (gravado na venda). */
function snapshotOf(node: Doc, q: SaleQuote, extra: { redemptionId: string | null; issuerName: string | null }): CascadeSnapshot {
  const t = q.terms ?? { cost: 0, minPrice: 0, defaultPrice: 0, canEdit: false };
  const finalPrice = q.price?.finalPrice ?? 0;
  const c = q.coupon;
  return {
    version: 1, date: today(), productKey: q.product.key, productLabel: q.product.label, acCost: q.acCost, levels: q.levels,
    sellerNodeId: node.id, sellerCost: t.cost, listPrice: t.defaultPrice, minPrice: t.minPrice, canEdit: t.canEdit, requestedPrice: q.price?.requestedPrice ?? 0, finalPrice,
    // com voucher, o custo do vendedor foi o preço unitário pago antecipadamente no pacote
    sellerMargin: finalPrice - (q.voucher ? Number(q.voucher.lot.unitPrice) : t.cost),
    coupon: c ? { id: c.id, code: c.code, issuerNodeId: c.issuerNodeId ?? null, issuerName: extra.issuerName ?? "Intercert (plataforma)", discount: q.price?.discount ?? 0, capped: Boolean(q.price?.capped), belowMin: q.price?.belowMin ?? 0, absorbedByNodeId: c.issuerNodeId ?? null } : null,
    voucher: q.voucher && extra.redemptionId ? { redemptionId: extra.redemptionId, lotId: q.voucher.lot.id, purchaseId: q.voucher.lot.purchaseId, packageId: q.voucher.lot.packageId, packageName: q.voucher.lot.packageName, unitPrice: Number(q.voucher.lot.unitPrice), soldByNodeId: q.voucher.lot.sellerNodeId ?? null, code: q.voucher.code?.code ?? null, gift: q.gift } : null,
    costCovered: Boolean(q.voucher), free: q.free,
  };
}

function boundsMessage(e: ConflictError, q: SaleQuote): string | null {
  if (e.collection === "cert_coupons") return `Cupom ${q.coupon?.code}: atingiu o limite de ${q.coupon?.maxUses} uso(s) agora há pouco.`;
  if (e.collection === "cert_coupon_holders") return `Cupom ${q.coupon?.code}: este titular já usou o limite de ${q.coupon?.maxPerHolder} vez(es).`;
  if (e.collection === "cert_free_claims") return "Este CPF já tem um BirdID gratuito em andamento ou ativo.";
  if (e.collection === "counters") return "Este código de voucher acabou de ser usado em outra venda.";
  return null;
}

/** Cria a venda da rede (idempotente pela chave do formulário). */
export async function createNetworkSale(ctx: Ctx, input: NetworkSaleInput): Promise<Doc> {
  const node = await requireSellerNode(ctx);
  const idem = String(input.idemKey ?? "").trim();
  assert(idem, "Chave da operação ausente: recarregue a tela.");
  const id = detId("cert_sale", ctx.companyId, idem);
  const base = unscoped(ctx.store);
  const existing = await base.get("certificate_requests", id);
  if (existing) return existing;
  const customer = await getCertCustomer(ctx, input.customerId);
  if (customer.active === false) throw new BusinessError("Cliente inativo.", "inactive");
  let q = await quoteNetworkSale(ctx, node, customer, input);
  if (q.errors.length) throw new BusinessError(q.errors.join(" "), "quote");
  const reason = String(input.duplicateReason ?? "").trim();
  if (q.duplicates.length && reason.length < 10) {
    throw new BusinessError(`Atenção — possível venda repetida para ${customer.name}: ${q.duplicates.map(describeDuplicate).join("; ")}. Para continuar, confirme informando o motivo (ao menos 10 caracteres).`, "duplicate");
  }
  const noCharge = q.free || q.gift;
  let dueDate: string | null = null;
  if (!noCharge) {
    dueDate = input.dueDate || addDays(today(), 5);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate >= today(), "O vencimento da cobrança não pode ser anterior a hoje.");
  }
  let previousCertificateId: string | null = null;
  if (input.previousCertificateId) {
    const prev = await base.get("accounting_certificates", input.previousCertificateId);
    assert(prev && prev.companyId === ctx.companyId && onlyDigits(prev.holderDoc) === customer.doc, "Certificado anterior não pertence a este cliente.");
    previousCertificateId = prev!.id;
  }
  const contactEmail = (input.contactEmail ?? customer.email ?? "").trim().toLowerCase() || null;
  if (contactEmail) assert(EMAIL_RE.test(contactEmail), "E-mail de contato inválido.");
  const v = await networkViewer(ctx);
  const issuerName = q.coupon?.issuerNodeId ? (v.nodes.find((n) => n.id === q.coupon!.issuerNodeId)?.name ?? null) : null;
  // §46: indicação — um contador abaixo do vendedor, ativo
  let referrer: { nodeId: string; name: string } | null = null;
  if (input.referrerNodeId) {
    const rn = v.nodes.find((n) => n.id === input.referrerNodeId);
    if (!rn || !(rn.path ?? []).includes(node.id) || rn.level !== "contador") throw new BusinessError("Indicação: escolha um escritório contador da sua rede (abaixo do seu nó).", "referrer");
    if (rn.status !== "active") throw new BusinessError(`${rn.name} não está ativo na rede: não pode receber comissão de indicação.`, "referrer");
    referrer = { nodeId: rn.id, name: rn.name };
  }
  const settingsNet = await networkSettings(ctx.store);
  // contador por titular (criado antes; a reserva incrementa com o limite dentro da transação)
  const holderCounterId = q.coupon ? await ensureHolderCounter(ctx.store, q.coupon.id, customer.doc) : null;
  const seq = await nextNumber(ctx.store, `cert_request:${ctx.companyId}`);
  const redemptionId = q.voucher ? detId("cert_voucher_redemption", id) : null;
  // resgate pelo saldo: tenta os lotes vigentes do que vence primeiro (outro vendedor pode ter esgotado um lote agora)
  const candidates = q.voucher && !q.voucher.code ? (await redeemableLots(ctx.store, node.id, q.product.key)).slice(0, 5) : [null];
  let row: Doc | null = null;
  for (let attempt = 0; attempt < candidates.length && !row; attempt++) {
    if (candidates[attempt]) q = { ...q, voucher: { lot: candidates[attempt]!, code: null } };
    const cascade = snapshotOf(node, q, { redemptionId, issuerName });
    const finalPrice = cascade.finalPrice;
    // §46: plano de liquidação em camadas (modalidades vigentes) e conferência do saldo pré-pago antes da transação
    const plan = await buildSalePlan(ctx.store, cascade, { referrer });
    await prepareSaleFinance(ctx.store, plan, node.id);
    const collectorCompanyId = plan.collectorNodeId ? (v.nodes.find((n) => n.id === plan.collectorNodeId)?.nodeCompanyId ?? null) : settingsNet.platformCompanyId;
    const claim = q.free ? await unscoped(ctx.store).get("cert_free_claims", freeClaimId(customer.doc)) : null;
    // outra venda gratuita pode ter sido gravada depois da cotação: reivindicação ativa recusa (a liberada/vencida é reaproveitada)
    if (claim && (await activeFreeClaim(ctx.store, customer.doc))) throw new BusinessError("Este CPF já tem um BirdID gratuito em andamento ou ativo. Limite: um BirdID gratuito ativo por titular.", "free_limit");
    try {
      row = await base.transaction(async (tx) => {
        const r = await tx.create("certificate_requests", {
          companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId: customer.id, customerId: customer.id, protocol: padProtocol(seq), kind: previousCertificateId ? "renewal" : "new", product: q.product.key, productLabel: q.product.label, months: q.product.months,
          holderName: customer.name, holderDoc: customer.doc, linkedCompanyId: null, contactEmail, contactPhone: onlyDigits(input.contactPhone) || customer.phone || null, amount: finalPrice, dueDate: dueDate ?? today(),
          status: (noCharge ? "validation" : "awaiting_payment") satisfies CertStatus, responsibleUserId: ctx.user.id, previousCertificateId, notes: input.notes?.trim()?.slice(0, 1000) || null,
          chargeSends: 0, emissionAttempts: 0, downloads: 0, downloadAuthorized: false, validationStatus: "pending",
          ...(noCharge ? { paymentConfirmedAt: nowIso(), paymentRef: q.free ? "SEM COBRANÇA — BirdID gratuito" : "SEM COBRANÇA — voucher presente", paymentBy: ctx.user.id } : {}),
          channel: "network", sellerNodeId: node.id, sellerUserId: ctx.user.id, sellerName: ctx.user.name, cascade: sellerView(cascade), listPrice: cascade.listPrice, minPrice: cascade.minPrice, discount: cascade.coupon?.discount ?? 0,
          couponId: q.coupon?.id ?? null, couponCode: q.coupon?.code ?? null, voucherRedemptionId: redemptionId, voucherCode: q.voucher?.code?.code ?? null, gift: q.gift, free: q.free,
          duplicateAck: q.duplicates.length ? { reason, by: ctx.user.id, byName: ctx.user.name, at: nowIso(), matches: q.duplicates.map(describeDuplicate) } : null,
          productType: q.product.type ?? null, holderType: q.product.holder ?? null, referrerNodeId: referrer?.nodeId ?? null, referrerName: referrer?.name ?? null,
        }, id);
        await tx.create("cert_sale_cascades", { companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, requestId: id, requestCompanyId: ctx.companyId, sellerNodeId: node.id, snapshot: cascade }, cascadeId(id));
        await saleFinanceInTx(tx, { request: { id, companyId: ctx.companyId, protocol: padProtocol(seq), productKey: q.product.key, productLabel: q.product.label, sellerNodeId: node.id }, pathNodeIds: cascade.levels.map((l) => l.nodeId), plan, collectorCompanyId, referrer, userId: ctx.user.id, userName: ctx.user.name });
        if (q.voucher) await redeemInTx(tx, { lot: q.voucher.lot, code: q.voucher.code, requestId: id, requestCompanyId: ctx.companyId, gift: q.gift, userId: ctx.user.id });
        if (q.coupon) await reserveCouponInTx(tx, q.coupon, { requestId: id, requestCompanyId: ctx.companyId, holderDoc: customer.doc, discount: cascade.coupon?.discount ?? 0, sellerNodeId: node.id, holderCounterId });
        if (q.free) {
          const data = { holderDoc: customer.doc, productType: "birdid", requestId: id, requestCompanyId: ctx.companyId, validTo: null, status: "open" };
          // sem reivindicação (ou já liberada/vencida): a criação com id determinístico garante um único BirdID gratuito por CPF
          if (claim) {
            await tx.create("counters", { key: `once:free_claim:${claim.id}:${claim.requestId}`, value: 1 }, detId("once", "free_claim", claim.id, String(claim.requestId)));
            await tx.update("cert_free_claims", claim.id, data);
          } else await tx.create("cert_free_claims", { companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, ...data }, freeClaimId(customer.doc));
        }
        return r;
      });
    } catch (e) {
      if (e instanceof ConflictError) {
        const again = await base.get("certificate_requests", id);
        if (again) return again; // repetição do mesmo formulário
        if (e.collection === "cert_voucher_lots" && attempt + 1 < candidates.length) continue;
        if (e.collection === "cert_voucher_lots") throw new BusinessError(`Saldo de voucher esgotado para ${q.product.label}.`, "voucher");
        const wmsg = walletConflictMessage(e);
        if (wmsg) throw new BusinessError(wmsg, "wallet_insufficient");
        const msg = boundsMessage(e, q);
        if (msg) throw new BusinessError(msg, "limit");
      }
      throw e;
    }
  }
  if (!row) throw new BusinessError(`Saldo de voucher esgotado para ${q.product.label}.`, "voucher");
  // §46: título do cliente na empresa de quem cobra (e, sem cobrança, os lançamentos de todas as camadas)
  await afterSaleOpened(ctx, row);
  const c = (await saleCascade(ctx.store, row.id))!;
  await audit(ctx, {
    module: "admin", action: "network.sale", entityType: "certificate_request", entityId: row.id,
    summary: `Venda ${row.protocol} de ${q.product.label} para ${customer.name} (${formatDoc(customer.doc)}) — ${q.free ? "GRATUITA (BirdID)" : q.gift ? "voucher presente (R$ 0)" : formatMoney(c.finalPrice)}${!q.free ? ` · custo ${formatMoney(c.sellerCost)}, margem ${formatMoney(c.sellerMargin)}` : ""}${c.coupon ? ` · cupom ${c.coupon.code} (−${formatMoney(c.coupon.discount)}, emitido por ${c.coupon.issuerName})` : ""}${c.voucher ? ` · voucher do pacote ${c.voucher.packageName} (custo pré-pago ${formatMoney(c.voucher.unitPrice)})` : ""}`,
    after: { product: q.product.key, finalPrice: c.finalPrice, sellerNodeId: node.id, cascade: sellerView(c) }, related: [`cert_customer:${customer.id}`, `cert_network_node:${node.id}`],
  });
  if (row.duplicateAck) {
    await audit(ctx, { module: "admin", action: "network.sale_duplicate_ack", entityType: "certificate_request", entityId: row.id, summary: `Venda ${row.protocol} confirmada apesar do aviso de duplicidade: ${row.duplicateAck.matches.join("; ")}`, reason, related: [`cert_customer:${customer.id}`] });
  }
  if (noCharge) {
    await notify(unscoped(ctx.store), {
      companyId: ctx.companyId, type: "info", priority: "normal", title: `${q.free ? "BirdID gratuito" : "Voucher presente"} — ${row.protocol} (${customer.name})`, body: "Sem cobrança: agende a validação do titular.",
      link: `/administracao/certificacao/${row.id}`, originType: "certificate_request", originId: row.id, occurrenceKey: `cert-team:${row.id}:nocharge`, audience: { action: "certification.operate" },
    }).catch(() => 0);
  }
  return row;
}

// ----------------------------------------------------------------------------------------------- ganchos do ciclo da Tela 67

/** Emissão registrada de uma venda da rede: BirdID marca o titular; o BirdID gratuito guarda a validade (limite por CPF). */
export async function onNetworkSaleIssued(store: Store, r: Doc, input: { validTo: string }): Promise<void> {
  const base = unscoped(store);
  if (r.productType === "birdid" && r.customerId) {
    const c = await base.get("cert_customers", r.customerId);
    if (c) await base.update("cert_customers", c.id, { hasBirdId: true, birdIdValidTo: !c.birdIdValidTo || String(c.birdIdValidTo) < input.validTo ? input.validTo : c.birdIdValidTo });
  }
  if (r.free && r.holderDoc) {
    const claim = await base.get("cert_free_claims", freeClaimId(r.holderDoc));
    if (claim && claim.requestId === r.id) await base.update("cert_free_claims", claim.id, { status: "issued", validTo: input.validTo });
  }
}

/** Venda cancelada antes do pagamento: estorna o resgate do voucher, libera o cupom e o BirdID gratuito (idempotente). */
export async function onSaleCancelled(ctx: Ctx, r: Doc): Promise<void> {
  const done: string[] = [];
  if (r.voucherRedemptionId && (await reverseRedemption(ctx.store, r.id, ctx.user.id))) done.push("resgate do voucher estornado (a unidade voltou ao saldo)");
  if (r.couponId && (await releaseCouponUse(ctx.store, r))) done.push(`uso do cupom ${r.couponCode} liberado`);
  if (r.free && r.holderDoc) {
    const base = unscoped(ctx.store);
    const claim = await base.get("cert_free_claims", freeClaimId(r.holderDoc));
    if (claim && claim.requestId === r.id && claim.status === "open") {
      await base.update("cert_free_claims", claim.id, { status: "released" });
      done.push("BirdID gratuito do CPF liberado");
    }
  }
  if (done.length) {
    const base = unscoped(ctx.store);
    await base.create("audit_logs", {
      companyId: r.companyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: ctx.companyId === r.companyId ? (ctx.user.roleName ?? null) : "Equipe de certificação", module: "admin", action: "network.sale_reversal",
      entityType: "certificate_request", entityId: r.id, summary: `Cancelamento de ${r.protocol}: ${done.join("; ")}`, before: null, after: null, reason: r.cancelReason ?? null, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [`certificate_request:${r.id}`],
    }).catch(() => undefined);
  }
}

/**
 * Tela 67: escritório que é nó CONTADOR vende pelo preço da rede. Devolve null quando o escritório não está na rede
 * (mantém o catálogo). Recusa preço fora da regra (fixo, abaixo do mínimo) e produto sem preço na rede.
 */
export async function firmNetworkPricing(ctx: Ctx, product: CertProduct, requested: number | null): Promise<{ amount: number; cascade: CascadeSnapshot; sellerView: MaskedCascade } | null> {
  const node = await nodeOfCompany(ctx.store, ctx.companyId);
  if (!node) return null;
  if (node.status !== "active") throw new BusinessError("Seu escritório não está ativo na rede de certificação: novas solicitações estão bloqueadas. Fale com a revenda.", "inactive");
  const chain = await cascadeChain(ctx.store, node.id, product.key);
  if (!chain) throw new BusinessError(`Sem preço da rede para ${product.label} no seu escritório: fale com a revenda acima.`, "price");
  const mine = chain.levels[chain.levels.length - 1];
  const q = quotePrice({ cost: mine.cost, minPrice: mine.minPrice, defaultPrice: mine.defaultPrice, canEdit: mine.canEdit, requested }, formatMoney);
  if (q.errors.length) throw new BusinessError(q.errors.join(" "), "price");
  const cascade: CascadeSnapshot = {
    version: 1, date: today(), productKey: product.key, productLabel: product.label, acCost: chain.acCost, levels: chain.levels.map((l) => ({ nodeId: l.nodeId, name: l.name, level: l.level, cost: l.cost })),
    sellerNodeId: node.id, sellerCost: mine.cost, listPrice: mine.defaultPrice, minPrice: mine.minPrice, canEdit: mine.canEdit, requestedPrice: q.requestedPrice, finalPrice: q.finalPrice, sellerMargin: q.finalPrice - mine.cost,
    coupon: null, voucher: null, costCovered: false, free: false,
  };
  return { amount: q.finalPrice, cascade, sellerView: sellerView(cascade) };
}

/**
 * §46 — Tela 67 do escritório que é nó CONTADOR: grava a solicitação, o retrato completo e o plano de liquidação na
 * MESMA transação, com a reserva do custo nas carteiras pré-pagas (sem saldo, a solicitação é recusada); depois, o
 * título do cliente na empresa de quem cobra.
 */
export async function createFirmNetworkRequest(ctx: Ctx, data: Record<string, any>, cascade: CascadeSnapshot): Promise<Doc> {
  const plan = await buildSalePlan(ctx.store, cascade);
  await prepareSaleFinance(ctx.store, plan, cascade.sellerNodeId);
  const v = await networkViewer(ctx);
  const collectorCompanyId = plan.collectorNodeId ? (v.nodes.find((n) => n.id === plan.collectorNodeId)?.nodeCompanyId ?? null) : (await networkSettings(ctx.store)).platformCompanyId;
  let row: Doc;
  try {
    row = await unscoped(ctx.store).transaction(async (tx) => {
      const r = await tx.create("certificate_requests", data);
      await tx.create("cert_sale_cascades", { companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, requestId: r.id, requestCompanyId: ctx.companyId, sellerNodeId: cascade.sellerNodeId, snapshot: cascade }, cascadeId(r.id));
      await saleFinanceInTx(tx, { request: { id: r.id, companyId: ctx.companyId, protocol: String(data.protocol), productKey: cascade.productKey, productLabel: cascade.productLabel, sellerNodeId: cascade.sellerNodeId }, pathNodeIds: cascade.levels.map((l) => l.nodeId), plan, collectorCompanyId, userId: ctx.user.id, userName: ctx.user.name });
      return r;
    });
  } catch (e) {
    const msg = e instanceof ConflictError ? walletConflictMessage(e) : null;
    if (msg) throw new BusinessError(msg, "wallet_insufficient");
    throw e;
  }
  await afterSaleOpened(ctx, row);
  return row;
}

/** Termos de preço da rede do escritório-contador para a tela (null = fora da rede). */
export async function firmNetworkTerms(store: Store, companyId: string): Promise<Map<string, { cost: number; minPrice: number; defaultPrice: number; canEdit: boolean }> | null> {
  const node = await nodeOfCompany(store, companyId);
  if (!node) return null;
  const settings = await certificationSettings(store);
  const out = new Map<string, { cost: number; minPrice: number; defaultPrice: number; canEdit: boolean }>();
  for (const p of settings.catalog.filter((x) => x.active && !x.free)) {
    const chain = await cascadeChain(store, node.id, p.key);
    const mine = chain?.levels[chain.levels.length - 1];
    if (mine) out.set(p.key, { cost: mine.cost, minPrice: mine.minPrice, defaultPrice: mine.defaultPrice, canEdit: mine.canEdit });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- retrato da cascata

const cascadeId = (requestId: string) => detId("cert_sale_cascade", requestId);

/** Retrato completo de uma venda (registro da plataforma; só o domínio lê e mascara para quem olha). */
export async function saleCascade(store: Store, requestId: string): Promise<CascadeSnapshot | null> {
  const d = await unscoped(store).get("cert_sale_cascades", cascadeId(requestId));
  return (d?.snapshot as CascadeSnapshot) ?? null;
}

async function saleCascades(store: Store, requestIds: string[]): Promise<Map<string, CascadeSnapshot>> {
  const out = new Map<string, CascadeSnapshot>();
  for (let i = 0; i < requestIds.length; i += 100) {
    const chunk = requestIds.slice(i, i + 100);
    if (!chunk.length) continue;
    for (const d of await listAll(unscoped(store), "cert_sale_cascades", { filters: [["eq", "requestId", chunk]] })) out.set(d.requestId, d.snapshot as CascadeSnapshot);
  }
  return out;
}

/** Grava o retrato completo de uma venda do escritório-contador (Tela 67) — idempotente pelo id da solicitação. */
export async function saveFirmSaleCascade(store: Store, request: Doc, snapshot: CascadeSnapshot, userId: string): Promise<void> {
  try {
    await unscoped(store).create("cert_sale_cascades", { companyId: NETWORK_SCOPE, branchId: null, createdBy: userId, requestId: request.id, requestCompanyId: request.companyId, sellerNodeId: snapshot.sellerNodeId, snapshot }, cascadeId(request.id));
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
}

// ------------------------------------------------------------------------------------------------------- leitura das vendas

export interface SaleFilter {
  status?: string | null;
  nodeId?: string | null;
  sellerUserId?: string | null;
  productKey?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface SaleRow {
  request: Doc;
  displayStatus: string;
  nodeName: string;
  level: string;
  /** venda da própria empresa (opera o ciclo) */
  own: boolean;
  masked: MaskedCascade | null;
}

/** Quem pode consultar as vendas da rede (vendedor, quem vê o nó, plataforma). */
function assertSalesReader(ctx: Ctx, platform: boolean) {
  if (!platform && !canDo(ctx.user, "network.sell") && !seesAll(ctx)) throw new PermissionError();
}

function saleVisible(ctx: Ctx, r: Doc, v: Awaited<ReturnType<typeof networkViewer>>): boolean {
  if (v.platform) return true;
  if (!v.myNode || !r.sellerNodeId || !v.visible.has(r.sellerNodeId)) return false;
  if (r.sellerNodeId === v.myNode.id) return seesAll(ctx) || r.sellerUserId === ctx.user.id;
  return seesAll(ctx); // descendentes: consulta de quem vê todo o nó
}

export async function listNetworkSales(ctx: Ctx, f: SaleFilter = {}): Promise<SaleRow[]> {
  const v = await networkViewer(ctx);
  assertSalesReader(ctx, v.platform);
  if (!v.platform && !v.myNode) return [];
  const filters: any[] = v.platform ? [["notNull", "sellerNodeId"]] : [["eq", "sellerNodeId", [...v.visible]]];
  const rows = await listAll(unscoped(ctx.store), "certificate_requests", { filters, orderBy: [{ field: "createdAt", dir: "desc" }] }, 20000);
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const ref = today();
  const q = String(f.q ?? "").trim().toLowerCase();
  const qd = onlyDigits(q);
  const subtree = f.nodeId ? new Set(v.nodes.filter((n) => n.id === f.nodeId || (n.path ?? []).includes(f.nodeId!)).map((n) => n.id)) : null;
  const out: SaleRow[] = [];
  for (const r of rows) {
    if (!saleVisible(ctx, r, v)) continue;
    const display = requestDisplayStatus(r, ref);
    if (f.status && !(f.status === "open" ? CERT_OPEN_STATUSES.includes(r.status) : f.status === "issued" ? ["awaiting_authorization", "ready_to_download", "downloaded"].includes(r.status) : display === f.status || r.status === f.status)) continue;
    if (subtree && !subtree.has(r.sellerNodeId)) continue;
    if (f.sellerUserId && r.sellerUserId !== f.sellerUserId) continue;
    if (f.productKey && r.product !== f.productKey) continue;
    if (f.from && String(r.createdAt).slice(0, 10) < f.from) continue;
    if (f.to && String(r.createdAt).slice(0, 10) > f.to) continue;
    if (q && !(String(r.holderName).toLowerCase().includes(q) || String(r.protocol).toLowerCase().includes(q) || (qd && String(r.holderDoc ?? "").includes(qd)))) continue;
    const node = byId.get(r.sellerNodeId);
    out.push({ request: r, displayStatus: display, nodeName: node?.name ?? "—", level: node?.level ?? "", own: r.companyId === ctx.companyId, masked: null });
  }
  // retratos completos (plataforma) mascarados para quem olha; sem o completo, a visão do vendedor gravada na venda
  const full = await saleCascades(ctx.store, out.map((x) => x.request.id));
  for (const x of out) {
    const f = full.get(x.request.id);
    x.masked = f ? maskCascade(f, { platform: v.platform, myNodeId: v.myNode?.id ?? null }) : ((x.request.cascade as MaskedCascade | null) ?? null);
  }
  return out;
}

export async function getNetworkSale(ctx: Ctx, id: string): Promise<SaleRow & { canOperate: boolean }> {
  const v = await networkViewer(ctx);
  assertSalesReader(ctx, v.platform);
  const r = await unscoped(ctx.store).get("certificate_requests", id);
  if (!r || !r.sellerNodeId || !saleVisible(ctx, r, v)) throw new BusinessError("Venda não encontrada.", "not_found");
  const node = v.nodes.find((n) => n.id === r.sellerNodeId);
  return {
    request: r, displayStatus: requestDisplayStatus(r), nodeName: node?.name ?? "—", level: node?.level ?? "", own: r.companyId === ctx.companyId,
    masked: await (async () => {
      const f = await saleCascade(ctx.store, r.id);
      return f ? maskCascade(f, { platform: v.platform, myNodeId: v.myNode?.id ?? null }) : ((r.cascade as MaskedCascade | null) ?? null);
    })(),
    canOperate: isNetworkSale(r) && isOwnerActor(ctx, r),
  };
}

/** Indicadores da lista de vendas do parceiro. */
export function salesSummary(rows: SaleRow[]) {
  const sum = (xs: SaleRow[]) => xs.reduce((a, r) => a + Number(r.request.amount ?? 0), 0);
  const notCancelled = rows.filter((r) => r.request.status !== "cancelled");
  return {
    count: notCancelled.length,
    total: sum(notCancelled),
    awaitingPayment: rows.filter((r) => r.request.status === "awaiting_payment").length,
    validation: rows.filter((r) => ["validation", "ready_to_issue", "issuing", "issue_failed"].includes(r.request.status)).length,
    issued: rows.filter((r) => ["awaiting_authorization", "ready_to_download", "downloaded"].includes(r.request.status)).length,
  };
}

/** Parâmetro: dias antes do vencimento para o alerta "ninguém agiu" (padrão 7). */
export async function idleAlertDays(store: Store): Promise<number> {
  return (await networkSettings(store)).idleAlertDays;
}
