"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, MessageSquare, Save, Search } from "lucide-react";
import { ActionForm, SubmitButton, useIdemKey } from "@/components/ui/action-form";
import { Field, Select, inputClass } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney, QTY } from "@/lib/money";
import { saveCountsAction, concludeInventoryAction, addInventoryItemAction } from "../../actions";
import { SkuPicker } from "../../sku-picker";

export interface CountItem {
  skuId: string;
  skuCode: string;
  productName: string;
  unitCode: string;
  location: string | null;
  baseQty: number;
  liveQty: number;
  counted: boolean;
  countedQty: number | null;
  recountQty: number | null;
  expectedQty: number | null;
  difference: number | null;
  differenceValue: number | null;
  unitCost: number;
  note: string | null;
  countedByName: string | null;
}

const fmt = (m: number | null | undefined) => (m == null ? "—" : (m / QTY).toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const parse = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * QTY) : NaN;
};

type Draft = { qty: string; recount: string; note: string };

export function CountSheet({ inventoryId, items, editable, canClose }: { inventoryId: string; items: CountItem[]; editable: boolean; canClose: boolean }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [sector, setSector] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  const sectors = useMemo(() => [...new Set(items.map((i) => (i.location ?? "").split(/[-\s]/)[0]).filter(Boolean))].sort(), [items]);
  const status = (i: CountItem) => (!i.counted ? "pending" : i.difference ? "diff" : "ok");
  const shown = items.filter((i) => {
    const n = q.trim().toLowerCase();
    if (n && !`${i.productName} ${i.skuCode}`.toLowerCase().includes(n)) return false;
    if (state && status(i) !== state) return false;
    if (sector && !(i.location ?? "").startsWith(sector)) return false;
    return true;
  });
  const d = (i: CountItem): Draft => drafts[i.skuId] ?? { qty: "", recount: "", note: i.note ?? "" };
  const set = (i: CountItem, patch: Partial<Draft>) => setDrafts((x) => ({ ...x, [i.skuId]: { ...d(i), ...patch } }));
  const changed = Object.entries(drafts).filter(([skuId, v]) => {
    const it = items.find((x) => x.skuId === skuId)!;
    return v.qty.trim() || v.recount.trim() || (v.note ?? "") !== (it.note ?? "");
  });
  const save = () => {
    const entries: Array<{ skuId: string; qty: number | null; note?: string | null; recount?: boolean }> = [];
    for (const [skuId, v] of changed) {
      const it = items.find((x) => x.skuId === skuId)!;
      const noteChanged = (v.note ?? "") !== (it.note ?? "");
      if (v.recount.trim()) {
        const n = parse(v.recount);
        if (Number.isNaN(n)) return toast("error", `Recontagem inválida em ${it.skuCode}.`);
        entries.push({ skuId, qty: n, recount: true, note: noteChanged ? v.note : undefined });
      } else if (v.qty.trim()) {
        const n = parse(v.qty);
        if (Number.isNaN(n)) return toast("error", `Quantidade inválida em ${it.skuCode}.`);
        entries.push({ skuId, qty: n, note: noteChanged ? v.note : undefined });
      } else if (noteChanged) entries.push({ skuId, qty: null, note: v.note });
    }
    if (!entries.length) return toast("info", "Nenhuma alteração para salvar.");
    const fd = new FormData();
    fd.set("id", inventoryId);
    fd.set("entries", JSON.stringify(entries));
    fd.set("_idem", idem);
    start(async () => {
      const r = await saveCountsAction(fd);
      if (!r.ok) return toast("error", r.error);
      toast("success", r.message ?? "Contagem salva.");
      setDrafts({});
      router.refresh();
    });
  };
  const counted = items.filter((i) => i.counted).length;
  const pct = items.length ? Math.round((counted / items.length) * 100) : 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
          <input className={cn(inputClass, "h-9 pl-8")} placeholder="Buscar produto ou SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto ou SKU" />
        </div>
        <Field label="Situação do item">
          <Select value={state} onChange={(e) => setState(e.target.value)} options={[{ value: "ok", label: "Conferido" }, { value: "diff", label: "Divergência" }, { value: "pending", label: "Não contado" }]} placeholder="Todos os itens" />
        </Field>
        <Field label="Setor / localização">
          <Select value={sector} onChange={(e) => setSector(e.target.value)} options={sectors.map((x) => ({ value: x, label: x }))} placeholder="Todos os setores" />
        </Field>
        {editable && (
          <div className="min-w-[260px] flex-1">
            <p className="mb-1 text-xs font-medium text-slate-600">Incluir item fora do escopo</p>
            <SkuPicker
              clearOnSelect
              placeholder="Produto encontrado na contagem…"
              onChange={(h) =>
                h &&
                start(async () => {
                  const r = await addInventoryItemAction(inventoryId, h.id);
                  if (!r.ok) return toast("error", r.error);
                  toast("success", r.message ?? "Item incluído.");
                  router.refresh();
                })
              }
            />
          </div>
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs text-slate-600">
          <span>Progresso da contagem</span>
          <span className="tabular">{counted} de {items.length} ({pct}%)</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Localização</th>
              <th className="text-right" title="Saldo físico registrado na abertura do inventário">Saldo base</th>
              <th className="text-right" title="Contados: base + movimentos até a contagem. Não contados: saldo atual.">Saldo sistema</th>
              <th className="w-28 text-right">Contagem física</th>
              {editable && <th className="w-28 text-right">Recontagem</th>}
              <th className="text-right">Divergência</th>
              <th className="text-right">Impacto</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const st = status(i);
              const dr = d(i);
              const final = i.recountQty ?? i.countedQty;
              return (
                <tr key={i.skuId}>
                  <td><span className="block">{i.productName}</span><span className="font-mono text-xs text-slate-500">SKU {i.skuCode}</span></td>
                  <td className="text-xs">{i.location ?? "—"}</td>
                  <td className="tabular text-right">{fmt(i.baseQty)}</td>
                  <td className="tabular text-right">{fmt(i.counted ? i.expectedQty : i.liveQty)} <span className="text-xs text-slate-400">{i.unitCode}</span></td>
                  <td className="text-right">
                    {editable ? (
                      <input aria-label={`Contagem de ${i.skuCode}`} inputMode="decimal" className={cn(inputClass, "tabular h-8 text-right")} placeholder={i.counted ? fmt(i.countedQty) : "—"} value={dr.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                    ) : (
                      <span className="tabular">{fmt(final)}</span>
                    )}
                    {i.recountQty != null && <span className="block text-xs text-slate-500">recontado: {fmt(i.recountQty)}</span>}
                  </td>
                  {editable && (
                    <td className="text-right">
                      <input aria-label={`Recontagem de ${i.skuCode}`} inputMode="decimal" disabled={!i.counted} className={cn(inputClass, "tabular h-8 text-right")} placeholder={i.counted ? (i.recountQty != null ? fmt(i.recountQty) : "") : "conte antes"} value={dr.recount} onChange={(e) => set(i, { recount: e.target.value })} />
                    </td>
                  )}
                  <td className={cn("tabular text-right font-semibold", (i.difference ?? 0) < 0 ? "text-red-700" : (i.difference ?? 0) > 0 ? "text-emerald-700" : "text-slate-400")}>{i.difference == null ? "—" : `${i.difference > 0 ? "+" : i.difference < 0 ? "−" : ""}${fmt(Math.abs(i.difference))}`}</td>
                  <td className={cn("tabular text-right", (i.differenceValue ?? 0) < 0 ? "text-red-700" : (i.differenceValue ?? 0) > 0 ? "text-emerald-700" : "text-slate-400")}>{i.differenceValue == null ? "—" : formatMoney(i.differenceValue)}</td>
                  <td>
                    {st === "ok" ? <Badge tone="good"><CheckCircle2 className="size-3" /> Conferido</Badge> : st === "diff" ? <Badge tone="bad"><AlertTriangle className="size-3" /> Divergência</Badge> : <Badge><Clock className="size-3" /> Não contado</Badge>}
                    {i.countedByName && <span className="mt-0.5 block text-[11px] text-slate-500">{i.countedByName}</span>}
                  </td>
                  <td className="relative">
                    <button type="button" title={i.note ?? "Observação"} aria-label="Observação" className={cn("rounded p-1 hover:bg-slate-100", i.note || dr.note ? "text-brand-700" : "text-slate-400")} onClick={() => setNoteOpen(noteOpen === i.skuId ? null : i.skuId)}>
                      <MessageSquare className="size-4" />
                    </button>
                    {noteOpen === i.skuId && (
                      <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-line bg-white p-2 shadow-lg">
                        {editable ? <textarea className={cn(inputClass, "text-xs")} rows={3} value={dr.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="Observação do item" autoFocus /> : <p className="text-xs">{i.note ?? "Sem observação."}</p>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500" /> Saldo confere</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-red-500" /> Diferença encontrada</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-slate-300" /> Aguardando contagem</span>
      </div>
      {editable && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
          <button type="button" onClick={save} disabled={pending} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
            <Save className="size-4" /> Salvar contagem {changed.length ? `(${changed.length})` : ""}
          </button>
          {canClose ? (
            <ActionForm action={concludeInventoryAction} confirm="Concluir o inventário? Será lançado um ajuste por item com diferença (uma única vez) e o inventário não aceitará mais contagens." className="flex flex-wrap items-end gap-2">
              {({ pending: p2 }) => (
                <>
                  <input type="hidden" name="id" value={inventoryId} />
                  <Select name="uncounted" aria-label="Itens não contados" defaultValue="keep" options={[{ value: "keep", label: "Não contados: manter saldo" }, { value: "zero", label: "Não contados: considerar zero" }]} />
                  <SubmitButton pending={p2 || pending} variant="accent" className={changed.length ? "opacity-60" : ""}>Concluir inventário</SubmitButton>
                </>
              )}
            </ActionForm>
          ) : (
            <Notice tone="info">Conclusão exige a permissão “Concluir inventário”.</Notice>
          )}
        </div>
      )}
    </div>
  );
}
