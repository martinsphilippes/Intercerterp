"use server";

import { runAction } from "@/lib/server/action";
import { BusinessError } from "@/lib/core/errors";
import { cancelCart, cartToSaleInput, createCart, ensureOpenCart, parkCart, removeCartItem, resumeCart, saveCart, type CartPatch } from "@/domain/carts";
import { finalizeSale, type SalePaymentInput } from "@/domain/sales";
import { cancelIntent, createPixIntent, simulateIntent } from "@/domain/payments/intents";
import { formatMoney } from "@/lib/money";
import { currentSession } from "@/domain/cash";
import { openInstallmentsForCustomer, receiveInstallments, reverseReceipt, sessionReceipts, type ReceiveInput } from "@/domain/pdv-receivables";

function plainCart(c: Record<string, any>) {
  return {
    id: c.id as string,
    status: c.status as string,
    terminalId: c.terminalId as string,
    customerId: (c.customerId ?? null) as string | null,
    customerName: (c.customerName ?? null) as string | null,
    cpfOnInvoice: (c.cpfOnInvoice ?? null) as string | null,
    priceTableId: (c.priceTableId ?? null) as string | null,
    items: (c.items ?? []) as any[],
    globalDiscount: (c.globalDiscount ?? 0) as number,
    globalDiscountBps: (c.globalDiscountBps ?? 0) as number,
    surcharge: (c.surcharge ?? 0) as number,
    notes: (c.notes ?? null) as string | null,
    payments: (c.payments ?? []) as any[],
    exchangeReturnId: (c.exchangeReturnId ?? null) as string | null,
    sellerId: (c.sellerId ?? null) as string | null,
    emitFiscal: c.emitFiscal !== false,
    salesDocumentId: (c.salesDocumentId ?? null) as string | null,
    salesDocumentLabel: (c.salesDocumentLabel ?? null) as string | null,
    revision: (c.revision ?? 0) as number,
    total: (c.total ?? 0) as number,
    updatedAt: c.updatedAt as string,
  };
}
export type PlainCart = ReturnType<typeof plainCart>;

/** Autosalvamento do atendimento (preserva o atendimento em atualização acidental da página). */
export async function saveCartAction(cartId: string, patch: CartPatch) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => plainCart(await saveCart(s.ctx, cartId, patch)));
}

export async function parkCartAction(cartId: string, name: string | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const { parked, fresh } = await parkCart(s.ctx, cartId, name);
    const r = parked.reservation;
    const reserved = r.enabled ? (r.shortage.length ? ` Estoque reservado parcialmente — sem disponível para: ${r.shortage.map((x) => x.sku).join(", ")}.` : " Estoque reservado.") : "";
    return { ok: true as const, message: `Pré-venda "${parked.name}" salva (${formatMoney((parked as any).total)}).${reserved}`, data: plainCart(fresh) };
  });
}

export async function resumeCartAction(cartId: string, terminalId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const c = await resumeCart(s.ctx, cartId, terminalId);
    return { ok: true as const, message: `Pré-venda "${c.name ?? ""}" retomada.`, data: plainCart(c) };
  });
}

export async function cancelCartAction(cartId: string, reason: string | null, approval?: { login: string; password: string } | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const c = await cancelCart(s.ctx, cartId, reason, { approval: approval?.login?.trim() ? approval : null });
    const current = await ensureOpenCart(s.ctx, c.terminalId);
    return { ok: true as const, message: "Atendimento cancelado.", data: plainCart(current!) };
  });
}

/**
 * Remove (ou diminui) um item já registrado no atendimento (§44): permissão do operador ou autorização do supervisor
 * no terminal, conforme os parâmetros do PDV. Devolve o atendimento gravado (fonte de verdade para a tela).
 */
export async function removeCartItemAction(cartId: string, input: { index: number; skuId: string; qty?: number | null; reason?: string | null; approval?: { login: string; password: string } | null }) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const r = await removeCartItem(s.ctx, cartId, {
      index: input.index, skuId: input.skuId, qty: input.qty ?? null, reason: input.reason ?? null, approval: input.approval?.login?.trim() ? input.approval : null,
    });
    const what = r.record.remainingQty ? "Quantidade reduzida" : "Item removido";
    return { ok: true as const, message: `${what}: ${r.record.name ?? r.record.sku ?? ""}${r.record.approvedByName ? ` (autorizado por ${r.record.approvedByName})` : ""}.`, data: plainCart(r.cart) };
  });
}

/** Inicia atendimento de troca: o atual (com itens) vai para espera e um novo recebe a devolução de origem. */
export async function startExchangeAction(terminalId: string, returnId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const ret = await s.ctx.store.getOrThrow("returns", returnId);
    if (ret.companyId !== s.ctx.companyId || ret.kind !== "exchange") throw new BusinessError("Devolução de troca inválida.");
    if (ret.exchangeSaleId) throw new BusinessError("Esta troca já foi concluída.");
    const current = await ensureOpenCart(s.ctx, terminalId, { create: false });
    if (current && (current.items ?? []).length && current.exchangeReturnId !== returnId) await parkCart(s.ctx, current.id, current.name ?? null);
    else if (current && current.exchangeReturnId !== returnId) await cancelCart(s.ctx, current.id, "Atendimento vazio substituído por troca");
    if (current && current.exchangeReturnId === returnId) return { ok: true as const, data: plainCart(current) };
    const fresh = await createCart(s.ctx, terminalId, { exchangeReturnId: returnId, customerId: ret.customerId ?? null });
    const saved = ret.customerId ? await saveCart(s.ctx, fresh.id, { customerId: ret.customerId }) : fresh;
    return { ok: true as const, message: `Troca da devolução nº ${ret.number} iniciada.`, data: plainCart(saved) };
  });
}

export async function createPixAction(cartId: string, amount: number, payerEmail?: string | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const i = await createPixIntent(s.ctx, { cartId, amount, description: `Venda PDV — atendimento ${cartId.slice(0, 8)}`, payerEmail: payerEmail ?? undefined });
    return { id: i.id, status: i.status, amount: i.amount, reference: i.reference, qrCode: i.qrCode ?? null, qrCodeImage: i.qrCodeImage ?? null, expiresAt: i.expiresAt ?? null, isSimulated: Boolean(i.isSimulated), provider: i.provider };
  });
}

export async function simulatePixAction(intentId: string, status: "confirmed" | "failed") {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const i = await simulateIntent(s.ctx, intentId, status);
    return { id: i.id, status: i.status };
  });
}

/** Cancela a cobrança no provedor; se ela já tiver sido paga, devolve "confirmed" para o PDV aplicar o Pix. */
export async function cancelPixAction(intentId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const i = await cancelIntent(s.ctx, intentId);
    const message = i.status === "confirmed" ? "O Pix já foi pago: a cobrança não pode ser cancelada — aplique-o na venda ou providencie a devolução." : i.status === "cancelled" ? "Cobrança cancelada no provedor." : `Situação da cobrança no provedor: ${i.status}.`;
    return { ok: true as const, message, data: { id: i.id, status: i.status as string } };
  });
}

/** Conclui a venda do atendimento. Idempotente pela chave do atendimento: repetir nunca cria outra venda ou cobrança. */
export async function finalizeCartAction(cartId: string, payments: SalePaymentInput[], opts: { approval?: { login: string; password: string } | null; receipt?: string | null; overdueRelease?: { reason: string; login?: string; password?: string } | null } = {}) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv", "/vendas", "/caixa"] }, async (s) => {
    const cart = await s.ctx.store.getOrThrow("carts", cartId);
    if (cart.companyId !== s.ctx.companyId) throw new BusinessError("Atendimento de outra empresa.");
    if (cart.status === "converted" && cart.saleId) return { ok: true as const, message: "Venda já concluída.", redirect: `/vendas/${cart.saleId}/conclusao` };
    if (cart.status !== "open") throw new BusinessError(cart.status === "parked" ? "Atendimento em espera: retome a pré-venda no PDV." : "Atendimento cancelado.");
    const clean: SalePaymentInput[] = payments.map((p) => ({
      methodId: p.methodId, amount: Math.round(p.amount), received: p.received != null ? Math.round(p.received) : undefined, installments: p.installments ?? undefined,
      paymentTermId: p.paymentTermId ?? null, intentId: p.intentId ?? null, nsu: p.nsu?.trim() || null, authCode: p.authCode?.trim() || null, cardBrand: p.cardBrand?.trim() || null,
      voucherCode: p.voucherCode?.trim() || null, reference: p.reference?.trim() || null,
    }));
    const sale = await finalizeSale(s.ctx, { ...cartToSaleInput(cart, clean), discountApproval: opts.approval?.login ? opts.approval : null,
      // liberação de cliente inadimplente (VEN-07): motivo + permissão do operador ou login/senha de quem autoriza
      overdueRelease: opts.overdueRelease ? { reason: opts.overdueRelease.reason, approval: opts.overdueRelease.login?.trim() ? { login: opts.overdueRelease.login, password: opts.overdueRelease.password ?? "" } : null } : null,
    });
    const receipt = opts.receipt && ["imprimir", "email", "imprimir_email"].includes(opts.receipt) ? `?comprovante=${opts.receipt}` : "";
    return { ok: true as const, message: `Venda nº ${sale.number} concluída.`, data: { saleId: sale.id }, redirect: `/vendas/${sale.id}/conclusao${receipt}` };
  });
}

// ───────────────────────────── Recebimento de parcelas do crediário no caixa (VEN-10)

function receiptView(op: Record<string, any>) {
  const r = op.result ?? {};
  return {
    id: op.id as string,
    number: (r.number ?? 0) as number,
    status: op.status as string,
    error: (op.error ?? null) as string | null,
    at: (r.at ?? null) as string | null,
    methodName: (r.methodName ?? "") as string,
    methodKind: (r.methodKind ?? "") as string,
    total: (r.total ?? 0) as number,
    received: (r.received ?? 0) as number,
    change: (r.change ?? 0) as number,
    discount: (r.discount ?? 0) as number,
    operatorName: (r.operatorName ?? "") as string,
    customers: (r.customers ?? []) as string[],
    items: ((r.items ?? []) as any[]).map((i) => ({
      installmentId: i.installmentId as string, titleNumber: i.titleNumber as number, number: i.number as number, count: i.count as number, partyName: i.partyName as string,
      dueDate: i.dueDate as string, principal: i.principal as number, fine: i.fine as number, interest: i.interest as number, discount: i.discount as number, total: i.total as number, done: Boolean(i.done),
    })),
    reversal: r.reversal ? { at: r.reversal.at as string, byName: r.reversal.byName as string, reason: r.reversal.reason as string } : null,
  };
}
export type PdvReceiptView = ReturnType<typeof receiptView>;

const RECEIVABLE_PATHS = ["/caixa", "/financeiro/receber"];

/** Parcelas em aberto do cliente (valor atualizado com multa/juros, vencidas primeiro). */
export async function pdvOpenInstallmentsAction(customerId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => openInstallmentsForCustomer(s.ctx, customerId));
}

/** Recebe as parcelas no caixa aberto do terminal. Idempotente pela chave do formulário. */
export async function pdvReceiveInstallmentsAction(input: ReceiveInput) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: RECEIVABLE_PATHS }, async (s) => {
    const op = await receiveInstallments(s.ctx, {
      terminalId: input.terminalId, installmentIds: input.installmentIds, methodId: input.methodId, received: input.received != null ? Math.round(input.received) : null,
      discount: Math.round(input.discount ?? 0), approval: input.approval?.login ? input.approval : null, reference: input.reference?.trim() || null, idemKey: input.idemKey,
    });
    const v = receiptView(op);
    if (op.status === "failed") return { ok: false as const, error: op.error ?? "Recebimento não registrado.", code: "receivable_partial" };
    if (op.status === "reversed") return { ok: true as const, message: `O recebimento nº ${v.number} já foi estornado.`, data: v };
    if (op.status === "partial") return { ok: true as const, message: `Recebimento nº ${v.number} concluído parcialmente: ${op.error ?? ""}`, data: v };
    return { ok: true as const, message: `Recebimento nº ${v.number} registrado — ${formatMoney(v.total)} em ${v.methodName}${v.methodKind === "cash" && v.change ? ` · troco ${formatMoney(v.change)}` : ""}.`, data: v };
  });
}

/** Recebimentos registrados no caixa aberto do terminal (para recibo e estorno). */
export async function pdvSessionReceiptsAction(terminalId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const session = await currentSession(s.ctx, terminalId);
    if (!session) return [] as PdvReceiptView[];
    return (await sessionReceipts(s.ctx, session.id)).map(receiptView);
  });
}

/** Estorno do recebimento (mesma sessão aberta): recompõe as parcelas e lança a saída no caixa. */
export async function pdvReverseReceiptAction(receiptId: string, reason: string, approval?: { login: string; password: string } | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: RECEIVABLE_PATHS }, async (s) => {
    const op = await reverseReceipt(s.ctx, { receiptId, reason, approval: approval?.login ? approval : null });
    const v = receiptView(op);
    return { ok: true as const, message: `Recebimento nº ${v.number} estornado: parcelas reabertas e ${formatMoney(v.total)} lançado como saída ${v.methodKind === "cash" ? "do dinheiro do caixa" : `em ${v.methodName}`}.`, data: v };
  });
}

// ───────────────────────────── Orçamento/pedido importado no PDV (PDV-12)

/** Orçamentos válidos e pedidos com saldo da filial (busca por nº ou cliente). */
export async function billableDocumentsAction(q: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const { listBillableDocuments } = await import("@/domain/sales-documents");
    return listBillableDocuments(s.ctx, q);
  });
}

/** Itens do documento com o saldo faturável (para escolher as quantidades do faturamento parcial). */
export async function documentLinesAction(documentId: string) {
  return runAction({ module: "pdv", op: "create", requireBranch: true }, async (s) => {
    const { billableByItem, documentItems, docLabel } = await import("@/domain/sales-documents");
    const doc = await s.ctx.store.getOrThrow("sales_documents", documentId);
    if (doc.companyId !== s.ctx.companyId) throw new BusinessError("Documento de outra empresa.");
    const items = await documentItems(s.ctx.store, documentId);
    const billable = doc.type === "order" ? await billableByItem(s.ctx, doc, items) : new Map(items.map((i) => [i.id, i.qty]));
    return {
      label: docLabel(doc),
      customerName: (doc.customerSnapshot?.name ?? null) as string | null,
      type: doc.type as "quote" | "order",
      lines: items.map((i) => ({ id: i.id, seq: i.seq as number, sku: i.sku as string, name: i.description as string, unitCode: i.unitCode as string, qty: i.qty as number, invoiced: (i.invoicedQty ?? 0) as number, billable: billable.get(i.id) ?? 0, unitPrice: i.unitPrice as number })),
    };
  });
}

/** Importa o orçamento/pedido no atendimento do terminal (o atual com itens vai para espera). */
export async function importDocumentAction(terminalId: string, documentId: string, quantities: Record<string, number> | null) {
  return runAction({ module: "pdv", op: "create", requireBranch: true, revalidate: ["/pdv"] }, async (s) => {
    const { importDocumentToCart } = await import("@/domain/sales-documents");
    const c = await importDocumentToCart(s.ctx, terminalId, documentId, quantities);
    return { ok: true as const, message: `${c.salesDocumentLabel ?? "Documento"} importado no atendimento.`, data: plainCart(c) };
  });
}
