import type { SearchParams } from "@/lib/list";
import { DocumentsList } from "../_documentos/list-page";

export const metadata = { title: "Pedidos de venda" };

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <DocumentsList type="order" searchParams={searchParams} />;
}
