import { EmptyState } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { PackageX } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { moduleDecision } from "@/lib/server/modules";
import { moduleDef } from "@/lib/modules/catalog";
import { unscoped } from "@/lib/db/scoped-store";
import { displayMode } from "@/domain/licensing/license";
import { UpsellForm } from "./upsell-form";

export const metadata = { title: "Módulo não disponível" };

/** Destino de uma tela cujo módulo não está habilitado para a empresa (habilitação — docs/modulos). */
export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requireSession();
  const { m } = await searchParams;
  const def = m ? moduleDef(m) : undefined;
  const d = def ? await moduleDecision(s.ctx, s.company, def.key) : null;
  const display = await displayMode(unscoped(s.ctx.store), s.ctx.companyId);
  const offer = Boolean(def && display === "upsell" && d?.level === "none" && def.availability !== "planned");
  return (
    <>
    <EmptyState
      icon={<PackageX className="size-10" />}
      title={def ? `${def.name} não está disponível` : "Módulo não disponível"}
      description={`${d?.reason ?? "Esta área não faz parte dos módulos contratados pela empresa."} Os dados já registrados continuam preservados. Para contratar ou reativar, fale com o responsável pelo contrato da empresa.`}
      action={<LinkButton href="/dashboard">Voltar ao painel</LinkButton>}
    />
    {offer && def ? (
      <div className="text-center">
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">{def.description}</p>
        <UpsellForm module={def.key} />
      </div>
    ) : null}
    </>
  );
}
