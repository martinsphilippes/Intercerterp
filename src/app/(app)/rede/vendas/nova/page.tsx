import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { addDays, today } from "@/lib/dates";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError } from "@/lib/core/errors";
import { certificationSettings } from "@/domain/accounting";
import { cascadeChain, listCertCustomers, requireSellerNode, voucherBalances } from "@/domain/network";
import { requireNetworkSession } from "../../shared";
import { SaleForm, type SaleCustomer, type SaleProduct } from "./sale-form";

export const metadata = { title: "Nova venda de certificado" };

export default async function Page({ searchParams }: { searchParams: Promise<{ cliente?: string; produto?: string; anterior?: string }> }) {
  const s = await requireNetworkSession();
  const sp = await searchParams;
  const crumbs = [{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Vendas", href: "/rede/vendas" }, { label: "Nova venda" }];
  let node;
  try {
    node = await requireSellerNode(s.ctx);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    return (
      <>
        <PageHeader title="Nova venda de certificado" crumbs={crumbs} />
        <Notice tone="warn" title="Venda indisponível">{e.message}</Notice>
      </>
    );
  }
  const [settings, customers, balances] = await Promise.all([certificationSettings(s.ctx.store), listCertCustomers(s.ctx), voucherBalances(s.ctx.store, node.id)]);
  const products: SaleProduct[] = [];
  for (const p of settings.catalog.filter((x) => x.active)) {
    const chain = p.free ? null : await cascadeChain(s.ctx.store, node.id, p.key);
    const mine = chain?.levels[chain.levels.length - 1] ?? null;
    products.push({
      key: p.key, label: p.label, months: p.months, free: p.free === true, holder: p.holder ?? null, type: p.type ?? null,
      terms: mine ? { cost: mine.cost, minPrice: mine.minPrice, defaultPrice: mine.defaultPrice, canEdit: mine.canEdit } : null,
      voucherAvailable: balances.products.find((b) => b.productKey === p.key)?.available ?? 0,
    });
  }
  const list: SaleCustomer[] = customers.filter((c) => c.active !== false).map((c) => ({ id: c.id, code: c.code ?? null, name: c.name, doc: c.doc, personType: c.personType === "PJ" ? "PJ" : "PF", email: c.email ?? null, phone: c.phone ?? null, hasBirdId: Boolean(c.hasBirdId), birdIdValidTo: c.birdIdValidTo ?? null }));
  let previous: { id: string; productLabel: string; validTo: string; customerId: string } | null = null;
  if (sp.anterior) {
    const prev = await unscoped(s.ctx.store).get("accounting_certificates", sp.anterior);
    if (prev && prev.companyId === s.ctx.companyId) previous = { id: prev.id, productLabel: prev.productLabel, validTo: prev.validTo, customerId: prev.customerId ?? prev.clientId };
  }
  return (
    <>
      <PageHeader
        title={previous ? "Renovação de certificado" : "Nova venda de certificado"}
        crumbs={crumbs}
        description={`${node.name}: produto → cliente → preço (cupom ou voucher) → conferência → confirmação. A venda segue o ciclo cobrança → pagamento → validação → emissão → download.`}
        actions={<LinkButton href="/rede/clientes/novo?back=venda">Novo cliente</LinkButton>}
      />
      {list.length === 0 ? (
        <Notice tone="info" title="Cadastre o cliente primeiro">
          Nenhum cliente de certificado disponível para você. <LinkButton href="/rede/clientes/novo?back=venda" size="sm" className="ml-2">Cadastrar cliente</LinkButton>
        </Notice>
      ) : (
        <SaleForm
          products={products}
          customers={list}
          initialCustomerId={sp.cliente ?? previous?.customerId ?? null}
          initialProduct={sp.produto ?? null}
          previous={previous}
          defaultDueDate={addDays(today(), 5)}
          minDueDate={today()}
        />
      )}
    </>
  );
}
