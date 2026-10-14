import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { audit } from "@/lib/core/audit";
import { BusinessError } from "@/lib/core/errors";
import { lookups } from "@/lib/server/lookups";
import { sp, type SearchParams } from "@/lib/list";
import { defaultPriceTableId } from "@/domain/pricing";
import { LABEL_MODELS, formatLabelParam, labelItems, parseLabelParam, receiptLabelRequests, type LabelModel, type LabelRequest } from "@/domain/labels";
import { LabelQueue } from "./label-queue";
import { LabelSheet } from "./label-sheet";
import { LabelPrintControls } from "./print-controls";

export const metadata = { title: "Etiquetas de produtos" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("products");
  await requireFeaturePage(s, "etiquetas");
  const params = await searchParams;
  const tables = await lookups.priceTables(s.ctx);
  const tableParam = sp(params, "tabela");
  const tableId = tables.some((t) => t.value === tableParam) ? tableParam : ((await defaultPriceTableId(s.ctx.store, s.ctx.companyId)) ?? tables[0]?.value ?? "");
  const modelParam = sp(params, "modelo");
  const model = (LABEL_MODELS.some((m) => m.value === modelParam) ? modelParam : "gondola") as LabelModel;
  const receiptId = sp(params, "recebimento");
  let requests: LabelRequest[] = parseLabelParam(sp(params, "itens"));
  let origin: string | null = null;
  let error: string | null = null;
  if (!requests.length && receiptId) {
    try {
      const r = await receiptLabelRequests(s.ctx, receiptId);
      requests = r.items;
      origin = `Do recebimento nº ${r.number}: uma etiqueta por unidade recebida (ajuste as quantidades).`;
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e;
      error = e.message;
    }
  }
  let items: Awaited<ReturnType<typeof labelItems>> = [];
  try {
    items = await labelItems(s.ctx, { items: requests, priceTableId: tableId || null });
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    error = e.message;
  }
  const tableName = tables.find((t) => t.value === tableId)?.label ?? "—";

  if (sp(params, "print") === "1" && items.length) {
    const total = items.reduce((a, i) => a + i.copies, 0);
    await audit(s.ctx, { module: "products", action: "labels.print", entityType: "labels", entityId: null, summary: `Etiquetas impressas: ${total} de ${items.length} produto(s) — modelo ${LABEL_MODELS.find((m) => m.value === model)?.label}, tabela ${tableName}` });
    const back = `/produtos/etiquetas?modelo=${model}&tabela=${tableId}&itens=${encodeURIComponent(formatLabelParam(items))}`;
    return (
      <>
        <LabelPrintControls back={back} auto note={`${total} etiqueta(s) · ${LABEL_MODELS.find((m) => m.value === model)?.hint} · preços da tabela ${tableName}${items.some((i) => i.price == null) ? " · há produto sem preço nesta tabela" : ""}`} />
        <LabelSheet items={items} model={model} />
      </>
    );
  }

  const categories = await lookups.categories(s.ctx);
  return (
    <>
      <PageHeader
        title="Etiquetas de produtos"
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Etiquetas" }]}
        description="Monte a lista de produtos, escolha o modelo (gôndola, adesiva ou folha A4) e a tabela de preço. O código de barras sai do GTIN do produto (ou do SKU, quando não houver GTIN)."
      />
      {error && <div className="mb-4"><Notice tone="warn">{error}</Notice></div>}
      <LabelQueue
        initial={items.map((i) => ({ skuId: i.skuId, sku: i.sku, name: i.name, barcode: i.barcode, copies: i.copies }))}
        models={LABEL_MODELS}
        tables={tables}
        categories={categories}
        defaults={{ model, tableId }}
        origin={origin}
      />
    </>
  );
}
