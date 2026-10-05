import { PrintPage } from "../../../_components/print-page";

export const metadata = { title: "Impressão" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PrintPage model="nfce" id={id} />;
}
