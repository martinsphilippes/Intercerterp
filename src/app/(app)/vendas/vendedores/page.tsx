import Link from "@/components/ui/link";
import { Pencil, Power, PowerOff } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { featureOn } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { Timeline } from "@/components/ui/timeline";
import { can, canDo } from "@/lib/permissions";
import { formatBps } from "@/lib/money";
import { formatPhone } from "@/lib/core/text";
import { sp, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { listSellers } from "@/domain/sellers";
import { SellerForm } from "./seller-form";
import { setSellerActiveAction } from "./actions";

export const metadata = { title: "Vendedores" };

/** Vendedores (CAD-05): usuários que vendem e vendedores sem acesso ao sistema, com percentuais de comissão. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("sales");
  const params = await searchParams;
  const [sellers, categories, commissionsOn] = await Promise.all([listSellers(s.ctx), lookups.categories(s.ctx), featureOn(s, "comissoes")]);
  const catName = new Map(categories.map((c) => [c.value, c.label]));
  const manage = can(s.user, "sales", "edit") && canDo(s.user, "sales.commissions");
  const create = can(s.user, "sales", "create") && canDo(s.user, "sales.commissions");
  const filter = sp(params, "tipo");
  const rows = sellers.filter((r) => (filter === "sem-acesso" ? r.loginDisabled : filter === "usuarios" ? !r.loginDisabled : true));
  const editId = sp(params, "editar");
  const editing = manage && editId ? (sellers.find((r) => r.id === editId) ?? null) : null;
  const withRate = sellers.filter((r) => r.active && (r.commissionBps != null || Object.keys(r.commissionByCategory).length)).length;
  const tab = (key: string, label: string) => (
    <Link href={`/vendas/vendedores${key ? `?tipo=${key}` : ""}`} className={buttonClass(filter === key ? "primary" : "ghost", "sm")} aria-current={filter === key ? "page" : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Vendedores"
        crumbs={[{ label: "Vendas" }, { label: "Vendedores" }]}
        description="Quem pode ser escolhido como vendedor no PDV, nas metas e nas comissões. Vendedores externos ou representantes podem ser cadastrados sem acesso ao sistema (sem login, perfil ou convite)."
        actions={
          commissionsOn && canDo(s.user, "sales.commissions") ? (
            <Link href="/vendas/comissoes" className={buttonClass("secondary")}>
              Ver comissões
            </Link>
          ) : null
        }
      />
      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendedores ativos" value={sellers.filter((r) => r.active).length} />
        <Stat label="Sem acesso ao sistema" value={sellers.filter((r) => r.loginDisabled && r.active).length} hint="Cadastro só para vendas" />
        <Stat label="Com percentual de comissão" value={withRate} />
        <Stat label="Inativos" value={sellers.filter((r) => !r.active).length} />
      </section>
      <div className="grid gap-4 2xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="2xl:col-span-2" title="Vendedores e percentuais" bodyClass="p-0" actions={<div className="flex flex-wrap gap-1">{tab("", "Todos")}{tab("sem-acesso", "Sem acesso")}{tab("usuarios", "Usuários do sistema")}</div>}>
          {rows.length === 0 ? (
            <EmptyState title="Nenhum vendedor no filtro" description={create ? "Cadastre ao lado um vendedor sem acesso ao sistema." : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Tipo</th>
                    <th className="text-right">Comissão geral</th>
                    <th>Por categoria</th>
                    <th>Situação</th>
                    {manage && <th className="no-print text-right">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={editId === r.id ? "bg-brand-50/60" : undefined}>
                      <td>
                        <span className="block font-medium text-ink">{r.name}</span>
                        <span className="block text-xs text-slate-500">{[r.email, r.phone ? formatPhone(r.phone) : null].filter(Boolean).join(" · ") || "—"}</span>
                      </td>
                      <td>
                        <Badge tone={r.loginDisabled ? "warn" : "info"}>{r.roleLabel}</Badge>
                      </td>
                      <td className="tabular whitespace-nowrap text-right">{r.commissionBps == null ? <span className="text-slate-400">—</span> : formatBps(r.commissionBps)}</td>
                      <td className="text-xs text-slate-600">
                        {Object.keys(r.commissionByCategory).length
                          ? Object.entries(r.commissionByCategory)
                              .map(([c, bps]) => `${catName.get(c) ?? "Categoria removida"} ${formatBps(bps)}`)
                              .join(" · ")
                          : "—"}
                      </td>
                      <td>
                        <Badge tone={r.active ? "good" : "neutral"}>{r.active ? "Ativo" : r.status === "suspended" ? "Suspenso" : "Inativo"}</Badge>
                      </td>
                      {manage && (
                        <td className="no-print">
                          <div className="flex justify-end gap-1">
                            <Link href={`/vendas/vendedores?editar=${r.id}#form-vendedor`} className={buttonClass("ghost", "sm")} aria-label={`Editar ${r.name}`} title="Editar percentuais">
                              <Pencil className="size-4" />
                            </Link>
                            {r.loginDisabled && (
                              <ActionButton
                                action={setSellerActiveAction.bind(null, r.id, !r.active)}
                                label=""
                                icon={r.active ? <PowerOff className="size-4" aria-hidden /> : <Power className="size-4" aria-hidden />}
                                confirm={r.active ? `Inativar ${r.name}? Ele deixa de aparecer no PDV; vendas e comissões passadas ficam.` : `Reativar ${r.name}?`}
                                variant="ghost"
                                size="sm"
                                title={r.active ? "Inativar" : "Reativar"}
                              />
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
            Venda sem vendedor escolhido no PDV é atribuída ao operador do caixa. Percentuais valem para a apuração feita depois da alteração; fechamentos já feitos guardam o percentual usado.
          </p>
        </Card>
        <div id="form-vendedor" className="grid scroll-mt-20 gap-4 lg:grid-cols-2 2xl:block 2xl:space-y-4 [&>*]:min-w-0">
          {editing ? (
            <Card title={`Editar — ${editing.name}`}>
              <SellerForm key={editing.id} seller={editing} categories={categories} />
            </Card>
          ) : create ? (
            <Card title="Novo vendedor sem acesso" description="Para representantes e vendedores que não usam o sistema.">
              <SellerForm categories={categories} />
            </Card>
          ) : (
            <Notice tone="info">Para cadastrar vendedores e percentuais é preciso a permissão “Vendedores e comissões”.</Notice>
          )}
          <Card title="Histórico de alterações">
            <Timeline store={s.ctx.store} refs={[`sellers:${s.ctx.companyId}`]} limit={20} />
          </Card>
        </div>
      </div>
    </>
  );
}
