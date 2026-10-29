import { randomBytes } from "node:crypto";
import { detId, findOne, isConflict, listAll } from "@/lib/db";
import { ConflictError, type Doc, type Store } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { nextNumber } from "@/lib/core/numbering";
import { notify } from "@/lib/core/notify";
import { addDays, formatDate, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { certificationSettings } from "../accounting/certificates";
import { NETWORK_SCOPE, auditNetwork, isPlatform, networkViewer } from "./common";
import { effectivePrice } from "./prices";

/**
 * Vouchers da rede de certificação (§45).
 *
 * PACOTE: oferta criada por um nó (ou pela plataforma) para vender aos nós abaixo — nome, vigência, itens
 * (produto × quantidade × preço unitário) e destinatário opcional. COMPRA: o nó comprador compra (ou o vendedor do
 * pacote atribui a um nó abaixo); cada item vira um SALDO por produto (`cert_voucher_lots`), opcionalmente com
 * códigos individuais. RESGATE na venda: consome 1 unidade do produto do vendedor e o custo daquela unidade fica
 * COBERTO (pré-pago) — o retrato da venda registra o pacote e o preço unitário. VOUCHER PRESENTE: código entregue ao
 * cliente final; a venda com ele sai a R$ 0.
 *
 * Saldo SEMPRE calculado (nunca digitado): por lote, `committed` (resgatado + reservado em códigos) só cresce com
 * limite atômico (`max: qty` — dois resgates simultâneos nunca passam do comprado); disponível = comprado −
 * comprometido enquanto vigente; vencido = comprado − resgatado (o que sobrou expira). O resgate é idempotente
 * (um por venda, id determinístico) e é estornado uma única vez quando a venda é cancelada antes do pagamento.
 */

export interface VoucherItemInput {
  productKey: string;
  qty: number;
  /** centavos por unidade */
  unitPrice: number;
}

export interface VoucherPackageInput {
  name: string;
  validFrom?: string | null;
  validTo: string;
  items: VoucherItemInput[];
  recipientNodeId?: string | null;
  notes?: string | null;
}

const padPkg = (n: number) => `PV-${String(n).padStart(4, "0")}`;

/** Lote vigente na data? */
export function lotValid(l: Doc | Record<string, any>, ref = today()): boolean {
  return !l.validTo || String(l.validTo) >= ref;
}

/** Saldo de um lote (função pura). */
export function lotBalance(l: Doc | Record<string, any>, ref = today()) {
  const qty = Number(l.qty ?? 0);
  const committed = Number(l.committed ?? 0);
  const redeemed = Number(l.redeemed ?? 0);
  const reserved = Number(l.reserved ?? 0);
  const valid = lotValid(l, ref);
  return { qty, redeemed, reserved: valid ? reserved : 0, expired: valid ? 0 : Math.max(0, qty - redeemed), available: valid ? Math.max(0, qty - committed) : 0, valid };
}

export async function createVoucherPackage(ctx: Ctx, input: VoucherPackageInput): Promise<Doc> {
  const platform = isPlatform(ctx);
  if (!platform) requireAction(ctx, "network.vouchers");
  const v = await networkViewer(ctx);
  const owner = platform ? null : v.myNode;
  if (!platform) {
    if (!owner) throw new PermissionError("Sua empresa não é um parceiro da rede de certificação.");
    if (owner.status !== "active") throw new BusinessError("Seu nó da rede não está ativo.", "inactive");
    if (owner.level === "contador") throw new BusinessError("O contador é o último nível da rede: não vende pacotes a ninguém abaixo.", "level");
  }
  const name = String(input.name ?? "").trim();
  assert(name.length >= 3 && name.length <= 120, "Informe o nome do pacote (3 a 120 caracteres).");
  const validFrom = input.validFrom || today();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(validFrom) && /^\d{4}-\d{2}-\d{2}$/.test(input.validTo ?? ""), "Informe a vigência do pacote.");
  assert(input.validTo > validFrom && input.validTo >= today(), "A vigência final precisa ser posterior ao início e não pode estar no passado.");
  const items = (input.items ?? []).filter((i) => i && i.productKey);
  assert(items.length > 0, "Inclua ao menos um item (produto, quantidade e preço unitário).");
  assert(new Set(items.map((i) => i.productKey)).size === items.length, "Produto repetido nos itens: some as quantidades numa linha só.");
  const settings = await certificationSettings(ctx.store);
  const clean: VoucherItemInput[] = [];
  for (const it of items) {
    const p = settings.catalog.find((x) => x.key === it.productKey && x.active);
    assert(p && !p.free, `Produto ${it.productKey} inválido para voucher.`);
    const qty = Math.round(Number(it.qty));
    const unitPrice = Math.round(Number(it.unitPrice));
    assert(Number.isInteger(qty) && qty >= 1 && qty <= 10000, `${p!.label}: quantidade de 1 a 10.000.`);
    assert(Number.isInteger(unitPrice) && unitPrice > 0, `${p!.label}: informe o preço unitário.`);
    // quem vende o pacote não vende abaixo do próprio custo (a plataforma, abaixo do custo AC)
    const floor = owner ? (await effectivePrice(ctx.store, owner.id, p!.key))?.cost : Number(p!.acCost ?? 0);
    if (owner && floor == null) throw new BusinessError(`${p!.label}: seu nó ainda não tem preço deste produto na rede.`, "price");
    assert(unitPrice >= (floor ?? 0), `${p!.label}: o preço unitário (${formatMoney(unitPrice)}) não pode ficar abaixo do seu custo (${formatMoney(floor ?? 0)}).`);
    clean.push({ productKey: p!.key, qty, unitPrice });
  }
  let recipientNodeId: string | null = input.recipientNodeId || null;
  if (recipientNodeId) {
    const r = v.nodes.find((n) => n.id === recipientNodeId);
    assert(r && r.id !== owner?.id && (platform || (r.path ?? []).includes(owner!.id)), "O destinatário precisa ser um parceiro abaixo de quem vende o pacote.");
  } else recipientNodeId = null;
  const seq = await nextNumber(ctx.store, `cert_voucher_package:${NETWORK_SCOPE}`);
  const total = clean.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  const pkg = await unscoped(ctx.store).create("cert_voucher_packages", {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, code: padPkg(seq), ownerNodeId: owner?.id ?? null, sellerCompanyId: owner ? owner.nodeCompanyId : ctx.companyId, name, validFrom, validTo: input.validTo,
    items: clean, total, recipientNodeId, active: true, notes: input.notes?.trim()?.slice(0, 500) || null,
  });
  await auditNetwork(ctx, owner, { action: "network.voucher_package", summary: `Pacote de vouchers ${pkg.code} “${name}” criado: ${clean.length} item(ns), total ${formatMoney(total)}, vigência ${formatDate(validFrom)} a ${formatDate(input.validTo)}`, after: { items: clean, total, recipientNodeId }, related: [`cert_voucher_package:${pkg.id}`] });
  return pkg;
}

export async function setVoucherPackageActive(ctx: Ctx, id: string, active: boolean): Promise<Doc> {
  const pkg = await unscoped(ctx.store).get("cert_voucher_packages", id);
  if (!pkg) throw new BusinessError("Pacote não encontrado.", "not_found");
  const v = await networkViewer(ctx);
  if (!v.platform && !(canDo(ctx.user, "network.vouchers") && pkg.ownerNodeId && pkg.ownerNodeId === v.myNode?.id)) throw new PermissionError("Só quem vende o pacote pode alterá-lo.");
  const after = await unscoped(ctx.store).update("cert_voucher_packages", id, { active });
  await auditNetwork(ctx, v.nodes.find((n) => n.id === pkg.ownerNodeId) ?? null, { action: active ? "network.voucher_package_on" : "network.voucher_package_off", summary: `Pacote ${pkg.code} ${active ? "reaberto para compra" : "encerrado para novas compras"} (os saldos já comprados continuam válidos)` });
  return after;
}

/** Pacotes que o usuário vê: os que o nó vende e os oferecidos a ele (pelos ancestrais ou pela plataforma). */
export async function listVoucherPackages(ctx: Ctx): Promise<Array<Doc & { ownerName: string; recipientName: string | null; mine: boolean; buyable: boolean }>> {
  const v = await networkViewer(ctx);
  if (!v.platform && !canDo(ctx.user, "network.vouchers") && !canDo(ctx.user, "network.sales_all")) throw new PermissionError();
  const rows = await listAll(unscoped(ctx.store), "cert_voucher_packages", { filters: [["eq", "companyId", NETWORK_SCOPE]] });
  const my = v.myNode;
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const ref = today();
  return rows
    .filter((p) => v.platform || (my && (p.ownerNodeId === my.id || ((p.ownerNodeId == null || (my.path ?? []).includes(p.ownerNodeId)) && (!p.recipientNodeId || p.recipientNodeId === my.id)))))
    .map((p) => ({
      ...p,
      ownerName: p.ownerNodeId == null ? "Intercert (plataforma)" : v.platform || v.visible.has(p.ownerNodeId) || p.ownerNodeId === my?.parentNodeId ? (byId.get(p.ownerNodeId)?.name ?? "—") : "Parceiro acima na rede",
      recipientName: p.recipientNodeId ? (byId.get(p.recipientNodeId)?.name ?? null) : null,
      mine: v.platform ? p.ownerNodeId == null : p.ownerNodeId === my?.id,
      buyable: Boolean(my && p.ownerNodeId !== my.id && p.active !== false && p.validFrom <= ref && p.validTo >= ref && canDo(ctx.user, "network.vouchers")),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function newCode(prefix: string) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[b[i] % alphabet.length];
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Categoria financeira pelo nome (as empresas da rede nascem com as categorias de certificação). */
async function categoryByName(store: Store, companyId: string, name: string): Promise<string | null> {
  const c = await findOne(unscoped(store), "fin_categories", [["eq", "companyId", companyId], ["eq", "name", name]]);
  return c?.id ?? null;
}

/**
 * Lança a compra do pacote no financeiro das duas pontas: a receber em quem vende o pacote e a pagar em quem compra
 * (títulos idempotentes pela compra). Falha de lançamento (ex.: período fechado) não desfaz a compra: fica anotada na
 * compra para o financeiro lançar manualmente.
 */
async function postPurchaseFinance(ctx: Ctx, purchase: Doc, seller: { companyId: string | null; name: string }, buyer: { companyId: string; name: string }): Promise<{ receivableTitleId: string | null; payableTitleId: string | null; note: string | null }> {
  const { createTitle } = await import("../finance");
  const base = unscoped(ctx.store);
  const due = addDays(today(), 7);
  const out = { receivableTitleId: null as string | null, payableTitleId: null as string | null, note: null as string | null };
  const notes: string[] = [];
  const ctxIn = async (companyId: string): Promise<Ctx> => {
    const branch = await findOne(base, "branches", [["eq", "companyId", companyId]]);
    return { ...ctx, companyId, branchId: branch?.id ?? null, store: scopeStore(base, companyId) };
  };
  const sellerCompany = seller.companyId ? await base.get("companies", seller.companyId) : null;
  if (sellerCompany && sellerCompany.kind === "certification") {
    try {
      const t = await createTitle(await ctxIn(sellerCompany.id), {
        kind: "receivable", partyType: "other", partyId: buyer.companyId, partyName: buyer.name, description: `Pacote de vouchers ${purchase.packageName} — ${buyer.name}`, originType: "cert_voucher_purchase", originId: purchase.id,
        categoryId: await categoryByName(ctx.store, sellerCompany.id, "Vendas aos parceiros abaixo na rede"), installments: [{ dueDate: due, amount: purchase.total }], idemKey: `cert_voucher_purchase:${purchase.id}:receivable`,
      });
      out.receivableTitleId = t.id;
    } catch (e: any) {
      notes.push(`A receber não lançado: ${e?.message ?? e}`);
    }
  } else notes.push("Vendedor do pacote sem empresa de parceiro da rede: a receber não lançado.");
  try {
    const t = await createTitle(await ctxIn(buyer.companyId), {
      kind: "payable", partyType: "other", partyId: seller.companyId, partyName: seller.name, description: `Pacote de vouchers ${purchase.packageName} — ${seller.name}`, originType: "cert_voucher_purchase", originId: purchase.id,
      categoryId: await categoryByName(ctx.store, buyer.companyId, "Custo de certificados (compra do nível acima)"), installments: [{ dueDate: due, amount: purchase.total }], idemKey: `cert_voucher_purchase:${purchase.id}:payable`,
    });
    out.payableTitleId = t.id;
  } catch (e: any) {
    notes.push(`A pagar não lançado: ${e?.message ?? e}`);
  }
  out.note = notes.length ? notes.join(" ").slice(0, 300) : null;
  return out;
}

export interface PurchaseInput {
  /** nó comprador; padrão = o nó de quem compra (quem vende o pacote informa o nó abaixo ao atribuir) */
  buyerNodeId?: string | null;
  /** gerar um código individual por unidade */
  generateCodes?: boolean;
  idemKey: string;
}

/** Compra (pelo nó de baixo) ou atribuição (por quem vende o pacote) — gera os saldos por produto. Idempotente. */
export async function purchaseVoucherPackage(ctx: Ctx, packageId: string, input: PurchaseInput): Promise<{ purchase: Doc; lots: Doc[]; codes: number }> {
  const base = unscoped(ctx.store);
  const pkg = await base.get("cert_voucher_packages", packageId);
  if (!pkg) throw new BusinessError("Pacote não encontrado.", "not_found");
  const v = await networkViewer(ctx);
  const platform = v.platform;
  if (!platform) requireAction(ctx, "network.vouchers");
  const buyerNodeId = input.buyerNodeId || v.myNode?.id || null;
  assert(buyerNodeId, "Escolha o parceiro comprador.");
  const buyer = v.nodes.find((n) => n.id === buyerNodeId);
  if (!buyer || (!platform && !v.visible.has(buyer.id))) throw new BusinessError("Parceiro comprador não encontrado.", "not_found");
  const assigning = buyer.id !== v.myNode?.id;
  // compra pelo próprio nó: o pacote vem de um ancestral (ou da plataforma); atribuição: quem vende o pacote (ou a plataforma) a um nó abaixo
  if (assigning && !platform && pkg.ownerNodeId !== v.myNode?.id) throw new PermissionError("Só quem vende o pacote pode atribuí-lo a um parceiro abaixo.");
  if (pkg.ownerNodeId && pkg.ownerNodeId !== buyer.id && !(buyer.path ?? []).includes(pkg.ownerNodeId)) throw new BusinessError("O pacote só pode ser comprado por parceiros abaixo de quem o vende.", "scope");
  if (pkg.ownerNodeId === buyer.id) throw new BusinessError("O nó não compra o próprio pacote.", "scope");
  if (pkg.recipientNodeId && pkg.recipientNodeId !== buyer.id) throw new BusinessError("Este pacote é destinado a outro parceiro.", "scope");
  if (buyer.status !== "active") throw new BusinessError(`${buyer.name} não está ativo na rede.`, "inactive");
  const ref = today();
  if (pkg.active === false) throw new BusinessError("Pacote encerrado para novas compras.", "inactive");
  if (pkg.validFrom > ref || pkg.validTo < ref) throw new BusinessError(`Pacote fora da vigência (${formatDate(pkg.validFrom)} a ${formatDate(pkg.validTo)}).`, "validity");
  const idem = String(input.idemKey ?? "").trim();
  assert(idem, "Chave da operação ausente.");
  const purchaseId = detId("cert_voucher_purchase", pkg.id, buyer.id, idem);
  const existing = await base.get("cert_voucher_purchases", purchaseId);
  if (existing) return { purchase: existing, lots: await listAll(base, "cert_voucher_lots", { filters: [["eq", "purchaseId", purchaseId]] }), codes: 0 };
  const items: VoucherItemInput[] = pkg.items ?? [];
  const seller = pkg.ownerNodeId ? v.nodes.find((n) => n.id === pkg.ownerNodeId) : null;
  const sellerCompanyId = seller ? seller.nodeCompanyId : pkg.sellerCompanyId ?? null;
  const sellerName = seller?.name ?? "Intercert (plataforma)";
  const lots: Doc[] = [];
  let codes = 0;
  let purchase: Doc;
  try {
    purchase = await base.transaction(async (tx) => {
      const p = await tx.create("cert_voucher_purchases", {
        companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, packageId: pkg.id, packageName: pkg.name, sellerNodeId: pkg.ownerNodeId ?? null, sellerCompanyId, buyerNodeId: buyer.id, buyerCompanyId: buyer.nodeCompanyId,
        total: Number(pkg.total ?? items.reduce((a, i) => a + i.qty * i.unitPrice, 0)), validTo: pkg.validTo, items, notes: assigning ? `Atribuído por ${ctx.user.name}` : null,
      }, purchaseId);
      for (const it of items) {
        const lotId = detId("cert_voucher_lot", purchaseId, it.productKey);
        const withCodes = Boolean(input.generateCodes);
        lots.push(await tx.create("cert_voucher_lots", {
          companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, purchaseId, packageId: pkg.id, packageName: pkg.name, sellerNodeId: pkg.ownerNodeId ?? null, buyerNodeId: buyer.id, productKey: it.productKey,
          qty: it.qty, committed: withCodes ? it.qty : 0, redeemed: 0, reserved: withCodes ? it.qty : 0, unitPrice: it.unitPrice, validTo: pkg.validTo,
        }, lotId));
        if (withCodes) {
          for (let n = 1; n <= it.qty; n++) {
            await tx.create("cert_voucher_codes", { companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, lotId, buyerNodeId: buyer.id, code: newCode("V"), productKey: it.productKey, gift: false, status: "available", issuedAt: nowIso() }, detId("cert_voucher_code", lotId, n));
            codes++;
          }
        }
      }
      return p;
    });
  } catch (e) {
    if (isConflict(e)) {
      const again = await base.get("cert_voucher_purchases", purchaseId);
      if (again) return { purchase: again, lots: await listAll(base, "cert_voucher_lots", { filters: [["eq", "purchaseId", purchaseId]] }), codes: 0 };
    }
    throw e;
  }
  const buyerCompany = await base.get("companies", buyer.nodeCompanyId);
  const fin = await postPurchaseFinance(ctx, purchase, { companyId: sellerCompanyId, name: sellerName }, { companyId: buyer.nodeCompanyId, name: buyerCompany?.tradeName || buyerCompany?.name || buyer.name });
  purchase = await base.update("cert_voucher_purchases", purchase.id, { receivableTitleId: fin.receivableTitleId, payableTitleId: fin.payableTitleId, financeNote: fin.note });
  await auditNetwork(ctx, buyer, {
    action: "network.voucher_purchase",
    summary: `${assigning ? "Pacote atribuído" : "Pacote comprado"}: ${pkg.code} “${pkg.name}” para ${buyer.name} — ${items.map((i) => `${i.qty} × ${i.productKey} a ${formatMoney(i.unitPrice)}`).join(", ")}; total ${formatMoney(purchase.total)}${codes ? `; ${codes} código(s) individuais` : ""}${fin.note ? ` (${fin.note})` : ""}`,
    after: { packageId: pkg.id, total: purchase.total, receivableTitleId: fin.receivableTitleId, payableTitleId: fin.payableTitleId }, related: [`cert_voucher_purchase:${purchase.id}`],
  });
  if (assigning) {
    await notify(base, {
      companyId: buyer.nodeCompanyId, type: "info", priority: "normal", title: `Pacote de vouchers recebido: ${pkg.name}`, body: `Atribuído por ${sellerName}. Total ${formatMoney(purchase.total)} lançado em contas a pagar. Saldos em Rede › Vouchers.`,
      link: "/rede/vouchers", originType: "cert_voucher_purchase", originId: purchase.id, occurrenceKey: `voucher-purchase:${purchase.id}`, audience: { action: "network.vouchers" },
    }).catch(() => 0);
  }
  return { purchase, lots, codes };
}

export interface ProductBalance {
  productKey: string;
  bought: number;
  redeemed: number;
  reserved: number;
  expired: number;
  available: number;
  /** próximo vencimento com saldo disponível */
  nextValidTo: string | null;
}

/** Saldos de vouchers de um nó por produto (sempre calculados). */
export async function voucherBalances(store: Store, nodeId: string, ref = today()): Promise<{ products: ProductBalance[]; lots: Doc[] }> {
  const lots = await listAll(unscoped(store), "cert_voucher_lots", { filters: [["eq", "buyerNodeId", nodeId]] });
  const by = new Map<string, ProductBalance>();
  for (const l of lots) {
    const b = lotBalance(l, ref);
    const row = by.get(l.productKey) ?? { productKey: l.productKey, bought: 0, redeemed: 0, reserved: 0, expired: 0, available: 0, nextValidTo: null };
    row.bought += b.qty;
    row.redeemed += b.redeemed;
    row.reserved += b.reserved;
    row.expired += b.expired;
    row.available += b.available;
    if (b.available > 0 && (!row.nextValidTo || String(l.validTo) < row.nextValidTo)) row.nextValidTo = l.validTo;
    by.set(l.productKey, row);
  }
  return { products: [...by.values()], lots };
}

/** Lotes candidatos ao resgate (vigentes, com saldo), do que vence primeiro. */
export async function redeemableLots(store: Store, nodeId: string, productKey: string, ref = today()): Promise<Doc[]> {
  const lots = await listAll(unscoped(store), "cert_voucher_lots", { filters: [["eq", "buyerNodeId", nodeId], ["eq", "productKey", productKey]] });
  return lots.filter((l) => lotBalance(l, ref).available > 0).sort((a, b) => String(a.validTo).localeCompare(String(b.validTo)) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Código de voucher utilizável pelo nó na venda (do próprio nó, disponível, lote vigente e produto certo). */
export async function usableVoucherCode(store: Store, rawCode: string, nodeId: string, productKey: string, ref = today()): Promise<{ code: Doc; lot: Doc }> {
  const codeText = String(rawCode ?? "").trim().toUpperCase();
  const code = codeText ? await findOne(unscoped(store), "cert_voucher_codes", [["eq", "code", codeText]]) : null;
  if (!code || code.buyerNodeId !== nodeId) throw new BusinessError(`Código de voucher ${codeText || "(vazio)"} não encontrado no saldo do seu nó.`, "voucher");
  if (code.status !== "available") throw new BusinessError(`Código ${codeText} já ${code.status === "redeemed" ? "foi usado" : "foi cancelado"}.`, "voucher");
  if (code.productKey !== productKey) throw new BusinessError(`Código ${codeText} é de outro produto.`, "voucher");
  const lot = await unscoped(store).get("cert_voucher_lots", code.lotId);
  if (!lot || !lotValid(lot, ref)) throw new BusinessError(`Código ${codeText} venceu em ${formatDate(lot?.validTo)}.`, "voucher");
  return { code, lot };
}

/** Resgate dentro da transação da venda: por saldo (compromete 1 com limite) ou por código (reservado → resgatado). */
export async function redeemInTx(tx: Store, input: { lot: Doc; code: Doc | null; requestId: string; requestCompanyId: string; gift: boolean; userId: string }): Promise<string> {
  const id = detId("cert_voucher_redemption", input.requestId);
  await tx.create("cert_voucher_redemptions", {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: input.userId, lotId: input.lot.id, codeId: input.code?.id ?? null, buyerNodeId: input.lot.buyerNodeId, requestId: input.requestId, requestCompanyId: input.requestCompanyId,
    productKey: input.lot.productKey, unitPrice: input.lot.unitPrice, gift: input.gift, status: "active",
  }, id);
  if (input.code) {
    // o código já estava comprometido (reservado): passa de reservado a resgatado; a trava evita dois usos do mesmo código
    await tx.create("counters", { key: `once:voucher_code:${input.code.id}`, value: 1 }, detId("once", "voucher_code_use", input.code.id));
    await tx.update("cert_voucher_codes", input.code.id, { status: "redeemed", requestId: input.requestId, redeemedAt: nowIso() });
    await tx.increment("cert_voucher_lots", input.lot.id, "reserved", -1, { min: 0 });
  } else {
    await tx.increment("cert_voucher_lots", input.lot.id, "committed", 1, { max: Number(input.lot.qty) });
  }
  await tx.increment("cert_voucher_lots", input.lot.id, "redeemed", 1, { max: Number(input.lot.qty) });
  return id;
}

/** Estorno do resgate (venda cancelada antes do pagamento) — uma única vez. */
export async function reverseRedemption(store: Store, requestId: string, userId: string): Promise<boolean> {
  const base = unscoped(store);
  const red = await base.get("cert_voucher_redemptions", detId("cert_voucher_redemption", requestId));
  if (!red || red.status !== "active") return false;
  try {
    await base.transaction(async (tx) => {
      await tx.create("counters", { key: `once:voucher_reversal:${red.id}`, value: 1 }, detId("once", "voucher_reversal", red.id));
      await tx.update("cert_voucher_redemptions", red.id, { status: "reversed", reversedAt: nowIso(), reversedBy: userId });
      await tx.increment("cert_voucher_lots", red.lotId, "redeemed", -1, { min: 0 });
      if (red.codeId) {
        // o código volta a ficar disponível (reservado no lote); a trava de uso do código é liberada
        await tx.update("cert_voucher_codes", red.codeId, { status: "available", requestId: null, redeemedAt: null });
        await tx.increment("cert_voucher_lots", red.lotId, "reserved", 1);
        await tx.delete("counters", detId("once", "voucher_code_use", red.codeId));
      } else {
        await tx.increment("cert_voucher_lots", red.lotId, "committed", -1, { min: 0 });
      }
    });
  } catch (e) {
    if (isConflict(e)) return false;
    throw e;
  }
  return true;
}

async function lotForManage(ctx: Ctx, lotId: string): Promise<Doc> {
  const lot = await unscoped(ctx.store).get("cert_voucher_lots", lotId);
  if (!lot) throw new BusinessError("Saldo de voucher não encontrado.", "not_found");
  const v = await networkViewer(ctx);
  if (!v.platform && !(canDo(ctx.user, "network.vouchers") && v.myNode?.id === lot.buyerNodeId)) throw new PermissionError("Só o nó dono do saldo emite e cancela códigos.");
  return lot;
}

/** Emite um código (presente ao cliente final ou comum) a partir do saldo de um lote — compromete 1 unidade. */
export async function issueVoucherCode(ctx: Ctx, lotId: string, input: { gift: boolean; notes?: string | null }): Promise<Doc> {
  const lot = await lotForManage(ctx, lotId);
  if (!lotValid(lot)) throw new BusinessError(`Saldo vencido em ${formatDate(lot.validTo)}.`, "validity");
  const base = unscoped(ctx.store);
  const n = await nextNumber(ctx.store, `cert_voucher_code:${lot.id}`);
  const id = detId("cert_voucher_code", lot.id, `x${n}`);
  let code: Doc;
  try {
    code = await base.transaction(async (tx) => {
      await tx.increment("cert_voucher_lots", lot.id, "committed", 1, { max: Number(lot.qty) });
      await tx.increment("cert_voucher_lots", lot.id, "reserved", 1);
      return tx.create("cert_voucher_codes", { companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, lotId: lot.id, buyerNodeId: lot.buyerNodeId, code: newCode(input.gift ? "P" : "V"), productKey: lot.productKey, gift: Boolean(input.gift), status: "available", issuedAt: nowIso(), notes: input.notes?.trim()?.slice(0, 300) || null }, id);
    });
  } catch (e) {
    if (e instanceof ConflictError && e.reason === "bounds") throw new BusinessError("Saldo esgotado neste pacote: não há unidade disponível para um novo código.", "balance");
    throw e;
  }
  const v = await networkViewer(ctx);
  await auditNetwork(ctx, v.nodes.find((x) => x.id === lot.buyerNodeId) ?? null, { action: "network.voucher_code", summary: `Código de voucher ${input.gift ? "PRESENTE (cliente final paga R$ 0) " : ""}${code.code} emitido do pacote ${lot.packageName} (${lot.productKey})`, related: [`cert_voucher_lot:${lot.id}`] });
  return code;
}

/** Cancela um código ainda não usado — a unidade volta ao saldo. */
export async function cancelVoucherCode(ctx: Ctx, codeId: string, reason: string): Promise<Doc> {
  const base = unscoped(ctx.store);
  const code = await base.get("cert_voucher_codes", codeId);
  if (!code) throw new BusinessError("Código não encontrado.", "not_found");
  const lot = await lotForManage(ctx, code.lotId);
  if (code.status !== "available") throw new BusinessError("Só códigos ainda não usados podem ser cancelados.", "status");
  assert(String(reason ?? "").trim().length >= 3, "Informe o motivo do cancelamento do código.");
  let after: Doc;
  try {
    after = await base.transaction(async (tx) => {
      await tx.create("counters", { key: `once:voucher_code:${code.id}`, value: 1 }, detId("once", "voucher_code_use", code.id));
      await tx.increment("cert_voucher_lots", lot.id, "reserved", -1, { min: 0 });
      await tx.increment("cert_voucher_lots", lot.id, "committed", -1, { min: 0 });
      return tx.update("cert_voucher_codes", code.id, { status: "cancelled", cancelledAt: nowIso(), notes: String(reason).trim().slice(0, 300) });
    });
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("O código acabou de ser usado ou cancelado por outra operação.", "conflict");
    throw e;
  }
  const v = await networkViewer(ctx);
  await auditNetwork(ctx, v.nodes.find((x) => x.id === lot.buyerNodeId) ?? null, { action: "network.voucher_code_cancel", summary: `Código de voucher ${code.code} cancelado; a unidade voltou ao saldo`, reason: String(reason).trim() });
  return after;
}

/** Compras de pacotes visíveis: as do próprio nó, as que ele vendeu e (plataforma) todas. */
export async function listVoucherPurchases(ctx: Ctx): Promise<Array<Doc & { buyerName: string; sellerName: string }>> {
  const v = await networkViewer(ctx);
  if (!v.platform && !canDo(ctx.user, "network.vouchers") && !canDo(ctx.user, "network.sales_all")) throw new PermissionError();
  const rows = await listAll(unscoped(ctx.store), "cert_voucher_purchases", { filters: [["eq", "companyId", NETWORK_SCOPE]], orderBy: [{ field: "createdAt", dir: "desc" }] });
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  return rows
    .filter((p) => v.platform || v.visible.has(p.buyerNodeId) || (p.sellerNodeId && p.sellerNodeId === v.myNode?.id))
    .map((p) => ({ ...p, buyerName: byId.get(p.buyerNodeId)?.name ?? "—", sellerName: p.sellerNodeId == null ? "Intercert (plataforma)" : v.platform || v.visible.has(p.sellerNodeId) || p.sellerNodeId === v.myNode?.parentNodeId ? (byId.get(p.sellerNodeId)?.name ?? "—") : "Parceiro acima na rede" }));
}

/** Códigos de um nó (para a tela de vouchers). */
export async function nodeVoucherCodes(store: Store, nodeId: string): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_voucher_codes", { filters: [["eq", "buyerNodeId", nodeId]], orderBy: [{ field: "createdAt", dir: "desc" }] });
}
