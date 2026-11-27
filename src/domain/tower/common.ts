import crypto from "node:crypto";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { systemCtx, type Ctx } from "@/lib/core/ctx";
import { DEFAULT_TZ, dayRange, diffDays } from "@/lib/dates";
import { ServiceError, validationError, type FieldIssue } from "@/lib/service/errors";
import type { ServiceCall } from "@/lib/service/http";
import { linkedCompany } from "@/domain/tenancy/provisioning";
import { MAX_PERIOD_DAYS, type ReportScope } from "@/domain/reports";
import { decodeCursor, type CursorKey } from "./pagination";

/**
 * Torre de Controle (Interos) — consultas analíticas v1: base comum das rotas.
 *
 *  - Empresa-alvo: só as vinculadas ao Interos (`linkedCompany`; as demais respondem 404 `nao_encontrado`).
 *  - Toda leitura usa o contexto técnico restrito à empresa (`systemCtx` → Store com isolamento estrito): nenhuma consulta
 *    alcança dados de outra empresa, mesmo que um filtro aponte para ela.
 *  - Parâmetros: `de`/`ate` (AAAA-MM-DD, inclusivos, no máximo 400 dias — o mesmo limite das telas de análise),
 *    `idUnidade` (ids de filial separados por vírgula; filial que não é da empresa → 422 `validacao`), `limite`/`cursor`.
 *  - Os números vêm das MESMAS funções das telas (painel, relatórios gerenciais, curva ABC, estoque, financeiro, fiscal,
 *    compras, comércio digital); aqui só se escolhe o recorte e se traduz para o contrato (português, centavos, milésimos).
 * Definições de cada indicador: docs/interos/torre-indicadores.md.
 */

export const INDICATORS_VERSION = "2026-11-v1";
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
const MAX_UNITS = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface TowerPeriod {
  from: string;
  to: string;
  /** dias de calendário, inclusive */
  days: number;
}

export interface TowerMeta {
  idEmpresa: string;
  periodo: { de: string; ate: string } | null;
  unidades: string[] | null;
  fuso: string;
  geradoEm: string;
  versaoIndicadores: string;
  /** módulos amplos contratados (null = empresa sem contrato registrado: tudo) */
  modulosContratados: string[] | null;
}

export interface TowerPage {
  limit: number;
  after: CursorKey | null;
  fingerprint: string;
}

export interface TowerRequest<E = Record<string, never>> {
  company: Doc;
  companyId: string;
  /** contexto técnico (administrador "Sistema") com o Store restrito à empresa */
  ctx: Ctx;
  store: Store;
  /** todas as filiais da empresa */
  branches: Doc[];
  /** filtro `idUnidade` validado; null = todas as filiais da empresa (consolidado) */
  branchIds: string[] | null;
  /** filiais efetivas do recorte (o filtro ou todas as filiais da empresa) */
  scopeBranchIds: string[];
  period: TowerPeriod | null;
  page: TowerPage | null;
  extra: E;
  meta: TowerMeta;
  /** módulos amplos contratados (null = tudo: empresa sem contrato registrado) */
  areas: Set<string> | null;
}

export interface OpenOptions<E> {
  /** nome estável da operação (entra na impressão digital do cursor) */
  op: string;
  /** a rota exige `de` e `ate` */
  period: boolean;
  /** a rota é paginada (`limite`, `cursor`) */
  paged?: boolean;
  /** parâmetros próprios da rota (validados junto com os comuns: todos os problemas voltam numa única resposta 422) */
  parse?: (q: URLSearchParams, issues: FieldIssue[]) => E;
  /** módulos amplos de que a consulta depende (basta um contratado); sem nenhum: 409 modulo_nao_contratado */
  requires?: string[];
}

function validIsoDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Período obrigatório e estrito (o serviço não adota período padrão: data ausente ou inválida é erro). */
export function parsePeriod(q: URLSearchParams, issues: FieldIssue[]): TowerPeriod | null {
  const de = (q.get("de") ?? "").trim();
  const ate = (q.get("ate") ?? "").trim();
  let ok = true;
  if (!de) {
    issues.push({ campo: "de", mensagem: "Informe a data inicial do período (de, no formato AAAA-MM-DD)." });
    ok = false;
  } else if (!validIsoDate(de)) {
    issues.push({ campo: "de", mensagem: "Data inicial inválida: use AAAA-MM-DD (ex.: 2026-11-01)." });
    ok = false;
  }
  if (!ate) {
    issues.push({ campo: "ate", mensagem: "Informe a data final do período (ate, no formato AAAA-MM-DD)." });
    ok = false;
  } else if (!validIsoDate(ate)) {
    issues.push({ campo: "ate", mensagem: "Data final inválida: use AAAA-MM-DD (ex.: 2026-11-30)." });
    ok = false;
  }
  if (!ok) return null;
  if (de > ate) {
    issues.push({ campo: "de", mensagem: "A data inicial (de) é posterior à data final (ate)." });
    return null;
  }
  const days = diffDays(de, ate) + 1;
  if (days > MAX_PERIOD_DAYS) {
    issues.push({ campo: "ate", mensagem: `Período limitado a ${MAX_PERIOD_DAYS} dias (o informado tem ${days} dias).` });
    return null;
  }
  return { from: de, to: ate, days };
}

/** `idUnidade=a,b,c` → lista sem repetição (vazio = sem filtro). A pertinência à empresa é conferida depois. */
export function parseUnits(q: URLSearchParams, issues: FieldIssue[]): string[] | null {
  const raw = q.getAll("idUnidade").join(",");
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return null;
  if (ids.length > MAX_UNITS) issues.push({ campo: "idUnidade", mensagem: `Informe no máximo ${MAX_UNITS} unidades.` });
  return ids.map((id) => id.slice(0, 100));
}

export function parseLimit(q: URLSearchParams, issues: FieldIssue[]): number {
  const v = (q.get("limite") ?? "").trim();
  if (!v) return DEFAULT_LIMIT;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    issues.push({ campo: "limite", mensagem: `limite deve ser um inteiro de 1 a ${MAX_LIMIT} (padrão ${DEFAULT_LIMIT}).` });
    return DEFAULT_LIMIT;
  }
  return n;
}

/** Parâmetro de lista fechada (com padrão). */
export function parseEnum<T extends string>(q: URLSearchParams, name: string, allowed: readonly T[], fallback: T, issues: FieldIssue[]): T {
  const v = (q.get(name) ?? "").trim();
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  issues.push({ campo: name, mensagem: `${name} deve ser um de: ${allowed.join(", ")}.` });
  return fallback;
}

/** Parâmetro sim/não (`1`/`0`, `true`/`false`). */
export function parseFlag(q: URLSearchParams, name: string, fallback: boolean, issues: FieldIssue[]): boolean {
  const v = (q.get(name) ?? "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  issues.push({ campo: name, mensagem: `${name} deve ser 1 (sim) ou 0 (não).` });
  return fallback;
}

/** Impressão digital da consulta: o cursor só vale para a mesma rota, empresa, período, unidades e filtros. */
function fingerprintOf(op: string, companyId: string, period: TowerPeriod | null, branchIds: string[] | null, extra: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([op, companyId, period?.from ?? null, period?.to ?? null, branchIds ? [...branchIds].sort() : null, extra ?? null]))
    .digest("hex")
    .slice(0, 16);
}

function byCodeThenName(a: Doc, b: Doc) {
  return String(a.code ?? "").localeCompare(String(b.code ?? ""), "pt-BR") || String(a.name ?? "").localeCompare(String(b.name ?? ""), "pt-BR") || String(a.id).localeCompare(String(b.id));
}

/**
 * Abre a consulta: empresa vinculada (404 antes de qualquer validação), parâmetros (422 com todos os problemas) e o
 * contexto restrito à empresa.
 */
export async function openTower<E = Record<string, never>>(call: ServiceCall, opts: OpenOptions<E>): Promise<TowerRequest<E>> {
  const company = await linkedCompany(call.store, call.params.idEmpresa);
  const companyId = company.id as string;
  const ctx = systemCtx(call.store, companyId);
  const q = call.query;
  const issues: FieldIssue[] = [];
  const period = opts.period ? parsePeriod(q, issues) : null;
  const units = parseUnits(q, issues);
  const limit = opts.paged ? parseLimit(q, issues) : DEFAULT_LIMIT;
  const extra = (opts.parse ? opts.parse(q, issues) : {}) as E;
  const branches = (await listAll(ctx.store, "branches", { filters: [["eq", "companyId", companyId]] })).sort(byCodeThenName);
  const own = new Set(branches.map((b) => b.id as string));
  if (units) {
    const foreign = units.filter((id) => !own.has(id));
    if (foreign.length) issues.push({ campo: "idUnidade", mensagem: `Unidade(s) que não pertence(m) a esta empresa: ${foreign.slice(0, 10).join(", ")}.` });
  }
  let page: TowerPage | null = null;
  if (opts.paged) {
    const fingerprint = fingerprintOf(opts.op, companyId, period, units, extra);
    const raw = (q.get("cursor") ?? "").trim();
    let after: CursorKey | null = null;
    if (raw) {
      after = decodeCursor(raw, fingerprint);
      if (!after) issues.push({ campo: "cursor", mensagem: "Cursor inválido ou de outra consulta: repita a consulta sem cursor." });
    }
    page = { limit, after, fingerprint };
  }
  if (issues.length) throw validationError(issues);
  const branchIds = units;
  // o que a empresa contratou (correção 6): a Torre não mostra dados de módulo não contratado
  const { contractedAreas } = await import("../tenancy/contracted");
  const areas = await contractedAreas(call.store, company);
  if (opts.requires && !opts.requires.some((a) => !areas || areas.has(a)))
    throw new ServiceError(409, "modulo_nao_contratado", `A empresa não contratou ${opts.requires.map((a) => AREA_LABEL[a] ?? a).join(" nem ")}: a consulta não se aplica.`, { modulos: opts.requires });
  return {
    company,
    companyId,
    areas,
    ctx,
    store: ctx.store,
    branches,
    branchIds,
    scopeBranchIds: branchIds ?? branches.map((b) => b.id as string),
    period,
    page,
    extra,
    meta: {
      idEmpresa: companyId,
      periodo: period ? { de: period.from, ate: period.to } : null,
      unidades: branchIds,
      fuso: DEFAULT_TZ,
      geradoEm: new Date().toISOString(),
      versaoIndicadores: INDICATORS_VERSION,
      // módulos amplos contratados (null = empresa sem contrato registrado: tudo)
      modulosContratados: areas ? [...areas].sort() : null,
    },
  };
}

const AREA_LABEL: Record<string, string> = {
  pdv: "PDV e caixa", vendas: "Vendas", estoque: "Estoque", compras: "Compras", financeiro: "Financeiro", fiscal: "Fiscal",
  relatorios: "Relatórios", comercio_digital: "Comércio digital", gestao_contabil: "Gestão contábil", rede_certificacao: "Rede de certificação",
};

/** Recorte da base comercial (`loadFacts`): empresa, filiais do filtro (null = todas) e período. */
export function reportScope(t: TowerRequest<any>): ReportScope {
  if (!t.period) throw new Error("Rota sem período: recorte comercial indisponível.");
  return { companyId: t.companyId, branchIds: t.branchIds, from: t.period.from, to: t.period.to };
}

/** Intervalo técnico do período em UTC ([00:00 local do 1º dia, 00:00 local do dia seguinte ao último)). */
export function periodRange(t: TowerRequest<any>): { start: string; end: string } {
  if (!t.period) throw new Error("Rota sem período.");
  return dayRange(t.period.from, t.period.to);
}

/** Registro (com filial) dentro do filtro de unidades. Sem filtro: tudo da empresa, inclusive o que não tem filial. */
export function inUnits(t: TowerRequest<any>, branchId: string | null | undefined): boolean {
  return !t.branchIds || (branchId != null && t.branchIds.includes(branchId));
}

export function sum<T>(rows: T[], fn: (r: T) => number | null | undefined): number {
  return rows.reduce((a, r) => a + (Number(fn(r)) || 0), 0);
}

/** { quantidade, valorCentavos } de um conjunto. */
export function countValue<T>(rows: T[], fn: (r: T) => number | null | undefined) {
  return { quantidade: rows.length, valorCentavos: sum(rows, fn) };
}

/** Situações internas (inglês) → valores do contrato (português, sem acento). Valor desconhecido passa como está. */
export function pt(map: Record<string, string>, v: string | null | undefined): string | null {
  if (v == null || v === "") return null;
  return map[v] ?? v;
}

export const SALE_STATUS_PT: Record<string, string> = { completed: "concluida", cancelled: "cancelada" };
export const SALE_ORIGIN_PT: Record<string, string> = { pdv: "pdv", exchange: "troca" };
export const RETURN_STATUS_PT: Record<string, string> = { completed: "concluida", processing: "em_processamento", cancelled: "cancelada" };
export const RETURN_KIND_PT: Record<string, string> = { return: "devolucao", exchange: "troca" };
export const COMPENSATION_PT: Record<string, string> = { store_credit: "vale_credito", exchange: "troca", refund: "reembolso" };
export const REFUND_METHOD_PT: Record<string, string> = { cash: "dinheiro", pix: "pix", account: "conta", card_reversal: "estorno_cartao", refund: "reembolso" };
export const FISCAL_STATUS_PT: Record<string, string> = {
  draft: "rascunho",
  pending: "pendente",
  queued: "na_fila",
  processing: "processando",
  authorized: "autorizado",
  rejected: "rejeitado",
  denied: "denegado",
  error: "erro",
  cancelled: "cancelado",
  contingency: "contingencia",
  unused: "inutilizado",
  discarded: "descartado",
  not_required: "nao_exigido",
};
export const ORDER_STATUS_PT: Record<string, string> = {
  pending_payment: "aguardando_pagamento",
  paid: "pago",
  invoiced: "faturado",
  ready_for_pickup: "pronto_para_retirada",
  shipped: "despachado",
  delivered: "entregue",
  cancelled: "cancelado",
  return_requested: "devolucao_solicitada",
  returned: "devolvido",
};
export const STORE_STATUS_PT: Record<string, string> = { draft: "rascunho", published: "publicada", paused: "pausada" };
export const PURCHASE_STATUS_PT: Record<string, string> = {
  draft: "rascunho",
  in_review: "em_analise",
  adjust: "em_ajuste",
  approved: "aprovado",
  sent: "enviado",
  partial: "parcial",
  received: "recebido",
  rejected: "rejeitado",
  cancelled: "cancelado",
};
export const RECEIPT_STATUS_PT: Record<string, string> = { draft: "rascunho", confirming: "em_confirmacao", confirmed: "confirmado", cancelled: "cancelado", scheduled: "previsto" };
export const WAREHOUSE_KIND_PT: Record<string, string> = { available: "disponivel", damaged: "avarias", consumption: "uso_consumo" };
export const AGING_BUCKET_PT: Record<string, string> = { current: "a_vencer", d1_30: "de_1_a_30_dias", d31_60: "de_31_a_60_dias", d61_90: "de_61_a_90_dias", over90: "acima_de_90_dias" };
export const ACCOUNT_KIND_PT: Record<string, string> = { cash: "caixa", bank: "banco", wallet: "carteira_digital" };
