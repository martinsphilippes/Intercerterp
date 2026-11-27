import { BusinessError } from "@/lib/core/errors";
import { cancelScheduled, publicOperation } from "@/domain/modules/operations";
import { reachesCompanyId } from "@/lib/integrations/interos-auth";
import { handle, ok } from "../../../_modules";

export const dynamic = "force-dynamic";

/** POST /api/interos/v1/operations/{operationId}/cancel — cancela uma operação agendada ainda não executada. */
export function POST(req: Request, { params }: { params: Promise<{ operationId: string }> }) {
  return handle(req, "erp.modules.write", async ({ store, client, requestId }) => {
    const id = (await params).operationId;
    const op = /^[0-9a-f]{32}$/.test(id) ? await store.get("module_operations", id) : null;
    if (!op || op.clientId !== client.id || !(await reachesCompanyId(store, client, op.companyId))) throw new BusinessError("Operação não encontrada.", "operation_not_found");
    const actor = (req.headers.get("x-interos-actor") ?? "").trim() || client.id;
    return ok(publicOperation(await cancelScheduled(store, id, actor)), { requestId });
  });
}
