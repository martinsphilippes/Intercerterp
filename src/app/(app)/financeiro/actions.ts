"use server";

import { detId } from "@/lib/db";
import { runAction, fstr, fopt, fbool, fint, fjson } from "@/lib/server/action";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { BusinessError, assert } from "@/lib/core/errors";
import { saveFile } from "@/lib/core/files";
import { setSetting } from "@/lib/core/settings";
import { audit } from "@/lib/core/audit";
import { today, addDays } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  addTitleAttachment, approvePayable, assertUsableAccount, cancelTitle, changeInitialBalance, createAccountEntry, createManualTitle, rebuildRunningBalances, reverseEntry, reverseSettlement,
  revokePayableApproval, saveAccount, saveCostCenter, saveFinCategory, savePaymentMethod, savePaymentTerm, paymentTermInterestNotice, setRecordActive, settleInstallment, transferBetweenAccounts,
  undoRenegotiation, updateInstallment, updateTitle, type InstallmentInput,
} from "@/domain/finance";
import { importBankFile, ignoreBankTx, previewBankImport, reconcile, restoreBankTx, settleFromBankTx, undoReconciliation } from "@/domain/reconciliation";
import { settleCardReceivable } from "@/domain/sales";
import type { BankFormat, CsvMapping } from "@/domain/bank";
import { queryCardReceivables } from "./queries";

const RV = ["/financeiro/receber", "/financeiro/pagar", "/financeiro/fluxo-caixa", "/financeiro/conciliacao", "/financeiro/cartoes"];
const MAX_FILE = 10 * 1024 * 1024;

const base = (kind: string) => (kind === "payable" ? "/financeiro/pagar" : "/financeiro/receber");

async function fileFrom(fd: FormData, key: string) {
  const f = fd.get(key);
  if (!f || typeof f === "string" || !(f as File).size) return null;
  const file = f as File;
  assert(file.size <= MAX_FILE, "Arquivo maior que 10 MB.");
  return { name: file.name || "arquivo", mime: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) };
}

function noFuture(date: string) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date), "Informe uma data válida.");
  assert(date <= today(), "A data da baixa não pode ser futura.");
}

// ───────────────────────────── Títulos

export async function createTitleAction(fd: FormData) {
  const kind = fstr(fd, "kind") === "payable" ? "payable" : "receivable";
  return runAction({ module: "finance", op: "create", requireBranch: true, revalidate: [base(kind)] }, async (s) => {
    const approved = kind === "payable" && fbool(fd, "approved");
    if (approved) requireAction(s.ctx, "finance.approve_payable");
    const installments = fjson<InstallmentInput[]>(fd, "installments", []).map((i) => ({ dueDate: String(i.dueDate), amount: Math.round(Number(i.amount)) }));
    const total = fint(fd, "total");
    assert(installments.length > 0, "Gere as parcelas do título.");
    assert(installments.reduce((a, i) => a + i.amount, 0) === total, `A soma das parcelas difere do valor total (${formatMoney(total)}).`);
    const t = await createManualTitle(s.ctx, {
      kind,
      partyType: (fstr(fd, "partyType") as any) || "other",
      partyId: fopt(fd, "partyId"),
      partyName: fopt(fd, "partyName"),
      description: fstr(fd, "description"),
      documentNumber: fopt(fd, "documentNumber"),
      issueDate: fstr(fd, "issueDate") || today(),
      competenceDate: fstr(fd, "competenceDate") || fstr(fd, "issueDate") || today(),
      categoryId: fopt(fd, "categoryId"),
      costCenterId: fopt(fd, "costCenterId"),
      installments,
      notes: fopt(fd, "notes"),
      approved,
      idemKey: fstr(fd, "_idem"),
    });
    const file = await fileFrom(fd, "file");
    if (file) {
      const saved = await saveFile(s.ctx, { bucket: "attachments", ...file, entityType: "title", entityId: t.id, kind: "document" });
      await addTitleAttachment(s.ctx, t.id, { fileId: saved.id, name: file.name, mime: file.mime, sizeBytes: file.data.length, kind: "document" });
    }
    return { ok: true as const, message: `Título nº ${t.number} lançado.`, redirect: `${base(kind)}/${t.id}` };
  });
}

export async function updateTitleAction(id: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    await updateTitle(s.ctx, id, {
      description: fstr(fd, "description"),
      documentNumber: fopt(fd, "documentNumber"),
      competenceDate: fstr(fd, "competenceDate"),
      categoryId: fopt(fd, "categoryId"),
      costCenterId: fopt(fd, "costCenterId"),
      notes: fopt(fd, "notes"),
    });
    return { ok: true as const, message: "Título atualizado." };
  });
}

export async function updateInstallmentAction(id: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    await updateInstallment(s.ctx, id, { dueDate: fstr(fd, "dueDate") || undefined, ourNumber: fopt(fd, "ourNumber") }, fopt(fd, "reason"));
    return { ok: true as const, message: "Parcela atualizada." };
  });
}

/** Baixa (visão 3 recebimento / visão 4 pagamento) com comprovante opcional. */
export async function settleAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.settle");
    const installmentId = fstr(fd, "installmentId");
    const idemKey = `ui:${fstr(fd, "_idem")}`;
    const date = fstr(fd, "date");
    noFuture(date);
    const existing = await s.ctx.store.get("settlements", detId("settle", idemKey));
    if (existing) return { ok: true as const, message: "Baixa já registrada." };
    const methodId = fopt(fd, "methodId");
    const method = methodId ? await s.ctx.store.get("payment_methods", methodId) : null;
    let attachmentFileId: string | null = null;
    const inst = await s.ctx.store.getOrThrow("installments", installmentId);
    const title = await s.ctx.store.getOrThrow("titles", inst.titleId);
    assert(title.companyId === s.ctx.companyId, "Título de outra empresa.");
    // recebível da adquirente: a liquidação exige a taxa (lançamento separado) — tela de Cartões
    if (title.originType === "sale_card") throw new BusinessError("Recebível de cartão é liquidado em Financeiro → Cartões, com a taxa da adquirente lançada à parte.", "card_receivable");
    // conta validada antes de gravar o comprovante
    const account = await assertUsableAccount(s.ctx, fstr(fd, "accountId"));
    const file = await fileFrom(fd, "file");
    if (file) attachmentFileId = (await saveFile(s.ctx, { bucket: "attachments", ...file, entityType: "title", entityId: inst.titleId, kind: "receipt_proof" })).id;
    const st = await settleInstallment(s.ctx, {
      installmentId,
      date,
      principal: fint(fd, "principal"),
      interest: fint(fd, "interest"),
      fine: fint(fd, "fine"),
      discount: fint(fd, "discount"),
      fee: fint(fd, "fee"),
      methodId,
      methodKind: method?.kind ?? null,
      accountId: account.id,
      reference: fopt(fd, "reference"),
      notes: fopt(fd, "notes"),
      attachmentFileId,
      idemKey,
    });
    if (file && attachmentFileId) await addTitleAttachment(s.ctx, inst.titleId, { fileId: attachmentFileId, name: file.name, mime: file.mime, sizeBytes: file.data.length, kind: "receipt_proof", settlementId: st.id });
    const after = await s.ctx.store.getOrThrow("installments", installmentId);
    return { ok: true as const, message: `${inst.kind === "receivable" ? "Recebimento" : "Pagamento"} de ${formatMoney(st.total)} registrado${after.balance ? ` — saldo remanescente ${formatMoney(after.balance)}` : " — parcela quitada"}.` };
  });
}

export async function reverseSettlementAction(settlementId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.reverse");
    await reverseSettlement(s.ctx, settlementId, fstr(fd, "reason"));
    return { ok: true as const, message: "Baixa estornada; saldo da parcela recomposto." };
  });
}

export async function approvePayableAction(titleId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.approve_payable");
    const t = await s.ctx.store.get("titles", titleId);
    assert(t && t.companyId === s.ctx.companyId, "Título de outra empresa.");
    await approvePayable(s.ctx, titleId, fopt(fd, "reason") ?? undefined);
    return { ok: true as const, message: "Obrigação conferida e autorizada para pagamento." };
  });
}

export async function revokeApprovalAction(titleId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.approve_payable");
    await revokePayableApproval(s.ctx, titleId, fstr(fd, "reason"));
    return { ok: true as const, message: "Autorização revogada." };
  });
}

export async function cancelTitleAction(titleId: string, fd: FormData) {
  return runAction({ module: "finance", op: "delete", revalidate: RV }, async (s) => {
    const t = await s.ctx.store.getOrThrow("titles", titleId);
    assert(t.companyId === s.ctx.companyId, "Título de outra empresa.");
    const reason = fstr(fd, "reason");
    assert(reason, "Informe o motivo do cancelamento.");
    // título de renegociação: cancelar = desfazer a renegociação (parcelas originais voltam ao saldo)
    if (t.originType === "renegotiation") return undoRenegotiationResult(s.ctx, t, reason);
    if (t.originType !== "manual") throw new BusinessError("Títulos gerados por vendas, compras ou documentos fiscais são cancelados pela operação de origem (cancelamento da venda, do recebimento ou do documento).", "origin_managed");
    await cancelTitle(s.ctx, titleId, reason);
    return { ok: true as const, message: `Título nº ${t.number} cancelado.` };
  });
}

async function undoRenegotiationResult(ctx: Ctx, t: { id: string; number: number; originId?: string | null }, reason: string) {
  requireAction(ctx, "finance.settle");
  const before = t.originId ? await ctx.store.get("titles", t.originId) : null;
  await undoRenegotiation(ctx, t.id, reason);
  const orig = t.originId ? await ctx.store.get("titles", t.originId) : null;
  if (before?.status === "cancelled") return { ok: true as const, message: `Título nº ${t.number} cancelado. O título original nº ${before.number} já estava cancelado: nada voltou ao saldo.` };
  return { ok: true as const, message: `Renegociação desfeita: título nº ${t.number} cancelado e parcelas devolvidas ao título nº ${orig?.number ?? "original"}.`, redirect: orig ? `/financeiro/receber/${orig.id}` : undefined };
}

/** Desfaz a renegociação (título gerado sem recebimentos ativos). */
export async function undoRenegotiationAction(titleId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    const t = await s.ctx.store.getOrThrow("titles", titleId);
    assert(t.companyId === s.ctx.companyId, "Título de outra empresa.");
    const reason = fstr(fd, "reason");
    assert(reason, "Informe o motivo para desfazer a renegociação.");
    return undoRenegotiationResult(s.ctx, t as any, reason);
  });
}

export async function uploadAttachmentAction(titleId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    const t = await s.ctx.store.getOrThrow("titles", titleId);
    assert(t.companyId === s.ctx.companyId, "Título de outra empresa.");
    const file = await fileFrom(fd, "file");
    assert(file, "Selecione o arquivo.");
    const saved = await saveFile(s.ctx, { bucket: "attachments", ...file!, entityType: "title", entityId: titleId, kind: fopt(fd, "kind") ?? "document", branchId: t.branchId });
    await addTitleAttachment(s.ctx, titleId, { fileId: saved.id, name: file!.name, mime: file!.mime, sizeBytes: file!.data.length, kind: fopt(fd, "kind") ?? "document", settlementId: fopt(fd, "settlementId") });
    return { ok: true as const, message: "Anexo enviado." };
  });
}

// ───────────────────────────── Contas, lançamentos e transferências

export async function saveAccountAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "finance", op: id ? "edit" : "create", revalidate: ["/financeiro/cadastros", "/financeiro/fluxo-caixa"] }, async (s) => {
    const acc = await saveAccount(
      s.ctx,
      id,
      {
        name: fstr(fd, "name"), kind: fstr(fd, "kind") as any, branchId: fopt(fd, "branchId"), bankCode: fopt(fd, "bankCode"), agency: fopt(fd, "agency"), accountNumber: fopt(fd, "accountNumber"),
        pixKey: fopt(fd, "pixKey"), initialBalance: fint(fd, "initialBalance"), initialBalanceDate: fstr(fd, "initialBalanceDate"), active: fd.has("active") ? fbool(fd, "active") : true,
      },
      fopt(fd, "reason"),
    );
    return { ok: true as const, message: id ? "Conta atualizada." : "Conta criada.", data: { id: acc.id } };
  });
}

export async function changeInitialBalanceAction(accountId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: ["/financeiro/cadastros", `/financeiro/contas/${accountId}`] }, async (s) => {
    await changeInitialBalance(s.ctx, accountId, { initialBalance: fint(fd, "initialBalance"), initialBalanceDate: fstr(fd, "initialBalanceDate"), reason: fstr(fd, "reason") });
    return { ok: true as const, message: "Saldo inicial alterado; saldos recalculados." };
  });
}

export async function rebuildBalancesAction(accountId: string) {
  return runAction({ module: "finance", op: "edit", revalidate: [`/financeiro/contas/${accountId}`] }, async (s) => {
    const acc = await s.ctx.store.getOrThrow("financial_accounts", accountId);
    assert(acc.companyId === s.ctx.companyId, "Conta de outra empresa.");
    const r = await rebuildRunningBalances(s.ctx.store, accountId);
    await audit(s.ctx, { module: "finance", action: "account.rebuild", entityType: "financial_account", entityId: accountId, summary: `Recálculo de saldos: ${r.fixed} lançamento(s) ajustado(s); divergência ${formatMoney(r.divergence)}` });
    return { ok: true as const, message: r.divergence ? `Recalculado. Divergência de ${formatMoney(r.divergence)} entre saldo e lançamentos — acione o suporte.` : `Saldos conferidos (${r.fixed} ajuste(s) de "saldo após").` };
  });
}

export async function createEntryAction(fd: FormData) {
  return runAction({ module: "finance", op: "create", requireBranch: true, revalidate: RV }, async (s) => {
    const direction = fstr(fd, "direction");
    const amount = Math.abs(fint(fd, "amount"));
    const kind = fstr(fd, "kind") === "fee" ? "fee" : "adjustment";
    const e = await createAccountEntry(s.ctx, {
      accountId: fstr(fd, "accountId"), date: fstr(fd, "date"), amount: kind === "fee" || direction === "out" ? -amount : amount, kind, description: fstr(fd, "description"),
      categoryId: fopt(fd, "categoryId"), costCenterId: fopt(fd, "costCenterId"), idemKey: fstr(fd, "_idem"),
    });
    return { ok: true as const, message: `Lançamento de ${formatMoney(e.amount)} registrado.` };
  });
}

export async function reverseEntryAction(entryId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.reverse");
    await reverseEntry(s.ctx, entryId, fstr(fd, "reason"));
    return { ok: true as const, message: "Lançamento estornado." };
  });
}

export async function transferAction(fd: FormData) {
  return runAction({ module: "finance", op: "create", requireBranch: true, revalidate: RV }, async (s) => {
    const date = fstr(fd, "date");
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today(), "Data inválida (não pode ser futura).");
    const from = await s.ctx.store.get("financial_accounts", fstr(fd, "fromAccountId"));
    const to = await s.ctx.store.get("financial_accounts", fstr(fd, "toAccountId"));
    assert(from && to && from.companyId === s.ctx.companyId && to.companyId === s.ctx.companyId, "Selecione as contas de origem e destino.");
    await transferBetweenAccounts(s.ctx, { fromAccountId: from!.id, toAccountId: to!.id, amount: fint(fd, "amount"), date, description: fstr(fd, "description") || `Transferência ${from!.name} → ${to!.name}`, idemKey: `ui:${fstr(fd, "_idem")}` });
    return { ok: true as const, message: "Transferência registrada (não afeta receitas/despesas)." };
  });
}

// ───────────────────────────── Cadastros auxiliares

export async function savePaymentMethodAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "finance", op: id ? "edit" : "create", revalidate: ["/financeiro/cadastros"] }, async (s) => {
    await savePaymentMethod(s.ctx, id, {
      name: fstr(fd, "name"), kind: fstr(fd, "kind"), accountId: fopt(fd, "accountId"), feeBps: fint(fd, "feeBps"), settlementDays: fint(fd, "settlementDays"), allowsChange: fbool(fd, "allowsChange"),
      requiresCustomer: fbool(fd, "requiresCustomer"), availablePdv: fbool(fd, "availablePdv"), maxInstallments: fint(fd, "maxInstallments", 1), sortOrder: fint(fd, "sortOrder", 99), active: fbool(fd, "active"),
    });
    return { ok: true as const, message: "Meio de pagamento salvo." };
  });
}

export async function savePaymentTermAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "finance", op: id ? "edit" : "create", revalidate: ["/financeiro/cadastros"] }, async (s) => {
    const term = await savePaymentTerm(s.ctx, id, { name: fstr(fd, "name"), installments: fint(fd, "installments", 1), firstDueDays: fint(fd, "firstDueDays"), intervalDays: fint(fd, "intervalDays", 30), interestBps: fint(fd, "interestBps"), kind: (fstr(fd, "kind") as any) || "both", active: fbool(fd, "active") });
    const notice = paymentTermInterestNotice(term);
    return { ok: true as const, message: notice ? `Condição de parcelamento salva. ${notice}` : "Condição de parcelamento salva." };
  });
}

export async function saveCategoryAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "finance", op: id ? "edit" : "create", revalidate: ["/financeiro/cadastros"] }, async (s) => {
    await saveFinCategory(s.ctx, id, { name: fstr(fd, "name"), type: fstr(fd, "type") as any, parentId: fopt(fd, "parentId"), dreGroup: fopt(fd, "dreGroup"), active: fbool(fd, "active") });
    return { ok: true as const, message: "Categoria salva." };
  });
}

export async function saveCostCenterAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "finance", op: id ? "edit" : "create", revalidate: ["/financeiro/cadastros"] }, async (s) => {
    await saveCostCenter(s.ctx, id, { name: fstr(fd, "name"), code: fopt(fd, "code"), active: fbool(fd, "active") });
    return { ok: true as const, message: "Centro de custo salvo." };
  });
}

export async function setActiveAction(collection: "financial_accounts" | "payment_methods" | "payment_terms" | "fin_categories" | "cost_centers", id: string, active: boolean) {
  return runAction({ module: "finance", op: "edit", revalidate: ["/financeiro/cadastros"] }, async (s) => {
    await setRecordActive(s.ctx, collection, id, active);
    return { ok: true as const, message: active ? "Reativado." : "Inativado (histórico preservado)." };
  });
}

export async function saveFinanceParamsAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: ["/financeiro/cadastros"] }, async (s) => {
    const fineBps = fint(fd, "fineBps");
    const interestMonthlyBps = fint(fd, "interestMonthlyBps");
    const graceDays = fint(fd, "graceDays");
    const window = fint(fd, "dateWindowDays", 5);
    assert(fineBps >= 0 && fineBps <= 2000 && interestMonthlyBps >= 0 && interestMonthlyBps <= 1000, "Multa até 20% e juros até 10% a.m.");
    assert(graceDays >= 0 && graceDays <= 60 && window >= 0 && window <= 30, "Tolerância até 60 dias; janela de conciliação até 30 dias.");
    const before = { fineBps, interestMonthlyBps, graceDays };
    await setSetting(s.ctx.store, s.ctx.companyId, null, "finance.late", before, s.ctx.user.id);
    await setSetting(s.ctx.store, s.ctx.companyId, null, "finance.reconcile.dateWindowDays", window, s.ctx.user.id);
    for (const k of ["sales", "purchases", "fees"]) {
      const v = fopt(fd, `category_${k}`);
      if (v !== null) await setSetting(s.ctx.store, s.ctx.companyId, null, `finance.category.${k}`, v, s.ctx.user.id);
    }
    await audit(s.ctx, { module: "finance", action: "settings.update", entityType: "settings", entityId: "finance", summary: "Parâmetros financeiros atualizados", after: { ...before, dateWindowDays: window } });
    return { ok: true as const, message: "Parâmetros salvos." };
  });
}

// ───────────────────────────── Conciliação e importação

function importInput(fd: FormData, file: { name: string; mime: string; data: Buffer }) {
  return {
    accountId: fstr(fd, "accountId"),
    fileName: file.name,
    data: file.data,
    mime: file.mime,
    format: (fstr(fd, "format") || "auto") as BankFormat | "auto",
    csvMapping: fjson<CsvMapping | null>(fd, "csvMapping", null),
  };
}

export async function previewImportAction(fd: FormData) {
  return runAction({ module: "finance" }, async (s) => {
    const file = await fileFrom(fd, "file");
    assert(file, "Selecione o arquivo do extrato/retorno.");
    assert(fstr(fd, "accountId"), "Selecione a conta financeira.");
    const pv = await previewBankImport(s.ctx, importInput(fd, file!));
    return { ...pv, rows: pv.rows.slice(0, 300), totalRows: pv.rows.length, issues: pv.result.issues.slice(0, 500) };
  });
}

export async function importAction(fd: FormData) {
  return runAction({ module: "finance", op: "create", requireBranch: true, revalidate: ["/financeiro/conciliacao"] }, async (s) => {
    requireAction(s.ctx, "finance.reconcile");
    const file = await fileFrom(fd, "file");
    assert(file, "Selecione o arquivo do extrato/retorno.");
    const r = await importBankFile(s.ctx, importInput(fd, file!));
    return {
      ok: true as const,
      message: r.alreadyImported ? "Este arquivo já foi importado nesta conta — nada foi duplicado." : `Importação concluída: ${r.import.summary.created} nova(s), ${r.import.summary.duplicates} duplicada(s).`,
      redirect: `/financeiro/conciliacao/importacoes/${r.import.id}`,
    };
  });
}

export async function reconcileAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.reconcile");
    const adjust = fbool(fd, "adjust");
    const rec = await reconcile(s.ctx, {
      accountId: fstr(fd, "accountId"),
      bankTxIds: fjson<string[]>(fd, "bankTxIds", []),
      entryIds: fjson<string[]>(fd, "entryIds", []),
      adjustment: adjust ? { categoryId: fopt(fd, "categoryId"), costCenterId: fopt(fd, "costCenterId"), description: fopt(fd, "adjDescription") } : null,
      notes: fopt(fd, "notes"),
      idemKey: `ui:${fstr(fd, "_idem")}`,
    });
    return { ok: true as const, message: `Conciliação registrada${rec.feeEntryId ? ` (diferença de ${formatMoney(rec.difference)} lançada)` : ""}.` };
  });
}

export async function undoReconciliationAction(id: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.reconcile");
    await undoReconciliation(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Conciliação desfeita. Baixas e lançamentos foram preservados." };
  });
}

export async function ignoreTxAction(id: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: ["/financeiro/conciliacao"] }, async (s) => {
    requireAction(s.ctx, "finance.reconcile");
    await ignoreBankTx(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Linha ignorada." };
  });
}

export async function restoreTxAction(id: string) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: ["/financeiro/conciliacao"] }, async (s) => {
    requireAction(s.ctx, "finance.reconcile");
    await restoreBankTx(s.ctx, id);
    return { ok: true as const, message: "Linha reativada." };
  });
}

export async function settleFromTxAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.settle");
    requireAction(s.ctx, "finance.reconcile");
    const methodId = fopt(fd, "methodId");
    const method = methodId ? await s.ctx.store.get("payment_methods", methodId) : null;
    const r = await settleFromBankTx(s.ctx, {
      bankTxId: fstr(fd, "bankTxId"), installmentId: fstr(fd, "installmentId"), principal: fint(fd, "principal"), interest: fint(fd, "interest"), fine: fint(fd, "fine"),
      discount: fint(fd, "discount"), fee: fint(fd, "fee"), methodId, methodKind: method?.kind ?? null,
    });
    return { ok: true as const, message: r.reused ? `Baixa existente de ${formatMoney(r.settlement.total)} (parcela ${r.installmentNumber}) conciliada com a linha.` : `Baixa de ${formatMoney(r.settlement.total)} registrada e conciliada com a linha.` };
  });
}

// ───────────────────────────── Recebíveis de cartão

async function settleCard(ctx: Ctx, input: { installmentId: string; accountId: string; date: string; gross: number; fee: number; reference?: string | null }) {
  const inst = await ctx.store.getOrThrow("installments", input.installmentId);
  const title = await ctx.store.getOrThrow("titles", inst.titleId);
  assert(title.companyId === ctx.companyId && title.originType === "sale_card", "Recebível de cartão inválido.");
  assert(input.fee >= 0 && input.fee < input.gross, "Taxa inválida.");
  const account = await assertUsableAccount(ctx, input.accountId);
  return settleCardReceivable(ctx, { installmentId: inst.id, accountId: account.id, date: input.date, grossAmount: input.gross, fee: input.fee, reference: input.reference ?? undefined });
}

export async function settleCardAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.settle");
    const date = fstr(fd, "date");
    noFuture(date);
    const st = await settleCard(s.ctx, { installmentId: fstr(fd, "installmentId"), accountId: fstr(fd, "accountId"), date, gross: fint(fd, "gross"), fee: fint(fd, "fee"), reference: fopt(fd, "reference") });
    return { ok: true as const, message: `Liquidação registrada: bruto ${formatMoney(st.principal)}, taxa ${formatMoney(st.fee)}, líquido ${formatMoney(st.total - st.fee)}.` };
  });
}

/** Liquida em lote os recebíveis previstos até a data (taxa prevista de cada um), na conta escolhida. */
export async function settleCardsBatchAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.settle");
    const until = fstr(fd, "until");
    const date = fstr(fd, "date") || today();
    noFuture(date);
    assert(until && until <= addDays(today(), 0), "Informe a data limite da previsão (até hoje).");
    const accountId = (await assertUsableAccount(s.ctx, fstr(fd, "accountId"))).id;
    const rows = (await queryCardReceivables(s.ctx, { q: "", f: { status: "open", to: until, kind: fstr(fd, "kind") } })).filter((r) => r.openGross > 0);
    assert(rows.length, "Nenhum recebível em aberto previsto até a data.");
    let gross = 0;
    let fee = 0;
    for (const r of rows.slice(0, 200)) {
      const st = await settleCard(s.ctx, { installmentId: r.id, accountId, date, gross: r.openGross, fee: r.openFee, reference: fopt(fd, "reference") });
      gross += st.principal;
      fee += st.fee;
    }
    return { ok: true as const, message: `${Math.min(rows.length, 200)} recebível(is) liquidado(s): bruto ${formatMoney(gross)}, taxas ${formatMoney(fee)}, líquido ${formatMoney(gross - fee)}.` };
  });
}

// ───────────────────────────── Renegociação e cobrança

export async function renegotiateAction(titleId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    requireAction(s.ctx, "finance.settle");
    const { renegotiate } = await import("@/domain/finance");
    const t = await renegotiate(s.ctx, {
      titleId,
      installmentIds: fd.getAll("installmentIds").map(String),
      charges: fint(fd, "charges"),
      discount: fint(fd, "discount"),
      installments: fjson<InstallmentInput[]>(fd, "installments", []).map((i) => ({ dueDate: String(i.dueDate), amount: Math.round(Number(i.amount)) })),
      reason: fstr(fd, "reason"),
      idemKey: fstr(fd, "_idem"),
    });
    return { ok: true as const, message: `Renegociação registrada: novo título nº ${t.number}.`, redirect: `/financeiro/receber/${t.id}` };
  });
}

export async function sendNoticeAction(installmentId: string, fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: RV }, async (s) => {
    const { sendCollectionNotice } = await import("@/domain/finance");
    const r = await sendCollectionNotice(s.ctx, installmentId, { to: fopt(fd, "to"), message: fopt(fd, "message") });
    if (!r.delivered) return { ok: false as const, error: `Aviso não enviado: ${r.message ?? r.channel}. Verifique o canal de e-mail em Administração → Integrações.`, code: "not_delivered" };
    return { ok: true as const, message: "Aviso de cobrança entregue ao provedor de e-mail." };
  });
}
