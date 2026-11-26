import { serviceRoute } from "@/lib/service/http";
import { linkedCompany, tenantView } from "@/domain/tenancy/provisioning";

export const dynamic = "force-dynamic";

/** Estado da empresa e da implantação (etapas, administradores, convite, módulos, suspensão, uso). */
export const GET = serviceRoute({ scope: "provisionamento:leitura", operation: "empresas.consultar" }, async (call) => {
  const c = await linkedCompany(call.store, call.params.idEmpresa);
  return { companyId: c.id, body: { empresa: await tenantView(call.store, c.id) } };
});
