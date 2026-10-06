import { resolveRoleId } from "@/lib/auth/users";
import { unscoped } from "@/lib/db/scoped-store";
import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { notify, reopenOccurrence, resolveOccurrence } from "@/lib/core/notify";
import { nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { afterOrdersStatus, getOrder, planOrdersStatus, setOrdersStatus, type OrderStatus } from "./purchases";
import { supplierLabel } from "./suppliers";
import { tierFor } from "./purchase-calc";

/**
 * Aprovação de compras (Tela 48 / visão 14).
 *
 * Política (approval_policies, uma ativa por empresa):
 *  - rules.tiers: alçadas por valor. Vale a alçada de maior `above` tal que total > above.
 *    Cada alçada tem etapas sequenciais; responsáveis por perfil (roleIds) ou por usuários (userIds).
 *  - autoApproveBelow: total (com frete) abaixo deste valor é aprovado automaticamente (0 = desligado).
 *  - allowSelfApproval: false → quem solicitou não decide a própria solicitação.
 *  - rules.distinctApprovers: o mesmo usuário não aprova duas etapas da mesma revisão.
 *  - expiredProposalAction: "block" | "warn" (exige observação) | "allow" para propostas vencidas.
 *  - reviewOnRevision: "always" | "relevant" | "never" — alteração comercial após aprovação.
 * Aprovar NÃO envia o pedido nem registra recebimento ou pagamento.
 */

export interface PolicyStep {
  name: string;
  kind: "role" | "users" | "action";
  roleIds?: string[];
  userIds?: string[];
}

export interface PolicyTier {
  above: number;
  steps: PolicyStep[];
}

export interface PolicyRules {
  tiers: PolicyTier[];
  distinctApprovers?: boolean;
}

export interface PolicyInput {
  name: string;
  rules: PolicyRules;
  autoApproveBelow: number;
  allowSelfApproval: boolean;
  expiredProposalAction: "block" | "warn" | "allow";
  reviewOnRevision: "always" | "relevant" | "never";
}

export const DEFAULT_POLICY: PolicyInput = {
  name: "Padrão (uma etapa)",
  rules: { tiers: [{ above: 0, steps: [{ name: "Aprovação de compras", kind: "action" }] }], distinctApprovers: false },
  autoApproveBelow: 0,
  allowSelfApproval: true,
  expiredProposalAction: "warn",
  reviewOnRevision: "relevant",
};

export const policyId = (companyId: string) => detId("approval-policy", companyId);

export async function activePolicy(store: Store, companyId: string): Promise<Doc | null> {
  const p = await store.get("approval_policies", policyId(companyId));
  if (p?.active) return p;
  const any = await listAll(store, "approval_policies", { filters: [["eq", "companyId", companyId], ["eq", "active", true]] });
  return any[0] ?? null;
}

function validatePolicy(input: PolicyInput) {
  assert(input.name?.trim(), "Informe o nome da política.");
  assert(input.rules?.tiers?.length, "Defina ao menos uma alçada.");
  const seen = new Set<number>();
  for (const t of input.rules.tiers) {
    assert(Number.isInteger(t.above) && t.above >= 0, "Valor de alçada inválido.");
    assert(!seen.has(t.above), "Há duas alçadas com o mesmo valor.");
    seen.add(t.above);
    assert(t.steps.length > 0 && t.steps.length <= 6, "Cada alçada deve ter de 1 a 6 etapas.");
    for (const s of t.steps) {
      assert(s.name?.trim(), "Dê um nome a cada etapa.");
      if (s.kind === "role") assert(s.roleIds?.length, `Etapa "${s.name}": escolha ao menos um perfil.`);
      if (s.kind === "users") assert(s.userIds?.length, `Etapa "${s.name}": escolha ao menos um usuário.`);
    }
  }
  assert(input.autoApproveBelow >= 0, "Valor de autoaprovação inválido.");
  assert(["block", "warn", "allow"].includes(input.expiredProposalAction), "Tratamento de proposta vencida inválido.");
  assert(["always", "relevant", "never"].includes(input.reviewOnRevision), "Regra de revisão inválida.");
}

/** Salva (cria ou altera) a política ativa da empresa. Requer administração. */
export async function savePolicy(ctx: Ctx, input: PolicyInput) {
  requirePerm(ctx, "admin", "edit");
  validatePolicy(input);
  const id = policyId(ctx.companyId);
  const before = await ctx.store.get("approval_policies", id);
  const tiers = [...input.rules.tiers].sort((a, b) => a.above - b.above);
  const data = {
    name: input.name.trim(),
    active: true,
    rules: { tiers, distinctApprovers: Boolean(input.rules.distinctApprovers) },
    autoApproveBelow: input.autoApproveBelow,
    allowSelfApproval: input.allowSelfApproval,
    expiredProposalAction: input.expiredProposalAction,
    reviewOnRevision: input.reviewOnRevision,
  };
  const doc = before ? await ctx.store.update("approval_policies", id, data) : await ctx.store.create("approval_policies", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, ...data }, id);
  await audit(ctx, {
    module: "purchases",
    action: "approval_policy.save",
    entityType: "approval_policy",
    entityId: id,
    summary: `Política de aprovação "${data.name}" ${before ? "alterada" : "criada"}: ${tiers.map((t) => `acima de ${formatMoney(t.above)} → ${t.steps.map((s) => s.name).join(" + ")}`).join("; ")}`,
    before: before ? { rules: before.rules, autoApproveBelow: before.autoApproveBelow, allowSelfApproval: before.allowSelfApproval, expiredProposalAction: before.expiredProposalAction, reviewOnRevision: before.reviewOnRevision } : undefined,
    after: data,
  });
  return doc;
}

export { tierFor };

async function usersWithRoles(store: Store, companyId: string) {
  const users = await listAll(store, "users", { filters: [["eq", "status", "active"]] });
  // perfis lidos sem restrição de empresa: o perfil legado do usuário pode ser de outra empresa (perfil de sistema equivalente)
  const roleList = await listAll(unscoped(store), "roles");
  const roles = new Map(roleList.map((r) => [r.id, r]));
  // perfil do usuário NA empresa (perfil por empresa)
  return users
    .filter((u) => u.isAdmin || (u.companyIds ?? []).includes(companyId))
    .map((u) => {
      const companyRoleId = resolveRoleId(u, companyId, roles, roleList);
      return { ...u, companyRoleId, role: companyRoleId ? roles.get(companyRoleId) : null };
    });
}

/** Resolve os usuários responsáveis por uma etapa (perfil, usuários nomeados ou ação "Aprovar compras"). */
export async function stepResponsibles(store: Store, companyId: string, step: PolicyStep) {
  const users = await usersWithRoles(store, companyId);
  const canApprove = (u: any) => u.isAdmin || (u.role?.actions ?? []).includes("purchase.approve");
  if (step.kind === "users") return users.filter((u) => (step.userIds ?? []).includes(u.id) && canApprove(u));
  if (step.kind === "role") return users.filter((u) => u.companyRoleId && (step.roleIds ?? []).includes(u.companyRoleId) && canApprove(u));
  return users.filter((u) => !u.isAdmin && canApprove(u));
}

// ───────────────────────────── Solicitação (submissão)

const occKey = (req: Doc | { id: string; revision?: number }, step: number) => `purchase_review:${req.id}:${req.revision ?? 1}:${step}`;

/** Pedidos por solicitação: a decisão grava marcador + decisão + solicitação + pedidos numa transação (≤ 100). */
const MAX_ORDERS_PER_REQUEST = 90;

/**
 * Vaga da próxima decisão/revogação da solicitação (id determinístico pela sequência `decisionSeq`):
 * duas decisões (ou decisão e revogação) concorrentes disputam a mesma vaga e só uma é gravada.
 */
const decisionSlotId = (requestId: string, seq: number) => detId("approval-slot", requestId, String(seq));

const CONCURRENT_DECISION = "Esta etapa já foi decidida (ou a decisão foi revista) por outra pessoa enquanto você decidia. Atualize a página e confira a situação antes de decidir.";

async function proposalWarnings(store: Store, orders: Doc[]) {
  const t = today();
  const warnings: Array<{ kind: string; orderId: string; message: string; validUntil?: string }> = [];
  let minValid: string | null = null;
  for (const o of orders) {
    const ref = o.proposalRef;
    if (!ref?.validUntil) continue;
    if (!minValid || ref.validUntil < minValid) minValid = ref.validUntil;
    if (ref.validUntil < t) warnings.push({ kind: "expired_proposal", orderId: o.id, validUntil: ref.validUntil, message: `Pedido nº ${o.number}: proposta de ${supplierLabel(o.supplierSnapshot)} vencida em ${ref.validUntil.split("-").reverse().join("/")}.` });
    if (ref.proposalId) {
      const p = await store.get("quotation_proposals", ref.proposalId);
      if (p && (p.version ?? 1) !== ref.version) warnings.push({ kind: "proposal_changed", orderId: o.id, message: `Pedido nº ${o.number}: a proposta foi alterada após a seleção (versão ${ref.version} → ${p.version}).` });
    }
  }
  return { warnings, minValid };
}

async function notifyStep(ctx: Ctx, req: Doc, stepIndex: number) {
  const step = (req.steps ?? [])[stepIndex];
  if (!step) return 0;
  const userIds: string[] = step.responsibleIds ?? [];
  if (!userIds.length) return 0;
  return notify(ctx.store, {
    companyId: ctx.companyId,
    branchId: req.branchId,
    type: "purchase_review",
    priority: req.total > 1000000 ? "high" : "normal",
    title: `Compra aguardando ${step.name}: solicitação nº ${req.number}`,
    body: `${formatMoney(req.total)} (frete incluído) — ${(req.orderIds ?? []).length} pedido(s). Etapa ${stepIndex + 1} de ${req.steps.length}.`,
    link: `/compras/aprovacoes/${req.id}`,
    originType: "purchase_request",
    originId: req.id,
    occurrenceKey: occKey(req, stepIndex),
    responsibleName: step.name,
    audience: { userIds },
  });
}

/**
 * Envia pedidos para análise. Pedidos de uma mesma solicitação são decididos juntos (ex.: pedidos
 * gerados de uma cotação). Reenvio após ajuste reabre a mesma solicitação com nova revisão.
 */
export async function submitForApproval(ctx: Ctx, orderIds: string[], opts: { origin?: string; notes?: string | null; skipStateCheck?: boolean; quotationId?: string | null } = {}) {
  requirePerm(ctx, "purchases", "edit");
  const branchId = requireBranch(ctx);
  assert(orderIds.length > 0, "Selecione ao menos um pedido.");
  let orders = await Promise.all([...new Set(orderIds)].map((id) => getOrder(ctx, id)));
  // reenvio após ajuste: reaproveita a solicitação devolvida, com todos os pedidos dela ainda ativos
  const adjustReqId = orders.find((o) => o.status === "adjust" && o.requestId)?.requestId;
  let request: Doc | null = adjustReqId ? await ctx.store.get("purchase_requests", adjustReqId) : null;
  if (request && request.status !== "adjust") request = null;
  if (request) {
    const extra = await Promise.all((request.orderIds ?? []).filter((id: string) => !orders.some((o) => o.id === id)).map((id: string) => getOrder(ctx, id)));
    orders = [...orders, ...extra.filter((o) => !["cancelled", "rejected"].includes(o.status))];
  }
  if (!opts.skipStateCheck) for (const o of orders) assert(["draft", "adjust"].includes(o.status), `Pedido nº ${o.number} está ${o.status === "in_review" ? "em análise" : "em estado que não permite envio para análise"}.`);
  for (const o of orders) assert(o.branchId === orders[0].branchId, "Pedidos de filiais diferentes devem ser enviados separadamente.");
  assert(orders[0].branchId === branchId, `Pedido nº ${orders[0].number} é de outra filial: selecione a filial do pedido para enviá-lo para análise.`);
  // a decisão grava solicitação + pedidos numa única transação (limite de 100 gravações)
  assert(orders.length <= MAX_ORDERS_PER_REQUEST, `Uma solicitação aceita até ${MAX_ORDERS_PER_REQUEST} pedidos — envie em mais de uma solicitação.`);
  const policyDoc = await activePolicy(ctx.store, ctx.companyId);
  const policy: PolicyInput = policyDoc ? { name: policyDoc.name, rules: policyDoc.rules, autoApproveBelow: policyDoc.autoApproveBelow ?? 0, allowSelfApproval: Boolean(policyDoc.allowSelfApproval), expiredProposalAction: policyDoc.expiredProposalAction ?? "warn", reviewOnRevision: policyDoc.reviewOnRevision ?? "relevant" } : DEFAULT_POLICY;
  const total = orders.reduce((a, o) => a + o.total, 0);
  const freight = orders.reduce((a, o) => a + (o.freight ?? 0), 0);
  const tier = tierFor(policy.rules, total);
  const steps = [];
  for (const s of tier.steps) {
    const resp = await stepResponsibles(ctx.store, ctx.companyId, s);
    steps.push({ ...s, responsibleIds: resp.map((u) => u.id), responsibleNames: resp.map((u) => u.name) });
  }
  const { warnings, minValid } = await proposalWarnings(ctx.store, orders);
  const hasExpired = warnings.some((w) => w.kind === "expired_proposal");
  const auto = policy.autoApproveBelow > 0 && total < policy.autoApproveBelow && !(hasExpired && policy.expiredProposalAction !== "allow");
  const policySnapshot = { id: policyDoc?.id ?? null, name: policy.name, tierAbove: tier.above, autoApproveBelow: policy.autoApproveBelow, allowSelfApproval: policy.allowSelfApproval, expiredProposalAction: policy.expiredProposalAction, distinctApprovers: Boolean(policy.rules.distinctApprovers), reviewOnRevision: policy.reviewOnRevision };
  const base = { total, freight, orderIds: orders.map((o) => o.id), steps, currentStep: 0, policySnapshot, validUntil: minValid, warnings, decidedAt: null };
  if (request) {
    request = await ctx.store.update("purchase_requests", request.id, { ...base, status: auto ? "approved" : "in_review", revision: (request.revision ?? 1) + 1, notes: [request.notes, opts.notes].filter(Boolean).join("\n") || null });
  } else {
    const number = await nextNumber(ctx.store, `purchase_request:${ctx.companyId}`);
    request = await ctx.store.create("purchase_requests", {
      companyId: ctx.companyId,
      branchId: orders[0].branchId,
      createdBy: ctx.user.id,
      number,
      requesterId: ctx.user.id,
      origin: opts.origin ?? (orders[0].origin === "quotation" ? "quotation" : "orders"),
      originId: orders[0].originId ?? null,
      quotationId: opts.quotationId ?? orders[0].quotationId ?? null,
      status: auto ? "approved" : "in_review",
      revision: 1,
      decisionSeq: 0,
      notes: opts.notes ?? null,
      ...base,
    });
  }
  const req = request!;
  for (const o of orders) await ctx.store.update("purchase_orders", o.id, { requestId: req.id });
  await audit(ctx, {
    module: "purchases",
    action: "purchase_request.submit",
    entityType: "purchase_request",
    entityId: req.id,
    summary: `Solicitação nº ${req.number} (rev. ${req.revision}) enviada para análise: ${orders.length} pedido(s), ${formatMoney(total)} com frete — ${auto ? `autoaprovada (abaixo de ${formatMoney(policy.autoApproveBelow)})` : `${steps.length} etapa(s): ${steps.map((s) => s.name).join(" → ")}`}`,
    after: { total, freight, steps: steps.map((s) => s.name), warnings: warnings.map((w) => w.message) },
    related: orders.map((o) => `purchase_order:${o.id}`),
  });
  if (auto) {
    await ctx.store.create("approval_decisions", { companyId: ctx.companyId, branchId: req.branchId, createdBy: ctx.user.id, requestId: req.id, step: 0, stepName: "Autoaprovação pela política", decision: "auto", note: `Total ${formatMoney(total)} abaixo de ${formatMoney(policy.autoApproveBelow)}.`, revision: req.revision });
    await ctx.store.update("purchase_requests", req.id, { decidedAt: nowIso() });
    await setOrdersStatus(ctx, orders.map((o) => o.id), "approved", { approvedAt: nowIso() }, { action: "purchase_order.approved", summary: (o) => `Pedido nº ${o.number} autoaprovado pela política (abaixo de ${formatMoney(policy.autoApproveBelow)})` });
    for (const o of orders) await ctx.store.update("purchase_orders", o.id, { approvedRevision: (await ctx.store.getOrThrow("purchase_orders", o.id)).revision ?? 1 });
  } else {
    const toReview = [];
    for (const o of orders) {
      const cur = await ctx.store.getOrThrow("purchase_orders", o.id);
      if (cur.status !== "in_review") toReview.push(o.id);
    }
    await setOrdersStatus(ctx, toReview, "in_review", {}, { action: "purchase_order.submitted", summary: (o) => `Pedido nº ${o.number} enviado para análise (solicitação nº ${req.number})` });
    await notifyStep(ctx, req, 0);
  }
  return ctx.store.getOrThrow("purchase_requests", req.id);
}

// ───────────────────────────── Decisão

export type Decision = "approve" | "adjust" | "reject";

export async function requestDecisions(store: Store, requestId: string) {
  return listAll(store, "approval_decisions", { filters: [["eq", "requestId", requestId]], orderBy: [{ field: "createdAt", dir: "asc" }] });
}

/** Verifica se o usuário pode decidir a etapa atual (e por quê não). */
export async function canDecide(ctx: Ctx, req: Doc): Promise<{ ok: boolean; reason?: string; requiresNote?: boolean; expired?: boolean }> {
  if (req.status !== "in_review") return { ok: false, reason: "A solicitação não está em análise." };
  if (ctx.branchId !== req.branchId) return { ok: false, reason: ctx.branchId ? "Solicitação de outra filial: selecione a filial da solicitação para decidir." : "Selecione a filial da solicitação para decidir (o contexto consolidado é somente consulta)." };
  const actions = ctx.user.actions ?? [];
  if (!ctx.user.isAdmin && !actions.includes("purchase.approve")) return { ok: false, reason: "Seu perfil não tem a permissão Aprovar compras." };
  const step = req.steps?.[req.currentStep ?? 0];
  if (!step) return { ok: false, reason: "Etapa inexistente." };
  const snap = req.policySnapshot ?? {};
  if (!ctx.user.isAdmin && !(step.responsibleIds ?? []).includes(ctx.user.id)) return { ok: false, reason: `Você não é responsável pela etapa "${step.name}" (${(step.responsibleNames ?? []).join(", ") || "sem responsáveis"}).` };
  if (!snap.allowSelfApproval && req.requesterId === ctx.user.id) return { ok: false, reason: "A política não permite decidir a própria solicitação." };
  if (snap.distinctApprovers) {
    const prev = (await requestDecisions(ctx.store, req.id)).filter((d) => d.revision === req.revision && !d.revokedAt && d.decision === "approve" && d.step < (req.currentStep ?? 0));
    if (prev.some((d) => d.createdBy === ctx.user.id)) return { ok: false, reason: "A política exige aprovadores diferentes em cada etapa — você já aprovou uma etapa anterior." };
  }
  const expired = (req.warnings ?? []).some((w: any) => w.kind === "expired_proposal") || (req.validUntil && req.validUntil < today());
  return { ok: true, expired: Boolean(expired), requiresNote: Boolean(expired) && snap.expiredProposalAction === "warn" };
}

export async function decideRequest(ctx: Ctx, requestId: string, decision: Decision, note?: string | null, expected: { step?: number | null; revision?: number | null } = {}) {
  requireAction(ctx, "purchase.approve");
  requireBranch(ctx);
  const req = await ctx.store.getOrThrow("purchase_requests", requestId);
  assert(req.companyId === ctx.companyId, "Solicitação de outra empresa.");
  const stepIndex = req.currentStep ?? 0;
  const revision = req.revision ?? 1;
  // a decisão vale para a etapa/revisão que o usuário viu na tela
  if ((expected.step != null && expected.step !== stepIndex) || (expected.revision != null && expected.revision !== revision)) {
    throw new BusinessError("A solicitação mudou desde que você abriu a página (outra etapa ou revisão). Atualize a página e revise antes de decidir.", "stale");
  }
  const check = await canDecide(ctx, req);
  if (!check.ok) throw new BusinessError(check.reason!, "forbidden");
  const snap = req.policySnapshot ?? {};
  const step = req.steps[stepIndex];
  if (decision !== "approve") assert(note?.trim(), decision === "reject" ? "Informe o motivo da rejeição." : "Informe o que precisa ser ajustado.");
  if (decision === "approve" && check.expired) {
    if (snap.expiredProposalAction === "block") throw new BusinessError("Há proposta vencida nesta solicitação e a política bloqueia a aprovação. Devolva para ajuste (renovar cotação/proposta).", "expired_proposal");
    if (snap.expiredProposalAction === "warn") assert(note?.trim(), "Há proposta vencida: registre uma observação justificando a aprovação.");
  }
  const orderIds: string[] = req.orderIds ?? [];
  const active = (await Promise.all(orderIds.map((id) => getOrder(ctx, id)))).filter((o) => !["cancelled"].includes(o.status));
  assert(active.length > 0, "Todos os pedidos desta solicitação foram cancelados.");
  assert(active.length <= MAX_ORDERS_PER_REQUEST, `Solicitação com mais de ${MAX_ORDERS_PER_REQUEST} pedidos: divida-a antes de decidir.`);
  const now = nowIso();
  const next = stepIndex + 1;
  const final = decision === "approve" && next >= req.steps.length;
  const reqPatch: Record<string, any> = decision === "approve" ? (final ? { status: "approved", decidedAt: now } : { currentStep: next }) : { status: decision === "adjust" ? "adjust" : "rejected", decidedAt: now };
  const orderTo: OrderStatus | null = decision === "approve" ? (final ? "approved" : null) : decision === "adjust" ? "adjust" : "rejected";
  const changing = orderTo ? planOrdersStatus(active.filter((o) => o.status === "in_review"), orderTo) : [];
  const seq = req.decisionSeq ?? 0;
  // decisão + solicitação + pedidos numa transação, disputando a vaga `decisionSeq` (concorrência: só uma vence)
  let d: Doc;
  try {
    d = await ctx.store.transaction(async (t) => {
      await t.create("operations", { companyId: ctx.companyId, type: "purchase.decision", status: "done", entityType: "purchase_request", entityId: requestId, result: { seq, decision, step: stepIndex, revision }, createdBy: ctx.user.id }, decisionSlotId(requestId, seq));
      const created = await t.create(
        "approval_decisions",
        { companyId: ctx.companyId, branchId: req.branchId, createdBy: ctx.user.id, requestId, step: stepIndex, stepName: step.name, decision, note: note?.trim() || null, revision },
        detId("approval-decision", requestId, String(revision), String(stepIndex), String(seq)),
      );
      await t.update("purchase_requests", requestId, { ...reqPatch, decisionSeq: seq + 1 });
      for (const o of active) {
        const p: Record<string, any> = {};
        if (changing.includes(o)) Object.assign(p, { status: orderTo }, orderTo === "approved" ? { approvedAt: now } : orderTo === "rejected" ? { rejectReason: note } : {});
        if (final) p.approvedRevision = o.revision ?? 1;
        if (Object.keys(p).length) await t.update("purchase_orders", o.id, p);
      }
      return created;
    });
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(CONCURRENT_DECISION, "conflict");
    throw e;
  }
  await resolveOccurrence(ctx.store, occKey(req, stepIndex));
  const label = decision === "approve" ? "aprovou" : decision === "adjust" ? "devolveu para ajuste" : "rejeitou";
  await audit(ctx, {
    module: "purchases",
    action: `purchase_request.${decision}`,
    entityType: "purchase_request",
    entityId: requestId,
    summary: `${ctx.user.name} ${label} a etapa "${step.name}" da solicitação nº ${req.number} (${formatMoney(req.total)})`,
    reason: note ?? null,
    related: active.map((o) => `purchase_order:${o.id}`),
  });
  const notifyRequester = async (title: string, body: string) => {
    if (!req.requesterId || req.requesterId === ctx.user.id) return;
    await notify(ctx.store, { companyId: ctx.companyId, branchId: req.branchId, type: "purchase_review", title, body, link: `/compras/aprovacoes/${requestId}`, originType: "purchase_request", originId: requestId, occurrenceKey: `purchase_result:${requestId}:${req.revision}:${d.id}`, informative: true, audience: { userIds: [req.requesterId] } });
  };
  if (decision === "approve") {
    if (!final) {
      await notifyStep(ctx, await ctx.store.getOrThrow("purchase_requests", requestId), next);
    } else {
      await afterOrdersStatus(ctx, changing, "approved", { action: "purchase_order.approved", summary: (o) => `Pedido nº ${o.number} aprovado (solicitação nº ${req.number}) — aguardando registro de envio ao fornecedor` });
      await notifyRequester(`Solicitação nº ${req.number} aprovada`, "Pedidos aprovados. Registre o envio ao fornecedor (a aprovação não envia o pedido).");
    }
  } else if (decision === "adjust") {
    await afterOrdersStatus(ctx, changing, "adjust", { reason: note, summary: (o) => `Pedido nº ${o.number} devolvido para ajuste` });
    await notifyRequester(`Solicitação nº ${req.number} devolvida para ajuste`, note ?? "");
  } else {
    await afterOrdersStatus(ctx, changing, "rejected", { reason: note, summary: (o) => `Pedido nº ${o.number} rejeitado` });
    await notifyRequester(`Solicitação nº ${req.number} rejeitada`, note ?? "");
  }
  return { decision: d, request: await ctx.store.getOrThrow("purchase_requests", requestId) };
}

/**
 * Revisão (revogação) da última decisão válida. Só é possível enquanto os pedidos não avançaram
 * (aprovado sem envio/recebimento; ajuste sem reenvio; rejeição). A solicitação volta para a etapa decidida.
 */
export async function revokeDecision(ctx: Ctx, decisionId: string, reason: string) {
  requireAction(ctx, "purchase.approve");
  assert(reason?.trim(), "Informe o motivo da revisão da decisão.");
  const branchId = requireBranch(ctx);
  const d = await ctx.store.getOrThrow("approval_decisions", decisionId);
  const req = await ctx.store.getOrThrow("purchase_requests", d.requestId);
  assert(req.companyId === ctx.companyId, "Solicitação de outra empresa.");
  assert(req.branchId === branchId, "Solicitação de outra filial: selecione a filial da solicitação para revisar a decisão.");
  assert(!d.revokedAt, "Esta decisão já foi revista.");
  assert(d.decision !== "auto", "Autoaprovação não pode ser revogada por aqui — altere o pedido (gera revisão).");
  assert(d.revision === (req.revision ?? 1), "Decisão de uma revisão anterior da solicitação.");
  const valid = (await requestDecisions(ctx.store, req.id)).filter((x) => x.revision === req.revision && !x.revokedAt);
  assert(valid[valid.length - 1]?.id === d.id, "Somente a última decisão pode ser revista.");
  assert(ctx.user.isAdmin || d.createdBy === ctx.user.id, "Somente quem decidiu (ou um administrador) pode revisar a decisão.");
  const orders = await Promise.all((req.orderIds ?? []).map((id: string) => getOrder(ctx, id)));
  const active = orders.filter((o) => o.status !== "cancelled");
  const finalApproval = d.decision === "approve" && req.status === "approved";
  if (finalApproval) for (const o of active) assert(o.status === "approved", `Pedido nº ${o.number} já está ${o.status === "sent" ? "enviado" : "em andamento"} — a aprovação não pode mais ser revogada; altere o pedido (revisão) ou cancele.`);
  if (d.decision === "adjust") for (const o of active) assert(o.status === "adjust", `Pedido nº ${o.number} já foi alterado/reenviado.`);
  const back = planOrdersStatus(active.filter((o) => ["approved", "adjust", "rejected"].includes(o.status)), "in_review");
  const seq = req.decisionSeq ?? 0;
  // revogação disputa a mesma vaga de uma decisão concorrente (só uma das duas é gravada)
  try {
    await ctx.store.transaction(async (t) => {
      await t.create("operations", { companyId: ctx.companyId, type: "purchase.decision_revoke", status: "done", entityType: "purchase_request", entityId: req.id, result: { seq, decisionId: d.id }, createdBy: ctx.user.id }, decisionSlotId(req.id, seq));
      await t.update("approval_decisions", d.id, { revokedAt: nowIso(), revokedBy: ctx.user.id, revokeReason: reason });
      await t.update("purchase_requests", req.id, { status: "in_review", currentStep: d.step, decidedAt: null, decisionSeq: seq + 1 });
      for (const o of back) await t.update("purchase_orders", o.id, { status: "in_review" });
    });
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(CONCURRENT_DECISION, "conflict");
    throw e;
  }
  await afterOrdersStatus(ctx, back, "in_review", { action: "purchase_order.decision_revoked", reason, summary: (o) => `Pedido nº ${o.number} volta para análise (decisão "${d.stepName}" revista)` });
  await audit(ctx, {
    module: "purchases",
    action: "purchase_request.revoke",
    entityType: "purchase_request",
    entityId: req.id,
    summary: `Decisão "${d.decision === "approve" ? "aprovar" : d.decision === "adjust" ? "devolver para ajuste" : "rejeitar"}" da etapa "${d.stepName}" revista por ${ctx.user.name} — volta para análise`,
    reason,
    related: active.map((o) => `purchase_order:${o.id}`),
  });
  // a etapa volta a ser pendência dos responsáveis
  await reopenOccurrence(ctx.store, occKey(req, d.step));
  const updated = await ctx.store.getOrThrow("purchase_requests", req.id);
  await notifyStep(ctx, updated, d.step);
  return updated;
}

/** Recalcula a solicitação quando um pedido dela é cancelado. */
export async function refreshRequestAfterOrderChange(ctx: Ctx, requestId: string) {
  const req = await ctx.store.get("purchase_requests", requestId);
  if (!req) return;
  const orders = await Promise.all((req.orderIds ?? []).map((id: string) => ctx.store.get("purchase_orders", id)));
  const active = orders.filter((o): o is Doc => Boolean(o) && o!.status !== "cancelled");
  if (!active.length) {
    await ctx.store.update("purchase_requests", requestId, { status: "cancelled", decidedAt: nowIso() });
    for (let i = 0; i < (req.steps ?? []).length; i++) await resolveOccurrence(ctx.store, occKey(req, i));
    await audit(ctx, { module: "purchases", action: "purchase_request.cancelled", entityType: "purchase_request", entityId: requestId, summary: `Solicitação nº ${req.number} cancelada (todos os pedidos cancelados)` });
    return;
  }
  const total = active.reduce((a, o) => a + o.total, 0);
  if (total !== req.total) await ctx.store.update("purchase_requests", requestId, { total, freight: active.reduce((a, o) => a + (o.freight ?? 0), 0) });
}

export const REQUEST_STATUS: Record<string, string> = { in_review: "Em análise", approved: "Aprovada", adjust: "Em ajuste", rejected: "Rejeitada", cancelled: "Cancelada" };

export function stepState(req: Doc, i: number, decisions: Doc[]) {
  const valid = decisions.filter((d) => d.revision === req.revision && !d.revokedAt);
  const d = valid.filter((x) => x.step === i).pop();
  if (d) return { state: d.decision as string, decision: d };
  if (req.status === "in_review" && (req.currentStep ?? 0) === i) return { state: "pending", decision: null };
  return { state: "waiting", decision: null };
}

void (null as unknown as OrderStatus);

/** Política ativa com responsáveis resolvidos (prévia do fluxo no formulário do pedido e na fila). */
export async function policyPreview(store: Store, companyId: string) {
  const doc = await activePolicy(store, companyId);
  const policy: PolicyInput = doc ? { name: doc.name, rules: doc.rules, autoApproveBelow: doc.autoApproveBelow ?? 0, allowSelfApproval: Boolean(doc.allowSelfApproval), expiredProposalAction: doc.expiredProposalAction ?? "warn", reviewOnRevision: doc.reviewOnRevision ?? "relevant" } : DEFAULT_POLICY;
  const tiers = [];
  for (const t of [...policy.rules.tiers].sort((a, b) => a.above - b.above)) {
    const steps = [];
    for (const s of t.steps) steps.push({ name: s.name, kind: s.kind, responsibleNames: (await stepResponsibles(store, companyId, s)).map((u) => u.name) });
    tiers.push({ above: t.above, steps });
  }
  return { configured: Boolean(doc), name: policy.name, tiers, autoApproveBelow: policy.autoApproveBelow, allowSelfApproval: policy.allowSelfApproval, distinctApprovers: Boolean(policy.rules.distinctApprovers), expiredProposalAction: policy.expiredProposalAction, reviewOnRevision: policy.reviewOnRevision };
}
