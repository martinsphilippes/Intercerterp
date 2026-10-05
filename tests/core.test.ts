import { describe, it, expect } from "vitest";
import { allocate, lineTotal, marginBps, markupBps, parseMoney, pct, roundDiv, splitInstallments } from "@/lib/money";
import { calcSale } from "@/domain/pricing-calc";
import { dayRange, addMonths, startOfLocalDay, toLocalDate } from "@/lib/dates";
import { isValidCnpj, isValidCpf } from "@/lib/core/text";
import { MemoryStore } from "@/lib/db/memory-store";
import { ConflictError } from "@/lib/db/types";

describe("dinheiro em centavos", () => {
  it("arredonda metade para longe de zero", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(lineTotal(333, 1500)).toBe(500); // 3,33 × 1,5 = 4,995 → 5,00
    expect(pct(1001, 1000)).toBe(100); // 10% de 10,01
  });
  it("rateio fecha exatamente os centavos", () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocate(-100, [3, 1]).reduce((a, b) => a + b, 0)).toBe(-100);
  });
  it("parcelas somam o total", () => {
    const p = splitInstallments(10000, 3);
    expect(p).toEqual([3334, 3333, 3333]);
  });
  it("margem agregada e markup", () => {
    expect(marginBps(0, 100)).toBeNull();
    expect(marginBps(10000, 6000)).toBe(4000);
    expect(markupBps(15000, 10000)).toBe(5000);
    expect(parseMoney("1.234,56")).toBe(123456);
  });
});

describe("cálculo da venda", () => {
  it("desconto global é rateado e fecha os centavos", () => {
    const r = calcSale(
      [
        { qty: 1000, unitPrice: 1000 },
        { qty: 1000, unitPrice: 1000 },
        { qty: 1000, unitPrice: 1000 },
      ],
      { globalDiscount: 100 },
    );
    expect(r.total).toBe(2900);
    expect(r.items.reduce((a, i) => a + i.globalDiscount, 0)).toBe(100);
    expect(r.items.reduce((a, i) => a + i.total, 0)).toBe(r.total);
  });
  it("desconto do item não excede o bruto", () => {
    const r = calcSale([{ qty: 2000, unitPrice: 500, itemDiscount: 5000 }]);
    expect(r.items[0].itemDiscount).toBe(1000);
    expect(r.total).toBe(0);
  });
});

describe("datas e fuso", () => {
  it("intervalo inclui o último dia inteiro (America/Sao_Paulo)", () => {
    const r = dayRange("2026-10-01", "2026-10-31", "America/Sao_Paulo");
    expect(r.start).toBe("2026-10-01T03:00:00.000Z");
    expect(r.end).toBe("2026-11-01T03:00:00.000Z");
    expect(toLocalDate("2026-10-01T02:59:00.000Z", "America/Sao_Paulo")).toBe("2026-09-30");
    expect(startOfLocalDay("2026-01-15", "America/Sao_Paulo")).toBe("2026-01-15T03:00:00.000Z");
  });
  it("soma de meses respeita fim de mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("documentos", () => {
  it("valida CPF e CNPJ", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
  });
});

describe("armazenamento local (mesma semântica do Appwrite)", () => {
  it("índice único, transação atômica e incremento com limite", async () => {
    const s = new MemoryStore();
    await s.create("counters", { key: "a", value: 1 }, "c1");
    await expect(s.create("counters", { key: "a", value: 2 })).rejects.toBeInstanceOf(ConflictError);
    await expect(
      s.transaction(async (t) => {
        await t.create("counters", { key: "b", value: 1 }, "c2");
        await t.create("counters", { key: "a", value: 1 }, "c3"); // viola único → desfaz tudo
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await s.get("counters", "c2")).toBeNull();
    await expect(s.increment("counters", "c1", "value", -5, { min: 0 })).rejects.toBeInstanceOf(ConflictError);
    expect((await s.get("counters", "c1"))!.value).toBe(1);
  });
});
