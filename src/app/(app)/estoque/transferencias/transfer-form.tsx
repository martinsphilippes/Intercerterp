"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Plus, X, Package } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatMoney, QTY } from "@/lib/money";
import { SkuPicker, type SkuHit } from "../sku-picker";
import { saveTransferAction } from "../actions";

type Opt = { value: string; label: string };
type Wh = { id: string; name: string; branchId: string };
export type TransferLine = SkuHit & { qty: number };

const fmt = (m: number) => (m / QTY).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export function TransferForm({
  transfer,
  origin,
  branches,
  warehouses,
  users,
  initialLines,
  availableItems,
  currentUserId,
}: {
  transfer?: Record<string, any> | null;
  origin: { id: string; name: string };
  branches: Opt[];
  warehouses: Wh[];
  users: Opt[];
  initialLines: TransferLine[];
  availableItems: number;
  currentUserId: string;
}) {
  const t = transfer ?? {};
  const fromWhs = warehouses.filter((w) => w.branchId === origin.id);
  const [fromWh, setFromWh] = useState<string>(t.fromWarehouseId ?? fromWhs[0]?.id ?? "");
  const [toBranch, setToBranch] = useState<string>(t.toBranchId ?? branches[0]?.value ?? "");
  const toWhs = warehouses.filter((w) => w.branchId === toBranch);
  const [toWh, setToWh] = useState<string>(t.toWarehouseId ?? "");
  const [lines, setLines] = useState<TransferLine[]>(initialLines);
  const totals = useMemo(() => ({ products: lines.length, units: lines.reduce((a, l) => a + l.qty, 0), cost: lines.reduce((a, l) => a + Math.round((l.qty * l.avgCost) / QTY), 0) }), [lines]);
  const add = (h: SkuHit | null) => {
    if (!h) return;
    setLines((ls) => (ls.some((l) => l.id === h.id) ? ls : [...ls, { ...h, qty: Math.min(QTY, Math.max(h.available, 0)) || QTY }]));
  };
  const destName = branches.find((b) => b.value === toBranch)?.label ?? "—";
  const toWhValue = toWhs.some((w) => w.id === toWh) ? toWh : (toWhs[0]?.id ?? "");
  return (
    <ActionForm action={saveTransferAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          {t.id && <input type="hidden" name="id" value={t.id} />}
          <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ skuId: l.id, qty: l.qty })))} />
          <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Filial de origem (unidade atual)</p>
              <p className="mt-1 font-semibold">{origin.name}</p>
              <p className="text-xs text-slate-500">{availableItems.toLocaleString("pt-BR")} itens com saldo disponível</p>
              <Field label="Depósito de origem" className="mt-3">
                <Select name="fromWarehouseId" value={fromWh} onChange={(e) => setFromWh(e.target.value)} options={fromWhs.map((w) => ({ value: w.id, label: w.name }))} />
              </Field>
            </div>
            <div className="flex items-center justify-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand-700 text-white" aria-hidden>
                <ArrowRight className="size-5 max-md:rotate-90" />
              </span>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <Field label="Filial de destino" required>
                <Select name="toBranchId" value={toBranch} onChange={(e) => setToBranch(e.target.value)} options={branches} />
              </Field>
              <Field label="Depósito de destino" className="mt-3" hint="Recebimento e trânsito ficam neste depósito.">
                <Select name="toWarehouseId" value={toWhValue} onChange={(e) => setToWh(e.target.value)} options={toWhs.map((w) => ({ value: w.id, label: w.name }))} />
              </Field>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-lg border border-line bg-white">
              <header className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">Produtos da transferência</h2>
              </header>
              <div className="p-4">
                <SkuPicker onChange={add} warehouseId={fromWh} clearOnSelect placeholder="Buscar produto, SKU ou código de barras para adicionar" />
                {lines.length === 0 ? (
                  <p className="mt-4 rounded-md border-2 border-dashed border-line p-6 text-center text-sm text-slate-500">
                    <Plus className="mx-auto mb-1 size-5" /> Pesquise acima para adicionar produtos.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="table-base w-full text-sm">
                      <thead>
                        <tr><th>Produto</th><th className="text-right">Estoque origem</th><th className="w-36 text-right">Quantidade</th><th className="text-right">Saldo após</th><th /></tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => {
                          const after = l.available - l.qty;
                          return (
                            <tr key={l.id}>
                              <td>
                                <span className="flex items-center gap-2">
                                  <Package className="size-4 shrink-0 text-slate-400" aria-hidden />
                                  <span className="min-w-0"><span className="block truncate">{l.name}</span><span className="block font-mono text-xs text-slate-500">SKU {l.sku}</span></span>
                                </span>
                              </td>
                              <td className={cn("tabular text-right", l.minQty && l.available < l.minQty ? "text-amber-700" : "")}>{fmt(l.available)} {l.unitCode}</td>
                              <td><QtyInput ariaLabel={`Quantidade de ${l.sku}`} value={l.qty} min={0} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: v } : x)))} /></td>
                              <td className={cn("tabular text-right font-semibold", after < 0 ? "text-red-700" : l.minQty && after < l.minQty ? "text-amber-700" : "")}>{fmt(after)}</td>
                              <td>
                                <button type="button" aria-label={`Remover ${l.sku}`} className="rounded p-1 hover:bg-slate-100" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                                  <X className="size-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {lines.some((l) => l.available - l.qty < 0) && <div className="mt-3"><Notice tone="bad">Há itens com quantidade acima do disponível na origem — a separação será recusada.</Notice></div>}
              </div>
            </section>
            <aside className="space-y-3 rounded-lg border border-line bg-white p-4">
              <h2 className="text-sm font-semibold">Resumo da transferência</h2>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Produtos diferentes</dt><dd className="tabular text-right font-medium">{totals.products}</dd>
                <dt className="text-slate-500">Total de unidades</dt><dd className="tabular text-right font-medium">{fmt(totals.units)}</dd>
                <dt className="text-slate-500">Origem</dt><dd className="text-right">{origin.name}</dd>
                <dt className="text-slate-500">Destino</dt><dd className="text-right">{destName}</dd>
                <dt className="text-slate-500">Valor de custo</dt><dd className="tabular text-right text-base font-bold text-brand-800">{formatMoney(totals.cost)}</dd>
              </dl>
              <p className="text-xs text-slate-500">Custo pelo custo médio atual da origem; o recebimento usa o custo efetivo da expedição.</p>
              <Field label="Responsável pelo envio">
                <Select name="responsibleId" defaultValue={t.responsibleId ?? currentUserId} options={users} />
              </Field>
              <Field label="Previsão de chegada">
                <Input type="date" name="expectedAt" defaultValue={t.expectedAt ?? ""} />
              </Field>
              <Field label="Documento de referência" hint="Romaneio ou NF-e emitida fora do ERP (opcional).">
                <Input name="documentRef" defaultValue={t.documentRef ?? ""} maxLength={200} />
              </Field>
              <Field label="Observações">
                <Textarea name="notes" defaultValue={t.notes ?? ""} rows={2} placeholder="Informações para conferência no destino" />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex flex-col gap-2 pt-1">
                <SubmitButton pending={pending} variant="accent" name="mode" value="send">Confirmar e enviar transferência</SubmitButton>
                <SubmitButton pending={pending} variant="secondary" name="mode" value="draft">{t.id ? "Salvar rascunho" : "Salvar como rascunho"}</SubmitButton>
              </div>
              <p className="text-xs text-slate-500">“Confirmar e enviar” separa (reserva) e expede: sai da origem e fica em trânsito até o recebimento no destino.</p>
            </aside>
          </div>
        </>
      )}
    </ActionForm>
  );
}
