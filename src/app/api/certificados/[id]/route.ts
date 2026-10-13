import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { BusinessError, PermissionError } from "@/lib/core/errors";
import { downloadIssuedCertificate } from "@/domain/accounting/certificates";

/**
 * Download do certificado digital emitido (Tela 67): POST com o campo `password` (confirmação de identidade do
 * usuário). Permitido ao escritório com autorização do titular e ao próprio titular (empresa vinculada). Cada download
 * é contado e registrado no histórico da solicitação; a senha do certificado nunca passa por aqui.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireApiSession("text");
  if (s instanceof NextResponse) return s;
  const { id } = await params;
  let password = "";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) password = String((await req.json().catch(() => ({})))?.password ?? "");
  else password = String((await req.formData().catch(() => null))?.get("password") ?? "");
  try {
    const { name, data } = await downloadIssuedCertificate(s.ctx, id, { password });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    if (e instanceof PermissionError) return new NextResponse("Sem permissão para baixar este certificado", { status: 403 });
    if (e instanceof BusinessError) return new NextResponse(e.message, { status: e.code === "password" ? 401 : e.code === "not_found" ? 404 : 409 });
    console.error("[certificados] download", e);
    return new NextResponse("Não foi possível baixar o certificado", { status: 500 });
  }
}
