import { describe, it, expect } from "vitest";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { listAll } from "@/lib/db";

describe("seed de demonstração", () => {
  it("carrega e é repetível sem duplicar", async () => {
    const store = freshStore();
    const r1 = await seedDemo(store, { historyDays: 5 });
    const sales1 = await listAll(store, "sales");
    expect(sales1.length).toBeGreaterThan(5);
    const r2 = await seedDemo(store, { historyDays: 5 });
    expect(r2.companyId).toBe(r1.companyId);
    const sales2 = await listAll(store, "sales");
    expect(sales2.length).toBe(sales1.length);
    // estoque físico nunca negativo na demonstração
    const bals = await listAll(store, "stock_balances");
    expect(bals.every((b) => b.physical >= 0)).toBe(true);
    // documentos fiscais simulados autorizados
    const docs = await listAll(store, "fiscal_documents");
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.isSimulated)).toBe(true);
  });

  it("retoma uma carga interrompida pelo prazo sem duplicar caixas nem vendas", async () => {
    const store = freshStore();
    // prazo já esgotado: grava a base e para antes do primeiro dia de histórico
    const r1 = await seedDemo(store, { historyDays: 3, deadline: 0 });
    expect(r1.done).toBe(false);
    expect((await listAll(store, "sales")).length).toBe(0);
    const r2 = await seedDemo(store, { historyDays: 3 });
    expect(r2.done).toBe(true);
    const sessions = await listAll(store, "cash_sessions");
    // 3 dias × 2 terminais fechados + o caixa aberto de hoje
    expect(sessions.filter((s) => s.status === "open").length).toBe(1);
    const sales = await listAll(store, "sales");
    const r3 = await seedDemo(store, { historyDays: 3 });
    expect(r3.done).toBe(true);
    expect((await listAll(store, "sales")).length).toBe(sales.length);
    expect((await listAll(store, "cash_sessions")).length).toBe(sessions.length);
  });
});
