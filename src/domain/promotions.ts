import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { isFeatureOn } from "@/lib/core/settings";
import { describePromotion, describeWhen, promotionProblem, type PromoKind, type PromoRule, type PromoScope } from "./promotions-calc";

/**
 * Promoções (CAD-15) — cadastro e leitura das regras vigentes.
 *
 * Onde fica: coleção própria `promotions` (regras), e NÃO `prices.promoRule`. Justificativa (docs/regras-assumidas.md §32):
 *  1. regra por CATEGORIA (ex.: "terça da papelaria") não cabe em `prices`, que é uma linha por tabela × SKU × filial ×
 *     início de vigência — seria preciso replicar a regra em cada SKU e os SKUs cadastrados depois ficariam de fora;
 *  2. a vigência/dia/horário da promoção é independente da vigência do preço: presa a uma linha de `prices`, a regra
 *     sumiria no primeiro reajuste (novo preço = nova linha com início mais recente);
 *  3. a regra não é um preço concorrente — o preço continua vindo só de `prices` (`resolvePrices`); a promoção vira
 *     desconto explícito do item. Assim não há "tabela de promoções paralela a prices" (05-nao-duplicar.md).
 * O "preço promocional com vigência" que já existia (linha de `prices` com validFrom/validTo) continua valendo como antes.
 *
 * Liga/desliga: `feature.promocoes` (Parâmetros › Recursos, padrão ligado). Desligado, nenhuma regra é aplicada
 * (venda idêntica à de antes) e a tela some.
 */

export interface PromotionInput {
  name: string;
  kind: PromoKind;
  scope: PromoScope;
  targetIds: string[];
  buyQty?: number | null;
  payQty?: number | null;
  minQty?: number | null;
  promoPrice?: number | null;
  percentBps?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  weekdays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
  branchId?: string | null;
  active?: boolean;
  notes?: string | null;
}

export function promotionsEnabled(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, "promocoes", true);
}

/** Documento → regra pura (o que o PDV e o cálculo usam). */
export function toPromoRule(d: Doc): PromoRule {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    scope: d.scope,
    targetIds: Array.isArray(d.targetIds) ? d.targetIds : [],
    buyQty: d.buyQty ?? null,
    payQty: d.payQty ?? null,
    minQty: d.minQty ?? null,
    promoPrice: d.promoPrice ?? null,
    percentBps: d.percentBps ?? null,
    validFrom: d.validFrom ?? null,
    validTo: d.validTo ?? null,
    weekdays: Array.isArray(d.weekdays) ? d.weekdays : null,
    startTime: d.startTime ?? null,
    endTime: d.endTime ?? null,
    branchId: d.branchId ?? null,
    active: d.active !== false,
  };
}

/**
 * Regras que podem valer hoje ou depois na filial (ativas, sem vigência encerrada) — enviadas ao PDV e usadas na
 * conclusão da venda. Recurso desligado → lista vazia (nenhuma promoção é aplicada).
 */
export async function livePromotionRules(store: Store, companyId: string, branchId: string | null | undefined, date = today()): Promise<PromoRule[]> {
  if (!(await promotionsEnabled(store, companyId, branchId))) return [];
  const rows = await listAll(store, "promotions", { filters: [["eq", "companyId", companyId], ["eq", "active", true]] });
  return rows.filter((r) => (!r.validTo || r.validTo >= date) && (!r.branchId || !branchId || r.branchId === branchId)).map(toPromoRule);
}

export async function listPromotions(ctx: Ctx) {
  const rows = await listAll(ctx.store, "promotions", { filters: [["eq", "companyId", ctx.companyId]] });
  return rows.sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}

/** Situação para a listagem: ativa e vigente, agendada, encerrada ou inativa. */
export function promotionStatus(d: Pick<Doc, "active" | "validFrom" | "validTo">, date = today()): "active" | "scheduled" | "expired" | "inactive" {
  if (d.active === false) return "inactive";
  if (d.validTo && d.validTo < date) return "expired";
  if (d.validFrom && d.validFrom > date) return "scheduled";
  return "active";
}

function normalize(input: PromotionInput): PromotionInput {
  const kind = input.kind;
  return {
    name: String(input.name ?? "").trim().slice(0, 120),
    kind,
    scope: input.scope,
    targetIds: [...new Set((input.targetIds ?? []).filter((x) => typeof x === "string" && x))],
    buyQty: kind === "buy_x_pay_y" ? (input.buyQty ?? null) : null,
    payQty: kind === "buy_x_pay_y" ? (input.payQty ?? null) : null,
    minQty: kind === "min_qty" ? (input.minQty ?? null) : null,
    promoPrice: kind === "min_qty" && input.promoPrice != null ? input.promoPrice : null,
    percentBps: kind === "min_qty" && input.promoPrice == null && input.percentBps ? input.percentBps : null,
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
    weekdays: input.weekdays && input.weekdays.length && input.weekdays.length < 7 ? [...new Set(input.weekdays)].sort((a, b) => a - b) : null,
    startTime: input.startTime || null,
    endTime: input.endTime || null,
    branchId: input.branchId || null,
    active: input.active !== false,
    notes: input.notes?.trim().slice(0, 500) || null,
  };
}

async function checkTargets(ctx: Ctx, scope: PromoScope, ids: string[]) {
  const coll = scope === "sku" ? "skus" : scope === "product" ? "products" : "categories";
  const docs = await listAll(ctx.store, coll, { filters: [["eq", "id", ids]] });
  const ok = new Set(docs.filter((d) => d.companyId === ctx.companyId).map((d) => d.id));
  const missing = ids.filter((i) => !ok.has(i));
  assert(!missing.length, `${missing.length} item(ns) escolhido(s) não existem nesta empresa.`);
}

/** Cria ou altera uma promoção (idempotente na criação pela chave do formulário). */
export async function savePromotion(ctx: Ctx, input: PromotionInput & { id?: string | null; idemKey?: string | null }) {
  requirePerm(ctx, "products", input.id ? "edit" : "create");
  const data = normalize(input);
  const problem = promotionProblem(data as Partial<PromoRule>);
  if (problem) throw new BusinessError(problem, "invalid_promotion");
  await checkTargets(ctx, data.scope, data.targetIds);
  if (data.branchId) {
    const b = await ctx.store.getOrThrow("branches", data.branchId);
    assert(b.companyId === ctx.companyId, "Filial de outra empresa.");
  }
  let before: Doc | null = null;
  let saved: Doc;
  if (input.id) {
    before = await ctx.store.getOrThrow("promotions", input.id);
    assert(before.companyId === ctx.companyId, "Promoção de outra empresa.");
    saved = await ctx.store.update("promotions", before.id, data as Record<string, any>);
  } else {
    const idemKey = input.idemKey ? `promotion:${ctx.companyId}:${input.idemKey}` : null;
    const id = idemKey ? detId("promotion", idemKey) : undefined;
    const existing = id ? await ctx.store.get("promotions", id) : null;
    if (existing) return existing;
    saved = await ctx.store.create("promotions", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data, idemKey }, id);
  }
  await audit(ctx, {
    module: "products", action: before ? "promotion.update" : "promotion.create", entityType: "promotion", entityId: saved.id,
    summary: `Promoção "${saved.name}" ${before ? "alterada" : "cadastrada"} — ${describePromotion(toPromoRule(saved), formatMoney)} (${describeWhen(toPromoRule(saved), (d) => d.split("-").reverse().join("/"))})${saved.active === false ? " — inativa" : ""}`,
    before: before ? { name: before.name, kind: before.kind, targetIds: before.targetIds, buyQty: before.buyQty, payQty: before.payQty, minQty: before.minQty, promoPrice: before.promoPrice, percentBps: before.percentBps, validFrom: before.validFrom, validTo: before.validTo, weekdays: before.weekdays, active: before.active } : undefined,
    after: { name: saved.name, kind: saved.kind, scope: saved.scope, targetIds: saved.targetIds, buyQty: saved.buyQty, payQty: saved.payQty, minQty: saved.minQty, promoPrice: saved.promoPrice, percentBps: saved.percentBps, validFrom: saved.validFrom, validTo: saved.validTo, weekdays: saved.weekdays, startTime: saved.startTime, endTime: saved.endTime, active: saved.active },
    related: [`promotions:${ctx.companyId}`],
  });
  return saved;
}

/** Ativa/inativa (a promoção nunca é apagada: vendas antigas guardam o id e o nome da regra). */
export async function setPromotionActive(ctx: Ctx, id: string, active: boolean) {
  requirePerm(ctx, "products", "edit");
  const p = await ctx.store.getOrThrow("promotions", id);
  assert(p.companyId === ctx.companyId, "Promoção de outra empresa.");
  if ((p.active !== false) === active) return p;
  const saved = await ctx.store.update("promotions", id, { active });
  await audit(ctx, { module: "products", action: active ? "promotion.activate" : "promotion.deactivate", entityType: "promotion", entityId: id, summary: `Promoção "${p.name}" ${active ? "ativada" : "inativada"}`, related: [`promotions:${ctx.companyId}`] });
  return saved;
}
