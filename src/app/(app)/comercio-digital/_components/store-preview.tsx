import { Coffee, Shirt, Lamp, ShoppingBag, Headphones, Megaphone, Sparkles, Store as StoreIcon, LayoutGrid, Truck, CreditCard, Package } from "lucide-react";
import { onAccent, templateOf, type TemplateKey } from "@/domain/ecommerce/templates";

/**
 * Prévia em miniatura da vitrine (Telas 49–51): mesma composição do modelo aplicado na loja pública — muda a
 * apresentação (abertura, ordem das seções, colunas), nunca o catálogo, o checkout ou as regras.
 */

const SAMPLE = [
  { title: "Cafeteira elétrica", price: "R$ 129,90", Icon: Coffee },
  { title: "Camiseta essencial", price: "R$ 89,90", Icon: Shirt },
  { title: "Luminária de mesa", price: "R$ 79,90", Icon: Lamp },
  { title: "Bolsa transversal", price: "R$ 119,90", Icon: ShoppingBag },
  { title: "Fone sem fio", price: "R$ 149,90", Icon: Headphones },
  { title: "Garrafa térmica", price: "R$ 49,90", Icon: Package },
];

export function StorePreview({
  template,
  accent,
  storeName,
  title,
  tagline,
  device = "desktop",
  sections = { categories: true, benefits: true, featured: true },
  compact = false,
}: {
  template: TemplateKey | string;
  accent: string;
  storeName: string;
  title: string;
  tagline?: string;
  device?: "desktop" | "mobile";
  sections?: { categories: boolean; benefits: boolean; featured: boolean };
  compact?: boolean;
}) {
  const tpl = templateOf(template);
  const fg = onAccent(accent);
  const mobile = device === "mobile";
  const cols = mobile ? 2 : compact ? 3 : tpl.gridColumns;
  const items = SAMPLE.slice(0, mobile ? 4 : compact ? 3 : cols * (tpl.gridColumns === 4 ? 1 : 2));
  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm ${mobile ? "mx-auto w-[220px]" : "w-full"}`} aria-label={`Prévia do modelo ${tpl.name}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: accent }}>
          <StoreIcon className="size-3.5" aria-hidden /> {storeName}
        </span>
        <span className="text-[10px] text-slate-500">Carrinho (2)</span>
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
              {SAMPLE.slice(0, 2).map(({ Icon, title: t }) => (
                <div key={t} className="flex items-center justify-center rounded-md bg-slate-50 py-2">
                  <Icon className="size-4" style={{ color: accent }} aria-hidden />
                </div>
              ))}
            </div>
          </div>
        )}
        {tpl.hero === "offer" && (
          <div className="flex items-center justify-between rounded-md px-3 py-2.5" style={{ background: `${accent}14` }}>
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: accent }}>Oferta em destaque</p>
              <p className="truncate text-[12px] font-bold text-ink">{title}</p>
              <p className="text-[10px]">
                <span className="text-slate-400 line-through">R$ 159,90</span> <span className="font-bold" style={{ color: accent }}>R$ 129,90</span>
              </p>
            </div>
            <Megaphone className="size-5 shrink-0" style={{ color: accent }} aria-hidden />
          </div>
        )}
        {sections.categories && tpl.sections.includes("categories") && (
          <div className="flex gap-1 overflow-hidden">
            {["Todos", "Casa", "Moda", "Acessórios"].slice(0, mobile ? 3 : 4).map((c, i) => (
              <span key={c} className="rounded-full border px-2 py-0.5 text-[9px]" style={i === 0 ? { borderColor: accent, color: accent } : { borderColor: "#e2e8f0", color: "#64748b" }}>
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {items.map(({ Icon, title: t, price }) => (
            <div key={t} className="rounded-md border border-slate-100">
              <div className="flex items-center justify-center rounded-t-md bg-slate-50 py-2.5">
                <Icon className="size-4" style={{ color: accent }} aria-hidden />
              </div>
              <div className="px-1.5 py-1">
                <p className="truncate text-[9px] text-slate-600">{t}</p>
                <p className="text-[10px] font-bold text-ink">{price}</p>
              </div>
            </div>
          ))}
        </div>
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
