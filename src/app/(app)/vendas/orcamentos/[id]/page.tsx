import { DocumentDetail } from "../../_documentos/detail-page";

export const metadata = { title: "Orçamento" };

export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; editar?: string }> }) {
  return <DocumentDetail type="quote" params={params} searchParams={searchParams} />;
}
