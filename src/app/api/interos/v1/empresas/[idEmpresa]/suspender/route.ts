import { serviceRoute } from "@/lib/service/http";
import { suspendTenant } from "@/domain/tenancy/provisioning";
import { actorOf } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Suspende a operação conforme a regra de contrato: "bloqueio" ou "somente_leitura" (histórico preservado). */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.suspender", mutation: true }, async (call) => {
  const view = await suspendTenant(call.store, actorOf(call), call.params.idEmpresa, call.body);
  return { companyId: view.idEmpresa, body: { empresa: view } };
});
