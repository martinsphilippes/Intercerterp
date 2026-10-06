import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { lookups } from "@/lib/server/lookups";
import { canDo } from "@/lib/permissions";
import { today } from "@/lib/dates";
import { TitleForm } from "../../_components/title-form";

export const metadata = { title: "Novo título a receber" };

export default async function Page() {
  const s = await requireSession("finance", "create");
  const [parties, categories, costCenters, terms] = await Promise.all([
    lookups.customers(s.ctx),
    lookups.finCategories(s.ctx, "revenue"),
    lookups.costCenters(s.ctx),
    listAll(s.ctx.store, "payment_terms", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
  ]);
  return (
    <>
      <PageHeader title="Novo título a receber" crumbs={[{ label: "Financeiro" }, { label: "Contas a receber", href: "/financeiro/receber" }, { label: "Novo" }]} />
      {!s.ctx.branchId && (
        <div className="mb-4">
          <Notice tone="warn">Selecione uma filial específica para lançar títulos (o contexto consolidado é somente consulta).</Notice>
        </div>
      )}
      <TitleForm
        kind="receivable"
        parties={parties}
        categories={categories}
        costCenters={costCenters}
        terms={terms.filter((t) => t.kind !== "purchase").map((t) => ({ value: t.id, label: t.name, installments: t.installments, firstDueDays: t.firstDueDays, intervalDays: t.intervalDays, interestBps: t.interestBps ?? 0 }))}
        today={today()}
        canApprove={canDo(s.user, "finance.approve_payable")}
      />
    </>
  );
}
