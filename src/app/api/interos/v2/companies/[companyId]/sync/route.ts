import { applyDueTransitions } from "@/domain/licensing/due";
import { licenseStatus } from "@/domain/licensing/license";
import { companyParam, handle, ok } from "../../../_lib";

export const dynamic = "force-dynamic";

/** GET — estado de sincronização: versão aplicada, último retrato, última consulta (pull) e versão do runtime. */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.license.read", async (r) => {
    const companyId = companyParam(r.client, (await params).companyId);
    // transições vencidas valem na hora: o Interos lê o estado já atualizado
    await applyDueTransitions(r.store, companyId);
    const st = await licenseStatus(r.store, companyId);
    return ok({ companyId, appliedVersion: st.appliedVersion, runtime: st.runtime, ...st.sync, nextTransitionAt: st.nextTransitionAt }, { requestId: r.requestId, headers: { ETag: `"${st.appliedVersion}"` } });
  });
}
