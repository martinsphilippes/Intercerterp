import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { productFormOptions } from "../form-options";
import { ProductCreateForm } from "../product-form";

export const metadata = { title: "Novo produto" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("products", "create");
  const { tab = "geral" } = await searchParams;
  const o = await productFormOptions(s);
  return (
    <>
      <PageHeader
        title="Novo produto ou serviço"
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Novo" }]}
        description="Preencha as abas e salve uma vez. Depois do cadastro, cada aba passa a ter edição própria com histórico."
      />
      <ProductCreateForm o={o} initialTab={tab} />
    </>
  );
}
