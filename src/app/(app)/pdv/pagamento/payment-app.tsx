"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Copy, CreditCard, FileText, Gift, Landmark, Loader2, QrCode, RefreshCcw, Trash2, Wallet, XCircle } from "lucide-react";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { changeFor, previewSchedule } from "@/domain/cart-calc";
import { cancelPixAction, createPixAction, finalizeCartAction, saveCartAction, simulatePixAction } from "../actions";

interface Method { id: string; name: string; kind: string; maxInstallments: number; requiresCustomer: boolean; allowsChange: boolean; feeBps: number; hasAccount: boolean }
interface Term { id: string; name: string; installments: number; firstDueDays: number; intervalDays: number; interestBps?: number }
interface Intent { id: string; status: string; amount: number; reference: string; qrCode: string | null; qrCodeImage: string | null; expiresAt: string | null; isSimulated: boolean; saleId: string | null }
interface Draft {
  key: string;
  methodId: string;
  kind: string;
  label: string;
  amount: number;
  received?: number;
  installments?: number;
  paymentTermId?: string | null;
  intentId?: string | null;
  nsu?: string | null;
  authCode?: string | null;
  cardBrand?: string | null;
  voucherCode?: string | null;
  reference?: string | null;
  detail?: string;
}

const ICON: Record<string, React.ReactNode> = {
  cash: <Banknote className="size-5" />, debit: <CreditCard className="size-5" />, credit: <CreditCard className="size-5" />, pix: <QrCode className="size-5" />,
  crediario: <FileText className="size-5" />, boleto: <Landmark className="size-5" />, store_credit: <Gift className="size-5" />,
};
const BRANDS = ["Visa", "Mastercard", "Elo", "Hipercard", "American Express", "Outra"];
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));

/**
 * Pagamento da venda (Tela 7): combina meios, troco, parcelas, vencimentos e saldo restante.
 * Pix integrado só conclui após confirmação do provedor; cartão sem TEF registra NSU/autorização (manual).
 * A conclusão usa a chave do atendimento: repetir nunca cria outra venda ou cobrança.
 */
export function PaymentApp(props: {
  cartId: string;
  total: number;
  summary: { subtotal: number; discount: number; surcharge: number; items: Array<{ name: string; sku: string; qty: number; unitCode: string; total: number }> };
  stockWarnings: string[];
  terminal: { id: string; name: string };
  session: { id: string; number: number; operatorName: string } | null;
  customer: { id: string; name: string; doc: string | null; email: string | null; creditLimit: number; creditAvailable: number } | null;
  cpfOnInvoice: string | null;
  methods: Method[];
  terms: Term[];
  pix: { configured: boolean; provider: string | null; simulated: boolean; status: string; label: string | null };
  card: { provider: string | null; acquirer: string | null };
  intents: Intent[];
  drafts: Draft[];
  exchangeVoucher: { code: string; balance: number; returnNumber: number } | null;
  today: string;
  initialMethodId: string | null;
  emitFiscal: boolean;
  fiscalLabel: string;
  itemsCount: number;
  unitsCount: number;
  discountLimitBps: number;
  approvalNeeded: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [payments, setPayments] = useState<Draft[]>(() => {
    const d = (props.drafts ?? []).filter((x) => x && x.methodId);
    if (!d.length && props.exchangeVoucher) {
      const vm = props.methods.find((m) => m.kind === "store_credit");
      if (vm) return [{ key: newKey(), methodId: vm.id, kind: "store_credit", label: vm.name, amount: Math.min(props.exchangeVoucher.balance, props.total), voucherCode: props.exchangeVoucher.code, detail: `Vale ${props.exchangeVoucher.code} (troca nº ${props.exchangeVoucher.returnNumber})` }];
    }
    return d;
  });
  const [methodId, setMethodId] = useState<string>(props.methods.find((m) => m.id === props.initialMethodId)?.id ?? props.methods[0]?.id ?? "");
  const [emitFiscal, setEmitFiscal] = useState(props.emitFiscal);
  const [receipt, setReceipt] = useState("imprimir");
  const [approval, setApproval] = useState({ login: "", password: "" });
  useEffect(() => {
    try {
      const v = localStorage.getItem("ic.pdv.receipt");
      if (v) setReceipt(v);
    } catch {
      /* ignore */
    }
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const firstSave = useRef(true);

  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = props.total - paid;
  const change = payments.reduce((a, p) => a + (p.kind === "cash" ? changeFor(p.received ?? p.amount, p.amount) : 0), 0);
  const method = props.methods.find((m) => m.id === methodId) ?? null;

  // rascunho dos pagamentos gravado no atendimento (atualização acidental não perde Pix/valores)
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      if (!props.exchangeVoucher || props.drafts.length) return;
    }
    const t = setTimeout(() => void saveCartAction(props.cartId, { payments: payments as any }), 400);
    return () => clearTimeout(t);
  }, [payments, props.cartId, props.exchangeVoucher, props.drafts.length]);

  const add = (d: Omit<Draft, "key">) => {
    if (d.amount <= 0) return toast("error", "Informe um valor positivo.");
    if (d.amount > remaining) return toast("error", `Valor maior que o saldo restante (${formatMoney(remaining)}).`);
    setPayments((p) => [...p, { ...d, key: newKey() }]);
    setError(null);
  };

  const conclude = useCallback(() => {
    if (remaining !== 0 || pending) return;
    setError(null);
    start(async () => {
      try {
        localStorage.setItem("ic.pdv.receipt", receipt);
      } catch {
        /* ignore */
      }
      const res = await finalizeCartAction(props.cartId, payments.map(({ key: _k, kind: _kind, label: _l, detail: _d, ...p }) => p), { approval: props.approvalNeeded ? approval : null, receipt });
      if (!res.ok) {
        setError(res.error);
        toast("error", res.error);
        return;
      }
      toast("success", res.message ?? "Venda concluída.");
      router.push(res.redirect ?? "/pdv");
    });
  }, [remaining, pending, payments, props.cartId, props.approvalNeeded, approval, receipt, router, toast]);

  // atalhos: 1–9 escolhe o meio; F10/Ctrl+Enter conclui; Esc volta ao PDV
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.key === "F10" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        conclude();
      } else if (e.key === "Escape" && !typing) {
        e.preventDefault();
        router.push("/pdv");
      } else if (!typing && /^[1-9]$/.test(e.key)) {
        const m = props.methods[Number(e.key) - 1];
        if (m) setMethodId(m.id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [conclude, props.methods, router]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 bg-brand-900 px-3 py-2 text-sm text-white">
        <Link href="/pdv" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-brand-800"><ArrowLeft className="size-4" /> Voltar ao atendimento <kbd className="rounded border border-white/30 px-1 text-xs">Esc</kbd></Link>
        <span className="font-semibold">Pagamento da venda</span>
        <span className="text-brand-200">{props.itemsCount} {props.itemsCount === 1 ? "produto" : "produtos"} • {formatQty(props.unitsCount)} un. · {props.terminal.name}</span>
        <ol className="hidden items-center gap-1 text-xs lg:flex" aria-label="Etapas">
          <li className="rounded-full bg-brand-800 px-2 py-0.5 text-brand-200">1 Carrinho ✓</li>
          <li aria-hidden>›</li>
          <li className="rounded-full bg-brand-800 px-2 py-0.5 text-brand-200">2 Cliente ✓</li>
          <li aria-hidden>›</li>
          <li className="rounded-full bg-accent-500 px-2 py-0.5 font-semibold text-white" aria-current="step">3 Pagamento</li>
        </ol>
        {props.session ? <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-emerald-100">Caixa nº {props.session.number} · {props.session.operatorName}</span> : <span className="rounded bg-red-500/20 px-2 py-0.5 text-red-100">Caixa fechado</span>}
        <span className="ml-auto text-brand-200">{props.customer ? `${props.customer.name}${props.customer.doc ? " · " + formatDoc(props.customer.doc) : ""}` : props.cpfOnInvoice ? `Consumidor final · CPF/CNPJ ${formatDoc(props.cpfOnInvoice)}` : "Consumidor final"}</span>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex flex-col gap-3">
          {!props.session && (
            <Notice tone="bad" title="Caixa fechado neste terminal">
              Abra o caixa para concluir a venda. <Link className="underline" href={`/caixa/abertura?terminal=${props.terminal.id}`}>Abrir caixa</Link>
            </Notice>
          )}
          {props.stockWarnings.length > 0 && <Notice tone="warn" title="Venda sem saldo (permitida pela configuração comercial)">{props.stockWarnings.join("; ")}</Notice>}
          <div className="rounded-lg border border-line bg-white p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Forma de pagamento <span className="normal-case text-slate-400">(teclas 1–{Math.min(9, props.methods.length)})</span></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
              {props.methods.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethodId(m.id)}
                  aria-pressed={m.id === methodId}
                  className={cn("focus-ring flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-sm font-medium transition-colors", m.id === methodId ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-white hover:border-brand-300")}
                >
                  {ICON[m.kind] ?? <Wallet className="size-5" />}
                  <span className="text-center leading-tight">{m.name}</span>
                  {i < 9 && <kbd className="rounded border border-line px-1 text-[10px] text-slate-400">{i + 1}</kbd>}
                </button>
              ))}
            </div>
          </div>
          {method && remaining > 0 && (
            <div className="rounded-lg border border-line bg-white p-4">
              <MethodForm key={method.id + ":" + remaining} method={method} remaining={remaining} props={props} onAdd={add} existing={payments} />
            </div>
          )}
          {remaining <= 0 && payments.length > 0 && (
            <Notice tone="good" title="Pagamento completo">Confira os valores e conclua a venda (F10 ou Ctrl+Enter).</Notice>
          )}
        </section>
        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">Total da venda</span>
              <span className="tabular text-3xl font-bold text-brand-800" data-testid="pay-total">{formatMoney(props.total)}</span>
            </div>
            <dl className="mt-2 space-y-1 text-sm text-slate-600">
              <div className="flex justify-between"><dt>Bruto / descontos / acréscimos</dt><dd className="tabular">{formatMoney(props.summary.subtotal)} / −{formatMoney(props.summary.discount)} / +{formatMoney(props.summary.surcharge)}</dd></div>
              <div className="flex justify-between"><dt>Pago</dt><dd className="tabular">{formatMoney(paid)}</dd></div>
              <div className={cn("flex justify-between text-base font-semibold", remaining > 0 ? "text-amber-700" : "text-emerald-700")}><dt>Saldo restante</dt><dd className="tabular" data-testid="pay-remaining">{formatMoney(Math.max(0, remaining))}</dd></div>
              {change > 0 && <div className="flex justify-between text-base font-semibold text-brand-800"><dt>Troco</dt><dd className="tabular" data-testid="pay-change">{formatMoney(change)}</dd></div>}
            </dl>
          </div>
          <div className="rounded-lg border border-line bg-white">
            <p className="border-b border-line px-4 py-2 text-sm font-semibold">Pagamentos lançados</p>
            {payments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Nenhum pagamento lançado.</p>
            ) : (
              <ul className="divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.key} className="flex items-start justify-between gap-2 px-4 py-2 text-sm">
                    <div>
                      <p className="font-medium">{p.label}{p.installments && p.installments > 1 ? ` · ${p.installments}x` : ""}</p>
                      <p className="text-xs text-slate-500">{p.detail}</p>
                      {p.kind === "cash" && (p.received ?? 0) > p.amount && <p className="text-xs text-slate-500">Recebido {formatMoney(p.received)} · troco {formatMoney((p.received ?? 0) - p.amount)}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular font-semibold">{formatMoney(p.amount)}</span>
                      <button type="button" aria-label={`Remover ${p.label}`} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={() => setPayments((x) => x.filter((y) => y.key !== p.key))}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2 rounded-lg border border-line bg-white p-3 text-sm">
            <label className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={emitFiscal}
                  onChange={(e) => {
                    setEmitFiscal(e.target.checked);
                    void saveCartAction(props.cartId, { emitFiscal: e.target.checked });
                  }}
                />
                Emitir NFC-e após confirmar
              </span>
              <span className="text-xs text-slate-500">{props.fiscalLabel}</span>
            </label>
            <Field label="Comprovante">
              <Select
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
                options={[
                  { value: "imprimir", label: "Imprimir recibo ao concluir" },
                  ...(props.customer?.email ? [{ value: "email", label: `Enviar por e-mail (${props.customer.email})` }, { value: "imprimir_email", label: "Imprimir e enviar por e-mail" }] : []),
                  { value: "nenhum", label: "Não imprimir agora" },
                ]}
              />
            </Field>
            <p className="text-xs text-slate-500">DANFE NFC-e: disponível na conclusão após a autorização do documento. <Link className="text-brand-700 underline" href="/pdv">Aplicar desconto (voltar ao atendimento)</Link></p>
          </div>
          {props.approvalNeeded && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900"><AlertTriangle className="mr-1 inline size-4" />Autorização do supervisor</p>
              <p className="text-xs text-amber-900">{props.approvalNeeded}</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Login do supervisor" value={approval.login} onChange={(e) => setApproval({ ...approval, login: e.target.value })} autoComplete="off" aria-label="Login do supervisor" />
                <Input placeholder="Senha" type="password" value={approval.password} onChange={(e) => setApproval({ ...approval, password: e.target.value })} autoComplete="new-password" aria-label="Senha do supervisor" />
              </div>
              <p className="text-xs text-amber-800">A credencial é validada na conclusão e o autorizador fica registrado na venda e na auditoria.</p>
            </div>
          )}
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <Button size="lg" variant="accent" className="h-14 text-lg" disabled={remaining !== 0 || pending || !props.session || (Boolean(props.approvalNeeded) && (!approval.login || !approval.password))} loading={pending} onClick={conclude}>
            <CheckCircle2 className="size-5" /> {emitFiscal ? "Confirmar e emitir NFC-e" : "Confirmar venda"} <kbd className="ml-1 rounded border border-white/40 px-1 text-xs">F10</kbd>
          </Button>
          <p className="text-xs text-slate-500">Ao concluir: baixa de estoque, caixa, financeiro (recebíveis/parcelas) e emissão da NFC-e. Repetir o envio não duplica a venda.</p>
          <details className="rounded-lg border border-line bg-white p-3 text-sm">
            <summary className="cursor-pointer font-medium">Itens ({props.summary.items.length})</summary>
            <ul className="mt-2 space-y-1">
              {props.summary.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-2"><span className="truncate">{formatQty(i.qty)} {i.unitCode} · {i.name}</span><span className="tabular">{formatMoney(i.total)}</span></li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  );
}

type AppProps = Parameters<typeof PaymentApp>[0];

function MethodForm({ method, remaining, props, onAdd, existing }: { method: Method; remaining: number; props: AppProps; onAdd: (d: Omit<Draft, "key">) => void; existing: Draft[] }) {
  const [amount, setAmount] = useState(remaining);
  const base = { methodId: method.id, kind: method.kind, label: method.name };
  if (method.requiresCustomer && !props.customer) {
    return (
      <Notice tone="warn" title={`${method.name} exige cliente identificado`}>
        Volte ao atendimento e identifique o cliente (F4). <Link className="underline" href="/pdv">Voltar ao PDV</Link>
      </Notice>
    );
  }
  switch (method.kind) {
    case "cash":
      return <CashForm method={method} remaining={remaining} onAdd={onAdd} />;
    case "debit":
    case "credit":
      return <CardForm method={method} remaining={remaining} onAdd={onAdd} card={props.card} />;
    case "pix":
      return <PixForm method={method} remaining={remaining} onAdd={onAdd} props={props} existing={existing} />;
    case "crediario":
    case "boleto":
      return <DeferredForm method={method} remaining={remaining} onAdd={onAdd} props={props} />;
    case "store_credit":
      return <VoucherForm method={method} remaining={remaining} onAdd={onAdd} defaultCode={props.exchangeVoucher?.code ?? ""} existing={existing} />;
    default:
      return (
        <OtherForm method={method} amount={amount} setAmount={setAmount} onAdd={(reference) => onAdd({ ...base, amount, reference, detail: reference ? `Ref. ${reference}` : undefined })} />
      );
  }
}

function CashForm({ method, remaining, onAdd }: { method: Method; remaining: number; onAdd: (d: Omit<Draft, "key">) => void }) {
  const [received, setReceived] = useState(remaining);
  const applied = Math.min(received, remaining);
  const change = changeFor(received, applied);
  const submit = () => onAdd({ methodId: method.id, kind: "cash", label: method.name, amount: applied, received, detail: change ? `Recebido ${formatMoney(received)} · troco ${formatMoney(change)}` : "Valor exato" });
  const notes = [remaining, Math.ceil(remaining / 1000) * 1000, Math.ceil(remaining / 5000) * 5000, Math.ceil(remaining / 10000) * 10000, 10000, 20000].filter((v, i, a) => v >= remaining && a.indexOf(v) === i).sort((a, b) => a - b).slice(0, 5);
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid gap-3 sm:grid-cols-2">
      <Field label="Valor recebido em dinheiro" hint={`Saldo restante ${formatMoney(remaining)}`}>
        <MoneyInput value={received} onChange={setReceived} autoFocus ariaLabel="Valor recebido" className="h-12 text-lg" />
      </Field>
      <div className="flex flex-col justify-end gap-2">
        <div className="flex flex-wrap gap-1">
          {notes.map((n) => <Button key={n} type="button" size="sm" onClick={() => setReceived(n)}>{n === remaining ? "Valor exato" : formatMoney(n)}</Button>)}
        </div>
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span>Aplicado na venda: <b className="tabular">{formatMoney(applied)}</b></span>
        <span className="text-lg">Troco: <b className="tabular text-brand-800">{formatMoney(change)}</b></span>
      </div>
      <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" disabled={received <= 0}>Lançar dinheiro (Enter)</Button></div>
    </form>
  );
}

function CardForm({ method, remaining, onAdd, card }: { method: Method; remaining: number; onAdd: (d: Omit<Draft, "key">) => void; card: AppProps["card"] }) {
  const [amount, setAmount] = useState(remaining);
  const [installments, setInstallments] = useState(1);
  const [nsu, setNsu] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [brand, setBrand] = useState("");
  const credit = method.kind === "credit";
  const ok = amount > 0 && (nsu.trim() || authCode.trim());
  const submit = () => {
    if (!ok) return;
    onAdd({ methodId: method.id, kind: method.kind, label: method.name, amount, installments: credit ? installments : 1, nsu: nsu.trim() || null, authCode: authCode.trim() || null, cardBrand: brand || null, detail: `Manual · NSU ${nsu || "—"} · Aut. ${authCode || "—"}${brand ? " · " + brand : ""}` });
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid gap-3 sm:grid-cols-2">
      <p className="sm:col-span-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
        {card.provider === "tef_connector" ? "TEF por conector local configurado, mas a transação integrada não está disponível neste navegador: " : "Sem TEF integrado: "}
        passe o cartão na maquininha{card.acquirer ? ` (${card.acquirer})` : ""} e registre o NSU e/ou a autorização impressos no comprovante. O pagamento fica marcado como manual.
      </p>
      <Field label="Valor" hint={<button type="button" className="text-brand-700 underline" onClick={() => setAmount(remaining)}>Valor restante ({formatMoney(remaining)})</button>}>
        <MoneyInput value={amount} onChange={setAmount} autoFocus ariaLabel="Valor no cartão" />
      </Field>
      {credit ? (
        <Field label="Parcelas" hint={`Até ${method.maxInstallments}x`}>
          <Select value={String(installments)} onChange={(e) => setInstallments(Number(e.target.value))} options={Array.from({ length: Math.max(1, method.maxInstallments) }, (_, i) => ({ value: String(i + 1), label: `${i + 1}x de ${formatMoney(Math.floor(amount / (i + 1)))}` }))} />
        </Field>
      ) : (
        <div />
      )}
      <Field label="NSU / DOC" required={!authCode}>
        <Input value={nsu} onChange={(e) => setNsu(e.target.value)} inputMode="numeric" maxLength={30} />
      </Field>
      <Field label="Código de autorização" required={!nsu}>
        <Input value={authCode} onChange={(e) => setAuthCode(e.target.value)} maxLength={30} />
      </Field>
      <Field label="Bandeira (opcional)">
        <Select value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="—" options={BRANDS.map((b) => ({ value: b, label: b }))} />
      </Field>
      <div className="flex items-end justify-end">
        <Button type="submit" variant="primary" disabled={!ok}>Lançar {method.name}</Button>
      </div>
    </form>
  );
}

function QrImage({ intent }: { intent: Intent }) {
  const [src, setSrc] = useState<string | null>(intent.qrCodeImage ? `data:image/png;base64,${intent.qrCodeImage}` : null);
  useEffect(() => {
    if (intent.qrCodeImage || !intent.qrCode) return;
    QRCode.toDataURL(intent.qrCode, { margin: 1, width: 220 }).then(setSrc).catch(() => setSrc(null));
  }, [intent.qrCode, intent.qrCodeImage]);
  if (!src) return <div className="flex size-[220px] items-center justify-center rounded border border-dashed border-line text-xs text-slate-400">QR indisponível</div>;
  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="QR Code Pix" width={220} height={220} className={cn("rounded border border-line", intent.isSimulated && "opacity-60")} />
      {intent.isSimulated && <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 rotate-[-12deg] bg-fuchsia-600/90 py-1 text-center text-xs font-bold text-white">SIMULAÇÃO — NÃO PAGAR</span>}
    </div>
  );
}

function PixForm({ method, remaining, onAdd, props, existing }: { method: Method; remaining: number; onAdd: (d: Omit<Draft, "key">) => void; props: AppProps; existing: Draft[] }) {
  const toast = useToast();
  const used = new Set(existing.map((e) => e.intentId).filter(Boolean));
  const reusable = props.intents.find((i) => ["pending", "confirmed", "unknown"].includes(i.status) && !i.saleId && !used.has(i.id));
  const [amount, setAmount] = useState(reusable?.status === "confirmed" ? reusable.amount : remaining);
  const [intent, setIntent] = useState<Intent | null>(reusable ?? null);
  const [manual, setManual] = useState(!props.pix.configured);
  const [reference, setReference] = useState("");
  const [busy, startBusy] = useTransition();
  const addedRef = useRef<string | null>(null);

  const applyConfirmed = useCallback(
    (i: Intent) => {
      if (addedRef.current === i.id) return;
      addedRef.current = i.id;
      onAdd({ methodId: method.id, kind: "pix", label: method.name, amount: i.amount, intentId: i.id, detail: `Pix ${i.isSimulated ? "SIMULADO" : "confirmado pelo provedor"} · ref. ${i.reference}` });
      toast("success", `Pix de ${formatMoney(i.amount)} confirmado.`);
    },
    [method.id, method.name, onAdd, toast],
  );

  // consulta periódica ao provedor enquanto pendente
  useEffect(() => {
    if (!intent || !["pending", "unknown"].includes(intent.status)) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/pdv/intents/${intent.id}`, { cache: "no-store" });
        const body = await res.json();
        if (alive && res.ok && body.status !== intent.status) setIntent((x) => (x ? { ...x, status: body.status } : x));
      } catch {
        /* rede instável: tenta no próximo ciclo */
      }
    };
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intent]);

  useEffect(() => {
    if (intent?.status === "confirmed" && !intent.saleId && intent.amount <= remaining) applyConfirmed(intent);
  }, [intent, remaining, applyConfirmed]);

  const generate = () =>
    startBusy(async () => {
      const res = await createPixAction(props.cartId, amount, props.customer?.email ?? null);
      if (!res.ok) return toast("error", res.error);
      setIntent({ ...(res.data as any), saleId: null } as Intent);
    });
  const query = () =>
    startBusy(async () => {
      if (!intent) return;
      const res = await fetch(`/api/pdv/intents/${intent.id}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) return toast("error", body.error ?? "Falha na consulta");
      setIntent({ ...intent, status: body.status });
      toast("info", `Situação no provedor: ${body.status}`);
    });
  const simulate = (status: "confirmed" | "failed") =>
    startBusy(async () => {
      if (!intent) return;
      const res = await simulatePixAction(intent.id, status);
      if (!res.ok) return toast("error", res.error);
      setIntent({ ...intent, status: (res.data as any).status });
    });
  const cancel = () =>
    startBusy(async () => {
      if (!intent) return;
      const res = await cancelPixAction(intent.id);
      if (!res.ok) return toast("error", res.error);
      const status = (res.data as any)?.status as string;
      if (status === "confirmed") {
        // pago no provedor antes do cancelamento: mantém a cobrança para aplicar na venda
        toast("info", res.message ?? "Pix já confirmado pelo provedor.");
        return setIntent({ ...intent, status: "confirmed" });
      }
      toast("success", res.message ?? "Cobrança cancelada no provedor.");
      setIntent(status === "cancelled" ? null : { ...intent, status: status as any });
    });

  if (manual) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (reference.trim()) onAdd({ methodId: method.id, kind: "pix", label: `${method.name} (manual)`, amount, reference: reference.trim(), detail: `Manual · comprovante ${reference.trim()}` }); }} className="grid gap-3 sm:grid-cols-2">
        <p className="sm:col-span-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Pix manual: confira o comprovante do cliente e informe o identificador da transação (E2E/ID). O pagamento fica registrado como manual, sem confirmação automática do provedor.
          {props.pix.configured && <button type="button" className="ml-1 underline" onClick={() => setManual(false)}>Usar cobrança integrada</button>}
        </p>
        <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} ariaLabel="Valor Pix" /></Field>
        <Field label="Identificador do comprovante (E2E/ID)" required><Input value={reference} onChange={(e) => setReference(e.target.value)} autoFocus maxLength={120} placeholder="E2E…" /></Field>
        <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" disabled={!reference.trim() || amount <= 0}>Lançar Pix manual</Button></div>
      </form>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        Provedor: <b className="text-ink">{props.pix.label ?? props.pix.provider}</b> <StatusBadge kind="integration" status={props.pix.status} /> {props.pix.simulated && <SimBadge />}
        <button type="button" className="ml-auto underline" onClick={() => setManual(true)}>Registrar Pix manual (comprovante)</button>
      </div>
      {!intent || ["failed", "cancelled", "expired"].includes(intent.status) ? (
        <form onSubmit={(e) => { e.preventDefault(); generate(); }} className="flex flex-wrap items-end gap-3">
          <Field label="Valor da cobrança" className="min-w-[200px]"><MoneyInput value={amount} onChange={setAmount} autoFocus ariaLabel="Valor da cobrança Pix" /></Field>
          <Button type="submit" variant="primary" loading={busy} disabled={amount <= 0 || amount > remaining}><QrCode className="size-4" /> Gerar cobrança Pix</Button>
          {intent && <p className="w-full text-sm text-red-700"><XCircle className="mr-1 inline size-4" />Cobrança anterior {intent.status === "failed" ? "falhou" : intent.status === "expired" ? "expirou" : "foi cancelada no provedor"} (ref. {intent.reference}). Uma nova cobrança só é criada após consultar a anterior.</p>}
        </form>
      ) : (
        <div className="flex flex-wrap gap-4">
          <QrImage intent={intent} />
          <div className="min-w-[240px] flex-1 space-y-2 text-sm">
            <p className="flex items-center gap-2">
              Cobrança <span className="font-mono text-xs">{intent.reference}</span> — <b className="tabular">{formatMoney(intent.amount)}</b>
              <StatusBadge kind="payment" status={intent.status === "pending" ? "pending" : intent.status} />
              {intent.isSimulated && <SimBadge />}
            </p>
            {intent.status === "pending" || intent.status === "unknown" ? (
              <p className="flex items-center gap-2 text-amber-800"><Loader2 className="size-4 animate-spin" /> Aguardando confirmação do provedor (consulta automática a cada 3 s)…</p>
            ) : intent.status === "confirmed" ? (
              <p className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="size-4" /> Confirmado pelo provedor{intent.amount > remaining ? " — valor maior que o saldo restante; remova outro pagamento para aplicá-lo." : "."}</p>
            ) : null}
            {intent.qrCode && (
              <div>
                <p className="text-xs text-slate-500">Pix copia e cola</p>
                <div className="flex gap-1">
                  <input readOnly value={intent.qrCode} className="h-8 flex-1 rounded border border-line bg-slate-50 px-2 font-mono text-xs" aria-label="Pix copia e cola" onFocus={(e) => e.target.select()} />
                  <Button type="button" size="sm" onClick={() => navigator.clipboard?.writeText(intent.qrCode!).then(() => toast("success", "Código copiado."))}><Copy className="size-4" /></Button>
                </div>
              </div>
            )}
            {intent.expiresAt && <p className="text-xs text-slate-500">Expira em {formatTime(intent.expiresAt)}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" onClick={query} loading={busy}><RefreshCcw className="size-4" /> Consultar agora</Button>
              {["pending", "unknown"].includes(intent.status) && <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={busy}>Cancelar cobrança</Button>}
              {intent.isSimulated && ["pending", "unknown"].includes(intent.status) && (
                <>
                  <Button type="button" size="sm" variant="outline" className="border-fuchsia-300 text-fuchsia-800 hover:bg-fuchsia-50" onClick={() => simulate("confirmed")} disabled={busy}>Simular confirmação (demonstração)</Button>
                  <Button type="button" size="sm" variant="ghost" className="text-fuchsia-800" onClick={() => simulate("failed")} disabled={busy}>Simular falha (demonstração)</Button>
                </>
              )}
              {intent.status === "confirmed" && !intent.saleId && intent.amount <= remaining && addedRef.current !== intent.id && <Button type="button" size="sm" variant="primary" onClick={() => applyConfirmed(intent)}>Aplicar Pix confirmado</Button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeferredForm({ method, remaining, onAdd, props }: { method: Method; remaining: number; onAdd: (d: Omit<Draft, "key">) => void; props: AppProps }) {
  const [amount, setAmount] = useState(remaining);
  const [termId, setTermId] = useState(props.terms.find((t) => t.installments > 1)?.id ?? props.terms[0]?.id ?? "");
  const term = props.terms.find((t) => t.id === termId) ?? null;
  const schedule = useMemo(() => previewSchedule(amount, term ? { installments: term.installments, firstDueDays: term.firstDueDays, intervalDays: term.intervalDays } : { installments: 1, firstDueDays: 30, intervalDays: 30 }, props.today), [amount, term, props.today]);
  const isCred = method.kind === "crediario";
  const c = props.customer!;
  const overLimit = isCred && amount > c.creditAvailable;
  const noLimit = isCred && c.creditLimit <= 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!overLimit && !noLimit) onAdd({ methodId: method.id, kind: method.kind, label: method.name, amount, paymentTermId: term?.id ?? null, installments: term?.installments ?? 1, detail: `${term?.name ?? "1x"} · 1º venc. ${formatDate(schedule[0]?.dueDate)}` }); }} className="grid gap-3 sm:grid-cols-2">
      <p className="sm:col-span-2 text-sm">Cliente: <b>{c.name}</b>{isCred && <> · limite {formatMoney(c.creditLimit)} · disponível <b className="tabular">{formatMoney(c.creditAvailable)}</b></>}</p>
      {noLimit && <div className="sm:col-span-2"><Notice tone="warn">Cliente sem limite de crédito no cadastro: o crediário não é concedido automaticamente. Ajuste o limite em Clientes.</Notice></div>}
      <Field label="Valor a prazo" hint={<button type="button" className="text-brand-700 underline" onClick={() => setAmount(remaining)}>Valor restante</button>}><MoneyInput value={amount} onChange={setAmount} autoFocus ariaLabel="Valor a prazo" /></Field>
      <Field label="Condição de pagamento" hint={term?.interestBps ? "Sem juros na venda: os juros cadastrados nesta condição só valem em títulos manuais (Financeiro)." : undefined}><Select value={termId} onChange={(e) => setTermId(e.target.value)} options={props.terms.map((t) => ({ value: t.id, label: t.name }))} /></Field>
      <div className="sm:col-span-2 rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-1.5 text-left">Parcela</th><th className="px-3 py-1.5 text-left">Vencimento</th><th className="px-3 py-1.5 text-right">Valor</th></tr></thead>
          <tbody>{schedule.map((s, i) => <tr key={i} className="border-t border-line"><td className="px-3 py-1.5">{i + 1}/{schedule.length}</td><td className="px-3 py-1.5">{formatDate(s.dueDate)}</td><td className="tabular px-3 py-1.5 text-right">{formatMoney(s.amount)}</td></tr>)}</tbody>
        </table>
      </div>
      {overLimit && <p className="sm:col-span-2 text-sm text-red-700"><AlertTriangle className="mr-1 inline size-4" />Valor acima do crédito disponível.</p>}
      <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" disabled={amount <= 0 || overLimit || noLimit}>Lançar {method.name}</Button></div>
    </form>
  );
}

function VoucherForm({ method, remaining, onAdd, defaultCode, existing }: { method: Method; remaining: number; onAdd: (d: Omit<Draft, "key">) => void; defaultCode: string; existing: Draft[] }) {
  const [code, setCode] = useState(defaultCode);
  const [info, setInfo] = useState<null | { code: string; balance: number; status: string; expiresAt: string | null; expired: boolean; customerName: string | null }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const usedHere = existing.filter((e) => e.kind === "store_credit" && e.voucherCode?.toUpperCase() === info?.code).reduce((a, e) => a + e.amount, 0);
  const lookup = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/pdv/vouchers?code=${encodeURIComponent(code.trim())}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setInfo(body);
      setAmount(Math.max(0, Math.min(body.balance - usedHere, remaining)));
    } catch (e: any) {
      setInfo(null);
      setErr(e.message ?? "Vale não encontrado.");
    } finally {
      setBusy(false);
    }
  };
  const usable = info && info.status === "active" && !info.expired;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!info) void lookup(); else if (usable) onAdd({ methodId: method.id, kind: "store_credit", label: method.name, amount, voucherCode: info.code, detail: `Vale ${info.code}` }); }} className="grid gap-3 sm:grid-cols-2">
      <Field label="Código do vale-crédito">
        <div className="flex gap-1">
          <Input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setInfo(null); }} autoFocus className="font-mono" />
          <Button type="button" onClick={lookup} loading={busy}>Consultar</Button>
        </div>
      </Field>
      {info && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          Saldo <b className="tabular">{formatMoney(info.balance)}</b> · {info.status === "active" ? (info.expired ? <Badge tone="bad">vencido</Badge> : <Badge tone="good">ativo</Badge>) : <Badge>{info.status}</Badge>}
          <span className="block text-xs text-slate-500">{info.customerName ? `Titular: ${info.customerName}` : "Sem titular"}{info.expiresAt ? ` · validade ${formatDate(info.expiresAt)}` : ""}</span>
        </div>
      )}
      {err && <p className="sm:col-span-2 text-sm text-red-700">{err}</p>}
      {usable && (
        <>
          <Field label="Valor a usar"><MoneyInput value={amount} onChange={setAmount} ariaLabel="Valor do vale" /></Field>
          <div className="flex items-end justify-end"><Button type="submit" variant="primary" disabled={amount <= 0 || amount > info!.balance - usedHere}>Lançar vale-crédito</Button></div>
        </>
      )}
    </form>
  );
}

function OtherForm({ method, amount, setAmount, onAdd }: { method: Method; amount: number; setAmount: (n: number) => void; onAdd: (reference: string | null) => void }) {
  const [reference, setReference] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onAdd(reference.trim() || null); }} className="grid gap-3 sm:grid-cols-2">
      <Field label="Valor"><MoneyInput value={amount} onChange={setAmount} autoFocus ariaLabel={`Valor ${method.name}`} /></Field>
      <Field label="Referência / autorização (opcional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" disabled={amount <= 0}>Lançar {method.name}</Button></div>
    </form>
  );
}
