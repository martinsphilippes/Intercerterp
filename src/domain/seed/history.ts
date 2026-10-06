import { listAll, detId } from "@/lib/db";
import { addDays, startOfLocalDay, today } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/core/settings";
import type { DemoRefs } from "./base";
import { closeSession, openSession, sessionSummary, addCashMovement } from "../cash";
import { finalizeSale, processReturn, cancelSale, returnableItems, type SalePaymentInput } from "../sales";
import { createPixIntent, simulateIntent } from "../payments/intents";
import { createTitle, settleInstallment, approvePayable } from "../finance";
import { runDueJobs } from "@/lib/core/jobs";

/** Gerador pseudoaleatório determinístico (mesma demonstração a cada carga). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Histórico de vendas, caixas e financeiro para alimentar painéis, ABC, metas e reposição. */
export async function seedHistory(refs: DemoRefs, days = 45, deadline = Infinity) {
  const store = refs.seeder.store;
  const companyId = refs.company.id;
  if (await getSetting(store, companyId, null, "demo.history.done", false)) return { skipped: true };
  const rand = rng(20261003);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const skuKeys = Object.keys(refs.skus).filter((k) => !k.startsWith("ajuste") && !k.startsWith("consultoria") && !k.startsWith("vela"));
  // ponderação: alguns itens vendem muito mais (curva ABC realista)
  const weights: Record<string, number> = { "meia-u": 9, "caderno-u": 8, "camiseta-m-preta": 6, "camiseta-g-preta": 5, "camiseta-p-preta": 3, "bone-u": 4, "caneca-u": 4, "carregador-u": 3, "fone-u": 2, "tenis-40": 2, "calca-40": 2 };
  const weighted: string[] = skuKeys.flatMap((k) => Array(weights[k] ?? 1).fill(k));
  let created = 0;

  for (const [termKey, branchKey, opKey] of [["cx1", "matriz", "cashier"], ["cx3", "shopping", "manager"]] as const) {
    const ctx = await refs.ctxFor(opKey, branchKey);
    const terminal = refs.terminals[termKey];
    for (let d = days; d >= 1; d--) {
      const date = addDays(today(), -d);
      // retomável: cada dia/terminal concluído fica marcado; o prazo encerra entre dias (nunca no meio de um caixa)
      const dayKey = `demo.history.day.${termKey}.${date}`;
      if (await getSetting(store, companyId, null, dayKey, false)) continue;
      if (Date.now() > deadline) return { partial: true, created };
      const dayStart = new Date(startOfLocalDay(date)).getTime();
      const session = await openSession(ctx, { terminalId: terminal.id, openingFund: 20000 });
      await store.update("cash_sessions", session.id, { openedAt: new Date(dayStart + 9 * 3600000).toISOString() });
      const n = 2 + Math.floor(rand() * (branchKey === "matriz" ? 4 : 3));
      for (let i = 0; i < n; i++) {
        const lines = 1 + Math.floor(rand() * 3);
        const items: Array<{ skuId: string; qty: number }> = [];
        for (let l = 0; l < lines; l++) {
          const k = pick(weighted);
          const sku = refs.skus[k];
          const bal = (await listAll(store, "stock_balances", { filters: [["eq", "skuId", sku.id], ["eq", "branchId", refs.branches[branchKey].id]] }))[0];
          const q = 1 + Math.floor(rand() * 2);
          if (!bal || bal.physical - bal.reserved < q * 1000 || items.some((x) => x.skuId === sku.id)) continue;
          items.push({ skuId: sku.id, qty: q * 1000 });
        }
        if (!items.length) continue;
        const at = new Date(dayStart + (10 + i * 1.5) * 3600000).toISOString();
        const idemKey = `demo-hist-${termKey}-${date}-${i}`;
        if (await store.get("sales", detId("sale", idemKey))) continue; // já gravada numa carga interrompida
        // total para montar pagamentos
        const { prepareSale } = await import("../sales");
        const customerKey = rand() < 0.35 ? pick(Object.keys(refs.customers)) : null;
        const prep = await prepareSale(ctx, { idemKey, terminalId: terminal.id, items, payments: [], customerId: customerKey ? refs.customers[customerKey].id : null });
        const total = prep.calc.total;
        const r = rand();
        let payments: SalePaymentInput[];
        if (r < 0.35) payments = [{ methodId: refs.methods.dinheiro.id, amount: total, received: Math.ceil(total / 1000) * 1000 }];
        else if (r < 0.6) payments = [{ methodId: refs.methods.debito.id, amount: total, nsu: String(100000 + Math.floor(rand() * 899999)) }];
        else if (r < 0.8) payments = [{ methodId: refs.methods.credito.id, amount: total, installments: total > 15000 ? 2 : 1, nsu: String(100000 + Math.floor(rand() * 899999)) }];
        else if (r < 0.92) payments = [{ methodId: refs.methods.pix.id, amount: total, reference: `E2E-DEMO-${date.replace(/-/g, "")}-${i}` }];
        else if (customerKey && refs.customers[customerKey].creditLimit > total) payments = [{ methodId: refs.methods.crediario.id, amount: total, paymentTermId: refs.terms["crediario-3x"].id }];
        else payments = [{ methodId: refs.methods.dinheiro.id, amount: total, received: total }];
        try {
          await finalizeSale(ctx, { idemKey, terminalId: terminal.id, items, payments, customerId: customerKey ? refs.customers[customerKey].id : null, occurredAt: at });
          created++;
        } catch (e: any) {
          if (!/limite|Limite/.test(e.message)) throw e;
        }
      }
      if (d % 7 === 0) await addCashMovement(ctx, { sessionId: session.id, type: "withdrawal", amount: 10000, reason: "Sangria para cofre", recipient: "Gerência", idemKey: `demo-sangria-${termKey}-${date}` });
      const sum = await sessionSummary(ctx, session.id);
      const counted: Record<string, number> = { cash: sum.expected.cash };
      for (const [k, v] of Object.entries(sum.byMethod)) if (k !== "cash") counted[k] = v.expected;
      const divergence = d === 1 && termKey === "cx3" ? -1250 : 0; // caixa fechado com divergência demonstrativa
      counted.cash += divergence;
      await closeSession(ctx, { sessionId: session.id, counted, justification: divergence ? "Diferença de R$ 12,50 em dinheiro — conferência repetida, valor não localizado (demonstração)." : undefined, checklist: { cashCounted: true, cardReportPrinted: true, pixConferred: true } });
      await store.update("cash_sessions", session.id, { closedAt: new Date(dayStart + 20 * 3600000).toISOString() });
      await setSetting(store, companyId, null, dayKey, true);
    }
  }
  await runDueJobs(store, { limit: 2000 });

  // Despesas recorrentes (contas a pagar) — pagas nos meses anteriores, abertas no mês corrente
  const fin = await refs.ctxFor("finance", "matriz");
  for (let m = 2; m >= 0; m--) {
    const due = addDays(today(), -30 * m + 5);
    for (const [key, desc, amount, cat] of [["aluguel", "Aluguel da loja Matriz", 450000, "aluguel"], ["energia", "Energia elétrica", 68000, "energia"], ["das", "DAS — Simples Nacional", 210000, "impostos"]] as const) {
      const t = await createTitle(fin, {
        kind: "payable", partyType: "other", partyName: key === "das" ? "Receita Federal" : key === "aluguel" ? "Imobiliária Central" : "Concessionária de Energia", description: `${desc} — ${due.slice(0, 7)}`,
        originType: "manual", installments: [{ dueDate: due, amount }], categoryId: refs.finCategories[cat].id, costCenterId: refs.costCenters["loja-matriz"].id, idemKey: `demo-exp-${key}-${m}`,
        competenceDate: addDays(due, -5), branchId: refs.branches.matriz.id,
      });
      if (m > 0) {
        await approvePayable(fin, t.id);
        const inst = (await listAll(store, "installments", { filters: [["eq", "titleId", t.id]] }))[0];
        if (inst.balance > 0) await settleInstallment(fin, { installmentId: inst.id, date: due, principal: inst.balance, accountId: refs.accounts.banco.id, idemKey: `demo-exp-pay-${key}-${m}` });
      }
    }
  }

  // Crediário: baixa parcial de uma parcela
  const open = await listAll(store, "installments", { filters: [["eq", "companyId", companyId], ["eq", "kind", "receivable"], ["eq", "methodKind", "crediario"], ["eq", "status", "open"]], orderBy: [{ field: "dueDate" }] });
  if (open[0]) await settleInstallment(fin, { installmentId: open[0].id, date: addDays(today(), -2), principal: Math.floor(open[0].balance / 2), interest: 0, accountId: refs.accounts["caixa-matriz"].id, methodKind: "cash", reference: "Pagamento parcial no balcão", idemKey: "demo-crediario-parcial" });

  await setSetting(store, companyId, null, "demo.history.done", true);
  return { created };
}

/** Cenários do dia: caixa aberto, venda mista com Pix, a prazo, devolução parcial, troca com diferença e cancelamento. */
export async function seedToday(refs: DemoRefs) {
  const store = refs.seeder.store;
  if (await getSetting(store, refs.company.id, null, "demo.today.done", false)) return { skipped: true };
  const ctx = await refs.ctxFor("cashier", "matriz");
  const mgr = await refs.ctxFor("manager", "matriz");
  const terminal = refs.terminals.cx1;
  // garante saldo para os cenários do dia (entrada identificada como demonstração)
  const { availableMap, postMovements } = await import("../stock");
  const needs: Record<string, number> = { "camiseta-m-preta": 3, "camiseta-g-preta": 2, "meia-u": 2, "fone-u": 2, "tenis-40": 2, "cinto-u": 2, "caderno-u": 4, "caneca-u": 3, "bone-u": 3 };
  const avail = await availableMap(store, refs.branches.matriz.id, Object.keys(needs).map((k) => refs.skus[k].id));
  for (const [k, q] of Object.entries(needs)) {
    const a = avail.get(refs.skus[k].id)?.available ?? 0;
    if (a < q * 1000) {
      await postMovements(ctx, [{ warehouseId: refs.warehouses["matriz-main"].id, skuId: refs.skus[k].id, qty: q * 1000 - a, type: "manual_in", unitCost: refs.skus[k].costTotal, originType: "seed", reason: "Entrada de demonstração para cenários do dia", idemKey: `demo-today-stock:${k}` }]);
    }
  }
  const session = await openSession(ctx, { terminalId: terminal.id, openingFund: 30000, peripheralsCheck: { printer: "browser", scanner: "keyboard_wedge" } });
  await addCashMovement(ctx, { sessionId: session.id, type: "supply", amount: 5000, reason: "Reforço de troco", recipient: "Carla Caixa", idemKey: "demo-today-supply" });

  // 1) Venda à vista em dinheiro com troco
  const s1 = await finalizeSale(ctx, { idemKey: "demo-today-1", terminalId: terminal.id, items: [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 2000 }, { skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 12970, received: 15000 }] });
  // 2) Venda mista: Pix (cobrança simulada confirmada) + dinheiro
  const cartId = "demo-cart-2";
  const intent = await createPixIntent(ctx, { cartId, amount: 10000, description: "Venda demonstração" });
  if (intent.status !== "confirmed" && !intent.saleId) await simulateIntent(ctx, intent.id, "confirmed"); // retomada: já confirmada
  await finalizeSale(ctx, { idemKey: "demo-today-2", cartId: null, terminalId: terminal.id, customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["fone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.pix.id, amount: 10000, intentId: intent.id }, { methodId: refs.methods.dinheiro.id, amount: 4990, received: 5000 }] });
  // 3) Venda a prazo (crediário 3x) com desconto global
  await finalizeSale(ctx, { idemKey: "demo-today-3", terminalId: terminal.id, customerId: refs.customers.maria.id, items: [{ skuId: refs.skus["tenis-40"].id, qty: 1000 }, { skuId: refs.skus["cinto-u"].id, qty: 1000 }], globalDiscount: 1000, payments: [{ methodId: refs.methods.crediario.id, amount: 27990 + 6990 - 1000, paymentTermId: refs.terms["crediario-3x"].id }] });
  // 4) Venda para devolução parcial → vale-crédito
  const s4 = await finalizeSale(ctx, { idemKey: "demo-today-4", terminalId: terminal.id, customerId: refs.customers.ana.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 3000 }, { skuId: refs.skus["caneca-u"].id, qty: 2000 }], payments: [{ methodId: refs.methods.debito.id, amount: 3 * 2490 + 2 * 3490, nsu: "445566" }] });
  const items4 = await returnableItems(store, s4.id);
  await processReturn(ctx, { saleId: s4.id, idemKey: "demo-return-1", reason: "Cliente comprou unidades a mais", compensation: "store_credit", items: [{ saleItemId: items4.find((i) => i.skuId === refs.skus["caderno-u"].id)!.id, qty: 1000, condition: "resellable" }, { saleItemId: items4.find((i) => i.skuId === refs.skus["caneca-u"].id)!.id, qty: 1000, condition: "damaged" }] });
  // 5) Troca com diferença: devolve camiseta M, leva G + boné; vale da troca + dinheiro
  const items1 = await returnableItems(store, s1.id);
  const ret = await processReturn(ctx, { saleId: s1.id, idemKey: "demo-exchange-1", reason: "Troca de tamanho", compensation: "exchange", items: [{ saleItemId: items1.find((i) => i.skuId === refs.skus["camiseta-m-preta"].id)!.id, qty: 1000, condition: "resellable" }] });
  const voucher = await store.getOrThrow("credit_vouchers", ret.creditVoucherId);
  const ex = await finalizeSale(ctx, { idemKey: "demo-exchange-sale-1", terminalId: terminal.id, exchangeReturnId: ret.id, items: [{ skuId: refs.skus["camiseta-g-preta"].id, qty: 1000 }, { skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.vale.id, amount: voucher.balance, voucherCode: voucher.code }, { methodId: refs.methods.dinheiro.id, amount: 4990 + 4490 - voucher.balance, received: 5000 }] });
  const { linkExchangeSale } = await import("../sales");
  await linkExchangeSale(ctx, ret.id, ex.id);
  // 6) Venda cancelada
  const s6 = await finalizeSale(ctx, { idemKey: "demo-today-6", terminalId: terminal.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490, received: 4490 }] });
  await cancelSale(mgr, s6.id, "Cliente desistiu da compra antes de sair da loja");
  await runDueJobs(store, { limit: 200 });
  await setSetting(store, refs.company.id, null, "demo.today.done", true);
  return { ok: true };
}
