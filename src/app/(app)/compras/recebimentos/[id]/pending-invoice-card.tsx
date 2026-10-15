import Link from "@/components/ui/link";
import { CalendarClock, FileClock, FileCheck2 } from "lucide-react";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { ActionButton } from "@/components/ui/action-form";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { Doc } from "@/lib/db/types";
import type { ReceiptItem } from "@/domain/receipts";
import { pendingState } from "@/domain/pending-invoice";
import { cancelScheduledAction } from "../actions";
import { InvoiceConfirm } from "./invoice-confirm";

/**
 * Quadro da entrada com nota a confirmar (§40) no recebimento: situação (prevista, aguardando nota, vencida, nota
 * confirmada), prazo, conta a pagar e a ação "Confirmar com a nota" (ou o resumo da confirmação). A nota pode ser
 * confirmada também na entrada PREVISTA (antes da data): substitui o previsto, sem estoque nem ajuste de custo.
 */
export function PendingInvoiceCard({ r, title, leadDays, canConfirm, canCancel, canReturn, users, realizeError }: { r: Doc; title: Doc | null; leadDays: number; canConfirm: boolean; canCancel: boolean; canReturn: boolean; users: Map<string, string>; realizeError: string | null }) {
  const st = pendingState(r, undefined, leadDays);
  const items: ReceiptItem[] = (r.items ?? []).filter((i: ReceiptItem) => !i.ignore && i.skuId);
  const conf = r.invoiceConfirmation;
  const scheduled = r.status === "scheduled";
  const confirmed = r.documentStatus === "confirmed";
  const Icon = confirmed ? FileCheck2 : scheduled ? CalendarClock : FileClock;
  const returnHref = canReturn ? `/fiscal/nfe/nova?origem=receipt:${r.id}` : null;
  return (
    <Card
      className="mb-5"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="size-5 text-brand-700" aria-hidden /> {confirmed ? (scheduled ? "Entrada prevista — nota confirmada" : "Entrada confirmada com a nota") : scheduled ? "Entrada prevista — nota a confirmar" : "Entrada aguardando a nota do fornecedor"}
        </span>
      }
      actions={<Badge tone={st.tone}>{st.label}</Badge>}
      description={
        confirmed
          ? scheduled
            ? "A nota foi confirmada antes da chegada: quantidades, custos e conta a pagar (ainda PREVISTA) já estão pelos valores da nota. Na data/hora da entrada, a rotina diária — ou a abertura deste recebimento — realiza a entrada pelo custo da nota (sem ajuste de custo). A entrada prevista ainda pode ser cancelada; a nota fica no histórico."
            : undefined
          : scheduled
            ? "A mercadoria ainda não chegou: nada foi lançado no estoque nem no custo médio. A quantidade aparece como “a chegar” nos saldos e a conta a pagar como PREVISTA (fluxo de caixa previsto; não pode ser baixada). Na data/hora da entrada, a rotina diária — ou a abertura deste recebimento — realiza a entrada."
            : "O estoque já entrou pelo custo previsto e pode ser vendido normalmente (sempre com NFC-e/NF-e). A conta a pagar é PROVISÓRIA até a nota. Quando a nota chegar, confirme abaixo: custo, quantidade e conta a pagar são corrigidos pela nota."
      }
    >
      {realizeError && <Notice tone="bad" title="A entrada não pôde ser realizada">{realizeError}</Notice>}
      <DefinitionList
        cols={4}
        items={[
          { label: scheduled ? "Entrada prevista para" : "Data/hora da entrada", value: formatDateTime(r.entryAt) },
          { label: "Prazo para a nota", value: r.invoiceDueAt ? `${formatDate(r.invoiceDueAt)}${!confirmed && st.daysToDue != null ? ` (${st.daysToDue < 0 ? `vencido há ${-st.daysToDue} dia(s)` : st.daysToDue === 0 ? "vence hoje" : `faltam ${st.daysToDue} dia(s)`})` : ""}` : "—" },
          { label: confirmed ? "Nota confirmada em" : "Dias em aberto", value: confirmed ? `${formatDateTime(r.invoiceConfirmedAt)} por ${users.get(r.invoiceConfirmedBy) ?? "—"}` : scheduled ? "—" : `${st.daysOpen} dia(s)` },
          {
            label: "Conta a pagar",
            value: title ? (
              <Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${title.id}`}>
                nº {title.number} · {formatMoney(title.total)} {title.forecast ? <Badge tone="info">{title.provisional ? "Prevista" : "Prevista · valor da nota"}</Badge> : title.provisional ? <Badge tone="warn">Provisória</Badge> : <Badge tone="good">Pelo valor da nota</Badge>}
              </Link>
            ) : (
              "—"
            ),
          },
        ]}
      />
      {scheduled && canCancel && (
        <div className="mt-4 flex justify-end">
          <ActionButton variant="danger" action={cancelScheduledAction.bind(null, r.id)} label="Cancelar entrada prevista" askReason="Motivo do cancelamento da entrada prevista:" />
        </div>
      )}
      {!confirmed && (scheduled || r.status === "confirmed") && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">Confirmar com a nota</h3>
          {scheduled && <p className="mb-3 text-xs text-slate-600">A nota já chegou? Confirme antes da entrada: as quantidades e custos previstos e a conta a pagar prevista passam a ser os da nota. Nada entra no estoque agora — na data, a entrada é realizada pelos valores da nota.</p>}
          {canConfirm ? (
            <InvoiceConfirm
              receiptId={r.id}
              scheduled={scheduled}
              defaults={{ nfeNumber: r.nfeNumber ?? null, nfeSeries: r.nfeSeries ?? null, nfeKey: r.nfeKey ?? null }}
              returnHref={returnHref}
              items={items.map((i) => ({ idx: i.idx, description: i.description, sku: i.sku ?? null, unitCode: i.unitCode ?? null, qty: i.receivedQty, unitCost: i.landedUnitCost ?? i.unitCost, lineUnitCost: i.unitCost }))}
            />
          ) : (
            <p className="text-sm text-slate-600">Somente quem tem a permissão “Confirmar com a nota e aprovar divergências”, na filial do recebimento, confirma a nota.</p>
          )}
        </div>
      )}
      {confirmed && conf && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            {conf.scheduled ? "Confirmada antes da entrada · " : ""}{conf.source === "xml" ? "XML importado" : "Dados informados"} · NF-e {conf.doc?.number}
            {conf.doc?.series ? `/${conf.doc.series}` : ""} · emissão {formatDate(conf.doc?.issueDate)} · conta a pagar {formatMoney(conf.previousPayable)} → <strong>{formatMoney(conf.payable)}</strong>
          </p>
          <div className="-mx-5 overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Produto</th><th className="text-right">{conf.scheduled ? "Previsto" : "Entrou"}</th><th className="text-right">Nota</th><th className="text-right">Custo previsto → nota</th><th className="text-right">Ajuste no custo médio</th><th className="text-right">Não absorvido (já vendido)</th><th>Quantidade</th></tr></thead>
              <tbody>
                {(conf.lines ?? []).map((l: any) => {
                  const res = (conf.results ?? []).find((x: any) => x.idx === l.idx);
                  return (
                    <tr key={l.idx}>
                      <td>{l.description}</td>
                      <td className="tabular text-right">{formatQty(l.enteredQty)}</td>
                      <td className="tabular text-right">{l.inNote ? formatQty(l.noteQty) : "não consta"}</td>
                      <td className="tabular text-right">{formatMoney(l.enteredUnitCost)} → {l.inNote ? formatMoney(l.noteLandedUnitCost) : "—"}</td>
                      <td className="tabular text-right">{res?.absorbed ? formatMoney(res.absorbed) : "—"}</td>
                      <td className="tabular text-right">{res?.notAbsorbed ? formatMoney(res.notAbsorbed) : "—"}</td>
                      <td>{l.qtyDiff === 0 ? "Confere" : conf.scheduled ? "Previsto atualizado pela nota" : l.action === "adjust" ? "Estoque ajustado" : l.action === "return" ? (returnHref ? <Link className="text-brand-700 hover:underline" href={returnHref}>Devolver ao fornecedor</Link> : "Devolução ao fornecedor") : "Mantido (justificado)"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(conf.warnings ?? []).length > 0 && <ul className="list-disc pl-4 text-xs text-amber-800">{conf.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>}
        </div>
      )}
    </Card>
  );
}
