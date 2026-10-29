import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { listAll } from "@/lib/db";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import { allNodes, effectivePrice, visibleNodeIds, networkViewer } from "@/domain/network";

describe("demonstração da rede de certificação", () => {
  it("monta Master → Regionais → Revendas → Contador com preços em cascata, vendedores e acesso rápido; repetível", async () => {
    const store = freshStore();
    await seedDemo(store, { historyDays: 1 });
    const nodes = await allNodes(store);
    const byName = (n: string) => nodes.find((x) => x.name.includes(n))!;
    expect(nodes.filter((n) => n.level === "master")).toHaveLength(1);
    expect(nodes.filter((n) => n.level === "regional")).toHaveLength(2);
    expect(nodes.filter((n) => n.level === "revenda")).toHaveLength(3);
    const contador = nodes.find((n) => n.level === "contador")!;
    expect(contador.parentNodeId).toBe(byName("Juazeiro").id);
    // e-CPF A1: AC 60 → Master 80 → Regional 95 → Revenda 110 → Contador 120 (mínimo 120, padrão 150)
    expect(await effectivePrice(store, byName("Nordeste").id, "ecpf_a1_12m")).toMatchObject({ cost: 8000, parentCost: 6000 });
    expect(await effectivePrice(store, byName("Ceará").id, "ecpf_a1_12m")).toMatchObject({ cost: 9500 });
    expect(await effectivePrice(store, byName("Juazeiro").id, "ecpf_a1_12m")).toMatchObject({ cost: 11000 });
    expect(await effectivePrice(store, contador.id, "ecpf_a1_12m")).toMatchObject({ cost: 12000, minPrice: 12000, defaultPrice: 15000, parentMargin: 1000 });
    expect(await effectivePrice(store, contador.id, "birdid_12m")).toMatchObject({ canEdit: false });
    // usuários de demonstração ativos por nível, inclusive vendedores
    const users = (await listAll(store, "users")).filter((u) => u.isDemo && u.status === "active" && u.authId);
    for (const login of ["rede", "master", "regional.ce", "regional.ba", "revenda.juazeiro", "revenda.fortaleza", "revenda.salvador", "vendedor.juazeiro", "vendedor.fortaleza", "vendedor.salvador"]) {
      expect(users.map((u) => u.login)).toContain(login);
    }
    // a regional do Ceará vê as revendas dela e o contador, não a Bahia
    const ce = users.find((u) => u.login === "regional.ce")!;
    const cid = ce.companyIds[0];
    const ctx = { store: scopeStore(store, cid), companyId: cid, branchId: null, user: await toCtxUser(store, ce, cid) };
    const vis = await visibleNodeIds(ctx);
    expect(vis.has(contador.id)).toBe(true);
    expect(vis.has(byName("Bahia").id)).toBe(false);
    expect(vis.has(byName("Salvador").id)).toBe(false);
    const rede = users.find((u) => u.login === "rede")!;
    const pctx = { store: scopeStore(store, rede.companyIds[0]), companyId: rede.companyIds[0], branchId: null, user: await toCtxUser(store, rede, rede.companyIds[0]) };
    expect((await networkViewer(pctx)).platform).toBe(true);
    // §45: vendas da rede em cada revenda (aguardando, pagas/validação, emitidas), voucher, cupons, BirdID gratuito e renovações
    const sales = (await listAll(store, "certificate_requests")).filter((r) => r.channel === "network");
    for (const k of ["Juazeiro", "Fortaleza", "Salvador"]) {
      const mine = sales.filter((r) => r.sellerNodeId === byName(k).id);
      expect(mine.some((r) => r.status === "awaiting_payment")).toBe(true);
      expect(mine.some((r) => r.status === "validation")).toBe(true);
      expect(mine.some((r) => ["ready_to_download", "downloaded"].includes(r.status))).toBe(true);
      for (const r of mine) expect(r.cascade.levels.at(-1).nodeId).toBe(byName(k).id);
    }
    expect(sales.filter((r) => r.free).length).toBeGreaterThanOrEqual(2);
    expect(sales.filter((r) => r.voucherRedemptionId).length).toBe(2);
    const lot = (await listAll(store, "cert_voucher_lots"))[0];
    expect(lot).toMatchObject({ qty: 10, redeemed: 2, committed: 2, buyerNodeId: byName("Juazeiro").id });
    expect((await listAll(store, "cert_coupons")).map((c) => c.code).sort()).toEqual(["CEARA20", "JUAZEIRO10"]);
    const { renewalWorld } = await import("@/domain/network");
    const sit = new Set((await renewalWorld(store)).rows.map((r) => r.situation));
    for (const s of ["due_7", "due_30", "due_60", "expired", "lost"]) expect(sit.has(s as any)).toBe(true);
    expect((await listAll(store, "cert_renewal_contacts")).length).toBe(2);
    // §46 — financeiro em camadas da demonstração
    const { effectiveAgreement, walletIdOf, networkResult } = await import("@/domain/network");
    expect((await effectiveAgreement(store, byName("Juazeiro").id)).terms.mode).toBe("prepaid");
    expect((await effectiveAgreement(store, byName("Fortaleza").id)).terms).toMatchObject({ mode: "postpaid", period: "biweekly" });
    expect((await effectiveAgreement(store, byName("Salvador").id)).terms).toMatchObject({ mode: "commission", commissionSettlement: "split" });
    expect((await effectiveAgreement(store, byName("Ceará").id)).terms).toMatchObject({ mode: "postpaid", period: "monthly" });
    const jua = byName("Juazeiro");
    const w = (await store.get("cert_wallets", walletIdOf(jua.id, jua.parentNodeId)))!;
    expect(w.balance).toBeLessThan(100000);
    expect(w.held).toBeGreaterThan(0); // a venda aguardando pagamento reserva o custo
    const fin = await listAll(store, "cert_sale_finance");
    expect(fin.every((f) => !(f.issues ?? []).length)).toBe(true);
    const entries = await listAll(store, "cert_fin_entries");
    expect(entries.some((e) => e.settlement === "wallet")).toBe(true);
    expect(entries.some((e) => e.settlement === "split" && e.payeeNodeId === byName("Salvador").id)).toBe(true);
    expect(entries.some((e) => e.kind === "ac_cost" && e.status === "accrued")).toBe(true);
    expect(entries.some((e) => e.kind === "referral")).toBe(true);
    const ftzClosings = (await listAll(store, "cert_closings")).filter((c) => c.payerNodeId === byName("Fortaleza").id);
    expect(ftzClosings).toHaveLength(1);
    expect(entries.some((e) => e.payerNodeId === byName("Fortaleza").id && e.kind === "cost" && e.status === "accrued")).toBe(true);
    const platCompany = (await listAll(store, "companies")).find((c) => String(c.name).includes("Intercert Certificação Digital"))!;
    const platUser = (await listAll(store, "users")).find((u) => u.login === "rede")!;
    const pctx2 = { store: scopeStore(store, platCompany.id), companyId: platCompany.id, branchId: null, user: await toCtxUser(store, platUser, platCompany.id) };
    expect((await networkResult(pctx2)).totals.difference).toBe(0);
    // repetível
    await seedDemo(store, { historyDays: 1 });
    expect((await allNodes(store)).length).toBe(nodes.length);
    expect((await listAll(store, "certificate_requests")).filter((r) => r.channel === "network").length).toBe(sales.length);
  }, 120000);
});
