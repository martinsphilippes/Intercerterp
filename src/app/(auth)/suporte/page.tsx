import Link from "next/link";
import { PublicTicketForm } from "./form";

export const metadata = { title: "Suporte" };

export default function Page() {
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Suporte</h1>
      <p className="mt-1 text-sm text-slate-500">Problemas para acessar? Registre sua solicitação; ela fica gravada e é tratada pela administração do sistema.</p>
      <PublicTicketForm />
      <Link href="/login" className="mt-6 inline-block text-sm text-brand-700 hover:underline">
        Voltar ao login
      </Link>
    </div>
  );
}
