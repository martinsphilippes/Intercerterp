import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { nowIso, today, toLocalDate } from "@/lib/dates";
import { pct, roundDiv, QTY, allocate, formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { enqueue, registerJob } from "@/lib/core/jobs";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { saveFile, readFile } from "@/lib/core/files";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting } from "@/lib/core/settings";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/core/text";
import { fiscalProviderFrom, TPAG, type FiscalModel, type FiscalProvider, type ProviderResult } from "./providers";
import { logIntegration } from "../integrations";

/**
 * Documentos fiscais (Telas 30–35).
 * Estados: draft → queued → processing → authorized | rejected | denied | error ; authorized → cancelled.
 * "pending" = aguardando cadastro/configuração (não transmitido). Nenhum estado é presumido:
 * só "authorized" com retorno do provedor; documentos de simulação ficam marcados (isSimulated).
 * A referência (`ref`) é única e estável: retransmissões, consultas e cancelamentos usam sempre a mesma.
 */

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  pending: "Pendente de cadastro/configuração",
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

export const PURPOSE_LABEL: Record<string, string> = { normal: "Normal", complementar: "Complementar", ajuste: "Ajuste", devolucao: "Devolução" };
export const PRESENCE_LABEL: Record<string, string> = {
  "0": "0 — Não se aplica",
  "1": "1 — Operação presencial",
  "2": "2 — Internet",
  "3": "3 — Teleatendimento",
  "4": "4 — Entrega em domicílio (NFC-e)",
  "5": "5 — Presencial fora do estabelecimento",
  "9": "9 — Outros (não presencial)",
};
export const FREIGHT_MODE_LABEL: Record<string, string> = {
  "0": "0 — Por conta do emitente (CIF)",
  "1": "1 — Por conta do destinatário (FOB)",
  "2": "2 — Por conta de terceiros",
  "3": "3 — Próprio, por conta do remetente",
  "4": "4 — Próprio, por conta do destinatário",
  "9": "9 — Sem frete",
};
export const ORIGIN_LABEL: Record<string, string> = {
  sale: "Venda",
  transfer: "Transferência",
  purchase_order: "Pedido de compra (devolução a fornecedor)",
  return: "Devolução de venda",
  manual: "Operação avulsa",
  service: "Serviço",
  disable: "Inutilização",
};

/** Estados em que o documento ainda pode ser corrigido e retransmitido com a mesma referência. */
export const RETRANSMITTABLE = ["rejected", "error", "pending", "draft", "queued"];
/** Estados finais (não mudam mais pelo provedor, exceto cancelamento de autorizado). */
export const FINAL = ["authorized", "cancelled", "unused", "discarded", "denied"];

const fiscalScope = (companyId: string, branchId: string | null) => `${companyId}|${branchId ?? "*"}`;

export async function getFiscalConfig(store: Store, companyId: string, branchId: string | null): Promise<Doc | null> {
  if (branchId) {
    const b = await store.get("fiscal_configs", detId("fiscalcfg", fiscalScope(companyId, branchId)));
    if (b) return b;
  }
  return store.get("fiscal_configs", detId("fiscalcfg", fiscalScope(companyId, null)));
}

/** Mensagem acionável quando o provedor não pode ser iniciado por falta de credencial. */
export function credentialMessage(cfg: Doc | null) {
  if (!cfg) return "Configuração fiscal não cadastrada.";
  if (cfg.tokenRef === "") return "Vínculo de credencial removido: vincule a variável do token na Central de integrações.";
  return `Credencial do provedor ausente: defina a variável de ambiente ${cfg.tokenRef || "FOCUSNFE_TOKEN"} no servidor.`;
}

/** Situação MEDIDA da conexão: sem teste registrado é sempre "configurada sem teste" (nunca presumida). */
export function measuredStatus(cfg: Doc | null): string {
  if (!cfg) return "not_configured";
  if (!cfg.lastTestAt) return "configured_untested";
  return cfg.connectionStatus ?? "configured_untested";
}

export function providerFor(store: Store, cfg: Doc | null) {
  return fiscalProviderFrom(cfg, store);
}

export async function saveFiscalConfig(ctx: Ctx, branchId: string | null, data: Record<string, any>) {
  requireAction(ctx, "fiscal.configure");
  const sk = fiscalScope(ctx.companyId, branchId);
  const id = detId("fiscalcfg", sk);
  const before = await ctx.store.get("fiscal_configs", id);
  const patch: Record<string, any> = { ...data, companyId: ctx.companyId, branchId, scopeKey: sk };
  const connChanged = !before || ["provider", "environment", "tokenRef", "simulateOutage"].some((k) => k in data && before[k] !== data[k]);
  if (connChanged) {
    patch.connectionStatus = "configured_untested";
    patch.lastTestResult = "Configuração alterada — execute o teste de conexão.";
  }
  if ("contingency" in data) patch.contingencySince = data.contingency ? (before?.contingency ? before.contingencySince : nowIso()) : null;
  let doc: Doc;
  if (before) doc = await ctx.store.update("fiscal_configs", id, patch);
  else {
    // configuração própria da filial nasce herdando a da empresa (nunca incompleta)
    const parent = branchId ? await ctx.store.get("fiscal_configs", detId("fiscalcfg", fiscalScope(ctx.companyId, null))) : null;
    const inherited: Record<string, any> = {};
    if (parent) for (const [k, v] of Object.entries(parent)) if (!["id", "createdAt", "updatedAt", "branchId", "scopeKey", "createdBy", "certificate", "lastTestAt", "lastTestResult", "connectionStatus"].includes(k)) inherited[k] = v;
    try {
      doc = await ctx.store.create("fiscal_configs", { ...inherited, ...patch, createdBy: ctx.user.id }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await ctx.store.update("fiscal_configs", id, patch);
    }
  }
  await audit(ctx, { module: "fiscal", action: "config.save", entityType: "fiscal_config", entityId: id, summary: `Configuração fiscal ${branchId ? "da filial" : "da empresa"} atualizada`, before, after: doc, branchId });
  // saída da contingência: a fila retida é transmitida
  if (before?.contingency && data.contingency === false) await releaseContingencyQueue(ctx, branchId);
  return doc;
}

export async function testFiscalConnection(ctx: Ctx, branchId: string | null) {
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, branchId);
  assert(cfg, "Configuração fiscal não cadastrada.");
  const provider = providerFor(ctx.store, cfg);
  let result: { ok: boolean; message: string };
  const t0 = Date.now();
  if (!provider) result = { ok: false, message: credentialMessage(cfg) };
  else {
    try {
      const branch = branchId ? await ctx.store.get("branches", branchId) : null;
      const company = await ctx.store.get("companies", ctx.companyId);
      result = await provider.test(onlyDigits(branch?.cnpj ?? company?.cnpj));
    } catch (e: any) {
      result = { ok: false, message: `Falha de conexão: ${e.message}` };
    }
  }
  const status = result.ok ? (provider?.simulated ? "simulated" : "operational") : provider ? "error" : "not_configured";
  await ctx.store.update("fiscal_configs", cfg.id, { lastTestAt: nowIso(), lastTestResult: result.message.slice(0, 500), connectionStatus: status });
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId, kind: "fiscal_nfe", action: "test", status: result.ok ? "success" : "failure", message: result.message, durationMs: Date.now() - t0 });
  await audit(ctx, { module: "fiscal", action: "config.test", entityType: "fiscal_config", entityId: cfg.id, summary: `Teste de conexão fiscal: ${result.ok ? "aceito" : "falhou"} — ${result.message}`.slice(0, 480), result: result.ok ? "success" : "failure", branchId });
  return { ...result, status };
}

// ───────────────────────────── Numeração

export function numberKey(companyId: string, branchId: string | null, model: string, series: string) {
  return `fiscalnum:${companyId}:${branchId ?? "*"}:${model}:${series}`;
}

/** Atribui número (NF-e/NFC-e) ou RPS (NFS-e) na primeira transmissão; retransmissões mantêm o mesmo número. */
async function ensureNumber(ctx: Ctx, doc: Doc, cfg: Doc | null): Promise<Doc> {
  if (doc.model === "nfse") {
    if (doc.rpsNumber) return doc;
    const rps = await nextNumber(ctx.store, `rps:${doc.branchId}`);
    return ctx.store.update("fiscal_documents", doc.id, { rpsNumber: rps, rpsSeries: doc.rpsSeries ?? String(cfg?.nfseSeries ?? "1") });
  }
  if (doc.number) return doc;
  const series = String(doc.series ?? (doc.model === "nfce" ? (cfg?.nfceSeries ?? 1) : (cfg?.nfeSeries ?? 1)));
  const n = await nextNumber(ctx.store, numberKey(doc.companyId, doc.branchId, doc.model, series));
  return ctx.store.update("fiscal_documents", doc.id, { number: n, series });
}

// ───────────────────────────── Tributação

export interface TaxInfo {
  cfop: string;
  cstCsosn: string;
  icmsRateBps: number;
  pisCst: string;
  pisRateBps: number;
  cofinsCst: string;
  cofinsRateBps: number;
  groupId: string | null;
  groupName: string | null;
  groupIssue: string | null;
  /** carga tributária aproximada (Lei 12.741/2012) — percentual parametrizado no grupo ou na configuração */
  approxTaxBps: number;
}

export type OperationKind = "sale" | "sale_return" | "supplier_return" | "transfer" | "purchase" | "other";

/** CFOP padrão por natureza da operação (sobreponível por item). Regra assumida — validar com a contabilidade. */
export function defaultCfop(kind: OperationKind, interstate: boolean, g: Doc | null): string {
  const st = String(g?.cfopInternal ?? "").startsWith("54") || ["500", "60", "10", "30", "70"].includes(String(g?.cstCsosn ?? ""));
  const p = interstate ? "6" : "5";
  const e = interstate ? "2" : "1";
  switch (kind) {
    case "sale":
      return (interstate ? g?.cfopInterstate : g?.cfopInternal) || `${p}102`;
    case "sale_return":
      return interstate ? (g?.cfopReturn ? "2" + String(g.cfopReturn).slice(1) : `${e}202`) : g?.cfopReturn || `${e}202`;
    case "supplier_return":
      return st ? `${p}411` : `${p}202`;
    case "transfer":
      return st ? `${p}409` : `${p}152`;
    case "purchase":
      return st ? `${e}403` : `${e}102`;
    default:
      return (interstate ? g?.cfopInterstate : g?.cfopInternal) || "";
  }
}

function groupValidity(g: Doc | null, ref = today()): string | null {
  if (!g) return null;
  if (g.active === false) return `Grupo tributário "${g.name}" inativo.`;
  if (g.validFrom && g.validFrom > ref) return `Grupo tributário "${g.name}" vigente somente a partir de ${g.validFrom.split("-").reverse().join("/")}.`;
  if (g.validTo && g.validTo < ref) return `Grupo tributário "${g.name}" com vigência encerrada em ${g.validTo.split("-").reverse().join("/")}.`;
  return null;
}

async function taxFor(store: Store, product: Doc, company: Doc, cfg: Doc | null, opts: { interstate: boolean; kind: OperationKind; taxGroupId?: string | null }): Promise<TaxInfo> {
  const groupId = opts.taxGroupId || product.taxGroupId || cfg?.defaultTaxGroupId || null;
  const g = groupId ? await store.get("tax_groups", groupId) : null;
  const simples = ["simples", "mei"].includes(company.regime);
  const cfopFromProduct = opts.kind === "sale" ? product.cfop : null;
  return {
    cfop: cfopFromProduct || defaultCfop(opts.kind, opts.interstate, g),
    cstCsosn: product.cstCsosn || g?.cstCsosn || "",
    icmsRateBps: g?.icmsRateBps ?? 0,
    pisCst: g?.pisCst || (simples ? "49" : "01"),
    pisRateBps: g?.pisRateBps ?? 0,
    cofinsCst: g?.cofinsCst || (simples ? "49" : "01"),
    cofinsRateBps: g?.cofinsRateBps ?? 0,
    groupId: g?.id ?? null,
    groupName: g?.name ?? null,
    groupIssue: groupValidity(g),
    approxTaxBps: g?.approxTaxBps ?? cfg?.approxTaxBps ?? 0,
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
  insurance?: number;
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
  taxGroupId?: string | null;
  taxGroupName?: string | null;
  taxGroupIssue?: string | null;
  /** valor aproximado dos tributos (Lei 12.741/2012) */
  approxTax?: number;
  /** valores sobrepostos manualmente no formulário (preservados ao atualizar do cadastro) */
  overrides?: { cfop?: string; cstCsosn?: string; taxGroupId?: string };
}

export function computeTotals(items: DocItem[], extra: { freight?: number; insurance?: number; other?: number } = {}) {
  const products = items.reduce((a, i) => a + i.gross, 0);
  const discount = items.reduce((a, i) => a + i.discount, 0);
  const freight = items.reduce((a, i) => a + i.freight, 0);
  const itemInsurance = items.reduce((a, i) => a + (i.insurance ?? 0), 0);
  const insurance = itemInsurance || (extra.insurance ?? 0);
  const other = items.reduce((a, i) => a + i.other, 0);
  return {
    products,
    discount,
    freight,
    insurance,
    other,
    icmsBase: items.reduce((a, i) => a + i.icmsBase, 0),
    icms: items.reduce((a, i) => a + i.icms, 0),
    pis: items.reduce((a, i) => a + i.pis, 0),
    cofins: items.reduce((a, i) => a + i.cofins, 0),
    approxTax: items.reduce((a, i) => a + (i.approxTax ?? 0), 0),
    total: products - discount + freight + insurance + other,
  };
}

export interface ItemLine {
  skuId: string;
  qty: number;
  unitPrice: number;
  discount: number;
  description?: string;
  cfopOverride?: string;
  cstOverride?: string;
  taxGroupId?: string | null;
}

/** Constrói itens fiscais a partir de linhas (venda, pedido ou formulário). Frete/seguro/outras despesas rateados (maior resto). */
export async function buildItems(
  ctx: Ctx,
  lines: ItemLine[],
  opts: { interstate?: boolean; freight?: number; insurance?: number; other?: number; branchId: string | null; kind?: OperationKind },
): Promise<DocItem[]> {
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, opts.branchId);
  const grossList = lines.map((l) => roundDiv(l.unitPrice * l.qty, QTY));
  const weights = grossList.map((g, i) => Math.max(0, g - lines[i].discount));
  const freightAlloc = allocate(opts.freight ?? 0, weights);
  const insAlloc = allocate(opts.insurance ?? 0, weights);
  const otherAlloc = allocate(opts.other ?? 0, weights);
  const out: DocItem[] = [];
  for (const [idx, l] of lines.entries()) {
    const sku = await ctx.store.getOrThrow("skus", l.skuId);
    const product = await ctx.store.getOrThrow("products", sku.productId);
    const tax = await taxFor(ctx.store, product, company, cfg, { interstate: Boolean(opts.interstate), kind: opts.kind ?? "sale", taxGroupId: l.taxGroupId });
    const gross = grossList[idx];
    assert(l.discount >= 0 && l.discount <= gross, `Desconto do item ${idx + 1} inválido.`);
    const net = gross - l.discount + freightAlloc[idx] + insAlloc[idx] + otherAlloc[idx];
    const cst = l.cstOverride || tax.cstCsosn;
    const normal = !["simples", "mei"].includes(company.regime) && ["00", "20"].includes(cst);
    const icmsBase = normal ? net : 0;
    const overrides: DocItem["overrides"] = {};
    if (l.cfopOverride) overrides.cfop = l.cfopOverride;
    if (l.cstOverride) overrides.cstCsosn = l.cstOverride;
    if (l.taxGroupId) overrides.taxGroupId = l.taxGroupId;
    out.push({
      seq: idx + 1,
      skuId: sku.id,
      productId: product.id,
      code: sku.sku,
      description: (l.description || sku.name || product.name).slice(0, 120),
      ncm: onlyDigits(product.ncm),
      cest: product.cest ?? null,
      cfop: l.cfopOverride || tax.cfop,
      unit: sku.unitCode ?? product.unitCode ?? "UN",
      qty: l.qty,
      unitPrice: l.unitPrice,
      gross,
      discount: l.discount,
      freight: freightAlloc[idx],
      insurance: insAlloc[idx],
      other: otherAlloc[idx],
      total: net,
      origin: product.origin ?? "0",
      cstCsosn: cst,
      icmsRateBps: tax.icmsRateBps,
      icmsBase,
      icms: normal ? pct(icmsBase, tax.icmsRateBps) : 0,
      pisCst: tax.pisCst,
      pis: tax.pisRateBps ? pct(net, tax.pisRateBps) : 0,
      cofinsCst: tax.cofinsCst,
      cofins: tax.cofinsRateBps ? pct(net, tax.cofinsRateBps) : 0,
      taxGroupId: tax.groupId,
      taxGroupName: tax.groupName,
      taxGroupIssue: tax.groupIssue,
      approxTax: tax.approxTaxBps ? pct(net, tax.approxTaxBps) : 0,
      overrides,
    });
  }
  return out;
}

/** Pendências de cadastro que impedem a transmissão (verificadas antes de enviar). */
export function validateDocument(doc: Doc, company: Doc, branch: Doc | null): string[] {
  const issues: string[] = [];
  const emit = onlyDigits(branch?.cnpj ?? company.cnpj);
  if (!emit) issues.push("CNPJ do emitente não cadastrado (Fiscal → Configurações → Emitente).");
  else if (!isValidCnpj(emit)) issues.push("CNPJ do emitente inválido.");
  if (doc.model !== "nfse") {
    if (!branch?.ie && !company.ie) issues.push("Inscrição estadual do emitente não cadastrada.");
    if (!(doc.items ?? []).length) issues.push("Documento sem itens.");
    for (const it of doc.items ?? []) {
      if (!/^\d{8}$/.test(it.ncm ?? "")) issues.push(`Item ${it.seq} (${it.code}): NCM ausente ou inválido — corrija no cadastro do produto.`);
      if (!/^\d{4}$/.test(it.cfop ?? "")) issues.push(`Item ${it.seq} (${it.code}): CFOP ausente.`);
      else if (doc.operationType === "entrada" ? !/^[123]/.test(it.cfop) : !/^[567]/.test(it.cfop)) issues.push(`Item ${it.seq} (${it.code}): CFOP ${it.cfop} incompatível com operação de ${doc.operationType ?? "saída"}.`);
      if (!it.cstCsosn) issues.push(`Item ${it.seq} (${it.code}): CST/CSOSN ausente (grupo tributário).`);
      if (it.taxGroupIssue) issues.push(`Item ${it.seq} (${it.code}): ${it.taxGroupIssue}`);
      if (it.qty <= 0) issues.push(`Item ${it.seq} (${it.code}): quantidade inválida.`);
    }
    if (doc.model === "nfe") {
      const r = doc.recipient ?? {};
      const rd = onlyDigits(r.doc);
      if (!rd) issues.push("Destinatário sem CPF/CNPJ.");
      else if (rd.length === 11 ? !isValidCpf(rd) : rd.length === 14 ? !isValidCnpj(rd) : true) issues.push("CPF/CNPJ do destinatário inválido.");
      if (!r.name) issues.push("Nome/razão social do destinatário não informado.");
      if (!r.address?.uf || !r.address?.cityCode || !r.address?.street) issues.push("Endereço do destinatário incompleto (logradouro, município IBGE e UF são obrigatórios na NF-e).");
      if (doc.purpose === "devolucao" && !(doc.service?.referencedKeys ?? []).length) issues.push("NF-e de devolução sem chave de acesso referenciada.");
      const pays = (doc.payments ?? []) as Array<{ kind: string; amount: number }>;
      const paid = pays.filter((p) => p.kind !== "none").reduce((a, p) => a + p.amount, 0);
      const noPayment = pays.some((p) => p.kind === "none");
      if (!noPayment && paid !== (doc.totals?.total ?? 0)) issues.push(`Pagamentos (${formatMoney(paid)}) diferem do total da nota (${formatMoney(doc.totals?.total ?? 0)}).`);
    }
  } else {
    const s = doc.service ?? {};
    if (!s.serviceListItem) issues.push("Item da lista de serviços (LC 116) não informado.");
    if (!s.description) issues.push("Discriminação do serviço não informada.");
    if (!(s.amount > 0)) issues.push("Valor dos serviços deve ser maior que zero.");
    if (!branch?.im && !company.im) issues.push("Inscrição municipal do prestador não cadastrada.");
    if (!branch?.cityCode) issues.push("Código IBGE do município do prestador não cadastrado na filial.");
    const rd = onlyDigits(doc.recipient?.doc);
    if (rd && (rd.length === 11 ? !isValidCpf(rd) : rd.length === 14 ? !isValidCnpj(rd) : true)) issues.push("CPF/CNPJ do tomador inválido.");
    if (s.issWithheld && rd.length !== 14) issues.push("ISS retido exige tomador pessoa jurídica (CNPJ).");
  }
  return issues;
}

const money = (c: number) => Number((c / 100).toFixed(2));
const qtyNum = (m: number) => Number((m / QTY).toFixed(4));

/** Converte o documento interno para o payload da Focus NFe (também usado pelo simulador). */
export function toProviderPayload(doc: Doc, company: Doc, branch: Doc | null, cfg: Doc | null): Record<string, any> {
  const emitCnpj = onlyDigits(branch?.cnpj ?? company.cnpj);
  if (doc.model === "nfse") {
    const s = doc.service;
    const r = doc.recipient ?? {};
    const rdoc = onlyDigits(r.doc);
    if ((s.standard ?? cfg?.nfseStandard) === "nacional") {
      // NFS-e padrão nacional (DPS) — /v2/nfsen
      return {
        data_emissao: doc.issuedAt ?? nowIso(),
        data_competencia: s.competence,
        codigo_municipio_emissora: branch?.cityCode,
        cnpj_prestador: emitCnpj,
        inscricao_municipal_prestador: branch?.im ?? company.im,
        codigo_opcao_simples_nacional: ["simples", "mei"].includes(company.regime) ? (company.regime === "mei" ? 2 : 3) : 1,
        ...(rdoc.length === 14 ? { cnpj_tomador: rdoc } : rdoc ? { cpf_tomador: rdoc } : {}),
        razao_social_tomador: r.name,
        inscricao_municipal_tomador: r.im || undefined,
        email_tomador: r.email || undefined,
        codigo_municipio_tomador: r.address?.cityCode,
        cep_tomador: onlyDigits(r.address?.zip) || undefined,
        logradouro_tomador: r.address?.street,
        numero_tomador: r.address?.number,
        bairro_tomador: r.address?.district,
        codigo_municipio_prestacao: s.serviceCityCode ?? branch?.cityCode,
        codigo_tributacao_nacional_iss: s.nationalCode || onlyDigits(s.serviceListItem).padEnd(6, "0"),
        codigo_tributacao_municipal_iss: s.municipalCode || undefined,
        descricao_servico: s.description,
        valor_servico: money(s.amount),
        desconto_incondicionado: money(s.unconditionalDiscount ?? 0),
        tributacao_iss: Number(s.issExigibility ?? 1),
        tipo_retencao_iss: s.issWithheld ? 2 : 1,
        percentual_aliquota_iss: s.issRateBps / 100,
        valor_inss: money(s.inss ?? 0),
        valor_ir: money(s.ir ?? 0),
        valor_csll: money(s.csll ?? 0),
        valor_pis: money(s.pis ?? 0),
        valor_cofins: money(s.cofins ?? 0),
        item_lista_servico: s.serviceListItem,
        prestador: { cnpj: emitCnpj },
        servico: { item_lista_servico: s.serviceListItem, valor_servicos: money(s.amount) },
        tomador: rdoc.length === 14 ? { cnpj: rdoc } : rdoc ? { cpf: rdoc } : {},
      };
    }
    return {
      data_emissao: doc.issuedAt ?? nowIso(),
      natureza_operacao: s.nature ?? "1",
      optante_simples_nacional: ["simples", "mei"].includes(company.regime),
      prestador: { cnpj: emitCnpj, inscricao_municipal: branch?.im ?? company.im, codigo_municipio: branch?.cityCode },
      tomador: {
        ...(rdoc.length === 14 ? { cnpj: rdoc } : rdoc ? { cpf: rdoc } : {}),
        razao_social: r.name,
        email: r.email || undefined,
        inscricao_municipal: r.im || undefined,
        endereco: r.address ? { logradouro: r.address.street, numero: r.address.number, bairro: r.address.district, codigo_municipio: r.address.cityCode, uf: r.address.uf, cep: onlyDigits(r.address.zip) } : undefined,
      },
      servico: {
        aliquota: s.issRateBps / 100,
        discriminacao: s.description,
        iss_retido: Boolean(s.issWithheld),
        item_lista_servico: s.serviceListItem,
        codigo_tributario_municipio: s.municipalCode || undefined,
        codigo_cnae: s.cnae || undefined,
        codigo_municipio: s.serviceCityCode ?? branch?.cityCode,
        exigibilidade_iss: Number(s.issExigibility ?? 1),
        valor_servicos: money(s.amount),
        desconto_incondicionado: money(s.unconditionalDiscount ?? 0),
        valor_deducoes: money(s.deductions ?? 0),
        base_calculo: money(s.base ?? s.amount),
        valor_iss: money(s.iss),
        valor_iss_retido: s.issWithheld ? money(s.iss) : undefined,
        valor_pis: s.withhold?.pis ? money(s.pis ?? 0) : undefined,
        valor_cofins: s.withhold?.cofins ? money(s.cofins ?? 0) : undefined,
        valor_inss: s.withhold?.inss ? money(s.inss ?? 0) : undefined,
        valor_ir: s.withhold?.ir ? money(s.ir ?? 0) : undefined,
        valor_csll: s.withhold?.csll ? money(s.csll ?? 0) : undefined,
        valor_liquido: money(s.net ?? s.amount),
      },
    };
  }
  const r = doc.recipient ?? null;
  const rdoc = onlyDigits(r?.doc);
  const t = doc.totals;
  const emitUf = branch?.uf ?? company.address?.uf;
  const payload: Record<string, any> = {
    natureza_operacao: doc.nature ?? "Venda de mercadoria",
    data_emissao: doc.issuedAt ?? nowIso(),
    tipo_documento: doc.operationType === "entrada" ? 0 : 1,
    finalidade_emissao: { normal: 1, complementar: 2, ajuste: 3, devolucao: 4 }[doc.purpose as string] ?? 1,
    cnpj_emitente: onlyDigits(branch?.cnpj ?? company.cnpj),
    presenca_comprador: doc.model === "nfce" ? Number(doc.presence ?? 1) : Number(doc.presence ?? cfg?.defaultPresence ?? 1),
    consumidor_final: doc.model === "nfce" || !r?.ie || r?.finalConsumer ? 1 : 0,
    local_destino: doc.model === "nfce" || !r?.address?.uf || r.address.uf === emitUf ? 1 : 2,
    modalidade_frete: Number(doc.transport?.mode ?? 9),
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
      valor_seguro: i.insurance ? money(i.insurance) : undefined,
      valor_outras_despesas: i.other ? money(i.other) : undefined,
      icms_origem: Number(i.origin ?? 0),
      icms_situacao_tributaria: i.cstCsosn,
      icms_base_calculo: i.icmsBase ? money(i.icmsBase) : undefined,
      icms_aliquota: i.icmsBase ? i.icmsRateBps / 100 : undefined,
      icms_valor: i.icms ? money(i.icms) : undefined,
      pis_situacao_tributaria: i.pisCst,
      cofins_situacao_tributaria: i.cofinsCst,
      valor_total_tributos: i.approxTax ? money(i.approxTax) : undefined,
      inclui_no_total: 1,
    })),
    formas_pagamento: (doc.payments ?? []).map((p: any) => ({ forma_pagamento: TPAG[p.kind] ?? "99", valor_pagamento: p.kind === "none" ? 0 : money(p.amount) })),
  };
  if (doc.number) payload.numero = doc.number;
  if (doc.series) payload.serie = doc.series;
  if (t.approxTax) payload.valor_total_tributos = money(t.approxTax);
  if (doc.exitAt && doc.model === "nfe") payload.data_entrada_saida = doc.exitAt;
  if (r) {
    if (rdoc.length === 14) payload.cnpj_destinatario = rdoc;
    else if (rdoc) payload.cpf_destinatario = rdoc;
    if (r.name) payload.nome_destinatario = r.name;
    if (doc.model === "nfe") {
      payload.indicador_inscricao_estadual_destinatario = Number(r.ieIndicator ?? (r.ie && r.ie !== "ISENTO" ? 1 : r.ie === "ISENTO" ? 2 : 9));
      if (r.ie && r.ie !== "ISENTO") payload.inscricao_estadual_destinatario = r.ie;
      if (r.address) {
        payload.logradouro_destinatario = r.address.street;
        payload.numero_destinatario = r.address.number || "S/N";
        if (r.address.complement) payload.complemento_destinatario = r.address.complement;
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
    if (doc.transport.carrierUf) payload.uf_transportador = doc.transport.carrierUf;
  }
  if (doc.transport?.vehiclePlate) {
    payload.veiculo_placa = String(doc.transport.vehiclePlate).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (doc.transport.vehicleUf) payload.veiculo_uf = doc.transport.vehicleUf;
  }
  if (doc.transport?.volumes)
    payload.volumes = [{ quantidade: doc.transport.volumes, especie: doc.transport.species || undefined, peso_bruto: doc.transport.grossWeightKg || undefined, peso_liquido: doc.transport.netWeightKg || undefined }];
  if (doc.service?.referencedKeys?.length) payload.notas_referenciadas = doc.service.referencedKeys.map((k: string) => ({ chave_nfe: k }));
  if (doc.service?.additionalInfo) payload.informacoes_adicionais_contribuinte = doc.service.additionalInfo;
  return payload;
}

// ───────────────────────────── Criação

export interface DocEffects {
  /** baixa (saída) ou entrada de estoque na autorização */
  stock?: boolean;
  /** título a receber (saída) / a pagar (entrada) na autorização */
  financial?: boolean;
  warehouseId?: string | null;
  dueDate?: string | null;
  paymentTermId?: string | null;
  categoryId?: string | null;
  /** valor do título (NFS-e: líquido); padrão = total do documento */
  amount?: number | null;
  appliedAt?: string | null;
  reversedAt?: string | null;
  movements?: number;
  titleId?: string | null;
  note?: string | null;
}

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
  presence?: string | null;
  recipient?: Record<string, any> | null;
  partyType?: string | null;
  partyId?: string | null;
  items?: DocItem[];
  totals?: ReturnType<typeof computeTotals>;
  payments?: Array<{ kind: string; amount: number }>;
  transport?: Record<string, any> | null;
  service?: Record<string, any> | null;
  terminalId?: string | null;
  series?: string | null;
  status?: "draft" | "queued";
  effects?: DocEffects | null;
  competenceDate?: string | null;
  exitAt?: string | null;
  total: number;
}

export async function createDocument(ctx: Ctx, input: CreateDocInput) {
  const id = detId("fiscaldoc", input.ref);
  const existing = await ctx.store.get("fiscal_documents", id);
  if (existing) return existing;
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, input.branchId);
  const provider = providerFor(ctx.store, cfg);
  const enabled = input.model === "nfse" ? cfg?.nfseEnabled : input.model === "nfce" ? cfg?.nfceEnabled : cfg?.nfeEnabled;
  let status: string = input.status ?? "queued";
  let statusMessage: string | null = null;
  if (!cfg || !provider || enabled === false) {
    status = input.status === "draft" ? "draft" : "pending";
    statusMessage = !cfg
      ? "Configuração fiscal da filial não cadastrada (Fiscal → Configurações)."
      : enabled === false
        ? `Emissão de ${MODEL_LABEL[input.model]} desabilitada na configuração fiscal.`
        : credentialMessage(cfg);
  }
  const contingency = input.model === "nfce" && status === "queued" && Boolean(cfg?.contingency);
  if (contingency) statusMessage = "Contingência ativa: transmissão retida na fila até a normalização (Fiscal → NFC-e → Pendências).";
  const series = input.series ?? (input.model === "nfce" ? (cfg?.nfceSeries ?? 1) : input.model === "nfe" ? (cfg?.nfeSeries ?? 1) : null);
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
        presence: input.presence ?? (input.model === "nfce" ? "1" : (cfg?.defaultPresence ?? "1")),
        recipient: input.recipient ?? null,
        recipientName: input.recipient?.name ?? null,
        recipientDoc: onlyDigits(input.recipient?.doc) || null,
        partyType: input.partyType ?? null,
        partyId: input.partyId ?? null,
        items: input.items ?? [],
        totals: input.totals ?? null,
        payments: input.payments ?? [],
        transport: input.transport ?? null,
        service: input.service ?? null,
        effects: input.effects ?? null,
        competenceDate: input.competenceDate ?? null,
        exitAt: input.exitAt ?? null,
        issuedAt: nowIso(),
        attempts: 0,
        isSimulated: Boolean(provider?.simulated),
        contingency,
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
  await audit(ctx, {
    module: "fiscal",
    action: "document.create",
    entityType: "fiscal_document",
    entityId: doc.id,
    summary: `${MODEL_LABEL[input.model]} criada (${DOC_STATUS_LABEL[status]}) — ${formatMoney(input.total)}`,
    related: [input.originId ? `${input.originType}:${input.originId}` : "", input.partyId ? `${input.partyType}:${input.partyId}` : ""].filter(Boolean),
    branchId: input.branchId,
  });
  if (status === "queued" && !contingency) await enqueue(ctx.store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: input.branchId }, dedupeKey: `fiscal-transmit:${doc.id}:1`, companyId: ctx.companyId });
  if (status === "pending") await raiseFiscalIssue(ctx, doc, statusMessage!);
  await syncOrigin(ctx, doc);
  return doc;
}

export async function addEvent(ctx: Ctx, documentId: string, type: string, status: string, message: string, request?: unknown, response?: unknown, protocol?: string) {
  const { sanitize } = await import("@/lib/core/audit");
  const doc = await ctx.store.get("fiscal_documents", documentId);
  await ctx.store.create("fiscal_events", {
    companyId: ctx.companyId,
    branchId: doc?.branchId ?? ctx.branchId,
    createdBy: ctx.user.id,
    documentId,
    type,
    status,
    seq: Date.now(),
    message: (message ?? "").slice(0, 4000),
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
    title: `${MODEL_LABEL[doc.model]} ${doc.number ? "nº " + doc.number : doc.ref} com pendência`,
    body: message.slice(0, 500),
    link: `/fiscal/${doc.model}/${doc.id}`,
    originType: "fiscal_document",
    originId: doc.id,
    occurrenceKey: `fiscal:${doc.id}`,
    audience: { action: "fiscal.issue" },
  }).catch(() => undefined);
}

/** Mantém a situação fiscal da origem (venda) alinhada ao documento. */
async function syncOrigin(ctx: Ctx, doc: Doc) {
  if (doc.originType === "sale" && doc.originId && doc.model === "nfce") {
    await ctx.store.update("sales", doc.originId, { fiscalStatus: doc.status, fiscalDocumentId: doc.id }).catch(() => undefined);
  }
  if (doc.originType === "return" && doc.originId) {
    await ctx.store.update("returns", doc.originId, { fiscalDocumentId: doc.id }).catch(() => undefined);
  }
}

export async function createNfceForSale(ctx: Ctx, saleId: string) {
  const sale = await ctx.store.getOrThrow("sales", saleId);
  const items = await listAll(ctx.store, "sale_items", { filters: [["eq", "saleId", saleId]], orderBy: [{ field: "seq" }] });
  const payments = await listAll(ctx.store, "sale_payments", { filters: [["eq", "saleId", saleId]] });
  const docItems = await buildItems(
    ctx,
    items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice, discount: (i.itemDiscount ?? 0) + (i.globalDiscount ?? 0), description: i.description })),
    { branchId: sale.branchId, other: items.reduce((a, i) => a + (i.surcharge ?? 0), 0), kind: "sale" },
  );
  const totals = computeTotals(docItems);
  const c = sale.customerSnapshot;
  const terminal = sale.terminalId ? await ctx.store.get("terminals", sale.terminalId) : null;
  // pagamentos proporcionais ao total fiscal (troco não compõe o valor)
  const pays = payments.filter((p) => !["cancelled", "refunded"].includes(p.status)).map((p) => ({ kind: p.methodKind, amount: p.amount }));
  const paySum = pays.reduce((a, p) => a + p.amount, 0);
  if (paySum !== totals.total && pays.length) {
    const alloc = allocate(totals.total, pays.map((p) => p.amount));
    pays.forEach((p, i) => (p.amount = alloc[i]));
  }
  return createDocument(ctx, {
    model: "nfce",
    ref: `nfce-${saleId}`,
    branchId: sale.branchId,
    originType: "sale",
    originId: saleId,
    operationId: saleId,
    recipient: c?.doc ? { name: c.name, doc: c.doc, email: c.email } : null,
    partyType: sale.customerId ? "customer" : null,
    partyId: sale.customerId ?? null,
    items: docItems,
    totals,
    payments: pays,
    terminalId: sale.terminalId,
    series: terminal?.nfceSeries ? String(terminal.nfceSeries) : null,
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
    ritems.map((r) => ({ skuId: r.skuId, qty: r.qty, unitPrice: r.unitPrice, discount: Math.max(0, roundDiv(r.unitPrice * r.qty, QTY) - r.total) })),
    { branchId: ret.branchId, kind: "sale_return" },
  );
  const totals = computeTotals(docItems);
  const c = sale.customerSnapshot;
  const customer = sale.customerId ? await ctx.store.get("customers", sale.customerId) : null;
  const addr = customer?.addresses?.[0] ?? c?.address ?? null;
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
    recipient: c ? { name: customer?.name ?? c.name, doc: customer?.doc ?? c.doc, email: customer?.email ?? c.email, address: addr, ie: customer?.ie ?? c.ie, ieIndicator: customer?.ieIndicator } : null,
    partyType: sale.customerId ? "customer" : null,
    partyId: sale.customerId ?? null,
    items: docItems,
    totals,
    payments: [{ kind: "none", amount: 0 }],
    service: { referencedKeys: original.accessKey ? [original.accessKey] : [] },
    status: "draft",
    total: totals.total,
    effects: { stock: false, financial: false, note: "Estoque e reembolso já tratados pela devolução de venda." },
  });
  await ctx.store.update("returns", returnId, { fiscalDocumentId: doc.id });
  return doc;
}

// ───────────────────────────── Efeitos (operação avulsa) — aplicados uma única vez na autorização

async function applyDocumentEffects(ctx: Ctx, doc: Doc) {
  const eff: DocEffects = doc.effects ?? {};
  if ((!eff.stock && !eff.financial) || eff.appliedAt) return;
  const patch: DocEffects = { ...eff };
  const sign = doc.operationType === "entrada" ? 1 : -1;
  const label = `${MODEL_LABEL[doc.model]} nº ${doc.number ?? doc.rpsNumber ?? doc.ref}`;
  if (eff.stock && doc.model !== "nfse") {
    const { defaultWarehouse, postMovements } = await import("../stock");
    const wid = eff.warehouseId || (await defaultWarehouse(ctx.store, doc.branchId)).id;
    const items = (doc.items as DocItem[]).filter((i) => i.skuId);
    const movs = await postMovements(
      ctx,
      items.map((i) => ({
        warehouseId: wid,
        skuId: i.skuId!,
        qty: sign * i.qty,
        type: sign > 0 ? ("manual_in" as const) : ("manual_out" as const),
        unitCost: sign > 0 ? roundDiv(i.total * QTY, i.qty) : null,
        originType: "fiscal_document",
        originId: doc.id,
        operationId: doc.id,
        reason: `${label} — ${doc.nature}`,
        idemKey: `fiscaldoc:${doc.id}:${i.seq}`,
        allowNegative: true,
      })),
    );
    patch.warehouseId = wid;
    patch.movements = movs.length || items.length;
  }
  if (eff.financial) {
    const { createTitle, buildSchedule } = await import("../finance");
    const amount = eff.amount ?? doc.total;
    const kind = doc.operationType === "entrada" ? "payable" : "receivable";
    const term = eff.paymentTermId ? await ctx.store.get("payment_terms", eff.paymentTermId) : null;
    const installments = term ? buildSchedule(amount, term as any) : [{ dueDate: eff.dueDate || today(), amount }];
    const catKey = kind === "receivable" ? (doc.model === "nfse" ? "finance.category.services" : "finance.category.sales") : "finance.category.purchases";
    const categoryId = eff.categoryId ?? (await getSetting<string | null>(ctx.store, ctx.companyId, doc.branchId, catKey, null)) ?? (await getSetting<string | null>(ctx.store, ctx.companyId, doc.branchId, "finance.category.sales", null));
    if (amount > 0) {
      const title = await createTitle(ctx, {
        kind,
        partyType: doc.partyType === "supplier" ? "supplier" : doc.partyType === "customer" ? "customer" : "other",
        partyId: doc.partyId ?? null,
        partyName: doc.recipientName ?? null,
        description: `${label} — ${doc.nature}`,
        documentNumber: String(doc.number ?? doc.rpsNumber ?? ""),
        originType: "fiscal_document",
        originId: doc.id,
        installments,
        categoryId,
        idemKey: `fiscaldoc:${doc.id}`,
        branchId: doc.branchId,
        competenceDate: doc.competenceDate ?? undefined,
      });
      patch.titleId = title.id;
      await ctx.store.update("fiscal_documents", doc.id, { titleId: title.id });
    }
  }
  patch.appliedAt = nowIso();
  await ctx.store.update("fiscal_documents", doc.id, { effects: patch });
  await addEvent(ctx, doc.id, "effects", "authorized", [eff.stock && doc.model !== "nfse" ? `Estoque: ${patch.movements} movimento(s) de ${sign > 0 ? "entrada" : "saída"}` : "", eff.financial ? `Título ${doc.operationType === "entrada" ? "a pagar" : "a receber"} gerado` : ""].filter(Boolean).join(" · "));
  await audit(ctx, { module: "fiscal", action: "document.effects", entityType: "fiscal_document", entityId: doc.id, summary: `Efeitos da ${label} aplicados (estoque: ${eff.stock ? "sim" : "não"}, financeiro: ${eff.financial ? "sim" : "não"})`, related: patch.titleId ? [`title:${patch.titleId}`] : [], branchId: doc.branchId });
}

async function reverseDocumentEffects(ctx: Ctx, doc: Doc, reason: string) {
  const eff: DocEffects = doc.effects ?? {};
  if (!eff.appliedAt || eff.reversedAt) return;
  const notes: string[] = [];
  if (eff.stock && doc.model !== "nfse") {
    const { postMovements } = await import("../stock");
    const sign = doc.operationType === "entrada" ? -1 : 1;
    const items = (doc.items as DocItem[]).filter((i) => i.skuId);
    await postMovements(
      ctx,
      items.map((i) => ({
        warehouseId: eff.warehouseId!,
        skuId: i.skuId!,
        qty: sign * i.qty,
        type: sign > 0 ? ("manual_in" as const) : ("manual_out" as const),
        originType: "fiscal_document_cancel",
        originId: doc.id,
        operationId: doc.id,
        reason: `Cancelamento ${MODEL_LABEL[doc.model]} nº ${doc.number}: ${reason}`.slice(0, 290),
        idemKey: `fiscaldoc-cancel:${doc.id}:${i.seq}`,
        allowNegative: true,
      })),
    );
    notes.push("estoque estornado");
  }
  if (eff.titleId) {
    const { cancelTitle } = await import("../finance");
    try {
      await cancelTitle(ctx, eff.titleId, `Cancelamento do documento fiscal: ${reason}`);
      notes.push("título cancelado");
    } catch (e: any) {
      notes.push(`título NÃO cancelado: ${e.message}`);
      await notify(ctx.store, { companyId: ctx.companyId, branchId: doc.branchId, type: "info", priority: "high", title: `Título do documento ${MODEL_LABEL[doc.model]} nº ${doc.number ?? ""} exige ação`, body: `O documento foi cancelado, mas o título possui baixas: ${e.message}`, link: `/financeiro/${doc.operationType === "entrada" ? "pagar" : "receber"}/${eff.titleId}`, originType: "fiscal_document", originId: doc.id, occurrenceKey: `fiscal-title:${doc.id}`, audience: { action: "finance.reverse" } }).catch(() => undefined);
    }
  }
  await ctx.store.update("fiscal_documents", doc.id, { effects: { ...eff, reversedAt: nowIso() } });
  await addEvent(ctx, doc.id, "effects_reversal", "cancelled", `Efeitos revertidos: ${notes.join(" · ") || "—"}`);
}

// ───────────────────────────── Transmissão / retorno

async function applyResult(ctx: Ctx, doc: Doc, r: ProviderResult, eventType: string, provider: FiscalProvider) {
  const map: Record<string, string> = { processing: "processing", authorized: "authorized", rejected: "rejected", denied: "denied", cancelled: "cancelled", error: "error", unused: "unused" };
  const status = map[r.status] ?? "error";
  const patch: Record<string, any> = {
    status,
    statusCode: r.statusCode ?? null,
    statusMessage: r.message ?? null,
    lastAttemptAt: nowIso(),
  };
  if (r.accessKey) patch.accessKey = r.accessKey;
  if (r.number && (doc.model === "nfse" || !doc.number)) patch.number = r.number;
  if (r.series && !doc.series) patch.series = r.series;
  if (r.protocol) patch.protocol = r.protocol;
  if (r.verificationCode) patch.verificationCode = r.verificationCode;
  if (r.qrCodeUrl) patch.qrCodeUrl = r.qrCodeUrl;
  if (r.danfePath) patch.danfeUrl = provider.fileUrl(r.danfePath);
  if (r.xmlPath) patch.xmlUrl = provider.fileUrl(r.xmlPath);
  if (r.contingency) patch.contingency = true;
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
    const f = await saveFile(ctx, { bucket: "documents", name: `SIMULACAO-${updated.accessKey ?? doc.ref}.xml`, mime: "application/xml", data: xml, entityType: "fiscal_document", entityId: doc.id, kind: "xml", branchId: doc.branchId });
    await ctx.store.update("fiscal_documents", doc.id, { xmlFileId: f.id });
  }
  if (status === "rejected" && doc.cancelRequestedAt) {
    // origem já cancelada: documento rejeitado não precisa ser corrigido — descarta
    const disc = await ctx.store.update("fiscal_documents", doc.id, { status: "discarded", statusMessage: `Descartado: origem cancelada e documento rejeitado (${r.message ?? ""}).` });
    await addEvent(ctx, doc.id, "discard", "discarded", "Origem cancelada; documento rejeitado descartado.");
    await resolveOccurrence(ctx.store, `fiscal:${doc.id}`);
    await syncOrigin(ctx, disc);
    return disc;
  }
  if (["rejected", "denied", "error"].includes(status)) await raiseFiscalIssue(ctx, updated, r.message ?? DOC_STATUS_LABEL[status]);
  if (["authorized", "cancelled", "unused", "discarded"].includes(status)) await resolveOccurrence(ctx.store, `fiscal:${doc.id}`);
  if (status === "authorized") {
    try {
      await applyDocumentEffects(ctx, await ctx.store.getOrThrow("fiscal_documents", doc.id));
    } catch (e: any) {
      await addEvent(ctx, doc.id, "effects", "error", `Falha ao aplicar efeitos: ${e.message}`);
      await raiseFiscalIssue(ctx, updated, `Documento autorizado, mas os efeitos (estoque/financeiro) falharam: ${e.message}`);
    }
    // envio automático do XML ao destinatário (parâmetro da configuração fiscal)
    const cfgAuto = await getFiscalConfig(ctx.store, ctx.companyId, doc.branchId);
    const to = updated.recipient?.email;
    if (cfgAuto?.autoEmail && to && !doc.authorizedAt && !doc.cancelRequestedAt) {
      await enqueue(ctx.store, { type: "fiscal.email", payload: { documentId: doc.id, to, branchId: doc.branchId }, dedupeKey: `fiscal-email:${doc.id}:auto`, companyId: ctx.companyId });
    }
    // origem cancelada enquanto processava: cancela após a autorização
    if (doc.cancelRequestedAt) {
      await enqueue(ctx.store, { type: "fiscal.cancel", payload: { documentId: doc.id, justification: doc.cancelReason ?? "Cancelamento solicitado pela origem da operação.", branchId: doc.branchId }, dedupeKey: `fiscal-cancel:${doc.id}`, companyId: ctx.companyId });
    }
  }
  await syncOrigin(ctx, updated);
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

function simulatedXml(doc: Doc) {
  const esc = (s: any) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const items = (doc.items ?? []).map((i: any) => `    <item n="${i.seq}" codigo="${esc(i.code)}" ncm="${esc(i.ncm)}" cfop="${esc(i.cfop)}" qtd="${i.qty / QTY}" valor="${(i.total / 100).toFixed(2)}">${esc(i.description)}</item>`).join("\n");
  const s = doc.service;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIMULAÇÃO INTERCERT — DOCUMENTO SEM VALIDADE FISCAL. Não substitui o XML autorizado pela SEFAZ/prefeitura. -->
<documentoSimulado modelo="${doc.model}" ref="${esc(doc.ref)}" numero="${doc.number ?? ""}" serie="${esc(doc.series)}" chave="${esc(doc.accessKey)}" protocolo="${esc(doc.protocol)}" ambiente="simulacao">
  <emissao>${esc(doc.issuedAt)}</emissao>
  <autorizacao>${esc(doc.authorizedAt ?? nowIso())}</autorizacao>
  <destinatario nome="${esc(doc.recipientName)}" doc="${esc(doc.recipientDoc)}"/>
  <natureza>${esc(doc.nature)}</natureza>
${s ? `  <servico item="${esc(s.serviceListItem)}" rps="${esc(doc.rpsNumber)}" valor="${((s.amount ?? 0) / 100).toFixed(2)}" iss="${((s.iss ?? 0) / 100).toFixed(2)}" liquido="${((s.net ?? 0) / 100).toFixed(2)}">${esc(s.description)}</servico>\n` : ""}  <itens>
${items}
  </itens>
  <total>${((doc.total ?? 0) / 100).toFixed(2)}</total>
</documentoSimulado>`;
}

async function providerForDoc(ctx: Ctx, doc: Doc) {
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, doc.branchId);
  const provider = providerFor(ctx.store, cfg ? ({ ...cfg, provider: doc.provider ?? cfg.provider } as Doc) : null);
  return { cfg, provider };
}

export async function transmitDocument(ctx: Ctx, documentId: string) {
  let doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  if (FINAL.includes(doc.status)) return doc;
  const company = await ctx.store.getOrThrow("companies", doc.companyId);
  const branch = doc.branchId ? await ctx.store.get("branches", doc.branchId) : null;
  const { cfg, provider } = await providerForDoc(ctx, doc);
  if (!cfg || !provider) {
    const msg = credentialMessage(cfg);
    doc = await ctx.store.update("fiscal_documents", doc.id, { status: "pending", statusMessage: msg });
    await addEvent(ctx, doc.id, "validation", "pending", msg);
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
  // verificação prévia de disponibilidade (parâmetro): não envia se o último teste (≤10 min) falhou ou o novo teste falhar
  if (cfg.checkAvailability) {
    const fresh = cfg.lastTestAt && Date.now() - new Date(cfg.lastTestAt).getTime() < 10 * 60000;
    let ok = fresh ? !["error", "unavailable", "not_configured"].includes(cfg.connectionStatus) : true;
    let msg = cfg.lastTestResult ?? "";
    if (!fresh) {
      try {
        const r = await provider.test(onlyDigits(branch?.cnpj ?? company.cnpj));
        ok = r.ok;
        msg = r.message;
      } catch (e: any) {
        ok = false;
        msg = e.message;
      }
      await ctx.store.update("fiscal_configs", cfg.id, { lastTestAt: nowIso(), lastTestResult: msg.slice(0, 500), connectionStatus: ok ? (provider.simulated ? "simulated" : "operational") : "error" });
    }
    if (!ok) {
      doc = await ctx.store.update("fiscal_documents", doc.id, { status: "error", statusMessage: `Verificação prévia: serviço indisponível — documento não enviado (${msg}).`.slice(0, 1000), lastAttemptAt: nowIso() });
      await addEvent(ctx, doc.id, "validation", "error", `Verificação de disponibilidade falhou: ${msg}`);
      await raiseFiscalIssue(ctx, doc, `Serviço fiscal indisponível na verificação prévia: ${msg}`);
      await syncOrigin(ctx, doc);
      const n = Date.now();
      await enqueue(ctx.store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: doc.branchId }, dedupeKey: `fiscal-transmit:${doc.id}:avail-${Math.floor(n / 60000)}`, companyId: ctx.companyId, runAt: new Date(n + 5 * 60000).toISOString() });
      return doc;
    }
  }
  doc = await ensureNumber(ctx, doc, cfg);
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
  const current = await ctx.store.getOrThrow("fiscal_documents", doc.id);
  await addEvent(ctx, doc.id, "request", "processing", `Envio nº ${current.attempts} ao provedor (${provider.simulated ? "simulação" : provider.id})`, payload);
  const updated = await applyResult(ctx, current, r, "send", provider);
  if (updated.status === "processing" || updated.status === "error") {
    const attempt = (updated.attempts ?? 1) + 1;
    await enqueue(ctx.store, {
      type: updated.status === "processing" ? "fiscal.query" : "fiscal.transmit",
      payload: { documentId: doc.id, branchId: doc.branchId },
      dedupeKey: `fiscal-${updated.status === "processing" ? "query" : "transmit"}:${doc.id}:${attempt}`,
      companyId: ctx.companyId,
      runAt: new Date(Date.now() + Math.min(300, attempt * attempt * 5) * 1000).toISOString(),
    });
  }
  return updated;
}

export async function queryDocument(ctx: Ctx, documentId: string) {
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  const { cfg, provider } = await providerForDoc(ctx, doc);
  assert(provider, "Provedor fiscal indisponível (configuração ou credencial ausente).");
  if ((doc.attempts ?? 0) === 0) throw new BusinessError("Documento ainda não foi transmitido ao provedor — não há o que consultar.", "not_sent");
  let r: ProviderResult;
  try {
    r = await provider!.query(doc.model, doc.ref, { nfseStandard: cfg?.nfseStandard });
  } catch (e: any) {
    r = { status: "error", message: `Falha na consulta: ${e.message}` };
  }
  // consulta sem resposta válida (comunicação/referência inexistente) não rebaixa documento autorizado, cancelado ou rejeitado
  if (r.status === "error" && [...FINAL, "rejected"].includes(doc.status)) {
    await addEvent(ctx, doc.id, "query", doc.status, `Consulta sem resposta válida (situação mantida): ${r.message}`);
    return doc;
  }
  const updated = await applyResult(ctx, doc, r, "query", provider!);
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
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  assert(RETRANSMITTABLE.includes(doc.status), `Documento ${DOC_STATUS_LABEL[doc.status]} não pode ser retransmitido.`);
  await ctx.store.update("fiscal_documents", doc.id, { status: "queued" });
  await addEvent(ctx, doc.id, "retry", "queued", `Retransmissão solicitada por ${ctx.user.name} (mesma referência ${doc.ref})`);
  await audit(ctx, { module: "fiscal", action: "document.retransmit", entityType: "fiscal_document", entityId: doc.id, summary: `${MODEL_LABEL[doc.model]} ${doc.number ? "nº " + doc.number : doc.ref} retransmitida (mesma referência)`, branchId: doc.branchId, related: doc.originId ? [`${doc.originType}:${doc.originId}`] : [] });
  return transmitDocument(ctx, doc.id);
}

/** Retransmissão/consulta em lote (fila de pendentes e contingência). Nunca cria documento novo. */
export async function retransmitBatch(ctx: Ctx, input: { model: FiscalModel; branchId?: string | null; ids?: string[] }) {
  requireAction(ctx, "fiscal.issue");
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "model", input.model], ["eq", "status", ["queued", "error", "pending", "processing"]]];
  if (input.branchId) filters.push(["eq", "branchId", input.branchId]);
  let docs = await listAll(ctx.store, "fiscal_documents", { filters });
  if (input.ids?.length) docs = docs.filter((d) => input.ids!.includes(d.id));
  const out: Array<{ id: string; before: string; after: string }> = [];
  for (const d of docs) {
    try {
      const r = d.status === "processing" ? await queryDocument(ctx, d.id) : await retransmit(ctx, d.id);
      out.push({ id: d.id, before: d.status, after: r.status });
    } catch (e: any) {
      out.push({ id: d.id, before: d.status, after: `falha: ${e.message}` });
    }
  }
  await audit(ctx, { module: "fiscal", action: "document.batch_retransmit", entityType: "fiscal_document", entityId: null, summary: `Retransmissão em lote de ${MODEL_LABEL[input.model]}: ${out.length} documento(s)`, after: { results: out.slice(0, 50) } });
  return out;
}

async function releaseContingencyQueue(ctx: Ctx, branchId: string | null) {
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "model", "nfce"], ["eq", "status", "queued"], ["eq", "contingency", true]];
  if (branchId) filters.push(["eq", "branchId", branchId]);
  const docs = await listAll(ctx.store, "fiscal_documents", { filters });
  for (const d of docs) {
    await addEvent(ctx, d.id, "contingency_release", "queued", "Contingência encerrada: documento liberado para transmissão.");
    await enqueue(ctx.store, { type: "fiscal.transmit", payload: { documentId: d.id, branchId: d.branchId }, dedupeKey: `fiscal-transmit:${d.id}:release-${Date.now()}`, companyId: ctx.companyId });
  }
  return docs.length;
}

/** Prazo de cancelamento (parametrizável): NF-e em horas, NFC-e em minutos a partir da autorização. */
export function cancelWindow(doc: Doc, cfg: Doc | null): { allowed: boolean; until: string | null; reason?: string } {
  if (doc.status !== "authorized") return { allowed: false, until: null, reason: `Documento ${DOC_STATUS_LABEL[doc.status] ?? doc.status}.` };
  if (doc.model === "nfse") return { allowed: true, until: null };
  const base = new Date(doc.authorizedAt ?? doc.issuedAt).getTime();
  const ms = doc.model === "nfce" ? (cfg?.nfceCancelMinutes ?? 30) * 60000 : (cfg?.nfeCancelHours ?? 24) * 3600000;
  const until = new Date(base + ms).toISOString();
  if (Date.now() > base + ms)
    return { allowed: false, until, reason: `Prazo de cancelamento encerrado em ${new Date(until).toLocaleString("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo" })}. Emita NF-e de devolução/entrada para estornar a operação.` };
  return { allowed: true, until };
}

export async function cancelDocument(ctx: Ctx, documentId: string, justification: string) {
  requireAction(ctx, "fiscal.cancel");
  const doc0 = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(doc0.companyId === ctx.companyId, "Documento de outra empresa.");
  assert(justification?.trim().length >= 15, "Justificativa deve ter ao menos 15 caracteres.");
  assert(justification.trim().length <= 255, "Justificativa deve ter no máximo 255 caracteres.");
  let doc = doc0;
  // enviado com falha de comunicação: confirma a situação no provedor antes de descartar (pode ter sido autorizado)
  if (["error", "processing"].includes(doc.status) && (doc.attempts ?? 0) > 0) {
    doc = await queryDocument(ctx, doc.id).catch(() => doc);
    if (["error", "processing"].includes(doc.status)) throw new BusinessError("Não foi possível confirmar a situação do documento no provedor. Consulte novamente antes de cancelar/descartar.", "unknown_state");
  }
  if ((["draft", "pending", "rejected"].includes(doc.status) || (["queued", "error"].includes(doc.status) && !(doc.attempts ?? 0))) && !doc.protocol) {
    const updated = await ctx.store.update("fiscal_documents", doc.id, { status: "discarded", statusMessage: `Descartado sem autorização: ${justification}`, cancelReason: justification });
    await addEvent(ctx, doc.id, "discard", "discarded", justification);
    await resolveOccurrence(ctx.store, `fiscal:${doc.id}`);
    await audit(ctx, { module: "fiscal", action: "document.discard", entityType: "fiscal_document", entityId: doc.id, summary: `${MODEL_LABEL[doc.model]} ${doc.number ? "nº " + doc.number : doc.ref} descartada (não autorizada)${doc.number ? " — número deve ser inutilizado" : ""}`, reason: justification, branchId: doc.branchId });
    await syncOrigin(ctx, updated);
    return updated;
  }
  if (doc.status === "cancelled") return doc;
  const { cfg, provider } = await providerForDoc(ctx, doc);
  const w = cancelWindow(doc, cfg);
  assert(w.allowed, `Documento não pode ser cancelado: ${w.reason}`, "cancel_window");
  assert(provider, "Provedor fiscal indisponível para cancelamento.");
  let r: ProviderResult;
  try {
    r = await provider!.cancel(doc.model, doc.ref, justification.trim(), { nfseStandard: cfg?.nfseStandard });
  } catch (e: any) {
    r = { status: "error", message: `Falha de comunicação: ${e.message}` };
  }
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: doc.branchId, kind: doc.model === "nfse" ? "fiscal_nfse" : "fiscal_nfe", action: `cancel_${doc.model}`, status: r.status === "cancelled" ? "success" : "failure", message: `${doc.ref}: ${r.message ?? r.status}` });
  if (r.status !== "cancelled") {
    await addEvent(ctx, doc.id, "cancel", "error", r.message ?? "Cancelamento não homologado", { justificativa: justification }, r.raw);
    throw new BusinessError(`Cancelamento não homologado: ${r.message ?? r.status}. O documento permanece autorizado.`, "cancel_failed");
  }
  await ctx.store.update("fiscal_documents", doc.id, { cancelReason: justification.trim() });
  const updated = await applyResult(ctx, doc, r, "cancel", provider!);
  await reverseDocumentEffects(ctx, updated, justification);
  await audit(ctx, { module: "fiscal", action: "document.cancel", entityType: "fiscal_document", entityId: doc.id, summary: `${MODEL_LABEL[doc.model]} nº ${doc.number ?? doc.rpsNumber ?? ""} cancelada`, reason: justification, related: doc.originId ? [`${doc.originType}:${doc.originId}`] : [], branchId: doc.branchId });
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

/** Solicitado pela origem (ex.: venda cancelada): cancela se autorizado, descarta se não transmitido. */
export async function requestCancelForOrigin(ctx: Ctx, originType: string, originId: string, justification: string) {
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "originType", originType], ["eq", "originId", originId]] });
  const just = justification.trim().padEnd(15, ".").slice(0, 255);
  for (const d of docs) {
    if (["cancelled", "discarded", "unused"].includes(d.status)) continue;
    if (d.status === "authorized") {
      await ctx.store.update("fiscal_documents", d.id, { cancelRequestedAt: nowIso(), cancelReason: just });
      await enqueue(ctx.store, { type: "fiscal.cancel", payload: { documentId: d.id, justification: just, branchId: d.branchId }, dedupeKey: `fiscal-cancel:${d.id}`, companyId: ctx.companyId });
      await addEvent(ctx, d.id, "cancel_request", "queued", "Cancelamento solicitado pela origem (operação cancelada) — enfileirado.");
      await notify(ctx.store, { companyId: ctx.companyId, branchId: d.branchId, type: "fiscal_rejected", priority: "high", title: `Cancelar ${MODEL_LABEL[d.model]} nº ${d.number}`, body: "Operação de origem cancelada: o cancelamento fiscal foi enfileirado. Acompanhe o retorno.", link: `/fiscal/${d.model}/${d.id}`, originType: "fiscal_document", originId: d.id, occurrenceKey: `fiscal:${d.id}`, audience: { action: "fiscal.cancel" } }).catch(() => undefined);
    } else if (d.status === "processing" || (d.status === "error" && (d.attempts ?? 0) > 0)) {
      await ctx.store.update("fiscal_documents", d.id, { cancelRequestedAt: nowIso(), cancelReason: just });
      if (d.status === "error") await enqueue(ctx.store, { type: "fiscal.transmit", payload: { documentId: d.id, branchId: d.branchId }, dedupeKey: `fiscal-transmit:${d.id}:cancelcheck`, companyId: ctx.companyId });
      await addEvent(ctx, d.id, "cancel_request", "processing", "Origem cancelada durante o processamento: o cancelamento será enfileirado automaticamente após a autorização.");
      await raiseFiscalIssue(ctx, d, "Operação cancelada enquanto o documento estava em processamento. O cancelamento será solicitado após a autorização.");
    } else {
      await ctx.store.update("fiscal_documents", d.id, { status: "discarded", statusMessage: "Descartado: origem cancelada antes da autorização.", cancelReason: just });
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
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  assert(doc.model === "nfe", "Carta de correção aplica-se somente à NF-e.");
  assert(doc.status === "authorized", "Somente NF-e autorizada aceita carta de correção.");
  const t = text?.trim() ?? "";
  assert(t.length >= 15, "A correção deve ter ao menos 15 caracteres.");
  assert(t.length <= 1000, "A correção deve ter no máximo 1.000 caracteres.");
  assert((doc.correctionCount ?? 0) < 20, "Limite de 20 cartas de correção por NF-e atingido.");
  const { provider } = await providerForDoc(ctx, doc);
  assert(provider, "Provedor fiscal indisponível.");
  let r: ProviderResult & { sequence?: number };
  try {
    r = await provider!.correction(doc.ref, t);
  } catch (e: any) {
    r = { status: "error", message: `Falha de comunicação: ${e.message}` };
  }
  const seq = r.sequence ?? (doc.correctionCount ?? 0) + 1;
  await addEvent(ctx, doc.id, "cce", r.status === "authorized" ? "authorized" : "rejected", r.message ?? "", { correcao: t, sequencia: seq }, r.raw, r.protocol);
  if (r.status !== "authorized") throw new BusinessError(`CC-e não registrada: ${r.message}`);
  await ctx.store.update("fiscal_documents", doc.id, { correctionCount: seq });
  await audit(ctx, { module: "fiscal", action: "document.cce", entityType: "fiscal_document", entityId: doc.id, summary: `CC-e nº ${seq} registrada na NF-e nº ${doc.number}`, after: { text: t, protocol: r.protocol }, branchId: doc.branchId });
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

export async function disableNumbers(ctx: Ctx, input: { branchId: string; model: "nfe" | "nfce"; series: string; from: number; to: number; justification: string }): Promise<Doc> {
  requireAction(ctx, "fiscal.cancel");
  assert(Number.isInteger(input.from) && Number.isInteger(input.to) && input.from > 0 && input.to >= input.from, "Faixa de numeração inválida.");
  assert(input.to - input.from < 1000, "Faixa máxima de 1.000 números por pedido.");
  assert(input.justification?.trim().length >= 15, "Justificativa deve ter ao menos 15 caracteres.");
  // números já autorizados/cancelados não podem ser inutilizados
  const used = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", input.branchId], ["eq", "model", input.model], ["eq", "series", input.series], ["between", "number", input.from, input.to], ["eq", "status", ["authorized", "cancelled", "processing", "denied"]]] });
  assert(!used.length, `Números já utilizados na faixa: ${used.map((d) => d.number).join(", ")}.`);
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, input.branchId);
  const provider = providerFor(ctx.store, cfg);
  assert(provider, "Provedor fiscal indisponível.");
  const branch = await ctx.store.getOrThrow("branches", input.branchId);
  let r: ProviderResult;
  try {
    r = await provider!.disable({ cnpj: onlyDigits(branch.cnpj), series: input.series, from: input.from, to: input.to, justification: input.justification.trim(), model: input.model });
  } catch (e: any) {
    r = { status: "error", message: `Falha de comunicação: ${e.message}` };
  }
  const ref = `inut-${input.model}-${input.branchId}-${input.series}-${input.from}-${input.to}`;
  const id = detId("fiscaldoc", ref);
  const existing = await ctx.store.get("fiscal_documents", id);
  const data = {
    status: r.status === "unused" ? "unused" : r.status === "error" ? "error" : "rejected",
    statusMessage: `Inutilização ${input.from}–${input.to}: ${r.message ?? r.status}`,
    protocol: r.protocol ?? null,
    attempts: (existing?.attempts ?? 0) + 1,
    lastAttemptAt: nowIso(),
  };
  const doc = existing
    ? await ctx.store.update("fiscal_documents", id, data)
    : await ctx.store.create(
        "fiscal_documents",
        {
          companyId: ctx.companyId, branchId: input.branchId, createdBy: ctx.user.id, model: input.model, environment: provider!.simulated ? "simulacao" : cfg?.environment, provider: cfg?.provider,
          ref, series: input.series, number: input.from, originType: "disable", nature: `Inutilização de numeração ${input.from}–${input.to}`, issuedAt: nowIso(),
          isSimulated: provider!.simulated, total: 0, items: [], payments: [], cancelReason: input.justification.trim(), service: { disableFrom: input.from, disableTo: input.to }, ...data,
        },
        id,
      );
  await addEvent(ctx, doc.id, "disable", doc.status, r.message ?? "", input, r.raw, r.protocol);
  await audit(ctx, { module: "fiscal", action: "numbers.disable", entityType: "fiscal_document", entityId: doc.id, summary: `Inutilização ${MODEL_LABEL[input.model]} série ${input.series} nº ${input.from}–${input.to}: ${DOC_STATUS_LABEL[doc.status]}`, reason: input.justification, branchId: input.branchId, result: doc.status === "unused" ? "success" : "failure" });
  if (doc.status !== "unused") throw new BusinessError(`Inutilização não homologada: ${r.message ?? r.status}`);
  return doc;
}

/** Números atribuídos e nunca autorizados (descartados) — candidatos à inutilização. */
export async function numberingGaps(ctx: Ctx, branchId: string, model: "nfe" | "nfce") {
  const docs = await listAll(ctx.store, "fiscal_documents", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchId], ["eq", "model", model], ["notNull", "number"]] });
  const disabled = docs.filter((d) => d.originType === "disable" && d.status === "unused");
  const isDisabled = (series: string, n: number) => disabled.some((d) => d.series === series && n >= (d.service?.disableFrom ?? d.number) && n <= (d.service?.disableTo ?? d.number));
  return docs
    .filter((d) => d.originType !== "disable" && ["discarded", "rejected"].includes(d.status) && !d.protocol && !isDisabled(d.series, d.number))
    .map((d) => ({ id: d.id, series: d.series, number: d.number, status: d.status }))
    .sort((a, b) => a.number - b.number);
}

// ───────────────────────────── E-mail (resultado real do canal)

export async function shareByEmail(ctx: Ctx, documentId: string, to: string) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to?.trim() ?? ""), "Informe um e-mail válido.");
  assert(["authorized", "cancelled"].includes(doc.status), "Somente documentos autorizados (ou cancelados) podem ser enviados.");
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const attachments: Array<{ filename: string; content: Buffer }> = [];
  if (doc.xmlFileId) {
    try {
      const f = await readFile(ctx, doc.xmlFileId);
      attachments.push({ filename: f.meta.name, content: f.data });
    } catch {
      /* segue sem anexo */
    }
  }
  const esc = (s: any) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const label = `${MODEL_LABEL[doc.model]} nº ${doc.number ?? "—"}${doc.series ? ` série ${doc.series}` : ""}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
${doc.isSimulated ? '<p style="background:#fdf4ff;border:1px solid #f0abfc;padding:8px;color:#701a75"><b>SIMULAÇÃO — SEM VALOR FISCAL.</b> Documento gerado por provedor de simulação.</p>' : ""}
<p>${esc(company.tradeName || company.name)} enviou o documento fiscal <b>${esc(label)}</b>${doc.status === "cancelled" ? " (CANCELADO)" : ""}.</p>
<ul><li>Emissão: ${esc(new Date(doc.issuedAt).toLocaleString("pt-BR"))}</li><li>Valor: ${esc(formatMoney(doc.total))}</li>${doc.accessKey ? `<li>Chave de acesso: ${esc(doc.accessKey)}</li>` : ""}${doc.protocol ? `<li>Protocolo: ${esc(doc.protocol)}</li>` : ""}${doc.verificationCode ? `<li>Código de verificação: ${esc(doc.verificationCode)}</li>` : ""}</ul>
${doc.qrCodeUrl && !doc.isSimulated ? `<p>Consulta: <a href="${esc(doc.qrCodeUrl)}">${esc(doc.qrCodeUrl)}</a></p>` : ""}${doc.danfeUrl && !doc.isSimulated ? `<p>DANFE/DANFSE (PDF do provedor): <a href="${esc(doc.danfeUrl)}">abrir</a></p>` : ""}
<p style="color:#666;font-size:12px">${attachments.length ? "XML em anexo." : "XML não disponível no armazenamento."}</p></div>`;
  const { sendEmail } = await import("@/lib/core/email");
  const r = await sendEmail(ctx.companyId, { to: to.trim(), subject: `${doc.isSimulated ? "[SIMULAÇÃO] " : ""}${label} — ${company.tradeName || company.name}`, html, attachments });
  await addEvent(ctx, doc.id, "email", r.delivered ? "authorized" : "error", r.delivered ? `E-mail entregue ao canal ${r.channel} para ${to}` : `E-mail NÃO enviado (${r.channel}): ${r.message ?? "falha"}`, { to });
  if (r.delivered) await ctx.store.update("fiscal_documents", doc.id, { lastEmailTo: to.trim() });
  await audit(ctx, { module: "fiscal", action: "document.email", entityType: "fiscal_document", entityId: doc.id, summary: `${label} ${r.delivered ? "enviada" : "não enviada"} por e-mail para ${to}`, result: r.delivered ? "success" : "failure", branchId: doc.branchId });
  return r;
}

// ───────────────────────────── NFS-e

export { calcNfse, type NfseCalcInput } from "./calc";
import { calcNfse, type NfseCalcInput } from "./calc";

export interface NfseInput {
  branchId: string;
  recipient: Record<string, any>;
  customerId?: string | null;
  serviceProductId?: string | null;
  competence: string;
  description: string;
  serviceListItem: string;
  municipalCode?: string;
  nationalCode?: string;
  cnae?: string;
  serviceCityCode?: string;
  issExigibility?: string;
  calc: NfseCalcInput;
  createReceivable?: { dueDate: string; categoryId?: string | null } | null;
  asDraft?: boolean;
  idemKey: string;
}

function nfseService(input: NfseInput, standard: string) {
  const disc = input.calc.unconditionalDiscount ?? 0;
  assert(input.calc.amount > 0, "Informe o valor dos serviços.");
  assert(disc >= 0 && disc <= input.calc.amount, "Desconto incondicionado não pode exceder o valor dos serviços.");
  assert((input.calc.deductions ?? 0) >= 0, "Deduções inválidas.");
  for (const v of [input.calc.issRateBps, input.calc.pisBps ?? 0, input.calc.cofinsBps ?? 0, input.calc.inssBps ?? 0, input.calc.irBps ?? 0, input.calc.csllBps ?? 0]) assert(Number.isInteger(v) && v >= 0 && v <= 10000, "Alíquotas devem estar entre 0% e 100%.");
  const c = calcNfse(input.calc);
  return {
    competence: input.competence,
    description: input.description,
    serviceListItem: input.serviceListItem,
    municipalCode: input.municipalCode || null,
    nationalCode: input.nationalCode || null,
    cnae: input.cnae || null,
    serviceCityCode: input.serviceCityCode || null,
    issExigibility: input.issExigibility ?? "1",
    amount: input.calc.amount,
    unconditionalDiscount: input.calc.unconditionalDiscount ?? 0,
    deductions: input.calc.deductions ?? 0,
    issRateBps: input.calc.issRateBps,
    issWithheld: input.calc.issWithheld,
    rates: { pisBps: input.calc.pisBps ?? 0, cofinsBps: input.calc.cofinsBps ?? 0, inssBps: input.calc.inssBps ?? 0, irBps: input.calc.irBps ?? 0, csllBps: input.calc.csllBps ?? 0 },
    withhold: input.calc.withhold ?? {},
    standard,
    productId: input.serviceProductId ?? null,
    ...c,
  };
}

export async function createNfse(ctx: Ctx, input: NfseInput) {
  requireAction(ctx, "fiscal.issue");
  assert(input.calc.amount > 0, "Informe o valor dos serviços.");
  assert(input.description?.trim(), "Informe a discriminação do serviço.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.competence ?? ""), "Informe a competência.");
  if (input.createReceivable) assert(input.customerId, "Para gerar conta a receber, selecione o tomador entre os clientes cadastrados.");
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, input.branchId);
  const service = nfseService(input, cfg?.nfseStandard ?? "municipal");
  const doc = await createDocument(ctx, {
    model: "nfse",
    ref: `nfse-${input.idemKey}`,
    branchId: input.branchId,
    originType: "service",
    originId: input.serviceProductId ?? null,
    recipient: input.recipient,
    partyType: input.customerId ? "customer" : null,
    partyId: input.customerId ?? null,
    service,
    status: input.asDraft ? "draft" : "queued",
    total: input.calc.amount,
    competenceDate: input.competence,
    effects: input.createReceivable ? { financial: true, amount: service.net, dueDate: input.createReceivable.dueDate, categoryId: input.createReceivable.categoryId ?? null } : null,
  });
  if (!doc.rpsSeries) await ctx.store.update("fiscal_documents", doc.id, { rpsSeries: String(cfg?.nfseSeries ?? "1") });
  return ctx.store.getOrThrow("fiscal_documents", doc.id);
}

/** Atualiza NFS-e em rascunho/pendente/rejeitada (correção antes de retransmitir com a mesma referência). */
export async function updateNfse(ctx: Ctx, documentId: string, input: NfseInput) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(doc.companyId === ctx.companyId && doc.model === "nfse", "NFS-e não encontrada.");
  assert(["draft", "pending", "rejected"].includes(doc.status), `NFS-e ${DOC_STATUS_LABEL[doc.status]} não pode ser editada.`);
  if (input.createReceivable) assert(input.customerId, "Para gerar conta a receber, selecione o tomador entre os clientes cadastrados.");
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, doc.branchId);
  const service = nfseService(input, cfg?.nfseStandard ?? "municipal");
  const updated = await ctx.store.update("fiscal_documents", doc.id, {
    recipient: input.recipient,
    recipientName: input.recipient?.name ?? null,
    recipientDoc: onlyDigits(input.recipient?.doc) || null,
    partyType: input.customerId ? "customer" : null,
    partyId: input.customerId ?? null,
    service,
    total: input.calc.amount,
    competenceDate: input.competence,
    originId: input.serviceProductId ?? null,
    effects: input.createReceivable ? { financial: true, amount: service.net, dueDate: input.createReceivable.dueDate, categoryId: input.createReceivable.categoryId ?? null } : null,
  });
  await addEvent(ctx, doc.id, "edit", doc.status, `Dados corrigidos por ${ctx.user.name}`);
  await audit(ctx, { module: "fiscal", action: "nfse.edit", entityType: "fiscal_document", entityId: doc.id, summary: `NFS-e ${doc.rpsNumber ? "RPS " + doc.rpsNumber : doc.ref} editada`, branchId: doc.branchId });
  if (!input.asDraft) return submitDraft(ctx, doc.id);
  return updated;
}

/** Envia um rascunho/pendência (NF-e/NFS-e) para transmissão. */
export async function submitDraft(ctx: Ctx, documentId: string) {
  requireAction(ctx, "fiscal.issue");
  const doc = await ctx.store.getOrThrow("fiscal_documents", documentId);
  assert(doc.companyId === ctx.companyId, "Documento de outra empresa.");
  assert(["draft", "pending", "rejected"].includes(doc.status), "Documento não está em rascunho/pendência.");
  if (doc.effects?.stock && doc.operationType !== "entrada" && doc.model === "nfe") await checkStockForEffects(ctx, doc);
  await ctx.store.update("fiscal_documents", doc.id, { status: "queued", issuedAt: doc.attempts ? doc.issuedAt : nowIso() });
  await addEvent(ctx, doc.id, "submit", "queued", `Enviado para transmissão por ${ctx.user.name}`);
  await audit(ctx, { module: "fiscal", action: "document.submit", entityType: "fiscal_document", entityId: doc.id, summary: `${MODEL_LABEL[doc.model]} enviada para transmissão`, branchId: doc.branchId });
  return transmitDocument(ctx, doc.id);
}

async function checkStockForEffects(ctx: Ctx, doc: Doc) {
  const { availableMap } = await import("../stock");
  const allow = await getSetting(ctx.store, ctx.companyId, doc.branchId, "sales.allowNegativeStock", false);
  if (allow) return;
  const items = (doc.items as DocItem[]).filter((i) => i.skuId);
  const need = new Map<string, number>();
  for (const i of items) need.set(i.skuId!, (need.get(i.skuId!) ?? 0) + i.qty);
  const map = await availableMap(ctx.store, doc.branchId, [...need.keys()]);
  const short = [...need.entries()].filter(([sku, q]) => (map.get(sku)?.available ?? 0) < q);
  if (short.length) {
    const names = await Promise.all(short.map(async ([sku, q]) => `${(await ctx.store.get("skus", sku))?.sku ?? sku} (precisa ${q / QTY}, disponível ${(map.get(sku)?.available ?? 0) / QTY})`));
    throw new BusinessError(`Estoque insuficiente para baixar na autorização: ${names.join("; ")}. Ajuste os itens ou desmarque "baixar estoque".`, "insufficient_stock");
  }
}

// ───────────────────────────── Tarefas

registerJob("fiscal.transmit", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d) return { skipped: true };
  ctx.branchId = d.branchId;
  if (d.contingency && d.status === "queued") {
    const cfg = await getFiscalConfig(ctx.store, ctx.companyId, d.branchId);
    if (cfg?.contingency) return { held: "contingency" };
  }
  const r = await transmitDocument(ctx, p.documentId);
  return { status: r.status };
});
registerJob("fiscal.query", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d) return { skipped: true };
  if (d.status !== "processing") return { skipped: `status ${d.status}` };
  ctx.branchId = d.branchId;
  const r = await queryDocument(ctx, p.documentId);
  return { status: r.status };
});
registerJob("fiscal.cancel", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d) return { skipped: true };
  if (d.status === "cancelled") return { status: "cancelled" };
  ctx.branchId = d.branchId;
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, d.branchId);
  const w = cancelWindow(d, cfg);
  if (!w.allowed) {
    // fora do prazo: não adianta retentar — registra e avisa para tratamento manual (NF-e de devolução)
    await addEvent(ctx, d.id, "cancel", "error", `Cancelamento automático não realizado: ${w.reason}`);
    await raiseFiscalIssue(ctx, d, `Cancelamento solicitado pela origem não pôde ser feito: ${w.reason}`);
    return { status: d.status, blocked: w.reason };
  }
  const r = await cancelDocument(ctx, p.documentId, p.justification);
  return { status: r.status };
});

registerJob("fiscal.email", async (ctx, p) => {
  const d = await ctx.store.get("fiscal_documents", p.documentId);
  if (!d || !["authorized", "cancelled"].includes(d.status)) return { skipped: true };
  ctx.branchId = d.branchId;
  const r = await shareByEmail(ctx, d.id, p.to);
  if (!r.delivered && r.channel !== "not_configured") throw new Error(r.message ?? "Falha no envio");
  return { delivered: r.delivered, channel: r.channel, message: r.message };
});

export function fiscalDayKey(iso: string) {
  return toLocalDate(iso);
}
export { today };
