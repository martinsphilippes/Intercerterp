import { NextResponse } from "next/server";
import { loadStore } from "../_lib";

/** robots.txt da loja: no domínio próprio publicado, libera a vitrine e aponta o sitemap; carrinho e pedidos ficam fora. */
export async function GET(req: Request, { params }: { params: Promise<{ store: string }> }) {
  const { store: ref } = await params;
  const s = await loadStore(decodeURIComponent(ref));
  if (!s || s.access !== "open") return new NextResponse("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const origin = s.viaDomain ? `https://${decodeURIComponent(ref).slice(1)}` : `${new URL(req.url).origin}${s.basePath}`;
  const p = s.basePath;
  const body = ["User-agent: *", `Allow: ${p || "/"}`, `Disallow: ${p}/carrinho`, `Disallow: ${p}/checkout`, `Disallow: ${p}/pedido/`, `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
  return new NextResponse(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
