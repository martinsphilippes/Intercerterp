import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { formatDate, nowIso, today } from "@/lib/dates";
import { formatBps, formatMoney } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { certificationSettings } from "../accounting/certificates";
import { NETWORK_SCOPE, allNodes, auditNetwork, isPlatform, networkViewer } from "./common";

/**
 * Cupons de desconto da rede (§45).
 *
 *  - Código único na rede (3 a 20 letras/números, gravado em maiúsculas); desconto % (pontos-base) ou valor fixo
 *    (centavos); produto opcional; nó atribuído (vale para as vendas desse nó e dos que estão abaixo dele) e vendedor
 *    opcional; validade; limite total de usos e por titular (CPF/CNPJ); ativo/inativo.
 *  - Quem cria: a plataforma (qualquer nó, ou a rede toda) e o administrador/gestor de um nó (operação
 *    "network.coupons") para o próprio nó e os descendentes. O EMISSOR fica no cupom e no retrato da venda.
 *  - Regra de preço (quotePrice): o preço com cupom nunca fica abaixo do custo do vendedor; abaixo do mínimo só com
 *    cupom emitido por nível acima do vendedor (quem emite absorve a diferença).
 *  - Uso [Decisão]: RESERVADO na abertura da venda (contador atômico com limite — dois vendedores não estouram o
 *    limite), CONSUMIDO quando o pagamento é confirmado e LIBERADO se a venda for cancelada antes do pagamento.
 */

export const COUPON_CODE_RE = /^[A-Z0-9]{3,20}$/;
export const normalizeCouponCode = (v: string | null | undefined) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
const couponId = (code: string) => detId("cert_coupon", code);

export interface CouponInput {
  code: string;
  kind: "percent" | "fixed";
  /** percentual em pontos-base (10% = 1000) */
  valueBps?: number | null;
  /** valor fixo em centavos */
  valueCents?: number | null;
  productKey?: string | null;
  /** nó atribuído (null = plataforma: toda a rede); padrão = nó de quem cria */
  nodeId?: string | null;
  sellerUserId?: string | null;
  validFrom?: string | null;
  validTo: string;
  maxUses?: number | null;
  maxPerHolder?: number | null;
  notes?: string | null;
}

export function describeCoupon(c: Doc | Record<string, any>): string {
  return c.kind === "percent" ? `${formatBps(c.valueBps)} de desconto` : `${formatMoney(c.valueCents)} de desconto`;
}

export async function createCoupon(ctx: Ctx, input: CouponInput): Promise<Doc> {
  const platform = isPlatform(ctx);
  if (!platform) requireAction(ctx, "network.coupons");
  const v = await networkViewer(ctx);
  if (!platform) {
    if (!v.myNode) throw new PermissionError("Sua empresa não é um parceiro da rede de certificação.");
    if (v.myNode.status !== "active") throw new BusinessError("Seu nó da rede não está ativo: cupons novos não podem ser criados.", "inactive");
  }
  const code = normalizeCouponCode(input.code);
  assert(COUPON_CODE_RE.test(code), "Código do cupom: de 3 a 20 letras e números, sem espaços (gravado em maiúsculas).");
  assert(input.kind === "percent" || input.kind === "fixed", "Escolha o tipo de desconto (% ou valor fixo).");
  const valueBps = input.kind === "percent" ? Math.round(Number(input.valueBps ?? 0)) : null;
  const valueCents = input.kind === "fixed" ? Math.round(Number(input.valueCents ?? 0)) : null;
  if (input.kind === "percent") assert(valueBps! > 0 && valueBps! <= 10000, "Percentual de desconto entre 0,01% e 100%.");
  else assert(valueCents! > 0, "Informe o valor do desconto (em reais).");
  const nodeId = input.nodeId === undefined ? (v.myNode?.id ?? null) : input.nodeId || null;
  if (!platform) assert(nodeId && v.visible.has(nodeId), "O cupom só pode ser atribuído ao seu nó ou a parceiros abaixo dele.");
  else if (nodeId) assert(v.nodes.some((n) => n.id === nodeId), "Parceiro não encontrado.");
  const target = nodeId ? v.nodes.find((n) => n.id === nodeId)! : null;
  let sellerName: string | null = null;
  if (input.sellerUserId) {
    assert(target, "Para atribuir a um vendedor, escolha o parceiro dele.");
    const u = await unscoped(ctx.store).get("users", input.sellerUserId);
    assert(u && (u.companyIds ?? []).includes(target!.nodeCompanyId), "O vendedor precisa ser usuário do parceiro atribuído.");
    sellerName = u!.name;
  }
  if (input.productKey) {
    const s = await certificationSettings(ctx.store);
    const p = s.catalog.find((x) => x.key === input.productKey);
    assert(p && !p.free, "Produto inválido para cupom.");
  }
  const validFrom = input.validFrom || today();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(validFrom) && /^\d{4}-\d{2}-\d{2}$/.test(input.validTo ?? ""), "Informe a validade do cupom.");
  assert(input.validTo >= validFrom, "A validade final precisa ser igual ou posterior ao início.");
  assert(input.validTo >= today(), "A validade final não pode estar no passado.");
  const maxUses = input.maxUses ? Math.round(Number(input.maxUses)) : null;
  const maxPerHolder = input.maxPerHolder ? Math.round(Number(input.maxPerHolder)) : null;
  assert(maxUses == null || maxUses >= 1, "Limite de usos: ao menos 1 (vazio = sem limite).");
  assert(maxPerHolder == null || maxPerHolder >= 1, "Limite por titular: ao menos 1 (vazio = sem limite).");
  // emissor: a plataforma (quem gere toda a rede) ou o nó de quem cria
  const issuer = platform ? null : v.myNode;
  let coupon: Doc;
  try {
    coupon = await unscoped(ctx.store).create("cert_coupons", {
      companyId: NETWORK_SCOPE, branchId: null, createdBy: ctx.user.id, code, issuerNodeId: issuer?.id ?? null, issuerLevel: issuer?.level ?? "platform", nodeId, sellerUserId: input.sellerUserId || null, sellerName,
      productKey: input.productKey || null, kind: input.kind, valueBps, valueCents, validFrom, validTo: input.validTo, maxUses, maxPerHolder, usedCount: 0, active: true, notes: input.notes?.trim()?.slice(0, 300) || null,
    }, couponId(code));
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(`Já existe um cupom com o código ${code} na rede. Escolha outro código.`, "duplicate");
    throw e;
  }
  const summary = `Cupom ${code} criado: ${describeCoupon(coupon)}${target ? ` para ${target.name}${coupon.sellerName ? ` (vendedor ${coupon.sellerName})` : ""} e parceiros abaixo` : " para toda a rede"}, válido de ${formatDate(validFrom)} a ${formatDate(input.validTo)}${maxUses ? `, até ${maxUses} uso(s)` : ""}${maxPerHolder ? `, ${maxPerHolder} por titular` : ""}`;
  await auditNetwork(ctx, target, { action: "network.coupon_create", summary, after: { code, kind: input.kind, valueBps, valueCents, nodeId, productKey: coupon.productKey, maxUses, maxPerHolder, validTo: input.validTo }, related: [`cert_coupon:${coupon.id}`] });
  return coupon;
}

async function couponForManage(ctx: Ctx, id: string): Promise<Doc> {
  const c = await unscoped(ctx.store).get("cert_coupons", id);
  if (!c) throw new BusinessError("Cupom não encontrado.", "not_found");
  if (isPlatform(ctx)) return c;
  requireAction(ctx, "network.coupons");
  const v = await networkViewer(ctx);
  // gere o cupom quem o emitiu ou o nó acima do nó atribuído (o cupom da plataforma só a plataforma gere)
  if (!v.myNode || !(c.issuerNodeId === v.myNode.id || (c.nodeId && v.visible.has(c.nodeId) && c.issuerNodeId && v.visible.has(c.issuerNodeId)))) throw new PermissionError("Este cupom foi emitido por um nível acima: só ele pode alterá-lo.");
  return c;
}

export async function setCouponActive(ctx: Ctx, id: string, active: boolean, reason?: string | null): Promise<Doc> {
  const c = await couponForManage(ctx, id);
  if ((c.active !== false) === active) return c;
  if (!active) assert(String(reason ?? "").trim().length >= 3, "Informe o motivo para desativar o cupom.");
  const after = await unscoped(ctx.store).update("cert_coupons", c.id, { active });
  const nodes = await allNodes(ctx.store);
  const target = nodes.find((n) => n.id === c.nodeId) ?? nodes.find((n) => n.id === c.issuerNodeId);
  await auditNetwork(ctx, target ?? null, { action: active ? "network.coupon_activate" : "network.coupon_deactivate", summary: `Cupom ${c.code} ${active ? "reativado" : "desativado"}`, reason: reason?.trim() || null, related: [`cert_coupon:${c.id}`] });
  return after;
}

/** Cupons que o usuário vê: a plataforma, todos; um nó, os que valem para ele ou para os de baixo e os que ele emitiu. */
export async function listCoupons(ctx: Ctx): Promise<Array<Doc & { nodeName: string | null; issuerName: string; manageable: boolean; status: "active" | "inactive" | "expired" | "scheduled" | "exhausted" }>> {
  const v = await networkViewer(ctx);
  if (!v.platform && !canDo(ctx.user, "network.coupons") && !canDo(ctx.user, "network.sales_all")) throw new PermissionError();
  const rows = await listAll(unscoped(ctx.store), "cert_coupons", { filters: [["eq", "companyId", NETWORK_SCOPE]] });
  const byId = new Map(v.nodes.map((n) => [n.id, n]));
  const ref = today();
  return rows
    // o nó vê os cupons que valem para ele (da rede toda, atribuídos a ele/acima dele no caminho) e os que valem abaixo dele
    .filter((c) => v.platform || c.nodeId == null || v.visible.has(c.nodeId) || (v.myNode?.path ?? []).includes(c.nodeId) || (c.issuerNodeId && c.issuerNodeId === v.myNode?.id))
    .map((c) => {
      const issuerVisible = c.issuerNodeId == null ? true : v.platform || v.visible.has(c.issuerNodeId);
      const status = c.active === false ? "inactive" : c.validTo < ref ? "expired" : c.validFrom > ref ? "scheduled" : c.maxUses && Number(c.usedCount ?? 0) >= c.maxUses ? "exhausted" : "active";
      return {
        ...c, nodeName: c.nodeId ? (byId.get(c.nodeId)?.name ?? null) : null,
        issuerName: c.issuerNodeId == null ? "Intercert (plataforma)" : issuerVisible ? (byId.get(c.issuerNodeId)?.name ?? "—") : "Parceiro acima na rede",
        manageable: v.platform ? true : canDo(ctx.user, "network.coupons") && Boolean(v.myNode && (c.issuerNodeId === v.myNode.id || (c.issuerNodeId && v.visible.has(c.issuerNodeId)))),
        status: status as "active" | "inactive" | "expired" | "scheduled" | "exhausted",
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Cupom aplicável a uma venda (confere tudo menos os limites, que são atômicos na reserva). Lança a mensagem clara
 * do motivo quando não vale.
 */
export async function applicableCoupon(store: Store, rawCode: string, sale: { sellerNode: Doc; sellerUserId: string; productKey: string; date?: string }): Promise<Doc> {
  const code = normalizeCouponCode(rawCode);
  const c = code ? await unscoped(store).get("cert_coupons", couponId(code)) : null;
  if (!c) throw new BusinessError(`Cupom ${code || "(vazio)"} não encontrado.`, "coupon");
  const date = sale.date ?? today();
  if (c.active === false) throw new BusinessError(`Cupom ${code} está inativo.`, "coupon");
  if (c.validFrom > date) throw new BusinessError(`Cupom ${code} vale a partir de ${formatDate(c.validFrom)}.`, "coupon");
  if (c.validTo < date) throw new BusinessError(`Cupom ${code} venceu em ${formatDate(c.validTo)}.`, "coupon");
  if (c.productKey && c.productKey !== sale.productKey) throw new BusinessError(`Cupom ${code} vale só para outro produto.`, "coupon");
  if (c.nodeId && c.nodeId !== sale.sellerNode.id && !(sale.sellerNode.path ?? []).includes(c.nodeId)) throw new BusinessError(`Cupom ${code} não vale para as vendas do seu nó.`, "coupon");
  if (c.sellerUserId && c.sellerUserId !== sale.sellerUserId) throw new BusinessError(`Cupom ${code} está atribuído a outro vendedor.`, "coupon");
  if (c.maxUses && Number(c.usedCount ?? 0) >= c.maxUses) throw new BusinessError(`Cupom ${code} atingiu o limite de ${c.maxUses} uso(s).`, "coupon");
  return c;
}

/** Garante o contador por titular (criado fora da transação; a reserva incrementa com limite). */
export async function ensureHolderCounter(store: Store, couponIdValue: string, holderDoc: string): Promise<string> {
  const id = detId("cert_coupon_holder", couponIdValue, holderDoc);
  const base = unscoped(store);
  if (!(await base.get("cert_coupon_holders", id))) {
    try {
      await base.create("cert_coupon_holders", { companyId: NETWORK_SCOPE, branchId: null, couponId: couponIdValue, holderDoc, count: 0 }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }
  return id;
}

/** Reserva do uso dentro da transação da venda (limites atômicos: total e por titular). */
export async function reserveCouponInTx(tx: Store, c: Doc, input: { requestId: string; requestCompanyId: string; holderDoc: string; discount: number; sellerNodeId: string; holderCounterId: string | null }): Promise<string> {
  const useId = detId("cert_coupon_use", input.requestId);
  await tx.create("cert_coupon_uses", { companyId: NETWORK_SCOPE, branchId: null, couponId: c.id, couponCode: c.code, requestId: input.requestId, requestCompanyId: input.requestCompanyId, holderDoc: input.holderDoc, discount: input.discount, sellerNodeId: input.sellerNodeId, status: "reserved" }, useId);
  await tx.increment("cert_coupons", c.id, "usedCount", 1, c.maxUses ? { max: c.maxUses } : undefined);
  if (input.holderCounterId) await tx.increment("cert_coupon_holders", input.holderCounterId, "count", 1, c.maxPerHolder ? { max: c.maxPerHolder } : undefined);
  return useId;
}

/** Pagamento confirmado: o uso reservado passa a consumido (idempotente). */
export async function consumeCouponUse(store: Store, r: Doc): Promise<void> {
  const base = unscoped(store);
  const use = await base.get("cert_coupon_uses", detId("cert_coupon_use", r.id));
  if (!use || use.status !== "reserved") return;
  await base.update("cert_coupon_uses", use.id, { status: "consumed", consumedAt: nowIso() });
}

/** Venda cancelada antes do pagamento: libera o uso reservado (uma única vez, mesmo com cancelamentos simultâneos). */
export async function releaseCouponUse(store: Store, r: Doc): Promise<boolean> {
  const base = unscoped(store);
  const use = await base.get("cert_coupon_uses", detId("cert_coupon_use", r.id));
  if (!use || use.status !== "reserved") return false;
  const coupon = await base.get("cert_coupons", use.couponId);
  try {
    await base.transaction(async (tx) => {
      await tx.create("counters", { key: `once:coupon_release:${use.id}`, value: 1 }, detId("once", "coupon_release", use.id));
      await tx.update("cert_coupon_uses", use.id, { status: "released", releasedAt: nowIso() });
      if (coupon) await tx.increment("cert_coupons", coupon.id, "usedCount", -1, { min: 0 });
      if (coupon && use.holderDoc) {
        const hid = detId("cert_coupon_holder", coupon.id, use.holderDoc);
        if (await base.get("cert_coupon_holders", hid)) await tx.increment("cert_coupon_holders", hid, "count", -1, { min: 0 });
      }
    });
  } catch (e) {
    if (isConflict(e)) return false; // já liberado por outra operação
    throw e;
  }
  return true;
}

/** Usos de um cupom (reservados, consumidos e liberados) — para a tela do cupom. */
export async function couponUses(store: Store, couponIdValue: string): Promise<Doc[]> {
  return listAll(unscoped(store), "cert_coupon_uses", { filters: [["eq", "couponId", couponIdValue]], orderBy: [{ field: "createdAt", dir: "desc" }] });
}
