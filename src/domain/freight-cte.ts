import { detId, findOne, isConflict, listAll, sha256 } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { getSetting, isFeatureOn } from "@/lib/core/settings";
import { saveFile } from "@/lib/core/files";
import { onlyDigits, searchable } from "@/lib/core/text";
import { nowIso, toLocalDate, today } from "@/lib/dates";
import { allocate, formatMoney } from "@/lib/money";
import { createTitle } from "./finance";
import { createSupplier, findSupplierByDoc, supplierLabel } from "./suppliers";
import { addCteFreight, buildReceiptInstallments, companyCnpjs, findReceiptByKey, type CteItemAdjustment, type ReceiptItem } from "./receipts";
import { parseCteXml, TOMADOR_LABEL, type ParsedCte } from "./cte-xml";

/**
 * CT-e de entrada — frete de compra (COM-10).
 *
 *  - Importa o XML do CT-e (modelo 57) e o vincula a um ou mais recebimentos (escolhidos ou, sem escolha, os que
 *    têm as NF-e transportadas — infDoc/infNFe). Mesma chave não duplica (índice único `inbound_ctes.scopeKey`).
 *  - O tomador do serviço tem de ser a empresa (frete FOB/por conta do destinatário): CT-e de frete CIF (tomador
 *    remetente) é recusado — esse frete já está no preço/NF-e do fornecedor.
 *  - Valor da prestação (vTPrest) rateado entre os recebimentos pelo valor dos produtos e, dentro de cada um, pelo
 *    valor da linha (mesmo critério do frete da NF-e). Recebimento em conferência: entra no custo de entrada na
 *    conclusão (sem alterar o valor devido ao fornecedor nem o cálculo de recebimentos sem CT-e). Recebimento já
 *    concluído: ajuste de custo documentado (movimento `cost_adjust` para as unidades ainda em estoque).
 *  - Conta a pagar à transportadora (fornecedor marcado como transportadora — cadastrado a partir do XML se não
 *    existir), com as duplicatas do CT-e ou a condição de pagamento; idempotente pelo CT-e.
 *  - Documento de terceiro: NÃO é gravado em fiscal_documents. Entra no livro de entradas (FIS-24) pela coleção própria.
 *  - Crédito de ICMS do frete NÃO é deduzido do custo (empresas do Simples não creditam; para o Regime Normal o ajuste
 *    fica com a contabilidade — ver docs/regras-assumidas.md).
 */

export const CTE_FEATURE = "cteEntrada";

export async function cteEntryOn(ctx: Ctx) {
  return isFeatureOn(ctx.store, ctx.companyId, ctx.branchId, CTE_FEATURE, true);
}

const scopeFor = (companyId: string, key: string) => `${companyId}|cte|${key}`;

export interface CteAllocation {
  receiptId: string;
  receiptNumber: number;
  nfeNumber: string | null;
  amount: number;
  mode: "cost" | "adjustment" | null;
  adjustments: CteItemAdjustment[];
}

export const CTE_STATUS_LABEL: Record<string, string> = { registering: "Registrando", registered: "Registrado" };

/** CFOP de entrada sugerido para o frete de compra: 1353/2353 (aquisição de serviço de transporte por estabelecimento comercial). */
export function defaultCteEntryCfop(cte: Pick<ParsedCte, "cfop" | "ufStart" | "ufEnd">) {
  const first = String(cte.cfop ?? "")[0];
  if (first === "6" || (cte.ufStart && cte.ufEnd && cte.ufStart !== cte.ufEnd)) return "2353";
  if (first === "7") return "3353";
  return "1353";
}

/** Recebimentos que transportam as NF-e do CT-e (pela chave), na filial. */
export async function receiptsForCteKeys(ctx: Ctx, nfeKeys: string[]) {
  const out: Doc[] = [];
  for (const k of nfeKeys) {
    const r = await findReceiptByKey(ctx.store, ctx.companyId, k);
    if (r && r.status !== "cancelled" && !out.some((x) => x.id === r.id)) out.push(r);
  }
  return out;
}

function requireReceive(ctx: Ctx) {
  requirePerm(ctx, "purchases", "view");
  requireAction(ctx, "purchase.receive");
}

const activeItems = (r: Doc) => ((r.items ?? []) as ReceiptItem[]).filter((it) => !it.ignore && it.skuId && it.receivedQty > 0);

export interface ImportCteInput {
  xml: string;
  fileName?: string | null;
  /** recebimentos escolhidos; vazio = os que têm as NF-e transportadas pelo CT-e */
  receiptIds?: string[] | null;
  /** CFOP de entrada (padrão 1353/2353) */
  entryCfop?: string | null;
  /** condição de pagamento do título (sem duplicatas no XML); omitida = a da transportadora; vazia = à vista */
  paymentTermId?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  allowHomologation?: boolean;
}

/** Importa o CT-e de entrada: registro, rateio do frete nos recebimentos e título a pagar à transportadora. */
export async function importCteXml(ctx: Ctx, input: ImportCteInput): Promise<Doc<any>> {
  requireReceive(ctx);
  const branchId = requireBranch(ctx);
  if (!(await cteEntryOn(ctx))) throw new BusinessError("CT-e de entrada desligado em Administração › Parâmetros › Recursos.", "feature_off");
  const cte = parseCteXml(input.xml);
  const protocolInfo = cte.protocolStatus ? `cStat ${cte.protocolStatus}${cte.protocolMessage ? ` – ${cte.protocolMessage}` : ""}` : null;
  if (cte.denied) throw new BusinessError(`CT-e ${cte.number} com uso DENEGADO pela SEFAZ (${protocolInfo}).`, "cte_denied");
  if (cte.type && !["0", "1"].includes(cte.type)) throw new BusinessError(`CT-e ${cte.number} do tipo ${cte.type === "2" ? "anulação" : cte.type === "3" ? "substituto" : cte.type}: somente CT-e normal ou de complemento de valores é lançado como frete de compra.`, "cte_type");
  let homologationAccepted = false;
  if (cte.environment === "homologacao") {
    const company = await ctx.store.get("companies", ctx.companyId);
    homologationAccepted = Boolean(input.allowHomologation || company?.isDemo);
    if (!homologationAccepted) throw new BusinessError(`CT-e ${cte.number} emitido em ambiente de HOMOLOGAÇÃO (sem valor fiscal). Solicite à transportadora o XML autorizado em produção.`, "homologation");
  }
  assert(cte.total > 0, "CT-e sem valor da prestação (vTPrest).");
  // tomador = a empresa (quem paga o frete)
  const ours = await companyCnpjs(ctx.store, ctx.companyId);
  const tomDoc = onlyDigits(cte.tomador.party.cnpj ?? cte.tomador.party.cpf ?? "");
  if (!tomDoc || !ours.has(tomDoc)) {
    const who = cte.tomador.role ? TOMADOR_LABEL[cte.tomador.role] : "não identificado";
    throw new BusinessError(
      cte.tomador.role === "0"
        ? `O tomador do serviço deste CT-e é o remetente (${cte.sender.name ?? cte.sender.cnpj}): frete por conta do fornecedor (CIF), já incluído na NF-e — não gera custo nem conta a pagar para a empresa.`
        : `O tomador do serviço (${who}${tomDoc ? ` — ${tomDoc}` : ""}) não é esta empresa. Confira se o CT-e é de um frete contratado por ela.`,
      "cte_tomador",
    );
  }
  const scopeKey = scopeFor(ctx.companyId, cte.key);
  const existing = await findOne(ctx.store, "inbound_ctes", [["eq", "scopeKey", scopeKey]]);
  if (existing?.status === "registered") throw new BusinessError(`Este CT-e (chave ${cte.key}) já foi lançado (CT-e de entrada nº ${existing.number}).`, "duplicate", { id: existing.id });
  if (existing) return finishCte(ctx, existing); // registro interrompido: conclui os efeitos (idempotentes)

  // transportadora = fornecedor marcado como transportadora (cadastrado a partir do XML se não existir)
  const carrier = await carrierFor(ctx, cte);
  // recebimentos
  const chosen = [...new Set((input.receiptIds ?? []).filter(Boolean))];
  const receipts = chosen.length ? await Promise.all(chosen.map((id) => ctx.store.getOrThrow("receipts", id))) : await receiptsForCteKeys(ctx, cte.nfeKeys);
  if (!receipts.length) throw new BusinessError(`Nenhum recebimento informado${cte.nfeKeys.length ? ` e nenhuma das ${cte.nfeKeys.length} NF-e transportadas pelo CT-e foi recebida nesta empresa` : " e o CT-e não traz as chaves das NF-e transportadas"}. Selecione o(s) recebimento(s) do frete.`, "cte_no_receipt");
  for (const r of receipts) {
    assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
    assert(r.branchId === branchId, `Recebimento nº ${r.number} é de outra filial: selecione a filial do recebimento.`);
    assert(r.entryKind !== "no_stock", `Recebimento nº ${r.number} é nota de entrada sem estoque: o frete de CT-e é rateado só em recebimentos de mercadoria.`);
    assert(["draft", "confirmed"].includes(r.status), `Recebimento nº ${r.number} está ${r.status === "cancelled" ? "cancelado" : "em conclusão"} — escolha um recebimento em conferência ou concluído.`);
    assert(activeItems(r).length, `Recebimento nº ${r.number} não tem itens estocados para receber o rateio do frete.`);
  }
  const entryCfop = onlyDigits(input.entryCfop) || defaultCteEntryCfop(cte);
  assert(/^[123]\d{3}$/.test(entryCfop), `CFOP de entrada ${input.entryCfop} inválido (4 dígitos começando por 1, 2 ou 3).`);
  if (input.paymentTermId) {
    const t = await ctx.store.get("payment_terms", input.paymentTermId);
    assert(t && t.companyId === ctx.companyId, "Condição de pagamento inválida.");
  }
  // rateio entre recebimentos pelo valor dos produtos
  const weights = receipts.map((r) => Math.max(0, r.productsTotal ?? r.dueTotal ?? 0));
  const parts = allocate(cte.total, weights);
  const allocations: CteAllocation[] = receipts.map((r, i) => ({ receiptId: r.id, receiptNumber: r.number, nfeNumber: r.nfeNumber ?? null, amount: parts[i], mode: null, adjustments: [] }));
  const number = await nextNumber(ctx.store, `cte:${ctx.companyId}`);
  const termId = input.paymentTermId !== undefined ? input.paymentTermId || null : (carrier.paymentTermId ?? null);
  const categoryId = input.categoryId || (await getSetting<string | null>(ctx.store, ctx.companyId, null, "finance.category.freight", null)) || (await getSetting<string | null>(ctx.store, ctx.companyId, null, "finance.category.purchases", null));
  let doc: Doc;
  try {
    doc = await ctx.store.create(
      "inbound_ctes",
      {
        companyId: ctx.companyId, branchId, createdBy: ctx.user.id, number, cteKey: cte.key, cteNumber: cte.number, cteSeries: cte.series,
        issueDate: cte.issueDate ? new Date(cte.issueDate).toISOString() : null, scopeKey, carrierId: carrier.id,
        emitter: { ...cte.emitter, duplicatas: cte.duplicatas, modal: cte.modal, ufStart: cte.ufStart, ufEnd: cte.ufEnd, type: cte.type, homologationAccepted, protocolStatus: cte.protocolStatus, protocolMessage: cte.protocolMessage },
        tomador: { role: cte.tomador.role, ...cte.tomador.party, sender: cte.sender, recipient: cte.recipient },
        cfop: cte.cfop, entryCfop, total: cte.total, received: cte.received || cte.total, icms: cte.icms, nfeKeys: cte.nfeKeys,
        receiptIds: receipts.map((r) => r.id), allocations, xmlFileId: null, xmlHash: sha256(Buffer.from(input.xml)), payableTitleId: null,
        status: "registering", environment: cte.environment, protocol: cte.protocol, authorized: cte.authorized, notes: input.notes?.trim() || null,
        searchText: searchable(String(number), cte.number, cte.key, carrier.name, carrier.tradeName), registeredAt: null, paymentTermId: termId, categoryId: categoryId ?? null,
      },
      detId("inbound_cte", scopeKey),
    );
  } catch (e) {
    if (isConflict(e)) {
      const again = await findOne(ctx.store, "inbound_ctes", [["eq", "scopeKey", scopeKey]]);
      if (again?.status === "registered") throw new BusinessError(`Este CT-e já foi lançado (CT-e de entrada nº ${again.number}).`, "duplicate", { id: again.id });
      if (again) return finishCte(ctx, again);
    }
    throw e;
  }
  const file = await saveFile(ctx, { bucket: "documents", name: input.fileName || `CTe${cte.key}.xml`, mime: "application/xml", data: Buffer.from(input.xml), entityType: "inbound_cte", entityId: doc.id, kind: "cte_xml" });
  doc = await ctx.store.update("inbound_ctes", doc.id, { xmlFileId: file.id });
  return finishCte(ctx, doc);
}

/** Efeitos do CT-e (idempotentes): frete nos recebimentos, título a pagar e conclusão do registro. */
async function finishCte(ctx: Ctx, doc: Doc<any>): Promise<Doc<any>> {
  const allocations: CteAllocation[] = [];
  for (const a of (doc.allocations ?? []) as CteAllocation[]) {
    const res = await addCteFreight(ctx, a.receiptId, { cteId: doc.id, key: doc.cteKey, number: doc.cteNumber, amount: a.amount });
    allocations.push({ ...a, mode: res.mode, adjustments: res.mode === "adjustment" ? res.adjustments : [] });
  }
  const carrier = await ctx.store.getOrThrow("suppliers", doc.carrierId);
  const payable = doc.received || doc.total;
  const term = doc.paymentTermId ? await ctx.store.get("payment_terms", doc.paymentTermId) : null;
  const base = doc.issueDate ? toLocalDate(doc.issueDate) : today();
  const inst = buildReceiptInstallments(payable, doc.emitter?.duplicatas ?? [], term ? { installments: term.installments, firstDueDays: term.firstDueDays, intervalDays: term.intervalDays } : null, base);
  const receiptsLabel = allocations.map((a) => `nº ${a.receiptNumber}`).join(", ");
  const title = await createTitle(ctx, {
    kind: "payable",
    partyType: "supplier",
    partyId: carrier.id,
    partyName: supplierLabel(carrier),
    description: `Frete CT-e nº ${doc.cteNumber} — recebimento(s) ${receiptsLabel}`,
    documentNumber: `CTe ${doc.cteNumber}${doc.cteSeries ? `-${doc.cteSeries}` : ""}`,
    originType: "freight_cte",
    originId: doc.id,
    issueDate: base,
    categoryId: doc.categoryId ?? null,
    installments: inst.installments.map((x) => ({ dueDate: x.dueDate, amount: x.amount })),
    notes: doc.environment === "homologacao" ? "CT-e de HOMOLOGAÇÃO (sem valor fiscal) — empresa de demonstração." : null,
    idemKey: `freight_cte:${doc.id}`,
    branchId: doc.branchId,
  });
  const updated = await ctx.store.update("inbound_ctes", doc.id, { allocations, payableTitleId: title.id, status: "registered", registeredAt: doc.registeredAt ?? nowIso() });
  if (doc.status !== "registered") {
    const adjusted = allocations.filter((a) => a.mode === "adjustment");
    await audit(ctx, {
      module: "purchases", action: "cte.import", entityType: "inbound_cte", entityId: doc.id,
      summary: `CT-e nº ${doc.cteNumber}/${doc.cteSeries} de ${supplierLabel(carrier)} lançado (${formatMoney(doc.total)}): frete rateado em ${allocations.length} recebimento(s) (${receiptsLabel})${adjusted.length ? `, ${adjusted.length} já concluído(s) com ajuste de custo` : ""}; título a pagar à transportadora com ${inst.installments.length} parcela(s)`,
      related: [`supplier:${carrier.id}`, `title:${title.id}`, ...allocations.map((a) => `receipt:${a.receiptId}`)],
    });
  }
  return updated;
}

/** Transportadora do CT-e: fornecedor pelo CNPJ (marcado como transportadora) ou cadastrado a partir do XML. */
async function carrierFor(ctx: Ctx, cte: ParsedCte) {
  const doc = cte.emitter.cnpj ?? cte.emitter.cpf;
  assert(doc, "Emitente do CT-e sem CNPJ/CPF.");
  let carrier = await findSupplierByDoc(ctx.store, ctx.companyId, doc);
  if (!carrier) {
    if (!ctx.user.isAdmin && !ctx.user.permissions?.suppliers?.create) throw new BusinessError(`Transportadora ${cte.emitter.name} (CNPJ ${doc}) não está cadastrada e seu perfil não permite cadastrar fornecedores. Peça o cadastro em Compras → Fornecedores (marcado como transportadora) e importe o XML novamente.`, "supplier_missing");
    try {
      carrier = await createSupplier(
        ctx,
        { personType: cte.emitter.cnpj ? "PJ" : "PF", doc, name: cte.emitter.name ?? doc, tradeName: cte.emitter.tradeName, ie: cte.emitter.ie, category: "Transportadora", isCarrier: true, addresses: [{ type: "principal", ...Object.fromEntries(Object.entries(cte.emitter.address).map(([k, v]) => [k, v ?? undefined])) }], status: "active" },
        { source: `transportadora a partir do XML do CT-e ${cte.number}` },
      );
    } catch (e) {
      const again = e instanceof BusinessError && e.code === "duplicate" ? await findSupplierByDoc(ctx.store, ctx.companyId, doc) : null;
      if (!again) throw e;
      carrier = again;
    }
  }
  assert(carrier.status !== "inactive" && carrier.status !== "blocked", `Transportadora ${supplierLabel(carrier)} está ${carrier.status === "blocked" ? "bloqueada" : "inativa"} — reative o cadastro antes de lançar o CT-e.`);
  if (!carrier.isCarrier) {
    carrier = await ctx.store.update("suppliers", carrier.id, { isCarrier: true });
    await audit(ctx, { module: "suppliers", action: "supplier.carrier", entityType: "supplier", entityId: carrier.id, summary: `Fornecedor ${supplierLabel(carrier)} marcado como transportadora (emitente do CT-e ${cte.number})` });
  }
  return carrier;
}

export async function getCte(ctx: Ctx, id: string) {
  const d = await ctx.store.getOrThrow("inbound_ctes", id);
  assert(d.companyId === ctx.companyId, "CT-e de outra empresa.");
  return d;
}

/** CT-e de entrada da empresa (filial ativa ou todas no consolidado), mais recentes primeiro. */
export async function listCtes(ctx: Ctx, opts: { q?: string | null } = {}) {
  const filters: any[] = [["eq", "companyId", ctx.companyId]];
  if (ctx.branchId) filters.push(["eq", "branchId", ctx.branchId]);
  let rows = await listAll(ctx.store, "inbound_ctes", { filters, orderBy: [{ field: "number", dir: "desc" }] });
  const q = (opts.q ?? "").trim().toLowerCase();
  const d = onlyDigits(q);
  if (q) rows = rows.filter((r) => String(r.number) === q || (r.searchText ?? "").includes(q) || (d.length >= 4 && String(r.cteKey ?? "").includes(d)));
  return rows;
}

/** Recebimentos que podem receber um CT-e (em conferência ou concluídos nos últimos 120 dias, da filial). */
export async function linkableReceipts(ctx: Ctx) {
  const branchId = requireBranch(ctx);
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const list = await listAll(ctx.store, "receipts", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchId], ["eq", "status", ["draft", "confirmed"]]], orderBy: [{ field: "number", dir: "desc" }] }, 300);
  return list.filter((r) => r.entryKind !== "no_stock" && (r.status === "draft" || (r.confirmedAt ?? "") >= since) && activeItems(r).length);
}
