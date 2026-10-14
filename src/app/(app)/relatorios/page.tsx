import Link from "@/components/ui/link";
import { ArrowRight, Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { featureOn, type FeatureKey } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { normalizeSearch, sp, type SearchParams } from "@/lib/list";
import { REPORT_AREAS, REPORT_CATALOG, visibleReports } from "@/lib/report-catalog";
import { getExport } from "@/lib/exporters";
import "@/exports";

/** Rótulo curto da exportação (título do exportador sem o prefixo do relatório). */
const exportTitle = (key: string, fallback: string) => {
  const t = getExport(key)?.title ?? fallback;
  return t.includes(" — ") ? t.split(" — ").slice(1).join(" — ") : t;
};

export const metadata = { title: "Central de relatórios" };

/**
 * Central de relatórios (PLA-09): todos os relatórios e consultas do sistema por área, só os que o usuário pode abrir
 * (módulo, operação especial e recurso ligado), com atalho para a tela e para o CSV/XLSX do recorte padrão.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("reports");
  const params = await searchParams;
  const features = [...new Set(REPORT_CATALOG.map((r) => r.feature).filter(Boolean))] as string[];
  const on = new Map(await Promise.all(features.map(async (f) => [f, await featureOn(s, f as FeatureKey)] as const)));
  const visible = visibleReports(s.user, (f) => on.get(f) ?? true);
  const q = normalizeSearch(sp(params, "q").trim());
  const area = sp(params, "area");
  const shown = visible.filter((r) => (!area || r.area === area) && (!q || normalizeSearch(`${r.title} ${r.description} ${r.tags ?? ""} ${r.area}`).includes(q)));
  const canExport = canDo(s.user, "data.export");
  const areas = REPORT_AREAS.filter((a) => visible.some((r) => r.area === a));
  return (
    <>
      <PageHeader
        title="Central de relatórios"
        crumbs={[{ label: "Análise" }, { label: "Central de relatórios" }]}
        description="Todos os relatórios do sistema em um só lugar, por área. Cada relatório abre a própria tela (filtros, impressão e detalhes); os atalhos de exportação geram o recorte padrão da tela em CSV ou planilha XLSX."
      />
      <FilterBar
        basePath="/relatorios"
        values={params}
        filters={[
          { type: "search", placeholder: "Buscar relatório (ex.: inventário, livro, comissão)" },
          { type: "select", name: "area", label: "Área", options: areas.map((a) => ({ value: a, label: a })), all: "Todas as áreas" },
        ]}
      />
      {shown.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum relatório encontrado" description="Ajuste a busca ou a área. Relatórios de módulos sem permissão ou de recursos desligados não aparecem." />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          {areas
            .filter((a) => shown.some((r) => r.area === a))
            .map((a) => (
              <Card key={a} title={a} bodyClass="p-0">
                <ul className="divide-y divide-line">
                  {shown
                    .filter((r) => r.area === a)
                    .map((r) => (
                      <li key={r.key} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <Link href={r.href} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                            {r.title} <ArrowRight className="size-3.5" aria-hidden />
                          </Link>
                          <p className="text-xs text-slate-500">{r.description}</p>
                        </div>
                        {canExport && (r.exports ?? []).length > 0 && (
                          <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <Download className="size-3.5 text-slate-400" aria-hidden />
                            {(r.exports ?? []).map((e, i) => (
                              <span key={e} className="whitespace-nowrap">
                                {(r.exports ?? []).length > 1 && <span className="text-slate-500">{exportTitle(e, r.title)}: </span>}
                                <a className="text-brand-700 hover:underline" href={`/api/export/${e}`} title={`Exportar ${r.title} (CSV)`}>
                                  CSV
                                </a>
                                {" · "}
                                <a className="text-brand-700 hover:underline" href={`/api/export/${e}?formato=xlsx`} title={`Exportar ${r.title} (planilha XLSX)`}>
                                  XLSX
                                </a>
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              </Card>
            ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {visible.length} relatório(s) disponíveis para o seu perfil. A exportação exige a permissão “Exportar dados” e é registrada no histórico. As telas com filtros próprios (período, filial, situação) exportam exatamente o recorte filtrado pelos botões Exportar/XLSX da própria tela.
      </p>
    </>
  );
}
