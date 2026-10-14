import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { ORDER_STATUS_LABEL, QUOTE_STATUS_LABEL } from "@/domain/sales-documents";

type Rec = Record<string, any>;

/**
 * Folha A4 do orçamento/pedido (impressão `?print=1` e link público enviado ao cliente). Somente dados comerciais:
 * sem custo, margem, observações internas ou reservas.
 */
export function DocumentSheet({ doc, items, company, branch, sellerName, termName }: { doc: Rec; items: Rec[]; company: Rec | null; branch: Rec | null; sellerName: string | null; termName: string | null }) {
  const quote = doc.type === "quote";
  const c = doc.customerSnapshot ?? {};
  const addr = branch?.address ?? company?.address;
  const caddr = c.address;
  const status = quote ? QUOTE_STATUS_LABEL[doc.status] : ORDER_STATUS_LABEL[doc.status];
  const inactive = ["cancelled", "rejected", "expired"].includes(doc.status);
  return (
    <article className="print-doc mx-auto w-full max-w-[210mm] bg-white p-6 text-[12px] leading-snug text-black shadow sm:p-8" aria-label={quote ? "Orçamento" : "Pedido de venda"}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          <p className="text-lg font-bold">{company?.tradeName || company?.name}</p>
          <p>{company?.name}</p>
          <p>CNPJ {formatDoc(branch?.cnpj ?? company?.cnpj)}{branch?.ie ? ` · IE ${branch.ie}` : ""}</p>
          {addr && <p>{addr.street}, {addr.number} — {addr.district} — {addr.cityName}/{addr.uf}</p>}
          {(branch?.phone || company?.phone) && <p>Telefone {formatPhone(branch?.phone ?? company?.phone)}{company?.email ? ` · ${company.email}` : ""}</p>}
        </div>
        <div className="text-right">
          <p className="text-xl font-bold uppercase">{quote ? "Orçamento" : "Pedido de venda"}</p>
          <p className="text-base font-semibold">nº {doc.number}</p>
          <p>Emitido em {formatDateTime(doc.createdAt)}</p>
          {quote && doc.validUntil && <p className="font-semibold">Válido até {formatDate(doc.validUntil)}</p>}
          {doc.deliveryDate && <p>Previsão de entrega {formatDate(doc.deliveryDate)}</p>}
          <p>Situação: {status}</p>
        </div>
      </header>
      {inactive && <p className="my-2 border border-black p-1 text-center font-bold uppercase">{quote ? `Orçamento ${status}` : "Pedido cancelado"}</p>}
      <section className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase text-slate-600">Cliente</p>
          <p className="font-semibold">{c.name ?? "—"}</p>
          {c.doc && <p>{String(c.doc).length > 11 ? "CNPJ" : "CPF"} {formatDoc(c.doc)}{c.ie ? ` · IE ${c.ie}` : ""}</p>}
          {caddr && <p>{caddr.street}, {caddr.number} — {caddr.district} — {caddr.cityName}/{caddr.uf}</p>}
          {(c.phone || c.email) && <p>{c.phone ? formatPhone(c.phone) : ""}{c.phone && c.email ? " · " : ""}{c.email ?? ""}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-[10px] font-semibold uppercase text-slate-600">Atendimento</p>
          <p>Vendedor: {sellerName ?? "—"}</p>
          <p>Condição: {termName ?? "—"}{doc.paymentNotes ? ` · ${doc.paymentNotes}` : ""}</p>
        </div>
      </section>
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Produto</th>
            <th className="py-1 pr-2 text-right">Qtd.</th>
            <th className="py-1 pr-2 text-right">Unitário</th>
            <th className="py-1 pr-2 text-right">Desconto</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-slate-300 align-top">
              <td className="py-1 pr-2">{i.seq}</td>
              <td className="py-1 pr-2">{i.description}<span className="block text-[10px] text-slate-600">{i.sku}</span></td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatQty(i.qty, i.unitCode)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(i.unitPrice)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{(i.itemDiscount ?? 0) + (i.globalDiscount ?? 0) > 0 ? formatMoney((i.itemDiscount ?? 0) + (i.globalDiscount ?? 0)) : "—"}</td>
              <td className="py-1 text-right tabular-nums">{formatMoney(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-3 w-full max-w-xs space-y-0.5">
        <p className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatMoney(doc.subtotal)}</span></p>
        {(doc.discountTotal ?? 0) > 0 && <p className="flex justify-between"><span>Descontos</span><span className="tabular-nums">− {formatMoney(doc.discountTotal)}</span></p>}
        {(doc.surchargeTotal ?? 0) > 0 && <p className="flex justify-between"><span>Acréscimos / frete</span><span className="tabular-nums">+ {formatMoney(doc.surchargeTotal)}</span></p>}
        <p className="flex justify-between border-t border-black pt-1 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(doc.total)}</span></p>
      </div>
      {doc.notes && (
        <section className="mt-4">
          <p className="text-[10px] font-semibold uppercase text-slate-600">Observações</p>
          <p className="whitespace-pre-line">{doc.notes}</p>
        </section>
      )}
      <footer className="mt-8 grid gap-8 text-center text-[11px] sm:grid-cols-2">
        <div className="border-t border-black pt-1">{company?.tradeName || company?.name}</div>
        <div className="border-t border-black pt-1">{quote ? "De acordo do cliente" : "Recebido por (cliente)"}</div>
      </footer>
      <p className="mt-4 text-center text-[10px] text-slate-600">{quote ? "Orçamento sem valor fiscal. Preços e disponibilidade válidos até a data indicada." : "Pedido de venda sem valor fiscal — o documento fiscal é emitido no faturamento."}</p>
    </article>
  );
}
