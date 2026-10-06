"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check } from "lucide-react";
import { switchUnitAction } from "@/app/actions/session";

export function UnitSwitcher({ companies, branches, current, canConsolidate = true }: { companies: Array<{ id: string; name: string; isDemo?: boolean; inactive?: boolean }>; branches: Array<{ id: string; name: string; companyId: string; inactive?: boolean }>; current: { companyId: string; branchId: string | null; consolidated: boolean; label: string }; canConsolidate?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const choose = (companyId: string, branchId: string) =>
    start(async () => {
      setError(null);
      const r = await switchUnitAction(companyId, branchId);
      if (!r?.ok) {
        setError(r?.error ?? "Não foi possível trocar de unidade.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="focus-ring flex max-w-[52vw] items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-slate-50 sm:max-w-xs">
        <Building2 className="size-4 shrink-0 text-brand-700" aria-hidden />
        <span className="truncate">{current.label}</span>
        {pending ? <span className="size-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <ChevronDown className="size-4 shrink-0 text-slate-400" />}
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-md border border-line bg-white p-2 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {error && (
            <p role="alert" className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
              {error}
            </p>
          )}
          {companies.map((c) => (
            <div key={c.id} className="mb-2">
              <p className="px-2 py-1 text-xs font-semibold text-slate-500">
                {c.name}
                {c.inactive && <span className="ml-1 font-normal text-red-700">(inativa)</span>}
              </p>
              {canConsolidate && !c.inactive && (
                <button type="button" onClick={() => choose(c.id, "all")} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span>Consolidado (todas as filiais — consulta)</span>
                  {current.companyId === c.id && current.consolidated && <Check className="size-4 text-brand-700" />}
                </button>
              )}
              {branches
                .filter((b) => b.companyId === c.id)
                .map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    disabled={c.inactive || b.inactive}
                    title={c.inactive ? "Empresa inativa" : b.inactive ? "Filial inativa: consulte pelo consolidado" : undefined}
                    onClick={() => choose(c.id, b.id)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                  >
                    <span>
                      {b.name}
                      {b.inactive && <span className="ml-1 text-xs text-red-700">(inativa)</span>}
                    </span>
                    {current.branchId === b.id && <Check className="size-4 text-brand-700" />}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
