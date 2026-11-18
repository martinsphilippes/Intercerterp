import Link from "@/components/ui/link";
import { ArrowLeft, ArrowRight, ShoppingCart } from "lucide-react";
import { cartView } from "@/domain/ecommerce/cart";
import { ProductArt } from "../_components/art";
import { CouponBox, DeliveryChoice, QtyStepper, ZipBox } from "../_components/cart-controls";
import { applyCouponAction, removeCouponAction, selectDeliveryAction, setQtyAction, setZipAction } from "../actions";
import { money, requireStore } from "../_lib";

export const metadata = { title: "Carrinho", robots: { index: false } };

/** Tela 63 — Carrinho: itens, cupom e entrega compõem o total (sempre recalculado no servidor). */
export default async function CartPage({ params }: { params: Promise<{ store: string }> }) {
  const { store: raw } = await params;
  const ref = decodeURIComponent(raw);
  const s = await requireStore(ref);
  const { st, basePath } = s;
  const view = s.cartToken ? await cartView(s.store, st, s.cartToken) : null;
  const lines = view?.cart.status === "open" ? view.lines : [];
  if (!view || !lines.length)
    return (
      <section className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center">
        <ShoppingCart className="mx-auto size-10 text-[var(--store-accent)]" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold text-slate-900">Seu carrinho está vazio</h1>
        <p className="mt-1 text-sm text-slate-600">Escolha os produtos na vitrine e eles aparecem aqui.</p>
        <Link href={basePath || "/"} className="mt-5 inline-block rounded-md bg-[var(--store-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--store-on-accent)]">Ver produtos</Link>
      </section>
    );
  const selectMap = Object.fromEntries(view.delivery.options.map((o) => [o.id, selectDeliveryAction.bind(null, ref, o.id)]));
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Carrinho</h1>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="itens">
            <h2 id="itens" className="text-lg font-semibold text-slate-900">Seus produtos</h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={l.skuId} className="flex gap-4 py-4">
                  <ProductArt category={l.categoryName} imageUrl={l.imageFileId ? `${basePath}/imagem/${l.imageFileId}` : null} alt={l.title} size="thumb" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {l.slug ? <Link href={`${basePath}/produto/${l.slug}`} className="font-semibold text-slate-900 hover:underline">{l.title}</Link> : <span className="font-semibold text-slate-900">{l.title}</span>}
                        <p className="text-xs text-slate-500">{[l.sku, l.variant].filter(Boolean).join(" · ")}</p>
                      </div>
                      <p className="font-semibold tabular-nums text-slate-900">{money(l.lineTotal)}</p>
                    </div>
                    <div className="mt-2">
                      <QtyStepper
                        label={l.title}
                        units={l.units}
                        max={Math.max(l.availableUnits, 1)}
                        dec={setQtyAction.bind(null, ref, l.skuId, l.units - 1)}
                        inc={setQtyAction.bind(null, ref, l.skuId, l.units + 1)}
                        remove={setQtyAction.bind(null, ref, l.skuId, 0)}
                      />
                    </div>
                    {l.problem && <p className="mt-1 text-sm text-red-700">{l.problem}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <Link href={basePath || "/"} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--store-accent)] hover:underline"><ArrowLeft className="size-4" aria-hidden /> Continuar comprando</Link>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="cupom">
            <h2 id="cupom" className="mb-3 text-lg font-semibold text-slate-900">Cupom de desconto</h2>
            <CouponBox applied={view.coupon?.code ?? null} problem={view.couponProblem} apply={applyCouponAction.bind(null, ref)} remove={removeCouponAction.bind(null, ref)} />
            {view.couponProblem && <p className="mt-2 text-sm text-amber-800">{view.couponProblem}</p>}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="entrega">
            <h2 id="entrega" className="mb-3 text-lg font-semibold text-slate-900">Entrega</h2>
            <ZipBox zip={view.delivery.zip} setZip={setZipAction.bind(null, ref)} />
            <div className="mt-3">
              <DeliveryChoice options={view.delivery.options} selectedId={view.delivery.selected?.id ?? null} select={selectMap} />
            </div>
            {view.delivery.problems.map((p) => <p key={p} className="mt-2 text-sm text-amber-800">{p}</p>)}
            {view.delivery.options.some((o) => o.simulated) && <p className="mt-2 text-xs text-slate-500">Cotação de exemplo, sem consulta a transportadoras.</p>}
          </section>
        </div>
        <aside className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-4">
            <h2 className="text-lg font-semibold text-slate-900">Resumo do pedido</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Produtos ({view.units})</dt><dd className="tabular-nums">{money(view.subtotal)}</dd></div>
              {view.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Cupom {view.coupon?.code}</dt><dd className="tabular-nums">− {money(view.discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-600">Frete</dt><dd className="tabular-nums">{view.delivery.selected ? (view.shipping ? money(view.shipping) : "Grátis") : "Calcule acima"}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-3 text-xl font-bold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{money(view.total)}</dd></div>
            </dl>
            {view.blockers.map((b) => <p key={b} className="mt-2 text-sm text-red-700">{b}</p>)}
            {view.blockers.length ? (
              <span className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md bg-slate-200 px-4 py-3 text-base font-semibold text-slate-500" aria-disabled>Continuar para o checkout</span>
            ) : (
              <Link href={`${basePath}/checkout`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--store-accent)] px-4 py-3 text-base font-semibold text-[var(--store-on-accent)] hover:brightness-95">
                Continuar para o checkout <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
            <p className="mt-2 text-xs text-slate-500">Preço, estoque e frete são conferidos novamente ao concluir o pedido.</p>
          </div>
        </aside>
      </div>
      {st.status !== "published" && <p className="mt-4 text-center text-xs text-amber-800">Prévia: o checkout fica disponível depois da publicação da loja.</p>}
    </>
  );
}
