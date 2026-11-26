import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// canal de e-mail controlável: permite simular a queda do provedor no meio da implantação
const mail = vi.hoisted(() => ({ fail: 0, sent: [] as string[] }));
vi.mock("@/lib/core/email", () => ({
  sendEmail: async (_c: string | null, msg: { to: string }) => {
    if (mail.fail > 0) {
      mail.fail--;
      throw new Error("provedor de e-mail fora do ar");
    }
    mail.sent.push(msg.to);
    return { delivered: true, channel: "teste" };
  },
}));

import { NextRequest } from "next/server";
import { freshStore } from "./helpers";
import { listAll, detId } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { setServiceCredentials } from "@/lib/service/credentials";
import { resetServiceRateLimits } from "@/lib/service/http";
import { createCompanyWithDefaults } from "@/domain/setup";
import { createInterosLinkCode } from "@/domain/tenancy/link-code";
import { toCtxUser, accessibleUnits } from "@/lib/auth/users";
import { scopeStore } from "@/lib/db/scoped-store";
import { companySelectable } from "@/domain/tenancy/status";
import { acceptInvite } from "@/domain/users";

const SECRET = "s".repeat(43);
const PROV = `Bearer interos-prov.${SECRET}`;
const TORRE = `Bearer interos-torre.${"t".repeat(43)}`;
const URL0 = "http://erp.test/api/interos/v1";

let store: Store;
let existing: { id: string; cnpj: string };

type R = { status: number; body: any; headers: Headers };
async function call(method: "GET" | "POST" | "PUT", path: string, opts: { body?: unknown; key?: string; auth?: string | null; params?: Record<string, string> } = {}): Promise<R> {
  const routeFile = routeFor(path);
  const mod = await import(`@/app/api/interos/v1/${routeFile}/route`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== null) headers.authorization = opts.auth ?? PROV;
  if (opts.key) headers["idempotency-key"] = opts.key;
  const res: Response = await mod[method](new NextRequest(`${URL0}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** Caminho → arquivo de rota (o teste chama o handler como o Next chamaria). */
function routeFor(path: string): string {
  const p = path.split("?")[0];
  if (p === "/status") return "status";
  if (p === "/empresas") return "empresas";
  if (p === "/empresas/vincular") return "empresas/vincular";
  const m = /^\/empresas\/[^/]+(\/.*)?$/.exec(p)!;
  return `empresas/[idEmpresa]${m[1] ?? ""}`;
}

const body = (over: Record<string, any> = {}) => ({
  contaInterosId: "acc-alfa-001",
  empresa: { razaoSocial: "Alfa Utilidades Domésticas Ltda", nomeFantasia: "Alfa Utilidades", cnpj: "45.723.174/0001-10", regimeTributario: "simples", email: "contato@alfa.example", endereco: { cep: "01310-100", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista", municipio: "São Paulo", codigoMunicipioIbge: "3550308", uf: "SP" } },
  unidadeInicial: { nome: "Alfa — Paulista", codigo: "01" },
  modulos: ["pdv", "vendas", "estoque", "financeiro"],
  administrador: { nome: "Maria Alfa", email: "maria@alfa.example" },
  contrato: { referencia: "CT-2026-0042", plano: "profissional" },
  ...over,
});

beforeAll(async () => {
  store = freshStore();
  setServiceCredentials([
    { id: "interos-prov", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: SECRET },
    { id: "interos-torre", escopos: ["torre:resumo"], segredo: "t".repeat(43) },
  ]);
  // empresa que já usa o ERP (vinculação por código) — e evita a demonstração automática do modo memória
  const { company } = await createCompanyWithDefaults(store, { name: "Beta Moda e Acessórios Ltda", tradeName: "Beta Moda", cnpj: "11222333000181", key: "beta-existente" });
  existing = { id: company.id, cnpj: company.cnpj };
  const adminRole = (await listAll(store, "roles", { filters: [["eq", "companyId", company.id], ["eq", "key", "admin"]] }))[0];
  await store.create("users", { name: "Bruno Beta", email: "bruno@beta.example", status: "active", companyIds: [company.id], roleId: adminRole.id, roleByCompany: { [company.id]: adminRole.id }, branchIds: [] }, "bruno-beta");
});

beforeEach(() => resetServiceRateLimits());

describe("interface de serviço — autenticação e escopos", () => {
  it("sem credencial, com segredo errado, sem escopo e sem configuração", async () => {
    expect((await call("GET", "/status", { auth: null })).status).toBe(401);
    expect((await call("GET", "/status", { auth: `Bearer interos-prov.${"x".repeat(43)}` })).status).toBe(401);
    const ok = await call("GET", "/status");
    expect(ok.status).toBe(200);
    expect(ok.body.cliente.escopos).toContain("provisionamento:escrita");
    expect(ok.headers.get("x-request-id")).toMatch(/^req_/);
    // credencial da Torre não provisiona
    const r = await call("POST", "/empresas", { auth: TORRE, key: "k-torre-0001", body: body() });
    expect(r.status).toBe(403);
    expect(r.body.erro.codigo).toBe("sem_permissao");
    // alteração sem Idempotency-Key
    expect((await call("POST", "/empresas", { body: body() })).body.erro.codigo).toBe("idempotencia_obrigatoria");
    setServiceCredentials([]);
    expect((await call("GET", "/status")).status).toBe(503);
    setServiceCredentials([
      { id: "interos-prov", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: SECRET },
      { id: "interos-torre", escopos: ["torre:resumo"], segredo: "t".repeat(43) },
    ]);
  });

  it("validação devolve os campos com problema", async () => {
    const r = await call("POST", "/empresas", { key: "k-invalida-01", body: body({ empresa: { razaoSocial: "", cnpj: "123" }, modulos: ["pdv", "voo_espacial"], administrador: { nome: "", email: "x" } }) });
    expect(r.status).toBe(422);
    expect(r.body.erro.codigo).toBe("validacao");
    const campos = r.body.erro.campos.map((c: any) => c.campo);
    expect(campos).toEqual(expect.arrayContaining(["empresa.razaoSocial", "empresa.cnpj", "modulos", "administrador.nome", "administrador.email"]));
  });
});

describe("provisionamento — criar, reenviar e retomar sem duplicar", () => {
  let idEmpresa = "";

  it("cria empresa, unidade inicial, módulos e convite do administrador", async () => {
    const r = await call("POST", "/empresas", { key: "k-alfa-criar-01", body: body() });
    expect(r.status).toBe(201);
    const e = r.body.empresa;
    idEmpresa = e.idEmpresa;
    expect(e).toMatchObject({ contaInterosId: "acc-alfa-001", razaoSocial: "Alfa Utilidades Domésticas Ltda", cnpj: "45723174000110", situacao: "ativa", modulos: ["estoque", "financeiro", "pdv", "vendas"] });
    expect(e.implantacao.estado).toBe("concluida");
    expect(e.implantacao.etapas.map((s: any) => [s.etapa, s.estado])).toEqual([["empresa", "concluida"], ["unidade_inicial", "concluida"], ["modulos", "concluida"], ["administrador", "concluida"]]);
    expect(e.unidades).toEqual([expect.objectContaining({ nome: "Alfa — Paulista", codigo: "01", situacao: "ativa" })]);
    expect(e.administradores[0]).toMatchObject({ nome: "Maria Alfa", email: "maria@alfa.example", situacao: "convidado" });
    expect(r.body.convite.link).toMatch(/^http:\/\/erp\.test\/convite\/[0-9a-f]{48}$/);
    expect(r.body.convite.linkRedigido).toBe(false);
    // auditoria na própria empresa, com o cliente de serviço como autor
    const logs = await listAll(store, "audit_logs", { filters: [["eq", "companyId", idEmpresa]] });
    expect(logs.some((l) => l.action === "company.create" && l.userId === "servico:interos-prov")).toBe(true);
    // trilha da solicitação
    const sr = await store.get("service_requests", detId("svcreq", "interos-prov", "k-alfa-criar-01"));
    expect(sr).toMatchObject({ status: "concluida", httpStatus: 201, operation: "empresas.criar", targetCompanyId: idEmpresa });
    expect(JSON.stringify(sr!.response)).not.toMatch(/\/convite\//); // o link (credencial) não fica gravado
  });

  it("reenvio com a mesma chave devolve a mesma resposta sem refazer nada (link redigido)", async () => {
    const r = await call("POST", "/empresas", { key: "k-alfa-criar-01", body: body() });
    expect(r.status).toBe(201);
    expect(r.headers.get("idempotent-replayed")).toBe("true");
    expect(r.body.empresa.idEmpresa).toBe(idEmpresa);
    expect(r.body.convite).toMatchObject({ link: null, linkRedigido: true });
  });

  it("mesma chave com outro conteúdo é recusada; outra chave com o mesmo conteúdo não duplica", async () => {
    const c = await call("POST", "/empresas", { key: "k-alfa-criar-01", body: body({ modulos: ["pdv"] }) });
    expect(c.status).toBe(422);
    expect(c.body.erro.codigo).toBe("idempotencia_conflito");
    const again = await call("POST", "/empresas", { key: "k-alfa-criar-02", body: body() });
    expect(again.status).toBe(200);
    expect(again.body.empresa.idEmpresa).toBe(idEmpresa);
    expect(again.body.convite).toBeNull(); // convite pendente é mantido (o link anterior continua valendo)
    expect((await listAll(store, "companies", { filters: [["eq", "interosAccountId", "acc-alfa-001"]] })).length).toBe(1);
    expect((await listAll(store, "branches", { filters: [["eq", "companyId", idEmpresa]] })).length).toBe(1);
    expect((await listAll(store, "users", { filters: [["eq", "email", "maria@alfa.example"]] })).length).toBe(1);
  });

  it("CNPJ de empresa que já usa o ERP não é criado de novo: orienta a vinculação, sem revelar a empresa", async () => {
    const r = await call("POST", "/empresas", { key: "k-cnpj-dup-01", body: body({ contaInterosId: "acc-outra", empresa: { ...body().empresa, cnpj: existing.cnpj } }) });
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe("cnpj_em_uso");
    expect(JSON.stringify(r.body)).not.toMatch(/Beta/);
  });

  it("módulos contratados restringem o perfil efetivo (menu, telas e ações juntos)", async () => {
    const maria = (await listAll(store, "users", { filters: [["eq", "email", "maria@alfa.example"]] }))[0];
    let u = await toCtxUser(scopeStore(store, idEmpresa), maria, idEmpresa);
    expect(u.permissions.fiscal).toBeUndefined();
    expect(u.permissions.purchases).toBeUndefined();
    expect(u.permissions.pdv?.create).toBe(true);
    const r = await call("PUT", `/empresas/${idEmpresa}/modulos`, { key: "k-alfa-mod-01", params: { idEmpresa }, body: { modulos: ["pdv", "vendas", "estoque", "financeiro", "fiscal"], contrato: { referencia: "CT-2026-0042-A1" } } });
    expect(r.status).toBe(200);
    expect(r.body.empresa.contrato.referencia).toBe("CT-2026-0042-A1");
    u = await toCtxUser(scopeStore(store, idEmpresa), maria, idEmpresa);
    expect(u.permissions.fiscal?.view).toBe(true);
  });

  it("suspender (bloqueio) e reativar: sessões encerradas, tarefas retidas e devolvidas, histórico preservado", async () => {
    const maria = (await listAll(store, "users", { filters: [["eq", "email", "maria@alfa.example"]] }))[0];
    await store.update("users", maria.id, { status: "active" });
    await store.create("sessions", { userId: maria.id, tokenHash: "h-maria", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    await store.create("jobs", { companyId: idEmpresa, type: "fiscal.transmit", status: "pending", runAt: new Date().toISOString(), attempts: 0, maxAttempts: 3, dedupeKey: "job-alfa-1" });
    const s = await call("POST", `/empresas/${idEmpresa}/suspender`, { key: "k-alfa-susp-01", params: { idEmpresa }, body: { modo: "bloqueio", motivo: "Inadimplência de 60 dias", referenciaContrato: "CT-2026-0042" } });
    expect(s.status).toBe(200);
    expect(s.body.empresa).toMatchObject({ situacao: "suspensa", suspensao: { modo: "bloqueio", motivo: "Inadimplência de 60 dias" } });
    expect((await listAll(store, "sessions", { filters: [["eq", "userId", maria.id]] })).length).toBe(0);
    expect((await listAll(store, "jobs", { filters: [["eq", "companyId", idEmpresa]] }))[0].status).toBe("held");
    const company = await store.get("companies", idEmpresa);
    expect(companySelectable(company)).toBe(false);
    const units = await accessibleUnits(store, maria);
    expect(units.companies.some((c) => c.id === idEmpresa && companySelectable(c))).toBe(false);
    const r = await call("POST", `/empresas/${idEmpresa}/reativar`, { key: "k-alfa-reat-01", params: { idEmpresa }, body: { motivo: "Pagamento regularizado" } });
    expect(r.body.empresa.situacao).toBe("ativa");
    expect((await listAll(store, "jobs", { filters: [["eq", "companyId", idEmpresa]] }))[0].status).toBe("pending");
    const after = await store.get("companies", idEmpresa);
    expect(after!.suspensionHistory.map((h: any) => h.event)).toEqual(["suspensao", "reativacao"]);
  });

  it("somente leitura: a empresa continua selecionável", async () => {
    await call("POST", `/empresas/${idEmpresa}/suspender`, { key: "k-alfa-susp-ro", params: { idEmpresa }, body: { modo: "somente_leitura", motivo: "Contrato em renegociação" } });
    expect(companySelectable(await store.get("companies", idEmpresa))).toBe(true);
    await call("POST", `/empresas/${idEmpresa}/reativar`, { key: "k-alfa-reat-ro", params: { idEmpresa }, body: {} });
  });
});

describe("falha parcial — caminho verificável de recuperação", () => {
  it("queda do e-mail no meio: etapa registrada como falha; reenvio retoma; convite reenviado gera link novo", async () => {
    mail.fail = 1;
    const b = body({ contaInterosId: "acc-gama-001", empresa: { ...body().empresa, razaoSocial: "Gama Papelaria Ltda", nomeFantasia: "Gama", cnpj: "60.701.190/0001-04" }, administrador: { nome: "Gabriel Gama", email: "gabriel@gama.example" }, entregaConvite: "erp" });
    const r1 = await call("POST", "/empresas", { key: "k-gama-criar-01", body: b });
    expect(r1.status).toBe(500);
    expect(r1.body.erro.codigo).toBe("erro_interno");
    const company = (await listAll(store, "companies", { filters: [["eq", "interosAccountId", "acc-gama-001"]] }))[0];
    const st = await call("GET", `/empresas/${company.id}`, { params: { idEmpresa: company.id } });
    expect(st.body.empresa.implantacao.estado).toBe("falhou");
    expect(st.body.empresa.implantacao.etapas.find((e: any) => e.etapa === "administrador")).toMatchObject({ estado: "falhou" });
    expect(st.body.empresa.implantacao.ultimoErro).toMatch(/administrador/);
    // a mesma chave retoma (o erro do servidor não fica como resposta definitiva)
    const r2 = await call("POST", "/empresas", { key: "k-gama-criar-01", body: b });
    expect(r2.status).toBe(200);
    expect(r2.body.empresa.implantacao.estado).toBe("concluida");
    expect((await listAll(store, "companies", { filters: [["eq", "interosAccountId", "acc-gama-001"]] })).length).toBe(1);
    // o convite foi criado antes da queda e o link se perdeu: reenviar gera outro e invalida o anterior
    const admin = r2.body.empresa.administradores[0];
    expect(admin.situacao).toBe("convidado");
    const rs = await call("POST", `/empresas/${company.id}/convites/reenviar`, { key: "k-gama-reenv-01", params: { idEmpresa: company.id }, body: { idUsuario: admin.idUsuario, entregaConvite: "interos" } });
    expect(rs.status).toBe(200);
    const token = rs.body.convite.link.split("/convite/")[1];
    const accepted = await acceptInvite(store, token, "SenhaForte#2026");
    expect(accepted.status).toBe("active");
    const after = await call("GET", `/empresas/${company.id}`, { params: { idEmpresa: company.id } });
    expect(after.body.empresa.administradores[0].situacao).toBe("ativo");
    expect((await call("POST", `/empresas/${company.id}/convites/reenviar`, { key: "k-gama-reenv-02", params: { idEmpresa: company.id }, body: { idUsuario: admin.idUsuario } })).body.erro.codigo).toBe("convite_ja_aceito");
  });
});

describe("vínculo de empresa existente — identidade confirmada e sem vínculos conflitantes", () => {
  it("exige ID ERP, CNPJ e o código gerado pelo administrador da empresa; o código é de uso único", async () => {
    const bruno = (await store.get("users", "bruno-beta"))!;
    const ctx = { store: scopeStore(store, existing.id), companyId: existing.id, branchId: null, user: await toCtxUser(scopeStore(store, existing.id), bruno, existing.id) };
    const { code } = await createInterosLinkCode(ctx);
    const base = { contaInterosId: "acc-beta-777", idEmpresa: existing.id, cnpj: existing.cnpj };
    // empresa invisível ao Interos antes do vínculo
    expect((await call("GET", `/empresas/${existing.id}`, { params: { idEmpresa: existing.id } })).status).toBe(404);
    const wrongCode = await call("POST", "/empresas/vincular", { key: "k-beta-vinc-01", body: { ...base, codigoVinculo: "AAAAA-BBBBB" } });
    expect(wrongCode.body.erro.codigo).toBe("identidade_nao_confere");
    const wrongCnpj = await call("POST", "/empresas/vincular", { key: "k-beta-vinc-02", body: { ...base, cnpj: "45723174000110", codigoVinculo: code } });
    expect(wrongCnpj.body.erro.codigo).toBe("identidade_nao_confere");
    const ok = await call("POST", "/empresas/vincular", { key: "k-beta-vinc-03", body: { ...base, codigoVinculo: code } });
    expect(ok.status).toBe(201);
    expect(ok.body.empresa).toMatchObject({ idEmpresa: existing.id, contaInterosId: "acc-beta-777", modulos: null });
    // código usado não serve de novo; outra conta não vincula a mesma empresa; a mesma conta não vincula outra
    const reuse = await call("POST", "/empresas/vincular", { key: "k-beta-vinc-04", body: { ...base, contaInterosId: "acc-beta-888", codigoVinculo: code } });
    expect(reuse.body.erro.codigo).toBe("empresa_ja_vinculada");
    const again = await call("POST", "/empresas/vincular", { key: "k-beta-vinc-05", body: { ...base, codigoVinculo: code } });
    expect(again.status).toBe(200); // repetição do mesmo vínculo: já está feito
    // a empresa agora aparece na sincronização
    const list = await call("GET", "/empresas?limite=10");
    expect(list.body.itens.map((e: any) => e.idEmpresa)).toEqual(expect.arrayContaining([existing.id]));
  });
});
