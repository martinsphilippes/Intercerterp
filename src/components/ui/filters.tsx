import Link from "next/link";
import { Search } from "lucide-react";
import { buttonClass } from "./button";
import { inputClass } from "./form";
import { cn } from "./cn";

export type FilterDef =
  | { type: "search"; name?: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: Array<{ value: string; label: string }>; all?: string }
  | { type: "date"; name: string; label: string }
  | { type: "text"; name: string; label: string; placeholder?: string };

/** Barra de filtros por GET: o estado fica na URL e é preservado ao voltar dos detalhes. */
export function FilterBar({ filters, values, basePath, children }: { filters: FilterDef[]; values: Record<string, string | string[] | undefined>; basePath: string; children?: React.ReactNode }) {
  const v = (k: string) => {
    const x = values[k];
    return (Array.isArray(x) ? x[0] : x) ?? "";
  };
  return (
    <form method="get" action={basePath} className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
      {filters.map((f) => {
        if (f.type === "search") {
          const name = f.name ?? "q";
          return (
            <div key={name} className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
              <input name={name} defaultValue={v(name)} placeholder={f.placeholder ?? "Pesquisar…"} aria-label="Pesquisar" className={cn(inputClass, "h-9 pl-8")} />
            </div>
          );
        }
        if (f.type === "select")
          return (
            <label key={f.name} className="flex min-w-[150px] flex-col gap-1 text-xs font-medium text-slate-600">
              {f.label}
              <select name={f.name} defaultValue={v(f.name)} className={cn(inputClass, "h-9")}>
                <option value="">{f.all ?? "Todos"}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        if (f.type === "date")
          return (
            <label key={f.name} className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {f.label}
              <input type="date" name={f.name} defaultValue={v(f.name)} className={cn(inputClass, "h-9")} />
            </label>
          );
        return (
          <label key={f.name} className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-slate-600">
            {f.label}
            <input name={f.name} defaultValue={v(f.name)} placeholder={f.placeholder} className={cn(inputClass, "h-9")} />
          </label>
        );
      })}
      {children}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary")}>
          Filtrar
        </button>
        <Link href={basePath} className={buttonClass("ghost")}>
          Limpar
        </Link>
      </div>
    </form>
  );
}
