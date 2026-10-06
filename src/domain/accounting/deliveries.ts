import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError } from "@/lib/core/errors";
import { NotFoundError } from "@/lib/db/types";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { notify } from "@/lib/core/notify";
import { formatDate, nowIso } from "@/lib/dates";
import { visibleClientIds } from "./team";

/**
 * Caixa de entrada do escritório: entregas recebidas das empresas vinculadas (hoje: o pacote mensal de XMLs e
 * relatórios). A entrega é criada pela EMPRESA (ao gerar o pacote) na empresa do ESCRITÓRIO — gravação deliberada
 * entre empresas, só quando o vínculo está ativo e idempotente por (cliente, arquivo).
 */

export interface PackageDelivery {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  period: { from: string; to: string };
  xmlCount: number;
  simulatedXml: number;
  missingXml: number;
  docs: number;
  branchId?: string | null;
}

/** Chamado pela empresa ao gerar o pacote contábil. Devolve a entrega criada (ou existente) ou null quando não há vínculo. */
export async function deliverPackageToFirm(ctx: Ctx, pkg: PackageDelivery): Promise<Doc | null> {
  const base = unscoped(ctx.store);
  const { getIntegration } = await import("../integrations");
  const integ = await getIntegration(ctx.store, ctx.companyId, null, "accounting");
  const firmId = integ?.config?.linkedFirmCompanyId as string | undefined;
  const clientId = integ?.config?.linkedClientId as string | undefined;
  if (!firmId || !clientId) return null;
  const client = await base.get("accounting_clients", clientId);
  // o vínculo precisa estar ativo e apontar para ESTA empresa (nunca entrega para um escritório que o cliente desfez)
  if (!client || client.companyId !== firmId || client.linkStatus !== "active" || client.linkedCompanyId !== ctx.companyId) return null;
  const id = detId("delivery", clientId, pkg.fileId);
  const existing = await base.get("accounting_deliveries", id);
  if (existing) return existing;
  const period = pkg.period.from.slice(0, 7);
  const payload = { xmlCount: pkg.xmlCount, simulatedXml: pkg.simulatedXml, missingXml: pkg.missingXml, docs: pkg.docs, branchId: pkg.branchId ?? null, from: pkg.period.from, to: pkg.period.to };
  let row: Doc;
  try {
    row = await base.create("accounting_deliveries", {
      companyId: firmId, branchId: null, createdBy: ctx.user.id, clientId, sourceCompanyId: ctx.companyId, kind: "accounting_package", period, periodFrom: pkg.period.from, periodTo: pkg.period.to,
      fileId: pkg.fileId, fileName: pkg.fileName, sizeBytes: pkg.sizeBytes, payload, status: "received", receivedAt: nowIso(),
    }, id);
  } catch (e) {
    if (isConflict(e)) return (await base.get("accounting_deliveries", id))!;
    throw e;
  }
  await notify(base, {
    companyId: firmId,
    type: "info",
    priority: pkg.missingXml ? "high" : "normal",
    title: `Pacote fiscal recebido — ${client.name} (${formatDate(pkg.period.from)} a ${formatDate(pkg.period.to)})`,
    body: `${pkg.xmlCount} XML, ${pkg.docs} documento(s)${pkg.missingXml ? `, ${pkg.missingXml} XML ausente(s)` : ""}${pkg.simulatedXml ? ` — ${pkg.simulatedXml} de simulação` : ""}.`,
    link: `/contabil/entregas?cliente=${clientId}`,
    originType: "accounting_delivery",
    originId: row.id,
    occurrenceKey: `delivery:${row.id}`,
    audience: { module: "accounting" },
  }).catch(() => 0);
  await base.create("audit_logs", { companyId: firmId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: "Empresa vinculada", module: "accounting", action: "delivery.received", entityType: "accounting_delivery", entityId: row.id, summary: `Pacote ${pkg.fileName} recebido de ${client.name} (${period})`, before: null, after: payload, reason: null, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [`accounting_client:${clientId}`, `file:${pkg.fileId}`] }).catch(() => undefined);
  return row;
}

export interface DeliveryFilter {
  clientId?: string | null;
  status?: string | null;
  period?: string | null;
}

export async function listDeliveries(ctx: Ctx, f: DeliveryFilter = {}): Promise<Doc[]> {
  requirePerm(ctx, "accounting", "view");
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (f.clientId) filters.push(["eq", "clientId", f.clientId]);
  if (f.status) filters.push(["eq", "status", f.status]);
  if (f.period) filters.push(["eq", "period", f.period]);
  const rows = await listAll(ctx.store, "accounting_deliveries", { filters, orderBy: [{ field: "receivedAt", dir: "desc" }] }, 2000);
  const visible = await visibleClientIds(ctx);
  return visible ? rows.filter((r) => visible.has(r.clientId)) : rows;
}

export async function reviewDelivery(ctx: Ctx, id: string, input: { notes?: string | null; undo?: boolean }): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const d = await ctx.store.get("accounting_deliveries", id);
  if (!d) throw new NotFoundError("accounting_deliveries", id);
  const visible = await visibleClientIds(ctx);
  if (visible && !visible.has(d.clientId)) throw new BusinessError("Esta entrega é de um cliente fora da sua carteira.", "forbidden");
  const after = input.undo
    ? await ctx.store.update("accounting_deliveries", id, { status: "received", reviewedAt: null, reviewedBy: null, notes: input.notes?.trim() || d.notes || null })
    : await ctx.store.update("accounting_deliveries", id, { status: "reviewed", reviewedAt: nowIso(), reviewedBy: ctx.user.id, notes: input.notes?.trim() || null });
  const { resolveOccurrence } = await import("@/lib/core/notify");
  if (!input.undo) await resolveOccurrence(ctx.store, `delivery:${id}`).catch(() => undefined);
  await audit(ctx, { module: "accounting", action: input.undo ? "delivery.reopen" : "delivery.review", entityType: "accounting_delivery", entityId: id, summary: `Entrega ${d.fileName} ${input.undo ? "reaberta" : "conferida"}`, related: [`accounting_client:${d.clientId}`] });
  return after;
}

/** Entrega que autoriza o escritório a baixar o arquivo de outra empresa (rota de arquivos). */
export async function deliveryForFile(store: Store, firmCompanyId: string, fileId: string): Promise<Doc | null> {
  const rows = await listAll(unscoped(store), "accounting_deliveries", { filters: [["eq", "companyId", firmCompanyId], ["eq", "fileId", fileId]] }, 1);
  return rows[0] ?? null;
}
