import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { dayRange, today } from "@/lib/dates";
import { supplierLabel } from "@/domain/suppliers";

/** Fila de solicitações de compra (tela e exportação). */
export async function queryRequests(ctx: Ctx, p: Pick<ListParams, "q" | "f">) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  const branch = p.f.branch || ctx.branchId;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (p.f.status) filters.push(["eq", "status", p.f.status]);
  const reqs = await listAll(ctx.store, "purchase_requests", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const orderIds = [...new Set(reqs.flatMap((r) => r.orderIds ?? []))];
  const orders = new Map<string, any>();
  for (let i = 0; i < orderIds.length; i += 100) for (const o of await listAll(ctx.store, "purchase_orders", { filters: [["eq", "id", orderIds.slice(i, i + 100)]] })) orders.set(o.id, o);
  const quotations = new Map((await listAll(ctx.store, "quotations", { filters: [["eq", "companyId", ctx.companyId]] })).map((q) => [q.id, q]));
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name as string]));
  const branches = new Map((await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).map((b) => [b.id, b.name as string]));
  const t = today();
  let rows = reqs.map((r) => {
    const os = (r.orderIds ?? []).map((id: string) => orders.get(id)).filter(Boolean);
    const q = r.quotationId ? quotations.get(r.quotationId) : null;
    const step = r.steps?.[r.currentStep ?? 0];
    const expired = (r.warnings ?? []).some((w: any) => w.kind === "expired_proposal") || Boolean(r.validUntil && r.validUntil < t);
    const deliveryReview = os.some((o: any) => ["in_review", "adjust"].includes(o.status) && (!o.expectedDate || o.expectedDate < t));
    const mine = r.status === "in_review" && (step?.responsibleIds ?? []).includes(ctx.user.id);
    const own = r.requesterId === ctx.user.id;
    const description = q?.title ?? (os.map((o: any) => o.purpose).find(Boolean) as string | undefined) ?? os.map((o: any) => supplierLabel(o.supplierSnapshot)).join(", ");
    return {
      ...r,
      description,
      quotationNumber: q?.number ?? null,
      ordersCount: os.length,
      orderNumbers: os.map((o: any) => o.number),
      suppliers: [...new Set(os.map((o: any) => supplierLabel(o.supplierSnapshot)))].join(", "),
      branchName: branches.get(r.branchId) ?? "—",
      requesterName: users.get(r.requesterId) ?? "—",
      stepLabel: r.status === "in_review" ? `Aguardando ${step?.name ?? "—"} (${(r.currentStep ?? 0) + 1}/${(r.steps ?? []).length})` : null,
      expired,
      deliveryReview,
      own,
      mine,
    };
  });
  if (p.f.mine === "1") rows = rows.filter((r) => r.mine);
  if (p.f.from || p.f.to) {
    const rg = dayRange(p.f.from || "2000-01-01", p.f.to || "2100-12-31");
    rows = rows.filter((r) => r.createdAt >= rg.start && r.createdAt < rg.end);
  }
  if (p.q) {
    const term = normalizeSearch(p.q);
    rows = rows.filter((r) => String(r.number) === p.q.trim() || normalizeSearch(`${r.description} ${r.suppliers} ${r.requesterName} ${r.orderNumbers.join(" ")}`).includes(term));
  }
  return rows;
}
