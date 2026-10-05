import { requireSession } from "@/lib/server/session";
import { TitleReceipt } from "../../../_components/receipt";

export const metadata = { title: "Título a receber — recibo" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ parcela?: string; baixa?: string }> }) {
  const s = await requireSession("finance");
  const { id } = await params;
  const sp = await searchParams;
  return <TitleReceipt s={s} kind="receivable" id={id} installmentId={sp.parcela} settlementId={sp.baixa} />;
}
