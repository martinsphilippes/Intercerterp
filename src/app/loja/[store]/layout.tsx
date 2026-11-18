import type { Metadata, Viewport } from "next";
import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { ShoppingCart, Store as StoreIcon, MessageCircle, Eye, PauseCircle } from "lucide-react";
import { getCart } from "@/domain/ecommerce/cart";
import { contactOf, legalOf, PAGE_LABEL, PAGE_SLUG, themeOf } from "@/domain/ecommerce/store";
import { formatPhone } from "@/lib/core/text";
import { loadStore } from "./_lib";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ store: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { store: ref } = await params;
  const s = await loadStore(ref);
  if (!s) return { title: { absolute: "Loja não encontrada" }, robots: { index: false } };
  const theme = themeOf(s.st);
  const title = s.st.seo?.title || s.st.name;
  return {
    title: { absolute: title, template: `%s · ${s.st.name}` },
    description: s.st.seo?.description || theme.tagline || undefined,
    applicationName: s.st.name,
    robots: s.access === "open" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", siteName: s.st.name, title, description: s.st.seo?.description || theme.tagline || undefined, locale: "pt_BR" },
    other: { "intercert-storefront": "1" },
    manifest: null,
    appleWebApp: null,
  };
}

export async function generateViewport({ params }: Params): Promise<Viewport> {
  const { store: ref } = await params;
  const s = await loadStore(ref);
  return { width: "device-width", initialScale: 1, themeColor: s?.accent ?? "#ffffff" };
}

/** Vitrine pública (Telas 61–64): marca, modelo e produtos definidos na gestão do ERP. */
export default async function StoreLayout({ children, params }: { children: React.ReactNode } & Params) {
  const { store: ref } = await params;
  const s = await loadStore(ref);
  if (!s) {
    if (decodeURIComponent(ref).startsWith("~")) return <NotLinked host={decodeURIComponent(ref).slice(1)} />;
    notFound();
  }
  if (s.access === "closed") notFound();
  const { st, basePath } = s;
  const theme = themeOf(st);
  const legal = legalOf(st);
  const contact = contactOf(st);
  const cart = s.cartToken ? await getCart(s.store, st, s.cartToken) : null;
  const count = cart && cart.status === "open" ? (cart.itemsCount ?? 0) : 0;
  const company = await s.store.get("companies", st.companyId);
  const home = basePath || "/";
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-800" style={{ ["--store-accent" as any]: s.accent, ["--store-on-accent" as any]: s.onAccent }}>
      {s.access === "preview" && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          <Eye className="mr-1 inline size-4 align-text-bottom" aria-hidden /> Prévia da loja — ainda não publicada. Só quem abriu pelo ERP vê esta página; o checkout fica disponível depois da publicação.
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href={home} className="flex min-w-0 items-center gap-2 text-lg font-bold text-[var(--store-accent)]">
            {theme.logoFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${basePath}/imagem/${theme.logoFileId}`} alt={st.name} className="h-9 max-w-[180px] object-contain" />
            ) : (
              <>
                <StoreIcon className="size-6 shrink-0" aria-hidden /> <span className="truncate">{st.name}</span>
              </>
            )}
          </Link>
          <nav aria-label="Navegação da loja" className="flex items-center gap-2 sm:gap-4">
            <Link href={home} className="hidden text-sm font-semibold text-[var(--store-accent)] hover:underline sm:inline">Início</Link>
            <Link href={`${basePath}/carrinho`} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50" aria-label={`Carrinho com ${count} item(ns)`}>
              <ShoppingCart className="size-4" aria-hidden /> Carrinho ({count})
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {s.access === "paused" ? (
          <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center">
            <PauseCircle className="mx-auto size-10 text-[var(--store-accent)]" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold text-slate-900">A loja está em pausa no momento</h1>
            <p className="mt-2 text-sm text-slate-600">Voltamos em breve. Pedidos já feitos continuam sendo atendidos normalmente.</p>
            {contact.whatsapp && <a className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--store-accent)] hover:underline" href={`https://wa.me/55${contact.whatsapp}`} rel="noopener noreferrer" target="_blank"><MessageCircle className="size-4" aria-hidden /> Fale conosco</a>}
          </section>
        ) : (
          children
        )}
      </main>
      <footer className="border-t border-slate-200 bg-white text-sm">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-slate-900">{st.name}</p>
            <p className="mt-1 text-xs text-slate-600">{legal.companyName}{legal.cnpj ? ` · CNPJ ${legal.cnpj}` : ""}</p>
            {legal.address && <p className="text-xs text-slate-600">{legal.address}</p>}
            {(legal.email || legal.phone) && <p className="text-xs text-slate-600">{[legal.email, legal.phone && formatPhone(legal.phone)].filter(Boolean).join(" · ")}</p>}
          </div>
          <nav aria-label="Páginas da loja">
            <p className="font-semibold text-slate-900">Institucional</p>
            <ul className="mt-1 space-y-1">
              {(Object.keys(PAGE_LABEL) as Array<keyof typeof PAGE_LABEL>).map((k) => (
                <li key={k}><Link href={`${basePath}/pagina/${PAGE_SLUG[k]}`} className="text-slate-600 hover:text-slate-900 hover:underline">{PAGE_LABEL[k]}</Link></li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="font-semibold text-slate-900">Atendimento</p>
            {contact.hours && <p className="mt-1 text-xs text-slate-600">{contact.hours}</p>}
            {contact.whatsapp && <a className="mt-1 inline-flex items-center gap-1.5 text-slate-700 hover:underline" href={`https://wa.me/55${contact.whatsapp}`} rel="noopener noreferrer" target="_blank"><MessageCircle className="size-4" aria-hidden /> WhatsApp</a>}
            {contact.email && <p className="text-xs text-slate-600">{contact.email}</p>}
          </div>
        </div>
        <div className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-slate-500">
            <span>{st.name}{company?.isDemo ? " · Loja de demonstração (pedidos e pagamentos simulados)" : ""}</span>
            <span>Powered by Intercert</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function NotLinked({ host }: { host: string }) {
  const erp = process.env.APP_URL || null;
  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Endereço não ligado a uma loja</h1>
      <p className="mt-2 text-sm text-slate-600">
        O endereço <span className="font-mono">{host}</span> ainda não foi verificado por nenhuma loja. Se você é o lojista, conclua a verificação do domínio em Comércio digital › Editor e domínio. Se este é o endereço do próprio ERP, inclua-o na variável APP_HOSTS da publicação.
      </p>
      {erp && <a href={erp} className="mt-4 inline-block text-sm font-semibold text-blue-700 hover:underline">Ir para o ERP</a>}
    </main>
  );
}
