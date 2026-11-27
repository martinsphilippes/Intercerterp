import { parseSnapshot, planLicense } from "@/domain/licensing/license";
import { BusinessError } from "@/lib/core/errors";
import { companyParam, handle, ok } from "../../../../_lib";

export const dynamic = "force-dynamic";

/** POST — simula o retrato: unidades efetivas, alterações no runtime, pendências, rejeições e próxima transição. */
export function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.license.read", async (r) => {
    const companyId = await companyParam(r, (await params).companyId);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new BusinessError("JSON inválido.", "invalid_request");
    }
    return ok(await planLicense(r.store, companyId, parseSnapshot(body, companyId)), { requestId: r.requestId });
  });
}
