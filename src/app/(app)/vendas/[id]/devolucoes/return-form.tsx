"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CheckCircle2, FileText, Gift, History, Package, Receipt, Undo2, Wallet } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty, roundDiv, QTY } from "@/lib/money";
import { processReturnAction } from "../../actions";

const REASONS = ["Tamanho inadequado", "Produto com defeito", "Produto incorreto", "Arrependimento da compra", "Avaria no transporte", "Outro"];

interface Item { id: string; sku: string; description: string; unitCode: string; qty: number; returnable: number; unitPrice: number; total: number; unitNet: number; service: boolean }

/**
 * Trocas e devoluções (Tela 11): itens e quantidade restante devolvível, motivo e condição por item,
 * compensação (vale-crédito, estorno ou troca imediata) e impactos da operação antes da confirmação.
 */
export function ReturnForm(props: {
  sale: { id: string; number: number; completedAt: string; total: number; customerName: string | null; customerId: string | null; branchName: string };
  doc: { model: string; number: number | null; status: string; id: string } | null;
  items: Item[];
  payments: Array<{ kind: string; name: string; amount: number }>;
  accounts: Array<{ value: string; label: string }>;
  defaultPixAccountId: string | null;
  cashSession: { id: string; number: number; terminalName: string } | null;
}) {
  const [sel, setSel] = useState<Record<string, { on: boolean; qty: string; reason: string; condition: "resellable" | "damaged" }>>(() =>
    Object.fromEntries(props.items.map((i) => [i.id, { on: false, qty: String(Math.min(1, i.returnable / QTY)).replace(".", ","), reason: "", condition: "resellable" as const }])),
  );
  // estorno pela forma original (sugestão): dinheiro → caixa; Pix → conta do Pix; cartão → estorno na maquininha
  const original = props.payments[0]?.kind;
  const suggested = original === "cash" ? "cash" : original === "pix" ? "pix" : original === "debit" || original === "credit" ? "card_reversal" : "account";
  const [compensation, setCompensation] = useState<"store_credit" | "refund" | "exchange">(props.sale.customerId ? "store_credit" : "exchange");
  const [refundMethod, setRefundMethod] = useState<string>(suggested);
  const [accountId, setAccountId] = useState<string>(props.defaultPixAccountId ?? props.accounts[0]?.value ?? "");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<{ id: string } | null>(null);

  const lines = useMemo(
    () =>
      props.items
        .map((i) => {
          const s = sel[i.id];
          const qty = Math.round(Number((s?.qty ?? "0").replace(/\./g, "").replace(",", ".")) * QTY) || 0;
          // mesma regra do servidor: proporcional ao líquido pago; o restante fecha os centavos
          const value = !s?.on || qty <= 0 ? 0 : qty === i.returnable ? null : roundDiv(i.total * qty, i.qty);
          return { item: i, on: Boolean(s?.on) && qty > 0, qty, value, reason: s?.reason ?? "", condition: s?.condition ?? "resellable", over: qty > i.returnable };
        })
        .filter(Boolean),
    [props.items, sel],
  );
  const chosen = lines.filter((l) => l.on);
  const estimated = chosen.reduce((a, l) => a + (l.value ?? roundDiv(l.item.total * l.qty, l.item.qty)), 0);
  const invalid = chosen.some((l) => l.over || !l.reason) || chosen.length === 0;
  const step = chosen.length === 0 ? 1 : invalid ? 1 : 3;
  const needsCustomer = compensation === "store_credit" && !props.sale.customerId;
  const cashBlocked = compensation === "refund" && refundMethod === "cash" && !props.cashSession;
  const damaged = chosen.some((l) => l.condition === "damaged");
  const resellable = chosen.some((l) => l.condition === "resellable" && !l.item.service);

  const financeImpact =
    compensation === "store_credit"
      ? `Será emitido um vale-crédito de ${formatMoney(estimated)} para ${props.sale.customerName ?? "o cliente"} (saldo consumível em novas compras, validade de 12 meses).`
      : compensation === "exchange"
        ? `Será emitido um vale de troca de ${formatMoney(estimated)} e o PDV abrirá a nova venda com o vale aplicado; a diferença será paga pelo cliente ou ficará no vale.`
        : refundMethod === "cash"
          ? `Saída de ${formatMoney(estimated)} em dinheiro do caixa ${props.cashSession ? `nº ${props.cashSession.number}` : "(nenhum caixa aberto!)"}; reduz o dinheiro esperado no fechamento.`
          : refundMethod === "card_reversal"
            ? `Estorno de ${formatMoney(estimated)} no cartão: fica uma obrigação “em processamento” no contas a pagar até a confirmação da adquirente.`
            : `Saída de ${formatMoney(estimated)} da conta selecionada (${props.accounts.find((a) => a.value === accountId)?.label ?? "—"}).`;

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
        <CheckCircle2 className="mb-2 size-8" />
        <p className="font-semibold">Devolução registrada.</p>
        <Link className="underline" href={`/vendas/devolucoes/${done.id}`}>Ver comprovante e impactos</Link>
      </div>
    );
  }

  return (
    <ActionForm action={processReturnAction.bind(null, props.sale.id)} onSuccess={(d) => setDone(d)}>
      {({ pending }) => (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <section className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-line bg-white p-4 text-sm">
              <Receipt className="size-6 text-brand-700" />
              <div><p className="text-xs text-slate-500">Venda original</p><p className="font-medium"><Link className="text-brand-700 hover:underline" href={`/vendas/${props.sale.id}`}>nº {props.sale.number}</Link> • {props.sale.completedAt}</p></div>
              <div><p className="text-xs text-slate-500">Cliente</p><p className="font-medium">{props.sale.customerName ?? "Consumidor final"}</p></div>
              <div><p className="text-xs text-slate-500">Documento</p><p className="font-medium">{props.doc ? `${props.doc.model === "nfce" ? "NFC-e" : "NF-e"} ${props.doc.number ?? "(sem número)"} — ${props.doc.status}` : "Sem documento fiscal"}</p></div>
              <div><p className="text-xs text-slate-500">Valor total</p><p className="tabular font-semibold">{formatMoney(props.sale.total)}</p></div>
            </section>
            <ol className="flex flex-wrap gap-2 text-sm" aria-label="Etapas">
              {["Selecionar produtos", "Definir compensação", "Confirmar operação"].map((label, i) => (
                <li key={label} className={cn("flex items-center gap-2 rounded-full border px-3 py-1", step >= i + 1 ? "border-accent-500 bg-accent-50 text-accent-700" : "border-line text-slate-500")} aria-current={step === i + 1 ? "step" : undefined}>
                  <span className={cn("flex size-5 items-center justify-center rounded-full text-xs font-bold", step >= i + 1 ? "bg-accent-500 text-white" : "bg-slate-200")}>{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <section className="rounded-lg border border-line bg-white">
              <header className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold">1. Produtos disponíveis para troca ou devolução</h2></header>
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead><tr><th className="w-8" /><th>Produto</th><th className="text-right">Qtd.</th><th>Motivo</th><th>Condição</th><th className="text-right">Valor</th></tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const i = l.item;
                      const s = sel[i.id];
                      const disabled = i.returnable <= 0;
                      return (
                        <tr key={i.id} className={disabled ? "opacity-50" : undefined}>
                          <td><input type="checkbox" className="size-4 accent-brand-700" aria-label={`Selecionar ${i.description}`} disabled={disabled} checked={s.on} onChange={(e) => setSel({ ...sel, [i.id]: { ...s, on: e.target.checked } })} /></td>
                          <td>
                            {i.description}
                            <span className="block font-mono text-xs text-slate-500">{i.sku} • comprado {formatQty(i.qty, i.unitCode)} • restante devolvível {formatQty(i.returnable)}</span>
                          </td>
                          <td className="text-right">
                            <input aria-label={`Quantidade de ${i.description}`} inputMode="decimal" disabled={disabled || !s.on} value={s.qty} onChange={(e) => setSel({ ...sel, [i.id]: { ...s, qty: e.target.value } })} className={cn("focus-ring h-8 w-20 rounded border px-2 text-right tabular", l.over ? "border-red-500" : "border-line")} />
                            {l.over && <span className="block text-xs text-red-700">máx. {formatQty(i.returnable)}</span>}
                          </td>
                          <td>
                            <select aria-label={`Motivo de ${i.description}`} disabled={disabled || !s.on} value={s.reason} onChange={(e) => setSel({ ...sel, [i.id]: { ...s, reason: e.target.value } })} className={cn("focus-ring h-8 rounded border bg-white px-1 text-sm", s.on && !s.reason ? "border-amber-500" : "border-line")}>
                              <option value="">Motivo…</option>
                              {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>
                          <td>
                            <select aria-label={`Condição de ${i.description}`} disabled={disabled || !s.on || i.service} value={s.condition} onChange={(e) => setSel({ ...sel, [i.id]: { ...s, condition: e.target.value as any } })} className="focus-ring h-8 rounded border border-line bg-white px-1 text-sm">
                              <option value="resellable">Revenda (estoque disponível)</option>
                              <option value="damaged">Avaria (depósito de avarias)</option>
                            </select>
                          </td>
                          <td className="tabular text-right">
                            {formatMoney(i.unitNet)} <span className="text-xs text-slate-500">/un.</span>
                            {l.on && <span className="block font-medium">{formatMoney(l.value ?? roundDiv(i.total * l.qty, i.qty))}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold"><td colSpan={5} className="px-3 py-2">{chosen.length ? `${chosen.length} produto(s) selecionado(s)` : "Nenhum produto selecionado"}</td><td className="tabular px-3 py-2 text-right">{formatMoney(estimated)}</td></tr>
                  </tfoot>
                </table>
              </div>
              <p className="px-4 py-2 text-xs text-slate-500">Valor = líquido pago no item (após descontos e rateio), proporcional à quantidade. A quantidade é limitada ao restante devolvível — inclusive contra devoluções simultâneas.</p>
            </section>
            <section className="rounded-lg border border-line bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">2. Como deseja compensar o cliente?</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { key: "store_credit", icon: <Gift className="size-5" />, title: "Vale-crédito", text: "Gera saldo para uma nova compra", disabled: !props.sale.customerId, why: "Exige cliente identificado na venda" },
                  { key: "refund", icon: <Wallet className="size-5" />, title: "Estorno", text: "Devolve o valor (forma original sugerida)" },
                  { key: "exchange", icon: <ArrowLeftRight className="size-5" />, title: "Troca imediata", text: "Abre o PDV para os novos produtos com o vale aplicado" },
                ].map((o) => (
                  <button key={o.key} type="button" disabled={o.disabled} title={o.disabled ? o.why : undefined} onClick={() => setCompensation(o.key as any)} aria-pressed={compensation === o.key} className={cn("focus-ring flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm", compensation === o.key ? "border-accent-500 bg-accent-50" : "border-line hover:border-brand-300", o.disabled && "cursor-not-allowed opacity-50")}>
                    <span className="flex items-center gap-2 font-medium">{o.icon} {o.title}</span>
                    <span className="text-xs text-slate-500">{o.disabled ? o.why : o.text}</span>
                  </button>
                ))}
              </div>
              {compensation === "refund" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Forma do estorno" hint={`Pagamento original: ${props.payments.map((p) => `${p.name} ${formatMoney(p.amount)}`).join(" + ")}`}>
                    <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} options={[{ value: "cash", label: "Dinheiro (sai do caixa aberto)" }, { value: "pix", label: "Pix (sai da conta)" }, { value: "card_reversal", label: "Estorno no cartão (adquirente)" }, { value: "account", label: "Transferência / conta" }]} />
                  </Field>
                  {(refundMethod === "pix" || refundMethod === "account") && (
                    <Field label="Conta de saída" required>
                      <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} options={props.accounts} />
                    </Field>
                  )}
                  {refundMethod === "cash" && <p className={cn("self-end text-xs", props.cashSession ? "text-slate-600" : "text-red-700")}>{props.cashSession ? `Saída registrada no caixa nº ${props.cashSession.number}${props.cashSession.terminalName ? ` (${props.cashSession.terminalName})` : ""}.` : "Nenhum caixa aberto para você nesta filial: abra o caixa antes de devolver em dinheiro."}</p>}
                </div>
              )}
              <Field label="Observações da operação" className="mt-3">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Descreva detalhes relevantes da troca ou devolução" maxLength={1000} />
              </Field>
            </section>
          </div>
          <aside className="space-y-3">
            <section className="rounded-lg border border-line bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold">3. Impactos da operação</h2>
              <ul className="space-y-3 text-sm">
                <li className="flex gap-2"><Package className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><b>Estoque.</b> {chosen.length ? `${resellable ? `Itens para revenda voltam ao estoque disponível da ${props.sale.branchName}. ` : ""}${damaged ? "Itens avariados vão ao depósito de avarias (não ficam disponíveis)." : ""}` : "Selecione os itens."} Movimentos só após a confirmação.</span></li>
                <li className="flex gap-2"><FileText className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><b>Fiscal.</b> {props.doc?.status === "authorized" ? `Será gerado o rascunho da NF-e de devolução referenciando a ${props.doc.model === "nfce" ? "NFC-e" : "NF-e"} original, para revisão no módulo Fiscal.` : "A venda não tem documento autorizado a referenciar; nenhum documento de devolução será gerado automaticamente."}</span></li>
                <li className="flex gap-2"><Undo2 className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><b>Financeiro.</b> {chosen.length ? financeImpact : "—"}</span></li>
                <li className="flex gap-2"><History className="mt-0.5 size-4 shrink-0 text-brand-700" /><span><b>Auditoria.</b> Usuário, data, motivos e compensação ficam registrados; a venda original é preservada.</span></li>
              </ul>
            </section>
            <section className="rounded-lg border border-line bg-white p-4 text-sm">
              <dl className="space-y-1">
                <div className="flex justify-between"><dt>Produtos selecionados</dt><dd className="tabular">{chosen.length}</dd></div>
                <div className="flex justify-between"><dt>Taxas ou diferenças</dt><dd className="tabular">{formatMoney(0)}</dd></div>
                <div className="flex justify-between text-base font-semibold text-accent-700"><dt>Valor da operação</dt><dd className="tabular">{formatMoney(estimated)}</dd></div>
              </dl>
              <input type="hidden" name="items" value={JSON.stringify(chosen.map((l) => ({ saleItemId: l.item.id, qty: l.qty, condition: l.item.service ? "resellable" : l.condition, reason: l.reason })))} />
              <input type="hidden" name="compensation" value={compensation} />
              <input type="hidden" name="refundMethod" value={compensation === "refund" ? refundMethod : ""} />
              <input type="hidden" name="refundAccountId" value={compensation === "refund" && (refundMethod === "pix" || refundMethod === "account") ? accountId : ""} />
              <input type="hidden" name="notes" value={notes} />
              {chosen.some((l) => !l.reason) && <p className="mt-2 text-xs text-amber-800">Informe o motivo de cada item selecionado.</p>}
              {needsCustomer && <p className="mt-2 text-xs text-red-700">Vale-crédito exige cliente identificado.</p>}
              <button type="submit" disabled={pending || invalid || needsCustomer || cashBlocked} aria-busy={pending || undefined} className={buttonClass("accent", "md", "mt-3 w-full")}>
                {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <CheckCircle2 className="size-4" />} Confirmar {compensation === "exchange" ? "troca" : "devolução"}
              </button>
              {(invalid || needsCustomer || cashBlocked) && <p className="mt-2 text-xs text-slate-500">O servidor valida novamente quantidades, permissões e caixa antes de registrar.</p>}
            </section>
          </aside>
        </div>
      )}
    </ActionForm>
  );
}
