import { detId, findOne, listAll, newId, isConflict } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError } from "@/lib/core/errors";
import { NotFoundError } from "@/lib/db/types";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { isValidCnpj, isValidCpf, onlyDigits, searchable } from "@/lib/core/text";
import { addDays, nowIso, today } from "@/lib/dates";
import { REGIMES, CRT_OPTIONS, cleanAddress, validateAddress } from "../companies";
import { CLIENT_STATUS, SERVICE_CATALOG, requireFirm } from "./common";
import { visibleClientIds } from "./team";

export interface ClientInput {
  personType: "PF" | "PJ";
  doc?: string | null;
  name: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: string | null;
  ie?: string | null;
  im?: string | null;
  regime?: string | null;
  crt?: string | null;
  cnae?: string | null;
  cnaes?: string[] | null;
  legalNature?: string | null;
  size?: string | null;
  openedAt?: string | null;
  address?: Record<string, any> | null;
  status?: string | null;
  onboardedAt?: string | null;
  serviceStartAt?: string | null;
  services?: string[] | null;
  groupId?: string | null;
  responsibleUserId?: string | null;
  employeesCount?: number | null;
  monthlyDocs?: number | null;
  monthlyEntries?: number | null;
  systems?: Array<{ name: string; kind?: string }> | null;
  commPrefs?: { channel?: string | null; notes?: string | null } | null;
  tags?: string[] | null;
  notes?: string | null;
  /** resultado da consulta de CNPJ (fonte e data), quando usada para preencher */
  docLookup?: Record<string, any> | null;
  rfbStatus?: string | null;
}

const clean = (v: string | null | undefined) => (v ?? "").trim() || null;

function clientData(input: ClientInput) {
  assert(input.personType === "PF" || input.personType === "PJ", "Informe se o cliente é pessoa física ou jurídica.");
  assert(input.name?.trim(), "Informe o nome / razão social.");
  const doc = onlyDigits(input.doc) || null;
  if (doc) {
    if (input.personType === "PF") assert(isValidCpf(doc), "CPF inválido.");
    else assert(isValidCnpj(doc), "CNPJ inválido.");
  }
  const regime = clean(input.regime);
  if (regime) assert(REGIMES.some((r) => r.value === regime), "Regime tributário inválido.");
  const crt = clean(input.crt) || (regime ? REGIMES.find((r) => r.value === regime)?.crt ?? null : null);
  if (crt) assert(CRT_OPTIONS.some((c) => c.value === crt), "CRT inválido.");
  const cnae = onlyDigits(input.cnae) || null;
  if (cnae) assert(/^\d{7}$/.test(cnae), "CNAE deve ter 7 dígitos.");
  const cnaes = [...new Set((input.cnaes ?? []).map((c) => onlyDigits(c)).filter((c) => /^\d{7}$/.test(c) && c !== cnae))];
  const status = clean(input.status) ?? "onboarding";
  assert(CLIENT_STATUS.some((s) => s.value === status), "Situação inválida.");
  const services = [...new Set((input.services ?? []).filter((s) => SERVICE_CATALOG.some((c) => c.key === s)))];
  const address = cleanAddress(input.address ?? undefined);
  validateAddress(address);
  const email = clean(input.email)?.toLowerCase() ?? null;
  if (email) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "E-mail inválido.");
  const int = (v: number | null | undefined, label: string) => {
    if (v == null || Number.isNaN(v)) return null;
    assert(Number.isInteger(v) && v >= 0, `${label} deve ser um número inteiro não negativo.`);
    return v;
  };
  return {
    personType: input.personType,
    doc,
    name: input.name.trim(),
    tradeName: clean(input.tradeName),
    email,
    phone: onlyDigits(input.phone) || null,
    ie: clean(input.ie)?.toUpperCase() ?? null,
    im: clean(input.im),
    regime,
    crt,
    cnae,
    cnaes,
    legalNature: clean(input.legalNature),
    size: clean(input.size),
    openedAt: clean(input.openedAt),
    address,
    cityName: address.cityName || null,
    uf: address.uf || null,
    status,
    onboardedAt: clean(input.onboardedAt) ?? today(),
    serviceStartAt: clean(input.serviceStartAt),
    services,
    groupId: clean(input.groupId),
    responsibleUserId: clean(input.responsibleUserId),
    employeesCount: int(input.employeesCount, "Número de funcionários"),
    monthlyDocs: int(input.monthlyDocs, "Documentos por mês"),
    monthlyEntries: int(input.monthlyEntries, "Lançamentos por mês"),
    systems: (input.systems ?? []).filter((s) => s?.name?.trim()).map((s) => ({ name: s.name.trim(), kind: clean(s.kind) })),
    commPrefs: input.commPrefs ? { channel: clean(input.commPrefs.channel), notes: clean(input.commPrefs.notes) } : null,
    tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    notes: clean(input.notes),
    rfbStatus: clean(input.rfbStatus),
    searchText: searchable(input.name, input.tradeName, doc, email, address.cityName, ...(input.tags ?? [])),
  };
}

async function assertRefs(ctx: Ctx, data: ReturnType<typeof clientData>) {
  if (data.groupId) {
    const g = await ctx.store.get("accounting_client_groups", data.groupId);
    if (!g || g.companyId !== ctx.companyId) throw new BusinessError("Grupo de clientes inexistente.", "invalid_group");
  }
  if (data.responsibleUserId) {
    const u = await ctx.store.get("users", data.responsibleUserId);
    if (!u || u.status !== "active" || !(u.isAdmin || (u.companyIds ?? []).includes(ctx.companyId))) throw new BusinessError("O responsável precisa ser um usuário ativo do escritório.", "invalid_user");
  }
}

async function assertUniqueDoc(ctx: Ctx, doc: string | null, selfId?: string) {
  if (!doc) return;
  const dup = await findOne(ctx.store, "accounting_clients", [["eq", "companyId", ctx.companyId], ["eq", "doc", doc]]);
  if (dup && dup.id !== selfId) throw new BusinessError(`Já existe cliente com este ${doc.length === 11 ? "CPF" : "CNPJ"}: ${dup.name}${dup.code ? ` (${dup.code})` : ""}.`, "duplicate");
}

/** Cliente da carteira do escritório, visível ao usuário (carteira restrita quando não tem "Ver toda a carteira"). */
export async function getClient(ctx: Ctx, id: string): Promise<Doc> {
  requirePerm(ctx, "accounting", "view");
  const c = await ctx.store.get("accounting_clients", id);
  if (!c) throw new NotFoundError("accounting_clients", id);
  const visible = await visibleClientIds(ctx);
  if (visible && !visible.has(c.id)) throw new BusinessError("Este cliente não está na sua carteira.", "forbidden");
  return c;
}

export async function createClient(ctx: Ctx, input: ClientInput & { idemKey?: string }): Promise<Doc> {
  requirePerm(ctx, "accounting", "create");
  await requireFirm(ctx);
  const id = input.idemKey ? detId("acct_client", ctx.companyId, input.idemKey) : newId();
  const prev = await ctx.store.get("accounting_clients", id);
  if (prev) return prev;
  const data = clientData(input);
  await assertRefs(ctx, data);
  await assertUniqueDoc(ctx, data.doc);
  const n = await nextNumber(ctx.store, `acct_client:${ctx.companyId}`);
  const code = `C${String(n).padStart(4, "0")}`;
  let created: Doc;
  try {
    created = await ctx.store.create("accounting_clients", {
      ...data, code, companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, linkStatus: "none", docLookup: input.docLookup ?? null,
      rfbCheckedAt: input.docLookup?.consultedAt ?? null,
    }, id);
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Já existe cliente com este CPF/CNPJ no escritório.", "duplicate");
    throw e;
  }
  // histórico de regime começa na entrada do cliente
  if (data.regime) {
    await ctx.store.create("accounting_client_regimes", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId: created.id, regime: data.regime, crt: data.crt, validFrom: data.serviceStartAt ?? data.onboardedAt, validTo: null, reason: "Cadastro do cliente", source: input.docLookup?.source ?? null });
  }
  await audit(ctx, { module: "accounting", action: "client.create", entityType: "accounting_client", entityId: created.id, summary: `Cliente contábil ${code} — ${data.name} cadastrado (${data.personType}${data.doc ? `, ${data.doc}` : ""})`, after: data });
  return created;
}

export async function updateClient(ctx: Ctx, id: string, input: ClientInput): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const before = await getClient(ctx, id);
  const data = clientData(input);
  await assertRefs(ctx, data);
  await assertUniqueDoc(ctx, data.doc, id);
  // regime só pelo histórico (changeClientRegime) e situação só por setClientStatus: a edição do cadastro não os altera
  const patch = {
    ...data, regime: before.regime ?? data.regime, crt: before.crt ?? data.crt, onboardedAt: before.onboardedAt ?? data.onboardedAt, status: before.status, endedAt: before.endedAt ?? null, endReason: before.endReason ?? null,
    // reconsulta do CNPJ na edição atualiza a fonte e a data da consulta junto com a situação na Receita
    ...(input.docLookup ? { docLookup: input.docLookup, rfbCheckedAt: input.docLookup.consultedAt ?? null } : {}),
  };
  if (before.linkStatus === "active" && before.doc && data.doc !== before.doc) throw new BusinessError("Cliente vinculado a uma empresa do ERP: o CNPJ não pode ser alterado enquanto o vínculo estiver ativo.", "linked");
  let after: Doc;
  try {
    after = await ctx.store.update("accounting_clients", id, patch);
  } catch (e) {
    if (isConflict(e)) throw new BusinessError("Já existe cliente com este CPF/CNPJ no escritório.", "duplicate");
    throw e;
  }
  const d = diff(before, after);
  if (Object.keys(d.after).length) await audit(ctx, { module: "accounting", action: "client.update", entityType: "accounting_client", entityId: id, summary: `Cliente ${after.code} — ${after.name} alterado`, before: d.before, after: d.after });
  return after;
}

/** Transição de situação (implantação → ativo → encerramento → encerrado), com datas e motivo. */
export async function setClientStatus(ctx: Ctx, id: string, status: string, input: { reason?: string | null; date?: string | null } = {}): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const before = await getClient(ctx, id);
  assert(CLIENT_STATUS.some((s) => s.value === status), "Situação inválida.");
  if (status === before.status) return before;
  const allowed: Record<string, string[]> = { onboarding: ["active", "closed"], active: ["offboarding", "closed"], offboarding: ["closed", "active"], closed: ["active"] };
  const label = (v: string) => CLIENT_STATUS.find((s) => s.value === v)?.label ?? v;
  if (!allowed[before.status]?.includes(status)) throw new BusinessError(`Não é possível passar de "${label(before.status)}" para "${label(status)}".`, "invalid_transition");
  if (status === "closed") assert(input.reason?.trim(), "Informe o motivo do encerramento.");
  if (status === "closed" && before.linkStatus === "active") throw new BusinessError("Desfaça o vínculo com a empresa do ERP antes de encerrar o cliente.", "linked");
  const date = input.date || today();
  const patch: Record<string, any> = { status };
  if (status === "active") Object.assign(patch, { serviceStartAt: before.serviceStartAt ?? date, endedAt: null, endReason: null });
  if (status === "closed") Object.assign(patch, { endedAt: date, endReason: input.reason!.trim() });
  const after = await ctx.store.update("accounting_clients", id, patch);
  await audit(ctx, { module: "accounting", action: "client.status", entityType: "accounting_client", entityId: id, summary: `Cliente ${after.code} — ${after.name}: ${before.status} → ${status}${input.reason ? ` (${input.reason})` : ""}`, before: { status: before.status }, after: patch, reason: input.reason ?? null });
  return after;
}

/** Mudança de regime com vigência: fecha o período anterior na véspera e abre o novo; o histórico nunca é sobrescrito. */
export async function changeClientRegime(ctx: Ctx, id: string, input: { regime: string; crt?: string | null; validFrom: string; reason?: string | null }): Promise<Doc> {
  requirePerm(ctx, "accounting", "edit");
  const client = await getClient(ctx, id);
  assert(REGIMES.some((r) => r.value === input.regime), "Regime tributário inválido.");
  const crt = input.crt || REGIMES.find((r) => r.value === input.regime)!.crt;
  assert(CRT_OPTIONS.some((c) => c.value === crt), "CRT inválido.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom), "Informe a data de início da vigência.");
  const history = (await listAll(ctx.store, "accounting_client_regimes", { filters: [["eq", "clientId", id]] })).sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));
  const current = history.find((h) => !h.validTo);
  if (current) {
    assert(input.validFrom > current.validFrom, `A nova vigência precisa começar depois de ${current.validFrom} (início do regime atual).`);
    if (current.regime === input.regime && current.crt === crt) throw new BusinessError("O cliente já está neste regime.", "same_regime");
  }
  const previous: Doc | null = current ? await ctx.store.update("accounting_client_regimes", current.id, { validTo: addDays(input.validFrom, -1) }) : null;
  const row = await ctx.store.create("accounting_client_regimes", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, clientId: id, regime: input.regime, crt, validFrom: input.validFrom, validTo: null, reason: input.reason?.trim() || null, source: "manual" });
  // o regime "atual" do cadastro acompanha a vigência em curso (mudança futura só vale a partir da data)
  const effectiveNow = input.validFrom <= today();
  const after = effectiveNow ? await ctx.store.update("accounting_clients", id, { regime: input.regime, crt }) : client;
  await audit(ctx, { module: "accounting", action: "client.regime", entityType: "accounting_client", entityId: id, summary: `Regime de ${client.name}: ${current?.regime ?? "—"} → ${input.regime} a partir de ${input.validFrom}${effectiveNow ? "" : " (vigência futura)"}`, before: previous ? { regime: previous.regime, validFrom: previous.validFrom } : null, after: { regime: input.regime, crt, validFrom: input.validFrom }, reason: input.reason ?? null, related: [`accounting_client_regime:${row.id}`] });
  return after;
}

/** Regime vigente numa data (histórico), ou o do cadastro quando não há histórico. */
export async function regimeAt(ctx: Ctx, clientId: string, date: string): Promise<{ regime: string | null; crt: string | null; from?: string | null; to?: string | null }> {
  const history = await listAll(ctx.store, "accounting_client_regimes", { filters: [["eq", "clientId", clientId]] });
  const hit = history.find((h) => h.validFrom <= date && (!h.validTo || h.validTo >= date));
  if (hit) return { regime: hit.regime, crt: hit.crt, from: hit.validFrom, to: hit.validTo };
  const c = await ctx.store.get("accounting_clients", clientId);
  return { regime: c?.regime ?? null, crt: c?.crt ?? null };
}

export async function clientRegimeHistory(ctx: Ctx, clientId: string): Promise<Doc[]> {
  await getClient(ctx, clientId);
  return (await listAll(ctx.store, "accounting_client_regimes", { filters: [["eq", "clientId", clientId]] })).sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)));
}

/**
 * Consulta pública do CNPJ (BrasilAPI — dados da Receita Federal) com os campos que o cadastro contábil usa:
 * razão social, fantasia, CNAE principal e secundários, natureza jurídica, porte, abertura, situação cadastral,
 * endereço e quadro societário (para pré-preencher as pessoas). Sempre devolve a fonte e a data da consulta.
 */
export async function lookupClientCnpj(cnpj: string) {
  const d = onlyDigits(cnpj);
  assert(isValidCnpj(d), "CNPJ inválido.");
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return { ok: false as const, message: "CNPJ não encontrado na base consultada." };
    if (!res.ok) return { ok: false as const, message: `Serviço de consulta indisponível (HTTP ${res.status}).` };
    const j: any = await res.json();
    const source = "BrasilAPI (dados públicos da Receita Federal)";
    const consultedAt = nowIso();
    return {
      ok: true as const,
      source,
      consultedAt,
      data: {
        name: j.razao_social as string,
        tradeName: (j.nome_fantasia as string) || null,
        email: (j.email as string) || null,
        phone: (j.ddd_telefone_1 as string) || null,
        cnae: j.cnae_fiscal ? String(j.cnae_fiscal).padStart(7, "0") : null,
        cnaeDescription: (j.cnae_fiscal_descricao as string) || null,
        cnaes: Array.isArray(j.cnaes_secundarios) ? j.cnaes_secundarios.map((c: any) => String(c.codigo).padStart(7, "0")).filter((c: string) => /^\d{7}$/.test(c)) : [],
        legalNature: j.natureza_juridica ? `${j.codigo_natureza_juridica ?? ""} ${j.natureza_juridica}`.trim() : null,
        size: (j.porte as string) || null,
        openedAt: (j.data_inicio_atividade as string) || null,
        rfbStatus: (j.descricao_situacao_cadastral as string) || null,
        simples: j.opcao_pelo_simples === true ? true : j.opcao_pelo_simples === false ? false : null,
        mei: j.opcao_pelo_mei === true ? true : j.opcao_pelo_mei === false ? false : null,
        address: { zip: j.cep, street: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" "), number: j.numero, complement: j.complemento, district: j.bairro, cityName: j.municipio, cityCode: j.codigo_municipio_ibge ? String(j.codigo_municipio_ibge) : undefined, uf: j.uf },
        partners: Array.isArray(j.qsa) ? j.qsa.map((p: any) => ({ name: p.nome_socio as string, qualification: (p.qualificacao_socio as string) || null, doc: (p.cnpj_cpf_do_socio as string) || null, since: (p.data_entrada_sociedade as string) || null })) : [],
      },
      lookup: { source, consultedAt, cnpj: d },
    };
  } catch (e: any) {
    return { ok: false as const, message: `Não foi possível consultar o serviço externo (${e.message}). Preencha manualmente.` };
  }
}

/** Sugestão de regime a partir da consulta (sem decidir pelo contador). */
export function suggestRegime(l: { simples: boolean | null; mei: boolean | null }): string | null {
  if (l.mei) return "mei";
  if (l.simples) return "simples";
  return null;
}
