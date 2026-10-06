import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { can, canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { balanceId } from "@/domain/stock";
import { canSeeBranch, queryInventoryItems } from "../../queries";
import { cancelInventoryAction, resumeInventoryAction } from "../../actions";
import { CountSheet } from "./count-sheet";

export const metadata = { title: "Inventário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("stock");
  const { id } = await params;
  const ctx = s.ctx;
  const inv = await ctx.store.get("inventories", id);
  if (!inv || inv.companyId !== ctx.companyId || !canSeeBranch(ctx, inv.branchId)) notFound();
  const [items, branches, warehouses, users, categories] = await Promise.all([
    queryInventoryItems(ctx, id, { q: "", f: {} }),
    nameMap(ctx, "branches"),
    nameMap(ctx, "warehouses"),
    nameMap(ctx, "users"),
    nameMap(ctx, "categories"),
  ]);
  const bals = await listAll(ctx.store, "stock_balances", { filters: [["eq", "warehouseId", inv.warehouseId]] });
  const live = new Map(bals.map((b) => [b.id, b.physical]));
  const code = inv.code ?? `nº ${inv.number}`;
  const active = ["open", "counting"].includes(inv.status) && !inv.closingAt;
  const preparing = inv.status === "preparing";
  const here = ctx.branchId === inv.branchId;
  const editable = active && here && can(s.user, "stock", "edit");
  const counted = items.filter((i) => i.counted).length;
  const withDiff = items.filter((i) => i.difference);
  const impact = items.reduce((a, i) => a + (i.differenceValue ?? 0), 0);
  const summary = inv.summary ?? {};
  return (
    <>
      <PageHeader
        title={`Inventário ${code}`}
        crumbs={[{ label: "Inventários", href: "/estoque/inventarios" }, { label: code }]}
        badges={<StatusBadge kind="inventory" status={inv.status} />}
        description={`Iniciado em ${formatDateTime(inv.baseAt)} por ${users.get(inv.createdBy) ?? "—"} · ${branches.get(inv.branchId)} · ${warehouses.get(inv.warehouseId)}`}
        actions={
          <>
            <LinkButton href="/estoque/inventarios"><History className="size-4" /> Inventários anteriores</LinkButton>
            <a className={buttonClass("secondary")} href={`/api/export/inventory-items?id=${id}`}>Relatório de diferenças (CSV)</a>
            {inv.status === "completed" && <LinkButton href={`/estoque/movimentos?origem=inventory:${id}&filial=all`}>Ajustes lançados</LinkButton>}
            {preparing && here && can(s.user, "stock", "create") && <ActionButton action={resumeInventoryAction.bind(null, id)} label="Retomar abertura" variant="accent" />}
            {(active || preparing) && here && can(s.user, "stock", "edit") && <ActionButton action={cancelInventoryAction.bind(null, id)} label="Cancelar inventário" variant="ghost" askReason="Motivo do cancelamento (nenhum ajuste será lançado):" />}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Produtos no inventário" value={items.length} hint={`${branches.get(inv.branchId)} · ${warehouses.get(inv.warehouseId)}`} />
        <Stat label="Itens já contados" value={counted} hint={`${items.length ? Math.round((counted / items.length) * 100) : 0}% concluído`} />
        <Stat label="Com divergência" value={withDiff.length} hint="Requerem conferência / recontagem" tone={withDiff.length ? "warn" : "default"} />
        <Stat label="Impacto estimado" value={formatMoney(impact)} hint="Diferença × custo médio" tone={impact < 0 ? "bad" : impact > 0 ? "good" : "default"} />
      </div>
      {inv.status === "completed" && (
        <div className="mb-4">
          <Notice tone="good" title={`Concluído em ${formatDateTime(inv.completedAt)} por ${users.get(inv.completedBy) ?? "—"}`}>
            {summary.itemsAdjusted ?? 0} ajuste(s) lançado(s) — sobras {formatQty(summary.qtyPositive)} ({formatMoney(summary.valuePositive)}), faltas {formatQty(Math.abs(summary.qtyNegative ?? 0))} ({formatMoney(Math.abs(summary.valueNegative ?? 0))}), líquido {formatMoney(summary.valueNet)}. Itens não contados: {summary.uncounted === "zero" ? "considerados zero" : "mantidos sem ajuste"}. Concluir novamente não lança ajustes de novo.
          </Notice>
        </div>
      )}
      {inv.status === "cancelled" && <div className="mb-4"><Notice tone="warn" title="Inventário cancelado">{inv.cancelReason}</Notice></div>}
      {preparing && (
        <div className="mb-4">
          <Notice tone="warn" title="Abertura não concluída">
            {items.length} de {inv.itemsCount ?? items.length} item(ns) com base registrada. {here ? "Use \"Retomar abertura\" para registrar os itens que faltam (ou cancele o inventário). Enquanto isso, o depósito fica reservado para este inventário." : `Retome ou cancele no contexto da filial ${branches.get(inv.branchId)}.`}
          </Notice>
        </div>
      )}
      {active && !here && <div className="mb-4"><Notice tone="info">Para contar ou concluir, selecione a filial {branches.get(inv.branchId)} no topo.</Notice></div>}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Itens do inventário" description="Divergência = contagem física − saldo esperado. Recontagem substitui a contagem do item.">
          <CountSheet
            inventoryId={id}
            editable={editable}
            canClose={canDo(s.user, "stock.inventory_close")}
            items={items.map((i) => ({
              skuId: i.skuId, skuCode: i.skuCode, productName: i.productName, unitCode: i.unitCode, location: i.location ?? null, baseQty: i.baseQty ?? 0, liveQty: live.get(balanceId(inv.warehouseId, i.skuId)) ?? 0,
              counted: Boolean(i.counted) || i.finalQty != null, countedQty: i.countedQty ?? (i.finalQty != null && !i.counted ? i.finalQty : null), recountQty: i.recountQty ?? null, expectedQty: i.expectedQty ?? null, difference: i.difference ?? null,
              differenceValue: i.differenceValue ?? null, unitCost: i.unitCost ?? 0, note: i.note ?? null, countedByName: i.countedByName,
            }))}
          />
        </Card>
        <div className="space-y-4">
          <Card title="Método da contagem">
            <div className="space-y-2 text-sm text-slate-600">
              <p><strong>Base temporal:</strong> na abertura ({formatDateTime(inv.baseAt)}) cada item guarda o saldo físico e a posição do último movimento.</p>
              <p><strong>Esperado</strong> = saldo base + movimentos do item ocorridos entre a base e o momento da sua contagem (vendas, recebimentos, transferências), exceto os ajustes do próprio inventário.</p>
              <p><strong>Diferença</strong> = contado (ou recontado) − esperado; valor = diferença × custo médio.</p>
              <p><strong>Conclusão</strong>: um ajuste por item, uma única vez. O novo saldo = contado + movimentos posteriores à contagem — a loja segue vendendo durante o inventário.</p>
            </div>
          </Card>
          <Card title="Dados">
            <DefinitionList
              cols={1}
              items={[
                { label: "Escopo", value: inv.scope === "category" ? `Categoria ${categories.get(inv.categoryId) ?? ""}` : inv.scope === "location" ? `Localização ${inv.location}` : "Todos os produtos do depósito" },
                { label: "Responsável", value: users.get(inv.responsibleId ?? inv.createdBy) ?? "—" },
                { label: "Observações", value: inv.notes },
                { label: "Ajustes", value: inv.status === "completed" ? <Link className="text-brand-700 hover:underline" href={`/estoque/movimentos?origem=inventory:${id}&filial=all`}>Ver {summary.itemsAdjusted ?? 0} movimento(s)</Link> : "Lançados na conclusão" },
              ]}
            />
          </Card>
          <Card title="Linha do tempo">
            <Timeline store={ctx.store} refs={[`inventory:${id}`]} />
          </Card>
        </div>
      </div>
    </>
  );
}
