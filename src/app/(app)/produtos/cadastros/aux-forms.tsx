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
export function AuxDialog({ kind, row, parents = [], cstSimples = [], cstNormal = [] }: { kind: Kind; row?: Record<string, any>; parents?: Opt[]; cstSimples?: Opt[]; cstNormal?: Opt[] }) {
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
