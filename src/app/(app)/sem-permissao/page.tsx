import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export default function Page() {
  return (
    <EmptyState
      icon={<ShieldAlert className="size-10" />}
      title="Acesso não permitido"
      description="Seu perfil não tem permissão para esta área. Solicite ao administrador a liberação em Administração → Usuários e permissões."
      action={<LinkButton href="/dashboard">Voltar ao painel</LinkButton>}
    />
  );
}
