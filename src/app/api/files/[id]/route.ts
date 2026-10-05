import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { readFile } from "@/lib/core/files";
import { canDo } from "@/lib/permissions";

/** Download de arquivo armazenado (XML, anexos, comprovantes, backups) — restrito à empresa ativa. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s?.ctx.companyId) return new NextResponse("Não autenticado", { status: 401 });
  const { id } = await params;
  try {
    const meta0 = await s.ctx.store.get("files", id);
    if (meta0?.bucket === "backups" && !canDo(s.user, "admin.backup")) return new NextResponse("Sem permissão para arquivos de backup", { status: 403 });
    const { meta, data } = await readFile(s.ctx, id);
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": meta.mime ?? "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(meta.name)}"` },
    });
  } catch {
    return new NextResponse("Arquivo não encontrado", { status: 404 });
  }
}
