import { serviceRoute } from "@/lib/service/http";
import { updateInitialUnit } from "@/domain/tenancy/provisioning";
import { actorOf } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Ajusta a unidade inicial (nome, código, CNPJ, IE, endereço, contato, fuso). */
export const PUT = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.unidade_inicial", mutation: true }, async (call) => {
  const view = await updateInitialUnit(call.store, actorOf(call), call.params.idEmpresa, call.body);
  return { companyId: view.idEmpresa, body: { empresa: view } };
});
