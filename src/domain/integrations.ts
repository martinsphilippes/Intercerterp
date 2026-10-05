import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import type { Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";

/**
 * Central de integrações (Tela 40). Estados medidos:
 *  not_configured → configured_untested → operational | unavailable | error
 * Credenciais nunca são gravadas no banco: guardamos apenas o NOME da variável de ambiente (secretRefs).
 */

export type IntegrationKind = "pix" | "card_tef" | "fiscal_nfe" | "fiscal_nfse" | "bank" | "accounting" | "email";

export const INTEGRATION_CATALOG: Record<IntegrationKind, { label: string; description: string; providers: Array<{ id: string; label: string; secrets: string[]; config: string[] }>; consumer: string }> = {
  pix: {
    label: "Pix",
    description: "Cobranças Pix com QR Code dinâmico e confirmação pelo provedor.",
    providers: [
      { id: "mercadopago", label: "Mercado Pago", secrets: ["accessToken"], config: ["baseUrl"] },
      { id: "simulated", label: "Simulação (sem valor financeiro)", secrets: [], config: [] },
    ],
    consumer: "PDV → Pagamento da venda",
  },
  card_tef: {
    label: "Cartões / TEF",
    description: "Cartões de débito e crédito. Sem TEF integrado, o PDV registra NSU/autorização da maquininha como pagamento manual.",
    providers: [
      { id: "manual_pos", label: "Maquininha (registro manual de NSU)", secrets: [], config: ["acquirer", "debitFeeBps", "creditFeeBps", "debitDays", "creditDays"] },
      { id: "tef_connector", label: "TEF via conector local", secrets: ["connectorToken"], config: ["connectorUrl"] },
    ],
    consumer: "PDV → Pagamento da venda; Financeiro → Liquidação de cartões",
  },
  fiscal_nfe: {
    label: "NF-e / NFC-e",
    description: "Emissão, consulta, cancelamento, CC-e e inutilização de NF-e e NFC-e.",
    providers: [
      { id: "focusnfe", label: "Focus NFe", secrets: ["token"], config: [] },
      { id: "simulated", label: "Simulação (documento sem validade fiscal)", secrets: [], config: [] },
    ],
    consumer: "Fiscal → NF-e / NFC-e; PDV → Venda concluída",
  },
  fiscal_nfse: {
    label: "NFS-e",
    description: "Emissão de notas de serviço pelo padrão nacional ou municipal do provedor.",
    providers: [
      { id: "focusnfe", label: "Focus NFe", secrets: ["token"], config: [] },
      { id: "simulated", label: "Simulação (documento sem validade fiscal)", secrets: [], config: [] },
    ],
    consumer: "Fiscal → NFS-e",
  },
  bank: {
    label: "Conexão bancária",
    description: "Importação de extratos OFX/CSV e retornos CNAB 240/400. Conexão automática requer API do banco.",
    providers: [
      { id: "file_import", label: "Importação de arquivos (OFX, CSV, CNAB)", secrets: [], config: [] },
      { id: "open_finance", label: "API bancária / Open Finance", secrets: ["clientId", "clientSecret"], config: ["baseUrl"] },
    ],
    consumer: "Financeiro → Conciliação bancária",
  },
  accounting: {
    label: "Área da contabilidade",
    description: "Pacote de XMLs e resumo contábil do período para o escritório contábil.",
    providers: [{ id: "export_package", label: "Pacote de exportação (ZIP) + e-mail", secrets: [], config: ["accountantEmail", "accountantName"] }],
    consumer: "Fiscal → Relatórios fiscais",
  },
  email: {
    label: "E-mail",
    description: "Envio de documentos, convites e recuperação de senha.",
    providers: [
      { id: "appwrite_messaging", label: "Appwrite Messaging", secrets: [], config: ["providerId"] },
      { id: "resend", label: "Resend (API)", secrets: ["apiKey"], config: ["from"] },
    ],
    consumer: "Documentos, convites, suporte",
  },
};

export const STATUS_LABEL: Record<string, string> = {
  not_configured: "Não configurada",
  configured_untested: "Configurada sem teste",
  operational: "Operacional",
  unavailable: "Indisponível",
  error: "Erro",
};

const scopeKey = (companyId: string, branchId: string | null | undefined, kind: string) => `${companyId}|${branchId ?? "*"}|${kind}`;

/** Integração efetiva para a filial (específica ou da empresa). */
export async function getIntegration(store: Store, companyId: string, branchId: string | null | undefined, kind: IntegrationKind): Promise<Doc | null> {
  if (branchId) {
    const b = await store.get("integrations", detId("integration", scopeKey(companyId, branchId, kind)));
    if (b && b.enabled !== false) return b;
  }
  const c = await store.get("integrations", detId("integration", scopeKey(companyId, null, kind)));
  return c && c.enabled !== false ? c : null;
}

export async function saveIntegration(
  ctx: Ctx,
  input: { kind: IntegrationKind; branchId: string | null; provider: string; environment?: string; config?: Record<string, any>; secretRefs?: Record<string, string>; enabled?: boolean },
) {
  const sk = scopeKey(ctx.companyId, input.branchId, input.kind);
  const id = detId("integration", sk);
  const data = {
    companyId: ctx.companyId,
    branchId: input.branchId,
    scopeKey: sk,
    kind: input.kind,
    provider: input.provider,
    environment: input.environment ?? "homologacao",
    config: input.config ?? {},
    secretRefs: input.secretRefs ?? {},
    enabled: input.enabled ?? true,
    status: "configured_untested",
    lastTestMessage: null,
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
  await audit(ctx, { module: "admin", action: "integration.save", entityType: "integration", entityId: id, summary: `Integração ${INTEGRATION_CATALOG[input.kind].label} configurada (${input.provider})`, before: existing ? { provider: existing.provider, environment: existing.environment, config: existing.config } : null, after: { provider: input.provider, environment: input.environment, config: input.config, secretRefs: input.secretRefs } });
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

/** Secretos faltantes (nomes de variáveis sem valor no ambiente). */
export function missingSecrets(integration: Doc): string[] {
  const refs: Record<string, string> = integration.secretRefs ?? {};
  return Object.entries(refs)
    .filter(([, envName]) => envName && !process.env[envName])
    .map(([k, envName]) => `${k} (${envName})`);
}

export async function listIntegrations(store: Store, companyId: string) {
  return listAll(store, "integrations", { filters: [["eq", "companyId", companyId]] });
}
