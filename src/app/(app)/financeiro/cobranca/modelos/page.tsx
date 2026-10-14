import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { Timeline } from "@/components/ui/timeline";
import { detId } from "@/lib/db";
import { addDays, formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { collectionContext } from "@/domain/collection";
import { COLLECTION_TEMPLATES_KEY } from "@/domain/collection-templates";
import { TemplatesForm } from "./templates-form";

export const metadata = { title: "Modelos de cobrança" };

/** Modelos de mensagem de cobrança pelo WhatsApp (PLA-27): lembrete, vencido e renegociação, com variáveis. */
export default async function Page() {
  const s = await requireSession("finance");
  await requireFeaturePage(s, "cobrancaWhatsapp");
  const cc = await collectionContext(s.ctx.store, s.ctx.companyId, null);
  const t0 = today();
  const sample = {
    cliente: "Maria Aparecida Souza",
    valor: formatMoney(12540),
    vencimento: formatDate(addDays(t0, -12)),
    dias_atraso: "12",
    empresa: cc.companyName,
    link_pix: cc.pix,
    parcela: "2/3",
    documento: "Venda nº 1042",
  };
  const settingRef = `setting:${detId("setting", `${s.ctx.companyId}|*|${COLLECTION_TEMPLATES_KEY}`)}`;
  return (
    <>
      <PageHeader
        title="Modelos de cobrança (WhatsApp)"
        crumbs={[{ label: "Financeiro" }, { label: "Contas a receber", href: "/financeiro/receber" }, { label: "Modelos de cobrança" }]}
        description="Mensagens usadas no botão “Cobrar no WhatsApp” das parcelas a receber. O WhatsApp abre no aparelho do operador com o texto preenchido (sem custo de API) e o contato fica no histórico do título."
      />
      <div className="space-y-4">
        <Notice tone="info">
          O {"{valor}"} da parcela vencida já inclui multa e juros sugeridos pelos parâmetros de atraso do Financeiro (os mesmos da baixa). Linhas com variável sem valor — por exemplo {"{link_pix}"} sem chave Pix — são omitidas.
        </Notice>
        <TemplatesForm initial={cc.templates} readOnly={!can(s.user, "finance", "edit")} sample={sample} />
        <Card title="Histórico de alterações">
          <Timeline store={s.ctx.store} refs={[settingRef]} limit={30} />
        </Card>
      </div>
    </>
  );
}
