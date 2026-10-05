import { ResetForm } from "./form";

export const metadata = { title: "Redefinir senha" };

export default async function Page({ searchParams }: { searchParams: Promise<{ userId?: string; secret?: string }> }) {
  const { userId, secret } = await searchParams;
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Definir nova senha</h1>
      {!userId || !secret ? <p className="mt-4 text-sm text-red-700">Link incompleto. Solicite uma nova recuperação.</p> : <ResetForm userId={userId} secret={secret} />}
    </div>
  );
}
