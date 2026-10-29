import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { type Ctx, type CtxUser } from "@/lib/core/ctx";
import { nextNumber } from "@/lib/core/numbering";
import { notify, resolveOccurrence } from "@/lib/core/notify";
import { addDays, formatDate, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { NETWORK_SCOPE, allNodes, auditNode, isPlatform, networkSettings, nodeOfCompany } from "./common";
import { DEFAULT_TERMS, describeTerms, normalizeTerms, type AgreementTerms } from "./billing-plan";

/**
 * Financeiro em camadas (§46) — modalidade comercial por relação pai→filho, carteira pré-paga, recargas, ajustes e
 * as peças comuns (empresa de cada parte, categorias do plano de contas da certificação, conta de recebimento).
 *
 * Tudo que é da rede é registro da PLATAFORMA (`companyId = "platform"`); os títulos e lançamentos financeiros de cada
 * camada vivem no financeiro da própria empresa (contas a pagar/receber, baixas, conciliação, DRE).
 */

// ---------------------------------------------------------------------------------------------------------- empresas

/** Contexto delegado numa empresa (os títulos de cada camada são gravados na empresa da camada). */
export async function companyCtx(store: Store, companyId: string, user: CtxUser, ip?: string): Promise<Ctx> {
  const base = unscoped(store);
  const branch = await findOne(base, "branches", [["eq", "companyId", companyId]]);
  return { store: scopeStore(base, companyId), companyId, branchId: branch?.id ?? null, user, ip };
}

/** Usuário técnico das rotinas. */
export const SYSTEM_USER: CtxUser = { id: "system", name: "Sistema", email: "", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [] };

/** Empresa de uma parte (nó → empresa do nó; plataforma → empresa da Intercert configurada; null = sem empresa). */
export async function partyCompanyId(store: Store, party: { type: string; nodeId: string | null }, nodes?: Doc[]): Promise<string | null> {
  if (party.type === "platform") return (await networkSettings(store)).platformCompanyId;
  if (party.type !== "node" || !party.nodeId) return null;
  const n = nodes?.find((x) => x.id === party.nodeId) ?? (await unscoped(store).get("cert_network_nodes", party.nodeId));
  return n?.nodeCompanyId ?? null;
}

// --------------------------------------------------------------------------------------------- plano de contas da rede

export const NETWORK_CATEGORIES = {
  client_sale: { name: "Receita de certificados digitais", type: "revenue", group: "Receita bruta" },
  child_sale: { name: "Vendas aos parceiros abaixo na rede", type: "revenue", group: "Receita bruta" },
  commission_in: { name: "Comissões recebidas da rede", type: "revenue", group: "Receita bruta" },
  cost_up: { name: "Custo de certificados (compra do nível acima)", type: "expense", group: "Custo dos serviços" },
  commission_out: { name: "Comissões pagas na rede (repasses e indicações)", type: "expense", group: "Custo dos serviços" },
  ac_cost: { name: "Custo AC — emissão pela AC de 1º nível", type: "expense", group: "Custo dos serviços" },
  prepaid_in: { name: "Créditos pré-pagos vendidos aos parceiros abaixo (adiantamento)", type: "revenue", group: "Adiantamentos" },
  prepaid_out: { name: "Créditos pré-pagos comprados do nível acima (adiantamento)", type: "expense", group: "Adiantamentos" },
} as const;
export type NetworkCategoryKey = keyof typeof NETWORK_CATEGORIES;

/**
 * Categorias da certificação na empresa (idempotente): cria as que faltam e completa o grupo do DRE das existentes
 * sem grupo (mesmo nome). Não altera o grupo escolhido pelo usuário.
 */
export async function ensureNetworkCategories(store: Store, companyId: string): Promise<Record<NetworkCategoryKey, string>> {
  const base = unscoped(store);
  const existing = await listAll(base, "fin_categories", { filters: [["eq", "companyId", companyId]] });
  const out = {} as Record<NetworkCategoryKey, string>;
  for (const [key, c] of Object.entries(NETWORK_CATEGORIES) as Array<[NetworkCategoryKey, (typeof NETWORK_CATEGORIES)[NetworkCategoryKey]]>) {
    const found = existing.find((x) => x.name === c.name);
    if (found) {
      if (!found.dreGroup) await base.update("fin_categories", found.id, { dreGroup: c.group }).catch(() => undefined);
      out[key] = found.id;
      continue;
    }
    const id = detId("fin_category", companyId, "network", key);
    try {
      await base.create("fin_categories", { companyId, branchId: null, createdBy: null, name: c.name, type: c.type, dreGroup: c.group, active: true }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
    out[key] = id;
  }
  return out;
}

/**
 * Conta de recebimento da rede na empresa: o parâmetro `network.receivingAccountId` (quando definido e ativo) ou a
 * primeira conta bancária ativa (senão carteira digital, senão caixa).
 */
export async function receivingAccountId(store: Store, companyId: string): Promise<string | null> {
  const base = unscoped(store);
  const { getSetting } = await import("@/lib/core/settings");
  const chosen = await getSetting<string | null>(base, companyId, null, "network.receivingAccountId", null);
  const accounts = (await listAll(base, "financial_accounts", { filters: [["eq", "companyId", companyId]] })).filter((a) => a.active !== false);
  if (chosen && accounts.some((a) => a.id === chosen)) return chosen;
  return (accounts.find((a) => a.kind === "bank") ?? accounts.find((a) => a.kind === "wallet") ?? accounts.find((a) => a.kind === "cash"))?.id ?? null;
}

// ------------------------------------------------------------------------------------------------------ modalidade

export interface AgreementView {
  doc: Doc | null;
  terms: AgreementTerms;
  source: "agreement" | "default";
  validFrom: string | null;
  validTo: string | null;
}

export async function allAgreements(store: Store): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_billing_agreements", { filters: [["eq", "companyId", NETWORK_SCOPE]] });
}

/** Modalidade vigente da relação do nó com o pai ATUAL (sem registro: pós-pago mensal padrão). Função pura. */
export function resolveAgreement(agreements: Doc[], node: { id: string; parentNodeId?: string | null }, date: string): AgreementView {
  const mine = agreements
    .filter((a) => a.childNodeId === node.id && a.active !== false && (a.parentNodeId ?? null) === (node.parentNodeId ?? null) && String(a.validFrom) <= date && (!a.validTo || String(a.validTo) >= date))
    .sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)));
  const a = mine[0];
  if (!a) return { doc: null, terms: { ...DEFAULT_TERMS }, source: "default", validFrom: null, validTo: null };
  return { doc: a, terms: normalizeTerms(a.terms ?? {}).terms, source: "agreement", validFrom: a.validFrom, validTo: a.validTo ?? null };
}

export async function effectiveAgreement(store: Store, nodeId: string, date = today()): Promise<AgreementView> {
  const node = await unscoped(store).get("cert_network_nodes", nodeId);
  if (!node) return { doc: null, terms: { ...DEFAULT_TERMS }, source: "default", validFrom: null, validTo: null };
  return resolveAgreement(await allAgreements(store), node, date);
}

/** Histórico das modalidades do nó (inclusive encerradas e substituídas). */
export async function agreementHistory(store: Store, nodeId: string): Promise<Doc[]> {
  return (await allAgreements(store)).filter((a) => a.childNodeId === nodeId).sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Quem define a modalidade/recarrega/fecha um filho: o pai (operação network.billing, nó ativo) ou a plataforma. */
export async function canBillChild(ctx: Ctx, child: Doc): Promise<boolean> {
  if (isPlatform(ctx)) return true;
  if (!child.parentNodeId || !canDo(ctx.user, "network.billing")) return false;
  const my = await nodeOfCompany(ctx.store, ctx.companyId);
  return Boolean(my && my.id === child.parentNodeId && my.status === "active");
}

async function nodeOrThrow(store: Store, id: string): Promise<Doc> {
  const n = await unscoped(store).get("cert_network_nodes", id);
  if (!n) throw new BusinessError("Parceiro não encontrado.", "not_found");
  return n;
}

export interface AgreementInput extends Partial<AgreementTerms> {
  validFrom?: string | null;
  reason?: string | null;
}

/** Define a modalidade comercial do filho com o pai (vigência hoje ou futura; a anterior termina na véspera). */
export async function saveBillingAgreement(ctx: Ctx, childNodeId: string, input: AgreementInput): Promise<Doc> {
  const child = await nodeOrThrow(ctx.store, childNodeId);
  if (!(await canBillChild(ctx, child))) throw new PermissionError(child.parentNodeId ? "Somente o parceiro de cima (operação “Financeiro com os parceiros abaixo”) ou a plataforma define a modalidade." : "Somente a plataforma Intercert define a modalidade de quem está diretamente abaixo dela.");
  assert(child.status !== "closed", "Parceiro encerrado não recebe modalidade nova.");
  const { terms, errors } = normalizeTerms(input);
  if (errors.length) throw new BusinessError(errors.join(" "), "terms");
  if (terms.mode === "commission" && child.level === "contador" && terms.commissionSettlement === "split") {
    // permitido: o contador recebe a parte dele no split; nada a recusar — só documentado
  }
  const validFrom = input.validFrom || today();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(validFrom), "Data de vigência inválida.");
  assert(validFrom >= today(), "A vigência começa hoje ou numa data futura (o histórico não é reescrito).");
  const base = unscoped(ctx.store);
  const same = (await allAgreements(ctx.store)).filter((a) => a.childNodeId === child.id && a.active !== false && (a.parentNodeId ?? null) === (child.parentNodeId ?? null));
  const future = same.find((a) => String(a.validFrom) > validFrom);
  if (future) throw new BusinessError(`Já existe uma modalidade com vigência futura (a partir de ${formatDate(future.validFrom)}). Use uma vigência igual ou posterior.`, "future");
  let previous: Doc | null = null;
  for (const a of same) {
    if (String(a.validFrom) === validFrom) {
      await base.update("cert_billing_agreements", a.id, { active: false, supersededAt: nowIso() });
      previous = a;
    } else if (!a.validTo || String(a.validTo) >= validFrom) {
      await base.update("cert_billing_agreements", a.id, { validTo: addDays(validFrom, -1) });
      previous = a;
    }
  }
  const reason = String(input.reason ?? "").trim().slice(0, 300) || null;
  const doc = await base.create("cert_billing_agreements", {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, childNodeId: child.id, parentNodeId: child.parentNodeId ?? null, mode: terms.mode, terms, validFrom, validTo: null, active: true, supersededAt: null, reason, byName: ctx.user.name,
  });
  if (terms.mode === "prepaid") await ensureWallet(ctx.store, child);
  await auditNode(ctx, child, {
    action: "network.billing_agreement", reason,
    summary: `Modalidade de ${child.name} com ${child.parentNodeId ? "o parceiro acima" : "a Intercert"} a partir de ${formatDate(validFrom)}: ${describeTerms(terms, formatMoney)}${previous ? " (encerra a anterior)" : ""}`,
    before: previous ? { mode: previous.mode, terms: previous.terms, validFrom: previous.validFrom } : null, after: { mode: terms.mode, terms, validFrom }, related: [`cert_billing_agreement:${doc.id}`],
  });
  return doc;
}

// ---------------------------------------------------------------------------------------------------------- carteira

export const walletIdOf = (childNodeId: string, parentNodeId: string | null) => detId("cert_wallet", childNodeId, parentNodeId ?? "platform");

/** Carteira do filho junto ao pai atual (cria zerada). */
export async function ensureWallet(store: Store, child: Doc): Promise<Doc> {
  const base = unscoped(store);
  const id = walletIdOf(child.id, child.parentNodeId ?? null);
  const ex = await base.get("cert_wallets", id);
  if (ex) return ex;
  const parent = child.parentNodeId ? await base.get("cert_network_nodes", child.parentNodeId) : null;
  try {
    return await base.create("cert_wallets", {
      companyId: NETWORK_SCOPE, branchId: null, createdBy: null, childNodeId: child.id, parentNodeId: child.parentNodeId ?? null, childCompanyId: child.nodeCompanyId, parentCompanyId: parent?.nodeCompanyId ?? (await networkSettings(store)).platformCompanyId,
      balance: 0, held: 0, available: 0, rechargeCount: 0, lastMoveAt: null,
    }, id);
  } catch (e) {
    if (!isConflict(e)) throw e;
    return (await base.get("cert_wallets", id))!;
  }
}

export const WALLET_MOVE_LABEL: Record<string, string> = {
  recharge: "Recarga confirmada", hold: "Reserva (venda aberta)", debit: "Débito por venda paga", release: "Liberação (venda cancelada)", reversal: "Estorno de venda paga", adjustment: "Ajuste manual",
};

/** Lançamento na carteira dentro da transação: incrementos atômicos (com o limite do disponível) + extrato. */
export async function walletMoveInTx(tx: Store, w: { id: string }, m: { kind: string; balance: number; held: number; available: number; minAvailable?: number | null; requestId?: string | null; protocol?: string | null; rechargeId?: string | null; reason?: string | null; userId: string; userName: string; date?: string; moveId: string }): Promise<void> {
  if (m.balance) await tx.increment("cert_wallets", w.id, "balance", m.balance);
  if (m.held) await tx.increment("cert_wallets", w.id, "held", m.held, { min: 0 });
  if (m.available) await tx.increment("cert_wallets", w.id, "available", m.available, m.available < 0 && m.minAvailable != null ? { min: m.minAvailable } : undefined);
  await tx.create("cert_wallet_moves", {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: m.userId, walletId: w.id, kind: m.kind, amount: m.balance, heldDelta: m.held, availableDelta: m.available, requestId: m.requestId ?? null, protocol: m.protocol ?? null,
    rechargeId: m.rechargeId ?? null, reason: m.reason ?? null, userName: m.userName, date: m.date ?? today(),
  }, m.moveId);
}

export async function walletMoves(store: Store, walletId: string): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_wallet_moves", { filters: [["eq", "walletId", walletId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 5000);
}

/** Ajuste manual da carteira (crédito ou débito) com motivo — pai com network.billing ou plataforma. Idempotente. */
export async function adjustWallet(ctx: Ctx, childNodeId: string, input: { amount: number; reason: string; idemKey: string }): Promise<Doc> {
  const child = await nodeOrThrow(ctx.store, childNodeId);
  if (!(await canBillChild(ctx, child))) throw new PermissionError("Somente o parceiro de cima (com a operação de financeiro da rede) ou a plataforma ajusta a carteira.");
  const amount = Math.round(Number(input.amount));
  assert(Number.isInteger(amount) && amount !== 0, "Informe o valor do ajuste (positivo credita, negativo debita).");
  const reason = String(input.reason ?? "").trim();
  assert(reason.length >= 10, "Informe o motivo do ajuste (ao menos 10 caracteres).");
  const idem = String(input.idemKey ?? "").trim();
  assert(idem, "Chave da operação ausente: recarregue a tela.");
  const w = await ensureWallet(ctx.store, child);
  const moveId = detId("cert_wallet_move", w.id, "adjustment", idem);
  const base = unscoped(ctx.store);
  if (await base.get("cert_wallet_moves", moveId)) return (await base.get("cert_wallets", w.id))!;
  const terms = (await effectiveAgreement(ctx.store, child.id)).terms;
  try {
    await base.transaction((tx) => walletMoveInTx(tx, w, { kind: "adjustment", balance: amount, held: 0, available: amount, minAvailable: -terms.overdraftLimit, reason, userId: ctx.user.id, userName: ctx.user.name, moveId }));
  } catch (e) {
    if (isConflict(e)) {
      if (await base.get("cert_wallet_moves", moveId)) return (await base.get("cert_wallets", w.id))!;
      throw new BusinessError("Débito recusado: o saldo disponível ficaria abaixo do limite permitido.", "wallet_limit");
    }
    throw e;
  }
  await auditNode(ctx, child, { action: "network.wallet_adjust", reason, summary: `Ajuste da carteira pré-paga de ${child.name}: ${amount > 0 ? "crédito" : "débito"} de ${formatMoney(Math.abs(amount))}`, after: { amount }, related: [`cert_wallet:${w.id}`] });
  return (await base.get("cert_wallets", w.id))!;
}

// ---------------------------------------------------------------------------------------------------------- recargas

const padRecharge = (n: number) => `RC-${String(n).padStart(5, "0")}`;

/**
 * Recarga de créditos: lança o título A RECEBER na empresa do pai (ou da Intercert) e A PAGAR na do filho. O crédito na
 * carteira só entra quando o pai confirma o recebimento. Pedida pelo pai (ou plataforma) ou pelo próprio filho.
 */
export async function requestRecharge(ctx: Ctx, childNodeId: string, input: { amount: number; dueDate?: string | null; idemKey: string }): Promise<Doc> {
  const child = await nodeOrThrow(ctx.store, childNodeId);
  const my = await nodeOfCompany(ctx.store, ctx.companyId);
  const isChild = Boolean(my && my.id === child.id && canDo(ctx.user, "network.billing"));
  if (!isChild && !(await canBillChild(ctx, child))) throw new PermissionError();
  assert(child.status === "active", "Parceiro sem situação ativa não recebe recarga.");
  const amount = Math.round(Number(input.amount));
  assert(Number.isInteger(amount) && amount > 0, "Informe o valor da recarga.");
  const due = input.dueDate || addDays(today(), 3);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(due) && due >= today(), "O vencimento da recarga não pode ser anterior a hoje.");
  const idem = String(input.idemKey ?? "").trim();
  assert(idem, "Chave da operação ausente: recarregue a tela.");
  const base = unscoped(ctx.store);
  const id = detId("cert_wallet_recharge", child.id, idem);
  const ex = await base.get("cert_wallet_recharges", id);
  if (ex) return ex;
  const w = await ensureWallet(ctx.store, child);
  const parent = child.parentNodeId ? await base.get("cert_network_nodes", child.parentNodeId) : null;
  const parentCompanyId = parent?.nodeCompanyId ?? (await networkSettings(ctx.store)).platformCompanyId;
  if (!parentCompanyId) throw new BusinessError("Defina a empresa da Intercert em Rede › Parâmetros antes de recarregar créditos de quem está direto abaixo da plataforma.", "platform_company");
  const seq = await nextNumber(base, "cert_wallet_recharge");
  let r: Doc;
  try {
    r = await base.create("cert_wallet_recharges", {
      companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, code: padRecharge(seq), walletId: w.id, childNodeId: child.id, parentNodeId: child.parentNodeId ?? null, amount, dueDate: due, status: "pending",
      receivableCompanyId: parentCompanyId, payableCompanyId: child.nodeCompanyId, byName: ctx.user.name,
    }, id);
  } catch (e) {
    if (isConflict(e)) return (await base.get("cert_wallet_recharges", id))!;
    throw e;
  }
  const { createTitle } = await import("../finance");
  const notes: string[] = [];
  const parentName = parent?.name ?? "Intercert (plataforma)";
  let receivableTitleId: string | null = null;
  let payableTitleId: string | null = null;
  try {
    const pc = await companyCtx(ctx.store, parentCompanyId, ctx.user, ctx.ip);
    const cats = await ensureNetworkCategories(ctx.store, parentCompanyId);
    receivableTitleId = (await createTitle(pc, { kind: "receivable", partyType: "other", partyId: child.nodeCompanyId, partyName: child.name, description: `Recarga de créditos pré-pagos ${r.code} — ${child.name}`, originType: "cert_wallet_recharge", originId: r.id, categoryId: cats.prepaid_in, installments: [{ dueDate: due, amount }], idemKey: `cert_wallet_recharge:${r.id}:receivable` })).id;
  } catch (e: any) {
    notes.push(`A receber não lançado: ${e?.message ?? e}`);
  }
  try {
    const cc = await companyCtx(ctx.store, child.nodeCompanyId, ctx.user, ctx.ip);
    const cats = await ensureNetworkCategories(ctx.store, child.nodeCompanyId);
    payableTitleId = (await createTitle(cc, { kind: "payable", partyType: "other", partyId: parentCompanyId, partyName: parentName, description: `Recarga de créditos pré-pagos ${r.code} — ${parentName}`, originType: "cert_wallet_recharge", originId: r.id, categoryId: cats.prepaid_out, installments: [{ dueDate: due, amount }], idemKey: `cert_wallet_recharge:${r.id}:payable` })).id;
  } catch (e: any) {
    notes.push(`A pagar não lançado: ${e?.message ?? e}`);
  }
  r = await base.update("cert_wallet_recharges", r.id, { receivableTitleId, payableTitleId, financeNote: notes.join(" ").slice(0, 300) || null });
  await auditNode(ctx, child, { action: "network.wallet_recharge", summary: `Recarga ${r.code} de créditos pré-pagos de ${child.name}: ${formatMoney(amount)}, vencimento ${formatDate(due)}${notes.length ? ` (${notes.join(" ")})` : ""}`, after: { amount, dueDate: due }, related: [`cert_wallet_recharge:${r.id}`] });
  await notify(base, {
    companyId: isChild ? parentCompanyId : child.nodeCompanyId, type: "info", priority: "normal", title: `Recarga de créditos ${r.code} — ${formatMoney(amount)}`, body: isChild ? `${child.name} pediu recarga: confirme o recebimento em Rede › ${child.name} › Financeiro.` : `Título a pagar lançado com vencimento em ${formatDate(due)}. O crédito entra na carteira quando o pagamento for confirmado.`,
    link: isChild ? `/rede/${child.id}?tab=financeiro` : "/rede/minha/financeiro", originType: "cert_wallet_recharge", originId: r.id, occurrenceKey: `wallet-recharge:${r.id}`, audience: { action: isChild ? "network.billing" : "network.finance_view" },
  }).catch(() => 0);
  return r;
}

/**
 * Confirma o recebimento da recarga (pai ou plataforma): baixa o título a receber do pai na conta de recebimento e
 * credita a carteira — uma única vez (trava em `counters`). O título a pagar do filho é baixado pelo financeiro dele.
 */
export async function confirmRecharge(ctx: Ctx, rechargeId: string, input: { ref: string; accountId?: string | null; date?: string | null }): Promise<Doc> {
  const base = unscoped(ctx.store);
  const r = await base.get("cert_wallet_recharges", rechargeId);
  if (!r) throw new BusinessError("Recarga não encontrada.", "not_found");
  const child = await nodeOrThrow(ctx.store, r.childNodeId);
  if (!(await canBillChild(ctx, child))) throw new PermissionError("Somente o parceiro de cima (ou a plataforma) confirma o recebimento da recarga.");
  if (r.status === "paid") return r;
  if (r.status !== "pending") throw new BusinessError("Recarga cancelada.", "status");
  const ref = String(input.ref ?? "").trim();
  assert(ref, "Informe a referência do pagamento (Pix, comprovante, TED).");
  const date = input.date || today();
  const w = await base.get("cert_wallets", r.walletId);
  assert(w, "Carteira não encontrada.");
  const notes: string[] = r.financeNote ? [r.financeNote] : [];
  if (r.receivableTitleId && r.receivableCompanyId) {
    try {
      const pc = await companyCtx(ctx.store, r.receivableCompanyId, ctx.user, ctx.ip);
      const inst = await findOne(base, "installments", [["eq", "titleId", r.receivableTitleId]]);
      const accountId = input.accountId || (await receivingAccountId(ctx.store, r.receivableCompanyId));
      if (inst && inst.balance > 0 && accountId) {
        const { settleInstallment } = await import("../finance");
        await settleInstallment(pc, { installmentId: inst.id, date, principal: inst.balance, accountId, reference: ref, notes: `Recarga ${r.code}`, idemKey: `cert_wallet_recharge:${r.id}:settle` });
      } else if (!accountId) notes.push("Sem conta de recebimento: baixe o título a receber manualmente.");
    } catch (e: any) {
      notes.push(`Baixa do a receber não feita: ${e?.message ?? e}`);
    }
  }
  try {
    await base.transaction(async (tx) => {
      await tx.create("counters", { key: `once:recharge_confirm:${r.id}`, value: 1 }, detId("once", "recharge_confirm", r.id));
      await tx.update("cert_wallet_recharges", r.id, { status: "paid", confirmedAt: nowIso(), confirmedBy: ctx.user.id, confirmRef: ref, financeNote: notes.join(" ").slice(0, 300) || null });
      await tx.increment("cert_wallets", w!.id, "rechargeCount", 1);
      await walletMoveInTx(tx, w!, { kind: "recharge", balance: r.amount, held: 0, available: r.amount, rechargeId: r.id, reason: `Recarga ${r.code} · ${ref}`, userId: ctx.user.id, userName: ctx.user.name, date, moveId: detId("cert_wallet_move", w!.id, "recharge", r.id) });
    });
  } catch (e) {
    if (isConflict(e)) return (await base.get("cert_wallet_recharges", r.id))!;
    throw e;
  }
  await resolveOccurrence(base, `wallet-low:${w!.id}:${Number(w!.rechargeCount ?? 0)}`).catch(() => undefined);
  await auditNode(ctx, child, { action: "network.wallet_recharge_confirm", summary: `Recarga ${r.code} confirmada (${ref}): ${formatMoney(r.amount)} creditados na carteira de ${child.name}`, after: { amount: r.amount, ref }, related: [`cert_wallet_recharge:${r.id}`] });
  await notify(base, { companyId: child.nodeCompanyId, type: "info", priority: "normal", title: `Créditos liberados — ${formatMoney(r.amount)}`, body: `Recarga ${r.code} confirmada. Baixe o título a pagar no seu financeiro quando registrar o pagamento.`, link: "/rede/minha/financeiro", originType: "cert_wallet_recharge", originId: r.id, occurrenceKey: `wallet-recharge-paid:${r.id}`, audience: { action: "network.finance_view" } }).catch(() => 0);
  return (await base.get("cert_wallet_recharges", r.id))!;
}

/** Cancela uma recarga ainda não confirmada (cancela os títulos sem baixa). */
export async function cancelRecharge(ctx: Ctx, rechargeId: string, reason: string): Promise<Doc> {
  const base = unscoped(ctx.store);
  const r = await base.get("cert_wallet_recharges", rechargeId);
  if (!r) throw new BusinessError("Recarga não encontrada.", "not_found");
  const child = await nodeOrThrow(ctx.store, r.childNodeId);
  if (!(await canBillChild(ctx, child))) throw new PermissionError();
  if (r.status === "cancelled") return r;
  if (r.status !== "pending") throw new BusinessError("Recarga já confirmada: use um ajuste manual da carteira para corrigir.", "status");
  const why = String(reason ?? "").trim();
  assert(why.length >= 5, "Informe o motivo do cancelamento.");
  const { cancelTitle } = await import("../finance");
  const notes: string[] = [];
  for (const [titleId, companyId] of [[r.receivableTitleId, r.receivableCompanyId], [r.payableTitleId, r.payableCompanyId]] as const) {
    if (!titleId || !companyId) continue;
    try {
      await cancelTitle(await companyCtx(ctx.store, companyId, ctx.user, ctx.ip), titleId, `Recarga ${r.code} cancelada: ${why}`);
    } catch (e: any) {
      notes.push(e?.message ?? String(e));
    }
  }
  const after = await base.update("cert_wallet_recharges", r.id, { status: "cancelled", cancelledAt: nowIso(), cancelReason: why, financeNote: [r.financeNote, ...notes].filter(Boolean).join(" ").slice(0, 300) || null });
  await auditNode(ctx, child, { action: "network.wallet_recharge_cancel", reason: why, summary: `Recarga ${r.code} de ${child.name} cancelada${notes.length ? ` (${notes.join(" ")})` : ""}`, related: [`cert_wallet_recharge:${r.id}`] });
  return after;
}

export async function walletRecharges(store: Store, walletId: string): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_wallet_recharges", { filters: [["eq", "walletId", walletId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 2000);
}

/** Aviso de saldo pré-pago baixo (rotina diária; idempotente por carteira e recarga). */
export async function notifyLowBalances(store: Store, companyId: string, ref = today()): Promise<{ alerts: number }> {
  const base = unscoped(store);
  const wallets = await listAll(base, "cert_wallets", { filters: [["eq", "childCompanyId", companyId]] });
  if (!wallets.length) return { alerts: 0 };
  const [agreements, nodes] = await Promise.all([allAgreements(store), allNodes(store)]);
  let alerts = 0;
  for (const w of wallets) {
    const node = nodes.find((n) => n.id === w.childNodeId);
    if (!node || (node.parentNodeId ?? null) !== (w.parentNodeId ?? null)) continue;
    const t = resolveAgreement(agreements, node, ref).terms;
    if (t.mode !== "prepaid" || t.lowBalanceAlert <= 0 || Number(w.available) >= t.lowBalanceAlert) continue;
    const key = `wallet-low:${w.id}:${Number(w.rechargeCount ?? 0)}`;
    const body = `Disponível ${formatMoney(Number(w.available))} (aviso abaixo de ${formatMoney(t.lowBalanceAlert)}). ${t.overdraftLimit > 0 ? `Negativo permitido até ${formatMoney(t.overdraftLimit)}.` : "Sem saldo, novas vendas ficam bloqueadas."}`;
    alerts += await notify(base, { companyId: node.nodeCompanyId, type: "info", priority: "high", title: `Saldo de créditos baixo — ${node.name}`, body, link: "/rede/minha/financeiro", originType: "cert_wallet", originId: w.id, occurrenceKey: key, audience: { action: "network.finance_view" } }).catch(() => 0);
    if (w.parentCompanyId) alerts += await notify(base, { companyId: w.parentCompanyId, type: "info", priority: "normal", title: `Saldo de créditos baixo — ${node.name}`, body, link: `/rede/${node.id}?tab=financeiro`, originType: "cert_wallet", originId: w.id, occurrenceKey: key, audience: { action: "network.billing" } }).catch(() => 0);
  }
  return { alerts };
}
