import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("server-only", () => ({}));

import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { freshStore } from "./helpers";
import { findOne, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { setServiceCredentials } from "@/lib/service/credentials";
import { resetServiceRateLimits } from "@/lib/service/http";
import { seedDemo } from "@/domain/seed";

/**
 * Exemplos da Torre de Controle no contrato Interos ↔ ERP (docs/interos/contrato-interos-erp-v1.md §12 e §18), tirados
 * de respostas REAIS das rotas sobre a demonstração de varejo (7 dias de histórico, relógio fixo) vinculada ao Interos.
 * A conferência é pela ESTRUTURA (campos, tipos e status): os valores dependem da massa de demonstração.
 * Regenerar: GERAR_EXEMPLOS=1 npx vitest run tests/interos-contrato-torre.test.ts
 */

const GERAR = process.env.GERAR_EXEMPLOS === "1";
const DIR = path.join(process.cwd(), "docs/interos/exemplos");
const ORIGIN = "https://erp-homologacao.intercert.example";
const TORRE_ID = "interos-torre-homolog";
const PROV_ID = "interos-prov-homolog";
const TORRE_SECRET = "t".repeat(43);
const PROV_SECRET = "p".repeat(43);
const AUTH = { torre: `Bearer ${TORRE_ID}.${TORRE_SECRET}`, prov: `Bearer ${PROV_ID}.${PROV_SECRET}` } as const;
const AUTH_SHOWN = { torre: `Bearer ${TORRE_ID}.<segredo>`, prov: `Bearer ${PROV_ID}.<segredo>` } as const;
const KEEP_HEADERS: Record<string, string> = { "content-type": "Content-Type", "x-request-id": "X-Request-Id", "api-version": "API-Version", "cache-control": "Cache-Control" };

let store: Store;
let idEmpresa = "";
let naoVinculada = "";
const written: string[] = [];

/** Estrutura do documento: campos, tipos e a forma do primeiro item de cada lista. */
function shape(v: unknown): unknown {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
  return typeof v;
}

async function exemplo(arquivo: string, titulo: string, rota: string, query: Record<string, string>, expected: number, opts: { auth?: keyof typeof AUTH; empresa?: string; nota?: string; requestId: string }) {
  const empresa = opts.empresa ?? idEmpresa;
  const mod = await import(`@/app/api/interos/v1/empresas/[idEmpresa]/torre/${rota}/route`);
  const url = new URL(`${ORIGIN}/api/interos/v1/empresas/${empresa}/torre/${rota}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res: Response = await mod.GET(new NextRequest(url, { headers: { authorization: AUTH[opts.auth ?? "torre"], "x-request-id": opts.requestId } }), { params: Promise.resolve({ idEmpresa: empresa }) });
  const body = await res.json();
  expect(res.status, `${arquivo}: ${JSON.stringify(body).slice(0, 400)}`).toBe(expected);
  const headers: Record<string, string> = {};
  for (const [h, shown] of Object.entries(KEEP_HEADERS)) {
    const v = res.headers.get(h);
    if (v != null) headers[shown] = v;
  }
  const doc = {
    titulo,
    ...(opts.nota ? { nota: opts.nota } : {}),
    requisicao: { metodo: "GET", url: url.toString(), cabecalhos: { Authorization: AUTH_SHOWN[opts.auth ?? "torre"], "X-Request-Id": opts.requestId } },
    resposta: { status: res.status, cabecalhos: headers, corpo: body },
  };
  const file = path.join(DIR, `${arquivo}.json`);
  written.push(`${arquivo}.json`);
  if (GERAR) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return body;
  }
  expect(fs.existsSync(file), `exemplo ${arquivo}.json ausente — rode com GERAR_EXEMPLOS=1`).toBe(true);
  const published = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(shape(doc), `docs/interos/exemplos/${arquivo}.json: a estrutura divergiu da resposta real — revise e regenere com GERAR_EXEMPLOS=1`).toEqual(shape(published));
  expect(doc.resposta.status).toBe(published.resposta.status);
  return body;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T18:00:00.000Z"));
  store = freshStore();
  await seedDemo(store, { historyDays: 7 });
  const loja = (await findOne(store, "companies", [["eq", "cnpj", "11222333000181"]]))!;
  idEmpresa = loja.id;
  // na demonstração a empresa não passa pela vinculação (empresas de demonstração não geram código): vínculo direto
  await store.update("companies", idEmpresa, { interosAccountId: "conta-demo-varejo", interosLinkedAt: new Date().toISOString() });
  naoVinculada = (await listAll(store, "companies")).find((c) => c.id !== idEmpresa && !c.interosAccountId)!.id;
  setServiceCredentials([
    { id: PROV_ID, nome: "Interos — provisionamento (homologação)", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: PROV_SECRET },
    { id: TORRE_ID, nome: "Interos — Torre de Controle (homologação)", escopos: ["torre:resumo", "torre:detalhe", "torre:transacoes"], segredo: TORRE_SECRET },
  ]);
  resetServiceRateLimits();
}, 600_000);

afterAll(() => {
  vi.useRealTimers();
  setServiceCredentials(null);
});

const MES = { de: "2026-11-01", ate: "2026-11-20" };

describe.skipIf(process.env.TEST_STORE === "postgres")("contrato Interos ↔ ERP v1 — exemplos da Torre de Controle", () => {
  it("uma resposta real por rota", async () => {
    await exemplo("torre-01-resumo", "Resumo dos indicadores do período (todos os blocos)", "resumo", MES, 200, {
      requestId: "req-torre-0001",
      nota: "vendas e devoluções são do período; nos blocos operacionais, noPeriodo segue de/ate e posicaoAtual é a situação no momento da consulta.",
    });
    await exemplo("torre-02-vendas-serie", "Série diária de vendas", "vendas/serie", { de: "2026-11-14", ate: "2026-11-20", granularidade: "dia" }, 200, { requestId: "req-torre-0002" });
    await exemplo("torre-03-vendas-por-unidade", "Vendas por unidade, com o período anterior", "vendas/por-unidade", MES, 200, { requestId: "req-torre-0003" });
    const produtos = await exemplo("torre-04-produtos", "Ranking de produtos (curva ABC), primeira página", "produtos", { ...MES, limite: "2" }, 200, { requestId: "req-torre-0004" });
    expect(produtos.proximoCursor).toBeTruthy();
    await exemplo("torre-05-skus", "Ranking de SKUs (mesma curva da tela Curva ABC), primeira página", "skus", { ...MES, limite: "2" }, 200, { requestId: "req-torre-0005" });
    await exemplo("torre-06-transacoes-vendas", "Transações de venda (uma linha por venda; sem dados pessoais)", "transacoes/vendas", { de: "2026-11-20", ate: "2026-11-20", limite: "2" }, 200, {
      requestId: "req-torre-0006",
      nota: "Cliente, operador e vendedor só por id. Σ valorLiquidoCentavos das concluídas − Σ devoluções = receita líquida do resumo.",
    });
    await exemplo("torre-07-transacoes-devolucoes", "Transações de devolução", "transacoes/devolucoes", { ...MES, limite: "2" }, 200, { requestId: "req-torre-0007" });
    await exemplo("torre-08-estoque", "Posição atual de estoque por SKU e depósito (sem período)", "estoque", { limite: "2" }, 200, { requestId: "req-torre-0008" });
    await exemplo("torre-09-financeiro", "Financeiro: recebido e pago no período, posição, aging, contas e DRE", "financeiro", MES, 200, { requestId: "req-torre-0009" });
    await exemplo("torre-10-fiscal", "Fiscal: documentos, faturamento fiscal, rejeições, cancelamentos e pendências", "fiscal", MES, 200, { requestId: "req-torre-0010" });
    await exemplo("torre-11-compras", "Compras: pedidos, recebimentos e pendências", "compras", MES, 200, { requestId: "req-torre-0011" });
    await exemplo("torre-12-comercio-digital", "Comércio digital: pedidos da loja virtual, banco e monitor", "comercio-digital", MES, 200, { requestId: "req-torre-0012" });
    await exemplo("torre-13-adocao", "Sinais de adoção (uso real, usuários e pendências de integração)", "adocao", {}, 200, { requestId: "req-torre-0013" });
  }, 300_000);

  it("erros das consultas", async () => {
    await exemplo("torre-erro-422-validacao", "Parâmetros inválidos (todos de uma vez)", "skus", { de: "2025-01-01", ate: "2026-11-20", idUnidade: "99c0ffee00000000000000000000beef", limite: "900" }, 422, { requestId: "req-torre-e422" });
    await exemplo("torre-erro-403-sem-permissao", "Credencial de provisionamento consultando a Torre", "resumo", MES, 403, { requestId: "req-torre-e403", auth: "prov" });
    await exemplo("torre-erro-404-nao-encontrado", "Empresa não vinculada ao Interos", "resumo", MES, 404, { requestId: "req-torre-e404", empresa: naoVinculada });
  });

  it("nenhum exemplo da Torre publicado ficou órfão", () => {
    if (GERAR || !fs.existsSync(DIR)) return;
    const extra = fs.readdirSync(DIR).filter((f) => f.startsWith("torre-") && f.endsWith(".json") && !written.includes(f));
    expect(extra, "exemplos da Torre sem chamada correspondente neste teste").toEqual([]);
  });
});
