import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { getExport, toCsv } from "@/lib/exporters";
import { can, canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import "@/exports";

/** Exporta o recorte filtrado de uma listagem (mesma consulta da tela). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const s = await requireApiSession("text");
  if (s instanceof NextResponse) return s;
  const { key } = await params;
  const def = getExport(key);
  if (!def) return new NextResponse("Exportação desconhecida", { status: 404 });
  if (!can(s.user, def.module) || !canDo(s.user, "data.export")) return new NextResponse("Sem permissão para exportar", { status: 403 });
  const sp: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (sp[k] = v));
  const rows = await def.rows(s, sp);
  await audit(s.ctx, { module: def.module, action: "data.export", entityType: "export", entityId: key, summary: `Exportação "${def.title}" (${rows.length} linhas)`, after: { filters: sp } });
  const csv = toCsv(def.columns, rows);
  const name = `${key}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
