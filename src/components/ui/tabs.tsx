import Link from "next/link";
import { cn } from "./cn";

/** Abas por URL (?tab=) — navegáveis, compartilháveis e preservadas ao recarregar. */
export function LinkTabs({ tabs, active, basePath, param = "tab" }: { tabs: Array<{ key: string; label: React.ReactNode; count?: number }>; active: string; basePath: string; param?: string }) {
  return (
    <div role="tablist" className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          href={`${basePath}${basePath.includes("?") ? "&" : "?"}${param}=${t.key}`}
          className={cn(
            "focus-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            t.key === active ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
