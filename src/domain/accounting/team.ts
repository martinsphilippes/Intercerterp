import { listAll, isConflict } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError } from "@/lib/core/errors";
import { NotFoundError } from "@/lib/db/types";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { canDo } from "@/lib/permissions";
import { DEPARTMENT_KIND, GROUP_KIND, requireFirm } from "./common";

/**
 * Equipe e carteira: departamentos, membros, responsáveis por cliente e grupos de clientes.
 *
 * Visibilidade: quem tem "Ver toda a carteira" (ou é administrador) enxerga todos os clientes do escritório;
 * os demais só os clientes em que são responsável geral, titular/substituto numa atribuição ou cujo departamento
 * atribuído tem o usuário como gestor.
 */

// ───────────────────────────── Visibilidade da carteira

/** null = sem restrição (toda a carteira); Set = ids dos clientes visíveis. */
export async function visibleClientIds(ctx: Ctx): Promise<Set<string> | null> {
  if (ctx.user.isAdmin || canDo(ctx.user, "accounting.all_clients")) return null;
  const [assignments, managed, clients] = await Promise.all([
    listAll(ctx.store, "accounting_client_assignments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "userId", ctx.user.id]] }),
    listAll(ctx.store, "departments", { filters: [["eq", "companyId", ctx.companyId], ["eq", "managerUserId", ctx.user.id]] }),
    listAll(ctx.store, "accounting_clients", { filters: [["eq", "companyId", ctx.companyId], ["eq", "responsibleUserId", ctx.user.id]] }),
  ]);
  const ids = new Set<string>(clients.map((c) => c.id));
  for (const a of assignments) if (a.active !== false) ids.add(a.clientId);
  if (managed.length) {
    const depIds = new Set(managed.map((d) => d.id));
    const all = await listAll(ctx.store, "accounting_client_assignments", { filters: [["eq", "companyId", ctx.companyId]] });
    for (const a of all) if (a.active !== false && a.departmentId && depIds.has(a.departmentId)) ids.add(a.clientId);
  }
  return ids;
}

// ───────────────────────────── Departamentos

export interface DepartmentInput {
  name: string;
  kind?: string | null;
  key?: string | null;
  managerUserId?: string | null;
  active?: boolean;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);

async function assertFirmUser(ctx: Ctx, userId: string, label: string) {
  const u = await ctx.store.get("users", userId);
  if (!u || u.status !== "active" || !(u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId))) throw new BusinessError(`${label} precisa ser um usuário ativo do escritório.`, "invalid_user");
  return u;
}

export async function listDepartments(ctx: Ctx): Promise<Doc[]> {
  requirePerm(ctx, "accounting", "view");
  return (await listAll(ctx.store, "departments", { filters: [["eq", "companyId", ctx.companyId]] })).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name, "pt-BR"));
}

export async function saveDepartment(ctx: Ctx, id: string | null, input: DepartmentInput): Promise<Doc> {
  requireAction(ctx, "accounting.manage_team");
  await requireFirm(ctx);
  assert(input.name?.trim(), "Informe o nome do departamento.");
  const kind = input.kind || "custom";
  assert(DEPARTMENT_KIND.some((k) => k.value === kind), "Tipo de departamento inválido.");
  if (input.managerUserId) await assertFirmUser(ctx, input.managerUserId, "O gestor");
  const data = { name: input.name.trim(), kind, managerUserId: input.managerUserId || null, active: input.active ?? true };
  if (id) {
    const before = await ctx.store.get("departments", id);
    if (!before) throw new NotFoundError("departments", id);
    const after = await ctx.store.update("departments", id, data);
    await audit(ctx, { module: "accounting", action: "department.update", entityType: "department", entityId: id, summary: `Departamento ${after.name} alterado`, before, after: data });
    return after;
  }
  const key = (input.key?.trim() && slug(input.key)) || slug(input.name);
  try {
    const row = await ctx.store.create("departments", { ...data, key, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, sortOrder: 99 });
    await audit(ctx, { module: "accounting", action: "department.create", entityType: "department", entityId: row.id, summary: `Departamento ${row.name} criado`, after: data });
    return row;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Já existe departamento com este identificador.", "duplicate");
    throw e;
  }
}

export async function listDepartmentMembers(ctx: Ctx, departmentId?: string | null): Promise<Doc[]> {
  requirePerm(ctx, "accounting", "view");
  return listAll(ctx.store, "department_members", { filters: [["eq", "companyId", ctx.companyId], ...(departmentId ? [["eq", "departmentId", departmentId] as any] : [])] });
}

export async function setDepartmentMember(ctx: Ctx, departmentId: string, userId: string, role: "manager" | "member" | "remove"): Promise<Doc | null> {
  requireAction(ctx, "accounting.manage_team");
  const dep = await ctx.store.get("departments", departmentId);
  if (!dep) throw new NotFoundError("departments", departmentId);
  const u = await assertFirmUser(ctx, userId, "O membro");
  const existing = (await listAll(ctx.store, "department_members", { filters: [["eq", "departmentId", departmentId], ["eq", "userId", userId]] }))[0] ?? null;
  if (role === "remove") {
    if (existing) {
      await ctx.store.delete("department_members", existing.id);
      await audit(ctx, { module: "accounting", action: "department.member_remove", entityType: "department", entityId: departmentId, summary: `${u.name} removido do departamento ${dep.name}` });
    }
    return null;
  }
  const row = existing
    ? await ctx.store.update("department_members", existing.id, { role, active: true })
    : await ctx.store.create("department_members", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, departmentId, userId, role, active: true });
  await audit(ctx, { module: "accounting", action: "department.member_set", entityType: "department", entityId: departmentId, summary: `${u.name} ${role === "manager" ? "gestor" : "membro"} do departamento ${dep.name}` });
  return row;
}

// ───────────────────────────── Responsáveis por cliente

export interface AssignmentInput {
  departmentId?: string | null;
  userId: string;
  role: "titular" | "substituto";
  validFrom?: string | null;
  validTo?: string | null;
}

export async function listAssignments(ctx: Ctx, clientId: string): Promise<Doc[]> {
  requirePerm(ctx, "accounting", "view");
  return (await listAll(ctx.store, "accounting_client_assignments", { filters: [["eq", "clientId", clientId]] })).sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || (a.role === "titular" ? -1 : 1) - (b.role === "titular" ? -1 : 1));
}

export async function assignResponsible(ctx: Ctx, clientId: string, input: AssignmentInput): Promise<Doc> {
  requireAction(ctx, "accounting.manage_team");
  const client = await ctx.store.get("accounting_clients", clientId);
  if (!client) throw new NotFoundError("accounting_clients", clientId);
  assert(input.role === "titular" || input.role === "substituto", "Papel inválido.");
  const u = await assertFirmUser(ctx, input.userId, "O responsável");
  let dep: Doc | null = null;
  if (input.departmentId) {
    dep = await ctx.store.get("departments", input.departmentId);
    if (!dep) throw new BusinessError("Departamento inexistente.", "invalid_department");
  }
  if (input.validFrom && input.validTo) assert(input.validTo >= input.validFrom, "A vigência final não pode ser anterior à inicial.");
  const current = (await listAll(ctx.store, "accounting_client_assignments", { filters: [["eq", "clientId", clientId], ["eq", "userId", input.userId]] })).find((a) => (a.departmentId ?? null) === (input.departmentId ?? null) && a.active !== false);
  const data = { departmentId: input.departmentId || null, userId: input.userId, role: input.role, validFrom: input.validFrom || null, validTo: input.validTo || null, active: true };
  const row = current ? await ctx.store.update("accounting_client_assignments", current.id, data) : await ctx.store.create("accounting_client_assignments", { ...data, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId });
  // um único titular por departamento: o anterior vira substituto
  if (input.role === "titular") {
    const others = (await listAll(ctx.store, "accounting_client_assignments", { filters: [["eq", "clientId", clientId], ["eq", "role", "titular"]] })).filter((a) => a.id !== row.id && a.active !== false && (a.departmentId ?? null) === (input.departmentId ?? null));
    for (const o of others) await ctx.store.update("accounting_client_assignments", o.id, { role: "substituto" });
  }
  await audit(ctx, { module: "accounting", action: "client.assign", entityType: "accounting_client", entityId: clientId, summary: `${client.name}: ${u.name} ${input.role}${dep ? ` em ${dep.name}` : " (geral)"}`, after: data });
  return row;
}

export async function endAssignment(ctx: Ctx, assignmentId: string, validTo?: string | null): Promise<Doc> {
  requireAction(ctx, "accounting.manage_team");
  const a = await ctx.store.get("accounting_client_assignments", assignmentId);
  if (!a) throw new NotFoundError("accounting_client_assignments", assignmentId);
  const after = await ctx.store.update("accounting_client_assignments", assignmentId, { active: false, validTo: validTo || new Date().toISOString().slice(0, 10) });
  await audit(ctx, { module: "accounting", action: "client.unassign", entityType: "accounting_client", entityId: a.clientId, summary: `Responsabilidade encerrada (${a.role})`, before: a });
  return after;
}

// ───────────────────────────── Grupos de clientes

export interface GroupInput {
  name: string;
  kind?: string | null;
  notes?: string | null;
  active?: boolean;
}

export async function listGroups(ctx: Ctx): Promise<Doc[]> {
  requirePerm(ctx, "accounting", "view");
  return (await listAll(ctx.store, "accounting_client_groups", { filters: [["eq", "companyId", ctx.companyId]] })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function saveGroup(ctx: Ctx, id: string | null, input: GroupInput): Promise<Doc> {
  requirePerm(ctx, "accounting", id ? "edit" : "create");
  await requireFirm(ctx);
  assert(input.name?.trim(), "Informe o nome do grupo.");
  const kind = input.kind || "economic";
  assert(GROUP_KIND.some((k) => k.value === kind), "Tipo de grupo inválido.");
  const data = { name: input.name.trim(), kind, notes: input.notes?.trim() || null, active: input.active ?? true };
  const dup = (await listGroups(ctx)).find((g) => g.name.toLowerCase() === data.name.toLowerCase() && g.id !== id);
  if (dup) throw new BusinessError("Já existe grupo com este nome.", "duplicate");
  if (id) {
    const before = await ctx.store.get("accounting_client_groups", id);
    if (!before) throw new NotFoundError("accounting_client_groups", id);
    const after = await ctx.store.update("accounting_client_groups", id, data);
    await audit(ctx, { module: "accounting", action: "group.update", entityType: "accounting_client_group", entityId: id, summary: `Grupo ${after.name} alterado`, before, after: data });
    return after;
  }
  const row = await ctx.store.create("accounting_client_groups", { ...data, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id });
  await audit(ctx, { module: "accounting", action: "group.create", entityType: "accounting_client_group", entityId: row.id, summary: `Grupo ${row.name} criado`, after: data });
  return row;
}
