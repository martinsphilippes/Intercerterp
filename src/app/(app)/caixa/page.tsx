import { Lock, LockOpen, Wallet } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { resolveTerminal } from "../pdv/terminal";
import { cashPeriod, querySessions, type SessionRow } from "./queries";

export const metadata = { title: "Caixa" };

/** Sessões de caixa: abertas e fechadas, previsto × informado, divergências preservadas e versões de conferência. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("cash");
  const params = await searchParams;
  const p = parseList(params, { sort: "openedAt", dir: "desc" });
  const { from, to } = cashPeriod(p.f);
  const all = await querySessions(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const [terminals, users, branches] = await Promise.all([lookups.terminals(s.ctx, s.ctx.branchId), lookups.users(s.ctx), lookups.branches(s.ctx)]);
  const current = s.branch ? await resolveTerminal(s, null) : null;
  const open = all.filter((r) => ["open", "reopened"].includes(r.status));
  const withDiff = all.filter((r) => r.hasDiff);
  const base = "/caixa";
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  const columns: Column<SessionRow>[] = [
    { key: "number", label: "Sessão", sortable: true, fixed: true, cell: (r) => <span>Caixa nº {r.number}{r.version > 1 && <span className="ml-1 text-xs text-slate-500">v{r.version}</span>}<span className="block text-xs font-normal text-slate-500">{r.terminalName}</span></span> },
    { key: "branchName", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branchName },
    { key: "operatorName", label: "Operador", sortable: true, cell: (r) => r.operatorName },
    { key: "openedAt", label: "Abertura", sortable: true, cell: (r) => formatDateTime(r.openedAt) },
    { key: "closedAt", label: "Fechamento", sortable: true, cell: (r) => (r.closedAt ? formatDateTime(r.closedAt) : "—") },
    { key: "status", label: "Situação", cell: (r) => <StatusBadge kind="cash" status={r.status} /> },
    { key: "openingFund", label: "Fundo", align: "right", hidden: true, cell: (r) => formatMoney(r.openingFund) },
    { key: "salesCount", label: "Vendas", align: "right", sortable: true, cell: (r) => r.salesCount },
    { key: "salesTotal", label: "Total vendido", align: "right", sortable: true, cell: (r) => (r.salesTotal == null ? <span className="text-slate-400" title="Conferência cega: revelado após a contagem">oculto</span> : formatMoney(r.salesTotal)) },
    { key: "expectedCash", label: "Dinheiro esperado", align: "right", cell: (r) => (r.expectedCash == null && r.status !== "closed" ? <span className="text-slate-400">oculto</span> : formatMoney(r.expectedCash)) },
    { key: "countedCash", label: "Dinheiro contado", align: "right", cell: (r) => (r.countedCash == null ? "—" : formatMoney(r.countedCash)) },
    { key: "totalDiff", label: "Diferença", align: "right", sortable: true, cell: (r) => (r.status !== "closed" ? "—" : r.hasDiff ? <Badge tone="bad">{formatMoney(r.totalDiff)}</Badge> : <Badge tone="good">Sem diferença</Badge>) },
  ];
  const sum = (k: keyof SessionRow) => all.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  // conferência cega: sessões com total vendido oculto ficam fora da soma — e isso é dito explicitamente
  const hiddenSales = all.filter((r) => r.salesTotal == null).length;
  const salesSum = `${formatMoney(sum("salesTotal"))}${hiddenSales ? ` (sem ${hiddenSales} oculta(s))` : ""}`;
  return (
    <>
      <PageHeader
        title="Caixa"
        crumbs={[{ label: "Vendas e caixa" }, { label: "Caixa" }]}
        description={`Sessões de ${formatDate(from)} a ${formatDate(to)} (abertas aparecem sempre). Fundo de troco não é receita; sangria não reduz faturamento.`}
        actions={
          current?.terminal && (
            <>
              {current.session ? (
                <>
                  <LinkButton href={`/caixa/movimentos?sessao=${current.session.id}`}><Wallet className="size-4" /> Suprimento / sangria</LinkButton>
                  {can(s.user, "cash", "edit") && <LinkButton href={`/caixa/fechamento?sessao=${current.session.id}`} variant="primary"><Lock className="size-4" /> Fechar {current.terminal.code}</LinkButton>}
                </>
              ) : (
                can(s.user, "cash", "create") && <LinkButton href={`/caixa/abertura?terminal=${current.terminal.id}`} variant="accent"><LockOpen className="size-4" /> Abrir caixa ({current.terminal.code})</LinkButton>
              )}
            </>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Caixas abertos" value={open.length} hint={open.map((r) => r.terminalName).join(", ") || "Nenhum"} href={link({ situacao: "open" })} />
        <Stat label="Sessões no recorte" value={all.length} hint={hiddenSales ? `${formatMoney(sum("salesTotal"))} vendidos (sem ${hiddenSales} sessão(ões) em conferência cega, com total oculto até a contagem)` : `${formatMoney(sum("salesTotal"))} vendidos`} />
        <Stat label="Fechamentos com divergência" value={withDiff.length} tone={withDiff.length ? "bad" : "good"} href={link({ divergencia: "1" })} hint="Diferenças preservadas com justificativa" />
        <Stat label="Diferença acumulada" value={formatMoney(withDiff.reduce((a, r) => a + r.totalDiff, 0))} tone={withDiff.length ? "warn" : "default"} hint="Informado − esperado (todas as formas)" />
      </div>
      <FilterBar
        basePath={base}
        values={params}
        filters={[
          { type: "date", name: "de", label: "De" },
          { type: "date", name: "ate", label: "Até" },
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "open", label: "Aberto / reaberto" }, { value: "closed", label: "Fechado" }] },
          { type: "select", name: "terminal", label: "Terminal", options: terminals },
          { type: "select", name: "operador", label: "Operador", options: users },
          { type: "select", name: "divergencia", label: "Divergência", options: [{ value: "1", label: "Somente com divergência" }] },
          ...(s.ctx.branchId ? [] : [{ type: "select" as const, name: "filial", label: "Filial", options: branches }]),
        ]}
      />
      <DataTable
        id="cash-sessions"
        basePath={base}
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="cash_sessions"
        rowHref={(r) => `/caixa/${r.id}`}
        totals={{ salesCount: sum("salesCount"), salesTotal: <span title={hiddenSales ? "Sessões em conferência cega ainda não contadas não entram na soma" : undefined}>{salesSum}</span> }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma sessão de caixa no recorte.</div>}
      />
    </>
  );
}
