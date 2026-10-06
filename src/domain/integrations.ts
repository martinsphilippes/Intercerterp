import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";

/**
 * Central de integrações (Tela 40). Estados medidos:
 *  not_configured → configured_untested → operational | unavailable | error  (simulated = provedor de simulação respondendo)
 * Credenciais nunca são gravadas no banco: guardamos apenas o NOME da variável de ambiente (secretRefs).
 * Configuração preenchida não equivale a conexão operacional: o estado só muda com um teste real.
 */

export type IntegrationKind = "pix" | "card_tef" | "fiscal_nfe" | "fiscal_nfse" | "bank" | "accounting" | "email";

export interface CatalogProvider {
  id: string;
  label: string;
  secrets: string[];
  config: string[];
  /** variável de ambiente sugerida por segredo */
  defaultRefs?: Record<string, string>;
  /**
   * Prefixos aceitos para o NOME das variáveis de credencial deste provedor: o servidor envia o VALOR da variável
   * ao provedor, então só variáveis "do provedor" podem ser vinculadas (nunca segredos do próprio sistema).
   */
  refPrefixes?: string[];
  /** o que o teste faz (ou por que não há teste) */
  test: string;
  simulated?: boolean;
}

/** Variáveis aceitas para o token da Focus NFe (NF-e, NFC-e e NFS-e). */
export const FOCUS_REF_PREFIXES = ["FOCUSNFE_", "FOCUS_", "NFE_", "NFCE_", "NFSE_"];
/** Variáveis aceitas para o código do CSC da NFC-e. */
export const CSC_REF_PREFIXES = ["NFCE_", "CSC_", "FOCUSNFE_", "FOCUS_"];

export const INTEGRATION_CATALOG: Record<IntegrationKind, { label: string; description: string; providers: CatalogProvider[]; consumer: string; consumers: Array<{ label: string; href: string }> }> = {
  pix: {
    label: "Pix",
    description: "Cobranças Pix com QR Code dinâmico e confirmação pelo provedor.",
    providers: [
      { id: "mercadopago", label: "Mercado Pago", secrets: ["accessToken"], config: [], defaultRefs: { accessToken: "MERCADOPAGO_ACCESS_TOKEN" }, refPrefixes: ["MERCADOPAGO_", "MP_"], test: "Consulta autenticada à API do provedor (provider.test)." },
      { id: "simulated", label: "Simulação (sem valor financeiro)", secrets: [], config: [], test: "Verifica o provedor de simulação (sem instituição real).", simulated: true },
    ],
    consumer: "PDV → Pagamento da venda",
    consumers: [{ label: "PDV — pagamento Pix", href: "/pdv" }, { label: "Histórico de vendas", href: "/vendas" }],
  },
  card_tef: {
    label: "Cartões / TEF",
    description: "Cartões de débito e crédito. Sem TEF integrado, o PDV registra NSU/autorização da maquininha como pagamento manual.",
    providers: [
      { id: "manual_pos", label: "Maquininha (registro manual de NSU)", secrets: [], config: ["acquirer", "debitFeeBps", "creditFeeBps", "debitDays", "creditDays"], test: "Sem teste: não há conexão remota — o operador registra NSU/autorização manualmente." },
      { id: "tef_connector", label: "TEF via conector local", secrets: [], config: [], test: "Resultado medido pelo navegador de cada caixa (Administração → Terminais → Testar conector). O servidor não acessa o conector, que roda no computador do caixa." },
    ],
    consumer: "PDV → Pagamento da venda; Financeiro → Liquidação de cartões",
    consumers: [{ label: "PDV — cartões", href: "/pdv" }, { label: "Recebíveis de cartão", href: "/financeiro/cartoes" }],
  },
  fiscal_nfe: {
    label: "NF-e / NFC-e",
    description: "Emissão, consulta, cancelamento, CC-e e inutilização de NF-e e NFC-e (configuração fiscal por filial).",
    providers: [
      { id: "focusnfe", label: "Focus NFe", secrets: ["token"], config: [], defaultRefs: { token: "FOCUSNFE_TOKEN" }, refPrefixes: FOCUS_REF_PREFIXES, test: "Consulta autenticada à API Focus NFe (testFiscalConnection)." },
      { id: "simulated", label: "Simulação (documento sem validade fiscal)", secrets: [], config: [], test: "Verifica o provedor de simulação (sem SEFAZ).", simulated: true },
    ],
    consumer: "Fiscal → NF-e / NFC-e; PDV → Venda concluída",
    consumers: [{ label: "Fiscal — NF-e", href: "/fiscal/nfe" }, { label: "Fiscal — NFC-e (PDV)", href: "/fiscal/nfce" }, { label: "Configurações fiscais", href: "/fiscal/configuracoes" }],
  },
  fiscal_nfse: {
    label: "NFS-e",
    description: "Emissão de notas de serviço pelo padrão nacional ou municipal do provedor (configuração fiscal por filial).",
    providers: [
      { id: "focusnfe", label: "Focus NFe", secrets: ["token"], config: [], defaultRefs: { token: "FOCUSNFE_TOKEN" }, refPrefixes: FOCUS_REF_PREFIXES, test: "Consulta autenticada à API Focus NFe (testFiscalConnection)." },
      { id: "simulated", label: "Simulação (documento sem validade fiscal)", secrets: [], config: [], test: "Verifica o provedor de simulação (sem prefeitura).", simulated: true },
    ],
    consumer: "Fiscal → NFS-e",
    consumers: [{ label: "Fiscal — NFS-e", href: "/fiscal/nfse" }],
  },
  bank: {
    label: "Conexão bancária",
    description: "Importação de extratos OFX/CSV e retornos CNAB 240/400. Conexão automática requer API do banco.",
    providers: [
      { id: "file_import", label: "Importação de arquivos (OFX, CSV, CNAB)", secrets: [], config: [], test: "Sem teste: não há conexão remota — os arquivos são importados manualmente na conciliação." },
      { id: "open_finance", label: "API bancária / Open Finance", secrets: ["clientId", "clientSecret"], config: [], defaultRefs: { clientId: "BANK_CLIENT_ID", clientSecret: "BANK_CLIENT_SECRET" }, refPrefixes: ["BANK_", "BANCO_", "OPENFINANCE_", "OPEN_FINANCE_"], test: "Conector de API bancária não implementado nesta versão." },
    ],
    consumer: "Financeiro → Conciliação bancária",
    consumers: [{ label: "Conciliação bancária", href: "/financeiro/conciliacao" }],
  },
  accounting: {
    label: "Área da contabilidade",
    description: "Pacote de XMLs e relatórios CSV do período enviado ao escritório contábil pelo canal de e-mail.",
    providers: [{ id: "export_package", label: "Pacote de exportação (ZIP) + e-mail", secrets: [], config: ["accountantEmail", "accountantName"], test: "Envia mensagem de teste pelo canal de e-mail ao usuário logado (comprova a entrega do canal)." }],
    consumer: "Fiscal → Relatórios fiscais",
    consumers: [{ label: "Relatórios fiscais — exportação", href: "/fiscal/relatorios?tab=exportacao" }],
  },
  email: {
    label: "E-mail",
    description: "Envio de documentos, convites e recuperação de senha.",
    providers: [
      { id: "appwrite_messaging", label: "Appwrite Messaging", secrets: [], config: ["providerId"], test: "Envio real de mensagem de teste ao usuário logado." },
      { id: "resend", label: "Resend (API)", secrets: ["apiKey"], config: ["from"], defaultRefs: { apiKey: "RESEND_API_KEY" }, refPrefixes: ["RESEND_"], test: "Envio real de mensagem de teste ao usuário logado." },
    ],
    consumer: "Documentos, convites, suporte",
    consumers: [{ label: "NFC-e/NF-e por e-mail", href: "/fiscal/nfce" }, { label: "Pacote à contabilidade", href: "/fiscal/relatorios?tab=exportacao" }],
  },
};

export const CONFIG_LABEL: Record<string, string> = {
  acquirer: "Adquirente",
  debitFeeBps: "Taxa débito (bps)",
  creditFeeBps: "Taxa crédito (bps)",
  debitDays: "Prazo débito (dias)",
  creditDays: "Prazo crédito (dias)",
  connectorUrl: "URL do conector TEF",
  accountantEmail: "E-mail da contabilidade",
  accountantName: "Contato na contabilidade",
  providerId: "ID do provedor de e-mail no Appwrite",
  from: "Remetente (From)",
};

export const SECRET_LABEL: Record<string, string> = { accessToken: "Access token", connectorToken: "Token do conector", token: "Token da API", clientId: "Client ID", clientSecret: "Client secret", apiKey: "Chave da API" };

export const STATUS_LABEL: Record<string, string> = {
  not_configured: "Não configurada",
  configured_untested: "Configurada sem teste",
  operational: "Operacional",
  unavailable: "Indisponível",
  error: "Erro",
  simulated: "Simulação",
};

const scopeKey = (companyId: string, branchId: string | null | undefined, kind: string) => `${companyId}|${branchId ?? "*"}|${kind}`;
export const integrationId = (companyId: string, branchId: string | null | undefined, kind: string) => detId("integration", scopeKey(companyId, branchId, kind));

// ───────────────────────────── Referências de credencial (nome da variável de ambiente)

/** Formato do NOME da variável de ambiente que guarda uma credencial (nunca o valor). */
export const SECRET_REF_FORMAT = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Variáveis do próprio servidor (banco, sessão, rotinas, hospedagem, nuvem, sistema operacional). Nunca são aceitas
 * como credencial de integração: o servidor envia o VALOR da variável vinculada ao provedor.
 */
const RESERVED_ENV_NAMES = new Set([
  "CRON_SECRET", "SETUP_TOKEN", "DATA_BACKEND", "DATABASE_URL", "MEMORY_TX_MODE", "FOCUSNFE_BASE_URL", "BASE_URL", "APP_URL",
  "PATH", "HOME", "USER", "USERNAME", "PWD", "OLDPWD", "SHELL", "HOSTNAME", "HOST", "PORT", "TMPDIR", "TMP", "TEMP", "LANG", "TZ", "CI",
  "LOGIN", "PASSWORD", "TOKEN", "API_KEY", "SECRET", "SECRET_KEY", "PRIVATE_KEY",
]);
const RESERVED_ENV_PREFIXES = [
  "APPWRITE_", "NEXT_", "NODE_", "NPM_", "VERCEL", "SESSION", "AWS_", "AZURE_", "GOOGLE_", "GCP_", "GCLOUD_", "FIREBASE_", "GITHUB_", "GIT_",
  "DATABASE_", "DB_", "POSTGRES", "PG", "MYSQL", "MONGO", "REDIS", "KV_", "BLOB_", "EDGE_CONFIG", "CRON_", "SETUP_", "DATA_", "AUTH_", "JWT_",
  "LOCAL_", "DEMO_", "APP_", "HTTP_", "HTTPS_", "NO_PROXY", "ALL_PROXY", "SSL_", "LD_", "XDG_", "ANTHROPIC", "CLAUDE", "OPENAI", "SENTRY_", "TURBO_",
];

export function isReservedEnvName(name: string) {
  return RESERVED_ENV_NAMES.has(name) || RESERVED_ENV_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Problema no NOME de variável informado para uma credencial (ou null se aceito): formato, variável reservada do
 * sistema e — quando informados — prefixos do provedor.
 */
export function secretRefProblem(name: string | null | undefined, opts: { label: string; example: string; prefixes?: string[] | null }): string | null {
  const v = String(name ?? "").trim();
  if (!SECRET_REF_FORMAT.test(v)) return `"${opts.label}": informe o NOME da variável de ambiente (ex.: ${opts.example}), nunca o valor da credencial — letras maiúsculas, dígitos e "_", de 3 a 64 caracteres.`;
  if (isReservedEnvName(v)) return `"${opts.label}": a variável ${v} é do próprio sistema (banco, sessão, rotinas ou hospedagem) e não pode ser vinculada a uma integração. Crie uma variável própria para a credencial (ex.: ${opts.example}).`;
  if (opts.prefixes?.length && !opts.prefixes.some((p) => v.startsWith(p))) return `"${opts.label}": o nome da variável deve começar com ${opts.prefixes.join(", ")} (ex.: ${opts.example}) — somente credenciais deste provedor podem ser enviadas a ele.`;
  return null;
}

/** Problema no nome da variável de um segredo do provedor do catálogo. */
export function providerSecretProblem(prov: CatalogProvider, secret: string, name: string | null | undefined) {
  return secretRefProblem(name, { label: SECRET_LABEL[secret] ?? secret, example: prov.defaultRefs?.[secret] ?? `${prov.refPrefixes?.[0] ?? "MINHA_"}CHAVE`, prefixes: prov.refPrefixes });
}

/** Token da Focus NFe (configuração fiscal / integração fiscal). */
export function fiscalTokenRefProblem(name: string | null | undefined) {
  return secretRefProblem(name, { label: "Variável do token", example: "FOCUSNFE_TOKEN", prefixes: FOCUS_REF_PREFIXES });
}

/** Código do CSC da NFC-e. */
export function cscRefProblem(name: string | null | undefined) {
  return secretRefProblem(name, { label: "CSC da NFC-e — variável do código", example: "NFCE_CSC", prefixes: CSC_REF_PREFIXES });
}

/** Chaves de configuração nunca aceitas: o endereço do provedor é fixo no código (evita desviar credenciais — SSRF). */
const FORBIDDEN_CONFIG_KEYS = ["baseUrl"];

const catalogProvider = (kind: string, provider: string | null | undefined) => INTEGRATION_CATALOG[kind as IntegrationKind]?.providers.find((p) => p.id === provider);

/** Somente os segredos do provedor no catálogo atual (vínculos antigos de outros provedores/versões são ignorados). */
export function effectiveSecretRefs(integration: Doc): Record<string, string> {
  const prov = catalogProvider(integration.kind, integration.provider);
  const refs: Record<string, string> = {};
  for (const s of prov?.secrets ?? []) {
    const v = integration.secretRefs?.[s];
    if (typeof v === "string" && v) refs[s] = v;
  }
  return refs;
}

/** Vínculo de credencial gravado com nome não permitido (ex.: gravado antes desta validação) — a integração não opera. */
export function integrationRefProblem(integration: Doc): string | null {
  const prov = catalogProvider(integration.kind, integration.provider);
  if (!prov) return null;
  const refs = effectiveSecretRefs(integration);
  for (const s of prov.secrets) if (refs[s]) {
    const p = providerSecretProblem(prov, s, refs[s]);
    if (p) return p;
  }
  return null;
}

/** Cópia segura para os consumidores: sem chaves de configuração proibidas e só com os segredos do provedor. */
function safeIntegration(integration: Doc): Doc {
  const config: Record<string, any> = { ...(integration.config ?? {}) };
  for (const k of FORBIDDEN_CONFIG_KEYS) delete config[k];
  return { ...integration, config, secretRefs: effectiveSecretRefs(integration) };
}

/** Registro efetivo (filial habilitada ou empresa), sem saneamento — uso administrativo (ex.: remover vínculo inválido). */
export async function findIntegration(store: Store, companyId: string, branchId: string | null | undefined, kind: IntegrationKind): Promise<Doc | null> {
  if (branchId) {
    const b = await store.get("integrations", detId("integration", scopeKey(companyId, branchId, kind)));
    if (b && b.enabled !== false) return b;
  }
  const c = await store.get("integrations", detId("integration", scopeKey(companyId, null, kind)));
  return c && c.enabled !== false ? c : null;
}

/**
 * Integração efetiva para a filial (específica ou da empresa). Registro com vínculo de credencial não permitido é
 * tratado como não configurado (null); a configuração devolvida nunca traz URL base (endereço fixo do provedor).
 */
export async function getIntegration(store: Store, companyId: string, branchId: string | null | undefined, kind: IntegrationKind): Promise<Doc | null> {
  const raw = await findIntegration(store, companyId, branchId, kind);
  if (!raw || integrationRefProblem(raw)) return null;
  return safeIntegration(raw);
}

export async function saveIntegration(
  ctx: Ctx,
  input: { kind: IntegrationKind; branchId: string | null; provider: string; environment?: string; config?: Record<string, any>; secretRefs?: Record<string, string>; enabled?: boolean },
  opts: { unlinkSecrets?: boolean } = {},
) {
  requireAction(ctx, "admin.integrations");
  const cat = INTEGRATION_CATALOG[input.kind];
  assert(cat, "Tipo de integração desconhecido.");
  const prov = cat.providers.find((p) => p.id === input.provider);
  assert(prov, "Provedor não suportado para esta integração.");
  // o endereço da API é fixo no código de cada provedor: nunca configurável (o servidor enviaria a credencial a ele)
  for (const k of FORBIDDEN_CONFIG_KEYS) {
    const v = input.config?.[k];
    assert(v === undefined || v === null || v === "", "O endereço (URL base) da API do provedor não é configurável: o sistema usa somente o endereço oficial do provedor.", "forbidden_config");
  }
  const refs: Record<string, string> = {};
  for (const s of prov.secrets) {
    // "Remover vínculo": não repõe o nome padrão da variável (a integração fica sem credencial até novo vínculo)
    const v = (input.secretRefs?.[s] ?? (opts.unlinkSecrets ? "" : prov.defaultRefs?.[s]) ?? "").trim();
    if (!v) continue;
    const problem = providerSecretProblem(prov, s, v);
    assert(!problem, problem ?? "", "secret_ref");
    refs[s] = v;
  }
  const config: Record<string, any> = {};
  for (const k of prov.config) if (input.config?.[k] !== undefined && input.config[k] !== "") config[k] = input.config[k];
  if (input.config?.connectionName) config.connectionName = String(input.config.connectionName).trim().slice(0, 120);
  if (config.accountantEmail) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(config.accountantEmail)), "E-mail da contabilidade inválido.");
  if (config.connectorUrl) assert(/^https?:\/\//.test(String(config.connectorUrl)), "URL do conector inválida.");
  const sk = scopeKey(ctx.companyId, input.branchId, input.kind);
  const id = detId("integration", sk);
  const data = {
    companyId: ctx.companyId,
    branchId: input.branchId,
    scopeKey: sk,
    kind: input.kind,
    provider: input.provider,
    environment: input.environment ?? "homologacao",
    config,
    secretRefs: refs,
    enabled: input.enabled ?? true,
    status: "configured_untested",
    lastTestMessage: "Configuração salva — execute o teste para medir a conexão.",
  };
  const existing = await ctx.store.get("integrations", id);
  let doc: Doc;
  if (existing) doc = await ctx.store.update("integrations", id, data);
  else {
    try {
      doc = await ctx.store.create("integrations", { ...data, createdBy: ctx.user.id }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await ctx.store.update("integrations", id, data);
    }
  }
  await audit(ctx, { module: "admin", action: "integration.save", entityType: "integration", entityId: id, summary: `Integração ${cat.label} configurada (${prov.label}${input.branchId ? ", filial" : ", empresa"})`, before: existing ? { provider: existing.provider, environment: existing.environment, config: existing.config, secretRefs: existing.secretRefs } : null, after: { provider: input.provider, environment: input.environment, config, secretRefs: refs }, branchId: input.branchId });
  return doc;
}

/** Registra execução (teste, chamada, falha) com payload saneado. */
export async function logIntegration(store: Store, input: { companyId: string; branchId?: string | null; integrationId?: string | null; kind: string; action: string; status: "success" | "failure" | "info"; message: string; payload?: unknown; durationMs?: number }) {
  const { sanitize } = await import("@/lib/core/audit");
  await store.create("integration_logs", {
    companyId: input.companyId,
    branchId: input.branchId ?? null,
    integrationId: input.integrationId ?? null,
    kind: input.kind,
    action: input.action,
    status: input.status,
    message: input.message.slice(0, 4000),
    payload: input.payload ? sanitize(input.payload) : null,
    durationMs: input.durationMs ?? null,
    occurredAt: nowIso(),
  });
  if (input.integrationId) {
    await store.update("integrations", input.integrationId, { lastRunAt: nowIso(), lastRunStatus: input.status }).catch(() => undefined);
  }
}

export async function setIntegrationStatus(store: Store, id: string, status: string, message: string) {
  return store.update("integrations", id, { status, lastTestAt: nowIso(), lastTestMessage: message.slice(0, 1000) });
}

/** Segredos faltantes (nomes de variáveis sem valor no ambiente). */
export function missingSecrets(integration: Doc): string[] {
  // somente os segredos do provedor no catálogo atual (ex.: TEF via conector não usa credencial no servidor)
  const refs = effectiveSecretRefs(integration);
  return Object.entries(refs)
    .filter(([, envName]) => envName && !process.env[envName])
    .map(([k, envName]) => `${k} (${envName})`);
}

/** Situação das referências de credencial: nome da variável e se está definida no servidor (sem revelar valor). */
export function secretStatus(kind: IntegrationKind, provider: string | null | undefined, refs: Record<string, string> | null | undefined) {
  const prov = INTEGRATION_CATALOG[kind]?.providers.find((p) => p.id === provider);
  if (!prov) return [];
  return prov.secrets.map((s): { key: string; label: string; envName: string; defined: boolean; problem?: string } => {
    const envName = refs?.[s] || prov.defaultRefs?.[s] || "";
    // nome não permitido: nunca consulta a variável (nem para dizer se está definida)
    const problem = envName ? providerSecretProblem(prov, s, envName) : null;
    if (problem) return { key: s, label: SECRET_LABEL[s] ?? s, envName, defined: false, problem };
    return { key: s, label: SECRET_LABEL[s] ?? s, envName, defined: Boolean(envName && process.env[envName]) };
  });
}

export async function listIntegrations(store: Store, companyId: string) {
  return listAll(store, "integrations", { filters: [["eq", "companyId", companyId]] });
}

// ───────────────────────────── Teste real por tipo

export interface TestOutcome {
  status: "operational" | "simulated" | "configured_untested" | "unavailable" | "error" | "not_configured";
  ok: boolean;
  message: string;
}

const CONNECTOR_CHECK_MAX_AGE_DAYS = 7;

/**
 * TEF via conector local: o conector roda no computador de cada caixa (ex.: http://127.0.0.1:9100), alcançável apenas
 * pelo navegador daquele computador. O estado vem das verificações registradas pelos navegadores dos terminais
 * (Administração → Terminais → Testar conector) — o servidor nunca faz requisições à URL cadastrada (sem SSRF).
 */
async function tefFromTerminalChecks(ctx: Ctx, branchId: string | null): Promise<TestOutcome> {
  const terminals = (await listAll(ctx.store, "terminals", { filters: [["eq", "companyId", ctx.companyId], ...(branchId ? [["eq", "branchId", branchId] as any] : [])] })).filter(
    (t) => t.status === "active" && t.tefProvider === "tef_connector",
  );
  if (!terminals.length) return { status: "configured_untested", ok: true, message: "Nenhum terminal ativo usa o conector TEF. Configure o terminal em Administração → Terminais (Pagamentos → TEF via conector local)." };
  const since = new Date(Date.now() - CONNECTOR_CHECK_MAX_AGE_DAYS * 86400000).toISOString();
  const ok: string[] = [];
  const failed: string[] = [];
  const unchecked: string[] = [];
  for (const t of terminals) {
    const last = (
      await ctx.store.list("audit_logs", {
        filters: [["eq", "companyId", ctx.companyId], ["eq", "entityType", "terminal"], ["eq", "entityId", t.id], ["eq", "action", "terminal.connector_check"], ["gte", "occurredAt", since]],
        orderBy: [{ field: "occurredAt", dir: "desc" }],
        limit: 1,
      })
    ).items[0];
    const verified = Boolean(last?.after?.verified) && last?.after?.origin === "browser";
    if (!verified) unchecked.push(t.name);
    else if (last.result === "failure") failed.push(t.name);
    else ok.push(t.name);
  }
  if (failed.length) return { status: "error", ok: false, message: `Conector com falha na última verificação pelo navegador: ${failed.join(", ")}.${unchecked.length ? ` Sem verificação recente: ${unchecked.join(", ")}.` : ""}` };
  if (unchecked.length) return { status: "configured_untested", ok: true, message: `Sem verificação recente (últimos ${CONNECTOR_CHECK_MAX_AGE_DAYS} dias) pelo navegador do caixa: ${unchecked.join(", ")}. Use Administração → Terminais → Testar conector em cada computador.${ok.length ? ` Verificados: ${ok.join(", ")}.` : ""}` };
  return { status: "operational", ok: true, message: `Conector verificado pelo navegador em ${ok.length} terminal(is): ${ok.join(", ")}.` };
}

/** Executa o teste real da integração e grava o estado medido + histórico. */
export async function testIntegration(ctx: Ctx, kind: IntegrationKind, branchId: string | null): Promise<TestOutcome> {
  requireAction(ctx, "admin.integrations");
  const t0 = Date.now();
  let out: TestOutcome;
  let integ: Doc | null = null;
  if (kind === "fiscal_nfe" || kind === "fiscal_nfse") {
    const { testFiscalConnection, getFiscalConfig } = await import("./fiscal/service");
    const cfg = await getFiscalConfig(ctx.store, ctx.companyId, branchId);
    if (!cfg) out = { status: "not_configured", ok: false, message: "Configuração fiscal não cadastrada para esta filial/empresa." };
    else {
      const r = await testFiscalConnection(ctx, cfg.branchId ?? null);
      out = { status: r.status as TestOutcome["status"], ok: r.ok, message: r.message };
    }
    integ = await mirrorFiscalIntegration(ctx, kind, branchId, out);
    await audit(ctx, { module: "admin", action: "integration.test", entityType: "integration", entityId: integ?.id ?? null, summary: `Teste ${INTEGRATION_CATALOG[kind].label}: ${STATUS_LABEL[out.status]} — ${out.message}`.slice(0, 480), result: out.ok ? "success" : "failure" });
    return out;
  }
  const raw = await findIntegration(ctx.store, ctx.companyId, branchId, kind);
  if (!raw) return { status: "not_configured", ok: false, message: "Integração não configurada." };
  const refProblem = integrationRefProblem(raw);
  integ = safeIntegration(raw);
  const missing = refProblem ? [] : missingSecrets(integ);
  try {
    // vínculo com variável não permitida: tratado como não configurado — o segredo nunca é lido nem enviado
    if (refProblem) out = { status: "not_configured", ok: false, message: `${refProblem} Salve a integração novamente com uma variável permitida.` };
    else if (missing.length) out = { status: "error", ok: false, message: `Credencial ausente no servidor: ${missing.join(", ")}. Defina a variável de ambiente e teste novamente.` };
    else if (kind === "pix") {
      const { pixProviderFrom } = await import("./payments/providers");
      const p = pixProviderFrom(integ);
      if (!p) out = { status: "error", ok: false, message: "Provedor Pix não pôde ser iniciado (credencial ausente)." };
      else {
        const r = await p.test();
        out = { status: r.ok ? (p.simulated ? "simulated" : "operational") : "error", ok: r.ok, message: r.message };
      }
    } else if (kind === "card_tef") {
      if (integ.provider === "tef_connector") {
        out = await tefFromTerminalChecks(ctx, branchId);
      } else out = { status: "configured_untested", ok: true, message: "Maquininha com registro manual de NSU: não há conexão remota a testar. Os pagamentos dependem da conferência do operador e da conciliação de recebíveis." };
    } else if (kind === "bank") {
      out =
        integ.provider === "file_import"
          ? { status: "configured_untested", ok: true, message: "Importação manual de arquivos (OFX/CSV/CNAB): não há conexão remota a testar. Use Financeiro → Conciliação para importar." }
          : { status: "unavailable", ok: false, message: "Conector de API bancária/Open Finance não implementado nesta versão — use a importação de arquivos." };
    } else if (kind === "email" || kind === "accounting") {
      const to = ctx.user.email;
      if (!to) out = { status: "error", ok: false, message: "Usuário logado sem e-mail para receber o teste." };
      else if (kind === "accounting" && !integ.config?.accountantEmail) out = { status: "error", ok: false, message: "Informe o e-mail da contabilidade." };
      else {
        const { sendEmail } = await import("@/lib/core/email");
        const r = await sendEmail(ctx.companyId, { to, subject: `Teste de integração — ${INTEGRATION_CATALOG[kind].label}`, html: `<p>Mensagem de teste enviada pela Central de integrações em ${new Date().toLocaleString("pt-BR")} por ${ctx.user.name}.</p>${kind === "accounting" ? `<p>Destino configurado para os pacotes: ${integ.config?.accountantEmail}</p>` : ""}` });
        out = r.delivered ? { status: "operational", ok: true, message: `Mensagem de teste entregue ao canal ${r.channel} para ${to}.` } : { status: r.channel === "not_configured" ? "error" : "error", ok: false, message: `Envio de teste falhou (${r.channel}): ${r.message ?? "sem detalhes"}` };
      }
    } else out = { status: "configured_untested", ok: true, message: "Sem teste disponível para este tipo." };
  } catch (e: any) {
    out = { status: "error", ok: false, message: `Falha no teste: ${e.message}` };
  }
  await setIntegrationStatus(ctx.store, integ.id, out.status, out.message);
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: integ.branchId, integrationId: integ.id, kind, action: "test", status: out.ok && out.status !== "configured_untested" ? "success" : out.status === "configured_untested" ? "info" : "failure", message: out.message, durationMs: Date.now() - t0 });
  await audit(ctx, { module: "admin", action: "integration.test", entityType: "integration", entityId: integ.id, summary: `Teste ${INTEGRATION_CATALOG[kind].label}: ${STATUS_LABEL[out.status]} — ${out.message}`.slice(0, 480), result: out.ok ? "success" : "failure" });
  return out;
}

/** Mantém o registro de integração fiscal alinhado à configuração fiscal (fiscal_configs é a fonte). */
async function mirrorFiscalIntegration(ctx: Ctx, kind: "fiscal_nfe" | "fiscal_nfse", branchId: string | null, out: TestOutcome) {
  const { getFiscalConfig } = await import("./fiscal/service");
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, branchId);
  if (!cfg) return null;
  const sk = scopeKey(ctx.companyId, cfg.branchId ?? null, kind);
  const id = detId("integration", sk);
  const prev = await ctx.store.get("integrations", detId("integration", sk));
  const data = { companyId: ctx.companyId, branchId: cfg.branchId ?? null, scopeKey: sk, kind, provider: cfg.provider, environment: cfg.environment, config: { nfseStandard: cfg.nfseStandard ?? null, fiscalConfigId: cfg.id, connectionName: prev?.config?.connectionName ?? null }, secretRefs: cfg.provider === "focusnfe" && cfg.tokenRef !== "" ? { token: cfg.tokenRef || "FOCUSNFE_TOKEN" } : {}, enabled: prev?.enabled ?? true, status: out.status, lastTestAt: nowIso(), lastTestMessage: out.message.slice(0, 1000) };
  if (await ctx.store.get("integrations", id)) await ctx.store.update("integrations", id, data);
  else await ctx.store.create("integrations", { ...data, createdBy: ctx.user.id }, id).catch((e) => (isConflict(e) ? ctx.store.update("integrations", id, data) : Promise.reject(e)));
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: cfg.branchId ?? null, integrationId: id, kind, action: "test", status: out.ok ? "success" : "failure", message: out.message });
  return ctx.store.get("integrations", id);
}

/** Visão 10 — configuração da integração fiscal (gravada em fiscal_configs da filial/empresa). */
export async function saveFiscalIntegration(ctx: Ctx, branchId: string | null, input: { kind: "fiscal_nfe" | "fiscal_nfse"; provider: string; environment: string; tokenRef: string; nfseStandard?: string | null; cscId?: string | null; cscTokenRef?: string | null; enabled?: boolean; connectionName?: string | null }) {
  requireAction(ctx, "admin.integrations");
  assert(["focusnfe", "simulated"].includes(input.provider), "Provedor fiscal não suportado.");
  assert(["homologacao", "producao"].includes(input.environment), "Ambiente inválido.");
  // o token é enviado à Focus NFe: só variáveis da Focus/NF-e (nunca segredos do sistema) — validado também com simulação,
  // pois o nome fica gravado e passa a valer ao trocar o provedor
  if (input.provider === "focusnfe" || (input.tokenRef ?? "") !== "") {
    const p = input.tokenRef === "" ? null : fiscalTokenRefProblem(input.tokenRef);
    assert(!p, p ?? "", "secret_ref");
  }
  if (input.connectionName !== undefined) assert(input.connectionName?.trim(), "Informe o nome da conexão.");
  if (input.cscTokenRef) {
    const p = cscRefProblem(input.cscTokenRef);
    assert(!p, p ?? "", "secret_ref");
  }
  const { saveFiscalConfig, getFiscalConfig } = await import("./fiscal/service");
  const cur = await getFiscalConfig(ctx.store, ctx.companyId, branchId);
  const patch: Record<string, any> = { provider: input.provider, environment: input.environment, tokenRef: input.tokenRef === "" ? "" : input.tokenRef || "FOCUSNFE_TOKEN" };
  if (input.enabled !== undefined) {
    if (input.kind === "fiscal_nfe") Object.assign(patch, { nfeEnabled: input.enabled, nfceEnabled: input.enabled });
    else patch.nfseEnabled = input.enabled;
  }
  if (input.kind === "fiscal_nfse" && input.nfseStandard) patch.nfseStandard = input.nfseStandard;
  if (input.kind === "fiscal_nfe") {
    if (input.cscId !== undefined) patch.cscId = input.cscId || null;
    if (input.cscTokenRef !== undefined) patch.cscTokenRef = input.cscTokenRef || null;
  }
  void cur; // configuração nova da filial herda as opções da empresa (saveFiscalConfig)
  const doc = await saveFiscalConfig(ctx, branchId, patch);
  const out: TestOutcome = { status: "configured_untested", ok: false, message: "Configuração salva — execute o teste para medir a conexão." };
  const sk = scopeKey(ctx.companyId, branchId, input.kind);
  const id = detId("integration", sk);
  const prevInteg = await ctx.store.get("integrations", detId("integration", scopeKey(ctx.companyId, branchId, input.kind)));
  const data = { companyId: ctx.companyId, branchId, scopeKey: sk, kind: input.kind, provider: input.provider, environment: input.environment, config: { nfseStandard: doc.nfseStandard ?? null, fiscalConfigId: doc.id, connectionName: input.connectionName?.trim() || prevInteg?.config?.connectionName || null }, secretRefs: input.provider === "focusnfe" && patch.tokenRef ? { token: patch.tokenRef } : {}, enabled: input.enabled ?? true, status: out.status, lastTestMessage: out.message };
  if (await ctx.store.get("integrations", id)) await ctx.store.update("integrations", id, data);
  else await ctx.store.create("integrations", { ...data, createdBy: ctx.user.id }, id).catch((e) => (isConflict(e) ? ctx.store.update("integrations", id, data) : Promise.reject(e)));
  await audit(ctx, { module: "admin", action: "integration.save", entityType: "integration", entityId: id, summary: `Integração ${INTEGRATION_CATALOG[input.kind].label} configurada (${input.provider}, ${input.environment})`, after: patch, branchId });
  return doc;
}

// ───────────────────────────── Pendências (tarefas) e histórico

const JOB_PREFIX: Record<IntegrationKind, string[]> = {
  pix: ["pix.", "payment.", "payments."],
  card_tef: ["card.", "tef."],
  fiscal_nfe: ["fiscal.transmit", "fiscal.query", "fiscal.cancel"],
  fiscal_nfse: ["fiscal.transmit", "fiscal.query", "fiscal.cancel"],
  bank: ["bank."],
  accounting: ["fiscal.accounting"],
  email: ["email.", "mail.", "notify.email"],
};

/** Tarefas com problema (retentativa/falha definitiva) ligadas ao tipo de integração. */
export async function integrationJobs(ctx: Ctx, kind: IntegrationKind, statuses = ["retry", "dead", "pending", "running"]) {
  const jobs = await listAll(ctx.store, "jobs", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", statuses]], orderBy: [{ field: "runAt", dir: "desc" }] }, 500);
  const prefixes = JOB_PREFIX[kind] ?? [];
  let out = jobs.filter((j) => prefixes.some((p) => j.type.startsWith(p)));
  if (kind === "fiscal_nfe" || kind === "fiscal_nfse") {
    const res: Doc[] = [];
    for (const j of out) {
      const d = j.payload?.documentId ? await ctx.store.get("fiscal_documents", j.payload.documentId) : null;
      const isNfse = d?.model === "nfse";
      if ((kind === "fiscal_nfse") === isNfse) res.push({ ...j, document: d ? { id: d.id, model: d.model, number: d.number, ref: d.ref, status: d.status } : null } as Doc);
    }
    out = res;
  }
  return out;
}

export async function requeueJob(ctx: Ctx, jobId: string) {
  requireAction(ctx, "admin.integrations");
  const job = await ctx.store.getOrThrow("jobs", jobId);
  assert(job.companyId === ctx.companyId, "Tarefa de outra empresa.");
  const { requeue, isStale } = await import("@/lib/core/jobs");
  assert(["retry", "dead", "pending"].includes(job.status) || isStale(job), "Somente tarefas pendentes, em retentativa, com falha ou travadas podem ser reprocessadas.");
  await requeue(ctx.store, jobId);
  await audit(ctx, { module: "admin", action: "job.requeue", entityType: "job", entityId: jobId, summary: `Tarefa ${job.type} reenfileirada manualmente (antes: ${job.status}, ${job.attempts ?? 0} tentativa(s))` });
  const { runDueJobs } = await import("./jobs-registry");
  return runDueJobs(ctx.store, { jobIds: [jobId], limit: 1 });
}

/** "Executar tarefas pendentes agora": antecipa retentativas e roda as tarefas vencidas da empresa. */
export async function runCompanyJobs(ctx: Ctx, opts: { includeRetry?: boolean } = {}) {
  requireAction(ctx, "admin.integrations");
  const now = nowIso();
  const due = await listAll(ctx.store, "jobs", { filters: [["eq", "companyId", ctx.companyId], ["eq", "status", ["pending", "retry"]]] }, 200);
  const ids: string[] = [];
  for (const j of due) {
    if (j.runAt > now) {
      if (!opts.includeRetry) continue;
      await ctx.store.update("jobs", j.id, { runAt: now });
    }
    ids.push(j.id);
  }
  if (!ids.length) return { ran: 0, results: [] as Array<{ id: string; type: string; status: string; error?: string }> };
  const { runDueJobs } = await import("./jobs-registry");
  const results = await runDueJobs(ctx.store, { jobIds: ids.slice(0, 50), limit: 50 });
  await audit(ctx, { module: "admin", action: "jobs.run", entityType: "job", entityId: null, summary: `Execução manual de tarefas: ${results.length} executada(s) — ${results.filter((r) => r.status === "done").length} concluída(s), ${results.filter((r) => r.status !== "done").length} com falha/retentativa` });
  return { ran: results.length, results };
}

export async function integrationLogs(ctx: Ctx, kind: IntegrationKind, limit = 100) {
  const kinds = kind === "fiscal_nfe" ? ["fiscal_nfe"] : [kind];
  return (await listAll(ctx.store, "integration_logs", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", kinds]], orderBy: [{ field: "occurredAt", dir: "desc" }] }, limit)).slice(0, limit);
}

/** Uso real recente (consumidor): execuções por ação nos últimos 30 dias. */
export async function usageSummary(ctx: Ctx, kind: IntegrationKind) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const logs = await listAll(ctx.store, "integration_logs", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", kind], ["gte", "occurredAt", since]] }, 5000);
  const by = new Map<string, { action: string; success: number; failure: number; info: number; last: string }>();
  for (const l of logs) {
    const r = by.get(l.action) ?? { action: l.action, success: 0, failure: 0, info: 0, last: "" };
    r[l.status as "success" | "failure" | "info"] = (r[l.status as "success"] ?? 0) + 1;
    if (l.occurredAt > r.last) r.last = l.occurredAt;
    by.set(l.action, r);
  }
  return [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
}

/** Diagnóstico acionável a partir do estado medido e da mensagem do último teste. */
export function diagnose(status: string, message: string | null | undefined, secrets: Array<{ envName: string; defined: boolean; label: string; problem?: string }>): string {
  const blocked = secrets.find((s) => s.problem);
  if (blocked) return `Vínculo de credencial não permitido — ${blocked.problem} Informe outra variável e salve; a integração não opera até lá.`;
  const missing = secrets.filter((s) => !s.defined);
  if (status === "not_configured") return "Escolha o provedor, informe os nomes das variáveis de credencial e salve; depois execute o teste.";
  if (missing.length) return `Defina no servidor (ex.: Vercel → Settings → Environment Variables, ou .env.local) a(s) variável(is) ${missing.map((m) => m.envName || m.label).join(", ")} e teste novamente. O valor nunca é gravado no banco.`;
  const m = message ?? "";
  if (/HTTP 401|HTTP 403|recus/i.test(m)) return "O provedor recusou a credencial: gere um novo token no painel do provedor, atualize a variável de ambiente e reinicie/reimplante o servidor.";
  if (/inacess|ENOTFOUND|ECONNREFUSED|timeout|abort|fetch failed/i.test(m)) return "Sem acesso de rede ao provedor/conector: verifique URL, firewall/proxy e disponibilidade do serviço.";
  if (status === "configured_untested") return "Configuração salva, mas sem medição: clique em “Testar conexão”. Configuração preenchida não equivale a conexão operacional.";
  if (status === "unavailable") return "Serviço indisponível ou não suportado nesta versão — use a alternativa indicada.";
  if (status === "error") return "Corrija a causa indicada na mensagem e teste novamente; tarefas com falha podem ser reprocessadas abaixo.";
  if (status === "simulated") return "Provedor de SIMULAÇÃO: funciona para demonstração/treinamento, sem validade fiscal/financeira. Para operar, configure o provedor real.";
  return "Integração respondeu ao último teste.";
}
