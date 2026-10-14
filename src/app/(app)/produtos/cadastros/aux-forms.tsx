"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Checkbox, FormGrid, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import type { ActionResult } from "@/lib/server/action";
import { saveCategoryAction, saveBrandAction, saveUnitAction, savePriceTableAction, saveTaxGroupAction } from "./actions";
import { IBS_CBS_CST_OPTIONS } from "@/domain/fiscal/reform-codes";
import { formatUfRates } from "@/domain/fiscal/tax-complete-codes";

type Opt = { value: string; label: string };
type Kind = "categoria" | "marca" | "unidade" | "tabela" | "grupo";

const ACTIONS: Record<Kind, (fd: FormData) => Promise<ActionResult<any>>> = {
  categoria: saveCategoryAction,
  marca: saveBrandAction,
  unidade: saveUnitAction,
  tabela: savePriceTableAction,
  grupo: saveTaxGroupAction,
};
const TITLES: Record<Kind, string> = { categoria: "categoria", marca: "marca", unidade: "unidade", tabela: "tabela de preço", grupo: "grupo tributário" };
const NEW_LABEL: Record<Kind, string> = { categoria: "Nova categoria", marca: "Nova marca", unidade: "Nova unidade", tabela: "Nova tabela", grupo: "Novo grupo tributário" };
const pctText = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100).replace(".", ","));

/** Botão + diálogo de criação/edição para os cadastros auxiliares. */
export function AuxDialog({ kind, row, parents = [], cstSimples = [], cstNormal = [], reformOn = false, tcOn = false, natureOptions = null }: { kind: Kind; row?: Record<string, any>; parents?: Opt[]; cstSimples?: Opt[]; cstNormal?: Opt[]; reformOn?: boolean; tcOn?: boolean; natureOptions?: Opt[] | null }) {
  const [open, setOpen] = useState(false);
  const r = row ?? {};
  const [regime, setRegime] = useState<string>(r.regime ?? "simples");
  return (
    <>
      <Button type="button" size="sm" variant={row ? "ghost" : "primary"} onClick={() => setOpen(true)}>
        {row ? <Pencil className="size-4" /> : <Plus className="size-4" />} {row ? "" : NEW_LABEL[kind]}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${row ? "Editar" : "Cadastrar"} ${TITLES[kind]}`} size={kind === "grupo" ? "xl" : "md"}>
        <ActionForm action={ACTIONS[kind]} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              {row && <input type="hidden" name="id" value={row.id} />}
              {kind === "categoria" && (
                <>
                  <Field label="Nome" required><Input name="name" defaultValue={r.name ?? ""} autoFocus /></Field>
                  <Field label="Categoria pai" hint="Opcional — cria uma subcategoria."><Select name="parentId" defaultValue={r.parentId ?? ""} options={parents.filter((p) => p.value !== r.id)} placeholder="— (raiz)" /></Field>
                  <Checkbox name="active" label="Ativa" defaultChecked={(r.status ?? "active") !== "inactive"} />
                </>
              )}
              {kind === "marca" && (
                <>
                  <Field label="Nome" required><Input name="name" defaultValue={r.name ?? ""} autoFocus /></Field>
                  <Checkbox name="active" label="Ativa" defaultChecked={(r.status ?? "active") !== "inactive"} />
                </>
              )}
              {kind === "unidade" && (
                <>
                  <FormGrid cols={3}>
                    <Field label="Código" required hint="Ex.: UN, KG, CX12"><Input name="code" defaultValue={r.code ?? ""} maxLength={6} className="font-mono uppercase" /></Field>
                    <Field label="Descrição" required className="sm:col-span-1 lg:col-span-1"><Input name="name" defaultValue={r.name ?? ""} /></Field>
                    <Field label="Casas decimais" hint="0 = inteira; 3 = fracionada (ex.: kg)."><Select name="decimals" defaultValue={String(r.decimals ?? 0)} options={["0", "1", "2", "3"].map((v) => ({ value: v, label: v }))} /></Field>
                  </FormGrid>
                  <Checkbox name="active" label="Ativa" defaultChecked={(r.status ?? "active") !== "inactive"} />
                </>
              )}
              {kind === "tabela" && (
                <>
                  <FormGrid cols={2}>
                    <Field label="Nome" required><Input name="name" defaultValue={r.name ?? ""} autoFocus /></Field>
                    <Field label="Tipo"><Select name="kind" defaultValue={r.kind ?? "retail"} options={[{ value: "retail", label: "Varejo" }, { value: "wholesale", label: "Atacado / revenda" }, { value: "promo", label: "Promocional" }, { value: "other", label: "Outra" }]} /></Field>
                  </FormGrid>
                  <Field label="Observações"><Textarea name="notes" defaultValue={r.notes ?? ""} rows={2} /></Field>
                  <div className="flex flex-wrap gap-6">
                    <Checkbox name="active" label="Ativa" defaultChecked={r.active ?? true} />
                    <Checkbox name="isDefault" label="Tabela padrão da empresa" defaultChecked={r.isDefault ?? false} />
                  </div>
                  <p className="text-xs text-slate-500">A tabela padrão é usada no PDV quando o cliente/filial não define outra. Só pode haver uma.</p>
                </>
              )}
              {kind === "grupo" && (
                <>
                  <FormGrid cols={4}>
                    <Field label="Nome" required className="sm:col-span-2"><Input name="name" defaultValue={r.name ?? ""} autoFocus /></Field>
                    <Field label="Regime"><Select name="regime" value={regime} onChange={(e) => setRegime(e.target.value)} options={[{ value: "simples", label: "Simples Nacional (CSOSN)" }, { value: "normal", label: "Regime normal (CST)" }]} /></Field>
                    <Field label={regime === "simples" ? "CSOSN" : "CST ICMS"}><Select name="cstCsosn" defaultValue={r.cstCsosn ?? ""} options={regime === "simples" ? cstSimples : cstNormal} placeholder="—" /></Field>
                    <Field label="CFOP venda interna"><Input name="cfopInternal" defaultValue={r.cfopInternal ?? ""} maxLength={4} className="font-mono" placeholder="5102" /></Field>
                    <Field label="CFOP venda interestadual"><Input name="cfopInterstate" defaultValue={r.cfopInterstate ?? ""} maxLength={4} className="font-mono" placeholder="6102" /></Field>
                    <Field label="CFOP devolução (entrada)"><Input name="cfopReturn" defaultValue={r.cfopReturn ?? ""} maxLength={4} className="font-mono" placeholder="1202" /></Field>
                    <Field label="Alíquota ICMS (%)"><Input name="icmsRate" inputMode="decimal" defaultValue={pctText(r.icmsRateBps)} /></Field>
                    <Field label="Redução de base ICMS (%)"><Input name="icmsBaseReduction" inputMode="decimal" defaultValue={pctText(r.icmsBaseReductionBps)} /></Field>
                    <Field label="FCP (%)"><Input name="fcpRate" inputMode="decimal" defaultValue={pctText(r.fcpRateBps)} /></Field>
                    <Field label="CST PIS"><Input name="pisCst" defaultValue={r.pisCst ?? ""} maxLength={2} className="font-mono" /></Field>
                    <Field label="Alíquota PIS (%)"><Input name="pisRate" inputMode="decimal" defaultValue={pctText(r.pisRateBps)} /></Field>
                    <Field label="CST COFINS"><Input name="cofinsCst" defaultValue={r.cofinsCst ?? ""} maxLength={2} className="font-mono" /></Field>
                    <Field label="Alíquota COFINS (%)"><Input name="cofinsRate" inputMode="decimal" defaultValue={pctText(r.cofinsRateBps)} /></Field>
                    <Field label="CST IPI"><Input name="ipiCst" defaultValue={r.ipiCst ?? ""} maxLength={2} className="font-mono" /></Field>
                    <Field label="Alíquota IPI (%)"><Input name="ipiRate" inputMode="decimal" defaultValue={pctText(r.ipiRateBps)} /></Field>
                    <Field label="Vigência — início"><Input type="date" name="validFrom" defaultValue={r.validFrom ?? ""} /></Field>
                    <Field label="Vigência — fim"><Input type="date" name="validTo" defaultValue={r.validTo ?? ""} /></Field>
                  </FormGrid>
                  {tcOn && <CompleteGroupFields row={r} />}
                  {natureOptions && <NatureGroupField row={r} options={natureOptions} />}
                  {reformOn && <ReformGroupFields row={r} />}
                  <Field label="Observações"><Textarea name="notes" defaultValue={r.notes ?? ""} rows={2} /></Field>
                  <Checkbox name="active" label="Ativo" defaultChecked={r.active ?? true} />
                  <p className="text-xs text-slate-500">Valide os parâmetros com a contabilidade. Produtos podem sobrepor CFOP e CST/CSOSN individualmente.</p>
                </>
              )}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>Salvar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

/**
 * Bloco "Reforma tributária" do grupo tributário (FIS-19) — exibido só com `feature.reformaTributaria` ligado. O marcador
 * `reformBlock` diz ao servidor que os campos foram enviados (sem ele, os valores gravados são mantidos).
 */
export function ReformGroupFields({ row }: { row: Record<string, any> }) {
  return (
    <div className="min-w-0 space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-semibold">Reforma tributária (IBS, CBS e IS)</p>
      <input type="hidden" name="reformBlock" value="1" />
      <FormGrid cols={4}>
        <Field label="CST do IBS/CBS" className="sm:col-span-2"><Select name="ibsCbsCst" defaultValue={row.ibsCbsCst ?? ""} options={IBS_CBS_CST_OPTIONS} placeholder="— (sem reforma)" /></Field>
        <Field label="cClassTrib" hint="6 dígitos, inicia pelo CST."><Input name="cClassTrib" defaultValue={row.cClassTrib ?? ""} maxLength={6} inputMode="numeric" className="font-mono" placeholder="000001" /></Field>
        <Field label="Vigência da reforma — início" hint="Vazio = imediata."><Input type="date" name="reformValidFrom" defaultValue={row.reformValidFrom ?? ""} /></Field>
        <Field label="IBS — UF (%)" hint="Teste de 2026: 0,1%."><Input name="ibsRate" inputMode="decimal" defaultValue={pctText(row.ibsRateBps)} placeholder="0,1" /></Field>
        <Field label="CBS (%)" hint="Teste de 2026: 0,9%."><Input name="cbsRate" inputMode="decimal" defaultValue={pctText(row.cbsRateBps)} placeholder="0,9" /></Field>
        <Field label="Redução de alíquota (%)" hint="CST 011, 200 e 210."><Input name="ibsCbsRed" inputMode="decimal" defaultValue={pctText(row.ibsCbsRedBps)} /></Field>
        <Field label="IS — Imposto Seletivo (%)" hint="A partir de 2027."><Input name="isRate" inputMode="decimal" defaultValue={pctText(row.isRateBps)} /></Field>
      </FormGrid>
      <p className="whitespace-normal break-words text-xs text-slate-500">Os grupos IBS/CBS só entram na NF-e/NFC-e quando a empresa aderiu (Fiscal › Configurações › Tributação padrão) e a data de início chegou. ICMS, PIS, COFINS e o total da nota não mudam. Valide a classificação com a contabilidade e em homologação.</p>
    </div>
  );
}

/**
 * Bloco "ICMS-ST, MVA e alíquotas por UF" do grupo tributário (FIS-12/16) — exibido só com `feature.tributacaoCompleta`.
 * O marcador `tcBlock` diz ao servidor que os campos foram enviados (sem ele, os valores gravados são mantidos).
 */
export function CompleteGroupFields({ row }: { row: Record<string, any> }) {
  return (
    <div className="min-w-0 space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-semibold">Tributação completa — ICMS-ST, MVA e alíquotas por UF</p>
      <input type="hidden" name="tcBlock" value="1" />
      <FormGrid cols={4}>
        <Field label="MVA original da ST (%)" hint="CST 10/70 e CSOSN 201–203."><Input name="stMva" inputMode="decimal" defaultValue={pctText(row.stMvaBps)} placeholder="40" /></Field>
        <Field label="Alíquota interna da ST (%)" hint="Operação interna; vazio = ICMS do grupo."><Input name="stRate" inputMode="decimal" defaultValue={pctText(row.stRateBps)} placeholder="18" /></Field>
        <Field label="Redução da base da ST (%)" hint="Somente CST 70."><Input name="stBaseReduction" inputMode="decimal" defaultValue={pctText(row.stBaseReductionBps)} /></Field>
      </FormGrid>
      <Field label="Alíquotas por UF de destino" hint="Uma UF por linha: UF alíquota-interna [FCP] [MVA ajustada]. Ex.: “RJ 20 2” ou “MG 18 - 54,2”. Sobrepõe a tabela da empresa (Fiscal › Configurações › Operações).">
        <Textarea name="ufRates" defaultValue={formatUfRates(row.ufRates)} rows={3} className="font-mono" />
      </Field>
      <p className="whitespace-normal break-words text-xs text-slate-500">Na operação interestadual o ICMS próprio usa 4%, 7% ou 12% conforme as UFs e a origem; a ST usa a alíquota interna do destino e a MVA ajustada (informada ou pela fórmula). O FCP do grupo vale na operação interna. Valide com a contabilidade e emita primeiro em homologação.</p>
    </div>
  );
}

/** Natureza de operação a que o grupo se destina (FIS-11/07) — exibido só com `feature.naturezasOperacao`. */
export function NatureGroupField({ row, options }: { row: Record<string, any>; options: Opt[] }) {
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-line p-3">
      <input type="hidden" name="natureBlock" value="1" />
      <FormGrid cols={2}>
        <Field label="Natureza de operação do grupo" hint="Com a natureza escolhida na NF-e, este grupo vale para todos os itens (CFOP e CST do grupo).">
          <Select name="operationKey" defaultValue={row.operationKey ?? ""} options={options} placeholder="— (grupo de produto, sem natureza)" />
        </Field>
      </FormGrid>
    </div>
  );
}
