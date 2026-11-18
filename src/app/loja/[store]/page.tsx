import Link from "@/components/ui/link";
import { Search, ShoppingBag, Megaphone, Package, Truck, CreditCard, ShieldCheck, RotateCcw } from "lucide-react";
import { publicCatalog, publicProduct, type PublicCard } from "@/domain/ecommerce/catalog";
import { benefitsOf, sectionsOf, themeOf } from "@/domain/ecommerce/store";
import { templateOf } from "@/domain/ecommerce/templates";
import { ProductArt } from "./_components/art";
import { money, requireStore } from "./_lib";

type Props = { params: Promise<{ store: string }>; searchParams: Promise<{ q?: string; categoria?: string }> };

const BENEFIT_ICONS = [Package, Truck, CreditCard, ShieldCheck, RotateCcw];

/** Tela 61 — Loja pública e categorias: busca, categorias, grade de produtos e benefícios, no modelo escolhido. */
export default async function StoreHome({ params, searchParams }: Props) {
  const { store: ref } = await params;
  const { q, categoria } = await searchParams;
  const s = await requireStore(ref);
  const { st, basePath } = s;
  const theme = themeOf(st);
  const tpl = templateOf(st.template);
  const sections = sectionsOf(st);
  const benefits = benefitsOf(st);
  const { cards, all, categories } = await publicCatalog(s.store, st, { q: q ?? null, category: categoria ?? null });
  const filtering = Boolean(q || categoria);
  const featured = all.filter((c) => c.featured && c.available).slice(0, tpl.gridColumns);
  const offerSlug = tpl.hero === "offer" && theme.offerProductId ? all.find((c) => c.productId === theme.offerProductId)?.slug : null;
  const offer = offerSlug ? await publicProduct(s.store, st, offerSlug) : null;
  const img = (c: PublicCard) => (c.imageFileId ? `${basePath}/imagem/${c.imageFileId}` : null);
  const cols = tpl.gridColumns === 4 ? "md:grid-cols-3 lg:grid-cols-4" : "lg:grid-cols-3";
  const hero = (
    <section aria-label="Destaque" className="mb-6">
      {tpl.hero === "editorial" ? (
        <div className="grid overflow-hidden rounded-2xl bg-[var(--store-accent)] text-[var(--store-on-accent)] md:grid-cols-5">
          <div className="p-6 md:col-span-3 md:p-10">
            <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Nova coleção</p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">{theme.title}</h1>
            {theme.tagline && <p className="mt-2 text-base opacity-90">{theme.tagline}</p>}
            {theme.editorial && <p className="mt-4 max-w-prose text-sm opacity-90">{theme.editorial}</p>}
            <a href="#produtos" className="mt-6 inline-block rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100">Ver a coleção</a>
          </div>
          <div className="hidden items-center justify-center bg-black/10 md:col-span-2 md:flex">
            {theme.heroFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${basePath}/imagem/${theme.heroFileId}`} alt="" className="h-full w-full object-cover" />
            ) : (
              <ShoppingBag className="size-24 opacity-70" aria-hidden />
            )}
          </div>
        </div>
      ) : tpl.hero === "offer" && offer ? (
        <div className="grid items-center gap-6 rounded-2xl bg-[color-mix(in_srgb,var(--store-accent)_9%,white)] p-6 md:grid-cols-2 md:p-10">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[var(--store-accent)]"><Megaphone className="size-4" aria-hidden /> Oferta em destaque</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">{theme.title}</h1>
            <p className="mt-2 text-lg font-medium text-slate-800">{offer.listing.title}</p>
            <p className="mt-1">
              {offer.listing.compareAtPrice && offer.listing.compareAtPrice > offer.variants[0].price && <span className="mr-2 text-slate-400 line-through">{money(offer.listing.compareAtPrice)}</span>}
              <span className="text-2xl font-bold text-[var(--store-accent)]">{money(Math.min(...offer.variants.map((v) => v.price)))}</span>
            </p>
            <Link href={`${basePath}/produto/${offer.listing.slug}`} className="mt-5 inline-block rounded-md bg-[var(--store-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--store-on-accent)] hover:brightness-95">Aproveitar a oferta</Link>
          </div>
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl bg-white">
            <ProductArt category={offer.category?.name ?? null} imageUrl={offer.images[0] ? `${basePath}/imagem/${offer.images[0]}` : null} alt={offer.listing.title} size="page" />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-6 overflow-hidden rounded-2xl bg-[color-mix(in_srgb,var(--store-accent)_9%,white)] p-6 md:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--store-accent)]">Bem-vindo à nossa loja</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900 md:text-4xl">{theme.title}</h1>
            {theme.tagline && <p className="mt-2 text-base text-slate-600">{theme.tagline}</p>}
            <a href="#produtos" className="mt-5 inline-block rounded-md bg-[var(--store-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--store-on-accent)] hover:brightness-95">Ver produtos</a>
          </div>
          {theme.heroFileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${basePath}/imagem/${theme.heroFileId}`} alt="" className="hidden h-40 rounded-xl object-cover md:block" />
          ) : (
            <ShoppingBag className="hidden size-24 shrink-0 text-[var(--store-accent)] md:block" aria-hidden strokeWidth={1.4} />
          )}
        </div>
      )}
    </section>
  );

  return (
    <>
      {!filtering && hero}
      <form role="search" action={basePath || "/"} className="mb-4 flex gap-2">
        <label htmlFor="busca" className="sr-only">O que você procura?</label>
        <input id="busca" name="q" defaultValue={q ?? ""} placeholder="O que você procura?" className="h-11 flex-1 rounded-md border border-slate-300 bg-white px-4 text-sm" />
        {categoria && <input type="hidden" name="categoria" value={categoria} />}
        <button type="submit" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"><Search className="size-4" aria-hidden /> Buscar</button>
      </form>
      {sections.categories && categories.length > 0 && (
        <nav aria-label="Categorias" className="mb-6 flex flex-wrap gap-2">
          <Link href={basePath || "/"} className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${!categoria ? "border-[var(--store-accent)] bg-[color-mix(in_srgb,var(--store-accent)_8%,white)] text-[var(--store-accent)]" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`} aria-current={!categoria ? "page" : undefined}>Todos</Link>
          {categories.map((c) => (
            <Link key={c.id} href={`${basePath}/?categoria=${c.slug}`} className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${categoria === c.slug ? "border-[var(--store-accent)] bg-[color-mix(in_srgb,var(--store-accent)_8%,white)] text-[var(--store-accent)]" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`} aria-current={categoria === c.slug ? "page" : undefined}>
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      {!filtering && sections.featured && tpl.sections.includes("featured") && featured.length > 0 && (
        <section aria-labelledby="destaques" className="mb-8">
          <h2 id="destaques" className="mb-3 text-lg font-semibold text-slate-900">Destaques</h2>
          <Grid cards={featured} basePath={basePath} img={img} cols={cols} />
        </section>
      )}
      <section aria-labelledby="produtos" id="produtos">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="produtos-titulo" className="text-lg font-semibold text-slate-900">{q ? `Resultados para “${q}”` : categoria ? (categories.find((c) => c.slug === categoria)?.name ?? "Produtos") : "Nossos produtos"}</h2>
          <span className="text-sm text-slate-500">{cards.length} produto(s)</span>
        </div>
        {cards.length ? (
          <Grid cards={cards} basePath={basePath} img={img} cols={cols} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            Nenhum produto encontrado. <Link href={basePath || "/"} className="font-semibold text-[var(--store-accent)] hover:underline">Ver todos os produtos</Link>
          </div>
        )}
      </section>
      {sections.benefits && (
        <ul className="mt-8 grid gap-3 border-t border-slate-200 pt-6 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((b, i) => {
            const Icon = BENEFIT_ICONS[i % BENEFIT_ICONS.length];
            return (
              <li key={b} className="flex items-center gap-2"><Icon className="size-5 shrink-0 text-[var(--store-accent)]" aria-hidden /> {b}</li>
            );
          })}
        </ul>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "Store", name: st.name, description: theme.tagline || undefined }).replace(/</g, "\\u003c") }}
      />
    </>
  );
}

function Grid({ cards, basePath, img, cols }: { cards: PublicCard[]; basePath: string; img: (c: PublicCard) => string | null; cols: string }) {
  return (
    <ul className={`grid grid-cols-2 gap-3 sm:gap-4 ${cols}`}>
      {cards.map((c) => (
        <li key={c.productId} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <Link href={`${basePath}/produto/${c.slug}`} aria-label={c.title} tabIndex={-1}>
            <ProductArt category={c.categoryName} imageUrl={img(c)} alt={c.title} />
          </Link>
          <div className="flex flex-1 flex-col p-3 sm:p-4">
            <h3 className="text-sm text-slate-800"><Link href={`${basePath}/produto/${c.slug}`} className="hover:underline">{c.title}</Link></h3>
            <p className="mt-1">
              {c.compareAtPrice && c.compareAtPrice > c.price && <span className="mr-2 text-xs text-slate-400 line-through">{money(c.compareAtPrice)}</span>}
              <span className="text-lg font-bold text-slate-900">{money(c.price)}</span>
            </p>
            {!c.available && <p className="text-xs font-medium text-red-700">Indisponível no momento</p>}
            <Link href={`${basePath}/produto/${c.slug}`} className="mt-auto block rounded-md bg-[color-mix(in_srgb,var(--store-accent)_9%,white)] px-3 py-2 pt-2 text-center text-sm font-semibold text-[var(--store-accent)] hover:brightness-95 [margin-top:auto]">
              {c.available ? "Ver produto" : "Ver detalhes"}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
