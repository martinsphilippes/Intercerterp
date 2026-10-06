import Link from "next/link";
import { Boxes, Truck } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { can, canDo } from "@/lib/permissions";
import { MOVEMENT_LABEL, ORIGIN_LABEL, balanceId } from "@/domain/stock";
import { transferCode } from "@/domain/transfers";
import { queryMovements, branchScope, branchOptions, canSeeBranch, warehouseOptions, type MovementRow } from "../queries";
import { MovementForm } from "./movement-form";

export const metadata = { title: "Movimentação de estoque" };

const TYPE_TONE: Record<string, Tone> = {
  initial: "info", purchase: "good", sale: "bad", sale_cancel: "good", return: "good", adjust_in: "accent", adjust_out: "accent", loss: "bad", transfer_out: "brand", transfer_in: "brand",
  transfer_return: "brand", inventory: "warn", manual_in: "good", manual_out: "bad", damage_in: "warn",
};

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("stock");
  const params = await searchParams;
  const p = parseList(params, { sort: "occurredAt", dir: "desc", pageSize: 50 });
  const { rows: all, period } = await queryMovements(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const scope = branchScope(s.ctx, p.f);
  const branches = branchOptions(s.branches);
  const [warehouses, ownWhDocs] = await Promise.all([warehouseOptions(s.ctx, scope), s.ctx.branchId ? listAll(s.ctx.store, "warehouses", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "branchId", s.ctx.branchId]] }) : Promise.resolve([])]);
  // depósito de venda primeiro (avarias por último)
  const ownWarehouses = [...ownWhDocs].sort((a, b) => Number(a.kind !== "available") - Number(b.kind !== "available") || a.name.localeCompare(b.name)).map((w) => ({ value: w.id, label: w.kind === "damaged" ? `${w.name} (avarias)` : w.name }));
  const canAdjust = Boolean(s.ctx.branchId) && canDo(s.user, "stock.adjust") && can(s.user, "stock", "create");

  // contexto do produto selecionado: saldos por local e trânsito — só SKU da empresa ativa (id de outra
  // empresa é tratado como inexistente) e só filiais que o usuário pode consultar
  const skuId = p.f.sku || null;
  const skuDoc = skuId ? await s.ctx.store.get("skus", skuId) : null;
  const sku = skuDoc && skuDoc.companyId === s.ctx.companyId ? skuDoc : null;
  const skuBals = sku ? (await listAll(s.ctx.store, "stock_balances", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "skuId", sku.id]] })).filter((b) => canSeeBranch(s.ctx, b.branchId)) : [];
  const whKind = new Map((await listAll(s.ctx.store, "warehouses", { filters: [["eq", "companyId", s.ctx.companyId]] })).map((w) => [w.id, w.kind]));
  const inTransitTransfers = sku ? (await listAll(s.ctx.store, "transfers", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "status", ["in_transit", "partial"]]] })).filter((t) => (t.items ?? []).some((i: any) => i.skuId === sku.id) && (canSeeBranch(s.ctx, t.fromBranchId) || canSeeBranch(s.ctx, t.toBranchId))) : [];
  let initialSku = null;
  if (sku && ownWarehouses[0]) {
    const b = skuBals.find((x) => x.id === balanceId(ownWarehouses[0].value, sku.id));
    initialSku = { id: sku.id, sku: sku.sku, name: sku.name, unitCode: sku.unitCode, barcode: sku.barcode ?? null, physical: b?.physical ?? 0, available: (b?.physical ?? 0) - (b?.reserved ?? 0), avgCost: b?.avgCost ?? sku.costTotal ?? 0, location: b?.location ?? null, minQty: b?.minQty ?? 0 };
  }

  const columns: Column<MovementRow>[] = [
    { key: "occurredAt", label: "Data", sortable: true, fixed: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span> },
    { key: "productName", label: "Produto / SKU", sortable: true, cell: (r) => <span className="block min-w-44"><Link className="text-brand-700 hover:underline" href={`/produtos/${r.productId}?tab=estoque`}>{r.productName}</Link><span className="block font-mono text-xs text-slate-500">{r.skuCode}</span></span> },
    { key: "type", label: "Tipo", sortable: true, cell: (r) => <Badge tone={TYPE_TONE[r.type] ?? "neutral"}>{r.typeLabel}</Badge> },
    {
      key: "originLabel",
      label: "Motivo / documento",
      cell: (r) => (
        <span className="block max-w-[16rem]">
          <span className="block text-sm">{r.originHref ? <Link className="text-brand-700 hover:underline" href={r.originHref}>{r.originLabel}</Link> : r.originLabel}</span>
          <span className="block truncate text-xs text-slate-500" title={[r.reason, r.notes].filter(Boolean).join(" — ")}>{[r.reason, r.notes].filter(Boolean).join(" — ") || "—"}</span>
          {(r.documentRef || r.lot) && <span className="block text-xs text-slate-500">{[r.documentRef && `Doc. ${r.documentRef}`, r.lot && `Lote ${r.lot}${r.lotExpiry ? ` (val. ${formatDate(r.lotExpiry)})` : ""}`].filter(Boolean).join(" · ")}</span>}
        </span>
      ),
    },
    { key: "warehouseName", label: "Filial · depósito", sortable: true, hidden: Boolean(scope) && !p.f.deposito, cell: (r) => <span className="block whitespace-nowrap text-xs">{r.branchName}<span className="block text-slate-500">{r.warehouseName}</span></span> },
    { key: "userName", label: "Usuário", sortable: true, cell: (r) => <span className="block max-w-28 text-xs">{r.userName}</span> },
    { key: "qty", label: "Quantidade", align: "right", sortable: true, cell: (r) => <span className={`whitespace-nowrap font-semibold ${r.qty > 0 ? "text-emerald-700" : "text-red-700"}`}>{r.qty > 0 ? "+" : "−"} {formatQty(Math.abs(r.qty))} <span className="text-xs font-normal text-slate-400">{r.unitCode}</span></span> },
    { key: "balanceBefore", label: "Saldo anterior", align: "right", hidden: true, cell: (r) => formatQty(r.balanceBefore) },
    { key: "balanceAfter", label: "Saldo após", align: "right", cell: (r) => formatQty(r.balanceAfter) },
    { key: "unitCost", label: "Custo unit.", align: "right", hidden: true, cell: (r) => formatMoney(r.unitCost) },
    { key: "totalCost", label: "Custo total", align: "right", sortable: true, hidden: true, cell: (r) => formatMoney(r.totalCost) },
    { key: "avgCostAfter", label: "Custo médio após", align: "right", hidden: true, cell: (r) => formatMoney(r.avgCostAfter) },
  ];
  const sum = (k: "inQty" | "outQty" | "inValue" | "outValue") => all.reduce((a, r) => a + (r[k] ?? 0), 0);
  const typeOptions = Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label }));
  const originOptions = Object.entries(ORIGIN_LABEL).filter(([k]) => !["purchase_receipt", "purchase"].includes(k)).map(([value, label]) => ({ value, label }));
  const [oType, oId] = (p.f.origem ?? "").split(":");
  if (oId) originOptions.unshift({ value: p.f.origem!, label: all[0]?.originLabel ?? `${ORIGIN_LABEL[oType] ?? oType} (registro)` });
  return (
    <>
      <PageHeader
        title="Movimentação de estoque"
        crumbs={[{ label: "Produtos e estoque" }, { label: "Movimentos" }]}
        description="Entradas, saídas, ajustes, perdas e transferências — cada saldo resulta de movimentos rastreáveis, com saldo anterior/posterior, origem, usuário e motivo."
        actions={
          <>
            <LinkButton href="/estoque"><Boxes className="size-4" /> Saldos</LinkButton>
            <LinkButton href="/estoque/transferencias"><Truck className="size-4" /> Transferências</LinkButton>
          </>
        }
      />
      {sku && (
        <div className="mb-4">
          <p className="mb-2 text-sm text-slate-600">
            Saldos de <strong>{sku.name}</strong> <span className="font-mono text-xs">({sku.sku})</span> por local
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {branches.map((b) => {
              const bs = skuBals.filter((x) => x.branchId === b.value && whKind.get(x.warehouseId) === "available");
              const phys = bs.reduce((a, x) => a + x.physical, 0);
              const av = bs.reduce((a, x) => a + x.physical - x.reserved, 0);
              return <Stat key={b.value} label={`${b.label}${b.value === s.ctx.branchId ? " (atual)" : ""}`} value={`${formatQty(phys)} ${sku.unitCode}`} hint={`Disponível: ${formatQty(av)}`} href={`/estoque?sku=${sku.id}&filial=${b.value}`} />;
            })}
            <Stat
              label="Em trânsito"
              value={`${formatQty(skuBals.reduce((a, x) => a + (x.inTransit ?? 0), 0))} ${sku.unitCode}`}
              hint={inTransitTransfers.length ? `${inTransitTransfers.map((t) => transferCode(t.number)).join(", ")}${inTransitTransfers.some((t) => t.expectedAt) ? ` · previsão ${inTransitTransfers.filter((t) => t.expectedAt).map((t) => formatDate(t.expectedAt)).join(", ")}` : ""}` : "Nenhuma transferência pendente"}
              href={`/estoque/transferencias?status=in_transit,partial&q=${encodeURIComponent(sku.sku)}&filial=all`}
              tone={inTransitTransfers.length ? "warn" : "default"}
            />
          </div>
        </div>
      )}
      <div className="space-y-4">
        {canAdjust && (
          <div>
            <MovementForm warehouses={ownWarehouses} initialSku={initialSku} branchName={s.branch?.name ?? ""} />
          </div>
        )}
        <div className="min-w-0">
          {!canAdjust && s.ctx.branchId === null && <div className="mb-3"><Notice tone="info">Contexto consolidado: somente consulta. Selecione uma filial para registrar movimentações.</Notice></div>}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Entradas" value={formatQty(sum("inQty"))} hint={formatMoney(sum("inValue"))} />
            <Stat label="Saídas" value={formatQty(sum("outQty"))} hint={formatMoney(sum("outValue"))} />
            <Stat label="Movimentos" value={all.length.toLocaleString("pt-BR")} hint={period ? `${formatDate(period.from)} a ${formatDate(period.to)}` : "Todo o período da origem"} />
            <Stat label="Ajustes e perdas" value={all.filter((r) => ["adjust_in", "adjust_out", "loss", "manual_in", "manual_out", "inventory"].includes(r.type)).length} hint="Manuais e de inventário" href={`/estoque/movimentos?tipo=adjust_in,adjust_out,loss,manual_in,manual_out,inventory${period ? `&de=${period.from}&ate=${period.to}` : ""}`} />
          </div>
          {oType && (
            <div className="mb-3">
              <Notice tone="info">
                Filtrado pela origem: {ORIGIN_LABEL[oType] ?? oType}{oId ? ` (${all[0]?.originLabel ?? oId})` : ""}. <Link className="underline" href="/estoque/movimentos">Limpar</Link>
              </Notice>
            </div>
          )}
          <FilterBar
            basePath="/estoque/movimentos"
            values={{ ...params, de: params.de ?? period?.from, ate: params.ate ?? period?.to }}
            filters={[
              { type: "search", placeholder: "Produto, SKU ou código de barras" },
              { type: "date", name: "de", label: "De" },
              { type: "date", name: "ate", label: "Até" },
              { type: "select", name: "filial", label: "Filial", options: [{ value: "all", label: "Todas (consolidado)" }, ...branches], all: s.branch ? `Atual (${s.branch.name})` : "Todas" },
              { type: "select", name: "deposito", label: "Depósito", options: warehouses },
              { type: "select", name: "tipo", label: "Tipo", options: typeOptions, all: "Todos os tipos" },
              { type: "select", name: "origem", label: "Origem", options: originOptions, all: "Todas as origens" },
            ]}
          >
            {p.f.sku && <input type="hidden" name="sku" value={p.f.sku} />}
            {p.f.produto && <input type="hidden" name="produto" value={p.f.produto} />}
          </FilterBar>
          <DataTable
            id="stock-movements"
            basePath="/estoque/movimentos"
            params={params}
            columns={columns}
            rows={rows}
            total={total}
            page={p.page}
            pageSize={p.pageSize}
            exportKey="stock-movements"
            totals={{ qty: `+${formatQty(sum("inQty"))} / −${formatQty(sum("outQty"))}`, totalCost: `${formatMoney(sum("inValue"))} / ${formatMoney(sum("outValue"))}` }}
          />
        </div>
      </div>
    </>
  );
}
