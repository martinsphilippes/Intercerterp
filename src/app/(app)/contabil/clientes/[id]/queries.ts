import "server-only";
import type { Ctx } from "@/lib/core/ctx";
import type { Doc } from "@/lib/db/types";
import { REGIMES, CRT_OPTIONS } from "@/domain/companies";
import {
  getClient, listPeople, listEstablishments, clientRegimeHistory, listAssignments, listDepartments, listDeliveries, linkedSnapshot, linkedCompanyReader,
  SERVICE_LABEL, PEOPLE_KIND_LABEL, type LinkedSnapshot,
} from "@/domain/accounting";
import { portfolioRefs, REGIME_LABEL_MAP } from "../../queries";

export const CRT_LABEL_MAP: Record<string, string> = Object.fromEntries(CRT_OPTIONS.map((c) => [c.value, c.label]));

export type ClientTab = "resumo" | "pessoas" | "estabelecimentos" | "regime" | "responsaveis" | "fiscal" | "entregas" | "historico";
export const CLIENT_TABS: ClientTab[] = ["resumo", "pessoas", "estabelecimentos", "regime", "responsaveis", "fiscal", "entregas", "historico"];

export type PersonRow = Doc & { kindLabel: string; sharePct: number | null };
export type RegimeRow = Doc & { regimeLabel: string; crtLabel: string | null };
export type AssignmentRow = Doc & { departmentLabel: string; userName: string; isActive: boolean };

export interface LinkedCompanyRef {
  id: string;
  name: string;
  tradeName: string | null;
  cnpj: string | null;
}

/** Nome/CNPJ da empresa vinculada, lidos pela única porta de leitura permitida (store somente leitura da empresa). */
async function linkedCompanyRef(ctx: Ctx, client: Doc): Promise<LinkedCompanyRef | null> {
  if (client.linkStatus !== "active" || !client.linkedCompanyId) return null;
  try {
    const r = await linkedCompanyReader(ctx, client);
    const co = await r.get("companies", client.linkedCompanyId);
    return co ? { id: co.id, name: co.name, tradeName: co.tradeName ?? null, cnpj: co.cnpj ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Página 360° do cliente contábil: reúne, por aba, o que a tela precisa. `getClient` garante carteira visível
 * (lança NotFoundError quando não existe e BusinessError "forbidden" quando está fora da carteira do usuário).
 * A leitura da empresa vinculada (aba fiscal) é a mais pesada e só acontece nessa aba.
 */
export async function clientDetail(ctx: Ctx, id: string, tab: ClientTab) {
  const client = await getClient(ctx, id);
  const [people, establishments, regimes, assignments, departments, deliveries, refs, linkedCompany] = await Promise.all([
    listPeople(ctx, id),
    client.personType === "PJ" ? listEstablishments(ctx, id) : Promise.resolve([] as Doc[]),
    clientRegimeHistory(ctx, id),
    listAssignments(ctx, id),
    listDepartments(ctx),
    listDeliveries(ctx, { clientId: id }),
    portfolioRefs(ctx),
    linkedCompanyRef(ctx, client),
  ]);

  let snapshot: LinkedSnapshot | null = null;
  let snapshotError: string | null = null;
  if (tab === "fiscal" && client.linkStatus === "active") {
    try {
      snapshot = await linkedSnapshot(ctx, id, 6);
    } catch (e: any) {
      snapshotError = e?.message ?? "Não foi possível ler a situação fiscal da empresa vinculada.";
    }
  }

  const departmentName = new Map(departments.map((d) => [d.id, d.name as string]));
  const activePartners = people.filter((p) => p.kind === "partner" && p.active !== false);
  const partnerShareBps = activePartners.reduce((a, p) => a + (p.shareBps ?? 0), 0);
  const deliveredFileIds = new Set(deliveries.map((d) => d.fileId as string));

  return {
    client,
    code: client.code as string,
    name: client.name as string,
    regimeLabel: client.regime ? (REGIME_LABEL_MAP[client.regime] ?? client.regime) : null,
    crtLabel: client.crt ? (CRT_LABEL_MAP[client.crt] ?? client.crt) : null,
    servicesLabels: ((client.services ?? []) as string[]).map((s) => SERVICE_LABEL[s] ?? s),
    groupName: client.groupId ? (refs.groupName.get(client.groupId) ?? null) : null,
    responsibleName: client.responsibleUserId ? (refs.userName.get(client.responsibleUserId) ?? null) : null,
    linkedCompany,
    people: people.map((p): PersonRow => ({ ...p, kindLabel: PEOPLE_KIND_LABEL[p.kind] ?? p.kind, sharePct: p.shareBps == null ? null : p.shareBps / 100 })),
    partnerShareBps,
    activePartnersCount: activePartners.length,
    establishments,
    regimes: regimes.map((r): RegimeRow => ({ ...r, regimeLabel: REGIME_LABEL_MAP[r.regime] ?? r.regime, crtLabel: r.crt ? (CRT_LABEL_MAP[r.crt] ?? r.crt) : null })),
    assignments: assignments.map((a): AssignmentRow => ({
      ...a,
      departmentLabel: a.departmentId ? (departmentName.get(a.departmentId) ?? "Departamento removido") : "Geral",
      userName: refs.userName.get(a.userId) ?? "Usuário removido",
      isActive: a.active !== false,
    })),
    deliveries,
    deliveredFileIds,
    snapshot,
    snapshotError,
    refs,
    regimeOptions: REGIMES.map((r) => ({ value: r.value, label: r.label, crt: r.crt })),
    crtOptions: CRT_OPTIONS,
  };
}

export type ClientDetail = Awaited<ReturnType<typeof clientDetail>>;
