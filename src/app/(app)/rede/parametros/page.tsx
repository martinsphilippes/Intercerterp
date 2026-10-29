import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { NETWORK_SCOPE, networkSettings, networkViewer } from "@/domain/network";
import { LevelLabelsForm } from "../forms";
import { IdleDaysForm } from "./idle-form";
import { HistoryList, requireNetworkSession } from "../shared";

export const metadata = { title: "Parâmetros da rede" };

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  if (!v.platform) redirect("/rede/minha");
  const { levelLabels, idleAlertDays } = await networkSettings(s.ctx.store);
  const history = (await listAll(unscoped(s.ctx.store), "audit_logs", { filters: [["eq", "entityType", "cert_network"], ["eq", "entityId", NETWORK_SCOPE], ["eq", "action", ["network.level_labels", "network.idle_alert_days"]]] }, 200)).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  return (
    <>
      <PageHeader title="Parâmetros da rede" crumbs={[{ label: "Rede de certificação", href: "/rede" }, { label: "Parâmetros" }]} description="Rótulos dos quatro níveis da rede comercial (as chaves internas e as regras não mudam) e o alerta de renovação sem ação." />
      <div className="space-y-4">
        <Card><LevelLabelsForm labels={levelLabels} /></Card>
        <Card title="Alerta de renovação “ninguém agiu”" description="Rotina diária: certificado perto do vencimento sem contato registrado nem renovação aberta avisa o responsável do nó e o nível imediatamente acima."><IdleDaysForm days={idleAlertDays} /></Card>
        <Card title="Histórico"><HistoryList rows={history} /></Card>
      </div>
    </>
  );
}
