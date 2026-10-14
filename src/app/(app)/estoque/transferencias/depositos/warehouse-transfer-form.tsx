"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Package, Plus, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatMoney, QTY } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SkuPicker, type SkuHit } from "../../sku-picker";
import { skuLotsAction, warehouseTransferAction } from "../../actions";

type Wh = { id: string; label: string; typeLabel: string };
type Lot = { lot: string; expiry: string | null; qty: number };
type Line = SkuHit & { key: number; qty: number; lot: string; lots: Lot[] };

const fmt = (m: number) => (m / QTY).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * Transferência entre depósitos da mesma filial (§39): imediata, sem trânsito. Sai da origem pelo custo médio (sem
 * consumir o reservado) e entra no destino pelo mesmo custo; produto com lote sai do lote escolhido (ou por FEFO).
 */
export function WarehouseTransferForm({ branchName, warehouses, maxLines }: { branchName: string; warehouses: Wh[]; maxLines: number }) {
  const [fromWh, setFromWh] = useState(warehouses[0]?.id ?? "");
  const [toWh, setToWh] = useState(warehouses.find((w) => w.id !== warehouses[0]?.id)?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [seq, setSeq] = useState(1);
  const totals = useMemo(() => ({ units: lines.reduce((a, l) => a + l.qty, 0), cost: lines.reduce((a, l) => a + Math.round((l.qty * l.avgCost) / QTY), 0) }), [lines]);
  const changeFrom = (id: string) => {
    setFromWh(id);
    setLines([]); // saldo e lotes são do depósito de origem
    if (id === toWh) setToWh(warehouses.find((w) => w.id !== id)?.id ?? "");
  };
  const add = async (h: SkuHit | null) => {
    if (!h) return;
    const key = seq;
    setSeq((n) => n + 1);
    setLines((ls) => [...ls, { ...h, key, qty: Math.min(QTY, Math.max(h.available, 0)) || QTY, lot: "", lots: [] }]);
    const res = await skuLotsAction(h.id, fromWh);
    const lots = res.ok && Array.isArray(res.data) ? (res.data as Lot[]) : [];
    if (lots.length) setLines((ls) => ls.map((l) => (l.key === key ? { ...l, lots } : l)));
  };
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const name = (id: string) => warehouses.find((w) => w.id === id)?.label ?? "—";
  const over = lines.some((l) => l.qty > l.available);
  return (
    <ActionForm action={warehouseTransferAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ skuId: l.id, qty: l.qty, lot: l.lot || null })))} />
          <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Filial (unidade atual)</p>
              <p className="mt-1 font-semibold">{branchName}</p>
              <Field label="Depósito de origem" required className="mt-3">
                <Select name="fromWarehouseId" value={fromWh} onChange={(e) => changeFrom(e.target.value)} options={warehouses.map((w) => ({ value: w.id, label: w.label }))} />
              </Field>
            </div>
            <div className="flex items-center justify-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand-700 text-white" aria-hidden>
                <ArrowRight className="size-5 max-md:rotate-90" />
              </span>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Mesma filial — sem trânsito</p>
              <p className="mt-1 font-semibold">{branchName}</p>
              <Field label="Depósito de destino" required className="mt-3">
                <Select name="toWarehouseId" value={toWh} onChange={(e) => setToWh(e.target.value)} options={warehouses.filter((w) => w.id !== fromWh).map((w) => ({ value: w.id, label: w.label }))} />
              </Field>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-lg border border-line bg-white">
              <header className="border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">Itens</h2>
              </header>
              <div className="p-4">
                {lines.length < maxLines ? (
                  <SkuPicker onChange={(h) => void add(h)} warehouseId={fromWh} clearOnSelect placeholder="Buscar produto, SKU ou código de barras para adicionar" />
                ) : (
                  <Notice tone="info">Máximo de {maxLines} linhas por transferência entre depósitos — conclua esta e faça outra.</Notice>
                )}
                {lines.length === 0 ? (
                  <p className="mt-4 rounded-md border-2 border-dashed border-line p-6 text-center text-sm text-slate-500">
                    <Plus className="mx-auto mb-1 size-5" /> Pesquise acima para adicionar produtos do depósito de origem.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="table-base w-full text-sm">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="text-right">Disponível na origem</th>
                          <th>Lote</th>
                          <th className="w-36 text-right">Quantidade</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.key}>
                            <td>
                              <span className="flex items-center gap-2">
                                <Package className="size-4 shrink-0 text-slate-400" aria-hidden />
                                <span className="min-w-0">
                                  <span className="block truncate">{l.name}</span>
                                  <span className="block font-mono text-xs text-slate-500">SKU {l.sku}</span>
                                </span>
                              </span>
                            </td>
                            <td className={cn("tabular text-right", l.qty > l.available ? "text-red-700" : "")}>
                              {fmt(l.available)} {l.unitCode}
                              {l.physical !== l.available && <span className="block text-xs text-slate-500">físico {fmt(l.physical)}</span>}
                            </td>
                            <td>
                              {l.lots.length ? (
                                <Select aria-label={`Lote de ${l.sku}`} value={l.lot} onChange={(e) => set(l.key, { lot: e.target.value })} placeholder="Automático (FEFO)" options={l.lots.map((x) => ({ value: x.lot, label: `${x.lot}${x.expiry ? ` — vence ${formatDate(x.expiry)}` : ""} (${fmt(x.qty)})` }))} />
                              ) : (
                                <span className="text-xs text-slate-500">—</span>
                              )}
                            </td>
                            <td>
                              <QtyInput ariaLabel={`Quantidade de ${l.sku}`} value={l.qty} min={0} onChange={(v) => set(l.key, { qty: v })} />
                            </td>
                            <td>
                              <button type="button" aria-label={`Remover ${l.sku}`} className="rounded p-1 hover:bg-slate-100" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                                <X className="size-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {over && (
                  <div className="mt-3">
                    <Notice tone="bad">Há itens acima do disponível na origem (o reservado para pedidos, pré-vendas e transferências não é transferido) — a transferência será recusada.</Notice>
                  </div>
                )}
              </div>
            </section>
            <aside className="space-y-3 rounded-lg border border-line bg-white p-4">
              <h2 className="text-sm font-semibold">Resumo</h2>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Linhas</dt>
                <dd className="tabular text-right font-medium">{lines.length}</dd>
                <dt className="text-slate-500">Unidades</dt>
                <dd className="tabular text-right font-medium">{fmt(totals.units)}</dd>
                <dt className="text-slate-500">Origem</dt>
                <dd className="text-right">{name(fromWh)}</dd>
                <dt className="text-slate-500">Destino</dt>
                <dd className="text-right">{name(toWh)}</dd>
                <dt className="text-slate-500">Valor de custo</dt>
                <dd className="tabular text-right text-base font-bold text-brand-800">{formatMoney(totals.cost)}</dd>
              </dl>
              <p className="text-xs text-slate-500">Sai pelo custo médio da origem e entra no destino pelo mesmo custo (o custo médio do destino é recalculado).</p>
              <Field label="Motivo" required>
                <Input name="reason" required maxLength={500} placeholder="Ex.: reposição da loja a partir do almoxarifado" />
              </Field>
              <Field label="Observações">
                <Textarea name="notes" rows={2} maxLength={500} />
              </Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <SubmitButton pending={pending} variant="accent" className="w-full">
                Transferir agora
              </SubmitButton>
              <p className="text-xs text-slate-500">A transferência é concluída na hora (não há separação, trânsito nem recebimento). Para desfazer, faça a transferência inversa.</p>
            </aside>
          </div>
        </>
      )}
    </ActionForm>
  );
}
