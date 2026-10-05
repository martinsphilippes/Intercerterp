import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
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
  if (companies.length === 1 && allowed.length === 1) {
    // única opção: seleção automática
    redirect(`/api/unit?c=${companies[0].id}&b=${allowed[0].id}`);
  }
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
      <UnitPicker companies={companies} branches={branches} />
    </div>
  );
}
