import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { addSale, at, baseRefs, BR1, BR2, COMPANY } from "./report-fixtures";
import { copyGoals, createGoal, goalsProgress, goalsScreen, updateGoal } from "@/domain/goals";
import { listAll } from "@/lib/db";
import { getExport, toCsv } from "@/lib/exporters";
import type { Store } from "@/lib/db/types";
import type { Ctx, CtxUser } from "@/lib/core/ctx";
import type { SessionInfo } from "@/lib/server/session";
import "@/exports/reports";

function ctxFor(store: Store, over: Partial<CtxUser> = {}, branchId: string | null = BR1): Ctx {
  return { store, companyId: COMPANY, branchId, user: { id: "op-1", name: "Gestor", email: "g@t", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [COMPANY], ...over } };
}

/** Sessão mínima para as exportações (mesmos campos usados pelas telas). */
function session(ctx: Ctx, branchIds: string[]): SessionInfo {
  const names: Record<string, string> = { [BR1]: "Filial Um", [BR2]: "Filial Dois" };
  return {
    ctx, user: ctx.user as any, company: { id: COMPANY, name: "Empresa Teste" }, branch: ctx.branchId ? { id: ctx.branchId, name: names[ctx.branchId] } : null,
    companies: [{ id: COMPANY }], branches: branchIds.map((id) => ({ id, name: names[id], companyId: COMPANY })), consolidated: !ctx.branchId, canConsolidate: true,
  };
}

describe("metas — chave, escopo de filiais e exportação", () => {
  let store: Store;
  beforeEach(async () => {
    store = freshStore();
    await baseRefs(store);
  });

  it("criar meta depois de alterar a chave de outra cria a nova (id determinístico não prende a chave original)", async () => {
    const ctx = ctxFor(store);
    const oct = await createGoal(ctx, { branchId: BR1, period: "2026-10", metric: "revenue", target: 100000 });
    // meta de outubro passa para novembro (mantém o id)
    await updateGoal(ctx, oct.id, { branchId: BR1, period: "2026-11", metric: "revenue", target: 100000 });
    // copiar novembro → outubro: a posição do id de outubro está ocupada pela meta movida
    const r = await copyGoals(ctx, "2026-11", "2026-10", null);
    expect(r).toMatchObject({ created: 1, skipped: 0 });
    const goals = await listAll(store, "goals", { filters: [["eq", "companyId", COMPANY]] });
    expect(goals.map((g) => g.period).sort()).toEqual(["2026-10", "2026-11"]);
    // e o cadastro manual também cria (em vez de devolver a meta de novembro)
    await updateGoal(ctx, oct.id, { branchId: BR1, period: "2026-12", metric: "revenue", target: 100000 });
    const created = await createGoal(ctx, { branchId: BR1, period: "2026-11", metric: "revenue", target: 50000 });
    expect(created).toMatchObject({ period: "2026-11", metric: "revenue", branchId: BR1, target: 50000 });
    const after = await listAll(store, "goals", { filters: [["eq", "companyId", COMPANY]] });
    expect(after.map((g) => g.period).sort()).toEqual(["2026-10", "2026-11", "2026-12"]);
    // a unicidade por (filial, mês, métrica) continua valendo
    await expect(createGoal(ctx, { branchId: BR1, period: "2026-11", metric: "revenue", target: 1 })).rejects.toThrow(/Já existe/);
  });

  it("criação concorrente da mesma meta converge para um único registro", async () => {
    const ctx = ctxFor(store);
    const [a, b] = await Promise.all([
      createGoal(ctx, { branchId: BR2, period: "2026-09", metric: "sales_count", target: 10 }),
      createGoal(ctx, { branchId: BR2, period: "2026-09", metric: "sales_count", target: 10 }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await listAll(store, "goals", { filters: [["eq", "companyId", COMPANY]] })).toHaveLength(1);
  });

  it("meta da empresa (realizado de todas as filiais) não aparece para usuário restrito a uma filial", async () => {
    const admin = ctxFor(store);
    await createGoal(admin, { branchId: null, period: "2026-09", metric: "revenue", target: 100000 });
    await createGoal(admin, { branchId: BR1, period: "2026-09", metric: "revenue", target: 40000 });
    await createGoal(admin, { branchId: BR2, period: "2026-09", metric: "revenue", target: 60000 });
    await addSale(store, { id: "s1", branchId: BR1, at: at("2026-09-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 30000, cost: 1 }] });
    await addSale(store, { id: "s2", branchId: BR2, at: at("2026-09-11"), items: [{ skuId: "x", qty: 1000, unitPrice: 50000, cost: 1 }] });

    const full = await goalsProgress(admin, "2026-09", { branchIds: [BR1, BR2], ref: "2026-10-05" });
    expect(full.find((g) => !g.goal.branchId)).toMatchObject({ actual: 80000 });

    const restricted = ctxFor(store, { isAdmin: false, permissions: { dashboard: { view: true } }, branchIds: [BR1] });
    const prog = await goalsProgress(restricted, "2026-09", { branchIds: [BR1], ref: "2026-10-05" });
    expect(prog.map((g) => g.goal.branchId)).toEqual([BR1]);
    expect(prog[0].actual).toBe(30000);
    // mesmo sem recorte informado, não vê filiais fora do seu acesso nem a meta da empresa
    const noScope = await goalsProgress(restricted, "2026-09", { ref: "2026-10-05" });
    expect(noScope.map((g) => g.goal.branchId)).toEqual([BR1]);
  });

  it("exportação de metas = tela de metas (inclusive usuário com uma única filial acessível)", async () => {
    const admin = ctxFor(store);
    await createGoal(admin, { branchId: null, period: "2026-09", metric: "ticket", target: 30000 });
    await createGoal(admin, { branchId: BR1, period: "2026-09", metric: "revenue", target: 40000 });
    // empresa com acesso total, mas a sessão enxerga uma única filial (resolveReportParams forçaria filial única)
    const s = session(ctxFor(store), [BR1]);
    const def = getExport("reports-goals")!;
    const screen = await goalsScreen(s.ctx, "2026-09", { accessibleBranchIds: [BR1], filial: "" });
    const rows = await def.rows(s, { mes: "2026-09", filial: "todas" });
    expect(screen.goals).toHaveLength(2);
    expect(rows).toHaveLength(screen.goals.length);
    expect(rows.map((r) => r.branchName).sort()).toEqual(screen.goals.map((g) => g.branchName).sort());
    // filial explícita: só as metas dela, nas duas
    const one = await def.rows(s, { mes: "2026-09", filial: BR1 });
    expect(one.map((r) => r.branchName)).toEqual(["Filial Um"]);
  });

  it("quebra por meio de pagamento exportada: rótulo do total não começa com '='", async () => {
    await addSale(store, { id: "s1", branchId: BR1, at: at("2026-09-10"), items: [{ skuId: "x", qty: 1000, unitPrice: 30000, cost: 1 }] });
    const s = session(ctxFor(store, {}, null), [BR1, BR2]);
    const def = getExport("reports-breakdown")!;
    const rows = await def.rows(s, { tab: "pagamento", de: "2026-09-01", ate: "2026-09-30", filial: "todas" });
    const total = rows[rows.length - 1];
    expect(total.label).toBe("Receita líquida (total)");
    expect(rows.every((r) => !/^[=+\-@]/.test(String(r.label)))).toBe(true);
    const csv = toCsv(def.columns, rows);
    expect(csv).toContain(";Receita líquida (total);");
    expect(csv).not.toContain("'Receita");
  });
});
