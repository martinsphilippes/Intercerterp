import { BusinessError } from "@/lib/core/errors";
import { publicOperation, runModulesMaintenance } from "@/domain/modules/operations";
import { nowIso } from "@/lib/dates";
import { reachesCompanyId } from "@/lib/integrations/interos-auth";
import { handle, ok } from "../../_modules";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/operations/{operationId} — estado confirmado pelo ERP (executa a agendada vencida). */
export function GET(req: Request, { params }: { params: Promise<{ operationId: string }> }) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    const id = (await params).operationId;
    let op = /^[0-9a-f]{32}$/.test(id) ? await store.get("module_operations", id) : null;
    if (!op || op.clientId !== client.id || !(await reachesCompanyId(store, client, op.companyId))) throw new BusinessError("Operação não encontrada.", "operation_not_found");
    if (op.status === "scheduled" && op.scheduledFor <= nowIso()) {
      await runModulesMaintenance(store, op.companyId);
      op = (await store.get("module_operations", id))!;
    }
    return ok(publicOperation(op), { requestId });
  });
}
