import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { commerceEvent, requireStore } from "./common";

/**
 * Canais e contas (Tela 53): catálogo dos conectores PLANEJADOS (marketplaces, redes sociais, descoberta e mensageria).
 * Preparar a conta registra o nome interno e a origem do catálogo — não autoriza nem conecta nada. A loja própria é a
 * primeira frente; cada canal terá ativação própria (API, elegibilidade da conta, homologação), conforme o guia (p. 124).
 */

export type ChannelGroup = "marketplace" | "social" | "discovery" | "messaging";

export const CHANNEL_GROUP_LABEL: Record<ChannelGroup, string> = { marketplace: "Marketplace", social: "Rede social", discovery: "Descoberta", messaging: "Mensageria" };

export interface ChannelDef {
  key: string;
  name: string;
  group: ChannelGroup;
  coverage: string;
  condition: string;
}

export const CHANNELS: ChannelDef[] = [
  { key: "mercado_livre", name: "Mercado Livre", group: "marketplace", coverage: "Anúncios, pedidos, estoque e expedição", condition: "Cobertura de catálogo, preço, estoque, pedidos e repasses definida pela API do canal." },
  { key: "amazon", name: "Amazon", group: "marketplace", coverage: "Ofertas, estoque, pedidos e documentos", condition: "Conta de vendedor, autorização da aplicação e regras de logística do canal." },
  { key: "shopee", name: "Shopee", group: "marketplace", coverage: "Catálogo, pedidos e estoque", condition: "Conta de vendedor e autorização da aplicação; frete e repasse controlados pelo canal." },
  { key: "magalu", name: "Magalu", group: "marketplace", coverage: "Catálogo, pedidos e estoque", condition: "Credenciamento no marketplace e homologação do conector." },
  { key: "instagram", name: "Instagram Shop", group: "social", coverage: "Catálogo e experiência comercial conforme recursos liberados", condition: "Disponibilidade e elegibilidade da conta a validar com a Meta." },
  { key: "facebook", name: "Facebook Shop", group: "social", coverage: "Catálogo e experiência comercial conforme recursos liberados", condition: "Disponibilidade e elegibilidade da conta a validar com a Meta." },
  { key: "tiktok", name: "TikTok Shop", group: "social", coverage: "Catálogo, pedidos, fiscal e expedição como escopo pretendido", condition: "Cadastro de vendedor, autorização da aplicação e homologação do fluxo." },
  { key: "google_shopping", name: "Google Shopping", group: "discovery", coverage: "Produtos e disponibilidade no Merchant Center", condition: "Conta, catálogo e forma de integração aprovados; publicidade tem regras próprias." },
  { key: "youtube_shopping", name: "YouTube Shopping", group: "discovery", coverage: "Associação de produtos a conteúdos elegíveis", condition: "Compatibilidade da plataforma e elegibilidade do canal a confirmar." },
  { key: "whatsapp", name: "WhatsApp", group: "messaging", coverage: "Catálogo, atendimento e comunicação quando habilitados", condition: "Permissões de contato (consentimento) e recursos disponíveis em cada conector." },
];

export async function channelsView(ctx: Ctx) {
  const st = await requireStore(ctx);
  const saved = new Map((await listAll(unscoped(ctx.store), "store_channels", { filters: [["eq", "storeId", st.id]] })).map((c) => [c.channel, c]));
  return CHANNELS.map((c) => ({ def: c, account: saved.get(c.key) ?? null }));
}

/** Rascunho da conta do canal: nome interno e origem do catálogo. Salvar NÃO conecta. */
export async function prepareChannel(ctx: Ctx, key: string, input: { accountName: string; catalogScope: "all" | "categories"; categoryIds: string[]; notes?: string | null }): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  const def = CHANNELS.find((c) => c.key === key);
  assert(def, "Canal desconhecido.");
  const name = input.accountName.trim();
  assert(name.length >= 2, "Informe o nome interno da conta (ex.: “Loja Centro no Mercado Livre”).");
  if (input.catalogScope === "categories") assert(input.categoryIds.length, "Escolha ao menos uma categoria do catálogo.");
  const id = detId("schannel", st.id, key);
  const base = unscoped(ctx.store);
  const data = { companyId: ctx.companyId, branchId: null, storeId: st.id, channel: key, accountName: name.slice(0, 120), catalogScope: input.catalogScope, categoryIds: input.catalogScope === "categories" ? input.categoryIds.slice(0, 50) : [], status: "prepared", notes: input.notes?.trim().slice(0, 500) || null, preparedAt: nowIso() };
  let doc: Doc;
  const before = await base.get("store_channels", id);
  if (before) doc = await base.update("store_channels", id, data);
  else {
    try {
      doc = await base.create("store_channels", { ...data, createdBy: ctx.user.id }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await base.update("store_channels", id, data);
    }
  }
  await commerceEvent(ctx.store, { companyId: ctx.companyId, storeId: st.id, area: "channel", action: "channel.prepare", status: "pending", reference: def!.name, diagnostic: `Conta “${name}” preparada em rascunho. Conector planejado: ${def!.condition}` });
  await audit(ctx, { module: "sales", action: "ecommerce.channel_prepare", entityType: "store_channel", entityId: id, summary: `Canal ${def!.name}: conta “${name}” preparada (sem conexão)`, related: [`store:${st.id}`] });
  return doc;
}
