import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/bootstrap", () => ({ ensureBootstrap: async () => undefined }));
import crypto from "node:crypto";
import { freshStore } from "./helpers";
import type { MemoryStore } from "@/lib/db/memory-store";
import type { Doc } from "@/lib/db/types";
import { detId, listAll, sha256 } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { createCompanyWithDefaults } from "@/domain/setup";
import { takeBaseline, provisionModules } from "@/domain/modules/baseline";
import { decide, loadCompanyModules } from "@/lib/modules/access";
import { companyCap, itemEffective, pathDisplay, resolveCode, resolveDisplays, unitByCode, type DisplayMode, type LicenseSnapshot } from "@/domain/licensing/effective";
import { applyLicense, displayMode, displayResolver, licenseStatus, maintainLicense, planLicense } from "@/domain/licensing/license";
import { applyDueTransitions } from "@/domain/licensing/due";
import { assertWithinLimit, noteFiscalDocumentUsage } from "@/domain/licensing/limits";
import { reconcileLicense } from "@/domain/licensing/sync";
import { signBody, verifySignature } from "@/domain/licensing/events";
import { companyUsage } from "@/domain/licensing/usage";
import { requestUpsell } from "@/domain/licensing/upsell";
import { runDueJobs } from "@/domain/jobs-registry";
import { systemCtx } from "@/lib/core/ctx";
import { roleFromAttributes } from "@/domain/users";
import { MODULE_MAP } from "@/lib/modules/catalog";
import { UNITS_V2 } from "@/lib/modules/units-v2.generated";

/**
 * Licenciamento comercial (contrato Interos v2) sobre o runtime de habilitação: estados, carências e agendamentos
 * locais, versão monotônica (repetição e fora de ordem), homologação, limites, eventos assinados, reconciliação com o
 * Interos indisponível, isolamento entre empresas, oportunidade de contratação e perfil por cargo.
 */
let store: MemoryStore;
let A: Doc;
let B: Doc;
const day = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const ALL_SELLABLE_RETAIL = UNITS_V2.filter((u) => u.sellable && u.v1Key && !u.v1Key.startsWith("contabil.") && !u.v1Key.startsWith("rede.") && u.v1Key !== "ecommerce.loja" && !u.v1Key.startsWith("ecommerce.")).map((u) => u.code);

function snap(companyId: string, version: number, items: LicenseSnapshot["items"], extra: Partial<LicenseSnapshot> = {}): LicenseSnapshot {
  return { licenseVersion: version, companyId, product: "erp-intercert", commercialStatus: "active", items, issuedAt: new Date().toISOString(), ...extra };
}
const meta = { clientId: "interos-test", source: "push" as const };

beforeEach(async () => {
  store = freshStore();
  A = (await createCompanyWithDefaults(store, { name: "Alfa Licença Ficticia", cnpj: "33333333000191", key: "alfa-lic" })).company;
  B = (await createCompanyWithDefaults(store, { name: "Beta Licença Ficticia", cnpj: "44444444000191", key: "beta-lic" })).company;
  await takeBaseline(store, A.id);
  await takeBaseline(store, B.id);
});

describe("estado efetivo (puro)", () => {
  const now = new Date("2026-12-10T12:00:00Z");
  it("teste: dentro do prazo, carência de 7 dias e suspensão depois", () => {
    expect(itemEffective({ state: "trial", until: "2026-12-15T00:00:00Z" }, now)).toMatchObject({ on: true, state: "trial" });
    const grace = itemEffective({ state: "trial", until: "2026-12-05T00:00:00Z" }, now);
    expect(grace.on).toBe(true);
    expect(grace.notice).toMatch(/carência até 2026-12-12/);
    expect(itemEffective({ state: "trial", until: "2026-12-01T00:00:00Z" }, now)).toMatchObject({ on: false, state: "suspended" });
  });
  it("agendamentos e estados de bloqueio", () => {
    expect(itemEffective({ state: "activation_scheduled", effectiveAt: "2026-12-20T00:00:00Z" }, now).on).toBe(false);
    expect(itemEffective({ state: "activation_scheduled", effectiveAt: "2026-12-01T00:00:00Z" }, now).on).toBe(true);
    expect(itemEffective({ state: "suspension_scheduled", effectiveAt: "2026-12-20T00:00:00Z" }, now).on).toBe(true);
    expect(itemEffective({ state: "suspension_scheduled", effectiveAt: "2026-12-01T00:00:00Z" }, now)).toMatchObject({ on: false, state: "suspended" });
    for (const s of ["suspended", "expired", "read_only", "inactive"] as const) expect(itemEffective({ state: s }, now).on).toBe(false);
  });
  it("vigência vencida: 7 dias de carência e depois somente leitura; empresa suspensa limita tudo", () => {
    expect(companyCap({ commercialStatus: "active", validUntil: "2026-12-05T00:00:00Z" }, now)).toMatchObject({ allowOn: true });
    expect(companyCap({ commercialStatus: "active", validUntil: "2026-12-01T00:00:00Z" }, now)).toMatchObject({ allowOn: false, state: "read_only" });
    expect(companyCap({ commercialStatus: "suspended" }, now).allowOn).toBe(false);
    expect(companyCap({ commercialStatus: "active", activationAt: "2026-12-20T00:00:00Z" }, now)).toMatchObject({ allowOn: false, state: "activation_scheduled" });
  });
  it("resolução de códigos: unidade, alias, incluído, módulo inteiro, não contratável e inexistente", () => {
    expect(resolveCode("07.01").units).toEqual(["07.01"]);
    expect(resolveCode("09.02")).toMatchObject({ units: ["01.04"], issue: { reason: "alias_resolved" } }); // grade de tamanhos ≡ variações (incluídas no cadastro de produtos)
    expect(resolveCode("07.13").issue?.reason).toBe("not_contractable"); // PIX do PDV ≡ 36.04: componente compartilhado, não se vende à parte
    expect(resolveCode("07.03")).toMatchObject({ units: ["07.02"], issue: { reason: "included_item" } }); // fechamento vem com o caixa
    expect(resolveCode("05").units).toEqual(expect.arrayContaining(["05.02", "05.04", "05.05", "05.06", "05.08"]));
    // correção 12: o módulo NN liga só as unidades principais (includedInParent); adicionais exigem item próprio
    expect(resolveCode("07").units.sort()).toEqual(["07.01", "07.02"]);
    expect(resolveCode("07").issue?.message).toMatch(/adicionais exigem item próprio \(07\.27\)/);
    expect(resolveCode("05").units).not.toContain("05.19"); // nota a confirmar: adicional
    for (const u of UNITS_V2) expect(typeof u.includedInParent, u.code).toBe("boolean");
    expect(resolveCode("14.02").issue?.reason).toBe("not_contractable"); // food service: futuro
    expect(resolveCode("99.99").issue?.reason).toBe("unknown_code");
  });
});

describe("aplicação do retrato de licença", () => {
  it("aplica em A sem afetar B; repetição devolve duplicate; versão menor (fora de ordem) é ignorada", async () => {
    const bBefore = await loadCompanyModules(store, B.id);
    const items = [...ALL_SELLABLE_RETAIL.filter((c) => c !== "05.02").map((code) => ({ code, state: "active" as const })), { code: "04.01", state: "active" as const }, { code: "04.02", state: "active" as const }];
    const r = await applyLicense(store, A.id, snap(A.id, 5, items, { controlMode: "enforced" }), meta);
    expect(r.status).toBe("applied");
    const a = await loadCompanyModules(store, A.id);
    expect(a!.mode).toBe("enforced");
    expect(decide(a, "compras.cotacoes").level).toBe("read"); // não licenciada: desligada com consulta
    expect(decide(a, "compras.pedidos").level).toBe("full");
    expect(await loadCompanyModules(store, B.id)).toEqual(bBefore);
    // repetição da mesma versão
    expect((await applyLicense(store, A.id, snap(A.id, 5, items, { controlMode: "enforced" }), meta)).status).toBe("duplicate");
    // fora de ordem: versão antiga chegando depois
    const old = await applyLicense(store, A.id, snap(A.id, 3, [{ code: "05.02", state: "active" }]), meta);
    expect(old).toMatchObject({ status: "stale", appliedVersion: 5 });
    expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("read");
    const hist = await listAll(store, "license_history", { filters: [["eq", "companyId", A.id]] });
    expect(hist.map((h) => `${h.licenseVersion}:${h.status}`).sort()).toEqual(["3:stale", "5:applied"]);
  });

  it("homologação: NF-e/NFC-e preservadas para quem já tinha; empresa nova não recebe unidade não homologada", async () => {
    const items = [...ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const })), { code: "04.01", state: "active" as const }];
    const plan = await planLicense(store, A.id, snap(A.id, 1, items));
    expect(plan.warnings.some((w) => w.reason === "preserved_access" && w.code === "04.01")).toBe(true);
    const C = (await createCompanyWithDefaults(store, { name: "Gama Nova Ficticia", key: "gama-lic" })).company;
    await provisionModules(store, C.id, ["cadastros.produtos"], "teste");
    const r = await applyLicense(store, C.id, snap(C.id, 1, [{ code: "01.04", state: "active" }, { code: "04.01", state: "active" }]), meta);
    expect(r.status).toBe("applied");
    expect(r.plan!.rejectedItems.some((i) => i.reason === "not_homologated" && i.code === "04.01")).toBe(true);
    expect(decide(await loadCompanyModules(store, C.id), "fiscal.nfe").level).toBe("none");
  });

  it("correção 2: o teto da empresa (suspensa, somente leitura, vigência vencida) desliga também as unidades não vendáveis; a reativação devolve", async () => {
    const t0 = Date.now();
    const notSellable = UNITS_V2.filter((u) => !u.sellable && u.v1Key && MODULE_MAP.has(u.v1Key)).map((u) => u.v1Key!);
    const before = await loadCompanyModules(store, A.id);
    const hadBefore = notSellable.filter((k) => ["enabled", "scheduled_off"].includes(before!.modules[k]?.state ?? ""));
    expect(hadBefore).toContain("fiscal.nfe"); // a empresa já tinha NF-e (direito preservado)
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    const r1 = await applyLicense(store, A.id, snap(A.id, 1, items, { controlMode: "enforced" }), meta);
    // preservadas: as que a empresa tinha e cujas dependências continuam no contrato (sem a Loja virtual no retrato,
    // Banco Intercert e Canais saem em cascata e o direito deles acaba junto)
    const kept = r1.plan!.preservedAccess;
    expect(kept).toEqual(expect.arrayContaining(["fiscal.nfe", "fiscal.nfce"]));
    for (const k of kept) expect(hadBefore).toContain(k);
    expect(decide(await loadCompanyModules(store, A.id), "fiscal.nfe").level).toBe("full");

    // empresa suspensa: nenhuma unidade fica ligada — nem as preservadas
    await applyLicense(store, A.id, snap(A.id, 2, items, { commercialStatus: "suspended" }), meta);
    let doc = await loadCompanyModules(store, A.id);
    for (const k of kept) expect(decide(doc, k).level, k).not.toBe("full");
    expect((await licenseStatus(store, A.id)).effective!["fiscal.nfe"]).toMatchObject({ on: false, state: "suspended" });

    // reativada: o direito que a empresa já tinha volta (não é venda nova)
    const r3 = await applyLicense(store, A.id, snap(A.id, 3, items), meta);
    expect(r3.plan!.changes.some((c) => c.module === "fiscal.nfe" && c.action === "enable")).toBe(true);
    doc = await loadCompanyModules(store, A.id);
    for (const k of kept) expect(decide(doc, k).level, k).toBe("full");

    // somente leitura e vigência vencida (depois da carência) também desligam
    await applyLicense(store, A.id, snap(A.id, 4, items, { commercialStatus: "read_only" }), meta);
    expect(decide(await loadCompanyModules(store, A.id), "fiscal.nfe").level).not.toBe("full");
    await applyLicense(store, A.id, snap(A.id, 5, items, { validUntil: iso(t0 + day) }), meta);
    expect(decide(await loadCompanyModules(store, A.id), "fiscal.nfe").level).toBe("full");
    await maintainLicense(store, A.id, new Date(t0 + 10 * day));
    expect(decide(await loadCompanyModules(store, A.id), "fiscal.nfe").level).not.toBe("full");

    // só a inativação explícita encerra o direito: listada como ativa depois, a NF-e é recusada (não homologada)
    await applyLicense(store, A.id, snap(A.id, 6, [...items, { code: "04.01", state: "inactive" }]), meta);
    const r7 = await applyLicense(store, A.id, snap(A.id, 7, [...items, { code: "04.01", state: "active" }]), meta);
    expect(r7.plan!.preservedAccess).not.toContain("fiscal.nfe");
    expect(r7.plan!.rejectedItems.some((i) => i.code === "04.01" && i.reason === "not_homologated")).toBe(true);
  });

  it("correção 9: controlMode enforced não marca divergências como revisadas — exige revisão nominal (baselineReview)", async () => {
    const bid = detId("modbase", A.id);
    await store.update("module_baselines", bid, { divergences: [{ module: "compras.cotacoes", kind: "in_use_not_available" }], status: "open", reviewedBy: null, reviewedAt: null });
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    const r1 = await applyLicense(store, A.id, snap(A.id, 1, items, { controlMode: "enforced" }), meta);
    expect(r1.status).toBe("applied");
    expect(r1.plan!.warnings.some((w) => w.reason === "review_required")).toBe(true);
    expect((await loadCompanyModules(store, A.id))!.mode).toBe("legacy"); // o controle não mudou
    expect((await store.get("module_baselines", bid))!.status).toBe("open"); // nem a revisão foi presumida
    const r2 = await applyLicense(store, A.id, snap(A.id, 2, items, { controlMode: "enforced", baselineReview: { reviewedBy: "Ana Souza (Interos)", notes: "Cotações em uso: contratadas no plano." } }), meta);
    expect(r2.plan!.warnings.some((w) => w.reason === "review_required")).toBe(false);
    expect((await loadCompanyModules(store, A.id))!.mode).toBe("enforced");
    expect(await store.get("module_baselines", bid)).toMatchObject({ status: "reviewed", reviewedBy: "Ana Souza (Interos)", notes: "Cotações em uso: contratadas no plano." });
  });

  it("correção 8: activation_scheduled numa unidade já ligada mantém a unidade ligada até a data", async () => {
    const t0 = Date.now();
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    await applyLicense(store, A.id, snap(A.id, 1, items, { controlMode: "enforced" }), meta);
    expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("full");
    const scheduled = items.map((it) => (it.code === "05.02" ? { code: "05.02", state: "activation_scheduled" as const, effectiveAt: iso(t0 + 5 * day) } : it));
    const r = await applyLicense(store, A.id, snap(A.id, 2, scheduled), meta);
    expect(r.plan!.changes.some((c) => c.module === "compras.cotacoes")).toBe(false);
    expect(r.plan!.effective["compras.cotacoes"]).toMatchObject({ on: true });
    expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("full");
    // e na data continua ligada
    await maintainLicense(store, A.id, new Date(t0 + 6 * day));
    expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("full");
  });

  it("correção 11: filiais da licença (branches) valem — fora da lista, só consulta; filial inexistente gera aviso", async () => {
    const own = await listAll(store, "branches", { filters: [["eq", "companyId", A.id]] });
    const second = await store.create("branches", { companyId: A.id, name: "Alfa — Filial 2", code: "02", status: "active" });
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    const r = await applyLicense(store, A.id, snap(A.id, 1, items, { branches: { mode: "list", branchIds: [own[0].id, "nao-existe"] } }), meta);
    expect(r.plan!.warnings.some((w) => w.reason === "unknown_branch" && /nao-existe/.test(w.message))).toBe(true);
    const { branchOutsideLicense } = await import("@/domain/licensing/branches");
    expect(await branchOutsideLicense(store, A.id, own[0].id)).toBeNull();
    expect(await branchOutsideLicense(store, A.id, second.id)).toMatch(/só para consulta/);
    // "all" (ou sem branches) libera todas
    await applyLicense(store, A.id, snap(A.id, 2, items, { branches: { mode: "all", branchIds: [] } }), meta);
    expect(await branchOutsideLicense(store, A.id, second.id)).toBeNull();
  });

  it("dependência ausente recusa o retrato inteiro (nada muda)", async () => {
    const C = (await createCompanyWithDefaults(store, { name: "Delta Ficticia", key: "delta-lic" })).company;
    await provisionModules(store, C.id, ["cadastros.produtos"], "teste");
    const before = await loadCompanyModules(store, C.id);
    const r = await applyLicense(store, C.id, snap(C.id, 1, [{ code: "05.02", state: "active" }]), meta); // cotações sem pedidos/fornecedores
    expect(r.status).toBe("rejected");
    expect(r.plan!.rejectedItems.some((i) => i.reason === "dependency_missing")).toBe(true);
    expect(await loadCompanyModules(store, C.id)).toEqual(before);
  });

  it("teste vencido e suspensão programada são executados localmente pela manutenção (sem o Interos)", async () => {
    const t0 = Date.now();
    const items = [...ALL_SELLABLE_RETAIL.filter((c) => !["05.02", "18.10"].includes(c)).map((code) => ({ code, state: "active" as const })),
      { code: "05.02", state: "trial" as const, until: iso(t0 + 2 * day) }, { code: "18.10", state: "suspension_scheduled" as const, effectiveAt: iso(t0 + 5 * day) }];
    await applyLicense(store, A.id, snap(A.id, 1, items, { controlMode: "enforced" }), meta);
    expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("full");
    // dia 6: suspensão programada vale; teste ainda em carência
    await maintainLicense(store, A.id, new Date(t0 + 6 * day));
    let doc = await loadCompanyModules(store, A.id);
    expect(decide(doc, "financeiro.conciliacao").level).toBe("read");
    expect(decide(doc, "compras.cotacoes").level).toBe("full");
    // dia 10: teste vencido há mais de 7 dias → suspenso
    await maintainLicense(store, A.id, new Date(t0 + 10 * day));
    doc = await loadCompanyModules(store, A.id);
    expect(decide(doc, "compras.cotacoes").level).toBe("read");
    const changes = await listAll(store, "module_changes", { filters: [["eq", "companyId", A.id], ["eq", "actorType", "system"]] });
    expect(changes.length).toBe(2);
    // aviso license.transition: cada mudança com o código comercial (05.02) além da chave interna
    const transitions = (await listAll(store, "jobs", { filters: [["eq", "type", "interos.event"]] })).filter((j) => j.payload?.event?.type === "license.transition");
    expect(transitions.length).toBe(2);
    const allChanges = transitions.flatMap((j) => j.payload.event.data.changes);
    expect(allChanges).toEqual(expect.arrayContaining([expect.objectContaining({ code: "05.02", module: "compras.cotacoes", action: "disable" }), expect.objectContaining({ code: "18.10", module: "financeiro.conciliacao" })]));
  });

  it("vigência vencida sem renovação: carência e depois somente leitura; em modo legacy nada é bloqueado", async () => {
    const t0 = Date.now();
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    await applyLicense(store, A.id, snap(A.id, 1, items, { validUntil: iso(t0 + day) }), meta);
    await maintainLicense(store, A.id, new Date(t0 + 5 * day));
    expect((await loadCompanyModules(store, A.id))!.modules["vendas.pdv"].state).toBe("enabled"); // carência
    await maintainLicense(store, A.id, new Date(t0 + 10 * day));
    const doc = await loadCompanyModules(store, A.id);
    expect(doc!.modules["vendas.pdv"].state).toBe("disabled"); // somente leitura (histórico em consulta)
    expect(doc!.modules["vendas.pdv"].history).toBe("read");
    expect(decide(doc, "vendas.pdv").level).toBe("full"); // A segue em legacy: o estado é gravado, nada é bloqueado ainda
    expect((await licenseStatus(store, A.id)).effective!["vendas.pdv"].state).toBe("read_only");
  });
});

describe("limites contratados", () => {
  it("usuários/dispositivos/filiais barram só novos cadastros; emissão fiscal nunca é bloqueada", async () => {
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    await applyLicense(store, A.id, snap(A.id, 1, items, { limits: { users: 0, devices: 0, branches: 1, fiscalDocumentsPerMonth: 0 } }), meta);
    await expect(assertWithinLimit(store, A.id, "users")).rejects.toMatchObject({ code: "license_limit" });
    await expect(assertWithinLimit(store, A.id, "devices")).rejects.toMatchObject({ code: "license_limit" });
    await expect(assertWithinLimit(store, A.id, "branches")).rejects.toMatchObject({ code: "license_limit" }); // já há a matriz
    await expect(assertWithinLimit(store, B.id, "users")).resolves.toBeUndefined(); // B sem licença: livre
    await store.create("fiscal_documents", { companyId: A.id, ref: "ref-1", model: "nfce", status: "authorized", branchId: null });
    await expect(noteFiscalDocumentUsage(store, A.id)).resolves.toBeUndefined();
    const ev = await listAll(store, "jobs", { filters: [["eq", "type", "interos.event"]] });
    expect(ev.some((j) => j.payload.event.type === "limit.reached" && j.payload.event.data.kind === "fiscalDocumentsPerMonth" && j.payload.event.data.blocking === false)).toBe(true);
  });
});

describe("eventos, assinatura e reconciliação", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("assinatura HMAC: válida, adulterada, fora da janela", () => {
    const secret = "s".repeat(40);
    const body = '{"a":1}';
    const sig = signBody(secret, body);
    expect(verifySignature(secret, sig, body).ok).toBe(true);
    expect(verifySignature(secret, sig, '{"a":2}').ok).toBe(false);
    expect(verifySignature(secret, signBody(secret, body, Math.floor(Date.now() / 1000) - 600), body).ok).toBe(false);
  });

  it("correção 10 — eventos de saída: sem configuração ficam NA FILA (nunca dados como entregues) e saem quando o destino existe", async () => {
    await applyLicense(store, A.id, snap(A.id, 1, ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }))), meta);
    let r = await runDueJobs(store, { types: ["interos.event"] });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.status === "retry")).toBe(true);
    const queued = await listAll(store, "jobs", { filters: [["eq", "type", "interos.event"]] });
    expect(queued.every((j) => j.status === "retry" && j.result?.reason === "not_configured")).toBe(true);
    // na fila para a próxima tentativa: o destino configurado depois recebe os eventos guardados
    for (const j of queued) await store.update("jobs", j.id, { runAt: new Date(Date.now() - 1000).toISOString() });
    process.env.INTEROS_EVENTS_URL = "https://interos.example/events";
    process.env.INTEROS_OUTBOUND_SECRET = "x".repeat(40);
    const calls: { headers: any; body: string }[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      calls.push({ headers: init.headers, body: init.body });
      return new Response("{}", { status: 200 });
    });
    await applyLicense(store, A.id, snap(A.id, 2, ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }))), meta);
    r = await runDueJobs(store, { types: ["interos.event"] });
    vi.unstubAllGlobals();
    expect(calls.length).toBeGreaterThan(queued.length - 1); // os guardados + os novos
    expect(calls.some((c) => JSON.parse(c.body).licenseVersion === undefined && JSON.parse(c.body).type === "license.applied")).toBe(true);
    expect(verifySignature("x".repeat(40), calls[0].headers["x-erp-signature"], calls[0].body).ok).toBe(true);
    expect((await listAll(store, "jobs", { filters: [["eq", "type", "interos.event"]] })).every((j) => j.status === "done")).toBe(true);
    delete process.env.INTEROS_EVENTS_URL;
    delete process.env.INTEROS_OUTBOUND_SECRET;
  });

  it("reconciliação: aplica retrato mais novo do Interos; Interos fora do ar mantém a última licença; retrato velho gera sync.stale", async () => {
    const items = ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }));
    await applyLicense(store, A.id, snap(A.id, 1, items), meta);
    process.env.INTEROS_LICENSE_URL = "https://interos.example/licenses/{companyId}";
    process.env.INTEROS_OUTBOUND_TOKEN = "tok";
    const newer = snap(A.id, 2, items.filter((i) => i.code !== "05.02"));
    const r1 = await reconcileLicense(store, A.id, (async () => new Response(JSON.stringify({ data: newer }), { status: 200 })) as any);
    expect(r1.pull).toBe("applied");
    expect((await licenseStatus(store, A.id)).appliedVersion).toBe(2);
    const r2 = await reconcileLicense(store, A.id, (async () => { throw new Error("ECONNREFUSED"); }) as any);
    expect(String(r2.pull)).toMatch(/ECONNREFUSED/);
    expect((await licenseStatus(store, A.id)).appliedVersion).toBe(2);
    // sync.stale conta desde a última CONFIRMAÇÃO do Interos (retrato, consulta ou pull que responde), não desde a
    // última licença nova (o Interos só manda quando algo muda): confirmação há 5 dias e o Interos fora do ar → aviso
    const licId = (await store.list("company_licenses", { filters: [["eq", "companyId", A.id]] })).items[0].id;
    await store.update("company_licenses", licId, { lastSnapshotAt: iso(Date.now() - 5 * day), lastConfirmedAt: iso(Date.now() - 5 * day) });
    const r3 = await reconcileLicense(store, A.id, (async () => { throw new Error("ECONNREFUSED"); }) as any);
    expect(r3).toMatchObject({ stale: true });
    // empresa estável: o pull que responde "em dia" confirma — sem aviso, mesmo sem licença nova há 5 dias
    await store.update("company_licenses", licId, { lastConfirmedAt: iso(Date.now() - 5 * day), staleNotifiedAt: null });
    const r4 = await reconcileLicense(store, A.id, (async () => new Response(JSON.stringify({ data: newer }), { status: 200 })) as any);
    expect(r4.pull).toBe("up_to_date");
    expect(r4.stale).toBeUndefined();
    // sem a consulta diária configurada, nada vai ao Interos (só o registro local)
    delete process.env.INTEROS_LICENSE_URL;
    delete process.env.INTEROS_OUTBOUND_TOKEN;
    await store.update("company_licenses", licId, { lastConfirmedAt: iso(Date.now() - 5 * day), staleNotifiedAt: null });
    const r5 = await reconcileLicense(store, A.id);
    expect(r5).toMatchObject({ pull: "not_configured", stale: "local" });
    const staleEvents = (await listAll(store, "jobs", { filters: [["eq", "type", "interos.event"]] })).filter((j) => j.payload?.event?.type === "sync.stale");
    expect(staleEvents.length).toBe(1);
    // a consulta do Interos também confirma (no máximo uma gravação por hora)
    const { noteConfirmation } = await import("@/domain/licensing/license");
    await noteConfirmation(store, A.id);
    expect(Date.parse((await store.get("company_licenses", licId))!.lastConfirmedAt)).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("telemetria, exibição e oportunidade de contratação", () => {
  it("telemetria agregada sem dados pessoais", async () => {
    const u = await companyUsage(store, A.id, iso(Date.now() - 30 * day), iso(Date.now() + day));
    expect(u.totals).toMatchObject({ sales: 0, branches: 1 });
    expect(JSON.stringify(u)).not.toMatch(/@|cpf|cnpj/i);
  });
  it("exibição: oculto para clientes atuais, oportunidade para empresa nova; solicitação só no modo oportunidade", async () => {
    expect(await displayMode(store, A.id)).toBe("hidden");
    const C = (await createCompanyWithDefaults(store, { name: "Épsilon Ficticia", key: "eps-lic" })).company;
    await provisionModules(store, C.id, ["cadastros.produtos"], "teste");
    expect(await displayMode(store, C.id)).toBe("upsell");
    const ctxC = { ...systemCtx(store, C.id), user: { ...systemCtx(store, C.id).user, id: "u-c", name: "Usuária C" } };
    const r = await requestUpsell(ctxC, "compras.cotacoes", "Queremos cotações");
    expect(r.duplicate).toBe(false);
    expect((await requestUpsell(ctxC, "compras.cotacoes", "")).duplicate).toBe(true);
    const ev = await listAll(unscoped(store), "jobs", { filters: [["eq", "type", "interos.event"]] });
    expect(ev.some((j) => j.payload.event.type === "upsell.requested" && j.companyId === C.id)).toBe(true);
    await expect(requestUpsell(systemCtx(store, A.id), "compras.cotacoes", "")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("exibição por unidade (fase A, 27/11)", () => {
  const key = (code: string) => unitByCode(code)!.v1Key!;
  // tudo contratado menos 05.02 (Cotações), como no teste de versão: o retrato é aceito e 05.02 fica desligada
  const items = [...ALL_SELLABLE_RETAIL.filter((c) => c !== "05.02").map((code) => ({ code, state: "active" as const })), { code: "04.01", state: "active" as const }, { code: "04.02", state: "active" as const }];
  const ctxA = () => ({ ...systemCtx(store, A.id), user: { ...systemCtx(store, A.id).user, id: "u-a", name: "Usuário A" } });

  it("resolveDisplays: a unidade vence o módulo; função dentro da unidade é só aviso; código inválido é recusado", () => {
    const r = resolveDisplays([
      { code: "05", display: "locked" },
      { code: "05.02", display: "upsell" },
      { code: "07.03", display: "upsell" }, // fechamento de caixa: vem com a 07.02 (função, fase B)
      { code: "99.99", display: "hidden" },
      { code: "07.13", display: "upsell" }, // componente compartilhado: não contratável
    ]);
    expect(r.byKey.get(key("05.02"))).toBe("upsell");
    expect(r.byKey.get(key("05.04"))).toBe("locked");
    expect(r.byKey.has(key("05.19"))).toBe(false); // adicional do módulo: o módulo não decide por ele (como no licenciamento)
    expect(r.byKey.has(key("07.02"))).toBe(false); // a escolha da função não muda a unidade
    expect(r.warnings).toEqual([expect.objectContaining({ code: "07.03", reason: "display_not_supported" })]);
    expect(r.rejected.map((i) => i.reason).sort()).toEqual(["not_contractable", "unknown_code"]);
    // a mesma unidade escolhida duas vezes: vale a mais visível
    expect(resolveDisplays([{ code: "05.02", display: "hidden" }, { code: "05.02", display: "locked" }]).byKey.get(key("05.02"))).toBe("locked");
    expect(resolveDisplays(null).byKey.size).toBe(0);
  });

  it("pathDisplay: tela que várias unidades liberam segue a mais visível entre as contratáveis", () => {
    const d = (k: string): DisplayMode => (k === "a" ? "hidden" : k === "b" ? "upsell" : "locked");
    expect(pathDisplay(["a", "b", "c"], d, () => true)).toEqual({ display: "upsell", module: "b" });
    expect(pathDisplay(["a", "c"], d, () => true)).toEqual({ display: "locked", module: "c" });
    expect(pathDisplay(["a"], d, () => true)).toEqual({ display: "hidden", module: "a" });
    expect(pathDisplay(["b"], d, () => false)).toEqual({ display: "hidden", module: null });
  });

  it("cada unidade desligada segue a sua escolha; sem escolha, o padrão da empresa; 'contratar' só na unidade em 'contratar'", async () => {
    const r1 = await applyLicense(store, A.id, snap(A.id, 1, items, { display: "hidden", displays: [{ code: "05.02", display: "upsell" }] }), meta);
    expect(r1.status).toBe("applied");
    expect(r1.plan!.effective[key("05.02")]).toMatchObject({ on: false, display: "upsell" });
    expect(r1.plan!.effective[key("07.01")]).toMatchObject({ on: true, display: "hidden" });
    const shown = await displayResolver(store, A.id);
    expect(shown(key("05.02"))).toBe("upsell");
    expect(shown("ecommerce.loja")).toBe("hidden"); // sem escolha própria: padrão da empresa
    expect(await displayMode(store, A.id)).toBe("hidden"); // o padrão da empresa não muda
    const st = await licenseStatus(store, A.id);
    expect(st.display).toBe("hidden");
    expect(st.displays).toEqual([{ code: "05.02", display: "upsell" }]);
    expect((await requestUpsell(ctxA(), "compras.cotacoes", "Queremos cotações")).duplicate).toBe(false);
    const ev = await listAll(unscoped(store), "jobs", { filters: [["eq", "type", "interos.event"]] });
    expect(ev.some((j) => j.payload.event.type === "upsell.requested" && j.companyId === A.id && j.payload.event.data?.code === "05.02")).toBe(true);
  });

  it("mudar só a exibição não liga nem desliga nada; tirar a escolha volta ao padrão e fecha o 'contratar'", async () => {
    const r1 = await applyLicense(store, A.id, snap(A.id, 1, items, { display: "hidden", displays: [{ code: "05.02", display: "upsell" }] }), meta);
    const r2 = await applyLicense(store, A.id, snap(A.id, 2, items, { display: "hidden", displays: [] }), meta);
    expect(r2.status).toBe("applied");
    expect(r2.plan!.changes).toEqual([]);
    expect(r2.runtimeVersion).toBe(r1.runtimeVersion);
    expect((await displayResolver(store, A.id))(key("05.02"))).toBe("hidden");
    await expect(requestUpsell(ctxA(), "compras.cotacoes", "")).rejects.toMatchObject({ code: "forbidden" });
    // padrão da empresa em "contratar" com uma unidade escondida: a escolha da unidade vence
    await applyLicense(store, A.id, snap(A.id, 3, items, { display: "upsell", displays: [{ code: "05.02", display: "hidden" }] }), meta);
    const shown = await displayResolver(store, A.id);
    expect(shown(key("05.02"))).toBe("hidden");
    expect(shown("ecommerce.loja")).toBe("upsell");
    await expect(requestUpsell(ctxA(), "compras.cotacoes", "")).rejects.toMatchObject({ code: "forbidden" });
    // a rotina diária reaplica o retrato vigente e mantém a exibição (a unidade ligada mostra o padrão novo da empresa)
    await maintainLicense(store, A.id);
    expect((await store.get("company_licenses", detId("license", A.id)))!.effective[key("07.01")]).toMatchObject({ on: true, display: "upsell" });
    expect((await displayResolver(store, A.id))(key("05.02"))).toBe("hidden");
  });

  it("revisão: alias de função incluída também é só aviso (não muda a exibição da unidade dona)", () => {
    // 26.01 é alias de 01.05, que vem com a 01.04
    const r = resolveDisplays([{ code: "26.01", display: "upsell" }]);
    expect(r.byKey.size).toBe(0);
    expect(r.warnings).toEqual([expect.objectContaining({ code: "26.01", reason: "display_not_supported" })]);
    expect(r.rejected).toEqual([]);
  });

  it("revisão: retrato sem 'displays' mantém as escolhas por unidade; lista vazia limpa", async () => {
    await applyLicense(store, A.id, snap(A.id, 1, items, { display: "hidden", displays: [{ code: "05.02", display: "upsell" }] }), meta);
    // retrato de quem ainda não conhece a fase A (sem o campo): as escolhas continuam valendo
    const r2 = await applyLicense(store, A.id, snap(A.id, 2, items, { display: "hidden" }), meta);
    expect(r2.status).toBe("applied");
    expect((await displayResolver(store, A.id))(key("05.02"))).toBe("upsell");
    expect((await licenseStatus(store, A.id)).displays).toEqual([{ code: "05.02", display: "upsell" }]);
    expect((await store.get("company_licenses", detId("license", A.id)))!.snapshot.displays).toEqual([{ code: "05.02", display: "upsell" }]);
    // a rotina diária reaplica o retrato vigente e também mantém
    await maintainLicense(store, A.id);
    expect((await displayResolver(store, A.id))(key("05.02"))).toBe("upsell");
    // lista vazia: limpa de propósito, e a unidade volta ao padrão da empresa
    await applyLicense(store, A.id, snap(A.id, 3, items, { display: "hidden", displays: [] }), meta);
    expect((await displayResolver(store, A.id))(key("05.02"))).toBe("hidden");
    expect((await licenseStatus(store, A.id)).displays).toEqual([]);
  });

  it("revisão: 'contratar' recusa unidade já ligada, de outro tipo de empresa ou ainda não vendável", async () => {
    await applyLicense(store, A.id, snap(A.id, 1, items, { display: "upsell" }), meta);
    await expect(requestUpsell(ctxA(), key("07.01"), "")).rejects.toMatchObject({ code: "invalid_request" }); // já ligada
    await expect(requestUpsell(ctxA(), "contabil.carteira", "")).rejects.toMatchObject({ code: "invalid_request" }); // só para escritório contábil
    await expect(requestUpsell(ctxA(), "ecommerce.banco", "")).rejects.toMatchObject({ code: "invalid_request" }); // depende de homologação
    await expect(requestUpsell(ctxA(), "nao.existe", "")).rejects.toMatchObject({ code: "invalid_request" });
    // desligada, do tipo da empresa, vendável e em "contratar": aceita
    expect((await requestUpsell(ctxA(), "compras.cotacoes", "")).duplicate).toBe(false);
  });

  it("valor de exibição inválido recusa o retrato; código inexistente na exibição só volta como recusado", async () => {
    await expect(applyLicense(store, A.id, { ...snap(A.id, 1, items), displays: [{ code: "05.02", display: "sometimes" }] }, meta)).rejects.toMatchObject({ code: "invalid_request" });
    const r = await applyLicense(store, A.id, snap(A.id, 1, items, { displays: [{ code: "99.99", display: "upsell" }] }), meta);
    expect(r.status).toBe("applied");
    expect(r.plan!.rejectedItems).toEqual([expect.objectContaining({ code: "99.99", reason: "unknown_code" })]);
  });
});

describe("perfil por cargo/departamento/função (o perfil segue único contêiner de permissões)", () => {
  it("primeira regra que casa, sem diferenciar caixa e acento", () => {
    const rules = [{ attribute: "department" as const, value: "Financeiro", roleId: "r-fin" }, { attribute: "jobTitle" as const, value: "Operador de Caixa", roleId: "r-cx" }];
    expect(roleFromAttributes(rules, { jobTitle: "operador de caixa" })).toBe("r-cx");
    expect(roleFromAttributes(rules, { department: "FINANCEIRO", jobTitle: "operador de caixa" })).toBe("r-fin");
    expect(roleFromAttributes(rules, { jobFunction: "x" })).toBeNull();
  });
});

describe("API /api/interos/v2", () => {
  // registro único de credenciais (INTEROS_CREDENCIAIS): token `<id>.<segredo>`; HMAC pelo nome da variável em `assinatura`
  const tokenSecret = crypto.randomBytes(32).toString("base64url");
  const roSecret = crypto.randomBytes(32).toString("base64url");
  const token = `interos-v2.${tokenSecret}`;
  const roToken = `interos-ro.${roSecret}`;
  const secret = "z".repeat(48);
  const h = (t: string) => `sha256:${crypto.createHash("sha256").update(t).digest("hex")}`;
  beforeEach(async () => {
    process.env.INTEROS_SIGN_TEST = secret;
    process.env.INTEROS_CREDENCIAIS = JSON.stringify([
      { id: "interos-v2", escopos: ["erp.license.read", "erp.license.write", "erp.usage.read"], hash: h(tokenSecret), assinatura: "INTEROS_SIGN_TEST" },
      { id: "interos-ro", escopos: ["erp.license.read"], hash: h(roSecret), empresas: ["outra"] },
    ]);
    // a credencial sem lista só alcança empresas ligadas ao Interos (criadas pelo provisionamento ou vinculadas com o código)
    await store.update("companies", A.id, { interosAccountId: "acc-lic-alfa" });
    await store.update("companies", B.id, { interosAccountId: "acc-lic-beta" });
  });
  const req = (body: string, headers: Record<string, string> = {}, t = token) => new Request("http://erp.local/x", { method: "PUT", body, headers: { authorization: `Bearer ${t}`, "content-type": "application/json", ...headers } });
  const params = () => ({ params: Promise.resolve({ companyId: A.id }) });

  it("PUT assinado aplica; repetição do evento devolve a mesma resposta; corpo diferente no mesmo evento é recusado", async () => {
    const { PUT, GET } = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    const body = JSON.stringify(snap(A.id, 7, ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }))));
    const sig = signBody(secret, body);
    const r1 = await PUT(req(body, { "x-interos-signature": sig, "x-interos-event-id": "evt-0001-abcdef" }), params());
    expect(r1.status).toBe(201);
    expect((await r1.json()).data).toMatchObject({ status: "applied", appliedVersion: 7 });
    const r2 = await PUT(req(body, { "x-interos-signature": sig, "x-interos-event-id": "evt-0001-abcdef" }), params());
    expect(r2.status).toBe(201);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    const other = JSON.stringify(snap(A.id, 8, []));
    const r3 = await PUT(req(other, { "x-interos-signature": signBody(secret, other), "x-interos-event-id": "evt-0001-abcdef" }), params());
    expect(r3.status).toBe(409);
    const bad = await PUT(req(body, { "x-interos-signature": "t=1,v1=00", "x-interos-event-id": "evt-0002-abcdef" }), params());
    expect(bad.status).toBe(401);
    const st = await GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${token}` } }), params());
    expect(st.headers.get("etag")).toBe('"7"');
  });

  it("fase A: o PUT assinado leva a exibição por unidade e o GET devolve a escolha e a exibição efetiva", async () => {
    const { PUT, GET } = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    const items = ALL_SELLABLE_RETAIL.filter((c) => c !== "05.02").map((code) => ({ code, state: "active" as const }));
    const body = JSON.stringify(snap(A.id, 9, items, { display: "locked", displays: [{ code: "05.02", display: "upsell" }] }));
    const r = await PUT(req(body, { "x-interos-signature": signBody(secret, body), "x-interos-event-id": "evt-faseA-0001" }), params());
    expect(r.status).toBe(201);
    const put = (await r.json()).data;
    expect(put.effective["compras.cotacoes"]).toMatchObject({ on: false, display: "upsell" });
    expect(put.effective["vendas.pdv"]).toMatchObject({ on: true, display: "locked" });
    const st = await (await GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${token}` } }), params())).json();
    expect(st.data).toMatchObject({ display: "locked", displays: [{ code: "05.02", display: "upsell" }] });
  });

  it("correção 3: transição vencida vale na hora — a leitura do Interos aplica (sem a rotina diária) e o histórico mostra", async () => {
    const t0 = Date.now();
    const items = [...ALL_SELLABLE_RETAIL.filter((c) => c !== "05.02").map((code) => ({ code, state: "active" as const })), { code: "05.02", state: "trial" as const, until: iso(t0 + 2 * day) }];
    await applyLicense(store, A.id, snap(A.id, 1, items, { controlMode: "enforced" }), meta);
    expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("full");
    // antes do instante: nada a aplicar
    expect((await applyDueTransitions(store, A.id, new Date(t0 + day))).license).toBe(false);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // dia 10: teste e carência vencidos — a primeira leitura do Interos aplica
      vi.setSystemTime(new Date(t0 + 10 * day));
      const { GET } = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
      const st = await GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${token}` } }), params());
      expect((await st.json()).data.effective["compras.cotacoes"]).toMatchObject({ on: false, state: "suspended" });
      expect(decide(await loadCompanyModules(store, A.id), "compras.cotacoes").level).toBe("read");
      const hist = await (await import("@/app/api/interos/v2/companies/[companyId]/license/history/route")).GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${token}` } }), params());
      const rows = (await hist.json()).data;
      expect(rows[0]).toMatchObject({ kind: "transition", licenseVersion: 1, source: "local", changes: [expect.objectContaining({ module: "compras.cotacoes", action: "disable" })] });
      expect(rows.some((h: any) => h.kind === "snapshot" && h.licenseVersion === 1)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("correção 7: Event-Id registrado só depois da validação — corpo inválido não consome o evento", async () => {
    const { PUT } = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    const bad = JSON.stringify({ ...snap(A.id, 4, []), licenseVersion: "quatro" });
    const r1 = await PUT(req(bad, { "x-interos-signature": signBody(secret, bad), "x-interos-event-id": "evt-corrige-0001" }), params());
    expect(r1.status).toBe(400);
    expect(await store.get("interos_events", sha256("interos-v2|evt-corrige-0001").slice(0, 32))).toBeNull();
    // o Interos corrige o corpo e reenvia com o MESMO Event-Id: aceito
    const good = JSON.stringify(snap(A.id, 4, ALL_SELLABLE_RETAIL.map((code) => ({ code, state: "active" as const }))));
    const r2 = await PUT(req(good, { "x-interos-signature": signBody(secret, good), "x-interos-event-id": "evt-corrige-0001" }), params());
    expect(r2.status).toBe(201);
    // depois de processado, o mesmo Event-Id com outro corpo continua recusado
    const r3 = await PUT(req(bad, { "x-interos-signature": signBody(secret, bad), "x-interos-event-id": "evt-corrige-0001" }), params());
    expect(r3.status).toBe(409);
  });

  it("correção 3 (listas): a lista de empresas consultada pelo Interos aplica as transições vencidas de todas elas", async () => {
    const t0 = Date.now();
    const trial = (cid: string) => snap(cid, 1, [...ALL_SELLABLE_RETAIL.filter((c) => c !== "05.02").map((code) => ({ code, state: "active" as const })), { code: "05.02", state: "trial" as const, until: iso(t0 + day) }], { controlMode: "enforced" });
    await applyLicense(store, A.id, trial(A.id), meta);
    await applyLicense(store, B.id, trial(B.id), meta);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(t0 + 10 * day));
      const r = await (await import("@/app/api/interos/v2/companies/route")).GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${token}` } }));
      expect(r.status).toBe(200);
      for (const c of [A, B]) expect(decide(await loadCompanyModules(store, c.id), "compras.cotacoes").level, c.id).toBe("read");
    } finally {
      vi.useRealTimers();
    }
  });

  it("escopo e restrição de empresa por credencial", async () => {
    const { PUT, GET } = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    const body = JSON.stringify(snap(A.id, 1, []));
    expect((await PUT(req(body, {}, roToken), params())).status).toBe(403); // sem escopo de escrita
    expect((await GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${roToken}` } }), params())).status).toBe(403); // empresa não permitida
  });

  it("catálogo, sincronização, telemetria, erros e solicitações", async () => {
    const auth = { headers: { authorization: `Bearer ${token}` } };
    const cat = await (await import("@/app/api/interos/v2/catalog/route")).GET(new Request("http://erp.local/x", auth));
    expect((await cat.json()).data.catalog).toBe("catalogo-modulos-erp-v2");
    const item = await (await import("@/app/api/interos/v2/catalog/[code]/route")).GET(new Request("http://erp.local/x", auth), { params: Promise.resolve({ code: "07" }) });
    expect((await item.json()).data.children.length).toBeGreaterThan(20);
    const sync = await (await import("@/app/api/interos/v2/companies/[companyId]/sync/route")).GET(new Request("http://erp.local/x", auth), params());
    expect((await sync.json()).data).toMatchObject({ companyId: A.id, appliedVersion: 0 });
    const usage = await (await import("@/app/api/interos/v2/companies/[companyId]/usage/route")).GET(new Request("http://erp.local/x?from=2026-01-01T00:00:00Z", auth), params());
    expect(usage.status).toBe(200);
    const errs = await (await import("@/app/api/interos/v2/errors/route")).GET(new Request("http://erp.local/x", auth));
    expect(Array.isArray((await errs.json()).data)).toBe(true);
    const ups = await (await import("@/app/api/interos/v2/upsell-requests/route")).GET(new Request("http://erp.local/x", auth));
    expect(ups.status).toBe(200);
  });

  it("correção 4 (LGPD): a solicitação de contratação chega ao Interos com identificador pseudônimo e perfil, nunca o nome", async () => {
    const C = (await createCompanyWithDefaults(store, { name: "Zeta Ficticia", key: "zeta-lic" })).company;
    // ligada ao Interos: a credencial sem lista só vê os pedidos das empresas ligadas
    await store.update("companies", C.id, { interosAccountId: "acc-lic-zeta" });
    await provisionModules(store, C.id, ["cadastros.produtos"], "teste");
    const sys = systemCtx(store, C.id);
    const ctxC = { ...sys, user: { ...sys.user, id: "u-zeta-1", name: "Joana da Silva Pereira", roleName: "Gerente de loja" } };
    await requestUpsell(ctxC, "compras.cotacoes", "Queremos começar no mês que vem");
    await requestUpsell({ ...ctxC, user: { ...ctxC.user } }, "compras.pedidos", "");
    const res = await (await import("@/app/api/interos/v2/upsell-requests/route")).GET(new Request("http://erp.local/x", { headers: { authorization: `Bearer ${token}` } }));
    const rows = (await res.json()).data.filter((r: any) => r.companyId === C.id);
    expect(rows.length).toBe(2);
    expect(JSON.stringify(rows)).not.toMatch(/Joana|Silva|Pereira/);
    expect(rows[0].requestedBy).toMatch(/^usr_[0-9a-f]{20}$/);
    expect(rows[0].requestedBy).toBe(rows[1].requestedBy); // a mesma pessoa tem sempre o mesmo identificador
    expect(rows[0].requesterRole).toBe("Gerente de loja");
    // nem o banco do ERP guarda mais o nome na solicitação
    const stored = await listAll(unscoped(store), "upsell_requests", { filters: [["eq", "companyId", C.id]] });
    expect(stored.every((r) => r.userName == null)).toBe(true);
  });

  it("sem segredo de assinatura configurado as escritas respondem 503", async () => {
    delete process.env.INTEROS_SIGN_TEST;
    delete process.env.INTEROS_CREDENCIAIS;
    const { PUT } = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    const body = JSON.stringify(snap(A.id, 1, []));
    expect((await PUT(req(body, { "x-interos-signature": signBody(secret, body), "x-interos-event-id": "evt-0003-abcdef" }), params())).status).toBe(503);
  });
});
