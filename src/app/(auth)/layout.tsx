import { configuredBackend } from "@/lib/db";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const backend = configuredBackend();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-accent-500 font-bold">IC</div>
          <div>
            <p className="text-lg font-semibold">Intercert ERP</p>
            <p className="text-sm text-brand-200">Comércio e varejo</p>
          </div>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Vendas, estoque, financeiro, compras e fiscal na mesma operação.</h2>
          <ul className="mt-6 space-y-2 text-sm text-brand-100">
            <li>• PDV rápido com leitor de código de barras e atalhos de teclado</li>
            <li>• Cada venda, compra e devolução rastreada até o extrato e o documento fiscal</li>
            <li>• Indicadores calculados dos registros reais, com detalhe de cada total</li>
          </ul>
        </div>
        <p className="text-xs text-brand-300">
          Armazenamento: {backend === "appwrite" ? "Appwrite" : backend === "local" ? "local (desenvolvimento)" : "memória (demonstração volátil)"}
        </p>
        <div className="pointer-events-none absolute -bottom-24 -right-24 size-80 rounded-full bg-accent-500/20 blur-3xl" />
      </aside>
      <main className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
