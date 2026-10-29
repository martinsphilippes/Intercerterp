import { listAll } from "@/lib/db";
import { NotFoundError, type Doc, type Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, formatDate, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { certificationSettings, type CertProduct } from "../accounting/certificates";
import { NETWORK_SCOPE, allNodes, auditNode, childLevelError, isLevel, isPlatform, networkSettings, nodeOfCompany, type NetworkLevel } from "./common";

/**
 * Preço em cascata da rede de certificação (§43).
 *
 * Cada nível compra do nível de cima por um CUSTO e vende ao de baixo; a Intercert compra da AC de 1º nível pelo
 * custo AC do catálogo. A regra de um nó é definida pelo PAI (ou pela plataforma, para qualquer nó):
 *   - `cost`: quanto o nó paga ao pai;   - `minPrice`: mínimo que o nó pode cobrar do cliente final;
 *   - `defaultPrice`: preço sugerido;    - `canEdit`: o nó pode alterar o preço de venda (respeitando o mínimo).
 * Duas formas de regra: "level" (tabela padrão do pai para todos os filhos de um nível) e "node" (exceção para um
 * filho). O nó sem regra própria herda a tabela padrão do pai para o nível dele.
 *
 * Invioláveis: cost(filho) ≥ cost(pai) (margem da camada nunca negativa); cost ≤ minPrice ≤ defaultPrice; o mínimo do
 * filho não fica abaixo do mínimo do pai; produto não editável no pai não fica editável no filho.
 * Vigência: `validFrom` (hoje ou futura); a regra nova encerra a anterior na véspera — o histórico é preservado.
 */

export interface RuleTerms {
  cost: number;
  minPrice: number;
  defaultPrice: number;
  canEdit: boolean;
}

export interface EffectivePrice extends RuleTerms {
  nodeId: string;
  productKey: string;
  source: "node" | "level";
  ruleId: string;
  validFrom: string;
  /** custo do nível de cima (custo AC para quem está direto abaixo da Intercert; null quando não informado) */
  parentCost: number | null;
  /** margem da camada de cima = cost(nó) − cost(pai) */
  parentMargin: number | null;
}

export interface PriceRuleInput extends RuleTerms {
  productKey: string;
  validFrom?: string | null;
  reason?: string | null;
}

/** Regra vigente na data? (inclusive nas pontas; regra substituída no mesmo dia não vale) */
export function ruleValidAt(r: Doc, date: string): boolean {
  return r.active !== false && String(r.validFrom) <= date && (!r.validTo || String(r.validTo) >= date);
}

/** Resolve a regra de um nó num conjunto de regras (função pura): a exceção do nó; senão, a tabela do pai para o nível. */
export function resolveRule(rules: Doc[], node: { id: string; parentNodeId?: string | null; level?: string }, productKey: string, date: string): Doc | null {
  const valid = rules.filter((r) => r.productKey === productKey && ruleValidAt(r, date));
  const latest = (xs: Doc[]) => xs.sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)) || String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
  const own = latest(valid.filter((r) => r.scope === "node" && r.nodeId === node.id));
  if (own) return own;
  return latest(valid.filter((r) => r.scope === "level" && (r.ownerNodeId ?? null) === (node.parentNodeId ?? null) && r.level === node.level));
}

/**
 * Valida os termos de uma regra contra os do nível de cima (função pura). Devolve as mensagens (vazio = válida).
 * `parent` null = termos ainda não definidos no nível de cima.
 */
export function ruleErrors(terms: RuleTerms, parent: RuleTerms | null, labels: { node?: string; parent?: string } = {}): string[] {
  const out: string[] = [];
  const who = labels.parent ?? "o nível de cima";
  for (const [k, l] of [["cost", "custo"], ["minPrice", "preço mínimo"], ["defaultPrice", "preço padrão"]] as const) {
    if (!Number.isInteger(terms[k]) || terms[k] < 0) out.push(`Informe o ${l} (valor em reais, sem negativos).`);
  }
  if (out.length) return out;
  if (terms.minPrice < terms.cost) out.push(`O preço mínimo (${formatMoney(terms.minPrice)}) não pode ficar abaixo do custo (${formatMoney(terms.cost)}).`);
  if (terms.defaultPrice < terms.minPrice) out.push(`O preço padrão (${formatMoney(terms.defaultPrice)}) não pode ficar abaixo do mínimo (${formatMoney(terms.minPrice)}).`);
  if (parent) {
    if (terms.cost < parent.cost) out.push(`Custo ${formatMoney(terms.cost)} abaixo do custo de ${who} (${formatMoney(parent.cost)}): ninguém vende abaixo do próprio custo — a margem da camada ficaria negativa (${formatMoney(terms.cost - parent.cost)}).`);
    if (terms.minPrice < parent.minPrice) out.push(`O preço mínimo (${formatMoney(terms.minPrice)}) não pode ficar abaixo do mínimo de ${who} (${formatMoney(parent.minPrice)}).`);
    if (terms.canEdit && !parent.canEdit) out.push(`O produto não é editável em ${who}: não pode ficar editável abaixo.`);
  }
  return out;
}

async function rulesOf(store: Store): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_price_rules", { filters: [["eq", "companyId", NETWORK_SCOPE]] });
}

/** Termos da plataforma para um produto: custo AC (0 quando não informado), sem mínimo, editável conforme o catálogo. */
export function platformTerms(p: CertProduct): RuleTerms {
  return { cost: Number(p.acCost ?? 0), minPrice: 0, defaultPrice: Number(p.price ?? 0), canEdit: p.editable !== false };
}

interface PriceWorld {
  nodes: Doc[];
  rules: Doc[];
  catalog: CertProduct[];
}

async function world(store: Store): Promise<PriceWorld> {
  const [nodes, rules, settings] = await Promise.all([allNodes(store), rulesOf(store), certificationSettings(store)]);
  return { nodes, rules, catalog: settings.catalog };
}

function effectiveIn(w: PriceWorld, nodeId: string, productKey: string, date: string): EffectivePrice | null {
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const rule = resolveRule(w.rules, node, productKey, date);
  if (!rule) return null;
  const parentCost = node.parentNodeId ? (effectiveIn(w, node.parentNodeId, productKey, date)?.cost ?? null) : (w.catalog.find((p) => p.key === productKey)?.acCost ?? null);
  return {
    nodeId, productKey, source: rule.scope === "node" ? "node" : "level", ruleId: rule.id, validFrom: rule.validFrom,
    cost: Number(rule.cost), minPrice: Number(rule.minPrice), defaultPrice: Number(rule.defaultPrice), canEdit: rule.canEdit !== false,
    parentCost: parentCost == null ? null : Number(parentCost), parentMargin: parentCost == null ? null : Number(rule.cost) - Number(parentCost),
  };
}

/** Termos do "dono" da regra (o pai; null = plataforma) para validar a regra do filho. */
function ownerTermsIn(w: PriceWorld, ownerNodeId: string | null, productKey: string, date: string): RuleTerms | null {
  if (!ownerNodeId) {
    const p = w.catalog.find((x) => x.key === productKey);
    return p ? platformTerms(p) : null;
  }
  return effectiveIn(w, ownerNodeId, productKey, date);
}

/**
 * Preço vigente de um nó para um produto numa data (pronto para a etapa 2: solicitação de certificado com o preço da
 * rede). Sem regra própria, herda a tabela padrão do pai para o nível do nó; sem nenhuma, null.
 */
export async function effectivePrice(store: Store, nodeId: string, productKey: string, date: string = today()): Promise<EffectivePrice | null> {
  return effectiveIn(await world(store), nodeId, productKey, date);
}

export interface ChainLevel {
  nodeId: string;
  name: string;
  level: string;
  /** quanto o nó paga ao de cima (ao pai; para quem está direto abaixo da Intercert, à Intercert) */
  cost: number;
  /** margem da camada de cima = cost(nó) − cost(pai) (ou − custo AC) */
  parentMargin: number | null;
  minPrice: number;
  defaultPrice: number;
  canEdit: boolean;
}

/**
 * Cascata de um nó para um produto (base do retrato da venda — §45): do nível mais alto até o nó, cada um com o custo
 * pago ao de cima, e o custo AC da Intercert. `null` quando algum nível do caminho não tem preço definido.
 */
export async function cascadeChain(store: Store, nodeId: string, productKey: string, date: string = today()): Promise<{ acCost: number | null; levels: ChainLevel[] } | null> {
  const w = await world(store);
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const ids = [...(node.path ?? []), node.id];
  const levels: ChainLevel[] = [];
  for (const id of ids) {
    const n = w.nodes.find((x) => x.id === id);
    const p = n ? effectiveIn(w, id, productKey, date) : null;
    if (!n || !p) return null;
    levels.push({ nodeId: id, name: n.name, level: n.level, cost: p.cost, parentMargin: p.parentMargin, minPrice: p.minPrice, defaultPrice: p.defaultPrice, canEdit: p.canEdit });
  }
  const ac = w.catalog.find((p) => p.key === productKey)?.acCost;
  return { acCost: ac == null ? null : Number(ac), levels };
}

/**
 * Confere que os termos novos de um nó não deixam a camada de baixo inválida: os filhos diretos (pela regra própria
 * ou pela tabela padrão que o nó definiu) e a própria tabela padrão do nó precisam continuar acima.
 */
function downstreamErrors(w: PriceWorld, nodeId: string, productKey: string, date: string, terms: RuleTerms): string[] {
  const out: string[] = [];
  const node = w.nodes.find((n) => n.id === nodeId);
  const name = node?.name ?? "o parceiro";
  for (const r of w.rules.filter((x) => x.scope === "level" && x.ownerNodeId === nodeId && x.productKey === productKey && (ruleValidAt(x, date) || (x.active !== false && String(x.validFrom) > date)))) {
    for (const e of ruleErrors({ cost: r.cost, minPrice: r.minPrice, defaultPrice: r.defaultPrice, canEdit: r.canEdit !== false }, terms, { parent: name })) out.push(`Tabela padrão de ${name} para o nível ${r.level}: ${e}`);
  }
  for (const c of w.nodes.filter((n) => n.parentNodeId === nodeId && n.status !== "closed")) {
    const own = resolveRule(w.rules.filter((x) => x.scope === "node"), c, productKey, date);
    if (!own) continue; // herda a tabela padrão (já conferida acima)
    for (const e of ruleErrors({ cost: own.cost, minPrice: own.minPrice, defaultPrice: own.defaultPrice, canEdit: own.canEdit !== false }, terms, { parent: name })) out.push(`${c.name}: ${e}`);
  }
  return out;
}

function cleanTerms(input: PriceRuleInput): RuleTerms {
  return { cost: Math.round(Number(input.cost)), minPrice: Math.round(Number(input.minPrice)), defaultPrice: Math.round(Number(input.defaultPrice)), canEdit: Boolean(input.canEdit) };
}

/** Grava a regra nova encerrando a anterior da mesma chave (véspera da vigência nova; no mesmo dia, substitui). */
async function persistRule(ctx: Ctx, w: PriceWorld, key: { scope: "node" | "level"; nodeId: string | null; ownerNodeId: string | null; level: string | null }, input: PriceRuleInput, terms: RuleTerms, validFrom: string): Promise<{ rule: Doc; previous: Doc | null }> {
  const base = unscoped(ctx.store);
  const same = w.rules.filter((r) => r.active !== false && r.scope === key.scope && r.productKey === input.productKey && (key.scope === "node" ? r.nodeId === key.nodeId : (r.ownerNodeId ?? null) === key.ownerNodeId && r.level === key.level));
  const future = same.find((r) => String(r.validFrom) > validFrom);
  if (future) throw new BusinessError(`Já existe uma regra com vigência futura (a partir de ${formatDate(future.validFrom)}) para este produto. Use uma vigência igual ou posterior.`, "future_rule");
  let previous: Doc | null = null;
  for (const r of same) {
    if (String(r.validFrom) === validFrom) {
      await base.update("cert_price_rules", r.id, { active: false, supersededAt: nowIso() });
      previous = r;
    } else if (!r.validTo || String(r.validTo) >= validFrom) {
      await base.update("cert_price_rules", r.id, { validTo: addDays(validFrom, -1) });
      previous = r;
    }
  }
  const rule = await base.create("cert_price_rules", {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, scope: key.scope, nodeId: key.nodeId, ownerNodeId: key.ownerNodeId, level: key.level, productKey: input.productKey,
    ...terms, validFrom, validTo: null, active: true, supersededAt: null, reason: input.reason?.trim()?.slice(0, 300) || null,
  });
  return { rule, previous };
}

function validFromOf(input: PriceRuleInput): string {
  const v = input.validFrom || today();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(v), "Data de vigência inválida.");
  assert(v >= today(), "A vigência começa hoje ou numa data futura (o histórico de preços não é reescrito).");
  return v;
}

function productOrThrow(w: PriceWorld, key: string): CertProduct {
  const p = w.catalog.find((x) => x.key === key);
  if (!p) throw new BusinessError("Produto fora do catálogo da certificação.", "product");
  return p;
}

const describe = (t: RuleTerms) => `custo ${formatMoney(t.cost)}, mínimo ${formatMoney(t.minPrice)}, padrão ${formatMoney(t.defaultPrice)}${t.canEdit ? ", preço editável" : ", preço fixo"}`;

/** Quem pode definir os preços dos filhos de um nó (null = plataforma, para os que estão direto abaixo da Intercert). */
async function assertCanPriceUnder(ctx: Ctx, ownerNodeId: string | null) {
  if (isPlatform(ctx)) return;
  const my = await nodeOfCompany(ctx.store, ctx.companyId);
  if (!ownerNodeId || !my || my.id !== ownerNodeId || !canDo(ctx.user, "network.prices")) {
    throw new PermissionError(ownerNodeId ? "Somente o parceiro de cima (operação “Definir os preços dos parceiros abaixo”) ou a plataforma define estes preços." : "Somente a plataforma Intercert define os preços de quem está diretamente abaixo dela.");
  }
  if (my.status !== "active") throw new BusinessError("Seu nó da rede não está ativo: os preços dos parceiros abaixo não podem ser alterados.", "inactive");
}

/** Exceção de preço para um nó (definida pelo pai do nó ou pela plataforma). */
export async function saveNodePriceRule(ctx: Ctx, nodeId: string, input: PriceRuleInput): Promise<Doc> {
  const w = await world(ctx.store);
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) throw new NotFoundError("cert_network_nodes", nodeId);
  await assertCanPriceUnder(ctx, node.parentNodeId ?? null);
  assert(node.status !== "closed", "Parceiro encerrado não recebe preços novos.");
  const product = productOrThrow(w, input.productKey);
  const validFrom = validFromOf(input);
  const terms = cleanTerms(input);
  const owner = ownerTermsIn(w, node.parentNodeId ?? null, product.key, validFrom);
  const parent = node.parentNodeId ? w.nodes.find((n) => n.id === node.parentNodeId) : null;
  if (!owner) throw new BusinessError(`${parent?.name ?? "O parceiro acima"} ainda não tem preço para ${product.label}: defina primeiro o preço dele.`, "owner_missing");
  const errs = [...ruleErrors(terms, owner, { parent: parent?.name ?? "a Intercert (custo AC)" }), ...downstreamErrors(w, node.id, product.key, validFrom, terms)];
  if (errs.length) throw new BusinessError(errs.join(" "), "price_rule");
  const { rule, previous } = await persistRule(ctx, w, { scope: "node", nodeId: node.id, ownerNodeId: node.parentNodeId ?? null, level: node.level }, input, terms, validFrom);
  await auditNode(ctx, node, {
    action: "network.price_rule", reason: rule.reason,
    summary: `Preço de ${product.label} para ${node.name} a partir de ${formatDate(validFrom)}: ${describe(terms)} · margem da camada de cima ${formatMoney(terms.cost - owner.cost)}${previous ? " (encerra a regra anterior)" : ""}`,
    before: previous ? { cost: previous.cost, minPrice: previous.minPrice, defaultPrice: previous.defaultPrice, canEdit: previous.canEdit, validFrom: previous.validFrom } : null, after: { ...terms, validFrom },
    related: [`cert_price_rule:${rule.id}`],
  });
  return rule;
}

/** Tabela padrão do pai (null = plataforma) para todos os filhos de um nível. */
export async function saveLevelPriceRule(ctx: Ctx, ownerNodeId: string | null, level: NetworkLevel, input: PriceRuleInput): Promise<Doc> {
  const w = await world(ctx.store);
  const { levelLabels } = await networkSettings(ctx.store);
  const owner = ownerNodeId ? w.nodes.find((n) => n.id === ownerNodeId) : null;
  if (ownerNodeId && !owner) throw new NotFoundError("cert_network_nodes", ownerNodeId);
  await assertCanPriceUnder(ctx, ownerNodeId);
  assert(isLevel(level), "Nível inválido.");
  const lvErr = childLevelError(owner?.level ?? null, level, levelLabels);
  if (lvErr) throw new BusinessError(lvErr, "level");
  const product = productOrThrow(w, input.productKey);
  const validFrom = validFromOf(input);
  const terms = cleanTerms(input);
  const ownerTerms = ownerTermsIn(w, ownerNodeId, product.key, validFrom);
  if (!ownerTerms) throw new BusinessError(`${owner?.name ?? "A Intercert"} ainda não tem preço para ${product.label}: defina primeiro o preço dele.`, "owner_missing");
  const errs = ruleErrors(terms, ownerTerms, { parent: owner?.name ?? "a Intercert (custo AC)" });
  // filhos desse nível que herdam a tabela: a camada abaixo deles precisa continuar válida
  for (const c of w.nodes.filter((n) => (n.parentNodeId ?? null) === ownerNodeId && n.level === level && n.status !== "closed")) {
    if (resolveRule(w.rules.filter((x) => x.scope === "node"), c, product.key, validFrom)) continue;
    errs.push(...downstreamErrors(w, c.id, product.key, validFrom, terms));
  }
  if (errs.length) throw new BusinessError(errs.join(" "), "price_rule");
  const { rule, previous } = await persistRule(ctx, w, { scope: "level", nodeId: null, ownerNodeId, level }, input, terms, validFrom);
  const summary = `Tabela padrão de ${owner?.name ?? "Intercert"} para o nível ${levelLabels[level]} — ${product.label} a partir de ${formatDate(validFrom)}: ${describe(terms)} · margem da camada ${formatMoney(terms.cost - ownerTerms.cost)}${previous ? " (encerra a anterior)" : ""}`;
  const before = previous ? { cost: previous.cost, minPrice: previous.minPrice, defaultPrice: previous.defaultPrice, canEdit: previous.canEdit, validFrom: previous.validFrom } : null;
  if (owner) await auditNode(ctx, owner, { action: "network.level_price_rule", summary, reason: rule.reason, before, after: { ...terms, validFrom, level }, related: [`cert_price_rule:${rule.id}`] });
  else await audit(ctx, { module: "admin", action: "network.level_price_rule", entityType: "cert_network", entityId: NETWORK_SCOPE, summary, reason: rule.reason, before, after: { ...terms, validFrom, level }, related: [`cert_price_rule:${rule.id}`] });
  return rule;
}

/** Retira a exceção de preço do nó (volta a valer a tabela padrão do pai), a partir de hoje. */
export async function clearNodePriceRule(ctx: Ctx, nodeId: string, productKey: string, reason?: string | null): Promise<void> {
  const w = await world(ctx.store);
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) throw new NotFoundError("cert_network_nodes", nodeId);
  await assertCanPriceUnder(ctx, node.parentNodeId ?? null);
  const ref = today();
  const own = w.rules.filter((r) => r.scope === "node" && r.nodeId === nodeId && r.productKey === productKey && r.active !== false && (!r.validTo || String(r.validTo) >= ref));
  if (!own.length) throw new BusinessError("Este parceiro não tem exceção de preço para o produto.", "no_rule");
  const inherited = resolveRule(w.rules.filter((r) => r.scope === "level"), node, productKey, ref);
  if (inherited) {
    const errs = downstreamErrors(w, nodeId, productKey, ref, { cost: inherited.cost, minPrice: inherited.minPrice, defaultPrice: inherited.defaultPrice, canEdit: inherited.canEdit !== false });
    if (errs.length) throw new BusinessError(`Ao voltar para a tabela padrão: ${errs.join(" ")}`, "price_rule");
  }
  const base = unscoped(ctx.store);
  for (const r of own) {
    if (String(r.validFrom) >= ref) await base.update("cert_price_rules", r.id, { active: false, supersededAt: nowIso() });
    else await base.update("cert_price_rules", r.id, { validTo: addDays(ref, -1) });
  }
  const product = w.catalog.find((p) => p.key === productKey);
  await auditNode(ctx, node, { action: "network.price_rule_clear", summary: `Exceção de preço de ${product?.label ?? productKey} retirada de ${node.name}: ${inherited ? "passa a valer a tabela padrão do parceiro acima" : "sem tabela padrão, o produto fica sem preço"}`, reason: reason?.trim() || null });
}

/** Mudança de lugar: as exceções definidas pelo pai anterior deixam de valer (o nó herda a tabela do novo pai). */
export async function closeRulesForMove(ctx: Ctx, nodeId: string, reason: string): Promise<number> {
  const base = unscoped(ctx.store);
  const ref = today();
  let n = 0;
  for (const r of await rulesOf(ctx.store)) {
    if (r.scope !== "node" || r.nodeId !== nodeId || r.active === false || (r.validTo && String(r.validTo) < ref)) continue;
    if (String(r.validFrom) >= ref) await base.update("cert_price_rules", r.id, { active: false, supersededAt: nowIso(), reason: `Mudança de lugar na rede: ${reason}`.slice(0, 300) });
    else await base.update("cert_price_rules", r.id, { validTo: addDays(ref, -1) });
    n++;
  }
  return n;
}

// ------------------------------------------------------------------------------------------------------------------ leitura

export interface PriceRow {
  product: CertProduct;
  price: EffectivePrice | null;
  /** termos do nível de cima (para mostrar a margem e os limites ao editar) */
  owner: RuleTerms | null;
  /** existe exceção própria vigente */
  override: boolean;
}

/** Tabela de preços vigente de um nó (todos os produtos ativos do catálogo). */
export async function nodePriceTable(store: Store, nodeId: string, date: string = today()): Promise<PriceRow[]> {
  const w = await world(store);
  const node = w.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  return w.catalog.filter((p) => p.active).map((product) => {
    const price = effectiveIn(w, nodeId, product.key, date);
    return { product, price, owner: ownerTermsIn(w, node.parentNodeId ?? null, product.key, date), override: price?.source === "node" };
  });
}

/** Histórico de regras de um nó (exceções próprias) — inclusive encerradas e substituídas. */
export async function nodeRuleHistory(store: Store, nodeId: string): Promise<Doc[]> {
  return (await rulesOf(store)).filter((r) => r.scope === "node" && r.nodeId === nodeId).sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export interface LevelTableRow {
  level: NetworkLevel;
  product: CertProduct;
  current: Doc | null;
  future: Doc | null;
  owner: RuleTerms | null;
}

/** Tabela padrão por nível de um dono (nó ou plataforma) com o que vale hoje, a próxima vigência e o histórico. */
export async function levelPriceTable(store: Store, ownerNodeId: string | null, levels: NetworkLevel[], date: string = today()): Promise<{ rows: LevelTableRow[]; history: Doc[] }> {
  const w = await world(store);
  const mine = w.rules.filter((r) => r.scope === "level" && (r.ownerNodeId ?? null) === ownerNodeId);
  const rows: LevelTableRow[] = [];
  for (const level of levels) {
    for (const product of w.catalog.filter((p) => p.active)) {
      const same = mine.filter((r) => r.level === level && r.productKey === product.key);
      const current = same.filter((r) => ruleValidAt(r, date)).sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)))[0] ?? null;
      const future = same.filter((r) => r.active !== false && String(r.validFrom) > date).sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)))[0] ?? null;
      rows.push({ level, product, current, future, owner: ownerTermsIn(w, ownerNodeId, product.key, date) });
    }
  }
  return { rows, history: mine.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) };
}

/** Avisos de preço da camada abaixo de um nó (ex.: depois de uma mudança de lugar): filhos com custo abaixo do nó. */
export async function priceAlerts(store: Store, nodeId: string, date: string = today()): Promise<string[]> {
  const w = await world(store);
  const out: string[] = [];
  for (const p of w.catalog.filter((x) => x.active)) {
    const mine = effectiveIn(w, nodeId, p.key, date);
    if (!mine) continue;
    for (const c of w.nodes.filter((n) => n.parentNodeId === nodeId && n.status !== "closed")) {
      const ch = effectiveIn(w, c.id, p.key, date);
      if (ch && ch.cost < mine.cost) out.push(`${c.name} — ${p.label}: custo ${formatMoney(ch.cost)} abaixo do custo deste parceiro (${formatMoney(mine.cost)}). Revise o preço.`);
    }
  }
  return out;
}

