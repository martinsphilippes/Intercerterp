"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Layers, MessageSquare, Plus, Save, ScanBarcode, Search, Trash2, Undo2 } from "lucide-react";
import { ActionForm, SubmitButton, useIdemKey } from "@/components/ui/action-form";
import { Field, Select, inputClass } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney, QTY } from "@/lib/money";
import { saveCountsAction, concludeInventoryAction, addInventoryItemAction } from "../../actions";
import { applyScan, emptyScan, findScanItem, parseScanInput, scanTotal, setScanCount, undoScan, type ScanState } from "@/domain/count-scan";
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
  /** bipagem (EST-04): códigos de barras do SKU */
  barcode?: string | null;
  extraBarcodes?: string[] | null;
  /** contagem por lote (EST-02): produto com controle de lote, lotes do saldo e contagem por lote já gravada */
  lotControl?: boolean;
  lots?: Array<{ lot: string; expiry: string | null; qty: number }>;
  lotCounts?: Array<{ lot: string; expiry: string | null; qty: number }> | null;
}

type LotDraft = { lot: string; expiry: string; qty: string };

/** Som curto de confirmação (leitura aceita) ou erro (código fora do inventário). */
function beep(ok: boolean) {
  try {
    const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = ok ? 1320 : 220;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => ctx.close();
  } catch {
    /* sem áudio: o destaque visual continua */
  }
}

const fmt = (m: number | null | undefined) => (m == null ? "—" : (m / QTY).toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const parse = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * QTY) : NaN;
};

type Draft = { qty: string; recount: string; note: string; lots?: LotDraft[] };

export function CountSheet({ inventoryId, items, editable, canClose, scanEnabled = false, lotsEnabled = false }: { inventoryId: string; items: CountItem[]; editable: boolean; canClose: boolean; scanEnabled?: boolean; lotsEnabled?: boolean }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [sector, setSector] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [lotOpen, setLotOpen] = useState<string | null>(null);
  // bipagem (EST-04): leituras acumuladas por item até "Lançar na contagem"
  const [scanMode, setScanMode] = useState(false);
  const [scan, setScan] = useState<ScanState>(emptyScan);
  const [scanText, setScanText] = useState("");
  const [scanAdd, setScanAdd] = useState(false);
  const [last, setLast] = useState<{ skuId: string | null; text: string; ok: boolean } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
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
    return v.qty.trim() || v.recount.trim() || (v.note ?? "") !== (it.note ?? "") || v.lots?.some((l) => l.qty.trim());
  });
  const save = () => {
    const entries: Array<{ skuId: string; qty: number | null; note?: string | null; recount?: boolean; lots?: Array<{ lot: string; expiry: string | null; qty: number }> }> = [];
    for (const [skuId, v] of changed) {
      const it = items.find((x) => x.skuId === skuId)!;
      const noteChanged = (v.note ?? "") !== (it.note ?? "");
      // contagem por lote: a soma dos lotes é a quantidade do item (se a quantidade não foi digitada)
      let lots: Array<{ lot: string; expiry: string | null; qty: number }> | undefined;
      if (v.lots) {
        lots = [];
        for (const l of v.lots) {
          if (!l.lot.trim() && !l.qty.trim()) continue;
          const n = parse(l.qty);
          if (!l.lot.trim() || n == null || Number.isNaN(n)) return toast("error", `Lote ou quantidade inválida em ${it.skuCode}.`);
          lots.push({ lot: l.lot.trim(), expiry: l.expiry || null, qty: n });
        }
      }
      const lotSum = lots?.reduce((a, l) => a + l.qty, 0) ?? null;
      if (v.recount.trim()) {
        const n = parse(v.recount);
        if (Number.isNaN(n)) return toast("error", `Recontagem inválida em ${it.skuCode}.`);
        entries.push({ skuId, qty: n, recount: true, note: noteChanged ? v.note : undefined, ...(lots ? { lots } : {}) });
      } else if (v.qty.trim() || lots?.length) {
        const n = v.qty.trim() ? parse(v.qty) : lotSum;
        if (n == null || Number.isNaN(n)) return toast("error", `Quantidade inválida em ${it.skuCode}.`);
        if (lotSum != null && lotSum > n) return toast("error", `${it.skuCode}: a soma dos lotes (${fmt(lotSum)}) passa da quantidade contada (${fmt(n)}).`);
        entries.push({ skuId, qty: n, note: noteChanged ? v.note : undefined, ...(lots ? { lots } : {}) });
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
  // ── bipagem
  const read = () => {
    const { code, qty } = parseScanInput(scanText);
    setScanText("");
    if (!code) return;
    const hit = findScanItem(items.map((i) => ({ ...i, sku: i.skuCode })), code);
    if (!hit) {
      beep(false);
      setLast({ skuId: null, text: `Código ${code} não pertence a este inventário (inclua o item fora do escopo, se for o caso).`, ok: false });
      return;
    }
    beep(true);
    const next = applyScan(scan, hit.skuId, qty ?? QTY);
    setScan(next);
    setLast({ skuId: hit.skuId, text: `${hit.productName} — +${fmt(qty ?? QTY)} (acumulado ${fmt(next.counts[hit.skuId])} ${hit.unitCode})`, ok: true });
  };
  const correct = (skuId: string, text: string) => {
    const n = parse(text);
    if (n == null || Number.isNaN(n)) return toast("error", "Quantidade inválida.");
    setScan((st) => setScanCount(st, skuId, n));
  };
  const scannedIds = Object.keys(scan.counts);
  const launchScan = () => {
    if (!scannedIds.length) return toast("info", "Nenhuma leitura para lançar.");
    setDrafts((x) => {
      const out = { ...x };
      for (const skuId of scannedIds) {
        const it = items.find((i) => i.skuId === skuId)!;
        const total = scanTotal(scan, skuId, it.recountQty ?? it.countedQty, scanAdd ? "add" : "replace");
        const cur = out[skuId] ?? { qty: "", recount: "", note: it.note ?? "" };
        out[skuId] = it.counted ? { ...cur, recount: fmt(total) } : { ...cur, qty: fmt(total) };
      }
      return out;
    });
    toast("success", `${scannedIds.length} item(ns) lançado(s) na folha. Confira e clique em “Salvar contagem”.`);
    setScan(emptyScan());
    setLast(null);
  };
  const lotDrafts = (i: CountItem): LotDraft[] =>
    d(i).lots ??
    (i.lotCounts ?? i.lots ?? []).map((l) => ({ lot: l.lot, expiry: l.expiry ?? "", qty: i.lotCounts ? fmt(l.qty) : "" }));
  const setLots = (i: CountItem, lots: LotDraft[]) => set(i, { lots });
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
      {editable && scanEnabled && (
        <div className={cn("rounded-md border p-3", scanMode ? "border-brand-300 bg-brand-50/40" : "border-line")}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setScanMode((v) => !v); setTimeout(() => scanRef.current?.focus(), 0); }} className={cn("focus-ring inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium", scanMode ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:bg-slate-50")} aria-pressed={scanMode}>
              <ScanBarcode className="size-4" /> {scanMode ? "Bipando" : "Bipar"}
            </button>
            {scanMode ? (
              <>
                <form className="min-w-[240px] flex-1" onSubmit={(e) => { e.preventDefault(); read(); }}>
                  <input ref={scanRef} className={cn(inputClass, "h-9 font-mono")} placeholder="Leia o código de barras (ou 6*código para somar 6)" value={scanText} onChange={(e) => setScanText(e.target.value)} aria-label="Leitura do código de barras" autoFocus autoComplete="off" />
                </form>
                <button type="button" onClick={() => { setScan((st) => undoScan(st)); scanRef.current?.focus(); }} disabled={!scan.log.length} className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50 disabled:opacity-50"><Undo2 className="size-4" /> Desfazer última</button>
                <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={scanAdd} onChange={(e) => setScanAdd(e.target.checked)} /> Somar à contagem já gravada</label>
                <button type="button" onClick={launchScan} disabled={!scannedIds.length} className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Lançar na contagem ({scannedIds.length})</button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Leitor ou teclado: cada leitura soma 1 (ou a quantidade informada antes do código, ex.: 6*789…) ao item lido.</span>
            )}
          </div>
          {scanMode && last && (
            <p role="status" className={cn("mt-2 rounded px-2 py-1 text-sm", last.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>{last.text}</p>
          )}
          {scanMode && scannedIds.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {scannedIds.map((skuId) => {
                const it = items.find((i) => i.skuId === skuId)!;
                return (
                  <li key={skuId} className={cn("flex items-center justify-between gap-2 rounded border bg-white px-2 py-1", last?.skuId === skuId ? "border-emerald-400" : "border-line")}>
                    <span className="truncate">{it.productName} <span className="font-mono text-xs text-slate-500">{it.skuCode}</span></span>
                    <input
                      aria-label={`Corrigir leitura de ${it.skuCode}`}
                      className={cn(inputClass, "tabular h-7 w-20 text-right")}
                      defaultValue={fmt(scan.counts[skuId])}
                      key={scan.counts[skuId]}
                      onBlur={(e) => e.target.value !== fmt(scan.counts[skuId]) && correct(skuId, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          correct(skuId, (e.target as HTMLInputElement).value);
                          scanRef.current?.focus();
                        }
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
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
                  <td>
                    <span className="block">{i.productName}</span>
                    <span className="font-mono text-xs text-slate-500">SKU {i.skuCode}</span>
                    {lotsEnabled && i.lotControl && (
                      <button type="button" onClick={() => setLotOpen(lotOpen === i.skuId ? null : i.skuId)} className="ml-2 inline-flex items-center gap-1 rounded px-1 text-xs text-brand-700 hover:bg-brand-50" aria-expanded={lotOpen === i.skuId}>
                        <Layers className="size-3" /> {i.lotCounts?.length ? `${i.lotCounts.length} lote(s) contado(s)` : "contar por lote"}
                      </button>
                    )}
                    {lotOpen === i.skuId && (
                      <div className="mt-2 rounded-md border border-line bg-slate-50 p-2">
                        <p className="mb-1 text-[11px] text-slate-500">Quantidade por lote; o que não fechar com o total do item fica “sem lote”. Lotes do sistema: {(i.lots ?? []).map((l) => `${l.lot} (${fmt(l.qty)})`).join(", ") || "nenhum"}.</p>
                        {lotDrafts(i).map((l, k) => (
                          <div key={k} className="mb-1 flex items-center gap-1">
                            <input aria-label="Lote" placeholder="Lote" disabled={!editable} className={cn(inputClass, "h-7 w-24 font-mono text-xs")} value={l.lot} onChange={(e) => setLots(i, lotDrafts(i).map((x, j) => (j === k ? { ...x, lot: e.target.value } : x)))} />
                            <input aria-label="Validade" type="date" disabled={!editable} className={cn(inputClass, "h-7 w-32 text-xs")} value={l.expiry} onChange={(e) => setLots(i, lotDrafts(i).map((x, j) => (j === k ? { ...x, expiry: e.target.value } : x)))} />
                            <input aria-label="Quantidade do lote" inputMode="decimal" placeholder="Qtd." disabled={!editable} className={cn(inputClass, "tabular h-7 w-20 text-right text-xs")} value={l.qty} onChange={(e) => setLots(i, lotDrafts(i).map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} />
                            {editable && <button type="button" aria-label="Remover lote" className="rounded p-1 text-slate-400 hover:text-red-700" onClick={() => setLots(i, lotDrafts(i).filter((_, j) => j !== k))}><Trash2 className="size-3.5" /></button>}
                          </div>
                        ))}
                        {editable && <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => setLots(i, [...lotDrafts(i), { lot: "", expiry: "", qty: "" }])}><Plus className="size-3" /> lote</button>}
                      </div>
                    )}
                  </td>
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
                  <td className={cn("tabular whitespace-nowrap text-right", (i.differenceValue ?? 0) < 0 ? "text-red-700" : (i.differenceValue ?? 0) > 0 ? "text-emerald-700" : "text-slate-400")}>{i.differenceValue == null ? "—" : formatMoney(i.differenceValue)}</td>
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
