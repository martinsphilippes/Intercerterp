"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCheck, EyeOff, HandCoins, Link2, Link2Off, ListChecks, Plus, RotateCcw, Unlink, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer, Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { ignoreTxAction, reconcileAction, restoreTxAction, settleFromTxAction, undoReconciliationAction } from "../actions";
import { brl, dmy, settlementFromTx } from "../_components/calc";

export interface WEntry {
  id: string;
  date: string;
  description: string;
  amount: number;
  reconciled: boolean;
  kindLabel: string;
  href: string | null;
  ref: string | null;
}

export interface WRow {
  id: string;
  date: string;
  description: string;
  docNumber: string | null;
  externalId: string | null;
  kind: string;
  amount: number;
  status: string;
  state: "reconciled" | "ignored" | "suggested" | "divergent" | "settle" | "unmatched";
  lineNo: number | null;
  notes: string | null;
  linked: WEntry[];
  reconciliationId: string | null;
  reconciledAt: string | null;
  suggestion: { entryIds: string[]; score: number; reasons: string[]; difference: number } | null;
  alternatives: Array<{ entryIds: string[]; score: number; reasons: string[]; difference: number }>;
  installmentId: string | null;
  paidAmount: number | null;
  feeAmount: number | null;
  interestAmount: number | null;
  discountAmount: number | null;
  ourNumber: string | null;
  yourNumber: string | null;
  occurrence: string | null;
}

export interface WInst {
  id: string;
  kind: "receivable" | "payable";
  label: string;
  party: string;
  dueDate: string;
  balance: number;
  approved: boolean;
}

type Opt = { value: string; label: string };

function call(fd: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fd)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

const STATE_ICON: Record<WRow["state"], { icon: React.ReactNode; cls: string; label: string }> = {
  reconciled: { icon: <Link2 className="size-4" />, cls: "bg-emerald-50 text-emerald-700", label: "Conciliado" },
  suggested: { icon: <Wand2 className="size-4" />, cls: "bg-sky-50 text-sky-700", label: "Sugestão (não confirmada)" },
  settle: { icon: <HandCoins className="size-4" />, cls: "bg-sky-50 text-sky-700", label: "Parcela localizada" },
  divergent: { icon: <AlertTriangle className="size-4" />, cls: "bg-amber-50 text-amber-700", label: "Divergência" },
  unmatched: { icon: <Link2Off className="size-4" />, cls: "bg-slate-100 text-slate-500", label: "Sem correspondência" },
  ignored: { icon: <EyeOff className="size-4" />, cls: "bg-slate-100 text-slate-500", label: "Ignorado" },
};

/**
 * Área de conciliação (Tela 25): extrato × lançamentos do ERP. Sugestões são apenas propostas — só viram
 * conciliação com “Confirmar”. Correspondências 1:1, 1:N e N:1, diferença como tarifa/ajuste, baixa de parcela a partir da linha.
 */
export function Workspace({
  accountId,
  rows,
  entries,
  installments,
  categories,
  feeCategoryId,
  methods,
  windowDays,
  canWrite,
  writeBlock,
}: {
  accountId: string;
  rows: WRow[];
  entries: WEntry[];
  installments: WInst[];
  categories: Opt[];
  feeCategoryId: string | null;
  methods: Opt[];
  windowDays: number;
  canWrite: boolean;
  writeBlock: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState<string[]>([]);
  const [manual, setManual] = useState<{ txIds: string[]; entryIds: string[] } | null>(null);
  const [settle, setSettle] = useState<WRow | null>(null);
  const [adjust, setAdjust] = useState<WRow | null>(null);
  const entryMap = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const batchable = rows.filter((r) => r.state === "suggested" && r.suggestion);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast("error", res.error ?? `${label}: falhou`);
      else toast("success", res.message ?? label);
      router.refresh();
    });

  const confirm = (r: WRow, entryIds: string[]) => run("Conciliado", () => reconcileAction(call({ accountId, bankTxIds: JSON.stringify([r.id]), entryIds: JSON.stringify(entryIds), _idem: `sug:${r.id}:${crypto.randomUUID()}` })));

  const confirmBatch = () =>
    start(async () => {
      let ok = 0;
      const errors: string[] = [];
      for (const r of batchable.filter((x) => checked.includes(x.id))) {
        const res = await reconcileAction(call({ accountId, bankTxIds: JSON.stringify([r.id]), entryIds: JSON.stringify(r.suggestion!.entryIds), _idem: `sug:${r.id}:${crypto.randomUUID()}` }));
        if (res.ok) ok++;
        else errors.push(`${r.description}: ${res.error}`);
      }
      if (ok) toast("success", `${ok} conciliação(ões) confirmada(s).`);
      if (errors.length) toast("error", errors.join(" · "));
      setChecked([]);
      router.refresh();
    });

  return (
    <div>
      {batchable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <span>
            <Wand2 className="mr-1 inline size-4" /> {batchable.length} sugestão(ões) com valor exato aguardando confirmação. Sugestão não é conciliação: confirme por linha ou selecione e confirme em lote.
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setChecked(checked.length === batchable.length ? [] : batchable.map((r) => r.id))}>
              <ListChecks className="size-4" /> {checked.length === batchable.length ? "Limpar seleção" : "Selecionar todas"}
            </Button>
            <Button size="sm" variant="accent" disabled={!checked.length || pending || !canWrite} loading={pending} onClick={confirmBatch} title={writeBlock ?? undefined}>
              <CheckCheck className="size-4" /> Confirmar conciliações ({checked.length})
            </Button>
          </span>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center text-sm text-slate-500">Nenhuma linha de extrato neste recorte. Importe o extrato da conta ou ajuste o período/aba.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const st = STATE_ICON[r.state];
            const sugEntries = (r.suggestion?.entryIds ?? []).map((id) => entryMap.get(id)).filter(Boolean) as WEntry[];
            const inst = r.installmentId ? installments.find((i) => i.id === r.installmentId) : null;
            return (
              <li key={r.id} className={cn("grid items-stretch gap-2 rounded-lg border bg-white p-2 lg:grid-cols-[24px_minmax(0,1fr)_36px_minmax(0,1fr)_auto]", r.state === "divergent" ? "border-amber-200" : "border-line")}>
                <div className="flex items-center justify-center">
                  {r.state === "suggested" && r.suggestion && (
                    <input type="checkbox" aria-label="Selecionar para confirmar em lote" className="size-4 accent-brand-700" checked={checked.includes(r.id)} onChange={(e) => setChecked((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))} />
                  )}
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {r.kind === "statement" ? "Extrato bancário" : r.kind === "collection" ? "Retorno de cobrança — liquidação" : "Retorno de cobrança — tarifa"}
                    {r.lineNo ? ` · linha ${r.lineNo}` : ""}
                  </p>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">{dmy(r.date)}</p>
                      <p className="truncate text-sm font-medium text-ink" title={r.description}>
                        {r.description}
                      </p>
                      <p className="truncate text-xs text-slate-500">{[r.docNumber && `Doc. ${r.docNumber}`, r.externalId && `ID ${r.externalId}`, r.ourNumber && `Nosso nº ${r.ourNumber}`, r.yourNumber && `Seu nº ${r.yourNumber}`].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <p className={cn("tabular whitespace-nowrap text-sm font-semibold", r.amount > 0 ? "text-emerald-700" : "text-red-700")}>
                      {r.amount > 0 ? "+ " : "− "}
                      {brl(Math.abs(r.amount))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-center" title={st.label}>
                  <span className={cn("inline-flex size-8 items-center justify-center rounded-full", st.cls)}>{st.icon}</span>
                </div>
                <div className={cn("rounded-md px-3 py-2", r.state === "unmatched" || r.state === "ignored" ? "border border-dashed border-slate-300" : "bg-slate-50")}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Lançamento no ERP</p>
                  {r.state === "reconciled" ? (
                    <EntryList list={r.linked} footer={<span className="text-emerald-700">Conciliado{r.reconciledAt ? ` em ${new Date(r.reconciledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}</span>} />
                  ) : r.state === "ignored" ? (
                    <p className="text-sm text-slate-500">Ignorado: {r.notes ?? "—"}</p>
                  ) : (r.state === "suggested" || r.state === "divergent") && r.suggestion ? (
                    <EntryList
                      list={sugEntries}
                      footer={
                        <>
                          <span className="text-sky-700">Sugestão {Math.min(100, Math.round((r.suggestion.score / 105) * 100))}% — {r.suggestion.reasons.join(", ")}</span>
                          {r.suggestion.difference !== 0 && <span className="ml-2 font-medium text-red-700">Diferença identificada: {brl(r.suggestion.difference)}</span>}
                        </>
                      }
                    />
                  ) : r.state === "settle" && inst ? (
                    <div className="text-sm">
                      <p className="font-medium">{inst.label}</p>
                      <p className="text-xs text-slate-500">
                        {inst.party} · vence {dmy(inst.dueDate)} · saldo {brl(inst.balance)}
                      </p>
                      <p className="mt-1 text-xs text-sky-700">Parcela localizada pelo nosso/seu número — baixe para criar o recebimento e conciliar.</p>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1 py-2 text-sm text-slate-500">Nenhum lançamento correspondente no ERP</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1 lg:flex-col lg:items-stretch lg:justify-center">
                  {r.state === "reconciled" && r.reconciliationId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWrite || pending}
                      title={writeBlock ?? "Desfazer conciliação (baixas e lançamentos permanecem)"}
                      onClick={() => {
                        const reason = window.prompt("Motivo para desfazer a conciliação:");
                        if (!reason?.trim()) return;
                        run("Conciliação desfeita", () => undoReconciliationAction(r.reconciliationId!, call({ reason })));
                      }}
                    >
                      <Unlink className="size-4" /> Desfazer
                    </Button>
                  )}
                  {r.state === "suggested" && r.suggestion && (
                    <Button size="sm" variant="primary" disabled={!canWrite || pending} title={writeBlock ?? "Confirmar a correspondência sugerida"} onClick={() => confirm(r, r.suggestion!.entryIds)}>
                      <Check className="size-4" /> Confirmar
                    </Button>
                  )}
                  {r.state === "divergent" && r.suggestion && (
                    <Button size="sm" variant="secondary" disabled={!canWrite || pending} title={writeBlock ?? "Conciliar lançando a diferença como tarifa/ajuste"} onClick={() => setManual({ txIds: [r.id], entryIds: r.suggestion!.entryIds })}>
                      <AlertTriangle className="size-4" /> Tratar diferença
                    </Button>
                  )}
                  {(r.state === "settle" || r.state === "unmatched") && (r.kind !== "collection_fee") && (
                    <Button size="sm" variant={r.state === "settle" ? "primary" : "secondary"} disabled={!canWrite || pending} title={writeBlock ?? "Baixar uma parcela a partir desta linha (cria a baixa e já concilia)"} onClick={() => setSettle(r)}>
                      <HandCoins className="size-4" /> Baixar parcela
                    </Button>
                  )}
                  {(r.state === "unmatched" || r.state === "divergent") && (
                    <Button size="sm" variant="ghost" disabled={!canWrite || pending} title={writeBlock ?? "Criar lançamento no ERP (tarifa/ajuste) e conciliar"} onClick={() => setAdjust(r)}>
                      <Plus className="size-4" /> Lançar e conciliar
                    </Button>
                  )}
                  {r.status === "pending" && (
                    <Button size="sm" variant="ghost" disabled={!canWrite || pending} title={writeBlock ?? "Escolher lançamentos manualmente (1:1, 1:N, N:1)"} onClick={() => setManual({ txIds: [r.id], entryIds: r.suggestion?.entryIds ?? [] })}>
                      <Link2 className="size-4" /> Manual
                    </Button>
                  )}
                  {r.status === "pending" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canWrite || pending}
                      title={writeBlock ?? "Ignorar linha (informativa/duplicada)"}
                      onClick={() => {
                        const reason = window.prompt("Motivo para ignorar a linha (ex.: crédito agregado já conciliado pelo retorno de cobrança):");
                        if (!reason?.trim()) return;
                        run("Linha ignorada", () => ignoreTxAction(r.id, call({ reason })));
                      }}
                    >
                      <EyeOff className="size-4" /> Ignorar
                    </Button>
                  )}
                  {r.status === "ignored" && (
                    <Button size="sm" variant="ghost" disabled={!canWrite || pending} onClick={() => run("Linha reativada", () => restoreTxAction(r.id))}>
                      <RotateCcw className="size-4" /> Reativar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {manual && <ManualPanel accountId={accountId} rows={rows} entries={entries} categories={categories} feeCategoryId={feeCategoryId} initial={manual} windowDays={windowDays} onClose={() => setManual(null)} />}
      {settle && <SettleFromTx row={settle} installments={installments} methods={methods} onClose={() => setSettle(null)} />}
      {adjust && <AdjustDialog accountId={accountId} row={adjust} categories={categories} feeCategoryId={feeCategoryId} onClose={() => setAdjust(null)} />}
    </div>
  );
}

function EntryList({ list, footer }: { list: WEntry[]; footer?: React.ReactNode }) {
  return (
    <div>
      {list.map((e) => (
        <div key={e.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink" title={e.description}>
              {e.href ? (
                <Link className="hover:text-brand-700 hover:underline" href={e.href}>
                  {e.description}
                </Link>
              ) : (
                e.description
              )}
            </p>
            <p className="text-xs text-slate-500">
              {dmy(e.date)} · {e.kindLabel}
              {e.ref ? ` · ${e.ref}` : ""}
            </p>
          </div>
          <p className={cn("tabular whitespace-nowrap text-sm font-semibold", e.amount > 0 ? "text-emerald-700" : "text-red-700")}>
            {e.amount > 0 ? "+ " : "− "}
            {brl(Math.abs(e.amount))}
          </p>
        </div>
      ))}
      {footer && <p className="mt-1 text-xs">{footer}</p>}
    </div>
  );
}

/** Seleção manual: uma linha × vários lançamentos (1:N) ou várias linhas × um lançamento (N:1), com diferença tratada. */
function ManualPanel({ accountId, rows, entries, categories, feeCategoryId, initial, windowDays, onClose }: { accountId: string; rows: WRow[]; entries: WEntry[]; categories: Opt[]; feeCategoryId: string | null; initial: { txIds: string[]; entryIds: string[] }; windowDays: number; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const idem = useIdemKey();
  const [pending, start] = useTransition();
  const [txIds, setTxIds] = useState(initial.txIds);
  const [entryIds, setEntryIds] = useState(initial.entryIds);
  const [q, setQ] = useState("");
  const [adj, setAdj] = useState(false);
  const [cat, setCat] = useState(feeCategoryId ?? "");
  const [desc, setDesc] = useState("");
  const [notes, setNotes] = useState("");
  const pendingRows = rows.filter((r) => r.status === "pending");
  const free = entries.filter((e) => !e.reconciled);
  const selTx = pendingRows.filter((r) => txIds.includes(r.id));
  const selEn = free.filter((e) => entryIds.includes(e.id));
  const sumTx = selTx.reduce((a, r) => a + r.amount, 0);
  const sumEn = selEn.reduce((a, e) => a + e.amount, 0);
  const diff = sumTx - sumEn;
  const mode = txIds.length > 1 && entryIds.length > 1 ? "N:N (não suportado)" : txIds.length > 1 ? "N:1" : entryIds.length > 1 ? "1:N" : "1:1";
  const ql = q.toLowerCase();
  const sign = Math.sign(sumTx || selTx[0]?.amount || 1);
  const visible = free
    .filter((e) => !ql || e.description.toLowerCase().includes(ql) || brl(Math.abs(e.amount)).includes(q))
    .sort((a, b) => Number(Math.sign(b.amount) === sign) - Number(Math.sign(a.amount) === sign));
  const submit = () =>
    start(async () => {
      const res = await reconcileAction(call({ accountId, bankTxIds: JSON.stringify(txIds), entryIds: JSON.stringify(entryIds), adjust: adj ? "1" : "", categoryId: cat, adjDescription: desc, notes, _idem: idem }));
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Conciliado.");
      onClose();
      router.refresh();
    });
  return (
    <Drawer open onClose={onClose} title="Conciliação manual" width="max-w-3xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Marque as linhas do extrato e os lançamentos do ERP que se correspondem. Combinações: 1:1, 1:N (uma linha × vários lançamentos) ou N:1 (várias linhas × um lançamento). Janela de datas de sugestão: ±{windowDays} dia(s).</p>
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Linhas do extrato pendentes</h3>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {pendingRows.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" className="size-4 accent-brand-700" checked={txIds.includes(r.id)} onChange={(e) => setTxIds((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))} />
                    <span className="text-xs text-slate-500">{dmy(r.date)}</span>
                    <span className="truncate">{r.description}</span>
                  </span>
                  <span className={cn("tabular whitespace-nowrap", r.amount > 0 ? "text-emerald-700" : "text-red-700")}>{brl(r.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase text-slate-500">Lançamentos do ERP não conciliados</h3>
            <Input placeholder="Buscar descrição ou valor" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 max-w-xs" />
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {visible.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nenhum lançamento livre no período (±{windowDays} dias). Use “Baixar parcela” ou “Lançar e conciliar”.</li>}
            {visible.map((e) => (
              <li key={e.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-slate-50">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" className="size-4 accent-brand-700" checked={entryIds.includes(e.id)} onChange={(ev) => setEntryIds((x) => (ev.target.checked ? [...x, e.id] : x.filter((y) => y !== e.id)))} />
                    <span className="text-xs text-slate-500">{dmy(e.date)}</span>
                    <span className="truncate">{e.description}</span>
                  </span>
                  <span className={cn("tabular whitespace-nowrap", e.amount > 0 ? "text-emerald-700" : "text-red-700")}>{brl(e.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Extrato ({txIds.length})</p>
            <p className="tabular font-semibold">{brl(sumTx)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">ERP ({entryIds.length})</p>
            <p className="tabular font-semibold">{brl(sumEn)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Diferença</p>
            <p className={cn("tabular font-semibold", diff ? "text-red-700" : "text-emerald-700")}>{brl(diff)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Tipo</p>
            <p className="font-semibold">{mode}</p>
          </div>
        </div>
        {diff !== 0 && (
          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-700" checked={adj} onChange={(e) => setAdj(e.target.checked)} />
              Lançar a diferença de {brl(diff)} como {diff < 0 ? "tarifa/taxa" : "ajuste de entrada"} e conciliar junto
            </label>
            {adj && (
              <FormGrid cols={2}>
                <Field label="Categoria">
                  <Select value={cat} onChange={(e) => setCat(e.target.value)} options={categories} placeholder="—" />
                </Field>
                <Field label="Descrição do lançamento">
                  <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={diff < 0 ? "Tarifa bancária" : "Ajuste de conciliação"} />
                </Field>
              </FormGrid>
            )}
          </div>
        )}
        <Field label="Observação">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="accent" loading={pending} disabled={!txIds.length || (!entryIds.length && !adj) || (diff !== 0 && !adj) || mode.startsWith("N:N")} onClick={submit}>
            <Check className="size-4" /> Confirmar conciliação
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

/** Baixa de parcela a partir da linha (extrato ou retorno CNAB): cria a baixa e concilia. */
function SettleFromTx({ row, installments, methods, onClose }: { row: WRow; installments: WInst[]; methods: Opt[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const idem = useIdemKey();
  const [pending, start] = useTransition();
  const kind = row.amount > 0 ? "receivable" : "payable";
  const options = installments.filter((i) => i.kind === kind).sort((a, b) => Math.abs(a.balance - Math.abs(row.amount)) - Math.abs(b.balance - Math.abs(row.amount)));
  const [instId, setInstId] = useState(row.installmentId && options.some((o) => o.id === row.installmentId) ? row.installmentId : (options[0]?.id ?? ""));
  const [q, setQ] = useState("");
  const inst = options.find((o) => o.id === instId) ?? null;
  const sugg = inst ? settlementFromTx(row, inst.balance) : { principal: 0, interest: 0, fine: 0, discount: 0, fee: 0 };
  const [vals, setVals] = useState(sugg);
  const [methodId, setMethodId] = useState("");
  const pick = (id: string) => {
    setInstId(id);
    const i = options.find((o) => o.id === id);
    if (i) setVals(settlementFromTx(row, i.balance));
  };
  const sign = kind === "receivable" ? 1 : -1;
  const net = sign * (vals.principal - vals.discount + vals.interest + vals.fine) - vals.fee;
  const ql = q.toLowerCase();
  const shown = options.filter((o) => !ql || `${o.label} ${o.party}`.toLowerCase().includes(ql) || brl(o.balance).includes(q)).slice(0, 80);
  const submit = () =>
    start(async () => {
      const res = await settleFromTxAction(call({ bankTxId: row.id, installmentId: instId, principal: String(vals.principal), interest: String(vals.interest), fine: String(vals.fine), discount: String(vals.discount), fee: String(vals.fee), methodId, _idem: idem }));
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Baixado e conciliado.");
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onClose={onClose} title={`Baixar parcela a partir da linha — ${brl(row.amount)}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {dmy(row.date)} · {row.description}
        </p>
        <Field label={kind === "receivable" ? "Parcela a receber" : "Parcela a pagar (autorizada)"}>
          <Input placeholder="Buscar cliente/fornecedor, nº do título ou valor" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
          <select className="focus-ring block h-40 w-full rounded-md border border-line bg-white px-2 py-1 text-sm" size={6} value={instId} onChange={(e) => pick(e.target.value)} aria-label="Parcela">
            {shown.map((o) => (
              <option key={o.id} value={o.id} disabled={o.kind === "payable" && !o.approved}>
                {o.label} — {o.party} — vence {dmy(o.dueDate)} — saldo {brl(o.balance)}
                {o.kind === "payable" && !o.approved ? " (a autorizar)" : ""}
              </option>
            ))}
          </select>
        </Field>
        {inst && (
          <>
            <FormGrid cols={3}>
              <Field label="Principal (abate o saldo)">
                <MoneyInput value={vals.principal} onChange={(v) => setVals({ ...vals, principal: v })} />
              </Field>
              <Field label="Juros">
                <MoneyInput value={vals.interest} onChange={(v) => setVals({ ...vals, interest: v })} />
              </Field>
              <Field label="Multa">
                <MoneyInput value={vals.fine} onChange={(v) => setVals({ ...vals, fine: v })} />
              </Field>
              <Field label="Desconto">
                <MoneyInput value={vals.discount} onChange={(v) => setVals({ ...vals, discount: v })} />
              </Field>
              <Field label="Tarifa (lançamento separado)">
                <MoneyInput value={vals.fee} onChange={(v) => setVals({ ...vals, fee: v })} />
              </Field>
              <Field label="Forma">
                <Select value={methodId} onChange={(e) => setMethodId(e.target.value)} options={methods} placeholder={row.kind === "collection" ? "Boleto (padrão)" : "—"} />
              </Field>
            </FormGrid>
            <div className={cn("flex items-center justify-between rounded-md px-4 py-2 text-sm", net === row.amount ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
              <span>Líquido na conta = {kind === "receivable" ? "" : "−("}principal − desconto + juros + multa{kind === "receivable" ? "" : ")"} − tarifa</span>
              <span className="tabular font-semibold">
                {brl(net)} {net === row.amount ? "= linha" : `≠ linha (${brl(row.amount)})`}
              </span>
            </div>
            {vals.principal > inst.balance && <Notice tone="warn">Principal maior que o saldo da parcela ({brl(inst.balance)}). Lance o excedente como juros.</Notice>}
          </>
        )}
        {!options.length && <Notice tone="info">Nenhuma parcela {kind === "receivable" ? "a receber" : "a pagar"} em aberto.</Notice>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="accent" loading={pending} disabled={!inst || net !== row.amount || vals.principal <= 0 || vals.principal > (inst?.balance ?? 0)} onClick={submit}>
            <HandCoins className="size-4" /> Baixar e conciliar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Linha sem correspondência (ex.: tarifa bancária): cria o lançamento explícito no ERP e concilia. */
function AdjustDialog({ accountId, row, categories, feeCategoryId, onClose }: { accountId: string; row: WRow; categories: Opt[]; feeCategoryId: string | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const idem = useIdemKey();
  const [pending, start] = useTransition();
  const [cat, setCat] = useState(row.amount < 0 ? (feeCategoryId ?? "") : "");
  const [desc, setDesc] = useState(row.description);
  const submit = () =>
    start(async () => {
      const entryIds = row.state === "divergent" && row.suggestion ? row.suggestion.entryIds : [];
      const res = await reconcileAction(call({ accountId, bankTxIds: JSON.stringify([row.id]), entryIds: JSON.stringify(entryIds), adjust: "1", categoryId: cat, adjDescription: desc, _idem: idem }));
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Lançado e conciliado.");
      onClose();
      router.refresh();
    });
  const amount = row.state === "divergent" && row.suggestion ? row.suggestion.difference : row.amount;
  return (
    <Dialog open onClose={onClose} title="Lançar no ERP e conciliar" size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Cria um lançamento de {amount < 0 ? "tarifa/taxa (saída)" : "ajuste (entrada)"} de <b>{brl(amount)}</b> na conta, em {dmy(row.date)}, já conciliado com a linha “{row.description}”.
          {row.state === "divergent" && " A diferença é lançada e a correspondência sugerida é confirmada junto."}
        </p>
        <Field label="Categoria">
          <Select value={cat} onChange={(e) => setCat(e.target.value)} options={categories} placeholder="—" />
        </Field>
        <Field label="Descrição">
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="accent" loading={pending} onClick={submit}>
            <Plus className="size-4" /> Lançar e conciliar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
