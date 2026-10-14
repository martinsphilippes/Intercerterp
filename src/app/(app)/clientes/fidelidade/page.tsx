import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { addDays, formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { LOYALTY_MOVE_LABEL, loyaltyParams } from "@/domain/loyalty";

export const metadata = { title: "Programa de fidelidade" };

/** Programa de fidelidade (CAD-21): regras vigentes, saldos por cliente e últimos movimentos de pontos. */
export default async function Page() {
  const s = await requireSession("customers");
  await requireFeaturePage(s, "fidelidade");
  const store = s.ctx.store;
  const cid = s.ctx.companyId;
  const t0 = today();
  const [p, vouchersAll, customers] = await Promise.all([
    loyaltyParams(store, cid),
    listAll(store, "credit_vouchers", { filters: [["eq", "companyId", cid], ["eq", "kind", "loyalty"]] }),
    nameMap(s.ctx, "customers"),
  ]);
  const vouchers = vouchersAll.filter((v) => v.kind === "loyalty");
  const live = vouchers.filter((v) => v.status === "active" && (v.balance ?? 0) > 0 && (!v.expiresAt || v.expiresAt >= t0));
  const in30 = addDays(t0, 30);
  const byCustomer = new Map<string, { points: number; next: string | null }>();
  for (const v of live) {
    const cur = byCustomer.get(v.customerId) ?? { points: 0, next: null };
    cur.points += v.balance;
    if (v.expiresAt && (!cur.next || v.expiresAt < cur.next)) cur.next = v.expiresAt;
    byCustomer.set(v.customerId, cur);
  }
  const ranking = [...byCustomer.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 50);
  const points = live.reduce((a, v) => a + v.balance, 0);
  const expiring = live.filter((v) => v.expiresAt && v.expiresAt <= in30).reduce((a, v) => a + v.balance, 0);
  const ids = vouchers.map((v) => v.id);
  const moves = [];
  for (let i = 0; i < ids.length && i < 2000; i += 100) moves.push(...(await listAll(store, "credit_voucher_moves", { filters: [["eq", "voucherId", ids.slice(i, i + 100)]] })));
  moves.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const owner = new Map(vouchers.map((v) => [v.id, v.customerId]));

  return (
    <>
      <PageHeader
        title="Programa de fidelidade"
        crumbs={[{ label: "Clientes", href: "/clientes" }, { label: "Fidelidade" }]}
        description="Pontos acumulados nas compras com cliente identificado e resgatados no PDV como forma de pagamento. As regras ficam em Administração › Parâmetros › Fidelidade."
        actions={can(s.user, "admin") ? <Link href="/administracao/parametros" className={buttonClass("secondary")}>Editar regras</Link> : null}
      />
      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clientes com pontos" value={byCustomer.size} />
        <Stat label="Pontos disponíveis" value={points.toLocaleString("pt-BR")} hint={`${formatMoney(points * p.pointValue)} em resgates possíveis`} />
        <Stat label="Vencem em 30 dias" value={expiring.toLocaleString("pt-BR")} tone={expiring ? "warn" : "default"} />
        <Stat label="Valor de 1 ponto" value={formatMoney(p.pointValue)} hint={`${p.pointsPerReal} ponto(s) por R$ 1,00`} />
      </section>
      <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card title="Regras vigentes">
          <DefinitionList
            cols={1}
            items={[
              { label: "Acúmulo", value: `${p.pointsPerReal} ponto(s) a cada R$ 1,00 da venda identificada (sem o valor pago com pontos), arredondado para baixo` },
              { label: "Resgate", value: `1 ponto = ${formatMoney(p.pointValue)}, mínimo de ${p.minRedeemPoints.toLocaleString("pt-BR")} pontos por pagamento` },
              { label: "Validade", value: p.validityDays > 0 ? `${p.validityDays} dias a partir da compra` : "Os pontos não vencem" },
              { label: "Devolução e cancelamento", value: "Estornam os pontos da venda (proporcionais ao valor devolvido); o cancelamento devolve os pontos usados no pagamento" },
            ]}
          />
        </Card>
        <Card title="Clientes com mais pontos" bodyClass="p-0" className="xl:col-span-2">
          {ranking.length === 0 ? (
            <EmptyState title="Nenhum cliente com pontos" description="Os pontos aparecem depois das vendas com cliente identificado." />
          ) : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Cliente</th><th className="text-right">Pontos</th><th className="text-right">Valor</th><th>Próximo vencimento</th></tr></thead>
              <tbody>
                {ranking.map(([customerId, r]) => (
                  <tr key={customerId}>
                    <td><Link className="text-brand-700 hover:underline" href={`/clientes/${customerId}?tab=fidelidade`}>{customers.get(customerId) ?? "Cliente"}</Link></td>
                    <td className="tabular text-right">{r.points.toLocaleString("pt-BR")}</td>
                    <td className="tabular text-right">{formatMoney(r.points * p.pointValue)}</td>
                    <td>{r.next ? formatDate(r.next) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Últimos movimentos" bodyClass="p-0" className="xl:col-span-3">
          {moves.length === 0 ? (
            <EmptyState title="Sem movimentos" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Data</th><th>Cliente</th><th>Movimento</th><th>Venda</th><th className="text-right">Pontos</th></tr></thead>
              <tbody>
                {moves.slice(0, 40).map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>{customers.get(owner.get(m.voucherId) ?? "") ?? "—"}</td>
                    <td>{LOYALTY_MOVE_LABEL[m.kind] ?? m.kind}</td>
                    <td>{m.saleId ? <Link className="text-brand-700 hover:underline" href={`/vendas/${m.saleId}`}>Ver venda</Link> : "—"}</td>
                    <td className={`tabular text-right ${m.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.amount > 0 ? "+" : ""}{m.amount.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
