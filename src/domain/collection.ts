import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { diffDays, formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { formatPhone } from "@/lib/core/text";
import { getSetting, isFeatureOn, setSetting } from "@/lib/core/settings";
import { whatsappNumber, whatsappUrl } from "@/lib/whatsapp";
import { lateChargeParams, suggestLateCharges, type LateChargeParams } from "./finance";
import {
  COLLECTION_TEMPLATE_KINDS, COLLECTION_TEMPLATES_KEY, DEFAULT_COLLECTION_TEMPLATES, MAX_TEMPLATE_LENGTH, renderCollectionTemplate, suggestedTemplate, withTemplateDefaults,
  type CollectionTemplateKind, type CollectionTemplates,
} from "./collection-templates";

/**
 * Cobrança pelo WhatsApp (PLA-27): mensagem pronta a partir dos modelos, link wa.me (sem API paga) e registro do contato
 * no histórico do título — o mesmo registro do aviso de cobrança por e-mail (`title.collection_notice`), sem tabela nova.
 * Valor atualizado = saldo + multa/juros SUGERIDOS pelos parâmetros de atraso (`lateChargeParams`/`suggestLateCharges`).
 */

export async function loadCollectionTemplates(store: Store, companyId: string, branchId: string | null | undefined): Promise<CollectionTemplates> {
  return withTemplateDefaults(await getSetting<Partial<CollectionTemplates> | null>(store, companyId, branchId, COLLECTION_TEMPLATES_KEY, null));
}

/** Grava os modelos da empresa (Financeiro → Cobrança → Modelos de mensagem), com auditoria antes/depois. */
export async function saveCollectionTemplates(ctx: Ctx, input: Partial<CollectionTemplates>, reason?: string | null) {
  requirePerm(ctx, "finance", "edit");
  const before = await getSetting<Partial<CollectionTemplates> | null>(ctx.store, ctx.companyId, null, COLLECTION_TEMPLATES_KEY, null);
  const current = withTemplateDefaults(before);
  const next: CollectionTemplates = { ...current };
  for (const t of COLLECTION_TEMPLATE_KINDS) {
    const v = input[t.key];
    if (v == null) continue;
    const text = v.replace(/\r\n/g, "\n").trim();
    assert(text.length > 0, `Modelo “${t.label}”: escreva a mensagem (ou restaure o padrão).`, "invalid");
    assert(text.length <= MAX_TEMPLATE_LENGTH, `Modelo “${t.label}”: máximo de ${MAX_TEMPLATE_LENGTH} caracteres.`, "invalid");
    next[t.key] = text;
  }
  if (input.pixLink != null) {
    const pix = input.pixLink.trim();
    assert(pix.length <= 300, "Link ou chave Pix: máximo de 300 caracteres.", "invalid");
    next.pixLink = pix;
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  const doc = await setSetting(ctx.store, ctx.companyId, null, COLLECTION_TEMPLATES_KEY, next, ctx.user.id);
  await audit(
    { ...ctx, branchId: null },
    { module: "finance", action: "setting.update", entityType: "setting", entityId: doc.id, summary: "Modelos de mensagem de cobrança (WhatsApp) alterados", before: { [COLLECTION_TEMPLATES_KEY]: before ?? DEFAULT_COLLECTION_TEMPLATES }, after: { [COLLECTION_TEMPLATES_KEY]: next }, reason: reason ?? null },
  );
  return true;
}

export interface CollectionContext {
  templates: CollectionTemplates;
  late: LateChargeParams;
  companyName: string;
  /** valor de {link_pix}: link/chave dos modelos ou a chave Pix de uma conta financeira ativa */
  pix: string | null;
  ref: string;
}

/** Dados comuns a todas as mensagens de uma tela (carregados uma vez). */
export async function collectionContext(store: Store, companyId: string, branchId: string | null | undefined, ref = today()): Promise<CollectionContext> {
  const [templates, late, company] = await Promise.all([loadCollectionTemplates(store, companyId, branchId), lateChargeParams(store, companyId, branchId), store.get("companies", companyId)]);
  let pix = templates.pixLink.trim() || null;
  if (!pix) {
    const accounts = (await listAll(store, "financial_accounts", { filters: [["eq", "companyId", companyId], ["eq", "active", true]] })).filter((a) => a.pixKey);
    const acc = accounts.find((a) => branchId && a.branchId === branchId) ?? accounts[0];
    pix = acc?.pixKey ?? null;
  }
  return { templates, late, companyName: company?.tradeName || company?.name || "", pix, ref };
}

export interface CollectionDraft {
  installmentId: string;
  customerName: string;
  /** celular (ou telefone) do cliente; null = sem número no cadastro (o operador pode digitar) */
  phone: string | null;
  suggested: CollectionTemplateKind;
  messages: Record<CollectionTemplateKind, string>;
  /** valor usado em {valor} (centavos) e dias de atraso */
  amount: number;
  daysLate: number;
}

/** Mensagens dos três modelos para uma parcela a receber (puro, a partir do contexto carregado). */
export function collectionDraft(cc: CollectionContext, inst: Doc, title: Doc, customer: Doc | null): CollectionDraft {
  const daysLate = Math.max(0, diffDays(inst.dueDate, cc.ref));
  const ch = daysLate > 0 ? suggestLateCharges(inst.dueDate, cc.ref, inst.balance, cc.late) : { fine: 0, interest: 0 };
  const amount = inst.balance + ch.fine + ch.interest;
  const vars = {
    cliente: customer?.name ?? title.partyName ?? "cliente",
    valor: formatMoney(amount),
    vencimento: formatDate(inst.dueDate),
    dias_atraso: String(daysLate),
    empresa: cc.companyName,
    link_pix: cc.pix,
    parcela: `${inst.number}/${title.installmentsCount ?? inst.number}`,
    documento: title.description || (title.documentNumber ? `doc. ${title.documentNumber}` : `título nº ${title.number}`),
  };
  const messages = Object.fromEntries(COLLECTION_TEMPLATE_KINDS.map((t) => [t.key, renderCollectionTemplate(cc.templates[t.key], vars)])) as Record<CollectionTemplateKind, string>;
  return {
    installmentId: inst.id, customerName: vars.cliente, phone: customer?.mobile || customer?.phone || null,
    suggested: suggestedTemplate(inst.dueDate, cc.ref), messages, amount, daysLate,
  };
}

/** Parcela a receber em aberto da empresa, com título e cliente. */
async function loadOpenReceivable(ctx: Ctx, installmentId: string) {
  const inst = await ctx.store.getOrThrow("installments", installmentId);
  assert(inst.companyId === ctx.companyId && inst.kind === "receivable", "Parcela inválida.");
  assert(["open", "partial"].includes(inst.status), "A parcela não está em aberto.");
  const title = await ctx.store.getOrThrow("titles", inst.titleId);
  assert(title.originType !== "sale_card", "Recebível de cartão é cobrado da adquirente, não do cliente.");
  const customer = title.partyType === "customer" && title.partyId ? await ctx.store.get("customers", title.partyId) : null;
  return { inst, title, customer };
}

/** Mensagens prontas para uma parcela (usado nas telas e nos testes). */
export async function collectionDraftFor(ctx: Ctx, installmentId: string): Promise<CollectionDraft> {
  const { inst, title, customer } = await loadOpenReceivable(ctx, installmentId);
  return collectionDraft(await collectionContext(ctx.store, ctx.companyId, title.branchId ?? ctx.branchId), inst, title, customer);
}

/**
 * Registra a cobrança pelo WhatsApp (o operador abriu a conversa com a mensagem) no histórico do título e devolve o link.
 * O envio em si é feito pelo operador no aplicativo dele — o registro diz "aberta no WhatsApp", não "entregue".
 */
export async function recordWhatsappCollection(ctx: Ctx, installmentId: string, input: { template: string; phone: string; message: string }) {
  requirePerm(ctx, "finance", "edit");
  const { inst, title, customer } = await loadOpenReceivable(ctx, installmentId);
  if (!(await isFeatureOn(ctx.store, ctx.companyId, title.branchId ?? ctx.branchId, "cobrancaWhatsapp", true))) {
    throw new BusinessError("A cobrança pelo WhatsApp está desligada em Administração › Parâmetros › Recursos.", "feature_off");
  }
  const kind = COLLECTION_TEMPLATE_KINDS.find((t) => t.key === input.template);
  assert(kind, "Modelo de mensagem inválido.");
  const message = (input.message ?? "").trim();
  assert(message.length > 0, "Escreva a mensagem de cobrança.");
  assert(message.length <= 2000, "Mensagem muito longa (máximo de 2000 caracteres).");
  const number = whatsappNumber(input.phone);
  assert(number, "Informe um celular com DDD para abrir o WhatsApp.", "invalid_phone");
  const url = whatsappUrl(input.phone, message)!;
  await audit(ctx, {
    module: "finance", action: "title.collection_notice", entityType: "title", entityId: title.id, result: "success",
    summary: `Cobrança da parcela ${inst.number}/${title.installmentsCount ?? inst.number} aberta no WhatsApp para ${formatPhone(input.phone) || input.phone} (modelo “${kind.label}”, saldo ${formatMoney(inst.balance)})`,
    after: { channel: "whatsapp", template: kind.key, phone: number, message },
    related: [`installment:${inst.id}`, ...(customer ? [`customer:${customer.id}`] : [])],
  });
  return { url };
}
