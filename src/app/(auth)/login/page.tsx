import Link from "@/components/ui/link";
import { InstallAppButton } from "@/components/pwa/install-button";
import { redirect, unstable_rethrow } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { configuredBackend } from "@/lib/db";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./form";
import { QuickAccess } from "./quick-access";
import { OutageNotice } from "./outage-notice";
import { loginScreenState } from "./access";

export const metadata = { title: "Entrar" };
// o estado do banco e da sessão é o do momento do acesso: nunca pré-renderizar no build
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await ensureBootstrap();
  // sessão ilegível (banco fora do ar) não derruba a tela: o aviso abaixo explica o motivo
  const s = await getSession().catch((e) => {
    unstable_rethrow(e); // sinais internos do Next (redirecionamento, renderização dinâmica) seguem o fluxo normal
    console.error("[login] não foi possível ler a sessão", e);
    return null;
  });
  if (s?.ctx.companyId) redirect("/dashboard");
  // instalação vazia, banco indisponível e acessos da demonstração (lista de reserva quando o banco não responde)
  const state = await loginScreenState();
  if (state.empty) redirect("/primeiro-acesso");
  const { next } = await searchParams;
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Bem-vindo!</h1>
      <p className="mt-1 text-sm text-slate-500">Entre com seu usuário ou e-mail para acessar o sistema.</p>
      {state.outage && <OutageNotice outage={state.outage} provider={configuredBackend() === "appwrite" ? "appwrite" : "postgres"} retryHref={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} />}
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
      {state.quick.length > 0 && <QuickAccess users={state.quick} password={process.env.DEMO_PASSWORD || "Intercert@2026"} live={state.quickLive} unavailable={Boolean(state.outage)} />}
    </div>
  );
}
