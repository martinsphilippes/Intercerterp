import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { publicProduct } from "@/domain/ecommerce/catalog";
import { slugify } from "@/domain/ecommerce/common";
import { ProductArt } from "../../_components/art";
import { BuyBox } from "../../_components/buy-box";
import { addToCartAction } from "../../actions";
import { loadStore, money, requireStore } from "../../_lib";

type Props = { params: Promise<{ store: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { store: ref, slug } = await params;
  const s = await loadStore(ref);
  if (!s || s.access === "closed") return {};
  const p = await publicProduct(s.store, s.st, slug);
  if (!p) return { title: "Produto não encontrado" };
  const desc = (p.listing.seoDescription || String(p.listing.description ?? "").slice(0, 160)) || undefined;
  return { title: p.listing.seoTitle || p.listing.title, description: desc, openGraph: { title: p.listing.title, description: desc, images: p.images[0] ? [`${s.basePath}/imagem/${p.images[0]}`] : undefined } };
}

/** Tela 62 — Página pública do produto: imagem, marca, SKU, descrição, variação, disponibilidade e quantidade. */
export default async function ProductPage({ params }: Props) {
  const { store: ref, slug } = await params;
  const s = await requireStore(ref);
  const p = await publicProduct(s.store, s.st, slug);
  if (!p) notFound();
  const { basePath } = s;
  const axis = Array.isArray(p.product.variantAxes) && p.product.variantAxes.length ? p.product.variantAxes.join(" / ") : null;
  const anyAvailable = p.variants.some((v) => v.available > 0);
  const main = p.images[0] ? `${basePath}/imagem/${p.images[0]}` : null;
  const sku = p.variants.length === 1 ? p.variants[0].sku : null;
  const minPrice = Math.min(...p.variants.map((v) => v.price));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.listing.title,
    description: String(p.listing.description ?? "").slice(0, 500) || undefined,
    sku: sku ?? undefined,
    brand: p.brand ? { "@type": "Brand", name: p.brand.name } : undefined,
    offers: { "@type": "Offer", priceCurrency: "BRL", price: (minPrice / 100).toFixed(2), availability: anyAvailable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };
  return (
    <>
      <nav aria-label="Trilha" className="mb-4 text-sm text-slate-500">
        <Link href={basePath || "/"} className="font-semibold text-[var(--store-accent)] hover:underline">Início</Link>
        {p.category && (
          <>
            {" / "}
            <Link href={`${basePath}/?categoria=${slugify(p.category.name)}`} className="hover:underline">{p.category.name}</Link>
          </>
        )}
        {" / "}
        <span className="text-slate-700">{p.listing.title}</span>
      </nav>
      <div className="grid gap-8 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2 md:p-8">
        <div>
          <ProductArt category={p.category?.name ?? null} imageUrl={main} alt={p.listing.title} size="page" />
          {p.images.length > 1 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Mais fotos">
              {p.images.slice(1).map((f: string) => (
                // eslint-disable-next-line @next/next/no-img-element
                <li key={f}><img src={`${basePath}/imagem/${f}`} alt="" loading="lazy" className="size-20 rounded-lg border border-slate-200 object-cover" /></li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">{main ? "Imagem do produto" : "Imagem ilustrativa"}{sku ? ` · SKU ${sku}` : ""}</p>
        </div>
        <div>
          {(p.brand || p.category) && <p className="text-xs font-semibold uppercase tracking-widest text-[var(--store-accent)]">{p.brand?.name ?? p.category?.name}</p>}
          <h1 className="mt-1 text-3xl font-bold text-slate-900">{p.listing.title}</h1>
          <p className={`mt-3 rounded-md px-3 py-1.5 text-sm font-semibold ${anyAvailable ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{anyAvailable ? "Disponível" : "Sem estoque no momento"}</p>
          <div className="mt-4">
            <BuyBox
              slug={p.listing.slug}
              variants={p.variants.map((v) => ({ skuId: v.skuId, label: v.label, price: v.price, available: v.available }))}
              axis={axis}
              compareAt={p.listing.compareAtPrice ?? null}
              canBuy={s.access === "open" || s.access === "preview"}
              action={addToCartAction.bind(null, decodeURIComponent(ref))}
            />
          </div>
          <section className="mt-8 border-t border-slate-200 pt-6" aria-labelledby="sobre">
            <h2 id="sobre" className="text-lg font-semibold text-slate-900">Sobre o produto</h2>
            <div className="mt-2 whitespace-pre-line text-sm text-slate-700">{p.listing.description || p.product.description || "Sem descrição."}</div>
            <p className="mt-3 text-sm text-slate-500">{[p.brand && `Marca: ${p.brand.name}`, sku && `Código: ${sku}`].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 text-sm text-slate-500">Calcule entrega ou retirada no carrinho. A partir de {money(minPrice)}.</p>
          </section>
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
