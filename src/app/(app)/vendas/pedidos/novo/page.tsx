import { NewDocumentPage } from "../../_documentos/new-page";

export const metadata = { title: "Novo pedido de venda" };

export default function Page({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  return <NewDocumentPage type="order" searchParams={searchParams} />;
}
