import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";

/** Registro ou página inexistente dentro da área autenticada: resposta em português no lugar da página padrão do framework. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-white">
      <EmptyState
        icon={<SearchX className="size-10" aria-hidden />}
        title="Página ou registro não encontrado"
        description="O endereço está incorreto ou o registro não existe mais (pode ter sido removido ou pertencer a outra empresa). Volte ao painel e procure pelo menu ou pela busca."
        action={<LinkButton href="/dashboard" variant="primary">Voltar ao painel</LinkButton>}
      />
    </div>
  );
}
