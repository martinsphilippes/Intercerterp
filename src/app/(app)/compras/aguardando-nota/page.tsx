import Link from "@/components/ui/link";
import { FileClock, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { AutoPrint } from "../../vendas/sale-widgets";
import { PrintStyles } from "../../vendas/print-styles";
import { PENDING_STATE_OPTIONS, queryPendingInvoices, type PendingInvoiceRow } from "./queries";

export const metadata = { title: "Compras aguardando nota" };

/**
 * Painel "Compras aguardando nota" (§40): entradas de mercadoria lançadas com nota a confirmar — fornecedor, valor,
 * data, dias em aberto, prazo e vencidas — e entradas previstas (a chegar). Exportação CSV/XLSX e relatório para o
 * contador (impressão) pela mesma consulta.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  await requireFeaturePage(s, "notaAConfirmar");
  const params = await searchParams;
  const print = params.print === "1";
  const p = parseList(params, { sort: "entryAt", dir: "asc" });
  const all = await queryPendingInvoices(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const base = await queryPendingInvoices(s.ctx, { q: "", f: { situacao: "open" } });
  const suppliers = await lookups.suppliers(s.ctx);
  const realized = base.filter((r) => r.state !== "scheduled");
  const overdue = base.filter((r) => r.state === "overdue");
  const dueSoon = base.filter((r) => r.state === "due_soon");
  const scheduled = base.filter((r) => r.state === "scheduled");
  const sum = (list: PendingInvoiceRow[]) => list.reduce((a, r) => a + r.value, 0);
  const link = (extra: Record<string, string | null>) => `/compras/aguardando-nota${qs({ ...extra, page: null, print: null }, params)}`;
  const situacao = p.f.situacao || "open";
  const stateLabel = PENDING_STATE_OPTIONS.find((o) => o.value === situacao)?.label ?? "";
  const canLaunch = canDo(s.user, "purchase.receive_pending_invoice") && Boolean(s.ctx.branchId);

  if (print) {
    return (
      <>
        <PrintStyles paper="A4" />
        <div className="no-print mb-4 flex gap-2">
          <AutoPrint enabled />
          <Link href={link({})} className={buttonClass("secondary")}>Voltar ao painel</Link>
        </div>
        <article className="print-doc space-y-3 bg-white p-4 text-black" aria-label="Relatório de compras aguardando nota">
          <header>
            <h1 className="text-lg font-bold">Compras aguardando nota — relatório para o contador</h1>
            <p className="text-xs">
              {s.branch?.name ?? "Todas as filiais"} · {stateLabel} · emitido em {formatDateTime(new Date().toISOString())} por {s.user.name}
            </p>
            <p className="mt-1 text-xs">
              Mercadorias que entraram no estoque antes da nota fiscal do fornecedor (valores PROVISÓRIOS pelo custo previsto). Ficam fora do livro de entradas até a confirmação da nota; depois entram pela data da entrada como recebimento comum.
            </p>
          </header>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1">Receb.</th><th>Fornecedor</th><th>CNPJ</th><th>Entrada</th><th>Prazo da nota</th><th className="text-right">Dias</th><th className="text-right">Valor</th><th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.id} className="border-b border-slate-300">
                  <td className="py-1">nº {r.number}</td>
                  <td>{r.supplierName}</td>
                  <td>{r.supplierDoc ? formatDoc(r.supplierDoc) : "—"}</td>
                  <td>{formatDateTime(r.entryAt)}</td>
                  <td>{formatDate(r.invoiceDueAt)}</td>
                  <td className="text-right">{r.daysOpen ?? "—"}</td>
                  <td className="text-right">{formatMoney(r.value)}</td>
                  <td>{r.stateLabel}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-1" colSpan={6}>{all.length} entrada(s)</td>
                <td className="text-right">{formatMoney(sum(all))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </article>
      </>
    );
  }

  const columns: Column<PendingInvoiceRow>[] = [
    { key: "number", label: "Recebimento", sortable: true, fixed: true, cell: (r) => <span>nº {r.number}<span className="block text-xs font-normal text-slate-500">{r.warehouseName}{s.ctx.branchId ? "" : ` · ${r.branchName}`}</span></span> },
    { key: "supplierName", label: "Fornecedor", sortable: true, cell: (r) => <Link className="hover:underline" href={`/fornecedores/${r.supplierId}`}>{r.supplierName}</Link> },
    { key: "entryAt", label: "Entrada", sortable: true, cell: (r) => formatDateTime(r.entryAt) },
    { key: "itemsCount", label: "Itens", align: "right", sortable: true, cell: (r) => <span>{r.itemsCount}<span className="block text-xs text-slate-500">{formatQty(r.units)} un.</span></span> },
    { key: "value", label: "Valor", align: "right", sortable: true, cell: (r) => <span>{formatMoney(r.value)}{r.state === "confirmed" && r.previousValue != null && r.previousValue !== r.value ? <span className="block text-xs text-slate-500">previsto {formatMoney(r.previousValue)}</span> : r.state !== "confirmed" ? <span className="block text-xs text-slate-500">provisório</span> : null}</span> },
    { key: "invoiceDueAt", label: "Prazo da nota", sortable: true, cell: (r) => formatDate(r.invoiceDueAt) },
    { key: "daysOpen", label: "Dias em aberto", align: "right", sortable: true, cell: (r) => (r.state === "scheduled" || r.state === "confirmed" ? "—" : r.daysOpen) },
    { key: "nfeNumber", label: "Nota", cell: (r) => r.nfeNumber ?? <span className="text-slate-400">—</span> },
    { key: "stateLabel", label: "Situação", cell: (r) => <Badge tone={r.stateTone}>{r.stateLabel}</Badge> },
  ];
  return (
    <>
      <PageHeader
        title="Compras aguardando nota"
        crumbs={[{ label: "Compras" }, { label: "Aguardando nota" }]}
        description="Mercadorias que chegaram antes da nota fiscal do fornecedor: estoque lançado pelo custo previsto e conta a pagar provisória até a confirmação da nota. As vendas continuam sempre com NFC-e/NF-e."
        actions={
          <>
            <LinkButton href={link({ print: "1" })}><Printer className="size-4" /> Relatório para o contador</LinkButton>
            {canLaunch && <LinkButton href="/compras/recebimentos/novo?modo=nota-a-confirmar" variant="accent"><FileClock className="size-4" /> Lançar entrada com nota a confirmar</LinkButton>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aguardando nota" value={realized.length} hint={`${formatMoney(sum(realized))} provisório`} href={link({ situacao: "open" })} tone={realized.length ? "warn" : "default"} />
        <Stat label="Prazo vencido" value={overdue.length} hint={formatMoney(sum(overdue))} href={link({ situacao: "overdue" })} tone={overdue.length ? "bad" : "default"} />
        <Stat label="Vencendo" value={dueSoon.length} hint="Dentro da antecedência do aviso" href={link({ situacao: "due_soon" })} tone={dueSoon.length ? "warn" : "default"} />
        <Stat label="Entradas previstas (a chegar)" value={scheduled.length} hint={`${formatMoney(sum(scheduled))} previsto`} href={link({ situacao: "scheduled" })} />
      </div>
      {overdue.length > 0 && <Notice tone="bad">{overdue.length} entrada(s) com o prazo da nota vencido. Cobre a nota do fornecedor e confirme a entrada no recebimento (“Confirmar com a nota”).</Notice>}
      <FilterBar
        basePath="/compras/aguardando-nota"
        values={params}
        filters={[
          { type: "search", placeholder: "Recebimento, fornecedor, CNPJ ou chave" },
          { type: "select", name: "situacao", label: "Situação", options: PENDING_STATE_OPTIONS.filter((o) => o.value !== "open"), all: "Aguardando nota (todas)" },
          { type: "select", name: "supplier", label: "Fornecedor", options: suppliers },
          { type: "date", name: "from", label: "Entrada de" },
          { type: "date", name: "to", label: "Até" },
        ]}
      />
      <DataTable
        id="purchase-pending-invoices"
        basePath="/compras/aguardando-nota"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="purchase-pending-invoices"
        rowHref={(r) => `/compras/recebimentos/${r.id}`}
        totals={{ value: formatMoney(sum(all)) }}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma entrada {situacao === "confirmed" ? "confirmada" : "aguardando nota"} no recorte.</div>}
      />
    </>
  );
}
