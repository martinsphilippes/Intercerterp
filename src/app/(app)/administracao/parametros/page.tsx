import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { can, canDo } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { getSchedule } from "@/domain/backup";
import { loadParameters } from "./params";
import { PARAM_GROUPS, describeSchedule } from "./catalog";
import { ParamsForm } from "./params-form";

export const metadata = { title: "Parâmetros" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const branches = await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] });
  const requested = sp(params, "escopo");
  const scope = requested && requested !== "company" && branches.some((b) => b.id === requested) ? requested : "company";
  const tab = sp(params, "tab") || "valores";
  const states = await loadParameters(s.ctx.store, s.ctx.companyId, scope === "company" ? null : scope);
  const schedule = await getSchedule(s.ctx.store, s.ctx.companyId);
  const settingRefs = (await listAll(s.ctx.store, "settings", { filters: [["eq", "companyId", s.ctx.companyId]] }, 500)).map((x) => `setting:${x.id}`);
  const base = `/administracao/parametros${scope !== "company" ? `?escopo=${scope}` : ""}`;
  return (
    <>
      <PageHeader
        title="Parâmetros"
        crumbs={[{ label: "Administração" }, { label: "Parâmetros" }]}
        description="Regras operacionais da empresa e substituições por filial. A filial herda o valor da empresa até receber um valor próprio. Toda alteração fica no histórico de auditoria."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3 text-sm">
        <span className="text-xs font-medium text-slate-600">Escopo:</span>
        <Link href="/administracao/parametros" className={`rounded-full px-3 py-1 ring-1 ring-inset ${scope === "company" ? "bg-brand-700 text-white ring-brand-700" : "ring-line hover:bg-slate-50"}`}>
          Empresa — {s.company.tradeName || s.company.name}
        </Link>
        {branches.map((b) => (
          <Link key={b.id} href={`/administracao/parametros?escopo=${b.id}`} className={`rounded-full px-3 py-1 ring-1 ring-inset ${scope === b.id ? "bg-brand-700 text-white ring-brand-700" : "ring-line hover:bg-slate-50"}`}>
            Filial — {b.name}
          </Link>
        ))}
      </div>
      <LinkTabs basePath={base} active={tab} tabs={[{ key: "valores", label: "Valores" }, { key: "historico", label: "Histórico de alterações" }]} />
      {tab === "valores" && (
        <div className="space-y-4">
          {scope !== "company" && <Notice tone="info">Mostrando apenas parâmetros que aceitam valor por filial. Itens “Definido na empresa” ou “Valor padrão” são herdados; ao salvar um valor diferente, a filial passa a ter valor próprio.</Notice>}
          <Card title="Agenda de backup" description="Parâmetro backup.schedule (empresa).">
            <p className="text-sm">
              {describeSchedule(schedule)} · retenção de {schedule.retentionDays} dias · {schedule.includeFiles ? "inclui arquivos (XML e anexos)" : "somente dados"} · {schedule.verify !== false ? "verificação automática em base de teste" : "sem verificação automática"}.{" "}
              {canDo(s.user, "admin.backup") ? <Link className="text-brand-700 hover:underline" href="/administracao/backups?tab=programacao">Alterar programação</Link> : null}
            </p>
          </Card>
          <ParamsForm scope={scope} states={JSON.parse(JSON.stringify(states))} groups={PARAM_GROUPS} readOnly={!can(s.user, "admin", "edit")} />
        </div>
      )}
      {tab === "historico" && (
        <Card title="Alterações de parâmetros">
          <Timeline store={s.ctx.store} refs={settingRefs.length ? settingRefs : ["setting:-"]} limit={100} />
        </Card>
      )}
    </>
  );
}
