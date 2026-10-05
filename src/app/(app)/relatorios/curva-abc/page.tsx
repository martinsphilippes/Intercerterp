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
import { ParetoChart } from "@/components/charts/pareto-chart";
import { canDo } from "@/lib/permissions";
import { formatBps, formatMoney, formatQty, marginBps, markupBps, roundDiv } from "@/lib/money";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { ABC_CRITERIA, abcReport, type AbcRow, type Ranked } from "@/domain/abc";
import { resolveAbcParams } from "../params";
import { COMMON_DEFINITIONS, FilterSelect, HowWeCalculate, marginText, PrintHeader, PrintStyles, ReportFilters, ScopeLine } from "../_components/report-ui";
import { PrintButton } from "../_components/print-button";

export const metadata = { title: "Produtos e curva ABC" };

type TableRow = AbcRow & { rank: number; klass: "A" | "B" | "C"; value: number; shareBps: number; cumAfterBps: number; cumBeforeBps: number; markupBps: number | null };

const CLASS_TONE = { A: "brand", B: "info", C: "neutral" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("reports");
  const params = await searchParams;
  const ap = await resolveAbcParams(s, params);
  const report = await abcReport(s.ctx.store, ap.scope, { criterion: ap.criterion, categoryId: ap.categoryId, limits: ap.limits });
  const cls = report.classification;
  const crit = ABC_CRITERIA.find((c) => c.key === ap.criterion)!;
  const fmtValue = (v: number) => (crit.unit === "qty" ? formatQty(v) : formatMoney(v));
  const categories = await lookups.categories(s.ctx);
  const catName = ap.categoryId ? (ap.categoryId === "__none__" ? "Sem categoria" : (categories.find((c) => c.value === ap.categoryId)?.label ?? "—")) : "Todas";
  const base = "/relatorios/curva-abc";
  const canExport = canDo(s.user, "data.export");
  const productQs = (skuId: string) => `${base}/produto/${skuId}${qs({ page: null, sort: null, dir: null, classe: null }, params)}`;

  // classe filtrada: mesma participação/acumulado (denominador = base inteira)
  const all: TableRow[] = cls.base.map((x: Ranked<AbcRow>) => ({ ...x.row, rank: x.rank, klass: x.klass, value: x.value, shareBps: x.shareBps, cumAfterBps: x.cumAfterBps, cumBeforeBps: x.cumBeforeBps, markupBps: markupBps(x.row.netRevenue, x.row.cmv) }));
  const visible = ap.klass && ap.klass !== "sem" ? all.filter((r) => r.klass === ap.klass) : ap.klass === "sem" ? [] : all;
  const lp = parseList(params, { sort: "rank", dir: "asc", pageSize: 50 });
  const { rows, total } = paginate(visible, lp);
  const sum = (k: keyof TableRow) => visible.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const visibleShare = visible.reduce((a, r) => a + r.value, 0);
  const excludedMoved = cls.excluded.filter((x) => !x.row.noMovement);
  const excludedIdle = cls.excluded.filter((x) => x.row.noMovement);
  const classHref = (k: string | null) => `${base}${qs({ classe: k, page: null }, params)}`;

  const columns: Column<TableRow>[] = [
    { key: "rank", label: "#", sortable: true, fixed: true, cell: (r) => r.rank },
    { key: "klass", label: "Classe", cell: (r) => <Badge tone={CLASS_TONE[r.klass]}>{r.klass}</Badge> },
    { key: "sku", label: "SKU", sortable: true, cell: (r) => <Link href={productQs(r.skuId)} className="font-medium text-brand-700 hover:underline">{r.sku}</Link> },
    { key: "description", label: "Produto", sortable: true, cell: (r) => <span className="line-clamp-2 min-w-[160px]">{r.description}</span> },
    { key: "categoryName", label: "Categoria", sortable: true, hidden: true, cell: (r) => r.categoryName ?? "—" },
    { key: "qtyNet", label: "Qtd. líquida", align: "right", sortable: true, cell: (r) => formatQty(r.qtyNet, r.unitCode ?? undefined) },
    { key: "netRevenue", label: "Receita líquida", align: "right", sortable: true, cell: (r) => formatMoney(r.netRevenue) },
    { key: "returns", label: "Devoluções", align: "right", hidden: true, cell: (r) => (r.returns ? `− ${formatMoney(r.returns)}` : "—") },
    { key: "cmv", label: "CMV", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.cmv) },
    { key: "grossProfit", label: "Lucro bruto", align: "right", sortable: true, hidden: ap.criterion !== "margem", cell: (r) => formatMoney(r.grossProfit) },
    { key: "marginBps", label: "Margem", align: "right", sortable: true, cell: (r) => marginText(r.marginBps) },
    { key: "markupBps", label: "Markup", align: "right", sortable: true, hidden: true, cell: (r) => (r.markupBps == null ? "—" : formatBps(r.markupBps)) },
    { key: "shareBps", label: "Participação", align: "right", sortable: true, cell: (r) => formatBps(r.shareBps) },
    { key: "cumAfterBps", label: "Acumulado", align: "right", sortable: true, cell: (r) => formatBps(r.cumAfterBps) },
  ];

  return (
    <>
      <PrintStyles />
      <PrintHeader title={`Curva ABC — ${crit.label}`} company={String(s.company.tradeName || s.company.name)} user={s.user.name} rp={ap} />
      <PageHeader
        title="Produtos e curva ABC"
        crumbs={[{ label: "Análise" }, { label: "Produtos e curva ABC" }]}
        description="Classificação dos produtos/SKUs pela participação no resultado do período, na mesma base dos relatórios gerenciais."
        actions={
          <>
            <LinkButton href={`/relatorios/gerenciais${qs({ periodo: ap.period.preset === "personalizado" ? "personalizado" : ap.period.preset, de: ap.period.preset === "personalizado" ? ap.period.from : null, ate: ap.period.preset === "personalizado" ? ap.period.to : null, filial: ap.filial })}`}>
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
      <ReportFilters basePath={base} params={params} rp={ap}>
        <FilterSelect name="criterio" label="Critério" value={ap.criterion === "receita" ? "" : ap.criterion} all="Receita líquida (padrão)" options={ABC_CRITERIA.filter((c) => c.key !== "receita").map((c) => ({ value: c.key, label: c.label }))} />
        <FilterSelect name="categoria" label="Categoria" value={ap.categoryId ?? ""} all="Todas" options={[...categories, { value: "__none__", label: "Sem categoria" }]} />
        <FilterSelect name="classe" label="Classe" value={ap.klass ?? ""} all="Todas" options={[{ value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "sem", label: "Sem receita no período" }]} />
        <label className="flex w-24 flex-col gap-1 text-xs font-medium text-slate-600">
          Limite A (%)
          <input name="la" inputMode="decimal" defaultValue={(ap.limits.a / 100).toLocaleString("pt-BR")} className={`${inputClass} h-9 text-right`} aria-describedby="abc-limits-hint" />
        </label>
        <label className="flex w-24 flex-col gap-1 text-xs font-medium text-slate-600">
          Limite B (%)
          <input name="lb" inputMode="decimal" defaultValue={(ap.limits.b / 100).toLocaleString("pt-BR")} className={`${inputClass} h-9 text-right`} aria-describedby="abc-limits-hint" />
        </label>
      </ReportFilters>
      <p id="abc-limits-hint" className="sr-only">
        Limites da participação acumulada para as classes A e B. Os valores padrão vêm dos parâmetros da empresa; alterar aqui vale só para este recorte.
      </p>
      {(ap.error || ap.limitsError) && (
        <div className="mb-4 space-y-2">
          {ap.error && <Notice tone="warn">{ap.error}</Notice>}
          {ap.limitsError && <Notice tone="warn">{ap.limitsError}</Notice>}
        </div>
      )}
      <ScopeLine
        rp={ap}
        extra={
          <>
            <span>
              <strong className="font-semibold text-slate-700">Critério:</strong> {crit.label}
            </span>
            <span>
              <strong className="font-semibold text-slate-700">Categoria:</strong> {catName}
            </span>
            <span>
              <strong className="font-semibold text-slate-700">Limites:</strong> A até {formatBps(ap.limits.a, ap.limits.a % 100 ? 2 : 0)} · B até {formatBps(ap.limits.b, ap.limits.b % 100 ? 2 : 0)}{" "}
              {ap.customLimits ? (
                <>
                  (ajustados para este recorte; parâmetro da empresa: {formatBps(ap.companyLimits.a, 0)}/{formatBps(ap.companyLimits.b, 0)} —{" "}
                  <Link className="text-brand-700 hover:underline" href={`${base}${qs({ la: null, lb: null }, params)}`}>
                    restaurar
                  </Link>
                  )
                </>
              ) : (
                "(parâmetros abc.limitA/abc.limitB da empresa)"
              )}
            </span>
          </>
        }
      />

      <section aria-label="Resumo por classe" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["A", "B", "C"] as const).map((k) => (
          <Stat key={k} label={`Classe ${k}${ap.klass === k ? " (filtrada)" : ""}`} value={`${cls.classes[k].count} ${cls.classes[k].count === 1 ? "item" : "itens"}`} hint={`${formatBps(cls.classes[k].shareBps)} da base · ${fmtValue(cls.classes[k].value)}`} href={classHref(ap.klass === k ? null : k)} />
        ))}
        <Stat label={`Sem receita no período${ap.klass === "sem" ? " (filtrada)" : ""}`} value={`${cls.excluded.length} ${cls.excluded.length === 1 ? "item" : "itens"}`} hint={`${excludedMoved.length} com movimento (${fmtValue(cls.excludedTotal)}) · ${excludedIdle.length} sem vendas`} href={classHref(ap.klass === "sem" ? null : "sem")} tone={excludedMoved.length ? "warn" : "default"} />
      </section>

      <Card title="Reconciliação" className="mb-4">
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <dl className="space-y-1">
            <div className="flex justify-between gap-4">
              <dt>Base da curva ({cls.base.length} itens com valor positivo)</dt>
              <dd className="tabular">{fmtValue(cls.baseTotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>(+) Itens fora da base (valor ≤ 0)</dt>
              <dd className="tabular">{fmtValue(cls.excludedTotal)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
              <dt>= Total do recorte — {crit.label.toLowerCase()}</dt>
              <dd className="tabular">{fmtValue(cls.total)}</dd>
            </div>
          </dl>
          <div className="space-y-1">
            <p className="flex justify-between gap-4">
              <span>Receita líquida do recorte (mesma dos gerenciais)</span>
              <span className="tabular font-semibold">{formatMoney(report.revenue.total)}</span>
            </p>
            <p className="flex justify-between gap-4 text-slate-600">
              <span>= receita dos itens da curva + itens fora da base</span>
              <span className="tabular">
                {formatMoney(report.revenue.base)} {report.revenue.excluded < 0 ? "−" : "+"} {formatMoney(Math.abs(report.revenue.excluded))}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {report.totals.salesCount} venda(s) e {report.totals.returnsCount} devolução(ões) no recorte. Filtrar por classe não altera o denominador: participação e acumulado continuam sobre {fmtValue(cls.baseTotal)}.
            </p>
          </div>
        </div>
      </Card>

      {cls.base.length > 0 ? (
        <Card className="mb-4" title="Curva ABC (Pareto)" description={`Participação de cada item e acumulado sobre a base de ${fmtValue(cls.baseTotal)}. Clique numa coluna para abrir a composição do item.`}>
          <ParetoChart
            points={all.map((r) => ({ rank: r.rank, skuId: r.skuId, sku: r.sku, name: r.description, shareBps: r.shareBps, cumBps: r.cumAfterBps, klass: r.klass, valueText: fmtValue(r.value) }))}
            limitA={ap.limits.a}
            limitB={ap.limits.b}
            highlight={ap.klass && ap.klass !== "sem" ? ap.klass : null}
            drillBase={productQs("{sku}")}
            caption={`${cls.base.length} itens na base: A ${cls.classes.A.count} (${formatBps(cls.classes.A.shareBps)}), B ${cls.classes.B.count} (${formatBps(cls.classes.B.shareBps)}), C ${cls.classes.C.count} (${formatBps(cls.classes.C.shareBps)}).`}
          />
        </Card>
      ) : null}

      {ap.klass !== "sem" && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink">
            Itens da curva {ap.klass ? `— classe ${ap.klass}` : ""} <span className="font-normal text-slate-500">(participação sobre a base inteira)</span>
          </h2>
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
                qtyNet: new Set(visible.map((r) => r.unitCode ?? "")).size <= 1 ? formatQty(sum("qtyNet"), visible[0]?.unitCode ?? undefined) : "unid. mistas",
                netRevenue: formatMoney(sum("netRevenue")),
                returns: `− ${formatMoney(sum("returns"))}`,
                cmv: formatMoney(sum("cmv")),
                grossProfit: formatMoney(sum("grossProfit")),
                marginBps: marginText(marginBps(sum("netRevenue"), sum("cmv"))),
                shareBps: cls.baseTotal > 0 ? formatBps(roundDiv(visibleShare * 10000, cls.baseTotal)) : "—",
              }}
              empty={<EmptyState title="Nenhum item com valor positivo no recorte" description="Ajuste o período, a filial ou a categoria. Itens sem receita aparecem abaixo." />}
            />
          </div>
        </>
      )}

      {(!ap.klass || ap.klass === "sem") && (
        <Card title="Sem receita no período (fora da base da curva)" description="Itens cujo valor no critério é ≤ 0 — não entram no denominador da curva." className="mb-4" bodyClass="p-0">
          {excludedMoved.length === 0 && excludedIdle.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Todos os itens com movimento têm valor positivo.</p>
          ) : (
            <>
              {excludedMoved.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="table-base w-full text-sm">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Produto</th>
                        <th>Motivo</th>
                        <th className="text-right">Qtd. vendida</th>
                        <th className="text-right">Qtd. devolvida</th>
                        <th className="text-right">Receita líquida</th>
                        <th className="text-right">Valor no critério</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excludedMoved.map((x) => (
                        <tr key={x.row.skuId}>
                          <td>
                            <Link href={productQs(x.row.skuId)} className="font-medium text-brand-700 hover:underline">
                              {x.row.sku}
                            </Link>
                          </td>
                          <td>{x.row.description}</td>
                          <td className="text-slate-600">{x.row.returns > 0 && x.row.salesCount === 0 ? "Somente devolução no período (venda anterior)" : x.row.returns > 0 ? "Devoluções ≥ vendas" : ap.criterion === "margem" ? "Lucro bruto ≤ 0" : "Valor ≤ 0"}</td>
                          <td className="tabular text-right">{formatQty(x.row.qtySold)}</td>
                          <td className="tabular text-right">{formatQty(x.row.qtyReturned)}</td>
                          <td className="tabular text-right text-amber-800">{formatMoney(x.row.netRevenue)}</td>
                          <td className="tabular text-right">{fmtValue(x.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {excludedIdle.length > 0 && (
                <details className="border-t border-line px-4 py-3 text-sm">
                  <summary className="cursor-pointer text-brand-700">
                    {excludedIdle.length} SKU(s) ativo(s) sem vendas no período{ap.categoryId ? " (na categoria)" : ""}
                  </summary>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                    {excludedIdle.slice(0, 150).map((x) => (
                      <li key={x.row.skuId} className="truncate">
                        <Link href={`/produtos/${x.row.productId}`} className="text-brand-700 hover:underline">
                          {x.row.sku}
                        </Link>{" "}
                        <span className="text-slate-600">{x.row.description}</span>
                      </li>
                    ))}
                  </ul>
                  {excludedIdle.length > 150 && <p className="mt-2 text-xs text-slate-500">Lista completa na exportação.</p>}
                </details>
              )}
            </>
          )}
        </Card>
      )}

      <HowWeCalculate
        items={[
          ["Valor de cada item", "Receita líquida do SKU no recorte (padrão) = bruto − descontos + acréscimos − devoluções do período; ou quantidade líquida (vendida − devolvida, em unidades do item); ou lucro bruto (receita líquida − CMV)."],
          ["Base da curva", "Somente itens com valor positivo. Itens com valor ≤ 0 (devoluções maiores que as vendas, venda anterior devolvida no período ou sem vendas) ficam em “Sem receita no período”."],
          ["Ordenação", "Valor decrescente; empate pela maior quantidade líquida; depois pelo código do SKU em ordem crescente."],
          ["Classificação", "Pelo acumulado ANTERIOR à inclusão do item: acumulado anterior < limite A → classe A; < limite B → classe B; senão C. Assim, o item que cruza o limite fica na classe que estava sendo preenchida (ex.: A pode terminar em 85,09% com limite de 80%)."],
          ["Limites", "Padrão dos parâmetros abc.limitA (8000 bps = 80%) e abc.limitB (9500 bps = 95%) da empresa/filial; podem ser ajustados na tela apenas para o recorte."],
          ["Participação e acumulado", "Sempre sobre o total da base inteira. Filtrar por classe não recalcula o denominador."],
          ["Reconciliação", "Receita total do recorte = base da curva + itens com receita ≤ 0 — a mesma receita líquida dos relatórios gerenciais e do painel."],
          ["Categoria", "Categoria registrada no item no momento da venda."],
          ...COMMON_DEFINITIONS.filter(([t]) => ["CMV", "Margem bruta", "Markup", "Devoluções", "Período"].includes(t)),
        ]}
      />
    </>
  );
}
