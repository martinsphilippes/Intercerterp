import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatMoney, formatQty, formatBps } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { quotationView } from "@/domain/quotations";
import { supplierLabel } from "@/domain/suppliers";
import { removeProposalAction, generateOrdersAction, cancelQuotationAction } from "../actions";
import { CsvImport } from "./csv-import";
import { ProposalDialog } from "./proposal-dialog";
import { Comparison } from "./comparison";
import { QuotationForm } from "../quotation-form";

export const metadata = { title: "Cotação" };
const ORIGIN: Record<string, string> = { manual: "manual", replenishment: "da reposição", need: "de necessidade" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; editar?: string }> }) {
  const s = await requireSession("purchases");
  const { id } = await params;
  const { tab = "comparacao", editar } = await searchParams;
  const q0 = await s.ctx.store.get("quotations", id);
  if (!q0 || q0.companyId !== s.ctx.companyId) notFound();
  const onTimeOnly = Boolean(q0.selection?.onTimeOnly ?? true);
  const v = await quotationView(s.ctx, id, { onTimeOnly });
  const q = v.q;
  const branch = await s.ctx.store.get("branches", q.branchId);
  // defesa em profundidade: somente fornecedores da empresa ativa
  const suppliers = (await Promise.all((q.supplierIds ?? []).map((sid: string) => s.ctx.store.get("suppliers", sid)))).filter((x) => x && x.companyId === s.ctx.companyId);
  const terms = (await listAll(s.ctx.store, "payment_terms", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] })).map((t) => ({ value: t.id, label: t.name }));
  const canEdit = can(s.user, "purchases", "edit") && q.status === "open" && !q.ordersCreated;
  const base = `/compras/cotacoes/${id}`;
  const skuMap = new Map((await Promise.all(v.items.map((i) => s.ctx.store.get("skus", i.skuId)))).filter(Boolean).map((k) => [k!.id, k!]));
  const ev = v.evaluation;
  const csvTemplate = ["fornecedor;sku;preco;desconto;disponivel;qtd_disponivel;prazo;frete;pedido_minimo;validade;condicao", ...suppliers.filter(Boolean).flatMap((sup) => v.items.map((it) => `${sup!.doc ?? sup!.code};${it.sku};;0;sim;;;;;;`))].join("\n");
  return (
    <>
      <PageHeader
        title={`Cotação nº ${q.number}`}
        crumbs={[{ label: "Cotações", href: "/compras/cotacoes" }, { label: `nº ${q.number}` }]}
        badges={<StatusBadge kind="quotation" status={q.status === "open" ? "open" : q.status} />}
        description={`${q.title ?? ""} · Filial ${branch?.name ?? "—"} · ${v.items.length} produto(s) ${ORIGIN[q.origin] ?? ""} · ${suppliers.length} fornecedor(es) · posição em ${formatDate(v.refDate)}${q.responseDue ? ` · respostas até ${formatDate(q.responseDue)}` : ""}`}
        actions={
          <>
            {q.ordersCreated && <Link href={`/compras/pedidos?quotation=${id}`} className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-800">Rascunhos/pedidos {v.orders.length}</Link>}
            {canEdit && <ActionButton variant="danger" action={cancelQuotationAction.bind(null, id)} label="Cancelar cotação" askReason="Motivo do cancelamento:" />}
          </>
        }
      />
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "comparacao", label: "Comparação" },
          { key: "propostas", label: "Propostas", count: v.proposals.length },
          { key: "revisao", label: "Revisão por fornecedor", count: ev.groups.length },
          { key: "itens", label: "Itens e fornecedores" },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {v.stale.length > 0 && <Notice tone="warn" title="Proposta alterada após a seleção">A seleção de {v.stale.length} item(ns) foi feita sobre uma versão anterior da proposta. Refaça a escolha desses itens para usar a condição vigente.</Notice>}
      {tab === "comparacao" && (
        v.proposals.length === 0 ? (
          <Card><EmptyState title="Nenhuma proposta registrada" description="Registre ou importe as propostas na aba Propostas para comparar." action={<Link className="text-brand-700 underline" href={`${base}?tab=propostas`}>Ir para Propostas</Link>} /></Card>
        ) : (
          <Comparison
            key={q.selection?.mode === "suggested" ? q.selection.at : "manual"}
            quotationId={id}
            items={v.items}
            proposals={v.proposals}
            supplierOrder={suppliers.filter(Boolean).map((x) => ({ id: x!.id, name: supplierLabel(x) }))}
            initial={Object.fromEntries(Object.entries(q.selection?.items ?? {}).map(([k, x]: any) => [k, x.supplierId]))}
            refDate={v.refDate}
            readOnly={!canEdit}
            onTimeDefault={onTimeOnly}
            heuristic={q.selection?.heuristic ? `Sugestão: ${q.selection.heuristic.method} (gulosa ${formatMoney(q.selection.heuristic.greedyTotal)} → ${formatMoney(q.selection.heuristic.total)})` : null}
          />
        )
      )}
      {tab === "propostas" && (
        <div className="space-y-4">
          {canEdit && (
            <Card title="Importar propostas (CSV)" description="Uma linha por fornecedor × produto. Separador ; ou , — frete, prazo, mínimo, validade e condição usam a primeira linha preenchida do fornecedor.">
              <CsvImport quotationId={id} number={q.number} template={csvTemplate} />
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {suppliers.filter(Boolean).map((sup) => {
              const raw = v.rawProposals.find((p) => p.supplierId === sup!.id) ?? null;
              const expired = raw?.validUntil && raw.validUntil < v.refDate;
              return (
                <Card
                  key={sup!.id}
                  title={<Link className="hover:underline" href={`/fornecedores/${sup!.id}`}>{supplierLabel(sup)}</Link>}
                  description={raw ? `Recebida em ${formatDateTime(raw.receivedAt)} · versão ${raw.version ?? 1}${raw.source === "csv" ? " · importada por CSV" : ""}` : "Aguardando proposta"}
                  actions={
                    <>
                      {raw ? <StatusBadge kind="quotation" status={expired ? "expired" : "received"} /> : <StatusBadge kind="quotation" status="waiting" />}
                      {canEdit && <ProposalDialog quotationId={id} supplier={{ id: sup!.id, name: supplierLabel(sup), leadTimeDays: sup!.leadTimeDays ?? null, minOrderValue: sup!.minOrderValue ?? 0, paymentTermId: sup!.paymentTermId ?? null }} items={v.items.map((i) => ({ skuId: i.skuId, name: i.description, sku: i.sku ?? "", qty: i.qty, unitCode: i.unitCode ?? "UN" }))} proposal={raw} terms={terms} defaultOpen={editar === sup!.id} />}
                      {canEdit && raw && <ActionButton size="sm" variant="ghost" action={removeProposalAction.bind(null, id, sup!.id)} label="Remover" confirm="Remover a proposta deste fornecedor?" />}
                    </>
                  }
                  bodyClass="p-0"
                >
                  {raw ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 px-4 py-3 text-xs sm:grid-cols-4">
                        <span>Frete <b className="block text-sm">{formatMoney(raw.freight)}</b></span>
                        <span>Mínimo <b className="block text-sm">{formatMoney(raw.minOrderValue)}</b></span>
                        <span>Pagamento <b className="block text-sm">{raw.paymentTermsText ?? "—"}</b></span>
                        <span>Válida até <b className={`block text-sm ${expired ? "text-red-700" : ""}`}>{formatDate(raw.validUntil)}</b></span>
                      </div>
                      <table className="table-base w-full text-sm">
                        <thead><tr><th>Produto</th><th className="text-right">Preço</th><th className="text-right">Desc.</th><th>Disponível</th><th>Entrega</th></tr></thead>
                        <tbody>
                          {v.items.map((it) => {
                            const pi = (raw.items ?? []).find((x: any) => x.skuId === it.skuId);
                            return (
                              <tr key={it.skuId}>
                                <td>{it.description}</td>
                                <td className="tabular text-right">{pi ? formatMoney(pi.unitPrice) : <span className="text-xs text-slate-400">não cotado</span>}</td>
                                <td className="tabular text-right">{pi?.discountBps ? formatBps(pi.discountBps, 0) : "—"}</td>
                                <td className="text-xs">{pi ? (pi.available === false ? "Indisponível" : pi.availableQty != null ? `${formatQty(pi.availableQty)} de ${formatQty(it.qty)}` : "Sim") : "—"}</td>
                                <td className="text-xs">{pi?.deliveryDate ? formatDate(pi.deliveryDate) : (pi?.leadTimeDays ?? raw.leadTimeDays) != null ? `${pi?.leadTimeDays ?? raw.leadTimeDays} dias` : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {raw.notes && <p className="px-4 py-2 text-xs text-slate-500">{raw.notes}</p>}
                    </>
                  ) : (
                    <p className="p-4 text-sm text-slate-500">Registre a proposta recebida (e-mail, telefone, portal) ou importe por CSV.</p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
      {tab === "revisao" && (
        <Card
          title={<span className="flex items-center gap-3"><Link href={`${base}?tab=comparacao`} className="inline-flex items-center gap-1 text-sm font-normal text-brand-700 hover:underline"><ArrowLeft className="size-4" /> Voltar e ajustar</Link> Revisar fornecedores escolhidos</span>}
          description={`Cotação nº ${q.number} · destino ${branch?.name ?? "—"} · ${v.items.length} produto(s)`}
        >
          {ev.groups.length === 0 ? (
            <EmptyState title="Nenhum fornecedor selecionado" description="Escolha as propostas na comparação ou use “Selecionar menor total com frete”." />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-line p-3"><p className="text-xs text-slate-500">Produtos</p><p className="tabular text-lg font-semibold">{formatMoney(ev.productsTotal)}</p></div>
                <div className="rounded-md border border-line p-3"><p className="text-xs text-slate-500">Frete</p><p className="tabular text-lg font-semibold">{formatMoney(ev.freightTotal)}</p></div>
                <div className="rounded-md border border-line p-3"><p className="text-xs text-slate-500">Total com frete</p><p className="tabular text-lg font-semibold text-brand-800">{formatMoney(ev.grandTotal)}</p></div>
              </div>
              {ev.groups.map((g) => (
                <section key={g.supplierId} className="rounded-md border border-line">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
                    <span className="font-semibold">{g.supplierName}</span>
                    <span className="text-xs text-slate-600">Pagamento {g.paymentTermsText ?? "—"} · proposta válida até <span className={g.expired ? "font-semibold text-red-700" : ""}>{formatDate(g.validUntil)}</span> · versão {g.version} · mínimo {formatMoney(g.minOrderValue)} {g.belowMinimum && <Badge tone="bad">mínimo não atingido</Badge>}{g.expired && <Badge tone="bad">vencida</Badge>}</span>
                  </header>
                  <table className="table-base w-full text-sm">
                    <thead><tr><th>Produto</th><th className="text-right">Quantidade</th><th className="text-right">Líquido / UN</th><th className="text-right">Subtotal</th></tr></thead>
                    <tbody>
                      {g.items.map((it) => (
                        <tr key={it.skuId}>
                          <td>{it.description}<span className="block text-xs text-slate-500">{it.sku}{it.deliveryDate ? ` · Entrega ${formatDate(it.deliveryDate)}` : ""}{it.neededBy ? ` · necessário ${formatDate(it.neededBy)}` : ""}</span></td>
                          <td className="tabular text-right">{formatQty(it.qty, it.unitCode ?? undefined)}</td>
                          <td className="tabular text-right">{formatMoney(it.netUnit)}<span className="block text-xs text-slate-500">{it.discountBps ? `Desconto ${formatBps(it.discountBps, 0)}` : "Sem desconto"}</span></td>
                          <td className="tabular text-right">{formatMoney(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="flex justify-end gap-6 border-t border-line px-4 py-2 text-sm"><span>Produtos <b className="tabular">{formatMoney(g.products)}</b></span><span>Frete <b className="tabular">{formatMoney(g.freight)}</b></span><span>Total <b className="tabular">{formatMoney(g.total)}</b></span></p>
                </section>
              ))}
              {ev.issues.length > 0 && <Notice tone="warn" title="Pendências antes de gerar">{ev.issues.join(" ")}</Notice>}
              <p className="text-sm text-slate-600">Será criado um pedido em rascunho por fornecedor, com o frete cobrado uma única vez e a mesma condição comercial e versão de proposta exibidas acima. Os números desta revisão são os mesmos da comparação e dos pedidos gerados.</p>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 px-4 py-3">
                <span className="text-sm">{q.ordersCreated ? `${v.orders.length} pedido(s) gerado(s)` : `${ev.groups.length} rascunho(s) a criar`}</span>
                {q.ordersCreated ? (
                  <span className="flex flex-wrap gap-2">{v.orders.map((o) => <Link key={o.id} className="rounded-md border border-line bg-white px-3 py-1 text-sm text-brand-700 hover:underline" href={`/compras/pedidos/${o.id}`}>Pedido nº {o.number} · {formatMoney(o.total)} · <StatusBadge kind="purchase" status={o.status} /></Link>)}</span>
                ) : canEdit && s.ctx.branchId === q.branchId ? (
                  <span className="flex gap-2">
                    <ActionButton action={generateOrdersAction.bind(null, id, false)} label="Criar rascunhos" disabled={ev.unassigned.length > 0 || v.stale.length > 0} confirm={`Criar ${ev.groups.length} pedido(s) em rascunho? Isso só pode ser feito uma vez.`} />
                    <ActionButton variant="accent" action={generateOrdersAction.bind(null, id, true)} label="Criar e enviar para aprovação" disabled={ev.unassigned.length > 0 || v.stale.length > 0} confirm={`Criar ${ev.groups.length} pedido(s) e enviar como uma solicitação de aprovação (total ${formatMoney(ev.grandTotal)})?`} />
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Selecione a filial da cotação para gerar pedidos.</span>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
      {tab === "itens" && (canEdit ? (
        <QuotationForm
          quotation={q}
          items={v.items.map((i) => ({ skuId: i.skuId, sku: i.sku ?? "", name: i.description, unitCode: i.unitCode ?? "UN", qty: i.qty, neededBy: i.neededBy ?? "" }))}
          suppliers={(await listAll(s.ctx.store, "suppliers", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "status", "active"]] })).map((x) => ({ value: x.id, label: supplierLabel(x) }))}
        />
      ) : (
        <Card bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Produto</th><th className="text-right">Quantidade</th><th>Necessário até</th></tr></thead>
            <tbody>{v.items.map((i) => <tr key={i.skuId}><td>{i.description}<span className="block text-xs text-slate-500">{skuMap.get(i.skuId)?.sku}</span></td><td className="tabular text-right">{formatQty(i.qty, i.unitCode ?? undefined)}</td><td>{formatDate(i.neededBy)}</td></tr>)}</tbody>
          </table>
        </Card>
      ))}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`quotation:${id}`]} />
        </Card>
      )}
    </>
  );
}
