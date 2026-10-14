import { detId, findOne, isConflict, sha256 } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { saveFile } from "@/lib/core/files";
import { onlyDigits, searchable } from "@/lib/core/text";
import { nowIso, toLocalDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createTitle } from "./finance";
import { createSupplier, findSupplierByDoc, supplierLabel } from "./suppliers";
import { nfeKeyIsValid, parseNfeXml } from "./nfe-xml";
import { buildReceiptInstallments, companyCnpjs, findReceiptByKey, itemFiscalOf, type ReceiptItem } from "./receipts";

/**
 * Nota de entrada SEM estoque (FIS-24): serviço tomado, material de uso e consumo, despesa com nota.
 *
 * Decisão: reaproveita `receipts` (sem tabela nova) com `entryKind = "no_stock"` e os efeitos existentes
 * `updateStock = false`, `updateCost = false`. O registro nasce CONCLUÍDO (não passa pela conferência física, que
 * exige produto e quantidade): itens sem produto (ignore = true, só descrição/CFOP/valores), nenhum movimento de
 * estoque, nenhum custo alterado, e — se marcado — um título a pagar pelas mesmas regras do recebimento (duplicatas
 * do XML ou condição de pagamento; idempotência `purchase_receipt:<id>`). Escriturada no livro de entradas.
 *  - Com XML de NF-e: mesmas validações da importação (denegada, homologação, destinatário, chave única); CFOP de
 *    entrada informado (padrão 1556/2556 — uso e consumo).
 *  - Sem XML: NF-e com chave (validada e única), NFS-e (serviço tomado — sem CFOP) ou outro documento; valores
 *    informados (total, base/ICMS, IPI, ST).
 * Fica fora da precificação após a entrada (não há produto) e da devolução a fornecedor.
 */

export const ENTRIES_BOOK_FEATURE = "livroEntradas";

export const NO_STOCK_MODEL_LABEL: Record<string, string> = { "55": "NF-e", nfse: "NFS-e (serviço tomado)", other: "Outro documento" };

export interface NoStockEntryInput {
  idemKey: string;
  /** XML da NF-e (uso e consumo / despesa). Sem XML, os dados abaixo são obrigatórios. */
  xml?: string | null;
  fileName?: string | null;
  supplierId?: string | null;
  docModel?: "55" | "nfse" | "other";
  nfeKey?: string | null;
  number?: string | null;
  series?: string | null;
  /** AAAA-MM-DD */
  issueDate?: string | null;
  /** CFOP de entrada (ex.: 1556 uso e consumo, 1933 serviço tributado pelo ISS); NFS-e pode ficar sem */
  cfop?: string | null;
  description?: string | null;
  total?: number | null;
  icmsBase?: number | null;
  icms?: number | null;
  ipi?: number | null;
  st?: number | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  /** omitida = condição do fornecedor; vazia = à vista */
  paymentTermId?: string | null;
  paymentMethodId?: string | null;
  createPayable?: boolean;
  notes?: string | null;
  allowHomologation?: boolean;
}

function requireReceive(ctx: Ctx) {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.receive");
}

const isCfop = (c: string) => /^[123]\d{3}$/.test(c);

/** Registra a nota de entrada sem estoque (concluída) e o título a pagar. Idempotente pela chave do formulário/da NF-e. */
export async function createNoStockEntry(ctx: Ctx, input: NoStockEntryInput): Promise<Doc<any>> {
  requireReceive(ctx);
  const branchId = requireBranch(ctx);
  if (!(await isFeatureOn(ctx.store, ctx.companyId, branchId, ENTRIES_BOOK_FEATURE, true))) throw new BusinessError("Livro de entradas desligado em Administração › Parâmetros › Recursos.", "feature_off");
  const createPayable = input.createPayable !== false;
  for (const [k, v] of [["Base do ICMS", input.icmsBase], ["ICMS", input.icms], ["IPI", input.ipi], ["ICMS-ST", input.st]] as const) assert(v == null || (Number.isInteger(v) && v >= 0), `${k} inválido.`);
  const cfopIn = onlyDigits(input.cfop);
  assert(!cfopIn || isCfop(cfopIn), `CFOP de entrada ${input.cfop} inválido (4 dígitos começando por 1, 2 ou 3).`);
  if (input.categoryId) {
    const c = await ctx.store.get("fin_categories", input.categoryId);
    assert(c && c.companyId === ctx.companyId, "Plano de contas inválido.");
  }
  if (input.paymentTermId) {
    const t = await ctx.store.get("payment_terms", input.paymentTermId);
    assert(t && t.companyId === ctx.companyId, "Condição de pagamento inválida.");
  }
  let supplier: Doc<any>;
  let items: ReceiptItem[];
  let key: string | null = null;
  let number: string | null;
  let series: string | null;
  let issueIso: string | null;
  let total: number;
  let model: string;
  let emitter: Record<string, any>;
  const xml = input.xml?.trim() || null;
  if (xml) {
    const nfe = parseNfeXml(xml);
    if (nfe.denied) throw new BusinessError(`NF-e ${nfe.number} com uso DENEGADO pela SEFAZ — não pode ser escriturada.`, "nfe_denied");
    let homologationAccepted = false;
    if (nfe.environment === "homologacao") {
      const company = await ctx.store.get("companies", ctx.companyId);
      homologationAccepted = Boolean(input.allowHomologation || company?.isDemo);
      if (!homologationAccepted) throw new BusinessError(`NF-e ${nfe.number} emitida em ambiente de HOMOLOGAÇÃO (sem valor fiscal).`, "homologation");
    }
    const ours = await companyCnpjs(ctx.store, ctx.companyId);
    const destDoc = onlyDigits(nfe.recipient.cnpj ?? nfe.recipient.cpf ?? "");
    if (destDoc && !ours.has(destDoc)) throw new BusinessError(`NF-e destinada a outro CNPJ (${destDoc}). Confira se a nota é desta empresa.`, "recipient");
    key = nfe.key;
    const emitterDoc = nfe.emitter.cnpj ?? nfe.emitter.cpf;
    assert(emitterDoc, "Emitente sem CNPJ/CPF no XML.");
    supplier = (await findSupplierByDoc(ctx.store, ctx.companyId, emitterDoc)) ?? (await supplierFromXml(ctx, nfe.emitter, emitterDoc, nfe.number));
    const branch = await ctx.store.get("branches", branchId);
    const interstate = nfe.emitter.address?.uf && branch?.uf && nfe.emitter.address.uf !== branch.uf;
    const cfop = cfopIn || (interstate ? "2556" : "1556");
    items = nfe.items.map((it, i) => ({
      idx: i + 1, nItem: it.nItem, cProd: it.cProd, cEAN: it.cEAN, xProd: it.xProd, uCom: it.uCom, ncm: it.ncm, cest: it.cest, cfop: it.cfop, entryCfop: cfop,
      invoicedQtySupplier: it.qCom, conversionFactor: 1000, invoicedQty: it.qCom, invoicedValue: it.vProd - it.vDesc, invoiceUnitCost: 0, skuId: null, sku: null, description: it.xProd,
      unitCode: it.uCom, mapping: null, expectedQty: 0, receivedQty: 0, unitCost: 0, ignore: true, divergence: null, fiscal: itemFiscalOf(it),
    }));
    number = nfe.number;
    series = nfe.series;
    issueIso = nfe.issueDate ? new Date(nfe.issueDate).toISOString() : null;
    total = nfe.totals.vNF;
    model = "55";
    emitter = { ...nfe.emitter, duplicatas: nfe.duplicatas, protocol: nfe.protocol, authorized: nfe.authorized, environment: nfe.environment, protocolStatus: nfe.protocolStatus, protocolMessage: nfe.protocolMessage, homologationAccepted, nature: nfe.nature, totals: nfe.totals };
  } else {
    assert(input.supplierId, "Selecione o fornecedor/prestador.");
    supplier = await ctx.store.getOrThrow("suppliers", input.supplierId);
    assert(supplier.companyId === ctx.companyId, "Fornecedor de outra empresa.");
    model = input.docModel ?? "other";
    assert(["55", "nfse", "other"].includes(model), "Tipo de documento inválido.");
    total = input.total ?? 0;
    assert(Number.isInteger(total) && total > 0, "Informe o valor total do documento.");
    assert((input.icmsBase ?? 0) <= total, "Base do ICMS maior que o valor do documento.");
    assert(input.description?.trim(), "Descreva o serviço/material da nota.");
    if (input.issueDate) assert(/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate) && input.issueDate <= today(), "Data de emissão inválida (não pode ser futura).");
    const k = onlyDigits(input.nfeKey);
    if (k) {
      assert(nfeKeyIsValid(k), "Chave de acesso inválida (44 dígitos com dígito verificador).");
      assert(k.slice(6, 20) === onlyDigits(supplier.doc).padStart(14, "0"), "A chave informada não pertence ao CNPJ deste fornecedor.");
      key = k;
      model = "55";
    }
    assert(model !== "55" || key, "NF-e: informe a chave de acesso (44 dígitos) ou escolha outro tipo de documento.");
    assert(model === "nfse" || cfopIn, "Informe o CFOP de entrada (ex.: 1556 uso e consumo, 1933 serviço).");
    number = input.number?.trim() || (key ? String(Number(key.slice(25, 34))) : null);
    series = input.series?.trim() || (key ? String(Number(key.slice(22, 25))) : null);
    assert(number, "Informe o número do documento.");
    issueIso = input.issueDate ? `${input.issueDate}T12:00:00.000Z` : null;
    const fiscal = Object.fromEntries(Object.entries({ vItem: total, vBC: input.icmsBase ?? 0, vICMS: input.icms ?? 0, vIPI: input.ipi ?? 0, vICMSST: input.st ?? 0 }).filter(([, v]) => v));
    items = [{ idx: 1, cProd: null, xProd: input.description!.trim().slice(0, 200), description: input.description!.trim().slice(0, 200), entryCfop: cfopIn || null, conversionFactor: 1000, invoicedQty: 0, invoicedValue: total, invoiceUnitCost: 0, skuId: null, mapping: null, expectedQty: 0, receivedQty: 0, unitCost: 0, ignore: true, divergence: null, fiscal }];
    emitter = { cnpj: supplier.doc, name: supplier.name, tradeName: supplier.tradeName, uf: supplier.addresses?.[0]?.uf ?? null, address: supplier.addresses?.[0] ?? null, duplicatas: [], docModel: model };
  }
  assert(supplier.status !== "inactive", `Fornecedor ${supplierLabel(supplier)} está inativo — reative antes de lançar a nota.`);
  const scopeKey = key ? `${ctx.companyId}|nfe|${key}` : `${ctx.companyId}|nostock|${input.idemKey}`;
  const prior = key ? await findReceiptByKey(ctx.store, ctx.companyId, key) : await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
  if (prior) {
    // repetição do mesmo lançamento (formulário ou mesma chave já escriturada sem estoque): devolve o registro
    if (prior.entryKind === "no_stock") return finish(ctx, prior);
    throw new BusinessError(`Este documento (chave ${key}) já foi registrado no recebimento nº ${prior.number}.`, "duplicate", { id: prior.id });
  }
  const term = input.paymentTermId !== undefined ? input.paymentTermId || null : (supplier.paymentTermId ?? null);
  const termDoc = term ? await ctx.store.get("payment_terms", term) : null;
  const base = issueIso ? toLocalDate(issueIso) : today();
  const inst = createPayable ? buildReceiptInstallments(total, emitter.duplicatas ?? [], termDoc ? { installments: termDoc.installments, firstDueDays: termDoc.firstDueDays, intervalDays: termDoc.intervalDays } : null, base) : { installments: [], source: "none" as const };
  const seq = await nextNumber(ctx.store, `receipt:${ctx.companyId}`);
  const cfopHead = items.map((i) => i.entryCfop).find(Boolean) ?? null;
  const data = {
    companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number: seq, warehouseId: null, supplierId: supplier.id, orderIds: [],
    nfeKey: key, nfeNumber: number, nfeSeries: series, nfeIssueDate: issueIso, xmlFileId: null, xmlHash: xml ? sha256(Buffer.from(xml)) : null,
    status: "confirmed", confirmedAt: nowIso(), confirmedBy: ctx.user.id, items, productsTotal: total, freight: 0, otherExpenses: 0, discount: 0, total, dueTotal: total, invoicedTotal: total,
    paymentTermId: term, installments: inst.installments.map((x) => ({ ...x, source: inst.source })), divergences: [], notes: input.notes?.trim() || null, scopeKey,
    emitter, differenceAction: "adjust_to_due", searchText: searchable(String(seq), number, key, supplier.name, supplier.tradeName, input.description),
    entryCfop: cfopHead, categoryId: input.categoryId ?? (await getSetting<string | null>(ctx.store, ctx.companyId, null, "finance.category.purchases", null)) ?? null, costCenterId: input.costCenterId ?? null, paymentMethodId: input.paymentMethodId ?? null,
    effects: { updateStock: false, updateCost: false, createPayable }, orderCharges: null, origin: xml ? "xml" : "manual", orderLink: "without_order",
    entryKind: "no_stock", pricingStatus: "not_applicable",
  };
  let r: Doc;
  try {
    r = await ctx.store.create("receipts", data, detId("receipt", ctx.companyId, String(seq)));
  } catch (e) {
    if (isConflict(e)) {
      const ex = await findOne(ctx.store, "receipts", [["eq", "scopeKey", scopeKey]]);
      if (ex && ex.entryKind === "no_stock") return finish(ctx, ex);
      throw new BusinessError(`Documento já registrado${ex ? ` no recebimento nº ${ex.number}` : ""}.`, "duplicate", { id: ex?.id });
    }
    throw e;
  }
  if (xml) {
    const file = await saveFile(ctx, { bucket: "documents", name: input.fileName || `NFe${key}.xml`, mime: "application/xml", data: Buffer.from(xml), entityType: "receipt", entityId: r.id, kind: "nfe_xml" });
    r = await ctx.store.update("receipts", r.id, { xmlFileId: file.id });
  }
  await audit(ctx, {
    module: "purchases", action: "receipt.no_stock", entityType: "receipt", entityId: r.id,
    summary: `Nota de entrada SEM ESTOQUE nº ${seq}: ${NO_STOCK_MODEL_LABEL[model] ?? model} ${number ?? ""}${series ? `/${series}` : ""} de ${supplierLabel(supplier)} (${formatMoney(total)}${cfopHead ? `, CFOP ${cfopHead}` : ""}) — sem movimento de estoque nem custo${createPayable ? `, conta a pagar em ${inst.installments.length} parcela(s)` : ", sem conta a pagar"}`,
    reason: input.notes?.trim() || null,
    related: [`supplier:${supplier.id}`],
  });
  return finish(ctx, r);
}

/** Título a pagar da nota sem estoque (idempotente pelo recebimento). */
async function finish(ctx: Ctx, r: Doc<any>): Promise<Doc<any>> {
  if (r.payableTitleId || !r.effects?.createPayable || !(r.installments ?? []).length) return r;
  const supplier = await ctx.store.getOrThrow("suppliers", r.supplierId);
  const method = r.paymentMethodId ? await ctx.store.get("payment_methods", r.paymentMethodId) : null;
  const title = await createTitle(ctx, {
    kind: "payable",
    partyType: "supplier",
    partyId: supplier.id,
    partyName: supplierLabel(supplier),
    description: `Nota de entrada sem estoque nº ${r.number}${r.nfeNumber ? ` / doc. ${r.nfeNumber}` : ""}${r.items?.[0]?.description ? ` — ${String(r.items[0].description).slice(0, 80)}` : ""}`,
    documentNumber: r.nfeNumber ? `${r.nfeNumber}${r.nfeSeries ? `-${r.nfeSeries}` : ""}` : `REC-${r.number}`,
    originType: "purchase_receipt",
    originId: r.id,
    issueDate: r.nfeIssueDate ? toLocalDate(r.nfeIssueDate) : today(),
    categoryId: r.categoryId ?? null,
    costCenterId: r.costCenterId ?? null,
    installments: (r.installments ?? []).map((x: any) => ({ dueDate: x.dueDate, amount: x.amount, methodKind: method?.kind ?? undefined })),
    idemKey: `purchase_receipt:${r.id}`,
    branchId: r.branchId,
  });
  return ctx.store.update("receipts", r.id, { payableTitleId: title.id });
}

async function supplierFromXml(ctx: Ctx, emitter: { cnpj: string | null; name: string; tradeName: string | null; ie: string | null; address: Record<string, string | null> }, doc: string, number: string) {
  if (!ctx.user.isAdmin && !ctx.user.permissions?.suppliers?.create) throw new BusinessError(`Fornecedor ${emitter.name} (CNPJ ${doc}) não está cadastrado e seu perfil não permite cadastrar fornecedores.`, "supplier_missing");
  try {
    return await createSupplier(ctx, { personType: emitter.cnpj ? "PJ" : "PF", doc, name: emitter.name, tradeName: emitter.tradeName, ie: emitter.ie, addresses: [{ type: "principal", ...Object.fromEntries(Object.entries(emitter.address).map(([k, v]) => [k, v ?? undefined])) }], status: "active" }, { source: `a partir do XML da NF-e ${number} (nota sem estoque)` });
  } catch (e) {
    const again = e instanceof BusinessError && e.code === "duplicate" ? await findSupplierByDoc(ctx.store, ctx.companyId, doc) : null;
    if (!again) throw e;
    return again;
  }
}
