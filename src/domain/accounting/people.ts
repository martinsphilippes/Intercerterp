import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError } from "@/lib/core/errors";
import { NotFoundError } from "@/lib/db/types";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/core/text";
import { cleanAddress, validateAddress, UFS } from "../companies";
import { PEOPLE_KIND } from "./common";
import { getClient } from "./clients";

// ───────────────────────────── Pessoas (sócios, representantes, procuradores, contatos)

export interface PersonInput {
  kind: string;
  name: string;
  doc?: string | null;
  qualification?: string | null;
  shareBps?: number | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  isPrimary?: boolean;
  startAt?: string | null;
  endAt?: string | null;
  notes?: string | null;
}

function personData(input: PersonInput) {
  assert(PEOPLE_KIND.some((k) => k.value === input.kind), "Tipo de pessoa inválido.");
  assert(input.name?.trim(), "Informe o nome.");
  const doc = onlyDigits(input.doc) || null;
  if (doc) assert((doc.length === 11 && isValidCpf(doc)) || (doc.length === 14 && isValidCnpj(doc)), "CPF/CNPJ inválido.");
  const shareBps = input.shareBps == null || Number.isNaN(input.shareBps) ? null : input.shareBps;
  if (shareBps != null) assert(Number.isInteger(shareBps) && shareBps >= 0 && shareBps <= 10000, "Participação deve estar entre 0% e 100%.");
  const email = input.email?.trim().toLowerCase() || null;
  if (email) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "E-mail inválido.");
  if (input.startAt && input.endAt) assert(input.endAt >= input.startAt, "A saída não pode ser anterior à entrada.");
  return {
    kind: input.kind, name: input.name.trim(), doc, qualification: input.qualification?.trim() || null, shareBps, email, phone: onlyDigits(input.phone) || null,
    department: input.department?.trim() || null, isPrimary: Boolean(input.isPrimary), startAt: input.startAt || null, endAt: input.endAt || null, notes: input.notes?.trim() || null,
    active: !input.endAt || input.endAt >= new Date().toISOString().slice(0, 10),
  };
}

export async function listPeople(ctx: Ctx, clientId: string): Promise<Doc[]> {
  await getClient(ctx, clientId);
  return (await listAll(ctx.store, "accounting_client_people", { filters: [["eq", "clientId", clientId]] })).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name, "pt-BR"));
}

export async function addPerson(ctx: Ctx, clientId: string, input: PersonInput): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const client = await getClient(ctx, clientId);
  const data = personData(input);
  if (data.kind === "partner" && data.shareBps != null) {
    const others = (await listAll(ctx.store, "accounting_client_people", { filters: [["eq", "clientId", clientId], ["eq", "kind", "partner"]] })).filter((p) => p.active !== false);
    const total = others.reduce((a, p) => a + (p.shareBps ?? 0), 0) + data.shareBps;
    assert(total <= 10000, `A soma das participações ultrapassa 100% (${(total / 100).toFixed(2)}%).`);
  }
  if (data.isPrimary) await clearPrimary(ctx, clientId, data.kind);
  const row = await ctx.store.create("accounting_client_people", { ...data, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId });
  await audit(ctx, { module: "accounting", action: "client.person_add", entityType: "accounting_client", entityId: clientId, summary: `${client.name}: ${data.kind === "partner" ? "sócio" : data.kind === "contact" ? "contato" : "pessoa"} ${data.name} adicionado`, after: data });
  return row;
}

export async function updatePerson(ctx: Ctx, personId: string, input: PersonInput): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const before = await ctx.store.get("accounting_client_people", personId);
  if (!before) throw new NotFoundError("accounting_client_people", personId);
  const client = await getClient(ctx, before.clientId);
  const data = personData(input);
  if (data.kind === "partner" && data.shareBps != null) {
    const others = (await listAll(ctx.store, "accounting_client_people", { filters: [["eq", "clientId", before.clientId], ["eq", "kind", "partner"]] })).filter((p) => p.id !== personId && p.active !== false);
    const total = others.reduce((a, p) => a + (p.shareBps ?? 0), 0) + data.shareBps;
    assert(total <= 10000, `A soma das participações ultrapassa 100% (${(total / 100).toFixed(2)}%).`);
  }
  if (data.isPrimary && !before.isPrimary) await clearPrimary(ctx, before.clientId, data.kind);
  const after = await ctx.store.update("accounting_client_people", personId, data);
  await audit(ctx, { module: "accounting", action: "client.person_update", entityType: "accounting_client", entityId: before.clientId, summary: `${client.name}: pessoa ${data.name} alterada`, before, after: data });
  return after;
}

export async function removePerson(ctx: Ctx, personId: string): Promise<void> {
  requirePerm(ctx, "accounting", "edit");
  const before = await ctx.store.get("accounting_client_people", personId);
  if (!before) throw new NotFoundError("accounting_client_people", personId);
  const client = await getClient(ctx, before.clientId);
  await ctx.store.delete("accounting_client_people", personId);
  await audit(ctx, { module: "accounting", action: "client.person_remove", entityType: "accounting_client", entityId: before.clientId, summary: `${client.name}: pessoa ${before.name} removida`, before });
}

async function clearPrimary(ctx: Ctx, clientId: string, kind: string) {
  const rows = await listAll(ctx.store, "accounting_client_people", { filters: [["eq", "clientId", clientId], ["eq", "kind", kind], ["eq", "isPrimary", true]] });
  for (const r of rows) await ctx.store.update("accounting_client_people", r.id, { isPrimary: false });
}

// ───────────────────────────── Estabelecimentos (filiais do cliente)

export interface EstablishmentInput {
  kind: "matriz" | "filial";
  name?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  im?: string | null;
  address?: Record<string, any> | null;
  status?: string | null;
  notes?: string | null;
}

function establishmentData(input: EstablishmentInput) {
  assert(input.kind === "matriz" || input.kind === "filial", "Tipo de estabelecimento inválido.");
  const cnpj = onlyDigits(input.cnpj) || null;
  if (cnpj) assert(isValidCnpj(cnpj), "CNPJ inválido.");
  const address = cleanAddress(input.address ?? undefined);
  validateAddress(address);
  if (address.uf) assert(UFS.includes(address.uf), "UF inválida.");
  const status = input.status || "active";
  assert(["active", "inactive"].includes(status), "Situação inválida.");
  return { kind: input.kind, name: input.name?.trim() || null, cnpj, ie: input.ie?.trim().toUpperCase() || null, im: input.im?.trim() || null, address, uf: address.uf || null, cityName: address.cityName || null, cityCode: address.cityCode || null, status, notes: input.notes?.trim() || null };
}

export async function listEstablishments(ctx: Ctx, clientId: string): Promise<Doc[]> {
  await getClient(ctx, clientId);
  return (await listAll(ctx.store, "accounting_client_establishments", { filters: [["eq", "clientId", clientId]] })).sort((a, b) => (a.kind === "matriz" ? -1 : 1) - (b.kind === "matriz" ? -1 : 1) || String(a.cnpj ?? "").localeCompare(String(b.cnpj ?? "")));
}

export async function addEstablishment(ctx: Ctx, clientId: string, input: EstablishmentInput): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const client = await getClient(ctx, clientId);
  assert(client.personType === "PJ", "Somente pessoa jurídica tem estabelecimentos.");
  const data = establishmentData(input);
  if (data.cnpj) {
    assert(!client.doc || data.cnpj.slice(0, 8) === client.doc.slice(0, 8), "O CNPJ do estabelecimento precisa ter a mesma raiz do CNPJ do cliente.");
    const dup = (await listAll(ctx.store, "accounting_client_establishments", { filters: [["eq", "clientId", clientId], ["eq", "cnpj", data.cnpj]] }))[0];
    if (dup) throw new BusinessError("Estabelecimento com este CNPJ já cadastrado.", "duplicate");
  }
  const row = await ctx.store.create("accounting_client_establishments", { ...data, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId });
  await audit(ctx, { module: "accounting", action: "client.establishment_add", entityType: "accounting_client", entityId: clientId, summary: `${client.name}: estabelecimento ${data.kind} ${data.cnpj ?? data.name ?? ""} adicionado`, after: data });
  return row;
}

export async function updateEstablishment(ctx: Ctx, id: string, input: EstablishmentInput): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const before = await ctx.store.get("accounting_client_establishments", id);
  if (!before) throw new NotFoundError("accounting_client_establishments", id);
  const client = await getClient(ctx, before.clientId);
  const data = establishmentData(input);
  if (data.cnpj && data.cnpj !== before.cnpj) {
    assert(!client.doc || data.cnpj.slice(0, 8) === client.doc.slice(0, 8), "O CNPJ do estabelecimento precisa ter a mesma raiz do CNPJ do cliente.");
    const dup = (await listAll(ctx.store, "accounting_client_establishments", { filters: [["eq", "clientId", before.clientId], ["eq", "cnpj", data.cnpj]] })).find((e) => e.id !== id);
    if (dup) throw new BusinessError("Estabelecimento com este CNPJ já cadastrado.", "duplicate");
  }
  const after = await ctx.store.update("accounting_client_establishments", id, data);
  await audit(ctx, { module: "accounting", action: "client.establishment_update", entityType: "accounting_client", entityId: before.clientId, summary: `${client.name}: estabelecimento ${data.cnpj ?? data.name ?? ""} alterado`, before, after: data });
  return after;
}

export async function removeEstablishment(ctx: Ctx, id: string): Promise<void> {
  requirePerm(ctx, "accounting", "edit");
  const before = await ctx.store.get("accounting_client_establishments", id);
  if (!before) throw new NotFoundError("accounting_client_establishments", id);
  const client = await getClient(ctx, before.clientId);
  await ctx.store.delete("accounting_client_establishments", id);
  await audit(ctx, { module: "accounting", action: "client.establishment_remove", entityType: "accounting_client", entityId: before.clientId, summary: `${client.name}: estabelecimento ${before.cnpj ?? before.name ?? ""} removido`, before });
}
