import { DocumentDetail } from "../../_documentos/detail-page";

export const metadata = { title: "Pedido de venda" };

export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; editar?: string }> }) {
  return <DocumentDetail type="order" params={params} searchParams={searchParams} />;
}
