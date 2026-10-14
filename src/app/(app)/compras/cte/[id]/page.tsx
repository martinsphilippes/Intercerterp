import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { TOMADOR_LABEL } from "@/domain/cte-xml";
import { CTE_STATUS_LABEL, type CteAllocation } from "@/domain/freight-cte";

export const metadata = { title: "CT-e de frete" };

const MODAL: Record<string, string> = { "01": "Rodoviário", "02": "Aéreo", "03": "Aquaviário", "04": "Ferroviário", "05": "Dutoviário", "06": "Multimodal" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("purchases");
  const { id } = await params;
  const store = s.ctx.store;
  const c = await store.get("inbound_ctes", id);
  if (!c || c.companyId !== s.ctx.companyId) notFound();
  const carrier = c.carrierId ? await store.get("suppliers", c.carrierId) : null;
  const title = c.payableTitleId ? await store.get("titles", c.payableTitleId) : null;
  const allocations = (c.allocations ?? []) as CteAllocation[];
  const keyFmt = String(c.cteKey ?? "").replace(/(\d{4})(?=\d)/g, "$1 ");
  return (
    <>
      <PageHeader
        title={`CT-e nº ${c.cteNumber}/${c.cteSeries}`}
        crumbs={[{ label: "CT-e de frete", href: "/compras/cte" }, { label: `nº ${c.cteNumber}` }]}
        badges={<Badge tone={c.status === "registered" ? "good" : "warn"}>{CTE_STATUS_LABEL[c.status] ?? c.status}</Badge>}
        description={`${carrier?.tradeName || carrier?.name || c.emitter?.name} · lançado em ${c.registeredAt ? formatDateTime(c.registeredAt) : "—"}`}
        actions={c.xmlFileId ? <LinkButton href={`/api/files/${c.xmlFileId}`}><Download className="size-4" /> XML</LinkButton> : null}
      />
      <Card className="mb-5">
        <p className="tabular font-mono text-xs text-slate-600">{keyFmt}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {c.authorized ? <Badge tone={c.environment === "homologacao" ? "warn" : "good"}>Autorizado · protocolo {c.protocol}</Badge> : <Badge tone="warn">Sem protocolo de autorização no XML</Badge>}
          {c.environment === "homologacao" && <Badge tone="bad">Homologação – sem valor fiscal</Badge>}
        </div>
        <DefinitionList
          cols={4}
          items={[
            { label: "Transportadora", value: carrier ? <Link className="text-brand-700 hover:underline" href={`/fornecedores/${carrier.id}`}>{carrier.tradeName || carrier.name}</Link> : c.emitter?.name },
            { label: "CNPJ / UF", value: `${c.emitter?.cnpj ? formatDoc(c.emitter.cnpj) : "—"} · ${c.emitter?.uf ?? "—"}` },
            { label: "Emissão", value: c.issueDate ? formatDateTime(c.issueDate) : "—" },
            { label: "Modal / percurso", value: `${MODAL[c.emitter?.modal] ?? c.emitter?.modal ?? "—"} · ${c.emitter?.ufStart ?? "?"} → ${c.emitter?.ufEnd ?? "?"}` },
            { label: "Tomador do serviço", value: `${TOMADOR_LABEL[c.tomador?.role] ?? "—"} — ${c.tomador?.name ?? ""} ${c.tomador?.cnpj ? formatDoc(c.tomador.cnpj) : ""}` },
            { label: "CFOP (transportadora → entrada)", value: `${c.cfop ?? "—"} → ${c.entryCfop}` },
            { label: "Valor da prestação", value: <strong>{formatMoney(c.total)}</strong> },
            { label: "ICMS da prestação", value: c.icms?.simples ? "Simples Nacional" : `${formatMoney(c.icms?.vICMS ?? 0)} (base ${formatMoney(c.icms?.vBC ?? 0)}, CST ${c.icms?.cst ?? "—"})` },
          ]}
        />
      </Card>
      <Card title="Rateio do frete nos recebimentos" bodyClass="p-0" className="mb-5" description="Entre recebimentos pelo valor dos produtos; dentro de cada um, pelo valor da linha (mesmo critério do frete da NF-e).">
        <div className="overflow-x-auto">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Recebimento</th>
                <th className="text-right">Frete rateado</th>
                <th>Como entrou no custo</th>
                <th className="text-right">No custo médio</th>
                <th className="text-right">Não absorvido</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => {
                const abs = a.adjustments.reduce((x, j) => x + j.absorbed, 0);
                return (
                  <tr key={a.receiptId}>
                    <td>
                      <Link className="text-brand-700 hover:underline" href={`/compras/recebimentos/${a.receiptId}`}>
                        nº {a.receiptNumber}
                      </Link>
                      {a.nfeNumber && <span className="text-xs text-slate-500"> · NF-e {a.nfeNumber}</span>}
                      {a.mode === "adjustment" && a.adjustments.length > 0 && (
                        <ul className="mt-1 text-xs text-slate-500">
                          {a.adjustments.map((j) => (
                            <li key={j.idx}>
                              {j.description}: {formatMoney(j.share)} → {formatMoney(j.absorbed)} no estoque{j.notAbsorbed ? `, ${formatMoney(j.notAbsorbed)} de unidades já baixadas` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="tabular text-right">{formatMoney(a.amount)}</td>
                    <td>{a.mode === "cost" ? <Badge tone="info">Custo de entrada (recebimento em conferência)</Badge> : a.mode === "adjustment" ? <Badge tone="warn">Ajuste de custo (recebimento já concluído)</Badge> : "—"}</td>
                    <td className="tabular text-right">{a.mode === "cost" ? formatMoney(a.amount) : formatMoney(abs)}</td>
                    <td className="tabular text-right">{a.mode === "adjustment" ? formatMoney(a.amount - abs) : formatMoney(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
          Recebimento já concluído: a parte do frete das unidades ainda em estoque entra no custo médio (movimento “Ajuste de custo (frete CT-e / nota)”, sem quantidade); a parte das unidades já vendidas ou baixadas fica registrada como não absorvida, para o ajuste contábil. O crédito de ICMS do frete não é descontado do custo.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Conta a pagar à transportadora">
          {title ? (
            <DefinitionList
              cols={2}
              items={[
                { label: "Título", value: <Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${title.id}`}>nº {title.number}</Link> },
                { label: "Situação", value: <StatusBadge kind="title" status={title.status} /> },
                { label: "Valor", value: formatMoney(title.total) },
                { label: "Emissão", value: formatDate(title.issueDate) },
              ]}
            />
          ) : (
            <p className="text-sm text-slate-500">Título ainda não gerado (lançamento em andamento).</p>
          )}
        </Card>
        <Card title="NF-e transportadas">
          {(c.nfeKeys ?? []).length ? (
            <ul className="space-y-1 font-mono text-xs">
              {(c.nfeKeys as string[]).map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">O CT-e não informa as chaves das NF-e.</p>
          )}
        </Card>
      </div>
      <Card className="mt-5" title="Linha do tempo">
        <Timeline store={store} refs={[`inbound_cte:${id}`]} />
      </Card>
    </>
  );
}
