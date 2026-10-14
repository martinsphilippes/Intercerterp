import Link from "@/components/ui/link";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import type { Doc, Store } from "@/lib/db/types";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { receiptReturnsView } from "@/domain/supplier-returns";

/** Devoluções ao fornecedor do recebimento (COM-11): NF-e emitidas e quantidade devolvida por item. */
export async function SupplierReturnsCard({ store, companyId, receipt }: { store: Store; companyId: string; receipt: Doc }) {
  const v = await receiptReturnsView(store, companyId, receipt);
  if (!v.docs.length) return null;
  return (
    <Card bodyClass="p-0" title="Devoluções ao fornecedor" description="NF-e de devolução emitidas a partir deste recebimento. Canceladas/descartadas não contam no devolvido.">
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr><th>Produto</th><th className="text-right">Recebido</th><th className="text-right">Devolvido</th><th className="text-right">Em andamento</th><th className="text-right">Restante devolvível</th></tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.idx}>
                <td>{r.description}{r.sku && <span className="block text-xs text-slate-500">{r.sku}</span>}</td>
                <td className="tabular text-right">{formatQty(r.received)}</td>
                <td className={cn("tabular text-right", r.returned > 0 && "text-red-700")}>{r.returned ? formatQty(r.returned) : "—"}</td>
                <td className="tabular text-right">{r.inProgress ? formatQty(r.inProgress) : "—"}</td>
                <td className="tabular text-right">{formatQty(r.rest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-t border-line text-sm">
        {v.docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <Link className="font-medium text-brand-700 hover:underline" href={`/fiscal/nfe/${d.id}`}>NF-e {d.number ? `nº ${d.number}` : "sem número"}</Link>
              <StatusBadge kind="fiscal" status={d.status} />
              {d.isSimulated && <Badge tone="sim">Simulação</Badge>}
              <span className="text-xs text-slate-500">{d.issuedAt ? formatDateTime(d.issuedAt) : ""}</span>
            </span>
            <span className="tabular text-xs text-slate-600">
              {formatMoney(d.total)}
              {d.abated > 0 && ` · abatido do pagar ${formatMoney(d.abated)}`}
              {d.credited > 0 && ` · crédito com o fornecedor ${formatMoney(d.credited)}`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
