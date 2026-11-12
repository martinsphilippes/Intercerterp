import { AppwriteException } from "node-appwrite";

/**
 * Indisponibilidade do banco: situações em que NINGUÉM consegue entrar, qualquer que seja o usuário ou a senha.
 * A tela de login e as ações de acesso usam esta classificação para dizer o motivo em vez de falhar em silêncio
 * (lista de acessos vazia) ou com um "erro no servidor" genérico.
 *
 *  - paused: projeto do Appwrite Cloud pausado por inatividade (plano gratuito) — só o titular reativa, no console;
 *  - quota: o Appwrite está limitando o banco porque a organização passou da cota do plano (no gratuito, 500 mil
 *    leituras por mês, contadas por linha lida) — libera na virada do período ou com o upgrade do plano;
 *  - credentials: o servidor foi recusado (chave/projeto incorretos, expirados ou sem escopo, ou acesso da organização
 *    restrito pelo Appwrite) — configuração ou plano;
 *  - unreachable: rede, tempo esgotado ou erro interno do serviço — costuma ser passageiro.
 */
export type DbOutageKind = "paused" | "quota" | "credentials" | "unreachable";

export interface DbOutage {
  kind: DbOutageKind;
  /** Detalhe técnico para o log do servidor (mensagem do serviço). Não vai para a tela. */
  detail: string;
}

type AppwriteLike = { name?: unknown; code?: unknown; type?: unknown; message?: unknown };

// comparação estrutural além do instanceof (mesmo motivo de isConflict/isNotFound: em desenvolvimento a classe lançada
// pode vir de outro grafo de módulos)
function isAppwriteError(e: unknown): e is { code: number; type: string; message: string } {
  return e instanceof AppwriteException || (typeof e === "object" && e !== null && (e as AppwriteLike).name === "AppwriteException");
}

// códigos de transporte (DNS, conexão, TLS); os do undici (cliente HTTP do Node) começam por UND_ERR_
const NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EPIPE", "EPROTO",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** Falha de transporte do `fetch` (DNS, conexão recusada/derrubada, tempo esgotado, incompatibilidade do runtime). */
function isNetworkError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown } | null };
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const code = typeof err.code === "string" ? err.code : typeof err.cause?.code === "string" ? err.cause.code : "";
  if (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_")) return true;
  return err.name === "TypeError" && typeof err.message === "string" && /fetch failed/i.test(err.message);
}

/**
 * Cota do plano: o Appwrite documenta que, no plano gratuito, as operações do banco são limitadas quando a cota do mês
 * acaba, mas não publica o tipo do erro. Vale então o que a resposta diz: 429 numa chamada do servidor (a chave de API
 * não passa pelo limite de requisições por visitante) ou tipo/mensagem que fale de uso, cota, plano, cobrança ou
 * congelamento. Estados do próprio usuário (`user_*`: bloqueado, limite de usuários) não entram.
 */
function isQuotaError(code: number, type: string, message: string): boolean {
  if (type.startsWith("user_")) return false;
  if (code === 429) return true;
  return code >= 400 && code < 500 && /usage|quota|billing|budget|free plan|plan limit|frozen|freez|throttl|resource_blocked/i.test(`${type} ${message}`);
}

/**
 * Classifica um erro de acesso ao banco. `null` = não é indisponibilidade (regra de negócio, registro inexistente,
 * consulta inválida, erro de programação): quem chamou decide o que fazer.
 */
export function dbOutageOf(e: unknown): DbOutage | null {
  if (isAppwriteError(e)) {
    const code = Number(e.code) || 0;
    const type = String(e.type ?? "");
    const detail = `${type || "appwrite"} (${code}): ${e.message}`;
    if (type === "project_paused") return { kind: "paused", detail };
    if (isQuotaError(code, type, String(e.message ?? ""))) return { kind: "quota", detail };
    if (code === 401 || code === 403) return { kind: "credentials", detail };
    if (code === 0 || code >= 500) return { kind: "unreachable", detail };
    return null;
  }
  if (isNetworkError(e)) {
    const err = e as { message?: unknown; cause?: { code?: unknown; message?: unknown } };
    const cause = err.cause?.code ?? err.cause?.message;
    return { kind: "unreachable", detail: `${String(err.message ?? e)}${cause ? ` (${String(cause)})` : ""}` };
  }
  return null;
}

/** Frase curta para o erro do formulário e o aviso flutuante: deixa claro que não é a senha e quem resolve. */
export function outageMessage(o: DbOutage): string {
  switch (o.kind) {
    case "paused":
      return "O banco de dados está pausado por inatividade (Appwrite). Não é problema de usuário nem de senha: ninguém consegue entrar até o projeto ser reativado no console do Appwrite.";
    case "quota":
      return "O banco de dados está com o acesso limitado pelo Appwrite (limite do plano atingido). Não é problema de usuário nem de senha: ninguém consegue entrar até o limite ser liberado.";
    case "credentials":
      return "O servidor não conseguiu abrir o banco de dados (acesso recusado). Não é problema de usuário nem de senha: avise o administrador do sistema.";
    case "unreachable":
      return "O banco de dados não respondeu agora. Não é problema de usuário nem de senha: aguarde alguns instantes e tente de novo.";
  }
}
