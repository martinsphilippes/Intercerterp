import { listAll } from "@/lib/db";
import { handle, ok } from "../_lib";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/companies — empresas contratantes pelo identificador ERP, com modo e versão dos módulos. */
export function GET(req: Request) {
  return handle(req, "erp.modules.read", async ({ store, requestId }) => {
    const [companies, states] = await Promise.all([listAll(store, "companies"), listAll(store, "company_modules")]);
    const byCompany = new Map(states.map((s) => [s.companyId, s]));
    return ok(
      companies.map((c) => ({ companyId: c.id, name: c.tradeName || c.name, cnpj: c.cnpj ?? null, kind: c.kind ?? "retail", status: c.status ?? "active", isDemo: Boolean(c.isDemo), mode: byCompany.get(c.id)?.mode ?? "legacy", version: byCompany.get(c.id)?.version ?? 0, hasBaseline: byCompany.has(c.id) })),
      { requestId },
    );
  });
}
