import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { allocate, formatMoney, formatQty, roundDiv, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { isFeatureOn } from "@/lib/core/settings";
import { applyOnce, availableMap, balanceId, type MovementInput, type MovementType, postMovements } from "./stock";

/**
 * Kits (CAD-12) e composição/montagem (CAD-13) — coleção única `product_components`.
 *
 *  - **Kit** (`products.composition = "kit"`): vendido como UM item (preço próprio da tabela de preços); não tem
 *    estoque próprio. Na conclusão da venda o estoque baixa os COMPONENTES (`postMovements`, um movimento por
 *    componente) pelo custo médio vigente de cada um; o custo do item vendido (CMV) é a soma desses custos. O
 *    item da venda guarda o retrato dos componentes (`sale_items.components`), usado no cancelamento e na
 *    devolução (componentes voltam pelo custo com que saíram, recompondo o custo médio). Disponível do kit =
 *    mínimo(disponível do componente ÷ quantidade por kit), em unidades inteiras.
 *  - **Composto** (`products.composition = "composite"`): tem estoque próprio. Montar N unidades baixa os
 *    componentes (`assembly_out`) e dá entrada no composto (`assembly_in`) pelo custo somado dos componentes;
 *    desmembrar faz o inverso, repartindo o custo do composto entre os componentes (maior resto). Idempotente
 *    pela chave do formulário e auditado. Na venda, o composto é um produto comum.
 *  - Produto sem `composition` se comporta exatamente como antes.
 */

export type Composition = "kit" | "composite";
export const COMPOSITION_LABEL: Record<Composition, string> = { kit: "Kit", composite: "Composto (montagem)" };
/** Parâmetro `feature.kits` (Parâmetros › Recursos), ligado por padrão. */
export const KITS_FLAG = "kits";
/**
 * Máximo de componentes por produto: a montagem grava tudo numa transação (saída com conferência do reservado =
 * 4 escritas por componente + entrada do composto + marcadores ≤ 95 escritas).
 */
export const MAX_COMPONENTS = 20;

/** Retrato de um componente gravado no item da venda (kit). */
export interface KitComponentSnapshot {
  skuId: string;
  productId: string;
  sku: string;
  /** quantidade do componente por 1 unidade do kit (milésimos) */
  qty: number;
  /** custo unitário do componente (custo médio no momento da venda) */
  unitCost: number;
}

/** Componente resolvido para um SKU pai. */
export interface ComponentInfo {
  rowId: string;
  skuId: string;
  productId: string;
  sku: string;
  name: string;
  unitCode: string;
  /** quantidade por 1 unidade do pai (milésimos) */
  qty: number;
  /** custo do cadastro (fallback quando o depósito ainda não tem custo médio) */
  costTotal: number;
  parentSkuId: string | null;
}

export function compositionOf(p: Doc | null | undefined): Composition | null {
  return p?.composition === "kit" || p?.composition === "composite" ? p.composition : null;
}

export function kitsEnabled(ctx: Pick<Ctx, "store" | "companyId" | "branchId">) {
  return isFeatureOn(ctx.store, ctx.companyId, ctx.branchId, KITS_FLAG, true);
}

async function assertKitsOn(ctx: Ctx) {
  if (!(await kitsEnabled(ctx))) throw new BusinessError("Kits e composição de produtos estão desligados em Administração › Parâmetros › Recursos.", "feature_off");
}

/** Quantidade do componente para `parentQty` do pai (milésimos, arredondada). */
export function scaleQty(parentQty: number, perUnit: number) {
  return roundDiv(parentQty * perUnit, QTY);
}

/** Custo (centavos) dos componentes consumidos por `parentQty` do pai — igual à soma dos movimentos de estoque. */
export function componentsCost(components: Array<{ qty: number; unitCost: number }>, parentQty: number) {
  return components.reduce((a, c) => a + roundDiv(Math.abs(scaleQty(parentQty, c.qty)) * c.unitCost, QTY), 0);
}

/** Linhas cadastradas de um produto pai, na ordem. */
export async function componentRows(store: Store, productId: string): Promise<Doc[]> {
  const rows = await listAll(store, "product_components", { filters: [["eq", "productId", productId]] });
  return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Linhas que valem para um SKU do pai: as gerais (sem variação) + as específicas da variação. */
export function rowsForSku(rows: Doc[], skuId: string) {
  return rows.filter((r) => !r.parentSkuId || r.parentSkuId === skuId);
}

/** Componentes (com SKU e produto) de vários SKUs pai. */
export async function componentsForSkus(store: Store, parentSkus: Array<{ id: string; productId: string }>): Promise<Map<string, ComponentInfo[]>> {
  const out = new Map<string, ComponentInfo[]>();
  if (!parentSkus.length) return out;
  const productIds = [...new Set(parentSkus.map((s) => s.productId))];
  const rows: Doc[] = [];
  for (let i = 0; i < productIds.length; i += 100) rows.push(...(await listAll(store, "product_components", { filters: [["eq", "productId", productIds.slice(i, i + 100)]] })));
  rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const compSkuIds = [...new Set(rows.map((r) => r.componentSkuId))];
  const skus = new Map<string, Doc>();
  for (let i = 0; i < compSkuIds.length; i += 100) for (const s of await listAll(store, "skus", { filters: [["eq", "id", compSkuIds.slice(i, i + 100)]] })) skus.set(s.id, s);
  const prodIds = [...new Set([...skus.values()].map((s) => s.productId))];
  const products = new Map<string, Doc>();
  for (let i = 0; i < prodIds.length; i += 100) for (const p of await listAll(store, "products", { filters: [["eq", "id", prodIds.slice(i, i + 100)]] })) products.set(p.id, p);
  for (const ps of parentSkus) {
    const list: ComponentInfo[] = [];
    for (const r of rowsForSku(rows.filter((x) => x.productId === ps.productId), ps.id)) {
      const sku = skus.get(r.componentSkuId);
      if (!sku) continue;
      const p = products.get(sku.productId);
      list.push({ rowId: r.id, skuId: sku.id, productId: sku.productId, sku: sku.sku, name: sku.name ?? p?.name ?? sku.sku, unitCode: sku.unitCode ?? p?.unitCode ?? "UN", qty: r.qty, costTotal: sku.costTotal ?? 0, parentSkuId: r.parentSkuId ?? null });
    }
    out.set(ps.id, list);
  }
  return out;
}

/** Disponível de um kit (milésimos, unidades inteiras) a partir do disponível dos componentes. */
export function kitAvailableFrom(components: Array<{ skuId: string; qty: number }>, available: Map<string, number>): number {
  if (!components.length) return 0;
  let units = Infinity;
  for (const c of components) {
    if (c.qty <= 0) continue;
    units = Math.min(units, Math.floor(Math.max(0, available.get(c.skuId) ?? 0) / c.qty));
  }
  return units === Infinity ? 0 : units * QTY;
}

/** Disponível dos SKUs de kits numa filial (soma dos depósitos de venda). SKUs que não são de kit ficam de fora. */
export async function kitAvailability(store: Store, branchId: string, skus: Array<{ id: string; productId: string }>, products: Map<string, Doc>): Promise<Map<string, number>> {
  const kitSkus = skus.filter((s) => compositionOf(products.get(s.productId)) === "kit");
  const out = new Map<string, number>();
  if (!kitSkus.length) return out;
  const comps = await componentsForSkus(store, kitSkus);
  const ids = [...new Set([...comps.values()].flat().map((c) => c.skuId))];
  const avail = await availableMap(store, branchId, ids);
  const av = new Map([...avail].map(([k, v]) => [k, v.available]));
  for (const s of kitSkus) out.set(s.id, kitAvailableFrom(comps.get(s.id) ?? [], av));
  return out;
}

/**
 * Kits de uma venda (ou prévia): componentes de cada SKU de kit. Recusa kit sem componentes e kit com o recurso
 * desligado (o kit não tem estoque próprio para vender como produto comum).
 */
export async function loadSaleKits(ctx: Pick<Ctx, "store" | "companyId" | "branchId">, lines: Array<{ sku: Doc; product: Doc }>): Promise<Map<string, ComponentInfo[]>> {
  const kitLines = lines.filter((l) => compositionOf(l.product) === "kit");
  if (!kitLines.length) return new Map();
  if (!(await kitsEnabled(ctx))) {
    throw new BusinessError(`${kitLines[0].product.name} é um kit e o recurso “Kits e composição” está desligado em Administração › Parâmetros › Recursos.`, "feature_off");
  }
  const map = await componentsForSkus(ctx.store, kitLines.map((l) => ({ id: l.sku.id, productId: l.product.id })));
  for (const l of kitLines) {
    if (!(map.get(l.sku.id) ?? []).length) throw new BusinessError(`O kit ${l.product.name} não tem componentes cadastrados (Produtos › ${l.product.name} › Componentes).`, "kit_without_components");
  }
  return map;
}

/** Retrato dos componentes e custo de uma linha de kit da venda (custo médio vigente de cada componente). */
export function kitLineCost(components: ComponentInfo[], kitQty: number, avgCostOf: (skuId: string) => number | null | undefined) {
  const snapshot: KitComponentSnapshot[] = components.map((c) => ({ skuId: c.skuId, productId: c.productId, sku: c.sku, qty: c.qty, unitCost: avgCostOf(c.skuId) ?? c.costTotal ?? 0 }));
  const costTotal = componentsCost(snapshot, kitQty);
  return { components: snapshot, costTotal, unitCost: kitQty ? roundDiv(costTotal * QTY, kitQty) : 0 };
}

/**
 * Movimentos dos componentes de um kit (venda, cancelamento, devolução): um por componente, quantidade
 * proporcional à do kit e custo do retrato da venda. A chave de idempotência acrescenta o SKU do componente.
 */
export function kitComponentMovements(
  components: KitComponentSnapshot[],
  parentQty: number,
  base: Omit<MovementInput, "skuId" | "qty" | "unitCost" | "idemKey"> & { sign: 1 | -1; idemKey: string },
): MovementInput[] {
  const { sign, idemKey, ...rest } = base;
  return components
    .map((c) => ({ ...rest, skuId: c.skuId, qty: sign * scaleQty(parentQty, c.qty), unitCost: c.unitCost, idemKey: `${idemKey}:${c.skuId}` }))
    .filter((m) => m.qty !== 0);
}

/**
 * Kits entre os itens de um documento fiscal (NF-e avulsa/de pedido com efeito de estoque): seq do item →
 * componentes por unidade. Itens que não são kit (ou kit sem componentes) ficam de fora e movimentam o próprio SKU.
 */
export async function docKitComponents(store: Store, items: Array<{ seq: number; skuId?: string | null }>): Promise<Record<string, Array<{ skuId: string; qty: number }>>> {
  const out: Record<string, Array<{ skuId: string; qty: number }>> = {};
  const skuIds = [...new Set(items.map((i) => i.skuId).filter(Boolean))] as string[];
  if (!skuIds.length) return out;
  const skus = await listAll(store, "skus", { filters: [["eq", "id", skuIds]] });
  const products = new Map((await listAll(store, "products", { filters: [["eq", "id", [...new Set(skus.map((s) => s.productId))]]] })).map((p) => [p.id, p]));
  const kitSkus = skus.filter((s) => compositionOf(products.get(s.productId)) === "kit");
  if (!kitSkus.length) return out;
  const comps = await componentsForSkus(store, kitSkus);
  for (const i of items) {
    const list = i.skuId ? comps.get(i.skuId) : null;
    if (list?.length) out[String(i.seq)] = list.map((c) => ({ skuId: c.skuId, qty: c.qty }));
  }
  return out;
}

/** Expande o movimento de um item de kit nos componentes (sem custo próprio: saem/voltam pelo custo médio). */
export function kitExpand(components: Array<{ skuId: string; qty: number }> | null | undefined, parentQty: number, movement: MovementInput): MovementInput[] {
  if (!components?.length) return [movement];
  const sign = movement.qty < 0 ? -1 : 1;
  return components
    .map((c) => ({ ...movement, skuId: c.skuId, qty: sign * scaleQty(parentQty, c.qty), unitCost: null, totalCost: null, idemKey: `${movement.idemKey}:${c.skuId}` }))
    .filter((m) => m.qty !== 0);
}

// ───────────────────────────── Cadastro (aba "Componentes" do produto)

/** Define (ou remove) a composição do produto. */
export async function setComposition(ctx: Ctx, productId: string, composition: Composition | null) {
  requirePerm(ctx, "products", "edit");
  await assertKitsOn(ctx);
  const p = await ctx.store.getOrThrow("products", productId);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  assert(composition === null || composition === "kit" || composition === "composite", "Tipo de composição inválido.");
  assert(p.type !== "service", "Serviços não têm composição.");
  const before = compositionOf(p);
  if (before === composition) return p;
  if (composition === "kit") {
    const bals = await listAll(ctx.store, "stock_balances", { filters: [["eq", "productId", productId]] });
    assert(bals.every((b) => !b.physical && !b.reserved && !b.inTransit), "Um kit não tem estoque próprio: zere o saldo deste produto (ajuste, transferência ou inventário) antes de transformá-lo em kit — ou use “Composto” para manter estoque montado.");
    const skus = await listAll(ctx.store, "skus", { filters: [["eq", "productId", productId]] });
    for (const s of skus) {
      const used = (await ctx.store.list("product_components", { filters: [["eq", "componentSkuId", s.id]], limit: 1, total: false })).items[0];
      assert(!used, "Este produto é componente de outro kit ou composto; um kit não pode ser componente. Remova-o do outro produto antes.");
    }
  }
  const after = await ctx.store.update("products", productId, { composition });
  await audit(ctx, {
    module: "products", action: "product.composition", entityType: "product", entityId: productId,
    summary: `Composição de ${p.name}: ${before ? COMPOSITION_LABEL[before] : "nenhuma"} → ${composition ? COMPOSITION_LABEL[composition] : "nenhuma"}`,
    before: { composition: before }, after: { composition },
  });
  return after;
}

/** Inclui ou altera um componente (id determinístico por pai, variação e componente). */
export async function saveComponent(ctx: Ctx, input: { productId: string; parentSkuId?: string | null; componentSkuId: string; qty: number; notes?: string | null }) {
  requirePerm(ctx, "products", "edit");
  await assertKitsOn(ctx);
  const p = await ctx.store.getOrThrow("products", input.productId);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  const comp = compositionOf(p);
  assert(comp, "Defina o tipo de composição (kit ou composto) antes de cadastrar componentes.");
  assert(input.componentSkuId, "Escolha o produto componente.");
  assert(Number.isInteger(input.qty) && input.qty > 0, "Informe a quantidade do componente (maior que zero).");
  const parentSkuId = input.parentSkuId || null;
  if (parentSkuId) {
    const ps = await ctx.store.getOrThrow("skus", parentSkuId);
    assert(ps.productId === p.id, "A variação informada não pertence a este produto.");
  }
  const sku = await ctx.store.getOrThrow("skus", input.componentSkuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  const cp = await ctx.store.getOrThrow("products", sku.productId);
  assert(cp.id !== p.id, "O produto não pode ser componente de si mesmo.");
  assert(cp.type !== "service", "Serviços não podem ser componentes (não têm estoque).");
  assert(compositionOf(cp) !== "kit", "Um kit não pode ser componente (não tem estoque próprio). Use os componentes dele ou um produto composto.");
  if (compositionOf(cp) === "composite") {
    const theirs = await componentRows(ctx.store, cp.id);
    const mySkus = new Set((await listAll(ctx.store, "skus", { filters: [["eq", "productId", p.id]] })).map((s) => s.id));
    assert(!theirs.some((r) => mySkus.has(r.componentSkuId)), `${cp.name} já usa este produto como componente (composição circular).`);
  }
  const rows = await componentRows(ctx.store, p.id);
  const id = detId("pcomp", p.id, parentSkuId ?? "*", sku.id);
  const existing = rows.find((r) => r.id === id);
  // o mesmo componente não entra duas vezes para a mesma variação (geral + específica somariam em dobro)
  const dup = rows.find((r) => r.id !== id && r.componentSkuId === sku.id && (!r.parentSkuId || !parentSkuId || r.parentSkuId === parentSkuId));
  assert(!dup, `${sku.sku} já é componente ${dup?.parentSkuId ? "de uma variação" : "de todas as variações"} deste produto; altere a quantidade na linha existente.`);
  if (!existing) assert(rows.length < MAX_COMPONENTS, `Máximo de ${MAX_COMPONENTS} componentes por produto.`);
  const data = { qty: input.qty, notes: input.notes?.trim().slice(0, 300) || null };
  let doc: Doc;
  if (existing) doc = await ctx.store.update("product_components", id, data);
  else {
    try {
      doc = await ctx.store.create("product_components", { companyId: ctx.companyId, createdBy: ctx.user.id, productId: p.id, parentSkuId, componentSkuId: sku.id, componentProductId: sku.productId, seq: rows.reduce((a, r) => Math.max(a, r.seq ?? 0), 0) + 1, ...data }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await ctx.store.update("product_components", id, data); // gravação simultânea do mesmo par
    }
  }
  await audit(ctx, {
    module: "products", action: existing ? "product.component_update" : "product.component_add", entityType: "product", entityId: p.id,
    summary: `${COMPOSITION_LABEL[comp]} ${p.name}: componente ${sku.sku} — ${formatQty(input.qty, sku.unitCode ?? cp.unitCode)} por unidade${existing ? ` (antes ${formatQty(existing.qty)})` : ""}`,
    related: [`sku:${sku.id}`, `product:${sku.productId}`],
  });
  return doc;
}

export async function removeComponent(ctx: Ctx, id: string) {
  requirePerm(ctx, "products", "edit");
  const row = await ctx.store.getOrThrow("product_components", id);
  assert(row.companyId === ctx.companyId, "Componente de outra empresa.");
  await ctx.store.delete("product_components", id);
  const sku = await ctx.store.get("skus", row.componentSkuId);
  await audit(ctx, { module: "products", action: "product.component_remove", entityType: "product", entityId: row.productId, summary: `Componente ${sku?.sku ?? row.componentSkuId} removido (${formatQty(row.qty)} por unidade)`, related: [`sku:${row.componentSkuId}`] });
}

/** Remove as linhas de componentes de um produto excluído. */
export async function purgeComponents(ctx: Ctx, productId: string) {
  for (const r of await listAll(ctx.store, "product_components", { filters: [["eq", "productId", productId]] })) await ctx.store.delete("product_components", r.id);
}

// ───────────────────────────── Montagem e desmembramento (CAD-13)

export type AssemblyDirection = "assemble" | "disassemble";
export const ASSEMBLY_LABEL: Record<AssemblyDirection, string> = { assemble: "Montagem", disassemble: "Desmembramento" };

export interface AssemblyInput {
  /** SKU do produto composto */
  skuId: string;
  warehouseId: string;
  /** unidades do composto (milésimos) */
  qty: number;
  direction: AssemblyDirection;
  idemKey: string;
  notes?: string | null;
}

export interface AssemblyResult {
  id: string;
  direction: AssemblyDirection;
  skuId: string;
  sku: string;
  name: string;
  warehouseId: string;
  branchId: string;
  qty: number;
  /** valor movimentado (custo dos componentes na montagem; custo do composto no desmembramento) */
  totalCost: number;
  components: Array<{ skuId: string; sku: string; name: string; qty: number; unitCost: number; totalCost: number }>;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  at: string;
  applied: boolean;
}

/** Plano (prévia) da montagem/desmembramento: quantidades, custos e saldos atuais. Não grava. */
export async function planAssembly(ctx: Ctx, input: Omit<AssemblyInput, "idemKey">) {
  const branchId = requireBranch(ctx);
  assert(input.direction === "assemble" || input.direction === "disassemble", "Operação inválida.");
  assert(Number.isInteger(input.qty) && input.qty > 0, "Informe a quantidade (maior que zero).");
  const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
  assert(wh.companyId === ctx.companyId && wh.branchId === branchId, "O depósito não pertence à filial selecionada.");
  const sku = await ctx.store.getOrThrow("skus", input.skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  const product = await ctx.store.getOrThrow("products", sku.productId);
  assert(compositionOf(product) === "composite", compositionOf(product) === "kit" ? "Kits não são montados: os componentes são baixados na venda. Use um produto composto para manter estoque montado." : `${product.name} não é um produto composto (defina em Produtos › ${product.name} › Componentes).`);
  const comps = (await componentsForSkus(ctx.store, [{ id: sku.id, productId: product.id }])).get(sku.id) ?? [];
  assert(comps.length > 0, `O composto ${product.name} não tem componentes cadastrados.`);
  const balOf = async (skuId: string) => ctx.store.get("stock_balances", balanceId(wh.id, skuId));
  const own = await balOf(sku.id);
  const ownAvg = own?.avgCost ?? sku.costTotal ?? 0;
  const lines = [] as Array<ComponentInfo & { moveQty: number; unitCost: number; totalCost: number; physical: number; available: number }>;
  for (const c of comps) {
    const b = await balOf(c.skuId);
    lines.push({ ...c, moveQty: scaleQty(input.qty, c.qty), unitCost: b?.avgCost ?? c.costTotal ?? 0, totalCost: 0, physical: b?.physical ?? 0, available: (b?.physical ?? 0) - (b?.reserved ?? 0) });
  }
  assert(lines.every((l) => l.moveQty > 0), "Quantidade pequena demais: algum componente ficaria com quantidade zero.");
  let totalCost: number;
  if (input.direction === "assemble") {
    for (const l of lines) l.totalCost = roundDiv(l.moveQty * l.unitCost, QTY);
    totalCost = lines.reduce((a, l) => a + l.totalCost, 0);
  } else {
    // o valor que sai do composto é repartido entre os componentes pelo custo médio de cada um (maior resto)
    totalCost = roundDiv(input.qty * ownAvg, QTY);
    const weights = lines.map((l) => l.moveQty * l.unitCost);
    const shares = allocate(totalCost, weights.some((w) => w > 0) ? weights : lines.map((l) => l.moveQty));
    lines.forEach((l, i) => {
      l.totalCost = shares[i];
      l.unitCost = roundDiv(shares[i] * QTY, l.moveQty);
    });
  }
  return { branchId, wh, sku, product, lines, totalCost, own: { physical: own?.physical ?? 0, available: (own?.physical ?? 0) - (own?.reserved ?? 0), avgCost: ownAvg } };
}

/**
 * Monta ou desmembra unidades de um produto composto numa única transação (todos os movimentos ou nenhum).
 * Idempotente pela chave do formulário; saídas nunca deixam saldo negativo nem consomem o reservado.
 */
export async function runAssembly(ctx: Ctx, input: AssemblyInput): Promise<AssemblyResult> {
  requirePerm(ctx, "stock", "create");
  requireAction(ctx, "stock.adjust");
  assert(input.idemKey?.trim(), "Chave da operação ausente.");
  const id = detId("asm", input.idemKey);
  const done = await ctx.store.get("operations", id);
  if (done) return { ...(done.result as AssemblyResult), applied: false };
  await assertKitsOn(ctx);
  const plan = await planAssembly(ctx, input);
  const { wh, sku, product, lines, totalCost, branchId } = plan;
  const label = ASSEMBLY_LABEL[input.direction];
  const reason = `${label} de ${formatQty(input.qty, sku.unitCode ?? product.unitCode)} × ${sku.sku}`;
  const notes = input.notes?.trim().slice(0, 500) || null;
  const common = { warehouseId: wh.id, originType: "assembly", originId: id, operationId: id, reason, notes };
  const out = (skuId: string, qty: number, unitCost: number): MovementInput => ({ ...common, skuId, qty: -qty, type: "assembly_out" as MovementType, unitCost, idemKey: `assembly:${input.idemKey}:out:${skuId}`, respectReserved: true });
  const inn = (skuId: string, qty: number, total: number): MovementInput => ({ ...common, skuId, qty, type: "assembly_in" as MovementType, unitCost: roundDiv(total * QTY, qty), totalCost: total, idemKey: `assembly:${input.idemKey}:in:${skuId}` });
  const movements: MovementInput[] =
    input.direction === "assemble"
      ? [...lines.map((l) => out(l.skuId, l.moveQty, l.unitCost)), inn(sku.id, input.qty, totalCost)]
      : [out(sku.id, input.qty, plan.own.avgCost), ...lines.map((l) => inn(l.skuId, l.moveQty, l.totalCost))];
  const result: AssemblyResult = {
    id, direction: input.direction, skuId: sku.id, sku: sku.sku, name: sku.name ?? product.name, warehouseId: wh.id, branchId, qty: input.qty, totalCost,
    components: lines.map((l) => ({ skuId: l.skuId, sku: l.sku, name: l.name, qty: l.moveQty, unitCost: l.unitCost, totalCost: l.totalCost })),
    notes, createdBy: ctx.user.id, createdByName: ctx.user.name, at: new Date().toISOString(), applied: true,
  };
  let applied: boolean;
  try {
    applied = await applyOnce(ctx, `assembly:${input.idemKey}`, { entityType: "assembly", entityId: id }, async (t) => {
      await t.create("operations", { companyId: ctx.companyId, type: "stock.assembly", status: "done", entityType: "sku", entityId: sku.id, result, createdBy: ctx.user.id }, id);
      await postMovements(ctx, movements, t);
    });
  } catch (e) {
    if (isConflict(e) && e.reason === "bounds") throw new BusinessError("Saída excede o disponível: uma reserva foi registrada para um dos itens ao mesmo tempo. Atualize a página e confira o disponível.", "reserved_stock");
    throw e;
  }
  if (!applied) {
    const again = await ctx.store.get("operations", id);
    return { ...((again?.result as AssemblyResult) ?? result), applied: false };
  }
  await audit(ctx, {
    module: "stock", action: `stock.${input.direction}`, entityType: "assembly", entityId: id,
    summary: `${reason} em ${wh.name} — ${formatMoney(totalCost)} (${lines.map((l) => `${l.sku} ${formatQty(l.moveQty)}`).join(", ")})`,
    reason: notes ?? undefined, operationId: id,
    after: { qty: input.qty, totalCost, components: result.components.map((c) => ({ sku: c.sku, qty: c.qty, totalCost: c.totalCost })) },
    related: [`sku:${sku.id}`, `product:${product.id}`, ...lines.map((l) => `sku:${l.skuId}`)],
  });
  return result;
}

/** Montagens/desmembramentos recentes da filial (a partir dos movimentos de origem "assembly"). */
export async function listAssemblies(store: Store, branchId: string, limit = 50): Promise<AssemblyResult[]> {
  const movs = (await store.list("stock_movements", { filters: [["eq", "branchId", branchId], ["eq", "originType", "assembly"]], orderBy: [{ field: "occurredAt", dir: "desc" }], limit: 400 })).items;
  const ids = [...new Set(movs.map((m) => m.originId).filter(Boolean))].slice(0, limit) as string[];
  if (!ids.length) return [];
  const ops = await listAll(store, "operations", { filters: [["eq", "id", ids]] });
  const byId = new Map(ops.map((o) => [o.id, o.result as AssemblyResult]));
  return ids.map((i) => byId.get(i)).filter(Boolean) as AssemblyResult[];
}
