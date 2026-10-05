import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Download, FileCheck2 } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { listAll } from "@/lib/db";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { confirmBlockers, effectsOf, orderMatchRate, receiptItemStatus, receiptMovements, type ReceiptItem } from "@/domain/receipts";
import { orderItems } from "@/domain/purchases";
import { supplierLabel } from "@/domain/suppliers";
import { cancelReceiptAction, resumeConfirmAction } from "../actions";
import { Conference } from "./conference";

export const metadata = { title: "Recebimento" };

function Stepper({ steps }: { steps: Array<{ label: string; hint: string; state: "done" | "active" | "todo" }> }) {
  return (
    <ol className="mb-5 grid gap-2 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li key={i} className={cn("flex items-center gap-3 rounded-lg border bg-white p-3", s.state === "active" ? "border-accent-500 ring-1 ring-accent-500" : "border-line")}>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", s.state === "done" ? "bg-emerald-600 text-white" : s.state === "active" ? "bg-accent-500 text-white" : "bg-slate-100 text-slate-500")}>{s.state === "done" ? <Check className="size-4" /> : i + 1}</span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{s.label}</span>
            <span className="block truncate text-xs text-slate-500">{s.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("purchases");
  const { id } = await params;
  const store = s.ctx.store;
  const r = await store.get("receipts", id);
  if (!r || r.companyId !== s.ctx.companyId) notFound();
  const supplier = await store.get("suppliers", r.supplierId);
  const items: ReceiptItem[] = r.items ?? [];
  const divergences = r.divergences ?? [];
  const linkedOrders = (await Promise.all((r.orderIds ?? []).map((oid: string) => store.get("purchase_orders", oid)))).filter(Boolean) as any[];
  const draft = r.status === "draft";
  const eff = effectsOf(r);
  const active = items.filter((i) => !i.ignore);
  const checked = active.filter((i) => i.checked).length;
  const match = orderMatchRate(items);
  const tot = r.emitter?.totals ?? null;
  const [users, terms, methods, categories, costCenters] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "payment_terms"), nameMap(s.ctx, "payment_methods"), nameMap(s.ctx, "fin_categories"), nameMap(s.ctx, "cost_centers")]);
  const wh = r.warehouseId ? await store.get("warehouses", r.warehouseId) : null;
  const confirmed = r.status === "confirmed";
  const canReceive = canDo(s.user, "purchase.receive") && s.ctx.branchId === r.branchId;
  const steps = [
    { label: r.xmlFileId ? "NF-e importada" : "Documento informado", hint: r.xmlFileId ? "XML validado" : r.nfeKey ? "Chave informada (sem XML)" : "Sem XML", state: "done" as const },
    { label: "Pedido vinculado", hint: linkedOrders.length ? linkedOrders.map((o) => `nº ${o.number}`).join(", ") : "Sem pedido", state: (linkedOrders.length ? "done" : draft ? "active" : "done") as "done" | "active" },
    { label: "Conferência física", hint: confirmed ? `${active.length} de ${active.length} itens` : `${checked} de ${active.length} itens conferidos`, state: (confirmed ? "done" : draft && linkedOrders.length >= 0 ? "active" : "todo") as "done" | "active" | "todo" },
    { label: "Concluir entrada", hint: "Estoque e financeiro", state: (confirmed ? "done" : "todo") as "done" | "todo" },
  ];
  const stockUnits = active.filter((i) => i.skuId).reduce((a, i) => a + i.receivedQty, 0);
  const costProducts = new Set(active.filter((i) => i.skuId && i.receivedQty > 0).map((i) => i.skuId)).size;
  const installments: any[] = r.installments ?? [];
  const keyFmt = (r.nfeKey ?? "").replace(/(\d{4})(?=\d)/g, "$1 ");
  // dados do formulário de conferência
  let conf: any = null;
  if (draft) {
    const open = await listAll(store, "purchase_orders", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "supplierId", r.supplierId], ["eq", "branchId", r.branchId], ["eq", "status", ["approved", "sent", "partial"]]] });
    const orders = [...new Map([...linkedOrders, ...open].map((o) => [o.id, o])).values()].sort((a, b) => a.number - b.number);
    const skuOpts = new Map<string, string>();
    for (const o of orders) for (const it of await orderItems(store, o.id)) skuOpts.set(it.skuId, `${it.description} (pedido nº ${o.number})`);
    const [warehouses, termsL, methodsL, cats, ccs] = await Promise.all([
      listAll(store, "warehouses", { filters: [["eq", "branchId", r.branchId]] }),
      listAll(store, "payment_terms", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
      listAll(store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
      listAll(store, "fin_categories", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "type", "expense"]] }),
      listAll(store, "cost_centers", { filters: [["eq", "companyId", s.ctx.companyId]] }),
    ]);
    conf = {
      receipt: { id, hasXml: Boolean(r.xmlFileId), supplierId: r.supplierId, warehouseId: r.warehouseId, orderIds: r.orderIds ?? [], freight: r.freight ?? 0, otherExpenses: r.otherExpenses ?? 0, discount: r.discount ?? 0, invoicedTotal: r.invoicedTotal ?? null, paymentTermId: r.paymentTermId ?? null, paymentMethodId: r.paymentMethodId ?? null, entryCfop: r.entryCfop ?? null, categoryId: r.categoryId ?? null, costCenterId: r.costCenterId ?? null, differenceAction: r.differenceAction ?? "adjust_to_due", notes: r.notes ?? null, effects: eff, hasDuplicatas: (r.emitter?.duplicatas ?? []).length > 0 },
      items: items.map((i) => ({ idx: i.idx, cProd: i.cProd ?? null, xProd: i.xProd ?? null, uCom: i.uCom ?? null, invoicedQtySupplier: i.invoicedQtySupplier ?? null, conversionFactor: i.conversionFactor ?? 1000, invoicedQty: i.invoicedQty, invoicedValue: i.invoicedValue, invoiceUnitCost: i.invoiceUnitCost, skuId: i.skuId, sku: i.sku ?? null, description: i.description, unitCode: i.unitCode ?? null, mapping: i.mapping ?? null, expectedQty: i.expectedQty ?? 0, orderUnitCost: i.orderUnitCost ?? null, receivedQty: i.receivedQty, unitCost: i.unitCost, ignore: Boolean(i.ignore), divergence: i.divergence ?? null, checked: Boolean(i.checked), lot: i.lot ?? null, expiry: i.expiry ?? null, status: receiptItemStatus(i, divergences) })),
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, expectedDate: o.expectedDate ?? null })),
      orderSkus: [...skuOpts.entries()].map(([skuId, label]) => ({ skuId, label })),
      warehouses: warehouses.map((w) => ({ value: w.id, label: w.name })),
      terms: termsL.map((t) => ({ value: t.id, label: t.name })),
      methods: methodsL.filter((m) => !["crediario", "store_credit"].includes(m.kind)).map((m) => ({ value: m.id, label: m.name })),
      categories: cats.map((c) => ({ value: c.id, label: c.name })),
      costCenters: ccs.map((c) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name })),
      blockers: confirmBlockers(r),
    };
  }
  const movements = confirmed ? await receiptMovements(store, id) : [];
  return (
    <>
      <PageHeader
        title={`Recebimento nº ${r.number}`}
        crumbs={[{ label: "Recebimentos", href: "/compras/recebimentos" }, { label: `nº ${r.number}` }]}
        badges={<StatusBadge kind="receipt" status={r.status} />}
        description={`${supplier ? supplierLabel(supplier) : r.emitter?.name ?? "—"} · ${wh?.name ?? ""} · aberto em ${formatDateTime(r.createdAt)} por ${users.get(r.createdBy) ?? "—"}${confirmed ? ` · confirmado em ${formatDateTime(r.confirmedAt)} por ${users.get(r.confirmedBy) ?? "—"}` : ""}`}
        actions={
          <>
            {r.xmlFileId && <LinkButton href={`/api/files/${r.xmlFileId}`}><Download className="size-4" /> XML</LinkButton>}
            {r.status === "confirming" && canReceive && <ActionButton variant="primary" action={resumeConfirmAction.bind(null, id)} label="Concluir confirmação interrompida" />}
            {draft && canReceive && <ActionButton variant="danger" action={cancelReceiptAction.bind(null, id)} label="Cancelar recebimento" askReason="Motivo do cancelamento (a chave poderá ser importada novamente):" />}
          </>
        }
      />
      <Stepper steps={steps} />
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <FileCheck2 className="mt-1 size-8 text-brand-700" aria-hidden />
            <div>
              <p className="text-base font-semibold">{r.nfeNumber ? `NF-e ${r.nfeNumber.padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3")} — Série ${r.nfeSeries ?? "—"}` : "Documento sem número"}</p>
              {r.nfeKey && <p className="tabular font-mono text-xs text-slate-600">{keyFmt}</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                {r.xmlFileId ? <Badge tone="good">XML validado (estrutura e chave)</Badge> : <Badge tone="warn">Sem XML</Badge>}
                {r.emitter?.authorized && <Badge tone="good">Autorizada · protocolo {r.emitter?.protocol}</Badge>}
                {r.xmlFileId && !r.emitter?.authorized && <Badge tone="warn">Sem protocolo de autorização no XML</Badge>}
              </div>
            </div>
          </div>
          <DefinitionList
            cols={4}
            items={[
              { label: "Fornecedor", value: supplier ? <Link className="text-brand-700 hover:underline" href={`/fornecedores/${supplier.id}`}>{supplierLabel(supplier)}</Link> : r.emitter?.name },
              { label: "Emissão", value: r.nfeIssueDate ? formatDateTime(r.nfeIssueDate) : "—" },
              { label: "Valor total", value: formatMoney(r.invoicedTotal) },
              { label: "Natureza da operação", value: r.emitter?.nature ?? "—" },
            ]}
          />
        </div>
        <div className={cn("mt-4 rounded-md px-3 py-2 text-sm", linkedOrders.length ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
          {linkedOrders.length ? (
            <>
              Pedido(s) {linkedOrders.map((o, i) => <span key={o.id}>{i > 0 && ", "}<Link className="font-medium underline" href={`/compras/pedidos/${o.id}`}>nº {o.number}</Link></span>)} vinculado(s) · {match}% de correspondência (produto, quantidade dentro do saldo e custo)
            </>
          ) : (
            "Nenhum pedido vinculado — itens serão registrados como fora de pedido (divergência)."
          )}
        </div>
      </Card>

      {draft && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <Card title="Totais da NF-e">
            <DefinitionList
              cols={3}
              items={[
                { label: "Produtos", value: formatMoney(tot ? tot.vProd - tot.vDesc : r.productsTotal) },
                { label: "Frete", value: formatMoney(r.freight) },
                { label: "IPI", value: formatMoney(tot?.vIPI ?? 0) },
                { label: "ICMS destacado (informativo)", value: formatMoney(tot?.vICMS ?? 0) },
                { label: "Outras despesas/seguro/ST", value: formatMoney(Math.max(0, (r.otherExpenses ?? 0) - (tot?.vIPI ?? 0))) },
                { label: "Total da NF-e", value: <strong>{formatMoney(r.invoicedTotal)}</strong> },
              ]}
            />
          </Card>
          <Card title="Impactos previstos da entrada" description="Conforme o último salvamento da conferência.">
            <DefinitionList
              cols={2}
              items={[
                { label: "Estoque", value: eff.updateStock ? `+${formatQty(stockUnits)} unidades em ${wh?.name ?? "—"}` : "Não será atualizado" },
                { label: "Novo custo médio", value: eff.updateCost ? `Atualizado em ${costProducts} produto(s)` : "Custo não será atualizado" },
                { label: "Contas a pagar", value: eff.createPayable ? `${installments.length} parcela(s) · ${formatMoney(installments.reduce((a, x) => a + x.amount, 0))}` : "Não será gerado" },
                { label: "Vencimentos", value: installments.map((x) => formatDate(x.dueDate)).join(" e ") || "—" },
                { label: "Crédito de ICMS", value: tot?.vICMS ? `${formatMoney(tot.vICMS)} destacado — apuração conforme regime no módulo Fiscal` : "Sem ICMS destacado" },
                { label: "Valor devido", value: formatMoney(r.dueTotal) },
              ]}
            />
          </Card>
        </div>
      )}
      {draft && conf && canReceive && <Conference key={r.updatedAt} {...conf} />}
      {draft && !canReceive && <Notice tone="warn">Somente usuários com “Receber mercadorias” na filial do recebimento podem conferir e concluir.</Notice>}

      {!draft && (
        <div className="space-y-5">
          <Card bodyClass="p-0" title="Conferência dos produtos" description={`${formatQty(stockUnits)} unidades · ${active.length} item(ns)`}>
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Produto</th><th className="text-right">Pedido</th><th className="text-right">NF-e</th><th className="text-right">Recebido</th><th className="text-right">Diferença</th><th className="text-right">Custo unit.</th><th className="text-right">Frete/desp. rateados</th><th className="text-right">Custo de entrada</th><th>Lote / validade</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.idx}>
                      <td>{i.description}<span className="block text-xs text-slate-500">{i.sku}{i.cProd ? ` · NF-e ${i.cProd}` : ""}{i.divergence ? ` · ${i.divergence}` : ""}</span></td>
                      <td className="tabular text-right">{i.expectedQty ? formatQty(i.expectedQty) : "—"}</td>
                      <td className="tabular text-right">{formatQty(i.invoicedQty)}</td>
                      <td className="tabular text-right">{formatQty(i.receivedQty)}</td>
                      <td className={cn("tabular text-right", i.receivedQty === i.invoicedQty ? "text-emerald-700" : "text-red-700")}>{formatQty(i.receivedQty - i.invoicedQty)}</td>
                      <td className="tabular text-right">{formatMoney(i.unitCost)}</td>
                      <td className="tabular text-right">{formatMoney((i.freightShare ?? 0) + (i.otherShare ?? 0) - (i.discountShare ?? 0))}</td>
                      <td className="tabular text-right">{formatMoney(i.landedUnitCost ?? i.unitCost)}</td>
                      <td className="text-xs">{[i.lot, i.expiry ? `val. ${formatDate(i.expiry)}` : null].filter(Boolean).join(" · ") || "—"}</td>
                      <td><StatusBadge kind="receipt_item" status={receiptItemStatus(i, divergences, confirmed)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Totais da NF-e">
              <DefinitionList
                cols={1}
                items={[
                  { label: "Produtos", value: formatMoney(tot ? tot.vProd - tot.vDesc : r.productsTotal) },
                  { label: "Frete", value: formatMoney(r.freight) },
                  { label: "IPI", value: formatMoney(tot?.vIPI ?? 0) },
                  { label: "ICMS destacado (informativo)", value: formatMoney(tot?.vICMS ?? 0) },
                  { label: "Outras despesas/seguro/ST", value: formatMoney((r.otherExpenses ?? 0) - (tot?.vIPI ?? 0)) },
                  { label: "Total da NF-e", value: <strong>{formatMoney(r.invoicedTotal)}</strong> },
                  { label: "Valor devido pelo recebido", value: <strong>{formatMoney(r.dueTotal)}</strong> },
                ]}
              />
            </Card>
            <Card title="Impactos da entrada">
              <DefinitionList
                cols={1}
                items={[
                  { label: "Estoque", value: eff.updateStock ? <span>+{formatQty(stockUnits)} unidades em {wh?.name} ({movements.length} movimento(s))</span> : "Não atualizado (efeito desmarcado)" },
                  { label: "Custo", value: eff.updateCost ? `Custo de aquisição e médio atualizados em ${costProducts} produto(s)` : "Custo não atualizado" },
                  { label: "Contas a pagar", value: r.payableTitleId ? <Link className="text-brand-700 hover:underline" href={`/financeiro/pagar/${r.payableTitleId}`}>{installments.length} parcela(s) · {formatMoney(installments.reduce((a, x) => a + x.amount, 0))}</Link> : eff.createPayable ? "—" : "Não gerado (efeito desmarcado)" },
                  { label: "Vencimentos", value: installments.map((x) => formatDate(x.dueDate)).join(" e ") || "—" },
                  { label: "CFOP / plano de contas / centro de custo", value: [r.entryCfop, r.categoryId ? categories.get(r.categoryId) : null, r.costCenterId ? costCenters.get(r.costCenterId) : null].filter(Boolean).join(" · ") || "—" },
                  { label: "Pagamento", value: [r.paymentMethodId ? methods.get(r.paymentMethodId) : null, r.paymentTermId ? terms.get(r.paymentTermId) : null, installments[0]?.source === "xml" ? "duplicatas do XML" : null].filter(Boolean).join(" · ") || "—" },
                ]}
              />
            </Card>
            <Card title="Observações e divergências">
              {r.notes && <p className="mb-2 whitespace-pre-line text-sm">{r.notes}</p>}
              {r.differenceAction === "pay_invoiced" && <Badge tone="warn">Pago pelo valor faturado (justificado)</Badge>}
              {divergences.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-red-800">{divergences.map((d: any, i: number) => <li key={i}>{d.message}</li>)}</ul> : <p className="text-sm text-emerald-700">Sem divergências.</p>}
            </Card>
          </div>
          {movements.length > 0 && (
            <Card bodyClass="p-0" title="Movimentos de estoque gerados">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Produto</th><th className="text-right">Quantidade</th><th className="text-right">Saldo antes → depois</th><th className="text-right">Custo unit.</th><th className="text-right">Custo médio após</th><th>Data</th></tr></thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{m.productId ? <Link className="text-brand-700 hover:underline" href={`/produtos/${m.productId}?tab=estoque`}>{items.find((i) => i.skuId === m.skuId)?.description ?? m.skuId}</Link> : m.skuId}</td>
                      <td className="tabular text-right">+{formatQty(m.qty)}</td>
                      <td className="tabular text-right">{formatQty(m.balanceBefore)} → {formatQty(m.balanceAfter)}</td>
                      <td className="tabular text-right">{formatMoney(m.unitCost)}</td>
                      <td className="tabular text-right">{formatMoney(m.avgCostAfter)}</td>
                      <td>{formatDateTime(m.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
      {draft && divergences.length > 0 && (
        <Card className="mt-5" title="Divergências encontradas (último salvamento)">
          <ul className="list-disc space-y-1 pl-4 text-sm text-red-800">{divergences.map((d: any, i: number) => <li key={i}>{d.message}</li>)}</ul>
          {installments.length > 0 && <p className="mt-3 text-sm text-slate-600">Parcelas a gerar: {installments.map((x) => `${formatDate(x.dueDate)} ${formatMoney(x.amount)}`).join(" · ")} ({installments[0]?.source === "xml" ? "duplicatas do XML" : "condição de pagamento"})</p>}
        </Card>
      )}
      {draft && !divergences.length && installments.length > 0 && <p className="mt-3 text-sm text-slate-600">Parcelas a gerar: {installments.map((x) => `${formatDate(x.dueDate)} ${formatMoney(x.amount)}`).join(" · ")} ({installments[0]?.source === "xml" ? "duplicatas do XML" : "condição de pagamento"})</p>}
      <Card className="mt-5" title="Linha do tempo">
        <Timeline store={store} refs={[`receipt:${id}`]} />
      </Card>
      <p className="mt-2 text-xs text-slate-500">Emitente: {r.emitter?.name} {r.emitter?.cnpj ? `(${formatDoc(r.emitter.cnpj)})` : ""}</p>
    </>
  );
}
