import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Exemplos do contrato Interos ↔ ERP (docs/interos/contrato-interos-erp-v1.md §13), tirados de respostas REAIS.
 *
 * Este teste executa, com dados fictícios, a sequência de chamadas que o Interos faz e compara cada requisição e
 * resposta com o exemplo publicado em docs/interos/exemplos/. Se a interface mudar e a documentação não, o teste falha.
 * Para regenerar os exemplos depois de uma mudança intencional (e revisar o diff):
 *   GERAR_EXEMPLOS=1 npx vitest run tests/interos-contrato.test.ts
 * Determinismo: relógio fixo (avança 1 min por chamada), identificadores determinísticos do provisionamento,
 * X-Request-Id e Idempotency-Key fixos; o token do convite e o código de vínculo (aleatórios) saem mascarados.
 */

const mail = vi.hoisted(() => ({ fail: 0 }));
vi.mock("@/lib/core/email", () => ({
  sendEmail: async () => {
    if (mail.fail > 0) {
      mail.fail--;
      throw new Error("provedor de e-mail fora do ar");
    }
    return { delivered: true, channel: "smtp" };
  },
}));

import { NextRequest } from "next/server";
import { freshStore } from "./helpers";
import { findOne, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { setServiceCredentials } from "@/lib/service/credentials";
import { resetServiceRateLimits } from "@/lib/service/http";
import { createCompanyWithDefaults } from "@/domain/setup";
import { createInterosLinkCode } from "@/domain/tenancy/link-code";
import { toCtxUser } from "@/lib/auth/users";
import { scopeStore } from "@/lib/db/scoped-store";

const GERAR = process.env.GERAR_EXEMPLOS === "1";
const DIR = path.join(process.cwd(), "docs/interos/exemplos");
const ORIGIN = "https://erp-homologacao.intercert.example";
const PREFIX = "/api/interos/v1";

const PROV_ID = "interos-prov-homolog";
const TORRE_ID = "interos-torre-homolog";
const PROV_SECRET = "p".repeat(43);
const TORRE_SECRET = "t".repeat(43);
// credenciais restrita (piloto) e com assinatura obrigatória: exemplos dos erros do esquema único (docs/interos/credenciais.md)
const PILOTO_ID = "interos-prov-piloto";
const PILOTO_SECRET = "Pq".repeat(21) + "x";
const ASSIN_ID = "interos-prov-assinada";
const ASSIN_SECRET = "As".repeat(21) + "y";
const AUTH = { prov: `Bearer ${PROV_ID}.${PROV_SECRET}`, torre: `Bearer ${TORRE_ID}.${TORRE_SECRET}`, piloto: `Bearer ${PILOTO_ID}.${PILOTO_SECRET}`, assinada: `Bearer ${ASSIN_ID}.${ASSIN_SECRET}` } as const;
const AUTH_SHOWN = { prov: `Bearer ${PROV_ID}.<segredo>`, torre: `Bearer ${TORRE_ID}.<segredo>`, piloto: `Bearer ${PILOTO_ID}.<segredo>`, assinada: `Bearer ${ASSIN_ID}.<segredo>` } as const;

const LINK_CODE_SHOWN = "K7Q2M-XR4TP";
const TOKEN_SHOWN = "TOKEN_DE_USO_UNICO";

let store: Store;
let clock = Date.parse("2026-11-20T12:00:00.000Z");
const secretsToMask = new Map<string, string>();
const written: string[] = [];

function tick(minutes = 1) {
  clock += minutes * 60_000;
  vi.setSystemTime(new Date(clock));
}

/** Caminho → arquivo de rota (o teste chama o handler como o Next chamaria). */
function routeFor(p: string): string {
  const clean = p.split("?")[0];
  if (clean === "/status") return "status";
  if (clean === "/empresas") return "empresas";
  if (clean === "/empresas/vincular") return "empresas/vincular";
  const m = /^\/empresas\/[^/]+(\/.*)?$/.exec(clean)!;
  return `empresas/[idEmpresa]${m[1] ?? ""}`;
}

function idOf(p: string): Record<string, string> {
  const m = /^\/empresas\/([^/?]+)/.exec(p);
  return m && m[1] !== "vincular" ? { idEmpresa: m[1] } : {};
}

function mask(v: unknown): unknown {
  let s = JSON.stringify(v);
  if (s === undefined) return v;
  s = s.replace(/\/convite\/[0-9a-f]{32,}/g, `/convite/${TOKEN_SHOWN}`);
  for (const [secret, shown] of secretsToMask) s = s.split(secret).join(shown);
  return JSON.parse(s);
}

const KEEP_HEADERS: Record<string, string> = {
  "content-type": "Content-Type",
  "x-request-id": "X-Request-Id",
  "api-version": "API-Version",
  "cache-control": "Cache-Control",
  "idempotent-replayed": "Idempotent-Replayed",
  "retry-after": "Retry-After",
  "www-authenticate": "WWW-Authenticate",
};

interface Req {
  method: "GET" | "POST" | "PUT";
  path: string;
  auth?: keyof typeof AUTH | null;
  requestId: string;
  key?: string;
  body?: unknown;
}

async function send(r: Req) {
  const mod = await import(`@/app/api/interos/v1/${routeFor(r.path)}/route`);
  const headers: Record<string, string> = { "content-type": "application/json", "x-request-id": r.requestId };
  if (r.auth !== null) headers.authorization = AUTH[r.auth ?? "prov"];
  if (r.key) headers["idempotency-key"] = r.key;
  const res: Response = await mod[r.method](
    new NextRequest(`${ORIGIN}${PREFIX}${r.path}`, { method: r.method, headers, body: r.body === undefined ? undefined : JSON.stringify(r.body) }),
    { params: Promise.resolve(idOf(r.path)) },
  );
  const body = await res.json();
  const kept: Record<string, string> = {};
  for (const [h, shown] of Object.entries(KEEP_HEADERS)) {
    const v = res.headers.get(h);
    if (v != null) kept[shown] = v;
  }
  return { status: res.status, headers: kept, body };
}

/** Executa a chamada, monta o exemplo e grava (GERAR_EXEMPLOS=1) ou confere com o publicado. */
async function exemplo(arquivo: string, titulo: string, r: Req, expected: number, nota?: string, opts: { advanceMs?: number } = {}) {
  if (opts.advanceMs != null) {
    clock += opts.advanceMs;
    vi.setSystemTime(new Date(clock));
  } else tick();
  const res = await send(r);
  expect(res.status, `${arquivo}: ${JSON.stringify(res.body)}`).toBe(expected);
  const shownHeaders: Record<string, string> = {};
  if (r.auth !== null) shownHeaders.Authorization = AUTH_SHOWN[r.auth ?? "prov"];
  shownHeaders["X-Request-Id"] = r.requestId;
  if (r.key) shownHeaders["Idempotency-Key"] = r.key;
  if (r.body !== undefined) shownHeaders["Content-Type"] = "application/json";
  const doc = mask({
    titulo,
    ...(nota ? { nota } : {}),
    requisicao: { metodo: r.method, url: `${ORIGIN}${PREFIX}${r.path}`, cabecalhos: shownHeaders, ...(r.body !== undefined ? { corpo: r.body } : {}) },
    resposta: { status: res.status, cabecalhos: res.headers, corpo: res.body },
  });
  const file = path.join(DIR, `${arquivo}.json`);
  written.push(`${arquivo}.json`);
  if (GERAR) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  } else {
    expect(fs.existsSync(file), `exemplo ${arquivo}.json ausente — rode com GERAR_EXEMPLOS=1`).toBe(true);
    const published = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(doc, `docs/interos/exemplos/${arquivo}.json divergiu da resposta real — revise e regenere com GERAR_EXEMPLOS=1`).toEqual(published);
  }
  return res;
}

const alfa = {
  contaInterosId: "conta-alfa-0001",
  empresa: {
    tipo: "varejo",
    razaoSocial: "Alfa Utilidades Domésticas Ltda",
    nomeFantasia: "Alfa Utilidades",
    cnpj: "24.681.357/0001-40",
    inscricaoEstadual: "123.456.789.110",
    regimeTributario: "simples",
    cnae: "4759-8/99",
    email: "financeiro@alfa-utilidades.example",
    telefone: "(11) 3333-0001",
    endereco: { cep: "01310-100", logradouro: "Avenida Paulista", numero: "1000", complemento: "Loja 3", bairro: "Bela Vista", municipio: "São Paulo", codigoMunicipioIbge: "3550308", uf: "SP" },
  },
  unidadeInicial: { nome: "Alfa — Paulista", codigo: "01", telefone: "(11) 3333-0001", fusoHorario: "America/Sao_Paulo" },
  modulos: ["pdv", "vendas", "estoque", "compras", "financeiro", "fiscal", "relatorios"],
  administrador: { nome: "Marina Alves", email: "marina.alves@alfa-utilidades.example", telefone: "(11) 98888-0001" },
  entregaConvite: "interos",
  contrato: { referencia: "CT-2026-0042", plano: "profissional" },
};

const gama = {
  contaInterosId: "conta-gama-0003",
  empresa: { tipo: "varejo", razaoSocial: "Gama Papelaria e Presentes Ltda", nomeFantasia: "Gama Papelaria", cnpj: "31.415.926/0001-71", regimeTributario: "simples", endereco: { cep: "30130-010", logradouro: "Avenida Afonso Pena", numero: "500", bairro: "Centro", municipio: "Belo Horizonte", codigoMunicipioIbge: "3106200", uf: "MG" } },
  modulos: ["pdv", "vendas", "estoque", "financeiro"],
  administrador: { nome: "Gustavo Gomes", email: "gustavo@gama-papelaria.example" },
  entregaConvite: "erp",
  contrato: { referencia: "CT-2026-0057", plano: "essencial" },
};

let idAlfa = "";
let idBeta = "";
let idGama = "";
let adminAlfa = "";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(clock));
  delete process.env.APP_URL;
  store = freshStore();
  setServiceCredentials([
    { id: PROV_ID, nome: "Interos — provisionamento (homologação)", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: PROV_SECRET },
    { id: TORRE_ID, nome: "Interos — Torre de Controle (homologação)", escopos: ["torre:resumo", "torre:detalhe", "torre:transacoes"], segredo: TORRE_SECRET },
    { id: PILOTO_ID, nome: "Interos — provisionamento restrito ao piloto", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: PILOTO_SECRET, empresas: ["empresa-do-piloto-0001"] },
    { id: ASSIN_ID, nome: "Interos — provisionamento com gravações assinadas", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: ASSIN_SECRET, assinatura: "EXEMPLO_ASSINATURA_INTEROS" },
  ]);
  process.env.EXEMPLO_ASSINATURA_INTEROS = "e".repeat(40);
  resetServiceRateLimits();
  // empresa que já usa o ERP antes do Interos (vinculação por código) — também evita a demonstração automática da memória
  const { company } = await createCompanyWithDefaults(store, { name: "Beta Moda e Acessórios Ltda", tradeName: "Beta Moda", cnpj: "13579246000101", key: "exemplo-beta-existente" });
  idBeta = company.id;
  const adminRole = (await listAll(store, "roles", { filters: [["eq", "companyId", company.id], ["eq", "key", "admin"]] }))[0];
  await store.create("users", { name: "Bruno Barros", email: "bruno@beta-moda.example", status: "active", companyIds: [company.id], roleId: adminRole.id, roleByCompany: { [company.id]: adminRole.id }, branchIds: [] }, "exemplo-bruno-beta");
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
  setServiceCredentials(null);
  delete process.env.EXEMPLO_ASSINATURA_INTEROS;
});

describe.skipIf(process.env.TEST_STORE === "postgres")("contrato Interos ↔ ERP v1 — exemplos reais", () => {
  it("provisionamento: o ciclo de vida completo de uma empresa contratante", async () => {
    await exemplo("01-status", "Conferir a credencial e a saúde da interface", { method: "GET", path: "/status", requestId: "req-exemplo-0001" }, 200);

    const criar = await exemplo(
      "02-empresas-criar",
      "Criar empresa contratante (empresa, unidade inicial, módulos e administrador)",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-0002", key: "alfa-criar-20261120-001", body: alfa },
      201,
      "O link do convite é uma credencial de uso único: só aparece nesta primeira resposta (no exemplo, o token está mascarado).",
    );
    idAlfa = criar.body.empresa.idEmpresa;
    adminAlfa = criar.body.convite.idUsuario;

    await exemplo(
      "03-empresas-criar-reenvio-mesma-chave",
      "Reenvio da mesma solicitação (mesma Idempotency-Key): a resposta original, sem refazer nada",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-0003", key: "alfa-criar-20261120-001", body: alfa },
      201,
      "Cabeçalho Idempotent-Replayed: true. O link do convite não é repetido (linkRedigido: true) — para outro link, use convites/reenviar.",
    );

    await exemplo(
      "04-empresas-criar-reenvio-outra-chave",
      "Mesma empresa enviada de novo com outra Idempotency-Key: nada é duplicado (200, estado atual)",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-0004", key: "alfa-criar-20261120-002", body: alfa },
      200,
      "A conta do Interos identifica a empresa: o ERP confere cada etapa e não cria empresa, unidade nem convite de novo.",
    );

    await exemplo("05-empresas-consultar", "Consultar a empresa e a implantação", { method: "GET", path: `/empresas/${idAlfa}`, requestId: "req-exemplo-0005" }, 200);

    await exemplo(
      "06-unidade-inicial-ajustar",
      "Ajustar a unidade inicial",
      { method: "PUT", path: `/empresas/${idAlfa}/unidade-inicial`, requestId: "req-exemplo-0006", key: "alfa-unidade-20261120-001", body: { nome: "Alfa — Paulista (Matriz)", cnpj: "24.681.357/0001-40", email: "paulista@alfa-utilidades.example" } },
      200,
    );

    await exemplo(
      "07-modulos-definir",
      "Definir os módulos contratados (substitui a lista inteira)",
      { method: "PUT", path: `/empresas/${idAlfa}/modulos`, requestId: "req-exemplo-0007", key: "alfa-modulos-20261121-001", body: { modulos: ["pdv", "vendas", "estoque", "compras", "financeiro", "fiscal", "relatorios", "comercio_digital"], contrato: { referencia: "CT-2026-0042-A1", plano: "profissional" } } },
      200,
      "Contratar comercio_digital liga a loja virtual; retirar um módulo tira as operações dele de todos os perfis da empresa (menu, telas e APIs).",
    );

    await exemplo(
      "08-administradores-convidar",
      "Convidar mais um administrador da empresa",
      { method: "POST", path: `/empresas/${idAlfa}/administradores`, requestId: "req-exemplo-0008", key: "alfa-admin-20261121-001", body: { administrador: { nome: "Otávio Lima", email: "otavio.lima@alfa-utilidades.example" }, entregaConvite: "interos" } },
      201,
    );

    await exemplo(
      "09-convites-reenviar",
      "Reenviar o convite de um administrador que ainda não ativou o acesso (o link anterior deixa de valer)",
      { method: "POST", path: `/empresas/${idAlfa}/convites/reenviar`, requestId: "req-exemplo-0009", key: "alfa-reenvio-20261122-001", body: { idUsuario: adminAlfa, entregaConvite: "interos" } },
      200,
    );

    await exemplo(
      "10-suspender",
      "Suspender conforme a regra de contrato (somente leitura)",
      { method: "POST", path: `/empresas/${idAlfa}/suspender`, requestId: "req-exemplo-0010", key: "alfa-suspender-20261123-001", body: { modo: "somente_leitura", motivo: "Mensalidade de novembro em atraso", referenciaContrato: "CT-2026-0042" } },
      200,
      'modo "somente_leitura": a equipe entra, consulta e exporta, sem gravar; "bloqueio": ninguém entra e as sessões são encerradas. Nos dois, tarefas e rotinas ficam retidas e a loja virtual sai do ar.',
    );

    await exemplo(
      "11-reativar",
      "Reativar a operação (o histórico da suspensão fica registrado)",
      { method: "POST", path: `/empresas/${idAlfa}/reativar`, requestId: "req-exemplo-0011", key: "alfa-reativar-20261123-001", body: { motivo: "Pagamento confirmado", referenciaContrato: "CT-2026-0042" } },
      200,
    );

    // vínculo de empresa existente: o administrador da Beta gera o código no ERP e o informa ao Interos
    const bruno = (await store.get("users", "exemplo-bruno-beta"))!;
    const ctx = { store: scopeStore(store, idBeta), companyId: idBeta, branchId: null, user: await toCtxUser(scopeStore(store, idBeta), bruno, idBeta) };
    const { code } = await createInterosLinkCode(ctx);
    secretsToMask.set(code, LINK_CODE_SHOWN);
    await exemplo(
      "12-empresas-vincular",
      "Vincular uma empresa que já usa o ERP (ID ERP + CNPJ + código de vínculo gerado pelo administrador dela)",
      { method: "POST", path: "/empresas/vincular", requestId: "req-exemplo-0012", key: "beta-vincular-20261124-001", body: { contaInterosId: "conta-beta-0002", idEmpresa: idBeta, cnpj: "13.579.246/0001-01", codigoVinculo: code, modulos: ["pdv", "vendas", "estoque", "financeiro"], contrato: { referencia: "CT-2026-0049", plano: "essencial" } } },
      201,
      "O código vale 72 horas e só uma vez. Empresa inexistente, CNPJ diferente ou código errado têm a mesma resposta (identidade_nao_confere).",
    );

    // implantação que cai no meio (provedor de e-mail fora do ar ao entregar o convite) e a recuperação
    mail.fail = 1;
    await exemplo(
      "13-empresas-criar-falha-no-meio",
      "Implantação que falha no meio (erro do servidor): a chave fica liberada para retomar",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-0013", key: "gama-criar-20261124-001", body: gama },
      500,
    );
    idGama = (await findOne(store, "companies", [["eq", "interosAccountId", "conta-gama-0003"]]))!.id;
    await exemplo(
      "14-empresas-consultar-implantacao-falhou",
      "Consultar a implantação que falhou: etapas, tentativas e último erro",
      { method: "GET", path: `/empresas/${idGama}`, requestId: "req-exemplo-0014" },
      200,
    );
    await exemplo(
      "15-implantacao-retomar",
      "Retomar a implantação com a entrada guardada (sem reenviar o corpo)",
      { method: "POST", path: `/empresas/${idGama}/implantacao/retomar`, requestId: "req-exemplo-0015", key: "gama-retomar-20261124-001", body: {} },
      200,
      "Só o que faltou é feito: a empresa e a unidade já existiam; o convite, que não chegou a sair, é gerado e entregue agora (por e-mail, entregaConvite: erp).",
    );

    await exemplo("16-empresas-listar", "Listar as empresas vinculadas (paginação por cursor)", { method: "GET", path: "/empresas?limite=2", requestId: "req-exemplo-0016" }, 200);
  });

  it("erros: um exemplo de cada resposta de erro do contrato", async () => {
    await exemplo("erro-401-nao-autenticado", "Credencial ausente ou inválida", { method: "GET", path: "/status", requestId: "req-exemplo-e401", auth: null }, 401);
    await exemplo("erro-403-sem-permissao", "Credencial sem o escopo exigido (a da Torre tentando criar empresa)", { method: "POST", path: "/empresas", requestId: "req-exemplo-e403", auth: "torre", key: "torre-tenta-criar-0001", body: alfa }, 403);
    await exemplo("erro-403-empresa-nao-permitida", "Credencial restrita às empresas do piloto consultando outra empresa", { method: "GET", path: `/empresas/${idAlfa}`, requestId: "req-exemplo-e403b", auth: "piloto" }, 403);
    await exemplo(
      "erro-401-assinatura-obrigatoria",
      "Credencial com assinatura exigida gravando sem X-Interos-Signature",
      { method: "POST", path: `/empresas/${idAlfa}/reativar`, requestId: "req-exemplo-e401b", auth: "assinada", key: "alfa-reativar-sem-assinatura-01", body: {} },
      401,
    );
    await exemplo("erro-400-idempotencia-obrigatoria", "Alteração sem Idempotency-Key", { method: "POST", path: `/empresas/${idAlfa}/reativar`, requestId: "req-exemplo-e400", body: {} }, 400);
    await exemplo(
      "erro-422-validacao",
      "Campos inválidos (todos os problemas de uma vez, por campo)",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-e422", key: "delta-criar-20261125-001", body: { contaInterosId: "conta-delta-0004", empresa: { tipo: "varejo", razaoSocial: "", cnpj: "11.111.111/1111-11", endereco: { uf: "XX", cep: "123" } }, modulos: ["pdv", "folha_de_pagamento"], administrador: { nome: "Davi", email: "davi@" } } },
      422,
    );
    await exemplo(
      "erro-422-idempotencia-conflito",
      "Mesma Idempotency-Key com outro conteúdo",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-e422b", key: "alfa-criar-20261120-001", body: { ...alfa, modulos: ["pdv"] } },
      422,
    );
    await exemplo(
      "erro-409-cnpj-em-uso",
      "CNPJ de uma empresa que já usa o ERP (a saída é a vinculação por código)",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-e409", key: "epsilon-criar-20261125-001", body: { ...alfa, contaInterosId: "conta-epsilon-0005", empresa: { ...alfa.empresa, cnpj: "13.579.246/0001-01" } } },
      409,
    );
    await exemplo(
      "erro-409-conta-ja-vinculada",
      "Conta do Interos que já tem outra empresa no ERP",
      { method: "POST", path: "/empresas", requestId: "req-exemplo-e409b", key: "alfa-outra-empresa-0001", body: { ...alfa, empresa: { ...alfa.empresa, cnpj: "98.765.432/0001-98" } } },
      409,
    );
    await exemplo(
      "erro-409-identidade-nao-confere",
      "Vinculação que não confirma a identidade (aqui, CNPJ diferente; a resposta é a mesma para empresa inexistente ou código errado)",
      { method: "POST", path: "/empresas/vincular", requestId: "req-exemplo-e409c", key: "zeta-vincular-20261125-001", body: { contaInterosId: "conta-zeta-0006", idEmpresa: idBeta, cnpj: "98.765.432/0001-98", codigoVinculo: "AAAAA-BBBBB" } },
      409,
    );
    await exemplo("erro-404-nao-encontrado", "Empresa inexistente ou não vinculada ao Interos", { method: "GET", path: "/empresas/naoexiste000000000000", requestId: "req-exemplo-e404" }, 404);
    tick();
    await send({ method: "POST", path: `/empresas/${idAlfa}/suspender`, requestId: "req-exemplo-e423-prep", key: "alfa-suspender-20261125-002", body: { modo: "bloqueio", motivo: "Contrato encerrado pelo cliente" } });
    await exemplo(
      "erro-423-empresa-suspensa",
      "Operação que exige a empresa ativa (convidar administrador numa empresa suspensa)",
      { method: "POST", path: `/empresas/${idAlfa}/administradores`, requestId: "req-exemplo-e423", key: "alfa-admin-20261125-002", body: { administrador: { nome: "Paula Prado", email: "paula@alfa-utilidades.example" } } },
      423,
    );
    tick();
    await send({ method: "POST", path: `/empresas/${idAlfa}/reativar`, requestId: "req-exemplo-e423-fim", key: "alfa-reativar-20261125-002", body: {} });
    await exemplo(
      "erro-409-convite-ja-aceito",
      "Reenviar convite de quem já ativou o acesso",
      { method: "POST", path: `/empresas/${idBeta}/convites/reenviar`, requestId: "req-exemplo-e409d", key: "beta-reenvio-20261125-001", body: { email: "bruno@beta-moda.example" } },
      409,
    );

    // limite por minuto (aqui reduzido a 1 consulta por minuto para mostrar a resposta)
    process.env.INTEROS_LIMITE_LEITURA_MINUTO = "1";
    try {
      resetServiceRateLimits();
      tick();
      await send({ method: "GET", path: "/status", requestId: "req-exemplo-e429-prep" });
      // a próxima chamada cai no mesmo minuto da anterior (15 s depois)
      await exemplo("erro-429-limite-excedido", "Limite de solicitações por minuto atingido", { method: "GET", path: "/status", requestId: "req-exemplo-e429" }, 429, "Aguarde os segundos de Retry-After. O limite é por credencial: leituras e alterações têm limites separados.", { advanceMs: 15_000 });
    } finally {
      delete process.env.INTEROS_LIMITE_LEITURA_MINUTO;
      resetServiceRateLimits();
    }

    setServiceCredentials([]);
    try {
      await exemplo("erro-503-servico-nao-configurado", "Ambiente sem credenciais configuradas (ex.: produção antes da liberação)", { method: "GET", path: "/status", requestId: "req-exemplo-e503" }, 503);
    } finally {
      setServiceCredentials([
        { id: PROV_ID, nome: "Interos — provisionamento (homologação)", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: PROV_SECRET },
        { id: TORRE_ID, nome: "Interos — Torre de Controle (homologação)", escopos: ["torre:resumo", "torre:detalhe", "torre:transacoes"], segredo: TORRE_SECRET },
      ]);
    }
  });

  it("nenhum exemplo publicado ficou órfão", () => {
    if (GERAR || !fs.existsSync(DIR)) return;
    const published = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
    const extra = published.filter((f) => !written.includes(f) && !f.startsWith("torre-"));
    expect(extra, "exemplos sem chamada correspondente neste teste").toEqual([]);
  });
});
