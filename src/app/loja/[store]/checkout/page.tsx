import Link from "@/components/ui/link";
import { cartView } from "@/domain/ecommerce/cart";
import { checkoutOf, paymentsOf } from "@/domain/ecommerce/store";
import { gatewayFor } from "@/domain/ecommerce/providers";
import { CheckoutForm } from "../_components/checkout-form";
import { placeOrderAction, quoteAction } from "../actions";
import { requireStore } from "../_lib";

export const metadata = { title: "Checkout", robots: { index: false } };

/** Tela 64 — Checkout: identificação, entrega, pagamento e confirmação num fluxo único. */
export default async function CheckoutPage({ params }: { params: Promise<{ store: string }> }) {
  const { store: raw } = await params;
  const ref = decodeURIComponent(raw);
  const s = await requireStore(ref);
  const { st, basePath } = s;
  const view = s.cartToken ? await cartView(s.store, st, s.cartToken, { requote: true }) : null;
  if (!view || view.cart.status !== "open" || !view.lines.length || view.blockers.length)
    return (
      <section className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{!view || !view.lines.length ? "Seu carrinho está vazio" : "Revise o carrinho"}</h1>
        {view?.blockers.map((b) => <p key={b} className="mt-2 text-sm text-red-700">{b}</p>)}
        <Link href={`${basePath}/carrinho`} className="mt-5 inline-block rounded-md bg-[var(--store-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--store-on-accent)]">Ir para o carrinho</Link>
      </section>
    );
  const pay = paymentsOf(st);
  const gw = await gatewayFor(s.store, st.companyId);
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Checkout</h1>
      <p className="mb-4 text-sm text-slate-600">Identificação, entrega e pagamento em um só passo. Você acompanha o pedido logo depois.</p>
      {gw.simulated && <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">Ambiente demonstrativo: o pagamento é simulado. Use dados fictícios e não informe dados reais de cartão.</p>}
      <CheckoutForm
        basePath={basePath}
        initialZip={view.delivery.zip}
        initialQuote={{ options: view.delivery.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail, price: o.price, free: o.free, mode: o.mode, simulated: o.simulated })), problems: view.delivery.problems, subtotal: view.subtotal, discount: view.discount }}
        initialSelected={view.delivery.selected?.id ?? null}
        itemsCount={view.units}
        methods={{ pix: pay.methods.pix.enabled, card: pay.methods.card.enabled, boleto: pay.methods.boleto.enabled, maxInstallments: pay.methods.card.maxInstallments ?? 1, minInstallment: pay.methods.card.minInstallment ?? 0, pixMinutes: pay.methods.pix.expiresMinutes ?? 30, boletoDays: pay.methods.boleto.dueDays ?? 3 }}
        simulated={gw.simulated}
        requireDoc={checkoutOf(st).requireDoc}
        preview={s.access !== "open"}
        quote={quoteAction.bind(null, ref)}
        place={placeOrderAction.bind(null, ref)}
      />
    </>
  );
}
