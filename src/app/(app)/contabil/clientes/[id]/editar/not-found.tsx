import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";

/** Cliente inexistente ou fora da carteira visível do usuário: a mesma resposta nos dois casos, sem revelar o cadastro. */
export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-white">
      <EmptyState
        icon={<SearchX className="size-10" aria-hidden />}
        title="Cliente não encontrado"
        description="O cliente não existe ou não está na sua carteira. Se ele foi atribuído a outro responsável, peça acesso a quem tem a permissão “Ver toda a carteira de clientes”."
        action={<LinkButton href="/contabil/clientes" variant="primary">Voltar à carteira</LinkButton>}
      />
    </div>
  );
}
