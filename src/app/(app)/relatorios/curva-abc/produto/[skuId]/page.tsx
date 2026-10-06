import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download, Package } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { can, canDo } from "@/lib/permissions";
import { formatBps, formatMoney, formatQty, markupBps, roundDiv } from "@/lib/money";
import { dayRange, formatDateTime } from "@/lib/dates";
import { qs, type SearchParams } from "@/lib/list";
import { ABC_CRITERIA, abcProductLines, abcReport } from "@/domain/abc";
import { nameMaps } from "@/domain/reports";
import { resolveAbcParams } from "../../../params";
import { COMMON_DEFINITIONS, HowWeCalculate, marginText, PrintHeader, PrintStyles, ReportFilters, ScopeLine } from "../../../_components/report-ui";
import { PrintButton } from "../../../_components/print-button";

export const metadata = { title: "Composição do produto na curva ABC" };

const CLASS_TONE = { A: "brand", B: "info", C: "neutral" } as const;

export default async function Page({ params: routeParams, searchParams }: { params: Promise<{ skuId: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("reports");
  const { skuId } = await routeParams;
  const params = await searchParams;
  const sku = await s.ctx.store.get("skus", skuId);
  if (!sku || sku.companyId !== s.ctx.companyId) notFound();
  const product = sku.productId ? await s.ctx.store.get("products", sku.productId) : null;
  const ap = await resolveAbcParams(s, params);
  const [report, comp, names] = await Promise.all([
    abcReport(s.ctx.store, ap.scope, { criterion: ap.criterion, categoryId: ap.categoryId, limits: ap.limits, includeNoMovement: false }),
    abcProductLines(s.ctx.store, ap.scope, skuId, ap.categoryId),
    nameMaps(s.ctx.store, s.ctx.companyId),
  ]);
  const ranked = report.classification.base.find((x) => x.row.skuId === skuId) ?? null;
  const excluded = report.classification.excluded.find((x) => x.row.skuId === skuId) ?? null;
  const t = comp.totals;
  const crit = ABC_CRITERIA.find((c) => c.key === ap.criterion)!;
  const fmtValue = (v: number) => (crit.unit === "qty" ? formatQty(v, sku.unitCode ?? undefined) : formatMoney(v));
  const sales = comp.lines.filter((l) => l.kind === "sale").sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const returns = comp.lines.filter((l) => l.kind === "return").sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const { start } = dayRange(ap.period.from, ap.period.to);
  const consolidated = !ap.single;
  const backQs = qs({ page: null, sort: null, dir: null }, params);
  const canExport = canDo(s.user, "data.export");
  const unit = sku.unitCode ?? product?.unitCode ?? undefined;

  return (
    <>
      <PrintStyles />
      <PrintHeader title={`Curva ABC — ${sku.sku} ${sku.name ?? product?.name ?? ""}`} company={String(s.company.tradeName || s.company.name)} user={s.user.name} rp={ap} />
      <PageHeader
        title={sku.name ?? product?.name ?? sku.sku}
        badges={ranked ? <Badge tone={CLASS_TONE[ranked.klass]}>Classe {ranked.klass}</Badge> : <Badge tone="warn">Sem receita no período</Badge>}
        crumbs={[{ label: "Análise" }, { label: "Produtos e curva ABC", href: `/relatorios/curva-abc${backQs}` }, { label: sku.sku }]}
        description={`SKU ${sku.sku}${product ? ` · ${product.name}` : ""}. Vendas e devoluções do recorte que formam o valor do item na curva.`}
        actions={
          <>
            {product && can(s.user, "products") && (
              <LinkButton href={`/produtos/${product.id}`}>
                <Package className="size-4" aria-hidden /> Cadastro do produto
              </LinkButton>
            )}
            {canExport && (
              <a className={buttonClass("secondary")} href={`/api/export/reports-abc-product${qs({ sku: skuId, page: null }, params)}`}>
                <Download className="size-4" aria-hidden /> Exportar (CSV)
              </a>
            )}
            <PrintButton />
          </>
        }
      />
      <ReportFilters basePath={`/relatorios/curva-abc/produto/${skuId}`} params={params} rp={ap} keep={["criterio", "categoria", "la", "lb"]} />
      {ap.error && (
        <div className="mb-4">
          <Notice tone="warn">{ap.error}</Notice>
        </div>
      )}
      <ScopeLine rp={ap} extra={<span><strong className="font-semibold text-slate-700">Critério:</strong> {crit.label} · limites A {formatBps(ap.limits.a, 0)} / B {formatBps(ap.limits.b, 0)}</span>} />

      <section aria-label="Posição na curva" className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Posição na curva" value={ranked ? `#${ranked.rank} de ${report.classification.base.length}` : "Fora da base"} hint={ranked ? `Classe ${ranked.klass} · acumulado anterior ${formatBps(ranked.cumBeforeBps)}` : "Valor ≤ 0 no critério"} />
        <Stat label="Participação" value={ranked ? formatBps(ranked.shareBps) : "—"} hint={ranked ? `Acumulado ${formatBps(ranked.cumAfterBps)} · ${fmtValue(ranked.value)}` : excluded ? fmtValue(excluded.value) : undefined} />
        <Stat label="Receita líquida" value={formatMoney(t.netRevenue)} hint={`Vendas ${formatMoney(t.salesNet)} − devoluções ${formatMoney(t.returns)}`} tone={t.netRevenue < 0 ? "bad" : "default"} />
        <Stat label="Quantidade líquida" value={formatQty(t.qtyNet, unit)} hint={`Vendida ${formatQty(t.qtySold)} · devolvida ${formatQty(t.qtyReturned)}`} />
        <Stat label="CMV · margem" value={formatMoney(t.cmv)} hint={`Margem ${marginText(t.marginBps)}`} />
        <Stat label="Markup" value={markupBps(t.netRevenue, t.cmv) == null ? "—" : formatBps(markupBps(t.netRevenue, t.cmv)!)} hint="(receita − custo) ÷ custo" />
      </section>

      <h2 className="mb-2 text-sm font-semibold text-ink">Vendas no período ({sales.length})</h2>
      <Card bodyClass="p-0" className="mb-4">
        {sales.length === 0 ? (
          <EmptyState title="Nenhuma venda concluída deste item no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm [&_.tabular]:whitespace-nowrap">
              <thead>
                <tr>
                  <th>Venda</th>
                  <th>Data/hora</th>
                  {consolidated && <th>Filial</th>}
                  <th>Operador</th>
                  <th className="text-right">Qtd.</th>
                  <th className="text-right">Preço unit.</th>
                  <th className="text-right">Bruto</th>
                  <th className="text-right">Descontos</th>
                  <th className="text-right">Acréscimos</th>
                  <th className="text-right">Líquido</th>
                  <th className="text-right">Custo</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/vendas/${l.saleId}`} className="font-medium text-brand-700 hover:underline">
                        nº {l.saleNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(l.at)}</td>
                    {consolidated && <td>{names.branches.get(l.branchId) ?? "—"}</td>}
                    <td>{l.operatorId ? (names.users.get(l.operatorId) ?? "—") : "—"}</td>
                    <td className="tabular text-right">{formatQty(l.qty, unit)}</td>
                    <td className="tabular text-right">{l.qty ? formatMoney(roundDiv(l.gross * 1000, l.qty)) : "—"}</td>
                    <td className="tabular text-right">{formatMoney(l.gross)}</td>
                    <td className="tabular text-right">{l.discount ? `− ${formatMoney(l.discount)}` : "—"}</td>
                    <td className="tabular text-right">{l.surcharge ? formatMoney(l.surcharge) : "—"}</td>
                    <td className="tabular text-right font-medium">{formatMoney(l.total)}</td>
                    <td className="tabular text-right">{formatMoney(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td className="border-t border-line px-3 py-2" colSpan={consolidated ? 4 : 3}>
                    Total das vendas
                  </td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatQty(t.qtySold, unit)}</td>
                  <td className="border-t border-line px-3 py-2" />
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.gross)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">− {formatMoney(t.discounts)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.surcharges)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.salesNet)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.costSold)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-ink">Devoluções no período ({returns.length}) — data do movimento</h2>
      <Card bodyClass="p-0" className="mb-4">
        {returns.length === 0 ? (
          <EmptyState title="Nenhuma devolução deste item no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm [&_.tabular]:whitespace-nowrap">
              <thead>
                <tr>
                  <th>Devolução</th>
                  <th>Data/hora</th>
                  {consolidated && <th>Filial</th>}
                  <th>Venda de origem</th>
                  <th className="text-right">Qtd.</th>
                  <th className="text-right">Valor devolvido</th>
                  <th className="text-right">Custo revertido</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/vendas/devolucoes/${l.docId}`} className="font-medium text-brand-700 hover:underline">
                        nº {l.docNumber ?? "—"}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(l.at)}</td>
                    {consolidated && <td>{names.branches.get(l.branchId) ?? "—"}</td>}
                    <td>
                      <Link href={`/vendas/${l.saleId}`} className="text-brand-700 hover:underline">
                        Venda nº {l.saleNumber ?? "—"}
                      </Link>{" "}
                      <span className="text-xs text-slate-500">{formatDateTime(l.saleAt)}</span>
                      {l.saleAt && new Date(l.saleAt).getTime() < new Date(start).getTime() && (
                        <Badge tone="info" className="ml-1">
                          anterior ao período
                        </Badge>
                      )}
                    </td>
                    <td className="tabular text-right">{formatQty(l.qty, unit)}</td>
                    <td className="tabular text-right text-amber-800">− {formatMoney(l.total)}</td>
                    <td className="tabular text-right">− {formatMoney(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td className="border-t border-line px-3 py-2" colSpan={consolidated ? 4 : 3}>
                    Total das devoluções
                  </td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatQty(t.qtyReturned, unit)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">− {formatMoney(t.returns)}</td>
                  <td className="tabular border-t border-line px-3 py-2 text-right">− {formatMoney(t.costReturned)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="Composição do valor na curva">
        <dl className="max-w-xl space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt>Vendas líquidas do item</dt>
            <dd className="tabular">{formatMoney(t.salesNet)}</dd>
          </div>
          <div className="flex justify-between gap-4 text-amber-800">
            <dt>(−) Devoluções do período</dt>
            <dd className="tabular">− {formatMoney(t.returns)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
            <dt>= Receita líquida</dt>
            <dd className="tabular">{formatMoney(t.netRevenue)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>(−) CMV (custo vendido − custo revertido)</dt>
            <dd className="tabular">− {formatMoney(t.cmv)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
            <dt>= Lucro bruto</dt>
            <dd className="tabular">{formatMoney(t.grossProfit)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Valor no critério ({crit.label.toLowerCase()}): <strong>{fmtValue(ranked?.value ?? excluded?.value ?? 0)}</strong> — sobre a base da curva de {fmtValue(report.classification.baseTotal)}.
        </p>
      </Card>

      <HowWeCalculate items={COMMON_DEFINITIONS.filter(([k]) => ["Receita líquida comercial", "CMV", "Margem bruta", "Markup", "Devoluções", "Período"].includes(k))} />
    </>
  );
}
