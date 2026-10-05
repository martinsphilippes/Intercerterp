import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { LinkButton } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { CASH_MOVEMENT_LABEL } from "@/domain/cash";
import { AutoPrint } from "../../../../vendas/sale-widgets";
import { PrintStyles } from "../../../../vendas/print-styles";

export const metadata = { title: "Comprovante de movimento de caixa" };

/** Comprovante imprimível (80 mm) de suprimento/sangria/abertura, associado à sessão. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const s = await requireSession("cash");
  const { id } = await params;
  const { print } = await searchParams;
  const store = s.ctx.store;
  const m = await store.get("cash_movements", id);
  if (!m || m.companyId !== s.ctx.companyId) notFound();
  const session = await store.getOrThrow("cash_sessions", m.sessionId);
  const [users, terminals, branches, accounts] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "terminals"), nameMap(s.ctx, "branches"), nameMap(s.ctx, "financial_accounts")]);
  const company = await store.get("companies", m.companyId);
  const label = CASH_MOVEMENT_LABEL[m.type] ?? m.type;
  return (
    <div className="flex flex-col items-center gap-4">
      <PrintStyles paper="80mm" />
      <div className="no-print flex gap-2">
        <AutoPrint enabled={print === "1"} />
        <LinkButton href={`/caixa/${session.id}?tab=movimentos`}>Voltar à sessão</LinkButton>
      </div>
      <article className="print-doc w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-black shadow">
        <p className="text-center text-[13px] font-bold">{company?.tradeName || company?.name}</p>
        <p className="text-center">{branches.get(m.branchId)}</p>
        <p className="my-1 border-y border-dashed border-black py-1 text-center font-bold uppercase">Comprovante de {label}</p>
        <p>Movimento nº {m.number || "—"} · {formatDateTime(m.occurredAt)}</p>
        <p>Caixa nº {session.number} · {terminals.get(session.terminalId)} (versão {m.sessionVersion ?? 1})</p>
        <p>Operador: {users.get(m.createdBy) ?? "—"}</p>
        <p className="mt-2 flex justify-between text-[14px] font-bold"><span>VALOR</span><span>{formatMoney(Math.abs(m.amount))}</span></p>
        <p className="mt-1">Motivo: {m.reason}</p>
        {m.type !== "opening" && <p>{m.type === "withdrawal" ? "Destino" : "Origem"}: {m.accountId ? `${accounts.get(m.accountId)} (transferência entre contas)` : "numerário físico / cofre"}</p>}
        {m.recipient && <p>Responsável pela conferência: {m.recipient}</p>}
        {m.approvedBy && <p>Autorizado por: {users.get(m.approvedBy)}</p>}
        {m.notes && <p>Obs.: {m.notes}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 text-center">
          <p className="border-t border-black pt-1">Operador</p>
          <p className="border-t border-black pt-1">Responsável</p>
        </div>
        <p className="mt-2 text-center text-[9px]">Sangria não reduz faturamento; suprimento não é venda. Impresso em {formatDateTime(new Date().toISOString())}</p>
      </article>
    </div>
  );
}
