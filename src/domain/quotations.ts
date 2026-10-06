import { detId, findOne, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { onlyDigits } from "@/lib/core/text";
import { addDays, nowIso, parseDateInput, today } from "@/lib/dates";
import { formatMoney, parseBps, parseMoney, parseQty } from "@/lib/money";
import { evaluateSelection, suggestSelection, type QuoteItem, type QuoteProposal, type ProposalItem } from "./purchase-calc";
import { cancelOrder, createOrder, updateOrder, ORDER_STATUS_LABEL, type OrderInput, type OrderStatus } from "./purchases";
import { assertSupplierUsable, supplierLabel } from "./suppliers";
import type { QuoteOptions } from "./purchase-calc";

/**
 * Cotações (Tela 47 / visão 13). Uma cotação reúne itens e fornecedores; cada fornecedor tem UMA
 * proposta (versão incrementada a cada alteração). A seleção grava fornecedor + proposta + versão
 * por item; comparação, revisão e geração de pedidos usam a MESMA função `evaluateSelection`.
 * Pedidos são gerados uma única vez (ids determinísticos por cotação × fornecedor).
 */

export type QuotationStatus = "open" | "closed" | "cancelled";

export interface QuotationInput {
  title: string;
  items: Array<{ skuId: string; qty: number; neededBy?: string | null }>;
  supplierIds: string[];
  responseDue?: string | null;
  notes?: string | null;
  origin?: "manual" | "replenishment" | "need";
  originId?: string | null;
}

export async function getQuotation(ctx: Ctx, id: string) {
  const q = await ctx.store.getOrThrow("quotations", id);
  assert(q.companyId === ctx.companyId, "Cotação de outra empresa.");
  return q;
}

/** Escrita na cotação: exige filial definida (não consolidado) e que a cotação seja da filial ativa. */
async function getQuotationForWrite(ctx: Ctx, id: string) {
  const branchId = requireBranch(ctx);
  const q = await getQuotation(ctx, id);
  if (q.branchId !== branchId) throw new BusinessError(`Cotação nº ${q.number} é de outra filial: selecione a filial da cotação para alterá-la.`, "other_branch");
  return q;
}

/** Fornecedor da própria empresa (o id vem do formulário/cliente). */
async function companySupplier(ctx: Ctx, supplierId: string) {
  const s = await ctx.store.get("suppliers", supplierId);
  if (!s || s.companyId !== ctx.companyId) throw new BusinessError("Fornecedor não encontrado nesta empresa.", "not_found");
  return s;
}

/** Fornecedores utilizáveis (da empresa e ativos) entre os informados. */
async function usableSupplierIds(ctx: Ctx, ids: string[]) {
  const out = new Set<string>();
  for (const id of new Set(ids)) {
    const s = await ctx.store.get("suppliers", id);
    if (s && s.companyId === ctx.companyId && s.status === "active") out.add(id);
  }
  return out;
}

async function buildItems(ctx: Ctx, items: QuotationInput["items"]): Promise<QuoteItem[]> {
  assert(items.length > 0, "Inclua ao menos um item na cotação.");
  const merged = new Map<string, { qty: number; neededBy: string | null }>();
  for (const it of items) {
    assert(it.skuId && it.qty > 0, "Cada item precisa de produto e quantidade maior que zero.");
    const cur = merged.get(it.skuId);
    const neededBy = it.neededBy || null;
    merged.set(it.skuId, { qty: (cur?.qty ?? 0) + it.qty, neededBy: cur?.neededBy && neededBy ? (cur.neededBy < neededBy ? cur.neededBy : neededBy) : cur?.neededBy ?? neededBy });
  }
  const out: QuoteItem[] = [];
  for (const [skuId, v] of merged) {
    const sku = await ctx.store.getOrThrow("skus", skuId);
    assert(sku.companyId === ctx.companyId, "Produto de outra empresa.");
    out.push({ skuId, sku: sku.sku, description: sku.name ?? sku.sku, unitCode: sku.unitCode ?? "UN", qty: v.qty, neededBy: v.neededBy });
  }
  return out;
}

export async function createQuotation(ctx: Ctx, input: QuotationInput & { idemKey?: string | null }) {
  requirePerm(ctx, "purchases", "create");
  const branchId = requireBranch(ctx);
  if (input.idemKey) {
    const ex = await ctx.store.get("quotations", detId("quotation", input.idemKey));
    if (ex) return ex;
  }
  const items = await buildItems(ctx, input.items);
  const supplierIds = [...new Set(input.supplierIds.filter(Boolean))];
  assert(supplierIds.length >= 1, "Selecione ao menos um fornecedor.");
  for (const sid of supplierIds) {
    const s = await ctx.store.getOrThrow("suppliers", sid);
    assert(s.companyId === ctx.companyId, "Fornecedor de outra empresa.");
    assertSupplierUsable(s);
  }
  const number = await nextNumber(ctx.store, `quotation:${ctx.companyId}`);
  const q = await ctx.store.create(
    "quotations",
    {
      companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, title: input.title?.trim() || `Cotação nº ${number}`, origin: input.origin ?? "manual", originId: input.originId ?? null,
      status: "open", items, supplierIds, selection: null, selectionMode: null, responseDue: input.responseDue || null, notes: input.notes ?? null, ordersCreated: false,
    },
    input.idemKey ? detId("quotation", input.idemKey) : undefined,
  );
  await audit(ctx, { module: "purchases", action: "quotation.create", entityType: "quotation", entityId: q.id, summary: `Cotação nº ${number} criada: ${items.length} item(ns), ${supplierIds.length} fornecedor(es)${input.origin === "replenishment" ? " (a partir da reposição)" : ""}`, related: supplierIds.map((s) => `supplier:${s}`) });
  return q;
}

/** Altera itens/fornecedores enquanto aberta e sem pedidos gerados. */
export async function updateQuotation(ctx: Ctx, id: string, input: QuotationInput) {
  requirePerm(ctx, "purchases", "edit");
  const q = await getQuotationForWrite(ctx, id);
  assert(q.status === "open" && !q.ordersCreated, "Cotação encerrada não pode ser alterada.");
  const items = await buildItems(ctx, input.items);
  const supplierIds = [...new Set(input.supplierIds.filter(Boolean))];
  assert(supplierIds.length >= 1, "Selecione ao menos um fornecedor.");
  // todos os fornecedores precisam ser da empresa; os incluídos agora também precisam estar utilizáveis
  for (const sid of supplierIds) {
    const s = await companySupplier(ctx, sid);
    if (!(q.supplierIds ?? []).includes(sid)) assertSupplierUsable(s);
  }
  const u = await ctx.store.update("quotations", id, { title: input.title?.trim() || q.title, items, supplierIds, responseDue: input.responseDue || null, notes: input.notes ?? null, selection: null, selectionMode: null });
  const d = diff(q, u);
  await audit(ctx, { module: "purchases", action: "quotation.update", entityType: "quotation", entityId: id, summary: `Cotação nº ${q.number} alterada (seleção reiniciada)`, before: d.before, after: d.after });
  return u;
}

export async function cancelQuotation(ctx: Ctx, id: string, reason: string) {
  requirePerm(ctx, "purchases", "edit");
  assert(reason?.trim(), "Informe o motivo.");
  const q = await getQuotationForWrite(ctx, id);
  assert(q.status === "open" && !q.ordersCreated, "Somente cotação aberta sem pedidos pode ser cancelada.");
  await ctx.store.update("quotations", id, { status: "cancelled", closedAt: nowIso() });
  await audit(ctx, { module: "purchases", action: "quotation.cancel", entityType: "quotation", entityId: id, summary: `Cotação nº ${q.number} cancelada`, reason });
}

// ───────────────────────────── Propostas

export interface ProposalInput {
  supplierId: string;
  items: ProposalItem[];
  freight?: number;
  leadTimeDays?: number | null;
  paymentTermId?: string | null;
  paymentTermsText?: string | null;
  minOrderValue?: number | null;
  validUntil?: string | null;
  notes?: string | null;
  source?: "manual" | "csv";
}

export async function quotationProposals(store: Store, quotationId: string) {
  return listAll(store, "quotation_proposals", { filters: [["eq", "quotationId", quotationId]] });
}

/** Registra ou atualiza a proposta do fornecedor (nova versão a cada alteração). */
export async function saveProposal(ctx: Ctx, quotationId: string, input: ProposalInput) {
  requirePerm(ctx, "purchases", "edit");
  const q = await getQuotationForWrite(ctx, quotationId);
  assert(q.status === "open" && !q.ordersCreated, "Cotação encerrada: propostas não podem mais ser alteradas.");
  assert((q.supplierIds ?? []).includes(input.supplierId), "Fornecedor não participa desta cotação.");
  const skuIds = new Set((q.items as QuoteItem[]).map((i) => i.skuId));
  const items = input.items.filter((i) => skuIds.has(i.skuId) && i.unitPrice > 0);
  for (const i of items) {
    assert(Number.isInteger(i.unitPrice) && i.unitPrice > 0, "Preço unitário inválido.");
    assert((i.discountBps ?? 0) >= 0 && (i.discountBps ?? 0) <= 10000, "Desconto deve estar entre 0% e 100%.");
  }
  assert(items.length > 0, "Informe o preço de ao menos um item.");
  assert((input.freight ?? 0) >= 0 && (input.minOrderValue ?? 0) >= 0, "Frete e pedido mínimo não podem ser negativos.");
  const supplier = await companySupplier(ctx, input.supplierId);
  const term = input.paymentTermId ? await ctx.store.get("payment_terms", input.paymentTermId) : null;
  assert(!term || term.companyId === ctx.companyId, "Condição de pagamento inválida.");
  const existing = await findOne(ctx.store, "quotation_proposals", [["eq", "quotationId", quotationId], ["eq", "supplierId", input.supplierId]]);
  const data = {
    items: items.map((i) => ({ skuId: i.skuId, unitPrice: i.unitPrice, discountBps: i.discountBps ?? 0, available: i.available !== false, availableQty: i.availableQty ?? null, leadTimeDays: i.leadTimeDays ?? null, deliveryDate: i.deliveryDate || null, notes: i.notes ?? null })),
    freight: input.freight ?? 0,
    leadTimeDays: input.leadTimeDays ?? supplier.leadTimeDays ?? null,
    paymentTermId: input.paymentTermId || null,
    paymentTermsText: input.paymentTermsText?.trim() || term?.name || supplier.paymentTermsText || null,
    minOrderValue: input.minOrderValue ?? supplier.minOrderValue ?? 0,
    validUntil: input.validUntil || null,
    notes: input.notes ?? null,
    status: "received",
    receivedAt: nowIso(),
    source: input.source ?? "manual",
  };
  const doc = existing
    ? await ctx.store.update("quotation_proposals", existing.id, { ...data, version: (existing.version ?? 1) + 1 })
    : await ctx.store.create("quotation_proposals", { companyId: ctx.companyId, branchId: q.branchId, createdBy: ctx.user.id, quotationId, supplierId: input.supplierId, version: 1, ...data }, detId("qprop", quotationId, input.supplierId));
  await audit(ctx, {
    module: "purchases",
    action: existing ? "quotation.proposal_update" : "quotation.proposal",
    entityType: "quotation",
    entityId: quotationId,
    summary: `Proposta de ${supplierLabel(supplier)} ${existing ? `atualizada (versão ${doc.version})` : "registrada"}${input.source === "csv" ? " por importação CSV" : ""}: ${items.length} item(ns), frete ${formatMoney(data.freight)}, validade ${data.validUntil ?? "—"}`,
    related: [`supplier:${input.supplierId}`],
  });
  return doc;
}

export async function removeProposal(ctx: Ctx, quotationId: string, supplierId: string) {
  requirePerm(ctx, "purchases", "edit");
  const q = await getQuotationForWrite(ctx, quotationId);
  assert(q.status === "open" && !q.ordersCreated, "Cotação encerrada.");
  const p = await findOne(ctx.store, "quotation_proposals", [["eq", "quotationId", quotationId], ["eq", "supplierId", supplierId]]);
  if (!p) return;
  await ctx.store.delete("quotation_proposals", p.id);
  const sel = { ...(q.selection?.items ?? {}) };
  for (const [k, v] of Object.entries(sel)) if ((v as any)?.supplierId === supplierId) delete sel[k];
  await ctx.store.update("quotations", quotationId, { selection: q.selection ? { ...q.selection, items: sel } : null });
  await audit(ctx, { module: "purchases", action: "quotation.proposal_remove", entityType: "quotation", entityId: quotationId, summary: `Proposta removida (${supplierId})`, related: [`supplier:${supplierId}`] });
}

/**
 * Importa propostas por CSV (separador ; ou ,). Colunas (cabeçalho obrigatório, sem acentos ou com):
 *   fornecedor (CNPJ ou código), sku, preco, desconto (%), disponivel (sim/não), qtd_disponivel,
 *   prazo (dias), frete, pedido_minimo, validade (dd/mm/aaaa), condicao
 * Campos de cabeçalho da proposta (frete, prazo, mínimo, validade, condição) usam a primeira linha preenchida do fornecedor.
 */
export async function importProposalsCsv(ctx: Ctx, quotationId: string, csv: string) {
  requirePerm(ctx, "purchases", "edit");
  const q = await getQuotationForWrite(ctx, quotationId);
  const text = csv.replace(/^﻿/, "").trim();
  assert(text, "Arquivo vazio.");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (quoted && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === sep && !quoted) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z_]/g, "");
  const header = split(lines[0]).map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const ix = { supplier: col("fornecedor", "cnpj", "supplier"), sku: col("sku", "produto", "codigo"), price: col("preco", "preco_unitario", "precounitario", "valor"), disc: col("desconto", "desconto_", "descontopct"), avail: col("disponivel", "disponibilidade"), availQty: col("qtd_disponivel", "qtddisponivel", "quantidade_disponivel"), lead: col("prazo", "prazo_dias", "prazodias"), freight: col("frete"), min: col("pedido_minimo", "pedidominimo", "minimo"), valid: col("validade", "valido_ate"), term: col("condicao", "condicao_pagamento", "pagamento") };
  assert(ix.supplier >= 0 && ix.sku >= 0 && ix.price >= 0, "Cabeçalho deve conter as colunas fornecedor, sku e preco.");
  const suppliers = (await Promise.all((q.supplierIds ?? []).map((id: string) => ctx.store.get("suppliers", id)))).filter((s) => s && s.companyId === ctx.companyId);
  const skuByCode = new Map((q.items as QuoteItem[]).map((i) => [String(i.sku ?? "").toUpperCase(), i.skuId]));
  const groups = new Map<string, ProposalInput>();
  const errors: string[] = [];
  for (const [n, line] of lines.slice(1).entries()) {
    const c = split(line);
    const ref = c[ix.supplier] ?? "";
    const sup = suppliers.find((s) => s && (onlyDigits(ref) && s.doc === onlyDigits(ref) || String(s.code ?? "").toUpperCase() === ref.toUpperCase()));
    if (!sup) {
      errors.push(`Linha ${n + 2}: fornecedor "${ref}" não participa da cotação.`);
      continue;
    }
    const skuId = skuByCode.get((c[ix.sku] ?? "").toUpperCase());
    if (!skuId) {
      errors.push(`Linha ${n + 2}: SKU "${c[ix.sku]}" não está na cotação.`);
      continue;
    }
    try {
      const g: ProposalInput = groups.get(sup.id) ?? { supplierId: sup.id, items: [], source: "csv" };
      const availRaw = ix.avail >= 0 ? norm(c[ix.avail] ?? "") : "";
      g.items.push({
        skuId,
        unitPrice: parseMoney(c[ix.price]),
        discountBps: ix.disc >= 0 && c[ix.disc] ? parseBps(c[ix.disc]) : 0,
        available: !["nao", "n", "false", "0", "indisponivel"].includes(availRaw),
        availableQty: ix.availQty >= 0 && c[ix.availQty] ? parseQty(c[ix.availQty]) : null,
        leadTimeDays: ix.lead >= 0 && c[ix.lead] ? Number(c[ix.lead]) : null,
      });
      if (g.freight == null && ix.freight >= 0 && c[ix.freight]) g.freight = parseMoney(c[ix.freight]);
      if (g.leadTimeDays == null && ix.lead >= 0 && c[ix.lead]) g.leadTimeDays = Number(c[ix.lead]);
      if (g.minOrderValue == null && ix.min >= 0 && c[ix.min]) g.minOrderValue = parseMoney(c[ix.min]);
      if (g.validUntil == null && ix.valid >= 0 && c[ix.valid]) g.validUntil = parseDateInput(c[ix.valid]);
      if (g.paymentTermsText == null && ix.term >= 0 && c[ix.term]) g.paymentTermsText = c[ix.term];
      groups.set(sup.id, g);
    } catch (e: any) {
      errors.push(`Linha ${n + 2}: ${e.message}`);
    }
  }
  if (errors.length && !groups.size) throw new BusinessError(`Nenhuma proposta importada. ${errors.slice(0, 5).join(" ")}`);
  const saved: Doc[] = [];
  for (const g of groups.values()) saved.push(await saveProposal(ctx, quotationId, g));
  return { saved: saved.length, errors };
}

// ───────────────────────────── Comparação, seleção e revisão

export function toQuoteProposals(proposals: Doc[], supplierNames: Map<string, string>): QuoteProposal[] {
  return proposals.map((p) => ({
    id: p.id, supplierId: p.supplierId, supplierName: supplierNames.get(p.supplierId) ?? p.supplierId, items: p.items ?? [], freight: p.freight ?? 0, leadTimeDays: p.leadTimeDays,
    paymentTermId: p.paymentTermId, paymentTermsText: p.paymentTermsText, minOrderValue: p.minOrderValue ?? 0, validUntil: p.validUntil, version: p.version ?? 1,
  }));
}

export async function supplierNameMap(store: Store, ids: string[], companyId?: string) {
  const out = new Map<string, string>();
  for (const id of ids) {
    const s = await store.get("suppliers", id);
    // defesa em profundidade: nunca expõe fornecedor de outra empresa
    if (s && (!companyId || s.companyId === companyId)) out.set(id, supplierLabel(s));
  }
  return out;
}

/** Visão consolidada da cotação (mesmos números na comparação, na revisão e nos pedidos). */
export async function quotationView(ctx: Ctx, id: string, opts: QuoteOptions = {}) {
  const q = await getQuotation(ctx, id);
  const props = await quotationProposals(ctx.store, id);
  const names = await supplierNameMap(ctx.store, q.supplierIds ?? [], ctx.companyId);
  const proposals = toQuoteProposals(props.filter((p) => names.has(p.supplierId)), names);
  const items = q.items as QuoteItem[];
  const refDate = today();
  const selItems: Record<string, { supplierId: string; proposalId: string; version: number }> = q.selection?.items ?? {};
  const assign = Object.fromEntries(Object.entries(selItems).map(([k, v]) => [k, v.supplierId]));
  const evaluation = evaluateSelection(items, proposals, assign, refDate, opts);
  // seleção feita sobre versão anterior da proposta (preserva a versão escolhida e sinaliza mudança)
  const stale = Object.entries(selItems).filter(([, v]) => {
    const p = proposals.find((x) => x.id === v.proposalId);
    return !p || (p.version ?? 1) !== v.version;
  }).map(([skuId]) => skuId);
  const orders = q.ordersCreated ? await listAll(ctx.store, "purchase_orders", { filters: [["eq", "quotationId", id]] }) : [];
  return { q, proposals, rawProposals: props, items, evaluation, stale, refDate, names, orders };
}

/** Grava a seleção (manual ou sugerida) com a versão da proposta escolhida. */
export async function saveSelection(ctx: Ctx, id: string, assign: Record<string, string | null>, mode: "manual" | "suggested", meta?: Record<string, any>) {
  requirePerm(ctx, "purchases", "edit");
  const q = await getQuotationForWrite(ctx, id);
  assert(q.status === "open" && !q.ordersCreated, "Cotação encerrada: a seleção não pode mais ser alterada.");
  const props = await quotationProposals(ctx.store, id);
  const items: Record<string, { supplierId: string; proposalId: string; version: number }> = {};
  const checked = new Set<string>();
  for (const it of q.items as QuoteItem[]) {
    const sid = assign[it.skuId];
    if (!sid) continue;
    if (!checked.has(sid)) {
      // fornecedor bloqueado/inativo/rascunho não pode ser escolhido (a geração dos pedidos falharia)
      assertSupplierUsable(await companySupplier(ctx, sid));
      checked.add(sid);
    }
    const p = props.find((x) => x.supplierId === sid);
    assert(p, `Fornecedor sem proposta para ${it.description}.`);
    assert((p.items ?? []).some((pi: any) => pi.skuId === it.skuId && pi.unitPrice > 0), `${supplierLabel(await ctx.store.get("suppliers", sid))} não cotou ${it.description}.`);
    items[it.skuId] = { supplierId: sid, proposalId: p.id, version: p.version ?? 1 };
  }
  const selection = { items, mode, at: nowIso(), by: ctx.user.name, ...(meta ?? {}) };
  await ctx.store.update("quotations", id, { selection, selectionMode: mode });
  const names = await supplierNameMap(ctx.store, q.supplierIds ?? [], ctx.companyId);
  const ev = evaluateSelection(q.items, toQuoteProposals(props, names), Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.supplierId])), today());
  await audit(ctx, { module: "purchases", action: "quotation.selection", entityType: "quotation", entityId: id, summary: `Seleção ${mode === "suggested" ? "sugerida (heurística)" : "manual"} gravada: ${ev.groups.length} fornecedor(es), total ${formatMoney(ev.grandTotal)} com frete` });
  return ev;
}

/** Aplica a sugestão heurística de menor total viável. */
export async function applySuggestion(ctx: Ctx, id: string, opts: QuoteOptions = {}) {
  await getQuotationForWrite(ctx, id);
  const v = await quotationView(ctx, id, opts);
  // a sugestão considera só fornecedores utilizáveis (ativos)
  const usable = await usableSupplierIds(ctx, v.proposals.map((p) => p.supplierId));
  const s = suggestSelection(v.items, v.proposals.filter((p) => usable.has(p.supplierId)), v.refDate, opts);
  assert(Object.keys(s.assign).length > 0, "Nenhuma proposta viável (válida e disponível) para sugerir.");
  const ev = await saveSelection(ctx, id, s.assign, "suggested", { onTimeOnly: Boolean(opts.onTimeOnly), heuristic: { method: s.method, greedyTotal: s.greedyTotal, total: s.evaluation.grandTotal, rounds: s.rounds, feasible: s.feasible } });
  return { ...s, evaluation: ev };
}

/**
 * Gera os pedidos em rascunho (um por fornecedor) UMA única vez, a partir da seleção vigente,
 * preservando proposta/versão/validade em `proposalRef`. Opcionalmente envia todos para análise.
 *  - Valida todos os fornecedores ANTES de criar qualquer pedido (nada é criado se algum falhar).
 *  - Reconcilia uma tentativa anterior interrompida: rascunho do mesmo fornecedor é ressincronizado
 *    com a seleção atual; rascunho de fornecedor que saiu da seleção é cancelado; pedido que já saiu
 *    de rascunho interrompe com orientação; pedido cancelado não é reaproveitado (nova chave).
 */
export async function generateOrders(ctx: Ctx, id: string, opts: { submit?: boolean; notes?: string | null } = {}) {
  requirePerm(ctx, "purchases", "create");
  await getQuotationForWrite(ctx, id);
  const v = await quotationView(ctx, id);
  if (v.q.ordersCreated) return { orders: v.orders, created: false };
  assert(v.q.status === "open", "Cotação não está aberta.");
  assert(v.evaluation.groups.length > 0, "Selecione os fornecedores antes de gerar pedidos.");
  assert(v.evaluation.unassigned.length === 0, "Há itens sem fornecedor selecionado.");
  assert(v.stale.length === 0, "Há propostas alteradas depois da seleção. Revise a seleção (a versão escolhida mudou).");
  for (const g of v.evaluation.groups) for (const it of g.items) assert(it.available, `${it.description}: ${it.reason ?? "indisponível"} em ${g.supplierName}.`);
  // 1) validação prévia de todos os grupos
  for (const g of v.evaluation.groups) {
    assertSupplierUsable(await companySupplier(ctx, g.supplierId));
    assert(g.items.length <= 90, `${g.supplierName}: limite de 90 produtos por pedido — divida a cotação.`);
  }
  // 2) pedidos deixados por uma tentativa anterior (falha parcial)
  const previous = (await listAll(ctx.store, "purchase_orders", { filters: [["eq", "companyId", ctx.companyId], ["eq", "quotationId", id]], orderBy: [{ field: "number" }] })).filter((o) => o.status !== "cancelled");
  const selected = new Set(v.evaluation.groups.map((g) => g.supplierId));
  const keep = new Map<string, Doc>();
  for (const o of previous) {
    if (selected.has(o.supplierId) && !keep.has(o.supplierId)) {
      if (o.status !== "draft") throw new BusinessError(`O pedido nº ${o.number} desta cotação (${supplierLabel(o.supplierSnapshot)}) já está ${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status}. Cancele-o para gerar os pedidos com a seleção atual.`, "quotation_orders");
      keep.set(o.supplierId, o);
      continue;
    }
    if (o.status !== "draft") throw new BusinessError(`O pedido nº ${o.number} desta cotação (${supplierLabel(o.supplierSnapshot)}) já está ${ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status} e não corresponde à seleção atual. Cancele-o antes de gerar os pedidos.`, "quotation_orders");
    await cancelOrder(ctx, o.id, `Seleção da cotação nº ${v.q.number} alterada antes da geração dos pedidos.`);
  }
  const orders: Doc[] = [];
  for (const g of v.evaluation.groups) {
    const raw = v.rawProposals.find((p) => p.id === g.proposalId)!;
    const proposalRef = { proposalId: g.proposalId, version: g.version, validUntil: g.validUntil, freight: g.freight, minOrderValue: g.minOrderValue, belowMinimum: g.belowMinimum, leadTimeDays: g.leadTimeDays, paymentTermsText: g.paymentTermsText, quotationNumber: v.q.number };
    const input: OrderInput = {
      supplierId: g.supplierId,
      expectedDate: g.deliveryDate ?? addDays(today(), g.leadTimeDays ?? 0),
      items: g.items.map((it) => ({ skuId: it.skuId, qty: it.qty, unitCost: it.unitPrice, discount: it.discount, description: it.description, unitCode: it.unitCode })),
      freight: g.freight,
      paymentTermId: raw.paymentTermId ?? null,
      paymentTermsText: g.paymentTermsText,
      notes: opts.notes ?? `Gerado da cotação nº ${v.q.number}.`,
      origin: "quotation",
      originId: id,
      quotationId: id,
      proposalRef,
    };
    let o: Doc;
    const prev = keep.get(g.supplierId);
    if (prev) {
      // rascunho de tentativa anterior: ressincroniza itens E condições (pagamento, entrega, frete, observações)
      // com a seleção atual — sempre, pois a proposta pode ter mudado só a condição/prazo com o mesmo total
      await updateOrder(ctx, prev.id, input);
      o = await ctx.store.update("purchase_orders", prev.id, { proposalRef });
    } else {
      // chave idempotente por cotação × fornecedor; pedido cancelado com a mesma chave não é reaproveitado
      const base = `quotation:${id}:${g.supplierId}`;
      let key = base;
      for (let k = 1; ; k++) {
        const ex = await ctx.store.get("purchase_orders", detId("po", key));
        if (!ex || ex.status !== "cancelled") break;
        key = `${base}:${k}`;
      }
      o = await createOrder(ctx, { ...input, idemKey: key });
    }
    // conciliação: o pedido gerado deve ter exatamente o total do grupo na revisão
    if (o.total !== g.total) throw new BusinessError(`Divergência de cálculo no pedido de ${g.supplierName}: ${formatMoney(o.total)} ≠ ${formatMoney(g.total)}.`);
    orders.push(o);
  }
  await ctx.store.update("quotations", id, { ordersCreated: true, status: "closed", closedAt: nowIso() });
  await audit(ctx, {
    module: "purchases",
    action: "quotation.orders",
    entityType: "quotation",
    entityId: id,
    summary: `Cotação nº ${v.q.number}: ${orders.length} pedido(s) em rascunho gerado(s) — ${orders.map((o) => `nº ${o.number}`).join(", ")}, total ${formatMoney(v.evaluation.grandTotal)}`,
    related: orders.map((o) => `purchase_order:${o.id}`),
  });
  if (opts.submit) {
    const { submitForApproval } = await import("./approvals");
    await submitForApproval(ctx, orders.map((o) => o.id), { origin: "quotation", quotationId: id, notes: `Cotação nº ${v.q.number}` });
  }
  return { orders, created: true };
}

export async function quotationProposalByPair(store: Store, quotationId: string, supplierId: string) {
  return findOne(store, "quotation_proposals", [["eq", "quotationId", quotationId], ["eq", "supplierId", supplierId]]);
}
