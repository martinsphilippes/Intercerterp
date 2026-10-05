"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check } from "lucide-react";
import { switchUnitAction } from "@/app/actions/session";

export function UnitSwitcher({ companies, branches, current }: { companies: Array<{ id: string; name: string; isDemo?: boolean }>; branches: Array<{ id: string; name: string; companyId: string }>; current: { companyId: string; branchId: string | null; consolidated: boolean; label: string } }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const choose = (companyId: string, branchId: string) =>
    start(async () => {
      await switchUnitAction(companyId, branchId);
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
          {companies.map((c) => (
            <div key={c.id} className="mb-2">
              <p className="px-2 py-1 text-xs font-semibold text-slate-500">{c.name}</p>
              <button type="button" onClick={() => choose(c.id, "all")} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                <span>Consolidado (todas as filiais — consulta)</span>
                {current.companyId === c.id && current.consolidated && <Check className="size-4 text-brand-700" />}
              </button>
              {branches
                .filter((b) => b.companyId === c.id)
                .map((b) => (
                  <button key={b.id} type="button" onClick={() => choose(c.id, b.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    <span>{b.name}</span>
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
