import { detId, isConflict, sha256 } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import type { Ctx } from "@/lib/core/ctx";
import { BusinessError } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import { moduleDef } from "@/lib/modules/catalog";
import { loadCompanyModules } from "@/lib/modules/access";
import { unitByV1Key } from "./effective";
import { emitInterosEvent } from "./events";
import { contractableFor, displayResolver } from "./license";

/** Estados em que a unidade já está à disposição da empresa (não há o que contratar). */
const ON_STATES = new Set(["enabled", "scheduled_off", "draining"]);

/**
 * Solicitação de contratação (interface "oportunidade"): visualizar a oferta nunca dá acesso a dados ou operações —
 * só registra o pedido e encaminha ao Interos (evento upsell.requested). Uma solicitação por usuário, módulo e dia.
 * Ao Interos vai um identificador pseudônimo de quem pediu e o perfil dele, nunca o nome (`requesterRef`).
 */

/** Identificador pseudônimo e estável de quem pediu: o mesmo usuário na mesma empresa tem sempre o mesmo, sem revelar quem é. */
export function requesterRef(companyId: string, userId: string | null | undefined): string | null {
  return userId ? `usr_${sha256(`upsell|${companyId}|${userId}`).slice(0, 20)}` : null;
}
export async function requestUpsell(ctx: Ctx, moduleKey: string, note: string) {
  const def = moduleDef(moduleKey);
  const base = unscoped(ctx.store);
  const company = await base.get("companies", ctx.companyId);
  const unit = unitByV1Key(moduleKey);
  // só o que a empresa pode contratar: do tipo dela e vendável (dependente de homologação ainda não é oferecido)
  if (!def || !contractableFor(company?.kind ?? "retail")(moduleKey) || unit?.sellable === false) throw new BusinessError("Função indisponível para contratação.", "invalid_request");
  // exibição por unidade (fase A): só a unidade mostrada com "contratar" aceita o pedido
  if ((await displayResolver(base, ctx.companyId))(moduleKey) !== "upsell") throw new BusinessError("A solicitação de contratação não está disponível para esta função nesta empresa.", "forbidden");
  // unidade já ligada (ou em conclusão) não tem o que contratar
  const state = (await loadCompanyModules(base, ctx.companyId))?.modules?.[moduleKey]?.state;
  if (state && ON_STATES.has(state)) throw new BusinessError("Esta função já está disponível para a empresa.", "invalid_request");
  const day = new Date().toISOString().slice(0, 10);
  const id = detId("upsell", ctx.companyId, ctx.user.id, moduleKey, day);
  try {
    // LGPD (correção 4): sem o nome da pessoa — quem pediu fica pelo identificador interno e pelo perfil na empresa
    await ctx.store.create("upsell_requests", { companyId: ctx.companyId, branchId: ctx.branchId, userId: ctx.user.id, userName: null, requesterRole: ctx.user.roleName?.slice(0, 80) ?? (ctx.user.isAdmin ? "Administrador da plataforma" : null), code: unit?.code ?? null, module: moduleKey, note: note.slice(0, 500) || null, status: "requested", sentAt: null }, id);
  } catch (e) {
    if (isConflict(e)) return { duplicate: true };
    throw e;
  }
  await emitInterosEvent(unscoped(ctx.store), ctx.companyId, "upsell.requested", { requestId: id, code: unit?.code ?? null, module: moduleKey, name: def.name }, `upsell:${id}`);
  await audit(ctx, { module: "admin", action: "license.upsell_requested", entityType: "upsell_request", entityId: id, summary: `Solicitação de contratação: ${def.name}` });
  return { duplicate: false, id };
}
