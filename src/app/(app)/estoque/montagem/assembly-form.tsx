"use client";

import { useState } from "react";
import { Combine, Split } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { allocate, formatMoney, formatQty, roundDiv, QTY } from "@/lib/money";
import { runAssemblyAction } from "../actions";

export interface CompositeOption {
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  productId: string;
  components: Array<{ skuId: string; sku: string; name: string; unitCode: string; qty: number }>;
}

type Bal = { physical: number; reserved: number; avgCost: number };

/** Formulário de montagem/desmembramento com prévia de quantidades, saldos e custos (o servidor recalcula ao gravar). */
export function AssemblyForm({ options, warehouses, balances, costFallback, initialSku }: { options: CompositeOption[]; warehouses: Array<{ value: string; label: string }>; balances: Record<string, Bal>; costFallback: Record<string, number>; initialSku: string }) {
  const [skuId, setSkuId] = useState(initialSku);
  const [wh, setWh] = useState(warehouses[0]?.value ?? "");
  const [direction, setDirection] = useState<"assemble" | "disassemble">("assemble");
  const [qty, setQty] = useState(1000);
  const [formKey, setFormKey] = useState(0);
  const opt = options.find((o) => o.skuId === skuId) ?? options[0];
  const bal = (id: string): Bal => balances[`${wh}:${id}`] ?? { physical: 0, reserved: 0, avgCost: costFallback[id] ?? 0 };
  const avg = (id: string) => (balances[`${wh}:${id}`] ? bal(id).avgCost : (costFallback[id] ?? 0));
  const own = bal(opt.skuId);
  const lines = opt.components.map((c) => {
    const b = bal(c.skuId);
    const move = roundDiv(qty * c.qty, QTY);
    return { ...c, move, available: b.physical - b.reserved, avgCost: avg(c.skuId), value: roundDiv(move * avg(c.skuId), QTY) };
  });
  let total: number;
  if (direction === "assemble") total = lines.reduce((a, l) => a + l.value, 0);
  else {
    total = roundDiv(qty * avg(opt.skuId), QTY);
    const weights = lines.map((l) => l.move * l.avgCost);
    const shares = allocate(total, weights.some((w) => w > 0) ? weights : lines.map((l) => l.move));
    lines.forEach((l, i) => (l.value = shares[i]));
  }
  const short = direction === "assemble" ? lines.filter((l) => l.move > l.available) : [];
  const ownShort = direction === "disassemble" && qty > own.physical - own.reserved;
  const max = lines.length ? Math.min(...lines.map((l) => (l.qty > 0 ? Math.floor(Math.max(0, l.available) / l.qty) : Infinity))) : 0;
  return (
    <section className="rounded-lg border border-line bg-white">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Nova operação</h2>
        <p className="text-xs text-slate-500">Tudo é gravado numa única operação (todos os movimentos ou nenhum). Saídas nunca deixam saldo negativo nem usam o estoque reservado.</p>
      </header>
      <ActionForm key={formKey} action={runAssemblyAction} onSuccess={() => { setQty(1000); setFormKey((k) => k + 1); }} className="grid gap-5 p-4 lg:grid-cols-2">
        {({ pending, error }) => (
          <>
            <div className="space-y-4">
              <input type="hidden" name="direction" value={direction} />
              <div role="radiogroup" aria-label="Operação" className="grid grid-cols-2 gap-2">
                {([["assemble", "Montar", Combine], ["disassemble", "Desmembrar", Split]] as const).map(([key, label, Icon]) => (
                  <button key={key} type="button" role="radio" aria-checked={direction === key} onClick={() => setDirection(key)} className={cn("focus-ring flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium", direction === key ? "border-accent-500 bg-accent-50 text-accent-700" : "border-line text-slate-600 hover:bg-slate-50")}>
                    <Icon className="size-4" aria-hidden /> {label}
                  </button>
                ))}
              </div>
              <FormGrid cols={2}>
                <Field label="Produto composto" required className="sm:col-span-2">
                  <Select name="skuId" value={opt.skuId} onChange={(e) => setSkuId(e.target.value)} options={options.map((o) => ({ value: o.skuId, label: `${o.name} (${o.sku})` }))} />
                </Field>
                <Field label="Depósito" required>
                  <Select name="warehouseId" value={wh} onChange={(e) => setWh(e.target.value)} options={warehouses} />
                </Field>
                <Field label={`Quantidade (${opt.unitCode})`} required hint={direction === "assemble" ? `Dá para montar ${formatQty(max * QTY)} com o disponível.` : `Montado disponível: ${formatQty(own.physical - own.reserved)}.`}>
                  <QtyInput name="qty" value={qty} onChange={setQty} min={0} />
                </Field>
              </FormGrid>
              <Field label="Observação">
                <Input name="notes" maxLength={500} placeholder="Ex.: montagem para a vitrine de Natal" />
              </Field>
              {short.length > 0 && <Notice tone="bad">Disponível insuficiente: {short.map((l) => `${l.sku} (precisa ${formatQty(l.move)}, disponível ${formatQty(l.available)})`).join("; ")}. O sistema vai recusar.</Notice>}
              {ownShort && <Notice tone="bad">Disponível do composto insuficiente ({formatQty(own.physical - own.reserved)}). O sistema vai recusar.</Notice>}
              {error && <Notice tone="bad">{error}</Notice>}
              <SubmitButton pending={pending} variant="accent" className="w-full">
                {direction === "assemble" ? "Confirmar montagem" : "Confirmar desmembramento"}
              </SubmitButton>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <caption className="pb-2 text-left text-xs text-slate-500">
                  {direction === "assemble" ? "Sai do estoque (componentes) e entra o composto pelo custo somado." : "Sai o composto pelo custo médio; o valor é repartido entre os componentes que voltam."}
                </caption>
                <thead>
                  <tr><th>Item</th><th className="text-right">Movimento</th><th className="text-right">Disponível</th><th className="text-right">Custo médio</th><th className="text-right">Valor</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.skuId}>
                      <td>{l.name}<span className="block font-mono text-xs text-slate-500">{l.sku} · {formatQty(l.qty)} por {opt.unitCode}</span></td>
                      <td className={cn("tabular text-right font-semibold", direction === "assemble" ? "text-red-700" : "text-emerald-700")}>{direction === "assemble" ? "−" : "+"}{formatQty(l.move, l.unitCode)}</td>
                      <td className={cn("tabular text-right", direction === "assemble" && l.move > l.available ? "text-red-700" : "")}>{formatQty(l.available)}</td>
                      <td className="tabular text-right">{formatMoney(l.avgCost)}</td>
                      <td className="tabular text-right">{formatMoney(l.value)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold">
                    <td>{opt.name}<span className="block font-mono text-xs font-normal text-slate-500">{opt.sku} (composto)</span></td>
                    <td className={cn("tabular text-right", direction === "assemble" ? "text-emerald-700" : "text-red-700")}>{direction === "assemble" ? "+" : "−"}{formatQty(qty, opt.unitCode)}</td>
                    <td className="tabular text-right">{formatQty(own.physical - own.reserved)}</td>
                    <td className="tabular text-right">{formatMoney(direction === "assemble" ? (qty ? roundDiv(total * QTY, qty) : 0) : avg(opt.skuId))}</td>
                    <td className="tabular text-right">{formatMoney(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </ActionForm>
    </section>
  );
}
