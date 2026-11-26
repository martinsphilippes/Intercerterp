import { companyModulesStatus } from "@/domain/modules/changes";
import { companyIdParam, handle, ok } from "../../../_modules";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/companies/{companyId}/modules — estado vigente, acesso efetivo, configuração e versão (ETag). */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    const status = await companyModulesStatus(store, companyIdParam(client, (await params).companyId));
    return ok(status, { requestId, headers: { ETag: `"${status.version}"` } });
  });
}
