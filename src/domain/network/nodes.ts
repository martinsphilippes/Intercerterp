import { findOne, isConflict, listAll, newId } from "@/lib/db";
import { NotFoundError, type Doc } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { nextNumber } from "@/lib/core/numbering";
import { onlyDigits } from "@/lib/core/text";
import { nowIso, today } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { companyData, type CompanyInput } from "../companies";
import { createCompanyWithDefaults } from "../setup";
import { createUser, type InviteResult } from "../users";
import {
  NETWORK_SCOPE, NODE_STATUS_LABEL, allNodes, auditNode, childLevelError, isLevel, isPlatform, kindForLevel, networkSettings, networkViewer, nodeOfCompany, type NetworkLevel, type NodeStatus,
} from "./common";

/**
 * Nós da rede de certificação (§43): criação (plataforma ou administrador do nó pai), mudança de posição (só a
 * plataforma, com motivo), suspensão, reativação e encerramento. Toda ação fica no histórico do nó.
 */

const pad = (n: number) => `RC-${String(n).padStart(4, "0")}`;

export interface NodeAdminInput {
  name: string;
  email: string;
  login?: string | null;
}

export interface CreateNodeInput {
  parentNodeId: string | null;
  level: NetworkLevel;
  /** nova empresa do parceiro (Master/Regional/Revenda) ou novo escritório (Contador) */
  company?: CompanyInput | null;
  /** Contador: vincula um escritório contábil já existente pelo CNPJ (em vez de criar) */
  linkCnpj?: string | null;
  /** administrador convidado da empresa nova (obrigatório ao criar a empresa) */
  admin?: NodeAdminInput | null;
  cityName?: string | null;
  uf?: string | null;
  region?: string | null;
  commercialResponsible?: string | null;
  notes?: string | null;
  startedAt?: string | null;
  /** origem do link do convite (https://…) */
  origin?: string | null;
}

/** Nó com a guarda de visibilidade: fora do que o usuário vê é tratado como inexistente. */
export async function getNode(ctx: Ctx, id: string): Promise<Doc> {
  const v = await networkViewer(ctx);
  const node = v.nodes.find((n) => n.id === id);
  if (!node || !v.visible.has(id)) throw new NotFoundError("cert_network_nodes", id);
  return node;
}

/** Pode cadastrar filhos diretamente abaixo deste nó (null = direto abaixo da Intercert)? */
export function canCreateUnder(ctx: Ctx, myNode: Doc | null, parentNodeId: string | null): boolean {
  if (isPlatform(ctx)) return true;
  return Boolean(parentNodeId && myNode && myNode.id === parentNodeId && myNode.status === "active" && canDo(ctx.user, "network.children"));
}

/** Contexto delegado na empresa nova, só para criar o convite do administrador (quem cadastra não ganha acesso a ela). */
function delegatedCtx(ctx: Ctx, companyId: string): Ctx {
  return {
    ...ctx, companyId, branchId: null, store: scopeStore(unscoped(ctx.store), companyId),
    user: { ...ctx.user, isAdmin: true, roleName: "Rede de certificação (cadastro do parceiro)", companyIds: [companyId], branchIds: [] },
  };
}

export async function createNode(ctx: Ctx, input: CreateNodeInput): Promise<{ node: Doc; company: Doc; invite: InviteResult | null; linked: boolean }> {
  const base = unscoped(ctx.store);
  const { levelLabels } = await networkSettings(ctx.store);
  assert(isLevel(input.level), "Escolha o nível do parceiro.");
  const level = input.level;
  const parentNodeId = input.parentNodeId || null;
  const myNode = await nodeOfCompany(ctx.store, ctx.companyId);
  if (!canCreateUnder(ctx, myNode, parentNodeId)) {
    throw new PermissionError(parentNodeId ? "Você só pode cadastrar parceiros diretamente abaixo do seu próprio nó da rede (operação “Cadastrar parceiros abaixo”)." : "Somente a plataforma Intercert cadastra parceiros diretamente abaixo dela.");
  }
  const parent = parentNodeId ? await base.get("cert_network_nodes", parentNodeId) : null;
  if (parentNodeId && !parent) throw new NotFoundError("cert_network_nodes", parentNodeId);
  if (parent) assert(parent.status === "active", `${parent.name} está ${NODE_STATUS_LABEL[parent.status]?.toLowerCase() ?? parent.status}: não recebe parceiros novos.`);
  const lvErr = childLevelError(parent?.level ?? null, level, levelLabels);
  if (lvErr) throw new BusinessError(lvErr, "level");

  let company: Doc;
  let linked = false;
  let invite: InviteResult | null = null;
  const linkCnpj = onlyDigits(input.linkCnpj);
  if (level === "contador" && linkCnpj) {
    // vincula um escritório já existente
    const found = await findOne(base, "companies", [["eq", "cnpj", linkCnpj]]);
    if (!found) throw new BusinessError("Nenhum escritório contábil com este CNPJ no Intercert. Cadastre um escritório novo.", "not_found");
    if (found.kind !== "accounting") throw new BusinessError(`${found.tradeName || found.name} não é um escritório contábil: só escritórios entram na rede como ${levelLabels.contador}.`, "kind");
    if (found.status === "inactive") throw new BusinessError("Este escritório está inativo.", "inactive");
    company = found;
    linked = true;
  } else {
    assert(input.company, "Informe os dados da empresa do parceiro.");
    const kind = kindForLevel(level);
    const data = companyData({ ...input.company, kind });
    assert(input.admin?.name?.trim() && input.admin?.email?.trim(), "Informe o nome e o e-mail do administrador do parceiro (recebe o convite de acesso).");
    // o convite não pode falhar depois de a empresa existir: e-mail e login do administrador conferidos antes
    const email = input.admin!.email.trim().toLowerCase();
    assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "Informe um e-mail válido para o administrador do parceiro.");
    if (await findOne(base, "users", [["eq", "email", email]])) throw new BusinessError(`O e-mail ${email} já é usado por outro usuário: informe outro para o administrador do parceiro.`, "duplicate");
    const login = input.admin!.login?.trim().toLowerCase();
    if (login) {
      assert(/^[a-z0-9._-]{3,40}$/.test(login), "Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).");
      if (await findOne(base, "users", [["eq", "login", login]])) throw new BusinessError(`O login ${login} já é usado por outro usuário.`, "duplicate");
    }
    if (data.cnpj) {
      const dup = await findOne(base, "companies", [["eq", "cnpj", data.cnpj]]);
      if (dup) throw new BusinessError(dup.kind === "accounting" && level === "contador" ? `Já existe o escritório ${dup.tradeName || dup.name} com este CNPJ: use “Vincular escritório existente”.` : `Já existe empresa com este CNPJ: ${dup.tradeName || dup.name}.`, "duplicate");
    }
    // a empresa ainda não é nó: confere a unicidade antes de criar
    const created = await createCompanyWithDefaults(base, {
      key: newId(), name: data.name, tradeName: data.tradeName, cnpj: data.cnpj ?? undefined, regime: data.regime, uf: data.address.uf || input.uf || undefined,
      cityName: data.address.cityName || input.cityName || undefined, cityCode: data.address.cityCode, branchName: "Matriz", createdBy: ctx.user.id, kind,
    });
    company = await base.update("companies", created.company.id, { ...data, status: "active", createdBy: ctx.user.id });
    await base.update("branches", created.branch.id, { ie: data.ie, im: data.im, address: data.address, phone: data.phone, email: data.email });
    const roleKey = kind === "accounting" ? "firm_admin" : "partner_admin";
    const role = created.roles[roleKey];
    const res = await createUser(delegatedCtx(ctx, company.id), {
      name: input.admin!.name.trim(), email: input.admin!.email.trim(), login: input.admin!.login?.trim() || null, roleId: role?.id ?? null, isAdmin: false,
      companyIds: [company.id], branchIds: [], mode: "invite", origin: input.origin ?? "",
    });
    invite = res.invite ?? null;
  }

  if (await nodeOfCompany(ctx.store, company.id)) throw new BusinessError(`${company.tradeName || company.name} já faz parte da rede (uma empresa só pode ocupar um lugar na rede).`, "duplicate");
  const code = pad(await nextNumber(base, "network:node"));
  let node: Doc;
  try {
    node = await base.create("cert_network_nodes", {
      companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, nodeCompanyId: company.id, parentNodeId, level, path: parent ? [...(parent.path ?? []), parent.id] : [], depth: parent ? Number(parent.depth ?? 0) + 1 : 0,
      code, name: company.tradeName || company.name, cityName: input.cityName?.trim() || company.address?.cityName || null, uf: (input.uf || company.address?.uf || "").toUpperCase() || null,
      region: input.region?.trim() || null, status: "active", statusReason: null, statusAt: nowIso(), statusBy: ctx.user.id, commercialResponsible: input.commercialResponsible?.trim() || null,
      startedAt: input.startedAt || today(), closedAt: null, notes: input.notes?.trim() || null, isDemo: Boolean(company.isDemo),
    });
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(`${company.tradeName || company.name} já faz parte da rede.`, "duplicate");
    throw e;
  }
  await auditNode(ctx, node, {
    action: "network.node_create",
    summary: `${levelLabels[level]} ${node.name} (${code}) ${linked ? "vinculado" : "cadastrado"} na rede ${parent ? `abaixo de ${parent.name}` : "diretamente abaixo da Intercert"}${invite ? ` · convite enviado a ${input.admin!.email.trim()}` : ""}`,
    after: { level, parentNodeId, company: company.id, linked },
    related: [`company:${company.id}`, ...(parent ? [`cert_network_node:${parent.id}`] : [])],
  });
  if (parent) await auditNode(ctx, parent, { action: "network.child_added", summary: `Novo parceiro abaixo: ${levelLabels[level]} ${node.name} (${code})`, related: [`cert_network_node:${node.id}`] });
  return { node, company, invite, linked };
}

/** Descendentes (por caminho materializado). */
export function descendantsOf(nodes: Doc[], nodeId: string): Doc[] {
  return nodes.filter((n) => (n.path ?? []).includes(nodeId));
}

/** Plataforma: muda o nó de lugar (troca de pai), com motivo; recalcula o caminho do nó e de todos os descendentes. */
export async function moveNode(ctx: Ctx, nodeId: string, input: { parentNodeId: string | null; reason: string }): Promise<Doc> {
  if (!isPlatform(ctx)) throw new PermissionError("Somente a plataforma Intercert muda um parceiro de lugar na rede.");
  const reason = String(input.reason ?? "").trim();
  assert(reason.length >= 5, "Informe o motivo da mudança (ao menos 5 caracteres).");
  const base = unscoped(ctx.store);
  const { levelLabels } = await networkSettings(ctx.store);
  const nodes = await allNodes(ctx.store);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) throw new NotFoundError("cert_network_nodes", nodeId);
  assert(node.status !== "closed", "Parceiro encerrado não muda de lugar.");
  const newParentId = input.parentNodeId || null;
  if ((node.parentNodeId ?? null) === newParentId) throw new BusinessError("O parceiro já está abaixo deste nó.", "same_parent");
  const newParent = newParentId ? nodes.find((n) => n.id === newParentId) ?? null : null;
  if (newParentId && !newParent) throw new NotFoundError("cert_network_nodes", newParentId);
  if (newParent) {
    // ciclo: o novo pai não pode ser o próprio nó nem um descendente dele
    if (newParent.id === node.id || (newParent.path ?? []).includes(node.id)) throw new BusinessError("Movimento inválido: o novo pai está abaixo deste parceiro (formaria um ciclo).", "cycle");
    assert(newParent.status === "active", `${newParent.name} está ${NODE_STATUS_LABEL[newParent.status]?.toLowerCase() ?? newParent.status}: não recebe parceiros.`);
  }
  const lvErr = childLevelError(newParent?.level ?? null, node.level, levelLabels);
  if (lvErr) throw new BusinessError(lvErr, "level");
  const oldParent = node.parentNodeId ? nodes.find((n) => n.id === node.parentNodeId) ?? null : null;
  const newPath = newParent ? [...(newParent.path ?? []), newParent.id] : [];
  const oldPrefixLen = (node.path ?? []).length;
  const after = await base.update("cert_network_nodes", node.id, { parentNodeId: newParentId, path: newPath, depth: newPath.length });
  for (const d of descendantsOf(nodes, node.id)) {
    const rest = (d.path as string[]).slice(oldPrefixLen); // começa no próprio nó movido
    await base.update("cert_network_nodes", d.id, { path: [...newPath, ...rest], depth: newPath.length + rest.length });
  }
  // as regras de preço que o pai anterior definiu para este parceiro deixam de valer: passa a herdar a tabela do novo pai
  const { closeRulesForMove } = await import("./prices");
  const closed = await closeRulesForMove(ctx, node.id, reason);
  const summary = `${levelLabels[node.level as NetworkLevel]} ${node.name} movido de ${oldParent ? oldParent.name : "Intercert"} para ${newParent ? newParent.name : "Intercert"}${closed ? ` (${closed} regra(s) de preço do pai anterior encerrada(s); passa a valer a tabela do novo pai)` : ""}`;
  await auditNode(ctx, after, { action: "network.node_move", summary, reason, before: { parentNodeId: node.parentNodeId ?? null, path: node.path ?? [] }, after: { parentNodeId: newParentId, path: newPath } });
  if (oldParent) await auditNode(ctx, oldParent, { action: "network.child_removed", summary: `${node.name} saiu de baixo deste parceiro (movido para ${newParent ? newParent.name : "Intercert"})`, reason });
  if (newParent) await auditNode(ctx, newParent, { action: "network.child_added", summary: `${node.name} passou a ficar abaixo deste parceiro (vindo de ${oldParent ? oldParent.name : "Intercert"})`, reason });
  return after;
}

/**
 * Plataforma: suspende, reativa ou encerra um parceiro (motivo obrigatório para suspender e encerrar). Suspender o
 * pai não mexe nos filhos (eles aparecem sinalizados); encerrar exige não ter filhos ativos ou suspensos.
 */
export async function setNodeStatus(ctx: Ctx, nodeId: string, status: NodeStatus, reason?: string | null): Promise<Doc> {
  if (!isPlatform(ctx)) throw new PermissionError("Somente a plataforma Intercert suspende, reativa ou encerra parceiros da rede.");
  assert(["active", "suspended", "closed"].includes(status), "Situação inválida.");
  const base = unscoped(ctx.store);
  const nodes = await allNodes(ctx.store);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) throw new NotFoundError("cert_network_nodes", nodeId);
  if (node.status === status) throw new BusinessError(`O parceiro já está ${NODE_STATUS_LABEL[status].toLowerCase()}.`, "same_status");
  assert(node.status !== "closed", "Parceiro encerrado não muda de situação (o encerramento é definitivo; cadastre de novo se ele voltar).");
  const why = String(reason ?? "").trim();
  if (status !== "active") assert(why.length >= 5, "Informe o motivo (ao menos 5 caracteres).");
  if (status === "active") {
    const parent = node.parentNodeId ? nodes.find((n) => n.id === node.parentNodeId) : null;
    assert(!parent || parent.status !== "closed", "O parceiro acima está encerrado: mova este parceiro antes de reativá-lo.");
  }
  if (status === "closed") {
    const open = nodes.filter((n) => n.parentNodeId === node.id && n.status !== "closed");
    if (open.length) throw new BusinessError(`Encerre ou mova antes os ${open.length} parceiro(s) abaixo (${open.slice(0, 5).map((n) => n.name).join(", ")}${open.length > 5 ? "…" : ""}).`, "has_children");
  }
  const after = await base.update("cert_network_nodes", node.id, { status, statusReason: why || null, statusAt: nowIso(), statusBy: ctx.user.id, closedAt: status === "closed" ? today() : null });
  const verb = status === "active" ? "reativado" : status === "suspended" ? "suspenso" : "encerrado";
  const kids = nodes.filter((n) => n.parentNodeId === node.id && n.status === "active").length;
  await auditNode(ctx, after, { action: `network.node_${status === "active" ? "reactivate" : status === "suspended" ? "suspend" : "close"}`, summary: `${node.name} ${verb}${status === "suspended" && kids ? ` (os ${kids} parceiro(s) abaixo continuam ativos e aparecem sinalizados)` : ""}`, reason: why || null, before: { status: node.status }, after: { status } });
  return after;
}

/** Algum ancestral do nó está suspenso ou encerrado? (sinalização nos filhos) */
export function blockedAncestor(nodes: Doc[], node: Doc): Doc | null {
  for (const id of [...(node.path ?? [])].reverse()) {
    const a = nodes.find((n) => n.id === id);
    if (a && a.status !== "active") return a;
  }
  return null;
}

/** Contagem por nível de uma lista de nós. */
export function countByLevel(nodes: Doc[]): Record<string, number> {
  const out: Record<string, number> = { master: 0, regional: 0, revenda: 0, contador: 0 };
  for (const n of nodes) out[n.level] = (out[n.level] ?? 0) + 1;
  return out;
}

/** Usuários com acesso à empresa do nó (consulta). */
export async function nodeUsers(ctx: Ctx, node: Doc): Promise<Doc[]> {
  await getNode(ctx, node.id);
  const users = await listAll(unscoped(ctx.store), "users", { filters: [["contains", "companyIds", node.nodeCompanyId]] }).catch(async () => (await listAll(unscoped(ctx.store), "users")).filter((u) => (u.companyIds ?? []).includes(node.nodeCompanyId)));
  return users.filter((u) => (u.companyIds ?? []).includes(node.nodeCompanyId) && !u.isAdmin);
}

/** Histórico do nó (auditoria de quem agiu, em qualquer empresa). */
export async function nodeHistory(ctx: Ctx, nodeId: string): Promise<Doc[]> {
  await getNode(ctx, nodeId);
  const rows = await listAll(unscoped(ctx.store), "audit_logs", { filters: [["eq", "entityType", "cert_network_node"], ["eq", "entityId", nodeId]] }, 500);
  return rows.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
}

