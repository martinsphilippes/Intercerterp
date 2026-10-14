import type { SearchParams } from "@/lib/list";
import { DocumentsList } from "../_documentos/list-page";

export const metadata = { title: "Orçamentos" };

export default function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <DocumentsList type="quote" searchParams={searchParams} />;
}
