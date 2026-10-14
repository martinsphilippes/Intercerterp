import { notFound } from "next/navigation";
import { getStore } from "@/lib/db";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { isFeatureOn } from "@/lib/core/settings";
import { documentByShareToken, SALES_DOC_FLAG } from "@/domain/sales-documents";
import { DocumentSheet } from "@/app/(app)/vendas/_documentos/doc-print";
import { PrintStyles } from "@/app/(app)/vendas/print-styles";
import { AutoPrint } from "@/app/(app)/vendas/sale-widgets";

export const metadata = { title: "Orçamento / pedido", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Link enviado ao cliente (WhatsApp/e-mail): visualização e impressão do orçamento/pedido, somente leitura, pelo token
 * aleatório de 128 bits gravado no documento. Não mostra custo, observações internas, reservas nem dados de outros documentos.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ print?: string }> }) {
  await ensureBootstrap();
  const { token } = await params;
  const { print } = await searchParams;
  const store = getStore();
  const found = await documentByShareToken(store, token);
  // recurso desligado na empresa/filial do documento: o link deixa de funcionar
  if (!found || !(await isFeatureOn(store, found.doc.companyId, found.doc.branchId, SALES_DOC_FLAG, true))) notFound();
  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-100 p-3 sm:p-6">
      <PrintStyles paper="A4" />
      <div className="no-print">
        <AutoPrint enabled={print === "1"} />
      </div>
      <DocumentSheet doc={found.doc} items={found.items} company={found.company} branch={found.branch} sellerName={found.sellerName} termName={found.termName} />
    </main>
  );
}
