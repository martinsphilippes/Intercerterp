import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, UNIT_COOKIE } from "@/lib/server/session";
import { unitBlockReason } from "@/lib/auth/users";
import { UnitPicker } from "./picker";
import { logoutAction } from "@/app/actions/session";

export const metadata = { title: "Selecionar empresa e filial" };

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/login");
  const companies = s.companies.map((c) => ({ id: c.id, name: c.tradeName || c.name, legal: c.name, cnpj: c.cnpj, status: c.status, isDemo: Boolean(c.isDemo) }));
  const { listAll, getStore } = await import("@/lib/db");
  const all = await listAll(getStore(), "branches");
  const allowed = all.filter((b) => s.companies.some((c) => c.id === b.companyId) && (s.user.isAdmin || !s.user.branchIds.length || s.user.branchIds.includes(b.id)));
  // empresa/filial inativa não é selecionável (nem automaticamente)
  const activeCompanies = s.companies.filter((c) => c.status !== "inactive");
  const usable = allowed.filter((b) => b.status !== "inactive" && activeCompanies.some((c) => c.id === b.companyId));
  if (activeCompanies.length === 1 && usable.length === 1) {
    // única opção: seleção automática
    redirect(`/api/unit?c=${activeCompanies[0].id}&b=${usable[0].id}`);
  }
  // unidade em uso que foi inativada: explica por que a seleção voltou a ser pedida
  const [cid, bid] = ((await cookies()).get(UNIT_COOKIE)?.value ?? "").split(":");
  const blocked = unitBlockReason(s.companies.find((c) => c.id === cid), bid && bid !== "all" ? allowed.find((b) => b.id === bid && b.companyId === cid) : null);
  const branches = allowed.map((b) => ({ id: b.id, companyId: b.companyId, name: b.name, code: b.code, city: b.cityName, uf: b.uf, status: b.status, fiscalStatus: b.fiscalStatus }));
  return (
    <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Em qual empresa e unidade você vai trabalhar?</h1>
          <p className="mt-1 text-sm text-slate-500">Olá, {s.user.name}. A escolha define o contexto de cadastros, movimentos e documentos e pode ser trocada pelo cabeçalho.</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="text-xs text-slate-500 hover:text-red-700 hover:underline">Sair</button>
        </form>
      </div>
      {blocked && (
        <p role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          A unidade que você usava foi inativada. {blocked}
        </p>
      )}
      <UnitPicker companies={companies} branches={branches} canConsolidate={s.user.isAdmin || !s.user.branchIds.length} />
    </div>
  );
}
