import Link from "next/link";
import { ShieldCheck, Users } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Abas da Tela 36: Usuários | Perfis e permissões (rotas próprias, navegáveis e compartilháveis). */
export function UserTabs({ active, users, roles }: { active: "usuarios" | "perfis"; users: number; roles: number }) {
  const tab = (key: string, href: string, label: string, count: number, Icon: typeof Users) => (
    <Link
      key={key}
      href={href}
      role="tab"
      aria-selected={active === key}
      className={cn(
        "focus-ring -mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
        active === key ? "border-accent-500 text-brand-800" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
      )}
    >
      <Icon className="size-4" aria-hidden /> {label}
      <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{count}</span>
    </Link>
  );
  return (
    <div role="tablist" className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tab("usuarios", "/administracao/usuarios", "Usuários", users, Users)}
      {tab("perfis", "/administracao/usuarios/perfis", "Perfis e permissões", roles, ShieldCheck)}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800 ring-1 ring-brand-100", className)}>
      {initials || "?"}
    </span>
  );
}
