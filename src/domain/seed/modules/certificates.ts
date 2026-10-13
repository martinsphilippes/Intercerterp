import forge from "node-forge";
import type { DemoRefs } from "../base";
import { DEMO_PASSWORD, Seeder } from "../base";
import { findOne, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import { getAuth } from "@/lib/auth/provider";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { getSetting, setSetting } from "@/lib/core/settings";
import { addDays, today } from "@/lib/dates";
import { createRole } from "../../roles";
import {
  saveCertificationSettings, setCertificateTracking, registerKnownCertificate, createCertificateRequest, sendCertificateCharge, confirmCertificatePayment, scheduleCertificateValidation,
  approveCertificateValidation, requestCertificateEmission, registerCertificateEmission, recordCertificateAuthorization,
} from "../../accounting";

/**
 * Demonstração da Tela 67 (certificados digitais) no escritório de demonstração — depende do módulo "accounting":
 *  - usuário "certificacao" (equipe de certificação Intercert, perfil próprio com a operação certification.operate);
 *  - catálogo com e-CNPJ e e-CPF A1 e instruções de pagamento de demonstração;
 *  - loja de demonstração autoriza o acompanhamento; certificados conhecidos (loja a vencer em 19 dias, holding vencido há 8);
 *  - 4 protocolos em etapas diferentes: cobrança enviada, validação agendada, pronto para baixar (arquivo .pfx de demonstração
 *    emitido de verdade, autorização registrada) e pronto para emitir.
 * Idempotente (marcador "demo.certificates.done" no escritório); nada aqui é simulado: cada etapa foi executada pelo ator dela.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const sd = new Seeder(store);
  const firm = await findOne(store, "companies", [["eq", "cnpj", "33444555000170"]]);
  if (!firm) return { skipped: true, reason: "escritório de demonstração ausente" };
  if (await getSetting(store, firm.id, null, "demo.certificates.done", false)) return { skipped: true, firmId: firm.id };
  const branch = (await findOne(store, "branches", [["eq", "companyId", firm.id]]))!;
  const contador = (await findOne(store, "users", [["eq", "login", "contador"]]))!;
  const ctxFor = async (u: Doc): Promise<Ctx> => ({ store: scopeStore(store, firm.id), companyId: firm.id, branchId: branch.id, user: await toCtxUser(store, u, firm.id) });
  const owner = await ctxFor(contador);
  const lojaAdmin = await refs.ctxFor("admin", "matriz");

  // equipe de certificação: perfil próprio no escritório (não é administrador da plataforma)
  let role = (await listAll(store, "roles", { filters: [["eq", "companyId", firm.id]] })).find((r) => r.name === "Equipe de certificação (DEMO)");
  if (!role) role = await createRole(owner, { name: "Equipe de certificação (DEMO)", description: "Confirma pagamentos, valida titulares e registra emissões de certificados digitais.", permissions: { dashboard: { view: true, create: false, edit: false, delete: false }, accounting: { view: true, create: false, edit: false, delete: false }, admin: { view: true, create: false, edit: false, delete: false }, support: { view: true, create: true, edit: true, delete: false } }, actions: ["certification.operate"], discountLimitBps: 0 });
  let teamUser = await store.get("users", sd.id("users", "certificacao"));
  if (!teamUser) teamUser = await sd.put("users", "certificacao", { name: "Cecília Certificação", email: "certificacao@demo.intercert.local", login: "certificacao", status: "active", roleId: role.id, roleByCompany: { [firm.id]: role.id }, isAdmin: false, companyIds: [firm.id], branchIds: [], isDemo: true, firstAccessAt: new Date().toISOString() });
  if (!teamUser.authId) teamUser = await store.update("users", teamUser.id, { authId: await getAuth().createUser(teamUser.email, DEMO_PASSWORD, teamUser.name) });
  const team = await ctxFor(teamUser);

  await saveCertificationSettings(team, {
    catalog: [
      { key: "ecnpj_a1_12m", label: "e-CNPJ A1 · 12 meses", months: 12, price: 19900, active: true },
      { key: "ecpf_a1_12m", label: "e-CPF A1 · 12 meses", months: 12, price: 15900, active: true },
    ],
    paymentInstructions: "Pagamento único à Intercert Certificação (DEMO): Pix para a chave pagamentos@intercert.example, informando o protocolo. A cobrança é separada da mensalidade do ERP.",
  });

  const client = async (doc: string) => (await findOne(store, "accounting_clients", [["eq", "companyId", firm.id], ["eq", "doc", doc]]))!;
  const loja = await client(refs.company.cnpj);
  const holding = await client("61585865000151");
  const cafe = await client("45723174000110");
  const pf = await client("11144477735");
  await setCertificateTracking(lojaAdmin, true);

  // certificados conhecidos: loja vence em 19 dias; holding venceu há 8 dias
  const lojaCert = await registerKnownCertificate(owner, loja.id, { productLabel: "e-CNPJ A1 · 12 meses", serial: "DEMO-A1-6701", issuer: "AC Intercert (DEMO)", validFrom: addDays(today(), 19 - 365), validTo: addDays(today(), 19) });
  const holdingCert = await registerKnownCertificate(owner, holding.id, { productLabel: "e-CNPJ A1 · 12 meses", serial: "DEMO-A1-6702", issuer: "AC Intercert (DEMO)", validFrom: addDays(today(), -8 - 365), validTo: addDays(today(), -8) });

  // 1) loja: renovação com cobrança enviada, aguardando pagamento
  const r1 = await createCertificateRequest(owner, { clientId: loja.id, kind: "renewal", product: "ecnpj_a1_12m", dueDate: addDays(today(), 5), contactEmail: "financeiro@demo.intercert.local", previousCertificateId: lojaCert.id });
  await sendCertificateCharge(owner, r1.id, { channel: "whatsapp", to: "Fernanda Financeiro — (11) 99999-1001" });

  // 2) holding: renovação paga, validação do titular agendada para amanhã às 14h
  const r2 = await createCertificateRequest(owner, { clientId: holding.id, kind: "renewal", product: "ecnpj_a1_12m", dueDate: today(), previousCertificateId: holdingCert.id, contactEmail: "diretoria@demo.intercert.local" });
  await sendCertificateCharge(owner, r2.id, { channel: "phone", to: "Diana Diretora — (11) 99999-1002" });
  await confirmCertificatePayment(team, r2.id, { ref: "PG-DEMO-6702" });
  await scheduleCertificateValidation(team, r2.id, { at: new Date(`${addDays(today(), 1)}T14:00:00-03:00`).toISOString(), mode: "video", notes: "Videoconferência com a sócia-administradora" });

  // 3) café: nova emissão concluída (arquivo .pfx de demonstração), autorização do titular registrada, pronto para baixar
  const r3 = await createCertificateRequest(owner, { clientId: cafe.id, kind: "new", product: "ecnpj_a1_12m", dueDate: today(), contactEmail: "socio@cafedolargo.example" });
  await sendCertificateCharge(owner, r3.id, { channel: "whatsapp", to: "Sócio — (19) 99999-1003" });
  await confirmCertificatePayment(team, r3.id, { ref: "PG-DEMO-6703" });
  await scheduleCertificateValidation(team, r3.id, { at: new Date().toISOString(), mode: "video" });
  await approveCertificateValidation(team, r3.id, { notes: "Titular validado por videoconferência" });
  await requestCertificateEmission(owner, r3.id);
  const pfx = demoPfx("CAFE DO LARGO LTDA:45723174000110", addDays(today(), 365));
  await registerCertificateEmission(team, r3.id, { file: { name: "CERT-0003_e-CNPJ_A1_DEMO.pfx", data: pfx.data }, password: pfx.password });
  await recordCertificateAuthorization(owner, r3.id, { notes: "Termo de autorização de download assinado pelo sócio (demonstração)" });

  // 4) pessoa física: e-CPF pago e validado, pronto para emitir
  const r4 = await createCertificateRequest(owner, { clientId: pf.id, kind: "new", product: "ecpf_a1_12m", dueDate: today(), contactPhone: "(11) 99999-1004" });
  await sendCertificateCharge(owner, r4.id, { channel: "whatsapp", to: "Marcos — (11) 99999-1004" });
  await confirmCertificatePayment(team, r4.id, { ref: "PG-DEMO-6704" });
  await scheduleCertificateValidation(team, r4.id, { at: new Date().toISOString(), mode: "in_person" });
  await approveCertificateValidation(team, r4.id);

  await setSetting(store, firm.id, null, "demo.certificates.done", true);
  return { firmId: firm.id, requests: 4, teamUser: teamUser.login };
}

/** .pfx autoassinado para a demonstração (a senha é descartada após a leitura da validade). */
function demoPfx(cn: string, validTo: string): { data: Buffer; password: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "DEMO6703";
  cert.validity.notBefore = new Date(`${today()}T00:00:00Z`);
  cert.validity.notAfter = new Date(`${validTo}T00:00:00Z`);
  cert.setSubject([{ name: "commonName", value: cn }, { name: "countryName", value: "BR" }]);
  cert.setIssuer([{ name: "commonName", value: "AC Intercert (DEMO)" }]);
  cert.sign(keys.privateKey);
  const password = "demo-6703";
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return { data: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"), password };
}
