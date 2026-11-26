import { listAll } from "@/lib/db";
import { handle, ok } from "../_lib";

export const dynamic = "force-dynamic";

/** GET ?since — erros de integração: retratos recusados, eventos de saída não entregues e lotes v1 recusados. */
export function GET(req: Request) {
  return handle(req, "erp.license.read", async ({ store, client, requestId }) => {
    const since = new URL(req.url).searchParams.get("since") ?? new Date(Date.now() - 7 * 86400000).toISOString();
    const allowed = (c: string | null | undefined) => !client.companyIds || (c != null && client.companyIds.includes(c));
    const [lic, jobs, ops] = await Promise.all([
      listAll(store, "license_history", { filters: [["eq", "status", "rejected"], ["gte", "at", since]] }),
      listAll(store, "jobs", { filters: [["eq", "type", "interos.event"], ["eq", "status", ["dead", "retry"]]] }),
      listAll(store, "module_operations", { filters: [["eq", "status", "rejected"], ["gte", "createdAt", since]] }),
    ]);
    return ok([
      ...lic.filter((h) => allowed(h.companyId)).map((h) => ({ kind: "license.rejected", companyId: h.companyId, at: h.at, licenseVersion: h.licenseVersion, details: h.result?.plan?.rejectedItems ?? [] })),
      ...jobs.filter((j) => allowed(j.companyId)).map((j) => ({ kind: "event.undelivered", companyId: j.companyId, at: j.updatedAt, eventType: j.payload?.event?.type, status: j.status, attempts: j.attempts, error: j.lastError ?? null })),
      ...ops.filter((o) => allowed(o.companyId)).map((o) => ({ kind: "modules.apply_rejected", companyId: o.companyId, at: o.finishedAt ?? o.createdAt, operationId: o.id, error: o.error })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))), { requestId });
  });
}
