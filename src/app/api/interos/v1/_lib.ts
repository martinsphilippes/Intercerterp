import type { ServiceCall } from "@/lib/service/http";
import type { ServiceActor } from "@/domain/tenancy/provisioning";

/** Autor das alterações feitas pela interface de serviço (auditoria e trilha). */
export const actorOf = (call: ServiceCall): ServiceActor => ({ clientId: call.client.id, name: call.client.nome, requestId: call.requestId });

type Invite = { link: string | null; entrega: string; entregue: boolean | null; canal: string; detalhe: string; expiraEm: string } | null;

/**
 * Convite na resposta. O link é uma credencial de uso único: vai SÓ na primeira resposta e nunca fica gravado — a
 * versão guardada para reenvios com a mesma Idempotency-Key leva `link: null` e a instrução para gerar outro.
 */
export function inviteBodies(invite: Invite, userId: string | null, idEmpresa: string) {
  if (!invite) return { first: null, replay: null };
  const base = { idUsuario: userId, entrega: invite.entrega, entregue: invite.entregue, canal: invite.canal, detalhe: invite.detalhe, expiraEm: invite.expiraEm };
  return {
    first: { ...base, link: invite.link, linkRedigido: false },
    replay: { ...base, link: null, linkRedigido: Boolean(invite.link), aviso: invite.link ? `O link foi entregue só na primeira resposta. Para um novo link: POST /api/interos/v1/empresas/${idEmpresa}/convites/reenviar.` : null },
  };
}
