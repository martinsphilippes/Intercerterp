import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAGE_LABEL, PAGE_SLUG, pagesOf, type StorePages } from "@/domain/ecommerce/store";
import { requireStore } from "../../_lib";

type Props = { params: Promise<{ store: string; slug: string }> };

const keyOf = (slug: string) => (Object.keys(PAGE_SLUG) as Array<keyof StorePages>).find((k) => PAGE_SLUG[k] === slug) ?? null;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const k = keyOf(slug);
  return { title: k ? PAGE_LABEL[k] : "Página" };
}

/** Páginas institucionais e legais da loja (termos, privacidade, trocas, entrega, sobre). */
export default async function StorePage({ params }: Props) {
  const { store: ref, slug } = await params;
  const s = await requireStore(ref);
  const k = keyOf(slug);
  if (!k) notFound();
  const text = pagesOf(s.st)[k];
  return (
    <article className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6 md:p-10">
      <h1 className="text-2xl font-bold text-slate-900">{PAGE_LABEL[k]}</h1>
      <div className="mt-4 space-y-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{text || "Conteúdo em preparação."}</div>
      <p className="mt-6 text-xs text-slate-500">Atualizado em {new Date(s.st.updatedAt ?? s.st.createdAt ?? Date.now()).toLocaleDateString("pt-BR")}.</p>
    </article>
  );
}
