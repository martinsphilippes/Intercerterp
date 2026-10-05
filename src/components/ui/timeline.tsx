import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { formatDateTime } from "@/lib/dates";
import { Badge } from "./badge";

/** Linha do tempo operacional real do registro (histórico/auditoria, incluindo eventos relacionados). */
export async function Timeline({ store, refs, limit = 50 }: { store: Store; refs: string[]; limit?: number }) {
  const seen = new Map<string, any>();
  for (const ref of refs) {
    const [type, id] = ref.split(":");
    const direct = await listAll(store, "audit_logs", { filters: [["eq", "entityType", type], ["eq", "entityId", id]] }, 200);
    const related = await listAll(store, "audit_logs", { filters: [["contains", "related", ref]] }, 200).catch(() => []);
    for (const e of [...direct, ...related]) seen.set(e.id, e);
  }
  const events = [...seen.values()].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, limit);
  if (!events.length) return <p className="text-sm text-slate-500">Sem eventos registrados.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={`absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-white ${e.result === "failure" ? "bg-red-500" : "bg-brand-500"}`} aria-hidden />
          <p className="text-sm text-ink">{e.summary}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{formatDateTime(e.occurredAt)}</span>
            <span>· {e.userName}</span>
            {e.result === "failure" && <Badge tone="bad">falha</Badge>}
            {e.reason && <span>· Motivo: {e.reason}</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
