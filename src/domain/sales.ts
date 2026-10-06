import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso, today, addDays, addMonths, toLocalDate } from "@/lib/dates";
import { pct, roundDiv, QTY, formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { registerJob } from "@/lib/core/jobs";
import { getSetting } from "@/lib/core/settings";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { calcSale, DEFERRED_KINDS, PAYMENT_KIND_LABEL } from "./pricing-calc";
import { availableMap, defaultWarehouse, postMovements, damageWarehouse, type MovementInput } from "./stock";
import { buildSchedule, cancelTitle, createTitle, postEntry, refreshTitleStatus, reverseSettlement } from "./finance";
import { cashAccountFor, currentSession } from "./cash";
import { resolvePrices } from "./pricing";
import { verifySupervisor, type SupervisorCredentials } from "./supervisor";
import { refundIntentAtProvider } from "./payments/intents";
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

/** Máximo de linhas por venda (o que não cabe na transação principal é gravado pela tarefa durável de efeitos). */
export const MAX_SALE_LINES = 200;
/** Escritas por transação: o Appwrite aceita no máximo 100 — mantém folga. */
const TX_OPS_BUDGET = 95;
/** Itens por lote nos efeitos pós-venda (cada movimento de estoque grava 2 operações). */
const EFFECT_BATCH = 40;

/** Registro de tarefa durável gravado DENTRO da transação do documento principal (mesma chave de `enqueue`). */
function jobRow(ctx: Ctx, type: string, dedupeKey: string, payload: Record<string, any>) {
  return {
    id: detId("job", dedupeKey),
    data: { companyId: ctx.companyId, type, payload, status: "pending", runAt: nowIso(), attempts: 0, maxAttempts: 8, dedupeKey, createdBy: ctx.user.id },
  };
}

export async function loadMethods(store: Store, companyId: string) {
  const methods = await listAll(store, "payment_methods", { filters: [["eq", "companyId", companyId]] });
  return new Map(methods.map((m) => [m.id, m]));
}

/** Monta e valida a venda sem gravar (usado também para prévia do pagamento). */
export async function prepareSale(ctx: Ctx, input: FinalizeSaleInput, opts: { approver?: CtxUser | null } = {}) {
  const branchId = requireBranch(ctx);
  assert(input.items.length > 0, "Adicione ao menos um item.");
  assert(input.items.length <= MAX_SALE_LINES, `Venda com mais de ${MAX_SALE_LINES} linhas: divida o atendimento.`);
  const terminal = await ctx.store.getOrThrow("terminals", input.terminalId);
  assert(terminal.branchId === branchId, "Terminal de outra filial.");
  const warehouse = terminal.defaultWarehouseId ? await ctx.store.getOrThrow("warehouses", terminal.defaultWarehouseId) : await defaultWarehouse(ctx.store, branchId);
  const skuIds = [...new Set(input.items.map((i) => i.skuId))];
  const skus = new Map<string, Doc>();
  const products = new Map<string, Doc>();
  for (const id of skuIds) {
    const sku = await ctx.store.getOrThrow("skus", id);
    assert(sku.companyId === ctx.companyId, "Produto de outra empresa.");
    assert(sku.active !== false, `Variação ${sku.sku} inativa no cadastro e não pode ser vendida.`, "sku_inactive");
    skus.set(id, sku);
    if (!products.has(sku.productId)) {
      const p = await ctx.store.getOrThrow("products", sku.productId);
      assert(p.active !== false && p.status !== "inactive", `${p.name} está inativo no cadastro e não pode ser vendido.`, "product_inactive");
      assert(p.status !== "draft", `${p.name} ainda é um rascunho no cadastro (complete e ative o produto antes de vender).`, "product_draft");
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

type PreparedPay = SalePaymentInput & { method: Doc; change: number; intent?: Doc | null; voucher?: Doc | null; term?: Doc | null; status: string; manual: boolean };

/** Parcelas efetivas de um pagamento a prazo (as mesmas usadas para gerar o título). */
function deferredInstallments(p: PreparedPay) {
  return Math.max(1, p.installments ?? p.term?.installments ?? 1);
}

/** Escritas que os pagamentos geram na transação da venda (para respeitar o limite de 100 operações). */
function paymentTxOps(pays: PreparedPay[]) {
  let ops = 0;
  let deferredTitle = false;
  for (const p of pays) {
    const k = p.method.kind;
    ops += 1; // sale_payments
    if (k === "cash") ops += 3; // movimento de caixa + lançamento (2)
    else if (k === "pix" || k === "other" || k === "voucher") ops += 2 + (p.intent ? 2 : 0); // lançamento (2) + uso exclusivo da cobrança (2)
    else if (k === "debit" || k === "credit") ops += 1 + (k === "credit" ? Math.max(1, p.installments ?? 1) : 1);
    else if (k === "store_credit") ops += 3;
    else if (DEFERRED_KINDS.includes(k)) {
      ops += deferredInstallments(p);
      deferredTitle = true;
    }
  }
  return ops + (deferredTitle ? 1 : 0);
}

/** Parcelas a receber em aberto do cliente (limite de crédito). */
async function openCreditOf(ctx: Ctx, customerId: string) {
  const open = await listAll(ctx.store, "installments", { filters: [["eq", "partyId", customerId], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
  return open.reduce((a, i) => a + i.balance, 0);
}

export async function finalizeSale(ctx: Ctx, input: FinalizeSaleInput) {
  requirePerm(ctx, "pdv", "create");
  const saleId = detId("sale", input.idemKey);
  const already = await ctx.store.get("sales", saleId);
  // repetição/duplo clique → mesma venda; completa o que tenha ficado pendente depois do commit (idempotente)
  if (already) return completeSalePostCommit(ctx, already);

  const approver = input.discountApproval ? await verifySupervisor(ctx, input.discountApproval, "sale.discount_over_limit", "desconto acima do limite") : null;
  const prep = await prepareSale(ctx, input, { approver });
  if (!prep.customer && !(await getSetting(ctx.store, ctx.companyId, prep.branchId, "sales.consumerFinalAllowed", true))) {
    throw new BusinessError("Esta filial exige identificar o cliente em todas as vendas (parâmetro “consumidor final” desativado).", "customer_required");
  }
  const { branchId, terminal, warehouse, lines, calc, customer } = prep;
  const session = await currentSession(ctx, terminal.id);
  assert(session, "Abra o caixa deste terminal antes de vender.", "cash_closed");
  const methods = await loadMethods(ctx.store, ctx.companyId);

  // ── Troca: a devolução de origem precisa existir e não estar vinculada a outra venda
  let exchangeRet: Doc | null = null;
  if (input.exchangeReturnId) {
    const ret = await ctx.store.getOrThrow("returns", input.exchangeReturnId);
    assert(ret.companyId === ctx.companyId, "Devolução de outra empresa.");
    assert(ret.kind === "exchange", "A devolução informada não é uma troca.");
    assert(!ret.exchangeSaleId || ret.exchangeSaleId === saleId, "Esta troca já foi concluída em outra venda.", "exchange_linked");
    exchangeRet = ret;
  }
  // ── Atendimento: convertido na mesma transação da venda
  const cart = input.cartId ? await ctx.store.get("carts", input.cartId) : null;
  if (cart) assert(cart.companyId === ctx.companyId && cart.branchId === branchId, "Atendimento de outra filial.");

  // ── Pagamentos
  assert(input.payments.length > 0, "Informe a forma de pagamento.");
  const paySum = input.payments.reduce((a, p) => a + p.amount, 0);
  assert(paySum === calc.total, `Pagamentos (${formatMoney(paySum)}) diferentes do total (${formatMoney(calc.total)}).`, "payment_mismatch");
  const cashAcc = await cashAccountFor(ctx, branchId);
  const pays: PreparedPay[] = [];
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
          // a cobrança pertence ao atendimento em que foi gerada: não paga outro atendimento
          assert(!input.cartId || !intent.cartId || intent.cartId === input.cartId, "Esta cobrança Pix pertence a outro atendimento.", "pix_other_cart");
          assert(intent.status === "confirmed", "Pix ainda não confirmado pelo provedor. Aguarde a confirmação ou consulte novamente.", "pix_pending");
          assert(intent.amount === p.amount, "Valor do Pix confirmado difere do aplicado.");
          assert(!intent.saleId || intent.saleId === saleId, "Este Pix já foi usado em outra venda.", "pix_used");
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
          assert(Number.isInteger(n) && n >= 1 && n <= Math.max(1, method.maxInstallments ?? 1), `${method.name}: máximo de ${Math.max(1, method.maxInstallments ?? 1)} parcela(s).`);
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
        if (term) assert(term.companyId === ctx.companyId && term.active !== false, "Condição de pagamento inválida.");
        // parcelas limitadas à condição escolhida ou ao máximo do meio (não é entrada livre)
        const maxInst = Math.max(1, term?.installments ?? 0, method.maxInstallments ?? 0);
        const n = p.installments ?? term?.installments ?? 1;
        assert(Number.isInteger(n) && n >= 1 && n <= maxInst, `${method.name}: máximo de ${maxInst} parcela(s).`);
        if (method.kind === "crediario") {
          const limit = customer!.creditLimit ?? 0;
          assert(limit > 0, "Cliente sem limite de crédito definido no cadastro. O crediário não é concedido automaticamente.", "no_credit");
          const usedCredit = await openCreditOf(ctx, customer!.id);
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

  const deferredPaysAll = pays.filter((p) => DEFERRED_KINDS.includes(p.method.kind));
  const hasCrediario = pays.some((p) => p.method.kind === "crediario");
  // Limite de operações da transação: pagamentos e controles primeiro; os itens que não couberem vão para a tarefa durável
  const fixedOps = 1 /* venda */ + 1 /* tarefa */ + (cart ? 1 : 0) + (exchangeRet ? 2 : 0) + (deferredPaysAll.length ? 1 : 0) + paymentTxOps(pays);
  const room = TX_OPS_BUDGET - fixedOps;
  if (room < 1) throw new BusinessError("A combinação de formas de pagamento e parcelas excede o limite de uma operação: reduza o número de parcelas ou de formas de pagamento.", "tx_limit");

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
  const deferred = deferredPaysAll.length > 0;
  const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };
  const itemRows = lines.map((l, idx) => {
    const it = calc.items[idx];
    const unitCost = l.product.type === "service" ? 0 : (prep.avail.get(l.sku.id)?.avgCost ?? l.sku.costTotal ?? 0);
    return {
      id: detId("saleitem", saleId, idx + 1),
      data: {
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
    };
  });
  const inlineItems = itemRows.slice(0, room);
  const pendingItems = itemRows.slice(room);
  // tarefa durável gravada junto com a venda: estoque, NFC-e e os itens que excederam a transação
  const job = jobRow(ctx, "sale.effects", `sale-effects:${saleId}`, { saleId, branchId, emitFiscal: input.emitFiscal !== false, userId: ctx.user.id, pendingItems });
  const exchangeCredit = exchangeRet ? (exchangeRet.compensatedAmount ?? exchangeRet.itemsTotal) : 0;
  let created = false;

  await retryOnConflict(async () => {
    if (await ctx.store.get("sales", saleId)) return; // outra requisição concluiu a mesma venda
    // saldo de vale relido a cada tentativa (consumo concorrente do mesmo vale)
    for (const p of pays) {
      if (!p.voucher) continue;
      const fresh = await ctx.store.getOrThrow("credit_vouchers", p.voucher.id);
      const need = pays.filter((x) => x.voucher?.id === fresh.id).reduce((a, x) => a + x.amount, 0);
      if (fresh.status !== "active" || fresh.balance < need) throw new BusinessError(`Saldo do vale ${fresh.code} insuficiente (${formatMoney(fresh.balance)}): consumido por outra operação.`, "voucher_balance");
      p.voucher = fresh;
    }
    // cobrança Pix relida: uma cobrança confirmada paga uma única venda
    for (const p of pays) {
      if (!p.intent) continue;
      const fresh = await ctx.store.getOrThrow("payment_intents", p.intent.id);
      if (fresh.saleId && fresh.saleId !== saleId) throw new BusinessError("Este Pix já foi usado em outra venda.", "pix_used");
      if (fresh.status !== "confirmed") throw new BusinessError("A cobrança Pix deixou de estar confirmada no provedor. Consulte a cobrança antes de concluir.", "pix_pending");
      p.intent = fresh;
    }
    if (exchangeRet) {
      const fresh = await ctx.store.getOrThrow("returns", exchangeRet.id);
      if (fresh.exchangeSaleId && fresh.exchangeSaleId !== saleId) throw new BusinessError("Esta troca já foi concluída em outra venda.", "exchange_linked");
    }
    // Venda a prazo: trava otimista por cliente. A trava nº (títulos a receber do cliente + 1) é gravada na mesma
    // transação do novo título; duas vendas simultâneas disputam a mesma trava e a perdedora refaz a conta do limite.
    let creditLockId: string | null = null;
    if (deferred) {
      const titlesCount = (await ctx.store.list("titles", { filters: [["eq", "partyId", customer!.id], ["eq", "kind", "receivable"]], limit: 1 })).total;
      if (hasCrediario) {
        const fresh = await ctx.store.getOrThrow("customers", customer!.id);
        const limit = fresh.creditLimit ?? 0;
        const usedCredit = await openCreditOf(ctx, customer!.id);
        const thisSale = pays.filter((x) => x.method.kind === "crediario").reduce((a, x) => a + x.amount, 0);
        if (usedCredit + thisSale > limit) throw new BusinessError(`Limite de crédito insuficiente: limite ${formatMoney(limit)}, em aberto ${formatMoney(usedCredit)}.`, "credit_limit");
      }
      creditLockId = detId("credlock", customer!.id, titlesCount + 1);
    }
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
      for (const r of inlineItems) await t.create("sale_items", r.data, r.id);
      // Título a prazo (cliente) — um por venda, parcelas conforme condição
      let deferredTitleId: string | null = null;
      const dueDatesByPay = new Map<number, Array<{ dueDate: string; amount: number }>>();
      if (deferredPaysAll.length) {
        const installments = deferredPaysAll.flatMap((p) => {
          const sched = buildSchedule(p.amount, p.term ? { installments: deferredInstallments(p), firstDueDays: p.term.firstDueDays, intervalDays: p.term.intervalDays } : { installments: deferredInstallments(p), firstDueDays: 30, intervalDays: 30 }, date);
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
        await t.create("operations", { companyId: ctx.companyId, type: "credit_lock", status: "done", entityType: "customer", entityId: customer!.id, createdBy: ctx.user.id, result: { saleId } }, creditLockId!);
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
          if (p.intent) {
            // uso exclusivo: id determinístico por cobrança — uma segunda venda com o mesmo Pix falha no commit
            await t.create("operations", { companyId: ctx.companyId, type: "pix_use", status: "done", entityType: "payment_intent", entityId: p.intent.id, createdBy: ctx.user.id, result: { saleId } }, detId("intentuse", p.intent.id));
            await t.update("payment_intents", p.intent.id, { saleId });
          }
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
            change: p.change, installments: DEFERRED_KINDS.includes(kind) ? deferredInstallments(p) : (p.installments ?? 1), paymentTermId: p.term?.id ?? null, status: DEFERRED_KINDS.includes(kind) ? "pending" : "confirmed",
            provider: p.intent?.provider ?? null, providerRef: p.intent?.reference ?? p.reference ?? null, intentId: p.intent?.id ?? null, nsu: p.nsu ?? null, authCode: p.authCode ?? null,
            cardBrand: p.cardBrand ?? null, feeAmount: fee, netAmount: p.amount - fee, settlementDate, confirmedAt: DEFERRED_KINDS.includes(kind) ? null : completedAt, manual: p.manual,
            voucherId: p.voucher?.id ?? null, titleId: titleIdForPay, dueDates,
          },
          payId,
        );
      }
      // pós-venda gravado junto (nada se perde se o processo cair depois do commit)
      await t.create("jobs", job.data, job.id);
      if (cart) await t.update("carts", cart.id, { status: "converted", saleId, payments: [] });
      if (exchangeRet) {
        await t.create("operations", { companyId: ctx.companyId, type: "exchange_link", status: "done", entityType: "return", entityId: exchangeRet.id, createdBy: ctx.user.id, result: { saleId } }, detId("exchlink", exchangeRet.id));
        await t.update("returns", exchangeRet.id, { exchangeSaleId: saleId, difference: calc.total - exchangeCredit });
      }
    });
    // somente após o commit: no Appwrite o conflito (venda concorrente com a mesma chave) surge no commit
    created = true;
  });

  const sale = await completeSalePostCommit(ctx, await ctx.store.getOrThrow("sales", saleId));
  if (created) {
    await audit(ctx, {
      module: "sales", action: "sale.complete", entityType: "sale", entityId: saleId,
      summary: `Venda nº ${number} concluída — ${formatMoney(calc.total)} (${pays.map((p) => PAYMENT_KIND_LABEL[p.method.kind] ?? p.method.name).join(", ")})`,
      after: { total: calc.total, discount: calc.discountTotal, items: lines.length, warnings: prep.stockWarnings, discountApprovedBy: approver?.name ?? null }, operationId,
      related: [customer ? `customer:${customer.id}` : "", `cash_session:${session!.id}`, input.exchangeReturnId ? `return:${input.exchangeReturnId}` : "", input.cartId ? `cart:${input.cartId}` : ""].filter(Boolean),
    });
    if (exchangeRet) {
      const diff = calc.total - exchangeCredit;
      await audit(ctx, {
        module: "sales", action: "exchange.link", entityType: "return", entityId: exchangeRet.id,
        summary: `Troca nº ${exchangeRet.number} concluída na venda nº ${number} — diferença ${diff >= 0 ? "paga pelo cliente" : "mantida em vale"} ${formatMoney(Math.abs(diff))}`,
        related: [`sale:${saleId}`, `sale:${exchangeRet.saleId}`],
      });
    }
  }
  return sale;
}

/**
 * Conclui o que vem depois do commit da venda (idempotente): efeitos de estoque/fiscal e, para registros antigos,
 * a conversão do atendimento e o vínculo da troca. Falha nos efeitos não desfaz a venda: a tarefa durável repete.
 */
export async function completeSalePostCommit(ctx: Ctx, sale: Doc) {
  const sctx = { ...ctx, branchId: sale.branchId };
  if (sale.effectsStatus !== "done") {
    try {
      await applySaleEffects(sctx, sale.id, sale.fiscalStatus !== "not_required");
    } catch (e: any) {
      await audit(sctx, { module: "sales", action: "sale.effects", entityType: "sale", entityId: sale.id, summary: `Efeitos da venda nº ${sale.number} pendentes (estoque/fiscal): ${String(e?.message ?? e).slice(0, 300)} — a tarefa durável tentará novamente.`, result: "failure" });
    }
  }
  if (sale.cartId) {
    const cart = await ctx.store.get("carts", sale.cartId);
    if (cart && cart.status !== "converted") await ctx.store.update("carts", cart.id, { status: "converted", saleId: sale.id, payments: [] });
  }
  if (sale.exchangeReturnId) {
    const ret = await ctx.store.get("returns", sale.exchangeReturnId);
    if (ret && !ret.exchangeSaleId) await linkExchangeSale(sctx, ret.id, sale.id);
  }
  return ctx.store.getOrThrow("sales", sale.id);
}

/** Grava os itens da venda que não couberam na transação principal (guardados na tarefa durável). Idempotente. */
async function ensureSaleItems(ctx: Ctx, sale: Doc) {
  const existing = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", sale.id]] });
  if (existing.length >= (sale.itemsCount ?? 0)) return;
  const job = await ctx.store.get("jobs", detId("job", `sale-effects:${sale.id}`));
  const pending = (job?.payload?.pendingItems ?? []) as Array<{ id: string; data: Record<string, any> }>;
  const have = new Set(existing.map((i) => i.id));
  const missing = pending.filter((r) => !have.has(r.id));
  for (let k = 0; k < missing.length; k += 90) {
    const batch = missing.slice(k, k + 90);
    try {
      await ctx.store.transaction(async (t) => {
        for (const r of batch) await t.create("sale_items", r.data, r.id);
      });
    } catch (e) {
      if (!isConflict(e)) throw e;
      // execução concorrente gravou parte do lote: completa um a um
      for (const r of batch) {
        if (await ctx.store.get("sale_items", r.id)) continue;
        await ctx.store.create("sale_items", r.data, r.id).catch((e2) => {
          if (!isConflict(e2)) throw e2;
        });
      }
    }
  }
}

/** Lança estoque e solicita documento fiscal. Idempotente (itens, movimentos e documento por chave). */
export async function applySaleEffects(ctx: Ctx, saleId: string, emitFiscal: boolean) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (sale.effectsStatus === "done") return sale;
  await ensureSaleItems(ctx, sale);
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  if (items.length < (sale.itemsCount ?? 0)) throw new Error(`Itens da venda nº ${sale.number} incompletos (${items.length} de ${sale.itemsCount}).`);
  const movements: MovementInput[] = items
    .filter((i) => i.warehouseId)
    .map((i) => ({
      warehouseId: i.warehouseId, skuId: i.skuId, qty: -i.qty, type: "sale" as const, unitCost: i.unitCost, originType: "sale", originId: saleId, operationId: saleId,
      reason: `Venda nº ${sale.number}`, idemKey: `sale:${saleId}:${i.seq}`, allowNegative: true, occurredAt: sale.completedAt,
    }));
  for (let i = 0; i < movements.length; i += EFFECT_BATCH) await postMovements(ctx, movements.slice(i, i + EFFECT_BATCH));
  if (sale.status === "cancelled") {
    // cancelada antes dos efeitos: a saída é lançada (o cancelamento devolve) e não há NFC-e a emitir
    if (sale.fiscalStatus === "pending" && !sale.fiscalDocumentId) await ctx.store.update("sales", saleId, { fiscalStatus: "not_required" });
  } else if (emitFiscal && sale.fiscalStatus === "pending") {
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
 * Sessão de caixa onde entra/sai dinheiro de uma operação posterior à venda (cancelamento/devolução).
 * A gaveta precisa ser do próprio operador: terminal informado (se a sessão é dele) → caixa aberto do próprio
 * operador na filial. Supervisores de caixa ("Reabrir caixa") também podem usar a gaveta do terminal informado
 * ou do terminal da venda. Nunca lança silenciosamente na gaveta de outro operador.
 */
export async function resolveCashSession(ctx: Ctx, branchId: string, terminalIds: Array<string | null | undefined>): Promise<Doc | null> {
  const supervisor = canDo(ctx.user, "cash.reopen");
  const usable = (s: Doc | null): s is Doc => Boolean(s && s.branchId === branchId && (s.operatorId === ctx.user.id || supervisor));
  const [explicit, ...fallback] = terminalIds;
  if (explicit) {
    const s = await currentSession(ctx, explicit);
    if (usable(s)) return s;
  }
  const mine = await ctx.store.list("cash_sessions", { filters: [["eq", "branchId", branchId], ["eq", "operatorId", ctx.user.id], ["eq", "status", ["open", "reopened"]]], limit: 1 });
  if (mine.items[0]) return mine.items[0];
  if (supervisor) {
    for (const tid of fallback) {
      if (!tid) continue;
      const s = await currentSession(ctx, tid);
      if (usable(s)) return s;
    }
  }
  return null;
}

export async function cancelSale(ctx: Ctx, saleId: string, reason: string, opts: { terminalId?: string | null } = {}) {
  requireAction(ctx, "sale.cancel");
  assert(reason?.trim(), "Informe o motivo do cancelamento.");
  const branchId = requireBranch(ctx);
  const sale = await ctx.store.getOrThrow("sales", saleId);
  assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
  assert(sale.branchId === branchId, "O cancelamento deve ser registrado na filial da venda.", "branch_mismatch");
  // repetição: conclui efeitos que tenham ficado pendentes (estoque, títulos, fiscal, estorno Pix)
  if (sale.status === "cancelled") return completeCancelPostCommit(ctx, sale);
  assert(sale.status === "completed", "Somente vendas concluídas podem ser canceladas.");
  assert((sale.returnedTotal ?? 0) === 0, "Venda com devoluções registradas não pode ser cancelada integralmente; use devolução dos itens restantes.");
  const payments = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]] });
  // Títulos com baixas impedem cancelamento automático
  const titles = await listAll(ctx.store, "titles", { filters: [["eq", "originId", saleId], ["eq", "originType", ["sale", "sale_card"]]] });
  for (const tt of titles) {
    const st = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", tt.id], ["eq", "status", "active"], ["eq", "kind", "settlement"]] });
    if (st.length) throw new BusinessError(`O título nº ${tt.number} já possui baixa. Estorne a baixa (Financeiro) antes de cancelar a venda.`, "has_settlements");
  }
  const hasCash = payments.some((p) => p.methodKind === "cash");
  const session = hasCash ? await resolveCashSession(ctx, sale.branchId, [opts.terminalId, sale.terminalId]) : null;
  // o dinheiro devolvido sai de uma gaveta do próprio operador: sem caixa aberto não há onde registrar a saída
  if (hasCash) assert(session, "Venda paga em dinheiro: abra o caixa (Caixa → Abertura) nesta filial, com o seu usuário, para registrar a devolução do valor ao cliente.", "cash_closed");
  const cashAcc = await cashAccountFor(ctx, sale.branchId);
  const date = today();
  // Pix integrado: o estorno é pedido ao provedor depois do commit; até a confirmação fica "estorno pendente"
  const providerPix = (p: Doc) => p.methodKind === "pix" && Boolean(p.intentId);
  const refundPending = payments.some(providerPix);
  const ops = 2 + payments.reduce((a, p) => a + 1 + (p.methodKind === "cash" ? 3 : ["pix", "other", "voucher"].includes(p.methodKind) && !providerPix(p) ? 2 : p.methodKind === "store_credit" ? 3 : 0), 0);
  assert(ops <= TX_OPS_BUDGET, "Venda com formas de pagamento demais para cancelar numa operação. Contate o suporte.", "tx_limit");
  const job = jobRow(ctx, "sale.cancel.effects", `sale-cancel-effects:${saleId}`, { saleId, branchId: sale.branchId, userId: ctx.user.id });
  let done = false;
  await retryOnConflict(async () => {
    const cur = await ctx.store.getOrThrow("sales", saleId);
    if (cur.status === "cancelled") return; // cancelamento concorrente já aplicado
    await ctx.store.transaction(async (t) => {
      const cache = new Map<string, Doc>();
      for (const p of payments) {
        const payId = p.id;
        let status = "refunded";
        if (p.methodKind === "cash") {
          await t.create("cash_movements", { companyId: ctx.companyId, branchId: sale.branchId, createdBy: ctx.user.id, sessionId: session!.id, number: 0, type: "refund", method: "cash", amount: -p.amount, reason: `Cancelamento venda nº ${sale.number}`, saleId, occurredAt: nowIso(), idemKey: `cancel:${saleId}:${p.seq}`, sessionVersion: session!.version ?? 1 }, detId("cashmov", `cancel:${saleId}:${p.seq}`));
          if (cashAcc) await postEntry(ctx, t, { accountId: cashAcc.id, date, amount: -p.amount, kind: "reversal", description: `Cancelamento venda nº ${sale.number} — dinheiro`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${payId}`, branchId: sale.branchId }, cache);
        } else if (providerPix(p)) {
          status = "refund_pending";
        } else if (["pix", "other", "voucher"].includes(p.methodKind)) {
          const m = await ctx.store.get("payment_methods", p.methodId);
          const manualPix = p.methodKind === "pix";
          if (m?.accountId) await postEntry(ctx, t, { accountId: m.accountId, date, amount: -p.amount, kind: "reversal", description: `${manualPix ? "Devolver Pix ao cliente (manual)" : `Devolução ${p.methodName}`} — cancelamento venda nº ${sale.number}`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${payId}`, branchId: sale.branchId }, cache);
          // Pix manual: não há provedor para estornar — a devolução ao cliente é feita pelo operador
          if (manualPix) status = "refund_manual";
        } else if (p.methodKind === "store_credit" && p.voucherId) {
          const v = await ctx.store.getOrThrow("credit_vouchers", p.voucherId);
          await t.increment("credit_vouchers", p.voucherId, "balance", p.amount);
          await t.update("credit_vouchers", p.voucherId, { status: "active" });
          await t.create("credit_voucher_moves", { companyId: ctx.companyId, branchId: sale.branchId, createdBy: ctx.user.id, voucherId: p.voucherId, seq: 0, kind: "reverse", amount: p.amount, balanceAfter: (v.balance ?? 0) + p.amount, saleId, idemKey: `cancel:${saleId}:${p.seq}` }, detId("vmove", `cancel:${saleId}:${p.seq}`));
        } else if (p.methodKind === "debit" || p.methodKind === "credit" || DEFERRED_KINDS.includes(p.methodKind)) {
          status = "cancelled";
        }
        await t.update("sale_payments", p.id, { status });
      }
      await t.update("sales", saleId, { status: "cancelled", paymentStatus: refundPending ? "refund_pending" : "refunded", cancelledAt: nowIso(), cancelReason: reason, cancelledBy: ctx.user.id, cancelEffectsStatus: "pending" });
      // efeitos posteriores (títulos, estoque, fiscal, estorno Pix) gravados junto: repetíveis até concluir
      await t.create("jobs", job.data, job.id);
    });
    done = true; // somente após o commit
  });
  const after = await completeCancelPostCommit(ctx, await ctx.store.getOrThrow("sales", saleId));
  if (done) {
    const cards = payments.filter((p) => p.methodKind === "debit" || p.methodKind === "credit");
    const manualPix = payments.filter((p) => p.methodKind === "pix" && !p.intentId);
    const notes = [
      cards.length ? `estornar cartão na maquininha/TEF (NSU ${cards.map((c) => c.nsu ?? "—").join(", ")})` : "",
      manualPix.length ? `devolver Pix manual ao cliente (${manualPix.map((p) => `${formatMoney(p.amount)} ref. ${p.providerRef ?? "—"}`).join(", ")})` : "",
      refundPending ? "estorno do Pix integrado solicitado ao provedor" : "",
    ].filter(Boolean);
    await audit(ctx, {
      module: "sales", action: "sale.cancel", entityType: "sale", entityId: saleId,
      summary: `Venda nº ${sale.number} cancelada${notes.length ? " — " + notes.join("; ") : ""}`,
      reason, related: [...titles.map((t) => `title:${t.id}`), session ? `cash_session:${session.id}` : ""].filter(Boolean),
    });
  }
  return after;
}

async function completeCancelPostCommit(ctx: Ctx, sale: Doc) {
  if (sale.cancelEffectsStatus === "done") return sale;
  try {
    await applySaleCancelEffects({ ...ctx, branchId: sale.branchId }, sale.id);
  } catch (e: any) {
    await audit(ctx, { module: "sales", action: "sale.cancel_effects", entityType: "sale", entityId: sale.id, summary: `Efeitos do cancelamento da venda nº ${sale.number} pendentes: ${String(e?.message ?? e).slice(0, 300)} — a tarefa durável tentará novamente.`, result: "failure" });
  }
  return ctx.store.getOrThrow("sales", sale.id);
}

/**
 * Efeitos do cancelamento (idempotentes, repetidos pela tarefa durável até concluir): títulos cancelados,
 * estoque devolvido, estorno do Pix integrado no provedor e cancelamento fiscal.
 */
export async function applySaleCancelEffects(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  if (sale.status !== "cancelled" || sale.cancelEffectsStatus === "done") return sale;
  const why = `Cancelamento da venda nº ${sale.number}: ${sale.cancelReason ?? ""}`;
  // a saída de estoque da venda precisa existir antes do retorno (venda cancelada antes dos efeitos)
  if (sale.effectsStatus !== "done") await applySaleEffects(ctx, saleId, false);
  const titles = await listAll(ctx.store, "titles", { filters: [["eq", "originId", saleId], ["eq", "originType", ["sale", "sale_card"]]] });
  for (const tt of titles) if (tt.status !== "cancelled") await cancelTitle(ctx, tt.id, why);
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const movements: MovementInput[] = items
    .filter((i) => i.warehouseId)
    .map((i) => ({ warehouseId: i.warehouseId, skuId: i.skuId, qty: i.qty, type: "sale_cancel" as const, unitCost: i.unitCost, originType: "sale_cancel", originId: saleId, operationId: saleId, reason: `Cancelamento venda nº ${sale.number}`, idemKey: `sale-cancel:${saleId}:${i.seq}` }));
  for (let i = 0; i < movements.length; i += EFFECT_BATCH) await postMovements(ctx, movements.slice(i, i + EFFECT_BATCH));
  // Pix integrado: só vira "estornado" com a confirmação do provedor
  const pays = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]] });
  const stillPending: Doc[] = [];
  for (const p of pays.filter((x) => x.status === "refund_pending" && x.intentId)) {
    const intent = await ctx.store.get("payment_intents", p.intentId);
    if (!intent) continue;
    const r = await refundIntentAtProvider(ctx, intent, p.amount);
    if (r.done) {
      const m = await ctx.store.get("payment_methods", p.methodId);
      await retryOnConflict(() =>
        ctx.store.transaction(async (t) => {
          if (m?.accountId) await postEntry(ctx, t, { accountId: m.accountId, date: today(), amount: -p.amount, kind: "reversal", description: `Estorno Pix (provedor) — cancelamento venda nº ${sale.number}`, originType: "sale_cancel", originId: saleId, idemKey: `cancelpay:${p.id}`, branchId: sale.branchId });
          await t.update("sale_payments", p.id, { status: "refunded", refundedAt: nowIso(), refundMessage: `Estorno confirmado pelo provedor (${r.status})` });
          await t.update("payment_intents", intent.id, { status: "refunded", refundedAt: nowIso(), refundRequestedAt: intent.refundRequestedAt ?? nowIso(), errorMessage: null });
        }),
      );
    } else {
      await ctx.store.update("sale_payments", p.id, { refundMessage: (r.message ?? "Estorno não confirmado pelo provedor.").slice(0, 500) });
      await ctx.store.update("payment_intents", intent.id, { refundRequestedAt: intent.refundRequestedAt ?? nowIso(), errorMessage: (r.message ?? "").slice(0, 500) });
      stillPending.push(p);
    }
  }
  const after = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]] });
  if (!after.some((p) => p.status === "refund_pending") && sale.paymentStatus === "refund_pending") await ctx.store.update("sales", saleId, { paymentStatus: "refunded" });
  // cancelamento fiscal: pedido uma única vez por documento
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", saleId]] });
  if (docs.some((d) => !["cancelled", "discarded", "unused"].includes(d.status) && !d.cancelRequestedAt)) {
    const { requestCancelForOrigin } = await import("./fiscal/service");
    await requestCancelForOrigin(ctx, "sale", saleId, `Cancelamento da venda: ${sale.cancelReason ?? ""}`).catch(async (e) => {
      await audit(ctx, { module: "fiscal", action: "cancel.request", entityType: "sale", entityId: saleId, summary: `Cancelamento fiscal pendente: ${e.message}`, result: "failure" });
    });
  }
  if (stillPending.length) {
    await notify(ctx.store, {
      companyId: ctx.companyId, branchId: sale.branchId, type: "cash", priority: "high",
      title: `Estorno Pix pendente — venda nº ${sale.number}`,
      body: `O provedor ainda não confirmou o estorno de ${formatMoney(stillPending.reduce((a, p) => a + p.amount, 0))}. ${stillPending[0].refundMessage ?? ""}`.trim(),
      link: `/vendas/${saleId}?tab=pagamentos`, originType: "sale", originId: saleId, occurrenceKey: `pix-refund:${saleId}`, audience: { action: "sale.cancel" },
    }).catch(() => undefined);
    // a tarefa durável repete o pedido de estorno (idempotente no provedor)
    throw new Error(`Estorno Pix pendente no provedor (${stillPending.length} pagamento(s)).`);
  }
  await resolveOccurrence(ctx.store, `pix-refund:${saleId}`);
  await ctx.store.update("sales", saleId, { cancelEffectsStatus: "done" });
  return ctx.store.getOrThrow("sales", saleId);
}

registerJob("sale.cancel.effects", async (ctx, payload) => {
  const sale = await ctx.store.get("sales", payload.saleId);
  if (!sale) return { skipped: "sale not found" };
  ctx.branchId = sale.branchId;
  await applySaleCancelEffects(ctx, payload.saleId);
  return { ok: true };
});

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

/** Linha devolvida guardada no documento da devolução (fonte do saldo devolvível). */
interface ReturnLine {
  saleItemId: string;
  skuId: string;
  qty: number;
  condition: "resellable" | "damaged";
  warehouseId: string;
  unitPrice: number;
  total: number;
  unitCost: number;
  costTotal: number;
  reason: string | null;
}

/**
 * Quantidade e valor já devolvidos por item da venda, a partir das devoluções gravadas (linhas no próprio documento;
 * devoluções antigas, pelos itens devolvidos).
 */
async function returnLedger(store: Store, returns: Doc[]) {
  const map = new Map<string, { qty: number; total: number }>();
  const add = (id: string, qty: number, total: number) => {
    const cur = map.get(id) ?? { qty: 0, total: 0 };
    map.set(id, { qty: cur.qty + qty, total: cur.total + total });
  };
  const legacy = returns.filter((r) => !Array.isArray(r.lines)).map((r) => r.id);
  for (const r of returns) if (Array.isArray(r.lines)) for (const l of r.lines) add(l.saleItemId, l.qty, l.total);
  for (let i = 0; i < legacy.length; i += 100) {
    for (const ri of await listAll(store, "return_items", { filters: [["eq", "returnId", legacy.slice(i, i + 100)]] })) add(ri.saleItemId, ri.qty, ri.total);
  }
  return map;
}

/** Itens com quantidade ainda devolvível. */
export async function returnableItems(store: Store, saleId: string) {
  const items = await listAll(store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const ledger = await returnLedger(store, await listAll(store, "returns", { filters: [["eq", "saleId", saleId]] }));
  return items.map((i) => ({ ...i, returnable: i.qty - Math.max(i.returnedQty ?? 0, ledger.get(i.id)?.qty ?? 0), unitNet: roundDiv(i.total * QTY, i.qty) }));
}

/**
 * Venda a prazo: o valor devolvido primeiro abate o saldo em aberto do título da venda (da última parcela para a
 * primeira); só o excedente — limitado ao que o cliente efetivamente pagou e ainda não recebeu de volta — vira
 * reembolso ou vale.
 */
export async function returnCompensationPlan(ctx: Ctx, sale: Doc, itemsTotal: number, previousReturns: Doc[]) {
  const titles = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", sale.id]] })).filter((t) => t.kind === "receivable" && t.status !== "cancelled");
  const titleIds = titles.map((t) => t.id);
  const insts = titleIds.length ? (await listAll(ctx.store, "installments", { filters: [["eq", "titleId", titleIds]] })).filter((i) => ["open", "partial"].includes(i.status) && i.balance > 0) : [];
  const open = insts.reduce((a, i) => a + i.balance, 0);
  const settled = titleIds.length ? (await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", titleIds], ["eq", "kind", "settlement"], ["eq", "status", "active"]] })).reduce((a, s) => a + (s.principal ?? 0), 0) : 0;
  const paid = (sale.paidTotal ?? 0) + settled;
  const compensatedBefore = previousReturns.reduce((a, r) => a + (r.compensatedAmount ?? r.itemsTotal ?? 0), 0);
  const paidAvailable = Math.max(0, paid - compensatedBefore);
  const abate = Math.min(itemsTotal, open);
  const compensate = itemsTotal - abate;
  if (compensate > paidAvailable) {
    throw new BusinessError(
      `O valor a devolver ao cliente (${formatMoney(compensate)}) excede o que ele efetivamente pagou e ainda não recebeu de volta (${formatMoney(paidAvailable)}): o título a prazo desta venda foi alterado no Financeiro (renegociado ou cancelado). Regularize o título antes de registrar a devolução.`,
      "over_compensation",
    );
  }
  const sorted = [...insts].sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)) || (b.number ?? 0) - (a.number ?? 0));
  let rest = abate;
  const plan: Array<{ inst: Doc; take: number }> = [];
  for (const inst of sorted) {
    if (rest <= 0) break;
    const take = Math.min(rest, inst.balance);
    plan.push({ inst, take });
    rest -= take;
  }
  return { abate, compensate, plan, open, paid, paidAvailable, titles };
}

export async function processReturn(ctx: Ctx, input: ReturnInput) {
  requireAction(ctx, "sale.return");
  const returnId = detId("return", input.idemKey);
  const existing = await ctx.store.get("returns", returnId);
  // repetição: conclui efeitos pendentes (itens, estoque, título de estorno, fiscal)
  if (existing) return completeReturnPostCommit(ctx, existing);
  const itemReasons = [...new Set(input.items.filter((i) => i.qty > 0).map((i) => i.reason?.trim()).filter(Boolean))] as string[];
  const reason = input.reason?.trim() || itemReasons.join("; ");
  assert(reason, "Informe o motivo da devolução.", "reason_required");
  input = { ...input, reason };
  const sale = await ctx.store.getOrThrow("sales", input.saleId);
  assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
  assert(sale.status === "completed", "Somente vendas concluídas aceitam devolução.");
  const branchId = requireBranch(ctx);
  assert(sale.branchId === branchId, "A devolução deve ser registrada na filial da venda.");
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", sale.id]], orderBy: [{ field: "seq" }] });
  const byId = new Map(items.map((i) => [i.id, i]));
  const wanted = input.items.filter((i) => i.qty > 0);
  assert(wanted.length > 0, "Selecione ao menos um item e quantidade.");
  assert(new Set(wanted.map((l) => l.saleItemId)).size === wanted.length, "Item repetido na devolução.");
  if (input.compensation === "refund") assert(input.refundMethod, "Informe como o valor será devolvido.");
  if (input.compensation === "store_credit") assert(sale.customerId, "Vale-crédito exige cliente identificado na venda (identifique o cliente ou use troca imediata).", "customer_required");
  if (input.compensation === "refund" && (input.refundMethod === "pix" || input.refundMethod === "account")) {
    assert(input.refundAccountId, "Informe a conta de onde sai a devolução.");
    const acc = await ctx.store.get("financial_accounts", input.refundAccountId!);
    assert(acc && acc.companyId === ctx.companyId && acc.active !== false, "Conta financeira inválida.");
  }
  const available = await defaultWarehouse(ctx.store, branchId);
  const damaged = wanted.some((l) => l.condition === "damaged") ? await damageWarehouse(ctx, branchId) : null;

  /** Monta as linhas a partir do que já foi devolvido (relido a cada tentativa: devoluções concorrentes). */
  const build = async (concurrent: boolean) => {
    const previous = await listAll(ctx.store, "returns", { filters: [["eq", "saleId", sale.id]] });
    const ledger = await returnLedger(ctx.store, previous);
    const lines: ReturnLine[] = wanted.map((i) => {
      const it = byId.get(i.saleItemId);
      assert(it, "Item não pertence à venda.");
      assert(Number.isInteger(i.qty), "Quantidade inválida.");
      const done = ledger.get(it.id) ?? { qty: 0, total: 0 };
      const returnable = it.qty - Math.max(it.returnedQty ?? 0, done.qty);
      if (i.qty > returnable) {
        throw new BusinessError(
          concurrent
            ? `Quantidade devolvida de ${it.sku} excede o restante devolvível (${returnable / QTY}) — outra devolução desta venda foi registrada ao mesmo tempo. Atualize a página.`
            : `Quantidade devolvida de ${it.sku} (${i.qty / QTY}) excede o restante devolvível (${returnable / QTY}).`,
          "over_return",
        );
      }
      // valor proporcional ao líquido pago no item; ao devolver o restante, fecha os centavos exatamente
      const total = i.qty === returnable ? it.total - done.total : roundDiv(it.total * i.qty, it.qty);
      const condition = i.condition === "damaged" ? "damaged" : "resellable";
      return {
        saleItemId: it.id, skuId: it.skuId, qty: i.qty, condition, warehouseId: condition === "damaged" ? damaged!.id : available.id, unitPrice: it.unitPrice, total,
        unitCost: it.unitCost, costTotal: roundDiv(it.unitCost * i.qty, QTY), reason: i.reason?.trim() || null,
      };
    });
    const itemsTotal = lines.reduce((a, l) => a + l.total, 0);
    const costTotal = lines.reduce((a, l) => a + l.costTotal, 0);
    const fin = await returnCompensationPlan(ctx, sale, itemsTotal, previous);
    return { previous, lines, itemsTotal, costTotal, fin };
  };

  let plan = await build(false);
  const refundCash = input.compensation === "refund" && input.refundMethod === "cash";
  const session = refundCash && plan.fin.compensate > 0 ? await resolveCashSession(ctx, branchId, [input.terminalId, sale.terminalId]) : null;
  if (refundCash && plan.fin.compensate > 0) assert(session, "Devolução em dinheiro: abra o caixa (Caixa → Abertura) nesta filial, com o seu usuário, para registrar a saída do valor.", "cash_closed");
  const cashAcc = await cashAccountFor(ctx, branchId);
  if (refundCash && plan.fin.compensate > 0) assert(cashAcc, "Filial sem conta Caixa.");
  const number = await nextNumber(ctx.store, `return:${ctx.companyId}`);
  const date = today();
  let voucherId: string | null = null;
  const job = jobRow(ctx, "return.effects", `return-effects:${returnId}`, { returnId, branchId, userId: ctx.user.id });
  let created = false;

  try {
    await retryOnConflict(async () => {
      if (await ctx.store.get("returns", returnId)) return; // mesma devolução já registrada (repetição/concorrência)
      plan = await build(true);
      const { lines, itemsTotal, costTotal, fin, previous } = plan;
      const compensate = fin.compensate;
      if (refundCash && compensate > 0 && !session) throw new BusinessError("Devolução em dinheiro: abra o caixa (Caixa → Abertura) nesta filial, com o seu usuário, para registrar a saída do valor.", "cash_closed");
      const touched = new Map<string, number>();
      for (const { inst, take } of fin.plan) touched.set(inst.titleId, (touched.get(inst.titleId) ?? 0) + take);
      const ops = 1 /* trava */ + 1 /* devolução */ + 2 /* totais da venda */ + 1 /* tarefa */ + 2 * fin.plan.length + touched.size + 3;
      if (ops > TX_OPS_BUDGET) throw new BusinessError("O título a prazo desta venda tem parcelas demais para abater numa única operação. Contate o suporte.", "tx_limit");
      const status = input.compensation === "refund" && input.refundMethod === "card_reversal" && compensate > 0 ? "processing" : "completed";
      voucherId = null;
      await ctx.store.transaction(async (t) => {
        const base = { companyId: ctx.companyId, branchId, createdBy: ctx.user.id };
        // trava por venda: devoluções simultâneas da mesma venda disputam a mesma posição e a perdedora relê o saldo devolvível
        await t.create("operations", { companyId: ctx.companyId, type: "return_lock", status: "done", entityType: "sale", entityId: sale.id, createdBy: ctx.user.id, result: { returnId } }, detId("retlock", sale.id, previous.length + 1));
        // Abatimento do título a prazo (baixa sem movimento em conta, sequência da parcela: concorrência segura com baixas)
        for (const { inst, take } of fin.plan) {
          const idem = `return:${returnId}:abate:${inst.id}`;
          const seq = (inst.seq ?? 0) + 1;
          await t.create(
            "settlements",
            {
              companyId: ctx.companyId, branchId: inst.branchId ?? branchId, createdBy: ctx.user.id, installmentId: inst.id, titleId: inst.titleId, kind: "abatement", seq, date,
              principal: take, interest: 0, fine: 0, discount: take, fee: 0, total: 0, methodId: null, methodKind: "return", accountId: null, accountEntryId: null,
              reference: `Devolução nº ${number}`, notes: `Abatimento por devolução — venda nº ${sale.number}`, status: "active", operationId: sale.id, idemKey: idem,
            },
            detId("settle", idem),
          );
          const balance = inst.balance - take;
          await t.update("installments", inst.id, { paid: (inst.paid ?? 0) + take, discount: (inst.discount ?? 0) + take, balance, status: balance === 0 ? "paid" : "partial", seq, lastSettlementAt: date });
        }
        for (const [titleId, sum] of touched) await t.increment("titles", titleId, "balance", -sum, { min: 0 });
        if (compensate > 0) {
          if (input.compensation === "store_credit" || input.compensation === "exchange") {
            voucherId = detId("voucher", returnId);
            const code = `VC${String(number).padStart(6, "0")}${returnId.slice(0, 4).toUpperCase()}`;
            await t.create("credit_vouchers", { ...base, customerId: sale.customerId ?? null, code, originalAmount: compensate, balance: compensate, status: "active", returnId, expiresAt: addDays(date, 365), seq: 0 }, voucherId);
            await t.create("credit_voucher_moves", { ...base, voucherId, seq: 0, kind: "issue", amount: compensate, balanceAfter: compensate, returnId, idemKey: `issue:${returnId}` }, detId("vmove", `issue:${returnId}`));
          } else if (refundCash) {
            await t.create("cash_movements", { ...base, sessionId: session!.id, number: 0, type: "refund", method: "cash", amount: -compensate, reason: `Devolução nº ${number} (venda ${sale.number})`, returnId, saleId: sale.id, occurredAt: nowIso(), idemKey: `return:${returnId}`, sessionVersion: session!.version ?? 1 }, detId("cashmov", `return:${returnId}`));
            await postEntry(ctx, t, { accountId: cashAcc!.id, date, amount: -compensate, kind: "payment", description: `Devolução nº ${number} — venda nº ${sale.number}`, originType: "return", originId: returnId, idemKey: `return:${returnId}`, branchId });
          } else if (input.refundMethod === "pix" || input.refundMethod === "account") {
            await postEntry(ctx, t, { accountId: input.refundAccountId!, date, amount: -compensate, kind: "payment", description: `Devolução nº ${number} — venda nº ${sale.number}`, originType: "return", originId: returnId, idemKey: `return:${returnId}`, branchId });
          }
        }
        await t.create(
          "returns",
          {
            ...base, number, saleId: sale.id, customerId: sale.customerId ?? null, kind: input.compensation === "exchange" ? "exchange" : "return", status, reason: input.reason,
            compensation: input.compensation, itemsTotal, costTotal, refundMethod: input.compensation === "refund" ? (input.refundMethod ?? null) : null, refundAccountId: input.refundAccountId ?? null,
            creditVoucherId: voucherId, difference: 0, idemKey: input.idemKey, completedAt: status === "completed" ? nowIso() : null, notes: input.notes ?? null, cashSessionId: refundCash && compensate > 0 ? session!.id : null,
            lines, abatedAmount: fin.abate, compensatedAmount: compensate, effectsStatus: "pending",
          },
          returnId,
        );
        await t.increment("sales", sale.id, "returnedTotal", itemsTotal);
        await t.increment("sales", sale.id, "returnedCost", costTotal);
        // itens devolvidos, quantidade devolvida, estoque, estorno de cartão e documento fiscal: tarefa durável idempotente
        await t.create("jobs", job.data, job.id);
      });
      created = true; // somente após o commit
    });
  } catch (e) {
    if (isConflict(e) && e.reason === "bounds") {
      throw new BusinessError("O título a prazo ou a quantidade devolvível foi alterado por outra operação ao mesmo tempo. Atualize a página e tente novamente.", "over_return");
    }
    throw e;
  }
  const ret = await completeReturnPostCommit(ctx, await ctx.store.getOrThrow("returns", returnId));
  if (!created) return ret;
  const { fin, itemsTotal } = plan;
  const compensationText = fin.compensate > 0 ? `${COMPENSATION_LABEL[input.compensation]}${input.compensation === "refund" && input.refundMethod ? " — " + REFUND_METHOD_LABEL[input.refundMethod] : ""} ${formatMoney(fin.compensate)}` : "sem reembolso/vale";
  await audit(ctx, {
    module: "sales", action: "sale.return", entityType: "return", entityId: returnId,
    summary: `Devolução nº ${number} da venda nº ${sale.number} — ${formatMoney(itemsTotal)}${fin.abate > 0 ? ` (abatido do título a prazo ${formatMoney(fin.abate)}; ${compensationText})` : ` (${compensationText})`}`,
    reason: input.reason, related: [`sale:${sale.id}`, voucherId ? `credit_voucher:${voucherId}` : "", session ? `cash_session:${session.id}` : "", sale.customerId ? `customer:${sale.customerId}` : "", ...fin.titles.map((t) => `title:${t.id}`)].filter(Boolean),
  });
  return ret;
}

async function completeReturnPostCommit(ctx: Ctx, ret: Doc) {
  if (ret.effectsStatus === "pending") {
    try {
      await applyReturnEffects({ ...ctx, branchId: ret.branchId }, ret.id);
    } catch (e: any) {
      await audit(ctx, { module: "sales", action: "return.effects", entityType: "return", entityId: ret.id, summary: `Efeitos da devolução nº ${ret.number} pendentes: ${String(e?.message ?? e).slice(0, 300)} — a tarefa durável tentará novamente.`, result: "failure" });
    }
  }
  return ctx.store.getOrThrow("returns", ret.id);
}

/**
 * Efeitos da devolução (idempotentes; repetidos pela tarefa durável até concluir): itens devolvidos e quantidade
 * devolvida por item (lotes atômicos com ids determinísticos), situação do título abatido, título de estorno de
 * cartão, retorno ao estoque e rascunho do documento fiscal.
 */
export async function applyReturnEffects(ctx: Ctx, returnId: string) {
  const ret = await ctx.store.getOrThrow("returns", returnId);
  if (ret.effectsStatus !== "pending") return ret;
  const sale = await ctx.store.getOrThrow("sales", ret.saleId);
  const lines = (ret.lines ?? []) as ReturnLine[];
  const base = { companyId: ret.companyId, branchId: ret.branchId, createdBy: ret.createdBy };
  for (let k = 0; k < lines.length; k += EFFECT_BATCH) {
    const batch = lines.slice(k, k + EFFECT_BATCH);
    for (let attempt = 0; attempt < 3; attempt++) {
      const missing: ReturnLine[] = [];
      for (const l of batch) if (!(await ctx.store.get("return_items", detId("retitem", returnId, l.saleItemId)))) missing.push(l);
      if (!missing.length) break;
      try {
        await ctx.store.transaction(async (t) => {
          for (const l of missing) {
            await t.create("return_items", { ...base, returnId, saleId: ret.saleId, saleItemId: l.saleItemId, skuId: l.skuId, qty: l.qty, condition: l.condition, warehouseId: l.warehouseId, unitPrice: l.unitPrice, total: l.total, unitCost: l.unitCost, costTotal: l.costTotal, completedAt: ret.createdAt ?? nowIso(), reason: l.reason }, detId("retitem", returnId, l.saleItemId));
            await t.increment("sale_items", l.saleItemId, "returnedQty", l.qty);
          }
        });
        break;
      } catch (e) {
        // lote gravado ao mesmo tempo por outra execução (ids determinísticos): confere de novo
        if (!isConflict(e) || attempt === 2) throw e;
      }
    }
  }
  if ((ret.abatedAmount ?? 0) > 0) {
    const titles = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "sale"], ["eq", "originId", ret.saleId]] })).filter((t) => t.kind === "receivable" && t.status !== "cancelled");
    for (const tt of titles) {
      const refreshed = await refreshTitleStatus(ctx.store, tt.id);
      const insts = await listAll(ctx.store, "installments", { filters: [["eq", "titleId", tt.id]] });
      for (const i of insts) if (!["open", "partial"].includes(i.status)) await resolveOccurrence(ctx.store, `overdue:${i.id}`);
      // nada pago de fato e saldo zerado pela devolução: o título deixa de existir como dívida (cancelado)
      const paidSettlements = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", tt.id], ["eq", "kind", "settlement"], ["eq", "status", "active"]] });
      if (refreshed.balance === 0 && refreshed.status !== "cancelled" && paidSettlements.length === 0) await cancelTitle(ctx, tt.id, `Devolução integral da venda nº ${sale.number} (devolução nº ${ret.number})`);
    }
  }
  const compensated = ret.compensatedAmount ?? ret.itemsTotal;
  if (ret.compensation === "refund" && ret.refundMethod === "card_reversal" && compensated > 0) {
    // Estorno via cartão: obrigação a acompanhar até a confirmação da adquirente
    await createTitle(ctx, {
      kind: "payable", partyType: "other", partyName: "Estorno de cartão ao cliente", description: `Estorno de cartão — devolução nº ${ret.number} (venda ${sale.number})`, originType: "return", originId: returnId,
      installments: [{ dueDate: toLocalDate(ret.createdAt ?? nowIso()), amount: compensated }], idemKey: `return:${returnId}:card`, approvalStatus: "approved", branchId: ret.branchId,
    });
  }
  const movements: MovementInput[] = lines.map((l) => ({
    warehouseId: l.warehouseId, skuId: l.skuId, qty: l.qty, type: l.condition === "damaged" ? ("damage_in" as const) : ("return" as const),
    unitCost: l.unitCost, originType: "return", originId: returnId, operationId: sale.id, reason: `Devolução nº ${ret.number}: ${ret.reason}`, idemKey: `return:${returnId}:${l.saleItemId}`,
  }));
  for (let i = 0; i < movements.length; i += EFFECT_BATCH) await postMovements(ctx, movements.slice(i, i + EFFECT_BATCH));
  // Documento fiscal de devolução (NF-e de entrada referenciando a NFC-e/NF-e original) — rascunho para revisão fiscal
  if (!ret.fiscalDocumentId) {
    const { createReturnDocumentDraft } = await import("./fiscal/service");
    await createReturnDocumentDraft(ctx, returnId).catch(async (e) => {
      await audit(ctx, { module: "fiscal", action: "return.document", entityType: "return", entityId: returnId, summary: `Documento fiscal de devolução não preparado: ${e.message}`, result: "failure" });
    });
  }
  await ctx.store.update("returns", returnId, { effectsStatus: "done" });
  return ctx.store.getOrThrow("returns", returnId);
}

registerJob("return.effects", async (ctx, payload) => {
  const ret = await ctx.store.get("returns", payload.returnId);
  if (!ret) return { skipped: "return not found" };
  ctx.branchId = ret.branchId;
  await applyReturnEffects(ctx, payload.returnId);
  return { ok: true };
});

/** Confirma o estorno no cartão informado pela adquirente: a devolução sai de "em processamento" e é concluída. */
export async function confirmCardReversal(ctx: Ctx, returnId: string, input: { reference: string }) {
  requireAction(ctx, "sale.return");
  const branchId = requireBranch(ctx);
  const ret = await ctx.store.getOrThrow("returns", returnId);
  assert(ret.companyId === ctx.companyId, "Devolução de outra empresa.");
  assert(ret.branchId === branchId, "A confirmação deve ser registrada na filial da devolução.", "branch_mismatch");
  if (ret.status === "completed") return ret;
  assert(ret.status === "processing" && ret.refundMethod === "card_reversal", "Somente estornos em cartão em processamento aguardam confirmação da adquirente.");
  const ref = input.reference?.trim();
  assert(ref, "Informe o NSU/protocolo do estorno confirmado pela adquirente.");
  const updated = await ctx.store.update("returns", returnId, { status: "completed", completedAt: nowIso(), confirmedBy: ctx.user.id, confirmationRef: ref.slice(0, 120) });
  await audit(ctx, { module: "sales", action: "return.card_reversal_confirmed", entityType: "return", entityId: returnId, summary: `Estorno no cartão da devolução nº ${ret.number} confirmado pela adquirente (ref. ${ref.slice(0, 120)})`, related: [`sale:${ret.saleId}`] });
  return updated;
}

/** Vincula a nova venda da troca à devolução e calcula a diferença paga (+) ou deixada em vale (−). */
export async function linkExchangeSale(ctx: Ctx, returnId: string, saleId: string) {
  const ret = await ctx.store.getOrThrow("returns", returnId);
  const sale = await ctx.store.getOrThrow("sales", saleId);
  assert(!ret.exchangeSaleId || ret.exchangeSaleId === saleId, "Esta troca já foi vinculada a outra venda.", "exchange_linked");
  if (ret.exchangeSaleId === saleId) return ret;
  // crédito da troca = valor compensado em vale (a parte abatida do título a prazo não vira crédito)
  const credit = ret.compensatedAmount ?? ret.itemsTotal;
  const updated = await ctx.store.update("returns", returnId, { exchangeSaleId: saleId, difference: sale.total - credit });
  await audit(ctx, {
    module: "sales", action: "exchange.link", entityType: "return", entityId: returnId,
    summary: `Troca nº ${ret.number} concluída na venda nº ${sale.number} — diferença ${sale.total - credit >= 0 ? "paga pelo cliente" : "mantida em vale"} ${formatMoney(Math.abs(sale.total - credit))}`,
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
  const { enqueue, jobsFor, requeue, runDueJobs } = await import("@/lib/core/jobs");
  if (sale.effectsStatus !== "done") {
    const jobs = await jobsFor(ctx.store, `sale-effects:${saleId}`);
    const due = jobs.filter((j) => ["pending", "retry"].includes(j.status)).map((j) => j.id);
    if (due.length) await runDueJobs(ctx.store, { jobIds: due });
    else await applySaleEffects({ ...ctx, branchId: sale.branchId }, saleId, sale.fiscalStatus !== "not_required");
  }
  const fresh = await ctx.store.getOrThrow("sales", saleId);
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", saleId]] });
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
      // consulta pelo executor de tarefas (contexto técnico), não com as permissões fiscais do usuário:
      // tarefa "fiscal.query" com chave determinística por documento, reativada a cada pedido de consulta
      let job = await enqueue(ctx.store, { type: "fiscal.query", payload: { documentId: d.id, branchId: d.branchId }, dedupeKey: `fiscal-query:${d.id}:consulta-venda`, companyId: ctx.companyId, createdBy: ctx.user.id });
      if (job.status === "running") continue; // outra execução em andamento
      if (!["pending", "retry"].includes(job.status)) job = await requeue(ctx.store, job.id);
      else if (job.runAt > nowIso()) job = await ctx.store.update("jobs", job.id, { runAt: nowIso() });
      await runDueJobs(ctx.store, { jobIds: [job.id] });
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
