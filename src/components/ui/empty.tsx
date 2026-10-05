import { Inbox } from "lucide-react";

export function EmptyState({ title, description, action, icon }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-slate-300">{icon ?? <Inbox className="size-10" aria-hidden />}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "good" | "sim"; title?: string; children?: React.ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-900",
    good: "border-emerald-200 bg-emerald-50 text-emerald-900",
    sim: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900",
  }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-sm ${cls}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}
