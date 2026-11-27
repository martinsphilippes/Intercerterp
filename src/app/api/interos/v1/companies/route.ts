import { applyDueTransitionsForAll } from "@/domain/licensing/due";
import { listAll } from "@/lib/db";
import { reachesCompanyDoc } from "@/lib/integrations/interos-auth";
import { handle, ok } from "../_modules";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/companies — empresas contratantes pelo identificador ERP, com modo e versão dos módulos. */
export function GET(req: Request) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    // só as empresas que a credencial alcança (lista `empresas`; sem lista, as ligadas ao Interos)
    const reachable = new Set((await listAll(store, "companies")).filter((c) => reachesCompanyDoc(client, c)).map((c) => String(c.id)));
    // as transições vencidas delas valem na hora (o Interos consulta a cada 5 minutos); as das outras, na rotina do ERP
    await applyDueTransitionsForAll(store, [...reachable]);
    const [companies, states] = await Promise.all([listAll(store, "companies"), listAll(store, "company_modules")]);
    const byCompany = new Map(states.map((s) => [s.companyId, s]));
    return ok(
      companies.filter((c) => reachable.has(String(c.id))).map((c) => ({ companyId: c.id, name: c.tradeName || c.name, cnpj: c.cnpj ?? null, kind: c.kind ?? "retail", status: c.status ?? "active", isDemo: Boolean(c.isDemo), mode: byCompany.get(c.id)?.mode ?? "legacy", version: byCompany.get(c.id)?.version ?? 0, hasBaseline: byCompany.has(c.id) })),
      { requestId },
    );
  });
}
