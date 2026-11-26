import doc from "../../../../../../../docs/MODULE_CATALOG/catalogo-modulos-erp-v2.json";
import { BusinessError } from "@/lib/core/errors";
import { handle, ok } from "../../_lib";

export const dynamic = "force-dynamic";

/** GET /api/interos/v2/catalog/{code} — um item e seus filhos diretos. */
export function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  return handle(req, "erp.license.read", async ({ requestId }) => {
    const { code } = await params;
    const item = doc.items.find((n) => n.code === code);
    if (!item) throw new BusinessError("Código inexistente no catálogo v2.", "not_found");
    return ok({ ...item, children: doc.items.filter((n) => n.parent === code).map((n) => ({ code: n.code, name: n.name, devStatus: n.devStatus, commercialClass: n.commercialClass, commercialUnit: n.commercialUnit, includedIn: n.includedIn, aliasOf: n.aliasOf })) }, { requestId });
  });
}
