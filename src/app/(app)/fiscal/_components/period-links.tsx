import Link from "@/components/ui/link";
import { addMonths, monthEnd, monthStart, today } from "@/lib/dates";
import { qs, type SearchParams } from "@/lib/list";
import { cn } from "@/components/ui/cn";

/** Atalhos de período (o recorte fica explícito nos campos De/Até e na URL). */
export function PeriodLinks({ basePath, params, from, to }: { basePath: string; params: SearchParams; from: string; to: string }) {
  const t = today();
  const prev = addMonths(monthStart(t), -1);
  const opts = [
    { label: "Hoje", from: t, to: t },
    { label: "Este mês", from: monthStart(t), to: t },
    { label: "Mês anterior", from: prev, to: monthEnd(prev) },
    { label: "Últimos 90 dias", from: addMonths(t, -3), to: t },
  ];
  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500">
      <span className="mr-1">Período:</span>
      {opts.map((o) => {
        const active = o.from === from && o.to === to;
        return (
          <Link key={o.label} href={`${basePath}${qs({ from: o.from, to: o.to, page: null }, params)}`} className={cn("rounded px-2 py-0.5", active ? "bg-brand-50 font-medium text-brand-800 ring-1 ring-brand-200" : "hover:bg-slate-100")}>
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
