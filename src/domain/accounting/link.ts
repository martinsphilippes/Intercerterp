import crypto from "node:crypto";
import { findOne, listAll, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { readOnly } from "@/lib/db/read-only";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso, today, addMonths, monthStart, monthEnd } from "@/lib/dates";
import { getClient } from "./clients";
import { requireFirm } from "./common";

/**
 * Vínculo cliente contábil ↔ empresa que usa o ERP, com CONSENTIMENTO das duas partes:
 *  1. O escritório emite um código de vínculo para o cliente (válido por 30 dias; só o hash é guardado).
 *  2. O administrador da empresa no ERP informa o código em Administração → Integrações → Área da contabilidade.
 *     O CNPJ da empresa precisa coincidir com o do cliente contábil (quando ambos existem).
 *  3. Com o vínculo ativo: a situação fiscal da empresa fica visível ao escritório (somente leitura) e o pacote
 *     mensal de XMLs é entregue na caixa de entrada do escritório automaticamente.
 * Qualquer lado desfaz o vínculo; o histórico (entregas já recebidas) é preservado.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
export const LINK_CODE_DAYS = 30;

function newLinkCode() {
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export const normalizeLinkCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Escritório: emite (ou reemite) o código de vínculo. Devolve o código em claro UMA vez. */
export async function issueLinkCode(ctx: Ctx, clientId: string): Promise<{ code: string; expiresAt: string }> {
  requireAction(ctx, "accounting.link");
  await requireFirm(ctx);
  const client = await getClient(ctx, clientId);
  assert(client.personType === "PJ", "Somente pessoa jurídica pode ser vinculada a uma empresa do ERP.");
  if (client.linkStatus === "active") throw new BusinessError("Este cliente já está vinculado a uma empresa do ERP.", "linked");
  if (client.status === "closed") throw new BusinessError("Cliente encerrado não pode ser vinculado.", "closed");
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_DAYS * 86400000).toISOString();
  await ctx.store.update("accounting_clients", clientId, { linkStatus: "pending", linkCodeHash: sha256(normalizeLinkCode(code)), linkCodeExpiresAt: expiresAt, linkRequestedBy: ctx.user.id });
  await audit(ctx, { module: "accounting", action: "client.link_code", entityType: "accounting_client", entityId: clientId, summary: `Código de vínculo emitido para ${client.name} (válido até ${expiresAt.slice(0, 10)})` });
  return { code, expiresAt };
}

/** Escritório: cancela um código pendente. */
export async function cancelLinkCode(ctx: Ctx, clientId: string): Promise<Doc> {
  requireAction(ctx, "accounting.link");
  const client = await getClient(ctx, clientId);
  if (client.linkStatus !== "pending") return client;
  const after = await ctx.store.update("accounting_clients", clientId, { linkStatus: "none", linkCodeHash: null, linkCodeExpiresAt: null, linkRequestedBy: null });
  await audit(ctx, { module: "accounting", action: "client.link_cancel", entityType: "accounting_client", entityId: clientId, summary: `Código de vínculo de ${client.name} cancelado` });
  return after;
}

/**
 * Lado da EMPRESA no ERP: aceita o código do escritório. Exige "Configurar integrações" na empresa ativa.
 * Grava o vínculo no cliente contábil (empresa do escritório) e na integração "accounting" da empresa.
 */
export async function acceptAccountingLink(ctx: Ctx, code: string): Promise<{ client: Doc; firm: Doc }> {
  requireAction(ctx, "admin.integrations");
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  if (company.kind === "accounting") throw new BusinessError("Um escritório não pode ser vinculado como cliente de outro escritório por aqui.", "not_allowed");
  const norm = normalizeLinkCode(code ?? "");
  assert(norm.length === 10, "Informe o código de vínculo completo (10 caracteres).");
  const base = unscoped(ctx.store);
  // busca pelo hash do código: nunca lista clientes de escritórios
  const client = await findOne(base, "accounting_clients", [["eq", "linkCodeHash", sha256(norm)]]);
  if (!client || client.linkStatus !== "pending") throw new BusinessError("Código de vínculo inválido ou já utilizado. Peça um novo código ao escritório.", "invalid_code");
  if (client.linkCodeExpiresAt && client.linkCodeExpiresAt < nowIso()) throw new BusinessError("Código de vínculo expirado. Peça um novo código ao escritório.", "expired_code");
  if (client.doc && company.cnpj && client.doc !== company.cnpj) throw new BusinessError("O código pertence a um cadastro com CNPJ diferente do desta empresa. Confirme com o escritório.", "cnpj_mismatch");
  const already = await findOne(base, "accounting_clients", [["eq", "linkedCompanyId", ctx.companyId], ["eq", "linkStatus", "active"]]);
  if (already && already.id !== client.id) throw new BusinessError("Esta empresa já está vinculada a um escritório. Desfaça o vínculo atual antes de aceitar outro.", "already_linked");
  const firm = await base.getOrThrow("companies", client.companyId);
  const linkedAt = nowIso();
  const updated = await base.update("accounting_clients", client.id, { linkedCompanyId: ctx.companyId, linkStatus: "active", linkedAt, linkedBy: ctx.user.id, linkCodeHash: null, linkCodeExpiresAt: null });
  // integração "accounting" da empresa: registra o escritório como destino das entregas
  const { getIntegration, integrationId } = await import("../integrations");
  const integ = await getIntegration(ctx.store, ctx.companyId, null, "accounting");
  const linkCfg = { linkedFirmCompanyId: firm.id, linkedClientId: client.id, linkedFirmName: firm.tradeName || firm.name, linkedAt };
  if (integ) await ctx.store.update("integrations", integ.id, { config: { ...(integ.config ?? {}), ...linkCfg }, enabled: true, status: integ.status === "not_configured" ? "operational" : integ.status, lastTestMessage: `Vinculada ao escritório ${firm.tradeName || firm.name}: entregas registradas na caixa de entrada dele.` });
  else
    await ctx.store.create("integrations", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, scopeKey: `${ctx.companyId}|*|accounting`, kind: "accounting", provider: "export_package", environment: "producao", config: linkCfg, secretRefs: {}, status: "operational", enabled: true, lastTestAt: linkedAt, lastTestMessage: `Vinculada ao escritório ${firm.tradeName || firm.name}: entregas registradas na caixa de entrada dele.` }, integrationId(ctx.companyId, null, "accounting"));
  await audit(ctx, { module: "admin", action: "accounting.link_accept", entityType: "integration", entityId: "accounting", summary: `Empresa vinculada ao escritório ${firm.tradeName || firm.name} (cliente ${client.code})`, after: linkCfg });
  // auditoria também no escritório (contexto técnico da empresa do escritório)
  await base.create("audit_logs", { companyId: firm.id, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: "Empresa vinculada", module: "accounting", action: "client.link_accept", entityType: "accounting_client", entityId: client.id, summary: `${client.name}: vínculo aceito pela empresa ${company.tradeName || company.name} (${company.cnpj ?? "sem CNPJ"})`, before: null, after: { linkedCompanyId: ctx.companyId }, reason: null, result: "success", ip: ctx.ip ?? null, occurredAt: linkedAt, operationId: null, related: [`company:${ctx.companyId}`] }).catch(() => undefined);
  return { client: updated, firm };
}

/** Desfaz o vínculo (pelo escritório ou pela empresa). Entregas já recebidas são preservadas. */
export async function revokeAccountingLink(ctx: Ctx, by: "firm" | "company", clientId?: string): Promise<void> {
  const base = unscoped(ctx.store);
  let client: Doc | null;
  if (by === "firm") {
    requireAction(ctx, "accounting.link");
    client = await getClient(ctx, clientId!);
  } else {
    requireAction(ctx, "admin.integrations");
    client = await findOne(base, "accounting_clients", [["eq", "linkedCompanyId", ctx.companyId], ["eq", "linkStatus", "active"]]);
  }
  if (!client || client.linkStatus !== "active") throw new BusinessError("Não há vínculo ativo.", "not_linked");
  const companyId = client.linkedCompanyId as string;
  await base.update("accounting_clients", client.id, { linkStatus: "revoked", linkCodeHash: null, linkCodeExpiresAt: null });
  const { getIntegration } = await import("../integrations");
  const integ = await getIntegration(base, companyId, null, "accounting");
  if (integ?.config?.linkedClientId === client.id) {
    const cfg = { ...(integ.config ?? {}) };
    delete cfg.linkedFirmCompanyId;
    delete cfg.linkedClientId;
    delete cfg.linkedFirmName;
    delete cfg.linkedAt;
    await base.update("integrations", integ.id, { config: cfg, lastTestMessage: "Vínculo com o escritório desfeito." });
  }
  const who = by === "firm" ? "pelo escritório" : "pela empresa";
  await base.create("audit_logs", { companyId: client.companyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: by === "firm" ? (ctx.user.roleName ?? null) : "Empresa vinculada", module: "accounting", action: "client.link_revoke", entityType: "accounting_client", entityId: client.id, summary: `${client.name}: vínculo com a empresa do ERP desfeito ${who}`, before: { linkedCompanyId: companyId }, after: { linkStatus: "revoked" }, reason: null, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [`company:${companyId}`] }).catch(() => undefined);
  await base.create("audit_logs", { companyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: by === "company" ? (ctx.user.roleName ?? null) : "Escritório contábil", module: "admin", action: "accounting.link_revoke", entityType: "integration", entityId: "accounting", summary: `Vínculo com o escritório contábil desfeito ${who}`, before: { linkedClientId: client.id }, after: null, reason: null, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [] }).catch(() => undefined);
}

/** Vínculo ativo da empresa do ERP (lado da empresa): escritório e cliente, ou null. */
export async function companyAccountingLink(store: Store, companyId: string): Promise<{ client: Doc; firm: Doc } | null> {
  const base = unscoped(store);
  const client = await findOne(base, "accounting_clients", [["eq", "linkedCompanyId", companyId], ["eq", "linkStatus", "active"]]);
  if (!client) return null;
  const firm = await base.get("companies", client.companyId);
  return firm ? { client, firm } : null;
}

/**
 * Store SOMENTE LEITURA restrito à empresa vinculada ao cliente — a única porta de leitura do escritório para
 * dados de outra empresa. Exige vínculo ativo; qualquer gravação é recusada.
 */
export async function linkedCompanyReader(ctx: Ctx, client: Doc): Promise<Store> {
  if (client.companyId !== ctx.companyId) throw new PermissionError();
  if (client.linkStatus !== "active" || !client.linkedCompanyId) throw new BusinessError("Cliente sem vínculo ativo com uma empresa do ERP.", "not_linked");
  return readOnly(scopeStore(unscoped(ctx.store), client.linkedCompanyId));
}

export interface LinkedSnapshot {
  company: { id: string; name: string; tradeName: string | null; cnpj: string | null; regime: string | null; status: string | null };
  branches: Array<{ id: string; name: string; fiscalStatus: string | null }>;
  months: Array<{ period: string; authorized: number; cancelled: number; rejected: number; pending: number; simulated: number }>;
  obligations: Array<{ id: string; title: string; kind: string; period: string; dueDate: string; status: string }>;
  certificates: Array<{ branchId: string | null; branchName: string; validTo: string | null; daysLeft: number | null }>;
  packages: Array<{ fileId: string; name: string; period: string; createdAt: string }>;
  stuckDocs: number;
}

/** Situação fiscal da empresa vinculada (leitura): documentos por mês, obrigações, certificados e pacotes. */
export async function linkedSnapshot(ctx: Ctx, clientId: string, months = 3): Promise<LinkedSnapshot> {
  const client = await getClient(ctx, clientId);
  const r = await linkedCompanyReader(ctx, client);
  const companyId = client.linkedCompanyId as string;
  const company = await r.getOrThrow("companies", companyId);
  const from = monthStart(addMonths(today(), -(months - 1)));
  const [branches, docs, obligations, configs, packages] = await Promise.all([
    listAll(r, "branches", { filters: [["eq", "companyId", companyId]] }),
    listAll(r, "fiscal_documents", { filters: [["eq", "companyId", companyId], ["gte", "issueDate", from]] }, 20000),
    listAll(r, "fiscal_obligations", { filters: [["eq", "companyId", companyId], ["gte", "dueDate", addMonths(from, -1)]] }),
    listAll(r, "fiscal_configs", { filters: [["eq", "companyId", companyId]] }),
    listAll(r, "files", { filters: [["eq", "companyId", companyId], ["eq", "kind", "accounting_package"]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 24),
  ]);
  const { displayStatus, OBLIGATION_KIND_LABEL } = await import("../fiscal/obligations");
  const { certificateDaysLeft } = await import("../fiscal/config");
  const monthsOut: LinkedSnapshot["months"] = [];
  for (let i = months - 1; i >= 0; i--) {
    const period = monthStart(addMonths(today(), -i)).slice(0, 7);
    const inMonth = docs.filter((d) => String(d.issueDate ?? d.createdAt).slice(0, 7) === period);
    monthsOut.push({
      period,
      authorized: inMonth.filter((d) => d.status === "authorized").length,
      cancelled: inMonth.filter((d) => d.status === "cancelled").length,
      rejected: inMonth.filter((d) => ["rejected", "denied", "error"].includes(d.status)).length,
      pending: inMonth.filter((d) => ["pending", "queued", "processing", "contingency"].includes(d.status)).length,
      simulated: inMonth.filter((d) => d.isSimulated).length,
    });
  }
  const branchName = new Map(branches.map((b) => [b.id, b.name as string]));
  return {
    company: { id: company.id, name: company.name, tradeName: company.tradeName ?? null, cnpj: company.cnpj ?? null, regime: company.regime ?? null, status: company.status ?? null },
    branches: branches.map((b) => ({ id: b.id, name: b.name, fiscalStatus: b.fiscalStatus ?? null })),
    months: monthsOut,
    obligations: obligations
      .map((o) => ({ id: o.id, title: o.name ?? OBLIGATION_KIND_LABEL[o.kind] ?? o.kind, kind: o.kind, period: o.period, dueDate: o.dueDate, status: displayStatus(o) }))
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
    certificates: configs.filter((c) => c.certificate?.validTo).map((c) => ({ branchId: c.branchId ?? null, branchName: c.branchId ? (branchName.get(c.branchId) ?? "Filial") : "Empresa", validTo: c.certificate.validTo ?? null, daysLeft: certificateDaysLeft(c.certificate) })),
    packages: packages.map((f) => ({ fileId: f.id, name: f.name, period: f.entityId, createdAt: f.createdAt })),
    stuckDocs: docs.filter((d) => ["queued", "processing"].includes(d.status) && d.updatedAt < new Date(Date.now() - 30 * 60000).toISOString()).length,
  };
}

export { monthEnd };
