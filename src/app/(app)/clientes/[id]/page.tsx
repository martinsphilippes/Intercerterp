import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, ShoppingCart } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState } from "@/components/ui/empty";
import { customerSummary } from "@/domain/customers";
import { dueState } from "@/domain/finance";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { setCustomerStatusAction, deleteCustomerAction } from "../actions";

export const metadata = { title: "Cliente" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("customers");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const c = await s.ctx.store.get("customers", id);
  if (!c || c.companyId !== s.ctx.companyId) notFound();
  const sum = await customerSummary(s.ctx, id);
  const users = await nameMap(s.ctx, "users");
  const addr = c.addresses?.[0];
  const base = `/clientes/${id}`;
  return (
    <>
      <PageHeader
        title={c.name}
        crumbs={[{ label: "Clientes", href: "/clientes" }, { label: c.name }]}
        badges={
          <>
            <StatusBadge kind="generic" status={c.status} />
            {c.vip && <Badge tone="accent">VIP</Badge>}
            <Badge>{c.personType === "PF" ? "Pessoa física" : "Pessoa jurídica"}</Badge>
          </>
        }
        description={[c.doc ? formatDoc(c.doc) : "Sem documento", c.code].filter(Boolean).join(" · ")}
        actions={
          <>
            {can(s.user, "pdv", "create") && c.status === "active" && (
              <LinkButton href={`/pdv?cliente=${c.id}`}>
                <ShoppingCart className="size-4" /> Nova venda
              </LinkButton>
            )}
            {can(s.user, "customers", "edit") && (
              <LinkButton href={`${base}/editar`} variant="primary">
                <Pencil className="size-4" /> Editar
              </LinkButton>
            )}
            {can(s.user, "customers", "edit") &&
              (c.status === "inactive" ? (
                <ActionButton action={setCustomerStatusAction.bind(null, id, "active")} label="Reativar" />
              ) : (
                <ActionButton action={setCustomerStatusAction.bind(null, id, "inactive")} label="Inativar" confirm="Inativar o cliente? O histórico é preservado." />
              ))}
            {can(s.user, "customers", "delete") && sum.sales.length === 0 && sum.installments.length === 0 && (
              <ActionButton action={deleteCustomerAction.bind(null, id)} label="Excluir" variant="danger" confirm="Excluir definitivamente? Só é permitido sem operações." />
            )}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Compras" value={sum.salesCount} href={`${base}?tab=compras`} />
        <Stat label="Total comprado (líquido)" value={formatMoney(sum.netTotal)} hint="Vendas − devoluções" />
        <Stat label="Ticket médio" value={formatMoney(sum.ticket)} />
        <Stat label="Em aberto" value={formatMoney(sum.openBalance)} hint={sum.overdueBalance ? `${formatMoney(sum.overdueBalance)} vencido` : "Nada vencido"} tone={sum.overdueBalance ? "bad" : "default"} href={`${base}?tab=financeiro`} />
        <Stat label="Saldo de vale-crédito" value={formatMoney(sum.voucherBalance)} href={`${base}?tab=creditos`} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Cadastro" },
          { key: "compras", label: "Compras", count: sum.sales.length },
          { key: "financeiro", label: "Títulos", count: sum.installments.length },
          { key: "creditos", label: "Créditos", count: sum.vouchers.length },
          { key: "documentos", label: "Documentos fiscais", count: sum.documents.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identificação e contato">
            <DefinitionList
              items={[
                { label: c.personType === "PF" ? "Nome" : "Razão social", value: c.name },
                c.personType === "PJ" && { label: "Nome fantasia", value: c.tradeName },
                { label: c.personType === "PF" ? "CPF" : "CNPJ", value: c.doc ? formatDoc(c.doc) : "—" },
                { label: "E-mail", value: c.email },
                { label: "Celular", value: formatPhone(c.mobile) || "—" },
                { label: "Telefone", value: formatPhone(c.phone) || "—" },
                c.personType === "PF" && { label: "Nascimento", value: formatDate(c.birthDate) },
                c.personType === "PF" && { label: "Gênero", value: c.gender },
                c.personType === "PF" && { label: "Estado civil", value: c.maritalStatus },
                c.personType === "PF" && { label: "Profissão", value: c.profession },
                { label: "Vendedor responsável", value: c.sellerId ? users.get(c.sellerId) : "—" },
                { label: "Promoções", value: c.acceptsPromotions ? `Aceita (${(c.promoChannels ?? []).join(", ") || "—"})` : "Não aceita" },
              ]}
            />
          </Card>
          <Card title="Endereço, fiscal e crédito">
            <DefinitionList
              items={[
                { label: "Endereço", value: addr ? `${addr.street ?? ""}, ${addr.number ?? "s/n"} ${addr.complement ?? ""} — ${addr.district ?? ""}, ${addr.cityName ?? ""}/${addr.uf ?? ""} ${addr.zip ?? ""}` : "—" },
                { label: "Inscrição estadual", value: c.ie },
                { label: "Indicador IE", value: c.ieIndicator },
                { label: "Inscrição municipal", value: c.im },
                { label: "Consumidor final", value: c.finalConsumer ? "Sim" : "Não" },
                { label: "Limite de crédito", value: formatMoney(c.creditLimit) },
                { label: "Disponível no crediário", value: c.creditLimit ? formatMoney(Math.max(0, c.creditLimit - sum.openBalance)) : "Sem limite concedido" },
                { label: "Prazo padrão", value: c.paymentTermDays ? `${c.paymentTermDays} dias` : "À vista" },
                { label: "Observações", value: c.notes },
              ]}
            />
            {(c.addresses ?? []).length > 1 && <p className="mt-3 text-xs text-slate-500">+ {(c.addresses ?? []).length - 1} endereço(s) adicional(is) — veja em Editar.</p>}
          </Card>
        </div>
      )}
      {tab === "compras" && (
        <Card bodyClass="p-0">
          {sum.sales.length === 0 ? (
            <EmptyState title="Sem compras registradas" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Venda</th><th>Data</th><th>Situação</th><th>Fiscal</th><th className="text-right">Total</th><th className="text-right">Devolvido</th></tr>
              </thead>
              <tbody>
                {sum.sales.map((x) => (
                  <tr key={x.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/vendas/${x.id}`}>nº {x.number}</Link></td>
                    <td>{formatDateTime(x.completedAt)}</td>
                    <td><StatusBadge kind="sale" status={x.status} /></td>
                    <td><StatusBadge kind="fiscal" status={x.fiscalStatus} /></td>
                    <td className="tabular text-right">{formatMoney(x.total)}</td>
                    <td className="tabular text-right">{x.returnedTotal ? formatMoney(x.returnedTotal) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "financeiro" && (
        <Card bodyClass="p-0">
          {sum.installments.length === 0 ? (
            <EmptyState title="Sem títulos" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Título / parcela</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th><th className="text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {sum.installments.map((i) => (
                  <tr key={i.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/financeiro/receber/${i.titleId}`}>{i.description} — {i.number}</Link></td>
                    <td>{formatDate(i.dueDate)}</td>
                    <td><StatusBadge kind="title" status={dueState(i)} /></td>
                    <td className="tabular text-right">{formatMoney(i.amount)}</td>
                    <td className="tabular text-right">{formatMoney(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "creditos" && (
        <Card bodyClass="p-0">
          {sum.vouchers.length === 0 ? (
            <EmptyState title="Sem vales-crédito" description="Vales são gerados em devoluções e trocas." />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Código</th><th>Origem</th><th>Situação</th><th>Validade</th><th className="text-right">Emitido</th><th className="text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {sum.vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className="font-mono">{v.code}</td>
                    <td>{v.returnId ? <Link className="text-brand-700 hover:underline" href={`/vendas/devolucoes/${v.returnId}`}>Devolução</Link> : "—"}</td>
                    <td><StatusBadge kind="generic" status={v.status === "used" ? "completed" : v.status} /></td>
                    <td>{formatDate(v.expiresAt)}</td>
                    <td className="tabular text-right">{formatMoney(v.originalAmount)}</td>
                    <td className="tabular text-right">{formatMoney(v.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "documentos" && (
        <Card bodyClass="p-0">
          {sum.documents.length === 0 ? (
            <EmptyState title="Sem documentos fiscais emitidos com este CPF/CNPJ" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Documento</th><th>Emissão</th><th>Situação</th><th className="text-right">Valor</th></tr>
              </thead>
              <tbody>
                {sum.documents.map((d) => (
                  <tr key={d.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/fiscal/${d.model}/${d.id}`}>{d.model.toUpperCase()} {d.number ? `nº ${d.number}` : d.ref}</Link></td>
                    <td>{formatDateTime(d.issuedAt)}</td>
                    <td><span className="flex flex-wrap gap-1"><StatusBadge kind="fiscal" status={d.status} /><SimBadge show={Boolean(d.isSimulated)} /></span></td>
                    <td className="tabular text-right">{formatMoney(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`customer:${id}`]} />
        </Card>
      )}
    </>
  );
}
