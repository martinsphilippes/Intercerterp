import type { DemoRefs } from "../base";
import { DEMO_PASSWORD, Seeder } from "../base";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import { getAuth } from "@/lib/auth/provider";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { getSetting, setSetting } from "@/lib/core/settings";
import { addMonths, monthEnd, monthStart, today } from "@/lib/dates";
import { createCompanyWithDefaults } from "../../setup";
import { createClient, addPerson, addEstablishment, saveGroup, assignResponsible, setDepartmentMember, issueLinkCode, acceptAccountingLink, changeClientRegime } from "../../accounting";
import { sendAccountingPackage } from "../../fiscal/export";

/**
 * Demonstração do ESCRITÓRIO CONTÁBIL (empresa do tipo "accounting", separada da loja de demonstração):
 *  - escritório "Contábil Horizonte (DEMO)" com dois usuários: contador (sócio) e analista (carteira restrita);
 *  - 4 clientes contábeis: a loja de demonstração (vinculada ao ERP por código de vínculo), uma PJ no Presumido,
 *    uma PJ em implantação e uma PF (IRPF), com sócios, filial, grupo e responsáveis;
 *  - um pacote mensal da loja já entregue na caixa de entrada do escritório.
 * Idempotente (ids determinísticos e marcador "demo.accounting.done").
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const sd = new Seeder(store);
  const { company: firm, branch, roles } = await createCompanyWithDefaults(store, { name: "Contábil Horizonte Ltda (DEMO)", tradeName: "Contábil Horizonte (DEMO)", cnpj: "33444555000170", regime: "presumido", uf: "SP", cityName: "São Paulo", cityCode: "3550308", kind: "accounting", key: "demo-firm" });
  if (!firm.isDemo) await store.update("companies", firm.id, { isDemo: true });

  // usuários do escritório
  const auth = getAuth();
  const users: Record<string, Doc> = {};
  for (const u of [
    { key: "contador", name: "Helena Contadora", email: "contador@demo.intercert.local", login: "contador", role: "firm_admin" },
    { key: "analista", name: "Rafael Analista", email: "analista@demo.intercert.local", login: "analista", role: "firm_analyst" },
  ]) {
    let doc = await store.get("users", sd.id("users", u.key));
    if (!doc) doc = await sd.put("users", u.key, { name: u.name, email: u.email, login: u.login, status: "active", roleId: roles[u.role].id, roleByCompany: { [firm.id]: roles[u.role].id }, isAdmin: false, companyIds: [firm.id], branchIds: [], isDemo: true, firstAccessAt: new Date().toISOString() });
    if (!doc.authId) doc = await store.update("users", doc.id, { authId: await auth.createUser(u.email, DEMO_PASSWORD, u.name) });
    users[u.key] = doc;
  }
  const ctxFor = async (key: string): Promise<Ctx> => ({ store: scopeStore(store, firm.id), companyId: firm.id, branchId: branch.id, user: await toCtxUser(store, users[key], firm.id) });
  const owner = await ctxFor("contador");
  if (await getSetting(store, firm.id, null, "demo.accounting.done", false)) return { skipped: true, firmId: firm.id };

  const deps = Object.fromEntries((await listAll(store, "departments", { filters: [["eq", "companyId", firm.id]] })).map((d) => [d.key, d]));
  await setDepartmentMember(owner, deps.fiscal.id, users.analista.id, "member");
  await setDepartmentMember(owner, deps.contabil.id, users.contador.id, "manager");
  const group = await saveGroup(owner, null, { name: "Grupo Intercert", kind: "economic", notes: "Loja e holding dos mesmos sócios" });

  // 1) a loja de demonstração como cliente, vinculada ao ERP
  const loja = await createClient(owner, {
    personType: "PJ", doc: refs.company.cnpj, name: refs.company.name, tradeName: refs.company.tradeName, regime: "simples", cnae: refs.company.cnae, email: refs.company.email, phone: refs.company.phone,
    address: refs.company.address, status: "active", onboardedAt: addMonths(today(), -14), serviceStartAt: addMonths(today(), -14), services: ["accounting", "fiscal", "payroll"], groupId: group.id, responsibleUserId: users.contador.id,
    employeesCount: 9, monthlyDocs: 320, monthlyEntries: 450, systems: [{ name: "Intercert ERP", kind: "erp" }], commPrefs: { channel: "email" }, tags: ["varejo", "2 filiais"], idemKey: "demo-loja",
  });
  await addPerson(owner, loja.id, { kind: "partner", name: "Diana Diretora", doc: "52998224725", qualification: "Sócio-administrador", shareBps: 7000, isPrimary: true, email: "diretoria@demo.intercert.local" });
  await addPerson(owner, loja.id, { kind: "partner", name: "Gustavo Gerente", qualification: "Sócio", shareBps: 3000 });
  await addPerson(owner, loja.id, { kind: "contact", name: "Fernanda Financeiro", department: "financeiro", email: "financeiro@demo.intercert.local", isPrimary: true });
  await addEstablishment(owner, loja.id, { kind: "filial", name: "Filial — Shopping Norte", cnpj: "11222333000262", ie: "110042490220", address: { street: "Av. Otto Baumgart", number: "500", district: "Vila Guilherme", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "02049000" } });
  await assignResponsible(owner, loja.id, { departmentId: deps.fiscal.id, userId: users.analista.id, role: "titular" });
  await assignResponsible(owner, loja.id, { departmentId: deps.contabil.id, userId: users.contador.id, role: "titular" });
  const { code } = await issueLinkCode(owner, loja.id);
  const lojaAdmin = await refs.ctxFor("admin", "matriz");
  await acceptAccountingLink(lojaAdmin, code);

  // 2) PJ no Lucro Presumido com histórico de regime (saiu do Simples no início do ano)
  const holding = await createClient(owner, {
    personType: "PJ", doc: "61585865000151", name: "Horizonte Participações Ltda", tradeName: "Holding Intercert", regime: "simples", cnae: "6462000", legalNature: "206-2 Sociedade Empresária Limitada", size: "ME",
    address: { street: "Rua das Flores", number: "100", district: "Centro", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "01001000" }, status: "active", onboardedAt: addMonths(today(), -20), serviceStartAt: addMonths(today(), -20),
    services: ["accounting", "corporate"], groupId: group.id, responsibleUserId: users.contador.id, employeesCount: 0, monthlyDocs: 12, idemKey: "demo-holding",
  });
  await changeClientRegime(owner, holding.id, { regime: "presumido", validFrom: `${today().slice(0, 4)}-01-01`, reason: "Exclusão do Simples por atividade vedada" });
  await addPerson(owner, holding.id, { kind: "partner", name: "Diana Diretora", doc: "52998224725", qualification: "Sócio-administrador", shareBps: 10000, isPrimary: true });
  await assignResponsible(owner, holding.id, { departmentId: deps.societario.id, userId: users.contador.id, role: "titular" });

  // 3) PJ em implantação (sem responsável ainda — aparece no painel como pendência)
  await createClient(owner, {
    personType: "PJ", doc: "45723174000110", name: "Café do Largo Ltda", tradeName: "Café do Largo", regime: "simples", cnae: "5611203", status: "onboarding", onboardedAt: addMonths(today(), -1),
    address: { cityName: "Campinas", cityCode: "3509502", uf: "SP" }, services: ["accounting", "fiscal", "payroll"], employeesCount: 4, systems: [{ name: "Planilhas", kind: "other" }], notes: "Migrando do escritório anterior; aguardando documentos societários.", idemKey: "demo-cafe",
  });

  // 4) PF (IRPF)
  const pf = await createClient(owner, { personType: "PF", doc: "11144477735", name: "Marcos Autônomo", status: "active", onboardedAt: addMonths(today(), -8), serviceStartAt: addMonths(today(), -8), services: ["irpf"], responsibleUserId: users.analista.id, commPrefs: { channel: "whatsapp" }, idemKey: "demo-pf" });
  await assignResponsible(owner, pf.id, { userId: users.analista.id, role: "titular" });

  // pacote do mês anterior da loja entregue na caixa de entrada do escritório
  const prev = addMonths(monthStart(today()), -1);
  const sent = await sendAccountingPackage({ ...lojaAdmin, branchId: null }, { from: prev, to: monthEnd(prev), branchId: null, includeSimulated: true }, { reason: "manual" }).catch(() => null);

  await setSetting(store, firm.id, null, "demo.accounting.done", true);
  return { firmId: firm.id, clients: 4, delivered: Boolean(sent?.delivered), deliveryId: detId("delivery", loja.id, sent?.package?.fileId ?? "") };
}
