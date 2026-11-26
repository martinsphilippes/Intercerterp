import crypto from "node:crypto";

/**
 * Credenciais dos sistemas que usam a interface de serviço do ERP (hoje, o Interos) — REGISTRO ÚNICO das três APIs:
 * provisionamento e Torre de Controle (`/api/interos/v1/status` e `/api/interos/v1/empresas/...`) e licenças e módulos
 * (`/api/interos/v2/...` e `/api/interos/v1/catalog|companies|operations`). Contrato: docs/interos/credenciais.md.
 *
 * Cada credencial tem um identificador, escopos de UMA família e o HASH do segredo — o segredo em si nunca fica no ERP.
 * Configuração na variável `INTEROS_CREDENCIAIS` (JSON):
 *   [{ "id": "interos-prov", "nome": "Interos — provisionamento", "escopos": ["provisionamento:leitura","provisionamento:escrita"],
 *      "hash": "sha256:<hex do sha256 do segredo>" },
 *    { "id": "interos-torre", "nome": "Interos — Torre de Controle", "escopos": ["torre:resumo","torre:detalhe"], "hash": "sha256:…" },
 *    { "id": "interos-licencas", "nome": "Interos — licenças", "escopos": ["erp.license.read","erp.license.write","erp.modules.read","erp.usage.read"],
 *      "hash": "sha256:…", "empresas": ["<id da empresa no ERP>", "…"], "assinatura": "INTEROS_ASSINATURA" }]
 * O sistema chamador envia `Authorization: Bearer <id>.<segredo>` nas três APIs.
 *  - Famílias separadas (provisionamento, Torre, licenças): uma credencial com escopos de duas famílias é recusada —
 *    quem consulta indicadores não cria empresas, quem aplica licença não suspende conta.
 *  - `empresas` (opcional): as únicas empresas que a credencial alcança (homologação: só as do piloto). Ausente = todas.
 *  - `assinatura` (opcional; obrigatória para gravar licença e módulos): NOME da variável com o segredo HMAC das
 *    gravações (`X-Interos-Signature`), ou uma lista de nomes durante a troca do segredo (vale qualquer um deles).
 *  - Rotação sem parada: cadastre a credencial nova (outro id) junto com a antiga, troque no Interos e só então remova
 *    a antiga; o segredo de assinatura troca do mesmo jeito (lista com os dois nomes).
 * Gerador: `node scripts/interos/credencial.mjs <id> <escopo> [escopo...]` (mostra o segredo uma única vez).
 */

export const SCOPE_FAMILIES = {
  provisionamento: ["provisionamento:leitura", "provisionamento:escrita"],
  torre: ["torre:resumo", "torre:detalhe", "torre:transacoes"],
  licencas: ["erp.license.read", "erp.license.write", "erp.modules.read", "erp.modules.write", "erp.usage.read"],
} as const;

export type ScopeFamily = keyof typeof SCOPE_FAMILIES;
export type ServiceScope = (typeof SCOPE_FAMILIES)[ScopeFamily][number];
export const SERVICE_SCOPES = Object.values(SCOPE_FAMILIES).flat() as ServiceScope[];

export function familyOf(scope: string): ScopeFamily | null {
  for (const [f, list] of Object.entries(SCOPE_FAMILIES)) if ((list as readonly string[]).includes(scope)) return f as ScopeFamily;
  return null;
}

export interface ServiceClient {
  id: string;
  nome: string;
  escopos: ServiceScope[];
  familia: ScopeFamily;
  /** empresas que a credencial alcança (null = todas) */
  empresas: string[] | null;
  /** nomes das variáveis com o segredo HMAC das gravações (vazio = sem assinatura) */
  assinatura: string[];
}

interface CredentialDef extends ServiceClient {
  hash: string;
}

const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,80}$/;
const COMPANY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

let override: CredentialDef[] | null = null;

/** Testes e roteiros: credenciais definidas em código (substitui a variável de ambiente). */
export function setServiceCredentials(defs: Array<{ id: string; nome?: string; escopos: string[]; segredo?: string; hash?: string; empresas?: string[] | null; assinatura?: string | string[] }> | null) {
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
  // escopos separados: uma credencial, uma família
  const familias = new Set<ScopeFamily | null>(escopos.map((e: ServiceScope) => familyOf(e)));
  if (familias.size !== 1) return null;
  let empresas: string[] | null = null;
  if (raw.empresas != null) {
    if (!Array.isArray(raw.empresas) || !raw.empresas.length || raw.empresas.some((c: unknown) => typeof c !== "string" || !COMPANY_ID_RE.test(c))) return null;
    empresas = [...new Set(raw.empresas as string[])];
  }
  const assinatura = (raw.assinatura == null ? [] : Array.isArray(raw.assinatura) ? raw.assinatura : [raw.assinatura]).map(String);
  if (assinatura.some((n: string) => !ENV_NAME_RE.test(n))) return null;
  const familia = [...familias][0];
  if (!familia) return null;
  return { id, nome: String(raw.nome ?? id).slice(0, 120), escopos, familia, empresas, assinatura, hash };
}

function loadDefs(): CredentialDef[] {
  if (override) return override;
  const raw = process.env.INTEROS_CREDENCIAIS;
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = (Array.isArray(parsed) ? parsed : [parsed]).map(normalize);
    const ok = list.filter((d): d is CredentialDef => Boolean(d));
    if (ok.length !== list.length) console.warn(`[servico] ${list.length - ok.length} credencial(is) de INTEROS_CREDENCIAIS ignorada(s): id, escopos (de uma só família), empresas, assinatura ou hash inválidos.`);
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
  if (!def || !same) return null;
  const { hash: _hash, ...client } = def;
  return { ...client, escopos: [...def.escopos], empresas: def.empresas ? [...def.empresas] : null, assinatura: [...def.assinatura] };
}

export function hasScope(client: ServiceClient, scope: ServiceScope): boolean {
  return client.escopos.includes(scope);
}

/** A credencial alcança esta empresa? (`empresas` ausente = todas) */
export function reachesCompany(client: Pick<ServiceClient, "empresas">, companyId: string | null | undefined): boolean {
  return !client.empresas || (companyId != null && client.empresas.includes(companyId));
}

/** Segredos HMAC válidos da credencial (variáveis definidas, com 32 caracteres ou mais), na ordem cadastrada. */
export function signingSecrets(client: Pick<ServiceClient, "assinatura">): string[] {
  return client.assinatura.map((n) => process.env[n] ?? "").filter((v) => v.length >= 32);
}

/** Gera um segredo novo (base64url, 256 bits) e a linha de configuração correspondente. */
export function newServiceSecret(id: string, escopos: ServiceScope[], nome?: string, extra: { empresas?: string[]; assinatura?: string } = {}) {
  const segredo = crypto.randomBytes(32).toString("base64url");
  return { token: `${id}.${segredo}`, config: { id, nome: nome ?? id, escopos, hash: `sha256:${sha256Hex(segredo)}`, ...(extra.empresas ? { empresas: extra.empresas } : {}), ...(extra.assinatura ? { assinatura: extra.assinatura } : {}) } };
}
