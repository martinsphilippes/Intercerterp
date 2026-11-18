import { Coffee, Shirt, Lamp, ShoppingBag, Headphones, GlassWater, ShoppingBasket, Sparkles, Package, Footprints, NotebookPen, Watch } from "lucide-react";
import { slugify } from "@/domain/ecommerce/common";

/** Ilustração do produto sem foto, pela categoria (a vitrine nunca mostra uma caixa vazia). */
export function iconFor(category: string | null | undefined) {
  const c = slugify(category ?? "");
  if (/casa|cozinha|cafe|utilidade|mesa/.test(c)) return Coffee;
  if (/moda|roupa|vestu|camis/.test(c)) return Shirt;
  if (/calcad|tenis|sapat/.test(c)) return Footprints;
  if (/ilumin|lumin|decor/.test(c)) return Lamp;
  if (/acess|bolsa|bag/.test(c)) return /acess/.test(c) ? Watch : ShoppingBag;
  if (/eletr|audio|fone|tecno|info/.test(c)) return Headphones;
  if (/bebida|garraf|esporte|fitness/.test(c)) return GlassWater;
  if (/papel|escrit|caderno/.test(c)) return NotebookPen;
  if (/aliment|mercad|hortifruti|padaria/.test(c)) return ShoppingBasket;
  if (/beleza|perfum|cosmet|higiene/.test(c)) return Sparkles;
  return Package;
}

export function ProductArt({ category, imageUrl, alt, size = "card" }: { category: string | null | undefined; imageUrl: string | null; alt: string; size?: "card" | "page" | "thumb" }) {
  const box = size === "page" ? "aspect-square w-full rounded-xl" : size === "thumb" ? "size-16 rounded-lg" : "aspect-[4/3] w-full rounded-t-xl";
  if (imageUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={alt} loading="lazy" className={`${box} bg-slate-50 object-cover`} />;
  const Icon = iconFor(category);
  const icon = size === "page" ? "size-28" : size === "thumb" ? "size-7" : "size-12";
  return (
    <div className={`${box} flex items-center justify-center bg-[color-mix(in_srgb,var(--store-accent)_7%,#f8fafc)]`} role="img" aria-label={`${alt} (ilustração)`}>
      <Icon className={`${icon} text-[var(--store-accent)]`} aria-hidden strokeWidth={1.6} />
    </div>
  );
}
