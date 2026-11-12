import { ExternalLink, RefreshCw } from "lucide-react";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import type { DbOutage } from "@/lib/db/outage";

const APPWRITE_CONSOLE = "https://cloud.appwrite.io/console";
const VERCEL_STORAGE = "https://vercel.com/dashboard/stores";

interface Copy {
  tone: "bad" | "warn";
  title: string;
  /** o que está acontecendo (para qualquer pessoa na tela) */
  what: React.ReactNode;
  /** como liberar (para o administrador) */
  how?: React.ReactNode;
  /** painel onde o administrador resolve */
  panel?: { href: string; label: string };
  footnote?: string;
}

const nobody = (
  <>
    Não é problema de usuário nem de senha — <strong>ninguém consegue entrar</strong>
  </>
);

/** Texto do aviso por motivo e por onde o banco está (Postgres conectado na Vercel ou Appwrite). */
function copyFor(outage: DbOutage, provider: "postgres" | "appwrite"): Copy {
  if (outage.kind === "unreachable") {
    return {
      tone: "warn",
      title: "O banco de dados não respondeu",
      what: "Não é problema de usuário nem de senha. Costuma ser uma instabilidade passageira: aguarde alguns instantes e tente de novo. Se continuar, fale com o suporte.",
    };
  }
  if (provider === "postgres") {
    const panel = { href: VERCEL_STORAGE, label: "Abrir o armazenamento na Vercel" };
    if (outage.kind === "quota") {
      return {
        tone: "bad",
        title: "Acesso bloqueado: limite do plano do banco de dados atingido",
        what: <>{nobody} enquanto o limite estiver valendo. O provedor do banco suspendeu o processamento porque a cota do plano acabou neste período. Os dados continuam guardados.</>,
        how: "na Vercel, abra Storage, entre no banco e veja o uso. A cota volta na virada do período; para liberar antes, mude o plano do banco.",
        panel,
      };
    }
    return {
      tone: "bad",
      title: "Acesso bloqueado: o servidor não conseguiu abrir o banco de dados",
      what: <>{nobody} até isso ser corrigido. O banco recusou a conexão do servidor (usuário, senha ou banco incorretos, ou o banco foi desconectado do projeto).</>,
      how: (
        <>
          na Vercel, abra Storage, confira se o banco está conectado a este projeto (é a conexão que cria a variável <span className="font-mono text-xs">DATABASE_URL</span>) e publique de novo.
        </>
      ),
      panel,
    };
  }
  const panel = { href: APPWRITE_CONSOLE, label: "Abrir o console do Appwrite" };
  if (outage.kind === "paused") {
    return {
      tone: "bad",
      title: "Acesso bloqueado: o banco de dados está pausado",
      what: <>{nobody} enquanto o banco estiver pausado. O Appwrite pausa os projetos do plano gratuito depois de 7 dias sem atividade no console dele. Os dados continuam guardados.</>,
      how: "abra o console do Appwrite, entre no projeto pausado e confirme a reativação. O acesso volta em seguida.",
      panel,
      footnote: "Atenção: um projeto que fica 90 dias pausado é apagado pelo Appwrite, com todos os dados.",
    };
  }
  if (outage.kind === "quota") {
    return {
      tone: "bad",
      title: "Acesso bloqueado: limite do plano do banco de dados atingido",
      what: <>{nobody} enquanto o limite estiver valendo. O Appwrite limita o banco quando a organização passa da cota do plano no mês (no plano gratuito, cada linha lida conta). Os dados continuam guardados.</>,
      how: "no console do Appwrite, abra a organização e veja o uso. O limite zera na virada do período; para liberar antes, faça o upgrade do plano.",
      panel,
    };
  }
  return {
    tone: "bad",
    title: "Acesso bloqueado: o servidor não conseguiu abrir o banco de dados",
    what: <>{nobody} até isso ser corrigido. O Appwrite recusou o acesso do servidor: chave expirada, sem permissão ou de outro projeto — ou acesso da organização restrito pelo próprio Appwrite (limite do plano).</>,
    how: (
      <>
        veja no console do Appwrite se a organização está com o acesso restrito; se não estiver, confira <span className="font-mono text-xs">APPWRITE_ENDPOINT</span>, <span className="font-mono text-xs">APPWRITE_PROJECT_ID</span> e{" "}
        <span className="font-mono text-xs">APPWRITE_API_KEY</span> nas variáveis do servidor e publique de novo.
      </>
    ),
    panel,
  };
}

/**
 * Aviso de banco indisponível na tela de login: diz que não é a senha, o motivo e quem resolve. O detalhe técnico
 * (`outage.detail`) fica só no log do servidor — a tela é pública.
 */
export function OutageNotice({ outage, retryHref, provider }: { outage: DbOutage; retryHref: string; provider: "postgres" | "appwrite" }) {
  const c = copyFor(outage, provider);
  return (
    <div className="mt-5">
      <Notice tone={c.tone} title={c.title}>
        <p>{c.what}</p>
        {c.how && (
          <p className="mt-2">
            <strong>Como liberar (administrador):</strong> {c.how}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {c.panel && (
            <a href={c.panel.href} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
              <ExternalLink className="size-3.5" aria-hidden /> {c.panel.label}
            </a>
          )}
          {/* link comum (recarrega a página inteira): depois de liberar o banco, um clique confere se o acesso voltou */}
          <a href={retryHref} className={buttonClass("secondary", "sm")}>
            <RefreshCw className="size-3.5" aria-hidden /> Tentar novamente
          </a>
        </div>
        {c.footnote && <p className="mt-3 text-xs opacity-80">{c.footnote}</p>}
      </Notice>
    </div>
  );
}
