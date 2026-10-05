import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { readFile } from "@/lib/core/files";

/** Download de arquivo armazenado (XML, anexos, comprovantes, backups) — restrito à empresa ativa. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s?.ctx.companyId) return new NextResponse("Não autenticado", { status: 401 });
  const { id } = await params;
  try {
    const { meta, data } = await readFile(s.ctx, id);
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": meta.mime ?? "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(meta.name)}"` },
    });
  } catch {
    return new NextResponse("Arquivo não encontrado", { status: 404 });
  }
}
