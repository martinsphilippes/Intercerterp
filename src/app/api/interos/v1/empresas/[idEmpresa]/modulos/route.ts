import { serviceRoute } from "@/lib/service/http";
import { setTenantModules } from "@/domain/tenancy/provisioning";
import { actorOf } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Define os módulos contratados (substitui a lista inteira) e a referência do contrato. */
export const PUT = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.modulos", mutation: true }, async (call) => {
  const view = await setTenantModules(call.store, actorOf(call), call.params.idEmpresa, call.body);
  return { companyId: view.idEmpresa, body: { empresa: view } };
});
