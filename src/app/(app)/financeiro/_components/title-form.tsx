"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { createTitleAction } from "../actions";
import { addDays, addMonths, brl, schedule } from "./calc";

type Opt = { value: string; label: string };
type TermOpt = Opt & { installments: number; firstDueDays: number; intervalDays: number };

/** Lançamento manual de título a receber / conta a pagar com parcelas geradas por condição ou personalizadas. */
export function TitleForm({ kind, parties, categories, costCenters, terms, today, canApprove }: { kind: "receivable" | "payable"; parties: Opt[]; categories: Opt[]; costCenters: Opt[]; terms: TermOpt[]; today: string; canApprove: boolean }) {
  const rec = kind === "receivable";
  const [partyType, setPartyType] = useState<"customer" | "supplier" | "other">(rec ? "customer" : "supplier");
  const [issueDate, setIssueDate] = useState(today);
  const [total, setTotal] = useState(0);
  const [termId, setTermId] = useState("");
  const [count, setCount] = useState(1);
  const [first, setFirst] = useState(addDays(today, 30));
  const [interval, setIntervalDays] = useState(30);
  const [plan, setPlan] = useState<Array<{ dueDate: string; amount: number }>>([]);
  const planned = plan.reduce((a, p) => a + p.amount, 0);
  const generate = () => {
    const term = terms.find((t) => t.value === termId);
    if (!term) return setPlan(schedule(total, count, first, interval));
    // mesma regra de buildSchedule (domínio): intervalo de 30 dias com 1º vencimento múltiplo de 30 usa meses-calendário
    const parts = schedule(total, term.installments, issueDate, 30);
    setPlan(parts.map((p, i) => ({ amount: p.amount, dueDate: term.intervalDays === 30 && term.firstDueDays % 30 === 0 ? addMonths(issueDate, term.firstDueDays / 30 + i) : addDays(issueDate, term.firstDueDays + term.intervalDays * i) })));
  };
  const problems: string[] = [];
  if (plan.length && planned !== total) problems.push(`As parcelas somam ${brl(planned)} e o total é ${brl(total)}.`);
  return (
    <ActionForm action={createTitleAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="installments" value={JSON.stringify(plan)} />
          <input type="hidden" name="total" value={total} />
          <FormSection title={rec ? "Cliente e documento" : "Fornecedor e documento"} description="Títulos de vendas e compras são criados automaticamente pelas operações; aqui ficam lançamentos manuais (serviços, despesas, acordos).">
            <FormGrid cols={3}>
              <Field label={rec ? "Pagador" : "Favorecido"} required>
                <Select
                  name="partyType"
                  value={partyType}
                  onChange={(e) => setPartyType(e.target.value as any)}
                  options={rec ? [{ value: "customer", label: "Cliente cadastrado" }, { value: "other", label: "Outro (sem cadastro)" }] : [{ value: "supplier", label: "Fornecedor cadastrado" }, { value: "other", label: "Outro (concessionária, governo…)" }]}
                />
              </Field>
              {partyType === "other" ? (
                <Field label="Nome" required className="sm:col-span-2">
                  <Input name="partyName" required maxLength={200} />
                </Field>
              ) : (
                <Field label={rec ? "Cliente" : "Fornecedor"} required className="sm:col-span-2">
                  <Select name="partyId" required options={parties} placeholder="Selecione…" />
                </Field>
              )}
              <Field label="Descrição" required className="sm:col-span-2">
                <Input name="description" required maxLength={300} placeholder={rec ? "Ex.: Consultoria de imagem — pacote outubro" : "Ex.: Energia elétrica — outubro"} />
              </Field>
              <Field label="Documento" hint="NF, fatura, boleto, contrato…">
                <Input name="documentNumber" maxLength={60} />
              </Field>
              <Field label="Emissão" required>
                <Input type="date" name="issueDate" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
              </Field>
              <Field label="Competência" required hint="Mês a que a receita/despesa pertence (DRE)">
                <Input type="date" name="competenceDate" defaultValue={today} required />
              </Field>
              <Field label="Categoria">
                <Select name="categoryId" options={categories} placeholder="—" />
              </Field>
              <Field label="Centro de custo">
                <Select name="costCenterId" options={costCenters} placeholder="—" />
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Valor e parcelas" description="Gere as parcelas por uma condição cadastrada ou personalize; as datas e valores podem ser ajustados antes de salvar.">
            <FormGrid cols={4}>
              <Field label="Valor total" required>
                <MoneyInput value={total} onChange={(v) => (setTotal(v), setPlan([]))} ariaLabel="Valor total" />
              </Field>
              <Field label="Condição de parcelamento">
                <Select value={termId} onChange={(e) => (setTermId(e.target.value), setPlan([]))} options={terms} placeholder="Personalizada" />
              </Field>
              {!termId && (
                <>
                  <Field label="Nº de parcelas">
                    <Input type="number" min={1} max={60} value={count} onChange={(e) => (setCount(Number(e.target.value) || 1), setPlan([]))} />
                  </Field>
                  <Field label="1º vencimento">
                    <Input type="date" value={first} onChange={(e) => (setFirst(e.target.value), setPlan([]))} />
                  </Field>
                  <Field label="Intervalo (dias)" hint="30 = mensal (mesmo dia)">
                    <Input type="number" min={1} max={365} value={interval} onChange={(e) => (setIntervalDays(Number(e.target.value) || 30), setPlan([]))} />
                  </Field>
                </>
              )}
            </FormGrid>
            <div className="mt-4">
              <Button type="button" variant="outline" size="sm" onClick={generate} disabled={total <= 0}>
                <Wand2 className="size-4" /> Gerar parcelas
              </Button>
            </div>
            {plan.length > 0 && (
              <table className="table-base mt-4 w-full max-w-2xl text-sm">
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th className="text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((p, i) => (
                    <tr key={i}>
                      <td>
                        {i + 1}/{plan.length}
                      </td>
                      <td>
                        <Input type="date" value={p.dueDate} onChange={(e) => setPlan((x) => x.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)))} aria-label={`Vencimento parcela ${i + 1}`} />
                      </td>
                      <td className="w-48">
                        <MoneyInput value={p.amount} onChange={(v) => setPlan((x) => x.map((y, j) => (j === i ? { ...y, amount: v } : y)))} ariaLabel={`Valor parcela ${i + 1}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={2}>Total das parcelas</td>
                    <td className="tabular text-right">{brl(planned)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </FormSection>
          <FormSection title="Complementos">
            <FormGrid cols={2}>
              <Field label="Observações">
                <Textarea name="notes" rows={3} />
              </Field>
              <Field label="Anexo (boleto, nota, contrato — até 10 MB)">
                <input type="file" name="file" className="text-sm" />
              </Field>
            </FormGrid>
            {!rec && canApprove && (
              <div className="mt-4">
                <Checkbox name="approved" label="Documento conferido — autorizar para pagamento agora" />
                <p className="mt-1 text-xs text-slate-500">Sem esta marcação a obrigação fica “A autorizar” e não pode ser paga até a conferência.</p>
              </div>
            )}
          </FormSection>
          {problems.length > 0 && <Notice tone="warn">{problems.join(" ")}</Notice>}
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <SubmitButton pending={pending} variant="primary">
              {rec ? "Lançar título a receber" : "Lançar conta a pagar"}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
