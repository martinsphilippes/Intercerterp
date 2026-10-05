"use server";

import { runAction, fstr, fopt } from "@/lib/server/action";
import { createCompany, updateCompany, setCompanyStatus, createBranch, updateBranch, setBranchStatus, setCompanyUsers, type AddressInput } from "@/domain/companies";

function address(fd: FormData): AddressInput {
  return {
    zip: fstr(fd, "zip"),
    street: fstr(fd, "street"),
    number: fstr(fd, "number"),
    complement: fstr(fd, "complement"),
    district: fstr(fd, "district"),
    cityName: fstr(fd, "cityName"),
    cityCode: fstr(fd, "cityCode"),
    uf: fstr(fd, "uf"),
  };
}

export async function saveCompanyAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "admin", op: id ? "edit" : "create", revalidate: ["/administracao/empresas"] }, async (s) => {
    const input = {
      name: fstr(fd, "name"), tradeName: fopt(fd, "tradeName"), cnpj: fopt(fd, "cnpj"), ie: fopt(fd, "ie"), im: fopt(fd, "im"), regime: fopt(fd, "regime"), crt: fopt(fd, "crt"),
      cnae: fopt(fd, "cnae"), email: fopt(fd, "email"), phone: fopt(fd, "phone"), address: address(fd), notes: fopt(fd, "notes"),
    };
    if (id) {
      await updateCompany(s.ctx, id, input);
      return { ok: true as const, message: "Empresa atualizada.", redirect: `/administracao/empresas/${id}` };
    }
    const r = await createCompany(s.ctx, { ...input, branchName: fopt(fd, "branchName") ?? undefined });
    return { ok: true as const, message: "Empresa criada com a filial matriz e parametrização inicial. Configure o fiscal antes de emitir documentos.", redirect: `/administracao/empresas/${r.company.id}` };
  });
}

export async function setCompanyStatusAction(id: string, status: "active" | "inactive", fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/empresas/${id}`] }, async (s) => {
    await setCompanyStatus(s.ctx, id, status, fopt(fd, "reason"));
    return { ok: true as const, message: status === "inactive" ? "Empresa inativada." : "Empresa reativada." };
  });
}

function branchInput(fd: FormData) {
  return {
    code: fstr(fd, "code"), name: fstr(fd, "name"), cnpj: fopt(fd, "cnpj"), ie: fopt(fd, "ie"), im: fopt(fd, "im"), phone: fopt(fd, "phone"), email: fopt(fd, "email"), address: address(fd),
    defaultWarehouseId: fopt(fd, "defaultWarehouseId"), defaultPriceTableId: fopt(fd, "defaultPriceTableId"), timezone: fopt(fd, "timezone"),
  };
}

export async function saveBranchAction(fd: FormData) {
  const id = fopt(fd, "id");
  const companyId = fstr(fd, "companyId");
  return runAction({ module: "admin", op: id ? "edit" : "create", revalidate: [`/administracao/empresas/${companyId}`] }, async (s) => {
    if (id) {
      await updateBranch(s.ctx, id, branchInput(fd));
      return { ok: true as const, message: "Filial atualizada.", redirect: `/administracao/empresas/filiais/${id}` };
    }
    const b = await createBranch(s.ctx, companyId, branchInput(fd));
    return { ok: true as const, message: "Filial criada com depósitos (principal e avarias) e conta caixa.", redirect: `/administracao/empresas/filiais/${b.id}` };
  });
}

export async function setBranchStatusAction(id: string, status: "active" | "inactive", fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/empresas/filiais/${id}`] }, async (s) => {
    await setBranchStatus(s.ctx, id, status, fopt(fd, "reason"));
    return { ok: true as const, message: status === "inactive" ? "Filial inativada." : "Filial reativada." };
  });
}

export async function setCompanyUsersAction(fd: FormData) {
  const companyId = fstr(fd, "companyId");
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/empresas/${companyId}`] }, async (s) => {
    const changes = await setCompanyUsers(s.ctx, companyId, fd.getAll("userIds").map(String));
    return { ok: true as const, message: changes.length ? `Vínculos atualizados: ${changes.join(", ")}.` : "Nenhuma alteração nos vínculos." };
  });
}
