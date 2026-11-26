import crypto from "node:crypto";
import { detId, findOne, isConflict, listAll, sha256 } from "@/lib/db";
import { NotFoundError, type Doc, type Store } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { sendEmail } from "@/lib/core/email";
import { getSetting } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";
import { DEFAULT_TZ, nowIso } from "@/lib/dates";
import { getAuth } from "@/lib/auth/provider";
import { branchScopeOf, findUserByLogin, toCtxUser, userRoleIn } from "@/lib/auth/users";
import { resolveOccurrence } from "@/lib/core/notify";
import { can, canDo } from "@/lib/permissions";
import { ADMIN_ACCESS_HINT, LAST_COMPANY_ADMIN, assertAssignable, auditedGuard, companyAdmins } from "./roles";
import { QUICK_ACCESS_LOCKED, isQuickAccessUser, quickAccessLockedMessage } from "@/lib/auth/quick-access";

/**
 * Usuários (Tela 36): cadastro, acesso direto ou convite, situação (ativo/inativo/suspenso),
 * perfil, empresas/filiais vinculadas e limite de desconto individual.
 *
 * Regras:
 *  - convite: token aleatório (somente o hash é gravado) com validade; link /convite/<token>;
 *    envio pelo canal de e-mail configurado com resultado real; sem canal, o link é exibido ao administrador;
 *  - suspensão/inativação bloqueia o login e encerra as sessões abertas;
 *  - nunca deixar a instalação sem administrador ativo (último administrador protegido, também sob concorrência:
 *    a gravação é conferida depois de feita e desfeita se deixar o sistema sem administrador);
 *  - alcance do gestor: só gerencia usuários vinculados à empresa em uso; quem não é administrador não gerencia
 *    administradores, não concede administrador, só vincula às empresas em que também administra usuários e não altera
 *    o próprio vínculo/perfil; vínculos do usuário com empresas fora do alcance do gestor são preservados;
 *  - restrição de filiais (`branchIds`) é uma lista única para todas as empresas do usuário (vazia = todas): quem não
 *    administra usuários em todas as empresas do alvo não inclui restrição em quem não tem nem remove a de quem tem
 *    (a restrição nas empresas fora do alcance fica idêntica); com restrição, empresa do alcance sem filial marcada
 *    recebe todas as filiais dela;
 *  - perfil por empresa: o perfil escolhido vale na empresa em uso (`roleByCompany`); os perfis nas demais empresas
 *    do usuário não mudam.
 *
 * Multiempresa — a empresa contratante administra os próprios usuários (docs/multiempresa/administracao.md):
 *  - filiais POR EMPRESA (`companyBranchIds` → `branchIdsByCompany[empresa]`, [] = todas) e cargo por empresa
 *    (`jobTitle` → `jobTitleByCompany[empresa]`), ambos da empresa em uso; quem acessa só algumas filiais só concede
 *    filiais dentre as dele (nunca “todas”);
 *  - perfil só dentro do próprio escopo: quem não é o administrador da plataforma só atribui perfil cujo acesso ele
 *    mesmo tem (`assertAssignable`) e não troca o perfil de quem já tem acesso acima do dele;
 *  - último administrador POR EMPRESA (`last_company_admin`): suspender, inativar, desvincular, trocar o perfil ou
 *    tornar administrador da plataforma não pode deixar a empresa sem usuário ativo que administre usuários nela (o
 *    administrador da plataforma não conta); conferido de novo depois de gravar (concorrência);
 *  - encerrar sessões (administrador: todas as do usuário; o próprio usuário: as outras) e recuperação de senha iniciada
 *    pelo administrador (link de uso único com validade; ao concluir, as sessões anteriores deixam de valer);
 *  - privacidade: unicidade de e-mail e login conferida na instalação inteira, sem revelar quem é o titular quando ele
 *    não é desta empresa; o administrador da plataforma não aparece em listas para quem não é da plataforma.
 */

export type UserStatus = "active" | "invited" | "inactive" | "suspended";

export interface UserInput {
  name: string;
  email: string;
  login?: string | null;
  phone?: string | null;
  roleId?: string | null;
  isAdmin?: boolean;
  companyIds: string[];
  branchIds: string[];
  /** null = herda o limite do perfil */
  discountLimitBps?: number | null;
  /** multiempresa: cargo NA empresa em uso (`jobTitleByCompany`), separado do perfil e das filiais. Ausente = não altera. */
  jobTitle?: string | null;
  /**
   * Departamento e função NA empresa em uso (`departmentByCompany`, `jobFunctionByCompany`). Com o cargo, aplicam o perfil
   * pela regra da empresa quando nenhum perfil é escolhido (`access.attributeRoles`). Ausente = não altera.
   */
  department?: string | null;
  jobFunction?: string | null;
  /**
   * multiempresa: filiais autorizadas NA empresa em uso (`branchIdsByCompany[empresa]`): [] = todas; lista = só essas.
   * Ausente = modo legado (`branchIds`, uma lista para todas as empresas do usuário), preservado para compatibilidade.
   */
  companyBranchIds?: string[];
}

export type UserAttribute = "jobTitle" | "department" | "jobFunction";
/** Campo por empresa de cada atributo organizacional (nunca global: a mesma pessoa pode estar em empresas de clientes diferentes). */
export const ATTRIBUTE_FIELDS: Record<UserAttribute, string> = { jobTitle: "jobTitleByCompany", department: "departmentByCompany", jobFunction: "jobFunctionByCompany" };
export interface AttributeRoleRule {
  attribute: UserAttribute;
  value: string;
  roleId: string;
}
export const ATTRIBUTE_ROLES_KEY = "access.attributeRoles";

/** Atributos organizacionais da pessoa NA empresa. */
export function attributesIn(u: Doc | Record<string, any>, companyId: string): Record<UserAttribute, string | null> {
  const get = (f: string) => (((u as any)[f] ?? {})[companyId] as string | undefined) ?? null;
  return { jobTitle: get("jobTitleByCompany"), department: get("departmentByCompany"), jobFunction: get("jobFunctionByCompany") };
}

/**
 * Perfil pelo cargo, departamento ou função (decisão do titular, 26/11/2026): a regra da empresa aponta um perfil;
 * o perfil continua sendo o ÚNICO contêiner de permissões. Primeira regra que casar (comparação sem caixa/acento).
 */
export function roleFromAttributes(rules: AttributeRoleRule[], attrs: Partial<Record<UserAttribute, string | null | undefined>>): string | null {
  const norm = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  for (const r of rules) if (norm(attrs[r.attribute]) && norm(attrs[r.attribute]) === norm(r.value)) return r.roleId;
  return null;
}

export const DEFAULT_INVITE_DAYS = 7;
/** Validade do link de recuperação de senha iniciada pelo administrador (horas). */
export const ADMIN_RECOVERY_HOURS = 24;
/** Tamanho máximo do cargo. */
export const JOB_TITLE_MAX = 80;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function guard(ctx: Ctx, op: "create" | "edit", summary: string, entityId?: string | null) {
  await auditedGuard(
    ctx,
    () => {
      requirePerm(ctx, "admin", op);
      requireAction(ctx, "admin.users");
    },
    { action: `user.${op}`, entityType: "user", entityId, summary },
  );
}

export function inviteState(u: { status?: string | null; inviteExpiresAt?: string | null } & Record<string, any>): "pending" | "expired" | null {
  if (u.status !== "invited") return null;
  return u.inviteExpiresAt && u.inviteExpiresAt < nowIso() ? "expired" : "pending";
}

/** Vendedor cadastrado sem acesso ao sistema (CAD-05): gerido em Vendas › Vendedores, fora da tela de usuários. */
export const isSellerOnly = (u: Record<string, any> | null | undefined) => Boolean(u?.loginDisabled);

function assertNotSellerOnly(u: Doc) {
  if (isSellerOnly(u)) throw new BusinessError(`${u.name} é vendedor sem acesso ao sistema: o cadastro é feito em Vendas › Vendedores.`, "seller_only");
}

/**
 * Usuários com acesso à empresa (administradores enxergam todas). Com `{ platformAdmins: false }`: só os vinculados à
 * empresa e sem o administrador da plataforma — o que uma empresa contratante enxerga (`listedCompanyUsers`).
 */
export async function companyUsers(store: Store, companyId: string, opts: { platformAdmins?: boolean } = {}) {
  const all = await listAll(store, "users");
  const admins = opts.platformAdmins ?? true;
  return all.filter((u) => (u.isAdmin ? admins : (u.companyIds ?? []).includes(companyId)));
}

/**
 * Quem enxerga a equipe da plataforma (administrador da plataforma, `isAdmin`) em listas e seletores: o próprio
 * administrador da plataforma e quem trabalha na empresa da plataforma. Para a empresa contratante ele não aparece.
 */
export async function seesPlatformAdmins(ctx: Pick<Ctx, "user" | "store" | "companyId">): Promise<boolean> {
  if (ctx.user.isAdmin) return true;
  if (!ctx.companyId) return false;
  return Boolean((await unscoped(ctx.store).get("companies", ctx.companyId))?.isPlatform);
}

/** Usuários que a tela da empresa lista: só os vinculados a ela; o administrador da plataforma só para a plataforma. */
export async function listedCompanyUsers(ctx: Ctx) {
  return companyUsers(ctx.store, ctx.companyId, { platformAdmins: await seesPlatformAdmins(ctx) });
}

/** O usuário aparece para quem está na empresa em uso? (vinculado; o administrador da plataforma, só para a plataforma) */
async function visibleInCompany(ctx: Ctx, u: Record<string, any>): Promise<boolean> {
  if (u.isAdmin) return seesPlatformAdmins(ctx);
  return (u.companyIds ?? []).includes(ctx.companyId);
}

/** Administradores ativos (acesso total) — usados na proteção do último administrador. */
export async function activeAdmins(store: Store) {
  return listAll(store, "users", { filters: [["eq", "isAdmin", true], ["eq", "status", "active"]] });
}

async function assertNotLastAdmin(store: Store, user: Doc, what: string) {
  if (!user.isAdmin || user.status !== "active") return;
  const admins = await activeAdmins(store);
  if (admins.filter((a) => a.id !== user.id).length === 0) throw lastAdminError(user, what);
}

function lastAdminError(user: Doc, what: string) {
  return new BusinessError(`Operação bloqueada: ${user.name} é o último administrador ativo. ${what} deixaria o sistema sem administrador. Conceda acesso de administrador a outro usuário antes.`, "last_admin");
}

function lastCompanyAdminError(userName: string, companyName: string, what: string) {
  return new BusinessError(
    `Operação bloqueada: ${userName} é o último administrador ativo de ${companyName}. ${what} deixaria a empresa sem ninguém para administrar os usuários dela. Antes, dê a outro usuário ativo desta empresa ${ADMIN_ACCESS_HINT}.`,
    LAST_COMPANY_ADMIN,
  );
}

/**
 * Último administrador POR EMPRESA: empresas em que o usuário deixa de administrar usuários com a operação (`after` é o
 * cadastro como ficaria). Recusa (`last_company_admin`) se alguma delas — que tinha administrador próprio — ficaria sem
 * nenhum; devolve as demais para a conferência depois de gravar (`firstCompanyWithoutAdmin`).
 */
async function companyAdminLoss(ctx: Ctx, before: Doc, after: Record<string, any>, what: (companyId: string) => string): Promise<string[]> {
  const lost: string[] = [];
  for (const c of new Set<string>(before.companyIds ?? [])) {
    const admins = await companyAdmins(ctx.store, c);
    if (!admins.some((a) => a.id === before.id)) continue; // não administra esta empresa: nada a proteger
    const remaining = await companyAdmins(ctx.store, c, { users: [after] });
    if (remaining.some((a) => a.id === before.id)) continue; // continua administrador dela
    if (!remaining.length) throw lastCompanyAdminError(before.name, (await companyNames(ctx, [c]))[0], what(c));
    lost.push(c);
  }
  return lost;
}

/** Conferência depois de gravar (duas alterações simultâneas): a primeira empresa que ficou sem administrador. */
async function firstCompanyWithoutAdmin(store: Store, companyIds: string[]): Promise<string | null> {
  for (const c of companyIds) if ((await companyAdmins(store, c)).length === 0) return c;
  return null;
}

/**
 * Para quem desvincula usuários de uma empresa por outro caminho (Empresas › Usuários — `setCompanyUsers`): recusa com
 * `last_company_admin` se a empresa, que tinha administrador próprio, ficaria sem nenhum ao tirar `removedUserIds`.
 */
export async function assertCompanyKeepsAdmin(ctx: Ctx, companyId: string, removedUserIds: string[]) {
  const admins = await companyAdmins(ctx.store, companyId);
  const gone = new Set(removedUserIds);
  if (!admins.length || admins.some((a) => !gone.has(a.id))) return;
  const names = admins.map((a) => a.name as string);
  const who = names.length === 1 ? `${names[0]} é o último administrador ativo` : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]} são os últimos administradores ativos`;
  throw new BusinessError(
    `Operação bloqueada: ${who} de ${(await companyNames(ctx, [companyId]))[0]}. Desvincular deixaria a empresa sem ninguém para administrar os usuários dela. Antes, dê a outro usuário ativo desta empresa ${ADMIN_ACCESS_HINT}.`,
    LAST_COMPANY_ADMIN,
  );
}

/**
 * Usuário-alvo de uma ação administrativa. Precisa estar vinculado à empresa em uso (administradores globais aparecem
 * em todas); quem não é administrador não gerencia o cadastro, a senha nem a situação de um administrador.
 */
async function loadManagedUser(ctx: Ctx, id: string): Promise<Doc> {
  const u = await ctx.store.get("users", id);
  if (!u || !(u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId))) throw new NotFoundError("users", id);
  if (u.isAdmin && !ctx.user.isAdmin) throw new PermissionError("Somente administradores podem gerenciar o cadastro, a senha ou a situação de outro administrador.");
  assertNotSellerOnly(u);
  return u;
}

/**
 * Empresas (dentre as informadas) em que o editor administra usuários: acesso à empresa + perfil daquela empresa com
 * admin/editar e "admin.users" (na empresa em uso, a guarda da operação já conferiu). Administradores: todas.
 */
export async function manageableCompanyIds(ctx: Ctx, companyIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (ctx.user.isAdmin) return new Set(ids);
  const out = new Set<string>();
  const me = ctx.user.id !== "system" ? await unscoped(ctx.store).get("users", ctx.user.id) : null;
  for (const c of ids) {
    if (!(ctx.user.companyIds ?? []).includes(c)) continue;
    if (c === ctx.companyId) {
      out.add(c);
      continue;
    }
    const u = me ? await toCtxUser(ctx.store, me, c) : null;
    if (u && can(u, "admin", "edit") && canDo(u, "admin.users")) out.add(c);
  }
  return out;
}

/**
 * O gestor só altera vínculos (inclusão ou remoção) de empresas em que ele mesmo administra usuários
 * (acesso à empresa + perfil daquela empresa com admin/editar e "admin.users"). Administradores: todas.
 */
async function assertCanManageCompanies(ctx: Ctx, companyIds: string[]) {
  if (ctx.user.isAdmin) return;
  const ok = await manageableCompanyIds(ctx, companyIds);
  for (const c of new Set(companyIds)) {
    if (!(ctx.user.companyIds ?? []).includes(c)) throw new PermissionError("Empresa fora do seu acesso: você só pode vincular usuários às empresas a que tem acesso.");
    if (!ok.has(c)) throw new PermissionError("Seu perfil na outra empresa não permite gerenciar usuários: o vínculo com ela não pode ser alterado por você.");
  }
}

/**
 * Nomes (fantasia ou razão social) das empresas, para mensagens. Multiempresa: empresa a que o editor não tem acesso não
 * é nomeada ("outra empresa do ERP") — a mensagem não revela as demais contratantes.
 */
async function companyNames(ctx: Ctx, ids: string[]) {
  const mine = new Set(ctx.user.companyIds ?? []);
  return (await Promise.all(ids.map((c) => unscoped(ctx.store).get("companies", c)))).map((c, i) => {
    if (!ctx.user.isAdmin && !mine.has(ids[i]) && ids[i] !== ctx.companyId) return "outra empresa do ERP";
    return c ? c.tradeName || c.name : ids[i];
  });
}

/**
 * Senha, situação, convite, e-mail/login e limite de desconto valem em TODAS as empresas do usuário: quem não é
 * administrador só os altera se administra usuários em todas as empresas vinculadas ao alvo.
 */
async function assertManagesWholeUser(ctx: Ctx, u: Doc, what: string) {
  if (ctx.user.isAdmin) return;
  const companies = [...new Set<string>(u.companyIds ?? [])];
  const ok = await manageableCompanyIds(ctx, companies);
  const outside = companies.filter((c) => !ok.has(c));
  if (!outside.length) return;
  const names = await companyNames(ctx, outside);
  throw new PermissionError(
    `${what}: ${u.name} também tem acesso a ${outside.length === 1 ? "uma empresa" : `${outside.length} empresas`} em que você não administra usuários (${names.join(", ")}). Peça a um administrador ou a quem administra usuários em todas as empresas dele.`,
  );
}

/**
 * Assumir a conta de alguém (definir a senha, iniciar a recuperação — o link pode voltar ao editor —, trocar e-mail ou
 * login, redefinir as duas etapas) só sobre quem NÃO tem acesso acima do editor: em cada empresa do alvo, o perfil dele
 * precisa caber no acesso do editor naquela empresa. Sem isso, quem administra usuários com menos acesso definiria a
 * senha de alguém com mais acesso e entraria como essa pessoa. O administrador da plataforma não tem esse limite.
 */
async function assertCanTakeOver(ctx: Ctx, u: Doc, what: string) {
  if (ctx.user.isAdmin || u.id === ctx.user.id) return;
  for (const c of new Set<string>(u.companyIds ?? [])) {
    const role = await userRoleIn(ctx.store, u, c);
    if (!role) continue;
    const where = c === ctx.companyId ? "nesta empresa" : `em ${(await companyNames(ctx, [c]))[0]}`;
    await assertAssignable(
      await editorCtxIn(ctx, c),
      role,
      (detail) => `${what}: ${u.name} tem acessos que você não tem ${where} (perfil “${role.name}”). Só quem tem esses acessos faz isso por essa pessoa. ${detail}`,
    );
  }
}

/** Mapa empresa → perfil explícito com o perfil efetivo atual de cada empresa (congela o que hoje vem do perfil legado). */
async function materializeRoles(store: Store, u: Record<string, any>, companyIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of companyIds) {
    const r = await userRoleIn(store, u, c);
    if (r) out[c] = r.id;
  }
  return out;
}

async function validateInput(ctx: Ctx, input: UserInput, selfId?: string, opts: { legacyBranches?: boolean } = {}) {
  assert(input.name?.trim(), "Informe o nome.");
  const email = input.email?.trim().toLowerCase();
  assert(email && EMAIL_RE.test(email), "Informe um e-mail válido.");
  const login = input.login?.trim().toLowerCase() || null;
  if (login) assert(/^[a-z0-9._-]{3,40}$/.test(login), "Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).");
  if (input.isAdmin && !ctx.user.isAdmin) throw new BusinessError("Somente administradores podem conceder acesso de administrador.", "forbidden");
  // unicidade na instalação INTEIRA (o Store da empresa só enxerga os vinculados a ela); o nome do titular só aparece
  // quando ele é desta empresa — de outra empresa (ou o administrador da plataforma), a mensagem não revela quem é
  const everyone = unscoped(ctx.store);
  const dupEmail = await findOne(everyone, "users", [["eq", "email", email]]);
  if (dupEmail && dupEmail.id !== selfId) {
    throw new BusinessError((await visibleInCompany(ctx, dupEmail)) ? `E-mail já usado pelo usuário ${dupEmail.name}.` : "E-mail já cadastrado no ERP. Informe outro e-mail.", "duplicate");
  }
  if (login) {
    const dupLogin = await findOne(everyone, "users", [["eq", "login", login]]);
    if (dupLogin && dupLogin.id !== selfId) throw new BusinessError((await visibleInCompany(ctx, dupLogin)) ? `Login já usado pelo usuário ${dupLogin.name}.` : "Login indisponível. Escolha outro login.", "duplicate");
  }
  const companyIds = [...new Set(input.companyIds.filter(Boolean))];
  assert(input.isAdmin || companyIds.length > 0, "Vincule o usuário a pelo menos uma empresa.");
  // o perfil escolhido é da empresa em uso: o usuário precisa estar vinculado a ela
  assert(input.isAdmin || companyIds.includes(ctx.companyId), "O usuário precisa continuar vinculado à empresa em uso (o perfil escolhido vale nela). Para remover o vínculo com esta empresa, use Empresas → Usuários a partir de outra empresa ou inative o usuário.");
  // leitura de cadastro (empresas/filiais de qualquer empresa) para validar os vínculos
  const base = unscoped(ctx.store);
  const companies = await listAll(base, "companies");
  for (const c of companyIds) assert(companies.some((x) => x.id === c), "Empresa inválida.");
  const branches = await listAll(base, "branches");
  const branchIds = [...new Set(input.branchIds.filter(Boolean))];
  // modo por empresa: a lista legada é preservada como estava (não vem do formulário) e não é revalidada
  if (opts.legacyBranches !== false) {
    for (const b of branchIds) {
      const br = branches.find((x) => x.id === b);
      assert(br, "Filial inválida.");
      assert(input.isAdmin || companyIds.includes(br.companyId), `A filial ${br.name} não pertence às empresas vinculadas.`);
    }
  }
  // atributos da pessoa NESTA empresa (o que não veio no formulário fica como está no cadastro)
  const current = selfId ? attributesIn((await base.get("users", selfId)) ?? {}, ctx.companyId) : { jobTitle: null, department: null, jobFunction: null };
  const pick = (k: UserAttribute) => (input[k] === undefined ? current[k] : input[k]?.trim() || null);
  const attrs = { jobTitle: pick("jobTitle"), department: pick("department"), jobFunction: pick("jobFunction") };
  if (!input.roleId && !input.isAdmin) {
    const rules = await getSetting<AttributeRoleRule[]>(ctx.store, ctx.companyId, null, ATTRIBUTE_ROLES_KEY, []);
    input = { ...input, roleId: roleFromAttributes(Array.isArray(rules) ? rules : [], attrs) };
  }
  if (input.roleId) {
    const role = await base.get("roles", input.roleId);
    assert(role, "Perfil inválido.");
    assert(role.companyId === ctx.companyId, "Perfil de outra empresa: escolha um perfil da empresa em uso.");
    assert(role.active !== false, "Perfil inativo.");
  } else {
    assert(input.isAdmin, "Selecione o perfil de acesso (ou informe cargo, departamento ou função com regra de perfil em Parâmetros).");
  }
  if (input.discountLimitBps != null) assert(Number.isInteger(input.discountLimitBps) && input.discountLimitBps >= 0 && input.discountLimitBps <= 10000, "Limite de desconto deve estar entre 0% e 100%.");
  return {
    name: input.name.trim(),
    email,
    login,
    phone: onlyDigits(input.phone) || null,
    roleId: input.roleId || null,
    isAdmin: Boolean(input.isAdmin),
    companyIds,
    branchIds,
    discountLimitBps: input.discountLimitBps ?? null,
  };
}

const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** Campos por empresa do cadastro (cargo e filiais da empresa em uso), validados. */
async function validateCompanyFields(ctx: Ctx, input: UserInput) {
  const attr = (v: string | null | undefined, label: string) => {
    if (v === undefined) return undefined;
    const t = v?.trim() || null;
    if (t) assert(t.length <= JOB_TITLE_MAX, `${label} deve ter até ${JOB_TITLE_MAX} caracteres.`);
    return t;
  };
  const jobTitle = attr(input.jobTitle, "O cargo");
  const department = attr(input.department, "O departamento");
  const jobFunction = attr(input.jobFunction, "A função");
  const branchesHere = await listAll(unscoped(ctx.store), "branches", { filters: [["eq", "companyId", ctx.companyId]] });
  const here = new Set(branchesHere.map((b) => b.id));
  let companyBranchIds: string[] | undefined;
  if (Array.isArray(input.companyBranchIds)) {
    companyBranchIds = [...new Set(input.companyBranchIds.filter(Boolean))];
    // nunca nomeia a filial recusada: pode ser de outra empresa
    for (const b of companyBranchIds) assert(here.has(b), "Filial inválida: o cadastro só atribui filiais da empresa em uso.");
  }
  return { jobTitle, department, jobFunction, companyBranchIds, here, branchNames: new Map(branchesHere.map((b) => [b.id, b.name as string])) };
}

/** Filiais autorizadas do usuário NA empresa, só as da própria empresa (null = todas). */
function scopeIn(u: Record<string, any>, companyId: string, here: Set<string>): string[] | null {
  const s = branchScopeOf(u, companyId);
  return s === null ? null : s.filter((b) => here.has(b));
}

const sameScope = (a: string[] | null, b: string[] | null) => (a === null || b === null ? a === b : sameSet(a, b));

/** Filiais do editor na empresa em uso: null = todas (administrador da plataforma ou sem restrição). */
function editorBranches(ctx: Ctx): Set<string> | null {
  return ctx.user.isAdmin || !(ctx.user.branchIds ?? []).length ? null : new Set(ctx.user.branchIds);
}

/**
 * Quem acessa só algumas filiais da empresa em uso só concede filiais dentre as dele: não libera “todas as filiais” para
 * outra pessoa nem restringe quem já tem todas (mexeria em filiais fora do alcance dele). `before` = "new" na criação.
 */
function assertBranchGrant(ctx: Ctx, target: string, before: string[] | null | "new", after: string[] | null, names: Map<string, string>) {
  const mine = editorBranches(ctx);
  if (!mine) return;
  if (before !== "new" && sameScope(before, after)) return;
  if (after === null)
    throw new PermissionError(`Você acessa só algumas filiais desta empresa: não pode liberar todas as filiais para ${target}. Marque as filiais (dentre as suas) que ${target} vai acessar.`);
  if (before === null) throw new PermissionError(`${target} acessa todas as filiais desta empresa, inclusive as que você não acessa: só quem acessa todas as filiais pode restringir esse acesso.`);
  const had = new Set(before === "new" ? [] : before);
  const outside = after.filter((b) => !had.has(b) && !mine.has(b));
  if (outside.length) throw new PermissionError(`Filial fora do seu acesso: ${outside.map((b) => names.get(b) ?? "filial").join(", ")}. Você só concede filiais a que você mesmo tem acesso.`);
}

/** Filiais do editor em outra empresa (vínculo novo recebe no máximo o que o editor acessa lá). null = todas. */
async function editorBranchScopeIn(ctx: Ctx, companyId: string): Promise<string[] | null> {
  if (ctx.user.isAdmin) return null;
  if (companyId === ctx.companyId) return ctx.user.branchIds?.length ? ctx.user.branchIds : null;
  const me = ctx.user.id !== "system" ? await unscoped(ctx.store).get("users", ctx.user.id) : null;
  return me ? branchScopeOf(me, companyId) : null;
}

/** Contexto do editor em outra empresa vinculada (perfil DAQUELA empresa), para conferir o que ele concede lá. */
async function editorCtxIn(ctx: Ctx, companyId: string): Promise<Ctx> {
  if (companyId === ctx.companyId) return ctx;
  const me = ctx.user.id !== "system" ? await unscoped(ctx.store).get("users", ctx.user.id) : null;
  if (!me) throw new PermissionError("Você não tem acesso a esta empresa.");
  return { ...ctx, companyId, branchId: null, store: scopeStore(unscoped(ctx.store), companyId), user: await toCtxUser(ctx.store, me, companyId) };
}

/**
 * Perfil só dentro do próprio escopo: em cada empresa informada, o perfil atribuído não pode ir além do acesso do editor
 * naquela empresa (`assertAssignable`). O administrador da plataforma não tem esse limite.
 */
async function assertRolesAssignable(ctx: Ctx, roleByCompany: Record<string, string>, companies: string[], userName: string) {
  if (ctx.user.isAdmin) return;
  for (const c of new Set(companies)) {
    const rid = roleByCompany[c];
    const role = rid ? await unscoped(ctx.store).get("roles", rid) : null;
    if (!role) continue;
    const where = c === ctx.companyId ? "nesta empresa" : `em ${(await companyNames(ctx, [c]))[0]}`;
    await assertAssignable(await editorCtxIn(ctx, c), role, (detail) => `Você só pode atribuir perfis com acessos que você mesmo tem ${where}: o perfil “${role.name}” (para ${userName}) vai além do seu. ${detail}`);
  }
}

/** Quem já tem acesso acima do editor (perfil atual nesta empresa) não tem o perfil trocado por ele. */
async function assertNotAboveEditor(ctx: Ctx, target: Doc, currentRole: Doc | null) {
  if (ctx.user.isAdmin || !currentRole) return;
  await assertAssignable(
    ctx,
    currentRole,
    (detail) => `Trocar o perfil de ${target.name}: o perfil atual (“${currentRole.name}”) tem acessos que você não tem nesta empresa, e só quem tem esses acessos troca o perfil desta pessoa. ${detail}`,
  );
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function sendInvite(ctx: Ctx, user: Doc, token: string, origin: string, expiresAt: string) {
  const link = `${origin.replace(/\/$/, "")}/convite/${token}`;
  const company = await ctx.store.get("companies", ctx.companyId);
  const companyName = company?.tradeName || company?.name || "Intercert ERP";
  const sent = await sendEmail(ctx.companyId, {
    to: user.email,
    subject: `Convite de acesso — ${companyName}`,
    html: `<p>Olá, ${user.name}.</p><p>${ctx.user.name} convidou você para acessar o ERP de <b>${companyName}</b>.</p><p>Para definir sua senha e ativar o acesso, abra: <a href="${link}">${link}</a></p><p>O convite expira em ${new Date(expiresAt).toLocaleString("pt-BR", { timeZone: DEFAULT_TZ })}.</p>`,
  });
  const delivery = sent.delivered ? `Entregue ao provedor (${sent.channel}) em ${nowIso()}` : `Não enviado: ${sent.message ?? sent.channel}`;
  return { link, delivered: sent.delivered, channel: sent.channel, message: sent.message ?? null, delivery };
}

export interface InviteResult {
  link: string;
  delivered: boolean;
  channel: string;
  message: string | null;
  expiresAt: string;
}

/** Cria o usuário com senha inicial (acesso direto) ou convite com token e validade. */
export async function createUser(
  ctx: Ctx,
  input: UserInput & { mode: "password" | "invite"; password?: string; origin?: string; idemKey?: string },
): Promise<{ user: Doc; invite?: InviteResult }> {
  await guard(ctx, "create", `criar usuário ${input.email}`);
  const id = input.idemKey ? detId("user", input.idemKey) : undefined;
  if (id) {
    const prev = await ctx.store.get("users", id);
    if (prev) return { user: prev };
  }
  // filiais por empresa (formulário): a lista legada nasce vazia e a atribuição vale por empresa
  const perCompany = Array.isArray(input.companyBranchIds);
  if (perCompany) input = { ...input, branchIds: [] };
  const data = await validateInput(ctx, input, undefined, { legacyBranches: !perCompany });
  const extra = await validateCompanyFields(ctx, input);
  await assertCanManageCompanies(ctx, data.companyIds);
  // limite contratado de usuários (licença do Interos): só barra o NOVO usuário; administradores da plataforma não contam
  if (!data.isAdmin) {
    const { assertWithinLimit } = await import("./licensing/limits");
    for (const cid of data.companyIds ?? []) await assertWithinLimit(unscoped(ctx.store), cid, "users");
  }
  // perfil por empresa: o escolhido vale na empresa em uso; nas demais vinculadas, o perfil de sistema equivalente
  const roleByCompany = data.isAdmin || !data.roleId ? {} : { ...(await materializeRoles(ctx.store, { roleId: data.roleId }, data.companyIds)), [ctx.companyId]: data.roleId };
  // multiempresa: perfil só dentro do próprio escopo (em cada empresa vinculada)
  if (!data.isAdmin) await assertRolesAssignable(ctx, roleByCompany, data.companyIds, data.name);
  // cargo e filiais por empresa; quem acessa só algumas filiais só concede filiais dentre as dele
  const companyFields: Record<string, any> = {};
  for (const k of ["jobTitle", "department", "jobFunction"] as const) if (extra[k]) companyFields[ATTRIBUTE_FIELDS[k]] = { [ctx.companyId]: extra[k] };
  if (perCompany && !data.isAdmin) {
    const map: Record<string, string[]> = { [ctx.companyId]: extra.companyBranchIds! };
    for (const c of data.companyIds) if (c !== ctx.companyId) map[c] = (await editorBranchScopeIn(ctx, c)) ?? [];
    companyFields.branchIdsByCompany = map;
  }
  if (!data.isAdmin) assertBranchGrant(ctx, data.name, "new", scopeIn({ ...data, ...companyFields }, ctx.companyId, extra.here), extra.branchNames);
  if (input.mode === "password") {
    assert((input.password ?? "").length >= 8, "A senha inicial deve ter ao menos 8 caracteres.");
    let user: Doc;
    try {
      user = await ctx.store.create("users", { ...data, ...companyFields, roleByCompany, status: "active", createdBy: ctx.user.id }, id);
    } catch (e) {
      if (isConflict(e)) throw new BusinessError("E-mail já cadastrado no ERP. Informe outro e-mail.", "duplicate");
      throw e;
    }
    try {
      const authId = await getAuth().createUser(data.email, input.password!, data.name);
      user = await ctx.store.update("users", user.id, { authId });
    } catch (e: any) {
      await ctx.store.delete("users", user.id);
      throw new BusinessError(`Não foi possível criar a credencial no serviço de autenticação: ${e?.message ?? e}`, "auth_failed");
    }
    await audit(ctx, { module: "admin", action: "user.create", entityType: "user", entityId: user.id, summary: `Usuário ${user.name} criado com acesso direto (senha inicial definida pelo administrador)`, after: { ...data, ...companyFields }, related: user.roleId ? [`role:${user.roleId}`] : [] });
    return { user };
  }
  const days = await getSetting<number>(ctx.store, ctx.companyId, null, "users.inviteExpiryDays", DEFAULT_INVITE_DAYS);
  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  let user: Doc;
  try {
    user = await ctx.store.create("users", { ...data, ...companyFields, roleByCompany, status: "invited", inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, invitedBy: ctx.user.id, createdBy: ctx.user.id }, id);
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("E-mail já cadastrado no ERP. Informe outro e-mail.", "duplicate");
    throw e;
  }
  const r = await sendInvite(ctx, user, token, input.origin ?? "", expiresAt);
  user = await ctx.store.update("users", user.id, { inviteSentAt: nowIso(), inviteDelivery: r.delivery });
  await audit(ctx, {
    module: "admin", action: "user.invite", entityType: "user", entityId: user.id,
    summary: `Convite criado para ${user.name} (${r.delivered ? `e-mail entregue ao provedor ${r.channel}` : "e-mail não enviado — link exibido ao administrador"})`,
    after: { ...data, ...companyFields, inviteExpiresAt: expiresAt, delivery: r.delivery }, result: "success", related: user.roleId ? [`role:${user.roleId}`] : [],
  });
  return { user, invite: { link: r.link, delivered: r.delivered, channel: r.channel, message: r.message, expiresAt } };
}

export async function updateUser(ctx: Ctx, id: string, input: UserInput) {
  await guard(ctx, "edit", `alterar usuário ${input.email}`, id);
  const before = await loadManagedUser(ctx, id);
  const base = unscoped(ctx.store);
  const currentRole = before.isAdmin ? null : await userRoleIn(ctx.store, before, ctx.companyId);
  // filiais por empresa (formulário): a lista legada fica como estava; só a atribuição DESTA empresa muda
  const perCompany = Array.isArray(input.companyBranchIds);
  if (perCompany) input = { ...input, branchIds: before.branchIds ?? [] };
  let merged: UserInput = { ...input };
  if (!ctx.user.isAdmin) {
    // alcance do gestor = empresas em que ele administra usuários (admin/editar + "admin.users" no perfil DAQUELA empresa).
    // Vínculos com empresas (e filiais delas) fora desse alcance são preservados — merge no servidor; incluir filial de
    // empresa fora do alcance é recusado.
    const inputCompanies = input.companyIds.filter(Boolean);
    const manageable = await manageableCompanyIds(ctx, [...(before.companyIds ?? []), ...inputCompanies]);
    const allBranches = await listAll(base, "branches");
    const branchCompany = new Map(allBranches.map((b) => [b.id, b.companyId as string]));
    const inScope = (b: string) => manageable.has(branchCompany.get(b) ?? "");
    const keptCompanies = (before.companyIds ?? []).filter((c: string) => !manageable.has(c));
    const keptBranches = (before.branchIds ?? []).filter((b: string) => !inScope(b));
    const addedOutside = input.branchIds.filter((b) => b && !inScope(b) && !(before.branchIds ?? []).includes(b) && branchCompany.has(b));
    if (addedOutside.length) throw new PermissionError("Filial de empresa em que você não administra usuários: o acesso a ela não pode ser alterado por você.");
    merged = {
      ...input,
      companyIds: [...new Set([...inputCompanies, ...keptCompanies])],
      branchIds: [...new Set([...input.branchIds.filter((b) => b && (inScope(b) || !branchCompany.has(b))), ...keptBranches])],
    };
    // A restrição de filiais (branchIds) é UMA lista para todas as empresas do usuário: vazia = todas as filiais de todas
    // as empresas (e o consolidado); com itens = só as filiais listadas, em qualquer empresa. Alvo com empresa fora do
    // alcance do gestor: a restrição nelas precisa ficar idêntica — não se inclui restrição em quem não tem, não se remove
    // a de quem tem (as filiais de fora já são preservadas acima).
    if (keptCompanies.length) {
      const had = (before.branchIds ?? []).length > 0;
      const will = merged.branchIds.length > 0;
      if (had !== will) {
        const names = (await companyNames(ctx, keptCompanies)).join(", ");
        const outside = `${names} (${keptCompanies.length === 1 ? "empresa" : "empresas"} em que você não administra usuários)`;
        if (!had) {
          throw new PermissionError(
            `Restringir filiais: ${before.name} acessa todas as filiais, e a restrição de filiais vale para todas as empresas dele — inclusive ${outside}, onde ele perderia o acesso. Deixe as filiais desmarcadas ou peça a um administrador (ou a quem administra usuários em todas as empresas dele).`,
          );
        }
        throw new PermissionError(
          `Marque ao menos uma filial: ${before.name} tem restrição de filiais, que vale para todas as empresas dele. Sem filial marcada, a restrição deixaria de valer também em ${outside}. Para liberar todas as filiais, peça a um administrador (ou a quem administra usuários em todas as empresas dele).`,
        );
      }
      if (will) {
        // Com restrição, a lista é literal: empresa do alcance sem filial marcada = nenhuma filial dela (nunca ampliação
        // silenciosa). Se o usuário tinha filiais nessa empresa e todas foram desmarcadas, a intenção é ambígua (no
        // formulário sem restrição, "nenhuma" significaria "todas") — recusamos e pedimos uma escolha explícita.
        const listed = new Set(merged.branchIds.map((b) => branchCompany.get(b)));
        const hadIn = new Set((before.branchIds ?? []).map((b: string) => branchCompany.get(b)));
        const emptied = merged.companyIds.filter((c) => manageable.has(c) && !listed.has(c) && hadIn.has(c));
        if (emptied.length) {
          const names = (await companyNames(ctx, emptied)).join(", ");
          throw new BusinessError(
            `Marque ao menos uma filial de ${names}: ${before.name} tem restrição de filiais (que vale para todas as empresas dele) e, sem filial marcada, perderia o acesso a ${emptied.length === 1 ? "essa empresa" : "essas empresas"}. Para liberar todas as filiais, peça a um administrador (ou a quem administra usuários em todas as empresas dele).`,
            "branch_required",
          );
        }
      }
    }
    // dados de acesso e limite de desconto valem em todas as empresas do usuário
    const emailChanged = (input.email?.trim().toLowerCase() ?? "") !== (before.email ?? "");
    const loginChanged = (input.login?.trim().toLowerCase() || null) !== (before.login ?? null);
    if (emailChanged || loginChanged) {
      await assertManagesWholeUser(ctx, before, "Alterar e-mail ou login");
      // e-mail novo + "Esqueci minha senha" = assumir a conta: mesma regra de quem define a senha
      await assertCanTakeOver(ctx, before, "Alterar e-mail ou login");
    }
    if ((input.discountLimitBps ?? null) !== (before.discountLimitBps ?? null)) await assertManagesWholeUser(ctx, before, "Alterar o limite de desconto");
    if (id === ctx.user.id) {
      const changed =
        !sameSet([...new Set(merged.companyIds.filter(Boolean))], before.companyIds ?? []) ||
        !sameSet([...new Set(merged.branchIds.filter(Boolean))], before.branchIds ?? []) ||
        (merged.roleId || null) !== (currentRole?.id ?? null) ||
        (merged.discountLimitBps ?? null) !== (before.discountLimitBps ?? null);
      if (changed) throw new PermissionError("Você não pode alterar o próprio vínculo, perfil ou limite de desconto. Peça a outro gestor de usuários.");
    }
  }
  const data = await validateInput(ctx, merged, id, { legacyBranches: !perCompany });
  const extra = await validateCompanyFields(ctx, input);
  // acesso rápido da tela de login (decisão do titular), para qualquer editor — inclusive o administrador geral:
  // o botão entra pelo login com a senha presa ao e-mail, e administrador geral não aparece na lista
  if (isQuickAccessUser(before)) {
    if ((data.email ?? "") !== (before.email ?? "") || (data.login ?? null) !== (before.login ?? null))
      throw new BusinessError(quickAccessLockedMessage("Não é possível alterar o e-mail ou o login", before.name), QUICK_ACCESS_LOCKED);
    if (data.isAdmin) throw new BusinessError(quickAccessLockedMessage("Não é possível tornar administrador geral", before.name), QUICK_ACCESS_LOCKED);
  }
  const added = data.companyIds.filter((c) => !(before.companyIds ?? []).includes(c));
  const removed = (before.companyIds ?? []).filter((c: string) => !data.companyIds.includes(c));
  await assertCanManageCompanies(ctx, [...added, ...removed]);
  // perfil por empresa: só o perfil da empresa em uso muda; os das outras empresas ficam explícitos e preservados
  const others = data.companyIds.filter((c) => c !== ctx.companyId);
  const roleByCompany: Record<string, string> = data.isAdmin ? { ...(before.roleByCompany ?? {}) } : await materializeRoles(ctx.store, before, others);
  if (!data.isAdmin) {
    for (const c of Object.keys(roleByCompany)) if (!data.companyIds.includes(c)) delete roleByCompany[c];
    if (data.roleId) roleByCompany[ctx.companyId] = data.roleId;
  }
  const legacy = before.roleId ? await base.get("roles", before.roleId) : null;
  // perfil legado (roleId): segue o perfil desta empresa quando era daqui (ou não havia); se é de outra empresa vinculada, fica
  const roleId = legacy && legacy.companyId !== ctx.companyId && data.companyIds.includes(legacy.companyId) ? before.roleId : data.roleId;

  // multiempresa — perfil só dentro do próprio escopo: o novo perfil nesta empresa (e o de cada empresa vinculada agora)
  // não vai além do acesso do editor; quem já tem acesso acima do dele não tem o perfil trocado por ele
  if (!ctx.user.isAdmin && !data.isAdmin) {
    if ((data.roleId || null) !== (currentRole?.id ?? null)) {
      await assertNotAboveEditor(ctx, before, currentRole);
      await assertRolesAssignable(ctx, roleByCompany, [ctx.companyId], before.name);
    }
    await assertRolesAssignable(ctx, roleByCompany, added.filter((c) => c !== ctx.companyId), before.name);
  }

  // cargo e filiais POR EMPRESA: só os da empresa em uso mudam; vínculo novo recebe as filiais que o editor acessa lá
  // (todas, se ele acessa todas); vínculo desfeito leva junto o cargo e as filiais daquela empresa
  const companyPatch: Record<string, any> = {};
  if (!data.isAdmin) {
    const branchMap: Record<string, string[]> = { ...(before.branchIdsByCompany ?? {}) };
    let branchChanged = false;
    if (perCompany) {
      let list = extra.companyBranchIds!;
      const mine = editorBranches(ctx);
      const had = scopeIn(before, ctx.companyId, extra.here);
      // quem acessa só algumas filiais: as filiais do usuário fora do alcance dele ficam como estavam
      if (mine && list.length && had?.length) list = [...new Set([...list, ...had.filter((b) => !mine.has(b))])];
      branchMap[ctx.companyId] = list;
      for (const c of added) if (c !== ctx.companyId) branchMap[c] = (await editorBranchScopeIn(ctx, c)) ?? [];
      branchChanged = true;
    } else if (!sameSet(data.branchIds, before.branchIds ?? []) && Object.keys(branchMap).length) {
      // modo legado (lista única): a lista volta a valer nas empresas do alcance do editor
      const reach = ctx.user.isAdmin ? null : await manageableCompanyIds(ctx, Object.keys(branchMap));
      for (const c of Object.keys(branchMap)) if (!reach || reach.has(c)) delete branchMap[c];
      branchChanged = true;
    }
    for (const c of removed) {
      if (!(c in branchMap)) continue;
      delete branchMap[c];
      branchChanged = true;
    }
    if (branchChanged) companyPatch.branchIdsByCompany = branchMap;
  }
  // cargo, departamento e função: por empresa; desvincular apaga os da empresa removida
  for (const k of ["jobTitle", "department", "jobFunction"] as const) {
    const field = ATTRIBUTE_FIELDS[k];
    const map: Record<string, string> = { ...(before[field] ?? {}) };
    if (extra[k] === undefined && !removed.some((c: string) => c in map)) continue;
    if (extra[k]) map[ctx.companyId] = extra[k]!;
    else if (extra[k] !== undefined) delete map[ctx.companyId];
    for (const c of removed) delete map[c];
    companyPatch[field] = map;
  }
  const patch: Record<string, any> = { ...data, roleId, roleByCompany, ...companyPatch };
  const afterDoc = { ...before, ...patch };
  // autoproteção (quem não é administrador): nem as filiais nem o cargo desta empresa mudam no próprio cadastro
  // (departamento e função também: com regra de perfil por atributo, mudariam o próprio perfil)
  const was = attributesIn(before, ctx.companyId);
  const ownTitleChanged = (["jobTitle", "department", "jobFunction"] as const).some((k) => extra[k] !== undefined && (extra[k] ?? null) !== was[k]);
  if (!ctx.user.isAdmin && id === ctx.user.id && ownTitleChanged) throw new PermissionError("Você não pode alterar o próprio vínculo, cargo, perfil ou limite de desconto. Peça a outro gestor de usuários.");
  if (!data.isAdmin) {
    const had = scopeIn(before, ctx.companyId, extra.here);
    const will = scopeIn(afterDoc, ctx.companyId, extra.here);
    if (!ctx.user.isAdmin && id === ctx.user.id && !sameScope(had, will)) throw new PermissionError("Você não pode alterar o próprio vínculo, cargo, perfil ou limite de desconto. Peça a outro gestor de usuários.");
    assertBranchGrant(ctx, before.name, had, will, extra.branchNames);
  }
  // último administrador POR EMPRESA: trocar o perfil, desvincular ou tornar administrador da plataforma
  const whatFor = (c: string) =>
    !(afterDoc.companyIds ?? []).includes(c) ? `Desvincular ${before.name} desta empresa` : data.isAdmin && !before.isAdmin ? `Tornar ${before.name} administrador da plataforma` : `Trocar o perfil de ${before.name}`;
  const lost = await companyAdminLoss(ctx, before, afterDoc, whatFor);

  if (before.isAdmin && !data.isAdmin) {
    if (!ctx.user.isAdmin) throw new BusinessError("Somente administradores podem revogar acesso de administrador.", "forbidden");
    await assertNotLastAdmin(ctx.store, before, "Remover o acesso de administrador");
    // rebaixamento primeiro e conferido depois de gravado (dois administradores rebaixando um ao outro ao mesmo tempo)
    await ctx.store.update("users", id, { isAdmin: false, roleId, roleByCompany });
    if (before.status === "active" && (await activeAdmins(ctx.store)).length === 0) {
      await ctx.store.update("users", id, { isAdmin: true, roleId: before.roleId ?? null, roleByCompany: before.roleByCompany ?? null });
      throw lastAdminError(before, "Remover o acesso de administrador");
    }
  }
  const after = await ctx.store.update("users", id, patch);
  // conferência depois de gravar (duas trocas simultâneas deixariam a empresa sem administrador): desfaz e recusa
  const orphan = await firstCompanyWithoutAdmin(ctx.store, lost);
  if (orphan) {
    await ctx.store.update("users", id, Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])));
    throw lastCompanyAdminError(before.name, (await companyNames(ctx, [orphan]))[0], whatFor(orphan));
  }
  const d = diff(before, after);
  if (Object.keys(d.after).length) {
    await audit(ctx, { module: "admin", action: "user.update", entityType: "user", entityId: id, summary: `Cadastro/acesso de ${after.name} alterado`, before: d.before, after: d.after, related: [currentRole?.id, data.roleId].filter(Boolean).map((r) => `role:${r}`) });
  }
  return after;
}

async function endLocalSessions(store: Store, userId: string) {
  const sessions = await listAll(store, "sessions", { filters: [["eq", "userId", userId]] });
  for (const s of sessions) await store.delete("sessions", s.id);
  return sessions.length;
}

/** Ativa, inativa ou suspende (com motivo). Suspensão e inativação bloqueiam o login imediatamente. */
export async function setUserStatus(ctx: Ctx, id: string, status: "active" | "inactive" | "suspended", reason?: string | null) {
  await guard(ctx, "edit", `alterar situação de usuário para ${status}`, id);
  const u = await loadManagedUser(ctx, id);
  assert(u.id !== ctx.user.id, "Você não pode alterar a situação do seu próprio acesso.");
  if (status === "active" && u.status !== "active" && u.status !== "invited" && !u.isAdmin) {
    const { assertWithinLimit } = await import("./licensing/limits");
    for (const cid of u.companyIds ?? []) await assertWithinLimit(unscoped(ctx.store), cid, "users");
  }
  await assertManagesWholeUser(ctx, u, "Alterar a situação do acesso");
  // acesso rápido da tela de login (decisão do titular): o usuário não sai da lista
  if (status !== "active" && isQuickAccessUser(u)) throw new BusinessError(quickAccessLockedMessage(status === "suspended" ? "Não é possível suspender" : "Não é possível inativar", u.name), QUICK_ACCESS_LOCKED);
  if (status === "suspended") assert(reason?.trim(), "Informe o motivo da suspensão.");
  if (status === u.status) return u;
  const what = status === "suspended" ? "Suspender" : "Inativar";
  if (status !== "active") await assertNotLastAdmin(ctx.store, u, what);
  // último administrador POR EMPRESA (a situação vale em todas as empresas do usuário)
  const lost = status !== "active" ? await companyAdminLoss(ctx, u, { ...u, status }, () => what) : [];
  // a situação é conferida no login e em cada sessão (login próprio): gravá-la já bloqueia ou libera o acesso
  let after: Doc;
  if (status === "active") {
    if (!u.authId) throw new BusinessError("Este usuário ainda não definiu senha. Reenvie o convite para que ele ative o acesso.", "no_credentials");
    after = await ctx.store.update("users", id, { status: "active", suspendedReason: null, suspendedAt: null });
  } else {
    // suspensão/inativação também invalida um link de recuperação de senha pendente
    after = await ctx.store.update("users", id, { status, suspendedReason: reason?.trim() || null, suspendedAt: status === "suspended" ? nowIso() : null, inviteTokenHash: null, inviteExpiresAt: null, resetTokenHash: null, resetExpiresAt: null });
    const undo = () =>
      ctx.store.update("users", id, {
        status: u.status, suspendedReason: u.suspendedReason ?? null, suspendedAt: u.suspendedAt ?? null, inviteTokenHash: u.inviteTokenHash ?? null, inviteExpiresAt: u.inviteExpiresAt ?? null,
        resetTokenHash: u.resetTokenHash ?? null, resetExpiresAt: u.resetExpiresAt ?? null,
      });
    // conferência depois da gravação: sob concorrência (dois administradores suspendendo um ao outro), desfaz e recusa
    if (u.isAdmin && u.status === "active" && (await activeAdmins(ctx.store)).length === 0) {
      await undo();
      throw lastAdminError(u, what);
    }
    const orphan = await firstCompanyWithoutAdmin(ctx.store, lost);
    if (orphan) {
      await undo();
      throw lastCompanyAdminError(u.name, (await companyNames(ctx, [orphan]))[0], what);
    }
  }
  const ended = status !== "active" ? await endLocalSessions(ctx.store, id) : 0;
  const label = { active: "reativado", inactive: "inativado", suspended: "suspenso" }[status];
  await audit(ctx, {
    module: "admin", action: `user.${status === "active" ? "activate" : status === "inactive" ? "deactivate" : "suspend"}`, entityType: "user", entityId: id,
    summary: `Acesso de ${u.name} ${label}${ended ? ` (${ended} sessão(ões) encerrada(s))` : ""}`, before: { status: u.status }, after: { status }, reason: reason?.trim() || null,
  });
  return after;
}

/** Gera novo token (o anterior deixa de valer) e reenvia o convite. Também reativa convite cancelado/expirado. */
export async function resendInvite(ctx: Ctx, id: string, origin: string): Promise<{ user: Doc; invite: InviteResult }> {
  await guard(ctx, "edit", "reenviar convite", id);
  const u = await loadManagedUser(ctx, id);
  await assertManagesWholeUser(ctx, u, "Reenviar o convite");
  assert(!u.authId || u.status === "invited", "Este usuário já ativou o acesso; use “Definir nova senha” se ele esqueceu a senha.");
  assert(u.status !== "suspended", "Usuário suspenso: reative antes de reenviar o convite.");
  const days = await getSetting<number>(ctx.store, ctx.companyId, null, "users.inviteExpiryDays", DEFAULT_INVITE_DAYS);
  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  await ctx.store.update("users", id, { status: "invited", inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt });
  const r = await sendInvite(ctx, u, token, origin, expiresAt);
  const user = await ctx.store.update("users", id, { inviteSentAt: nowIso(), inviteDelivery: r.delivery, invitedBy: ctx.user.id });
  await audit(ctx, { module: "admin", action: "user.invite_resend", entityType: "user", entityId: id, summary: `Convite reenviado para ${u.name} (${r.delivered ? `entregue ao provedor ${r.channel}` : "link exibido ao administrador"}); token anterior invalidado`, after: { inviteExpiresAt: expiresAt, delivery: r.delivery } });
  return { user, invite: { link: r.link, delivered: r.delivered, channel: r.channel, message: r.message, expiresAt } };
}

export async function cancelInvite(ctx: Ctx, id: string) {
  await guard(ctx, "edit", "cancelar convite", id);
  const u = await loadManagedUser(ctx, id);
  await assertManagesWholeUser(ctx, u, "Cancelar o convite");
  assert(u.status === "invited", "Não há convite pendente para este usuário.");
  const after = await ctx.store.update("users", id, { status: "inactive", inviteTokenHash: null, inviteExpiresAt: null });
  await audit(ctx, { module: "admin", action: "user.invite_cancel", entityType: "user", entityId: id, summary: `Convite de ${u.name} cancelado (link invalidado)` });
  return after;
}

/** Administrador define nova senha (ex.: usuário esqueceu e não há canal de e-mail). */
export async function adminSetPassword(ctx: Ctx, id: string, password: string) {
  await guard(ctx, "edit", "redefinir senha de usuário", id);
  assert(password.length >= 8, "A senha deve ter ao menos 8 caracteres.");
  const u = await loadManagedUser(ctx, id);
  await assertManagesWholeUser(ctx, u, "Redefinir a senha");
  await assertCanTakeOver(ctx, u, "Redefinir a senha");
  assert(u.status === "active", "Somente usuários ativos podem ter a senha redefinida.");
  // acesso rápido: a senha é a da demonstração, exibida na tela — só aceita voltar a ela (conserta um acesso alterado)
  if (isQuickAccessUser(u) && password !== (process.env.DEMO_PASSWORD || "Intercert@2026"))
    throw new BusinessError(quickAccessLockedMessage("Não é possível trocar a senha", u.name), QUICK_ACCESS_LOCKED);
  // login próprio: grava a senha nova (hash) no cadastro, localizado pelo e-mail; sem credencial ainda, passa a ter uma
  const authId = await getAuth().createUser(u.email, password, u.name);
  if (!u.authId) await ctx.store.update("users", id, { authId });
  await endLocalSessions(ctx.store, id);
  await audit(ctx, { module: "admin", action: "user.password_reset", entityType: "user", entityId: id, summary: `Senha de ${u.name} redefinida pelo administrador (sessões encerradas)` });
}

/**
 * §44 — redefine a autenticação em duas etapas de um usuário (perdeu o celular): apaga segredo e códigos de recuperação
 * e encerra as sessões locais. Se o perfil exige, o usuário cadastra um aparelho novo no próximo login. Auditado.
 */
export async function adminResetTwoFactor(ctx: Ctx, id: string, reason: string) {
  await guard(ctx, "edit", "redefinir autenticação em duas etapas de usuário", id);
  assert(reason?.trim(), "Informe o motivo da redefinição.");
  const u = await loadManagedUser(ctx, id);
  assert(u.id !== ctx.user.id, "Você não pode redefinir a sua própria autenticação em duas etapas por aqui: use Minha conta › Segurança.");
  await assertManagesWholeUser(ctx, u, "Redefinir a autenticação em duas etapas");
  await assertCanTakeOver(ctx, u, "Redefinir a autenticação em duas etapas");
  assert(u.totpEnabled || u.totpPendingEnc, "O usuário não tem autenticação em duas etapas cadastrada.");
  const { TWO_FACTOR_RESET_PATCH } = await import("./two-factor");
  await unscoped(ctx.store).update("users", id, TWO_FACTOR_RESET_PATCH);
  const ended = await endLocalSessions(ctx.store, id);
  await audit(ctx, { module: "admin", action: "user.2fa_reset", entityType: "user", entityId: id, summary: `Autenticação em duas etapas de ${u.name} redefinida pelo administrador${ended ? ` (${ended} sessão(ões) encerrada(s))` : ""}`, reason: reason.trim() });
}

// ───────────────────────────── multiempresa: sessões e recuperação de senha iniciada pelo administrador

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Sessões abertas (válidas) do usuário no login próprio do ERP: quantas e quando começou a mais recente. */
export async function openSessions(store: Store, u: Record<string, any>): Promise<{ count: number; lastStartedAt: string | null }> {
  const now = nowIso();
  const valid = (await listAll(unscoped(store), "sessions", { filters: [["eq", "userId", u.id]] })).filter(
    (s) => String(s.expiresAt ?? "") > now && (!u.sessionsValidAfter || String(s.createdAt ?? "") >= u.sessionsValidAfter),
  );
  return { count: valid.length, lastStartedAt: valid.map((s) => String(s.createdAt)).sort().pop() ?? null };
}

/**
 * Encerra TODAS as sessões de um usuário da empresa em uso (administrador): grava `sessionsValidAfter` = agora (sessão
 * emitida antes deixa de valer — `LocalAuth.verify`) e apaga as linhas de `sessions`. A sessão é da pessoa: vale em todos
 * os dispositivos e em todas as empresas dela. Não serve para o próprio acesso (use `revokeOtherSessions`). Auditado.
 */
export async function revokeUserSessions(ctx: Ctx, id: string, reason?: string | null): Promise<{ ended: number; at: string }> {
  await guard(ctx, "edit", "encerrar sessões de usuário", id);
  const u = await loadManagedUser(ctx, id);
  assert(u.id !== ctx.user.id, "Para encerrar as suas próprias sessões, use Minha conta › Segurança (a sessão atual continua aberta).");
  // acesso rápido (decisão do titular): o mesmo usuário é usado por todos os visitantes — um não derruba os demais
  if (isQuickAccessUser(u)) throw new BusinessError(quickAccessLockedMessage("Não é possível encerrar as sessões", u.name), QUICK_ACCESS_LOCKED);
  const at = nowIso();
  await ctx.store.update("users", id, { sessionsValidAfter: at });
  const ended = await endLocalSessions(ctx.store, id);
  await audit(ctx, {
    module: "admin", action: "user.sessions_revoke", entityType: "user", entityId: id,
    summary: `Sessões de ${u.name} encerradas pelo administrador (${ended} aberta(s)); novo login exigido em todos os dispositivos`, after: { sessionsValidAfter: at }, reason: reason?.trim() || null,
  });
  return { ended, at };
}

/**
 * O próprio usuário encerra as OUTRAS sessões dele (Minha conta › Segurança), mantendo a atual — `currentSecret` é o
 * segredo do cookie de sessão desta requisição. Auditado.
 */
export async function revokeOtherSessions(ctx: Ctx, currentSecret: string): Promise<{ ended: number }> {
  const me = await unscoped(ctx.store).get("users", ctx.user.id);
  if (!me) throw new NotFoundError("users", ctx.user.id);
  if (isQuickAccessUser(me)) throw new BusinessError(quickAccessLockedMessage("Não é possível encerrar as outras sessões", me.name), QUICK_ACCESS_LOCKED);
  const unknown = "Não foi possível identificar a sessão atual. Entre de novo e tente outra vez.";
  assert(currentSecret, unknown);
  let ended = 0;
  const keep = sha256(currentSecret);
  const sessions = await listAll(ctx.store, "sessions", { filters: [["eq", "userId", me.id]] });
  assert(sessions.some((s) => s.tokenHash === keep), unknown);
  for (const s of sessions) {
    if (s.tokenHash === keep) continue;
    await ctx.store.delete("sessions", s.id);
    ended++;
  }
  await audit(ctx, { module: "admin", action: "user.sessions_revoke_others", entityType: "user", entityId: me.id, summary: `${me.name} encerrou as outras sessões (${ended}); a sessão atual continua aberta` });
  return { ended };
}

/** Tentativas erradas da senha atual na troca de senha que bloqueiam a troca por um tempo (força bruta com sessão aberta). */
export const PASSWORD_CHANGE_MAX_FAILURES = 5;
export const PASSWORD_CHANGE_WINDOW_MIN = 15;

/**
 * Minha conta › Segurança — a própria pessoa troca a senha: confere a senha atual pelo mesmo caminho do login, grava a
 * nova e encerra as OUTRAS sessões (a atual continua). Cinco senhas atuais erradas em 15 minutos bloqueiam a troca até a
 * janela passar (quem pega um computador com a sessão aberta não descobre a senha por tentativa). Usuários do acesso
 * rápido não trocam: a senha deles é a da tela de login. Auditado (sem a senha).
 */
export async function changeOwnPassword(ctx: Ctx, currentSecret: string, currentPassword: string, newPassword: string): Promise<{ ended: number }> {
  const me = await unscoped(ctx.store).get("users", ctx.user.id);
  if (!me || me.status !== "active") throw new NotFoundError("users", ctx.user.id);
  if (isQuickAccessUser(me)) throw new BusinessError(quickAccessLockedMessage("Não é possível trocar a senha", me.name), QUICK_ACCESS_LOCKED);
  assert(currentPassword, "Informe a senha atual.");
  assert(newPassword.length >= 8, "A nova senha deve ter ao menos 8 caracteres.");
  assert(newPassword !== currentPassword, "A nova senha precisa ser diferente da atual.");
  const since = new Date(Date.now() - PASSWORD_CHANGE_WINDOW_MIN * 60000).toISOString();
  const failures = (await listAll(unscoped(ctx.store), "audit_logs", { filters: [["eq", "entityId", me.id], ["eq", "action", "user.password_change_failed"]] })).filter((a) => String(a.occurredAt ?? a.createdAt ?? "") >= since).length;
  if (failures >= PASSWORD_CHANGE_MAX_FAILURES)
    throw new BusinessError(`Muitas tentativas com a senha atual errada. Aguarde ${PASSWORD_CHANGE_WINDOW_MIN} minutos e tente de novo.`, "password_change_blocked");
  const auth = getAuth();
  let probe: string | null = null;
  try {
    probe = (await auth.login(me.email, currentPassword, false)).secret;
  } catch {
    await audit(ctx, { module: "admin", action: "user.password_change_failed", entityType: "user", entityId: me.id, summary: `Troca de senha recusada para ${me.name}: senha atual incorreta`, result: "failure" });
    throw new BusinessError("Senha atual incorreta.", "invalid_password");
  } finally {
    if (probe) await auth.logout(probe).catch(() => undefined);
  }
  await auth.createUser(me.email, newPassword, me.name);
  // as outras sessões deixam de valer; a desta requisição continua
  const keep = currentSecret ? sha256(currentSecret) : null;
  let ended = 0;
  for (const s of await listAll(unscoped(ctx.store), "sessions", { filters: [["eq", "userId", me.id]] })) {
    if (keep && s.tokenHash === keep) continue;
    await unscoped(ctx.store).delete("sessions", s.id);
    ended++;
  }
  await audit(ctx, { module: "admin", action: "user.password_change", entityType: "user", entityId: me.id, summary: `${me.name} trocou a própria senha${ended ? ` (${ended} outra(s) sessão(ões) encerrada(s))` : ""}` });
  return { ended };
}

export interface RecoveryLinkResult {
  /** link de uso único */
  link: string;
  delivered: boolean;
  channel: string;
  message: string | null;
  expiresAt: string;
}

/**
 * Recuperação de senha iniciada pelo administrador: link de uso único com validade (`ADMIN_RECOVERY_HOURS`), no mesmo
 * mecanismo de “Esqueci minha senha” (`resetTokenHash` + /redefinir-senha). Vai pelo canal de e-mail da empresa em uso;
 * sem canal, o link volta para o administrador entregar por um canal seguro (como no convite). Gerar outro invalida o
 * anterior; a senha atual vale até a pessoa definir a nova, e aí as sessões anteriores deixam de valer
 * (`completeRecovery`). Senha vale em todas as empresas do usuário: exige administrar usuários em todas elas. Auditado.
 */
export async function adminStartRecovery(ctx: Ctx, id: string, origin: string): Promise<{ user: Doc; recovery: RecoveryLinkResult }> {
  await guard(ctx, "edit", "iniciar recuperação de senha de usuário", id);
  const u = await loadManagedUser(ctx, id);
  assert(u.id !== ctx.user.id, "Para trocar a sua própria senha, use “Esqueci minha senha” na tela de login.");
  await assertManagesWholeUser(ctx, u, "Iniciar a recuperação de senha");
  await assertCanTakeOver(ctx, u, "Iniciar a recuperação de senha");
  if (u.status === "invited") throw new BusinessError("Convite pendente: use “Reenviar convite” para o primeiro acesso.", "invited");
  assert(u.status === "active", "Somente usuários ativos recebem link de recuperação de senha.");
  // acesso rápido (decisão do titular): a senha é a da tela — nenhum link de troca
  if (isQuickAccessUser(u)) throw new BusinessError(quickAccessLockedMessage("Não é possível enviar link de recuperação de senha", u.name), QUICK_ACCESS_LOCKED);
  const site = origin.replace(/\/$/, "");
  const secret = newToken();
  const expiresAt = new Date(Date.now() + ADMIN_RECOVERY_HOURS * 3600000).toISOString();
  // credencial local identificada pelo e-mail (como `LocalAuth.createUser`): sem ela, a senha nova não abriria sessão
  await ctx.store.update("users", id, { resetTokenHash: sha256(secret), resetExpiresAt: expiresAt, ...(u.authId ? {} : { authId: `local:${String(u.email).toLowerCase()}` }) });
  const link = `${site}/redefinir-senha?userId=${encodeURIComponent(u.id)}&secret=${secret}`;
  const company = await ctx.store.get("companies", ctx.companyId);
  const companyName = company?.tradeName || company?.name || "Intercert ERP";
  const sent = await sendEmail(ctx.companyId, {
    to: u.email,
    subject: `Redefinição de senha — ${companyName}`,
    html:
      `<p>Olá, ${escapeHtml(u.name)}.</p><p>${escapeHtml(ctx.user.name)} iniciou a redefinição da sua senha de acesso ao ERP de <b>${escapeHtml(companyName)}</b>.</p>` +
      `<p>Para definir uma nova senha, abra: <a href="${link}">${link}</a></p>` +
      `<p>O link vale uma única vez e expira em ${new Date(expiresAt).toLocaleString("pt-BR", { timeZone: DEFAULT_TZ })}. Ao definir a nova senha, as sessões abertas com a senha anterior são encerradas.</p>` +
      `<p>Se você não esperava esta mensagem, procure o administrador.</p>`,
  });
  const r: RecoveryLinkResult = { link, delivered: sent.delivered, channel: sent.channel, message: sent.message ?? null, expiresAt };
  await audit(ctx, {
    module: "admin", action: "user.recovery_start", entityType: "user", entityId: id,
    summary: `Recuperação de senha de ${u.name} iniciada pelo administrador (${r.delivered ? `e-mail entregue ao provedor ${r.channel}` : "e-mail não enviado — link exibido ao administrador"}); link de uso único, válido até ${new Date(r.expiresAt).toLocaleString("pt-BR", { timeZone: DEFAULT_TZ })}; link anterior invalidado`,
    after: { resetExpiresAt: r.expiresAt, delivered: r.delivered, channel: r.channel },
  });
  return { user: u, recovery: r };
}

/** Primeiro acesso por convite: valida o token, cria a credencial e ativa o usuário. */
export async function acceptInvite(store: Store, token: string, password: string) {
  assert(password.length >= 8, "A senha deve ter ao menos 8 caracteres.");
  const u = await findOne(store, "users", [["eq", "inviteTokenHash", sha256(token)]]);
  if (!u || u.status !== "invited" || (u.inviteExpiresAt && u.inviteExpiresAt < nowIso())) throw new BusinessError("Convite inválido ou expirado.", "invalid_invite");
  const auth = getAuth();
  const authId = u.authId ?? (await auth.createUser(u.email, password, u.name));
  if (u.authId) await auth.setPassword(u.authId, password);
  // login próprio: a senha (hash) fica no cadastro localizado pelo e-mail
  await auth.createUser(u.email, password, u.name);
  const after = await store.update("users", u.id, { authId, status: "active", inviteTokenHash: null, inviteExpiresAt: null, firstAccessAt: nowIso() });
  await audit({ store, user: await toCtxUser(store, after, u.companyIds?.[0] ?? null), companyId: u.companyIds?.[0] ?? "", branchId: null }, { module: "admin", action: "user.invite_accept", entityType: "user", entityId: u.id, summary: `${u.name} aceitou o convite e definiu a senha (primeiro acesso)` });
  await resolveOccurrence(store, `user:${u.id}:invite`).catch(() => 0);
  return after;
}

/** Motivo de bloqueio de login pela situação do cadastro (null = permitido). */
export function loginBlockReason(u: { status?: string | null; suspendedReason?: string | null } & Record<string, any>): string | null {
  // vendedor sem acesso (CAD-05): cadastro só para atribuir vendas, metas e comissões — nunca entra no sistema
  if (u.loginDisabled) return "Cadastro de vendedor sem acesso ao sistema. Procure o administrador.";
  if (u.status === "suspended") return `Acesso suspenso${u.suspendedReason ? `: ${u.suspendedReason}` : ""}. Procure o administrador.`;
  if (u.status === "inactive") return "Usuário inativo. Procure o administrador.";
  if (u.status === "invited") return "Convite pendente: use o link de primeiro acesso enviado ao seu e-mail.";
  if (u.status !== "active") return "Acesso não liberado.";
  return null;
}

/** Autenticação com as mesmas regras da tela de login (situação do cadastro + credencial). */
export async function authenticate(store: Store, login: string, password: string, persistent = false, ip?: string) {
  const user = await findUserByLogin(store, login);
  if (!user) throw new BusinessError("Usuário ou senha inválidos.", "invalid_credentials");
  const attempt = async (why: string) => {
    await audit({ store, user: await toCtxUser(store, user, user.companyIds?.[0] ?? null), companyId: user.companyIds?.[0] ?? "", branchId: null, ip }, { module: "admin", action: "auth.login_failed", entityType: "user", entityId: user.id, summary: `Tentativa de login recusada para ${user.name}: ${why}`, result: "failure" });
  };
  const blocked = loginBlockReason(user);
  if (blocked) {
    await attempt(blocked);
    throw new BusinessError(blocked, "login_blocked");
  }
  try {
    const session = await getAuth().login(user.email, password, persistent);
    return { user, session };
  } catch (e: any) {
    if (e?.message === "invalid_credentials") {
      await attempt("senha incorreta");
      throw new BusinessError("Usuário ou senha inválidos.", "invalid_credentials");
    }
    throw e;
  }
}

/**
 * Indicadores da tela de usuários. `admins` = administradores da empresa (perfil que administra usuários nela) mais, para
 * quem é da plataforma (`platformAdmins`), os administradores da plataforma vinculados.
 */
export async function userStats(store: Store, companyId: string, opts: { platformAdmins?: boolean } = {}) {
  const users = (await companyUsers(store, companyId, opts)).filter((u) => !isSellerOnly(u));
  const own = await companyAdmins(store, companyId);
  return {
    total: users.length,
    active: users.filter((u) => u.status === "active").length,
    invited: users.filter((u) => inviteState(u) === "pending").length,
    expired: users.filter((u) => inviteState(u) === "expired").length,
    suspended: users.filter((u) => u.status === "suspended").length,
    inactive: users.filter((u) => u.status === "inactive").length,
    admins: own.length + users.filter((u) => u.isAdmin && u.status === "active").length,
    companyAdmins: own.length,
    neverAccessed: users.filter((u) => u.status === "active" && !u.lastAccessAt).length,
  };
}
