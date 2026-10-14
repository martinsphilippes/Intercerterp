import { DocumentPrintPage } from "../../../_documentos/print-page";

export const metadata = { title: "Imprimir pedido de venda" };

export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  return <DocumentPrintPage type="order" params={params} searchParams={searchParams} />;
}
