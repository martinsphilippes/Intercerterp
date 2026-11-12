import { requireSession } from "@/lib/server/session";
import { navFor } from "@/components/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { can, canDo } from "@/lib/permissions";
import { getStore, configuredBackend } from "@/lib/db";
import { accessibleUnits } from "@/lib/auth/users";
import { featureDefaultFor, isFeatureOn } from "@/lib/core/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const features = new Map<string, boolean>();
  for (const g of navFor(s.company.kind)) for (const i of g.items) if (i.feature && !features.has(i.feature)) features.set(i.feature, await isFeatureOn(s.ctx.store, s.ctx.companyId, s.ctx.branchId, i.feature, featureDefaultFor(i.feature, s.company.kind)));
  const groups = navFor(s.company.kind).map((g) => ({ ...g, items: g.items.filter((i) => can(s.user, i.module) && (!i.action || canDo(s.user, i.action)) && (!i.anyAction || i.anyAction.some((x) => canDo(s.user, x))) && (!i.feature || features.get(i.feature))) })).filter((g) => g.items.length);
  const [units, unread] = await Promise.all([
    getStore().get("users", s.user.id).then((userDoc) => accessibleUnits(getStore(), userDoc!)),
    s.ctx.store.list("notifications", { filters: [["eq", "userId", s.user.id], ["isNull", "readAt"], ["isNull", "archivedAt"], ["eq", "companyId", s.ctx.companyId]], limit: 1 }),
  ]);
  const companyName = s.company.tradeName || s.company.name;
  const label = `${companyName} · ${s.consolidated ? "Consolidado" : s.branch?.name}`;
  // A moldura é montada por um componente de cliente que recebe só dados, e `page` é a PRIMEIRA propriedade — as duas
  // coisas evitam o erro de montagem do React com banco de verdade (explicação em src/components/shell/app-shell.tsx).
  return (
    <AppShell
      page={children}
      groups={groups}
      demo={Boolean(s.company.isDemo)}
      volatile={configuredBackend() === "memory"}
      units={{
        companies: units.companies.map((c) => ({ id: c.id, name: c.tradeName || c.name, isDemo: c.isDemo, inactive: c.status === "inactive" })),
        branches: units.branches.map((b) => ({ id: b.id, name: b.name, companyId: b.companyId, inactive: b.status === "inactive" })),
        current: { companyId: s.ctx.companyId, branchId: s.ctx.branchId, consolidated: s.consolidated, label },
        canConsolidate: s.canConsolidate,
      }}
      unread={unread.total}
      user={{ name: s.user.name, role: s.user.roleName ?? "" }}
    />
  );
}
