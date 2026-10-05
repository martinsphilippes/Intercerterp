import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { searchable } from "@/lib/core/text";
import { MODULES, SPECIAL_ACTIONS, type Crud, type ModuleKey, type PermissionMatrix, type SpecialAction } from "@/lib/permissions";

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
  const known = new Set<string>(SPECIAL_ACTIONS.map((x) => x.key));
  return [...new Set((a ?? []).filter((x) => known.has(x)))] as SpecialAction[];
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
  return roles.sort((a, b) => Number(Boolean(b.system)) - Number(Boolean(a.system)) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}

export async function roleUsers(store: Store, roleId: string) {
  return listAll(store, "users", { filters: [["eq", "roleId", roleId]] });
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
  try {
    const role = await ctx.store.create(
      "roles",
      {
        companyId: ctx.companyId, key, name: input.name.trim(), description: input.description?.trim() || null, permissions: normalizeMatrix(input.permissions),
        actions: normalizeActions(input.actions), discountLimitBps: input.discountLimitBps, system: false, active: input.active ?? true, createdBy: ctx.user.id,
      },
      id,
    );
    await audit(ctx, {
      module: "admin", action: opts.duplicatedFrom ? "role.duplicate" : "role.create", entityType: "role", entityId: role.id,
      summary: opts.duplicatedFrom ? `Perfil "${role.name}" criado por duplicação` : `Perfil "${role.name}" criado`,
      after: { name: role.name, permissions: role.permissions, actions: role.actions, discountLimitBps: role.discountLimitBps },
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
  return createRole(ctx, { name: n, description: src.description, permissions: src.permissions, actions: src.actions, discountLimitBps: src.discountLimitBps ?? 0 }, { idemKey, duplicatedFrom: id });
}

export async function updateRole(ctx: Ctx, id: string, input: RoleInput) {
  await guard(ctx, "edit", `alterar perfil "${input.name}"`, id);
  validate(input);
  const before = await ctx.store.getOrThrow("roles", id);
  assert(before.companyId === ctx.companyId, "Perfil de outra empresa.");
  const roles = await listRoles(ctx.store, ctx.companyId);
  if (roles.some((r) => r.id !== id && searchable(r.name) === searchable(input.name))) throw new BusinessError(`Já existe um perfil chamado "${input.name.trim()}".`, "duplicate");
  if (input.active === false && before.active !== false) {
    const users = (await roleUsers(ctx.store, id)).filter((u) => u.status === "active" || u.status === "invited");
    if (users.length) throw new BusinessError(`O perfil está atribuído a ${users.length} usuário(s) ativo(s) ou convidado(s); altere-os antes de desativar.`, "in_use");
  }
  const after = await ctx.store.update("roles", id, {
    name: input.name.trim(), description: input.description?.trim() || null, permissions: normalizeMatrix(input.permissions), actions: normalizeActions(input.actions),
    discountLimitBps: input.discountLimitBps, active: input.active ?? before.active ?? true,
  });
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit(ctx, { module: "admin", action: "role.update", entityType: "role", entityId: id, summary: `Perfil "${after.name}" alterado${before.system ? " (perfil de sistema)" : ""}`, before: d.before, after: d.after });
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
