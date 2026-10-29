import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { NETWORK_SCOPE, networkSettings, networkViewer } from "@/domain/network";
import { LevelLabelsForm } from "../forms";
import { IdleDaysForm } from "./idle-form";
import { PlatformFinanceForm } from "../financeiro/forms";
import { HistoryList, requireNetworkSession } from "../shared";

export const metadata = { title: "Parâmetros da rede" };

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  if (!v.platform) redirect("/rede/minha");
  const { levelLabels, idleAlertDays, platformCompanyId, acClosingDay, acDueDays } = await networkSettings(s.ctx.store);
  const nodeCompanies = new Set(v.nodes.map((n) => n.nodeCompanyId));
  const companies = (await listAll(unscoped(s.ctx.store), "companies", {}, 2000)).filter((c) => !nodeCompanies.has(c.id) && c.status !== "closed").map((c) => ({ value: c.id, label: c.tradeName || c.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const history = (await listAll(unscoped(s.ctx.store), "audit_logs", { filters: [["eq", "entityType", "cert_network"], ["eq", "entityId", NETWORK_SCOPE], ["eq", "action", ["network.level_labels", "network.idle_alert_days", "network.platform_finance"]]] }, 200)).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  return (
    <>
      <PageHeader title="Parâmetros da rede" crumbs={[{ label: "Rede de certificação", href: "/rede" }, { label: "Parâmetros" }]} description="Rótulos dos quatro níveis da rede comercial (as chaves internas e as regras não mudam) e o alerta de renovação sem ação." />
      <div className="space-y-4">
        <Card><LevelLabelsForm labels={levelLabels} /></Card>
        <Card title="Alerta de renovação “ninguém agiu”" description="Rotina diária: certificado perto do vencimento sem contato registrado nem renovação aberta avisa o responsável do nó e o nível imediatamente acima."><IdleDaysForm days={idleAlertDays} /></Card>
        <Card title="Financeiro da plataforma (§46)" description="Empresa da Intercert no ERP: recebe o que o nível diretamente abaixo paga (receita da plataforma), cobra o cliente quando toda a cadeia é comissionada e acumula o custo AC devido ao fornecedor (Soluti/Serpro), fechado mensalmente como título a pagar.">
          <PlatformFinanceForm companies={companies} current={{ platformCompanyId, acClosingDay, acDueDays }} />
        </Card>
        <Card title="Histórico"><HistoryList rows={history} /></Card>
      </div>
    </>
  );
}
