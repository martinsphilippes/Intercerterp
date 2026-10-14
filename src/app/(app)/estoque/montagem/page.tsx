import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { can, canDo } from "@/lib/permissions";
import { ASSEMBLY_LABEL, componentsForSkus, listAssemblies } from "@/domain/product-components";
import { AssemblyForm, type CompositeOption } from "./assembly-form";

export const metadata = { title: "Montagem e desmembramento" };

/** Montagem e desmembramento de produtos compostos (CAD-13). */
export default async function Page({ searchParams }: { searchParams: Promise<{ sku?: string; id?: string }> }) {
  const s = await requireSession("stock");
  await requireFeaturePage(s, "kits");
  const { sku: initialSku, id: highlight } = await searchParams;
  const ctx = s.ctx;
  const branchId = ctx.branchId;
  const composites = await listAll(ctx.store, "products", { filters: [["eq", "companyId", ctx.companyId], ["eq", "composition", "composite"]] });
  const skus = composites.length ? (await listAll(ctx.store, "skus", { filters: [["eq", "productId", composites.map((p) => p.id)]] })).filter((k) => k.active !== false) : [];
  const comps = await componentsForSkus(ctx.store, skus.map((k) => ({ id: k.id, productId: k.productId })));
  const warehouses = branchId ? (await listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchId]] })).filter((w) => w.status !== "inactive") : [];
  warehouses.sort((a, b) => Number(a.kind !== "available") - Number(b.kind !== "available") || a.name.localeCompare(b.name));
  const allSkuIds = [...new Set([...skus.map((k) => k.id), ...[...comps.values()].flat().map((c) => c.skuId)])];
  const balances: Record<string, { physical: number; reserved: number; avgCost: number }> = {};
  if (branchId && allSkuIds.length) {
    for (let i = 0; i < allSkuIds.length; i += 100) {
      for (const b of await listAll(ctx.store, "stock_balances", { filters: [["eq", "branchId", branchId], ["eq", "skuId", allSkuIds.slice(i, i + 100)]] })) {
        balances[`${b.warehouseId}:${b.skuId}`] = { physical: b.physical ?? 0, reserved: b.reserved ?? 0, avgCost: b.avgCost ?? 0 };
      }
    }
  }
  const costFallback: Record<string, number> = {};
  for (const k of skus) costFallback[k.id] = k.costTotal ?? 0;
  for (const c of [...comps.values()].flat()) costFallback[c.skuId] = c.costTotal;
  const productName = new Map(composites.map((p) => [p.id, p]));
  const options: CompositeOption[] = skus
    .map((k) => {
      const p = productName.get(k.productId);
      return {
        skuId: k.id, sku: k.sku, name: k.name ?? p?.name ?? k.sku, unitCode: k.unitCode ?? p?.unitCode ?? "UN", productId: k.productId,
        components: (comps.get(k.id) ?? []).map((c) => ({ skuId: c.skuId, sku: c.sku, name: c.name, unitCode: c.unitCode, qty: c.qty })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const canRun = Boolean(branchId) && canDo(s.user, "stock.adjust") && can(s.user, "stock", "create");
  const history = branchId ? await listAssemblies(ctx.store, branchId, 50) : [];
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));

  return (
    <>
      <PageHeader
        title="Montagem e desmembramento"
        crumbs={[{ label: "Estoque", href: "/estoque" }, { label: "Montagem e desmembramento" }]}
        description="Produtos compostos com estoque próprio (ex.: cesta montada). Montar baixa os componentes e dá entrada no composto pelo custo somado; desmembrar faz o inverso. Kits não passam por aqui: os componentes do kit são baixados na venda."
      />
      {!branchId ? (
        <Notice tone="info">Selecione uma filial (o consolidado é somente consulta).</Notice>
      ) : options.length === 0 ? (
        <EmptyState title="Nenhum produto composto" description="Em Produtos › (produto) › Componentes, use “Tornar composto” e cadastre os componentes." />
      ) : !canRun ? (
        <Notice tone="warn">Você pode consultar as montagens, mas registrar exige as permissões de estoque “criar” e “Ajustar estoque”.</Notice>
      ) : (
        <AssemblyForm options={options} warehouses={warehouses.map((w) => ({ value: w.id, label: w.kind === "damaged" ? `${w.name} (avarias)` : w.name }))} balances={balances} costFallback={costFallback} initialSku={initialSku && options.some((o) => o.skuId === initialSku) ? initialSku : (options[0]?.skuId ?? "")} />
      )}
      {branchId && (
        <Card className="mt-5" bodyClass="p-0" title="Montagens e desmembramentos recentes" description="Últimas 50 operações da filial. Cada uma gera movimentos de estoque com origem “Montagem/desmembramento”.">
          {history.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nenhuma operação registrada nesta filial.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Data</th><th>Operação</th><th>Produto composto</th><th className="text-right">Quantidade</th><th>Componentes</th><th className="text-right">Valor</th><th>Depósito</th><th>Usuário</th></tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} id={h.id} className={h.id === highlight ? "bg-accent-50" : undefined}>
                      <td className="whitespace-nowrap">{formatDateTime(h.at)}</td>
                      <td><Badge tone={h.direction === "assemble" ? "good" : "warn"}>{ASSEMBLY_LABEL[h.direction]}</Badge></td>
                      <td><Link className="text-brand-700 hover:underline" href={`/estoque/movimentos?sku=${h.skuId}`}>{h.name}</Link><span className="block font-mono text-xs text-slate-500">{h.sku}</span>{h.notes && <span className="block text-xs text-slate-500">{h.notes}</span>}</td>
                      <td className="tabular text-right">{formatQty(h.qty)}</td>
                      <td className="text-xs">{h.components.map((c) => `${c.sku} ${h.direction === "assemble" ? "−" : "+"}${formatQty(c.qty)}`).join(" · ")}</td>
                      <td className="tabular text-right">{formatMoney(h.totalCost)}</td>
                      <td className="text-xs">{whName.get(h.warehouseId) ?? "—"}</td>
                      <td className="text-xs">{h.createdByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
