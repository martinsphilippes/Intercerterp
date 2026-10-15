"use client";

import { useState } from "react";
import { FileCode2, PencilLine, Scale } from "lucide-react";
import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid, Textarea } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { invoiceConfirmAction } from "../actions";

export interface EnteredItem {
  idx: number;
  description: string;
  sku: string | null;
  unitCode: string | null;
  qty: number;
  /** custo unitário de entrada (com rateios) previsto */
  unitCost: number;
  /** custo unitário da linha (sem rateios) — sugestão para o lançamento manual */
  lineUnitCost: number;
}

interface Analysis {
  source: "xml" | "manual";
  scheduled: boolean;
  doc: { key: string | null; number: string; series: string | null; issueDate: string; total: number; freight: number; otherExpenses: number; discount: number; supplierName: string; authorized: boolean | null };
  noteItems: Array<{ n: number; cProd: string | null; cEAN: string | null; xProd: string; qty: number; value: number; unitCost: number; match: number | null; matchBy: string | null }>;
  lines: Array<{ idx: number; description: string; enteredQty: number; enteredUnitCost: number; noteQty: number; noteLandedUnitCost: number; costDelta: number; qtyDiff: number; onHand: number; inNote: boolean }>;
  previousPayable: number;
  payable: number;
  installments: Array<{ number: number; dueDate: string; amount: number; source: string }>;
  problems: string[];
  warnings: string[];
}

const MATCH_LABEL: Record<string, string> = { supplier_code: "código do fornecedor", barcode: "GTIN", sku: "SKU", item: "código do item", manual: "manual" };

/**
 * "Confirmar com a nota" (§40): importa o XML (ou dados da nota), casa os itens com o que entrou (código do fornecedor,
 * GTIN ou SKU, com ajuste manual), mostra as diferenças de custo e quantidade e confirma. A confirmação ajusta o custo
 * médio, a quantidade (conforme a decisão) e a conta a pagar pelo valor da nota. Na entrada PREVISTA (`scheduled`), a
 * nota substitui o previsto: sem decisão de quantidade nem ajuste de custo.
 */
export function InvoiceConfirm({ receiptId, items, defaults, returnHref, scheduled = false }: { receiptId: string; items: EnteredItem[]; defaults: { nfeNumber: string | null; nfeSeries: string | null; nfeKey: string | null }; returnHref: string | null; scheduled?: boolean }) {
  const [mode, setMode] = useState<"xml" | "manual">("xml");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [matches, setMatches] = useState<Record<string, number>>({});
  const [actions, setActions] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Record<number, { qty: number; unitCost: number }>>(() => Object.fromEntries(items.map((i) => [i.idx, { qty: i.qty, unitCost: i.lineUnitCost }])));
  const itemOpts = [{ value: "0", label: "Sem correspondência" }, ...items.map((i) => ({ value: String(i.idx), label: `${i.description}${i.sku ? ` (${i.sku})` : ""}` }))];
  const reset = () => setAnalysis(null);
  return (
    <ActionForm action={invoiceConfirmAction} onSuccess={(d) => d && setAnalysis(d as Analysis)} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={receiptId} />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="matchesJson" value={JSON.stringify(matches)} />
          <input type="hidden" name="qtyActionsJson" value={JSON.stringify(actions)} />
          <input type="hidden" name="noteItemsJson" value={JSON.stringify(Object.entries(manual).map(([idx, v]) => ({ idx: Number(idx), qty: v.qty, unitCost: v.unitCost })))} />
          <div role="tablist" className="grid gap-2 sm:grid-cols-2">
            {([["xml", "Importar o XML da nota", "Arquivo da NF-e do fornecedor (recomendado)", FileCode2], ["manual", "Informar os dados da nota", "Número, série, chave e valores por item", PencilLine]] as const).map(([k, label, hint, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); reset(); }} className={cn("focus-ring flex items-start gap-3 rounded-lg border bg-white p-3 text-left", mode === k ? "border-accent-500 ring-1 ring-accent-500" : "border-line hover:border-brand-300")}>
                <Icon className="mt-0.5 size-5 text-brand-700" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </button>
            ))}
          </div>
          {mode === "xml" ? (
            <Field label="Arquivo XML da NF-e (modelo 55)" required hint="Mesmas validações da importação: emitente = fornecedor da entrada, destinatário desta empresa, chave única, não denegada.">
              <input type="file" name="xml" accept=".xml,application/xml,text/xml" onChange={reset} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-800" />
            </Field>
          ) : (
            <>
              <FormGrid cols={4}>
                <Field label="Número da nota" required><Input name="nfeNumber" defaultValue={defaults.nfeNumber ?? ""} inputMode="numeric" onChange={reset} /></Field>
                <Field label="Série"><Input name="nfeSeries" defaultValue={defaults.nfeSeries ?? ""} inputMode="numeric" onChange={reset} /></Field>
                <Field label="Emissão" required><Input name="issueDate" type="date" max={today()} defaultValue={today()} onChange={reset} /></Field>
                <Field label="Chave de acesso"><Input name="nfeKey" defaultValue={defaults.nfeKey ?? ""} inputMode="numeric" onChange={reset} /></Field>
                <Field label="Frete"><MoneyInput name="freight" /></Field>
                <Field label="Outras despesas/IPI/ST"><MoneyInput name="otherExpenses" /></Field>
                <Field label="Desconto da nota"><MoneyInput name="discount" /></Field>
                <Field label="Total da nota" hint="Vazio = soma dos itens e encargos."><MoneyInput name="total" /></Field>
              </FormGrid>
              <div className="-mx-5 overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead><tr><th>{scheduled ? "Item previsto" : "Item que entrou"}</th><th className="text-right">{scheduled ? "Previsto" : "Entrou"}</th><th className="w-32 text-right">Qtd. na nota</th><th className="w-36 text-right">Custo unit. na nota</th></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.idx}>
                        <td className="min-w-[180px]">{i.description}<span className="block text-xs text-slate-500">{i.sku}</span></td>
                        <td className="tabular text-right">{formatQty(i.qty)} × {formatMoney(i.lineUnitCost)}</td>
                        <td><QtyInput value={manual[i.idx]?.qty ?? 0} min={0} ariaLabel={`Quantidade na nota de ${i.description}`} onChange={(v) => { setManual((m) => ({ ...m, [i.idx]: { ...m[i.idx], qty: v } })); reset(); }} /></td>
                        <td><MoneyInput value={manual[i.idx]?.unitCost ?? 0} ariaLabel={`Custo na nota de ${i.description}`} onChange={(v) => { setManual((m) => ({ ...m, [i.idx]: { ...m[i.idx], unitCost: v } })); reset(); }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {analysis && <Comparison a={analysis} itemOpts={itemOpts} matches={matches} setMatches={(m) => { setMatches(m); setAnalysis(null); }} actions={actions} setActions={setActions} returnHref={returnHref} />}
          <Field label="Observações / justificativa" hint={scheduled ? "Obrigatória para XML sem protocolo de autorização." : "Obrigatória para manter diferença de quantidade ou XML sem protocolo de autorização."}>
            <Textarea name="notes" rows={2} />
          </Field>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <SubmitButton pending={pending} name="intent" value="analyze"><Scale className="size-4" /> {scheduled ? "Comparar com o previsto" : "Comparar com a entrada"}</SubmitButton>
            <SubmitButton pending={pending} name="intent" value="confirm" variant="accent" disabled={!analysis || analysis.problems.length > 0}>Confirmar com a nota</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function Comparison({ a, itemOpts, matches, setMatches, actions, setActions, returnHref }: { a: Analysis; itemOpts: Array<{ value: string; label: string }>; matches: Record<string, number>; setMatches: (m: Record<string, number>) => void; actions: Record<string, string>; setActions: (f: (m: Record<string, string>) => Record<string, string>) => void; returnHref: string | null }) {
  const qtyLines = a.lines.filter((l) => l.qtyDiff !== 0);
  return (
    <section aria-label="Comparação nota × entrada" className="space-y-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <strong>NF-e {a.doc.number}{a.doc.series ? `/${a.doc.series}` : ""}</strong> · {a.doc.supplierName} · emissão {formatDate(a.doc.issueDate)}
          {a.source === "xml" && (a.doc.authorized ? <Badge tone="good" className="ml-2">Autorizada</Badge> : <Badge tone="warn" className="ml-2">Sem protocolo</Badge>)}
        </span>
        <span>Conta a pagar: <span className="tabular">{formatMoney(a.previousPayable)}</span> → <strong className="tabular">{formatMoney(a.payable)}</strong></span>
      </div>
      {a.source === "xml" && (
        <div className="-mx-3 overflow-x-auto">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Item da nota</th><th className="text-right">Qtd.</th><th className="text-right">Valor</th><th>Corresponde a</th></tr></thead>
            <tbody>
              {a.noteItems.map((n) => (
                <tr key={n.n}>
                  <td className="min-w-[180px]">{n.xProd}<span className="block text-xs text-slate-500">{n.cProd ?? "—"}{n.cEAN ? ` · GTIN ${n.cEAN}` : ""}{n.matchBy ? ` · por ${MATCH_LABEL[n.matchBy] ?? n.matchBy}` : ""}</span></td>
                  <td className="tabular text-right">{formatQty(n.qty)}</td>
                  <td className="tabular text-right">{formatMoney(n.value)}</td>
                  <td className="min-w-[200px]">
                    <Select aria-label={`Item da entrada para ${n.xProd}`} value={String(matches[String(n.n)] ?? n.match ?? 0)} options={itemOpts} onChange={(e) => setMatches({ ...matches, [String(n.n)]: Number(e.target.value) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="-mx-3 overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead><tr><th>Produto</th><th className="text-right">{a.scheduled ? "Previsto" : "Entrou"}</th><th className="text-right">Nota</th><th className="text-right">Custo previsto → nota</th><th className="text-right">Diferença de custo</th><th>Diferença de quantidade</th></tr></thead>
          <tbody>
            {a.lines.map((l) => (
              <tr key={l.idx}>
                <td className="min-w-[160px]">{l.description}{!a.scheduled && <span className="block text-xs text-slate-500">em estoque: {formatQty(l.onHand)}</span>}</td>
                <td className="tabular text-right">{formatQty(l.enteredQty)}</td>
                <td className={cn("tabular text-right", l.qtyDiff !== 0 && "font-semibold text-red-700")}>{l.inNote ? formatQty(l.noteQty) : "não consta"}</td>
                <td className="tabular text-right">{formatMoney(l.enteredUnitCost)} → {l.inNote ? formatMoney(l.noteLandedUnitCost) : "—"}</td>
                <td className={cn("tabular text-right", l.costDelta > 0 ? "text-red-700" : l.costDelta < 0 ? "text-emerald-700" : "")}>{l.costDelta ? formatMoney(l.costDelta) : "—"}</td>
                <td className="min-w-[220px]">
                  {l.qtyDiff === 0 ? (
                    <span className="text-emerald-700">Confere</span>
                  ) : a.scheduled ? (
                    <span className="text-slate-700">Previsto passa a {l.inNote ? formatQty(l.noteQty) : "zero (sai da entrada)"}</span>
                  ) : (
                    <Select
                      aria-label={`Diferença de quantidade de ${l.description}`}
                      value={actions[String(l.idx)] ?? ""}
                      onChange={(e) => setActions((m) => ({ ...m, [String(l.idx)]: e.target.value }))}
                      placeholder="Escolha…"
                      options={[
                        { value: "adjust", label: `Ajustar estoque (${l.qtyDiff > 0 ? "+" : "−"}${formatQty(Math.abs(l.qtyDiff))})` },
                        ...(l.qtyDiff < 0 ? [{ value: "return", label: "Devolver ao fornecedor" }] : []),
                        { value: "keep", label: "Manter (justificar)" },
                      ]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {a.scheduled
          ? "Entrada prevista: nada entrou no estoque — quantidades e custos previstos passam a ser os da nota (sem ajuste de custo médio); na data, a entrada é realizada pelos valores da nota. A conta a pagar continua PREVISTA até a data."
          : "Diferença de custo: ajuste do custo médio (sem quantidade) das unidades ainda em estoque; a parte das já vendidas fica registrada como não absorvida (mesma regra do CT-e)."}{" "}
        Parcelas: {a.installments.map((x) => `${formatDate(x.dueDate)} ${formatMoney(x.amount)}`).join(" · ") || "—"} ({a.installments[0]?.source === "xml" ? "duplicatas da nota" : "condição de pagamento a partir da emissão"}).
      </p>
      {qtyLines.some((l) => actions[String(l.idx)] === "return") && returnHref && (
        <Notice tone="info">Devolução ao fornecedor: depois de confirmar, emita a NF-e de devolução pelo recebimento — <Link className="font-medium underline" href={returnHref}>Devolver ao fornecedor</Link>.</Notice>
      )}
      {a.problems.length > 0 && <Notice tone="bad" title="Resolva antes de confirmar"><ul className="list-disc pl-4">{a.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Notice>}
      {a.warnings.length > 0 && <Notice tone="warn"><ul className="list-disc pl-4">{a.warnings.map((p, i) => <li key={i}>{p}</li>)}</ul></Notice>}
    </section>
  );
}
