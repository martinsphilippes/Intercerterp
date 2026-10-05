import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso, today, toLocalDate } from "@/lib/dates";
import { pct, roundDiv, QTY, allocate } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { enqueue, registerJob } from "@/lib/core/jobs";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { saveFile } from "@/lib/core/files";
import { onlyDigits } from "@/lib/core/text";
import { fiscalProviderFrom, TPAG, type FiscalModel, type ProviderResult } from "./providers";
import { logIntegration } from "../integrations";

/**
 * Documentos fiscais (Telas 30–35).
 * Estados: draft → queued → processing → authorized | rejected | denied | error ; authorized → cancelled.
 * "pending" = aguardando cadastro/configuração (não transmitido). Nenhum estado é presumido:
 * só "authorized" com retorno do provedor; documentos de simulação ficam marcados (isSimulated).
 */

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  pending: "Pendente de configuração",
  queued: "Na fila de envio",
  processing: "Processando",
  authorized: "Autorizado",
  rejected: "Rejeitado",
  denied: "Denegado",
  cancelled: "Cancelado",
  error: "Erro de comunicação",
  unused: "Inutilizado",
  discarded: "Descartado (não transmitido)",
};

export const MODEL_LABEL: Record<string, string> = { nfe: "NF-e", nfce: "NFC-e", nfse: "NFS-e" };

const fiscalScope = (companyId: string, branchId: string | null) => `${companyId}|${branchId ?? "*"}`;

export async function getFiscalConfig(store: Store, companyId: string, branchId: string | null): Promise<Doc | null> {
  if (branchId) {
    const b = await store.get("fiscal_configs", detId("fiscalcfg", fiscalScope(companyId, branchId)));
    if (b) return b;
  }
  return store.get("fiscal_configs", detId("fiscalcfg", fiscalScope(companyId, null)));
}

export async function saveFiscalConfig(ctx: Ctx, branchId: string | null, data: Record<string, any>) {
  requireAction(ctx, "fiscal.configure");
  const sk = fiscalScope(ctx.companyId, branchId);
  const id = detId("fiscalcfg", sk);
  const before = await ctx.store.get("fiscal_configs", id);
  const patch = { ...data, companyId: ctx.companyId, branchId, scopeKey: sk };
  let doc: Doc;
  if (before) doc = await ctx.store.update("fiscal_configs", id, { ...patch, connectionStatus: before.provider !== data.provider || before.environment !== data.environment ? "configured_untested" : before.connectionStatus });
  else {
    try {
      doc = await ctx.store.create("fiscal_configs", { ...patch, connectionStatus: "configured_untested", createdBy: ctx.user.id }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await ctx.store.update("fiscal_configs", id, patch);
    }
  }
  await audit(ctx, { module: "fiscal", action: "config.save", entityType: "fiscal_config", entityId: id, summary: "Configuração fiscal atualizada", before, after: doc });
  return doc;
}

export async function testFiscalConnection(ctx: Ctx, branchId: string | null) {
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, branchId);
  assert(cfg, "Configuração fiscal não cadastrada.");
  const provider = fiscalProviderFrom(cfg);
  let result: { ok: boolean; message: string };
  if (!provider) result = { ok: false, message: `Credencial ausente: defina a variável de ambiente ${cfg.tokenRef || "FOCUSNFE_TOKEN"} no servidor.` };
  else {
    try {
      const branch = branchId ? await ctx.store.get("branches", branchId) : null;
      result = await provider.test(onlyDigits(branch?.cnpj));
    } catch (e: any) {
      result = { ok: false, message: `Falha de conexão: ${e.message}` };
    }
  }
  const status = result.ok ? (provider?.simulated ? "simulated" : "operational") : provider ? "error" : "not_configured";
  await ctx.store.update("fiscal_configs", cfg.id, { lastTestAt: nowIso(), lastTestResult: result.message, connectionStatus: status });
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId, kind: "fiscal_nfe", action: "test", status: result.ok ? "success" : "failure", message: result.message });
  return { ...result, status };
}

// ───────────────────────────── Montagem

interface TaxInfo {
  cfop: string;
  cstCsosn: string;
  icmsRateBps: number;
  pisCst: string;
  pisRateBps: number;
  cofinsCst: string;
  cofinsRateBps: number;
}

async function taxFor(store: Store, product: Doc, company: Doc, interstate: boolean, cfg: Doc | null): Promise<TaxInfo> {
  const groupId = product.taxGroupId ?? cfg?.defaultTaxGroupId;
  const g = groupId ? await store.get("tax_groups", groupId) : null;
  const simples = ["simples", "mei"].includes(company.regime);
  return {
    cfop: product.cfop || (interstate ? g?.cfopInterstate : g?.cfopInternal) || "",
    cstCsosn: product.cstCsosn || g?.cstCsosn || "",
    icmsRateBps: g?.icmsRateBps ?? 0,
    pisCst: g?.pisCst || (simples ? "49" : "01"),
    pisRateBps: g?.pisRateBps ?? 0,
    cofinsCst: g?.cofinsCst || (simples ? "49" : "01"),
    cofinsRateBps: g?.cofinsRateBps ?? 0,
  };
}

export interface DocItem {
  seq: number;
  skuId?: string | null;
  productId?: string | null;
  code: string;
  description: string;
  ncm: string;
  cest?: string | null;
  cfop: string;
  unit: string;
  qty: number;
  unitPrice: number;
  gross: number;
  discount: number;
  freight: number;
  other: number;
  total: number;
  origin: string;
  cstCsosn: string;
  icmsRateBps: number;
  icmsBase: number;
  icms: number;
  pisCst: string;
  pis: number;
  cofinsCst: string;
  cofins: number;
}

export function computeTotals(items: DocItem[], extra: { freight?: number; insurance?: number; other?: number } = {}) {
  const products = items.reduce((a, i) => a + i.gross, 0);
  const discount = items.reduce((a, i) => a + i.discount, 0);
  const freight = items.reduce((a, i) => a + i.freight, 0);
  const other = items.reduce((a, i) => a + i.other, 0);
  return {
    products,
    discount,
    freight,
    insurance: extra.insurance ?? 0,
    other,
    icmsBase: items.reduce((a, i) => a + i.icmsBase, 0),
    icms: items.reduce((a, i) => a + i.icms, 0),
    pis: items.reduce((a, i) => a + i.pis, 0),
    cofins: items.reduce((a, i) => a + i.cofins, 0),
    total: products - discount + freight + (extra.insurance ?? 0) + other,
  };
}

/** Constrói itens fiscais a partir de linhas (venda, pedido ou formulário). Frete/outras despesas rateados. */
export async function buildItems(
  ctx: Ctx,
  lines: Array<{ skuId: string; qty: number; unitPrice: number; discount: number; description?: string; cfopOverride?: string }>,
  opts: { interstate?: boolean; freight?: number; other?: number; branchId: string | null },
): Promise<DocItem[]> {
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, opts.branchId);
  const grossList = lines.map((l) => roundDiv(l.unitPrice * l.qty, QTY));
  const freightAlloc = allocate(opts.freight ?? 0, grossList);
  const otherAlloc = allocate(opts.other ?? 0, grossList);
  const out: DocItem[] = [];
  for (const [idx, l] of lines.entries()) {
    const sku = await ctx.store.getOrThrow("skus", l.skuId);
    const product = await ctx.store.getOrThrow("products", sku.productId);
    const tax = await taxFor(ctx.store, product, company, Boolean(opts.interstate), cfg);
    const gross = grossList[idx];
    const net = gross - l.discount + freightAlloc[idx] + otherAlloc[idx];
    const normal = !["simples", "mei"].includes(company.regime) && ["00", "20"].includes(tax.cstCsosn);
    const icmsBase = normal ? net : 0;
    out.push({
      seq: idx + 1,
      skuId: sku.id,
      productId: product.id,
      code: sku.sku,
      description: (l.description ?? sku.name ?? product.name).slice(0, 120),
      ncm: onlyDigits(product.ncm),
      cest: product.cest ?? null,
      cfop: l.cfopOverride ?? tax.cfop,
      unit: sku.unitCode ?? product.unitCode ?? "UN",
      qty: l.qty,
      unitPrice: l.unitPrice,
      gross,
      discount: l.discount,
      freight: freightAlloc[idx],
      other: otherAlloc[idx],
      total: net,
      origin: product.origin ?? "0",
      cstCsosn: tax.cstCsosn,
      icmsRateBps: tax.icmsRateBps,
      icmsBase,
      icms: normal ? pct(icmsBase, tax.icmsRateBps) : 0,
      pisCst: tax.pisCst,
      pis: tax.pisRateBps ? pct(net, tax.pisRateBps) : 0,
      cofinsCst: tax.cofinsCst,
      cofins: tax.cofinsRateBps ? pct(net, tax.cofinsRateBps) : 0,
    });
  }
  return out;
}

/** Pendências de cadastro que impedem a transmissão (verificadas antes de enviar). */
export function validateDocument(doc: Doc, company: Doc, branch: Doc | null): string[] {
  const issues: string[] = [];
  if (!onlyDigits(branch?.cnpj ?? company.cnpj)) issues.push("CNPJ do emitente não cadastrado.");
  if (doc.model !== "nfse") {
    if (!branch?.ie && !company.ie) issues.push("Inscrição estadual do emitente não cadastrada.");
    for (const it of doc.items ?? []) {
      if (!/^\d{8}$/.test(it.ncm ?? "")) issues.push(`Item ${it.seq} (${it.code}): NCM ausente ou inválido.`);
      if (!/^\d{4}$/.test(it.cfop ?? "")) issues.push(`Item ${it.seq} (${it.code}): CFOP ausente.`);
      if (!it.cstCsosn) issues.push(`Item ${it.seq} (${it.code}): CST/CSOSN ausente.`);
    }
    if (doc.model === "nfe" && !doc.recipient?.doc) issues.push("Destinatário sem CPF/CNPJ.");
  } else {
    if (!doc.service?.serviceListItem) issues.push("Item da lista de serviços não informado.");
    if (!branch?.im && !company.im) issues.push("Inscrição municipal do prestador não cadastrada.");
  }
  return issues;
}

const money = (c: number) => Number((c / 100).toFixed(2));
const qtyNum = (m: number) => Number((m / QTY).toFixed(4));

/** Converte o documento interno para o payload da Focus NFe. */
export function toProviderPayload(doc: Doc, company: Doc, branch: Doc | null, cfg: Doc | null): Record<string, any> {
  const emitCnpj = onlyDigits(branch?.cnpj ?? company.cnpj);
  if (doc.model === "nfse") {
    const s = doc.service;
    const r = doc.recipient ?? {};
    const rdoc = onlyDigits(r.doc);
    return {
      data_emissao: doc.issuedAt ?? nowIso(),
      natureza_operacao: s.nature ?? "1",
      prestador: { cnpj: emitCnpj, inscricao_municipal: branch?.im ?? company.im, codigo_municipio: branch?.cityCode },
      tomador: {
        ...(rdoc.length === 14 ? { cnpj: rdoc } : rdoc ? { cpf: rdoc } : {}),
        razao_social: r.name,
        email: r.email,
        inscricao_municipal: r.im,
        endereco: r.address ? { logradouro: r.address.street, numero: r.address.number, bairro: r.address.district, codigo_municipio: r.address.cityCode, uf: r.address.uf, cep: onlyDigits(r.address.zip) } : undefined,
      },
      servico: {
        aliquota: s.issRateBps / 100,
        discriminacao: s.description,
        iss_retido: Boolean(s.issWithheld),
        item_lista_servico: s.serviceListItem,
        codigo_tributario_municipio: s.municipalCode,
        codigo_municipio: s.serviceCityCode ?? branch?.cityCode,
        exigibilidade_iss: s.issExigibility ?? "1",
        valor_servicos: money(s.amount),
        desconto_incondicionado: money(s.unconditionalDiscount ?? 0),
        valor_deducoes: money(s.deductions ?? 0),
        valor_iss: money(s.iss),
        valor_pis: money(s.pis ?? 0),
        valor_cofins: money(s.cofins ?? 0),
        valor_inss: money(s.inss ?? 0),
        valor_ir: money(s.ir ?? 0),
        valor_csll: money(s.csll ?? 0),
      },
    };
  }
  const r = doc.recipient ?? null;
  const rdoc = onlyDigits(r?.doc);
  const t = doc.totals;
  const payload: Record<string, any> = {
    natureza_operacao: doc.nature ?? "Venda de mercadoria",
    data_emissao: doc.issuedAt ?? nowIso(),
    tipo_documento: doc.operationType === "entrada" ? 0 : 1,
    finalidade_emissao: { normal: 1, complementar: 2, ajuste: 3, devolucao: 4 }[doc.purpose as string] ?? 1,
    cnpj_emitente: emitCnpj,
    presenca_comprador: doc.model === "nfce" ? 1 : Number(cfg?.defaultPresence ?? 1),
    consumidor_final: doc.model === "nfce" || !r?.ie ? 1 : 0,
    modalidade_frete: doc.transport?.mode ?? 9,
    valor_frete: money(t.freight),
    valor_seguro: money(t.insurance ?? 0),
    valor_outras_despesas: money(t.other ?? 0),
    valor_desconto: money(t.discount),
    valor_produtos: money(t.products),
    valor_total: money(t.total),
    items: (doc.items as DocItem[]).map((i) => ({
      numero_item: i.seq,
      codigo_produto: i.code,
      descricao: i.description,
      cfop: i.cfop,
      codigo_ncm: i.ncm,
      cest: i.cest || undefined,
      unidade_comercial: i.unit,
      quantidade_comercial: qtyNum(i.qty),
      valor_unitario_comercial: money(i.unitPrice),
      unidade_tributavel: i.unit,
      quantidade_tributavel: qtyNum(i.qty),
      valor_unitario_tributavel: money(i.unitPrice),
      valor_bruto: money(i.gross),
      valor_desconto: i.discount ? money(i.discount) : undefined,
      valor_frete: i.freight ? money(i.freight) : undefined,
      valor_outras_despesas: i.other ? money(i.other) : undefined,
      icms_origem: Number(i.origin ?? 0),
      icms_situacao_tributaria: i.cstCsosn,
      icms_base_calculo: i.icmsBase ? money(i.icmsBase) : undefined,
      icms_aliquota: i.icmsBase ? i.icmsRateBps / 100 : undefined,
      icms_valor: i.icms ? money(i.icms) : undefined,
      pis_situacao_tributaria: i.pisCst,
      cofins_situacao_tributaria: i.cofinsCst,
      inclui_no_total: 1,
    })),
    formas_pagamento: (doc.payments ?? []).map((p: any) => ({ forma_pagamento: TPAG[p.kind] ?? "99", valor_pagamento: money(p.amount) })),
  };
  if (r) {
    if (rdoc.length === 14) payload.cnpj_destinatario = rdoc;
    else if (rdoc) payload.cpf_destinatario = rdoc;
    payload.nome_destinatario = r.name;
    if (doc.model === "nfe") {
      payload.indicador_inscricao_estadual_destinatario = r.ieIndicator ?? (r.ie ? 1 : 9);
      if (r.ie) payload.inscricao_estadual_destinatario = r.ie;
      if (r.address) {
        payload.logradouro_destinatario = r.address.street;
        payload.numero_destinatario = r.address.number || "S/N";
        payload.bairro_destinatario = r.address.district;
        payload.municipio_destinatario = r.address.cityName;
        payload.uf_destinatario = r.address.uf;
        payload.cep_destinatario = onlyDigits(r.address.zip);
        payload.codigo_municipio_destinatario = r.address.cityCode;
      }
      if (r.email) payload.email_destinatario = r.email;
    }
  }
  if (doc.transport?.carrierName) {
    payload.nome_transportador = doc.transport.carrierName;
    const cd = onlyDigits(doc.transport.carrierDoc);
    if (cd.length === 14) payload.cnpj_transportador = cd;
    else if (cd) payload.cpf_transportador = cd;
  }
  if (doc.transport?.volumes) payload.volumes = [{ quantidade: doc.transport.volumes, peso_bruto: doc.transport.grossWeightKg, peso_liquido: doc.transport.netWeightKg, especie: doc.transport.species }];
  if (doc.service?.referencedKeys?.length) payload.notas_referenciadas = doc.service.referencedKeys.map((k: string) => ({ chave_nfe: k }));
  if (doc.service?.additionalInfo) payload.informacoes_adicionais_contribuinte = doc.service.additionalInfo;
  if (doc.series) payload.serie = doc.series;
  return payload;
}

// ───────────────────────────── Criação

export interface CreateDocInput {
  model: FiscalModel;
  ref: string;
  branchId: string;
  originType: string;
  originId?: string | null;
  operationId?: string | null;
  nature?: string;
  purpose?: "normal" | "devolucao" | "complementar" | "ajuste";
  operationType?: "saida" | "entrada";
  recipient?: Record<string, any> | null;
  items?: DocItem[];
  totals?: ReturnType<typeof computeTotals>;
  payments?: Array<{ kind: string; amount: number }>;
  transport?: Record<string, any> | null;
  service?: Record<string, any> | null;
  terminalId?: string | null;
  status?: "draft" | "queued";
  total: number;
}

export async function createDocument(ctx: Ctx, input: CreateDocInput) {
  const id = detId("fiscaldoc", input.ref);
  const existing = await ctx.store.get("fiscal_documents", id);
  if (existing) return existing;
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, input.branchId);
  const provider = fiscalProviderFrom(cfg);
  const enabled = input.model === "nfse" ? cfg?.nfseEnabled : input.model === "nfce" ? cfg?.nfceEnabled : cfg?.nfeEnabled;
  let status: string = input.status ?? "queued";
  let statusMessage: string | null = null;
  if (!cfg || !provider || enabled === false) {
    status = input.status === "draft" ? "draft" : "pending";
    statusMessage = !cfg
      ? "Configuração fiscal da filial não cadastrada (Fiscal → Configurações)."
      : enabled === false
        ? `Emissão de ${MODEL_LABEL[input.model]} desabilitada na configuração fiscal.`
        : `Credencial do provedor fiscal ausente (variável ${cfg.tokenRef || "FOCUSNFE_TOKEN"}).`;
  }
  const series = input.model === "nfce" ? (cfg?.nfceSeries ?? 1) : input.model === "nfe" ? (cfg?.nfeSeries ?? 1) : (cfg?.nfseSeries ?? null);
  let doc: Doc;
  try {
    doc = await ctx.store.create(
      "fiscal_documents",
      {
        companyId: ctx.companyId,
        branchId: input.branchId,
        createdBy: ctx.user.id,
        model: input.model,
        environment: provider?.simulated ? "simulacao" : (cfg?.environment ?? "homologacao"),
        provider: cfg?.provider ?? null,
        ref: input.ref,
        series: series != null ? String(series) : null,
        status,
        statusMessage,
        originType: input.originType,
        originId: input.originId ?? null,
        operationId: input.operationId ?? null,
        nature: input.nature ?? (input.model === "nfse" ? "Prestação de serviço" : "Venda de mercadoria"),
        purpose: input.purpose ?? "normal",
        operationType: input.operationType ?? "saida",
        recipient: input.recipient ?? null,
        recipientName: input.recipient?.name ?? null,
        recipientDoc: onlyDigits(input.recipient?.doc) || null,
        items: input.items ?? [],
        totals: input.totals ?? null,
        payments: input.payments ?? [],
        transport: input.transport ?? null,
        service: input.service ?? null,
        issuedAt: nowIso(),
        attempts: 0,
        isSimulated: Boolean(provider?.simulated),
        total: input.total,
        terminalId: input.terminalId ?? null,
        operatorId: ctx.user.id,
        correctionCount: 0,
      },
      id,
    );
  } catch (e) {
    if (isConflict(e)) return (await ctx.store.get("fiscal_documents", id))!;
    throw e;
  }
  await addEvent(ctx, doc.id, "created", status, statusMessage ?? `${MODEL_LABEL[input.model]} criada (${DOC_STATUS_LABEL[status]})`);
  if (status === "queued") await enqueue(ctx.store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: input.branchId }, dedupeKey: `fiscal-transmit:${doc.id}:1`, companyId: ctx.companyId });
  if (status === "pending") await raiseFiscalIssue(ctx, doc, statusMessage!);
  await syncOrigin(ctx, doc);
  return doc;
}

async function addEvent(ctx: Ctx, documentId: string, type: string, status: string, message: string, request?: unknown, response?: unknown, protocol?: string) {
  const { sanitize } = await import("@/lib/core/audit");
  await ctx.store.create("fiscal_events", {
    companyId: ctx.companyId,
    branchId: ctx.branchId,
    createdBy: ctx.user.id,
    documentId,
    type,
    status,
    seq: Date.now(),
    message,
    request: request ? sanitize(request) : null,
    response: response ? sanitize(response) : null,
    protocol: protocol ?? null,
    occurredAt: nowIso(),
  });
}

async function raiseFiscalIssue(ctx: Ctx, doc: Doc, message: string) {
  await notify(ctx.store, {
    companyId: ctx.companyId,
    branchId: doc.branchId,
    type: "fiscal_rejected",
    priority: "high",
    title: `${MODEL_LABEL[doc.model]} ${doc.number ? "nº " + doc.number : ""} com pendência`,
    body: message.slice(0, 500),
    link: `/fiscal/${doc.model}/${doc.id}`,
    originType: "fiscal_document",
    originId: doc.id,
    occurrenceKey: `fiscal:${doc.id}`,
    audience: { action: "fiscal.issue" },
  });
}

/** Mantém a situação fiscal da origem (venda) alinhada ao documento. */
async function syncOrigin(ctx: Ctx, doc: Doc) {
  if (doc.originType === "sale" && doc.originId && doc.model === "nfce") {
    await ctx.store.update("sales", doc.originId, { fiscalStatus: doc.status, fiscalDocumentId: doc.id }).catch(() => undefined);
  }
}

export async function createNfceForSale(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const payments = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]] });
  const docItems = await buildItems(
    ctx,
    items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice, discount: i.itemDiscount + i.globalDiscount, description: i.description })),
    { branchId: sale.branchId, other: items.reduce((a, i) => a + i.surcharge, 0) },
  );
  const totals = computeTotals(docItems);
  const c = sale.customerSnapshot;
  return createDocument(ctx, {
    model: "nfce",
    ref: `nfce-${saleId}`,
    branchId: sale.branchId,
    originType: "sale",
    originId: saleId,
    operationId: saleId,
    recipient: c?.doc ? { name: c.name, doc: c.doc, email: c.email } : null,
    items: docItems,
    totals,
    payments: payments.map((p) => ({ kind: p.methodKind, amount: p.amount })),
    terminalId: sale.terminalId,
    total: totals.total,
  });
}

/** NF-e de devolução (entrada, finalidade 4) referenciando o documento da venda — criada como rascunho. */
export async function createReturnDocumentDraft(ctx: Ctx, returnId: string) {
  const ret = await ctx.store.getOrThrow("returns", returnId);
  const sale = await ctx.store.getOrThrow("sales", ret.saleId);
  const original = sale.fiscalDocumentId ? await ctx.store.get("fiscal_documents", sale.fiscalDocumentId) : null;
  if (!original || original.status !== "authorized") return null; // sem documento autorizado não há o que referenciar
  const ritems = await listAll(ctx.store, "return_items", { filters: [["eq", "returnId", returnId]] });
  const docItems = await buildItems(
    ctx,
    ritems.map((r) => ({ skuId: r.skuId, qty: r.qty, unitPrice: r.unitPrice, discount: Math.max(0, roundDiv(r.unitPrice * r.qty, QTY) - r.total), cfopOverride: "1202" })),
    { branchId: ret.branchId },
  );
  const totals = computeTotals(docItems);
  const c = sale.customerSnapshot;
  const doc = await createDocument(ctx, {
    model: "nfe",
    ref: `nfe-dev-${returnId}`,
    branchId: ret.branchId,
    originType: "return",
    originId: returnId,
    operationId: sale.id,
    nature: "Devolução de venda",
    purpose: "devolucao",
    operationType: "entrada",
    recipient: c ? { name: c.name, doc: c.doc, email: c.email, address: c.address, ie: c.ie } : null,
    items: docItems,
    totals,
    payments: [{ kind: "other", amount: 0 }],
    service: { referencedKeys: original.accessKey ? [original.accessKey] : [] },
    status: "draft",
    total: totals.total,
  });
  await ctx.store.update("returns", returnId, { fiscalDocumentId: doc.id });
  return doc;
}

// ───────────────────────────── Transmissão / retorno

async function applyResult(ctx: Ctx, doc: Doc, r: ProviderResult, eventType: string, provider: { download(p: string): Promise<Buffer>; fileUrl(p: string): string; simulated: boolean }) {
  const map: Record<string, string> = { processing: "processing", authorized: "authorized", rejected: "rejected", denied: "denied", cancelled: "cancelled", error: "error", unused: "unused" };
  const status = map[r.status] ?? "error";
  const patch: Record<string, any> = {
    status,
    statusCode: r.statusCode ?? null,
    statusMessage: r.message ?? null,
    lastAttemptAt: nowIso(),
  };
  if (r.accessKey) patch.accessKey = r.accessKey;
  if (r.number) patch.number = r.number;
  if (r.series) patch.series = r.series;
  if (r.protocol) patch.protocol = r.protocol;
  if (r.verificationCode) patch.verificationCode = r.verificationCode;
  if (r.qrCodeUrl) patch.qrCodeUrl = r.qrCodeUrl;
  if (r.danfePath) patch.danfeUrl = provider.fileUrl(r.danfePath);
  if (r.xmlPath) patch.xmlUrl = provider.fileUrl(r.xmlPath);
  if (status === "authorized" && !doc.authorizedAt) patch.authorizedAt = nowIso();
  if (status === "cancelled") patch.cancelledAt = nowIso();
  const updated = await ctx.store.update("fiscal_documents", doc.id, patch);
  await addEvent(ctx, doc.id, eventType, status, r.message ?? DOC_STATUS_LABEL[status], undefined, r.raw, r.protocol);
  // Arquivo XML autorizado: guarda cópia no armazenamento próprio (contabilidade/backup)
  if (status === "authorized" && r.xmlPath && !doc.xmlFileId && !provider.simulated) {
    try {
      const xml = await provider.download(r.xmlPath);
      const f = await saveFile(ctx, { bucket: "documents", name: `${updated.accessKey ?? doc.ref}.xml`, mime: "application/xml", data: xml, entityType: "fiscal_document", entityId: doc.id, kind: "xml", branchId: doc.branchId });
      await ctx.store.update("fiscal_documents", doc.id, { xmlFileId: f.id });
    } catch (e: any) {
      await addEvent(ctx, doc.id, "download", "error", `XML não baixado: ${e.message}`);
    }
  }
  if (status === "authorized" && provider.simulated && !doc.xmlFileId) {
    const xml = Buffer.from(simulatedXml(updated));
    const f = await saveFile(ctx, { bucket: "documents", name: `SIMULACAO-${doc.ref}.xml`, mime: "application/xml", data: xml, entityType: "fiscal_document", entityId: doc.id, kind: "xml", branchId: doc.branchId });
    await ctx.store.update("fiscal_documents", doc.id, { xmlFileId: f.id });
  }
  if (["rejected", "denied", "error"].includes(status)) await raiseFiscalIssue(ctx, updated, r.message ?? DOC_STATUS_LABEL[status]);
  if (["authorized", "cancelled", "unused", "discarded"].includes(status)) await resolveOccurrence(ctx.store, `fiscal:${doc.id}`);
  await syncOrigin(ctx, updated);
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

function simulatedXml(doc: Doc) {
  const esc = (s: any) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIMULAÇÃO INTERCERT — DOCUMENTO SEM VALIDADE FISCAL -->
<documentoSimulado modelo="${doc.model}" ref="${esc(doc.ref)}" numero="${doc.number ?? ""}" serie="${esc(doc.series)}" chave="${esc(doc.accessKey)}" protocolo="${esc(doc.protocol)}">
  <destinatario nome="${esc(doc.recipientName)}" doc="${esc(doc.recipientDoc)}"/>
  <total>${((doc.total ?? 0) / 100).toFixed(2)}</total>
  ${(doc.items ?? []).map((i: any) => `<item n="${i.seq}" codigo="${esc(i.code)}" ncm="${esc(i.ncm)}" cfop="${esc(i.cfop)}" qtd="${i.qty / QTY}" valor="${(i.total / 100).toFixed(2)}">${esc(i.description)}</item>`).join("\n  ")}
</documentoSimulado>`;
}

async function providerForDoc(ctx: Ctx, doc: Doc) {
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, doc.branchId);
  const provider = fiscalProviderFrom(cfg ? { ...cfg, provider: doc.provider ?? cfg.provider } : null);
  return { cfg, provider };
}

export async function transmitDocument(ctx: Ctx, documentId: string) {
  let doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  if (["authorized", "cancelled", "unused", "discarded", "denied"].includes(doc.status)) return doc;
  const company = await ctx.store.getOrThrow("companies", doc.companyId);
  const branch = doc.branchId ? await ctx.store.get("branches", doc.branchId) : null;
  const { cfg, provider } = await providerForDoc(ctx, doc);
  if (!cfg || !provider) {
    const msg = !cfg ? "Configuração fiscal não cadastrada." : `Credencial do provedor ausente (${cfg.tokenRef || "FOCUSNFE_TOKEN"}).`;
    doc = await ctx.store.update("fiscal_documents", doc.id, { status: "pending", statusMessage: msg });
    await raiseFiscalIssue(ctx, doc, msg);
    await syncOrigin(ctx, doc);
    return doc;
  }
  const issues = validateDocument(doc, company, branch);
  if (issues.length) {
    doc = await ctx.store.update("fiscal_documents", doc.id, { status: "pending", statusMessage: issues.join(" ") });
    await addEvent(ctx, doc.id, "validation", "pending", issues.join(" "));
    await raiseFiscalIssue(ctx, doc, issues.join(" "));
    await syncOrigin(ctx, doc);
    return doc;
  }
  // Se já foi enviado antes (ex.: timeout), consulta a referência antes de reenviar
  if ((doc.attempts ?? 0) > 0 && ["processing", "error", "queued"].includes(doc.status)) {
    try {
      const q = await provider.query(doc.model, doc.ref, { nfseStandard: cfg.nfseStandard });
      if (["authorized", "processing", "cancelled", "denied"].includes(q.status)) return applyResult(ctx, doc, q, "query", provider);
    } catch {
      /* segue para reenvio */
    }
  }
  const payload = toProviderPayload(doc, company, branch, cfg);
  await ctx.store.update("fiscal_documents", doc.id, { status: "processing", attempts: (doc.attempts ?? 0) + 1, lastAttemptAt: nowIso() });
  const t0 = Date.now();
  let r: ProviderResult;
  try {
    r = await provider.send(doc.model, doc.ref, payload, { nfseStandard: cfg.nfseStandard });
  } catch (e: any) {
    r = { status: "error", message: `Falha de comunicação: ${e.message}` };
  }
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: doc.branchId, kind: doc.model === "nfse" ? "fiscal_nfse" : "fiscal_nfe", action: `send_${doc.model}`, status: r.status === "error" ? "failure" : "success", message: `${doc.ref}: ${r.message ?? r.status}`, durationMs: Date.now() - t0 });
  const updated = await applyResult(ctx, await ctx.store.getOrThrow("fiscal_documents", doc.id), r, "send", provider);
  if (updated.status === "processing" || updated.status === "error") {
    const attempt = (updated.attempts ?? 1) + 1;
    await enqueue(ctx.store, {
      type: updated.status === "processing" ? "fiscal.query" : "fiscal.transmit",
      payload: { documentId: doc.id, branchId: doc.branchId },
      dedupeKey: `fiscal-${updated.status === "processing" ? "query" : "transmit"}:${doc.id}:${attempt}`,
      companyId: ctx.companyId,
      runAt: new Date(Date.now() + Math.min(30, attempt * 5) * 1000).toISOString(),
    });
  }
  return updated;
}

export async function queryDocument(ctx: Ctx, documentId: string) {
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  const { cfg, provider } = await providerForDoc(ctx, doc);
  if (!provider || (doc.attempts ?? 0) === 0) return doc;
  let r: ProviderResult;
  try {
    r = await provider.query(doc.model, doc.ref, { nfseStandard: cfg?.nfseStandard });
  } catch (e: any) {
    r = { status: "error", message: `Falha na consulta: ${e.message}` };
  }
  const updated = await applyResult(ctx, doc, r, "query", provider);
  if (updated.status === "processing") {
    const n = Date.now();
    await enqueue(ctx.store, { type: "fiscal.query", payload: { documentId: doc.id, branchId: doc.branchId }, dedupeKey: `fiscal-query:${doc.id}:${n}`, companyId: ctx.companyId, runAt: new Date(n + 20000).toISOString() });
  }
  return updated;
}

/** Retransmissão manual: reenfileira com a mesma referência (sem novo documento). */
export async function retransmit(ctx: Ctx, documentId: string) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(["rejected", "error", "pending", "draft", "queued"].includes(doc.status), `Documento ${DOC_STATUS_LABEL[doc.status]} não pode ser retransmitido.`);
  await ctx.store.update("fiscal_documents", doc.id, { status: "queued" });
  await addEvent(ctx, doc.id, "retry", "queued", `Retransmissão solicitada por ${ctx.user.name}`);
  await audit(ctx, { module: "fiscal", action: "document.retransmit", entityType: "fiscal_document", entityId: doc.id, summary: `${MODEL_LABEL[doc.model]} ${doc.ref} reenviada` });
  return transmitDocument(ctx, doc.id);
}

export async function cancelDocument(ctx: Ctx, documentId: string, justification: string) {
  requireAction(ctx, "fiscal.cancel");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(justification?.trim().length >= 15, "Justificativa deve ter ao menos 15 caracteres.");
  if (["draft", "pending", "rejected"].includes(doc.status) && !doc.protocol) {
    const updated = await ctx.store.update("fiscal_documents", doc.id, { status: "discarded", statusMessage: `Descartado sem transmissão autorizada: ${justification}` });
    await addEvent(ctx, doc.id, "discard", "discarded", justification);
    await resolveOccurrence(ctx.store, `fiscal:${doc.id}`);
    await syncOrigin(ctx, updated);
    return updated;
  }
  assert(doc.status === "authorized", `Documento ${DOC_STATUS_LABEL[doc.status]} não pode ser cancelado.`);
  const { cfg, provider } = await providerForDoc(ctx, doc);
  assert(provider, "Provedor fiscal indisponível para cancelamento.");
  let r: ProviderResult;
  try {
    r = await provider!.cancel(doc.model, doc.ref, justification, { nfseStandard: cfg?.nfseStandard });
  } catch (e: any) {
    r = { status: "error", message: `Falha de comunicação: ${e.message}` };
  }
  if (r.status !== "cancelled") {
    await addEvent(ctx, doc.id, "cancel", "error", r.message ?? "Cancelamento não homologado", { justification }, r.raw);
    throw new BusinessError(`Cancelamento não homologado: ${r.message ?? r.status}. O documento permanece autorizado.`, "cancel_failed");
  }
  const updated = await applyResult(ctx, doc, r, "cancel", provider!);
  await audit(ctx, { module: "fiscal", action: "document.cancel", entityType: "fiscal_document", entityId: doc.id, summary: `${MODEL_LABEL[doc.model]} nº ${doc.number} cancelada`, reason: justification, related: doc.originId ? [`${doc.originType}:${doc.originId}`] : [] });
  return updated;
}

/** Solicitado pela origem (ex.: venda cancelada): cancela se autorizado, descarta se não transmitido. */
export async function requestCancelForOrigin(ctx: Ctx, originType: string, originId: string, justification: string) {
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", originType], ["eq", "originId", originId]] });
  for (const d of docs) {
    if (["cancelled", "discarded", "unused"].includes(d.status)) continue;
    if (d.status === "authorized") {
      await enqueue(ctx.store, { type: "fiscal.cancel", payload: { documentId: d.id, justification: justification.padEnd(15, ".").slice(0, 255), branchId: d.branchId }, dedupeKey: `fiscal-cancel:${d.id}`, companyId: ctx.companyId });
      await addEvent(ctx, d.id, "cancel_request", "queued", "Cancelamento solicitado pela origem (venda cancelada).");
      await notify(ctx.store, { companyId: ctx.companyId, branchId: d.branchId, type: "fiscal_rejected", priority: "high", title: `Cancelar ${MODEL_LABEL[d.model]} nº ${d.number}`, body: "Venda cancelada: o cancelamento fiscal foi enfileirado. Acompanhe o retorno.", link: `/fiscal/${d.model}/${d.id}`, originType: "fiscal_document", originId: d.id, occurrenceKey: `fiscal:${d.id}`, audience: { action: "fiscal.cancel" } });
    } else if (d.status === "processing") {
      await addEvent(ctx, d.id, "cancel_request", "pending", "Venda cancelada durante o processamento: após autorização, cancelar o documento.");
      await raiseFiscalIssue(ctx, d, "Venda cancelada enquanto o documento estava em processamento. Consulte e cancele após a autorização.");
    } else {
      await ctx.store.update("fiscal_documents", d.id, { status: "discarded", statusMessage: "Descartado: origem cancelada antes da autorização." });
      await addEvent(ctx, d.id, "discard", "discarded", "Origem cancelada antes da autorização.");
      await resolveOccurrence(ctx.store, `fiscal:${d.id}`);
    }
  }
  if (originType === "sale") {
    const any = docs.find((d) => d.model === "nfce");
    if (any) await syncOrigin(ctx, await ctx.store.getOrThrow("fiscal_documents", any.id));
  }
}

export async function correctionLetter(ctx: Ctx, documentId: string, text: string) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(doc.model === "nfe", "Carta de correção aplica-se somente à NF-e.");
  assert(doc.status === "authorized", "Somente NF-e autorizada aceita carta de correção.");
  assert(text?.trim().length >= 15, "A correção deve ter ao menos 15 caracteres.");
  const { provider } = await providerForDoc(ctx, doc);
  assert(provider, "Provedor fiscal indisponível.");
  const r = await provider!.correction(doc.ref, text);
  await addEvent(ctx, doc.id, "cce", r.status === "authorized" ? "authorized" : "rejected", r.message ?? "", { correcao: text }, r.raw, r.protocol);
  if (r.status !== "authorized") throw new BusinessError(`CC-e não registrada: ${r.message}`);
  await ctx.store.update("fiscal_documents", doc.id, { correctionCount: (doc.correctionCount ?? 0) + 1 });
  await audit(ctx, { module: "fiscal", action: "document.cce", entityType: "fiscal_document", entityId: doc.id, summary: `CC-e registrada na NF-e nº ${doc.number}`, after: { text } });
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

export async function disableNumbers(ctx: Ctx, input: { branchId: string; model: "nfe" | "nfce"; series: string; from: number; to: number; justification: string }) {
  requireAction(ctx, "fiscal.cancel");
  assert(input.from > 0 && input.to >= input.from, "Faixa de numeração inválida.");
  assert(input.justification?.trim().length >= 15, "Justificativa deve ter ao menos 15 caracteres.");
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, input.branchId);
  const provider = fiscalProviderFrom(cfg);
  assert(provider, "Provedor fiscal indisponível.");
  const branch = await ctx.store.getOrThrow("branches", input.branchId);
  const r = await provider!.disable({ cnpj: onlyDigits(branch.cnpj), series: input.series, from: input.from, to: input.to, justification: input.justification, model: input.model });
  const doc = await ctx.store.create("fiscal_documents", {
    companyId: ctx.companyId, branchId: input.branchId, createdBy: ctx.user.id, model: input.model, environment: provider!.simulated ? "simulacao" : cfg?.environment, provider: cfg?.provider,
    ref: `inut-${input.model}-${input.series}-${input.from}-${input.to}-${Date.now()}`, series: input.series, number: input.from, status: r.status === "unused" ? "unused" : "rejected",
    statusMessage: `Inutilização ${input.from}–${input.to}: ${r.message ?? r.status}`, originType: "disable", nature: "Inutilização de numeração", protocol: r.protocol ?? null, issuedAt: nowIso(),
    isSimulated: provider!.simulated, total: 0, attempts: 1, items: [], payments: [],
  });
  await addEvent(ctx, doc.id, "disable", doc.status, r.message ?? "", input, r.raw, r.protocol);
  await audit(ctx, { module: "fiscal", action: "numbers.disable", entityType: "fiscal_document", entityId: doc.id, summary: `Inutilização ${input.model.toUpperCase()} série ${input.series} nº ${input.from}–${input.to}`, reason: input.justification });
  return doc;
}

// ───────────────────────────── NFS-e

export interface NfseCalcInput {
  amount: number;
  unconditionalDiscount?: number;
  deductions?: number;
  issRateBps: number;
  issWithheld: boolean;
  pisBps?: number;
  cofinsBps?: number;
  inssBps?: number;
  irBps?: number;
  csllBps?: number;
  withhold?: { pis?: boolean; cofins?: boolean; inss?: boolean; ir?: boolean; csll?: boolean };
}

/** Base = serviços − desconto incondicionado − deduções; ISS calculado ≠ ISS retido; líquido = serviços − desc. incond. − retenções. */
export function calcNfse(i: NfseCalcInput) {
  const base = Math.max(0, i.amount - (i.unconditionalDiscount ?? 0) - (i.deductions ?? 0));
  const iss = pct(base, i.issRateBps);
  const gross = i.amount - (i.unconditionalDiscount ?? 0);
  const w = i.withhold ?? {};
  const pis = i.pisBps ? pct(gross, i.pisBps) : 0;
  const cofins = i.cofinsBps ? pct(gross, i.cofinsBps) : 0;
  const inss = i.inssBps ? pct(gross, i.inssBps) : 0;
  const ir = i.irBps ? pct(gross, i.irBps) : 0;
  const csll = i.csllBps ? pct(gross, i.csllBps) : 0;
  const withheld = (i.issWithheld ? iss : 0) + (w.pis ? pis : 0) + (w.cofins ? cofins : 0) + (w.inss ? inss : 0) + (w.ir ? ir : 0) + (w.csll ? csll : 0);
  return { base, iss, issWithheldValue: i.issWithheld ? iss : 0, pis, cofins, inss, ir, csll, withheld, net: gross - withheld };
}

export async function createNfse(
  ctx: Ctx,
  input: {
    branchId: string;
    recipient: Record<string, any>;
    serviceProductId?: string | null;
    competence: string;
    description: string;
    serviceListItem: string;
    municipalCode?: string;
    serviceCityCode?: string;
    issExigibility?: string;
    calc: NfseCalcInput;
    createReceivable?: { dueDate: string; categoryId?: string | null } | null;
    customerId?: string | null;
    asDraft?: boolean;
    idemKey: string;
  },
) {
  requireAction(ctx, "fiscal.issue");
  const c = calcNfse(input.calc);
  assert(input.calc.amount > 0, "Informe o valor dos serviços.");
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, input.branchId);
  const { nextNumber } = await import("@/lib/core/numbering");
  const rps = await nextNumber(ctx.store, `rps:${input.branchId}`);
  const doc = await createDocument(ctx, {
    model: "nfse",
    ref: `nfse-${input.idemKey}`,
    branchId: input.branchId,
    originType: "service",
    originId: input.serviceProductId ?? null,
    recipient: input.recipient,
    service: {
      competence: input.competence, description: input.description, serviceListItem: input.serviceListItem, municipalCode: input.municipalCode, serviceCityCode: input.serviceCityCode,
      issExigibility: input.issExigibility ?? "1", amount: input.calc.amount, unconditionalDiscount: input.calc.unconditionalDiscount ?? 0, deductions: input.calc.deductions ?? 0,
      issRateBps: input.calc.issRateBps, issWithheld: input.calc.issWithheld, withhold: input.calc.withhold ?? {}, standard: cfg?.nfseStandard ?? "municipal", ...c,
    },
    status: input.asDraft ? "draft" : "queued",
    total: input.calc.amount,
  });
  await ctx.store.update("fiscal_documents", doc.id, { rpsNumber: rps, rpsSeries: cfg?.nfseSeries ?? "1" });
  if (input.createReceivable && input.customerId) {
    const { createTitle } = await import("../finance");
    await createTitle(ctx, {
      kind: "receivable", partyType: "customer", partyId: input.customerId, partyName: input.recipient.name, description: `Serviço — NFS-e (RPS ${rps})`, originType: "nfse", originId: doc.id,
      installments: [{ dueDate: input.createReceivable.dueDate, amount: c.net }], categoryId: input.createReceivable.categoryId ?? null, idemKey: `nfse:${doc.id}`, branchId: input.branchId,
      competenceDate: input.competence,
    });
  }
  await audit(ctx, { module: "fiscal", action: "nfse.create", entityType: "fiscal_document", entityId: doc.id, summary: `NFS-e (RPS ${rps}) criada — ${(input.calc.amount / 100).toFixed(2)}` });
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

/** Envia um rascunho (NF-e/NFS-e) para a fila de transmissão. */
export async function submitDraft(ctx: Ctx, documentId: string) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(["draft", "pending"].includes(doc.status), "Documento não está em rascunho.");
  await ctx.store.update("fiscal_documents", doc.id, { status: "queued", issuedAt: nowIso() });
  await addEvent(ctx, doc.id, "submit", "queued", `Enviado para transmissão por ${ctx.user.name}`);
  return transmitDocument(ctx, doc.id);
}

registerJob("fiscal.transmit", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d) return { skipped: true };
  ctx.branchId = d.branchId;
  const r = await transmitDocument(ctx, p.documentId);
  return { status: r.status };
});
registerJob("fiscal.query", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d) return { skipped: true };
  ctx.branchId = d.branchId;
  const r = await queryDocument(ctx, p.documentId);
  return { status: r.status };
});
registerJob("fiscal.cancel", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d) return { skipped: true };
  ctx.branchId = d.branchId;
  const r = await cancelDocument(ctx, p.documentId, p.justification);
  return { status: r.status };
});

export function fiscalDayKey(iso: string) {
  return toLocalDate(iso);
}
export { today };
