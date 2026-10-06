/** Exibido imediatamente ao trocar de tela, enquanto o servidor monta a próxima página. */
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-500" role="status" aria-live="polite">
      <span className="size-8 animate-spin rounded-full border-[3px] border-brand-600 border-t-transparent" aria-hidden />
      <p className="text-sm">Carregando…</p>
    </div>
  );
}
