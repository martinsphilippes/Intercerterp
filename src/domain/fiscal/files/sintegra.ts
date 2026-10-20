import crypto from "node:crypto";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { assert, BusinessError } from "@/lib/core/errors";
import { audit } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { getSetting } from "@/lib/core/settings";
import { allocate } from "@/lib/money";
import { dayRange, formatDate, monthEnd, today, toLocalDate } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import type { ReceiptItem } from "../../receipts";
import type { DocItem } from "../service";
import { itemAccountingValue } from "../entries";
import { assertBaseDate, fiscalInventory } from "../../inventory-fiscal";
import { alpha, blanks, code, fileText, num, record, recordType, SintegraFieldError, ymd } from "./sintegra-common";

/**
 * Arquivo SINTEGRA — Convênio ICMS 57/95 (Manual de Orientação, estrutura "3" = alterações do Convênio ICMS 76/03),
 * por estabelecimento (filial) e mês. Regras assumidas, fontes e pendências: docs/regras-assumidas.md §42.
 * VALIDAR NO VALIDADOR SINTEGRA DA UF E COM A CONTABILIDADE ANTES DO PRIMEIRO ENVIO.
 *
 * Fontes (somente leitura — nada existente muda):
 *  - SAÍDAS e entradas emitidas pela empresa: `fiscal_documents` (só documentos EMITIDOS — inventario-fiscal-documents.md),
 *    NF-e (55) autorizadas (N), canceladas (S), denegadas (2) e numeração inutilizada (4), pela data de emissão;
 *    NFC-e (65) autorizadas nos registros 61/61R quando "incluir NFC-e" estiver ligado;
 *  - ENTRADAS de terceiros: `receipts` concluídos (NF-e do fornecedor, pela data da entrada) — a entrada com NOTA A
 *    CONFIRMAR (§40) fica fora até a confirmação da nota e é listada como pendência; CT-e de frete (`inbound_ctes`) no 70;
 *  - inventário (74): `fiscalInventory` (inventário em data-base, §35) da filial, saldos positivos por SKU;
 *  - produtos (75): todo código referenciado em 54, 61R e 74.
 */

export type SintegraFinalidade = "1" | "2" | "3" | "5";
export type SintegraNatureza = "1" | "2" | "3";

export const SINTEGRA_FINALIDADES: Array<{ value: SintegraFinalidade; label: string }> = [
  { value: "1", label: "1 — Normal" },
  { value: "2", label: "2 — Retificação total (substitui o arquivo do período)" },
  { value: "3", label: "3 — Retificação aditiva (confirme se a UF ainda aceita)" },
  { value: "5", label: "5 — Desfazimento (anula o arquivo enviado)" },
];

export const SINTEGRA_NATUREZAS: Array<{ value: SintegraNatureza; label: string }> = [
  { value: "3", label: "3 — Totalidade das operações do informante" },
  { value: "2", label: "2 — Interestaduais, com ou sem substituição tributária" },
  { value: "1", label: "1 — Interestaduais, somente operações sujeitas à ST" },
];

/** Código de identificação da estrutura do arquivo (campo 10 do registro 10): Convênio 57/95 com alterações do 76/03. */
export const SINTEGRA_STRUCTURE = "3";

/** Parâmetro: incluir NFC-e (modelo 65) nos registros 61/61R. Padrão DESLIGADO (muitas UFs dispensam — §42). */
export const SINTEGRA_INCLUDE_NFCE_KEY = "sintegra.includeNfce";

export interface SintegraOptions {
  branchId: string;
  /** mês de referência "AAAA-MM" */
  period: string;
  finalidade?: SintegraFinalidade;
  natureza?: SintegraNatureza;
  /** data-base do inventário (registro 74); vazio = sem 74 */
  inventoryDate?: string | null;
  /** incluir NFC-e nos registros 61/61R; null/undefined = parâmetro `sintegra.includeNfce` */
  includeNfce?: boolean | null;
  /** contribuinte do IPI: gera o registro 51 (padrão: não) */
  ipiContributor?: boolean;
  /** nome do contato do registro 11 (padrão: usuário que gera) */
  contact?: string | null;
}

export interface SintegraPendency {
  level: "error" | "warning";
  code: string;
  message: string;
  href?: string | null;
}

export interface SintegraDocSummary {
  key: string;
  direction: "in" | "out";
  label: string;
  date: string;
  model: string;
  series: string;
  number: string;
  participant: string;
  participantDoc: string;
  uf: string;
  situation: string;
  total: number;
  href: string | null;
}

export interface SintegraResult {
  options: Required<Omit<SintegraOptions, "inventoryDate" | "contact">> & { inventoryDate: string | null; contact: string };
  from: string;
  to: string;
  branchName: string;
  fileName: string;
  lines: string[];
  text: string;
  sha256: string;
  /** quantidade de linhas por tipo (61 inclui 61R; 10, 11 e 90 inclusive) */
  counts: Record<string, number>;
  totalLines: number;
  pendencies: SintegraPendency[];
  errors: number;
  warnings: number;
  documents: SintegraDocSummary[];
  inventory: { date: string; items: number; value: number } | null;
  nfce: { included: boolean; docs: number };
  /** conferência interna: total do 50 = soma do 54 em cada documento */
  checks: { docs: number; mismatches: number };
}

/* ------------------------------------------------------------------------------------------------------------------ */

interface Party {
  name: string;
  doc: string;
  ie: string;
  uf: string;
}

interface SLine {
  seq: number;
  /** código do produto no 54/75 ("" = sem produto) */
  code: string;
  cfop: string;
  cst: string;
  qty: number;
  prod: number;
  desc: number;
  freight: number;
  insurance: number;
  other: number;
  base: number;
  rateBps: number;
  icms: number;
  stBase: number;
  st: number;
  fcpSt: number;
  ipi: number;
  ipiBase: number;
  exempt: boolean;
}

interface SDoc {
  key: string;
  direction: "in" | "out";
  emitter: "P" | "T";
  label: string;
  href: string | null;
  model: string;
  series: string;
  number: string;
  date: string;
  party: Party;
  situation: "N" | "S" | "2" | "4";
  lines: SLine[];
  /** CFOP do 50 quando não há itens (inutilização) */
  fallbackCfop?: string;
}

interface Product75 {
  code: string;
  description: string;
  ncm: string;
  unit: string;
  ipiRateBps: number;
  icmsRateBps: number;
  redBps: number;
  stBaseUnit: number;
  fromCatalog: boolean;
  ref: string;
}

const lineTotal = (l: SLine) => l.prod - l.desc + l.freight + l.insurance + l.other + l.ipi + l.st + l.fcpSt;

/** CST do item no 54 (3 posições): origem + CST (regime normal) ou o CSOSN do Simples (hipótese §42). */
export function sintegraCst(origin: string | null | undefined, cstCsosn: string | null | undefined): string {
  const c = onlyDigits(cstCsosn ?? "");
  if (c.length === 3) return c;
  if (c.length === 2) return `${onlyDigits(origin ?? "0").slice(0, 1) || "0"}${c}`;
  return "";
}

/**
 * Parcela "isenta ou não tributada" × "outras" pelo CST do ICMS (2 dígitos, sem a origem) ou CSOSN (3 dígitos):
 * CST 20/30/40/41 e CSOSN 103/203/300/400 → isenta; demais → outras (hipótese §42).
 */
export function isExemptCst(cstOrCsosn: string | null | undefined): boolean {
  const c = onlyDigits(cstOrCsosn ?? "");
  if (c.length === 3) return ["103", "203", "300", "400"].includes(c);
  return ["20", "30", "40", "41"].includes(c);
}

function periodRange(period: string) {
  assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(period), "Informe o período no formato AAAA-MM.");
  const from = `${period}-01`;
  assert(from <= today(), "O período não pode ser futuro.");
  return { from, to: monthEnd(from) };
}

/* ------------------------------------------------------------------------------------------------------------------ */

/** Linhas fiscais de um documento EMITIDO pela empresa (NF-e/NFC-e) — valores do próprio documento. */
function emittedLines(d: Doc, codeOf: (skuId: string | null | undefined, raw: string) => string): SLine[] {
  const items = (d.items ?? []) as DocItem[];
  const t = d.totals ?? {};
  const weights = items.map((i) => Math.max(0, (i.gross ?? 0) - (i.discount ?? 0)));
  const acc = (key: "freight" | "insurance" | "other") => {
    const per = items.map((i) => (i[key] as number | undefined) ?? 0);
    const sum = per.reduce((a, b) => a + b, 0);
    const total = (t[key] as number | undefined) ?? sum;
    return sum === total || !items.length ? per : allocate(total, weights);
  };
  const fr = acc("freight");
  const ins = acc("insurance");
  const ot = acc("other");
  return items.map((i, n) => {
    const cst = sintegraCst(i.origin, i.cstCsosn);
    return {
      seq: i.seq ?? n + 1,
      code: codeOf(i.skuId, i.code ?? ""),
      cfop: onlyDigits(i.cfop),
      cst,
      qty: i.qty ?? 0,
      prod: i.gross ?? 0,
      desc: i.discount ?? 0,
      freight: fr[n],
      insurance: ins[n],
      other: ot[n],
      base: i.icmsBase ?? 0,
      rateBps: i.icmsRateBps ?? 0,
      icms: i.icms ?? 0,
      stBase: i.tc?.st?.base ?? 0,
      st: i.tc?.st?.value ?? 0,
      fcpSt: i.tc?.st?.fcp ?? 0,
      ipi: 0,
      ipiBase: 0,
      exempt: isExemptCst(i.cstCsosn),
    };
  });
}

/** Código do item do recebimento no 54/75: SKU da empresa; item sem produto (nota sem estoque) = "F" + código do fornecedor. */
const receiptItemCode = (it: ReceiptItem, skuCode: (id: string) => string) => (it.skuId ? skuCode(it.skuId) : `F${it.cProd ?? it.idx}`.slice(0, 14));

/** Leva a soma das linhas ao total do documento (vNF): diferença positiva em "outras", negativa em desconto (maior linha). */
function closeLines(lines: SLine[], total: number | null | undefined): number {
  if (total == null || !lines.length) return 0;
  const diff = total - lines.reduce((a, l) => a + lineTotal(l), 0);
  if (!diff) return 0;
  const big = lines.reduce((m, l, i) => (lineTotal(l) > lineTotal(lines[m]) ? i : m), 0);
  if (diff > 0) lines[big].other += diff;
  else lines[big].desc += -diff;
  return diff;
}

/** Linhas fiscais de um recebimento (NF-e do fornecedor): valores do XML por item; sem XML, os do lançamento. */
function receiptLines(r: Doc, skuCode: (id: string) => string): { lines: SLine[]; diff: number; source: "xml" | "xml_totals" | "manual" } {
  const items: ReceiptItem[] = r.items ?? [];
  const head = onlyDigits(r.entryCfop ?? "");
  const cfopOf = (it: ReceiptItem) => onlyDigits(it.entryCfop ?? "") || head;
  const codeOf = (it: ReceiptItem) => receiptItemCode(it, skuCode);
  const qtyOf = (it: ReceiptItem) => (it.skuId ? (it.invoicedQty ?? it.receivedQty ?? 0) : (it.invoicedQtySupplier ?? it.invoicedQty ?? 0));
  const totals = r.emitter?.totals ?? null;
  const base = (it: ReceiptItem, n: number): SLine => ({ seq: it.nItem ?? n + 1, code: codeOf(it), cfop: cfopOf(it), cst: "", qty: qtyOf(it), prod: 0, desc: 0, freight: 0, insurance: 0, other: 0, base: 0, rateBps: 0, icms: 0, stBase: 0, st: 0, fcpSt: 0, ipi: 0, ipiBase: 0, exempt: false });
  if (items.some((it) => it.fiscal && Object.keys(it.fiscal).length)) {
    const lines = items.map((it, n) => {
      const f = it.fiscal ?? {};
      const cst = f.csosn ? onlyDigits(f.csosn) : sintegraCst(f.orig, f.cst);
      const l = base(it, n);
      Object.assign(l, {
        cst,
        prod: f.vProd ?? it.invoicedValue ?? 0,
        desc: f.vDesc ?? 0,
        freight: f.vFrete ?? 0,
        insurance: f.vSeg ?? 0,
        other: (f.vOutro ?? 0) + (f.vII ?? 0),
        base: f.vBC ?? 0,
        rateBps: f.pICMS ?? 0,
        icms: f.vICMS ?? 0,
        stBase: f.vBCST ?? 0,
        st: f.vICMSST ?? 0,
        fcpSt: f.vFCPST ?? 0,
        ipi: (f.vIPI ?? 0) + (f.vIPIDevol ?? 0),
        ipiBase: f.vBCIPI ?? 0,
        exempt: isExemptCst(f.csosn ?? f.cst),
      });
      // nota sem estoque lançada sem XML: valor contábil informado no item (vItem)
      if (f.vItem != null && f.vProd == null) l.prod = itemAccountingValue(f);
      return l;
    });
    const docTotal = totals?.vNF ?? (r.entryKind === "no_stock" ? (r.invoicedTotal ?? r.total ?? null) : null);
    return { lines, diff: closeLines(lines, docTotal), source: "xml" };
  }
  if (r.xmlFileId && totals) {
    const w = items.map((it) => Math.max(0, it.invoicedValue ?? 0));
    const share = (v: number | undefined) => allocate(v ?? 0, w);
    const fr = share(totals.vFrete);
    const sg = share(totals.vSeg);
    const ot = share(totals.vOutro);
    const ds = share(totals.vDesc);
    const ipi = share(totals.vIPI);
    const st = share(totals.vST);
    const bc = share(totals.vBC);
    const icms = share(totals.vICMS);
    const bcst = share(totals.vBCST);
    const lines = items.map((it, n) => {
      const l = base(it, n);
      Object.assign(l, { cst: "090", prod: it.invoicedValue ?? 0, desc: ds[n], freight: fr[n], insurance: sg[n], other: ot[n], ipi: ipi[n], st: st[n], base: bc[n], icms: icms[n], stBase: bcst[n], rateBps: bc[n] ? Math.round((icms[n] * 10000) / bc[n] / 100) * 100 : 0 });
      return l;
    });
    return { lines, diff: closeLines(lines, totals.vNF), source: "xml_totals" };
  }
  const active = items.filter((it) => !it.ignore && it.skuId && it.receivedQty > 0);
  const lines = active.map((it, n) => {
    const l = base(it, n);
    Object.assign(l, { cst: "090", qty: it.receivedQty, prod: it.lineValue ?? 0, desc: it.discountShare ?? 0, freight: it.freightShare ?? 0, other: it.otherShare ?? 0 });
    return l;
  });
  return { lines, diff: closeLines(lines, r.dueTotal ?? null), source: "manual" };
}

interface R50 {
  cfop: string;
  rateBps: number;
  total: number;
  base: number;
  icms: number;
  exempt: number;
  other: number;
}

/** Registros 50 do documento: um por CFOP × alíquota (cancelado/denegado/inutilizado: valores zerados). */
function rows50(d: SDoc): R50[] {
  if (!d.lines.length) return [{ cfop: d.fallbackCfop ?? "0000", rateBps: 0, total: 0, base: 0, icms: 0, exempt: 0, other: 0 }];
  const zero = d.situation !== "N";
  const by = new Map<string, R50>();
  for (const l of d.lines) {
    const k = `${l.cfop}|${l.rateBps}`;
    const g = by.get(k) ?? { cfop: l.cfop, rateBps: l.rateBps, total: 0, base: 0, icms: 0, exempt: 0, other: 0 };
    if (!zero) {
      const tot = lineTotal(l);
      const st = l.st + l.fcpSt;
      const rest = tot - l.base - st;
      g.total += tot;
      g.base += l.base;
      g.icms += l.icms;
      if (l.exempt) g.exempt += rest;
      else g.other += rest;
      g.other += st;
    }
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => a.cfop.localeCompare(b.cfop) || a.rateBps - b.rateBps);
}

/** CFOP de maior participação no documento (registros 991/992/999 — item 13.1.4.2 do manual). */
function mainLine(d: SDoc): SLine {
  return d.lines.reduce((m, l) => (lineTotal(l) > lineTotal(m) ? l : m), d.lines[0]);
}

/* ------------------------------------------------------------------------------------------------------------------ */

/** Monta o arquivo (sem gravar). Pendências bloqueantes ("error") impedem a geração sem confirmação explícita. */
export async function buildSintegra(ctx: Ctx, input: SintegraOptions): Promise<SintegraResult> {
  requireAction(ctx, "fiscal.files");
  const { from, to } = periodRange(input.period);
  const finalidade: SintegraFinalidade = input.finalidade ?? "1";
  const natureza: SintegraNatureza = input.natureza ?? "3";
  assert(SINTEGRA_FINALIDADES.some((f) => f.value === finalidade), "Finalidade do arquivo inválida.");
  assert(SINTEGRA_NATUREZAS.some((n) => n.value === natureza), "Natureza das operações inválida.");
  const branch = await ctx.store.get("branches", input.branchId);
  assert(branch && branch.companyId === ctx.companyId, "Estabelecimento (filial) não pertence à empresa ativa.");
  assert(!ctx.branchId || ctx.branchId === branch.id, "Selecione o estabelecimento da filial atual (ou use a visão consolidada).");
  assert(ctx.user.isAdmin || !ctx.user.branchIds?.length || ctx.user.branchIds.includes(branch.id), "Você não tem acesso a esta filial.");
  const inventoryDate = input.inventoryDate || null;
  if (inventoryDate) {
    assertBaseDate(inventoryDate);
    assert(inventoryDate <= to, "A data-base do inventário não pode ser posterior ao fim do período do arquivo.");
  }
  const includeNfce = input.includeNfce ?? Boolean(await getSetting(ctx.store, ctx.companyId, branch.id, SINTEGRA_INCLUDE_NFCE_KEY, false));
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const contact = (input.contact ?? "").trim() || ctx.user.name;
  const options = { branchId: branch.id, period: input.period, finalidade, natureza, inventoryDate, includeNfce, ipiContributor: Boolean(input.ipiContributor), contact };

  const pend: SintegraPendency[] = [];
  const err = (codeKey: string, message: string, href?: string | null) => pend.push({ level: "error", code: codeKey, message, href: href ?? null });
  const warn = (codeKey: string, message: string, href?: string | null) => pend.push({ level: "warning", code: codeKey, message, href: href ?? null });

  // ---- estabelecimento (10/11)
  const addr = branch.address ?? company.address ?? {};
  const est = {
    cnpj: onlyDigits(branch.cnpj ?? company.cnpj ?? ""),
    ie: onlyDigits(branch.ie ?? company.ie ?? "") || String(branch.ie ?? company.ie ?? "").trim(),
    uf: String(addr.uf ?? branch.uf ?? "").toUpperCase(),
    city: String(addr.cityName ?? branch.cityName ?? ""),
  };
  const estHref = `/administracao/empresas`;
  if (est.cnpj.length !== 14) err("est_cnpj", `Estabelecimento ${branch.name}: CNPJ não cadastrado ou inválido.`, estHref);
  if (!est.ie) err("est_ie", `Estabelecimento ${branch.name}: inscrição estadual não cadastrada.`, estHref);
  if (!est.uf) err("est_uf", `Estabelecimento ${branch.name}: UF não cadastrada.`, estHref);
  if (!est.city) err("est_city", `Estabelecimento ${branch.name}: município não cadastrado.`, estHref);
  if (!addr.street || !addr.zip) warn("est_address", `Estabelecimento ${branch.name}: logradouro/CEP incompletos no cadastro (registro 11).`, estHref);
  if (finalidade === "3") warn("finalidade_3", "Finalidade 3 (retificação aditiva) não consta da tabela vigente reproduzida pelas UFs (RICMS/MG, Anexo VII) — confirme com a SEFAZ antes de enviar.");

  const skus = new Map<string, Doc>();
  const products = new Map<string, Doc>();
  const taxGroups = new Map<string, Doc>();
  const cid: any[] = [["eq", "companyId", ctx.companyId]];
  const [skuList, productList, tgList] = await Promise.all([listAll(ctx.store, "skus", { filters: cid }), listAll(ctx.store, "products", { filters: cid }), listAll(ctx.store, "tax_groups", { filters: cid })]);
  for (const s of skuList) skus.set(s.id, s);
  for (const p of productList) products.set(p.id, p);
  for (const g of tgList) taxGroups.set(g.id, g);
  // código do produto no 54/61R/74/75 (14 posições): o SKU; acima de 14, o GTIN (item 13.1.7.1 do manual) ou o SKU
  // truncado — o mesmo código em todos os registros; colisão entre produtos diferentes é pendência bloqueante
  const resolved = new Map<string, string>();
  const owners = new Map<string, Set<string>>();
  const own = (c: string, who: string) => {
    if (!c) return c;
    const set = owners.get(c) ?? new Set<string>();
    set.add(who);
    owners.set(c, set);
    return c;
  };
  const skuCode = (id: string) => {
    const hit = resolved.get(id);
    if (hit) return own(hit, id);
    const sku = skus.get(id);
    const raw = String(sku?.sku ?? id);
    let c = raw;
    if (raw.length > 14) {
      const gtin = onlyDigits(sku?.barcode ?? "");
      c = gtin.length >= 8 && gtin.length <= 14 ? gtin : raw.slice(0, 14);
      warn("product_code_long", `Produto ${raw}: código com mais de 14 posições — informado como "${c}" ${c === gtin ? "(GTIN)" : "(truncado)"} em todos os registros do Sintegra.`);
    }
    resolved.set(id, c);
    return own(c, id);
  };
  const itemCode = (skuId: string | null | undefined, raw: string) => {
    if (skuId) return skuCode(skuId);
    const c = raw.slice(0, 14);
    if (raw.length > 14) warn("product_code_long", `Item sem produto cadastrado com código "${raw}" de mais de 14 posições — truncado para "${c}".`);
    return own(c, `raw:${raw}`);
  };

  const { start, end } = dayRange(from, to);
  const docs: SDoc[] = [];
  const nfceDocs: Doc[] = [];
  const includeData = finalidade !== "5";

  // produtos referenciados (75)
  const p75 = new Map<string, Product75>();
  const registerSku = (skuId: string | null | undefined, fallback: Omit<Product75, "fromCatalog" | "stBaseUnit" | "ref"> & { ref: string }) => {
    const sku = skuId ? skus.get(skuId) : undefined;
    const product = sku ? products.get(sku.productId) : undefined;
    const tg = product?.taxGroupId ? taxGroups.get(product.taxGroupId) : undefined;
    const c = fallback.code;
    if (!c) return;
    const cur = p75.get(c);
    if (cur && (cur.fromCatalog || !sku)) return;
    p75.set(c, {
      code: c,
      description: sku ? String(sku.name ?? product?.name ?? fallback.description) : fallback.description,
      ncm: onlyDigits(product?.ncm ?? fallback.ncm ?? ""),
      unit: String(sku?.unitCode ?? product?.unitCode ?? fallback.unit ?? "").trim(),
      ipiRateBps: tg?.ipiRateBps ?? fallback.ipiRateBps ?? 0,
      icmsRateBps: tg?.icmsRateBps ?? fallback.icmsRateBps ?? 0,
      redBps: tg?.icmsBaseReductionBps ?? fallback.redBps ?? 0,
      stBaseUnit: cur?.stBaseUnit ?? 0,
      fromCatalog: Boolean(sku),
      ref: fallback.ref,
    });
  };
  const noteStBase = (c: string, l: SLine) => {
    const p = p75.get(c);
    if (p && !p.stBaseUnit && l.stBase > 0 && l.qty > 0) p.stBaseUnit = Math.round((l.stBase * 1000) / l.qty);
  };

  const partyCheck = (d: SDoc) => {
    const p = d.party;
    if (p.uf === "EX") return;
    if (!p.doc) err("party_doc", `${d.label}: participante "${p.name}" sem CNPJ/CPF.`, d.href);
    if (!p.uf) err("party_uf", `${d.label}: participante "${p.name}" sem UF.`, d.href);
    if (p.doc.length === 14 && !p.ie) warn("party_ie", `${d.label}: participante "${p.name}" sem inscrição estadual — informado "ISENTO".`, d.href);
  };

  if (includeData) {
    // ---- documentos emitidos pela empresa (fiscal_documents: só emitidos)
    const fdocs = await listAll(ctx.store, "fiscal_documents", { filters: [...cid, ["eq", "branchId", branch.id], ["gte", "issuedAt", start], ["lt", "issuedAt", end]], orderBy: [{ field: "issuedAt", dir: "asc" }] });
    const partyIds = [...new Set(fdocs.map((d) => d.partyId).filter(Boolean))] as string[];
    const partyDocs = new Map<string, Doc>();
    for (let i = 0; i < partyIds.length; i += 100) {
      const slice = partyIds.slice(i, i + 100);
      for (const coll of ["customers", "suppliers"]) for (const x of await listAll(ctx.store, coll, { filters: [["eq", "id", slice]] })) partyDocs.set(x.id, x);
    }
    let simulated = 0;
    for (const d of fdocs) {
      if (d.isSimulated) simulated++;
      if (d.model === "nfce") {
        if (d.status === "authorized") nfceDocs.push(d);
        continue;
      }
      if (d.model !== "nfe") continue;
      const href = `/fiscal/nfe/${d.id}`;
      if (d.originType === "disable") {
        if (d.status !== "unused") continue;
        const fromN = Number(d.service?.disableFrom ?? d.number);
        const toN = Number(d.service?.disableTo ?? d.number);
        for (let n = fromN; n <= toN && n - fromN < 10000; n++) {
          docs.push({
            key: `disable:${d.id}:${n}`, direction: "out", emitter: "P", label: `NF-e ${n} (inutilizada)`, href, model: "55", series: String(d.series ?? ""), number: String(n), date: toLocalDate(d.issuedAt),
            party: { name: company.name, doc: est.cnpj, ie: est.ie, uf: est.uf }, situation: "4", lines: [], fallbackCfop: "0000",
          });
        }
        continue;
      }
      if (d.status === "unused") continue; // número dentro de faixa inutilizada: vem pelo registro de inutilização
      if (!["authorized", "cancelled", "denied"].includes(d.status)) {
        warn("doc_not_final", `NF-e ${d.number ?? d.ref} emitida no período ainda não autorizada (${d.status}) — fora do arquivo até o retorno da SEFAZ.`, href);
        continue;
      }
      const party = d.partyId ? partyDocs.get(d.partyId) : undefined;
      const rdoc = onlyDigits(d.recipientDoc ?? d.recipient?.doc ?? party?.doc ?? "");
      const ruf = String(d.recipient?.address?.uf ?? party?.addresses?.[0]?.uf ?? "").toUpperCase();
      const rie = onlyDigits(d.recipient?.ie ?? party?.ie ?? "");
      const lines = emittedLines(d, itemCode);
      const sdoc: SDoc = {
        key: `fd:${d.id}`, direction: d.operationType === "entrada" ? "in" : "out", emitter: "P", label: `NF-e ${d.number ?? "s/nº"}${d.operationType === "entrada" ? " (entrada própria)" : ""}`, href, model: "55",
        series: String(d.series ?? ""), number: d.number != null ? String(d.number) : "", date: toLocalDate(d.issuedAt),
        party: { name: String(d.recipientName ?? party?.name ?? "—"), doc: rdoc, ie: rie, uf: ruf },
        situation: d.status === "authorized" ? "N" : d.status === "cancelled" ? "S" : "2", lines,
      };
      if (sdoc.situation === "N") {
        const sum = lines.reduce((a, l) => a + lineTotal(l), 0);
        if (d.total != null && sum !== d.total) err("doc_total", `${sdoc.label}: soma dos itens (${sum}) difere do total do documento (${d.total}).`, href);
        for (const [i, l] of lines.entries()) registerSku((d.items[i] as DocItem).skuId, { code: l.code, description: (d.items[i] as DocItem).description, ncm: (d.items[i] as DocItem).ncm, unit: (d.items[i] as DocItem).unit, ipiRateBps: 0, icmsRateBps: l.rateBps, redBps: (d.items[i] as DocItem).icmsBaseReductionBps ?? 0, ref: sdoc.label });
      }
      docs.push(sdoc);
    }
    if (simulated) warn("simulated", `${simulated} documento(s) do período emitidos pelo provedor de SIMULAÇÃO (sem validade fiscal) — não envie este arquivo à SEFAZ.`);

    // ---- recebimentos (NF-e de fornecedores) pela data da entrada
    const receiptsAll = await listAll(ctx.store, "receipts", { filters: [...cid, ["eq", "branchId", branch.id], ["eq", "status", "confirmed"], ["gte", "confirmedAt", start], ["lt", "confirmedAt", end]], orderBy: [{ field: "confirmedAt", dir: "asc" }] });
    const drafts = await listAll(ctx.store, "receipts", { filters: [...cid, ["eq", "branchId", branch.id], ["eq", "status", ["draft", "confirming"]]] });
    const ctes = await listAll(ctx.store, "inbound_ctes", { filters: [...cid, ["eq", "branchId", branch.id], ["eq", "status", "registered"], ["gte", "registeredAt", start], ["lt", "registeredAt", end]], orderBy: [{ field: "registeredAt", dir: "asc" }] });
    const supplierIds = [...new Set([...receiptsAll.map((r) => r.supplierId), ...drafts.map((r) => r.supplierId), ...ctes.map((c) => c.carrierId)].filter(Boolean))] as string[];
    const suppliers = new Map<string, Doc>();
    for (let i = 0; i < supplierIds.length; i += 100) for (const s of await listAll(ctx.store, "suppliers", { filters: [["eq", "id", supplierIds.slice(i, i + 100)]] })) suppliers.set(s.id, s);
    for (const r of receiptsAll) {
      const sup = suppliers.get(r.supplierId);
      const href = `/compras/recebimentos/${r.id}`;
      const who = sup?.name ?? r.emitter?.name ?? "fornecedor";
      if (r.documentStatus === "pending_invoice") {
        warn("pending_invoice", `Recebimento nº ${r.number} (${who}) com NOTA A CONFIRMAR — fora do arquivo até a confirmação da nota do fornecedor (§40).`, href);
        continue;
      }
      const noStock = r.entryKind === "no_stock";
      const model = r.nfeKey ? "55" : noStock ? String(r.emitter?.docModel ?? "other") : "55";
      if (model !== "55") {
        warn("not_icms", `Nota sem estoque nº ${r.number} (${who}) é ${model === "nfse" ? "NFS-e (ISS)" : "documento não modelo 55"} — fora do Sintegra.`, href);
        continue;
      }
      const label = `NF-e ${r.nfeNumber ?? "s/nº"} de ${who} (recebimento nº ${r.number})`;
      if (!r.nfeNumber) {
        err("doc_number", `${label}: documento sem número da nota.`, href);
        continue;
      }
      if (!r.nfeSeries) warn("doc_series", `${label}: documento sem série — informada em branco.`, href);
      if (!r.nfeKey) warn("doc_key", `${label}: sem chave de acesso — modelo 55 assumido.`, href);
      if (r.emitter?.environment === "homologacao") warn("homologation", `${label}: NF-e de HOMOLOGAÇÃO (sem valor fiscal).`, href);
      const { lines, diff, source } = receiptLines(r, skuCode);
      if (source === "manual") warn("no_xml", `${label}: sem XML — valores do lançamento, sem base/ICMS (CST 090 assumido).`, href);
      if (diff) warn("vnf_diff", `${label}: diferença de ${diff} centavo(s) entre o total da nota e os itens (ex.: ICMS desonerado) ajustada na maior linha.`, href);
      const docU = onlyDigits(r.emitter?.cnpj ?? r.emitter?.cpf ?? sup?.doc ?? "");
      const sdoc: SDoc = {
        key: `rc:${r.id}`, direction: "in", emitter: "T", label, href, model: "55", series: String(r.nfeSeries ?? ""), number: String(r.nfeNumber), date: toLocalDate(r.confirmedAt ?? r.createdAt),
        party: { name: who, doc: docU, ie: onlyDigits(r.emitter?.ie ?? sup?.ie ?? ""), uf: String(r.emitter?.address?.uf ?? r.emitter?.uf ?? sup?.addresses?.[0]?.uf ?? "").toUpperCase() },
        situation: "N", lines,
      };
      const items: ReceiptItem[] = r.items ?? [];
      for (const l of lines) {
        const it = items.find((x) => receiptItemCode(x, skuCode) === l.code);
        registerSku(it?.skuId, { code: l.code, description: String(it?.xProd ?? it?.description ?? l.code), ncm: String(it?.ncm ?? ""), unit: String(it?.uCom ?? it?.unitCode ?? ""), ipiRateBps: it?.fiscal?.pIPI ?? 0, icmsRateBps: l.rateBps, redBps: 0, ref: label });
      }
      docs.push(sdoc);
    }
    for (const r of drafts) {
      if (r.entryKind === "no_stock" || r.documentStatus === "pending_invoice" || !r.nfeIssueDate) continue;
      const d = toLocalDate(r.nfeIssueDate);
      if (d >= from && d <= to) warn("receipt_in_progress", `Recebimento nº ${r.number} (NF-e ${r.nfeNumber ?? "—"}) emitida no período ainda em conferência — fora do arquivo até a conclusão.`, `/compras/recebimentos/${r.id}`);
    }

    // ---- CT-e de entrada (70)
    for (const c of ctes) {
      const car = suppliers.get(c.carrierId);
      const label = `CT-e ${c.cteNumber ?? "s/nº"} de ${car?.name ?? c.emitter?.name ?? "transportadora"}`;
      const href = `/compras/cte/${c.id}`;
      if (!c.cteNumber) {
        err("doc_number", `${label}: documento sem número.`, href);
        continue;
      }
      if (c.environment === "homologacao") warn("homologation", `${label}: CT-e de HOMOLOGAÇÃO (sem valor fiscal).`, href);
      const icms = c.icms ?? {};
      const cst = String(icms.cst ?? "");
      docs.push({
        key: `cte:${c.id}`, direction: "in", emitter: "T", label, href, model: "57", series: String(c.cteSeries ?? ""), number: String(c.cteNumber), date: toLocalDate(c.registeredAt ?? c.createdAt),
        party: { name: car?.name ?? c.emitter?.name ?? "—", doc: onlyDigits(c.emitter?.cnpj ?? c.emitter?.cpf ?? car?.doc ?? ""), ie: onlyDigits(c.emitter?.ie ?? car?.ie ?? ""), uf: String(c.emitter?.uf ?? car?.addresses?.[0]?.uf ?? "").toUpperCase() },
        situation: "N",
        lines: [{ seq: 1, code: "", cfop: onlyDigits(c.entryCfop ?? c.cfop ?? ""), cst, qty: 0, prod: c.total ?? 0, desc: 0, freight: 0, insurance: 0, other: 0, base: icms.vBC ?? 0, rateBps: icms.pICMS ?? 0, icms: icms.vICMS ?? 0, stBase: 0, st: 0, fcpSt: 0, ipi: 0, ipiBase: 0, exempt: isExemptCst(cst) }],
      });
    }
  }

  // ---- natureza das operações (1/2 = só interestaduais)
  const interstate = (d: SDoc) => Boolean(d.party.uf) && d.party.uf !== est.uf;
  const inScope = (d: SDoc) => natureza === "3" || (interstate(d) && (natureza === "2" || d.lines.some((l) => l.st > 0)));
  const scoped = docs.filter(inScope);
  for (const d of scoped) {
    if (d.situation === "4") continue;
    partyCheck(d);
    if (!d.number) err("doc_number", `${d.label}: documento sem número.`, d.href);
    else if (!d.series && d.model === "55" && d.emitter === "P") warn("doc_series", `${d.label}: documento sem série.`, d.href);
    if (d.situation === "N") {
      for (const l of d.lines) {
        if (!/^\d{4}$/.test(l.cfop)) err("cfop", `${d.label}: item ${l.seq} sem CFOP válido.`, d.href);
        if (d.model === "55" && l.seq > 990) err("item_seq", `${d.label}: mais de 990 itens (limite do registro 54).`, d.href);
        if (lineTotal(l) < 0) err("negative", `${d.label}: item ${l.seq} com valor negativo.`, d.href);
      }
    }
  }
  const nf = scoped.filter((d) => d.model === "55");
  const ct = scoped.filter((d) => d.model === "57");

  // ---- NFC-e (61/61R)
  const nfceIn = includeData && includeNfce && natureza === "3" ? nfceDocs : [];
  if (includeData && !includeNfce && nfceDocs.length) warn("nfce_excluded", `${nfceDocs.length} NFC-e autorizada(s) no período fora do arquivo (parâmetro "incluir NFC-e" desligado — confirme a dispensa na sua UF).`);
  const nfceLines = nfceIn.map((d) => ({ d, lines: emittedLines(d, itemCode) }));
  for (const { d, lines } of nfceLines) for (const [i, l] of lines.entries()) registerSku((d.items[i] as DocItem).skuId, { code: l.code, description: (d.items[i] as DocItem).description, ncm: (d.items[i] as DocItem).ncm, unit: (d.items[i] as DocItem).unit, ipiRateBps: 0, icmsRateBps: l.rateBps, redBps: 0, ref: `NFC-e ${d.number}` });

  // ---- inventário (74)
  let inventory: SintegraResult["inventory"] = null;
  const inv74: Array<{ code: string; qty: number; value: number }> = [];
  if (includeData && inventoryDate) {
    const inv = await fiscalInventory(ctx.store, ctx.companyId, { date: inventoryDate, branchIds: [branch.id] });
    const by = new Map<string, { code: string; qty: number; value: number }>();
    for (const r of inv.rows) {
      if (r.negative) {
        warn("inventory_negative", `Inventário em ${formatDate(inventoryDate)}: saldo NEGATIVO de ${r.skuCode} em ${r.warehouseName} — fora do registro 74 (corrija por inventário).`, "/estoque/inventario-fiscal");
        continue;
      }
      const c = skuCode(r.skuId);
      const g = by.get(c) ?? { code: c, qty: 0, value: 0 };
      g.qty += r.qty;
      g.value += r.value;
      by.set(c, g);
      registerSku(r.skuId, { code: c, description: r.skuName, ncm: r.ncm, unit: r.unitCode, ipiRateBps: 0, icmsRateBps: 0, redBps: 0, ref: `Inventário ${formatDate(inventoryDate)}` });
    }
    inv74.push(...[...by.values()].filter((g) => g.qty > 0).sort((a, b) => a.code.localeCompare(b.code)));
    inventory = { date: inventoryDate, items: inv74.length, value: inv74.reduce((a, g) => a + g.value, 0) };
    if (Math.abs(inventory.value - inv.totals.value) > 0) warn("inventory_total", "Total do registro 74 difere do inventário em data-base (verifique saldos).");
  }

  // ---- montagem das linhas
  const L: string[] = [];
  const emitErr = (e: unknown, where: string) => {
    if (e instanceof SintegraFieldError) err("format", `${where}: ${e.message}`);
    else throw e;
  };
  const ieOf = (p: Party) => (p.ie ? p.ie : "ISENTO");
  const partyDoc = (p: Party) => (p.uf === "EX" ? "" : p.doc);

  // 10
  try {
    L.push(record("10", ["10", code(est.cnpj, 14), alpha(est.ie, 14), alpha(company.name, 35), alpha(est.city, 30), alpha(est.uf, 2), code(branch.fax ?? company.fax ?? "", 10), ymd(from), ymd(to), SINTEGRA_STRUCTURE, natureza, finalidade]));
    // 11
    L.push(record("11", ["11", alpha(addr.street ?? "", 34), code(addr.number ?? "", 5), alpha(addr.complement ?? "", 22), alpha(addr.district ?? "", 15), code(addr.zip ?? "", 8), alpha(contact, 28), code(branch.phone ?? company.phone ?? "", 12)]));
  } catch (e) {
    emitErr(e, "Registro 10/11");
  }

  const docKeyCmp = (a: SDoc, b: SDoc) => a.date.localeCompare(b.date) || partyDoc(a.party).localeCompare(partyDoc(b.party)) || a.model.localeCompare(b.model) || a.series.localeCompare(b.series) || Number(a.number) - Number(b.number);
  const nfSorted = [...nf].sort(docKeyCmp);
  const head = (d: SDoc) => [code(partyDoc(d.party), 14), alpha(ieOf(d.party), 14), ymd(d.date), alpha(d.party.uf, 2), code(d.model, 2), alpha(d.series, 3), code(d.number, 6)];
  const l50: string[] = [];
  const l51: string[] = [];
  const l53: string[] = [];
  const l54: Array<{ sort: string; line: string }> = [];
  let mismatches = 0;
  for (const d of nfSorted) {
    try {
      const rows = rows50(d);
      for (const r of rows) l50.push(record("50", ["50", ...head(d), code(r.cfop, 4), d.emitter, num(r.total, 13, "valor total"), num(r.base, 13, "base ICMS"), num(r.icms, 13, "ICMS"), num(r.exempt, 13, "isenta"), num(r.other, 13, "outras"), num(r.rateBps, 4, "alíquota"), d.situation]));
      if (d.situation !== "N") continue;
      // 51 — IPI (somente contribuinte do IPI)
      if (options.ipiContributor) {
        const byCfop = new Map<string, { total: number; ipi: number; ipiBase: number }>();
        for (const l of d.lines) {
          const g = byCfop.get(l.cfop) ?? { total: 0, ipi: 0, ipiBase: 0 };
          g.total += lineTotal(l);
          g.ipi += l.ipi;
          g.ipiBase += l.ipiBase || (l.ipi ? l.prod : 0);
          byCfop.set(l.cfop, g);
        }
        for (const [cfop, g] of [...byCfop].sort()) l51.push(record("51", ["51", code(partyDoc(d.party), 14), alpha(ieOf(d.party), 14), ymd(d.date), alpha(d.party.uf, 2), alpha(d.series, 3), code(d.number, 6), code(cfop, 4), num(g.total, 13), num(g.ipi, 13), num(0, 13), num(Math.max(0, g.total - g.ipiBase), 13), blanks(20), d.situation]));
      }
      // 53 — substituição tributária
      const stLines = d.lines.filter((l) => l.stBase > 0 || l.st > 0);
      if (stLines.length) {
        const byCfop = new Map<string, { base: number; st: number; acc: number }>();
        for (const l of stLines) {
          const g = byCfop.get(l.cfop) ?? { base: 0, st: 0, acc: 0 };
          g.base += l.stBase;
          g.st += l.st;
          g.acc += l.freight + l.insurance + l.other;
          byCfop.set(l.cfop, g);
        }
        for (const [cfop, g] of [...byCfop].sort()) l53.push(record("53", ["53", ...head(d), code(cfop, 4), d.emitter, num(g.base, 13), num(g.st, 13), num(g.acc, 13), d.situation, " ", blanks(29)]));
      }
      // 54 — itens + 991 (frete), 992 (seguro), 999 (outras despesas)
      const k = `${code(partyDoc(d.party), 14)}${d.model}${alpha(d.series, 3)}${code(d.number, 6)}`;
      let sum54 = 0;
      let base54 = 0;
      for (const l of d.lines) {
        l54.push({ sort: `${k}${l.cfop}${String(l.seq).padStart(3, "0")}`, line: record("54", ["54", code(partyDoc(d.party), 14), code(d.model, 2), alpha(d.series, 3), code(d.number, 6), code(l.cfop, 4), alpha(l.cst, 3), num(l.seq, 3, "número do item"), alpha(l.code, 14), num(l.qty, 11, "quantidade"), num(l.prod, 12, "valor do produto"), num(l.desc, 12, "desconto"), num(l.base, 12, "base ICMS"), num(l.stBase, 12, "base ST"), num(l.ipi, 12, "IPI"), num(l.rateBps, 4, "alíquota")]) });
        sum54 += l.prod - l.desc + l.ipi + l.st + l.fcpSt;
        base54 += l.base;
        noteStBase(l.code, l);
      }
      const main = mainLine(d);
      for (const [item, value] of [["991", d.lines.reduce((a, l) => a + l.freight, 0)], ["992", d.lines.reduce((a, l) => a + l.insurance, 0)], ["999", d.lines.reduce((a, l) => a + l.other, 0)]] as const) {
        if (!value) continue;
        l54.push({ sort: `${k}${main.cfop}${item}`, line: record("54", ["54", code(partyDoc(d.party), 14), code(d.model, 2), alpha(d.series, 3), code(d.number, 6), code(main.cfop, 4), alpha(main.cst, 3), item, blanks(14), num(0, 11), num(0, 12), num(value, 12, "despesa acessória"), num(0, 12), num(0, 12), num(0, 12), num(0, 4)]) });
        sum54 += value;
      }
      const t50 = rows.reduce((a, r) => a + r.total, 0);
      const b50 = rows.reduce((a, r) => a + r.base, 0);
      if (t50 !== sum54 || b50 !== base54) {
        mismatches++;
        err("check_50_54", `${d.label}: total do registro 50 (${t50}) não confere com a soma dos registros 54 (${sum54}).`, d.href);
      }
    } catch (e) {
      emitErr(e, d.label);
    }
  }
  l54.sort((a, b) => a.sort.localeCompare(b.sort));

  // 61 / 61R
  const l61: string[] = [];
  const l61r: string[] = [];
  if (nfceLines.length) {
    const g61 = new Map<string, { date: string; series: string; rateBps: number; first: number; last: number; total: number; base: number; icms: number; exempt: number; other: number }>();
    const g61r = new Map<string, { code: string; rateBps: number; qty: number; value: number; base: number }>();
    for (const { d, lines } of nfceLines) {
      const date = toLocalDate(d.issuedAt);
      const n = Number(d.number ?? 0);
      for (const l of lines) {
        const k = `${date}|${d.series ?? ""}|${String(l.rateBps).padStart(4, "0")}`;
        const g = g61.get(k) ?? { date, series: String(d.series ?? ""), rateBps: l.rateBps, first: n, last: n, total: 0, base: 0, icms: 0, exempt: 0, other: 0 };
        const tot = lineTotal(l);
        const rest = tot - l.base - l.st - l.fcpSt;
        g.first = Math.min(g.first, n);
        g.last = Math.max(g.last, n);
        g.total += tot;
        g.base += l.base;
        g.icms += l.icms;
        if (l.exempt) g.exempt += rest;
        else g.other += rest;
        g.other += l.st + l.fcpSt;
        g61.set(k, g);
        const kr = `${l.code}|${String(l.rateBps).padStart(4, "0")}`;
        const r = g61r.get(kr) ?? { code: l.code, rateBps: l.rateBps, qty: 0, value: 0, base: 0 };
        r.qty += l.qty;
        r.value += tot;
        r.base += l.base;
        g61r.set(kr, r);
      }
    }
    try {
      for (const [, g] of [...g61].sort(([a], [b]) => a.localeCompare(b))) l61.push(record("61", ["61", blanks(14), blanks(14), ymd(g.date), "65", alpha(g.series, 3), blanks(2), code(g.first, 6), code(g.last, 6), num(g.total, 13), num(g.base, 13), num(g.icms, 12), num(g.exempt, 13), num(g.other, 13), num(g.rateBps, 4), " "]));
      const mmyyyy = `${input.period.slice(5, 7)}${input.period.slice(0, 4)}`;
      for (const [, r] of [...g61r].sort(([a], [b]) => a.localeCompare(b))) l61r.push(record("61R", ["61", "R", mmyyyy, alpha(r.code, 14), num(r.qty, 13, "quantidade"), num(r.value, 16), num(r.base, 16), num(r.rateBps, 4), blanks(54)]));
    } catch (e) {
      emitErr(e, "Registro 61/61R");
    }
  }

  // 70 — CT-e (tomador = a empresa: frete FOB)
  const l70: string[] = [];
  for (const d of [...ct].sort(docKeyCmp)) {
    try {
      const l = d.lines[0];
      const rest = l.prod - l.base;
      l70.push(record("70", ["70", code(partyDoc(d.party), 14), alpha(ieOf(d.party), 14), ymd(d.date), alpha(d.party.uf, 2), "57", alpha(d.series.slice(-1), 1), blanks(2), code(d.number, 6), code(l.cfop, 4), num(l.prod, 13), num(l.base, 14), num(l.icms, 14), num(l.exempt ? rest : 0, 14), num(l.exempt ? 0 : rest, 14), "2", d.situation]));
      if (d.series.length > 1) warn("cte_series", `${d.label}: série "${d.series}" com mais de 1 posição — informado o último dígito (o registro 70 tem série de 1 posição).`, d.href);
    } catch (e) {
      emitErr(e, d.label);
    }
  }

  // 74 — inventário
  const l74: string[] = [];
  try {
    for (const g of inv74) l74.push(record("74", ["74", ymd(inventoryDate), alpha(g.code, 14), num(g.qty, 13, "quantidade"), num(g.value, 13, "valor"), "1", code("", 14), blanks(14), alpha(est.uf, 2), blanks(45)]));
  } catch (e) {
    emitErr(e, "Registro 74");
  }

  // 75 — produtos referenciados
  const l75: string[] = [];
  for (const p of [...p75.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!p.ncm) err("product_ncm", `Produto ${p.code} (${p.description}) sem NCM (registro 75 — referência: ${p.ref}).`);
    if (!p.unit) err("product_unit", `Produto ${p.code} (${p.description}) sem unidade de medida (registro 75 — referência: ${p.ref}).`);
    if ((owners.get(p.code)?.size ?? 0) > 1) err("product_code", `Código ${p.code} no Sintegra corresponde a mais de um produto (códigos com mais de 14 posições coincidem ao truncar) — ajuste o código/GTIN no cadastro.`);
    try {
      l75.push(record("75", ["75", ymd(from), ymd(to), alpha(p.code, 14), alpha(p.ncm, 8), alpha(p.description, 53), alpha(p.unit, 6), num(p.ipiRateBps, 5, "alíquota IPI"), num(p.icmsRateBps, 4, "alíquota ICMS"), num(p.redBps, 5, "redução"), num(p.stBaseUnit, 13, "base ST")]));
    } catch (e) {
      emitErr(e, `Produto ${p.code}`);
    }
  }

  L.push(...l50, ...l51, ...l53, ...l54.map((x) => x.line), ...l61, ...l61r, ...l70, ...l74, ...l75);

  // 90 — totalização (pares tipo + quantidade; "99" = total geral no último 90; posição 126 = nº de registros 90)
  const typeCounts = new Map<string, number>();
  for (const l of L) {
    const t = recordType(l);
    if (t === "10" || t === "11") continue;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const pairs = [...typeCounts].sort(([a], [b]) => a.localeCompare(b));
  const PER = 9; // (125 − 30) ÷ 10 pares por registro 90
  const n90 = Math.max(1, Math.ceil((pairs.length + 1) / PER));
  const total = L.length + n90;
  const allPairs = [...pairs.map(([t, n]) => `${t}${num(n, 8)}`), `99${num(total, 8)}`];
  for (let i = 0; i < n90; i++) {
    const chunk = allPairs.slice(i * PER, (i + 1) * PER).join("");
    L.push(record("90", ["90", code(est.cnpj, 14), alpha(est.ie, 14), chunk.padEnd(95, " "), String(n90)]));
  }
  if (n90 > 9) err("format", "Mais de 9 registros 90 (campo de 1 posição).");

  const counts: Record<string, number> = {};
  for (const l of L) counts[l.startsWith("61R") ? "61R" : recordType(l)] = (counts[l.startsWith("61R") ? "61R" : recordType(l)] ?? 0) + 1;
  const text = fileText(L);
  const sha256 = crypto.createHash("sha256").update(Buffer.from(text, "latin1")).digest("hex");
  const documents: SintegraDocSummary[] = [...nfSorted, ...[...ct].sort(docKeyCmp)].map((d) => ({
    key: d.key, direction: d.direction, label: d.label, date: d.date, model: d.model, series: d.series, number: d.number, participant: d.party.name, participantDoc: d.party.doc, uf: d.party.uf, situation: d.situation,
    total: d.situation === "N" ? d.lines.reduce((a, l) => a + lineTotal(l), 0) : 0, href: d.href,
  }));
  const errors = pend.filter((p) => p.level === "error").length;
  return {
    options,
    from,
    to,
    branchName: String(branch.name ?? ""),
    fileName: `SINTEGRA-${est.cnpj || "SEM-CNPJ"}-${input.period.replace("-", "")}-fin${finalidade}.txt`,
    lines: L,
    text,
    sha256,
    counts,
    totalLines: L.length,
    pendencies: pend,
    errors,
    warnings: pend.length - errors,
    documents,
    inventory,
    nfce: { included: nfceLines.length > 0, docs: nfceLines.length },
    checks: { docs: nfSorted.filter((d) => d.situation === "N").length, mismatches },
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */

export const SINTEGRA_FILE_KIND = "sintegra";
const entityIdFor = (branchId: string, period: string) => `${branchId}:${period}`;

export interface SintegraFileResult {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  lines: number;
  counts: Record<string, number>;
  errors: number;
  warnings: number;
  /** arquivo idêntico já gerado (mesmo conteúdo): devolvido sem duplicar */
  reused: boolean;
}

/**
 * Gera e grava o arquivo em Arquivos (`kind = "sintegra"`, download por /api/files/[id]), com auditoria. Pendências
 * bloqueantes exigem `allowPendencies` (confirmação de quem gera). Mesmo período e mesmos dados → mesmo conteúdo; se o
 * último arquivo do período tem o mesmo conteúdo, ele é devolvido (idempotente).
 */
export async function generateSintegraFile(ctx: Ctx, input: SintegraOptions & { allowPendencies?: boolean }): Promise<SintegraFileResult> {
  const r = await buildSintegra(ctx, input);
  if (r.errors && !input.allowPendencies) {
    const first = r.pendencies.filter((p) => p.level === "error").slice(0, 5).map((p) => p.message);
    throw new BusinessError(`Arquivo com ${r.errors} pendência(s) bloqueante(s): ${first.join(" · ")}${r.errors > 5 ? " …" : ""}. Corrija ou confirme “gerar mesmo com pendências”.`, "sintegra_pendencies");
  }
  const data = Buffer.from(r.text, "latin1");
  const entityId = entityIdFor(r.options.branchId, r.options.period);
  const previous = await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", SINTEGRA_FILE_KIND], ["eq", "entityId", entityId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 1);
  if (previous[0] && previous[0].sha256 === r.sha256 && previous[0].name === r.fileName) {
    return { fileId: previous[0].id, fileName: r.fileName, sizeBytes: data.length, lines: r.totalLines, counts: r.counts, errors: r.errors, warnings: r.warnings, reused: true };
  }
  const file = await saveFile(ctx, { bucket: "documents", name: r.fileName, mime: "text/plain", data, entityType: "sintegra", entityId, kind: SINTEGRA_FILE_KIND, branchId: r.options.branchId });
  const countsText = Object.entries(r.counts).map(([t, n]) => `${t}: ${n}`).join(", ");
  await audit(ctx, {
    module: "fiscal",
    action: "sintegra.generate",
    entityType: "file",
    entityId: file.id,
    summary: `Sintegra ${r.options.period} (${r.branchName}, finalidade ${r.options.finalidade}) gerado: ${r.totalLines} registro(s) — ${countsText}${r.errors ? `; GERADO COM ${r.errors} PENDÊNCIA(S) BLOQUEANTE(S) confirmadas` : ""}${r.warnings ? `; ${r.warnings} aviso(s)` : ""}`,
    after: { period: r.options.period, branchId: r.options.branchId, finalidade: r.options.finalidade, natureza: r.options.natureza, inventoryDate: r.options.inventoryDate, includeNfce: r.options.includeNfce, counts: r.counts, errors: r.errors, warnings: r.warnings, sha256: r.sha256 },
    branchId: r.options.branchId,
  });
  return { fileId: file.id, fileName: r.fileName, sizeBytes: data.length, lines: r.totalLines, counts: r.counts, errors: r.errors, warnings: r.warnings, reused: false };
}

/** Histórico dos arquivos Sintegra gerados (download em Arquivos). */
export async function sintegraHistory(ctx: Ctx, opts: { branchId?: string | null } = {}) {
  requireAction(ctx, "fiscal.files");
  const files = await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", SINTEGRA_FILE_KIND], ...(opts.branchId ? [["eq", "branchId", opts.branchId]] : [])] as any[], orderBy: [{ field: "createdAt", dir: "desc" }] }, 50);
  return files.map((f) => {
    const [branchId, period] = String(f.entityId ?? ":").split(":");
    return { id: f.id, name: f.name, sizeBytes: f.sizeBytes, createdAt: f.createdAt, branchId, period, finalidade: /-fin(\d)\.txt$/.exec(f.name ?? "")?.[1] ?? "" };
  });
}

/** Meses ("AAAA-MM") cobertos por um intervalo de datas. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (p > end) break;
    out.push(p);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Último arquivo Sintegra gerado de cada estabelecimento × mês do intervalo (pacote contábil). `branchId` null = todas
 * as filiais da empresa. Leitura de Arquivos, sem exigir a permissão de gerar (o pacote já exige "Exportar dados").
 */
export async function latestSintegraFiles(ctx: Ctx, f: { from: string; to: string; branchId: string | null }): Promise<Doc[]> {
  const months = monthsBetween(f.from, f.to);
  const branchIds = f.branchId ? [f.branchId] : (await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).map((b) => b.id);
  const ids = branchIds.flatMap((b) => months.map((m) => entityIdFor(b, m)));
  if (!ids.length) return [];
  const files: Doc[] = [];
  for (let i = 0; i < ids.length; i += 100) files.push(...(await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", SINTEGRA_FILE_KIND], ["eq", "entityId", ids.slice(i, i + 100)]] })));
  const latest = new Map<string, Doc>();
  for (const x of files) {
    const cur = latest.get(x.entityId);
    if (!cur || String(x.createdAt) > String(cur.createdAt) || (x.createdAt === cur.createdAt && x.id > cur.id)) latest.set(x.entityId, x);
  }
  return [...latest.values()].sort((a, b) => String(a.entityId).localeCompare(String(b.entityId)));
}
