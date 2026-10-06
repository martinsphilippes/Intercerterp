import "server-only";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, dayRange, diffDays, toLocalDate, today } from "@/lib/dates";

/**
 * Blocos operacionais do painel (estoque, financeiro, fiscal, últimas vendas).
 * Os indicadores COMERCIAIS vêm do serviço único `domain/reports.ts`.
 */

export async function latestSales(ctx: Ctx, branchIds: string[], limit = 8) {
  const res = await ctx.store.list("sales", {
    filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchIds], ["notNull", "completedAt"]],
    orderBy: [{ field: "completedAt", dir: "desc" }],
    limit,
    total: false,
  });
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name as string]));
  const ids = res.items.map((s) => s.id);
  const pays = ids.length ? await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", ids]] }) : [];
  const docIds = res.items.map((s) => s.fiscalDocumentId).filter(Boolean);
  const docs = docIds.length ? new Map((await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "id", docIds]] })).map((d) => [d.id, d])) : new Map<string, Doc>();
  return res.items.map((s) => {
    const ps = pays.filter((p) => p.saleId === s.id).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const doc = s.fiscalDocumentId ? docs.get(s.fiscalDocumentId) : null;
    return {
      ...s,
      operatorName: s.operatorId ? (users.get(s.operatorId) ?? "—") : "—",
      paymentLabel: [...new Set(ps.map((p) => p.methodName || p.methodKind))].join(" + ") || "—",
      documentModel: doc?.model ?? null,
      documentNumber: doc?.number ?? null,
      /** documento gerado pelo provedor de simulação: exibido com o selo SIMULAÇÃO (sem validade fiscal) */
      documentSimulated: Boolean(doc?.isSimulated),
    };
  });
}

/** Caixas abertos nas filiais do recorte (situação do caixa no topo do painel). */
export async function openCashSessions(ctx: Ctx, branchIds: string[]) {
  const sessions = await listAll(ctx.store, "cash_sessions", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchIds], ["eq", "status", ["open", "reopened"]]] });
  if (!sessions.length) return [];
  const terminals = new Map((await listAll(ctx.store, "terminals", { filters: [["eq", "companyId", ctx.companyId]] })).map((t) => [t.id, t]));
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name as string]));
  return sessions.map((s) => ({ id: s.id, branchId: s.branchId, terminal: terminals.get(s.terminalId)?.name ?? "Terminal", operator: users.get(s.operatorId) ?? "—", openedAt: s.openedAt as string, stale: s.openedAt ? toLocalDate(s.openedAt) < today() : false }));
}

/** Certificados digitais A1 vencidos ou a vencer em até 30 dias (configurações fiscais do recorte). */
export async function certificateAlerts(ctx: Ctx, branchIds: string[]) {
  const cfgs = await listAll(ctx.store, "fiscal_configs", { filters: [["eq", "companyId", ctx.companyId]] });
  const ref = today();
  return cfgs
    .filter((c) => !c.branchId || branchIds.includes(c.branchId)) // configuração da empresa vale para todas as filiais
    .map((c) => {
      const validTo = c.certificate?.validTo ? String(c.certificate.validTo).slice(0, 10) : null;
      return validTo ? { id: c.id, branchId: c.branchId ?? null, validTo, daysLeft: diffDays(ref, validTo) } : null;
    })
    .filter((x): x is { id: string; branchId: string | null; validTo: string; daysLeft: number } => Boolean(x) && x!.daysLeft <= 30);
}

export interface StockAlert {
  branchId: string;
  warehouseId: string;
  warehouseName: string | null;
  warehouseDefault: boolean;
  skuId: string;
  productId: string | null;
  sku: string;
  name: string;
  unitCode: string | null;
  available: number;
  min: number;
}

/**
 * Saldos com disponível no mínimo ou abaixo (disponível ≤ mínimo — mesmo critério e mesma granularidade — saldo por depósito —
 * da listagem de Estoque com situação "Abaixo do mínimo", para o total abrir exatamente os mesmos registros).
 */
export async function stockAlerts(ctx: Ctx, branchIds: string[]): Promise<StockAlert[]> {
  const bals = await listAll(ctx.store, "stock_balances", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchIds]] });
  const alerts = bals
    .map((b) => ({ branchId: b.branchId as string, warehouseId: b.warehouseId as string, skuId: b.skuId as string, productId: (b.productId ?? null) as string | null, available: (b.physical ?? 0) - (b.reserved ?? 0), min: b.minQty ?? 0 }))
    .filter((x) => x.min > 0 && x.available <= x.min);
  const skuIds = [...new Set(alerts.map((a) => a.skuId))];
  const skus = new Map<string, Doc>();
  for (let i = 0; i < skuIds.length; i += 100) for (const s of await listAll(ctx.store, "skus", { filters: [["eq", "id", skuIds.slice(i, i + 100)]] })) skus.set(s.id, s);
  const whs = new Map((await listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchIds]] })).map((w) => [w.id, w]));
  return alerts
    .map((a) => {
      const s = skus.get(a.skuId);
      const w = whs.get(a.warehouseId);
      return { ...a, sku: s?.sku ?? a.skuId, name: s?.name ?? s?.sku ?? a.skuId, unitCode: s?.unitCode ?? null, warehouseName: w?.name ?? null, warehouseDefault: w?.kind === "available" };
    })
    .sort((a, b) => a.available / a.min - b.available / b.min || a.sku.localeCompare(b.sku));
}

/** Financeiro do recorte de filiais: vencidos, a pagar hoje/7 dias e saldo das contas. */
export async function financeSnapshot(ctx: Ctx, branchIds: string[], consolidated: boolean) {
  const ref = today();
  const in7 = addDays(ref, 7);
  const inScope = (d: Doc) => (d.branchId ? branchIds.includes(d.branchId) : consolidated);
  const open = (await listAll(ctx.store, "installments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["open", "partial"]]] })).filter(inScope);
  const sum = (rows: Doc[]) => ({ count: rows.length, amount: rows.reduce((a, i) => a + (i.balance ?? 0), 0) });
  const rec = open.filter((i) => i.kind === "receivable");
  const pay = open.filter((i) => i.kind === "payable");
  const accounts = (await listAll(ctx.store, "financial_accounts", { filters: [["eq", "companyId", ctx.companyId]] }))
    .filter((a) => a.active !== false && (a.branchId ? branchIds.includes(a.branchId) : true))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  return {
    ref,
    in7,
    receivableOverdue: sum(rec.filter((i) => i.dueDate < ref)),
    receivableToday: sum(rec.filter((i) => i.dueDate === ref)),
    payableOverdue: sum(pay.filter((i) => i.dueDate < ref)),
    payableToday: sum(pay.filter((i) => i.dueDate === ref)),
    payableNext7: sum(pay.filter((i) => i.dueDate > ref && i.dueDate <= in7)),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name as string, kind: a.kind as string, balance: a.balance ?? 0, shared: !a.branchId })),
    accountsTotal: accounts.reduce((a, x) => a + (x.balance ?? 0), 0),
  };
}

export const FISCAL_BUCKETS = {
  pending: { label: "Pendentes", statuses: ["pending", "draft", "contingency"], link: "pending", hint: "Aguardando dados, revisão ou transmissão" },
  processing: { label: "Processando", statuses: ["queued", "processing"], link: "processing", hint: "Na fila ou aguardando retorno da SEFAZ/prefeitura" },
  rejected: { label: "Rejeitados/erro", statuses: ["rejected", "denied", "error"], link: "rejected", hint: "Exigem correção e retransmissão" },
} as const;

export type FiscalBucket = keyof typeof FISCAL_BUCKETS;

/**
 * Resumo fiscal: autorizados no período (quantidade e valor, por modelo) e documentos que exigem
 * atenção (situação atual, independente do período). Documentos do provedor de SIMULAÇÃO não contam
 * como autorizados: vêm separados (`simulatedCount`/`simulatedTotal`) e são exibidos com o selo SIMULAÇÃO.
 */
export async function fiscalSnapshot(ctx: Ctx, branchIds: string[], period: { from: string; to: string }) {
  const { start, end } = dayRange(period.from, period.to);
  const authorized = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchIds], ["eq", "status", "authorized"], ["gte", "authorizedAt", start], ["lt", "authorizedAt", end]] });
  const all = Object.values(FISCAL_BUCKETS).flatMap((b) => [...b.statuses]);
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchIds], ["eq", "status", all]] });
  const models = ["nfce", "nfe", "nfse"] as const;
  const grid = models.map((m) => {
    const ofModel = docs.filter((d) => d.model === m);
    const counts = Object.fromEntries(
      (Object.keys(FISCAL_BUCKETS) as FiscalBucket[]).map((k) => [k, ofModel.filter((d) => (FISCAL_BUCKETS[k].statuses as readonly string[]).includes(d.status)).length]),
    ) as Record<FiscalBucket, number>;
    const auth = authorized.filter((d) => d.model === m);
    const real = auth.filter((d) => !d.isSimulated);
    const sim = auth.filter((d) => d.isSimulated);
    const sum = (rows: Doc[]) => rows.reduce((a, d) => a + (d.total ?? 0), 0);
    return { model: m, counts, authorizedCount: real.length, authorizedTotal: sum(real), simulatedCount: sim.length, simulatedTotal: sum(sim) };
  });
  const totals = Object.fromEntries((Object.keys(FISCAL_BUCKETS) as FiscalBucket[]).map((k) => [k, grid.reduce((a, g) => a + g.counts[k], 0)])) as Record<FiscalBucket, number>;
  const simulatedCount = grid.reduce((a, g) => a + g.simulatedCount, 0);
  return { grid, totals, simulatedCount };
}
