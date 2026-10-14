import Link from "@/components/ui/link";
import { Pencil, Power, PowerOff } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { Timeline } from "@/components/ui/timeline";
import { listAll } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { resolvePrices } from "@/domain/pricing";
import { listPromotions, promotionStatus, toPromoRule } from "@/domain/promotions";
import { describePromotion, describeWhen, PROMO_SCOPE_LABEL, type PromoScope } from "@/domain/promotions-calc";
import { PromotionForm, type PromotionFormValue, type TargetOption } from "./promotion-form";
import { setPromotionActiveAction } from "./actions";

export const metadata = { title: "Promoções" };

const STATUS: Record<string, [string, "good" | "info" | "neutral" | "warn"]> = {
  active: ["Vigente", "good"],
  scheduled: ["Agendada", "info"],
  expired: ["Encerrada", "warn"],
  inactive: ["Inativa", "neutral"],
};

/** Promoções (CAD-15): leve X pague Y, a partir de N unidades, dia da semana/horário e vigência. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("products");
  await requireFeaturePage(s, "promocoes");
  const params = await searchParams;
  const store = s.ctx.store;
  const cid = s.ctx.companyId;
  const [promos, categories, branches, skus, products] = await Promise.all([
    listPromotions(s.ctx),
    lookups.categories(s.ctx),
    lookups.branches(s.ctx),
    listAll(store, "skus", { filters: [["eq", "companyId", cid]] }),
    listAll(store, "products", { filters: [["eq", "companyId", cid]] }),
  ]);
  const liveProducts = products.filter((p) => p.active !== false && p.status !== "inactive" && p.status !== "draft");
  const pmap = new Map(products.map((p) => [p.id, p]));
  const liveIds = new Set(liveProducts.map((p) => p.id));
  const liveSkus = skus.filter((k) => k.active !== false && liveIds.has(k.productId));
  const prices = liveSkus.length ? await resolvePrices(store, { companyId: cid, branchId: s.ctx.branchId, items: liveSkus.map((k) => ({ skuId: k.id, qty: 1000 })) }) : [];
  const catName = new Map(categories.map((c) => [c.value, c.label]));
  const byLabel = (a: TargetOption, b: TargetOption) => a.label.localeCompare(b.label, "pt-BR");
  const options: Record<PromoScope, TargetOption[]> = {
    sku: liveSkus.map((k, i) => ({ value: k.id, label: k.name ?? pmap.get(k.productId)?.name ?? k.sku, hint: k.sku, price: prices[i]?.price || null })).sort(byLabel),
    product: liveProducts.map((p) => ({ value: p.id, label: p.name, hint: [p.code, p.categoryId ? catName.get(p.categoryId) : null].filter(Boolean).join(" · ") || null })).sort(byLabel),
    category: categories.map((c) => ({ value: c.value, label: c.label })),
  };
  const targetLabel = new Map<string, string>([...options.sku, ...options.product, ...options.category].map((o) => [o.value, o.label]));
  const branchName = new Map(branches.map((b) => [b.value, b.label]));
  const t0 = today();
  const manage = can(s.user, "products", "edit");
  const create = can(s.user, "products", "create");
  const editId = sp(params, "editar");
  const editing = manage && editId ? (promos.find((p) => p.id === editId) ?? null) : null;
  const status = promos.map((p) => promotionStatus(p, t0));
  const editValue: PromotionFormValue | null = editing
    ? {
        id: editing.id, name: editing.name, kind: editing.kind, scope: editing.scope, targetIds: editing.targetIds ?? [], buyQty: editing.buyQty ?? null, payQty: editing.payQty ?? null,
        minQty: editing.minQty ?? null, promoPrice: editing.promoPrice ?? null, percentBps: editing.percentBps ?? null, validFrom: editing.validFrom ?? null, validTo: editing.validTo ?? null,
        weekdays: editing.weekdays ?? null, startTime: editing.startTime ?? null, endTime: editing.endTime ?? null, branchId: editing.branchId ?? null, active: editing.active !== false, notes: editing.notes ?? null,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Promoções"
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Promoções" }]}
        description="Regras aplicadas automaticamente no PDV: leve X, pague Y e preço ou desconto a partir de N unidades, por item, produto ou categoria, com vigência, dias da semana e horário. O preço de tabela não muda: a promoção vira desconto do item."
      />
      <section aria-label="Resumo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vigentes" value={status.filter((x) => x === "active").length} tone="good" />
        <Stat label="Agendadas" value={status.filter((x) => x === "scheduled").length} />
        <Stat label="Encerradas" value={status.filter((x) => x === "expired").length} />
        <Stat label="Inativas" value={status.filter((x) => x === "inactive").length} />
      </section>
      <div className="grid gap-4 2xl:grid-cols-5 [&>*]:min-w-0">
        <Card className="2xl:col-span-3" title="Promoções cadastradas" bodyClass="p-0">
          {promos.length === 0 ? (
            <EmptyState title="Nenhuma promoção" description={create ? "Cadastre ao lado a primeira regra (ex.: leve 3, pague 2)." : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Promoção</th>
                    <th>Regra</th>
                    <th>Vale para</th>
                    <th>Quando</th>
                    <th>Situação</th>
                    {manage && <th className="no-print text-right">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p, i) => {
                    const rule = toPromoRule(p);
                    const [label, tone] = STATUS[status[i]];
                    const names = (p.targetIds ?? []).map((t: string) => targetLabel.get(t) ?? "item removido");
                    return (
                      <tr key={p.id} className={editId === p.id ? "bg-brand-50/60" : undefined}>
                        <td>
                          <span className="block font-medium text-ink">{p.name}</span>
                          {p.notes && <span className="block text-xs text-slate-500">{p.notes}</span>}
                        </td>
                        <td className="whitespace-nowrap">{describePromotion(rule, formatMoney)}</td>
                        <td className="text-xs text-slate-600">
                          <span className="block text-slate-500">{PROMO_SCOPE_LABEL[rule.scope]}</span>
                          {names.slice(0, 3).join(", ")}
                          {names.length > 3 ? ` e mais ${names.length - 3}` : ""}
                        </td>
                        <td className="text-xs text-slate-600">
                          {describeWhen(rule, formatDate)}
                          {p.branchId ? <span className="block">Filial: {branchName.get(p.branchId) ?? "—"}</span> : null}
                        </td>
                        <td><Badge tone={tone}>{label}</Badge></td>
                        {manage && (
                          <td className="no-print">
                            <div className="flex justify-end gap-1">
                              <Link href={`/produtos/promocoes?editar=${p.id}#form-promocao`} className={buttonClass("ghost", "sm")} aria-label={`Editar ${p.name}`} title="Editar">
                                <Pencil className="size-4" />
                              </Link>
                              <ActionButton
                                action={setPromotionActiveAction.bind(null, p.id, p.active === false)}
                                label=""
                                icon={p.active === false ? <Power className="size-4" aria-hidden /> : <PowerOff className="size-4" aria-hidden />}
                                confirm={p.active === false ? `Ativar "${p.name}"?` : `Inativar "${p.name}"? Ela deixa de valer no PDV; vendas já feitas mantêm o desconto.`}
                                variant="ghost"
                                size="sm"
                                title={p.active === false ? "Ativar" : "Inativar"}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
            Vigência pelas datas (último dia incluído), dias da semana e horário no fuso da empresa; o servidor confere tudo de novo na conclusão da venda. Orçamentos e pedidos importados no PDV mantêm o preço do documento (sem promoção).
          </p>
        </Card>
        <div id="form-promocao" className="scroll-mt-20 space-y-4 2xl:col-span-2">
          {editValue ? (
            <Card title={`Editar — ${editValue.name}`}>
              <PromotionForm key={editValue.id} promo={editValue} options={options} branches={branches} />
            </Card>
          ) : create ? (
            <Card title="Nova promoção">
              <PromotionForm options={options} branches={branches} />
            </Card>
          ) : (
            <Notice tone="info">Seu perfil permite apenas consultar as promoções.</Notice>
          )}
          <Card title="Histórico de alterações">
            <Timeline store={store} refs={[`promotions:${cid}`]} limit={20} />
          </Card>
        </div>
      </div>
    </>
  );
}
