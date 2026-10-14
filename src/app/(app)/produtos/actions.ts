"use server";

import { runAction, fstr, fopt, fbool, fint, fjson } from "@/lib/server/action";
import {
  createProduct,
  updateProduct,
  setProductStatus,
  deleteProduct,
  setProductImage,
  removeProductImage,
  saveVariants,
  removeVariant,
  saveSkuCosts,
  saveStockParams,
  postInitialBalance,
  saveUnitConversion,
  deleteUnitConversion,
  type ProductInput,
  type Axis,
  type VariantInput,
  type AdditionalCost,
} from "@/domain/products";
import { savePrice, deletePrice } from "@/domain/pricing";
import { analyzeCsv, previewImport, runImport, type ImportMode, type MatchBy } from "@/domain/product-import";
import { COMPOSITION_LABEL, compositionOf, removeComponent, saveComponent, setComposition } from "@/domain/product-components";
import { availableMap } from "@/domain/stock";
import { listAll } from "@/lib/db";
import { normalizeSearch } from "@/lib/list";

const optInt = (fd: FormData, k: string): number | null => {
  const v = fstr(fd, k);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
/** percentual digitado (ex.: "2,5") → pontos-base */
const optBps = (fd: FormData, k: string): number | null => {
  const v = fstr(fd, k).replace("%", "").replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

function parseProduct(fd: FormData): ProductInput {
  return {
    type: (fstr(fd, "type") as "product" | "service") || "product",
    code: fopt(fd, "code"),
    name: fstr(fd, "name"),
    description: fopt(fd, "description"),
    gtin: fopt(fd, "gtin"),
    unitCode: fstr(fd, "unitCode") || "UN",
    categoryId: fopt(fd, "categoryId"),
    brandId: fopt(fd, "brandId"),
    supplierId: fopt(fd, "supplierId"),
    active: fbool(fd, "active"),
    availablePdv: fbool(fd, "availablePdv"),
    availableEcommerce: fbool(fd, "availableEcommerce"),
    weightGrams: optInt(fd, "weightGrams"),
    ncm: fopt(fd, "ncm"),
    cest: fopt(fd, "cest"),
    origin: fopt(fd, "origin"),
    taxGroupId: fopt(fd, "taxGroupId"),
    cfop: fopt(fd, "cfop"),
    cstCsosn: fopt(fd, "cstCsosn"),
    serviceListItem: fopt(fd, "serviceListItem"),
    municipalServiceCode: fopt(fd, "municipalServiceCode"),
    issRateBps: optBps(fd, "issRate"),
    cnaeService: fopt(fd, "cnaeService"),
  };
}

export async function createProductAction(fd: FormData) {
  return runAction({ module: "products", op: "create", revalidate: ["/produtos"] }, async (s) => {
    const input = { ...parseProduct(fd), draft: fstr(fd, "status") === "draft" };
    const axes = fjson<Axis[]>(fd, "axes", []);
    const variants = fjson<VariantInput[]>(fd, "variants", []);
    const stockWh = fopt(fd, "stockWarehouseId");
    const p = await createProduct(s.ctx, input, {
      idemKey: fopt(fd, "_idem"),
      sku: fopt(fd, "sku"),
      axes,
      variants,
      costAcquisition: fint(fd, "costAcquisition"),
      additionalCosts: fjson<AdditionalCost[]>(fd, "additionalCosts", []),
      price: optInt(fd, "price"),
      wholesalePrice: optInt(fd, "wholesalePrice") || null,
      wholesaleMinQty: optInt(fd, "wholesaleMinQty") || null,
      maxDiscountBps: optBps(fd, "maxDiscount"),
      stock:
        stockWh && input.type === "product"
          ? { warehouseId: stockWh, qty: fint(fd, "initialQty"), unitCost: null, minQty: fint(fd, "minQty"), maxQty: fint(fd, "maxQty"), safetyQty: fint(fd, "safetyQty"), reorderMultiple: fint(fd, "reorderMultiple"), location: fopt(fd, "location") }
          : null,
    });
    const image = fd.get("image");
    if (image instanceof File && image.size > 0 && !p.imageFileId) {
      await setProductImage(s.ctx, p.id, { name: image.name, mime: image.type, data: Buffer.from(await image.arrayBuffer()) });
    }
    return { ok: true as const, data: { id: p.id }, message: input.draft ? "Rascunho salvo — o produto fica inativo até concluir o cadastro." : "Produto cadastrado.", redirect: `/produtos/${p.id}` };
  });
}

export async function updateProductAction(fd: FormData) {
  const id = fstr(fd, "id");
  const section = (fstr(fd, "section") as "general" | "fiscal") || "general";
  return runAction({ module: "products", op: "edit", revalidate: ["/produtos", `/produtos/${id}`] }, async (s) => {
    const input = parseProduct(fd);
    const patch: Partial<ProductInput> =
      section === "fiscal"
        ? { ncm: input.ncm, cest: input.cest, origin: input.origin, taxGroupId: input.taxGroupId, cfop: input.cfop, cstCsosn: input.cstCsosn, serviceListItem: input.serviceListItem, municipalServiceCode: input.municipalServiceCode, issRateBps: input.issRateBps, cnaeService: input.cnaeService }
        : { type: input.type, code: input.code, name: input.name, description: input.description, gtin: input.gtin, unitCode: input.unitCode, categoryId: input.categoryId, brandId: input.brandId, supplierId: input.supplierId, active: input.active, availablePdv: input.availablePdv, availableEcommerce: input.availableEcommerce, weightGrams: input.weightGrams };
    await updateProduct(s.ctx, id, patch, section);
    return { ok: true as const, message: section === "fiscal" ? "Dados fiscais salvos." : "Dados gerais salvos." };
  });
}

export async function setProductStatusAction(id: string, active: boolean) {
  return runAction({ module: "products", op: "edit", revalidate: ["/produtos", `/produtos/${id}`] }, async (s) => {
    await setProductStatus(s.ctx, id, active);
    return { ok: true as const, message: active ? "Produto reativado." : "Produto inativado (histórico preservado)." };
  });
}

export async function deleteProductAction(id: string) {
  return runAction({ module: "products", op: "delete", revalidate: ["/produtos"] }, async (s) => {
    await deleteProduct(s.ctx, id);
    return { ok: true as const, message: "Produto excluído.", redirect: "/produtos" };
  });
}

export async function uploadImageAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${id}`, "/produtos"] }, async (s) => {
    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Escolha uma imagem." };
    await setProductImage(s.ctx, id, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) });
    return { ok: true as const, message: "Imagem atualizada." };
  });
}

export async function removeImageAction(id: string) {
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${id}`] }, async (s) => {
    await removeProductImage(s.ctx, id);
    return { ok: true as const, message: "Imagem removida." };
  });
}

export async function saveVariantsAction(fd: FormData) {
  const id = fstr(fd, "productId");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${id}`, "/produtos"] }, async (s) => {
    const r = await saveVariants(s.ctx, id, { axes: fjson<Axis[]>(fd, "axes", []), variants: fjson<VariantInput[]>(fd, "variants", []) });
    return { ok: true as const, message: `Variações salvas: ${r.created} nova(s), ${r.updated} alterada(s)${r.removed ? `, ${r.removed} SKU simples retirado` : ""}.` };
  });
}

export async function removeVariantAction(productId: string, skuId: string) {
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    const r = await removeVariant(s.ctx, skuId);
    return { ok: true as const, message: r.deleted ? "Variação excluída (sem uso)." : "Variação inativada (possui histórico)." };
  });
}

export async function saveCostsAction(fd: FormData) {
  const productId = fstr(fd, "productId");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    const r = await saveSkuCosts(s.ctx, fstr(fd, "skuId"), {
      costAcquisition: fint(fd, "costAcquisition"),
      additionalCosts: fjson<AdditionalCost[]>(fd, "additionalCosts", []),
      reason: fopt(fd, "reason"),
      applyToAllVariants: fbool(fd, "applyToAll"),
    });
    return { ok: true as const, message: `Custo salvo (${r.updated} SKU).` };
  });
}

export async function savePriceAction(fd: FormData) {
  const productId = fstr(fd, "productId");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`, "/produtos"] }, async (s) => {
    const skuIds = fd.getAll("skuIds").map(String).filter(Boolean);
    const id = fopt(fd, "id");
    const base = {
      priceTableId: fstr(fd, "priceTableId"),
      branchId: fopt(fd, "branchId"),
      price: fint(fd, "price"),
      wholesalePrice: optInt(fd, "wholesalePrice") || null,
      wholesaleMinQty: optInt(fd, "wholesaleMinQty") || null,
      maxDiscountBps: optBps(fd, "maxDiscount"),
      validFrom: fopt(fd, "validFrom"),
      validTo: fopt(fd, "validTo"),
      reason: fopt(fd, "reason"),
    };
    if (!base.priceTableId) return { ok: false as const, error: "Escolha a tabela de preço." };
    if (id) {
      await savePrice(s.ctx, { ...base, id, skuId: fstr(fd, "skuId") });
      return { ok: true as const, message: "Preço alterado." };
    }
    if (!skuIds.length) return { ok: false as const, error: "Escolha ao menos uma variação." };
    for (const skuId of skuIds) await savePrice(s.ctx, { ...base, skuId });
    return { ok: true as const, message: `Preço salvo para ${skuIds.length} variação(ões).` };
  });
}

export async function deletePriceAction(productId: string, priceId: string) {
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    await deletePrice(s.ctx, priceId);
    return { ok: true as const, message: "Preço removido (registrado no histórico)." };
  });
}

export async function saveStockParamsAction(fd: FormData) {
  const productId = fstr(fd, "productId");
  return runAction({ revalidate: [`/produtos/${productId}`] }, async (s) => {
    await saveStockParams(s.ctx, {
      warehouseId: fstr(fd, "warehouseId"),
      skuId: fstr(fd, "skuId"),
      minQty: fint(fd, "minQty"),
      maxQty: fint(fd, "maxQty"),
      safetyQty: fint(fd, "safetyQty"),
      reorderMultiple: fint(fd, "reorderMultiple"),
      location: fopt(fd, "location"),
    });
    return { ok: true as const, message: "Parâmetros de estoque salvos." };
  });
}

export async function initialBalanceAction(fd: FormData) {
  const productId = fstr(fd, "productId");
  return runAction({ revalidate: [`/produtos/${productId}`, "/estoque/movimentos"] }, async (s) => {
    await postInitialBalance(s.ctx, { warehouseId: fstr(fd, "warehouseId"), skuId: fstr(fd, "skuId"), qty: fint(fd, "qty"), unitCost: optInt(fd, "unitCost") });
    return { ok: true as const, message: "Saldo inicial lançado (movimento identificado)." };
  });
}

export async function saveConversionAction(fd: FormData) {
  const productId = fstr(fd, "productId");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    await saveUnitConversion(s.ctx, { productId, fromUnit: fstr(fd, "fromUnit"), toUnit: fstr(fd, "toUnit"), factor: fint(fd, "factor") });
    return { ok: true as const, message: "Conversão salva." };
  });
}

export async function deleteConversionAction(productId: string, id: string) {
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    await deleteUnitConversion(s.ctx, id);
    return { ok: true as const, message: "Conversão removida." };
  });
}

/** Controle de lote e validade do produto (EST-02; exige o recurso `feature.lotes` para ligar). */
export async function setLotControlAction(id: string, on: boolean) {
  return runAction({ module: "products", op: "edit", revalidate: ["/produtos", `/produtos/${id}`, "/estoque/validades"] }, async (s) => {
    const { setLotControl } = await import("@/domain/lots");
    await setLotControl(s.ctx, id, on);
    return { ok: true as const, message: on ? "Controle de lote e validade ligado. O saldo atual fica “sem lote” até ser classificado (inventário por lote)." : "Controle de lote e validade desligado." };
  });
}

// ───────────────────────────── Importação CSV

export async function analyzeCsvAction(text: string) {
  return runAction({ module: "products", op: "create" }, async () => analyzeCsv(text));
}

export async function previewImportAction(payload: { text: string; mapping: Record<string, string>; mode: ImportMode; matchBy: MatchBy }) {
  return runAction({ module: "products", op: "create" }, async (s) => previewImport(s.ctx, payload));
}

export async function runImportAction(payload: { fileName: string; text: string; mapping: Record<string, string>; mode: ImportMode; matchBy: MatchBy; idemKey: string }) {
  return runAction({ module: "products", op: "create", revalidate: ["/produtos", "/produtos/importar"] }, async (s) => {
    const r = await runImport(s.ctx, payload);
    return { ok: true as const, data: { id: r.id }, message: `Importação nº ${r.number} concluída.`, redirect: `/produtos/importar/${r.id}` };
  });
}

// ───────────────────────────── Componentes (kits e compostos — CAD-12/13)

export async function setCompositionAction(productId: string, composition: string) {
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    const value = composition === "kit" || composition === "composite" ? composition : null;
    await setComposition(s.ctx, productId, value);
    return { ok: true as const, message: value ? `Produto definido como ${COMPOSITION_LABEL[value].toLowerCase()}.` : "Composição removida: o produto volta a ser comum." };
  });
}

export async function saveComponentAction(fd: FormData) {
  const productId = fstr(fd, "productId");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    await saveComponent(s.ctx, { productId, parentSkuId: fopt(fd, "parentSkuId"), componentSkuId: fstr(fd, "componentSkuId"), qty: fint(fd, "qty"), notes: fopt(fd, "notes") });
    return { ok: true as const, message: "Componente salvo." };
  });
}

export async function removeComponentAction(productId: string, id: string) {
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${productId}`] }, async (s) => {
    await removeComponent(s.ctx, id);
    return { ok: true as const, message: "Componente removido." };
  });
}

/** Pesquisa de SKUs que podem ser componentes do produto (exclui serviços, kits e o próprio produto). */
export async function searchComponentSkusAction(q: string, productId: string) {
  return runAction({ module: "products" }, async (s) => {
    const term = q.trim();
    if (term.length < 2) return [];
    const store = s.ctx.store;
    const res = await store.list("skus", { filters: [["eq", "companyId", s.ctx.companyId], ["or", [["contains", "searchText", normalizeSearch(term)], ["eq", "barcode", term], ["eq", "sku", term.toUpperCase()]]]], limit: 30 });
    const products = new Map((await listAll(store, "products", { filters: [["eq", "id", [...new Set(res.items.map((x) => x.productId))]]] })).map((p) => [p.id, p]));
    const hits = res.items.filter((x) => {
      const p = products.get(x.productId);
      return p && x.active !== false && p.id !== productId && p.type !== "service" && compositionOf(p) !== "kit";
    });
    const avail = s.ctx.branchId ? await availableMap(store, s.ctx.branchId, hits.map((x) => x.id)) : new Map<string, { physical: number; available: number; avgCost: number }>();
    return hits.slice(0, 15).map((x) => {
      const a = avail.get(x.id);
      const p = products.get(x.productId);
      return { id: x.id, sku: x.sku as string, name: (x.name ?? p?.name) as string, unitCode: (x.unitCode ?? p?.unitCode ?? "UN") as string, barcode: (x.barcode ?? null) as string | null, physical: a?.physical ?? 0, available: a?.available ?? 0, avgCost: a?.avgCost ?? x.costTotal ?? 0 };
    });
  });
}
