import { applyDueTransitions } from "@/domain/licensing/due";
import { companyModulesStatus } from "@/domain/modules/changes";
import { companyIdParam, handle, ok } from "../../../_modules";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/companies/{companyId}/modules — estado vigente, acesso efetivo, configuração e versão (ETag). */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    const companyId = await companyIdParam(store, client, (await params).companyId);
    // transições vencidas valem na hora: o Interos lê o estado já atualizado
    await applyDueTransitions(store, companyId);
    const status = await companyModulesStatus(store, companyId);
    return ok(status, { requestId, headers: { ETag: `"${status.version}"` } });
  });
}
