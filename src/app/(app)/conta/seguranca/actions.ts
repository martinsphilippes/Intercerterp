"use server";

import QRCode from "qrcode";
import { runAction, fstr } from "@/lib/server/action";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes } from "@/domain/two-factor";
import { formatSecret } from "@/lib/auth/totp";

const PATH = "/conta/seguranca";

/** Inicia (ou reinicia) o cadastro do aplicativo autenticador: QR code e chave para digitação. */
export async function startTwoFactorSetupAction(restart = false) {
  return runAction({}, async (s) => {
    const v = await beginTwoFactorSetup(s.ctx, { restart });
    return { secret: formatSecret(v.secret), qr: await QRCode.toString(v.uri, { type: "svg", margin: 1, width: 200 }) };
  });
}

/** Confirma o cadastro com um código do aplicativo; devolve os códigos de recuperação (exibidos uma vez). */
export async function confirmTwoFactorSetupAction(fd: FormData) {
  return runAction({}, async (s) => confirmTwoFactorSetup(s.ctx, fstr(fd, "code")));
}

export async function disableTwoFactorAction(fd: FormData) {
  return runAction({ revalidate: [PATH] }, async (s) => {
    await disableTwoFactor(s.ctx, String(fd.get("password") ?? ""), fstr(fd, "code"));
    return { ok: true as const, message: "Autenticação em duas etapas desativada." };
  });
}

export async function regenerateRecoveryCodesAction(fd: FormData) {
  return runAction({}, async (s) => regenerateRecoveryCodes(s.ctx, fstr(fd, "code")));
}
