import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { readFile } from "@/lib/core/files";
import { can, canDo, type ModuleKey } from "@/lib/permissions";

/** Módulo exigido para ler o arquivo, conforme o registro de origem. */
const ENTITY_MODULE: Record<string, ModuleKey> = {
  title: "finance",
  bank_import: "finance",
  bank_transaction: "finance",
  reconciliation: "finance",
  fiscal_document: "fiscal",
  fiscal_obligation: "fiscal",
  fiscal_export: "fiscal",
  tax_group: "fiscal",
  receipt: "purchases",
  product: "products",
  ticket: "support",
  sale: "sales",
  return: "sales",
  branch: "admin",
  setting: "admin",
};

/** Tipos seguros para exibição no navegador; o resto é sempre baixado como anexo. */
const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

/**
 * Download de arquivo armazenado (XML, anexos, comprovantes, imagens, backups).
 * Restrito à empresa ativa e à permissão do módulo de origem; certificado digital e backups exigem
 * as operações específicas (fiscal.configure / admin.backup).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s?.ctx.companyId) return new NextResponse("Não autenticado", { status: 401 });
  const { id } = await params;
  const meta0 = await s.ctx.store.get("files", id);
  if (!meta0 || meta0.companyId !== s.ctx.companyId) return new NextResponse("Arquivo não encontrado", { status: 404 });
  if (meta0.bucket === "backups" || meta0.entityType === "backup" || meta0.entityType === "restore_job") {
    if (!canDo(s.user, "admin.backup")) return new NextResponse("Sem permissão para arquivos de backup", { status: 403 });
  } else if (meta0.kind === "certificate_a1" || meta0.entityType === "fiscal_config") {
    if (!canDo(s.user, "fiscal.configure")) return new NextResponse("Sem permissão para o certificado digital", { status: 403 });
  } else {
    const requiredModule = (meta0.entityType && ENTITY_MODULE[meta0.entityType]) || (meta0.bucket === "images" ? "products" : null);
    if (!requiredModule || !can(s.user, requiredModule, "view")) return new NextResponse("Sem permissão para este arquivo", { status: 403 });
  }
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
