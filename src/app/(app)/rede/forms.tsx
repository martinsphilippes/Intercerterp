"use client";

import { useState } from "react";
import { Save, MoveRight, PauseCircle, PlayCircle, XCircle, Undo2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { clearNodePriceRuleAction, createNodeAction, moveNodeAction, saveLevelLabelsAction, savePriceRuleAction, setNodeStatusAction } from "./actions";

interface Terms {
  cost: number;
  minPrice: number;
  defaultPrice: number;
  canEdit: boolean;
}

const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/**
 * Preço de um produto (exceção do filho ou tabela padrão por nível): mostra a margem da camada (custo − custo de cima)
 * e bloqueia o envio abaixo do custo de cima, do mínimo de cima ou com o mínimo/padrão fora da ordem. O servidor confere tudo de novo.
 */
export function PriceRuleForm({ target, nodeId, ownerNodeId, level, productKey, productLabel, owner, ownerName, current }: { target: "node" | "level"; nodeId?: string; ownerNodeId?: string | null; level?: string; productKey: string; productLabel: string; owner: Terms | null; ownerName: string; current: Terms | null }) {
  const [cost, setCost] = useState(current?.cost ?? owner?.cost ?? 0);
  const [minPrice, setMin] = useState(current?.minPrice ?? owner?.minPrice ?? 0);
  const [defaultPrice, setDefault] = useState(current?.defaultPrice ?? owner?.defaultPrice ?? 0);
  const [canEdit, setCanEdit] = useState(current ? current.canEdit : (owner?.canEdit ?? true));
  const problems: string[] = [];
  if (!owner) problems.push(`${ownerName} ainda não tem preço para ${productLabel}.`);
  if (owner && cost < owner.cost) problems.push(`Custo abaixo do custo de ${ownerName} (${formatMoney(owner.cost)}): margem negativa.`);
  if (minPrice < cost) problems.push("O mínimo não pode ficar abaixo do custo.");
  if (defaultPrice < minPrice) problems.push("O padrão não pode ficar abaixo do mínimo.");
  if (owner && minPrice < owner.minPrice) problems.push(`O mínimo não pode ficar abaixo do mínimo de ${ownerName} (${formatMoney(owner.minPrice)}).`);
  if (owner && canEdit && !owner.canEdit) problems.push(`Produto com preço fixo em ${ownerName}: não pode ficar editável.`);
  const margin = owner ? cost - owner.cost : null;
  return (
    <ActionForm action={savePriceRuleAction} className="space-y-3">
      {({ pending }) => (
        <>
          <input type="hidden" name="target" value={target} />
          {nodeId && <input type="hidden" name="nodeId" value={nodeId} />}
          {target === "level" && <input type="hidden" name="ownerNodeId" value={ownerNodeId ?? ""} />}
          {level && <input type="hidden" name="level" value={level} />}
          <input type="hidden" name="productKey" value={productKey} />
          <input type="hidden" name="cost" value={cost} />
          <input type="hidden" name="minPrice" value={minPrice} />
          <input type="hidden" name="defaultPrice" value={defaultPrice} />
          <FormGrid cols={3}>
            <Field label="Custo (paga ao de cima)"><MoneyInput value={cost} onChange={setCost} ariaLabel="Custo" disabled={pending} /></Field>
            <Field label="Mínimo ao cliente final"><MoneyInput value={minPrice} onChange={setMin} ariaLabel="Preço mínimo" disabled={pending} /></Field>
            <Field label="Preço padrão (sugerido)"><MoneyInput value={defaultPrice} onChange={setDefault} ariaLabel="Preço padrão" disabled={pending} /></Field>
          </FormGrid>
          <FormGrid cols={3}>
            <Field label="Vigência a partir de" hint="Hoje ou futura; a regra anterior termina na véspera."><Input type="date" name="validFrom" min={todayLocal()} defaultValue={todayLocal()} disabled={pending} /></Field>
            <Field label="Motivo (opcional)" className="sm:col-span-2"><Input name="reason" maxLength={300} placeholder="Ex.: reajuste da tabela" disabled={pending} /></Field>
          </FormGrid>
          <Checkbox name="canEdit" label="Pode alterar o preço de venda (respeitando o mínimo)" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} disabled={pending || (owner ? !owner.canEdit : false)} />
          <p className="text-sm">
            Margem da camada de cima ({ownerName}):{" "}
            <span className={`tabular font-semibold ${margin != null && margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{margin == null ? "—" : formatMoney(margin)}</span>
            {owner && <span className="text-xs text-slate-500"> · custo de cima {formatMoney(owner.cost)} · mínimo de cima {formatMoney(owner.minPrice)}</span>}
          </p>
          {problems.length > 0 && <Notice tone="bad">{problems.join(" ")}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending} disabled={problems.length > 0}>
              <Save className="size-4" aria-hidden /> Salvar preço
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function ClearRuleForm({ nodeId, productKey }: { nodeId: string; productKey: string }) {
  return (
    <ActionForm action={clearNodePriceRuleAction} confirm="Retirar a exceção e voltar à tabela padrão do parceiro acima?">
      {({ pending }) => (
        <>
          <input type="hidden" name="nodeId" value={nodeId} />
          <input type="hidden" name="productKey" value={productKey} />
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            <Undo2 className="size-3.5" aria-hidden /> Voltar à tabela padrão
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function MoveForm({ id, options }: { id: string; options: Array<{ value: string; label: string }> }) {
  return (
    <ActionForm action={moveNodeAction} className="space-y-3" confirm="Mover o parceiro? As exceções de preço definidas pelo pai anterior deixam de valer.">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Novo parceiro acima" required><Select name="parentNodeId" options={options} placeholder="Escolha…" required disabled={pending} /></Field>
          <Field label="Motivo" required hint="Fica no histórico do parceiro."><Textarea name="reason" rows={2} minLength={5} required disabled={pending} /></Field>
          <div className="flex justify-end">
            <SubmitButton pending={pending}><MoveRight className="size-4" aria-hidden /> Mover</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function StatusForm({ id, status }: { id: string; status: string }) {
  const [next, setNext] = useState(status === "active" ? "suspended" : "active");
  if (status === "closed") return <p className="text-sm text-slate-500">Parceiro encerrado: a situação é definitiva.</p>;
  const opts = status === "active" ? [{ value: "suspended", label: "Suspender" }, { value: "closed", label: "Encerrar" }] : [{ value: "active", label: "Reativar" }, { value: "closed", label: "Encerrar" }];
  return (
    <ActionForm action={setNodeStatusAction} className="space-y-3" confirm={next === "closed" ? "Encerrar o parceiro? O encerramento é definitivo." : undefined}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Field label="Ação"><Select name="status" value={next} onChange={(e) => setNext(e.target.value)} options={opts} disabled={pending} /></Field>
          <Field label={next === "active" ? "Observação (opcional)" : "Motivo"} required={next !== "active"}><Textarea name="reason" rows={2} required={next !== "active"} minLength={next !== "active" ? 5 : undefined} disabled={pending} /></Field>
          <div className="flex justify-end">
            <SubmitButton pending={pending} variant={next === "active" ? "primary" : "danger"}>
              {next === "active" ? <PlayCircle className="size-4" aria-hidden /> : next === "suspended" ? <PauseCircle className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
              {opts.find((o) => o.value === next)?.label}
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export interface ParentOption {
  value: string;
  label: string;
  /** níveis permitidos abaixo deste pai */
  levels: string[];
}

/** Novo parceiro: empresa nova (com convite do administrador) ou, para Contador, vínculo de um escritório existente. */
export function NewNodeForm({ parents, labels, defaultParent }: { parents: ParentOption[]; labels: Record<string, string>; defaultParent?: string }) {
  const [parent, setParent] = useState(defaultParent ?? parents[0]?.value ?? "");
  const allowed = parents.find((p) => p.value === parent)?.levels ?? [];
  const [lvl, setLvl] = useState(allowed[0] ?? "");
  const level = allowed.includes(lvl) ? lvl : (allowed[0] ?? "");
  const [mode, setMode] = useState<"new" | "link">("new");
  const linkMode = level === "contador" && mode === "link";
  return (
    <ActionForm action={createNodeAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="mode" value={linkMode ? "link" : "new"} />
          <FormGrid cols={2}>
            <Field label="Parceiro acima" required>
              {/* com um único pai possível o campo fica travado; o valor segue em campo oculto (select desabilitado não é enviado) */}
              <Select name={parents.length < 2 ? undefined : "parentNodeId"} value={parent} onChange={(e) => setParent(e.target.value)} options={parents.map((p) => ({ value: p.value, label: p.label }))} disabled={pending || parents.length < 2} />
              {parents.length < 2 && <input type="hidden" name="parentNodeId" value={parent} />}
            </Field>
            <Field label="Nível" required hint="Sempre abaixo do nível do parceiro acima (pode pular níveis).">
              <Select name="level" value={level} onChange={(e) => setLvl(e.target.value)} options={allowed.map((l) => ({ value: l, label: labels[l] ?? l }))} disabled={pending} />
            </Field>
          </FormGrid>
          {level === "contador" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} className="accent-brand-700" /> Cadastrar escritório novo</label>
              <label className="inline-flex items-center gap-2"><input type="radio" checked={mode === "link"} onChange={() => setMode("link")} className="accent-brand-700" /> Vincular escritório existente (CNPJ)</label>
            </div>
          )}
          {linkMode ? (
            <Field label="CNPJ do escritório contábil" required hint="O escritório já usa o Intercert; ele passa a ver a revenda acima e os preços dele."><Input name="linkCnpj" inputMode="numeric" required disabled={pending} /></Field>
          ) : (
            <>
              <FormGrid cols={2}>
                <Field label="Razão social" required><Input name="name" required disabled={pending} /></Field>
                <Field label="Nome fantasia"><Input name="tradeName" disabled={pending} /></Field>
                <Field label="CNPJ"><Input name="cnpj" inputMode="numeric" disabled={pending} /></Field>
                <Field label="E-mail da empresa"><Input type="email" name="email" disabled={pending} /></Field>
                <Field label="Telefone"><Input name="phone" inputMode="tel" disabled={pending} /></Field>
              </FormGrid>
              <FormGrid cols={2}>
                <Field label="Administrador — nome" required><Input name="adminName" required disabled={pending} /></Field>
                <Field label="Administrador — e-mail" required hint="Recebe o convite para definir a senha."><Input type="email" name="adminEmail" required disabled={pending} /></Field>
                <Field label="Administrador — login (opcional)"><Input name="adminLogin" disabled={pending} /></Field>
              </FormGrid>
            </>
          )}
          <FormGrid cols={4}>
            <Field label="Cidade"><Input name="cityName" disabled={pending} /></Field>
            <Field label="UF"><Input name="uf" maxLength={2} className="uppercase" disabled={pending} /></Field>
            <Field label="Região"><Input name="region" placeholder="Ex.: Cariri" disabled={pending} /></Field>
            <Field label="Responsável comercial"><Input name="commercialResponsible" disabled={pending} /></Field>
          </FormGrid>
          <Field label="Observações"><Textarea name="notes" rows={2} disabled={pending} /></Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending} disabled={!level}><Save className="size-4" aria-hidden /> {linkMode ? "Vincular à rede" : "Cadastrar parceiro"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function LevelLabelsForm({ labels }: { labels: Record<string, string> }) {
  return (
    <ActionForm action={saveLevelLabelsAction} className="space-y-3">
      {({ pending }) => (
        <>
          <FormGrid cols={4}>
            {(["master", "regional", "revenda", "contador"] as const).map((k) => (
              <Field key={k} label={`Nível “${k}”`} hint="Chave interna fixa"><Input name={k} defaultValue={labels[k]} required minLength={2} maxLength={40} disabled={pending} /></Field>
            ))}
          </FormGrid>
          <div className="flex justify-end">
            <SubmitButton pending={pending}><Save className="size-4" aria-hidden /> Salvar rótulos</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
