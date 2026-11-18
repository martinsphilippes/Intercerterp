import { Megaphone, Sparkles, Store as StoreIcon, LayoutGrid, Truck, CreditCard, Package } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { PreviewThumb } from "./preview-thumb";
import { onAccent, templateOf, type TemplateKey } from "@/domain/ecommerce/templates";

/**
 * Prévia em miniatura da vitrine (Telas 49–51): mesma composição do modelo aplicado na loja pública — muda a
 * apresentação (abertura, ordem das seções, colunas), nunca o catálogo, o checkout ou as regras. Mostra os produtos,
 * preços e categorias reais da loja, na ordem da vitrine; só a loja sem produto vendável vê exemplos, rotulados.
 */

/** Produto da miniatura: preço em centavos; a foto, quando houver, num endereço que o navegador de quem vê consegue abrir. */
export interface PreviewProduct {
  title: string;
  price: number;
  compareAtPrice?: number | null;
  category: string | null;
  imageUrl?: string | null;
}

const SAMPLE: PreviewProduct[] = [
  { title: "Cafeteira elétrica", price: 12990, compareAtPrice: 15990, category: "Casa" },
  { title: "Camiseta essencial", price: 8990, category: "Moda" },
  { title: "Luminária de mesa", price: 7990, category: "Decoração" },
  { title: "Bolsa transversal", price: 11990, category: "Bolsas" },
  { title: "Fone sem fio", price: 14990, category: "Eletrônicos" },
  { title: "Garrafa térmica", price: 4990, category: "Garrafas" },
];
const SAMPLE_CATEGORIES = ["Casa", "Moda", "Acessórios"];

export function StorePreview({
  template,
  accent,
  storeName,
  title,
  tagline,
  device = "desktop",
  sections = { categories: true, benefits: true, featured: true },
  compact = false,
  products = [],
  categories = [],
  offer = null,
}: {
  template: TemplateKey | string;
  accent: string;
  storeName: string;
  title: string;
  tagline?: string;
  device?: "desktop" | "mobile";
  sections?: { categories: boolean; benefits: boolean; featured: boolean };
  compact?: boolean;
  /** produtos vendáveis da loja, na ordem da vitrine (vazio: exemplos) */
  products?: PreviewProduct[];
  /** categorias dos produtos da vitrine, em ordem alfabética */
  categories?: string[];
  /** produto da oferta escolhido para o modelo Campanha (sem ele, o primeiro da vitrine) */
  offer?: PreviewProduct | null;
}) {
  const tpl = templateOf(template);
  const fg = onAccent(accent);
  const mobile = device === "mobile";
  const cols = mobile ? 2 : compact ? 3 : tpl.gridColumns;
  const real = products.length > 0;
  const source = real ? products : SAMPLE;
  const items = source.slice(0, mobile ? 4 : compact ? 3 : cols * (tpl.gridColumns === 4 ? 1 : 2));
  const chips = ["Todos", ...(real ? categories : SAMPLE_CATEGORIES)].slice(0, mobile ? 3 : 4);
  const lead = (real && offer) || source[0];
  const leadWas = lead.compareAtPrice && lead.compareAtPrice > lead.price ? lead.compareAtPrice : null;
  return (
    <div
      className={`overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm ${mobile ? "mx-auto w-[220px]" : "w-full"}`}
      aria-label={`Prévia do modelo ${tpl.name} ${real ? "com os produtos da loja" : "com produtos de exemplo"}`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold" style={{ color: accent }}>
          <StoreIcon className="size-3.5 shrink-0" aria-hidden /> {storeName}
        </span>
        <span className="shrink-0 text-[10px] text-slate-500">Carrinho (0)</span>
      </div>
      <div className="space-y-2 p-2.5">
        {tpl.hero === "simple" && (
          <div className="flex items-center justify-between rounded-md px-3 py-2.5" style={{ background: `${accent}14` }}>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: accent }}>Bem-vindo à nossa loja</p>
              <p className="truncate text-[12px] font-bold text-ink">{title}</p>
              {!compact && tagline && <p className="truncate text-[10px] text-slate-500">{tagline}</p>}
            </div>
            <LayoutGrid className="size-5 shrink-0" style={{ color: accent }} aria-hidden />
          </div>
        )}
        {tpl.hero === "editorial" && (
          <div className="grid grid-cols-5 gap-1.5">
            <div className="col-span-3 flex flex-col justify-end rounded-md p-2.5" style={{ background: accent, color: fg }}>
              <Sparkles className="mb-1 size-4" aria-hidden />
              <p className="text-[12px] font-bold leading-tight">{title}</p>
              {!compact && tagline && <p className="text-[9px] opacity-80">{tagline}</p>}
            </div>
            <div className="col-span-2 grid gap-1.5">
              {source.slice(0, 2).map((p, i) => (
                <PreviewThumb key={`${p.title}-${i}`} category={p.category} imageUrl={p.imageUrl} accent={accent} className="rounded-md py-2" />
              ))}
            </div>
          </div>
        )}
        {tpl.hero === "offer" && (
          <div className="flex items-center justify-between rounded-md px-3 py-2.5" style={{ background: `${accent}14` }}>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: accent }}>Oferta em destaque</p>
              <p className="truncate text-[12px] font-bold text-ink">{title}</p>
              <p className="truncate text-[9px] text-slate-600">{lead.title}</p>
              <p className="text-[10px]">
                {leadWas && <span className="text-slate-400 line-through">{formatMoney(leadWas)}</span>}{" "}
                <span className="font-bold" style={{ color: accent }}>{formatMoney(lead.price)}</span>
              </p>
            </div>
            <Megaphone className="size-5 shrink-0" style={{ color: accent }} aria-hidden />
          </div>
        )}
        {sections.categories && tpl.sections.includes("categories") && (
          <div className="flex gap-1 overflow-hidden">
            {chips.map((c, i) => (
              <span key={c} className="shrink-0 rounded-full border px-2 py-0.5 text-[9px]" style={i === 0 ? { borderColor: accent, color: accent } : { borderColor: "#e2e8f0", color: "#64748b" }}>
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {items.map((p, i) => (
            <div key={`${p.title}-${i}`} className="min-w-0 rounded-md border border-slate-100">
              <PreviewThumb category={p.category} imageUrl={p.imageUrl} accent={accent} className="rounded-t-md py-2.5" />
              <div className="px-1.5 py-1">
                <p className="truncate text-[9px] text-slate-600" title={p.title}>{p.title}</p>
                <p className="text-[10px] font-bold text-ink">{formatMoney(p.price)}</p>
              </div>
            </div>
          ))}
        </div>
        {!real && <p className="text-center text-[9px] text-slate-400">{compact ? "Produtos de exemplo" : "Produtos de exemplo: os da loja aparecem aqui quando entrarem na vitrine."}</p>}
        {sections.benefits && !compact && (
          <div className="flex justify-between border-t border-slate-100 pt-1.5 text-[8.5px] text-slate-500">
            <span className="flex items-center gap-1"><Package className="size-3" aria-hidden /> Catálogo</span>
            <span className="flex items-center gap-1"><Truck className="size-3" aria-hidden /> Entrega ou retirada</span>
            <span className="flex items-center gap-1"><CreditCard className="size-3" aria-hidden /> Checkout</span>
          </div>
        )}
      </div>
    </div>
  );
}
