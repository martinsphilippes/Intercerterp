"use client";

import Link from "@/components/ui/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { NavIcon } from "./icons";
import type { NavGroup } from "./nav";
import { cn } from "../ui/cn";

export function Sidebar({ groups, demo }: { groups: NavGroup[]; demo: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => path === href || (href !== "/" && path.startsWith(href + "/") && !groups.some((g) => g.items.some((i) => i.href !== href && i.href.startsWith(href) && path.startsWith(i.href))));
  const nav = (
    <nav aria-label="Menu principal" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-brand-200/70">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={isActive(i.href) ? "page" : undefined}
                  className={cn(
                    "focus-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                    isActive(i.href) ? "bg-white/12 font-medium text-white" : "text-brand-100/85 hover:bg-white/8 hover:text-white",
                  )}
                >
                  <NavIcon name={i.icon} className="size-4 shrink-0" />
                  <span className="truncate">{i.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  const brand = (
    <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
      <div className="flex size-8 items-center justify-center rounded-md bg-accent-500 text-sm font-bold text-white">IC</div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">Intercert ERP</p>
        <p className="text-[11px] text-brand-200">{demo ? "Ambiente de demonstração" : "Comércio e varejo"}</p>
      </div>
    </div>
  );
  return (
    <>
      <button type="button" className="no-print fixed left-3 top-3 z-40 rounded-md bg-brand-900 p-2 text-white lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}>
        <Menu className="size-5" />
      </button>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-900 lg:flex">
        {brand}
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <aside className="flex w-72 flex-col bg-brand-900">
            <div className="flex items-center justify-between pr-2">
              {brand}
              <button type="button" aria-label="Fechar menu" onClick={() => setOpen(false)} className="text-white">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
          <button type="button" aria-label="Fechar menu" className="flex-1 bg-slate-900/50" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
