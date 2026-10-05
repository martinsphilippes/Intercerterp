import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { lookups } from "@/lib/server/lookups";
import { PRINTER_MODES } from "@/domain/terminals";
import { queryTerminals } from "./queries";

export const metadata = { title: "Terminais do PDV" };

type Row = Awaited<ReturnType<typeof queryTerminals>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin");
  const params = await searchParams;
  const p = parseList(params, { sort: "code", dir: "asc" });
  const all = await queryTerminals(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const branches = await lookups.branches(s.ctx);
  const columns: Column<Row>[] = [
    { key: "code", label: "Terminal", sortable: true, fixed: true, cell: (r) => <span>{r.code} — {r.name}</span> },
    { key: "branchName", label: "Filial", sortable: true, cell: (r) => r.branchName },
    { key: "nfceSeries", label: "Série NFC-e", align: "right", sortable: true, cell: (r) => r.nfceSeries ?? "—" },
    { key: "printerLabel", label: "Impressora", cell: (r) => <span>{r.printerLabel} <span className="text-xs text-slate-500">{r.paperWidth} mm</span></span> },
    { key: "scannerLabel", label: "Leitor", hidden: true, cell: (r) => r.scannerLabel },
    { key: "tefLabel", label: "Cartão / TEF", hidden: true, cell: (r) => r.tefLabel },
    { key: "warehouseName", label: "Depósito de saída", hidden: true, cell: (r) => r.warehouseName },
    { key: "allowNegativeStock", label: "Venda sem saldo", hidden: true, cell: (r) => (r.allowNegativeStock ? "Permitida" : "Bloqueada") },
    { key: "sessionOpenedAt", label: "Caixa atual", sortable: true, cell: (r) => (r.sessionId ? <Link className="text-brand-700 hover:underline" href={`/caixa/${r.sessionId}`}>nº {r.sessionNumber} · {r.sessionOperator} · desde {formatDateTime(r.sessionOpenedAt)}</Link> : <span className="text-slate-400">Fechado</span>) },
    { key: "lastPrinterTestAt", label: "Último teste", sortable: true, cell: (r) => (r.lastPrinterTestAt ? <span title={r.lastPrinterTestResult ?? ""}>{formatDateTime(r.lastPrinterTestAt)}</span> : <span className="text-slate-400">Nunca</span>) },
    { key: "status", label: "Situação", cell: (r) => <span className="flex gap-1"><StatusBadge kind="generic" status={r.status} />{r.sessionState === "reopened" && <Badge tone="warn">Reaberto</Badge>}</span> },
  ];
  return (
    <>
      <PageHeader
        title="Terminais do PDV"
        crumbs={[{ label: "Administração" }, { label: "Terminais" }]}
        description={s.consolidated ? "Todas as filiais (visão consolidada)." : `Filial ${s.branch?.name}. Troque para o consolidado para ver todas as filiais.`}
        actions={can(s.user, "admin", "create") && <LinkButton href="/administracao/terminais/novo" variant="primary"><Plus className="size-4" /> Novo terminal</LinkButton>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Terminais no recorte" value={all.length} hint={`${all.filter((t) => t.status === "active").length} ativos`} />
        <Stat label="Caixas abertos agora" value={all.filter((t) => t.sessionId).length} href="/administracao/terminais?session=open" />
        <Stat label="Com conector local" value={all.filter((t) => t.printerMode === "connector" || t.tefProvider === "tef_connector" || t.scannerMode === "hid").length} href="/administracao/terminais?printer=connector" />
        <Stat label="Nunca testados" value={all.filter((t) => !t.lastPrinterTestAt && t.printerMode !== "none").length} tone={all.some((t) => !t.lastPrinterTestAt && t.printerMode !== "none") ? "warn" : "default"} hint="Impressão sem teste registrado" />
      </div>
      <FilterBar
        basePath="/administracao/terminais"
        values={params}
        filters={[
          { type: "search", placeholder: "Código, nome ou impressora" },
          ...(s.consolidated ? [{ type: "select" as const, name: "branch", label: "Filial", options: branches }] : []),
          { type: "select", name: "status", label: "Situação", options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }] },
          { type: "select", name: "printer", label: "Impressão", options: PRINTER_MODES.map((m) => ({ value: m.value, label: m.label.split(" (")[0] })) },
          { type: "select", name: "session", label: "Caixa", options: [{ value: "open", label: "Com caixa aberto" }] },
        ]}
      />
      <DataTable id="admin-terminals" basePath="/administracao/terminais" params={params} columns={columns} rows={rows} total={total} page={p.page} pageSize={p.pageSize} exportKey="admin.terminals" rowHref={(r) => `/administracao/terminais/${r.id}`} />
    </>
  );
}
