import { serviceRoute } from "@/lib/service/http";
import { reactivateTenant } from "@/domain/tenancy/provisioning";
import { actorOf } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Reativa a operação suspensa (libera as tarefas retidas; o histórico da suspensão fica registrado). */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.reativar", mutation: true }, async (call) => {
  const view = await reactivateTenant(call.store, actorOf(call), call.params.idEmpresa, call.body);
  return { companyId: view.idEmpresa, body: { empresa: view } };
});
