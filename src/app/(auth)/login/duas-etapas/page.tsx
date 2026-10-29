import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { getStore } from "@/lib/db";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { MFA_COOKIE } from "@/lib/server/session";
import { challengeView, loadLoginChallenge } from "@/domain/two-factor";
import { formatSecret } from "@/lib/auth/totp";
import { TwoFactorLoginForm } from "./form";

export const metadata = { title: "Verificação em duas etapas" };
export const dynamic = "force-dynamic";

/**
 * Segunda etapa do login (§44): código do aplicativo autenticador ou, para perfil que exige e usuário sem cadastro,
 * o cadastro do aplicativo (QR code) antes de qualquer acesso. A sessão só é entregue ao navegador depois do código.
 */
export default async function Page() {
  await ensureBootstrap();
  const jar = await cookies();
  const store = getStore();
  const ch = await loadLoginChallenge(store, jar.get(MFA_COOKIE)?.value);
  const view = ch ? await challengeView(store, ch) : null;
  if (!ch || !view) redirect("/login");
  const qr = view.enrollment ? await QRCode.toString(view.enrollment.uri, { type: "svg", margin: 1, width: 200 }) : null;
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <ShieldCheck className="size-6 text-brand-700" aria-hidden /> {view.kind === "enroll" ? "Cadastre o aplicativo autenticador" : "Verificação em duas etapas"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {view.kind === "enroll"
          ? `${view.userName}, o seu perfil exige a autenticação em duas etapas. Cadastre um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) para continuar.`
          : `${view.userName}, digite o código de 6 dígitos do seu aplicativo autenticador.`}
      </p>
      {view.enrollment && qr && (
        <div className="mt-5 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>No aplicativo, toque em “Adicionar conta” e leia o QR code abaixo.</li>
            <li>Digite o código de 6 dígitos que aparecer no aplicativo para confirmar.</li>
          </ol>
          <div className="flex justify-center rounded-lg border border-line bg-white p-3" aria-label="QR code para o aplicativo autenticador" dangerouslySetInnerHTML={{ __html: qr }} />
          <details className="text-sm">
            <summary className="cursor-pointer text-brand-700">Não consegue ler o QR code? Digite a chave</summary>
            <p className="mt-2 text-xs text-slate-500">Conta: {view.account} · tipo: baseada em tempo (TOTP)</p>
            <p className="mt-1 break-all rounded bg-slate-50 px-2 py-1 font-mono text-sm tracking-wider">{formatSecret(view.enrollment.secret)}</p>
          </details>
        </div>
      )}
      <TwoFactorLoginForm kind={view.kind} />
    </div>
  );
}
