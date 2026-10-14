import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { featureOn } from "@/lib/server/features";
import { pendingInvoiceSettings } from "@/domain/pending-invoice";
import { supplierLabel } from "@/domain/suppliers";
import { noOrderEntryOn } from "@/domain/receipts";
import { receivesGoods, sortWarehouses, warehouseOptionLabel } from "@/domain/warehouse-rules";
import { NewReceipt } from "./new-receipt";

export const metadata = { title: "Receber mercadorias" };

export default async function Page({ searchParams }: { searchParams: Promise<{ pedido?: string; modo?: string }> }) {
  const s = await requireSession("purchases");
  const { pedido, modo } = await searchParams;
  const crumbs = [{ label: "Recebimentos", href: "/compras/recebimentos" }, { label: "Receber" }];
  // §40: quem só tem "Lançar entrada com nota a confirmar" (sem "Receber mercadorias") vê somente essa opção
  const canReceive = canDo(s.user, "purchase.receive");
  const canPending = canDo(s.user, "purchase.receive_pending_invoice") && (await featureOn(s, "notaAConfirmar"));
  if (!canReceive && !canPending) {
    return (
      <>
        <PageHeader title="Receber mercadorias" crumbs={crumbs} />
        <Notice tone="warn">Seu perfil não tem a permissão “Receber mercadorias” nem “Lançar entrada com nota a confirmar”.</Notice>
      </>
    );
  }
  if (!s.ctx.branchId)
    return (
      <>
        <PageHeader title="Receber mercadorias" crumbs={crumbs} />
        <Notice tone="warn" title="Selecione uma filial">O recebimento dá entrada no estoque de uma filial específica.</Notice>
      </>
    );
  const orders = await listAll(s.ctx.store, "purchase_orders", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "branchId", s.ctx.branchId], ["eq", "status", ["approved", "sent", "partial"]]], orderBy: [{ field: "number" }] });
  const suppliers = await listAll(s.ctx.store, "suppliers", { filters: [["eq", "companyId", s.ctx.companyId], ["ne", "status", "inactive"]] });
  const [noOrderEnabled, terms, methods, warehouses] = await Promise.all([
    noOrderEntryOn(s.ctx.store, s.ctx.companyId, s.ctx.branchId),
    listAll(s.ctx.store, "payment_terms", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
    listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
    listAll(s.ctx.store, "warehouses", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "branchId", s.ctx.branchId]] }),
  ]);
  const defaultWh = warehouses.find((w) => w.id === s.branch?.defaultWarehouseId);
  const piDueDays = canPending ? (await pendingInvoiceSettings(s.ctx.store, s.ctx.companyId, s.ctx.branchId)).dueDays : 0;
  return (
    <>
      <PageHeader title="Receber mercadorias" crumbs={crumbs} description={`Importe a NF-e, confira os produtos e conclua a entrada fiscal e física na filial ${s.branch?.name}.`} />
      <NewReceipt
        initialOrderId={pedido ?? null}
        canReceive={canReceive}
        pendingInvoice={canPending ? { dueDays: piDueDays } : null}
        initialMode={modo === "nota-a-confirmar" && canPending ? "pending" : null}
        noOrderEnabled={noOrderEnabled}
        warehouses={sortWarehouses(warehouses.filter(receivesGoods)).map((w) => ({ value: w.id, label: warehouseOptionLabel(w) }))}
        defaultWarehouseName={defaultWh?.name ?? ""}
        terms={terms.map((t) => ({ value: t.id, label: t.name }))}
        methods={methods.filter((m) => !["crediario", "store_credit"].includes(m.kind)).map((m) => ({ value: m.id, label: m.name }))}
        supplierTerms={Object.fromEntries(suppliers.filter((x) => x.paymentTermId).map((x) => [x.id, x.paymentTermId as string]))}
        orders={orders.map((o) => ({ id: o.id, number: o.number, supplierId: o.supplierId, supplierName: supplierLabel(o.supplierSnapshot), status: o.status, expectedDate: o.expectedDate ?? null, remainingValue: Math.max(0, o.total - (o.receivedValue ?? 0)) }))}
        suppliers={suppliers.map((x) => ({ value: x.id, label: `${supplierLabel(x)}${orders.some((o) => o.supplierId === x.id) ? ` (${orders.filter((o) => o.supplierId === x.id).length} pedido(s) em aberto)` : ""}` })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))}
      />
    </>
  );
}
