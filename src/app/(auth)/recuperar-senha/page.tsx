import Link from "next/link";
import { RecoveryForm } from "./form";

export const metadata = { title: "Recuperar senha" };

export default function Page() {
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      <p className="mt-1 text-sm text-slate-500">Informe seu usuário ou e-mail. Enviaremos as instruções pelo canal configurado.</p>
      <RecoveryForm />
      <Link href="/login" className="mt-6 inline-block text-sm text-brand-700 hover:underline">
        Voltar ao login
      </Link>
    </div>
  );
}
