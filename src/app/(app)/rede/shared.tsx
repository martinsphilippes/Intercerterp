import "server-only";
import Link from "@/components/ui/link";
import { ChevronRight, AlertTriangle } from "lucide-react";
import type { Doc } from "@/lib/db/types";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { requireSession, type SessionInfo } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { blockedAncestor, type LevelTableRow, type PriceRow } from "@/domain/network";
import { PriceRuleForm } from "./forms";

/** Sessão das telas da rede de certificação: módulo Painel e o recurso "redeCertificacao" ligado. */
export async function requireNetworkSession(): Promise<SessionInfo> {
  const s = await requireSession("dashboard");
  await requireFeaturePage(s, "redeCertificacao");
  return s;
}

const LEVEL_TONE: Record<string, "brand" | "info" | "accent" | "neutral"> = { master: "brand", regional: "info", revenda: "accent", contador: "neutral" };

export function LevelBadge({ level, labels }: { level: string; labels: Record<string, string> }) {
  return <Badge tone={LEVEL_TONE[level] ?? "neutral"}>{labels[level] ?? level}</Badge>;
}

/** Árvore navegável (expandir/recolher com details/summary — funciona sem JavaScript e no celular). */
export function NodeTree({ nodes, all, rootId, labels, show, openAll }: { nodes: Doc[]; all: Doc[]; rootId: string | null; labels: Record<string, string>; show: Set<string>; openAll: boolean }) {
  const children = nodes.filter((n) => (n.parentNodeId ?? null) === rootId && show.has(n.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  if (!children.length) return null;
  return (
    <ul className={rootId ? "ml-3 border-l border-line pl-3" : ""}>
      {children.map((n) => {
        const kids = nodes.filter((c) => c.parentNodeId === n.id && show.has(c.id)).length;
        const blocked = blockedAncestor(all, n);
        const row = (
          <span className="flex flex-wrap items-center gap-2 py-1.5">
            <LevelBadge level={n.level} labels={labels} />
            <Link href={`/rede/${n.id}`} className="font-medium text-brand-700 hover:underline">{n.name}</Link>
            <span className="font-mono text-xs text-slate-500">{n.code}</span>
            {(n.cityName || n.uf) && <span className="text-xs text-slate-500">{[n.cityName, n.uf].filter(Boolean).join("/")}</span>}
            {n.status !== "active" && <StatusBadge kind="network_node" status={n.status} />}
            {blocked && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700" title={`${blocked.name} está ${blocked.status === "suspended" ? "suspenso" : "encerrado"}`}>
                <AlertTriangle className="size-3.5" aria-hidden /> acima {blocked.status === "suspended" ? "suspenso" : "encerrado"}
              </span>
            )}
            {kids > 0 && <span className="text-xs text-slate-400">{kids} abaixo</span>}
          </span>
        );
        return (
          <li key={n.id}>
            {kids > 0 ? (
              <details open={openAll || n.depth < 1}>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-start gap-1">
                    <ChevronRight className="mt-2.5 size-3.5 shrink-0 text-slate-400 transition-transform [details[open]>summary_&]:rotate-90" aria-hidden />
                    {row}
                  </span>
                </summary>
                <NodeTree nodes={nodes} all={all} rootId={n.id} labels={labels} show={show} openAll={openAll} />
              </details>
            ) : (
              <span className="flex items-start gap-1 pl-[18px]">{row}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Tabela de preços vigente de um nó (somente leitura). */
export function PriceTable({ rows, ownerName }: { rows: PriceRow[]; ownerName: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Produto</th>
            <th className="px-3 py-2 text-right font-medium">Custo (paga a {ownerName})</th>
            <th className="px-3 py-2 text-right font-medium">Mínimo</th>
            <th className="px-3 py-2 text-right font-medium">Padrão</th>
            <th className="px-3 py-2 text-left font-medium">Preço</th>
            <th className="px-3 py-2 text-left font-medium">Origem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.product.key}>
              <td className="px-3 py-2">{r.product.label}</td>
              {r.price ? (
                <>
                  <td className="tabular px-3 py-2 text-right">{formatMoney(r.price.cost)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatMoney(r.price.minPrice)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatMoney(r.price.defaultPrice)}</td>
                  <td className="px-3 py-2">{r.price.canEdit ? "Editável" : <Badge>fixo</Badge>}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.price.source === "node" ? "Exceção própria" : "Tabela padrão do nível"} · desde {formatDate(r.price.validFrom)}</td>
                </>
              ) : (
                <td colSpan={5} className="px-3 py-2 text-xs text-slate-500">Sem preço definido pelo parceiro acima.</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Tabela padrão por nível de um dono (nó ou plataforma): o que vale hoje, a próxima vigência e, para quem pode,
 * o formulário de alteração (com a margem da camada e o bloqueio abaixo do custo).
 */
export function LevelTableEditor({ rows, labels, ownerNodeId, ownerName, canEdit }: { rows: LevelTableRow[]; labels: Record<string, string>; ownerNodeId: string | null; ownerName: string; canEdit: boolean }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Nenhum nível abaixo.</p>;
  const levels = [...new Set(rows.map((r) => r.level))];
  return (
    <div className="space-y-4">
      {levels.map((l) => (
        <div key={l}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">Tabela padrão para <LevelBadge level={l} labels={labels} /></h3>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Produto</th>
                  <th className="px-3 py-2 text-right font-medium">Custo do filho</th>
                  <th className="px-3 py-2 text-right font-medium">Margem de {ownerName}</th>
                  <th className="px-3 py-2 text-right font-medium">Mínimo</th>
                  <th className="px-3 py-2 text-right font-medium">Padrão</th>
                  <th className="px-3 py-2 text-left font-medium">Vigência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.filter((r) => r.level === l).map((r) => (
                  <tr key={r.product.key} className="align-top">
                    <td className="px-3 py-2">
                      <span className="block">{r.product.label}</span>
                      {canEdit && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-brand-700">Alterar preço</summary>
                          <div className="mt-2 w-[min(640px,85vw)]">
                            <PriceRuleForm target="level" ownerNodeId={ownerNodeId} level={l} productKey={r.product.key} productLabel={r.product.label} owner={r.owner} ownerName={ownerName} current={r.current ? { cost: r.current.cost, minPrice: r.current.minPrice, defaultPrice: r.current.defaultPrice, canEdit: r.current.canEdit !== false } : null} />
                          </div>
                        </details>
                      )}
                    </td>
                    {r.current ? (
                      <>
                        <td className="tabular px-3 py-2 text-right">{formatMoney(r.current.cost)}</td>
                        <td className={`tabular px-3 py-2 text-right ${r.owner && r.current.cost - r.owner.cost < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.owner ? formatMoney(r.current.cost - r.owner.cost) : "—"}</td>
                        <td className="tabular px-3 py-2 text-right">{formatMoney(r.current.minPrice)}</td>
                        <td className="tabular px-3 py-2 text-right">{formatMoney(r.current.defaultPrice)}{r.current.canEdit === false && <Badge className="ml-1">fixo</Badge>}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">desde {formatDate(r.current.validFrom)}{r.future && <span className="block text-amber-700">nova a partir de {formatDate(r.future.validFrom)}: custo {formatMoney(r.future.cost)}</span>}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-3 py-2 text-xs text-slate-500">Sem tabela padrão{r.future ? ` (nova a partir de ${formatDate(r.future.validFrom)})` : ""}.</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistoryList({ rows }: { rows: Doc[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Sem eventos registrados.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {rows.slice(0, 100).map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-brand-500 ring-4 ring-white" aria-hidden />
          <p className="text-sm text-ink">{e.summary}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatDateTime(e.occurredAt)} · {e.userName}
            {e.reason && <> · Motivo: {e.reason}</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
