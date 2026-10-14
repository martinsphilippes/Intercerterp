import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { exportFormat, getExport, toCsv, toXlsx } from "@/lib/exporters";
import { XLSX_MIME } from "@/lib/xlsx";
import { can, canDo } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import "@/exports";

/**
 * Exporta o recorte filtrado de uma listagem (mesma consulta da tela). CSV por padrão; `formato=xlsx` gera a mesma
 * tabela como planilha XLSX (PLA-11). O parâmetro `formato` não é repassado aos filtros.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const s = await requireApiSession("text");
  if (s instanceof NextResponse) return s;
  const { key } = await params;
  const def = getExport(key);
  if (!def) return new NextResponse("Exportação desconhecida", { status: 404 });
  if (!can(s.user, def.module) || !canDo(s.user, "data.export")) return new NextResponse("Sem permissão para exportar", { status: 403 });
  const sp: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (sp[k] = v));
  const format = exportFormat(sp.formato);
  delete sp.formato;
  const rows = await def.rows(s, sp);
  await audit(s.ctx, { module: def.module, action: "data.export", entityType: "export", entityId: key, summary: `Exportação "${def.title}" (${rows.length} linhas${format === "xlsx" ? ", XLSX" : ""})`, after: { filters: sp } });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") {
    const bin = await toXlsx(def.title, def.columns, rows);
    return new NextResponse(Buffer.from(bin), { headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${key}-${stamp}.xlsx"` } });
  }
  const csv = toCsv(def.columns, rows);
  const name = `${key}-${stamp}.csv`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}
