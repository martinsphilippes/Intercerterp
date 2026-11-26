import { MODULES_CATALOG } from "./catalog";
import type { AccessLevel } from "./types";

/**
 * Resolução de superfície → módulo(s): rotas (internas e públicas), APIs, exportações, rotinas, tarefas, avisos e
 * recursos de Parâmetros. Uma superfície compartilhada pode pertencer a mais de um módulo (ex.: /financeiro serve a
 * receber e a pagar): fica disponível quando QUALQUER dono está disponível.
 */

interface RouteRule {
  pattern: string;
  re: RegExp;
  score: number;
  modules: string[];
}

function compile(pattern: string): { re: RegExp; score: number } {
  const segs = pattern.split("/").filter(Boolean);
  const body = segs.map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  const literal = segs.filter((s) => !/^\[.+\]$/.test(s)).length;
  return { re: new RegExp(`^/${body}(?:/|$)`), score: segs.length * 10 + literal };
}

function buildRules(kind: "routes" | "publicRoutes" | "apis" | "webhooks"): RouteRule[] {
  const by = new Map<string, string[]>();
  for (const m of MODULES_CATALOG) for (const r of m.surfaces[kind] ?? []) by.set(r, [...(by.get(r) ?? []), m.key]);
  return [...by.entries()].map(([pattern, modules]) => ({ pattern, modules, ...compile(pattern) })).sort((a, b) => b.score - a.score);
}

let RULES: RouteRule[] | null = null;
function rules(): RouteRule[] {
  return (RULES ??= [...buildRules("routes"), ...buildRules("publicRoutes"), ...buildRules("apis"), ...buildRules("webhooks")].sort((a, b) => b.score - a.score));
}

/** Módulos donos de um caminho (a regra mais específica). Vazio = não mapeado (tratado como plataforma). */
export function modulesForPath(pathname: string): { pattern: string; modules: string[] } | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const hits = rules().filter((r) => r.re.test(path));
  if (!hits.length) return null;
  const best = hits[0].score;
  const modules = [...new Set(hits.filter((h) => h.score === best).flatMap((h) => h.modules))];
  return { pattern: hits[0].pattern, modules };
}

const index = (field: "exports" | "routines" | "jobs" | "features") => {
  const out = new Map<string, string[]>();
  for (const m of MODULES_CATALOG) for (const k of m.surfaces[field] ?? []) out.set(k, [...(out.get(k) ?? []), m.key]);
  return out;
};
let EXPORTS: Map<string, string[]> | null = null;
let ROUTINES: Map<string, string[]> | null = null;
let JOBS: Map<string, string[]> | null = null;
let FEATURES: Map<string, string[]> | null = null;

export const modulesForExport = (key: string) => (EXPORTS ??= index("exports")).get(key) ?? [];
export const modulesForRoutine = (key: string) => (ROUTINES ??= index("routines")).get(key) ?? [];
export const modulesForJob = (key: string) => (JOBS ??= index("jobs")).get(key) ?? [];
export const modulesForFeature = (key: string) => (FEATURES ??= index("features")).get(key) ?? [];

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, drain: 2, full: 3 };
/** Nível de uma superfície com vários donos: o maior entre eles. */
export function bestLevel(levels: AccessLevel[]): AccessLevel {
  return levels.reduce<AccessLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), "none");
}

/** Todas as superfícies declaradas (para os testes de cobertura e o inventário). */
export function declaredSurfaces() {
  const all = { routes: new Set<string>(), exports: new Set<string>(), routines: new Set<string>(), jobs: new Set<string>(), features: new Set<string>(), apis: new Set<string>() };
  for (const m of MODULES_CATALOG) {
    for (const r of [...(m.surfaces.routes ?? []), ...(m.surfaces.publicRoutes ?? [])]) all.routes.add(r);
    for (const r of [...(m.surfaces.apis ?? []), ...(m.surfaces.webhooks ?? [])]) all.apis.add(r);
    for (const r of m.surfaces.exports ?? []) all.exports.add(r);
    for (const r of m.surfaces.routines ?? []) all.routines.add(r);
    for (const r of m.surfaces.jobs ?? []) all.jobs.add(r);
    for (const r of m.surfaces.features ?? []) all.features.add(r);
  }
  return all;
}
