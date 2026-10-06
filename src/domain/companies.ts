import { detId, findOne, isConflict, listAll, newId } from "@/lib/db";
import { NotFoundError, type Doc, type Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { ctxForCompany, requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { isValidCnpj, onlyDigits } from "@/lib/core/text";
import { DEFAULT_TZ, today } from "@/lib/dates";
import type { Crud } from "@/lib/permissions";
import { toCtxUser, userRoleIn } from "@/lib/auth/users";
import { createCompanyWithDefaults } from "./setup";

/**
 * Empresas e filiais (Tela 38). Cadastro e situação, identificação, contatos, endereço e dados fiscais;
 * parametrizações da unidade (tabela de preço padrão, depósito padrão, fuso) usadas pela operação.
 * Alterações cadastrais não afetam documentos anteriores (as operações guardam snapshots).
 */

export interface AddressInput {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  cityName?: string;
  cityCode?: string;
  uf?: string;
}

export interface CompanyInput {
  /** "retail" (padrão) ou "accounting" (escritório contábil) */
  kind?: string | null;
  name: string;
  tradeName?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  regime?: string | null;
  crt?: string | null;
  cnae?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: AddressInput;
  notes?: string | null;
}

export interface BranchInput {
  code: string;
  name: string;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: AddressInput;
  defaultWarehouseId?: string | null;
  defaultPriceTableId?: string | null;
  timezone?: string | null;
  managerUserId?: string | null;
}

export const COMPANY_KINDS = [
  { value: "retail", label: "Empresa operacional (comércio, serviços)" },
  { value: "accounting", label: "Escritório contábil (carteira de clientes)" },
];

export const REGIMES = [
  { value: "simples", label: "Simples Nacional", crt: "1" },
  { value: "simples_excesso", label: "Simples Nacional — excesso de sublimite", crt: "2" },
  { value: "presumido", label: "Lucro Presumido", crt: "3" },
  { value: "real", label: "Lucro Real", crt: "3" },
  { value: "mei", label: "MEI", crt: "4" },
];

export const CRT_OPTIONS = [
  { value: "1", label: "1 — Simples Nacional" },
  { value: "2", label: "2 — Simples Nacional, excesso de sublimite" },
  { value: "3", label: "3 — Regime normal" },
  { value: "4", label: "4 — MEI" },
];

export const TIMEZONES = ["America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife", "America/Belem", "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Noronha"];

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export function cleanAddress(a?: AddressInput) {
  const x = a ?? {};
  return {
    zip: onlyDigits(x.zip) || "",
    street: x.street?.trim() || "",
    number: x.number?.trim() || "",
    complement: x.complement?.trim() || "",
    district: x.district?.trim() || "",
    cityName: x.cityName?.trim() || "",
    cityCode: onlyDigits(x.cityCode) || "",
    uf: (x.uf ?? "").trim().toUpperCase(),
  };
}

export function validateAddress(a: ReturnType<typeof cleanAddress>) {
  if (a.uf) assert(UFS.includes(a.uf), "UF inválida.");
  if (a.cityCode) assert(/^\d{7}$/.test(a.cityCode), "Código IBGE do município deve ter 7 dígitos.");
  if (a.zip) assert(/^\d{8}$/.test(a.zip), "CEP deve ter 8 dígitos.");
}

function companyData(input: CompanyInput) {
  assert(input.name?.trim(), "Informe a razão social.");
  const cnpj = onlyDigits(input.cnpj) || null;
  if (cnpj) assert(isValidCnpj(cnpj), "CNPJ inválido.");
  const address = cleanAddress(input.address);
  validateAddress(address);
  if (input.cnae) assert(/^\d{7}$/.test(onlyDigits(input.cnae)), "CNAE deve ter 7 dígitos.");
  const regime = input.regime || "simples";
  assert(REGIMES.some((r) => r.value === regime), "Regime tributário inválido.");
  const crt = input.crt || REGIMES.find((r) => r.value === regime)!.crt;
  assert(CRT_OPTIONS.some((c) => c.value === crt), "CRT inválido.");
  const kind = input.kind || "retail";
  assert(COMPANY_KINDS.some((k) => k.value === kind), "Tipo de empresa inválido.");
  return {
    kind,
    name: input.name.trim(),
    tradeName: input.tradeName?.trim() || input.name.trim(),
    cnpj,
    ie: input.ie?.trim().toUpperCase() || null,
    im: input.im?.trim() || null,
    regime,
    crt,
    cnae: onlyDigits(input.cnae) || null,
    email: input.email?.trim().toLowerCase() || null,
    phone: onlyDigits(input.phone) || null,
    address,
    notes: input.notes?.trim() || null,
  };
}

/** Nova empresa com parametrização inicial (matriz, depósitos, perfis, tabela, contas, meios e condições). */
export async function createCompany(ctx: Ctx, input: CompanyInput & { branchName?: string }) {
  requirePerm(ctx, "admin", "create");
  const data = companyData(input);
  if (data.cnpj) {
    const dup = await findOne(ctx.store, "companies", [["eq", "cnpj", data.cnpj]]);
    if (dup) throw new BusinessError(`Já existe empresa com este CNPJ: ${dup.name}.`, "duplicate");
  } else {
    const all = await listAll(ctx.store, "companies");
    if (all.some((c) => c.name.toLowerCase() === data.name.toLowerCase())) throw new BusinessError("Já existe empresa com esta razão social; informe o CNPJ para diferenciá-las.", "duplicate");
  }
  const { company, branch, roles } = await createCompanyWithDefaults(unscoped(ctx.store), {
    key: newId(),
    name: data.name, tradeName: data.tradeName, cnpj: data.cnpj ?? undefined, regime: data.regime, uf: data.address.uf, cityName: data.address.cityName,
    cityCode: data.address.cityCode, branchName: input.branchName?.trim() || "Matriz", createdBy: ctx.user.id, kind: data.kind as "retail" | "accounting",
  });
  const store = unscoped(ctx.store);
  const updated = await store.update("companies", company.id, { ...data, status: "active" });
  await store.update("branches", branch.id, { ie: data.ie, im: data.im, address: data.address, phone: data.phone, email: data.email });
  // quem cria passa a ter acesso, com o perfil Administrador da nova empresa (administradores já enxergam todas)
  if (!ctx.user.isAdmin) {
    const me = await store.get("users", ctx.user.id);
    if (me) {
      const roleByCompany = { ...(me.roleByCompany ?? {}), ...(roles.admin ? { [company.id]: roles.admin.id } : {}) };
      await store.update("users", me.id, { companyIds: [...new Set([...(me.companyIds ?? []), company.id])], roleByCompany });
    }
  }
  await audit({ ...ctx, store, companyId: company.id, branchId: null }, { module: "admin", action: "company.create", entityType: "company", entityId: company.id, summary: `Empresa ${data.name} criada com filial ${branch.name} e parametrização inicial`, after: data, related: [`branch:${branch.id}`] });
  await audit(ctx, { module: "admin", action: "company.create", entityType: "company", entityId: company.id, summary: `Empresa ${data.name} criada (a partir de ${ctx.companyId ? "outra empresa" : "instalação"})`, related: [`branch:${branch.id}`] });
  return { company: updated, branch };
}

/**
 * Contexto para administrar uma empresa (a ativa ou outra autorizada): valida o acesso do usuário à empresa
 * (`ctxForCompany`) e confere a permissão no perfil DAQUELA empresa (perfil por empresa). O Store devolvido é
 * restrito à empresa-alvo — leituras e gravações dela funcionam sem abrir o isolamento das demais.
 */
export async function companyAdminCtx(ctx: Ctx, companyId: string, op: Crud = "view"): Promise<Ctx> {
  requirePerm(ctx, "admin", op);
  const target = await ctxForCompany(ctx, companyId);
  if (target !== ctx && !ctx.user.isAdmin) {
    const me = await unscoped(ctx.store).get("users", ctx.user.id);
    if (!me) throw new PermissionError("Você não tem acesso a esta empresa.");
    target.user = await toCtxUser(ctx.store, me, companyId);
    requirePerm(target, "admin", op);
  }
  return target;
}

/** Contexto para administrar uma filial: empresa autorizada e, para usuário restrito a filiais, a própria filial. */
export async function branchAdminCtx(ctx: Ctx, branchId: string, op: Crud = "view"): Promise<{ ctx: Ctx; branch: Doc<any> }> {
  const b = await unscoped(ctx.store).get("branches", branchId);
  if (!b) throw new NotFoundError("branches", branchId);
  const target = await companyAdminCtx(ctx, b.companyId, op);
  if (!ctx.user.isAdmin && (ctx.user.branchIds ?? []).length && !ctx.user.branchIds.includes(b.id)) throw new PermissionError("Você não tem acesso a esta filial.");
  return { ctx: target, branch: b };
}

export async function updateCompany(ctx: Ctx, id: string, input: CompanyInput) {
  const c = await companyAdminCtx(ctx, id, "edit");
  const before = await c.store.getOrThrow("companies", id);
  // o tipo (operacional × escritório) é definido na criação e não muda: a parametrização e o menu dependem dele
  const data = { ...companyData({ ...input, kind: before.kind ?? "retail" }), kind: before.kind ?? "retail" };
  if (data.cnpj && data.cnpj !== before.cnpj) {
    const dup = await findOne(c.store, "companies", [["eq", "cnpj", data.cnpj]]);
    if (dup && dup.id !== id) throw new BusinessError(`CNPJ já usado pela empresa ${dup.name}.`, "duplicate");
  }
  try {
    const after = await c.store.update("companies", id, data);
    const d = diff(before, after);
    if (Object.keys(d.after).length) await audit(c, { module: "admin", action: "company.update", entityType: "company", entityId: id, summary: `Cadastro da empresa ${after.name} alterado (documentos já emitidos mantêm os dados da época)`, before: d.before, after: d.after });
    return after;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("CNPJ já usado por outra empresa.", "duplicate");
    throw e;
  }
}

/** Inativar a empresa bloqueia a seleção dela como unidade de trabalho e, com isso, toda operação (consulta exige reativar). */
export async function setCompanyStatus(ctx: Ctx, id: string, status: "active" | "inactive", reason?: string | null) {
  const c = await companyAdminCtx(ctx, id, "edit");
  const co = await c.store.getOrThrow("companies", id);
  if (status === "inactive") {
    assert(id !== ctx.companyId, "Não é possível inativar a empresa em uso. Troque para outra empresa antes.");
    const open = await c.store.list("cash_sessions", { filters: [["eq", "companyId", id], ["eq", "status", ["open", "reopened"]]], limit: 1 });
    assert(open.items.length === 0, "Há caixas abertos nesta empresa; feche-os antes de inativar.");
  }
  const after = await c.store.update("companies", id, { status });
  await audit(c, { module: "admin", action: `company.${status}`, entityType: "company", entityId: id, summary: `Empresa ${co.name} ${status === "inactive" ? "inativada (não pode mais ser selecionada nem operar)" : "reativada"}`, reason: reason ?? null });
  return after;
}

function branchData(input: BranchInput) {
  assert(input.name?.trim(), "Informe o nome da filial.");
  assert(input.code?.trim(), "Informe o código da filial.");
  const cnpj = onlyDigits(input.cnpj) || null;
  if (cnpj) assert(isValidCnpj(cnpj), "CNPJ da filial inválido.");
  const address = cleanAddress(input.address);
  validateAddress(address);
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    cnpj,
    ie: input.ie?.trim().toUpperCase() || null,
    im: input.im?.trim() || null,
    phone: onlyDigits(input.phone) || null,
    email: input.email?.trim().toLowerCase() || null,
    address,
    uf: address.uf || null,
    cityCode: address.cityCode || null,
    cityName: address.cityName || null,
    managerUserId: input.managerUserId || null,
  };
}

/** Matriz (ordem 0001 do CNPJ ou código 01 sem CNPJ) ou filial. */
export function branchKind(b: { cnpj?: string | null; code?: string | null }): "Matriz" | "Filial" {
  const c = onlyDigits(b.cnpj);
  if (c.length === 14) return c.slice(8, 12) === "0001" ? "Matriz" : "Filial";
  return b.code === "01" ? "Matriz" : "Filial";
}

/** Situação da unidade no ERP: inativa; em implantação (sem configuração fiscal); ativa. */
export function branchSituation(b: { status?: string | null; id: string }, fiscalBranchIds: Set<string>): "active" | "implementation" | "inactive" {
  if (b.status === "inactive") return "inactive";
  return fiscalBranchIds.has(b.id) ? "active" : "implementation";
}

/** Nova filial: cria depósitos (principal e avarias), conta caixa e parâmetros padrão. Idempotente pelo código. */
export async function createBranch(ctx: Ctx, companyId: string, input: BranchInput) {
  const c = await companyAdminCtx(ctx, companyId, "create");
  const company = await c.store.getOrThrow("companies", companyId);
  assert(company.status !== "inactive", "Empresa inativa: reative-a antes de criar filiais.");
  const data = branchData(input);
  const branches = await listAll(c.store, "branches", { filters: [["eq", "companyId", companyId]] });
  if (branches.some((b) => b.code === data.code)) throw new BusinessError(`Já existe filial com o código ${data.code} nesta empresa.`, "duplicate");
  if (data.cnpj && branches.some((b) => b.cnpj === data.cnpj)) throw new BusinessError("Já existe filial com este CNPJ nesta empresa.", "duplicate");
  if (data.managerUserId) {
    const m = await c.store.get("users", data.managerUserId);
    assert(m && (m.isAdmin || (m.companyIds ?? []).includes(companyId)), "Responsável deve ser um usuário com acesso à empresa.");
  }
  const base = { companyId, createdBy: ctx.user.id };
  const branchId = detId("branch", companyId, data.code);
  const whMain = detId("warehouse", branchId, "main");
  const whDamaged = detId("warehouse", branchId, "damaged");
  const tables = await listAll(c.store, "price_tables", { filters: [["eq", "companyId", companyId], ["eq", "active", true]] });
  const priceTableId = input.defaultPriceTableId && tables.some((t) => t.id === input.defaultPriceTableId) ? input.defaultPriceTableId : tables.find((t) => t.isDefault)?.id || tables[0]?.id || null;
  let branch: Doc;
  try {
    // fuso: único da instalação (APP_TIMEZONE) — registrado apenas para referência
    branch = await c.store.create("branches", { ...base, ...data, timezone: DEFAULT_TZ, status: "active", fiscalStatus: "pending", defaultWarehouseId: whMain, defaultPriceTableId: priceTableId, isDemo: Boolean(company.isDemo) }, branchId);
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(`Já existe filial com o código ${data.code}.`, "duplicate");
    throw e;
  }
  const put = async (collection: string, id: string, row: Record<string, any>) => {
    if (await c.store.get(collection, id)) return;
    await c.store.create(collection, row, id).catch((e) => {
      if (!isConflict(e)) throw e;
    });
  };
  await put("warehouses", whMain, { ...base, branchId, code: "PRINC", name: "Depósito principal", kind: "available", isDefault: true, status: "active", isDemo: Boolean(company.isDemo) });
  await put("warehouses", whDamaged, { ...base, branchId, code: "AVARIA", name: "Avarias", kind: "damaged", isDefault: false, status: "active", isDemo: Boolean(company.isDemo) });
  const cashId = detId("account", branchId, "cash");
  await put("financial_accounts", cashId, { ...base, branchId, name: `Caixa — ${data.name}`, kind: "cash", initialBalance: 0, initialBalanceDate: today(), balance: 0, seq: 0, active: true, isDemo: Boolean(company.isDemo) });
  await audit({ ...c, branchId }, {
    module: "admin", action: "branch.create", entityType: "branch", entityId: branchId, summary: `Filial ${data.code} — ${data.name} criada com depósitos (principal e avarias) e conta caixa`,
    after: data, related: [`company:${companyId}`, `warehouse:${whMain}`, `warehouse:${whDamaged}`, `financial_account:${cashId}`],
  });
  return branch;
}

export async function updateBranch(ctx: Ctx, id: string, input: BranchInput) {
  const { ctx: c, branch: before } = await branchAdminCtx(ctx, id, "edit");
  const data = branchData(input);
  const siblings = await listAll(c.store, "branches", { filters: [["eq", "companyId", before.companyId]] });
  if (siblings.some((b) => b.id !== id && b.code === data.code)) throw new BusinessError(`Já existe filial com o código ${data.code}.`, "duplicate");
  if (data.cnpj && siblings.some((b) => b.id !== id && b.cnpj === data.cnpj)) throw new BusinessError("Já existe filial com este CNPJ.", "duplicate");
  if (input.defaultWarehouseId) {
    const wh = await c.store.get("warehouses", input.defaultWarehouseId);
    assert(wh && wh.branchId === id, "O depósito padrão deve pertencer à filial.");
    assert(wh.status !== "inactive", "Depósito padrão inativo.");
  }
  if (input.managerUserId) {
    const m = await c.store.get("users", input.managerUserId);
    assert(m && (m.isAdmin || (m.companyIds ?? []).includes(before.companyId)), "Responsável deve ser um usuário com acesso à empresa.");
  }
  if (input.defaultPriceTableId) {
    const t = await c.store.get("price_tables", input.defaultPriceTableId);
    assert(t && t.companyId === before.companyId, "Tabela de preço inválida.");
  }
  const after = await c.store.update("branches", id, { ...data, defaultWarehouseId: input.defaultWarehouseId || before.defaultWarehouseId, defaultPriceTableId: input.defaultPriceTableId || null });
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit({ ...c, branchId: id }, { module: "admin", action: "branch.update", entityType: "branch", entityId: id, summary: `Filial ${after.name} alterada (documentos anteriores preservam os dados da época)`, before: d.before, after: d.after, related: [`company:${before.companyId}`] });
  }
  return after;
}

/** Filial inativa não pode ser selecionada nem operar (consulta pelo consolidado da empresa). */
export async function setBranchStatus(ctx: Ctx, id: string, status: "active" | "inactive", reason?: string | null) {
  const { ctx: c, branch: b } = await branchAdminCtx(ctx, id, "edit");
  if (status === "inactive") {
    assert(id !== ctx.branchId, "Não é possível inativar a filial em uso. Troque de filial antes.");
    const open = await c.store.list("cash_sessions", { filters: [["eq", "branchId", id], ["eq", "status", ["open", "reopened"]]], limit: 1 });
    assert(open.items.length === 0, "Há caixas abertos nesta filial; feche-os antes de inativar.");
    const active = await listAll(c.store, "branches", { filters: [["eq", "companyId", b.companyId], ["eq", "status", "active"]] });
    assert(active.filter((x) => x.id !== id).length > 0, "A empresa precisa ter ao menos uma filial ativa.");
  }
  const after = await c.store.update("branches", id, { status });
  await audit({ ...c, branchId: id }, { module: "admin", action: `branch.${status}`, entityType: "branch", entityId: id, summary: `Filial ${b.name} ${status === "inactive" ? "inativada (não pode mais ser selecionada nem operar)" : "reativada"}`, reason: reason ?? null, related: [`company:${b.companyId}`] });
  return after;
}

/**
 * Vincula/desvincula usuários a uma empresa (as filiais da empresa saem do usuário desvinculado).
 * Duas fases: valida TODOS os usuários antes de gravar qualquer vínculo; depois grava (em blocos transacionais) e audita.
 * Quem não é administrador só altera usuários que enxerga (com alguma empresa em comum) e nunca o próprio vínculo.
 */
export async function setCompanyUsers(ctx: Ctx, companyId: string, userIds: string[]): Promise<{ changes: string[]; noRole: string[] }> {
  const c = await companyAdminCtx(ctx, companyId, "edit");
  requireAction(c, "admin.users");
  const company = await c.store.getOrThrow("companies", companyId);
  const mine = new Set(ctx.user.companyIds ?? []);
  const users = (await listAll(c.store, "users")).filter((u) => !u.isAdmin && (ctx.user.isAdmin || (u.id !== ctx.user.id && (u.companyIds ?? []).some((x: string) => mine.has(x)))));
  const branchIds = new Set((await listAll(c.store, "branches", { filters: [["eq", "companyId", companyId]] })).map((b) => b.id));
  const wanted = new Set(userIds);
  // fase 1: plano + validação (nenhuma escrita)
  const plan: Array<{ user: Doc; patch: Record<string, any>; change: string }> = [];
  const blocked: string[] = [];
  const noRole: string[] = [];
  for (const u of users) {
    const has = (u.companyIds ?? []).includes(companyId);
    if (wanted.has(u.id) && !has) {
      const role = await userRoleIn(c.store, u, companyId);
      if (!role) noRole.push(u.name);
      const roleByCompany = { ...(u.roleByCompany ?? {}), ...(role ? { [companyId]: role.id } : {}) };
      plan.push({ user: u, patch: { companyIds: [...(u.companyIds ?? []), companyId], roleByCompany }, change: `+${u.name}` });
    } else if (!wanted.has(u.id) && has) {
      if ((u.companyIds ?? []).length <= 1 && u.status === "active") {
        blocked.push(u.name);
        continue;
      }
      const roleByCompany = { ...(u.roleByCompany ?? {}) };
      delete roleByCompany[companyId];
      plan.push({ user: u, patch: { companyIds: (u.companyIds ?? []).filter((x: string) => x !== companyId), branchIds: (u.branchIds ?? []).filter((b: string) => !branchIds.has(b)), roleByCompany }, change: `−${u.name}` });
    }
  }
  if (blocked.length) {
    throw new BusinessError(`${blocked.join(", ")} ficaria(m) sem empresa vinculada; inative o usuário em vez de desvincular. Nenhum vínculo foi alterado.`, "last_company");
  }
  // fase 2: gravação em blocos (limite de 100 operações por transação) e auditoria
  const changes: string[] = [];
  try {
    for (let i = 0; i < plan.length; i += 100) {
      const chunk = plan.slice(i, i + 100);
      await c.store.transaction(async (tx) => {
        for (const p of chunk) await tx.update("users", p.user.id, p.patch);
      });
      changes.push(...chunk.map((p) => p.change));
    }
  } catch (e) {
    if (changes.length) await audit(c, { module: "admin", action: "company.users", entityType: "company", entityId: companyId, summary: `Vínculos de usuários alterados parcialmente (falha no meio): ${changes.join(", ")}`, result: "failure", related: plan.filter((p) => changes.includes(p.change)).map((p) => `user:${p.user.id}`) });
    throw e;
  }
  if (changes.length) {
    await audit(c, {
      module: "admin", action: "company.users", entityType: "company", entityId: companyId,
      summary: `Vínculos de usuários com ${company.tradeName || company.name} alterados: ${changes.join(", ")}${noRole.length ? ` (sem perfil equivalente nesta empresa: ${noRole.join(", ")} — defina o perfil no cadastro do usuário)` : ""}`,
      related: plan.map((p) => `user:${p.user.id}`),
    });
  }
  // vinculados sem perfil equivalente nesta empresa: sem permissão nela até o perfil ser definido (avisado na tela)
  return { changes, noRole };
}

/** Resumo de uma filial (usuários, terminais, depósitos, caixas abertos). */
export async function branchSummary(store: Store, branch: Doc) {
  const [warehouses, terminals, sessions, users] = await Promise.all([
    listAll(store, "warehouses", { filters: [["eq", "branchId", branch.id]] }),
    listAll(store, "terminals", { filters: [["eq", "branchId", branch.id]] }),
    listAll(store, "cash_sessions", { filters: [["eq", "branchId", branch.id], ["eq", "status", ["open", "reopened"]]] }),
    listAll(store, "users"),
  ]);
  const linked = users.filter((u) => u.isAdmin || ((u.companyIds ?? []).includes(branch.companyId) && (!(u.branchIds ?? []).length || u.branchIds.includes(branch.id))));
  return { warehouses, terminals, openSessions: sessions, users: linked };
}
