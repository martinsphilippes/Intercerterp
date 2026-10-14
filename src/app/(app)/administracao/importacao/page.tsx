import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { nameMap } from "@/lib/server/lookups";
import { canImport, DATA_IMPORT_LABEL, DATA_IMPORTS, type DataImportKind } from "@/domain/data-import";
import { DataImportWizard } from "./import-wizard";

export const metadata = { title: "Importação de cadastros e saldos" };

/** Importação de dados de outro sistema (PLA-19): clientes, fornecedores, saldos iniciais de estoque e títulos em aberto. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  await requireFeaturePage(s, "importacaoCadastros");
  const params = await searchParams;
  const kind = (DATA_IMPORTS.some((d) => d.kind === sp(params, "tipo")) ? sp(params, "tipo") : "customers") as DataImportKind;
  const def = DATA_IMPORTS.find((d) => d.kind === kind)!;
  const imports = await listAll(s.ctx.store, "product_imports", { filters: [["eq", "companyId", s.ctx.companyId], ["notNull", "kind"]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 30);
  const users = await nameMap(s.ctx, "users");
  const allowed = canImport(s.ctx, kind);
  const needsBranch = (kind === "stock" || kind === "receivables" || kind === "payables") && !s.ctx.branchId;
  const labelOf = (k: string) => def.fields.find((f) => f.key === k)?.label ?? k;
  const requiredHint = `Obrigatório: ${def.required.map((g) => g.map(labelOf).join(" ou ")).join("; ")}.`;
  return (
    <>
      <PageHeader
        title="Importação de cadastros e saldos"
        crumbs={[{ label: "Administração" }, { label: "Importação" }]}
        description="Migração de outro sistema por CSV: baixe o modelo, mapeie as colunas, confira a prévia linha a linha e importe. Reimportar o mesmo arquivo não duplica nada — o que já existe é ignorado. Produtos são importados em Produtos › Importar."
      />
      <LinkTabs tabs={DATA_IMPORTS.map((d) => ({ key: d.kind, label: d.label }))} active={kind} basePath="/administracao/importacao" param="tipo" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Notice tone="info" title={def.label}>
            {def.description}
            {kind === "stock" && " O saldo entra no depósito da filial atual (vazio = depósito padrão), pelo custo informado (vazio = custo do cadastro) e na data do saldo (vazio = agora) — a data vale para o inventário em data-base."}
            {(kind === "receivables" || kind === "payables") && " O título entra na filial atual com uma parcela em aberto; a baixa e a cobrança seguem o fluxo normal do Financeiro."}
          </Notice>
          {!allowed ? (
            <Notice tone="warn" title="Sem permissão para importar">
              A importação é feita por administradores (Administração › criar) com permissão de cadastro no destino{kind === "stock" ? " (ajustar estoque)" : kind === "customers" ? " (clientes)" : kind === "suppliers" ? " (fornecedores)" : " (financeiro)"}.
            </Notice>
          ) : needsBranch ? (
            <Notice tone="warn" title="Selecione uma filial">
              {DATA_IMPORT_LABEL[kind]} entram numa filial: troque o contexto consolidado por uma filial no seletor do topo.
            </Notice>
          ) : (
            <DataImportWizard key={kind} kind={kind} label={def.label} template={def.template} requiredHint={requiredHint} />
          )}
          {kind === "customers" && can(s.user, "products", "create") && (
            <p className="text-xs text-slate-500">
              Ordem sugerida na implantação: clientes e fornecedores → <Link className="text-brand-700 hover:underline" href="/produtos/importar">produtos</Link> → saldos iniciais → títulos em aberto.
            </p>
          )}
        </div>
        <Card title="Importações anteriores" bodyClass="p-0">
          {imports.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nenhuma importação realizada.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {imports.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  <Link href={`/administracao/importacao/${i.id}`} className="font-medium text-brand-700 hover:underline">
                    Nº {i.number} — {DATA_IMPORT_LABEL[i.kind as DataImportKind] ?? i.kind}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {i.fileName} · {formatDateTime(i.createdAt)} · {users.get(i.createdBy) ?? "—"}
                    {i.status !== "completed" && " · em andamento"}
                  </p>
                  {i.totals && (
                    <p className="tabular mt-1 text-xs">
                      {i.totals.create} criado(s) · {i.totals.skip} ignorado(s) · <span className={i.totals.error ? "text-red-700" : ""}>{i.totals.error} erro(s)</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
