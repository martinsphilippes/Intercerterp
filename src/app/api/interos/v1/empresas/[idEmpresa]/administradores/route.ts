import { serviceRoute } from "@/lib/service/http";
import { inviteTenantAdmin } from "@/domain/tenancy/provisioning";
import { actorOf, inviteBodies } from "../../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Convida (ou vincula, se o e-mail já tem acesso ao ERP) um administrador da empresa. */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.administrador", mutation: true }, async (call) => {
  const out = await inviteTenantAdmin(call.store, actorOf(call), call.params.idEmpresa, call.body, call.origin);
  const invite = inviteBodies(out.invite, out.user.id, out.view.idEmpresa);
  return { status: 201, companyId: out.view.idEmpresa, body: { empresa: out.view, idUsuario: out.user.id, convite: invite.first }, replayBody: { empresa: out.view, idUsuario: out.user.id, convite: invite.replay } };
});
