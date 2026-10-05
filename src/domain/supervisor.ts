import { findOne } from "@/lib/db";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx, CtxUser } from "@/lib/core/ctx";
import { canDo, type SpecialAction } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";

/**
 * Autorização de supervisor no próprio terminal (ex.: desconto acima do limite do operador, sangria acima do valor da política):
 * o supervisor informa login e senha; a credencial é validada no provedor de autenticação (sessão criada e encerrada na hora)
 * e o perfil precisa conceder a ação especial exigida. O aprovador fica registrado na operação e na auditoria.
 */
export interface SupervisorCredentials {
  login: string;
  password: string;
}

export async function verifySupervisor(ctx: Ctx, cred: SupervisorCredentials, action: SpecialAction, purpose: string): Promise<CtxUser> {
  assert(cred.login?.trim() && cred.password, "Informe login e senha do autorizador.", "approval_required");
  const login = cred.login.trim().toLowerCase();
  const u = (await findOne(ctx.store, "users", [["eq", "login", login]])) ?? (await findOne(ctx.store, "users", [["eq", "email", login]]));
  const fail = async (reason: string) => {
    await audit(ctx, { module: "admin", action: "supervisor.denied", entityType: "user", entityId: u?.id ?? null, summary: `Autorização recusada (${purpose}): ${reason}`, result: "failure" });
    return new BusinessError(`Autorização recusada: ${reason}`, "approval_denied");
  };
  if (!u || u.status !== "active") throw await fail("usuário inexistente ou inativo");
  if (!u.isAdmin && !(u.companyIds ?? []).includes(ctx.companyId)) throw await fail("usuário sem acesso a esta empresa");
  const { getAuth } = await import("@/lib/auth/provider");
  const auth = getAuth();
  let secret: string | null = null;
  try {
    secret = (await auth.login(u.email, cred.password, false)).secret;
  } catch {
    throw await fail("login ou senha inválidos");
  } finally {
    if (secret) await auth.logout(secret).catch(() => undefined);
  }
  const { toCtxUser } = await import("@/lib/auth/users");
  const approver = await toCtxUser(ctx.store, u);
  if (!canDo(approver, action)) throw await fail(`${approver.name} não tem a permissão exigida`);
  return approver;
}
