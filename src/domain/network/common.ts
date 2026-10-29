import type { Doc, Store } from "@/lib/db/types";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { assert } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { getSetting, setSetting } from "@/lib/core/settings";
import { nowIso } from "@/lib/dates";
import { canDo } from "@/lib/permissions";

/**
 * Rede de certificação — base comum (docs/regras-assumidas.md §43).
 *
 * Hierarquia COMERCIAL própria da Intercert (não é a cadeia AC/AR do ITI): Intercert (plataforma) → Master → Regional →
 * Revenda → Contador → clientes. Cada nó é uma empresa: Master, Regional e Revenda são empresas do tipo
 * "certification" (parceiro da rede); o Contador é um escritório contábil ("accounting"). As chaves dos níveis são
 * fixas; os rótulos exibidos são configuráveis pela plataforma.
 *
 * Os registros da rede (nós e regras de preço) pertencem à PLATAFORMA (`companyId = "platform"`): o Store restrito
 * de qualquer empresa não os enxerga, e só este domínio os lê/grava — sempre com `unscoped()` e a regra de
 * visibilidade (`visibleNodeIds`).
 */

export const NETWORK_SCOPE = "platform";

export const NETWORK_LEVELS = ["master", "regional", "revenda", "contador"] as const;
export type NetworkLevel = (typeof NETWORK_LEVELS)[number];

export const DEFAULT_LEVEL_LABELS: Record<NetworkLevel, string> = { master: "Master", regional: "Regional", revenda: "Revenda", contador: "Contador" };

export const NODE_STATUS = [
  { value: "active", label: "Ativo" },
  { value: "suspended", label: "Suspenso" },
  { value: "closed", label: "Encerrado" },
] as const;
export type NodeStatus = (typeof NODE_STATUS)[number]["value"];
export const NODE_STATUS_LABEL: Record<string, string> = Object.fromEntries(NODE_STATUS.map((s) => [s.value, s.label]));

export const isLevel = (v: unknown): v is NetworkLevel => typeof v === "string" && (NETWORK_LEVELS as readonly string[]).includes(v);
export const levelRank = (l: string | null | undefined): number => (l ? NETWORK_LEVELS.indexOf(l as NetworkLevel) : -1);
/** Tipo de empresa de cada nível: o contador é um escritório contábil; os demais, parceiros da rede. */
export const kindForLevel = (l: NetworkLevel): "certification" | "accounting" => (l === "contador" ? "accounting" : "certification");

/**
 * Regra de níveis: o filho fica estritamente abaixo do pai (pode pular níveis: Master → Revenda); o contador é sempre
 * folha. Sem pai (null) = direto abaixo da Intercert, em qualquer nível. Devolve a mensagem de erro (ou null).
 */
export function childLevelError(parentLevel: string | null, childLevel: string, labels: Record<string, string> = DEFAULT_LEVEL_LABELS): string | null {
  if (!isLevel(childLevel)) return "Nível inválido.";
  if (parentLevel == null) return null;
  if (parentLevel === "contador") return `${labels.contador} é sempre o último nível da rede: não pode ter parceiros abaixo.`;
  if (levelRank(childLevel) <= levelRank(parentLevel)) return `Um ${labels[childLevel] ?? childLevel} não pode ficar abaixo de um ${labels[parentLevel] ?? parentLevel}: o nível do filho precisa ser inferior ao do pai.`;
  return null;
}

/** Níveis que um nó (ou a plataforma, null) pode ter diretamente abaixo. */
export function childLevelsOf(parentLevel: string | null): NetworkLevel[] {
  return NETWORK_LEVELS.filter((l) => childLevelError(parentLevel, l) === null);
}

/** Plataforma = quem gere toda a rede (administradores e perfis com "Gerir toda a rede"). */
export function isPlatform(ctx: Pick<Ctx, "user">): boolean {
  return canDo(ctx.user, "network.manage");
}

// ---------------------------------------------------------------------------------------------------------------- parâmetros

export interface NetworkSettings {
  levelLabels: Record<NetworkLevel, string>;
  /** §45: dias antes do vencimento para o alerta "ninguém agiu" na renovação (1 a 30; padrão 7) */
  idleAlertDays: number;
}

export const DEFAULT_IDLE_ALERT_DAYS = 7;

export async function networkSettings(store: Store): Promise<NetworkSettings> {
  const saved = await getSetting<Partial<NetworkSettings> | null>(unscoped(store), NETWORK_SCOPE, null, "network", null);
  const labels = { ...DEFAULT_LEVEL_LABELS };
  for (const l of NETWORK_LEVELS) {
    const v = saved?.levelLabels?.[l];
    if (typeof v === "string" && v.trim()) labels[l] = v.trim();
  }
  const idle = Math.round(Number(saved?.idleAlertDays));
  return { levelLabels: labels, idleAlertDays: idle >= 1 && idle <= 30 ? idle : DEFAULT_IDLE_ALERT_DAYS };
}

/** Plataforma: rótulos exibidos dos níveis (as chaves internas não mudam). */
export async function saveLevelLabels(ctx: Ctx, input: Partial<Record<NetworkLevel, string>>): Promise<NetworkSettings> {
  requireAction(ctx, "network.manage");
  const before = await networkSettings(ctx.store);
  const levelLabels = { ...before.levelLabels };
  for (const l of NETWORK_LEVELS) {
    const v = String(input[l] ?? "").trim();
    assert(v.length >= 2 && v.length <= 40, `Informe o rótulo do nível ${DEFAULT_LEVEL_LABELS[l]} (2 a 40 caracteres).`);
    levelLabels[l] = v;
  }
  assert(new Set(Object.values(levelLabels).map((v) => v.toLowerCase())).size === NETWORK_LEVELS.length, "Os rótulos dos níveis precisam ser diferentes entre si.");
  const value: NetworkSettings = { levelLabels, idleAlertDays: before.idleAlertDays };
  await setSetting(unscoped(ctx.store), NETWORK_SCOPE, null, "network", value, ctx.user.id);
  await audit(ctx, { module: "admin", action: "network.level_labels", entityType: "cert_network", entityId: NETWORK_SCOPE, summary: `Rótulos dos níveis da rede de certificação alterados: ${NETWORK_LEVELS.map((l) => levelLabels[l]).join(" → ")}`, before: before.levelLabels, after: levelLabels });
  return value;
}

/** Plataforma: dias antes do vencimento para o alerta "ninguém agiu" (§45). */
export async function saveIdleAlertDays(ctx: Ctx, days: number): Promise<NetworkSettings> {
  requireAction(ctx, "network.manage");
  const before = await networkSettings(ctx.store);
  const d = Math.round(Number(days));
  assert(d >= 1 && d <= 30, "Informe de 1 a 30 dias para o alerta de renovação sem ação.");
  const value: NetworkSettings = { ...before, idleAlertDays: d };
  await setSetting(unscoped(ctx.store), NETWORK_SCOPE, null, "network", value, ctx.user.id);
  await audit(ctx, { module: "admin", action: "network.idle_alert_days", entityType: "cert_network", entityId: NETWORK_SCOPE, summary: `Alerta de renovação sem ação: ${d} dia(s) antes do vencimento`, before: { idleAlertDays: before.idleAlertDays }, after: { idleAlertDays: d } });
  return value;
}

// ------------------------------------------------------------------------------------------------------------ leitura base

export async function allNodes(store: Store): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_network_nodes", { filters: [["eq", "companyId", NETWORK_SCOPE]] });
}

export async function nodeOfCompany(store: Store, companyId: string): Promise<Doc | null> {
  if (!companyId) return null;
  const r = await unscoped(store).list("cert_network_nodes", { filters: [["eq", "nodeCompanyId", companyId]], limit: 1 });
  return r.items[0] ?? null;
}

/**
 * Visibilidade (função pura): a plataforma vê todos os nós; o usuário de um nó vê o próprio nó e todos os
 * descendantes (pelo caminho materializado). Nunca vê irmãos nem ancestrais — do pai direto só aparece o nome.
 */
export function computeVisible(nodes: Array<{ id: string; path?: string[] | null }>, myNodeId: string | null, platform: boolean): Set<string> {
  if (platform) return new Set(nodes.map((n) => n.id));
  if (!myNodeId) return new Set();
  const out = new Set<string>([myNodeId]);
  for (const n of nodes) if ((n.path ?? []).includes(myNodeId)) out.add(n.id);
  return out;
}

export interface Viewer {
  platform: boolean;
  /** nó da empresa ativa (null = a empresa não é parceira da rede) */
  myNode: Doc | null;
  visible: Set<string>;
  nodes: Doc[];
}

/** Quem está olhando a rede e o que pode ver. */
export async function networkViewer(ctx: Ctx): Promise<Viewer> {
  const [nodes, myNode] = await Promise.all([allNodes(ctx.store), nodeOfCompany(ctx.store, ctx.companyId)]);
  const platform = isPlatform(ctx);
  return { platform, myNode, visible: computeVisible(nodes, myNode?.id ?? null, platform), nodes };
}

/** Ids visíveis ao usuário (centraliza a regra de visibilidade da rede). */
export async function visibleNodeIds(ctx: Ctx): Promise<Set<string>> {
  return (await networkViewer(ctx)).visible;
}

/** Auditoria de um nó: no histórico de quem agiu e, se for outra empresa, também no da empresa do nó. */
export async function auditNode(ctx: Ctx, node: Doc, input: { action: string; summary: string; before?: unknown; after?: unknown; reason?: string | null; related?: string[] }) {
  await audit(ctx, { module: "admin", action: input.action, entityType: "cert_network_node", entityId: node.id, summary: input.summary, before: input.before, after: input.after, reason: input.reason ?? null, related: input.related });
  if (node.nodeCompanyId && node.nodeCompanyId !== ctx.companyId) {
    await unscoped(ctx.store)
      .create("audit_logs", {
        companyId: node.nodeCompanyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: isPlatform(ctx) ? "Plataforma Intercert (rede)" : "Parceiro acima na rede",
        module: "admin", action: input.action, entityType: "company", entityId: node.nodeCompanyId, summary: input.summary, before: null, after: null, reason: input.reason ?? null,
        result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [`cert_network_node:${node.id}`],
      })
      .catch(() => undefined);
  }
}

/** Auditoria de um evento da rede ligado a um nó (ou à rede toda, quando `node` é null — ex.: cupom da plataforma). */
export async function auditNetwork(ctx: Ctx, node: Doc | null | undefined, input: { action: string; summary: string; before?: unknown; after?: unknown; reason?: string | null; related?: string[] }) {
  if (node) return auditNode(ctx, node, input);
  await audit(ctx, { module: "admin", action: input.action, entityType: "cert_network", entityId: NETWORK_SCOPE, summary: input.summary, before: input.before, after: input.after, reason: input.reason ?? null, related: input.related });
}
