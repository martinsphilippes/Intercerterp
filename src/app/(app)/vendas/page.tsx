import Link from "next/link";
import { Plus, Undo2 } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { inputClass } from "@/components/ui/form";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatBps, formatMoney } from "@/lib/money";
import { addDays, diffDays, formatDate, formatDateTime, monthStart, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { PAYMENT_KIND_LABEL } from "@/domain/pricing-calc";
import { Notice } from "@/components/ui/empty";
import { querySales, salesPeriod, salesTotals, sessionAmountsHidden, type SaleRow } from "./queries";

export const metadata = { title: "Histórico de vendas" };

const MODEL: Record<string, string> = { nfce: "NFC-e", nfe: "NF-e", nfse: "NFS-e" };

const PERIODS = (t: string) => [
  { key: "hoje", label: "Hoje", de: t, ate: t },
  { key: "ontem", label: "Ontem", de: addDays(t, -1), ate: addDays(t, -1) },
  { key: "7d", label: "Últimos 7 dias", de: addDays(t, -6), ate: t },
  { key: "30d", label: "Últimos 30 dias", de: addDays(t, -29), ate: t },
  { key: "mes", label: "Este mês", de: monthStart(t), ate: t },
  { key: "mesant", label: "Mês anterior", de: monthStart(addDays(monthStart(t), -1)), ate: addDays(monthStart(t), -1) },
];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("sales");
  const params = await searchParams;
  const p = parseList(params, { sort: "completedAt", dir: "desc" });
  const t = today();
  // período rápido → de/até (mantido na URL)
  const preset = PERIODS(t).find((x) => x.key === p.f.periodo);
  if (preset && !p.f.de && !p.f.ate) Object.assign(p.f, { de: preset.de, ate: preset.ate });
  const { from, to } = salesPeriod(p.f);
  const all = await querySales(s.ctx, p);
  // conferência cega: vendas de sessão de caixa aberta ainda não contada — valores ocultos (como nas telas do caixa)
  const amountsHidden = await sessionAmountsHidden(s.ctx, p.f.sessao);
  const hid = (v: string) => (amountsHidden ? "oculto" : v);
  const { rows, total } = paginate(all, p);
  const tot = salesTotals(all);
  // comparação com o período anterior de mesma duração (mesmos filtros)
  const len = diffDays(from, to) + 1;
  const prevRows = await querySales(s.ctx, { q: p.q, f: { ...p.f, de: addDays(from, -len), ate: addDays(from, -1) } });
  const prev = salesTotals(prevRows);
  const trend = !amountsHidden && prev.net > 0 ? Math.round(((tot.net - prev.net) * 10000) / prev.net) : null;
  const pendingDocs = all.filter((r) => r.status === "completed" && ["pending", "queued", "processing", "error", "rejected", "contingency"].includes(r.fiscalStatus));
  const [users, branches, terminals] = await Promise.all([lookups.users(s.ctx), lookups.branches(s.ctx), lookups.terminals(s.ctx, s.ctx.branchId)]);
  const base = "/vendas";
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  const columns: Column<SaleRow>[] = [
    { key: "number", label: "Venda", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}<span className="block text-xs font-normal text-slate-500">{r.origin === "exchange" ? "Troca · " : ""}{r.terminalName}</span></span> },
    { key: "completedAt", label: "Data e hora", sortable: true, cell: (r) => <span className="tabular">{formatDate(r.completedAt)}<span className="block text-xs text-slate-500">{formatDateTime(r.completedAt).split(" ")[1]}</span></span> },
    { key: "branchName", label: "Filial", hidden: Boolean(s.ctx.branchId), cell: (r) => r.branchName },
    { key: "customerName", label: "Cliente", sortable: true, cell: (r) => <span>{r.customerId ? <Link className="hover:underline" href={`/clientes/${r.customerId}`}>{r.customerName}</Link> : r.customerName}<span className="block text-xs text-slate-500">{r.customerDoc ? formatDoc(r.customerDoc) : "Não identificado"}</span></span> },
    { key: "fiscal", label: "Documento", cell: (r) => <span className="whitespace-nowrap">{r.fiscalNumber ? `${MODEL[r.fiscalModel ?? "nfce"] ?? r.fiscalModel} ${String(r.fiscalNumber).padStart(9, "0")}` : r.fiscalStatus === "not_required" ? "Sem documento" : `${MODEL[r.fiscalModel ?? "nfce"]} ${r.fiscalStatus === "authorized" ? "" : "sem número"}`}<span className="flex flex-wrap gap-1">{r.fiscalSeries && r.fiscalStatus === "authorized" ? <span className="text-xs text-slate-500">Série {r.fiscalSeries}</span> : null}<StatusBadge kind="fiscal" status={r.fiscalStatus} />{r.fiscalSimulated && <SimBadge />}</span></span> },
    { key: "paymentMethods", label: "Pagamento", cell: (r) => <span className="text-slate-700">{r.paymentMethods || "—"}<span className="block"><StatusBadge kind="payment" status={r.paymentStatus} /></span></span> },
    { key: "operatorName", label: "Operador", hidden: true, cell: (r) => r.operatorName },
    { key: "sellerName", label: "Vendedor", hidden: true, cell: (r) => r.sellerName ?? "—" },
    { key: "status", label: "Situação", cell: (r) => <span className="flex flex-col items-start gap-1"><StatusBadge kind="sale" status={r.status} />{(r.returnedTotal ?? 0) > 0 && <Badge tone={(r.returnedTotal ?? 0) >= (r.total ?? 0) ? "bad" : "warn"}>{(r.returnedTotal ?? 0) >= (r.total ?? 0) ? "Devolvida" : "Devolução parcial"}</Badge>}</span> },
    { key: "itemsCount", label: "Itens", align: "right", hidden: true, cell: (r) => r.itemsCount },
    { key: "subtotal", label: "Bruto", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.subtotal) },
    { key: "discountTotal", label: "Descontos", align: "right", sortable: true, cell: (r) => (r.discountTotal ? formatMoney(r.discountTotal) : "—") },
    { key: "total", label: "Valor", align: "right", sortable: true, cell: (r) => (r.amountsHidden ? <span className="text-slate-400" title="Conferência cega: revelado após a contagem">oculto</span> : <span className={r.status === "cancelled" ? "text-slate-400 line-through" : "font-semibold"}>{formatMoney(r.total)}</span>) },
    { key: "returnedTotal", label: "Devolvido", align: "right", sortable: true, cell: (r) => (r.returnedTotal ? <Link className="text-amber-700 hover:underline" href={`/vendas/devolucoes?venda=${r.id}`}>{formatMoney(r.returnedTotal)}</Link> : "—") },
    { key: "net", label: "Líquido", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.net) },
  ];
  return (
    <>
      <PageHeader
        title="Histórico de vendas"
        crumbs={[{ label: "Vendas e caixa" }, { label: "Histórico de vendas" }]}
        description={`Vendas de ${formatDate(from)} a ${formatDate(to)}${s.ctx.branchId ? ` · ${s.branch?.name}` : " · todas as filiais (consolidado)"}. Situação comercial, de pagamento e fiscal são independentes.`}
        actions={
          <>
            <LinkButton href="/vendas/devolucoes"><Undo2 className="size-4" /> Trocas e devoluções</LinkButton>
            {can(s.user, "pdv", "create") && s.ctx.branchId && <LinkButton href="/pdv" variant="accent"><Plus className="size-4" /> Nova venda</LinkButton>}
          </>
        }
      />
      {amountsHidden && (
        <div className="mb-4">
          <Notice tone="info" title="Conferência cega em andamento">Os valores das vendas desta sessão de caixa ficam ocultos (tela e exportação) até a contagem ser registrada no fechamento. Supervisores de caixa veem os valores.</Notice>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Vendas no período" value={tot.count.toLocaleString("pt-BR")} hint={amountsHidden ? "Conferência cega: valores ocultos até a contagem" : trend == null ? "Sem base no período anterior" : `${trend >= 0 ? "↑" : "↓"} ${formatBps(Math.abs(trend), 1)} no líquido vs. ${len} dia(s) anteriores`} href={link({ situacao: "completed" })} tone={trend != null && trend < 0 ? "warn" : "default"} />
        <Stat label="Faturamento líquido" value={hid(formatMoney(tot.net))} hint={amountsHidden ? "Conferência cega: valores da sessão revelados após a contagem" : `Bruto ${formatMoney(tot.subtotal)} − desc. ${formatMoney(tot.discount)} + acrésc. ${formatMoney(tot.surcharge)} − devol. ${formatMoney(tot.returned)} · ticket médio ${formatMoney(tot.count ? Math.round(tot.total / tot.count) : 0)}`} href={link({ situacao: "completed" })} />
        <Stat label="Devolvido" value={hid(formatMoney(tot.returned))} hint={`${tot.withReturns} venda(s) com devolução`} href={link({ devolucao: "1" })} tone={tot.returned ? "warn" : "default"} />
        <Stat label="Vendas canceladas" value={tot.cancelledCount} hint={`${hid(formatMoney(tot.cancelledTotal))} · ${all.length ? formatBps(Math.round((tot.cancelledCount * 10000) / all.length), 1) : "0%"} das vendas do recorte`} href={link({ situacao: "cancelled" })} />
        <Stat label="Documentos pendentes" value={pendingDocs.length} hint={pendingDocs.length ? "Requer atenção: sem autorização fiscal" : "Nenhuma pendência"} tone={pendingDocs.length ? "warn" : "good"} href={link({ fiscal: "pending_any" })} />
      </div>
      <FilterBar
        basePath={base}
        values={params}
        filters={[
          { type: "search", placeholder: "Nº da venda, cliente, CPF/CNPJ ou nº do documento fiscal" },
          { type: "select", name: "periodo", label: "Período", all: "Personalizado (de/até)", options: PERIODS(t).map((x) => ({ value: x.key, label: x.label })) },
          { type: "date", name: "de", label: "De" },
          { type: "date", name: "ate", label: "Até" },
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "completed", label: "Concluída" }, { value: "cancelled", label: "Cancelada" }] },
          { type: "select", name: "vendedor", label: "Vendedor", options: users },
        ]}
      >
        <details className="w-full">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Mais filtros</summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {[
              { name: "operador", label: "Operador", options: users },
              ...(s.ctx.branchId ? [] : [{ name: "filial", label: "Filial", options: branches }]),
              { name: "terminal", label: "Terminal", options: terminals },
              { name: "meio", label: "Meio de pagamento", options: Object.entries(PAYMENT_KIND_LABEL).map(([value, label]) => ({ value, label })) },
              { name: "pagamento", label: "Situação do pagamento", options: [{ value: "paid", label: "Pago" }, { value: "pending", label: "A receber" }, { value: "refunded", label: "Estornado" }] },
              { name: "fiscal", label: "Situação fiscal", options: [{ value: "pending_any", label: "Pendentes (qualquer)" }, { value: "authorized", label: "Autorizado" }, { value: "queued", label: "Na fila" }, { value: "processing", label: "Processando" }, { value: "pending", label: "Pendente" }, { value: "rejected", label: "Rejeitado" }, { value: "error", label: "Erro de comunicação" }, { value: "cancelled", label: "Cancelado" }, { value: "not_required", label: "Sem documento" }] },
              { name: "origem", label: "Origem", options: [{ value: "pdv", label: "PDV" }, { value: "exchange", label: "Troca" }] },
              { name: "devolucao", label: "Devoluções", options: [{ value: "1", label: "Com devolução" }] },
            ].map((f) => (
              <label key={f.name} className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-slate-600">
                {f.label}
                <select name={f.name} defaultValue={String(params[f.name] ?? "")} className={`${inputClass} h-9`}>
                  <option value="">Todos</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </details>
      </FilterBar>
      <DataTable
        id="sales"
        basePath={base}
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="sales"
        rowHref={(r) => `/vendas/${r.id}`}
        totals={amountsHidden ? { total: "oculto" } : { discountTotal: formatMoney(tot.discount), total: formatMoney(tot.total), returnedTotal: formatMoney(tot.returned), net: formatMoney(tot.net), subtotal: formatMoney(tot.subtotal) }}
        footer={<p className="border-t border-line px-3 py-2 text-xs text-slate-500">Totais do recorte consideram apenas vendas concluídas ({tot.count}); canceladas ({tot.cancelledCount}) aparecem na lista para rastreabilidade.</p>}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma venda no recorte. Ajuste o período ou os filtros.</div>}
      />
    </>
  );
}
