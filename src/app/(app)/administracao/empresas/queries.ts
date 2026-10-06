import "server-only";
import { listAll } from "@/lib/db";
import type { SessionInfo } from "@/lib/server/session";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { unscoped } from "@/lib/db/scoped-store";
import { REGIMES, branchKind, branchSituation } from "@/domain/companies";
import { companyView } from "./access";

/** Empresas acessíveis ao usuário, com contagem de filiais e usuários (tela e exportação). */
export async function queryCompanies(s: SessionInfo, p: Pick<ListParams, "q" | "f">) {
  const allowed = new Set(s.companies.map((c) => c.id));
  // contagens de todas as empresas autorizadas (somente leitura; o resultado é filtrado por `allowed`)
  const base = unscoped(s.ctx.store);
  const [companies, branches, users, terminals] = await Promise.all([
    listAll(base, "companies"),
    listAll(base, "branches"),
    listAll(base, "users"),
    listAll(base, "terminals"),
  ]);
  let rows = companies
    .filter((c) => allowed.has(c.id))
    .map((c) => {
      const bs = branches.filter((b) => b.companyId === c.id);
      return {
        ...c,
        regimeLabel: REGIMES.find((r) => r.value === c.regime)?.label ?? c.regime ?? "—",
        branchesCount: bs.length,
        activeBranches: bs.filter((b) => b.status !== "inactive").length,
        usersCount: users.filter((u) => !u.isAdmin && (u.companyIds ?? []).includes(c.id) && u.status !== "inactive").length,
        terminalsCount: terminals.filter((t) => t.companyId === c.id && t.status !== "inactive").length,
        city: c.address?.cityName ? `${c.address.cityName}/${c.address.uf ?? ""}` : "—",
        current: c.id === s.ctx.companyId,
      };
    });
  if (p.q) {
    const q = normalizeSearch(p.q);
    rows = rows.filter((c) => normalizeSearch(`${c.name} ${c.tradeName ?? ""} ${c.cnpj ?? ""}`).includes(q));
  }
  if (p.f.status) rows = rows.filter((c) => (c.status ?? "active") === p.f.status);
  return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Unidades (filiais) de uma empresa: tela e exportação. */
export async function queryBranches(s: SessionInfo, companyId: string, p: Pick<ListParams, "q" | "f"> = { q: "", f: {} }) {
  // empresa ativa ou outra autorizada: lê pelo contexto da empresa (acesso validado)
  const c = await companyView(s, companyId);
  if (!c) return [];
  const [branches, warehouses, tables, terminals, sessions, fiscal, users] = await Promise.all([
    listAll(c.store, "branches", { filters: [["eq", "companyId", companyId]] }),
    listAll(c.store, "warehouses", { filters: [["eq", "companyId", companyId]] }),
    listAll(c.store, "price_tables", { filters: [["eq", "companyId", companyId]] }),
    listAll(c.store, "terminals", { filters: [["eq", "companyId", companyId]] }),
    listAll(c.store, "cash_sessions", { filters: [["eq", "companyId", companyId], ["eq", "status", ["open", "reopened"]]] }),
    listAll(c.store, "fiscal_configs", { filters: [["eq", "companyId", companyId]] }),
    listAll(c.store, "users"),
  ]);
  const fiscalIds = new Set(fiscal.map((f) => f.branchId as string));
  let rows = branches.map((b) => ({
    ...b,
    kind: branchKind(b),
    situation: branchSituation(b, fiscalIds),
    warehouseName: warehouses.find((w) => w.id === b.defaultWarehouseId)?.name ?? "—",
    priceTableName: tables.find((t) => t.id === b.defaultPriceTableId)?.name ?? "Padrão da empresa",
    terminalsCount: terminals.filter((t) => t.branchId === b.id && t.status !== "inactive").length,
    openSessions: sessions.filter((x) => x.branchId === b.id).length,
    managerName: users.find((u) => u.id === b.managerUserId)?.name ?? null,
    city: b.cityName ? `${b.cityName} / ${b.uf ?? ""}` : "—",
    inUse: b.id === s.ctx.branchId,
  }));
  if (p.q) {
    const q = normalizeSearch(p.q);
    rows = rows.filter((b) => normalizeSearch(`${b.name} ${b.code} ${b.cityName ?? ""} ${b.uf ?? ""} ${b.cnpj ?? ""}`).includes(q.replace(/\D/g, "").length >= 5 ? q.replace(/\D/g, "") : q) || normalizeSearch(`${b.name} ${b.cityName ?? ""}`).includes(q));
  }
  if (p.f.status) rows = rows.filter((b) => b.situation === p.f.status);
  return rows.sort((a, b) => (a.kind === b.kind ? String(a.code).localeCompare(String(b.code), "pt-BR", { numeric: true }) : a.kind === "Matriz" ? -1 : 1));
}
