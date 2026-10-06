import Link from "@/components/ui/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({ title, crumbs = [], description, actions, badges }: { title: React.ReactNode; crumbs?: Crumb[]; description?: React.ReactNode; actions?: React.ReactNode; badges?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <nav aria-label="Caminho" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                {c.href ? (
                  <Link href={c.href} className="hover:text-brand-700 hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {badges}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
