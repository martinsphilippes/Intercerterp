"use server";

import { runAction, fstr, fopt, fbool, fint, fjson } from "@/lib/server/action";
import { createCustomer, updateCustomer, setCustomerStatus, deleteCustomer, lookupCnpj, type CustomerInput } from "@/domain/customers";

function parse(fd: FormData): CustomerInput {
  return {
    personType: (fstr(fd, "personType") as "PF" | "PJ") || "PF",
    doc: fopt(fd, "doc"),
    code: fopt(fd, "code"),
    name: fstr(fd, "name"),
    tradeName: fopt(fd, "tradeName"),
    email: fopt(fd, "email"),
    phone: fopt(fd, "phone"),
    mobile: fopt(fd, "mobile"),
    birthDate: fopt(fd, "birthDate"),
    gender: fopt(fd, "gender"),
    maritalStatus: fopt(fd, "maritalStatus"),
    profession: fopt(fd, "profession"),
    sellerId: fopt(fd, "sellerId"),
    vip: fbool(fd, "vip"),
    finalConsumer: fbool(fd, "finalConsumer"),
    acceptsPromotions: fbool(fd, "acceptsPromotions"),
    promoChannels: fd.getAll("promoChannels").map(String),
    ie: fopt(fd, "ie"),
    ieIndicator: fopt(fd, "ieIndicator"),
    im: fopt(fd, "im"),
    addresses: fjson(fd, "addresses", []),
    contacts: fjson(fd, "contacts", []),
    // ausente quando o usuário não pode conceder crédito (campo somente leitura): o servidor mantém o limite atual
    creditLimit: fd.has("creditLimit") ? fint(fd, "creditLimit") : undefined,
    paymentTermDays: fint(fd, "paymentTermDays"),
    paymentTermId: fopt(fd, "paymentTermId"),
    priceTableId: fopt(fd, "priceTableId"),
    notes: fopt(fd, "notes"),
    status: fstr(fd, "status") === "draft" ? "draft" : fd.has("active") ? (fd.getAll("active").includes("1") ? "active" : "inactive") : "active",
  };
}

export async function saveCustomerAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "customers", op: id ? "edit" : "create", revalidate: ["/clientes"] }, async (s) => {
    const input = parse(fd);
    const idem = fstr(fd, "_idem");
    const c = id ? await updateCustomer(s.ctx, id, input) : await createCustomer(s.ctx, input, { idemKey: idem ? `ui:${idem}` : null });
    return { ok: true as const, data: { id: c.id }, message: input.status === "draft" ? "Rascunho salvo." : "Cliente salvo.", redirect: `/clientes/${c.id}` };
  });
}

/** Cadastro rápido (PDV e seletores): poucos campos, mesma identidade do cadastro completo. */
export async function quickCustomerAction(fd: FormData) {
  return runAction({ module: "customers", op: "create" }, async (s) => {
    const personType = (fstr(fd, "personType") as "PF" | "PJ") || "PF";
    const idem = fstr(fd, "_idem");
    const c = await createCustomer(s.ctx, { personType, doc: fopt(fd, "doc"), name: fstr(fd, "name"), mobile: fopt(fd, "mobile"), email: fopt(fd, "email"), status: "active" }, { quick: true, idemKey: idem ? `ui-quick:${idem}` : null });
    return { id: c.id, name: c.name, doc: c.doc, email: c.email, mobile: c.mobile, creditLimit: c.creditLimit, personType: c.personType };
  });
}

export async function setCustomerStatusAction(id: string, status: "active" | "inactive") {
  return runAction({ module: "customers", op: "edit", revalidate: [`/clientes/${id}`] }, async (s) => {
    await setCustomerStatus(s.ctx, id, status);
    return { ok: true as const, message: status === "inactive" ? "Cliente inativado." : "Cliente reativado." };
  });
}

export async function deleteCustomerAction(id: string) {
  return runAction({ module: "customers", op: "delete", revalidate: ["/clientes"] }, async (s) => {
    await deleteCustomer(s.ctx, id);
    return { ok: true as const, message: "Cliente excluído.", redirect: "/clientes" };
  });
}

/** Consulta o documento no próprio cadastro (duplicidade) e, para CNPJ, no serviço externo configurado. */
export async function checkDocAction(personType: "PF" | "PJ", doc: string, selfId?: string) {
  return runAction({ module: "customers" }, async (s) => {
    const { normalizeDoc, findCustomerByDoc } = await import("@/domain/customers");
    const d = normalizeDoc(personType, doc);
    if (!d) return { local: null, external: null };
    const dup = await findCustomerByDoc(s.ctx.store, s.ctx.companyId, d);
    const local = dup && dup.id !== selfId ? { id: dup.id, name: dup.name, status: dup.status } : null;
    const external = personType === "PJ" && !local ? await lookupCnpj(d) : null;
    return { local, external };
  });
}

export async function lookupCnpjAction(cnpj: string) {
  return runAction({ module: "customers" }, async () => ({ result: await lookupCnpj(cnpj) }));
}
