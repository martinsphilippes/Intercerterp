import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Check, FileText, Pencil } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { listAll } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney, formatQty, QTY, roundDiv } from "@/lib/money";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { pendingQty, transferCode, transferDocuments, transferItemsFromMovements, type TransferItem } from "@/domain/transfers";
import { separateTransferAction, shipTransferAction, cancelTransferAction } from "../../actions";
import { canSeeBranch } from "../../queries";
import { PrintButton, ReceiveForm, ResolveForm, DocumentForm } from "./forms";

export const metadata = { title: "Transferência" };

const STEPS = [
  { key: "draft", label: "Rascunho" },
  { key: "separated", label: "Separado (reservado)" },
  { key: "in_transit", label: "Em trânsito" },
  { key: "received", label: "Recebido" },
];
const DIV_LABEL: Record<string, [string, "bad" | "warn" | "info" | "neutral"]> = { damaged: ["Avaria", "warn"], missing: ["Falta", "bad"], returned: ["Retorno à origem", "info"], lost: ["Perda (falta baixada)", "bad"] };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const s = await requireSession("stock");
  const { id } = await params;
  const { print } = await searchParams;
  const ctx = s.ctx;
  const t = await ctx.store.get("transfers", id);
  if (!t || t.companyId !== ctx.companyId) notFound();
  // usuário restrito a filiais: só vê transferências que envolvem uma filial dele
  if (!canSeeBranch(ctx, t.fromBranchId) && !canSeeBranch(ctx, t.toBranchId)) notFound();
  const [branches, warehouses, users, docs, movements] = await Promise.all([
    nameMap(ctx, "branches"),
    nameMap(ctx, "warehouses"),
    nameMap(ctx, "users"),
    can(s.user, "fiscal") ? transferDocuments(ctx, id) : Promise.resolve([]),
    listAll(ctx.store, "stock_movements", { filters: [["eq", "originType", "transfer"], ["eq", "originId", id]] }),
  ]);
  const items: TransferItem[] = ["draft", "separated", "shipping", "cancelled"].includes(t.status) && !movements.length ? t.items : await transferItemsFromMovements(ctx, t);
  const code = transferCode(t.number);
  const canEdit = can(s.user, "stock", "edit");
  const atOrigin = ctx.branchId === t.fromBranchId;
  const atDest = ctx.branchId === t.toBranchId;
  const pending = items.reduce((a, i) => a + pendingQty(i), 0);
  const totalQty = items.reduce((a, i) => a + i.qty, 0);
  const cost = t.totalCost ?? items.reduce((a, i) => a + roundDiv(i.qty * (i.unitCost ?? 0), QTY), 0);
  const stepIndex = t.status === "partial" ? 2 : t.status === "shipping" ? 1 : Math.max(0, STEPS.findIndex((x) => x.key === t.status));
  const shippedCount = items.filter((i) => i.shippedQty > 0).length;
  const divergences = (t.divergences ?? []) as any[];
  const skuName = new Map(items.map((i) => [i.skuId, `${i.sku} — ${i.name}`]));
  return (
    <>
      <PageHeader
        title={`Transferência ${code}`}
        crumbs={[{ label: "Transferências", href: "/estoque/transferencias" }, { label: code }]}
        badges={<><StatusBadge kind="transfer" status={t.status} />{divergences.some((d) => d.kind !== "returned" && (d.kind !== "missing" || d.open)) && <Badge tone="bad">Divergência</Badge>}</>}
        description={`${branches.get(t.fromBranchId)} → ${branches.get(t.toBranchId)} · criada em ${formatDateTime(t.createdAt)} por ${users.get(t.createdBy) ?? "—"}`}
        actions={
          <>
            <PrintButton auto={print === "1"} />
            <LinkButton href={`/estoque/movimentos?origem=transfer:${id}&filial=all`}>Movimentos</LinkButton>
            {canEdit && atOrigin && t.status === "draft" && (
              <LinkButton href={`/estoque/transferencias/${id}/editar`}><Pencil className="size-4" /> Editar</LinkButton>
            )}
            {canEdit && atOrigin && t.status === "draft" && <ActionButton action={separateTransferAction.bind(null, id)} label="Separar (reservar)" />}
            {canEdit && atOrigin && ["draft", "separated", "shipping"].includes(t.status) && <ActionButton action={shipTransferAction.bind(null, id)} label={t.status === "shipping" ? "Concluir expedição" : "Expedir"} variant="accent" confirm={t.status === "shipping" ? "Concluir a expedição dos itens que ainda não saíram da origem?" : "Expedir agora? A mercadoria sai da origem e fica em trânsito até o recebimento."} />}
            {canEdit && atOrigin && ["draft", "separated", "shipping"].includes(t.status) && <ActionButton action={cancelTransferAction.bind(null, id)} label="Cancelar" variant="ghost" askReason={shippedCount ? "Motivo do cancelamento (o que já saiu volta à origem):" : "Motivo do cancelamento:"} />}
          </>
        }
      />
      <ol className="no-print mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Andamento">
        {STEPS.map((st, i) => {
          const done = t.status !== "cancelled" && i <= stepIndex;
          return (
            <li key={st.key} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", done ? "border-brand-200 bg-brand-50 text-brand-800" : "border-line bg-white text-slate-500")}>
              <span className={cn("flex size-5 items-center justify-center rounded-full text-xs", done ? "bg-brand-700 text-white" : "bg-slate-200")}>{done ? <Check className="size-3" /> : i + 1}</span>
              {st.key === "received" && t.status === "partial" ? "Recebido parcial" : st.label}
            </li>
          );
        })}
      </ol>
      {t.status === "cancelled" && <div className="mb-4"><Notice tone="warn" title="Transferência cancelada">{t.cancelReason ?? "Pendente devolvido integralmente à origem."}</Notice></div>}
      {t.status === "shipping" && (
        <div className="mb-4">
          <Notice tone="warn" title="Expedição incompleta">
            {shippedCount} de {items.length} item(ns) já saíram da origem e estão em trânsito. {atOrigin ? "Use \"Concluir expedição\" depois de regularizar o estoque, ou \"Cancelar\" para devolver à origem o que já saiu." : `Conclua ou cancele no contexto da filial ${branches.get(t.fromBranchId)}.`}
          </Notice>
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Produtos · unidades" value={`${items.length} · ${formatQty(totalQty)}`} />
        <Stat label="Valor de custo" value={formatMoney(cost)} hint={t.shippedAt ? "Custo médio da origem na expedição" : "Estimado após a expedição"} />
        <Stat label="Pendente em trânsito" value={formatQty(pending)} hint={t.expectedAt ? `Previsão de chegada ${formatDate(t.expectedAt)}` : "Sem previsão informada"} tone={pending ? "warn" : "default"} />
        <Stat label="Divergências" value={divergences.filter((d) => d.kind !== "returned").length} hint="Avaria, falta, perda" tone={divergences.some((d) => d.kind === "damaged" || d.kind === "lost") ? "bad" : "default"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card title="Itens" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Expedido</th><th className="text-right">Recebido</th><th className="text-right">Avariado</th><th className="text-right">Devolvido</th><th className="text-right">Perdido</th><th className="text-right">Em trânsito</th><th className="text-right">Custo unit.</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.skuId}>
                      <td className="min-w-48"><Link className="text-brand-700 hover:underline" href={`/produtos/${i.productId}?tab=estoque`}>{i.name}</Link><span className="block font-mono text-xs text-slate-500">{i.sku}</span></td>
                      <td className="tabular text-right">{formatQty(i.qty)} <span className="text-xs text-slate-400">{i.unitCode}</span></td>
                      <td className="tabular text-right">{formatQty(i.shippedQty)}</td>
                      <td className="tabular text-right">{formatQty(i.receivedQty)}</td>
                      <td className={cn("tabular text-right", i.damagedQty ? "text-amber-700" : "")}>{formatQty(i.damagedQty)}</td>
                      <td className="tabular text-right">{formatQty(i.returnedQty)}</td>
                      <td className={cn("tabular text-right", i.lostQty ? "text-red-700" : "")}>{formatQty(i.lostQty)}</td>
                      <td className="tabular text-right font-semibold">{formatQty(pendingQty(i))}</td>
                      <td className="tabular text-right">{i.shippedQty ? formatMoney(i.unitCost) : "—"}</td>
                      <td className="tabular text-right">{i.shippedQty ? formatMoney(roundDiv(i.shippedQty * i.unitCost, QTY)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {["in_transit", "partial"].includes(t.status) && (
            <Card title="Recebimento no destino" description={atDest ? "Confira a mercadoria e registre o que chegou." : `O recebimento é registrado no contexto da filial ${branches.get(t.toBranchId)}.`}>
              {atDest && canEdit ? (
                <ReceiveForm
                  key={items.map((i) => `${i.skuId}:${pendingQty(i)}`).join("|")}
                  transferId={id}
                  items={items.filter((i) => pendingQty(i) > 0).map((i) => ({ skuId: i.skuId, sku: i.sku, name: i.name, unitCode: i.unitCode, pending: pendingQty(i) }))}
                />
              ) : (
                <Notice tone="info">Selecione a filial de destino no topo para registrar o recebimento.</Notice>
              )}
            </Card>
          )}
          {["in_transit", "partial", "cancelled"].includes(t.status) && pending > 0 && (atOrigin || atDest) && canEdit && (
            <Card title="Pendente em trânsito" description="Mercadoria não recebida: devolva à origem (transfer_return) ou baixe como perda (retorno + perda na origem, com motivo).">
              <ResolveForm transferId={id} pendingText={`${formatQty(pending)} un.`} />
            </Card>
          )}

          {divergences.length > 0 && (
            <Card title="Divergências" bodyClass="p-0">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th className="text-right">Qtd.</th><th>Observação</th><th>Usuário</th><th>Situação</th></tr></thead>
                <tbody>
                  {divergences.map((d, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{formatDateTime(d.at)}</td>
                      <td><Badge tone={DIV_LABEL[d.kind]?.[1] ?? "neutral"}>{DIV_LABEL[d.kind]?.[0] ?? d.kind}</Badge></td>
                      <td className="text-xs">{skuName.get(d.skuId) ?? d.skuId}</td>
                      <td className="tabular text-right">{formatQty(d.qty)}</td>
                      <td className="text-xs text-slate-600">{d.note ?? "—"}{d.warehouseId ? ` · depósito ${warehouses.get(d.warehouseId) ?? ""}` : ""}</td>
                      <td className="text-xs">{users.get(d.by) ?? "—"}</td>
                      <td className="text-xs">{d.kind === "missing" ? (d.open ? <Badge tone="warn">Em aberto</Badge> : <Badge>{d.resolvedAs === "return" ? "Devolvida" : d.resolvedAs === "loss" ? "Baixada" : "Atualizada"}</Badge>) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {(t.receipts ?? []).length > 0 && (
            <Card title="Recebimentos registrados">
              <ul className="space-y-2 text-sm">
                {(t.receipts as any[]).map((r) => (
                  <li key={r.key} className="rounded-md border border-line p-2">
                    <span className="font-medium">{formatDateTime(r.at)}</span> · {users.get(r.by) ?? "—"} — {r.lines.map((l: any) => `${skuName.get(l.skuId)?.split(" — ")[0]}: ${formatQty(l.receivedQty)} bom${l.damagedQty ? ` + ${formatQty(l.damagedQty)} avariado` : ""}`).join("; ")}
                    {r.notes && <span className="block text-xs text-slate-500">{r.notes}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Dados da transferência">
            <DefinitionList
              cols={1}
              items={[
                { label: "Origem", value: `${branches.get(t.fromBranchId)} · ${warehouses.get(t.fromWarehouseId) ?? "—"}` },
                { label: "Destino", value: `${branches.get(t.toBranchId)} · ${warehouses.get(t.toWarehouseId) ?? "—"}` },
                { label: "Responsável pelo envio", value: users.get(t.responsibleId) ?? "—" },
                { label: "Previsão de chegada", value: formatDate(t.expectedAt) },
                { label: "Separada em", value: formatDateTime(t.separatedAt) },
                { label: "Expedida em", value: t.shippedAt ? `${formatDateTime(t.shippedAt)} por ${users.get(t.shippedBy) ?? "—"}` : "—" },
                { label: "Recebida em", value: t.receivedAt ? `${formatDateTime(t.receivedAt)} por ${users.get(t.receivedBy) ?? "—"}` : "—" },
                { label: "Observações", value: t.notes },
              ]}
            />
          </Card>
          <Card title="Documento fiscal de transferência" description="NF-e de transferência (CFOP 5152/6152) é emitida pela frente fiscal com origem nesta transferência.">
            <div className="space-y-3">
              {docs.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {docs.map((d) => (
                    <li key={d.id}><Link className="text-brand-700 hover:underline" href={`/fiscal/${d.model}/${d.id}`}>{String(d.model).toUpperCase()} {d.number ? `nº ${d.number}` : d.ref}</Link> <StatusBadge kind="fiscal" status={d.status} /></li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Nenhum documento emitido pelo ERP para esta transferência.</p>
              )}
              {can(s.user, "fiscal", "create") && t.status !== "draft" && t.status !== "cancelled" && (
                <LinkButton href={`/fiscal/nfe/nova?origem=transfer:${id}`} size="sm"><FileText className="size-4" /> Emitir NF-e de transferência</LinkButton>
              )}
              {canEdit && atOrigin && t.status !== "cancelled" ? (
                <DocumentForm transferId={id} value={t.documentRef ?? null} />
              ) : (
                <p className="text-sm text-slate-600">{t.documentRef ? `Referência: ${t.documentRef}` : "Sem documento de referência."}{canEdit && !atOrigin && t.status !== "cancelled" ? ` A referência é informada no contexto da filial ${branches.get(t.fromBranchId)}.` : ""}</p>
              )}
            </div>
          </Card>
          <Card title="Linha do tempo">
            <Timeline store={ctx.store} refs={[`transfer:${id}`]} />
          </Card>
        </div>
      </div>
    </>
  );
}
