import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import { supplierLabel } from "@/domain/suppliers";
import { QuotationForm } from "../quotation-form";

export const metadata = { title: "Nova cotação" };

export default async function Page({ searchParams }: { searchParams: Promise<{ skus?: string }> }) {
  const s = await requireSession("purchases", "create");
  const { skus } = await searchParams;
  if (!s.ctx.branchId) return <Notice tone="warn">Selecione uma filial para criar cotações.</Notice>;
  const suppliers = (await listAll(s.ctx.store, "suppliers", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "status", "active"]] })).map((x) => ({ value: x.id, label: supplierLabel(x) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  // ?skus=id:qty,id:qty (necessidade vinda de outra tela)
  const pre = (skus ?? "").split(",").map((p) => p.split(":")).filter(([id]) => id);
  const items = [];
  const linked: Record<string, string[]> = {};
  for (const [id, qty] of pre) {
    const sku = await s.ctx.store.get("skus", id);
    if (!sku || sku.companyId !== s.ctx.companyId) continue;
    items.push({ skuId: id, sku: sku.sku, name: sku.name ?? sku.sku, unitCode: sku.unitCode ?? "UN", qty: Number(qty) || 1000, neededBy: addDays(today(), 15) });
    linked[id] = (await listAll(s.ctx.store, "supplier_products", { filters: [["eq", "skuId", id]] })).map((x) => x.supplierId);
  }
  return (
    <>
      <PageHeader title="Nova cotação" crumbs={[{ label: "Cotações", href: "/compras/cotacoes" }, { label: "Nova" }]} description="Itens com quantidade e data necessária; convide os fornecedores e registre (ou importe por CSV) as propostas." />
      <QuotationForm items={items} suppliers={suppliers} linked={linked} />
    </>
  );
}
