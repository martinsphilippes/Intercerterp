import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { listAll } from "@/lib/db";
import { sp, type SearchParams } from "@/lib/list";
import { today } from "@/lib/dates";
import { currentSession } from "@/domain/cash";
import { cartToSaleInput } from "@/domain/carts";
import { prepareSale } from "@/domain/sales";
import { getIntegration } from "@/domain/integrations";
import { pixProviderFrom } from "@/domain/payments/providers";
import { cartIntents } from "@/domain/payments/intents";
import { nameMap } from "@/lib/server/lookups";
import { PaymentApp } from "./payment-app";

export const metadata = { title: "Pagamento da venda" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("pdv", "create");
  const params = await searchParams;
  const cartId = sp(params, "carrinho");
  if (!s.branch || !cartId) redirect("/pdv");
  const store = s.ctx.store;
  const cart = await store.get("carts", cartId);
  if (!cart || cart.companyId !== s.ctx.companyId || cart.branchId !== s.ctx.branchId) redirect("/pdv");
  if (cart.status === "converted" && cart.saleId) redirect(`/vendas/${cart.saleId}/conclusao`);
  const header = <PageHeader title="Pagamento da venda" crumbs={[{ label: "PDV", href: "/pdv" }, { label: "Pagamento" }]} />;
  if (cart.status !== "open") {
    return (
      <>
        {header}
        <Notice tone="warn" title="Atendimento indisponível">Este atendimento está {cart.status === "parked" ? "salvo como pré-venda — retome-o no PDV" : "cancelado"}.</Notice>
        <div className="mt-3"><LinkButton href="/pdv">Voltar ao PDV</LinkButton></div>
      </>
    );
  }
  const terminal = await store.getOrThrow("terminals", cart.terminalId);
  const session = await currentSession(s.ctx, terminal.id);
  // validação e total oficiais do servidor (preços vigentes, limites de desconto, estoque)
  let prep: Awaited<ReturnType<typeof prepareSale>> | null = null;
  let problem: string | null = null;
  try {
    prep = await prepareSale(s.ctx, cartToSaleInput(cart, []));
  } catch (e: any) {
    problem = e?.message ?? String(e);
  }
  if (!prep) {
    return (
      <>
        {header}
        <Notice tone="bad" title="O atendimento precisa de ajustes antes do pagamento">{problem}</Notice>
        <div className="mt-3"><LinkButton href="/pdv" variant="primary">Voltar ao PDV (Esc)</LinkButton></div>
      </>
    );
  }
  const methods = (await listAll(store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }))
    .filter((m) => m.availablePdv !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const terms = (await listAll(store, "payment_terms", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] })).sort((a, b) => (a.installments ?? 1) - (b.installments ?? 1) || (a.firstDueDays ?? 0) - (b.firstDueDays ?? 0));
  const pixInteg = await getIntegration(store, s.ctx.companyId, s.ctx.branchId, "pix");
  const pixProvider = pixProviderFrom(pixInteg);
  const cardInteg = await getIntegration(store, s.ctx.companyId, s.ctx.branchId, "card_tef");
  const intents = await cartIntents(s.ctx, cart.id);
  const customer = prep.customer;
  let creditAvailable = 0;
  if (customer?.creditLimit) {
    const open = await listAll(store, "installments", { filters: [["eq", "partyId", customer.id], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
    creditAvailable = Math.max(0, customer.creditLimit - open.reduce((a, i) => a + i.balance, 0));
  }
  let exchangeVoucher: { code: string; balance: number; returnNumber: number } | null = null;
  if (cart.exchangeReturnId) {
    const ret = await store.get("returns", cart.exchangeReturnId);
    const v = ret?.creditVoucherId ? await store.get("credit_vouchers", ret.creditVoucherId) : null;
    if (ret && v && v.status === "active") exchangeVoucher = { code: v.code, balance: v.balance, returnNumber: ret.number };
  }
  const users = await nameMap(s.ctx, "users");
  return (
    <PaymentApp
      cartId={cart.id}
      total={prep.calc.total}
      summary={{ subtotal: prep.calc.subtotal, discount: prep.calc.discountTotal, surcharge: prep.calc.surchargeTotal, items: prep.lines.map((l, i) => ({ name: l.sku.name ?? l.product.name, sku: l.sku.sku, qty: l.input.qty, unitCode: l.sku.unitCode ?? l.product.unitCode, total: prep!.calc.items[i].total })) }}
      stockWarnings={prep.stockWarnings}
      terminal={{ id: terminal.id, name: terminal.name }}
      session={session ? { id: session.id, number: session.number, operatorName: users.get(session.operatorId) ?? "—" } : null}
      customer={customer ? { id: customer.id, name: customer.name, doc: customer.doc ?? null, email: customer.email ?? null, creditLimit: customer.creditLimit ?? 0, creditAvailable } : null}
      cpfOnInvoice={cart.cpfOnInvoice ?? null}
      methods={methods.map((m) => ({ id: m.id, name: m.name, kind: m.kind, maxInstallments: m.maxInstallments ?? 1, requiresCustomer: Boolean(m.requiresCustomer), allowsChange: Boolean(m.allowsChange) || m.kind === "cash", feeBps: m.feeBps ?? 0, hasAccount: Boolean(m.accountId) }))}
      terms={terms.map((t) => ({ id: t.id, name: t.name, installments: t.installments ?? 1, firstDueDays: t.firstDueDays ?? 30, intervalDays: t.intervalDays ?? 30 }))}
      pix={{ configured: Boolean(pixProvider), provider: pixInteg?.provider ?? null, simulated: Boolean(pixProvider?.simulated), status: pixInteg?.status ?? "not_configured", label: pixProvider?.label ?? null }}
      card={{ provider: cardInteg?.provider ?? null, acquirer: cardInteg?.config?.acquirer ?? null }}
      intents={intents.map((i) => ({ id: i.id, status: i.status, amount: i.amount, reference: i.reference, qrCode: i.qrCode ?? null, qrCodeImage: i.qrCodeImage ?? null, expiresAt: i.expiresAt ?? null, isSimulated: Boolean(i.isSimulated), saleId: i.saleId ?? null }))}
      drafts={(cart.payments ?? []) as any[]}
      exchangeVoucher={exchangeVoucher}
      today={today()}
    />
  );
}
