import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";

/** Cliente contábil inexistente: resposta em português no lugar da página padrão do framework. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-white">
      <EmptyState
        icon={<SearchX className="size-10" aria-hidden />}
        title="Cliente não encontrado"
        description="O cliente não existe na carteira do escritório ou o endereço está incorreto. Se ele foi removido ou atribuído a outro responsável, procure-o pela lista de clientes."
        action={<LinkButton href="/contabil/clientes" variant="primary">Voltar à carteira</LinkButton>}
      />
    </div>
  );
}
