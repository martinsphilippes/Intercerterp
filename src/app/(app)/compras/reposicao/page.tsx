import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { listAll } from "@/lib/db";
import { sp, normalizeSearch, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDateTime, nowIso } from "@/lib/dates";
import { lookups } from "@/lib/server/lookups";
import { computeBranchReplenishment, replenishmentSettings } from "@/domain/replenishment";
import { ReplenishmentTable } from "./replenishment-table";

export const metadata = { title: "Planejamento de compras e reposição" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const params = await searchParams;
  const branchId = sp(params, "branch") || s.ctx.branchId || s.branches[0]?.id || "";
  const branch = s.branches.find((b) => b.id === branchId);
  const cfg = await replenishmentSettings(s.ctx.store, s.ctx.companyId, branchId || null);
  const coverageDays = Math.max(0, Number(sp(params, "cobertura")) || cfg.coverageDays);
  const historyDays = Math.max(7, Number(sp(params, "historico")) || cfg.historyDays);
  const supplier = sp(params, "supplier");
  const category = sp(params, "category");
  const show = sp(params, "exibir") || "reorder";
  const q = sp(params, "q");
  const skuParam = sp(params, "sku");
  if (!branch) return <Notice tone="warn">Nenhuma filial acessível.</Notice>;
  const all = await computeBranchReplenishment(s.ctx.store, s.ctx.companyId, { branchId, coverageDays, historyDays, supplierId: supplier || null, categoryId: category || null });
  let rows = all;
  if (show === "reorder") rows = rows.filter((r) => r.suggested > 0 || r.situation === "risk" || r.situation === "incomplete");
  if (show === "risk") rows = rows.filter((r) => r.situation === "risk");
  if (show === "incomplete") rows = rows.filter((r) => r.situation === "incomplete");
  if (skuParam) {
    const hit = all.find((r) => r.skuId === skuParam);
    rows = [...(hit ? [hit] : []), ...rows.filter((r) => r.skuId !== skuParam)];
  }
  if (q) rows = rows.filter((r) => normalizeSearch(`${r.name} ${r.sku}`).includes(normalizeSearch(q)));
  const [suppliers, categories, drafts] = await Promise.all([
    lookups.suppliers(s.ctx),
    lookups.categories(s.ctx),
    listAll(s.ctx.store, "purchase_orders", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "branchId", branchId], ["eq", "origin", "replenishment"], ["eq", "status", ["draft", "adjust"]]] }),
  ]);
  const toBuy = all.filter((r) => r.suggested > 0);
  const detailQs = `?branch=${branchId}&cobertura=${coverageDays}&historico=${historyDays}`;
  const link = (extra: Record<string, string>) => {
    const u = new URLSearchParams({ branch: branchId, cobertura: String(coverageDays), historico: String(historyDays), ...(supplier ? { supplier } : {}), ...(category ? { category } : {}), ...extra });
    return `/compras/reposicao?${u.toString()}`;
  };
  return (
    <>
      <PageHeader
        title="Planejamento de compras e reposição"
        crumbs={[{ label: "Compras" }, { label: "Reposição" }]}
        description="Sugestões por filial a partir de estoque disponível, consumo, mínimos e entregas confirmadas. Revise quantidades, fornecedor e custo e crie rascunhos por fornecedor."
        actions={<Link href={`/compras/pedidos?origin=replenishment&status=drafting`} className={buttonClass("secondary")}>Rascunhos <span className="ml-1 rounded-full bg-brand-700 px-2 text-xs text-white">{drafts.length}</span></Link>}
      />
      <form method="get" action="/compras/reposicao" className="no-print mb-4 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-slate-600">
            Filial de destino
            <select name="branch" defaultValue={branchId} className={cn(inputClass, "h-9")}>
              {s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="flex w-48 flex-col gap-1 text-xs font-medium text-slate-600">
            Cobertura após o prazo de entrega (dias)
            <input type="number" min={0} max={365} name="cobertura" defaultValue={coverageDays} className={cn(inputClass, "h-9")} />
          </label>
          <label className="flex w-40 flex-col gap-1 text-xs font-medium text-slate-600">
            Histórico de consumo (dias)
            <input type="number" min={7} max={730} name="historico" defaultValue={historyDays} className={cn(inputClass, "h-9")} />
          </label>
          <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-slate-600">
            Fornecedor
            <select name="supplier" defaultValue={supplier} className={cn(inputClass, "h-9")}>
              <option value="">Todos</option>
              {suppliers.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-[150px] flex-col gap-1 text-xs font-medium text-slate-600">
            Categoria
            <select name="category" defaultValue={category} className={cn(inputClass, "h-9")}>
              <option value="">Todas</option>
              {categories.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-[150px] flex-col gap-1 text-xs font-medium text-slate-600">
            Exibir
            <select name="exibir" defaultValue={show} className={cn(inputClass, "h-9")}>
              <option value="reorder">A repor</option>
              <option value="risk">Risco antes da entrega</option>
              <option value="incomplete">Completar dados</option>
              <option value="all">Todos os produtos</option>
            </select>
          </label>
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
            Produto
            <input name="q" defaultValue={q} placeholder="Nome ou SKU" className={cn(inputClass, "h-9")} />
          </label>
          <button type="submit" className={buttonClass("accent")}><RefreshCw className="size-4" /> Recalcular</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Posição em {formatDateTime(nowIso())} · consumo médio = vendas líquidas (vendas − devoluções) dos últimos {historyDays} dias · estoque mínimo por produto/depósito · contexto: {s.company.tradeName ?? s.company.name} · {branch.name} · cobertura adicional de {coverageDays} dias.</p>
      </form>
      {skuParam && <Notice tone="info" title="Aberto a partir de um alerta de estoque mínimo">O produto do alerta aparece destacado. <Link className="underline" href={`/compras/reposicao/${skuParam}${detailQs}`}>Ver o detalhamento do cálculo</Link>.</Notice>}
      <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Itens a repor" value={toBuy.length} hint={`de ${all.length} produto(s) avaliados`} href={link({ exibir: "reorder" })} />
        <Stat label="Valor estimado das sugestões" value={formatMoney(toBuy.reduce((a, r) => a + r.suggestedCost, 0))} hint="Quantidade sugerida × último custo (sem frete)" />
        <Stat label="Risco antes da entrega" value={all.filter((r) => r.situation === "risk").length} hint="Disponível acaba antes da próxima chegada" href={link({ exibir: "risk" })} tone={all.some((r) => r.situation === "risk") ? "bad" : "default"} />
        <Stat label="Completar dados" value={all.filter((r) => r.situation === "incomplete").length} hint="Sem fornecedor vinculado ou sem custo" href={link({ exibir: "incomplete" })} tone={all.some((r) => r.situation === "incomplete") ? "warn" : "default"} />
      </div>
      <ReplenishmentTable
        branchId={branchId}
        branchName={branch.name}
        coverageDays={coverageDays}
        detailQs={detailQs}
        highlight={skuParam || null}
        rows={rows.map((r) => ({
          skuId: r.skuId, sku: r.sku, name: r.name, unitCode: r.unitCode, abc: r.abc, available: r.available, physical: r.physical, reserved: r.reserved, minQty: r.minQty, target: r.target,
          confirmedInHorizon: r.confirmedInHorizon, confirmedOutside: r.confirmedOutside, draftQty: r.draftQty, grossNeed: r.grossNeed, suggested: r.suggested, situation: r.situation, limitation: r.limitation,
          hasHistory: r.hasHistory, avgDaily: r.avgDaily, horizonDays: r.horizonDays, supplierId: r.supplierId, supplierName: r.supplierName, unitCost: r.unitCost, supplierMinQty: r.supplierMinQty, multiple: r.multiple,
          stockoutDate: r.stockoutDate, nextArrival: r.nextArrival, supplierOptions: r.supplierOptions.map((o) => ({ supplierId: o.supplierId, name: o.name, lastCost: o.lastCost, leadTimeDays: o.leadTimeDays })),
        }))}
      />
      <details className="mt-4 rounded-lg border border-line bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Critérios da sugestão</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          <li><b>Horizonte</b> por item = prazo do fornecedor (vínculo produto × fornecedor, senão cadastro do fornecedor) + {coverageDays} dias de cobertura adicional.</li>
          <li><b>Consumo médio diário</b> = (vendas concluídas − devoluções) da filial nos últimos {historyDays} dias ÷ {historyDays}. Vendas canceladas não contam.</li>
          <li><b>Alvo</b> = máx(estoque mínimo, ⌈consumo médio × horizonte⌉) + estoque de segurança. Sem histórico: máx(mínimo, máximo/alvo cadastrado) + segurança — marcado “sem histórico”.</li>
          <li><b>Disponível</b> = físico − reservado nos depósitos de venda. <b>Confirmado</b> = saldo a receber de pedidos aprovados/enviados/parciais com previsão dentro do horizonte; entregas posteriores (ou sem previsão) aparecem como “fora do horizonte” e não reduzem a necessidade.</li>
          <li><b>Necessidade</b> = máx(0, alvo − disponível − confirmado). Rascunhos e pedidos em análise aparecem à parte e reduzem a proposta (não contam como estoque).</li>
          <li><b>Sugestão</b> = necessidade arredondada para cima ao lote mínimo e ao múltiplo de compra do fornecedor. Classe ABC pela receita do período (limites dos parâmetros).</li>
        </ul>
      </details>
    </>
  );
}
