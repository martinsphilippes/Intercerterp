import Link from "next/link";
import { BadgeCheck, Eye, Plus, Receipt } from "lucide-react";
import type { SessionInfo } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, type FilterDef } from "@/components/ui/filters";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, Stat } from "@/components/ui/card";
import { ActionButton } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { listAll } from "@/lib/db";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { addDays, diffDays, formatDate } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups, nameMap } from "@/lib/server/lookups";
import { formatDoc } from "@/lib/core/text";
import { lateChargeParams, METHOD_KINDS, suggestLateCharges, type TitleKind } from "@/domain/finance";
import { installmentKpis, queryInstallments, ORIGIN_LABEL, branchScope, originHref } from "../queries";
import { approvePayableAction } from "../actions";
import { SettleDialog } from "./settle-dialog";
import { PrintButton } from "./print-button";

type Row = Awaited<ReturnType<typeof queryInstallments>>[number];

const STATES = [
  { value: "open", label: "Em aberto (todas)" },
  { value: "overdue", label: "Vencidas (em atraso)" },
  { value: "due_today", label: "Vencem hoje" },
  { value: "upcoming", label: "A vencer" },
  { value: "partial", label: "Parcialmente baixadas" },
  { value: "paid", label: "Liquidadas" },
  { value: "cancelled", label: "Canceladas" },
];

/** Situação relativa do vencimento (Tela 22/23): vence hoje, N dias em atraso, em N dias, pago em dd/mm. */
function relative(r: Row, today: string) {
  if (r.status === "paid") return r.lastSettlementAt ? `${r.paid ? "Pago" : "Baixado"} em ${formatDate(r.lastSettlementAt).slice(0, 5)}` : "Liquidado";
  if (r.status === "cancelled") return "Cancelado";
  if (r.status === "renegotiated") return "Renegociado";
  const d = diffDays(today, r.dueDate);
  if (d === 0) return "Vence hoje";
  return d < 0 ? `${-d} dia(s) em atraso` : `Em ${d} dia(s)`;
}

/** Listagem de contas a receber (Tela 22) / a pagar (Tela 23): uma linha por parcela. */
export async function TitlesList({ s, kind, params }: { s: SessionInfo; kind: TitleKind; params: SearchParams }) {
  const rec = kind === "receivable";
  const basePath = rec ? "/financeiro/receber" : "/financeiro/pagar";
  const p = parseList(params, { sort: "dueDate", dir: "asc" });
  const all = await queryInstallments(s.ctx, kind, p);
  const { rows, total } = paginate(all, p);
  const branch = branchScope(s.ctx, p);
  const k = await installmentKpis(s.ctx, kind, branch);
  const t0 = k.today;
  const [parties, cats, ccs, branches, accounts, methodsRaw, late, docs, sales] = await Promise.all([
    rec ? lookups.customers(s.ctx) : lookups.suppliers(s.ctx),
    lookups.finCategories(s.ctx, rec ? "revenue" : "expense"),
    lookups.costCenters(s.ctx),
    lookups.branches(s.ctx),
    lookups.accounts(s.ctx),
    listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
    lateChargeParams(s.ctx.store, s.ctx.companyId, s.ctx.branchId),
    nameMap(s.ctx, rec ? "customers" : "suppliers", (c) => c.doc ?? ""),
    (async () => {
      const ids = [...new Set(rows.filter((r) => r.originType === "sale" || r.originType === "sale_card").map((r) => r.originId).filter(Boolean))] as string[];
      return ids.length ? new Map((await listAll(s.ctx.store, "sales", { filters: [["eq", "id", ids]] })).map((x) => [x.id, x.number as number])) : new Map<string, number>();
    })(),
  ]);
  const methods = methodsRaw
    .filter((m) => !["store_credit", "crediario"].includes(m.kind) && (rec || !["debit", "credit"].includes(m.kind)))
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
    .map((m) => ({ value: m.id, label: m.name, kind: m.kind, accountId: m.accountId ?? null }));
  const canSettle = can(s.user, "finance", "edit") && canDo(s.user, "finance.settle") && Boolean(s.ctx.branchId);
  const canApprove = canDo(s.user, "finance.approve_payable");
  const origins = Object.entries(ORIGIN_LABEL)
    .filter(([key]) => (rec ? ["manual", "sale", "sale_card", "renegotiation", "service"] : ["manual", "purchase", "receipt", "return"]).includes(key))
    .map(([value, label]) => ({ value, label }));
  const withCharges = (r: Row) => (rec && r.state === "overdue" && r.originType !== "sale_card" ? r.balance + (() => { const c = suggestLateCharges(r.dueDate, t0, r.balance, late); return c.fine + c.interest; })() : r.balance);
  const columns: Column<Row>[] = [
    {
      key: "partyName",
      label: rec ? "Cliente" : "Fornecedor / descrição",
      sortable: true,
      fixed: true,
      cell: (r) => (
        <span className="block min-w-[180px]">
          <span className="font-medium">{r.partyName}</span>
          <span className="block text-xs font-normal text-slate-500">
            {rec ? (r.partyId && docs.get(r.partyId) ? `${docs.get(r.partyId)!.length > 11 ? "CNPJ" : "CPF"} ${formatDoc(docs.get(r.partyId)!)}` : r.description) : r.description}
          </span>
        </span>
      ),
    },
    {
      key: "documentNumber",
      label: "Documento / origem",
      cell: (r) => {
        const href = originHref(r);
        const saleNo = r.originId ? sales.get(r.originId) : undefined;
        return (
          <span className="block text-xs">
            <span className="font-medium text-ink">{r.documentNumber ? `Doc. ${r.documentNumber}` : `Título nº ${r.titleNumber}`} · parcela {r.installment}/{r.installments}</span>
            <span className="block text-slate-500">
              {href ? (
                <Link className="text-brand-700 hover:underline" href={href}>
                  {saleNo ? `Venda nº ${saleNo}` : r.origin}
                </Link>
              ) : (
                r.origin
              )}
            </span>
          </span>
        );
      },
    },
    { key: "installment", label: "Parcela", hidden: true, cell: (r) => `${r.installment}/${r.installments}` },
    { key: "issueDate", label: "Emissão", sortable: true, hidden: true, cell: (r) => formatDate(r.issueDate) },
    { key: "competenceDate", label: "Competência", sortable: true, hidden: true, cell: (r) => formatDate(r.competenceDate) },
    {
      key: "dueDate",
      label: "Vencimento",
      sortable: true,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className={cn(r.state === "overdue" && "font-medium text-red-700", r.state === "due_today" && "font-medium text-accent-700")}>{formatDate(r.dueDate)}</span>
          <span className={cn("block text-xs", r.state === "overdue" ? "text-red-600" : r.state === "due_today" ? "text-accent-700" : "text-slate-500")}>{relative(r, t0)}</span>
        </span>
      ),
    },
    { key: "amount", label: "Valor", align: "right", sortable: true, cell: (r) => <span className={!rec && r.state === "overdue" ? "text-red-700" : undefined}>{formatMoney(r.amount)}</span> },
    { key: "paid", label: rec ? "Recebido" : "Pago", align: "right", sortable: true, hidden: true, cell: (r) => (r.paid ? formatMoney(r.paid) : "—") },
    {
      key: "balance",
      label: "Saldo",
      align: "right",
      sortable: true,
      cell: (r) => {
        const upd = withCharges(r);
        return (
          <span className="block">
            <span className={upd !== r.balance ? "font-semibold text-red-700" : "font-medium"}>{formatMoney(upd)}</span>
            {upd !== r.balance && <span className="block text-xs font-normal text-slate-500" title="Saldo + multa e juros sugeridos pelos parâmetros de atraso">saldo {formatMoney(r.balance)} + encargos</span>}
          </span>
        );
      },
    },
    { key: "category", label: "Categoria", sortable: true, hidden: rec, cell: (r) => r.category },
    { key: "costCenter", label: "Centro de custo", hidden: rec, cell: (r) => r.costCenter },
    { key: "branch", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branch },
    { key: "methodKind", label: "Forma", hidden: true, cell: (r) => METHOD_KINDS.find((m) => m.value === r.methodKind)?.label ?? "—" },
    {
      key: "state",
      label: "Status",
      cell: (r) =>
        !rec && r.approvalStatus !== "approved" && ["open", "partial"].includes(r.status) ? (
          <Badge tone="accent">Aprovação</Badge>
        ) : r.status === "paid" ? (
          <Badge tone="good">{rec ? "Recebido" : "Pago"}</Badge>
        ) : (
          <StatusBadge kind="title" status={r.state === "upcoming" ? (r.status === "partial" ? "partial" : "open") : r.state} />
        ),
    },
    {
      key: "actions",
      label: "Ações",
      fixed: true,
      cell: (r) => (
        <div className="no-print flex items-center justify-end gap-1">
          {["open", "partial"].includes(r.status) && r.originType === "sale_card" && (
            <Link className={buttonClass("secondary", "sm")} href={`/financeiro/cartoes?status=open&to=${r.dueDate}`} title="Recebível da adquirente: liquide com a taxa em Recebíveis de cartão">
              Liquidar
            </Link>
          )}
          {["open", "partial"].includes(r.status) && r.originType !== "sale_card" && (rec || r.approvalStatus === "approved") && (
            <SettleDialog
              kind={kind}
              installment={{ id: r.id, number: r.installment, balance: r.balance, dueDate: r.dueDate, amount: r.amount }}
              titleLabel={`nº ${r.titleNumber} (${r.partyName})`}
              accounts={accounts}
              methods={methods}
              late={late}
              today={t0}
              disabled={!canSettle}
              disabledReason={!s.ctx.branchId ? "Selecione uma filial (consolidado é somente consulta)." : "Sem permissão para baixar títulos."}
            />
          )}
          {!rec && r.approvalStatus !== "approved" && ["open", "partial"].includes(r.status) && canApprove && (
            <ActionButton action={approvePayableAction.bind(null, r.titleId)} label="Aprovar" size="sm" variant="accent" icon={<BadgeCheck className="size-4" />} confirm={`Conferir e autorizar o pagamento da obrigação nº ${r.titleNumber} (${r.partyName})?`} />
          )}
          {r.paid > 0 && (
            <Link className={buttonClass("ghost", "sm")} href={`${basePath}/${r.titleId}/recibo?parcela=${r.id}`} title={rec ? "Recibo / imprimir" : "Comprovante"}>
              <Receipt className="size-4" />
            </Link>
          )}
          <Link className={buttonClass("ghost", "sm")} href={`${basePath}/${r.titleId}`} title="Visualizar">
            <Eye className="size-4" />
          </Link>
        </div>
      ),
    },
  ];
  const sum = (key: keyof Row) => all.reduce((a, r) => a + (Number(r[key]) || 0), 0);
  const link = (extra: Record<string, string>) => `${basePath}${qs(extra)}`;
  const chips = [
    { label: "Todos", params: {} as Record<string, string> },
    { label: "Vencem hoje", params: { state: "due_today" } },
    { label: "Em atraso", params: { state: "overdue" } },
    { label: "Próximos 7 dias", params: { state: "upcoming", dueTo: addDays(t0, 7) } },
    ...(rec ? [] : [{ label: "Aprovação", params: { state: "open", approval: "pending" } }]),
    { label: rec ? "Recebidos" : "Pagos", params: { state: "paid" } },
  ];
  const activeChip = chips.findIndex((c) => Object.keys(c.params).length === ["state", "dueTo", "approval"].filter((x) => p.f[x]).length && Object.entries(c.params).every(([kk, v]) => p.f[kk] === v));
  const filters: FilterDef[] = [
    { type: "search", placeholder: rec ? "Cliente, documento, venda, descrição ou nosso número" : "Fornecedor, documento ou descrição" },
    { type: "select", name: "state", label: "Status", options: STATES, all: "Todos (exceto cancelados)" },
    ...(rec ? [{ type: "select" as const, name: "method", label: "Forma de pagamento", options: METHOD_KINDS.filter((m) => !["cash", "pix", "store_credit"].includes(m.value)), all: "Todas as formas" }] : []),
    { type: "date", name: "dueFrom", label: "Vencimento de" },
    { type: "date", name: "dueTo", label: "até" },
    { type: "select", name: "party", label: rec ? "Cliente" : "Fornecedor", options: parties },
    { type: "select", name: "category", label: "Categoria", options: cats },
    { type: "select", name: "costCenter", label: "Centro de custo", options: ccs, all: "Todos os centros" },
    { type: "select", name: "origin", label: "Origem", options: origins },
  ];
  if (!rec) filters.push({ type: "select", name: "approval", label: "Autorização", options: [{ value: "pending", label: "A autorizar" }, { value: "approved", label: "Autorizadas" }] });
  if (!s.ctx.branchId) filters.push({ type: "select", name: "branch", label: "Filial", options: branches, all: "Todas (consolidado)" });
  const periodNote = [p.f.dueFrom && `vencimento desde ${formatDate(p.f.dueFrom)}`, p.f.dueTo && `até ${formatDate(p.f.dueTo)}`, p.f.compFrom && `competência desde ${formatDate(p.f.compFrom)}`, p.f.compTo && `até ${formatDate(p.f.compTo)}`].filter(Boolean).join(" ");

  // painel lateral (contas a pagar): previsão de caixa, despesas por categoria e fila de aprovação
  let side: React.ReactNode = null;
  if (!rec) {
    const accs = await listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] });
    const available = accs.reduce((a, x) => a + (x.balance ?? 0), 0);
    const week = k.overdue.amount + k.dueToday.amount + k.next7.amount;
    const openAll = await queryInstallments(s.ctx, "payable", { q: "", f: { state: "open", ...(branch ? { branch } : {}) } });
    const byCat = new Map<string, { name: string; id: string | null; amount: number }>();
    for (const r of openAll) {
      const key = r.categoryId ?? "";
      const cur = byCat.get(key) ?? { name: r.categoryId ? r.category : "Sem categoria", id: r.categoryId, amount: 0 };
      cur.amount += r.balance;
      byCat.set(key, cur);
    }
    const catRows = [...byCat.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);
    const maxCat = Math.max(1, ...catRows.map((c) => c.amount));
    const pending = openAll.filter((r) => r.approvalStatus !== "approved");
    const pendingTitles = [...new Map(pending.map((r) => [r.titleId, r])).values()].slice(0, 6);
    side = (
      <aside className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Previsão de caixa" description="Saldo atual das contas ativas (todas as filiais)">
          <p className="tabular text-2xl font-semibold text-ink">{formatMoney(available)}</p>
          <p className="mt-1 text-sm">
            Após vencidas + 7 dias: <span className={cn("tabular font-semibold", available - week < 0 ? "text-red-700" : "text-emerald-700")}>{formatMoney(available - week)}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">Saldo − obrigações em aberto vencidas e com vencimento até {formatDate(k.next7.to)} ({formatMoney(week)}).</p>
          <Link className="mt-2 inline-block text-xs text-brand-700 hover:underline" href={`/financeiro/fluxo-caixa?preset=next7`}>
            Ver fluxo de caixa
          </Link>
        </Card>
        <Card title="Despesas por categoria" description="Saldo em aberto a pagar (todas as datas)">
          {catRows.length === 0 ? (
            <p className="text-sm text-slate-500">Nada em aberto.</p>
          ) : (
            <ul className="space-y-2.5">
              {catRows.map((c) => (
                <li key={c.id ?? "none"}>
                  <Link href={link({ state: "open", ...(c.id ? { category: c.id } : {}) })} className="group block">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="truncate text-slate-700 group-hover:text-brand-700">{c.name}</span>
                      <span className="tabular font-medium text-ink">{formatMoney(c.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(2, Math.round((c.amount / maxCat) * 100))}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Aguardando aprovação" description={`${pending.length} parcela(s) · ${formatMoney(pending.reduce((a, r) => a + r.balance, 0))}`}>
          {pendingTitles.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma obrigação pendente de conferência.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pendingTitles.map((r) => (
                <li key={r.titleId} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`${basePath}/${r.titleId}`} className="min-w-0 text-sm hover:text-brand-700">
                    <span className="block truncate font-medium">{r.partyName}</span>
                    <span className="tabular text-xs text-slate-500">
                      {formatMoney(r.balance)} · vence {formatDate(r.dueDate)}
                    </span>
                  </Link>
                  {canApprove && <ActionButton action={approvePayableAction.bind(null, r.titleId)} label="Aprovar" size="sm" variant="accent" confirm={`Conferir e autorizar a obrigação nº ${r.titleNumber}?`} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    );
  }

  const table = (
    <div className="min-w-0">
      <nav aria-label="Situação" className="no-print mb-3 flex flex-wrap gap-2">
        {chips.map((c, i) => (
          <Link
            key={c.label}
            href={link({ ...(p.q ? { q: p.q } : {}), ...c.params })}
            className={cn("rounded-full border px-3 py-1 text-sm", i === activeChip ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300")}
          >
            {c.label}
          </Link>
        ))}
      </nav>
      <FilterBar basePath={basePath} values={params} filters={filters} />
      {periodNote && <p className="-mt-2 mb-3 text-xs text-slate-500">Recorte: {periodNote}.</p>}
      <DataTable
        id={rec ? "fin-receivables" : "fin-payables"}
        basePath={basePath}
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey={rec ? "fin-receivables" : "fin-payables"}
        rowHref={(r) => `${basePath}/${r.titleId}`}
        totals={{ amount: formatMoney(sum("amount")), paid: formatMoney(sum("paid")), balance: formatMoney(sum("balance")) }}
        empty={
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhuma parcela no recorte.{" "}
            {can(s.user, "finance", "create") && (
              <Link className="text-brand-700 underline" href={`${basePath}/novo`}>
                {rec ? "Lançar título a receber" : "Lançar conta a pagar"}
              </Link>
            )}
          </div>
        }
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title={rec ? "Contas a receber" : "Contas a pagar"}
        crumbs={[{ label: "Financeiro" }, { label: rec ? "Contas a receber" : "Contas a pagar" }]}
        description={rec ? "Parcelas, vencimentos, recebimentos parciais, encargos, renegociações do crediário e estornos." : "Despesas, fornecedores, vencimentos, aprovações e pagamentos — a autorização é separada do pagamento efetivo."}
        actions={
          <>
            <PrintButton label="Relatório" />
            {can(s.user, "finance", "create") && (
              <LinkButton href={`${basePath}/novo`} variant="accent">
                <Plus className="size-4" /> {rec ? "Novo lançamento" : "Nova conta"}
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={rec ? "Total a receber" : "Total a pagar"} value={formatMoney(k.open.amount)} hint={`${k.open.count} parcela(s) em aberto${branch ? " · filial" : " · todas as filiais"}`} href={link({ state: "open" })} />
        <Stat label={rec ? "Recebido neste mês" : "Pago neste mês"} value={formatMoney(k.monthSettled)} tone="good" hint={`Baixas ativas desde 01/${t0.slice(5, 7)} (com encargos)`} href={`/financeiro/fluxo-caixa?tab=movimentos&type=${rec ? "in" : "out"}&from=${t0.slice(0, 7)}-01&to=${t0}`} />
        <Stat label="Em atraso" value={formatMoney(k.overdue.amount)} tone={k.overdue.amount ? "bad" : "default"} hint={`${k.overdue.count} parcela(s) vencida(s) antes de ${formatDate(t0)}`} href={link({ state: "overdue" })} />
        <Stat label="Próximos 7 dias" value={formatMoney(k.next7.amount + k.dueToday.amount)} hint={`${k.next7.count + k.dueToday.count} parcela(s) de ${formatDate(t0)} a ${formatDate(k.next7.to)}${rec ? "" : ` · ${k.pendingApproval.count} a autorizar`}`} href={link({ state: "open", dueFrom: t0, dueTo: k.next7.to })} />
      </div>
      {side}
      {table}
    </>
  );
}
