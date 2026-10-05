import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { lookups } from "@/lib/server/lookups";
import { canDo } from "@/lib/permissions";
import { today } from "@/lib/dates";
import { TitleForm } from "../../_components/title-form";

export const metadata = { title: "Nova conta a pagar" };

export default async function Page() {
  const s = await requireSession("finance", "create");
  const [parties, categories, costCenters, terms] = await Promise.all([
    lookups.suppliers(s.ctx),
    lookups.finCategories(s.ctx, "expense"),
    lookups.costCenters(s.ctx),
    listAll(s.ctx.store, "payment_terms", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
  ]);
  return (
    <>
      <PageHeader title="Nova conta a pagar" crumbs={[{ label: "Financeiro" }, { label: "Contas a pagar", href: "/financeiro/pagar" }, { label: "Novo" }]} />
      {!s.ctx.branchId && (
        <div className="mb-4">
          <Notice tone="warn">Selecione uma filial específica para lançar títulos (o contexto consolidado é somente consulta).</Notice>
        </div>
      )}
      <TitleForm
        kind="payable"
        parties={parties}
        categories={categories}
        costCenters={costCenters}
        terms={terms.filter((t) => t.kind !== "sale").map((t) => ({ value: t.id, label: t.name, installments: t.installments, firstDueDays: t.firstDueDays, intervalDays: t.intervalDays }))}
        today={today()}
        canApprove={canDo(s.user, "finance.approve_payable")}
      />
    </>
  );
}
