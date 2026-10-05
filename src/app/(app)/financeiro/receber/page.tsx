import { requireSession } from "@/lib/server/session";
import type { SearchParams } from "@/lib/list";
import { TitlesList } from "../_components/titles-list";

export const metadata = { title: "Contas a receber" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  return <TitlesList s={s} kind="receivable" params={await searchParams} />;
}
