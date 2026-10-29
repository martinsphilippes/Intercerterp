import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import type { Doc } from "@/lib/db/types";
import type { MaskedCascade } from "@/domain/network/cascade";

const STEPS = ["Pagamento", "Validação", "Emissão", "Download"] as const;

/** Etapa atual (1..4) de uma venda; 0 = cancelada. */
export function saleStep(r: Doc): number {
  switch (r.status) {
    case "awaiting_payment": return 1;
    case "validation": return 2;
    case "ready_to_issue": case "issuing": case "issue_failed": return 3;
    case "awaiting_authorization": case "ready_to_download": return 4;
    case "downloaded": return 5;
    default: return 0;
  }
}

/** Progresso Pagamento → Validação → Emissão → Download (compacto na lista, completo no detalhe). */
export function SaleProgress({ r, compact = false }: { r: Doc; compact?: boolean }) {
  const step = saleStep(r);
  if (step === 0) return <Badge>Cancelada</Badge>;
  const warn = r.status === "issue_failed" || (r.status === "validation" && r.validationStatus === "rejected");
  return (
    <ol aria-label="Etapas da venda" className={cn("flex items-center", compact ? "gap-1" : "flex-wrap gap-2")}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "active" : "todo";
        return (
          <li key={label} aria-current={state === "active" ? "step" : undefined} className="flex items-center gap-1" title={label}>
            <span className={cn("grid shrink-0 place-items-center rounded-full font-semibold", compact ? "size-5 text-[10px]" : "size-6 text-xs", state === "done" ? "bg-emerald-600 text-white" : state === "active" ? (warn ? "bg-amber-500 text-white" : "bg-accent-500 text-white") : "bg-slate-100 text-slate-500")}>
              {state === "done" ? <Check className="size-3" aria-hidden /> : n}
            </span>
            {!compact && <span className={cn("text-xs", state === "active" ? "font-medium text-ink" : "text-slate-500")}>{label}</span>}
            {compact && i < STEPS.length - 1 && <span className={cn("h-px w-2", n < step ? "bg-emerald-600" : "bg-slate-200")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Retrato da cascata visível a quem olha (`maskCascade`): a plataforma vê tudo (inclusive o custo AC); um nó vê o
 * próprio custo, a margem dele e dos níveis abaixo e só o NOME do pai direto.
 */
export function CascadeView({ m, labels }: { m: MaskedCascade; labels: Record<string, string> }) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Nível</th>
              <th className="px-3 py-2 text-right font-medium">Custo (paga ao de cima)</th>
              <th className="px-3 py-2 text-right font-medium">Ganha nesta venda</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {m.platform && m.acCost != null && (
              <tr>
                <td className="px-3 py-2">Intercert (custo pago à AC de 1º nível)</td>
                <td className="tabular px-3 py-2 text-right">{formatMoney(m.acCost)}</td>
                <td className="tabular px-3 py-2 text-right text-emerald-700">{m.levels[0]?.cost != null ? formatMoney(m.levels[0].cost - m.acCost) : "—"}</td>
              </tr>
            )}
            {m.hiddenAbove > 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-2 text-xs text-slate-500">{m.hiddenAbove} nível(is) acima — custos não exibidos</td>
              </tr>
            )}
            {m.levels.map((l) => (
              <tr key={l.nodeId} className={l.mine ? "bg-brand-50/50" : undefined}>
                <td className="px-3 py-2">
                  <span className="mr-2 text-xs text-slate-500">{labels[l.level] ?? l.level}</span>
                  {l.name}
                  {l.mine && <Badge tone="brand" className="ml-2">você</Badge>}
                </td>
                <td className="tabular px-3 py-2 text-right">{l.cost == null ? <span className="text-xs text-slate-400">não exibido</span> : formatMoney(l.cost)}</td>
                <td className={cn("tabular px-3 py-2 text-right", l.earns != null && l.earns < 0 ? "text-red-700" : "text-emerald-700")}>{l.earns == null ? "—" : formatMoney(l.earns)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-2">Preço final ao cliente</td>
              <td className="tabular px-3 py-2 text-right">{formatMoney(m.finalPrice)}</td>
              <td className="px-3 py-2 text-right text-xs text-slate-500">tabela {formatMoney(m.listPrice)} · mínimo {formatMoney(m.minPrice)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {m.free && <Badge tone="good">BirdID gratuito — sem cobrança</Badge>}
        {m.coupon && (
          <Badge tone="accent">
            Cupom {m.coupon.code}: −{formatMoney(m.coupon.discount)} · emitido por {m.coupon.issuerName}
            {m.coupon.belowMin > 0 ? ` (absorve ${formatMoney(m.coupon.belowMin)} abaixo do mínimo)` : ""}
            {m.coupon.capped ? " · limitado ao custo" : ""}
          </Badge>
        )}
        {m.voucher && (
          <Badge tone="info">
            {m.voucher.gift ? "Voucher presente (cliente R$ 0)" : "Voucher"} do pacote {m.voucher.packageName}
            {m.voucher.unitPrice != null ? ` · custo pré-pago ${formatMoney(m.voucher.unitPrice)}` : ""}
            {m.voucher.code ? ` · código ${m.voucher.code}` : ""}
          </Badge>
        )}
        {m.costCovered && <Badge tone="neutral">custo do vendedor já pago (não é cobrado de novo na cascata)</Badge>}
      </div>
    </div>
  );
}
