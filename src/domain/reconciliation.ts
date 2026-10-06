import { detId, isConflict, listAll, retryOnConflict, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { addDays, diffDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { getSetting } from "@/lib/core/settings";
import { findInstallmentByCollectionRef, postEntry, settleInstallment, settlementFeeEntryId } from "./finance";
import { FORMAT_LABEL, hashParts, normalizeBankCode, parseBankFile, type BankFormat, type CsvMapping, type CsvSniff, type ParseResult, type ParsedTx } from "./bank";

/**
 * Conciliação bancária (Tela 25 / visão 5):
 *  - Importação idempotente: identidade do arquivo = hash do conteúdo + conta (bank_imports.scopeKey único);
 *    identidade da transação = FITID (OFX) ou hash data+valor+documento+ordem (bank_transactions.uniqueKey único).
 *  - Sugestão NÃO é confirmação: só `reconcile` vincula extrato × lançamentos (1:1, 1:N, N:1) com valores alocados.
 *  - Cada item participa de uma única conciliação ativa (vínculo com id determinístico em reconciliation_links).
 *  - Desconciliar remove o vínculo; recebimentos/pagamentos e lançamentos permanecem.
 */

export const importScopeKey = (companyId: string, accountId: string, hash: string) => `${companyId}:${accountId}:${hash}`;
export const importId = (scopeKey: string) => detId("bankimport", scopeKey);
const txId = (uniqueKey: string) => detId("banktx", uniqueKey);
const linkId = (type: "bank_tx" | "entry", id: string) => detId("reclink", type, id);

/** Chaves únicas das transações do arquivo (estáveis entre reimportações do mesmo período). */
export function transactionKeys(accountId: string, txs: ParsedTx[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    if (t.kind === "statement" && t.externalId) return `ofx:${hashParts(accountId, "fitid", t.externalId, t.date, t.amount)}`;
    const base = t.kind === "statement" ? ["stmt", t.date, t.amount, t.docNumber ?? ""] : ["cnab", t.kind, t.ourNumber ?? "", t.yourNumber ?? "", t.occurrence ?? "", t.date, t.amount];
    const k = base.join("|");
    const ord = (seen.get(k) ?? 0) + 1;
    seen.set(k, ord);
    return `${t.kind === "statement" ? "stmt" : "cnab"}:${hashParts(accountId, ...base, ord)}`;
  });
}

export interface ImportInput {
  accountId: string;
  fileName: string;
  data: Buffer;
  mime?: string | null;
  format?: BankFormat | "auto";
  csvMapping?: CsvMapping | null;
}

async function loadAccount(ctx: Ctx, accountId: string) {
  const acc = await ctx.store.get("financial_accounts", accountId);
  assert(acc && acc.companyId === ctx.companyId, "Selecione uma conta financeira válida.");
  return acc;
}

function accountWarnings(acc: Doc, r: ParseResult): string[] {
  const w: string[] = [];
  const fileBank = normalizeBankCode(r.bankCode);
  const accBank = normalizeBankCode(acc.bankCode);
  if (fileBank && accBank && fileBank !== accBank) w.push(`Arquivo do banco ${fileBank}${r.bankName ? ` (${r.bankName})` : ""}, mas a conta "${acc.name}" é do banco ${accBank}.`);
  const fileAcc = (r.account?.accountId ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const accNum = (acc.accountNumber ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (r.format === "ofx" && fileAcc && accNum && !fileAcc.endsWith(accNum) && !accNum.endsWith(fileAcc)) w.push(`Conta do arquivo (${r.account?.accountId}) difere da conta cadastrada (${acc.accountNumber}).`);
  return w;
}

async function existingIds(store: Store, collection: string, ids: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await listAll(store, collection, { filters: [["eq", "id", chunk]] });
    for (const r of res) found.add(r.id);
  }
  return found;
}

export interface ImportPreview {
  result: ParseResult;
  csv: CsvSniff | null;
  formatLabel: string;
  hash: string;
  alreadyImported: { id: string; createdAt: string; fileName: string } | null;
  newCount: number;
  duplicateCount: number;
  warnings: string[];
  /** motivo que impede a importação (o servidor recusa pelo mesmo critério) */
  blockReason: string | null;
  rows: Array<ParsedTx & { duplicate: boolean }>;
}

/** Pré-visualização (sem gravar): formato, banco, versão, linhas válidas/inválidas/não suportadas e duplicidades. */
export async function previewBankImport(ctx: Ctx, input: ImportInput): Promise<ImportPreview> {
  const acc = await loadAccount(ctx, input.accountId);
  const { result, csv } = parseBankFile(input.data, input.fileName, { format: input.format, csvMapping: input.csvMapping });
  const hash = sha256(input.data);
  const imp = await ctx.store.get("bank_imports", importId(importScopeKey(ctx.companyId, acc.id, hash)));
  const keys = transactionKeys(acc.id, result.transactions);
  const dup = await existingIds(ctx.store, "bank_transactions", keys.map(txId));
  const rows = result.transactions.map((t, i) => ({ ...t, duplicate: dup.has(txId(keys[i])) }));
  const warnings = accountWarnings(acc, result);
  return {
    blockReason: result.fatal ?? (result.kind === "collection_return" && warnings.length && normalizeBankCode(acc.bankCode) ? warnings[0] : null),
    result: { ...result, transactions: [] },
    csv,
    formatLabel: FORMAT_LABEL[result.format],
    hash,
    alreadyImported: imp && imp.status === "completed" ? { id: imp.id, createdAt: imp.createdAt, fileName: imp.fileName } : null,
    newCount: rows.filter((r) => !r.duplicate).length,
    duplicateCount: rows.filter((r) => r.duplicate).length,
    warnings,
    rows,
  };
}

export interface LineResult {
  line: number;
  status: "imported" | "duplicate" | "invalid" | "unsupported" | "info";
  message: string;
  txId?: string | null;
  amount?: number | null;
}

/** Importa o arquivo (idempotente pelo hash+conta; transações únicas por chave). */
export async function importBankFile(ctx: Ctx, input: ImportInput) {
  requireBranch(ctx);
  const acc = await loadAccount(ctx, input.accountId);
  const { result } = parseBankFile(input.data, input.fileName, { format: input.format, csvMapping: input.csvMapping });
  if (result.fatal) throw new BusinessError(`Arquivo não importado: ${result.fatal}`, "invalid_file");
  const warnings = accountWarnings(acc, result);
  if (result.kind === "collection_return" && warnings.length && normalizeBankCode(acc.bankCode)) throw new BusinessError(warnings[0], "bank_mismatch");
  const hash = sha256(input.data);
  const scopeKey = importScopeKey(ctx.companyId, acc.id, hash);
  const id = importId(scopeKey);
  let imp = await ctx.store.get("bank_imports", id);
  if (imp?.status === "completed") return { import: imp, alreadyImported: true as const };
  if (!imp) {
    const file = await saveFile(ctx, { bucket: "attachments", name: input.fileName, mime: input.mime || "application/octet-stream", data: input.data, entityType: "bank_import", entityId: id, kind: "bank_file", branchId: acc.branchId ?? ctx.branchId });
    try {
      imp = await ctx.store.create(
        "bank_imports",
        {
          companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, accountId: acc.id, format: result.format, fileName: input.fileName, fileId: file.id, fileHash: hash,
          bankCode: result.bankCode, layoutVersion: result.layoutVersion, kind: result.kind, status: "processing", summary: {}, lineResults: [], scopeKey,
        },
        id,
      );
    } catch (e) {
      if (!isConflict(e)) throw e;
      imp = await ctx.store.getOrThrow("bank_imports", id);
      if (imp.status === "completed") return { import: imp, alreadyImported: true as const };
    }
  }
  const keys = transactionKeys(acc.id, result.transactions);
  const lines: LineResult[] = [];
  let created = 0;
  let duplicates = 0;
  for (const [i, t] of result.transactions.entries()) {
    const uniqueKey = keys[i];
    const tid = txId(uniqueKey);
    let installmentId: string | null = null;
    if (t.kind === "collection") installmentId = (await findInstallmentByCollectionRef(ctx.store, ctx.companyId, { ourNumber: t.ourNumber, yourNumber: t.yourNumber }))?.id ?? null;
    try {
      await ctx.store.create(
        "bank_transactions",
        {
          companyId: ctx.companyId, branchId: acc.branchId ?? ctx.branchId, createdBy: ctx.user.id, accountId: acc.id, importId: id, uniqueKey, externalId: t.externalId ?? null, date: t.date,
          amount: t.amount, description: t.description, docNumber: t.docNumber ?? null, kind: t.kind, cnabOccurrence: t.occurrence ?? null, cnabOccurrenceText: t.occurrenceText ?? null,
          ourNumber: t.ourNumber ?? null, yourNumber: t.yourNumber ?? null, status: "pending", installmentId, feeAmount: t.fee ?? null, lineNo: t.lineNo, bankCode: result.bankCode,
          dueDate: t.dueDate ?? null, creditDate: t.creditDate ?? null, paidAmount: t.paidAmount ?? null, interestAmount: t.interest ?? null, discountAmount: t.discount ?? null, payerName: t.payerName ?? null,
        },
        tid,
      );
      created++;
      lines.push({ line: t.lineNo, status: "imported", message: installmentId ? "Importada — parcela correspondente localizada (sugestão)." : "Importada.", txId: tid, amount: t.amount });
    } catch (e) {
      if (!isConflict(e)) throw e;
      const prev = await ctx.store.get("bank_transactions", tid);
      if (prev?.importId === id) {
        created++;
        lines.push({ line: t.lineNo, status: "imported", message: "Importada.", txId: tid, amount: t.amount });
      } else {
        duplicates++;
        lines.push({ line: t.lineNo, status: "duplicate", message: `Já importada anteriormente${prev?.importId ? " (outro arquivo)" : ""} — não duplicada.`, txId: tid, amount: t.amount });
      }
    }
  }
  for (const is of result.issues) lines.push({ line: is.lineNo, status: is.status, message: is.message + (is.raw ? ` [${is.raw.slice(0, 80)}]` : "") });
  lines.sort((a, b) => a.line - b.line);
  const credits = result.transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const debits = result.transactions.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const summary = {
    format: result.format, formatLabel: FORMAT_LABEL[result.format], kind: result.kind, bankCode: result.bankCode, bankName: result.bankName ?? null, layoutVersion: result.layoutVersion,
    totalLines: result.totalLines, transactions: result.transactions.length, created, duplicates,
    invalid: result.issues.filter((x) => x.status === "invalid").length, unsupported: result.issues.filter((x) => x.status === "unsupported").length, info: result.issues.filter((x) => x.status === "info").length,
    credits, debits, period: result.period ?? null, balance: result.balance ?? null, account: result.account ?? null, warnings,
  };
  const done = await ctx.store.update("bank_imports", id, { status: "completed", summary, lineResults: lines.slice(0, 5000) });
  await audit(ctx, {
    module: "finance", action: "bank.import", entityType: "bank_import", entityId: id,
    summary: `Importação ${FORMAT_LABEL[result.format]} "${input.fileName}" em ${acc.name}: ${created} nova(s), ${duplicates} duplicada(s), ${summary.invalid} inválida(s), ${summary.unsupported} não suportada(s)`,
    after: summary, related: [`financial_account:${acc.id}`],
  });
  return { import: done, alreadyImported: false as const };
}

// ───────────────────────────── Sugestões (não confirmam nada)

export interface Suggestion {
  bankTxId: string;
  entryIds: string[];
  score: number;
  reasons: string[];
  difference: number;
  /** para retornos/extrato sem lançamento: parcela a baixar */
  installmentId?: string | null;
}

export async function reconcileWindowDays(store: Store, companyId: string) {
  return getSetting<number>(store, companyId, null, "finance.reconcile.dateWindowDays", 5);
}

function docMatch(doc: string | null | undefined, hay: string) {
  const d = (doc ?? "").replace(/^0+/, "").trim();
  return d.length >= 3 && hay.toLowerCase().includes(d.toLowerCase());
}

/**
 * Pontuação: valor exato (+60) · data igual (+25), ±1 dia (+20), ±3 (+12), na janela (+5) · documento (+20).
 * Combinações 1:N (2–3 lançamentos na janela somando o valor) recebem 50 + data. Cada lançamento é sugerido a uma só linha.
 */
export function suggestMatches(bankTxs: Doc[], entries: Doc[], opts: { windowDays: number; refs?: Map<string, string> }): Map<string, Suggestion[]> {
  const out = new Map<string, Suggestion[]>();
  const free = entries.filter((e) => !e.reconciled && e.kind !== "initial" && !e.reversedBy && e.kind !== "reversal");
  const hay = (e: Doc) => `${e.description ?? ""} ${opts.refs?.get(e.id) ?? ""}`;
  const dateScore = (a: string, b: string) => {
    const d = Math.abs(diffDays(a, b));
    return d === 0 ? 25 : d <= 1 ? 20 : d <= 3 ? 12 : 5;
  };
  const all: Suggestion[] = [];
  for (const tx of bankTxs.filter((t) => t.status === "pending")) {
    const cands = free.filter((e) => Math.sign(e.amount) === Math.sign(tx.amount) && Math.abs(diffDays(e.date, tx.date)) <= opts.windowDays);
    const list: Suggestion[] = [];
    for (const e of cands) {
      const reasons: string[] = [];
      let score = 0;
      if (e.amount === tx.amount) {
        score += 60;
        reasons.push("valor exato");
      }
      const ds = dateScore(e.date, tx.date);
      const dd = diffDays(tx.date, e.date);
      if (docMatch(tx.docNumber, hay(e))) {
        score += 20;
        reasons.push("documento");
      }
      if (!score) continue;
      score += ds;
      reasons.push(dd === 0 ? "mesma data" : `data ${dd > 0 ? "+" : ""}${dd}d`);
      list.push({ bankTxId: tx.id, entryIds: [e.id], score, reasons, difference: tx.amount - e.amount });
    }
    if (!list.some((s) => s.difference === 0)) {
      const near = cands.sort((a, b) => Math.abs(diffDays(a.date, tx.date)) - Math.abs(diffDays(b.date, tx.date))).slice(0, 14);
      for (let i = 0; i < near.length; i++)
        for (let j = i + 1; j < near.length; j++) {
          if (near[i].amount + near[j].amount === tx.amount) list.push({ bankTxId: tx.id, entryIds: [near[i].id, near[j].id], score: 50 + Math.min(dateScore(near[i].date, tx.date), dateScore(near[j].date, tx.date)), reasons: ["soma de 2 lançamentos"], difference: 0 });
          for (let k = j + 1; k < near.length; k++)
            if (near[i].amount + near[j].amount + near[k].amount === tx.amount) list.push({ bankTxId: tx.id, entryIds: [near[i].id, near[j].id, near[k].id], score: 45 + Math.min(dateScore(near[i].date, tx.date), dateScore(near[k].date, tx.date)), reasons: ["soma de 3 lançamentos"], difference: 0 });
        }
    }
    list.sort((a, b) => b.score - a.score);
    all.push(...list.slice(0, 5));
  }
  // atribuição gulosa: cada lançamento aparece como melhor sugestão de uma única linha
  all.sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const usedTx = new Set<string>();
  for (const sgg of all) {
    if (usedTx.has(sgg.bankTxId) || sgg.entryIds.some((e) => used.has(e))) continue;
    usedTx.add(sgg.bankTxId);
    sgg.entryIds.forEach((e) => used.add(e));
    out.set(sgg.bankTxId, [sgg]);
  }
  // alternativas (até 3 por linha) — apenas exibidas, nunca aplicadas automaticamente
  for (const sgg of all) {
    const cur = out.get(sgg.bankTxId) ?? [];
    if (cur.length >= 3 || cur.includes(sgg)) continue;
    out.set(sgg.bankTxId, [...cur, sgg]);
  }
  return out;
}

/** Valores sugeridos para baixar uma parcela a partir de uma linha (extrato ou retorno). Editáveis na tela. */
export function suggestedSettlement(tx: Doc, inst: Doc) {
  if (tx.kind === "collection") {
    const paid = tx.paidAmount ?? tx.amount + (tx.feeAmount ?? 0);
    let interest = tx.interestAmount ?? 0;
    const discount = tx.discountAmount ?? 0;
    let principal = paid - interest + discount;
    if (principal > inst.balance) {
      interest += principal - inst.balance;
      principal = inst.balance;
    }
    return { principal: Math.max(0, principal), interest, fine: 0, discount, fee: tx.feeAmount ?? 0 };
  }
  const abs = Math.abs(tx.amount);
  const principal = Math.min(abs, inst.balance);
  return { principal, interest: Math.max(0, abs - inst.balance), fine: 0, discount: 0, fee: 0 };
}

// ───────────────────────────── Conciliação

export interface ReconcileInput {
  accountId: string;
  bankTxIds: string[];
  entryIds: string[];
  /** lança a diferença (tarifa/ajuste) e concilia junto */
  adjustment?: { categoryId?: string | null; costCenterId?: string | null; description?: string | null } | null;
  notes?: string | null;
  kind?: "manual" | "settlement" | "collection";
  idemKey: string;
}

export const reconciliationId = (idemKey: string) => detId("recon", idemKey);

export async function reconcile(ctx: Ctx, input: ReconcileInput) {
  requireBranch(ctx);
  const id = reconciliationId(input.idemKey);
  const existing = await ctx.store.get("reconciliations", id);
  if (existing) {
    assert(existing.companyId === ctx.companyId, "Conciliação de outra empresa.", "cross_company");
    // repetição devolve o registro da chave (settleFromBankTx usa chave nova a cada conciliação desfeita)
    return existing;
  }
  const bankTxIds = [...new Set(input.bankTxIds)];
  const entryIds = [...new Set(input.entryIds)];
  assert(bankTxIds.length >= 1, "Selecione ao menos uma linha do extrato.");
  assert(entryIds.length >= 1 || input.adjustment, "Selecione ao menos um lançamento do ERP (ou lance a diferença como tarifa/ajuste).");
  assert(!(bankTxIds.length > 1 && entryIds.length > 1), "Combinação N:N não suportada: concilie como 1:N (uma linha × vários lançamentos) ou N:1 (várias linhas × um lançamento).");
  assert(bankTxIds.length + entryIds.length <= 40, "Máximo de 40 itens por conciliação.");
  const acc = await loadAccount(ctx, input.accountId);
  let adjEntryId: string | null = null;
  const run = async (t: Store) => {
    const txs = await Promise.all(bankTxIds.map((x) => ctx.store.getOrThrow("bank_transactions", x)));
    const entries = await Promise.all(entryIds.map((x) => ctx.store.getOrThrow("account_entries", x)));
    for (const b of txs) {
      assert(b.companyId === ctx.companyId && b.accountId === acc.id, "Linha de extrato de outra conta.");
      assert(b.status === "pending", `A linha "${b.description}" já está ${b.status === "reconciled" ? "conciliada" : "ignorada"}.`);
      if (await ctx.store.get("reconciliation_links", linkId("bank_tx", b.id))) throw new BusinessError(`A linha "${b.description}" já foi conciliada por outra operação.`, "already_reconciled");
    }
    for (const e of entries) {
      assert(e.companyId === ctx.companyId && e.accountId === acc.id, "Lançamento de outra conta.");
      assert(e.kind !== "initial", "Marcador de saldo inicial não é conciliável.");
      assert(!e.reconciled, `O lançamento "${e.description}" já está conciliado.`);
      if (await ctx.store.get("reconciliation_links", linkId("entry", e.id))) throw new BusinessError(`O lançamento "${e.description}" já foi conciliado por outra operação.`, "already_reconciled");
    }
    const sumBank = txs.reduce((a, b) => a + b.amount, 0);
    const sumEntries = entries.reduce((a, e) => a + e.amount, 0);
    const difference = sumBank - sumEntries;
    const allocations: Array<{ bankTxId: string; entryId: string; amount: number }> = [];
    let adj: Doc | null = null;
    if (difference !== 0) {
      if (!input.adjustment) throw new BusinessError(`Diferença de ${formatMoney(difference)} entre o extrato (${formatMoney(sumBank)}) e os lançamentos (${formatMoney(sumEntries)}). Ajuste a seleção ou lance a diferença como tarifa/ajuste.`, "difference");
      const date = txs.map((b) => b.date).sort().pop()!;
      adj = await postEntry(ctx, t, {
        accountId: acc.id, date, amount: difference, kind: difference < 0 ? "fee" : "adjustment",
        description: input.adjustment.description?.trim() || (difference < 0 ? `Tarifa bancária — ${txs[0].description}` : `Ajuste de conciliação — ${txs[0].description}`),
        categoryId: input.adjustment.categoryId || null, costCenterId: input.adjustment.costCenterId || null, originType: "reconciliation", originId: id,
        idemKey: `recon-diff:${input.idemKey}`, branchId: acc.branchId ?? ctx.branchId, reconciliationId: id,
      });
      adjEntryId = adj.id;
    }
    if (txs.length === 1) {
      for (const e of entries) allocations.push({ bankTxId: txs[0].id, entryId: e.id, amount: e.amount });
      if (adj) allocations.push({ bankTxId: txs[0].id, entryId: adj.id, amount: adj.amount });
    } else {
      const main = entries[0];
      txs.forEach((b, i) => allocations.push({ bankTxId: b.id, entryId: main?.id ?? adj!.id, amount: i === 0 && adj && main ? b.amount - adj.amount : b.amount }));
      if (adj && main) allocations.push({ bankTxId: txs[0].id, entryId: adj.id, amount: adj.amount });
    }
    const allEntryIds = [...entries.map((e) => e.id), ...(adj ? [adj.id] : [])];
    const rec = await t.create(
      "reconciliations",
      {
        companyId: ctx.companyId, branchId: acc.branchId ?? ctx.branchId, createdBy: ctx.user.id, accountId: acc.id, status: "active", kind: input.kind ?? "manual",
        bankTxIds: txs.map((b) => b.id), entryIds: allEntryIds, allocations, difference, feeEntryId: adj?.id ?? null, notes: input.notes?.trim() || null,
      },
      id,
    );
    const base = { companyId: ctx.companyId, branchId: acc.branchId ?? ctx.branchId, createdBy: ctx.user.id, accountId: acc.id, reconciliationId: id };
    for (const b of txs) {
      await t.create("reconciliation_links", { ...base, targetType: "bank_tx", targetId: b.id, amount: b.amount }, linkId("bank_tx", b.id));
      await t.update("bank_transactions", b.id, { status: "reconciled", reconciliationId: id });
    }
    for (const e of entries) {
      await t.create("reconciliation_links", { ...base, targetType: "entry", targetId: e.id, amount: e.amount }, linkId("entry", e.id));
      await t.update("account_entries", e.id, { reconciled: true, reconciliationId: id });
    }
    if (adj) await t.create("reconciliation_links", { ...base, targetType: "entry", targetId: adj.id, amount: adj.amount }, linkId("entry", adj.id));
    return { rec, sumBank, sumEntries, difference };
  };
  const res = await retryOnConflict(() => ctx.store.transaction(run));
  const mode = bankTxIds.length === 1 && entryIds.length + (adjEntryId ? 1 : 0) === 1 ? "1:1" : bankTxIds.length === 1 ? "1:N" : "N:1";
  await audit(ctx, {
    module: "finance", action: "reconcile", entityType: "reconciliation", entityId: id,
    summary: `Conciliação ${mode} em ${acc.name}: extrato ${formatMoney(res.sumBank)} × lançamentos ${formatMoney(res.sumEntries)}${res.difference ? ` (diferença ${formatMoney(res.difference)} lançada)` : ""}`,
    after: { bankTxIds, entryIds, difference: res.difference, adjEntryId }, related: [`financial_account:${acc.id}`, ...entryIds.map((e) => `account_entry:${e}`)],
  });
  return res.rec;
}

/** Desfaz a conciliação: remove vínculos; baixas, lançamentos e tarifas lançadas permanecem. */
export async function undoReconciliation(ctx: Ctx, id: string, reason: string) {
  requireBranch(ctx);
  assert(reason?.trim(), "Informe o motivo para desfazer a conciliação.");
  const rec = await ctx.store.getOrThrow("reconciliations", id);
  assert(rec.companyId === ctx.companyId, "Conciliação de outra empresa.");
  if (rec.status === "undone") return rec;
  await retryOnConflict(() =>
    ctx.store.transaction(async (t) => {
      await t.update("reconciliations", id, { status: "undone", undoneAt: new Date().toISOString(), undoneBy: ctx.user.id, undoReason: reason.trim() });
      for (const b of rec.bankTxIds ?? []) {
        const cur = await ctx.store.get("bank_transactions", b);
        if (cur?.reconciliationId === id) await t.update("bank_transactions", b, { status: "pending", reconciliationId: null });
        await t.delete("reconciliation_links", linkId("bank_tx", b));
      }
      for (const e of rec.entryIds ?? []) {
        const cur = await ctx.store.get("account_entries", e);
        if (cur?.reconciliationId === id) await t.update("account_entries", e, { reconciled: false, reconciliationId: null });
        await t.delete("reconciliation_links", linkId("entry", e));
      }
    }),
  );
  await audit(ctx, { module: "finance", action: "reconcile.undo", entityType: "reconciliation", entityId: id, summary: "Conciliação desfeita (vínculos removidos; baixas e lançamentos preservados)", reason, related: [`financial_account:${rec.accountId}`, ...(rec.entryIds ?? []).map((e: string) => `account_entry:${e}`)] });
  return ctx.store.getOrThrow("reconciliations", id);
}

export async function ignoreBankTx(ctx: Ctx, id: string, reason: string) {
  requireBranch(ctx);
  assert(reason?.trim(), "Informe o motivo.");
  const tx = await ctx.store.getOrThrow("bank_transactions", id);
  assert(tx.companyId === ctx.companyId, "Linha de outra empresa.");
  assert(tx.status === "pending", "Somente linhas pendentes podem ser ignoradas.");
  await ctx.store.update("bank_transactions", id, { status: "ignored", notes: reason.trim() });
  await audit(ctx, { module: "finance", action: "bank_tx.ignore", entityType: "bank_transaction", entityId: id, summary: `Linha do extrato ignorada: ${tx.description} (${formatMoney(tx.amount)})`, reason, related: [`financial_account:${tx.accountId}`] });
}

export async function restoreBankTx(ctx: Ctx, id: string) {
  requireBranch(ctx);
  const tx = await ctx.store.getOrThrow("bank_transactions", id);
  assert(tx.companyId === ctx.companyId, "Linha de outra empresa.");
  if (tx.status !== "ignored") return;
  await ctx.store.update("bank_transactions", id, { status: "pending" });
  await audit(ctx, { module: "finance", action: "bank_tx.restore", entityType: "bank_transaction", entityId: id, summary: `Linha do extrato reativada: ${tx.description}`, related: [`financial_account:${tx.accountId}`] });
}

export interface SettleFromBankInput {
  bankTxId: string;
  installmentId: string;
  principal: number;
  interest?: number;
  fine?: number;
  discount?: number;
  fee?: number;
  methodId?: string | null;
  methodKind?: string | null;
}

/**
 * Chave da baixa gerada pela linha. A 1ª rodada usa `banktx:<linha>`; depois que essa baixa é estornada (conciliação
 * desfeita + estorno), a próxima rodada usa `banktx:<linha>:<n>` — repetir na mesma rodada (duplo clique) continua
 * idempotente, mas uma baixa estornada nunca é reaproveitada como se fosse nova.
 */
async function bankTxSettlementKey(ctx: Ctx, txId: string): Promise<{ key: string; existing: Doc | null }> {
  for (let n = 0; n < 100; n++) {
    const key = n === 0 ? `banktx:${txId}` : `banktx:${txId}:${n}`;
    const existing = await ctx.store.get("settlements", detId("settle", key));
    if (!existing || existing.status !== "reversed") return { key, existing };
  }
  throw new BusinessError("Esta linha já gerou baixas estornadas demais. Concilie manualmente.", "too_many_rounds");
}

/** Chave da conciliação automática da linha: conciliações desfeitas não são devolvidas como se fossem a nova. */
async function bankTxReconcileKey(ctx: Ctx, txId: string): Promise<string> {
  for (let n = 0; n < 100; n++) {
    const key = n === 0 ? `banktx-settle:${txId}` : `banktx-settle:${txId}:${n}`;
    const existing = await ctx.store.get("reconciliations", reconciliationId(key));
    if (!existing || existing.status !== "undone") return key;
  }
  throw new BusinessError("Esta linha já teve conciliações desfeitas demais. Concilie manualmente.", "too_many_rounds");
}

/** Baixa a parcela a partir de uma linha do extrato/retorno e já concilia (a soma dos lançamentos deve fechar com a linha). */
export async function settleFromBankTx(ctx: Ctx, input: SettleFromBankInput): Promise<{ settlement: Doc; reconciliation: Doc; reused: boolean; installmentNumber: number }> {
  requireBranch(ctx);
  const tx = await ctx.store.getOrThrow("bank_transactions", input.bankTxId);
  assert(tx.companyId === ctx.companyId, "Linha de outra empresa.");
  const inst = await ctx.store.getOrThrow("installments", input.installmentId);
  assert(inst.companyId === ctx.companyId, "Parcela de outra empresa.");
  const prior = tx.settlementId ? await ctx.store.get("settlements", tx.settlementId) : null;
  if (tx.status === "reconciled" && prior?.status === "active" && prior.installmentId === inst.id && tx.reconciliationId) {
    const rec = await ctx.store.get("reconciliations", tx.reconciliationId);
    if (rec?.status === "active") return { settlement: prior, reconciliation: rec, reused: true, installmentNumber: inst.number };
  }
  assert(tx.status === "pending", tx.status === "reconciled" ? "A linha já está conciliada. Desfaça a conciliação para baixar outra parcela." : "A linha não está pendente.");
  if (inst.kind === "receivable") assert(tx.amount > 0, "Recebimentos só podem ser baixados a partir de créditos.");
  else assert(tx.amount < 0, "Pagamentos só podem ser baixados a partir de débitos.");
  const interest = input.interest ?? 0;
  const fine = input.fine ?? 0;
  const discount = input.discount ?? 0;
  const fee = input.fee ?? 0;
  const sign = inst.kind === "receivable" ? 1 : -1;
  const net = sign * (input.principal - discount + interest + fine) - fee;
  assert(net === tx.amount, `Os valores informados resultam em ${formatMoney(net)} na conta, mas a linha é de ${formatMoney(tx.amount)}. Ajuste principal, juros, desconto ou tarifa.`, "difference");
  // baixa já gerada por esta linha e ainda ativa (ex.: conciliação desfeita sem estorno): reaproveita só se for da mesma parcela
  const { key, existing } = await bankTxSettlementKey(ctx, tx.id);
  if (existing && existing.installmentId !== inst.id) {
    const other = await ctx.store.get("installments", existing.installmentId);
    throw new BusinessError(
      `Esta linha já gerou a baixa da parcela ${other ? `${other.number} (${other.description})` : "anterior"}, ainda ativa. Estorne essa baixa no título ou concilie a linha manualmente com ela.`,
      "bank_tx_settled",
    );
  }
  const reused = Boolean(existing);
  const settlement = existing ?? (await settleInstallment(ctx, {
    installmentId: inst.id, date: tx.date, principal: input.principal, interest, fine, discount, fee, accountId: tx.accountId, methodId: input.methodId ?? null,
    methodKind: input.methodKind ?? (tx.kind === "collection" ? "boleto" : null), reference: tx.docNumber || tx.ourNumber || tx.externalId || null,
    notes: `Baixa a partir de ${tx.kind === "collection" ? `retorno de cobrança (${tx.cnabOccurrenceText ?? tx.cnabOccurrence})` : "extrato"} — linha ${tx.lineNo ?? "?"}`, idemKey: key,
  }));
  assert(settlement.status === "active" && settlement.installmentId === inst.id, "A baixa desta linha não está ativa para a parcela escolhida. Atualize a tela e tente novamente.", "settlement_mismatch");
  if (tx.settlementId !== settlement.id || tx.installmentId !== inst.id) await ctx.store.update("bank_transactions", tx.id, { settlementId: settlement.id, installmentId: inst.id });
  const entryIds = [settlement.accountEntryId, ...((settlement.fee ?? 0) > 0 ? [settlementFeeEntryId(settlement)] : [])];
  const reconciliation = await reconcile(ctx, { accountId: tx.accountId, bankTxIds: [tx.id], entryIds, kind: tx.kind === "collection" ? "collection" : "settlement", idemKey: await bankTxReconcileKey(ctx, tx.id), notes: `Baixa da parcela ${inst.number} (${inst.description})` });
  assert(reconciliation.status === "active" && (reconciliation.bankTxIds ?? []).includes(tx.id), "A conciliação da linha não foi registrada. Atualize a tela e tente novamente.", "reconcile_mismatch");
  return { settlement, reconciliation, reused, installmentNumber: inst.number };
}

// ───────────────────────────── Consultas da tela

/** Linhas do extrato + lançamentos do ERP do período, com sugestões. */
export async function reconciliationWorkspace(ctx: Ctx, accountId: string, from: string, to: string) {
  const acc = await loadAccount(ctx, accountId);
  const windowDays = await reconcileWindowDays(ctx.store, ctx.companyId);
  const bankTxs = await listAll(ctx.store, "bank_transactions", { filters: [["eq", "accountId", acc.id], ["between", "date", from, to]], orderBy: [{ field: "date", dir: "asc" }] });
  const entries = await listAll(ctx.store, "account_entries", { filters: [["eq", "accountId", acc.id], ["between", "date", addDays(from, -windowDays), addDays(to, windowDays)]], orderBy: [{ field: "date", dir: "asc" }] });
  const visibleEntries = entries.filter((e) => e.kind !== "initial");
  // referências de baixas (documento/referência) para casar por documento
  const refs = new Map<string, string>();
  const settleIds = visibleEntries.map((e) => e.settlementId).filter(Boolean) as string[];
  for (let i = 0; i < settleIds.length; i += 100) {
    for (const s of await listAll(ctx.store, "settlements", { filters: [["eq", "id", settleIds.slice(i, i + 100)]] })) {
      const e = visibleEntries.find((x) => x.settlementId === s.id && x.id === s.accountEntryId);
      if (e) refs.set(e.id, `${s.reference ?? ""}`);
    }
  }
  const suggestions = suggestMatches(bankTxs.filter((b) => b.kind !== "collection"), visibleEntries, { windowDays, refs });
  // retornos de cobrança: parcela sugerida (nosso/seu número)
  const instIds = [...new Set(bankTxs.map((b) => b.installmentId).filter(Boolean) as string[])];
  const insts = instIds.length ? await listAll(ctx.store, "installments", { filters: [["eq", "id", instIds]] }) : [];
  return { account: acc, bankTxs, entries: visibleEntries, suggestions, installments: new Map(insts.map((i) => [i.id, i])), windowDays };
}

/** Saldo informado no último extrato importado × saldo do ERP na mesma data. */
export async function lastStatementBalance(store: Store, accountId: string) {
  const imps = await store.list("bank_imports", { filters: [["eq", "accountId", accountId], ["eq", "status", "completed"]], orderBy: [{ field: "createdAt", dir: "desc" }], limit: 20, total: false });
  for (const i of imps.items) {
    const b = i.summary?.balance;
    if (b && typeof b.amount === "number") return { amount: b.amount as number, date: (b.date as string | null) ?? i.summary?.period?.to ?? null, importId: i.id, fileName: i.fileName };
  }
  return null;
}

export const BANK_TX_KIND_LABEL: Record<string, string> = { statement: "Extrato", collection: "Liquidação de cobrança", collection_fee: "Tarifa de cobrança" };

export function describeImportStatus(s: string) {
  return s === "completed" ? "Concluída" : s === "processing" ? "Em processamento" : s;
}
