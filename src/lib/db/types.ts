/** Armazenamentos aceitos (`DATA_BACKEND`): Postgres em produção; memória e disco local em desenvolvimento e testes. */
export const BACKENDS = ["postgres", "local", "memory"] as const;
export type Backend = (typeof BACKENDS)[number];

export type Scalar = string | number | boolean | null;

export type Filter =
  | ["eq", string, Scalar | Scalar[]]
  | ["ne", string, Scalar]
  | ["gt" | "gte" | "lt" | "lte", string, string | number]
  | ["between", string, string | number, string | number]
  | ["contains", string, string]
  | ["startsWith", string, string]
  | ["isNull" | "notNull", string]
  | ["or", Filter[]]
  | ["and", Filter[]];

export interface OrderBy {
  field: string;
  dir?: "asc" | "desc";
}

export interface ListOptions {
  filters?: Filter[];
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
  cursorAfter?: string;
  /** quando false, o total não é calculado (evita a contagem: mais rápido) */
  total?: boolean;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface BaseDoc {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type Doc<T = Record<string, any>> = BaseDoc & T;

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly collection?: string,
    public readonly reason: "duplicate_id" | "unique" | "tx_conflict" | "bounds" = "unique",
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(public readonly collection: string, public readonly docId: string) {
    super(`Registro não encontrado (${collection}/${docId})`);
    this.name = "NotFoundError";
  }
}

/**
 * Condição de dono numa gravação por id (multiempresa): a gravação só acontece se o registro for da empresa informada.
 * Registro de outra empresa é tratado como inexistente (`NotFoundError` em update/increment; delete não faz nada).
 * A conferência vai na própria instrução ao banco (sem leitura extra).
 */
export interface WriteGuard {
  companyId: string;
}

export interface Store {
  readonly backend: Backend;
  get<T = any>(collection: string, id: string): Promise<Doc<T> | null>;
  getOrThrow<T = any>(collection: string, id: string): Promise<Doc<T>>;
  list<T = any>(collection: string, opts?: ListOptions): Promise<ListResult<Doc<T>>>;
  /** Cria; lança ConflictError se o id ou índice único já existir. */
  create<T = any>(collection: string, data: Partial<T> & Record<string, any>, id?: string): Promise<Doc<T>>;
  update<T = any>(collection: string, id: string, patch: Partial<T> & Record<string, any>, guard?: WriteGuard): Promise<Doc<T>>;
  /** Devolve se havia registro a excluir (com `guard`, só conta o da empresa informada). */
  delete(collection: string, id: string, guard?: WriteGuard): Promise<void | boolean>;
  /** Incremento atômico com limites opcionais; lança ConflictError("bounds") se violar. */
  increment(collection: string, id: string, field: string, by: number, bounds?: { min?: number; max?: number }, guard?: WriteGuard): Promise<Doc>;
  /**
   * Executa as escritas de `fn` de forma atômica. Dentro da transação, use apenas o `tx` recebido.
   * Leituras dentro da transação não devem depender de escritas da própria transação.
   */
  transaction<R>(fn: (tx: Store) => Promise<R>): Promise<R>;
}
