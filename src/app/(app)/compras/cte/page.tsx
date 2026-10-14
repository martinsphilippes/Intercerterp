import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, monthStart, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { sp, type SearchParams } from "@/lib/list";
import { lookups, nameMap } from "@/lib/server/lookups";
import { linkableReceipts, listCtes } from "@/domain/freight-cte";
import { CteImportForm } from "./cte-import-form";

export const metadata = { title: "CT-e de frete (entrada)" };

/** CT-e de entrada (COM-10): importação do XML do frete de compra, vínculo aos recebimentos e lista dos lançados. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  await requireFeaturePage(s, "cteEntrada");
  const params = await searchParams;
  const q = sp(params, "q");
  const rows = await listCtes(s.ctx, { q });
  const carriers = await nameMap(s.ctx, "suppliers", (x) => x.tradeName || x.name);
  const canImport = canDo(s.user, "purchase.receive") && Boolean(s.ctx.branchId);
  const [receipts, terms, categories] = canImport ? await Promise.all([linkableReceipts(s.ctx), lookups.paymentTerms(s.ctx), lookups.finCategories(s.ctx, "expense")]) : [[], [], []];
  const month = monthStart(today());
  const monthRows = rows.filter((r) => (r.registeredAt ?? "") >= month);
  return (
    <>
      <PageHeader
        title="CT-e de frete (entrada)"
        crumbs={[{ label: "Compras" }, { label: "CT-e de frete" }]}
        description="Frete de compra contratado pela empresa: o CT-e da transportadora é rateado no custo dos recebimentos e gera a conta a pagar à transportadora. O documento é escriturado no livro de entradas."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="CT-e lançados" value={rows.length} hint="Nesta filial (ou todas, no consolidado)" />
        <Stat label="Frete no mês" value={formatMoney(monthRows.reduce((a, r) => a + (r.total ?? 0), 0))} hint={`${monthRows.length} CT-e desde ${formatDate(month)}`} />
        <Stat label="ICMS do frete no mês" value={formatMoney(monthRows.reduce((a, r) => a + (r.icms?.vICMS ?? 0), 0))} hint="Destacado no CT-e (informativo)" />
      </div>
      {canImport ? (
        <Card title="Importar CT-e" className="mb-5">
          <CteImportForm
            receipts={receipts.map((r) => ({ id: r.id, status: r.status, label: `Recebimento nº ${r.number}${r.nfeNumber ? ` — NF-e ${r.nfeNumber}` : ""}`, hint: `${carriers.get(r.supplierId) ?? r.emitter?.name ?? "—"} · ${formatMoney(r.productsTotal ?? 0)} · ${r.status === "draft" ? "em conferência (frete entra no custo na conclusão)" : `concluído em ${formatDate(r.confirmedAt)} (ajuste de custo)`}${(r.cteFreight ?? 0) > 0 ? ` · já tem ${formatMoney(r.cteFreight)} de CT-e` : ""}` }))}
            terms={terms}
            categories={categories}
          />
        </Card>
      ) : (
        <Notice tone="info">{s.ctx.branchId ? "Somente quem recebe mercadorias pode lançar CT-e." : "Selecione uma filial para lançar CT-e (o consolidado é somente consulta)."}</Notice>
      )}
      <Card title="CT-e lançados" bodyClass="p-0" actions={<form method="get" action="/compras/cte"><input name="q" defaultValue={q} placeholder="Número, chave ou transportadora" className="focus-ring h-8 rounded-md border border-line px-2 text-sm" /></form>}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum CT-e lançado" description="Importe o XML do CT-e recebido da transportadora para ratear o frete e gerar a conta a pagar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>CT-e</th>
                  <th>Transportadora</th>
                  <th>Emissão</th>
                  <th>Recebimentos</th>
                  <th>CFOP</th>
                  <th className="text-right">Valor</th>
                  <th className="text-right">ICMS</th>
                  <th>Lançado em</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="font-medium text-brand-700 hover:underline" href={`/compras/cte/${r.id}`}>
                        nº {r.cteNumber}/{r.cteSeries}
                      </Link>
                      {r.status !== "registered" && <Badge tone="warn" className="ml-1">registrando</Badge>}
                      {r.environment === "homologacao" && <Badge tone="bad" className="ml-1">homologação</Badge>}
                    </td>
                    <td>
                      {carriers.get(r.carrierId) ?? r.emitter?.name}
                      <span className="block text-xs text-slate-500">{r.emitter?.cnpj ? formatDoc(r.emitter.cnpj) : ""}</span>
                    </td>
                    <td>{r.issueDate ? formatDate(r.issueDate) : "—"}</td>
                    <td>
                      {(r.allocations ?? []).map((a: any) => (
                        <Link key={a.receiptId} className="mr-1 text-brand-700 hover:underline" href={`/compras/recebimentos/${a.receiptId}`}>
                          nº {a.receiptNumber}
                        </Link>
                      ))}
                    </td>
                    <td className="tabular">{r.entryCfop}</td>
                    <td className="tabular text-right">{formatMoney(r.total)}</td>
                    <td className="tabular text-right">{formatMoney(r.icms?.vICMS ?? 0)}</td>
                    <td>{r.registeredAt ? formatDateTime(r.registeredAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
