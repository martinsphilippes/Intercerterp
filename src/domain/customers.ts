import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { canDo } from "@/lib/permissions";
import { audit, diff } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { isValidCnpj, isValidCpf, onlyDigits, searchable } from "@/lib/core/text";
import { nowIso, today } from "@/lib/dates";

/**
 * Clientes (Telas 20–21). Uma única identidade por CPF/CNPJ na empresa (índice único),
 * usada pelo PDV, CRM, recebíveis e documentos fiscais.
 */

export interface Address {
  type?: string;
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  cityName?: string;
  cityCode?: string;
  uf?: string;
}

export interface CustomerInput {
  personType: "PF" | "PJ";
  doc?: string | null;
  name: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  profession?: string | null;
  sellerId?: string | null;
  vip?: boolean;
  finalConsumer?: boolean;
  acceptsPromotions?: boolean;
  promoChannels?: string[];
  ie?: string | null;
  ieIndicator?: string | null;
  im?: string | null;
  addresses?: Address[];
  contacts?: Array<{ name: string; role?: string; email?: string; phone?: string }>;
  creditLimit?: number;
  paymentTermDays?: number;
  paymentTermId?: string | null;
  priceTableId?: string | null;
  notes?: string | null;
  status?: "draft" | "active" | "inactive";
  code?: string | null;
}

export function normalizeDoc(personType: "PF" | "PJ", doc: string | null | undefined): string | null {
  const d = onlyDigits(doc);
  if (!d) return null;
  if (personType === "PF") {
    assert(d.length === 11 && isValidCpf(d), "CPF inválido.", "invalid_doc");
  } else {
    assert(d.length === 14 && isValidCnpj(d), "CNPJ inválido.", "invalid_doc");
  }
  return d;
}

export async function findCustomerByDoc(store: Store, companyId: string, doc: string) {
  return findOne(store, "customers", [["eq", "companyId", companyId], ["eq", "doc", onlyDigits(doc)]]);
}

function buildData(input: CustomerInput, doc: string | null) {
  const status = input.status ?? "active";
  if (status === "active" && input.personType === "PJ") assert(doc, "Pessoa jurídica exige CNPJ para cadastro ativo (use rascunho para completar depois).");
  return {
    personType: input.personType,
    doc,
    name: input.name.trim(),
    tradeName: input.personType === "PJ" ? (input.tradeName?.trim() || null) : null,
    email: input.email?.trim().toLowerCase() || null,
    phone: onlyDigits(input.phone) || null,
    mobile: onlyDigits(input.mobile) || null,
    birthDate: input.personType === "PF" ? input.birthDate || null : null,
    gender: input.personType === "PF" ? input.gender || null : null,
    maritalStatus: input.personType === "PF" ? input.maritalStatus || null : null,
    profession: input.personType === "PF" ? input.profession || null : null,
    sellerId: input.sellerId || null,
    vip: Boolean(input.vip),
    finalConsumer: input.finalConsumer ?? input.personType === "PF",
    acceptsPromotions: Boolean(input.acceptsPromotions),
    promoChannels: input.acceptsPromotions ? (input.promoChannels ?? []) : [],
    ie: input.ie?.trim() || null,
    ieIndicator: input.ieIndicator || (input.ie ? (input.ie.toUpperCase() === "ISENTO" ? "2" : "1") : "9"),
    im: input.im?.trim() || null,
    addresses: (input.addresses ?? []).filter((a) => a.street || a.zip || a.cityName),
    contacts: (input.contacts ?? []).filter((c) => c.name),
    creditLimit: Math.max(0, input.creditLimit ?? 0),
    paymentTermDays: input.paymentTermDays ?? 0,
    paymentTermId: input.paymentTermId || null,
    priceTableId: input.priceTableId || null,
    notes: input.notes || null,
    status,
    searchText: searchable(input.name, input.tradeName, doc, input.email, input.mobile, input.phone, input.code),
  };
}

/** Limite de crédito do crediário: concessão/alteração exige a ação especial "customer.credit_limit". */
export function canGrantCredit(ctx: Ctx) {
  return canDo(ctx.user, "customer.credit_limit");
}

function requireCreditGrant(ctx: Ctx) {
  if (!canGrantCredit(ctx)) throw new PermissionError("Você não tem permissão para conceder ou alterar o limite de crédito do cliente.");
}

/** Cliente da empresa ativa (registro de outra empresa é tratado como inexistente). */
async function companyCustomer(ctx: Ctx, id: string): Promise<Doc> {
  const c = await ctx.store.get("customers", id);
  if (!c || c.companyId !== ctx.companyId) throw new BusinessError("Cliente não encontrado.", "not_found");
  return c;
}

function docLabel(personType: "PF" | "PJ" | string | null | undefined) {
  return personType === "PJ" ? "CNPJ" : "CPF";
}

/**
 * Cadastro de cliente. A unicidade do CPF/CNPJ fica com o índice único (companyId, doc) — a chave acompanha o
 * documento atual do registro (corrigir o documento libera o anterior na mesma gravação). O id NÃO deriva do
 * documento; a idempotência vem da chave do formulário (`idemKey`): repetir o mesmo envio devolve o cliente já criado.
 */
export async function createCustomer(ctx: Ctx, input: CustomerInput, opts: { quick?: boolean; idemKey?: string | null } = {}) {
  requirePerm(ctx, "customers", "create");
  const cid = opts.idemKey ? detId("customer", ctx.companyId, "idem", opts.idemKey) : undefined;
  if (cid) {
    const existing = await ctx.store.get("customers", cid);
    if (existing && existing.companyId === ctx.companyId) return existing; // repetição do mesmo envio
  }
  assert(input.name?.trim(), "Informe o nome.");
  const doc = normalizeDoc(input.personType, input.doc);
  if ((input.creditLimit ?? 0) > 0) requireCreditGrant(ctx);
  if (doc) {
    const dup = await findCustomerByDoc(ctx.store, ctx.companyId, doc);
    if (dup) throw new BusinessError(`Já existe cliente com este ${docLabel(input.personType)}: ${dup.name}.`, "duplicate", { id: dup.id });
  }
  const seq = await nextNumber(ctx.store, `customer:${ctx.companyId}`);
  const code = input.code?.trim() || `C${String(seq).padStart(5, "0")}`;
  try {
    const c = await ctx.store.create("customers", { companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, code, ...buildData({ ...input, code }, doc) }, cid);
    await audit(ctx, { module: "customers", action: opts.quick ? "customer.quick_create" : "customer.create", entityType: "customer", entityId: c.id, summary: `Cliente ${c.name} cadastrado${opts.quick ? " (cadastro rápido)" : ""}` });
    return c;
  } catch (e) {
    if (isConflict(e)) {
      // envio concorrente com a mesma chave: devolve o registro gravado pelo outro envio
      if (cid) {
        const again = await ctx.store.get("customers", cid);
        if (again && again.companyId === ctx.companyId) return again;
      }
      // documento gravado ao mesmo tempo por outro cadastro (índice único)
      if (doc) {
        const dup = await findCustomerByDoc(ctx.store, ctx.companyId, doc);
        if (dup) throw new BusinessError(`Já existe cliente com este ${docLabel(input.personType)}: ${dup.name}.`, "duplicate", { id: dup.id });
      }
    }
    throw e;
  }
}

export async function updateCustomer(ctx: Ctx, id: string, input: CustomerInput) {
  requirePerm(ctx, "customers", "edit");
  const before = await companyCustomer(ctx, id);
  const doc = normalizeDoc(input.personType, input.doc);
  if (doc && doc !== before.doc) {
    const dup = await findCustomerByDoc(ctx.store, ctx.companyId, doc);
    if (dup && dup.id !== id) throw new BusinessError(`Documento já usado pelo cliente ${dup.name}.`, "duplicate", { id: dup.id });
  }
  // limite não enviado (campo somente leitura para quem não pode conceder crédito) = mantém o atual
  const creditLimit = input.creditLimit == null ? (before.creditLimit ?? 0) : Math.max(0, input.creditLimit);
  if (creditLimit !== (before.creditLimit ?? 0)) requireCreditGrant(ctx);
  const data = buildData({ ...input, creditLimit, code: input.code ?? before.code }, doc);
  try {
    const after = await ctx.store.update("customers", id, { ...data, code: input.code?.trim() || before.code });
    const d = diff(before, after);
    if (Object.keys(d.after).length) await audit(ctx, { module: "customers", action: "customer.update", entityType: "customer", entityId: id, summary: `Cadastro de ${after.name} alterado`, before: d.before, after: d.after });
    return after;
  } catch (e) {
    if (isConflict(e) && doc) {
      const dup = await findCustomerByDoc(ctx.store, ctx.companyId, doc);
      throw new BusinessError(`Documento já usado ${dup && dup.id !== id ? `pelo cliente ${dup.name}` : "por outro cliente"}.`, "duplicate", dup ? { id: dup.id } : undefined);
    }
    throw e;
  }
}

/** Inativa (preserva referências históricas). Exclusão só quando não há operações. */
export async function setCustomerStatus(ctx: Ctx, id: string, status: "active" | "inactive") {
  requirePerm(ctx, "customers", "edit");
  const c = await companyCustomer(ctx, id);
  const u = await ctx.store.update("customers", id, { status });
  await audit(ctx, { module: "customers", action: `customer.${status}`, entityType: "customer", entityId: id, summary: `Cliente ${c.name} ${status === "inactive" ? "inativado" : "reativado"}` });
  return u;
}

export async function deleteCustomer(ctx: Ctx, id: string) {
  requirePerm(ctx, "customers", "delete");
  const c = await companyCustomer(ctx, id);
  const sales = await ctx.store.list("sales", { filters: [["eq", "companyId", ctx.companyId], ["eq", "customerId", id]], limit: 1 });
  const titles = await ctx.store.list("titles", { filters: [["eq", "companyId", ctx.companyId], ["eq", "partyId", id]], limit: 1 });
  if (sales.items.length || titles.items.length) throw new BusinessError("Cliente com operações registradas não pode ser excluído; use Inativar.", "in_use");
  await ctx.store.delete("customers", id);
  await audit(ctx, { module: "customers", action: "customer.delete", entityType: "customer", entityId: id, summary: `Cliente ${c.name} excluído (sem operações)`, before: { name: c.name, doc: c.doc } });
}

/** Consulta de CNPJ em serviço externo (BrasilAPI). O retorno é sugerido, nunca gravado sem confirmação. */
export async function lookupCnpj(cnpj: string) {
  const d = onlyDigits(cnpj);
  assert(isValidCnpj(d), "CNPJ inválido.");
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return { ok: false as const, message: "CNPJ não encontrado na base consultada." };
    if (!res.ok) return { ok: false as const, message: `Serviço de consulta indisponível (HTTP ${res.status}).` };
    const j: any = await res.json();
    return {
      ok: true as const,
      source: "BrasilAPI (dados públicos da Receita Federal)",
      consultedAt: nowIso(),
      data: {
        name: j.razao_social,
        tradeName: j.nome_fantasia || null,
        email: j.email || null,
        phone: j.ddd_telefone_1 || null,
        situation: j.descricao_situacao_cadastral,
        address: { zip: j.cep, street: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" "), number: j.numero, complement: j.complemento, district: j.bairro, cityName: j.municipio, cityCode: j.codigo_municipio_ibge ? String(j.codigo_municipio_ibge) : undefined, uf: j.uf },
      },
    };
  } catch (e: any) {
    return { ok: false as const, message: `Não foi possível consultar o serviço externo (${e.message}). Preencha manualmente.` };
  }
}

/**
 * Resumo do relacionamento: compras, ticket, títulos, créditos e documentos fiscais — calculado das operações
 * reais da EMPRESA ATIVA (o mesmo CPF/CNPJ pode ser cliente de outra empresa; os dados dela não aparecem).
 */
export async function customerSummary(ctx: Pick<Ctx, "store" | "companyId">, customerId: string) {
  const { store, companyId } = ctx;
  const customer = await store.get("customers", customerId);
  const own = Boolean(customer && customer.companyId === companyId);
  const cid = own ? customerId : "__none__";
  const sales = own ? await listAll(store, "sales", { filters: [["eq", "companyId", companyId], ["eq", "customerId", cid]], orderBy: [{ field: "completedAt", dir: "desc" }] }) : [];
  const completed = sales.filter((s) => s.status === "completed");
  const net = completed.reduce((a, s) => a + s.total - (s.returnedTotal ?? 0), 0);
  const installments = own ? await listAll(store, "installments", { filters: [["eq", "companyId", companyId], ["eq", "partyId", cid], ["eq", "kind", "receivable"]], orderBy: [{ field: "dueDate" }] }) : [];
  const open = installments.filter((i) => ["open", "partial"].includes(i.status));
  const t = today();
  const vouchers = own ? await listAll(store, "credit_vouchers", { filters: [["eq", "companyId", companyId], ["eq", "customerId", cid]] }) : [];
  // documentos fiscais da empresa ativa: emitidos para o CPF/CNPJ atual do cliente ou vinculados ao cliente (partyId)
  const byDoc = own && customer!.doc ? await listAll(store, "fiscal_documents", { filters: [["eq", "companyId", companyId], ["eq", "recipientDoc", customer!.doc]] }, 200) : [];
  const byParty = own ? await listAll(store, "fiscal_documents", { filters: [["eq", "companyId", companyId], ["eq", "partyId", cid]] }, 200) : [];
  const docs = [...new Map([...byDoc, ...byParty].filter((d) => d.companyId === companyId).map((d) => [d.id, d])).values()].sort((a, b) => String(b.issuedAt ?? b.createdAt ?? "").localeCompare(String(a.issuedAt ?? a.createdAt ?? "")));
  return {
    sales,
    salesCount: completed.length,
    netTotal: net,
    ticket: completed.length ? Math.round(net / completed.length) : 0,
    lastPurchase: completed[0]?.completedAt ?? null,
    installments,
    openBalance: open.reduce((a, i) => a + i.balance, 0),
    overdueBalance: open.filter((i) => i.dueDate < t).reduce((a, i) => a + i.balance, 0),
    vouchers,
    voucherBalance: vouchers.filter((v) => v.status === "active").reduce((a, v) => a + v.balance, 0),
    documents: docs,
  };
}

export async function listSellers(store: Store, companyId: string) {
  const users = await listAll(store, "users", { filters: [["eq", "status", "active"]] });
  return users.filter((u) => u.isAdmin || (u.companyIds ?? []).includes(companyId)).map((u) => ({ value: u.id, label: u.name }));
}

export type CustomerDoc = Doc;
