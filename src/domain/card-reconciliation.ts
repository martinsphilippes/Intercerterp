import { detId, isConflict, listAll, sha256 } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { addDays, diffDays, formatDate, today } from "@/lib/dates";
import { formatMoney, roundDiv } from "@/lib/money";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireBranch, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { getSetting, setSetting } from "@/lib/core/settings";
import { assertUsableAccount, cardFeeByInstallment, settleInstallment } from "./finance";
import { normalizeBrand } from "./card-fees";
import { normalizeNsu, parseAcquirerCsv, sniffAcquirerCsv, type AcquirerLayout, type AcquirerLine, type AcquirerSniff } from "./bank/acquirer";
import { decodeBankFile, type LineIssue } from "./bank/common";

/**
 * FIN-24 — Conciliação dos recebíveis de cartão com o arquivo da adquirente.
 *
 *  - Casamento de cada linha do arquivo com a parcela do recebível (`titles.originType = "sale_card"`):
 *    1) pelo NSU (ou autorização) gravado no pagamento da venda + nº da parcela ("2/3"); sem nº, a parcela em aberto
 *       cujo saldo é o bruto da linha (a de vencimento mais próximo do crédito);
 *    2) sem NSU correspondente: pelo valor bruto + data da venda (+ bandeira e parcela quando informadas) — só quando
 *       houver um único candidato (vários = "ambíguo", nada é baixado).
 *  - Casada = parcela em aberto com saldo igual ao bruto. A baixa usa a liquidação de cartão de sempre
 *    (`settleInstallment`: bruto, TAXA DO ARQUIVO como lançamento de despesa separado, líquido na conta, data de crédito).
 *    Diferenças de taxa, de data prevista ou de bandeira são baixadas e listadas no relatório de divergências.
 *  - Não baixa: bruto diferente do saldo (divergente), recebível já liquidado, cancelado, crédito futuro, linha
 *    repetida, sem correspondência, ambígua ou inválida — tudo vai para o relatório.
 *  - Idempotência: identidade do arquivo = conteúdo (SHA-256) + conta (`bank_imports.scopeKey`, kind "acquirer");
 *    cada baixa tem chave `acq:<importação>:<parcela>` — reaplicar o arquivo não duplica, uma retentativa após falha
 *    conclui o que faltou e outro arquivo com a mesma venda encontra a parcela "já liquidada".
 */

export type AcquirerStatus = "matched" | "applied" | "already_settled" | "divergent" | "not_found" | "ambiguous" | "future" | "duplicate" | "invalid" | "error";

export const ACQUIRER_STATUS_LABEL: Record<AcquirerStatus, string> = {
  matched: "Casada (a baixar)",
  applied: "Baixada",
  already_settled: "Já liquidada",
  divergent: "Divergente",
  not_found: "Sem correspondência",
  ambiguous: "Ambígua",
  future: "Crédito futuro",
  duplicate: "Repetida no arquivo",
  invalid: "Inválida",
  error: "Erro na baixa",
};

export const ACQUIRER_STATUS_TONE: Record<AcquirerStatus, "good" | "warn" | "bad" | "info" | "neutral"> = {
  matched: "info", applied: "good", already_settled: "neutral", divergent: "bad", not_found: "warn", ambiguous: "warn", future: "neutral", duplicate: "warn", invalid: "bad", error: "bad",
};

/** Situações que entram no relatório de divergências (além das casadas com diferença de taxa/data/bandeira). */
export const DIVERGENT_STATUSES: AcquirerStatus[] = ["divergent", "not_found", "ambiguous", "duplicate", "invalid", "error"];

export interface AcquirerMatch {
  lineNo: number;
  status: AcquirerStatus;
  message: string;
  matchedBy: "nsu" | "auth" | "value_date" | null;
  nsu: string | null;
  authCode: string | null;
  brand: string | null;
  installmentLabel: string | null;
  saleDate: string | null;
  creditDate: string | null;
  gross: number;
  fee: number;
  net: number;
  installmentId: string | null;
  titleId: string | null;
  titleNumber: number | null;
  saleId: string | null;
  saleNumber: number | null;
  expectedGross: number | null;
  expectedFee: number | null;
  expectedDate: string | null;
  /** taxa do arquivo − taxa prevista (positivo = adquirente cobrou mais) */
  feeDiff: number | null;
  /** crédito − previsão, em dias */
  dateDiff: number | null;
  flags: string[];
  settlementId?: string | null;
}

export interface AcquirerSummary {
  lines: number;
  byStatus: Partial<Record<AcquirerStatus, number>>;
  gross: number;
  fee: number;
  net: number;
  /** linhas casadas/baixadas */
  matchedGross: number;
  matchedFee: number;
  expectedFee: number;
  feeDiff: number;
  withFlags: number;
}

const LAYOUT_KEY = "finance.acquirerLayout";
/** Arquivo de exemplo da adquirente (demonstração): id em `files`. */
export const ACQUIRER_SAMPLE_KEY = "finance.acquirerSampleFileId";
export const MAX_ACQUIRER_LINES = 3000;
export const acquirerScopeKey = (companyId: string, accountId: string, hash: string) => `acquirer:${companyId}:${accountId}:${hash}`;
export const acquirerImportId = (scopeKey: string) => detId("bankimport", scopeKey);
export const acquirerSettleKey = (importId: string, installmentId: string) => `acq:${importId}:${installmentId}`;

/** Layout salvo da empresa (último usado) ou o sugerido pelos nomes das colunas. */
export async function acquirerLayoutFor(ctx: Ctx, sniff: AcquirerSniff | null): Promise<AcquirerLayout | null> {
  const saved = await getSetting<AcquirerLayout | null>(ctx.store, ctx.companyId, null, LAYOUT_KEY, null);
  if (saved && sniff && saved.delimiter === sniff.delimiter && (!sniff.header || saved.hasHeader === Boolean(sniff.header))) return saved;
  return sniff?.guess ?? saved;
}

interface Candidates {
  titles: Map<string, Doc>;
  insts: Map<string, Doc[]>;
  pays: Map<string, Doc>;
  sales: Map<string, Doc>;
  fees: Map<string, number>;
  byNsu: Map<string, string[]>;
  byAuth: Map<string, string[]>;
}

async function loadCandidates(ctx: Ctx, lines: AcquirerLine[]): Promise<Candidates> {
  const dates = lines.flatMap((l) => [l.saleDate, l.creditDate]).filter(Boolean).sort() as string[];
  const since = addDays(dates[0] ?? today(), -400);
  const titles = (await listAll(ctx.store, "titles", { filters: [["eq", "companyId", ctx.companyId], ["eq", "originType", "sale_card"], ["gte", "issueDate", since]] })).filter((t) => t.status !== "cancelled");
  const ids = titles.map((t) => t.id);
  const insts = new Map<string, Doc[]>();
  const pays = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (const x of await listAll(ctx.store, "installments", { filters: [["eq", "titleId", chunk]] })) insts.set(x.titleId, [...(insts.get(x.titleId) ?? []), x]);
    for (const p of await listAll(ctx.store, "sale_payments", { filters: [["eq", "titleId", chunk]] })) pays.set(p.titleId, p);
  }
  for (const list of insts.values()) list.sort((a, b) => a.number - b.number);
  const saleIds = [...new Set(titles.map((t) => t.originId).filter(Boolean))] as string[];
  const sales = new Map<string, Doc>();
  for (let i = 0; i < saleIds.length; i += 100) for (const s of await listAll(ctx.store, "sales", { filters: [["eq", "id", saleIds.slice(i, i + 100)]] })) sales.set(s.id, s);
  const fees = await cardFeeByInstallment(ctx.store, titles);
  const byNsu = new Map<string, string[]>();
  const byAuth = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, id: string) => k && m.set(k, [...(m.get(k) ?? []), id]);
  for (const t of titles) {
    const p = pays.get(t.id);
    push(byNsu, normalizeNsu(p?.nsu ?? t.documentNumber), t.id);
    push(byAuth, normalizeNsu(p?.authCode), t.id);
  }
  return { titles: new Map(titles.map((t) => [t.id, t])), insts, pays, sales, fees, byNsu, byAuth };
}

const openFee = (fee: number, inst: Doc) => roundDiv(fee * (inst.balance ?? 0), Math.max(1, inst.amount ?? 0));

/** Parcela do título correspondente à linha (nº informado, única, ou a em aberto com saldo = bruto). */
function pickInstallment(list: Doc[], l: AcquirerLine): Doc | null {
  if (!list.length) return null;
  if (l.installment) return list.find((i) => i.number === l.installment) ?? null;
  if (list.length === 1) return list[0];
  const near = (a: Doc, b: Doc) => Math.abs(diffDays(a.dueDate, l.creditDate)) - Math.abs(diffDays(b.dueDate, l.creditDate)) || a.number - b.number;
  const open = list.filter((i) => ["open", "partial"].includes(i.status) && i.balance === l.gross).sort(near);
  if (open.length) return open[0];
  return list.filter((i) => i.amount === l.gross).sort(near)[0] ?? null;
}

/**
 * Prévia do casamento (sem gravar). `importId` (opcional) reconhece as baixas já feitas por este mesmo arquivo
 * (retentativa) como "baixada".
 */
export async function matchAcquirerLines(ctx: Ctx, lines: AcquirerLine[], importId?: string | null): Promise<AcquirerMatch[]> {
  const c = await loadCandidates(ctx, lines);
  const claimed = new Set<string>();
  const t0 = today();
  const out: AcquirerMatch[] = [];
  for (const l of lines) {
    const base: AcquirerMatch = {
      lineNo: l.lineNo, status: "not_found", message: "", matchedBy: null, nsu: l.nsu, authCode: l.authCode, brand: l.brand,
      installmentLabel: l.installment && l.installments ? `${l.installment}/${l.installments}` : l.installments ? `${l.installments}x` : null,
      saleDate: l.saleDate, creditDate: l.creditDate, gross: l.gross, fee: l.fee, net: l.net, installmentId: null, titleId: null, titleNumber: null, saleId: null, saleNumber: null,
      expectedGross: null, expectedFee: null, expectedDate: null, feeDiff: null, dateDiff: null, flags: [],
    };
    // 1) NSU / autorização
    let titleIds = c.byNsu.get(normalizeNsu(l.nsu)) ?? [];
    let by: AcquirerMatch["matchedBy"] = titleIds.length ? "nsu" : null;
    if (!titleIds.length && l.authCode) {
      titleIds = c.byAuth.get(normalizeNsu(l.authCode)) ?? [];
      by = titleIds.length ? "auth" : null;
    }
    // vários títulos com o mesmo NSU (outra máquina/dia): restringe pela data da venda e pelo valor
    if (titleIds.length > 1) {
      const narrowed = titleIds.filter((id) => {
        const t = c.titles.get(id)!;
        return (!l.saleDate || t.issueDate === l.saleDate) && (c.insts.get(id) ?? []).some((i) => i.amount === l.gross || i.balance === l.gross);
      });
      if (narrowed.length) titleIds = narrowed;
    }
    let inst: Doc | null = null;
    if (titleIds.length === 1) inst = pickInstallment(c.insts.get(titleIds[0]) ?? [], l);
    else if (titleIds.length > 1) {
      out.push({ ...base, status: "ambiguous", matchedBy: by, message: `NSU/autorização encontrado em ${titleIds.length} recebíveis diferentes — confira e liquide manualmente.` });
      continue;
    }
    // 2) valor + data da venda (+ bandeira/parcela)
    if (!inst && !titleIds.length) {
      const cands: Doc[] = [];
      for (const [tid, list] of c.insts) {
        const t = c.titles.get(tid)!;
        const pay = c.pays.get(tid);
        if (l.saleDate && t.issueDate !== l.saleDate) continue;
        if (l.brand && pay?.cardBrand && normalizeBrand(pay.cardBrand) !== normalizeBrand(l.brand)) continue;
        if (l.installments && (t.installmentsCount ?? 1) !== l.installments) continue;
        for (const i of list) {
          if (!["open", "partial"].includes(i.status) || i.balance !== l.gross) continue;
          if (l.installment && i.number !== l.installment) continue;
          if (!l.saleDate && Math.abs(diffDays(i.dueDate, l.creditDate)) > 5) continue;
          if (claimed.has(i.id)) continue;
          cands.push(i);
        }
      }
      if (cands.length === 1) {
        inst = cands[0];
        by = "value_date";
      } else if (cands.length > 1) {
        out.push({ ...base, status: "ambiguous", message: `${cands.length} recebíveis em aberto com o mesmo valor e data — informe o NSU no arquivo ou liquide manualmente.` });
        continue;
      }
    }
    if (!inst) {
      out.push({ ...base, status: titleIds.length ? "divergent" : "not_found", matchedBy: by, message: titleIds.length ? `Recebível do NSU encontrado, mas sem a parcela ${base.installmentLabel ?? ""} de ${formatMoney(l.gross)}.` : "Nenhum recebível de cartão corresponde a esta linha (NSU, autorização ou valor e data da venda)." });
      continue;
    }
    const t = c.titles.get(inst.titleId)!;
    const pay = c.pays.get(t.id);
    const sale = t.originId ? c.sales.get(t.originId) : null;
    const fullFee = c.fees.get(inst.id) ?? 0;
    const expFee = ["open", "partial"].includes(inst.status) ? openFee(fullFee, inst) : fullFee;
    const m: AcquirerMatch = {
      ...base, matchedBy: by, installmentId: inst.id, titleId: t.id, titleNumber: t.number ?? null, saleId: t.originId ?? null, saleNumber: sale?.number ?? null,
      installmentLabel: base.installmentLabel ?? `${inst.number}/${t.installmentsCount ?? 1}`, expectedGross: inst.balance, expectedFee: expFee, expectedDate: inst.dueDate,
      feeDiff: l.fee - expFee, dateDiff: diffDays(inst.dueDate, l.creditDate),
    };
    if (m.feeDiff) m.flags.push(`taxa ${m.feeDiff > 0 ? "maior" : "menor"} que a prevista (${formatMoney(l.fee)} × ${formatMoney(expFee)})`);
    if (m.dateDiff) m.flags.push(`crédito ${m.dateDiff > 0 ? `${m.dateDiff} dia(s) depois` : `${-m.dateDiff} dia(s) antes`} da previsão (${formatDate(inst.dueDate)})`);
    if (l.brand && pay?.cardBrand && normalizeBrand(l.brand) !== normalizeBrand(pay.cardBrand)) m.flags.push(`bandeira do arquivo (${l.brand}) diferente da venda (${pay.cardBrand})`);
    if (l.installments && (t.installmentsCount ?? 1) !== l.installments) m.flags.push(`venda em ${t.installmentsCount ?? 1}x no sistema e ${l.installments}x no arquivo`);
    const doneByThis = importId ? await ctx.store.get("settlements", detId("settle", acquirerSettleKey(importId, inst.id))) : null;
    if (claimed.has(inst.id)) {
      out.push({ ...m, status: "duplicate", message: "Outra linha deste arquivo já corresponde a esta parcela." });
      continue;
    }
    claimed.add(inst.id);
    if (doneByThis && doneByThis.status === "active") out.push({ ...m, status: "applied", settlementId: doneByThis.id, message: "Baixada por este arquivo." });
    else if (inst.status === "paid") out.push({ ...m, status: "already_settled", message: `Parcela já liquidada${inst.lastSettlementAt ? ` em ${formatDate(inst.lastSettlementAt)}` : ""} — nada a baixar.` });
    else if (!["open", "partial"].includes(inst.status)) out.push({ ...m, status: "divergent", message: `Parcela ${inst.status === "cancelled" ? "cancelada" : "renegociada"} no sistema.` });
    else if (inst.balance !== l.gross) out.push({ ...m, status: "divergent", message: `Bruto do arquivo ${formatMoney(l.gross)} diferente do saldo do recebível ${formatMoney(inst.balance)}.` });
    else if (l.creditDate > t0) out.push({ ...m, status: "future", message: `Crédito previsto para ${formatDate(l.creditDate)} — baixe a partir dessa data (reimporte o arquivo).` });
    else out.push({ ...m, status: "matched", message: m.flags.length ? `Casada com diferença: ${m.flags.join("; ")}.` : "Casada: bruto, taxa e data conferem." });
  }
  return out;
}

export function summarizeAcquirer(matches: AcquirerMatch[], issues: LineIssue[] = []): AcquirerSummary {
  const byStatus: Partial<Record<AcquirerStatus, number>> = {};
  for (const m of matches) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  const inv = issues.filter((i) => i.status === "invalid").length;
  if (inv) byStatus.invalid = (byStatus.invalid ?? 0) + inv;
  const ok = matches.filter((m) => m.status === "matched" || m.status === "applied");
  return {
    lines: matches.length + inv,
    byStatus,
    gross: matches.reduce((a, m) => a + m.gross, 0),
    fee: matches.reduce((a, m) => a + m.fee, 0),
    net: matches.reduce((a, m) => a + m.net, 0),
    matchedGross: ok.reduce((a, m) => a + m.gross, 0),
    matchedFee: ok.reduce((a, m) => a + m.fee, 0),
    expectedFee: ok.reduce((a, m) => a + (m.expectedFee ?? 0), 0),
    feeDiff: ok.reduce((a, m) => a + (m.feeDiff ?? 0), 0),
    withFlags: matches.filter((m) => m.flags.length).length,
  };
}

export interface AcquirerInput {
  accountId: string;
  fileName: string;
  data: Buffer;
  mime?: string | null;
  layout?: AcquirerLayout | null;
}

function parseInput(input: AcquirerInput, layout: AcquirerLayout | null) {
  if (!layout) throw new BusinessError("Não foi possível identificar as colunas do arquivo: informe o layout.", "invalid_layout");
  const parsed = parseAcquirerCsv(input.data, layout);
  if (parsed.fatal) throw new BusinessError(`Arquivo não lido: ${parsed.fatal}`, "invalid_file");
  assert(parsed.lines.length + parsed.issues.length <= MAX_ACQUIRER_LINES, `O arquivo tem mais de ${MAX_ACQUIRER_LINES} linhas: divida-o por período.`);
  return parsed;
}

/** Prévia: colunas sugeridas, linhas lidas, casamento e totais (nada é gravado). */
export async function previewAcquirerFile(ctx: Ctx, input: AcquirerInput) {
  const acc = await assertUsableAccount(ctx, input.accountId);
  const sniff = sniffAcquirerCsv(decodeBankFile(input.data));
  const layout = input.layout ?? (await acquirerLayoutFor(ctx, sniff));
  const parsed = parseInput(input, layout);
  const hash = sha256(input.data);
  const id = acquirerImportId(acquirerScopeKey(ctx.companyId, acc.id, hash));
  const imp = await ctx.store.get("bank_imports", id);
  const matches = await matchAcquirerLines(ctx, parsed.lines, id);
  return {
    sniff, layout: layout!, matches, issues: parsed.issues, summary: summarizeAcquirer(matches, parsed.issues),
    alreadyImported: imp?.status === "completed" ? { id: imp.id, createdAt: imp.createdAt as string } : null,
  };
}

/**
 * Aplica o arquivo: baixa as linhas casadas (bruto, taxa do arquivo, data de crédito, na conta escolhida) e grava o
 * relatório (bank_imports kind "acquirer"). Idempotente pelo conteúdo + conta.
 */
export async function applyAcquirerFile(ctx: Ctx, input: AcquirerInput) {
  requireBranch(ctx);
  const acc = await assertUsableAccount(ctx, input.accountId);
  const sniff = sniffAcquirerCsv(decodeBankFile(input.data));
  const layout = input.layout ?? (await acquirerLayoutFor(ctx, sniff));
  const parsed = parseInput(input, layout);
  const hash = sha256(input.data);
  const scopeKey = acquirerScopeKey(ctx.companyId, acc.id, hash);
  const id = acquirerImportId(scopeKey);
  let imp = await ctx.store.get("bank_imports", id);
  if (imp?.status === "completed") return { import: imp, alreadyImported: true as const };
  if (!imp) {
    const file = await saveFile(ctx, { bucket: "attachments", name: input.fileName, mime: input.mime || "text/csv", data: input.data, entityType: "bank_import", entityId: id, kind: "acquirer_file", branchId: acc.branchId ?? ctx.branchId });
    try {
      imp = await ctx.store.create(
        "bank_imports",
        {
          companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, accountId: acc.id, format: "acquirer_csv", fileName: input.fileName, fileId: file.id, fileHash: hash,
          bankCode: null, layoutVersion: "CSV da adquirente", kind: "acquirer", status: "processing", summary: {}, lineResults: [], scopeKey,
        },
        id,
      );
    } catch (e) {
      if (!isConflict(e)) throw e;
      imp = await ctx.store.getOrThrow("bank_imports", id);
      if (imp.status === "completed") return { import: imp, alreadyImported: true as const };
    }
  }
  const matches = await matchAcquirerLines(ctx, parsed.lines, id);
  for (const m of matches) {
    if (m.status !== "matched") continue;
    try {
      const st = await settleInstallment(ctx, {
        installmentId: m.installmentId!, date: m.creditDate!, principal: m.gross, fee: m.fee, accountId: acc.id, methodKind: "card_settlement",
        reference: `Adquirente: ${input.fileName} · NSU ${m.nsu ?? "—"}`.slice(0, 120), notes: (m.flags.length ? `Conciliação com a adquirente — ${m.flags.join("; ")}` : "Conciliação com o arquivo da adquirente").slice(0, 400),
        idemKey: acquirerSettleKey(id, m.installmentId!),
      });
      Object.assign(m, { status: "applied", settlementId: st.id, message: m.flags.length ? `Baixada com diferença: ${m.flags.join("; ")}.` : "Baixada: bruto, taxa e data conferem." });
    } catch (e: any) {
      if (!(e instanceof BusinessError)) throw e;
      Object.assign(m, { status: "error", message: `Não baixada: ${e.message}` });
    }
  }
  const summary = { kind: "acquirer", fileName: input.fileName, totalLines: parsed.totalLines, ...summarizeAcquirer(matches, parsed.issues) };
  const lineResults = [
    ...matches,
    ...parsed.issues.map((i) => ({ lineNo: i.lineNo, status: i.status === "invalid" ? "invalid" : "info", message: i.message + (i.raw ? ` [${i.raw.slice(0, 80)}]` : ""), gross: 0, fee: 0, net: 0, flags: [] })),
  ].sort((a, b) => a.lineNo - b.lineNo);
  const done = await ctx.store.update("bank_imports", id, { status: "completed", summary, lineResults: lineResults.slice(0, MAX_ACQUIRER_LINES) });
  await setSetting(ctx.store, ctx.companyId, null, LAYOUT_KEY, layout, ctx.user.id);
  const n = (k: AcquirerStatus) => summary.byStatus[k] ?? 0;
  await audit(ctx, {
    module: "finance", action: "card.acquirer_import", entityType: "bank_import", entityId: id,
    summary: `Arquivo da adquirente "${input.fileName}" em ${acc.name}: ${n("applied")} baixada(s) (bruto ${formatMoney(summary.matchedGross)}, taxas ${formatMoney(summary.matchedFee)}), ${n("divergent") + n("not_found") + n("ambiguous") + n("duplicate") + n("invalid") + n("error")} com divergência`,
    after: summary, related: [`financial_account:${acc.id}`],
  });
  return { import: done, alreadyImported: false as const };
}

/** Importações de arquivos de adquirente da empresa (mais recentes primeiro). */
export async function listAcquirerImports(ctx: Ctx) {
  return (await listAll(ctx.store, "bank_imports", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "acquirer"]], orderBy: [{ field: "createdAt", dir: "desc" }] })).filter((i) => i.kind === "acquirer");
}
