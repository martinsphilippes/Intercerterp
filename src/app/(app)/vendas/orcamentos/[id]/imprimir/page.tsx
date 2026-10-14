import { DocumentPrintPage } from "../../../_documentos/print-page";

export const metadata = { title: "Imprimir orçamento" };

export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  return <DocumentPrintPage type="quote" params={params} searchParams={searchParams} />;
}
