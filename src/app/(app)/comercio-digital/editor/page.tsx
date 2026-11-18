import Link from "@/components/ui/link";
import { CheckCircle2, CircleAlert, ExternalLink, Globe, ImageUp, Pause, Rocket, Star, Trash2, RefreshCcw } from "lucide-react";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { LinkTabs } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { STORE_STATUS_LABEL, type StoreStatus } from "@/domain/ecommerce/common";
import { PAGE_LABEL, PAGE_SLUG, benefitsOf, contactOf, legalOf, pagesOf, readiness, sectionsOf, themeOf, type StorePages } from "@/domain/ecommerce/store";
import { ACCENT_PRESETS, templateOf } from "@/domain/ecommerce/templates";
import { DOMAIN_STATUS_LABEL, listDomains, type DomainStatus } from "@/domain/ecommerce/domains";
import { dnsTargets, verifyRecordName, verifyRecordValue, isApexDomain } from "@/domain/ecommerce/providers";
import { StorePreview } from "../_components/store-preview";
import { CopyButton } from "../_components/copy-button";
import {
  addDomainAction,
  pauseStoreAction,
  publishStoreAction,
  removeDomainAction,
  removeThemeImageAction,
  restoreDefaultPagesAction,
  saveIdentityAction,
  saveLegalContactAction,
  savePagesAction,
  setPrimaryDomainAction,
  uploadThemeImageAction,
  verifyDomainAction,
} from "../actions";
import { brDateTime, ecomStorePage, storePreviewProps } from "../_lib";

export const metadata = { title: "Editor visual e domínio" };

const TABS = [
  { key: "identidade", label: "Identidade e seções" },
  { key: "dados", label: "Fornecedor e contato" },
  { key: "paginas", label: "Páginas da loja" },
  { key: "dominio", label: "Domínio próprio" },
  { key: "publicacao", label: "Publicação" },
];

const DOMAIN_TONE: Record<DomainStatus, "good" | "warn" | "bad"> = { active: "good", pending_dns: "warn", misconfigured: "bad", error: "bad" };

/** Tela 51 — Editor visual e domínio: identidade, seções, páginas, domínio e requisitos de publicação. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.manage", "ecommerce.catalog", "ecommerce.marketing"]);
  const params = await searchParams;
  const tab = TABS.some((t) => t.key === sp(params, "aba")) ? sp(params, "aba")! : "identidade";
  const manage = canDo(s.user, "ecommerce.manage");
  const theme = themeOf(st);
  const sections = sectionsOf(st);
  const benefits = benefitsOf(st);
  const tpl = templateOf(st.template);
  const status = (st.status ?? "draft") as StoreStatus;
  const listings = tab === "identidade" ? (await listAll(unscoped(s.ctx.store), "store_products", { filters: [["eq", "storeId", st.id]] })).filter((l) => l.published) : [];
  const preview = tab === "identidade" ? await storePreviewProps(s.ctx.store, st) : null;
  const accentIsPreset = ACCENT_PRESETS.some((p) => p.value === theme.accentColor);

  return (
    <>
      <PageHeader
        title="Sua marca, do seu jeito"
        crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Editor e domínio" }]}
        description="Edite a identidade, as seções da página inicial, as páginas obrigatórias e o domínio da loja. As alterações valem para o rascunho e para a loja publicada."
        badges={<Badge tone={status === "published" ? "good" : status === "paused" ? "neutral" : "warn"}>{STORE_STATUS_LABEL[status]}</Badge>}
        actions={
          <Link href="/comercio-digital/ver-loja" target="_blank" rel="noopener" className={buttonClass("secondary")}>
            <ExternalLink className="size-4" aria-hidden /> Ver loja
          </Link>
        }
      />
      <LinkTabs tabs={TABS} active={tab} basePath="/comercio-digital/editor" param="aba" />

      {tab === "identidade" && (
        <div className="grid gap-4 xl:grid-cols-5 [&>*]:min-w-0">
          <Card title="Identidade e conteúdo" className="xl:col-span-3" actions={<Badge tone="info">{tpl.name}</Badge>}>
            <ActionForm action={saveIdentityAction} className="space-y-4">
              <fieldset disabled={!manage} className="space-y-4">
                <FormGrid cols={2}>
                  <Field label="Nome da loja" required htmlFor="name"><Input id="name" name="name" defaultValue={st.name} required /></Field>
                  <Field label="Título da página inicial" required htmlFor="title"><Input id="title" name="title" defaultValue={theme.title} required maxLength={80} /></Field>
                </FormGrid>
                <Field label="Texto de apoio" htmlFor="tagline"><Textarea id="tagline" name="tagline" defaultValue={theme.tagline} rows={2} maxLength={160} /></Field>
                <FormGrid cols={2}>
                  <Field label="Cor de destaque" htmlFor="accentColor">
                    <Select id="accentColor" name="accentColor" defaultValue={accentIsPreset ? theme.accentColor : ""} options={[...ACCENT_PRESETS.map((p) => ({ value: p.value, label: p.label })), { value: "", label: "Personalizada (informe ao lado)" }]} />
                  </Field>
                  <Field label="Cor personalizada (#RRGGBB)" hint="Opcional: substitui a cor escolhida." htmlFor="accentCustom">
                    <Input id="accentCustom" name="accentCustom" defaultValue={accentIsPreset ? "" : theme.accentColor} placeholder="#1f448c" pattern="#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}" />
                  </Field>
                </FormGrid>
                {tpl.hero === "editorial" && (
                  <Field label="Texto editorial da coleção" hint="Modelo Coleção: aparece no destaque de abertura." htmlFor="editorial"><Textarea id="editorial" name="editorial" defaultValue={theme.editorial} rows={3} maxLength={600} /></Field>
                )}
                {tpl.hero === "offer" && (
                  <Field label="Oferta principal" hint="Modelo Campanha: produto em destaque com preço de/por." htmlFor="offer">
                    <Select id="offer" name="offerProductId" defaultValue={theme.offerProductId ?? ""} placeholder="Escolha um produto da vitrine" options={listings.map((l) => ({ value: l.productId, label: l.title }))} />
                  </Field>
                )}
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink">Seções da página inicial</legend>
                  <div className="space-y-2">
                    <Checkbox name="secCategories" defaultChecked={sections.categories} label="Menu de categorias" />
                    <Checkbox name="secFeatured" defaultChecked={sections.featured} label="Produtos em destaque" />
                    <Checkbox name="secBenefits" defaultChecked={sections.benefits} label="Entrega e formas de pagamento (benefícios)" />
                  </div>
                </fieldset>
                <FormGrid cols={2}>
                  {[0, 1, 2, 3].map((i) => (
                    <Field key={i} label={`Benefício ${i + 1}`} htmlFor={`benefit${i + 1}`}><Input id={`benefit${i + 1}`} name={`benefit${i + 1}`} defaultValue={benefits[i] ?? ""} maxLength={60} /></Field>
                  ))}
                </FormGrid>
                <FormGrid cols={2}>
                  <Field label="Título para buscadores (SEO)" hint="Até 70 caracteres." htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={st.seo?.title ?? st.name} maxLength={70} /></Field>
                  <Field label="Descrição para buscadores" hint="Até 160 caracteres." htmlFor="seoDescription"><Input id="seoDescription" name="seoDescription" defaultValue={st.seo?.description ?? ""} maxLength={160} /></Field>
                </FormGrid>
                {manage && <button type="submit" className={buttonClass("accent", "lg", "w-full")}>Salvar alterações no rascunho</button>}
              </fieldset>
            </ActionForm>
          </Card>
          <div className="space-y-4 xl:col-span-2">
            <Card title="Prévia">
              <StorePreview template={st.template} accent={theme.accentColor} storeName={st.name} title={theme.title} tagline={theme.tagline} sections={sections} {...preview} />
            </Card>
            <Card title="Logotipo e imagem de destaque">
              {(["logo", "hero"] as const).map((which) => {
                const fileId = which === "logo" ? theme.logoFileId : theme.heroFileId;
                return (
                  <div key={which} className="mb-4 last:mb-0">
                    <p className="mb-1 text-sm font-medium text-ink">{which === "logo" ? "Logotipo" : "Imagem de destaque (abertura)"}</p>
                    {fileId ? (
                      <div className="mb-2 flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/loja/${st.slug}/imagem/${fileId}`} alt="" className="h-12 max-w-[160px] rounded border border-slate-200 object-contain" />
                        {manage && <ActionButton action={removeThemeImageAction.bind(null, which)} label="Remover" size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} confirm="Remover a imagem da loja?" />}
                      </div>
                    ) : (
                      <p className="mb-2 text-xs text-slate-500">{which === "logo" ? "Sem logotipo: a vitrine mostra o nome da loja." : "Sem imagem: a abertura usa a cor de destaque."}</p>
                    )}
                    {manage && (
                      <ActionForm action={uploadThemeImageAction.bind(null, which)} className="flex flex-wrap items-center gap-2">
                        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" aria-label={which === "logo" ? "Arquivo do logotipo" : "Arquivo da imagem de destaque"} />
                        <button type="submit" className={buttonClass("secondary", "sm")}><ImageUp className="size-4" aria-hidden /> Enviar</button>
                      </ActionForm>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-slate-500">PNG, JPEG ou WebP até 2 MB.</p>
            </Card>
            <Card title="Páginas da loja">
              <ul className="divide-y divide-slate-100 text-sm">
                <li className="flex items-center justify-between py-2"><span>Início e categorias</span><Link href="/comercio-digital/ver-loja" target="_blank" className="font-medium text-brand-700 hover:underline">Visualizar</Link></li>
                <li className="flex items-center justify-between py-2"><span>Produto</span><Link href="/comercio-digital/catalogo" className="font-medium text-brand-700 hover:underline">Catálogo</Link></li>
                <li className="flex items-center justify-between py-2"><span>Termos, privacidade e trocas</span><Link href="/comercio-digital/editor?aba=paginas" className="font-medium text-brand-700 hover:underline">Editar</Link></li>
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === "dados" && <LegalTab st={st} manage={manage} />}
      {tab === "paginas" && <PagesTab st={st} manage={manage} />}
      {tab === "dominio" && <DomainTab st={st} manage={manage} ctx={s.ctx} />}
      {tab === "publicacao" && <PublishTab st={st} manage={manage} ctx={s.ctx} />}
    </>
  );
}

function LegalTab({ st, manage }: { st: any; manage: boolean }) {
  const legal = legalOf(st);
  const contact = contactOf(st);
  return (
    <Card title="Dados do fornecedor e canais de contato" description="Exibidos no rodapé de todas as páginas da loja (Decreto 7.962/2013: identificação do fornecedor, endereço e contato).">
      <ActionForm action={saveLegalContactAction} className="space-y-4">
        <fieldset disabled={!manage} className="space-y-4">
          <FormGrid cols={2}>
            <Field label="Razão social" required htmlFor="companyName"><Input id="companyName" name="companyName" defaultValue={legal.companyName} required /></Field>
            <Field label="CNPJ (ou CPF)" required htmlFor="cnpj"><Input id="cnpj" name="cnpj" defaultValue={legal.cnpj} required /></Field>
          </FormGrid>
          <Field label="Endereço completo" required htmlFor="address"><Input id="address" name="address" defaultValue={legal.address} required /></Field>
          <FormGrid cols={2}>
            <Field label="E-mail do fornecedor" htmlFor="legalEmail"><Input id="legalEmail" name="legalEmail" type="email" defaultValue={legal.email} /></Field>
            <Field label="Telefone do fornecedor" htmlFor="legalPhone"><Input id="legalPhone" name="legalPhone" defaultValue={legal.phone} /></Field>
          </FormGrid>
          <FormGrid cols={4}>
            <Field label="WhatsApp de atendimento" htmlFor="whatsapp"><Input id="whatsapp" name="whatsapp" defaultValue={contact.whatsapp} inputMode="tel" /></Field>
            <Field label="E-mail de atendimento" htmlFor="contactEmail"><Input id="contactEmail" name="contactEmail" type="email" defaultValue={contact.email} /></Field>
            <Field label="Telefone de atendimento" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" defaultValue={contact.phone} /></Field>
            <Field label="Horário de atendimento" htmlFor="hours"><Input id="hours" name="hours" defaultValue={contact.hours} /></Field>
          </FormGrid>
          {manage && <button type="submit" className={buttonClass("primary")}>Salvar dados</button>}
        </fieldset>
      </ActionForm>
    </Card>
  );
}

function PagesTab({ st, manage }: { st: any; manage: boolean }) {
  const pages = pagesOf(st);
  const keys = Object.keys(PAGE_LABEL) as Array<keyof StorePages>;
  return (
    <Card
      title="Páginas institucionais e legais"
      description="Termos, privacidade e trocas são obrigatórios para publicar. Os textos iniciais usam os dados da empresa e as regras do Código de Defesa do Consumidor (arrependimento em 7 dias) e da LGPD — revise com a assessoria jurídica da empresa."
      actions={manage ? <ActionButton action={restoreDefaultPagesAction} label="Restaurar textos padrão" size="sm" variant="ghost" icon={<RefreshCcw className="size-4" aria-hidden />} confirm="Substituir os textos atuais pelos textos padrão com os dados do fornecedor?" /> : undefined}
    >
      <ActionForm action={savePagesAction} className="space-y-4">
        <fieldset disabled={!manage} className="space-y-4">
          {keys.map((k) => (
            <Field key={k} label={PAGE_LABEL[k]} required={["terms", "privacy", "exchanges"].includes(k)} hint={`Endereço: /pagina/${PAGE_SLUG[k]}`} htmlFor={`page-${k}`}>
              <Textarea id={`page-${k}`} name={k} defaultValue={pages[k]} rows={k === "about" ? 3 : 6} maxLength={8000} />
            </Field>
          ))}
          {manage && <button type="submit" className={buttonClass("primary")}>Salvar páginas</button>}
        </fieldset>
      </ActionForm>
    </Card>
  );
}

async function DomainTab({ st, manage, ctx }: { st: any; manage: boolean; ctx: any }) {
  const domains = await listDomains(ctx.store, st.id);
  const t = dnsTargets();
  return (
    <div className="grid gap-4 xl:grid-cols-5 [&>*]:min-w-0">
      <Card title="Domínio próprio" className="xl:col-span-2" description="A loja já funciona no endereço do ERP. Com um domínio próprio verificado, ela abre também no endereço da empresa (ex.: www.minhaloja.com.br).">
        {manage ? (
          <ActionForm action={addDomainAction} className="space-y-2" resetOnSuccess>
            <Field label="Endereço da loja" hint="Informe somente o domínio, sem https://." htmlFor="domain"><Input id="domain" name="domain" placeholder="loja.exemplo.com.br" required autoComplete="off" /></Field>
            <button type="submit" className={buttonClass("secondary", "md", "w-full")}><Globe className="size-4" aria-hidden /> Verificar e cadastrar</button>
          </ActionForm>
        ) : (
          <p className="text-sm text-slate-600">Somente consulta.</p>
        )}
        <div className="mt-4 text-sm text-slate-600">
          <p className="font-medium text-ink">Endereço atual no ERP</p>
          <p className="break-all font-mono text-xs">/loja/{st.slug}</p>
        </div>
      </Card>
      <Card title="Domínios cadastrados" className="xl:col-span-3" bodyClass="space-y-4">
        {!domains.length && <p className="text-sm text-slate-500">Nenhum domínio cadastrado.</p>}
        {domains.map((d) => {
          const records = (d.dns?.records ?? []) as Array<{ type: string; name: string; value: string; ok: boolean }>;
          const expected = records.length
            ? records
            : [
                ...(isApexDomain(d.domain) ? t.a.map((ip) => ({ type: "A", name: "@", value: ip, ok: false })) : [{ type: "CNAME", name: d.domain.split(".")[0], value: t.cname, ok: false }]),
                { type: "TXT", name: verifyRecordName(d.domain), value: verifyRecordValue(d.dns?.verifyToken ?? ""), ok: false },
              ];
          return (
            <div key={d.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-mono text-sm font-semibold text-ink">
                  {d.domain} {d.primary && <Badge tone="brand">Principal</Badge>}
                </p>
                <Badge tone={DOMAIN_TONE[d.status as DomainStatus] ?? "warn"}>{DOMAIN_STATUS_LABEL[d.status as DomainStatus] ?? d.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">{d.diagnostic}</p>
              <p className="text-xs text-slate-500">Última verificação: {brDateTime(d.lastCheckAt)}</p>
              <div className="mt-2 overflow-x-auto">
                <table className="table-base w-full text-xs">
                  <caption className="sr-only">Registros DNS a configurar no provedor do domínio</caption>
                  <thead><tr><th>Tipo</th><th>Nome</th><th>Valor</th><th>Situação</th></tr></thead>
                  <tbody>
                    {expected.map((r) => (
                      <tr key={`${r.type}-${r.value}`}>
                        <td className="font-mono">{r.type}</td>
                        <td className="font-mono">{r.name}</td>
                        <td className="font-mono">
                          <span className="break-all">{r.value}</span> <CopyButton text={r.value} />
                        </td>
                        <td>{r.ok ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" aria-hidden /> ok</span> : <span className="flex items-center gap-1 text-amber-700"><CircleAlert className="size-3.5" aria-hidden /> pendente</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {manage && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton action={verifyDomainAction.bind(null, d.id)} label="Verificar agora" size="sm" icon={<RefreshCcw className="size-4" aria-hidden />} />
                  {!d.primary && <ActionButton action={setPrimaryDomainAction.bind(null, d.id)} label="Tornar principal" size="sm" variant="ghost" icon={<Star className="size-4" aria-hidden />} />}
                  <ActionButton action={removeDomainAction.bind(null, d.id)} label="Remover" size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} askReason="Motivo da remoção do domínio" />
                </div>
              )}
            </div>
          );
        })}
        <Notice tone="info" title="Como ligar o domínio">
          No provedor onde o domínio foi registrado, crie os registros acima: o apontamento (CNAME para subdomínios como “www” ou “loja”; A para o domínio raiz) leva os clientes à loja, e o TXT com o código desta loja comprova que a empresa controla o domínio. A verificação confere os dois; o certificado HTTPS é emitido pela hospedagem. Com a integração “Domínio próprio da loja” configurada na Central de integrações, o domínio também é cadastrado no projeto da hospedagem automaticamente.
        </Notice>
      </Card>
    </div>
  );
}

async function PublishTab({ st, manage, ctx }: { st: any; manage: boolean; ctx: any }) {
  const checks = await readiness(ctx, st);
  const blocking = checks.filter((c) => c.blocking && !c.ok);
  const status = (st.status ?? "draft") as StoreStatus;
  return (
    <div className="grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
      <Card title="Requisitos para publicação" className="xl:col-span-2" description="O que já está definido e o que ainda falta. Itens marcados como opcionais não impedem a publicação.">
        <ul className="divide-y divide-slate-100">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start justify-between gap-3 py-2.5">
              <div className="flex gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Concluído" /> : <CircleAlert className={`mt-0.5 size-4 shrink-0 ${c.blocking ? "text-amber-600" : "text-slate-400"}`} aria-label="Pendente" />}
                <div>
                  <p className="text-sm font-medium text-ink">
                    {c.label} {!c.blocking && <span className="text-xs font-normal text-slate-500">(opcional)</span>}
                  </p>
                  <p className="text-xs text-slate-500">{c.detail}</p>
                </div>
              </div>
              <Link href={c.href} className="shrink-0 text-sm font-medium text-brand-700 hover:underline">{c.ok ? "Revisar" : "Resolver"}</Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Publicação">
        <p className="text-sm text-slate-600">
          Situação: <strong className="text-ink">{STORE_STATUS_LABEL[status]}</strong>
          {st.publishedAt && <span className="block text-xs text-slate-500">Primeira publicação: {brDateTime(st.publishedAt)}</span>}
        </p>
        {manage && status !== "published" && (
          <div className="mt-3">
            <ActionButton action={publishStoreAction} label="Publicar a loja" variant="accent" icon={<Rocket className="size-4" aria-hidden />} disabled={blocking.length > 0} confirm="Publicar a loja? A vitrine passa a aceitar pedidos (pagamentos em simulação até a ligação do Gateway Intercert)." />
            {blocking.length > 0 && <p className="mt-2 text-xs text-amber-800">Resolva os {blocking.length} requisito(s) obrigatório(s) para publicar.</p>}
          </div>
        )}
        {manage && status === "published" && (
          <div className="mt-3">
            <ActionButton action={pauseStoreAction} label="Pausar a loja" variant="secondary" icon={<Pause className="size-4" aria-hidden />} askReason="Motivo da pausa (fica no histórico)" />
            <p className="mt-2 text-xs text-slate-500">Na pausa, a vitrine mostra um aviso e não aceita novos pedidos; os pedidos em andamento continuam.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
