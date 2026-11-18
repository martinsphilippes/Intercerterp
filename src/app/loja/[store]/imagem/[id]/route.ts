import { NextResponse } from "next/server";
import { getFileStorage } from "@/lib/core/files";
import { isPublicImage } from "@/domain/ecommerce/catalog";
import { loadStore } from "../../_lib";

/**
 * Imagem da vitrine: só arquivos ligados à identidade da loja ou a produtos do catálogo dela (nunca outros arquivos da
 * empresa). Tipos de imagem apenas, com cabeçalhos que impedem execução de conteúdo.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ store: string; id: string }> }) {
  const { store: ref, id } = await params;
  if (!/^[0-9a-zA-Z_-]{8,64}$/.test(id)) return new NextResponse("Não encontrado", { status: 404 });
  const s = await loadStore(decodeURIComponent(ref));
  if (!s) return new NextResponse("Não encontrado", { status: 404 });
  const meta = await s.store.get("files", id);
  if (!meta || meta.companyId !== s.st.companyId || !/^image\/(png|jpeg|webp)$/.test(String(meta.mime))) return new NextResponse("Não encontrado", { status: 404 });
  if (!(await isPublicImage(s.store, s.st, id))) return new NextResponse("Não encontrado", { status: 404 });
  const data = await getFileStorage().get(meta.bucket, meta.storageId);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": meta.mime,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
