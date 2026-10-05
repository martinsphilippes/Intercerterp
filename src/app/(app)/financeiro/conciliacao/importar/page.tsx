import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { listAll } from "@/lib/db";
import { can, canDo } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Importar extrato" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  const params = await searchParams;
  const accounts = (await listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }))
    .sort((a, b) => (a.kind === "bank" ? -1 : 1) - (b.kind === "bank" ? -1 : 1) || a.name.localeCompare(b.name, "pt-BR"))
    .map((a) => ({ value: a.id, label: `${a.name}${a.bankCode ? ` (banco ${a.bankCode})` : ""}` }));
  const block = !s.ctx.branchId ? "Selecione uma filial (consolidado é somente consulta)." : !canDo(s.user, "finance.reconcile") ? "Sem permissão para conciliar/importar extratos." : null;
  return (
    <>
      <PageHeader
        title="Importar extrato bancário"
        crumbs={[{ label: "Financeiro" }, { label: "Conciliação bancária", href: `/financeiro/conciliacao${sp(params, "account") ? `?account=${sp(params, "account")}` : ""}` }, { label: "Importar" }]}
        description="Selecione o arquivo exportado pelo banco. O formato é validado antes de gravar; o mesmo arquivo (ou transações já importadas) nunca é duplicado."
      />
      <ImportWizard accounts={accounts} defaultAccount={sp(params, "account") || accounts[0]?.value || ""} canImport={can(s.user, "finance", "create") && !block} block={block} />
    </>
  );
}
