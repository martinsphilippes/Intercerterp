"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { buttonClass } from "@/components/ui/button";
import type { ActionResult } from "@/lib/server/action";

export interface CouponValue {
  code: string;
  description: string;
  percent: string;
  capAmount: number;
  minOrder: number;
  freeShipping: boolean;
  active: boolean;
  validFrom: string;
  validTo: string;
  usageLimit: string;
  perCustomerLimit: string;
}

const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Tela 55 — cupom da loja com a prévia da oferta calculada enquanto se digita (desconto só nos produtos). */
export function CouponForm({ initial, action, disabled }: { initial: CouponValue; action: (fd: FormData) => Promise<ActionResult<any>>; disabled?: boolean }) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<CouponValue>) => setV((x) => ({ ...x, ...p }));
  const pct = Number(v.percent.replace(",", ".")) || 0;
  const code = v.code.trim().toUpperCase() || "CUPOM";
  const parts = [v.minOrder ? `em compras a partir de ${money(v.minOrder)}` : null, v.capAmount ? `Desconto máximo de ${money(v.capAmount)} por pedido` : null].filter(Boolean);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <ActionForm action={action} className="space-y-3 lg:col-span-3">
        <fieldset disabled={disabled} className="space-y-3">
          <Field label="Código" required hint="De 3 a 20 letras e números, sem espaços." htmlFor="code">
            <Input id="code" name="code" value={v.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) })} required />
          </Field>
          <FormGrid cols={2}>
            <Field label="Desconto (%)" htmlFor="percent"><Input id="percent" name="percent" inputMode="decimal" value={v.percent} onChange={(e) => set({ percent: e.target.value })} /></Field>
            <Field label="Limite por pedido (R$)" hint="0 = sem teto."><MoneyInput name="capAmount" value={v.capAmount} onChange={(c) => set({ capAmount: c })} ariaLabel="Limite por pedido" /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Compra mínima (R$)" hint="Valor dos produtos, sem frete."><MoneyInput name="minOrder" value={v.minOrder} onChange={(c) => set({ minOrder: c })} ariaLabel="Compra mínima" /></Field>
            <Field label="Descrição interna" htmlFor="description"><Input id="description" name="description" value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Válido de" htmlFor="validFrom"><Input id="validFrom" name="validFrom" type="date" value={v.validFrom} onChange={(e) => set({ validFrom: e.target.value })} /></Field>
            <Field label="Válido até" htmlFor="validTo"><Input id="validTo" name="validTo" type="date" value={v.validTo} onChange={(e) => set({ validTo: e.target.value })} /></Field>
          </FormGrid>
          <FormGrid cols={2}>
            <Field label="Limite de usos (total)" hint="Vazio = sem limite." htmlFor="usageLimit"><Input id="usageLimit" name="usageLimit" type="number" min={0} value={v.usageLimit} onChange={(e) => set({ usageLimit: e.target.value })} /></Field>
            <Field label="Usos por cliente" hint="Vazio = sem limite." htmlFor="perCustomerLimit"><Input id="perCustomerLimit" name="perCustomerLimit" type="number" min={0} value={v.perCustomerLimit} onChange={(e) => set({ perCustomerLimit: e.target.value })} /></Field>
          </FormGrid>
          <div className="flex flex-wrap gap-4">
            <Checkbox name="freeShipping" checked={v.freeShipping} onChange={(e) => set({ freeShipping: e.target.checked })} label="Frete grátis com o cupom" />
            <Checkbox name="active" checked={v.active} onChange={(e) => set({ active: e.target.checked })} label="Ativo na loja" />
          </div>
          {!disabled && <button type="submit" className={buttonClass("accent")}>Salvar cupom</button>}
        </fieldset>
      </ActionForm>
      <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2" aria-live="polite">
        <p className="text-sm font-semibold text-ink">Prévia da oferta</p>
        <p className="mt-2 text-3xl font-bold text-ink">{pct ? `${pct.toLocaleString("pt-BR")}% OFF` : v.freeShipping ? "Frete grátis" : "—"}</p>
        <p className="mt-2 text-sm text-slate-600">
          Com o cupom <strong>{code}</strong>
          {pct && v.freeShipping ? ", com frete grátis" : ""}
          {parts.length ? `, ${parts.join(". ")}.` : "."}
        </p>
        <p className="mt-3 text-xs text-slate-500">O desconto incide sobre os produtos, sem incluir o frete, e respeita o limite por pedido.</p>
      </div>
    </div>
  );
}
