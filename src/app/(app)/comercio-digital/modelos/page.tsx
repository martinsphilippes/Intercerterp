import Link from "@/components/ui/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { canDo } from "@/lib/permissions";
import { themeOf } from "@/domain/ecommerce/store";
import { TEMPLATE_KEYS, type TemplateKey } from "@/domain/ecommerce/templates";
import { TemplateGallery } from "../_components/template-gallery";
import { applyTemplateAction } from "../actions";
import { ecomStorePage } from "../_lib";

export const metadata = { title: "Modelos da loja" };

/** Tela 50 — Modelos da loja: Essencial (varejo geral), Coleção (destaque editorial) e Campanha (oferta principal). */
export default async function Page() {
  const { s, st } = await ecomStorePage(["ecommerce.manage", "ecommerce.catalog", "ecommerce.marketing"]);
  const theme = themeOf(st);
  const apply = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, applyTemplateAction.bind(null, k)])) as Record<TemplateKey, (fd: FormData) => Promise<any>>;
  return (
    <>
      <PageHeader
        title="Escolha o modelo da sua loja"
        crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Modelos da loja" }]}
        description="Comece com uma estrutura pronta e personalize sua identidade na próxima etapa. Visualizar um modelo não altera a escolha salva; aplicar muda só o rascunho — produtos e pedidos continuam vinculados ao ERP."
        actions={
          <Link href="/comercio-digital/editor" className={buttonClass("secondary")}>
            Editor visual <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      />
      <TemplateGallery current={(st.template ?? "essencial") as TemplateKey} accent={theme.accentColor} storeName={st.name} title={theme.title} tagline={theme.tagline} canApply={canDo(s.user, "ecommerce.manage")} apply={apply} />
    </>
  );
}
