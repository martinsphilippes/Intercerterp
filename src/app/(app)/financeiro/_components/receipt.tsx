import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import type { SessionInfo } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import type { TitleKind } from "@/domain/finance";
import { titleDetail } from "../queries";
import { PrintButton } from "./print-button";

/** Recibo (a receber) / comprovante de pagamento (a pagar) das baixas ativas do título — para impressão. */
export async function TitleReceipt({ s, kind, id, installmentId, settlementId }: { s: SessionInfo; kind: TitleKind; id: string; installmentId?: string; settlementId?: string }) {
  const d = await titleDetail(s.ctx, id);
  if (!d || d.title.kind !== kind) notFound();
  const t = d.title;
  const rec = kind === "receivable";
  const base = rec ? "/financeiro/receber" : "/financeiro/pagar";
  const list = d.settlements.filter((x) => x.kind === "settlement" && x.status === "active" && (!installmentId || x.installmentId === installmentId) && (!settlementId || x.id === settlementId));
  const company = await s.ctx.store.getOrThrow("companies", s.ctx.companyId);
  const party = t.partyType === "customer" && t.partyId ? await s.ctx.store.get("customers", t.partyId) : t.partyType === "supplier" && t.partyId ? await s.ctx.store.get("suppliers", t.partyId) : null;
  const total = list.reduce((a, x) => a + x.total, 0);
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={rec ? "Recibo de recebimento" : "Comprovante de pagamento"}
          crumbs={[{ label: rec ? "Contas a receber" : "Contas a pagar", href: base }, { label: `nº ${t.number}`, href: `${base}/${id}` }, { label: rec ? "Recibo" : "Comprovante" }]}
          actions={<PrintButton />}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState title="Nenhuma baixa ativa para emitir" action={<Link className="text-brand-700 underline" href={`${base}/${id}`}>Voltar ao título</Link>} />
      ) : (
        <article className="print-area mx-auto max-w-3xl rounded-lg border border-line bg-white p-8 text-sm">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
            <div>
              <p className="text-lg font-semibold text-ink">{company.tradeName || company.name}</p>
              <p className="text-slate-500">{company.name} · CNPJ {formatDoc(company.cnpj ?? "")}</p>
            </div>
            <div className="text-right">
              <p className="text-base font-semibold">{rec ? "RECIBO" : "COMPROVANTE DE PAGAMENTO"}</p>
              <p className="text-slate-500">Título nº {t.number}</p>
            </div>
          </header>
          <p className="mt-5 leading-relaxed">
            {rec ? (
              <>
                Recebemos de <b>{t.partyName}</b>
                {party?.doc ? ` (${formatDoc(party.doc)})` : ""} a importância de <b>{formatMoney(total)}</b>, referente a {t.description}
                {t.documentNumber ? `, documento ${t.documentNumber}` : ""}, conforme discriminado abaixo.
              </>
            ) : (
              <>
                Pagamento efetuado a <b>{t.partyName}</b>
                {party?.doc ? ` (${formatDoc(party.doc)})` : ""} no total de <b>{formatMoney(total)}</b>, referente a {t.description}
                {t.documentNumber ? `, documento ${t.documentNumber}` : ""}.
              </>
            )}
          </p>
          <table className="table-base mt-5 w-full">
            <thead>
              <tr>
                <th>Data</th>
                <th>Parcela</th>
                <th className="text-right">Principal</th>
                <th className="text-right">Desconto</th>
                <th className="text-right">Juros + multa</th>
                <th className="text-right">Total</th>
                <th>Forma / conta</th>
                <th>Referência</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{formatDate(x.date)}</td>
                  <td>{d.installments.find((i) => i.id === x.installmentId)?.number}/{t.installmentsCount}</td>
                  <td className="tabular text-right">{formatMoney(x.principal)}</td>
                  <td className="tabular text-right">{x.discount ? formatMoney(x.discount) : "—"}</td>
                  <td className="tabular text-right">{x.interest + x.fine ? formatMoney(x.interest + x.fine) : "—"}</td>
                  <td className="tabular text-right font-medium">{formatMoney(x.total)}</td>
                  <td className="text-xs">
                    {(x.methodId && d.methods.get(x.methodId)) || x.methodKind || "—"} · {x.accountId ? d.accounts.get(x.accountId) : "—"}
                  </td>
                  <td className="text-xs">{x.reference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-right">
            Saldo remanescente do título: <b>{formatMoney(t.balance)}</b>
          </p>
          <footer className="mt-12 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
            <div className="border-t border-slate-400 pt-1">{rec ? company.tradeName || company.name : t.partyName}</div>
            <div className="border-t border-slate-400 pt-1">Emitido em {formatDateTime(new Date().toISOString())} por {s.user.name}</div>
          </footer>
        </article>
      )}
    </>
  );
}
