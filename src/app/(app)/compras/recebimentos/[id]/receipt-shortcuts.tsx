import { BadgePercent, Tag } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { can, canDo } from "@/lib/permissions";
import { featureOn } from "@/lib/server/features";
import type { SessionInfo } from "@/lib/server/session";

/** Atalhos do recebimento concluído: precificação após a entrada (COM-07) e etiquetas (CAD-17). */
export async function ReceiptShortcuts({ s, receipt }: { s: SessionInfo; receipt: Record<string, any> }) {
  if (receipt.status !== "confirmed") return null;
  const [pricingOn, labelsOn] = await Promise.all([featureOn(s, "precificacaoEntrada"), featureOn(s, "etiquetas")]);
  const canPrice = pricingOn && canDo(s.user, "purchase.pricing") && can(s.user, "products", "view");
  const canLabels = labelsOn && can(s.user, "products", "view");
  const done = receipt.pricingStatus === "done";
  return (
    <>
      {canPrice && (
        <LinkButton href={`/compras/recebimentos/${receipt.id}/precificacao`} variant={done ? "secondary" : "accent"}>
          <BadgePercent className="size-4" /> {done ? "Precificação" : "Precificar"}
        </LinkButton>
      )}
      {canLabels && (
        <LinkButton href={`/produtos/etiquetas?recebimento=${receipt.id}`}>
          <Tag className="size-4" /> Imprimir etiquetas
        </LinkButton>
      )}
    </>
  );
}
