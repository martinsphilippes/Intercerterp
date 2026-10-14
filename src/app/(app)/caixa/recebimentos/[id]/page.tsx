import Link from "@/components/ui/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { LinkButton } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { PDV_RECEIVABLE_OP, type PdvReceiptItem } from "@/domain/pdv-receivables";
import { AutoPrint } from "../../../vendas/sale-widgets";
import { PrintStyles } from "../../../vendas/print-styles";

export const metadata = { title: "Recibo de recebimento de parcelas" };

/**
 * Recibo (80 mm) de um recebimento de parcelas feito no PDV — várias parcelas, inclusive de clientes distintos.
 * Padrão de impressão `?print=1`; o recibo por título continua em Financeiro → Contas a receber → Recibo.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const s = await requireSession();
  if (!can(s.user, "pdv") && !can(s.user, "cash") && !can(s.user, "finance")) redirect("/sem-permissao");
  const { id } = await params;
  const { print } = await searchParams;
  const store = s.ctx.store;
  const op = await store.get("operations", id);
  if (!op || op.companyId !== s.ctx.companyId || op.type !== PDV_RECEIVABLE_OP) notFound();
  const r = op.result ?? {};
  if (!s.user.isAdmin && (s.user.branchIds ?? []).length && !s.user.branchIds.includes(r.branchId)) notFound();
  const items = ((r.items ?? []) as PdvReceiptItem[]).filter((i) => i.done);
  const [users, terminals, branches] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "terminals"), nameMap(s.ctx, "branches")]);
  const company = await store.get("companies", op.companyId);
  const docs = new Map<string, string | null>();
  for (const cid of new Set(items.map((i) => i.customerId).filter(Boolean) as string[])) docs.set(cid, (await store.get("customers", cid))?.doc ?? null);
  // agrupado por cliente (o recibo é emitido a cada pagador)
  const groups = new Map<string, PdvReceiptItem[]>();
  for (const i of items) groups.set(i.customerId ?? i.partyName, [...(groups.get(i.customerId ?? i.partyName) ?? []), i]);
  const total = items.reduce((a, i) => a + i.total, 0);
  const finance = can(s.user, "finance");
  return (
    <div className="flex flex-col items-center gap-4">
      <PrintStyles paper="80mm" />
      <div className="no-print flex flex-wrap justify-center gap-2">
        <AutoPrint enabled={print === "1" && op.status !== "reversed"} />
        {r.sessionId && can(s.user, "cash") && <LinkButton href={`/caixa/${r.sessionId}?tab=movimentos`}>Ver caixa</LinkButton>}
      </div>
      <article className="print-doc w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-black shadow">
        <p className="text-center text-[13px] font-bold">{company?.tradeName || company?.name}</p>
        <p className="text-center">{company?.cnpj ? `CNPJ ${formatDoc(company.cnpj)} · ` : ""}{branches.get(r.branchId)}</p>
        <p className="my-1 border-y border-dashed border-black py-1 text-center font-bold uppercase">Recibo de recebimento nº {r.number}</p>
        {op.status === "reversed" && <p className="my-1 border border-black py-1 text-center font-bold">ESTORNADO em {formatDateTime(r.reversal?.at)} — {r.reversal?.reason}</p>}
        <p>{formatDateTime(r.at)} · Caixa nº {r.sessionNumber} · {terminals.get(r.terminalId)}</p>
        <p>Operador: {r.operatorName ?? users.get(op.createdBy) ?? "—"}</p>
        {[...groups.values()].map((list) => {
          const sub = list.reduce((a, i) => a + i.total, 0);
          const doc = list[0].customerId ? docs.get(list[0].customerId) : null;
          return (
            <section key={list[0].customerId ?? list[0].partyName} className="mt-2 border-t border-dashed border-black pt-1">
              <p>Recebemos de <b>{list[0].partyName}</b>{doc ? ` (${formatDoc(doc)})` : ""} a importância de <b>{formatMoney(sub)}</b>, referente a:</p>
              {list.map((i) => (
                <div key={i.installmentId} className="mt-1">
                  <p className="font-bold">Título nº {i.titleNumber} · parcela {i.number}/{i.count}</p>
                  <p>{i.description} · venc. {formatDate(i.dueDate)}{i.daysLate ? ` (${i.daysLate} dia(s) de atraso)` : ""}</p>
                  <p className="flex justify-between"><span>Principal</span><span>{formatMoney(i.principal)}</span></p>
                  {i.fine + i.interest > 0 && <p className="flex justify-between"><span>Multa {formatMoney(i.fine)} + juros {formatMoney(i.interest)}</span><span>+{formatMoney(i.fine + i.interest)}</span></p>}
                  {i.discount > 0 && <p className="flex justify-between"><span>Desconto</span><span>−{formatMoney(i.discount)}</span></p>}
                  <p className="flex justify-between font-bold"><span>Pago</span><span>{formatMoney(i.total)}</span></p>
                  {finance && <Link className="no-print text-[10px] text-brand-700 underline" href={`/financeiro/receber/${i.titleId}/recibo?baixa=${i.settlementId}`}>recibo do título</Link>}
                </div>
              ))}
            </section>
          );
        })}
        <div className="mt-2 border-t border-dashed border-black pt-1">
          <p className="flex justify-between text-[14px] font-bold"><span>TOTAL</span><span>{formatMoney(total)}</span></p>
          <p className="flex justify-between"><span>Forma</span><span>{r.methodName}</span></p>
          {r.methodKind === "cash" && <p className="flex justify-between"><span>Recebido</span><span>{formatMoney(r.received)}</span></p>}
          {r.methodKind === "cash" && r.change > 0 && <p className="flex justify-between"><span>Troco</span><span>{formatMoney(r.change)}</span></p>}
          {r.reference && <p>Ref.: {r.reference}</p>}
          {r.approvedByName && <p>Desconto autorizado por: {r.approvedByName}</p>}
        </div>
        {op.status === "partial" && <p className="mt-1 font-bold">Recebimento parcial: {op.error}</p>}
        <div className="mt-8 text-center">
          <p className="border-t border-black pt-1">{company?.tradeName || company?.name}</p>
        </div>
        <p className="mt-2 text-center text-[9px]">Saldo de parcelas atualizado no contas a receber. Impresso em {formatDateTime(new Date().toISOString())}</p>
      </article>
    </div>
  );
}
