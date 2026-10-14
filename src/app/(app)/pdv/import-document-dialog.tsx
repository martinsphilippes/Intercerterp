"use client";

import { useEffect, useState, useTransition } from "react";
import { FileInput, Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { billableDocumentsAction, documentLinesAction } from "./actions";

type DocRow = { id: string; type: "quote" | "order"; number: number; status: string; customerName: string | null; total: number; validUntil: string | null; createdAt: string; itemsCount: number; invoicedQtyTotal: number; qtyTotal: number };
type Lines = { label: string; customerName: string | null; type: "quote" | "order"; lines: Array<{ id: string; seq: number; sku: string; name: string; unitCode: string; qty: number; invoiced: number; billable: number; unitPrice: number }> };

const STATUS: Record<string, string> = { draft: "Rascunho", sent: "Enviado", approved: "Aprovado", open: "Aberto", partial: "Parcial" };

/**
 * "Importar orçamento/pedido" (PDV-12): busca orçamentos válidos e pedidos com saldo da filial; no pedido, escolhe a
 * quantidade de cada item (faturamento parcial). O atendimento é montado no servidor com os preços do documento.
 */
export function ImportDocumentDialog({ open, onClose, initialId, onImport, busy }: { open: boolean; onClose: () => void; initialId?: string | null; onImport: (documentId: string, quantities: Record<string, number> | null) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DocRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [lines, setLines] = useState<Lines | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [loading, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      start(async () => {
        const r = await billableDocumentsAction(q);
        if (!r.ok) return setError(r.error);
        setError(null);
        setRows((r.data ?? []) as DocRow[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open || !selected) return;
    start(async () => {
      const r = await documentLinesAction(selected);
      if (!r.ok) {
        setError(r.error);
        setSelected(null);
        return;
      }
      const d = r.data as Lines;
      setLines(d);
      setQty(Object.fromEntries(d.lines.map((l) => [l.id, l.billable])));
    });
  }, [selected, open]);

  const close = () => {
    setSelected(null);
    setLines(null);
    onClose();
  };
  const totalQty = Object.values(qty).reduce((a, v) => a + v, 0);
  const partial = lines?.lines.some((l) => (qty[l.id] ?? 0) !== l.billable) ?? false;
  return (
    <Dialog open={open} onClose={close} title={lines ? `Importar ${lines.label}` : "Importar orçamento ou pedido"} size="lg">
      {!selected || !lines ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" placeholder="Nº do orçamento/pedido ou nome do cliente" aria-label="Buscar orçamento ou pedido" />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{loading ? "Buscando…" : "Nenhum orçamento válido ou pedido com saldo nesta filial."}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelected(r.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50">
                    <span>
                      <span className="font-medium">{r.type === "quote" ? "Orçamento" : "Pedido"} nº {r.number}</span> <Badge tone={r.type === "quote" ? "brand" : "info"}>{STATUS[r.status] ?? r.status}</Badge>
                      <span className="block text-xs text-slate-500">
                        {r.customerName ?? "Sem cliente"} · {r.itemsCount} itens{r.type === "quote" && r.validUntil ? ` · válido até ${formatDate(r.validUntil)}` : ""}{r.type === "order" && r.invoicedQtyTotal ? ` · faturado ${formatQty(r.invoicedQtyTotal)} de ${formatQty(r.qtyTotal)}` : ""}
                      </span>
                    </span>
                    <span className="tabular font-semibold">{formatMoney(r.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{lines.customerName ?? "Sem cliente"} · preços e descontos do documento. {lines.type === "order" ? "Informe quanto faturar agora de cada item (o restante continua no pedido)." : "A venda converte o orçamento."}</p>
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>#</th><th>Produto</th><th className="text-right">Pedido</th>{lines.type === "order" && <th className="text-right">Faturado</th>}<th className="w-32 text-right">Faturar agora</th></tr>
              </thead>
              <tbody>
                {lines.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="tabular text-slate-500">{l.seq}</td>
                    <td>{l.name}<span className="block text-xs text-slate-500">{l.sku} · {formatMoney(l.unitPrice)}</span></td>
                    <td className="tabular text-right">{formatQty(l.qty, l.unitCode)}</td>
                    {lines.type === "order" && <td className="tabular text-right">{l.invoiced ? formatQty(l.invoiced) : "—"}</td>}
                    <td>
                      {lines.type === "order" ? (
                        l.billable > 0 ? <QtyInput value={qty[l.id] ?? 0} min={0} onChange={(v) => setQty((m) => ({ ...m, [l.id]: Math.min(Math.max(0, v), l.billable) }))} ariaLabel={`Quantidade a faturar de ${l.name}`} /> : <span className="block text-right text-xs text-slate-400">sem saldo</span>
                      ) : (
                        <span className="block text-right tabular">{formatQty(l.qty)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => { setSelected(null); setLines(null); }}>Voltar à lista</Button>
            <Button variant="primary" loading={busy} disabled={lines.type === "order" && totalQty <= 0} onClick={() => onImport(selected, lines.type === "order" && partial ? qty : null)}>
              <FileInput className="size-4" /> Importar no atendimento
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
