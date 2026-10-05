"use server";

import { runAction, fstr, fopt } from "@/lib/server/action";
import { createTicket, replyTicket, updateTicket, attachmentsFromForm } from "@/domain/support";

export async function createTicketAction(fd: FormData) {
  return runAction({ module: "support", op: "create", revalidate: ["/ajuda", "/ajuda/chamados"] }, async (s) => {
    const t = await createTicket(s.ctx, {
      category: fstr(fd, "category"),
      priority: fstr(fd, "priority"),
      subject: fstr(fd, "subject"),
      message: fstr(fd, "message"),
      context: { route: fopt(fd, "route"), branchId: s.ctx.branchId, branchName: s.branch?.name ?? (s.consolidated ? "Consolidado" : null), userAgent: fopt(fd, "userAgent"), screen: fopt(fd, "screen") },
      attachments: await attachmentsFromForm(fd),
      idemKey: fstr(fd, "_idem") || undefined,
    });
    return { ok: true as const, message: `Chamado nº ${t.number} aberto. Você será notificado a cada resposta.`, redirect: `/ajuda/chamados/${t.id}` };
  });
}

export async function replyTicketAction(id: string, fd: FormData) {
  return runAction({ module: "support", revalidate: [`/ajuda/chamados/${id}`] }, async (s) => {
    const r = await replyTicket(s.ctx, id, { body: fstr(fd, "body"), internal: fstr(fd, "internal") === "on", status: fopt(fd, "status"), attachments: await attachmentsFromForm(fd), idemKey: fstr(fd, "_idem") || undefined });
    const d = r.delivery;
    return { ok: true as const, message: d ? (d.delivered ? `Resposta registrada e enviada por e-mail (${d.channel}).` : `Resposta registrada. E-mail não enviado: ${d.message ?? d.channel}.`) : "Mensagem registrada." };
  });
}

export async function updateTicketAction(id: string, fd: FormData) {
  return runAction({ module: "support", revalidate: [`/ajuda/chamados/${id}`] }, async (s) => {
    const patch: { status?: string; assigneeId?: string | null; priority?: string; reason?: string | null } = {};
    if (fd.has("status")) patch.status = fstr(fd, "status");
    if (fd.has("assigneeId")) patch.assigneeId = fopt(fd, "assigneeId");
    if (fd.has("priority")) patch.priority = fstr(fd, "priority");
    patch.reason = fopt(fd, "reason");
    await updateTicket(s.ctx, id, patch);
    return { ok: true as const, message: "Chamado atualizado." };
  });
}

export async function setTicketStatusAction(id: string, status: string, fd: FormData) {
  return runAction({ module: "support", revalidate: [`/ajuda/chamados/${id}`] }, async (s) => {
    await updateTicket(s.ctx, id, { status, reason: fopt(fd, "reason") });
    return { ok: true as const, message: status === "resolved" ? "Chamado marcado como resolvido." : status === "closed" ? "Chamado encerrado." : "Chamado reaberto." };
  });
}
