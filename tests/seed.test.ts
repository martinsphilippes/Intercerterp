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
});
