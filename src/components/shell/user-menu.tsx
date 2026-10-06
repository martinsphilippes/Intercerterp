"use client";

import { useState } from "react";
import Link from "@/components/ui/link";
import { LogOut, UserCircle2 } from "lucide-react";
import { logoutAction } from "@/app/actions/session";

export function UserMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="focus-ring flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100" aria-expanded={open}>
        <UserCircle2 className="size-6 text-brand-700" aria-hidden />
        <span className="hidden text-left leading-tight md:block">
          <span className="block font-medium">{name}</span>
          <span className="block text-xs text-slate-500">{role}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-line bg-white p-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <Link href="/selecionar-unidade" className="block rounded px-3 py-2 text-sm hover:bg-slate-50">
            Trocar empresa/filial
          </Link>
          <Link href="/notificacoes?tab=preferencias" className="block rounded px-3 py-2 text-sm hover:bg-slate-50">
            Preferências de notificação
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">
              <LogOut className="size-4" /> Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
