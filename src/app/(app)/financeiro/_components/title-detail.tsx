import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Ban, CreditCard, Download, Mail, Paperclip, Pencil, Receipt, Undo2 } from "lucide-react";
import type { SessionInfo } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { LinkButton } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { listAll } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { dueState, lateChargeParams, RENEG_MAX_ITEMS, renegotiationBlockMessage, type TitleKind } from "@/domain/finance";
import { ORIGIN_LABEL, originHref, partyHref, titleDetail } from "../queries";
import { approvePayableAction, cancelTitleAction, reverseSettlementAction, revokeApprovalAction, sendNoticeAction, undoRenegotiationAction, updateInstallmentAction, updateTitleAction, uploadAttachmentAction } from "../actions";
import { RenegotiateDialog } from "./renegotiate-dialog";
import { FormDialog } from "./form-dialog";
import { SettleDialog } from "./settle-dialog";

const kb = (n: number | null | undefined) => (n == null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Detalhe do título (Telas 22/23) com recebimento/pagamento (visões 3/4), estorno, anexos e histórico. */
export async function TitleDetail({ s, kind, id, tab }: { s: SessionInfo; kind: TitleKind; id: string; tab: string }) {
  const d = await titleDetail(s.ctx, id);
  if (!d || d.title.kind !== kind) notFound();
  const { title: t } = d;
  const rec = kind === "receivable";
  const base = rec ? "/financeiro/receber" : "/financeiro/pagar";
  const self = `${base}/${id}`;
  const t0 = today();
  const [accounts, methodsRaw, cats, ccs, late] = await Promise.all([
    lookups.accounts(s.ctx),
    listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
    lookups.finCategories(s.ctx, rec ? "revenue" : "expense"),
    lookups.costCenters(s.ctx),
    lateChargeParams(s.ctx.store, s.ctx.companyId, s.ctx.branchId),
  ]);
  const methods = methodsRaw
    .filter((m) => !["store_credit", "crediario"].includes(m.kind) && (rec || !["debit", "credit"].includes(m.kind)))
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
    .map((m) => ({ value: m.id, label: m.name, kind: m.kind, accountId: m.accountId ?? null }));
  const canSettle = can(s.user, "finance", "edit") && canDo(s.user, "finance.settle");
  const canReverse = can(s.user, "finance", "edit") && canDo(s.user, "finance.reverse");
  const canApprove = canDo(s.user, "finance.approve_payable");
  const pendingApproval = !rec && t.approvalStatus !== "approved";
  const activeSettlements = d.settlements.filter((x) => x.kind === "settlement" && x.status === "active");
  // marcadores técnicos de renegociação (valor zero) não são baixas: ficam fora da lista
  const shownSettlements = d.settlements.filter((x) => x.kind !== "renegotiation" && x.kind !== "renegotiation_undo");
  // principal recebido = baixas ativas; o abatimento por devolução (sem dinheiro) fica à parte
  const principalPaid = d.principalSettled;
  const abated = d.abated;
  const extras = d.installments.reduce((a, i) => a + (i.interest ?? 0) + (i.fine ?? 0), 0);
  const discounts = d.installments.reduce((a, i) => a + (i.discount ?? 0), 0) - abated;
  const branchCtxMissing = !s.ctx.branchId;
  const settleBlock = t.status === "cancelled" ? "Título cancelado." : pendingApproval ? "Autorize a obrigação antes do pagamento." : branchCtxMissing ? "Selecione uma filial (consolidado é somente consulta)." : !canSettle ? "Sem permissão para baixar títulos." : null;
  const originLink = originHref(t);
  const partyLink = partyHref(t);
  const attachments: any[] = Array.isArray(t.attachments) ? t.attachments : [];
  const cardFeeTotal = [...d.cardFee.values()].reduce((a, b) => a + b, 0);
  const customer = rec && t.partyType === "customer" && t.partyId ? await s.ctx.store.get("customers", t.partyId) : null;
  const openInsts = d.installments.filter((i) => ["open", "partial"].includes(i.status));
  const isCard = t.originType === "sale_card";
  const isReneg = t.originType === "renegotiation" && t.status !== "cancelled";
  const renegNested = d.installments.some((i) => i.status === "renegotiated");
  // título original já cancelado: desfazer apenas cancela este título (nada volta ao saldo do original)
  const origCancelled = isReneg && d.origin?.status === "cancelled";
  // renegociação vigente gerada a partir deste título: o cancelamento exige desfazê-la antes (mesma regra do domínio)
  const cancelBlock = d.renegChildren.length ? renegotiationBlockMessage(t.number, d.renegChildren) : null;
  const undoBlock = branchCtxMissing
    ? "Selecione uma filial (consolidado é somente consulta)."
    : !canDo(s.user, "finance.settle")
      ? "Sem permissão para negociar títulos."
      : activeSettlements.length > 0
        ? "Este título já tem recebimento(s): estorne-os antes de desfazer a renegociação."
        : renegNested
          ? "Parcelas deste título foram renegociadas novamente: desfaça primeiro a renegociação mais recente."
          : null;
  return (
    <>
      <PageHeader
        title={`${rec ? "Título a receber" : "Conta a pagar"} nº ${t.number}`}
        crumbs={[{ label: "Financeiro" }, { label: rec ? "Contas a receber" : "Contas a pagar", href: base }, { label: `nº ${t.number}` }]}
        badges={
          <>
            <StatusBadge kind="title" status={t.status} />
            {!rec && (t.approvalStatus === "approved" ? <Badge tone="good">Autorizada</Badge> : <Badge tone="warn">A autorizar</Badge>)}
            <Badge tone="brand">{ORIGIN_LABEL[t.originType] ?? t.originType}</Badge>
          </>
        }
        description={[t.partyName, t.description, t.documentNumber && `Doc. ${t.documentNumber}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {!rec && pendingApproval && t.status !== "cancelled" && canApprove && (
              <FormDialog label="Conferir e autorizar" icon={<BadgeCheck className="size-4" />} variant="accent" title="Conferência e autorização para pagamento" action={approvePayableAction.bind(null, id)} submitLabel="Autorizar pagamento" description={`Confirme que a obrigação (${formatMoney(t.total)}, ${t.installmentsCount} parcela(s)) foi conferida com o documento ${t.documentNumber ?? "de origem"}. A autorização não registra pagamento.`}>
                <Field label="Observação da conferência (opcional)">
                  <Textarea name="reason" rows={2} maxLength={300} />
                </Field>
              </FormDialog>
            )}
            {!rec && t.approvalStatus === "approved" && canApprove && activeSettlements.length === 0 && t.status !== "cancelled" && (
              <ActionButton action={revokeApprovalAction.bind(null, id)} label="Revogar autorização" askReason="Motivo da revogação da autorização:" />
            )}
            {rec && openInsts.length > 0 && t.originType !== "sale_card" && can(s.user, "finance", "edit") && (
              <RenegotiateDialog
                titleId={id}
                titleNumber={t.number}
                installments={openInsts.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, balance: i.balance }))}
                late={late}
                today={t0}
                disabled={branchCtxMissing || !canDo(s.user, "finance.settle")}
                disabledReason={branchCtxMissing ? "Selecione uma filial (consolidado é somente consulta)." : "Sem permissão para negociar títulos."}
                maxItems={RENEG_MAX_ITEMS}
              />
            )}
            {isReneg && can(s.user, "finance", "edit") && (
              <FormDialog
                label={origCancelled ? "Cancelar renegociação" : "Desfazer renegociação"}
                icon={<Undo2 className="size-4" />}
                variant="ghost"
                title={`${origCancelled ? "Cancelar renegociação" : "Desfazer renegociação"} — título nº ${t.number}`}
                action={undoRenegotiationAction.bind(null, id)}
                submitLabel={origCancelled ? "Cancelar este título" : "Desfazer renegociação"}
                submitVariant="danger"
                disabled={Boolean(undoBlock)}
                disabledReason={undoBlock ?? undefined}
                description={
                  origCancelled
                    ? `O título original nº ${d.origin!.number} já está cancelado: apenas este título é cancelado (nada volta ao saldo do original). Nada é lançado em conta. O histórico é preservado.`
                    : "Este título é cancelado e as parcelas renegociadas voltam ao saldo do título original (aberta ou parcial, com o valor que tinham). Nada é lançado em conta. O histórico é preservado."
                }
              >
                <Field label="Motivo" required>
                  <Textarea name="reason" required rows={2} maxLength={300} />
                </Field>
              </FormDialog>
            )}
            {activeSettlements.length > 0 && (
              <LinkButton href={`${self}/recibo`}>
                <Receipt className="size-4" /> {rec ? "Recibo" : "Comprovante"}
              </LinkButton>
            )}
            {can(s.user, "finance", "edit") && t.status !== "cancelled" && (
              <FormDialog label="Editar" icon={<Pencil className="size-4" />} title={`Editar título nº ${t.number}`} action={updateTitleAction.bind(null, id)} dialogSize="lg" description="Valores e parcelas baixadas não são editáveis aqui — use estorno/cancelamento.">
                <FormGrid cols={2}>
                  <Field label="Descrição" required className="sm:col-span-2">
                    <Input name="description" defaultValue={t.description} required maxLength={300} />
                  </Field>
                  <Field label="Documento">
                    <Input name="documentNumber" defaultValue={t.documentNumber ?? ""} maxLength={60} />
                  </Field>
                  <Field label="Competência" required>
                    <Input type="date" name="competenceDate" defaultValue={t.competenceDate} required />
                  </Field>
                  <Field label="Categoria">
                    <Select name="categoryId" defaultValue={t.categoryId ?? ""} options={cats} placeholder="—" />
                  </Field>
                  <Field label="Centro de custo">
                    <Select name="costCenterId" defaultValue={t.costCenterId ?? ""} options={ccs} placeholder="—" />
                  </Field>
                  <Field label="Observações" className="sm:col-span-2">
                    <Textarea name="notes" defaultValue={t.notes ?? ""} rows={3} />
                  </Field>
                </FormGrid>
              </FormDialog>
            )}
            {can(s.user, "finance", "edit") && (
              <FormDialog label="Anexar" icon={<Paperclip className="size-4" />} title="Anexar documento ou comprovante" action={uploadAttachmentAction.bind(null, id)} submitLabel="Enviar">
                <Field label="Tipo">
                  <Select name="kind" defaultValue="document" options={[{ value: "document", label: "Documento (boleto, nota, contrato)" }, { value: "receipt_proof", label: "Comprovante de pagamento/recebimento" }]} />
                </Field>
                {activeSettlements.length > 0 && (
                  <Field label="Vincular à baixa (opcional)">
                    <Select name="settlementId" options={activeSettlements.map((x) => ({ value: x.id, label: `${formatDate(x.date)} — ${formatMoney(x.total)}` }))} placeholder="—" />
                  </Field>
                )}
                <Field label="Arquivo (até 10 MB)" required>
                  <input type="file" name="file" required className="text-sm" />
                </Field>
              </FormDialog>
            )}
            {can(s.user, "finance", "delete") && t.originType === "manual" && t.status !== "cancelled" && activeSettlements.length === 0 && (
              <FormDialog label="Cancelar título" icon={<Ban className="size-4" />} variant="ghost" title={`Cancelar título nº ${t.number}`} action={cancelTitleAction.bind(null, id)} submitLabel="Cancelar título" submitVariant="danger" disabled={Boolean(cancelBlock)} disabledReason={cancelBlock ?? undefined} description="O título e as parcelas deixam de compor saldos e previsões. O histórico é preservado.">
                <Field label="Motivo" required>
                  <Textarea name="reason" required rows={2} maxLength={300} />
                </Field>
              </FormDialog>
            )}
          </>
        }
      />
      <div className={cn("mb-5 grid grid-cols-2 gap-3", abated ? "lg:grid-cols-6" : "lg:grid-cols-5")}>
        <Stat label="Valor do título" value={formatMoney(t.total)} hint={`${t.installmentsCount} parcela(s) · emissão ${formatDate(t.issueDate)}`} />
        <Stat label={rec ? "Principal recebido" : "Principal pago"} value={formatMoney(principalPaid)} hint={`${activeSettlements.length} baixa(s) ativa(s)`} tone={principalPaid ? "good" : "default"} />
        {abated > 0 && <Stat label="Abatido por devolução" value={formatMoney(abated)} hint="Devolução de mercadoria (sem movimento em conta)" />}
        <Stat label="Saldo em aberto" value={formatMoney(t.balance)} tone={t.balance && d.installments.some((i) => dueState(i, t0) === "overdue") ? "bad" : "default"} />
        <Stat label="Juros e multa" value={formatMoney(extras)} hint={`Descontos ${formatMoney(discounts)}`} />
        {t.originType === "sale_card" ? (
          <Stat label="Taxa prevista da adquirente" value={formatMoney(cardFeeTotal)} hint={`Líquido previsto ${formatMoney(t.total - cardFeeTotal)}`} href="/financeiro/cartoes" />
        ) : (
          <Stat label="Competência" value={formatDate(t.competenceDate)} hint={t.categoryId ? d.cats.get(t.categoryId) : "Sem categoria"} />
        )}
      </div>
      {pendingApproval && t.status !== "cancelled" && (
        <div className="mb-4">
          <Notice tone="warn" title="Aguardando conferência/autorização">
            A conferência confirma o documento e libera o pagamento; o pagamento efetivo é registrado depois, por parcela.
            {!canApprove && " Solicite a um usuário com a permissão “Autorizar contas a pagar”."}
          </Notice>
        </div>
      )}
      <LinkTabs
        basePath={self}
        active={tab}
        tabs={[
          { key: "parcelas", label: "Parcelas e baixas", count: d.installments.length },
          { key: "dados", label: "Dados do título" },
          { key: "anexos", label: "Anexos", count: attachments.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "parcelas" && (
        <div className="space-y-4">
          <Card title="Parcelas" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th className="text-right">Valor</th>
                    <th className="text-right">{rec ? "Recebido" : "Pago"}</th>
                    <th className="text-right">Encargos</th>
                    <th className="text-right">Saldo</th>
                    {rec && <th>Nosso nº / seu nº</th>}
                    <th>Situação</th>
                    <th className="no-print text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {d.installments.map((i) => {
                    const st = dueState(i, t0);
                    const ab = d.abatedByInst.get(i.id) ?? 0;
                    const recv = (i.paid ?? 0) - ab;
                    const charges = (i.interest ?? 0) + (i.fine ?? 0) - ((i.discount ?? 0) - ab);
                    return (
                      <tr key={i.id}>
                        <td className="font-medium">
                          {i.number}/{t.installmentsCount}
                        </td>
                        <td className={st === "overdue" ? "font-medium text-red-700" : undefined}>{formatDate(i.dueDate)}</td>
                        <td className="tabular text-right">{formatMoney(i.amount)}</td>
                        <td className="tabular text-right">
                          {recv ? formatMoney(recv) : "—"}
                          {ab > 0 && <span className="block text-xs text-amber-800" title="Abatido pela devolução de mercadoria (sem movimento em conta)">abatido {formatMoney(ab)}</span>}
                        </td>
                        <td className="tabular text-right">{charges ? formatMoney(charges) : "—"}</td>
                        <td className="tabular text-right font-semibold">{formatMoney(i.balance)}</td>
                        {rec && (
                          <td className="text-xs text-slate-600">
                            {i.ourNumber ?? "—"} / {t.number}/{i.number}
                          </td>
                        )}
                        <td>
                          <StatusBadge kind="title" status={i.status === "partial" && st === "upcoming" ? "partial" : st} />
                          {i.status === "renegotiated" && d.renegOf.get(i.id) && (
                            <Link className="mt-0.5 block text-xs text-brand-700 hover:underline" href={`/financeiro/receber/${d.renegOf.get(i.id)!.id}`}>
                              → título nº {d.renegOf.get(i.id)!.number}
                            </Link>
                          )}
                        </td>
                        <td className="no-print">
                          <div className="flex justify-end gap-2">
                            {["open", "partial"].includes(i.status) && isCard && (
                              <LinkButton href={`/financeiro/cartoes?status=open&to=${i.dueDate}`} size="sm" title="Recebível da adquirente: liquide com a taxa em Recebíveis de cartão">
                                <CreditCard className="size-4" /> Liquidar em Cartões
                              </LinkButton>
                            )}
                            {["open", "partial"].includes(i.status) && !isCard && (
                              <>
                                <SettleDialog
                                  kind={kind}
                                  installment={{ id: i.id, number: i.number, balance: i.balance, dueDate: i.dueDate, amount: i.amount }}
                                  titleLabel={`nº ${t.number} (${t.partyName ?? t.description})`}
                                  accounts={accounts}
                                  methods={methods}
                                  late={late}
                                  today={t0}
                                  disabled={Boolean(settleBlock)}
                                  disabledReason={settleBlock ?? undefined}
                                />
                                {rec && t.originType !== "sale_card" && can(s.user, "finance", "edit") && (
                                  <FormDialog label="Cobrar" size="sm" variant="ghost" icon={<Mail className="size-4" />} title={`Enviar aviso de cobrança — parcela ${i.number}`} action={sendNoticeAction.bind(null, i.id)} submitLabel="Enviar aviso" description="O aviso é enviado pelo canal de e-mail configurado em Integrações; o resultado real (entregue ou não) fica no histórico do título.">
                                    <Field label="Destinatário" required>
                                      <Input type="email" name="to" defaultValue={customer?.email ?? ""} required />
                                    </Field>
                                    <Field label="Mensagem adicional (opcional)">
                                      <Textarea name="message" rows={2} maxLength={500} />
                                    </Field>
                                  </FormDialog>
                                )}
                                {can(s.user, "finance", "edit") && (
                                  <FormDialog label="Alterar" size="sm" variant="ghost" title={`Parcela ${i.number} — vencimento e nosso número`} action={updateInstallmentAction.bind(null, i.id)}>
                                    <FormGrid cols={2}>
                                      <Field label="Vencimento">
                                        <Input type="date" name="dueDate" defaultValue={i.dueDate} />
                                      </Field>
                                      {rec && (
                                        <Field label="Nosso número (boleto)" hint="Usado para casar retornos CNAB.">
                                          <Input name="ourNumber" defaultValue={i.ourNumber ?? ""} maxLength={40} />
                                        </Field>
                                      )}
                                      <Field label="Motivo (obrigatório se mudar o vencimento)" className="sm:col-span-2">
                                        <Input name="reason" maxLength={300} />
                                      </Field>
                                    </FormGrid>
                                  </FormDialog>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={rec ? "Recebimentos (baixas)" : "Pagamentos (baixas)"} description="Valor movimentado = principal − desconto + juros + multa; tarifa gera lançamento separado. Estorno gera lançamento inverso vinculado." bodyClass="p-0">
            {shownSettlements.length === 0 ? (
              <EmptyState title="Nenhuma baixa registrada" description={settleBlock ?? `Use “${rec ? "Receber" : "Pagar"}” na parcela para registrar baixa total ou parcial.`} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Parc.</th>
                      <th className="text-right">Principal</th>
                      <th className="text-right">Desconto · juros · multa · tarifa</th>
                      <th className="text-right">Movimentado</th>
                      <th>Meio · conta</th>
                      <th>Lançamento / extrato</th>
                      <th>Comprovante</th>
                      <th>Situação</th>
                      <th className="no-print" />
                    </tr>
                  </thead>
                  <tbody>
                    {shownSettlements.map((x) => {
                      const inst = d.installments.find((i) => i.id === x.installmentId);
                      const instLocked = inst && (inst.status === "renegotiated" || inst.status === "cancelled");
                      const reneg = inst ? d.renegOf.get(inst.id) : undefined;
                      const entry = x.accountEntryId ? d.entries.get(x.accountEntryId) : null;
                      const btx = d.bankTxBySettlement.get(x.id);
                      const file = x.attachmentFileId ? d.files.get(x.attachmentFileId) : null;
                      const isRev = x.kind === "reversal";
                      const isAbate = x.kind === "abatement";
                      return (
                        <tr key={x.id} className={isRev ? "bg-slate-50 text-slate-500" : undefined}>
                          <td>{formatDate(x.date)}</td>
                          <td>{inst?.number ?? "—"}</td>
                          <td className="tabular whitespace-nowrap text-right">{formatMoney(x.principal)}</td>
                          <td className="tabular whitespace-nowrap text-right text-xs">
                            {isAbate ? "abatido do saldo" : [x.discount && `${x.discount > 0 ? "−" : "+"} ${formatMoney(Math.abs(x.discount))} desc.`, x.interest && `${x.interest > 0 ? "+" : "−"} ${formatMoney(Math.abs(x.interest))} juros`, x.fine && `${x.fine > 0 ? "+" : "−"} ${formatMoney(Math.abs(x.fine))} multa`, x.fee && `tarifa ${x.fee < 0 ? "estornada " : ""}${formatMoney(Math.abs(x.fee))}`].filter(Boolean).map((t) => (
                              <span key={String(t)} className="block">{t}</span>
                            ))}
                            {!isAbate && !x.discount && !x.interest && !x.fine && !x.fee && "—"}
                          </td>
                          <td className="tabular whitespace-nowrap text-right font-medium">{formatMoney(x.total)}</td>
                          <td className="min-w-[140px] text-xs">
                            {isAbate ? "Devolução de mercadoria" : (x.methodId && d.methods.get(x.methodId)) || x.methodKind || "—"}
                            <br />
                            <span className="text-slate-500">{x.accountId ? d.accounts.get(x.accountId) : "—"}</span>
                          </td>
                          <td className="text-xs">
                            {entry ? (
                              <Link className="text-brand-700 hover:underline" href={`/financeiro/contas/${entry.accountId}?from=${entry.date}&to=${entry.date}`}>
                                Lançamento nº {entry.seq}
                              </Link>
                            ) : isRev ? (
                              "Estorno"
                            ) : isAbate ? (
                              "Sem lançamento em conta"
                            ) : (
                              "—"
                            )}
                            {entry && (
                              <div className="mt-0.5">
                                {entry.reconciled ? (
                                  <Link href={`/financeiro/conciliacao?account=${entry.accountId}&tab=historico`}>
                                    <Badge tone="good">Conciliado{btx ? ` · linha ${btx.lineNo ?? ""}` : ""}</Badge>
                                  </Link>
                                ) : (
                                  <Badge>Não conciliado</Badge>
                                )}
                              </div>
                            )}
                            {x.reference && <div className="text-slate-500">Ref. {x.reference}</div>}
                          </td>
                          <td className="text-xs">
                            {file ? (
                              <a className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={`/api/files/${file.id}`}>
                                <Download className="size-3.5" /> {file.name}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-xs">
                            {isRev ? (
                              <Badge>Estorno</Badge>
                            ) : isAbate ? (
                              <span title="Saldo abatido pela devolução de mercadoria (sem movimentação em conta).">
                                <Badge tone="info">Abatimento por devolução</Badge>
                              </span>
                            ) : x.status === "reversed" ? (
                              <span title={x.reversalReason ?? ""}>
                                <Badge tone="bad">Estornada</Badge>
                                <div className="mt-0.5 text-slate-500">{x.reversalReason}</div>
                              </span>
                            ) : (
                              <Badge tone="good">Ativa</Badge>
                            )}
                            {x.notes && !isRev && <div className="mt-0.5 max-w-[220px] truncate text-slate-500" title={x.notes}>{x.notes}</div>}
                          </td>
                          <td className="no-print text-right">
                            {!isRev && !isAbate && x.status === "active" && canReverse && (
                              instLocked ? (
                                inst?.status === "renegotiated" && reneg ? (
                                  <Link href={`/financeiro/receber/${reneg.id}`} className="text-xs text-amber-700 underline" title={`Parcela renegociada no título nº ${reneg.number}: desfaça a renegociação antes de estornar esta baixa (estorno direto reabriria a dívida em duplicidade).`}>
                                    Desfazer renegociação p/ estornar
                                  </Link>
                                ) : (
                                  <span className="text-xs text-slate-500" title={inst?.status === "renegotiated" ? "Parcela renegociada: desfaça a renegociação antes de estornar esta baixa." : "Parcela cancelada: a baixa não pode ser estornada."}>
                                    {inst?.status === "renegotiated" ? "Parcela renegociada" : "Parcela cancelada"}
                                  </span>
                                )
                              ) : entry?.reconciled ? (
                                <Link href={`/financeiro/conciliacao?account=${entry.accountId}&tab=historico`} className="text-xs text-amber-700 underline" title="A baixa está conciliada com o extrato. Desfaça a conciliação antes de estornar.">
                                  Desfazer conciliação p/ estornar
                                </Link>
                              ) : (
                                <ActionButton action={reverseSettlementAction.bind(null, x.id)} label="Estornar" size="sm" variant="ghost" icon={<Undo2 className="size-4" />} askReason="Motivo do estorno (obrigatório):" disabled={branchCtxMissing} title={branchCtxMissing ? "Selecione uma filial" : undefined} />
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
      {tab === "dados" && (
        <Card title="Dados do título">
          <DefinitionList
            cols={3}
            items={[
              { label: rec ? "Cliente / pagador" : "Fornecedor / favorecido", value: partyLink ? <Link className="text-brand-700 hover:underline" href={partyLink}>{t.partyName}</Link> : t.partyName },
              { label: "Descrição", value: t.description },
              { label: "Documento", value: t.documentNumber },
              { label: "Emissão", value: formatDate(t.issueDate) },
              { label: "Competência", value: formatDate(t.competenceDate) },
              { label: "Categoria", value: t.categoryId ? d.cats.get(t.categoryId) : "—" },
              { label: "Centro de custo", value: t.costCenterId ? d.ccs.get(t.costCenterId) : "—" },
              { label: "Filial", value: t.branchId ? d.branches.get(t.branchId) : "—" },
              { label: "Origem", value: originLink ? <Link className="text-brand-700 hover:underline" href={originLink}>{ORIGIN_LABEL[t.originType] ?? t.originType}</Link> : (ORIGIN_LABEL[t.originType] ?? t.originType) },
              !rec && { label: "Autorização", value: t.approvalStatus === "approved" ? `Autorizada por ${d.users.get(t.approvedBy) ?? "—"} em ${formatDateTime(t.approvedAt)}` : "Pendente" },
              { label: "Lançado por", value: `${d.users.get(t.createdBy) ?? "Sistema"} em ${formatDateTime(t.createdAt)}` },
              { label: "Observações", value: t.notes ? <span className="whitespace-pre-line">{t.notes}</span> : "—" },
            ]}
          />
        </Card>
      )}
      {tab === "anexos" && (
        <Card title="Anexos e comprovantes" bodyClass="p-0">
          {attachments.length === 0 ? (
            <EmptyState title="Sem anexos" description="Anexe boletos, notas, contratos ou comprovantes (botão Anexar ou no próprio recebimento/pagamento)." />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Tipo</th>
                  <th>Baixa vinculada</th>
                  <th>Enviado por</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {attachments.map((a) => {
                  const st = a.settlementId ? d.settlements.find((x) => x.id === a.settlementId) : null;
                  return (
                    <tr key={a.fileId}>
                      <td className="font-medium">{a.name}</td>
                      <td>{a.kind === "receipt_proof" ? "Comprovante" : "Documento"} <span className="text-xs text-slate-500">{kb(a.sizeBytes)}</span></td>
                      <td>{st ? `${formatDate(st.date)} — ${formatMoney(st.total)}` : "—"}</td>
                      <td className="text-xs">{a.uploadedByName ?? d.users.get(a.uploadedBy) ?? "—"} · {formatDateTime(a.uploadedAt)}</td>
                      <td className="text-right">
                        <a className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={`/api/files/${a.fileId}`}>
                          <Download className="size-4" /> Baixar
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`title:${id}`, ...d.installments.map((i) => `installment:${i.id}`)]} />
        </Card>
      )}
    </>
  );
}
