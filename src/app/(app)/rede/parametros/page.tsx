import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { NETWORK_SCOPE, networkSettings, networkViewer } from "@/domain/network";
import { LevelLabelsForm } from "../forms";
import { HistoryList, requireNetworkSession } from "../shared";

export const metadata = { title: "Rótulos dos níveis da rede" };

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  if (!v.platform) redirect("/rede/minha");
  const { levelLabels } = await networkSettings(s.ctx.store);
  const history = (await listAll(unscoped(s.ctx.store), "audit_logs", { filters: [["eq", "entityType", "cert_network"], ["eq", "entityId", NETWORK_SCOPE], ["eq", "action", "network.level_labels"]] }, 200)).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  return (
    <>
      <PageHeader title="Rótulos dos níveis" crumbs={[{ label: "Rede de certificação", href: "/rede" }, { label: "Rótulos dos níveis" }]} description="Nomes exibidos para os quatro níveis da rede comercial. As chaves internas (master, regional, revenda, contador) e as regras não mudam." />
      <div className="space-y-4">
        <Card><LevelLabelsForm labels={levelLabels} /></Card>
        <Card title="Histórico"><HistoryList rows={history} /></Card>
      </div>
    </>
  );
}
