/** Parâmetros de listagem vindos da URL (filtros preservados ao navegar e voltar). */
export type SearchParams = Record<string, string | string[] | undefined>;

export interface ListParams {
  q: string;
  page: number;
  pageSize: number;
  sort: string | null;
  dir: "asc" | "desc";
  f: Record<string, string>;
}

export function sp(params: SearchParams, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseList(params: SearchParams, defaults: Partial<ListParams> = {}): ListParams {
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (["q", "page", "pageSize", "sort", "dir"].includes(k)) continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (s != null && s !== "") f[k] = s;
  }
  const pageSize = Math.min(Math.max(Number(sp(params, "pageSize")) || defaults.pageSize || 25, 5), 200);
  return {
    q: sp(params, "q").trim(),
    page: Math.max(1, Number(sp(params, "page")) || 1),
    pageSize,
    sort: sp(params, "sort") || defaults.sort || null,
    dir: (sp(params, "dir") as "asc" | "desc") || defaults.dir || "desc",
    f,
  };
}

/** Ordena e pagina em memória (após filtros), retornando o recorte e o total. */
export function paginate<T extends Record<string, any>>(rows: T[], p: ListParams): { rows: T[]; total: number; pages: number } {
  let sorted = rows;
  if (p.sort) {
    const key = p.sort;
    sorted = [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
      return p.dir === "asc" ? c : -c;
    });
  }
  const total = sorted.length;
  const start = (p.page - 1) * p.pageSize;
  return { rows: sorted.slice(start, start + p.pageSize), total, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export function qs(params: Record<string, string | number | null | undefined>, base?: SearchParams): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(base ?? {})) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s != null && s !== "") out.set(k, s);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") out.delete(k);
    else out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

export function normalizeSearch(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
