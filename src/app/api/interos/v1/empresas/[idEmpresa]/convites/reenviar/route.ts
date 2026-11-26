import { serviceRoute } from "@/lib/service/http";
import { resendTenantInvite } from "@/domain/tenancy/provisioning";
import { actorOf, inviteBodies } from "../../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Gera um link novo de convite para um administrador ainda não ativado (o anterior deixa de valer). */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.reenviar_convite", mutation: true }, async (call) => {
  const out = await resendTenantInvite(call.store, actorOf(call), call.params.idEmpresa, call.body, call.origin);
  const invite = inviteBodies(out.invite, out.user.id, out.view.idEmpresa);
  return { companyId: out.view.idEmpresa, body: { empresa: out.view, convite: invite.first }, replayBody: { empresa: out.view, convite: invite.replay } };
});
