/**
 * Balança etiquetadora (PDV-06 e CAD-16): dados de balança do produto, leitura da etiqueta no PDV e arquivo de carga.
 *
 *  - Dados no produto (campos opcionais): `plu` (código na balança, único por empresa), `shelfLifeDays` (validade em dias),
 *    `scaleTare` (tara em milésimos de kg), `nutrition` (json simples) e `scaleEnabled` (entra na carga da balança).
 *  - Etiqueta no PDV: `resolveScaleBarcode` decompõe o código (`parseScaleBarcode`), localiza o produto pelo PLU e devolve
 *    a quantidade — peso (milésimos de kg) ou valor ÷ preço da tabela (arredondado ao milésimo). O preço vem sempre da
 *    tabela de preços (`resolvePrices`), nunca do código; o total da linha é o de `calcSale` (regra inalterada).
 *  - Carga: `generateScaleLoad` grava o arquivo (Toledo ITENSMGV.TXT ou Filizola CADTXT.TXT) em `files` para download.
 * Regras em docs/regras-assumidas.md §30. Liga/desliga: `feature.balanca` (ligado por padrão).
 */
import { findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { saveFile } from "@/lib/core/files";
import { formatMoney, formatQty, lineTotal, QTY } from "@/lib/money";
import { defaultPriceTableId, resolvePrices } from "./pricing";
import { SCALE_DEFAULTS, looksLikeScaleBarcode, maxPluFor, parseScaleBarcode, qtyForLabelValue, scaleLayoutDef, type ScaleContent, type ScaleLayout } from "./scale-barcode";
import { MAX_PLU, MAX_SHELF_LIFE_DAYS, SCALE_FORMATS, buildScaleFile, type ScaleFileFormat } from "./scale-files";

// ───────────────────────────── Parâmetros

export interface ScaleConfig {
  enabled: boolean;
  layout: ScaleLayout;
  content: ScaleContent;
}

/** `feature.balanca` + formato da etiqueta (filial → empresa → padrão). */
export async function scaleConfig(store: Store, companyId: string, branchId: string | null | undefined): Promise<ScaleConfig> {
  const enabled = await isFeatureOn(store, companyId, branchId, "balanca", true);
  const layout = scaleLayoutDef(await getSetting<string | number>(store, companyId, branchId, "scale.barcodeLayout", SCALE_DEFAULTS.layout)).value;
  const content = (await getSetting<string>(store, companyId, branchId, "scale.barcodeContent", SCALE_DEFAULTS.content)) === "value" ? "value" : "weight";
  return { enabled, layout, content };
}

// ───────────────────────────── Dados de balança do produto

export interface Nutrition {
  /** porção de referência (ex.: "100 g") */
  portion: string;
  kcal: number | null;
  carbs: number | null;
  proteins: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  fiber: number | null;
  /** miligramas */
  sodium: number | null;
}

export const NUTRITION_FIELDS: Array<{ key: Exclude<keyof Nutrition, "portion">; label: string; unit: string }> = [
  { key: "kcal", label: "Valor energético", unit: "kcal" },
  { key: "carbs", label: "Carboidratos", unit: "g" },
  { key: "proteins", label: "Proteínas", unit: "g" },
  { key: "totalFat", label: "Gorduras totais", unit: "g" },
  { key: "saturatedFat", label: "Gorduras saturadas", unit: "g" },
  { key: "transFat", label: "Gorduras trans", unit: "g" },
  { key: "fiber", label: "Fibra alimentar", unit: "g" },
  { key: "sodium", label: "Sódio", unit: "mg" },
];

/** Normaliza a informação nutricional (números ≥ 0 com até 1 casa; vazia → null). */
export function normalizeNutrition(raw: unknown): Nutrition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Nutrition = { portion: String(r.portion ?? "").trim().slice(0, 40), kcal: null, carbs: null, proteins: null, totalFat: null, saturatedFat: null, transFat: null, fiber: null, sodium: null };
  let any = Boolean(out.portion);
  for (const f of NUTRITION_FIELDS) {
    const v = r[f.key];
    if (v == null || v === "") continue;
    const n = Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new BusinessError(`Informação nutricional: ${f.label} inválido(a).`, "validation");
    out[f.key] = Math.round(n * 10) / 10;
    any = true;
  }
  return any ? out : null;
}

export interface ScaleDataInput {
  plu: number | null;
  shelfLifeDays: number | null;
  /** milésimos de kg */
  scaleTare: number | null;
  scaleEnabled: boolean;
  nutrition: unknown;
}

const MAX_TARE = 99999; // 99,999 kg

/** Grava os dados de balança do produto (PLU único por empresa; produto sem variações). */
export async function saveScaleData(ctx: Ctx, productId: string, input: ScaleDataInput) {
  requirePerm(ctx, "products", "edit");
  const before = await ctx.store.getOrThrow("products", productId);
  assert(before.companyId === ctx.companyId, "Produto de outra empresa.");
  assert(before.type !== "service", "Serviço não é vendido em balança.");
  const plu = input.plu == null ? null : Number(input.plu);
  if (plu != null) {
    assert(Number.isInteger(plu) && plu >= 1 && plu <= MAX_PLU, `PLU deve ser um número de 1 a ${MAX_PLU}.`, "validation");
    assert(!before.hasVariants, "Produto com variações não pode ter PLU: a etiqueta da balança identifica um único item.", "validation");
    const dup = await findOne(ctx.store, "products", [["eq", "companyId", ctx.companyId], ["eq", "plu", plu]]);
    if (dup && dup.id !== productId) throw new BusinessError(`PLU ${plu} já está em uso por ${dup.code ? `${dup.code} — ` : ""}${dup.name}. Cada PLU identifica um único produto.`, "duplicate_plu");
  }
  assert(!input.scaleEnabled || plu != null, "Informe o PLU para enviar o produto à balança.", "validation");
  const shelf = input.shelfLifeDays == null ? null : Number(input.shelfLifeDays);
  assert(shelf == null || (Number.isInteger(shelf) && shelf >= 0 && shelf <= MAX_SHELF_LIFE_DAYS), `Validade deve estar entre 0 e ${MAX_SHELF_LIFE_DAYS} dias.`, "validation");
  const tare = input.scaleTare == null ? null : Number(input.scaleTare);
  assert(tare == null || (Number.isInteger(tare) && tare >= 0 && tare <= MAX_TARE), "Tara deve estar entre 0 e 99,999 kg.", "validation");
  const data = { plu, shelfLifeDays: shelf, scaleTare: tare, scaleEnabled: Boolean(input.scaleEnabled), nutrition: normalizeNutrition(input.nutrition) };
  let after: Doc;
  try {
    after = await ctx.store.update("products", productId, data);
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(`PLU ${plu} já está em uso por outro produto.`, "duplicate_plu");
    throw e;
  }
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit(ctx, { module: "products", action: "product.scale_update", entityType: "product", entityId: productId, summary: `Dados de balança de ${after.name} alterados${plu != null ? ` (PLU ${plu})` : ""}`, before: d.before, after: d.after });
  }
  return after;
}

// ───────────────────────────── Leitura da etiqueta (PDV)

export type ScaleResolution =
  | {
      ok: true;
      skuId: string;
      productId: string;
      barcode: string;
      plu: number;
      content: ScaleContent;
      /** milésimos */
      qty: number;
      /** preço unitário da tabela na quantidade lançada */
      unitPrice: number;
      /** total da linha pela regra atual (arredondar(preço × quantidade)) */
      lineTotal: number;
      /** valor impresso na etiqueta (modo valor) */
      labelValue: number | null;
      /** total da linha − valor da etiqueta (modo valor; 0 quando fecha) */
      difference: number;
      message: string;
    }
  | { ok: false; code: string; error: string };

const isKg = (unit: string | null | undefined) => String(unit ?? "").trim().toUpperCase() === "KG";

/**
 * Resolve uma etiqueta de balança para SKU e quantidade. Devolve `null` quando o recurso está desligado ou o código não
 * tem formato de etiqueta (o chamador segue a busca normal); erros de leitura/cadastro voltam com `ok: false`.
 */
export async function resolveScaleBarcode(
  store: Store,
  input: { companyId: string; branchId: string | null; priceTableId?: string | null; code: string },
): Promise<ScaleResolution | null> {
  const code = (input.code ?? "").trim();
  if (!looksLikeScaleBarcode(code)) return null;
  const cfg = await scaleConfig(store, input.companyId, input.branchId);
  if (!cfg.enabled) return null;
  const parsed = parseScaleBarcode(code, cfg);
  if (!parsed.ok) return { ok: false, code: parsed.reason, error: parsed.message };
  const product = await findOne(store, "products", [["eq", "companyId", input.companyId], ["eq", "plu", parsed.plu]]);
  if (!product) return { ok: false, code: "plu_not_found", error: `Etiqueta ${code}: nenhum produto com PLU ${parsed.plu} (confira o cadastro em Produtos › Balança ou o formato do código em Parâmetros).` };
  if (product.active === false || product.status === "inactive" || product.status === "draft") return { ok: false, code: "product_inactive", error: `${product.name} (PLU ${parsed.plu}) está inativo no cadastro.` };
  if (product.availablePdv === false) return { ok: false, code: "product_not_pdv", error: `${product.name} (PLU ${parsed.plu}) não está disponível no PDV.` };
  const skus = (await listAll(store, "skus", { filters: [["eq", "productId", product.id]] })).filter((k) => k.active !== false);
  if (skus.length !== 1) return { ok: false, code: "plu_ambiguous", error: `${product.name} (PLU ${parsed.plu}) precisa ter exatamente uma variação ativa para a balança.` };
  const sku = skus[0];
  const unit = sku.unitCode ?? product.unitCode;
  const priceAt = async (qty: number) => (await resolvePrices(store, { companyId: input.companyId, branchId: input.branchId, priceTableId: input.priceTableId ?? null, items: [{ skuId: sku.id, qty }] }))[0];

  let qty: number;
  let price: number;
  if (parsed.content === "weight") {
    if (!isKg(unit)) return { ok: false, code: "unit_not_kg", error: `${product.name} (PLU ${parsed.plu}) é vendido em ${unit ?? "UN"}: etiqueta por peso exige produto em KG.` };
    qty = parsed.weight!;
    price = (await priceAt(qty)).price;
  } else {
    const list = await priceAt(QTY);
    if (!(list.listPrice > 0)) return { ok: false, code: "no_price", error: `${product.name} (PLU ${parsed.plu}) sem preço vigente na tabela selecionada — sem preço não há como converter o valor da etiqueta em quantidade.` };
    // valor ÷ preço da tabela; se a quantidade atingir o atacado, recalcula pelo preço de atacado (o que a venda usará)
    qty = qtyForLabelValue(parsed.value!, list.listPrice);
    let at = await priceAt(qty);
    if (at.price !== list.listPrice && at.price > 0) {
      const q2 = qtyForLabelValue(parsed.value!, at.price);
      const at2 = await priceAt(q2);
      if (at2.price === at.price) {
        qty = q2;
        at = at2;
      }
    }
    price = at.price;
  }
  if (!(price > 0)) return { ok: false, code: "no_price", error: `${product.name} (PLU ${parsed.plu}) sem preço vigente na tabela selecionada.` };
  const total = lineTotal(price, qty);
  const labelValue = parsed.content === "value" ? parsed.value : null;
  const difference = labelValue == null ? 0 : total - labelValue;
  const message =
    parsed.content === "weight"
      ? `${product.name}: ${formatQty(qty)} kg × ${formatMoney(price)} = ${formatMoney(total)}`
      : difference === 0
        ? `${product.name}: etiqueta de ${formatMoney(labelValue)} → ${formatQty(qty)} ${unit ?? ""} × ${formatMoney(price)}`.trim()
        : `${product.name}: etiqueta de ${formatMoney(labelValue)}, total calculado ${formatMoney(total)} (${formatQty(qty)} × ${formatMoney(price)} arredondado ao milésimo)`;
  return { ok: true, skuId: sku.id, productId: product.id, barcode: code, plu: parsed.plu, content: parsed.content, qty, unitPrice: price, lineTotal: total, labelValue, difference, message };
}

/** SKU de uma etiqueta de balança (sem quantidade) — para seletores de produto que só precisam localizar o item. */
export async function skuForScaleBarcode(store: Store, companyId: string, branchId: string | null, code: string): Promise<Doc | null> {
  const r = await resolveScaleBarcode(store, { companyId, branchId, code });
  if (!r || !r.ok) return null;
  return store.get("skus", r.skuId);
}

// ───────────────────────────── Carga da balança

export interface ScaleRow {
  productId: string;
  code: string | null;
  name: string;
  plu: number | null;
  unitCode: string;
  byWeight: boolean;
  shelfLifeDays: number;
  scaleTare: number | null;
  hasNutrition: boolean;
  price: number | null;
  /** problemas que impedem o item de entrar no arquivo */
  issues: string[];
  /** avisos que não impedem a geração */
  warnings: string[];
}

/** Produtos habilitados para a balança, com preço da tabela e conferência (PLU ausente/duplicado, sem preço etc.). */
export async function listScaleProducts(ctx: Ctx, opts: { priceTableId?: string | null } = {}) {
  requirePerm(ctx, "products", "view");
  const cfg = await scaleConfig(ctx.store, ctx.companyId, ctx.branchId);
  const products = (await listAll(ctx.store, "products", { filters: [["eq", "companyId", ctx.companyId], ["eq", "scaleEnabled", true]] }, 5000)).sort(
    (a, b) => (a.plu ?? Infinity) - (b.plu ?? Infinity) || String(a.name).localeCompare(String(b.name)),
  );
  const priceTableId = opts.priceTableId || (ctx.branchId ? (await ctx.store.get("branches", ctx.branchId))?.defaultPriceTableId : null) || (await defaultPriceTableId(ctx.store, ctx.companyId));
  const skus = products.length ? await listAll(ctx.store, "skus", { filters: [["eq", "productId", products.map((p) => p.id)]] }) : [];
  const skuOf = new Map<string, Doc[]>();
  for (const k of skus) if (k.active !== false) skuOf.set(k.productId, [...(skuOf.get(k.productId) ?? []), k]);
  const single = products.map((p) => (skuOf.get(p.id) ?? []).length === 1 ? skuOf.get(p.id)![0] : null);
  const priced = single.filter(Boolean) as Doc[];
  const prices = priced.length ? await resolvePrices(ctx.store, { companyId: ctx.companyId, branchId: ctx.branchId, priceTableId, items: priced.map((k) => ({ skuId: k.id, qty: QTY })) }) : [];
  const priceOf = new Map(prices.map((p) => [p.skuId, p.listPrice]));
  const pluCount = new Map<number, number>();
  for (const p of products) if (p.plu != null) pluCount.set(p.plu, (pluCount.get(p.plu) ?? 0) + 1);
  const layoutMax = maxPluFor(cfg.layout);
  const rows: ScaleRow[] = products.map((p, i) => {
    const sku = single[i];
    const unitCode = String(sku?.unitCode ?? p.unitCode ?? "UN");
    const price = sku ? (priceOf.get(sku.id) ?? 0) || null : null;
    const issues: string[] = [];
    const warnings: string[] = [];
    if (p.plu == null) issues.push("Sem PLU");
    else if ((pluCount.get(p.plu) ?? 0) > 1) issues.push(`PLU ${p.plu} duplicado`);
    if (!sku) issues.push(p.hasVariants ? "Produto com variações" : "Sem variação ativa");
    if (sku && !price) issues.push("Sem preço na tabela");
    if (p.active === false || p.status === "inactive" || p.status === "draft") issues.push("Produto inativo");
    if (p.plu != null && p.plu > layoutMax) warnings.push(`PLU acima de ${layoutMax}: não cabe no código de ${scaleLayoutDef(cfg.layout).codeDigits} dígitos da etiqueta`);
    if (!isKg(unitCode)) warnings.push(`Vendido em ${unitCode} (vai como unitário)`);
    return { productId: p.id, code: p.code ?? null, name: p.name, plu: p.plu ?? null, unitCode, byWeight: isKg(unitCode), shelfLifeDays: p.shelfLifeDays ?? 0, scaleTare: p.scaleTare ?? null, hasNutrition: Boolean(p.nutrition), price, issues, warnings };
  });
  const duplicates = [...pluCount.entries()].filter(([, n]) => n > 1).map(([plu]) => plu);
  return { rows, duplicates, priceTableId: priceTableId ?? null, config: cfg };
}

/** Gera o arquivo de carga (itens sem pendência) e grava em `files` (download em /api/files/<id>). PLU duplicado recusa. */
export async function generateScaleLoad(ctx: Ctx, input: { format: ScaleFileFormat; priceTableId?: string | null }) {
  requirePerm(ctx, "products", "edit");
  const fmt = SCALE_FORMATS.find((f) => f.value === input.format);
  assert(fmt, "Escolha o modelo de balança (Toledo ou Filizola).", "validation");
  const { rows, duplicates, priceTableId } = await listScaleProducts(ctx, { priceTableId: input.priceTableId });
  if (duplicates.length) throw new BusinessError(`PLU duplicado entre produtos habilitados: ${duplicates.join(", ")}. Corrija o cadastro antes de gerar a carga — a balança não distingue os itens.`, "duplicate_plu");
  const skipped: Array<{ name: string; reason: string }> = [];
  const items = [];
  for (const r of rows) {
    const reasons = [...r.issues];
    if (!reasons.length && r.price! > fmt!.maxPrice) reasons.push(`Preço ${formatMoney(r.price)} acima do máximo do arquivo (${formatMoney(fmt!.maxPrice)})`);
    if (reasons.length) {
      skipped.push({ name: r.name, reason: reasons.join("; ") });
      continue;
    }
    items.push({ plu: r.plu!, name: r.name, byWeight: r.byWeight, price: r.price!, shelfLifeDays: r.shelfLifeDays });
  }
  assert(items.length > 0, rows.length ? "Nenhum produto habilitado está pronto para a carga (veja as pendências na lista)." : "Nenhum produto habilitado para a balança. Marque “Enviar à balança” no cadastro do produto (aba Balança).", "validation");
  const file = buildScaleFile(fmt!.value, items);
  const saved = await saveFile(ctx, { bucket: "documents", name: file.fileName, mime: "text/plain", data: Buffer.from(file.content, "latin1"), entityType: "scale_load", kind: "scale_load" });
  await audit(ctx, {
    module: "products",
    action: "scale.load_generate",
    entityType: "scale_load",
    entityId: saved.id,
    summary: `Carga de balança ${fmt!.label}: ${items.length} item(ns)${skipped.length ? `, ${skipped.length} com pendência fora do arquivo` : ""}`,
    after: { format: fmt!.value, priceTableId, items: items.length, skipped: skipped.slice(0, 50) },
    related: [`file:${saved.id}`],
  });
  return { fileId: saved.id, fileName: file.fileName, count: items.length, skipped };
}

/** Últimas cargas geradas (arquivos `scale_load` da empresa). */
export async function recentScaleLoads(ctx: Ctx, limit = 10) {
  const res = await ctx.store.list("files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "scale_load"]], orderBy: [{ field: "createdAt", dir: "desc" }], limit });
  return res.items;
}
