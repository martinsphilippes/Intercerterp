import Link from "next/link";
import { Layers } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, type FilterDef } from "@/components/ui/filters";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { listAll } from "@/lib/db";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryCardReceivables } from "../queries";
import { settleCardsBatchAction } from "../actions";
import { FormDialog } from "../_components/form-dialog";
import { CardSettleDialog } from "./card-settle";

export const metadata = { title: "Recebíveis de cartão" };

const STATUS: Record<string, [string, "good" | "warn" | "bad" | "info" | "accent"]> = {
  settled: ["Liquidado", "good"],
  late: ["Atrasado", "bad"],
  today: ["Previsto hoje", "accent"],
  scheduled: ["Agendado", "info"],
};

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  const params = await searchParams;
  const p = parseList(params, { sort: "expectedDate", dir: "asc" });
  if (!p.f.status && !params.status) p.f.status = "open";
  const all = await queryCardReceivables(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const t0 = today();
  const [accounts, methods, branches] = await Promise.all([
    lookups.accounts(s.ctx),
    listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "kind", ["debit", "credit"]]] }),
    lookups.branches(s.ctx),
  ]);
  const bankDefault = (await listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "kind", "bank"], ["eq", "active", true]] }))[0]?.id ?? accounts[0]?.value ?? "";
  const methodAcc = new Map(methods.map((m) => [m.id, m.accountId as string | null]));
  const canSettle = can(s.user, "finance", "edit") && canDo(s.user, "finance.settle") && Boolean(s.ctx.branchId);
  const block = !s.ctx.branchId ? "Selecione uma filial (consolidado é somente consulta)." : "Sem permissão para baixar títulos.";
  const allOpen = await queryCardReceivables(s.ctx, { q: "", f: { status: "open", ...(p.f.branch ? { branch: p.f.branch } : {}) } });
  const monthSettled = (await queryCardReceivables(s.ctx, { q: "", f: { status: "settled", ...(p.f.branch ? { branch: p.f.branch } : {}) } })).filter((r) => (r.settledAt ?? "") >= `${t0.slice(0, 7)}-01`);
  const sum = (xs: typeof all, k: keyof (typeof all)[number]) => xs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  type Row = (typeof all)[number];
  const columns: Column<Row>[] = [
    { key: "expectedDate", label: "Previsão de liquidação", sortable: true, fixed: true, cell: (r) => <span className={r.status === "late" ? "font-medium text-red-700" : undefined}>{formatDate(r.expectedDate)}</span> },
    { key: "saleNumber", label: "Venda / título", sortable: true, cell: (r) => (<span className="whitespace-nowrap">{r.saleId ? <Link className="text-brand-700 hover:underline" href={`/vendas/${r.saleId}`}>Venda nº {r.saleNumber ?? "—"}</Link> : "—"}<Link className="block text-xs text-slate-500 hover:underline" href={`/financeiro/receber/${r.titleId}`}>ver título</Link></span>) },
    { key: "saleDate", label: "Data da venda", sortable: true, cell: (r) => formatDate(r.saleDate) },
    { key: "method", label: "Meio", cell: (r) => <span className="whitespace-nowrap">{r.method}{r.brand ? <span className="text-xs text-slate-500"> · {r.brand}</span> : null}</span> },
    { key: "nsu", label: "NSU", hidden: true, cell: (r) => r.nsu ?? "—" },
    { key: "installment", label: "Parcela", cell: (r) => r.installment },
    { key: "gross", label: "Venda bruta", align: "right", sortable: true, cell: (r) => formatMoney(r.gross) },
    { key: "expectedFee", label: "Taxa prevista", align: "right", cell: (r) => formatMoney(r.expectedFee) },
    { key: "expectedNet", label: "Líquido previsto", align: "right", sortable: true, cell: (r) => formatMoney(r.expectedNet) },
    { key: "settledNet", label: "Liquidado (líquido)", align: "right", cell: (r) => (r.settledGross ? <span title={`Bruto ${formatMoney(r.settledGross)} − taxa ${formatMoney(r.settledFee)}`}>{formatMoney(r.settledNet)}<span className="block text-xs text-slate-500">taxa {formatMoney(r.settledFee)} · {formatDate(r.settledAt)}</span></span> : "—") },
    { key: "status", label: "Situação", cell: (r) => <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge> },
    {
      key: "actions",
      label: "",
      cell: (r) =>
        r.openGross > 0 ? (
          <div className="flex justify-end">
            <CardSettleDialog row={r} accounts={accounts} defaultAccount={(r.methodId && methodAcc.get(r.methodId)) || bankDefault} today={t0} disabled={!canSettle} disabledReason={block} />
          </div>
        ) : null,
    },
  ];
  const filters: FilterDef[] = [
    { type: "select", name: "status", label: "Situação", options: [{ value: "open", label: "Em aberto" }, { value: "late", label: "Atrasados" }, { value: "settled", label: "Liquidados" }, { value: "all", label: "Todos" }], all: "Em aberto" },
    { type: "date", name: "from", label: "Previsão de" },
    { type: "date", name: "to", label: "até" },
    { type: "select", name: "kind", label: "Tipo", options: [{ value: "debit", label: "Débito" }, { value: "credit", label: "Crédito" }] },
  ];
  if (!s.ctx.branchId) filters.push({ type: "select", name: "branch", label: "Filial", options: branches, all: "Todas" });
  const late = allOpen.filter((r) => r.status === "late");
  return (
    <>
      <PageHeader
        title="Recebíveis de cartão"
        crumbs={[{ label: "Financeiro" }, { label: "Recebíveis de cartão" }]}
        description="Vendas no cartão geram recebível contra a adquirente pela previsão de liquidação; ao liquidar, informe conta, valor bruto e taxa: o líquido entra na conta e a taxa vira lançamento de despesa."
        actions={
          can(s.user, "finance", "edit") && (
            <FormDialog label="Liquidar previstos até…" icon={<Layers className="size-4" />} variant="accent" title="Liquidação em lote" action={settleCardsBatchAction} disabled={!canSettle} disabledReason={block} submitLabel="Liquidar em lote" description="Liquida todos os recebíveis em aberto com previsão até a data informada, cada um com sua taxa prevista, na conta escolhida (até 200 por vez).">
              <FormGrid cols={2}>
                <Field label="Previsão até" required>
                  <Input type="date" name="until" defaultValue={t0} max={t0} required />
                </Field>
                <Field label="Data do crédito" required>
                  <Input type="date" name="date" defaultValue={t0} max={t0} required />
                </Field>
                <Field label="Conta bancária" required>
                  <Select name="accountId" defaultValue={bankDefault} options={accounts} required />
                </Field>
                <Field label="Tipo">
                  <Select name="kind" options={[{ value: "debit", label: "Débito" }, { value: "credit", label: "Crédito" }]} placeholder="Débito e crédito" />
                </Field>
                <Field label="Referência (lote da adquirente)" className="sm:col-span-2">
                  <Input name="reference" maxLength={120} />
                </Field>
              </FormGrid>
            </FormDialog>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Venda bruta em aberto" value={formatMoney(sum(allOpen, "openGross"))} hint={`${allOpen.length} parcela(s)`} href={`/financeiro/cartoes${qs({ status: "open" })}`} />
        <Stat label="Taxa prevista" value={formatMoney(sum(allOpen, "openFee"))} hint="Taxa da venda rateada pelas parcelas" />
        <Stat label="Líquido previsto" value={formatMoney(sum(allOpen, "openGross") - sum(allOpen, "openFee"))} />
        <Stat label="Atrasados" value={formatMoney(sum(late, "openGross"))} tone={late.length ? "bad" : "default"} hint={`${late.length} parcela(s) com previsão vencida`} href={`/financeiro/cartoes${qs({ status: "late" })}`} />
        <Stat label="Liquidado no mês (líquido)" value={formatMoney(sum(monthSettled, "settledNet"))} tone="good" hint={`Taxas ${formatMoney(sum(monthSettled, "settledFee"))}`} href={`/financeiro/cartoes${qs({ status: "settled", from: `${t0.slice(0, 7)}-01` })}`} />
      </div>
      <FilterBar basePath="/financeiro/cartoes" values={params} filters={filters} />
      <DataTable
        id="fin-cards"
        basePath="/financeiro/cartoes"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="fin-cards"
        totals={{ gross: formatMoney(sum(all, "gross")), expectedFee: formatMoney(sum(all, "expectedFee")), expectedNet: formatMoney(sum(all, "expectedNet")), settledNet: formatMoney(sum(all, "settledNet")) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhum recebível de cartão no recorte.</div>}
      />
    </>
  );
}
