"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Store, Layers, ChevronRight, ArrowLeft, Search } from "lucide-react";
import { switchUnitAction } from "@/app/actions/session";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

interface C { id: string; name: string; legal: string; cnpj: string; status: string; isDemo: boolean }
interface B { id: string; companyId: string; name: string; code: string; city: string; uf: string; status: string; fiscalStatus: string }

const fiscalLabel: Record<string, [string, "good" | "warn" | "sim" | "neutral"]> = {
  operational: ["Fiscal operacional", "good"],
  simulation: ["Fiscal em simulação", "sim"],
  pending: ["Fiscal pendente", "warn"],
};

const fmtCnpj = (v: string) => (v?.length === 14 ? v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : v || "");

/** Duas etapas: empresa → unidade (pula a 1ª quando há uma única empresa). */
export function UnitPicker({ companies, branches, canConsolidate = true }: { companies: C[]; branches: B[]; canConsolidate?: boolean }) {
  const [companyId, setCompanyId] = useState<string | null>(companies.length === 1 ? companies[0].id : null);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const filteredCompanies = useMemo(() => {
    const n = norm(q);
    const d = q.replace(/\D/g, "");
    return companies.filter((c) => !n || norm(c.name).includes(n) || norm(c.legal).includes(n) || (d.length >= 3 && c.cnpj?.includes(d)));
  }, [q, companies]);
  const company = companies.find((c) => c.id === companyId) ?? null;
  const units = branches.filter((b) => b.companyId === companyId && (!q || !company || norm(b.name).includes(norm(q)) || norm(b.city).includes(norm(q))));
  const choose = (c: string, b: string) =>
    start(async () => {
      const r = await switchUnitAction(c, b);
      if (!r.ok) return toast("error", r.error ?? "Falha");
      router.push("/dashboard");
    });
  return (
    <div className="mt-5">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={company ? "Buscar unidade ou cidade" : "Buscar por razão social, nome fantasia ou CNPJ"} className="focus-ring h-9 w-full rounded-md border border-line pl-8 pr-3 text-sm" aria-label="Pesquisar" />
      </div>
      {!company ? (
        <div className="grid gap-2">
          {filteredCompanies.map((c) => {
            const count = branches.filter((b) => b.companyId === c.id && b.status !== "inactive").length;
            const inactive = c.status === "inactive";
            return (
              <button key={c.id} disabled={inactive} title={inactive ? "Empresa inativa: não pode ser selecionada. Um administrador pode reativá-la em Administração → Empresas." : undefined} onClick={() => { setCompanyId(c.id); setQ(""); }} className="focus-ring flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-left hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white">
                <span className="flex items-center gap-3">
                  <Building2 className="size-5 text-brand-700" />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-medium">{c.name}{c.isDemo && <Badge tone="sim">DEMO</Badge>}{inactive && <Badge tone="neutral">Inativa</Badge>}</span>
                    <span className="block text-xs text-slate-500">{c.legal !== c.name ? `${c.legal} · ` : ""}CNPJ {fmtCnpj(c.cnpj) || "—"} · {inactive ? "empresa inativa — seleção bloqueada" : `${count} unidade${count === 1 ? "" : "s"} disponíve${count === 1 ? "l" : "is"}`}</span>
                  </span>
                </span>
                <ChevronRight className="size-4 text-slate-400" />
              </button>
            );
          })}
          {filteredCompanies.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nenhuma empresa encontrada.</p>}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Building2 className="size-4 text-brand-700" /> {company.name}
              {company.isDemo && <Badge tone="sim">DEMO</Badge>}
            </div>
            {companies.length > 1 && (
              <button type="button" onClick={() => setCompanyId(null)} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
                <ArrowLeft className="size-3" /> Trocar empresa
              </button>
            )}
          </div>
          <div className="grid gap-2">
            {units.map((b) => {
              const f = fiscalLabel[b.fiscalStatus] ?? ["Fiscal não configurado", "neutral"];
              return (
                <button key={b.id} disabled={pending || b.status === "inactive"} title={b.status === "inactive" ? "Filial inativa: não pode ser selecionada nem operar. Consulte pelo consolidado da empresa." : undefined} onClick={() => choose(company.id, b.id)} className="focus-ring flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-left hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60">
                  <span className="flex items-center gap-3">
                    <Store className="size-5 text-slate-400" />
                    <span>
                      <span className="block text-sm font-medium">{b.name}</span>
                      <span className="block text-xs text-slate-500">{b.code} · {b.city}/{b.uf}</span>
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Badge tone={b.status !== "inactive" ? "good" : "neutral"}>{b.status !== "inactive" ? "Operando" : "Inativa — seleção bloqueada"}</Badge>
                    <Badge tone={f[1]}>{f[0]}</Badge>
                  </span>
                </button>
              );
            })}
            {units.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Nenhuma unidade autorizada para você nesta empresa.</p>}
            {canConsolidate && <button disabled={pending} onClick={() => choose(company.id, "all")} className="focus-ring flex items-center gap-3 rounded-lg border border-dashed border-line p-3 text-left text-sm hover:border-brand-300">
              <Layers className="size-5 text-slate-400" />
              <span>
                <span className="block font-medium">Consolidado da empresa</span>
                <span className="block text-xs text-slate-500">Todas as unidades autorizadas — consulta e relatórios (operações exigem uma filial).</span>
              </span>
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}
