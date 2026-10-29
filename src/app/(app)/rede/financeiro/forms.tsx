"use client";

import { useState } from "react";
import { Save, Wallet, CheckCircle2, XCircle, Scale, LockKeyhole, Undo2, RefreshCcw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { BILLING_MODES, BILLING_PERIODS, WEEKDAY_LABEL, type AgreementTerms } from "@/domain/network/billing-plan";
import { adjustWalletAction, cancelRechargeAction, closeNowAction, confirmRechargeAction, requestRechargeAction, reprocessSaleAction, reverseSaleAction, saveAgreementAction, savePlatformFinanceAction } from "./actions";

const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const pct = (bps: number) => (bps ? String(bps / 100).replace(".", ",") : "");

/** Modalidade comercial do filho (pré-pago, pós-pago ou comissionado) — vigência hoje ou futura. */
export function AgreementForm({ childNodeId, current, childName }: { childNodeId: string; current: AgreementTerms; childName: string }) {
  const [mode, setMode] = useState(current.mode);
  const [period, setPeriod] = useState(current.period);
  const [rule, setRule] = useState(current.commissionRule);
  const [settlement, setSettlement] = useState(current.commissionSettlement);
  const [overdraft, setOverdraft] = useState(current.overdraftLimit);
  const [low, setLow] = useState(current.lowBalanceAlert);
  const [refKind, setRefKind] = useState(current.referralKind);
  const [refCents, setRefCents] = useState(current.referralCents);
  const periodic = mode === "postpaid" || (mode === "commission" && settlement === "period");
  return (
    <ActionForm action={saveAgreementAction} className="space-y-3">
      {({ pending }) => (
        <>
          <input type="hidden" name="childNodeId" value={childNodeId} />
          <input type="hidden" name="overdraftLimit" value={overdraft} />
          <input type="hidden" name="lowBalanceAlert" value={low} />
          <input type="hidden" name="referralCents" value={refCents} />
          <FormGrid cols={3}>
            <Field label="Modalidade" required><Select name="mode" value={mode} onChange={(e) => setMode(e.target.value as AgreementTerms["mode"])} options={BILLING_MODES.map((m) => ({ value: m.value, label: m.label }))} disabled={pending} /></Field>
            <Field label="Vigência a partir de" hint="Hoje ou futura; a anterior termina na véspera."><Input type="date" name="validFrom" min={todayLocal()} defaultValue={todayLocal()} disabled={pending} /></Field>
            <Field label="Motivo (opcional)"><Input name="reason" maxLength={300} placeholder="Ex.: negociação de outubro" disabled={pending} /></Field>
          </FormGrid>
          {mode === "prepaid" && (
            <FormGrid cols={2}>
              <Field label="Saldo negativo permitido" hint={`R$ 0,00 = bloqueia a venda de ${childName} sem saldo.`}><MoneyInput value={overdraft} onChange={setOverdraft} ariaLabel="Saldo negativo permitido" disabled={pending} /></Field>
              <Field label="Avisar quando o disponível ficar abaixo de" hint="R$ 0,00 = sem aviso."><MoneyInput value={low} onChange={setLow} ariaLabel="Aviso de saldo baixo" disabled={pending} /></Field>
            </FormGrid>
          )}
          {mode === "commission" && (
            <FormGrid cols={3}>
              <Field label="Comissão"><Select name="commissionRule" value={rule} onChange={(e) => setRule(e.target.value === "percent" ? "percent" : "margin")} options={[{ value: "margin", label: "Margem pelo retrato (preço final − custo)" }, { value: "percent", label: "Percentual do preço final" }]} disabled={pending} /></Field>
              {rule === "percent" && <Field label="Percentual" hint="Ex.: 20 ou 12,5"><Input name="commissionPercent" inputMode="decimal" defaultValue={pct(current.commissionBps)} pattern="[0-9]{1,3}([.,][0-9]{1,2})?" required disabled={pending} /></Field>}
              <Field label="Liquidação"><Select name="commissionSettlement" value={settlement} onChange={(e) => setSettlement(e.target.value === "split" ? "split" : "period")} options={[{ value: "period", label: "No fim do período (fechamento)" }, { value: "split", label: "Split no pagamento (provedor)" }]} disabled={pending} /></Field>
            </FormGrid>
          )}
          {periodic && (
            <FormGrid cols={3}>
              <Field label="Fechamento"><Select name="period" value={period} onChange={(e) => setPeriod(e.target.value as AgreementTerms["period"])} options={BILLING_PERIODS.map((p) => ({ value: p.value, label: p.label }))} disabled={pending} /></Field>
              {period === "weekly" && <Field label="Dia da semana"><Select name="weekday" defaultValue={String(current.weekday)} options={WEEKDAY_LABEL.map((l, i) => ({ value: String(i), label: l }))} disabled={pending} /></Field>}
              {period === "monthly" && <Field label="Dia do mês" hint="1 a 28; cobre até a véspera."><Input type="number" name="monthDay" min={1} max={28} defaultValue={current.monthDay} disabled={pending} /></Field>}
              <Field label="Vencimento (dias após o fechamento)"><Input type="number" name="dueDays" min={0} max={60} defaultValue={current.dueDays} disabled={pending} /></Field>
            </FormGrid>
          )}
          <details className="rounded-md border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">Comissão de indicação (contador que indicou o cliente)</summary>
            <p className="mt-1 text-xs text-slate-500">Paga por {childName} ao escritório contador indicado na venda, limitada ao resultado dele na venda.</p>
            <FormGrid cols={3}>
              <Field label="Comissão"><Select name="referralKind" value={refKind} onChange={(e) => setRefKind(e.target.value as AgreementTerms["referralKind"])} options={[{ value: "none", label: "Sem comissão de indicação" }, { value: "percent", label: "% do preço final" }, { value: "fixed", label: "Valor fixo" }]} disabled={pending} /></Field>
              {refKind === "percent" && <Field label="Percentual"><Input name="referralPercent" inputMode="decimal" defaultValue={pct(current.referralBps)} pattern="[0-9]{1,3}([.,][0-9]{1,2})?" required disabled={pending} /></Field>}
              {refKind === "fixed" && <Field label="Valor"><MoneyInput value={refCents} onChange={setRefCents} ariaLabel="Valor da indicação" disabled={pending} /></Field>}
              {refKind !== "none" && <Field label="Liquidação"><Select name="referralSettlement" defaultValue={current.referralSettlement} options={[{ value: "period", label: "No fechamento" }, { value: "split", label: "Split no pagamento" }]} disabled={pending} /></Field>}
            </FormGrid>
          </details>
          <div className="flex justify-end"><SubmitButton pending={pending}><Save className="size-4" aria-hidden /> Salvar modalidade</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

/** Recarga de créditos pré-pagos: título a receber do pai e a pagar do filho; crédito na confirmação. */
export function RechargeForm({ childNodeId }: { childNodeId: string }) {
  const [amount, setAmount] = useState(0);
  return (
    <ActionForm action={requestRechargeAction} className="space-y-3" confirm={`Lançar a recarga de ${formatMoney(amount)}?`}>
      {({ pending }) => (
        <>
          <input type="hidden" name="childNodeId" value={childNodeId} />
          <input type="hidden" name="amount" value={amount} />
          <FormGrid cols={2}>
            <Field label="Valor" required><MoneyInput value={amount} onChange={setAmount} ariaLabel="Valor da recarga" disabled={pending} /></Field>
            <Field label="Vencimento"><Input type="date" name="dueDate" min={todayLocal()} disabled={pending} /></Field>
          </FormGrid>
          <div className="flex justify-end"><SubmitButton pending={pending} disabled={amount <= 0}><Wallet className="size-4" aria-hidden /> Recarregar créditos</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function ConfirmRechargeForm({ id, code, amount }: { id: string; code: string; amount: number }) {
  return (
    <ActionForm action={confirmRechargeAction} className="flex flex-wrap items-end gap-2" confirm={`Confirmar o recebimento de ${formatMoney(amount)} (${code}) e creditar a carteira?`}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Referência do pagamento"><Input name="ref" required maxLength={120} placeholder="Pix, TED, comprovante" disabled={pending} /></Field>
          <SubmitButton pending={pending}><CheckCircle2 className="size-4" aria-hidden /> Confirmar recebimento</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function CancelRechargeForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelRechargeAction} className="flex flex-wrap items-end gap-2" confirm="Cancelar a recarga? Os títulos sem baixa são cancelados.">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Motivo"><Input name="reason" required minLength={5} maxLength={300} disabled={pending} /></Field>
          <SubmitButton pending={pending}><XCircle className="size-4" aria-hidden /> Cancelar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Ajuste manual (crédito ou débito) com motivo — fica no extrato e na auditoria. */
export function AdjustForm({ childNodeId }: { childNodeId: string }) {
  const [amount, setAmount] = useState(0);
  return (
    <ActionForm action={adjustWalletAction} className="space-y-3" resetOnSuccess>
      {({ pending }) => (
        <>
          <input type="hidden" name="childNodeId" value={childNodeId} />
          <input type="hidden" name="amount" value={amount} />
          <FormGrid cols={2}>
            <Field label="Tipo"><Select name="direction" defaultValue="credit" options={[{ value: "credit", label: "Crédito (aumenta o saldo)" }, { value: "debit", label: "Débito (reduz o saldo)" }]} disabled={pending} /></Field>
            <Field label="Valor" required><MoneyInput value={amount} onChange={setAmount} ariaLabel="Valor do ajuste" disabled={pending} /></Field>
          </FormGrid>
          <Field label="Motivo" required hint="Ao menos 10 caracteres; fica no extrato."><Textarea name="reason" rows={2} minLength={10} required disabled={pending} /></Field>
          <div className="flex justify-end"><SubmitButton pending={pending} disabled={amount <= 0}><Scale className="size-4" aria-hidden /> Registrar ajuste</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

/** "Fechar período agora": a prévia está na tela; a confirmação mostra o total. */
export function CloseNowForm({ childNodeId, relationKey, total, count }: { childNodeId: string; relationKey: string; total: number; count: number }) {
  return (
    <ActionForm action={closeNowAction} confirm={total < 0 ? `Saldo de crédito (${formatMoney(total)}): nada será faturado; o crédito segue para o próximo fechamento. Continuar?` : `Fechar agora ${count} lançamento(s) — total ${formatMoney(total)}? Um título a pagar/receber é gerado nas duas empresas.`}>
      {({ pending }) => (
        <>
          <input type="hidden" name="childNodeId" value={childNodeId} />
          <input type="hidden" name="relationKey" value={relationKey} />
          <SubmitButton pending={pending} disabled={count === 0}><LockKeyhole className="size-4" aria-hidden /> Fechar período agora</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Estorno da venda paga (plataforma / equipe de certificação) — reverte todas as camadas. */
export function ReverseSaleForm({ id, protocol, amount }: { id: string; protocol: string; amount: number }) {
  return (
    <ActionForm action={reverseSaleAction} className="space-y-2" confirm={`Estornar a venda paga ${protocol} (${formatMoney(amount)})? A venda é cancelada e os lançamentos de todas as camadas são revertidos.`}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Motivo do estorno" required hint="Ao menos 10 caracteres."><Textarea name="reason" rows={2} minLength={10} required disabled={pending} /></Field>
          <Notice tone="warn">A devolução do dinheiro ao cliente é feita por quem cobrou (o estorno da baixa fica registrado na conta de recebimento).</Notice>
          <div className="flex justify-end"><SubmitButton pending={pending}><Undo2 className="size-4" aria-hidden /> Estornar venda paga</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function ReprocessForm({ id }: { id: string }) {
  return (
    <ActionForm action={reprocessSaleAction}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={pending}><RefreshCcw className="size-4" aria-hidden /> Reprocessar lançamentos</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Plataforma: empresa da Intercert e fechamento do custo AC. */
export function PlatformFinanceForm({ companies, current }: { companies: Array<{ value: string; label: string }>; current: { platformCompanyId: string | null; acClosingDay: number; acDueDays: number } }) {
  return (
    <ActionForm action={savePlatformFinanceAction} className="space-y-3">
      {({ pending }) => (
        <>
          <FormGrid cols={3}>
            <Field label="Empresa da Intercert no ERP" hint="Recebe o que o nível direto paga e paga o custo AC ao fornecedor."><Select name="platformCompanyId" defaultValue={current.platformCompanyId ?? ""} options={companies} placeholder="Não definida" disabled={pending} /></Field>
            <Field label="Fechamento do custo AC (dia do mês)"><Input type="number" name="acClosingDay" min={1} max={28} defaultValue={current.acClosingDay} disabled={pending} /></Field>
            <Field label="Vencimento do custo AC (dias)"><Input type="number" name="acDueDays" min={0} max={60} defaultValue={current.acDueDays} disabled={pending} /></Field>
          </FormGrid>
          <div className="flex justify-end"><SubmitButton pending={pending}><Save className="size-4" aria-hidden /> Salvar</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}
