import { detId, findOne, isConflict, listAll, retryOnConflict, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, systemCtx, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { saveFile } from "@/lib/core/files";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { onlyDigits, searchable } from "@/lib/core/text";
import { addDays, diffDays, nowIso, toLocalDate, today } from "@/lib/dates";
import { formatMoney, formatQty, lineTotal, roundDiv, QTY } from "@/lib/money";
import { assertPeriodOpen } from "./period-close";
import { balanceId, defaultWarehouse, ensureBalance, postMovements } from "./stock";
import { createTitle, refreshTitleStatus } from "./finance";
import { parseNfeXml, nfeKeyIsValid, type ParsedNfe } from "./nfe-xml";
import { supplierLabel } from "./suppliers";
import {
  assertReceiptWarehouse, buildReceiptInstallments, cfopPairsFor, companyCnpjs, computeReceipt, confirmReceiptEffects, financialDefaults, findReceiptByKey, itemFiscalOf, learnSupplierProduct, manualItems, omit, recompute, scopeFor,
  type ManualReceiptItemInput, type ReceiptItem,
} from "./receipts";
import { convertCfop } from "./cfop-entry";

/**
 * Entrada de mercadoria com NOTA A CONFIRMAR (§40 de docs/regras-assumidas.md).
 *
 * A mercadoria chega antes da nota fiscal do fornecedor. A entrada é um recebimento comum (`receipts`, origem manual,
 * sem pedido) marcado `documentStatus = "pending_invoice"`, com `entryAt` (data/hora da entrada) e `invoiceDueAt`
 * (prazo para a nota). Não existe estoque separado nem venda sem documento fiscal: o estoque entra no depósito
 * escolhido como entrada normal e a venda continua emitindo NFC-e/NF-e.
 *  - Data/hora ATUAL ou PASSADA → realizada na hora (`confirmReceiptEffects`: estoque, custo médio, título a pagar
 *    PROVISÓRIO), respeitando o fechamento de período financeiro (data em período fechado é recusada).
 *  - Data/hora FUTURA → entrada PREVISTA (`status = "scheduled"`): sem saldo físico nem custo médio; aparece como "a
 *    chegar" por SKU e depósito; título a pagar PREVISTO (`forecast`, fluxo de caixa previsto, não pode ser baixado).
 *    A rotina diária e a abertura do recebimento/painel REALIZAM a entrada quando a data/hora chega (idempotente).
 *  - "Confirmar com a nota" (XML ou chave + número + série + valores): casa itens, ajusta o custo médio pela diferença
 *    (movimento `cost_adjust` de quantidade zero; a parte já vendida fica registrada como não absorvida — mesma regra
 *    do CT-e), trata a diferença de quantidade (ajuste de estoque, devolução ou manter com justificativa), corrige o
 *    título para o valor da nota (duplicatas do XML quando houver) e grava chave/XML no recebimento — que passa a
 *    entrar no livro de entradas e no pacote contábil como recebimento normal. Idempotente e auditado.
 */

export const PENDING_INVOICE_FEATURE = "notaAConfirmar";
export const PI_DUE_DAYS_KEY = "purchase.pendingInvoice.dueDays";
export const PI_ALERT_KEY = "purchase.pendingInvoice.alert";
export const PI_ALERT_LEAD_KEY = "purchase.pendingInvoice.alertLeadDays";
export const PI_DEFAULTS = { dueDays: 15, alert: true, leadDays: 3 };

/** Tolerância para considerar a data/hora informada como "agora" (relógio do navegador × servidor). */
const NOW_TOLERANCE_MS = 60_000;
/** Entrada prevista: no máximo 180 dias à frente. */
const MAX_AHEAD_DAYS = 180;

export const DOCUMENT_STATUS_LABEL: Record<string, string> = { pending_invoice: "Aguardando nota", confirmed: "Nota confirmada" };

export const occurrenceKeyFor = (receiptId: string) => `pending_invoice:${receiptId}`;

export async function pendingInvoiceOn(store: Store, companyId: string, branchId: string | null | undefined) {
  return isFeatureOn(store, companyId, branchId, PENDING_INVOICE_FEATURE, true);
}

export async function pendingInvoiceSettings(store: Store, companyId: string, branchId: string | null | undefined) {
  const int = (v: unknown, d: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const [dueDays, alert, leadDays] = await Promise.all([
    getSetting<unknown>(store, companyId, branchId, PI_DUE_DAYS_KEY, PI_DEFAULTS.dueDays),
    getSetting<unknown>(store, companyId, branchId, PI_ALERT_KEY, PI_DEFAULTS.alert),
    getSetting<unknown>(store, companyId, branchId, PI_ALERT_LEAD_KEY, PI_DEFAULTS.leadDays),
  ]);
  return { dueDays: int(dueDays, PI_DEFAULTS.dueDays, 1, 180), alert: alert !== false && alert !== "false", leadDays: int(leadDays, PI_DEFAULTS.leadDays, 0, 60) };
}

/** Situação da entrada com nota a confirmar para as telas: prevista, aguardando (no prazo / vencendo / vencida) ou confirmada. */
export function pendingState(r: Record<string, any>, ref = today(), leadDays = PI_DEFAULTS.leadDays) {
  if (r.documentStatus === "confirmed") return { key: "confirmed" as const, label: "Nota confirmada", tone: "good" as const, daysOpen: null, daysToDue: null };
  const entryDate = r.entryAt ? toLocalDate(r.entryAt) : toLocalDate(r.createdAt);
  const daysOpen = r.status === "scheduled" ? 0 : Math.max(0, diffDays(entryDate, ref));
  const daysToDue = r.invoiceDueAt ? diffDays(ref, r.invoiceDueAt) : null;
  if (r.status === "scheduled") return { key: "scheduled" as const, label: "Entrada prevista (a chegar)", tone: "info" as const, daysOpen, daysToDue };
  if (daysToDue != null && daysToDue < 0) return { key: "overdue" as const, label: `Nota vencida há ${-daysToDue} dia(s)`, tone: "bad" as const, daysOpen, daysToDue };
  if (daysToDue != null && daysToDue <= leadDays) return { key: "due_soon" as const, label: daysToDue === 0 ? "Prazo da nota vence hoje" : `Prazo da nota vence em ${daysToDue} dia(s)`, tone: "warn" as const, daysOpen, daysToDue };
  return { key: "pending" as const, label: "Aguardando nota", tone: "warn" as const, daysOpen, daysToDue };
}

// ───────────────────────────── Lançamento

export interface PendingInvoiceInput {
  supplierId: string;
  warehouseId?: string | null;
  items: ManualReceiptItemInput[];
  freight?: number | null;
  otherExpenses?: number | null;
  discount?: number | null;
  /** condição de pagamento; `null`/vazio = à vista (vencimento na data da entrada); omitida = a do fornecedor */
  paymentTermId?: string | null;
  paymentMethodId?: string | null;
  /** data/hora da entrada (instante ISO). Futura = entrada prevista. */
  entryAt: string;
  /** número/chave/série da nota, se já forem conhecidos */
  nfeKey?: string | null;
  nfeNumber?: string | null;
  nfeSeries?: string | null;
  notes?: string | null;
  idemKey: string;
}

/**
 * Lança a entrada com nota a confirmar. Idempotente pela chave do formulário (ou pela chave de acesso informada):
 * reenviar devolve o mesmo recebimento (e conclui a realização interrompida, se houver).
 */
export async function createPendingInvoiceEntry(ctx: Ctx, input: PendingInvoiceInput, opts: { now?: number } = {}) {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.receive_pending_invoice");
  const branchId = requireBranch(ctx);
  if (!(await pendingInvoiceOn(ctx.store, ctx.companyId, branchId))) throw new BusinessError("Entrada com nota a confirmar desligada em Administração › Parâmetros › Recursos.", "feature_off");
  const now = opts.now ?? Date.now();
  const t = Date.parse(input.entryAt ?? "");
  assert(input.entryAt && !Number.isNaN(t), "Informe a data e a hora da entrada.");
  const entryAt = new Date(t).toISOString();
  assert(t <= now + MAX_AHEAD_DAYS * 86400000, `Entrada prevista no máximo ${MAX_AHEAD_DAYS} dias à frente.`);
  const scheduled = t > now + NOW_TOLERANCE_MS;
  const entryDate = toLocalDate(entryAt);
  // data atual/passada: o estoque e a conta a pagar nascem na data da entrada — período fechado recusa
  if (!scheduled) await assertPeriodOpen(ctx.store, ctx.companyId, entryDate, "entrada com nota a confirmar (data da entrada)");
  const supplier = await ctx.store.getOrThrow("suppliers", input.supplierId);
  assert(supplier.companyId === ctx.companyId, "Fornecedor de outra empresa.");
  const key = onlyDigits(input.nfeKey);
  if (key) {
    assert(nfeKeyIsValid(key), "Chave de acesso inválida (44 dígitos com dígito verificador).");
    assert(key.slice(6, 20) === onlyDigits(supplier.doc).padStart(14, "0"), "A chave informada não pertence ao CNPJ deste fornecedor.");
  }
  assert(input.idemKey, "Chave do formulário ausente.");
  const scopeKey = key ? scopeFor(ctx.companyId, key) : `${ctx.companyId}|pending|${input.idemKey}`;
  const existing = await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
  if (existing) {
    if (existing.documentStatus !== "pending_invoice" && existing.documentStatus !== "confirmed") throw new BusinessError(`Chave já registrada no recebimento nº ${existing.number}.`, "duplicate", { id: existing.id });
    return (await realizeEntry(ctx.store, ctx.companyId, existing.id, now, ctx)) ?? existing;
  }
  assert(supplier.status !== "inactive", `Fornecedor ${supplierLabel(supplier)} está inativo — reative antes de receber.`);
  assert((input.items ?? []).length, "Informe ao menos um item (produto, quantidade e custo previsto).");
  assert(input.items.length <= 300, "Itens demais para um lançamento (máximo 300).");
  const items = (await manualItems(ctx, supplier.id, input.items, 1)).map((it) => ({ ...it, checked: true }));
  for (const [k, v] of [["Frete", input.freight], ["Outras despesas", input.otherExpenses], ["Desconto", input.discount]] as const) assert(v == null || (Number.isInteger(v) && v >= 0), `${k} inválido.`);
  const wh = input.warehouseId ? await assertReceiptWarehouse(ctx.store, input.warehouseId, branchId) : await defaultWarehouse(ctx.store, branchId);
  const termId = input.paymentTermId !== undefined ? input.paymentTermId || null : (supplier.paymentTermId ?? null);
  if (input.paymentTermId) {
    const tm = await ctx.store.get("payment_terms", input.paymentTermId);
    assert(tm && tm.companyId === ctx.companyId, "Condição de pagamento inválida.");
  }
  if (input.paymentMethodId) {
    const m = await ctx.store.get("payment_methods", input.paymentMethodId);
    assert(m && m.companyId === ctx.companyId, "Forma de pagamento inválida.");
  }
  const settings = await pendingInvoiceSettings(ctx.store, ctx.companyId, branchId);
  const number = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  const defaults = await financialDefaults(ctx, null, supplier.addresses?.[0]?.uf ?? null);
  const base = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, warehouseId: wh.id, supplierId: supplier.id,
    orderIds: [], nfeKey: key || null, nfeNumber: input.nfeNumber?.trim() || (key ? String(Number(key.slice(25, 34))) : null), nfeSeries: input.nfeSeries?.trim() || (key ? String(Number(key.slice(22, 25))) : null),
    nfeIssueDate: null, xmlFileId: null, xmlHash: null, status: scheduled ? "scheduled" : "draft", items,
    freight: input.freight ?? 0, otherExpenses: input.otherExpenses ?? 0, discount: input.discount ?? 0, orderCharges: null,
    invoicedTotal: null, paymentTermId: termId, emitter: { cnpj: supplier.doc, name: supplier.name, tradeName: supplier.tradeName, duplicatas: [] },
    differenceAction: "adjust_to_due", notes: input.notes?.trim() || null, scopeKey, searchText: searchable(String(number), input.nfeNumber, key, supplier.name, supplier.tradeName, "nota a confirmar"),
    // vínculo com pedido "não se aplica" enquanto não há nota (orderLink ausente); na confirmação passa a "sem pedido"
    origin: "manual", orderLink: null,
    documentStatus: "pending_invoice", entryAt, invoiceDueAt: addDays(entryDate, settings.dueDays),
    ...defaults,
    ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
  };
  const calc = await recompute(ctx, base as any);
  let r: Doc;
  try {
    r = await ctx.store.create("receipts", { ...base, ...omit(calc, "payable") }, detId("receipt", ctx.companyId, String(number)));
  } catch (e) {
    if (isConflict(e)) {
      const ex = await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
      if (ex && (ex.documentStatus === "pending_invoice" || ex.documentStatus === "confirmed")) return (await realizeEntry(ctx.store, ctx.companyId, ex.id, now, ctx)) ?? ex;
      throw new BusinessError(`Chave já registrada${ex ? ` no recebimento nº ${ex.number}` : ""}.`, "duplicate", { id: ex?.id });
    }
    throw e;
  }
  await audit(ctx, {
    module: "purchases", action: "receipt.pending_invoice_create", entityType: "receipt", entityId: r.id,
    summary: `Recebimento nº ${number}: entrada com NOTA A CONFIRMAR ${scheduled ? `PREVISTA para ${formatIso(entryAt)}` : `em ${formatIso(entryAt)}`} — ${supplierLabel(supplier)}, ${items.length} item(ns) em ${wh.name}, valor previsto ${formatMoney(r.dueTotal)}; prazo da nota ${r.invoiceDueAt.split("-").reverse().join("/")}${key ? ` (chave ${key})` : input.nfeNumber ? ` (NF ${input.nfeNumber})` : ""}`,
    after: { entryAt, scheduled, dueTotal: r.dueTotal, invoiceDueAt: r.invoiceDueAt, warehouseId: wh.id },
    related: [`supplier:${supplier.id}`],
  });
  if (scheduled) {
    // "a chegar": o saldo do SKU no depósito passa a existir (zerado) para a tela de saldos mostrar a quantidade prevista
    for (const it of items) if (it.skuId) await ensureBalance(ctx.store, ctx, wh.id, it.skuId);
    const payable = (calc.installments ?? []).reduce((a: number, x: any) => a + x.amount, 0);
    if (payable > 0) {
      const title = await createTitle(ctx, {
        kind: "payable", partyType: "supplier", partyId: supplier.id, partyName: supplierLabel(supplier),
        description: `Compra — recebimento nº ${number} (nota a confirmar)`, documentNumber: base.nfeNumber ? `${base.nfeNumber}${base.nfeSeries ? `-${base.nfeSeries}` : ""}` : `REC-${number}`,
        originType: "purchase_receipt", originId: r.id, issueDate: entryDate, categoryId: base.categoryId ?? null, costCenterId: base.costCenterId ?? null,
        installments: calc.installments.map((x: any) => ({ dueDate: x.dueDate, amount: x.amount })),
        notes: `PREVISTO: entrada de mercadoria prevista para ${formatIso(entryAt)} (nota a confirmar). Não pode ser baixado antes da realização da entrada; o valor é corrigido para o da nota na confirmação.`,
        idemKey: `purchase_receipt:${r.id}`, branchId, provisional: true, forecast: true,
      });
      r = await ctx.store.update("receipts", r.id, { payableTitleId: title.id });
    }
    return r;
  }
  return (await realizeEntry(ctx.store, ctx.companyId, r.id, now, ctx)) ?? r;
}

function formatIso(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * Realiza a entrada (idempotente): entrada prevista cuja data/hora chegou passa a valer — estoque e custo médio pelo
 * custo previsto, título a pagar de previsto para efetivo (continua provisório até a nota). Também conclui uma
 * realização interrompida (recebimento em "draft"/"confirming"). Executada com o contexto do sistema na filial do
 * recebimento (rotina diária, abertura do recebimento e do painel, lançamento).
 */
export async function realizeEntry(store: Store, companyId: string, receiptId: string, now = Date.now(), actor?: Ctx): Promise<Doc | null> {
  const r0 = await store.get("receipts", receiptId);
  if (!r0 || r0.companyId !== companyId) return null;
  if (r0.documentStatus !== "pending_invoice" && r0.documentStatus !== "confirmed") return r0;
  // quem lançou realiza com o próprio usuário (movimentos e auditoria); rotina e abertura de tela, com o do sistema
  const ctx = actor && actor.companyId === companyId && actor.branchId === r0.branchId ? actor : systemCtx(store, companyId, r0.branchId);
  let fromScheduled = false;
  if (r0.status === "scheduled") {
    if (!r0.entryAt || Date.parse(r0.entryAt) > now + NOW_TOLERANCE_MS) return r0;
    fromScheduled = await retryOnConflict(async () => {
      const cur = await ctx.store.getOrThrow("receipts", receiptId);
      if (cur.status !== "scheduled") return false;
      await ctx.store.update("receipts", receiptId, { status: "draft" });
      return true;
    });
  }
  let r = await ctx.store.getOrThrow("receipts", receiptId);
  if (r.status === "draft" || r.status === "confirming") r = await confirmReceiptEffects(ctx, receiptId);
  if (r.status !== "confirmed") return r;
  let flipped = false;
  if (r.payableTitleId) {
    const t = await ctx.store.get("titles", r.payableTitleId);
    if (t?.forecast) {
      await ctx.store.update("titles", t.id, { forecast: false, notes: `${t.notes ? `${t.notes}\n` : ""}Entrada realizada em ${formatIso(r.entryAt ?? r.confirmedAt)}: título efetivo (valor provisório até a confirmação da nota).` });
      flipped = true;
    }
  }
  if (fromScheduled || flipped) {
    await audit(ctx, {
      module: "purchases", action: "receipt.pending_invoice_realize", entityType: "receipt", entityId: receiptId,
      summary: `Recebimento nº ${r.number}: entrada PREVISTA realizada (data/hora ${formatIso(r.entryAt)}) — estoque e custo médio pelo custo previsto${r.payableTitleId ? "; título a pagar passou de previsto para efetivo (provisório até a nota)" : ""}`,
      related: r.payableTitleId ? [`title:${r.payableTitleId}`] : [],
    });
  }
  return r;
}

/** Realiza as entradas previstas vencidas da empresa (ou da filial). Erros de uma entrada não interrompem as demais. */
export async function realizeDueEntries(store: Store, companyId: string, opts: { branchId?: string | null; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const filters: any[] = [["eq", "companyId", companyId], ["eq", "status", "scheduled"]];
  if (opts.branchId) filters.push(["eq", "branchId", opts.branchId]);
  const list = await listAll(store, "receipts", { filters });
  const out = { realized: 0, errors: [] as Array<{ id: string; number: number; error: string }> };
  for (const r of list) {
    if (!r.entryAt || Date.parse(r.entryAt) > now + NOW_TOLERANCE_MS) continue;
    try {
      const done = await realizeEntry(store, companyId, r.id, now);
      if (done?.status === "confirmed") out.realized++;
    } catch (e: any) {
      out.errors.push({ id: r.id, number: r.number, error: String(e?.message ?? e) });
    }
  }
  return out;
}

/** Cancela uma entrada PREVISTA (ainda não realizada): o recebimento é cancelado e o título previsto também. */
export async function cancelScheduledEntry(ctx: Ctx, receiptId: string, reason: string) {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.receive_pending_invoice");
  const branchId = requireBranch(ctx);
  assert(reason?.trim(), "Informe o motivo.");
  const r = await ctx.store.getOrThrow("receipts", receiptId);
  assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
  assert(r.branchId === branchId, `Recebimento nº ${r.number} é de outra filial.`);
  assert(r.status === "scheduled", "Somente a entrada prevista (ainda não realizada) pode ser cancelada aqui. Entrada realizada é corrigida na confirmação da nota (ajuste ou devolução).");
  await ctx.store.update("receipts", receiptId, { status: "cancelled", scopeKey: `${r.scopeKey}|cancelled|${Date.now()}` });
  if (r.payableTitleId) {
    const { cancelTitle } = await import("./finance");
    await cancelTitle(ctx, r.payableTitleId, `Entrada prevista do recebimento nº ${r.number} cancelada: ${reason.trim()}`);
  }
  await resolveOccurrence(ctx.store, occurrenceKeyFor(receiptId));
  await audit(ctx, { module: "purchases", action: "receipt.pending_invoice_cancel", entityType: "receipt", entityId: receiptId, summary: `Recebimento nº ${r.number}: entrada prevista cancelada (nada foi lançado no estoque)`, reason: reason.trim() });
}

// ───────────────────────────── Confirmação com a nota

export interface InvoiceManualInput {
  nfeKey?: string | null;
  nfeNumber: string;
  nfeSeries?: string | null;
  /** AAAA-MM-DD */
  issueDate: string;
  freight?: number | null;
  otherExpenses?: number | null;
  discount?: number | null;
  /** valor total da nota; vazio = calculado pelos itens e encargos */
  total?: number | null;
  /** quantidade e custo unitário da nota por item da entrada (idx); item ausente = não consta na nota */
  items: Array<{ idx: number; qty: number; unitCost: number }>;
}

export interface InvoiceDocInput {
  xml?: string | null;
  fileName?: string | null;
  manual?: InvoiceManualInput | null;
  /** XML: associação manual item da nota (nItem) → item da entrada (idx); 0 = sem correspondência */
  matches?: Record<string, number>;
}

export type QtyAction = "adjust" | "return" | "keep";

export interface ConfirmInvoiceInput extends InvoiceDocInput {
  /** diferença de quantidade por item da entrada (idx): ajustar o estoque, devolver ao fornecedor ou manter (justificar) */
  qtyActions?: Record<string, QtyAction>;
  notes?: string | null;
  /** homologação aceita (empresa de demonstração) */
  allowHomologation?: boolean;
}

export interface InvoiceNoteItem {
  n: number;
  cProd: string | null;
  cEAN: string | null;
  xProd: string;
  /** quantidade na unidade interna (milésimos) */
  qty: number;
  /** valor líquido (vProd − vDesc), centavos */
  value: number;
  unitCost: number;
  skuId: string | null;
  match: number | null;
  matchBy: "manual" | "supplier_code" | "barcode" | "sku" | "item" | null;
  cfop: string | null;
  fiscal?: Record<string, unknown> | null;
}

export interface InvoiceLine {
  idx: number;
  skuId: string;
  description: string;
  sku: string | null;
  enteredQty: number;
  /** custo de entrada (com rateios, sem CT-e) do que entrou */
  enteredValue: number;
  enteredUnitCost: number;
  noteQty: number;
  noteValue: number;
  noteUnitCost: number;
  /** custo de entrada pela nota (com o rateio do frete/despesas/desconto da nota) para a quantidade da nota */
  noteLandedValue: number;
  noteLandedUnitCost: number;
  /** diferença de custo das unidades que entraram (nota − previsto) */
  costDelta: number;
  qtyDiff: number;
  onHand: number;
  inNote: boolean;
}

export interface InvoiceAnalysis {
  source: "xml" | "manual";
  doc: { key: string | null; number: string; series: string | null; issueDate: string; total: number; freight: number; otherExpenses: number; discount: number; supplierName: string; authorized: boolean | null; environment: string | null };
  noteItems: InvoiceNoteItem[];
  lines: InvoiceLine[];
  previousPayable: number;
  payable: number;
  installments: Array<{ number: number; dueDate: string; amount: number; ref: string | null; source: string }>;
  problems: string[];
  warnings: string[];
}

async function requireConfirmInvoice(ctx: Ctx, receiptId: string) {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.confirm_invoice");
  const branchId = requireBranch(ctx);
  const r = await ctx.store.getOrThrow("receipts", receiptId);
  assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
  if (r.branchId !== branchId) throw new BusinessError(`Recebimento nº ${r.number} é de outra filial: selecione a filial do recebimento.`, "other_branch");
  return r;
}

/** Itens da nota a partir do XML: SKU pelo vínculo do fornecedor, GTIN ou SKU; associação ao item da entrada. */
async function noteItemsFromXml(ctx: Ctx, r: Doc, nfe: ParsedNfe, matches: Record<string, number> | undefined) {
  const items: ReceiptItem[] = r.items ?? [];
  const pairs = await cfopPairsFor(ctx.store, ctx.companyId, r.branchId);
  const used = new Set<number>();
  const out: InvoiceNoteItem[] = [];
  for (const [i, it] of nfe.items.entries()) {
    const n = it.nItem || i + 1;
    let skuId: string | null = null;
    let factor = QTY;
    let matchBy: InvoiceNoteItem["matchBy"] = null;
    if (it.cProd) {
      const sp = await findOne(ctx.store, "supplier_products", [["eq", "supplierId", r.supplierId], ["eq", "supplierCode", it.cProd]]);
      if (sp) {
        skuId = sp.skuId;
        factor = sp.conversionFactor || QTY;
        matchBy = "supplier_code";
      }
    }
    if (!skuId && it.cEAN) {
      const sku = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["eq", "barcode", it.cEAN]]);
      if (sku) {
        skuId = sku.id;
        matchBy = "barcode";
      }
    }
    if (!skuId && it.cProd) {
      const byCode = items.find((x) => x.cProd && x.cProd === it.cProd);
      if (byCode?.skuId) {
        skuId = byCode.skuId;
        matchBy = "item";
      }
    }
    if (!skuId && it.cProd) {
      const sku = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["eq", "sku", it.cProd.toUpperCase()]]);
      if (sku) {
        skuId = sku.id;
        matchBy = "sku";
      }
    }
    const qty = roundDiv(it.qCom * factor, QTY);
    const value = it.vProd - it.vDesc;
    let match: number | null = null;
    const manual = matches?.[String(n)];
    if (manual !== undefined) {
      match = manual > 0 && items.some((x) => x.idx === manual) ? manual : null;
      matchBy = match ? "manual" : null;
    } else if (skuId) {
      const target = items.find((x) => x.skuId === skuId && !x.ignore && !used.has(x.idx)) ?? items.find((x) => x.skuId === skuId && !x.ignore);
      match = target?.idx ?? null;
    }
    if (match) used.add(match);
    out.push({ n, cProd: it.cProd ?? null, cEAN: it.cEAN ?? null, xProd: it.xProd, qty, value, unitCost: qty > 0 ? roundDiv(value * QTY, qty) : 0, skuId, match, matchBy, cfop: convertCfop(it.cfop, pairs) ?? null, fiscal: itemFiscalOf(it) });
  }
  return out;
}

/**
 * Compara a nota com o que entrou (sem gravar nada). Problemas impedem a confirmação; avisos só informam.
 */
export async function analyzeInvoice(ctx: Ctx, receiptId: string, input: InvoiceDocInput & { allowHomologation?: boolean }): Promise<InvoiceAnalysis & { parsed: ParsedNfe | null }> {
  const r = await requireConfirmInvoice(ctx, receiptId);
  return analyzeFor(ctx, r, input);
}

async function analyzeFor(ctx: Ctx, r: Doc, input: InvoiceDocInput & { allowHomologation?: boolean }): Promise<InvoiceAnalysis & { parsed: ParsedNfe | null }> {
  assert(r.documentStatus === "pending_invoice", r.documentStatus === "confirmed" ? `A nota do recebimento nº ${r.number} já foi confirmada.` : `Recebimento nº ${r.number} não é uma entrada com nota a confirmar.`);
  assert(r.status !== "scheduled", `A entrada do recebimento nº ${r.number} ainda é PREVISTA (${r.entryAt ? formatIso(r.entryAt) : "—"}): a nota é confirmada depois que a mercadoria entrar.`);
  assert(r.status === "confirmed", r.status === "cancelled" ? "Recebimento cancelado." : "A entrada ainda está sendo realizada — atualize a página e tente novamente.");
  const supplier = await ctx.store.getOrThrow("suppliers", r.supplierId);
  const items: ReceiptItem[] = (r.items ?? []).filter((x: ReceiptItem) => !x.ignore && x.skuId && x.receivedQty > 0);
  const problems: string[] = [];
  const warnings: string[] = [];
  let parsed: ParsedNfe | null = null;
  let noteItems: InvoiceNoteItem[];
  let doc: InvoiceAnalysis["doc"];
  let dups: Array<{ nDup?: string; dVenc: string; vDup: number }> = [];
  if (input.xml) {
    parsed = parseNfeXml(input.xml);
    if (parsed.denied) throw new BusinessError(`NF-e ${parsed.number} com uso DENEGADO pela SEFAZ: não pode ser usada para confirmar a entrada.`, "nfe_denied");
    if (parsed.environment === "homologacao") {
      const company = await ctx.store.get("companies", ctx.companyId);
      if (!(input.allowHomologation || company?.isDemo)) throw new BusinessError(`NF-e ${parsed.number} emitida em ambiente de HOMOLOGAÇÃO (sem valor fiscal). Solicite ao fornecedor o XML autorizado em produção.`, "homologation");
    }
    const emitterDoc = onlyDigits(parsed.emitter.cnpj ?? parsed.emitter.cpf ?? "");
    if (emitterDoc !== onlyDigits(supplier.doc)) throw new BusinessError(`A NF-e ${parsed.number} foi emitida por ${parsed.emitter.name} (${emitterDoc}), não pelo fornecedor da entrada (${supplierLabel(supplier)}).`, "other_supplier");
    const ours = await companyCnpjs(ctx.store, ctx.companyId);
    const destDoc = onlyDigits(parsed.recipient.cnpj ?? parsed.recipient.cpf ?? "");
    if (destDoc && !ours.has(destDoc)) throw new BusinessError(`NF-e destinada a outro CNPJ (${destDoc}). Confira se a nota é desta empresa.`, "recipient");
    const other = await findReceiptByKey(ctx.store, ctx.companyId, parsed.key);
    if (other && other.id !== r.id) throw new BusinessError(`Esta NF-e (chave ${parsed.key}) já está no recebimento nº ${other.number}.`, "duplicate", { id: other.id });
    if (r.nfeKey && r.nfeKey !== parsed.key) warnings.push(`A chave informada no lançamento (${r.nfeKey}) é diferente da chave do XML: vale a do XML.`);
    if (!parsed.authorized) warnings.push("XML sem protocolo de autorização da SEFAZ: confira a autorização no portal da SEFAZ (a justificativa fica nas observações).");
    noteItems = await noteItemsFromXml(ctx, r, parsed, input.matches);
    dups = parsed.duplicatas ?? [];
    doc = {
      key: parsed.key, number: parsed.number, series: parsed.series, issueDate: parsed.issueDate ? toLocalDate(parsed.issueDate) : today(), total: parsed.totals.vNF,
      freight: parsed.totals.vFrete, otherExpenses: parsed.totals.vOutro + parsed.totals.vIPI + parsed.totals.vST + parsed.totals.vSeg, discount: 0, supplierName: parsed.emitter.name, authorized: parsed.authorized, environment: parsed.environment,
    };
  } else {
    const m = input.manual;
    assert(m, "Importe o XML da nota ou informe os dados da nota (número, série, emissão e valores).");
    assert(m.nfeNumber?.trim(), "Informe o número da nota.");
    assert(/^\d{4}-\d{2}-\d{2}$/.test(m.issueDate ?? "") && m.issueDate <= today(), "Data de emissão da nota inválida (não pode ser futura).");
    const key = onlyDigits(m.nfeKey);
    if (key) {
      assert(nfeKeyIsValid(key), "Chave de acesso inválida (44 dígitos com dígito verificador).");
      assert(key.slice(6, 20) === onlyDigits(supplier.doc).padStart(14, "0"), "A chave informada não pertence ao CNPJ deste fornecedor.");
      const other = await findReceiptByKey(ctx.store, ctx.companyId, key);
      if (other && other.id !== r.id) throw new BusinessError(`Esta chave já está no recebimento nº ${other.number}.`, "duplicate", { id: other.id });
    }
    for (const [k, v] of [["Frete", m.freight], ["Outras despesas", m.otherExpenses], ["Desconto", m.discount], ["Total", m.total]] as const) assert(v == null || (Number.isInteger(v) && v >= 0), `${k} da nota inválido.`);
    noteItems = [];
    for (const it of m.items ?? []) {
      const ri = items.find((x) => x.idx === it.idx);
      if (!ri) continue;
      assert(Number.isInteger(it.qty) && it.qty >= 0, `${ri.description}: quantidade da nota inválida.`);
      assert(Number.isInteger(it.unitCost) && it.unitCost >= 0, `${ri.description}: custo da nota inválido.`);
      if (it.qty === 0) continue;
      noteItems.push({ n: noteItems.length + 1, cProd: ri.cProd ?? null, cEAN: null, xProd: ri.description, qty: it.qty, value: lineTotal(it.unitCost, it.qty), unitCost: it.unitCost, skuId: ri.skuId, match: ri.idx, matchBy: "item", cfop: null, fiscal: null });
    }
    const products = noteItems.reduce((a, x) => a + x.value, 0);
    const computed = products - Math.min(m.discount ?? 0, products) + (m.freight ?? 0) + (m.otherExpenses ?? 0);
    doc = { key: key || null, number: m.nfeNumber.trim(), series: m.nfeSeries?.trim() || (key ? String(Number(key.slice(22, 25))) : null), issueDate: m.issueDate, total: m.total ?? computed, freight: m.freight ?? 0, otherExpenses: m.otherExpenses ?? 0, discount: m.discount ?? 0, supplierName: supplierLabel(supplier), authorized: null, environment: null };
    if (m.total != null && m.total !== computed) warnings.push(`Total informado da nota ${formatMoney(m.total)} difere da soma dos itens e encargos (${formatMoney(computed)}): a conta a pagar segue o total da nota.`);
  }
  // custo de entrada pela nota: mesmo cálculo do recebimento (rateio de frete/despesas/desconto da nota pelo valor da linha)
  const byIdx = new Map<number, { qty: number; value: number }>();
  for (const ni of noteItems) {
    if (!ni.match) continue;
    const cur = byIdx.get(ni.match) ?? { qty: 0, value: 0 };
    byIdx.set(ni.match, { qty: cur.qty + ni.qty, value: cur.value + ni.value });
  }
  const pseudo: ReceiptItem[] = items.filter((it) => byIdx.get(it.idx)?.qty).map((it) => {
    const v = byIdx.get(it.idx)!;
    const unit = roundDiv(v.value * QTY, v.qty);
    return { ...it, cteShare: 0, invoicedQty: v.qty, invoicedValue: v.value, invoiceUnitCost: unit, receivedQty: v.qty, unitCost: unit, allocations: [], divergence: null };
  });
  const comp = computeReceipt({ items: pseudo, freight: doc.freight, otherExpenses: doc.otherExpenses, discount: doc.discount, hasXml: true }, []);
  const landed = new Map(comp.items.map((x) => [x.idx, x]));
  const lines: InvoiceLine[] = [];
  for (const it of items) {
    const nv = byIdx.get(it.idx);
    const enteredValue = (it.landedValue ?? lineTotal(it.unitCost, it.receivedQty)) - (it.cteShare ?? 0);
    const bal = await ctx.store.get("stock_balances", balanceId(r.warehouseId, it.skuId!));
    const l = nv ? landed.get(it.idx) : null;
    const noteQty = nv?.qty ?? 0;
    const noteLandedValue = l?.landedValue ?? 0;
    // diferença de custo só das unidades que entraram, pelo custo de entrada da nota
    const costDelta = noteQty > 0 ? (noteQty === it.receivedQty ? noteLandedValue : roundDiv(noteLandedValue * it.receivedQty, noteQty)) - enteredValue : 0;
    lines.push({
      idx: it.idx, skuId: it.skuId!, description: it.description, sku: it.sku ?? null, enteredQty: it.receivedQty, enteredValue, enteredUnitCost: roundDiv(enteredValue * QTY, it.receivedQty),
      noteQty, noteValue: nv?.value ?? 0, noteUnitCost: noteQty ? roundDiv((nv?.value ?? 0) * QTY, noteQty) : 0, noteLandedValue, noteLandedUnitCost: l?.landedUnitCost ?? 0,
      costDelta, qtyDiff: noteQty - it.receivedQty, onHand: Math.max(0, bal?.physical ?? 0), inNote: Boolean(nv),
    });
  }
  for (const ni of noteItems) if (!ni.match) problems.push(`Item ${ni.n} da nota (${ni.cProd ?? "sem código"} — ${ni.xProd}) sem correspondência na entrada: associe a um item que entrou.`);
  for (const l of lines) if (!l.inNote) warnings.push(`${l.description}: entrou ${formatQty(l.enteredQty)} e não consta na nota — trate a diferença de quantidade.`);
  const payable = doc.total;
  const term = r.paymentTermId ? await ctx.store.get("payment_terms", r.paymentTermId) : null;
  const inst = buildReceiptInstallments(payable, dups, term ? { installments: term.installments, firstDueDays: term.firstDueDays, intervalDays: term.intervalDays } : null, doc.issueDate);
  if (inst.rescaled) warnings.push("Duplicatas do XML não fecham com o total da nota: parcelas ajustadas ao total mantendo os vencimentos.");
  return {
    source: input.xml ? "xml" : "manual", doc, noteItems, lines, previousPayable: (r.installments ?? []).reduce((a: number, x: any) => a + x.amount, 0), payable,
    installments: inst.installments.map((x) => ({ ...x, source: inst.source })), problems, warnings, parsed,
  };
}

/** Situação de cada item com diferença de quantidade que exige decisão. */
function qtyDecisionProblems(lines: InvoiceLine[], actions: Record<string, QtyAction> | undefined, notes: string | null | undefined) {
  const out: string[] = [];
  for (const l of lines) {
    if (l.qtyDiff === 0) continue;
    const a = actions?.[String(l.idx)];
    if (!a) out.push(`${l.description}: entrou ${formatQty(l.enteredQty)} e a nota tem ${formatQty(l.noteQty)} — escolha ajustar o estoque, devolver ao fornecedor ou manter.`);
    else if (a === "keep" && !notes?.trim()) out.push(`${l.description}: para manter a diferença de quantidade, registre a justificativa nas observações.`);
    else if (a === "return" && l.qtyDiff > 0) out.push(`${l.description}: a nota tem MAIS do que entrou — devolução não se aplica; ajuste o estoque ou mantenha com justificativa.`);
  }
  return out;
}

/**
 * Confirma a entrada com a nota do fornecedor. Idempotente: a decisão é gravada no recebimento (`invoiceConfirmation`,
 * estado "applying") antes dos efeitos — uma retentativa reaplica a mesma decisão sem duplicar movimentos, ajuste de
 * custo ou título.
 */
export async function confirmPendingInvoice(ctx: Ctx, receiptId: string, input: ConfirmInvoiceInput) {
  let r = await requireConfirmInvoice(ctx, receiptId);
  if (r.documentStatus === "confirmed") return r;
  let plan = r.invoiceConfirmation?.state === "applying" ? (r.invoiceConfirmation as Plan) : null;
  if (!plan) {
    const a = await analyzeFor(ctx, r, input);
    const problems = [...a.problems, ...qtyDecisionProblems(a.lines, input.qtyActions, input.notes)];
    if (a.parsed && !a.parsed.authorized && !input.notes?.trim()) problems.push("XML sem protocolo de autorização: confirme a autorização no portal da SEFAZ e registre a justificativa nas observações.");
    if (problems.length) throw new BusinessError(problems.join(" "), "invoice_blocked");
    // período financeiro: a conta a pagar (competência da entrada) muda de valor → precisa estar aberto
    const title = r.payableTitleId ? await ctx.store.get("titles", r.payableTitleId) : null;
    if (title && (title.total !== a.payable || JSON.stringify(a.installments.map((x) => [x.dueDate, x.amount])) !== JSON.stringify((r.installments ?? []).map((x: any) => [x.dueDate, x.amount])))) await assertPeriodOpen(ctx.store, ctx.companyId, title.competenceDate ?? title.issueDate, "correção da conta a pagar pela nota (competência da entrada)");
    let xmlFileId: string | null = null;
    if (input.xml && a.parsed) {
      const file = await saveFile(ctx, { bucket: "documents", name: input.fileName || `NFe${a.parsed.key}.xml`, mime: "application/xml", data: Buffer.from(input.xml), entityType: "receipt", entityId: r.id, kind: "nfe_xml" });
      xmlFileId = file.id;
    }
    // absorção do ajuste de custo: fração das unidades que entraram ainda em estoque (mesma regra do CT-e)
    const lines = [];
    for (const l of a.lines) {
      const bal = await ctx.store.get("stock_balances", balanceId(r.warehouseId, l.skuId));
      const onHand = Math.max(0, bal?.physical ?? 0);
      let absorbed = l.costDelta ? roundDiv(l.costDelta * Math.min(onHand, l.enteredQty), l.enteredQty) : 0;
      // redução nunca deixa o valor do estoque negativo
      if (absorbed < 0) absorbed = Math.max(absorbed, -Math.floor((onHand * (bal?.avgCost ?? 0)) / QTY));
      lines.push({ ...l, plannedAbsorbed: absorbed, action: l.qtyDiff ? (input.qtyActions?.[String(l.idx)] ?? null) : null });
    }
    plan = {
      state: "applying", source: a.source, doc: a.doc, xmlFileId, xmlHash: input.xml ? sha256(Buffer.from(input.xml)) : null,
      emitter: a.parsed ? { ...a.parsed.emitter, duplicatas: a.parsed.duplicatas, protocol: a.parsed.protocol, authorized: a.parsed.authorized, environment: a.parsed.environment, protocolStatus: a.parsed.protocolStatus, protocolMessage: a.parsed.protocolMessage, homologationAccepted: a.parsed.environment === "homologacao", nature: a.parsed.nature, totals: a.parsed.totals } : null,
      noteItems: a.noteItems, lines, previousPayable: a.previousPayable, payable: a.payable, installments: a.installments, warnings: a.warnings, notes: input.notes?.trim() || null,
      startedAt: nowIso(), startedBy: ctx.user.id,
    };
    r = await ctx.store.update("receipts", r.id, { invoiceConfirmation: plan });
  }
  return applyPlan(ctx, r, plan);
}

interface PlanLine extends InvoiceLine {
  plannedAbsorbed: number;
  action: QtyAction | null;
}
interface Plan {
  state: "applying" | "done";
  source: "xml" | "manual";
  doc: InvoiceAnalysis["doc"];
  xmlFileId: string | null;
  xmlHash: string | null;
  emitter: Record<string, any> | null;
  noteItems: InvoiceNoteItem[];
  lines: PlanLine[];
  previousPayable: number;
  payable: number;
  installments: InvoiceAnalysis["installments"];
  warnings: string[];
  notes: string | null;
  startedAt: string;
  startedBy: string;
  results?: Array<{ idx: number; absorbed: number; notAbsorbed: number; costMovementId: string | null; qtyMovementId: string | null }>;
}

async function applyPlan(ctx: Ctx, r: Doc, plan: Plan) {
  const ref = `NF-e ${plan.doc.number}${plan.doc.series ? `/${plan.doc.series}` : ""}`;
  const results: NonNullable<Plan["results"]> = [];
  // 1) custo: ajuste do custo médio pela diferença (cost_adjust de quantidade zero) nas unidades ainda em estoque
  for (const l of plan.lines) {
    const costKey = `receipt-invoice:${r.id}:${l.idx}:cost`;
    const costMovId = detId("mov", costKey);
    let costMov = await ctx.store.get("stock_movements", costMovId);
    if (!costMov && l.plannedAbsorbed !== 0) {
      await postMovements(ctx, [{ warehouseId: r.warehouseId, skuId: l.skuId, qty: 0, type: "cost_adjust", totalCost: l.plannedAbsorbed, allowCostReduction: true, originType: "receipt_invoice", originId: r.id, reason: `Diferença de custo da ${ref} — recebimento nº ${r.number} (nota a confirmar)`, idemKey: costKey }]);
      costMov = await ctx.store.get("stock_movements", costMovId);
    }
    const absorbed = costMov?.totalCost ?? 0;
    // 2) quantidade: ajuste de estoque pela diferença (decisão "ajustar")
    let qtyMov: Doc | null = null;
    if (l.qtyDiff !== 0 && l.action === "adjust") {
      const qtyKey = `receipt-invoice:${r.id}:${l.idx}:qty`;
      qtyMov = await ctx.store.get("stock_movements", detId("mov", qtyKey));
      if (!qtyMov) {
        const unit = l.noteLandedUnitCost || l.enteredUnitCost;
        await postMovements(ctx, [{
          warehouseId: r.warehouseId, skuId: l.skuId, qty: l.qtyDiff, type: l.qtyDiff > 0 ? "adjust_in" : "adjust_out", unitCost: l.qtyDiff > 0 ? unit : null,
          ...(l.qtyDiff > 0 && l.noteQty > 0 ? { totalCost: roundDiv(l.noteLandedValue * l.qtyDiff, l.noteQty) } : {}),
          originType: "receipt_invoice", originId: r.id, reason: `Diferença de quantidade da ${ref} — recebimento nº ${r.number}: entrou ${formatQty(l.enteredQty)}, nota ${formatQty(l.noteQty)}`, idemKey: qtyKey, respectReserved: l.qtyDiff < 0,
        }]);
        qtyMov = await ctx.store.get("stock_movements", detId("mov", qtyKey));
      }
    }
    results.push({ idx: l.idx, absorbed, notAbsorbed: l.costDelta - absorbed, costMovementId: costMov?.id ?? null, qtyMovementId: qtyMov?.id ?? null });
  }
  // 3) itens do recebimento pelos valores da nota (custo de entrada efetivo, livro de entradas, CT-e posterior)
  const items: ReceiptItem[] = (r.items ?? []).map((x: ReceiptItem) => ({ ...x }));
  const totalsLines = plan.lines;
  for (const it of items) {
    const l = totalsLines.find((x) => x.idx === it.idx);
    if (!l) continue;
    const ni = plan.noteItems.filter((n) => n.match === it.idx);
    const enteredBefore = { unitCost: it.unitCost, landedUnitCost: it.landedUnitCost ?? it.unitCost, receivedQty: it.receivedQty };
    if (l.inNote) {
      const value = l.noteQty === it.receivedQty ? l.noteLandedValue : roundDiv(l.noteLandedValue * it.receivedQty, l.noteQty);
      const lineValue = l.noteQty === it.receivedQty ? l.noteValue : roundDiv(l.noteValue * it.receivedQty, l.noteQty);
      Object.assign(it, {
        invoicedQty: l.noteQty, invoicedValue: l.noteValue, invoiceUnitCost: l.noteUnitCost, unitCost: l.noteUnitCost, lineValue,
        landedValue: value + (it.cteShare ?? 0), landedUnitCost: roundDiv((value + (it.cteShare ?? 0)) * QTY, it.receivedQty),
        ...(ni[0]?.cProd ? { cProd: ni[0].cProd } : {}), ...(ni[0]?.cfop ? { entryCfop: ni[0].cfop } : {}), ...(ni[0]?.fiscal ? { fiscal: ni[0].fiscal } : {}),
        ...(ni[0] && plan.source === "xml" ? { nItem: ni[0].n, xProd: ni[0].xProd, cEAN: ni[0].cEAN } : {}),
      });
    } else Object.assign(it, { invoicedQty: 0, invoicedValue: 0 });
    if (l.qtyDiff !== 0) it.divergence = `Nota ${formatQty(l.noteQty)} × entrada ${formatQty(l.enteredQty)}: ${l.action === "adjust" ? "estoque ajustado" : l.action === "return" ? "devolução ao fornecedor" : "mantido (justificado)"}`;
    void enteredBefore;
  }
  // custo de aquisição do SKU: só quando ainda é o desta entrada (nenhuma entrada posterior o alterou)
  for (const l of plan.lines) {
    const it = items.find((x) => x.idx === l.idx);
    if (!it || !l.inNote) continue;
    await learnSupplierProduct(ctx, r, it);
    const sku = await ctx.store.get("skus", l.skuId);
    const before = l.enteredUnitCost;
    const after = it.landedUnitCost ?? it.unitCost;
    const phId = detId("ph", "receipt-invoice", r.id, l.skuId);
    if (sku && sku.costAcquisition === before && after !== before && !(await ctx.store.get("price_history", phId))) {
      await ctx.store.update("skus", sku.id, { costAcquisition: after, costTotal: after + (sku.costAdditional ?? 0) });
      await ctx.store.create("price_history", { companyId: ctx.companyId, branchId: r.branchId, createdBy: ctx.user.id, skuId: sku.id, productId: sku.productId, priceTableId: null, field: "costAcquisition", oldValue: before, newValue: after, reason: `Custo da ${ref} confirmado no recebimento nº ${r.number}` }, phId).catch((e) => {
        if (!isConflict(e)) throw e;
      });
    }
  }
  // 4) conta a pagar corrigida para o valor da nota
  const titleId = await reviseTitle(ctx, r, plan, ref);
  // 5) recebimento: documento da nota gravado; passa a ser uma entrada comum para o livro de entradas e o pacote
  const productsTotal = items.filter((x) => !x.ignore).reduce((a, x) => a + (x.lineValue ?? 0), 0);
  const divergences = plan.lines.filter((l) => l.qtyDiff !== 0 || l.costDelta !== 0).map((l) => ({ kind: l.qtyDiff !== 0 ? "qty" : "price", idx: l.idx, skuId: l.skuId, message: l.qtyDiff !== 0 ? `${l.description}: entrada ${formatQty(l.enteredQty)} × nota ${formatQty(l.noteQty)} (${l.action === "adjust" ? "estoque ajustado" : l.action === "return" ? "devolução ao fornecedor" : "mantido"})` : `${l.description}: custo previsto ${formatMoney(l.enteredUnitCost)} × nota ${formatMoney(l.noteLandedUnitCost)} (ajuste de custo ${formatMoney(l.costDelta)})` }));
  const patch: Record<string, any> = {
    items, nfeNumber: plan.doc.number, nfeSeries: plan.doc.series, nfeIssueDate: `${plan.doc.issueDate}T12:00:00.000Z`, invoicedTotal: plan.doc.total,
    freight: plan.doc.freight, otherExpenses: plan.doc.otherExpenses, discount: plan.doc.discount, productsTotal, dueTotal: plan.payable, total: plan.payable,
    installments: plan.installments, divergences: [...(r.divergences ?? []).filter((d: any) => d.kind !== "qty" && d.kind !== "price"), ...divergences],
    ...(plan.doc.key ? { nfeKey: plan.doc.key, scopeKey: scopeFor(ctx.companyId, plan.doc.key) } : {}),
    ...(plan.xmlFileId ? { xmlFileId: plan.xmlFileId, xmlHash: plan.xmlHash, origin: "xml" } : {}),
    ...(plan.emitter ? { emitter: plan.emitter } : {}),
    ...(plan.notes ? { notes: [r.notes, `Confirmação da nota: ${plan.notes}`].filter(Boolean).join("\n") } : {}),
    payableTitleId: titleId,
    orderLink: "without_order",
    documentStatus: "confirmed", invoiceConfirmedAt: nowIso(), invoiceConfirmedBy: ctx.user.id,
    invoiceConfirmation: { ...plan, state: "done", results },
    searchText: searchable(String(r.number), plan.doc.number, plan.doc.key, r.searchText),
  };
  let updated: Doc;
  try {
    updated = await ctx.store.update("receipts", r.id, patch);
  } catch (e) {
    if (isConflict(e) && plan.doc.key) {
      const ex = await findReceiptByKey(ctx.store, ctx.companyId, plan.doc.key);
      throw new BusinessError(`A chave ${plan.doc.key} já está no recebimento nº ${ex?.number ?? "—"}.`, "duplicate", { id: ex?.id });
    }
    throw e;
  }
  await resolveOccurrence(ctx.store, occurrenceKeyFor(r.id));
  const abs = results.reduce((a, x) => a + x.absorbed, 0);
  const notAbs = results.reduce((a, x) => a + x.notAbsorbed, 0);
  const qtyLines = plan.lines.filter((l) => l.qtyDiff !== 0);
  await audit(ctx, {
    module: "purchases", action: "receipt.invoice_confirm", entityType: "receipt", entityId: r.id,
    summary: `Recebimento nº ${r.number}: entrada confirmada com a ${ref}${plan.source === "xml" ? " (XML)" : " (dados informados)"} — valor previsto ${formatMoney(plan.previousPayable)} → nota ${formatMoney(plan.payable)}; ajuste de custo ${formatMoney(abs)} no custo médio${notAbs ? `, ${formatMoney(notAbs)} de unidades já vendidas/baixadas (não absorvido)` : ""}${qtyLines.length ? `; diferença de quantidade em ${qtyLines.length} item(ns): ${qtyLines.map((l) => `${l.description} ${l.action === "adjust" ? "ajustado" : l.action === "return" ? "devolver" : "mantido"}`).join(", ")}` : ""}`,
    before: { payable: plan.previousPayable, items: plan.lines.map((l) => ({ idx: l.idx, qty: l.enteredQty, unitCost: l.enteredUnitCost })) },
    after: { payable: plan.payable, items: plan.lines.map((l) => ({ idx: l.idx, qty: l.noteQty, unitCost: l.noteLandedUnitCost, costDelta: l.costDelta, action: l.action })) },
    reason: plan.notes,
    related: [`supplier:${r.supplierId}`, ...(titleId ? [`title:${titleId}`] : [])],
  });
  return updated;
}

/**
 * Título a pagar corrigido para o valor da nota (parcelas da nota). Sem baixas: as parcelas são substituídas (as que
 * sobram são canceladas). Com baixas: as parcelas pagas ficam; a diferença vai para as parcelas em aberto (acréscimo
 * na última em aberto — ou parcela nova — e redução da última para a primeira). Valor já pago acima da nota é
 * recusado (registre a devolução/crédito no financeiro). Conta autorizada cujo valor muda volta para "a autorizar".
 */
async function reviseTitle(ctx: Ctx, r: Doc, plan: Plan, ref: string): Promise<string | null> {
  const titleId: string | null = r.payableTitleId ?? null;
  if (!titleId) {
    if (plan.payable <= 0) return null;
    const supplier = await ctx.store.getOrThrow("suppliers", r.supplierId);
    const t = await createTitle(ctx, {
      kind: "payable", partyType: "supplier", partyId: supplier.id, partyName: supplierLabel(supplier), description: `Compra — recebimento nº ${r.number} / ${ref}`,
      documentNumber: `${plan.doc.number}${plan.doc.series ? `-${plan.doc.series}` : ""}`, originType: "purchase_receipt", originId: r.id, issueDate: r.entryAt ? toLocalDate(r.entryAt) : plan.doc.issueDate,
      categoryId: r.categoryId ?? null, costCenterId: r.costCenterId ?? null, installments: plan.installments.map((x) => ({ dueDate: x.dueDate, amount: x.amount })), idemKey: `purchase_receipt:${r.id}`, branchId: r.branchId,
    });
    return t.id;
  }
  const title = await ctx.store.getOrThrow("titles", titleId);
  if (!title.provisional && !title.forecast) return titleId; // já corrigido (retentativa)
  const insts = (await listAll(ctx.store, "installments", { filters: [["eq", "titleId", titleId]] })).sort((a, b) => a.number - b.number);
  const live = insts.filter((i) => i.status !== "cancelled" && i.status !== "renegotiated");
  const paidAny = live.some((i) => (i.paid ?? 0) > 0);
  const newTotal = plan.installments.reduce((a, x) => a + x.amount, 0);
  const oldTotal = live.reduce((a, i) => a + i.amount, 0);
  const docNumber = `${plan.doc.number}${plan.doc.series ? `-${plan.doc.series}` : ""}`;
  const changed = newTotal !== oldTotal || !paidAny;
  if (title.status === "cancelled") throw new BusinessError(`A conta a pagar nº ${title.number} desta entrada está cancelada: corrija no financeiro antes de confirmar a nota.`, "title_cancelled");
  await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      if (!paidAny) {
        const n = Math.max(live.length, plan.installments.length);
        for (let k = 0; k < n; k++) {
          const old = live[k];
          const nw = plan.installments[k];
          if (old && nw) await t.update("installments", old.id, { amount: nw.amount, balance: nw.amount, dueDate: nw.dueDate, status: "open" });
          else if (old && !nw) await t.update("installments", old.id, { status: "cancelled", balance: 0 });
          else if (!old && nw) {
            const num = insts.length + (k - live.length) + 1;
            await t.create("installments", { companyId: ctx.companyId, branchId: title.branchId, createdBy: ctx.user.id, titleId, kind: "payable", number: num, dueDate: nw.dueDate, competenceDate: title.competenceDate, amount: nw.amount, interest: 0, fine: 0, discount: 0, paid: 0, balance: nw.amount, status: "open", seq: 0, partyId: title.partyId, partyName: title.partyName, categoryId: title.categoryId, costCenterId: title.costCenterId, methodKind: live[0]?.methodKind ?? null, description: title.description }, detId("inst", titleId!, num));
          }
        }
      } else if (newTotal !== oldTotal) {
        let diff = newTotal - oldTotal;
        const open = live.filter((i) => i.balance > 0);
        if (diff > 0) {
          const last = open[open.length - 1];
          if (last) await t.update("installments", last.id, { amount: last.amount + diff, balance: last.balance + diff });
          else {
            const num = insts.length + 1;
            const due = plan.installments[plan.installments.length - 1]?.dueDate ?? today();
            await t.create("installments", { companyId: ctx.companyId, branchId: title.branchId, createdBy: ctx.user.id, titleId, kind: "payable", number: num, dueDate: due, competenceDate: title.competenceDate, amount: diff, interest: 0, fine: 0, discount: 0, paid: 0, balance: diff, status: "open", seq: 0, partyId: title.partyId, partyName: title.partyName, categoryId: title.categoryId, costCenterId: title.costCenterId, methodKind: live[0]?.methodKind ?? null, description: title.description }, detId("inst", titleId!, num));
          }
        } else {
          let left = -diff;
          if (left > open.reduce((a, i) => a + i.balance, 0)) throw new BusinessError(`O valor já pago da conta a pagar nº ${title.number} supera o valor da nota (${formatMoney(newTotal)}): registre a devolução/crédito do fornecedor no financeiro antes de confirmar.`, "paid_over_invoice");
          for (const i of [...open].reverse()) {
            if (left <= 0) break;
            const cut = Math.min(left, i.balance);
            left -= cut;
            await t.update("installments", i.id, cut === i.balance && (i.paid ?? 0) === 0 ? { amount: i.amount - cut, balance: 0, status: "cancelled" } : { amount: i.amount - cut, balance: i.balance - cut });
          }
          diff = 0;
        }
      }
      const count = !paidAny ? plan.installments.length : live.length + (newTotal > oldTotal && !live.some((i) => i.balance > 0) ? 1 : 0);
      await t.update("titles", titleId!, {
        total: newTotal, installmentsCount: count, documentNumber: docNumber, provisional: false, forecast: false,
        description: `Compra — recebimento nº ${r.number} / ${ref}`,
        ...(changed && title.approvalStatus === "approved" && newTotal !== oldTotal ? { approvalStatus: "pending", approvedBy: null, approvedAt: null } : {}),
        notes: `${title.notes ? `${title.notes}\n` : ""}Valor corrigido pela ${ref}: ${formatMoney(oldTotal)} → ${formatMoney(newTotal)}${paidAny ? " (parcelas pagas mantidas; diferença nas parcelas em aberto)" : ""}.`,
      });
    }),
  );
  await refreshTitleStatus(ctx.store, titleId);
  await audit(ctx, { module: "finance", action: "title.invoice_revise", entityType: "title", entityId: titleId, summary: `Conta a pagar nº ${title.number}: valor provisório corrigido pela ${ref} (${formatMoney(oldTotal)} → ${formatMoney(newTotal)}, ${plan.installments.length} parcela(s))`, related: [`receipt:${r.id}`] });
  return titleId;
}

// ───────────────────────────── Consultas (painel, "a chegar", aviso)

/** Quantidades "a chegar" (entradas previstas ainda não realizadas) por depósito|SKU. */
export async function incomingMap(store: Store, companyId: string, branchId?: string | null) {
  const filters: any[] = [["eq", "companyId", companyId], ["eq", "status", "scheduled"]];
  if (branchId) filters.push(["eq", "branchId", branchId]);
  const list = await listAll(store, "receipts", { filters });
  const out = new Map<string, { qty: number; receipts: Array<{ id: string; number: number; entryAt: string }> }>();
  for (const r of list) {
    for (const it of (r.items ?? []) as ReceiptItem[]) {
      if (it.ignore || !it.skuId || !(it.receivedQty > 0)) continue;
      const k = `${r.warehouseId}|${it.skuId}`;
      const cur = out.get(k) ?? { qty: 0, receipts: [] };
      cur.qty += it.receivedQty;
      if (!cur.receipts.some((x) => x.id === r.id)) cur.receipts.push({ id: r.id, number: r.number, entryAt: r.entryAt });
      out.set(k, cur);
    }
  }
  return out;
}

/** SKUs com entrada realizada aguardando a nota (aviso informativo no PDV e no produto). */
export async function pendingInvoiceSkus(store: Store, companyId: string, branchId?: string | null) {
  const filters: any[] = [["eq", "companyId", companyId], ["eq", "documentStatus", "pending_invoice"], ["eq", "status", "confirmed"]];
  if (branchId) filters.push(["eq", "branchId", branchId]);
  const list = await listAll(store, "receipts", { filters });
  const out = new Map<string, Array<{ id: string; number: number }>>();
  for (const r of list) for (const it of (r.items ?? []) as ReceiptItem[]) if (it.skuId && !it.ignore) out.set(it.skuId, [...(out.get(it.skuId) ?? []), { id: r.id, number: r.number }]);
  return out;
}

/** Entradas com nota a confirmar e previstas de um produto (aba Estoque do produto). */
export async function pendingEntriesForSkus(store: Store, companyId: string, skuIds: string[]) {
  if (!skuIds.length) return [];
  const list = await listAll(store, "receipts", { filters: [["eq", "companyId", companyId], ["eq", "documentStatus", "pending_invoice"], ["ne", "status", "cancelled"]] });
  const set = new Set(skuIds);
  const out: Array<{ id: string; number: number; status: string; entryAt: string; invoiceDueAt: string | null; warehouseId: string; branchId: string; qty: number }> = [];
  for (const r of list) {
    const qty = ((r.items ?? []) as ReceiptItem[]).filter((it) => it.skuId && set.has(it.skuId) && !it.ignore).reduce((a, it) => a + it.receivedQty, 0);
    if (qty > 0) out.push({ id: r.id, number: r.number, status: r.status, entryAt: r.entryAt, invoiceDueAt: r.invoiceDueAt ?? null, warehouseId: r.warehouseId, branchId: r.branchId, qty });
  }
  return out.sort((a, b) => String(a.entryAt).localeCompare(String(b.entryAt)));
}

// ───────────────────────────── Rotina diária (realização das previstas + aviso de prazo)

/**
 * Rotina diária: (1) realiza as entradas previstas cuja data/hora chegou; (2) com o aviso ligado
 * (`purchase.pendingInvoice.alert`, empresa/filial) e o recurso ligado, gera UMA ocorrência por recebimento aguardando
 * nota com prazo vencido ou dentro da antecedência — para quem tem "Confirmar com a nota e aprovar divergências".
 * A ocorrência é resolvida na confirmação da nota.
 */
export async function runPendingInvoiceRoutine(store: Store, companyId: string, opts: { now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const realized = await realizeDueEntries(store, companyId, { now });
  const ref = toLocalDate(new Date(now).toISOString());
  const list = await listAll(store, "receipts", { filters: [["eq", "companyId", companyId], ["eq", "documentStatus", "pending_invoice"], ["eq", "status", "confirmed"]] });
  let alerts = 0;
  const cache = new Map<string, { on: boolean; alert: boolean; leadDays: number }>();
  for (const r of list) {
    if (!r.invoiceDueAt) continue;
    let cfg = cache.get(r.branchId);
    if (!cfg) {
      const s = await pendingInvoiceSettings(store, companyId, r.branchId);
      cfg = { on: await pendingInvoiceOn(store, companyId, r.branchId), alert: s.alert, leadDays: s.leadDays };
      cache.set(r.branchId, cfg);
    }
    if (!cfg.on || !cfg.alert) continue;
    const daysToDue = diffDays(ref, r.invoiceDueAt);
    if (daysToDue > cfg.leadDays) continue;
    const supplier = await store.get("suppliers", r.supplierId);
    alerts += await notify(store, {
      companyId, branchId: r.branchId, type: "deadline", priority: daysToDue < 0 ? "high" : "normal",
      title: daysToDue < 0 ? `Nota a confirmar VENCIDA: recebimento nº ${r.number}` : `Nota a confirmar vence ${daysToDue === 0 ? "hoje" : `em ${daysToDue} dia(s)`}: recebimento nº ${r.number}`,
      body: `${supplierLabel(supplier) || r.emitter?.name || "Fornecedor"} · ${formatMoney(r.dueTotal)} · entrada em ${toLocalDate(r.entryAt ?? r.confirmedAt).split("-").reverse().join("/")} · prazo ${r.invoiceDueAt.split("-").reverse().join("/")}. Cobre a nota do fornecedor e confirme a entrada com a nota.`,
      link: `/compras/recebimentos/${r.id}`, originType: "receipt", originId: r.id, occurrenceKey: occurrenceKeyFor(r.id),
      audience: { action: "purchase.confirm_invoice" },
    });
  }
  return { realized: realized.realized, errors: realized.errors.length, alerts };
}

