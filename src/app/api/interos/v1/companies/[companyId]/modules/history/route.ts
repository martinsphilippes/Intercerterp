import { applyDueTransitions } from "@/domain/licensing/due";
import { moduleHistory } from "@/domain/modules/changes";
import { companyIdParam, handle, ok } from "../../../../_modules";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/companies/{companyId}/modules/history?limit=50 — versões, ator, motivo e operação. */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    const companyId = companyIdParam(client, (await params).companyId);
    // transições vencidas valem na hora: o Interos lê o estado já atualizado
    await applyDueTransitions(store, companyId);
    const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50));
    return ok(await moduleHistory(store, companyId, limit), { requestId });
  });
}
