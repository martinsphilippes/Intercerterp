import "server-only";
import { redirect } from "next/navigation";
import type { Doc, Store } from "@/lib/db/types";
import { requireSession, type SessionInfo } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { canDo, type SpecialAction } from "@/lib/permissions";
import { storeOfCompany } from "@/domain/ecommerce/common";
import { storePreviewData, type PreviewCard } from "@/domain/ecommerce/catalog";
import type { PreviewProduct } from "./_components/store-preview";

/**
 * Produtos reais da vitrine para a miniatura da loja (Central, editor e modelos). As fotos vêm pela mesma rota de imagens
 * da vitrine — que só entrega a identidade da loja e fotos de produtos do catálogo dela, inclusive com a loja em
 * rascunho —, como na edição do catálogo: a prévia mostra exatamente a foto que o cliente vai ver.
 */
export async function storePreviewProps(store: Store, st: Doc): Promise<{ products: PreviewProduct[]; categories: string[]; offer: PreviewProduct | null }> {
  const { cards, categories, offer } = await storePreviewData(store, st, 8);
  const product = (c: PreviewCard): PreviewProduct => ({ title: c.title, price: c.price, compareAtPrice: c.compareAtPrice, category: c.category, imageUrl: c.imageFileId ? `/loja/${st.slug}/imagem/${c.imageFileId}` : null });
  return { products: cards.map(product), categories, offer: offer ? product(offer) : null };
}

/** Operações do comércio digital (§49). */
export const ECOM_ACTIONS: SpecialAction[] = ["ecommerce.manage", "ecommerce.catalog", "ecommerce.orders", "ecommerce.cancel", "ecommerce.marketing", "ecommerce.finance"];

/**
 * Sessão das telas do comércio digital: módulo Vendas, recurso `comercioDigital` ligado e ao menos uma das operações
 * pedidas. Devolve também a loja da empresa (ou null, antes de criada).
 */
export async function ecomPage(actions: SpecialAction | SpecialAction[] = ECOM_ACTIONS): Promise<{ s: SessionInfo; st: Doc | null }> {
  const s = await requireSession("sales");
  await requireFeaturePage(s, "comercioDigital");
  const list = Array.isArray(actions) ? actions : [actions];
  if (!list.some((a) => canDo(s.user, a))) redirect("/sem-permissao");
  const st = await storeOfCompany(s.ctx.store, s.ctx.companyId);
  return { s, st };
}

/** Como `ecomPage`, mas a loja precisa existir (sem loja, volta à central para criá-la). */
export async function ecomStorePage(actions: SpecialAction | SpecialAction[] = ECOM_ACTIONS): Promise<{ s: SessionInfo; st: Doc }> {
  const r = await ecomPage(actions);
  if (!r.st) redirect("/comercio-digital");
  return r as { s: SessionInfo; st: Doc };
}

export const brDate = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
export const brDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
