"use client";

import { useState } from "react";
import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { saveGoalAction } from "./actions";

type Opt = { value: string; label: string };

/** Cadastro/edição de meta (filial ou empresa × mês × métrica). */
export function GoalForm({ goal, branches, metrics, defaultPeriod, defaultBranch }: { goal?: Record<string, any> | null; branches: Opt[]; metrics: Array<Opt & { unit: "money" | "count"; hint: string }>; defaultPeriod: string; defaultBranch: string }) {
  const [metric, setMetric] = useState<string>(goal?.metric ?? "revenue");
  const m = metrics.find((x) => x.value === metric) ?? metrics[0];
  return (
    <ActionForm action={saveGoalAction} className="space-y-4" resetOnSuccess={!goal}>
      {({ pending, error }) => (
        <>
          {goal?.id && <input type="hidden" name="id" value={goal.id} />}
          <FormGrid cols={2}>
            <Field label="Filial" required htmlFor="goal-branch">
              <Select id="goal-branch" name="branchId" defaultValue={goal ? (goal.branchId ?? "*") : defaultBranch} options={branches} required />
            </Field>
            <Field label="Mês" required htmlFor="goal-period">
              <Input id="goal-period" type="month" name="period" defaultValue={goal?.period ?? defaultPeriod} required />
            </Field>
            <Field label="Métrica" required htmlFor="goal-metric" hint={m.hint}>
              <Select id="goal-metric" name="metric" value={metric} onChange={(e) => setMetric(e.target.value)} options={metrics} />
            </Field>
            <Field label={m.unit === "money" ? "Meta (R$)" : "Meta (número de vendas)"} required htmlFor="goal-target">
              {m.unit === "money" ? (
                <MoneyInput key={`money-${metric}`} id="goal-target" name="target" defaultValue={goal && goal.metric === metric ? goal.target : 0} required ariaLabel="Valor da meta em reais" />
              ) : (
                <Input key={`count-${metric}`} id="goal-target" type="number" name="target" min={1} step={1} inputMode="numeric" defaultValue={goal && goal.metric === metric ? goal.target : ""} required />
              )}
            </Field>
          </FormGrid>
          <Field label="Observações" htmlFor="goal-notes">
            <Textarea id="goal-notes" name="notes" maxLength={500} defaultValue={goal?.notes ?? ""} rows={2} />
          </Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            {goal && (
              <Link href={`/dashboard/metas?mes=${goal.period}`} className={buttonClass("ghost")}>
                Cancelar edição
              </Link>
            )}
            <SubmitButton pending={pending}>{goal ? "Salvar alterações" : "Cadastrar meta"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
