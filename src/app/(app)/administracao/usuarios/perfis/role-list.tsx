import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Lista lateral de perfis (seleção rápida entre perfis, com contagem de usuários). */
export function RoleList({ roles, activeId, canCreate }: { roles: Array<{ id: string; name: string; usersCount: number; system?: boolean; active?: boolean }>; activeId?: string; canCreate: boolean }) {
  return (
    <nav aria-label="Perfis" className="space-y-2">
      {roles.map((r) => (
        <Link
          key={r.id}
          href={`/administracao/usuarios/perfis/${r.id}`}
          aria-current={r.id === activeId ? "page" : undefined}
          className={cn("focus-ring block rounded-lg border bg-white px-3 py-2.5 hover:border-brand-300", r.id === activeId ? "border-brand-500 bg-brand-50/60" : "border-line")}
        >
          <span className="block text-sm font-medium text-ink">
            {r.name}
            {r.active === false && <span className="ml-1 text-xs text-amber-700">(inativo)</span>}
          </span>
          <span className="block text-xs text-slate-500">
            {r.usersCount} usuário{r.usersCount === 1 ? "" : "s"}
            {r.system ? " · sistema" : ""}
          </span>
        </Link>
      ))}
      {canCreate && (
        <Link href="/administracao/usuarios/perfis/novo" className={cn("focus-ring flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-sm text-brand-700 hover:border-brand-300", activeId === "novo" ? "border-brand-500 bg-brand-50/60" : "border-line")}>
          <Plus className="size-4" /> Novo perfil
        </Link>
      )}
    </nav>
  );
}
