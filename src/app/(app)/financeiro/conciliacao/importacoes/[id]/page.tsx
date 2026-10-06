import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Importação de extrato" };

const LINE: Record<string, [string, "good" | "neutral" | "bad" | "warn" | "info"]> = {
  imported: ["Importada", "good"],
  duplicate: ["Duplicada (não gravada)", "neutral"],
  invalid: ["Inválida", "bad"],
  unsupported: ["Não suportada", "warn"],
  info: ["Informativa", "info"],
};

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await s.ctx.store.get("bank_imports", id);
  if (!imp || imp.companyId !== s.ctx.companyId) notFound();
  const acc = await s.ctx.store.get("financial_accounts", imp.accountId);
  const users = await nameMap(s.ctx, "users");
  const sum = imp.summary ?? {};
  const p = parseList(sp, { pageSize: 50 });
  type L = { id: string; line: number; status: string; message: string; txId?: string | null; amount?: number | null };
  const all: L[] = (imp.lineResults ?? []).map((l: any, i: number) => ({ id: String(i), ...l })).filter((l: L) => !p.f.status || l.status === p.f.status);
  const { rows, total } = paginate(all, { ...p, sort: null });
  const columns: Column<L>[] = [
    { key: "line", label: "Linha", cell: (r) => r.line },
    { key: "status", label: "Resultado", cell: (r) => <Badge tone={LINE[r.status]?.[1] ?? "neutral"}>{LINE[r.status]?.[0] ?? r.status}</Badge> },
    { key: "message", label: "Detalhe", cell: (r) => <span className="text-xs">{r.message}</span> },
    { key: "amount", label: "Valor", align: "right", cell: (r) => (r.amount != null ? <span className={cn(r.amount > 0 ? "text-emerald-700" : "text-red-700")}>{formatMoney(r.amount)}</span> : "—") },
    { key: "txId", label: "Transação", cell: (r) => (r.txId ? <Link className="text-xs text-brand-700 hover:underline" href={`/financeiro/conciliacao?account=${imp.accountId}&q=&from=${sum.period?.from ?? ""}&to=${sum.period?.to ?? ""}`}>conciliar</Link> : "—") },
  ];
  return (
    <>
      <PageHeader
        title={`Importação — ${imp.fileName}`}
        crumbs={[{ label: "Financeiro" }, { label: "Conciliação bancária", href: `/financeiro/conciliacao?account=${imp.accountId}` }, { label: "Importação" }]}
        badges={imp.status === "completed" ? <Badge tone="good">Concluída</Badge> : <StatusBadge kind="generic" status="processing" />}
        description={`${sum.formatLabel ?? imp.format} · ${imp.layoutVersion ?? "—"} · conta ${acc?.name ?? "—"}`}
        actions={
          <>
            {imp.fileId && (
              <a className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm hover:bg-slate-50" href={`/api/files/${imp.fileId}`}>
                <Download className="size-4" /> Arquivo original
              </a>
            )}
            <LinkButton href={`/financeiro/conciliacao?account=${imp.accountId}${sum.period?.from ? `&from=${sum.period.from}&to=${sum.period.to}` : ""}`} variant="primary">
              Ir para a conciliação
            </LinkButton>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Transações novas" value={sum.created ?? 0} tone="good" href="?status=imported" />
        <Stat label="Duplicadas (não gravadas)" value={sum.duplicates ?? 0} href="?status=duplicate" />
        <Stat label="Inválidas" value={sum.invalid ?? 0} tone={sum.invalid ? "bad" : "default"} href="?status=invalid" />
        <Stat label="Não suportadas" value={sum.unsupported ?? 0} tone={sum.unsupported ? "warn" : "default"} href="?status=unsupported" />
        <Stat label="Informativas" value={sum.info ?? 0} href="?status=info" />
      </div>
      <Card title="Resumo do arquivo" className="mb-4">
        <DefinitionList
          cols={4}
          items={[
            { label: "Tipo", value: imp.kind === "collection_return" ? "Retorno de cobrança" : "Extrato bancário" },
            { label: "Banco (arquivo)", value: sum.bankCode ? `${sum.bankCode}${sum.bankName ? ` — ${sum.bankName}` : ""}` : "—" },
            { label: "Layout / versão", value: imp.layoutVersion },
            { label: "Período", value: sum.period?.from ? `${formatDate(sum.period.from)} a ${formatDate(sum.period.to)}` : "—" },
            { label: "Créditos", value: formatMoney(sum.credits ?? 0) },
            { label: "Débitos", value: formatMoney(sum.debits ?? 0) },
            { label: "Saldo informado", value: sum.balance ? `${formatMoney(sum.balance.amount)}${sum.balance.date ? ` em ${formatDate(sum.balance.date)}` : ""}` : "—" },
            { label: "Linhas no arquivo", value: sum.totalLines },
            { label: "Hash (identidade)", value: <code className="text-xs">{imp.fileHash?.slice(0, 16)}…</code> },
            { label: "Importado por", value: `${users.get(imp.createdBy) ?? "—"} em ${formatDateTime(imp.createdAt)}` },
            { label: "Avisos", value: (sum.warnings ?? []).join(" ") || "—" },
          ]}
        />
      </Card>
      <FilterBar basePath={`/financeiro/conciliacao/importacoes/${id}`} values={sp} filters={[{ type: "select", name: "status", label: "Resultado", options: Object.entries(LINE).map(([value, [label]]) => ({ value, label })) }]} />
      <DataTable id="fin-import-lines" basePath={`/financeiro/conciliacao/importacoes/${id}`} params={sp} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} />
      <Card title="Histórico" className="mt-4">
        <Timeline store={s.ctx.store} refs={[`bank_import:${id}`]} />
      </Card>
    </>
  );
}
