import { handle, ok } from "../_modules";
import { catalogDocument } from "@/lib/modules/export";

export const dynamic = "force-dynamic";

/** GET /api/interos/v1/catalog — catálogo versionado (catalogo-modulos-erp-v1). */
export function GET(req: Request) {
  return handle(req, "erp.modules.read", async ({ requestId }) => ok(catalogDocument(), { requestId, headers: { ETag: `"${catalogDocument().catalogVersion}"` } }));
}
