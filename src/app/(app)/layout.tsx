import { requireSession } from "@/lib/server/session";
import { navFor } from "@/components/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { can, canDo } from "@/lib/permissions";
import { getStore, configuredBackend } from "@/lib/db";
import { accessibleUnits } from "@/lib/auth/users";
import { featureDefaultFor, isFeatureOn } from "@/lib/core/settings";
import { headers } from "next/headers";
import { combined, companyModules, pathDecision } from "@/lib/server/modules";
import { modulesForPath } from "@/lib/modules/surfaces";
import { contractableFor, shownDisplayResolver } from "@/domain/licensing/license";
import { pathDisplay } from "@/domain/licensing/effective";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const features = new Map<string, boolean>();
  for (const g of navFor(s.company.kind)) for (const i of g.items) if (i.feature && !features.has(i.feature)) features.set(i.feature, await isFeatureOn(s.ctx.store, s.ctx.companyId, s.ctx.branchId, i.feature, featureDefaultFor(i.feature, s.company.kind)));
  // habilitação (docs/modulos): item de módulo não contratado some; em consulta histórica aparece marcado
  const modDoc = await companyModules(s.ctx);
  const kind = s.company.kind ?? "retail";
  const levelOf = (href: string) => combined(modDoc, modulesForPath(href)?.modules ?? [], kind).level;
  // o que a empresa vê: "contratar" só no que pode ser oferecido (o resto aparece com cadeado)
  const displayFor = await shownDisplayResolver(s.ctx.store, s.ctx.companyId, kind);
  // bloqueado/oportunidade só para módulos contratáveis e existentes (nunca para lacunas nem para o que não se aplica ao tipo)
  const contractable = contractableFor(kind);
  // exibição por unidade (fase A): a tela desligada segue a unidade mais visível entre as que a liberam
  const shownAs = (href: string) => pathDisplay(modulesForPath(href)?.modules ?? [], displayFor, contractable);
  const lockable = (href: string) => shownAs(href).display !== "hidden";
  const groups = navFor(s.company.kind)
    .map((g) => ({
      ...g,
      items: g.items
        // não contratado: oculto (padrão dos clientes atuais) ou, conforme a licença, bloqueado / oportunidade de contratação —
        // o item só leva à página de módulo indisponível; nenhum dado nem operação fica acessível (o servidor continua bloqueando)
        .filter((i) => can(s.user, i.module) && (!i.action || canDo(s.user, i.action)) && (!i.anyAction || i.anyAction.some((x) => canDo(s.user, x))) && (!i.feature || features.get(i.feature) || (levelOf(i.href) === "none" && lockable(i.href))) && (levelOf(i.href) !== "none" || lockable(i.href)))
        .map((i) => {
          const level = levelOf(i.href);
          if (level === "full") return i;
          if (level === "none") {
            const shown = shownAs(i.href);
            return { ...i, label: `${i.label} ${shown.display === "upsell" ? "(contratar)" : "(bloqueado)"}`, icon: "Lock", href: `/modulo-indisponivel?m=${encodeURIComponent(shown.module ?? combined(modDoc, modulesForPath(i.href)?.modules ?? [], kind).module)}` };
          }
          return { ...i, label: `${i.label} (consulta)` };
        }),
    }))
    .filter((g) => g.items.length);
  const h = await headers();
  const here = h.get("x-ic-path");
  const screen = here && !h.get("next-action") ? await pathDecision(s.ctx, s.company, here) : null;
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
      page={
        screen && screen.level !== "full" ? (
          <>
            <div role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">{screen.reason} Novas operações estão bloqueadas.</div>
            {children}
          </>
        ) : (
          children
        )
      }
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
