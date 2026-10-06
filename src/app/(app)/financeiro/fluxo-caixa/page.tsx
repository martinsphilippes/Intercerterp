import Link from "next/link";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, type FilterDef } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { lookups, nameMap } from "@/lib/server/lookups";
import { computeCashflow, computeCompetence } from "@/domain/cashflow";
import { ACCOUNT_KIND_LABEL } from "@/domain/finance";
import { CASHFLOW_PRESETS, cashflowFilter, queryCashflowMovements } from "../queries";
import { CashflowCharts } from "./charts";
import { NewEntryDialog, TransferDialog } from "../_components/account-forms";

export const metadata = { title: "Fluxo de caixa" };

const money = (v: number, signed = false) => (signed && v > 0 ? `+ ${formatMoney(v)}` : formatMoney(v));
/** valor absoluto de saídas (sem "-R$ 0,00") */
const neg = (v: number) => formatMoney(v === 0 ? 0 : -v);

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  const raw = await searchParams;
  // alias do contrato de links entre módulos: ?conta=<accountId>
  const params: SearchParams = raw.conta && !raw.account ? { ...raw, account: raw.conta, conta: undefined } : raw;
  const tab = (params.tab as string) || "resumo";
  const p = parseList(params, { sort: "date", dir: "asc", pageSize: 50 });
  const f = cashflowFilter(s.ctx, p);
  const cf = await computeCashflow(s.ctx, f);
  const [accounts, cats, ccs, branches, catNames] = await Promise.all([lookups.accounts(s.ctx), lookups.finCategories(s.ctx), lookups.costCenters(s.ctx), lookups.branches(s.ctx), nameMap(s.ctx, "fin_categories")]);
  const keep: Record<string, string> = {};
  for (const k of ["preset", "ref", "from", "to", "g", "account", "category", "costCenter", "branch", "overdue"]) if (p.f[k]) keep[k] = p.f[k];
  const base = `/financeiro/fluxo-caixa${qs({ ...keep, from: f.from, to: f.to, preset: null })}`;
  const mov = (extra: Record<string, string | null>) => `/financeiro/fluxo-caixa${qs({ ...keep, from: f.from, to: f.to, preset: null, tab: "movimentos", ...extra })}`;
  const t = cf.totals;
  const currentTotal = cf.accounts.reduce((a, x) => a + x.current, 0);
  const filters: FilterDef[] = [
    { type: "select", name: "preset", label: "Período", options: CASHFLOW_PRESETS, all: "Mês da data de referência" },
    { type: "date", name: "ref", label: "Data de referência" },
    { type: "date", name: "from", label: "De (personalizado)" },
    { type: "date", name: "to", label: "Até" },
    { type: "select", name: "g", label: "Agrupar por", options: [{ value: "day", label: "Dia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mês" }], all: "Automático" },
    { type: "select", name: "account", label: "Conta", options: accounts, all: "Todas as contas" },
    { type: "select", name: "category", label: "Categoria", options: [...cats, { value: "none", label: "Sem categoria" }] },
    { type: "select", name: "costCenter", label: "Centro de custo", options: ccs },
    { type: "select", name: "overdue", label: "Vencidos em aberto", options: [{ value: "1", label: "Incluir na previsão de hoje" }], all: "Mostrar à parte" },
  ];
  if (!s.ctx.branchId) filters.push({ type: "select", name: "branch", label: "Filial", options: branches, all: "Todas as filiais (consolidado)" });
  const writeBlock = !s.ctx.branchId ? "Selecione uma filial (consolidado é somente consulta)." : undefined;
  const scopeLabel = f.branchId ? `filial ${branches.find((b) => b.value === f.branchId)?.label ?? ""}` : "todas as filiais";
  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        crumbs={[{ label: "Financeiro" }, { label: "Fluxo de caixa" }]}
        description={`Realizado (data de liquidação, extrato interno) × previsto (parcelas em aberto pelo vencimento) — ${formatDate(f.from)} a ${formatDate(f.to)}, ${scopeLabel}.`}
        actions={
          can(s.user, "finance", "create") && (
            <>
              <TransferDialog accounts={accounts} disabled={Boolean(writeBlock)} disabledReason={writeBlock} />
              <NewEntryDialog accounts={accounts} categories={cats} costCenters={ccs} disabled={Boolean(writeBlock)} disabledReason={writeBlock} />
            </>
          )
        }
      />
      <FilterBar basePath="/financeiro/fluxo-caixa" values={params} filters={filters}>
        {tab !== "resumo" && <input type="hidden" name="tab" value={tab} />}
      </FilterBar>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Saldo disponível hoje" value={formatMoney(currentTotal)} hint={f.accountId ? "Conta selecionada" : "Caixas e contas bancárias"} href="#contas" />
        <Stat label={`Saldo inicial em ${formatDate(f.from)}`} value={cf.showBalance ? formatMoney(cf.openingProjected) : "—"} hint={cf.showBalance ? (cf.openingProjected !== cf.opening ? `Realizado ${formatMoney(cf.opening)} + previsto até a véspera` : "Saldos iniciais + lançamentos anteriores") : "Indisponível com filtro de categoria/centro"} />
        <Stat label="Entradas no período" value={formatMoney(t.realizedIn + t.forecastIn)} tone="good" hint={`Realizado ${formatMoney(t.realizedIn)} · previsto ${formatMoney(t.forecastIn)}`} href={mov({ type: "in" })} />
        <Stat label="Saídas no período" value={neg(t.realizedOut + t.forecastOut)} tone="bad" hint={`Realizado ${neg(t.realizedOut)} · previsto ${neg(t.forecastOut)}`} href={mov({ type: "out" })} />
        <Stat label={`Saldo projetado em ${formatDate(f.to)}`} value={cf.showBalance ? formatMoney(t.closing) : "—"} tone={t.closing < 0 ? "bad" : "default"} hint="Saldo inicial + entradas − saídas ± transferências" href={mov({})} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link href={mov({ type: "transfer" })} className="rounded-full border border-line bg-white px-3 py-1 text-slate-600 hover:border-brand-300">
          Transferências entre contas (fora do resultado): entradas {formatMoney(t.transfersIn)} · saídas {neg(t.transfersOut)}
        </Link>
        {(t.overdueIn !== 0 || t.overdueOut !== 0) && (
          <>
            <Link href="/financeiro/receber?state=overdue" className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-800">
              A receber vencido: {formatMoney(t.overdueIn)} {f.includeOverdue ? "(incluído hoje)" : "(fora da previsão)"}
            </Link>
            <Link href="/financeiro/pagar?state=overdue" className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-800">
              A pagar vencido: {neg(t.overdueOut)} {f.includeOverdue ? "(incluído hoje)" : "(fora da previsão)"}
            </Link>
          </>
        )}
        {!cf.forecastAvailable && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">Previsões não são exibidas com filtro de conta (parcelas não têm conta definida).</span>}
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Resumo e gráfico" },
          { key: "movimentos", label: "Movimentações" },
          { key: "competencia", label: "Competência" },
        ]}
      />
      {tab === "resumo" && (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title="Entradas, saídas e saldo projetado" description={`Agrupado por ${f.granularity === "day" ? "dia" : f.granularity === "week" ? "semana" : "mês"} · realizado sólido, previsto hachurado`}>
              <CashflowCharts
                buckets={cf.buckets.map((b) => ({ key: b.key, label: b.label, from: b.from, to: b.to, realizedIn: b.realizedIn, forecastIn: b.forecastIn, realizedOut: b.realizedOut, forecastOut: b.forecastOut, balance: b.balance, hasToday: cf.today >= b.from && cf.today <= b.to }))}
                showBalance={cf.showBalance}
                baseHref={`/financeiro/fluxo-caixa?${new URLSearchParams(Object.entries(keep).filter(([k]) => !["preset", "from", "to"].includes(k))).toString()}`}
              />
            </Card>
            <Card title="Saldos por conta" description="Saldo atual e previsto atribuído pela conta de destino do meio de pagamento">
              <ul id="contas" className="divide-y divide-line">
                {cf.accounts.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 py-2.5">
                    <Link href={`/financeiro/contas/${a.id}`} className="min-w-0 hover:text-brand-700">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      <span className="text-xs text-slate-500">
                        {ACCOUNT_KIND_LABEL[a.kind] ?? a.kind}
                        {!a.active && " · inativa"}
                      </span>
                    </Link>
                    <span className="text-right">
                      <span className="tabular block text-sm font-semibold">{formatMoney(a.current)}</span>
                      {a.forecast !== 0 && <span className={cn("tabular block text-xs", a.forecast > 0 ? "text-emerald-700" : "text-red-700")}>{money(a.forecast, true)} previsto</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {cf.forecastUnassigned !== 0 && (
                <p className="mt-2 flex justify-between text-xs text-slate-500">
                  <span>Previsto sem conta definida</span>
                  <span className="tabular">{money(cf.forecastUnassigned, true)}</span>
                </p>
              )}
              <div className="mt-3 flex items-center justify-between rounded-md bg-brand-50 px-3 py-2">
                <span className="text-sm font-medium text-brand-800">Total consolidado</span>
                <span className="tabular text-base font-semibold text-brand-800">{formatMoney(currentTotal)}</span>
              </div>
            </Card>
          </div>
          <Card title="Por período" description={`Cada valor abre os lançamentos/parcelas que o compõem${f.granularity === "day" ? " · dias sem movimento omitidos" : ""}`} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th className="text-right">Entradas realizadas</th>
                    <th className="text-right">Saídas realizadas</th>
                    <th className="text-right">Transferências (líq.)</th>
                    <th className="text-right">Entradas previstas</th>
                    <th className="text-right">Saídas previstas</th>
                    <th className="text-right">Saldo projetado</th>
                  </tr>
                </thead>
                <tbody>
                  {cf.buckets.filter((b) => f.granularity !== "day" || b.realizedIn || b.realizedOut || b.transfersIn || b.transfersOut || b.forecastIn || b.forecastOut || b.openings || (cf.today >= b.from && cf.today <= b.to) || b.from === f.from).map((b) => {
                    const cell = (v: number, extra: Record<string, string>) => (v ? <Link className="hover:underline" href={mov({ from: b.from, to: b.to, ...extra })}>{formatMoney(v)}</Link> : <span className="text-slate-300">—</span>);
                    return (
                      <tr key={b.key} className={cf.today >= b.from && cf.today <= b.to ? "bg-accent-50/40" : undefined}>
                        <td className="whitespace-nowrap font-medium">
                          {b.label}
                          {cf.today >= b.from && cf.today <= b.to && <Badge tone="accent" className="ml-2">hoje</Badge>}
                        </td>
                        <td className="tabular text-right text-emerald-700">{cell(b.realizedIn, { type: "in", status: "realized" })}</td>
                        <td className="tabular text-right text-red-700">{cell(-b.realizedOut, { type: "out", status: "realized" })}</td>
                        <td className="tabular text-right text-slate-600">{cell(b.transfersIn + b.transfersOut, { type: "transfer" }) }</td>
                        <td className="tabular text-right text-emerald-700/80">{cell(b.forecastIn, { type: "in", status: "forecast" })}</td>
                        <td className="tabular text-right text-red-700/80">{cell(-b.forecastOut, { type: "out", status: "forecast" })}</td>
                        <td className={cn("tabular text-right font-medium", b.balance < 0 && "text-red-700")}>{cf.showBalance ? formatMoney(b.balance) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="border-t border-line px-3 py-2">Total</td>
                    <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.realizedIn)}</td>
                    <td className="tabular border-t border-line px-3 py-2 text-right">{neg(t.realizedOut)}</td>
                    <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.transfersIn + t.transfersOut)}</td>
                    <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(t.forecastIn)}</td>
                    <td className="tabular border-t border-line px-3 py-2 text-right">{neg(t.forecastOut)}</td>
                    <td className="tabular border-t border-line px-3 py-2 text-right">{cf.showBalance ? formatMoney(t.closing) : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <Card title="Por categoria" description="Categoria do lançamento → do título → padrão por origem (vendas, compras, tarifas)" bodyClass="p-0">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className="text-right">Entradas realizadas</th>
                  <th className="text-right">Saídas realizadas</th>
                  <th className="text-right">Entradas previstas</th>
                  <th className="text-right">Saídas previstas</th>
                </tr>
              </thead>
              <tbody>
                {cf.byCategory.map((c) => (
                  <tr key={c.categoryId || "none"}>
                    <td>
                      <Link className="text-brand-700 hover:underline" href={mov({ category: c.categoryId || "none" })}>
                        {c.categoryId ? (catNames.get(c.categoryId) ?? "—") : "Sem categoria"}
                      </Link>
                    </td>
                    <td className="tabular text-right">{c.realizedIn ? formatMoney(c.realizedIn) : "—"}</td>
                    <td className="tabular text-right">{c.realizedOut ? neg(c.realizedOut) : "—"}</td>
                    <td className="tabular text-right">{c.forecastIn ? formatMoney(c.forecastIn) : "—"}</td>
                    <td className="tabular text-right">{c.forecastOut ? neg(c.forecastOut) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {tab === "movimentos" && <Movements s={s} params={params} p={p} />}
      {tab === "competencia" && <Competence s={s} from={f.from} to={f.to} branchId={f.branchId ?? null} categoryId={f.categoryId ?? null} costCenterId={f.costCenterId ?? null} catNames={catNames} />}
    </>
  );
}

async function Movements({ s, params, p }: { s: Awaited<ReturnType<typeof requireSession>>; params: SearchParams; p: ReturnType<typeof parseList> }) {
  const { rows: all, opening } = await queryCashflowMovements(s.ctx, p);
  const { rows, total } = paginate(all, { ...p, sort: null });
  type Row = (typeof all)[number];
  const columns: Column<Row>[] = [
    { key: "date", label: "Data", fixed: true, cell: (r) => formatDate(r.date) },
    {
      key: "description",
      label: "Movimentação",
      cell: (r) => (
        <span className="flex items-start gap-2">
          <span aria-hidden className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs", r.side === "in" ? "bg-emerald-50 text-emerald-700" : r.side === "out" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600")}>
            {r.side === "in" ? "↙" : r.side === "out" ? "↗" : "⇄"}
          </span>
          <span>
            {r.href ? <Link className="text-ink hover:text-brand-700 hover:underline" href={r.href}>{r.description}</Link> : r.description}
            {r.party && <span className="block text-xs text-slate-500">{r.party}</span>}
          </span>
        </span>
      ),
    },
    { key: "category", label: "Categoria", cell: (r) => r.category },
    { key: "account", label: "Conta", cell: (r) => (r.accountId && r.status === "realized" ? <Link className="hover:underline" href={`/financeiro/contas/${r.accountId}`}>{r.account}</Link> : r.account) },
    { key: "document", label: "Documento", hidden: true, cell: (r) => r.document ?? "—" },
    { key: "status", label: "Status", cell: (r) => (r.status === "realized" ? <Badge tone="good">Realizado{r.reconciled ? " · conciliado" : ""}</Badge> : <Badge tone="info">Previsto</Badge>) },
    { key: "amount", label: "Valor", align: "right", cell: (r) => <span className={cn("whitespace-nowrap", r.amount > 0 ? "text-emerald-700" : "text-red-700")}>{r.amount > 0 ? "+ " : "− "}{formatMoney(Math.abs(r.amount))}</span> },
    { key: "balance", label: "Saldo acumulado", align: "right", cell: (r) => (r.balance == null ? "—" : formatMoney(r.balance)) },
  ];
  // por lado (estorno reduz o lado do lançamento original), como nos indicadores
  const sumIn = all.filter((r) => r.side === "in").reduce((a, r) => a + r.amount, 0);
  const sumOut = all.filter((r) => r.side === "out").reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <FilterBar
        basePath="/financeiro/fluxo-caixa"
        values={params}
        filters={[
          { type: "search", placeholder: "Descrição, cliente/fornecedor ou nº do título" },
          { type: "select", name: "type", label: "Tipo", options: [{ value: "in", label: "Entradas" }, { value: "out", label: "Saídas" }, { value: "transfer", label: "Transferências" }], all: "Entradas e saídas" },
          { type: "select", name: "status", label: "Status", options: [{ value: "realized", label: "Realizado" }, { value: "forecast", label: "Previsto" }], all: "Realizado e previsto" },
        ]}
      >
        {["tab", "preset", "ref", "from", "to", "account", "category", "costCenter", "branch", "overdue", "g", "direct"].map((k) => (params[k] ? <input key={k} type="hidden" name={k} value={String(params[k])} /> : null))}
      </FilterBar>
      {opening != null && <p className="mb-2 text-xs text-slate-500">Saldo acumulado parte do saldo inicial de {formatMoney(opening)} e considera lançamentos realizados e previstos em ordem cronológica.</p>}
      <DataTable
        id="fin-cashflow-movements"
        basePath="/financeiro/fluxo-caixa"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="fin-cashflow"
        totals={{ description: `Entradas ${formatMoney(sumIn)} · saídas ${neg(sumOut)}`, amount: formatMoney(all.reduce((a, r) => a + r.amount, 0)) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma movimentação no recorte.</div>}
      />
    </>
  );
}

async function Competence({ s, from, to, branchId, categoryId, costCenterId, catNames }: { s: Awaited<ReturnType<typeof requireSession>>; from: string; to: string; branchId: string | null; categoryId: string | null; costCenterId: string | null; catNames: Map<string, string> }) {
  const c = await computeCompetence(s.ctx, { fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7), branchId, categoryId, costCenterId });
  const titlesLink = (type: "revenue" | "expense", cat: string, m?: string) =>
    `/financeiro/${type === "revenue" ? "receber" : "pagar"}${qs({ compFrom: m ? `${m}-01` : c.from, compTo: m ? `${m}-31` : c.to, category: cat || "none", competence: "1", branch: branchId, costCenter: costCenterId, state: null })}`;
  return (
    <div className="space-y-4">
      <Notice tone="info">
        Regime de competência: títulos (vendas a prazo, cartão, contas a pagar, manuais) pelo valor total na data de competência + lançamentos diretos sem título (vendas à vista, cancelamentos, devoluções, tarifas) pela data. Devoluções de vendas a prazo abatidas do título reduzem a receita da categoria do título na data do abatimento (linhas “Devoluções (abatimento)”). Encargos de baixa ficam no realizado. Período: {formatDate(c.from)} a {formatDate(c.to)} · {c.titleCount} título(s), {c.entryCount} lançamento(s) direto(s) e {c.abatementCount} abatimento(s).
      </Notice>
      <Card title="Resultado por competência" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Categoria</th>
                {c.byMonth.map((m) => (
                  <th key={m.month} className="text-right">{m.label}</th>
                ))}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={`${r.type}-${r.categoryId}-${r.source ?? ""}`}>
                  <td>
                    <span className="mr-2 text-xs text-slate-400">{r.type === "revenue" ? "Receita" : "Despesa"}</span>
                    {r.source === "abatement" && "Devoluções (abatimento) — "}
                    {r.categoryId ? (catNames.get(r.categoryId) ?? "—") : "Sem categoria"}
                    <span className="ml-2 text-xs">
                      {r.source === "abatement" ? (
                        <Link className="text-brand-700 hover:underline" href={`/financeiro/receber${qs({ abFrom: c.from, abTo: c.to, category: r.categoryId || "none", branch: branchId, costCenter: costCenterId, state: null })}`} title="Parcelas a receber abatidas por devolução no período">
                          parcelas abatidas
                        </Link>
                      ) : (
                        <>
                          <Link className="text-brand-700 hover:underline" href={titlesLink(r.type, r.categoryId)}>títulos</Link>
                          {" · "}
                          <Link className="text-brand-700 hover:underline" href={`/financeiro/fluxo-caixa${qs({ tab: "movimentos", from: c.from, to: c.to, category: r.categoryId || "none", direct: "1", status: "realized" })}`}>diretos</Link>
                        </>
                      )}
                    </span>
                  </td>
                  {c.byMonth.map((m) => (
                    <td key={m.month} className="tabular text-right">{r.months[m.month] ? formatMoney(r.months[m.month]) : "—"}</td>
                  ))}
                  <td className="tabular text-right font-medium">{formatMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(["revenue", "expense", "result"] as const).map((k) => (
                <tr key={k} className="bg-slate-50 font-semibold">
                  <td className="border-t border-line px-3 py-2">{k === "revenue" ? "Receitas" : k === "expense" ? "Despesas" : "Resultado"}</td>
                  {c.byMonth.map((m) => (
                    <td key={m.month} className={cn("tabular border-t border-line px-3 py-2 text-right", k === "result" && m.result < 0 && "text-red-700")}>{formatMoney(m[k])}</td>
                  ))}
                  <td className="tabular border-t border-line px-3 py-2 text-right">{formatMoney(c.byMonth.reduce((a, m) => a + m[k], 0))}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
