import { sha256 } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { BusinessError } from "@/lib/core/errors";
import { nowIso } from "@/lib/dates";
import { LINK_CODE_HOURS, newLinkCode, normalizeLinkCode } from "./provisioning";

/**
 * Código de vínculo com o Interos (contrato §4.3). Para trazer ao Interos uma empresa que JÁ usa o ERP, o
 * administrador dela gera aqui um código de uso único (vale 72 h) e o informa ao Interos; a vinculação confere
 * ID ERP + CNPJ + código. Assim o Interos só vincula uma conta com o consentimento de quem administra a empresa.
 * Só o hash do código fica gravado; gerar outro invalida o anterior.
 */
export async function createInterosLinkCode(ctx: Ctx): Promise<{ code: string; expiresAt: string; companyId: string }> {
  requirePerm(ctx, "admin", "edit");
  requireAction(ctx, "admin.users");
  const base = unscoped(ctx.store);
  const company = await base.get("companies", ctx.companyId);
  if (!company) throw new BusinessError("Empresa não encontrada.", "not_found");
  if (company.isDemo) throw new BusinessError("Empresas de demonstração não são vinculadas ao Interos.", "forbidden");
  if (company.interosAccountId) throw new BusinessError("Esta empresa já está vinculada ao Interos.", "conflict");
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_HOURS * 3600000).toISOString();
  await base.update("companies", company.id, { linkCodeHash: sha256(normalizeLinkCode(code)), linkCodeExpiresAt: expiresAt, linkCodeCreatedBy: ctx.user.id, linkCodeUsedAt: null });
  await audit(ctx, { module: "admin", action: "company.interos_link_code", entityType: "company", entityId: company.id, summary: `Código de vínculo com o Interos gerado (vale até ${expiresAt}; códigos anteriores invalidados)` });
  return { code, expiresAt, companyId: company.id };
}

/** Situação do vínculo para a tela de administração (sem o código, que só aparece na hora de gerar). */
export async function interosLinkState(ctx: Ctx) {
  const c = await unscoped(ctx.store).get("companies", ctx.companyId);
  return {
    linked: Boolean(c?.interosAccountId),
    linkedAt: c?.interosLinkedAt ?? null,
    pendingCodeExpiresAt: c?.linkCodeHash && c?.linkCodeExpiresAt && c.linkCodeExpiresAt > nowIso() ? c.linkCodeExpiresAt : null,
    erpId: c?.id ?? ctx.companyId,
    cnpj: c?.cnpj ?? null,
  };
}
