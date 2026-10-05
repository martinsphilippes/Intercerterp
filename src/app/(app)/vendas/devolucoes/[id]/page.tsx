import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { MOVEMENT_LABEL } from "@/domain/stock";
import { COMPENSATION_LABEL, REFUND_METHOD_LABEL } from "@/domain/sales";
import { DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { MODEL_NAME } from "../../labels";

export const metadata = { title: "Devolução" };

const MOVE_LABEL: Record<string, string> = { issue: "Emissão", use: "Uso em venda", reverse: "Estorno (venda cancelada)" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("sales");
  const { id } = await params;
  const store = s.ctx.store;
  const ret = await store.get("returns", id);
  if (!ret || ret.companyId !== s.ctx.companyId) notFound();
  const sale = await store.getOrThrow("sales", ret.saleId);
  const [items, saleItems, movs, voucher, entries, cashMovs, titles, users, warehouses, accounts] = await Promise.all([
    listAll(store, "return_items", { filters: [["eq", "returnId", id]] }),
    listAll(store, "sale_items", { filters: [["eq", "saleId", sale.id]] }),
    listAll(store, "stock_movements", { filters: [["eq", "originType", "return"], ["eq", "originId", id]] }),
    ret.creditVoucherId ? store.get("credit_vouchers", ret.creditVoucherId) : null,
    listAll(store, "account_entries", { filters: [["eq", "originType", "return"], ["eq", "originId", id]] }),
    listAll(store, "cash_movements", { filters: [["eq", "returnId", id]] }),
    listAll(store, "titles", { filters: [["eq", "originType", "return"], ["eq", "originId", id]] }),
    nameMap(s.ctx, "users"),
    nameMap(s.ctx, "warehouses"),
    nameMap(s.ctx, "financial_accounts"),
  ]);
  const vmoves = voucher ? await listAll(store, "credit_voucher_moves", { filters: [["eq", "voucherId", voucher.id]], orderBy: [{ field: "createdAt", dir: "asc" }] }) : [];
  const useSales = vmoves.filter((m) => m.saleId).map((m) => m.saleId);
  const salesUsing = useSales.length ? await listAll(store, "sales", { filters: [["eq", "id", useSales]] }) : [];
  const exSale = ret.exchangeSaleId ? await store.get("sales", ret.exchangeSaleId) : null;
  const doc = ret.fiscalDocumentId ? await store.get("fiscal_documents", ret.fiscalDocumentId) : null;
  const sItem = new Map(saleItems.map((i) => [i.id, i]));
  const pendingExchange = ret.kind === "exchange" && !ret.exchangeSaleId;
  return (
    <>
      <PageHeader
        title={`${ret.kind === "exchange" ? "Troca" : "Devolução"} nº ${ret.number}`}
        crumbs={[{ label: "Trocas e devoluções", href: "/vendas/devolucoes" }, { label: `nº ${ret.number}` }]}
        badges={<><StatusBadge kind="generic" status={ret.status} /><Badge tone="info">{COMPENSATION_LABEL[ret.compensation] ?? ret.compensation}</Badge></>}
        description={`${formatDateTime(ret.createdAt)} · registrada por ${users.get(ret.createdBy) ?? "—"} · venda de origem nº ${sale.number} (preservada)`}
        actions={
          <>
            <LinkButton href={`/vendas/${sale.id}`}>Venda nº {sale.number}</LinkButton>
            {pendingExchange && can(s.user, "pdv", "create") && s.ctx.branchId === ret.branchId && (
              <LinkButton href={`/pdv?troca=${id}`} variant="accent"><ArrowLeftRight className="size-4" /> Abrir PDV com o vale da troca</LinkButton>
            )}
          </>
        }
      />
      {pendingExchange && <div className="mb-4"><Notice tone="info" title="Troca aguardando a nova venda">O vale {voucher?.code} ({formatMoney(voucher?.balance)}) será aplicado automaticamente no pagamento do novo atendimento.</Notice></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Valor devolvido" value={formatMoney(ret.itemsTotal)} hint={`${items.length} item(ns) · custo retornado ${formatMoney(ret.costTotal)}`} />
        <Stat label="Compensação" value={COMPENSATION_LABEL[ret.compensation] ?? ret.compensation} hint={ret.refundMethod ? REFUND_METHOD_LABEL[ret.refundMethod] : voucher ? `Vale ${voucher.code}` : "—"} />
        <Stat label={ret.kind === "exchange" ? "Diferença da troca" : "Saldo do vale"} value={ret.kind === "exchange" ? (exSale ? formatMoney(Math.abs(ret.difference)) : "—") : voucher ? formatMoney(voucher.balance) : "—"} hint={ret.kind === "exchange" ? (exSale ? (ret.difference >= 0 ? "paga pelo cliente na nova venda" : "a favor do cliente (permanece no vale)") : "nova venda pendente") : voucher ? `de ${formatMoney(voucher.originalAmount)} · validade ${formatDate(voucher.expiresAt)}` : undefined} />
        <Stat label="Documento fiscal de devolução" value={doc ? `${doc.model === "nfe" ? "NF-e" : doc.model} ${doc.number ?? "(rascunho)"}` : "Não gerado"} hint={doc ? `Situação: ${DOC_STATUS_LABEL[doc.status] ?? doc.status}${doc.status === "draft" ? " — revisar e transmitir no módulo Fiscal" : ""}` : "Venda sem documento autorizado a referenciar"} href={doc ? `/fiscal/${doc.model}/${doc.id}` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Itens devolvidos" className="lg:col-span-2" bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Produto</th><th className="text-right">Qtd.</th><th>Motivo</th><th>Condição / destino</th><th className="text-right">Valor</th></tr></thead>
            <tbody>
              {items.map((i) => {
                const si = sItem.get(i.saleItemId);
                return (
                  <tr key={i.id}>
                    <td>{si?.description}<span className="block font-mono text-xs text-slate-500">{si?.sku}</span></td>
                    <td className="tabular text-right">{formatQty(i.qty, si?.unitCode)}</td>
                    <td>{i.reason ?? ret.reason}</td>
                    <td>{i.condition === "damaged" ? <Badge tone="warn">Avaria</Badge> : <Badge tone="good">Revenda</Badge>} <span className="text-xs text-slate-500">{warehouses.get(i.warehouseId) ?? ""}</span></td>
                    <td className="tabular text-right">{formatMoney(i.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ret.notes && <p className="border-t border-line px-4 py-2 text-sm text-slate-600">Observações: {ret.notes}</p>}
        </Card>
        <Card title="Dados da operação">
          <DefinitionList
            cols={1}
            items={[
              { label: "Venda de origem", value: <Link className="text-brand-700 hover:underline" href={`/vendas/${sale.id}`}>nº {sale.number} — {formatDateTime(sale.completedAt)}</Link> },
              { label: "Cliente", value: sale.customerId ? <Link className="text-brand-700 hover:underline" href={`/clientes/${sale.customerId}`}>{sale.customerSnapshot?.name}</Link> : (sale.customerSnapshot?.name ?? "Consumidor final") },
              { label: "Motivo", value: ret.reason },
              ret.cashSessionId && { label: "Caixa (saída em dinheiro)", value: <Link className="text-brand-700 hover:underline" href={`/caixa/${ret.cashSessionId}`}>Sessão de caixa</Link> },
              exSale && { label: "Nova venda da troca", value: <Link className="text-brand-700 hover:underline" href={`/vendas/${exSale.id}`}>nº {exSale.number} — {formatMoney(exSale.total)}</Link> },
              doc && { label: "Documento de devolução", value: <Link className="text-brand-700 hover:underline" href={`/fiscal/${doc.model}/${doc.id}`}>{MODEL_NAME[doc.model] ?? doc.model} {doc.number ? `nº ${doc.number}` : "(rascunho)"} <SimBadge show={Boolean(doc.isSimulated)} /></Link> },
            ]}
          />
        </Card>
        {voucher && (
          <Card title={`Vale-crédito ${voucher.code}`} description={`Emitido ${formatMoney(voucher.originalAmount)} · saldo ${formatMoney(voucher.balance)} · ${voucher.status === "active" ? "ativo" : voucher.status === "used" ? "consumido" : voucher.status}`} className="lg:col-span-2" bodyClass="p-0">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Data</th><th>Movimento</th><th>Venda</th><th className="text-right">Valor</th><th className="text-right">Saldo após</th></tr></thead>
              <tbody>
                {vmoves.map((m) => {
                  const sl = salesUsing.find((x) => x.id === m.saleId);
                  return (
                    <tr key={m.id}><td>{formatDateTime(m.createdAt)}</td><td>{MOVE_LABEL[m.kind] ?? m.kind}</td><td>{sl ? <Link className="text-brand-700 hover:underline" href={`/vendas/${sl.id}`}>nº {sl.number}</Link> : "—"}</td><td className={`tabular text-right ${m.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatMoney(m.amount)}</td><td className="tabular text-right">{formatMoney(m.balanceAfter)}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <Card title="Efeitos" description="Estoque, caixa e financeiro gerados por esta devolução" className={voucher ? "" : "lg:col-span-2"} bodyClass="p-0">
          <ul className="divide-y divide-line text-sm">
            {movs.map((m) => (
              <li key={m.id} className="flex justify-between gap-2 px-4 py-2"><span>{MOVEMENT_LABEL[m.type as keyof typeof MOVEMENT_LABEL] ?? m.type} · {warehouses.get(m.warehouseId)}</span><span className="tabular text-emerald-700">+{formatQty(m.qty)}</span></li>
            ))}
            {cashMovs.map((m) => <li key={m.id} className="flex justify-between gap-2 px-4 py-2"><Link className="text-brand-700 hover:underline" href={`/caixa/${m.sessionId}`}>Saída do caixa</Link><span className="tabular text-red-700">{formatMoney(m.amount)}</span></li>)}
            {entries.map((e) => <li key={e.id} className="flex justify-between gap-2 px-4 py-2"><Link className="text-brand-700 hover:underline" href={`/financeiro/contas/${e.accountId}`}>{accounts.get(e.accountId) ?? "Conta"}</Link><span className="tabular text-red-700">{formatMoney(e.amount)}</span></li>)}
            {titles.map((t) => <li key={t.id} className="flex justify-between gap-2 px-4 py-2"><Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${t.id}`}>Estorno de cartão — a pagar nº {t.number}</Link><span className="tabular">{formatMoney(t.total)}</span></li>)}
            <li className="px-4 py-2 text-xs"><Link className="text-brand-700 hover:underline" href={`/estoque/movimentos?origem=return:${id}`}>Ver movimentos de estoque</Link></li>
          </ul>
        </Card>
        <Card title="Histórico" className="lg:col-span-3">
          <Timeline store={store} refs={[`return:${id}`]} />
        </Card>
      </div>
    </>
  );
}
