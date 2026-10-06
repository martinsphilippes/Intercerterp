import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { UFS } from "@/domain/companies";
import { DEFAULT_TZ } from "@/lib/dates";
import { BranchForm } from "../../../forms";
import { companyView } from "../../../access";

export const metadata = { title: "Nova filial" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "create");
  const { id } = await params;
  // empresa ativa ou outra autorizada (acesso e perfil daquela empresa)
  const cc = s.companies.some((x) => x.id === id) ? await companyView(s, id, "create") : null;
  if (!cc) notFound();
  const c = await cc.store.getOrThrow("companies", id);
  if (c.status === "inactive") redirect(`/administracao/empresas/${id}`);
  const tables = await listAll(cc.store, "price_tables", { filters: [["eq", "companyId", id], ["eq", "active", true]] });
  const branches = await listAll(cc.store, "branches", { filters: [["eq", "companyId", id]] });
  const users = (await listAll(cc.store, "users")).filter((u) => u.status === "active" && (u.isAdmin || (u.companyIds ?? []).includes(id))).map((u) => ({ value: u.id, label: u.name }));
  const next = String(branches.reduce((m, b) => Math.max(m, Number(b.code) || 0), 0) + 1).padStart(2, "0");
  return (
    <>
      <PageHeader title="Nova filial" crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: c.tradeName || c.name, href: `/administracao/empresas/${id}?tab=filiais` }, { label: "Nova filial" }]} description="A filial é criada com depósitos principal e de avarias, conta caixa e tabela de preço padrão." />
      <BranchForm branch={{ code: next, address: { uf: c.address?.uf, cityName: c.address?.cityName, cityCode: c.address?.cityCode } }} companyId={id} warehouses={[]} priceTables={tables.map((t) => ({ value: t.id, label: t.name }))} timezone={DEFAULT_TZ} ufs={UFS} users={users} />
    </>
  );
}
