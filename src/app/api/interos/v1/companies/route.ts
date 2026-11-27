import { applyDueTransitionsForAll } from "@/domain/licensing/due";
import { listAll } from "@/lib/db";
import { reachesCompanyDoc } from "@/lib/integrations/interos-auth";
import { handle, ok } from "../_modules";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/companies — empresas contratantes pelo identificador ERP, com modo e versão dos módulos. */
export function GET(req: Request) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    // transições vencidas de todas as empresas da lista valem na hora (o Interos consulta a cada 5 minutos)
    await applyDueTransitionsForAll(store, client.companyIds);
    const [companies, states] = await Promise.all([listAll(store, "companies"), listAll(store, "company_modules")]);
    const byCompany = new Map(states.map((s) => [s.companyId, s]));
    return ok(
      // lista `empresas` da credencial; sem lista, só as empresas ligadas ao Interos
      companies.filter((c) => reachesCompanyDoc(client, c)).map((c) => ({ companyId: c.id, name: c.tradeName || c.name, cnpj: c.cnpj ?? null, kind: c.kind ?? "retail", status: c.status ?? "active", isDemo: Boolean(c.isDemo), mode: byCompany.get(c.id)?.mode ?? "legacy", version: byCompany.get(c.id)?.version ?? 0, hasBaseline: byCompany.has(c.id) })),
      { requestId },
    );
  });
}
