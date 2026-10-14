import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { formatBps, formatMoney } from "@/lib/money";

/** Linha de prévia de preço (espelha `PriceLine` de src/domain/price-adjust.ts, serializável). */
export interface PreviewRow {
  skuId: string;
  sku: string;
  name: string;
  cost: number | null;
  currentPrice: number | null;
  newPrice: number | null;
  marginBefore: number | null;
  marginAfter: number | null;
  variationBps: number | null;
  status: "change" | "same" | "skip" | "error";
  message: string | null;
  warning: string | null;
}

export interface ApplyRow {
  skuId: string;
  sku: string;
  name: string;
  oldPrice: number | null;
  newPrice: number;
  status: "applied" | "same" | "skipped" | "error";
  message: string | null;
}

const STATUS: Record<PreviewRow["status"], [string, "good" | "neutral" | "warn" | "bad"]> = { change: ["Altera", "good"], same: ["Sem mudança", "neutral"], skip: ["Ignorado", "warn"], error: ["Erro", "bad"] };
const RESULT: Record<ApplyRow["status"], [string, "good" | "neutral" | "warn" | "bad"]> = { applied: ["Aplicado", "good"], same: ["Sem mudança", "neutral"], skipped: ["Ignorado", "warn"], error: ["Erro", "bad"] };

export function Variation({ bps }: { bps: number | null }) {
  if (bps == null) return <span className="text-slate-400">—</span>;
  return <span className={cn("tabular", bps > 0 ? "text-emerald-700" : bps < 0 ? "text-red-700" : "text-slate-500")}>{bps > 0 ? "+" : ""}{formatBps(bps, 1)}</span>;
}

export function MarginCell({ bps }: { bps: number | null }) {
  if (bps == null) return <span className="text-slate-400">—</span>;
  return <span className={cn("tabular", bps < 0 ? "font-semibold text-red-700" : bps < 1000 ? "text-amber-700" : "")}>{formatBps(bps, 1)}</span>;
}

/** Tabela de prévia (nada gravado ainda): preço atual, custo, novo preço, margem antes/depois e variação. */
export function PricePreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="max-h-[520px] overflow-auto rounded-md border border-line">
      <table className="table-base w-full text-sm">
        <thead className="sticky top-0">
          <tr>
            <th>Produto</th>
            <th className="text-right">Custo</th>
            <th className="text-right">Preço atual</th>
            <th className="text-right">Novo preço</th>
            <th className="text-right">Variação</th>
            <th className="text-right">Margem antes</th>
            <th className="text-right">Margem depois</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.skuId}>
              <td>
                {r.name}
                <span className="block font-mono text-xs text-slate-500">{r.sku}</span>
              </td>
              <td className="tabular text-right">{formatMoney(r.cost)}</td>
              <td className="tabular text-right">{r.currentPrice == null ? <span className="text-amber-700">Sem preço</span> : formatMoney(r.currentPrice)}</td>
              <td className="tabular text-right font-semibold">{formatMoney(r.newPrice)}</td>
              <td className="text-right"><Variation bps={r.variationBps} /></td>
              <td className="text-right"><MarginCell bps={r.marginBefore} /></td>
              <td className="text-right"><MarginCell bps={r.marginAfter} /></td>
              <td>
                <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                {(r.message || r.warning) && <span className="mt-0.5 block max-w-xs text-xs text-slate-600">{[r.warning, r.message].filter(Boolean).join(" ")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Resultado da aplicação, linha a linha. */
export function ApplyResultTable({ rows }: { rows: ApplyRow[] }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-line">
      <table className="table-base w-full text-sm">
        <thead className="sticky top-0">
          <tr><th>Produto</th><th className="text-right">Preço anterior</th><th className="text-right">Novo preço</th><th>Resultado</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.skuId}>
              <td>{r.name}<span className="block font-mono text-xs text-slate-500">{r.sku}</span></td>
              <td className="tabular text-right">{formatMoney(r.oldPrice)}</td>
              <td className="tabular text-right font-semibold">{formatMoney(r.newPrice)}</td>
              <td>
                <Badge tone={RESULT[r.status][1]}>{RESULT[r.status][0]}</Badge>
                {r.message && <span className="mt-0.5 block max-w-xs text-xs text-slate-600">{r.message}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function previewSummary(t: { change: number; same: number; skip: number; error: number; belowCost?: number }) {
  return [
    `${t.change} preço(s) a alterar`,
    t.same ? `${t.same} sem mudança` : null,
    t.skip ? `${t.skip} ignorado(s)` : null,
    t.error ? `${t.error} com erro (não serão gravados)` : null,
    t.belowCost ? `${t.belowCost} abaixo do custo` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
