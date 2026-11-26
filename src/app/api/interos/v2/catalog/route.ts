import doc from "../../../../../../docs/MODULE_CATALOG/catalogo-modulos-erp-v2.json";
import { handle, ok } from "../_lib";

export const dynamic = "force-dynamic";

/** GET /api/interos/v2/catalog — catálogo hierárquico v2 (módulos, submódulos, unidades, dependências, disponibilidade). */
export function GET(req: Request) {
  return handle(req, "erp.license.read", async ({ requestId }) => ok(doc, { requestId, headers: { ETag: `"${doc.catalogVersion}"` } }));
}
