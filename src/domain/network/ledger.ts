import { detId, findOne, isConflict, listAll } from "@/lib/db";
import { ConflictError, type Doc, type Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import type { Ctx, CtxUser } from "@/lib/core/ctx";
import { nextNumber } from "@/lib/core/numbering";
import { notify } from "@/lib/core/notify";
import { addDays, formatDate, nowIso, toLocalDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { certificationSettings } from "../accounting/certificates";
import { NETWORK_SCOPE, allNodes, isPlatform, networkSettings } from "./common";
import { closingCutoff, nextClosingDay, planSale, relationKeyOf, type AgreementTerms, type Party, type PlanFlow, type PlanSnapshot, type SalePlan } from "./billing-plan";
import { SYSTEM_USER, allAgreements, companyCtx, ensureNetworkCategories, ensureWallet, receivingAccountId, resolveAgreement, walletIdOf, walletMoveInTx, type NetworkCategoryKey } from "./billing";
import type { CascadeSnapshot } from "./cascade";

/**
 * Lançamentos em camadas (§46) — a partir do plano de liquidação de cada venda (./billing-plan.ts):
 *
 *  - ABERTURA da venda (na mesma transação da venda): plano gravado (`cert_sale_finance`) e reserva atômica do custo na
 *    carteira pré-paga de cada relação pré-paga (limite do disponível; sem saldo, a venda é recusada). Depois, o título
 *    A RECEBER do cliente final na empresa de quem cobra.
 *  - PAGAMENTO confirmado: baixa do título do cliente; débito da reserva na carteira; lançamento "acumulado" para o
 *    fechamento (pós-pago, comissão por período, custo AC, indicação); split: títulos já baixados nas duas pontas
 *    ("repasse do provedor", a conciliar com o extrato do provedor).
 *  - CANCELAMENTO antes do pagamento: libera as reservas e cancela o título do cliente.
 *  - ESTORNO da venda paga (plataforma, com motivo): cada lançamento recebe o inverso — carteira recreditada, estorno das
 *    baixas e cancelamento dos títulos do cliente e do split, e crédito negativo para o próximo fechamento do acumulado.
 *
 * Idempotência: cada lançamento tem id determinístico (venda + evento + fluxo); a carteira só se move junto com a
 * criação do registro do movimento (mesma transação, id determinístico) e reserva × liberação × débito passam por uma
 * trava única por venda e carteira. Falhas de lançamento (ex.: período financeiro fechado) não desfazem a venda: ficam
 * em `issues` e a rotina diária reprocessa.
 */

const financeId = (requestId: string) => detId("cert_sale_finance", requestId);
const entryId = (requestId: string, event: string, key: string) => detId("cert_fin_entry", requestId, event, key);

export async function saleFinance(store: Store, requestId: string): Promise<Doc | null> {
  return unscoped(store).get("cert_sale_finance", financeId(requestId));
}

// --------------------------------------------------------------------------------------------------------- plano

/** Monta o plano de liquidação de uma venda com as modalidades vigentes na data. */
export async function buildSalePlan(store: Store, snapshot: CascadeSnapshot, opts: { referrer?: { nodeId: string; name: string } | null; date?: string } = {}): Promise<SalePlan> {
  const date = opts.date ?? today();
  const [agreements, nodes, settings] = await Promise.all([allAgreements(store), allNodes(store), certificationSettings(store)]);
  const product = settings.catalog.find((p) => p.key === snapshot.productKey);
  const termsOf = (nodeId: string): AgreementTerms => {
    const n = nodes.find((x) => x.id === nodeId);
    return resolveAgreement(agreements, n ?? { id: nodeId, parentNodeId: null }, date).terms;
  };
  const supplier = product?.supplier === "serpro" ? "Serpro (AC de 1º nível)" : product?.supplier === "soluti" ? "Soluti (AC de 1º nível)" : "AC de 1º nível";
  return planSale(snapshot as unknown as PlanSnapshot, { termsOf, supplier, referrer: opts.referrer ?? null });
}

const walletFlows = (plan: SalePlan) => plan.flows.filter((f) => f.settlement === "wallet" && f.payer.type === "node");

/** Antes da transação da venda: garante as carteiras e confere o saldo (mensagem clara; o limite atômico vem na transação). */
export async function prepareSaleFinance(store: Store, plan: SalePlan, sellerNodeId: string): Promise<void> {
  const base = unscoped(store);
  for (const f of walletFlows(plan)) {
    const node = await base.get("cert_network_nodes", f.payer.nodeId!);
    if (!node) continue;
    const w = await ensureWallet(store, node);
    if (Number(w.available) - f.amount < -(f.overdraftLimit ?? 0)) {
      const mine = node.id === sellerNodeId;
      throw new BusinessError(
        mine
          ? `Saldo de créditos pré-pagos insuficiente para esta venda: disponível ${formatMoney(Number(w.available))}, custo ${formatMoney(f.amount)}. Recarregue os créditos com o parceiro acima.`
          : "Venda bloqueada: um parceiro acima de você está sem saldo de créditos pré-pagos com o nível de cima. Fale com o parceiro acima.",
        "wallet_insufficient",
      );
    }
  }
}

/** Dentro da transação da venda: grava o plano e reserva o custo nas carteiras pré-pagas (limite atômico). */
export async function saleFinanceInTx(tx: Store, input: { request: { id: string; companyId: string; protocol: string; productKey: string; productLabel: string; sellerNodeId: string }; pathNodeIds: string[]; plan: SalePlan; collectorCompanyId: string | null; referrer?: { nodeId: string; name: string } | null; userId: string; userName: string }): Promise<void> {
  const { request: r, plan } = input;
  await tx.create("cert_sale_finance", {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: input.userId, requestId: r.id, requestCompanyId: r.companyId, protocol: r.protocol, productKey: r.productKey, productLabel: r.productLabel, sellerNodeId: r.sellerNodeId,
    pathNodeIds: input.pathNodeIds, collectorNodeId: plan.collectorNodeId, collectorCompanyId: input.collectorCompanyId, finalPrice: plan.finalPrice, plan, status: "open", clientTitleId: null,
    referrerNodeId: input.referrer?.nodeId ?? null, referrerName: input.referrer?.name ?? null, openedAt: nowIso(), paidDate: null, issues: [],
  }, financeId(r.id));
  for (const f of walletFlows(plan)) {
    const wid = walletIdOf(f.payer.nodeId!, f.payee.type === "node" ? f.payee.nodeId : null);
    await walletMoveInTx(tx, { id: wid }, { kind: "hold", balance: 0, held: f.amount, available: -f.amount, minAvailable: -(f.overdraftLimit ?? 0), requestId: r.id, protocol: r.protocol, reason: `Venda ${r.protocol} — ${r.productLabel}`, userId: input.userId, userName: input.userName, moveId: detId("cert_wallet_move", wid, r.id, "hold") });
  }
}

/** Mensagem de conflito da reserva na carteira (transação da venda). */
export function walletConflictMessage(e: ConflictError): string | null {
  return e.collection === "cert_wallets" ? "Saldo de créditos pré-pagos insuficiente agora há pouco (outra venda usou o saldo). Recarregue os créditos ou tente de novo." : null;
}

// ------------------------------------------------------------------------------------------------------ utilidades

async function addIssue(store: Store, requestId: string, issue: string) {
  const base = unscoped(store);
  const fin = await base.get("cert_sale_finance", financeId(requestId));
  if (!fin) return;
  const issues: string[] = Array.isArray(fin.issues) ? fin.issues : [];
  if (!issues.includes(issue)) await base.update("cert_sale_finance", fin.id, { issues: [...issues, issue].slice(-20) }).catch(() => undefined);
}

async function clearIssues(store: Store, requestId: string) {
  await unscoped(store).update("cert_sale_finance", financeId(requestId), { issues: [] }).catch(() => undefined);
}

const partyLabel = (p: Party) => p.name;

interface Resolved {
  payerCompanyId: string | null;
  payeeCompanyId: string | null;
}

async function resolveCompanies(store: Store, f: PlanFlow, nodes: Doc[], platformCompanyId: string | null, collectorCompanyId: string | null): Promise<Resolved> {
  const of = (p: Party) => (p.type === "platform" ? platformCompanyId : p.type === "node" ? nodes.find((n) => n.id === p.nodeId)?.nodeCompanyId ?? null : null);
  return { payerCompanyId: f.kind === "client" ? null : of(f.payer), payeeCompanyId: f.kind === "client" ? collectorCompanyId : of(f.payee) };
}

/** Data local (AAAA-MM-DD) de um instante ou data. */
const localDate = (v: string | null | undefined) => (!v ? today() : v.length === 10 ? v : toLocalDate(v));

/** Categoria de cada ponta por tipo de fluxo. */
function categoriesOf(kind: string): { payer: NetworkCategoryKey | null; payee: NetworkCategoryKey | null } {
  switch (kind) {
    case "cost": return { payer: "cost_up", payee: "child_sale" };
    case "commission": case "referral": return { payer: "commission_out", payee: "commission_in" };
    case "ac_cost": return { payer: "ac_cost", payee: null };
    default: return { payer: null, payee: "client_sale" };
  }
}

const KIND_LABEL: Record<string, string> = { client: "Venda ao cliente final", cost: "Custo do certificado (nível acima)", commission: "Comissão da rede", ac_cost: "Custo AC (fornecedor)", referral: "Comissão de indicação" };
export const FIN_KIND_LABEL = KIND_LABEL;
export const FIN_SETTLEMENT_LABEL: Record<string, string> = { charge: "Cobrança do cliente", wallet: "Carteira pré-paga", accrual: "Fechamento do período", split: "Split no pagamento (a conciliar)", covered: "Coberto por voucher" };
export const FIN_STATUS_LABEL: Record<string, string> = { accrued: "A fechar", closed: "Fechado", wallet: "Debitado da carteira", split: "Split (a conciliar)", covered: "Voucher", client: "Cliente" };

// -------------------------------------------------------------------------------------------------- abertura (título)

/**
 * Depois da venda gravada: título A RECEBER do cliente final na empresa de quem cobra (idempotente). Venda sem cobrança
 * (voucher presente, gratuita) segue direto para o pagamento.
 */
export async function afterSaleOpened(ctx: Ctx, request: Doc): Promise<void> {
  const fin = await saleFinance(ctx.store, request.id);
  if (!fin) return;
  const plan = fin.plan as SalePlan;
  const client = plan.flows.find((f) => f.kind === "client");
  if (client && client.amount > 0 && request.status === "awaiting_payment") {
    if (!fin.collectorCompanyId) {
      await addIssue(ctx.store, request.id, "Quem cobra o cliente é a plataforma, mas a empresa da Intercert não está definida em Rede › Parâmetros: título do cliente não lançado.");
    } else {
      try {
        const cc = await companyCtx(ctx.store, fin.collectorCompanyId, ctx.user, ctx.ip);
        const cats = await ensureNetworkCategories(ctx.store, fin.collectorCompanyId);
        const { createTitle } = await import("../finance");
        const t = await createTitle(cc, {
          kind: "receivable", partyType: "other", partyId: request.clientId ?? null, partyName: request.holderName, description: `Certificado ${request.protocol} — ${request.productLabel} — ${request.holderName}`, documentNumber: request.protocol,
          originType: "certificate_request", originId: request.id, categoryId: cats.client_sale, installments: [{ dueDate: request.dueDate && request.dueDate >= today() ? request.dueDate : today(), amount: client.amount }], idemKey: `cert_sale:${request.id}:client`,
        });
        await unscoped(ctx.store).update("cert_sale_finance", fin.id, { clientTitleId: t.id });
      } catch (e: any) {
        await addIssue(ctx.store, request.id, `Título do cliente não lançado: ${e?.message ?? e}`);
      }
    }
  }
  if (request.status !== "awaiting_payment" && request.status !== "cancelled") await onSalePaid(ctx, request);
}

// ------------------------------------------------------------------------------------------------------- pagamento

/** Pagamento confirmado (ou venda sem cobrança): lançamentos de todas as camadas (idempotente; seguro repetir). */
export async function onSalePaid(ctx: Ctx, request: Doc): Promise<{ posted: number; issues: string[] }> {
  const base = unscoped(ctx.store);
  const fin = await saleFinance(ctx.store, request.id);
  if (!fin || fin.status === "reversed" || fin.status === "cancelled") return { posted: 0, issues: [] };
  const plan = fin.plan as SalePlan;
  const paidDate = localDate(request.paymentConfirmedAt);
  if (fin.status !== "paid") await base.update("cert_sale_finance", fin.id, { status: "paid", paidDate });
  const [nodes, settings] = await Promise.all([allNodes(ctx.store), networkSettings(ctx.store)]);
  const issues: string[] = [];
  let posted = 0;
  const user = ctx.user;
  for (const f of plan.flows) {
    try {
      posted += (await postPaidFlow(ctx, request, fin, f, paidDate, nodes, settings.platformCompanyId, user)) ? 1 : 0;
    } catch (e: any) {
      issues.push(`${KIND_LABEL[f.kind] ?? f.kind} (${partyLabel(f.payer)} → ${partyLabel(f.payee)}): ${e?.message ?? e}`);
    }
  }
  if (issues.length) for (const i of issues) await addIssue(ctx.store, request.id, i);
  else if ((fin.issues ?? []).length) await clearIssues(ctx.store, request.id);
  return { posted, issues };
}

function entryData(request: Doc, fin: Doc, f: PlanFlow, event: string, amount: number, date: string, status: string, rc: Resolved, extra: Record<string, any> = {}) {
  return {
    companyId: NETWORK_SCOPE, branchId: null, createdBy: null, requestId: request.id, requestCompanyId: request.companyId, protocol: request.protocol, productKey: fin.productKey, productLabel: fin.productLabel, event, kind: f.kind, settlement: f.settlement,
    amount, flowKey: f.key, payerType: f.payer.type, payerNodeId: f.payer.nodeId, payerCompanyId: rc.payerCompanyId, payerName: f.payer.name, payeeType: f.payee.type, payeeNodeId: f.payee.nodeId, payeeCompanyId: rc.payeeCompanyId, payeeName: f.payee.name,
    relationKey: relationKeyOf(f), agreementNodeId: f.agreementNodeId, date, status, closingId: null, titleIds: null, reconcile: f.settlement === "split" ? "pending" : null, note: f.note ?? null, ...extra,
  };
}

async function createOnce(store: Store, collection: string, id: string, data: Record<string, any>): Promise<boolean> {
  try {
    await unscoped(store).create(collection, data, id);
    return true;
  } catch (e) {
    if (isConflict(e)) return false;
    throw e;
  }
}

async function postPaidFlow(ctx: Ctx, request: Doc, fin: Doc, f: PlanFlow, date: string, nodes: Doc[], platformCompanyId: string | null, user: CtxUser): Promise<boolean> {
  const base = unscoped(ctx.store);
  const id = entryId(request.id, "paid", f.key);
  const existing = await base.get("cert_fin_entries", id);
  const rc = await resolveCompanies(ctx.store, f, nodes, platformCompanyId, fin.collectorCompanyId ?? null);
  switch (f.settlement) {
    case "charge": {
      if (fin.clientTitleId && fin.collectorCompanyId) await settleTitle(ctx, fin.collectorCompanyId, fin.clientTitleId, { date, ref: request.paymentRef ?? request.protocol, idem: `cert_sale:${request.id}:client:settle`, user });
      if (existing) return false;
      return createOnce(ctx.store, "cert_fin_entries", id, entryData(request, fin, f, "paid", f.amount, date, "client", rc, { titleIds: fin.clientTitleId ? [fin.clientTitleId] : null }));
    }
    case "wallet": {
      if (existing) return false;
      const wid = walletIdOf(f.payer.nodeId!, f.payee.type === "node" ? f.payee.nodeId : null);
      const hold = await base.get("cert_wallet_moves", detId("cert_wallet_move", wid, request.id, "hold"));
      try {
        await base.transaction(async (tx) => {
          await tx.create("cert_fin_entries", entryData(request, fin, f, "paid", f.amount, date, "wallet", rc), id);
          if (hold) {
            // fim da reserva: débito OU liberação, uma única vez
            await tx.create("counters", { key: `once:wallet_hold_end:${wid}:${request.id}`, value: 1 }, detId("once", "wallet_hold_end", wid, request.id));
            await walletMoveInTx(tx, { id: wid }, { kind: "debit", balance: -f.amount, held: -f.amount, available: 0, requestId: request.id, protocol: request.protocol, reason: `Venda ${request.protocol} paga — ${request.productLabel}`, userId: user.id, userName: user.name, date, moveId: detId("cert_wallet_move", wid, request.id, "debit") });
          } else {
            // sem reserva (venda anterior à modalidade): débito direto, sem limite (a venda já foi paga)
            await walletMoveInTx(tx, { id: wid }, { kind: "debit", balance: -f.amount, held: 0, available: -f.amount, requestId: request.id, protocol: request.protocol, reason: `Venda ${request.protocol} paga — ${request.productLabel}`, userId: user.id, userName: user.name, date, moveId: detId("cert_wallet_move", wid, request.id, "debit") });
          }
        });
      } catch (e) {
        if (isConflict(e)) return false;
        throw e;
      }
      return true;
    }
    case "accrual":
    case "covered": {
      if (existing) return false;
      return createOnce(ctx.store, "cert_fin_entries", id, entryData(request, fin, f, "paid", f.amount, date, f.settlement === "covered" ? "covered" : "accrued", rc));
    }
    case "split": {
      if (!rc.payerCompanyId || !rc.payeeCompanyId) throw new BusinessError("Empresa de uma das pontas não definida (a empresa da Intercert é configurada em Rede › Parâmetros).", "company");
      const titles = await splitTitles(ctx, request, f, rc, date, user);
      if (existing) return false;
      return createOnce(ctx.store, "cert_fin_entries", id, entryData(request, fin, f, "paid", f.amount, date, "split", rc, { titleIds: titles }));
    }
  }
  return false;
}

/** Baixa total de um título (idempotente pela chave). */
async function settleTitle(ctx: Ctx, companyId: string, titleId: string, input: { date: string; ref: string; idem: string; user: CtxUser; skipApproval?: boolean }) {
  const base = unscoped(ctx.store);
  const inst = await findOne(base, "installments", [["eq", "titleId", titleId]]);
  if (!inst) return;
  const sid = detId("settle", input.idem);
  if (await base.get("settlements", sid)) return;
  if (!(inst.balance > 0)) return;
  const accountId = await receivingAccountId(ctx.store, companyId);
  if (!accountId) throw new BusinessError("Empresa sem conta financeira ativa para a baixa.", "account");
  const { settleInstallment } = await import("../finance");
  const cc = await companyCtx(ctx.store, companyId, input.user, ctx.ip);
  await settleInstallment(cc, { installmentId: inst.id, date: input.date, principal: inst.balance, accountId, reference: input.ref.slice(0, 120), notes: "Rede de certificação", idemKey: input.idem, skipApprovalCheck: input.skipApproval });
}

/** Split: a pagar (já pago pelo provedor) na ponta que repassa e a receber (já recebido) na ponta que recebe — a conciliar. */
async function splitTitles(ctx: Ctx, request: Doc, f: PlanFlow, rc: Resolved, date: string, user: CtxUser): Promise<string[]> {
  const { createTitle } = await import("../finance");
  const cats = categoriesOf(f.kind);
  const ids: string[] = [];
  const desc = `${KIND_LABEL[f.kind]} — split ${request.protocol} (${request.productLabel})`;
  const pc = await companyCtx(ctx.store, rc.payerCompanyId!, user, ctx.ip);
  const pcats = await ensureNetworkCategories(ctx.store, rc.payerCompanyId!);
  const pay = await createTitle(pc, { kind: "payable", partyType: "other", partyName: f.payee.name, description: desc, documentNumber: request.protocol, originType: "cert_split", originId: request.id, competenceDate: date, issueDate: date <= today() ? date : today(), categoryId: cats.payer ? pcats[cats.payer] : null, approvalStatus: "approved", installments: [{ dueDate: date, amount: f.amount }], notes: "Repasse automático pelo provedor de split (Safe2Pay — etapa 6): conciliar com o extrato do provedor.", idemKey: `cert_split:${request.id}:${f.key}:payable` });
  ids.push(pay.id);
  await settleTitle(ctx, rc.payerCompanyId!, pay.id, { date, ref: `SPLIT ${request.protocol}`, idem: `cert_split:${request.id}:${f.key}:payable:settle`, user, skipApproval: true });
  const ec = await companyCtx(ctx.store, rc.payeeCompanyId!, user, ctx.ip);
  const ecats = await ensureNetworkCategories(ctx.store, rc.payeeCompanyId!);
  const rec = await createTitle(ec, { kind: "receivable", partyType: "other", partyName: f.payer.name, description: desc, documentNumber: request.protocol, originType: "cert_split", originId: request.id, competenceDate: date, issueDate: date <= today() ? date : today(), categoryId: cats.payee ? ecats[cats.payee] : null, installments: [{ dueDate: date, amount: f.amount }], notes: "Recebido pelo provedor de split (Safe2Pay — etapa 6): conciliar com o extrato do provedor.", idemKey: `cert_split:${request.id}:${f.key}:receivable` });
  ids.push(rec.id);
  await settleTitle(ctx, rc.payeeCompanyId!, rec.id, { date, ref: `SPLIT ${request.protocol}`, idem: `cert_split:${request.id}:${f.key}:receivable:settle`, user });
  return ids;
}

// ---------------------------------------------------------------------------------------- cancelamento antes do pagamento

/** Venda cancelada antes do pagamento: libera as reservas das carteiras e cancela o título do cliente (idempotente). */
export async function onSaleCancelledFinance(ctx: Ctx, request: Doc): Promise<void> {
  const base = unscoped(ctx.store);
  const fin = await saleFinance(ctx.store, request.id);
  if (!fin || fin.status === "paid" || fin.status === "reversed") return;
  const plan = fin.plan as SalePlan;
  for (const f of walletFlows(plan)) {
    const wid = walletIdOf(f.payer.nodeId!, f.payee.type === "node" ? f.payee.nodeId : null);
    if (!(await base.get("cert_wallet_moves", detId("cert_wallet_move", wid, request.id, "hold")))) continue;
    try {
      await base.transaction(async (tx) => {
        await tx.create("counters", { key: `once:wallet_hold_end:${wid}:${request.id}`, value: 1 }, detId("once", "wallet_hold_end", wid, request.id));
        await walletMoveInTx(tx, { id: wid }, { kind: "release", balance: 0, held: -f.amount, available: f.amount, requestId: request.id, protocol: request.protocol, reason: `Venda ${request.protocol} cancelada antes do pagamento`, userId: ctx.user.id, userName: ctx.user.name, moveId: detId("cert_wallet_move", wid, request.id, "release") });
      });
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  if (fin.clientTitleId && fin.collectorCompanyId) {
    try {
      const { cancelTitle } = await import("../finance");
      await cancelTitle(await companyCtx(ctx.store, fin.collectorCompanyId, ctx.user, ctx.ip), fin.clientTitleId, `Venda ${request.protocol} cancelada: ${request.cancelReason ?? ""}`.trim());
    } catch (e: any) {
      await addIssue(ctx.store, request.id, `Título do cliente não cancelado: ${e?.message ?? e}`);
    }
  }
  await base.update("cert_sale_finance", fin.id, { status: "cancelled" });
}

// ---------------------------------------------------------------------------------------------- estorno da venda paga

const REVERSIBLE = ["validation", "ready_to_issue", "issue_failed"];

/**
 * Estorno de venda PAGA (cancelamento após o pagamento — plataforma ou equipe de certificação, com motivo): a venda vai
 * a "cancelada" e TODOS os lançamentos das camadas são revertidos em cascata. Só antes da emissão (depois de emitido,
 * a revogação é com a AC). Idempotente.
 */
export async function reverseNetworkSale(ctx: Ctx, requestId: string, input: { reason: string }): Promise<Doc> {
  if (!isPlatform(ctx) && !canDo(ctx.user, "certification.operate")) throw new PermissionError("O estorno de venda paga é feito pela plataforma Intercert ou pela equipe de certificação.");
  const base = unscoped(ctx.store);
  const r = await base.get("certificate_requests", requestId);
  if (!r) throw new BusinessError("Venda não encontrada.", "not_found");
  const reason = String(input.reason ?? "").trim();
  assert(reason.length >= 10, "Informe o motivo do estorno (ao menos 10 caracteres).");
  if (r.reversedAt) {
    await reverseFinance(ctx, r, r.reversalReason ?? reason);
    return r;
  }
  if (!REVERSIBLE.includes(r.status) || !r.paymentConfirmedAt) throw new BusinessError(r.status === "awaiting_payment" ? "Venda ainda não paga: use o cancelamento." : "O estorno só é possível com o pagamento confirmado e antes da emissão do certificado.", "status");
  try {
    await base.create("counters", { key: `once:sale_reversal:${r.id}`, value: 1 }, detId("once", "sale_reversal", r.id));
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
  const after = await base.update("certificate_requests", r.id, { status: "cancelled", cancelledAt: nowIso(), cancelledBy: ctx.user.id, cancelReason: `Estorno após o pagamento: ${reason}`, reversedAt: nowIso(), reversedBy: ctx.user.id, reversalReason: reason });
  await reverseFinance(ctx, after, reason);
  // voucher, cupom e BirdID gratuito (mesma liberação do cancelamento)
  const { onSaleCancelled } = await import("./sales");
  await onSaleCancelled(ctx, after);
  await base.create("audit_logs", {
    companyId: r.companyId, branchId: null, userId: ctx.user.id, userName: ctx.user.name, userRole: ctx.companyId === r.companyId ? (ctx.user.roleName ?? null) : "Plataforma Intercert (rede)", module: "admin", action: "network.sale_paid_reversal",
    entityType: "certificate_request", entityId: r.id, summary: `Estorno da venda paga ${r.protocol} (${formatMoney(r.amount)}): lançamentos de todas as camadas revertidos`, before: { status: r.status }, after: { status: "cancelled" }, reason, result: "success", ip: ctx.ip ?? null, occurredAt: nowIso(), operationId: null, related: [`certificate_request:${r.id}`],
  }).catch(() => undefined);
  if (ctx.companyId !== r.companyId) await audit(ctx, { module: "admin", action: "network.sale_paid_reversal", entityType: "certificate_request", entityId: r.id, summary: `Estorno da venda paga ${r.protocol} de outra empresa da rede`, reason });
  await notify(base, { companyId: r.companyId, type: "info", priority: "high", title: `Venda ${r.protocol} estornada após o pagamento`, body: `${reason}. Os lançamentos de todas as camadas foram revertidos (devolução ao cliente pela empresa que cobrou).`, link: `/rede/vendas/${r.id}`, originType: "certificate_request", originId: r.id, occurrenceKey: `cert-reversal:${r.id}`, audience: { action: "network.sales_all" } }).catch(() => 0);
  return after;
}

async function reverseFinance(ctx: Ctx, r: Doc, reason: string): Promise<void> {
  const base = unscoped(ctx.store);
  const fin = await saleFinance(ctx.store, r.id);
  if (!fin) return;
  const paid = (await listAll(base, "cert_fin_entries", { filters: [["eq", "requestId", r.id]] })).filter((e) => e.event === "paid");
  const date = today();
  const user = ctx.user;
  const issues: string[] = [];
  const { cancelTitle, reverseSettlement } = await import("../finance");
  const undoTitle = async (companyId: string, titleId: string) => {
    const cc = await companyCtx(ctx.store, companyId, user, ctx.ip);
    for (const s of await listAll(base, "settlements", { filters: [["eq", "titleId", titleId], ["eq", "status", "active"], ["eq", "kind", "settlement"]] })) await reverseSettlement(cc, s.id, `Estorno da venda ${r.protocol}: ${reason}`);
    await cancelTitle(cc, titleId, `Estorno da venda ${r.protocol}: ${reason}`);
  };
  for (const e of paid) {
    const id = entryId(r.id, "reversal", e.flowKey);
    if (await base.get("cert_fin_entries", id)) continue;
    const data = { ...e, id: undefined, createdAt: undefined, updatedAt: undefined, event: "reversal", amount: -Number(e.amount), date, closingId: null, note: `Estorno: ${reason}`.slice(0, 300) };
    delete (data as any).id;
    delete (data as any).createdAt;
    delete (data as any).updatedAt;
    try {
      if (e.settlement === "wallet") {
        const wid = walletIdOf(e.payerNodeId, e.payeeType === "node" ? e.payeeNodeId : null);
        await base.transaction(async (tx) => {
          await tx.create("cert_fin_entries", { ...data, status: "wallet" }, id);
          await walletMoveInTx(tx, { id: wid }, { kind: "reversal", balance: Number(e.amount), held: 0, available: Number(e.amount), requestId: r.id, protocol: r.protocol, reason: `Estorno da venda ${r.protocol}: ${reason}`.slice(0, 300), userId: user.id, userName: user.name, date, moveId: detId("cert_wallet_move", wid, r.id, "reversal") });
        });
        continue;
      }
      if ((e.settlement === "charge" || e.settlement === "split") && Array.isArray(e.titleIds)) {
        for (const tid of e.titleIds as string[]) {
          const t = await base.get("titles", tid);
          if (t && t.status !== "cancelled") await undoTitle(t.companyId, t.id);
        }
      }
      // acumulado: crédito negativo — entra no mesmo fechamento (se ainda aberto) ou no próximo
      await createOnce(ctx.store, "cert_fin_entries", id, { ...data, status: e.settlement === "accrual" ? "accrued" : e.status === "closed" ? "accrued" : e.status });
    } catch (err: any) {
      if (isConflict(err)) continue;
      issues.push(`Estorno de ${KIND_LABEL[e.kind] ?? e.kind} (${e.payerName} → ${e.payeeName}): ${err?.message ?? err}`);
    }
  }
  // título do cliente ainda não baixado (sem lançamento "client"): cancela
  if (fin.clientTitleId && fin.collectorCompanyId && !paid.some((e) => e.kind === "client")) {
    try {
      const t = await base.get("titles", fin.clientTitleId);
      if (t && t.status !== "cancelled") await undoTitle(fin.collectorCompanyId, t.id);
    } catch (err: any) {
      issues.push(`Título do cliente: ${err?.message ?? err}`);
    }
  }
  // reservas que não viraram débito (pagamento não processado): liberadas
  const plan = fin.plan as SalePlan;
  for (const f of walletFlows(plan)) {
    const wid = walletIdOf(f.payer.nodeId!, f.payee.type === "node" ? f.payee.nodeId : null);
    if (!(await base.get("cert_wallet_moves", detId("cert_wallet_move", wid, r.id, "hold")))) continue;
    try {
      await base.transaction(async (tx) => {
        await tx.create("counters", { key: `once:wallet_hold_end:${wid}:${r.id}`, value: 1 }, detId("once", "wallet_hold_end", wid, r.id));
        await walletMoveInTx(tx, { id: wid }, { kind: "release", balance: 0, held: -f.amount, available: f.amount, requestId: r.id, protocol: r.protocol, reason: `Venda ${r.protocol} estornada antes do débito`, userId: user.id, userName: user.name, moveId: detId("cert_wallet_move", wid, r.id, "release") });
      });
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  }
  await base.update("cert_sale_finance", fin.id, { status: "reversed", reversedAt: nowIso(), reversalReason: reason.slice(0, 300), issues: issues.length ? issues : [] });
}

/** Reprocessa os lançamentos de uma venda (pendências: período fechado, empresa da plataforma definida depois…). */
export async function reprocessSaleFinance(ctx: Ctx, requestId: string): Promise<{ posted: number; issues: string[] }> {
  const base = unscoped(ctx.store);
  const r = await base.get("certificate_requests", requestId);
  const fin = await saleFinance(ctx.store, requestId);
  if (!r || !fin) return { posted: 0, issues: [] };
  if (fin.status === "reversed") {
    await reverseFinance(ctx, r, fin.reversalReason ?? "estorno");
    return { posted: 0, issues: (await saleFinance(ctx.store, requestId))?.issues ?? [] };
  }
  if (r.status === "cancelled" && !r.reversedAt) {
    await onSaleCancelledFinance(ctx, r);
    return { posted: 0, issues: [] };
  }
  if (!fin.clientTitleId && r.status === "awaiting_payment") {
    await clearIssues(ctx.store, requestId);
    await afterSaleOpened(ctx, r);
  }
  if (r.paymentConfirmedAt) return onSalePaid(ctx, r);
  return { posted: 0, issues: [] };
}

// --------------------------------------------------------------------------------------------------------- fechamentos

const padClosing = (n: number) => `FC-${String(n).padStart(5, "0")}`;
const LOCK_TTL_S = 600;

/** Termos de período de uma relação: modalidade do nó da relação; custo AC: parâmetro da plataforma (mensal). */
export async function relationTerms(store: Store, agreementNodeId: string | null, kind: string, ref = today()): Promise<{ period: AgreementTerms["period"]; weekday: number; monthDay: number; dueDays: number }> {
  if (kind === "ac_cost" || !agreementNodeId) {
    const s = await networkSettings(store);
    return { period: "monthly", weekday: 1, monthDay: s.acClosingDay, dueDays: s.acDueDays };
  }
  const [agreements, nodes] = await Promise.all([allAgreements(store), allNodes(store)]);
  const node = nodes.find((n) => n.id === agreementNodeId);
  return resolveAgreement(agreements, node ?? { id: agreementNodeId, parentNodeId: null }, ref).terms;
}

async function withRelationLock<R>(store: Store, relationKey: string, fn: () => Promise<R>): Promise<R> {
  const base = unscoped(store);
  const id = detId("cert_closing_lock", relationKey);
  const now = Math.floor(Date.now() / 1000);
  try {
    await base.create("counters", { key: `lock:closing:${relationKey}`.slice(0, 200), value: now }, id);
  } catch (e) {
    if (!isConflict(e)) throw e;
    const cur = await base.get("counters", id);
    if (cur && now - Number(cur.value ?? 0) < LOCK_TTL_S) throw new BusinessError("Outro fechamento desta relação está em andamento. Tente de novo em instantes.", "closing_busy");
    await base.delete("counters", id).catch(() => undefined);
    await base.create("counters", { key: `lock:closing:${relationKey}`.slice(0, 200), value: now }, id);
  }
  try {
    return await fn();
  } finally {
    await base.delete("counters", id).catch(() => undefined);
  }
}

export interface ClosingPreview {
  relationKey: string;
  entries: Doc[];
  total: number;
  cutoff: string;
  nextClosing: string | null;
}

/** Prévia do fechamento: lançamentos acumulados até o corte (padrão: hoje). */
export async function relationPreview(store: Store, relationKey: string, cutoff = today()): Promise<ClosingPreview> {
  const entries = (await listAll(unscoped(store), "cert_fin_entries", { filters: [["eq", "relationKey", relationKey], ["eq", "status", "accrued"]] })).filter((e) => String(e.date) <= cutoff).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = entries[0];
  const terms = first ? await relationTerms(store, first.agreementNodeId ?? null, first.kind) : null;
  return { relationKey, entries, total: entries.reduce((a, e) => a + Number(e.amount), 0), cutoff, nextClosing: terms ? nextClosingDay(terms, today()) : null };
}

/**
 * Fecha uma relação até o corte: UM título (a pagar de quem deve / a receber de quem recebe) com o extrato dos
 * lançamentos acumulados. Idempotente por relação + corte; trava por relação contra fechamentos simultâneos. Saldo
 * negativo (estornos maiores que as vendas) não gera título: o crédito fica para o próximo fechamento.
 */
export async function closeRelation(ctx: Ctx, relationKey: string, cutoff: string, opts: { manual?: boolean } = {}): Promise<{ closing: Doc | null; carried: number | null }> {
  return withRelationLock(ctx.store, relationKey, async () => {
    const base = unscoped(ctx.store);
    // fechamento interrompido (queda no meio): retoma antes de qualquer outro
    let closing: Doc | null = (await listAll(base, "cert_closings", { filters: [["eq", "relationKey", relationKey]] })).find((c) => c.status === "closing") ?? null;
    if (!closing) {
      const { entries, total } = await relationPreview(ctx.store, relationKey, cutoff);
      if (!entries.length) return { closing: null, carried: null };
      if (total < 0) return { closing: null, carried: total };
      // id determinístico pelo conjunto (relação + corte + primeiro lançamento): a repetição do mesmo fechamento é única
      const closingId = detId("cert_closing", relationKey, cutoff, entries.map((e) => e.id).sort()[0]);
      const e0 = entries[0];
      const terms = await relationTerms(ctx.store, e0.agreementNodeId ?? null, e0.kind);
      const prev = (await listAll(base, "cert_closings", { filters: [["eq", "relationKey", relationKey]] })).filter((c) => String(c.periodTo) < cutoff).sort((a, b) => String(b.periodTo).localeCompare(String(a.periodTo)))[0];
      const seq = await nextNumber(base, "cert_closing");
      try {
        closing = await base.create("cert_closings", {
          companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, code: padClosing(seq), relationKey, kind: e0.kind, payerType: e0.payerType, payerNodeId: e0.payerNodeId, payerCompanyId: e0.payerCompanyId, payerName: e0.payerName,
          payeeType: e0.payeeType, payeeNodeId: e0.payeeNodeId, payeeCompanyId: e0.payeeCompanyId, payeeName: e0.payeeName, agreementNodeId: e0.agreementNodeId ?? null,
          periodFrom: prev ? addDays(prev.periodTo, 1) : String(entries[0].date), periodTo: cutoff, closedAt: nowIso(), dueDate: addDays(today(), terms.dueDays), total, count: entries.length, entryIds: entries.map((e) => e.id),
          status: "closing", manual: Boolean(opts.manual), byName: ctx.user.name, notes: null,
        }, closingId);
      } catch (e) {
        if (!isConflict(e)) throw e;
        closing = (await base.get("cert_closings", closingId))!;
      }
    }
    if (closing.status === "closed" || closing.status === "pending_titles") return { closing: closing.status === "closed" ? closing : await closingTitles(ctx, closing), carried: null };
    // marca os lançamentos (em lotes) — repetição retoma de onde parou
    const ids: string[] = closing.entryIds ?? [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      await base.transaction(async (tx) => {
        for (const id of chunk) await tx.update("cert_fin_entries", id, { status: "closed", closingId: closing!.id });
      });
    }
    closing = await closingTitles(ctx, closing);
    return { closing, carried: null };
  });
}

/** Títulos do fechamento nas duas pontas (idempotentes); período financeiro fechado: competência de hoje, com nota. */
async function closingTitles(ctx: Ctx, closing: Doc): Promise<Doc> {
  const base = unscoped(ctx.store);
  const { createTitle } = await import("../finance");
  const settings = await networkSettings(ctx.store);
  const companyOf = (type: string, companyId: string | null) => (type === "platform" ? companyId ?? settings.platformCompanyId : companyId);
  const payerCompany = companyOf(closing.payerType, closing.payerCompanyId);
  const payeeCompany = closing.payeeType === "supplier" ? null : companyOf(closing.payeeType, closing.payeeCompanyId);
  const cats = categoriesOf(closing.kind);
  const notes: string[] = [];
  const total = Number(closing.total);
  const period = `${formatDate(closing.periodFrom)} a ${formatDate(closing.periodTo)}`;
  const desc = `Fechamento ${closing.code} — ${KIND_LABEL[closing.kind] ?? closing.kind} — ${period}`;
  const make = async (kind: "payable" | "receivable", companyId: string, partyName: string, cat: NetworkCategoryKey | null) => {
    const cc = await companyCtx(ctx.store, companyId, ctx.user, ctx.ip);
    const c = await ensureNetworkCategories(ctx.store, companyId);
    const input = { kind, partyType: kind === "payable" && closing.payeeType === "supplier" ? ("supplier" as const) : ("other" as const), partyName, description: desc, documentNumber: closing.code, originType: "cert_closing", originId: closing.id, categoryId: cat ? c[cat] : null, installments: [{ dueDate: closing.dueDate, amount: total }], notes: `Rede de certificação — ${closing.count} lançamento(s); extrato em /rede/fechamentos/${closing.id}`, idemKey: `cert_closing:${closing.id}:${kind}` };
    try {
      return (await createTitle(cc, { ...input, competenceDate: closing.periodTo })).id;
    } catch (e: any) {
      if (e?.code !== "period_closed" && !/fechado/i.test(String(e?.message))) throw e;
      notes.push(`Período de ${formatDate(closing.periodTo)} fechado na empresa: competência em ${formatDate(today())}.`);
      return (await createTitle(cc, { ...input, competenceDate: today() })).id;
    }
  };
  let payableTitleId: string | null = closing.payableTitleId ?? null;
  let receivableTitleId: string | null = closing.receivableTitleId ?? null;
  if (total > 0) {
    try {
      if (!payableTitleId && payerCompany) payableTitleId = await make("payable", payerCompany, closing.payeeName, cats.payer);
      else if (!payerCompany) notes.push("Empresa de quem paga não definida: a pagar não lançado.");
    } catch (e: any) {
      notes.push(`A pagar não lançado: ${e?.message ?? e}`);
    }
    try {
      if (!receivableTitleId && payeeCompany) receivableTitleId = await make("receivable", payeeCompany, closing.payerName, cats.payee);
      else if (!payeeCompany && closing.payeeType !== "supplier") notes.push("Empresa de quem recebe não definida: a receber não lançado.");
    } catch (e: any) {
      notes.push(`A receber não lançado: ${e?.message ?? e}`);
    }
  }
  const complete = total === 0 || ((payableTitleId || !payerCompany) && (receivableTitleId || closing.payeeType === "supplier" || !payeeCompany));
  const pending = total > 0 && (!payableTitleId || (closing.payeeType !== "supplier" && !receivableTitleId));
  const after = await base.update("cert_closings", closing.id, {
    payableTitleId, receivableTitleId, payableCompanyId: payerCompany, receivableCompanyId: payeeCompany, status: complete && !pending ? "closed" : "pending_titles", notes: notes.join(" ").slice(0, 500) || null,
  });
  const audience = { action: "network.finance_view" as const };
  for (const companyId of [payerCompany, payeeCompany].filter(Boolean) as string[]) {
    await notify(base, { companyId, type: "info", priority: "normal", title: `Fechamento ${closing.code} — ${formatMoney(total)}`, body: `${KIND_LABEL[closing.kind]} · ${closing.payerName} → ${closing.payeeName} · ${period} · vencimento ${formatDate(closing.dueDate)}.`, link: `/rede/fechamentos/${closing.id}`, originType: "cert_closing", originId: closing.id, occurrenceKey: `cert-closing:${closing.id}:${companyId}`, audience }).catch(() => 0);
  }
  return after;
}

/** Relações das quais uma empresa é a pagadora (para o fechamento pela rotina e a tela). */
async function accruedByPayer(store: Store, companyId: string): Promise<Doc[]> {
  const base = unscoped(store);
  const settings = await networkSettings(store);
  const rows = await listAll(base, "cert_fin_entries", { filters: [["eq", "payerCompanyId", companyId], ["eq", "status", "accrued"]] });
  if (settings.platformCompanyId === companyId) {
    // lançamentos da plataforma gravados antes de a empresa ser definida
    const plat = await listAll(base, "cert_fin_entries", { filters: [["eq", "payerType", "platform"], ["eq", "status", "accrued"]] });
    for (const e of plat) if (!rows.some((x) => x.id === e.id)) rows.push(e);
  }
  return rows;
}

/** Fechamentos vencidos da empresa pagadora na data (rotina diária; idempotente). */
export async function closeDueRelations(store: Store, companyId: string, ref = today(), user: CtxUser = SYSTEM_USER): Promise<{ closed: number; carried: number }> {
  const rows = await accruedByPayer(store, companyId);
  const byRel = new Map<string, Doc[]>();
  for (const e of rows) byRel.set(e.relationKey, [...(byRel.get(e.relationKey) ?? []), e]);
  const ctx = await companyCtx(store, companyId, user);
  let closed = 0;
  let carried = 0;
  for (const [key, list] of byRel) {
    const terms = await relationTerms(store, list[0].agreementNodeId ?? null, list[0].kind, ref);
    const cutoff = closingCutoff(terms, ref);
    if (!list.some((e) => String(e.date) <= cutoff)) continue;
    try {
      const r = await closeRelation(ctx, key, cutoff);
      if (r.closing) closed++;
      if (r.carried != null) carried++;
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e;
    }
  }
  // fechamentos com título pendente (ex.: período fechado, empresa definida depois): tenta de novo
  const pending = await listAll(unscoped(store), "cert_closings", { filters: [["eq", "payerCompanyId", companyId], ["eq", "status", ["pending_titles", "closing"]]] });
  for (const c of pending) await withRelationLock(store, c.relationKey, async () => closingTitles(ctx, c)).catch(() => undefined);
  return { closed, carried };
}

/** Rotina diária do financeiro da rede para a empresa: fechamentos vencidos, pendências de lançamento e saldo baixo. */
export async function runNetworkBilling(store: Store, companyId: string, ref = today()): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  out.closings = await closeDueRelations(store, companyId, ref);
  const base = unscoped(store);
  const withIssues = (await listAll(base, "cert_sale_finance", { filters: [["eq", "requestCompanyId", companyId]] })).filter((f) => Array.isArray(f.issues) && f.issues.length);
  const ctx = await companyCtx(store, companyId, SYSTEM_USER);
  let retried = 0;
  for (const f of withIssues.slice(0, 200)) {
    await reprocessSaleFinance(ctx, f.requestId).catch(() => undefined);
    retried++;
  }
  out.retried = retried;
  const { notifyLowBalances } = await import("./billing");
  out.lowBalance = await notifyLowBalances(store, companyId, ref);
  return out;
}

// ----------------------------------------------------------------------------------------------------------- leitura

export async function getClosing(store: Store, id: string): Promise<Doc | null> {
  return unscoped(store).get("cert_closings", id);
}

export async function closingEntries(store: Store, closing: Doc): Promise<Doc[]> {
  const rows = await listAll(unscoped(store), "cert_fin_entries", { filters: [["eq", "closingId", closing.id]] });
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.protocol).localeCompare(String(b.protocol)));
}

export async function relationClosings(store: Store, relationKeys: string[]): Promise<Doc[]> {
  if (!relationKeys.length) return [];
  const rows = await listAll(unscoped(store), "cert_closings", { filters: [["eq", "relationKey", relationKeys]] });
  return rows.sort((a, b) => String(b.periodTo).localeCompare(String(a.periodTo)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function saleEntries(store: Store, requestId: string): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_fin_entries", { filters: [["eq", "requestId", requestId]] });
}
