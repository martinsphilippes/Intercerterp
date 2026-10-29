import Link from "@/components/ui/link";
import { requireFirmSession } from "../../guard";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { addDays, today } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { certificationSettings, clientTrackingAllowed } from "@/domain/accounting";
import { firmNetworkTerms } from "@/domain/network";
import { portfolioRefs, queryPortfolio } from "../../queries";
import { knownByClient, openRequestsByClient } from "../queries";
import { RequestForm, type ClientInfo, type ProductInfo } from "../request-form";

export const metadata = { title: "Nova solicitação de certificado" };

/** Prazo padrão da cobrança: hoje + 5 dias. */
const DEFAULT_DUE_DAYS = 5;

export default async function Page({ searchParams }: { searchParams: Promise<{ cliente?: string; kind?: string; previous?: string }> }) {
  const s = await requireFirmSession("create");
  const sp = await searchParams;
  const crumbs = [{ label: "Carteira", href: "/contabil" }, { label: "Certificados digitais", href: "/contabil/certificados" }, { label: "Nova solicitação" }];
  if (!canDo(s.user, "accounting.certificates")) {
    return (
      <>
        <PageHeader title="Nova solicitação de certificado" crumbs={crumbs} />
        <Notice tone="warn" title="Abrir solicitações exige uma permissão específica">
          Solicitar, cobrar e baixar certificados digitais dos clientes é uma operação do perfil (“Solicitar, cobrar e baixar certificados digitais dos clientes”). Peça ao administrador do escritório ou{" "}
          <Link href="/contabil/certificados" className="underline">
            volte ao acompanhamento
          </Link>
          .
        </Notice>
      </>
    );
  }

  const [portfolio, settings, refs, known, openByClient] = await Promise.all([queryPortfolio(s.ctx, { q: "", f: {} }), certificationSettings(s.ctx.store), portfolioRefs(s.ctx), knownByClient(s.ctx), openRequestsByClient(s.ctx)]);
  const active = portfolio.filter((c) => c.status !== "closed");
  const clients: ClientInfo[] = await Promise.all(
    active.map(async (c) => {
      const tracking = await clientTrackingAllowed(s.ctx, c);
      const open = openByClient.get(c.id) ?? null;
      const last = known.get(c.id) ?? null;
      return {
        id: c.id,
        name: c.name as string,
        code: (c.code as string) ?? null,
        doc: (c.doc as string) ?? null,
        personType: c.personType === "PF" ? "PF" : "PJ",
        email: (c.email as string) ?? null,
        phone: (c.phone as string) ?? null,
        responsibleUserId: (c.responsibleUserId as string) ?? null,
        tracking,
        openRequest: open ? { id: open.id, protocol: open.protocol, status: open.status } : null,
        lastCert: last ? { id: last.id, validTo: last.validTo, productLabel: last.productLabel, daysLeft: last.daysLeft, validity: last.validity, source: last.source } : null,
      };
    }),
  );
  // §45: escritório que é nó contador da rede vende pelo preço da rede (padrão do nó, mínimo e custo); fora da rede, o catálogo
  const network = await firmNetworkTerms(s.ctx.store, s.ctx.companyId);
  const products: ProductInfo[] = settings.catalog
    .filter((p) => p.active && !p.free && (!network || network.has(p.key)))
    .map((p) => {
      const n = network?.get(p.key) ?? null;
      return { key: p.key, label: p.label, months: p.months, price: n ? n.defaultPrice : p.price, network: n ? { cost: n.cost, minPrice: n.minPrice, canEdit: n.canEdit } : null };
    });
  const t = today();

  return (
    <>
      <PageHeader title="Nova solicitação de certificado" crumbs={crumbs} description="Cadastro do pedido e preparação do valor a ser cobrado do cliente. A cobrança é da certificação digital, separada da mensalidade do ERP; a equipe de certificação confirma o pagamento e cuida da validação e da emissão." />
      {clients.length === 0 ? (
        <Notice tone="info" title="Nenhum cliente em atividade na sua carteira">
          Cadastre o cliente antes de solicitar um certificado:{" "}
          <Link href="/contabil/clientes/novo" className="underline">
            novo cliente
          </Link>
          .
        </Notice>
      ) : products.length === 0 ? (
        <Notice tone="warn" title="Catálogo de certificados sem produto ativo">
          A equipe de certificação precisa manter ao menos um produto ativo no catálogo (Administração → Certificação digital) antes que o escritório abra solicitações.
        </Notice>
      ) : (
        <RequestForm
          clients={clients}
          products={products}
          users={refs.users}
          initialClientId={sp.cliente?.trim() || null}
          initialKind={sp.kind === "renewal" ? "renewal" : "new"}
          initialPrevious={sp.previous?.trim() || null}
          defaultDueDate={addDays(t, DEFAULT_DUE_DAYS)}
          defaultDueDays={DEFAULT_DUE_DAYS}
          minDueDate={t}
        />
      )}
    </>
  );
}
