import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { DATA_IMPORT_LABEL, dataImportDef, type DataImportKind, type DataImportRowResult } from "@/domain/data-import";

export const metadata = { title: "Importação de cadastros e saldos" };

const ACTION: Record<string, [string, "good" | "neutral" | "bad"]> = { create: ["Criado", "good"], skip: ["Ignorado", "neutral"], error: ["Erro", "bad"] };

const entityHref = (kind: DataImportKind, id: string) =>
  kind === "customers" ? `/clientes/${id}` : kind === "suppliers" ? `/fornecedores/${id}` : kind === "stock" ? `/produtos/${id}?tab=estoque` : kind === "receivables" ? `/financeiro/receber/${id}` : `/financeiro/pagar/${id}`;

/** Resultado por linha de uma importação de cadastros e saldos (PLA-19) — o relatório de erros fica aqui. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ acao?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { acao = "" } = await searchParams;
  const imp = await s.ctx.store.get("product_imports", id);
  if (!imp || imp.companyId !== s.ctx.companyId || !imp.kind) notFound();
  const kind = imp.kind as DataImportKind;
  const users = await nameMap(s.ctx, "users");
  const results: DataImportRowResult[] = imp.results ?? [];
  const shown = acao ? results.filter((r) => r.action === acao) : results;
  const t = imp.totals ?? {};
  const base = `/administracao/importacao/${id}`;
  let fieldLabel = new Map<string, string>();
  try {
    fieldLabel = new Map(dataImportDef(kind).fields.map((f) => [f.key, f.label]));
  } catch {
    /* tipo desconhecido: mostra as chaves */
  }
  return (
    <>
      <PageHeader
        title={`Importação nº ${imp.number} — ${DATA_IMPORT_LABEL[kind] ?? kind}`}
        crumbs={[{ label: "Administração" }, { label: "Importação", href: `/administracao/importacao?tipo=${kind}` }, { label: `Nº ${imp.number}` }]}
        badges={<StatusBadge kind="generic" status={imp.status} />}
        description={`${imp.fileName} · ${formatDateTime(imp.createdAt)} · ${users.get(imp.createdBy) ?? "—"}`}
        actions={<LinkButton href={`/administracao/importacao?tipo=${kind}`}>Nova importação</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Linhas" value={t.rows ?? results.length} href={base} />
        <Stat label="Criados" value={t.create ?? 0} href={`${base}?acao=create`} tone="good" />
        <Stat label="Ignorados (já existiam)" value={t.skip ?? 0} href={`${base}?acao=skip`} />
        <Stat label="Com erro" value={t.error ?? 0} href={`${base}?acao=error`} tone={t.error ? "bad" : "default"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title={`Resultado por linha${acao ? ` — ${ACTION[acao]?.[0] ?? acao}` : ""}`} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Linha</th><th>Chave</th><th>Nome</th><th>Resultado</th><th>Detalhes</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular">{r.line}</td>
                    <td className="font-mono text-xs">{r.key}</td>
                    <td>{r.entityId && r.action !== "error" ? <Link className="text-brand-700 hover:underline" href={entityHref(kind, r.entityId)}>{r.name ?? "Abrir"}</Link> : (r.name ?? "—")}</td>
                    <td><Badge tone={ACTION[r.action]?.[1] ?? "neutral"}>{ACTION[r.action]?.[0] ?? r.action}</Badge></td>
                    <td className="text-xs text-slate-600">{r.messages.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Parâmetros">
            <DefinitionList
              cols={1}
              items={[
                { label: "Tipo", value: DATA_IMPORT_LABEL[kind] ?? kind },
                { label: "Concluída em", value: imp.finishedAt ? formatDateTime(imp.finishedAt) : "Em andamento — importe o arquivo de novo: o que já entrou é ignorado" },
                { label: "Colunas mapeadas", value: Object.values(imp.mapping ?? {}).filter(Boolean).map((k: any) => fieldLabel.get(k) ?? k).join(", ") },
              ]}
            />
          </Card>
          <Card title="Histórico">
            <Timeline store={s.ctx.store} refs={[`data_import:${id}`]} />
          </Card>
        </div>
      </div>
    </>
  );
}
