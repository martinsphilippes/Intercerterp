import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { listAll } from "@/lib/db";
import { sp, type SearchParams } from "@/lib/list";
import { can, canDo } from "@/lib/permissions";
import { getSetting } from "@/lib/core/settings";
import { lookups, nameMap } from "@/lib/server/lookups";
import { ensureOpenCart, listParkedCarts, saveCart } from "@/domain/carts";
import { resolveTerminal } from "./terminal";
import { PdvApp } from "./pdv-app";
import type { CustomerInfo } from "./customer-picker";
import type { PlainCart } from "./actions";

export const metadata = { title: "Frente de caixa (PDV)" };
export const dynamic = "force-dynamic";

async function customerInfo(store: any, id: string | null): Promise<CustomerInfo | null> {
  if (!id) return null;
  const c = await store.get("customers", id);
  if (!c) return null;
  const open = await listAll(store, "installments", { filters: [["eq", "partyId", id], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] });
  const openBalance = open.reduce((a, i) => a + i.balance, 0);
  return { id: c.id, name: c.name, tradeName: c.tradeName ?? null, personType: c.personType, doc: c.doc ?? null, email: c.email ?? null, mobile: c.mobile ?? c.phone ?? null, vip: Boolean(c.vip), creditLimit: c.creditLimit ?? 0, openBalance, creditAvailable: Math.max(0, (c.creditLimit ?? 0) - openBalance) };
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("pdv");
  const params = await searchParams;
  if (!s.branch) {
    return (
      <>
        <PageHeader title="Frente de caixa (PDV)" crumbs={[{ label: "Vendas e caixa" }, { label: "PDV" }]} />
        <Notice tone="warn" title="Selecione uma filial">O PDV opera numa filial específica; o contexto consolidado é somente para consulta. Troque a unidade no topo da tela.</Notice>
      </>
    );
  }
  const { terminal, terminals, session } = await resolveTerminal(s, sp(params, "terminal") || null);
  if (!terminal) {
    return (
      <>
        <PageHeader title="Frente de caixa (PDV)" crumbs={[{ label: "Vendas e caixa" }, { label: "PDV" }]} />
        <Notice tone="warn" title="Nenhum terminal ativo nesta filial">
          Cadastre ou ative um terminal do PDV em Administração → Terminais.
          {can(s.user, "admin") && <div className="mt-2"><LinkButton href="/administracao/terminais" size="sm">Terminais</LinkButton></div>}
        </Notice>
      </>
    );
  }
  if (!can(s.user, "pdv", "create")) {
    return (
      <>
        <PageHeader title="Frente de caixa (PDV)" crumbs={[{ label: "Vendas e caixa" }, { label: "PDV" }]} />
        <Notice tone="warn" title="Sem permissão para vender">Seu perfil permite apenas consultar o PDV.</Notice>
      </>
    );
  }
  const store = s.ctx.store;
  let cart = (await ensureOpenCart(s.ctx, terminal.id))!;
  // cliente vindo do CRM (Clientes → Nova venda)
  const clienteParam = sp(params, "cliente");
  if (clienteParam && !cart.customerId && (cart.items ?? []).length === 0) {
    cart = await saveCart(s.ctx, cart.id, { customerId: clienteParam }).catch(() => cart);
  }
  // troca: devolução com vale a aplicar
  const trocaParam = sp(params, "troca");
  let pendingExchange: { returnId: string; number: number; itemsTotal: number } | null = null;
  if (trocaParam && cart.exchangeReturnId !== trocaParam) {
    const ret = await store.get("returns", trocaParam);
    if (ret && ret.companyId === s.ctx.companyId && ret.kind === "exchange" && !ret.exchangeSaleId) {
      if ((cart.items ?? []).length === 0) cart = await saveCart(s.ctx, cart.id, { exchangeReturnId: ret.id, ...(ret.customerId ? { customerId: ret.customerId } : {}) });
      else pendingExchange = { returnId: ret.id, number: ret.number, itemsTotal: ret.itemsTotal };
    }
  }
  let exchange: { returnId: string; number: number; saleNumber: number; voucherCode: string | null; voucherBalance: number } | null = null;
  if (cart.exchangeReturnId) {
    const ret = await store.get("returns", cart.exchangeReturnId);
    if (ret) {
      const v = ret.creditVoucherId ? await store.get("credit_vouchers", ret.creditVoucherId) : null;
      const orig = await store.get("sales", ret.saleId);
      exchange = { returnId: ret.id, number: ret.number, saleNumber: orig?.number ?? 0, voucherCode: v?.code ?? null, voucherBalance: v?.status === "active" ? v.balance : 0 };
    }
  }
  const [priceTables, categories, parkedRaw, users, terminalNames] = await Promise.all([
    lookups.priceTables(s.ctx),
    lookups.categories(s.ctx),
    listParkedCarts(s.ctx),
    nameMap(s.ctx, "users"),
    nameMap(s.ctx, "terminals"),
  ]);
  const allowNegative = Boolean(terminal.allowNegativeStock) || Boolean(await getSetting(store, s.ctx.companyId, s.ctx.branchId, "sales.allowNegativeStock", false));
  const plain: PlainCart = {
    id: cart.id, status: cart.status, terminalId: cart.terminalId, customerId: cart.customerId ?? null, customerName: cart.customerName ?? null, cpfOnInvoice: cart.cpfOnInvoice ?? null,
    priceTableId: cart.priceTableId ?? null, items: cart.items ?? [], globalDiscount: cart.globalDiscount ?? 0, globalDiscountBps: cart.globalDiscountBps ?? 0, surcharge: cart.surcharge ?? 0,
    notes: cart.notes ?? null, payments: cart.payments ?? [], exchangeReturnId: cart.exchangeReturnId ?? null, revision: cart.revision ?? 0, total: cart.total ?? 0, updatedAt: cart.updatedAt,
  };
  return (
    <PdvApp
      key={cart.id}
      branch={{ id: s.branch.id, name: s.branch.name }}
      companyName={s.company.tradeName || s.company.name}
      operator={{ id: s.user.id, name: s.user.name, discountLimitBps: s.user.discountLimitBps ?? 0, canOverLimit: canDo(s.user, "sale.discount_over_limit"), canCreateCustomer: can(s.user, "customers", "create") }}
      terminal={{ id: terminal.id, name: terminal.name, code: terminal.code, printerMode: terminal.printerMode ?? null, scannerMode: terminal.scannerMode ?? null }}
      terminals={terminals.map((t) => ({ id: t.id, name: t.name, code: t.code, status: t.status }))}
      session={session ? { id: session.id, number: session.number, openedAt: session.openedAt, operatorName: users.get(session.operatorId) ?? "—", status: session.status } : null}
      cart={plain}
      customer={await customerInfo(store, cart.customerId ?? null)}
      priceTables={priceTables}
      categories={categories}
      parked={parkedRaw.map((p) => ({ id: p.id, name: p.name ?? null, customerName: p.customerName ?? null, total: p.total ?? 0, itemsCount: p.itemsCount ?? (p.items ?? []).length, parkedAt: p.parkedAt ?? p.updatedAt, expired: p.expired, operatorName: users.get(p.operatorId) ?? "—", terminalName: terminalNames.get(p.terminalId) ?? "—" }))}
      allowNegative={allowNegative}
      exchange={exchange}
      pendingExchange={pendingExchange}
    />
  );
}
