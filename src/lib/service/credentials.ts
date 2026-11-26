import crypto from "node:crypto";

/**
 * Credenciais dos sistemas que usam a interface de serviço do ERP (hoje, o Interos).
 *
 * Cada cliente de serviço tem um identificador, escopos e o HASH do segredo — o segredo em si nunca fica no ERP.
 * Configuração na variável `INTEROS_CREDENCIAIS` (JSON):
 *   [{ "id": "interos-prov", "nome": "Interos — provisionamento", "escopos": ["provisionamento:leitura","provisionamento:escrita"],
 *      "hash": "sha256:<hex do sha256 do segredo>" },
 *    { "id": "interos-torre", "nome": "Interos — Torre de Controle", "escopos": ["torre:resumo","torre:detalhe"], "hash": "sha256:…" }]
 * O sistema chamador envia `Authorization: Bearer <id>.<segredo>`. Provisionamento e consultas analíticas usam
 * credenciais diferentes (escopos separados): quem consulta indicadores não cria nem suspende empresas.
 * Rotação: cadastre uma credencial nova (outro id), troque no Interos e só então remova a antiga.
 * Gerador: `node scripts/interos/credencial.mjs <id> <escopo> [escopo...]` (mostra o segredo uma única vez).
 */

export const SERVICE_SCOPES = [
  "provisionamento:leitura",
  "provisionamento:escrita",
  "torre:resumo",
  "torre:detalhe",
  "torre:transacoes",
] as const;

export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export interface ServiceClient {
  id: string;
  nome: string;
  escopos: ServiceScope[];
}

interface CredentialDef extends ServiceClient {
  hash: string;
}

let override: CredentialDef[] | null = null;

/** Testes e roteiros: credenciais definidas em código (substitui a variável de ambiente). */
export function setServiceCredentials(defs: Array<{ id: string; nome?: string; escopos: string[]; segredo?: string; hash?: string }> | null) {
  override = defs ? defs.map((d) => normalize({ ...d, hash: d.hash ?? `sha256:${sha256Hex(d.segredo ?? "")}` })).filter((d): d is CredentialDef => Boolean(d)) : null;
}

export function sha256Hex(v: string): string {
  return crypto.createHash("sha256").update(v, "utf8").digest("hex");
}

function normalize(raw: any): CredentialDef | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? "").trim();
  const hash = String(raw.hash ?? "").trim().replace(/^sha256:/i, "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id) || !/^[0-9a-f]{64}$/.test(hash)) return null;
  if (raw.ativo === false) return null;
  const escopos = (Array.isArray(raw.escopos) ? raw.escopos : []).filter((s: string): s is ServiceScope => (SERVICE_SCOPES as readonly string[]).includes(s));
  if (!escopos.length) return null;
  return { id, nome: String(raw.nome ?? id).slice(0, 120), escopos, hash };
}

function loadDefs(): CredentialDef[] {
  if (override) return override;
  const raw = process.env.INTEROS_CREDENCIAIS;
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = (Array.isArray(parsed) ? parsed : [parsed]).map(normalize);
    const ok = list.filter((d): d is CredentialDef => Boolean(d));
    if (ok.length !== list.length) console.warn(`[servico] ${list.length - ok.length} credencial(is) de INTEROS_CREDENCIAIS ignorada(s): id, escopos ou hash inválidos.`);
    return ok;
  } catch {
    console.warn("[servico] INTEROS_CREDENCIAIS não é um JSON válido: a interface de serviço recusa todas as chamadas.");
    return [];
  }
}

/** Há alguma credencial configurada (sem isso a interface de serviço responde 503 com a explicação). */
export function serviceConfigured(): boolean {
  return loadDefs().length > 0;
}

/**
 * Autentica o cabeçalho `Authorization: Bearer <id>.<segredo>`. Compara o hash em tempo constante e nunca revela se o
 * identificador existe (qualquer falha é a mesma resposta).
 */
export function authenticateService(authorization: string | null | undefined): ServiceClient | null {
  const m = /^Bearer\s+([A-Za-z0-9._-]{3,64})\.([A-Za-z0-9_-]{32,256})$/.exec(String(authorization ?? "").trim());
  const defs = loadDefs();
  if (!m) return null;
  const [, id, secret] = m;
  const def = defs.find((d) => d.id === id);
  const got = Buffer.from(sha256Hex(secret), "hex");
  // compara mesmo quando o id não existe (tempo constante em relação à existência do id)
  const expected = Buffer.from(def?.hash ?? "0".repeat(64), "hex");
  const same = crypto.timingSafeEqual(got, expected);
  return def && same ? { id: def.id, nome: def.nome, escopos: [...def.escopos] } : null;
}

export function hasScope(client: ServiceClient, scope: ServiceScope): boolean {
  return client.escopos.includes(scope);
}

/** Gera um segredo novo (base64url, 256 bits) e a linha de configuração correspondente. */
export function newServiceSecret(id: string, escopos: ServiceScope[], nome?: string) {
  const segredo = crypto.randomBytes(32).toString("base64url");
  return { token: `${id}.${segredo}`, config: { id, nome: nome ?? id, escopos, hash: `sha256:${sha256Hex(segredo)}` } };
}
