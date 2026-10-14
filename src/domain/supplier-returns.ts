import { detId, isConflict, listAll, retryOnConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { notify, reopenOccurrence, resolveOccurrence } from "@/lib/core/notify";
import { isFeatureOn } from "@/lib/core/settings";
import { onlyDigits } from "@/lib/core/text";
import { today } from "@/lib/dates";
import { formatMoney, formatQty, lineTotal, roundDiv } from "@/lib/money";
import { INACTIVE } from "./fiscal/service";
import { partyRecipient, type NfeInput, type NfeItemInput } from "./fiscal/nfe";
import { effectsOf, type ReceiptItem } from "./receipts";
import { cancelTitle, createTitle, refreshTitleStatus } from "./finance";

/**
 * Devolução a fornecedor a partir do RECEBIMENTO (COM-11) — evolução da NF-e de devolução (origem `receipt` em
 * `loadOrigin`), sem emissor paralelo:
 *  - quantidade devolvível por item = recebido − devolvido em NF-e de devolução do recebimento ainda ativas
 *    (autorizadas ou em andamento; canceladas/descartadas/denegadas/inutilizadas liberam a quantidade);
 *  - valores proporcionais à linha da nota de entrada (produtos, desconto, frete e outras despesas rateados no
 *    recebimento); a devolução do restante de um item fecha os centavos (total da linha − já devolvido);
 *  - na AUTORIZAÇÃO (applyDocumentEffects, inclusive em simulação): saída de estoque pelo custo médio vigente e
 *    abatimento no título a pagar do recebimento — das parcelas em aberto da ÚLTIMA para a PRIMEIRA (regra igual à
 *    devolução de venda a prazo); o que exceder o saldo em aberto (título já pago) vira título A RECEBER do
 *    fornecedor (crédito), limitado ao que foi efetivamente pago;
 *  - o abatimento acontece uma única vez (marcador determinístico gravado na mesma transação das baixas) e é
 *    estornado se a NF-e de devolução for cancelada (baixas de abatimento estornadas, crédito cancelado).
 * Regras registradas em docs/regras-assumidas.md (§ Devolução a fornecedor pelo recebimento).
 */

export const SUPPLIER_RETURN_FLAG = "devolucaoFornecedor";

/** Linha devolvida: item do recebimento (`idx`) e valores proporcionais à nota de entrada (centavos). */
export interface SupplierReturnLine {
  idx: number;
  skuId: string;
  qty: number;
  /** valor dos produtos (linha da NF-e de entrada, proporcional) */
  product: number;
  discount: number;
  freight: number;
  /** outras despesas (IPI, ST, seguro, outras) rateadas no recebimento */
  other: number;
  /** product − discount + freight + other: valor devolvido (abatido do pagar) */
  value: number;
}

export interface SupplierReturnResult {
  /** valor abatido das parcelas em aberto do título a pagar */
  abated: number;
  /** valor que virou título a receber do fornecedor (título a pagar já pago) */
  credited: number;
  creditTitleId: string | null;
  /** excedente sem título em aberto nem pagamento a compensar (ex.: título cancelado) — sem efeito financeiro */
  unmatched: number;
  installments: Array<{ installmentId: string; number: number; amount: number; settlementId: string }>;
}

/** Plano gravado em `fiscal_documents.effects.supplierReturn` (e resultado após a autorização). */
export interface SupplierReturnPlan {
  receiptId: string;
  receiptNumber: number;
  /** título a pagar gerado pelo recebimento (abatido na autorização) */
  titleId: string | null;
  abate: boolean;
  lines: SupplierReturnLine[];
  amount: number;
  result?: SupplierReturnResult | null;
  reversedAt?: string | null;
}

export interface ReturnedAgg {
  qty: number;
  product: number;
  discount: number;
  freight: number;
  other: number;
  value: number;
}

const zero = (): ReturnedAgg => ({ qty: 0, product: 0, discount: 0, freight: 0, other: 0, value: 0 });

/** Itens que entraram no recebimento (os únicos devolvíveis). */
export const returnableItems = (items: ReceiptItem[]) => items.filter((i) => !i.ignore && i.skuId && i.receivedQty > 0);

/** NF-e de devolução ATIVAS do recebimento (autorizadas ou em andamento), exceto `excludeDocId`. */
export async function receiptReturnDocs(store: Store, companyId: string, receiptId: string, excludeDocId?: string | null) {
  const docs = await listAll(store, "fiscal_documents", { filters: [["eq", "originType", "receipt"], ["eq", "originId", receiptId]] });
  return docs.filter((d) => d.companyId === companyId && d.id !== excludeDocId && !INACTIVE.includes(d.status));
}

/** Já devolvido por item do recebimento (somatório das linhas das NF-e de devolução ativas). */
export async function receiptReturnLedger(store: Store, companyId: string, receiptId: string, excludeDocId?: string | null) {
  const map = new Map<number, ReturnedAgg>();
  for (const d of await receiptReturnDocs(store, companyId, receiptId, excludeDocId)) {
    for (const l of (d.effects?.supplierReturn?.lines ?? []) as SupplierReturnLine[]) {
      const cur = map.get(l.idx) ?? zero();
      map.set(l.idx, { qty: cur.qty + l.qty, product: cur.product + l.product, discount: cur.discount + l.discount, freight: cur.freight + l.freight, other: cur.other + l.other, value: cur.value + l.value });
    }
  }
  return map;
}

/**
 * Linhas da devolução com valores proporcionais à linha do recebimento. Devolvendo o restante do item, cada
 * componente fecha exatamente (total da linha − já devolvido); senão, total × qtd ÷ recebido (meio para cima).
 */
export function planReturnLines(items: ReceiptItem[], returned: Map<number, ReturnedAgg>, requested: Array<{ idx: number; qty: number }>): SupplierReturnLine[] {
  const seen = new Set<number>();
  return requested.map((req) => {
    assert(!seen.has(req.idx), "Item do recebimento repetido na devolução: informe cada item uma única vez.", "duplicate_item");
    seen.add(req.idx);
    const it = returnableItems(items).find((i) => i.idx === req.idx);
    assert(it, "Item não pertence ao recebimento (ou não entrou no estoque).", "invalid_item");
    assert(Number.isInteger(req.qty) && req.qty > 0, `Quantidade inválida em ${it!.description}.`);
    const received = it!.receivedQty;
    const prev = returned.get(it!.idx) ?? zero();
    const rest = received - prev.qty;
    if (req.qty > rest) {
      throw new BusinessError(`Quantidade a devolver de ${it!.description} (${formatQty(req.qty)}) excede o restante devolvível (${formatQty(Math.max(0, rest))} de ${formatQty(received)} recebidos).`, "over_return");
    }
    const part = (total: number, before: number) => (req.qty === rest ? total - before : roundDiv(total * req.qty, received));
    const product = part(it!.lineValue ?? lineTotal(it!.unitCost, received), prev.product);
    const discount = part(it!.discountShare ?? 0, prev.discount);
    const freight = part(it!.freightShare ?? 0, prev.freight);
    const other = part(it!.otherShare ?? 0, prev.other);
    return { idx: it!.idx, skuId: it!.skuId!, qty: req.qty, product, discount, freight, other, value: product - discount + freight + other };
  });
}

/**
 * CFOP da devolução (regra assumida — validar com a contabilidade): pelo CFOP de entrada do item quando houver
 * (x101→x201, x102→x202, x401→x410, x403→x411); entrada com ST (CFOP de entrada do recebimento x401/x403 ou CFOP de
 * saída do fornecedor com ST: x401, x402, x403, x404, x405) → x411; demais → x202. Prefixo 5 (interna) ou 6.
 */
export function supplierReturnCfop(o: { itemEntryCfop?: string | null; entryCfop?: string | null; supplierCfop?: string | null; interstate: boolean }): string {
  const p = o.interstate ? "6" : "5";
  const map: Record<string, string> = { "101": "201", "102": "202", "401": "410", "403": "411" };
  const suf = (c?: string | null) => {
    const d = onlyDigits(c ?? "");
    return d.length === 4 ? d.slice(1) : "";
  };
  const item = suf(o.itemEntryCfop);
  if (map[item]) return p + map[item];
  const entry = suf(o.entryCfop);
  if (entry === "401" || entry === "403" || entry === "101") return p + map[entry];
  if (["401", "402", "403", "404", "405"].includes(suf(o.supplierCfop))) return `${p}411`;
  return `${p}202`;
}

function branchUf(b: Doc | null) {
  return b?.uf ?? b?.address?.uf ?? null;
}

/** Monta a entrada da NF-e a partir das linhas planejadas (preço = custo unitário da entrada; centavos no desconto/outras). */
function composeInput(base: NfeInput, r: Doc, supplier: Doc, branch: Doc | null, lines: SupplierReturnLine[], client: Array<Partial<NfeItemInput>> = []): NfeInput {
  const items: ReceiptItem[] = r.items ?? [];
  const recipient = partyRecipient(supplier, "supplier");
  const interstate = Boolean(recipient.address?.uf && branchUf(branch) && recipient.address.uf !== branchUf(branch));
  let otherAdj = 0;
  const out: NfeItemInput[] = lines.map((l, k) => {
    const it = items.find((i) => i.idx === l.idx)!;
    const src = client[k] ?? {};
    const gross = lineTotal(it.unitCost, l.qty);
    // gross (qtd × custo unitário) × valor proporcional da linha da nota: a diferença de arredondamento vai para o
    // desconto (gross maior) ou para outras despesas (gross menor) — o total do item fecha com o valor devolvido
    otherAdj += Math.max(0, l.product - gross);
    return {
      skuId: it.skuId!,
      qty: l.qty,
      unitPrice: it.unitCost,
      discount: l.discount + Math.max(0, gross - l.product),
      description: src.description || it.description,
      taxGroupId: src.taxGroupId ?? null,
      cfop: src.cfop || supplierReturnCfop({ itemEntryCfop: (it as ReceiptItem & { entryCfop?: string | null }).entryCfop, entryCfop: r.entryCfop, supplierCfop: it.cfop, interstate }),
      cstCsosn: src.cstCsosn ?? null,
      sourceIdx: l.idx,
    };
  });
  const key = onlyDigits(r.nfeKey);
  const keys = [...new Set([...(key.length === 44 ? [key] : []), ...(base.referencedKeys ?? []).map(onlyDigits).filter(Boolean)])];
  const wh = base.effects?.warehouseId ?? null;
  return {
    ...base,
    origin: { type: "receipt", id: r.id },
    nature: base.nature?.trim() || "Devolução de mercadoria ao fornecedor",
    purpose: "devolucao",
    operationType: "saida",
    recipient,
    items: out,
    freight: lines.reduce((a, l) => a + l.freight, 0),
    insurance: 0,
    other: lines.reduce((a, l) => a + l.other, 0) + otherAdj,
    payments: base.payments?.length ? base.payments : [{ kind: "none", amount: 0 }],
    referencedKeys: keys,
    effects: { stock: Boolean(base.effects?.stock), financial: false, warehouseId: wh, dueDate: null, paymentTermId: null },
  };
}

function planOf(r: Doc, lines: SupplierReturnLine[]): SupplierReturnPlan {
  return { receiptId: r.id, receiptNumber: r.number, titleId: r.payableTitleId ?? null, abate: Boolean(r.payableTitleId), lines, amount: lines.reduce((a, l) => a + l.value, 0) };
}

/** Restante devolvível por item (para a tela). */
export type ReturnableMap = Record<number, { received: number; returned: number; max: number }>;

/** Pré-preenchimento da NF-e de devolução a partir do recebimento (devolução do restante de todos os itens). */
export async function receiptReturnPrefill(ctx: Ctx, id: string, branchId: string, excludeDocId: string | null, base: NfeInput) {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const r = await ctx.store.getOrThrow("receipts", id);
  assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
  if (!(await isFeatureOn(ctx.store, ctx.companyId, branchId, SUPPLIER_RETURN_FLAG, true))) blockers.push("A devolução a fornecedor pelo recebimento está desativada nos parâmetros (Administração → Parâmetros → Compras).");
  if (r.status !== "confirmed") blockers.push(`O recebimento nº ${r.number} não está concluído: somente recebimento confirmado pode ser devolvido ao fornecedor.`);
  if (r.branchId !== branchId) {
    const b = r.branchId ? await ctx.store.get("branches", r.branchId) : null;
    blockers.push(`O recebimento nº ${r.number} pertence ${b ? `à filial ${b.name}` : "a outra filial"}: a NF-e deve ser emitida pela filial da operação — selecione-a no topo da tela.`);
  }
  const supplier = await ctx.store.getOrThrow("suppliers", r.supplierId);
  const branch = await ctx.store.get("branches", branchId);
  const items: ReceiptItem[] = r.items ?? [];
  const ledger = await receiptReturnLedger(ctx.store, ctx.companyId, id, excludeDocId);
  const returnable: ReturnableMap = {};
  const requested: Array<{ idx: number; qty: number }> = [];
  for (const it of returnableItems(items)) {
    const returned = ledger.get(it.idx)?.qty ?? 0;
    const max = Math.max(0, it.receivedQty - returned);
    returnable[it.idx] = { received: it.receivedQty, returned, max };
    if (max > 0) requested.push({ idx: it.idx, qty: max });
  }
  if (!requested.length && r.status === "confirmed") blockers.push("Todos os itens deste recebimento já foram devolvidos (NF-e de devolução autorizadas ou em andamento).");
  if (onlyDigits(r.nfeKey).length !== 44) warnings.push("Recebimento sem chave da NF-e de entrada: informe a chave referenciada.");
  if (!r.payableTitleId) warnings.push("Recebimento sem título a pagar: a NF-e não terá abatimento financeiro (somente documento e, se marcado, baixa de estoque).");
  warnings.push("Devolução a fornecedor: quantidades limitadas ao restante devolvível de cada item e valores proporcionais à nota de entrada (preço, desconto, frete e despesas), recalculados no servidor. Na autorização: baixa de estoque e abatimento no contas a pagar do recebimento — estornados se a NF-e for cancelada.");
  const lines = planReturnLines(items, ledger, requested);
  const wh = r.warehouseId ? await ctx.store.get("warehouses", r.warehouseId) : null;
  const input = composeInput(
    { ...base, nature: "Devolução de mercadoria ao fornecedor", presence: "9", effects: { stock: effectsOf(r).updateStock, financial: false, warehouseId: wh && wh.companyId === ctx.companyId && wh.branchId === branchId ? wh.id : null } },
    r,
    supplier,
    branch,
    lines,
  );
  return { input, plan: planOf(r, lines), returnable, warnings, blockers, label: `Recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""}`, href: `/compras/recebimentos/${id}` };
}

/**
 * Normaliza a entrada do formulário (origem recebimento): só a seleção de itens e as quantidades vêm do cliente
 * (além de descrição/CFOP/CST/grupo); preços, descontos, frete, outras despesas, destinatário e chave referenciada
 * vêm do recebimento. Recusa quantidade acima do restante devolvível.
 */
export async function prepareReceiptReturn(ctx: Ctx, input: NfeInput, opts: { excludeDocId?: string | null }) {
  const id = input.origin.id;
  assert(id, "Origem sem identificador.");
  const r = await ctx.store.getOrThrow("receipts", id!);
  assert(r.companyId === ctx.companyId, "Recebimento de outra empresa.");
  assert(r.status === "confirmed", `O recebimento nº ${r.number} não está concluído.`, "receipt_not_confirmed");
  assert(r.branchId === input.branchId, "A NF-e de devolução deve ser emitida pela filial do recebimento.", "branch_mismatch");
  assert(input.items.length > 0, "Inclua ao menos um item.");
  const requested = input.items.map((it) => {
    assert(it.sourceIdx != null, "Item fora do recebimento: a devolução pelo recebimento só aceita itens da nota de entrada.", "invalid_item");
    return { idx: Number(it.sourceIdx), qty: it.qty };
  });
  const supplier = await ctx.store.getOrThrow("suppliers", r.supplierId);
  const branch = await ctx.store.get("branches", input.branchId);
  const ledger = await receiptReturnLedger(ctx.store, ctx.companyId, r.id, opts.excludeDocId ?? null);
  const lines = planReturnLines(r.items ?? [], ledger, requested);
  return { input: composeInput(input, r, supplier, branch, lines, input.items), plan: planOf(r, lines) };
}

// ───────────────────────────── Efeito financeiro (na autorização) e estorno (no cancelamento)

const TX_OPS = 95;
const markerId = (docId: string) => detId("supret-abate", docId);
const abateIdem = (docId: string, instId: string) => `supplier_return:${docId}:abate:${instId}`;

/**
 * Abate o valor devolvido do título a pagar do recebimento (da última parcela em aberto para a primeira); o
 * excedente vira título a receber do fornecedor, limitado ao efetivamente pago e ainda não creditado. Uma única vez:
 * o marcador `supret-abate` é criado na mesma transação das baixas — retentativas devolvem o resultado gravado.
 */
export async function applySupplierReturnFinance(ctx: Ctx, doc: Doc): Promise<SupplierReturnResult | null> {
  const plan = doc.effects?.supplierReturn as SupplierReturnPlan | undefined;
  if (!plan || !plan.abate || !(plan.amount > 0)) return null;
  const mid = markerId(doc.id);
  const done = await ctx.store.get("operations", mid);
  if (done) return done.result as SupplierReturnResult;
  const label = `NF-e de devolução nº ${doc.number ?? doc.ref}`;
  const date = today();
  let created = false;
  const result = await retryOnConflict(async () => {
    const again = await ctx.store.get("operations", mid);
    if (again) return again.result as SupplierReturnResult;
    const title0 = plan.titleId ? await ctx.store.get("titles", plan.titleId) : null;
    const title = title0 && title0.companyId === ctx.companyId && title0.kind === "payable" && title0.status !== "cancelled" ? title0 : null;
    const insts = title ? (await listAll(ctx.store, "installments", { filters: [["eq", "titleId", title.id]] })).filter((i) => ["open", "partial"].includes(i.status) && i.balance > 0) : [];
    const open = insts.reduce((a, i) => a + i.balance, 0);
    const abated = Math.min(plan.amount, open);
    const sorted = [...insts].sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)) || (b.number ?? 0) - (a.number ?? 0));
    const takes: Array<{ inst: Doc; take: number }> = [];
    let rest = abated;
    for (const inst of sorted) {
      if (rest <= 0) break;
      const take = Math.min(rest, inst.balance);
      takes.push({ inst, take });
      rest -= take;
    }
    // excedente: crédito limitado ao efetivamente pago (baixas ativas, principal − desconto) e ainda não creditado
    let credited = 0;
    if (plan.amount > abated && title) {
      const paidSettles = await listAll(ctx.store, "settlements", { filters: [["eq", "titleId", title.id], ["eq", "kind", "settlement"], ["eq", "status", "active"]] });
      const paid = paidSettles.reduce((a, s) => a + (s.principal ?? 0) - (s.discount ?? 0), 0);
      const credits = (await listAll(ctx.store, "titles", { filters: [["eq", "originType", "supplier_return"], ["eq", "operationId", title.id]] })).filter((t) => t.companyId === ctx.companyId && t.status !== "cancelled" && t.originId !== doc.id);
      const available = Math.max(0, paid - credits.reduce((a, t) => a + (t.total ?? 0), 0));
      credited = Math.min(plan.amount - abated, available);
    }
    const unmatched = plan.amount - abated - credited;
    if (1 + 2 * takes.length + 1 + (credited > 0 ? 2 : 0) > TX_OPS) throw new BusinessError("O título a pagar do recebimento tem parcelas demais para abater numa única operação. Contate o suporte.", "tx_limit");
    const res: SupplierReturnResult = { abated, credited, creditTitleId: null, unmatched, installments: [] };
    await ctx.store.transaction(async (t) => {
      for (const { inst, take } of takes) {
        const idem = abateIdem(doc.id, inst.id);
        const seq = (inst.seq ?? 0) + 1;
        const sid = detId("settle", idem);
        // baixa sem movimento em conta, na sequência da parcela (baixa/estorno concorrente gera conflito e relê)
        await t.create(
          "settlements",
          {
            companyId: ctx.companyId, branchId: inst.branchId ?? doc.branchId, createdBy: ctx.user.id, installmentId: inst.id, titleId: inst.titleId, kind: "abatement", seq, date,
            principal: take, interest: 0, fine: 0, discount: take, fee: 0, total: 0, methodId: null, methodKind: "supplier_return", accountId: null, accountEntryId: null,
            reference: label.slice(0, 120), notes: `Abatimento por devolução ao fornecedor — recebimento nº ${plan.receiptNumber}`, status: "active", operationId: doc.id, idemKey: idem,
          },
          sid,
        );
        const balance = inst.balance - take;
        await t.update("installments", inst.id, { paid: (inst.paid ?? 0) + take, discount: (inst.discount ?? 0) + take, balance, status: balance === 0 ? "paid" : "partial", seq, lastSettlementAt: date });
        res.installments.push({ installmentId: inst.id, number: inst.number, amount: take, settlementId: sid });
      }
      if (title && abated > 0) await t.increment("titles", title.id, "balance", -abated, { min: 0 });
      if (credited > 0) {
        const credit = await createTitle(
          ctx,
          {
            kind: "receivable", partyType: "supplier", partyId: title!.partyId ?? doc.partyId ?? null, partyName: title!.partyName ?? doc.recipientName ?? null,
            description: `Crédito com fornecedor — ${label} (recebimento nº ${plan.receiptNumber})`, documentNumber: String(doc.number ?? ""), originType: "supplier_return", originId: doc.id,
            operationId: title!.id, issueDate: date, categoryId: title!.categoryId ?? null, costCenterId: title!.costCenterId ?? null, installments: [{ dueDate: date, amount: credited }],
            notes: `Devolução de mercadoria com o título a pagar nº ${title!.number} já pago: valor a receber (ou compensar) do fornecedor.`, idemKey: `supplier_return:${doc.id}:credit`, branchId: doc.branchId,
          },
          t,
        );
        res.creditTitleId = credit.id;
      }
      await t.create("operations", { companyId: ctx.companyId, type: "fiscal.supplier_return_abatement", status: "done", entityType: "fiscal_document", entityId: doc.id, createdBy: ctx.user.id, result: res }, mid);
    });
    created = true;
    return res;
  }).catch(async (e) => {
    // repetição concorrente: a outra execução gravou o marcador
    if (isConflict(e)) {
      const m = await ctx.store.get("operations", mid);
      if (m) return m.result as SupplierReturnResult;
      if (e.reason === "bounds") throw new BusinessError("O título a pagar foi alterado por outra operação ao mesmo tempo. Consulte o documento novamente para concluir o abatimento.", "concurrent_change");
    }
    throw e;
  });
  if (!created) return result;
  if (plan.titleId && result.abated > 0) {
    await refreshTitleStatus(ctx.store, plan.titleId);
    for (const x of result.installments) {
      const inst = await ctx.store.get("installments", x.installmentId);
      if (inst?.status === "paid") await resolveOccurrence(ctx.store, `payable_due:${inst.id}`);
    }
  }
  const parts = [result.abated > 0 ? `abatido ${formatMoney(result.abated)} do título a pagar` : "", result.credited > 0 ? `crédito com o fornecedor ${formatMoney(result.credited)}` : "", result.unmatched > 0 ? `${formatMoney(result.unmatched)} sem título a abater nem pagamento a compensar` : ""].filter(Boolean);
  await audit(ctx, {
    module: "finance", action: "title.supplier_return", entityType: "title", entityId: plan.titleId ?? result.creditTitleId ?? doc.id,
    summary: `Devolução ao fornecedor (${label}, recebimento nº ${plan.receiptNumber}) — ${formatMoney(plan.amount)}: ${parts.join("; ") || "sem efeito financeiro"}`,
    related: [`fiscal_document:${doc.id}`, `receipt:${plan.receiptId}`, ...(plan.titleId ? [`title:${plan.titleId}`] : []), ...(result.creditTitleId ? [`title:${result.creditTitleId}`] : [])],
  });
  if (result.unmatched > 0) {
    await notify(ctx.store, { companyId: ctx.companyId, branchId: doc.branchId, type: "info", priority: "high", title: `Devolução ao fornecedor sem compensação financeira (${formatMoney(result.unmatched)})`, body: `A ${label} do recebimento nº ${plan.receiptNumber} excede o saldo em aberto e o valor pago do título a pagar. Trate o acerto com o fornecedor no Financeiro.`, link: `/fiscal/nfe/${doc.id}`, originType: "fiscal_document", originId: doc.id, occurrenceKey: `supplier-return:${doc.id}`, audience: { action: "finance.settle" } }).catch(() => undefined);
  }
  return result;
}

/**
 * Estorna o efeito financeiro (cancelamento da NF-e de devolução): baixas de abatimento estornadas (parcelas voltam ao
 * saldo) e crédito com o fornecedor cancelado. Idempotente: baixas já estornadas são ignoradas; o marcador fica
 * "reversed". Devolve as observações para o histórico do documento (null = nada a estornar).
 */
export async function reverseSupplierReturnFinance(ctx: Ctx, doc: Doc, reason: string): Promise<string[] | null> {
  const mid = markerId(doc.id);
  const marker = await ctx.store.get("operations", mid);
  if (!marker) return null;
  if (marker.status === "reversed") return [];
  const res = marker.result as SupplierReturnResult;
  const notes: string[] = [];
  const touched = new Set<string>();
  const skipped: string[] = [];
  await retryOnConflict(async () => {
    skipped.length = 0;
    touched.clear();
    const cur = await ctx.store.get("operations", mid);
    if (cur?.status === "reversed") return;
    let sum = 0;
    let titleId: string | null = null;
    await ctx.store.transaction(async (t) => {
      for (const x of res.installments ?? []) {
        const s = await ctx.store.get("settlements", x.settlementId);
        if (!s || s.status !== "active") continue;
        const inst = await ctx.store.getOrThrow("installments", s.installmentId);
        const title = await ctx.store.getOrThrow("titles", s.titleId);
        if (inst.status === "cancelled" || inst.status === "renegotiated" || title.status === "cancelled") {
          skipped.push(`parcela ${inst.number} (título ${title.status === "cancelled" ? "cancelado" : inst.status === "cancelled" ? "com parcela cancelada" : "renegociado"})`);
          continue;
        }
        const seq = (inst.seq ?? 0) + 1;
        await t.create(
          "settlements",
          {
            companyId: ctx.companyId, branchId: s.branchId, createdBy: ctx.user.id, installmentId: s.installmentId, titleId: s.titleId, kind: "reversal", seq, date: today(),
            principal: -s.principal, interest: 0, fine: 0, discount: -s.discount, fee: 0, total: 0, methodKind: s.methodKind, accountId: null, status: "active",
            notes: `Estorno do abatimento — cancelamento da NF-e de devolução: ${reason}`.slice(0, 500), idemKey: `reversal:${s.id}`, operationId: s.operationId,
          },
          detId("settle", `reversal:${s.id}`),
        );
        await t.update("settlements", s.id, { status: "reversed", reversedAt: new Date().toISOString(), reversedBy: ctx.user.id, reversalReason: reason.slice(0, 300) });
        const paid = (inst.paid ?? 0) - s.principal;
        await t.update("installments", inst.id, { paid, discount: (inst.discount ?? 0) - s.discount, balance: inst.amount - paid, status: paid === 0 ? "open" : "partial", seq });
        sum += s.principal;
        titleId = s.titleId;
        touched.add(inst.id);
      }
      if (titleId && sum > 0) await t.increment("titles", titleId, "balance", sum);
      await t.update("operations", mid, { status: "reversed", error: null });
    });
    if (sum > 0) notes.push(`abatimento de ${formatMoney(sum)} estornado no título a pagar`);
  });
  const plan = doc.effects?.supplierReturn as SupplierReturnPlan | undefined;
  if (plan?.titleId) await refreshTitleStatus(ctx.store, plan.titleId).catch(() => undefined);
  for (const instId of touched) {
    const inst = await ctx.store.get("installments", instId);
    if (inst && inst.status !== "paid" && inst.dueDate < today()) await reopenOccurrence(ctx.store, `payable_due:${inst.id}`).catch(() => undefined);
  }
  if (skipped.length) notes.push(`abatimento NÃO estornado em ${skipped.join(", ")}`);
  if (res.creditTitleId) {
    try {
      await cancelTitle(ctx, res.creditTitleId, `Cancelamento da NF-e de devolução: ${reason}`);
      notes.push("crédito com o fornecedor cancelado");
    } catch (e: any) {
      notes.push(`crédito com o fornecedor NÃO cancelado: ${e.message}`);
      await notify(ctx.store, { companyId: ctx.companyId, branchId: doc.branchId, type: "info", priority: "high", title: `Crédito com fornecedor da NF-e nº ${doc.number ?? ""} exige ação`, body: `A NF-e de devolução foi cancelada, mas o título a receber do fornecedor possui baixas: ${e.message}`, link: `/financeiro/receber/${res.creditTitleId}`, originType: "fiscal_document", originId: doc.id, occurrenceKey: `supplier-return-credit:${doc.id}`, audience: { action: "finance.reverse" } }).catch(() => undefined);
    }
  }
  await audit(ctx, { module: "finance", action: "title.supplier_return_reversal", entityType: "title", entityId: plan?.titleId ?? res.creditTitleId ?? doc.id, summary: `Cancelamento da NF-e de devolução nº ${doc.number ?? doc.ref}: ${notes.join("; ") || "nada a estornar"}`, reason, related: [`fiscal_document:${doc.id}`] });
  return notes;
}

// ───────────────────────────── Consulta para a tela do recebimento

/** Devoluções do recebimento: NF-e (todas, com situação) e quantidades por item (autorizado, em andamento, restante). */
export async function receiptReturnsView(store: Store, companyId: string, r: Doc) {
  const all = (await listAll(store, "fiscal_documents", { filters: [["eq", "originType", "receipt"], ["eq", "originId", r.id]] })).filter((d) => d.companyId === companyId);
  const done = new Map<number, number>();
  const pending = new Map<number, number>();
  for (const d of all) {
    if (INACTIVE.includes(d.status)) continue;
    const target = d.status === "authorized" ? done : pending;
    for (const l of (d.effects?.supplierReturn?.lines ?? []) as SupplierReturnLine[]) target.set(l.idx, (target.get(l.idx) ?? 0) + l.qty);
  }
  const rows = returnableItems(r.items ?? []).map((i) => {
    const returned = done.get(i.idx) ?? 0;
    const inProgress = pending.get(i.idx) ?? 0;
    return { idx: i.idx, description: i.description, sku: i.sku ?? null, received: i.receivedQty, returned, inProgress, rest: Math.max(0, i.receivedQty - returned - inProgress) };
  });
  const docs = all
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .map((d) => ({ id: d.id, number: d.number ?? null, status: d.status as string, total: d.total ?? 0, issuedAt: d.issuedAt ?? d.createdAt ?? null, abated: d.effects?.supplierReturn?.result?.abated ?? 0, credited: d.effects?.supplierReturn?.result?.credited ?? 0, isSimulated: Boolean(d.isSimulated) }));
  return { rows, docs, anyReturned: rows.some((x) => x.returned + x.inProgress > 0), anyRest: rows.some((x) => x.rest > 0) };
}
