"use server";

import { runAction } from "@/lib/server/action";
import { markNotifications, archiveNotifications, unarchiveNotifications, setNotificationPrefs } from "@/domain/notifications";

export async function markAction(ids: string[], read: boolean) {
  return runAction({ module: "dashboard", revalidate: ["/notificacoes"] }, async (s) => {
    const r = await markNotifications(s.ctx, ids, read);
    return {
      ok: true as const,
      message: read
        ? `${r.changed} marcada(s) como lida(s).${r.stillOpen ? ` ${r.stillOpen} continua(m) com ocorrência aberta na origem — ler não resolve a pendência.` : ""}`
        : `${r.changed} marcada(s) como não lida(s).`,
    };
  });
}

export async function archiveAction(ids: string[]) {
  return runAction({ module: "dashboard", revalidate: ["/notificacoes"] }, async (s) => {
    const r = await archiveNotifications(s.ctx, ids);
    if (!r.archived && r.blocked) return { ok: false as const, error: "Pendências abertas não podem ser arquivadas: resolva a ocorrência na origem primeiro." };
    return { ok: true as const, message: `${r.archived} arquivada(s).${r.blocked ? ` ${r.blocked} pendência(s) aberta(s) mantida(s) na caixa de entrada.` : ""}` };
  });
}

export async function unarchiveAction(ids: string[]) {
  return runAction({ module: "dashboard", revalidate: ["/notificacoes"] }, async (s) => {
    const r = await unarchiveNotifications(s.ctx, ids);
    return { ok: true as const, message: `${r.restored} devolvida(s) à caixa de entrada.` };
  });
}

export async function savePrefsAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: ["/notificacoes"] }, async (s) => {
    const receive = new Set(fd.getAll("receive").map(String));
    const all = fd.getAll("type").map(String);
    const r = await setNotificationPrefs(s.ctx, all.filter((t) => !receive.has(t)));
    return { ok: true as const, message: r.muted.length ? `Preferências salvas: ${r.muted.length} tipo(s) silenciado(s). Avisos críticos continuam sendo entregues.` : "Preferências salvas: todos os tipos serão recebidos." };
  });
}
