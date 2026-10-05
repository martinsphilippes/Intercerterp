import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { IMPORT_FIELDS, IMPORT_MODES } from "@/domain/product-import";

export const metadata = { title: "Importação de produtos" };

const ACTION: Record<string, [string, "good" | "info" | "neutral" | "bad"]> = { create: ["Criado", "good"], update: ["Atualizado", "info"], skip: ["Ignorado", "neutral"], error: ["Erro", "bad"] };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ acao?: string }> }) {
  const s = await requireSession("products");
  const { id } = await params;
  const { acao = "" } = await searchParams;
  const imp = await s.ctx.store.get("product_imports", id);
  if (!imp || imp.companyId !== s.ctx.companyId) notFound();
  const users = await nameMap(s.ctx, "users");
  const results: Array<{ line: number; key: string; name?: string; action: string; productId?: string | null; messages: string[] }> = imp.results ?? [];
  const shown = acao ? results.filter((r) => r.action === acao) : results;
  const t = imp.totals ?? {};
  const base = `/produtos/importar/${id}`;
  const fieldLabel = new Map(IMPORT_FIELDS.map((f) => [f.key, f.label]));
  return (
    <>
      <PageHeader
        title={`Importação nº ${imp.number}`}
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Importar", href: "/produtos/importar" }, { label: `Nº ${imp.number}` }]}
        badges={<StatusBadge kind="generic" status={imp.status} />}
        description={`${imp.fileName} · ${formatDateTime(imp.createdAt)} · ${users.get(imp.createdBy) ?? "—"}`}
        actions={<LinkButton href="/produtos/importar">Nova importação</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Linhas" value={t.rows ?? results.length} href={base} />
        <Stat label="Criados" value={t.create ?? 0} href={`${base}?acao=create`} tone="good" />
        <Stat label="Atualizados" value={t.update ?? 0} href={`${base}?acao=update`} />
        <Stat label="Ignorados" value={t.skip ?? 0} href={`${base}?acao=skip`} />
        <Stat label="Com erro" value={t.error ?? 0} href={`${base}?acao=error`} tone={t.error ? "bad" : "default"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card title={`Resultado por linha${acao ? ` — ${ACTION[acao]?.[0] ?? acao}` : ""}`} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Linha</th><th>Chave</th><th>Produto</th><th>Resultado</th><th>Detalhes</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular">{r.line}</td>
                    <td className="font-mono text-xs">{r.key}</td>
                    <td>{r.productId && r.action !== "error" ? <Link className="text-brand-700 hover:underline" href={`/produtos/${r.productId}`}>{r.name ?? "Abrir"}</Link> : (r.name ?? "—")}</td>
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
                { label: "Política", value: IMPORT_MODES.find((m) => m.value === imp.mode)?.label ?? imp.mode },
                { label: "Identificação de existentes", value: imp.matchBy === "sku" ? "Por SKU" : "Por código interno" },
                { label: "Concluída em", value: formatDateTime(imp.finishedAt) },
                { label: "Colunas mapeadas", value: Object.values(imp.mapping ?? {}).filter(Boolean).map((k: any) => fieldLabel.get(k) ?? k).join(", ") },
              ]}
            />
          </Card>
          <Card title="Histórico">
            <Timeline store={s.ctx.store} refs={[`product_import:${id}`]} />
          </Card>
        </div>
      </div>
    </>
  );
}
