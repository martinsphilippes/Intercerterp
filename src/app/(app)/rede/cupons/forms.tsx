"use client";

import { useState } from "react";
import { ActionButton, ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { createCouponAction, setCouponActiveAction } from "../vendas/actions";

type Opt = { value: string; label: string };

/** Novo cupom: código (3–20, maiúsculas), % ou valor fixo em centavos, produto, nó/vendedor, validade e limites. */
export function CouponForm({ products, nodes, sellers, platform }: { products: Opt[]; nodes: Opt[]; sellers: Array<Opt & { nodeId: string }>; platform: boolean }) {
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [nodeId, setNodeId] = useState(platform ? "__all" : (nodes[0]?.value ?? ""));
  const [cents, setCents] = useState(0);
  const nodeSellers = sellers.filter((s) => s.nodeId === nodeId);
  return (
    <ActionForm action={createCouponAction} className="space-y-4" resetOnSuccess>
      {({ pending }) => (
        <>
          <FormGrid cols={3}>
            <Field label="Código" required hint="3 a 20 letras e números, sem espaços.">
              <Input name="code" required minLength={3} maxLength={20} pattern="[A-Za-z0-9]{3,20}" className="uppercase" placeholder="CARIRI10" autoComplete="off" />
            </Field>
            <Field label="Tipo de desconto" required>
              <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value === "fixed" ? "fixed" : "percent")} options={[{ value: "percent", label: "Percentual (%)" }, { value: "fixed", label: "Valor fixo (R$)" }]} />
            </Field>
            {kind === "percent" ? (
              <Field label="Percentual" required hint="Ex.: 10 ou 7,5"><Input name="percent" inputMode="decimal" required pattern="[0-9]{1,3}([.,][0-9]{1,2})?" placeholder="10" /></Field>
            ) : (
              <Field label="Valor do desconto" required><MoneyInput name="valueCents" value={cents} onChange={setCents} /></Field>
            )}
          </FormGrid>
          <FormGrid cols={3}>
            <Field label="Vale para" hint="O nó escolhido e os parceiros abaixo dele.">
              <Select name="nodeId" value={nodeId} onChange={(e) => setNodeId(e.target.value)} options={[...(platform ? [{ value: "__all", label: "Toda a rede" }] : []), ...nodes]} />
            </Field>
            <Field label="Vendedor" hint="Opcional: só este vendedor usa.">
              <Select name="sellerUserId" options={nodeSellers} placeholder="Qualquer vendedor" disabled={!nodeSellers.length} />
            </Field>
            <Field label="Produto" hint="Vazio = qualquer produto pago."><Select name="productKey" options={products} placeholder="Todos" /></Field>
          </FormGrid>
          <FormGrid cols={4}>
            <Field label="Válido de"><Input type="date" name="validFrom" /></Field>
            <Field label="Válido até" required><Input type="date" name="validTo" required /></Field>
            <Field label="Limite total de usos" hint="Vazio = sem limite."><Input type="number" name="maxUses" min={1} /></Field>
            <Field label="Limite por titular" hint="CPF/CNPJ."><Input type="number" name="maxPerHolder" min={1} /></Field>
          </FormGrid>
          <Field label="Observações"><Textarea name="notes" rows={1} maxLength={300} /></Field>
          <p className="text-xs text-slate-500">Regra: o preço com cupom nunca fica abaixo do custo do vendedor. Abaixo do mínimo só quando o cupom é de um nível acima do vendedor — quem emitiu absorve a diferença (fica no retrato da venda). O uso é reservado na venda, consumido no pagamento e liberado se a venda for cancelada.</p>
          <div className="flex justify-end"><SubmitButton pending={pending}>Criar cupom</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

export function CouponToggle({ id, active }: { id: string; active: boolean }) {
  return <ActionButton action={async (fd) => { fd.set("id", id); fd.set("active", active ? "0" : "1"); return setCouponActiveAction(fd); }} label={active ? "Desativar" : "Reativar"} size="sm" variant="ghost" askReason={active ? "Motivo para desativar o cupom" : undefined} />;
}
