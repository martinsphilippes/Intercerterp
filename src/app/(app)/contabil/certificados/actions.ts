"use server";

import { runAction, fstr, fopt, fbool, fjson } from "@/lib/server/action";
import { parseMoney } from "@/lib/money";
import {
  createCertificateRequest, sendCertificateCharge, cancelCertificateRequest, requestCertificateEmission, recordCertificateAuthorization, requestDownloadAuthorization, requestTrackingAccess, registerKnownCertificate,
  confirmCertificatePayment, scheduleCertificateValidation, approveCertificateValidation, rejectCertificateValidation, registerCertificateEmission, registerCertificateEmissionFailure, saveCertificationSettings,
  setCertificateTracking, authorizeCertificateDownloadByCompany, CHARGE_CHANNEL_LABEL,
} from "@/domain/accounting";

const PATHS = ["/contabil", "/contabil/certificados", "/contabil/clientes", "/administracao/certificacao", "/administracao/integracoes"];

async function upload(fd: FormData, key: string): Promise<{ name: string; mime: string; data: Buffer } | null> {
  const f = fd.get(key);
  if (!f || typeof f === "string" || !(f as File).size) return null;
  const file = f as File;
  return { name: file.name || "arquivo", mime: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) };
}

/** `datetime-local` (sem fuso) é interpretado no horário de Brasília (o fuso padrão do sistema). */
function localToIso(v: string): string {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t)) return new Date(`${t.length === 16 ? `${t}:00` : t}-03:00`).toISOString();
  return t;
}

// ----------------------------------------------------------------------------------------------------------------- escritório

export async function createCertificateRequestAction(fd: FormData) {
  return runAction({ module: "accounting", op: "create", revalidate: PATHS }, async (s) => {
    const amountRaw = fopt(fd, "amount");
    const r = await createCertificateRequest(s.ctx, {
      clientId: fstr(fd, "clientId"), kind: (fstr(fd, "kind") as "new" | "renewal") || "new", product: fstr(fd, "product"), amount: amountRaw ? parseMoney(amountRaw) : null, dueDate: fstr(fd, "dueDate"),
      contactEmail: fopt(fd, "contactEmail"), contactPhone: fopt(fd, "contactPhone"), notes: fopt(fd, "notes"), previousCertificateId: fopt(fd, "previousCertificateId"), responsibleUserId: fopt(fd, "responsibleUserId"),
    });
    return { ok: true as const, data: { id: r.id, protocol: r.protocol }, message: `Solicitação ${r.protocol} criada. Próxima etapa: conferir e enviar a cobrança.`, redirect: `/contabil/certificados/${r.id}` };
  });
}

export async function sendChargeAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const res = await sendCertificateCharge(s.ctx, fstr(fd, "id"), { channel: fstr(fd, "channel") as any, to: fopt(fd, "to"), dueDate: fopt(fd, "dueDate"), message: fopt(fd, "message") });
    return { ok: true as const, data: res, message: res.channel === "email" ? `Cobrança enviada por e-mail para ${res.to}.` : `Envio por ${CHARGE_CHANNEL_LABEL[res.channel] ?? res.channel} registrado para ${res.to}.` };
  });
}

export async function cancelRequestAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const r = await cancelCertificateRequest(s.ctx, fstr(fd, "id"), { reason: fstr(fd, "reason") });
    return { ok: true as const, message: `Solicitação ${r.protocol} cancelada.` };
  });
}

export async function requestEmissionAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const r = await requestCertificateEmission(s.ctx, fstr(fd, "id"));
    return { ok: true as const, message: r.emissionAttempts > 1 ? `Nova tentativa de emissão pedida (${r.emissionAttempts}ª), sem nova cobrança.` : "Emissão solicitada. Acompanhe o retorno da certificadora neste protocolo." };
  });
}

export async function recordAuthorizationAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const r = await recordCertificateAuthorization(s.ctx, fstr(fd, "id"), { notes: fstr(fd, "notes"), evidence: await upload(fd, "evidence") });
    return { ok: true as const, message: r.status === "ready_to_download" ? "Autorização registrada. O certificado está pronto para baixar." : "Autorização do titular registrada." };
  });
}

export async function requestDownloadAuthorizationAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await requestDownloadAuthorization(s.ctx, fstr(fd, "id"));
    return { ok: true as const, message: "Pedido de autorização enviado aos administradores da empresa no ERP." };
  });
}

export async function requestTrackingAccessAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    await requestTrackingAccess(s.ctx, fstr(fd, "clientId"));
    return { ok: true as const, message: "Pedido de acesso enviado aos administradores da empresa no ERP." };
  });
}

export async function registerKnownCertificateAction(fd: FormData) {
  return runAction({ module: "accounting", op: "edit", revalidate: PATHS }, async (s) => {
    const row = await registerKnownCertificate(s.ctx, fstr(fd, "clientId"), { holderName: fopt(fd, "holderName"), productLabel: fopt(fd, "productLabel"), serial: fopt(fd, "serial"), issuer: fopt(fd, "issuer"), validFrom: fopt(fd, "validFrom"), validTo: fstr(fd, "validTo"), notes: fopt(fd, "notes") });
    return { ok: true as const, data: { id: row.id }, message: "Certificado registrado na carteira." };
  });
}

// ------------------------------------------------------------------------------------------------------ equipe de certificação

export async function confirmPaymentAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    const amountRaw = fopt(fd, "amount");
    const paidAt = fopt(fd, "paidAt");
    const r = await confirmCertificatePayment(s.ctx, fstr(fd, "id"), { ref: fstr(fd, "ref"), paidAt: paidAt ? localToIso(paidAt) : null, amount: amountRaw ? parseMoney(amountRaw) : null });
    return { ok: true as const, message: `Pagamento de ${r.protocol} confirmado. Próxima etapa: validação do titular.` };
  });
}

export async function scheduleValidationAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    await scheduleCertificateValidation(s.ctx, fstr(fd, "id"), { at: localToIso(fstr(fd, "at")), mode: (fstr(fd, "mode") as "video" | "in_person") || "video", notes: fopt(fd, "notes") });
    return { ok: true as const, message: "Validação do titular agendada; o escritório foi avisado." };
  });
}

export async function approveValidationAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    await approveCertificateValidation(s.ctx, fstr(fd, "id"), { notes: fopt(fd, "notes") });
    return { ok: true as const, message: "Validação aprovada. A solicitação está pronta para emissão." };
  });
}

export async function rejectValidationAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    await rejectCertificateValidation(s.ctx, fstr(fd, "id"), { reason: fstr(fd, "reason") });
    return { ok: true as const, message: "Pendência registrada; reagende a validação quando o titular estiver pronto." };
  });
}

export async function registerEmissionAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    const file = await upload(fd, "file");
    const r = await registerCertificateEmission(s.ctx, fstr(fd, "id"), { file: file ? { name: file.name, data: file.data } : null, password: fopt(fd, "password"), serial: fopt(fd, "serial"), issuer: fopt(fd, "issuer"), validFrom: fopt(fd, "validFrom"), validTo: fopt(fd, "validTo") });
    return { ok: true as const, message: r.status === "ready_to_download" ? "Emissão registrada; o escritório já pode baixar." : "Emissão registrada; aguardando autorização de download pelo titular." };
  });
}

export async function emissionFailureAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    await registerCertificateEmissionFailure(s.ctx, fstr(fd, "id"), { reason: fstr(fd, "reason") });
    return { ok: true as const, message: "Falha registrada; o escritório pode pedir nova tentativa sem nova cobrança." };
  });
}

export async function teamRequestEmissionAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    const r = await requestCertificateEmission(s.ctx, fstr(fd, "id"));
    return { ok: true as const, message: `Emissão em andamento (tentativa ${r.emissionAttempts}).` };
  });
}

export async function teamCancelRequestAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    const r = await cancelCertificateRequest(s.ctx, fstr(fd, "id"), { reason: fstr(fd, "reason") });
    return { ok: true as const, message: `Solicitação ${r.protocol} cancelada.` };
  });
}

export async function saveCertificationSettingsAction(fd: FormData) {
  return runAction({ module: "admin", op: "view", revalidate: PATHS }, async (s) => {
    const catalog = fjson<any[]>(fd, "catalog", []).map((p) => ({ ...p, price: typeof p.price === "string" ? parseMoney(p.price) : p.price }));
    await saveCertificationSettings(s.ctx, { catalog, paymentInstructions: fopt(fd, "paymentInstructions") ?? "", paymentUrlBase: fopt(fd, "paymentUrlBase") });
    return { ok: true as const, message: "Parâmetros da certificação salvos." };
  });
}

// ------------------------------------------------------------------------------------------------------------- empresa (titular)

export async function setCertificateTrackingAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: PATHS }, async (s) => {
    const allowed = fbool(fd, "allowed");
    await setCertificateTracking(s.ctx, allowed);
    return { ok: true as const, message: allowed ? "Escritório autorizado a acompanhar e solicitar certificados digitais." : "Autorização de acompanhamento retirada." };
  });
}

export async function authorizeDownloadAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: PATHS }, async (s) => {
    const r = await authorizeCertificateDownloadByCompany(s.ctx, fstr(fd, "id"));
    return { ok: true as const, message: `Download do certificado ${r.protocol} autorizado ao escritório.` };
  });
}
