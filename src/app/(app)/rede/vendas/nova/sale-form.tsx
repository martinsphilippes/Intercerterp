"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, CheckCircle2, Search } from "lucide-react";
import Link from "@/components/ui/link";
import { Field, FormGrid, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { buttonClass, Spinner } from "@/components/ui/button";
import { useIdemKey } from "@/components/ui/action-form";
import { useToast } from "@/components/ui/toast";
import { startNavigationProgress } from "@/components/ui/nav-progress";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { createSaleAction, quoteSaleAction, type QuoteView } from "../actions";

export interface SaleProduct {
  key: string;
  label: string;
  months: number;
  free: boolean;
  holder: string | null;
  type: string | null;
  /** termos do vendedor (centavos); null = sem preço na rede */
  terms: { cost: number; minPrice: number; defaultPrice: number; canEdit: boolean } | null;
  voucherAvailable: number;
}

export interface SaleCustomer {
  id: string;
  code: string | null;
  name: string;
  doc: string;
  personType: "PF" | "PJ";
  email: string | null;
  phone: string | null;
  hasBirdId: boolean;
  birdIdValidTo: string | null;
}

/**
 * Nova venda (produto → cliente → preço/cupom/voucher → conferência → confirmação). Todos os valores trafegam em
 * CENTAVOS inteiros (MoneyInput): nada de ×100 na tela. A conferência chama o servidor (mesma régua da gravação) e
 * mostra custo, margem, desconto, avisos e a possível venda repetida; mudar qualquer campo exige conferir de novo.
 */
export function SaleForm({ products, customers, initialCustomerId, initialProduct, previous, defaultDueDate, minDueDate }: {
  products: SaleProduct[];
  customers: SaleCustomer[];
  initialCustomerId: string | null;
  initialProduct: string | null;
  previous: { id: string; productLabel: string; validTo: string; customerId: string } | null;
  defaultDueDate: string;
  minDueDate: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const toast = useToast();
  const saleKey = useIdemKey();
  const [pending, start] = useTransition();
  const [productKey, setProductKey] = useState(initialProduct && products.some((p) => p.key === initialProduct) ? initialProduct : (products.find((p) => p.terms && !p.free)?.key ?? products[0]?.key ?? ""));
  const [customerId, setCustomerId] = useState(initialCustomerId && customers.some((c) => c.id === initialCustomerId) ? initialCustomerId : "");
  const [filter, setFilter] = useState("");
  const product = products.find((p) => p.key === productKey) ?? null;
  const [price, setPrice] = useState(product?.terms?.defaultPrice ?? 0);
  const [voucher, setVoucher] = useState<"none" | "balance" | "code">("none");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return q ? customers.filter((c) => c.name.toLowerCase().includes(q) || (qd && c.doc.includes(qd)) || (c.code ?? "").toLowerCase() === q) : customers;
  }, [customers, filter]);
  const dirty = () => {
    setQuote(null);
    setError(null);
  };
  const pickProduct = (k: string) => {
    setProductKey(k);
    const p = products.find((x) => x.key === k);
    setPrice(p?.terms?.defaultPrice ?? 0);
    if (p?.free) setVoucher("none");
    dirty();
  };
  const t = product?.terms ?? null;
  const localMargin = t ? price - t.cost : null;
  const priceProblem = t && !product?.free ? (price < t.minPrice ? `Abaixo do mínimo do seu nó (${formatMoney(t.minPrice)}).` : !t.canEdit && price !== t.defaultPrice ? "Preço fixo para este produto." : null) : null;
  const noCharge = Boolean(product?.free || quote?.gift);

  const send = (kind: "quote" | "create") => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("saleKey", saleKey);
    setError(null);
    start(async () => {
      if (kind === "quote") {
        const res = await quoteSaleAction(fd);
        if (!res.ok) {
          setQuote(null);
          setError(res.error);
          return;
        }
        setQuote(res.data!);
        return;
      }
      const res = await createSaleAction(fd);
      if (!res.ok) {
        setError(res.error);
        toast("error", res.error);
        return;
      }
      if (res.message) toast("success", res.message);
      if (res.redirect) {
        startNavigationProgress();
        router.push(res.redirect);
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); if (quote && !quote.errors.length) send("create"); else send("quote"); }} className="space-y-5">
      {previous && <input type="hidden" name="previousCertificateId" value={previous.id} />}
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="productKey" value={productKey} />
      <input type="hidden" name="voucher" value={voucher} />

      {previous && (
        <Notice tone="info" title="Renovação">
          Renova {previous.productLabel} válido até {formatDate(previous.validTo)}. A venda nova aponta o certificado anterior (histórico preservado).
        </Notice>
      )}

      <FormSection title="1. Produto" description="Preços do seu nó na rede (definidos pelo parceiro acima). Produto gratuito: BirdID sem cobrança para pessoa física.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <label key={p.key} className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${productKey === p.key ? "border-accent-500 ring-1 ring-accent-500" : "border-line"} ${!p.terms && !p.free ? "opacity-60" : ""}`}>
              <input type="radio" name="_product" className="mt-1" checked={productKey === p.key} onChange={() => pickProduct(p.key)} disabled={!p.terms && !p.free} />
              <span className="min-w-0">
                <span className="block font-medium text-ink">{p.label}</span>
                {p.free ? (
                  <span className="text-xs text-emerald-700">Gratuito · {p.months / 12} anos · direto à validação</span>
                ) : p.terms ? (
                  <span className="block text-xs text-slate-600">
                    Padrão {formatMoney(p.terms.defaultPrice)} · mínimo {formatMoney(p.terms.minPrice)} · seu custo {formatMoney(p.terms.cost)}
                    {!p.terms.canEdit && <Badge className="ml-1">fixo</Badge>}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Sem preço da rede para o seu nó</span>
                )}
                {p.voucherAvailable > 0 && <span className="block text-xs text-brand-700">{p.voucherAvailable} voucher(s) disponível(is)</span>}
              </span>
            </label>
          ))}
        </div>
      </FormSection>

      <FormSection title="2. Cliente" description="Titular do certificado. O cadastro do cliente fica no seu parceiro.">
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ ou código" className="pl-8" aria-label="Buscar cliente" />
          </div>
          <Select value={customerId} onChange={(e) => { setCustomerId(e.target.value); dirty(); }} options={shown.map((c) => ({ value: c.id, label: `${c.code ? `${c.code} — ` : ""}${c.name} (${formatDoc(c.doc)})` }))} placeholder="Selecione o cliente" aria-label="Cliente" />
          {customer && (
            <p className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-slate-50 p-3 text-sm">
              <BadgeCheck className="size-4 text-brand-700" aria-hidden />
              <span className="font-medium">{customer.name}</span>
              <span className="text-slate-600">{customer.personType === "PF" ? "CPF" : "CNPJ"} {formatDoc(customer.doc)}</span>
              {customer.hasBirdId && <Badge tone="good">tem BirdID{customer.birdIdValidTo ? ` até ${formatDate(customer.birdIdValidTo)}` : ""}</Badge>}
            </p>
          )}
          <p className="text-xs text-slate-500">Não encontrou? <Link href="/rede/clientes/novo?back=venda" className="underline">Cadastrar cliente</Link>.</p>
        </div>
      </FormSection>

      {!product?.free && (
        <FormSection title="3. Preço, cupom e voucher" description="O preço não fica abaixo do mínimo do seu nó; o cupom nunca deixa o preço abaixo do seu custo.">
          <FormGrid cols={3}>
            <Field label="Preço ao cliente" hint={t ? (t.canEdit ? `Entre ${formatMoney(t.minPrice)} e o que negociar (padrão ${formatMoney(t.defaultPrice)}).` : "Preço fixo definido pelo parceiro acima.") : undefined} error={priceProblem}>
              <MoneyInput name="price" value={price} onChange={(c) => { setPrice(c); dirty(); }} disabled={!t?.canEdit} />
            </Field>
            <Field label="Cupom" hint="Opcional. Letras e números.">
              <Input name="couponCode" onChange={dirty} placeholder="EX.: CARIRI10" className="uppercase" maxLength={20} autoComplete="off" />
            </Field>
            <Field label="Seu custo e margem" hint={localMargin != null ? "Antes do cupom; a conferência calcula o valor final." : undefined}>
              <p className="tabular pt-2 text-sm">{t ? <>custo {formatMoney(t.cost)} · margem <span className={localMargin! < 0 ? "text-red-700" : "text-emerald-700"}>{formatMoney(localMargin)}</span></> : "—"}</p>
            </Field>
          </FormGrid>
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium text-ink">Voucher</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={voucher === "none"} onChange={() => { setVoucher("none"); dirty(); }} /> Sem voucher</label>
              <label className={`flex items-center gap-2 ${product?.voucherAvailable ? "" : "opacity-50"}`}><input type="radio" checked={voucher === "balance"} disabled={!product?.voucherAvailable} onChange={() => { setVoucher("balance"); dirty(); }} /> Usar saldo do nó ({product?.voucherAvailable ?? 0} disponível) — custo já pago</label>
              <label className="flex items-center gap-2"><input type="radio" checked={voucher === "code"} onChange={() => { setVoucher("code"); dirty(); }} /> Código de voucher (inclusive presente)</label>
            </div>
            {voucher === "code" && <Input name="voucherCode" onChange={dirty} placeholder="P-XXXX-XXXX" className="mt-2 max-w-xs uppercase" autoComplete="off" />}
          </fieldset>
        </FormSection>
      )}

      {!noCharge && (
        <FormSection title="4. Cobrança" description="Cobrança única da certificação digital. O envio é feito na tela da venda.">
          <FormGrid cols={3}>
            <Field label="Vencimento" required><Input type="date" name="dueDate" defaultValue={defaultDueDate} min={minDueDate} required /></Field>
            <Field label="E-mail de contato"><Input type="email" name="contactEmail" defaultValue={customer?.email ?? ""} key={`e-${customerId}`} /></Field>
            <Field label="Telefone / WhatsApp"><Input name="contactPhone" defaultValue={customer?.phone ?? ""} key={`p-${customerId}`} /></Field>
          </FormGrid>
        </FormSection>
      )}
      <Field label="Observações (internas)"><Textarea name="notes" rows={2} maxLength={1000} /></Field>

      {quote && (
        <section aria-live="polite" className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> Conferência</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Preço pedido</dt><dd className="tabular">{formatMoney(quote.requestedPrice)}</dd></div>
            <div><dt className="text-xs text-slate-500">Desconto{quote.couponCode ? ` (${quote.couponCode})` : ""}</dt><dd className="tabular">{quote.discount ? `−${formatMoney(quote.discount)}` : "—"}{quote.capped && <span className="block text-xs text-amber-700">limitado ao seu custo</span>}{quote.belowMin > 0 && !quote.gift && <span className="block text-xs text-slate-500">abaixo do mínimo: absorvido por quem emitiu o cupom</span>}</dd></div>
            <div><dt className="text-xs text-slate-500">Preço final ao cliente</dt><dd className="tabular text-lg font-semibold">{formatMoney(quote.finalPrice)}</dd></div>
            <div><dt className="text-xs text-slate-500">Sua margem</dt><dd className={`tabular ${quote.margin != null && quote.margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{quote.free ? "—" : formatMoney(quote.margin)}</dd></div>
          </dl>
          {quote.voucher && <p className="text-sm text-slate-700">Voucher do pacote <strong>{quote.voucher.packageName}</strong>{quote.voucher.code ? ` (código ${quote.voucher.code})` : ""}: custo pré-pago de {formatMoney(quote.voucher.unitPrice)}{quote.gift ? " · presente: o cliente não paga" : ""}.</p>}
          {quote.errors.length > 0 && <Notice tone="bad" title="Corrija antes de confirmar">{quote.errors.join(" ")}</Notice>}
          {quote.duplicates.length > 0 && (
            <Notice tone="warn" title="Possível venda repetida">
              <ul className="list-disc pl-5">{quote.duplicates.map((d, i) => <li key={i}>{d}</li>)}</ul>
              <p className="mt-2">Renovação antecipada (até 60 dias do vencimento) não gera este aviso. Para continuar, informe o motivo — fica registrado no histórico.</p>
              <Textarea name="duplicateReason" rows={2} minLength={10} required className="mt-2" placeholder="Ex.: titular perdeu o token e precisa de um novo certificado" />
            </Notice>
          )}
        </section>
      )}
      {error && <Notice tone="bad">{error}</Notice>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/rede/vendas" className={buttonClass("ghost")}>Cancelar</Link>
        <button type="button" onClick={() => send("quote")} disabled={pending || !customerId || !productKey} className={buttonClass(quote ? "secondary" : "primary")}>
          {pending && !quote && <Spinner />} Conferir venda
        </button>
        <button type="submit" disabled={pending || !quote || quote.errors.length > 0} className={buttonClass("primary")} title={!quote ? "Confira a venda antes de confirmar" : undefined}>
          {pending && quote && <Spinner />}
          {quote?.duplicates.length ? <AlertTriangle className="size-4" aria-hidden /> : null} Confirmar venda
        </button>
      </div>
    </form>
  );
}
