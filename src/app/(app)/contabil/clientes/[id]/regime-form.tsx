"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { addDays, formatDate, today } from "@/lib/dates";
import { changeRegimeAction } from "../../actions";

type Opt = { value: string; label: string };
type Regime = Opt & { crt: string };

/**
 * Nova vigência de regime (aba Regime). Envia `changeRegimeAction` com id, regime, crt, validFrom e reason.
 * O servidor fecha a vigência anterior na véspera e só atualiza o regime "atual" do cadastro quando a data já chegou.
 */
export function RegimeForm({ clientId, regimes, crts, current, currentFrom }: { clientId: string; regimes: Regime[]; crts: Opt[]; current: string | null; currentFrom: string | null }) {
  const [regime, setRegime] = useState<string>("");
  const [crt, setCrt] = useState<string>("");
  const [validFrom, setValidFrom] = useState<string>(today());
  const future = validFrom > today();
  return (
    <ActionForm action={changeRegimeAction} resetOnSuccess className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={clientId} />
          <FormGrid cols={1}>
            <Field label="Novo regime" required>
              <Select
                name="regime"
                value={regime}
                required
                onChange={(e) => {
                  setRegime(e.target.value);
                  setCrt(regimes.find((r) => r.value === e.target.value)?.crt ?? "");
                }}
                placeholder="Selecione"
                options={regimes.map((r) => ({ ...r, disabled: r.value === current }))}
              />
            </Field>
            <Field label="CRT" hint="Preenchido conforme o regime; ajuste se necessário.">
              <Select name="crt" value={crt} onChange={(e) => setCrt(e.target.value)} placeholder="—" options={crts} disabled={!regime} />
            </Field>
            <Field label="Início da vigência" required hint={currentFrom ? `Precisa ser depois de ${formatDate(currentFrom)} (início da última vigência registrada).` : undefined}>
              <Input type="date" name="validFrom" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label="Motivo" hint="Ex.: opção pelo Simples, exclusão por faturamento, decisão da diretoria.">
              <Textarea name="reason" rows={1} />
            </Field>
          </FormGrid>
          <Notice tone={future ? "warn" : "info"}>
            A vigência anterior é encerrada na véspera ({/^\d{4}-\d{2}-\d{2}$/.test(validFrom) ? formatDate(addDays(validFrom, -1)) : "—"}) e o histórico nunca é sobrescrito.
            {future ? " Como a data está no futuro, o regime do cadastro continua o atual até lá: a mudança só passa a valer na data informada." : " Como a data já chegou, o regime do cadastro é atualizado agora."}
          </Notice>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Registrar vigência</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
