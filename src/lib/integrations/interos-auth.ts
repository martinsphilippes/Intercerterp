import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import {
  authenticateService,
  hasScope,
  serviceConfigured,
  signingSecrets,
  type ServiceClient,
  type ServiceScope,
} from "@/lib/service/credentials";

/**
 * Autenticação das APIs de licenças e módulos (`/api/interos/v2/*` e `/api/interos/v1/catalog|companies|operations`).
 *
 * Usa o MESMO registro e o MESMO formato de credencial do provisionamento e da Torre de Controle
 * (`INTEROS_CREDENCIAIS`, `Authorization: Bearer <id>.<segredo>`, só o hash guardado) — `src/lib/service/credentials.ts`
 * e docs/interos/credenciais.md. Este módulo só adapta a credencial ao formato de erro destas APIs (inglês, `{error}`).
 */
export type InterosScope = Extract<ServiceScope, "erp.modules.read" | "erp.modules.write" | "erp.license.read" | "erp.license.write" | "erp.usage.read">;
export const INTEROS_SCOPES: InterosScope[] = ["erp.modules.read", "erp.modules.write", "erp.license.read", "erp.license.write", "erp.usage.read"];

export interface InterosClient {
  id: string;
  scopes: InterosScope[];
  /** lista `empresas` da credencial (null = sem lista: só as empresas ligadas ao Interos) */
  companyIds: string[] | null;
  /** nomes das variáveis com o segredo HMAC das gravações (rotação: mais de um vale ao mesmo tempo) */
  signingSecretEnvs: string[];
}

function toClient(c: ServiceClient): InterosClient {
  return { id: c.id, scopes: c.escopos.filter((s): s is InterosScope => (INTEROS_SCOPES as string[]).includes(s)), companyIds: c.empresas, signingSecretEnvs: c.assinatura };
}

/** Segredos de assinatura válidos do cliente (vazio = gravações recusadas com `signing_not_configured`). */
export function signingSecretsOf(c: InterosClient): string[] {
  return signingSecrets({ assinatura: c.signingSecretEnvs });
}

/**
 * A credencial alcança a empresa?
 * - com `empresas`: só as da lista, vinculadas ao Interos ou não (homologação: as do piloto);
 * - sem lista: só as empresas ligadas ao Interos (`interosAccountId` preenchido: criadas pelo provisionamento ou
 *   vinculadas com o código do administrador), a mesma regra do provisionamento e da Torre. Empresa não vinculada não
 *   existe para o Interos.
 */
export function reachesCompanyDoc(c: InterosClient, company: { id?: string | null; interosAccountId?: string | null } | null | undefined): boolean {
  if (!company?.id) return false;
  return c.companyIds ? c.companyIds.includes(String(company.id)) : Boolean(company.interosAccountId);
}

/** A empresa da rota é alcançada? Sem lista, lê só aquela empresa (inexistente = não alcançada). */
export async function reachesCompanyId(store: Store, c: InterosClient, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  if (c.companyIds) return c.companyIds.includes(companyId);
  return reachesCompanyDoc(c, await store.get("companies", companyId));
}

/** Filtro por id para as listas que só têm o id da empresa: sem lista, carrega uma vez as empresas ligadas. */
export async function reachFilter(store: Store, c: InterosClient): Promise<(companyId: string | null | undefined) => boolean> {
  const ids = c.companyIds ?? (await listAll(store, "companies", { filters: [["notNull", "interosAccountId"]] })).map((x) => String(x.id));
  const set = new Set(ids);
  return (companyId) => companyId != null && set.has(companyId);
}

export type AuthResult = { ok: true; client: InterosClient } | { ok: false; status: 401 | 403 | 503; code: string; message: string };

export function authenticateInteros(authorization: string | null | undefined, required: InterosScope): AuthResult {
  if (!serviceConfigured()) return { ok: false, status: 503, code: "integration_not_configured", message: "Integração Interos não configurada no ERP (INTEROS_CREDENCIAIS)." };
  const c = authenticateService(authorization);
  if (!c) return { ok: false, status: 401, code: "unauthenticated", message: "Credencial ausente ou inválida. Envie Authorization: Bearer <id>.<segredo>." };
  if (!hasScope(c, required)) return { ok: false, status: 403, code: "insufficient_scope", message: `Escopo exigido: ${required}.` };
  return { ok: true, client: toClient(c) };
}
