import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { can, canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import { backupArtifact, backupCode } from "@/domain/backup";

/** Download do artefato completo (partes concatenadas) — exige a operação "Backup e restauração". */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s?.ctx.companyId) return new NextResponse("Não autenticado", { status: 401 });
  if (!can(s.user, "admin") || !canDo(s.user, "admin.backup")) {
    await audit(s.ctx, { module: "admin", action: "backup.download.denied", entityType: "backup", entityId: (await params).id, summary: "Tentativa sem permissão: baixar artefato de backup", result: "failure" });
    return new NextResponse("Sem permissão", { status: 403 });
  }
  const { id } = await params;
  const b = await s.ctx.store.get("backups", id);
  if (!b || b.companyId !== s.ctx.companyId) return new NextResponse("Não encontrado", { status: 404 });
  try {
    const { buf, shaOk } = await backupArtifact(s.ctx.store, b);
    await audit(s.ctx, { module: "admin", action: "backup.download", entityType: "backup", entityId: id, summary: `Artefato ${backupCode(b)} baixado (${buf.length} bytes; SHA-256 ${shaOk === false ? "NÃO confere" : "confere"})` });
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${backupCode(b)}-${String(b.finishedAt ?? "").slice(0, 10)}.json.gz"`, "X-Checksum-SHA256": b.scope?.artifactSha256 ?? "" },
    });
  } catch (e: any) {
    return new NextResponse(`Artefato indisponível: ${e?.message ?? e}`, { status: 410 });
  }
}
