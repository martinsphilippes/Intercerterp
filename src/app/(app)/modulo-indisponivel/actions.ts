"use server";

import { runAction, fstr } from "@/lib/server/action";
import { requestUpsell } from "@/domain/licensing/upsell";

/** Solicitar contratação de uma função não contratada (modo oportunidade): registra e encaminha ao Interos. */
export async function requestUpsellAction(fd: FormData) {
  return runAction({ entitlement: "plataforma.painel", action: "requestUpsellAction" }, async (s) => {
    const r = await requestUpsell(s.ctx, fstr(fd, "module"), fstr(fd, "note"));
    return { ok: true as const, message: r.duplicate ? "Sua solicitação já foi registrada; o responsável pelo contrato fará contato." : "Solicitação enviada ao responsável pelo contrato." };
  });
}
