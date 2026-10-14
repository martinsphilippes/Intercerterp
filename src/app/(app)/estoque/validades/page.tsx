import Link from "@/components/ui/link";
import { Boxes, ClipboardList } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { paginate, parseList, qs, type SearchParams } from "@/lib/list";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { lotAlertDays, listLots, type LotRow } from "@/domain/lots";
import { branchOptions, branchScope, canSeeBranch } from "../queries";

export const metadata = { title: "Validades e lotes" };

const STATUS: Record<LotRow["status"], [string, "bad" | "warn" | "good" | "neutral"]> = {
  expired: ["Vencido", "bad"],
  expiring: ["A vencer", "warn"],
  ok: ["No prazo", "good"],
  none: ["Sem validade", "neutral"],
};

/** Relatório de validades (EST-02): lotes com saldo por depósito, vencidos e a vencer no prazo do alerta (parâmetro). */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("stock");
  await requireFeaturePage(s, "lotes");
  const params = await searchParams;
  const p = parseList(params, { sort: "expiry", dir: "asc" });
  const scope = branchScope(s.ctx, p.f);
  const days = await lotAlertDays(s.ctx.store, s.ctx.companyId, s.ctx.branchId);
  const situacao = p.f.situacao as "expired" | "expiring" | "ok" | "attention" | undefined;
  const everything = (await listLots(s.ctx.store, s.ctx.companyId, { branchId: scope, alertDays: days, q: p.q })).filter((r) => canSeeBranch(s.ctx, r.branchId));
  const all = situacao ? everything.filter((r) => (situacao === "attention" ? r.status === "expired" || r.status === "expiring" : r.status === situacao)) : everything;
  const { rows, total } = paginate(all, p);
  const branches = branchOptions(s.branches);
  const count = (st: LotRow["status"]) => everything.filter((r) => r.status === st).length;
  const base = "/estoque/validades";
  const link = (extra: Record<string, string | null>) => `${base}${qs({ ...extra, page: null }, params)}`;
  const columns: Column<LotRow>[] = [
    { key: "name", label: "Produto / SKU", sortable: true, fixed: true, cell: (r) => <span className="block min-w-48">{r.name}<span className="block font-mono text-xs font-normal text-slate-500">{r.sku}</span></span> },
    { key: "lot", label: "Lote", sortable: true, cell: (r) => <span className="font-mono text-xs">{r.lot}</span> },
    { key: "expiry", label: "Validade", sortable: true, cell: (r) => (r.expiry ? <span className="whitespace-nowrap">{formatDate(r.expiry)}{r.days != null && <span className="block text-xs text-slate-500">{r.days < 0 ? `vencido há ${-r.days} dia(s)` : r.days === 0 ? "vence hoje" : `em ${r.days} dia(s)`}</span>}</span> : "—") },
    { key: "mfg", label: "Fabricação", hidden: true, cell: (r) => (r.mfg ? formatDate(r.mfg) : "—") },
    { key: "warehouseName", label: "Depósito", sortable: true, cell: (r) => <span className="whitespace-nowrap text-xs">{r.warehouseName}</span> },
    { key: "qty", label: "Saldo do lote", align: "right", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatQty(r.qty)} <span className="text-xs text-slate-400">{r.unitCode}</span></span> },
    { key: "status", label: "Situação", cell: (r) => <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge> },
  ];
  return (
    <>
      <PageHeader
        title="Validades e lotes"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Validades" }]}
        description={`Saldo por lote dos produtos com controle de lote e validade. “A vencer” = validade nos próximos ${days} dia(s) (Parâmetros › Recursos). A venda baixa primeiro o lote que vence antes (FEFO); lotes vencidos não são vendidos — registre a perda ou a devolução ao fornecedor.`}
        actions={
          <>
            <LinkButton href="/estoque"><Boxes className="size-4" /> Saldos</LinkButton>
            <LinkButton href="/estoque/inventarios"><ClipboardList className="size-4" /> Inventários</LinkButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lotes com saldo" value={everything.length} hint="No recorte de filial" href={link({ situacao: null })} />
        <Stat label="Vencidos" value={count("expired")} hint="Retirar da venda" href={link({ situacao: "expired" })} tone={count("expired") ? "bad" : "default"} />
        <Stat label="A vencer" value={count("expiring")} hint={`Próximos ${days} dia(s)`} href={link({ situacao: "expiring" })} tone={count("expiring") ? "warn" : "default"} />
        <Stat label="No prazo" value={count("ok") + count("none")} hint="Inclui lotes sem validade" href={link({ situacao: "ok" })} />
      </div>
      {everything.length === 0 && (
        <Notice tone="info" title="Nenhum lote com saldo">
          Marque “Controla lote e validade” na aba Estoque do produto (<Link className="text-brand-700 hover:underline" href="/produtos">Produtos</Link>). Os lotes entram pelo recebimento (XML com rastro ou lote digitado na conferência), por ajuste de entrada ou por inventário.
        </Notice>
      )}
      <FilterBar
        basePath={base}
        values={params}
        filters={[
          { type: "search", placeholder: "Produto, SKU ou lote" },
          { type: "select", name: "filial", label: "Filial", options: [{ value: "all", label: "Todas (consolidado)" }, ...branches], all: s.branch ? `Atual (${s.branch.name})` : "Todas" },
          { type: "select", name: "situacao", label: "Situação", options: [{ value: "attention", label: "Vencidos e a vencer" }, { value: "expired", label: "Vencidos" }, { value: "expiring", label: "A vencer" }, { value: "ok", label: "No prazo" }] },
        ]}
      />
      <DataTable id="stock-lots" basePath={base} params={params} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} rowHref={(r) => `/produtos/${r.productId}?tab=estoque`} totals={{ qty: formatQty(all.reduce((a, r) => a + r.qty, 0)) }} />
    </>
  );
}
