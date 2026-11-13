import "server-only";
import { getStore, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { dbOutageOf, type DbOutage } from "@/lib/db/outage";
import { isEmptyInstallation } from "@/lib/server/bootstrap";
import type { QuickUser } from "./quick-access";
import { DEMO_DIRECTORY, DEMO_SECTORS, demoLoginEnabled } from "@/lib/auth/quick-access";

export { DEMO_SECTORS, demoLoginEnabled } from "@/lib/auth/quick-access";

/** Lista de reserva (sem consultar o banco): os logins da demonstração, na ordem de apresentação. */
export function defaultDemoAccess(): QuickUser[] {
  return DEMO_DIRECTORY.map(([login, sector]) => ({ login, name: "", sector, scope: "" }));
}

/** Somente usuários da empresa de demonstração, ativos e com acesso criado (e não bloqueado) — nunca contas reais. */
export async function demoAccess(store: Store): Promise<QuickUser[]> {
  const users = (await listAll(store, "users", { filters: [["eq", "isDemo", true]] })).filter((u) => u.status === "active" && u.authId && !u.loginDisabled && !u.isAdmin);
  const branches = await listAll(store, "branches");
  const branchName = new Map(branches.map((b) => [b.id, b.name as string]));
  return users
    .map((u) => ({
      login: u.login as string,
      name: u.name as string,
      sector: DEMO_SECTORS[u.login]?.sector ?? (u.name as string),
      scope: (u.branchIds ?? []).length ? (u.branchIds as string[]).map((id) => branchName.get(id) ?? "filial").join(", ") : "todas as filiais",
      order: DEMO_SECTORS[u.login]?.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...u }) => u);
}

export interface LoginScreenState {
  /** Nenhum usuário com credencial: a instalação ainda não foi configurada (vai para o primeiro acesso). */
  empty: boolean;
  /** Banco indisponível: ninguém consegue entrar; a tela mostra o motivo e quem resolve. */
  outage: DbOutage | null;
  /** Acessos da demonstração (vazio fora do ambiente de teste). */
  quick: QuickUser[];
  /** `false` = lista de reserva, porque o banco não respondeu para confirmar os usuários. */
  quickLive: boolean;
}

/**
 * Estado da tela de login. A tela nunca falha em silêncio: se o banco não responde, o motivo aparece e os acessos da
 * demonstração continuam listados (lista de reserva) — antes, a lista sumia e o login devolvia um erro genérico.
 */
export async function loginScreenState(): Promise<LoginScreenState> {
  let outage: DbOutage | null = null;
  let empty = false;
  try {
    empty = await isEmptyInstallation();
  } catch (e) {
    // sem ler os usuários não há login possível: erro não reconhecido também é tratado como banco fora do ar
    outage = dbOutageOf(e) ?? { kind: "unreachable", detail: e instanceof Error ? e.message : String(e) };
    console.error(`[login] banco indisponível (${outage.kind})`, e);
  }
  if (empty) return { empty: true, outage: null, quick: [], quickLive: true };
  if (!demoLoginEnabled()) return { empty, outage, quick: [], quickLive: true };
  if (!outage) {
    try {
      return { empty, outage, quick: await demoAccess(getStore()), quickLive: true };
    } catch (e) {
      // falha só na lista: os acessos caem para a reserva; o aviso de bloqueio aparece apenas se for o banco
      outage = dbOutageOf(e);
      console.error("[login] acesso rápido: não foi possível listar os usuários da demonstração", e);
    }
  }
  return { empty, outage, quick: defaultDemoAccess(), quickLive: false };
}
