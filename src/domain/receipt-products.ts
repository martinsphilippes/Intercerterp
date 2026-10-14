import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { getSetting } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { QTY, formatMoney, roundDiv } from "@/lib/money";
import { createProduct, isValidGtin } from "./products";
import { getReceipt, linkReceiptItems, type ReceiptItem } from "./receipts";

/**
 * Cadastro de produto a partir do item do XML na conferência do recebimento (COM-04).
 *  - Reaproveita `createProduct` (validações de GTIN, NCM, CEST, unidade e código) — nada de cadastro paralelo.
 *  - Nunca duplica GTIN: se o código de barras do XML já pertence a um SKU da empresa, o item é vinculado a esse
 *    produto (com aviso) em vez de criar outro.
 *  - Grava o vínculo em `supplier_products` (código do fornecedor + fator de conversão) para as próximas notas do
 *    mesmo fornecedor serem associadas automaticamente.
 *  - Preço de venda inicial: custo × (1 + margem padrão) quando há parâmetro de margem (ver `defaultMarginBps`);
 *    sem margem, fica em branco (o produto pode ser cadastrado sem preço) ou o informado na prévia.
 *  - Idempotente por item (`idemKey` receipt-item:<recebimento>:<item>): repetir não cria outro produto.
 */

/** Chaves aceitas para a margem padrão de precificação (pontos-base), na ordem de leitura. */
export const DEFAULT_MARGIN_KEYS = ["pricing.defaultMarginBps", "purchase.defaultMarginBps"] as const;

/** Margem padrão (pontos-base) para o preço inicial; 0 = sem parâmetro (preço em branco). */
export async function defaultMarginBps(store: Store, companyId: string, branchId: string | null | undefined) {
  for (const key of DEFAULT_MARGIN_KEYS) {
    const v = Number(await getSetting<unknown>(store, companyId, branchId, key, null));
    if (Number.isFinite(v) && v > 0) return Math.round(v);
  }
  return 0;
}

/** Preço sugerido = custo × (1 + margem). */
export function suggestedPrice(cost: number, marginBps: number) {
  if (!(marginBps > 0) || !(cost > 0)) return null;
  return roundDiv(cost * (10000 + marginBps), 10000);
}

const UNIT_ALIASES: Record<string, string> = {
  UND: "UN", UNID: "UN", UNIDADE: "UN", "UN.": "UN", U: "UN",
  "PÇ": "PC", PCS: "PC", PECA: "PC", "PEÇA": "PC",
  CXA: "CX", CAIXA: "CX",
  KGS: "KG", QUILO: "KG",
  MT: "M", MTS: "M", METRO: "M",
  PR: "PAR", PARES: "PAR",
};

/** Unidade interna para a unidade comercial do XML (código igual, sinônimo comum ou UN). */
export function unitFor(uCom: string | null | undefined, units: Array<{ code: string }>) {
  const codes = units.map((u) => u.code);
  const raw = (uCom ?? "").trim().toUpperCase();
  const hit = codes.find((c) => c.toUpperCase() === raw) ?? codes.find((c) => c.toUpperCase() === UNIT_ALIASES[raw]);
  return hit ?? codes.find((c) => c.toUpperCase() === "UN") ?? codes[0] ?? "UN";
}

export interface NewProductPlan {
  idx: number;
  cProd: string | null;
  xProd: string;
  name: string;
  /** GTIN válido do XML (null quando ausente ou inválido) */
  gtin: string | null;
  /** cEAN informado no XML mas com dígito verificador inválido (não é aproveitado) */
  invalidGtin: string | null;
  /** SKU da empresa que já tem este GTIN: o item será vinculado a ele */
  existing: { skuId: string; sku: string; name: string; productId: string } | null;
  ncm: string | null;
  cest: string | null;
  unitCode: string;
  uCom: string | null;
  cost: number;
  price: number | null;
  conversionFactor: number;
}

async function skuByBarcode(store: Store, companyId: string, code: string) {
  return findOne(store, "skus", [["eq", "companyId", companyId], ["or", [["eq", "barcode", code], ["contains", "extraBarcodes", code]]]]);
}

/** Prévia do cadastro dos itens sem vínculo (não estocados e já associados ficam de fora). */
export async function planProductsFromReceipt(ctx: Ctx, r: Doc): Promise<NewProductPlan[]> {
  const units = await listAll(ctx.store, "units", { filters: [["eq", "companyId", ctx.companyId]] });
  const active = units.filter((u) => u.status !== "inactive");
  const margin = await defaultMarginBps(ctx.store, ctx.companyId, r.branchId);
  const out: NewProductPlan[] = [];
  for (const it of (r.items ?? []) as ReceiptItem[]) {
    if (it.skuId || it.ignore) continue;
    const raw = onlyDigits(it.cEAN);
    const gtin = raw && isValidGtin(raw) ? raw : null;
    const hit = gtin ? await skuByBarcode(ctx.store, ctx.companyId, gtin) : null;
    const ncm = onlyDigits(it.ncm);
    const cest = onlyDigits(it.cest);
    const cost = Math.max(0, it.unitCost ?? it.invoiceUnitCost ?? 0);
    out.push({
      idx: it.idx, cProd: it.cProd ?? null, xProd: it.xProd ?? it.description, name: (it.xProd ?? it.description ?? "").trim().slice(0, 200),
      gtin, invalidGtin: raw && !gtin ? raw : null, existing: hit ? { skuId: hit.id, sku: hit.sku, name: hit.name, productId: hit.productId } : null,
      ncm: ncm.length === 8 ? ncm : null, cest: cest.length === 7 ? cest : null, unitCode: unitFor(it.uCom, active.length ? active : units), uCom: it.uCom ?? null,
      cost, price: suggestedPrice(cost, margin), conversionFactor: it.conversionFactor || QTY,
    });
  }
  return out;
}

/** Vínculo código do fornecedor → SKU (com fator), lembrado nas próximas notas do fornecedor. */
async function rememberSupplierCode(ctx: Ctx, supplierId: string, skuId: string, it: ReceiptItem) {
  if (!it.cProd) return;
  const clash = await findOne(ctx.store, "supplier_products", [["eq", "supplierId", supplierId], ["eq", "supplierCode", it.cProd]]);
  if (clash && clash.skuId !== skuId) return; // o código já aponta para outro produto: não sobrescreve
  const patch = { supplierCode: it.cProd, supplierDescription: it.xProd ?? null, conversionFactor: it.conversionFactor || QTY };
  const existing = await findOne(ctx.store, "supplier_products", [["eq", "supplierId", supplierId], ["eq", "skuId", skuId]]);
  if (existing) {
    await ctx.store.update("supplier_products", existing.id, patch);
    return;
  }
  try {
    await ctx.store.create("supplier_products", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, supplierId, skuId, preferred: false, ...patch }, detId("supprod", supplierId, skuId));
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
}

export interface NewProductRow {
  idx: number;
  name?: string | null;
  unitCode?: string | null;
  ncm?: string | null;
  cest?: string | null;
  /** preço de venda inicial (centavos); vazio = sem preço */
  price?: number | null;
  categoryId?: string | null;
}

export interface NewProductResult {
  idx: number;
  action: "created" | "linked_existing";
  skuId: string;
  productId: string;
  message: string;
}

/**
 * Cadastra (ou vincula, quando o GTIN já existe) os itens indicados do recebimento em conferência e associa os itens
 * aos SKUs. Linhas sem `idx` válido, já associadas ou não estocadas são ignoradas.
 */
export async function createProductsFromReceipt(ctx: Ctx, receiptId: string, rows: NewProductRow[]): Promise<NewProductResult[]> {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.receive");
  requirePerm(ctx, "products", "create");
  const branchId = requireBranch(ctx);
  const r = await getReceipt(ctx, receiptId);
  assert(r.branchId === branchId, `Recebimento nº ${r.number} é de outra filial: selecione a filial do recebimento.`);
  assert(r.status === "draft", "Recebimento já confirmado: cadastre o produto em Produtos.");
  assert(rows.length, "Selecione ao menos um item para cadastrar.");
  assert(rows.length <= 100, "Cadastre no máximo 100 itens por vez.");
  const plans = new Map((await planProductsFromReceipt(ctx, r)).map((p) => [p.idx, p]));
  const items = new Map(((r.items ?? []) as ReceiptItem[]).map((i) => [i.idx, i]));
  const canPrice = can(ctx.user, "products", "edit");
  const results: NewProductResult[] = [];
  const links: Array<{ idx: number; skuId: string; mapping: "created" | "barcode" }> = [];
  try {
    for (const row of rows) {
      const plan = plans.get(row.idx);
      const it = items.get(row.idx);
      if (!plan || !it) continue;
      const idemKey = `receipt-item:${r.id}:${row.idx}`;
      const ownProductId = detId("product", ctx.companyId, idemKey);
      // GTIN já cadastrado (fora deste mesmo cadastro idempotente): vincula ao existente
      if (plan.existing && plan.existing.productId !== ownProductId) {
        links.push({ idx: row.idx, skuId: plan.existing.skuId, mapping: "barcode" });
        await rememberSupplierCode(ctx, r.supplierId, plan.existing.skuId, it);
        results.push({ idx: row.idx, action: "linked_existing", skuId: plan.existing.skuId, productId: plan.existing.productId, message: `${plan.xProd}: o GTIN ${plan.gtin} já pertence a ${plan.existing.name} (SKU ${plan.existing.sku}) — item vinculado ao produto existente, nenhum produto novo criado.` });
        continue;
      }
      const name = (row.name ?? plan.name).trim();
      assert(name, `Item ${row.idx}: informe o nome do produto.`);
      const price = row.price != null && row.price > 0 ? row.price : null;
      let product: Doc;
      try {
        product = await createProduct(
          ctx,
          { type: "product", name, gtin: plan.gtin, unitCode: row.unitCode || plan.unitCode, ncm: row.ncm !== undefined ? row.ncm : plan.ncm, cest: row.cest !== undefined ? row.cest : plan.cest, supplierId: r.supplierId, categoryId: row.categoryId || null },
          { costAcquisition: plan.cost, price: canPrice ? price : null, idemKey },
        );
      } catch (e) {
        if (e instanceof BusinessError) throw new BusinessError(`${plan.xProd}: ${e.message}`, e.code, e.details);
        throw e;
      }
      const sku = (await listAll(ctx.store, "skus", { filters: [["eq", "productId", product.id]] }))[0];
      assert(sku, `${name}: SKU não criado.`);
      links.push({ idx: row.idx, skuId: sku.id, mapping: "created" });
      await rememberSupplierCode(ctx, r.supplierId, sku.id, it);
      const notes = [plan.invalidGtin ? `cEAN ${plan.invalidGtin} do XML inválido (não aproveitado)` : null, price && !canPrice ? "preço não definido (seu perfil não altera preços)" : null].filter(Boolean);
      results.push({ idx: row.idx, action: "created", skuId: sku.id, productId: product.id, message: `${name}: produto ${product.code} cadastrado${canPrice && price ? ` com preço ${formatMoney(price)}` : " sem preço de venda"}${notes.length ? ` (${notes.join("; ")})` : ""}.` });
    }
  } finally {
    // associa o que já foi cadastrado/vinculado mesmo que um item posterior falhe
    if (links.length) await linkReceiptItems(ctx, r.id, links);
    if (results.length) {
      await audit(ctx, {
        module: "purchases", action: "receipt.products_from_xml", entityType: "receipt", entityId: r.id,
        summary: `Recebimento nº ${r.number}: ${results.filter((x) => x.action === "created").length} produto(s) cadastrado(s) a partir do XML e ${results.filter((x) => x.action === "linked_existing").length} item(ns) vinculado(s) a produto existente pelo GTIN`,
        after: { results: results.map((x) => ({ idx: x.idx, action: x.action, skuId: x.skuId })) },
        related: results.map((x) => `product:${x.productId}`),
      });
    }
  }
  return results;
}
