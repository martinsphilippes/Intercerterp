import { BusinessError } from "@/lib/core/errors";
import { companyUsage } from "@/domain/licensing/usage";
import { companyOrThrow } from "@/domain/modules/changes";
import { companyParam, handle, ok } from "../../../_lib";

export const dynamic = "force-dynamic";

/** GET ?from&to — telemetria agregada (sem dados pessoais nem documentos). Padrão: últimos 30 dias. */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.usage.read", async (r) => {
    const companyId = await companyParam(r, (await params).companyId);
    await companyOrThrow(r.store, companyId);
    const u = new URL(req.url);
    const to = u.searchParams.get("to") ?? new Date().toISOString();
    const from = u.searchParams.get("from") ?? new Date(Date.parse(to) - 30 * 86400000).toISOString();
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) throw new BusinessError("Período inválido (from/to ISO-8601).", "invalid_request");
    return ok(await companyUsage(r.store, companyId, new Date(from).toISOString(), new Date(to).toISOString()), { requestId: r.requestId });
  });
}
