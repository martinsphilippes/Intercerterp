import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { can, canDo } from "@/lib/permissions";
import { audit, diff } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { onlyDigits, searchable } from "@/lib/core/text";
import { saveFile } from "@/lib/core/files";
import { formatMoney, QTY } from "@/lib/money";
import { balanceId, ensureBalance, postMovements } from "./stock";
import { defaultPriceTableId, priceScopeKey, recordPriceHistory, savePrice, validatePrice } from "./pricing";

/**
 * Produtos e serviços (Telas 15–16 e visões complementares 1 e 2).
 *  - Produto = cadastro comercial/fiscal; SKU = unidade vendável/estocável (variação).
 *  - Produto simples tem um SKU sem atributos; produto com variações tem um SKU por combinação.
 *  - Custos e preços são por SKU; toda alteração gera `price_history`.
 *  - Inativar preserva referências; excluir só sem uso (sem movimentos, vendas, compras, inventários).
 */

// ───────────────────────────── Constantes de domínio (exibidas pelas telas)

export const PRODUCT_TYPES = [
  { value: "product", label: "Produto (mercadoria)" },
  { value: "service", label: "Serviço" },
];

export const ORIGINS = [
  { value: "0", label: "0 — Nacional" },
  { value: "1", label: "1 — Estrangeira, importação direta" },
  { value: "2", label: "2 — Estrangeira, adquirida no mercado interno" },
  { value: "3", label: "3 — Nacional, conteúdo de importação > 40% e ≤ 70%" },
  { value: "4", label: "4 — Nacional, processos produtivos básicos" },
  { value: "5", label: "5 — Nacional, conteúdo de importação ≤ 40%" },
  { value: "6", label: "6 — Estrangeira, importação direta sem similar (CAMEX)" },
  { value: "7", label: "7 — Estrangeira, mercado interno sem similar (CAMEX)" },
  { value: "8", label: "8 — Nacional, conteúdo de importação > 70%" },
];

export const CSOSN_OPTIONS = [
  { value: "101", label: "101 — Tributada com permissão de crédito" },
  { value: "102", label: "102 — Tributada sem permissão de crédito" },
  { value: "103", label: "103 — Isenção do ICMS para faixa de receita bruta" },
  { value: "201", label: "201 — Com crédito e cobrança do ICMS por ST" },
  { value: "202", label: "202 — Sem crédito e com cobrança do ICMS por ST" },
  { value: "203", label: "203 — Isenção para faixa de receita com ST" },
  { value: "300", label: "300 — Imune" },
  { value: "400", label: "400 — Não tributada" },
  { value: "500", label: "500 — ICMS cobrado anteriormente por ST" },
  { value: "900", label: "900 — Outros" },
];

export const CST_ICMS_OPTIONS = [
  { value: "00", label: "00 — Tributada integralmente" },
  { value: "02", label: "02 — Tributação monofásica própria" },
  { value: "10", label: "10 — Tributada com cobrança de ICMS por ST" },
  { value: "15", label: "15 — Monofásica própria e com retenção" },
  { value: "20", label: "20 — Com redução de base de cálculo" },
  { value: "30", label: "30 — Isenta/não tributada com ST" },
  { value: "40", label: "40 — Isenta" },
  { value: "41", label: "41 — Não tributada" },
  { value: "50", label: "50 — Suspensão" },
  { value: "51", label: "51 — Diferimento" },
  { value: "53", label: "53 — Monofásica com recolhimento diferido" },
  { value: "60", label: "60 — ICMS cobrado anteriormente por ST" },
  { value: "61", label: "61 — Monofásica cobrada anteriormente" },
  { value: "70", label: "70 — Redução de base com ST" },
  { value: "90", label: "90 — Outras" },
];

export type Regime = "simples" | "normal";

/** Regime de ICMS da empresa: Simples Nacional (CRT 1/2 → CSOSN) ou regime normal (CRT 3 → CST). */
export function companyRegime(company: { regime?: string | null; crt?: string | null } | null | undefined): Regime {
  if (!company) return "simples";
  if (company.crt) return company.crt === "3" ? "normal" : "simples";
  return company.regime === "simples" || company.regime === "mei" ? "simples" : "normal";
}

export function cstOptionsFor(regime: Regime) {
  return regime === "simples" ? CSOSN_OPTIONS : CST_ICMS_OPTIONS;
}

// ───────────────────────────── Validações

/** GTIN/EAN-8/12/13/14 com dígito verificador (módulo 10). */
export function isValidGtin(code: string): boolean {
  const d = onlyDigits(code);
  if (![8, 12, 13, 14].includes(d.length) || d !== code.trim()) return false;
  const digits = d.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((n, i) => (sum += n * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

export function normalizeSkuCode(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export interface FiscalInput {
  ncm?: string | null;
  cest?: string | null;
  origin?: string | null;
  taxGroupId?: string | null;
  cfop?: string | null;
  cstCsosn?: string | null;
  serviceListItem?: string | null;
  municipalServiceCode?: string | null;
  issRateBps?: number | null;
  cnaeService?: string | null;
}

/** Normaliza e valida os campos fiscais conforme tipo (produto/serviço) e regime da empresa. */
export function normalizeFiscal(type: "product" | "service", f: FiscalInput, regime: Regime) {
  const ncm = onlyDigits(f.ncm) || null;
  const cest = onlyDigits(f.cest) || null;
  const cfop = onlyDigits(f.cfop) || null;
  const cst = (f.cstCsosn ?? "").trim() || null;
  if (type === "product") {
    if (ncm) assert(ncm.length === 8, "NCM deve ter 8 dígitos.");
    if (cest) assert(cest.length === 7, "CEST deve ter 7 dígitos.");
    if (f.origin != null && f.origin !== "") assert(/^[0-8]$/.test(f.origin), "Origem da mercadoria inválida (0 a 8).");
    if (cfop) assert(cfop.length === 4 && /^[567]/.test(cfop), "CFOP de saída deve ter 4 dígitos e começar com 5, 6 ou 7.");
    if (cst) {
      const opts = cstOptionsFor(regime).map((o) => o.value);
      assert(opts.includes(cst), regime === "simples" ? "Empresa do Simples Nacional usa CSOSN (3 dígitos): 101, 102, 103, 201, 202, 203, 300, 400, 500 ou 900." : "Empresa do regime normal usa CST do ICMS (2 dígitos).");
    }
    return { ncm, cest, origin: f.origin || "0", taxGroupId: f.taxGroupId || null, cfop, cstCsosn: cst, serviceListItem: null, municipalServiceCode: null, issRateBps: null, cnaeService: null };
  }
  const item = (f.serviceListItem ?? "").trim() || null;
  if (item) assert(/^\d{1,2}\.\d{2}$/.test(item), "Item da lista de serviços (LC 116) no formato 00.00 (ex.: 14.09).");
  if (f.issRateBps != null) assert(f.issRateBps >= 0 && f.issRateBps <= 500, "Alíquota de ISS deve estar entre 0% e 5%.");
  return {
    ncm: null, cest: null, origin: null, taxGroupId: null, cfop: null, cstCsosn: null,
    serviceListItem: item, municipalServiceCode: (f.municipalServiceCode ?? "").trim() || null, issRateBps: f.issRateBps ?? null, cnaeService: onlyDigits(f.cnaeService) || null,
  };
}

/** Pendências fiscais que impedem emissão (exibidas como alerta; não bloqueiam o cadastro). */
export function fiscalIssues(p: Record<string, any>, taxGroup?: Record<string, any> | null): string[] {
  const out: string[] = [];
  if (p.type === "service") {
    if (!p.serviceListItem) out.push("Item da lista de serviços (LC 116) não informado");
    if (!p.municipalServiceCode) out.push("Código de tributação municipal não informado");
    if (p.issRateBps == null) out.push("Alíquota de ISS não informada");
    return out;
  }
  if (!p.ncm) out.push("NCM não informado");
  if (!p.taxGroupId && !(p.cfop && p.cstCsosn)) out.push("Sem grupo tributário (ou CFOP e CST/CSOSN próprios)");
  if (taxGroup && taxGroup.active === false) out.push("Grupo tributário inativo");
  return out;
}

const ST_CODES = new Set(["201", "202", "203", "500", "10", "30", "60", "70"]);

export function formatNcm(ncm: string | null | undefined) {
  const d = onlyDigits(ncm);
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
}

export function formatCest(cest: string | null | undefined) {
  const d = onlyDigits(cest);
  return d.length === 7 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}` : d;
}

/**
 * Situação fiscal resumida (lista de produtos): Incompleto (falta NCM/tributação ou ISS),
 * Revisar (CEST ausente em item com substituição tributária, grupo inativo, código municipal ausente)
 * ou Configurado. É um alerta de preenchimento — a validação tributária é do contador.
 */
export function fiscalStatus(p: Record<string, any>, taxGroup?: Record<string, any> | null): { status: "ok" | "review" | "incomplete"; label: string; detail: string } {
  if (p.type === "service") {
    if (!p.serviceListItem || p.issRateBps == null) return { status: "incomplete", label: "Incompleto", detail: !p.serviceListItem ? "Item LC 116 pendente" : "Alíquota ISS pendente" };
    if (!p.municipalServiceCode) return { status: "review", label: "Revisar", detail: "Código municipal pendente" };
    return { status: "ok", label: "Configurado", detail: `LC 116 ${p.serviceListItem}` };
  }
  if (!p.ncm) return { status: "incomplete", label: "Incompleto", detail: "NCM pendente" };
  if (!p.taxGroupId && !(p.cfop && p.cstCsosn)) return { status: "incomplete", label: "Incompleto", detail: "Tributação pendente" };
  if (taxGroup && taxGroup.active === false) return { status: "review", label: "Revisar", detail: "Grupo tributário inativo" };
  const cst = p.cstCsosn || taxGroup?.cstCsosn;
  if (cst && ST_CODES.has(cst) && !p.cest) return { status: "review", label: "Revisar", detail: "CEST pendente" };
  return { status: "ok", label: "Configurado", detail: `NCM ${formatNcm(p.ncm)}` };
}

/**
 * Tributação efetiva por operação: o produto pode sobrepor CFOP e CST/CSOSN do grupo tributário.
 * Venda interna/interestadual e devolução usam os CFOPs do grupo quando o produto não define o seu.
 */
export function effectiveFiscal(p: Record<string, any>, taxGroup: Record<string, any> | null | undefined) {
  const cst = p.cstCsosn || taxGroup?.cstCsosn || null;
  return [
    { operation: "Venda dentro do estado", cfop: p.cfop || taxGroup?.cfopInternal || null, cst, source: p.cfop ? "produto" : taxGroup ? "grupo" : null },
    { operation: "Venda para outro estado", cfop: p.cfop ? `6${String(p.cfop).slice(1)}` : taxGroup?.cfopInterstate || null, cst, source: p.cfop ? "produto (6xxx)" : taxGroup ? "grupo" : null },
    { operation: "Devolução de venda (entrada)", cfop: taxGroup?.cfopReturn || null, cst, source: taxGroup ? "grupo" : null },
  ];
}

// ───────────────────────────── Variações

export interface Axis {
  name: string;
  values: string[];
}

export interface VariantInput {
  id?: string | null;
  sku?: string | null;
  barcode?: string | null;
  extraBarcodes?: string[];
  attributes: Record<string, string>;
  active?: boolean;
}

/** Combinações (produto cartesiano) dos valores dos eixos — ex.: cor × tamanho. */
export function generateVariantCombos(axes: Axis[]): Array<Record<string, string>> {
  const clean = axes.map((a) => ({ name: a.name.trim(), values: [...new Set(a.values.map((v) => v.trim()).filter(Boolean))] })).filter((a) => a.name && a.values.length);
  if (!clean.length) return [];
  let out: Array<Record<string, string>> = [{}];
  for (const a of clean) out = out.flatMap((o) => a.values.map((v) => ({ ...o, [a.name]: v })));
  return out;
}

export function variantSkuCode(productCode: string, attrs: Record<string, string>) {
  const vals = Object.values(attrs).filter(Boolean);
  return normalizeSkuCode(vals.length ? `${productCode}-${vals.join("-")}` : productCode);
}

export function variantName(productName: string, attrs: Record<string, string>) {
  const vals = Object.values(attrs ?? {}).filter(Boolean);
  return vals.length ? `${productName} ${vals.join(" ")}` : productName;
}

/** Eixos do produto (aceita o formato antigo: lista de nomes). */
export function productAxes(product: Record<string, any>, skus: Array<Record<string, any>> = []): Axis[] {
  const raw = (product.variantAxes ?? []) as Array<string | Axis>;
  return raw.map((a) => {
    if (typeof a !== "string") return a;
    const values = [...new Set(skus.map((s) => s.attributes?.[a]).filter(Boolean))] as string[];
    return { name: a, values };
  });
}

// ───────────────────────────── Uso (para excluir × inativar)

export async function skuUsage(store: Store, skuId: string) {
  const one = async (collection: string, filters: any[]) => (await store.list(collection, { filters, limit: 1, total: false })).items.length;
  const [movements, sales, purchases, inventories, reservations] = await Promise.all([
    one("stock_movements", [["eq", "skuId", skuId]]),
    one("sale_items", [["eq", "skuId", skuId]]),
    one("purchase_order_items", [["eq", "skuId", skuId]]),
    one("inventory_counts", [["eq", "skuId", skuId]]),
    one("stock_reservations", [["eq", "skuId", skuId]]),
  ]);
  return { movements, sales, purchases, inventories, reservations, any: movements + sales + purchases + inventories + reservations > 0 };
}

export async function productUsage(store: Store, productId: string) {
  const skus = await listAll(store, "skus", { filters: [["eq", "productId", productId]] });
  let any = false;
  const detail = { movements: 0, sales: 0, purchases: 0, inventories: 0, reservations: 0 };
  for (const s of skus) {
    const u = await skuUsage(store, s.id);
    for (const k of Object.keys(detail) as Array<keyof typeof detail>) detail[k] += u[k];
    any = any || u.any;
  }
  return { ...detail, any, skus: skus.length };
}

// ───────────────────────────── Cadastro

export interface ProductInput extends FiscalInput {
  type: "product" | "service";
  /** rascunho: salvo sem liberar para venda (inativo até concluir o cadastro) */
  draft?: boolean;
  code?: string | null;
  name: string;
  description?: string | null;
  gtin?: string | null;
  unitCode: string;
  categoryId?: string | null;
  brandId?: string | null;
  supplierId?: string | null;
  active?: boolean;
  availablePdv?: boolean;
  availableEcommerce?: boolean;
  weightGrams?: number | null;
}

export interface AdditionalCost {
  name: string;
  amount: number;
}

export interface CreateExtras {
  sku?: string | null;
  axes?: Axis[];
  variants?: VariantInput[];
  costAcquisition?: number;
  additionalCosts?: AdditionalCost[];
  price?: number | null;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
  maxDiscountBps?: number | null;
  /** saldo inicial e parâmetros no depósito informado (filial atual) */
  stock?: { warehouseId: string; qty?: number; unitCost?: number | null; minQty?: number; maxQty?: number; safetyQty?: number; reorderMultiple?: number; location?: string | null } | null;
  idemKey?: string | null;
}

async function companyDoc(ctx: Ctx) {
  return ctx.store.getOrThrow("companies", ctx.companyId);
}

async function assertRef(ctx: Ctx, collection: string, id: string | null | undefined, label: string) {
  if (!id) return null;
  const d = await ctx.store.get(collection, id);
  assert(d && d.companyId === ctx.companyId, `${label} inválido(a).`);
  return d;
}

async function validateGeneral(ctx: Ctx, input: ProductInput, before?: Record<string, any> | null) {
  assert(input.name?.trim(), "Informe o nome do produto.");
  assert(input.name.trim().length <= 200, "Nome com no máximo 200 caracteres.");
  assert(input.type === "product" || input.type === "service", "Tipo inválido.");
  assert(input.unitCode, "Informe a unidade.");
  const unit = await findOne(ctx.store, "units", [["eq", "companyId", ctx.companyId], ["eq", "code", input.unitCode]]);
  assert(unit, `Unidade ${input.unitCode} não cadastrada.`);
  await assertRef(ctx, "categories", input.categoryId, "Categoria");
  await assertRef(ctx, "brands", input.brandId, "Marca");
  await assertRef(ctx, "suppliers", input.supplierId, "Fornecedor");
  if (input.taxGroupId) await assertRef(ctx, "tax_groups", input.taxGroupId, "Grupo tributário");
  // valida o GTIN quando informado/alterado (cadastros legados com GTIN já gravado não bloqueiam outras edições)
  if (input.gtin && input.gtin !== before?.gtin) assert(isValidGtin(input.gtin), "GTIN/EAN inválido (verifique os dígitos e o dígito verificador).");
}

async function productSearchText(store: Store, p: Record<string, any>, skus?: Array<Record<string, any>>) {
  const list = skus ?? (p.id ? await listAll(store, "skus", { filters: [["eq", "productId", p.id]] }) : []);
  const [brand, cat] = await Promise.all([p.brandId ? store.get("brands", p.brandId) : null, p.categoryId ? store.get("categories", p.categoryId) : null]);
  return searchable(p.name, p.code, p.gtin, brand?.name, cat?.name, ...list.flatMap((s) => [s.sku, s.barcode, ...(s.extraBarcodes ?? [])]));
}

async function refreshProductSearch(store: Store, productId: string) {
  const p = await store.get("products", productId);
  if (!p) return;
  const text = await productSearchText(store, p);
  if (text !== p.searchText) await store.update("products", productId, { searchText: text });
}

/** Garante que os códigos de barras não estão em uso por outro SKU da empresa. */
export async function assertBarcodesFree(ctx: Ctx, codes: string[], exceptSkuIds: string[] = []) {
  const seen = new Set<string>();
  for (const raw of codes) {
    const c = raw.trim();
    if (!c) continue;
    assert(!seen.has(c), `Código de barras ${c} repetido.`);
    seen.add(c);
    const hit = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["or", [["eq", "barcode", c], ["contains", "extraBarcodes", c]]]]);
    if (hit && !exceptSkuIds.includes(hit.id)) throw new BusinessError(`Código de barras ${c} já pertence ao SKU ${hit.sku}.`, "duplicate");
  }
}

async function assertSkuCodesFree(ctx: Ctx, codes: string[], exceptSkuIds: string[] = []) {
  const seen = new Set<string>();
  for (const c of codes) {
    assert(c, "Informe o código SKU de todas as variações.");
    assert(!seen.has(c), `SKU ${c} repetido.`);
    seen.add(c);
    const hit = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["eq", "sku", c]]);
    if (hit && !exceptSkuIds.includes(hit.id)) throw new BusinessError(`O SKU ${c} já existe (${hit.name}).`, "duplicate");
  }
}

async function nextProductCode(ctx: Ctx): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const n = await nextNumber(ctx.store, `product:${ctx.companyId}`);
    const code = String(n).padStart(6, "0");
    if (!(await findOne(ctx.store, "products", [["eq", "companyId", ctx.companyId], ["eq", "code", code]]))) return code;
  }
  throw new BusinessError("Não foi possível gerar o código do produto; informe um código.");
}

function buildProductData(input: ProductInput, fiscal: ReturnType<typeof normalizeFiscal>) {
  const active = input.draft ? false : (input.active ?? true);
  return {
    type: input.type,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    gtin: input.gtin?.trim() || null,
    unitCode: input.unitCode,
    categoryId: input.categoryId || null,
    brandId: input.brandId || null,
    supplierId: input.supplierId || null,
    active,
    status: input.draft ? "draft" : active ? "active" : "inactive",
    availablePdv: input.availablePdv ?? true,
    availableEcommerce: input.availableEcommerce ?? false,
    weightGrams: input.weightGrams ?? null,
    ...fiscal,
  };
}

type PlannedVariant = VariantInput & { sku: string; barcode: string | null; extraBarcodes: string[] };

/** SKUs a criar a partir dos eixos/variações informados (ou do próprio produto, na retomada). */
function planVariants(input: ProductInput, extras: CreateExtras, code: string, product?: Doc | null): { axes: Axis[]; planned: PlannedVariant[] } {
  let axes = (extras.axes ?? []).filter((a) => a.name && a.values.length);
  if (!axes.length && !extras.variants?.length && product?.hasVariants) axes = ((product.variantAxes ?? []) as Axis[]).filter((a) => a.name && a.values.length);
  const variants: VariantInput[] = axes.length
    ? (extras.variants?.length ? extras.variants : generateVariantCombos(axes).map((attributes) => ({ attributes })))
    : [{ attributes: {}, sku: extras.sku || code, barcode: input.gtin || product?.gtin || null }];
  const planned = variants.map((v) => ({ ...v, sku: normalizeSkuCode(v.sku?.trim() || variantSkuCode(code, v.attributes)), barcode: v.barcode?.trim() || null, extraBarcodes: (v.extraBarcodes ?? []).map((x) => x.trim()).filter(Boolean) }));
  return { axes, planned };
}

interface CreateEffects {
  tableId: string | null;
  stock: { wh: Doc; params: boolean; initialQty: number } | null;
}

/**
 * Valida, ANTES de gravar qualquer coisa, tudo o que o cadastro fará depois: preço na tabela padrão
 * (tabela existente, permissão e valores), parâmetros de estoque e saldo inicial (permissões, filial,
 * depósito e quantidades). Assim uma falha não deixa produto/SKU gravados sem o restante.
 */
async function validateCreateEffects(ctx: Ctx, input: ProductInput, extras: CreateExtras, skuCount: number): Promise<CreateEffects> {
  let tableId: string | null = null;
  if (extras.price != null && extras.price > 0) {
    assert(can(ctx.user, "products", "edit"), "Você não tem permissão para definir preços (alteração de produtos). Deixe o preço em branco ou peça a quem tem a permissão.");
    tableId = await defaultPriceTableId(ctx.store, ctx.companyId);
    assert(tableId, "Cadastre uma tabela de preço padrão em Cadastros auxiliares.");
    validatePrice({ price: extras.price, wholesalePrice: extras.wholesalePrice ?? null, wholesaleMinQty: extras.wholesaleMinQty ?? null, maxDiscountBps: extras.maxDiscountBps ?? null });
  }
  let stock: CreateEffects["stock"] = null;
  const st = extras.stock;
  if (st && input.type === "product") {
    const params = { minQty: st.minQty ?? 0, maxQty: st.maxQty ?? 0, safetyQty: st.safetyQty ?? 0, reorderMultiple: st.reorderMultiple ?? 0 };
    const wantsParams = Boolean(params.minQty || params.maxQty || params.safetyQty || params.reorderMultiple || st.location?.trim());
    const initialQty = st.qty && st.qty > 0 && skuCount === 1 ? st.qty : 0;
    if (wantsParams) assert(canEditStockParams(ctx), "Você não tem permissão para alterar parâmetros de estoque.");
    if (initialQty) {
      assert(canPostInitial(ctx), "Você não tem permissão para lançar saldo inicial. Deixe o saldo inicial em branco ou peça a quem tem a permissão de estoque.");
      assert(Number.isInteger(initialQty), "Informe a quantidade inicial.");
    }
    const doParams = wantsParams || canEditStockParams(ctx);
    if (doParams || initialQty) {
      validateStockParams(params);
      stock = { wh: await branchWarehouse(ctx, st.warehouseId), params: doParams, initialQty };
    }
  }
  return { tableId, stock };
}

/**
 * Cria produto com seus SKUs, custos, preço padrão e (opcional) saldo inicial e parâmetros de estoque.
 * Tudo é validado antes da primeira gravação. Idempotente por `idemKey`: o reenvio devolve o mesmo
 * produto e completa o que tiver faltado (SKUs, preço, parâmetros, saldo inicial) — nunca responde
 * "cadastrado" com o cadastro pela metade.
 */
export async function createProduct(ctx: Ctx, input: ProductInput, extras: CreateExtras = {}) {
  requirePerm(ctx, "products", "create");
  const pid = extras.idemKey ? detId("product", ctx.companyId, extras.idemKey) : undefined;
  const existing = pid ? await ctx.store.get("products", pid) : null;
  if (existing) return completeProduct(ctx, existing, input, extras, true);
  await validateGeneral(ctx, input);
  const regime = companyRegime(await companyDoc(ctx));
  const fiscal = normalizeFiscal(input.type, input, regime);
  const code = input.code?.trim() ? input.code.trim().toUpperCase() : await nextProductCode(ctx);
  const dupCode = await findOne(ctx.store, "products", [["eq", "companyId", ctx.companyId], ["eq", "code", code]]);
  if (dupCode) throw new BusinessError(`Já existe produto com o código ${code}: ${dupCode.name}.`, "duplicate");

  // SKUs planejados e efeitos (validação completa antes de gravar)
  const { axes, planned } = planVariants(input, extras, code);
  await assertSkuCodesFree(ctx, planned.map((v) => v.sku));
  await assertBarcodesFree(ctx, planned.flatMap((v) => [v.barcode ?? "", ...v.extraBarcodes]));
  for (const v of planned) for (const b of [v.barcode, ...v.extraBarcodes]) if (b && /^\d+$/.test(b)) assert(isValidGtin(b), `Código de barras ${b} inválido.`);
  const effects = await validateCreateEffects(ctx, input, extras, planned.length);

  let product: Doc;
  try {
    product = await ctx.store.create<any>(
      "products",
      { companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, code, ...buildProductData(input, fiscal), hasVariants: axes.length > 0, variantAxes: axes, searchText: searchable(input.name, code, input.gtin) },
      pid,
    );
  } catch (e) {
    if (isConflict(e)) {
      if (pid) {
        const again = await ctx.store.get("products", pid);
        if (again) return completeProduct(ctx, again, input, extras, true);
      }
      throw new BusinessError(`Já existe produto com o código ${code}.`, "duplicate");
    }
    throw e;
  }
  return completeProduct(ctx, product, input, extras, false, effects);
}

/**
 * Grava (ou completa, na repetição) SKUs, preço padrão, parâmetros de estoque e saldo inicial do produto.
 * Cada efeito é idempotente: SKU por id determinístico, preço por escopo (tabela × SKU), parâmetros por
 * comparação e saldo inicial pela chave `initial:<saldo>`.
 */
async function completeProduct(ctx: Ctx, product: Doc, input: ProductInput, extras: CreateExtras, resumed: boolean, validated?: CreateEffects) {
  const code = product.code as string;
  const existingSkus = await listAll(ctx.store, "skus", { filters: [["eq", "productId", product.id]] });
  const { planned } = planVariants(input, extras, code, product);
  const sameAttrs = (a: Record<string, string> | null | undefined, b: Record<string, string>) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
  const missing = planned.filter((v) => !existingSkus.some((s) => s.id === detId("sku", product.id, v.sku) || s.sku === v.sku || sameAttrs(s.attributes, v.attributes)));
  if (resumed && missing.length) {
    await assertSkuCodesFree(ctx, missing.map((v) => v.sku));
    await assertBarcodesFree(ctx, missing.flatMap((v) => [v.barcode ?? "", ...v.extraBarcodes]));
  }
  const effects = validated ?? (await validateCreateEffects(ctx, input, extras, existingSkus.length + missing.length));
  const additional = (extras.additionalCosts ?? []).filter((c) => c.name?.trim() && c.amount);
  const costAcq = Math.max(0, extras.costAcquisition ?? 0);
  const costAdd = additional.reduce((a, c) => a + c.amount, 0);
  const done: string[] = [];

  const skus: Doc[] = [...existingSkus];
  for (const v of missing) {
    const skuId = detId("sku", product.id, v.sku);
    let sku: Doc;
    try {
      sku = await ctx.store.create(
        "skus",
        {
          companyId: ctx.companyId, createdBy: ctx.user.id, productId: product.id, sku: v.sku, barcode: v.barcode, extraBarcodes: v.extraBarcodes, attributes: v.attributes,
          name: variantName(product.name, v.attributes), unitCode: product.unitCode, active: v.active ?? true, costAcquisition: costAcq, costAdditional: costAdd, costTotal: costAcq + costAdd,
          additionalCosts: additional, searchText: searchable(variantName(product.name, v.attributes), v.sku, v.barcode, ...v.extraBarcodes),
        },
        skuId,
      );
    } catch (e) {
      if (!isConflict(e)) throw e;
      const again = await ctx.store.get("skus", skuId);
      if (!again) throw e;
      skus.push(again);
      continue;
    }
    skus.push(sku);
    done.push(`SKU ${v.sku}`);
    if (costAcq || costAdd) {
      await recordPriceHistory(ctx, [
        { skuId: sku.id, productId: product.id, field: "costAcquisition", oldValue: null, newValue: costAcq, reason: "Custo inicial do cadastro" },
        { skuId: sku.id, productId: product.id, field: "costTotal", oldValue: null, newValue: costAcq + costAdd, reason: "Custo inicial do cadastro" },
      ]);
    }
  }
  if (done.length) await ctx.store.update("products", product.id, { searchText: await productSearchText(ctx.store, product, skus) });

  // preço padrão na tabela padrão da empresa (SKUs ainda sem preço geral nessa tabela)
  if (effects.tableId && extras.price != null && extras.price > 0) {
    for (const sku of skus) {
      if (await ctx.store.get("prices", detId("price", priceScopeKey(effects.tableId, sku.id, null, null)))) continue;
      await savePrice(ctx, { priceTableId: effects.tableId, skuId: sku.id, price: extras.price, wholesalePrice: extras.wholesalePrice ?? null, wholesaleMinQty: extras.wholesaleMinQty ?? null, maxDiscountBps: extras.maxDiscountBps ?? null, reason: "Preço inicial do cadastro" });
      done.push(`preço de ${sku.sku}`);
    }
  }
  // estoque: parâmetros e saldo inicial (movimento identificado)
  const st = extras.stock;
  if (effects.stock && st) {
    for (const sku of skus) {
      if (effects.stock.params) {
        await saveStockParams(ctx, { warehouseId: effects.stock.wh.id, skuId: sku.id, minQty: st.minQty ?? 0, maxQty: st.maxQty ?? 0, safetyQty: st.safetyQty ?? 0, reorderMultiple: st.reorderMultiple ?? 0, location: st.location ?? null });
      }
      if (effects.stock.initialQty && skus.length === 1) {
        const bal = await ensureBalance(ctx.store, ctx, effects.stock.wh.id, sku.id);
        if (!(await ctx.store.get("stock_movements", detId("mov", `initial:${bal.id}`)))) {
          await postInitialBalance(ctx, { warehouseId: effects.stock.wh.id, skuId: sku.id, qty: effects.stock.initialQty, unitCost: st.unitCost ?? costAcq + costAdd });
          done.push("saldo inicial");
        }
      }
    }
  }
  if (!resumed) {
    await audit(ctx, {
      module: "products",
      action: "product.create",
      entityType: "product",
      entityId: product.id,
      summary: `${input.type === "service" ? "Serviço" : "Produto"} ${code} — ${product.name} ${input.draft ? "salvo como rascunho" : "cadastrado"} (${skus.length} SKU${skus.length > 1 ? "s" : ""})`,
      after: { code, name: product.name, skus: skus.map((s) => s.sku) },
    });
  } else if (done.length) {
    await audit(ctx, { module: "products", action: "product.create_completed", entityType: "product", entityId: product.id, summary: `Cadastro de ${code} — ${product.name} completado na nova tentativa: ${done.join(", ")}` });
  }
  return (await ctx.store.get("products", product.id))!;
}

/** Atualiza dados gerais e/ou fiscais (seção). Mantém os SKUs sincronizados (nome/unidade). */
export async function updateProduct(ctx: Ctx, id: string, patch: Partial<ProductInput>, section: "general" | "fiscal" | "all" = "all") {
  requirePerm(ctx, "products", "edit");
  const before = await ctx.store.getOrThrow("products", id);
  assert(before.companyId === ctx.companyId, "Produto de outra empresa.");
  const merged: ProductInput = { ...(before as any), ...patch, draft: patch.draft ?? before.status === "draft" };
  if (section !== "fiscal") await validateGeneral(ctx, merged, before);
  const regime = companyRegime(await companyDoc(ctx));
  const fiscal = normalizeFiscal(merged.type, merged, regime);
  if (merged.taxGroupId) await assertRef(ctx, "tax_groups", merged.taxGroupId, "Grupo tributário");
  let code = before.code;
  if (patch.code !== undefined && patch.code?.trim() && patch.code.trim().toUpperCase() !== before.code) {
    code = patch.code.trim().toUpperCase();
    const dup = await findOne(ctx.store, "products", [["eq", "companyId", ctx.companyId], ["eq", "code", code]]);
    if (dup && dup.id !== id) throw new BusinessError(`Já existe produto com o código ${code}: ${dup.name}.`, "duplicate");
  }
  if (merged.type !== before.type) {
    const usage = await productUsage(ctx.store, id);
    assert(!usage.movements && !usage.sales, "Não é possível trocar o tipo (produto/serviço) de um item com movimentos ou vendas.");
  }
  const data: Record<string, any> = section === "fiscal" ? { ...fiscal } : { code, ...buildProductData(merged, fiscal) };
  const after = await ctx.store.update<any>("products", id, data);
  const skus = await listAll(ctx.store, "skus", { filters: [["eq", "productId", id]] });
  if (after.name !== before.name || after.unitCode !== before.unitCode) {
    for (const s of skus) {
      const name = variantName(after.name, s.attributes ?? {});
      await ctx.store.update("skus", s.id, { name, unitCode: after.unitCode, searchText: searchable(name, s.sku, s.barcode, ...(s.extraBarcodes ?? [])) });
    }
  }
  await refreshProductSearch(ctx.store, id);
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit(ctx, { module: "products", action: section === "fiscal" ? "product.fiscal_update" : "product.update", entityType: "product", entityId: id, summary: `${section === "fiscal" ? "Dados fiscais" : "Cadastro"} de ${after.name} alterado(s)`, before: d.before, after: d.after });
  }
  return after;
}

/** Ativa/inativa (preserva histórico e referências). */
export async function setProductStatus(ctx: Ctx, id: string, active: boolean) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("products", id);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  const u = await ctx.store.update("products", id, { active, status: active ? "active" : "inactive" });
  await audit(ctx, { module: "products", action: active ? "product.activate" : "product.inactivate", entityType: "product", entityId: id, summary: `${p.name} ${active ? (p.status === "draft" ? "ativado (cadastro concluído)" : "reativado") : "inativado (histórico preservado)"}` });
  return u;
}

/** Exclusão definitiva — apenas sem uso (sem movimentos, vendas, compras, inventários ou reservas). */
export async function deleteProduct(ctx: Ctx, id: string) {
  requirePerm(ctx, "products", "delete");
  const p = await ctx.store.getOrThrow("products", id);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  const usage = await productUsage(ctx.store, id);
  if (usage.any) throw new BusinessError("Produto com histórico (movimentos, vendas, compras ou inventários) não pode ser excluído; use Inativar.", "in_use");
  const skus = await listAll(ctx.store, "skus", { filters: [["eq", "productId", id]] });
  for (const s of skus) await purgeSku(ctx, s.id);
  for (const c of await listAll(ctx.store, "unit_conversions", { filters: [["eq", "productId", id]] })) await ctx.store.delete("unit_conversions", c.id);
  await ctx.store.delete("products", id);
  await audit(ctx, { module: "products", action: "product.delete", entityType: "product", entityId: id, summary: `Produto ${p.code} — ${p.name} excluído (sem uso)`, before: { code: p.code, name: p.name } });
}

async function purgeSku(ctx: Ctx, skuId: string) {
  for (const p of await listAll(ctx.store, "prices", { filters: [["eq", "skuId", skuId]] })) await ctx.store.delete("prices", p.id);
  for (const b of await listAll(ctx.store, "stock_balances", { filters: [["eq", "skuId", skuId]] })) {
    assert(!b.physical && !b.reserved && !b.inTransit, "SKU com saldo não pode ser excluído.");
    await ctx.store.delete("stock_balances", b.id);
  }
  for (const sp of await listAll(ctx.store, "supplier_products", { filters: [["eq", "skuId", skuId]] })) await ctx.store.delete("supplier_products", sp.id);
  for (const h of await listAll(ctx.store, "price_history", { filters: [["eq", "skuId", skuId]] })) await ctx.store.delete("price_history", h.id);
  await ctx.store.delete("skus", skuId);
}

/** Imagem do produto: grava no bucket `images` e vincula ao cadastro. */
export async function setProductImage(ctx: Ctx, productId: string, file: { name: string; mime: string; data: Buffer }) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("products", productId);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  assert(/^image\/(png|jpeg|webp|gif)$/.test(file.mime), "Envie uma imagem PNG, JPG, WEBP ou GIF.");
  assert(file.data.length > 0 && file.data.length <= 5 * 1024 * 1024, "A imagem deve ter até 5 MB.");
  const f = await saveFile(ctx, { bucket: "images", name: file.name, mime: file.mime, data: file.data, entityType: "product", entityId: productId, kind: "product_image" });
  await ctx.store.update("products", productId, { imageFileId: f.id });
  await audit(ctx, { module: "products", action: "product.image", entityType: "product", entityId: productId, summary: `Imagem de ${p.name} atualizada (${file.name})` });
  return f;
}

export async function removeProductImage(ctx: Ctx, productId: string) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("products", productId);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  await ctx.store.update("products", productId, { imageFileId: null });
  await audit(ctx, { module: "products", action: "product.image_remove", entityType: "product", entityId: productId, summary: `Imagem de ${p.name} removida` });
}

// ───────────────────────────── Variações (SKUs)

/**
 * Salva eixos e variações: cria novos SKUs (herdando custo e preços da variação de referência),
 * atualiza os existentes e, ao passar de simples para variado, remove (sem uso) ou inativa o SKU único.
 */
export async function saveVariants(ctx: Ctx, productId: string, input: { axes: Axis[]; variants: VariantInput[] }) {
  requirePerm(ctx, "products", "edit");
  const product = await ctx.store.getOrThrow("products", productId);
  assert(product.companyId === ctx.companyId, "Produto de outra empresa.");
  const axes = input.axes.map((a) => ({ name: a.name.trim(), values: [...new Set(a.values.map((v) => v.trim()).filter(Boolean))] })).filter((a) => a.name && a.values.length);
  const existing = await listAll(ctx.store, "skus", { filters: [["eq", "productId", productId]] });
  const byId = new Map(existing.map((s) => [s.id, s]));
  const planned = input.variants.map((v) => ({
    ...v,
    sku: normalizeSkuCode(v.sku?.trim() || variantSkuCode(product.code, v.attributes)),
    barcode: v.barcode?.trim() || null,
    extraBarcodes: (v.extraBarcodes ?? []).map((x) => x.trim()).filter(Boolean),
    attributes: Object.fromEntries(Object.entries(v.attributes ?? {}).filter(([k, val]) => k && val)),
  }));
  assert(planned.length > 0, "Informe ao menos uma variação.");
  if (axes.length) for (const v of planned) assert(axes.every((a) => v.attributes[a.name]), `Variação ${v.sku}: preencha todos os atributos (${axes.map((a) => a.name).join(", ")}).`);
  const combos = new Set<string>();
  for (const v of planned) {
    const key = JSON.stringify(axes.map((a) => v.attributes[a.name] ?? ""));
    assert(!combos.has(key), `Combinação de atributos repetida (${Object.values(v.attributes).join(" / ") || "sem atributos"}).`);
    combos.add(key);
  }
  const keepIds = planned.filter((v) => v.id).map((v) => v.id!) as string[];
  for (const id of keepIds) assert(byId.has(id), "Variação não pertence a este produto.");
  await assertSkuCodesFree(ctx, planned.map((v) => v.sku), existing.map((s) => s.id));
  await assertBarcodesFree(ctx, planned.flatMap((v) => [v.barcode ?? "", ...v.extraBarcodes]), existing.map((s) => s.id));
  for (const v of planned) {
    const prev = v.id ? byId.get(v.id) : null;
    const known = new Set([prev?.barcode, ...(prev?.extraBarcodes ?? [])].filter(Boolean));
    for (const b of [v.barcode, ...v.extraBarcodes]) if (b && !known.has(b) && /^\d+$/.test(b)) assert(isValidGtin(b), `Código de barras ${b} inválido.`);
  }

  const reference = existing.find((s) => s.active !== false) ?? existing[0] ?? null;
  const refPrices = reference ? await listAll(ctx.store, "prices", { filters: [["eq", "skuId", reference.id]] }) : [];
  const created: string[] = [];
  const updated: string[] = [];
  for (const v of planned) {
    const name = variantName(product.name, v.attributes);
    const data = { sku: v.sku, barcode: v.barcode, extraBarcodes: v.extraBarcodes, attributes: v.attributes, name, active: v.active ?? true, unitCode: product.unitCode, searchText: searchable(name, v.sku, v.barcode, ...v.extraBarcodes) };
    if (v.id) {
      const before = byId.get(v.id)!;
      await ctx.store.update("skus", v.id, data);
      if (JSON.stringify([before.sku, before.barcode, before.extraBarcodes ?? [], before.attributes ?? {}, before.active]) !== JSON.stringify([data.sku, data.barcode, data.extraBarcodes, data.attributes, data.active])) updated.push(v.sku);
      continue;
    }
    // reaproveita SKU único sem atributos (produto simples → variado) quando não tem uso
    const simple = existing.find((s) => !Object.keys(s.attributes ?? {}).length && !keepIds.includes(s.id) && !created.includes(s.id));
    if (simple && axes.length && !(await skuUsage(ctx.store, simple.id)).any) {
      await ctx.store.update("skus", simple.id, data);
      keepIds.push(simple.id);
      updated.push(v.sku);
      continue;
    }
    const sku = await ctx.store.create(
      "skus",
      {
        companyId: ctx.companyId, createdBy: ctx.user.id, productId, ...data,
        costAcquisition: reference?.costAcquisition ?? 0, costAdditional: reference?.costAdditional ?? 0, costTotal: reference?.costTotal ?? 0, additionalCosts: reference?.additionalCosts ?? [],
      },
      detId("sku", productId, v.sku),
    );
    created.push(sku.id);
    for (const rp of refPrices) {
      await savePrice(ctx, { priceTableId: rp.priceTableId, skuId: sku.id, branchId: rp.branchId, price: rp.price, wholesalePrice: rp.wholesalePrice, wholesaleMinQty: rp.wholesaleMinQty, maxDiscountBps: rp.maxDiscountBps, validFrom: rp.validFrom, validTo: rp.validTo, reason: `Preço herdado da variação ${reference!.sku}` });
    }
  }
  // SKU simples remanescente num produto agora variado: inativa (com uso) ou exclui (sem uso)
  const removed: string[] = [];
  if (axes.length) {
    for (const s of existing) {
      if (keepIds.includes(s.id) || Object.keys(s.attributes ?? {}).length) continue;
      if ((await skuUsage(ctx.store, s.id)).any) await ctx.store.update("skus", s.id, { active: false });
      else await purgeSku(ctx, s.id);
      removed.push(s.sku);
    }
  }
  await ctx.store.update("products", productId, { hasVariants: axes.length > 0, variantAxes: axes });
  await refreshProductSearch(ctx.store, productId);
  await audit(ctx, {
    module: "products",
    action: "product.variants",
    entityType: "product",
    entityId: productId,
    summary: `Variações de ${product.name}: ${created.length} criada(s), ${updated.length} alterada(s)${removed.length ? `, SKU simples ${removed.join(", ")} retirado` : ""}`,
    after: { axes, created: created.length, updated, removed },
  });
  return { created: created.length, updated: updated.length, removed: removed.length };
}

/** Remove uma variação: exclui se não tem uso; senão inativa (preserva histórico). */
export async function removeVariant(ctx: Ctx, skuId: string) {
  requirePerm(ctx, "products", "edit");
  const sku = await ctx.store.getOrThrow("skus", skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  const siblings = await listAll(ctx.store, "skus", { filters: [["eq", "productId", sku.productId]] });
  assert(siblings.filter((s) => s.id !== skuId && s.active !== false).length > 0, "O produto precisa de ao menos uma variação ativa.");
  const usage = await skuUsage(ctx.store, skuId);
  if (usage.any) await ctx.store.update("skus", skuId, { active: false });
  else await purgeSku(ctx, skuId);
  await refreshProductSearch(ctx.store, sku.productId);
  await audit(ctx, { module: "products", action: usage.any ? "sku.inactivate" : "sku.delete", entityType: "product", entityId: sku.productId, summary: `Variação ${sku.sku} ${usage.any ? "inativada (possui histórico)" : "excluída (sem uso)"}`, related: [`sku:${skuId}`] });
  return { deleted: !usage.any };
}

// ───────────────────────────── Custos (visão complementar 2)

/**
 * Custo de aquisição + custos adicionais nomeados (frete, embalagem, impostos não recuperáveis…).
 * Custo total = aquisição + Σ adicionais. Cada alteração gera `price_history`.
 */
export async function saveSkuCosts(ctx: Ctx, skuId: string, input: { costAcquisition: number; additionalCosts: AdditionalCost[]; reason?: string | null; applyToAllVariants?: boolean }) {
  requirePerm(ctx, "products", "edit");
  const sku = await ctx.store.getOrThrow("skus", skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  assert(Number.isInteger(input.costAcquisition) && input.costAcquisition >= 0, "Custo de aquisição inválido.");
  const additional = input.additionalCosts.filter((c) => c.name?.trim()).map((c) => ({ name: c.name.trim().slice(0, 80), amount: Math.round(c.amount) }));
  for (const c of additional) assert(Number.isInteger(c.amount) && c.amount >= 0, `Valor inválido no custo "${c.name}".`);
  const costAdditional = additional.reduce((a, c) => a + c.amount, 0);
  const costTotal = input.costAcquisition + costAdditional;
  const targets = input.applyToAllVariants ? await listAll(ctx.store, "skus", { filters: [["eq", "productId", sku.productId]] }) : [sku];
  const reason = input.reason?.trim() || "Atualização de custo";
  for (const t of targets) {
    await ctx.store.update("skus", t.id, { costAcquisition: input.costAcquisition, costAdditional, costTotal, additionalCosts: additional });
    await recordPriceHistory(ctx, [
      { skuId: t.id, productId: t.productId, field: "costAcquisition", oldValue: t.costAcquisition ?? 0, newValue: input.costAcquisition, reason },
      { skuId: t.id, productId: t.productId, field: "costAdditional", oldValue: t.costAdditional ?? 0, newValue: costAdditional, reason },
      { skuId: t.id, productId: t.productId, field: "costTotal", oldValue: t.costTotal ?? 0, newValue: costTotal, reason },
    ]);
  }
  await audit(ctx, {
    module: "products",
    action: "sku.costs",
    entityType: "product",
    entityId: sku.productId,
    summary: `Custo de ${input.applyToAllVariants ? `${targets.length} variação(ões)` : sku.sku}: ${formatMoney(sku.costTotal ?? 0)} → ${formatMoney(costTotal)}`,
    before: { costAcquisition: sku.costAcquisition, costAdditional: sku.costAdditional, costTotal: sku.costTotal },
    after: { costAcquisition: input.costAcquisition, additionalCosts: additional, costTotal },
    reason,
    related: targets.map((t) => `sku:${t.id}`),
  });
  return { costTotal, updated: targets.length };
}

// ───────────────────────────── Estoque por filial/depósito

function canEditStockParams(ctx: Ctx) {
  return can(ctx.user, "products", "edit") || can(ctx.user, "stock", "edit");
}

/** Mínimo, máximo/alvo, estoque de segurança, múltiplo de compra e localização (não altera saldo). */
function validateStockParams(input: { minQty: number; maxQty: number; safetyQty: number; reorderMultiple: number }) {
  for (const [k, v] of Object.entries({ mínimo: input.minQty, máximo: input.maxQty, segurança: input.safetyQty, múltiplo: input.reorderMultiple })) assert(Number.isInteger(v) && v >= 0, `Quantidade de ${k} inválida.`);
  if (input.maxQty > 0) assert(input.maxQty >= input.minQty, "O máximo/alvo deve ser maior ou igual ao mínimo.");
}

/** Depósito da filial ativa (empresa e filial conferidas). */
async function branchWarehouse(ctx: Ctx, warehouseId: string) {
  const branchId = requireBranch(ctx);
  const wh = await ctx.store.get("warehouses", warehouseId);
  assert(wh && wh.companyId === ctx.companyId && wh.branchId === branchId, "O depósito não pertence à filial selecionada.");
  return wh!;
}

export async function saveStockParams(ctx: Ctx, input: { warehouseId: string; skuId: string; minQty: number; maxQty: number; safetyQty: number; reorderMultiple: number; location?: string | null }) {
  assert(canEditStockParams(ctx), "Você não tem permissão para alterar parâmetros de estoque.");
  const wh = await branchWarehouse(ctx, input.warehouseId);
  validateStockParams(input);
  const sku = await ctx.store.get("skus", input.skuId);
  assert(sku && sku.companyId === ctx.companyId, "SKU não encontrado nesta empresa.");
  const bal = await ensureBalance(ctx.store, ctx, input.warehouseId, sku!.id);
  const patch = { minQty: input.minQty, maxQty: input.maxQty, safetyQty: input.safetyQty, reorderMultiple: input.reorderMultiple, location: input.location?.trim() || null };
  const d = diff(bal, patch);
  if (!Object.keys(d.after).length) return bal;
  const u = await ctx.store.update("stock_balances", bal.id, patch);
  await audit(ctx, { module: "products", action: "stock.params", entityType: "product", entityId: sku!.productId, summary: `Parâmetros de estoque de ${sku!.sku} em ${wh.name} alterados`, before: d.before, after: d.after, related: [`sku:${sku!.id}`] });
  return u;
}

/**
 * Saldo inicial: movimento identificado do tipo `initial` (uma única vez por saldo, só antes de qualquer
 * outro movimento). Depois disso, correções são feitas por ajuste (Tela 17) ou inventário.
 */
function canPostInitial(ctx: Ctx) {
  return canDo(ctx.user, "stock.adjust") || can(ctx.user, "stock", "create");
}

export async function postInitialBalance(ctx: Ctx, input: { warehouseId: string; skuId: string; qty: number; unitCost?: number | null }) {
  assert(canPostInitial(ctx), "Você não tem permissão para lançar saldo inicial.");
  const branchId = requireBranch(ctx);
  assert(Number.isInteger(input.qty) && input.qty > 0, "Informe a quantidade inicial.");
  const wh = await ctx.store.getOrThrow("warehouses", input.warehouseId);
  assert(wh.companyId === ctx.companyId && wh.branchId === branchId, "O depósito não pertence à filial selecionada.");
  const sku = await ctx.store.getOrThrow("skus", input.skuId);
  assert(sku.companyId === ctx.companyId, "SKU de outra empresa.");
  const product = await ctx.store.getOrThrow("products", sku.productId);
  assert(product.type !== "service", "Serviços não têm estoque.");
  const bal = await ensureBalance(ctx.store, ctx, input.warehouseId, input.skuId);
  const idemKey = `initial:${bal.id}`;
  const existing = await ctx.store.get("stock_movements", detId("mov", idemKey));
  if (existing) return existing;
  assert(!bal.seq, "Este saldo já possui movimentos; use um ajuste de estoque ou inventário.");
  const unitCost = input.unitCost ?? sku.costTotal ?? 0;
  const [mov] = await postMovements(ctx, [{ warehouseId: wh.id, skuId: sku.id, qty: input.qty, type: "initial", unitCost, originType: "product", originId: product.id, reason: "Saldo inicial do cadastro", idemKey }]);
  if (mov) {
    await audit(ctx, { module: "products", action: "stock.initial", entityType: "product", entityId: product.id, summary: `Saldo inicial de ${sku.sku} em ${wh.name}: ${input.qty / QTY} ${sku.unitCode ?? ""} a ${formatMoney(unitCost)}`, related: [`sku:${sku.id}`, `stock_movement:${mov.id}`] });
  }
  return mov ?? (await ctx.store.get("stock_movements", detId("mov", idemKey)));
}

// ───────────────────────────── Unidades e conversões

/** Conversão: 1 `fromUnit` = factor/1000 `toUnit` (ex.: 1 CX = 12 UN → factor 12000). */
export async function saveUnitConversion(ctx: Ctx, input: { productId: string; fromUnit: string; toUnit: string; factor: number }) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("products", input.productId);
  assert(p.companyId === ctx.companyId, "Produto de outra empresa.");
  assert(input.fromUnit && input.toUnit && input.fromUnit !== input.toUnit, "Informe unidades diferentes.");
  assert(input.fromUnit === p.unitCode || input.toUnit === p.unitCode, `Uma das unidades deve ser a unidade do produto (${p.unitCode}).`);
  assert(Number.isInteger(input.factor) && input.factor > 0, "Fator de conversão deve ser maior que zero.");
  for (const u of [input.fromUnit, input.toUnit]) assert(await findOne(ctx.store, "units", [["eq", "companyId", ctx.companyId], ["eq", "code", u]]), `Unidade ${u} não cadastrada.`);
  const id = detId("uconv", input.productId, input.fromUnit, input.toUnit);
  const existing = await ctx.store.get("unit_conversions", id);
  const data = { productId: input.productId, fromUnit: input.fromUnit, toUnit: input.toUnit, factor: input.factor };
  const doc = existing ? await ctx.store.update("unit_conversions", id, data) : await ctx.store.create("unit_conversions", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data }, id);
  await audit(ctx, { module: "products", action: "product.unit_conversion", entityType: "product", entityId: p.id, summary: `Conversão 1 ${input.fromUnit} = ${input.factor / QTY} ${input.toUnit} ${existing ? "alterada" : "cadastrada"}` });
  return doc;
}

export async function deleteUnitConversion(ctx: Ctx, id: string) {
  requirePerm(ctx, "products", "edit");
  const c = await ctx.store.getOrThrow("unit_conversions", id);
  assert(c.companyId === ctx.companyId, "Conversão de outra empresa.");
  await ctx.store.delete("unit_conversions", id);
  await audit(ctx, { module: "products", action: "product.unit_conversion_delete", entityType: "product", entityId: c.productId, summary: `Conversão 1 ${c.fromUnit} = ${c.factor / QTY} ${c.toUnit} removida` });
}

/** Converte quantidade (milésimos) entre unidades do produto usando as conversões cadastradas. */
export function convertQty(qty: number, from: string, to: string, conversions: Array<{ fromUnit: string; toUnit: string; factor: number }>): number | null {
  if (from === to) return qty;
  const direct = conversions.find((c) => c.fromUnit === from && c.toUnit === to);
  if (direct) return Math.round((qty * direct.factor) / QTY);
  const inverse = conversions.find((c) => c.fromUnit === to && c.toUnit === from);
  if (inverse) return Math.round((qty * QTY) / inverse.factor);
  return null;
}

// ───────────────────────────── Cadastros auxiliares

type AuxStatus = "active" | "inactive";

export async function saveCategory(ctx: Ctx, input: { id?: string | null; name: string; parentId?: string | null; status?: AuxStatus }) {
  requirePerm(ctx, "products", input.id ? "edit" : "create");
  const name = input.name?.trim();
  assert(name, "Informe o nome da categoria.");
  const all = await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] });
  // alteração só de categoria da própria empresa (a lista já é da empresa ativa)
  const before = input.id ? all.find((c) => c.id === input.id) : null;
  if (input.id) assert(before, "Categoria não encontrada.");
  const dup = all.find((c) => c.name.toLowerCase() === name.toLowerCase() && (c.parentId ?? null) === (input.parentId || null) && c.id !== input.id);
  assert(!dup, "Já existe categoria com este nome no mesmo nível.");
  if (input.parentId) {
    const byId = new Map(all.map((c) => [c.id, c]));
    assert(byId.has(input.parentId), "Categoria pai inválida.");
    let cur: string | null = input.parentId;
    for (let i = 0; cur && i < 50; i++) {
      assert(cur !== input.id, "A categoria pai não pode ser a própria categoria ou uma subcategoria dela.");
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  const data = { name, parentId: input.parentId || null, status: input.status ?? "active" };
  const doc = before ? await ctx.store.update("categories", before.id, data) : await ctx.store.create("categories", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data });
  const d = diff(before ?? null, data);
  await audit(ctx, { module: "products", action: before ? "category.update" : "category.create", entityType: "category", entityId: doc.id, summary: `Categoria ${name} ${before ? "alterada" : "cadastrada"}`, before: before ? d.before : undefined, after: d.after });
  return doc;
}

/** Ids da categoria e de todas as subcategorias. */
export function categoryDescendants(all: Array<{ id: string; parentId?: string | null }>, rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const c of all) if (c.parentId === out[i] && !out.includes(c.id)) out.push(c.id);
  return out;
}

export function categoryPath(all: Array<{ id: string; name: string; parentId?: string | null }>, id: string | null | undefined): string {
  if (!id) return "";
  const byId = new Map(all.map((c) => [c.id, c]));
  const parts: string[] = [];
  let cur = byId.get(id);
  for (let i = 0; cur && i < 20; i++) {
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

async function auxInUse(store: Store, checks: Array<[string, any[]]>) {
  for (const [collection, filters] of checks) if ((await store.list(collection, { filters, limit: 1, total: false })).items.length) return collection;
  return null;
}

async function auxDelete(ctx: Ctx, collection: string, id: string, label: string, checks: Array<[string, any[]]>) {
  requirePerm(ctx, "products", "delete");
  const d = await ctx.store.getOrThrow(collection, id);
  assert(d.companyId === ctx.companyId, "Registro de outra empresa.");
  const used = await auxInUse(ctx.store, checks);
  if (used) throw new BusinessError(`${label} em uso não pode ser excluído(a); inative.`, "in_use");
  await ctx.store.delete(collection, id);
  await audit(ctx, { module: "products", action: `${collection}.delete`, entityType: collection, entityId: id, summary: `${label} ${d.name ?? d.code} excluído(a)` });
}

export async function setAuxStatus(ctx: Ctx, collection: "categories" | "brands" | "units" | "price_tables" | "tax_groups", id: string, active: boolean) {
  requirePerm(ctx, "products", "edit");
  const d = await ctx.store.getOrThrow(collection, id);
  assert(d.companyId === ctx.companyId, "Registro de outra empresa.");
  if (collection === "price_tables") {
    assert(active || !d.isDefault, "A tabela padrão não pode ser inativada; defina outra como padrão antes.");
    await ctx.store.update(collection, id, { active });
  } else if (collection === "tax_groups") await ctx.store.update(collection, id, { active });
  else await ctx.store.update(collection, id, { status: active ? "active" : "inactive" });
  await audit(ctx, { module: "products", action: `${collection}.${active ? "activate" : "inactivate"}`, entityType: collection, entityId: id, summary: `${d.name ?? d.code} ${active ? "reativado(a)" : "inativado(a)"}` });
}

export const deleteCategory = (ctx: Ctx, id: string) =>
  auxDelete(ctx, "categories", id, "Categoria", [
    ["products", [["eq", "categoryId", id]]],
    ["categories", [["eq", "parentId", id]]],
  ]);

export async function saveBrand(ctx: Ctx, input: { id?: string | null; name: string; status?: AuxStatus }) {
  requirePerm(ctx, "products", input.id ? "edit" : "create");
  const name = input.name?.trim();
  assert(name, "Informe o nome da marca.");
  const all = await listAll(ctx.store, "brands", { filters: [["eq", "companyId", ctx.companyId]] });
  // alteração só de marca da própria empresa (a lista já é da empresa ativa)
  const before = input.id ? all.find((b) => b.id === input.id) : null;
  if (input.id) assert(before, "Marca não encontrada.");
  const dup = all.find((b) => b.name.toLowerCase() === name.toLowerCase() && b.id !== input.id);
  assert(!dup, "Já existe marca com este nome.");
  const data = { name, status: input.status ?? "active" };
  const doc = before ? await ctx.store.update("brands", before.id, data) : await ctx.store.create("brands", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data });
  const d = diff(before ?? null, data);
  await audit(ctx, { module: "products", action: before ? "brand.update" : "brand.create", entityType: "brand", entityId: doc.id, summary: `Marca ${name} ${before ? "alterada" : "cadastrada"}`, before: before ? d.before : undefined, after: d.after });
  return doc;
}

export const deleteBrand = (ctx: Ctx, id: string) => auxDelete(ctx, "brands", id, "Marca", [["products", [["eq", "brandId", id]]]]);

export async function saveUnit(ctx: Ctx, input: { id?: string | null; code: string; name: string; decimals: number; status?: AuxStatus }) {
  requirePerm(ctx, "products", input.id ? "edit" : "create");
  const code = input.code?.trim().toUpperCase();
  assert(code && /^[A-Z0-9]{1,6}$/.test(code), "Código da unidade: 1 a 6 letras/dígitos (ex.: UN, KG, CX12).");
  assert(input.name?.trim(), "Informe a descrição da unidade.");
  assert(Number.isInteger(input.decimals) && input.decimals >= 0 && input.decimals <= 3, "Casas decimais entre 0 e 3.");
  if (input.id) {
    const before = await ctx.store.getOrThrow("units", input.id);
    assert(before.companyId === ctx.companyId, "Unidade de outra empresa.");
    if (before.code !== code) {
      const used = await auxInUse(ctx.store, [["products", [["eq", "companyId", ctx.companyId], ["eq", "unitCode", before.code]]], ["unit_conversions", [["eq", "companyId", ctx.companyId], ["eq", "fromUnit", before.code]]], ["unit_conversions", [["eq", "companyId", ctx.companyId], ["eq", "toUnit", before.code]]]]);
      assert(!used, "Unidade em uso: o código não pode ser alterado.");
    }
  }
  const dup = await findOne(ctx.store, "units", [["eq", "companyId", ctx.companyId], ["eq", "code", code]]);
  assert(!dup || dup.id === input.id, `Unidade ${code} já cadastrada.`);
  const data = { code, name: input.name.trim(), decimals: input.decimals, status: input.status ?? "active" };
  try {
    const doc = input.id ? await ctx.store.update("units", input.id, data) : await ctx.store.create("units", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data });
    await audit(ctx, { module: "products", action: input.id ? "unit.update" : "unit.create", entityType: "unit", entityId: doc.id, summary: `Unidade ${code} — ${data.name} ${input.id ? "alterada" : "cadastrada"}` });
    return doc;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(`Unidade ${code} já cadastrada.`, "duplicate");
    throw e;
  }
}

export async function deleteUnit(ctx: Ctx, id: string) {
  const u = await ctx.store.getOrThrow("units", id);
  return auxDelete(ctx, "units", id, "Unidade", [
    ["products", [["eq", "companyId", ctx.companyId], ["eq", "unitCode", u.code]]],
    ["skus", [["eq", "companyId", ctx.companyId], ["eq", "unitCode", u.code]]],
    ["unit_conversions", [["eq", "companyId", ctx.companyId], ["eq", "fromUnit", u.code]]],
    ["unit_conversions", [["eq", "companyId", ctx.companyId], ["eq", "toUnit", u.code]]],
  ]);
}

/** Tabelas de preço: exatamente uma padrão ativa; a padrão não pode ser inativada. */
export async function savePriceTable(ctx: Ctx, input: { id?: string | null; name: string; kind?: string | null; active: boolean; isDefault: boolean; notes?: string | null }) {
  requirePerm(ctx, "products", input.id ? "edit" : "create");
  const name = input.name?.trim();
  assert(name, "Informe o nome da tabela.");
  const all = await listAll(ctx.store, "price_tables", { filters: [["eq", "companyId", ctx.companyId]] });
  assert(!all.find((t) => t.name.toLowerCase() === name.toLowerCase() && t.id !== input.id), "Já existe tabela com este nome.");
  if (input.isDefault) assert(input.active, "A tabela padrão precisa estar ativa.");
  const before = input.id ? all.find((t) => t.id === input.id) : null;
  if (input.id) assert(before, "Tabela não encontrada.");
  if (before?.isDefault && !input.isDefault) throw new BusinessError("Para trocar a tabela padrão, marque outra tabela como padrão.");
  const data = { name, kind: input.kind || "retail", active: input.active, isDefault: input.isDefault || (!all.some((t) => t.isDefault && t.id !== input.id) && input.active), notes: input.notes?.trim() || null };
  const doc = input.id ? await ctx.store.update("price_tables", input.id, data) : await ctx.store.create("price_tables", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data });
  if (data.isDefault) for (const t of all) if (t.isDefault && t.id !== doc.id) await ctx.store.update("price_tables", t.id, { isDefault: false });
  await audit(ctx, { module: "products", action: input.id ? "price_table.update" : "price_table.create", entityType: "price_table", entityId: doc.id, summary: `Tabela de preço ${name} ${input.id ? "alterada" : "cadastrada"}${data.isDefault ? " (padrão)" : ""}` });
  return doc;
}

export async function deletePriceTable(ctx: Ctx, id: string) {
  const t = await ctx.store.getOrThrow("price_tables", id);
  assert(!t.isDefault, "A tabela padrão não pode ser excluída.");
  return auxDelete(ctx, "price_tables", id, "Tabela de preço", [
    ["prices", [["eq", "priceTableId", id]]],
    ["customers", [["eq", "priceTableId", id]]],
    ["branches", [["eq", "defaultPriceTableId", id]]],
  ]);
}

export interface TaxGroupInput {
  id?: string | null;
  name: string;
  regime?: string | null;
  cfopInternal?: string | null;
  cfopInterstate?: string | null;
  cfopReturn?: string | null;
  cstCsosn?: string | null;
  icmsRateBps?: number | null;
  icmsBaseReductionBps?: number | null;
  fcpRateBps?: number | null;
  pisCst?: string | null;
  pisRateBps?: number | null;
  cofinsCst?: string | null;
  cofinsRateBps?: number | null;
  ipiCst?: string | null;
  ipiRateBps?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  active?: boolean;
  notes?: string | null;
}

/** Grupos tributários: CFOP por operação e CST/CSOSN coerentes com o regime informado. */
export async function saveTaxGroup(ctx: Ctx, input: TaxGroupInput) {
  requirePerm(ctx, "products", input.id ? "edit" : "create");
  const name = input.name?.trim();
  assert(name, "Informe o nome do grupo tributário.");
  const regime: Regime = input.regime === "normal" ? "normal" : "simples";
  const cfop = (v: string | null | undefined, label: string, first: RegExp) => {
    const d = onlyDigits(v);
    if (!d) return null;
    assert(d.length === 4 && first.test(d), `${label}: CFOP inválido.`);
    return d;
  };
  const cst = (input.cstCsosn ?? "").trim() || null;
  if (cst) assert(cstOptionsFor(regime).some((o) => o.value === cst), regime === "simples" ? "Regime Simples Nacional usa CSOSN (3 dígitos)." : "Regime normal usa CST do ICMS (2 dígitos).");
  for (const [k, v] of Object.entries({ "ICMS": input.icmsRateBps, "redução de base": input.icmsBaseReductionBps, "FCP": input.fcpRateBps, "PIS": input.pisRateBps, "COFINS": input.cofinsRateBps, "IPI": input.ipiRateBps })) {
    if (v != null) assert(v >= 0 && v <= 10000, `Alíquota de ${k} inválida.`);
  }
  if (input.validFrom && input.validTo) assert(input.validTo >= input.validFrom, "Fim da vigência anterior ao início.");
  const data = {
    name, regime,
    cfopInternal: cfop(input.cfopInternal, "Venda interna", /^5/), cfopInterstate: cfop(input.cfopInterstate, "Venda interestadual", /^6/), cfopReturn: cfop(input.cfopReturn, "Devolução", /^[12]/),
    cstCsosn: cst, icmsRateBps: input.icmsRateBps ?? null, icmsBaseReductionBps: input.icmsBaseReductionBps ?? null, fcpRateBps: input.fcpRateBps ?? null,
    pisCst: input.pisCst?.trim() || null, pisRateBps: input.pisRateBps ?? null, cofinsCst: input.cofinsCst?.trim() || null, cofinsRateBps: input.cofinsRateBps ?? null,
    ipiCst: input.ipiCst?.trim() || null, ipiRateBps: input.ipiRateBps ?? null, validFrom: input.validFrom || null, validTo: input.validTo || null, active: input.active ?? true, notes: input.notes?.trim() || null,
  };
  const before = input.id ? await ctx.store.getOrThrow("tax_groups", input.id) : null;
  if (before) assert(before.companyId === ctx.companyId, "Grupo de outra empresa.");
  const doc = before ? await ctx.store.update("tax_groups", before.id, data) : await ctx.store.create("tax_groups", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data });
  const d = diff(before, data);
  await audit(ctx, { module: "products", action: before ? "tax_group.update" : "tax_group.create", entityType: "tax_group", entityId: doc.id, summary: `Grupo tributário ${name} ${before ? "alterado" : "cadastrado"}`, before: before ? d.before : undefined, after: d.after });
  return doc;
}

export const deleteTaxGroup = (ctx: Ctx, id: string) =>
  auxDelete(ctx, "tax_groups", id, "Grupo tributário", [
    ["products", [["eq", "taxGroupId", id]]],
    ["fiscal_configs", [["eq", "defaultTaxGroupId", id]]],
  ]);

// ───────────────────────────── Leitura

/** Saldos do SKU por depósito com disponível; útil nas abas de estoque. */
export async function productBalances(store: Store, productId: string) {
  const bals = await listAll(store, "stock_balances", { filters: [["eq", "productId", productId]] });
  return bals.map((b) => ({ ...b, available: (b.physical ?? 0) - (b.reserved ?? 0) }));
}

export { balanceId };
