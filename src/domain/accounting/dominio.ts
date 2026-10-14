import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { isFeatureOn } from "@/lib/core/settings";
import { dayRange, formatDate, toLocalDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getIntegration, logIntegration } from "../integrations";

/**
 * Exportação de lançamentos para a Domínio (Thomson Reuters) — CTB-02.
 *
 * LAYOUT ASSUMIDO (conferir com o escritório na primeira importação — Domínio › Utilitários › Importação ›
 * Lançamentos contábeis, leiaute "texto com separador"): um lançamento por linha, campos separados pelo separador
 * configurado (padrão ";"), sem cabeçalho, linhas terminadas em CRLF, codificação ISO-8859-1 (ANSI):
 *   1. Data do lançamento (DD/MM/AAAA)
 *   2. Conta débito (código reduzido da Domínio)
 *   3. Conta crédito (código reduzido da Domínio)
 *   4. Valor (sem separador de milhar, vírgula decimal: 1234,56)
 *   5. Código do histórico padrão (configurável; vazio = sem histórico padrão)
 *   6. Complemento do histórico (até 200 caracteres, sem o separador e sem quebras de linha)
 *   7. Número do documento (nº do documento do título ou "T<nº do título>")
 *
 * Origem dos lançamentos (títulos e baixas do período, por filial quando houver filial ativa):
 *  - Regime de COMPETÊNCIA (padrão):
 *      título a pagar emitido no período   → D conta da categoria (despesa/compra)   C Fornecedores
 *      título a receber emitido no período → D Clientes                              C conta da categoria (receita)
 *      baixa de título a pagar             → D Fornecedores C Caixa/Banco (principal − desconto);
 *                                            D Fornecedores C Descontos obtidos (desconto);
 *                                            D Juros/multas pagos C Caixa/Banco (juros + multa)
 *      baixa de título a receber           → D Caixa/Banco C Clientes (principal − desconto);
 *                                            D Descontos concedidos C Clientes (desconto);
 *                                            D Caixa/Banco C Juros/multas recebidos (juros + multa)
 *      tarifa da baixa                     → D Tarifas C Caixa/Banco
 *  - Regime de CAIXA: só as baixas, com a conta da categoria no lugar de Fornecedores/Clientes (desconto já reduz o
 *    valor pago/recebido; juros/multas e tarifas como acima).
 *  - Estorno de baixa (estornada no período) → as mesmas linhas com débito e crédito invertidos, na data do estorno.
 *  - Ficam fora: títulos cancelados, renegociações (troca de títulos do mesmo cliente — origem "renegotiation" e as
 *    marcas de renegociação), abatimentos por crédito de devolução a fornecedor e transferências entre contas.
 * Contas: categoria → `fin_categories.accountingCode` (ou da categoria-mãe) → conta padrão da configuração; conta
 * financeira → `financial_accounts.accountingCode` → conta Caixa/Bancos padrão. Lançamento sem conta sai com o campo
 * vazio e é listado como pendência (a Domínio recusa a linha).
 * Mesmo período e mesmos dados → mesmo arquivo (ordem estável por data, origem e id).
 */

export const DOMINIO_FEATURE = "exportacaoDominio";

export interface DominioConfig {
  dominioCompanyCode: string;
  regime: "competencia" | "caixa";
  separator: string;
  historyCode: string;
  accountSuppliers: string;
  accountCustomers: string;
  accountCash: string;
  accountDefaultExpense: string;
  accountDefaultRevenue: string;
  accountInterestPaid: string;
  accountInterestReceived: string;
  accountDiscountObtained: string;
  accountDiscountGranted: string;
  accountBankFees: string;
}

export const DOMINIO_DEFAULTS: DominioConfig = {
  dominioCompanyCode: "",
  regime: "competencia",
  separator: ";",
  historyCode: "",
  accountSuppliers: "",
  accountCustomers: "",
  accountCash: "",
  accountDefaultExpense: "",
  accountDefaultRevenue: "",
  accountInterestPaid: "",
  accountInterestReceived: "",
  accountDiscountObtained: "",
  accountDiscountGranted: "",
  accountBankFees: "",
};

const ACCOUNT_KEYS = ["accountSuppliers", "accountCustomers", "accountCash", "accountDefaultExpense", "accountDefaultRevenue", "accountInterestPaid", "accountInterestReceived", "accountDiscountObtained", "accountDiscountGranted", "accountBankFees"] as const;
const ACCOUNT_LABEL: Record<(typeof ACCOUNT_KEYS)[number], string> = {
  accountSuppliers: "Fornecedores",
  accountCustomers: "Clientes",
  accountCash: "Caixa/Bancos padrão",
  accountDefaultExpense: "Despesa/compra padrão",
  accountDefaultRevenue: "Receita padrão",
  accountInterestPaid: "Juros e multas pagos",
  accountInterestReceived: "Juros e multas recebidos",
  accountDiscountObtained: "Descontos obtidos",
  accountDiscountGranted: "Descontos concedidos",
  accountBankFees: "Tarifas bancárias",
};

/** Configuração efetiva (valores da integração sobre os padrões). */
export function dominioConfigOf(raw: Record<string, any> | null | undefined): DominioConfig {
  const c = { ...DOMINIO_DEFAULTS };
  for (const k of Object.keys(DOMINIO_DEFAULTS) as Array<keyof DominioConfig>) {
    const v = raw?.[k];
    if (v != null && String(v).trim() !== "") (c as any)[k] = String(v).trim();
  }
  c.regime = c.regime === "caixa" ? "caixa" : "competencia";
  return c;
}

/** Problema na configuração salva (ou null). */
export function validateDominioConfig(raw: Record<string, any>): string | null {
  const c = dominioConfigOf(raw);
  if (raw.regime != null && raw.regime !== "" && !["competencia", "caixa"].includes(String(raw.regime).trim())) return "Regime dos lançamentos: informe competencia ou caixa.";
  if (c.separator.length !== 1 || /[\w\s,.]/.test(c.separator)) return "Separador de campos: um único caractere que não seja letra, número, espaço, vírgula ou ponto (ex.: ; ou |).";
  for (const k of ACCOUNT_KEYS) if (c[k] && !/^[\w.-]{1,40}$/.test(c[k])) return `Conta ${ACCOUNT_LABEL[k]}: use o código da conta na Domínio (letras, números, ponto ou hífen).`;
  if (c.historyCode && !/^\d{1,10}$/.test(c.historyCode)) return "Código do histórico padrão: somente números.";
  return null;
}

/** Contas obrigatórias do regime que estão vazias (rótulos). */
export function dominioMissingAccounts(c: DominioConfig): string[] {
  const need: Array<(typeof ACCOUNT_KEYS)[number]> = c.regime === "caixa" ? ["accountCash", "accountDefaultExpense", "accountDefaultRevenue", "accountInterestPaid", "accountInterestReceived"] : ["accountSuppliers", "accountCustomers", "accountCash", "accountDefaultExpense", "accountDefaultRevenue", "accountInterestPaid", "accountInterestReceived", "accountDiscountObtained", "accountDiscountGranted"];
  return need.filter((k) => !c[k]).map((k) => ACCOUNT_LABEL[k]);
}

export interface DominioLine {
  /** AAAA-MM-DD */
  date: string;
  debit: string;
  credit: string;
  amount: number;
  history: string;
  complement: string;
  document: string;
  origin: { type: "title" | "settlement" | "reversal"; id: string; titleId: string };
  /** contas não resolvidas (lançamento sairá com campo vazio) */
  missing: string[];
}

export interface DominioFilter {
  from: string;
  to: string;
  branchId?: string | null;
}

/** Monta os lançamentos do período (sem gravar nada). */
export async function dominioEntries(ctx: Ctx, f: DominioFilter, cfgIn?: DominioConfig) {
  const integ = cfgIn ? null : await getIntegration(ctx.store, ctx.companyId, f.branchId ?? ctx.branchId, "accounting_dominio");
  const cfg = cfgIn ?? dominioConfigOf(integ?.config);
  const branch = f.branchId ?? ctx.branchId;
  const scope: any[] = [["eq", "companyId", ctx.companyId], ...(branch ? [["eq", "branchId", branch]] : [])];
  const { start, end } = dayRange(f.from, f.to);
  const [categories, accounts, settled, reversed, issued] = await Promise.all([
    listAll(ctx.store, "fin_categories", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "financial_accounts", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "settlements", { filters: [...scope, ["gte", "date", f.from], ["lte", "date", f.to]] }),
    listAll(ctx.store, "settlements", { filters: [...scope, ["eq", "status", "reversed"], ["gte", "reversedAt", start], ["lt", "reversedAt", end]] }),
    cfg.regime === "competencia" ? listAll(ctx.store, "titles", { filters: [...scope, ["gte", "issueDate", f.from], ["lte", "issueDate", f.to]] }) : Promise.resolve([] as Doc[]),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const titleIds = [...new Set([...settled, ...reversed].map((x) => x.titleId))];
  const titles = new Map(issued.map((t) => [t.id, t]));
  const missingIds = titleIds.filter((id) => !titles.has(id));
  for (let i = 0; i < missingIds.length; i += 100) for (const t of await listAll(ctx.store, "titles", { filters: [["eq", "id", missingIds.slice(i, i + 100)]] })) titles.set(t.id, t);
  const instIds = [...new Set([...settled, ...reversed].map((x) => x.installmentId))];
  const insts = new Map<string, Doc>();
  for (let i = 0; i < instIds.length; i += 100) for (const x of await listAll(ctx.store, "installments", { filters: [["eq", "id", instIds.slice(i, i + 100)]] })) insts.set(x.id, x);

  const categoryCode = (id: string | null | undefined, kind: "payable" | "receivable") => {
    let cur = id ? catById.get(id) : null;
    for (let depth = 0; cur && depth < 8; depth++) {
      if (cur.accountingCode) return String(cur.accountingCode);
      cur = cur.parentId ? catById.get(cur.parentId) : null;
    }
    return kind === "payable" ? cfg.accountDefaultExpense : cfg.accountDefaultRevenue;
  };
  const accountCode = (id: string | null | undefined) => (id ? accById.get(id)?.accountingCode : null) || cfg.accountCash;
  const doc = (t: Doc) => (t.documentNumber ? String(t.documentNumber) : `T${t.number}`);
  const lines: DominioLine[] = [];
  const push = (l: Omit<DominioLine, "missing" | "history">, labels: [string, string]) => {
    if (l.amount <= 0) return;
    const missing = [!l.debit ? `débito (${labels[0]})` : "", !l.credit ? `crédito (${labels[1]})` : ""].filter(Boolean);
    lines.push({ ...l, history: cfg.historyCode, missing });
  };
  // títulos emitidos (competência)
  for (const t of issued) {
    if (t.status === "cancelled" || t.originType === "renegotiation") continue;
    const kind = t.kind as "payable" | "receivable";
    const cat = categoryCode(t.categoryId, kind);
    const comp = `${kind === "payable" ? "Provisão a pagar" : "Provisão a receber"} título nº ${t.number}${t.documentNumber ? ` doc. ${t.documentNumber}` : ""} - ${t.partyName ?? t.description ?? ""}`;
    const o = { type: "title" as const, id: t.id, titleId: t.id };
    if (kind === "payable") push({ date: t.issueDate, debit: cat, credit: cfg.accountSuppliers, amount: t.total ?? 0, complement: comp, document: doc(t), origin: o }, ["categoria", "Fornecedores"]);
    else push({ date: t.issueDate, debit: cfg.accountCustomers, credit: cat, amount: t.total ?? 0, complement: comp, document: doc(t), origin: o }, ["Clientes", "categoria"]);
  }
  // baixas (e estornos)
  const settlementLines = (s: Doc, date: string, reversal: boolean) => {
    const t = titles.get(s.titleId);
    // só baixas em dinheiro/conta: marcas de renegociação e abatimentos (crédito de devolução) ficam fora
    if (!t || (s.kind ?? "settlement") !== "settlement") return;
    const kind = t.kind as "payable" | "receivable";
    const inst = insts.get(s.installmentId);
    const bank = accountCode(s.accountId);
    const cat = categoryCode(inst?.categoryId ?? t.categoryId, kind);
    const party = cfg.regime === "caixa" ? cat : kind === "payable" ? cfg.accountSuppliers : cfg.accountCustomers;
    const partyLabel = cfg.regime === "caixa" ? "categoria" : kind === "payable" ? "Fornecedores" : "Clientes";
    const principal = s.principal ?? 0;
    const discount = s.discount ?? 0;
    const charges = (s.interest ?? 0) + (s.fine ?? 0);
    const fee = s.fee ?? 0;
    const base = `${reversal ? "Estorno " : ""}${kind === "payable" ? "Pagamento" : "Recebimento"} título nº ${t.number}${inst ? ` parc. ${inst.number}/${t.installmentsCount ?? "?"}` : ""}${t.documentNumber ? ` doc. ${t.documentNumber}` : ""} - ${t.partyName ?? t.description ?? ""}`;
    const o = { type: reversal ? ("reversal" as const) : ("settlement" as const), id: s.id, titleId: t.id };
    const add = (debit: string, credit: string, amount: number, suffix: string, labels: [string, string]) => (reversal ? push({ date, debit: credit, credit: debit, amount, complement: `${base}${suffix}`, document: doc(t), origin: o }, [labels[1], labels[0]]) : push({ date, debit, credit, amount, complement: `${base}${suffix}`, document: doc(t), origin: o }, labels));
    if (kind === "payable") {
      add(party, bank, principal - discount, "", [partyLabel, "Caixa/Banco"]);
      if (cfg.regime === "competencia") add(cfg.accountSuppliers, cfg.accountDiscountObtained, discount, " (desconto obtido)", ["Fornecedores", "Descontos obtidos"]);
      add(cfg.accountInterestPaid, bank, charges, " (juros/multa)", ["Juros/multas pagos", "Caixa/Banco"]);
    } else {
      add(bank, party, principal - discount, "", ["Caixa/Banco", partyLabel]);
      if (cfg.regime === "competencia") add(cfg.accountDiscountGranted, cfg.accountCustomers, discount, " (desconto concedido)", ["Descontos concedidos", "Clientes"]);
      add(bank, cfg.accountInterestReceived, charges, " (juros/multa)", ["Caixa/Banco", "Juros/multas recebidos"]);
    }
    add(cfg.accountBankFees, bank, fee, " (tarifa)", ["Tarifas", "Caixa/Banco"]);
  };
  for (const s of settled) settlementLines(s, s.date, false);
  for (const s of reversed) settlementLines(s, toLocalDate(s.reversedAt), true);
  const order = { title: 0, settlement: 1, reversal: 2 };
  lines.sort((a, b) => a.date.localeCompare(b.date) || order[a.origin.type] - order[b.origin.type] || a.origin.id.localeCompare(b.origin.id) || a.complement.localeCompare(b.complement));
  const pending = lines.filter((l) => l.missing.length);
  return { config: cfg, configured: Boolean(integ) || Boolean(cfgIn), lines, pending, total: lines.reduce((a, l) => a + l.amount, 0) };
}

/** Valor no layout: sem milhar, vírgula decimal. */
export const dominioAmount = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Texto de campo: sem separador, aspas e quebras de linha. */
function clean(s: string, sep: string, max = 200) {
  return s.replaceAll(sep, " ").replace(/[\r\n\t"]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Linhas do arquivo (sem cabeçalho). */
export function dominioFileLines(lines: DominioLine[], cfg: DominioConfig): string[] {
  const sep = cfg.separator || ";";
  return lines.map((l) => [formatDate(l.date), clean(l.debit, sep, 40), clean(l.credit, sep, 40), dominioAmount(l.amount), clean(l.history, sep, 10), clean(l.complement, sep), clean(l.document, sep, 40)].join(sep));
}

/** Conteúdo em ISO-8859-1 (caracteres fora da tabela viram "?"), linhas com CRLF. */
export function dominioFileBuffer(text: string) {
  const latin = text.normalize("NFC").replace(/[^\u0000-ÿ]/g, "?");
  return Buffer.from(latin, "latin1");
}

export interface DominioExportResult {
  fileId: string;
  fileName: string;
  lines: number;
  pending: number;
  total: number;
}

/** Gera e guarda o arquivo de lançamentos do período (Arquivos), com registro na Central de integrações. */
export async function generateDominioFile(ctx: Ctx, f: DominioFilter): Promise<DominioExportResult> {
  requirePerm(ctx, "finance", "view");
  requireAction(ctx, "data.export");
  if (!(await isFeatureOn(ctx.store, ctx.companyId, f.branchId ?? ctx.branchId, DOMINIO_FEATURE, true))) throw new BusinessError("Exportação para a Domínio desligada em Administração › Parâmetros › Recursos.", "feature_off");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(f.from) && /^\d{4}-\d{2}-\d{2}$/.test(f.to) && f.from <= f.to, "Período inválido.");
  const integ = await getIntegration(ctx.store, ctx.companyId, f.branchId ?? ctx.branchId, "accounting_dominio");
  if (!integ) throw new BusinessError("Configure o layout da Domínio (contas e regime) em Administração › Central de integrações › Domínio antes de gerar o arquivo.", "not_configured");
  const r = await dominioEntries(ctx, f);
  const text = dominioFileLines(r.lines, r.config).join("\r\n") + (r.lines.length ? "\r\n" : "");
  const data = dominioFileBuffer(text);
  const code = r.config.dominioCompanyCode ? `-${r.config.dominioCompanyCode.replace(/\W/g, "")}` : "";
  const fileName = `dominio-lancamentos${code}-${f.from}-a-${f.to}.txt`;
  const file = await saveFile(ctx, { bucket: "documents", name: fileName, mime: "text/plain", data, entityType: "dominio_export", entityId: `${f.from}:${f.to}`, kind: "dominio_export", branchId: f.branchId ?? ctx.branchId });
  const message = `Arquivo ${fileName}: ${r.lines.length} lançamento(s), ${formatMoney(r.total)}${r.pending.length ? `; ${r.pending.length} sem conta contábil (corrija o plano de contas antes de importar)` : ""}`;
  await logIntegration(ctx.store, { companyId: ctx.companyId, branchId: integ.branchId ?? null, integrationId: integ.id, kind: "accounting_dominio", action: "export_file", status: r.pending.length ? "info" : "success", message, payload: { fileId: file.id, from: f.from, to: f.to, lines: r.lines.length, pending: r.pending.length, regime: r.config.regime } });
  await audit(ctx, { module: "finance", action: "dominio.export", entityType: "file", entityId: file.id, summary: message, after: { from: f.from, to: f.to, lines: r.lines.length, pending: r.pending.length } });
  return { fileId: file.id, fileName, lines: r.lines.length, pending: r.pending.length, total: r.total };
}

/** Arquivos gerados (histórico com download pelo armazenamento de Arquivos). */
export async function dominioHistory(ctx: Ctx) {
  requireAction(ctx, "data.export");
  const files = await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "dominio_export"]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 30);
  return files.map((x) => ({ id: x.id, name: x.name, sizeBytes: x.sizeBytes, createdAt: x.createdAt, period: x.entityId }));
}

/** Grava o código contábil (Domínio) de categorias financeiras e contas financeiras. Vazio remove. */
export async function saveAccountingCodes(ctx: Ctx, input: { categories?: Record<string, string>; accounts?: Record<string, string> }) {
  requirePerm(ctx, "finance", "edit");
  let changed = 0;
  for (const [collection, map] of [["fin_categories", input.categories ?? {}], ["financial_accounts", input.accounts ?? {}]] as const) {
    for (const [id, raw] of Object.entries(map)) {
      const code = String(raw ?? "").trim();
      assert(!code || /^[\w.-]{1,40}$/.test(code), `Código contábil inválido: "${code}" (letras, números, ponto ou hífen).`);
      const d = await ctx.store.get(collection, id);
      assert(d && d.companyId === ctx.companyId, "Registro de outra empresa.");
      if ((d.accountingCode ?? "") === code) continue;
      await ctx.store.update(collection, id, { accountingCode: code || null });
      changed++;
    }
  }
  if (changed) await audit(ctx, { module: "finance", action: "accounting_codes.save", entityType: "setting", entityId: "accountingCode", summary: `Códigos contábeis (Domínio) atualizados em ${changed} categoria(s)/conta(s)` });
  return { changed };
}
