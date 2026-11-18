import Link from "@/components/ui/link";
import { ImageUp, Trash2, X } from "lucide-react";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { EmptyState, Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { canDo } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { catalogRows, MAX_IMAGES } from "@/domain/ecommerce/catalog";
import { shippingOf } from "@/domain/ecommerce/store";
import { CatalogTable, type CatalogRowView } from "../_components/catalog-table";
import { addToCatalogAction, removeListingImageAction, saveListingAction, setPresenceAction, uploadListingImageAction, validateSelectionAction } from "../actions";
import { ecomStorePage } from "../_lib";

export const metadata = { title: "Catálogo digital" };

const SHOW = [
  { value: "all", label: "Todos os produtos" },
  { value: "in_store", label: "No catálogo da loja" },
  { value: "published", label: "Na vitrine" },
  { value: "issues", label: "Com pendência" },
  { value: "off", label: "Fora da vitrine" },
];

/** Tela 52 — Catálogo digital: produtos do ERP na loja, com o complemento comercial e as pendências para a venda. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.catalog", "ecommerce.manage"]);
  const params = await searchParams;
  const show = (SHOW.some((o) => o.value === sp(params, "exibir")) ? sp(params, "exibir") : "all") as "all" | "in_store" | "published" | "issues" | "off";
  const q = sp(params, "q") || "";
  const filterQs = new URLSearchParams([...(show !== "all" ? [["exibir", show]] : []), ...(q ? [["q", q]] : [])]).toString();
  const canEdit = canDo(s.user, "ecommerce.catalog");
  const rows = await catalogRows(s.ctx, { show, q });
  const allRows = show === "all" && !q ? rows : await catalogRows(s.ctx, {});
  const editId = sp(params, "editar");
  const editing = editId ? (allRows.find((r) => r.product.id === editId) ?? null) : null;
  const categories = editing ? await listAll(s.ctx.store, "categories", { filters: [["eq", "companyId", s.ctx.companyId]] }) : [];
  const ship = shippingOf(st);
  const view: CatalogRowView[] = rows.map((r) => ({
    productId: r.product.id,
    name: r.listing?.title ?? r.product.name,
    code: r.skus.length > 1 ? `${r.skus.length} variações` : (r.skus[0]?.sku ?? r.product.code ?? ""),
    category: r.categoryName,
    available: formatQty(r.available, r.product.unitCode ?? "un.", 0),
    price: r.price ? formatMoney(r.price) : "—",
    inCatalog: Boolean(r.listing),
    published: Boolean(r.listing?.published),
    blocking: r.issues.filter((i) => i.blocking).map((i) => i.label),
    warnings: r.issues.filter((i) => !i.blocking).map((i) => i.label),
  }));
  const inStore = allRows.filter((r) => r.listing);
  const sellable = inStore.filter((r) => r.listing?.published && !r.issues.some((i) => i.blocking));
  const withIssues = inStore.filter((r) => r.issues.some((i) => i.blocking));

  return (
    <>
      <PageHeader
        title="Um catálogo, todos os canais"
        crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Catálogo digital" }]}
        description="Selecione os produtos do ERP que serão vendidos na loja e complete as informações para a venda on-line. Produto, SKU, preço e estoque continuam com referência única no cadastro do ERP."
      />
      <section aria-label="Resumo do catálogo" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Disponíveis para venda on-line" value={allRows.length} hint="Marcados “venda on-line” no cadastro" />
        <Stat label="No catálogo da loja" value={inStore.length} />
        <Stat label="Na vitrine (vendáveis)" value={sellable.length} tone="good" />
        <Stat label="Com pendência" value={withIssues.length} tone={withIssues.length ? "warn" : "default"} href="/comercio-digital/catalogo?exibir=issues" />
      </section>
      <div className={`grid gap-4 ${editing ? "2xl:grid-cols-5" : ""} [&>*]:min-w-0`}>
        <Card title="Produtos do ERP" className={editing ? "2xl:col-span-3" : ""} bodyClass="p-0" description={`${allRows.length} produto(s) · ${sellable.length} na vitrine`}>
          <form key={`${show}|${q}`} className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-4 py-3" role="search">
            {editId && <input type="hidden" name="editar" value={editId} />}
            <Field label="Buscar" htmlFor="q" className="min-w-[200px] flex-1"><Input id="q" name="q" defaultValue={q} placeholder="Nome, código ou SKU" /></Field>
            <Field label="Exibir" htmlFor="exibir"><Select id="exibir" name="exibir" defaultValue={show} options={SHOW} /></Field>
            <button type="submit" className={buttonClass("secondary")}>Filtrar</button>
          </form>
          {rows.length ? (
            <CatalogTable rows={view} canEdit={canEdit} query={filterQs} actions={{ add: addToCatalogAction, publish: setPresenceAction.bind(null, true), unpublish: setPresenceAction.bind(null, false), validate: validateSelectionAction }} />
          ) : (
            <EmptyState title="Nenhum produto encontrado" description="Marque “Disponível para venda on-line” no cadastro do produto (Produtos e serviços) para ele aparecer aqui." />
          )}
          <div className="px-4 py-3">
            <Notice tone="info">O saldo disponível vem do ERP (depósito padrão da filial que atende a loja{st.safetyStockQty ? `, menos ${formatQty(st.safetyStockQty, "un.", 0)} de estoque de segurança` : ""}). Reservas de pedidos — on-line, pedidos de venda e transferências — reduzem a disponibilidade de todos os canais.</Notice>
          </div>
        </Card>
        {editing && (
          <Card
            title={editing.product.name}
            className="2xl:col-span-2"
            description="Informações do produto para a loja"
            actions={<Link href={`/comercio-digital/catalogo${filterQs ? `?${filterQs}` : ""}`} aria-label="Fechar edição" className={buttonClass("ghost", "sm")}><X className="size-4" aria-hidden /></Link>}
          >
            <div id="editar" className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                {editing.issues.map((i) => <Badge key={i.code} tone={i.blocking ? "warn" : "neutral"}>{i.label}</Badge>)}
                {!editing.issues.length && <Badge tone="good">Pronto para a vitrine</Badge>}
              </div>
              <p className="text-sm text-slate-600">
                Estoque ERP: <strong>{formatQty(editing.available, editing.product.unitCode ?? "un.", 0)}</strong> · Preço da tabela: <strong>{formatMoney(editing.price)}</strong> · SKU: {editing.skus.map((k) => k.sku).join(", ")}
              </p>
              <ActionForm action={saveListingAction.bind(null, editing.product.id)} className="space-y-3">
                <fieldset disabled={!canEdit} className="space-y-3">
                  <Field label="Título na loja" required htmlFor="title"><Input id="title" name="title" defaultValue={editing.listing?.title ?? editing.product.name} required maxLength={200} /></Field>
                  <Field label="Descrição" hint="Use detalhes que ajudam a decidir a compra: material, medidas, uso, garantia." htmlFor="description"><Textarea id="description" name="description" defaultValue={editing.listing?.description ?? editing.product.description ?? ""} rows={5} /></Field>
                  <FormGrid cols={2}>
                    <Field label="Categoria na loja" htmlFor="categoryId"><Select id="categoryId" name="categoryId" defaultValue={editing.listing?.categoryId ?? editing.product.categoryId ?? ""} placeholder="Categoria do cadastro" options={categories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
                    <Field label="Endereço (slug)" hint="Gerado do título se vazio." htmlFor="slug"><Input id="slug" name="slug" defaultValue={editing.listing?.slug ?? ""} /></Field>
                  </FormGrid>
                  <FormGrid cols={2}>
                    <Field label="Preço na loja" hint="Vazio = preço da tabela do ERP."><MoneyInput name="priceOverride" defaultValue={editing.listing?.priceOverride ?? 0} ariaLabel="Preço na loja" /></Field>
                    <Field label="Preço “de” (riscado)" hint="Opcional, maior que o preço da loja."><MoneyInput name="compareAtPrice" defaultValue={editing.listing?.compareAtPrice ?? 0} ariaLabel="Preço de" /></Field>
                  </FormGrid>
                  <FormGrid cols={4}>
                    <Field label="Peso (g)" required={ship.modes.carrier.enabled || ship.modes.third_party.enabled} htmlFor="weightGrams"><Input id="weightGrams" name="weightGrams" type="number" min={1} defaultValue={editing.listing?.weightGrams ?? editing.product.weightGrams ?? ""} /></Field>
                    <Field label="Altura (cm)" htmlFor="heightCm"><Input id="heightCm" name="heightCm" type="number" min={1} defaultValue={editing.listing?.heightCm ?? ""} /></Field>
                    <Field label="Largura (cm)" htmlFor="widthCm"><Input id="widthCm" name="widthCm" type="number" min={1} defaultValue={editing.listing?.widthCm ?? ""} /></Field>
                    <Field label="Comprimento (cm)" htmlFor="lengthCm"><Input id="lengthCm" name="lengthCm" type="number" min={1} defaultValue={editing.listing?.lengthCm ?? ""} /></Field>
                  </FormGrid>
                  <FormGrid cols={2}>
                    <Field label="Título para buscadores" htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={editing.listing?.seoTitle ?? ""} maxLength={70} /></Field>
                    <Field label="Descrição para buscadores" htmlFor="seoDescription"><Input id="seoDescription" name="seoDescription" defaultValue={editing.listing?.seoDescription ?? ""} maxLength={160} /></Field>
                  </FormGrid>
                  {(editing.listing?.images ?? []).map((f: string) => <input key={f} type="hidden" name="images" value={f} />)}
                  <div className="flex flex-wrap gap-4">
                    <Checkbox name="published" defaultChecked={Boolean(editing.listing?.published)} label="Na vitrine" />
                    <Checkbox name="featured" defaultChecked={Boolean(editing.listing?.featured)} label="Destaque na página inicial" />
                  </div>
                  {canEdit && <button type="submit" className={buttonClass("primary")}>Salvar e validar</button>}
                </fieldset>
              </ActionForm>
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">Fotos ({(editing.listing?.images ?? []).length}/{MAX_IMAGES})</p>
                <div className="mb-2 flex flex-wrap gap-2">
                  {(editing.listing?.images ?? []).map((f: string) => (
                    <div key={f} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/loja/${st.slug}/imagem/${f}`} alt="" className="size-20 rounded border border-slate-200 object-cover" />
                      {canEdit && (
                        <div className="absolute right-0 top-0">
                          <ActionButton action={removeListingImageAction.bind(null, editing.product.id, f)} label="" title="Remover foto" size="sm" variant="ghost" icon={<Trash2 className="size-3.5" aria-hidden />} confirm="Remover esta foto do produto na loja?" />
                        </div>
                      )}
                    </div>
                  ))}
                  {!(editing.listing?.images ?? []).length && <p className="text-xs text-slate-500">{editing.product.imageFileId ? "Sem fotos da loja: a vitrine usa a foto do cadastro do produto." : "Sem fotos: a vitrine mostra a ilustração da categoria."}</p>}
                </div>
                {canEdit && editing.listing && (editing.listing.images ?? []).length < MAX_IMAGES && (
                  <ActionForm action={uploadListingImageAction.bind(null, editing.product.id)} className="flex flex-wrap items-center gap-2" resetOnSuccess>
                    <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" aria-label="Arquivo da foto" />
                    <button type="submit" className={buttonClass("secondary", "sm")}><ImageUp className="size-4" aria-hidden /> Enviar foto</button>
                  </ActionForm>
                )}
                {!editing.listing && <p className="text-xs text-slate-500">Salve o produto na loja para enviar fotos.</p>}
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
