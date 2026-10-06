import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { readFile } from "@/lib/core/files";
import { fileAccessDenial } from "./access";

/** Tipos seguros para exibição no navegador; o resto é sempre baixado como anexo. */
const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

/**
 * Download de arquivo armazenado (XML, anexos, comprovantes, imagens, backups).
 * Restrito à empresa ativa e à permissão do módulo de origem; certificado digital, backups e pacote contábil exigem
 * as operações específicas (fiscal.configure / admin.backup / data.export) — regra em `./access.ts`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireApiSession("text");
  if (s instanceof NextResponse) return s;
  const { id } = await params;
  const meta0 = await s.ctx.store.get("files", id);
  if (!meta0 || meta0.companyId !== s.ctx.companyId) return new NextResponse("Arquivo não encontrado", { status: 404 });
  const denied = fileAccessDenial(s.user, meta0);
  if (denied) return new NextResponse(denied, { status: 403 });
  try {
    const { meta, data } = await readFile(s.ctx, id);
    const mime = String(meta.mime ?? "");
    const inline = req.nextUrl.searchParams.get("inline") === "1" && SAFE_INLINE.test(mime);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": inline ? mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        "X-Content-Type-Options": "nosniff",
        ...(mime === "application/pdf" && inline ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Arquivo não encontrado", { status: 404 });
  }
}
