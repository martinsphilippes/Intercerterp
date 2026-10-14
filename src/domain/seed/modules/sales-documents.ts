import { QTY } from "@/lib/money";
import type { DemoRefs } from "../base";

/**
 * Demonstração da Fase 5 — documento comercial de venda (idempotente pelas chaves dos documentos e da venda):
 *  - orçamento ENVIADO (Ana, papelaria) aguardando resposta;
 *  - orçamento APROVADO (João, acessórios) pronto para virar pedido ou venda no PDV;
 *  - pedido da Escola Saber Mais PARCIALMENTE FATURADO: parte vendida no PDV (caixa aberto da Matriz), restante reservado
 *    no estoque e disponível para NF-e (Fiscal › NF-e › origem pedido de venda).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const { createSalesDocument, markQuoteSent, approveQuote, cartItemsFor } = await import("../../sales-documents");
  const { finalizeSale } = await import("../../sales");
  const { cartTotals } = await import("../../cart-calc");
  const { currentSession, openSession } = await import("../../cash");
  const admin = await refs.ctxFor("admin", "matriz");
  const out: Record<string, unknown> = {};

  const sent = await createSalesDocument(
    admin,
    "quote",
    {
      customerId: refs.customers.ana.id,
      items: [{ skuId: refs.skus["caderno-u"].id, qty: 6 * QTY }, { skuId: refs.skus["caneta-u"].id, qty: 2 * QTY }],
      globalDiscount: 500,
      paymentNotes: "Pix à vista",
      notes: "Material escolar — retirada na loja.",
    },
    { idemKey: "demo-quote-sent" },
  );
  if (sent.status === "draft") await markQuoteSent(admin, sent.id, "whatsapp");
  out.quoteSent = sent.number;

  const approved = await createSalesDocument(
    admin,
    "quote",
    {
      customerId: refs.customers.joao.id,
      items: [{ skuId: refs.skus["bone-u"].id, qty: 2 * QTY }, { skuId: refs.skus["cinto-u"].id, qty: QTY, itemDiscount: 490 }],
      paymentTermId: refs.terms["crediario-3x"]?.id ?? null,
      paymentNotes: "Crediário em 3x",
    },
    { idemKey: "demo-quote-approved" },
  );
  if (approved.status === "draft" || approved.status === "sent") await approveQuote(admin, approved.id);
  out.quoteApproved = approved.number;

  const order = await createSalesDocument(
    admin,
    "order",
    {
      customerId: refs.customers.escola.id,
      items: [{ skuId: refs.skus["caderno-u"].id, qty: 15 * QTY }, { skuId: refs.skus["caneca-u"].id, qty: 3 * QTY }],
      globalDiscountBps: 200,
      deliveryDate: null,
      paymentNotes: "Entrega parcial: cadernos agora, canecas na próxima semana",
      notes: "Pedido da coordenação pedagógica.",
    },
    { idemKey: "demo-order-partial" },
  );
  out.order = order.number;

  // faturamento parcial no PDV: 8 cadernos vendidos no caixa aberto da Matriz (venda idempotente pela chave)
  const fresh = await store.getOrThrow("sales_documents", order.id);
  if ((fresh.invoicedQtyTotal ?? 0) === 0 && ["open", "partial"].includes(fresh.status)) {
    const cashier = await refs.ctxFor("cashier", "matriz");
    const terminalId = refs.terminals.cx1.id;
    if (!(await currentSession(cashier, terminalId))) await openSession(cashier, { terminalId, openingFund: 20000 });
    const items = await store.list("sales_document_items", { filters: [["eq", "documentId", order.id]], orderBy: [{ field: "seq" }], limit: 10 });
    const caderno = items.items.find((i) => i.skuId === refs.skus["caderno-u"].id);
    if (caderno) {
      const lines = await cartItemsFor(cashier, fresh, Object.fromEntries(items.items.map((i) => [i.id, i.id === caderno.id ? 8 * QTY : 0])));
      const total = cartTotals({ items: lines }).total;
      const sale = await finalizeSale(cashier, {
        idemKey: "demo-sales-doc-partial",
        terminalId,
        customerId: refs.customers.escola.id,
        sellerId: fresh.sellerId ?? null,
        priceTableId: fresh.priceTableId ?? null,
        items: lines.map((l) => ({ skuId: l.skuId, qty: l.qty, unitPrice: l.unitPrice ?? undefined, itemDiscount: l.itemDiscount ?? 0, itemSurcharge: l.itemSurcharge ?? 0 })),
        payments: [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }],
        salesDocumentId: order.id,
        notes: `Pedido nº ${order.number} — entrega parcial`,
      });
      out.partialSale = sale.number;
    }
  }
  return out;
}
