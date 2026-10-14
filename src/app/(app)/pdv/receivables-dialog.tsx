"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CheckCircle2, HandCoins, Printer, RefreshCcw, Search, ShieldCheck, Undo2, UserRound } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import type { OpenInstallment } from "@/domain/pdv-receivables";
import { CustomerPicker, type CustomerInfo } from "./customer-picker";
import { pdvOpenInstallmentsAction, pdvReceiveInstallmentsAction, pdvReverseReceiptAction, pdvSessionReceiptsAction, type PdvReceiptView } from "./actions";

const newIdemKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export interface ReceiveMethod {
  id: string;
  name: string;
  kind: string;
  feeBps: number;
  disabledReason: string | null;
}

const receiptUrl = (id: string, print = true) => `/caixa/recebimentos/${id}${print ? "?print=1" : ""}`;

/**
 * Receber parcelas do crediário / contas a receber no caixa (F9): cliente → parcelas em aberto (vencidas primeiro,
 * com multa e juros do dia) → forma de pagamento → confirmar. A baixa é a do Financeiro; o valor entra no caixa aberto.
 * A aba “Recebidos neste caixa” imprime o recibo e estorna (mesma sessão aberta).
 */
export function ReceivablesDialog({
  open,
  onClose,
  terminalId,
  blockReason,
  methods,
  initialCustomer,
  canCreateCustomer,
  discountLimitBps,
  canOverLimit,
  canReverse,
}: {
  open: boolean;
  onClose: () => void;
  terminalId: string;
  /** motivo que impede receber neste terminal (caixa fechado, caixa de outro operador com bloqueio) */
  blockReason: string | null;
  methods: ReceiveMethod[];
  initialCustomer: CustomerInfo | null;
  canCreateCustomer: boolean;
  discountLimitBps: number;
  canOverLimit: boolean;
  canReverse: boolean;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"receive" | "done">("receive");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [list, setList] = useState<OpenInstallment[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const firstEnabled = methods.find((m) => !m.disabledReason)?.id ?? "";
  const [methodId, setMethodId] = useState(firstEnabled);
  const [received, setReceived] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [reference, setReference] = useState("");
  const [approval, setApproval] = useState({ login: "", password: "" });
  const [idem, setIdem] = useState(newIdemKey);
  const [result, setResult] = useState<PdvReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<PdvReceiptView[] | null>(null);
  const [pending, start] = useTransition();

  const loadInstallments = useCallback(
    (c: CustomerInfo) => {
      setList(null);
      setError(null);
      start(async () => {
        const res = await pdvOpenInstallmentsAction(c.id);
        if (!res.ok) return setError(res.error);
        const items = res.data ?? [];
        setList(items);
        // vencidas já marcadas; sem vencidas, a mais antiga
        const overdue = items.filter((i) => i.overdue).map((i) => i.id);
        setSelected(new Set(overdue.length ? overdue : items.slice(0, 1).map((i) => i.id)));
      });
    },
    [],
  );

  const chooseCustomer = useCallback(
    (c: CustomerInfo) => {
      setCustomer(c);
      setPickerOpen(false);
      setResult(null);
      setDiscount(0);
      setReceived(0);
      loadInstallments(c);
    },
    [loadInstallments],
  );

  // ao abrir: usa o cliente do atendimento (se houver) ou pede a busca
  useEffect(() => {
    if (!open) return;
    setTab("receive");
    setError(null);
    if (!customer && initialCustomer) chooseCustomer(initialCustomer);
    else if (!customer) setPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadReceipts = useCallback(() => {
    start(async () => {
      const res = await pdvSessionReceiptsAction(terminalId);
      if (!res.ok) return toast("error", res.error);
      setReceipts(res.data ?? []);
    });
  }, [terminalId, toast]);

  useEffect(() => {
    if (open && tab === "done") loadReceipts();
  }, [open, tab, loadReceipts]);

  const chosen = useMemo(() => (list ?? []).filter((i) => selected.has(i.id)), [list, selected]);
  const gross = chosen.reduce((a, i) => a + i.updated, 0);
  const principal = chosen.reduce((a, i) => a + i.balance, 0);
  const charges = chosen.reduce((a, i) => a + i.fine + i.interest, 0);
  const disc = Math.min(discount, principal);
  const total = gross - disc;
  const method = methods.find((m) => m.id === methodId) ?? null;
  const isCash = method?.kind === "cash";
  const cashIn = isCash && received > 0 ? received : total;
  const change = isCash ? Math.max(0, cashIn - total) : 0;
  const discBps = gross > 0 ? Math.round((disc * 10000) / gross) : 0;
  const overLimit = disc > 0 && !canOverLimit && discBps > discountLimitBps;
  const fee = method && (method.kind === "debit" || method.kind === "credit") ? Math.round((total * method.feeBps) / 10000) : 0;
  const blocker = blockReason
    ? blockReason
    : !chosen.length
      ? "Selecione ao menos uma parcela."
      : !method
        ? "Escolha a forma de pagamento."
        : method.disabledReason
          ? method.disabledReason
          : isCash && received > 0 && received < total
            ? `Valor recebido menor que o total (${formatMoney(total)}).`
            : overLimit && (!approval.login || !approval.password)
              ? "Desconto acima do seu limite: informe login e senha do supervisor."
              : null;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirm = () => {
    if (blocker || pending) return;
    setError(null);
    start(async () => {
      const res = await pdvReceiveInstallmentsAction({
        terminalId, installmentIds: chosen.map((i) => i.id), methodId, received: isCash && received > 0 ? received : null, discount: disc,
        approval: overLimit ? approval : null, reference: reference || null, idemKey: idem,
      });
      if (!res.ok) {
        setError(res.error);
        // recebimento registrado de forma incompleta: a chave não pode ser reaproveitada para outra tentativa
        if (res.code === "receivable_partial") setIdem(newIdemKey());
        return;
      }
      toast("success", res.message ?? "Recebimento registrado.");
      setResult(res.data ?? null);
      setIdem(newIdemKey());
      setApproval({ login: "", password: "" });
      setReceipts(null);
    });
  };

  const newReceipt = () => {
    setResult(null);
    setDiscount(0);
    setReceived(0);
    setReference("");
    if (customer) loadInstallments(customer);
  };

  const otherCustomer = () => {
    setResult(null);
    setPickerOpen(true);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Receber parcelas (F9)" size="xl" footer={tab === "receive" && !result ? (
        <>
          <Button onClick={onClose}>Fechar</Button>
          <Button variant="accent" size="lg" loading={pending} disabled={Boolean(blocker)} onClick={confirm} title={blocker ?? "Confirmar o recebimento"}>
            <HandCoins className="size-5" /> Receber {formatMoney(total)}
          </Button>
        </>
      ) : <Button onClick={onClose}>Fechar</Button>}>
        <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
          {([["receive", "Receber"], ["done", "Recebidos neste caixa"]] as const).map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-accent-500 text-brand-800" : "border-transparent text-slate-500")}>
              {l}
            </button>
          ))}
        </div>

        {tab === "receive" && result && <ReceiptDone r={result} onNew={newReceipt} onOther={otherCustomer} />}

        {tab === "receive" && !result && (
          <div className="space-y-4">
            {blockReason && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{blockReason}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <UserRound className="size-5 shrink-0 text-slate-500" />
                {customer ? (
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{customer.name}</span>
                    <span className="block text-xs text-slate-500">{customer.doc ? formatDoc(customer.doc) : "sem documento"}{customer.openBalance ? ` · em aberto ${formatMoney(customer.openBalance)}` : ""}</span>
                  </span>
                ) : (
                  <span className="text-sm text-slate-500">Nenhum cliente selecionado</span>
                )}
              </div>
              <div className="flex gap-1">
                {customer && <Button size="sm" variant="ghost" onClick={() => loadInstallments(customer)} title="Atualizar parcelas"><RefreshCcw className="size-4" /></Button>}
                <Button size="sm" onClick={() => setPickerOpen(true)}><Search className="size-4" /> {customer ? "Trocar cliente" : "Buscar cliente"}</Button>
              </div>
            </div>

            {customer && list === null && <p className="py-6 text-center text-sm text-slate-500">Carregando parcelas…</p>}
            {customer && list?.length === 0 && <p className="rounded-md border border-line py-6 text-center text-sm text-slate-500">{customer.name} não tem parcelas em aberto.</p>}
            {list && list.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">
                        <input type="checkbox" className="size-4 accent-brand-700" aria-label="Selecionar todas" checked={selected.size === list.length} onChange={(e) => setSelected(new Set(e.target.checked ? list.map((i) => i.id) : []))} />
                      </th>
                      <th className="px-3 py-2">Título / parcela</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-right">Multa + juros</th>
                      <th className="px-3 py-2 text-right">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.id} onClick={() => toggle(i.id)} className={cn("cursor-pointer border-t border-line", selected.has(i.id) ? "bg-brand-50" : "hover:bg-slate-50")}>
                        <td className="px-3 py-2"><input type="checkbox" className="size-4 accent-brand-700" checked={selected.has(i.id)} onChange={() => toggle(i.id)} onClick={(e) => e.stopPropagation()} aria-label={`Parcela ${i.number} do título ${i.titleNumber}`} /></td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-ink">nº {i.titleNumber} · parc. {i.number}/{i.count}</span>
                          <span className="block text-xs text-slate-500">{i.description}</span>
                        </td>
                        <td className="px-3 py-2">
                          {formatDate(i.dueDate)}
                          {i.overdue ? <Badge tone="bad" className="ml-1">{i.daysLate} dia(s) de atraso</Badge> : <Badge tone="neutral" className="ml-1">a vencer</Badge>}
                        </td>
                        <td className="tabular px-3 py-2 text-right">{formatMoney(i.balance)}</td>
                        <td className="tabular px-3 py-2 text-right text-xs">{i.fine + i.interest ? <span title={`Multa ${formatMoney(i.fine)} · juros ${formatMoney(i.interest)}`}>+{formatMoney(i.fine + i.interest)}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className="tabular px-3 py-2 text-right font-semibold">{formatMoney(i.updated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {chosen.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-3">
                  <Field label="Forma de pagamento">
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {methods.map((m) => (
                        <button key={m.id} type="button" disabled={Boolean(m.disabledReason)} title={m.disabledReason ?? undefined} onClick={() => setMethodId(m.id)}
                          className={cn("focus-ring rounded-md border px-2 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50", methodId === m.id ? "border-accent-500 bg-accent-50 text-brand-900" : "border-line hover:border-accent-500")}>
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {method?.disabledReason && <p className="text-xs text-amber-800">{method.disabledReason}</p>}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {isCash ? (
                      <Field label="Valor recebido (dinheiro)" hint="Deixe em branco para o valor exato.">
                        <MoneyInput value={received} onChange={setReceived} ariaLabel="Valor recebido em dinheiro" />
                      </Field>
                    ) : (
                      <Field label={method?.kind === "pix" ? "Identificação do Pix (opcional)" : "NSU / autorização (opcional)"}>
                        <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
                      </Field>
                    )}
                    <Field label="Desconto (opcional)" hint={`Seu limite: ${canOverLimit ? "sem limite" : formatBps(discountLimitBps)} do valor atualizado`} error={disc < discount ? "O desconto não pode passar do saldo das parcelas." : null}>
                      <MoneyInput value={discount} onChange={setDiscount} ariaLabel="Desconto" />
                    </Field>
                  </div>
                  {overLimit && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-sm text-amber-900"><ShieldCheck className="size-4" /> Desconto de {formatBps(discBps)} acima do seu limite ({formatBps(discountLimitBps)}): autorização de um supervisor.</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input placeholder="Login do supervisor" autoComplete="off" value={approval.login} onChange={(e) => setApproval({ ...approval, login: e.target.value })} aria-label="Login do supervisor" />
                        <Input type="password" placeholder="Senha" autoComplete="new-password" value={approval.password} onChange={(e) => setApproval({ ...approval, password: e.target.value })} aria-label="Senha do supervisor" />
                      </div>
                    </div>
                  )}
                </div>
                <dl className="space-y-1 rounded-lg border border-line bg-white p-3 text-sm" aria-live="polite">
                  <div className="flex justify-between"><dt className="text-slate-500">{chosen.length} parcela(s) — saldo</dt><dd className="tabular">{formatMoney(principal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Multa + juros</dt><dd className="tabular text-emerald-700">+{formatMoney(charges)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Desconto</dt><dd className="tabular text-red-700">−{formatMoney(disc)}</dd></div>
                  <div className="flex items-end justify-between border-t border-line pt-2"><dt className="font-medium">Total a receber</dt><dd className="tabular text-2xl font-bold text-brand-800">{formatMoney(total)}</dd></div>
                  {isCash && <div className="flex justify-between"><dt className="text-slate-500">Troco</dt><dd className="tabular font-semibold">{formatMoney(change)}</dd></div>}
                  {fee > 0 && <p className="text-xs text-slate-500">Taxa prevista do cartão: {formatMoney(fee)} (lançada no financeiro).</p>}
                </dl>
              </div>
            )}
            {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            {!error && blocker && chosen.length > 0 && <p className="text-xs text-slate-500">{blocker}</p>}
          </div>
        )}

        {tab === "done" && <SessionReceipts receipts={receipts} loading={pending} canReverse={canReverse} onReload={loadReceipts} />}
      </Dialog>
      <CustomerPicker
        open={open && pickerOpen}
        onClose={() => setPickerOpen(false)}
        current={customer}
        cpfOnInvoice={null}
        canCreate={canCreateCustomer}
        title="Receber parcelas — localizar cliente"
        onSelect={chooseCustomer}
      />
    </>
  );
}

function ReceiptDone({ r, onNew, onOther }: { r: PdvReceiptView; onNew: () => void; onOther: () => void }) {
  return (
    <div className="space-y-3 text-center">
      <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
      <p className="text-lg font-semibold">Recebimento nº {r.number} registrado</p>
      <p className="text-sm text-slate-600">{r.items.filter((i) => i.done).length} parcela(s) de {r.customers.join(", ")} · {r.methodName}</p>
      <p className="tabular text-3xl font-bold text-brand-800">{formatMoney(r.total)}</p>
      {r.methodKind === "cash" && r.change > 0 && <p className="tabular text-xl font-semibold text-accent-700">Troco: {formatMoney(r.change)}</p>}
      {r.status === "partial" && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{r.error}</p>}
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <Button variant="primary" onClick={() => window.open(receiptUrl(r.id), "_blank", "noopener")}><Printer className="size-4" /> Imprimir recibo</Button>
        <Button onClick={onNew}>Receber outra parcela do cliente</Button>
        <Button variant="ghost" onClick={onOther}>Outro cliente</Button>
      </div>
    </div>
  );
}

function SessionReceipts({ receipts, loading, canReverse, onReload }: { receipts: PdvReceiptView[] | null; loading: boolean; canReverse: boolean; onReload: () => void }) {
  const toast = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState({ login: "", password: "" });
  const [pending, start] = useTransition();
  if (receipts === null) return <p className="py-6 text-center text-sm text-slate-500">{loading ? "Carregando…" : "—"}</p>;
  if (receipts.length === 0) return <p className="rounded-md border border-line py-6 text-center text-sm text-slate-500">Nenhum recebimento de parcelas neste caixa.</p>;
  const reverse = (id: string) =>
    start(async () => {
      const res = await pdvReverseReceiptAction(id, reason, canReverse ? null : approval);
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Recebimento estornado.");
      setTarget(null);
      setReason("");
      setApproval({ login: "", password: "" });
      onReload();
    });
  return (
    <ul className="space-y-2">
      {receipts.map((r) => (
        <li key={r.id} className="rounded-md border border-line p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-ink">
                Recebimento nº {r.number}{" "}
                {r.status === "reversed" ? <Badge tone="bad">estornado</Badge> : r.status === "partial" ? <Badge tone="warn">parcial</Badge> : <Badge tone="good">recebido</Badge>}
              </p>
              <p className="text-xs text-slate-500">{r.at ? formatDateTime(r.at) : ""} · {r.customers.join(", ")} · {r.items.filter((i) => i.done).length} parcela(s) · {r.methodName} · por {r.operatorName}</p>
              {r.reversal && <p className="text-xs text-red-700">Estornado em {formatDateTime(r.reversal.at)} por {r.reversal.byName}: {r.reversal.reason}</p>}
            </div>
            <span className="tabular font-semibold">{formatMoney(r.total)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => window.open(receiptUrl(r.id), "_blank", "noopener")}><Printer className="size-4" /> Recibo</Button>
            {r.status !== "reversed" && target !== r.id && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setTarget(r.id)}><Undo2 className="size-4" /> Estornar</Button>}
          </div>
          {target === r.id && (
            <form className="mt-3 space-y-2 rounded-md border border-red-200 bg-red-50 p-3" onSubmit={(e) => { e.preventDefault(); reverse(r.id); }}>
              <p className="text-sm text-red-900">As parcelas voltam a ficar em aberto e {formatMoney(r.total)} sai {r.methodKind === "cash" ? "do dinheiro do caixa (devolva ao cliente)" : `do previsto em ${r.methodName}`}.</p>
              <Field label="Motivo do estorno" required>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={300} />
              </Field>
              {!canReverse && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Login do supervisor" autoComplete="off" value={approval.login} onChange={(e) => setApproval({ ...approval, login: e.target.value })} aria-label="Login do supervisor" />
                  <Input type="password" placeholder="Senha" autoComplete="new-password" value={approval.password} onChange={(e) => setApproval({ ...approval, password: e.target.value })} aria-label="Senha do supervisor" />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" onClick={() => setTarget(null)}>Voltar</Button>
                <Button type="submit" size="sm" variant="danger" loading={pending} disabled={!reason.trim() || (!canReverse && (!approval.login || !approval.password))}>Confirmar estorno</Button>
              </div>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
