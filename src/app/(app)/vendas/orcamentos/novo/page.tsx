import { NewDocumentPage } from "../../_documentos/new-page";

export const metadata = { title: "Novo orçamento" };

export default function Page({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  return <NewDocumentPage type="quote" searchParams={searchParams} />;
}
