import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { requireStore, settleCommerceEvent, type CommerceEventStatus } from "./common";

/**
 * Monitor das integrações (Tela 60): falhas, eventos concluídos, ignorados e pendentes de catálogo, pagamento, fiscal,
 * estoque, entrega, banco e domínio. Reprocessar refaz a VERIFICAÇÃO a partir do cadastro de origem corrigido — as
 * operações por trás são idempotentes, então repetir nunca duplica reserva, baixa, cobrança ou etiqueta.
 */

export const EVENT_STATUS_LABEL: Record<CommerceEventStatus, string> = { ok: "Concluído", failed: "Falha", ignored: "Ignorado", pending: "Pendente" };

export async function monitorEvents(ctx: Ctx, opts: { status?: "all" | CommerceEventStatus; area?: string | null; limit?: number } = {}) {
  const st = await requireStore(ctx);
  const rows = await listAll(unscoped(ctx.store), "commerce_events", { filters: [["eq", "companyId", ctx.companyId]] }, 5000);
  return rows
    .filter((r) => (!r.storeId || r.storeId === st.id) && (!opts.status || opts.status === "all" || r.status === opts.status) && (!opts.area || r.area === opts.area))
    .sort((a, b) => (b.number ?? 0) - (a.number ?? 0) || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, opts.limit ?? 300);
}

export async function monitorCounts(ctx: Ctx) {
  const rows = await monitorEvents(ctx, { limit: 5000 });
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  return { all: rows.length, failed: by("failed"), ok: by("ok"), ignored: by("ignored"), pending: by("pending") };
}

/** Onde corrigir a origem do evento (link para o cadastro). */
export function subjectHref(ev: Doc): string | null {
  const [kind, id] = String(ev.subject ?? "").split(":");
  if (!id) return ev.orderId ? `/comercio-digital/pedidos/${ev.orderId}` : null;
  if (kind === "product") return `/comercio-digital/catalogo?editar=${id}`;
  if (kind === "order") return `/comercio-digital/pedidos/${id}`;
  if (kind === "domain") return "/comercio-digital/editor?aba=dominio";
  return null;
}

/** Reprocessa: refaz a verificação da origem e atualiza o evento (tentativas + diagnóstico). */
export async function reprocessEvent(ctx: Ctx, eventId: string): Promise<{ status: CommerceEventStatus; message: string }> {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  const ev = await unscoped(ctx.store).getOrThrow("commerce_events", eventId);
  assert(ev.companyId === ctx.companyId && (!ev.storeId || ev.storeId === st.id), "Evento de outra loja.");
  if (ev.status === "ok") return { status: "ok", message: "Evento já concluído: nada a reprocessar (repetir não duplica a operação)." };
  const [kind, id] = String(ev.subject ?? "").split(":");
  let status: CommerceEventStatus = "failed";
  let message = "";
  // a validação do catálogo atualiza o próprio evento do produto (uma linha por produto): não registrar de novo
  let settled = false;
  try {
    if (ev.area === "catalog" && kind === "product") {
      const { validateListings, hasBlocking } = await import("./catalog");
      const [l] = await validateListings(ctx, [id]);
      if (!l) throw new BusinessError("Produto fora do catálogo da loja.");
      const blocking = (l.issues ?? []).filter((i: { blocking?: boolean }) => i.blocking);
      status = hasBlocking(l.issues) ? "failed" : "ok";
      message = status === "ok" ? "Validação refeita: produto pronto para a vitrine e os conectores." : `Ainda pendente: ${blocking.map((b: { label: string }) => b.label.toLowerCase()).join("; ")}.`;
      settled = ev.externalKey === `catalog:${st.id}:${id}`;
    } else if (ev.area === "domain" && kind === "domain") {
      const { verifyDomain } = await import("./domains");
      const d = await verifyDomain(ctx, id);
      status = d.status === "active" ? "ok" : d.status === "pending_dns" ? "pending" : "failed";
      message = d.diagnostic ?? "";
    } else if (ev.area === "fiscal" && ev.orderId) {
      const order = await unscoped(ctx.store).getOrThrow("online_orders", ev.orderId);
      if (order.fiscalDocumentId) {
        const { queryDocument } = await import("../fiscal/service");
        const cur = await ctx.store.get("fiscal_documents", order.fiscalDocumentId);
        // consulta ao provedor só para documento em andamento (autorizado/cancelado já é situação final)
        if (cur && ["processing", "queued", "error"].includes(cur.status)) await queryDocument({ ...ctx, branchId: order.branchId }, order.fiscalDocumentId).catch(() => undefined);
        const doc = await ctx.store.get("fiscal_documents", order.fiscalDocumentId);
        if (doc) {
          const { syncOrderFromNfe } = await import("./fiscal");
          await syncOrderFromNfe({ ...ctx, branchId: order.branchId }, doc);
        }
      } else if (order.paymentStatus === "paid") {
        const { invoiceOrder } = await import("./fiscal");
        await invoiceOrder({ ...ctx, branchId: order.branchId }, order.id);
      }
      const fresh = await unscoped(ctx.store).getOrThrow("online_orders", ev.orderId);
      status = fresh.fiscalStatus === "authorized" ? "ok" : ["rejected", "denied", "error"].includes(fresh.fiscalStatus) ? "failed" : "pending";
      message = `Situação fiscal do pedido ${fresh.code}: ${fresh.fiscalStatus}.`;
    } else if (ev.area === "payment" && ev.orderId) {
      const order = await unscoped(ctx.store).getOrThrow("online_orders", ev.orderId);
      if (order.status === "pending_payment" && order.payment?.status === "error") {
        const { retryCharge } = await import("./orders");
        const after = await retryCharge(ctx.store, order);
        status = after.payment?.status === "error" ? "failed" : "ok";
        message = status === "ok" ? "Cobrança gerada na nova tentativa." : `Cobrança ainda não gerada: ${after.payment?.message ?? ""}`;
      } else {
        status = order.paymentStatus === "paid" || order.paymentStatus === "refunded" ? "ok" : order.refundStatus === "pending" ? "failed" : "ignored";
        message = order.refundStatus === "pending" ? "Estorno ao cliente ainda pendente: registre o estorno no gateway." : `Pedido ${order.code}: pagamento ${order.paymentStatus}. Nenhuma operação repetida.`;
      }
    } else {
      status = "ignored";
      message = "Evento informativo: marcado como resolvido.";
    }
  } catch (e: any) {
    status = "failed";
    message = String(e?.message ?? e).slice(0, 500);
  }
  if (!settled) await settleCommerceEvent(ctx.store, ev.id, status, message);
  await audit(ctx, { module: "sales", action: "ecommerce.event_reprocess", entityType: "commerce_event", entityId: ev.id, summary: `Evento ${ev.area}/${ev.action} reprocessado: ${status}`, related: [`store:${st.id}`] });
  return { status, message };
}

/** Marca um evento como resolvido manualmente (com justificativa no histórico). */
export async function dismissEvent(ctx: Ctx, eventId: string, note: string) {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  assert(note.trim().length >= 5, "Explique por que o evento pode ser ignorado.");
  const ev = await unscoped(ctx.store).getOrThrow("commerce_events", eventId);
  assert(ev.companyId === ctx.companyId, "Evento de outra empresa.");
  await settleCommerceEvent(ctx.store, ev.id, "ignored", `Ignorado manualmente: ${note.trim().slice(0, 300)}`);
  await audit(ctx, { module: "sales", action: "ecommerce.event_dismiss", entityType: "commerce_event", entityId: ev.id, summary: `Evento ${ev.area}/${ev.action} marcado como ignorado`, reason: note, related: [`store:${st.id}`] });
}
