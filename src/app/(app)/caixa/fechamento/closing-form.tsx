"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Banknote, CreditCard, EyeOff, FileText, Lock, QrCode, Wallet } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { closeSessionAction, previewCloseAction } from "../actions";

interface Method { key: string; label: string; count: number; expected: number | null }
const ICON: Record<string, React.ReactNode> = { cash: <Banknote className="size-4" />, debit: <CreditCard className="size-4" />, credit: <CreditCard className="size-4" />, pix: <QrCode className="size-4" /> };

/**
 * Conferência por forma de pagamento: informado × previsto, diferença por meio e geral (Informado − Esperado).
 * Diferenças nunca são ajustadas automaticamente: exigem justificativa e ficam preservadas no fechamento.
 * Conferência cega (parâmetro cash.blindClose): o previsto só é revelado após informar os valores contados.
 */
export function ClosingForm({ sessionId, blind, methods, initialCounted, cashBreakdown, checklist, accounts }: { sessionId: string; blind: boolean; methods: Method[]; initialCounted?: Record<string, number> | null; cashBreakdown: { opening: number; cashSales: number; supply: number; withdrawal: number; refunds: number }; checklist: Array<{ key: string; label: string; hint: string }>; accounts: Array<{ value: string; label: string }> }) {
  const toast = useToast();
  const [counted, setCounted] = useState<Record<string, number | null>>(Object.fromEntries(methods.map((m) => [m.key, initialCounted ? (initialCounted[m.key] ?? 0) : null])));
  // conferência cega: o previsto só chega do servidor depois que a contagem é registrada (apuração)
  const [expected, setExpected] = useState<Record<string, number> | null>(blind && !initialCounted ? null : Object.fromEntries(methods.map((m) => [m.key, m.expected ?? 0])));
  const countLocked = blind && expected != null;
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [justification, setJustification] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState(0);
  const [revealing, startReveal] = useTransition();
  const filled = methods.every((m) => counted[m.key] != null);
  const numeric = Object.fromEntries(methods.map((m) => [m.key, counted[m.key] ?? 0]));
  const diffs = useMemo(() => (expected ? Object.fromEntries(methods.map((m) => [m.key, (counted[m.key] ?? 0) - (expected[m.key] ?? 0)])) : null), [expected, counted, methods]);
  const totalExpected = expected ? Object.values(expected).reduce((a, b) => a + b, 0) : null;
  const totalCounted = Object.values(numeric).reduce((a, b) => a + b, 0);
  const totalDiff = totalExpected == null ? null : totalCounted - totalExpected;
  const hasDiff = diffs ? Object.values(diffs).some((d) => d !== 0) : false;
  const allChecked = checklist.every((c) => checks[c.key]);
  const transferOver = Boolean(transferTo) && transferAmount > (numeric.cash ?? 0);
  const canClose = filled && expected != null && allChecked && (!hasDiff || justification.trim().length > 0) && !transferOver;
  const reveal = () =>
    startReveal(async () => {
      const res = await previewCloseAction(sessionId, numeric);
      if (!res.ok) return toast("error", res.error);
      setExpected(res.data!.expected);
      // a contagem que vale é a registrada no servidor (não pode ser alterada depois da revelação)
      const reg = res.data!.counted ?? {};
      setCounted(Object.fromEntries(methods.map((m) => [m.key, reg[m.key] ?? 0])));
    });
  return (
    <ActionForm action={closeSessionAction.bind(null, sessionId)} confirm={hasDiff ? `Fechar o caixa com divergência de ${formatMoney(totalDiff ?? 0)}? A diferença ficará registrada com a justificativa.` : undefined}>
      {({ pending }) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-lg border border-line bg-white">
            <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">Conferência por forma de pagamento</h2></header>
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Forma de pagamento</th><th className="text-right">Esperado</th><th className="text-right">Informado</th><th className="text-right">Diferença</th></tr></thead>
                <tbody>
                  {methods.map((m) => {
                    const d = diffs?.[m.key];
                    return (
                      <tr key={m.key}>
                        <td>
                          <span className="flex items-center gap-2 font-medium">{ICON[m.key] ?? <Wallet className="size-4" />} {m.label}</span>
                          <span className="text-xs text-slate-500">{m.key === "cash" ? "Inclui fundo, suprimentos, sangrias e devoluções em espécie (troco já descontado)" : m.key === "crediario" || m.key === "boleto" ? `${m.count} venda(s) a prazo — conferir comprovantes assinados` : `${m.count} transação(ões)`}</span>
                        </td>
                        <td className="tabular text-right">{expected ? formatMoney(expected[m.key] ?? 0) : <span className="flex items-center justify-end gap-1 text-slate-400"><EyeOff className="size-4" /> oculto</span>}</td>
                        <td className="w-44 text-right">
                          <MoneyInput value={counted[m.key] ?? 0} onChange={(v) => setCounted({ ...counted, [m.key]: v })} ariaLabel={`Informado ${m.label}`} disabled={countLocked} />
                          {!blind && expected && counted[m.key] == null && <button type="button" className="mt-0.5 text-xs text-brand-700 underline" onClick={() => setCounted({ ...counted, [m.key]: expected[m.key] ?? 0 })}>conferido = esperado</button>}
                        </td>
                        <td className={cn("tabular text-right font-medium", d == null ? "text-slate-400" : d === 0 ? "text-emerald-700" : "text-red-700")}>{d == null ? "—" : `${d > 0 ? "+" : ""}${formatMoney(d)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-2">Totais</td>
                    <td className="tabular px-3 py-2 text-right">{totalExpected == null ? "—" : formatMoney(totalExpected)}</td>
                    <td className="tabular px-3 py-2 text-right">{formatMoney(totalCounted)}</td>
                    <td className={cn("tabular px-3 py-2 text-right", totalDiff == null ? "" : totalDiff === 0 && !hasDiff ? "text-emerald-700" : "text-red-700")}>{totalDiff == null ? "—" : formatMoney(totalDiff)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {!blind && (
              <p className="px-4 py-2 text-xs text-slate-500">
                Dinheiro esperado = fundo {formatMoney(cashBreakdown.opening)} + vendas em dinheiro {formatMoney(cashBreakdown.cashSales)} + suprimentos {formatMoney(cashBreakdown.supply)} − sangrias {formatMoney(cashBreakdown.withdrawal)} − devoluções {formatMoney(cashBreakdown.refunds)}. Diferença = informado − esperado, por meio.
              </p>
            )}
            {blind && (
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm">
                <EyeOff className="size-4 text-slate-500" />
                <span className="flex-1 text-slate-600">Conferência cega: a coluna “Esperado” fica oculta e só é exibida após informar a contagem. Ao apurar, a contagem fica registrada e não pode mais ser alterada.</span>
                <Button type="button" size="sm" variant="primary" onClick={reveal} loading={revealing} disabled={!filled || Boolean(expected)}>{expected ? "Previsto revelado" : "Apurar diferenças"}</Button>
              </div>
            )}
          </section>
          <aside className="space-y-3">
            <section className="rounded-lg border border-line bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">Conferências finais</h2>
              <ul className="space-y-2">
                {checklist.map((c) => (
                  <li key={c.key}>
                    <label className="flex cursor-pointer gap-2 text-sm">
                      <input type="checkbox" className="mt-0.5 size-4 accent-accent-500" checked={Boolean(checks[c.key])} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
                      <span><span className="font-medium">{c.label}</span><span className="block text-xs text-slate-500">{c.hint}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            <section className="space-y-3 rounded-lg border border-line bg-white p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Situação do fechamento</span>
                {!filled || !expected ? <Badge>Aguardando contagem</Badge> : hasDiff ? <Badge tone="bad">Com divergência {formatMoney(totalDiff ?? 0)}</Badge> : <Badge tone="good">Sem diferenças</Badge>}
              </div>
              <Field label="Justificativa da divergência" required={hasDiff} hint={hasDiff ? "Obrigatória: a diferença é preservada (sem ajuste automático)." : "Exigida somente se houver diferença."}>
                <Textarea name="justification" value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={1000} aria-invalid={hasDiff && !justification.trim()} />
              </Field>
              <details className="text-sm">
                <summary className="cursor-pointer text-brand-700">Recolher o dinheiro contado para uma conta (opcional)</summary>
                <div className="mt-2 grid gap-2">
                  <Select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="Não recolher agora" options={accounts} aria-label="Conta de destino" />
                  {transferTo && <MoneyInput value={transferAmount} onChange={setTransferAmount} ariaLabel="Valor recolhido" />}
                  {transferOver && <p className="text-xs text-red-700">O recolhimento não pode passar do dinheiro contado ({formatMoney(numeric.cash ?? 0)}).</p>}
                  <p className="text-xs text-slate-500">Gera transferência entre contas (Caixa → destino) com o valor informado, limitado ao dinheiro contado.</p>
                </div>
              </details>
              <input type="hidden" name="counted" value={JSON.stringify(numeric)} />
              <input type="hidden" name="checklist" value={JSON.stringify(checks)} />
              <input type="hidden" name="transferToAccountId" value={transferTo} />
              <input type="hidden" name="transferAmount" value={transferTo ? transferAmount : 0} />
              <button type="submit" disabled={pending || !canClose} className={buttonClass("accent", "lg", "w-full")}>
                <Lock className="size-4" /> Confirmar e fechar caixa
              </button>
              {(!blind || expected) && (
                <Link href={`/caixa/${sessionId}/relatorio`} target="_blank" className={buttonClass("secondary", "md", "w-full")}>
                  <FileText className="size-4" /> Visualizar relatório antes de fechar
                </Link>
              )}
              {!allChecked && <p className="text-xs text-amber-800">Marque todas as conferências finais para liberar o fechamento.</p>}
              <p className="text-xs text-slate-500">O fechamento não poderá ser alterado sem autorização administrativa (reabertura gera nova versão e preserva esta conferência).</p>
            </section>
          </aside>
        </div>
      )}
    </ActionForm>
  );
}
