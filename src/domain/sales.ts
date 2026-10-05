import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
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
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";
import type { CtxUser } from "@/lib/core/ctx";

/**
 * Vendas (Telas 4–11).
 * Estados independentes: comercial (status), pagamento (paymentStatus) e fiscal (fiscalStatus).
 * A conclusão é idempotente pela chave do atendimento: repetir a confirmação devolve a mesma venda.
 */

export interface SaleItemInput {
  skuId: string;
  qty: number;
  itemDiscount?: number;
  /** acréscimo do item em centavos */
  itemSurcharge?: number;
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
  /** CPF/CNPJ na nota para consumidor não cadastrado (opcional) */
  cpfOnInvoice?: string | null;
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
  /** autorização de supervisor (login/senha) para desconto acima do limite do operador */
  discountApproval?: SupervisorCredentials | null;
  /** somente carga de demonstração/importação histórica: instante da venda */
  occurredAt?: string;
}

const MAX_ITEMS_PER_TX = 60;

export async function loadMethods(store: Store, companyId: string) {
  const methods = await listAll(store, "payment_methods", { filters: [["eq", "companyId", companyId]] });
  return new Map(methods.map((m) => [m.id, m]));
}

/** Monta e valida a venda sem gravar (usado também para prévia do pagamento). */
export async function prepareSale(ctx: Ctx, input: FinalizeSaleInput, opts: { approver?: CtxUser | null } = {}) {
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
    lines.map((l) => ({ qty: l.input.qty, unitPrice: l.unitPrice, itemDiscount: l.itemDiscount, itemSurcharge: l.input.itemSurcharge ?? 0 })),
    { globalDiscount: input.globalDiscount, globalDiscountBps: input.globalDiscountBps, surcharge: input.surcharge },
  );
  assert(calc.total > 0, "Total da venda deve ser positivo.");

  // Limites de desconto: por item (tabela) e global (perfil do usuário)
  const overLimit = !canDo(ctx.user, "sale.discount_over_limit") && !(opts.approver && canDo(opts.approver, "sale.discount_over_limit"));
  for (const [idx, l] of lines.entries()) {
    const it = calc.items[idx];
    const disc = it.itemDiscount + it.globalDiscount;
    if (l.maxDiscountBps != null && l.maxDiscountBps > 0 && it.grossTotal > 0 && roundDiv(disc * 10000, it.grossTotal) > l.maxDiscountBps && overLimit) {
      throw new BusinessError(`Desconto em ${l.sku.sku} acima do máximo da tabela (${l.maxDiscountBps / 100}%). Exige autorização de um usuário com permissão.`, "discount_limit");
    }
  }
  const discBps = calc.subtotal > 0 ? roundDiv(calc.discountTotal * 10000, calc.subtotal) : 0;
  if (overLimit && discBps > (ctx.user.discountLimitBps ?? 0)) {
    throw new BusinessError(`Desconto de ${(discBps / 100).toFixed(2).replace(".", ",")}% acima do seu limite (${((ctx.user.discountLimitBps ?? 0) / 100).toFixed(2).replace(".", ",")}%). Solicite a autorização de um usuário com permissão.`, "discount_limit");
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

  const approver = input.discountApproval ? await verifySupervisor(ctx, input.discountApproval, "sale.discount_over_limit", "desconto acima do limite") : null;
  const prep = await prepareSale(ctx, input, { approver });
  const { branchId, terminal, warehouse, lines, calc, customer } = prep;
  const session = await currentSession(ctx, terminal.id);
  assert(session, "Abra o caixa deste terminal antes de vender.", "cash_closed");
  const methods = await loadMethods(ctx.store, ctx.companyId);

  // ── Troca: a devolução de origem precisa existir e não estar vinculada a outra venda
  if (input.exchangeReturnId) {
    const ret = await ctx.store.getOrThrow("returns", input.exchangeReturnId);
    assert(ret.companyId === ctx.companyId, "Devolução de outra empresa.");
    assert(ret.kind === "exchange", "A devolução informada não é uma troca.");
    assert(!ret.exchangeSaleId || ret.exchangeSaleId === saleId, "Esta troca já foi concluída em outra venda.", "exchange_linked");
  }

  // ── Pagamentos
  assert(input.payments.length > 0, "Informe a forma de pagamento.");
  const paySum = input.payments.reduce((a, p) => a + p.amount, 0);
  assert(paySum === calc.total, `Pagamentos (${formatMoney(paySum)}) diferentes do total (${formatMoney(calc.total)}).`, "payment_mismatch");
  const cashAcc = await cashAccountFor(ctx, branchId);
  const pays: Array<SalePaymentInput & { method: Doc; change: number; intent?: Doc | null; voucher?: Doc | null; term?: Doc | null; status: string; manual: boolean }> = [];
  const usedIntents = new Set<string>();
  const voucherUse = new Map<string, number>();
  for (const p of input.payments) {
    const method = methods.get(p.methodId);
    assert(method && method.active !== false, "Meio de pagamento inválido.");
    assert(Number.isInteger(p.amount) && p.amount > 0, "Valores de pagamento devem ser positivos.");
    if (method.requiresCustomer) assert(customer, `${method.name} exige cliente identificado.`, "customer_required");
    let change = 0;
    let intent: Doc | null = null;
    let voucher: Doc | null = null;
    let term: Doc | null = null;
    const status = "confirmed";
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
          assert(!usedIntents.has(p.intentId), "A mesma cobrança Pix foi informada duas vezes.");
          usedIntents.add(p.intentId);
          intent = await ctx.store.getOrThrow("payment_intents", p.intentId);
          assert(intent.companyId === ctx.companyId, "Cobrança de outra empresa.");
          assert(intent.status === "confirmed", "Pix ainda não confirmado pelo provedor. Aguarde a confirmação ou consulte novamente.", "pix_pending");
          assert(intent.amount === p.amount, "Valor do Pix confirmado difere do aplicado.");
          assert(!intent.saleId || intent.saleId === saleId, "Este Pix já foi usado em outra venda.");
          manual = false;
        } else {
          assert(p.reference?.trim(), "Pix manual: informe o identificador (E2E/ID) do comprovante.", "pix_reference");
        }
        assert(method.accountId, `Meio ${method.name} sem conta financeira de destino.`);
        break;
      }
      case "debit":
      case "credit": {
        manual = !p.intentId;
        // sem TEF: o pagamento é registrado manualmente com NSU/autorização da maquininha
        if (manual) assert(p.nsu?.trim() || p.authCode?.trim(), `${method.name}: informe o NSU ou o código de autorização do comprovante da maquininha.`, "card_reference");
        if (method.kind === "credit") {
          const n = p.installments ?? 1;
          assert(n >= 1 && n <= Math.max(1, method.maxInstallments ?? 1), `${method.name}: máximo de ${Math.max(1, method.maxInstallments ?? 1)} parcela(s).`);
        }
        break;
      }
      case "store_credit": {
        assert(p.voucherCode, "Informe o código do vale-crédito.");
        const res = await ctx.store.list("credit_vouchers", { filters: [["eq", "code", p.voucherCode!.trim().toUpperCase()], ["eq", "companyId", ctx.companyId]], limit: 1 });
        voucher = res.items[0] ?? null;
        assert(voucher && voucher.status === "active", "Vale-crédito não encontrado ou inativo.");
        const used = (voucherUse.get(voucher.id) ?? 0) + p.amount;
        voucherUse.set(voucher.id, used);
        assert(voucher.balance >= used, `Saldo do vale insuficiente (${formatMoney(voucher.balance)}).`);
        if (voucher.expiresAt) assert(voucher.expiresAt >= today(), "Vale-crédito vencido.");
        if (voucher.customerId && customer) assert(voucher.customerId === customer.id, "Vale-crédito emitido para outro cliente.");
        break;
      }
      case "crediario":
      case "boleto": {
        assert(customer, "Venda a prazo exige cliente identificado.", "customer_required");
        term = p.paymentTermId ? await ctx.store.getOrThrow("payment_terms", p.paymentTermId) : null;
        if (method.kind === "crediario") {
          const limit = customer!.creditLimit ?? 0;
          assert(limit > 0, "Cliente sem limite de crédito definido no cadastro. O crediário não é concedido automaticamente.", "no_credit");
          const open = await listAll(ctx.store, "installments", { filters: [["eq", "partyId", customer!.id], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
          const usedCredit = open.reduce((a, i) => a + i.balance, 0);
          const thisSale = pays.filter((x) => x.method.kind === "crediario").reduce((a, x) => a + x.amount, 0);
          assert(usedCredit + thisSale + p.amount <= limit, `Limite de crédito insuficiente: limite ${formatMoney(limit)}, em aberto ${formatMoney(usedCredit)}.`, "credit_limit");
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
  const cpf = input.cpfOnInvoice ? input.cpfOnInvoice.replace(/\D/g, "") : "";
  if (cpf) assert(cpf.length === 11 || cpf.length === 14, "CPF/CNPJ na nota inválido (11 ou 14 dígitos).");
  const customerSnapshot = customer
    ? { id: customer.id, name: customer.name, doc: cpf || customer.doc, personType: customer.personType, email: customer.email, phone: customer.mobile ?? customer.phone, address: customer.addresses?.[0] ?? null, ie: customer.ie ?? null }
    : cpf
      ? { id: null, name: "Consumidor final", doc: cpf, personType: cpf.length === 14 ? "PJ" : "PF", email: null, phone: null, address: null, ie: null, cpfOnly: true }
      : null;
  const costTotal = lines.reduce((a, l) => {
    if (l.product.type === "service") return a;
    const unitCost = prep.avail.get(l.sku.id)?.avgCost ?? l.sku.costTotal ?? 0;
    return a + roundDiv(unitCost * l.input.qty, QTY);
  }, 0);
  const deferred = pays.some((p) => DEFERRED_KINDS.includes(p.method.kind));
  const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };
  let created = false;

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
          discountApprovedBy: approver?.id ?? null,
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
      const dueDatesByPay = new Map<number, Array<{ dueDate: string; amount: number }>>();
      if (deferredPays.length) {
        const installments = deferredPays.flatMap((p) => {
          const sched = buildSchedule(p.amount, p.term ? { installments: p.installments ?? p.term.installments, firstDueDays: p.term.firstDueDays, intervalDays: p.term.intervalDays } : { installments: p.installments ?? 1, firstDueDays: 30, intervalDays: 30 }, date);
          dueDatesByPay.set(pays.indexOf(p), sched);
          return sched.map((i) => ({ ...i, methodKind: p.method.kind }));
        });
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
        let dueDates: Array<{ dueDate: string; amount: number }> | null = dueDatesByPay.get(i) ?? null;
        if (kind === "cash") {
          await t.create("cash_movements", {
            ...base, sessionId: session!.id, number: 0, type: "sale", method: "cash", amount: p.amount, reason: `Venda nº ${number}`, saleId, occurredAt: completedAt, idemKey: `sale:${saleId}:${i + 1}`, sessionVersion: session!.version ?? 1,
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
          dueDates = parts.map((x) => ({ dueDate: x.dueDate, amount: x.amount }));
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
          const after = await t.increment("credit_vouchers", v.id, "balance", -p.amount, { min: 0 }).catch((e) => {
            if (isConflict(e) && e.reason === "bounds") throw new BusinessError(`Saldo do vale ${v.code} insuficiente (consumido por outra operação).`, "voucher_balance");
            throw e;
          });
          const balanceAfter = ctx.store.backend === "appwrite" ? v.balance - p.amount : after.balance;
          await t.create("credit_voucher_moves", { ...base, voucherId: v.id, seq: 0, kind: "use", amount: -p.amount, balanceAfter, saleId, idemKey: `sale:${saleId}:${i + 1}` }, detId("vmove", `sale:${saleId}:${i + 1}`));
          if (balanceAfter === 0) await t.update("credit_vouchers", v.id, { status: "used" });
        }
        await t.create(
          "sale_payments",
          {
            ...base, saleId, seq: i + 1, methodId: p.method.id, methodKind: kind, methodName: p.method.name, amount: p.amount, received: kind === "cash" ? (p.received ?? p.amount) : p.amount,
            change: p.change, installments: p.installments ?? (p.term?.installments ?? 1), paymentTermId: p.term?.id ?? null, status: DEFERRED_KINDS.includes(kind) ? "pending" : "confirmed",
            provider: p.intent?.provider ?? null, providerRef: p.intent?.reference ?? p.reference ?? null, intentId: p.intent?.id ?? null, nsu: p.nsu ?? null, authCode: p.authCode ?? null,
            cardBrand: p.cardBrand ?? null, feeAmount: fee, netAmount: p.amount - fee, settlementDate, confirmedAt: DEFERRED_KINDS.includes(kind) ? null : completedAt, manual: p.manual,
            voucherId: p.voucher?.id ?? null, titleId: titleIdForPay, dueDates,
          },
          payId,
        );
      }
      created = true;
    });
  });

  // Efeitos de estoque e fiscais: tarefa durável garante conclusão mesmo após falha
  await enqueue(ctx.store, { type: "sale.effects", payload: { saleId, branchId, emitFiscal: input.emitFiscal !== false, userId: ctx.user.id }, dedupeKey: `sale-effects:${saleId}`, companyId: ctx.companyId });
  await applySaleEffects(ctx, saleId, input.emitFiscal !== false);
  if (input.cartId) await ctx.store.update("carts", input.cartId, { status: "converted", saleId, payments: [] }).catch(() => undefined);
  if (input.exchangeReturnId) await linkExchangeSale(ctx, input.exchangeReturnId, saleId);
  if (created) {
    await audit(ctx, {
      module: "sales", action: "sale.complete", entityType: "sale", entityId: saleId,
      summary: `Venda nº ${number} concluída — ${formatMoney(calc.total)} (${pays.map((p) => PAYMENT_KIND_LABEL[p.method.kind] ?? p.method.name).join(", ")})`,
      after: { total: calc.total, discount: calc.discountTotal, items: lines.length, warnings: prep.stockWarnings, discountApprovedBy: approver?.name ?? null }, operationId,
      related: [customer ? `customer:${customer.id}` : "", `cash_session:${session!.id}`, input.exchangeReturnId ? `return:${input.exchangeReturnId}` : "", input.cartId ? `cart:${input.cartId}` : ""].filter(Boolean),
    });
  }
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

/**
 * Sessão de caixa onde entra/sai dinheiro de uma operação posterior à venda (cancelamento/devolução):
 * terminal informado → terminal da venda → caixa aberto do próprio operador na filial.
 */
export async function resolveCashSession(ctx: Ctx, branchId: string, terminalIds: Array<string | null | undefined>): Promise<Doc | null> {
  for (const tid of terminalIds) {
    if (!tid) continue;
    const s = await currentSession(ctx, tid);
    if (s && s.branchId === branchId) return s;
  }
  const mine = await ctx.store.list("cash_sessions", { filters: [["eq", "branchId", branchId], ["eq", "operatorId", ctx.user.id], ["eq", "status", ["open", "reopened"]]], limit: 1 });
  return mine.items[0] ?? null;
}

export async function cancelSale(ctx: Ctx, saleId: string, reason: string, opts: { terminalId?: string | null } = {}) {
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
  const hasCash = payments.some((p) => p.methodKind === "cash");
  const session = hasCash ? await resolveCashSession(ctx, sale.branchId, [opts.terminalId, sale.terminalId]) : null;
  // o dinheiro devolvido sai de uma gaveta: sem caixa aberto não há onde registrar a saída
  if (hasCash) assert(session, "Venda paga em dinheiro: abra um caixa (Caixa → Abertura) para registrar a devolução do valor ao cliente.", "cash_closed");
  const cashAcc = await cashAccountFor(ctx, sale.branchId);
  const date = today();
  let done = false;
  await retryOnConflict(async () => {
    const cur = await ctx.store.getOrThrow("sales", saleId);
    if (cur.status === "cancelled") return; // cancelamento concorrente já aplicado
    await ctx.store.transaction(async (t) => {
      const cache = new Map<string, Doc>();
      for (const p of payments) {
        const payId = p.id;
        if (p.methodKind === "cash") {
          await t.create("cash_movements", { companyId: ctx.companyId, branchId: sale.branchId, createdBy: ctx.user.id, sessionId: session!.id, number: 0, type: "refund", method: "cash", amount: -p.amount, reason: `Cancelamento venda nº ${sale.number}`, saleId, occurredAt: nowIso(), idemKey: `cancel:${saleId}:${p.seq}`, sessionVersion: session!.version ?? 1 }, detId("cashmov", `cancel:${saleId}:${p.seq}`));
          if (cashAcc) await postEntry(ctx, t, { accountId: cashAcc.id, date, amount: -p.amount, kind: "reversal", description: `Cancelamento venda nº ${sale.number} — dinheiro`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${payId}`, branchId: sale.branchId }, cache);
        } else if (["pix", "other", "voucher"].includes(p.methodKind)) {
          const m = await ctx.store.get("payment_methods", p.methodId);
          if (m?.accountId) await postEntry(ctx, t, { accountId: m.accountId, date, amount: -p.amount, kind: "reversal", description: `Devolução ${p.methodName} — cancelamento venda nº ${sale.number}`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${payId}`, branchId: sale.branchId }, cache);
        } else if (p.methodKind === "store_credit" && p.voucherId) {
          const v = await ctx.store.getOrThrow("credit_vouchers", p.voucherId);
          await t.increment("credit_vouchers", p.voucherId, "balance", p.amount);
          await t.update("credit_vouchers", p.voucherId, { status: "active" });
          await t.create("credit_voucher_moves", { companyId: ctx.companyId, branchId: sale.branchId, createdBy: ctx.user.id, voucherId: p.voucherId, seq: 0, kind: "reverse", amount: p.amount, balanceAfter: (v.balance ?? 0) + p.amount, saleId, idemKey: `cancel:${saleId}:${p.seq}` }, detId("vmove", `cancel:${saleId}:${p.seq}`));
        }
        await t.update("sale_payments", p.id, { status: p.methodKind === "debit" || p.methodKind === "credit" ? "cancelled" : "refunded" });
      }
      await t.update("sales", saleId, { status: "cancelled", paymentStatus: "refunded", cancelledAt: nowIso(), cancelReason: reason, cancelledBy: ctx.user.id });
      done = true;
    });
  });
  for (const tt of titles) await cancelTitle(ctx, tt.id, `Cancelamento da venda nº ${sale.number}: ${reason}`);
  await postMovements(
    ctx,
    items.filter((i) => i.warehouseId).map((i) => ({ warehouseId: i.warehouseId, skuId: i.skuId, qty: i.qty, type: "sale_cancel" as const, unitCost: i.unitCost, originType: "sale_cancel", originId: saleId, operationId: saleId, reason: `Cancelamento venda nº ${sale.number}`, idemKey: `sale-cancel:${saleId}:${i.seq}` })),
  );
  const { requestCancelForOrigin } = await import("./fiscal/service");
  await requestCancelForOrigin(ctx, "sale", saleId, `Cancelamento da venda: ${reason}`).catch(async (e) => {
    await audit(ctx, { module: "fiscal", action: "cancel.request", entityType: "sale", entityId: saleId, summary: `Cancelamento fiscal pendente: ${e.message}`, result: "failure" });
  });
  if (done) {
    const cards = payments.filter((p) => p.methodKind === "debit" || p.methodKind === "credit");
    await audit(ctx, {
      module: "sales", action: "sale.cancel", entityType: "sale", entityId: saleId,
      summary: `Venda nº ${sale.number} cancelada${cards.length ? " — estornar cartão na maquininha/TEF (NSU " + cards.map((c) => c.nsu ?? "—").join(", ") + ")" : ""}`,
      reason, related: [...titles.map((t) => `title:${t.id}`), session ? `cash_session:${session.id}` : ""].filter(Boolean),
    });
  }
  return ctx.store.getOrThrow("sales", saleId);
}

// ───────────────────────────── Devoluções e trocas

export interface ReturnInput {
  saleId: string;
  idemKey: string;
  reason: string;
  items: Array<{ saleItemId: string; qty: number; condition: "resellable" | "damaged"; reason?: string | null }>;
  compensation: "store_credit" | "refund" | "exchange";
  refundMethod?: "cash" | "pix" | "card_reversal" | "account";
  refundAccountId?: string | null;
  notes?: string;
  /** terminal de onde sai o dinheiro (devolução em espécie) */
  terminalId?: string | null;
}

export const COMPENSATION_LABEL: Record<string, string> = { store_credit: "Vale-crédito", refund: "Reembolso", exchange: "Troca" };
export const REFUND_METHOD_LABEL: Record<string, string> = { cash: "Dinheiro (caixa)", pix: "Pix", card_reversal: "Estorno no cartão", account: "Transferência / conta" };

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
  const itemReasons = [...new Set(input.items.filter((i) => i.qty > 0).map((i) => i.reason?.trim()).filter(Boolean))] as string[];
  const reason = input.reason?.trim() || itemReasons.join("; ");
  assert(reason, "Informe o motivo da devolução.", "reason_required");
  input = { ...input, reason };
  const sale = await ctx.store.getOrThrow("sales", input.saleId);
  assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
  assert(sale.status === "completed", "Somente vendas concluídas aceitam devolução.");
  const branchId = requireBranch(ctx);
  assert(sale.branchId === branchId, "A devolução deve ser registrada na filial da venda.");
  const items = await returnableItems(ctx.store, sale.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const previous = await listAll(ctx.store, "return_items", { filters: [["eq", "saleId", sale.id]] });
  const returnedValue = new Map<string, number>();
  for (const r of previous) returnedValue.set(r.saleItemId, (returnedValue.get(r.saleItemId) ?? 0) + r.total);
  const lines = input.items.filter((i) => i.qty > 0).map((i) => {
    const it = byId.get(i.saleItemId);
    assert(it, "Item não pertence à venda.");
    assert(Number.isInteger(i.qty), "Quantidade inválida.");
    assert(i.qty <= it.returnable, `Quantidade devolvida de ${it.sku} (${i.qty / QTY}) excede o restante devolvível (${it.returnable / QTY}).`, "over_return");
    // valor proporcional ao líquido pago no item; ao devolver o restante, fecha os centavos exatamente
    const total = i.qty === it.returnable ? it.total - (returnedValue.get(it.id) ?? 0) : roundDiv(it.total * i.qty, it.qty);
    return { ...i, item: it, total, unitCost: it.unitCost, costTotal: roundDiv(it.unitCost * i.qty, QTY) };
  });
  assert(lines.length > 0, "Selecione ao menos um item e quantidade.");
  assert(new Set(lines.map((l) => l.saleItemId)).size === lines.length, "Item repetido na devolução.");
  const itemsTotal = lines.reduce((a, l) => a + l.total, 0);
  const costTotal = lines.reduce((a, l) => a + l.costTotal, 0);
  if (input.compensation === "refund") assert(input.refundMethod, "Informe como o valor será devolvido.");
  if (input.compensation === "store_credit") assert(sale.customerId, "Vale-crédito exige cliente identificado na venda (identifique o cliente ou use troca imediata).", "customer_required");
  if (input.compensation === "refund" && (input.refundMethod === "pix" || input.refundMethod === "account")) {
    assert(input.refundAccountId, "Informe a conta de onde sai a devolução.");
    const acc = await ctx.store.getOrThrow("financial_accounts", input.refundAccountId!);
    assert(acc.companyId === ctx.companyId && acc.active !== false, "Conta financeira inválida.");
  }
  const refundCash = input.compensation === "refund" && input.refundMethod === "cash";
  const session = refundCash ? await resolveCashSession(ctx, branchId, [input.terminalId, sale.terminalId]) : null;
  if (refundCash) assert(session, "Devolução em dinheiro: abra o caixa (Caixa → Abertura) para registrar a saída do valor.", "cash_closed");
  const cashAcc = await cashAccountFor(ctx, branchId);
  if (refundCash) assert(cashAcc, "Filial sem conta Caixa.");
  const number = await nextNumber(ctx.store, `return:${ctx.companyId}`);
  const available = await defaultWarehouse(ctx.store, branchId);
  const damaged = lines.some((l) => l.condition === "damaged") ? await damageWarehouse(ctx, branchId) : null;
  const date = today();
  let voucherId: string | null = null;
  const status = input.compensation === "refund" && input.refundMethod === "card_reversal" ? "processing" : "completed";
  let created = false;

  try {
    await retryOnConflict(async () => {
      if (await ctx.store.get("returns", returnId)) return; // mesma devolução já registrada (repetição/concorrência)
      await ctx.store.transaction(async (t) => {
        const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };
        for (const l of lines) {
          // limite atômico: devolvido acumulado ≤ vendido (concorrência segura)
          await t.increment("sale_items", l.item.id, "returnedQty", l.qty, { max: l.item.qty });
          await t.create("return_items", { ...base, returnId, saleId: sale.id, saleItemId: l.item.id, skuId: l.item.skuId, qty: l.qty, condition: l.condition, warehouseId: l.condition === "damaged" ? damaged!.id : available.id, unitPrice: l.item.unitPrice, total: l.total, unitCost: l.unitCost, costTotal: l.costTotal, completedAt: nowIso(), reason: l.reason?.trim() || null }, detId("retitem", returnId, l.item.id));
        }
        if (input.compensation === "store_credit" || input.compensation === "exchange") {
          voucherId = detId("voucher", returnId);
          const code = `VC${String(number).padStart(6, "0")}${returnId.slice(0, 4).toUpperCase()}`;
          await t.create("credit_vouchers", { ...base, customerId: sale.customerId ?? null, code, originalAmount: itemsTotal, balance: itemsTotal, status: "active", returnId, expiresAt: addDays(date, 365), seq: 0 }, voucherId);
          await t.create("credit_voucher_moves", { ...base, voucherId, seq: 0, kind: "issue", amount: itemsTotal, balanceAfter: itemsTotal, returnId, idemKey: `issue:${returnId}` }, detId("vmove", `issue:${returnId}`));
        } else if (refundCash) {
          await t.create("cash_movements", { ...base, sessionId: session!.id, number: 0, type: "refund", method: "cash", amount: -itemsTotal, reason: `Devolução nº ${number} (venda ${sale.number})`, returnId, saleId: sale.id, occurredAt: nowIso(), idemKey: `return:${returnId}`, sessionVersion: session!.version ?? 1 }, detId("cashmov", `return:${returnId}`));
          await postEntry(ctx, t, { accountId: cashAcc!.id, date, amount: -itemsTotal, kind: "payment", description: `Devolução nº ${number} — venda nº ${sale.number}`, originType: "return", originId: returnId, idemKey: `return:${returnId}`, branchId });
        } else if (input.refundMethod === "pix" || input.refundMethod === "account") {
          await postEntry(ctx, t, { accountId: input.refundAccountId!, date, amount: -itemsTotal, kind: "payment", description: `Devolução nº ${number} — venda nº ${sale.number}`, originType: "return", originId: returnId, idemKey: `return:${returnId}`, branchId });
        }
        await t.create(
          "returns",
          {
            ...base, number, saleId: sale.id, customerId: sale.customerId ?? null, kind: input.compensation === "exchange" ? "exchange" : "return", status, reason: input.reason,
            compensation: input.compensation, itemsTotal, costTotal, refundMethod: input.compensation === "refund" ? (input.refundMethod ?? null) : null, refundAccountId: input.refundAccountId ?? null,
            creditVoucherId: voucherId, difference: 0, idemKey: input.idemKey, completedAt: status === "completed" ? nowIso() : null, notes: input.notes ?? null, cashSessionId: session?.id ?? null,
          },
          returnId,
        );
        await t.increment("sales", sale.id, "returnedTotal", itemsTotal);
        await t.increment("sales", sale.id, "returnedCost", costTotal);
        created = true;
      });
    });
  } catch (e) {
    if (isConflict(e) && e.reason === "bounds") {
      throw new BusinessError("Quantidade devolvida excede o restante devolvível (outra devolução desta venda foi registrada ao mesmo tempo). Atualize a página.", "over_return");
    }
    throw e;
  }
  if (!created) return ctx.store.getOrThrow("returns", returnId);
  // Estorno via cartão: obrigação a acompanhar até a confirmação da adquirente
  if (input.refundMethod === "card_reversal" && input.compensation === "refund") {
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
  await createReturnDocumentDraft(ctx, returnId).catch(async (e) => {
    await audit(ctx, { module: "fiscal", action: "return.document", entityType: "return", entityId: returnId, summary: `Documento fiscal de devolução não preparado: ${e.message}`, result: "failure" });
  });
  await audit(ctx, {
    module: "sales", action: "sale.return", entityType: "return", entityId: returnId,
    summary: `Devolução nº ${number} da venda nº ${sale.number} (${COMPENSATION_LABEL[input.compensation]}${input.compensation === "refund" && input.refundMethod ? " — " + REFUND_METHOD_LABEL[input.refundMethod] : ""}) — ${formatMoney(itemsTotal)}`,
    reason: input.reason, related: [`sale:${sale.id}`, voucherId ? `credit_voucher:${voucherId}` : "", session ? `cash_session:${session.id}` : "", sale.customerId ? `customer:${sale.customerId}` : ""].filter(Boolean),
  });
  return ctx.store.getOrThrow("returns", returnId);
}

/** Vincula a nova venda da troca à devolução e calcula a diferença paga (+) ou deixada em vale (−). */
export async function linkExchangeSale(ctx: Ctx, returnId: string, saleId: string) {
  const ret = await ctx.store.getOrThrow("returns", returnId);
  const sale = await ctx.store.getOrThrow("sales", saleId);
  assert(!ret.exchangeSaleId || ret.exchangeSaleId === saleId, "Esta troca já foi vinculada a outra venda.", "exchange_linked");
  if (ret.exchangeSaleId === saleId) return ret;
  const updated = await ctx.store.update("returns", returnId, { exchangeSaleId: saleId, difference: sale.total - ret.itemsTotal });
  await audit(ctx, {
    module: "sales", action: "exchange.link", entityType: "return", entityId: returnId,
    summary: `Troca nº ${ret.number} concluída na venda nº ${sale.number} — diferença ${sale.total - ret.itemsTotal >= 0 ? "paga pelo cliente" : "mantida em vale"} ${formatMoney(Math.abs(sale.total - ret.itemsTotal))}`,
    related: [`sale:${saleId}`, `sale:${ret.saleId}`],
  });
  return updated;
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

// ───────────────────────────── Pós-venda: situação fiscal e envio do comprovante

/**
 * Executa agora as tarefas pendentes da venda (efeitos e transmissão/consulta fiscal) em vez de aguardar o executor periódico,
 * e devolve a situação real retornada pelo provedor. Nunca presume autorização.
 */
export async function refreshSaleFiscal(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
  await import("./jobs-registry");
  const { jobsFor, runDueJobs } = await import("@/lib/core/jobs");
  if (sale.effectsStatus !== "done") {
    const jobs = await jobsFor(ctx.store, `sale-effects:${saleId}`);
    const due = jobs.filter((j) => ["pending", "retry"].includes(j.status)).map((j) => j.id);
    if (due.length) await runDueJobs(ctx.store, { jobIds: due });
    else await applySaleEffects({ ...ctx, branchId: sale.branchId }, saleId, sale.fiscalStatus !== "not_required");
  }
  const fresh = await ctx.store.getOrThrow("sales", saleId);
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", saleId]] });
  const { queryDocument } = await import("./fiscal/service");
  for (const d of docs) {
    if (d.status === "queued" || d.status === "error") {
      const jobs = [...(await jobsFor(ctx.store, `fiscal-transmit:${d.id}`)), ...(await jobsFor(ctx.store, `fiscal-query:${d.id}`))];
      const due = jobs.filter((j) => ["pending", "retry"].includes(j.status)).map((j) => j.id);
      if (due.length) {
        // reagenda para agora e executa (a reivindicação única evita execução dupla com o executor periódico)
        for (const id of due) await ctx.store.update("jobs", id, { runAt: nowIso() });
        await runDueJobs(ctx.store, { jobIds: due });
      }
    } else if (d.status === "processing") {
      await queryDocument({ ...ctx, branchId: d.branchId }, d.id);
    }
  }
  const after = await ctx.store.getOrThrow("sales", saleId);
  const doc = after.fiscalDocumentId ? await ctx.store.get("fiscal_documents", after.fiscalDocumentId) : (docs[0] ? await ctx.store.get("fiscal_documents", docs[0].id) : null);
  await audit(ctx, { module: "sales", action: "sale.fiscal_query", entityType: "sale", entityId: saleId, summary: `Situação fiscal consultada: ${doc ? doc.status : fresh.fiscalStatus}${doc?.statusMessage ? " — " + String(doc.statusMessage).slice(0, 200) : ""}` });
  return { sale: after, document: doc };
}

function esc(v: unknown) {
  return String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

/** Envia o comprovante da venda por e-mail pelo canal configurado; registra o resultado real (entregue / não configurado / falha). */
export async function sendSaleReceiptEmail(ctx: Ctx, saleId: string, to: string) {
  requirePerm(ctx, "sales", "view");
  const email = to.trim();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Informe um e-mail válido.");
  const sale = await ctx.store.getOrThrow("sales", saleId);
  assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
  const company = await ctx.store.getOrThrow("companies", sale.companyId);
  const branch = await ctx.store.get("branches", sale.branchId);
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const pays = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const doc = sale.fiscalDocumentId ? await ctx.store.get("fiscal_documents", sale.fiscalDocumentId) : null;
  const rows = items.map((i) => `<tr><td>${esc(i.description)}<br><small>${esc(i.sku)} · ${(i.qty / QTY).toLocaleString("pt-BR")} ${esc(i.unitCode)} × ${formatMoney(i.unitPrice)}</small></td><td style="text-align:right">${formatMoney(i.total)}</td></tr>`).join("");
  const payRows = pays.map((p) => `<tr><td>${esc(p.methodName)}${p.installments > 1 ? ` (${p.installments}x)` : ""}</td><td style="text-align:right">${formatMoney(p.amount)}</td></tr>`).join("");
  const fiscalLine = doc
    ? doc.status === "authorized"
      ? `NFC-e nº ${esc(doc.number)} série ${esc(doc.series)} — autorizada${doc.isSimulated ? " (SIMULAÇÃO, sem validade fiscal)" : ""}. Chave: ${esc(doc.accessKey)}`
      : `Documento fiscal: ${esc(doc.status)} — este e-mail não substitui o DANFE NFC-e.`
    : "Sem documento fiscal vinculado.";
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px">
<h2 style="margin:0">${esc(company.tradeName || company.name)}</h2><p style="margin:4px 0;color:#555">${esc(branch?.name ?? "")}</p>
<p><strong>Comprovante da venda nº ${sale.number}</strong> — ${new Date(sale.completedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
<table style="width:100%;border-collapse:collapse" cellpadding="4">${rows}
<tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${formatMoney(sale.total)}</strong></td></tr></table>
<p style="margin-top:12px"><strong>Pagamentos</strong></p><table style="width:100%" cellpadding="4">${payRows}${sale.changeAmount ? `<tr><td>Troco</td><td style="text-align:right">${formatMoney(sale.changeAmount)}</td></tr>` : ""}</table>
<p style="color:#555;font-size:12px">${fiscalLine}</p><p style="color:#999;font-size:11px">Comprovante não fiscal. ${sale.status === "cancelled" ? "VENDA CANCELADA." : ""}</p></div>`;
  const attachments: Array<{ filename: string; content: Buffer }> = [];
  if (doc?.xmlFileId && doc.status === "authorized") {
    try {
      const { readFile } = await import("@/lib/core/files");
      const f = await readFile(ctx, doc.xmlFileId);
      attachments.push({ filename: f.meta.name ?? `${doc.accessKey ?? doc.ref}.xml`, content: f.data });
    } catch {
      /* segue sem anexo */
    }
  }
  const { sendEmail } = await import("@/lib/core/email");
  const res = await sendEmail(ctx.companyId, { to: email, subject: `Comprovante da compra nº ${sale.number} — ${company.tradeName || company.name}`, html, attachments });
  await audit(ctx, {
    module: "sales", action: "sale.email", entityType: "sale", entityId: saleId,
    summary: res.delivered ? `Comprovante enviado para ${email} (${res.channel})` : `Comprovante NÃO enviado para ${email}: ${res.message ?? res.channel}`,
    result: res.delivered ? "success" : "failure",
  });
  return res;
}
