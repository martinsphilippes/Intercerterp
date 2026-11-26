import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { searchable } from "@/lib/core/text";
import { unscoped } from "@/lib/db/scoped-store";
import { resolveRoleId } from "@/lib/auth/users";
import { syncRoleTemplate, templateSyncPlan } from "@/lib/auth/role-sync";
import { MODULES, PLATFORM_ACTIONS, SPECIAL_ACTIONS, type Crud, type ModuleKey, type PermissionMatrix, type SpecialAction } from "@/lib/permissions";
import { sha256 } from "@/lib/db";
import { nowIso } from "@/lib/dates";
import { maskPermissionsByContract } from "./tenancy/contract";

/**
 * Perfis de acesso (Tela 36 / visão complementar 9 — Perfis e permissões).
 * Matriz visualizar/criar/editar/excluir por módulo + operações específicas + limite de desconto.
 * Perfis de sistema (semeados) podem ser editados, nunca excluídos.
 */

export const CRUD_OPS: Array<{ key: Crud; label: string }> = [
  { key: "view", label: "Visualizar" },
  { key: "create", label: "Criar" },
  { key: "edit", label: "Editar" },
  { key: "delete", label: "Excluir" },
];

/**
 * Operações que não se aplicam ao módulo ("—" na matriz): vendas, PDV, caixa e movimentos de estoque nunca são
 * excluídos (desfazem-se por cancelamento/estorno, que são operações específicas); relatórios só são visualizados.
 */
export const NOT_APPLICABLE: Partial<Record<ModuleKey, Crud[]>> = {
  pdv: ["delete"],
  sales: ["delete"],
  cash: ["delete"],
  stock: ["delete"],
  reports: ["create", "edit", "delete"],
};

export function applicable(module: string, op: Crud) {
  return !(NOT_APPLICABLE[module as ModuleKey] ?? []).includes(op);
}

/** Agrupamento das operações específicas pelo módulo a que pertencem (exibição na matriz). */
export const ACTION_MODULE: Record<string, ModuleKey> = {
  sale: "sales",
  cash: "cash",
  stock: "stock",
  finance: "finance",
  purchase: "purchases",
  fiscal: "fiscal",
  data: "reports",
  admin: "admin",
  support: "support",
  customer: "customers",
  pdv: "pdv",
};

export function actionModule(action: string): ModuleKey {
  return ACTION_MODULE[action.split(".")[0]] ?? "admin";
}

export interface RoleInput {
  name: string;
  description?: string | null;
  permissions: PermissionMatrix;
  actions: string[];
  discountLimitBps: number;
  active?: boolean;
  /** §44: exige autenticação em duas etapas (TOTP) dos usuários do perfil */
  requireTwoFactor?: boolean;
}

/** Mantém apenas módulos/operações conhecidos; qualquer operação implica "visualizar". */
export function normalizeMatrix(m: PermissionMatrix | null | undefined): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const mod of MODULES) {
    const src = (m ?? {})[mod.key] ?? {};
    const row: Partial<Record<Crud, boolean>> = {};
    for (const op of CRUD_OPS) if (src[op.key] && applicable(mod.key, op.key)) row[op.key] = true;
    if (row.create || row.edit || row.delete) row.view = true;
    if (Object.keys(row).length) out[mod.key] = row;
  }
  return out;
}

export function normalizeActions(a: string[] | null | undefined): SpecialAction[] {
  const wanted = new Set(a ?? []);
  return SPECIAL_ACTIONS.map((x) => x.key).filter((k) => wanted.has(k)) as SpecialAction[];
}

/** Diferença legível de perfil (campo a campo): "Vendas · Editar: Não permitido → Permitido", "Desconto máximo: 5% → 8%". */
export function roleDiff(before: Record<string, any>, after: Record<string, any>) {
  const b: Record<string, string> = {};
  const a: Record<string, string> = {};
  const yes = (v: boolean) => (v ? "Permitido" : "Não permitido");
  if (before.name !== after.name) {
    b["Nome"] = before.name;
    a["Nome"] = after.name;
  }
  if ((before.description ?? null) !== (after.description ?? null)) {
    b["Descrição"] = before.description ?? "—";
    a["Descrição"] = after.description ?? "—";
  }
  if ((before.discountLimitBps ?? 0) !== (after.discountLimitBps ?? 0)) {
    b["Desconto máximo"] = `${((before.discountLimitBps ?? 0) / 100).toLocaleString("pt-BR")}%`;
    a["Desconto máximo"] = `${((after.discountLimitBps ?? 0) / 100).toLocaleString("pt-BR")}%`;
  }
  if ((before.active ?? true) !== (after.active ?? true)) {
    b["Situação"] = before.active === false ? "Inativo" : "Ativo";
    a["Situação"] = after.active === false ? "Inativo" : "Ativo";
  }
  if (Boolean(before.requireTwoFactor) !== Boolean(after.requireTwoFactor)) {
    b["Exigir autenticação em duas etapas"] = before.requireTwoFactor ? "Sim" : "Não";
    a["Exigir autenticação em duas etapas"] = after.requireTwoFactor ? "Sim" : "Não";
  }
  for (const m of MODULES) {
    for (const op of CRUD_OPS) {
      const x = Boolean(before.permissions?.[m.key]?.[op.key]);
      const y = Boolean(after.permissions?.[m.key]?.[op.key]);
      if (x !== y) {
        b[`${m.label} · ${op.label}`] = yes(x);
        a[`${m.label} · ${op.label}`] = yes(y);
      }
    }
  }
  const ba = new Set(before.actions ?? []);
  const aa = new Set(after.actions ?? []);
  for (const act of SPECIAL_ACTIONS) {
    if (ba.has(act.key) !== aa.has(act.key)) {
      b[act.label] = yes(ba.has(act.key));
      a[act.label] = yes(aa.has(act.key));
    }
  }
  return { before: b, after: a };
}

/** Lê a matriz enviada pelo formulário (checkboxes "perm.<módulo>.<op>" e "action"). */
export function matrixFromForm(fd: FormData): { permissions: PermissionMatrix; actions: SpecialAction[] } {
  const m: Record<string, Record<string, boolean>> = {};
  for (const mod of MODULES) for (const op of CRUD_OPS) if (fd.get(`perm.${mod.key}.${op.key}`) === "on") (m[mod.key] ??= {})[op.key] = true;
  return { permissions: normalizeMatrix(m as PermissionMatrix), actions: normalizeActions(fd.getAll("action").map(String)) };
}

function slug(s: string) {
  return searchable(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36) || "perfil";
}

/**
 * Executa as verificações de permissão e, se negadas, registra a TENTATIVA no histórico (resultado "falha")
 * antes de propagar o erro — a auditoria registra tentativas, não só operações concluídas.
 */
export async function auditedGuard(ctx: Ctx, check: () => void, attempt: { module?: string; action: string; entityType: string; entityId?: string | null; summary: string }) {
  try {
    check();
  } catch (e) {
    if (e instanceof PermissionError) {
      await audit(ctx, { module: attempt.module ?? "admin", action: `${attempt.action}.denied`, entityType: attempt.entityType, entityId: attempt.entityId ?? null, summary: `Tentativa sem permissão: ${attempt.summary}`, result: "failure" });
    }
    throw e;
  }
}

async function guard(ctx: Ctx, op: Crud, summary: string, entityId?: string | null) {
  await auditedGuard(
    ctx,
    () => {
      requirePerm(ctx, "admin", op);
      requireAction(ctx, "admin.users");
    },
    { action: `role.${op}`, entityType: "role", entityId, summary },
  );
}

export async function listRoles(store: Store, companyId: string) {
  const roles = await listAll(store, "roles", { filters: [["eq", "companyId", companyId]] });
  // perfis de sistema recebem as operações novas dos modelos padrão (idempotente; nada configurado é removido)
  for (const [i, r] of roles.entries()) if (templateSyncPlan(r)) roles[i] = await syncRoleTemplate(store, r).catch(() => r);
  return roles.sort((a, b) => Number(Boolean(b.system)) - Number(Boolean(a.system)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}

/**
 * Usuários por perfil da empresa (perfil efetivo NA empresa; administradores não usam perfil). Lê usuários e perfis
 * uma única vez — para listagens com contagem por perfil.
 */
export async function usersByRole(store: Store, companyId: string): Promise<Map<string, Doc[]>> {
  const base = unscoped(store);
  const [users, roles] = await Promise.all([listAll(base, "users"), listAll(base, "roles")]);
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const out = new Map<string, Doc[]>();
  for (const u of users) {
    if (u.isAdmin || !(u.companyIds ?? []).includes(companyId)) continue;
    const rid = resolveRoleId(u, companyId, rolesById, roles);
    if (rid) out.set(rid, [...(out.get(rid) ?? []), u]);
  }
  return out;
}

/** Usuários cujo perfil NA EMPRESA DO PERFIL é este (perfil por empresa; administradores não usam perfil). */
export async function roleUsers(store: Store, roleId: string) {
  const base = unscoped(store);
  const role = await base.get("roles", roleId);
  if (!role) return [];
  const companyId = role.companyId as string;
  const [users, roles] = await Promise.all([listAll(base, "users"), listAll(base, "roles")]);
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  return users.filter((u) => !u.isAdmin && (!companyId || (u.companyIds ?? []).includes(companyId)) && resolveRoleId(u, companyId, rolesById, roles) === roleId);
}

const actionLabel = (k: string) => SPECIAL_ACTIONS.find((a) => a.key === k)?.label ?? k;
const moduleLabel = (k: string) => MODULES.find((m) => m.key === k)?.label ?? k;
const opLabel = (k: string) => CRUD_OPS.find((o) => o.key === k)?.label ?? k;

/**
 * Multiempresa — o que um perfil pode receber (docs/multiempresa/arquitetura.md §4):
 *  - operações da PLATAFORMA (rede inteira, fila de certificação de todos) só em perfis da empresa da plataforma;
 *    gravadas antes num perfil de outra empresa, ficam sem efeito (`toCtxUser`) e podem ser mantidas, nunca acrescentadas;
 *  - quem edita só concede o que ele mesmo tem na empresa (módulo × operação e operações específicas); o que o perfil
 *    já tinha antes da edição pode ser mantido. O administrador da plataforma (`isAdmin`) não tem esse limite.
 */
export async function assertGrantable(ctx: Ctx, wanted: { permissions: PermissionMatrix; actions: string[] }, before?: { permissions?: PermissionMatrix | null; actions?: string[] | null } | null) {
  const had = new Set(before?.actions ?? []);
  const company = await unscoped(ctx.store).get("companies", ctx.companyId);
  const platform = wanted.actions.filter((a) => (PLATFORM_ACTIONS as string[]).includes(a) && !had.has(a));
  if (platform.length && !company?.isPlatform)
    throw new BusinessError(`Operação da plataforma Intercert não pode ser concedida num perfil desta empresa: ${platform.map(actionLabel).join(", ")}.`, "forbidden");
  if (ctx.user.isAdmin) return;
  const outActions = wanted.actions.filter((a) => !had.has(a) && !(ctx.user.actions ?? []).includes(a));
  const outOps: string[] = [];
  for (const [mod, ops] of Object.entries(wanted.permissions ?? {}))
    for (const [op, on] of Object.entries(ops ?? {}))
      if (on && !(before?.permissions as any)?.[mod]?.[op] && !(ctx.user.permissions as any)?.[mod]?.[op]) outOps.push(`${moduleLabel(mod)} · ${opLabel(op)}`);
  if (outActions.length || outOps.length)
    throw new BusinessError(`Você só pode conceder acessos que você mesmo tem nesta empresa. Fora do seu perfil: ${[...outOps, ...outActions.map(actionLabel)].join("; ")}.`, "forbidden");
}

function validate(input: RoleInput) {
  assert(input.name?.trim(), "Informe o nome do perfil.");
  assert(Number.isInteger(input.discountLimitBps) && input.discountLimitBps >= 0 && input.discountLimitBps <= 10000, "Limite de desconto deve estar entre 0% e 100%.");
}

export async function createRole(ctx: Ctx, input: RoleInput, opts: { idemKey?: string; duplicatedFrom?: string } = {}) {
  await guard(ctx, "create", `criar perfil "${input.name}"`);
  validate(input);
  const existing = await listRoles(ctx.store, ctx.companyId);
  if (existing.some((r) => searchable(r.name) === searchable(input.name))) throw new BusinessError(`Já existe um perfil chamado "${input.name.trim()}".`, "duplicate");
  let key = slug(input.name);
  while (existing.some((r) => r.key === key)) key = `${key.slice(0, 32)}_${Math.floor(Math.random() * 900 + 100)}`;
  const id = opts.idemKey ? detId("role", ctx.companyId, opts.idemKey) : undefined;
  await assertGrantable(ctx, { permissions: normalizeMatrix(input.permissions), actions: normalizeActions(input.actions) });
  try {
    const role = await ctx.store.create(
      "roles",
      {
        companyId: ctx.companyId, key, name: input.name.trim(), description: input.description?.trim() || null, permissions: normalizeMatrix(input.permissions),
        actions: normalizeActions(input.actions), discountLimitBps: input.discountLimitBps, system: false, active: input.active ?? true, createdBy: ctx.user.id,
        requireTwoFactor: Boolean(input.requireTwoFactor),
      },
      id,
    );
    await audit(ctx, {
      module: "admin", action: opts.duplicatedFrom ? "role.duplicate" : "role.create", entityType: "role", entityId: role.id,
      summary: opts.duplicatedFrom ? `Perfil "${role.name}" criado por duplicação` : `Perfil "${role.name}" criado`,
      after: { name: role.name, permissions: role.permissions, actions: role.actions, discountLimitBps: role.discountLimitBps, requireTwoFactor: Boolean(role.requireTwoFactor) },
      related: opts.duplicatedFrom ? [`role:${opts.duplicatedFrom}`] : [],
    });
    return role;
  } catch (e) {
    if (isConflict(e) && id) return (await ctx.store.get("roles", id))!;
    throw e;
  }
}

export async function duplicateRole(ctx: Ctx, id: string, name?: string, idemKey?: string) {
  const src = await ctx.store.getOrThrow("roles", id);
  assert(src.companyId === ctx.companyId, "Perfil de outra empresa.");
  const roles = await listRoles(ctx.store, ctx.companyId);
  let n = name?.trim() || `${src.name} (cópia)`;
  let i = 2;
  while (roles.some((r) => searchable(r.name) === searchable(n))) n = `${src.name} (cópia ${i++})`;
  return createRole(ctx, { name: n, description: src.description, permissions: src.permissions, actions: src.actions, discountLimitBps: src.discountLimitBps ?? 0, requireTwoFactor: Boolean(src.requireTwoFactor) }, { idemKey, duplicatedFrom: id });
}

export async function updateRole(ctx: Ctx, id: string, input: RoleInput, reason?: string | null) {
  await guard(ctx, "edit", `alterar perfil "${input.name}"`, id);
  validate(input);
  const before = await ctx.store.getOrThrow("roles", id);
  assert(before.companyId === ctx.companyId, "Perfil de outra empresa.");
  const roles = await listRoles(ctx.store, ctx.companyId);
  if (roles.some((r) => r.id !== id && searchable(r.name) === searchable(input.name))) throw new BusinessError(`Já existe um perfil chamado "${input.name.trim()}".`, "duplicate");
  await assertGrantable(ctx, { permissions: normalizeMatrix(input.permissions), actions: normalizeActions(input.actions) }, before);
  if (input.active === false && before.active !== false) {
    const users = (await roleUsers(ctx.store, id)).filter((u) => u.status === "active" || u.status === "invited");
    if (users.length) throw new BusinessError(`O perfil está atribuído a ${users.length} usuário(s) ativo(s) ou convidado(s); altere-os antes de desativar.`, "in_use");
  }
  const after = await ctx.store.update("roles", id, {
    name: input.name.trim(), description: input.description?.trim() || null, permissions: normalizeMatrix(input.permissions), actions: normalizeActions(input.actions),
    discountLimitBps: input.discountLimitBps, active: input.active ?? before.active ?? true,
    ...(input.requireTwoFactor !== undefined ? { requireTwoFactor: Boolean(input.requireTwoFactor) } : {}),
  });
  const d = roleDiff(before, after);
  const n = Object.keys(d.after).length;
  if (n) {
    await audit(ctx, { module: "admin", action: "role.update", entityType: "role", entityId: id, summary: `Permissões do perfil "${after.name}" alteradas (${n} item(ns))${before.system ? " — perfil de sistema" : ""}`, before: d.before, after: d.after, reason: reason ?? null });
  }
  return after;
}

export async function deleteRole(ctx: Ctx, id: string) {
  await guard(ctx, "delete", "excluir perfil", id);
  const role = await ctx.store.getOrThrow("roles", id);
  assert(role.companyId === ctx.companyId, "Perfil de outra empresa.");
  if (role.system) throw new BusinessError("Perfis de sistema podem ser editados, mas não excluídos.", "system_role");
  const users = await roleUsers(ctx.store, id);
  if (users.length) throw new BusinessError(`Perfil atribuído a ${users.length} usuário(s). Altere o perfil desses usuários antes de excluir.`, "in_use");
  await ctx.store.delete("roles", id);
  await audit(ctx, { module: "admin", action: "role.delete", entityType: "role", entityId: id, summary: `Perfil "${role.name}" excluído`, before: { name: role.name, permissions: role.permissions, actions: role.actions } });
}

/** Resumo de cobertura de um perfil (para listagens). */
export function roleCoverage(role: Pick<Doc, "permissions" | "actions">) {
  const m = (role.permissions ?? {}) as PermissionMatrix;
  const modules = MODULES.filter((x) => m[x.key]?.view).length;
  const writes = MODULES.filter((x) => m[x.key]?.create || m[x.key]?.edit || m[x.key]?.delete).length;
  return { modules, writes, actions: (role.actions ?? []).length };
}

// ───────────────────────────── multiempresa: administração feita pelo próprio cliente (docs/multiempresa/administracao.md)

/** Código do erro de negócio quando a operação deixaria a empresa sem administrador ativo. */
export const LAST_COMPANY_ADMIN = "last_company_admin";

/** O que o administrador da empresa precisa ter no perfil (texto das mensagens). */
export const ADMIN_ACCESS_HINT = "um perfil com Administração › Editar e “Gerenciar usuários e perfis”";

/** Perfil que administra usuários na empresa: Administração › Editar e “Gerenciar usuários e perfis”, perfil ativo. */
export function roleAdministersUsers(role: Record<string, any> | null | undefined): boolean {
  return Boolean(role && role.active !== false && role.permissions?.admin?.edit && (role.actions ?? []).includes("admin.users"));
}

/** Estado simulado (depois da operação) para conferir os administradores antes de gravar. */
export interface CompanyAdminOverrides {
  /** cadastros de usuário como ficariam */
  users?: Array<Record<string, any>>;
  /** perfis como ficariam */
  roles?: Array<Record<string, any>>;
  /** perfis excluídos */
  removedRoleIds?: string[];
}

/**
 * Administradores DA EMPRESA: usuários ativos, vinculados a ela, cujo perfil efetivo NA empresa administra usuários
 * (`roleAdministersUsers`). O administrador da plataforma (`isAdmin`) não conta, nem o vendedor sem acesso ao sistema.
 * Leitura deliberadamente sem escopo (usuários e perfis), só para a conferência.
 */
export async function companyAdmins(store: Store, companyId: string, overrides: CompanyAdminOverrides = {}): Promise<Doc[]> {
  if (!companyId) return [];
  const base = unscoped(store);
  const [users, roles] = await Promise.all([listAll(base, "users", { filters: [["contains", "companyIds", companyId]] }), listAll(base, "roles")]);
  const byId = new Map<string, Record<string, any>>(users.map((u) => [u.id, u]));
  for (const u of overrides.users ?? []) byId.set(u.id, u);
  const rolesById = new Map<string, Doc>(roles.map((r) => [r.id, r]));
  for (const r of overrides.roles ?? []) rolesById.set(r.id, r as Doc);
  for (const id of overrides.removedRoleIds ?? []) rolesById.delete(id);
  const all = [...rolesById.values()];
  return [...byId.values()].filter((u) => {
    if (u.isAdmin || u.loginDisabled || u.status !== "active" || !(u.companyIds ?? []).includes(companyId)) return false;
    const rid = resolveRoleId(u, companyId, rolesById, all);
    return roleAdministersUsers(rid ? rolesById.get(rid) : null);
  }) as Doc[];
}

const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);

/**
 * Atribuir um perfil a alguém é conceder o que o perfil dá: quem não é o administrador da plataforma só atribui perfil
 * cujas permissões e operações ele mesmo tem na empresa — a regra de `assertGrantable`, aplicada ao perfil inteiro.
 * Operações da plataforma num perfil de empresa comum e módulos fora do contrato não contam (lá não têm efeito).
 * `describe` monta a mensagem a partir do detalhe ("Fora do seu perfil: …").
 */
export async function assertAssignable(ctx: Ctx, role: Record<string, any>, describe?: (detail: string) => string) {
  if (ctx.user.isAdmin) return;
  const company = await unscoped(ctx.store).get("companies", ctx.companyId);
  const actions = normalizeActions((role.actions ?? []).filter((a: string) => company?.isPlatform || !(PLATFORM_ACTIONS as string[]).includes(a)));
  const permissions = maskPermissionsByContract(normalizeMatrix(role.permissions), company);
  try {
    await assertGrantable(ctx, { permissions, actions });
  } catch (e) {
    if (!(e instanceof BusinessError) || e.code !== "forbidden") throw e;
    const i = e.message.indexOf("Fora do seu perfil:");
    const detail = i >= 0 ? e.message.slice(i) : e.message;
    throw new BusinessError(
      describe ? describe(detail) : `Você só pode atribuir perfis com acessos que você mesmo tem nesta empresa: o perfil “${role.name}” vai além do seu. ${detail}`,
      "forbidden",
    );
  }
}

/** Perfil como ficaria com a edição (sem gravar). */
function roleAfterEdit(before: Doc, input: RoleInput): Record<string, any> {
  return {
    ...before,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    permissions: normalizeMatrix(input.permissions),
    actions: normalizeActions(input.actions),
    discountLimitBps: input.discountLimitBps,
    active: input.active ?? before.active ?? true,
    ...(input.requireTwoFactor !== undefined ? { requireTwoFactor: Boolean(input.requireTwoFactor) } : {}),
  };
}

/**
 * Último administrador da empresa × perfil: retirar de um perfil Administração › Editar ou “Gerenciar usuários e perfis”,
 * desativá-lo ou excluí-lo não pode deixar a empresa (que tinha administrador próprio) sem nenhum administrador ativo.
 * Devolve se o perfil deixa de administrar usuários (para a conferência depois de gravar).
 */
async function assertRoleKeepsCompanyAdmins(ctx: Ctx, before: Doc, after: Record<string, any> | null, what: string): Promise<boolean> {
  if (!roleAdministersUsers(before) || (after && roleAdministersUsers(after))) return false;
  const companyId = before.companyId as string;
  const admins = await companyAdmins(ctx.store, companyId);
  if (!admins.length) return false;
  const remaining = await companyAdmins(ctx.store, companyId, after ? { roles: [after] } : { removedRoleIds: [before.id] });
  if (!remaining.length) throw await lastAdminRoleError(ctx, before, admins, what);
  return true;
}

/** Mensagem do bloqueio (sem `holders`: a conferência depois de gravar achou a empresa sem administrador). */
async function lastAdminRoleError(ctx: Ctx, role: Doc, holders: Doc[], what: string): Promise<BusinessError> {
  const company = await unscoped(ctx.store).get("companies", role.companyId);
  const companyName = company?.tradeName || company?.name || "a empresa";
  const who = holders.length
    ? `${joinNames(holders.map((u) => u.name))} ${holders.length === 1 ? "é o último administrador ativo" : "são os últimos administradores ativos"} de ${companyName} pelo perfil “${role.name}”.`
    : `${companyName} ficaria sem nenhum administrador ativo (outra alteração feita ao mesmo tempo retirou o último administrador além dos do perfil “${role.name}”).`;
  return new BusinessError(`Operação bloqueada: ${who} ${what} deixaria a empresa sem administrador. Antes, dê a outro usuário ativo desta empresa ${ADMIN_ACCESS_HINT}.`, LAST_COMPANY_ADMIN);
}

/** Pessoa afetada pela alteração de um perfil (nome, e-mail e situação). */
export interface RoleImpactPerson {
  id: string;
  name: string;
  email: string;
  /** active | invited | invite_expired | suspended | inactive */
  status: string;
}

export interface RoleImpact {
  roleId: string;
  roleName: string;
  /** pessoas com este perfil na empresa (o administrador da plataforma não usa perfil) */
  affected: RoleImpactPerson[];
  /** diferença legível (antes/depois) — `roleDiff` */
  diff: { before: Record<string, string>; after: Record<string, string> };
  changes: number;
  /** há pessoas no perfil e algo muda: salvar exige a confirmação explícita deste impacto */
  required: boolean;
  /** identifica este impacto (pessoas + diferença): a confirmação vale só para ele */
  token: string;
}

/**
 * Impacto de salvar um perfil compartilhado: quem é afetado (todas as pessoas com o perfil, em qualquer situação) e o que
 * muda. A confirmação é amarrada ao `token`: se as pessoas ou a diferença mudarem, é preciso confirmar de novo.
 */
export async function roleChangeImpact(ctx: Ctx, id: string, input: RoleInput): Promise<RoleImpact> {
  requirePerm(ctx, "admin", "edit");
  requireAction(ctx, "admin.users");
  const before = await ctx.store.getOrThrow("roles", id);
  assert(before.companyId === ctx.companyId, "Perfil de outra empresa.");
  const diff = roleDiff(before, roleAfterEdit(before, input));
  const now = nowIso();
  const affected = (await roleUsers(ctx.store, id))
    .map((u) => ({ id: u.id as string, name: u.name as string, email: u.email as string, status: u.status === "invited" && u.inviteExpiresAt && u.inviteExpiresAt < now ? "invite_expired" : String(u.status ?? "active") }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const changes = Object.keys(diff.after).length;
  const token = sha256(JSON.stringify({ id, people: affected.map((p) => p.id).sort(), after: diff.after, before: diff.before })).slice(0, 32);
  return { roleId: id, roleName: before.name, affected, diff, changes, required: affected.length > 0 && changes > 0, token };
}

/**
 * Salvar perfil existente pela tela (multiempresa): além das regras de `updateRole`, exige a confirmação explícita do
 * impacto quando o perfil é usado por pessoas (`impactToken` = `roleChangeImpact().token`) e não deixa a empresa sem
 * administrador ativo (também sob concorrência: conferido de novo depois de gravar e desfeito se for o caso).
 */
export async function saveRoleChecked(ctx: Ctx, id: string, input: RoleInput, opts: { reason?: string | null; impactToken?: string | null } = {}) {
  await guard(ctx, "edit", `alterar perfil "${input.name}"`, id);
  validate(input);
  const before = await ctx.store.getOrThrow("roles", id);
  assert(before.companyId === ctx.companyId, "Perfil de outra empresa.");
  await assertGrantable(ctx, { permissions: normalizeMatrix(input.permissions), actions: normalizeActions(input.actions) }, before);
  const after = roleAfterEdit(before, input);
  const what = after.active === false && before.active !== false ? "Desativar o perfil" : "Retirar deste perfil Administração › Editar ou “Gerenciar usuários e perfis”";
  const reduces = await assertRoleKeepsCompanyAdmins(ctx, before, after, what);
  const impact = await roleChangeImpact(ctx, id, input);
  if (impact.required && opts.impactToken !== impact.token) {
    const n = impact.affected.length;
    throw new BusinessError(
      opts.impactToken
        ? "As pessoas afetadas ou as permissões mudaram desde a confirmação. Revise o impacto e confirme de novo."
        : `Confirme o impacto antes de salvar: a alteração vale para ${n} pessoa${n === 1 ? "" : "s"} com o perfil “${before.name}” (${joinNames(impact.affected.slice(0, 5).map((p) => p.name))}${n > 5 ? ` e mais ${n - 5}` : ""}).`,
      "impact_confirmation",
    );
  }
  const saved = await updateRole(ctx, id, input, opts.reason);
  if (reduces && (await companyAdmins(ctx.store, before.companyId)).length === 0) {
    // outra operação ao mesmo tempo levou o último administrador: desfaz esta alteração
    await ctx.store.update("roles", id, {
      name: before.name, description: before.description ?? null, permissions: before.permissions ?? {}, actions: before.actions ?? [], discountLimitBps: before.discountLimitBps ?? 0,
      active: before.active ?? true, requireTwoFactor: Boolean(before.requireTwoFactor),
    });
    await audit(ctx, { module: "admin", action: "role.update", entityType: "role", entityId: id, summary: `Alteração do perfil "${before.name}" desfeita: deixaria a empresa sem administrador ativo (operação simultânea)`, result: "failure" });
    throw await lastAdminRoleError(ctx, before, [], what);
  }
  return saved;
}

/** Excluir perfil pela tela: as regras de `deleteRole` e a proteção do último administrador da empresa. */
export async function deleteRoleChecked(ctx: Ctx, id: string) {
  await guard(ctx, "delete", "excluir perfil", id);
  const role = await ctx.store.getOrThrow("roles", id);
  assert(role.companyId === ctx.companyId, "Perfil de outra empresa.");
  await assertRoleKeepsCompanyAdmins(ctx, role, null, "Excluir o perfil");
  return deleteRole(ctx, id);
}
