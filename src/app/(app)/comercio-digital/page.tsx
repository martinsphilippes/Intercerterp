import Link from "@/components/ui/link";
import { CheckCircle2, Circle, ExternalLink, Eye, LayoutTemplate } from "lucide-react";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { STORE_STATUS_LABEL, type StoreStatus } from "@/domain/ecommerce/common";
import { primaryDomainOf, readiness, themeOf } from "@/domain/ecommerce/store";
import { templateOf } from "@/domain/ecommerce/templates";
import { hasBlocking } from "@/domain/ecommerce/catalog";
import { expirePendingOrders } from "@/domain/ecommerce/orders";
import { INTEGRATION_CATALOG, STATUS_LABEL, getIntegration, type IntegrationKind } from "@/domain/integrations";
import { StorePreview } from "./_components/store-preview";
import { createStoreAction } from "./actions";
import { ecomPage, storePreviewProps } from "./_lib";

export const metadata = { title: "Central de comércio digital" };

const STEPS: Array<{ n: number; title: string; hint: string; keys: string[]; href: string }> = [
  { n: 1, title: "Escolher e personalizar a loja", hint: "Modelos para varejo e campanhas, identidade, dados do fornecedor e páginas", keys: ["identity", "legal", "pages"], href: "/comercio-digital/modelos" },
  { n: 2, title: "Habilitar os recebimentos", hint: "Gateway e Banco Intercert", keys: ["payments"], href: "/comercio-digital/pagamentos" },
  { n: 3, title: "Configurar entrega e retirada", hint: "Frete, etiquetas e rastreamento", keys: ["shipping"], href: "/comercio-digital/frete" },
  { n: 4, title: "Revisar o catálogo e publicar", hint: "Catálogo, preços e disponibilidade", keys: ["catalog"], href: "/comercio-digital/catalogo" },
];

const STATUS_TONE: Record<StoreStatus, "warn" | "good" | "neutral"> = { draft: "warn", published: "good", paused: "neutral" };

/** Tela 49 — Central de comércio digital: entrada da loja nativa no ERP. */
export default async function Page() {
  const { s, st } = await ecomPage();
  const manage = canDo(s.user, "ecommerce.manage");
  if (!st) {
    const branches = s.branches.filter((b) => b.status !== "inactive");
    return (
      <>
        <PageHeader title="Loja Virtual Intercert" crumbs={[{ label: "Comércio digital" }]} description="Sua operação on-line dentro do ERP: os mesmos produtos, preços, estoque, clientes, notas e financeiro." />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Criar a loja virtual da empresa">
            {manage ? (
              <ActionForm action={createStoreAction} className="space-y-3">
                <Field label="Nome da loja" hint="Aparece no topo da vitrine (pode ser alterado depois)." htmlFor="store-name">
                  <Input id="store-name" name="name" defaultValue={s.company.tradeName || s.company.name} required />
                </Field>
                <Field label="Filial que atende os pedidos on-line" hint="O estoque, a nota fiscal e a expedição saem desta filial." htmlFor="store-branch">
                  <Select id="store-branch" name="branchId" defaultValue={s.ctx.branchId ?? branches[0]?.id} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
                </Field>
                <button type="submit" className={buttonClass("primary")}>Criar loja em rascunho</button>
                <p className="text-xs text-slate-500">A loja nasce em rascunho, com retirada na loja, pagamentos em simulação e páginas legais preenchidas com os dados da empresa para revisão. Nada fica público até a publicação.</p>
              </ActionForm>
            ) : (
              <p className="text-sm text-slate-600">A loja virtual ainda não foi criada. Peça a quem tem a operação “Comércio digital — gerir a loja” para criá-la.</p>
            )}
          </Card>
          <Card title="Como funciona">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>Escolha o modelo da vitrine e personalize a identidade (Telas 50 e 51).</li>
              <li>Selecione os produtos do ERP que serão vendidos on-line (Tela 52).</li>
              <li>Defina pagamentos, entrega e retirada (Telas 56 e 58).</li>
              <li>Publique: os pedidos chegam aqui com o estoque reservado e seguem para nota fiscal, expedição e conciliação.</li>
            </ol>
          </Card>
        </div>
      </>
    );
  }

  await expirePendingOrders(s.ctx.store, s.ctx.companyId).catch(() => 0);
  const base = unscoped(s.ctx.store);
  const [checks, listings, products, orders, domain, preview] = await Promise.all([
    readiness(s.ctx, st),
    listAll(base, "store_products", { filters: [["eq", "storeId", st.id]] }),
    listAll(s.ctx.store, "products", { filters: [["eq", "companyId", s.ctx.companyId]] }),
    listAll(base, "online_orders", { filters: [["eq", "storeId", st.id]] }, 5000),
    primaryDomainOf(s.ctx.store, st.id),
    storePreviewProps(s.ctx.store, st),
  ]);
  const integrations = await Promise.all((["store_gateway", "store_bank", "store_logistics", "store_domains"] as IntegrationKind[]).map(async (k) => ({ kind: k, integ: await getIntegration(s.ctx.store, s.ctx.companyId, null, k) })));
  const theme = themeOf(st);
  const tpl = templateOf(st.template);
  const sellable = listings.filter((l) => l.published && !hasBlocking(l.issues)).length;
  const erpProducts = products.filter((p) => p.type !== "service" && p.active !== false).length;
  const activeBranches = s.branches.filter((b) => b.status !== "inactive").length;
  const byStatus = (x: string) => orders.filter((o) => o.status === x);
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => String(o.createdAt).slice(0, 10) === today && o.status !== "cancelled");
  const ok = (keys: string[]) => checks.filter((c) => keys.includes(c.key)).every((c) => c.ok);
  const status = (st.status ?? "draft") as StoreStatus;

  return (
    <>
      <PageHeader
        title={/^loja\b/i.test(st.name) ? st.name : `Loja Virtual ${st.name}`}
        crumbs={[{ label: "Comércio digital" }]}
        description="Sua operação on-line, dentro do ERP."
        badges={<Badge tone={STATUS_TONE[status]}>{STORE_STATUS_LABEL[status]}</Badge>}
        actions={
          <Link href="/comercio-digital/ver-loja" className={buttonClass("secondary")} target="_blank" rel="noopener">
            <ExternalLink className="size-4" aria-hidden /> {status === "published" ? "Ver loja pública" : "Ver prévia da loja"}
          </Link>
        }
      />
      <nav aria-label="Áreas do comércio digital" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 text-sm">
        {[
          ["/comercio-digital", "Visão geral"],
          ["/comercio-digital/editor", "Minha loja"],
          ["/comercio-digital/canais", "Canais de venda"],
          ["/comercio-digital/pagamentos", "Banco e pagamentos"],
          ["/comercio-digital/frete", "Logística"],
        ].map(([href, label], i) => (
          <Link key={href} href={href} className={`-mb-px border-b-2 px-3 py-2 ${i === 0 ? "border-accent-500 font-semibold text-brand-800" : "border-transparent text-slate-600 hover:text-ink"}`} aria-current={i === 0 ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <section aria-label="Indicadores" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Produtos no ERP" value={erpProducts} href="/produtos" />
        <Stat label="Itens na vitrine" value={sellable} href="/comercio-digital/catalogo" tone={sellable ? "good" : "warn"} />
        <Stat label="Filiais de estoque" value={activeBranches} />
        <Stat label="Pedidos hoje" value={todayOrders.length} hint={formatMoney(todayOrders.reduce((a, o) => a + (o.total ?? 0), 0))} href="/comercio-digital/pedidos" />
        <Stat label="A faturar" value={byStatus("paid").length} href="/comercio-digital/pedidos?status=paid" tone={byStatus("paid").length ? "warn" : "default"} />
        <Stat label="A expedir / retirar" value={byStatus("invoiced").length + byStatus("ready_for_pickup").length} href="/comercio-digital/expedicao" />
      </section>
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card title="Sua loja própria" actions={<Badge tone={STATUS_TONE[status]}>{STORE_STATUS_LABEL[status]}</Badge>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-brand-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modelo selecionado</p>
              <p className="mt-1 text-xl font-semibold text-ink">{tpl.name}</p>
              <p className="text-sm text-slate-600">{st.name}</p>
              <p className="mt-3 break-all text-xs text-slate-500">
                Endereço: <span className="font-mono">{domain ?? `…/loja/${st.slug}`}</span>
              </p>
            </div>
            <StorePreview template={st.template} accent={theme.accentColor} storeName={st.name} title={theme.title} tagline={theme.tagline} compact {...preview} />
          </div>
          <p className="mt-3 text-sm text-slate-600">Use os produtos e o estoque que você já administra no ERP. Personalize a vitrine para começar a vender on-line.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {manage && (
              <Link href="/comercio-digital/modelos" className={buttonClass("accent")}>
                <LayoutTemplate className="size-4" aria-hidden /> Escolher modelo
              </Link>
            )}
            <Link href="/comercio-digital/ver-loja" target="_blank" rel="noopener" className={buttonClass("secondary")}>
              <Eye className="size-4" aria-hidden /> Ver prévia da loja
            </Link>
          </div>
        </Card>
        <Card title="Preparar para vender">
          <ol className="space-y-3">
            {STEPS.map((step) => {
              const done = ok(step.keys);
              const missing = checks.filter((c) => step.keys.includes(c.key) && !c.ok);
              return (
                <li key={step.n} className="flex gap-3">
                  <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`} aria-hidden>
                    {done ? <CheckCircle2 className="size-4" /> : step.n}
                  </span>
                  <div className="min-w-0">
                    <Link href={step.href} className="font-medium text-ink hover:text-brand-700 hover:underline">
                      {step.title}
                    </Link>
                    <p className="text-sm text-slate-500">{step.hint}</p>
                    {missing.map((m) => (
                      <p key={m.key} className="text-xs text-amber-800">Pendente: {m.label.toLowerCase()} — {m.detail}</p>
                    ))}
                  </div>
                </li>
              );
            })}
            <li className="flex gap-3">
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`} aria-hidden>
                {status === "published" ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
              </span>
              <div>
                <Link href="/comercio-digital/editor?aba=publicacao" className="font-medium text-ink hover:text-brand-700 hover:underline">
                  Publicar a loja
                </Link>
                <p className="text-sm text-slate-500">{status === "published" ? "A vitrine está recebendo pedidos." : "Revise os requisitos e disponibilize a loja aos clientes."}</p>
              </div>
            </li>
          </ol>
        </Card>
        <Card title="Uma operação conectada" className="xl:col-span-2">
          <ul className="divide-y divide-slate-100">
            {[
              { title: "Marketplaces e comércio social", hint: "Catálogo, estoque e pedidos conforme a cobertura de cada canal.", href: "/comercio-digital/canais", cta: "Explorar canais" },
              { title: "Banco e gateway Intercert", hint: "Recebimentos, repasses e conciliação no financeiro.", href: "/comercio-digital/banco", cta: "Ver integração" },
              { title: "Logística da venda à entrega", hint: "Retirada, entrega própria, entrega por terceiros e transportadora.", href: "/comercio-digital/frete", cta: "Configurar entrega" },
            ].map((x) => (
              <li key={x.href} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium text-ink">{x.title}</p>
                  <p className="text-sm text-slate-500">{x.hint}</p>
                </div>
                <Link href={x.href} className={buttonClass("secondary", "sm")}>{x.cta}</Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {integrations.map(({ kind, integ }) => (
              <div key={kind} className="rounded-md border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-500">{INTEGRATION_CATALOG[kind].label}</p>
                <p className="text-sm font-medium text-ink">{integ ? `${INTEGRATION_CATALOG[kind].providers.find((p) => p.id === integ.provider)?.label ?? integ.provider}` : kind === "store_domains" ? "Apontamento manual (DNS)" : "Simulação (padrão)"}</p>
                <p className="text-xs text-slate-500">{integ ? STATUS_LABEL[integ.status] ?? integ.status : kind === "store_domains" ? "Sem integração: verificação pelo DNS" : "Sem configuração: a simulação responde"}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4">
        <Notice tone="sim" title="Serviços externos em simulação até a homologação">
          Pagamentos (Gateway Intercert), créditos e repasses (Banco Intercert) e cotações de transportadora usam a simulação até a ligação de cada serviço na <Link className="font-medium underline" href="/administracao/integracoes">Central de integrações</Link>: nenhuma cobrança, envio ou repasse real é feito. Pedidos, reservas de estoque, notas e recebíveis seguem as regras reais do ERP.
        </Notice>
      </div>
    </>
  );
}
