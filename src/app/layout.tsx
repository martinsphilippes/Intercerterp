import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { missingDeploymentConfig } from "@/lib/server/deploy-config";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { NavigationProgress } from "@/components/ui/nav-progress";

export const metadata: Metadata = {
  title: { default: "Intercert ERP", template: "%s · Intercert ERP" },
  description: "ERP Intercert para comércio e varejo",
  applicationName: "Intercert ERP",
  appleWebApp: { capable: true, title: "Intercert", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f2147", viewportFit: "cover" };

function SetupNeeded({ missing }: { missing: string[] }) {
  const vars: Array<[string, string]> = [
    ["APPWRITE_ENDPOINT", "Endpoint da API do projeto (Appwrite Console → Settings), ex.: https://nyc.cloud.appwrite.io/v1"],
    ["APPWRITE_PROJECT_ID", "Project ID do projeto Appwrite"],
    ["APPWRITE_API_KEY", "Chave de API do servidor (marque como Sensitive)"],
    ["APPWRITE_DATABASE_ID", "Opcional — nome do banco (padrão: intercert)"],
    ["CRON_SECRET", "Segredo do executor de tarefas (/api/jobs, Vercel Cron)"],
    ["SETUP_TOKEN", "Token exigido na tela de primeiro acesso"],
    ["APP_TIMEZONE", "Opcional — fuso da instalação (padrão America/Sao_Paulo)"],
  ];
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-ink">Intercert ERP — configuração pendente</h1>
      <p className="mt-2 text-sm text-slate-600">
        A aplicação foi publicada, mas ainda não está conectada ao Appwrite. Nenhum dado é gravado até a configuração ser concluída.
      </p>
      <p className="mt-4 text-sm font-medium text-red-700">Variáveis ausentes: {missing.join(", ")}</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>Na Vercel: Project → Settings → Environment Variables, cadastre:</li>
      </ol>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          {vars.map(([k, d]) => (
            <tr key={k} className="border-t border-slate-200">
              <td className="py-1.5 pr-3 font-mono text-xs">{k}</td>
              <td className="py-1.5 text-slate-600">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ol start={2} className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>Faça um novo deploy (Deployments → Redeploy).</li>
        <li>Abra <span className="font-mono">/primeiro-acesso</span>: o sistema cria as tabelas no Appwrite, a empresa e o administrador.</li>
      </ol>
      <p className="mt-6 text-xs text-slate-500">
        Somente para apresentação: <span className="font-mono">DATA_BACKEND=memory</span> sobe uma demonstração volátil (dados perdidos a cada reinício; não use em operação).
      </p>
    </main>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const missing = missingDeploymentConfig();
  if (missing.length) {
    return (
      <html lang="pt-BR">
        <body className="min-h-screen bg-white">
          <SetupNeeded missing={missing} />
        </body>
      </html>
    );
  }
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <NavigationProgress />
        <ToastProvider>{children}</ToastProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
