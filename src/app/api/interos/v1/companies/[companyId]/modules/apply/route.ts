import { BusinessError } from "@/lib/core/errors";
import { publicOperation, resumeIfStuck, submitApply } from "@/domain/modules/operations";
import { companyOrThrow } from "@/domain/modules/changes";
import { companyIdParam, errorStatus, fail, handle, ok, parseChangeSet, readJson } from "../../../../_modules";

export const dynamic = "force-dynamic";

/**
 * POST /api/interos/v1/companies/{companyId}/modules/apply — aplica um lote (atômico, dependências consistentes).
 * Cabeçalhos: Idempotency-Key (obrigatório), X-Interos-Actor (obrigatório), If-Match: "<versão>" (ou expectedVersion no corpo).
 * Resposta: a operação com o estado confirmado pelo ERP (applied | rejected | scheduled). Repetição = mesma operação.
 */
export function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.write", async ({ store, client, requestId }) => {
    const companyId = companyIdParam(client, (await params).companyId);
    // empresa inexistente: 404 company_not_found (antes de registrar a operação) — correção 13
    await companyOrThrow(store, companyId);
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
    const headers = { ...(op.versionAfter ? { ETag: `"${op.versionAfter}"` } : {}), "Idempotent-Replayed": String(replayed), Location: `/api/interos/v1/operations/${op.id}` };
    // operação recusada: envelope de erro do contrato, com o status do código (version_conflict → 409,
    // changes_rejected → 422…) e a operação registrada nos detalhes — correção 13
    if (op.status === "rejected") {
      const code = String(op.error?.code ?? "changes_rejected");
      const res = fail(errorStatus(code), code, String(op.error?.message ?? "Lote recusado."), requestId, { ...(op.error?.details ?? {}), operationId: op.id, operation: publicOperation(op) });
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }
    const status = op.status === "applied" ? (replayed ? 200 : 201) : 202;
    return ok(publicOperation(op), { requestId, status, headers });
  });
}
