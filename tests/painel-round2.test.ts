import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { addReturn, addSale, at, baseRefs, COMPANY } from "./report-fixtures";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { MemoryStore } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import { today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { openSession } from "@/domain/cash";
import { applyReturnEffects, finalizeSale, processReturn, returnableItems, type FinalizeSaleInput } from "@/domain/sales";
import { loadFacts, paymentBreakdown, reportTotals, type ReportScope } from "@/domain/reports";
import { toCsv } from "@/lib/exporters";

/**
 * Rodada 2 (painel/relatórios/clientes): devolução de venda mista na quebra por meio de pagamento, devolução com
 * efeitos pendentes na receita e exceção numérica na neutralização de fórmulas do CSV.
 */

describe("relatórios — devoluções de venda a prazo e efeitos pendentes", () => {
  let store: MemoryStore;
  let refs: DemoRefs;
  let cashier: Ctx;
  let terminalId: string;
  const sale = (input: Partial<FinalizeSaleInput> & { idemKey: string; items: FinalizeSaleInput["items"]; payments: FinalizeSaleInput["payments"] }) => finalizeSale(cashier, { terminalId, ...input });
  const scopeToday = (): ReportScope => ({ companyId: refs.company.id, branchIds: null, from: today(), to: today() });

  beforeEach(async () => {
    store = freshStore();
    refs = await seedBase(store);
    cashier = await refs.ctxFor("cashier", "matriz");
    terminalId = refs.terminals.cx1.id;
    await openSession(cashier, { terminalId, openingFund: 10000 });
  });

  it("venda mista (dinheiro + crediário): devolução mostra o abatimento do título separado do reembolso em dinheiro", async () => {
    const s = await sale({ idemKey: "mix-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 1000 }, { methodId: refs.methods.crediario.id, amount: 1990 }] });
    const [line] = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "mix-r", reason: "desistiu", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: line.id, qty: 1000, condition: "resellable" }] });
    expect(r).toMatchObject({ abatedAmount: 1990, compensatedAmount: 1000 });

    const pay = await paymentBreakdown(store, scopeToday());
    const ret = pay.rows.filter((x) => x.kind === "return");
    expect(ret.find((x) => x.id === "ret:abatement")).toMatchObject({ label: "Devolução — abatimento do título a prazo", amount: 1990, count: 1 });
    // só o que saiu do caixa aparece como reembolso em dinheiro (antes: 29,90 inteiros como dinheiro)
    expect(ret.find((x) => x.id === "ret:cash")).toMatchObject({ amount: 1000, count: 1 });
    expect(pay.returnsTotal).toBe(2990);
    expect(pay.paymentsTotal - pay.returnsTotal).toBe(pay.netRevenue);

    // devolução integral de venda só no crediário: tudo abatimento, nenhuma linha de reembolso
    const s2 = await sale({ idemKey: "cred-1", customerId: refs.customers.joao.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.crediario.id, amount: 2990 }] });
    const [l2] = await returnableItems(store, s2.id);
    await processReturn(cashier, { saleId: s2.id, idemKey: "cred-r", reason: "defeito", compensation: "refund", refundMethod: "cash", items: [{ saleItemId: l2.id, qty: 1000, condition: "resellable" }] });
    const pay2 = await paymentBreakdown(store, scopeToday());
    const ret2 = pay2.rows.filter((x) => x.kind === "return");
    expect(ret2.find((x) => x.id === "ret:abatement")).toMatchObject({ amount: 1990 + 2990, count: 2 });
    expect(ret2.find((x) => x.id === "ret:cash")).toMatchObject({ amount: 1000, count: 1 });
    expect(pay2.paymentsTotal - pay2.returnsTotal).toBe(pay2.netRevenue);
  });

  it("devolução com efeitos pendentes (sem return_items) entra na receita pelas linhas do documento, sem duplicar depois", async () => {
    const s = await sale({ idemKey: "pend-1", items: [{ skuId: refs.skus["meia-u"].id, qty: 2000 }, { skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 2 * 2990 + 4490 }] });
    const items = await returnableItems(store, s.id);
    const r = await processReturn(cashier, { saleId: s.id, idemKey: "pend-r", reason: "desistiu", compensation: "refund", refundMethod: "cash", items: items.map((i) => ({ saleItemId: i.id, qty: i.qty, condition: "resellable" as const })) });
    const done = await reportTotals(store, scopeToday());
    expect(done.returns).toBe(r.itemsTotal);
    expect(done.returnsCount).toBe(1);

    // estado entre o commit da devolução e a tarefa return.effects: documento gravado, itens devolvidos ainda não
    const written = await listAll(store, "return_items", { filters: [["eq", "returnId", r.id]] });
    expect(written).toHaveLength(2);
    for (const ri of written) await store.delete("return_items", ri.id);
    await store.update("returns", r.id, { effectsStatus: "pending" });
    const pending = await reportTotals(store, scopeToday());
    expect(pending).toMatchObject({ returns: done.returns, costReturned: done.costReturned, qtyReturned: done.qtyReturned, netRevenue: done.netRevenue, cmv: done.cmv, returnsCount: 1 });
    const facts = await loadFacts(store, scopeToday());
    const retLines = facts.lines.filter((l) => l.kind === "return");
    expect(retLines).toHaveLength(2);
    expect(retLines.every((l) => l.docId === r.id && l.date === today() && l.branchId === r.branchId && l.saleNumber === s.number)).toBe(true);
    // quebra por meio de pagamento também confere com o resumo
    const pay = await paymentBreakdown(store, scopeToday());
    expect(pay.paymentsTotal - pay.returnsTotal).toBe(pending.netRevenue);

    // parcialmente gravado: um item já existe, o outro vem do documento — total contado uma única vez
    await store.create("return_items", { ...written[0], id: undefined, createdAt: undefined, updatedAt: undefined }, written[0].id);
    expect(await reportTotals(store, scopeToday())).toMatchObject({ returns: done.returns, qtyReturned: done.qtyReturned, returnsCount: 1 });

    // tarefa concluída: itens gravados e efeitos "done" — mesmos totais
    await store.delete("return_items", written[0].id);
    await applyReturnEffects({ ...cashier, branchId: r.branchId }, r.id);
    expect((await store.getOrThrow("returns", r.id)).effectsStatus).toBe("done");
    expect(await listAll(store, "return_items", { filters: [["eq", "returnId", r.id]] })).toHaveLength(2);
    expect(await reportTotals(store, scopeToday())).toMatchObject({ returns: done.returns, qtyReturned: done.qtyReturned, returnsCount: 1 });
  });
});

describe("relatórios — devolução antiga (sem abatimento registrado)", () => {
  it("vai inteira para a forma de compensação", async () => {
    const store = freshStore();
    await baseRefs(store);
    await addSale(store, { id: "s1", at: at("2026-09-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 5000, cost: 2000 }] });
    await addReturn(store, { id: "r1", saleId: "s1", at: at("2026-09-12"), compensation: "store_credit", items: [{ seq: 1, skuId: "x", qty: 1000, total: 5000, cost: 2000 }] });
    const pay = await paymentBreakdown(store, { companyId: COMPANY, branchIds: null, from: "2026-09-01", to: "2026-09-30" });
    expect(pay.rows.filter((x) => x.kind === "return")).toEqual([{ id: "ret:store_credit", label: "Devolução — vale-crédito", kind: "return", amount: 5000, count: 1 }]);
    expect(pay.paymentsTotal - pay.returnsTotal).toBe(pay.netRevenue);
  });
});

describe("CSV — neutralização de fórmulas com exceção numérica", () => {
  const csvCell = (v: string) => toCsv([{ key: "v", label: "Valor" }], [{ v }]).split("\r\n")[1];

  it("número negativo pré-formatado em coluna de texto não ganha apóstrofo", () => {
    expect(csvCell("-12,34")).toBe("-12,34");
    expect(csvCell("-1.234,56")).toBe("-1.234,56");
    expect(csvCell("-R$ 12,34")).toBe("-R$ 12,34");
    expect(csvCell(formatMoney(-123456))).toBe(formatMoney(-123456)); // espaço não separável do Intl
    expect(csvCell("-12,5%")).toBe("-12,5%");
    expect(csvCell("-7")).toBe("-7");
  });

  it("fórmulas continuam neutralizadas", () => {
    expect(csvCell("=HYPERLINK(\"http://x\",\"y\")")).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("-R$ 1,00+A1")).toBe("'-R$ 1,00+A1");
    expect(csvCell("-SUM(A1:A2)")).toBe("'-SUM(A1:A2)");
    expect(csvCell("+12,34")).toBe("'+12,34");
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(csvCell("-")).toBe("'-");
    // colunas numéricas seguem sem prefixo
    expect(toCsv([{ key: "v", label: "Valor", type: "money" }], [{ v: -1234 }]).split("\r\n")[1]).toBe("-12,34");
  });
});
