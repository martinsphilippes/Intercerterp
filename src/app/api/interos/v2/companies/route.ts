import { applyDueTransitionsForAll } from "@/domain/licensing/due";
import { listAll } from "@/lib/db";
import { reachesCompanyDoc } from "@/lib/integrations/interos-auth";
import { handle, ok } from "../_lib";

export const dynamic = "force-dynamic";

/** GET /api/interos/v2/companies — empresas pelo identificador ERP, com versão de licença aplicada e modo de controle. */
export function GET(req: Request) {
  return handle(req, "erp.license.read", async ({ store, client, requestId }) => {
    // transições vencidas de todas as empresas da lista valem na hora (o Interos consulta a cada 5 minutos)
    await applyDueTransitionsForAll(store, client.companyIds);
    const [companies, lics, mods] = await Promise.all([listAll(store, "companies"), listAll(store, "company_licenses"), listAll(store, "company_modules")]);
    const lic = new Map(lics.map((l) => [l.companyId, l]));
    const mod = new Map(mods.map((m) => [m.companyId, m]));
    return ok(
      // lista `empresas` da credencial; sem lista, só as empresas ligadas ao Interos
      companies.filter((c) => reachesCompanyDoc(client, c)).map((c) => ({
        companyId: c.id, name: c.tradeName || c.name, cnpj: c.cnpj ?? null, kind: c.kind ?? "retail", status: c.status ?? "active", isDemo: Boolean(c.isDemo),
        appliedLicenseVersion: lic.get(c.id)?.licenseVersion ?? 0, controlMode: mod.get(c.id)?.mode ?? "legacy", runtimeVersion: mod.get(c.id)?.version ?? 0,
      })),
      { requestId },
    );
  });
}
