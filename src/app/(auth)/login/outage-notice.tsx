import { ExternalLink, RefreshCw } from "lucide-react";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import type { DbOutage } from "@/lib/db/outage";

const APPWRITE_CONSOLE = "https://cloud.appwrite.io/console";

/**
 * Aviso de banco indisponível na tela de login: diz que não é a senha, o motivo e quem resolve. O detalhe técnico
 * (`outage.detail`) fica só no log do servidor — a tela é pública.
 */
export function OutageNotice({ outage, retryHref }: { outage: DbOutage; retryHref: string }) {
  // link comum (recarrega a página inteira): depois de reativar o banco, um clique confere se o acesso voltou
  const retry = (
    <a href={retryHref} className={buttonClass("secondary", "sm")}>
      <RefreshCw className="size-3.5" aria-hidden /> Tentar novamente
    </a>
  );
  if (outage.kind === "paused") {
    return (
      <div className="mt-5">
        <Notice tone="bad" title="Acesso bloqueado: o banco de dados está pausado">
          <p>
            Não é problema de usuário nem de senha — <strong>ninguém consegue entrar</strong> enquanto o banco estiver pausado. O Appwrite pausa os projetos do plano gratuito depois de 7 dias sem atividade no console dele. Os dados continuam guardados.
          </p>
          <p className="mt-2">
            <strong>Como liberar (administrador):</strong> abra o console do Appwrite, entre no projeto pausado e confirme a reativação. O acesso volta em seguida.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={APPWRITE_CONSOLE} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
              <ExternalLink className="size-3.5" aria-hidden /> Abrir o console do Appwrite
            </a>
            {retry}
          </div>
          <p className="mt-3 text-xs opacity-80">Atenção: um projeto que fica 90 dias pausado é apagado pelo Appwrite, com todos os dados.</p>
        </Notice>
      </div>
    );
  }
  if (outage.kind === "credentials") {
    return (
      <div className="mt-5">
        <Notice tone="bad" title="Acesso bloqueado: o servidor não conseguiu abrir o banco de dados">
          <p>
            Não é problema de usuário nem de senha — <strong>ninguém consegue entrar</strong> até a configuração ser corrigida. O Appwrite recusou o acesso do servidor (chave expirada, sem permissão ou de outro projeto).
          </p>
          <p className="mt-2">
            <strong>Como liberar (administrador):</strong> confira <span className="font-mono text-xs">APPWRITE_ENDPOINT</span>, <span className="font-mono text-xs">APPWRITE_PROJECT_ID</span> e <span className="font-mono text-xs">APPWRITE_API_KEY</span> nas variáveis do servidor e publique de novo.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">{retry}</div>
        </Notice>
      </div>
    );
  }
  return (
    <div className="mt-5">
      <Notice tone="warn" title="O banco de dados não respondeu">
        <p>Não é problema de usuário nem de senha. Costuma ser uma instabilidade passageira: aguarde alguns instantes e tente de novo. Se continuar, fale com o suporte.</p>
        <div className="mt-3 flex flex-wrap gap-2">{retry}</div>
      </Notice>
    </div>
  );
}
