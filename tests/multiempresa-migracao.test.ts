import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { findOne, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { runTenancyMigration } from "@/domain/tenancy/migration";

/**
 * Migração multiempresa (docs/multiempresa/migracao.md): simular não altera nada; aplicar preenche só o inequívoco,
 * encaminha o ambíguo para revisão, marca a empresa da plataforma, registra os vínculos e confere que nenhum valor de
 * negócio mudou. Roda de novo sem efeito (idempotente).
 */
let store: Store;
let loja: Doc;
let firm: Doc;

beforeAll(async () => {
  store = freshStore();
  await seedDemo(store, { historyDays: 2 });
  loja = (await findOne(store, "companies", [["eq", "cnpj", "11222333000181"]]))!;
  firm = (await findOne(store, "companies", [["eq", "cnpj", "33444555000170"]]))!;
  const lojaBranch = (await findOne(store, "branches", [["eq", "companyId", loja.id]]))!;
  const firmBranch = (await findOne(store, "branches", [["eq", "companyId", firm.id]]))!;
  // instalação "legada": dados como podem estar antes do multiempresa
  // registro sem empresa: o banco não impede (sem NOT NULL); uma alteração antiga pode ter zerado o campo
  await store.create("customers", { companyId: loja.id, branchId: lojaBranch.id, personType: "PF", name: "Cliente sem empresa (filial conhecida)" }, "legado-com-filial");
  await store.update("customers", "legado-com-filial", { companyId: null });
  await store.create("customers", { companyId: loja.id, personType: "PF", name: "Cliente órfão" }, "legado-orfao");
  await store.update("customers", "legado-orfao", { companyId: null });
  await store.create("customers", { companyId: loja.id, branchId: firmBranch.id, personType: "PF", name: "Cliente com filial de outra empresa" }, "legado-ambiguo");
  await store.create("users", { name: "Usuário de empresa apagada", email: "fantasma@teste.example", status: "active", companyIds: [loja.id, "empresa-apagada"], branchIds: [] }, "legado-usuario");
  await store.create("roles", { companyId: loja.id, key: "antigo", name: "Perfil antigo com operação da plataforma", permissions: {}, actions: ["network.manage"], system: false, active: true }, "legado-perfil");
  await store.create("integrations", { companyId: loja.id, scopeKey: `${loja.id}|*|email`, kind: "email", provider: "resend", secretRefs: { apiKey: "RESEND_API_KEY" }, status: "configured_untested", enabled: true }, "integ-loja");
  await store.create("integrations", { companyId: firm.id, scopeKey: `${firm.id}|*|email`, kind: "email", provider: "resend", secretRefs: { apiKey: "RESEND_API_KEY" }, status: "configured_untested", enabled: true }, "integ-firm");
  // plataforma ainda não marcada e vínculos ainda não registrados (instalação anterior ao multiempresa)
  const plat = (await findOne(store, "companies", [["eq", "isPlatform", true]]))!;
  await store.update("companies", plat.id, { isPlatform: false });
  for (const r of await listAll(store, "company_relations")) await store.delete("company_relations", r.id);
}, 600_000);

describe("migração multiempresa", () => {
  it("simular: relatório completo sem alterar nada", async () => {
    const before = await listAll(store, "customers");
    const r = await runTenancyMigration(store, { mode: "simular", requestedBy: "teste" });
    expect(r.conferencia.ok).toBe(true);
    expect(r.preenchidos.map((p) => p.recordId)).toEqual(["legado-com-filial"]);
    expect(r.revisao.map((x) => x.recordId)).toEqual(expect.arrayContaining(["legado-orfao", "legado-ambiguo", "legado-usuario"]));
    expect(r.plataforma.empresa).toBeTruthy();
    expect(r.plataforma.marcadaAgora).toBe(false);
    expect(r.perfisComOperacaoDePlataforma.map((p) => p.roleId)).toContain("legado-perfil");
    expect(r.credenciaisCompartilhadas).toEqual([{ variavel: "RESEND_API_KEY", empresas: 2 }]);
    expect(r.vinculos.contabilidade.ativos).toBeGreaterThanOrEqual(1);
    expect(r.vinculos.criados).toBe(0);
    // nada gravado além do relatório
    expect((await store.get("customers", "legado-com-filial"))!.companyId ?? null).toBeNull();
    expect(await listAll(store, "tenancy_reviews")).toHaveLength(0);
    expect(await listAll(store, "company_relations")).toHaveLength(0);
    expect((await listAll(store, "customers")).length).toBe(before.length);
  });

  it("aplicar: preenche o inequívoco, revisa o ambíguo, marca a plataforma, registra vínculos e confere os valores", async () => {
    const r = await runTenancyMigration(store, { mode: "aplicar", requestedBy: "teste" });
    expect(r.conferencia).toEqual({ ok: true, diferencas: [] });
    expect((await store.get("customers", "legado-com-filial"))!.companyId).toBe(loja.id);
    expect((await store.get("customers", "legado-orfao"))!.companyId ?? null).toBeNull(); // não adivinha
    const reviews = await listAll(store, "tenancy_reviews");
    expect(reviews.map((x) => x.recordId)).toEqual(expect.arrayContaining(["legado-orfao", "legado-ambiguo", "legado-usuario"]));
    expect(reviews.every((x) => x.status === "pendente")).toBe(true);
    expect(r.plataforma.marcadaAgora).toBe(true);
    expect((await store.get("companies", r.plataforma.empresa!))!.isPlatform).toBe(true);
    expect(r.vinculos.criados).toBeGreaterThanOrEqual(7);
    const run = (await listAll(store, "migration_runs")).find((m) => m.mode === "aplicar");
    expect(run).toMatchObject({ status: "ok", kind: "multiempresa" });
    // valores de negócio idênticos antes e depois (vendas, títulos em aberto, estoque, documentos fiscais)
    expect(r.depois.byCompany[loja.id].vendasCentavos).toBe(r.antes.byCompany[loja.id].vendasCentavos);
    expect(r.depois.byCompany[loja.id].vendas).toBeGreaterThan(0);
  });

  it("repetir não muda nada (idempotente)", async () => {
    const reviews = (await listAll(store, "tenancy_reviews")).length;
    const r = await runTenancyMigration(store, { mode: "aplicar", requestedBy: "teste" });
    expect(r.conferencia.ok).toBe(true);
    expect(r.preenchidos).toHaveLength(0);
    expect(r.vinculos.criados).toBe(0);
    expect(r.plataforma.marcadaAgora).toBe(false);
    expect((await listAll(store, "tenancy_reviews")).length).toBe(reviews);
  });
});
