import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Painel do gestor" };

export default async function Page() {
  const s = await requireSession("dashboard");
  return <PageHeader title="Painel do gestor" crumbs={[{ label: "Gestão" }, { label: "Painel" }]} description={`Bem-vindo, ${s.user.name}.`} />;
}
