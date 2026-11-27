import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/bootstrap", () => ({ ensureBootstrap: async () => undefined }));

import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { freshStore } from "./helpers";
import type { Store } from "@/lib/db/types";
import { setServiceCredentials } from "@/lib/service/credentials";
import { resetServiceRateLimits } from "@/lib/service/http";
import { signBody } from "@/lib/service/signature";
import { createCompanyWithDefaults } from "@/domain/setup";

/**
 * Pendência 2 da integração (docs/interos/credenciais.md): UM registro (`INTEROS_CREDENCIAIS`), UM formato de token
 * (`Bearer <id>.<segredo>`) nas três APIs, famílias de escopo separadas, restrição às empresas do piloto, assinatura
 * HMAC das gravações e rotação sem parada (credencial e segredo novos valendo junto com os antigos).
 */
const S = (c: string) => c.repeat(43);
const PROV = `interos-prov.${S("p")}`;
const PROV_PILOTO = `interos-prov-piloto.${S("q")}`;
const PROV_ASSINADA = `interos-prov-assinada.${S("r")}`;
const TORRE = `interos-torre.${S("t")}`;
const LIC = `interos-licencas.${S("l")}`;
const LIC_NOVA = `interos-licencas-2.${S("n")}`;
const SIGN_OLD = "a".repeat(40);
const SIGN_NEW = "b".repeat(40);

let store: Store;
let alfa: string;
let beta: string;

function creds(extra: Array<Record<string, any>> = []) {
  setServiceCredentials([
    { id: "interos-prov", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: S("p") },
    { id: "interos-prov-piloto", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: S("q"), empresas: [beta] },
    { id: "interos-prov-assinada", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: S("r"), assinatura: "TESTE_ASSINATURA_NOVA" },
    { id: "interos-torre", escopos: ["torre:resumo", "torre:detalhe"], segredo: S("t") },
    // rotação: a credencial antiga e a nova valem juntas; o segredo de assinatura também (lista com os dois nomes)
    { id: "interos-licencas", escopos: ["erp.license.read", "erp.license.write", "erp.usage.read"], segredo: S("l"), empresas: [beta], assinatura: ["TESTE_ASSINATURA_NOVA", "TESTE_ASSINATURA_ANTIGA"] },
    { id: "interos-licencas-2", escopos: ["erp.license.read", "erp.license.write", "erp.usage.read"], segredo: S("n"), empresas: [beta], assinatura: "TESTE_ASSINATURA_NOVA" },
    ...(extra as any[]),
  ]);
}

async function prov(method: "GET" | "POST", path: string, routeFile: string, token: string, opts: { body?: unknown; key?: string; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const mod = await import(`@/app/api/interos/v1/${routeFile}/route`);
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${token}`, ...(opts.headers ?? {}) };
  if (opts.key) headers["idempotency-key"] = opts.key;
  const res: Response = await mod[method](new NextRequest(`http://erp.test/api/interos/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  store = freshStore();
  alfa = (await createCompanyWithDefaults(store, { name: "Alfa Credenciais Ltda", cnpj: "45723174000110", key: "cred-alfa" })).company.id;
  beta = (await createCompanyWithDefaults(store, { name: "Beta Credenciais Ltda", cnpj: "11222333000181", key: "cred-beta" })).company.id;
  // as duas empresas vinculadas ao Interos (aparecem na lista do provisionamento)
  await store.update("companies", alfa, { interosAccountId: "acc-cred-alfa" });
  await store.update("companies", beta, { interosAccountId: "acc-cred-beta" });
});

beforeEach(() => {
  resetServiceRateLimits();
  process.env.TESTE_ASSINATURA_ANTIGA = SIGN_OLD;
  process.env.TESTE_ASSINATURA_NOVA = SIGN_NEW;
  creds();
});

afterEach(() => {
  delete process.env.TESTE_ASSINATURA_ANTIGA;
  delete process.env.TESTE_ASSINATURA_NOVA;
});

describe("um esquema de credencial nas três APIs", () => {
  it("o mesmo formato de token autentica provisionamento, Torre e licenças; cada família só na sua API", async () => {
    const st = await prov("GET", "/status", "status", LIC);
    expect(st.status).toBe(200);
    expect(st.body.cliente).toMatchObject({ id: "interos-licencas", familia: "licencas", empresas: [beta], assinaturaExigida: true });
    expect((await prov("GET", "/status", "status", TORRE)).body.cliente.familia).toBe("torre");

    // licenças não provisiona nem consulta a Torre
    expect((await prov("GET", "/empresas", "empresas", LIC)).status).toBe(403);
    expect((await prov("GET", `/empresas/${beta}/torre/resumo`, "empresas/[idEmpresa]/torre/resumo", LIC, { params: { idEmpresa: beta } })).status).toBe(403);
    // provisionamento e Torre não leem licenças
    const lic = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    for (const t of [PROV, TORRE]) {
      const r = await lic.GET(new Request("http://erp.test/x", { headers: { authorization: `Bearer ${t}` } }), { params: Promise.resolve({ companyId: beta }) });
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe("insufficient_scope");
    }
    // e a credencial de licenças lê a licença da empresa do piloto
    const ok = await lic.GET(new Request("http://erp.test/x", { headers: { authorization: `Bearer ${LIC}` } }), { params: Promise.resolve({ companyId: beta }) });
    expect(ok.status).toBe(200);
  });

  it("credencial com escopos de duas famílias é recusada inteira", async () => {
    creds([{ id: "interos-mista", escopos: ["provisionamento:leitura", "erp.license.read"], segredo: S("m") }]);
    expect((await prov("GET", "/status", "status", `interos-mista.${S("m")}`)).status).toBe(401);
    expect((await prov("GET", "/status", "status", PROV)).status).toBe(200);
  });
});

describe("empresas do piloto (`empresas`)", () => {
  it("provisionamento restrito: só a empresa dele — não cria, não vincula, não lê nem altera outra", async () => {
    const other = await prov("GET", `/empresas/${alfa}`, "empresas/[idEmpresa]", PROV_PILOTO, { params: { idEmpresa: alfa } });
    expect(other.status).toBe(403);
    expect(other.body.erro.codigo).toBe("empresa_nao_permitida");
    const susp = await prov("POST", `/empresas/${alfa}/suspender`, "empresas/[idEmpresa]/suspender", PROV_PILOTO, { params: { idEmpresa: alfa }, key: "k-piloto-susp-01", body: { modo: "bloqueio", motivo: "teste" } });
    expect(susp.status).toBe(403);
    const criar = await prov("POST", "/empresas", "empresas", PROV_PILOTO, { key: "k-piloto-criar-01", body: { contaInterosId: "acc-x" } });
    expect(criar.status).toBe(403);
    expect(criar.body.erro.codigo).toBe("empresa_nao_permitida");
    const vincular = await prov("POST", "/empresas/vincular", "empresas/vincular", PROV_PILOTO, { key: "k-piloto-vinc-01", body: {} });
    expect(vincular.status).toBe(403);
    // a própria empresa responde; a lista só mostra ela
    expect((await prov("GET", `/empresas/${beta}`, "empresas/[idEmpresa]", PROV_PILOTO, { params: { idEmpresa: beta } })).status).toBe(200);
    const list = await prov("GET", "/empresas", "empresas", PROV_PILOTO);
    expect(list.body.itens.map((e: any) => e.idEmpresa)).toEqual([beta]);
    // a credencial sem restrição vê as duas
    const all = await prov("GET", "/empresas", "empresas", PROV);
    expect(all.body.itens.map((e: any) => e.idEmpresa).sort()).toEqual([alfa, beta].sort());
  });

  it("licenças restrita: outra empresa responde 403 company_not_allowed; a lista só mostra as do piloto", async () => {
    const lic = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    const r = await lic.GET(new Request("http://erp.test/x", { headers: { authorization: `Bearer ${LIC}` } }), { params: Promise.resolve({ companyId: alfa }) });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("company_not_allowed");
    const list = await (await import("@/app/api/interos/v2/companies/route")).GET(new Request("http://erp.test/x", { headers: { authorization: `Bearer ${LIC}` } }));
    expect((await list.json()).data.map((c: any) => c.companyId)).toEqual([beta]);
  });
});

describe("assinatura das gravações e rotação sem parada", () => {
  const put = async (token: string, body: string, headers: Record<string, string>) => {
    const lic = await import("@/app/api/interos/v2/companies/[companyId]/license/route");
    return lic.PUT(new Request("http://erp.test/x", { method: "PUT", body, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers } }), { params: Promise.resolve({ companyId: beta }) });
  };
  const evt = () => `evt-${crypto.randomBytes(6).toString("hex")}`;

  it("licenças: assinatura com o segredo novo OU o antigo vale durante a troca; outro segredo é recusado", async () => {
    const body = JSON.stringify({ licenseVersion: "x" });
    for (const secret of [SIGN_NEW, SIGN_OLD]) {
      const r = await put(LIC, body, { "x-interos-signature": signBody(secret, body), "x-interos-event-id": evt() });
      // passa da assinatura (o corpo é que é inválido)
      expect(r.status).not.toBe(401);
    }
    const bad = await put(LIC, body, { "x-interos-signature": signBody("c".repeat(40), body), "x-interos-event-id": evt() });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.code).toBe("signature_invalid");
    const none = await put(LIC, body, { "x-interos-event-id": evt() });
    expect((await none.json()).error.code).toBe("signature_required");
  });

  it("credencial antiga e nova valem ao mesmo tempo; retirar a antiga não afeta a nova", async () => {
    const body = JSON.stringify({ licenseVersion: "x" });
    for (const t of [LIC, LIC_NOVA]) expect((await put(t, body, { "x-interos-signature": signBody(SIGN_NEW, body), "x-interos-event-id": evt() })).status).not.toBe(401);
    setServiceCredentials([{ id: "interos-licencas-2", escopos: ["erp.license.read", "erp.license.write"], segredo: S("n"), empresas: [beta], assinatura: "TESTE_ASSINATURA_NOVA" }]);
    expect((await put(LIC, body, { "x-interos-signature": signBody(SIGN_NEW, body), "x-interos-event-id": evt() })).status).toBe(401);
    expect((await put(LIC_NOVA, body, { "x-interos-signature": signBody(SIGN_NEW, body), "x-interos-event-id": evt() })).status).not.toBe(401);
  });

  it("licenças sem segredo de assinatura configurado: gravação recusada com 503 (nunca aceita sem assinatura)", async () => {
    delete process.env.TESTE_ASSINATURA_NOVA;
    delete process.env.TESTE_ASSINATURA_ANTIGA;
    const body = JSON.stringify({});
    const r = await put(LIC_NOVA, body, { "x-interos-signature": signBody(SIGN_NEW, body), "x-interos-event-id": evt() });
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("signing_not_configured");
  });

  it("provisionamento com `assinatura`: gravação sem assinatura ou com assinatura errada é recusada; assinada passa", async () => {
    const payload = { modo: "somente_leitura", motivo: "teste de assinatura" };
    const raw = JSON.stringify(payload);
    const sem = await prov("POST", `/empresas/${beta}/suspender`, "empresas/[idEmpresa]/suspender", PROV_ASSINADA, { params: { idEmpresa: beta }, key: "k-assin-0001", body: payload });
    expect(sem.status).toBe(401);
    expect(sem.body.erro.codigo).toBe("assinatura_obrigatoria");
    const errada = await prov("POST", `/empresas/${beta}/suspender`, "empresas/[idEmpresa]/suspender", PROV_ASSINADA, { params: { idEmpresa: beta }, key: "k-assin-0002", body: payload, headers: { "x-interos-signature": signBody("c".repeat(40), raw) } });
    expect(errada.status).toBe(401);
    expect(errada.body.erro.codigo).toBe("assinatura_invalida");
    const certa = await prov("POST", `/empresas/${beta}/suspender`, "empresas/[idEmpresa]/suspender", PROV_ASSINADA, { params: { idEmpresa: beta }, key: "k-assin-0003", body: payload, headers: { "x-interos-signature": signBody(SIGN_NEW, raw) } });
    expect(certa.status).not.toBe(401);
    // leitura não exige assinatura
    expect((await prov("GET", `/empresas/${beta}`, "empresas/[idEmpresa]", PROV_ASSINADA, { params: { idEmpresa: beta } })).status).toBe(200);
  });
});
