import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { listAll } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { BusinessError } from "@/lib/core/errors";
import { requestDisplayStatus } from "@/domain/accounting";
import { getCertCustomer } from "@/domain/network";
import { requireNetworkSession } from "../../shared";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Cliente de certificado" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireNetworkSession();
  const { id } = await params;
  let c;
  try {
    c = await getCertCustomer(s.ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const all = canDo(s.user, "network.sales_all");
  const [sales, certs] = await Promise.all([
    listAll(s.ctx.store, "certificate_requests", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "clientId", c.id]], orderBy: [{ field: "createdAt", dir: "desc" }] }),
    listAll(s.ctx.store, "accounting_certificates", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "clientId", c.id]] }),
  ]);
  const mySales = sales.filter((r) => all || r.sellerUserId === s.user.id);
  return (
    <>
      <PageHeader title={c.name} crumbs={[{ label: "Rede de certificação", href: "/rede/minha" }, { label: "Clientes", href: "/rede/clientes" }, { label: c.code ?? c.name }]} actions={canDo(s.user, "network.sell") ? <LinkButton href={`/rede/vendas/nova?cliente=${c.id}`} variant="primary">Nova venda</LinkButton> : undefined} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Cadastro">{canDo(s.user, "network.sell") ? <CustomerForm initial={{ id: c.id, personType: c.personType === "PJ" ? "PJ" : "PF", doc: c.doc, name: c.name, email: c.email ?? null, phone: c.phone ?? null, address: c.address ?? null, hasBirdId: Boolean(c.hasBirdId), birdIdValidTo: c.birdIdValidTo ?? null, notes: c.notes ?? null }} /> : <p className="text-sm text-slate-600">Consulta.</p>}</Card>
        </div>
        <div className="space-y-4">
          <Card title="Vendas">
            {mySales.length === 0 ? <p className="text-sm text-slate-500">Nenhuma venda.</p> : (
              <ul className="divide-y divide-line text-sm">
                {mySales.map((r) => (
                  <li key={r.id} className="py-2">
                    <Link href={`/rede/vendas/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.protocol}</Link> · {r.productLabel}
                    <span className="mt-1 flex items-center gap-2"><StatusBadge kind="certificate_request" status={requestDisplayStatus(r)} /><span className="tabular text-xs">{formatMoney(r.amount)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Certificados">
            {certs.length === 0 ? <p className="text-sm text-slate-500">Nenhum certificado emitido.</p> : (
              <ul className="divide-y divide-line text-sm">
                {certs.map((k) => <li key={k.id} className="py-2">{k.productLabel} · válido até {formatDate(k.validTo)}{k.active === false && <span className="text-xs text-slate-500"> (substituído)</span>}</li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
