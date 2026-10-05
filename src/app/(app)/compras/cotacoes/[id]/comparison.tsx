"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty, formatBps } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { evaluateSelection, quoteLine, type QuoteItem, type QuoteProposal } from "@/domain/purchase-calc";
import { selectionAction, suggestAction } from "../actions";

export function Comparison({ quotationId, items, proposals, supplierOrder, initial, refDate, readOnly, onTimeDefault, heuristic }: { quotationId: string; items: QuoteItem[]; proposals: QuoteProposal[]; supplierOrder: Array<{ id: string; name: string }>; initial: Record<string, string>; refDate: string; readOnly: boolean; onTimeDefault: boolean; heuristic: string | null }) {
  const [assign, setAssign] = useState<Record<string, string>>(initial);
  const [onTimeOnly, setOnTimeOnly] = useState(onTimeDefault);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const opts = useMemo(() => ({ onTimeOnly }), [onTimeOnly]);
  const ev = useMemo(() => evaluateSelection(items, proposals, assign, refDate, opts), [items, proposals, assign, refDate, opts]);
  const bySupplier = new Map(proposals.map((p) => [p.supplierId, p]));
  const persist = (next: Record<string, string>) => {
    setAssign(next);
    if (readOnly) return;
    start(async () => {
      const r = await selectionAction(quotationId, next);
      if (!r.ok) toast("error", r.error);
      else router.refresh();
    });
  };
  const minUnit = (it: QuoteItem) => {
    let best: number | null = null;
    for (const p of proposals) {
      const l = quoteLine(it, p, refDate, opts);
      if (l?.viable && (best == null || l.netUnit < best)) best = l.netUnit;
    }
    return best;
  };
  const selectedCount = items.filter((i) => assign[i.skuId] && ev.groups.some((g) => g.items.some((x) => x.skuId === i.skuId))).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand-700" checked={onTimeOnly} onChange={(e) => setOnTimeOnly(e.target.checked)} /> Somente entregas no prazo (até a data necessária)
        </label>
        <div className="flex items-center gap-2">
          {heuristic && <span className="hidden text-xs text-slate-500 lg:inline">{heuristic}</span>}
          {!readOnly && (
            <Button variant="primary" loading={pending} onClick={() => start(async () => { const r = await suggestAction(quotationId, onTimeOnly); if (!r.ok) return toast("error", r.error); toast("success", r.message ?? "Seleção sugerida."); router.refresh(); })}>
              <Sparkles className="size-4" /> Selecionar menor total com frete
            </Button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="align-top">
              <th className="w-64 border-b border-line p-3 text-left text-xs font-semibold text-slate-600">Produto / demanda<span className="block font-normal text-slate-500">Escolha uma proposta por item</span></th>
              {supplierOrder.map((s) => {
                const p = bySupplier.get(s.id);
                const expired = p?.validUntil && p.validUntil < refDate;
                return (
                  <th key={s.id} className="border-b border-l border-line p-3 text-left text-xs font-normal text-slate-600">
                    <span className="block text-sm font-semibold text-ink">{s.name}</span>
                    {p ? (
                      <span className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <span>Frete</span><span className="tabular text-right">{formatMoney(p.freight)}</span>
                        <span>Pagamento</span><span className="text-right">{p.paymentTermsText ?? "—"}</span>
                        <span>Válida até</span><span className={cn("text-right", expired && "font-semibold text-red-700")}>{formatDate(p.validUntil)}</span>
                        <span>Mínimo</span><span className="tabular text-right">{formatMoney(p.minOrderValue ?? 0)}</span>
                      </span>
                    ) : (
                      <span className="mt-1 block text-amber-700">Aguardando proposta</span>
                    )}
                    {expired && <Badge tone="bad" className="mt-1">Proposta vencida</Badge>}
                    {!readOnly && <Link href={`/compras/cotacoes/${quotationId}?tab=propostas&editar=${s.id}`} className="mt-1 block text-xs text-brand-700 underline">{p ? "Editar proposta" : "Registrar proposta"}</Link>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const best = minUnit(it);
              return (
                <tr key={it.skuId} className="align-top">
                  <td className="border-b border-line p-3">
                    <span className="font-medium">{it.description}</span>
                    <span className="block text-xs text-slate-500">{it.sku} · {formatQty(it.qty, it.unitCode ?? undefined)}</span>
                    {it.neededBy && <span className="block text-xs text-slate-500">Necessário até {formatDate(it.neededBy)}</span>}
                  </td>
                  {supplierOrder.map((s) => {
                    const p = bySupplier.get(s.id);
                    const l = p ? quoteLine(it, p, refDate, opts) : null;
                    const checked = assign[it.skuId] === s.id;
                    if (!l)
                      return (
                        <td key={s.id} className="border-b border-l border-line bg-slate-50 p-3 text-xs text-red-700">Sem proposta / não cotado</td>
                      );
                    return (
                      <td key={s.id} className={cn("border-b border-l border-line p-2", checked && "bg-brand-50")}>
                        <label className={cn("flex cursor-pointer items-start gap-2 rounded-md p-1", !l.viable && "cursor-not-allowed opacity-70")}>
                          <input type="radio" name={`sel-${it.skuId}`} className="mt-1 accent-brand-700" disabled={readOnly || !l.viable} checked={checked} onChange={() => persist({ ...assign, [it.skuId]: s.id })} aria-label={`Escolher ${s.name} para ${it.description}`} />
                          <span className="min-w-0">
                            <span className="tabular block font-semibold">{formatMoney(l.netUnit)} <span className="text-xs font-normal text-slate-500">/ {it.unitCode ?? "un."}</span></span>
                            <span className="block text-xs text-slate-500">{l.discountBps ? `${formatBps(l.discountBps, 0)} de desconto` : "Sem desconto"} · total {formatMoney(l.total)}</span>
                            {l.deliveryDate && <span className={cn("block text-xs", l.late ? "text-red-700" : "text-slate-500")}>Entrega {formatDate(l.deliveryDate)}{l.late ? " — após a data necessária" : ""}</span>}
                            {!l.available && <span className="block text-xs text-red-700">{l.reason}</span>}
                            {l.expired && <span className="block text-xs text-red-700">Proposta vencida</span>}
                            {l.viable && best != null && l.netUnit === best && <Badge tone="good" className="mt-1">Menor unitário</Badge>}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="bg-slate-50 align-top text-xs">
              <td className="p-3 font-semibold text-slate-600">Por fornecedor (seleção atual)</td>
              {supplierOrder.map((s) => {
                const g = ev.groups.find((x) => x.supplierId === s.id);
                return (
                  <td key={s.id} className="border-l border-line p-3">
                    {g ? (
                      <span className="grid grid-cols-2 gap-x-2">
                        <span>Produtos</span><span className="tabular text-right">{formatMoney(g.products)}</span>
                        <span>Frete</span><span className="tabular text-right">{formatMoney(g.freight)}</span>
                        <span className="font-semibold">Total</span><span className="tabular text-right font-semibold">{formatMoney(g.total)}</span>
                        {g.belowMinimum && <span className="col-span-2 text-red-700">Abaixo do mínimo ({formatMoney(g.minOrderValue)})</span>}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-slate-500">Preços líquidos por unidade (desconto aplicado) · frete fixo por fornecedor escolhido, cobrado uma vez · propostas vencidas, indisponíveis ou (com o filtro) após a data necessária não são selecionáveis.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div><p className="text-xs text-slate-500">Produtos</p><p className="tabular font-semibold">{formatMoney(ev.productsTotal)}</p></div>
          <div><p className="text-xs text-slate-500">Frete</p><p className="tabular font-semibold">{formatMoney(ev.freightTotal)}</p></div>
          <div><p className="text-xs text-slate-500">Total com frete</p><p className="tabular text-lg font-semibold text-brand-800">{formatMoney(ev.grandTotal)}</p></div>
          <div className="self-end text-xs text-slate-500">{selectedCount} de {items.length} produto(s) · {ev.groups.length} fornecedor(es) · frete cobrado uma vez por fornecedor; outros acréscimos R$ 0,00.</div>
        </div>
        <div className="flex gap-2">
          {!readOnly && <Button variant="ghost" disabled={!Object.keys(assign).length || pending} onClick={() => persist({})}>Limpar seleção</Button>}
          <Link href={`/compras/cotacoes/${quotationId}?tab=revisao`} className={buttonClass("accent")}>Revisar escolha</Link>
        </div>
      </div>
      {ev.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-md bg-amber-50 py-2 pl-8 pr-3 text-sm text-amber-900">{ev.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
      )}
    </div>
  );
}
