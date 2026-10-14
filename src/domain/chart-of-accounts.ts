/**
 * FIN-19 — Plano de contas ampliado sobre `fin_categories` (hierarquia por `parentId`, até 6 níveis, código de
 * classificação e código da conta contábil) e centros de custo em até 3 níveis (`cost_centers.parentId`).
 * Funções puras: árvore ordenada, nível, descendentes e grupo do DRE efetivo (herdado do ancestral mais próximo).
 */

export const MAX_CATEGORY_LEVEL = 6;
export const MAX_COST_CENTER_LEVEL = 3;

export interface TreeNode {
  id: string;
  name: string;
  parentId?: string | null;
  code?: string | null;
  [k: string]: any;
}

/** Cadeia de ancestrais (do pai até a raiz); para ao detectar ciclo. */
export function ancestorsOf<T extends TreeNode>(id: string, byId: Map<string, T>): T[] {
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && !seen.has(cur) && out.length < 20) {
    const n = byId.get(cur);
    if (!n) break;
    out.push(n);
    seen.add(cur);
    cur = n.parentId ?? null;
  }
  return out;
}

/** Nível (1 = raiz) pela cadeia de pais. */
export function levelOf<T extends TreeNode>(id: string, byId: Map<string, T>): number {
  return ancestorsOf(id, byId).length + 1;
}

/** Ids de todos os descendentes (filhos, netos…). */
export function descendantsOf<T extends TreeNode>(id: string, all: T[]): string[] {
  const children = new Map<string, string[]>();
  for (const n of all) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const out: string[] = [];
  const stack = [...(children.get(id) ?? [])];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    stack.push(...(children.get(c) ?? []));
  }
  return out;
}

/** Altura da subárvore a partir do nó (1 = sem filhos). */
export function subtreeHeight<T extends TreeNode>(id: string, all: T[]): number {
  const children = new Map<string, string[]>();
  for (const n of all) if (n.parentId && n.parentId !== n.id) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const seen = new Set<string>();
  const h = (x: string): number => {
    if (seen.has(x)) return 0;
    seen.add(x);
    const kids = children.get(x) ?? [];
    return 1 + (kids.length ? Math.max(...kids.map(h)) : 0);
  };
  return h(id);
}

const sortKey = (n: TreeNode) => `${n.code ? String(n.code) : "~"}|${n.name}`;

/**
 * Árvore achatada em ordem de exibição (pais antes dos filhos; irmãos por código e nome), com profundidade e
 * indicação de sintética (tem filhos) / analítica (folha). Nós órfãos (pai inexistente) entram como raiz.
 */
export function flattenTree<T extends TreeNode>(all: T[]): Array<T & { depth: number; synthetic: boolean; path: string }> {
  const ids = new Set(all.map((n) => n.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const n of all) {
    if (n.parentId && ids.has(n.parentId) && n.parentId !== n.id) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
    else roots.push(n);
  }
  const cmp = (a: T, b: T) => sortKey(a).localeCompare(sortKey(b), "pt-BR", { numeric: true });
  const out: Array<T & { depth: number; synthetic: boolean; path: string }> = [];
  const seen = new Set<string>();
  const walk = (n: T, depth: number, path: string) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const kids = (children.get(n.id) ?? []).sort(cmp);
    const p = path ? `${path} › ${n.name}` : n.name;
    out.push({ ...n, depth, synthetic: kids.length > 0, path: p });
    for (const k of kids) walk(k, depth + 1, p);
  };
  for (const r of roots.sort(cmp)) walk(r, 1, "");
  // ciclos (não deveriam existir): o que sobrou entra como raiz
  for (const n of all) if (!seen.has(n.id)) walk(n, 1, "");
  return out;
}

/** Grupo do DRE efetivo: o da própria categoria ou, sem grupo, o do ancestral mais próximo que tenha. */
export function effectiveDreGroup<T extends TreeNode & { dreGroup?: string | null }>(id: string | null | undefined, byId: Map<string, T>): string | null {
  if (!id) return null;
  const n = byId.get(id);
  if (!n) return null;
  if (n.dreGroup) return n.dreGroup;
  for (const a of ancestorsOf(id, byId)) if (a.dreGroup) return a.dreGroup;
  return null;
}

/** Rótulo com código: "1.01 — Receita de vendas". */
export const codedName = (n: { code?: string | null; name: string }) => (n.code ? `${n.code} — ${n.name}` : n.name);
