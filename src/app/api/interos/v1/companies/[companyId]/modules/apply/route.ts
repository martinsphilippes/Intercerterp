import { BusinessError } from "@/lib/core/errors";
import { publicOperation, resumeIfStuck, submitApply } from "@/domain/modules/operations";
import { companyIdParam, handle, ok, parseChangeSet, readJson } from "../../../../_lib";

export const dynamic = "force-dynamic";

/**
 * POST /api/interos/v1/companies/{companyId}/modules/apply — aplica um lote (atômico, dependências consistentes).
 * Cabeçalhos: Idempotency-Key (obrigatório), X-Interos-Actor (obrigatório), If-Match: "<versão>" (ou expectedVersion no corpo).
 * Resposta: a operação com o estado confirmado pelo ERP (applied | rejected | scheduled). Repetição = mesma operação.
 */
export function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.write", async ({ store, client, requestId }) => {
    const companyId = companyIdParam((await params).companyId);
    const idem = req.headers.get("idempotency-key")?.trim();
    if (!idem) throw new BusinessError("Cabeçalho Idempotency-Key obrigatório.", "idempotency_key_required");
    const actor = (req.headers.get("x-interos-actor") ?? "").trim().slice(0, 200);
    const body = await readJson(req);
    const ifMatch = req.headers.get("if-match")?.replace(/"/g, "").trim();
    const expectedVersion = body?.expectedVersion ?? (ifMatch ? Number(ifMatch) : null);
    if (expectedVersion != null && !Number.isInteger(expectedVersion)) throw new BusinessError("expectedVersion/If-Match deve ser um número inteiro.", "invalid_request");
    if (body?.effectiveAt != null && Number.isNaN(Date.parse(body.effectiveAt))) throw new BusinessError("effectiveAt deve ser data/hora ISO-8601.", "invalid_request");
    const request = { ...parseChangeSet(body), expectedVersion, reason: String(body?.reason ?? "").slice(0, 500), effectiveAt: body?.effectiveAt ? new Date(body.effectiveAt).toISOString() : null };
    const submitted = await submitApply(store, { clientId: client.id, idempotencyKey: idem, companyId, actor, request });
    const replayed = submitted.replayed;
    const op = replayed ? await resumeIfStuck(store, submitted.op) : submitted.op;
    const status = op.status === "applied" ? (replayed ? 200 : 201) : op.status === "scheduled" ? 202 : op.status === "rejected" ? 422 : 202;
    return ok(publicOperation(op), { requestId, status, headers: { ...(op.versionAfter ? { ETag: `"${op.versionAfter}"` } : {}), "Idempotent-Replayed": String(replayed), Location: `/api/interos/v1/operations/${op.id}` } });
  });
}
