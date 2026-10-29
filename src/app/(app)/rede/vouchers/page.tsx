import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { certificationSettings } from "@/domain/accounting";
import { effectivePrice, listVoucherPackages, listVoucherPurchases, lotBalance, networkViewer, nodeVoucherCodes, voucherBalances } from "@/domain/network";
import { requireNetworkSession } from "../shared";
import { CancelCodeButton, IssueCodeForm, PackageForm, PackageToggle, PurchaseForm } from "./forms";

export const metadata = { title: "Vouchers da rede" };

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  const crumbs = [{ label: "Rede de certificação", href: v.platform ? "/rede" : "/rede/minha" }, { label: "Vouchers" }];
  const manage = v.platform || canDo(s.user, "network.vouchers");
  if (!manage && !canDo(s.user, "network.sales_all")) {
    return (
      <>
        <PageHeader title="Vouchers" crumbs={crumbs} />
        <Notice tone="warn">Vouchers são geridos pelo administrador ou gestor do parceiro (operação “Criar, vender e atribuir pacotes de vouchers”). Na venda, o saldo do seu nó aparece direto no formulário.</Notice>
      </>
    );
  }
  const settings = await certificationSettings(s.ctx.store);
  const label = (k: string) => settings.catalog.find((p) => p.key === k)?.label ?? k;
  const me = v.myNode;
  const [packages, purchases, balances, codes] = await Promise.all([
    listVoucherPackages(s.ctx), listVoucherPurchases(s.ctx), me ? voucherBalances(s.ctx.store, me.id) : Promise.resolve(null), me ? nodeVoucherCodes(s.ctx.store, me.id) : Promise.resolve([]),
  ]);
  const sellable = settings.catalog.filter((p) => p.active && !p.free);
  const floors: Record<string, number> = {};
  for (const p of sellable) floors[p.key] = me ? ((await effectivePrice(s.ctx.store, me.id, p.key))?.cost ?? 0) : Number(p.acCost ?? 0);
  const below = v.nodes.filter((n) => v.visible.has(n.id) && n.id !== me?.id && n.status === "active").map((n) => ({ value: n.id, label: n.name }));
  const canCreate = manage && (v.platform || (me && me.level !== "contador" && me.status === "active"));
  const offered = packages.filter((p) => !p.mine);
  const mine = packages.filter((p) => p.mine);
  const totalAvail = balances?.products.reduce((a, b) => a + b.available, 0) ?? 0;
  return (
    <>
      <PageHeader title="Vouchers" crumbs={crumbs} description="Pacotes pré-pagos vendidos pelo nível de cima: cada unidade resgatada numa venda tem o custo já coberto. Saldo sempre calculado: disponível = comprado − resgatado (e reservado em códigos) − vencido." />
      {balances && (
        <>
          <section aria-label="Saldo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Disponível" value={totalAvail.toLocaleString("pt-BR")} tone={totalAvail ? "good" : "default"} />
            <Stat label="Comprado" value={(balances.products.reduce((a, b) => a + b.bought, 0)).toLocaleString("pt-BR")} />
            <Stat label="Resgatado" value={(balances.products.reduce((a, b) => a + b.redeemed, 0)).toLocaleString("pt-BR")} />
            <Stat label="Vencido" value={(balances.products.reduce((a, b) => a + b.expired, 0)).toLocaleString("pt-BR")} tone={balances.products.some((b) => b.expired) ? "warn" : "default"} />
          </section>
          <Card title="Saldo do meu nó por pacote" className="mb-4">
            {balances.lots.length === 0 ? <p className="text-sm text-slate-500">Nenhum voucher comprado.</p> : (
              <ul className="divide-y divide-line">
                {balances.lots.map((l) => {
                  const b = lotBalance(l);
                  const lotCodes = codes.filter((c) => c.lotId === l.id);
                  return (
                    <li key={l.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span><span className="font-medium">{l.packageName}</span> · {label(l.productKey)} · {formatMoney(l.unitPrice)} a unidade</span>
                        <span className="flex flex-wrap gap-1 text-xs">
                          <Badge tone="good">restam {b.available}</Badge>
                          <Badge>comprado {b.qty}</Badge>
                          <Badge>resgatado {b.redeemed}</Badge>
                          {b.reserved > 0 && <Badge tone="info">em códigos {b.reserved}</Badge>}
                          {b.expired > 0 ? <Badge tone="bad">vencido {b.expired}</Badge> : <Badge tone="neutral">vale até {formatDate(l.validTo)}</Badge>}
                        </span>
                      </div>
                      {manage && b.valid && b.available > 0 && <IssueCodeForm lotId={l.id} />}
                      {lotCodes.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-xs text-brand-700">Códigos ({lotCodes.length})</summary>
                          <ul className="mt-2 space-y-1 text-sm">
                            {lotCodes.map((c) => (
                              <li key={c.id} className="flex flex-wrap items-center gap-2">
                                <span className="font-mono">{c.code}</span>
                                {c.gift && <Badge tone="info">presente</Badge>}
                                <Badge tone={c.status === "available" ? "good" : c.status === "redeemed" ? "neutral" : "bad"}>{c.status === "available" ? "disponível" : c.status === "redeemed" ? "usado" : "cancelado"}</Badge>
                                {c.notes && <span className="text-xs text-slate-500">{c.notes}</span>}
                                {manage && c.status === "available" && <CancelCodeButton id={c.id} />}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pacotes oferecidos ao meu nó" description="Pelos níveis acima ou pela plataforma.">
          {offered.length === 0 ? <p className="text-sm text-slate-500">Nenhum pacote oferecido.</p> : (
            <ul className="divide-y divide-line">
              {offered.map((p) => (
                <li key={p.id} className="space-y-1 py-3 text-sm">
                  <p><span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-slate-500">{p.code}</span> · {p.ownerName}</p>
                  <p className="text-xs text-slate-600">{(p.items ?? []).map((i: any) => `${i.qty} × ${label(i.productKey)} a ${formatMoney(i.unitPrice)}`).join(" · ")} — total {formatMoney(p.total)} · vigência {formatDate(p.validFrom)} a {formatDate(p.validTo)}</p>
                  {p.buyable ? <PurchaseForm packageId={p.id} total={p.total} label="Comprar pacote" /> : <Badge>{p.active === false ? "encerrado" : "fora da vigência"}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={v.platform ? "Pacotes da plataforma" : "Pacotes que meu nó vende aos de baixo"}>
          {mine.length === 0 ? <p className="text-sm text-slate-500">Nenhum pacote criado.</p> : (
            <ul className="divide-y divide-line">
              {mine.map((p) => (
                <li key={p.id} className="space-y-1 py-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.name}</span> <span className="font-mono text-xs text-slate-500">{p.code}</span>{p.recipientName && <Badge tone="info">para {p.recipientName}</Badge>}{p.active === false && <Badge>encerrado</Badge>}</p>
                  <p className="text-xs text-slate-600">{(p.items ?? []).map((i: any) => `${i.qty} × ${label(i.productKey)} a ${formatMoney(i.unitPrice)}`).join(" · ")} — total {formatMoney(p.total)} · até {formatDate(p.validTo)}</p>
                  {manage && (
                    <div className="flex flex-wrap items-center gap-2">
                      {p.active !== false && below.length > 0 && <PurchaseForm packageId={p.id} total={p.total} buyers={p.recipientNodeId ? below.filter((b) => b.value === p.recipientNodeId) : below} label="Atribuir" />}
                      <PackageToggle id={p.id} active={p.active !== false} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {canCreate && sellable.length > 0 && (
        <Card title="Novo pacote" className="mt-4" description="Preço unitário não pode ficar abaixo do seu custo do produto. Quem compra paga o total; cada unidade resgatada cobre o custo daquela venda.">
          <PackageForm products={sellable.map((p) => ({ value: p.key, label: p.label }))} recipients={below} floors={floors} />
        </Card>
      )}
      <Card title="Compras de pacotes" className="mt-4">
        {purchases.length === 0 ? <p className="text-sm text-slate-500">Nenhuma compra.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left font-medium">Data</th><th className="px-3 py-2 text-left font-medium">Pacote</th><th className="px-3 py-2 text-left font-medium">Vendido por</th><th className="px-3 py-2 text-left font-medium">Comprador</th><th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2 text-left font-medium">Financeiro</th></tr></thead>
              <tbody className="divide-y divide-line">
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">{formatDate(p.createdAt)}</td>
                    <td className="px-3 py-2">{p.packageName}</td>
                    <td className="px-3 py-2">{p.sellerName}</td>
                    <td className="px-3 py-2">{p.buyerName}</td>
                    <td className="tabular px-3 py-2 text-right">{formatMoney(p.total)}</td>
                    <td className="px-3 py-2 text-xs">{p.financeNote ? <span className="text-amber-700">{p.financeNote}</span> : "a receber e a pagar lançados"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
