"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Eye, HandCoins, ListChecks, XSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { previewBatchSettleAction, settleBatchAction } from "../actions";
import { brl, dmy, type LateParams } from "./calc";

type Opt = { value: string; label: string };
type MethodOpt = Opt & { kind: string; accountId: string | null };

/** Atributo das caixas de seleção renderizadas na lista (servidor): `data-lote="<kind>"`, value = id da parcela. */
export const BATCH_ATTR = "data-lote";

interface Line {
  installmentId: string;
  titleNumber: number | null;
  number: number | null;
  count: number | null;
  partyName: string | null;
  dueDate: string | null;
  daysLate: number;
  balance: number;
  principal: number;
  fine: number;
  interest: number;
  total: number;
  status: "ok" | "error" | "settled";
  message: string | null;
}
interface Totals {
  count: number;
  ok: number;
  errors: number;
  principal: number;
  fine: number;
  interest: number;
  total: number;
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Caixa de seleção de uma parcela na lista (componente de servidor pode renderizar diretamente). */
export function BatchCheckbox({ kind, id, label }: { kind: "receivable" | "payable"; id: string; label: string }) {
  return <input type="checkbox" {...{ [BATCH_ATTR]: kind }} value={id} aria-label={`Selecionar ${label}`} className="no-print focus-ring size-4 rounded border-line accent-brand-700" />;
}

/**
 * Barra de seleção múltipla + diálogo "Baixar selecionadas" (FIN-02): data, conta, forma, encargos sugeridos opcionais,
 * prévia por parcela e resultado (baixadas × não baixadas com motivo). A baixa usa a mesma regra da baixa individual.
 */
export function BatchSettleBar({
  kind,
  balances,
  accounts,
  methods,
  late,
  today,
  disabled,
  disabledReason,
}: {
  kind: "receivable" | "payable";
  /** saldo das parcelas selecionáveis da página (para o total da seleção) */
  balances: Record<string, number>;
  accounts: Opt[];
  methods: MethodOpt[];
  late: LateParams;
  today: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const rec = kind === "receivable";
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(accounts[0]?.value ?? "");
  const [methodId, setMethodId] = useState("");
  const [charges, setCharges] = useState(rec);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<{ lines: Line[]; totals: Totals } | null>(null);
  const [result, setResult] = useState<{ lines: Line[]; settled: number; errors: number; total: number; replayed: boolean } | null>(null);
  const [idem, setIdem] = useState(newKey);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const boxes = useCallback(() => Array.from(document.querySelectorAll<HTMLInputElement>(`input[${BATCH_ATTR}="${kind}"]`)), [kind]);
  const sync = useCallback(() => setSelected(boxes().filter((b) => b.checked).map((b) => b.value)), [boxes]);
  useEffect(() => {
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement && t.getAttribute(BATCH_ATTR) === kind) sync();
    };
    document.addEventListener("change", onChange);
    sync();
    return () => document.removeEventListener("change", onChange);
  }, [kind, sync]);

  const setAll = (on: boolean) => {
    for (const b of boxes()) b.checked = on;
    sync();
  };
  const sum = selected.reduce((a, id) => a + (balances[id] ?? 0), 0);
  const selectable = Object.keys(balances).length;

  const invalidate = () => setPreview(null);
  const openDialog = () => {
    setPreview(null);
    setResult(null);
    setDate(today);
    setOpen(true);
  };

  const runPreview = () =>
    start(async () => {
      if (!selected.length) return void toast("error", "Marque ao menos uma parcela na lista.");
      if (date > today) return void toast("error", "A data não pode ser futura.");
      const r = await previewBatchSettleAction({ kind, installmentIds: selected, date, applyLateCharges: charges });
      if (!r.ok) return void toast("error", r.error);
      setPreview(r.data as { lines: Line[]; totals: Totals });
    });

  const apply = () =>
    start(async () => {
      if (!preview) return;
      if (!accountId || !methodId) return void toast("error", `Informe a forma de ${rec ? "recebimento" : "pagamento"} e a conta.`);
      const ids = preview.lines.filter((l) => l.status === "ok").map((l) => l.installmentId);
      if (!ids.length) return void toast("error", "Nenhuma parcela da prévia pode ser baixada.");
      const r = await settleBatchAction({ kind, installmentIds: ids, date, applyLateCharges: charges, accountId, methodId, reference: reference || null, notes: notes || null, idemKey: idem });
      if (!r.ok) return void toast("error", r.error);
      const data = r.data as { lines: Line[]; settled: number; errors: number; total: number; replayed: boolean };
      // erros da prévia (parcelas fora da aplicação) também aparecem no resultado
      const skipped = preview.lines.filter((l) => l.status === "error");
      setResult({ ...data, lines: [...data.lines, ...skipped], errors: data.errors + skipped.length });
      setPreview(null);
      setIdem(newKey());
      toast(data.settled || data.replayed ? "success" : "error", r.message ?? "Baixa registrada.");
      setAll(false);
      router.refresh();
    });

  return (
    <>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
        <ListChecks className="size-4 text-slate-500" aria-hidden />
        <span className="tabular text-slate-600">
          {selected.length ? (
            <>
              <b className="text-ink">{selected.length}</b> parcela(s) selecionada(s) · saldo <b className="text-ink">{brl(sum)}</b>
            </>
          ) : (
            `Marque as parcelas na coluna “Seleção” para ${rec ? "receber" : "pagar"} várias de uma vez.`
          )}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setAll(true)} disabled={!selectable}>
            <CheckSquare className="size-4" /> Marcar página
          </Button>
          {selected.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setAll(false)}>
              <XSquare className="size-4" /> Limpar
            </Button>
          )}
          <Button type="button" size="sm" variant="primary" disabled={disabled || !selected.length} title={disabled ? disabledReason : undefined} onClick={openDialog}>
            <HandCoins className="size-4" /> Baixar selecionadas
          </Button>
        </span>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={`${rec ? "Recebimento" : "Pagamento"} em lote — ${selected.length} parcela(s)`} size="xl">
        {result ? (
          <div className="space-y-4">
            <Notice tone={result.errors ? "warn" : "good"} title={result.replayed ? "Baixa já registrada anteriormente" : "Baixa em lote concluída"}>
              {result.settled} parcela(s) {rec ? "recebida(s)" : "paga(s)"} — {brl(result.total)} movimentado(s) na conta.
              {result.errors ? ` ${result.errors} parcela(s) não baixada(s): veja o motivo abaixo e trate individualmente.` : ""}
            </Notice>
            <LinesTable lines={result.lines} rec={rec} result />
            <div className="flex justify-end border-t border-line pt-3">
              <Button type="button" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <FormGrid cols={3}>
              <Field label={rec ? "Data do recebimento" : "Data do pagamento"} required>
                <Input type="date" value={date} max={today} onChange={(e) => (setDate(e.target.value), invalidate())} required />
              </Field>
              <Field label={rec ? "Forma de recebimento" : "Forma de pagamento"} required>
                <Select
                  required
                  value={methodId}
                  onChange={(e) => {
                    setMethodId(e.target.value);
                    const m = methods.find((x) => x.value === e.target.value);
                    if (m?.accountId) setAccountId(m.accountId);
                  }}
                  options={methods}
                  placeholder="—"
                />
              </Field>
              <Field label={rec ? "Conta de entrada" : "Conta de saída"} required>
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts} required />
              </Field>
              <Field label="Referência" hint="Comprovante, lote bancário…">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
              </Field>
              <Field label="Observação" className="sm:col-span-2">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
              </Field>
            </FormGrid>
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <Checkbox label="Aplicar multa e juros sugeridos às parcelas em atraso" checked={charges} onChange={(e) => (setCharges(e.target.checked), invalidate())} />
              <p className="mt-1 text-xs text-slate-500">
                Parâmetros de atraso: multa {(late.fineBps / 100).toLocaleString("pt-BR")}% + juros {(late.interestMonthlyBps / 100).toLocaleString("pt-BR")}% a.m. pro rata
                {late.graceDays ? `, tolerância ${late.graceDays} dia(s)` : ""}. Cada parcela é baixada pelo saldo integral; descontos e baixas parciais são feitos no título.
                {!rec && " Contas a pagar só são pagas depois de autorizadas; os encargos do fornecedor podem diferir dos parâmetros."}
              </p>
            </div>
            {preview ? (
              <>
                <LinesTable lines={preview.lines} rec={rec} />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-100 bg-brand-50 px-4 py-3 text-sm">
                  <div className="text-slate-600">
                    {preview.totals.ok} parcela(s) · principal {brl(preview.totals.principal)} + multa {brl(preview.totals.fine)} + juros {brl(preview.totals.interest)}
                    {preview.totals.errors > 0 && <span className="block text-amber-800">{preview.totals.errors} parcela(s) não serão baixadas (motivo na tabela).</span>}
                  </div>
                  <p className="tabular text-xl font-semibold text-brand-800">{brl(preview.totals.total)}</p>
                </div>
              </>
            ) : (
              <Notice tone="info">Gere a prévia para conferir o valor de cada parcela antes de confirmar.</Notice>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" variant={preview ? "secondary" : "primary"} loading={pending && !preview} onClick={runPreview} disabled={pending}>
                <Eye className="size-4" /> {preview ? "Refazer prévia" : "Gerar prévia"}
              </Button>
              {preview && (
                <Button type="button" variant="primary" loading={pending} disabled={pending || !preview.totals.ok || !methodId || !accountId} onClick={apply}>
                  <HandCoins className="size-4" /> Confirmar {rec ? "recebimento" : "pagamento"} de {brl(preview.totals.total)}
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function LinesTable({ lines, rec, result }: { lines: Line[]; rec: boolean; result?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="table-base w-full text-sm">
        <thead>
          <tr>
            <th>{rec ? "Cliente" : "Fornecedor"}</th>
            <th>Título / parcela</th>
            <th>Vencimento</th>
            <th className="text-right">Saldo</th>
            <th className="text-right">Multa</th>
            <th className="text-right">Juros</th>
            <th className="text-right">Total</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.installmentId}>
              <td className="min-w-[140px]">{l.partyName ?? "—"}</td>
              <td className="whitespace-nowrap">{l.titleNumber != null ? `nº ${l.titleNumber} · ${l.number}/${l.count}` : "—"}</td>
              <td className="whitespace-nowrap">
                {dmy(l.dueDate)}
                {l.daysLate > 0 && <span className="block text-xs text-red-600">{l.daysLate} dia(s) de atraso</span>}
              </td>
              <td className="tabular text-right">{brl(l.status === "error" ? l.balance : l.principal)}</td>
              <td className="tabular text-right">{l.fine ? brl(l.fine) : "—"}</td>
              <td className="tabular text-right">{l.interest ? brl(l.interest) : "—"}</td>
              <td className="tabular text-right font-medium">{l.status === "error" ? "—" : brl(l.total)}</td>
              <td className="min-w-[160px]">
                {l.status === "error" ? (
                  <span className="block">
                    <Badge tone="bad">{result ? "Não baixada" : "Fora do lote"}</Badge>
                    <span className="mt-0.5 block text-xs text-red-700">{l.message}</span>
                  </span>
                ) : l.status === "settled" ? (
                  <span className="block">
                    <Badge tone="good">{rec ? "Recebida" : "Paga"}</Badge>
                    {l.message && <span className="mt-0.5 block text-xs text-slate-500">{l.message}</span>}
                  </span>
                ) : (
                  <Badge tone="brand">Será baixada</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
