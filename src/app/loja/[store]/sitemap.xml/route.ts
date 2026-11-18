import { NextResponse } from "next/server";
import { sitemapEntries } from "@/domain/ecommerce/catalog";
import { PAGE_SLUG } from "@/domain/ecommerce/store";
import { loadStore } from "../_lib";

/** Sitemap da loja publicada (página inicial, produtos vendáveis e páginas institucionais). */
export async function GET(req: Request, { params }: { params: Promise<{ store: string }> }) {
  const { store: ref } = await params;
  const s = await loadStore(decodeURIComponent(ref));
  if (!s || s.access !== "open") return new NextResponse("Não encontrado", { status: 404 });
  const origin = s.viaDomain ? `https://${decodeURIComponent(ref).slice(1)}` : `${new URL(req.url).origin}${s.basePath}`;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const urls = [
    `<url><loc>${esc(origin || "/")}</loc></url>`,
    ...(await sitemapEntries(s.store, s.st)).map((e) => `<url><loc>${esc(`${origin}/produto/${e.slug}`)}</loc>${e.updatedAt ? `<lastmod>${String(e.updatedAt).slice(0, 10)}</lastmod>` : ""}</url>`),
    ...Object.values(PAGE_SLUG).map((p) => `<url><loc>${esc(`${origin}/pagina/${p}`)}</loc></url>`),
  ];
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
