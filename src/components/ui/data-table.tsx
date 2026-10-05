import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { cn } from "./cn";
import { qs, type SearchParams } from "@/lib/list";
import { ColumnConfig } from "./column-config";
import { EmptyState } from "./empty";
import { buttonClass } from "./button";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  /** coluna oculta por padrão (pode ser ativada pelo usuário) */
  hidden?: boolean;
  /** não pode ser ocultada */
  fixed?: boolean;
  className?: string;
  cell: (row: T) => React.ReactNode;
}

/**
 * Tabela renderizada no servidor: ordenação e paginação por URL (filtros preservados ao voltar),
 * colunas configuráveis (preferência do usuário no navegador), totais do recorte e exportação.
 */
export function DataTable<T extends { id: string }>({
  id,
  columns,
  rows,
  total,
  page = 1,
  pageSize = 25,
  params = {},
  basePath,
  totals,
  exportKey,
  empty,
  rowHref,
  footer,
  dense,
}: {
  id: string;
  columns: Column<T>[];
  rows: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  params?: SearchParams;
  basePath: string;
  totals?: Partial<Record<string, React.ReactNode>>;
  exportKey?: string;
  empty?: React.ReactNode;
  rowHref?: (row: T) => string | null;
  footer?: React.ReactNode;
  dense?: boolean;
}) {
  const count = total ?? rows.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const sort = (Array.isArray(params.sort) ? params.sort[0] : params.sort) ?? "";
  const dir = (Array.isArray(params.dir) ? params.dir[0] : params.dir) ?? "desc";
  const href = (p: Record<string, string | number | null>) => `${basePath}${qs(p, params)}`;
  const exportQs = qs({ page: null, pageSize: null }, params);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white" data-table={id}>
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs text-slate-500">
        <span className="tabular">
          {count.toLocaleString("pt-BR")} registro{count === 1 ? "" : "s"}
          {pages > 1 && ` · página ${page} de ${pages}`}
        </span>
        <div className="flex items-center gap-2">
          {exportKey && (
            <a href={`/api/export/${exportKey}${exportQs}`} className={buttonClass("ghost", "sm")} title="Exportar o recorte filtrado (CSV)">
              <Download className="size-4" aria-hidden /> Exportar
            </a>
          )}
          <ColumnConfig tableId={id} columns={columns.map((c) => ({ key: c.key, label: c.label, hidden: c.hidden, fixed: c.fixed }))} />
        </div>
      </div>
      {rows.length === 0 ? (
        (empty ?? <EmptyState title="Nenhum registro encontrado" description="Ajuste os filtros ou cadastre um novo registro." />)
      ) : (
        <div className="overflow-x-auto">
          <table className={cn("table-base w-full text-sm", dense && "[&_td]:py-1.5")}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} data-col={c.key} className={cn(c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)} aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                    {c.sortable ? (
                      <Link href={href({ sort: c.key, dir: sort === c.key && dir === "desc" ? "asc" : "desc", page: null })} className="inline-flex items-center gap-1 hover:text-brand-700">
                        {c.label}
                        {sort === c.key ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const link = rowHref?.(r);
                return (
                  <tr key={r.id} className={link ? "cursor-pointer" : undefined}>
                    {columns.map((c, i) => (
                      <td key={c.key} data-col={c.key} className={cn(c.align === "right" && "tabular text-right", c.align === "center" && "text-center", c.className)}>
                        {link && i === 0 ? (
                          <Link href={link} className="font-medium text-brand-700 hover:underline">
                            {c.cell(r)}
                          </Link>
                        ) : (
                          c.cell(r)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  {columns.map((c, i) => (
                    <td key={c.key} data-col={c.key} className={cn("border-t border-line px-3 py-2", c.align === "right" && "tabular text-right")}>
                      {totals[c.key] ?? (i === 0 ? "Total do recorte" : "")}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {footer}
      {pages > 1 && (
        <nav aria-label="Paginação" className="no-print flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm">
          <Link aria-disabled={page <= 1} className={buttonClass("secondary", "sm", page <= 1 ? "pointer-events-none opacity-50" : "")} href={href({ page: page - 1 })}>
            Anterior
          </Link>
          <span className="tabular text-xs text-slate-500">
            {page} / {pages}
          </span>
          <Link aria-disabled={page >= pages} className={buttonClass("secondary", "sm", page >= pages ? "pointer-events-none opacity-50" : "")} href={href({ page: page + 1 })}>
            Próxima
          </Link>
        </nav>
      )}
    </div>
  );
}
