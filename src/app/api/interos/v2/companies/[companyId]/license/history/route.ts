import { applyDueTransitions } from "@/domain/licensing/due";
import { licenseId, noteConfirmation } from "@/domain/licensing/license";
import { companyParam, handle, ok } from "../../../../_lib";

export const dynamic = "force-dynamic";

/** GET — retratos recebidos (versão, situação, origem, evento, resultado) e transições locais (teste, agenda, vigência). */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.license.read", async (r) => {
    const companyId = await companyParam(r, (await params).companyId);
    // transições vencidas valem na hora: o Interos lê o estado já atualizado
    await applyDueTransitions(r.store, companyId);
    // a consulta do Interos confirma que os dois lados estão em contato (base do sync.stale)
    await noteConfirmation(r.store, companyId);
    const res = await r.store.list("license_history", { filters: [["eq", "companyId", companyId]], orderBy: [{ field: "licenseVersion", dir: "desc" }], limit: 100 });
    const lic = await r.store.get("company_licenses", licenseId(companyId));
    // retratos recebidos (kind "snapshot") e transições locais aplicadas pelo ERP no instante devido (kind "transition"),
    // do mais recente para o mais antigo
    const rows = [
      ...res.items.map((h) => ({ kind: "snapshot" as const, licenseVersion: h.licenseVersion, status: h.status, source: h.source, clientId: h.clientId, eventId: h.eventId, at: h.at, rejectedItems: h.result?.plan?.rejectedItems ?? [] })),
      ...(((lic?.transitions as any[]) ?? []).map((t) => ({ kind: "transition" as const, licenseVersion: t.licenseVersion, status: "applied", source: "local", clientId: null, eventId: null, at: t.at, companyState: t.companyState, changes: t.changes ?? [] }))),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.licenseVersion - a.licenseVersion);
    return ok(rows, { requestId: r.requestId });
  });
}
