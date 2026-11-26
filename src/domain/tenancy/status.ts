import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { nowIso } from "@/lib/dates";

/**
 * Situação da empresa contratante (contrato §6):
 *  - `ativa`: opera normalmente;
 *  - `inativa`: inativada pelo próprio cliente em Administração → Empresas (não seleciona nem opera);
 *  - `suspensa` (pelo Interos, conforme a regra de contrato), em dois modos:
 *      · `bloqueio`: ninguém entra; sessões encerradas; rotinas e tarefas retidas; loja virtual fora do ar;
 *      · `somente_leitura`: entra, consulta e exporta, mas não grava; rotinas e tarefas retidas; loja fora do ar.
 * O histórico nunca é apagado; a reativação devolve a situação anterior e libera as tarefas retidas.
 */

export type CompanyState = "ativa" | "inativa" | "suspensa";

export function companyBlockState(c: Record<string, any> | null | undefined): { state: CompanyState; mode: "bloqueio" | "somente_leitura" | null; operable: boolean; readable: boolean } {
  if (!c) return { state: "inativa", mode: null, operable: false, readable: false };
  if (c.status === "suspended") {
    const mode = c.suspension?.mode === "somente_leitura" ? "somente_leitura" : "bloqueio";
    return { state: "suspensa", mode, operable: false, readable: mode === "somente_leitura" };
  }
  if (c.status === "inactive") return { state: "inativa", mode: null, operable: false, readable: false };
  return { state: "ativa", mode: null, operable: true, readable: true };
}

/** A empresa pode ser escolhida como contexto de trabalho (ativa, ou suspensa em somente leitura). */
export function companySelectable(c: Record<string, any> | null | undefined): boolean {
  return companyBlockState(c).readable;
}

/** Empresa suspensa em somente leitura: o contexto de trabalho recebe um Store que recusa gravações. */
export function companyReadOnly(c: Record<string, any> | null | undefined): boolean {
  const s = companyBlockState(c);
  return s.state === "suspensa" && s.mode === "somente_leitura";
}

/** Motivo apresentável para a empresa não operar (null = opera). */
export function companyBlockMessage(c: Record<string, any> | null | undefined): string | null {
  const s = companyBlockState(c);
  if (s.operable) return null;
  const name = c?.tradeName || c?.name || "Empresa";
  if (s.state === "suspensa")
    return s.mode === "somente_leitura"
      ? `${name}: acesso em somente leitura (contrato suspenso). Consultas e exportações continuam disponíveis; alterações estão bloqueadas.`
      : `${name}: acesso suspenso pelo contrato. Os dados estão preservados; procure o responsável pelo contrato para reativar.`;
  return `Empresa ${name} inativa: não pode ser selecionada nem operar. Um administrador pode reativá-la em Administração → Empresas.`;
}

/**
 * Encerra as sessões de quem só tem acesso a esta empresa (para quem tem outras empresas, a sessão continua, mas esta
 * empresa deixa de poder ser escolhida). Devolve quantas sessões foram encerradas.
 */
export async function revokeSessionsOfCompany(store: Store, companyId: string): Promise<number> {
  const base = unscoped(store);
  const users = await listAll(base, "users", { filters: [["contains", "companyIds", companyId]] });
  const companies = new Map((await listAll(base, "companies")).map((c) => [c.id, c]));
  let ended = 0;
  for (const u of users) {
    if (u.isAdmin) continue;
    const others = (u.companyIds ?? []).filter((c: string) => c !== companyId && companySelectable(companies.get(c)));
    if (others.length) continue;
    const sessions = await listAll(base, "sessions", { filters: [["eq", "userId", u.id]] });
    for (const s of sessions) await base.delete("sessions", s.id);
    ended += sessions.length;
  }
  return ended;
}

/** Retém as tarefas pendentes da empresa (não rodam enquanto suspensa). */
export async function holdCompanyJobs(store: Store, companyId: string, reason: string): Promise<number> {
  const base = unscoped(store);
  const jobs = await listAll(base, "jobs", { filters: [["eq", "companyId", companyId], ["eq", "status", ["pending", "retry"]]] });
  for (const j of jobs) await base.update("jobs", j.id, { status: "held", lastError: `${reason} — retida em ${nowIso()}`, result: { ...(j.result ?? {}), heldFrom: j.status } });
  return jobs.length;
}

/** Devolve à fila as tarefas retidas na suspensão. */
export async function releaseCompanyJobs(store: Store, companyId: string): Promise<number> {
  const base = unscoped(store);
  const jobs = await listAll(base, "jobs", { filters: [["eq", "companyId", companyId], ["eq", "status", "held"]] });
  for (const j of jobs) await base.update("jobs", j.id, { status: (j.result as any)?.heldFrom === "retry" ? "retry" : "pending", lastError: null });
  return jobs.length;
}

/** Empresas em que rotinas e tarefas podem rodar agora (suspensas ficam de fora). */
export function companyRunsRoutines(c: Doc | Record<string, any> | null | undefined): boolean {
  return Boolean(c) && c!.status !== "suspended";
}
