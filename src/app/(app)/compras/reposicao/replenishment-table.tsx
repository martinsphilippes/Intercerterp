"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { QtyInput, MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty, lineTotal } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { createDraftsAction, quotationFromReplenishmentAction } from "./actions";

export interface RepRow {
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  abc: string | null;
  available: number;
  physical: number;
  reserved: number;
  minQty: number;
  target: number;
  confirmedInHorizon: number;
  confirmedOutside: number;
  draftQty: number;
  grossNeed: number;
  suggested: number;
  situation: string;
  limitation: string | null;
  hasHistory: boolean;
  avgDaily: number;
  horizonDays: number;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: number;
  supplierMinQty: number;
  multiple: number;
  stockoutDate: string | null;
  nextArrival: string | null;
  supplierOptions: Array<{ supplierId: string; name: string; lastCost: number | null; leadTimeDays: number | null }>;
  /** fornecedores vinculados que não podem ser usados (bloqueado/inativo/pendente) — só informativo */
  unavailableSuppliers?: Array<{ name: string; statusLabel: string; statusReason: string | null }>;
}

interface Sel {
  qty: number;
  supplierId: string | null;
  unitCost: number;
  name: string;
  sku: string;
  unitCode: string;
  supplierName: string | null;
}

export function ReplenishmentTable({ rows, branchId, branchName, coverageDays, detailQs, highlight }: { rows: RepRow[]; branchId: string; branchName: string; coverageDays: number; detailQs: string; highlight?: string | null }) {
  const storageKey = `ic.rep.sel.${branchId}`;
  const [sel, setSel] = useState<Record<string, Sel>>({});
  const [edits, setEdits] = useState<Record<string, { qty?: number; supplierId?: string; unitCost?: number }>>({});
  const [review, setReview] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(storageKey);
      if (v) setSel(JSON.parse(v));
    } catch {
      /* sem armazenamento */
    }
  }, [storageKey]);
  const persist = (next: Record<string, Sel>) => {
    setSel(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const view = (r: RepRow) => {
    const e = edits[r.skuId] ?? {};
    const s = sel[r.skuId];
    const supplierId = e.supplierId ?? s?.supplierId ?? r.supplierId;
    const opt = r.supplierOptions.find((o) => o.supplierId === supplierId);
    const unitCost = e.unitCost ?? s?.unitCost ?? (supplierId === r.supplierId ? r.unitCost : opt?.lastCost ?? r.unitCost);
    const qty = e.qty ?? s?.qty ?? r.suggested;
    return { supplierId, unitCost, qty, supplierName: opt?.name ?? r.supplierName };
  };
  const toSel = (r: RepRow, patch: Partial<Sel> = {}): Sel => {
    const v = view(r);
    return { qty: v.qty, supplierId: v.supplierId, unitCost: v.unitCost, name: r.name, sku: r.sku, unitCode: r.unitCode, supplierName: v.supplierName, ...patch };
  };
  const update = (r: RepRow, patch: { qty?: number; supplierId?: string; unitCost?: number }) => {
    setEdits((e) => ({ ...e, [r.skuId]: { ...e[r.skuId], ...patch } }));
    if (sel[r.skuId]) {
      const opt = patch.supplierId ? r.supplierOptions.find((o) => o.supplierId === patch.supplierId) : null;
      persist({ ...sel, [r.skuId]: { ...sel[r.skuId], ...patch, ...(opt ? { supplierName: opt.name, unitCost: patch.unitCost ?? opt.lastCost ?? sel[r.skuId].unitCost } : {}) } });
    }
  };
  const selected = Object.entries(sel);
  const selTotal = selected.reduce((a, [, s]) => a + lineTotal(s.unitCost, s.qty), 0);
  const visibleIds = rows.map((r) => r.skuId);
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => sel[id]);
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: Array<[string, Sel]>; total: number }>();
    for (const [id, s] of selected) {
      const k = s.supplierId ?? "";
      const g = m.get(k) ?? { name: s.supplierName ?? "Fornecedor a definir", items: [], total: 0 };
      g.items.push([id, s]);
      g.total += lineTotal(s.unitCost, s.qty);
      m.set(k, g);
    }
    return [...m.entries()];
  }, [selected]);
  const lines = () => selected.map(([skuId, s]) => ({ skuId, qty: s.qty, supplierId: s.supplierId ?? "", unitCost: s.unitCost }));
  const run = (kind: "drafts" | "quotation") =>
    start(async () => {
      const fd = new FormData();
      fd.set("branchId", branchId);
      fd.set("coverageDays", String(coverageDays));
      fd.set("lines", JSON.stringify(lines()));
      fd.set("_idem", `${idem}:${kind}`);
      const res = kind === "drafts" ? await createDraftsAction(fd) : await quotationFromReplenishmentAction(fd);
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Concluído.");
      persist({});
      setReview(false);
      if (res.redirect) router.push(res.redirect);
      else router.refresh();
    });
  const missing = selected.filter(([, s]) => !s.supplierId || !s.qty);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-brand-700" checked={allVisible} onChange={(e) => persist(e.target.checked ? { ...sel, ...Object.fromEntries(rows.map((r) => [r.skuId, sel[r.skuId] ?? toSel(r)])) } : Object.fromEntries(selected.filter(([id]) => !visibleIds.includes(id))))} />
          Selecionar visíveis
        </label>
        <span className="text-xs text-slate-500">Quantidades na unidade do produto · custos estimados (último custo do fornecedor)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th className="w-8" />
              <th>Produto / fornecedor</th>
              <th>Estoque e pedidos</th>
              <th className="text-right">Sugestão</th>
              <th className="w-32 text-right">Comprar</th>
              <th className="w-56">Fornecedor</th>
              <th className="text-right">Estimativa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = view(r);
              const total = v.unitCost ? lineTotal(v.unitCost, v.qty) : null;
              return (
                <tr key={r.skuId} className={cn(highlight === r.skuId && "bg-accent-50")}>
                  <td><input type="checkbox" aria-label={`Selecionar ${r.name}`} className="accent-brand-700" checked={Boolean(sel[r.skuId])} onChange={(e) => persist(e.target.checked ? { ...sel, [r.skuId]: toSel(r) } : Object.fromEntries(selected.filter(([id]) => id !== r.skuId)))} /></td>
                  <td>
                    <Link className="font-medium text-brand-700 hover:underline" href={`/compras/reposicao/${r.skuId}${detailQs}`}>{r.name}</Link>
                    <span className="block text-xs text-slate-500">{r.sku} · ABC {r.abc ?? "—"} · {r.supplierName ?? "Fornecedor a definir"}</span>
                  </td>
                  <td className="text-xs">
                    <span className="block"><b className="tabular text-sm">{formatQty(r.available)}</b> disponível(is){r.reserved ? ` (${formatQty(r.reserved)} reservado)` : ""}</span>
                    <span className="block">{formatQty(r.confirmedInHorizon)} confirmado(s) no horizonte ({r.horizonDays} d)</span>
                    {r.confirmedOutside > 0 && <span className="block text-amber-700"><AlertTriangle className="inline size-3" /> Entrega fora do horizonte: {formatQty(r.confirmedOutside)}</span>}
                    {r.draftQty > 0 && <span className="block text-slate-500">Em rascunho/análise: {formatQty(r.draftQty)} (não conta como estoque)</span>}
                  </td>
                  <td className="text-right">
                    <span className="tabular font-semibold">{formatQty(r.suggested, r.unitCode)}</span>
                    <span className="block text-xs text-slate-500">Alvo: {formatQty(r.target, r.unitCode)}</span>
                    <span className="mt-0.5 inline-block"><StatusBadge kind="replenishment" status={r.situation} /></span>
                    {!r.hasHistory && <span className="block text-[11px] text-amber-700" title={r.limitation ?? ""}>sem histórico</span>}
                  </td>
                  <td>
                    <QtyInput value={v.qty} onChange={(q) => update(r, { qty: q })} ariaLabel={`Comprar de ${r.name}`} min={0} />
                    {v.qty === r.suggested ? <span className="block text-right text-[11px] text-slate-500">Sugestão aplicada</span> : <button type="button" className="block w-full text-right text-[11px] text-brand-700 underline" onClick={() => update(r, { qty: r.suggested })}>Usar sugestão</button>}
                  </td>
                  <td>
                    {r.supplierOptions.length ? (
                      <Select aria-label={`Fornecedor de ${r.name}`} value={v.supplierId ?? ""} onChange={(e) => update(r, { supplierId: e.target.value, unitCost: r.supplierOptions.find((o) => o.supplierId === e.target.value)?.lastCost ?? v.unitCost })} options={r.supplierOptions.map((o) => ({ value: o.supplierId, label: `${o.name}${o.leadTimeDays != null ? ` · ${o.leadTimeDays} d` : ""}` }))} />
                    ) : (
                      <Link className="text-xs text-accent-700 underline" href={`/fornecedores`}>{r.unavailableSuppliers?.length ? "Vincular fornecedor ativo" : "Vincular fornecedor"}</Link>
                    )}
                    {(r.unavailableSuppliers ?? []).map((u) => (
                      <span key={u.name} className="block text-[11px] text-amber-700" title={u.statusReason ?? undefined}>
                        {u.name}: {u.statusLabel}{u.statusReason ? ` (${u.statusReason})` : ""} — fora da escolha
                      </span>
                    ))}
                    <div className="mt-1"><MoneyInput value={v.unitCost} onChange={(c) => update(r, { unitCost: c })} ariaLabel={`Custo de ${r.name}`} className="h-8 text-xs" /></div>
                  </td>
                  <td className="text-right">
                    {total != null ? <span className="tabular font-medium">{formatMoney(total)}</span> : "—"}
                    <span className="block text-xs text-slate-500">{v.unitCost ? `${formatMoney(v.unitCost)} / ${r.unitCode}` : "Custo não informado"}</span>
                    {r.stockoutDate && r.situation === "risk" && <span className="block text-[11px] text-red-700">ruptura prevista {formatDate(r.stockoutDate)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-3 py-2 text-xs text-slate-500">{rows.length} produto(s) exibido(s) · a seleção pode incluir itens fora do filtro.</div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50 px-3 py-3">
        <div className="text-sm">
          <b>{selected.length}</b> selecionado(s) · <b className="tabular">{formatMoney(selTotal)}</b>
          <span className="block text-xs text-slate-500">Destino: {branchName} · sem frete e encargos adicionais.</span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!selected.length} onClick={() => persist({})}>Limpar seleção</Button>
          <Button variant="accent" disabled={!selected.length} onClick={() => setReview(true)}><ClipboardCheck className="size-4" /> Revisar selecionados</Button>
        </div>
      </div>
      <Dialog open={review} onClose={() => setReview(false)} title="Revisar compra por fornecedor" size="xl" footer={
        <>
          <Button variant="ghost" onClick={() => setReview(false)}>Voltar e ajustar</Button>
          <Button variant="secondary" loading={pending} disabled={!selected.length} onClick={() => run("quotation")}>Criar cotação com os selecionados</Button>
          <Button variant="accent" loading={pending} disabled={!selected.length || missing.length > 0} onClick={() => run("drafts")}>Criar {groups.length} rascunho(s) por fornecedor</Button>
        </>
      }>
        {missing.length > 0 && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{missing.length} item(ns) sem fornecedor ou quantidade — ajuste antes de criar rascunhos (ou crie uma cotação).</p>}
        <div className="space-y-4">
          {groups.map(([sid, g]) => (
            <section key={sid} className="rounded-md border border-line">
              <header className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-semibold">{g.name}<span className="tabular">{formatMoney(g.total)}</span></header>
              <table className="table-base w-full text-sm">
                <thead><tr><th>Produto</th><th className="text-right">Quantidade</th><th className="text-right">Custo / un.</th><th className="text-right">Subtotal</th></tr></thead>
                <tbody>
                  {g.items.map(([id, s]) => (
                    <tr key={id}><td>{s.name}<span className="block text-xs text-slate-500">{s.sku}</span></td><td className="tabular text-right">{formatQty(s.qty, s.unitCode)}</td><td className="tabular text-right">{formatMoney(s.unitCost)}</td><td className="tabular text-right">{formatMoney(lineTotal(s.unitCost, s.qty))}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Será criado um pedido em rascunho por fornecedor, vinculado a este cálculo (origem: reposição). Nada é enviado ao fornecedor; estoque e financeiro não mudam até o recebimento.</p>
        <Badge className="mt-2">Total da seleção: {formatMoney(selTotal)}</Badge>
      </Dialog>
    </div>
  );
}
