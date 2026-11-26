import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getStore, isConflict, isNotFound } from "../db";
import type { Store } from "../db/types";
import { BusinessError, PermissionError } from "../core/errors";
import { authenticateService, hasScope, serviceConfigured, type ServiceClient, type ServiceScope } from "./credentials";
import { beginIdempotent, finishIdempotent, recordRead, requestFingerprint } from "./idempotency";
import { ServiceError } from "./errors";

/**
 * Interface de serviço v1 (Interos → ERP): autenticação por credencial com escopos, identificação de cada solicitação,
 * idempotência nas alterações, limite por minuto, erros num formato único e registro de cada chamada.
 * Contrato completo: docs/interos/contrato-interos-erp-v1.md.
 */

export const API_VERSION = "v1";

export { ServiceError, validationError, type FieldIssue } from "./errors";

export interface ServiceCall {
  client: ServiceClient;
  requestId: string;
  idempotencyKey: string | null;
  /** Store base (sem escopo): cada operação de serviço escolhe e confere explicitamente a empresa-alvo */
  store: Store;
  body: any;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string | null;
  /** endereço público do ERP (links de convite): APP_URL ou a origem da chamada */
  origin: string;
}

export interface ServiceResult {
  status?: number;
  body: unknown;
  /** empresa afetada/consultada (trilha da solicitação) */
  companyId?: string | null;
  /**
   * O que fica guardado para reenvios com a mesma Idempotency-Key, quando difere da resposta (ex.: o link do convite é
   * uma credencial — vai só na primeira resposta e nunca fica gravado; o reenvio indica como gerar outro).
   */
  replayBody?: unknown;
}

interface RouteOptions {
  /** basta um dos escopos */
  scope: ServiceScope | ServiceScope[];
  /** nome estável da operação (auditoria e idempotência) */
  operation: string;
  /** altera dados: exige Idempotency-Key e guarda a resposta para reenvios */
  mutation?: boolean;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,100}$/;
const IDEM_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_BODY_BYTES = 256 * 1024;

// limite por cliente e minuto (por instância): protege o ERP de um consumidor em laço
const windows = new Map<string, { start: number; count: number }>();
function rateLimited(clientId: string, mutation: boolean): number | null {
  const limit = Number(mutation ? process.env.INTEROS_LIMITE_ESCRITA_MINUTO || 60 : process.env.INTEROS_LIMITE_LEITURA_MINUTO || 240);
  const key = `${clientId}|${mutation ? "w" : "r"}`;
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= 60_000) {
    windows.set(key, { start: now, count: 1 });
    return null;
  }
  w.count++;
  return w.count > limit ? Math.ceil((w.start + 60_000 - now) / 1000) : null;
}

/** Só para testes: zera os contadores de limite. */
export function resetServiceRateLimits() {
  windows.clear();
}

function json(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "X-Request-Id": requestId, "Cache-Control": "no-store", "API-Version": API_VERSION, ...extra },
  });
}

function errorBody(requestId: string, codigo: string, mensagem: string, detalhes?: unknown) {
  return { erro: { codigo, mensagem, ...(detalhes && typeof detalhes === "object" ? detalhes : {}) }, requestId };
}

/** Converte qualquer erro no formato do contrato (sem detalhes internos em erros inesperados). */
export function toServiceError(e: unknown): ServiceError {
  if (e instanceof ServiceError) return e;
  if (e instanceof PermissionError) return new ServiceError(403, "sem_permissao", e.message);
  if (isNotFound(e)) return new ServiceError(404, "nao_encontrado", "Registro não encontrado.");
  if (isConflict(e)) return new ServiceError(409, "conflito", "Conflito com um registro existente. Consulte o estado antes de repetir.");
  if (e instanceof BusinessError) {
    const map: Record<string, [number, string]> = {
      not_found: [404, "nao_encontrado"],
      forbidden: [403, "sem_permissao"],
      duplicate: [409, "conflito"],
      conflict: [409, "conflito"],
      cross_company: [404, "nao_encontrado"],
      suspended: [423, "empresa_suspensa"],
    };
    const [status, codigo] = map[e.code] ?? [422, "regra_de_negocio"];
    return new ServiceError(status, codigo, e.message);
  }
  return new ServiceError(500, "erro_interno", "Erro inesperado no ERP. A solicitação pode ser repetida com a mesma Idempotency-Key.");
}

export function serviceRoute(opts: RouteOptions, handler: (call: ServiceCall) => Promise<ServiceResult>) {
  const scopes = Array.isArray(opts.scope) ? opts.scope : [opts.scope];
  return async (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }) => {
    const started = Date.now();
    const given = req.headers.get("x-request-id") ?? "";
    const requestId = REQUEST_ID_RE.test(given) ? given : `req_${crypto.randomBytes(12).toString("hex")}`;
    let clientId = "?";
    let status = 500;
    let companyId: string | null = null;
    try {
      if (!serviceConfigured()) throw new ServiceError(503, "servico_nao_configurado", "Interface de serviço sem credenciais configuradas (INTEROS_CREDENCIAIS).");
      const client = authenticateService(req.headers.get("authorization"));
      if (!client) {
        status = 401;
        return json(401, errorBody(requestId, "nao_autenticado", "Credencial ausente ou inválida."), requestId, { "WWW-Authenticate": 'Bearer realm="intercert-erp"' });
      }
      clientId = client.id;
      if (!scopes.some((s) => hasScope(client, s))) throw new ServiceError(403, "sem_permissao", `Esta credencial não tem o escopo exigido (${scopes.join(" ou ")}).`);
      const wait = rateLimited(client.id, Boolean(opts.mutation));
      if (wait != null) {
        status = 429;
        return json(429, errorBody(requestId, "limite_excedido", `Limite de solicitações por minuto atingido. Tente de novo em ${wait} s.`), requestId, { "Retry-After": String(wait) });
      }
      const params = (await ctx?.params) ?? {};
      // sem carga automática da demonstração aqui: a interface de serviço só lê e grava o que existe no banco
      const store = getStore();
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      const origin = (process.env.APP_URL || req.nextUrl.origin).replace(/\/$/, "");

      if (!opts.mutation) {
        const result = await handler({ client, requestId, idempotencyKey: null, store, body: null, params, query: req.nextUrl.searchParams, ip, origin });
        status = result.status ?? 200;
        companyId = result.companyId ?? null;
        await recordRead(store, { clientId: client.id, operation: opts.operation, companyId, requestId }).catch(() => undefined);
        return json(status, result.body, requestId);
      }

      const key = req.headers.get("idempotency-key") ?? "";
      if (!IDEM_KEY_RE.test(key)) throw new ServiceError(400, "idempotencia_obrigatoria", "Envie o cabeçalho Idempotency-Key (8 a 128 caracteres: letras, números, . _ : -) em toda solicitação que altera dados.");
      const raw = await req.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new ServiceError(413, "conteudo_grande_demais", "Corpo da solicitação acima de 256 KB.");
      let body: any = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new ServiceError(400, "json_invalido", "O corpo da solicitação não é um JSON válido.");
        }
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ServiceError(400, "json_invalido", "O corpo da solicitação deve ser um objeto JSON.");
      const path = req.nextUrl.pathname;
      const begin = await beginIdempotent(store, { clientId: client.id, key, fingerprint: requestFingerprint(req.method, path, body), operation: opts.operation, method: req.method, path, requestId });
      if (begin.kind === "conflict") throw new ServiceError(422, "idempotencia_conflito", "Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova para uma operação nova.");
      if (begin.kind === "busy") {
        status = 409;
        return json(409, errorBody(requestId, "solicitacao_em_andamento", "Uma solicitação com esta Idempotency-Key ainda está em processamento. Repita em alguns segundos."), requestId, { "Retry-After": "5" });
      }
      if (begin.kind === "replay") {
        status = begin.httpStatus;
        companyId = begin.record.targetCompanyId ?? null;
        return json(begin.httpStatus, begin.body, requestId, { "Idempotent-Replayed": "true" });
      }
      try {
        const result = await handler({ client, requestId, idempotencyKey: key, store, body, params, query: req.nextUrl.searchParams, ip, origin });
        status = result.status ?? 200;
        companyId = result.companyId ?? null;
        await finishIdempotent(store, begin.id, { httpStatus: status, body: result.replayBody !== undefined ? result.replayBody : result.body, companyId, outcome: "concluida" });
        return json(status, result.body, requestId);
      } catch (e) {
        const se = toServiceError(e);
        status = se.httpStatus;
        // erro do servidor: a chave fica liberada para retomar; erro de regra/validação é a resposta definitiva
        const definitive = se.httpStatus < 500;
        const body = errorBody(requestId, se.codigo, se.message, se.detalhes);
        if (se.httpStatus >= 500) console.error(`[servico] ${opts.operation} falhou`, e);
        await finishIdempotent(store, begin.id, { httpStatus: se.httpStatus, body, outcome: definitive ? "concluida" : "falhou", error: definitive ? se.codigo : String((e as Error)?.message ?? e).slice(0, 500) }).catch(() => undefined);
        return json(se.httpStatus, body, requestId);
      }
    } catch (e) {
      const se = toServiceError(e);
      status = se.httpStatus;
      if (se.httpStatus >= 500 && !(e instanceof ServiceError)) console.error(`[servico] ${opts.operation} falhou`, e);
      return json(se.httpStatus, errorBody(requestId, se.codigo, se.message, se.detalhes), requestId);
    } finally {
      console.info(JSON.stringify({ servico: opts.operation, cliente: clientId, status, ms: Date.now() - started, requestId, empresa: companyId }));
    }
  };
}
