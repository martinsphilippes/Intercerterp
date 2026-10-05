import { requireSession } from "@/lib/server/session";
import { TitleReceipt } from "../../../_components/receipt";

export const metadata = { title: "Conta a pagar — recibo" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ parcela?: string; baixa?: string }> }) {
  const s = await requireSession("finance");
  const { id } = await params;
  const sp = await searchParams;
  return <TitleReceipt s={s} kind="payable" id={id} installmentId={sp.parcela} settlementId={sp.baixa} />;
}
