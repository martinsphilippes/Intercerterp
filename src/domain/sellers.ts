import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { onlyDigits } from "@/lib/core/text";
import { formatBps } from "@/lib/money";

/**
 * Vendedores (CAD-05).
 *
 * Vendedor = registro de `users` (não há tabela própria — ver docs/evolucao/05-nao-duplicar.md):
 *  - usuário com acesso (login) que também vende: só os percentuais de comissão são editados aqui;
 *  - vendedor SEM acesso ao sistema (`loginDisabled`): sem perfil, senha ou convite; aparece no seletor de vendedor do
 *    PDV, nas metas e nas comissões; qualquer tentativa de login é recusada (users.loginBlockReason e sessão).
 *    Sem e-mail informado, grava-se um endereço interno reservado (`…@sem-acesso.invalid`) só para manter a
 *    unicidade do campo — nunca recebe mensagens.
 * Percentual de comissão: `commissionBps` (geral) e `commissionByCategory` ({ categoria: bps }, substitui o geral nos
 * itens daquela categoria de produto).
 */

export interface SellerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  commissionBps?: number | null;
  commissionByCategory?: Record<string, number> | null;
}

export interface SellerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** vendedor sem acesso ao sistema */
  loginDisabled: boolean;
  status: string;
  active: boolean;
  commissionBps: number | null;
  commissionByCategory: Record<string, number>;
  roleLabel: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PLACEHOLDER_EMAIL_DOMAIN = "sem-acesso.invalid";
export const isPlaceholderEmail = (e: string | null | undefined) => Boolean(e && e.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`));

function guard(ctx: Ctx, op: "view" | "create" | "edit") {
  requirePerm(ctx, "sales", op);
  if (op !== "view") requireAction(ctx, "sales.commissions");
}

/** Usuários que podem ser vendedores na empresa (inclui administradores e vendedores sem acesso). */
async function companyPeople(ctx: Ctx) {
  return (await listAll(ctx.store, "users")).filter((u) => u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId));
}

function toRow(u: Doc): SellerRow {
  return {
    id: u.id,
    name: u.name,
    email: isPlaceholderEmail(u.email) ? null : (u.email ?? null),
    phone: u.phone ?? null,
    loginDisabled: Boolean(u.loginDisabled),
    status: u.status ?? "active",
    active: u.status === "active" || u.status === "invited",
    commissionBps: u.commissionBps ?? null,
    commissionByCategory: u.commissionByCategory ?? {},
    roleLabel: u.loginDisabled ? "Sem acesso ao sistema" : u.isAdmin ? "Usuário (administrador)" : "Usuário do sistema",
  };
}

/** Vendedores e usuários da empresa (cadastro de vendedores e seletores). */
export async function listSellers(ctx: Ctx, opts: { activeOnly?: boolean } = {}): Promise<SellerRow[]> {
  const rows = (await companyPeople(ctx)).map(toRow);
  return rows.filter((r) => !opts.activeOnly || r.active).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

async function validateRates(ctx: Ctx, input: SellerInput) {
  const bps = input.commissionBps ?? null;
  if (bps != null) assert(Number.isInteger(bps) && bps >= 0 && bps <= 10000, "Percentual de comissão deve estar entre 0% e 100%.");
  const byCat: Record<string, number> = {};
  const entries = Object.entries(input.commissionByCategory ?? {});
  assert(entries.length <= 100, "No máximo 100 percentuais por categoria.");
  if (entries.length) {
    const cats = new Map((await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] })).map((c) => [c.id, c]));
    for (const [cat, v] of entries) {
      assert(cats.has(cat), "Categoria de produto inválida.");
      assert(Number.isInteger(v) && v >= 0 && v <= 10000, `Percentual da categoria ${cats.get(cat)!.name} deve estar entre 0% e 100%.`);
      byCat[cat] = v;
    }
  }
  return { commissionBps: bps, commissionByCategory: Object.keys(byCat).length ? byCat : null };
}

const describeRates = (r: { commissionBps: number | null; commissionByCategory: Record<string, number> | null }) =>
  `${r.commissionBps == null ? "sem percentual" : formatBps(r.commissionBps)}${r.commissionByCategory ? ` (+${Object.keys(r.commissionByCategory).length} por categoria)` : ""}`;

/** Cadastra vendedor sem acesso ao sistema (idempotente por `idemKey`). */
export async function createSeller(ctx: Ctx, input: SellerInput & { idemKey?: string }): Promise<Doc> {
  guard(ctx, "create");
  const name = input.name?.trim();
  assert(name && name.length >= 2, "Informe o nome do vendedor.");
  assert(name.length <= 200, "Nome: até 200 caracteres.");
  const id = detId("seller", ctx.companyId, input.idemKey ?? `${name}:${Date.now()}:${Math.random()}`);
  const prev = await ctx.store.get("users", id);
  if (prev) return prev;
  let email = input.email?.trim().toLowerCase() || null;
  if (email) {
    assert(EMAIL_RE.test(email), "E-mail inválido.");
    assert(!isPlaceholderEmail(email), "E-mail inválido.");
    const dup = await findOne(ctx.store, "users", [["eq", "email", email]]);
    if (dup) throw new BusinessError(`E-mail já usado por ${dup.name}.`, "duplicate");
  } else {
    email = `vendedor.${id}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  }
  const rates = await validateRates(ctx, input);
  const data = {
    name, email, login: null, phone: onlyDigits(input.phone) || null, status: "active", loginDisabled: true, isAdmin: false, roleId: null,
    companyIds: [ctx.companyId], branchIds: [], ...rates, createdBy: ctx.user.id,
  };
  let doc: Doc;
  try {
    doc = await ctx.store.create("users", data, id);
  } catch (e) {
    if (isConflict(e)) {
      const again = await ctx.store.get("users", id);
      if (again) return again;
      throw new BusinessError("E-mail já cadastrado.", "duplicate");
    }
    throw e;
  }
  await audit(ctx, {
    module: "sales", action: "seller.create", entityType: "user", entityId: id, summary: `Vendedor sem acesso ao sistema cadastrado: ${name} — comissão ${describeRates(rates)}`,
    after: { name, phone: data.phone, ...rates }, related: [`sellers:${ctx.companyId}`],
  });
  return doc;
}

async function loadSeller(ctx: Ctx, id: string): Promise<Doc> {
  const u = await ctx.store.get("users", id);
  assert(u && (u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId)), "Vendedor não encontrado nesta empresa.", "not_found");
  return u;
}

/**
 * Altera o vendedor. Vendedor sem acesso: nome, e-mail, telefone e percentuais. Usuário do sistema: somente os
 * percentuais (nome e e-mail são do cadastro de usuários).
 */
export async function updateSeller(ctx: Ctx, id: string, input: SellerInput): Promise<Doc> {
  guard(ctx, "edit");
  const u = await loadSeller(ctx, id);
  const rates = await validateRates(ctx, input);
  const patch: Record<string, any> = { ...rates };
  if (u.loginDisabled) {
    const name = input.name?.trim();
    assert(name && name.length >= 2 && name.length <= 200, "Informe o nome do vendedor.");
    patch.name = name;
    patch.phone = onlyDigits(input.phone) || null;
    const email = input.email?.trim().toLowerCase() || null;
    if (email && email !== u.email) {
      assert(EMAIL_RE.test(email) && !isPlaceholderEmail(email), "E-mail inválido.");
      const dup = await findOne(ctx.store, "users", [["eq", "email", email]]);
      if (dup && dup.id !== id) throw new BusinessError(`E-mail já usado por ${dup.name}.`, "duplicate");
      patch.email = email;
    } else if (!email && !isPlaceholderEmail(u.email)) {
      patch.email = `vendedor.${id}@${PLACEHOLDER_EMAIL_DOMAIN}`;
    }
  }
  const before = { name: u.name, phone: u.phone ?? null, email: isPlaceholderEmail(u.email) ? null : u.email, commissionBps: u.commissionBps ?? null, commissionByCategory: u.commissionByCategory ?? null };
  const after = { ...before, ...patch, email: patch.email !== undefined ? (isPlaceholderEmail(patch.email) ? null : patch.email) : before.email };
  if (JSON.stringify(before) === JSON.stringify(after)) return u;
  const doc = await ctx.store.update("users", id, patch);
  await audit(ctx, {
    module: "sales", action: "seller.update", entityType: "user", entityId: id,
    summary: `Vendedor ${doc.name}: comissão ${describeRates(rates)}${u.loginDisabled ? "" : " (usuário do sistema — só percentuais)"}`,
    before, after, related: [`sellers:${ctx.companyId}`],
  });
  return doc;
}

/** Ativa/inativa vendedor sem acesso (inativo some do seletor do PDV; vendas e comissões passadas ficam). */
export async function setSellerActive(ctx: Ctx, id: string, active: boolean): Promise<Doc> {
  guard(ctx, "edit");
  const u = await loadSeller(ctx, id);
  assert(u.loginDisabled, "Usuário do sistema: a situação do acesso é alterada em Administração › Usuários.");
  const status = active ? "active" : "inactive";
  if (u.status === status) return u;
  const doc = await ctx.store.update("users", id, { status });
  await audit(ctx, { module: "sales", action: active ? "seller.activate" : "seller.deactivate", entityType: "user", entityId: id, summary: `Vendedor ${u.name} ${active ? "reativado" : "inativado"}`, before: { status: u.status }, after: { status }, related: [`sellers:${ctx.companyId}`] });
  return doc;
}

/** Percentual aplicado a um item: o da categoria do produto, se houver, senão o geral do vendedor (0 sem cadastro). */
export function sellerRateFor(seller: Record<string, any> | null | undefined, categoryId: string | null | undefined): number {
  if (!seller) return 0;
  const byCat = (seller.commissionByCategory ?? {}) as Record<string, number>;
  if (categoryId && byCat[categoryId] != null) return byCat[categoryId];
  return seller.commissionBps ?? 0;
}

/** Vendedor efetivo da venda: o informado; sem vendedor, o operador (mesma exibição da tela da venda). */
export const sellerOfSale = (s: Record<string, any> | null | undefined): string | null => (s ? (s.sellerId ?? s.operatorId ?? null) : null);
