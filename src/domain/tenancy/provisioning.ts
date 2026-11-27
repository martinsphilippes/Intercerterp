import crypto from "node:crypto";
import { detId, findOne, isConflict, listAll, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import type { Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { DEFAULT_TZ, nowIso } from "@/lib/dates";
import { isValidCnpj, onlyDigits } from "@/lib/core/text";
import { getSetting, setSetting } from "@/lib/core/settings";
import { ServiceError, validationError, notFound, type FieldIssue } from "@/lib/service/errors";
import { createCompanyWithDefaults } from "../setup";
import { REGIMES, TIMEZONES, UFS } from "../companies";
import { contractModuleOfV1Key, CONTRACT_MODULES, CONTRACT_MODULE_KEYS, contractOf, invalidContractModules } from "./contract";
import { companyBlockState, revokeSessionsOfCompany, holdCompanyJobs, releaseCompanyJobs } from "./status";

/**
 * Provisionamento de empresas contratantes pelo Interos (contrato §4).
 *
 * Regras centrais:
 *  - a conta do Interos (`contaInterosId`) identifica a empresa contratante de forma estável: uma conta ↔ uma empresa;
 *  - cada etapa tem identificador determinístico (empresa, matriz, perfis e contas nascem com ids derivados da conta)
 *    e é idempotente: um reenvio — com a mesma Idempotency-Key ou não — retoma o que faltou sem duplicar nada;
 *  - o andamento fica em `tenant_provisionings` (etapas, tentativas, último erro): é o caminho verificável de
 *    recuperação quando a implantação falha no meio;
 *  - toda alteração gera auditoria na própria empresa, com o cliente de serviço como autor.
 */

export interface ServiceActor {
  clientId: string;
  name: string;
  requestId: string;
}

export type StepKey = "empresa" | "unidade_inicial" | "modulos" | "administrador" | "vinculo";
export type StepState = "pendente" | "concluida" | "falhou";

export interface ProvisionStep {
  etapa: StepKey;
  estado: StepState;
  concluidaEm?: string | null;
  erro?: string | null;
  tentativas?: number;
}

const KIND_IN: Record<string, "retail" | "accounting"> = { varejo: "retail", escritorio_contabil: "accounting" };
const KIND_OUT: Record<string, string> = { retail: "varejo", accounting: "escritorio_contabil", certification: "parceiro_rede" };
const ADMIN_ROLE_KEY: Record<string, string> = { retail: "admin", accounting: "firm_admin", certification: "partner_admin" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_RE = /^[A-Za-z0-9._:-]{3,100}$/;

/** Contexto de quem age pelo serviço dentro de uma empresa (autor da auditoria). */
export function serviceCtx(store: Store, actor: ServiceActor, companyId: string): Ctx {
  return {
    store: scopeStore(unscoped(store), companyId),
    companyId,
    branchId: null,
    user: { id: `servico:${actor.clientId}`, name: actor.name, email: "", isAdmin: true, roleName: "Interface de serviço (Interos)", permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [companyId] },
  };
}

// ─── validação da entrada ─────────────────────────────────────────────────────────────────────────────────────────

interface AddressIn {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  codigoMunicipioIbge?: string;
  uf?: string;
}

function str(v: unknown, max = 200): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function addressOut(a: AddressIn | null | undefined) {
  return {
    zip: onlyDigits(a?.cep) || "",
    street: str(a?.logradouro) ?? "",
    number: str(a?.numero, 20) ?? "",
    complement: str(a?.complemento, 120) ?? "",
    district: str(a?.bairro, 120) ?? "",
    cityName: str(a?.municipio, 120) ?? "",
    cityCode: onlyDigits(a?.codigoMunicipioIbge) || "",
    uf: (str(a?.uf, 2) ?? "").toUpperCase(),
  };
}

function checkAddress(prefix: string, a: AddressIn | null | undefined, issues: FieldIssue[]) {
  if (a == null) return;
  if (typeof a !== "object") return void issues.push({ campo: prefix, mensagem: "Endereço deve ser um objeto." });
  const o = addressOut(a);
  if (o.uf && !UFS.includes(o.uf)) issues.push({ campo: `${prefix}.uf`, mensagem: "UF inválida." });
  if (o.cityCode && !/^\d{7}$/.test(o.cityCode)) issues.push({ campo: `${prefix}.codigoMunicipioIbge`, mensagem: "Código IBGE do município deve ter 7 dígitos." });
  if (o.zip && !/^\d{8}$/.test(o.zip)) issues.push({ campo: `${prefix}.cep`, mensagem: "CEP deve ter 8 dígitos." });
}

function checkCnpj(campo: string, v: unknown, issues: FieldIssue[], required: boolean) {
  const d = onlyDigits(v as string);
  if (!d) {
    if (required) issues.push({ campo, mensagem: "Informe o CNPJ." });
    return;
  }
  if (!isValidCnpj(d)) issues.push({ campo, mensagem: "CNPJ inválido." });
}

function checkModules(campo: string, v: unknown, kind: string, issues: FieldIssue[]): string[] {
  if (!Array.isArray(v) || !v.length) {
    issues.push({ campo, mensagem: `Informe os módulos contratados (lista com ao menos um de: ${CONTRACT_MODULE_KEYS.join(", ")}).` });
    return [];
  }
  const keys = [...new Set(v.map((x) => String(x).trim()))];
  const bad = invalidContractModules(keys, kind);
  if (bad.length) issues.push({ campo, mensagem: `Módulo(s) inválido(s) para este tipo de empresa: ${bad.join(", ")}.` });
  return keys;
}

function checkAccount(v: unknown, issues: FieldIssue[]): string {
  const s = String(v ?? "").trim();
  if (!ACCOUNT_RE.test(s)) issues.push({ campo: "contaInterosId", mensagem: "Informe contaInterosId (3 a 100 caracteres: letras, números, . _ : -)." });
  return s;
}

function checkAdmin(campo: string, v: any, issues: FieldIssue[]) {
  if (!v || typeof v !== "object") return void issues.push({ campo, mensagem: "Informe o administrador inicial (nome e e-mail)." });
  if (!str(v.nome)) issues.push({ campo: `${campo}.nome`, mensagem: "Informe o nome do administrador." });
  if (!EMAIL_RE.test(String(v.email ?? "").trim())) issues.push({ campo: `${campo}.email`, mensagem: "Informe um e-mail válido para o administrador." });
}

function checkDelivery(v: unknown, issues: FieldIssue[]): "interos" | "erp" {
  if (v == null || v === "") return "interos";
  if (v !== "interos" && v !== "erp") issues.push({ campo: "entregaConvite", mensagem: 'entregaConvite deve ser "interos" (o link volta na resposta) ou "erp" (o ERP envia o e-mail).' });
  return v === "erp" ? "erp" : "interos";
}

function checkUnit(v: any, issues: FieldIssue[]) {
  if (v == null) return;
  if (typeof v !== "object") return void issues.push({ campo: "unidadeInicial", mensagem: "unidadeInicial deve ser um objeto." });
  if (v.codigo != null && !/^[A-Za-z0-9]{1,20}$/.test(String(v.codigo))) issues.push({ campo: "unidadeInicial.codigo", mensagem: "Código da unidade: até 20 letras ou números." });
  checkCnpj("unidadeInicial.cnpj", v.cnpj, issues, false);
  checkAddress("unidadeInicial.endereco", v.endereco, issues);
  if (v.fusoHorario != null && !TIMEZONES.includes(String(v.fusoHorario))) issues.push({ campo: "unidadeInicial.fusoHorario", mensagem: `Fuso horário inválido. Use um de: ${TIMEZONES.join(", ")}.` });
}

// ─── leitura do estado ────────────────────────────────────────────────────────────────────────────────────────────

/** Empresa visível para o Interos: só as vinculadas a uma conta do Interos (as demais simplesmente não existem para ele). */
export async function linkedCompany(store: Store, companyId: string): Promise<Doc> {
  const c = await unscoped(store).get("companies", String(companyId ?? ""));
  if (!c || !c.interosAccountId) throw notFound();
  return c;
}

export function adminRoleKey(kind: string | null | undefined) {
  return ADMIN_ROLE_KEY[kind ?? "retail"] ?? "admin";
}

async function adminRoleOf(store: Store, company: Doc): Promise<Doc> {
  const role = await findOne(unscoped(store), "roles", [["eq", "companyId", company.id], ["eq", "key", adminRoleKey(company.kind)], ["eq", "system", true]]);
  if (!role) throw new ServiceError(500, "erro_interno", "Perfil de administrador da empresa não encontrado (parametrização incompleta). Retome a implantação.");
  return role;
}

function inviteState(u: Doc): "pendente" | "expirado" | "aceito" | null {
  if (u.status === "invited") return u.inviteExpiresAt && u.inviteExpiresAt < nowIso() ? "expirado" : "pendente";
  if (u.firstAccessAt || u.status === "active") return "aceito";
  return null;
}

const USER_STATE: Record<string, string> = { active: "ativo", invited: "convidado", suspended: "suspenso", inactive: "inativo" };

function userView(u: Doc) {
  return {
    idUsuario: u.id,
    nome: u.name,
    email: u.email,
    situacao: USER_STATE[u.status] ?? u.status,
    convite: u.status === "invited" || u.inviteSentAt ? { estado: inviteState(u), expiraEm: u.inviteExpiresAt ?? null, enviadoEm: u.inviteSentAt ?? null, detalheEntrega: u.inviteDelivery ?? null } : null,
    primeiroAcessoEm: u.firstAccessAt ?? null,
    ultimoAcessoEm: u.lastAccessAt ?? null,
  };
}

/** Situação da empresa para o Interos. */
export async function tenantView(store: Store, companyId: string) {
  const base = unscoped(store);
  const c = await base.get("companies", companyId);
  if (!c) throw notFound();
  const prov = c.interosAccountId ? await base.get("tenant_provisionings", detId("tenant-prov", c.interosAccountId)) : null;
  const [branches, users, adminRole] = await Promise.all([
    listAll(base, "branches", { filters: [["eq", "companyId", companyId]] }),
    listAll(base, "users", { filters: [["contains", "companyIds", companyId]] }),
    findOne(base, "roles", [["eq", "companyId", companyId], ["eq", "key", adminRoleKey(c.kind)], ["eq", "system", true]]),
  ]);
  const members = users.filter((u) => !u.isAdmin && !u.loginDisabled);
  const admins = members.filter((u) => adminRole && ((u.roleByCompany ?? {})[companyId] ?? u.roleId) === adminRole.id);
  const lastActivity = members.map((u) => u.lastAccessAt).filter(Boolean).sort().pop() ?? null;
  const contract = contractOf(c);
  const block = companyBlockState(c);
  return {
    idEmpresa: c.id,
    contaInterosId: c.interosAccountId ?? null,
    tipo: KIND_OUT[c.kind ?? "retail"] ?? c.kind,
    razaoSocial: c.name,
    nomeFantasia: c.tradeName ?? null,
    cnpj: c.cnpj ?? null,
    situacao: block.state,
    suspensao: c.status === "suspended" && c.suspension ? { modo: c.suspension.mode, motivo: c.suspension.reason ?? null, referenciaContrato: c.suspension.contractRef ?? null, desde: c.suspension.at ?? null } : null,
    // trilha das suspensões e reativações (mais recentes por último; o histórico completo fica na auditoria da empresa)
    historicoSituacao: ((c.suspensionHistory ?? []) as any[]).slice(-20).map((h) => ({
      evento: h.event === "reativacao" ? "reativacao" : "suspensao",
      modo: h.event === "reativacao" ? null : (h.mode ?? null),
      motivo: h.reason ?? null,
      referenciaContrato: h.contractRef ?? null,
      em: h.at ?? null,
      requestId: h.requestId ?? null,
    })),
    modulos: contract ? [...contract.modules] : null,
    // origem dos módulos: "provisionamento" (PUT /modulos) ou "licenca" (derivados da licença v2, a referência)
    contrato: contract ? { referencia: contract.reference ?? null, plano: contract.plan ?? null, origemModulos: (contract as any).source === "licenca" ? "licenca" : "provisionamento" } : null,
    implantacao: prov
      ? { operacao: prov.operation, estado: prov.status, etapas: (prov.steps ?? []) as ProvisionStep[], tentativas: prov.attempts ?? 1, ultimoErro: prov.lastError ?? null, iniciadaEm: prov.startedAt ?? null, concluidaEm: prov.finishedAt ?? null }
      : { operacao: null, estado: "nao_iniciada", etapas: [], tentativas: 0, ultimoErro: null, iniciadaEm: null, concluidaEm: null },
    unidades: branches
      .sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")))
      .map((b) => ({ idUnidade: b.id, codigo: b.code ?? null, nome: b.name, cnpj: b.cnpj ?? null, situacao: b.status === "inactive" ? "inativa" : "ativa" })),
    administradores: admins.map(userView),
    usuarios: {
      ativos: members.filter((u) => u.status === "active").length,
      convidados: members.filter((u) => u.status === "invited").length,
      suspensos: members.filter((u) => u.status === "suspended").length,
      inativos: members.filter((u) => u.status === "inactive").length,
    },
    ultimaAtividadeEm: lastActivity,
    vinculadaEm: c.interosLinkedAt ?? null,
    atualizadaEm: c.updatedAt ?? null,
  };
}

// ─── etapas ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function loadProvisioning(store: Store, accountId: string) {
  return unscoped(store).get("tenant_provisionings", detId("tenant-prov", accountId));
}

async function saveProvisioning(store: Store, accountId: string, patch: Record<string, any>) {
  const base = unscoped(store);
  const id = detId("tenant-prov", accountId);
  const cur = await base.get("tenant_provisionings", id);
  if (cur) return base.update("tenant_provisionings", id, patch);
  try {
    return await base.create("tenant_provisionings", { accountId, ...patch }, id);
  } catch (e) {
    if (isConflict(e)) return base.update("tenant_provisionings", id, patch);
    throw e;
  }
}

/**
 * Executa uma etapa da implantação registrando o resultado. Com `current`, uma etapa JÁ CONCLUÍDA não é refeita: a
 * retomada (reenvio do POST /empresas com outra chave, ou /implantacao/retomar) só completa o que falta e nunca volta
 * módulos, unidade inicial ou situação alterados depois pelas operações próprias.
 */
async function runStep<T>(store: Store, accountId: string, etapa: StepKey, fn: () => Promise<T>, current?: () => Promise<T>): Promise<T> {
  if (current) {
    const prov = await loadProvisioning(store, accountId);
    if (((prov?.steps ?? []) as ProvisionStep[]).some((s) => s.etapa === etapa && s.estado === "concluida")) return current();
  }
  const mark = async (estado: StepState, erro: string | null) => {
    const prov = await loadProvisioning(store, accountId);
    const steps: ProvisionStep[] = [...((prov?.steps ?? []) as ProvisionStep[])];
    const i = steps.findIndex((s) => s.etapa === etapa);
    const prev = i >= 0 ? steps[i] : null;
    // reexecução de etapa já concluída (reenvio/retomada) é só conferência: mantém a data da primeira conclusão
    const concluidaEm = estado === "concluida" ? (prev?.estado === "concluida" && prev.concluidaEm ? prev.concluidaEm : nowIso()) : (prev?.concluidaEm ?? null);
    const next: ProvisionStep = { etapa, estado, concluidaEm, erro, tentativas: (prev?.tentativas ?? 0) + (estado === "pendente" ? 0 : 1) };
    if (i >= 0) steps[i] = next;
    else steps.push(next);
    await saveProvisioning(store, accountId, { steps, ...(estado === "falhou" ? { status: "falhou", lastError: `${etapa}: ${erro}` } : {}) });
  };
  try {
    const out = await fn();
    await mark("concluida", null);
    return out;
  } catch (e) {
    const msg = e instanceof ServiceError || (e as Error)?.name === "BusinessError" ? (e as Error).message : `erro inesperado (${String((e as Error)?.message ?? e).slice(0, 200)})`;
    await mark("falhou", msg).catch(() => undefined);
    throw e;
  }
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function deliverInvite(companyId: string, company: Doc, user: Doc, token: string, expiresAt: string, entrega: "interos" | "erp", origin: string) {
  const link = `${origin.replace(/\/$/, "")}/convite/${token}`;
  if (entrega === "interos") return { link, entrega: "interos", entregue: null as boolean | null, canal: "interos", detalhe: "Link devolvido ao Interos para entrega." };
  const { sendEmail } = await import("@/lib/core/email");
  const name = company.tradeName || company.name;
  const sent = await sendEmail(companyId, {
    to: user.email,
    subject: `Seu acesso ao ERP — ${name}`,
    html: `<p>Olá, ${user.name}.</p><p>Você foi cadastrado(a) como administrador(a) do ERP de <b>${name}</b>.</p><p>Para definir sua senha e ativar o acesso, abra: <a href="${link}">${link}</a></p><p>O link vale até ${new Date(expiresAt).toLocaleString("pt-BR", { timeZone: DEFAULT_TZ })} e só pode ser usado uma vez.</p>`,
  });
  // sem canal de e-mail no ERP, o link volta ao Interos (ninguém fica sem o convite)
  return { link: sent.delivered ? null : link, entrega: "erp", entregue: sent.delivered, canal: sent.channel, detalhe: sent.delivered ? "E-mail entregue ao provedor." : `E-mail não enviado (${sent.message ?? sent.channel}); link devolvido ao Interos.` };
}

/**
 * Gera o link de convite (uso único, com validade) e o entrega; um link anterior deixa de valer. Só marca o convite
 * como enviado depois da entrega — se ela cair no meio, a retomada da implantação gera e entrega outro.
 */
async function issueInvite(store: Store, actor: ServiceActor, company: Doc, user: Doc, entrega: "interos" | "erp", origin: string) {
  const base = unscoped(store);
  const days = await getSetting<number>(base, company.id, null, "users.inviteExpiryDays", 7);
  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  await base.update("users", user.id, { inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt });
  const d = await deliverInvite(company.id, company, user, token, expiresAt, entrega, origin);
  const after = await base.update("users", user.id, { inviteSentAt: nowIso(), inviteDelivery: d.detalhe, invitedBy: `servico:${actor.clientId}` });
  return { user: after, invite: { ...d, expiraEm: expiresAt } };
}

/**
 * Administrador da empresa: usuário novo com convite (uso único, com validade) ou, se o e-mail já tem acesso ao ERP,
 * o vínculo com a empresa e o perfil de administrador (a pessoa entra com a senha que já tem).
 * Reenvio da implantação: convite já entregue e ainda pendente é mantido (o link anterior continua valendo; para um
 * link novo, use "reenviar convite"); convite que nunca chegou a ser entregue (queda no meio) é gerado e entregue agora.
 */
async function ensureTenantAdmin(store: Store, actor: ServiceActor, company: Doc, input: { nome: string; email: string; telefone?: string | null }, entrega: "interos" | "erp", origin: string) {
  const base = unscoped(store);
  const role = await adminRoleOf(store, company);
  const email = input.email.trim().toLowerCase();
  const id = detId("tenant-admin", company.id, email);
  const ctx = serviceCtx(store, actor, company.id);
  const prev = await base.get("users", id);
  if (prev) {
    if (prev.status !== "invited" || prev.inviteSentAt) return { user: prev, invite: null };
    // a implantação caiu entre criar o acesso e entregar o convite: o link nunca saiu — gera outro e entrega (a conta é a mesma)
    const r = await issueInvite(store, actor, company, prev, entrega, origin);
    await audit(ctx, { module: "admin", action: "user.invite", entityType: "user", entityId: prev.id, summary: `Convite do administrador ${prev.name} entregue na retomada da implantação (${r.invite.detalhe})`, after: { email, inviteExpiresAt: r.invite.expiraEm }, related: [`role:${role.id}`] });
    return r;
  }
  const existing = await findOne(base, "users", [["eq", "email", email]]);
  if (existing) {
    if (existing.isAdmin || existing.isDemo || existing.loginDisabled) throw new ServiceError(409, "email_reservado", "Este e-mail não pode ser usado como administrador da empresa. Informe outro e-mail.");
    // recusa antes de gravar qualquer coisa: uma resposta de erro não deixa vínculo para trás
    if (existing.status === "suspended" || existing.status === "inactive") throw new ServiceError(409, "usuario_bloqueado", "O e-mail informado pertence a um acesso suspenso ou inativo no ERP. Informe outro e-mail ou peça a reativação.");
    const member = (existing.companyIds ?? []).includes(company.id);
    const roleByCompany = { ...(existing.roleByCompany ?? {}), [company.id]: role.id };
    if (!member || roleByCompany[company.id] !== (existing.roleByCompany ?? {})[company.id]) {
      await base.update("users", existing.id, { companyIds: [...new Set([...(existing.companyIds ?? []), company.id])], roleByCompany });
      await audit(ctx, { module: "admin", action: "user.grant_admin", entityType: "user", entityId: existing.id, summary: `${existing.name} vinculado(a) à empresa como administrador(a) pelo Interos`, related: [`role:${role.id}`] });
    }
    const fresh = (await base.get("users", existing.id))!;
    return { user: fresh, invite: null as null | Awaited<ReturnType<typeof deliverInvite>> & { expiraEm: string } };
  }
  let user: Doc;
  try {
    user = await base.create(
      "users",
      {
        name: input.nome.trim(), email, login: null, phone: onlyDigits(input.telefone ?? "") || null, status: "invited", isAdmin: false, roleId: role.id,
        roleByCompany: { [company.id]: role.id }, companyIds: [company.id], branchIds: [], inviteTokenHash: null, inviteExpiresAt: null,
        invitedBy: ctx.user.id, createdBy: ctx.user.id,
      },
      id,
    );
  } catch (e) {
    if (!isConflict(e)) throw e;
    const again = await base.get("users", id);
    if (again) return { user: again, invite: null };
    throw new ServiceError(409, "conflito", "E-mail já cadastrado por outra solicitação simultânea. Consulte o estado da empresa.");
  }
  const r = await issueInvite(store, actor, company, user, entrega, origin);
  await audit(ctx, { module: "admin", action: "user.invite", entityType: "user", entityId: user.id, summary: `Convite do administrador ${user.name} criado pelo Interos (${r.invite.detalhe})`, after: { email, inviteExpiresAt: r.invite.expiraEm }, related: [`role:${role.id}`] });
  return r;
}

async function applyContract(store: Store, actor: ServiceActor, company: Doc, modules: string[], contrato: { referencia?: unknown; plano?: unknown } | null | undefined) {
  const base = unscoped(store);
  // uma referência só (pendência 4): com licença v2 aplicada, os módulos seguem o retrato de licença
  const { licenseId } = await import("../licensing/license");
  const lic = await base.get("company_licenses", licenseId(company.id));
  if (lic && lic.licenseVersion > 0)
    throw new ServiceError(409, "licenca_governa", "Os módulos desta empresa seguem a licença v2 aplicada: altere pelo retrato de licença (PUT /api/interos/v2/companies/{id}/license). O provisionamento cuida só da conta, da unidade inicial e dos administradores.", { idEmpresa: company.id, versaoLicenca: lic.licenseVersion });
  const before = contractOf(company);
  const contract = { modules: [...modules].sort(), reference: str(contrato?.referencia, 100) ?? before?.reference ?? null, plan: str(contrato?.plano, 60) ?? before?.plan ?? null, updatedAt: nowIso(), updatedBy: `servico:${actor.clientId}` };
  const after = await base.update("companies", company.id, { contract });
  // recursos governados pelo contrato: ligados se contratados, desligados se não
  for (const m of CONTRACT_MODULES) for (const f of m.features) await setSetting(base, company.id, null, `feature.${f}`, modules.includes(m.key), `servico:${actor.clientId}`);
  const changed = JSON.stringify(before?.modules ?? null) !== JSON.stringify(contract.modules) || before?.reference !== contract.reference || before?.plan !== contract.plan;
  if (changed)
    await audit(serviceCtx(store, actor, company.id), { module: "admin", action: "company.contract", entityType: "company", entityId: company.id, summary: `Módulos contratados definidos pelo Interos: ${contract.modules.join(", ")}`, before: before ?? null, after: contract });
  await syncModulesFromContract(store, actor, after, contract.modules);
  return after;
}

/**
 * Habilitação real a partir do contrato amplo (pendência 4: o módulo amplo é tradução das unidades v2). Empresa sem
 * estado de módulos nasce com o controle aplicado e SÓ com o contratado — nunca com a linha de base "legada" (que
 * ligaria tudo, inclusive unidades ainda não homologadas, e criaria direito preservado que a empresa nunca teve).
 * Empresa com controle já aplicado recebe a diferença; empresa anterior (modo legacy) só tem os perfis restringidos.
 */
async function syncModulesFromContract(store: Store, actor: ServiceActor, company: Doc, modules: string[]) {
  const base = unscoped(store);
  const { v1KeysForContract } = await import("./contract");
  const { loadCompanyModules } = await import("@/lib/modules/access");
  const { provisionModules } = await import("../modules/baseline");
  const keys = await v1KeysForContract(modules, company.kind ?? "retail");
  const doc = await loadCompanyModules(base, company.id);
  const who = `interos:${actor.clientId}`;
  if (!doc) {
    await provisionModules(base, company.id, keys, who, "enforced");
    return;
  }
  if (doc.mode === "legacy") return;
  const { UNITS_V2 } = await import("@/lib/modules/units-v2.generated");
  const preserved = new Set(UNITS_V2.filter((u) => u.v1Key && !u.sellable).map((u) => u.v1Key!));
  const want = new Set(keys);
  const isOn = (state: string | undefined) => state === "enabled" || state === "scheduled_off";
  const changes = [
    ...keys.filter((k) => !isOn(doc.modules[k]?.state)).map((k) => ({ module: k, action: "enable" as const })),
    ...Object.entries(doc.modules)
      .filter(([k, e]) => isOn(e.state) && !want.has(k) && contractModuleOfV1Key(k) && !preserved.has(k))
      .map(([k]) => ({ module: k, action: "disable" as const, history: "read" as const })),
  ];
  if (!changes.length) return;
  const { applyChanges } = await import("../modules/changes");
  await applyChanges(base, { companyId: company.id, changes, cascade: true }, { actor: who, actorType: "provisioning", reason: "Módulos contratados definidos pelo Interos (provisionamento)." });
}

// ─── operações ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProvisionOutcome {
  status: 200 | 201;
  view: Awaited<ReturnType<typeof tenantView>>;
  invite: (Awaited<ReturnType<typeof deliverInvite>> & { expiraEm: string }) | null;
  /** a empresa já estava criada: devolvida como está, nada foi alterado */
  existing?: boolean;
}

/** Cria (ou retoma a criação de) uma empresa contratante. */
export async function provisionTenant(store: Store, actor: ServiceActor, body: any, origin: string): Promise<ProvisionOutcome> {
  const issues: FieldIssue[] = [];
  const accountId = checkAccount(body?.contaInterosId, issues);
  const e = body?.empresa;
  if (!e || typeof e !== "object") issues.push({ campo: "empresa", mensagem: "Informe os dados da empresa." });
  const kindIn = String(e?.tipo ?? "varejo");
  const kind = KIND_IN[kindIn];
  if (!kind) issues.push({ campo: "empresa.tipo", mensagem: 'Tipo deve ser "varejo" ou "escritorio_contabil".' });
  if (!str(e?.razaoSocial)) issues.push({ campo: "empresa.razaoSocial", mensagem: "Informe a razão social." });
  checkCnpj("empresa.cnpj", e?.cnpj, issues, true);
  const regime = str(e?.regimeTributario, 20) ?? "simples";
  if (!REGIMES.some((r) => r.value === regime)) issues.push({ campo: "empresa.regimeTributario", mensagem: `Regime deve ser um de: ${REGIMES.map((r) => r.value).join(", ")}.` });
  if (e?.email != null && !EMAIL_RE.test(String(e.email).trim())) issues.push({ campo: "empresa.email", mensagem: "E-mail da empresa inválido." });
  if (e?.cnae != null && !/^\d{7}$/.test(onlyDigits(e.cnae))) issues.push({ campo: "empresa.cnae", mensagem: "CNAE deve ter 7 dígitos." });
  checkAddress("empresa.endereco", e?.endereco, issues);
  checkUnit(body?.unidadeInicial, issues);
  const modules = checkModules("modulos", body?.modulos, kind ?? "retail", issues);
  checkAdmin("administrador", body?.administrador, issues);
  const entrega = checkDelivery(body?.entregaConvite, issues);
  if (issues.length) throw validationError(issues);

  const base = unscoped(store);
  const cnpj = onlyDigits(e.cnpj);
  // uma conta ↔ uma empresa; o CNPJ não pode pertencer a outra empresa do ERP
  const byAccount = await findOne(base, "companies", [["eq", "interosAccountId", accountId]]);
  if (byAccount && byAccount.cnpj !== cnpj) throw new ServiceError(409, "conta_ja_vinculada", "Esta conta do Interos já tem outra empresa no ERP. Consulte-a pelo idEmpresa informado.", { idEmpresa: byAccount.id });
  const byCnpj = await findOne(base, "companies", [["eq", "cnpj", cnpj]]);
  if (byCnpj && byCnpj.interosAccountId !== accountId)
    throw new ServiceError(409, "cnpj_em_uso", "Já existe uma empresa com este CNPJ no ERP. Para trazê-la ao Interos, use a vinculação (POST /empresas/vincular) com o código gerado pelo administrador dela.");
  const prev = await loadProvisioning(store, accountId);
  if (prev && prev.operation === "vincular") throw new ServiceError(409, "conta_ja_vinculada", "Esta conta do Interos foi vinculada a uma empresa existente; use as operações dessa empresa.", { idEmpresa: prev.targetCompanyId });
  // empresa já criada (implantação concluída, ou criada antes do registro de etapas): devolvida COMO ESTÁ. Um POST
  // /empresas com outra Idempotency-Key nunca refaz a criação — não volta módulos, unidade inicial nem situação
  // (inclusive a de uma empresa inativada depois). Para mudar, use as operações próprias.
  if (byAccount && (!prev || prev.status === "concluida")) return { status: 200, view: await tenantView(store, byAccount.id), invite: null, existing: true };
  await saveProvisioning(store, accountId, {
    operation: "criar", status: "em_andamento", attempts: (prev?.attempts ?? 0) + 1, clientId: actor.clientId, lastRequestId: actor.requestId, startedAt: prev?.startedAt ?? nowIso(), lastError: null,
    input: { empresa: { ...e, cnpj }, unidadeInicial: body.unidadeInicial ?? null, modulos: modules, administrador: { nome: body.administrador.nome, email: String(body.administrador.email).trim().toLowerCase() }, entregaConvite: entrega, contrato: body.contrato ?? null },
  });
  const created = !byAccount;

  const company = await runStep(store, accountId, "empresa", async () => {
    const key = `tenant:${accountId}`;
    const addr = addressOut(e.endereco);
    const unitName = str(body.unidadeInicial?.nome, 120) ?? "Matriz";
    const { company: co } = await createCompanyWithDefaults(base, {
      key, name: str(e.razaoSocial)!, tradeName: str(e.nomeFantasia) ?? str(e.razaoSocial)!, cnpj, regime, uf: addr.uf, cityName: addr.cityName, cityCode: addr.cityCode,
      branchName: unitName, createdBy: `servico:${actor.clientId}`, kind,
    }).catch((err) => {
      if ((err as Error)?.name === "BusinessError" && (err as any).code === "duplicate") throw new ServiceError(409, "cnpj_em_uso", "Já existe uma empresa com este CNPJ no ERP. Use a vinculação com o código do administrador dela.");
      throw err;
    });
    const patch = {
      name: str(e.razaoSocial)!, tradeName: str(e.nomeFantasia) ?? str(e.razaoSocial)!, cnpj, ie: str(e.inscricaoEstadual, 30)?.toUpperCase() ?? null, im: str(e.inscricaoMunicipal, 30),
      regime, crt: REGIMES.find((r) => r.value === regime)!.crt, cnae: onlyDigits(e.cnae) || null, email: str(e.email)?.toLowerCase() ?? null, phone: onlyDigits(e.telefone) || null,
      address: addr, interosAccountId: accountId, interosLinkedAt: co.interosLinkedAt ?? nowIso(),
      // empresa recém-criada nasce ativa; uma já existente mantém a situação que tem (suspensa, inativa…)
      ...(created ? { status: "active" } : {}),
    };
    const after = await base.update("companies", co.id, patch);
    if (created) await audit(serviceCtx(store, actor, co.id), { module: "admin", action: "company.create", entityType: "company", entityId: co.id, summary: `Empresa ${patch.name} criada pelo Interos (conta ${accountId})`, after: patch });
    await saveProvisioning(store, accountId, { targetCompanyId: co.id });
    return after;
  }, async () => (await findOne(base, "companies", [["eq", "interosAccountId", accountId]]))!);

  await runStep(store, accountId, "unidade_inicial", () => applyInitialUnit(store, actor, company, body.unidadeInicial ?? {}), async () => null);
  const withContract = await runStep(store, accountId, "modulos", () => applyContract(store, actor, company, modules, body.contrato), async () => (await base.get("companies", company.id))!);
  const admin = await runStep(store, accountId, "administrador", () => ensureTenantAdmin(store, actor, withContract, body.administrador, entrega, origin));
  await saveProvisioning(store, accountId, { status: "concluida", finishedAt: nowIso(), lastError: null, adminUserId: admin.user.id });
  return { status: created ? 201 : 200, view: await tenantView(store, company.id), invite: admin.invite };
}

/** Ajusta a unidade inicial (matriz criada na implantação). */
async function applyInitialUnit(store: Store, actor: ServiceActor, company: Doc, u: any) {
  const base = unscoped(store);
  const branches = await listAll(base, "branches", { filters: [["eq", "companyId", company.id]] });
  const initialId = detId("setup", `tenant:${company.interosAccountId}`, "branches", "matriz");
  const branch = branches.find((b) => b.id === initialId) ?? branches.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")))[0];
  if (!branch) throw new ServiceError(500, "erro_interno", "Unidade inicial não encontrada. Retome a implantação.");
  const addr = u.endereco ? addressOut(u.endereco) : (company.address ?? null);
  const patch: Record<string, any> = {};
  if (str(u.nome, 120)) patch.name = str(u.nome, 120);
  if (u.codigo != null) patch.code = String(u.codigo).toUpperCase();
  if (u.cnpj != null) patch.cnpj = onlyDigits(u.cnpj) || null;
  if (u.inscricaoEstadual != null) patch.ie = str(u.inscricaoEstadual, 30)?.toUpperCase() ?? null;
  if (addr) Object.assign(patch, { address: addr, uf: addr.uf || null, cityCode: addr.cityCode || null, cityName: addr.cityName || null });
  if (u.telefone != null) patch.phone = onlyDigits(u.telefone) || null;
  if (u.email != null) patch.email = str(u.email)?.toLowerCase() ?? null;
  if (u.fusoHorario != null) patch.timezone = String(u.fusoHorario);
  if (!Object.keys(patch).length) return branch;
  if (patch.code && branches.some((b) => b.id !== branch.id && b.code === patch.code)) throw new ServiceError(409, "conflito", `Já existe unidade com o código ${patch.code} nesta empresa.`);
  const after = await base.update("branches", branch.id, patch);
  await audit(serviceCtx(store, actor, company.id), { module: "admin", action: "branch.update", entityType: "branch", entityId: branch.id, summary: `Unidade inicial ${after.name} ajustada pelo Interos`, after: patch });
  return after;
}

export async function updateInitialUnit(store: Store, actor: ServiceActor, companyId: string, body: any) {
  const company = await linkedCompany(store, companyId);
  const issues: FieldIssue[] = [];
  checkUnit(body, issues);
  if (issues.length) throw validationError(issues);
  await applyInitialUnit(store, actor, company, body ?? {});
  return tenantView(store, company.id);
}

export async function setTenantModules(store: Store, actor: ServiceActor, companyId: string, body: any) {
  const company = await linkedCompany(store, companyId);
  const issues: FieldIssue[] = [];
  const modules = checkModules("modulos", body?.modulos, company.kind ?? "retail", issues);
  if (issues.length) throw validationError(issues);
  await applyContract(store, actor, company, modules, body?.contrato);
  return tenantView(store, company.id);
}

/** Convida (ou vincula) um administrador da empresa — ex.: o inicial saiu e outro assume. */
export async function inviteTenantAdmin(store: Store, actor: ServiceActor, companyId: string, body: any, origin: string) {
  const company = await linkedCompany(store, companyId);
  const issues: FieldIssue[] = [];
  checkAdmin("administrador", body?.administrador ?? body, issues);
  const entrega = checkDelivery(body?.entregaConvite, issues);
  if (issues.length) throw validationError(issues);
  assertOperable(company);
  const r = await ensureTenantAdmin(store, actor, company, body?.administrador ?? body, entrega, origin);
  return { view: await tenantView(store, company.id), user: r.user, invite: r.invite };
}

/** Novo link de convite para um administrador ainda não ativado (o link anterior deixa de valer). */
export async function resendTenantInvite(store: Store, actor: ServiceActor, companyId: string, body: any, origin: string) {
  const company = await linkedCompany(store, companyId);
  const issues: FieldIssue[] = [];
  const entrega = checkDelivery(body?.entregaConvite, issues);
  if (body?.idUsuario == null && body?.email == null) issues.push({ campo: "idUsuario", mensagem: "Informe idUsuario ou email do administrador convidado." });
  if (issues.length) throw validationError(issues);
  assertOperable(company);
  const base = unscoped(store);
  const u = body.idUsuario ? await base.get("users", String(body.idUsuario)) : await findOne(base, "users", [["eq", "email", String(body.email).trim().toLowerCase()]]);
  if (!u || !(u.companyIds ?? []).includes(company.id) || u.isAdmin) throw notFound("Usuária(o)");
  if (u.status !== "invited") throw new ServiceError(409, "convite_ja_aceito", "Este usuário já ativou o acesso: não há convite a reenviar. Para recuperar a senha, o próprio usuário usa “Esqueci minha senha”.");
  const r = await issueInvite(store, actor, company, u, entrega, origin);
  await audit(serviceCtx(store, actor, company.id), { module: "admin", action: "user.invite_resend", entityType: "user", entityId: u.id, summary: `Convite de ${u.name} reenviado pelo Interos (${r.invite.detalhe}); link anterior invalidado`, after: { inviteExpiresAt: r.invite.expiraEm } });
  return { view: await tenantView(store, company.id), user: r.user, invite: r.invite };
}

function assertOperable(company: Doc) {
  if (company.status === "suspended") throw new ServiceError(423, "empresa_suspensa", "Empresa suspensa: reative antes desta operação.");
  if (company.status === "inactive") throw new ServiceError(423, "empresa_inativa", "Empresa inativada pelo próprio cliente no ERP.");
}

// ─── vínculo de empresa existente ─────────────────────────────────────────────────────────────────────────────────

export const LINK_CODE_HOURS = 72;

/** Código de vínculo gerado no ERP pelo administrador da empresa (prova de que a conta autoriza o Interos). */
export function newLinkCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}

export function normalizeLinkCode(v: unknown): string {
  return String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Vincula uma empresa que já usa o ERP a uma conta do Interos. */
export async function linkExistingTenant(store: Store, actor: ServiceActor, body: any) {
  const issues: FieldIssue[] = [];
  const accountId = checkAccount(body?.contaInterosId, issues);
  if (!/^[A-Za-z0-9]{8,64}$/.test(String(body?.idEmpresa ?? ""))) issues.push({ campo: "idEmpresa", mensagem: "Informe o idEmpresa (ID ERP mostrado ao administrador da empresa)." });
  checkCnpj("cnpj", body?.cnpj, issues, true);
  if (normalizeLinkCode(body?.codigoVinculo).length !== 10) issues.push({ campo: "codigoVinculo", mensagem: "Informe o código de vínculo gerado pelo administrador da empresa no ERP (formato XXXXX-XXXXX)." });
  let modules: string[] | null = null;
  if (body?.modulos != null) modules = checkModules("modulos", body.modulos, "retail", []).length ? body.modulos.map(String) : null;
  if (issues.length) throw validationError(issues);
  const base = unscoped(store);
  const company = await base.get("companies", String(body.idEmpresa));
  // mesma resposta para empresa inexistente, CNPJ diferente ou código errado: o Interos não descobre empresas por tentativa
  const denied = () => new ServiceError(409, "identidade_nao_confere", "Não foi possível confirmar a identidade da empresa: confira idEmpresa, CNPJ e código de vínculo (o código vale 72 horas e só uma vez).");
  if (!company || company.cnpj !== onlyDigits(body.cnpj) || company.isDemo) throw denied();
  // o CÓDIGO é conferido antes de qualquer outra resposta (correção 15): sem um código válido, toda tentativa recebe a
  // mesma recusa — nem "já vinculada" nem "conta já vinculada" revelam algo sobre a empresa
  const given = sha256(normalizeLinkCode(body.codigoVinculo));
  const codeOk = Boolean(company.linkCodeHash && company.linkCodeHash === given && company.linkCodeExpiresAt && company.linkCodeExpiresAt > nowIso());
  // reenvio do mesmo vínculo (mesma conta e o mesmo código, já usado nele): devolve a empresa como está
  const sameLinkAgain = company.interosAccountId === accountId && company.linkCodeUsedHash === given;
  if (!codeOk && !sameLinkAgain) throw denied();
  if (company.interosAccountId === accountId) return { status: 200 as const, view: await tenantView(store, company.id) };
  if (company.interosAccountId) throw new ServiceError(409, "empresa_ja_vinculada", "Esta empresa já está vinculada a outra conta do Interos. A troca exige desvincular a conta atual.");
  const other = await findOne(base, "companies", [["eq", "interosAccountId", accountId]]);
  if (other) throw new ServiceError(409, "conta_ja_vinculada", "Esta conta do Interos já tem uma empresa no ERP.", { idEmpresa: other.id });
  if (modules) {
    const bad = invalidContractModules(modules, company.kind);
    if (bad.length) throw validationError([{ campo: "modulos", mensagem: `Módulo(s) inválido(s) para este tipo de empresa: ${bad.join(", ")}.` }]);
  }
  await saveProvisioning(store, accountId, { operation: "vincular", status: "em_andamento", attempts: 1, clientId: actor.clientId, lastRequestId: actor.requestId, startedAt: nowIso(), targetCompanyId: company.id, input: { idEmpresa: company.id, modulos: modules } });
  await runStep(store, accountId, "vinculo", async () => {
    try {
      await base.update("companies", company.id, { interosAccountId: accountId, interosLinkedAt: nowIso(), linkCodeHash: null, linkCodeExpiresAt: null, linkCodeUsedAt: nowIso(), linkCodeUsedHash: given });
    } catch (err) {
      if (isConflict(err)) throw new ServiceError(409, "conta_ja_vinculada", "Esta conta do Interos já tem uma empresa no ERP.");
      throw err;
    }
    await audit(serviceCtx(store, actor, company.id), { module: "admin", action: "company.interos_link", entityType: "company", entityId: company.id, summary: `Empresa vinculada à conta ${accountId} do Interos (código de vínculo confirmado)` });
  });
  if (modules) await runStep(store, accountId, "modulos", async () => applyContract(store, actor, (await base.get("companies", company.id))!, modules!, body.contrato));
  await saveProvisioning(store, accountId, { status: "concluida", finishedAt: nowIso() });
  return { status: 201 as const, view: await tenantView(store, company.id) };
}

// ─── suspensão e reativação ───────────────────────────────────────────────────────────────────────────────────────

export async function suspendTenant(store: Store, actor: ServiceActor, companyId: string, body: any) {
  const company = await linkedCompany(store, companyId);
  const issues: FieldIssue[] = [];
  const modo = String(body?.modo ?? "");
  if (modo !== "bloqueio" && modo !== "somente_leitura") issues.push({ campo: "modo", mensagem: 'modo deve ser "bloqueio" (ninguém entra) ou "somente_leitura" (entra, consulta e exporta, sem gravar).' });
  if (!str(body?.motivo, 300)) issues.push({ campo: "motivo", mensagem: "Informe o motivo da suspensão (fica no histórico da empresa)." });
  if (issues.length) throw validationError(issues);
  const base = unscoped(store);
  const suspension = { mode: modo, reason: str(body.motivo, 300), contractRef: str(body.referenciaContrato, 100), at: nowIso(), by: `servico:${actor.clientId}`, requestId: actor.requestId };
  if (company.status === "suspended" && company.suspension?.mode === modo) return tenantView(store, company.id);
  const history = [...((company.suspensionHistory ?? []) as unknown[]), { event: "suspensao", ...suspension, previousStatus: company.status ?? "active" }].slice(-50);
  await base.update("companies", company.id, { status: "suspended", suspension, suspensionHistory: history, statusBeforeSuspension: company.status === "suspended" ? (company.statusBeforeSuspension ?? "active") : (company.status ?? "active") });
  const ended = modo === "bloqueio" ? await revokeSessionsOfCompany(base, company.id) : 0;
  const held = await holdCompanyJobs(base, company.id, `Empresa suspensa pelo Interos (${modo})`);
  await audit(serviceCtx(store, actor, company.id), {
    module: "admin", action: "company.suspend", entityType: "company", entityId: company.id,
    summary: `Empresa suspensa pelo Interos (${modo === "bloqueio" ? "acesso bloqueado" : "somente leitura"}): ${ended} sessão(ões) encerrada(s), ${held} tarefa(s) pendente(s) retida(s). Histórico preservado.`,
    reason: suspension.reason, after: suspension,
  });
  return tenantView(store, company.id);
}

export async function reactivateTenant(store: Store, actor: ServiceActor, companyId: string, body: any) {
  const company = await linkedCompany(store, companyId);
  if (company.status !== "suspended") return tenantView(store, company.id);
  const base = unscoped(store);
  const restore = company.statusBeforeSuspension === "inactive" ? "inactive" : "active";
  const history = [...((company.suspensionHistory ?? []) as unknown[]), { event: "reativacao", reason: str(body?.motivo, 300), contractRef: str(body?.referenciaContrato, 100), at: nowIso(), by: `servico:${actor.clientId}`, requestId: actor.requestId }].slice(-50);
  await base.update("companies", company.id, { status: restore, suspension: null, suspensionHistory: history, statusBeforeSuspension: null });
  const released = await releaseCompanyJobs(base, company.id);
  await audit(serviceCtx(store, actor, company.id), { module: "admin", action: "company.reactivate", entityType: "company", entityId: company.id, summary: `Empresa reativada pelo Interos (${released} tarefa(s) liberada(s))`, reason: str(body?.motivo, 300) });
  return tenantView(store, company.id);
}

/** Retoma uma implantação que falhou no meio, com a entrada guardada (sem o Interos reenviar o corpo). */
export async function resumeProvisioning(store: Store, actor: ServiceActor, companyId: string, origin: string) {
  const company = await linkedCompany(store, companyId);
  const prov = await loadProvisioning(store, company.interosAccountId);
  if (!prov || prov.operation !== "criar") throw new ServiceError(409, "nada_a_retomar", "Esta empresa não tem implantação de criação a retomar.");
  if (prov.status === "concluida") return { status: 200 as const, view: await tenantView(store, company.id), invite: null };
  const input = prov.input ?? {};
  return provisionTenant(store, actor, { contaInterosId: company.interosAccountId, ...input }, origin);
}

/** Lista as empresas vinculadas ao Interos (sincronização). */
export async function listLinkedTenants(store: Store, query: URLSearchParams, onlyCompanies: string[] | null = null) {
  const base = unscoped(store);
  const limit = Math.min(100, Math.max(1, Number(query.get("limite") ?? 50) || 50));
  const account = query.get("contaInterosId");
  const filters: any[] = account ? [["eq", "interosAccountId", account]] : [["notNull", "interosAccountId"]];
  // credencial restrita (empresas do piloto): só as empresas dela
  if (onlyCompanies) filters.push(["eq", "id", onlyCompanies]);
  const all = (await listAll(base, "companies", { filters })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const after = query.get("cursor");
  const page = (after ? all.filter((c) => c.id > after) : all).slice(0, limit);
  const items = [];
  for (const c of page) items.push(await tenantView(store, c.id));
  return { itens: items, proximoCursor: page.length === limit && all.some((c) => c.id > page[page.length - 1].id) ? page[page.length - 1].id : null };
}
