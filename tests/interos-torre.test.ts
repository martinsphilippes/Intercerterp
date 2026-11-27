import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { freshStore } from "./helpers";
import { detId, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { systemCtx } from "@/lib/core/ctx";
import { addDays, monthStart, startOfLocalDay, today } from "@/lib/dates";
import { setServiceCredentials } from "@/lib/service/credentials";
import { resetServiceRateLimits } from "@/lib/service/http";
import { seedDemo } from "@/domain/seed";
import { createCompanyWithDefaults } from "@/domain/setup";
import { commercialOverview, loadFacts, managerialReport, totalsOf, type ReportScope } from "@/domain/reports";
import { abcReport, getAbcLimits } from "@/domain/abc";
import { periodDocuments, summarize } from "@/domain/fiscal/reports";
import { financeSnapshot, fiscalSnapshot, openCashSessions, stockAlerts } from "@/app/(app)/dashboard/queries";
import { queryBalances } from "@/app/(app)/estoque/queries";
import { installmentKpis } from "@/app/(app)/financeiro/queries";
import { queryOrders } from "@/app/(app)/compras/pedidos/queries";

/**
 * Torre de Controle (Interos) — consultas analíticas v1. Os handlers são chamados como o Next chamaria (NextRequest +
 * params), com credenciais de serviço com escopos. Base: demonstração de varejo (7 dias de histórico) vinculada ao
 * Interos + uma segunda empresa vinculada, com dados próprios, para conferir o isolamento.
 */

const ROUTES = {
  resumo: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/resumo/route"),
  "vendas/serie": () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/vendas/serie/route"),
  "vendas/por-unidade": () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/vendas/por-unidade/route"),
  produtos: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/produtos/route"),
  skus: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/skus/route"),
  "transacoes/vendas": () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/transacoes/vendas/route"),
  "transacoes/devolucoes": () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/transacoes/devolucoes/route"),
  estoque: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/estoque/route"),
  financeiro: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/financeiro/route"),
  fiscal: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/fiscal/route"),
  compras: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/compras/route"),
  "comercio-digital": () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/comercio-digital/route"),
  adocao: () => import("@/app/api/interos/v1/empresas/[idEmpresa]/torre/adocao/route"),
} as const;
type RouteName = keyof typeof ROUTES;
const PERIOD_ROUTES: RouteName[] = ["resumo", "vendas/serie", "vendas/por-unidade", "produtos", "skus", "transacoes/vendas", "transacoes/devolucoes", "financeiro", "fiscal", "compras", "comercio-digital"];
const DETAIL_ROUTES: RouteName[] = ["produtos", "skus", "estoque"];
const TRANSACTION_ROUTES: RouteName[] = ["transacoes/vendas", "transacoes/devolucoes"];

const SECRET = "x".repeat(40);
const ALL = `Bearer torre-teste.${SECRET}`;
const ONLY_SUMMARY = `Bearer torre-resumo.${"y".repeat(40)}`;
const ONLY_DETAIL = `Bearer torre-detalhe.${"z".repeat(40)}`;

let store: Store;
let demoId: string;
let demoBranches: string[];
let other: { id: string; branchId: string };
let notLinkedId: string;
let P: { de: string; ate: string };

type R = { status: number; body: any; headers: Headers };
async function get(route: RouteName, query: Record<string, string> = {}, opts: { auth?: string | null; company?: string } = {}): Promise<R> {
  const idEmpresa = opts.company ?? demoId;
  const { GET } = await ROUTES[route]();
  const url = new URL(`http://erp.test/api/interos/v1/empresas/${idEmpresa}/torre/${route}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers.authorization = opts.auth ?? ALL;
  const res: Response = await GET(new NextRequest(url, { headers }), { params: Promise.resolve({ idEmpresa }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** Percorre todas as páginas de uma lista (limite pequeno) e devolve os itens na ordem recebida. */
async function allPages(route: RouteName, query: Record<string, string>, limit: number) {
  const items: any[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r = await get(route, { ...query, limite: String(limit), ...(cursor ? { cursor } : {}) });
    expect(r.status).toBe(200);
    expect(r.body.itens.length).toBeLessThanOrEqual(limit);
    items.push(...r.body.itens);
    cursor = r.body.proximoCursor;
    pages++;
    expect(pages).toBeLessThan(500);
  } while (cursor);
  return { items, pages };
}

const ctxOf = (companyId: string) => systemCtx(store, companyId);
const scopeOf = (over: Partial<ReportScope> = {}): ReportScope => ({ companyId: demoId, branchIds: null, from: P.de, to: P.ate, ...over });
const at = (date: string, hour: number) => new Date(new Date(startOfLocalDay(date)).getTime() + hour * 3600000).toISOString();

/** Segunda empresa (vinculada ao Interos) com dados próprios em cada domínio — nada disso pode aparecer na demonstração. */
async function seedOtherCompany() {
  const { company, branch } = await createCompanyWithDefaults(store, { name: "Outra Varejista Ltda", tradeName: "Outra Varejista", key: "torre-outra" });
  const oc = company.id as string;
  const ob = branch.id as string;
  await store.update("companies", oc, { interosAccountId: "acc-outra" });
  const base = { companyId: oc, branchId: ob };
  const d = today();
  await store.create("categories", { companyId: oc, name: "Categoria da Outra", status: "active" }, "cat-outra");
  await store.create("products", { companyId: oc, type: "product", name: "Produto da Outra", code: "OUTRA-PROD", categoryId: "cat-outra", active: true, unitCode: "UN" }, "prod-outra-1");
  await store.create("skus", { companyId: oc, productId: "prod-outra-1", sku: "OUTRA-SKU", name: "Produto da Outra", active: true, unitCode: "UN" }, "sku-outra-1");
  await store.create("warehouses", { ...base, code: "PRINC", name: "Depósito da Outra", kind: "available", isDefault: true, status: "active" }, "dep-outra");
  await store.create("stock_balances", { ...base, warehouseId: "dep-outra", skuId: "sku-outra-1", productId: "prod-outra-1", physical: 3000, reserved: 0, inTransit: 0, avgCost: 7777, minQty: 5000, lastMovementAt: at(d, 10) }, "saldo-outra-1");
  await store.create(
    "sales",
    { ...base, number: 9001, status: "completed", origin: "pdv", operatorId: "op-outra", customerId: "cli-outra", completedAt: at(d, 15), subtotal: 987654, discountTotal: 0, surchargeTotal: 0, total: 987654, costTotal: 123457, itemsCount: 1, returnedTotal: 0, returnedCost: 0, fiscalStatus: "pending" },
    "venda-outra-1",
  );
  await store.create(
    "sale_items",
    { ...base, saleId: "venda-outra-1", seq: 1, skuId: "sku-outra-1", productId: "prod-outra-1", sku: "OUTRA-SKU", description: "Produto da Outra", unitCode: "UN", qty: 1000, unitPrice: 987654, grossTotal: 987654, itemDiscount: 0, globalDiscount: 0, surcharge: 0, total: 987654, unitCost: 123457, costTotal: 123457, returnedQty: 0, categoryId: "cat-outra", completedAt: at(d, 15) },
    "venda-outra-1-i1",
  );
  await store.create("sales", { ...base, number: 9002, status: "cancelled", origin: "pdv", completedAt: at(d, 16), cancelledAt: at(d, 17), subtotal: 4321, discountTotal: 0, surchargeTotal: 0, total: 4321, costTotal: 0, itemsCount: 1 }, "venda-outra-cancelada");
  await store.create("returns", { ...base, number: 9101, saleId: "venda-outra-1", kind: "return", status: "completed", compensation: "store_credit", itemsTotal: 55555, costTotal: 7000, customerId: "cli-outra", completedAt: at(d, 18) }, "devolucao-outra-1");
  await store.create("return_items", { ...base, returnId: "devolucao-outra-1", saleId: "venda-outra-1", saleItemId: "venda-outra-1-i1", skuId: "sku-outra-1", qty: 1000, total: 55555, costTotal: 7000, completedAt: at(d, 18) }, "devolucao-outra-1-1");
  await store.create("titles", { ...base, kind: "receivable", status: "open", number: 9201, total: 444441, balance: 444441, issueDate: d, competenceDate: d, originType: "manual", partyName: "Cliente da Outra" }, "titulo-outra-1");
  await store.create("installments", { ...base, titleId: "titulo-outra-1", kind: "receivable", number: 1, dueDate: addDays(d, -3), amount: 444441, paid: 0, balance: 444441, status: "open" }, "parcela-outra-1");
  await store.create("fiscal_documents", { ...base, model: "nfce", status: "rejected", ref: "ref-outra-1", total: 333331, issuedAt: at(d, 15), isSimulated: false }, "doc-fiscal-outra-1");
  await store.create("purchase_orders", { ...base, number: 9301, supplierId: "fornecedor-outra", status: "in_review", total: 111113, receivedValue: 0, supplierSnapshot: { name: "Fornecedor da Outra" } }, "pedido-compra-outra-1");
  await store.create("terminals", { ...base, code: "CX99", name: "Caixa da Outra", status: "active" }, "terminal-outra");
  await store.create("cash_sessions", { ...base, terminalId: "terminal-outra", operatorId: "op-outra", status: "open", number: 1, openedAt: at(d, 8), openingFund: 10000 }, "sessao-outra-1");
  await store.create("audit_logs", { companyId: oc, branchId: ob, userId: "usuario-outra", userName: "Usuária da Outra", module: "sales", action: "sale.complete", entityType: "sale", entityId: "venda-outra-1", summary: "Venda", result: "success", occurredAt: new Date().toISOString() }, "auditoria-outra-1");
  await store.create("jobs", { companyId: oc, type: "sale.effects", status: "dead", dedupeKey: "job-outra-1", attempts: 8, lastError: "falha" }, "tarefa-outra-1");
  await store.create("stores", { companyId: oc, name: "Loja da Outra", slug: "loja-da-outra", status: "published" }, "loja-outra");
  await store.create("online_orders", { ...base, storeId: "loja-outra", number: 1, code: "OUT-1", token: "tok-outra-1", status: "paid", paymentStatus: "paid", subtotal: 222221, discount: 0, shippingAmount: 0, total: 222221, createdAt: at(d, 9), paidAt: at(d, 9) }, "pedido-online-outra-1");
  return { id: oc, branchId: ob };
}

/** Marcas únicas da segunda empresa: nenhuma resposta da demonstração pode conter qualquer uma delas. */
const OTHER_MARKERS = () => [
  other.id, other.branchId, "venda-outra", "devolucao-outra", "sku-outra", "prod-outra", "OUTRA-SKU", "OUTRA-PROD", "cat-outra", "dep-outra", "saldo-outra", "titulo-outra",
  "parcela-outra", "doc-fiscal-outra", "pedido-compra-outra", "terminal-outra", "sessao-outra", "usuario-outra", "tarefa-outra", "loja-outra", "pedido-online-outra", "cli-outra", "op-outra",
  "Outra Varejista", "Produto da Outra", "Depósito da Outra", "Categoria da Outra",
];

beforeAll(async () => {
  store = freshStore();
  const r = await seedDemo(store, { historyDays: 7 });
  demoId = r.companyId;
  await store.update("companies", demoId, { interosAccountId: "acc-demo" });
  demoBranches = (await listAll(store, "branches", { filters: [["eq", "companyId", demoId]] })).map((b) => b.id);
  other = await seedOtherCompany();
  // empresa existente, com dados, mas NÃO vinculada ao Interos (escritório contábil da demonstração)
  const firm = (await listAll(store, "companies")).find((c) => c.id !== demoId && c.id !== other.id && !c.interosAccountId);
  notLinkedId = firm!.id;
  setServiceCredentials([
    { id: "torre-teste", escopos: ["torre:resumo", "torre:detalhe", "torre:transacoes"], segredo: SECRET },
    { id: "torre-resumo", escopos: ["torre:resumo"], segredo: "y".repeat(40) },
    { id: "torre-detalhe", escopos: ["torre:detalhe"], segredo: "z".repeat(40) },
  ]);
  P = { de: addDays(today(), -7), ate: today() };
}, 180000);

beforeEach(() => resetServiceRateLimits());

describe("Torre — números iguais aos das telas", () => {
  it("resumo de vendas e devoluções = base comercial do painel (commercialOverview / loadFacts + totalsOf)", async () => {
    const r = await get("resumo", P);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-request-id")).toBeTruthy();
    expect(r.body.meta).toMatchObject({ idEmpresa: demoId, periodo: { de: P.de, ate: P.ate }, unidades: null, fuso: "America/Sao_Paulo", versaoIndicadores: "2026-11-v1" });
    expect(Date.parse(r.body.meta.geradoEm)).toBeGreaterThan(0);
    const ov = await commercialOverview(store, scopeOf());
    const t = totalsOf((await loadFacts(store, scopeOf())).lines);
    expect(ov.totals).toEqual(t);
    const v = r.body.vendas;
    expect(t.salesCount).toBeGreaterThan(0);
    expect(v).toMatchObject({
      receitaBrutaCentavos: t.gross,
      descontosCentavos: t.discounts,
      acrescimosCentavos: t.surcharges,
      receitaAntesDevolucoesCentavos: t.salesNet,
      devolucoesCentavos: t.returns,
      receitaLiquidaCentavos: t.netRevenue,
      custoMercadoriaVendidaCentavos: t.cmv,
      lucroBrutoCentavos: t.grossProfit,
      margemBrutaBps: t.marginBps,
      quantidadeVendas: t.salesCount,
      quantidadeDevolucoes: t.returnsCount,
      ticketMedioCentavos: t.ticket,
      quantidadeVendidaMilesimos: t.qtySold,
      quantidadeDevolvidaMilesimos: t.qtyReturned,
      canceladas: { quantidade: ov.cancelled.count, valorCentavos: ov.cancelled.total },
    });
    expect(v.periodoAnterior).toMatchObject({ de: ov.previousScope.from, ate: ov.previousScope.to, receitaLiquidaCentavos: ov.previous.netRevenue, quantidadeVendas: ov.previous.salesCount });
    expect(v.porCanal.pdv.receitaLiquidaCentavos).toBe(t.netRevenue);
    // pedidos on-line ficam fora da receita comercial (RBC-8), informados à parte
    expect(v.porCanal.comercioDigital).toMatchObject({ incluidoNaReceitaLiquida: false });
    expect(r.body.devolucoes).toMatchObject({ valorCentavos: t.returns, quantidadeDocumentos: t.returnsCount, custoRevertidoCentavos: t.costReturned });
    expect(r.body.devolucoes.porSituacao.reduce((a: number, x: any) => a + x.valorCentavos, 0)).toBe(t.returns);
    // nenhum valor monetário em ponto flutuante
    const money: number[] = [];
    JSON.stringify(r.body, (k, val) => (k.endsWith("Centavos") && typeof val === "number" && money.push(val), val));
    expect(money.length).toBeGreaterThan(20);
    expect(money.every(Number.isInteger)).toBe(true);
  });

  it("filtro por unidade = recorte da filial na base comercial", async () => {
    const [matriz] = demoBranches;
    const r = await get("resumo", { ...P, idUnidade: matriz });
    expect(r.status).toBe(200);
    expect(r.body.meta.unidades).toEqual([matriz]);
    const t = totalsOf((await loadFacts(store, scopeOf({ branchIds: [matriz] }))).lines);
    expect(r.body.vendas).toMatchObject({ receitaLiquidaCentavos: t.netRevenue, quantidadeVendas: t.salesCount, devolucoesCentavos: t.returns });
    // as duas filiais juntas = consolidado
    const both = await get("resumo", { ...P, idUnidade: demoBranches.join(",") });
    const all = await get("resumo", P);
    expect(both.body.vendas.receitaLiquidaCentavos).toBe(all.body.vendas.receitaLiquidaCentavos);
  });

  it("blocos operacionais = consultas do painel, do estoque, do financeiro, do fiscal, de compras e do comércio digital", async () => {
    const r = await get("resumo", P);
    const ctx = ctxOf(demoId);
    // PDV
    const open = await openCashSessions(ctx, demoBranches);
    expect(r.body.pdv.posicaoAtual.caixasEmAberto).toBe(open.length);
    expect(r.body.pdv.noPeriodo.caixasAbertos).toBeGreaterThan(0);
    // estoque (tela de saldos + alertas do painel)
    const bals = await queryBalances(ctx, { q: "", f: { filial: "all" } });
    const alerts = await stockAlerts(ctx, demoBranches);
    expect(r.body.estoque.posicaoAtual).toMatchObject({
      saldos: bals.length,
      valorCentavos: bals.reduce((a, b) => a + b.value, 0),
      abaixoDoMinimo: alerts.length,
      rupturas: alerts.filter((a) => a.available <= 0).length,
    });
    // financeiro (contas a receber/pagar e saldo do painel)
    const rec = await installmentKpis(ctx, "receivable", null);
    const pay = await installmentKpis(ctx, "payable", null);
    const snap = await financeSnapshot(ctx, demoBranches, true);
    const fin = r.body.financeiro.posicaoAtual;
    expect(fin.aReceber.emAberto).toEqual({ quantidade: rec.open.count, valorCentavos: rec.open.amount });
    expect(fin.aReceber.vencido).toEqual({ quantidade: rec.overdue.count, valorCentavos: rec.overdue.amount });
    expect(fin.aReceber.vencido).toEqual({ quantidade: snap.receivableOverdue.count, valorCentavos: snap.receivableOverdue.amount });
    expect(fin.aPagar.emAberto).toEqual({ quantidade: pay.open.count, valorCentavos: pay.open.amount });
    expect(fin.aPagar.vencido).toEqual({ quantidade: snap.payableOverdue.count, valorCentavos: snap.payableOverdue.amount });
    expect(fin.aPagar.aAutorizar).toEqual({ quantidade: pay.pendingApproval.count, valorCentavos: pay.pendingApproval.amount });
    expect(fin.saldoContasCentavos).toBe(snap.accountsTotal);
    // fiscal (resumo fiscal do painel + relatórios fiscais)
    const fs = await fiscalSnapshot(ctx, demoBranches, { from: P.de, to: P.ate });
    expect(r.body.fiscal.posicaoAtual.pendencias).toEqual({ pendentes: fs.totals.pending, processando: fs.totals.processing, rejeitados: fs.totals.rejected });
    expect(r.body.fiscal.noPeriodo.simuladas.quantidade).toBe(fs.grid.reduce((a, g) => a + g.simulatedCount, 0));
    expect(r.body.fiscal.noPeriodo.autorizadas.quantidade).toBe(fs.grid.reduce((a, g) => a + g.authorizedCount, 0));
    const f = { from: P.de, to: P.ate, branchId: null, model: null, includeSimulated: true };
    const sm = summarize(await periodDocuments(ctx, f), f);
    expect(r.body.fiscal.noPeriodo.faturamentoFiscal).toEqual({ brutoCentavos: sm.gross, devolucoesCentavos: sm.returns, liquidoCentavos: sm.net, documentos: sm.revenueCount });
    // compras (tela de pedidos)
    const orders = await queryOrders(ctx, { q: "", f: {} });
    const inReview = orders.filter((o) => o.status === "in_review");
    expect(r.body.compras.posicaoAtual.aguardandoAprovacao).toEqual({ quantidade: inReview.length, valorCentavos: inReview.reduce((a, o) => a + o.total, 0) });
    const openPo = orders.filter((o) => ["approved", "sent", "partial"].includes(o.status));
    expect(r.body.compras.posicaoAtual.aReceber.valorRestanteCentavos).toBe(openPo.reduce((a, o) => a + o.remainingValue, 0));
    // comércio digital (pedidos da loja)
    const online = await listAll(store, "online_orders", { filters: [["eq", "companyId", demoId]] });
    expect(online.length).toBeGreaterThan(0);
    expect(r.body.comercioDigital.lojaCriada).toBe(true);
    expect(r.body.comercioDigital.posicaoAtual.aguardandoPagamento).toBe(online.filter((o) => o.status === "pending_payment").length);
    expect(r.body.comercioDigital.posicaoAtual.aExpedirOuRetirar).toBe(online.filter((o) => ["invoiced", "ready_for_pickup"].includes(o.status)).length);
  });

  it("série (dia e mês) e resultado por unidade = relatórios gerenciais", async () => {
    const rep = await managerialReport(store, scopeOf(), { compare: true, branchIds: demoBranches });
    const day = await get("vendas/serie", { ...P, granularidade: "dia" });
    expect(day.status).toBe(200);
    expect(day.body.granularidade).toBe("dia");
    expect(day.body.itens).toHaveLength(8);
    expect(day.body.itens.map((p: any) => [p.data, p.receitaLiquidaCentavos, p.quantidadeVendas])).toEqual(rep.byDay.map((d) => [d.id, d.netRevenue, d.salesCount]));
    const month = await get("vendas/serie", { de: addDays(today(), -45), ate: today(), granularidade: "mes" });
    expect(month.status).toBe(200);
    const t45 = totalsOf((await loadFacts(store, scopeOf({ from: addDays(today(), -45) }))).lines);
    expect(month.body.itens.reduce((a: number, p: any) => a + p.receitaLiquidaCentavos, 0)).toBe(t45.netRevenue);
    expect(month.body.itens[0].de).toBe(addDays(today(), -45));
    expect(month.body.itens.at(-1).ate).toBe(today());
    expect(month.body.total.receitaLiquidaCentavos).toBe(t45.netRevenue);
    const units = await get("vendas/por-unidade", P);
    expect(units.status).toBe(200);
    expect(units.body.itens.map((u: any) => [u.idUnidade, u.receitaLiquidaCentavos, u.quantidadeVendas, u.margemBrutaBps])).toEqual(rep.byBranch.map((b) => [b.id, b.netRevenue, b.salesCount, b.marginBps]));
    expect(units.body.total.receitaLiquidaCentavos).toBe(rep.totals.netRevenue);
  });

  it("SKUs = curva ABC da tela (classe, posição, participação); produtos somam a mesma receita", async () => {
    const limits = await getAbcLimits(store, demoId, null);
    const abc = await abcReport(store, scopeOf(), { criterion: "receita", limits });
    const { items } = await allPages("skus", { ...P, incluirSemMovimento: "1" }, 4);
    const all = [...abc.classification.base.map((x) => x.row), ...abc.classification.excluded.map((x) => x.row)];
    expect(items).toHaveLength(all.length);
    const bySku = new Map(items.map((i) => [i.idSku, i]));
    for (const x of abc.classification.base) {
      expect(bySku.get(x.row.skuId)).toMatchObject({ classeAbc: x.klass, posicaoAbc: x.rank, participacaoBps: x.shareBps, acumuladoBps: x.cumAfterBps, receitaLiquidaCentavos: x.row.netRevenue, quantidadeLiquidaMilesimos: x.row.qtyNet });
    }
    // ordem por receita (desc) e as primeiras posições na ordem da curva
    const ranked = items.filter((i) => i.posicaoAbc != null);
    expect(ranked.map((i) => i.posicaoAbc)).toEqual(ranked.map((_, k) => k + 1));
    for (let k = 1; k < items.length; k++) expect(items[k - 1].receitaLiquidaCentavos).toBeGreaterThanOrEqual(items[k].receitaLiquidaCentavos);
    expect(items.reduce((a, i) => a + i.receitaLiquidaCentavos, 0)).toBe(abc.revenue.total);
    // sem o parâmetro, SKUs sem movimento ficam fora da lista (mas contam no resumo da curva)
    const page = await get("skus", { ...P, limite: "500" });
    expect(page.body.itens.every((i: any) => !i.semMovimento)).toBe(true);
    expect(page.body.curva.semClasse.semMovimento).toBe(abc.classification.excluded.filter((x) => x.row.noMovement).length);
    expect(page.body.curva.limites).toEqual({ classeABps: limits.a, classeBBps: limits.b });
    // margem só com custo registrado
    expect(page.body.itens.every((i: any) => (i.custoRegistrado ? true : i.margemBrutaBps === null))).toBe(true);
    const prods = await allPages("produtos", P, 3);
    expect(prods.items.reduce((a, i) => a + i.receitaLiquidaCentavos, 0)).toBe(abc.revenue.total);
    expect(prods.items.filter((i) => i.posicaoAbc != null).map((i) => i.posicaoAbc)).toEqual(prods.items.filter((i) => i.posicaoAbc != null).map((_, k) => k + 1));
  });

  it("transações: vendas − devoluções da lista = receita líquida do resumo", async () => {
    const t = totalsOf((await loadFacts(store, scopeOf())).lines);
    const sales = await allPages("transacoes/vendas", P, 500);
    const rets = await allPages("transacoes/devolucoes", P, 500);
    expect(sales.items).toHaveLength(t.salesCount);
    expect(rets.items).toHaveLength(t.returnsCount);
    const net = sales.items.reduce((a, s) => a + s.valorLiquidoCentavos, 0) - rets.items.reduce((a, x) => a + x.valorCentavos, 0);
    expect(net).toBe(t.netRevenue);
    expect(sales.items.every((s) => s.situacao === "concluida" && s.canal === "pdv")).toBe(true);
    const withCancelled = await get("transacoes/vendas", { ...P, situacao: "todas", limite: "500" });
    const cancelled = withCancelled.body.itens.filter((s: any) => s.situacao === "cancelada");
    const ov = await commercialOverview(store, scopeOf());
    expect(cancelled).toHaveLength(ov.cancelled.count);
    expect(withCancelled.body.totais.canceladas).toEqual({ quantidade: ov.cancelled.count, valorLiquidoCentavos: ov.cancelled.total });
  });

  it("financeiro: recebido no mês = indicador das contas a receber; aging = relatórios financeiros", async () => {
    const r = await get("financeiro", { de: monthStart(today()), ate: today() });
    expect(r.status).toBe(200);
    const ctx = ctxOf(demoId);
    const rec = await installmentKpis(ctx, "receivable", null);
    const pay = await installmentKpis(ctx, "payable", null);
    expect(r.body.noPeriodo.recebido.valorCentavos).toBe(rec.monthSettled);
    expect(r.body.noPeriodo.pago.valorCentavos).toBe(pay.monthSettled);
    expect(r.body.posicaoAtual.aging.aReceber.totalCentavos).toBe(rec.open.amount);
    expect(r.body.noPeriodo.dre.conferenciaDiferencaCentavos).toBe(0);
    expect(r.body.posicaoAtual.contas.reduce((a: number, c: any) => a + c.saldoCentavos, 0)).toBe(r.body.posicaoAtual.saldoContasCentavos);
  });

  it("estoque detalhado: soma das posições = saldos da tela; abaixo do mínimo = alertas do painel", async () => {
    const ctx = ctxOf(demoId);
    const bals = await queryBalances(ctx, { q: "", f: { filial: "all" } });
    const { items } = await allPages("estoque", {}, 7);
    expect(items).toHaveLength(bals.length);
    expect(items.reduce((a, i) => a + i.valorCentavos, 0)).toBe(bals.reduce((a, b) => a + b.value, 0));
    expect(items.filter((i) => i.abaixoDoMinimo)).toHaveLength((await stockAlerts(ctx, demoBranches)).length);
    for (const i of items) expect(i.disponivelMilesimos).toBe(i.fisicoMilesimos - i.reservadoMilesimos);
    const r = await get("estoque", { limite: "1" });
    expect(r.body.meta.periodo).toBeNull();
  });

  it("rotas de detalhe operacional respondem com os mesmos blocos do resumo", async () => {
    const sum = await get("resumo", P);
    for (const [route, key] of [["compras", "compras"], ["comercio-digital", "comercioDigital"], ["fiscal", "fiscal"]] as const) {
      const r = await get(route, P);
      expect(r.status).toBe(200);
      expect(r.body.posicaoAtual).toMatchObject(sum.body[key].posicaoAtual);
    }
    const fiscal = await get("fiscal", P);
    expect(fiscal.body.noPeriodo.porModelo.reduce((a: number, m: any) => a + m.emitidos, 0)).toBe(sum.body.fiscal.noPeriodo.documentosEmitidos);
    expect(sum.body.fiscal.noPeriodo.porModelo).toEqual(fiscal.body.noPeriodo.porModelo);
    const adoption = await get("adocao");
    expect(adoption.status).toBe(200);
    expect(adoption.body.meta.periodo).toBeNull();
    expect(adoption.body.ultimaAtividade.fonte).toBe("auditoria");
    expect(adoption.body.ultimaAtividade.em).toBeTruthy();
    expect(adoption.body.usuariosAtivos.ultimos30Dias).toBeGreaterThan(0);
    expect(adoption.body.atividadeOperacional.ultimaVenda.em).toBeTruthy();
    expect(adoption.body.terminais.ultimaAtividadeEm).toBeNull();
    expect(adoption.body.pendenciasIntegracao.documentosFiscais).toEqual(sum.body.fiscal.posicaoAtual.pendencias);
  });
});

describe("Torre — acesso", () => {
  it("empresa não vinculada ao Interos (ou inexistente) → 404", async () => {
    for (const route of ["resumo", "estoque", "transacoes/vendas", "adocao"] as RouteName[]) {
      const r = await get(route, P, { company: notLinkedId });
      expect(r.status).toBe(404);
      expect(r.body.erro.codigo).toBe("nao_encontrado");
    }
    expect((await get("resumo", P, { company: "nao-existe" })).status).toBe(404);
  });

  it("credencial sem o escopo do nível de detalhe → 403; sem credencial → 401", async () => {
    for (const route of [...DETAIL_ROUTES, ...TRANSACTION_ROUTES]) {
      const r = await get(route, P, { auth: ONLY_SUMMARY });
      expect(r.status, route).toBe(403);
      expect(r.body.erro.codigo).toBe("sem_permissao");
    }
    expect((await get("resumo", P, { auth: ONLY_SUMMARY })).status).toBe(200);
    // escopo de detalhe não dá acesso às transações nem ao resumo
    expect((await get("skus", P, { auth: ONLY_DETAIL })).status).toBe(200);
    for (const route of [...TRANSACTION_ROUTES, "resumo", "financeiro"] as RouteName[]) expect((await get(route, P, { auth: ONLY_DETAIL })).status, route).toBe(403);
    expect((await get("resumo", P, { auth: null })).status).toBe(401);
  });

  it("filial de outra empresa (ou inexistente) em idUnidade → 422 validacao", async () => {
    for (const route of ["resumo", "skus", "estoque", "transacoes/vendas"] as RouteName[]) {
      const r = await get(route, { ...P, idUnidade: `${demoBranches[0]},${other.branchId}` });
      expect(r.status, route).toBe(422);
      expect(r.body.erro.codigo).toBe("validacao");
      expect(r.body.erro.campos.map((c: any) => c.campo)).toContain("idUnidade");
    }
    expect((await get("resumo", { ...P, idUnidade: "filial-que-nao-existe" })).status).toBe(422);
  });

  it("período: obrigatório, válido, de ≤ ate e no máximo 400 dias", async () => {
    const t = today();
    const cases: Array<[Record<string, string>, string]> = [
      [{ de: addDays(t, -400), ate: t }, "ate"], // 401 dias
      [{ ate: t }, "de"],
      [{ de: t }, "ate"],
      [{ de: "2026-02-30", ate: t }, "de"],
      [{ de: "01/11/2026", ate: t }, "de"],
      [{ de: t, ate: addDays(t, -1) }, "de"],
    ];
    for (const route of PERIOD_ROUTES) {
      for (const [q, campo] of cases) {
        const r = await get(route, q);
        expect(r.status, `${route} ${JSON.stringify(q)}`).toBe(422);
        expect(r.body.erro.codigo).toBe("validacao");
        expect(r.body.erro.campos.map((c: any) => c.campo)).toContain(campo);
      }
    }
    expect((await get("resumo", { de: addDays(t, -399), ate: t })).status).toBe(200);
    const bad = await get("transacoes/vendas", { ...P, limite: "0", situacao: "x" });
    expect(bad.status).toBe(422);
    expect(bad.body.erro.campos.map((c: any) => c.campo).sort()).toEqual(["limite", "situacao"]);
    expect((await get("vendas/serie", { ...P, granularidade: "semana" })).status).toBe(422);
    expect((await get("skus", { ...P, limite: "501" })).status).toBe(422);
  });
});

describe("Torre — respeita o contrato (correção 6)", () => {
  it("módulo não contratado: bloco null no resumo, rota própria 409 modulo_nao_contratado, meta com os contratados", async () => {
    const before = (await store.get("companies", other.id))!;
    // contrato do provisionamento sem comércio digital, sem compras e sem fiscal
    await store.update("companies", other.id, { contract: { modules: ["pdv", "vendas", "estoque", "financeiro"] } });
    try {
      const r = await get("resumo", P, { company: other.id });
      expect(r.status).toBe(200);
      expect(r.body.meta.modulosContratados).toEqual(["estoque", "financeiro", "pdv", "vendas"]);
      expect(r.body.comercioDigital).toBeNull();
      expect(r.body.compras).toBeNull();
      expect(r.body.fiscal).toBeNull();
      expect(r.body.vendas).not.toBeNull();
      expect(r.body.vendas.porCanal.comercioDigital ?? null).toBeNull();
      expect(r.body.estoque).not.toBeNull();
      for (const route of ["comercio-digital", "compras", "fiscal"] as RouteName[]) {
        const x = await get(route, P, { company: other.id });
        expect(x.status, route).toBe(409);
        expect(x.body.erro.codigo).toBe("modulo_nao_contratado");
      }
      const ad = await get("adocao", {}, { company: other.id });
      expect(ad.body.atividadeOperacional.ultimoPedidoOnlineEm).toBeNull(); // a loja da outra existe, mas não foi contratada
      expect(ad.body.pendenciasIntegracao.documentosFiscais).toBeNull();
      // licença v2 aplicada passa a ser a referência: comércio digital licenciado volta a aparecer
      await store.create("company_licenses", { companyId: other.id, licenseVersion: 3, snapshot: { items: [{ code: "07.01", state: "active" }, { code: "12.01", state: "suspended" }] }, preservedAccess: [] }, detId("license", other.id));
      const lic = await get("resumo", P, { company: other.id });
      expect(lic.body.meta.modulosContratados).toEqual(["comercio_digital", "pdv"]); // suspenso continua contratado
      expect(lic.body.comercioDigital).not.toBeNull();
      expect(lic.body.estoque).toBeNull();
    } finally {
      await store.update("companies", other.id, { contract: before.contract ?? null });
      await store.delete("company_licenses", detId("license", other.id)).catch(() => undefined);
    }
  });
});

describe("Torre — paginação", () => {
  it("cursor percorre as listas sem repetir nem perder itens", async () => {
    const lists: Array<[RouteName, Record<string, string>, number]> = [
      ["transacoes/vendas", { ...P, situacao: "todas" }, 5],
      ["transacoes/devolucoes", P, 1],
      ["skus", { ...P, incluirSemMovimento: "1" }, 6],
      ["produtos", { ...P, incluirSemMovimento: "1" }, 4],
      ["estoque", {}, 7],
    ];
    const idOf = (route: RouteName, i: any) => i.idVenda ?? i.idDevolucao ?? i.idSaldo ?? i.idSku ?? i.idProduto;
    for (const [route, q, limit] of lists) {
      const full = await get(route, { ...q, limite: "500" });
      expect(full.body.proximoCursor).toBeNull();
      const paged = await allPages(route, q, limit);
      const ids = paged.items.map((i) => idOf(route, i));
      expect(new Set(ids).size, route).toBe(ids.length);
      expect(ids, route).toEqual(full.body.itens.map((i: any) => idOf(route, i)));
      expect(full.body.itens.length, route).toBeGreaterThan(limit);
      expect(paged.pages).toBe(Math.ceil(full.body.itens.length / limit));
    }
  });

  it("cursor inválido ou de outra consulta → 422", async () => {
    const first = await get("transacoes/vendas", { ...P, limite: "2" });
    const cursor = first.body.proximoCursor as string;
    expect(cursor).toBeTruthy();
    expect((await get("transacoes/vendas", { ...P, limite: "2", cursor })).status).toBe(200);
    for (const q of [
      { ...P, cursor: "nao-e-um-cursor" },
      { ...P, cursor, situacao: "todas" },
      { de: addDays(P.de, -1), ate: P.ate, cursor },
      { ...P, cursor, idUnidade: demoBranches[0] },
    ]) {
      const r = await get("transacoes/vendas", q);
      expect(r.status).toBe(422);
      expect(r.body.erro.campos[0].campo).toBe("cursor");
    }
    expect((await get("transacoes/devolucoes", { ...P, cursor })).status).toBe(422);
  });
});

describe("Torre — isolamento e dados pessoais", () => {
  it("nenhuma resposta da demonstração contém dados da outra empresa (e vice-versa)", async () => {
    const markers = OTHER_MARKERS();
    const demoMarkers = [demoId, ...demoBranches];
    for (const route of Object.keys(ROUTES) as RouteName[]) {
      // `limite` só vale nas rotas paginadas (as demais ignoram o parâmetro)
      const q = PERIOD_ROUTES.includes(route) ? { ...P, limite: "500" } : { limite: "500" };
      const r = await get(route, q);
      expect(r.status, route).toBe(200);
      const text = JSON.stringify(r.body);
      for (const m of markers) expect(text.includes(m), `${route} contém ${m}`).toBe(false);
      const o = await get(route, q, { company: other.id });
      expect(o.status, `outra ${route}`).toBe(200);
      expect(o.body.meta.idEmpresa).toBe(other.id);
      const otext = JSON.stringify(o.body);
      for (const m of demoMarkers) expect(otext.includes(m), `outra ${route} contém ${m}`).toBe(false);
    }
    // a outra empresa vê exatamente os próprios números
    const o = await get("resumo", P, { company: other.id });
    expect(o.body.vendas).toMatchObject({ receitaBrutaCentavos: 987654, devolucoesCentavos: 55555, receitaLiquidaCentavos: 987654 - 55555, quantidadeVendas: 1, canceladas: { quantidade: 1, valorCentavos: 4321 } });
    expect(o.body.estoque.posicaoAtual).toMatchObject({ saldos: 1, valorCentavos: 23331, abaixoDoMinimo: 1 });
    expect(o.body.financeiro.posicaoAtual.aReceber.vencido).toEqual({ quantidade: 1, valorCentavos: 444441 });
    expect(o.body.fiscal.posicaoAtual.pendencias.rejeitados).toBe(1);
    expect(o.body.compras.posicaoAtual.aguardandoAprovacao).toEqual({ quantidade: 1, valorCentavos: 111113 });
    expect(o.body.pdv.posicaoAtual.caixasEmAberto).toBe(1);
    expect(o.body.comercioDigital.posicaoAtual.aFaturar).toBe(1);
    const oa = await get("adocao", {}, { company: other.id });
    expect(oa.body.usuariosAtivos.ultimos30Dias).toBe(1);
    expect(oa.body.pendenciasIntegracao.tarefas.esgotadas).toBe(1);
    // a demonstração não soma nada da outra
    const d = await get("resumo", P);
    const t = totalsOf((await loadFacts(store, scopeOf())).lines);
    expect(d.body.vendas.receitaLiquidaCentavos).toBe(t.netRevenue);
  });

  it("transações não expõem CPF/CNPJ nem nome de clientes (só o id do cliente)", async () => {
    const customers = await listAll(store, "customers", { filters: [["eq", "companyId", demoId]] });
    expect(customers.length).toBeGreaterThan(0);
    // cadastro de clientes, retrato do cliente gravado na venda e comprador dos pedidos on-line
    const demoSales = await listAll(store, "sales", { filters: [["eq", "companyId", demoId]] });
    const online = await listAll(store, "online_orders", { filters: [["eq", "companyId", demoId]] });
    const people = [...customers, ...demoSales.map((s) => s.customerSnapshot ?? {}), ...online.map((o) => o.customer ?? {})];
    const secrets = [...new Set(people.flatMap((c: any) => [c.doc, c.cpf, c.cnpj, c.name, c.email, c.phone, c.mobile].filter((v): v is string => typeof v === "string" && v.length >= 8)))];
    expect(secrets.length).toBeGreaterThan(3);
    const sales = await get("transacoes/vendas", { ...P, situacao: "todas", limite: "500" });
    const rets = await get("transacoes/devolucoes", { ...P, limite: "500" });
    const ids = new Set(customers.map((c) => c.id));
    expect([...sales.body.itens, ...rets.body.itens].some((x: any) => x.idCliente && ids.has(x.idCliente))).toBe(true);
    for (const r of [sales, rets, await get("resumo", P), await get("comercio-digital", P)]) {
      const text = JSON.stringify(r.body);
      for (const s of secrets) expect(text.includes(s), `contém ${s}`).toBe(false);
    }
  });
});
