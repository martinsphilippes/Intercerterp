import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { activePolicy, canDecide, requestDecisions, stepState, DEFAULT_POLICY } from "@/domain/approvals";
import { orderItems } from "@/domain/purchases";
import { supplierLabel } from "@/domain/suppliers";
import { revokeAction } from "../actions";
import { DecisionPanel } from "./decision-panel";

export const metadata = { title: "Análise da solicitação de compra" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("purchases");
  const { id } = await params;
  const store = s.ctx.store;
  const r = await store.get("purchase_requests", id);
  if (!r || r.companyId !== s.ctx.companyId) notFound();
  const [decisions, users, branch] = await Promise.all([requestDecisions(store, id), nameMap(s.ctx, "users"), store.get("branches", r.branchId)]);
  const orders = (await Promise.all((r.orderIds ?? []).map((oid: string) => store.get("purchase_orders", oid)))).filter(Boolean) as any[];
  const quotation = r.quotationId ? await store.get("quotations", r.quotationId) : null;
  const qItems = new Map<string, any>((quotation?.items ?? []).map((i: any) => [i.skuId, i]));
  const itemsBy = new Map<string, any[]>();
  for (const o of orders) itemsBy.set(o.id, await orderItems(store, o.id));
  const skus = new Map((await Promise.all([...itemsBy.values()].flat().map((i) => store.get("skus", i.skuId)))).filter(Boolean).map((k) => [k!.id, k!]));
  const check = await canDecide(s.ctx, r);
  const t = today();
  // produtos líquidos (subtotal − descontos) e acréscimos (IPI, seguro, outras despesas) separados do frete
  const netProducts = (o: any) => (o.subtotal ?? 0) - (o.discountTotal ?? 0);
  const extras = (o: any) => (o.ipiTotal ?? 0) + (o.insurance ?? 0) + (o.otherExpenses ?? 0);
  const products = orders.reduce((a, o) => a + netProducts(o), 0);
  const freight = orders.reduce((a, o) => a + (o.freight ?? 0), 0);
  const additions = orders.reduce((a, o) => a + extras(o), 0);
  const policy = await activePolicy(store, s.ctx.companyId);
  // etapas da política que não se aplicam a este valor (“dispensada pela alçada”)
  const allStepNames = [...new Set(((policy?.rules ?? DEFAULT_POLICY.rules).tiers as any[]).flatMap((x) => x.steps.map((st: any) => st.name)))];
  const appliedNames = new Set((r.steps ?? []).map((x: any) => x.name));
  const waived = allStepNames.filter((n) => !appliedNames.has(n));
  const valid = decisions.filter((d) => d.revision === r.revision && !d.revokedAt);
  const lastValid = valid[valid.length - 1];
  const step = r.steps?.[r.currentStep ?? 0];
  const nextStep = r.steps?.[(r.currentStep ?? 0) + 1]?.name ?? null;
  const expiredWarn = (r.warnings ?? []).filter((w: any) => w.kind === "expired_proposal");
  const changedWarn = (r.warnings ?? []).filter((w: any) => w.kind === "proposal_changed");
  const snap = r.policySnapshot ?? {};
  const description = quotation?.title ?? orders.map((o) => o.purpose).find(Boolean) ?? orders.map((o) => supplierLabel(o.supplierSnapshot)).join(", ");
  return (
    <>
      <PageHeader
        title={`Solicitação nº ${r.number} · ${description}`}
        crumbs={[{ label: "Aprovações", href: "/compras/aprovacoes" }, { label: `nº ${r.number}` }]}
        badges={r.status === "in_review" ? <Badge tone="info">Aguardando {step?.name}</Badge> : <StatusBadge kind="approval" status={r.status} />}
        description={`Filial ${branch?.name ?? "—"}${quotation ? ` · cotação nº ${quotation.number}` : ""} · revisão ${r.revision ?? 1} · ${r.origin === "revision" ? "nova análise por revisão do pedido" : "envio para análise"} em ${formatDateTime(r.updatedAt ?? r.createdAt)}`}
        actions={<Link href="/compras/aprovacoes" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft className="size-4" /> Voltar à fila</Link>}
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-4"><p className="text-xs text-slate-500">Solicitante</p><p className="mt-1 font-semibold">{users.get(r.requesterId) ?? "—"}</p><p className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</p></div>
        <div className="rounded-lg border border-line bg-white p-4"><p className="text-xs text-slate-500">Produtos / fretes{additions ? " / IPI, seguro e outras" : ""}</p><p className="tabular mt-1 font-semibold">{formatMoney(products)} / {formatMoney(freight)}{additions ? ` / ${formatMoney(additions)}` : ""}</p><p className="text-xs text-slate-500">{orders.length} pedido(s)</p></div>
        <div className="rounded-lg border border-line bg-white p-4"><p className="text-xs text-slate-500">Total para alçada (com frete)</p><p className="tabular mt-1 text-xl font-semibold text-brand-800">{formatMoney(r.total)}</p><p className="text-xs text-slate-500">Política “{snap.name ?? "—"}” · alçada acima de {formatMoney(snap.tierAbove ?? 0)}</p></div>
      </div>
      <div className="mb-4 grid gap-3 rounded-lg bg-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {(r.steps ?? []).map((st: any, i: number) => {
          const ss = stepState(r, i, decisions);
          const current = r.status === "in_review" && (r.currentStep ?? 0) === i;
          return (
            <div key={i} className={cn("rounded-md border bg-white p-3", current ? "border-accent-500 ring-1 ring-accent-500" : "border-line")}>
              <p className="text-sm font-semibold">{i + 1}. {st.name}</p>
              <p className="mt-1"><StatusBadge kind="approval" status={ss.state === "pending" ? "pending" : ss.state} /></p>
              <p className="mt-1 text-xs text-slate-500">{ss.decision ? `${users.get(ss.decision.createdBy) ?? ""} · ${formatDateTime(ss.decision.createdAt)}${ss.decision.note ? ` — “${ss.decision.note}”` : ""}` : `Responsáveis: ${(st.responsibleNames ?? []).join(", ") || "nenhum"}`}</p>
            </div>
          );
        })}
        {waived.map((n) => (
          <div key={n} className="rounded-md border border-dashed border-line bg-white/60 p-3">
            <p className="text-sm font-semibold text-slate-500">{n}</p>
            <p className="mt-1 text-xs text-slate-500">Dispensada pela alçada (total até o limite desta etapa)</p>
          </div>
        ))}
        {decisions.some((d) => d.decision === "auto" && d.revision === r.revision) && <div className="rounded-md border border-line bg-white p-3"><StatusBadge kind="approval" status="auto" /><p className="mt-1 text-xs text-slate-500">{decisions.find((d) => d.decision === "auto")?.note}</p></div>}
      </div>
      {expiredWarn.length > 0 && <Notice tone="bad" title={`Proposta vencida — política: ${snap.expiredProposalAction === "block" ? "aprovação bloqueada" : snap.expiredProposalAction === "warn" ? "aprovação exige observação" : "permitida"}`}>{expiredWarn.map((w: any) => w.message).join(" ")}</Notice>}
      {changedWarn.length > 0 && <Notice tone="warn">{changedWarn.map((w: any) => w.message).join(" ")}</Notice>}
      <div className="mt-4 space-y-4">
        {orders.map((o) => {
          const its = itemsBy.get(o.id) ?? [];
          const expired = o.proposalRef?.validUntil && o.proposalRef.validUntil < t;
          return (
            <Card
              key={o.id}
              title={<span><Link className="text-brand-700 hover:underline" href={`/fornecedores/${o.supplierId}`}>{supplierLabel(o.supplierSnapshot)}</Link> · <Link className="text-brand-700 hover:underline" href={`/compras/pedidos/${o.id}`}>Pedido nº {o.number}</Link>{(o.revision ?? 1) > 1 && <span className="text-xs font-normal text-slate-500"> rev. {o.revision}</span>}</span>}
              description={`Pagamento ${o.paymentTermsText ?? "—"} · entrega prevista ${formatDate(o.expectedDate)}${o.proposalRef ? ` · proposta válida até ${formatDate(o.proposalRef.validUntil)} (v${o.proposalRef.version})` : ""}${o.purpose ? ` · ${o.purpose}` : ""}`}
              actions={<>{expired && <Badge tone="bad">Proposta vencida</Badge>}{o.expectedDate && o.expectedDate < t && ["in_review", "adjust"].includes(o.status) && <Badge tone="warn">Prazo de entrega a revisar</Badge>}<StatusBadge kind="purchase" status={o.status} /></>}
              bodyClass="p-0"
            >
              <table className="table-base w-full text-sm">
                <thead><tr><th>Produto</th><th className="text-right">Quantidade</th><th className="text-right">Líquido / UN</th><th className="text-right">Subtotal</th></tr></thead>
                <tbody>
                  {its.map((i) => {
                    const need = qItems.get(i.skuId)?.neededBy;
                    return (
                      <tr key={i.id}>
                        <td>{i.description}<span className="block text-xs text-slate-500">{skus.get(i.skuId)?.sku} · entrega {formatDate(o.expectedDate)}{need ? ` · necessário ${formatDate(need)}` : ""}{need && o.expectedDate && o.expectedDate > need ? " (após a data necessária)" : ""}</span></td>
                        <td className="tabular text-right">{formatQty(i.qty, i.unitCode)}</td>
                        <td className="tabular text-right">{formatMoney(i.qty ? Math.round(((i.total - (i.ipi ?? 0)) * 1000) / i.qty) : i.unitCost)}{i.discount ? <span className="block text-xs text-slate-500">desconto {formatMoney(i.discount)}</span> : null}</td>
                        <td className="tabular text-right">{formatMoney(i.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-line px-4 py-2 text-sm"><span>Produtos <b className="tabular">{formatMoney(netProducts(o))}</b></span>{(o.ipiTotal ?? 0) > 0 && <span>IPI <b className="tabular">{formatMoney(o.ipiTotal)}</b></span>}<span>Frete <b className="tabular">{formatMoney(o.freight)}</b></span>{(o.insurance ?? 0) > 0 && <span>Seguro <b className="tabular">{formatMoney(o.insurance)}</b></span>}{(o.otherExpenses ?? 0) > 0 && <span>Outras despesas <b className="tabular">{formatMoney(o.otherExpenses)}</b></span>}<span>Total <b className="tabular">{formatMoney(o.total)}</b></span></p>
            </Card>
          );
        })}
      </div>
      <Card className="mt-4" title="Registrar decisão" description="A aprovação interna é distinta do envio ao fornecedor: após a última etapa, o pedido aguarda “Registrar envio”.">
        {r.status === "in_review" ? (
          <DecisionPanel requestId={id} currentStep={r.currentStep ?? 0} revision={r.revision ?? 1} stepName={step?.name ?? "—"} canDecide={check.ok} reason={check.reason ?? null} requiresNote={Boolean(check.requiresNote)} expiredBlocks={Boolean(check.expired) && snap.expiredProposalAction === "block"} total={formatMoney(r.total)} nextStep={nextStep} />
        ) : (
          <p className="text-sm text-slate-600">Solicitação {r.status === "approved" ? "aprovada" : r.status === "adjust" ? "devolvida para ajuste" : r.status === "rejected" ? "rejeitada" : "cancelada"}{r.decidedAt ? ` em ${formatDateTime(r.decidedAt)}` : ""}.</p>
        )}
        {lastValid && lastValid.decision !== "auto" && (s.user.isAdmin || lastValid.createdBy === s.user.id) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span>Última decisão: <b>{lastValid.decision === "approve" ? "aprovou" : lastValid.decision === "adjust" ? "devolveu" : "rejeitou"}</b> “{lastValid.stepName}” — {users.get(lastValid.createdBy)} em {formatDateTime(lastValid.createdAt)}</span>
            <ActionButton size="sm" action={revokeAction.bind(null, lastValid.id, id)} label="Revisar (revogar) decisão" askReason="Motivo da revisão da decisão (a solicitação volta para análise nesta etapa):" />
          </div>
        )}
      </Card>
      <details className="mt-4 rounded-lg border border-line bg-white p-4" open={decisions.length > 0}>
        <summary className="cursor-pointer text-sm font-semibold">Histórico da solicitação · {decisions.length} registro(s) de decisão</summary>
        <ol className="mt-3 space-y-2 text-sm">
          {decisions.map((d) => (
            <li key={d.id} className={cn(d.revokedAt && "text-slate-400 line-through")}>
              Rev. {d.revision} · {d.stepName}: <StatusBadge kind="approval" status={d.decision} /> por {users.get(d.createdBy) ?? "—"} em {formatDateTime(d.createdAt)}{d.note ? ` — “${d.note}”` : ""}
              {d.revokedAt && <span className="ml-2 text-xs no-underline">(revista em {formatDateTime(d.revokedAt)} por {users.get(d.revokedBy) ?? "—"}: {d.revokeReason})</span>}
            </li>
          ))}
        </ol>
        <div className="mt-4 border-t border-line pt-4">
          <Timeline store={store} refs={[`purchase_request:${id}`]} />
        </div>
      </details>
    </>
  );
}
