"use server";

import { runAction, fstr, fopt, fbool, fint } from "@/lib/server/action";
import { saveCategory, deleteCategory, saveBrand, deleteBrand, saveUnit, deleteUnit, savePriceTable, deletePriceTable, saveTaxGroup, deleteTaxGroup, setAuxStatus } from "@/domain/products";

const P = "/produtos/cadastros";
const bps = (fd: FormData, k: string): number | null => {
  const v = fstr(fd, k).replace("%", "").replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const status = (fd: FormData) => (fbool(fd, "active") ? "active" : "inactive") as "active" | "inactive";

export async function saveCategoryAction(fd: FormData) {
  return runAction({ module: "products", op: fopt(fd, "id") ? "edit" : "create", revalidate: [P] }, async (s) => {
    await saveCategory(s.ctx, { id: fopt(fd, "id"), name: fstr(fd, "name"), parentId: fopt(fd, "parentId"), status: status(fd) });
    return { ok: true as const, message: "Categoria salva." };
  });
}
export async function saveBrandAction(fd: FormData) {
  return runAction({ module: "products", op: fopt(fd, "id") ? "edit" : "create", revalidate: [P] }, async (s) => {
    await saveBrand(s.ctx, { id: fopt(fd, "id"), name: fstr(fd, "name"), status: status(fd) });
    return { ok: true as const, message: "Marca salva." };
  });
}
export async function saveUnitAction(fd: FormData) {
  return runAction({ module: "products", op: fopt(fd, "id") ? "edit" : "create", revalidate: [P] }, async (s) => {
    await saveUnit(s.ctx, { id: fopt(fd, "id"), code: fstr(fd, "code"), name: fstr(fd, "name"), decimals: fint(fd, "decimals"), status: status(fd) });
    return { ok: true as const, message: "Unidade salva." };
  });
}
export async function savePriceTableAction(fd: FormData) {
  return runAction({ module: "products", op: fopt(fd, "id") ? "edit" : "create", revalidate: [P, "/produtos"] }, async (s) => {
    await savePriceTable(s.ctx, { id: fopt(fd, "id"), name: fstr(fd, "name"), kind: fopt(fd, "kind"), active: fbool(fd, "active"), isDefault: fbool(fd, "isDefault"), notes: fopt(fd, "notes") });
    return { ok: true as const, message: "Tabela de preço salva." };
  });
}
export async function saveTaxGroupAction(fd: FormData) {
  return runAction({ module: "products", op: fopt(fd, "id") ? "edit" : "create", revalidate: [P] }, async (s) => {
    await saveTaxGroup(s.ctx, {
      id: fopt(fd, "id"), name: fstr(fd, "name"), regime: fopt(fd, "regime"), cfopInternal: fopt(fd, "cfopInternal"), cfopInterstate: fopt(fd, "cfopInterstate"), cfopReturn: fopt(fd, "cfopReturn"),
      cstCsosn: fopt(fd, "cstCsosn"), icmsRateBps: bps(fd, "icmsRate"), icmsBaseReductionBps: bps(fd, "icmsBaseReduction"), fcpRateBps: bps(fd, "fcpRate"), pisCst: fopt(fd, "pisCst"), pisRateBps: bps(fd, "pisRate"),
      cofinsCst: fopt(fd, "cofinsCst"), cofinsRateBps: bps(fd, "cofinsRate"), ipiCst: fopt(fd, "ipiCst"), ipiRateBps: bps(fd, "ipiRate"), validFrom: fopt(fd, "validFrom"), validTo: fopt(fd, "validTo"), active: fbool(fd, "active"), notes: fopt(fd, "notes"),
    });
    return { ok: true as const, message: "Grupo tributário salvo." };
  });
}

type Coll = "categories" | "brands" | "units" | "price_tables" | "tax_groups";
export async function setAuxStatusAction(collection: Coll, id: string, active: boolean) {
  return runAction({ module: "products", op: "edit", revalidate: [P] }, async (s) => {
    await setAuxStatus(s.ctx, collection, id, active);
    return { ok: true as const, message: active ? "Reativado." : "Inativado." };
  });
}
export async function deleteAuxAction(collection: Coll, id: string) {
  return runAction({ module: "products", op: "delete", revalidate: [P] }, async (s) => {
    const fn = { categories: deleteCategory, brands: deleteBrand, units: deleteUnit, price_tables: deletePriceTable, tax_groups: deleteTaxGroup }[collection];
    await fn(s.ctx, id);
    return { ok: true as const, message: "Excluído." };
  });
}
