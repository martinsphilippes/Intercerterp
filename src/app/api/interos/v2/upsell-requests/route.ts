import { listAll } from "@/lib/db";
import { requesterRef } from "@/domain/licensing/upsell";
import { handle, ok } from "../_lib";

export const dynamic = "force-dynamic";

/** GET ?since — solicitações de contratação feitas pelos usuários no ERP (funções bloqueadas/oportunidade). */
export function GET(req: Request) {
  return handle(req, "erp.license.read", async ({ store, client, requestId }) => {
    const since = new URL(req.url).searchParams.get("since") ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const rows = await listAll(store, "upsell_requests", { filters: [["gte", "createdAt", since]] });
    // LGPD (correção 4): quem pediu vai por identificador pseudônimo e perfil — nunca o nome
    return ok(rows.filter((r) => !client.companyIds || client.companyIds.includes(r.companyId)).map((r) => ({ id: r.id, companyId: r.companyId, code: r.code, module: r.module, note: r.note, requestedBy: requesterRef(r.companyId, r.userId), requesterRole: r.requesterRole ?? null, at: r.createdAt, status: r.status })), { requestId });
  });
}
