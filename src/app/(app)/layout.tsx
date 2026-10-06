import Link from "next/link";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { NAV } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { UnitSwitcher } from "@/components/shell/unit-switcher";
import { GlobalSearch } from "@/components/shell/global-search";
import { UserMenu } from "@/components/shell/user-menu";
import { can } from "@/lib/permissions";
import { listAll, getStore, configuredBackend } from "@/lib/db";
import { accessibleUnits } from "@/lib/auth/users";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(s.user, i.module)) })).filter((g) => g.items.length);
  const userDoc = await getStore().get("users", s.user.id);
  const units = await accessibleUnits(getStore(), userDoc!);
  const unread = await s.ctx.store.list("notifications", { filters: [["eq", "userId", s.user.id], ["isNull", "readAt"], ["isNull", "archivedAt"], ["eq", "companyId", s.ctx.companyId]], limit: 1 });
  const companyName = s.company.tradeName || s.company.name;
  const label = `${companyName} · ${s.consolidated ? "Consolidado" : s.branch?.name}`;
  const backend = configuredBackend();
  void listAll;
  return (
    <div className="min-h-screen">
      <Sidebar groups={groups} demo={Boolean(s.company.isDemo)} />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 pl-14 backdrop-blur lg:pl-4">
          <UnitSwitcher
            companies={units.companies.map((c) => ({ id: c.id, name: c.tradeName || c.name, isDemo: c.isDemo }))}
            branches={units.branches.map((b) => ({ id: b.id, name: b.name, companyId: b.companyId }))}
            current={{ companyId: s.ctx.companyId, branchId: s.ctx.branchId, consolidated: s.consolidated, label }}
            canConsolidate={s.canConsolidate}
          />
          <div className="hidden flex-1 justify-center md:flex">
            <GlobalSearch />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notificacoes" className="focus-ring relative rounded-md p-2 hover:bg-slate-100" aria-label={`Notificações${unread.total ? ` (${unread.total} não lidas)` : ""}`}>
              <Bell className="size-5 text-slate-600" />
              {unread.total > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{unread.total > 99 ? "99+" : unread.total}</span>}
            </Link>
            <UserMenu name={s.user.name} role={s.user.roleName ?? ""} />
          </div>
        </header>
        {(s.company.isDemo || backend === "memory") && (
          <div className="no-print border-b border-fuchsia-200 bg-fuchsia-50 px-4 py-1.5 text-center text-xs text-fuchsia-900">
            {backend === "memory" ? "Demonstração volátil em memória — os dados são recriados quando o servidor reinicia. " : "Empresa de demonstração. "}
            Documentos fiscais e cobranças usam provedores de simulação, sem validade fiscal ou financeira.
          </div>
        )}
        <div className="md:hidden border-b border-line bg-white p-2 no-print">
          <GlobalSearch />
        </div>
        <main className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
