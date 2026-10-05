import { requireSession } from "@/lib/server/session";
import { TitleDetail } from "../../_components/title-detail";

export const metadata = { title: "Conta a pagar" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("finance");
  const { id } = await params;
  const { tab = "parcelas" } = await searchParams;
  return <TitleDetail s={s} kind="payable" id={id} tab={tab} />;
}
