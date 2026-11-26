import { ExternalLink, RefreshCw } from "lucide-react";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import type { DbOutage } from "@/lib/db/outage";

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
}

const nobody = (
  <>
    Não é problema de usuário nem de senha — <strong>ninguém consegue entrar</strong>
  </>
);

/** Texto do aviso por motivo (o banco é o Postgres conectado ao projeto na Vercel). */
function copyFor(outage: DbOutage): Copy {
  if (outage.kind === "unreachable") {
    return {
      tone: "warn",
      title: "O banco de dados não respondeu",
      what: "Não é problema de usuário nem de senha. Costuma ser uma instabilidade passageira: aguarde alguns instantes e tente de novo. Se continuar, fale com o suporte.",
    };
  }
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

/**
 * Aviso de banco indisponível na tela de login: diz que não é a senha, o motivo e quem resolve. O detalhe técnico
 * (`outage.detail`) fica só no log do servidor — a tela é pública.
 */
export function OutageNotice({ outage, retryHref }: { outage: DbOutage; retryHref: string }) {
  const c = copyFor(outage);
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
      </Notice>
    </div>
  );
}
