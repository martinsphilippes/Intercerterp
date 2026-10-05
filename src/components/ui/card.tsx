import { cn } from "./cn";

export function Card({ title, actions, children, className, bodyClass, description }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string; description?: React.ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-line bg-white", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "default" | "good" | "bad" | "warn" }) {
  const toneCls = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-ink";
  const body = (
    <>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cn("tabular mt-1 text-xl font-semibold", toneCls)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  );
  return href ? (
    <a href={href} className="focus-ring block rounded-lg border border-line bg-white p-4 transition-colors hover:border-brand-300">
      {body}
    </a>
  ) : (
    <div className="rounded-lg border border-line bg-white p-4">{body}</div>
  );
}

export function DefinitionList({ items, cols = 2 }: { items: Array<{ label: string; value: React.ReactNode } | null | false>; cols?: 1 | 2 | 3 | 4 }) {
  const map = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", map[cols])}>
      {items.filter(Boolean).map((i, idx) => {
        const it = i as { label: string; value: React.ReactNode };
        return (
          <div key={idx} className="min-w-0">
            <dt className="text-xs text-slate-500">{it.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{it.value ?? "—"}</dd>
          </div>
        );
      })}
    </dl>
  );
}
