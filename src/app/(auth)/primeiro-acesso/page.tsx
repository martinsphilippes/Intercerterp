import { redirect } from "next/navigation";
import { isEmptyInstallation } from "@/lib/server/bootstrap";
import { configuredBackend } from "@/lib/db";
import { SetupForm } from "./form";

export const metadata = { title: "Primeiro acesso" };

export default async function Page() {
  if (!(await isEmptyInstallation())) redirect("/login");
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Configurar a instalação</h1>
      <p className="mt-1 text-sm text-slate-500">Banco de dados vazio ({configuredBackend()}). Cadastre sua empresa e o administrador, ou carregue a demonstração completa.</p>
      <SetupForm />
    </div>
  );
}
