import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { CHART_COLORS } from "./format";

/**
 * Barras horizontais simples (HTML, sem JavaScript) para participação em listas — cada linha leva
 * rótulo e valor em texto (a cor nunca é o único canal) e pode abrir os registros que a compõem.
 */
export function BarList({ rows, ariaLabel }: { rows: Array<{ key: string; label: React.ReactNode; value: number; valueText: React.ReactNode; sub?: React.ReactNode; href?: string | null }>; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul aria-label={ariaLabel} className="space-y-2.5">
      {rows.map((r) => {
        const w = Math.max(0, Math.round((Math.abs(r.value) / max) * 100));
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{r.label}</span>
              <span className="tabular shrink-0 font-medium text-ink">{r.valueText}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
              <div className="h-1.5 rounded-full" style={{ width: `${w}%`, background: r.value < 0 ? CHART_COLORS.previous : CHART_COLORS.current }} />
            </div>
            {r.sub && <p className="mt-0.5 text-xs text-slate-500">{r.sub}</p>}
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="focus-ring block rounded px-1 py-0.5 hover:bg-brand-50/60">
                {body}
              </Link>
            ) : (
              <div className="px-1 py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Medidor de atingimento de meta: preenchimento até 100% e marcador do ritmo esperado. */
export function Meter({ bps, expectedBps, label, tone }: { bps: number | null; expectedBps?: number | null; label: string; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const v = Math.max(0, Math.min(10000, bps ?? 0));
  const fill = tone === "good" ? "#047857" : tone === "bad" ? "#b91c1c" : tone === "warn" ? "#b45309" : CHART_COLORS.current;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((bps ?? 0) / 100)} className="relative h-2 w-full rounded-full bg-brand-100">
      <div className={cn("h-2 rounded-full")} style={{ width: `${v / 100}%`, background: fill }} />
      {expectedBps != null && expectedBps > 0 && expectedBps < 10000 && <span className="absolute -top-1 h-4 w-0.5 rounded bg-slate-700" style={{ left: `calc(${expectedBps / 100}% - 1px)` }} title="Ritmo esperado para a data" aria-hidden />}
    </div>
  );
}
