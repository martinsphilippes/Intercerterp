import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, today } from "@/lib/dates";
import {
  cancelTitle, createManualTitle, createTitle, paymentTermInterestNotice, renegotiate, reverseSettlement, savePaymentTerm, settleInstallment, undoRenegotiation,
} from "@/domain/finance";
import { computeCompetence } from "@/domain/cashflow";

/** Rodada 2 (verificação independente): renegociação × cancelamento, abatimento por devolução, juros da condição. */

let refs: DemoRefs;
let ctx: Ctx;
const insts = (titleId: string) => listAll(ctx.store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number", dir: "asc" }] });
const title = (id: string) => ctx.store.getOrThrow("titles", id);
const deferred = process.env.MEMORY_TX_MODE === "deferred";

async function receivable(amounts: number[], key: string) {
  return createManualTitle(ctx, {
    kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: `Serviço ${key}`, issueDate: today(), competenceDate: today(),
    categoryId: refs.finCategories.servicos.id, installments: amounts.map((amount, i) => ({ amount, dueDate: addDays(today(), 30 * (i + 1)) })), idemKey: key,
  });
}

const reneg = (titleId: string, instIds: string[], amount: number, key: string) =>
  renegotiate(ctx, { titleId, installmentIds: instIds, charges: 0, discount: 0, installments: [{ amount, dueDate: addDays(today(), 45) }], reason: "acordo", idemKey: key });

/**
 * Mesmo registro que o módulo de vendas grava na devolução de venda a prazo (sales.ts, processReturn): baixa
 * "abatimento" (principal = abatido, desconto = abatido, total 0, sem lançamento em conta) na sequência da parcela.
 */
async function abate(inst: Doc, take: number, date = today()) {
  const seq = (inst.seq ?? 0) + 1;
  const idem = `test-return:${inst.id}:${seq}`;
  await ctx.store.transaction(async (t) => {
    await t.create(
      "settlements",
      {
        companyId: ctx.companyId, branchId: inst.branchId, createdBy: ctx.user.id, installmentId: inst.id, titleId: inst.titleId, kind: "abatement", seq, date,
        principal: take, interest: 0, fine: 0, discount: take, fee: 0, total: 0, methodId: null, methodKind: "return", accountId: null, accountEntryId: null,
        reference: "Devolução nº 1", notes: "Abatimento por devolução", status: "active", operationId: null, idemKey: idem,
      },
      detId("settle", idem),
    );
    const balance = inst.balance - take;
    await t.update("installments", inst.id, { paid: (inst.paid ?? 0) + take, discount: (inst.discount ?? 0) + take, balance, status: balance === 0 ? "paid" : "partial", seq, lastSettlementAt: date });
    await t.increment("titles", inst.titleId, "balance", -take, { min: 0 });
  });
}

/** Store que executa `inject` logo depois da n-ésima chamada `method(collection, ...)` que satisfaz `match`. */
function raceCtx(method: "list" | "getOrThrow", collection: string, match: (arg: any) => boolean, nth: number, inject: () => Promise<unknown>): Ctx {
  let calls = 0;
  const base = ctx.store as any;
  const store = new Proxy(base, {
    get(target, prop) {
      if (prop === method)
        return async (coll: string, arg: any) => {
          const res = await target[method](coll, arg);
          if (coll === collection && match(arg) && ++calls === nth) await inject();
          return res;
        };
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...ctx, store };
}

beforeEach(async () => {
  const store = freshStore();
  refs = await seedBase(store);
  ctx = await refs.ctxFor("finance", "matriz");
});

describe("cancelamento de título com renegociação vigente", () => {
  it("é recusado com 'Desfaça antes a renegociação nº N'; depois de desfazer, cancela normalmente", async () => {
    const t = await receivable([10000, 8000], "cr-1");
    const [, i2] = await insts(t.id);
    const nt = await reneg(t.id, [i2.id], 8000, "cr-1-n");
    await expect(cancelTitle(ctx, t.id, "lançado em duplicidade")).rejects.toThrow(new RegExp(`Desfaça antes a renegociação nº ${nt.number}`));
    // nada mudou: o título novo continua cobrando e o original mantém a parcela 1 em aberto
    expect(await title(t.id)).toMatchObject({ status: "partial", balance: 10000 });
    expect(await title(nt.id)).toMatchObject({ status: "open", balance: 8000 });
    await undoRenegotiation(ctx, nt.id, "desfeito para cancelar o original");
    await cancelTitle(ctx, t.id, "lançado em duplicidade");
    expect(await title(t.id)).toMatchObject({ status: "cancelled", balance: 0 });
    expect((await insts(t.id)).every((i) => i.status === "cancelled" && i.balance === 0)).toBe(true);
    expect((await title(nt.id)).status).toBe("cancelled");
  });

  it("opção de cascata (extinção da dívida de origem): cancela as renegociações sem recebimento, inclusive aninhadas; recusa se houver recebimento", async () => {
    const t = await receivable([10000, 8000], "cr-2");
    const [i1, i2] = await insts(t.id);
    const r1 = await reneg(t.id, [i1.id, i2.id], 18000, "cr-2-n1");
    const [r1i] = await insts(r1.id);
    const r2 = await reneg(r1.id, [r1i.id], 18000, "cr-2-n2");
    const [r2i] = await insts(r2.id);
    const s = await settleInstallment(ctx, { installmentId: r2i.id, date: today(), principal: 1000, accountId: refs.accounts.banco.id, idemKey: "cr-2-s" });
    await expect(cancelTitle(ctx, t.id, "venda cancelada", { cascadeRenegotiations: true })).rejects.toThrow(new RegExp(`título nº ${r2.number}.*recebimento`));
    for (const id of [t.id, r1.id, r2.id]) expect((await title(id)).status).not.toBe("cancelled");
    await reverseSettlement(ctx, s.id, "estorno");
    await cancelTitle(ctx, t.id, "venda cancelada", { cascadeRenegotiations: true });
    for (const id of [t.id, r1.id, r2.id]) expect(await title(id)).toMatchObject({ status: "cancelled", balance: 0 });
    for (const id of [t.id, r1.id, r2.id]) expect((await insts(id)).every((i) => i.status === "cancelled" && i.balance === 0)).toBe(true);
  });

  it("renegociação gravada entre a leitura e o commit do cancelamento: recusa clara (sem 'Limite mínimo violado')", async () => {
    const t = await receivable([10000, 10000], "cr-race-1");
    const [i1] = await insts(t.id);
    let nt: Doc | null = null;
    const inject = async () => {
      nt = await reneg(t.id, [i1.id], 10000, "cr-race-1-n");
    };
    // 1ª leitura = conferência antes da transação; 2ª = dentro da transação (no modo deferred, antes do commit)
    const c = raceCtx("list", "titles", (o) => (o?.filters ?? []).some((f: any) => f[1] === "originType" && f[2] === "renegotiation"), deferred ? 2 : 1, inject);
    const err = await cancelTitle(c, t.id, "duplicado").then(() => null, (e) => e);
    expect(err?.message).toMatch(/Desfaça antes a renegociação nº/);
    expect(err?.message).not.toMatch(/Limite/);
    expect(nt).not.toBeNull();
    expect(await title(t.id)).toMatchObject({ status: "partial", balance: 10000 });
    expect(await title(nt!.id)).toMatchObject({ status: "open", balance: 10000 });
  });

  it("cancelamento gravado entre a leitura e o commit da renegociação: recusa clara e nenhum título novo", async () => {
    const t = await receivable([10000, 10000], "cr-race-2");
    const [i1] = await insts(t.id);
    const inject = () => cancelTitle(ctx, t.id, "duplicado");
    const c = raceCtx("getOrThrow", "installments", (id) => id === i1.id, deferred ? 2 : 1, inject);
    const err = await renegotiate(c, { titleId: t.id, installmentIds: [i1.id], charges: 0, discount: 0, installments: [{ amount: 10000, dueDate: addDays(today(), 30) }], reason: "acordo", idemKey: "cr-race-2-n" }).then(() => null, (e) => e);
    expect(err?.message).toMatch(/foi cancelado por outra operação/);
    expect(err?.message).not.toMatch(/Limite/);
    expect(await title(t.id)).toMatchObject({ status: "cancelled", balance: 0 });
    expect((await insts(t.id)).every((i) => i.status === "cancelled")).toBe(true);
    expect(await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", t.id]] })).toHaveLength(0);
  });

  it("renegociação e cancelamento simultâneos: um vence, o outro recebe mensagem clara e nunca sobra renegociação vigente de título cancelado", async () => {
    for (const round of [1, 2, 3]) {
      const t = await receivable([10000, 10000], `cr-conc-${round}`);
      const [i1] = await insts(t.id);
      const results = await Promise.allSettled([reneg(t.id, [i1.id], 10000, `cr-conc-n-${round}`), cancelTitle(ctx, t.id, "duplicado")]);
      for (const r of results) if (r.status === "rejected") expect(String(r.reason?.message)).not.toMatch(/Limite/);
      const tt = await title(t.id);
      const live = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "renegotiation"], ["eq", "originId", t.id]] })).filter((x) => x.status !== "cancelled");
      if (tt.status === "cancelled") expect(live).toHaveLength(0);
      else expect(live).toHaveLength(1);
    }
  });
});

describe("desfazer renegociação com título original cancelado", () => {
  it("permite apenas cancelar o título novo (nada volta ao original); com recebimento ativo é recusado", async () => {
    const t = await receivable([10000], "uo-1");
    const [i] = await insts(t.id);
    const nt = await reneg(t.id, [i.id], 10000, "uo-1-n");
    // estado anterior à trava do cancelamento (dados antigos): original cancelado com a renegociação vigente
    await ctx.store.update("titles", t.id, { status: "cancelled", balance: 0 });
    await ctx.store.update("installments", i.id, { status: "cancelled", balance: 0 });
    const [n1] = await insts(nt.id);
    const s = await settleInstallment(ctx, { installmentId: n1.id, date: today(), principal: 2000, accountId: refs.accounts.banco.id, idemKey: "uo-1-s" });
    await expect(undoRenegotiation(ctx, nt.id, "erro")).rejects.toThrow(/recebimento/);
    await reverseSettlement(ctx, s.id, "erro");
    await undoRenegotiation(ctx, nt.id, "original cancelado");
    expect(await title(nt.id)).toMatchObject({ status: "cancelled", balance: 0 });
    expect((await insts(nt.id)).every((x) => x.status === "cancelled" && x.balance === 0)).toBe(true);
    expect(await title(t.id)).toMatchObject({ status: "cancelled", balance: 0 });
    expect(await ctx.store.getOrThrow("installments", i.id)).toMatchObject({ status: "cancelled", balance: 0 });
  });

  it("tela: o detalhe do título informa o original cancelado e o bloqueio de cancelamento por renegociação vigente", async () => {
    const { titleDetail } = await import("@/app/(app)/financeiro/queries");
    const t = await receivable([10000, 5000], "uo-2");
    const [, i2] = await insts(t.id);
    const nt = await reneg(t.id, [i2.id], 5000, "uo-2-n");
    const d = await titleDetail(ctx, t.id);
    expect(d!.renegChildren.map((x) => x.id)).toEqual([nt.id]);
    const dn = await titleDetail(ctx, nt.id);
    expect(dn!.origin?.id).toBe(t.id);
  });
});

describe("abatimento por devolução de venda a prazo", () => {
  async function saleTitle(key: string, amounts: number[], categoryId: string | null = null) {
    return createTitle(ctx, {
      kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: `Venda ${key}`, originType: "sale", originId: `sale-${key}`, categoryId,
      installments: amounts.map((amount, i) => ({ amount, dueDate: addDays(today(), 30 * (i + 1)) })), idemKey: key, branchId: ctx.branchId,
    });
  }

  it("competência: reduz a receita da categoria do título na data do abatimento (linha própria); título cancelado não conta", async () => {
    const m = today().slice(0, 7);
    const base = await computeCompetence(ctx, { fromMonth: m, toMonth: m });
    const t = await saleTitle("ab-1", [5000, 5000]);
    const [, i2] = await insts(t.id);
    await abate(i2, 3000);
    const c = await computeCompetence(ctx, { fromMonth: m, toMonth: m });
    expect(c.byMonth[0].revenue).toBe(base.byMonth[0].revenue + 10000 - 3000);
    const row = c.rows.find((r) => r.source === "abatement");
    expect(row).toMatchObject({ type: "revenue", categoryId: refs.finCategories.vendas.id, total: -3000 });
    expect(c.abatementCount).toBe(1);
    // filtro de categoria e de filial seguem o título
    const byCat = await computeCompetence(ctx, { fromMonth: m, toMonth: m, categoryId: refs.finCategories.servicos.id });
    expect(byCat.rows.some((r) => r.source === "abatement")).toBe(false);
    const otherBranch = await computeCompetence(ctx, { fromMonth: m, toMonth: m, branchId: "outra-filial" });
    expect(otherBranch.abatementCount).toBe(0);
    // devolução integral sem recebimento → título cancelado: nem o título nem o abatimento compõem a receita
    const t2 = await saleTitle("ab-2", [4000]);
    const [j] = await insts(t2.id);
    await abate(j, 4000);
    await cancelTitle(ctx, t2.id, "devolução integral");
    expect((await computeCompetence(ctx, { fromMonth: m, toMonth: m })).byMonth[0].revenue).toBe(c.byMonth[0].revenue);
  });

  it("lista, exportação e detalhe: 'Recebido' só com baixas reais; abatido em coluna própria; abatimento listado sem estorno", async () => {
    const { queryInstallments, titleDetail } = await import("@/app/(app)/financeiro/queries");
    const t = await saleTitle("ab-3", [5000, 5000]);
    const [i1, i2] = await insts(t.id);
    await settleInstallment(ctx, { installmentId: i1.id, date: today(), principal: 5000, discount: 200, accountId: refs.accounts.banco.id, idemKey: "ab-3-s" });
    await abate(await ctx.store.getOrThrow("installments", i2.id), 3000);
    const rows = await queryInstallments(ctx, "receivable", { q: "", f: { title: t.id } });
    const r2 = rows.find((r) => r.id === i2.id)!;
    expect(r2).toMatchObject({ paid: 0, abated: 3000, balance: 2000, extras: 0 });
    expect(rows.find((r) => r.id === i1.id)).toMatchObject({ paid: 5000, abated: 0, extras: -200 });
    // detalhamento da competência: parcelas abatidas no período
    const drill = await queryInstallments(ctx, "receivable", { q: "", f: { abFrom: today(), abTo: today() } });
    expect(drill.map((r) => r.id)).toEqual([i2.id]);
    expect(await queryInstallments(ctx, "receivable", { q: "", f: { abFrom: addDays(today(), 1) } })).toHaveLength(0);
    const d = (await titleDetail(ctx, t.id))!;
    expect(d.principalSettled).toBe(5000);
    expect(d.abated).toBe(3000);
    expect(d.abatedByInst.get(i2.id)).toBe(3000);
    expect(d.settlements.filter((x) => x.kind === "abatement").map((x) => x.principal)).toEqual([3000]);
    // a exportação de contas a receber tem a coluna separada
    await import("@/exports/finance");
    const { getExport } = await import("@/lib/exporters");
    const cols = getExport("fin-receivables")!.columns.map((c: any) => c.key);
    expect(cols).toContain("abated");
    expect(cols.indexOf("abated")).toBe(cols.indexOf("paid") + 1);
    expect(getExport("fin-payables")!.columns.map((c: any) => c.key)).not.toContain("abated");
  });
});

describe("juros da condição de parcelamento", () => {
  it("cadastro aceita, mas avisa explicitamente que vendas (e compras) não aplicam juros", async () => {
    expect(paymentTermInterestNotice({ interestBps: 0, kind: "both" })).toBeNull();
    expect(paymentTermInterestNotice({ interestBps: 500, kind: "sale" })).toMatch(/Vendas .*NÃO acrescentam juros/);
    expect(paymentTermInterestNotice({ interestBps: 500, kind: "both" })).toMatch(/Vendas .* e compras .*NÃO acrescentam juros/);
    expect(paymentTermInterestNotice({ interestBps: 500, kind: "purchase" })).toMatch(/Compras .*NÃO acrescentam juros/);
    const term = await savePaymentTerm(ctx, null, { name: "3x com juros", installments: 3, firstDueDays: 30, intervalDays: 30, interestBps: 500, kind: "both" });
    expect(term.interestBps).toBe(500);
    expect(paymentTermInterestNotice(term)).toMatch(/títulos lançados manualmente/);
  });
});
