import Link from "next/link";
import { InstallAppButton } from "@/components/pwa/install-button";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { isEmptyInstallation, ensureBootstrap } from "@/lib/server/bootstrap";
import { configuredBackend, getStore, listAll } from "@/lib/db";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./form";
import { QuickAccess, type QuickUser } from "./quick-access";

/** Setor exibido no acesso rápido, na ordem de apresentação. */
const SECTORS: Record<string, { sector: string; order: number }> = {
  admin: { sector: "Administração", order: 1 },
  gerente: { sector: "Gerência", order: 2 },
  diretoria: { sector: "Diretoria", order: 3 },
  caixa: { sector: "Caixa (PDV)", order: 4 },
  estoque: { sector: "Estoque", order: 5 },
  financeiro: { sector: "Financeiro", order: 6 },
  fiscal: { sector: "Fiscal", order: 7 },
};

/** Somente usuários da empresa de demonstração, ativos e com acesso criado — nunca contas reais. */
async function demoUsers(): Promise<QuickUser[]> {
  const store = getStore();
  const users = (await listAll(store, "users", { filters: [["eq", "isDemo", true]] })).filter((u) => u.status === "active" && u.authId && !u.isAdmin);
  const branches = await listAll(store, "branches");
  const branchName = new Map(branches.map((b) => [b.id, b.name as string]));
  return users
    .map((u) => ({
      login: u.login as string,
      name: u.name as string,
      sector: SECTORS[u.login]?.sector ?? (u.name as string),
      scope: (u.branchIds ?? []).length ? (u.branchIds as string[]).map((id) => branchName.get(id) ?? "filial").join(", ") : "todas as filiais",
      order: SECTORS[u.login]?.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...u }) => u);
}

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await ensureBootstrap();
  const s = await getSession();
  if (s?.ctx.companyId) redirect("/dashboard");
  if (await isEmptyInstallation().catch(() => false)) redirect("/primeiro-acesso");
  const { next } = await searchParams;
  // acesso rápido só em ambiente de teste (backend em memória ou SHOW_DEMO_LOGIN=1)
  const demo = configuredBackend() === "memory" || process.env.SHOW_DEMO_LOGIN === "1";
  const quick = demo ? await demoUsers().catch(() => []) : [];
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
      {quick.length > 0 && <QuickAccess users={quick} password={process.env.DEMO_PASSWORD || "Intercert@2026"} />}
    </div>
  );
}
