"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Store, Layers } from "lucide-react";
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

export function UnitPicker({ companies, branches }: { companies: C[]; branches: B[] }) {
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const filtered = useMemo(() => {
    const n = q.toLowerCase();
    return branches.filter((b) => !n || b.name.toLowerCase().includes(n) || b.city?.toLowerCase().includes(n) || companies.find((c) => c.id === b.companyId)?.name.toLowerCase().includes(n));
  }, [q, branches, companies]);
  const choose = (c: string, b: string) =>
    start(async () => {
      const r = await switchUnitAction(c, b);
      if (!r.ok) return toast("error", r.error ?? "Falha");
      router.push("/dashboard");
    });
  return (
    <div className="mt-5">
      {branches.length > 4 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar empresa, filial ou cidade" className="focus-ring mb-3 h-9 w-full rounded-md border border-line px-3 text-sm" aria-label="Pesquisar unidade" />}
      <div className="space-y-4">
        {companies.map((c) => (
          <div key={c.id}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Building2 className="size-4 text-brand-700" /> {c.name}
              {c.isDemo && <Badge tone="sim">DEMO</Badge>}
            </div>
            <div className="grid gap-2">
              {filtered
                .filter((b) => b.companyId === c.id)
                .map((b) => {
                  const f = fiscalLabel[b.fiscalStatus] ?? ["Fiscal não configurado", "neutral"];
                  return (
                    <button key={b.id} disabled={pending || b.status !== "active"} onClick={() => choose(c.id, b.id)} className="focus-ring flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-left hover:border-brand-300 hover:bg-brand-50/40 disabled:opacity-60">
                      <span className="flex items-center gap-3">
                        <Store className="size-5 text-slate-400" />
                        <span>
                          <span className="block text-sm font-medium">{b.name}</span>
                          <span className="block text-xs text-slate-500">
                            {b.code} · {b.city}/{b.uf}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Badge tone={b.status === "active" ? "good" : "neutral"}>{b.status === "active" ? "Operando" : "Inativa"}</Badge>
                        <Badge tone={f[1]}>{f[0]}</Badge>
                      </span>
                    </button>
                  );
                })}
              <button disabled={pending} onClick={() => choose(c.id, "all")} className="focus-ring flex items-center gap-3 rounded-lg border border-dashed border-line p-3 text-left text-sm hover:border-brand-300">
                <Layers className="size-5 text-slate-400" />
                <span>
                  <span className="block font-medium">Consolidado da empresa</span>
                  <span className="block text-xs text-slate-500">Todas as filiais — contexto de consulta e relatórios (operações exigem filial).</span>
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
