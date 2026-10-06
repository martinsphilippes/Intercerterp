import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

export const METHOD_LABEL: Record<string, string> = { cash: "Dinheiro", debit: "Cartão de débito", credit: "Cartão de crédito", pix: "Pix", store_credit: "Vale-crédito", crediario: "Crediário", boleto: "Boleto", voucher: "Voucher", other: "Outros" };
const CHECK_LABEL: Record<string, string> = { cashCounted: "Dinheiro contado", cardsReconciled: "Cartões conferidos", pixReconciled: "Pix conferido", cashDelivered: "Numerário entregue", cardReportPrinted: "Relatório da maquininha", pixConferred: "Pix conferido" };

/** Tabela de conferência (uma versão de fechamento): esperado × informado × diferença por meio. */
export function ClosureTable({ expected, counted, differences }: { expected: Record<string, number>; counted: Record<string, number>; differences: Record<string, number> }) {
  const keys = [...new Set([...Object.keys(expected ?? {}), ...Object.keys(counted ?? {})])].sort((a, b) => (a === "cash" ? -1 : b === "cash" ? 1 : a.localeCompare(b)));
  const te = keys.reduce((a, k) => a + (expected?.[k] ?? 0), 0);
  const tc = keys.reduce((a, k) => a + (counted?.[k] ?? 0), 0);
  return (
    <table className="table-base w-full text-sm">
      <thead><tr><th>Forma</th><th className="text-right">Esperado</th><th className="text-right">Informado</th><th className="text-right">Diferença</th></tr></thead>
      <tbody>
        {keys.map((k) => {
          const d = differences?.[k] ?? 0;
          return (
            <tr key={k}>
              <td>{METHOD_LABEL[k] ?? k}</td>
              <td className="tabular text-right">{formatMoney(expected?.[k] ?? 0)}</td>
              <td className="tabular text-right">{formatMoney(counted?.[k] ?? 0)}</td>
              <td className={`tabular text-right font-medium ${d === 0 ? "text-emerald-700" : "text-red-700"}`}>{d > 0 ? "+" : ""}{formatMoney(d)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="bg-slate-50 font-semibold"><td className="px-3 py-2">Total</td><td className="tabular px-3 py-2 text-right">{formatMoney(te)}</td><td className="tabular px-3 py-2 text-right">{formatMoney(tc)}</td><td className={`tabular px-3 py-2 text-right ${tc - te === 0 ? "text-emerald-700" : "text-red-700"}`}>{formatMoney(tc - te)}</td></tr>
      </tfoot>
    </table>
  );
}

function diffText(d: Record<string, number> | null | undefined) {
  if (!d) return ""; // contagens registradas antes do registro de diferença por contagem
  const parts = Object.entries(d ?? {}).filter(([, v]) => v !== 0).map(([k, v]) => `${METHOD_LABEL[k] ?? k} ${v > 0 ? "+" : ""}${formatMoney(v)}`);
  return parts.length ? `, diferença ${parts.join(", ")}` : ", sem diferença";
}

/** Versões de conferência e reaberturas (histórico preservado da sessão). */
export function SessionVersions({ history }: { history: any[] }) {
  if (!history?.length) return <p className="text-sm text-slate-500">Sem eventos.</p>;
  return (
    <ol className="space-y-4">
      {history.map((h, i) => (
        <li key={i} className="rounded-md border border-line p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {h.event === "opened" && <Badge tone="info">Abertura</Badge>}
            {h.event === "closed" && <Badge tone={Object.keys(h.differences ?? {}).length ? "bad" : "good"}>Fechamento — versão {h.version}</Badge>}
            {h.event === "reopened" && <Badge tone="warn">Reabertura (versão {h.previousVersion} → {h.previousVersion + 1})</Badge>}
            <span className="text-slate-600">{formatDateTime(h.at)} · {h.by}</span>
            {h.blind && <Badge>conferência cega</Badge>}
          </p>
          {h.reason && <p className="mt-1 text-sm text-slate-600">Motivo: {h.reason}</p>}
          {h.event === "closed" && (
            <div className="mt-2 space-y-2">
              <ClosureTable expected={h.expected} counted={h.counted} differences={h.differences} />
              {h.justification && <p className="text-sm text-slate-700">Justificativa: {h.justification}</p>}
              {Array.isArray(h.blindCount?.superseded) && h.blindCount.superseded.length > 0 && (
                <p className="text-xs text-amber-800">
                  Contagem cega refeita por vendas/movimentos posteriores — contagens anteriores preservadas:{" "}
                  {h.blindCount.superseded.map((c: any) => `${formatDateTime(c.at)} ${c.byName ?? ""}: dinheiro ${formatMoney(c.counted?.cash ?? 0)}${c.expected ? ` (previsto então ${formatMoney(c.expected.cash ?? 0)})` : ""}${diffText(c.differences)}`).join("; ")}.
                </p>
              )}
              {h.blindCount?.kept && Object.keys(h.blindCount.kept).length > 0 && (
                <p className="text-xs text-red-800">
                  A recontagem não reduz diferença já revelada — valores informados na última contagem:{" "}
                  {Object.entries(h.blindCount.kept as Record<string, { previousDifference: number; informed: number; informedDifference: number }>)
                    .map(([k, v]) => `${METHOD_LABEL[k] ?? k} ${formatMoney(v.informed)} (diferença ${v.informedDifference > 0 ? "+" : ""}${formatMoney(v.informedDifference)}); mantida ${v.previousDifference > 0 ? "+" : ""}${formatMoney(v.previousDifference)}`)
                    .join("; ")}.
                </p>
              )}
              {h.checklist && <p className="text-xs text-slate-500">Conferências: {Object.entries(h.checklist).map(([k, v]) => `${CHECK_LABEL[k] ?? k} ${v ? "✓" : "✗"}`).join(" · ")}</p>}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
