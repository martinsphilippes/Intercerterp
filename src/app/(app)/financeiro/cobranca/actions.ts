"use server";

import { runAction, fopt, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { recordWhatsappCollection, saveCollectionTemplates } from "@/domain/collection";

/** Registra no histórico do título a cobrança aberta no WhatsApp (o link wa.me é aberto pelo navegador do operador). */
export async function registerWhatsappCollectionAction(installmentId: string, input: { template: string; phone: string; message: string }) {
  return runAction({ module: "finance", op: "edit" }, async (s) => {
    const r = await recordWhatsappCollection(s.ctx, installmentId, { template: String(input.template ?? ""), phone: String(input.phone ?? ""), message: String(input.message ?? "") });
    return { ok: true as const, message: "Contato de cobrança registrado no histórico do título.", data: r };
  });
}

/** Modelos de mensagem de cobrança (empresa). */
export async function saveCollectionTemplatesAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: ["/financeiro/cobranca/modelos"] }, async (s) => {
    await requireFeature(s, "cobrancaWhatsapp");
    const changed = await saveCollectionTemplates(
      s.ctx,
      { reminder: fstr(fd, "reminder"), overdue: fstr(fd, "overdue"), renegotiation: fstr(fd, "renegotiation"), pixLink: fstr(fd, "pixLink") },
      fopt(fd, "reason"),
    );
    return { ok: true as const, message: changed ? "Modelos de mensagem salvos e registrados no histórico." : "Nenhuma alteração." };
  });
}
