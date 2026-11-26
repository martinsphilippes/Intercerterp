import { simulateChanges } from "@/domain/modules/changes";
import { companyIdParam, handle, ok, parseChangeSet, readJson } from "../../../../_modules";

export const dynamic = "force-dynamic";

/** POST /api/interos/v1/companies/{companyId}/modules/simulate — impacto de um lote, sem gravar nada. */
export function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    const companyId = companyIdParam(client, (await params).companyId);
    const { entries: _e, ...sim } = await simulateChanges(store, { companyId, ...parseChangeSet(await readJson(req)) });
    void _e;
    return ok(sim, { requestId, headers: { ETag: `"${sim.version}"` } });
  });
}
