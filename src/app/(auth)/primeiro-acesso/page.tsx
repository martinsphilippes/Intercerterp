import { redirect } from "next/navigation";
import { isEmptyInstallation, installationState } from "@/lib/server/bootstrap";
import { configuredBackend } from "@/lib/db";
import { SetupForm, ProvisionPanel } from "./form";

export const metadata = { title: "Primeiro acesso" };
export const maxDuration = 300;

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
          Não foi possível acessar o Appwrite: {"error" in state ? String(state.error) : "verifique APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY"}.
        </p>
      ) : !state.provisioned ? (
        <ProvisionPanel missing={state.missing.length} needsToken={needsToken} />
      ) : (
        <SetupForm needsToken={needsToken} />
      )}
    </div>
  );
}
