import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { MAX_WAREHOUSE_TRANSFER_LINES } from "@/domain/transfers";
import { WAREHOUSE_TYPE_LABEL, isActiveWarehouse, sortWarehouses, warehouseOptionLabel, warehouseType } from "@/domain/warehouse-rules";
import { WarehouseTransferForm } from "./warehouse-transfer-form";

export const metadata = { title: "Transferência entre depósitos" };

export default async function Page() {
  const s = await requireSession("stock", "create");
  const header = (
    <PageHeader
      title="Transferência entre depósitos"
      crumbs={[{ label: "Transferências", href: "/estoque/transferencias?tipo=depositos" }, { label: "Entre depósitos" }]}
      description="Move saldo entre depósitos da mesma filial na hora (sem trânsito): por exemplo, do almoxarifado para a loja ou da loja para uso e consumo."
    />
  );
  if (!s.ctx.branchId) {
    return (
      <>
        {header}
        <Notice tone="info">Selecione uma filial (o contexto consolidado é somente consulta).</Notice>
      </>
    );
  }
  const whs = sortWarehouses((await listAll(s.ctx.store, "warehouses", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "branchId", s.ctx.branchId]] })).filter(isActiveWarehouse));
  return (
    <>
      {header}
      {whs.length < 2 ? (
        <Notice tone="warn" title="A filial tem um único depósito ativo">
          Cadastre outro depósito (Administração › Empresas › filial › Operação › Depósitos) para transferir saldo entre eles.
        </Notice>
      ) : (
        <WarehouseTransferForm branchName={s.branch?.name ?? ""} maxLines={MAX_WAREHOUSE_TRANSFER_LINES} warehouses={whs.map((w) => ({ id: w.id, label: warehouseOptionLabel(w), typeLabel: WAREHOUSE_TYPE_LABEL[warehouseType(w)] }))} />
      )}
    </>
  );
}
