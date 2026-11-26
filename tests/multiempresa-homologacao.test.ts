import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * HOMOLOGAÇÃO MULTIEMPRESA — duas contratantes fictícias (Alfa Utilidades e Bravo Calçados) implantadas pelo contrato
 * real do Interos (rotas /api/interos/v1), cada uma com duas filiais, perfis próprios, usuário restrito a uma filial e
 * dados próprios em todos os módulos operacionais. Comprova:
 *  1. a regressão dos fluxos principais DENTRO de cada empresa (PDV, venda, devolução, estoque, compras, financeiro,
 *     fiscal simulado, arquivo, notificação, loja virtual, integração e cópia de segurança);
 *  2. o isolamento entre as duas (matriz de acesso cruzado nos dois sentidos): toda tentativa de ler, alterar, excluir,
 *     listar, pesquisar, relatar, exportar, baixar ou referenciar dados da outra empresa é recusada ou devolve só os dados
 *     da própria empresa — sem nenhum valor da outra (nomes, documentos, e-mails, identificadores);
 *  3. a integridade da empresa-alvo: depois de todas as tentativas, os registros dela continuam idênticos;
 *  4. a restrição do usuário a uma filial e ao próprio perfil.
 * Documento de homologação (matriz, resultados e como rodar): docs/multiempresa/homologacao.md.
 * O arquivo roda em sequência (cada etapa usa o que a anterior criou): rode o arquivo inteiro, não um teste isolado.
 */

// canal de e-mail de teste: nenhuma mensagem sai do processo (convites, documentos)
const correio = vi.hoisted(() => ({ enviados: [] as string[] }));
vi.mock("@/lib/core/email", () => ({
  sendEmail: async (_empresa: string | null, msg: { to: string }) => {
    correio.enviados.push(msg.to);
    return { delivered: true, channel: "teste" };
  },
}));
vi.mock("server-only", () => ({}));

import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { freshStore } from "./helpers";
import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { COLLECTIONS } from "@/lib/db/schema";
import { isolationMode, scopeStore, unscoped } from "@/lib/db/scoped-store";
import type { Ctx } from "@/lib/core/ctx";
import { ctxForCompany } from "@/lib/core/ctx";
import { can, canDo, type ModuleKey } from "@/lib/permissions";
import { setServiceCredentials } from "@/lib/service/credentials";
import { resetServiceRateLimits } from "@/lib/service/http";
import { accessibleUnits, branchScopeOf, toCtxUser } from "@/lib/auth/users";
import type { SessionInfo } from "@/lib/server/session";
import { addDays, today } from "@/lib/dates";
import { QTY } from "@/lib/money";
import { getSetting } from "@/lib/core/settings";
import { saveFile, readFile } from "@/lib/core/files";
import { notify } from "@/lib/core/notify";
import { enqueue, jobsFor, runDueJobs } from "@/lib/core/jobs";
import { nextNumber } from "@/lib/core/numbering";
import { lookups, nameMap } from "@/lib/server/lookups";
import { getExport, toCsv, toXlsx } from "@/lib/exporters";
import "@/exports";
import "@/domain/jobs-registry";
import { acceptInvite, createUser, setUserStatus, updateUser } from "@/domain/users";
import { createRole, updateRole } from "@/domain/roles";
import { createBranch, setBranchStatus, setCompanyStatus, updateBranch, updateCompany } from "@/domain/companies";
import { createTerminal, updateTerminal } from "@/domain/terminals";
import { createWarehouse } from "@/domain/warehouses";
import { createProduct, deleteProduct, postInitialBalance, saveTaxGroup, setProductStatus, updateProduct } from "@/domain/products";
import { resolvePrices, savePrice } from "@/domain/pricing";
import { createCustomer, customerSummary, deleteCustomer, findCustomerByDoc, listSellers, setCustomerStatus, updateCustomer } from "@/domain/customers";
import { createSupplier, deleteSupplier, setSupplierStatus, supplierSummary, updateSupplier } from "@/domain/suppliers";
import { adjustStock, availableMap } from "@/domain/stock";
import { createGoal } from "@/domain/goals";
import { createTransfer } from "@/domain/transfers";
import { addCashMovement, closeSession, openSession, sessionSummary } from "@/domain/cash";
import { cancelSale, finalizeSale, processReturn, returnableItems } from "@/domain/sales";
import { cancelOrder as cancelSalesOrder, createSalesDocument, documentItems, updateSalesDocument } from "@/domain/sales-documents";
import { loadOrigin, saveNfe } from "@/domain/fiscal/nfe";
import { cancelDocument, getFiscalConfig, queryDocument, saveFiscalConfig, transmitDocument } from "@/domain/fiscal/service";
import { numberingStatus, setNextNumber } from "@/domain/fiscal/config";
import { savePolicy, submitForApproval } from "@/domain/approvals";
import { cancelOrder as cancelPurchaseOrder, createOrder, getOrder } from "@/domain/purchases";
import { cancelReceipt, confirmReceipt, createManualReceipt, getReceipt, updateReceipt } from "@/domain/receipts";
import { addTitleAttachment, approvePayable, cancelTitle, createManualTitle, reverseSettlement, settleInstallment, updateTitle } from "@/domain/finance";
import { archiveNotifications, markNotifications, notificationCounts, queryNotifications } from "@/domain/notifications";
import { getIntegration, integrationJobs, integrationLogs, listIntegrations, requeueJob, runCompanyJobs, saveIntegration } from "@/domain/integrations";
import { backupSummary, buildPayload, createBackup, createRestoreJob, loadBackupPayload, verifyBackup } from "@/domain/backup";
import { abcReport } from "@/domain/abc";
import { branchOperations, commercialOverview, managerialReport, paymentBreakdown, reportTotals } from "@/domain/reports";
import { requireStore } from "@/domain/ecommerce/common";
import { createStore, publishStore, saveLegalContact } from "@/domain/ecommerce/store";
import { addToCatalog, isPublicImage, publicCatalog, publicProduct, saveListing, sitemapEntries } from "@/domain/ecommerce/catalog";
import { uploadStoreImage } from "@/domain/ecommerce/images";
import { resolveStore } from "@/domain/ecommerce/storefront";
import { addToCart } from "@/domain/ecommerce/cart";
import { fileAccessDenial } from "@/app/api/files/[id]/access";
import { querySales, queryReturns, saleDetail } from "@/app/(app)/vendas/queries";
import { queryBalances, queryMovements } from "@/app/(app)/estoque/queries";
import { queryInstallments, titleDetail } from "@/app/(app)/financeiro/queries";
import { queryDocuments } from "@/app/(app)/fiscal/queries";
import { querySessions } from "@/app/(app)/caixa/queries";
import { queryCustomers } from "@/app/(app)/clientes/queries";
import { queryProducts } from "@/app/(app)/produtos/queries";
import { querySuppliers } from "@/app/(app)/fornecedores/queries";
import { queryOrders } from "@/app/(app)/compras/pedidos/queries";
import { financeSnapshot, fiscalSnapshot, latestSales, openCashSessions, stockAlerts } from "@/app/(app)/dashboard/queries";

// ─── as duas empresas fictícias ─────────────────────────────────────────────────────────────────────────────────

type Chave = "A" | "B";

interface Definicao {
  chave: Chave;
  nome: string;
  conta: string;
  empresa: Record<string, any>;
  unidade: { nome: string; codigo: string };
  filial: { code: string; name: string; cnpj: string; ie: string; address: Record<string, string> };
  modulos: string[];
  admin: { nome: string; email: string };
  vendedor: { nome: string; email: string; login: string };
  produtos: Array<{ nome: string; ncm: string; gtin?: string; preco: number; custo: number }>;
  clientePF: { nome: string; cpf: string; email: string };
  clientePJ: { nome: string; cnpj: string; endereco: Record<string, string> };
  clienteComum: { nome: string; cpf: string };
  fornecedor: { nome: string; fantasia: string; cnpj: string };
  segredoEmail: string;
  loja: string;
  /** textos que só existem nesta empresa: nenhum deles pode aparecer no que a outra empresa recebe */
  marcadores: RegExp[];
}

/** CPF presente nas DUAS empresas (cadastro independente em cada uma). */
const CPF_COMUM = "529.982.247-25";
/** Código de barras presente nas DUAS empresas (unicidade por empresa). */
const GTIN_COMUM = "7891234567895";
const SENHA = "Homologacao#2026";

const DEF: Record<Chave, Definicao> = {
  A: {
    chave: "A",
    nome: "Alfa Utilidades",
    conta: "conta-homolog-alfa-0001",
    empresa: {
      tipo: "varejo", razaoSocial: "Alfa Utilidades Domésticas Homologação Ltda", nomeFantasia: "Alfa Utilidades", cnpj: "12.345.678/0001-95", inscricaoEstadual: "110.042.490.114",
      regimeTributario: "simples", cnae: "4759-8/99", email: "contato@alfa-homolog.example", telefone: "(11) 3333-0101",
      endereco: { cep: "01310-100", logradouro: "Avenida Paulista", numero: "1000", bairro: "Bela Vista", municipio: "São Paulo", codigoMunicipioIbge: "3550308", uf: "SP" },
    },
    unidade: { nome: "Alfa — Paulista (Matriz)", codigo: "01" },
    filial: { code: "02", name: "Alfa — Moema", cnpj: "12.345.678/0002-76", ie: "110.042.490.220", address: { zip: "04077-000", street: "Avenida Ibirapuera", number: "2000", district: "Moema", cityName: "São Paulo", cityCode: "3550308", uf: "SP" } },
    modulos: ["pdv", "vendas", "estoque", "compras", "financeiro", "fiscal", "relatorios", "comercio_digital"],
    admin: { nome: "Ana Alfa", email: "ana.admin@alfa-homolog.example" },
    vendedor: { nome: "Vitor Vendedor Alfa", email: "vitor.vendedor@alfa-homolog.example", login: "vitor.alfa" },
    produtos: [
      { nome: "Panela Alfa Inox 20cm", ncm: "73239300", gtin: GTIN_COMUM, preco: 9990, custo: 4000 },
      { nome: "Chaleira Alfa Esmaltada", ncm: "73239300", preco: 7990, custo: 3000 },
    ],
    clientePF: { nome: "Carla Cliente Alfa", cpf: "123.123.123-87", email: "carla.cliente@alfa-homolog.example" },
    clientePJ: { nome: "Comercial Cliente Alfa Ltda", cnpj: "77.788.899/0001-83", endereco: { zip: "01310100", street: "Avenida Paulista", number: "500", district: "Bela Vista", cityName: "São Paulo", cityCode: "3550308", uf: "SP" } },
    clienteComum: { nome: "Cliente Compartilhado Alfa", cpf: CPF_COMUM },
    fornecedor: { nome: "Fornecedora Alfa Metais Ltda", fantasia: "Alfa Metais", cnpj: "11.122.233/0001-83" },
    segredoEmail: "RESEND_API_KEY_LOJA_0001",
    loja: "Loja Alfa Utilidades",
    marcadores: [/alfa/i, /12345678000195/, /12345678000276/, /12312312387/, /77788899000183/, /11122233000183/, /110042490114/, /110042490220/],
  },
  B: {
    chave: "B",
    nome: "Bravo Calçados",
    conta: "conta-homolog-bravo-0002",
    empresa: {
      tipo: "varejo", razaoSocial: "Bravo Calçados e Acessórios Homologação Ltda", nomeFantasia: "Bravo Calçados", cnpj: "98.765.432/0001-98", inscricaoEstadual: "062.307.904.0081",
      regimeTributario: "simples", cnae: "4782-2/01", email: "contato@bravo-homolog.example", telefone: "(31) 3222-0202",
      endereco: { cep: "30130-010", logradouro: "Avenida Afonso Pena", numero: "500", bairro: "Centro", municipio: "Belo Horizonte", codigoMunicipioIbge: "3106200", uf: "MG" },
    },
    unidade: { nome: "Bravo — Savassi (Matriz)", codigo: "01" },
    filial: { code: "02", name: "Bravo — Pampulha", cnpj: "98.765.432/0002-79", ie: "062.307.904.0162", address: { zip: "31270-901", street: "Avenida Presidente Antônio Carlos", number: "6627", district: "Pampulha", cityName: "Belo Horizonte", cityCode: "3106200", uf: "MG" } },
    // sem "relatorios": módulos contratados diferentes nas duas empresas
    modulos: ["pdv", "vendas", "estoque", "compras", "financeiro", "fiscal", "comercio_digital"],
    admin: { nome: "Bruno Bravo", email: "bruno.admin@bravo-homolog.example" },
    vendedor: { nome: "Vera Vendedora Bravo", email: "vera.vendedora@bravo-homolog.example", login: "vera.bravo" },
    produtos: [
      { nome: "Tênis Bravo Corrida 42", ncm: "64041100", gtin: GTIN_COMUM, preco: 29990, custo: 12000 },
      { nome: "Sandália Bravo Couro 38", ncm: "64039990", preco: 15990, custo: 6000 },
    ],
    clientePF: { nome: "Diego Cliente Bravo", cpf: "456.456.456-00", email: "diego.cliente@bravo-homolog.example" },
    clientePJ: { nome: "Distribuidora Cliente Bravo Ltda", cnpj: "22.233.344/0001-83", endereco: { zip: "30130010", street: "Avenida Afonso Pena", number: "900", district: "Centro", cityName: "Belo Horizonte", cityCode: "3106200", uf: "MG" } },
    clienteComum: { nome: "Cliente Compartilhado Bravo", cpf: CPF_COMUM },
    fornecedor: { nome: "Fornecedora Bravo Couros Ltda", fantasia: "Bravo Couros", cnpj: "44.455.566/0001-83" },
    segredoEmail: "RESEND_API_KEY_LOJA_0002",
    loja: "Loja Bravo Calçados",
    marcadores: [/bravo/i, /98765432000198/, /98765432000279/, /45645645600/, /22233344000183/, /44455566000183/, /0623079040081/, /0623079040162/],
  },
};

/** Tudo o que a empresa tem depois da implantação e da regressão (preenchido em ordem pelos testes). */
interface Mundo {
  def: Definicao;
  company: Doc;
  matriz: Doc;
  filial: Doc;
  adminId: string;
  vendedorId: string;
  adm: Ctx; // administrador na Matriz
  admFilial: Ctx; // administrador na filial 02
  admCons: Ctx; // administrador no consolidado (somente consulta)
  vend: Ctx; // vendedor restrito à Matriz
  perfilVendedor: Doc;
  t1: Doc;
  t2: Doc;
  grupo: Doc;
  metodos: Record<string, Doc>;
  prazos: Doc[];
  banco: Doc;
  categoriaReceita: Doc;
  p1: Doc;
  p2: Doc;
  sku1: Doc;
  sku2: Doc;
  cPF: Doc;
  cPJ: Doc;
  cComum: Doc;
  fornecedor: Doc;
  caixa1: Doc;
  caixa2: Doc;
  venda: Doc;
  vendaFilial: Doc;
  devolucao: Doc;
  pedidoVenda: Doc;
  nfe: Doc;
  nfce: Doc;
  pedidoCompra: Doc;
  recebimento: Doc;
  receber: Doc;
  pagar: Doc;
  parcelaReceber: Doc;
  parcelaPagar: Doc;
  baixa: Doc;
  arquivo: Doc;
  imagem: Doc;
  notificacao: Doc;
  loja: Doc;
  slug1: string;
  integracao: Doc;
  backup: Doc;
  tarefa: Doc;
}

const W = {} as Record<Chave, Mundo>;
let store: Store;

// ─── interface de serviço do Interos (contrato real) ──────────────────────────────────────────────────────────────

const SEGREDO = "k".repeat(43);
const CRED = `Bearer interos-homolog.${SEGREDO}`;
const ORIGEM = "https://erp-homologacao.intercert.example";

async function interos(method: "GET" | "POST" | "PUT", caminho: string, opts: { body?: unknown; key?: string; params?: Record<string, string> } = {}) {
  const p = caminho.split("?")[0];
  const routeFile = p === "/empresas" ? "empresas" : `empresas/[idEmpresa]${/^\/empresas\/[^/]+(\/.*)?$/.exec(p)![1] ?? ""}`;
  const mod = await import(`@/app/api/interos/v1/${routeFile}/route`);
  const headers: Record<string, string> = { "content-type": "application/json", authorization: CRED };
  if (opts.key) headers["idempotency-key"] = opts.key;
  const res: Response = await mod[method](new NextRequest(`${ORIGEM}/api/interos/v1${caminho}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), {
    params: Promise.resolve(opts.params ?? {}),
  });
  return { status: res.status, body: await res.json() };
}

// ─── contextos (mesma composição da sessão: Store restrito à empresa, perfil da empresa) ─────────────────────────

async function ctxDe(company: Doc, userId: string, branchId: string | null): Promise<Ctx> {
  const u = (await store.get("users", userId))!;
  return { store: scopeStore(store, company.id, { platform: Boolean(company.isPlatform) }), companyId: company.id, branchId, user: await toCtxUser(store, u, company.id) };
}

/** O que `getSession` entregaria a esse usuário nessa unidade (sem cookie): usado pelas funções por trás das rotas. */
async function sessaoDe(m: Mundo, ctx: Ctx): Promise<SessionInfo> {
  const userDoc = (await store.get("users", ctx.user.id))!;
  const { companies, branches } = await accessibleUnits(store, userDoc);
  const company = companies.find((c) => c.id === m.company.id)!;
  const own = branches.filter((b) => b.companyId === company.id);
  return { ctx, user: ctx.user, company, branch: ctx.branchId ? own.find((b) => b.id === ctx.branchId)! : null, companies, branches: own, consolidated: !ctx.branchId, canConsolidate: branchScopeOf(userDoc, company.id) === null };
}

const PERIODO = { de: addDays(today(), -30), ate: addDays(today(), 1) };

// ─── conferência de vazamento ─────────────────────────────────────────────────────────────────────────────────────

function serializa(v: unknown): string {
  try {
    return (
      JSON.stringify(v, (_k, x) => {
        if (x instanceof Map) return [...x.entries()];
        if (x instanceof Set) return [...x.values()];
        if (x && typeof x === "object" && (x as any).type === "Buffer" && Array.isArray((x as any).data)) return Buffer.from((x as any).data).toString("latin1");
        if (x instanceof Uint8Array) return Buffer.from(x).toString("latin1");
        return x;
      }) ?? ""
    );
  } catch {
    return String(v);
  }
}

/** Ids de todos os registros da empresa (para conferir que nenhum aparece no que a outra recebe). */
const idsDaEmpresa: Record<Chave, Set<string>> = { A: new Set(), B: new Set() };

function vazamentos(alvo: Chave, texto: string, conferirIds: boolean): string[] {
  const out: string[] = [];
  for (const re of DEF[alvo].marcadores) if (re.test(texto)) out.push(`texto ${re}`);
  // registro da outra empresa = objeto com o id dela ("id":"…"); o id que a própria tentativa informou (filtro, escopo,
  // auditoria da tentativa) não é dado da outra empresa
  if (conferirIds) for (const id of idsDaEmpresa[alvo]) if (id.length >= 16 && texto.includes(`"id":"${id}"`)) out.push(`id ${id}`);
  return out;
}

// ─── fotografia de uma empresa (integridade antes × depois) ─────────────────────────────────────────────────────────

/** Todos os registros da empresa em todas as coleções (inclui usuários vinculados, a empresa e os numeradores dela). */
async function fotografia(m: Mundo): Promise<Map<string, string>> {
  const base = unscoped(store);
  const out = new Map<string, string>();
  const ids = new Set<string>([m.company.id]);
  for (const c of COLLECTIONS) {
    if (!c.fields.companyId) continue;
    for (const d of await listAll(base, c.id, { filters: [["eq", "companyId", m.company.id]] })) {
      out.set(`${c.id}/${d.id}`, serializa(d));
      ids.add(d.id);
    }
  }
  out.set(`companies/${m.company.id}`, serializa(await base.get("companies", m.company.id)));
  for (const u of await listAll(base, "users", { filters: [["contains", "companyIds", m.company.id]] })) {
    out.set(`users/${u.id}`, serializa(u));
    ids.add(u.id);
  }
  // numeradores: chave com a empresa ou com qualquer registro dela (filial, terminal, sessão de caixa)
  for (const k of await listAll(base, "counters")) if ([...ids].some((id) => String(k.key).includes(id))) out.set(`counters/${k.id}`, serializa(k));
  idsDaEmpresa[m.def.chave] = ids;
  return out;
}

function diferencas(antes: Map<string, string>, depois: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of antes) if (!depois.has(k)) out.push(`removido: ${k}`);
  else if (depois.get(k) !== v) out.push(`alterado: ${k}`);
  for (const k of depois.keys()) if (!antes.has(k)) out.push(`novo: ${k}`);
  return out;
}

// ─── registro da matriz (alimenta docs/multiempresa/homologacao.md) ─────────────────────────────────────────────

type Esperado = "recusa" | "inexistente" | "vazio" | "somente a própria" | "recusa ou somente a própria";
interface Linha {
  superficie: string;
  tentativa: string;
  esperado: Esperado;
  run: () => Promise<unknown>;
  /** conferência adicional (ex.: presença dos dados da própria empresa) */
  confere?: (valor: any) => void | Promise<void>;
}
const relatorio: Array<{ direcao: string; superficie: string; tentativa: string; esperado: string; resultado: string }> = [];
const registrosFotografados: Record<string, number> = {};
const regressao: Array<{ empresa: string; fluxo: string; resultado: string }> = [];

function curto(e: unknown) {
  const msg = String((e as Error)?.message ?? e).replace(/\s+/g, " ");
  return `${(e as Error)?.name ?? "Erro"}: ${msg.slice(0, 110)}${msg.length > 110 ? "…" : ""}`;
}

/** Trecho do texto em volta do primeiro vazamento (diagnóstico da falha). */
function trecho(texto: string, achados: string[]): string {
  const alvo = achados[0]?.startsWith("id ") ? `"id":"${achados[0].slice(3)}"` : (achados[0]?.replace(/^texto /, "") ?? "");
  const re = alvo.startsWith("/") ? new RegExp(alvo.slice(1, alvo.lastIndexOf("/")), alvo.slice(alvo.lastIndexOf("/") + 1)) : null;
  const i = re ? texto.search(re) : texto.indexOf(alvo);
  return i < 0 ? "" : texto.slice(Math.max(0, i - 200), i + 120);
}

function vazio(v: any): boolean {
  if (v == null || v === false) return true;
  if (Array.isArray(v)) return v.length === 0 || v.every((x) => vazio(x));
  if (v instanceof Map || v instanceof Set) return v.size === 0;
  if (typeof v === "object" && "items" in v && Array.isArray(v.items)) return v.items.length === 0;
  return false;
}

async function executa(direcao: string, alvo: Chave, l: Linha) {
  let ok = true;
  let valor: unknown;
  let erro: unknown;
  try {
    valor = await l.run();
  } catch (e) {
    ok = false;
    erro = e;
  }
  // nenhum valor da empresa-alvo no que a atacante recebeu (nem nos dados, nem na mensagem de erro)
  if (ok) {
    const v = vazamentos(alvo, serializa(valor), true);
    expect(v, `${l.tentativa}: dados da empresa-alvo no resultado — ${v.join(", ")} — ${trecho(serializa(valor), v)}`).toEqual([]);
  } else {
    const v = vazamentos(alvo, String((erro as Error)?.message ?? erro), false);
    expect(v, `${l.tentativa}: dados da empresa-alvo na mensagem de erro — ${String((erro as Error)?.message)}`).toEqual([]);
  }
  // recusa deliberada (regra de negócio, permissão, registro inexistente) — nunca falha de programação no caminho
  if (!ok) expect(erro instanceof TypeError || erro instanceof ReferenceError || erro instanceof RangeError || erro instanceof SyntaxError, `${l.tentativa}: erro inesperado — ${curto(erro)}`).toBe(false);
  let resultado: string;
  switch (l.esperado) {
    case "recusa":
      expect(ok, `${l.tentativa}: deveria ser recusado, devolveu ${serializa(valor).slice(0, 300)}`).toBe(false);
      resultado = `recusado — ${curto(erro)}`;
      break;
    case "inexistente":
      expect(!ok || valor == null || valor === false, `${l.tentativa}: deveria tratar como inexistente, devolveu ${serializa(valor).slice(0, 300)}`).toBe(true);
      resultado = ok ? `não encontrado (${valor === false ? "false" : "null"})` : `não encontrado — ${curto(erro)}`;
      break;
    case "vazio":
      expect(ok, `${l.tentativa}: falhou — ${curto(erro)}`).toBe(true);
      expect(vazio(valor), `${l.tentativa}: deveria vir vazio, devolveu ${serializa(valor).slice(0, 300)}`).toBe(true);
      resultado = "vazio";
      break;
    case "recusa ou somente a própria":
      resultado = ok ? `somente dados da própria empresa${typeof valor === "string" ? ` (${Math.max(0, valor.split("\r\n").length - 1)} linha(s))` : ""}` : `recusado — ${curto(erro)}`;
      break;
    default:
      expect(ok, `${l.tentativa}: falhou — ${curto(erro)}`).toBe(true);
      resultado = "somente dados da própria empresa";
  }
  if (l.confere) await l.confere(valor);
  relatorio.push({ direcao, superficie: l.superficie, tentativa: l.tentativa, esperado: l.esperado, resultado });
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("IHDR-homologacao-imagem")]);

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

beforeAll(() => {
  store = freshStore();
  setServiceCredentials([{ id: "interos-homolog", nome: "Interos — homologação multiempresa", escopos: ["provisionamento:leitura", "provisionamento:escrita"], segredo: SEGREDO }]);
  resetServiceRateLimits();
});

afterAll(() => {
  setServiceCredentials(null);
  const arquivo = process.env.HOMOLOGACAO_RELATORIO;
  if (arquivo) fs.writeFileSync(arquivo, JSON.stringify({ backend: process.env.TEST_STORE === "postgres" ? "postgres" : "memoria", registrosFotografados, regressao, matriz: relatorio }, null, 2));
});

describe("1. implantação pelo Interos (contrato real da API v1)", () => {
  it("isolamento em modo estrito (padrão de produção)", () => {
    expect(isolationMode()).toBe("estrito");
  });

  it.each(["A", "B"] as const)("implanta a empresa %s: empresa, unidade inicial, módulos e convite do administrador", async (k) => {
    const d = DEF[k];
    const r = await interos("POST", "/empresas", {
      key: `homolog-${k}-criar-0001`,
      body: { contaInterosId: d.conta, empresa: d.empresa, unidadeInicial: d.unidade, modulos: d.modulos, administrador: d.admin, entregaConvite: "interos", contrato: { referencia: `CT-HOMOLOG-${k}`, plano: "profissional" } },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.empresa).toMatchObject({ contaInterosId: d.conta, razaoSocial: d.empresa.razaoSocial, situacao: "ativa", modulos: [...d.modulos].sort() });
    expect(r.body.empresa.implantacao.estado).toBe("concluida");
    // o convite é aceito pelo link de uso único (a pessoa define a própria senha)
    const token = String(r.body.convite.link).split("/").pop()!;
    const admin = await acceptInvite(store, token, SENHA);
    expect(admin.status).toBe("active");
    const company = (await store.get("companies", r.body.empresa.idEmpresa))!;
    const matriz = (await listAll(store, "branches", { filters: [["eq", "companyId", company.id]] }))[0];
    W[k] = { def: d, company, matriz, adminId: admin.id } as Mundo;
    W[k].adm = await ctxDe(company, admin.id, matriz.id);
    // o Interos vê a empresa implantada (e só ela, pelo id)
    const st = await interos("GET", `/empresas/${company.id}`, { params: { idEmpresa: company.id } });
    expect(st.body.empresa.administradores[0]).toMatchObject({ email: d.admin.email, situacao: "ativo" });
  });

  it("CNPJ de uma contratante não pode ser reaproveitado por outra conta (sem revelar a empresa existente)", async () => {
    const r = await interos("POST", "/empresas", { key: "homolog-cnpj-dup-0001", body: { contaInterosId: "conta-homolog-intrusa", empresa: { ...DEF.A.empresa, razaoSocial: "Intrusa Ltda" }, modulos: ["pdv"], administrador: { nome: "Intrusa", email: "intrusa@homolog.example" } } });
    expect(r.status).toBe(409);
    expect(r.body.erro.codigo).toBe("cnpj_em_uso");
    expect(JSON.stringify(r.body)).not.toMatch(/alfa/i);
  });

  it("cada administrador alcança só a própria empresa, com o perfil limitado aos módulos contratados", async () => {
    for (const k of ["A", "B"] as const) {
      const other = k === "A" ? "B" : "A";
      const u = (await store.get("users", W[k].adminId))!;
      const units = await accessibleUnits(store, u);
      expect(units.companies.map((c) => c.id)).toEqual([W[k].company.id]);
      // a barreira é o vínculo: sem ele não há contexto na outra empresa (nem sessão, nem administração multiempresa)
      await expect(ctxForCompany(W[k].adm, W[other].company.id)).rejects.toThrow(/acesso/);
      expect(u.companyIds).toEqual([W[k].company.id]);
    }
    expect(W.A.adm.user.permissions.reports?.view).toBe(true);
    // a Bravo não contratou relatórios gerenciais: o perfil de administrador fica sem o módulo
    expect(W.B.adm.user.permissions.reports).toBeUndefined();
  });
});

// ─── 2. regressão dos fluxos dentro de cada empresa ───────────────────────────────────────────────────────────────

describe.each(["A", "B"] as const)("2. regressão dos fluxos dentro da empresa %s", (k) => {
  const m = () => W[k];
  const ok = (fluxo: string, resultado: string) => regressao.push({ empresa: DEF[k].nome, fluxo, resultado });

  it("estrutura: segunda filial, terminais, perfil restrito e vendedor limitado à Matriz", async () => {
    const d = DEF[k];
    const w = m();
    w.filial = await createBranch(w.adm, w.company.id, { code: d.filial.code, name: d.filial.name, cnpj: d.filial.cnpj, ie: d.filial.ie, address: d.filial.address } as any);
    expect(w.filial).toMatchObject({ companyId: w.company.id, code: "02", status: "active" });
    w.admFilial = await ctxDe(w.company, w.adminId, w.filial.id);
    w.admCons = await ctxDe(w.company, w.adminId, null);
    w.perfilVendedor = await createRole(w.adm, {
      name: `Vendedor de loja (${d.nome})`,
      description: "PDV, vendas e clientes; sem financeiro, compras, estoque, fiscal ou administração.",
      permissions: { dashboard: { view: true }, pdv: { view: true, create: true, edit: true }, sales: { view: true, create: true }, cash: { view: true, create: true, edit: true }, customers: { view: true, create: true, edit: true }, products: { view: true } },
      actions: ["sale.return"],
      discountLimitBps: 500,
    });
    const { user } = await createUser(w.adm, { name: d.vendedor.nome, email: d.vendedor.email, login: d.vendedor.login, roleId: w.perfilVendedor.id, companyIds: [w.company.id], branchIds: [], companyBranchIds: [w.matriz.id], mode: "password", password: SENHA } as any);
    w.vendedorId = user.id;
    w.vend = await ctxDe(w.company, user.id, w.matriz.id);
    expect(w.vend.user.branchIds).toEqual([w.matriz.id]);
    expect(w.vend.user.roleId).toBe(w.perfilVendedor.id);
    const term = (branch: Doc, code: string, name: string) =>
      createTerminal(w.adm, { branchId: branch.id, code, name, nfceSeries: 1, printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false, defaultWarehouseId: branch.defaultWarehouseId });
    w.t1 = await term(w.matriz, "CX01", `Caixa 01 — ${d.unidade.nome}`);
    w.t2 = await term(w.filial, "CX02", `Caixa 01 — ${d.filial.name}`);
    ok("Segunda filial, perfil restrito, vendedor limitado à Matriz e terminais", "concluído");
  });

  it("cadastros: grupo tributário, configuração fiscal em simulação, produtos (com código de barras), clientes e fornecedor", async () => {
    const d = DEF[k];
    const w = m();
    w.grupo = await saveTaxGroup(w.adm, { name: "Simples Nacional — revenda (CSOSN 102)", regime: "simples", cfopInternal: "5102", cfopInterstate: "6102", cfopReturn: "1202", cstCsosn: "102", icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0 } as any);
    await saveFiscalConfig(w.adm, null, { provider: "simulated", environment: "homologacao", nfeEnabled: true, nfceEnabled: true, nfseEnabled: false, nfeSeries: 1, nfeNextNumber: 1, nfceSeries: 1, nfceNextNumber: 1, cscId: "000001", cscTokenRef: "NFCE_CSC", contingency: false, defaultPresence: "1", defaultTaxGroupId: w.grupo.id });
    const [pa, pb] = d.produtos;
    w.p1 = await createProduct(w.adm, { type: "product", name: pa.nome, unitCode: "UN", ncm: pa.ncm, origin: "0", taxGroupId: w.grupo.id, gtin: pa.gtin ?? null, weightGrams: 900 }, { costAcquisition: pa.custo, price: pa.preco, idemKey: `${k}-p1` });
    w.p2 = await createProduct(w.adm, { type: "product", name: pb.nome, unitCode: "UN", ncm: pb.ncm, origin: "0", taxGroupId: w.grupo.id, weightGrams: 700 }, { costAcquisition: pb.custo, price: pb.preco, idemKey: `${k}-p2` });
    const skus = await listAll(w.adm.store, "skus", { filters: [["eq", "companyId", w.company.id]] });
    w.sku1 = skus.find((s) => s.productId === w.p1.id)!;
    w.sku2 = skus.find((s) => s.productId === w.p2.id)!;
    // códigos por empresa: as duas empresas começam a numeração do zero (mesmos códigos, registros independentes)
    expect(w.p1.code).toBe("000001");
    w.cPF = await createCustomer(w.adm, { personType: "PF", doc: d.clientePF.cpf, name: d.clientePF.nome, email: d.clientePF.email, creditLimit: 200000 });
    w.cPJ = await createCustomer(w.adm, { personType: "PJ", doc: d.clientePJ.cnpj, name: d.clientePJ.nome, addresses: [{ kind: "main", ...d.clientePJ.endereco }] as any });
    w.cComum = await createCustomer(w.adm, { personType: "PF", doc: d.clienteComum.cpf, name: d.clienteComum.nome });
    w.fornecedor = await createSupplier(w.adm, { personType: "PJ", doc: d.fornecedor.cnpj, name: d.fornecedor.nome, tradeName: d.fornecedor.fantasia, status: "active" });
    const methods = await listAll(w.adm.store, "payment_methods", { filters: [["eq", "companyId", w.company.id]] });
    w.metodos = Object.fromEntries(methods.map((x) => [x.kind, x]));
    w.prazos = await listAll(w.adm.store, "payment_terms", { filters: [["eq", "companyId", w.company.id]] });
    w.banco = (await listAll(w.adm.store, "financial_accounts", { filters: [["eq", "companyId", w.company.id], ["eq", "kind", "bank"]] }))[0];
    w.categoriaReceita = (await listAll(w.adm.store, "fin_categories", { filters: [["eq", "companyId", w.company.id], ["eq", "type", "revenue"]] }))[0];
    ok("Cadastros (grupo tributário, configuração fiscal, produtos, clientes, fornecedor)", "concluído");
  });

  it("estoque: entrada de saldo inicial nas duas filiais", async () => {
    const w = m();
    await postInitialBalance(w.adm, { warehouseId: w.matriz.defaultWarehouseId, skuId: w.sku1.id, qty: 20 * QTY, unitCost: DEF[k].produtos[0].custo });
    await postInitialBalance(w.adm, { warehouseId: w.matriz.defaultWarehouseId, skuId: w.sku2.id, qty: 10 * QTY, unitCost: DEF[k].produtos[1].custo });
    await postInitialBalance(w.admFilial, { warehouseId: w.filial.defaultWarehouseId, skuId: w.sku1.id, qty: 8 * QTY, unitCost: DEF[k].produtos[0].custo });
    expect((await availableMap(store, w.matriz.id, [w.sku1.id])).get(w.sku1.id)?.available).toBe(20 * QTY);
    expect((await availableMap(store, w.filial.id, [w.sku1.id])).get(w.sku1.id)?.available).toBe(8 * QTY);
    ok("Estoque — entrada de saldo inicial (Matriz e filial 02)", "concluído");
  });

  it("PDV: vendedor abre o caixa e vende (dinheiro + crediário) com NFC-e simulada autorizada; a filial 02 também vende", async () => {
    const d = DEF[k];
    const w = m();
    w.caixa1 = await openSession(w.vend, { terminalId: w.t1.id, openingFund: 10000 });
    const total = 2 * d.produtos[0].preco + d.produtos[1].preco;
    const prazo2 = w.prazos.find((t) => t.installments === 2)!;
    w.venda = await finalizeSale(w.vend, {
      idemKey: `${k}-venda-1`, terminalId: w.t1.id, customerId: w.cPF.id,
      items: [{ skuId: w.sku1.id, qty: 2 * QTY }, { skuId: w.sku2.id, qty: QTY }],
      payments: [{ methodId: w.metodos.cash.id, amount: d.produtos[1].preco, received: d.produtos[1].preco }, { methodId: w.metodos.crediario.id, amount: total - d.produtos[1].preco, paymentTermId: prazo2.id }],
    });
    expect(w.venda).toMatchObject({ status: "completed", total, companyId: w.company.id, branchId: w.matriz.id });
    w.caixa2 = await openSession(w.admFilial, { terminalId: w.t2.id, openingFund: 5000 });
    w.vendaFilial = await finalizeSale(w.admFilial, { idemKey: `${k}-venda-filial-1`, terminalId: w.t2.id, items: [{ skuId: w.sku1.id, qty: QTY }], payments: [{ methodId: w.metodos.cash.id, amount: d.produtos[0].preco, received: d.produtos[0].preco }] });
    expect(w.vendaFilial).toMatchObject({ status: "completed", branchId: w.filial.id });
    // efeitos (estoque, financeiro) e transmissão fiscal simulada pelas tarefas da própria empresa
    await runDueJobs(w.adm.store, { limit: 50 });
    const venda = (await store.get("sales", w.venda.id))!;
    expect(venda.fiscalStatus).toBe("authorized");
    w.nfce = (await store.get("fiscal_documents", venda.fiscalDocumentId))!;
    expect(w.nfce).toMatchObject({ model: "nfce", status: "authorized", companyId: w.company.id });
    expect((await availableMap(store, w.matriz.id, [w.sku1.id])).get(w.sku1.id)?.available).toBe(18 * QTY);
    const titulos = await listAll(store, "titles", { filters: [["eq", "originId", w.venda.id]] });
    expect(titulos.map((t) => t.originType)).toEqual(["sale"]);
    expect((await sessionSummary(w.vend, w.caixa1.id)).expected.cash).toBe(10000 + d.produtos[1].preco);
    ok("PDV — caixa aberto pelo vendedor, venda dinheiro + crediário, NFC-e simulada autorizada", `venda nº ${w.venda.number} autorizada (NFC-e nº ${w.nfce.number})`);
  });

  it("devolução: um item da venda volta ao estoque e o valor abate o crediário da própria venda", async () => {
    const w = m();
    const itens = await listAll(store, "sale_items", { filters: [["eq", "saleId", w.venda.id]] });
    const before = (await availableMap(store, w.matriz.id, [w.sku2.id])).get(w.sku2.id)!.available;
    w.devolucao = await processReturn(w.vend, { saleId: w.venda.id, idemKey: `${k}-devolucao-1`, reason: "Cliente desistiu do item", compensation: "store_credit", items: [{ saleItemId: itens.find((i) => i.skuId === w.sku2.id)!.id, qty: QTY, condition: "resellable" }] });
    const preco = DEF[k].produtos[1].preco;
    expect(w.devolucao.itemsTotal).toBe(preco);
    await runDueJobs(w.adm.store, { limit: 50 });
    expect((await availableMap(store, w.matriz.id, [w.sku2.id])).get(w.sku2.id)!.available).toBe(before + QTY);
    // venda com parte a prazo: o valor devolvido abate o crediário em aberto da própria venda
    expect(w.devolucao.abatedAmount).toBe(preco);
    const titulo = (await listAll(store, "titles", { filters: [["eq", "originId", w.venda.id], ["eq", "originType", "sale"]] }))[0];
    const parcelas = await listAll(store, "installments", { filters: [["eq", "titleId", titulo.id]] });
    expect(parcelas.reduce((s, i) => s + i.balance, 0)).toBe(titulo.total - preco);
    ok("Devolução — item devolvido ao estoque e abatido do crediário", `devolução nº ${w.devolucao.number}, R$ ${(preco / 100).toFixed(2).replace(".", ",")} abatidos do crediário`);
  });

  it("venda: pedido de venda faturado por NF-e simulada (baixa o estoque e gera a conta a receber)", async () => {
    const w = m();
    w.pedidoVenda = await createSalesDocument(w.adm, "order", { customerId: w.cPJ.id, items: [{ skuId: w.sku1.id, qty: 3 * QTY }] }, { idemKey: `${k}-pedido-venda-1` });
    expect(w.pedidoVenda).toMatchObject({ type: "order", status: "open" });
    const pre = await loadOrigin(w.adm, "sales_document", w.pedidoVenda.id, w.matriz.id);
    expect(pre.blockers).toEqual([]);
    const nfe = await saveNfe(w.adm, pre.input, { idemKey: `${k}-nfe-1`, transmit: true });
    w.nfe = await queryDocument(w.adm, nfe.id);
    expect(w.nfe).toMatchObject({ model: "nfe", status: "authorized", companyId: w.company.id });
    expect((await availableMap(store, w.matriz.id, [w.sku1.id])).get(w.sku1.id)?.available).toBe(15 * QTY);
    const receber = await listAll(store, "titles", { filters: [["eq", "originType", "fiscal_document"], ["eq", "originId", w.nfe.id]] });
    expect(receber.map((t) => [t.kind, t.companyId, t.partyId])).toEqual([["receivable", w.company.id, w.cPJ.id]]);
    ok("Venda — pedido de venda faturado por NF-e simulada (estoque e conta a receber)", `pedido nº ${w.pedidoVenda.number}, NF-e nº ${w.nfe.number} autorizada`);
  });

  it("compras: pedido aprovado pela política, recebimento conferido (estoque + conta a pagar)", async () => {
    const w = m();
    await savePolicy(w.adm, { name: "Homologação — aprovação automática", rules: { tiers: [{ above: 0, steps: [{ name: "Gestor", kind: "role", roleIds: [w.adm.user.roleId] }] }], distinctApprovers: false }, autoApproveBelow: 100_000_000, allowSelfApproval: true, expiredProposalAction: "allow", reviewOnRevision: "never" } as any);
    const prazo30 = w.prazos.find((t) => t.installments === 1 && t.firstDueDays === 30)!;
    w.pedidoCompra = await createOrder(w.adm, { supplierId: w.fornecedor.id, items: [{ skuId: w.sku1.id, qty: 5 * QTY, unitCost: DEF[k].produtos[0].custo - 200 }], paymentTermId: prazo30.id });
    await submitForApproval(w.adm, [w.pedidoCompra.id]);
    expect((await store.get("purchase_orders", w.pedidoCompra.id))!.status).toBe("approved");
    const r = await createManualReceipt(w.adm, { supplierId: w.fornecedor.id, orderIds: [w.pedidoCompra.id], nfeNumber: `${k === "A" ? 5501 : 7701}`, nfeSeries: "1", issueDate: today(), idemKey: `${k}-recebimento-1` });
    await updateReceipt(w.adm, r.id, { checkAll: true });
    w.recebimento = await confirmReceipt(w.adm, r.id);
    expect(w.recebimento.status).toBe("confirmed");
    expect((await availableMap(store, w.matriz.id, [w.sku1.id])).get(w.sku1.id)?.available).toBe(20 * QTY);
    const pagar = await listAll(store, "titles", { filters: [["eq", "originType", "purchase_receipt"], ["eq", "originId", r.id]] });
    expect(pagar).toHaveLength(1);
    ok("Compras — pedido aprovado, recebimento conferido, estoque e conta a pagar", `pedido nº ${w.pedidoCompra.number}, recebimento nº ${w.recebimento.number}`);
  });

  it("financeiro: conta a receber baixada no banco e conta a pagar autorizada com comprovante anexado", async () => {
    const w = m();
    const d = DEF[k];
    w.receber = await createManualTitle(w.adm, { kind: "receivable", partyType: "customer", partyId: w.cPJ.id, description: `Serviço de instalação — ${d.nome}`, issueDate: today(), competenceDate: today(), categoryId: w.categoriaReceita.id, installments: [{ dueDate: addDays(today(), 10), amount: 15000 }], idemKey: `${k}-receber-1` } as any);
    w.pagar = await createManualTitle(w.adm, { kind: "payable", partyType: "supplier", partyId: w.fornecedor.id, description: `Frete avulso — ${d.nome}`, issueDate: today(), competenceDate: today(), installments: [{ dueDate: addDays(today(), 5), amount: 8000 }], approved: true, idemKey: `${k}-pagar-1` } as any);
    w.parcelaReceber = (await listAll(store, "installments", { filters: [["eq", "titleId", w.receber.id]] }))[0];
    w.parcelaPagar = (await listAll(store, "installments", { filters: [["eq", "titleId", w.pagar.id]] }))[0];
    const saldo = (await store.get("financial_accounts", w.banco.id))!.balance;
    w.baixa = await settleInstallment(w.adm, { installmentId: w.parcelaReceber.id, date: today(), principal: 15000, accountId: w.banco.id, methodId: w.metodos.pix.id, idemKey: `${k}-baixa-1` });
    expect((await store.get("financial_accounts", w.banco.id))!.balance).toBe(saldo + 15000);
    w.arquivo = await saveFile(w.adm, { bucket: "attachments", name: `comprovante-${k}.pdf`, mime: "application/pdf", data: Buffer.from(`%PDF-1.4 comprovante de frete — ${d.nome}`), entityType: "title", entityId: w.pagar.id, kind: "attachment" });
    await addTitleAttachment(w.adm, w.pagar.id, { fileId: w.arquivo.id, name: `comprovante-${k}.pdf` } as any);
    expect((await readFile(w.adm, w.arquivo.id)).data.toString()).toContain(d.nome);
    ok("Financeiro — conta a receber baixada, conta a pagar autorizada, comprovante anexado", `receber nº ${w.receber.number}, pagar nº ${w.pagar.number}`);
  });

  it("notificação, integração de e-mail com credencial própria, tarefa e cópia de segurança da empresa", async () => {
    const w = m();
    const d = DEF[k];
    const n = await notify(w.adm.store, { companyId: w.company.id, type: "info", title: `Aviso de homologação — ${d.nome}`, body: `Somente para a equipe da ${d.nome}.`, audience: { userIds: [w.adminId] }, occurrenceKey: `homolog:${k}:aviso` });
    expect(n).toBe(1);
    w.notificacao = (await queryNotifications(w.adm, {}))[0];
    expect(w.notificacao.title).toContain(d.nome);
    w.integracao = await saveIntegration(w.adm, { kind: "email", branchId: null, provider: "resend", environment: "producao", config: { from: `${d.nome} <nao-responda@${k === "A" ? "alfa" : "bravo"}-homolog.example>` }, secretRefs: { apiKey: d.segredoEmail } });
    expect(w.integracao.secretRefs).toEqual({ apiKey: d.segredoEmail });
    // tarefa já vencida: a tentativa da outra empresa de executá-la pelo id é significativa (só a própria a executa)
    w.tarefa = (await enqueue(w.adm.store, { type: "fiscal.query", payload: { documentId: w.nfe.id, branchId: w.matriz.id }, dedupeKey: `homolog:${k}:consulta`, companyId: w.company.id }))!;
    expect(w.tarefa).toMatchObject({ companyId: w.company.id, status: "pending" });
    w.backup = await createBackup(w.adm, { kind: "manual", includeFiles: true, idemKey: `${k}-backup-1` });
    expect(w.backup.status).toBe("completed");
    ok("Notificação, integração de e-mail, tarefa agendada e cópia de segurança", `cópia nº ${w.backup.number} com ${w.backup.scope.rows} registros`);
  });

  it("comércio digital: loja publicada com produto e foto na vitrine", async () => {
    const w = m();
    const d = DEF[k];
    await createStore(w.adm, { name: d.loja });
    await saveLegalContact(w.adm, { companyName: d.empresa.razaoSocial, cnpj: d.empresa.cnpj, address: `${d.empresa.endereco.logradouro}, ${d.empresa.endereco.numero} — ${d.empresa.endereco.municipio}/${d.empresa.endereco.uf}`, email: d.empresa.email, phone: "1133330101" }, { whatsapp: "11999990101", email: d.empresa.email, phone: "1133330101", hours: "9h às 18h" });
    w.imagem = await uploadStoreImage(w.adm, { name: `foto-${k}.png`, data: PNG, purpose: "product" });
    await addToCatalog(w.adm, [w.p1.id]);
    const l = await saveListing(w.adm, w.p1.id, { title: d.produtos[0].nome, description: `Produto da vitrine da ${d.nome}.`, images: [w.imagem.id], featured: true, published: true, weightGrams: 900 } as any);
    w.slug1 = l.slug;
    w.loja = await publishStore(w.adm);
    expect(w.loja.status).toBe("published");
    const cat = await publicCatalog(store, w.loja);
    expect(cat.cards.map((c) => c.productId)).toEqual([w.p1.id]);
    ok("Comércio digital — loja publicada com produto e foto", `loja /${w.loja.slug}`);
  });
});

// ─── 3. usuário restrito: perfil e filial dentro da própria empresa ────────────────────────────────────────────

describe.each(["A", "B"] as const)("3. vendedor restrito da empresa %s (perfil e filial)", (k) => {
  const m = () => W[k];

  it("só alcança a própria empresa e a Matriz (a filial 02 não é selecionável)", async () => {
    const w = m();
    const other = W[k === "A" ? "B" : "A"];
    const u = (await store.get("users", w.vendedorId))!;
    const units = await accessibleUnits(store, u);
    expect(units.companies.map((c) => c.id)).toEqual([w.company.id]);
    expect(units.branches.map((b) => b.id)).toEqual([w.matriz.id]);
    expect(branchScopeOf(u, w.company.id)).toEqual([w.matriz.id]);
    await expect(ctxForCompany(w.vend, other.company.id)).rejects.toThrow(/acesso/);
  });

  it("não vê dados da filial 02 onde a filial restringe (detalhe da venda, listas de vendas, estoque, documentos fiscais e caixas)", async () => {
    const w = m();
    expect(await saleDetail(w.vend, w.vendaFilial.id)).toBeNull();
    expect(await saleDetail(w.vend, w.venda.id)).not.toBeNull();
    const vendas = await querySales(w.vend, { q: "", f: { filial: w.filial.id, ...PERIODO } } as any);
    expect(vendas.length).toBeGreaterThan(0);
    expect(vendas.every((v: any) => v.branchId === w.matriz.id)).toBe(true);
    const saldos = await queryBalances(w.vend, { q: "", f: { filial: w.filial.id } } as any);
    expect(saldos.length).toBeGreaterThan(0);
    expect(saldos.every((b: any) => b.branchId === w.matriz.id)).toBe(true);
    const nfceFilial = (await store.get("sales", w.vendaFilial.id))!.fiscalDocumentId;
    const nfce = await queryDocuments(w.vend, "nfce", { q: "", f: { branch: w.filial.id } } as any);
    expect(nfce.map((d: any) => d.id)).toContain(w.nfce.id);
    expect(nfce.map((d: any) => d.id)).not.toContain(nfceFilial);
    const caixas = await querySessions(w.vend, { q: "", f: { filial: w.filial.id } } as any);
    expect(caixas.map((c: any) => c.id)).toContain(w.caixa1.id);
    expect(caixas.map((c: any) => c.id)).not.toContain(w.caixa2.id);
    // a filial 02 também não opera pelo vendedor: o caixa da filial é recusado no contexto da Matriz
    await expect(openSession(w.vend, { terminalId: w.t2.id, openingFund: 0 })).rejects.toThrow(/outra filial/);
  });

  it("operações fora do perfil são recusadas (no domínio e nas mesmas regras que as rotas e ações aplicam)", async () => {
    const w = m();
    const v = w.vend;
    const recusas: Array<[string, () => Promise<unknown>]> = [
      ["cadastrar produto", () => createProduct(v, { type: "product", name: "Produto indevido", unitCode: "UN" })],
      ["ajustar estoque", () => adjustStock(v, { warehouseId: w.matriz.defaultWarehouseId, skuId: w.sku1.id, type: "adjust_in", qty: QTY, reason: "indevido", idemKey: `${k}-vend-ajuste` })],
      ["pedido de compra", () => createOrder(v, { supplierId: w.fornecedor.id, items: [{ skuId: w.sku1.id, qty: QTY, unitCost: 100 }] })],
      ["transferência entre filiais", () => createTransfer(v, { toBranchId: w.filial.id, items: [{ skuId: w.sku1.id, qty: QTY }] } as any)],
      ["cancelar venda (sem 'Cancelar venda')", () => cancelSale(v, w.venda.id, "indevido")],
      ["configurar fiscal", () => saveFiscalConfig(v, null, { contingency: true })],
      ["configurar integração", () => saveIntegration(v, { kind: "email", branchId: null, provider: "resend", secretRefs: { apiKey: "RESEND_API_KEY_VENDEDOR" } })],
      ["cópia de segurança", () => createBackup(v, { kind: "manual", includeFiles: false, idemKey: `${k}-vend-backup` })],
      ["criar usuário", () => createUser(v, { name: "Indevido", email: `indevido-${k}@homolog.example`, companyIds: [w.company.id], branchIds: [], mode: "password", password: SENHA } as any)],
      ["criar perfil", () => createRole(v, { name: "Perfil indevido", permissions: { admin: { view: true } }, actions: [], discountLimitBps: 0 })],
      ["criar filial", () => createBranch(v, w.company.id, { code: "09", name: "Filial indevida" } as any)],
      ["cadastrar terminal", () => createTerminal(v, { branchId: w.matriz.id, code: "CX99", name: "Indevido", printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false })],
      ["pedido de venda (sem 'Pedidos de venda')", () => createSalesDocument(v, "order", { customerId: w.cPF.id, items: [{ skuId: w.sku1.id, qty: QTY }] }, { idemKey: `${k}-vend-pedido` })],
    ];
    // todas recusadas pela permissão do perfil (não por validação de dados)
    for (const [nome, fn] of recusas) await expect(fn(), nome).rejects.toMatchObject({ name: "PermissionError", code: "forbidden" });
    // ações/rotas sem verificação no domínio: o perfil não passa na regra de entrada (runAction e /api/export)
    const regras: Array<[ModuleKey, "view" | "create" | "edit" | "delete"]> = [["finance", "view"], ["finance", "create"], ["purchases", "view"], ["stock", "view"], ["fiscal", "view"], ["reports", "view"], ["admin", "view"], ["suppliers", "view"]];
    for (const [mod, op] of regras) expect(can(v.user, mod, op), `${mod}/${op}`).toBe(false);
    for (const a of ["finance.settle", "finance.reverse", "finance.approve_payable", "data.export", "sale.cancel", "admin.backup", "admin.users", "fiscal.issue"] as const) expect(canDo(v.user, a), a).toBe(false);
    // download do comprovante financeiro (regra da rota /api/files/[id])
    expect(fileAccessDenial(v.user, w.arquivo)).toMatch(/Sem permissão/);
    expect(fileAccessDenial(w.adm.user, w.arquivo)).toBeNull();
    // e o que o perfil permite continua funcionando
    expect(can(v.user, "pdv", "create")).toBe(true);
    expect(canDo(v.user, "sale.return")).toBe(true);
  });
});

// ─── 4. matriz de acesso cruzado ─────────────────────────────────────────────────────────────────────────────

const fotos: Partial<Record<Chave, Map<string, string>>> = {};
function fotoAlvo(k: Chave) {
  return fotos[k]!;
}

/** Chaves de todas as exportações registradas (lidas do código: uma exportação nova entra sozinha na matriz). */
function chavesExportacao(): string[] {
  const dir = path.join(process.cwd(), "src/exports");
  const keys = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/defineExport\(\s*"([^"]+)"/g)) keys.add(m[1]);
    if (/defineExport\(`fiscal-\$\{model\}`/.test(src)) for (const model of ["nfe", "nfce", "nfse"]) keys.add(`fiscal-${model}`);
  }
  return [...keys].sort();
}

function linhas(a: Chave, b: Chave): Linha[] {
  const A = () => W[a];
  const B = () => W[b];
  const out: Linha[] = [];
  const add = (superficie: string, tentativa: string, esperado: Esperado, run: () => Promise<unknown>, confere?: Linha["confere"]) => out.push({ superficie, tentativa, esperado, run, confere });
  const nomeA = DEF[a].nome;
  const nomeB = DEF[b].nome;
  const temA = (v: any) => expect(vazamentos(a, serializa(v), false).length, `deveria trazer dados da ${nomeA}`).toBeGreaterThan(0);
  const S = () => A().adm.store;

  // ── Store da sessão: leitura por id ──
  const porId: Array<[string, (w: Mundo) => string[]]> = [
    ["companies", (w) => [w.company.id]],
    ["branches", (w) => [w.matriz.id, w.filial.id]],
    ["warehouses", (w) => [w.matriz.defaultWarehouseId, w.filial.defaultWarehouseId]],
    ["terminals", (w) => [w.t1.id, w.t2.id]],
    ["users", (w) => [w.adminId, w.vendedorId]],
    ["roles", (w) => [w.perfilVendedor.id, w.adm.user.roleId!]],
    ["products", (w) => [w.p1.id, w.p2.id]],
    ["skus", (w) => [w.sku1.id, w.sku2.id]],
    ["customers", (w) => [w.cPF.id, w.cPJ.id, w.cComum.id]],
    ["suppliers", (w) => [w.fornecedor.id]],
    ["cash_sessions", (w) => [w.caixa1.id, w.caixa2.id]],
    ["sales", (w) => [w.venda.id, w.vendaFilial.id]],
    ["returns", (w) => [w.devolucao.id]],
    ["sales_documents", (w) => [w.pedidoVenda.id]],
    ["purchase_orders", (w) => [w.pedidoCompra.id]],
    ["receipts", (w) => [w.recebimento.id]],
    ["titles", (w) => [w.receber.id, w.pagar.id]],
    ["installments", (w) => [w.parcelaReceber.id, w.parcelaPagar.id]],
    ["settlements", (w) => [w.baixa.id]],
    ["financial_accounts", (w) => [w.banco.id]],
    ["fiscal_documents", (w) => [w.nfce.id, w.nfe.id]],
    ["files", (w) => [w.arquivo.id, w.imagem.id, w.backup.fileId]],
    ["notifications", (w) => [w.notificacao.id]],
    ["integrations", (w) => [w.integracao.id]],
    ["jobs", (w) => [w.tarefa.id]],
    ["backups", (w) => [w.backup.id]],
    ["stores", (w) => [w.loja.id]],
    ["tax_groups", (w) => [w.grupo.id]],
  ];
  for (const [col, ids] of porId)
    add("Store da sessão — leitura por id", `ler ${col} da ${nomeB} pelo id`, "inexistente", async () => {
      const got = await Promise.all(ids(B()).map((id) => S().get(col, id)));
      return got.every((x) => x == null) ? null : got;
    });
  add("Store da sessão — leitura por id", `ler, um a um, todos os registros da ${nomeB} (fotografia completa) pelo id`, "inexistente", async () => {
    const found: string[] = [];
    for (const key of fotoAlvo(b).keys()) {
      const [col, id] = key.split("/");
      if (col === "counters") continue;
      if (await S().get(col, id)) found.push(key);
    }
    return found.length ? found : null;
  });

  // ── Store da sessão: alteração, exclusão, incremento e gravação com outra empresa ──
  const G0 = "Store da sessão — gravação por id";
  add(G0, `alterar produto da ${nomeB} pelo id`, "recusa", () => S().update("products", B().p1.id, { name: "Alterado pela outra empresa" }));
  add(G0, `alterar cliente da ${nomeB} pelo id`, "recusa", () => S().update("customers", B().cPF.id, { creditLimit: 99999999 }));
  add(G0, `alterar título da ${nomeB} pelo id`, "recusa", () => S().update("titles", B().receber.id, { status: "cancelled" }));
  add(G0, `alterar o cadastro da empresa ${nomeB}`, "recusa", () => S().update("companies", B().company.id, { name: "Tomada" }));
  add(G0, `alterar usuário administrador da ${nomeB}`, "recusa", () => S().update("users", B().adminId, { status: "suspended" }));
  add(G0, `mover produto próprio para a ${nomeB} (companyId)`, "recusa", () => S().update("products", A().p2.id, { companyId: B().company.id }));
  add(G0, "tornar produto próprio global (companyId nulo)", "recusa", () => S().update("products", A().p2.id, { companyId: null }));
  add(G0, `criar cliente com companyId da ${nomeB}`, "recusa", () => S().create("customers", { companyId: B().company.id, personType: "PF", name: "Inserido pela outra empresa" }));
  add(G0, `criar usuário vinculado à ${nomeB}`, "recusa", () => S().create("users", { name: "Intruso", email: `intruso-${a}@homolog.example`, status: "active", companyIds: [B().company.id], branchIds: [] }));
  add(G0, "criar empresa a partir de uma contratante", "recusa", () => S().create("companies", { name: "Empresa paralela", status: "active" }));
  add(G0, `excluir cliente da ${nomeB} pelo id`, "inexistente", () => S().delete("customers", B().cComum.id));
  add(G0, `excluir produto da ${nomeB} pelo id`, "inexistente", () => S().delete("products", B().p2.id));
  add(G0, `excluir arquivo da ${nomeB} pelo id`, "inexistente", () => S().delete("files", B().arquivo.id));
  add(G0, `incrementar saldo da conta bancária da ${nomeB}`, "recusa", () => S().increment("financial_accounts", B().banco.id, "balance", 1_000_000));
  add(G0, `incrementar estoque físico da ${nomeB}`, "recusa", () => S().increment("stock_balances", detId("bal", B().matriz.defaultWarehouseId, B().sku1.id), "physical", 1000 * QTY));
  add(G0, "tabela da plataforma (tenant_provisionings) a partir de uma contratante", "vazio", () => S().list("tenant_provisionings", {}));

  // ── Store da sessão: consultas com filtro apontando para a outra empresa (corpo das rotas de busca) ──
  const C = "Store da sessão — consultas e buscas";
  add(C, `listar clientes com filtro companyId = ${nomeB}`, "vazio", () => S().list("customers", { filters: [["eq", "companyId", B().company.id]] }));
  add(C, `listar produtos com filtro companyId ≠ ${nomeA}`, "vazio", () => S().list("products", { filters: [["ne", "companyId", A().company.id]] }));
  add(C, `listar SKUs pelos ids da ${nomeB} (consulta de /api/pdv/products?ids=)`, "vazio", () => S().list("skus", { filters: [["eq", "id", [B().sku1.id, B().sku2.id]]] }));
  add(C, `buscar cliente pelo id da ${nomeB} (consulta de /api/pdv/customers?id=)`, "inexistente", async () => {
    const c = await S().get("customers", B().cPF.id);
    return c && c.companyId === A().company.id ? c : null;
  });
  add(C, `pesquisa global pelo nome do cliente da ${nomeB} (consultas de /api/search)`, "vazio", async () => {
    const q = DEF[b].clientePF.nome.split(" ")[2].toLowerCase();
    const cid = A().company.id;
    return [
      (await S().list("customers", { filters: [["eq", "companyId", cid], ["contains", "searchText", q]] })).items,
      (await S().list("suppliers", { filters: [["eq", "companyId", cid], ["contains", "searchText", q]] })).items,
      (await S().list("skus", { filters: [["eq", "companyId", cid], ["contains", "searchText", q]] })).items,
    ];
  });
  add(C, `código de barras presente nas duas empresas devolve só o SKU da ${nomeA}`, "somente a própria", () => S().list("skus", { filters: [["eq", "barcode", GTIN_COMUM]] }), (v) => {
    expect(v.items.map((x: Doc) => x.id)).toEqual([A().sku1.id]);
  });
  add(C, `CPF presente nas duas empresas devolve só o cliente da ${nomeA}`, "somente a própria", () => findCustomerByDoc(S(), A().company.id, CPF_COMUM), (v) => expect(v.id).toBe(A().cComum.id));
  add(C, `CPF consultado com a empresa ${nomeB} no parâmetro`, "inexistente", () => findCustomerByDoc(S(), B().company.id, CPF_COMUM));
  add(C, "listar usuários (identidade global) devolve só os vinculados", "somente a própria", () => listAll(S(), "users"), (v) => {
    expect(v.map((u: Doc) => u.id).sort()).toEqual([A().adminId, A().vendedorId].sort());
  });
  add(C, "listar empresas devolve só a própria", "somente a própria", () => listAll(S(), "companies"), (v) => expect(v.map((c: Doc) => c.id)).toEqual([A().company.id]));
  add(C, `numerador próprio não consome a sequência de vendas da ${nomeB}`, "somente a própria", async () => {
    const before = (await unscoped(store).get("counters", detId("counter", `sale:${B().company.id}`)))!.value;
    const n = await nextNumber(S(), `homolog:${a}:sequencia`);
    const after = (await unscoped(store).get("counters", detId("counter", `sale:${B().company.id}`)))!.value;
    return { n, mesmo: before === after };
  }, (v) => expect(v.mesmo).toBe(true));

  // ── leitura por id nas funções das telas e serviços ──
  const D = "Telas e serviços — leitura por id";
  add(D, `detalhe da venda da ${nomeB}`, "inexistente", () => saleDetail(A().adm, B().venda.id));
  add(D, `detalhe do título da ${nomeB}`, "inexistente", () => titleDetail(A().adm, B().receber.id));
  add(D, `recebimento de compra da ${nomeB}`, "inexistente", () => getReceipt(A().adm, B().recebimento.id));
  add(D, `pedido de compra da ${nomeB}`, "inexistente", () => getOrder(A().adm, B().pedidoCompra.id));
  add(D, `NF-e da ${nomeB} (consulta ao provedor)`, "inexistente", () => queryDocument(A().adm, B().nfe.id));
  add(D, `resumo do caixa da ${nomeB}`, "inexistente", () => sessionSummary(A().adm, B().caixa1.id));
  add(D, `resumo do cliente da ${nomeB}`, "vazio", async () => {
    const s = await customerSummary(A().adm, B().cPF.id);
    return [s.sales, s.documents];
  });
  add(D, `resumo do fornecedor da ${nomeB}`, "vazio", async () => {
    const s: any = await supplierSummary(A().adm, B().fornecedor.id);
    return [s.orders ?? [], s.receipts ?? [], s.products ?? []];
  });
  add(D, `itens devolvíveis da venda da ${nomeB}`, "vazio", () => returnableItems(S(), B().venda.id));
  add(D, `itens do pedido de venda da ${nomeB}`, "vazio", () => documentItems(S(), B().pedidoVenda.id));
  add(D, `configuração fiscal da ${nomeB} pelo Store da sessão`, "inexistente", () => getFiscalConfig(S(), B().company.id, B().matriz.id));
  add(D, `numeração fiscal da filial da ${nomeB} (numerador do RPS por filial)`, "recusa", () => numberingStatus(A().adm, B().matriz.id, null));
  add(D, `linha do tempo (auditoria) da venda da ${nomeB}`, "vazio", async () => [
    await listAll(S(), "audit_logs", { filters: [["eq", "entityType", "sale"], ["eq", "entityId", B().venda.id]] }),
    await listAll(S(), "audit_logs", { filters: [["contains", "related", `sale:${B().venda.id}`]] }),
  ]);
  add(D, `disponível em estoque dos SKUs da ${nomeB}`, "somente a própria", () => availableMap(S(), B().matriz.id, [B().sku1.id]), (v) => expect([...v.values()].every((x: any) => !x.physical && !x.available)).toBe(true));
  add(D, `preço de venda do SKU da ${nomeB} pela tabela da ${nomeA}`, "somente a própria", () => resolvePrices(S(), { companyId: A().company.id, branchId: A().matriz.id, items: [{ skuId: B().sku1.id, qty: QTY }] }), (v) => expect(v.every((x: any) => !x.price)).toBe(true));
  add(D, `vendedores da empresa ${nomeB} pelo Store da sessão`, "vazio", () => listSellers(S(), B().company.id));

  // ── alteração e exclusão de registros da outra empresa pelas funções de domínio ──
  const G = "Funções de domínio — alterar ou excluir registro da outra empresa";
  add(G, `alterar produto da ${nomeB}`, "recusa", () => updateProduct(A().adm, B().p1.id, { name: "Alterado" }));
  add(G, `inativar produto da ${nomeB}`, "recusa", () => setProductStatus(A().adm, B().p1.id, false));
  add(G, `excluir produto da ${nomeB}`, "recusa", () => deleteProduct(A().adm, B().p2.id));
  add(G, `alterar cliente da ${nomeB}`, "recusa", () => updateCustomer(A().adm, B().cPF.id, { personType: "PF", doc: DEF[b].clientePF.cpf, name: "Alterado" }));
  add(G, `inativar cliente da ${nomeB}`, "recusa", () => setCustomerStatus(A().adm, B().cPF.id, "inactive"));
  add(G, `excluir cliente da ${nomeB}`, "recusa", () => deleteCustomer(A().adm, B().cComum.id));
  add(G, `alterar fornecedor da ${nomeB}`, "recusa", () => updateSupplier(A().adm, B().fornecedor.id, { personType: "PJ", doc: DEF[b].fornecedor.cnpj, name: "Alterado" }));
  add(G, `bloquear fornecedor da ${nomeB}`, "recusa", () => setSupplierStatus(A().adm, B().fornecedor.id, "blocked", "teste"));
  add(G, `excluir fornecedor da ${nomeB}`, "recusa", () => deleteSupplier(A().adm, B().fornecedor.id));
  add(G, `cancelar venda da ${nomeB}`, "recusa", () => cancelSale(A().adm, B().venda.id, "tentativa da outra empresa"));
  add(G, `devolver item da venda da ${nomeB}`, "recusa", async () => {
    const it = (await listAll(unscoped(store), "sale_items", { filters: [["eq", "saleId", B().venda.id]] }))[0];
    return processReturn(A().adm, { saleId: B().venda.id, idemKey: `${a}-cruzada-dev`, reason: "x", compensation: "store_credit", items: [{ saleItemId: it.id, qty: QTY, condition: "resellable" }] });
  });
  add(G, `cancelar título da ${nomeB}`, "recusa", () => cancelTitle(A().adm, B().pagar.id, "tentativa da outra empresa"));
  add(G, `editar título da ${nomeB}`, "recusa", () => updateTitle(A().adm, B().pagar.id, { description: "Alterado" }));
  add(G, `baixar parcela da ${nomeB} na conta da ${nomeA}`, "recusa", () => settleInstallment(A().adm, { installmentId: B().parcelaPagar.id, date: today(), principal: 8000, accountId: A().banco.id, idemKey: `${a}-cruzada-baixa` }));
  add(G, `estornar baixa da ${nomeB}`, "recusa", () => reverseSettlement(A().adm, B().baixa.id, "tentativa"));
  add(G, `autorizar conta a pagar da ${nomeB}`, "recusa", () => approvePayable(A().adm, B().pagar.id));
  add(G, `anexar arquivo ao título da ${nomeB}`, "recusa", () => addTitleAttachment(A().adm, B().pagar.id, { fileId: A().arquivo.id, name: "x.pdf" } as any));
  add(G, `cancelar pedido de compra da ${nomeB}`, "recusa", () => cancelPurchaseOrder(A().adm, B().pedidoCompra.id, "tentativa"));
  add(G, `cancelar recebimento da ${nomeB}`, "recusa", () => cancelReceipt(A().adm, B().recebimento.id, "tentativa"));
  add(G, `alterar pedido de venda da ${nomeB}`, "recusa", () => updateSalesDocument(A().adm, B().pedidoVenda.id, { customerId: B().cPJ.id, items: [{ skuId: B().sku1.id, qty: QTY }] }));
  add(G, `cancelar pedido de venda da ${nomeB}`, "recusa", () => cancelSalesOrder(A().adm, B().pedidoVenda.id, "tentativa"));
  add(G, `cancelar NF-e da ${nomeB}`, "recusa", () => cancelDocument(A().adm, B().nfe.id, "Cancelamento indevido pela outra empresa"));
  add(G, `transmitir NFC-e da ${nomeB}`, "recusa", () => transmitDocument(A().adm, B().nfce.id));
  add(G, `ajustar estoque da ${nomeB}`, "recusa", () => adjustStock(A().adm, { warehouseId: B().matriz.defaultWarehouseId, skuId: B().sku1.id, type: "adjust_out", qty: QTY, reason: "tentativa", idemKey: `${a}-cruzada-ajuste` }));
  add(G, `movimentar o caixa da ${nomeB}`, "recusa", () => addCashMovement(A().adm, { sessionId: B().caixa1.id, type: "withdrawal", amount: 1000, reason: "tentativa", idemKey: `${a}-cruzada-sangria` }));
  add(G, `fechar o caixa da ${nomeB}`, "recusa", () => closeSession(A().adm, { sessionId: B().caixa1.id, counted: { cash: 0 }, justification: "tentativa", idemKey: `${a}-cruzada-fecha` }));
  add(G, `alterar cadastro da empresa ${nomeB}`, "recusa", () => updateCompany(A().adm, B().company.id, { name: "Tomada" } as any));
  add(G, `inativar a empresa ${nomeB}`, "recusa", () => setCompanyStatus(A().adm, B().company.id, "inactive"));
  add(G, `alterar filial da ${nomeB}`, "recusa", () => updateBranch(A().adm, B().filial.id, { code: "02", name: "Tomada" } as any));
  add(G, `inativar filial da ${nomeB}`, "recusa", () => setBranchStatus(A().adm, B().filial.id, "inactive"));
  add(G, `alterar terminal da ${nomeB}`, "recusa", () => updateTerminal(A().adm, B().t1.id, { branchId: B().matriz.id, code: "CX01", name: "Tomado", printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false }));
  add(G, `alterar perfil da ${nomeB}`, "recusa", () => updateRole(A().adm, B().perfilVendedor.id, { name: "Tomado", permissions: {}, actions: [], discountLimitBps: 0 }));
  add(G, `alterar usuário da ${nomeB}`, "recusa", () => updateUser(A().adm, B().vendedorId, { name: "Tomado", email: DEF[b].vendedor.email, companyIds: [B().company.id], branchIds: [] }));
  add(G, `suspender usuário da ${nomeB}`, "recusa", () => setUserStatus(A().adm, B().adminId, "suspended", "tentativa"));
  add(G, `editar anúncio da vitrine da ${nomeB}`, "recusa", () => saveListing(A().adm, B().p1.id, { title: "Tomado", description: "x", images: [], featured: false, published: true } as any));
  add(G, `marcar como lida notificação da ${nomeB}`, "recusa", () => markNotifications(A().adm, [B().notificacao.id], true));
  add(G, `arquivar notificação da ${nomeB}`, "recusa", () => archiveNotifications(A().adm, [B().notificacao.id]));

  // ── criação na própria empresa referenciando registros da outra ──
  const R = "Criação na própria empresa com referência à outra";
  const unidade2 = () => DEF[a].produtos[1].preco;
  add(R, `venda no PDV com produto da ${nomeB}`, "recusa", () => finalizeSale(A().vend, { idemKey: `${a}-ref-sku`, terminalId: A().t1.id, items: [{ skuId: B().sku1.id, qty: QTY }], payments: [{ methodId: A().metodos.cash.id, amount: 100000, received: 100000 }] }));
  add(R, `venda no PDV para cliente da ${nomeB}`, "recusa", () => finalizeSale(A().vend, { idemKey: `${a}-ref-cliente`, terminalId: A().t1.id, customerId: B().cPF.id, items: [{ skuId: A().sku2.id, qty: QTY }], payments: [{ methodId: A().metodos.cash.id, amount: unidade2(), received: unidade2() }] }));
  add(R, `venda no terminal da ${nomeB}`, "recusa", () => finalizeSale(A().vend, { idemKey: `${a}-ref-terminal`, terminalId: B().t1.id, items: [{ skuId: A().sku2.id, qty: QTY }], payments: [{ methodId: A().metodos.cash.id, amount: unidade2(), received: unidade2() }] }));
  add(R, `venda paga com meio de pagamento da ${nomeB}`, "recusa", () => finalizeSale(A().vend, { idemKey: `${a}-ref-meio`, terminalId: A().t1.id, items: [{ skuId: A().sku2.id, qty: QTY }], payments: [{ methodId: B().metodos.cash.id, amount: unidade2(), received: unidade2() }] }));
  add(R, `abrir caixa no terminal da ${nomeB}`, "recusa", () => openSession(A().adm, { terminalId: B().t1.id, openingFund: 0 }));
  add(R, `pedido de venda para cliente da ${nomeB}`, "recusa", () => createSalesDocument(A().adm, "order", { customerId: B().cPJ.id, items: [{ skuId: A().sku1.id, qty: QTY }] }, { idemKey: `${a}-ref-pedido-cliente` }));
  add(R, `pedido de venda com produto da ${nomeB}`, "recusa", () => createSalesDocument(A().adm, "order", { customerId: A().cPJ.id, items: [{ skuId: B().sku1.id, qty: QTY }] }, { idemKey: `${a}-ref-pedido-sku` }));
  add(R, `pedido de compra com fornecedor da ${nomeB}`, "recusa", () => createOrder(A().adm, { supplierId: B().fornecedor.id, items: [{ skuId: A().sku1.id, qty: QTY, unitCost: 100 }] }));
  add(R, `pedido de compra com produto da ${nomeB}`, "recusa", () => createOrder(A().adm, { supplierId: A().fornecedor.id, items: [{ skuId: B().sku1.id, qty: QTY, unitCost: 100 }] }));
  add(R, `pedido de compra para depósito da ${nomeB}`, "recusa", () => createOrder(A().adm, { supplierId: A().fornecedor.id, warehouseId: B().matriz.defaultWarehouseId, items: [{ skuId: A().sku1.id, qty: QTY, unitCost: 100 }] }));
  add(R, `recebimento vinculado a pedido de compra da ${nomeB}`, "recusa", () => createManualReceipt(A().adm, { supplierId: A().fornecedor.id, orderIds: [B().pedidoCompra.id], idemKey: `${a}-ref-receb` }));
  add(R, `recebimento sem pedido com fornecedor da ${nomeB}`, "recusa", () => createManualReceipt(A().adm, { supplierId: B().fornecedor.id, orderIds: [], items: [{ skuId: A().sku1.id, qty: QTY, unitCost: 100 }] as any, idemKey: `${a}-ref-receb-forn` }));
  add(R, `conta a receber para cliente da ${nomeB}`, "recusa", () => createManualTitle(A().adm, { kind: "receivable", partyType: "customer", partyId: B().cPF.id, description: "x", issueDate: today(), competenceDate: today(), installments: [{ dueDate: today(), amount: 100 }], idemKey: `${a}-ref-titulo` } as any));
  add(R, `conta a receber com categoria financeira da ${nomeB}`, "recusa", () => createManualTitle(A().adm, { kind: "receivable", partyType: "other", partyName: "Avulso", description: "x", issueDate: today(), competenceDate: today(), categoryId: B().categoriaReceita.id, installments: [{ dueDate: today(), amount: 100 }], idemKey: `${a}-ref-categoria` } as any));
  add(R, `baixa de parcela própria na conta bancária da ${nomeB}`, "recusa", () => settleInstallment(A().adm, { installmentId: A().parcelaPagar.id, date: today(), principal: 8000, accountId: B().banco.id, idemKey: `${a}-ref-conta` }));
  add(R, `saldo inicial no depósito da ${nomeB}`, "recusa", () => postInitialBalance(A().adm, { warehouseId: B().matriz.defaultWarehouseId, skuId: A().sku2.id, qty: QTY }));
  add(R, `ajuste de estoque próprio com produto da ${nomeB}`, "recusa", () => adjustStock(A().adm, { warehouseId: A().matriz.defaultWarehouseId, skuId: B().sku2.id, type: "adjust_in", qty: QTY, reason: "x", idemKey: `${a}-ref-ajuste` }));
  add(R, `transferência de estoque para filial da ${nomeB}`, "recusa", () => createTransfer(A().adm, { toBranchId: B().matriz.id, items: [{ skuId: A().sku1.id, qty: QTY }] } as any));
  add(R, `terminal na filial da ${nomeB}`, "recusa", () => createTerminal(A().adm, { branchId: B().matriz.id, code: "CX77", name: "Intruso", printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false }));
  add(R, `terminal próprio com depósito da ${nomeB}`, "recusa", () => createTerminal(A().adm, { branchId: A().matriz.id, code: "CX78", name: "Intruso", printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge", tefProvider: "manual_pos", allowNegativeStock: false, defaultWarehouseId: B().matriz.defaultWarehouseId }));
  add(R, `depósito na filial da ${nomeB}`, "recusa", () => createWarehouse(A().adm, B().matriz.id, { code: "INTR", name: "Intruso", kind: "available" } as any));
  add(R, `filial nova dentro da empresa ${nomeB}`, "recusa", () => createBranch(A().adm, B().company.id, { code: "09", name: "Intrusa" } as any));
  add(R, `produto com grupo tributário da ${nomeB}`, "recusa", () => createProduct(A().adm, { type: "product", name: "Produto com referência cruzada", unitCode: "UN", taxGroupId: B().grupo.id }));
  add(R, `produto com fornecedor da ${nomeB}`, "recusa", () => createProduct(A().adm, { type: "product", name: "Produto com fornecedor cruzado", unitCode: "UN", supplierId: B().fornecedor.id }));
  add(R, `preço próprio para SKU da ${nomeB}`, "recusa", () => savePrice(A().adm, { priceTableId: A().matriz.defaultPriceTableId, skuId: B().sku1.id, price: 1 } as any));
  add(R, `usuário vinculado também à ${nomeB}`, "recusa", () => createUser(A().adm, { name: "Duplo", email: `duplo-${a}@homolog.example`, roleId: A().perfilVendedor.id, companyIds: [A().company.id, B().company.id], branchIds: [], mode: "password", password: SENHA } as any));
  add(R, `usuário com perfil da ${nomeB}`, "recusa", () => createUser(A().adm, { name: "Perfil cruzado", email: `perfil-${a}@homolog.example`, roleId: B().perfilVendedor.id, companyIds: [A().company.id], branchIds: [], mode: "password", password: SENHA } as any));
  add(R, `notificação gravada na ${nomeB}`, "recusa", () => notify(S(), { companyId: B().company.id, type: "info", title: "Intrusa", audience: { all: true } }));
  add(R, `tarefa enfileirada na ${nomeB}`, "recusa", () => enqueue(S(), { type: "fiscal.query", payload: { documentId: B().nfe.id }, dedupeKey: `homolog:${a}:intrusa`, companyId: B().company.id }));
  add(R, `catálogo da loja com produto da ${nomeB}`, "vazio", async () => ((await addToCatalog(A().adm, [B().p1.id])) === 0 ? null : "incluído"));
  add(R, `anúncio próprio com foto da ${nomeB}`, "recusa", () => saveListing(A().adm, A().p1.id, { title: DEF[a].produtos[0].nome, description: "x", images: [B().imagem.id], featured: false, published: true } as any));
  add(R, `numeração fiscal ajustada na filial da ${nomeB}`, "recusa", () => setNextNumber(A().adm, B().matriz.id, "nfse", "1", 900));
  add(R, `meta de vendas para a filial da ${nomeB}`, "recusa", () => createGoal(A().adm, { branchId: B().matriz.id, period: today().slice(0, 7), metric: "revenue", target: 100000 }));

  // ── seletores e listas das telas ──
  const L = "Seletores e listas das telas";
  const seletores: Record<string, () => Promise<unknown>> = {
    clientes: () => lookups.customers(A().adm),
    fornecedores: () => lookups.suppliers(A().adm),
    filiais: () => lookups.branches(A().adm),
    depósitos: () => lookups.warehouses(A().adm),
    terminais: () => lookups.terminals(A().adm),
    usuários: () => lookups.users(A().adm),
    vendedores: () => lookups.sellers(A().adm),
    perfis: () => lookups.roles(A().adm),
    contas: () => lookups.accounts(A().adm),
    "meios de pagamento": () => lookups.paymentMethods(A().adm),
    "grupos tributários": () => lookups.taxGroups(A().adm),
    "nomes de usuários": () => nameMap(A().adm, "users"),
  };
  for (const [nome, fn] of Object.entries(seletores)) add(L, `seletor de ${nome}`, "somente a própria", fn);
  add(L, `depósitos da filial da ${nomeB} no seletor`, "vazio", () => lookups.warehouses(A().adm, B().matriz.id));
  add(L, `terminais da filial da ${nomeB} no seletor`, "vazio", () => lookups.terminals(A().adm, B().matriz.id));
  add(L, "lista de clientes", "somente a própria", () => queryCustomers(A().adm, { q: "", f: {} } as any), temA);
  add(L, `lista de clientes buscando o nome da ${nomeB}`, "vazio", async () => {
    const r: any = await queryCustomers(A().adm, { q: DEF[b].clientePF.nome, f: {} } as any);
    return r.rows ?? r;
  });
  add(L, "lista de clientes buscando o CPF presente nas duas empresas", "somente a própria", () => queryCustomers(A().adm, { q: CPF_COMUM, f: {} } as any), (v) => expect(v.map((c: Doc) => c.id)).toEqual([A().cComum.id]));
  add(L, "lista de produtos", "somente a própria", () => queryProducts(A().adm, { q: "", f: {} } as any), temA);
  add(L, "lista de fornecedores", "somente a própria", () => querySuppliers(A().adm, { q: "", f: {} } as any), temA);
  add(L, `vendas com filtro de filial da ${nomeB} (consolidado)`, "vazio", () => querySales(A().admCons, { q: "", f: { filial: B().matriz.id, ...PERIODO } } as any));
  add(L, `vendas filtradas pelo cliente da ${nomeB}`, "vazio", () => querySales(A().admCons, { q: "", f: { cliente: B().cPF.id, ...PERIODO } } as any));
  add(L, "devoluções", "somente a própria", () => queryReturns(A().admCons, { q: "", f: PERIODO } as any));
  add(L, `contas a receber com filtro de filial da ${nomeB}`, "vazio", async () => {
    const r: any = await queryInstallments(A().admCons, "receivable", { q: "", f: { branch: B().matriz.id } } as any);
    return r.rows ?? r;
  });
  add(L, `saldos de estoque com filtro de filial da ${nomeB}`, "vazio", () => queryBalances(A().admCons, { q: "", f: { filial: B().matriz.id } } as any));
  add(L, `movimentos de estoque com filtro de SKU da ${nomeB}`, "vazio", async () => {
    const r: any = await queryMovements(A().admCons, { q: "", f: { sku: B().sku1.id, ...PERIODO } } as any);
    return r.rows ?? r;
  });
  add(L, `NFC-e com filtro de filial da ${nomeB}`, "vazio", () => queryDocuments(A().admCons, "nfce", { q: "", f: { branch: B().matriz.id } } as any));
  add(L, `caixas com filtro de filial da ${nomeB}`, "vazio", () => querySessions(A().admCons, { q: "", f: { filial: B().matriz.id } } as any));
  add(L, "pedidos de compra", "somente a própria", () => queryOrders(A().admCons, { q: "", f: {} } as any));

  // ── relatórios e painel ──
  const P = "Relatórios gerenciais, curva ABC e painel";
  const escopo = (companyId: string, branchIds: string[] | null = null) => ({ companyId, branchIds, from: PERIODO.de, to: PERIODO.ate });
  add(P, "relatório gerencial da própria empresa", "somente a própria", () => managerialReport(S(), escopo(A().company.id), { compare: false }), (v) => expect(v.totals.salesCount).toBeGreaterThan(0));
  add(P, `relatório gerencial com a empresa ${nomeB} no escopo`, "somente a própria", () => managerialReport(S(), escopo(B().company.id), { compare: false }), (v) => {
    expect(v.totals.salesCount).toBe(0);
    expect(v.totals.netRevenue).toBe(0);
  });
  add(P, `totais com as filiais da ${nomeB} no escopo`, "somente a própria", () => reportTotals(S(), escopo(A().company.id, [B().matriz.id, B().filial.id])), (v) => expect(v.salesCount).toBe(0));
  add(P, `operações por filial da ${nomeB}`, "somente a própria", () => branchOperations(S(), escopo(A().company.id, [B().matriz.id])), (v) => expect(v.totals.salesCount).toBe(0));
  add(P, `visão comercial com a empresa ${nomeB}`, "somente a própria", () => commercialOverview(S(), escopo(B().company.id)));
  add(P, `meios de pagamento com a empresa ${nomeB}`, "somente a própria", () => paymentBreakdown(S(), escopo(B().company.id)), (v) => expect(v.paymentsTotal).toBe(0));
  add(P, "curva ABC da própria empresa", "somente a própria", () => abcReport(S(), escopo(A().company.id), { limits: { a: 8000, b: 9500 } } as any), temA);
  add(P, `curva ABC com a empresa ${nomeB} no escopo`, "somente a própria", () => abcReport(S(), escopo(B().company.id), { limits: { a: 8000, b: 9500 } } as any));
  add(P, `painel: últimas vendas das filiais da ${nomeB}`, "vazio", () => latestSales(A().admCons, [B().matriz.id, B().filial.id]));
  add(P, `painel: caixas abertos das filiais da ${nomeB}`, "vazio", () => openCashSessions(A().admCons, [B().matriz.id, B().filial.id]));
  add(P, `painel: alertas de estoque das filiais da ${nomeB}`, "vazio", () => stockAlerts(A().admCons, [B().matriz.id, B().filial.id]));
  add(P, `painel: financeiro das filiais da ${nomeB}`, "somente a própria", () => financeSnapshot(A().admCons, [B().matriz.id], false));
  add(P, `painel: fiscal das filiais da ${nomeB}`, "somente a própria", () => fiscalSnapshot(A().admCons, [B().matriz.id], { from: PERIODO.de, to: PERIODO.ate }));

  // ── exportações (CSV/XLSX): as mesmas funções da rota /api/export/[key] ──
  const E = "Exportações CSV/XLSX (função da rota /api/export/[key])";
  add(E, "todas as exportações da própria empresa (CSV e XLSX gerados)", "somente a própria", async () => {
    const s = await sessaoDe(A(), A().admCons);
    const out: Record<string, number> = {};
    let texto = "";
    for (const key of chavesExportacao()) {
      const def = getExport(key)!;
      let rows: Record<string, any>[] = [];
      try {
        rows = await def.rows(s, { ...PERIODO });
      } catch {
        rows = [];
      }
      out[key] = rows.length;
      texto += toCsv(def.columns, rows);
      if (rows.length) texto += Buffer.from(await toXlsx(def.title, def.columns, rows.slice(0, 50))).toString("latin1");
    }
    return { out, texto };
  }, (v) => {
    temA(v.texto);
    for (const key of ["products", "customers", "suppliers", "sales", "stock-balances", "fin-receivables"]) expect(v.out[key], key).toBeGreaterThan(0);
  });
  // cada exportação, com todos os parâmetros que as telas aceitam apontando para registros da outra empresa
  for (const key of chavesExportacao())
    add(E, `exportação "${key}" com os parâmetros apontando para a ${nomeB}`, "recusa ou somente a própria", async () => {
      const s = await sessaoDe(A(), A().admCons);
      const p = { ...PERIODO, empresa: B().company.id, filial: B().matriz.id, branch: B().matriz.id, cliente: B().cPF.id, fornecedor: B().fornecedor.id, conta: B().banco.id, account: B().banco.id, sku: B().sku1.id, produto: B().p1.id, deposito: B().matriz.defaultWarehouseId, sessao: B().caixa1.id, id: B().venda.id };
      const def = getExport(key)!;
      return toCsv(def.columns, await def.rows(s, p));
    });
  add(E, "vendedor restrito: nenhuma exportação passa na regra da rota (módulo + 'Exportar dados')", "vazio", async () => chavesExportacao().filter((key) => can(A().vend.user, getExport(key)!.module) && canDo(A().vend.user, "data.export")));

  // ── arquivos ──
  const F = "Arquivos (funções da rota /api/files/[id] e da imagem da vitrine)";
  add(F, `baixar comprovante da ${nomeB} pelo id`, "recusa", () => readFile(A().adm, B().arquivo.id));
  add(F, `baixar artefato da cópia de segurança da ${nomeB} pelo id`, "recusa", () => readFile(A().adm, B().backup.fileId));
  add(F, `rota de download: metadados do arquivo da ${nomeB} no Store da sessão`, "inexistente", () => S().get("files", B().arquivo.id));
  add(F, `imagem da ${nomeB} servida pela vitrine da ${nomeA}`, "inexistente", () => isPublicImage(store, A().loja, B().imagem.id));
  add(F, "comprovante próprio continua baixável", "somente a própria", async () => (await readFile(A().adm, A().arquivo.id)).data.toString(), temA);

  // ── notificações ──
  const N = "Notificações";
  add(N, "central de notificações", "somente a própria", () => queryNotifications(A().adm, {}), (v) => expect(v.map((n: Doc) => n.id)).toContain(A().notificacao.id));
  add(N, `central filtrada pela filial da ${nomeB}`, "vazio", () => queryNotifications(A().adm, { branch: B().matriz.id }));
  add(N, `contadores do administrador da ${nomeB} na empresa ${nomeA}`, "somente a própria", () => notificationCounts(S(), B().adminId, A().company.id), (v) => expect(serializa(v)).not.toMatch(/[1-9]/));

  // ── cópias de segurança e exportação dos dados da empresa ──
  const K = "Cópias de segurança e exportação dos dados da empresa";
  add(K, `conteúdo da cópia de segurança da ${nomeA} (com arquivos)`, "somente a própria", async () => (await loadBackupPayload(S(), A().backup)).payload, (v) => {
    expect(v.manifest.companyId).toBe(A().company.id);
    expect(v.collections.users.map((u: Doc) => u.id).sort()).toEqual([A().adminId, A().vendedorId].sort());
    // segredos de autenticação nunca vão na cópia de uma empresa (campos zerados)
    for (const u of v.collections.users) for (const f of ["passwordHash", "inviteTokenHash", "resetTokenHash", "totpSecretEnc", "totpRecoveryHashes"]) expect(u[f] ?? null, f).toBeNull();
    temA(v);
  });
  add(K, `montar cópia da empresa ${nomeB} pelo Store da sessão`, "recusa", () => buildPayload(S(), B().company.id, { includeFiles: true, includeGlobal: true } as any));
  add(K, `ler artefato da cópia da ${nomeB}`, "recusa", () => loadBackupPayload(S(), B().backup));
  add(K, `verificar cópia da ${nomeB}`, "recusa", () => verifyBackup(A().adm, B().backup.id));
  add(K, `restaurar cópia da ${nomeB} em base de teste`, "recusa", () => createRestoreJob(A().adm, B().backup, "test", null));
  add(K, `resumo de cópias com a empresa ${nomeB}`, "somente a própria", () => backupSummary(S(), B().company.id));
  add(K, `nova cópia da ${nomeA} não leva nada da ${nomeB}`, "somente a própria", async () => {
    const bk = await createBackup(A().adm, { kind: "manual", includeFiles: true, idemKey: `${a}-backup-matriz` });
    return (await loadBackupPayload(S(), bk)).payload;
  }, temA);

  // ── tarefas ──
  const T = "Tarefas em segundo plano";
  add(T, `executar tarefa da ${nomeB} pelo id`, "vazio", () => runDueJobs(S(), { jobIds: [B().tarefa.id] }));
  add(T, `reprocessar tarefa da ${nomeB}`, "recusa", () => requeueJob(A().adm, B().tarefa.id));
  add(T, "executar tarefas pendentes da empresa", "somente a própria", () => runCompanyJobs(A().adm, { includeRetry: true }));
  add(T, "tarefas da central de integrações", "somente a própria", () => integrationJobs(A().adm, "fiscal_nfe", ["pending", "retry", "dead", "running", "done"]));
  add(T, `tarefas pela chave de deduplicação da ${nomeB}`, "vazio", () => jobsFor(S(), `homolog:${b}:`));

  // ── integrações ──
  const I = "Configuração de integrações";
  add(I, `integração de e-mail da ${nomeB}`, "inexistente", () => getIntegration(S(), B().company.id, null, "email"));
  add(I, `lista de integrações com a empresa ${nomeB}`, "somente a própria", () => listIntegrations(S(), B().company.id), (v) => expect(serializa(v)).not.toContain(DEF[b].segredoEmail));
  add(I, `vincular a credencial (variável) da ${nomeB}`, "recusa", () => saveIntegration(A().adm, { kind: "email", branchId: null, provider: "resend", secretRefs: { apiKey: DEF[b].segredoEmail } }));
  add(I, "configuração fiscal própria", "somente a própria", () => getFiscalConfig(S(), A().company.id, null));
  add(I, "histórico de integrações", "somente a própria", () => integrationLogs(A().adm, "email"));

  // ── vitrine pública ──
  const V = "Vitrine pública (loja virtual)";
  add(V, `catálogo público da ${nomeA}`, "somente a própria", () => publicCatalog(store, A().loja), (v) => expect(v.cards.map((c: any) => c.productId)).toEqual([A().p1.id]));
  add(V, `produto da ${nomeB} pelo endereço na loja da ${nomeA}`, "inexistente", () => publicProduct(store, A().loja, B().slug1));
  add(V, `carrinho da loja da ${nomeA} com produto da ${nomeB}`, "recusa", () => addToCart(store, A().loja, "f".repeat(32), { productSlug: B().slug1, qty: 1 }));
  add(V, `carrinho da loja da ${nomeA} com SKU da ${nomeB}`, "recusa", () => addToCart(store, A().loja, "e".repeat(32), { productSlug: A().slug1, skuId: B().sku1.id, qty: 1 }));
  add(V, `mapa do site da loja da ${nomeA}`, "somente a própria", () => sitemapEntries(store, A().loja));
  add(V, `endereço da loja da ${nomeA} resolve a própria loja`, "somente a própria", () => resolveStore(store, A().loja.slug), (v) => expect(v.st.id).toBe(A().loja.id));
  add(V, `telas internas da loja resolvem só a loja da ${nomeA}`, "somente a própria", () => requireStore(A().adm), (v) => expect(v.id).toBe(A().loja.id));

  // ── usuário restrito da atacante tentando a outra empresa ──
  const U = "Usuário restrito (vendedor) contra a outra empresa";
  add(U, `contexto do vendedor na empresa ${nomeB}`, "recusa", () => ctxForCompany(A().vend, B().company.id));
  add(U, `perfil do vendedor dentro da ${nomeB}`, "somente a própria", async () => (await toCtxUser(store, (await store.get("users", A().vendedorId))!, B().company.id)).permissions, (v) => expect(v).toEqual({}));
  add(U, `vendedor lê venda da ${nomeB} pelo id`, "inexistente", () => saleDetail(A().vend, B().venda.id));
  add(U, `vendedor vende produto da ${nomeB}`, "recusa", () => finalizeSale(A().vend, { idemKey: `${a}-vend-ref`, terminalId: A().t1.id, items: [{ skuId: B().sku2.id, qty: QTY }], payments: [{ methodId: A().metodos.cash.id, amount: 100000, received: 100000 }] }));
  add(U, `vendedor devolve item da venda da ${nomeB}`, "recusa", async () => {
    const it = (await listAll(unscoped(store), "sale_items", { filters: [["eq", "saleId", B().venda.id]] }))[0];
    return processReturn(A().vend, { saleId: B().venda.id, idemKey: `${a}-vend-dev`, reason: "x", compensation: "store_credit", items: [{ saleItemId: it.id, qty: QTY, condition: "resellable" }] });
  });
  add(U, "vendedor lista clientes", "somente a própria", () => lookups.customers(A().vend));
  add(U, `vendedor edita cliente da ${nomeB}`, "recusa", () => updateCustomer(A().vend, B().cPF.id, { personType: "PF", doc: DEF[b].clientePF.cpf, name: "Alterado pelo vendedor" }));
  add(U, `vendedor abre caixa no terminal da ${nomeB}`, "recusa", () => openSession(A().vend, { terminalId: B().t1.id, openingFund: 0 }));
  add(U, `vendedor consulta o caixa da ${nomeB}`, "inexistente", () => sessionSummary(A().vend, B().caixa1.id));
  add(U, "vendedor lista vendas", "somente a própria", () => querySales(A().vend, { q: "", f: { ...PERIODO } } as any), temA);
  add(U, "vendedor lista produtos", "somente a própria", () => queryProducts(A().vend, { q: "", f: {} } as any), temA);
  add(U, "vendedor busca cliente com CPF presente nas duas empresas", "somente a própria", () => findCustomerByDoc(A().vend.store, A().company.id, CPF_COMUM), (v) => expect(v.id).toBe(A().cComum.id));

  return out;
}

describe.each([
  ["A", "B"],
  ["B", "A"],
] as const)("4. matriz de acesso cruzado — empresa %s tenta alcançar a empresa %s", (a, b) => {
  const direcao = `${DEF[a].nome} → ${DEF[b].nome}`;

  beforeAll(async () => {
    fotos[b] = await fotografia(W[b]);
    registrosFotografados[DEF[b].nome] = fotos[b]!.size;
    await fotografia(W[a]);
  });

  it("todas as exportações registradas estão na matriz", () => {
    const keys = chavesExportacao();
    expect(keys.length).toBeGreaterThanOrEqual(60);
    for (const key of keys) expect(getExport(key), key).toBeTruthy();
  });

  it.each(linhas(a, b))("$superficie › $tentativa (esperado: $esperado)", async (l) => {
    await executa(direcao, b, l);
  });

  it(`integridade: os registros da empresa ${b} continuam idênticos depois de todas as tentativas`, async () => {
    const depois = await fotografia(W[b]);
    const d = diferencas(fotoAlvo(b), depois);
    const detalhe = d
      .slice(0, 5)
      .map((x) => {
        const key = x.replace(/^\S+ /, "");
        return `${x}\n  antes: ${fotoAlvo(b).get(key)?.slice(0, 600) ?? "—"}\n  depois: ${depois.get(key)?.slice(0, 600) ?? "—"}`;
      })
      .join("\n");
    expect(d, `registros da empresa-alvo alterados pelas tentativas:\n${detalhe}`).toEqual([]);
  });

  it(`as tentativas barradas ficam registradas para a plataforma (tenancy_violations)`, async () => {
    // o registro é assíncrono (melhor esforço, nunca atrasa a operação barrada): aguarda até 2 s
    let v: Doc[] = [];
    for (let i = 0; i < 40 && !v.length; i++) {
      v = (await listAll(unscoped(store), "tenancy_violations")).filter((x) => x.scopeCompanyId === W[a].company.id && x.targetCompanyId === W[b].company.id);
      if (!v.length) await new Promise((r) => setTimeout(r, 50));
    }
    expect(v.length).toBeGreaterThan(0);
    expect(new Set(v.map((x) => x.mode))).toEqual(new Set(["estrito"]));
  });
});

describe("5. fecho da homologação", () => {
  it("os fluxos da própria empresa continuam funcionando depois da matriz (nova venda no PDV em cada empresa)", async () => {
    for (const k of ["A", "B"] as const) {
      const w = W[k];
      const v = await finalizeSale(w.vend, { idemKey: `${k}-venda-final`, terminalId: w.t1.id, items: [{ skuId: w.sku2.id, qty: QTY }], payments: [{ methodId: w.metodos.cash.id, amount: DEF[k].produtos[1].preco, received: DEF[k].produtos[1].preco }] });
      expect(v).toMatchObject({ status: "completed", companyId: w.company.id });
      await runDueJobs(w.adm.store, { limit: 20 });
      expect((await store.get("sales", v.id))!.fiscalStatus).toBe("authorized");
    }
    // e as configurações de cada uma seguem separadas
    expect(await getSetting(store, W.A.company.id, null, "feature.comercioDigital", null)).toBe(true);
    expect((await getIntegration(unscoped(store), W.B.company.id, null, "email"))!.secretRefs).toEqual({ apiKey: DEF.B.segredoEmail });
  });
});
