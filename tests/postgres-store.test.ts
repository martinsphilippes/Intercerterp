import { describe, it, expect, beforeAll } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import { ConflictError, NotFoundError, listAll, type Doc, type ListOptions, type Store } from "@/lib/db";
import { schemaApplied, provisionPostgres } from "@/lib/db/postgres/ddl";
import type { PostgresStore } from "@/lib/db/postgres/store";
import { nextNumber } from "@/lib/core/numbering";
import { freshPostgresStore } from "./pglite";

/**
 * Paridade do PostgresStore com o armazenamento em memória (a referência de comportamento de toda a suíte): as mesmas
 * operações nos dois e o mesmo resultado — filtros, ordenação, paginação, únicos, incremento e transações.
 */

// datas de sistema mudam a cada gravação: a comparação olha os dados
const strip = (d: Doc | null) => {
  if (!d) return d;
  const { createdAt: _c, updatedAt: _u, ...rest } = d;
  return rest;
};

const USERS: Array<Record<string, any> & { id: string }> = [
  { id: "u1", name: "Ana Souza", email: "ana@x.com", login: "ana", status: "active", isAdmin: true, companyIds: ["c1", "c2"], branchIds: [], discountLimitBps: 500, roleByCompany: { c1: "r1" }, lastAccessAt: "2026-11-10T12:00:00.000Z" },
  { id: "u2", name: "Érica Álvares", email: "erica@x.com", login: "erica", status: "active", isAdmin: false, companyIds: ["c1"], branchIds: ["b1", "b2"], discountLimitBps: 0, lastAccessAt: "2026-11-11T08:30:00.000Z" },
  // sem limite de desconto, como u4: o campo ordenado não mistura "nulo gravado" com "nunca gravado" — na memória essa
  // mistura ordena de forma arbitrária (null e undefined não se comparam); no Postgres os dois são nulos e empatam
  { id: "u3", name: "joão da silva", email: "joao@x.com", login: null, status: "inactive", isAdmin: false, companyIds: ["c2"], branchIds: ["b2"] },
  { id: "u4", name: "Zuleica Conceição", email: "zu@x.com", login: "zu", status: "invited", companyIds: [], commissionBps: 250, lastAccessAt: "2026-10-01T00:00:00.000Z" },
  { id: "u5", name: "Bruno 100%_teste", email: "bruno@x.com", login: "bruno", status: "active", isAdmin: false, companyIds: ["c3"], discountLimitBps: 1500, totpRecoveryHashes: ["h1", "h2"] },
];

const QUERIES: Array<[string, ListOptions]> = [
  ["todos, ordem de inserção", {}],
  ["igual texto", { filters: [["eq", "status", "active"]] }],
  ["igual lista", { filters: [["eq", "status", ["invited", "inactive", "zzz"]]] }],
  ["igual lista vazia", { filters: [["eq", "status", []]] }],
  ["igual booleano", { filters: [["eq", "isAdmin", false]] }],
  ["igual nulo", { filters: [["eq", "login", null]] }],
  ["igual com tipo diferente não casa", { filters: [["eq", "discountLimitBps", "500" as any]] }],
  ["igual inteiro", { filters: [["eq", "discountLimitBps", 500]] }],
  ["lista de textos tem o elemento", { filters: [["eq", "companyIds", "c1"]] }],
  ["lista de textos tem algum dos elementos", { filters: [["eq", "branchIds", ["b2", "b9"]]] }],
  ["contém em lista de textos", { filters: [["contains", "companyIds", "c2"]] }],
  ["diferente (nulos entram)", { filters: [["ne", "login", "ana"]] }],
  ["diferente de inteiro (nulos entram)", { filters: [["ne", "discountLimitBps", 0]] }],
  ["maior / menor em inteiro", { filters: [["gt", "discountLimitBps", 0], ["lte", "discountLimitBps", 1500]] }],
  ["número com casas decimais", { filters: [["gt", "discountLimitBps", 499.5]] }],
  ["intervalo em instante ISO", { filters: [["between", "lastAccessAt", "2026-11-01T00:00:00.000Z", "2026-11-10T23:59:59.999Z"]] }],
  ["maior ou igual em texto", { filters: [["gte", "email", "erica@x.com"]] }],
  ["contém sem acento e sem maiúsculas", { filters: [["contains", "name", "alvares"]] }],
  ["contém com acento no termo", { filters: [["contains", "name", "CONCEIÇÃO"]] }],
  ["contém com % e _ literais", { filters: [["contains", "name", "100%_t"]] }],
  ["contém não trata % como curinga", { filters: [["contains", "name", "a%a"]] }],
  ["começa com", { filters: [["startsWith", "name", "JOAO"]] }],
  ["contém em JSON serializado", { filters: [["contains", "roleByCompany", "r1"]] }],
  ["nulo", { filters: [["isNull", "lastAccessAt"]] }],
  ["não nulo", { filters: [["notNull", "login"]] }],
  ["ou", { filters: [["or", [["eq", "status", "invited"], ["eq", "isAdmin", true]]]] }],
  ["e dentro de ou", { filters: [["or", [["and", [["eq", "status", "active"], ["eq", "isAdmin", false]]], ["isNull", "login"]]]] }],
  ["ou vazio / e vazio", { filters: [["or", []]] }],
  ["e vazio", { filters: [["and", []]] }],
  ["campo fora do esquema", { filters: [["eq", "naoExiste", "x"]] }],
  ["diferente em campo fora do esquema", { filters: [["ne", "naoExiste", "x"]] }],
  ["por id", { filters: [["eq", "id", ["u2", "u4"]]] }],
  ["ordem por texto (maiúsculas antes, acentos depois)", { orderBy: [{ field: "name" }] }],
  ["ordem decrescente com nulos por último", { orderBy: [{ field: "lastAccessAt", dir: "desc" }] }],
  ["ordem crescente com nulos primeiro", { orderBy: [{ field: "discountLimitBps" }] }],
  ["duas chaves de ordem", { orderBy: [{ field: "status" }, { field: "name", dir: "desc" }] }],
  ["limite e deslocamento", { orderBy: [{ field: "email" }], limit: 2, offset: 1 }],
  ["deslocamento além do fim", { limit: 2, offset: 50 }],
  ["limite zero", { limit: 0 }],
  ["cursor na ordem padrão", { cursorAfter: "u2", limit: 2 }],
  ["cursor com ordem escolhida", { orderBy: [{ field: "name", dir: "desc" }], cursorAfter: "u3", limit: 2 }],
  ["cursor com filtro", { filters: [["eq", "status", "active"]], cursorAfter: "u1" }],
  ["cursor inexistente", { cursorAfter: "nada" }],
  ["sem total", { filters: [["eq", "status", "active"]], total: false }],
];

describe("PostgresStore: paridade com o armazenamento de referência", () => {
  let pg: PostgresStore;
  let mem: MemoryStore;
  const both = <R>(fn: (s: Store) => Promise<R>) => Promise.all([fn(mem), fn(pg)]);
  /** Mesmo resultado nos dois: valor igual ou o mesmo erro (classe e motivo). */
  const outcome = async <R>(fn: (s: Store) => Promise<R>) => {
    const settle = (s: Store) => fn(s).then((value) => ({ value }), (e) => ({ error: e instanceof ConflictError ? `conflito:${e.reason}` : e instanceof NotFoundError ? "não encontrado" : String(e.message) }));
    const [a, b] = await both(settle);
    expect(b).toEqual(a);
    return b;
  };

  beforeAll(async () => {
    pg = freshPostgresStore();
    mem = new MemoryStore();
    for (const u of USERS) {
      const { id, ...data } = u;
      const [a, b] = await both((s) => s.create("users", data, id));
      expect(strip(b)).toEqual(strip(a));
    }
  });

  it("esquema: criado na primeira consulta, com a assinatura registrada; conferir de novo não muda nada", async () => {
    expect(await schemaApplied(pg.driver)).toBe(true);
    const again = await provisionPostgres(pg.driver, () => undefined);
    expect(again).toMatchObject({ done: true, addedColumns: 0 });
    const tables = await pg.driver.query(`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name NOT LIKE '\\_%'`);
    expect(Number(tables.rows[0].n)).toBe(again.tables);
  });

  it.each(QUERIES)("consulta: %s", async (_name, opts) => {
    const [a, b] = await both((s) => s.list("users", opts));
    expect(b.items.map(strip)).toEqual(a.items.map(strip));
    if (opts.total !== false) expect(b.total).toBe(a.total);
  });

  it("leitura por id e inexistente", async () => {
    const [a, b] = await both((s) => s.get("users", "u2"));
    expect(strip(b)).toEqual(strip(a));
    expect(b).toMatchObject({ branchIds: ["b1", "b2"], isAdmin: false, discountLimitBps: 0, login: "erica", roleByCompany: null, totpRecoveryHashes: [] });
    await outcome((s) => s.get("users", "nada"));
    await outcome((s) => s.getOrThrow("users", "nada"));
  });

  it("listAll percorre todas as páginas pelo cursor", async () => {
    const [a, b] = await both((s) => listAll(s, "users", { orderBy: [{ field: "email" }] }));
    expect(b.map((d) => d.id)).toEqual(a.map((d) => d.id));
  });

  it("gravação: obrigatório, tipos, campo desconhecido, id repetido e índice único (vazio e nulo não disputam)", async () => {
    await outcome((s) => s.create("users", { email: "sem-nome@x.com" }));
    await outcome((s) => s.create("users", { name: "X", email: "x@x.com", discountLimitBps: 1.5 }));
    await outcome((s) => s.create("users", { name: "X", email: "x@x.com", campoQueNaoExiste: 1 }));
    await outcome((s) => s.create("users", { name: "Outra Ana", email: "outra@x.com" }, "u1"));
    await outcome((s) => s.create("users", { name: "Ana de novo", email: "ana@x.com" }));
    // contadores: chave única; duas linhas com chave vazia convivem
    await outcome((s) => s.create("counters", { key: "k1", value: 1 }, "cnt1").then(strip));
    await outcome((s) => s.create("counters", { key: "k1", value: 2 }, "cnt2"));
    await outcome((s) => s.update("users", "u2", { email: "ana@x.com" }));
    await outcome((s) => s.update("users", "u2", { email: "erica@x.com", phone: "8599" }).then(strip));
    await outcome((s) => s.update("users", "nada", { phone: "1" }));
    await outcome((s) => s.update("users", "u4", { companyIds: ["c9"], roleByCompany: { c9: ["a", { b: 1 }] }, isAdmin: null, commissionBps: 300 }).then(strip));
    await outcome((s) => s.delete("users", "nada"));
  });

  it("incremento atômico com limites; nulo conta como zero", async () => {
    await outcome((s) => s.increment("users", "u3", "discountLimitBps", 40).then((d) => d.discountLimitBps));
    await outcome((s) => s.increment("users", "u1", "discountLimitBps", -200, { min: 0 }).then((d) => d.discountLimitBps));
    await outcome((s) => s.increment("users", "u1", "discountLimitBps", -301, { min: 0 }));
    await outcome((s) => s.increment("users", "u1", "discountLimitBps", 1, { max: 300 }));
    await outcome((s) => s.increment("users", "nada", "discountLimitBps", 1));
    await outcome((s) => s.get("users", "u1").then((d) => d?.discountLimitBps));
  });

  it("transação: confirma tudo, desfaz tudo no erro e continua válida depois de um conflito tratado", async () => {
    // erro no meio desfaz as gravações anteriores
    await outcome((s) =>
      s.transaction(async (tx) => {
        await tx.create("counters", { key: "tx-a", value: 1 }, "tx-a");
        await tx.update("users", "u5", { phone: "111" });
        throw new Error("falha proposital");
      }),
    );
    await outcome((s) => s.get("counters", "tx-a"));
    await outcome((s) => s.get("users", "u5").then((d) => d?.phone));
    // conflito capturado dentro da transação (id repetido e índice único): ela segue e confirma o resto
    await outcome((s) =>
      s.transaction(async (tx) => {
        await tx.create("counters", { key: "tx-b", value: 1 }, "tx-b");
        const dup = await tx.create("counters", { key: "tx-b2", value: 1 }, "tx-b").then(() => "criou", (e) => (e as ConflictError).reason);
        const uniq = await tx.update("users", "u5", { email: "ana@x.com" }).then(() => "gravou", (e) => (e as ConflictError).reason);
        await tx.increment("counters", "tx-b", "value", 9);
        // leitura dentro da transação enxerga as próprias gravações, também pelo Store de fora
        const inside = (await s.get("counters", "tx-b"))?.value;
        return { dup, uniq, inside };
      }),
    );
    await outcome((s) => s.get("counters", "tx-b").then((d) => d?.value));
    // transação aninhada faz parte da de fora
    await outcome((s) =>
      s.transaction(async (tx) => {
        await tx.transaction(async (inner) => {
          await inner.create("counters", { key: "tx-c", value: 5 }, "tx-c");
        });
        throw new Error("desfaz a de dentro também");
      }),
    );
    await outcome((s) => s.get("counters", "tx-c"));
  });

  it("numeração sequencial sob concorrência: sem número repetido nem pulado", async () => {
    const [a, b] = await both(async (s) => {
      const got = await Promise.all(
        Array.from({ length: 12 }, (_, i) => (i % 2 ? nextNumber(s, "venda:demo") : s.transaction((tx) => nextNumber(tx, "venda:demo")))),
      );
      return got.sort((x, y) => x - y);
    });
    expect(a).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(b).toEqual(a);
  });
});
