import { validationError } from "@/lib/service/errors";

/**
 * Paginação por cursor das listas da Torre (`limite` + `cursor` opaco; resposta `{ itens, proximoCursor }`).
 *
 * Paginação por CHAVE (não por deslocamento): cada lista tem uma ordem total (a última parte da chave é sempre um id
 * único) e o cursor guarda a chave do último item entregue. A página seguinte começa no primeiro item estritamente
 * depois dessa chave — por isso nenhum item se repete nem é pulado, mesmo que registros novos entrem entre as chamadas
 * (um registro novo que caia antes do cursor fica para a próxima varredura). O cursor carrega a impressão digital da
 * consulta (rota, empresa, período, unidades e filtros): usado em outra consulta, é recusado com 422.
 */

export type KeyPart = string | number;
export type CursorKey = KeyPart[];
export type Dir = "asc" | "desc";

interface CursorBody {
  v: 1;
  f: string;
  k: CursorKey;
}

export function encodeCursor(fingerprint: string, key: CursorKey): string {
  const body: CursorBody = { v: 1, f: fingerprint, k: key };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/** Cursor válido para esta consulta → chave do último item entregue; senão null. */
export function decodeCursor(raw: string, fingerprint: string): CursorKey | null {
  if (raw.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<CursorBody>;
    if (!body || body.v !== 1 || body.f !== fingerprint || !Array.isArray(body.k) || !body.k.length) return null;
    if (!body.k.every((p) => typeof p === "string" || (typeof p === "number" && Number.isFinite(p)))) return null;
    return body.k;
  } catch {
    return null;
  }
}

function cmpPart(a: KeyPart, b: KeyPart): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function compareKeys(a: CursorKey, b: CursorKey, dirs: Dir[]): number {
  for (let i = 0; i < dirs.length; i++) {
    const c = cmpPart(a[i], b[i]);
    if (c !== 0) return dirs[i] === "desc" ? -c : c;
  }
  return 0;
}

/**
 * Ordena pela chave e devolve a página depois do cursor. `keyOf` deve terminar num id único (ordem total).
 * O cursor precisa ter o mesmo formato da chave da lista (senão 422).
 */
export function pageBy<T>(rows: T[], keyOf: (r: T) => CursorKey, dirs: Dir[], page: { limit: number; after: CursorKey | null; fingerprint: string }): { itens: T[]; proximoCursor: string | null } {
  if (page.after && page.after.length !== dirs.length) throw validationError([{ campo: "cursor", mensagem: "Cursor inválido ou de outra consulta: repita a consulta sem cursor." }]);
  const keyed = rows.map((r) => ({ r, k: keyOf(r) })).sort((a, b) => compareKeys(a.k, b.k, dirs));
  const after = page.after;
  const start = after ? keyed.findIndex((x) => compareKeys(x.k, after, dirs) > 0) : 0;
  const rest = start < 0 ? [] : keyed.slice(start);
  const slice = rest.slice(0, page.limit);
  const more = rest.length > slice.length;
  return { itens: slice.map((x) => x.r), proximoCursor: more && slice.length ? encodeCursor(page.fingerprint, slice[slice.length - 1].k) : null };
}
