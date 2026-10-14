import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { diffDays, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { assert } from "@/lib/core/errors";
import { requireAction, requireBranch, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { resolveOccurrence } from "@/lib/core/notify";
import { assertUsableAccount, lateChargeParams, refreshTitleStatus, settleInstallment, suggestLateCharges, type LateChargeParams, type TitleKind } from "./finance";
import { MAX_TX_OPS, runIdempotentBatches } from "./price-adjust";

/**
 * Baixa em lote (FIN-02): várias parcelas em aberto, a receber OU a pagar, quitadas de uma vez pelo saldo integral.
 *
 *  - Prévia sem gravação: saldo, multa e juros sugeridos (mesma fórmula de `suggestLateCharges`, §13) e total por parcela;
 *    parcelas que não podem ser baixadas aparecem com o motivo e ficam fora da aplicação.
 *  - Aplicação reutiliza `finance.settleInstallment` (mesma baixa da tela do título: lançamento em conta, sequência da
 *    parcela, saldo do título) dentro de transações de até `SETTLE_ITEMS_PER_TX` parcelas (≤ 100 escritas no Appwrite),
 *    pelo motor `runIdempotentBatches` (marcador do lote na mesma transação; lote com parcela recusada é refeito parcela a
 *    parcela). Cada baixa é atômica — nunca fica lançamento sem baixa ou baixa sem saldo atualizado.
 *  - Idempotente pela chave do envio + parcela (`lot:<chave>:<parcela>`): reenviar não baixa duas vezes.
 *  - Contas a pagar seguem a regra vigente: só obrigações autorizadas são pagas.
 */

/** Escritas por parcela numa transação: lançamento + saldo/sequência da conta + baixa + parcela + saldo do título. */
export const SETTLE_OPS_PER_ITEM = 5;
/** Parcelas por transação: (100 − 1 marcador) ÷ 5. */
export const SETTLE_ITEMS_PER_TX = Math.floor((MAX_TX_OPS - 1) / SETTLE_OPS_PER_ITEM);
/** Máximo de parcelas por envio. */
export const MAX_BATCH_ITEMS = 300;

export interface BatchSettleLine {
  installmentId: string;
  titleId: string | null;
  titleNumber: number | null;
  number: number | null;
  count: number | null;
  partyName: string | null;
  description: string | null;
  dueDate: string | null;
  daysLate: number;
  balance: number;
  principal: number;
  fine: number;
  interest: number;
  total: number;
  status: "ok" | "error";
  message: string | null;
}

export interface BatchSettleTotals {
  count: number;
  ok: number;
  errors: number;
  principal: number;
  fine: number;
  interest: number;
  total: number;
}

export interface BatchPreviewInput {
  kind: TitleKind;
  installmentIds: string[];
  date: string;
  applyLateCharges: boolean;
}

export interface BatchSettleInput extends BatchPreviewInput {
  accountId: string;
  methodId: string;
  reference?: string | null;
  notes?: string | null;
  idemKey: string;
}

export interface BatchResultLine extends Omit<BatchSettleLine, "status"> {
  status: "settled" | "error";
  settlementId: string | null;
}

export interface BatchSettleResult {
  jobId: string;
  replayed: boolean;
  kind: TitleKind;
  date: string;
  settled: number;
  errors: number;
  /** valor movimentado na conta (principal + multa + juros) das parcelas baixadas */
  total: number;
  lines: BatchResultLine[];
}

const KIND_WORD = { receivable: "Recebimento", payable: "Pagamento" } as const;

function uniqueIds(ids: string[]) {
  return [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))];
}

function assertDate(date: string) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date ?? ""), "Informe uma data válida.");
  assert(date <= today(), "A data da baixa não pode ser futura.");
}

async function loadByIds(store: Store, collection: string, ids: string[]) {
  const out = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 100) {
    for (const d of await listAll(store, collection, { filters: [["eq", "id", ids.slice(i, i + 100)]] })) out.set(d.id, d);
  }
  return out;
}

/** Motivo pelo qual a parcela não entra na baixa em lote (null = pode ser baixada). Mesmas regras de `settleInstallment`. */
export function batchBlockReason(kind: TitleKind, inst: Doc | null | undefined, title: Doc | null | undefined, companyId: string): string | null {
  if (!inst || !title || inst.companyId !== companyId || title.companyId !== companyId) return "Parcela não encontrada nesta empresa.";
  if (inst.kind !== kind || title.kind !== kind) return kind === "receivable" ? "A parcela não é de contas a receber." : "A parcela não é de contas a pagar.";
  if (title.status === "cancelled" || inst.status === "cancelled") return "Título ou parcela cancelado.";
  if (inst.status === "renegotiated") return "Parcela renegociada: baixe pelo título da renegociação.";
  if (inst.status === "paid" || !(inst.balance > 0)) return kind === "receivable" ? "Parcela já recebida." : "Parcela já paga.";
  if (title.originType === "sale_card") return "Recebível de cartão: liquide em Financeiro → Cartões (com a taxa da adquirente).";
  if (kind === "payable" && title.approvalStatus === "pending") return "Conta a pagar ainda não autorizada: autorize a obrigação antes do pagamento.";
  return null;
}

function buildLines(ctx: Ctx, input: BatchPreviewInput, ids: string[], insts: Map<string, Doc>, titles: Map<string, Doc>, late: LateChargeParams): BatchSettleLine[] {
  return ids.map((id) => {
    const inst = insts.get(id) ?? null;
    const title = inst ? (titles.get(inst.titleId) ?? null) : null;
    const reason = batchBlockReason(input.kind, inst, title, ctx.companyId);
    const balance = inst && reason == null ? inst.balance : (inst?.balance ?? 0);
    const charges = reason == null && input.applyLateCharges && inst ? suggestLateCharges(inst.dueDate, input.date, balance, late) : { daysLate: inst?.dueDate ? Math.max(0, diffDays(inst.dueDate, input.date)) : 0, fine: 0, interest: 0 };
    const visible = inst && inst.companyId === ctx.companyId;
    return {
      installmentId: id,
      titleId: visible ? inst.titleId : null,
      titleNumber: visible ? (title?.number ?? null) : null,
      number: visible ? inst.number : null,
      count: visible ? (title?.installmentsCount ?? null) : null,
      partyName: visible ? (title?.partyName ?? inst.partyName ?? null) : null,
      description: visible ? (title?.description ?? null) : null,
      dueDate: visible ? inst.dueDate : null,
      daysLate: charges.daysLate,
      balance: visible ? balance : 0,
      principal: reason == null ? balance : 0,
      fine: reason == null ? charges.fine : 0,
      interest: reason == null ? charges.interest : 0,
      total: reason == null ? balance + charges.fine + charges.interest : 0,
      status: reason == null ? "ok" : "error",
      message: reason,
    };
  });
}

export function batchTotals(lines: Array<Pick<BatchSettleLine, "principal" | "fine" | "interest" | "total"> & { status: string }>): BatchSettleTotals {
  const ok = lines.filter((l) => l.status === "ok" || l.status === "settled");
  return {
    count: lines.length,
    ok: ok.length,
    errors: lines.length - ok.length,
    principal: ok.reduce((a, l) => a + l.principal, 0),
    fine: ok.reduce((a, l) => a + l.fine, 0),
    interest: ok.reduce((a, l) => a + l.interest, 0),
    total: ok.reduce((a, l) => a + l.total, 0),
  };
}

function requireSettle(ctx: Ctx) {
  requirePerm(ctx, "finance", "edit");
  requireAction(ctx, "finance.settle");
}

/** Prévia da baixa em lote (nada é gravado): total por parcela e motivo das que não podem ser baixadas. */
export async function previewBatchSettlement(ctx: Ctx, input: BatchPreviewInput) {
  requireSettle(ctx);
  assertDate(input.date);
  const ids = uniqueIds(input.installmentIds);
  assert(ids.length > 0, "Selecione ao menos uma parcela.");
  assert(ids.length <= MAX_BATCH_ITEMS, `Selecione no máximo ${MAX_BATCH_ITEMS} parcelas por vez.`);
  const insts = await loadByIds(ctx.store, "installments", ids);
  const titles = await loadByIds(ctx.store, "titles", [...new Set([...insts.values()].map((i) => i.titleId))]);
  const late = await lateChargeParams(ctx.store, ctx.companyId, ctx.branchId);
  const lines = buildLines(ctx, input, ids, insts, titles, late);
  return { lines, totals: batchTotals(lines), late };
}

/** Chave da baixa de uma parcela dentro do envio (idempotência por envio + parcela). */
export const batchSettleKey = (idemKey: string, installmentId: string) => `lot:${idemKey}:${installmentId}`;

/**
 * Baixa em lote pelo saldo integral de cada parcela, com multa/juros sugeridos (opcional). Exige "Baixar títulos" e
 * filial definida. Parcelas recusadas (na prévia ou por mudança concorrente) não impedem as demais; o resultado lista
 * o que foi baixado e o que falhou com o motivo. Repetir o envio (mesma chave) devolve o mesmo resultado.
 */
export async function settleBatch(ctx: Ctx, input: BatchSettleInput): Promise<BatchSettleResult> {
  requireSettle(ctx);
  requireBranch(ctx);
  assert(input.idemKey, "Chave de idempotência ausente.");
  assert(input.kind === "receivable" || input.kind === "payable", "Tipo de título inválido.");
  const jobId = detId("settlelot", ctx.companyId, input.idemKey);
  const job = await ctx.store.get("operations", jobId);
  if (job?.status === "done" && job.result?.summary) return { ...(job.result.summary as BatchSettleResult), replayed: true };

  assertDate(input.date);
  const account = await assertUsableAccount(ctx, input.accountId);
  const method = input.methodId ? await ctx.store.get("payment_methods", input.methodId) : null;
  assert(method && method.companyId === ctx.companyId && method.active !== false, `Selecione a forma de ${input.kind === "receivable" ? "recebimento" : "pagamento"}.`);
  assert(!["store_credit", "crediario"].includes(method.kind), "Forma de pagamento inválida para baixa de título.");

  const preview = await previewBatchSettlement(ctx, input);
  if (!job) {
    await ctx.store
      .create("operations", { companyId: ctx.companyId, type: "finance.settle_batch", status: "running", entityType: "settlement_batch", entityId: null, result: { kind: input.kind, startedAt: nowIso() }, createdBy: ctx.user.id }, jobId)
      .catch((e) => {
        if (!isConflict(e)) throw e;
      });
  }

  const notes = ["Baixa em lote", input.notes?.trim()].filter(Boolean).join(" — ").slice(0, 400);
  const todo = preview.lines.filter((l) => l.status === "ok").map((l) => ({ key: l.installmentId, line: l }));
  // sequência das contas compartilhada pelas baixas da MESMA transação: o motor cria um contexto por tentativa de
  // transação (o objeto do store pode ser o mesmo entre tentativas — memória/imediato), então a chave é o contexto
  const caches = new WeakMap<Ctx, Map<string, Doc>>();
  const cacheFor = (txCtx: Ctx) => {
    let c = caches.get(txCtx);
    if (!c) caches.set(txCtx, (c = new Map()));
    return c;
  };
  const outcomes = await runIdempotentBatches(ctx, {
    jobId,
    type: "finance.settle_batch.chunk",
    items: todo,
    perTx: SETTLE_ITEMS_PER_TX,
    opsPerItem: SETTLE_OPS_PER_ITEM,
    apply: async (txCtx, it) => {
      await settleInstallment(
        txCtx,
        {
          installmentId: it.key,
          date: input.date,
          principal: it.line.principal,
          interest: it.line.interest,
          fine: it.line.fine,
          discount: 0,
          fee: 0,
          methodId: method.id,
          methodKind: method.kind,
          accountId: account.id,
          reference: input.reference?.trim() || null,
          notes,
          operationId: jobId,
          idemKey: batchSettleKey(input.idemKey, it.key),
        },
        txCtx.store,
        cacheFor(txCtx),
      );
    },
  });

  // resultado pela baixa efetivamente gravada (lotes refeitos/repetidos conferem o registro)
  const lines: BatchResultLine[] = [];
  const touchedTitles = new Set<string>();
  const fresh: BatchResultLine[] = [];
  for (const l of preview.lines) {
    const o = l.status === "ok" ? outcomes.get(l.installmentId) : undefined;
    // envio retomado após interrupção: a parcela já baixada por ESTE envio aparece como baixada (não como erro)
    const st = l.titleId ? await ctx.store.get("settlements", detId("settle", batchSettleKey(input.idemKey, l.installmentId))) : null;
    if (!st || st.companyId !== ctx.companyId) {
      lines.push({ ...l, ...(l.status === "ok" ? { principal: 0, fine: 0, interest: 0, total: 0 } : {}), status: "error", message: l.message ?? o?.message ?? "Não baixada.", settlementId: null });
      continue;
    }
    const earlier = l.status === "error" || Boolean(o?.replayed);
    const r: BatchResultLine = { ...l, principal: st.principal, fine: st.fine, interest: st.interest, total: st.total, status: "settled", message: earlier ? "Baixada anteriormente neste envio." : null, settlementId: st.id };
    lines.push(r);
    touchedTitles.add(st.titleId);
    if (!earlier) fresh.push(r);
  }

  for (const titleId of touchedTitles) await refreshTitleStatus(ctx.store, titleId);
  for (const r of lines.filter((x) => x.status === "settled")) {
    const inst = await ctx.store.get("installments", r.installmentId);
    if (inst?.status === "paid") {
      await resolveOccurrence(ctx.store, `overdue:${inst.id}`);
      await resolveOccurrence(ctx.store, `payable_due:${inst.id}`);
    }
  }
  // histórico de cada título (mesmo evento da baixa individual), apenas para as baixas gravadas nesta execução
  for (const r of fresh) {
    await audit(ctx, {
      module: "finance",
      action: "settlement.create",
      entityType: "title",
      entityId: r.titleId,
      summary: `Baixa em lote de ${(r.total / 100).toFixed(2)} (principal ${(r.principal / 100).toFixed(2)}) — parcela ${r.number}/${r.count}`,
      after: { principal: r.principal, interest: r.interest, fine: r.fine, discount: 0, fee: 0, accountId: account.id, batch: jobId },
      related: [`installment:${r.installmentId}`, `settlement:${r.settlementId}`, `settlement_batch:${jobId}`],
      operationId: jobId,
    });
  }

  const settled = lines.filter((l) => l.status === "settled");
  const summary: BatchSettleResult = {
    jobId,
    replayed: false,
    kind: input.kind,
    date: input.date,
    settled: settled.length,
    errors: lines.length - settled.length,
    total: settled.reduce((a, l) => a + l.total, 0),
    lines,
  };
  await ctx.store.update("operations", jobId, {
    status: "done",
    result: { kind: input.kind, date: input.date, accountId: account.id, methodId: method.id, applyLateCharges: input.applyLateCharges, finishedAt: nowIso(), summary },
  });
  const word = KIND_WORD[input.kind];
  await audit(ctx, {
    module: "finance",
    action: "settlement.batch",
    entityType: "settlement_batch",
    entityId: jobId,
    summary: `${word} em lote: ${summary.settled} parcela(s) baixada(s), ${formatMoney(summary.total)} na conta ${account.name}${summary.errors ? `; ${summary.errors} não baixada(s)` : ""}${input.applyLateCharges ? " (com multa e juros sugeridos)" : " (sem encargos)"}`,
    after: {
      kind: input.kind,
      date: input.date,
      accountId: account.id,
      methodId: method.id,
      applyLateCharges: input.applyLateCharges,
      settled: summary.settled,
      errors: summary.errors,
      total: summary.total,
      falhas: lines.filter((l) => l.status === "error").map((l) => ({ parcela: l.installmentId, titulo: l.titleNumber, motivo: l.message })),
    },
    reason: input.notes?.trim() || null,
    related: [...touchedTitles].slice(0, 200).map((id) => `title:${id}`),
    operationId: jobId,
  });
  return summary;
}
