import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, Notice } from "@/components/ui/empty";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { ParetoChart } from "@/components/charts/pareto-chart";
import { canDo } from "@/lib/permissions";
import { formatBps, formatMoney, formatQty, marginBps, markupBps, roundDiv } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { ABC_CRITERIA, abcReport, type AbcRow } from "@/domain/abc";
import { firstMovementDate } from "@/domain/reports";
import { resolveAbcParams } from "../params";
import { COMMON_DEFINITIONS, FilterSelect, HowWeCalculate, marginText, PrintHeader, PrintStyles, ReportFilters, ScopeLine } from "../_components/report-ui";
import { PrintButton } from "../_components/print-button";

export const metadata = { title: "Produtos e curva ABC" };

type Klass = "A" | "B" | "C" | "sem";
type TableRow = AbcRow & { rank: number | null; klass: Klass; value: number; shareBps: number | null; cumAfterBps: number | null; cumBeforeBps: number | null; markupBps: number | null };

const CLASS_TONE = { A: "brand", B: "info", C: "neutral", sem: "warn" } as const;
const CLASS_LABEL = { A: "A", B: "B", C: "C", sem: "Sem classe" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("reports");
  const params = await searchParams;
  const ap = await resolveAbcParams(s, params);
  const [report, categories, first] = await Promise.all([
    abcReport(s.ctx.store, ap.scope, { criterion: ap.criterion, categoryId: ap.categoryId, limits: ap.limits }),
    lookups.categories(s.ctx),
    firstMovementDate(s.ctx.store, s.ctx.companyId, ap.branchIds),
  ]);
  const cls = report.classification;
  const crit = ABC_CRITERIA.find((c) => c.key === ap.criterion)!;
  const fmtValue = (v: number) => (crit.unit === "qty" ? formatQty(v) : formatMoney(v));
  const catName = ap.categoryId ? (ap.categoryId === "__none__" ? "Sem categoria" : (categories.find((c) => c.value === ap.categoryId)?.label ?? "—")) : "Todas as categorias";
  const base = "/relatorios/curva-abc";
  const canExport = canDo(s.user, "data.export");
  const productQs = (skuId: string) => `${base}/produto/${skuId}${qs({ page: null, sort: null, dir: null, classe: null }, params)}`;
  const periodQs = { periodo: ap.period.preset, de: ap.period.preset === "personalizado" ? ap.period.from : null, ate: ap.period.preset === "personalizado" ? ap.period.to : null, filial: ap.filial };

  // Base classificada + itens sem classe (valor ≤ 0) — participação/acumulado sempre sobre a base inteira
  const ranked: TableRow[] = cls.base.map((x) => ({ ...x.row, rank: x.rank, klass: x.klass, value: x.value, shareBps: x.shareBps, cumAfterBps: x.cumAfterBps, cumBeforeBps: x.cumBeforeBps, markupBps: markupBps(x.row.netRevenue, x.row.cmv) }));
  const unclassified: TableRow[] = cls.excluded.map((x) => ({ ...x.row, rank: null, klass: "sem", value: x.value, shareBps: null, cumAfterBps: null, cumBeforeBps: null, markupBps: markupBps(x.row.netRevenue, x.row.cmv) }));
  const all = [...ranked, ...unclassified];
  const visible = ap.klass ? all.filter((r) => r.klass === ap.klass) : all;
  const lp = parseList(params, { sort: "rank", dir: "asc", pageSize: 50 });
  const { rows, total } = paginate(visible, lp);
  const sum = (k: keyof TableRow) => visible.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const visibleBase = visible.filter((r) => r.klass !== "sem").reduce((a, r) => a + r.value, 0);
  const excludedMoved = cls.excluded.filter((x) => !x.row.noMovement);
  const excludedIdle = cls.excluded.filter((x) => x.row.noMovement);
  const showHref = (k: Klass | null) => `${base}${qs({ classe: k, page: null }, params)}`;
  const criteriaOpen = ap.customLimits || ap.criterion !== "receita" || Boolean(ap.limitsError);
  const units = new Set(visible.map((r) => r.unitCode ?? ""));

  const columns: Column<TableRow>[] = [
    {
      key: "rank",
      label: "Produto / posição",
      sortable: true,
      fixed: true,
      cell: (r) => (
        <span className="block min-w-[220px]">
          <Link href={productQs(r.skuId)} className="font-medium text-brand-700 hover:underline">
            {r.description}
          </Link>
          <span className="block text-xs text-slate-500">
            {r.rank != null ? `#${r.rank} · ` : ""}
            {r.sku} · {r.categoryName ?? "Sem categoria"}
          </span>
        </span>
      ),
    },
    { key: "qtyNet", label: "Qtd. líquida", align: "right", sortable: true, cell: (r) => formatQty(r.qtyNet, r.unitCode ?? undefined) },
    { key: "netRevenue", label: "Receita líquida", align: "right", sortable: true, cell: (r) => <span className={r.netRevenue < 0 ? "text-red-700" : undefined}>{formatMoney(r.netRevenue)}</span> },
    { key: "returns", label: "Devoluções", align: "right", hidden: true, cell: (r) => (r.returns ? `− ${formatMoney(r.returns)}` : "—") },
    { key: "cmv", label: "CMV", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.cmv) },
    { key: "grossProfit", label: "Lucro bruto", align: "right", sortable: true, hidden: ap.criterion !== "margem", cell: (r) => formatMoney(r.grossProfit) },
    { key: "marginBps", label: "Margem", align: "right", sortable: true, cell: (r) => marginText(r.marginBps) },
    { key: "markupBps", label: "Markup", align: "right", sortable: true, hidden: true, cell: (r) => (r.markupBps == null ? "—" : formatBps(r.markupBps)) },
    ...(ap.criterion !== "receita" ? [{ key: "value", label: `Valor (${crit.label.toLowerCase()})`, align: "right" as const, sortable: true, cell: (r: TableRow) => fmtValue(r.value) }] : []),
    { key: "shareBps", label: "Participação", align: "right", sortable: true, cell: (r) => (r.shareBps == null ? "—" : formatBps(r.shareBps)) },
    { key: "cumAfterBps", label: "Acumulado", align: "right", sortable: true, cell: (r) => (r.cumAfterBps == null ? "—" : formatBps(r.cumAfterBps)) },
    {
      key: "klass",
      label: "Classe",
      align: "center",
      cell: (r) => (
        <Badge tone={CLASS_TONE[r.klass]} title={r.klass === "sem" ? (r.noMovement ? "Sem vendas no período" : "Valor não positivo no período") : undefined}>
          {CLASS_LABEL[r.klass]}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PrintStyles />
      <PrintHeader title={`Curva ABC — ${crit.label}`} company={String(s.company.tradeName || s.company.name)} user={s.user.name} rp={ap} />
      <PageHeader
        title="Produtos e curva ABC"
        crumbs={[{ label: "Análise" }, { label: "Produtos e curva ABC" }]}
        description="Identifique os produtos que concentram a receita da operação — mesma base e critérios dos relatórios gerenciais."
        actions={
          <>
            <LinkButton href={`/relatorios/gerenciais${qs(periodQs)}`}>
              <BarChart3 className="size-4" aria-hidden /> Relatórios gerenciais
            </LinkButton>
            {canExport && (
              <a className={buttonClass("secondary")} href={`/api/export/reports-abc${qs({ page: null }, params)}`} title="Exportar a curva do recorte (CSV)">
                <Download className="size-4" aria-hidden /> Exportar CSV
              </a>
            )}
            <PrintButton />
          </>
        }
      />
      <ReportFilters basePath={base} params={params} rp={ap} keep={["classe"]} submitLabel="Aplicar análise" help={`Datas inclusivas, no horário de Brasília.${first ? ` Movimentos registrados a partir de ${formatDate(first)}.` : ""}`}>
        <FilterSelect name="categoria" label="Categoria" value={ap.categoryId ?? ""} all="Todas as categorias" options={[...categories, { value: "__none__", label: "Sem categoria" }]} />
        <details className="basis-full rounded-md border border-line px-3 py-2" open={criteriaOpen}>
          <summary className="cursor-pointer text-sm font-medium text-ink">Critérios da classificação ABC</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <FilterSelect name="criterio" label="Critério" value={ap.criterion === "receita" ? "" : ap.criterion} all="Receita líquida (padrão)" options={ABC_CRITERIA.filter((c) => c.key !== "receita").map((c) => ({ value: c.key, label: c.label }))} />
            <label className="flex w-28 flex-col gap-1 text-xs font-medium text-slate-600">
              Limite A (%)
              <input name="la" inputMode="decimal" defaultValue={(ap.limits.a / 100).toLocaleString("pt-BR")} className={`${inputClass} h-9 text-right`} aria-describedby="abc-limits-hint" />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs font-medium text-slate-600">
              Limite B (%)
              <input name="lb" inputMode="decimal" defaultValue={(ap.limits.b / 100).toLocaleString("pt-BR")} className={`${inputClass} h-9 text-right`} aria-describedby="abc-limits-hint" />
            </label>
            <p id="abc-limits-hint" className="max-w-md text-xs text-slate-500">
              Classe pelo acumulado anterior ao item: &lt; A → A; &lt; B → B; senão C. Padrão da empresa: A {formatBps(ap.companyLimits.a, 0)} · B {formatBps(ap.companyLimits.b, 0)} (parâmetros abc.limitA/abc.limitB); alterar aqui vale só para este recorte.
            </p>
          </div>
        </details>
      </ReportFilters>
      {(ap.error || ap.limitsError) && (
        <div className="mb-4 space-y-2">
          {ap.error && <Notice tone="warn">{ap.error}</Notice>}
          {ap.limitsError && <Notice tone="warn">{ap.limitsError}</Notice>}
        </div>
      )}
      <h2 className="text-base font-semibold text-ink">ABC por {crit.label.toLowerCase()}</h2>
      <ScopeLine
        rp={ap}
        company={String(s.company.tradeName || s.company.name)}
        extra={
          <>
            <span>
              <strong className="font-semibold text-slate-700">Categoria:</strong> {catName}
            </span>
            <span>
              <strong className="font-semibold text-slate-700">Referências acumuladas:</strong> A {formatBps(ap.limits.a, ap.limits.a % 100 ? 2 : 0)} · B {formatBps(ap.limits.b, ap.limits.b % 100 ? 2 : 0)}
              {ap.customLimits && (
                <>
                  {" "}
                  (ajustadas para este recorte —{" "}
                  <Link className="text-brand-700 hover:underline" href={`${base}${qs({ la: null, lb: null }, params)}`}>
                    restaurar {formatBps(ap.companyLimits.a, 0)}/{formatBps(ap.companyLimits.b, 0)}
                  </Link>
                  )
                </>
              )}
            </span>
          </>
        }
      />

      <section aria-label="Resumo da análise" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Receita líquida do recorte" value={formatMoney(report.revenue.total)} hint={`Mesma dos relatórios gerenciais · ${report.totals.salesCount} venda(s), ${report.totals.returnsCount} devolução(ões)`} href={`/relatorios/gerenciais${qs({ ...periodQs, tab: "categoria" })}`} />
        <Stat label="Produtos na curva" value={cls.base.length} hint={`A ${cls.classes.A.count} · B ${cls.classes.B.count} · C ${cls.classes.C.count} — base de ${fmtValue(cls.baseTotal)}`} href={showHref(null)} />
        <Stat label="Sem classe" value={cls.excluded.length} hint={`${crit.key === "receita" ? "Líquido não positivo" : "Valor não positivo"} · ${excludedMoved.length} com movimento, ${excludedIdle.length} sem vendas`} href={showHref("sem")} tone={excludedMoved.length ? "warn" : "default"} />
      </section>
      {cls.excluded.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {cls.excluded.length} produto(s) sem classe somam {fmtValue(cls.excludedTotal)}. Base positiva usada na ABC: {fmtValue(cls.baseTotal)}. Total do recorte = {fmtValue(cls.baseTotal)} {cls.excludedTotal < 0 ? "−" : "+"} {fmtValue(Math.abs(cls.excludedTotal))} = {fmtValue(cls.total)}
            {crit.key !== "receita" ? ` (receita líquida do recorte: ${formatMoney(report.revenue.total)} = ${formatMoney(report.revenue.base)} ${report.revenue.excluded < 0 ? "−" : "+"} ${formatMoney(Math.abs(report.revenue.excluded))})` : ""}.
          </Notice>
        </div>
      )}

      {cls.base.length > 0 ? (
        <Card className="mb-4" title="Concentração da receita" description={`Referências acumuladas: A ${formatBps(ap.limits.a, 0)} · B ${formatBps(ap.limits.b, 0)}. Clique numa coluna para abrir a composição do produto.`}>
          <ParetoChart
            points={ranked.map((r) => ({ rank: r.rank!, skuId: r.skuId, sku: r.sku, name: r.description, shareBps: r.shareBps!, cumBps: r.cumAfterBps!, klass: r.klass as "A" | "B" | "C", valueText: fmtValue(r.value) }))}
            limitA={ap.limits.a}
            limitB={ap.limits.b}
            highlight={ap.klass && ap.klass !== "sem" ? ap.klass : null}
            drillBase={productQs("{sku}")}
            summary={{ A: cls.classes.A, B: cls.classes.B, C: cls.classes.C }}
            caption={`${cls.base.length} produtos na curva: A ${cls.classes.A.count} (${formatBps(cls.classes.A.shareBps)}), B ${cls.classes.B.count} (${formatBps(cls.classes.B.shareBps)}), C ${cls.classes.C.count} (${formatBps(cls.classes.C.shareBps)}).`}
          />
        </Card>
      ) : (
        <Card className="mb-4">
          <EmptyState title="Nenhum produto com valor positivo no recorte" description="Ajuste o período, a filial ou a categoria." />
        </Card>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Produtos classificados</h2>
        <nav aria-label="Exibir classe" className="no-print flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">Exibir:</span>
          {([null, "A", "B", "C", "sem"] as Array<Klass | null>).map((k) => {
            const active = (ap.klass ?? null) === k;
            const count = k == null ? all.length : k === "sem" ? cls.excluded.length : cls.classes[k].count;
            return (
              <Link key={k ?? "todos"} href={showHref(k)} aria-current={active ? "true" : undefined} className={cn("focus-ring rounded-full border px-2.5 py-0.5 font-medium", active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300")}>
                {k == null ? "Todos" : k === "sem" ? "Sem classe" : `Classe ${k}`} ({count})
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mb-4">
        <DataTable
          id="abc"
          basePath={base}
          params={params}
          columns={columns}
          rows={rows}
          total={total}
          page={lp.page}
          pageSize={lp.pageSize}
          exportKey={canExport ? "reports-abc" : undefined}
          totals={{
            qtyNet: units.size <= 1 ? formatQty(sum("qtyNet"), visible[0]?.unitCode ?? undefined) : "unid. mistas",
            netRevenue: formatMoney(sum("netRevenue")),
            returns: `− ${formatMoney(sum("returns"))}`,
            cmv: formatMoney(sum("cmv")),
            grossProfit: formatMoney(sum("grossProfit")),
            marginBps: marginText(marginBps(sum("netRevenue"), sum("cmv"))),
            shareBps: cls.baseTotal > 0 ? formatBps(roundDiv(visibleBase * 10000, cls.baseTotal)) : "—",
          }}
          footer={
            <p className="border-t border-line px-3 py-2 text-xs text-slate-500">
              {visible.length} de {all.length} produtos · o filtro da lista mantém a classificação da análise completa (participação e acumulado sobre {fmtValue(cls.baseTotal)}).
            </p>
          }
          empty={<EmptyState title="Nenhum produto nesta classe" description="Escolha outra classe em “Exibir”." />}
        />
      </div>

      <HowWeCalculate
        items={[
          ["Valor de cada item", "Receita líquida do SKU no recorte (padrão) = bruto − descontos + acréscimos − devoluções do período; ou quantidade líquida (vendida − devolvida, em unidades do item); ou lucro bruto (receita líquida − CMV)."],
          ["Base da curva", "Somente itens com valor positivo. Itens com valor ≤ 0 (devoluções maiores que as vendas, venda anterior devolvida no período ou SKU ativo sem vendas) ficam “Sem classe”, fora do denominador."],
          ["Ordenação", "Valor decrescente; empate pela maior quantidade líquida; depois pelo código do SKU em ordem crescente."],
          ["Classificação", "Pelo acumulado ANTERIOR à inclusão do item: acumulado anterior < limite A → classe A; < limite B → classe B; senão C. Assim, o item que cruza o limite fica na classe que estava sendo preenchida (ex.: A pode terminar em 85,09% com referência de 80%, e B levar o acumulado a 97,31% com referência de 95%)."],
          ["Referências", "Padrão dos parâmetros abc.limitA (8000 bps = 80%) e abc.limitB (9500 bps = 95%) da empresa/filial; ajustáveis na tela apenas para o recorte."],
          ["Participação e acumulado", "Sempre sobre o total da base inteira. Filtrar a lista por classe (Exibir) não recalcula o denominador."],
          ["Reconciliação", "Receita total do recorte = base da curva + itens sem classe — a mesma receita líquida dos relatórios gerenciais e do painel."],
          ["Categoria", "Categoria registrada no item no momento da venda."],
          ...COMMON_DEFINITIONS.filter(([t]) => ["CMV", "Margem bruta", "Markup", "Devoluções", "Período"].includes(t)),
        ]}
      />
    </>
  );
}
