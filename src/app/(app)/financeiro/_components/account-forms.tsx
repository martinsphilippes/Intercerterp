import { ArrowLeftRight, Plus } from "lucide-react";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { today } from "@/lib/dates";
import { createEntryAction, transferAction } from "../actions";
import { FormDialog } from "./form-dialog";

type Opt = { value: string; label: string };

/** Lançamento avulso em conta (tarifa, ajuste de entrada/saída). Receitas e despesas com título são lançadas em Receber/Pagar. */
export function NewEntryDialog({ accounts, categories, costCenters, defaultAccountId, disabled, disabledReason, label = "Novo lançamento" }: { accounts: Opt[]; categories: Opt[]; costCenters: Opt[]; defaultAccountId?: string; disabled?: boolean; disabledReason?: string; label?: string }) {
  return (
    <FormDialog
      label={label}
      icon={<Plus className="size-4" />}
      variant="accent"
      title="Novo lançamento avulso em conta"
      action={createEntryAction}
      disabled={disabled}
      disabledReason={disabledReason}
      submitLabel="Lançar"
      dialogSize="lg"
      description="Para tarifas, rendimentos e ajustes sem título. Recebimentos de clientes e pagamentos a fornecedores devem ser baixados nos títulos (Contas a receber / a pagar) para manter o vínculo."
    >
      <FormGrid cols={2}>
        <Field label="Conta" required>
          <Select name="accountId" defaultValue={defaultAccountId ?? accounts[0]?.value} options={accounts} required />
        </Field>
        <Field label="Data" required>
          <Input type="date" name="date" defaultValue={today()} max={today()} required />
        </Field>
        <Field label="Tipo" required>
          <Select name="kind" defaultValue="fee" options={[{ value: "fee", label: "Tarifa bancária / taxa (saída)" }, { value: "adjustment", label: "Ajuste / outro" }]} />
        </Field>
        <Field label="Direção (ajuste)" hint="Tarifa é sempre saída.">
          <Select name="direction" defaultValue="out" options={[{ value: "out", label: "Saída (−)" }, { value: "in", label: "Entrada (+)" }]} />
        </Field>
        <Field label="Valor" required>
          <MoneyInput name="amount" required />
        </Field>
        <Field label="Descrição" required>
          <Input name="description" required maxLength={300} placeholder="Ex.: Tarifa pacote de serviços — outubro" />
        </Field>
        <Field label="Categoria">
          <Select name="categoryId" options={categories} placeholder="—" />
        </Field>
        <Field label="Centro de custo">
          <Select name="costCenterId" options={costCenters} placeholder="—" />
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Transferência entre contas (não é receita nem despesa). */
export function TransferDialog({ accounts, disabled, disabledReason, defaultFrom }: { accounts: Opt[]; disabled?: boolean; disabledReason?: string; defaultFrom?: string }) {
  return (
    <FormDialog label="Transferência" icon={<ArrowLeftRight className="size-4" />} title="Transferência entre contas" action={transferAction} disabled={disabled} disabledReason={disabledReason} submitLabel="Transferir" description="Gera saída na origem e entrada no destino; não entra em receitas/despesas do fluxo.">
      <FormGrid cols={2}>
        <Field label="De (origem)" required>
          <Select name="fromAccountId" defaultValue={defaultFrom ?? ""} options={accounts} placeholder="Selecione…" required />
        </Field>
        <Field label="Para (destino)" required>
          <Select name="toAccountId" options={accounts} placeholder="Selecione…" required />
        </Field>
        <Field label="Valor" required>
          <MoneyInput name="amount" required />
        </Field>
        <Field label="Data" required>
          <Input type="date" name="date" defaultValue={today()} max={today()} required />
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          <Input name="description" maxLength={300} placeholder="Ex.: Depósito do caixa no banco" />
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
