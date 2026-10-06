import Link from "next/link";
import { InstallAppButton } from "@/components/pwa/install-button";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { isEmptyInstallation, ensureBootstrap } from "@/lib/server/bootstrap";
import { configuredBackend } from "@/lib/db";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await ensureBootstrap();
  const s = await getSession();
  if (s?.ctx.companyId) redirect("/dashboard");
  if (await isEmptyInstallation().catch(() => false)) redirect("/primeiro-acesso");
  const { next } = await searchParams;
  const demo = configuredBackend() === "memory" || process.env.SHOW_DEMO_LOGIN === "1";
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Bem-vindo!</h1>
      <p className="mt-1 text-sm text-slate-500">Entre com seu usuário ou e-mail para acessar o sistema.</p>
      <LoginForm next={next} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/recuperar-senha" className="text-brand-700 hover:underline">
          Esqueci minha senha
        </Link>
        <Link href="/suporte" className="text-slate-500 hover:underline">
          Precisa de ajuda? Fale com o suporte
        </Link>
      </div>
      <div className="mt-4 flex justify-end">
        <InstallAppButton />
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck className="size-3.5" aria-hidden /> Conexão protegida · tentativas de acesso são registradas
      </p>
      {demo && (
        <div className="mt-6 rounded-md border border-fuchsia-200 bg-fuchsia-50 p-3 text-xs text-fuchsia-900">
          <p className="font-semibold">Ambiente de demonstração</p>
          <p className="mt-1">Usuários: admin, gerente, caixa, estoque, financeiro, fiscal · senha <code>Intercert@2026</code></p>
        </div>
      )}
    </div>
  );
}
