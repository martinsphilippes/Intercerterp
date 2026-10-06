import Link from "@/components/ui/link";
import { Building2, Link2Off } from "lucide-react";
import type { Store } from "@/lib/db/types";
import { companyAccountingLink, isAccountingFirm, LINK_CODE_DAYS } from "@/domain/accounting";
import { Card, DefinitionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { revokeLinkByCompanyAction } from "@/app/(app)/contabil/actions";
import { AcceptLinkForm } from "./accounting-link-form";

/**
 * Lado da EMPRESA no ERP: vínculo com o escritório contábil que também usa o Intercert.
 * Sem vínculo, a empresa informa o código emitido pelo escritório; com vínculo ativo, mostra o escritório,
 * o que passa a acontecer automaticamente e permite desfazer (o que já foi entregue é preservado).
 */
export async function AccountingLink({ companyId, store, canEdit }: { companyId: string; store: Store; canEdit: boolean }) {
  const company = await store.get("companies", companyId);
  if (isAccountingFirm(company)) {
    return (
      <Card title="Escritório contábil no Intercert">
        <Notice tone="info" title="Esta empresa é um escritório contábil">
          O vínculo com as empresas atendidas é feito a partir do cadastro de cada cliente, em{" "}
          <Link href="/contabil/clientes" className="underline">Gestão contábil → Clientes</Link>: emita o código de vínculo lá e informe-o ao administrador da empresa.
        </Notice>
      </Card>
    );
  }

  const link = await companyAccountingLink(store, companyId);
  const history = (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold text-slate-600">Histórico do vínculo</p>
      <Timeline store={store} refs={["integration:accounting"]} limit={10} />
    </div>
  );

  if (!link) {
    return (
      <Card title="Escritório contábil no Intercert" description="Entrega automática do pacote mensal na caixa de entrada do escritório." actions={<StatusBadge kind="link" status="none" />}>
        <div className="space-y-3 text-sm">
          <p className="text-slate-700">
            Se o seu escritório contábil também usa o Intercert, peça a ele o <b>código de vínculo</b> (formato XXXXX-XXXXX, válido por {LINK_CODE_DAYS} dias) e informe-o aqui. A partir do aceite, o pacote mensal de XMLs e relatórios é entregue
            direto na caixa de entrada do escritório — o envio por e-mail configurado acima continua opcional.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>O escritório passa a consultar a situação fiscal desta empresa (documentos por mês, obrigações e certificados) somente para leitura; ele não altera nada aqui.</li>
            <li>Cadastros, vendas, financeiro e estoque não são compartilhados.</li>
            <li>O código só funciona para a empresa com o mesmo CNPJ do cadastro no escritório, e qualquer uma das partes pode desfazer o vínculo depois.</li>
          </ul>
          {canEdit ? <AcceptLinkForm /> : <p className="text-xs text-slate-500">Aceitar o código exige a permissão “Configurar integrações”.</p>}
          {history}
        </div>
      </Card>
    );
  }

  const { client, firm } = link;
  const firmName = firm.tradeName || firm.name;
  return (
    <Card title="Escritório contábil no Intercert" description="Entrega automática do pacote mensal na caixa de entrada do escritório." actions={<StatusBadge kind="link" status={client.linkStatus} />}>
      <div className="space-y-4 text-sm">
        <DefinitionList
          cols={4}
          items={[
            {
              label: "Escritório",
              value: (
                <span className="flex items-start gap-1.5">
                  <Building2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                  <span>
                    {firmName}
                    {firm.tradeName && firm.tradeName !== firm.name && <span className="block text-xs text-slate-500">{firm.name}</span>}
                  </span>
                </span>
              ),
            },
            { label: "CNPJ do escritório", value: firm.cnpj ? <span className="tabular">{formatDoc(firm.cnpj)}</span> : "—" },
            { label: "Seu código de cliente no escritório", value: client.code ? <span className="font-mono">{client.code}</span> : "—" },
            { label: "Vinculada desde", value: client.linkedAt ? formatDateTime(client.linkedAt) : "—" },
          ]}
        />
        <div>
          <p className="text-xs font-semibold text-slate-600">O que acontece automaticamente</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
            <li>
              Cada pacote mensal de XMLs e relatórios gerado em{" "}
              <Link href="/fiscal/relatorios?tab=exportacao" className="text-brand-700 hover:underline">Fiscal → Relatórios fiscais → Exportação</Link> entra na caixa de entrada de {firmName}; o envio por e-mail configurado acima continua opcional.
            </li>
            <li>O escritório consulta a situação fiscal desta empresa (documentos por mês, obrigações e certificados) somente para leitura; ele não altera nada aqui.</li>
            <li>Cadastros, vendas, financeiro e estoque não são compartilhados.</li>
          </ul>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton
              action={revokeLinkByCompanyAction}
              label="Desfazer vínculo"
              variant="danger"
              icon={<Link2Off className="size-4" aria-hidden />}
              confirm={`Desfazer o vínculo com ${firmName}? O escritório deixa de ver a situação fiscal e de receber os pacotes mensais automaticamente. O que já foi entregue não é apagado.`}
            />
            <p className="text-xs text-slate-500">Desfazer não apaga o que já foi entregue ao escritório. Para vincular de novo, peça um novo código.</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Desfazer o vínculo exige a permissão “Configurar integrações”. O escritório também pode desfazê-lo pelo lado dele.</p>
        )}
        {history}
      </div>
    </Card>
  );
}
