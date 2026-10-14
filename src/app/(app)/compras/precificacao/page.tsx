import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { queryReceipts } from "../recebimentos/queries";

export const metadata = { title: "Precificação após a entrada" };

type Row = Awaited<ReturnType<typeof queryReceipts>>[number];

/** Recebimentos concluídos com a situação da precificação (pendente/precificado) — atalho para a tela de cada um. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  await requireFeaturePage(s, "precificacaoEntrada");
  if (!canDo(s.user, "purchase.pricing") || !can(s.user, "products", "view")) redirect("/sem-permissao");
  const params = await searchParams;
  const p = parseList(params, { sort: "number", dir: "desc" });
  // sem filtro informado: pendentes; "Todos" envia vazio
  const situation = params.situacao === undefined ? "pending" : (typeof params.situacao === "string" && params.situacao) || "all";
  const confirmed = await queryReceipts(s.ctx, { q: p.q, f: { ...p.f, status: "confirmed" } });
  const pendingCount = confirmed.filter((r) => r.pricingStatus !== "done").length;
  const all = confirmed.filter((r) => (situation === "done" ? r.pricingStatus === "done" : situation === "all" ? true : r.pricingStatus !== "done"));
  const { rows, total } = paginate(all, p);
  const suppliers = await lookups.suppliers(s.ctx);
  const columns: Column<Row>[] = [
    { key: "number", label: "Recebimento", fixed: true, cell: (r) => <span className="font-medium">nº {r.number}<span className="block text-xs font-normal text-slate-500">{r.nfeNumber ? `NF-e ${r.nfeNumber}` : "Sem NF-e"}</span></span> },
    { key: "supplierName", label: "Fornecedor", cell: (r) => r.supplierName },
    { key: "date", label: "Entrada concluída", cell: (r) => formatDateTime(r.confirmedAt) },
    { key: "itemsCount", label: "Itens", align: "right", cell: (r) => r.itemsCount },
    { key: "dueTotal", label: "Valor", align: "right", cell: (r) => formatMoney(r.dueTotal) },
    { key: "pricingStatus", label: "Precificação", cell: (r) => (r.pricingStatus === "done" ? <Badge tone="good">Precificado</Badge> : <Badge tone="warn">Pendente</Badge>) },
  ];
  return (
    <>
      <PageHeader
        title="Precificação após a entrada"
        crumbs={[{ label: "Compras" }, { label: "Precificação" }]}
        description="Recebimentos concluídos: revise o preço de venda dos itens cujo custo mudou. Abra um recebimento para ver custo anterior × custo novo, margens e a sugestão de preço — nada muda sem a sua confirmação."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pendentes" value={pendingCount} hint="Recebimentos concluídos sem precificação" href="/compras/precificacao?situacao=pending" tone={pendingCount ? "warn" : "default"} />
        <Stat label="Precificados" value={confirmed.length - pendingCount} hint="Com preços revisados" href="/compras/precificacao?situacao=done" />
      </div>
      <FilterBar
        basePath="/compras/precificacao"
        values={{ ...params, situacao: situation === "all" ? "" : situation }}
        filters={[
          { type: "search", placeholder: "Número, NF-e, chave ou fornecedor" },
          { type: "select", name: "situacao", label: "Situação", all: "Todos", options: [{ value: "pending", label: "Pendentes" }, { value: "done", label: "Precificados" }] },
          { type: "select", name: "supplier", label: "Fornecedor", options: suppliers },
          { type: "date", name: "from", label: "De" },
          { type: "date", name: "to", label: "Até" },
        ]}
      />
      <DataTable
        id="receipt-pricing"
        basePath="/compras/precificacao"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(r) => `/compras/recebimentos/${r.id}/precificacao`}
        empty={<div className="p-10 text-center text-sm text-slate-500">{situation === "pending" ? "Nenhum recebimento concluído aguardando precificação." : "Nenhum recebimento no recorte."}</div>}
      />
    </>
  );
}
