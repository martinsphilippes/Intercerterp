import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { formatBps, formatMoney, marginBps, pct, roundDiv } from "@/lib/money";
import { assert, BusinessError } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { priceMetrics, priceScopeKey, savePrice, validatePrice } from "./pricing";

/**
 * Motor compartilhado de reajuste de preço (precificação após a entrada — COM-07 — e alteração em massa — CAD-18).
 *
 *  - Regras: margem-alvo sobre o custo (preço = custo ÷ (1 − margem)), markup (custo × (1 + markup)), % sobre o preço
 *    atual, valor fixo e "manter a margem atual" (margem do preço atual sobre o custo anterior aplicada ao custo novo).
 *  - Arredondamento comercial opcional (terminar em ,90 / ,99 / ,00), por padrão para cima (nunca abaixo do calculado).
 *  - Prévia sem gravação (preço atual, custo, novo preço, margem antes/depois, variação) e aplicação explícita linha a
 *    linha: o preço de cada SKU muda pelo `savePrice` (histórico em `price_history` com motivo + auditoria do preço).
 *  - Aplicação em lotes de até 24 SKUs por transação (≤ 100 escritas: marcador + preço + histórico + auditoria),
 *    idempotente pela chave do envio (marcadores em `operations`); a linha só é gravada se o preço atual ainda for o da
 *    prévia (proteção contra alteração concorrente).
 *  - Altera sempre o preço geral (todas as filiais, sem início de vigência) da tabela escolhida; preços específicos de
 *    filial ou com vigência futura não são tocados.
 * Margem e markup são os de `priceMetrics` (src/lib/money.ts) — o motor só faz o caminho inverso (preço a partir da margem).
 */

/** Limite de escritas por transação do Appwrite (TablesDB). */
export const MAX_TX_OPS = 100;
/** Escritas por SKU na aplicação de preço: preço + até 2 linhas de histórico (preço/atacado) + auditoria. */
export const PRICE_OPS_PER_ITEM = 4;
/** SKUs por transação: (100 − 1 marcador) ÷ 4. */
export const ITEMS_PER_TX = Math.floor((MAX_TX_OPS - 1) / PRICE_OPS_PER_ITEM);
/** Máximo de linhas por aplicação. */
export const MAX_APPLY_LINES = 2000;

export type PriceEnding = "none" | "00" | "90" | "99";
export type RoundingMode = "up" | "nearest";

export const PRICE_ENDINGS: Array<{ value: PriceEnding; label: string }> = [
  { value: "none", label: "Sem arredondamento" },
  { value: "90", label: "Terminar em ,90" },
  { value: "99", label: "Terminar em ,99" },
  { value: "00", label: "Valor inteiro (,00)" },
];

/**
 * Arredondamento comercial: leva o preço (centavos) ao final escolhido. "up" (padrão) = menor valor ≥ calculado com
 * esse final (ex.: 10,13 → 10,90; 10,95 → 11,90); "nearest" = o mais próximo (empate para cima).
 */
export function commercialRound(cents: number, ending: PriceEnding = "none", mode: RoundingMode = "up"): number {
  if (ending === "none" || !Number.isFinite(cents) || cents <= 0) return cents;
  const e = Number(ending);
  let up = Math.floor(cents / 100) * 100 + e;
  if (up < cents) up += 100;
  if (mode === "up") return up;
  const down = up - 100;
  if (down <= 0) return up;
  return cents - down < up - cents ? down : up;
}

/** Preço pela margem sobre o preço: custo ÷ (1 − margem). null sem custo. */
export function priceFromMargin(cost: number, marginTargetBps: number): number | null {
  assert(Number.isInteger(marginTargetBps) && marginTargetBps >= 0 && marginTargetBps < 10000, "A margem deve estar entre 0% e 99,99%.");
  if (!(cost > 0)) return null;
  return roundDiv(cost * 10000, 10000 - marginTargetBps);
}

/** Preço pelo markup sobre o custo: custo × (1 + markup). null sem custo. */
export function priceFromMarkup(cost: number, markupTargetBps: number): number | null {
  assert(Number.isInteger(markupTargetBps) && markupTargetBps >= 0, "Markup inválido.");
  if (!(cost > 0)) return null;
  return cost + pct(cost, markupTargetBps);
}

export type PriceRule =
  | { kind: "margin"; marginBps: number }
  | { kind: "markup"; markupBps: number }
  | { kind: "percent"; percentBps: number }
  | { kind: "fixed"; price: number }
  /** margem atual (preço atual × custo anterior) aplicada ao custo novo; sem margem válida, usa `fallbackMarginBps` */
  | { kind: "keep_margin"; fallbackMarginBps: number };

export const PRICE_RULES: Array<{ value: PriceRule["kind"]; label: string }> = [
  { value: "percent", label: "Reajuste em % sobre o preço atual" },
  { value: "margin", label: "Margem-alvo sobre o custo" },
  { value: "markup", label: "Markup sobre o custo" },
  { value: "fixed", label: "Valor fixo" },
];

export function validateRule(rule: PriceRule) {
  switch (rule.kind) {
    case "margin":
      assert(Number.isInteger(rule.marginBps) && rule.marginBps >= 0 && rule.marginBps < 10000, "A margem-alvo deve estar entre 0% e 99,99%.");
      return;
    case "markup":
      assert(Number.isInteger(rule.markupBps) && rule.markupBps >= 0 && rule.markupBps <= 1000000, "O markup deve estar entre 0% e 10.000%.");
      return;
    case "percent":
      assert(Number.isInteger(rule.percentBps) && rule.percentBps > -10000 && rule.percentBps <= 1000000 && rule.percentBps !== 0, "Informe um reajuste diferente de 0% (redução até −99,99%).");
      return;
    case "fixed":
      assert(Number.isInteger(rule.price) && rule.price > 0, "Informe um valor maior que zero.");
      return;
    case "keep_margin":
      assert(Number.isInteger(rule.fallbackMarginBps) && rule.fallbackMarginBps >= 0 && rule.fallbackMarginBps < 10000, "A margem padrão deve estar entre 0% e 99,99%.");
      return;
    default:
      throw new BusinessError("Regra de preço inválida.");
  }
}

export function describeRule(rule: PriceRule, ending: PriceEnding = "none"): string {
  const r =
    rule.kind === "margin" ? `margem-alvo de ${formatBps(rule.marginBps)}`
    : rule.kind === "markup" ? `markup de ${formatBps(rule.markupBps)}`
    : rule.kind === "percent" ? `reajuste de ${rule.percentBps > 0 ? "+" : ""}${formatBps(rule.percentBps)}`
    : rule.kind === "fixed" ? `valor fixo de ${formatMoney(rule.price)}`
    : `manter a margem atual (padrão ${formatBps(rule.fallbackMarginBps)})`;
  return ending === "none" ? r : `${r}, arredondado para ,${ending}`;
}

/** Preço calculado pela regra (sem arredondamento comercial) e observação para a prévia. */
export function rulePrice(rule: PriceRule, input: { cost: number | null; currentPrice: number | null; oldCost?: number | null }): { price: number | null; note: string | null } {
  const cost = input.cost ?? 0;
  switch (rule.kind) {
    case "margin": {
      const p = priceFromMargin(cost, rule.marginBps);
      return p == null ? { price: null, note: "Sem custo cadastrado: margem não se aplica." } : { price: p, note: null };
    }
    case "markup": {
      const p = priceFromMarkup(cost, rule.markupBps);
      return p == null ? { price: null, note: "Sem custo cadastrado: markup não se aplica." } : { price: p, note: null };
    }
    case "percent":
      if (!input.currentPrice || input.currentPrice <= 0) return { price: null, note: "Sem preço atual na tabela: reajuste em % não se aplica." };
      return { price: input.currentPrice + pct(input.currentPrice, rule.percentBps), note: null };
    case "fixed":
      return { price: rule.price, note: null };
    case "keep_margin": {
      if (!(cost > 0)) return { price: null, note: "Sem custo: não há como sugerir pela margem." };
      const base = input.oldCost != null && input.oldCost > 0 ? input.oldCost : cost;
      const m = input.currentPrice && input.currentPrice > 0 ? marginBps(input.currentPrice, base) : null;
      if (m != null && m > 0 && m < 10000) return { price: priceFromMargin(cost, m), note: `Mantém a margem atual (${formatBps(m)}).` };
      return { price: priceFromMargin(cost, rule.fallbackMarginBps), note: `Sem margem atual válida: margem padrão (${formatBps(rule.fallbackMarginBps)}).` };
    }
  }
}

// ───────────────────────────── Alvos (SKU × tabela)

export interface PriceTarget {
  skuId: string;
  productId: string;
  sku: string;
  name: string;
  unitCode: string | null;
  /** custo de referência (custo total do SKU, ou o informado pela precificação da entrada) */
  cost: number;
  currentPrice: number | null;
  priceId: string | null;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  maxDiscountBps: number | null;
  validTo: string | null;
}

/** Carrega SKUs da empresa com o preço geral (sem filial, sem início de vigência) da tabela. */
export async function loadPriceTargets(ctx: Ctx, skuIds: string[], priceTableId: string): Promise<{ table: Doc; targets: Map<string, PriceTarget> }> {
  const table = await ctx.store.get("price_tables", priceTableId);
  assert(table && table.companyId === ctx.companyId, "Tabela de preço inválida.");
  const ids = [...new Set(skuIds.filter(Boolean))];
  const targets = new Map<string, PriceTarget>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [skus, prices] = await Promise.all([
      listAll(ctx.store, "skus", { filters: [["eq", "id", chunk]] }),
      listAll(ctx.store, "prices", { filters: [["eq", "priceTableId", priceTableId], ["eq", "skuId", chunk]] }),
    ]);
    const base = new Map<string, Doc>();
    for (const p of prices) if (p.scopeKey === priceScopeKey(priceTableId, p.skuId, null, null)) base.set(p.skuId, p);
    for (const s of skus) {
      if (s.companyId !== ctx.companyId) continue;
      const p = base.get(s.id) ?? null;
      targets.set(s.id, {
        skuId: s.id,
        productId: s.productId,
        sku: s.sku,
        name: s.name ?? s.sku,
        unitCode: s.unitCode ?? null,
        cost: s.costTotal ?? s.costAcquisition ?? 0,
        currentPrice: p ? p.price : null,
        priceId: p?.id ?? null,
        wholesalePrice: p?.wholesalePrice ?? null,
        wholesaleMinQty: p?.wholesaleMinQty ?? null,
        maxDiscountBps: p?.maxDiscountBps ?? null,
        validTo: p?.validTo ?? null,
      });
    }
  }
  return { table, targets };
}

export type LineStatus = "change" | "same" | "skip" | "error";

export interface PriceLine {
  skuId: string;
  productId: string | null;
  sku: string;
  name: string;
  cost: number | null;
  currentPrice: number | null;
  newPrice: number | null;
  marginBefore: number | null;
  marginAfter: number | null;
  markupAfter: number | null;
  /** variação do novo preço sobre o atual (pontos-base) */
  variationBps: number | null;
  status: LineStatus;
  message: string | null;
  warning: string | null;
}

/** Linha de prévia para um novo preço (validações iguais às da gravação). */
export function previewLine(t: PriceTarget, newPrice: number | null, note: string | null = null): PriceLine {
  const before = priceMetrics(t.currentPrice, t.cost > 0 ? t.cost : null);
  const after = priceMetrics(newPrice, t.cost > 0 ? t.cost : null);
  const line: PriceLine = {
    skuId: t.skuId,
    productId: t.productId,
    sku: t.sku,
    name: t.name,
    cost: t.cost,
    currentPrice: t.currentPrice,
    newPrice,
    marginBefore: before.marginBps,
    marginAfter: after.marginBps,
    markupAfter: after.markupBps,
    variationBps: newPrice != null && t.currentPrice ? roundDiv((newPrice - t.currentPrice) * 10000, t.currentPrice) : null,
    status: "change",
    message: note,
    warning: null,
  };
  if (newPrice == null) return { ...line, status: "skip", message: note ?? "Sem novo preço." };
  if (!Number.isInteger(newPrice) || newPrice <= 0) return { ...line, status: "error", message: "O novo preço deve ser maior que zero." };
  if (t.wholesalePrice && t.wholesalePrice > newPrice) return { ...line, status: "error", message: `O preço de atacado (${formatMoney(t.wholesalePrice)}) ficaria maior que o novo preço: ajuste o atacado no cadastro do produto.` };
  if (newPrice === t.currentPrice) return { ...line, status: "same", message: note ?? "Preço já é este." };
  if (t.cost > 0 && newPrice < t.cost) line.warning = "Abaixo do custo.";
  return line;
}

export function previewTotals(lines: PriceLine[]) {
  return {
    lines: lines.length,
    change: lines.filter((l) => l.status === "change").length,
    same: lines.filter((l) => l.status === "same").length,
    skip: lines.filter((l) => l.status === "skip").length,
    error: lines.filter((l) => l.status === "error").length,
    belowCost: lines.filter((l) => l.status === "change" && l.warning).length,
  };
}

export type PricingVia = "purchase.pricing" | "products.bulk_edit";

function requirePreview(ctx: Ctx, via: PricingVia) {
  requirePerm(ctx, "products", "view");
  requireAction(ctx, via);
}

/** Custos de referência informados pelo chamador (ex.: custo de entrada do recebimento) — substituem o do cadastro. */
export type CostOverrides = Record<string, { cost: number; oldCost?: number | null }>;

/** Prévia de uma regra para uma lista de SKUs (nada é gravado). */
export async function previewPriceRule(
  ctx: Ctx,
  input: { via: PricingVia; skuIds: string[]; priceTableId: string; rule: PriceRule; ending?: PriceEnding; rounding?: RoundingMode; costs?: CostOverrides },
) {
  requirePreview(ctx, input.via);
  validateRule(input.rule);
  assert(input.skuIds.length > 0, "Selecione ao menos um produto.");
  assert(input.skuIds.length <= MAX_APPLY_LINES, `Selecione no máximo ${MAX_APPLY_LINES} itens por vez.`);
  const { targets } = await loadPriceTargets(ctx, input.skuIds, input.priceTableId);
  const lines: PriceLine[] = [];
  for (const id of [...new Set(input.skuIds)]) {
    const t0 = targets.get(id);
    if (!t0) continue;
    const ov = input.costs?.[id];
    const t = ov ? { ...t0, cost: ov.cost } : t0;
    const r = rulePrice(input.rule, { cost: t.cost, currentPrice: t.currentPrice, oldCost: ov?.oldCost ?? null });
    const price = r.price == null ? null : input.rule.kind === "fixed" ? r.price : commercialRound(r.price, input.ending ?? "none", input.rounding ?? "up");
    lines.push(previewLine(t, price, r.note));
  }
  return { lines, totals: previewTotals(lines) };
}

/** Prévia de preços informados linha a linha (ajuste manual) — mesmas validações da gravação. */
export async function previewPriceChanges(ctx: Ctx, input: { via: PricingVia; priceTableId: string; lines: Array<{ skuId: string; newPrice: number | null }>; costs?: CostOverrides }) {
  requirePreview(ctx, input.via);
  assert(input.lines.length > 0, "Nenhum item para a prévia.");
  assert(input.lines.length <= MAX_APPLY_LINES, `No máximo ${MAX_APPLY_LINES} itens por vez.`);
  const { targets } = await loadPriceTargets(ctx, input.lines.map((l) => l.skuId), input.priceTableId);
  const lines: PriceLine[] = [];
  for (const l of input.lines) {
    const t0 = targets.get(l.skuId);
    if (!t0) continue;
    const ov = input.costs?.[l.skuId];
    lines.push(previewLine(ov ? { ...t0, cost: ov.cost } : t0, l.newPrice));
  }
  return { lines, totals: previewTotals(lines) };
}

// ───────────────────────────── Execução em lotes idempotentes

export interface BatchOutcome {
  ok: boolean;
  message: string | null;
  /** aplicado numa execução anterior com a mesma chave */
  replayed?: boolean;
}

/**
 * Executa `apply` para cada item em transações de até `perTx` itens. Cada lote grava, na MESMA transação, um marcador
 * determinístico em `operations` (chave do trabalho + itens do lote): repetir o trabalho (mesma chave) ou concorrer com
 * ele não reaplica o lote. Se um lote falhar por regra de negócio, seus itens são refeitos um a um (marcador por item),
 * isolando o item com erro sem perder os demais. O `txCtx` entregue ao `apply` é um objeto novo a cada tentativa de
 * transação e é o mesmo para todos os itens dela (o `apply` pode associar a ele estado da transação, ex.: sequência de conta).
 */
export async function runIdempotentBatches<T extends { key: string }>(
  ctx: Ctx,
  opts: { jobId: string; type: string; items: T[]; perTx: number; opsPerItem: number; apply: (txCtx: Ctx, item: T) => Promise<void> },
): Promise<Map<string, BatchOutcome>> {
  assert(opts.perTx > 0 && opts.perTx * opts.opsPerItem + 1 <= MAX_TX_OPS, "Lote excede o limite de escritas por transação.");
  const out = new Map<string, BatchOutcome>();
  for (let start = 0, n = 0; start < opts.items.length; start += opts.perTx, n++) {
    const chunk = opts.items.slice(start, start + opts.perTx);
    // marcador pelo conteúdo do lote: a mesma lista (repetição) cai nos mesmos marcadores
    const markerId = detId("bulk", opts.jobId, ...chunk.map((c) => c.key));
    const prev = await ctx.store.get("operations", markerId);
    if (prev) {
      const failed: Record<string, string> = prev.result?.failed ?? {};
      for (const it of chunk) out.set(it.key, failed[it.key] ? { ok: false, message: failed[it.key], replayed: true } : { ok: true, message: null, replayed: true });
      continue;
    }
    let chunkDone = false;
    try {
      chunkDone = await retryOnConflict(async () => {
        if (await ctx.store.get("operations", markerId)) return false;
        return ctx.store.transaction(async (t) => {
          await t.create("operations", { companyId: ctx.companyId, type: opts.type, status: "done", entityType: "bulk_job", entityId: opts.jobId, result: { chunk: n, keys: chunk.map((c) => c.key), failed: {} }, createdBy: ctx.user.id }, markerId);
          const txCtx: Ctx = { ...ctx, store: t };
          for (const it of chunk) await opts.apply(txCtx, it);
          return true;
        });
      });
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e;
      // lote com item inválido: refaz item a item, isolando o erro
      const failed: Record<string, string> = {};
      for (const it of chunk) {
        const itemMarker = detId("bulk", opts.jobId, "item", it.key);
        try {
          await retryOnConflict(async () => {
            if (await ctx.store.get("operations", itemMarker)) return;
            await ctx.store.transaction(async (t) => {
              await t.create("operations", { companyId: ctx.companyId, type: `${opts.type}.item`, status: "done", entityType: "bulk_job", entityId: opts.jobId, result: { chunk: n, key: it.key }, createdBy: ctx.user.id }, itemMarker);
              await opts.apply({ ...ctx, store: t }, it);
            });
          });
          out.set(it.key, { ok: true, message: null });
        } catch (err) {
          if (!(err instanceof BusinessError)) throw err;
          failed[it.key] = err.message;
          out.set(it.key, { ok: false, message: err.message });
        }
      }
      await ctx.store
        .create("operations", { companyId: ctx.companyId, type: opts.type, status: "done", entityType: "bulk_job", entityId: opts.jobId, result: { chunk: n, keys: chunk.map((c) => c.key), failed }, createdBy: ctx.user.id }, markerId)
        .catch((err) => {
          if (!isConflict(err)) throw err;
        });
      continue;
    }
    for (const it of chunk) out.set(it.key, chunkDone ? { ok: true, message: null } : { ok: true, message: null, replayed: true });
  }
  return out;
}

/** Registro do trabalho (lote) em `operations`: criado ao iniciar, concluído com o resumo. */
async function startJob(ctx: Ctx, jobId: string, type: string, entityType: string, entityId: string | null) {
  const existing = await ctx.store.get("operations", jobId);
  if (existing) return existing;
  try {
    return await ctx.store.create("operations", { companyId: ctx.companyId, type, status: "running", entityType, entityId, result: { startedAt: nowIso() }, createdBy: ctx.user.id }, jobId);
  } catch (e) {
    if (!isConflict(e)) throw e;
    return ctx.store.getOrThrow("operations", jobId);
  }
}

export interface ApplyLineResult {
  skuId: string;
  sku: string;
  name: string;
  oldPrice: number | null;
  newPrice: number;
  status: "applied" | "same" | "skipped" | "error";
  message: string | null;
}

export interface ApplyResult {
  jobId: string;
  replayed: boolean;
  applied: number;
  same: number;
  skipped: number;
  errors: number;
  lines: ApplyLineResult[];
}

/**
 * Aplica novos preços (já revisados na prévia) na tabela escolhida. `expectedPrice` é o preço atual mostrado na prévia:
 * se mudou desde então, a linha é ignorada (refaça a prévia). Exige a operação especial (`via`) e alterar produtos.
 * Idempotente por `idemKey`: repetir devolve o mesmo resultado e não grava de novo.
 */
export async function applyPriceChanges(
  ctx: Ctx,
  input: {
    via: PricingVia;
    priceTableId: string;
    lines: Array<{ skuId: string; newPrice: number; expectedPrice: number | null }>;
    reason: string;
    idemKey: string;
    related?: string[];
    entity?: { type: string; id: string };
  },
): Promise<ApplyResult> {
  requireAction(ctx, input.via);
  requirePerm(ctx, "products", "edit");
  assert(input.idemKey, "Chave de idempotência ausente.");
  const reason = input.reason?.trim();
  assert(reason, "Informe o motivo da alteração de preço.");
  assert(input.lines.length > 0, "Nenhum preço para aplicar.");
  assert(input.lines.length <= MAX_APPLY_LINES, `No máximo ${MAX_APPLY_LINES} itens por vez.`);
  const seen = new Set<string>();
  for (const l of input.lines) {
    assert(!seen.has(l.skuId), "Item repetido na lista de preços.");
    seen.add(l.skuId);
    assert(Number.isInteger(l.newPrice) && l.newPrice > 0, "Todos os novos preços devem ser maiores que zero.");
  }
  const jobId = detId("pricejob", ctx.companyId, input.idemKey);
  const job = await ctx.store.get("operations", jobId);
  if (job?.status === "done" && job.result?.summary) return { ...(job.result.summary as ApplyResult), replayed: true };
  const { table } = await loadPriceTargets(ctx, [], input.priceTableId);
  await startJob(ctx, jobId, "price.adjust", input.entity?.type ?? "price_table", input.entity?.id ?? table.id);

  const results = new Map<string, ApplyLineResult>();
  // validação por lote, com os preços relidos imediatamente antes da gravação
  const items = input.lines.map((l) => ({ key: l.skuId, line: l }));
  const outcomes = await runIdempotentBatches(ctx, {
    jobId,
    type: "price.adjust.batch",
    items,
    perTx: ITEMS_PER_TX,
    opsPerItem: PRICE_OPS_PER_ITEM,
    apply: async (txCtx, it) => {
      const { targets } = await loadPriceTargets(txCtx, [it.key], input.priceTableId);
      const t = targets.get(it.key);
      const l = it.line;
      if (!t) {
        results.set(it.key, { skuId: it.key, sku: "?", name: "?", oldPrice: null, newPrice: l.newPrice, status: "error", message: "Produto não encontrado nesta empresa." });
        return;
      }
      const base = { skuId: t.skuId, sku: t.sku, name: t.name, oldPrice: t.currentPrice, newPrice: l.newPrice };
      if ((t.currentPrice ?? null) !== (l.expectedPrice ?? null)) {
        results.set(it.key, { ...base, status: "skipped", message: `O preço mudou desde a prévia (agora ${formatMoney(t.currentPrice)}). Gere a prévia novamente.` });
        return;
      }
      if (t.currentPrice === l.newPrice) {
        results.set(it.key, { ...base, status: "same", message: "Preço já era este." });
        return;
      }
      if (t.wholesalePrice && t.wholesalePrice > l.newPrice) throw new BusinessError(`${t.sku}: o preço de atacado (${formatMoney(t.wholesalePrice)}) ficaria maior que o novo preço.`);
      validatePrice({ price: l.newPrice, wholesalePrice: t.wholesalePrice, wholesaleMinQty: t.wholesaleMinQty, maxDiscountBps: t.maxDiscountBps, validTo: t.validTo });
      await savePrice(txCtx, {
        id: t.priceId,
        priceTableId: input.priceTableId,
        skuId: t.skuId,
        branchId: null,
        price: l.newPrice,
        wholesalePrice: t.wholesalePrice,
        wholesaleMinQty: t.wholesaleMinQty,
        maxDiscountBps: t.maxDiscountBps,
        validFrom: null,
        validTo: t.validTo,
        reason,
      });
      results.set(it.key, { ...base, status: "applied", message: null });
    },
  });
  // carrega os preços para o resumo (linhas de lotes já aplicados anteriormente ou com erro)
  const { targets: after } = await loadPriceTargets(ctx, input.lines.map((l) => l.skuId), input.priceTableId);
  const lines: ApplyLineResult[] = input.lines.map((l) => {
    const o = outcomes.get(l.skuId);
    const r = results.get(l.skuId);
    const t = after.get(l.skuId);
    const base = { skuId: l.skuId, sku: t?.sku ?? r?.sku ?? "?", name: t?.name ?? r?.name ?? "?", oldPrice: l.expectedPrice ?? null, newPrice: l.newPrice };
    if (o && !o.ok) return { ...base, status: "error", message: o.message };
    if (r && o && !o.replayed) return r.status === "applied" ? { ...r, oldPrice: l.expectedPrice ?? null } : r;
    // lote aplicado numa execução anterior: confere o preço atual
    return t?.currentPrice === l.newPrice ? { ...base, status: "applied", message: o?.replayed ? "Aplicado anteriormente." : null } : { ...base, status: "skipped", message: r?.message ?? "Não aplicado (preço diferente do previsto)." };
  });
  const summary: ApplyResult = {
    jobId,
    replayed: false,
    applied: lines.filter((l) => l.status === "applied").length,
    same: lines.filter((l) => l.status === "same").length,
    skipped: lines.filter((l) => l.status === "skipped").length,
    errors: lines.filter((l) => l.status === "error").length,
    lines,
  };
  await ctx.store.update("operations", jobId, {
    status: "done",
    result: { finishedAt: nowIso(), reason, priceTableId: input.priceTableId, summary: { ...summary, lines: summary.lines.slice(0, 300) } },
  });
  await audit(ctx, {
    module: input.via === "purchase.pricing" ? "purchases" : "products",
    action: "price.bulk_adjust",
    entityType: "price_adjustment",
    entityId: jobId,
    summary: `${reason}: ${summary.applied} preço(s) alterado(s) na tabela ${table.name}${summary.same ? `, ${summary.same} sem mudança` : ""}${summary.skipped ? `, ${summary.skipped} ignorado(s)` : ""}${summary.errors ? `, ${summary.errors} com erro` : ""}`,
    after: { priceTableId: table.id, applied: summary.applied, skipped: summary.skipped, errors: summary.errors, changes: lines.filter((l) => l.status === "applied").map((l) => ({ sku: l.sku, de: l.oldPrice, para: l.newPrice })) },
    reason,
    related: [`price_table:${table.id}`, ...(input.related ?? [])],
  });
  return summary;
}
