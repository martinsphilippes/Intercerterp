"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/link";
import { CreditCard, Landmark, QrCode, Lock } from "lucide-react";
import type { ActionResult } from "@/lib/server/action";

type Option = { id: string; label: string; detail: string; price: number; free: boolean; mode: string; simulated: boolean };
type Quote = { options: Option[]; problems: string[]; subtotal: number; discount: number };
type Payload = {
  submissionKey: string;
  customer: { name: string; email: string; phone: string; doc: string };
  address: { zip: string; street: string; number: string; complement: string | null; district: string; cityName: string; cityCode: string | null; uf: string };
  deliveryOptionId: string;
  payment: { method: "pix" | "card" | "boleto"; installments: number; simulate: "approve" | "decline" | null; cardToken: string | null };
  acceptTerms: boolean;
  marketingConsent: boolean;
  notes: string | null;
};

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const input = "mt-1 block h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-[var(--store-accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--store-accent)_25%,white)]";
const label = "block text-sm font-medium text-slate-800";

export function CheckoutForm(props: {
  basePath: string;
  initialZip: string | null;
  initialQuote: Quote;
  initialSelected: string | null;
  itemsCount: number;
  methods: { pix: boolean; card: boolean; boleto: boolean; maxInstallments: number; minInstallment: number; pixMinutes: number; boletoDays: number };
  simulated: boolean;
  requireDoc: boolean;
  preview: boolean;
  quote: (zip: string) => Promise<ActionResult<Quote>>;
  place: (p: Payload) => Promise<ActionResult<{ token: string }>>;
}) {
  const router = useRouter();
  const submissionKey = useRef((typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^0-9a-f]/gi, "").toLowerCase().padEnd(32, "0").slice(0, 32));
  const [quote, setQuote] = useState<Quote>(props.initialQuote);
  const [deliveryId, setDeliveryId] = useState<string>(props.initialSelected && props.initialQuote.options.some((o) => o.id === props.initialSelected) ? props.initialSelected : (props.initialQuote.options[0]?.id ?? ""));
  const [c, setC] = useState({ name: "", email: "", phone: "", doc: "" });
  const [a, setA] = useState({ zip: props.initialZip ? props.initialZip.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "", street: "", number: "", complement: "", district: "", cityName: "", cityCode: "", uf: "" });
  const firstMethod = props.methods.pix ? "pix" : props.methods.card ? "card" : "boleto";
  const [method, setMethod] = useState<"pix" | "card" | "boleto">(firstMethod);
  const [installments, setInstallments] = useState(1);
  const [simulate, setSimulate] = useState<"approve" | "decline">("approve");
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [reviewed, setReviewed] = useState(!props.simulated);
  const [error, setError] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  const [placing, startPlace] = useTransition();

  const option = quote.options.find((o) => o.id === deliveryId) ?? null;
  const goods = quote.subtotal - quote.discount;
  const total = goods + (option?.price ?? 0);
  const maxInst = useMemo(() => {
    const byMin = props.methods.minInstallment > 0 ? Math.max(1, Math.floor(total / props.methods.minInstallment)) : props.methods.maxInstallments;
    return Math.max(1, Math.min(props.methods.maxInstallments, byMin));
  }, [total, props.methods]);

  const lookupZip = (raw: string) => {
    const zip = raw.replace(/\D/g, "");
    if (zip.length !== 8) return;
    startQuote(async () => {
      const r = await props.quote(zip);
      if (r.ok && r.data) {
        setQuote(r.data);
        if (!r.data.options.some((o) => o.id === deliveryId)) setDeliveryId(r.data.options[0]?.id ?? "");
      } else if (!r.ok) setError(r.error);
      // endereço pelo CEP (ViaCEP): melhora a digitação e traz o código IBGE exigido na nota fiscal
      try {
        const res = await fetch(`https://viacep.com.br/ws/${zip}/json/`, { signal: AbortSignal.timeout(5000) });
        const j = await res.json();
        if (!j.erro) setA((x) => ({ ...x, street: x.street || j.logradouro || "", district: x.district || j.bairro || "", cityName: j.localidade || x.cityName, uf: j.uf || x.uf, cityCode: j.ibge || "" }));
      } catch {
        /* sem consulta de CEP: o cliente digita o endereço */
      }
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!option) return setError("Escolha a forma de entrega.");
    if (!terms) return setError("Para concluir, aceite os termos de compra e a política de privacidade.");
    if (props.simulated && !reviewed) return setError("Confirme que revisou os dados e que entendeu que este pedido é uma simulação.");
    startPlace(async () => {
      const r = await props.place({
        submissionKey: submissionKey.current,
        customer: c,
        address: { ...a, complement: a.complement || null, cityCode: a.cityCode || null },
        deliveryOptionId: deliveryId,
        payment: { method, installments: method === "card" ? installments : 1, simulate: props.simulated && method === "card" ? simulate : null, cardToken: null },
        acceptTerms: terms,
        marketingConsent: marketing,
        notes: null,
      });
      if (!r.ok) {
        setError(r.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (r.redirect) router.push(r.redirect);
    });
  };

  const pickup = option?.mode === "pickup";
  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-5" noValidate>
      <div className="space-y-6 lg:col-span-3">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="co-1">
          <h2 id="co-1" className="text-lg font-semibold text-slate-900">1. Identificação</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={`${label} sm:col-span-2`}>Nome completo<input className={input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoComplete="name" required /></label>
            <label className={label}>E-mail<input className={input} type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} autoComplete="email" required /></label>
            <label className={label}>Celular com DDD<input className={input} value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} autoComplete="tel" inputMode="tel" required /></label>
            <label className={label}>CPF ou CNPJ{props.requireDoc ? "" : " (opcional)"}<input className={input} value={c.doc} onChange={(e) => setC({ ...c, doc: e.target.value })} inputMode="numeric" required={props.requireDoc} /><span className="mt-1 block text-xs font-normal text-slate-500">Necessário para a nota fiscal.</span></label>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="co-2">
          <h2 id="co-2" className="text-lg font-semibold text-slate-900">2. Entrega</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className={label}>CEP
              <input className={`${input} tabular-nums`} value={a.zip} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2"); setA({ ...a, zip: v }); if (v.replace(/\D/g, "").length === 8) lookupZip(v); }} inputMode="numeric" autoComplete="postal-code" required />
            </label>
          </div>
          <div className="mt-4 space-y-2" role="radiogroup" aria-label="Forma de entrega" aria-busy={quoting}>
            {quote.options.map((o) => {
              const on = o.id === deliveryId;
              return (
                <label key={o.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 ${on ? "border-[var(--store-accent)] bg-[color-mix(in_srgb,var(--store-accent)_7%,white)]" : "border-slate-200 hover:border-slate-300"}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="delivery" value={o.id} checked={on} onChange={() => setDeliveryId(o.id)} className="accent-[var(--store-accent)]" />
                    <span><span className="block text-sm font-semibold text-slate-900">{o.label}</span><span className="block text-xs text-slate-500">{o.detail}</span></span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{o.free ? <span className="text-emerald-700">Grátis</span> : money(o.price)}</span>
                </label>
              );
            })}
            {quoting && <p className="text-sm text-slate-500">Calculando a entrega…</p>}
            {quote.problems.map((p) => <p key={p} className="text-sm text-amber-800">{p}</p>)}
            {quote.options.some((o) => o.simulated) && <p className="text-xs text-slate-500">Prazos e preços de transportadora em simulação (sem consulta real).</p>}
          </div>
          <p className="mt-4 text-xs text-slate-500">{pickup ? "Endereço do comprador para a nota fiscal (a retirada é na loja escolhida acima)." : "Endereço de entrega (também usado na nota fiscal)."}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-6">
            <label className={`${label} sm:col-span-4`}>Endereço<input className={input} value={a.street} onChange={(e) => setA({ ...a, street: e.target.value })} autoComplete="address-line1" required /></label>
            <label className={`${label} sm:col-span-2`}>Número<input className={input} value={a.number} onChange={(e) => setA({ ...a, number: e.target.value })} required /></label>
            <label className={`${label} sm:col-span-3`}>Complemento<input className={input} value={a.complement} onChange={(e) => setA({ ...a, complement: e.target.value })} autoComplete="address-line2" /></label>
            <label className={`${label} sm:col-span-3`}>Bairro<input className={input} value={a.district} onChange={(e) => setA({ ...a, district: e.target.value })} required /></label>
            <label className={`${label} sm:col-span-4`}>Cidade<input className={input} value={a.cityName} onChange={(e) => setA({ ...a, cityName: e.target.value, cityCode: "" })} autoComplete="address-level2" required /></label>
            <label className={`${label} sm:col-span-2`}>UF
              <select className={input} value={a.uf} onChange={(e) => setA({ ...a, uf: e.target.value })} required>
                <option value="">—</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="co-3">
          <h2 id="co-3" className="text-lg font-semibold text-slate-900">3. Pagamento</h2>
          <div className="mt-4 space-y-2" role="radiogroup" aria-label="Meio de pagamento">
            {props.methods.pix && (
              <PayOption on={method === "pix"} onSelect={() => setMethod("pix")} icon={<QrCode className="size-5" aria-hidden />} title="Pix" detail={props.simulated ? "Confirmação simulada após o pedido" : `Aprovação na hora · pague em até ${props.methods.pixMinutes} minutos`} />
            )}
            {props.methods.card && (
              <PayOption on={method === "card"} onSelect={() => setMethod("card")} icon={<CreditCard className="size-5" aria-hidden />} title={props.simulated ? "Cartão de teste" : "Cartão de crédito"} detail={props.simulated ? "Sem número de cartão ou cobrança real" : `Em até ${props.methods.maxInstallments}x`} />
            )}
            {props.methods.boleto && (
              <PayOption on={method === "boleto"} onSelect={() => setMethod("boleto")} icon={<Landmark className="size-5" aria-hidden />} title="Boleto bancário" detail={`Vencimento em ${props.methods.boletoDays} dia(s) úteis; o pedido é confirmado após a compensação`} />
            )}
          </div>
          {method === "card" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className={label}>Parcelas
                <select className={input} value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                  {Array.from({ length: maxInst }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x de {money(Math.round(total / n))} sem juros</option>)}
                </select>
              </label>
              {props.simulated ? (
                <label className={label}>Resultado da simulação
                  <select className={input} value={simulate} onChange={(e) => setSimulate(e.target.value as "approve" | "decline")}>
                    <option value="approve">Aprovar o pagamento</option>
                    <option value="decline">Recusar o pagamento</option>
                  </select>
                </label>
              ) : (
                <p className="text-sm text-slate-600 sm:col-span-2">Os dados do cartão são digitados no ambiente seguro do gateway e não ficam com a loja.</p>
              )}
            </div>
          )}
        </section>
      </div>
      <aside className="space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-4">
          <h2 className="text-lg font-semibold text-slate-900">Resumo do pedido</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Produtos</dt><dd className="tabular-nums">{money(quote.subtotal)}</dd></div>
            {quote.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Desconto</dt><dd className="tabular-nums">− {money(quote.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-600">Frete</dt><dd className="tabular-nums">{option ? (option.free || option.price === 0 ? "Grátis" : money(option.price)) : "—"}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-xl font-bold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">{props.itemsCount} item(ns) · {option ? option.label : "escolha a entrega"}</p>
          <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 text-sm">
            <h3 className="font-semibold text-slate-900">Revisão final</h3>
            <label className="flex items-start gap-2"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 accent-[var(--store-accent)]" /> <span>Li e aceito os <Link href={`${props.basePath}/pagina/termos`} target="_blank" className="underline">termos de compra</Link>, a <Link href={`${props.basePath}/pagina/privacidade`} target="_blank" className="underline">política de privacidade</Link> e a <Link href={`${props.basePath}/pagina/trocas-e-devolucoes`} target="_blank" className="underline">política de trocas</Link>.</span></label>
            <label className="flex items-start gap-2"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 accent-[var(--store-accent)]" /> <span>Quero receber ofertas e lembretes desta loja por e-mail (opcional; posso cancelar quando quiser).</span></label>
            {props.simulated && <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 accent-[var(--store-accent)]" /> <span>Revisei os dados e entendi que este pedido é uma simulação (sem cobrança real).</span></label>}
          </div>
          <button type="submit" disabled={placing || quoting || props.preview} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--store-accent)] px-4 py-3 text-base font-semibold text-[var(--store-on-accent)] shadow-sm hover:brightness-95 disabled:opacity-60">
            <Lock className="size-4" aria-hidden /> {placing ? "Registrando o pedido…" : `${props.simulated ? "Simular pedido" : "Finalizar pedido"} · ${money(total)}`}
          </button>
          {props.preview && <p className="mt-2 text-xs text-amber-800">Prévia da loja: o checkout fica disponível depois da publicação.</p>}
          <Link href={`${props.basePath}/carrinho`} className="mt-3 block text-center text-sm font-semibold text-[var(--store-accent)] hover:underline">Voltar ao carrinho</Link>
        </div>
      </aside>
    </form>
  );
}

function PayOption({ on, onSelect, icon, title, detail }: { on: boolean; onSelect: () => void; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 ${on ? "border-[var(--store-accent)] bg-[color-mix(in_srgb,var(--store-accent)_7%,white)]" : "border-slate-200 hover:border-slate-300"}`}>
      <span className="flex items-center gap-3">
        <input type="radio" name="payment" checked={on} onChange={onSelect} className="accent-[var(--store-accent)]" />
        <span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block text-xs text-slate-500">{detail}</span></span>
      </span>
      <span className="text-[var(--store-accent)]">{icon}</span>
    </label>
  );
}
