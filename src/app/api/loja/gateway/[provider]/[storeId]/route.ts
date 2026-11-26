import { NextResponse } from "next/server";
import { getStore, listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { getIntegration } from "@/domain/integrations";
import { commerceEvent } from "@/domain/ecommerce/common";
import { gatewayById } from "@/domain/ecommerce/providers";
import { handlePaymentEvent } from "@/domain/ecommerce/orders";

export const dynamic = "force-dynamic";

/**
 * Avisos do gateway da loja (Tela 56): POST /api/loja/gateway/<provedor>/<loja>. Só aviso com assinatura válida é
 * processado (o segredo vem da variável vinculada na Central de integrações); cada evento é aplicado uma única vez pela
 * chave do provedor — repetições respondem 200 sem novo efeito, para o provedor parar de reenviar.
 *
 * Habilitação (docs/modulos): este aviso NÃO é bloqueado quando o módulo de loja virtual está em desligamento ou
 * desligado — ele só atualiza pedidos JÁ existentes (pagamento, estorno, chargeback), que são obrigações em curso.
 * Pedido novo nunca nasce aqui: a vitrine é que deixa de aceitar pedidos.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string; storeId: string }> }) {
  const { provider, storeId } = await params;
  if (!/^[0-9a-f]{32}$/.test(storeId) || !/^[a-z_]{3,30}$/.test(provider)) return NextResponse.json({ ok: false }, { status: 404 });
  const store = getStore();
  const st = await unscoped(store).get("stores", storeId);
  if (!st) return NextResponse.json({ ok: false }, { status: 404 });
  const integ = await getIntegration(store, st.companyId, null, "store_gateway");
  const gw = gatewayById(provider, integ);
  if (!gw || gw.simulated) return NextResponse.json({ ok: false, error: "Provedor não configurado para esta loja." }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 64 * 1024 || !gw.verifyWebhook(req.headers, raw)) {
    await commerceEvent(store, { companyId: st.companyId, storeId: st.id, area: "payment", action: "payment.webhook_rejected", status: "failed", diagnostic: "Aviso recusado: assinatura ausente, inválida ou expirada." }).catch(() => undefined);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }
  const events = gw.parseWebhook(body);
  const results: Array<{ key: string; outcome: string }> = [];
  for (const ev of events) {
    const orders = await listAll(unscoped(store), "online_orders", { filters: [["eq", "storeId", st.id]] }, 5000);
    const order = orders.find((o) => o.payment?.providerRef === ev.providerRef);
    if (!order) {
      const r = await commerceEvent(store, { companyId: st.companyId, storeId: st.id, area: "payment", action: `payment.${ev.type}`, status: "ignored", reference: ev.providerRef, externalKey: ev.externalKey, diagnostic: "Cobrança não encontrada nos pedidos da loja." });
      results.push({ key: ev.externalKey, outcome: r.duplicate ? "duplicate" : "ignored" });
      continue;
    }
    const r = await handlePaymentEvent(store, order, ev, "gateway");
    results.push({ key: ev.externalKey, outcome: r.outcome });
  }
  return NextResponse.json({ ok: true, results });
}
