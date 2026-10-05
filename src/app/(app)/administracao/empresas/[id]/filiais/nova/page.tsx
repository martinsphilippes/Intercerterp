import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { TIMEZONES, UFS } from "@/domain/companies";
import { BranchForm } from "../../../forms";

export const metadata = { title: "Nova filial" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "create");
  const { id } = await params;
  if (!s.companies.some((c) => c.id === id)) notFound();
  const c = await s.ctx.store.getOrThrow("companies", id);
  const tables = await listAll(s.ctx.store, "price_tables", { filters: [["eq", "companyId", id], ["eq", "active", true]] });
  const branches = await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", id]] });
  const next = String(branches.reduce((m, b) => Math.max(m, Number(b.code) || 0), 0) + 1).padStart(2, "0");
  return (
    <>
      <PageHeader title="Nova filial" crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: c.tradeName || c.name, href: `/administracao/empresas/${id}?tab=filiais` }, { label: "Nova filial" }]} description="A filial é criada com depósitos principal e de avarias, conta caixa e tabela de preço padrão." />
      <BranchForm branch={{ code: next, address: { uf: c.address?.uf, cityName: c.address?.cityName, cityCode: c.address?.cityCode } }} companyId={id} warehouses={[]} priceTables={tables.map((t) => ({ value: t.id, label: t.name }))} timezones={TIMEZONES} ufs={UFS} />
    </>
  );
}
