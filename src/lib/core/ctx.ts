import type { Store } from "../db/types";
import { scopeStore } from "../db/scoped-store";
import { can, canDo, type Crud, type ModuleKey, type PermissionMatrix, type SpecialAction } from "../permissions";
import { PermissionError, BusinessError } from "./errors";

export interface CtxUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  roleId?: string | null;
  roleKey?: string | null;
  roleName?: string | null;
  permissions: PermissionMatrix;
  actions: string[];
  discountLimitBps: number;
  branchIds: string[];
  companyIds: string[];
}

/** Contexto de execução de qualquer serviço de domínio. */
export interface Ctx {
  store: Store;
  user: CtxUser;
  companyId: string;
  /** null = visão consolidada (somente leitura/relatórios) */
  branchId: string | null;
  ip?: string;
}

export function requirePerm(ctx: Ctx, module: ModuleKey, op: Crud = "view") {
  if (!can(ctx.user, module, op)) throw new PermissionError();
}

export function requireAction(ctx: Ctx, action: SpecialAction) {
  if (!canDo(ctx.user, action)) throw new PermissionError();
}

/** Operações transacionais exigem filial definida (não consolidado). */
export function requireBranch(ctx: Ctx): string {
  if (!ctx.branchId) throw new BusinessError("Selecione uma filial específica para esta operação (o contexto consolidado é apenas para consulta).", "branch_required");
  return ctx.branchId;
}

/**
 * Contexto de outra empresa à qual o usuário tem acesso (administração multiempresa).
 * Valida o acesso e devolve um contexto com o Store restrito a essa empresa.
 */
export async function ctxForCompany(ctx: Ctx, companyId: string): Promise<Ctx> {
  if (companyId === ctx.companyId) return ctx;
  if (!ctx.user.isAdmin && !ctx.user.companyIds.includes(companyId)) throw new PermissionError("Você não tem acesso a esta empresa.");
  return { ...ctx, companyId, branchId: null, store: scopeStore(ctx.store, companyId) };
}

/** Contexto técnico para tarefas em segundo plano (Store restrito à empresa da tarefa). */
export function systemCtx(store: Store, companyId: string, branchId: string | null = null): Ctx {
  return {
    store: companyId ? scopeStore(store, companyId) : store,
    companyId,
    branchId,
    user: { id: "system", name: "Sistema", email: "", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [companyId] },
  };
}
