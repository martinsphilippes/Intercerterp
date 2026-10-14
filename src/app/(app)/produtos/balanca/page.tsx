import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/empty";
import { lookups } from "@/lib/server/lookups";
import { sp, type SearchParams } from "@/lib/list";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { listScaleProducts, recentScaleLoads } from "@/domain/scale";
import { scaleLayoutDef } from "@/domain/scale-barcode";
import { SCALE_FORMATS } from "@/domain/scale-files";
import { LoadGenerator } from "./load-generator";

export const metadata = { title: "Balança — carga e PLU" };

/** Produtos › Balança (CAD-16): produtos habilitados, conferência do PLU e geração do arquivo de carga. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("products");
  await requireFeaturePage(s, "balanca");
  const params = await searchParams;
  const tables = await lookups.priceTables(s.ctx);
  const tableParam = sp(params, "tabela");
  const { rows, duplicates, priceTableId, config } = await listScaleProducts(s.ctx, { priceTableId: tables.some((t) => t.value === tableParam) ? tableParam : null });
  const loads = await recentScaleLoads(s.ctx);
  const ready = rows.filter((r) => !r.issues.length).length;
  const layout = scaleLayoutDef(config.layout);

  return (
    <>
      <PageHeader
        title="Balança etiquetadora"
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Balança" }]}
        description="Produtos enviados à balança (PLU único), preço por kg da tabela escolhida e arquivo de carga para Toledo (MGV) ou Filizola. Os dados de cada produto ficam na aba “Balança” do cadastro."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Habilitados" value={rows.length} hint="“Enviar no arquivo de carga”" />
        <Stat label="Prontos para a carga" value={ready} tone={ready ? "good" : "default"} />
        <Stat label="Com pendência" value={rows.length - ready} tone={rows.length - ready ? "warn" : "default"} />
        <Stat label="Etiqueta no PDV" value={<span className="font-mono text-base">{layout.mask}</span>} hint={config.content === "weight" ? "Peso (kg com 3 casas)" : "Valor total (centavos)"} />
      </div>
      {duplicates.length > 0 && (
        <div className="mb-4">
          <Notice tone="bad" title="PLU duplicado">
            O PLU {duplicates.join(", ")} está em mais de um produto habilitado. A carga fica bloqueada até a correção — a balança não distingue os itens.
          </Notice>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card bodyClass="p-0" title="Produtos habilitados" description="Ordenados por PLU. Preço = tabela escolhida ao lado (filial do contexto, vigência de hoje, sem atacado).">
          {rows.length === 0 ? (
            <EmptyState title="Nenhum produto habilitado" description="No cadastro do produto, aba “Balança”, informe o PLU e marque “Enviar no arquivo de carga”." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th className="text-right">PLU</th><th>Produto</th><th>Venda</th><th className="text-right">Preço</th><th className="text-right">Validade</th><th className="text-right">Tara</th><th>Nutricional</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.productId}>
                      <td className="tabular text-right font-mono">{r.plu ?? "—"}</td>
                      <td>
                        <Link className="text-brand-700 hover:underline" href={`/produtos/${r.productId}?tab=balanca`}>{r.name}</Link>
                        {r.code && <span className="block font-mono text-xs text-slate-500">{r.code}</span>}
                      </td>
                      <td>{r.byWeight ? "Peso (KG)" : `Unidade (${r.unitCode})`}</td>
                      <td className="tabular text-right">{r.price ? formatMoney(r.price) : "—"}</td>
                      <td className="tabular text-right">{r.shelfLifeDays ? `${r.shelfLifeDays} ${r.shelfLifeDays === 1 ? "dia" : "dias"}` : "—"}</td>
                      <td className="tabular text-right">{r.scaleTare ? `${formatQty(r.scaleTare)} kg` : "—"}</td>
                      <td>{r.hasNutrition ? <Badge tone="info">informada</Badge> : <span className="text-slate-400">—</span>}</td>
                      <td>
                        {r.issues.length ? r.issues.map((i) => <Badge key={i} tone="bad" className="mr-1">{i}</Badge>) : <Badge tone="good">Pronto</Badge>}
                        {r.warnings.map((w) => <span key={w} className="block text-xs text-amber-700">{w}</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Gerar arquivo de carga" description="Leve o arquivo ao software da balança (MGV da Toledo ou o importador da Filizola).">
            <LoadGenerator
              formats={SCALE_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
              tables={tables}
              tableId={priceTableId ?? tables[0]?.value ?? ""}
              canGenerate={can(s.user, "products", "edit")}
              ready={ready}
            />
          </Card>
          <Card bodyClass="p-0" title="Cargas geradas">
            {loads.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Nenhuma carga gerada.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {loads.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <span>
                      <span className="font-mono">{f.name}</span>
                      <span className="block text-xs text-slate-500">{formatDateTime(f.createdAt)}</span>
                    </span>
                    <a className="text-brand-700 hover:underline" href={`/api/files/${f.id}`}>Baixar</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Layout dos arquivos" description="Campos de largura fixa, uma linha por produto (texto sem acentos, CRLF).">
            {SCALE_FORMATS.map((f) => (
              <details key={f.value} className="mb-2 text-xs">
                <summary className="cursor-pointer font-medium text-ink">{f.label} — {f.lineLength} posições</summary>
                <table className="table-base mt-2 w-full">
                  <thead><tr><th>Campo</th><th className="text-right">Posição</th><th className="text-right">Tam.</th></tr></thead>
                  <tbody>
                    {f.fields.map((c) => (
                      <tr key={c.name} title={c.content}><td>{c.name}<span className="block text-slate-500">{c.content}</span></td><td className="tabular text-right">{c.start}</td><td className="tabular text-right">{c.size}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
            <p className="mt-2 text-xs text-slate-500">Hipótese de layout a conferir com o software da balança da loja; tara e tabela nutricional ficam no cadastro e não vão nestes arquivos básicos.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
