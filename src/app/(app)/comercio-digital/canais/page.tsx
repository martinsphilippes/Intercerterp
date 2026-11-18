import Link from "@/components/ui/link";
import { Activity, Store as StoreIcon, Camera, Users, ShoppingBasket, Search, MessageCircle, Package, X } from "lucide-react";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { CHANNEL_GROUP_LABEL, channelsView, type ChannelGroup } from "@/domain/ecommerce/channels";
import { prepareChannelAction } from "../actions";
import { brDateTime, ecomStorePage } from "../_lib";

export const metadata = { title: "Canais e contas" };

const GROUPS: Array<{ key: "all" | ChannelGroup; label: string }> = [
  { key: "all", label: "Todos os canais" },
  { key: "marketplace", label: "Marketplace" },
  { key: "social", label: "Rede social" },
  { key: "discovery", label: "Descoberta" },
  { key: "messaging", label: "Mensageria" },
];

const ICON: Record<ChannelGroup, React.ComponentType<{ className?: string }>> = { marketplace: ShoppingBasket, social: Camera, discovery: Search, messaging: MessageCircle };

/** Tela 53 — Canais e contas conectadas: conectores PLANEJADOS; preparar a conta não autoriza nem conecta. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.manage", "ecommerce.catalog"]);
  const params = await searchParams;
  const group = (GROUPS.some((g) => g.key === sp(params, "grupo")) ? sp(params, "grupo") : "all") as "all" | ChannelGroup;
  const preparing = sp(params, "preparar");
  const manage = canDo(s.user, "ecommerce.manage");
  const rows = (await channelsView(s.ctx)).filter((r) => group === "all" || r.def.group === group);
  const categories = preparing ? await listAll(s.ctx.store, "categories", { filters: [["eq", "companyId", s.ctx.companyId]] }) : [];
  void st;
  return (
    <>
      <PageHeader
        title="Canais e contas conectadas"
        crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Canais e contas" }]}
        description="Prepare as contas e acompanhe o que cada conector precisará oferecer. A loja própria é a primeira frente; os demais canais terão ativação própria."
        actions={<Link href="/comercio-digital/monitor" className={buttonClass("secondary")}><Activity className="size-4" aria-hidden /> Monitorar</Link>}
      />
      <Notice tone="warn">Catálogo de integrações planejadas. A cobertura de cada recurso depende das APIs, da elegibilidade da conta e da homologação do conector. Salvar uma configuração não autoriza nem conecta a conta.</Notice>
      <nav aria-label="Filtrar canais" className="my-4 flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <Link key={g.key} href={g.key === "all" ? "/comercio-digital/canais" : `/comercio-digital/canais?grupo=${g.key}`} aria-current={g.key === group ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${g.key === group ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-ink hover:bg-slate-50"}`}>
            {g.label}
          </Link>
        ))}
      </nav>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ def, account }) => {
          const Icon = ICON[def.group] ?? Package;
          const open = preparing === def.key;
          return (
            <article key={def.key} className={`flex flex-col rounded-xl border bg-white p-4 ${open ? "border-brand-500 ring-1 ring-brand-500 md:col-span-2 xl:col-span-3" : "border-slate-200"}`}>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-ink">{def.name}</h3>
                  <p className="text-xs text-slate-500">{CHANNEL_GROUP_LABEL[def.group]}</p>
                </div>
                {account ? <Badge tone="info">Conta preparada</Badge> : <Badge>Conector planejado</Badge>}
              </div>
              <p className="mt-3 text-sm text-slate-700">{def.coverage}</p>
              <p className="mt-1 text-xs text-slate-500">Condição: {def.condition}</p>
              {account && (
                <p className="mt-2 text-xs text-slate-600">
                  Conta “{account.accountName}” · catálogo: {account.catalogScope === "categories" ? `${(account.categoryIds ?? []).length} categoria(s)` : "todos os produtos da vitrine"} · {brDateTime(account.preparedAt)}
                </p>
              )}
              {open ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="font-semibold text-ink">Preparação da conta e limites do conector</p>
                    <Link href={`/comercio-digital/canais${group === "all" ? "" : `?grupo=${group}`}`} className={buttonClass("ghost", "sm")} aria-label="Fechar"><X className="size-4" aria-hidden /></Link>
                  </div>
                  <ActionForm action={prepareChannelAction.bind(null, def.key)} className="grid gap-3 md:grid-cols-2" redirectTo="/comercio-digital/canais">
                    <Field label="Nome interno da conta" required htmlFor="accountName"><Input id="accountName" name="accountName" defaultValue={account?.accountName ?? `${s.company.tradeName || s.company.name} no ${def.name}`} required /></Field>
                    <Field label="Origem do catálogo" htmlFor="catalogScope"><Select id="catalogScope" name="catalogScope" defaultValue={account?.catalogScope ?? "all"} options={[{ value: "all", label: "Todos os produtos da vitrine" }, { value: "categories", label: "Somente categorias escolhidas" }]} /></Field>
                    <Field label="Categorias (quando “somente categorias”)" className="md:col-span-2">
                      <div className="flex flex-wrap gap-3">
                        {categories.map((c) => (
                          <label key={c.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="categoryIds" value={c.id} defaultChecked={(account?.categoryIds ?? []).includes(c.id)} /> {c.name}</label>
                        ))}
                      </div>
                    </Field>
                    <Field label="Observações" className="md:col-span-2" htmlFor="notes"><Textarea id="notes" name="notes" defaultValue={account?.notes ?? ""} rows={2} /></Field>
                    <div className="md:col-span-2">
                      <Notice tone="warn" title="Salvar não equivale a conectar">{def.condition} A conta fica em rascunho até o conector do canal ser homologado.</Notice>
                    </div>
                    <div className="md:col-span-2"><button type="submit" className={buttonClass("primary")}>Salvar rascunho da conta</button></div>
                  </ActionForm>
                </div>
              ) : (
                manage && (
                  <Link href={`/comercio-digital/canais?${group === "all" ? "" : `grupo=${group}&`}preparar=${def.key}`} className={buttonClass("secondary", "md", "mt-4 w-full justify-center")}>
                    <StoreIcon className="size-4" aria-hidden /> {account ? "Revisar conta" : "Preparar conexão"}
                  </Link>
                )
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500"><Users className="size-3.5" aria-hidden /> Regra de origem: se o marketplace controlar checkout, frete ou repasse, o ERP acompanha o fluxo do canal. O Gateway Intercert atende a loja própria.</p>
    </>
  );
}
