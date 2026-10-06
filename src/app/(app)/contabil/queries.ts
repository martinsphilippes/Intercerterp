import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import type { ListParams } from "@/lib/list";
import { normalizeSearch } from "@/lib/list";
import { onlyDigits } from "@/lib/core/text";
import { REGIMES } from "@/domain/companies";
import { CLIENT_STATUS, SERVICE_LABEL, LINK_STATUS_LABEL, visibleClientIds, listDeliveries, linkedSnapshot, type LinkedSnapshot } from "@/domain/accounting";
import { today } from "@/lib/dates";

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(CLIENT_STATUS.map((s) => [s.value, s.label]));
export const REGIME_LABEL_MAP: Record<string, string> = Object.fromEntries(REGIMES.map((r) => [r.value, r.label]));

/** Referências resolvidas de uma vez (nomes de usuários, grupos e departamentos do escritório). */
export async function portfolioRefs(ctx: Ctx) {
  const [users, groups, departments] = await Promise.all([
    listAll(ctx.store, "users"),
    listAll(ctx.store, "accounting_client_groups", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "departments", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  const firmUsers = users.filter((u) => u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId));
  return {
    userName: new Map(users.map((u) => [u.id, u.name as string])),
    users: firmUsers.filter((u) => u.status === "active").map((u) => ({ value: u.id, label: u.name as string })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    groupName: new Map(groups.map((g) => [g.id, g.name as string])),
    groups: groups.filter((g) => g.active !== false).map((g) => ({ value: g.id, label: g.name as string })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    departmentName: new Map(departments.map((d) => [d.id, d.name as string])),
    departments: departments.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.name as string })),
  };
}

/** Carteira de clientes do escritório (tela e exportação), restrita à carteira visível do usuário. */
export async function queryPortfolio(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  if (p.f.personType) filters.push(["eq", "personType", p.f.personType]);
  if (p.f.regime) filters.push(["eq", "regime", p.f.regime]);
  if (p.f.grupo && p.f.grupo !== "none") filters.push(["eq", "groupId", p.f.grupo]);
  if (p.f.vinculo) filters.push(["eq", "linkStatus", p.f.vinculo]);
  if (p.q) {
    const d = onlyDigits(p.q);
    filters.push(d.length >= 5 ? ["or", [["contains", "searchText", normalizeSearch(p.q)], ["startsWith", "doc", d]]] : ["contains", "searchText", normalizeSearch(p.q)]);
  }
  const [clients, visible, refs, assignments] = await Promise.all([
    listAll(ctx.store, "accounting_clients", { filters, orderBy: [{ field: "name", dir: "asc" }] }),
    visibleClientIds(ctx),
    portfolioRefs(ctx),
    listAll(ctx.store, "accounting_client_assignments", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  let rows = visible ? clients.filter((c) => visible.has(c.id)) : clients;
  if (p.f.servico) rows = rows.filter((c) => (c.services ?? []).includes(p.f.servico));
  if (p.f.departamento) {
    const ids = new Set(assignments.filter((a) => a.active !== false && a.departmentId === p.f.departamento).map((a) => a.clientId));
    rows = rows.filter((c) => ids.has(c.id));
  }
  const byClient = new Map<string, number>();
  for (const a of assignments) if (a.active !== false) byClient.set(a.clientId, (byClient.get(a.clientId) ?? 0) + 1);
  if (p.f.grupo === "none") rows = rows.filter((c) => !c.groupId);
  // "responsável" = responsável geral OU atribuição ativa (titular/substituto); "none" = nenhum dos dois (mesma régua do painel)
  if (p.f.responsavel === "none") rows = rows.filter((c) => !c.responsibleUserId && !byClient.get(c.id));
  else if (p.f.responsavel) {
    const mine = new Set(assignments.filter((a) => a.active !== false && a.userId === p.f.responsavel).map((a) => a.clientId));
    rows = rows.filter((c) => c.responsibleUserId === p.f.responsavel || mine.has(c.id));
  }
  return rows.map((c) => ({
    ...c,
    statusLabel: STATUS_LABEL[c.status] ?? c.status,
    regimeLabel: c.regime ? (REGIME_LABEL_MAP[c.regime] ?? c.regime) : "—",
    servicesLabel: (c.services ?? []).map((s: string) => SERVICE_LABEL[s] ?? s).join(", "),
    responsibleName: c.responsibleUserId ? (refs.userName.get(c.responsibleUserId) ?? "—") : null,
    groupName: c.groupId ? (refs.groupName.get(c.groupId) ?? null) : null,
    linkLabel: LINK_STATUS_LABEL[c.linkStatus ?? "none"] ?? "—",
    linked: c.linkStatus === "active",
    assignmentsCount: byClient.get(c.id) ?? 0,
    city: c.cityName ? `${c.cityName}/${c.uf ?? ""}` : "—",
  }));
}

export type PortfolioRow = Awaited<ReturnType<typeof queryPortfolio>>[number];

/** Resumo da situação fiscal dos clientes vinculados (somente os informados — a tela pede só a página atual). */
export async function linkedSummaries(ctx: Ctx, clientIds: string[]): Promise<Map<string, { lateObligations: number; dueSoon: number; certificateDaysLeft: number | null; lastPackage: string | null; stuckDocs: number; pending: number }>> {
  const out = new Map<string, { lateObligations: number; dueSoon: number; certificateDaysLeft: number | null; lastPackage: string | null; stuckDocs: number; pending: number }>();
  await Promise.all(
    clientIds.map(async (id) => {
      try {
        const s = await linkedSnapshot(ctx, id, 2);
        out.set(id, {
          lateObligations: s.obligations.filter((o) => o.status === "late").length,
          dueSoon: s.obligations.filter((o) => o.status === "due_soon").length,
          certificateDaysLeft: s.certificates.length ? Math.min(...s.certificates.map((c) => c.daysLeft ?? 9999)) : null,
          lastPackage: s.packages[0]?.period ?? null,
          stuckDocs: s.stuckDocs,
          pending: s.months.reduce((a, m) => a + m.pending + m.rejected, 0),
        });
      } catch {
        /* vínculo desfeito entre a listagem e a leitura: linha sem resumo */
      }
    }),
  );
  return out;
}

/** Painel da carteira: contagens, alertas e últimas entregas. */
export async function portfolioOverview(ctx: Ctx) {
  const rows = await queryPortfolio(ctx, { q: "", f: {} });
  const linked = rows.filter((r) => r.linked);
  const [summaries, deliveries] = await Promise.all([linkedSummaries(ctx, linked.map((r) => r.id)), listDeliveries(ctx, {})]);
  const byStatus = Object.fromEntries(CLIENT_STATUS.map((s) => [s.value, rows.filter((r) => r.status === s.value).length])) as Record<string, number>;
  const byRegime = REGIMES.map((r) => ({ regime: r.value, label: r.label, count: rows.filter((c) => c.regime === r.value).length })).filter((r) => r.count);
  const alerts = linked
    .map((c) => ({ client: c, s: summaries.get(c.id) }))
    .filter((x) => x.s && (x.s.lateObligations || x.s.dueSoon || (x.s.certificateDaysLeft != null && x.s.certificateDaysLeft <= 30) || x.s.stuckDocs || x.s.pending))
    .map((x) => ({
      clientId: x.client.id,
      clientName: x.client.name,
      lateObligations: x.s!.lateObligations,
      dueSoon: x.s!.dueSoon,
      certificateDaysLeft: x.s!.certificateDaysLeft,
      stuckDocs: x.s!.stuckDocs,
      pending: x.s!.pending,
    }))
    .sort((a, b) => b.lateObligations - a.lateObligations || b.dueSoon - a.dueSoon);
  const t = today();
  const currentPeriod = t.slice(0, 7);
  const prevPeriod = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const receivedPrev = new Set(deliveries.filter((d) => d.period === prevPeriod).map((d) => d.clientId));
  return {
    total: rows.length,
    byStatus,
    byRegime,
    linkedCount: linked.length,
    pendingLinks: rows.filter((r) => r.linkStatus === "pending").length,
    withoutResponsible: rows.filter((r) => r.status !== "closed" && !r.responsibleUserId && !r.assignmentsCount).map((r) => ({ id: r.id, name: r.name, code: r.code })),
    deliveriesToReview: deliveries.filter((d) => d.status === "received").length,
    recentDeliveries: deliveries.slice(0, 8).map((d) => ({ id: d.id, clientId: d.clientId, clientName: rows.find((r) => r.id === d.clientId)?.name ?? "—", period: d.period, fileName: d.fileName, status: d.status, receivedAt: d.receivedAt, missingXml: d.payload?.missingXml ?? 0 })),
    /** vinculados que ainda não entregaram o pacote do mês anterior */
    missingPrevPackage: linked.filter((r) => !receivedPrev.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
    prevPeriod,
    currentPeriod,
    alerts,
    summaries,
  };
}

export type { LinkedSnapshot };
