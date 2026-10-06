import { notFound } from "next/navigation";
import { canViewBranch } from "../../queries";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { lookups, nameMap } from "@/lib/server/lookups";
import { formatDateTime } from "@/lib/dates";
import { resolveCashSession, returnableItems, returnCompensationPlan } from "@/domain/sales";
import { resolveTerminal } from "../../../pdv/terminal";
import { ReturnForm } from "./return-form";

export const metadata = { title: "Troca ou devolução" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("sales");
  const { id } = await params;
  const store = s.ctx.store;
  const sale = await store.get("sales", id);
  if (!sale || sale.companyId !== s.ctx.companyId || !canViewBranch(s.ctx, sale.branchId)) notFound();
  const header = (
    <PageHeader
      title="Troca ou devolução"
      crumbs={[{ label: "Histórico de vendas", href: "/vendas" }, { label: `Venda nº ${sale.number}`, href: `/vendas/${id}` }, { label: "Nova troca ou devolução" }]}
      description="Selecione os produtos, informe o motivo e defina como o cliente será compensado."
      actions={<LinkButton href={`/vendas/${id}`}><ArrowLeft className="size-4" /> Voltar à venda</LinkButton>}
    />
  );
  const blockers: string[] = [];
  if (!canDo(s.user, "sale.return")) blockers.push("Seu perfil não tem a permissão “Registrar devolução/troca”.");
  if (sale.status !== "completed") blockers.push("Somente vendas concluídas aceitam devolução (esta venda está cancelada).");
  if (!s.ctx.branchId) blockers.push("Selecione a filial da venda (o contexto consolidado é somente consulta).");
  else if (s.ctx.branchId !== sale.branchId) blockers.push("A devolução deve ser registrada na filial onde a venda ocorreu.");
  const items = await returnableItems(store, id);
  if (items.every((i) => i.returnable <= 0)) blockers.push("Todos os itens desta venda já foram devolvidos.");
  if (blockers.length) {
    return (
      <>
        {header}
        <Notice tone="warn" title="Devolução indisponível">{blockers.join(" ")}</Notice>
      </>
    );
  }
  const payments = await listAll(store, "sale_payments", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] });
  const doc = sale.fiscalDocumentId ? await store.get("fiscal_documents", sale.fiscalDocumentId) : null;
  const accounts = await lookups.accounts(s.ctx);
  const branches = await nameMap(s.ctx, "branches");
  // mesma regra do servidor: gaveta do próprio operador (ou do terminal, para supervisor de caixa)
  const { terminal } = await resolveTerminal(s, null);
  const mySession = await resolveCashSession(s.ctx, sale.branchId, [terminal?.id, sale.terminalId]);
  // venda a prazo: o valor devolvido abate primeiro o saldo em aberto do título; só o que já foi pago volta ao cliente
  const previous = await listAll(store, "returns", { filters: [["eq", "saleId", id]] });
  const plan = await returnCompensationPlan(s.ctx, sale, 0, previous);
  const deferred = plan.titles.length ? { open: plan.open, paidAvailable: plan.paidAvailable, forgivenAvailable: plan.forgivenAvailable } : null;
  const pixMethod = (await listAll(store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "kind", "pix"]] }))[0];
  return (
    <>
      {header}
      <ReturnForm
        sale={{ id, number: sale.number, completedAt: formatDateTime(sale.completedAt), total: sale.total, customerName: sale.customerSnapshot?.name ?? null, customerId: sale.customerId ?? null, branchName: branches.get(sale.branchId) ?? "" }}
        doc={doc ? { model: doc.model, number: doc.number ?? null, status: doc.status, id: doc.id } : null}
        items={items.map((i) => ({ id: i.id, sku: i.sku, description: i.description, unitCode: i.unitCode, qty: i.qty, returnable: i.returnable, unitPrice: i.unitPrice, total: i.total, unitNet: i.unitNet, service: !i.warehouseId }))}
        payments={payments.map((p) => ({ kind: p.methodKind, name: p.methodName, amount: p.amount }))}
        accounts={accounts}
        defaultPixAccountId={pixMethod?.accountId ?? null}
        cashSession={mySession ? { id: mySession.id, number: mySession.number, terminalName: terminal?.id === mySession.terminalId ? terminal?.name ?? "" : "" } : null}
        deferred={deferred}
      />
    </>
  );
}
