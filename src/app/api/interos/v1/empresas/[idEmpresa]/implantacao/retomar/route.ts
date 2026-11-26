import { serviceRoute } from "@/lib/service/http";
import { resumeProvisioning } from "@/domain/tenancy/provisioning";
import { actorOf, inviteBodies } from "../../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Retoma uma implantação que falhou no meio, com a entrada guardada (sem reenviar o corpo original). */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.retomar", mutation: true }, async (call) => {
  const out = await resumeProvisioning(call.store, actorOf(call), call.params.idEmpresa, call.origin);
  const invite = inviteBodies(out.invite, out.view.administradores[0]?.idUsuario ?? null, out.view.idEmpresa);
  return { status: 200, companyId: out.view.idEmpresa, body: { empresa: out.view, convite: invite.first }, replayBody: { empresa: out.view, convite: invite.replay } };
});
