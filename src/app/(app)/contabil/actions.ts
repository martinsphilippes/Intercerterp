"use server";

import { runAction, fstr, fopt, fbool, fint, fjson } from "@/lib/server/action";
import {
  createClient, updateClient, setClientStatus, changeClientRegime, lookupClientCnpj, type ClientInput,
  addPerson, updatePerson, removePerson, addEstablishment, updateEstablishment, removeEstablishment, type PersonInput, type EstablishmentInput,
  saveDepartment, setDepartmentMember, assignResponsible, endAssignment, saveGroup,
  issueLinkCode, cancelLinkCode, revokeAccountingLink, acceptAccountingLink,
  reviewDelivery, CLIENT_STATUS,
} from "@/domain/accounting";

const PATHS = ["/contabil", "/contabil/clientes", "/contabil/entregas", "/contabil/equipe", "/contabil/grupos"];

function parseClient(fd: FormData): ClientInput {
  const num = (k: string) => (fd.has(k) && fstr(fd, k) !== "" ? fint(fd, k) : null);
  return {
    personType: (fstr(fd, "personType") as "PF" | "PJ") || "PJ",
    doc: fopt(fd, "doc"),
    name: fstr(fd, "name"),
    tradeName: fopt(fd, "tradeName"),
    email: fopt(fd, "email"),
    phone: fopt(fd, "phone"),
    ie: fopt(fd, "ie"),
    im: fopt(fd, "im"),
    regime: fopt(fd, "regime"),
    crt: fopt(fd, "crt"),
    cnae: fopt(fd, "cnae"),
    cnaes: fstr(fd, "cnaes").split(/[\s,;]+/).filter(Boolean),
    legalNature: fopt(fd, "legalNature"),
    size: fopt(fd, "size"),
    openedAt: fopt(fd, "openedAt"),
    address: fjson(fd, "address", null) ?? { zip: fopt(fd, "zip"), street: fopt(fd, "street"), number: fopt(fd, "number"), complement: fopt(fd, "complement"), district: fopt(fd, "district"), cityName: fopt(fd, "cityName"), cityCode: fopt(fd, "cityCode"), uf: fopt(fd, "uf") },
    status: fopt(fd, "status"),
    onboardedAt: fopt(fd, "onboardedAt"),
    serviceStartAt: fopt(fd, "serviceStartAt"),
    services: fd.getAll("services").map(String),
    groupId: fopt(fd, "groupId"),
    responsibleUserId: fopt(fd, "responsibleUserId"),
    employeesCount: num("employeesCount"),
    monthlyDocs: num("monthlyDocs"),
    monthlyEntries: num("monthlyEntries"),
    systems: fjson(fd, "systems", []),
    commPrefs: { channel: fopt(fd, "commChannel"), notes: fopt(fd, "commNotes") },
    tags: fstr(fd, "tags").split(/[,;]+/).map((t) => t.trim()).filter(Boolean),
    notes: fopt(fd, "notes"),
    docLookup: fjson(fd, "docLookup", null),
    rfbStatus: fopt(fd, "rfbStatus"),
  };
}

export async function saveClientAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "accounting", op: id ? "edit" : "create", revalidate: PATHS }, async (s) => {
    const input = parseClient(fd);
    const idem = fstr(fd, "_idem");
    const c = id ? await updateClient(s.ctx, id, input) : await createClient(s.ctx, { ...input, idemKey: idem ? `ui:${idem}` : undefined });
    return { ok: true as const, data: { id: c.id }, message: id ? "Cliente atualizado." : `Cliente ${c.code} cadastrado.`, redirect: `/contabil/clientes/${c.id}` };
  });
}

export async function lookupClientCnpjAction(cnpj: string) {
  // consulta pública (BrasilAPI): basta ver o módulo — quem só edita também pode reconsultar o CNPJ na edição
  return runAction({ module: "accounting", op: "view" }, async () => {
    const r = await lookupClientCnpj(cnpj);
    if (!r.ok) return { ok: false as const, error: r.message };
    return { ok: true as const, data: { source: r.source, consultedAt: r.consultedAt, lookup: r.lookup, ...r.data } };
  });
}

export async function setClientStatusAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const id = fstr(fd, "id");
    const c = await setClientStatus(s.ctx, id, fstr(fd, "status"), { reason: fopt(fd, "reason"), date: fopt(fd, "date") });
    return { ok: true as const, message: `Situação alterada para ${CLIENT_STATUS.find((x) => x.value === c.status)?.label ?? c.status}.` };
  });
}

export async function changeRegimeAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await changeClientRegime(s.ctx, fstr(fd, "id"), { regime: fstr(fd, "regime"), crt: fopt(fd, "crt"), validFrom: fstr(fd, "validFrom"), reason: fopt(fd, "reason") });
    return { ok: true as const, message: "Regime registrado com vigência." };
  });
}

// ───────────────────────────── Pessoas e estabelecimentos

function parsePerson(fd: FormData): PersonInput {
  return {
    kind: fstr(fd, "kind") || "contact",
    name: fstr(fd, "name"),
    doc: fopt(fd, "doc"),
    qualification: fopt(fd, "qualification"),
    shareBps: fd.has("sharePct") && fstr(fd, "sharePct") !== "" ? Math.round(Number(fstr(fd, "sharePct").replace(",", ".")) * 100) : null,
    email: fopt(fd, "email"),
    phone: fopt(fd, "phone"),
    department: fopt(fd, "department"),
    isPrimary: fbool(fd, "isPrimary"),
    startAt: fopt(fd, "startAt"),
    endAt: fopt(fd, "endAt"),
    notes: fopt(fd, "notes"),
  };
}

export async function savePersonAction(fd: FormData) {
  const personId = fopt(fd, "personId");
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    if (personId) await updatePerson(s.ctx, personId, parsePerson(fd));
    else await addPerson(s.ctx, fstr(fd, "clientId"), parsePerson(fd));
    return { ok: true as const, message: "Pessoa salva." };
  });
}

export async function removePersonAction(personId: string) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await removePerson(s.ctx, personId);
    return { ok: true as const, message: "Pessoa removida." };
  });
}

function parseEstablishment(fd: FormData): EstablishmentInput {
  return {
    kind: (fstr(fd, "kind") as "matriz" | "filial") || "filial",
    name: fopt(fd, "name"),
    cnpj: fopt(fd, "cnpj"),
    ie: fopt(fd, "ie"),
    im: fopt(fd, "im"),
    address: fjson(fd, "address", null) ?? { zip: fopt(fd, "zip"), street: fopt(fd, "street"), number: fopt(fd, "number"), complement: fopt(fd, "complement"), district: fopt(fd, "district"), cityName: fopt(fd, "cityName"), cityCode: fopt(fd, "cityCode"), uf: fopt(fd, "uf") },
    status: fopt(fd, "status"),
    notes: fopt(fd, "notes"),
  };
}

export async function saveEstablishmentAction(fd: FormData) {
  const id = fopt(fd, "establishmentId");
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    if (id) await updateEstablishment(s.ctx, id, parseEstablishment(fd));
    else await addEstablishment(s.ctx, fstr(fd, "clientId"), parseEstablishment(fd));
    return { ok: true as const, message: "Estabelecimento salvo." };
  });
}

export async function removeEstablishmentAction(id: string) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await removeEstablishment(s.ctx, id);
    return { ok: true as const, message: "Estabelecimento removido." };
  });
}

// ───────────────────────────── Equipe, responsáveis e grupos

export async function saveDepartmentAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const d = await saveDepartment(s.ctx, id, { name: fstr(fd, "name"), kind: fopt(fd, "kind"), key: fopt(fd, "key"), managerUserId: fopt(fd, "managerUserId"), active: fd.has("active") ? fbool(fd, "active") : true });
    return { ok: true as const, data: { id: d.id }, message: "Departamento salvo." };
  });
}

export async function setDepartmentMemberAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await setDepartmentMember(s.ctx, fstr(fd, "departmentId"), fstr(fd, "userId"), (fstr(fd, "role") as "manager" | "member" | "remove") || "member");
    return { ok: true as const, message: "Equipe atualizada." };
  });
}

export async function assignResponsibleAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await assignResponsible(s.ctx, fstr(fd, "clientId"), { departmentId: fopt(fd, "departmentId"), userId: fstr(fd, "userId"), role: (fstr(fd, "role") as "titular" | "substituto") || "titular", validFrom: fopt(fd, "validFrom"), validTo: fopt(fd, "validTo") });
    return { ok: true as const, message: "Responsável definido." };
  });
}

export async function endAssignmentAction(assignmentId: string) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await endAssignment(s.ctx, assignmentId);
    return { ok: true as const, message: "Responsabilidade encerrada." };
  });
}

export async function saveGroupAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "accounting", op: id ? "edit" : "create", revalidate: PATHS }, async (s) => {
    const g = await saveGroup(s.ctx, id, { name: fstr(fd, "name"), kind: fopt(fd, "kind"), notes: fopt(fd, "notes"), active: fd.has("active") ? fbool(fd, "active") : true });
    return { ok: true as const, data: { id: g.id }, message: "Grupo salvo." };
  });
}

// ───────────────────────────── Vínculo com a empresa do ERP

export async function issueLinkCodeAction(clientId: string) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const r = await issueLinkCode(s.ctx, clientId);
    return { ok: true as const, data: r, message: "Código de vínculo emitido — informe-o ao administrador da empresa no ERP." };
  });
}

export async function cancelLinkCodeAction(clientId: string) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await cancelLinkCode(s.ctx, clientId);
    return { ok: true as const, message: "Código cancelado." };
  });
}

export async function revokeLinkByFirmAction(clientId: string) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await revokeAccountingLink(s.ctx, "firm", clientId);
    return { ok: true as const, message: "Vínculo desfeito. As entregas já recebidas foram mantidas." };
  });
}

/** Lado da EMPRESA no ERP (Administração → Integrações → Área da contabilidade). */
export async function acceptLinkCodeAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: ["/administracao/integracoes", "/administracao/integracoes/accounting"] }, async (s) => {
    const r = await acceptAccountingLink(s.ctx, fstr(fd, "code"));
    return { ok: true as const, message: `Empresa vinculada ao escritório ${r.firm.tradeName || r.firm.name}. Os pacotes mensais passam a entrar na caixa de entrada dele.` };
  });
}

export async function revokeLinkByCompanyAction() {
  return runAction({ module: "admin", op: "edit", revalidate: ["/administracao/integracoes", "/administracao/integracoes/accounting"] }, async (s) => {
    await revokeAccountingLink(s.ctx, "company");
    return { ok: true as const, message: "Vínculo com o escritório desfeito." };
  });
}

// ───────────────────────────── Caixa de entrada

export async function reviewDeliveryAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await reviewDelivery(s.ctx, fstr(fd, "id"), { notes: fopt(fd, "notes"), undo: fbool(fd, "undo") });
    return { ok: true as const, message: fbool(fd, "undo") ? "Entrega reaberta." : "Entrega conferida." };
  });
}
