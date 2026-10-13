import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";

/** Protocolo inexistente na fila da certificação: resposta em português no lugar da página padrão do framework. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-white">
      <EmptyState
        icon={<SearchX className="size-10" aria-hidden />}
        title="Protocolo não encontrado"
        description="A solicitação de certificado não existe ou o endereço está incorreto. Procure o protocolo na fila da equipe de certificação."
        action={<LinkButton href="/administracao/certificacao" variant="primary">Voltar à fila da certificação</LinkButton>}
      />
    </div>
  );
}
