import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Notice } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { PermissionError } from "@/lib/core/errors";
import { networkViewer, relationFinance } from "@/domain/network";
import { requireNetworkSession } from "../../shared";
import { RelationFinanceView } from "../../financeiro/relation-view";

export const metadata = { title: "Meu financeiro com o nível acima" };

/** §46: o parceiro (ou o escritório contador) vê a própria relação com o nível acima — modalidade, saldo, fechamentos. */
export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  const crumbs = [{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Meu financeiro com o nível acima" }];
  if (!v.myNode) {
    return (
      <>
        <PageHeader title="Meu financeiro com o nível acima" crumbs={crumbs} />
        <EmptyState icon={<Wallet className="size-8" aria-hidden />} title="Esta empresa não é um parceiro da rede" description="O financeiro com o nível acima aparece para os parceiros e escritórios contadores da rede." action={v.platform ? <LinkButton href="/rede/financeiro" variant="primary">Resultado da rede</LinkButton> : undefined} />
      </>
    );
  }
  let f;
  try {
    f = await relationFinance(s.ctx, v.myNode.id);
  } catch (e) {
    if (!(e instanceof PermissionError)) throw e;
    return (
      <>
        <PageHeader title="Meu financeiro com o nível acima" crumbs={crumbs} />
        <Notice tone="warn">Seu perfil não tem a consulta do financeiro da rede nem do financeiro da empresa.</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Meu financeiro com o nível acima"
        crumbs={crumbs}
        description={`${f.child.name} ↔ ${f.parentName}: modalidade definida por ${f.parentName}, saldo de créditos, o que está acumulado para o próximo fechamento e os fechamentos feitos. Os títulos ficam no seu financeiro (contas a pagar/receber), para baixa e conciliação normais.`}
        actions={<><LinkButton href="/financeiro/pagar">Contas a pagar</LinkButton><LinkButton href="/rede/financeiro">Resultado da rede</LinkButton></>}
      />
      <RelationFinanceView f={f} />
    </>
  );
}
