import { detId, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso, today, addDays, addMonths, toLocalDate } from "@/lib/dates";
import { pct, roundDiv, QTY, formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { enqueue, registerJob } from "@/lib/core/jobs";
import { getSetting } from "@/lib/core/settings";
import { notify } from "@/lib/core/notify";
import { calcSale, DEFERRED_KINDS, PAYMENT_KIND_LABEL } from "./pricing-calc";
import { availableMap, defaultWarehouse, postMovements, damageWarehouse, type MovementInput } from "./stock";
import { buildSchedule, cancelTitle, createTitle, postEntry, reverseSettlement } from "./finance";
import { cashAccountFor, currentSession } from "./cash";
import { resolvePrices } from "./pricing";

/**
 * Vendas (Telas 4–11).
 * Estados independentes: comercial (status), pagamento (paymentStatus) e fiscal (fiscalStatus).
 * A conclusão é idempotente pela chave do atendimento: repetir a confirmação devolve a mesma venda.
 */

export interface SaleItemInput {
  skuId: string;
  qty: number;
  itemDiscount?: number;
  /** preço digitado pelo operador (se menor que a tabela, a diferença conta como desconto) */
  unitPrice?: number;
}

export interface SalePaymentInput {
  methodId: string;
  amount: number;
  received?: number;
  installments?: number;
  paymentTermId?: string | null;
  intentId?: string | null;
  nsu?: string | null;
  authCode?: string | null;
  cardBrand?: string | null;
  voucherCode?: string | null;
  reference?: string | null;
}

export interface FinalizeSaleInput {
  idemKey: string;
  cartId?: string | null;
  terminalId: string;
  customerId?: string | null;
  priceTableId?: string | null;
  sellerId?: string | null;
  items: SaleItemInput[];
  globalDiscount?: number;
  globalDiscountBps?: number;
  surcharge?: number;
  payments: SalePaymentInput[];
  notes?: string | null;
  exchangeReturnId?: string | null;
  emitFiscal?: boolean;
  /** somente carga de demonstração/importação histórica: instante da venda */
  occurredAt?: string;
}

const MAX_ITEMS_PER_TX = 60;

export async function loadMethods(store: Store, companyId: string) {
  const methods = await listAll(store, "payment_methods", { filters: [["eq", "companyId", companyId]] });
  return new Map(methods.map((m) => [m.id, m]));
}

/** Monta e valida a venda sem gravar (usado também para prévia do pagamento). */
export async function prepareSale(ctx: Ctx, input: FinalizeSaleInput) {
  const branchId = requireBranch(ctx);
  assert(input.items.length > 0, "Adicione ao menos um item.");
  assert(input.items.length <= MAX_ITEMS_PER_TX || ctx.store.backend !== "appwrite", `Venda com mais de ${MAX_ITEMS_PER_TX} linhas: divida o atendimento.`);
  const terminal = await ctx.store.getOrThrow("terminals", input.terminalId);
  assert(terminal.branchId === branchId, "Terminal de outra filial.");
  const warehouse = terminal.defaultWarehouseId ? await ctx.store.getOrThrow("warehouses", terminal.defaultWarehouseId) : await defaultWarehouse(ctx.store, branchId);
  const skuIds = [...new Set(input.items.map((i) => i.skuId))];
  const skus = new Map<string, Doc>();
  const products = new Map<string, Doc>();
  for (const id of skuIds) {
    const sku = await ctx.store.getOrThrow("skus", id);
    assert(sku.companyId === ctx.companyId, "Produto de outra empresa.");
    assert(sku.active !== false, `SKU ${sku.sku} inativo.`);
    skus.set(id, sku);
    if (!products.has(sku.productId)) {
      const p = await ctx.store.getOrThrow("products", sku.productId);
      assert(p.availablePdv !== false || p.type === "service", `${p.name} não está disponível no PDV.`);
      products.set(p.id, p);
    }
  }
  const branch = await ctx.store.getOrThrow("branches", branchId);
  const priceTableId = input.priceTableId ?? branch.defaultPriceTableId ?? null;
  const prices = await resolvePrices(ctx.store, { companyId: ctx.companyId, branchId, priceTableId, items: input.items.map((i) => ({ skuId: i.skuId, qty: i.qty })) });

  const lines = input.items.map((i, idx) => {
    assert(i.qty > 0, "Quantidade deve ser positiva.");
    const sku = skus.get(i.skuId)!;
    const product = products.get(sku.productId)!;
    const p = prices[idx];
    assert(p && p.price > 0, `Produto ${sku.sku} sem preço vigente na tabela selecionada.`);
    const listPrice = p.price;
    let unitPrice = listPrice;
    let itemDiscount = i.itemDiscount ?? 0;
    if (i.unitPrice != null && i.unitPrice !== listPrice) {
      if (i.unitPrice > listPrice) unitPrice = i.unitPrice;
      else itemDiscount += roundDiv((listPrice - i.unitPrice) * i.qty, QTY);
    }
    return { input: i, sku, product, unitPrice, itemDiscount, maxDiscountBps: p.maxDiscountBps, wholesale: p.wholesale };
  });
  const calc = calcSale(
    lines.map((l) => ({ qty: l.input.qty, unitPrice: l.unitPrice, itemDiscount: l.itemDiscount })),
    { globalDiscount: input.globalDiscount, globalDiscountBps: input.globalDiscountBps, surcharge: input.surcharge },
  );
  assert(calc.total > 0, "Total da venda deve ser positivo.");

  // Limites de desconto: por item (tabela) e global (perfil do usuário)
  const overLimit = !canDo(ctx.user, "sale.discount_over_limit");
  for (const [idx, l] of lines.entries()) {
    const it = calc.items[idx];
    const disc = it.itemDiscount + it.globalDiscount;
    if (l.maxDiscountBps != null && l.maxDiscountBps > 0 && it.grossTotal > 0 && roundDiv(disc * 10000, it.grossTotal) > l.maxDiscountBps && overLimit) {
      throw new BusinessError(`Desconto em ${l.sku.sku} acima do máximo da tabela (${l.maxDiscountBps / 100}%).`, "discount_limit");
    }
  }
  const discBps = calc.subtotal > 0 ? roundDiv(calc.discountTotal * 10000, calc.subtotal) : 0;
  if (overLimit && discBps > (ctx.user.discountLimitBps ?? 0)) {
    throw new BusinessError(`Desconto de ${(discBps / 100).toFixed(2)}% acima do seu limite (${((ctx.user.discountLimitBps ?? 0) / 100).toFixed(2)}%). Solicite um usuário com permissão.`, "discount_limit");
  }

  // Estoque (produtos físicos)
  const allowNegative = Boolean(terminal.allowNegativeStock) || (await getSetting(ctx.store, ctx.companyId, branchId, "sales.allowNegativeStock", false));
  const physicalSkus = lines.filter((l) => l.product.type !== "service").map((l) => l.sku.id);
  const avail = await availableMap(ctx.store, branchId, physicalSkus);
  const needed = new Map<string, number>();
  for (const l of lines) if (l.product.type !== "service") needed.set(l.sku.id, (needed.get(l.sku.id) ?? 0) + l.input.qty);
  const stockWarnings: string[] = [];
  for (const [skuId, q] of needed) {
    const a = avail.get(skuId)?.available ?? 0;
    if (a < q) {
      const msg = `${skus.get(skuId)!.sku}: disponível ${a / QTY}, vendido ${q / QTY}`;
      if (!allowNegative) throw new BusinessError(`Estoque insuficiente — ${msg}. A configuração comercial não permite venda sem saldo.`, "insufficient_stock");
      stockWarnings.push(msg);
    }
  }

  const customer = input.customerId ? await ctx.store.getOrThrow("customers", input.customerId) : null;
  if (customer) assert(customer.companyId === ctx.companyId, "Cliente de outra empresa.");
  return { branchId, branch, terminal, warehouse, lines, calc, customer, priceTableId, avail, stockWarnings, allowNegative };
}

export async function finalizeSale(ctx: Ctx, input: FinalizeSaleInput) {
  requirePerm(ctx, "pdv", "create");
  const saleId = detId("sale", input.idemKey);
  const already = await ctx.store.get("sales", saleId);
  if (already) return already; // repetição/duplo clique → mesma venda

  const prep = await prepareSale(ctx, input);
  const { branchId, terminal, warehouse, lines, calc, customer } = prep;
  const session = await currentSession(ctx, terminal.id);
  assert(session, "Abra o caixa deste terminal antes de vender.", "cash_closed");
  const methods = await loadMethods(ctx.store, ctx.companyId);

  // ── Pagamentos
  assert(input.payments.length > 0, "Informe a forma de pagamento.");
  const paySum = input.payments.reduce((a, p) => a + p.amount, 0);
  assert(paySum === calc.total, `Pagamentos (${formatMoney(paySum)}) diferentes do total (${formatMoney(calc.total)}).`, "payment_mismatch");
  const cashAcc = await cashAccountFor(ctx, branchId);
  const pays: Array<SalePaymentInput & { method: Doc; change: number; intent?: Doc | null; voucher?: Doc | null; term?: Doc | null; status: string; manual: boolean }> = [];
  for (const p of input.payments) {
    const method = methods.get(p.methodId);
    assert(method && method.active !== false, "Meio de pagamento inválido.");
    assert(p.amount > 0, "Valores de pagamento devem ser positivos.");
    let change = 0;
    let intent: Doc | null = null;
    let voucher: Doc | null = null;
    let term: Doc | null = null;
    let status = "confirmed";
    let manual = true;
    switch (method.kind) {
      case "cash": {
        const received = p.received ?? p.amount;
        assert(received >= p.amount, "Valor recebido em dinheiro menor que o aplicado.");
        change = received - p.amount;
        assert(cashAcc, "Filial sem conta financeira do tipo Caixa. Cadastre em Financeiro → Contas.");
        break;
      }
      case "pix": {
        if (p.intentId) {
          intent = await ctx.store.getOrThrow("payment_intents", p.intentId);
          assert(intent.status === "confirmed", "Pix ainda não confirmado pelo provedor. Aguarde a confirmação ou consulte novamente.", "pix_pending");
          assert(intent.amount === p.amount, "Valor do Pix confirmado difere do aplicado.");
          assert(!intent.saleId || intent.saleId === saleId, "Este Pix já foi usado em outra venda.");
          manual = false;
        } else {
          assert(p.reference?.trim(), "Pix manual: informe o identificador (E2E/ID) do comprovante.");
        }
        assert(method.accountId, `Meio ${method.name} sem conta financeira de destino.`);
        break;
      }
      case "debit":
      case "credit": {
        manual = !p.intentId;
        break;
      }
      case "store_credit": {
        assert(p.voucherCode, "Informe o código do vale-crédito.");
        const res = await ctx.store.list("credit_vouchers", { filters: [["eq", "code", p.voucherCode!.trim().toUpperCase()], ["eq", "companyId", ctx.companyId]], limit: 1 });
        voucher = res.items[0] ?? null;
        assert(voucher && voucher.status === "active", "Vale-crédito não encontrado ou inativo.");
        assert(voucher.balance >= p.amount, `Saldo do vale insuficiente (${formatMoney(voucher.balance)}).`);
        if (voucher.expiresAt) assert(voucher.expiresAt >= today(), "Vale-crédito vencido.");
        break;
      }
      case "crediario":
      case "boleto": {
        assert(customer, "Venda a prazo exige cliente identificado.");
        term = p.paymentTermId ? await ctx.store.getOrThrow("payment_terms", p.paymentTermId) : null;
        if (method.kind === "crediario") {
          const limit = customer!.creditLimit ?? 0;
          assert(limit > 0, "Cliente sem limite de crédito definido no cadastro. O crediário não é concedido automaticamente.", "no_credit");
          const open = await listAll(ctx.store, "installments", { filters: [["eq", "partyId", customer!.id], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
          const used = open.reduce((a, i) => a + i.balance, 0);
          assert(used + p.amount <= limit, `Limite de crédito insuficiente: limite ${formatMoney(limit)}, em aberto ${formatMoney(used)}.`, "credit_limit");
        }
        break;
      }
      default:
        assert(method.accountId, `Meio ${method.name} sem conta financeira de destino.`);
    }
    pays.push({ ...p, method, change, intent, voucher, term, status, manual });
  }

  const number = await nextNumber(ctx.store, `sale:${ctx.companyId}`);
  const completedAt = input.occurredAt ?? nowIso();
  const operationId = saleId;
  const date = toLocalDate(completedAt);
  const customerSnapshot = customer
    ? { id: customer.id, name: customer.name, doc: customer.doc, personType: customer.personType, email: customer.email, phone: customer.mobile ?? customer.phone, address: customer.addresses?.[0] ?? null, ie: customer.ie ?? null }
    : null;
  const costTotal = lines.reduce((a, l) => {
    if (l.product.type === "service") return a;
    const unitCost = prep.avail.get(l.sku.id)?.avgCost ?? l.sku.costTotal ?? 0;
    return a + roundDiv(unitCost * l.input.qty, QTY);
  }, 0);
  const deferred = pays.some((p) => DEFERRED_KINDS.includes(p.method.kind));
  const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };

  await retryOnConflict(async () => {
    if (await ctx.store.get("sales", saleId)) return; // outra requisição concluiu a mesma venda
    await ctx.store.transaction(async (t) => {
      const cache = new Map<string, Doc>();
      await t.create(
        "sales",
        {
          ...base,
          number,
          terminalId: terminal.id,
          cashSessionId: session!.id,
          operatorId: ctx.user.id,
          sellerId: input.sellerId ?? null,
          customerId: customer?.id ?? null,
          customerSnapshot,
          origin: input.exchangeReturnId ? "exchange" : "pdv",
          status: "completed",
          paymentStatus: deferred ? "pending" : "paid",
          fiscalStatus: input.emitFiscal === false ? "not_required" : "pending",
          priceTableId: prep.priceTableId,
          itemsCount: lines.length,
          subtotal: calc.subtotal,
          discountTotal: calc.discountTotal,
          surchargeTotal: calc.surchargeTotal,
          total: calc.total,
          costTotal,
          paidTotal: pays.filter((p) => !DEFERRED_KINDS.includes(p.method.kind)).reduce((a, p) => a + p.amount, 0),
          changeAmount: pays.reduce((a, p) => a + p.change, 0),
          returnedTotal: 0,
          returnedCost: 0,
          idemKey: input.idemKey,
          cartId: input.cartId ?? null,
          exchangeReturnId: input.exchangeReturnId ?? null,
          completedAt,
          notes: input.notes ?? null,
          operationId,
          effectsStatus: "pending",
        },
        saleId,
      );
      for (const [idx, l] of lines.entries()) {
        const it = calc.items[idx];
        const unitCost = l.product.type === "service" ? 0 : (prep.avail.get(l.sku.id)?.avgCost ?? l.sku.costTotal ?? 0);
        await t.create(
          "sale_items",
          {
            ...base,
            saleId,
            seq: idx + 1,
            skuId: l.sku.id,
            productId: l.product.id,
            sku: l.sku.sku,
            description: l.sku.name ?? l.product.name,
            unitCode: l.sku.unitCode ?? l.product.unitCode,
            qty: l.input.qty,
            unitPrice: l.unitPrice,
            grossTotal: it.grossTotal,
            itemDiscount: it.itemDiscount,
            globalDiscount: it.globalDiscount,
            surcharge: it.surcharge,
            total: it.total,
            unitCost,
            costTotal: roundDiv(unitCost * l.input.qty, QTY),
            returnedQty: 0,
            warehouseId: l.product.type === "service" ? null : warehouse.id,
            ncm: l.product.ncm ?? null,
            cfop: l.product.cfop ?? null,
            categoryId: l.product.categoryId ?? null,
            completedAt,
          },
          detId("saleitem", saleId, idx + 1),
        );
      }
      // Título a prazo (cliente) — um por venda, parcelas conforme condição
      const deferredPays = pays.filter((p) => DEFERRED_KINDS.includes(p.method.kind));
      let deferredTitleId: string | null = null;
      if (deferredPays.length) {
        const installments = deferredPays.flatMap((p) =>
          buildSchedule(p.amount, p.term ? { installments: p.installments ?? p.term.installments, firstDueDays: p.term.firstDueDays, intervalDays: p.term.intervalDays } : { installments: p.installments ?? 1, firstDueDays: 30, intervalDays: 30 }, date).map((i) => ({ ...i, methodKind: p.method.kind })),
        );
        const title = await createTitle(
          ctx,
          {
            kind: "receivable", partyType: "customer", partyId: customer!.id, partyName: customer!.name, description: `Venda nº ${number}`, documentNumber: String(number),
            originType: "sale", originId: saleId, operationId, issueDate: date, competenceDate: date, installments, idemKey: `sale:${saleId}:deferred`, branchId,
          },
          t,
        );
        deferredTitleId = title.id;
      }
      for (const [i, p] of pays.entries()) {
        const kind = p.method.kind;
        const payId = detId("salepay", saleId, i + 1);
        let titleIdForPay: string | null = DEFERRED_KINDS.includes(kind) ? deferredTitleId : null;
        let fee = 0;
        let settlementDate: string | null = null;
        if (kind === "cash") {
          await t.create("cash_movements", {
            ...base, sessionId: session!.id, number: 0, type: "sale", method: "cash", amount: p.amount, reason: `Venda nº ${number}`, saleId, occurredAt: completedAt, idemKey: `sale:${saleId}:${i + 1}`,
          }, detId("cashmov", `sale:${saleId}:${i + 1}`));
          await postEntry(ctx, t, { accountId: cashAcc!.id, date, amount: p.amount, kind: "receipt", description: `Venda nº ${number} — dinheiro`, operationId, originType: "sale_payment", originId: payId, idemKey: `salepay:${saleId}:${i + 1}`, branchId }, cache);
        } else if (kind === "pix" || kind === "other" || kind === "voucher") {
          await postEntry(ctx, t, { accountId: p.method.accountId, date, amount: p.amount, kind: "receipt", description: `Venda nº ${number} — ${p.method.name}`, operationId, originType: "sale_payment", originId: payId, idemKey: `salepay:${saleId}:${i + 1}`, branchId }, cache);
          if (p.intent) await t.update("payment_intents", p.intent.id, { saleId });
        } else if (kind === "debit" || kind === "credit") {
          // Recebível contra a adquirente: venda bruta ≠ recebível ≠ taxa ≠ liquidação
          fee = pct(p.amount, p.method.feeBps ?? 0);
          const n = kind === "credit" ? Math.max(1, p.installments ?? 1) : 1;
          const firstDays = p.method.settlementDays ?? (kind === "debit" ? 1 : 30);
          const parts = buildSchedule(p.amount, { installments: n, firstDueDays: 0, intervalDays: 30 }, addDays(date, firstDays)).map((x, k) => ({ ...x, dueDate: k === 0 ? addDays(date, firstDays) : addMonths(addDays(date, firstDays), k), methodKind: kind }));
          settlementDate = parts[0].dueDate;
          const title = await createTitle(
            ctx,
            {
              kind: "receivable", partyType: "other", partyName: `Adquirente — ${p.method.name}`, description: `Recebível de cartão — venda nº ${number}`, documentNumber: p.nsu ?? null,
              originType: "sale_card", originId: saleId, operationId, issueDate: date, competenceDate: date, installments: parts, idemKey: `sale:${saleId}:card:${i + 1}`, branchId,
              notes: `NSU ${p.nsu ?? "—"} · Aut. ${p.authCode ?? "—"} · Taxa prevista ${formatMoney(fee)}`,
            },
            t,
          );
          titleIdForPay = title.id;
        } else if (kind === "store_credit") {
          const v = p.voucher!;
          await t.increment("credit_vouchers", v.id, "balance", -p.amount, { min: 0 });
          await t.create("credit_voucher_moves", { ...base, voucherId: v.id, seq: 0, kind: "use", amount: -p.amount, balanceAfter: v.balance - p.amount, saleId, idemKey: `sale:${saleId}:${i + 1}` }, detId("vmove", `sale:${saleId}:${i + 1}`));
          if (v.balance - p.amount === 0) await t.update("credit_vouchers", v.id, { status: "used" });
        }
        await t.create(
          "sale_payments",
          {
            ...base, saleId, seq: i + 1, methodId: p.method.id, methodKind: kind, methodName: p.method.name, amount: p.amount, received: kind === "cash" ? (p.received ?? p.amount) : p.amount,
            change: p.change, installments: p.installments ?? (p.term?.installments ?? 1), paymentTermId: p.term?.id ?? null, status: DEFERRED_KINDS.includes(kind) ? "pending" : "confirmed",
            provider: p.intent?.provider ?? null, providerRef: p.intent?.reference ?? p.reference ?? null, intentId: p.intent?.id ?? null, nsu: p.nsu ?? null, authCode: p.authCode ?? null,
            cardBrand: p.cardBrand ?? null, feeAmount: fee, netAmount: p.amount - fee, settlementDate, confirmedAt: DEFERRED_KINDS.includes(kind) ? null : completedAt, manual: p.manual,
            voucherId: p.voucher?.id ?? null, titleId: titleIdForPay,
          },
          payId,
        );
      }
    });
  });

  // Efeitos de estoque e fiscais: tarefa durável garante conclusão mesmo após falha
  await enqueue(ctx.store, { type: "sale.effects", payload: { saleId, branchId, emitFiscal: input.emitFiscal !== false, userId: ctx.user.id }, dedupeKey: `sale-effects:${saleId}`, companyId: ctx.companyId });
  await applySaleEffects(ctx, saleId, input.emitFiscal !== false);
  if (input.cartId) await ctx.store.update("carts", input.cartId, { status: "converted", saleId }).catch(() => undefined);
  await audit(ctx, {
    module: "sales", action: "sale.complete", entityType: "sale", entityId: saleId,
    summary: `Venda nº ${number} concluída — ${formatMoney(calc.total)} (${pays.map((p) => PAYMENT_KIND_LABEL[p.method.kind] ?? p.method.name).join(", ")})`,
    after: { total: calc.total, discount: calc.discountTotal, items: lines.length, warnings: prep.stockWarnings }, operationId,
    related: [customer ? `customer:${customer.id}` : "", `cash_session:${session!.id}`].filter(Boolean),
  });
  return ctx.store.getOrThrow("sales", saleId);
}

/** Lança estoque e solicita documento fiscal. Idempotente (movimentos e documento por chave). */
export async function applySaleEffects(ctx: Ctx, saleId: string, emitFiscal: boolean) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (sale.effectsStatus === "done") return sale;
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const movements: MovementInput[] = items
    .filter((i) => i.warehouseId)
    .map((i) => ({
      warehouseId: i.warehouseId, skuId: i.skuId, qty: -i.qty, type: "sale" as const, unitCost: i.unitCost, originType: "sale", originId: saleId, operationId: saleId,
      reason: `Venda nº ${sale.number}`, idemKey: `sale:${saleId}:${i.seq}`, allowNegative: true, occurredAt: sale.completedAt,
    }));
  for (let i = 0; i < movements.length; i += 40) await postMovements(ctx, movements.slice(i, i + 40));
  if (emitFiscal && sale.fiscalStatus === "pending") {
    const { createNfceForSale } = await import("./fiscal/service");
    try {
      await createNfceForSale(ctx, saleId);
    } catch (e: any) {
      await ctx.store.update("sales", saleId, { fiscalStatus: "error" });
      await audit(ctx, { module: "fiscal", action: "nfce.prepare", entityType: "sale", entityId: saleId, summary: `Falha ao preparar NFC-e: ${e.message}`, result: "failure" });
    }
  }
  await ctx.store.update("sales", saleId, { effectsStatus: "done" });
  await checkStockMinimum(ctx, sale.branchId, items.map((i) => i.skuId));
  return ctx.store.getOrThrow("sales", saleId);
}

registerJob("sale.effects", async (ctx, payload) => {
  const sale = await ctx.store.get("sales", payload.saleId);
  if (!sale) return { skipped: "sale not found" };
  ctx.branchId = sale.branchId;
  await applySaleEffects(ctx, payload.saleId, payload.emitFiscal);
  return { ok: true };
});

/** Notifica estoque abaixo do mínimo (ocorrência por SKU/filial). */
export async function checkStockMinimum(ctx: Ctx, branchId: string, skuIds: string[]) {
  const enabled = await getSetting(ctx.store, ctx.companyId, branchId, "notifications.stockMin", true);
  if (!enabled) return;
  const map = await availableMap(ctx.store, branchId, [...new Set(skuIds)]);
  const { resolveOccurrence } = await import("@/lib/core/notify");
  for (const skuId of new Set(skuIds)) {
    const bals = await listAll(ctx.store, "stock_balances", { filters: [["eq", "skuId", skuId], ["eq", "branchId", branchId]] });
    const min = bals.reduce((a, b) => a + (b.minQty ?? 0), 0);
    if (!min) continue;
    const avail = map.get(skuId)?.available ?? 0;
    const occ = `stockmin:${branchId}:${skuId}`;
    if (avail <= min) {
      const sku = await ctx.store.get("skus", skuId);
      await notify(ctx.store, {
        companyId: ctx.companyId, branchId, type: "stock_min", priority: avail <= 0 ? "high" : "normal",
        title: `Estoque mínimo: ${sku?.name ?? sku?.sku}`, body: `Disponível ${avail / QTY} ≤ mínimo ${min / QTY}. Avalie a reposição.`,
        link: `/compras/reposicao?sku=${skuId}`, originType: "sku", originId: skuId, occurrenceKey: occ, audience: { module: "purchases" },
      });
    } else {
      await resolveOccurrence(ctx.store, occ);
    }
  }
}

// ───────────────────────────── Cancelamento

export async function cancelSale(ctx: Ctx, saleId: string, reason: string) {
  requireAction(ctx, "sale.cancel");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  const sale = await ctx.store.getOrThrow("sales", saleId);
  assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
  if (sale.status === "cancelled") return sale;
  assert(sale.status === "completed", "Somente vendas concluídas podem ser canceladas.");
  assert((sale.returnedTotal ?? 0) === 0, "Venda com devoluções registradas não pode ser cancelada integralmente; use devolução dos itens restantes.");
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]] });
  const payments = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]] });
  // Títulos com baixas impedem cancelamento automático
  const titles = await listAll(ctx.store, "titles", { filters: [["eq", "originId", saleId], ["eq", "originType", ["sale", "sale_card"]]] });
  for (const tt of titles) {
    const st = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", tt.id], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
    if (st.length) throw new BusinessError(`O título nº ${tt.number} já possui baixa. Estorne a baixa (Financeiro) antes de cancelar a venda.`, "has_settlements");
  }
  const session = await currentSession(ctx, sale.terminalId);
  const cashAcc = await cashAccountFor(ctx, sale.branchId);
  const date = today();
  await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      const cache = new Map<string, Doc>();
      for (const p of payments) {
        const payId = p.id;
        if (p.methodKind === "cash") {
          if (session) {
            await t.create("cash_movements", { companyId: ctx.companyId, branchId: sale.branchId, createdBy: ctx.user.id, sessionId: session.id, number: 0, type: "refund", method: "cash", amount: -p.amount, reason: `Cancelamento venda nº ${sale.number}`, saleId, occurredAt: nowIso(), idemKey: `cancel:${saleId}:${p.seq}` }, detId("cashmov", `cancel:${saleId}:${p.seq}`));
          }
          if (cashAcc) await postEntry(ctx, t, { accountId: cashAcc.id, date, amount: -p.amount, kind: "reversal", description: `Cancelamento venda nº ${sale.number} — dinheiro`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${payId}`, branchId: sale.branchId }, cache);
        } else if (["pix", "other", "voucher"].includes(p.methodKind)) {
          const m = await ctx.store.get("payment_methods", p.methodId);
          if (m?.accountId) await postEntry(ctx, t, { accountId: m.accountId, date, amount: -p.amount, kind: "reversal", description: `Devolução ${p.methodName} — cancelamento venda nº ${sale.number}`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${payId}`, branchId: sale.branchId }, cache);
        } else if (p.methodKind === "store_credit" && p.voucherId) {
          await t.increment("credit_vouchers", p.voucherId, "balance", p.amount);
          await t.update("credit_vouchers", p.voucherId, { status: "active" });
          await t.create("credit_voucher_moves", { companyId: ctx.companyId, branchId: sale.branchId, createdBy: ctx.user.id, voucherId: p.voucherId, seq: 0, kind: "reverse", amount: p.amount, balanceAfter: 0, saleId, idemKey: `cancel:${saleId}:${p.seq}` }, detId("vmove", `cancel:${saleId}:${p.seq}`));
        }
        await t.update("sale_payments", p.id, { status: p.methodKind === "debit" || p.methodKind === "credit" ? "cancelled" : "refunded" });
      }
      await t.update("sales", saleId, { status: "cancelled", paymentStatus: "refunded", cancelledAt: nowIso(), cancelReason: reason, cancelledBy: ctx.user.id });
    }),
  );
  for (const tt of titles) await cancelTitle(ctx, tt.id, `Cancelamento da venda nº ${sale.number}: ${reason}`);
  await postMovements(
    ctx,
    items.filter((i) => i.warehouseId).map((i) => ({ warehouseId: i.warehouseId, skuId: i.skuId, qty: i.qty, type: "sale_cancel" as const, unitCost: i.unitCost, originType: "sale_cancel", originId: saleId, operationId: saleId, reason: `Cancelamento venda nº ${sale.number}`, idemKey: `sale-cancel:${saleId}:${i.seq}` })),
  );
  const { requestCancelForOrigin } = await import("./fiscal/service");
  await requestCancelForOrigin(ctx, "sale", saleId, `Cancelamento da venda: ${reason}`).catch(async (e) => {
    await audit(ctx, { module: "fiscal", action: "cancel.request", entityType: "sale", entityId: saleId, summary: `Cancelamento fiscal pendente: ${e.message}`, result: "failure" });
  });
  await audit(ctx, { module: "sales", action: "sale.cancel", entityType: "sale", entityId: saleId, summary: `Venda nº ${sale.number} cancelada. Cartões: estornar na maquininha/TEF quando aplicável.`, reason, related: titles.map((t) => `title:${t.id}`) });
  return ctx.store.getOrThrow("sales", saleId);
}

// ───────────────────────────── Devoluções e trocas

export interface ReturnInput {
  saleId: string;
  idemKey: string;
  reason: string;
  items: Array<{ saleItemId: string; qty: number; condition: "resellable" | "damaged" }>;
  compensation: "store_credit" | "refund" | "exchange";
  refundMethod?: "cash" | "pix" | "card_reversal" | "account";
  refundAccountId?: string | null;
  notes?: string;
}

/** Itens com quantidade ainda devolvível. */
export async function returnableItems(store: Store, saleId: string) {
  const items = await listAll(store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  return items.map((i) => ({ ...i, returnable: i.qty - (i.returnedQty ?? 0), unitNet: roundDiv(i.total * QTY, i.qty) }));
}

export async function processReturn(ctx: Ctx, input: ReturnInput) {
  requireAction(ctx, "sale.return");
  const returnId = detId("return", input.idemKey);
  const existing = await ctx.store.get("returns", returnId);
  if (existing) return existing;
  assert(input.reason?.trim(), "Informe o motivo da devolução.");
  const sale = await ctx.store.getOrThrow("sales", input.saleId);
  assert(sale.status === "completed", "Somente vendas concluídas aceitam devolução.");
  const branchId = requireBranch(ctx);
  const items = await returnableItems(ctx.store, sale.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = input.items.filter((i) => i.qty > 0).map((i) => {
    const it = byId.get(i.saleItemId);
    assert(it, "Item não pertence à venda.");
    assert(i.qty <= it.returnable, `Quantidade devolvida de ${it.sku} (${i.qty / QTY}) excede o restante devolvível (${it.returnable / QTY}).`, "over_return");
    // valor proporcional ao líquido pago no item (centavos exatos na devolução total)
    const total = i.qty === it.qty - (it.returnedQty ?? 0) && (it.returnedQty ?? 0) === 0 ? it.total : roundDiv(it.total * i.qty, it.qty);
    return { ...i, item: it, total, unitCost: it.unitCost, costTotal: roundDiv(it.unitCost * i.qty, QTY) };
  });
  assert(lines.length > 0, "Selecione ao menos um item e quantidade.");
  const itemsTotal = lines.reduce((a, l) => a + l.total, 0);
  const costTotal = lines.reduce((a, l) => a + l.costTotal, 0);
  if (input.compensation === "refund") assert(input.refundMethod, "Informe como o valor será devolvido.");
  if (input.compensation !== "refund") assert(sale.customerId || input.compensation === "exchange", "Vale-crédito exige cliente identificado na venda (identifique o cliente ou use troca imediata).");
  const number = await nextNumber(ctx.store, `return:${ctx.companyId}`);
  const available = await defaultWarehouse(ctx.store, branchId);
  const damaged = lines.some((l) => l.condition === "damaged") ? await damageWarehouse(ctx, branchId) : null;
  const session = sale.terminalId ? await currentSession(ctx, sale.terminalId) : null;
  const cashAcc = await cashAccountFor(ctx, branchId);
  const date = today();
  let voucherId: string | null = null;
  const status = input.compensation === "refund" && input.refundMethod === "card_reversal" ? "processing" : "completed";

  await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };
      for (const l of lines) {
        // limite atômico: devolvido acumulado ≤ vendido (concorrência segura)
        await t.increment("sale_items", l.item.id, "returnedQty", l.qty, { max: l.item.qty });
        await t.create("return_items", { ...base, returnId, saleId: sale.id, saleItemId: l.item.id, skuId: l.item.skuId, qty: l.qty, condition: l.condition, warehouseId: l.condition === "damaged" ? damaged!.id : available.id, unitPrice: l.item.unitPrice, total: l.total, unitCost: l.unitCost, costTotal: l.costTotal, completedAt: nowIso() }, detId("retitem", returnId, l.item.id));
      }
      if (input.compensation === "store_credit" || input.compensation === "exchange") {
        voucherId = detId("voucher", returnId);
        const code = `VC${String(number).padStart(6, "0")}${returnId.slice(0, 4).toUpperCase()}`;
        await t.create("credit_vouchers", { ...base, customerId: sale.customerId ?? null, code, originalAmount: itemsTotal, balance: itemsTotal, status: "active", returnId, expiresAt: addDays(date, 365), seq: 0 }, voucherId);
        await t.create("credit_voucher_moves", { ...base, voucherId, seq: 0, kind: "issue", amount: itemsTotal, balanceAfter: itemsTotal, returnId, idemKey: `issue:${returnId}` }, detId("vmove", `issue:${returnId}`));
      } else if (input.refundMethod === "cash") {
        assert(cashAcc, "Filial sem conta Caixa.");
        if (session) await t.create("cash_movements", { ...base, sessionId: session.id, number: 0, type: "refund", method: "cash", amount: -itemsTotal, reason: `Devolução nº ${number} (venda ${sale.number})`, returnId, saleId: sale.id, occurredAt: nowIso(), idemKey: `return:${returnId}` }, detId("cashmov", `return:${returnId}`));
        await postEntry(ctx, t, { accountId: cashAcc!.id, date, amount: -itemsTotal, kind: "payment", description: `Devolução nº ${number} — venda nº ${sale.number}`, originType: "return", originId: returnId, idemKey: `return:${returnId}`, branchId });
      } else if (input.refundMethod === "pix" || input.refundMethod === "account") {
        assert(input.refundAccountId, "Informe a conta de onde sai a devolução.");
        await postEntry(ctx, t, { accountId: input.refundAccountId!, date, amount: -itemsTotal, kind: "payment", description: `Devolução nº ${number} — venda nº ${sale.number}`, originType: "return", originId: returnId, idemKey: `return:${returnId}`, branchId });
      }
      await t.create(
        "returns",
        {
          ...base, number, saleId: sale.id, customerId: sale.customerId ?? null, kind: input.compensation === "exchange" ? "exchange" : "return", status, reason: input.reason,
          compensation: input.compensation, itemsTotal, costTotal, refundMethod: input.refundMethod ?? null, refundAccountId: input.refundAccountId ?? null,
          creditVoucherId: voucherId, difference: 0, idemKey: input.idemKey, completedAt: status === "completed" ? nowIso() : null, notes: input.notes ?? null, cashSessionId: session?.id ?? null,
        },
        returnId,
      );
      await t.increment("sales", sale.id, "returnedTotal", itemsTotal);
      await t.increment("sales", sale.id, "returnedCost", costTotal);
    }),
  );
  // Estorno via cartão: obrigação a acompanhar até a confirmação da adquirente
  if (input.refundMethod === "card_reversal") {
    await createTitle(ctx, {
      kind: "payable", partyType: "other", partyName: "Estorno de cartão ao cliente", description: `Estorno de cartão — devolução nº ${number} (venda ${sale.number})`, originType: "return", originId: returnId,
      installments: [{ dueDate: date, amount: itemsTotal }], idemKey: `return:${returnId}:card`, approvalStatus: "approved", branchId,
    });
  }
  await postMovements(
    ctx,
    lines.map((l) => ({
      warehouseId: l.condition === "damaged" ? damaged!.id : available.id, skuId: l.item.skuId, qty: l.qty, type: l.condition === "damaged" ? ("damage_in" as const) : ("return" as const),
      unitCost: l.unitCost, originType: "return", originId: returnId, operationId: sale.id, reason: `Devolução nº ${number}: ${input.reason}`, idemKey: `return:${returnId}:${l.item.id}`,
    })),
  );
  // Documento fiscal de devolução (NF-e de entrada referenciando a NFC-e/NF-e original) — rascunho para revisão fiscal
  const { createReturnDocumentDraft } = await import("./fiscal/service");
  await createReturnDocumentDraft(ctx, returnId).catch(() => undefined);
  await audit(ctx, {
    module: "sales", action: "sale.return", entityType: "sale", entityId: sale.id,
    summary: `Devolução nº ${number} (${input.compensation === "exchange" ? "troca" : input.compensation === "store_credit" ? "vale-crédito" : "reembolso"}) — ${formatMoney(itemsTotal)}`,
    reason: input.reason, related: [`return:${returnId}`, voucherId ? `credit_voucher:${voucherId}` : ""].filter(Boolean),
  });
  return ctx.store.getOrThrow("returns", returnId);
}

/** Vincula a nova venda da troca à devolução e calcula a diferença paga/recebida. */
export async function linkExchangeSale(ctx: Ctx, returnId: string, saleId: string) {
  const ret = await ctx.store.getOrThrow("returns", returnId);
  const sale = await ctx.store.getOrThrow("sales", saleId);
  return ctx.store.update("returns", returnId, { exchangeSaleId: saleId, difference: sale.total - ret.itemsTotal });
}

/** Liquidação de recebíveis de cartão: baixa o título da adquirente com taxa na conta bancária. */
export async function settleCardReceivable(ctx: Ctx, input: { installmentId: string; accountId: string; date: string; grossAmount?: number; fee: number; reference?: string }) {
  const inst = await ctx.store.getOrThrow("installments", input.installmentId);
  const { settleInstallment } = await import("./finance");
  return settleInstallment(ctx, {
    installmentId: inst.id, date: input.date, principal: input.grossAmount ?? inst.balance, fee: input.fee, accountId: input.accountId, methodKind: "card_settlement",
    reference: input.reference ?? null, idemKey: `cardsettle:${inst.id}:${inst.seq + 1}`,
  });
}

export { reverseSettlement };
