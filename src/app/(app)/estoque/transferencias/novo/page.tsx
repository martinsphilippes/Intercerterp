import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { TransferForm } from "../transfer-form";
import { transferFormData } from "../form-data";

export const metadata = { title: "Nova transferência" };

export default async function Page({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const s = await requireSession("stock", "create");
  const { sku } = await searchParams;
  const header = <PageHeader title="Nova transferência" crumbs={[{ label: "Transferências", href: "/estoque/transferencias" }, { label: "Nova" }]} description="Movimente produtos entre filiais com rastreabilidade da saída até o recebimento. A origem é a filial selecionada." />;
  if (!s.ctx.branchId) {
    return (
      <>
        {header}
        <Notice tone="info">Selecione uma filial de origem (o contexto consolidado é somente consulta).</Notice>
      </>
    );
  }
  const data = await transferFormData(s, { items: sku ? [{ skuId: sku, qty: 1000 }] : [] });
  return (
    <>
      {header}
      {data.branches.length === 0 ? <Notice tone="warn">Não há outra filial ativa para receber a transferência.</Notice> : <TransferForm {...data} />}
    </>
  );
}
