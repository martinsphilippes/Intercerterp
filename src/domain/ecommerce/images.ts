import type { Ctx } from "@/lib/core/ctx";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction } from "@/lib/core/ctx";
import { saveFile } from "@/lib/core/files";
import { requireStore, slugify } from "./common";

/**
 * Imagens da loja: logotipo, destaque e fotos dos produtos (PNG, JPEG ou WebP até 2 MB, conferidos pelo conteúdo — não
 * pela extensão). São arquivos da empresa com o tipo "store_image"; a vitrine só serve publicamente as imagens ligadas à
 * identidade da loja ou a produtos na vitrine. Produto sem foto mostra a ilustração da categoria (SVG gerado).
 */

export const STORE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export function sniffImage(data: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (data.length > 8 && data[0] === 0x89 && data.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length > 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function uploadStoreImage(ctx: Ctx, input: { name: string; data: Buffer; purpose: "logo" | "hero" | "product" }) {
  requireAction(ctx, input.purpose === "product" ? "ecommerce.catalog" : "ecommerce.manage");
  const st = await requireStore(ctx);
  assert(input.data.length > 0, "Arquivo vazio.");
  if (input.data.length > STORE_IMAGE_MAX_BYTES) throw new BusinessError("Imagem acima de 2 MB: reduza o tamanho antes de enviar.", "image_too_large");
  const mime = sniffImage(input.data);
  if (!mime) throw new BusinessError("Formato não aceito: envie PNG, JPEG ou WebP.", "image_format");
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const base = slugify(input.name.replace(/\.[a-z0-9]+$/i, "")) || input.purpose;
  return saveFile(ctx, { bucket: "images", name: `${base}.${ext}`, mime, data: input.data, entityType: "store", entityId: st.id, kind: "store_image", branchId: null });
}

/** Ícone da ilustração pela categoria (palavras-chave do nome). */
export function categoryIcon(category: string | null | undefined): keyof typeof ICONS {
  const c = slugify(category ?? "");
  if (/casa|cozinha|cafe|utilidade|mesa/.test(c)) return "cup";
  if (/moda|roupa|vestu|camis|calcad/.test(c)) return "shirt";
  if (/ilumin|lumin|decor/.test(c)) return "lamp";
  if (/acess|bolsa|bag/.test(c)) return "bag";
  if (/eletr|audio|fone|tecno|info/.test(c)) return "headphones";
  if (/bebida|garraf|esporte|fitness/.test(c)) return "bottle";
  if (/aliment|mercad|hortifruti|padaria/.test(c)) return "basket";
  if (/beleza|perfum|cosmet|higiene/.test(c)) return "spark";
  return "box";
}

const ICONS = {
  cup: '<path d="M8 7h10v6a5 5 0 0 1-5 5h0a5 5 0 0 1-5-5V7Z"/><path d="M18 9h1.5a2.5 2.5 0 0 1 0 5H18"/><path d="M10 2v2M13 2v2M16 2v2"/>',
  shirt: '<path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-.6 1.2-2 2-4 2s-3.4-.8-4-2Z"/>',
  lamp: '<path d="M9 2h6l3 7H6l3-7Z"/><path d="M12 9v9"/><path d="M8 21h8"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  bottle: '<path d="M10 2h4v3l1.5 2.5V21h-7V7.5L10 5V2Z"/><path d="M8.5 12h7"/>',
  basket: '<path d="M3 10h18l-2 10H5L3 10Z"/><path d="m8 10 4-6 4 6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
};

/** Ilustração do produto sem foto (SVG leve, na cor de destaque da loja). */
export function placeholderSvg(category: string | null | undefined, accent: string, bg = "#f1f5f9") {
  const icon = ICONS[categoryIcon(category)];
  const color = /^#[0-9a-f]{3,6}$/i.test(accent) ? accent : "#1d4ed8";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="Ilustração do produto"><rect width="400" height="300" fill="${bg}"/><g transform="translate(152 102) scale(4)" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</g></svg>`;
}
