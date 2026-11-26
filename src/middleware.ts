import { NextResponse, type NextRequest } from "next/server";

/**
 * Domínio próprio das lojas virtuais (§49): requisições que chegam por um host que NÃO é do ERP são reescritas para a
 * vitrine (/loja/~<host>/...). A página da vitrine só abre a loja cujo domínio foi verificado (apontamento + TXT);
 * host desconhecido mostra "endereço não ligado a uma loja", com o caminho para o ERP.
 *
 * Hosts do ERP (nunca reescritos): localhost, *.vercel.app, o host de APP_URL, os hosts da própria publicação na Vercel
 * e os listados em APP_HOSTS (separados por vírgula) — inclua ali o domínio próprio do ERP, se houver.
 */
function erpHosts(): string[] {
  const fromUrl = (v: string | undefined) => String(v ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  return [
    fromUrl(process.env.APP_URL),
    fromUrl(process.env.VERCEL_URL),
    fromUrl(process.env.VERCEL_BRANCH_URL),
    fromUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ...String(process.env.APP_HOSTS ?? "").split(",").map((h) => fromUrl(h.trim())),
  ].filter(Boolean);
}

export function isErpHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (h.endsWith(".vercel.app") || h.endsWith(".localhost")) return true;
  return erpHosts().includes(h);
}

/**
 * Caminho da requisição para o controle de módulos (requireSession decide a tela pelo caminho). O valor do cliente é
 * sempre sobrescrito: o cabeçalho só chega ao servidor com o caminho real.
 */
export const PATH_HEADER = "x-ic-path";
function withPath(req: NextRequest, pathname: string) {
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, pathname);
  return headers;
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (isErpHost(host)) return NextResponse.next({ request: { headers: withPath(req, req.nextUrl.pathname) } });
  const url = req.nextUrl.clone();
  const path = url.pathname;
  // no domínio da loja, o caminho do ERP /loja/... não existe (evita abrir outra loja pelo domínio desta)
  if (path.startsWith("/loja/")) return new NextResponse("Não encontrado", { status: 404 });
  url.pathname = `/loja/~${host.replace(/:\d+$/, "")}${path === "/" ? "" : path}`;
  return NextResponse.rewrite(url, { request: { headers: withPath(req, url.pathname) } });
}

export const config = {
  // estáticos do Next, APIs (avisos do gateway, rotinas), ícones e o service worker passam direto
  matcher: ["/((?!_next/|api/|icons/|sw\\.js|offline\\.html|favicon).*)"],
};
