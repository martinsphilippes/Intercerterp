import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight, Copy } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { addDays, formatDate, formatDateTime, startOfLocalDay, today } from "@/lib/dates";
import { formatBps, formatMoney, formatQty, QTY, roundDiv } from "@/lib/money";
import { can } from "@/lib/permissions";
import { nameMap } from "@/lib/server/lookups";
import { categoryPath, effectiveFiscal, fiscalIssues, fiscalStatus, formatCest, formatNcm, productAxes, productUsage, ORIGINS } from "@/domain/products";
import { defaultPriceTableId, priceMetrics, priceValidity } from "@/domain/pricing";
import { setProductStatusAction, deleteProductAction } from "../actions";
import { productFormOptions } from "../form-options";
import { ProductEditForm } from "../product-form";
import { VariantsForm } from "../variants-editor";
import { ImagePanel, ConversionsPanel, CostDialogButton, PriceDialogButton, DeletePriceButton, StockParamsButton, InitialBalanceForm } from "./panels";

export const metadata = { title: "Produto" };

const FIELD_LABEL: Record<string, string> = { price: "Preço", wholesalePrice: "Preço de atacado", costAcquisition: "Custo de aquisição", costAdditional: "Custos adicionais", costTotal: "Custo total" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("products");
  const { id } = await params;
  const { tab = "geral" } = await searchParams;
  const ctx = s.ctx;
  const p = await ctx.store.get("products", id);
  if (!p || p.companyId !== ctx.companyId) notFound();
  const base = `/produtos/${id}`;
  const [skus, prices, tables, branches, warehouses, balances, history, conversions, usage, categories, users] = await Promise.all([
    listAll(ctx.store, "skus", { filters: [["eq", "productId", id]] }),
    listAll(ctx.store, "prices", { filters: [["eq", "productId", id]] }),
    listAll(ctx.store, "price_tables", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "stock_balances", { filters: [["eq", "productId", id]] }),
    listAll(ctx.store, "price_history", { filters: [["eq", "productId", id]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 200),
    listAll(ctx.store, "unit_conversions", { filters: [["eq", "productId", id]] }),
    productUsage(ctx.store, id),
    listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] }),
    nameMap(ctx, "users"),
  ]);
  const o = await productFormOptions(s);
  const canEdit = can(s.user, "products", "edit");
  const tableName = new Map(tables.map((t) => [t.id, t.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const whById = new Map(warehouses.map((w) => [w.id, w]));
  const skuById = new Map(skus.map((x) => [x.id, x]));
  const defTable = await defaultPriceTableId(ctx.store, ctx.companyId);
  const date = today();
  const activeSkus = skus.filter((x) => x.active !== false);
  const defaultPrices = prices.filter((x) => x.priceTableId === defTable && !x.branchId && priceValidity(x, date) === "current");
  const priceRef = defaultPrices.length ? Math.min(...defaultPrices.map((x) => x.price)) : null;
  const costRef = activeSkus.length ? Math.min(...activeSkus.map((x) => x.costTotal ?? 0)) : null;
  const metrics = priceMetrics(priceRef, costRef);
  const availWh = new Set(warehouses.filter((w) => w.kind === "available").map((w) => w.id));
  const available = balances.filter((b) => availWh.has(b.warehouseId)).reduce((a, b) => a + b.physical - b.reserved, 0);
  const inTransit = balances.reduce((a, b) => a + (b.inTransit ?? 0), 0);
  const since = addDays(date, -90);
  const sold = await listAll(ctx.store, "stock_movements", { filters: [["eq", "productId", id], ["eq", "type", "sale"], ["gte", "occurredAt", startOfLocalDay(since)]] });
  const soldQty = Math.max(0, -sold.reduce((a, m) => a + m.qty, 0));
  const taxGroup = p.taxGroupId ? await ctx.store.get("tax_groups", p.taxGroupId) : null;
  const issues = fiscalIssues(p, taxGroup);
  const supplier = p.supplierId ? await ctx.store.get("suppliers", p.supplierId) : null;
  const brand = p.brandId ? await ctx.store.get("brands", p.brandId) : null;
  const isService = p.type === "service";

  const tabs = [
    { key: "geral", label: "Dados gerais" },
    ...(isService ? [] : [{ key: "variacoes", label: "Variações", count: skus.length }]),
    { key: "precos", label: "Custos e preços", count: prices.length },
    ...(isService ? [] : [{ key: "estoque", label: "Estoque" }]),
    { key: "fiscal", label: "Fiscal" },
    { key: "historico", label: "Histórico" },
  ];
  const skuOpts = activeSkus.map((x) => ({ id: x.id, sku: x.sku, name: x.name, costTotal: x.costTotal ?? 0 }));

  return (
    <>
      <PageHeader
        title={p.name}
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: p.name }]}
        badges={
          <>
            <StatusBadge kind="generic" status={p.status} />
            <Badge>{isService ? "Serviço" : "Produto"}</Badge>
            {p.availablePdv ? <Badge tone="good">No PDV</Badge> : <Badge>Fora do PDV</Badge>}
            {p.availableEcommerce && <Badge tone="info">Loja virtual</Badge>}
            {(() => {
              const f = fiscalStatus(p, taxGroup);
              return <Badge tone={f.status === "ok" ? "good" : f.status === "review" ? "warn" : "bad"} title={issues.join("; ") || f.detail}>Fiscal: {f.label}</Badge>;
            })()}
          </>
        }
        description={[`Código ${p.code}`, activeSkus.length > 1 ? `${activeSkus.length} variações` : activeSkus[0]?.sku ? `SKU ${activeSkus[0].sku}` : null, categoryPath(categories, p.categoryId) || null].filter(Boolean).join(" · ")}
        actions={
          <>
            {!isService && (
              <LinkButton href={`/estoque/movimentos?produto=${id}`}>
                <ArrowLeftRight className="size-4" /> Movimentos
              </LinkButton>
            )}
            {can(s.user, "products", "create") && (
              <LinkButton href="/produtos/novo" title="Cadastrar outro produto">
                <Copy className="size-4" /> Novo
              </LinkButton>
            )}
            {canEdit &&
              (p.status === "inactive" ? (
                <ActionButton action={setProductStatusAction.bind(null, id, true)} label="Reativar" />
              ) : p.status === "draft" ? (
                <ActionButton action={setProductStatusAction.bind(null, id, true)} label="Concluir cadastro (ativar)" variant="primary" confirm="Ativar o produto? Ele passa a poder ser vendido conforme a disponibilidade no PDV." />
              ) : (
                <ActionButton action={setProductStatusAction.bind(null, id, false)} label="Inativar" confirm="Inativar o produto? O histórico e as referências são preservados." />
              ))}
            {can(s.user, "products", "delete") && !usage.any && <ActionButton action={deleteProductAction.bind(null, id)} label="Excluir" variant="danger" confirm="Excluir definitivamente? Só é permitido para produto sem uso." />}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Preço (tabela padrão)" value={priceRef == null ? "Sem preço" : formatMoney(priceRef)} hint={tableName.get(defTable ?? "") ?? "—"} href={`${base}?tab=precos`} />
        <Stat label="Custo total" value={formatMoney(costRef)} hint="Aquisição + adicionais" href={`${base}?tab=precos`} />
        <Stat label="Margem · Markup" value={`${formatBps(metrics.marginBps, 1)} · ${formatBps(metrics.markupBps, 1)}`} hint="Margem s/ preço · markup s/ custo" />
        {!isService && <Stat label="Disponível (todas as filiais)" value={formatQty(available, p.unitCode)} hint={inTransit ? `+ ${formatQty(inTransit)} em trânsito` : "Físico − reservado"} href={`${base}?tab=estoque`} />}
        {!isService && <Stat label="Vendido em 90 dias" value={formatQty(soldQty, p.unitCode)} hint={`Desde ${formatDate(since)}`} href={`/estoque/movimentos?produto=${id}&tipo=sale&de=${since}&filial=all`} />}
      </div>
      <LinkTabs basePath={base} active={tab} tabs={tabs} />

      {tab === "geral" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          {canEdit ? (
            <ProductEditForm product={p} o={o} section="general" />
          ) : (
            <Card title="Dados gerais">
              <DefinitionList
                items={[
                  { label: "Nome", value: p.name },
                  { label: "Código", value: p.code },
                  { label: "GTIN/EAN", value: p.gtin },
                  { label: "Unidade", value: p.unitCode },
                  { label: "Categoria", value: categoryPath(categories, p.categoryId) },
                  { label: "Marca", value: brand?.name },
                  { label: "Fornecedor principal", value: supplier ? <Link className="text-brand-700 hover:underline" href={`/fornecedores/${supplier.id}`}>{supplier.tradeName || supplier.name}</Link> : "—" },
                  { label: "Descrição", value: p.description },
                ]}
              />
            </Card>
          )}
          <div className="space-y-4">
            <Card title="Imagem">
              <ImagePanel productId={id} imageFileId={p.imageFileId ?? null} canEdit={canEdit} />
            </Card>
            <Card title="Unidades e conversões" description={`Unidade de estoque e venda: ${p.unitCode}`}>
              <ConversionsPanel productId={id} unitCode={p.unitCode} units={o.units} conversions={conversions.map((c) => ({ id: c.id, fromUnit: c.fromUnit, toUnit: c.toUnit, factor: c.factor }))} canEdit={canEdit} />
            </Card>
            {supplier && (
              <Card title="Fornecedor principal">
                <Link className="text-sm text-brand-700 hover:underline" href={`/fornecedores/${supplier.id}`}>{supplier.tradeName || supplier.name}</Link>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "variacoes" && !isService && (
        <Card title="Variações (SKUs)">
          {canEdit ? (
            <VariantsForm
              productId={id}
              productCode={p.code}
              initialAxes={productAxes(p, skus).map((a) => ({ name: a.name, values: a.values.join(", ") }))}
              initialVariants={skus.map((x) => {
                const bs = balances.filter((b) => b.skuId === x.id && availWh.has(b.warehouseId));
                return { id: x.id, sku: x.sku, barcode: x.barcode ?? "", extraBarcodes: (x.extraBarcodes ?? []).join(", "), attributes: x.attributes ?? {}, active: x.active !== false, stockText: formatQty(bs.reduce((a, b) => a + b.physical, 0)), inUse: bs.some((b) => b.seq > 0) };
              })}
            />
          ) : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>SKU</th><th>Atributos</th><th>GTIN</th><th>Situação</th></tr></thead>
              <tbody>{skus.map((x) => <tr key={x.id}><td className="font-mono text-xs">{x.sku}</td><td>{Object.values(x.attributes ?? {}).join(" / ") || "—"}</td><td className="font-mono text-xs">{x.barcode ?? "—"}</td><td><StatusBadge kind="generic" status={x.active === false ? "inactive" : "active"} /></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "precos" && (
        <div className="space-y-4">
          <Card bodyClass="p-0" title="Custos por variação" description="Custo total = aquisição + custos adicionais nomeados. O custo médio vem das entradas de estoque (média ponderada).">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>SKU</th><th className="text-right">Aquisição</th><th>Custos adicionais</th><th className="text-right">Custo total</th><th className="text-right">Custo médio em estoque</th><th /></tr>
                </thead>
                <tbody>
                  {skus.map((x) => {
                    const bs = balances.filter((b) => b.skuId === x.id && b.physical > 0);
                    const qty = bs.reduce((a, b) => a + b.physical, 0);
                    const avg = qty ? roundDiv(bs.reduce((a, b) => a + b.physical * (b.avgCost ?? 0), 0), qty) : null;
                    return (
                      <tr key={x.id}>
                        <td><span className="font-mono text-xs">{x.sku}</span>{x.active === false && <Badge className="ml-2">Inativa</Badge>}</td>
                        <td className="tabular text-right">{formatMoney(x.costAcquisition ?? 0)}</td>
                        <td className="text-xs text-slate-600">{(x.additionalCosts ?? []).map((c: any) => `${c.name}: ${formatMoney(c.amount)}`).join(" · ") || "—"}</td>
                        <td className="tabular text-right font-semibold">{formatMoney(x.costTotal ?? 0)}</td>
                        <td className="tabular text-right">{avg == null ? "—" : formatMoney(avg)}</td>
                        <td className="text-right">{canEdit && <CostDialogButton productId={id} sku={{ id: x.id, sku: x.sku, name: x.name, costAcquisition: x.costAcquisition ?? 0, additionalCosts: x.additionalCosts ?? [], costTotal: x.costTotal ?? 0 }} variantsCount={skus.length} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card
            bodyClass="p-0"
            title="Preços por tabela"
            description="Preço da filial prevalece sobre o geral; entre vigências válidas, vale a de início mais recente. Atacado aplica-se a partir da quantidade mínima."
            actions={canEdit && skuOpts.length > 0 && <PriceDialogButton productId={id} tables={tables.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))} branches={branches.map((b) => ({ value: b.id, label: b.name }))} skus={skuOpts} defaultTableId={defTable} />}
          >
            {prices.length === 0 ? (
              <EmptyState title="Sem preços cadastrados" description="Sem preço o item não pode ser vendido no PDV." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr><th>Tabela</th><th>SKU</th><th>Filial</th><th className="text-right">Preço</th><th className="text-right">Atacado (a partir de)</th><th className="text-right">Desc. máx.</th><th>Vigência</th><th>Situação</th><th className="text-right">Margem</th><th className="text-right">Markup</th><th /></tr>
                  </thead>
                  <tbody>
                    {[...prices]
                      .sort((a, b) => String(tableName.get(a.priceTableId)).localeCompare(String(tableName.get(b.priceTableId))) || String(skuById.get(a.skuId)?.sku).localeCompare(String(skuById.get(b.skuId)?.sku)) || String(a.validFrom ?? "").localeCompare(String(b.validFrom ?? "")))
                      .map((pr) => {
                        const cost = skuById.get(pr.skuId)?.costTotal ?? 0;
                        const m = priceMetrics(pr.price, cost);
                        const v = priceValidity(pr, date);
                        return (
                          <tr key={pr.id}>
                            <td>{tableName.get(pr.priceTableId) ?? "—"}{pr.priceTableId === defTable && <Badge tone="brand" className="ml-1">padrão</Badge>}</td>
                            <td className="font-mono text-xs">{skuById.get(pr.skuId)?.sku ?? "—"}</td>
                            <td>{pr.branchId ? branchName.get(pr.branchId) : "Todas"}</td>
                            <td className="tabular text-right font-semibold">{formatMoney(pr.price)}</td>
                            <td className="tabular text-right">{pr.wholesalePrice ? `${formatMoney(pr.wholesalePrice)} (${formatQty(pr.wholesaleMinQty)})` : "—"}</td>
                            <td className="tabular text-right">{formatBps(pr.maxDiscountBps, 0)}</td>
                            <td className="whitespace-nowrap text-xs">{pr.validFrom || pr.validTo ? `${formatDate(pr.validFrom) === "—" ? "…" : formatDate(pr.validFrom)} a ${pr.validTo ? formatDate(pr.validTo) : "…"}` : "Sem vigência"}</td>
                            <td>{v === "current" ? <Badge tone="good">Vigente</Badge> : v === "future" ? <Badge tone="info">Futuro</Badge> : <Badge>Expirado</Badge>}</td>
                            <td className="tabular text-right">{formatBps(m.marginBps, 1)}</td>
                            <td className="tabular text-right">{formatBps(m.markupBps, 1)}</td>
                            <td className="whitespace-nowrap text-right">
                              {canEdit && (
                                <>
                                  <PriceDialogButton productId={id} tables={tables.map((t) => ({ value: t.id, label: t.name }))} branches={branches.map((b) => ({ value: b.id, label: b.name }))} skus={skuOpts.length ? skuOpts : skus.map((x) => ({ id: x.id, sku: x.sku, name: x.name, costTotal: x.costTotal ?? 0 }))} defaultTableId={defTable} price={{ id: pr.id, priceTableId: pr.priceTableId, skuId: pr.skuId, branchId: pr.branchId ?? null, price: pr.price, wholesalePrice: pr.wholesalePrice ?? null, wholesaleMinQty: pr.wholesaleMinQty ?? null, maxDiscountBps: pr.maxDiscountBps ?? null, validFrom: pr.validFrom ?? null, validTo: pr.validTo ?? null }} />
                                  <DeletePriceButton productId={id} priceId={pr.id} />
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card bodyClass="p-0" title="Histórico de preços e custos" description="Toda alteração de preço e custo, com valor anterior, novo valor, motivo e usuário.">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Sem alterações registradas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead><tr><th>Data</th><th>SKU</th><th>Campo</th><th>Tabela</th><th className="text-right">Anterior</th><th className="text-right">Novo</th><th>Motivo</th><th>Usuário</th></tr></thead>
                  <tbody>
                    {history.slice(0, 100).map((h) => (
                      <tr key={h.id}>
                        <td className="whitespace-nowrap">{formatDateTime(h.createdAt)}</td>
                        <td className="font-mono text-xs">{skuById.get(h.skuId)?.sku ?? "—"}</td>
                        <td>{FIELD_LABEL[h.field] ?? h.field}</td>
                        <td>{h.priceTableId ? tableName.get(h.priceTableId) : "—"}</td>
                        <td className="tabular text-right">{formatMoney(h.oldValue)}</td>
                        <td className="tabular text-right">{h.newValue == null ? <span className="text-slate-500">removido</span> : formatMoney(h.newValue)}</td>
                        <td className="text-xs text-slate-600">{h.reason ?? "—"}</td>
                        <td className="text-xs">{users.get(h.createdBy) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "estoque" && !isService && (
        <div className="space-y-4">
          <Card bodyClass="p-0" title="Saldos por filial e depósito" description="Disponível = físico − reservado. Em trânsito pertence ao destino, mas não está disponível em nenhuma filial." actions={<Link className="text-sm text-brand-700 hover:underline" href={`/estoque/movimentos?produto=${id}&filial=all`}>Ver movimentos</Link>}>
            {balances.length === 0 ? (
              <EmptyState title="Sem saldos" description="Lance o saldo inicial abaixo ou registre uma entrada." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr><th>Filial · depósito</th><th>SKU</th><th className="text-right">Físico</th><th className="text-right">Reservado</th><th className="text-right">Disponível</th><th className="text-right">Em trânsito</th><th className="text-right">Mín.</th><th className="text-right">Máx./alvo</th><th className="text-right">Segurança</th><th className="text-right">Múltiplo</th><th>Local</th><th className="text-right">Custo médio</th><th className="text-right">Valor</th><th /></tr>
                  </thead>
                  <tbody>
                    {[...balances]
                      .sort((a, b) => Number(b.branchId === ctx.branchId) - Number(a.branchId === ctx.branchId) || String(branchName.get(a.branchId)).localeCompare(String(branchName.get(b.branchId))) || String(skuById.get(a.skuId)?.sku).localeCompare(String(skuById.get(b.skuId)?.sku)))
                      .map((b) => {
                        const wh = whById.get(b.warehouseId);
                        const av = b.physical - b.reserved;
                        const own = b.branchId === ctx.branchId;
                        return (
                          <tr key={b.id}>
                            <td className="whitespace-nowrap text-xs">{branchName.get(b.branchId)}{b.branchId === ctx.branchId && <Badge tone="brand" className="ml-1">atual</Badge>}<span className="block text-slate-500">{wh?.name}{wh?.kind === "damaged" && <Badge tone="warn" className="ml-1">avarias</Badge>}</span></td>
                            <td className="whitespace-nowrap font-mono text-xs">{skuById.get(b.skuId)?.sku}</td>
                            <td className="tabular text-right">{formatQty(b.physical)}</td>
                            <td className="tabular text-right">{formatQty(b.reserved)}</td>
                            <td className={`tabular text-right font-semibold ${b.minQty && av < b.minQty ? "text-amber-700" : ""}`}>{formatQty(av)}</td>
                            <td className="tabular text-right">{b.inTransit ? <Link className="text-brand-700 hover:underline" href="/estoque/transferencias?status=in_transit">{formatQty(b.inTransit)}</Link> : "—"}</td>
                            <td className="tabular text-right">{formatQty(b.minQty ?? 0)}</td>
                            <td className="tabular text-right">{formatQty(b.maxQty ?? 0)}</td>
                            <td className="tabular text-right">{formatQty(b.safetyQty ?? 0)}</td>
                            <td className="tabular text-right">{formatQty(b.reorderMultiple ?? 0)}</td>
                            <td className="text-xs">{b.location ?? "—"}</td>
                            <td className="tabular text-right">{formatMoney(b.avgCost)}</td>
                            <td className="tabular text-right">{formatMoney(roundDiv(b.physical * (b.avgCost ?? 0), QTY))}</td>
                            <td className="text-right">{own && (canEdit || can(s.user, "stock", "edit")) && <StockParamsButton productId={id} row={{ warehouseId: b.warehouseId, skuId: b.skuId, sku: skuById.get(b.skuId)?.sku ?? "", warehouseName: wh?.name ?? "", minQty: b.minQty ?? 0, maxQty: b.maxQty ?? 0, safetyQty: b.safetyQty ?? 0, reorderMultiple: b.reorderMultiple ?? 0, location: b.location ?? null }} />}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Saldo inicial" description="Gera um movimento identificado “Saldo inicial” — permitido apenas enquanto o saldo do depósito não tem movimentos. Depois, use ajuste ou inventário.">
            {!s.branch ? (
              <Notice tone="info">Selecione uma filial (o consolidado é somente consulta).</Notice>
            ) : !o.canStock ? (
              <Notice tone="warn">Você não tem permissão para lançar saldo inicial (ajuste de estoque).</Notice>
            ) : (() => {
              const free = activeSkus.filter((x) => o.warehouses.some((w) => !balances.some((b) => b.skuId === x.id && b.warehouseId === w.value && b.seq > 0)));
              return free.length === 0 ? (
                <p className="text-sm text-slate-500">Todas as variações já têm movimentos nos depósitos desta filial. Para corrigir, use <Link className="text-brand-700 hover:underline" href="/estoque/movimentos?novo=1">ajuste de estoque</Link> ou <Link className="text-brand-700 hover:underline" href="/estoque/inventarios">inventário</Link>.</p>
              ) : (
                <InitialBalanceForm productId={id} skus={free.map((x) => ({ value: x.id, label: x.sku, cost: x.costTotal ?? 0 }))} warehouses={o.warehouses} />
              );
            })()}
          </Card>
        </div>
      )}

      {tab === "fiscal" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            {issues.length > 0 && (
              <Notice tone="warn" title="Pendências para emissão de documento fiscal">
                <ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
              </Notice>
            )}
            {canEdit ? (
              <ProductEditForm product={p} o={o} section="fiscal" />
            ) : (
              <Card title="Dados fiscais">
                <DefinitionList items={[{ label: "NCM", value: formatNcm(p.ncm) }, { label: "CEST", value: formatCest(p.cest) }, { label: "Origem", value: ORIGINS.find((x) => x.value === p.origin)?.label }, { label: "CFOP próprio", value: p.cfop }, { label: "CST/CSOSN próprio", value: p.cstCsosn }]} />
              </Card>
            )}
          </div>
          {!isService ? (
            <Card bodyClass="p-0" title="Tributação efetiva por operação" description={taxGroup ? `Grupo: ${taxGroup.name}` : "Sem grupo tributário"}>
              <table className="table-base w-full text-sm">
                <thead><tr><th>Operação</th><th>CFOP</th><th>{o.regimeLabel.startsWith("Simples") ? "CSOSN" : "CST"}</th><th>Fonte</th></tr></thead>
                <tbody>
                  {effectiveFiscal(p, taxGroup).map((r) => (
                    <tr key={r.operation}><td>{r.operation}</td><td className="font-mono">{r.cfop ?? "—"}</td><td className="font-mono">{r.cst ?? "—"}</td><td className="text-xs text-slate-500">{r.source ?? "não definido"}</td></tr>
                  ))}
                </tbody>
              </table>
              {taxGroup && (
                <p className="p-4 text-xs text-slate-500">
                  ICMS {formatBps(taxGroup.icmsRateBps)} · PIS {taxGroup.pisCst ?? "—"} {formatBps(taxGroup.pisRateBps)} · COFINS {taxGroup.cofinsCst ?? "—"} {formatBps(taxGroup.cofinsRateBps)}. <Link className="text-brand-700 hover:underline" href="/produtos/cadastros?tab=grupos">Editar grupos tributários</Link>
                </p>
              )}
            </Card>
          ) : (
            <Card title="Serviço (NFS-e)">
              <DefinitionList items={[{ label: "Item LC 116", value: p.serviceListItem }, { label: "Código municipal", value: p.municipalServiceCode }, { label: "Alíquota ISS", value: formatBps(p.issRateBps) }, { label: "CNAE", value: p.cnaeService }]} />
            </Card>
          )}
        </div>
      )}

      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={ctx.store} refs={[`product:${id}`, ...skus.map((x) => `sku:${x.id}`)]} />
        </Card>
      )}
    </>
  );
}
