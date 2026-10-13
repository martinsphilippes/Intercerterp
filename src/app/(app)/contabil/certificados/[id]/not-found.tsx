import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";

/** Solicitação de certificado inexistente: resposta em português no lugar da página padrão do framework. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-white">
      <EmptyState
        icon={<SearchX className="size-10" aria-hidden />}
        title="Solicitação não encontrada"
        description="O protocolo não existe na carteira do escritório ou o endereço está incorreto. Procure a solicitação pela lista de certificados digitais."
        action={<LinkButton href="/contabil/certificados" variant="primary">Voltar aos certificados digitais</LinkButton>}
      />
    </div>
  );
}
