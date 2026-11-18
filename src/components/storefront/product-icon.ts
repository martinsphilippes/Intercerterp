import { Coffee, Shirt, Lamp, ShoppingBag, Headphones, GlassWater, ShoppingBasket, Sparkles, Package, Footprints, NotebookPen, Watch, type LucideIcon } from "lucide-react";
import { searchable } from "@/lib/core/text";

/**
 * Ilustração do produto sem foto, pela categoria. A mesma regra na vitrine (Telas 61–64) e na miniatura da loja dentro
 * do ERP (Telas 49–51), para a prévia mostrar o que o cliente vê. Sem dependências de servidor: serve também à galeria
 * de modelos, que roda no navegador.
 */
export function iconFor(category: string | null | undefined): LucideIcon {
  const c = searchable(category);
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
