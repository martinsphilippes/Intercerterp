/**
 * Modelos da loja (Tela 50): estrutura inicial da vitrine. O modelo muda a apresentação; catálogo, checkout, estoque,
 * pedidos e pagamento continuam os mesmos (compartilhados com o ERP).
 */
export type TemplateKey = "essencial" | "colecao" | "campanha";

export interface StoreTemplate {
  key: TemplateKey;
  name: string;
  purpose: string;
  description: string;
  /** como a vitrine abre: faixa simples, destaque editorial da coleção ou oferta principal */
  hero: "simple" | "editorial" | "offer";
  /** seções na ordem em que aparecem na página inicial */
  sections: Array<"hero" | "categories" | "featured" | "grid" | "benefits">;
  /** produtos por linha na grade (computador) */
  gridColumns: 3 | 4;
  /** cor de destaque sugerida para o modelo */
  suggestedAccent: string;
}

export const TEMPLATES: Record<TemplateKey, StoreTemplate> = {
  essencial: {
    key: "essencial",
    name: "Essencial",
    purpose: "Varejo geral",
    description: "Busca, categorias e grade de produtos logo na abertura. Indicado para lojas com muitos itens e compra recorrente.",
    hero: "simple",
    sections: ["hero", "categories", "grid", "benefits"],
    gridColumns: 4,
    suggestedAccent: "#c2410c",
  },
  colecao: {
    key: "colecao",
    name: "Coleção",
    purpose: "Destaque editorial",
    description: "Abre com a coleção em destaque e texto de apoio; depois, os produtos. Indicado para moda, decoração e lançamentos.",
    hero: "editorial",
    sections: ["hero", "featured", "categories", "grid", "benefits"],
    gridColumns: 3,
    suggestedAccent: "#1d4ed8",
  },
  campanha: {
    key: "campanha",
    name: "Campanha",
    purpose: "Oferta principal",
    description: "Uma oferta principal em destaque (preço de/por) e chamada única para a compra. Indicado para datas comerciais.",
    hero: "offer",
    sections: ["hero", "featured", "grid", "benefits"],
    gridColumns: 4,
    suggestedAccent: "#be123c",
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[];

export function templateOf(key: string | null | undefined): StoreTemplate {
  return TEMPLATES[(key as TemplateKey) ?? "essencial"] ?? TEMPLATES.essencial;
}

/** Cor de destaque válida (#rgb ou #rrggbb); outra coisa volta ao padrão. */
export function safeAccent(v: string | null | undefined, fallback = "#c2410c"): string {
  const c = String(v ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c.toLowerCase() : fallback;
}

/** Texto (branco ou quase preto) legível sobre a cor de destaque. */
export function onAccent(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#111827" : "#ffffff";
}
