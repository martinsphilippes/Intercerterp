import { Lock, LockOpen } from "lucide-react";
import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/empty";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { addDays, formatDate, formatDateTime, monthStart, today } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { closeHistory, periodCloseState } from "@/domain/period-close";
import { closePeriodAction, reopenPeriodAction } from "./actions";

export const metadata = { title: "Fechamento de período financeiro" };

/** FIN-21 — fechamento de período financeiro por empresa (data de fechamento, reabertura auditada e histórico). */
export default async function Page() {
  const s = await requireSession("finance");
  await requireFeaturePage(s, "fechamentoPeriodo");
  const [state, history] = await Promise.all([periodCloseState(s.ctx.store, s.ctx.companyId), closeHistory(s.ctx.store, s.ctx.companyId)]);
  const t0 = today();
  const yesterday = addDays(t0, -1);
  const lastMonthEnd = addDays(monthStart(t0), -1);
  const canClose = can(s.user, "finance", "edit") && canDo(s.user, "finance.close_period");
  const until = state.closedUntil;
  return (
    <>
      <PageHeader
        title="Fechamento de período financeiro"
        crumbs={[{ label: "Financeiro" }, { label: "Fechamento de período" }]}
        description="Protege o que já foi conferido ou enviado ao contador: com o período fechado, nenhum lançamento, baixa, estorno ou título com data até o fechamento é gravado — em nenhuma tela e em nenhuma rotina."
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Período fechado até" value={until ? formatDate(until) : "Nada fechado"} tone={until ? "good" : "default"} hint={until ? "Datas até este dia (inclusive) estão bloqueadas" : "Todas as datas aceitam lançamentos"} />
        <Stat label="Primeiro dia aberto" value={until ? formatDate(addDays(until, 1)) : "—"} />
        <Stat label="Fechamentos e reaberturas" value={history.length} hint={history[0] ? `Último: ${history[0].action === "close" ? "fechamento" : "reabertura"} em ${formatDateTime(history[0].at)}` : "Sem registros"} />
      </div>
      {!canClose && (
        <div className="mb-4">
          <Notice tone="info" title="Somente consulta">
            Fechar e reabrir o período exige a permissão “Fechar e reabrir período financeiro” (Administração › Usuários e permissões).
          </Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Fechar período" description="Escolha o último dia conferido. Só dias já encerrados (até ontem): o dia de hoje continua aberto para o caixa e as baixas.">
          <ActionForm action={closePeriodAction} className="space-y-4" confirm="Fechar o período? Lançamentos, baixas, estornos e títulos com data até o fechamento passarão a ser recusados.">
            <fieldset disabled={!canClose} className="space-y-4">
              <FormGrid cols={2}>
                <Field label="Fechar até (inclusive)" required>
                  <Input type="date" name="date" max={yesterday} defaultValue={until && until > lastMonthEnd ? until : lastMonthEnd} required />
                </Field>
                <Field label="Observação" hint="Ex.: conferido com o extrato e enviado ao contador">
                  <Input name="reason" maxLength={300} />
                </Field>
              </FormGrid>
              <div className="flex justify-end">
                <button type="submit" className={buttonClass("primary")}>
                  <Lock className="size-4" aria-hidden /> Fechar período
                </button>
              </div>
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Reabrir período" description="Recua a data de fechamento (ou remove, deixando a data em branco). O motivo é obrigatório e fica no histórico e na auditoria.">
          {until ? (
            <ActionForm action={reopenPeriodAction} className="space-y-4" confirm="Reabrir o período? Lançamentos retroativos voltarão a ser aceitos nas datas reabertas.">
              <fieldset disabled={!canClose} className="space-y-4">
                <FormGrid cols={2}>
                  <Field label="Novo fechamento (vazio = reabrir tudo)">
                    <Input type="date" name="date" max={addDays(until, -1)} />
                  </Field>
                  <Field label="Motivo da reabertura" required>
                    <Input name="reason" maxLength={300} required />
                  </Field>
                </FormGrid>
                <div className="flex justify-end">
                  <button type="submit" className={buttonClass("secondary")}>
                    <LockOpen className="size-4" aria-hidden /> Reabrir
                  </button>
                </div>
              </fieldset>
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-500">Nenhum período fechado.</p>
          )}
        </Card>
      </div>
      <Card title="O que fica bloqueado" className="mt-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Lançamentos em conta (avulsos, tarifas, transferências, sangrias/suprimentos com destino em conta, diferenças de conciliação) com data até o fechamento.</li>
          <li>Baixas de títulos (inclusive em lote, no PDV, por retorno bancário e pelo arquivo da adquirente) com data até o fechamento.</li>
          <li>Estorno de baixa ou de lançamento cuja data original esteja no período fechado.</li>
          <li>Títulos novos com competência no período fechado (inclusive a conta a pagar de um recebimento de mercadoria com nota emitida no período) e mudança de competência, categoria ou centro de custo de títulos do período.</li>
          <li>Alteração do saldo inicial de conta cuja data de referência esteja no período fechado.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Vendas, recebimentos e pagamentos de hoje não são afetados. Relatórios continuam disponíveis: <Link className="text-brand-700 underline" href="/relatorios/financeiros">DRE e aging</Link>.
        </p>
      </Card>
      <Card title="Histórico" className="mt-4" bodyClass="p-0">
        {history.length === 0 ? (
          <EmptyState title="Nenhum fechamento registrado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Ação</th>
                  <th>Antes</th>
                  <th>Depois</th>
                  <th>Usuário</th>
                  <th>Motivo / observação</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{formatDateTime(h.at)}</td>
                    <td>{h.action === "close" ? <Badge tone="good">Fechamento</Badge> : <Badge tone="warn">Reabertura</Badge>}</td>
                    <td>{h.from ? formatDate(h.from) : "—"}</td>
                    <td>{h.to ? formatDate(h.to) : "Nada fechado"}</td>
                    <td>{h.userName}</td>
                    <td className="text-xs">{h.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
