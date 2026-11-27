import type { ModuleDef } from "./types";

/**
 * Grafo de dependências do catálogo: validação (referências e ciclos), dependências diretas e transitivas, dependentes
 * e componentes técnicos ativos. Funções puras sobre a lista de definições (testáveis sem banco).
 */

export interface GraphIssue {
  module: string;
  kind: "unknown_ref" | "cycle" | "parent_mismatch" | "duplicate_key" | "platform_dependency" | "requires_technical" | "component_not_technical";
  detail: string;
}

/** Arestas "precisa de" de um módulo: pai + obrigatórias (requiresAny entra como aresta para validação de ciclo). */
export function directEdges(m: ModuleDef): string[] {
  const out = new Set<string>();
  if (m.parent) out.add(m.parent);
  for (const r of m.requires ?? []) out.add(r);
  for (const group of m.requiresAny ?? []) for (const r of group) out.add(r);
  return [...out];
}

export function validateCatalog(mods: ModuleDef[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byKey = new Map<string, ModuleDef>();
  for (const m of mods) {
    if (byKey.has(m.key)) issues.push({ module: m.key, kind: "duplicate_key", detail: `Chave repetida: ${m.key}` });
    byKey.set(m.key, m);
  }
  for (const m of mods) {
    for (const r of [...directEdges(m), ...(m.optionalIntegrations ?? []).map((i) => i.module)]) {
      if (!byKey.has(r)) issues.push({ module: m.key, kind: "unknown_ref", detail: `Referência a módulo inexistente: ${r}` });
    }
    for (const c of m.components ?? []) {
      const d = byKey.get(c);
      if (!d) issues.push({ module: m.key, kind: "unknown_ref", detail: `Componente inexistente: ${c}` });
      else if (d.classification !== "technical") issues.push({ module: m.key, kind: "component_not_technical", detail: `${c} é usado como componente técnico mas é ${d.classification}` });
    }
    for (const r of m.requires ?? []) {
      const d = byKey.get(r);
      // dependência comercial nunca aponta para componente técnico (esses ficam em `components`)
      if (d?.classification === "technical") issues.push({ module: m.key, kind: "requires_technical", detail: `${r} é componente técnico: declare em components` });
    }
    if (m.classification === "optional_function" && !m.parent) issues.push({ module: m.key, kind: "parent_mismatch", detail: "Função opcional sem módulo-pai" });
    if (m.classification === "platform" && (m.requires?.length || m.parent)) issues.push({ module: m.key, kind: "platform_dependency", detail: "Recurso da plataforma não pode depender de módulo contratável" });
  }
  // ciclos (DFS com cores)
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (k: string) => {
    color.set(k, 1);
    stack.push(k);
    const m = byKey.get(k);
    for (const n of m ? directEdges(m) : []) {
      if (!byKey.has(n)) continue;
      const c = color.get(n) ?? 0;
      if (c === 1) issues.push({ module: k, kind: "cycle", detail: `Ciclo: ${[...stack.slice(stack.indexOf(n)), n].join(" → ")}` });
      else if (c === 0) visit(n);
    }
    stack.pop();
    color.set(k, 2);
  };
  for (const m of mods) if (!color.get(m.key)) visit(m.key);
  return issues;
}

/** Dependências obrigatórias transitivas (pai + requires; requiresAny não entra: é escolha). */
export function transitiveRequires(mods: ModuleDef[], key: string): string[] {
  const byKey = new Map(mods.map((m) => [m.key, m]));
  const seen = new Set<string>();
  const walk = (k: string) => {
    const m = byKey.get(k);
    for (const n of [...(m?.parent ? [m.parent] : []), ...(m?.requires ?? [])]) {
      if (seen.has(n)) continue;
      seen.add(n);
      walk(n);
    }
  };
  walk(key);
  return [...seen];
}

/** Componentes técnicos usados direta ou transitivamente. */
export function transitiveComponents(mods: ModuleDef[], key: string): string[] {
  const byKey = new Map(mods.map((m) => [m.key, m]));
  const out = new Set<string>();
  for (const k of [key, ...transitiveRequires(mods, key)]) for (const c of byKey.get(k)?.components ?? []) out.add(c);
  // componentes podem usar outros componentes
  const queue = [...out];
  while (queue.length) {
    const c = queue.shift()!;
    for (const n of byKey.get(c)?.components ?? []) {
      if (out.has(n)) continue;
      out.add(n);
      queue.push(n);
    }
  }
  return [...out];
}

/** Módulos que dependem (direta ou transitivamente) de `key` — inclusive pelo grupo requiresAny quando é a única opção ligada. */
export function dependentsOf(mods: ModuleDef[], key: string): string[] {
  const out = new Set<string>();
  let frontier = [key];
  while (frontier.length) {
    const next: string[] = [];
    for (const m of mods) {
      if (out.has(m.key) || m.key === key) continue;
      const edges = [...(m.parent ? [m.parent] : []), ...(m.requires ?? [])];
      if (edges.some((e) => frontier.includes(e))) {
        out.add(m.key);
        next.push(m.key);
      }
    }
    frontier = next;
  }
  return [...out];
}

/**
 * Confere se um conjunto de módulos habilitados é consistente: todo módulo habilitado tem pai e obrigatórias
 * habilitados e ao menos um de cada grupo requiresAny. Devolve as faltas por módulo.
 */
export function missingDependencies(mods: ModuleDef[], enabled: Set<string>): { module: string; missing: string[]; anyOf?: string[][] }[] {
  const byKey = new Map(mods.map((m) => [m.key, m]));
  const out: { module: string; missing: string[]; anyOf?: string[][] }[] = [];
  for (const k of enabled) {
    const m = byKey.get(k);
    if (!m) continue;
    const missing = [...(m.parent ? [m.parent] : []), ...(m.requires ?? [])].filter((r) => !enabled.has(r) && byKey.get(r)?.classification !== "platform");
    const anyOf = (m.requiresAny ?? []).filter((g) => !g.some((r) => enabled.has(r)));
    if (missing.length || anyOf.length) out.push({ module: k, missing, ...(anyOf.length ? { anyOf } : {}) });
  }
  return out;
}

/** Componentes técnicos ativos para um conjunto de módulos habilitados. */
export function activeComponents(mods: ModuleDef[], enabled: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of enabled) for (const c of transitiveComponents(mods, k)) out.add(c);
  return out;
}
