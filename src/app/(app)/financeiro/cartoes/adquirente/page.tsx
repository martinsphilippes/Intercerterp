import Link from "@/components/ui/link";
import { Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { listAll } from "@/lib/db";
import { getSetting } from "@/lib/core/settings";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can, canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { ACQUIRER_FIELDS } from "@/domain/bank/acquirer";
import { ACQUIRER_SAMPLE_KEY, listAcquirerImports } from "@/domain/card-reconciliation";
import { AcquirerWizard } from "./acquirer-wizard";

export const metadata = { title: "Arquivo da adquirente" };

const EXAMPLE = `Data da venda;NSU;Autorização;Bandeira;Parcela;Valor bruto;Taxa;Valor líquido;Data de crédito
10/10/2026;552001;A1B2C3;Visa;1/1;44,90;0,44;44,46;11/10/2026
02/09/2026;774411;;Mastercard;2/3;60,00;2,09;57,91;02/11/2026`;

/** FIN-24 — conciliação dos recebíveis de cartão com o arquivo de vendas/pagamentos da adquirente. */
export default async function Page() {
  const s = await requireSession("finance");
  await requireFeaturePage(s, "taxasCartao");
  const accounts = (await listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }))
    .sort((a, b) => (a.kind === "bank" ? -1 : 1) - (b.kind === "bank" ? -1 : 1) || a.name.localeCompare(b.name, "pt-BR"))
    .map((a) => ({ value: a.id, label: a.name }));
  const cardMethods = await listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "kind", ["debit", "credit"]]] });
  const defaultAccount = cardMethods.find((m) => m.accountId)?.accountId ?? accounts[0]?.value ?? "";
  const [imports, users, sampleId] = await Promise.all([listAcquirerImports(s.ctx), nameMap(s.ctx, "users"), getSetting<string | null>(s.ctx.store, s.ctx.companyId, null, ACQUIRER_SAMPLE_KEY, null)]);
  const block = !s.ctx.branchId ? "Selecione uma filial para baixar (consolidado é somente consulta)." : !canDo(s.user, "finance.settle") ? "Sem permissão para baixar títulos." : null;
  return (
    <>
      <PageHeader
        title="Conciliação com o arquivo da adquirente"
        crumbs={[{ label: "Financeiro" }, { label: "Recebíveis de cartão", href: "/financeiro/cartoes" }, { label: "Arquivo da adquirente" }]}
        description="Confira o que a maquininha realmente pagou: cada linha do arquivo é casada com o recebível pelo NSU/autorização e parcela (ou pelo valor e data da venda). As casadas são baixadas com a taxa cobrada; diferenças de taxa, data, valor e linhas sem correspondência vão para o relatório de divergências."
        actions={
          sampleId ? (
            <a className={buttonClass("secondary")} href={`/api/files/${sampleId}`} title="Arquivo de exemplo da demonstração (layout padrão)">
              <Download className="size-4" aria-hidden /> Arquivo de exemplo
            </a>
          ) : null
        }
      />
      <AcquirerWizard accounts={accounts} defaultAccount={defaultAccount} fields={ACQUIRER_FIELDS.map((f) => ({ key: f.key as string, label: f.label, required: f.required }))} canApply={can(s.user, "finance", "edit") && !block} block={block} />
      <Card title="Arquivos conciliados" className="mt-4" bodyClass="p-0">
        {imports.length === 0 ? (
          <EmptyState title="Nenhum arquivo conciliado ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Importado em</th>
                  <th>Por</th>
                  <th className="text-right">Baixadas</th>
                  <th className="text-right">Bruto baixado</th>
                  <th className="text-right">Diferença de taxa</th>
                  <th>Divergências</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => {
                  const b = i.summary?.byStatus ?? {};
                  const problems = ["divergent", "not_found", "ambiguous", "duplicate", "invalid", "error"].reduce((a, k) => a + (b[k] ?? 0), 0);
                  return (
                    <tr key={i.id}>
                      <td>
                        <Link className="font-medium text-brand-700 hover:underline" href={`/financeiro/cartoes/adquirente/${i.id}`}>
                          {i.fileName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(i.createdAt)}</td>
                      <td>{users.get(i.createdBy) ?? "—"}</td>
                      <td className="tabular text-right">{b.applied ?? 0}</td>
                      <td className="tabular text-right">{formatMoney(i.summary?.matchedGross ?? 0)}</td>
                      <td className="tabular text-right">{formatMoney(i.summary?.feeDiff ?? 0)}</td>
                      <td>{problems ? <Badge tone="warn">{problems} linha(s)</Badge> : <Badge tone="good">Nenhuma</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Layout do arquivo (CSV)" className="mt-4" description="Leitor genérico: as colunas são reconhecidas pelo cabeçalho e podem ser ajustadas na prévia. Separador ; , tab ou | (detectado), datas dd/mm/aaaa ou aaaa-mm-dd, vírgula ou ponto decimal.">
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Obrigatórias: <strong>NSU</strong> (ou autorização), <strong>valor bruto</strong>, <strong>data de crédito</strong> e a <strong>taxa</strong> (em R$ ou em %) ou o <strong>valor líquido</strong>.</li>
          <li>Recomendadas: data da venda, bandeira e parcela no formato “2/3” (parcela 2 de 3). Linhas de total são ignoradas; cancelamentos/chargebacks (valores negativos) são listados para tratamento manual.</li>
          <li>O mesmo arquivo na mesma conta nunca baixa duas vezes; outro arquivo com a mesma venda aparece como “já liquidada”.</li>
        </ul>
        <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{EXAMPLE}</pre>
      </Card>
    </>
  );
}
