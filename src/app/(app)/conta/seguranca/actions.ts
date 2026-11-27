"use server";

import QRCode from "qrcode";
import { cookies } from "next/headers";
import { runAction, fstr } from "@/lib/server/action";
import { SESSION_COOKIE } from "@/lib/server/session";
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes } from "@/domain/two-factor";
import { changeOwnPassword, revokeOtherSessions } from "@/domain/users";
import { formatSecret } from "@/lib/auth/totp";

const PATH = "/conta/seguranca";

/** Multiempresa — o próprio usuário encerra as OUTRAS sessões dele; a desta requisição continua aberta. */
export async function revokeOtherSessionsAction() {
  return runAction({ entitlement: "plataforma.acesso", action: "revokeOtherSessionsAction", revalidate: [PATH] }, async (s) => {
    const current = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    const r = await revokeOtherSessions(s.ctx, current);
    return { ok: true as const, message: r.ended ? `${r.ended} outra(s) sessão(ões) encerrada(s). Esta continua aberta.` : "Não havia outras sessões abertas." };
  });
}

/** A própria pessoa troca a senha (confere a atual); as outras sessões são encerradas e esta continua. */
export async function changeOwnPasswordAction(fd: FormData) {
  return runAction({ entitlement: "plataforma.acesso", action: "changeOwnPasswordAction", revalidate: [PATH] }, async (s) => {
    const next = String(fd.get("password") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) return { ok: false as const, error: "A confirmação não confere com a nova senha." };
    const current = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    const r = await changeOwnPassword(s.ctx, current, String(fd.get("current") ?? ""), next);
    return { ok: true as const, message: `Senha trocada.${r.ended ? ` ${r.ended} outra(s) sessão(ões) encerrada(s); esta continua aberta.` : ""}` };
  });
}

/** Inicia (ou reinicia) o cadastro do aplicativo autenticador: QR code e chave para digitação. */
export async function startTwoFactorSetupAction(restart = false) {
  return runAction({ entitlement: "plataforma.acesso", action: "startTwoFactorSetupAction", }, async (s) => {
    const v = await beginTwoFactorSetup(s.ctx, { restart });
    return { secret: formatSecret(v.secret), qr: await QRCode.toString(v.uri, { type: "svg", margin: 1, width: 200 }) };
  });
}

/** Confirma o cadastro com um código do aplicativo; devolve os códigos de recuperação (exibidos uma vez). */
export async function confirmTwoFactorSetupAction(fd: FormData) {
  return runAction({ entitlement: "plataforma.acesso", action: "confirmTwoFactorSetupAction", }, async (s) => confirmTwoFactorSetup(s.ctx, fstr(fd, "code")));
}

export async function disableTwoFactorAction(fd: FormData) {
  return runAction({ entitlement: "plataforma.acesso", action: "disableTwoFactorAction", revalidate: [PATH] }, async (s) => {
    await disableTwoFactor(s.ctx, String(fd.get("password") ?? ""), fstr(fd, "code"));
    return { ok: true as const, message: "Autenticação em duas etapas desativada." };
  });
}

export async function regenerateRecoveryCodesAction(fd: FormData) {
  return runAction({ entitlement: "plataforma.acesso", action: "regenerateRecoveryCodesAction", }, async (s) => regenerateRecoveryCodes(s.ctx, fstr(fd, "code")));
}
