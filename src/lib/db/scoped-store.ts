import { COLLECTION_MAP } from "./schema";
import { BusinessError } from "../core/errors";
import type { Doc, Filter, ListOptions, ListResult, Store, WriteGuard } from "./types";

/**
 * Isolamento por empresa (defesa em profundidade) — docs/multiempresa/arquitetura.md §2.
 *
 * Envolve o Store do contexto de uma requisição/tarefa. Em modo ESTRITO (padrão):
 *  - tabelas com `companyId`: leitura, listagem, alteração, exclusão e incremento só alcançam registros da empresa
 *    ativa — a listagem sempre recebe o filtro da empresa, mesmo quando a consulta já menciona `companyId` (outra
 *    empresa resulta em vazio); as gravações por id levam a condição de dono na própria instrução ao banco
 *    (`WriteGuard`), e registro de outra empresa é tratado como inexistente;
 *  - criação sem `companyId` recebe a empresa ativa; criação ou alteração com `companyId` de outra empresa é recusada;
 *  - `users` (identidade global): só os vinculados à empresa (`companyIds`) são listados e alterados; o administrador
 *    da plataforma tem o nome legível (autoria), mas não aparece em listas nem pode ser alterado daqui;
 *  - `companies`: só a própria empresa;
 *  - tabelas da plataforma (`PLATFORM_ONLY`): inacessíveis;
 *  - registro sem empresa (`companyId` nulo) só é comum a todas nas tabelas de conteúdo global (`SHARED_GLOBAL`);
 *  - chamados abertos na tela de login (`companyId = "public"`) só para a empresa da plataforma (atendimento Intercert).
 * Operações deliberadamente multiempresa (criar empresa, vínculos explícitos, rotinas da plataforma) usam `unscoped()`.
 *
 * Ativação gradual e reversão: `MULTIEMPRESA_ISOLAMENTO` = `estrito` (padrão) | `observar` (comportamento anterior,
 * registrando em `tenancy_violations` o que seria barrado) | `legado` (comportamento anterior, sem registro).
 */

export type IsolationMode = "estrito" | "observar" | "legado";

export function isolationMode(): IsolationMode {
  const v = String(process.env.MULTIEMPRESA_ISOLAMENTO ?? "").trim().toLowerCase();
  return v === "observar" || v === "legado" ? v : "estrito";
}

const PUBLIC_OK = new Set(["tickets", "ticket_messages"]);
/** Conteúdo global legítimo (sem empresa): modelos de perfil, artigos de ajuda e o estado do simulador fiscal. */
export const SHARED_GLOBAL = new Set(["roles", "help_articles", "fiscal_sim_state"]);
/** Tabelas da plataforma: nenhum Store restrito a uma empresa lê ou grava nelas. */
export const PLATFORM_ONLY = new Set(["service_requests", "tenant_provisionings", "company_relations", "tenancy_reviews", "tenancy_violations", "migration_runs"]);

export interface ScopeOptions {
  /** empresa da plataforma (Intercert): atende os chamados abertos na tela de login */
  platform?: boolean;
}

function hasCompany(collection: string) {
  return Boolean(COLLECTION_MAP[collection]?.fields.companyId);
}

function companyValues(filters: Filter[] | undefined, out: Array<unknown> = []): unknown[] {
  for (const f of filters ?? []) {
    if (f[0] === "or" || f[0] === "and") companyValues(f[1] as Filter[], out);
    else if (f[1] === "companyId") out.push(...(Array.isArray(f[2]) ? f[2] : [f[2]]));
  }
  return out;
}

function mentionsCompany(filters: Filter[] | undefined): boolean {
  for (const f of filters ?? []) {
    if (f[0] === "or" || f[0] === "and") {
      if (mentionsCompany(f[1] as Filter[])) return true;
    } else if (f[1] === "companyId") return true;
  }
  return false;
}

function cross(message = "Operação bloqueada: o registro pertence a outra empresa."): BusinessError {
  return new BusinessError(message, "cross_company");
}

// ─── registro das tentativas (observar/estrito) ──────────────────────────────────────────────────────────────────

let recording = false;
async function recordViolation(v: { op: string; collection: string; scopeCompanyId: string; targetCompanyId?: string | null; recordId?: string | null }) {
  const mode = isolationMode();
  if (mode === "legado" || recording) return;
  const caller = (new Error().stack ?? "")
    .split("\n")
    .slice(3)
    .filter((l) => /src\//.test(l) && !/scoped-store/.test(l))
    .slice(0, 3)
    .map((l) => l.trim().replace(/^at /, "").replace(/\(.*?src\//, "(src/"))
    .join(" ← ")
    .slice(0, 480);
  console.warn(`[isolamento:${mode}] ${v.op} ${v.collection} da empresa ${v.targetCompanyId ?? "?"} a partir da empresa ${v.scopeCompanyId || "(nenhuma)"} — ${caller}`);
  recording = true;
  try {
    const { getStore, detId } = await import("./index");
    const store = getStore();
    const day = new Date().toISOString().slice(0, 10);
    const id = detId("tviol", mode, v.op, v.collection, v.scopeCompanyId, v.targetCompanyId ?? "", caller, day);
    const now = new Date().toISOString();
    const cur = await store.get("tenancy_violations", id).catch(() => null);
    if (cur) await store.update("tenancy_violations", id, { count: (cur.count ?? 1) + 1, lastAt: now });
    else await store.create("tenancy_violations", { mode, op: v.op, collection: v.collection, scopeCompanyId: v.scopeCompanyId, targetCompanyId: v.targetCompanyId ?? null, recordId: v.recordId ?? null, caller, count: 1, day, firstAt: now, lastAt: now }, id);
  } catch {
    // registro é melhor esforço: nunca derruba a operação
  } finally {
    recording = false;
  }
}

export class ScopedStore implements Store {
  constructor(
    readonly base: Store,
    readonly companyId: string,
    readonly options: ScopeOptions = {},
  ) {}

  get backend() {
    return this.base.backend;
  }

  private get mode() {
    return isolationMode();
  }

  /** Visibilidade de um registro já lido, pelas regras do modo. */
  private visible(collection: string, doc: Doc | null): boolean {
    if (!doc) return false;
    const mode = this.mode;
    if (PLATFORM_ONLY.has(collection)) return mode === "legado";
    if (collection === "users") return mode !== "estrito" || this.isMember(doc) || Boolean((doc as any).isAdmin);
    if (collection === "companies") return mode !== "estrito" || doc.id === this.companyId;
    if (!hasCompany(collection)) return true;
    const c = (doc as any).companyId;
    if (c != null && c === this.companyId) return true;
    if (c == null) return mode !== "estrito" || SHARED_GLOBAL.has(collection);
    if (c === "public" && PUBLIC_OK.has(collection)) return mode !== "estrito" || Boolean(this.options.platform);
    return false;
  }

  private isMember(doc: Doc): boolean {
    return Boolean(this.companyId) && ((doc as any).companyIds ?? []).includes(this.companyId);
  }

  private guard(): WriteGuard | undefined {
    return this.mode === "estrito" && this.companyId ? { companyId: this.companyId } : undefined;
  }

  async get<T = any>(collection: string, id: string): Promise<Doc<T> | null> {
    const d = await this.base.get<T>(collection, id);
    if (this.visible(collection, d)) return d;
    if (d && this.mode === "observar" && hasCompany(collection) && (d as any).companyId && (d as any).companyId !== this.companyId)
      void recordViolation({ op: "get", collection, scopeCompanyId: this.companyId, targetCompanyId: (d as any).companyId, recordId: id });
    return null;
  }

  async getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>> {
    const d = await this.get<T>(collection, id);
    if (!d) {
      const { NotFoundError } = await import("./types");
      throw new NotFoundError(collection, id);
    }
    return d;
  }

  list<T = any>(collection: string, opts: ListOptions = {}): Promise<ListResult<Doc<T>>> {
    const mode = this.mode;
    if (PLATFORM_ONLY.has(collection) && mode !== "legado") return Promise.resolve({ items: [], total: 0 } as ListResult<Doc<T>>);
    if (mode === "estrito") {
      if (collection === "users") return this.base.list<T>(collection, { ...opts, filters: [...(opts.filters ?? []), ["contains", "companyIds", this.companyId || "\u0000"]] });
      if (collection === "companies") return this.base.list<T>(collection, { ...opts, filters: [...(opts.filters ?? []), ["eq", "id", this.companyId || "\u0000"]] });
    }
    if (!hasCompany(collection)) return this.base.list<T>(collection, opts);
    if (mode !== "estrito" && mentionsCompany(opts.filters)) {
      // comportamento anterior: o filtro explícito dispensa o escopo — em "observar", registra se apontou outra empresa
      if (mode === "observar") {
        const foreign = companyValues(opts.filters).find((v) => v != null && v !== this.companyId && v !== "public");
        if (foreign) void recordViolation({ op: "list", collection, scopeCompanyId: this.companyId, targetCompanyId: String(foreign) });
      }
      return this.base.list<T>(collection, opts);
    }
    const allowed: Filter[] = [["eq", "companyId", this.companyId || "\u0000"]];
    if (mode !== "estrito" || SHARED_GLOBAL.has(collection)) allowed.push(["isNull", "companyId"]);
    if (PUBLIC_OK.has(collection) && (mode !== "estrito" || this.options.platform)) allowed.push(["eq", "companyId", "public"]);
    const scope: Filter = allowed.length === 1 ? allowed[0] : ["or", allowed];
    if (mode === "estrito" && mentionsCompany(opts.filters)) {
      const foreign = companyValues(opts.filters).find((v) => v != null && v !== this.companyId && v !== "public");
      if (foreign) void recordViolation({ op: "list", collection, scopeCompanyId: this.companyId, targetCompanyId: String(foreign) });
    }
    return this.base.list<T>(collection, { ...opts, filters: [...(opts.filters ?? []), scope] });
  }

  async create<T = any>(collection: string, data: Partial<T> & Record<string, any>, id?: string): Promise<Doc<T>> {
    const mode = this.mode;
    if (mode !== "legado") {
      if (PLATFORM_ONLY.has(collection)) throw cross("Tabela da plataforma: não pode ser gravada a partir de uma empresa.");
      if (mode === "estrito" && collection === "companies") throw cross("Empresas novas são criadas pela plataforma (provisionamento), não a partir de outra empresa.");
      if (mode === "estrito" && collection === "users" && !(data.companyIds ?? []).includes(this.companyId)) {
        void recordViolation({ op: "create", collection, scopeCompanyId: this.companyId, recordId: id ?? null });
        throw cross("O usuário criado a partir de uma empresa precisa estar vinculado a ela.");
      }
    }
    if (hasCompany(collection)) {
      if ("companyId" in data) this.assertCompanyValue(collection, data.companyId, "create", id ?? null);
      else if (mode === "estrito" && this.companyId) data = { ...data, companyId: this.companyId };
    }
    return this.base.create<T>(collection, data, id);
  }

  /** Valor de `companyId` gravado: só a própria empresa (ou nulo/"public" nas tabelas em que isso é legítimo). */
  private assertCompanyValue(collection: string, c: unknown, op: string, recordId: string | null) {
    const mode = this.mode;
    if (c === this.companyId && this.companyId) return;
    if (c == null) {
      if (mode !== "estrito" || SHARED_GLOBAL.has(collection)) return;
      throw cross("Registro sem empresa não pode ser gravado a partir de uma empresa.");
    }
    if (c === "public" && PUBLIC_OK.has(collection)) return;
    // outra empresa no conteúdo gravado: recusado em todos os modos (já era assim antes do multiempresa)
    void recordViolation({ op, collection, scopeCompanyId: this.companyId, targetCompanyId: String(c), recordId });
    throw cross();
  }

  /** Alvo de uma gravação por id em `users`/`companies` (sem coluna de empresa: confere o vínculo lendo antes). */
  private async assertIdentityTarget(collection: "users" | "companies", id: string, op: string) {
    const cur = await this.base.get(collection, id);
    if (!cur) return;
    const ok = collection === "users" ? this.isMember(cur) : cur.id === this.companyId;
    if (ok) return;
    void recordViolation({ op, collection, scopeCompanyId: this.companyId, targetCompanyId: collection === "companies" ? cur.id : ((cur as any).companyIds ?? []).join(",") || null, recordId: id });
    if (this.mode === "estrito") {
      const { NotFoundError } = await import("./types");
      throw new NotFoundError(collection, id);
    }
  }

  /** Em "observar": descobre (lendo antes) se a gravação atingiria registro de outra empresa, para registrar. */
  private async observeWrite(collection: string, id: string, op: string) {
    if (this.mode !== "observar" || !hasCompany(collection)) return;
    const cur = await this.base.get(collection, id);
    const c = (cur as any)?.companyId;
    if (cur && c != null && c !== this.companyId && !(c === "public" && PUBLIC_OK.has(collection)))
      void recordViolation({ op, collection, scopeCompanyId: this.companyId, targetCompanyId: c, recordId: id });
  }

  /** Estrito: gravação recusada por dono diferente → registra a tentativa (se o registro existe em outra empresa). */
  private async noteBlocked(collection: string, id: string, op: string) {
    const cur = await this.base.get(collection, id).catch(() => null);
    const c = (cur as any)?.companyId;
    if (cur && c !== this.companyId) void recordViolation({ op, collection, scopeCompanyId: this.companyId, targetCompanyId: c ?? null, recordId: id });
  }

  async update<T = any>(collection: string, id: string, patch: Partial<T> & Record<string, any>): Promise<Doc<T>> {
    const mode = this.mode;
    if (mode !== "legado" && PLATFORM_ONLY.has(collection)) throw cross("Tabela da plataforma: não pode ser alterada a partir de uma empresa.");
    if (mode !== "legado" && (collection === "users" || collection === "companies")) await this.assertIdentityTarget(collection, id, "update");
    if (hasCompany(collection) && "companyId" in patch) this.assertCompanyValue(collection, patch.companyId, "update", id);
    await this.observeWrite(collection, id, "update");
    const guard = hasCompany(collection) ? this.guard() : undefined;
    try {
      return await this.base.update<T>(collection, id, patch, guard);
    } catch (e) {
      if (guard && (e as Error)?.name === "NotFoundError") await this.noteBlocked(collection, id, "update");
      throw e;
    }
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const mode = this.mode;
    if (mode !== "legado" && PLATFORM_ONLY.has(collection)) throw cross("Tabela da plataforma: não pode ser alterada a partir de uma empresa.");
    if (mode !== "legado" && (collection === "users" || collection === "companies")) await this.assertIdentityTarget(collection, id, "delete");
    await this.observeWrite(collection, id, "delete");
    const guard = hasCompany(collection) ? this.guard() : undefined;
    const done = await this.base.delete(collection, id, guard);
    if (guard && done === false) await this.noteBlocked(collection, id, "delete");
    return done !== false;
  }

  async increment(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }) {
    const mode = this.mode;
    if (mode !== "legado" && PLATFORM_ONLY.has(collection)) throw cross("Tabela da plataforma: não pode ser alterada a partir de uma empresa.");
    if (mode !== "legado" && (collection === "users" || collection === "companies")) await this.assertIdentityTarget(collection, id, "increment");
    await this.observeWrite(collection, id, "increment");
    const guard = hasCompany(collection) ? this.guard() : undefined;
    try {
      return await this.base.increment(collection, id, field, by, bounds, guard);
    } catch (e) {
      if (guard && (e as Error)?.name === "NotFoundError") await this.noteBlocked(collection, id, "increment");
      throw e;
    }
  }

  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    return this.base.transaction((t) => fn(t === this.base ? this : new ScopedStore(t, this.companyId, this.options)));
  }
}

/** Store restrito à empresa. Sem empresa (contexto técnico global), devolve o Store informado. */
export function scopeStore(store: Store, companyId: string, options: ScopeOptions = {}): Store {
  if (!companyId) return store;
  const base = store instanceof ScopedStore ? store.base : store;
  return new ScopedStore(base, companyId, options);
}

/** Store sem restrição — uso explícito e auditado (ex.: criação de empresa). */
export function unscoped(store: Store): Store {
  return store instanceof ScopedStore ? store.base : store;
}
