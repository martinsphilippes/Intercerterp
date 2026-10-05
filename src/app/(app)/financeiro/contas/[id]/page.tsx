import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator, Landmark, Undo2 } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { ActionButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Timeline } from "@/components/ui/timeline";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { addDays, formatDate, today } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { accountBalanceAt, ACCOUNT_KIND_LABEL } from "@/domain/finance";
import { queryAccountEntries } from "../../queries";
import { changeInitialBalanceAction, rebuildBalancesAction, reverseEntryAction } from "../../actions";
import { FormDialog } from "../../_components/form-dialog";
import { NewEntryDialog, TransferDialog } from "../../_components/account-forms";

export const metadata = { title: "Extrato da conta" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  const { id } = await params;
  const sp = await searchParams;
  const acc = await s.ctx.store.get("financial_accounts", id);
  if (!acc || acc.companyId !== s.ctx.companyId) notFound();
  const p = parseList(sp, { pageSize: 50 });
  const from = p.f.from || addDays(today(), -30);
  const to = p.f.to || today();
  const all = await queryAccountEntries(s.ctx, id, { q: p.q, f: { ...p.f, from, to } });
  const ordered = [...all].sort((a, b) => b.seq - a.seq);
  const { rows, total } = paginate(ordered, { ...p, sort: null });
  const [accounts, cats, ccs] = await Promise.all([lookups.accounts(s.ctx), lookups.finCategories(s.ctx), lookups.costCenters(s.ctx)]);
  const opening = await accountBalanceAt(s.ctx.store, id, addDays(from, -1));
  const closing = await accountBalanceAt(s.ctx.store, id, to);
  const ins = all.filter((e) => e.side === "in").reduce((a, e) => a + e.amount, 0);
  const outs = all.filter((e) => e.side === "out").reduce((a, e) => a + e.amount, 0);
  const transfers = all.filter((e) => e.side === "transfer").reduce((a, e) => a + e.amount, 0);
  const unrec = all.filter((e) => !e.reconciled && e.kind !== "initial").length;
  const writeBlock = !s.ctx.branchId ? "Selecione uma filial (consolidado é somente consulta)." : undefined;
  type Row = (typeof all)[number];
  const columns: Column<Row>[] = [
    { key: "seq", label: "Nº", cell: (r) => r.seq },
    { key: "date", label: "Data", cell: (r) => formatDate(r.date) },
    {
      key: "description",
      label: "Descrição",
      cell: (r) => (
        <span>
          {r.titleId ? (
            <Link className="text-ink hover:text-brand-700 hover:underline" href={`/financeiro/${r.titleKind === "payable" ? "pagar" : "receber"}/${r.titleId}`}>
              {r.description}
            </Link>
          ) : (
            r.description
          )}
          {r.reversedBy && <Badge className="ml-2">Estornado</Badge>}
          {r.reversalOf && <Badge className="ml-2">Estorno</Badge>}
        </span>
      ),
    },
    { key: "kindLabel", label: "Tipo", cell: (r) => r.kindLabel },
    { key: "category", label: "Categoria", hidden: true, cell: (r) => r.category },
    { key: "amount", label: "Valor", align: "right", cell: (r) => <span className={cn("whitespace-nowrap", r.amount > 0 ? "text-emerald-700" : r.amount < 0 ? "text-red-700" : "text-slate-400")}>{formatMoney(r.amount)}</span> },
    { key: "balanceAfter", label: "Saldo após", align: "right", cell: (r) => formatMoney(r.balanceAfter) },
    { key: "reconciled", label: "Conciliação", cell: (r) => (r.kind === "initial" ? "—" : r.reconciled ? <Link href={`/financeiro/conciliacao?account=${id}&tab=historico`}><Badge tone="good">Conciliado</Badge></Link> : <Badge>Pendente</Badge>) },
    {
      key: "actions",
      label: "",
      cell: (r) =>
        ["fee", "adjustment"].includes(r.kind) && !r.settlementId && !r.reversedBy && !r.reconciled && canDo(s.user, "finance.reverse") ? (
          <ActionButton action={reverseEntryAction.bind(null, r.id)} label="Estornar" size="sm" variant="ghost" icon={<Undo2 className="size-4" />} askReason="Motivo do estorno do lançamento:" disabled={Boolean(writeBlock)} title={writeBlock} />
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title={acc.name}
        crumbs={[{ label: "Financeiro" }, { label: "Cadastros", href: "/financeiro/cadastros?tab=contas" }, { label: acc.name }]}
        badges={
          <>
            <Badge tone="brand">{ACCOUNT_KIND_LABEL[acc.kind] ?? acc.kind}</Badge>
            {acc.active === false && <Badge>Inativa</Badge>}
          </>
        }
        description={`Extrato interno (lançamentos com sequência única por conta). Saldo inicial ${formatMoney(acc.initialBalance ?? 0)} em ${formatDate(acc.initialBalanceDate)}.`}
        actions={
          can(s.user, "finance", "create") && (
            <>
              {acc.kind !== "cash" && (
                <LinkButton href={`/financeiro/conciliacao?account=${id}`}>
                  <Landmark className="size-4" /> Conciliação
                </LinkButton>
              )}
              <TransferDialog accounts={accounts} defaultFrom={id} disabled={Boolean(writeBlock)} disabledReason={writeBlock} />
              {can(s.user, "finance", "edit") && (
                <FormDialog label="Ajustar saldo inicial" title="Alterar saldo inicial" action={changeInitialBalanceAction.bind(null, id)} description="Registra um marcador no extrato (valor zero), recompõe o saldo atual e recalcula o “saldo após” de todos os lançamentos. A data não pode ser posterior ao primeiro lançamento.">
                  <FormGrid cols={2}>
                    <Field label="Novo saldo inicial" required>
                      <MoneyInput name="initialBalance" defaultValue={acc.initialBalance ?? 0} />
                    </Field>
                    <Field label="Data de referência" required>
                      <Input type="date" name="initialBalanceDate" defaultValue={acc.initialBalanceDate ?? today()} required />
                    </Field>
                    <Field label="Motivo" required className="sm:col-span-2">
                      <Input name="reason" required maxLength={300} />
                    </Field>
                  </FormGrid>
                </FormDialog>
              )}
              {can(s.user, "finance", "edit") && <ActionButton action={rebuildBalancesAction.bind(null, id)} label="Recalcular saldos" icon={<Calculator className="size-4" />} confirm="Conferir o saldo da conta e recalcular o “saldo após” dos lançamentos?" />}
              <NewEntryDialog accounts={accounts} categories={cats} costCenters={ccs} defaultAccountId={id} disabled={Boolean(writeBlock)} disabledReason={writeBlock} label="Lançamento avulso" />
            </>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Saldo atual" value={formatMoney(acc.balance ?? 0)} hint={`${acc.seq ?? 0} lançamento(s) na conta`} />
        <Stat label={`Saldo em ${formatDate(addDays(from, -1))}`} value={formatMoney(opening)} hint="Antes do período" />
        <Stat label="Entradas no período" value={formatMoney(ins)} tone="good" hint={transfers ? `Transferências líquidas ${formatMoney(transfers)}` : undefined} />
        <Stat label="Saídas no período" value={formatMoney(outs === 0 ? 0 : -outs)} tone="bad" />
        <Stat label={`Saldo em ${formatDate(to)}`} value={formatMoney(closing)} hint={`${unrec} lançamento(s) não conciliado(s)`} href={`/financeiro/contas/${id}?from=${from}&to=${to}&reconciled=no`} />
      </div>
      <FilterBar
        basePath={`/financeiro/contas/${id}`}
        values={sp}
        filters={[
          { type: "search", placeholder: "Descrição" },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
          { type: "select", name: "reconciled", label: "Conciliação", options: [{ value: "no", label: "Não conciliados" }, { value: "yes", label: "Conciliados" }] },
        ]}
      />
      <DataTable id="fin-account-entries" basePath={`/financeiro/contas/${id}`} params={{ ...sp, account: id }} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey={`fin-account-entries`} />
      <Card title="Histórico da conta" className="mt-4">
        <Timeline store={s.ctx.store} refs={[`financial_account:${id}`]} limit={30} />
      </Card>
    </>
  );
}
