import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { LinkButton } from "@/components/ui/button";
import { AutoPrint } from "../sale-widgets";
import { PrintStyles } from "../print-styles";
import { documentView } from "./queries";
import { DocumentSheet } from "./doc-print";
import type { SalesDocType } from "@/domain/sales-documents";

/** Impressão A4 do orçamento/pedido (`?print=1` abre o diálogo de impressão do navegador). */
export async function DocumentPrintPage({ type, params, searchParams }: { type: SalesDocType; params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  const s = await requireSession("sales");
  await requireFeaturePage(s, "documentoComercial");
  const { id } = await params;
  const { print } = await searchParams;
  const v = await documentView(s.ctx, id);
  if (!v || v.doc.type !== type) notFound();
  const company = await s.ctx.store.get("companies", v.doc.companyId);
  const back = `/vendas/${type === "quote" ? "orcamentos" : "pedidos"}/${id}`;
  return (
    <div className="flex flex-col items-center gap-4">
      <PrintStyles paper="A4" />
      <div className="no-print flex flex-wrap gap-2">
        <AutoPrint enabled={print === "1"} />
        <LinkButton href={back}>Voltar ao documento</LinkButton>
      </div>
      <DocumentSheet doc={v.doc} items={v.items} company={company} branch={v.branch} sellerName={v.sellerName} termName={v.termName} />
    </div>
  );
}
