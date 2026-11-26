import { applyDueTransitions } from "@/domain/licensing/due";
import { applyLicense, licenseStatus } from "@/domain/licensing/license";
import { companyParam, handle, ok, signedWrite } from "../../../_lib";

export const dynamic = "force-dynamic";

/** GET — licença aplicada, estado efetivo por unidade, limites, exibição e sincronização. */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.license.read", async (r) => {
    const companyId = companyParam(r.client, (await params).companyId);
    // transições vencidas valem na hora: o Interos lê o estado já atualizado
    await applyDueTransitions(r.store, companyId);
    const st = await licenseStatus(r.store, companyId);
    return ok(st, { requestId: r.requestId, headers: { ETag: `"${st.appliedVersion}"` } });
  });
}

/**
 * PUT — aplica o retrato completo da licença (assinado). Versão menor ou igual à aplicada: 200 "stale" com a vigente
 * (eventos fora de ordem). Mesma versão repetida: 200 "duplicate" com o resultado original.
 */
export function PUT(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.license.write", async (r) => {
    const companyId = companyParam(r.client, (await params).companyId);
    return signedWrite(req, r, companyId, async (body, eventId) => {
      const actor = (req.headers.get("x-interos-actor") ?? "").trim().slice(0, 200) || r.client.id;
      const res = await applyLicense(r.store, companyId, body, { clientId: r.client.id, eventId, source: "push", actor });
      const status = res.status === "rejected" ? 422 : res.status === "applied" ? 201 : 200;
      return { status, data: { status: res.status, appliedVersion: res.appliedVersion, runtimeVersion: res.runtimeVersion, rejectedItems: res.plan?.rejectedItems ?? [], warnings: res.plan?.warnings ?? [], effective: res.plan?.effective ?? null, nextTransitionAt: res.plan?.nextTransitionAt ?? null }, headers: { ETag: `"${res.appliedVersion}"` } };
    });
  });
}
