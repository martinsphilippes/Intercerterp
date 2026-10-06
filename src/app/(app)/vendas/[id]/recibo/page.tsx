import { notFound } from "next/navigation";
import { canViewBranch } from "../../queries";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { nameMap } from "@/lib/server/lookups";
import { LinkButton } from "@/components/ui/button";
import { AutoPrint } from "../../sale-widgets";
import { PrintStyles } from "../../print-styles";
import { MODEL_NAME } from "../../labels";
import { DOC_STATUS_LABEL } from "@/domain/fiscal/service";

export const metadata = { title: "Recibo da venda" };

/** Recibo (comprovante não fiscal) para impressora térmica 80 mm via navegador. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const s = await requireSession("sales");
  const { id } = await params;
  const { print } = await searchParams;
  const store = s.ctx.store;
  const sale = await store.get("sales", id);
  if (!sale || sale.companyId !== s.ctx.companyId || !canViewBranch(s.ctx, sale.branchId)) notFound();
  const [items, payments, users, terminals] = await Promise.all([
    listAll(store, "sale_items", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    listAll(store, "sale_payments", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] }),
    nameMap(s.ctx, "users"),
    nameMap(s.ctx, "terminals"),
  ]);
  const company = await store.get("companies", sale.companyId);
  const branch = await store.get("branches", sale.branchId);
  const doc = sale.fiscalDocumentId ? await store.get("fiscal_documents", sale.fiscalDocumentId) : null;
  const installments = payments.some((p) => p.titleId && ["crediario", "boleto"].includes(p.methodKind)) ? await listAll(store, "installments", { filters: [["eq", "titleId", payments.filter((p) => ["crediario", "boleto"].includes(p.methodKind)).map((p) => p.titleId)]], orderBy: [{ field: "dueDate" }] }) : [];
  const c = sale.customerSnapshot;
  const addr = branch?.address;
  return (
    <div className="flex flex-col items-center gap-4">
      <PrintStyles paper="80mm" />
      <div className="no-print flex gap-2">
        <AutoPrint enabled={print === "1"} />
        <LinkButton href={`/vendas/${id}`}>Voltar à venda</LinkButton>
      </div>
      <article className="print-doc w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-black shadow" aria-label="Recibo">
        <header className="text-center">
          <p className="text-[13px] font-bold">{company?.tradeName || company?.name}</p>
          <p>{company?.name}</p>
          <p>CNPJ {formatDoc(branch?.cnpj ?? company?.cnpj)} {branch?.ie ? `IE ${branch.ie}` : ""}</p>
          {addr && <p>{addr.street}, {addr.number} — {addr.district} — {addr.cityName}/{addr.uf}</p>}
          <p className="mt-1 border-y border-dashed border-black py-1 font-bold">COMPROVANTE DE VENDA — NÃO É DOCUMENTO FISCAL</p>
        </header>
        <p className="mt-1">Venda nº {sale.number} · {formatDateTime(sale.completedAt)}</p>
        <p>{branch?.name} · {sale.terminalId ? terminals.get(sale.terminalId) : ""} · Op.: {users.get(sale.operatorId) ?? "—"}</p>
        <p>Cliente: {c ? `${c.name}${c.doc ? " — " + formatDoc(c.doc) : ""}` : "Consumidor final"}</p>
        {sale.origin === "exchange" && <p>Troca: vale da devolução aplicado no pagamento.</p>}
        {sale.status === "cancelled" && <p className="my-1 border border-black p-1 text-center font-bold">VENDA CANCELADA em {formatDateTime(sale.cancelledAt)}</p>}
        <table className="mt-2 w-full">
          <thead>
            <tr className="border-b border-dashed border-black"><th className="text-left">Item</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="py-0.5 pr-1">
                  {String(i.seq).padStart(3, "0")} {i.description}
                  <br />
                  {formatQty(i.qty)} {i.unitCode} × {formatMoney(i.unitPrice)}
                  {i.itemDiscount + i.globalDiscount > 0 ? ` (−${formatMoney(i.itemDiscount + i.globalDiscount)})` : ""}
                  {i.surcharge > 0 ? ` (+${formatMoney(i.surcharge)})` : ""}
                </td>
                <td className="py-0.5 text-right">{formatMoney(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 border-t border-dashed border-black pt-1">
          <p className="flex justify-between"><span>Subtotal</span><span>{formatMoney(sale.subtotal)}</span></p>
          {sale.discountTotal > 0 && <p className="flex justify-between"><span>Descontos</span><span>−{formatMoney(sale.discountTotal)}</span></p>}
          {sale.surchargeTotal > 0 && <p className="flex justify-between"><span>Acréscimos</span><span>+{formatMoney(sale.surchargeTotal)}</span></p>}
          <p className="flex justify-between text-[13px] font-bold"><span>TOTAL</span><span>{formatMoney(sale.total)}</span></p>
        </div>
        <div className="mt-1 border-t border-dashed border-black pt-1">
          {payments.map((p) => (
            <p key={p.id} className="flex justify-between">
              <span>{p.methodName}{p.installments > 1 ? ` ${p.installments}x` : ""}{p.nsu ? ` NSU ${p.nsu}` : ""}</span>
              <span>{formatMoney(p.methodKind === "cash" ? p.received : p.amount)}</span>
            </p>
          ))}
          {sale.changeAmount > 0 && <p className="flex justify-between font-bold"><span>Troco</span><span>{formatMoney(sale.changeAmount)}</span></p>}
        </div>
        {installments.length > 0 && (
          <div className="mt-1 border-t border-dashed border-black pt-1">
            <p className="font-bold">Parcelas a prazo</p>
            {installments.map((i) => <p key={i.id} className="flex justify-between"><span>{i.number}ª — venc. {formatDate(i.dueDate)}</span><span>{formatMoney(i.amount)}</span></p>)}
            <p className="mt-3 border-t border-black pt-1 text-center">Assinatura do cliente</p>
          </div>
        )}
        <footer className="mt-2 border-t border-dashed border-black pt-1 text-center">
          {doc ? (
            <p>
              {MODEL_NAME[doc.model] ?? doc.model} {doc.number ? `nº ${doc.number} série ${doc.series}` : ""} — {doc.status === "authorized" ? "autorizada" : `situação: ${DOC_STATUS_LABEL[doc.status] ?? doc.status}`}
              {doc.isSimulated ? " (SIMULAÇÃO, sem validade fiscal)" : ""}
              {doc.accessKey && <span className="block break-all">Chave: {doc.accessKey.replace(/(\d{4})(?=\d)/g, "$1 ")}</span>}
            </p>
          ) : (
            <p>Sem documento fiscal vinculado.</p>
          )}
          <p className="mt-1">Obrigado pela preferência!</p>
          <p className="text-[9px]">Impresso em {formatDateTime(new Date().toISOString())}</p>
        </footer>
      </article>
    </div>
  );
}
