"use server";

import { runAction, fstr, fopt, fbool, fint, fjson } from "@/lib/server/action";
import { requireBranch } from "@/lib/core/ctx";
import { assert } from "@/lib/core/errors";
import { formatMoney } from "@/lib/money";
import {
  cancelDocument,
  correctionLetter,
  createNfse,
  disableNumbers,
  queryDocument,
  retransmit,
  retransmitBatch,
  saveFiscalConfig,
  shareByEmail,
  submitDraft,
  testFiscalConnection,
  updateNfse,
  DOC_STATUS_LABEL,
  type NfseInput,
} from "@/domain/fiscal/service";
import { buildNfe, refreshFromCatalog, saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { saveIssuer, setNextNumber, uploadCertificate, saveTaxGroup, deleteTaxGroup, type TaxGroupInput } from "@/domain/fiscal/config";
import { buildAccountingPackage, sendAccountingPackage, saveAccountingSchedule } from "@/domain/fiscal/export";
import { completeObligation, deleteObligation, generateObligations, saveObligation, saveTemplates, setObligationStatus, type ObligationTemplate } from "@/domain/fiscal/obligations";
import { normalizeFilter } from "@/domain/fiscal/reports";
import { parseBps } from "@/lib/money";

const R = ["/fiscal/nfe", "/fiscal/nfce", "/fiscal/nfse"];
const docPath = (model: string, id: string) => `/fiscal/${model}/${id}`;

// ───────────────────────────── Ações sobre documentos

export async function transmitAction(id: string) {
  return runAction({ module: "fiscal", op: "create", revalidate: R }, async (s) => {
    const d = await submitDraft(s.ctx, id);
    return { ok: true as const, message: `Resultado: ${DOC_STATUS_LABEL[d.status]}${d.statusMessage ? ` — ${d.statusMessage}` : ""}`.slice(0, 300) };
  });
}

export async function retransmitAction(id: string) {
  return runAction({ module: "fiscal", op: "edit", revalidate: R }, async (s) => {
    const d = await retransmit(s.ctx, id);
    return { ok: true as const, message: `Retransmitido (mesma referência). Resultado: ${DOC_STATUS_LABEL[d.status]}${d.statusMessage ? ` — ${d.statusMessage}` : ""}`.slice(0, 300) };
  });
}

export async function queryAction(id: string) {
  return runAction({ module: "fiscal", op: "view", revalidate: R }, async (s) => {
    const d = await queryDocument(s.ctx, id);
    return { ok: true as const, message: `Consulta ao provedor: ${DOC_STATUS_LABEL[d.status]}${d.statusMessage ? ` — ${d.statusMessage}` : ""}`.slice(0, 300) };
  });
}

export async function refreshAction(id: string) {
  return runAction({ module: "fiscal", op: "edit", revalidate: R }, async (s) => {
    const r = await refreshFromCatalog(s.ctx, id);
    return { ok: true as const, message: r.changes.length ? `Atualizado do cadastro: ${r.changes.join("; ")}`.slice(0, 300) : "Nenhuma diferença em relação ao cadastro." };
  });
}

export async function cancelAction(id: string, fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: R }, async (s) => {
    const d = await cancelDocument(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: d.status === "cancelled" ? "Cancelamento homologado pelo provedor." : `Documento ${DOC_STATUS_LABEL[d.status].toLowerCase()}.` };
  });
}

export async function cceAction(id: string, fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: R }, async (s) => {
    const d = await correctionLetter(s.ctx, id, fstr(fd, "text"));
    return { ok: true as const, message: `CC-e nº ${d.correctionCount} registrada.` };
  });
}

export async function emailAction(id: string, fd: FormData) {
  return runAction({ module: "fiscal", op: "view", revalidate: R }, async (s) => {
    const r = await shareByEmail(s.ctx, id, fstr(fd, "to"));
    if (!r.delivered) return { ok: false as const, error: `E-mail não enviado (${r.channel}): ${r.message ?? "falha"}` };
    return { ok: true as const, message: `E-mail entregue ao canal ${r.channel}.` };
  });
}

export async function batchRetransmitAction(model: "nfe" | "nfce" | "nfse", fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: R }, async (s) => {
    const ids = fd.getAll("ids").map(String).filter(Boolean);
    const out = await retransmitBatch(s.ctx, { model, branchId: s.ctx.branchId, ids: ids.length ? ids : undefined });
    const ok = out.filter((o) => o.after === "authorized").length;
    return { ok: true as const, message: out.length ? `${out.length} documento(s) processado(s): ${ok} autorizado(s); demais: ${[...new Set(out.filter((o) => o.after !== "authorized").map((o) => DOC_STATUS_LABEL[o.after] ?? o.after))].join(", ") || "—"}.` : "Nenhum documento pendente no recorte." };
  });
}

export async function disableAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: R }, async (s) => {
    const branchId = requireBranch(s.ctx);
    const doc = await disableNumbers(s.ctx, { branchId, model: (fstr(fd, "model") as "nfe" | "nfce") || "nfe", series: fstr(fd, "series") || "1", from: fint(fd, "from"), to: fint(fd, "to"), justification: fstr(fd, "justification") });
    return { ok: true as const, message: `Inutilização homologada (protocolo ${doc.protocol ?? "—"}).`, redirect: docPath(doc.model, doc.id) };
  });
}

// ───────────────────────────── NF-e (Tela 31)

function parseNfe(fd: FormData): NfeInput {
  const input = fjson<NfeInput | null>(fd, "payload", null);
  assert(input, "Dados da NF-e ausentes.");
  return input!;
}

export async function previewNfeAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "create" }, async (s) => {
    const input = parseNfe(fd);
    input.branchId = requireBranch(s.ctx);
    const r = await buildNfe(s.ctx, input);
    return { items: r.items, totals: r.totals, payments: r.payments, issues: r.issues, interstate: r.interstate };
  });
}

export async function saveNfeAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "create", revalidate: R }, async (s) => {
    const input = parseNfe(fd);
    const branchId = requireBranch(s.ctx);
    if (input.origin.type !== "transfer") input.branchId = branchId;
    const transmit = fstr(fd, "intent") === "transmit";
    const doc = await saveNfe(s.ctx, input, { idemKey: fstr(fd, "_idem"), draftId: fopt(fd, "draftId"), transmit });
    return { ok: true as const, message: transmit ? `NF-e enviada: ${DOC_STATUS_LABEL[doc.status]}${doc.statusMessage ? ` — ${doc.statusMessage}` : ""}`.slice(0, 300) : "Rascunho salvo.", redirect: docPath("nfe", doc.id) };
  });
}

// ───────────────────────────── NFS-e (Tela 32)

function parseNfse(fd: FormData, branchId: string): NfseInput {
  const withhold = { pis: fbool(fd, "wPis"), cofins: fbool(fd, "wCofins"), inss: fbool(fd, "wInss"), ir: fbool(fd, "wIr"), csll: fbool(fd, "wCsll") };
  const bps = (k: string) => parseBps(fstr(fd, k) || "0");
  return {
    branchId,
    recipient: {
      name: fstr(fd, "name"),
      doc: fstr(fd, "doc"),
      email: fopt(fd, "email"),
      im: fopt(fd, "im"),
      address: { street: fopt(fd, "street"), number: fopt(fd, "number"), district: fopt(fd, "district"), cityName: fopt(fd, "cityName"), cityCode: fopt(fd, "cityCode"), uf: fopt(fd, "uf"), zip: fopt(fd, "zip") },
    },
    customerId: fopt(fd, "customerId"),
    serviceProductId: fopt(fd, "serviceProductId"),
    competence: fstr(fd, "competence"),
    description: fstr(fd, "description"),
    serviceListItem: fstr(fd, "serviceListItem"),
    municipalCode: fopt(fd, "municipalCode") ?? undefined,
    nationalCode: fopt(fd, "nationalCode") ?? undefined,
    cnae: fopt(fd, "cnae") ?? undefined,
    serviceCityCode: fopt(fd, "serviceCityCode") ?? undefined,
    issExigibility: fstr(fd, "issExigibility") || "1",
    calc: {
      amount: fint(fd, "amount"),
      unconditionalDiscount: fint(fd, "unconditionalDiscount"),
      deductions: fint(fd, "deductions"),
      issRateBps: bps("issRate"),
      issWithheld: fbool(fd, "issWithheld"),
      pisBps: bps("pisRate"),
      cofinsBps: bps("cofinsRate"),
      inssBps: bps("inssRate"),
      irBps: bps("irRate"),
      csllBps: bps("csllRate"),
      withhold,
    },
    createReceivable: fbool(fd, "createReceivable") ? { dueDate: fstr(fd, "dueDate"), categoryId: fopt(fd, "categoryId") } : null,
    asDraft: fstr(fd, "intent") !== "transmit",
    idemKey: fstr(fd, "_idem"),
  };
}

export async function saveNfseAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "create", revalidate: R }, async (s) => {
    const branchId = requireBranch(s.ctx);
    const input = parseNfse(fd, branchId);
    const id = fopt(fd, "id");
    const doc = id ? await updateNfse(s.ctx, id, input) : await createNfse(s.ctx, input);
    if (!id && !input.asDraft) {
      // transmissão imediata (a fila também transmite; aqui o usuário vê o retorno real)
      const { transmitDocument } = await import("@/domain/fiscal/service");
      const d = await transmitDocument(s.ctx, doc.id);
      return { ok: true as const, message: `NFS-e enviada: ${DOC_STATUS_LABEL[d.status]}${d.statusMessage ? ` — ${d.statusMessage}` : ""}`.slice(0, 300), redirect: docPath("nfse", doc.id) };
    }
    return { ok: true as const, message: input.asDraft ? "Rascunho da NFS-e salvo." : `NFS-e: ${DOC_STATUS_LABEL[doc.status]}`, redirect: docPath("nfse", doc.id) };
  });
}

// ───────────────────────────── Configurações (Tela 34)

export async function saveConfigAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    const scope = fstr(fd, "scope") === "company" ? null : requireBranch(s.ctx);
    const section = fstr(fd, "section");
    const data: Record<string, any> = {};
    if (section === "documents") {
      Object.assign(data, {
        nfeEnabled: fbool(fd, "nfeEnabled"),
        nfceEnabled: fbool(fd, "nfceEnabled"),
        nfseEnabled: fbool(fd, "nfseEnabled"),
        nfeSeries: fint(fd, "nfeSeries", 1),
        nfceSeries: fint(fd, "nfceSeries", 1),
        nfseSeries: fstr(fd, "nfseSeries") || "1",
        nfseStandard: fstr(fd, "nfseStandard") || "municipal",
        defaultPresence: fstr(fd, "defaultPresence") || "1",
        defaultNature: fopt(fd, "defaultNature"),
        defaultTaxGroupId: fopt(fd, "defaultTaxGroupId"),
        nfeCancelHours: fint(fd, "nfeCancelHours", 24),
        nfceCancelMinutes: fint(fd, "nfceCancelMinutes", 30),
      });
      assert(data.nfeSeries >= 0 && data.nfeSeries <= 999 && data.nfceSeries >= 0 && data.nfceSeries <= 999, "Série deve estar entre 0 e 999.");
      assert(data.nfeCancelHours > 0 && data.nfceCancelMinutes > 0, "Prazos de cancelamento devem ser positivos.");
    } else if (section === "connection") {
      const provider = fstr(fd, "provider");
      assert(["focusnfe", "simulated"].includes(provider), "Provedor inválido.");
      const tokenRef = fstr(fd, "tokenRef") || "FOCUSNFE_TOKEN";
      assert(/^[A-Z][A-Z0-9_]{1,80}$/.test(tokenRef), "Informe o NOME da variável de ambiente do token (ex.: FOCUSNFE_TOKEN), nunca o token.");
      const cscTokenRef = fopt(fd, "cscTokenRef");
      if (cscTokenRef) assert(/^[A-Z][A-Z0-9_]{1,80}$/.test(cscTokenRef), "Informe o NOME da variável do CSC.");
      Object.assign(data, { provider, environment: fstr(fd, "environment") === "producao" ? "producao" : "homologacao", tokenRef, cscId: fopt(fd, "cscId"), cscTokenRef });
    } else if (section === "contingency") {
      Object.assign(data, { contingency: fbool(fd, "contingency"), contingencyReason: fopt(fd, "contingencyReason"), simulateOutage: fbool(fd, "simulateOutage") });
      if (data.contingency) assert(data.contingencyReason, "Informe o motivo da contingência.");
    } else assert(false, "Seção inválida.");
    await saveFiscalConfig(s.ctx, scope, data);
    return { ok: true as const, message: section === "connection" ? "Conexão salva — execute o teste para medir a situação." : "Configuração salva." };
  });
}

export async function testConnectionAction(scope: "branch" | "company") {
  return runAction({ module: "fiscal", op: "view", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    const r = await testFiscalConnection(s.ctx, scope === "company" ? null : requireBranch(s.ctx));
    if (!r.ok) return { ok: false as const, error: `Teste falhou: ${r.message}` };
    return { ok: true as const, message: r.message };
  });
}

export async function saveIssuerAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    await saveIssuer(s.ctx, s.ctx.branchId, {
      company: { name: fstr(fd, "name"), tradeName: fopt(fd, "tradeName"), cnpj: fstr(fd, "cnpj"), ie: fopt(fd, "ie"), im: fopt(fd, "im"), regime: fstr(fd, "regime"), crt: fstr(fd, "crt"), cnae: fopt(fd, "cnae") },
      branch: s.ctx.branchId
        ? { cnpj: fopt(fd, "branchCnpj"), ie: fopt(fd, "branchIe"), im: fopt(fd, "branchIm"), uf: fopt(fd, "uf")?.toUpperCase() ?? null, cityCode: fopt(fd, "cityCode"), cityName: fopt(fd, "cityName"), address: { street: fopt(fd, "street"), number: fopt(fd, "number"), district: fopt(fd, "district"), zip: fopt(fd, "zip") } }
        : null,
    });
    return { ok: true as const, message: "Dados do emitente salvos." };
  });
}

export async function uploadCertificateAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    const file = fd.get("file");
    assert(file && typeof file === "object" && "arrayBuffer" in file, "Selecione o arquivo .pfx.");
    const f = file as File;
    const scope = fstr(fd, "scope") === "company" ? null : requireBranch(s.ctx);
    const cert = await uploadCertificate(s.ctx, scope, { fileName: f.name, data: Buffer.from(await f.arrayBuffer()), password: String(fd.get("password") ?? ""), passwordRef: fstr(fd, "passwordRef") });
    return { ok: true as const, message: `Certificado lido: válido até ${new Date(cert.validTo).toLocaleDateString("pt-BR")}${cert.warnings.length ? ` — atenção: ${cert.warnings.join(" ")}` : ""}. A senha não foi gravada.` };
  });
}

export async function setNumberAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    await setNextNumber(s.ctx, requireBranch(s.ctx), fstr(fd, "model") as "nfe" | "nfce" | "nfse", fstr(fd, "series"), fint(fd, "next"));
    return { ok: true as const, message: "Numeração ajustada." };
  });
}

function parseTaxGroup(fd: FormData): TaxGroupInput {
  const bps = (k: string) => parseBps(fstr(fd, k) || "0");
  return {
    name: fstr(fd, "name"),
    regime: fstr(fd, "regime") || "simples",
    cfopInternal: fstr(fd, "cfopInternal"),
    cfopInterstate: fstr(fd, "cfopInterstate"),
    cfopReturn: fopt(fd, "cfopReturn"),
    cstCsosn: fstr(fd, "cstCsosn"),
    icmsRateBps: bps("icmsRate"),
    icmsBaseReductionBps: bps("icmsBaseReduction"),
    fcpRateBps: bps("fcpRate"),
    pisCst: fstr(fd, "pisCst"),
    pisRateBps: bps("pisRate"),
    cofinsCst: fstr(fd, "cofinsCst"),
    cofinsRateBps: bps("cofinsRate"),
    ipiCst: fopt(fd, "ipiCst"),
    ipiRateBps: bps("ipiRate"),
    validFrom: fopt(fd, "validFrom"),
    validTo: fopt(fd, "validTo"),
    active: fbool(fd, "active"),
    notes: fopt(fd, "notes"),
  };
}

export async function saveTaxGroupAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    const g = await saveTaxGroup(s.ctx, fopt(fd, "id"), parseTaxGroup(fd));
    return { ok: true as const, message: `Grupo "${g.name}" salvo.`, redirect: "/fiscal/configuracoes?tab=tributacao" };
  });
}

export async function deleteTaxGroupAction(id: string) {
  return runAction({ module: "fiscal", op: "delete", revalidate: ["/fiscal/configuracoes"] }, async (s) => {
    await deleteTaxGroup(s.ctx, id);
    return { ok: true as const, message: "Grupo excluído." };
  });
}

// ───────────────────────────── Relatórios, exportação e obrigações (Tela 35)

export async function generatePackageAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "view", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    const f = normalizeFilter({ from: fstr(fd, "from"), to: fstr(fd, "to"), branch: fstr(fd, "branch") || undefined });
    const send = fstr(fd, "intent") === "send";
    if (send) {
      const r = await sendAccountingPackage(s.ctx, f, { to: fopt(fd, "to"), reason: "manual" });
      if (!r.delivered) return { ok: false as const, error: r.message };
      return { ok: true as const, message: r.message };
    }
    const pkg = await buildAccountingPackage(s.ctx, f);
    return { ok: true as const, message: `Pacote gerado: ${pkg.xmlCount} XML, ${pkg.docs} documentos${pkg.missingXml.length ? `, ${pkg.missingXml.length} XML ausente(s)` : ""} (${(pkg.sizeBytes / 1024).toFixed(1)} KB).`, data: { fileId: pkg.fileId } };
  });
}

export async function saveScheduleAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    const r = await saveAccountingSchedule(s.ctx, { enabled: fbool(fd, "enabled"), day: fint(fd, "day", 5) });
    return { ok: true as const, message: r.enabled ? `Envio mensal agendado para o dia ${r.day}.` : "Envio mensal desativado." };
  });
}

export async function saveObligationAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    const o = await saveObligation(s.ctx, fopt(fd, "id"), { kind: fstr(fd, "kind"), name: fstr(fd, "name"), period: fstr(fd, "period"), dueDate: fstr(fd, "dueDate"), responsibleId: fopt(fd, "responsibleId"), notes: fopt(fd, "notes") });
    return { ok: true as const, message: `Obrigação "${o.name}" salva.` };
  });
}

export async function completeObligationAction(id: string, fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    const file = fd.get("proof");
    let proof: { name: string; mime: string; data: Buffer } | null = null;
    if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
      const f = file as File;
      proof = { name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) };
    }
    const amount = fstr(fd, "amount") ? fint(fd, "amount") : null;
    await completeObligation(s.ctx, id, { deliveredAt: fstr(fd, "deliveredAt"), receiptNumber: fopt(fd, "receiptNumber"), amount, notes: fopt(fd, "notes"), proof });
    return { ok: true as const, message: `Obrigação concluída${amount ? ` (${formatMoney(amount)})` : ""}.` };
  });
}

export async function obligationStatusAction(id: string, status: "pending" | "in_progress" | "waived", fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    await setObligationStatus(s.ctx, id, status, fopt(fd, "reason"));
    return { ok: true as const, message: "Situação atualizada." };
  });
}

export async function deleteObligationAction(id: string) {
  return runAction({ module: "fiscal", op: "delete", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    await deleteObligation(s.ctx, id);
    return { ok: true as const, message: "Obrigação excluída." };
  });
}

export async function generateObligationsAction() {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    const r = await generateObligations(s.ctx);
    return { ok: true as const, message: r.created ? `${r.created} obrigação(ões) gerada(s) a partir do calendário.` : "Obrigações da competência já estavam geradas." };
  });
}

export async function saveTemplatesAction(fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/relatorios"] }, async (s) => {
    const list = fjson<ObligationTemplate[]>(fd, "templates", []);
    await saveTemplates(s.ctx, list);
    return { ok: true as const, message: "Calendário de obrigações salvo." };
  });
}

export async function toggleContingencyAction(on: boolean, fd: FormData) {
  return runAction({ module: "fiscal", op: "edit", revalidate: ["/fiscal/nfce", "/fiscal/configuracoes"] }, async (s) => {
    const branchId = requireBranch(s.ctx);
    const reason = fopt(fd, "reason");
    if (on) assert(reason && reason.length >= 5, "Informe o motivo da contingência.");
    await saveFiscalConfig(s.ctx, branchId, on ? { contingency: true, contingencyReason: reason } : { contingency: false });
    return { ok: true as const, message: on ? "Contingência ativada: novas NFC-e ficam retidas na fila até a normalização." : "Contingência encerrada: a fila retida foi liberada para transmissão." };
  });
}
