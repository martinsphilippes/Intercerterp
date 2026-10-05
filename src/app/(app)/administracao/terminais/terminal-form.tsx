"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { saveTerminalAction } from "./actions";

type Opt = { value: string; label: string };

export function TerminalForm({
  terminal,
  branches,
  warehouses,
  printerModes,
  scannerModes,
  tefProviders,
  paperWidths,
  defaultBranchId,
}: {
  terminal?: Record<string, any> | null;
  branches: Opt[];
  warehouses: Array<Opt & { branchId: string }>;
  printerModes: Opt[];
  scannerModes: Opt[];
  tefProviders: Opt[];
  paperWidths: Opt[];
  defaultBranchId?: string | null;
}) {
  const t = terminal ?? {};
  const [branchId, setBranchId] = useState<string>(t.branchId ?? defaultBranchId ?? branches[0]?.value ?? "");
  const [printer, setPrinter] = useState<string>(t.printerMode ?? "browser");
  const [scanner, setScanner] = useState<string>(t.scannerMode ?? "keyboard_wedge");
  const [tef, setTef] = useState<string>(t.tefProvider ?? "manual_pos");
  const needsConnector = printer === "connector" || scanner === "hid" || tef === "tef_connector";
  return (
    <ActionForm action={saveTerminalAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {t.id && <input type="hidden" name="id" value={t.id} />}
          <FormSection title="Identificação">
            <FormGrid cols={4}>
              <Field label="Código" required hint="Ex.: CX01 — único na empresa."><Input name="code" required defaultValue={t.code ?? ""} maxLength={20} /></Field>
              <Field label="Nome" required className="sm:col-span-2"><Input name="name" required defaultValue={t.name ?? ""} /></Field>
              <Field label="Filial" required>
                <Select name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches} />
              </Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Parâmetros de caixa e fiscal">
            <FormGrid cols={4}>
              <Field label="Série da NFC-e" hint="Cada terminal ativo da filial usa sua própria série."><Input name="nfceSeries" type="number" min={1} max={999} defaultValue={t.nfceSeries ?? ""} /></Field>
              <Field label="Depósito de saída das vendas" className="sm:col-span-2">
                <Select name="defaultWarehouseId" defaultValue={t.defaultWarehouseId ?? ""} options={warehouses.filter((w) => w.branchId === branchId)} placeholder="Depósito padrão da filial" />
              </Field>
              <div className="flex items-end pb-2">
                <Checkbox name="allowNegativeStock" label="Permitir venda sem saldo" defaultChecked={Boolean(t.allowNegativeStock)} />
              </div>
            </FormGrid>
          </FormSection>
          <FormSection title="Periféricos" description="Impressão pelo navegador não exige instalação; o conector local é um serviço HTTP no computador do caixa (contrato em docs/integracoes.md).">
            <FormGrid cols={4}>
              <Field label="Impressora de cupom" className="sm:col-span-2">
                <Select name="printerMode" value={printer} onChange={(e) => setPrinter(e.target.value)} options={printerModes} />
              </Field>
              <Field label="Largura do papel"><Select name="paperWidth" defaultValue={String(t.paperWidth ?? 80)} options={paperWidths} /></Field>
              <Field label="Nome/modelo da impressora" hint="Ex.: Elgin i9, Epson TM-T20"><Input name="printerName" defaultValue={t.printerName ?? ""} /></Field>
              <Field label="Leitor de código de barras" className="sm:col-span-2">
                <Select name="scannerMode" value={scanner} onChange={(e) => setScanner(e.target.value)} options={scannerModes} />
              </Field>
              <Field label="Pagamento com cartão (TEF)" className="sm:col-span-2">
                <Select name="tefProvider" value={tef} onChange={(e) => setTef(e.target.value)} options={tefProviders} />
              </Field>
              {tef !== "none" && (
                <>
                  <Field label="Adquirente / credenciadora"><Input name="tefAcquirer" defaultValue={t.tefConfig?.acquirer ?? ""} placeholder="Ex.: Stone, Cielo, Rede" /></Field>
                  <Field label="Código do estabelecimento"><Input name="tefMerchantId" defaultValue={t.tefConfig?.merchantId ?? ""} /></Field>
                </>
              )}
              <Field label={`URL do conector local${needsConnector ? " *" : ""}`} hint="Ex.: http://127.0.0.1:9100 (no computador do caixa)." className="sm:col-span-2">
                <Input name="connectorUrl" defaultValue={t.connectorUrl ?? ""} placeholder="http://127.0.0.1:9100" required={needsConnector} />
              </Field>
            </FormGrid>
          </FormSection>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <SubmitButton pending={pending}>{t.id ? "Salvar terminal" : "Cadastrar terminal"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
