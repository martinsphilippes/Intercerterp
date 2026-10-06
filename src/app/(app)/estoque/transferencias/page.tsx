import Link from "@/components/ui/link";
import { Eye, Plus, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { can } from "@/lib/permissions";
import { transferCode } from "@/domain/transfers";
import { queryTransfers, branchOptions, type TransferRow } from "../queries";

export const metadata = { title: "Transferências entre filiais" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("stock");
  const params = await searchParams;
  const p = parseList(params, { sort: "number", dir: "desc" });
  const all = await queryTransfers(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const branches = branchOptions(s.branches);
  const here = s.ctx.branchId;
  const columns: Column<TransferRow>[] = [
    { key: "number", label: "Código", sortable: true, fixed: true, cell: (r) => <span className="font-mono">{transferCode(r.number)}</span> },
    { key: "createdAt", label: "Data", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: "fromName", label: "Origem → destino", cell: (r) => <span className="block whitespace-nowrap text-sm">{r.fromName}<span className="block text-slate-500">→ {r.toName}</span></span> },
    { key: "itemsCount", label: "Itens", align: "right", sortable: true, cell: (r) => <span className="block whitespace-nowrap">{r.itemsCount} produto{r.itemsCount === 1 ? "" : "s"}<span className="block text-xs text-slate-500">{formatQty(r.qtyTotal)} unidades</span></span> },
    { key: "costTotal", label: "Valor de custo", align: "right", sortable: true, cell: (r) => formatMoney(r.costTotal) },
    { key: "responsibleName", label: "Responsável", sortable: true, cell: (r) => <span className="text-xs">{r.responsibleName}</span> },
    { key: "status", label: "Situação", cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge kind="transfer" status={r.status} />{r.divergenceCount > 0 && <Badge tone="bad">Divergência</Badge>}</span> },
    { key: "pendingTotal", label: "Em trânsito", align: "right", sortable: true, cell: (r) => (r.pendingTotal ? formatQty(r.pendingTotal) : "—") },
    { key: "expectedAt", label: "Previsão", sortable: true, cell: (r) => (r.expectedAt ? <span className={["in_transit", "partial"].includes(r.status) && r.expectedAt < new Date().toISOString().slice(0, 10) ? "text-red-700" : ""}>{formatDate(r.expectedAt)}</span> : "—") },
    { key: "shippedAt", label: "Expedida em", hidden: true, cell: (r) => formatDateTime(r.shippedAt) },
    { key: "receivedAt", label: "Recebida em", hidden: true, cell: (r) => formatDateTime(r.receivedAt) },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      cell: (r) => (
        <span className="flex justify-end gap-1">
          <Link href={`/estoque/transferencias/${r.id}`} title="Visualizar" className="rounded p-1.5 text-slate-600 hover:bg-slate-100"><Eye className="size-4" /></Link>
          <Link href={`/estoque/transferencias/${r.id}?print=1`} title="Imprimir romaneio" className="rounded p-1.5 text-slate-600 hover:bg-slate-100"><Printer className="size-4" /></Link>
        </span>
      ),
    },
  ];
  const inTransit = all.filter((t) => ["in_transit", "partial"].includes(t.status));
  const toReceive = inTransit.filter((t) => here && t.toBranchId === here);
  const waiting = all.filter((t) => ["draft", "separated", "shipping"].includes(t.status) && (!here || t.fromBranchId === here));
  return (
    <>
      <PageHeader
        title="Transferências entre filiais"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Transferências" }]}
        description="Saída da origem e recebimento no destino são momentos distintos: o que foi expedido fica em trânsito (não disponível em nenhuma filial) até ser recebido, devolvido ou baixado."
        actions={can(s.user, "stock", "create") && here && <LinkButton href="/estoque/transferencias/novo" variant="accent"><Plus className="size-4" /> Nova transferência</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Em trânsito" value={inTransit.length} hint={`${formatQty(inTransit.reduce((a, t) => a + t.pendingTotal, 0))} unidades pendentes`} href="/estoque/transferencias?status=in_transit,partial&filial=all" tone={inTransit.length ? "warn" : "default"} />
        <Stat label="A receber nesta filial" value={toReceive.length} hint={here ? (s.branch?.name ?? "") : "Selecione uma filial"} href="/estoque/transferencias?status=in_transit,partial&direcao=recebidas" />
        <Stat label="Aguardando envio" value={waiting.length} hint="Rascunhos, separadas e expedição incompleta" href="/estoque/transferencias?status=draft,separated,shipping&direcao=enviadas" tone={waiting.some((t) => t.status === "shipping") ? "warn" : "default"} />
        <Stat label="Com divergência" value={all.filter((t) => t.divergenceCount > 0).length} hint="Avaria, falta ou perda" href="/estoque/transferencias?divergencia=1&filial=all" tone={all.some((t) => t.divergenceCount > 0) ? "bad" : "default"} />
      </div>
      <FilterBar
        basePath="/estoque/transferencias"
        values={params}
        filters={[
          { type: "search", placeholder: "Número, produto ou SKU" },
          {
            type: "select",
            name: "status",
            label: "Situação",
            all: "Todos os status",
            options: [
              { value: "draft", label: "Rascunho" },
              { value: "separated", label: "Separado" },
              { value: "shipping", label: "Expedição incompleta" },
              { value: "draft,separated,shipping", label: "Aguardando envio" },
              { value: "in_transit", label: "Em trânsito" },
              { value: "partial", label: "Recebido parcial" },
              { value: "in_transit,partial", label: "Pendentes de recebimento" },
              { value: "received", label: "Recebido" },
              { value: "cancelled", label: "Cancelado" },
            ],
          },
          { type: "select", name: "direcao", label: "Direção", options: [{ value: "enviadas", label: "Enviadas pela filial" }, { value: "recebidas", label: "Recebidas pela filial" }] },
          { type: "select", name: "filial", label: "Filial", options: [{ value: "all", label: "Todas (consolidado)" }, ...branches], all: s.branch ? `Atual (${s.branch.name})` : "Todas" },
          { type: "date", name: "de", label: "De" },
          { type: "date", name: "ate", label: "Até" },
          { type: "select", name: "divergencia", label: "Divergência", options: [{ value: "1", label: "Com divergência" }] },
        ]}
      />
      <DataTable
        id="transfers"
        basePath="/estoque/transferencias"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="transfers"
        rowHref={(r) => `/estoque/transferencias/${r.id}`}
        totals={{ costTotal: formatMoney(all.reduce((a, t) => a + t.costTotal, 0)), pendingTotal: formatQty(all.reduce((a, t) => a + t.pendingTotal, 0)) }}
      />
    </>
  );
}
