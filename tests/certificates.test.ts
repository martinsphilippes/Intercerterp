import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import forge from "node-forge";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { scopeStore } from "@/lib/db/scoped-store";
import { toCtxUser } from "@/lib/auth/users";
import { hashPassword } from "@/lib/auth/provider";
import type { Ctx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import {
  createClient, issueLinkCode, acceptAccountingLink, assignResponsible,
  certificationSettings, saveCertificationSettings, createCertificateRequest, listCertificateRequests, getCertificateRequest, sendCertificateCharge, confirmCertificatePayment,
  scheduleCertificateValidation, approveCertificateValidation, rejectCertificateValidation, requestCertificateEmission, registerCertificateEmission, registerCertificateEmissionFailure,
  authorizeCertificateDownloadByCompany, recordCertificateAuthorization, downloadIssuedCertificate, cancelCertificateRequest, requestTrackingAccess, setCertificateTracking, clientTrackingAllowed,
  registerKnownCertificate, listKnownCertificates, certificateOverview, notifyCertificateDeadlines, listCertificationQueue, companyCertificateRequests, requestDisplayStatus, requestNextAction, chargeMessage,
} from "@/domain/accounting";
import { addDays, today } from "@/lib/dates";

let store: MemoryStore;
let refs: DemoRefs;
let firm: { company: any; branch: any; roles: Record<string, any> };
let owner: Ctx; // sócio do escritório (accounting.certificates)
let analyst: Ctx; // analista: carteira restrita, sem a operação de certificados
let team: Ctx; // equipe de certificação Intercert (administrador da plataforma)
let retailAdmin: Ctx; // administrador da loja de demonstração (titular vinculado)
let loja: any; // cliente contábil vinculado à loja
let cafe: any; // cliente contábil sem ERP
let pf: any;
const OWNER_PASSWORD = "Senha#Forte123";

function makePfx(cnpj: string, validTo: string, password: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "0C0FFEE";
  cert.validity.notBefore = new Date(`${today()}T00:00:00Z`);
  cert.validity.notAfter = new Date(`${validTo}T00:00:00Z`);
  cert.setSubject([{ name: "commonName", value: `TESTE LTDA:${cnpj}` }, { name: "countryName", value: "BR" }]);
  cert.setIssuer([{ name: "commonName", value: "AC TESTE" }]);
  cert.sign(keys.privateKey);
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

async function ctxFor(userId: string, company: any, branch: any): Promise<Ctx> {
  const u = (await store.get("users", userId))!;
  return { store: scopeStore(store, company.id), companyId: company.id, branchId: branch.id, user: await toCtxUser(store, u, company.id) };
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  retailAdmin = await refs.ctxFor("admin", "matriz");
  firm = await createCompanyWithDefaults(store, { name: "Contábil Gama Ltda", cnpj: "11444777000161", kind: "accounting", key: "firm-gama" });
  const mk = async (name: string, email: string, login: string, roleId: string | null, extra: Record<string, any> = {}) =>
    store.create("users", { name, email, login, status: "active", isAdmin: false, roleId, roleByCompany: roleId ? { [firm.company.id]: roleId } : {}, companyIds: [firm.company.id], branchIds: [], firstAccessAt: new Date().toISOString(), ...extra });
  const u1 = await mk("Sócio Gama", "socio@gama.test", "socio.gama", firm.roles.firm_admin.id, { passwordHash: hashPassword(OWNER_PASSWORD) });
  const u2 = await mk("Analista Gama", "analista@gama.test", "analista.gama", firm.roles.firm_analyst.id);
  const u3 = await mk("Equipe Certificação", "certificacao@intercert.test", "certificacao", null, { isAdmin: true, companyIds: [] });
  owner = await ctxFor(u1.id, firm.company, firm.branch);
  analyst = await ctxFor(u2.id, firm.company, firm.branch);
  team = await ctxFor(u3.id, firm.company, firm.branch);
  loja = await createClient(owner, { personType: "PJ", doc: refs.company.cnpj, name: refs.company.name, regime: "simples", status: "active", onboardedAt: today(), email: "financeiro@loja.test", phone: "11999990000", responsibleUserId: u1.id });
  cafe = await createClient(owner, { personType: "PJ", doc: "45723174000110", name: "Café do Largo Ltda", regime: "simples", status: "active", onboardedAt: today(), email: "cafe@largo.test" });
  pf = await createClient(owner, { personType: "PF", doc: "11144477735", name: "Marcos Autônomo", status: "active", onboardedAt: today() });
  await assignResponsible(owner, pf.id, { userId: u2.id, role: "titular" });
  const { code } = await issueLinkCode(owner, loja.id);
  await acceptAccountingLink(retailAdmin, code);
  loja = await store.get("accounting_clients", loja.id);
});

describe("certificados digitais — catálogo e autorização de acompanhamento", () => {
  it("catálogo padrão tem e-CNPJ A1; a equipe inclui e-CPF; o escritório não altera parâmetros da plataforma", async () => {
    const s0 = await certificationSettings(store);
    // catálogo padrão da rede de certificação (§43): e-CNPJ A1 continua o primeiro, com o preço da Tela 67
    expect(s0.catalog[0]).toMatchObject({ key: "ecnpj_a1_12m", price: 19900 });
    await expect(saveCertificationSettings(owner, { paymentInstructions: "x" })).rejects.toThrow();
    const s1 = await saveCertificationSettings(team, { catalog: [...s0.catalog, { key: "ecpf_a1_teste", label: "e-CPF A1 · 12 meses (teste)", months: 12, price: 15900, active: true }], paymentInstructions: "Pix: pagamentos@intercert.example (CNPJ)" });
    expect(s1.catalog).toHaveLength(s0.catalog.length + 1);
    expect((await certificationSettings(store)).paymentInstructions).toContain("Pix");
  });

  it("cliente vinculado ao ERP só entra nos certificados com autorização do titular; o pedido de acesso avisa a empresa", async () => {
    expect((await clientTrackingAllowed(owner, loja)).allowed).toBe(false);
    await expect(createCertificateRequest(owner, { clientId: loja.id, kind: "renewal", product: "ecnpj_a1_12m", dueDate: addDays(today(), 5) })).rejects.toMatchObject({ code: "tracking_not_authorized" });
    await requestTrackingAccess(owner, loja.id);
    const asks = (await listAll(store, "notifications", { filters: [["eq", "companyId", refs.company.id]] })).filter((n) => String(n.title).includes("acompanhar seus certificados"));
    expect(asks.length).toBeGreaterThan(0);
    await setCertificateTracking(retailAdmin, true);
    expect((await clientTrackingAllowed(owner, loja)).allowed).toBe(true);
    // cliente sem ERP não depende de autorização no sistema
    expect((await clientTrackingAllowed(owner, cafe))).toEqual({ allowed: true, linked: false });
  });
});

describe("certificados digitais — jornada completa do cliente vinculado", () => {
  let req: any;
  const pfxPassword = "pfx#123";
  let pfx: Buffer;

  it("solicitação nasce aguardando pagamento com protocolo sequencial; não abre outra enquanto houver atendimento", async () => {
    req = await createCertificateRequest(owner, { clientId: loja.id, kind: "renewal", product: "ecnpj_a1_12m", dueDate: addDays(today(), 5) });
    expect(req.protocol).toBe("CERT-0001");
    expect(req.status).toBe("awaiting_payment");
    expect(req.amount).toBe(19900);
    expect(req.linkedCompanyId).toBe(refs.company.id);
    expect(requestNextAction(req).owner).toBe("firm");
    await expect(createCertificateRequest(owner, { clientId: loja.id, kind: "new", product: "ecnpj_a1_12m", dueDate: today() })).rejects.toMatchObject({ code: "open_request" });
    // analista sem a operação não cria
    await expect(createCertificateRequest(analyst, { clientId: pf.id, kind: "new", product: "ecpf_a1_12m", dueDate: today() })).rejects.toThrow();
  });

  it("cobrança: e-mail sem canal configurado falha sem contar envio; envio manual identificado conta; vencida exige novo vencimento", async () => {
    await expect(sendCertificateCharge(owner, req.id, { channel: "email" })).rejects.toMatchObject({ code: "email_failed" });
    expect((await store.get("certificate_requests", req.id))!.chargeSends).toBe(0);
    const sent = await sendCertificateCharge(owner, req.id, { channel: "whatsapp", to: "11 99999-0000" });
    expect(sent.delivered).toBe(true);
    let r = (await store.get("certificate_requests", req.id))!;
    expect(r.chargeSends).toBe(1);
    expect(r.chargeChannel).toBe("whatsapp");
    const msg = chargeMessage(r, await certificationSettings(store));
    expect(msg.text).toContain("CERT-0001");
    expect(msg.text).toContain("Pix: pagamentos@intercert.example");
    // cobrança vencida
    await store.update("certificate_requests", req.id, { dueDate: addDays(today(), -2) });
    r = (await store.get("certificate_requests", req.id))!;
    expect(requestDisplayStatus(r)).toBe("overdue");
    await expect(sendCertificateCharge(owner, req.id, { channel: "whatsapp", to: "11 99999-0000" })).rejects.toMatchObject({ code: "overdue" });
    await sendCertificateCharge(owner, req.id, { channel: "whatsapp", to: "11 99999-0000", dueDate: addDays(today(), 3) });
    r = (await store.get("certificate_requests", req.id))!;
    expect(r.dueDate).toBe(addDays(today(), 3));
    expect(r.chargeSends).toBe(2);
    expect(requestDisplayStatus(r)).toBe("awaiting_payment");
  });

  it("equipe confirma o pagamento com referência, agenda e aprova a validação; o escritório pede a emissão", async () => {
    await expect(confirmCertificatePayment(owner, req.id, { ref: "PG-1" })).rejects.toThrow(); // escritório não confirma pagamento
    await expect(confirmCertificatePayment(team, req.id, { ref: "" })).rejects.toThrow(/referência/i);
    let r = await confirmCertificatePayment(team, req.id, { ref: "PG-0001" });
    expect(r.status).toBe("validation");
    expect(r.paymentRef).toBe("PG-0001");
    await expect(requestCertificateEmission(owner, req.id)).rejects.toMatchObject({ code: "status" });
    r = await scheduleCertificateValidation(team, req.id, { at: new Date(Date.now() + 86400000).toISOString(), mode: "video" });
    expect(r.validationStatus).toBe("scheduled");
    r = await rejectCertificateValidation(team, req.id, { reason: "Sócio sem documento com foto" });
    expect(r.status).toBe("validation");
    expect(r.validationStatus).toBe("rejected");
    r = await approveCertificateValidation(team, req.id, { notes: "Validado por vídeo" });
    expect(r.status).toBe("ready_to_issue");
    r = await requestCertificateEmission(owner, req.id);
    expect(r.status).toBe("issuing");
    expect(r.emissionAttempts).toBe(1);
    const firmNotes = (await listAll(store, "notifications", { filters: [["eq", "companyId", firm.company.id]] })).map((n) => String(n.title));
    expect(firmNotes.some((t) => t.includes("Pagamento confirmado"))).toBe(true);
    expect(firmNotes.some((t) => t.includes("Titular validado"))).toBe(true);
  });

  it("emissão: arquivo de outro titular é recusado; .pfx correto lido pela senha preenche validade e série; cliente vinculado aguarda autorização", async () => {
    const wrong = makePfx("19131243000197", addDays(today(), 365), pfxPassword);
    await expect(registerCertificateEmission(team, req.id, { file: { name: "cert.pfx", data: wrong }, password: pfxPassword })).rejects.toMatchObject({ code: "holder_mismatch" });
    await expect(registerCertificateEmission(team, req.id, { file: { name: "cert.pfx", data: wrong }, password: "errada" })).rejects.toThrow();
    pfx = makePfx(refs.company.cnpj, addDays(today(), 365), pfxPassword);
    const r = await registerCertificateEmission(team, req.id, { file: { name: "CERT-0001_e-CNPJ_A1.pfx", data: pfx }, password: pfxPassword });
    expect(r.status).toBe("awaiting_authorization");
    expect(r.validTo).toBe(addDays(today(), 365));
    expect(String(r.serial)).toMatch(/c0ffee$/i);
    expect(r.fileId).toBeTruthy();
    const known = await listAll(store, "accounting_certificates", { filters: [["eq", "requestId", req.id]] });
    expect(known).toHaveLength(1);
    expect(known[0].source).toBe("issued");
    // o arquivo emitido nunca sai pela rota genérica de arquivos
    const { fileAccessDenial } = await import("@/app/api/files/[id]/access");
    expect(fileAccessDenial(owner.user, (await store.get("files", r.fileId))!)).toMatch(/confirmação de identidade/);
  });

  it("download: exige autorização do titular, confirmação de senha e registra cada download", async () => {
    await expect(downloadIssuedCertificate(owner, req.id, { password: OWNER_PASSWORD })).rejects.toMatchObject({ code: "not_authorized" });
    const r = await authorizeCertificateDownloadByCompany(retailAdmin, req.id);
    expect(r.status).toBe("ready_to_download");
    expect(r.downloadAuthorizedBy).toBe("company");
    await expect(downloadIssuedCertificate(owner, req.id, { password: "errada" })).rejects.toMatchObject({ code: "password" });
    await expect(downloadIssuedCertificate(analyst, req.id, { password: "x" })).rejects.toThrow();
    const dl = await downloadIssuedCertificate(owner, req.id, { password: OWNER_PASSWORD });
    expect(Buffer.compare(dl.data, pfx)).toBe(0);
    expect(dl.name).toBe("CERT-0001_e-CNPJ_A1.pfx");
    expect(dl.request.status).toBe("downloaded");
    expect(dl.request.downloads).toBe(1);
    // nenhuma sessão fica aberta pela confirmação de senha
    expect(await listAll(store, "sessions")).toHaveLength(0);
    const events = await listAll(store, "audit_logs", { filters: [["eq", "entityType", "certificate_request"], ["eq", "entityId", req.id]] });
    const actions = events.map((e) => e.action);
    for (const a of ["certificate.request", "certificate.charge_failed", "certificate.charge_sent", "certificate.charge_resent", "certificate.payment_confirmed", "certificate.validation_scheduled", "certificate.validation_rejected", "certificate.validation_approved", "certificate.emission_requested", "certificate.issued", "certificate.download_authorized", "certificate.downloaded"]) expect(actions).toContain(a);
    expect(events.every((e) => e.companyId === firm.company.id)).toBe(true);
  });
});

describe("certificados digitais — cliente sem ERP, falha de emissão e cancelamento", () => {
  it("falha na emissão não gera nova cobrança; nova tentativa reaproveita o protocolo; autorização registrada pelo escritório libera o download", async () => {
    const r0 = await createCertificateRequest(owner, { clientId: cafe.id, kind: "new", product: "ecnpj_a1_12m", amount: 24900, dueDate: today(), contactEmail: "socio@largo.test" });
    expect(r0.protocol).toBe("CERT-0002");
    expect(r0.amount).toBe(24900);
    await sendCertificateCharge(owner, r0.id, { channel: "phone", to: "Sócio — (11) 98888-0000" });
    await confirmCertificatePayment(team, r0.id, { ref: "PG-0002" });
    await scheduleCertificateValidation(team, r0.id, { at: new Date().toISOString(), mode: "in_person" });
    await approveCertificateValidation(team, r0.id);
    await requestCertificateEmission(owner, r0.id);
    let r = await registerCertificateEmissionFailure(team, r0.id, { reason: "Retorno da certificadora: dados do titular divergentes" });
    expect(r.status).toBe("issue_failed");
    expect(requestNextAction(r).owner).toBe("firm");
    r = await requestCertificateEmission(owner, r0.id);
    expect(r.status).toBe("issuing");
    expect(r.emissionAttempts).toBe(2);
    expect(r.chargeSends).toBe(1);
    expect(r.amount).toBe(24900);
    // emissão registrada com validade informada (sem senha do arquivo)
    r = await registerCertificateEmission(team, r0.id, { file: { name: "CERT-0002.p12", data: Buffer.from("conteudo-demo") }, validTo: addDays(today(), 365), serial: "ABC123" });
    expect(r.status).toBe("awaiting_authorization");
    await expect(authorizeCertificateDownloadByCompany(retailAdmin, r0.id)).rejects.toMatchObject({ code: "not_found" }); // a loja não é o titular deste
    await expect(recordCertificateAuthorization(owner, r0.id, { notes: "curto" })).rejects.toThrow();
    r = await recordCertificateAuthorization(owner, r0.id, { notes: "Termo de autorização assinado pelo sócio em 10/10", evidence: { name: "termo.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 demo") } });
    expect(r.status).toBe("ready_to_download");
    expect(r.downloadAuthorizedBy).toBe("firm");
    expect(r.downloadAuthEvidenceFileId).toBeTruthy();
    const dl = await downloadIssuedCertificate(owner, r0.id, { password: OWNER_PASSWORD });
    expect(dl.data.toString()).toBe("conteudo-demo");
  });

  it("cancelamento só enquanto não paga, com motivo; depois do pagamento é recusado", async () => {
    const a = await createCertificateRequest(owner, { clientId: pf.id, kind: "new", product: "ecpf_a1_12m", dueDate: today() });
    await expect(cancelCertificateRequest(owner, a.id, { reason: "" })).rejects.toThrow(/motivo/i);
    const c = await cancelCertificateRequest(owner, a.id, { reason: "Cliente desistiu" });
    expect(c.status).toBe("cancelled");
    const b = await createCertificateRequest(owner, { clientId: pf.id, kind: "new", product: "ecpf_a1_12m", dueDate: today() });
    expect(b.protocol).toBe("CERT-0004");
    await confirmCertificatePayment(team, b.id, { ref: "PG-0004" });
    await expect(cancelCertificateRequest(owner, b.id, { reason: "Tarde demais" })).rejects.toMatchObject({ code: "status" });
    await expect(sendCertificateCharge(owner, b.id, { channel: "whatsapp", to: "x" })).rejects.toMatchObject({ code: "status" });
  });
});

describe("certificados digitais — validades, alertas, carteira restrita e fila", () => {
  it("certificados conhecidos reúnem emitido, informado pelo escritório e o A1 fiscal da empresa vinculada; indicadores e rotina avisam", async () => {
    await registerKnownCertificate(owner, pf.id, { productLabel: "e-CPF A1 · 12 meses", validTo: addDays(today(), 10), serial: "PF1" });
    await store.create("fiscal_configs", { companyId: refs.company.id, branchId: null, scopeKey: `${refs.company.id}|*`, provider: "simulated", environment: "homologacao", certificate: { validTo: `${addDays(today(), -3)}T00:00:00.000Z`, subject: "LOJA", serial: "A1X" } });
    const all = await listKnownCertificates(owner);
    expect(all.some((k) => k.source === "issued" && k.clientId === loja.id)).toBe(true);
    expect(all.some((k) => k.source === "manual" && k.clientId === pf.id && k.validity === "due_soon")).toBe(true);
    const erp = all.find((k) => k.source === "erp");
    expect(erp?.clientId).toBe(loja.id);
    expect(erp?.validity).toBe("expired");
    const attention = await listKnownCertificates(owner, { attention: true });
    expect(attention.map((k) => k.source).sort()).toEqual(["erp", "manual"]);
    const ov = await certificateOverview(owner);
    expect(ov.needRenewal).toBe(2);
    expect(ov.open).toBe(1); // CERT-0004 em validação
    const { alerts } = await notifyCertificateDeadlines(store, firm.company.id);
    expect(alerts).toBeGreaterThanOrEqual(2);
    const titles = (await listAll(store, "notifications", { filters: [["eq", "companyId", firm.company.id]] })).map((n) => String(n.title));
    expect(titles.some((t) => t.includes("VENCIDO"))).toBe(true);
    expect(titles.some((t) => t.includes("vence em 10 dia"))).toBe(true);
    // sem autorização de acompanhamento, o A1 da empresa some da lista
    await setCertificateTracking(retailAdmin, false);
    expect((await listKnownCertificates(owner)).some((k) => k.source === "erp")).toBe(false);
    await setCertificateTracking(retailAdmin, true);
  });

  it("analista vê só as solicitações da própria carteira; a equipe vê todos os escritórios; a empresa vê as suas", async () => {
    const mine = await listCertificateRequests(analyst);
    expect(mine.every((r) => r.clientId === pf.id)).toBe(true);
    expect(mine.length).toBe(2);
    const lojaReq = (await listCertificateRequests(owner, { clientId: loja.id }))[0];
    await expect(getCertificateRequest(analyst, lojaReq.id)).rejects.toMatchObject({ code: "forbidden" });
    const queue = await listCertificationQueue(team);
    expect(queue.length).toBe(4);
    expect(queue[0].firmName).toContain("Gama");
    expect((await listCertificationQueue(team, { status: "open" })).length).toBe(1);
    await expect(listCertificationQueue(owner)).rejects.toThrow();
    const mineCompany = await companyCertificateRequests(store, refs.company.id);
    expect(mineCompany.map((r) => r.protocol)).toEqual(["CERT-0001"]);
  });
});
