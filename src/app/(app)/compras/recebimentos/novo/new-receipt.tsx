"use client";

import { useState } from "react";
import { FileCode2, KeyRound, ClipboardList } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { importXmlAction, fetchByKeyAction, manualReceiptAction } from "../actions";

export interface OpenOrder {
  id: string;
  number: number;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedDate: string | null;
  remainingValue: number;
}

type Mode = "xml" | "key" | "manual";

export function NewReceipt({ orders, suppliers, initialOrderId }: { orders: OpenOrder[]; suppliers: Array<{ value: string; label: string }>; initialOrderId?: string | null }) {
  const initialOrder = orders.find((o) => o.id === initialOrderId) ?? null;
  const [mode, setMode] = useState<Mode>(initialOrder ? "xml" : "xml");
  const [supplierId, setSupplierId] = useState<string>(initialOrder?.supplierId ?? "");
  const [selected, setSelected] = useState<string[]>(initialOrder ? [initialOrder.id] : []);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [typedKey, setTypedKey] = useState("");
  const supplierOrders = orders.filter((o) => o.supplierId === supplierId);
  const modes: Array<{ key: Mode; label: string; hint: string; icon: any }> = [
    { key: "xml", label: "Importar XML", hint: "Arquivo da NF-e recebido do fornecedor (recomendado)", icon: FileCode2 },
    { key: "key", label: "Ler chave de acesso", hint: "Busca o XML se houver integração capaz", icon: KeyRound },
    { key: "manual", label: "Sem XML (pelo pedido)", hint: "Itens a partir do saldo dos pedidos", icon: ClipboardList },
  ];
  const ordersPicker = (name: string) =>
    supplierOrders.length > 0 && (
      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-slate-600">Pedidos a vincular</legend>
        <div className="mt-1 space-y-1">
          {supplierOrders.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} value={o.id} checked={selected.includes(o.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} className="accent-brand-700" />
              Pedido nº {o.number} · saldo {formatMoney(o.remainingValue)} · previsão {formatDate(o.expectedDate)}
            </label>
          ))}
        </div>
      </fieldset>
    );
  return (
    <div className="space-y-5">
      <div role="tablist" className="grid gap-3 sm:grid-cols-3">
        {modes.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)} className={cn("focus-ring flex items-start gap-3 rounded-lg border bg-white p-4 text-left", mode === m.key ? "border-accent-500 ring-1 ring-accent-500" : "border-line hover:border-brand-300")}>
              <Icon className="mt-0.5 size-5 text-brand-700" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-slate-500">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <section className="rounded-lg border border-line bg-white p-5">
        {mode === "xml" && (
          <ActionForm action={importXmlAction} className="space-y-4">
            {({ pending, error }) => (
              <>
                <Field label="Arquivo XML da NF-e (modelo 55)" required hint="O XML é validado (estrutura, chave e dígito verificador). Emitente identifica o fornecedor pelo CNPJ; itens são associados pelo código do fornecedor ou código de barras.">
                  <input type="file" name="xml" accept=".xml,application/xml,text/xml" required className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-800" />
                </Field>
                <Field label="Fornecedor (opcional — para escolher pedidos manualmente)">
                  <Select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setSelected([]); }} options={suppliers} placeholder="Vincular automaticamente pelos pedidos em aberto" />
                </Field>
                {ordersPicker("orderIds")}
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex justify-end"><SubmitButton pending={pending} variant="accent">Importar e conferir</SubmitButton></div>
              </>
            )}
          </ActionForm>
        )}
        {mode === "key" && (
          <ActionForm action={fetchByKeyAction} className="space-y-4">
            {({ pending, error }) => (
              <>
                <Field label="Chave de acesso (44 dígitos)" required hint="Leia com o leitor de código de barras do DANFE ou digite.">
                  <Input name="key" value={typedKey} onChange={(e) => setTypedKey(e.target.value)} inputMode="numeric" autoFocus placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" />
                </Field>
                {error && (
                  <Notice tone="warn" title="XML não obtido pela chave">
                    {error}{" "}
                    <button type="button" className="font-medium underline" onClick={() => { setKeyMessage(typedKey); setMode("xml"); }}>Importar o arquivo XML</button> ou{" "}
                    <button type="button" className="font-medium underline" onClick={() => { setKeyMessage(typedKey); setMode("manual"); }}>receber sem XML com esta chave</button>.
                  </Notice>
                )}
                <div className="flex justify-end"><SubmitButton pending={pending}>Buscar XML</SubmitButton></div>
              </>
            )}
          </ActionForm>
        )}
        {mode === "manual" && (
          <ActionForm action={manualReceiptAction} className="space-y-4">
            {({ pending, error }) => (
              <>
                <Notice tone="info">Sem XML, os itens vêm do saldo dos pedidos selecionados e o valor faturado é informado manualmente. Prefira importar o XML para conferir quantidades e duplicatas.</Notice>
                <FormGrid cols={2}>
                  <Field label="Fornecedor" required>
                    <Select name="supplierId" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setSelected([]); }} options={suppliers} placeholder="Selecione…" />
                  </Field>
                  <Field label="Chave de acesso (opcional)">
                    <Input name="nfeKey" defaultValue={keyMessage ?? ""} inputMode="numeric" />
                  </Field>
                  <Field label="Número da NF-e">
                    <Input name="nfeNumber" inputMode="numeric" />
                  </Field>
                  <Field label="Série">
                    <Input name="nfeSeries" inputMode="numeric" />
                  </Field>
                  <Field label="Data de emissão">
                    <Input name="issueDate" type="date" max={today()} />
                  </Field>
                  <Field label="Valor total da NF-e (faturado)">
                    <MoneyInput name="invoicedTotal" />
                  </Field>
                </FormGrid>
                {supplierId && !supplierOrders.length && <p className="text-sm text-amber-700">Este fornecedor não tem pedidos aprovados/enviados com saldo nesta filial.</p>}
                {ordersPicker("orderIds")}
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex justify-end"><SubmitButton pending={pending} variant="accent">Abrir conferência</SubmitButton></div>
              </>
            )}
          </ActionForm>
        )}
      </section>
    </div>
  );
}
