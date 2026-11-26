import { serviceRoute } from "@/lib/service/http";
import { updateInitialUnit } from "@/domain/tenancy/provisioning";
import { actorOf, MAX_DURATION } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = MAX_DURATION;

/** Ajusta a unidade inicial (nome, código, CNPJ, IE, endereço, contato, fuso). */
export const PUT = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.unidade_inicial", mutation: true }, async (call) => {
  const view = await updateInitialUnit(call.store, actorOf(call), call.params.idEmpresa, call.body);
  return { companyId: view.idEmpresa, body: { empresa: view } };
});
