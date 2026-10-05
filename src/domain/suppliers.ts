import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { isValidCnpj, isValidCpf, onlyDigits, searchable } from "@/lib/core/text";
import { nowIso, today } from "@/lib/dates";

/**
 * Fornecedores (Tela 26). Identidade única por CPF/CNPJ na empresa (índice `u_doc`), usada
 * por cotação, pedido, recebimento (emitente da NF-e) e contas a pagar (partyId do título).
 * Inativação preserva o histórico; exclusão só sem operações.
 */

export interface SupplierAddress {
  type?: string;
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  cityName?: string;
  cityCode?: string;
  uf?: string;
}

export interface SupplierContact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface SupplierInput {
  personType: "PF" | "PJ";
  doc?: string | null;
  code?: string | null;
  name: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: string | null;
  ie?: string | null;
  im?: string | null;
  addresses?: SupplierAddress[];
  contacts?: SupplierContact[];
  paymentTermId?: string | null;
  paymentTermsText?: string | null;
  leadTimeDays?: number | null;
  minOrderValue?: number | null;
  freightPolicy?: string | null;
  category?: string | null;
  notes?: string | null;
  status?: "draft" | "active" | "inactive" | "blocked";
}

export const SUPPLIER_CATEGORIES = ["Mercadorias", "Logística / fretes", "Serviços", "Tecnologia", "Materiais de uso e consumo", "Embalagens"];

/** Fornecedor apto a novas cotações e pedidos (bloqueado/inativo/docs. pendentes não). */
export function assertSupplierUsable(s: { status?: string | null; tradeName?: string | null; name?: string | null; statusReason?: string | null }) {
  if (s.status === "blocked") throw new BusinessError(`Fornecedor ${s.tradeName || s.name} está bloqueado${s.statusReason ? ` (${s.statusReason})` : ""} — não aceita novas cotações ou pedidos.`, "supplier_blocked");
  if (s.status === "inactive") throw new BusinessError(`Fornecedor ${s.tradeName || s.name} está inativo.`, "supplier_inactive");
  if (s.status === "draft") throw new BusinessError(`Fornecedor ${s.tradeName || s.name} com documentação pendente (rascunho) — complete o cadastro antes de comprar.`, "supplier_draft");
}

export function normalizeSupplierDoc(personType: "PF" | "PJ", doc: string | null | undefined): string | null {
  const d = onlyDigits(doc);
  if (!d) return null;
  if (personType === "PF") assert(d.length === 11 && isValidCpf(d), "CPF inválido.", "invalid_doc");
  else assert(d.length === 14 && isValidCnpj(d), "CNPJ inválido.", "invalid_doc");
  return d;
}

export async function findSupplierByDoc(store: Store, companyId: string, doc: string) {
  const d = onlyDigits(doc);
  if (!d) return null;
  return findOne(store, "suppliers", [["eq", "companyId", companyId], ["eq", "doc", d]]);
}

function buildData(input: SupplierInput, doc: string | null, code: string) {
  const status = input.status ?? "active";
  if (status === "active") assert(doc, `${input.personType === "PF" ? "CPF" : "CNPJ"} é obrigatório para fornecedor ativo (salve como rascunho para completar depois).`);
  assert((input.leadTimeDays ?? 0) >= 0, "Prazo de entrega não pode ser negativo.");
  assert((input.minOrderValue ?? 0) >= 0, "Pedido mínimo não pode ser negativo.");
  return {
    personType: input.personType,
    doc,
    code,
    name: input.name.trim(),
    tradeName: input.tradeName?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    phone: onlyDigits(input.phone) || null,
    ie: input.ie?.trim() || null,
    im: input.im?.trim() || null,
    addresses: (input.addresses ?? []).filter((a) => a.street || a.zip || a.cityName),
    contacts: (input.contacts ?? []).filter((c) => c.name?.trim()),
    paymentTermId: input.paymentTermId || null,
    paymentTermsText: input.paymentTermsText?.trim() || null,
    leadTimeDays: input.leadTimeDays ?? 0,
    minOrderValue: input.minOrderValue ?? 0,
    freightPolicy: input.freightPolicy?.trim() || null,
    category: input.category?.trim() || null,
    notes: input.notes || null,
    status,
    searchText: searchable(input.name, input.tradeName, doc, code, input.email),
  };
}

export async function createSupplier(ctx: Ctx, input: SupplierInput, opts: { source?: string } = {}) {
  requirePerm(ctx, "suppliers", "create");
  assert(input.name?.trim(), "Informe a razão social / nome.");
  const doc = normalizeSupplierDoc(input.personType, input.doc);
  if (doc) {
    const dup = await findSupplierByDoc(ctx.store, ctx.companyId, doc);
    if (dup) throw new BusinessError(`Já existe fornecedor com este ${input.personType === "PF" ? "CPF" : "CNPJ"}: ${dup.tradeName || dup.name}.`, "duplicate", { id: dup.id });
  }
  const seq = await nextNumber(ctx.store, `supplier:${ctx.companyId}`);
  const code = input.code?.trim() || `F${String(seq).padStart(5, "0")}`;
  try {
    const s = await ctx.store.create(
      "suppliers",
      { companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, ...buildData(input, doc, code) },
      doc ? detId("supplier", ctx.companyId, doc) : undefined,
    );
    await audit(ctx, { module: "suppliers", action: "supplier.create", entityType: "supplier", entityId: s.id, summary: `Fornecedor ${s.tradeName || s.name} cadastrado${opts.source ? ` (${opts.source})` : ""}` });
    return s;
  } catch (e) {
    if (isConflict(e) && doc) {
      const dup = await findSupplierByDoc(ctx.store, ctx.companyId, doc);
      throw new BusinessError(`Já existe fornecedor com este documento${dup ? `: ${dup.tradeName || dup.name}` : ""}.`, "duplicate", { id: dup?.id });
    }
    throw e;
  }
}

export async function updateSupplier(ctx: Ctx, id: string, input: SupplierInput) {
  requirePerm(ctx, "suppliers", "edit");
  const before = await ctx.store.getOrThrow("suppliers", id);
  assert(before.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  const doc = normalizeSupplierDoc(input.personType, input.doc);
  if (doc && doc !== before.doc) {
    const dup = await findSupplierByDoc(ctx.store, ctx.companyId, doc);
    if (dup && dup.id !== id) throw new BusinessError(`Documento já usado pelo fornecedor ${dup.tradeName || dup.name}.`, "duplicate", { id: dup.id });
  }
  // situação bloqueado/inativo só muda pelas ações próprias (com motivo)
  const data = buildData({ ...input, status: ["blocked", "inactive"].includes(before.status) && input.status !== "draft" ? before.status : input.status }, doc, input.code?.trim() || before.code);
  try {
    const after = await ctx.store.update("suppliers", id, data);
    const d = diff(before, after);
    if (Object.keys(d.after).length) await audit(ctx, { module: "suppliers", action: "supplier.update", entityType: "supplier", entityId: id, summary: `Cadastro do fornecedor ${after.tradeName || after.name} alterado`, before: d.before, after: d.after });
    return after;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Documento já usado por outro fornecedor.", "duplicate");
    throw e;
  }
}

/** Ativa, inativa ou bloqueia (bloqueio impede novas cotações/pedidos; recebimentos de pedidos já aprovados seguem). */
export async function setSupplierStatus(ctx: Ctx, id: string, status: "active" | "inactive" | "blocked", reason?: string | null) {
  requirePerm(ctx, "suppliers", "edit");
  const s = await ctx.store.getOrThrow("suppliers", id);
  assert(s.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  if (status === "active") assert(s.doc, "Informe o CPF/CNPJ antes de reativar o fornecedor.");
  if (status === "blocked") assert(reason?.trim(), "Informe o motivo do bloqueio.");
  const u = await ctx.store.update("suppliers", id, { status, statusReason: status === "active" ? null : reason?.trim() || null });
  const label = status === "inactive" ? "inativado (histórico preservado)" : status === "blocked" ? "bloqueado para novas compras" : "reativado";
  await audit(ctx, { module: "suppliers", action: `supplier.${status}`, entityType: "supplier", entityId: id, summary: `Fornecedor ${s.tradeName || s.name} ${label}`, reason: reason ?? null });
  return u;
}

export async function deleteSupplier(ctx: Ctx, id: string) {
  requirePerm(ctx, "suppliers", "delete");
  const s = await ctx.store.getOrThrow("suppliers", id);
  assert(s.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  for (const [col, field] of [["purchase_orders", "supplierId"], ["receipts", "supplierId"], ["titles", "partyId"], ["quotation_proposals", "supplierId"]] as const) {
    const r = await ctx.store.list(col, { filters: [["eq", field, id]], limit: 1, total: false });
    if (r.items.length) throw new BusinessError("Fornecedor com operações registradas não pode ser excluído; use Inativar.", "in_use");
  }
  const products = await listAll(ctx.store, "supplier_products", { filters: [["eq", "supplierId", id]] });
  for (const p of products) await ctx.store.delete("supplier_products", p.id);
  await ctx.store.delete("suppliers", id);
  await audit(ctx, { module: "suppliers", action: "supplier.delete", entityType: "supplier", entityId: id, summary: `Fornecedor ${s.tradeName || s.name} excluído (sem operações)`, before: { name: s.name, doc: s.doc } });
}

export function supplierLabel(s: { tradeName?: string | null; name?: string | null } | null | undefined) {
  return s ? s.tradeName || s.name || "—" : "—";
}

/** Retrato do fornecedor gravado em pedidos (identidade comercial na data do pedido). */
export function supplierSnapshot(s: Doc) {
  return { id: s.id, name: s.name, tradeName: s.tradeName, doc: s.doc, email: s.email, phone: s.phone, ie: s.ie, address: s.addresses?.[0] ?? null };
}

// ───────────────────────────── Produtos fornecidos

export interface SupplierProductInput {
  supplierId: string;
  skuId: string;
  supplierCode?: string | null;
  supplierDescription?: string | null;
  /** milésimos de unidade interna por unidade do fornecedor (1000 = 1:1) */
  conversionFactor?: number | null;
  lastCost?: number | null;
  leadTimeDays?: number | null;
  minQty?: number | null;
  multiple?: number | null;
  preferred?: boolean;
}

export const supplierProductId = (supplierId: string, skuId: string) => detId("supprod", supplierId, skuId);

/** Inclui ou altera o vínculo produto × fornecedor (único por par). Preferencial é exclusivo por SKU. */
export async function upsertSupplierProduct(ctx: Ctx, input: SupplierProductInput, opts: { silent?: boolean; reason?: string } = {}) {
  requirePerm(ctx, "suppliers", "edit");
  const supplier = await ctx.store.getOrThrow("suppliers", input.supplierId);
  assert(supplier.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  const sku = await ctx.store.getOrThrow("skus", input.skuId);
  assert(sku.companyId === ctx.companyId, "Produto de outra empresa.");
  for (const [k, v] of [["Custo", input.lastCost], ["Prazo", input.leadTimeDays], ["Lote mínimo", input.minQty], ["Múltiplo", input.multiple]] as const) assert((v ?? 0) >= 0, `${k} não pode ser negativo.`);
  assert((input.conversionFactor ?? 1000) > 0, "Fator de conversão deve ser maior que zero.");
  const existing = (await findOne(ctx.store, "supplier_products", [["eq", "supplierId", input.supplierId], ["eq", "skuId", input.skuId]])) ?? null;
  const data = {
    supplierCode: input.supplierCode?.trim() || null,
    supplierDescription: input.supplierDescription?.trim() || null,
    conversionFactor: input.conversionFactor || 1000,
    lastCost: input.lastCost ?? existing?.lastCost ?? null,
    leadTimeDays: input.leadTimeDays ?? null,
    minQty: input.minQty || null,
    multiple: input.multiple || null,
    preferred: Boolean(input.preferred),
  };
  if (data.supplierCode) {
    const clash = await findOne(ctx.store, "supplier_products", [["eq", "supplierId", input.supplierId], ["eq", "supplierCode", data.supplierCode]]);
    if (clash && clash.skuId !== input.skuId) {
      const other = await ctx.store.get("skus", clash.skuId);
      throw new BusinessError(`O código ${data.supplierCode} deste fornecedor já está vinculado a ${other?.sku ?? clash.skuId}.`, "duplicate");
    }
  }
  let doc: Doc;
  if (existing) doc = await ctx.store.update("supplier_products", existing.id, data);
  else {
    try {
      doc = await ctx.store.create("supplier_products", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, supplierId: input.supplierId, skuId: input.skuId, ...data }, supplierProductId(input.supplierId, input.skuId));
    } catch (e) {
      if (!isConflict(e)) throw e;
      const again = (await findOne(ctx.store, "supplier_products", [["eq", "supplierId", input.supplierId], ["eq", "skuId", input.skuId]]))!;
      doc = await ctx.store.update("supplier_products", again.id, data);
    }
  }
  if (data.preferred) {
    const others = await listAll(ctx.store, "supplier_products", { filters: [["eq", "skuId", input.skuId], ["eq", "preferred", true]] });
    for (const o of others) if (o.id !== doc.id) await ctx.store.update("supplier_products", o.id, { preferred: false });
  }
  if (!opts.silent) {
    const d = diff(existing, doc);
    await audit(ctx, {
      module: "suppliers",
      action: existing ? "supplier_product.update" : "supplier_product.create",
      entityType: "supplier",
      entityId: input.supplierId,
      summary: `${existing ? "Vínculo alterado" : "Produto vinculado"}: ${sku.sku} — ${sku.name ?? ""} (cód. fornecedor ${data.supplierCode ?? "—"})`,
      before: existing ? d.before : undefined,
      after: d.after,
      reason: opts.reason ?? null,
      related: [`sku:${sku.id}`],
    });
  }
  return doc;
}

export async function removeSupplierProduct(ctx: Ctx, id: string) {
  requirePerm(ctx, "suppliers", "edit");
  const sp = await ctx.store.getOrThrow("supplier_products", id);
  assert(sp.companyId === ctx.companyId, "Registro de outra empresa.");
  const sku = await ctx.store.get("skus", sp.skuId);
  await ctx.store.delete("supplier_products", id);
  await audit(ctx, { module: "suppliers", action: "supplier_product.delete", entityType: "supplier", entityId: sp.supplierId, summary: `Vínculo removido: ${sku?.sku ?? sp.skuId}`, before: { supplierCode: sp.supplierCode, lastCost: sp.lastCost } });
}

/** Vínculo produto × fornecedor (ou null). */
export async function getSupplierProduct(store: Store, supplierId: string, skuId: string) {
  return findOne(store, "supplier_products", [["eq", "supplierId", supplierId], ["eq", "skuId", skuId]]);
}

/** Fornecedor preferencial do SKU (preferencial → menor custo recente → qualquer). */
export async function preferredSupplierProduct(store: Store, skuId: string, candidates?: Doc[]) {
  const list = candidates ?? (await listAll(store, "supplier_products", { filters: [["eq", "skuId", skuId]] }));
  if (!list.length) return null;
  return [...list].sort((a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)) || (a.lastCost ?? Infinity) - (b.lastCost ?? Infinity))[0];
}

// ───────────────────────────── Resumo do relacionamento

export async function supplierSummary(ctx: Ctx, supplierId: string) {
  const store = ctx.store;
  const [products, orders, receipts, proposals, installments, titles] = await Promise.all([
    listAll(store, "supplier_products", { filters: [["eq", "supplierId", supplierId]] }),
    listAll(store, "purchase_orders", { filters: [["eq", "supplierId", supplierId]], orderBy: [{ field: "number", dir: "desc" }] }),
    listAll(store, "receipts", { filters: [["eq", "supplierId", supplierId]], orderBy: [{ field: "number", dir: "desc" }] }),
    listAll(store, "quotation_proposals", { filters: [["eq", "supplierId", supplierId]] }),
    listAll(store, "installments", { filters: [["eq", "partyId", supplierId], ["eq", "kind", "payable"]], orderBy: [{ field: "dueDate" }] }),
    listAll(store, "titles", { filters: [["eq", "partyId", supplierId], ["eq", "kind", "payable"]] }),
  ]);
  const skuIds = [...new Set([...products.map((p) => p.skuId)])];
  const skus = new Map<string, Doc>();
  for (let i = 0; i < skuIds.length; i += 100) for (const s of await listAll(store, "skus", { filters: [["eq", "id", skuIds.slice(i, i + 100)]] })) skus.set(s.id, s);
  // custos e prazos recentes: itens dos recebimentos confirmados (mais recentes primeiro)
  const recentCosts: Array<{ receiptId: string; number: number; date: string; skuId: string | null; sku: string; description: string; qty: number; unitCost: number; landedUnitCost: number; leadDays: number | null }> = [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  for (const r of receipts.filter((x) => x.status === "confirmed")) {
    const firstOrder = (r.orderIds ?? []).map((id: string) => orderById.get(id)).find(Boolean);
    const leadDays = firstOrder?.sentAt && r.confirmedAt ? Math.max(0, Math.round((Date.parse(r.confirmedAt) - Date.parse(firstOrder.sentAt)) / 86400000)) : null;
    for (const it of r.items ?? []) {
      if (!it.skuId || !it.receivedQty) continue;
      recentCosts.push({ receiptId: r.id, number: r.number, date: r.confirmedAt, skuId: it.skuId, sku: it.sku ?? "", description: it.description ?? it.xProd ?? "", qty: it.receivedQty, unitCost: it.unitCost, landedUnitCost: it.landedUnitCost ?? it.unitCost, leadDays });
    }
  }
  const t = today();
  const open = installments.filter((i) => ["open", "partial"].includes(i.status));
  const openOrders = orders.filter((o) => ["approved", "sent", "partial"].includes(o.status));
  return {
    products: products.map((p) => ({ ...p, sku: skus.get(p.skuId) })),
    orders,
    openOrders,
    receipts,
    proposals,
    installments,
    titles,
    recentCosts: recentCosts.slice(0, 100),
    openBalance: open.reduce((a, i) => a + i.balance, 0),
    overdueBalance: open.filter((i) => i.dueDate < t).reduce((a, i) => a + i.balance, 0),
    purchasedTotal: receipts.filter((r) => r.status === "confirmed").reduce((a, r) => a + (r.dueTotal ?? r.total ?? 0), 0),
    openOrdersTotal: openOrders.reduce((a, o) => a + Math.max(0, o.total - (o.receivedValue ?? 0)), 0),
    generatedAt: nowIso(),
  };
}

// ───────────────────────────── Desempenho (substitui a "avaliação" manual por indicador medido)

export interface SupplierPerformance {
  receipts: number;
  onTimeRate: number | null; // bps
  conformityRate: number | null; // bps
  /** nota 0–50 (exibir ÷ 10, uma casa) */
  score: number | null;
}

/**
 * Nota de desempenho medida (0 a 5): 60% pontualidade (recebimento confirmado até a previsão do pedido)
 * + 40% conformidade (itens recebidos sem divergência de quantidade/preço/item fora do pedido).
 * Sem recebimentos confirmados → sem nota.
 */
export async function supplierPerformance(store: Store, companyId: string, supplierIds?: string[]): Promise<Map<string, SupplierPerformance>> {
  const filters: any[] = [["eq", "companyId", companyId], ["eq", "status", "confirmed"]];
  if (supplierIds?.length) filters.push(["eq", "supplierId", supplierIds]);
  const receipts = await listAll(store, "receipts", { filters });
  const orderIds = [...new Set(receipts.flatMap((r) => r.orderIds ?? []))];
  const orders = new Map<string, Doc>();
  for (let i = 0; i < orderIds.length; i += 100) for (const o of await listAll(store, "purchase_orders", { filters: [["eq", "id", orderIds.slice(i, i + 100)]] })) orders.set(o.id, o);
  const acc = new Map<string, { n: number; onTime: number; withDate: number; items: number; okItems: number }>();
  for (const r of receipts) {
    const a = acc.get(r.supplierId) ?? { n: 0, onTime: 0, withDate: 0, items: 0, okItems: 0 };
    a.n++;
    const expected = (r.orderIds ?? []).map((id: string) => orders.get(id)?.expectedDate).filter(Boolean).sort()[0];
    if (expected && r.confirmedAt) {
      a.withDate++;
      if (r.confirmedAt.slice(0, 10) <= expected) a.onTime++;
    }
    const div = new Set((r.divergences ?? []).filter((d: any) => ["qty", "price", "not_ordered", "over_order"].includes(d.kind)).map((d: any) => d.idx));
    for (const it of r.items ?? []) {
      if (it.ignore) continue;
      a.items++;
      if (!div.has(it.idx)) a.okItems++;
    }
    acc.set(r.supplierId, a);
  }
  const out = new Map<string, SupplierPerformance>();
  for (const [sid, a] of acc) {
    const onTimeRate = a.withDate ? Math.round((a.onTime * 10000) / a.withDate) : null;
    const conformityRate = a.items ? Math.round((a.okItems * 10000) / a.items) : null;
    const parts = [onTimeRate != null ? { w: 6, v: onTimeRate } : null, conformityRate != null ? { w: 4, v: conformityRate } : null].filter(Boolean) as Array<{ w: number; v: number }>;
    const wsum = parts.reduce((x, p) => x + p.w, 0);
    const score = wsum ? Math.round((parts.reduce((x, p) => x + p.w * p.v, 0) / wsum) * 50 / 10000) : null;
    out.set(sid, { receipts: a.n, onTimeRate, conformityRate, score });
  }
  return out;
}
