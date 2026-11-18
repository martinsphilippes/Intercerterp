import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc, onlyDigits } from "@/lib/core/text";
import { randomToken, slugify, storeOfCompany, type DeliveryMode, type PayMethod, type StoreStatus } from "./common";
import { TEMPLATES, safeAccent, templateOf, type TemplateKey } from "./templates";

/**
 * Loja virtual da empresa (Telas 49–51): uma por empresa. Configuração guardada em blocos (identidade, seções,
 * páginas, dados legais, pagamentos, entrega), sempre lida pelas funções `*Of` com os padrões aplicados — a vitrine e a
 * gestão leem a mesma regra.
 */

export interface StoreTheme {
  title: string;
  tagline: string;
  accentColor: string;
  logoFileId: string | null;
  heroFileId: string | null;
  /** produto em destaque no modelo Campanha (oferta principal) */
  offerProductId: string | null;
  /** texto editorial do modelo Coleção */
  editorial: string;
}

export interface StoreSections {
  categories: boolean;
  benefits: boolean;
  featured: boolean;
}

export interface StorePages {
  about: string;
  exchanges: string;
  shipping: string;
  privacy: string;
  terms: string;
}

export interface StoreLegal {
  companyName: string;
  cnpj: string;
  address: string;
  email: string;
  phone: string;
}

export interface StoreContact {
  whatsapp: string;
  email: string;
  phone: string;
  hours: string;
}

export interface StoreCheckout {
  /** CPF/CNPJ obrigatório (a NF-e da venda pela internet identifica o comprador) */
  requireDoc: boolean;
  /** pedido mínimo (centavos; 0 = sem mínimo) */
  minOrder: number;
}

export interface StorePayments {
  methods: Record<PayMethod, { enabled: boolean; expiresMinutes?: number; maxInstallments?: number; minInstallment?: number; dueDays?: number }>;
  /** emitir a NF-e assim que o pagamento for aprovado (sem esperar a revisão no pedido) */
  autoInvoice: boolean;
  /** taxas estimadas do gateway (bps) e prazo de crédito (dias) — substituídas pelos valores do provedor na integração */
  feeBps: Record<PayMethod, number>;
  settlementDays: Record<PayMethod, number>;
}

export interface OwnZone {
  name: string;
  zipFrom: string;
  zipTo: string;
  price: number;
  days: number;
}

export interface StoreShipping {
  originZip: string;
  /** dias para separar e despachar (somados ao prazo de entrega) */
  handlingDays: number;
  /** frete grátis a partir deste valor de produtos (centavos; 0 = desligado) */
  freeShippingMin: number;
  /** modalidades com frete grátis quando o mínimo é atingido */
  freeShippingModes: DeliveryMode[];
  modes: {
    pickup: { enabled: boolean; readyHours: number; instructions: string };
    own: { enabled: boolean; zones: OwnZone[] };
    third_party: { enabled: boolean; provider: string; label: string; maxDistanceKm: number };
    carrier: { enabled: boolean; provider: string };
  };
  /** embalagem padrão quando o produto não tem medidas */
  package: { weightGrams: number; heightCm: number; widthCm: number; lengthCm: number };
}

export const DEFAULT_BENEFITS = ["Retire na loja sem custo", "Troca em até 7 dias", "Pagamento por Pix, cartão ou boleto", "Compra segura"];

export function themeOf(st: Doc | null | undefined): StoreTheme {
  const t = st?.theme ?? {};
  return {
    title: String(t.title ?? st?.name ?? "Minha loja"),
    tagline: String(t.tagline ?? ""),
    accentColor: safeAccent(t.accentColor, templateOf(st?.template).suggestedAccent),
    logoFileId: t.logoFileId ?? null,
    heroFileId: t.heroFileId ?? null,
    offerProductId: t.offerProductId ?? null,
    editorial: String(t.editorial ?? ""),
  };
}

export function sectionsOf(st: Doc | null | undefined): StoreSections {
  const x = st?.sections ?? {};
  return { categories: x.categories !== false, benefits: x.benefits !== false, featured: x.featured !== false };
}

export function benefitsOf(st: Doc | null | undefined): string[] {
  const b = Array.isArray(st?.benefits) ? (st!.benefits as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean) : null;
  return (b && b.length ? b : DEFAULT_BENEFITS).slice(0, 4);
}

export function checkoutOf(st: Doc | null | undefined): StoreCheckout {
  const c = st?.checkout ?? {};
  return { requireDoc: c.requireDoc !== false, minOrder: Math.max(0, Number(c.minOrder ?? 0) || 0) };
}

export function paymentsOf(st: Doc | null | undefined): StorePayments {
  const p = st?.payments ?? {};
  const m = p.methods ?? {};
  return {
    methods: {
      pix: { enabled: m.pix?.enabled !== false, expiresMinutes: Number(m.pix?.expiresMinutes ?? 30) || 30 },
      card: { enabled: m.card?.enabled !== false, maxInstallments: Math.min(12, Math.max(1, Number(m.card?.maxInstallments ?? 6) || 6)), minInstallment: Number(m.card?.minInstallment ?? 2000) || 0 },
      boleto: { enabled: m.boleto?.enabled !== false, dueDays: Math.min(10, Math.max(1, Number(m.boleto?.dueDays ?? 3) || 3)) },
    },
    autoInvoice: Boolean(p.autoInvoice),
    feeBps: { pix: num(p.feeBps?.pix, 99), card: num(p.feeBps?.card, 399), boleto: num(p.feeBps?.boleto, 0) },
    settlementDays: { pix: num(p.settlementDays?.pix, 1), card: num(p.settlementDays?.card, 30), boleto: num(p.settlementDays?.boleto, 2) },
  };
}

/** Tarifa fixa estimada do boleto (centavos) quando a taxa percentual é zero. */
export const BOLETO_FIXED_FEE = 349;

export function shippingOf(st: Doc | null | undefined): StoreShipping {
  const s = st?.shipping ?? {};
  const m = s.modes ?? {};
  return {
    originZip: onlyDigits(s.originZip ?? "").slice(0, 8),
    handlingDays: Math.max(0, Number(s.handlingDays ?? 1) || 0),
    freeShippingMin: Math.max(0, Number(s.freeShippingMin ?? 0) || 0),
    freeShippingModes: Array.isArray(s.freeShippingModes) ? s.freeShippingModes : ["own", "carrier"],
    modes: {
      pickup: { enabled: m.pickup?.enabled !== false, readyHours: Number(m.pickup?.readyHours ?? 2) || 2, instructions: String(m.pickup?.instructions ?? "Apresente o código de retirada e um documento com foto no balcão.") },
      own: { enabled: Boolean(m.own?.enabled), zones: Array.isArray(m.own?.zones) ? (m.own.zones as OwnZone[]).map(normalizeZone).filter((z): z is OwnZone => z !== null) : [] },
      third_party: { enabled: Boolean(m.third_party?.enabled), provider: String(m.third_party?.provider ?? "simulated"), label: String(m.third_party?.label ?? "Entrega expressa por aplicativo"), maxDistanceKm: Number(m.third_party?.maxDistanceKm ?? 20) || 20 },
      carrier: { enabled: m.carrier?.enabled !== false, provider: String(m.carrier?.provider ?? "simulated") },
    },
    package: {
      weightGrams: num(s.package?.weightGrams, 300),
      heightCm: num(s.package?.heightCm, 4),
      widthCm: num(s.package?.widthCm, 20),
      lengthCm: num(s.package?.lengthCm, 30),
    },
  };
}

function num(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Faixa de CEP da entrega própria (8 dígitos, início ≤ fim); inválida = descartada. */
export function normalizeZone(z: Partial<OwnZone> | null | undefined): OwnZone | null {
  if (!z) return null;
  const zipFrom = onlyDigits(z.zipFrom ?? "").padEnd(8, "0").slice(0, 8);
  const zipTo = onlyDigits(z.zipTo ?? "").padEnd(8, "9").slice(0, 8);
  if (zipFrom.length !== 8 || zipTo.length !== 8 || zipFrom > zipTo) return null;
  return { name: String(z.name ?? "").trim().slice(0, 60) || `${zipFrom}–${zipTo}`, zipFrom, zipTo, price: Math.max(0, Math.round(Number(z.price ?? 0) || 0)), days: Math.max(0, Math.round(Number(z.days ?? 1) || 0)) };
}

export function legalOf(st: Doc | null | undefined): StoreLegal {
  const l = st?.legal ?? {};
  return { companyName: String(l.companyName ?? ""), cnpj: String(l.cnpj ?? ""), address: String(l.address ?? ""), email: String(l.email ?? ""), phone: String(l.phone ?? "") };
}

export function contactOf(st: Doc | null | undefined): StoreContact {
  const c = st?.contact ?? {};
  return { whatsapp: onlyDigits(c.whatsapp ?? ""), email: String(c.email ?? ""), phone: String(c.phone ?? ""), hours: String(c.hours ?? "") };
}

export function pagesOf(st: Doc | null | undefined): StorePages {
  const p = st?.pages ?? {};
  return { about: String(p.about ?? ""), exchanges: String(p.exchanges ?? ""), shipping: String(p.shipping ?? ""), privacy: String(p.privacy ?? ""), terms: String(p.terms ?? "") };
}

export const PAGE_LABEL: Record<keyof StorePages, string> = {
  about: "Sobre a loja",
  exchanges: "Trocas, devoluções e arrependimento",
  shipping: "Entrega e retirada",
  privacy: "Política de privacidade",
  terms: "Termos de uso e de compra",
};

/** Páginas com endereço próprio na vitrine. */
export const PAGE_SLUG: Record<keyof StorePages, string> = { about: "sobre", exchanges: "trocas-e-devolucoes", shipping: "entrega", privacy: "privacidade", terms: "termos" };

function addressLine(a: Record<string, any> | null | undefined): string {
  if (!a) return "";
  const street = [a.street, a.number].filter(Boolean).join(", ");
  return [street, a.complement, a.district, [a.cityName, a.uf].filter(Boolean).join("/"), a.zip ? `CEP ${String(a.zip).replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : null].filter(Boolean).join(" — ");
}

/**
 * Textos iniciais das páginas legais com os dados da empresa (Decreto 7.962/2013: identificação do fornecedor,
 * condições e arrependimento; CDC art. 49; LGPD). Ponto de partida editável — a revisão jurídica é do lojista.
 */
export function defaultPages(storeName: string, legal: StoreLegal): StorePages {
  const who = `${legal.companyName || storeName}${legal.cnpj ? `, CNPJ ${legal.cnpj}` : ""}${legal.address ? `, com endereço em ${legal.address}` : ""}`;
  const contact = [legal.email && `e-mail ${legal.email}`, legal.phone && `telefone ${legal.phone}`].filter(Boolean).join(" ou ");
  return {
    about: `A ${storeName} é a loja on-line de ${who}. Os produtos, preços e disponibilidade vêm do mesmo estoque da loja física.`,
    exchanges:
      `Arrependimento: compras feitas pela internet podem ser desistidas em até 7 dias a contar do recebimento ou da retirada (Código de Defesa do Consumidor, art. 49). ` +
      `Solicite pelo acompanhamento do pedido; o valor pago, inclusive o frete, é devolvido pelo mesmo meio de pagamento.\n\n` +
      `Troca e defeito: produtos com defeito podem ser trocados em até 30 dias (não duráveis) ou 90 dias (duráveis), conforme o art. 26 do CDC. ` +
      `Fale conosco${contact ? ` pelo ${contact}` : ""} informando o número do pedido.`,
    shipping:
      `Retirada: escolha a retirada no checkout e aguarde o aviso de pedido pronto; apresente o código de retirada e um documento com foto.\n\n` +
      `Entrega: o prazo informado no checkout começa a contar após a confirmação do pagamento. O pedido só é despachado com o pagamento aprovado e a nota fiscal emitida.`,
    privacy:
      `Coletamos os dados necessários para processar o pedido, emitir a nota fiscal e entregar (nome, CPF/CNPJ, contato e endereço), com base na execução do contrato e no cumprimento de obrigação legal (LGPD, art. 7º, II e V). ` +
      `Mensagens de ofertas e de carrinho abandonado só são enviadas com o seu consentimento, que pode ser retirado a qualquer momento. ` +
      `Usamos apenas cookies essenciais para manter o carrinho. O CEP informado é consultado em serviço público de endereços para preencher o endereço e o município da nota fiscal. Dados de cartão são tratados exclusivamente pelo provedor de pagamento e não são armazenados pela loja. ` +
      `Para exercer seus direitos (acesso, correção, eliminação), fale conosco${contact ? ` pelo ${contact}` : ""}.`,
    terms:
      `Ao finalizar a compra você declara conhecer estes termos. Preço, disponibilidade e frete são confirmados no momento do pedido; o estoque fica reservado durante o prazo de pagamento. ` +
      `O pedido é confirmado com a aprovação do pagamento. Fornecedor: ${who}.`,
  };
}

function companyLegal(company: Doc, branch: Doc | null): StoreLegal {
  const addr = branch?.address ?? company.address ?? null;
  return {
    companyName: String(company.name ?? ""),
    cnpj: company.cnpj ? formatDoc(company.cnpj) : "",
    address: addressLine(addr),
    email: String(branch?.email ?? company.email ?? ""),
    phone: String(branch?.phone ?? company.phone ?? ""),
  };
}

// ───────────────────────────── criação e configuração

async function uniqueSlug(store: Store, base: string, selfId?: string): Promise<string> {
  const root = slugify(base) || "loja";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const rows = await listAll(unscoped(store), "stores", { filters: [["eq", "slug", candidate]] });
    if (!rows.length || rows[0].id === selfId) return candidate;
  }
  return `${root}-${randomToken(3)}`;
}

/** Cria a loja da empresa (rascunho) com padrões completos — idempotente: a loja existente é devolvida. */
export async function createStore(ctx: Ctx, input: { name?: string | null; slug?: string | null; fulfillmentBranchId?: string | null } = {}): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const existing = await storeOfCompany(ctx.store, ctx.companyId);
  if (existing) return existing;
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  assert((company.kind ?? "retail") === "retail", "A loja virtual é para empresas de comércio (varejo).");
  const branches = (await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).filter((b) => b.status !== "inactive");
  assert(branches.length, "Cadastre uma filial antes de criar a loja virtual.");
  const fulfillment = branches.find((b) => b.id === (input.fulfillmentBranchId ?? ctx.branchId)) ?? branches[0];
  const name = (input.name?.trim() || company.tradeName || company.name || "Minha loja").slice(0, 120);
  const slug = await uniqueSlug(ctx.store, input.slug?.trim() || name);
  const legal = companyLegal(company, fulfillment);
  const data = {
    companyId: ctx.companyId,
    branchId: fulfillment.id,
    createdBy: ctx.user.id,
    isDemo: Boolean(company.isDemo),
    name,
    slug,
    status: "draft" as StoreStatus,
    template: "essencial" as TemplateKey,
    theme: { title: name, tagline: "Tudo para o seu dia a dia.", accentColor: TEMPLATES.essencial.suggestedAccent, logoFileId: null, heroFileId: null, offerProductId: null, editorial: "" },
    sections: { categories: true, benefits: true, featured: true },
    benefits: DEFAULT_BENEFITS,
    pages: defaultPages(name, legal),
    legal,
    contact: { whatsapp: onlyDigits(fulfillment.phone ?? company.phone ?? ""), email: legal.email, phone: legal.phone, hours: "Segunda a sábado, das 9h às 18h" },
    seo: { title: name, description: `Compre on-line na ${name}: retire na loja ou receba em casa.` },
    checkout: { requireDoc: true, minOrder: 0 },
    payments: { methods: { pix: { enabled: true, expiresMinutes: 30 }, card: { enabled: true, maxInstallments: 6, minInstallment: 2000 }, boleto: { enabled: true, dueDays: 3 } }, autoInvoice: false },
    shipping: {
      originZip: onlyDigits(fulfillment.address?.zip ?? company.address?.zip ?? ""),
      handlingDays: 1,
      freeShippingMin: 0,
      freeShippingModes: ["own", "carrier"],
      modes: {
        pickup: { enabled: true, readyHours: 2, instructions: "Apresente o código de retirada e um documento com foto no balcão." },
        own: { enabled: false, zones: [] },
        third_party: { enabled: false, provider: "simulated", label: "Entrega expressa por aplicativo", maxDistanceKm: 20 },
        carrier: { enabled: true, provider: "simulated" },
      },
    },
    fulfillmentBranchId: fulfillment.id,
    pickupBranchIds: [fulfillment.id],
    orderPrefix: "PED",
    safetyStockQty: 0,
    previewToken: randomToken(),
  };
  try {
    const st = await unscoped(ctx.store).create("stores", data, detId("store", ctx.companyId));
    await audit(ctx, { module: "sales", action: "ecommerce.store_create", entityType: "store", entityId: st.id, summary: `Loja virtual "${name}" criada (rascunho)`, related: [`store:${st.id}`] });
    return st;
  } catch (e) {
    if (isConflict(e)) {
      const again = await storeOfCompany(ctx.store, ctx.companyId);
      if (again) return again;
    }
    throw e;
  }
}

async function patchStore(ctx: Ctx, patch: Record<string, unknown>, summary: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  if (!st) throw new BusinessError("Crie a loja virtual antes de configurá-la.", "store_missing");
  const after = await unscoped(ctx.store).update("stores", st.id, patch);
  await audit(ctx, { module: "sales", action: "ecommerce.store_update", entityType: "store", entityId: st.id, summary, before: pick(st, Object.keys(patch)), after: patch, related: [`store:${st.id}`] });
  return after;
}

function pick(d: Doc, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (d as Record<string, unknown>)[k] ?? null]));
}

/** Tela 50: aplica o modelo ao rascunho (a cor sugerida só entra se o lojista não escolheu outra). */
export async function applyTemplate(ctx: Ctx, key: string): Promise<Doc> {
  const tpl = TEMPLATES[key as TemplateKey];
  assert(tpl, "Modelo inválido.");
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  const theme = { ...(st?.theme ?? {}) };
  const wasSuggested = !theme.accentColor || Object.values(TEMPLATES).some((t) => t.suggestedAccent === theme.accentColor);
  if (wasSuggested) theme.accentColor = tpl.suggestedAccent;
  return patchStore(ctx, { template: tpl.key, theme }, `Modelo da loja: ${tpl.name} (${tpl.purpose})`);
}

export interface IdentityInput {
  name: string;
  title: string;
  tagline: string;
  accentColor: string;
  editorial?: string | null;
  offerProductId?: string | null;
  sections: StoreSections;
  benefits: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
}

/** Tela 51: identidade, seções e benefícios. */
export async function saveIdentity(ctx: Ctx, input: IdentityInput): Promise<Doc> {
  const name = input.name.trim();
  assert(name.length >= 2, "Informe o nome da loja.");
  assert(input.title.trim().length >= 2, "Informe o título exibido na vitrine.");
  const accent = safeAccent(input.accentColor, "");
  assert(accent, "Cor de destaque inválida: use o formato #RRGGBB.");
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  if (input.offerProductId) {
    const listing = (await listAll(ctx.store, "store_products", { filters: [["eq", "productId", input.offerProductId]] }))[0];
    assert(listing && listing.storeId === st?.id, "A oferta principal precisa ser um produto do catálogo digital.");
  }
  const theme = {
    ...(st?.theme ?? {}),
    title: input.title.trim().slice(0, 80),
    tagline: input.tagline.trim().slice(0, 160),
    accentColor: accent,
    editorial: (input.editorial ?? "").trim().slice(0, 600),
    offerProductId: input.offerProductId || null,
  };
  const benefits = input.benefits.map((b) => b.trim().slice(0, 60)).filter(Boolean).slice(0, 4);
  return patchStore(
    ctx,
    {
      name: name.slice(0, 120),
      theme,
      sections: { categories: Boolean(input.sections.categories), benefits: Boolean(input.sections.benefits), featured: Boolean(input.sections.featured) },
      benefits,
      seo: { title: (input.seoTitle ?? name).trim().slice(0, 70), description: (input.seoDescription ?? "").trim().slice(0, 160) },
    },
    `Identidade da loja atualizada (${name})`,
  );
}

/** Logotipo ou imagem de destaque (arquivo já gravado como imagem pública da loja). */
export async function setThemeImage(ctx: Ctx, which: "logo" | "hero", fileId: string | null): Promise<Doc> {
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  const theme = { ...(st?.theme ?? {}), [which === "logo" ? "logoFileId" : "heroFileId"]: fileId };
  return patchStore(ctx, { theme }, which === "logo" ? "Logotipo da loja atualizado" : "Imagem de destaque da loja atualizada");
}

/** Tela 51: páginas legais e institucionais. Termos, privacidade e trocas não podem ficar vazios. */
export async function savePages(ctx: Ctx, pages: StorePages): Promise<Doc> {
  for (const k of ["terms", "privacy", "exchanges"] as const) assert(pages[k].trim().length >= 40, `Preencha a página "${PAGE_LABEL[k]}" (é obrigatória para vender pela internet).`);
  const clean = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 8000)])) as unknown as StorePages;
  return patchStore(ctx, { pages: clean }, "Páginas da loja atualizadas");
}

/** Dados do fornecedor exibidos no rodapé (Decreto 7.962/2013, art. 2º) e canais de contato. */
export async function saveLegalContact(ctx: Ctx, legal: StoreLegal, contact: StoreContact): Promise<Doc> {
  assert(legal.companyName.trim(), "Informe a razão social exibida no rodapé da loja.");
  assert(onlyDigits(legal.cnpj).length === 14 || onlyDigits(legal.cnpj).length === 11, "Informe o CNPJ (ou CPF) do fornecedor exibido no rodapé.");
  assert(legal.address.trim(), "Informe o endereço do fornecedor exibido no rodapé.");
  assert(legal.email.trim() || legal.phone.trim(), "Informe ao menos um canal de contato (e-mail ou telefone).");
  return patchStore(
    ctx,
    {
      legal: { companyName: legal.companyName.trim(), cnpj: formatDoc(onlyDigits(legal.cnpj)), address: legal.address.trim(), email: legal.email.trim(), phone: legal.phone.trim() },
      contact: { whatsapp: onlyDigits(contact.whatsapp), email: contact.email.trim(), phone: contact.phone.trim(), hours: contact.hours.trim().slice(0, 120) },
    },
    "Dados do fornecedor e contato da loja atualizados",
  );
}

/** Tela 56: meios de pagamento da loja própria e emissão automática da nota. */
export async function savePayments(ctx: Ctx, input: StorePayments): Promise<Doc> {
  const enabled = (Object.keys(input.methods) as PayMethod[]).filter((m) => input.methods[m].enabled);
  assert(enabled.length, "Habilite ao menos um meio de pagamento.");
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  const cur = paymentsOf(st);
  return patchStore(
    ctx,
    {
      payments: {
        methods: {
          pix: { enabled: input.methods.pix.enabled, expiresMinutes: Math.min(1440, Math.max(5, Math.round(input.methods.pix.expiresMinutes ?? 30))) },
          card: { enabled: input.methods.card.enabled, maxInstallments: Math.min(12, Math.max(1, Math.round(input.methods.card.maxInstallments ?? 6))), minInstallment: Math.max(0, Math.round(input.methods.card.minInstallment ?? 0)) },
          boleto: { enabled: input.methods.boleto.enabled, dueDays: Math.min(10, Math.max(1, Math.round(input.methods.boleto.dueDays ?? 3))) },
        },
        autoInvoice: Boolean(input.autoInvoice),
        feeBps: input.feeBps ?? cur.feeBps,
        settlementDays: input.settlementDays ?? cur.settlementDays,
      },
    },
    `Pagamentos da loja: ${enabled.join(", ")}${input.autoInvoice ? " · nota automática" : ""}`,
  );
}

/** Tela 58: modalidades de entrega, frete grátis e embalagem padrão. */
export async function saveShipping(ctx: Ctx, input: StoreShipping & { pickupBranchIds: string[]; fulfillmentBranchId: string }): Promise<Doc> {
  const branches = (await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).filter((b) => b.status !== "inactive");
  const ids = new Set(branches.map((b) => b.id));
  assert(ids.has(input.fulfillmentBranchId), "Escolha a filial que atende os pedidos on-line.");
  const pickupBranchIds = input.pickupBranchIds.filter((b) => ids.has(b));
  const m = input.modes;
  assert(m.pickup.enabled || m.own.enabled || m.third_party.enabled || m.carrier.enabled, "Habilite ao menos uma forma de entrega.");
  if (m.pickup.enabled) assert(pickupBranchIds.length, "Escolha ao menos uma filial para a retirada.");
  const zones = m.own.zones.map(normalizeZone).filter((z): z is OwnZone => z !== null);
  if (m.own.enabled) assert(zones.length, "A entrega própria precisa de ao menos uma faixa de CEP com preço e prazo.");
  const originZip = onlyDigits(input.originZip);
  if (m.carrier.enabled || m.third_party.enabled) assert(originZip.length === 8, "Informe o CEP de origem (8 dígitos): ele é usado nas cotações de transportadora e de entrega por terceiros.");
  return patchStore(
    ctx,
    {
      fulfillmentBranchId: input.fulfillmentBranchId,
      branchId: input.fulfillmentBranchId,
      pickupBranchIds,
      shipping: {
        originZip,
        handlingDays: Math.min(30, Math.max(0, Math.round(input.handlingDays))),
        freeShippingMin: Math.max(0, Math.round(input.freeShippingMin)),
        freeShippingModes: input.freeShippingModes.filter((x) => ["own", "carrier", "third_party"].includes(x)),
        modes: {
          pickup: { enabled: m.pickup.enabled, readyHours: Math.min(168, Math.max(0, Math.round(m.pickup.readyHours))), instructions: m.pickup.instructions.trim().slice(0, 300) },
          own: { enabled: m.own.enabled, zones },
          third_party: { enabled: m.third_party.enabled, provider: m.third_party.provider || "simulated", label: (m.third_party.label || "Entrega por aplicativo").slice(0, 60), maxDistanceKm: Math.min(200, Math.max(1, Math.round(m.third_party.maxDistanceKm))) },
          carrier: { enabled: m.carrier.enabled, provider: m.carrier.provider || "simulated" },
        },
        package: {
          weightGrams: Math.max(1, Math.round(input.package.weightGrams)),
          heightCm: Math.max(1, Math.round(input.package.heightCm)),
          widthCm: Math.max(1, Math.round(input.package.widthCm)),
          lengthCm: Math.max(1, Math.round(input.package.lengthCm)),
        },
      },
    },
    `Entrega da loja: ${[m.pickup.enabled && "retirada", m.own.enabled && "entrega própria", m.third_party.enabled && "terceiros", m.carrier.enabled && "transportadora"].filter(Boolean).join(", ")}${input.freeShippingMin ? ` · frete grátis a partir de ${formatMoney(input.freeShippingMin)}` : ""}`,
  );
}

/** Checkout: CPF/CNPJ obrigatório e pedido mínimo. */
export async function saveCheckout(ctx: Ctx, input: StoreCheckout & { orderPrefix: string; safetyStockQty: number }): Promise<Doc> {
  const prefix = input.orderPrefix.trim().toUpperCase();
  assert(/^[A-Z0-9]{1,6}$/.test(prefix), "Prefixo do pedido: de 1 a 6 letras ou números (ex.: PED).");
  return patchStore(ctx, { checkout: { requireDoc: Boolean(input.requireDoc), minOrder: Math.max(0, Math.round(input.minOrder)) }, orderPrefix: prefix, safetyStockQty: Math.max(0, Math.round(input.safetyStockQty)) }, "Regras do checkout atualizadas");
}

// ───────────────────────────── publicação

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  /** bloqueia a publicação (os demais são avisos) */
  blocking: boolean;
  detail: string;
  href: string;
}

/** O que falta para publicar (Tela 49 "Preparar para vender" e Tela 51 "requisitos de publicação"). */
export async function readiness(ctx: Ctx, st: Doc): Promise<ReadinessItem[]> {
  const theme = themeOf(st);
  const legal = legalOf(st);
  const pages = pagesOf(st);
  const pay = paymentsOf(st);
  const ship = shippingOf(st);
  const listings = await listAll(ctx.store, "store_products", { filters: [["eq", "storeId", st.id]] });
  const published = listings.filter((l) => l.published);
  const sellable = published.filter((l) => !(l.issues ?? []).some((i: { blocking?: boolean }) => i.blocking));
  const { getIntegration } = await import("../integrations");
  const gateway = await getIntegration(ctx.store, ctx.companyId, null, "store_gateway");
  const fiscal = await (await import("../fiscal/service")).getFiscalConfig(ctx.store, ctx.companyId, st.fulfillmentBranchId ?? null);
  const domains = await listAll(ctx.store, "store_domains", { filters: [["eq", "storeId", st.id]] });
  const activeDomain = domains.find((d) => d.status === "active");
  const modes = (Object.keys(ship.modes) as DeliveryMode[]).filter((m) => ship.modes[m].enabled);
  return [
    { key: "identity", label: "Escolher e personalizar a loja", ok: Boolean(theme.title && st.template), blocking: true, detail: `Modelo ${templateOf(st.template).name} · ${theme.title}`, href: "/comercio-digital/editor" },
    { key: "catalog", label: "Selecionar produtos para a vitrine", ok: sellable.length > 0, blocking: true, detail: `${sellable.length} produto(s) prontos para venda de ${published.length} publicado(s)`, href: "/comercio-digital/catalogo" },
    { key: "payments", label: "Habilitar os recebimentos", ok: (Object.keys(pay.methods) as PayMethod[]).some((m) => pay.methods[m].enabled), blocking: true, detail: gateway?.provider && gateway.provider !== "simulated" ? `Gateway: ${gateway.provider}` : "Gateway Intercert em simulação (sem cobrança real) — a integração entra depois", href: "/comercio-digital/pagamentos" },
    { key: "shipping", label: "Definir entrega e retirada", ok: modes.length > 0 && (!ship.modes.own.enabled || ship.modes.own.zones.length > 0), blocking: true, detail: modes.length ? modes.map((m) => ({ pickup: "retirada", own: "entrega própria", third_party: "terceiros", carrier: "transportadora" })[m]).join(", ") : "nenhuma modalidade", href: "/comercio-digital/frete" },
    { key: "legal", label: "Dados do fornecedor no rodapé", ok: Boolean(legal.companyName && legal.cnpj && legal.address && (legal.email || legal.phone)), blocking: true, detail: legal.cnpj ? `${legal.companyName} · ${legal.cnpj}` : "razão social, CNPJ, endereço e contato", href: "/comercio-digital/editor?aba=dados" },
    { key: "pages", label: "Termos, privacidade e trocas", ok: [pages.terms, pages.privacy, pages.exchanges].every((p) => p.trim().length >= 40), blocking: true, detail: "páginas obrigatórias para vender pela internet", href: "/comercio-digital/editor?aba=paginas" },
    { key: "fiscal", label: "Nota fiscal da venda on-line (NF-e)", ok: Boolean(fiscal), blocking: false, detail: fiscal ? "configuração fiscal da filial encontrada" : "sem configuração fiscal da filial: os pedidos não poderão ser faturados", href: "/fiscal/configuracoes" },
    { key: "domain", label: "Domínio próprio", ok: Boolean(activeDomain), blocking: false, detail: activeDomain ? activeDomain.domain : "opcional — a loja já funciona no endereço do ERP (/loja/" + st.slug + ")", href: "/comercio-digital/editor?aba=dominio" },
  ];
}

export async function publishStore(ctx: Ctx): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  if (!st) throw new BusinessError("Crie a loja virtual antes de publicá-la.", "store_missing");
  const missing = (await readiness(ctx, st)).filter((r) => r.blocking && !r.ok);
  if (missing.length) throw new BusinessError(`Ainda não dá para publicar: ${missing.map((m) => m.label.toLowerCase()).join("; ")}.`, "not_ready");
  const after = await unscoped(ctx.store).update("stores", st.id, { status: "published", publishedAt: st.publishedAt ?? nowIso(), pausedAt: null });
  await audit(ctx, { module: "sales", action: "ecommerce.store_publish", entityType: "store", entityId: st.id, summary: `Loja virtual "${st.name}" publicada`, related: [`store:${st.id}`] });
  return after;
}

/** Pausa: a vitrine mostra "loja em pausa"; pedidos em andamento continuam sendo atendidos. */
export async function pauseStore(ctx: Ctx, reason: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const st = await storeOfCompany(ctx.store, ctx.companyId);
  if (!st) throw new BusinessError("Loja virtual não encontrada.", "store_missing");
  assert(reason.trim(), "Informe o motivo da pausa (aparece no histórico).");
  const after = await unscoped(ctx.store).update("stores", st.id, { status: "paused", pausedAt: nowIso() });
  await audit(ctx, { module: "sales", action: "ecommerce.store_pause", entityType: "store", entityId: st.id, summary: `Loja virtual "${st.name}" pausada`, reason, related: [`store:${st.id}`] });
  return after;
}

/** Endereço público da loja: domínio próprio ativo e principal ou, sem ele, o caminho no endereço do ERP. */
export function storeUrl(st: Doc, opts: { primaryDomain?: string | null; erpOrigin?: string | null } = {}): string {
  if (opts.primaryDomain) return `https://${opts.primaryDomain}`;
  const origin = (opts.erpOrigin || process.env.APP_URL || "").replace(/\/$/, "");
  return `${origin}/loja/${st.slug}`;
}

export async function primaryDomainOf(store: Store, storeId: string): Promise<string | null> {
  const rows = await listAll(unscoped(store), "store_domains", { filters: [["eq", "storeId", storeId], ["eq", "status", "active"]] });
  return (rows.find((d) => d.primary) ?? rows[0])?.domain ?? null;
}
