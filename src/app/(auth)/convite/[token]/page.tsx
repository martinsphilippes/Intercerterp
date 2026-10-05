import { ResetLike } from "./form";

export const metadata = { title: "Primeiro acesso" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="rounded-xl border border-line bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Primeiro acesso</h1>
      <p className="mt-1 text-sm text-slate-500">Defina sua senha para ativar o acesso convidado.</p>
      <ResetLike token={token} />
    </div>
  );
}
