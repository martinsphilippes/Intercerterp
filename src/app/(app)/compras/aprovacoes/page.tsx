import Link from "@/components/ui/link";
import { Settings2 } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { paginate, parseList, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { listAll } from "@/lib/db";
import { activePolicy, policyPreview, stepResponsibles, DEFAULT_POLICY } from "@/domain/approvals";
import { queryRequests } from "./queries";

export const metadata = { title: "Aprovação de compras" };

type Row = Awaited<ReturnType<typeof queryRequests>>[number];

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const params = await searchParams;
  if (params.status === undefined) params.status = "in_review";
  const p = parseList(params, { sort: "number", dir: "desc" });
  const all = await queryRequests(s.ctx, p);
  const { rows, total } = paginate(all, p);
  const base = await queryRequests(s.ctx, { ...p, f: { ...p.f, status: "", mine: "" } });
  const month = new Date().toISOString().slice(0, 7);
  const policy = await policyPreview(s.ctx.store, s.ctx.companyId);
  const pdoc = await activePolicy(s.ctx.store, s.ctx.companyId);
  // etapas em que o usuário é responsável
  const myScopes: string[] = [];
  for (const t of (pdoc?.rules ?? DEFAULT_POLICY.rules).tiers) for (const st of t.steps) if ((await stepResponsibles(s.ctx.store, s.ctx.companyId, st)).some((u) => u.id === s.user.id)) myScopes.push(`${st.name}${t.above ? ` (acima de ${formatMoney(t.above)})` : ""}`);
  const branches = await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] });
  const columns: Column<Row>[] = [
    { key: "number", label: "Solicitação", sortable: true, fixed: true, cell: (r) => <span>nº {r.number} {r.revision > 1 && <span className="text-xs font-normal text-slate-500">rev. {r.revision}</span>}<span className="block max-w-[280px] truncate text-xs font-normal text-slate-600">{r.description}</span><span className="block text-xs font-normal text-slate-500">{r.ordersCount} pedido(s) · {formatDateTime(r.createdAt)}</span></span> },
    { key: "branchName", label: "Filial / solicitante", cell: (r) => <span>{r.branchName}<span className="block text-xs text-slate-500">{r.requesterName}</span></span> },
    { key: "total", label: "Total com frete", align: "right", sortable: true, cell: (r) => <span>{formatMoney(r.total)}<span className="block text-xs text-slate-500">frete {formatMoney(r.freight)}</span></span> },
    {
      key: "status",
      label: "Situação / etapa",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          {r.stepLabel ? <Badge tone="info">{r.stepLabel}</Badge> : <StatusBadge kind="approval" status={r.status} />}
          {(r.steps ?? []).length > 1 && r.status === "in_review" && <span className="text-[11px] text-slate-500">{(r.steps ?? []).map((x: any) => x.name).join(" → ")}</span>}
          {r.own && r.status === "in_review" && <Badge tone="warn">Solicitação própria</Badge>}
          {r.expired && <Badge tone="bad">Proposta vencida</Badge>}
          {r.deliveryReview && <Badge tone="warn">Prazo de entrega a revisar</Badge>}
        </span>
      ),
    },
    { key: "analyze", label: "Análise", fixed: true, cell: (r) => <Link className="font-medium text-brand-700 hover:underline" href={`/compras/aprovacoes/${r.id}`}>{r.mine ? "Analisar" : "Ver"}</Link> },
  ];
  return (
    <>
      <PageHeader
        title="Aprovação de compras"
        crumbs={[{ label: "Compras" }, { label: "Aprovações" }]}
        description="Decida as solicitações com pedidos, fretes, prazos e histórico. Aprovação interna não envia o pedido nem registra recebimento ou pagamento."
        actions={<LinkButton href="/compras/aprovacoes/politica"><Settings2 className="size-4" /> Política de aprovação</LinkButton>}
      />
      <p className="mb-4 rounded-md bg-sky-50 px-4 py-2 text-sm text-sky-900">
        Seu perfil: <b>{s.user.roleName ?? (s.user.isAdmin ? "Administrador" : "—")}</b>
        {canDo(s.user, "purchase.approve") ? (myScopes.length ? ` · você decide: ${[...new Set(myScopes)].join("; ")}` : s.user.isAdmin ? " · administrador (pode decidir qualquer etapa, respeitando solicitação própria e aprovadores distintos)" : " · sem etapas atribuídas na política") : " · sem permissão para aprovar compras (somente consulta)"}.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pendentes comigo" value={base.filter((r) => r.mine).length} hint={formatMoney(base.filter((r) => r.mine).reduce((a, r) => a + r.total, 0))} href="/compras/aprovacoes?status=in_review&mine=1" tone={base.some((r) => r.mine) ? "warn" : "default"} />
        <Stat label="Em análise" value={base.filter((r) => r.status === "in_review").length} hint={formatMoney(base.filter((r) => r.status === "in_review").reduce((a, r) => a + r.total, 0))} href="/compras/aprovacoes?status=in_review" />
        <Stat label="Devolvidas para ajuste" value={base.filter((r) => r.status === "adjust").length} href="/compras/aprovacoes?status=adjust" />
        <Stat label="Aprovadas no mês" value={base.filter((r) => r.status === "approved" && (r.decidedAt ?? "").slice(0, 7) === month).length} hint={formatMoney(base.filter((r) => r.status === "approved" && (r.decidedAt ?? "").slice(0, 7) === month).reduce((a, r) => a + r.total, 0))} href="/compras/aprovacoes?status=approved" />
      </div>
      <FilterBar
        basePath="/compras/aprovacoes"
        values={params}
        filters={[
          { type: "search", placeholder: "Solicitação, fornecedor, pedido ou solicitante" },
          { type: "select", name: "branch", label: "Filial", all: "Todas as filiais", options: branches.map((b) => ({ value: b.id, label: b.name })) },
          { type: "select", name: "status", label: "Situação", options: [{ value: "in_review", label: "Em análise" }, { value: "adjust", label: "Devolvida para ajuste" }, { value: "approved", label: "Aprovada" }, { value: "rejected", label: "Rejeitada" }, { value: "cancelled", label: "Cancelada" }] },
          { type: "select", name: "mine", label: "Responsável", options: [{ value: "1", label: "Pendentes comigo" }] },
        ]}
      />
      <DataTable
        id="purchase-requests"
        basePath="/compras/aprovacoes"
        params={params}
        columns={columns}
        rows={rows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        exportKey="purchase_requests"
        rowHref={(r) => `/compras/aprovacoes/${r.id}`}
        totals={{ total: `${all.length} solicitação(ões) · ${formatMoney(all.reduce((a, r) => a + r.total, 0))}` }}
        footer={<p className="border-t border-line px-3 py-2 text-xs text-slate-500">A alçada considera o total da solicitação, incluindo todos os pedidos e fretes.</p>}
        empty={<div className="p-10 text-center text-sm text-slate-500">Nenhuma solicitação no recorte.</div>}
      />
      <details className="mt-4 rounded-lg border border-line bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Política de aprovação vigente — {policy.name}{!policy.configured && " (padrão)"}</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          {policy.tiers.map((t, i) => <li key={i}>{t.above ? `Acima de ${formatMoney(t.above)}` : "Qualquer valor"}: {t.steps.map((st, j) => `${j + 1}. ${st.name} (${st.responsibleNames.join(", ") || "sem responsáveis"})`).join(" → ")}</li>)}
          <li>Autoaprovação: {policy.autoApproveBelow ? `abaixo de ${formatMoney(policy.autoApproveBelow)}` : "desligada"}.</li>
          <li>Solicitação própria: {policy.allowSelfApproval ? "permitida" : "bloqueada"} · aprovadores distintos por etapa: {policy.distinctApprovers ? "sim" : "não"}.</li>
          <li>Proposta vencida: {policy.expiredProposalAction === "block" ? "bloqueia a aprovação" : policy.expiredProposalAction === "warn" ? "exige observação para aprovar" : "permitida"} · alteração após aprovação: {policy.reviewOnRevision === "always" ? "sempre volta para análise" : policy.reviewOnRevision === "never" ? "não exige nova análise" : "volta para análise se relevante"}.</li>
        </ul>
      </details>
    </>
  );
}
