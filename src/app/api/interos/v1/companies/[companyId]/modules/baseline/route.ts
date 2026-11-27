import { detId } from "@/lib/db";
import { companyOrThrow } from "@/domain/modules/changes";
import { computeBaseline, takeBaseline } from "@/domain/modules/baseline";
import { companyIdParam, handle, ok } from "../../../../_modules";

export const dynamic = "force-dynamic";

/** GET — linha de base registrada (ou a calculada agora, se ainda não houver). */
export function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.read", async ({ store, client, requestId }) => {
    const companyId = companyIdParam(client, (await params).companyId);
    await companyOrThrow(store, companyId);
    const saved = await store.get("module_baselines", detId("modbase", companyId));
    return ok(saved ? { recorded: true, takenAt: saved.takenAt, status: saved.status, modules: saved.modules, usage: saved.usage, divergences: saved.divergences } : { recorded: false, ...(await computeBaseline(store, companyId)) }, { requestId });
  });
}

/** POST — grava a linha de base (modo legacy; idempotente: empresa com estado não é alterada). */
export function POST(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  return handle(req, "erp.modules.write", async ({ store, client, requestId }) => {
    const companyId = companyIdParam(client, (await params).companyId);
    await companyOrThrow(store, companyId);
    const r = await takeBaseline(store, companyId, "interos");
    return ok({ created: r.created, divergences: r.report?.divergences ?? [] }, { requestId, status: r.created ? 201 : 200 });
  });
}
