import { redirect } from "next/navigation";
import { isEmptyInstallation, installationState } from "@/lib/server/bootstrap";
import { configuredBackend } from "@/lib/db";
import { SetupForm } from "./form";

export const metadata = { title: "Primeiro acesso" };
export const maxDuration = 300;
// estado da instalação muda durante a configuração: nunca pré-renderizar no build
export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await isEmptyInstallation())) redirect("/login");
  const state = await installationState();
  const needsToken = Boolean(process.env.SETUP_TOKEN);
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Configurar a instalação</h1>
      <p className="mt-1 text-sm text-slate-500">Armazenamento: {configuredBackend()}. Nenhum usuário cadastrado ainda.</p>
      {!state.reachable ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível acessar o banco de dados: {state.error ?? "confira se o banco está conectado ao projeto na Vercel (DATABASE_URL)"}.
        </p>
      ) : (
        <SetupForm needsToken={needsToken} />
      )}
    </div>
  );
}
