"use server";

import { runAction, fstr, fopt, fint, fjson, fbool } from "@/lib/server/action";
import { createSupplier, updateSupplier, setSupplierStatus, deleteSupplier, upsertSupplierProduct, removeSupplierProduct, type SupplierInput } from "@/domain/suppliers";
import { lookupCnpj } from "@/domain/customers";

function parse(fd: FormData): SupplierInput {
  const lead = fstr(fd, "leadTimeDays");
  return {
    personType: (fstr(fd, "personType") as "PF" | "PJ") || "PJ",
    doc: fopt(fd, "doc"),
    code: fopt(fd, "code"),
    name: fstr(fd, "name"),
    tradeName: fopt(fd, "tradeName"),
    email: fopt(fd, "email"),
    phone: fopt(fd, "phone"),
    ie: fopt(fd, "ie"),
    im: fopt(fd, "im"),
    addresses: fjson(fd, "addresses", []),
    contacts: fjson(fd, "contacts", []),
    paymentTermId: fopt(fd, "paymentTermId"),
    paymentTermsText: fopt(fd, "paymentTermsText"),
    leadTimeDays: lead === "" ? null : fint(fd, "leadTimeDays"),
    minOrderValue: fint(fd, "minOrderValue"),
    freightPolicy: fopt(fd, "freightPolicy"),
    category: fopt(fd, "category"),
    notes: fopt(fd, "notes"),
    status: (fstr(fd, "status") as any) || "active",
  };
}

export async function saveSupplierAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "suppliers", op: id ? "edit" : "create", revalidate: ["/fornecedores"] }, async (s) => {
    const input = parse(fd);
    // idempotência do cadastro: chave estável do formulário (o id não deriva do CNPJ)
    const sup = id ? await updateSupplier(s.ctx, id, input) : await createSupplier(s.ctx, input, { idemKey: fopt(fd, "_idem") ? `ui:${fstr(fd, "_idem")}` : null });
    return { ok: true as const, data: { id: sup.id }, message: input.status === "draft" ? "Rascunho salvo." : "Fornecedor salvo.", redirect: `/fornecedores/${sup.id}` };
  });
}

export async function setSupplierStatusAction(id: string, status: "active" | "inactive" | "blocked", fd: FormData) {
  return runAction({ module: "suppliers", op: "edit", revalidate: [`/fornecedores/${id}`, "/fornecedores"] }, async (s) => {
    await setSupplierStatus(s.ctx, id, status, fopt(fd, "reason"));
    return { ok: true as const, message: status === "inactive" ? "Fornecedor inativado. O histórico foi preservado." : status === "blocked" ? "Fornecedor bloqueado para novas cotações e pedidos." : "Fornecedor reativado." };
  });
}

export async function deleteSupplierAction(id: string) {
  return runAction({ module: "suppliers", op: "delete", revalidate: ["/fornecedores"] }, async (s) => {
    await deleteSupplier(s.ctx, id);
    return { ok: true as const, message: "Fornecedor excluído.", redirect: "/fornecedores" };
  });
}

export async function saveSupplierProductAction(fd: FormData) {
  const supplierId = fstr(fd, "supplierId");
  return runAction({ module: "suppliers", op: "edit", revalidate: [`/fornecedores/${supplierId}`] }, async (s) => {
    const opt = (k: string) => (fstr(fd, k) === "" ? null : fint(fd, k));
    await upsertSupplierProduct(s.ctx, {
      supplierId,
      skuId: fstr(fd, "skuId"),
      supplierCode: fopt(fd, "supplierCode"),
      supplierDescription: fopt(fd, "supplierDescription"),
      conversionFactor: fint(fd, "conversionFactor", 1000) || 1000,
      lastCost: opt("lastCost"),
      leadTimeDays: opt("leadTimeDays"),
      minQty: opt("minQty"),
      multiple: opt("multiple"),
      preferred: fbool(fd, "preferred"),
    });
    return { ok: true as const, message: "Produto do fornecedor salvo." };
  });
}

export async function removeSupplierProductAction(id: string, supplierId: string) {
  return runAction({ module: "suppliers", op: "edit", revalidate: [`/fornecedores/${supplierId}`] }, async (s) => {
    await removeSupplierProduct(s.ctx, id);
    return { ok: true as const, message: "Vínculo removido." };
  });
}

export async function lookupSupplierCnpjAction(cnpj: string) {
  return runAction({ module: "suppliers" }, async () => ({ result: await lookupCnpj(cnpj) }));
}
