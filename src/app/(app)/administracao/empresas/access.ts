import "server-only";
import type { Ctx } from "@/lib/core/ctx";
import type { Doc } from "@/lib/db/types";
import { NotFoundError } from "@/lib/db/types";
import { PermissionError } from "@/lib/core/errors";
import type { Crud } from "@/lib/permissions";
import type { SessionInfo } from "@/lib/server/session";
import { branchAdminCtx, companyAdminCtx } from "@/domain/companies";

/**
 * Telas de administração de empresas/filiais operam sobre a empresa ativa OU outra empresa autorizada.
 * O `ctx.store` da sessão é restrito à empresa ativa; para ler/gravar a outra empresa usa-se o contexto dela
 * (`companyAdminCtx` → `ctxForCompany`, que valida o acesso e aplica o perfil daquela empresa). null = sem acesso (404).
 */
export async function companyView(s: SessionInfo, companyId: string, op: Crud = "view"): Promise<Ctx | null> {
  if (!companyId) return null;
  try {
    return await companyAdminCtx(s.ctx, companyId, op);
  } catch (e) {
    if (e instanceof PermissionError || e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function branchView(s: SessionInfo, branchId: string, op: Crud = "view"): Promise<{ ctx: Ctx; branch: Doc<any> } | null> {
  try {
    return await branchAdminCtx(s.ctx, branchId, op);
  } catch (e) {
    if (e instanceof PermissionError || e instanceof NotFoundError) return null;
    throw e;
  }
}
