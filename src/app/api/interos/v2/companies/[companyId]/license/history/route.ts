import { companyParam, handle, ok } from "../../../../_lib";

export const dynamic = "force-dynamic";

/** GET — retratos recebidos (versão, situação, origem, evento, resultado). */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.license.read", async (r) => {
    const companyId = companyParam(r.client, (await params).companyId);
    const res = await r.store.list("license_history", { filters: [["eq", "companyId", companyId]], orderBy: [{ field: "licenseVersion", dir: "desc" }], limit: 100 });
    return ok(res.items.map((h) => ({ licenseVersion: h.licenseVersion, status: h.status, source: h.source, clientId: h.clientId, eventId: h.eventId, at: h.at, rejectedItems: h.result?.plan?.rejectedItems ?? [] })), { requestId: r.requestId });
  });
}
