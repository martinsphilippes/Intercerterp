import { serviceRoute } from "@/lib/service/http";
import { listLinkedTenants, provisionTenant } from "@/domain/tenancy/provisioning";
import { actorOf, inviteBodies } from "../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // literal: o Next lê a configuração da rota sem executar o código

/** Empresas contratantes vinculadas ao Interos (sincronização), com filtro por conta e paginação por cursor. */
export const GET = serviceRoute({ scope: "provisionamento:leitura", operation: "empresas.listar" }, async (call) => ({ body: await listLinkedTenants(call.store, call.query) }));

/** Cria (ou retoma a criação de) uma empresa contratante: empresa, unidade inicial, módulos e administrador. */
export const POST = serviceRoute({ scope: "provisionamento:escrita", operation: "empresas.criar", mutation: true }, async (call) => {
  const out = await provisionTenant(call.store, actorOf(call), call.body, call.origin);
  const invite = inviteBodies(out.invite, out.view.administradores[0]?.idUsuario ?? null, out.view.idEmpresa);
  return { status: out.status, companyId: out.view.idEmpresa, body: { empresa: out.view, convite: invite.first }, replayBody: { empresa: out.view, convite: invite.replay } };
});
