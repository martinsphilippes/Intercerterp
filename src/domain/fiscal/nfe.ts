import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { today } from "@/lib/dates";
import { allocate, roundDiv, QTY } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { onlyDigits } from "@/lib/core/text";
import {
  addEvent,
  assertDocScope,
  buildItems,
  computeTotals,
  createDocument,
  DOC_STATUS_LABEL,
  getFiscalConfig,
  INACTIVE,
  submitDraft,
  validateDocument,
  type DocEffects,
  type DocItem,
  type OperationKind,
} from "./service";

/**
 * Emissão de NF-e (Tela 31): operação → destinatário → produtos → tributação → transporte → pagamento → revisão.
 * Totais e tributos SEMPRE recalculados no servidor (buildItems/computeTotals).
 * Origens (venda, transferência, devolução de venda, pedido de compra) não movimentam estoque/financeiro de novo:
 * os efeitos ficam com a operação de origem. Operação avulsa define os efeitos explicitamente (aplicados uma única
 * vez na autorização, por chaves de idempotência).
 */

export type NfeOriginType = "sale" | "transfer" | "purchase_order" | "return" | "manual";

export interface NfeRecipient {
  partyType: "customer" | "supplier" | "branch" | "other";
  partyId?: string | null;
  name: string;
  doc: string;
  ie?: string | null;
  ieIndicator?: string | null;
  im?: string | null;
  email?: string | null;
  finalConsumer?: boolean;
  address: { zip?: string; street?: string; number?: string; complement?: string; district?: string; cityName?: string; cityCode?: string; uf?: string };
}

export interface NfeItemInput {
  skuId: string;
  qty: number;
  unitPrice: number;
  discount: number;
  description?: string;
  taxGroupId?: string | null;
  cfop?: string | null;
  cstCsosn?: string | null;
}

export interface NfeInput {
  branchId: string;
  origin: { type: NfeOriginType; id?: string | null };
  nature: string;
  purpose: "normal" | "devolucao" | "complementar" | "ajuste";
  operationType: "saida" | "entrada";
  presence: string;
  recipient: NfeRecipient;
  items: NfeItemInput[];
  freight: number;
  insurance: number;
  other: number;
  transport: { mode: string; carrierName?: string; carrierDoc?: string; carrierUf?: string; vehiclePlate?: string; vehicleUf?: string; volumes?: number; species?: string; grossWeightKg?: number; netWeightKg?: number };
  /** data/hora de saída/entrada da mercadoria (opcional; a data de emissão é a da transmissão) */
  exitAt?: string | null;
  payments: Array<{ kind: string; amount: number }>;
  referencedKeys: string[];
  additionalInfo?: string;
  effects: { stock: boolean; financial: boolean; warehouseId?: string | null; dueDate?: string | null; paymentTermId?: string | null };
}

export interface OriginPrefill {
  input: NfeInput;
  /** efeitos já tratados pela operação de origem (opções bloqueadas) */
  effectsLocked: boolean;
  label: string;
  href: string;
  warnings: string[];
  blockers: string[];
  /** documento ATIVO (não cancelado/denegado/inutilizado/descartado) já existente para a operação */
  existingDocId?: string | null;
  /** quantidade de NF-e anteriores da operação já encerradas (canceladas, denegadas, inutilizadas, descartadas) */
  generation: number;
}

function operationKind(input: Pick<NfeInput, "origin" | "operationType" | "purpose">): OperationKind {
  if (input.origin.type === "transfer") return "transfer";
  if (input.origin.type === "return") return "sale_return";
  if (input.origin.type === "purchase_order") return "supplier_return";
  if (input.purpose === "devolucao") return input.operationType === "entrada" ? "sale_return" : "supplier_return";
  return input.operationType === "entrada" ? "purchase" : "sale";
}

/**
 * Referência da NF-e: avulsa pela chave do formulário; de origem, determinística pela operação e pela geração
 * (1ª emissão `nfe-<tipo>-<id>`; após cancelamento/descarte, `nfe-<tipo>-<id>-r<n+1>`) — duplo clique calcula a mesma ref.
 */
export const nfeRefFor = (origin: { type: NfeOriginType; id?: string | null }, idemKey: string, generation = 0) =>
  origin.type !== "manual" && origin.id ? `nfe-${origin.type}-${origin.id}${generation > 0 ? `-r${generation + 1}` : ""}` : `nfe-${idemKey}`;

async function branchRecipient(ctx: Ctx, branchId: string): Promise<NfeRecipient> {
  const b = await ctx.store.getOrThrow("branches", branchId);
  const company = await ctx.store.getOrThrow("companies", b.companyId);
  return {
    partyType: "branch",
    partyId: b.id,
    name: company.name,
    doc: b.cnpj ?? company.cnpj,
    ie: b.ie ?? null,
    ieIndicator: b.ie ? "1" : "9",
    email: b.email ?? null,
    address: { ...(b.address ?? {}), cityCode: b.address?.cityCode ?? b.cityCode, cityName: b.address?.cityName ?? b.cityName, uf: b.address?.uf ?? b.uf },
  };
}

export function partyRecipient(p: Doc, partyType: "customer" | "supplier"): NfeRecipient {
  const a = (p.addresses ?? [])[0] ?? {};
  return {
    partyType,
    partyId: p.id,
    name: p.name,
    doc: p.doc ?? "",
    ie: p.ie ?? null,
    ieIndicator: p.ieIndicator ?? (p.ie && p.ie !== "ISENTO" ? "1" : p.ie === "ISENTO" ? "2" : "9"),
    im: p.im ?? null,
    email: p.email ?? null,
    finalConsumer: partyType === "customer" ? p.finalConsumer ?? p.personType === "PF" : false,
    address: { zip: a.zip, street: a.street, number: a.number, complement: a.complement, district: a.district, cityName: a.cityName, cityCode: a.cityCode, uf: a.uf },
  };
}

const blankInput = (branchId: string): NfeInput => ({
  branchId,
  origin: { type: "manual" },
  nature: "Venda de mercadoria",
  purpose: "normal",
  operationType: "saida",
  presence: "1",
  recipient: { partyType: "customer", name: "", doc: "", address: {} },
  items: [],
  freight: 0,
  insurance: 0,
  other: 0,
  transport: { mode: "9" },
  payments: [],
  referencedKeys: [],
  effects: { stock: false, financial: false },
});

/** A NF-e de uma operação é emitida pela filial da operação (a filial ativa é a emitente). */
async function originBranchBlocker(ctx: Ctx, originBranchId: string | null | undefined, branchId: string, what: string): Promise<string | null> {
  if ((originBranchId ?? null) === branchId) return null;
  const b = originBranchId ? await ctx.store.get("branches", originBranchId) : null;
  return `${what} pertence ${b ? `à filial ${b.name}` : "a outra filial"}: a NF-e deve ser emitida pela filial da operação — selecione-a no topo da tela.`;
}

/** Pré-preenche a NF-e a partir de uma operação existente (sem repetir os efeitos dela). */
export async function loadOrigin(ctx: Ctx, type: NfeOriginType, id: string, branchId: string): Promise<OriginPrefill> {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const nfes = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", type], ["eq", "originId", id], ["eq", "model", "nfe"]] });
  const mine = nfes.filter((d) => d.companyId === ctx.companyId);
  // somente documento ATIVO bloqueia/reaproveita; encerrados (cancelado, denegado, inutilizado, descartado) permitem nova emissão
  const existing = mine.find((d) => !INACTIVE.includes(d.status));
  const prior = mine.filter((d) => INACTIVE.includes(d.status));
  const generation = prior.length;
  const lastCancelled = prior.filter((d) => d.status === "cancelled").sort((a, b) => String(a.cancelledAt ?? "").localeCompare(String(b.cancelledAt ?? ""))).pop();
  if (!existing && lastCancelled) warnings.push(`NF-e anterior nº ${lastCancelled.number ?? "—"} desta operação foi cancelada: esta é uma nova emissão (nova referência e numeração).`);
  const base = blankInput(branchId);
  if (type === "sale") {
    const sale = await ctx.store.getOrThrow("sales", id);
    assert(sale.companyId === ctx.companyId, "Venda de outra empresa.");
    const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", id]], orderBy: [{ field: "seq" }] });
    const pays = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", id]] });
    if (sale.status !== "completed") blockers.push(`Venda nº ${sale.number} está ${sale.status === "cancelled" ? "cancelada" : sale.status}.`);
    const wrongBranch = await originBranchBlocker(ctx, sale.branchId, branchId, `A venda nº ${sale.number}`);
    if (wrongBranch) blockers.push(wrongBranch);
    // uma operação → um documento fiscal ativo: NFC-e da venda em qualquer estado não encerrado bloqueia a NF-e
    const nfces = (await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", id], ["eq", "model", "nfce"]] })).filter((d) => d.companyId === ctx.companyId);
    if (sale.fiscalDocumentId && !nfces.some((d) => d.id === sale.fiscalDocumentId)) {
      const linked = await ctx.store.get("fiscal_documents", sale.fiscalDocumentId);
      if (linked && linked.model === "nfce" && linked.companyId === ctx.companyId) nfces.push(linked);
    }
    for (const n of nfces) {
      if (INACTIVE.includes(n.status)) continue;
      const label = `NFC-e ${n.number ? "nº " + n.number : n.ref}`;
      if (n.status === "authorized") blockers.push(`A venda já possui ${label} autorizada. Cancele a NFC-e dentro do prazo antes de emitir NF-e para a mesma operação.`);
      else if (n.status === "processing" || ((n.attempts ?? 0) > 0 && ["error", "queued", "pending"].includes(n.status)))
        blockers.push(`A venda possui ${label} já enviada ao provedor (${DOC_STATUS_LABEL[n.status]}) que pode estar autorizada. Consulte a situação da NFC-e e cancele-a, se autorizada, antes de emitir NF-e.`);
      else blockers.push(`A venda possui ${label} ${DOC_STATUS_LABEL[n.status].toLowerCase()} (sem autorização). Descarte a NFC-e (Fiscal → NFC-e → Descartar) antes de emitir NF-e para a mesma operação.`);
    }
    const customer = sale.customerId ? await ctx.store.get("customers", sale.customerId) : null;
    if (!customer) warnings.push("Venda sem cliente identificado: informe o destinatário (CPF/CNPJ e endereço são obrigatórios na NF-e).");
    const lines = items.filter((i) => (i.qty ?? 0) - (i.returnedQty ?? 0) > 0);
    if (lines.length < items.length) warnings.push("Itens devolvidos foram desconsiderados.");
    const input: NfeInput = {
      ...base,
      origin: { type, id },
      nature: "Venda de mercadoria",
      presence: "1",
      recipient: customer ? partyRecipient(customer, "customer") : base.recipient,
      items: lines.map((i) => {
        const q = i.qty - (i.returnedQty ?? 0);
        const disc = (i.itemDiscount ?? 0) + (i.globalDiscount ?? 0);
        return { skuId: i.skuId, qty: q, unitPrice: i.unitPrice, discount: q === i.qty ? disc : roundDiv(disc * q, i.qty), description: i.description };
      }),
      other: lines.reduce((a, i) => a + (i.surcharge ?? 0), 0),
      payments: pays.filter((p) => !["cancelled", "refunded"].includes(p.status)).map((p) => ({ kind: p.methodKind, amount: p.amount })),
    };
    return { input, effectsLocked: true, label: `Venda nº ${sale.number}`, href: `/vendas/${id}`, warnings, blockers, existingDocId: existing?.id ?? null, generation };
  }
  if (type === "transfer") {
    const t = await ctx.store.getOrThrow("transfers", id);
    assert(t.companyId === ctx.companyId, "Transferência de outra empresa.");
    if (t.status === "draft" || t.status === "cancelled") warnings.push(`Transferência nº ${t.number} está ${t.status === "draft" ? "em rascunho" : "cancelada"}.`);
    if (t.fromBranchId !== branchId) blockers.push("A NF-e de transferência deve ser emitida pela filial de origem: selecione a filial de origem no topo da tela.");
    // filial de destino validada no servidor: mesma empresa, ativa e diferente da origem
    const dest = t.toBranchId ? await ctx.store.get("branches", t.toBranchId) : null;
    const destOk = Boolean(dest && dest.companyId === ctx.companyId);
    if (!destOk) blockers.push("Filial de destino da transferência não encontrada nesta empresa.");
    else {
      if (dest!.id === t.fromBranchId) blockers.push("Filial de destino igual à filial de origem: não há transferência entre estabelecimentos a documentar.");
      if (dest!.status === "inactive") blockers.push(`Filial de destino ${dest!.name} está inativa.`);
    }
    const items = (t.items ?? []) as Array<{ skuId: string; qty: number; shippedQty?: number; unitCost?: number; name?: string }>;
    const input: NfeInput = {
      ...base,
      branchId,
      origin: { type, id },
      nature: "Transferência de mercadoria entre filiais",
      presence: "9",
      recipient: destOk ? await branchRecipient(ctx, dest!.id) : base.recipient,
      items: await Promise.all(items.map(async (i) => ({ skuId: i.skuId, qty: i.shippedQty || i.qty, unitPrice: i.unitCost ?? (await ctx.store.get("skus", i.skuId))?.costTotal ?? 0, discount: 0, description: i.name }))),
      payments: [{ kind: "none", amount: 0 }],
    };
    return { input, effectsLocked: true, label: `Transferência nº ${t.number}`, href: `/estoque/transferencias/${id}`, warnings, blockers, existingDocId: existing?.id ?? null, generation };
  }
  if (type === "purchase_order") {
    const po = await ctx.store.getOrThrow("purchase_orders", id);
    assert(po.companyId === ctx.companyId, "Pedido de outra empresa.");
    const supplier = await ctx.store.getOrThrow("suppliers", po.supplierId);
    const wrongBranch = await originBranchBlocker(ctx, po.branchId, branchId, `O pedido de compra nº ${po.number}`);
    if (wrongBranch) blockers.push(wrongBranch);
    // depósito padrão dos efeitos: o do pedido (se for da filial emitente); senão, o padrão da filial na autorização
    const poWarehouse = po.warehouseId ? await ctx.store.get("warehouses", po.warehouseId) : null;
    const items = await listAll(ctx.store, "purchase_order_items", { filters: [["eq", "orderId", id]], orderBy: [{ field: "seq" }] });
    const received = items.filter((i) => (i.receivedQty ?? 0) > 0);
    if (!received.length) warnings.push("Nenhum item recebido neste pedido: ajuste as quantidades a devolver.");
    const receipts = await listAll(ctx.store, "receipts", { filters: [["eq", "companyId", ctx.companyId], ["contains", "orderIds", id]] }).catch(() => []);
    const keys = receipts.map((r) => onlyDigits(r.nfeKey)).filter((k) => k.length === 44);
    if (!keys.length) warnings.push("Chave da NF-e de compra não encontrada nos recebimentos: informe a chave referenciada.");
    const input: NfeInput = {
      ...base,
      origin: { type, id },
      nature: "Devolução de mercadoria ao fornecedor",
      purpose: "devolucao",
      operationType: "saida",
      presence: "9",
      recipient: partyRecipient(supplier, "supplier"),
      items: (received.length ? received : items).map((i) => ({ skuId: i.skuId, qty: i.receivedQty || i.qty, unitPrice: i.unitCost, discount: 0, description: i.description })),
      payments: [{ kind: "none", amount: 0 }],
      referencedKeys: [...new Set(keys)],
      effects: { stock: true, financial: false, warehouseId: poWarehouse && poWarehouse.companyId === ctx.companyId && poWarehouse.branchId === branchId ? poWarehouse.id : null },
    };
    warnings.push("Devolução a fornecedor: a baixa de estoque é aplicada por este documento na autorização (marque/desmarque abaixo). Abatimento financeiro deve ser tratado em Contas a pagar.");
    return { input, effectsLocked: false, label: `Pedido de compra nº ${po.number}`, href: `/compras/pedidos/${id}`, warnings, blockers, existingDocId: existing?.id ?? null, generation };
  }
  if (type === "return") {
    const ret = await ctx.store.getOrThrow("returns", id);
    assert(ret.companyId === ctx.companyId, "Devolução de outra empresa.");
    const sale = await ctx.store.getOrThrow("sales", ret.saleId);
    const wrongBranch = await originBranchBlocker(ctx, ret.branchId ?? sale.branchId, branchId, `A devolução nº ${ret.number ?? ""}`.trim());
    if (wrongBranch) blockers.push(wrongBranch);
    const ritems = await listAll(ctx.store, "return_items", { filters: [["eq", "returnId", id]] });
    const original = sale.fiscalDocumentId ? await ctx.store.get("fiscal_documents", sale.fiscalDocumentId) : null;
    if (!original || original.status !== "authorized") warnings.push("A venda não tem documento fiscal autorizado para referenciar: informe a chave referenciada manualmente.");
    const customer = sale.customerId ? await ctx.store.get("customers", sale.customerId) : null;
    const existingRet = ret.fiscalDocumentId ? await ctx.store.get("fiscal_documents", ret.fiscalDocumentId) : null;
    const input: NfeInput = {
      ...base,
      origin: { type, id },
      nature: "Devolução de venda",
      purpose: "devolucao",
      operationType: "entrada",
      presence: "1",
      recipient: customer ? partyRecipient(customer, "customer") : base.recipient,
      items: ritems.map((r) => ({ skuId: r.skuId, qty: r.qty, unitPrice: r.unitPrice, discount: Math.max(0, roundDiv(r.unitPrice * r.qty, QTY) - r.total) })),
      payments: [{ kind: "none", amount: 0 }],
      referencedKeys: original?.accessKey ? [original.accessKey] : [],
    };
    return { input, effectsLocked: true, label: `Devolução nº ${ret.number ?? ""} (venda nº ${sale.number})`, href: `/vendas/devolucoes/${id}`, warnings, blockers, existingDocId: (existingRet && existingRet.companyId === ctx.companyId && !INACTIVE.includes(existingRet.status) ? existingRet.id : existing?.id) ?? null, generation };
  }
  throw new BusinessError("Origem não suportada.");
}

/** Monta o documento (itens, totais, pendências) a partir da entrada — cálculo no servidor, sem gravar. */
export async function buildNfe(ctx: Ctx, input: NfeInput) {
  assert(input.items.length > 0, "Inclua ao menos um item.");
  for (const it of input.items) assert(it.qty > 0, "Quantidade deve ser maior que zero.");
  const branch = await ctx.store.getOrThrow("branches", input.branchId);
  assert(branch.companyId === ctx.companyId, "Filial emitente de outra empresa.");
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const emitUf = branch.uf ?? branch.address?.uf ?? company.address?.uf;
  const interstate = Boolean(input.recipient.address?.uf && emitUf && input.recipient.address.uf !== emitUf);
  const kind = operationKind(input);
  const items = await buildItems(
    ctx,
    input.items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount ?? 0, description: i.description, taxGroupId: i.taxGroupId || null, cfopOverride: i.cfop || undefined, cstOverride: i.cstCsosn || undefined })),
    { branchId: input.branchId, interstate, freight: input.freight, insurance: input.insurance, other: input.other, kind },
  );
  const totals = computeTotals(items, { insurance: input.insurance });
  let payments = input.payments.filter((p) => p.kind === "none" || p.amount > 0);
  if (!payments.length) payments = [{ kind: "none", amount: 0 }];
  const draft = {
    model: "nfe",
    operationType: input.operationType,
    purpose: input.purpose,
    recipient: { ...input.recipient, doc: onlyDigits(input.recipient.doc) },
    items,
    totals,
    payments,
    service: { referencedKeys: input.referencedKeys.map(onlyDigits).filter(Boolean), additionalInfo: input.additionalInfo || null },
  } as unknown as Doc;
  const issues = validateDocument(draft, company, branch);
  // alertas (não impedem a transmissão)
  const warnings: string[] = [];
  const tr = input.transport ?? { mode: "9" };
  if (String(tr.mode) !== "9" && !tr.carrierName && !["3", "4"].includes(String(tr.mode))) warnings.push("Transporte: transportador não informado para a modalidade de frete escolhida.");
  if (["0", "1", "2"].includes(String(tr.mode)) && tr.carrierName && !tr.vehiclePlate) warnings.push("Transporte incompleto: placa do veículo não informada.");
  if (input.recipient.finalConsumer && input.recipient.ie && input.recipient.ie !== "ISENTO") warnings.push("Destinatário com IE marcado como consumidor final — confirme a operação.");
  if (!input.recipient.email) warnings.push("Destinatário sem e-mail: o XML não será enviado automaticamente.");
  const checks = {
    recipient: !issues.some((i) => /destinat/i.test(i)),
    products: !issues.some((i) => /^Item|sem itens|grupo/i.test(i)),
    totals: !issues.some((i) => /Pagamentos|total/i.test(i)),
    transport: !warnings.some((w) => /Transporte/i.test(w)),
    issuer: !issues.some((i) => /emitente/i.test(i)),
  };
  return { items, totals, payments, interstate, kind, issues, warnings, checks };
}

function effectsFor(input: NfeInput, locked: boolean): DocEffects | null {
  if (locked) return { stock: false, financial: false, note: "Efeitos tratados pela operação de origem." };
  if (!input.effects.stock && !input.effects.financial) return { stock: false, financial: false, note: "Somente documento (sem efeitos de estoque/financeiro)." };
  return {
    stock: input.effects.stock,
    financial: input.origin.type === "manual" ? input.effects.financial : false,
    warehouseId: input.effects.warehouseId || null,
    dueDate: input.effects.dueDate || today(),
    paymentTermId: input.effects.paymentTermId || null,
  };
}

const lockedOrigins = (t: NfeOriginType) => ["sale", "transfer", "return"].includes(t);

/** Cria (ou atualiza o rascunho) da NF-e; com `transmit`, envia em seguida. Idempotente pela chave do formulário/origem. */
export async function saveNfe(ctx: Ctx, input: NfeInput, opts: { idemKey: string; draftId?: string | null; transmit: boolean }) {
  requireAction(ctx, "fiscal.issue");
  // emitente = filial ativa (o identificador vindo do formulário nunca escolhe outra filial/empresa)
  assert(input.branchId === requireBranch(ctx), "A NF-e deve ser emitida pela filial ativa: selecione a filial no topo da tela.", "branch_mismatch");
  let generation = 0;
  if (input.origin.type !== "manual") {
    assert(input.origin.id, "Origem sem identificador.");
    const pre = await loadOrigin(ctx, input.origin.type, input.origin.id!, input.branchId);
    if (pre.blockers.length) throw new BusinessError(pre.blockers.join(" "));
    generation = pre.generation;
    // transferência: destinatário é sempre a filial de destino da própria transferência (não o enviado pelo formulário)
    if (input.origin.type === "transfer") input = { ...input, recipient: pre.input.recipient };
    if (pre.existingDocId && pre.existingDocId !== opts.draftId) {
      const ex = await ctx.store.getOrThrow("fiscal_documents", pre.existingDocId);
      if (!["draft", "pending", "rejected"].includes(ex.status)) throw new BusinessError(`Já existe NF-e para esta operação (${DOC_STATUS_LABEL[ex.status]}).`, "duplicate_origin");
      opts = { ...opts, draftId: ex.id };
    }
  }
  const locked = lockedOrigins(input.origin.type);
  // depósito dos efeitos de estoque: sempre da filial emitente (nunca movimenta estoque de outra filial)
  if (!locked && input.effects?.stock && input.effects.warehouseId) {
    const wh = await ctx.store.get("warehouses", input.effects.warehouseId);
    assert(wh && wh.companyId === ctx.companyId && wh.branchId === input.branchId, "O depósito dos efeitos de estoque deve ser da filial emitente.", "branch_mismatch");
  }
  const built = await buildNfe(ctx, input);
  const effects = effectsFor(input, locked);
  const transport = { ...input.transport, mode: input.transport.mode ?? "9" };
  const common = {
    nature: input.nature.trim() || "Venda de mercadoria",
    purpose: input.purpose,
    operationType: input.operationType,
    presence: input.presence,
    recipient: { ...input.recipient, doc: onlyDigits(input.recipient.doc) },
    partyType: input.recipient.partyType === "branch" ? "branch" : input.recipient.partyType,
    partyId: input.recipient.partyId ?? null,
    items: built.items,
    totals: built.totals,
    payments: built.payments,
    transport,
    service: { referencedKeys: input.referencedKeys.map(onlyDigits).filter(Boolean), additionalInfo: input.additionalInfo?.trim() || null },
    effects,
    exitAt: input.exitAt || null,
    total: built.totals.total,
  };
  let doc: Doc;
  if (opts.draftId) {
    const cur = await ctx.store.getOrThrow("fiscal_documents", opts.draftId);
    assert(cur.companyId === ctx.companyId && cur.model === "nfe", "NF-e não encontrada.");
    assertDocScope(ctx, cur);
    assert((cur.originType ?? "manual") === input.origin.type && (cur.originId ?? null) === (input.origin.id ?? null), "O rascunho pertence a outra operação de origem.");
    assert(["draft", "pending", "rejected"].includes(cur.status), `NF-e ${DOC_STATUS_LABEL[cur.status]} não pode ser alterada.`);
    if (cur.effects?.appliedAt) throw new BusinessError("Efeitos já aplicados: documento não pode ser alterado.");
    doc = await ctx.store.update("fiscal_documents", cur.id, { ...common, recipientName: common.recipient.name || null, recipientDoc: common.recipient.doc || null });
    await addEvent(ctx, cur.id, "edit", cur.status, `Dados ${cur.status === "rejected" ? "corrigidos" : "alterados"} por ${ctx.user.name} (mesma referência ${cur.ref})`);
    await audit(ctx, { module: "fiscal", action: "nfe.edit", entityType: "fiscal_document", entityId: cur.id, summary: `NF-e ${cur.number ? "nº " + cur.number : cur.ref} alterada (${DOC_STATUS_LABEL[cur.status]})`, branchId: cur.branchId });
  } else {
    const ref = nfeRefFor(input.origin, opts.idemKey, generation);
    const prev = await ctx.store.get("fiscal_documents", detId("fiscaldoc", ref));
    if (prev && INACTIVE.includes(prev.status)) throw new BusinessError(`A referência ${ref} já pertence a um documento ${DOC_STATUS_LABEL[prev.status].toLowerCase()}. Atualize a página e emita novamente.`, "duplicate_origin");
    doc = await createDocument(ctx, {
      model: "nfe",
      ref,
      branchId: input.branchId,
      originType: input.origin.type,
      originId: input.origin.id ?? null,
      operationId: input.origin.id ?? null,
      ...common,
      status: "draft",
    });
  }
  if (opts.transmit) return submitDraft(ctx, doc.id);
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

/**
 * Correção a partir do cadastro: relê NCM/CEST/origem/grupo tributário dos produtos (mantendo quantidades,
 * preços, descontos e CFOP/CST definidos manualmente) — usada após corrigir o cadastro de um item rejeitado.
 */
export async function refreshFromCatalog(ctx: Ctx, documentId: string) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assertDocScope(ctx, doc);
  assert(doc.model !== "nfse", "NFS-e: edite os dados do serviço.");
  assert(["draft", "pending", "rejected"].includes(doc.status), `Documento ${DOC_STATUS_LABEL[doc.status]} não pode ser atualizado.`);
  const old = (doc.items ?? []) as DocItem[];
  const branch = await ctx.store.getOrThrow("branches", doc.branchId);
  const emitUf = branch.uf ?? branch.address?.uf;
  const interstate = Boolean(doc.recipient?.address?.uf && emitUf && doc.recipient.address.uf !== emitUf);
  const kind = operationKind({ origin: { type: (doc.originType as NfeOriginType) ?? "manual" }, operationType: doc.operationType, purpose: doc.purpose });
  const freight = old.reduce((a, i) => a + i.freight, 0);
  const insurance = old.reduce((a, i) => a + (i.insurance ?? 0), 0);
  const other = old.reduce((a, i) => a + i.other, 0);
  const items = await buildItems(
    ctx,
    old.filter((i) => i.skuId).map((i) => ({ skuId: i.skuId!, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount, description: i.description, taxGroupId: i.overrides?.taxGroupId ?? null, cfopOverride: i.overrides?.cfop, cstOverride: i.overrides?.cstCsosn })),
    { branchId: doc.branchId, interstate, freight, insurance, other, kind: doc.model === "nfce" ? "sale" : kind },
  );
  const totals = computeTotals(items, { insurance });
  const changes = items
    .map((n, idx) => {
      const o = old[idx];
      const diffs = (["ncm", "cfop", "cstCsosn", "cest"] as const).filter((k) => (o?.[k] ?? "") !== (n[k] ?? "")).map((k) => `${k.toUpperCase()} ${o?.[k] || "∅"}→${n[k] || "∅"}`);
      return diffs.length ? `Item ${n.seq}: ${diffs.join(", ")}` : null;
    })
    .filter(Boolean) as string[];
  let payments = doc.payments;
  if (totals.total !== doc.totals?.total && (payments ?? []).length && !payments.some((p: any) => p.kind === "none")) {
    const alloc = allocate(totals.total, payments.map((p: any) => p.amount));
    payments = payments.map((p: any, i: number) => ({ ...p, amount: alloc[i] }));
  }
  const updated = await ctx.store.update("fiscal_documents", doc.id, { items, totals, payments, total: totals.total, statusMessage: changes.length ? `Atualizado do cadastro: ${changes.join("; ")}` : doc.statusMessage });
  await addEvent(ctx, doc.id, "refresh", doc.status, changes.length ? `Dados fiscais atualizados do cadastro: ${changes.join("; ")}` : "Dados fiscais conferidos com o cadastro (sem alterações).");
  await audit(ctx, { module: "fiscal", action: "document.refresh", entityType: "fiscal_document", entityId: doc.id, summary: `${doc.model.toUpperCase()} ${doc.number ? "nº " + doc.number : doc.ref}: dados fiscais atualizados do cadastro (${changes.length} alteração(ões))`, branchId: doc.branchId });
  return { doc: updated, changes };
}

/** Pendências atuais do documento (para exibição antes de retransmitir). */
export async function currentIssues(ctx: Ctx, doc: Doc) {
  const company = await ctx.store.getOrThrow("companies", doc.companyId);
  const branch = doc.branchId ? await ctx.store.get("branches", doc.branchId) : null;
  const issues = validateDocument(doc, company, branch);
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, doc.branchId);
  if (!cfg) issues.unshift("Configuração fiscal não cadastrada.");
  return issues;
}

/** Converte um documento salvo de volta para a entrada do formulário (edição de rascunho/correção). */
export function docToInput(doc: Doc): NfeInput {
  const items = (doc.items ?? []) as DocItem[];
  return {
    branchId: doc.branchId,
    origin: { type: (doc.originType as NfeOriginType) ?? "manual", id: doc.originId ?? null },
    nature: doc.nature ?? "",
    purpose: doc.purpose ?? "normal",
    operationType: doc.operationType ?? "saida",
    presence: doc.presence ?? "1",
    recipient: { partyType: doc.partyType ?? doc.recipient?.partyType ?? "other", partyId: doc.partyId ?? null, name: doc.recipient?.name ?? "", doc: doc.recipient?.doc ?? "", ie: doc.recipient?.ie, ieIndicator: doc.recipient?.ieIndicator, email: doc.recipient?.email, finalConsumer: doc.recipient?.finalConsumer, address: doc.recipient?.address ?? {} },
    items: items.filter((i) => i.skuId).map((i) => ({ skuId: i.skuId!, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount, description: i.description, taxGroupId: i.overrides?.taxGroupId ?? null, cfop: i.overrides?.cfop ?? null, cstCsosn: i.overrides?.cstCsosn ?? null })),
    freight: items.reduce((a, i) => a + i.freight, 0),
    insurance: items.reduce((a, i) => a + (i.insurance ?? 0), 0),
    other: items.reduce((a, i) => a + i.other, 0),
    transport: { ...(doc.transport ?? {}), mode: String(doc.transport?.mode ?? "9") },
    exitAt: doc.exitAt ?? null,
    payments: doc.payments ?? [],
    referencedKeys: doc.service?.referencedKeys ?? [],
    additionalInfo: doc.service?.additionalInfo ?? "",
    effects: { stock: Boolean(doc.effects?.stock), financial: Boolean(doc.effects?.financial), warehouseId: doc.effects?.warehouseId ?? null, dueDate: doc.effects?.dueDate ?? null, paymentTermId: doc.effects?.paymentTermId ?? null },
  };
}
