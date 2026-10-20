import crypto from "node:crypto";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { allocate, roundDiv } from "@/lib/money";
import { addDays, dayRange, monthEnd, toLocalDate } from "@/lib/dates";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/core/text";
import { fiscalInventory } from "../../inventory-fiscal";
import type { ReceiptItem } from "../../receipts";
import type { DocItem } from "../service";

/**
 * Utilidades COMUNS dos arquivos fiscais em texto (EFD ICMS/IPI, EFD Contribuições e, depois, Sintegra) — §41.
 * Só leitura: nada é gravado aqui. Fontes (fiscal_documents continua sendo SÓ o que a empresa emite):
 *  - documentos EMITIDOS: `fiscal_documents` (NF-e/NFC-e/NFS-e) pela data de emissão, inclusive as NF-e de entrada
 *    emitidas pela própria empresa e os registros de inutilização;
 *  - ENTRADAS de terceiros: `receipts` concluídos (pela data de entrada) com chave de NF-e e fora de "aguardando nota"
 *    (§40), e `inbound_ctes` registrados (pela data do registro).
 * Registro de participantes, itens e unidades (bloco 0), linhas fiscais por item, agrupamento analítico
 * (CST × CFOP × alíquota), totais por CFOP, inventário em data-base por item e formatação de campos (vírgula decimal,
 * datas DDMMAAAA, texto sem "|", ISO-8859-1, CRLF).
 */

// ───────────────────────────── Formatação

export const CRLF = "\r\n";

/** Inteiro escalado (centavos = 2, milésimos = 3, micro = 6) → "1234,56" (sem separador de milhar, vírgula decimal). */
export function fmtScaled(v: number | null | undefined, digits: number): string {
  if (v == null || !Number.isFinite(v)) return "";
  const n = Math.round(v);
  const sign = n < 0 ? "-" : "";
  const abs = String(Math.abs(n)).padStart(digits + 1, "0");
  if (!digits) return sign + abs;
  return `${sign}${abs.slice(0, -digits)},${abs.slice(-digits)}`;
}

/** Valor em centavos → "1234,56". */
export const fmtMoney = (cents: number | null | undefined) => fmtScaled(cents, 2);
/** Quantidade em milésimos → "10,000". */
export const fmtQty = (milli: number | null | undefined) => fmtScaled(milli, 3);
/** Alíquota em pontos-base → "18,00". */
export const fmtRate = (bps: number | null | undefined) => fmtScaled(bps, 2);

/** Data (AAAA-MM-DD ou ISO com hora — no fuso da instalação) → DDMMAAAA. */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : toLocalDate(v);
  return `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
}

/** Texto de campo: sem "|", sem quebras/controles, espaços simples, limite de tamanho. */
export function fmtText(v: string | number | null | undefined, max = 255): string {
  if (v == null) return "";
  return String(v)
    .normalize("NFC")
    .replace(/[|\r\n\t\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export type Field = string | number | null | undefined;

/** Linha "|REG|campo|...|" (campos já formatados; null/undefined = vazio). */
export function line(fields: Field[]): string {
  return `|${fields.map((f) => (f == null ? "" : String(f))).join("|")}|`;
}

/** Conteúdo em ISO-8859-1 (caractere fora da tabela vira "?"), linhas com CRLF (inclusive a última). */
export function toLatin1(lines: string[]): Buffer {
  const text = lines.join(CRLF) + (lines.length ? CRLF : "");
  return Buffer.from(text.normalize("NFC").replace(/[^\u0000-ÿ]/g, "?"), "latin1");
}

// ───────────────────────────── Período

export interface MonthPeriod {
  /** AAAA-MM */
  period: string;
  from: string;
  to: string;
}

export function monthPeriod(period: string): MonthPeriod {
  const from = `${period}-01`;
  return { period, from, to: monthEnd(from) };
}

export const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p ?? "");

// ───────────────────────────── Pendências

export type Severity = "error" | "warning";

export interface Pendency {
  severity: Severity;
  code: string;
  message: string;
  href?: string | null;
}

// ───────────────────────────── Registro de participantes, itens e unidades (bloco 0)

export interface Participant {
  code: string;
  name: string;
  /** código do país (tabela do BACEN) */
  country: string;
  cnpj: string;
  cpf: string;
  ie: string;
  cityCode: string;
  suframa: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  uf: string;
}

export interface PartyInput {
  doc?: string | null;
  name?: string | null;
  ie?: string | null;
  suframa?: string | null;
  address?: Record<string, any> | null;
  /** identificador estável quando não há CPF/CNPJ */
  fallbackId?: string | null;
  /** onde corrigir (link da pendência) */
  href?: string | null;
}

export interface FiscalItem {
  code: string;
  description: string;
  barcode: string;
  unit: string;
  /** TIPO_ITEM: 00 revenda, 07 uso e consumo, 09 serviço, 99 outras */
  type: string;
  ncm: string;
  cest: string;
}

const validGtin = (v: string) => /^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v);

/** Participantes, itens e unidades referenciados pelos registros (o bloco 0 só traz o que é usado). */
export class FileRegistry {
  participants = new Map<string, Participant>();
  items = new Map<string, FiscalItem>();
  units = new Map<string, string>();
  pendencies: Pendency[] = [];
  private seen = new Set<string>();

  constructor(private unitNames: Map<string, string> = new Map()) {}

  pend(p: Pendency) {
    const k = `${p.severity}|${p.code}|${p.message}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.pendencies.push(p);
  }

  /** Registra o participante e devolve o COD_PART (CPF/CNPJ; sem documento, o identificador do cadastro). */
  addParticipant(p: PartyInput): string {
    const doc = onlyDigits(p.doc ?? "");
    const code = doc || `ID${String(p.fallbackId ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || "SEMDOC"}`;
    if (this.participants.has(code)) return code;
    const a = p.address ?? {};
    const name = fmtText(p.name, 100);
    const part: Participant = {
      code,
      name,
      country: "01058",
      cnpj: doc.length === 14 ? doc : "",
      cpf: doc.length === 11 ? doc : "",
      ie: onlyDigits(p.ie ?? "") ? fmtText(String(p.ie).replace(/[^0-9A-Za-z]/g, ""), 14) : "",
      cityCode: onlyDigits(a.cityCode ?? a.ibge ?? ""),
      suframa: fmtText(p.suframa, 9),
      street: fmtText(a.street, 60),
      number: fmtText(a.number, 10),
      complement: fmtText(a.complement, 60),
      district: fmtText(a.district, 60),
      uf: fmtText(a.uf, 2).toUpperCase(),
    };
    this.participants.set(code, part);
    const who = name || code;
    if (!doc) this.pend({ severity: "error", code: "participant_doc", message: `Participante "${who}" sem CPF/CNPJ.`, href: p.href });
    else if (doc.length === 14 ? !isValidCnpj(doc) : doc.length === 11 ? !isValidCpf(doc) : true) this.pend({ severity: "error", code: "participant_doc", message: `Participante "${who}" com CPF/CNPJ inválido (${doc}).`, href: p.href });
    if (!/^\d{7}$/.test(part.cityCode)) this.pend({ severity: "error", code: "participant_city", message: `Participante "${who}" sem município (código IBGE de 7 dígitos) no endereço.`, href: p.href });
    if (!name) this.pend({ severity: "error", code: "participant_name", message: `Participante ${code} sem nome.`, href: p.href });
    return code;
  }

  addUnit(code: string | null | undefined): string {
    const u = fmtText(code || "UN", 6).toUpperCase() || "UN";
    if (!this.units.has(u)) this.units.set(u, fmtText(this.unitNames.get(u) ?? u, 100) || u);
    return u;
  }

  /** Registra o item (0200) e a unidade (0190); devolve o COD_ITEM. */
  addItem(it: FiscalItem, href?: string | null): string {
    const code = fmtText(it.code, 60);
    if (this.items.has(code)) return code;
    const unit = this.addUnit(it.unit);
    const ncm = onlyDigits(it.ncm);
    const item: FiscalItem = { ...it, code, description: fmtText(it.description, 255) || code, unit, ncm: ncm.length === 8 ? ncm : "", barcode: validGtin(onlyDigits(it.barcode)) ? onlyDigits(it.barcode) : "", cest: /^\d{7}$/.test(onlyDigits(it.cest)) ? onlyDigits(it.cest) : "" };
    this.items.set(code, item);
    if (item.type === "00" && !item.ncm) this.pend({ severity: "warning", code: "item_ncm", message: `Item ${code} (${item.description}) sem NCM de 8 dígitos.`, href });
    if (!it.unit) this.pend({ severity: "warning", code: "item_unit", message: `Item ${code} (${item.description}) sem unidade — usada "UN".`, href });
    return code;
  }

  participantList(): Participant[] {
    return [...this.participants.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  itemList(): FiscalItem[] {
    return [...this.items.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  unitList(): Array<{ code: string; description: string }> {
    return [...this.units.entries()].map(([code, description]) => ({ code, description })).sort((a, b) => a.code.localeCompare(b.code));
  }
}

/**
 * Só o que os registros do arquivo referenciam (o PVA aponta 0150/0200/0190 sem uso): participantes e itens usados e as
 * unidades desses itens e das linhas.
 */
export function referenced(reg: FileRegistry, used: { parts: Iterable<string | null | undefined>; items: Iterable<string>; units?: Iterable<string> }) {
  const parts = new Set([...used.parts].filter((x): x is string => Boolean(x)));
  const items = new Set(used.items);
  const units = new Set(used.units ?? []);
  const itemList = reg.itemList().filter((x) => items.has(x.code));
  for (const it of itemList) units.add(it.unit);
  return { participants: reg.participantList().filter((x) => parts.has(x.code)), items: itemList, units: reg.unitList().filter((u) => units.has(u.code)) };
}

/** Código estável de item sem cadastro (item de nota de entrada não vinculado a produto). */
export function adhocItemCode(parts: Array<string | null | undefined>): string {
  return `NV${crypto.createHash("sha256").update(parts.map((p) => p ?? "").join("|")).digest("hex").slice(0, 12).toUpperCase()}`;
}

// ───────────────────────────── Documentos do período (modelo comum)

/** Situação do documento (tabela 4.1.2): 00 regular, 02 cancelado, 04 denegado, 05 inutilizado, 06 complementar. */
export type DocSit = "00" | "02" | "04" | "05" | "06";

export interface FiscalDocLine {
  num: number;
  itemCode: string;
  description: string;
  /** milésimos, na unidade do item */
  qty: number;
  unit: string;
  /** valor dos produtos (vProd) e desconto */
  gross: number;
  discount: number;
  freight: number;
  insurance: number;
  other: number;
  /** valor da operação do item (VL_OPR do analítico): produtos − desconto + acessórios + ST + IPI */
  value: number;
  /** CST do ICMS com a origem (3 dígitos; Simples: origem + CSOSN, 4 dígitos) */
  cstIcms: string;
  cfop: string;
  icmsRateBps: number;
  icmsBase: number;
  icms: number;
  /** redução da base (valor não tributado pela redução) */
  redBase: number;
  stBase: number;
  stRateBps: number;
  st: number;
  ipiCst: string;
  ipiBase: number;
  ipiRateBps: number;
  ipi: number;
  pisCst: string;
  pisBase: number;
  pisRateBps: number;
  pis: number;
  cofinsCst: string;
  cofinsBase: number;
  cofinsRateBps: number;
  cofins: number;
  /** IND_MOV: houve movimentação física */
  movesStock: boolean;
}

export interface FiscalDocRecord {
  id: string;
  source: "issued" | "receipt";
  href: string;
  branchId: string;
  /** IND_OPER: 0 entrada, 1 saída */
  oper: "0" | "1";
  /** IND_EMIT: 0 emissão própria, 1 terceiros */
  emit: "0" | "1";
  partCode: string | null;
  model: "55" | "65";
  sit: DocSit;
  series: string;
  number: string;
  accessKey: string;
  /** emissão e entrada/saída (AAAA-MM-DD) */
  issueDate: string;
  ioDate: string | null;
  total: number;
  /** IND_PGTO: 0 à vista, 1 a prazo, 2 outros */
  payInd: "0" | "1" | "2";
  discount: number;
  merch: number;
  /** IND_FRT: 0 emitente (CIF), 1 destinatário (FOB), 2 terceiros, 9 sem frete */
  freightInd: string;
  freight: number;
  insurance: number;
  other: number;
  icmsBase: number;
  icms: number;
  stBase: number;
  st: number;
  ipi: number;
  pis: number;
  cofins: number;
  lines: FiscalDocLine[];
  /** DIFAL/FCP da UF de destino (C101) */
  difal: { fcp: number; dest: number; remet: number } | null;
  /** UF do destinatário (E200/E300) */
  partyUf: string;
  simulated: boolean;
}

export interface FiscalCteRecord {
  id: string;
  href: string;
  branchId: string;
  partCode: string;
  series: string;
  number: string;
  accessKey: string;
  issueDate: string;
  ioDate: string;
  /** tipo do CT-e: 0 normal, 1 complemento */
  cteType: string;
  /** IND_FRT do D100: 0 remetente (CIF), 1 destinatário (FOB), 2 terceiros */
  freightInd: string;
  total: number;
  icmsBase: number;
  icms: number;
  icmsRateBps: number;
  cstIcms: string;
  cfop: string;
  munStart: string;
  munEnd: string;
}

export interface ServiceDocRecord {
  id: string;
  href: string;
  branchId: string;
  partCode: string | null;
  sit: DocSit;
  series: string;
  number: string;
  /** chave/código de verificação da NFS-e */
  accessKey: string;
  issueDate: string;
  competence: string;
  amount: number;
  discount: number;
  iss: number;
  pisWithheld: number;
  cofinsWithheld: number;
  itemCode: string;
  description: string;
}

export interface PeriodOptions {
  from: string;
  to: string;
  branchIds: string[];
  /** empresa do regime normal (credita ICMS nas entradas) */
  creditIcms: boolean;
  /** PIS/COFINS não cumulativo (crédito nas entradas, CST 50) */
  nonCumulative: boolean;
}

export interface PeriodData {
  docs: FiscalDocRecord[];
  ctes: FiscalCteRecord[];
  services: ServiceDocRecord[];
  /** entradas com nota a confirmar (§40) realizadas no período — fora do arquivo */
  awaitingInvoice: number;
}

const ST_ENTRY_CFOP = /^[123](403|409|411|407|408|652|655|656)$/;
const CREDIT_CST = ["00", "10", "20", "51", "70", "90"];

function payIndOf(payments: Array<{ kind?: string }> | null | undefined): "0" | "1" | "2" {
  const kinds = (payments ?? []).map((p) => p.kind ?? "");
  if (!kinds.length || kinds.every((k) => k === "none" || k === "other")) return "2";
  return kinds.some((k) => ["crediario", "boleto", "credit"].includes(k)) ? "1" : "0";
}

async function byIds(store: Store, collection: string, ids: Array<string | null | undefined>): Promise<Map<string, Doc>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, Doc>();
  for (let i = 0; i < uniq.length; i += 100) for (const d of await listAll(store, collection, { filters: [["eq", "id", uniq.slice(i, i + 100)]] })) out.set(d.id, d);
  return out;
}

/** Nomes das unidades cadastradas (0190). */
export async function unitNames(store: Store, companyId: string): Promise<Map<string, string>> {
  const units = await listAll(store, "units", { filters: [["eq", "companyId", companyId]] });
  return new Map(units.map((u) => [String(u.code).toUpperCase(), String(u.name ?? u.code)]));
}

/** Item fiscal (0200) a partir do SKU/produto cadastrado. */
export function catalogItem(sku: Doc | null | undefined, product: Doc | null | undefined, fallback: Partial<FiscalItem> & { code: string }): FiscalItem {
  return {
    code: sku?.sku ?? fallback.code,
    description: sku?.name ?? product?.name ?? fallback.description ?? fallback.code,
    barcode: sku?.barcode ?? product?.gtin ?? fallback.barcode ?? "",
    unit: sku?.unitCode ?? product?.unitCode ?? fallback.unit ?? "",
    type: product?.type === "service" ? "09" : (fallback.type ?? "00"),
    ncm: product?.ncm ?? fallback.ncm ?? "",
    cest: product?.cest ?? fallback.cest ?? "",
  };
}

/**
 * Documentos do período nas filiais pedidas, convertidos ao modelo comum. Participantes e itens são registrados em `reg`
 * (com as pendências de cadastro); documentos fora do arquivo viram pendência (aviso).
 */
export async function loadPeriodDocuments(ctx: Ctx, o: PeriodOptions, reg: FileRegistry): Promise<PeriodData> {
  const { start, end } = dayRange(o.from, o.to);
  const branchFilter: any = ["eq", "branchId", o.branchIds.length ? o.branchIds : ["__none__"]];
  const company: any = ["eq", "companyId", ctx.companyId];
  const [issued, receipts, drafts, ctes] = await Promise.all([
    listAll(ctx.store, "fiscal_documents", { filters: [company, branchFilter, ["gte", "issuedAt", start], ["lt", "issuedAt", end]], orderBy: [{ field: "issuedAt", dir: "asc" }] }),
    listAll(ctx.store, "receipts", { filters: [company, branchFilter, ["eq", "status", "confirmed"], ["gte", "confirmedAt", start], ["lt", "confirmedAt", end]], orderBy: [{ field: "confirmedAt", dir: "asc" }] }),
    listAll(ctx.store, "receipts", { filters: [company, branchFilter, ["eq", "status", ["draft", "confirming"]]] }),
    listAll(ctx.store, "inbound_ctes", { filters: [company, branchFilter, ["eq", "status", "registered"], ["gte", "registeredAt", start], ["lt", "registeredAt", end]], orderBy: [{ field: "registeredAt", dir: "asc" }] }),
  ]);
  const skuIds: string[] = [];
  for (const d of issued) for (const i of (d.items ?? []) as DocItem[]) skuIds.push(i.skuId ?? "");
  for (const r of receipts) for (const i of (r.items ?? []) as ReceiptItem[]) skuIds.push(i.skuId ?? "");
  const skus = await byIds(ctx.store, "skus", skuIds);
  const products = await byIds(ctx.store, "products", [...[...skus.values()].map((s) => s.productId), ...issued.map((d) => d.service?.productId)]);
  const partyIds = issued.filter((d) => d.partyType === "customer").map((d) => d.partyId);
  const customers = await byIds(ctx.store, "customers", partyIds);
  const suppliers = await byIds(ctx.store, "suppliers", [...receipts.map((r) => r.supplierId), ...ctes.map((c) => c.carrierId), ...issued.filter((d) => d.partyType === "supplier").map((d) => d.partyId)]);

  const docs: FiscalDocRecord[] = [];
  const services: ServiceDocRecord[] = [];

  // ── documentos emitidos pela empresa
  for (const d of issued) {
    const label = `${d.model === "nfce" ? "NFC-e" : d.model === "nfse" ? "NFS-e" : "NF-e"} ${d.number ?? d.rpsNumber ?? d.ref}`;
    const href = `/fiscal/${d.model}/${d.id}`;
    if (d.originType === "disable") {
      if (d.status !== "unused") continue;
      const from = Number(d.service?.disableFrom ?? d.number);
      const to = Number(d.service?.disableTo ?? d.number);
      for (let n = from; n <= to; n++) docs.push(blankDoc(d, { id: `${d.id}:${n}`, href, sit: "05", number: String(n), accessKey: "", oper: "1" }));
      continue;
    }
    if (d.model === "nfse") {
      if (!["authorized", "cancelled"].includes(d.status)) {
        if (["pending", "queued", "processing", "error", "rejected"].includes(d.status)) reg.pend({ severity: "warning", code: "doc_not_authorized", message: `${label} emitida no período sem autorização (${d.status}) — fora do arquivo.`, href });
        continue;
      }
      const svc = d.service ?? {};
      const product = products.get(svc.productId);
      const itemCode = reg.addItem({ code: product?.code ? String(product.code) : `SERV-${String(svc.serviceListItem ?? "").replace(/\D/g, "") || "SVC"}`, description: product?.name ?? svc.description ?? "Serviço", barcode: "", unit: product?.unitCode ?? "UN", type: "09", ncm: "", cest: "" });
      const partCode = d.recipient?.doc || d.partyId ? reg.addParticipant({ doc: d.recipient?.doc, name: d.recipient?.name, ie: d.recipient?.ie, address: d.recipient?.address ?? customers.get(d.partyId)?.addresses?.[0], fallbackId: d.partyId, href }) : null;
      services.push({
        id: d.id, href, branchId: d.branchId, partCode, sit: d.status === "cancelled" ? "02" : "00", series: String(d.rpsSeries ?? d.series ?? ""), number: String(d.number ?? d.rpsNumber ?? ""), accessKey: String(d.accessKey ?? d.verificationCode ?? ""),
        issueDate: toLocalDate(d.issuedAt), competence: d.competenceDate ?? toLocalDate(d.issuedAt), amount: svc.amount ?? d.total ?? 0, discount: svc.unconditionalDiscount ?? 0, iss: svc.iss ?? 0,
        pisWithheld: svc.withhold?.pis ? (svc.pis ?? 0) : 0, cofinsWithheld: svc.withhold?.cofins ? (svc.cofins ?? 0) : 0, itemCode, description: fmtText(svc.description, 255),
      });
      continue;
    }
    if (d.status === "unused") continue; // coberto pelo registro de inutilização da faixa
    if (!["authorized", "cancelled", "denied"].includes(d.status)) {
      if (["discarded", "rejected"].includes(d.status) && d.number) reg.pend({ severity: "warning", code: "number_gap", message: `${label} ${d.status === "rejected" ? "rejeitada" : "descartada"} sem inutilização da numeração — inutilize o número para não ficar lacuna na sequência.`, href });
      else if (["pending", "queued", "processing", "error"].includes(d.status)) reg.pend({ severity: "warning", code: "doc_not_authorized", message: `${label} emitida no período ainda sem autorização (${d.status}) — fora do arquivo.`, href });
      continue;
    }
    const model = d.model === "nfce" ? "65" : "55";
    const key = onlyDigits(d.accessKey ?? "");
    if (key.length !== 44) reg.pend({ severity: "error", code: "doc_key", message: `${label} sem chave de acesso de 44 dígitos.`, href });
    const oper: "0" | "1" = d.operationType === "entrada" ? "0" : "1";
    if (d.status !== "authorized") {
      docs.push(blankDoc(d, { id: d.id, href, sit: d.status === "cancelled" ? "02" : "04", number: String(d.number ?? ""), accessKey: key, oper, model }));
      continue;
    }
    const rcp = d.recipient ?? {};
    const party = d.partyType === "customer" ? customers.get(d.partyId) : d.partyType === "supplier" ? suppliers.get(d.partyId) : null;
    const address = rcp.address && Object.keys(rcp.address).length ? rcp.address : party?.addresses?.[0];
    const partCode = model === "65" ? null : reg.addParticipant({ doc: rcp.doc ?? d.recipientDoc ?? party?.doc, name: rcp.name ?? d.recipientName ?? party?.name, ie: rcp.ieIndicator === "9" ? null : (rcp.ie ?? party?.ie), suframa: party?.suframa, address, fallbackId: d.partyId ?? d.id, href });
    const items = (d.items ?? []) as DocItem[];
    const lines: FiscalDocLine[] = items.map((i, idx) => {
      const sku = i.skuId ? skus.get(i.skuId) : null;
      const product = sku ? products.get(sku.productId) : i.productId ? products.get(i.productId) : null;
      const itemCode = reg.addItem(catalogItem(sku, product, { code: i.code || `ITEM${idx + 1}`, description: i.description, unit: i.unit, ncm: i.ncm, cest: i.cest ?? "" }), sku ? `/produtos/${sku.productId}` : null);
      const st = i.tc?.st;
      const cst = String(i.cstCsosn ?? "");
      return {
        num: idx + 1, itemCode, description: fmtText(i.description, 255), qty: i.qty, unit: reg.addUnit(i.unit),
        gross: i.gross, discount: i.discount, freight: i.freight ?? 0, insurance: i.insurance ?? 0, other: i.other ?? 0,
        value: i.total + (st?.value ?? 0) + (st?.fcp ?? 0),
        cstIcms: `${String(i.origin ?? "0").slice(0, 1)}${cst}`, cfop: i.cfop,
        icmsRateBps: i.icms ? i.icmsRateBps : 0, icmsBase: i.icmsBase, icms: i.icms, redBase: (i.icmsBaseReductionBps ?? 0) > 0 && i.icmsBase > 0 ? Math.max(0, i.total - i.icmsBase) : 0,
        stBase: st?.base ?? 0, stRateBps: st?.rateBps ?? 0, st: (st?.value ?? 0) + (st?.fcp ?? 0),
        ipiCst: "", ipiBase: 0, ipiRateBps: 0, ipi: 0,
        pisCst: i.pisCst ?? "", pisBase: i.pisBase ?? (i.pis ? i.total : 0), pisRateBps: i.pisRateBps ?? 0, pis: i.pis ?? 0,
        cofinsCst: i.cofinsCst ?? "", cofinsBase: i.cofinsBase ?? (i.cofins ? i.total : 0), cofinsRateBps: i.cofinsRateBps ?? 0, cofins: i.cofins ?? 0,
        movesStock: true,
      };
    });
    const t = d.totals ?? {};
    const sum = (f: (l: FiscalDocLine) => number) => lines.reduce((a, l) => a + f(l), 0);
    const difal = items.some((i) => i.tc?.difal) ? { fcp: t.fcpUfDest ?? 0, dest: t.icmsUfDest ?? 0, remet: t.icmsUfRemet ?? 0 } : null;
    if (d.isSimulated) reg.pend({ severity: "warning", code: "simulated", message: "Há documentos emitidos pelo provedor de SIMULAÇÃO no período (sem validade fiscal) — o arquivo serve só para conferência.", href: null });
    docs.push({
      id: d.id, source: "issued", href, branchId: d.branchId, oper, emit: "0", partCode, model, sit: d.purpose === "complementar" ? "06" : "00",
      series: String(d.series ?? ""), number: String(d.number ?? ""), accessKey: key, issueDate: toLocalDate(d.issuedAt), ioDate: toLocalDate(d.exitAt ?? d.issuedAt),
      total: d.total ?? t.total ?? 0, payInd: payIndOf(d.payments), discount: t.discount ?? sum((l) => l.discount), merch: t.products ?? sum((l) => l.gross),
      freightInd: d.transport?.mode ?? (sum((l) => l.freight) ? "0" : "9"), freight: t.freight ?? sum((l) => l.freight), insurance: t.insurance ?? sum((l) => l.insurance), other: t.other ?? sum((l) => l.other),
      icmsBase: t.icmsBase ?? sum((l) => l.icmsBase), icms: t.icms ?? sum((l) => l.icms), stBase: t.icmsStBase ?? sum((l) => l.stBase), st: (t.icmsSt ?? 0) + (t.fcpSt ?? 0) || sum((l) => l.st), ipi: 0,
      pis: t.pis ?? sum((l) => l.pis), cofins: t.cofins ?? sum((l) => l.cofins), lines, difal, partyUf: String(address?.uf ?? rcp.address?.uf ?? "").toUpperCase(), simulated: Boolean(d.isSimulated),
    });
  }

  // ── entradas de terceiros (recebimentos concluídos)
  let awaiting = 0;
  for (const r of receipts) {
    const href = `/compras/recebimentos/${r.id}`;
    const label = `Recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""}`;
    if (r.documentStatus === "pending_invoice") {
      awaiting++;
      reg.pend({ severity: "warning", code: "pending_invoice", message: `${label}: entrada AGUARDANDO A NOTA do fornecedor (§40) — fora do arquivo até a confirmação da nota.`, href });
      continue;
    }
    const noStock = r.entryKind === "no_stock";
    const docModel = r.nfeKey ? "55" : (r.emitter?.docModel ?? (noStock ? "other" : "55"));
    if (docModel === "nfse") continue; // serviço tomado: fora do ICMS
    const key = onlyDigits(r.nfeKey ?? "");
    if (key.length !== 44) {
      reg.pend({ severity: "warning", code: "entry_without_key", message: `${label}: documento de entrada sem chave de NF-e — fora do arquivo (informe a chave no recebimento).`, href });
      continue;
    }
    // NF-e de homologação (aceita só em empresa de demonstração): entra, com aviso — o arquivo serve só para conferência
    if (r.emitter?.environment === "homologacao") reg.pend({ severity: "warning", code: "entry_homolog", message: "Há entradas com NF-e de HOMOLOGAÇÃO (sem valor fiscal, empresa de demonstração) — o arquivo serve só para conferência.", href: null });
    const supplier = suppliers.get(r.supplierId);
    const emitter = r.emitter ?? {};
    const partCode = reg.addParticipant({ doc: emitter.cnpj ?? emitter.cpf ?? supplier?.doc, name: emitter.name ?? supplier?.name, ie: emitter.ie ?? supplier?.ie, address: emitter.address && Object.keys(emitter.address).length ? emitter.address : supplier?.addresses?.[0], fallbackId: r.supplierId, href: supplier ? `/fornecedores/${supplier.id}` : href });
    const lines = receiptLines(r, skus, products, reg, o, supplier);
    const totals = emitter.totals ?? {};
    const sum = (f: (l: FiscalDocLine) => number) => lines.reduce((a, l) => a + f(l), 0);
    const total: number = totals.vNF ?? (noStock ? (r.invoicedTotal ?? r.total) : null) ?? r.dueTotal ?? sum((l) => l.value);
    docs.push({
      id: r.id, source: "receipt", href, branchId: r.branchId, oper: "0", emit: "1", partCode, model: "55", sit: "00", series: String(r.nfeSeries ?? ""), number: String(r.nfeNumber ?? ""), accessKey: key,
      issueDate: r.nfeIssueDate ? toLocalDate(r.nfeIssueDate) : toLocalDate(r.confirmedAt), ioDate: toLocalDate(r.confirmedAt), total,
      payInd: (r.installments ?? []).length ? "1" : "0", discount: sum((l) => l.discount), merch: sum((l) => l.gross), freightInd: sum((l) => l.freight) ? "0" : "9",
      freight: sum((l) => l.freight), insurance: sum((l) => l.insurance), other: sum((l) => l.other), icmsBase: sum((l) => l.icmsBase), icms: sum((l) => l.icms), stBase: sum((l) => l.stBase), st: sum((l) => l.st), ipi: sum((l) => l.ipi),
      pis: o.nonCumulative ? sum((l) => l.pis) : (totals.vPIS ?? 0), cofins: o.nonCumulative ? sum((l) => l.cofins) : (totals.vCOFINS ?? 0), lines, difal: null, partyUf: String(emitter.address?.uf ?? "").toUpperCase(), simulated: false,
    });
  }
  for (const r of drafts) {
    if (r.entryKind === "no_stock" || r.documentStatus === "pending_invoice" || !r.nfeIssueDate) continue;
    const d = toLocalDate(r.nfeIssueDate);
    if (d >= o.from && d <= o.to) reg.pend({ severity: "warning", code: "entry_in_progress", message: `Recebimento nº ${r.number}${r.nfeNumber ? ` (NF-e ${r.nfeNumber})` : ""} com NF-e emitida no período ainda em conferência — entra no arquivo do mês da conclusão.`, href: `/compras/recebimentos/${r.id}` });
  }

  // ── CT-e de frete de entrada
  const cteOut: FiscalCteRecord[] = [];
  for (const c of ctes) {
    const href = `/compras/cte/${c.id}`;
    if (c.environment === "homologacao") reg.pend({ severity: "warning", code: "entry_homolog", message: "Há CT-e de HOMOLOGAÇÃO (sem valor fiscal, empresa de demonstração) — o arquivo serve só para conferência.", href: null });
    const carrier = suppliers.get(c.carrierId);
    const em = c.emitter ?? {};
    const partCode = reg.addParticipant({ doc: em.cnpj ?? em.cpf ?? carrier?.doc, name: em.name ?? carrier?.name, ie: em.ie ?? carrier?.ie, address: em.address && Object.keys(em.address).length ? em.address : carrier?.addresses?.[0], fallbackId: c.carrierId, href });
    const icms = c.icms ?? {};
    const credit = o.creditIcms && !icms.simples && (icms.vICMS ?? 0) > 0;
    const cst = icms.simples ? "90" : String(icms.cst ?? "90").padStart(2, "0").slice(-2);
    const munStart = onlyDigits(em.munStart ?? "");
    const munEnd = onlyDigits(em.munEnd ?? "");
    if (!/^\d{7}$/.test(munStart) || !/^\d{7}$/.test(munEnd)) reg.pend({ severity: "warning", code: "cte_city", message: `CT-e ${c.cteNumber}: municípios de início/fim da prestação não lidos do XML (registrado antes desta versão) — usados o do emitente e o da filial.`, href });
    cteOut.push({
      id: c.id, href, branchId: c.branchId, partCode, series: String(c.cteSeries ?? ""), number: String(c.cteNumber ?? ""), accessKey: onlyDigits(c.cteKey ?? ""), issueDate: c.issueDate ? toLocalDate(c.issueDate) : toLocalDate(c.registeredAt),
      ioDate: toLocalDate(c.registeredAt), cteType: String(em.type ?? "0"), freightInd: c.tomador?.role === "0" ? "0" : c.tomador?.role === "4" ? "2" : "1", total: c.total ?? 0,
      icmsBase: credit ? (icms.vBC ?? 0) : 0, icms: credit ? (icms.vICMS ?? 0) : 0, icmsRateBps: credit ? (icms.pICMS ?? 0) : 0, cstIcms: o.creditIcms ? `0${credit ? cst : "90"}` : "0900", cfop: String(c.entryCfop ?? c.cfop ?? "1353"),
      munStart: /^\d{7}$/.test(munStart) ? munStart : onlyDigits(em.address?.cityCode ?? ""), munEnd: /^\d{7}$/.test(munEnd) ? munEnd : "",
    });
  }
  const order = (a: { issueDate: string; series: string; number: string }, b: typeof a) => a.issueDate.localeCompare(b.issueDate) || a.series.localeCompare(b.series) || Number(a.number) - Number(b.number) || a.number.localeCompare(b.number);
  docs.sort((a, b) => a.oper.localeCompare(b.oper) || a.model.localeCompare(b.model) || order(a, b) || a.id.localeCompare(b.id));
  cteOut.sort((a, b) => order(a, b) || a.id.localeCompare(b.id));
  services.sort((a, b) => order(a, b) || a.id.localeCompare(b.id));
  return { docs, ctes: cteOut, services, awaitingInvoice: awaiting };
}

function blankDoc(d: Doc, x: { id: string; href: string; sit: DocSit; number: string; accessKey: string; oper: "0" | "1"; model?: "55" | "65" }): FiscalDocRecord {
  return {
    id: x.id, source: "issued", href: x.href, branchId: d.branchId, oper: x.oper, emit: "0", partCode: null, model: x.model ?? (d.model === "nfce" ? "65" : "55"), sit: x.sit, series: String(d.series ?? ""), number: x.number, accessKey: x.accessKey,
    issueDate: toLocalDate(d.issuedAt), ioDate: null, total: 0, payInd: "2", discount: 0, merch: 0, freightInd: "9", freight: 0, insurance: 0, other: 0, icmsBase: 0, icms: 0, stBase: 0, st: 0, ipi: 0, pis: 0, cofins: 0,
    lines: [], difal: null, partyUf: "", simulated: Boolean(d.isSimulated),
  };
}

/** Alíquotas básicas do PIS/COFINS não cumulativo (crédito nas entradas — hipótese §41). */
export const NC_PIS_BPS = 165;
export const NC_COFINS_BPS = 760;

/** Linhas fiscais (C170) de um recebimento: valores do XML por item; sem eles, totais do XML rateados; sem XML, valores do lançamento. */
function receiptLines(r: Doc, skus: Map<string, Doc>, products: Map<string, Doc>, reg: FileRegistry, o: PeriodOptions, supplier: Doc | undefined): FiscalDocLine[] {
  const noStock = r.entryKind === "no_stock";
  const all = (r.items ?? []) as ReceiptItem[];
  const items = all.filter((it) => (it.invoicedQty ?? 0) > 0 || (it.invoicedValue ?? 0) > 0 || (it.fiscal && Object.keys(it.fiscal).length) || (it.receivedQty ?? 0) > 0);
  const head = (r.entryCfop as string | null) ?? "";
  const totals = r.emitter?.totals ?? null;
  const hasFiscal = items.some((it) => it.fiscal && Object.keys(it.fiscal).length);
  const w = items.map((it) => Math.max(0, it.invoicedValue ?? it.lineValue ?? 0));
  const share = (v: number | undefined) => allocate(v ?? 0, w);
  const tShare = !hasFiscal && r.xmlFileId && totals ? { fr: share(totals.vFrete), seg: share(totals.vSeg), ot: share(totals.vOutro), desc: share(totals.vDesc), ipi: share(totals.vIPI), st: share(totals.vST), stBase: share(totals.vBCST), base: share(totals.vBC), icms: share(totals.vICMS) } : null;
  const supplierDoc = onlyDigits(r.emitter?.cnpj ?? supplier?.doc ?? "");
  const lines = items.map((it, idx) => {
    const sku = it.skuId ? skus.get(it.skuId) : null;
    const product = sku ? products.get(sku.productId) : null;
    const itemCode = sku
      ? reg.addItem(catalogItem(sku, product, { code: sku.sku }), `/produtos/${sku.productId}`)
      : reg.addItem({ code: adhocItemCode([supplierDoc, it.cProd, it.xProd ?? it.description]), description: it.xProd ?? it.description ?? "Item da nota", barcode: it.cEAN ?? "", unit: it.uCom ?? it.unitCode ?? "UN", type: noStock ? "07" : "99", ncm: it.ncm ?? "", cest: it.cest ?? "" });
    const f = it.fiscal ?? {};
    let gross: number, discount: number, freight: number, insurance: number, other: number, ipi: number, st: number, stBase: number, base: number, icms: number;
    if (hasFiscal) {
      gross = f.vProd ?? f.vItem ?? it.invoicedValue ?? 0;
      discount = f.vDesc ?? 0;
      freight = f.vFrete ?? 0;
      insurance = f.vSeg ?? 0;
      other = f.vOutro ?? 0;
      ipi = (f.vIPI ?? 0) + (f.vIPIDevol ?? 0);
      st = (f.vICMSST ?? 0) + (f.vFCPST ?? 0);
      stBase = f.vBCST ?? 0;
      base = f.vBC ?? 0;
      icms = f.vICMS ?? 0;
    } else if (tShare) {
      gross = it.invoicedValue ?? 0;
      discount = tShare.desc[idx];
      freight = tShare.fr[idx];
      insurance = tShare.seg[idx];
      other = tShare.ot[idx];
      ipi = tShare.ipi[idx];
      st = tShare.st[idx];
      stBase = tShare.stBase[idx];
      base = tShare.base[idx];
      icms = tShare.icms[idx];
    } else {
      gross = it.lineValue ?? it.invoicedValue ?? 0;
      discount = it.discountShare ?? 0;
      freight = it.freightShare ?? 0;
      insurance = 0;
      other = it.otherShare ?? 0;
      ipi = st = stBase = base = icms = 0;
    }
    const cfop = String(it.entryCfop || head || "1102");
    const supplierCst = f.cst ? String(f.cst).padStart(2, "0").slice(-2) : null;
    const credit = o.creditIcms && Boolean(supplierCst && CREDIT_CST.includes(supplierCst)) && icms > 0 && !ST_ENTRY_CFOP.test(cfop);
    const origin = String(f.orig ?? product?.origin ?? "0").slice(0, 1);
    const cstIcms = o.creditIcms ? `${origin}${supplierCst ?? "90"}` : `${origin}900`;
    const value = gross - discount + freight + insurance + other + ipi + st + (f.vII ?? 0);
    // PIS/COFINS da entrada: crédito só no regime não cumulativo (CST 50, base sem IPI/ST e sem o ICMS — Lei 14.592/2023)
    const ncBase = Math.max(0, gross - discount + freight + insurance + other - icms);
    return {
      num: it.nItem ?? idx + 1, itemCode, description: fmtText(it.xProd ?? it.description, 255), qty: it.invoicedQty ?? it.receivedQty ?? 0,
      unit: reg.addUnit(sku?.unitCode ?? product?.unitCode ?? it.unitCode ?? it.uCom), gross, discount, freight, insurance, other, value,
      cstIcms, cfop, icmsRateBps: credit ? (f.pICMS ?? 0) : 0, icmsBase: credit ? base : 0, icms: credit ? icms : 0, redBase: 0,
      stBase, stRateBps: 0, st, ipiCst: ipi ? "49" : "", ipiBase: ipi ? (f.vBCIPI ?? 0) : 0, ipiRateBps: ipi ? (f.pIPI ?? 0) : 0, ipi,
      pisCst: o.nonCumulative ? "50" : "70", pisBase: o.nonCumulative ? ncBase : 0, pisRateBps: o.nonCumulative ? NC_PIS_BPS : 0, pis: o.nonCumulative ? roundDiv(ncBase * NC_PIS_BPS, 10000) : 0,
      cofinsCst: o.nonCumulative ? "50" : "70", cofinsBase: o.nonCumulative ? ncBase : 0, cofinsRateBps: o.nonCumulative ? NC_COFINS_BPS : 0, cofins: o.nonCumulative ? roundDiv(ncBase * NC_COFINS_BPS, 10000) : 0,
      movesStock: !noStock && !it.ignore,
    } satisfies FiscalDocLine;
  });
  return lines.sort((a, b) => a.num - b.num);
}

// ───────────────────────────── Analítico e totais por CFOP

export interface AnalyticRow {
  cstIcms: string;
  cfop: string;
  icmsRateBps: number;
  value: number;
  icmsBase: number;
  icms: number;
  stBase: number;
  st: number;
  redBase: number;
  ipi: number;
}

/**
 * Registro analítico do documento (C190/D190): soma por CST × CFOP × alíquota do ICMS. Com `closeTo`, a diferença para o
 * valor do documento (ex.: ICMS desonerado, arredondamento do XML) vai para o maior grupo — a soma fecha com o VL_DOC.
 */
export function analyticRows(lines: Array<Pick<FiscalDocLine, "cstIcms" | "cfop" | "icmsRateBps" | "value" | "icmsBase" | "icms" | "stBase" | "st" | "redBase" | "ipi">>, closeTo?: number | null): AnalyticRow[] {
  const by = new Map<string, AnalyticRow>();
  for (const l of lines) {
    const k = `${l.cstIcms}|${l.cfop}|${l.icmsRateBps}`;
    const g = by.get(k) ?? { cstIcms: l.cstIcms, cfop: l.cfop, icmsRateBps: l.icmsRateBps, value: 0, icmsBase: 0, icms: 0, stBase: 0, st: 0, redBase: 0, ipi: 0 };
    g.value += l.value;
    g.icmsBase += l.icmsBase;
    g.icms += l.icms;
    g.stBase += l.stBase;
    g.st += l.st;
    g.redBase += l.redBase;
    g.ipi += l.ipi;
    by.set(k, g);
  }
  const rows = [...by.values()].sort((a, b) => a.cstIcms.localeCompare(b.cstIcms) || a.cfop.localeCompare(b.cfop) || a.icmsRateBps - b.icmsRateBps);
  if (closeTo != null && rows.length) {
    const diff = closeTo - rows.reduce((a, r) => a + r.value, 0);
    if (diff) {
      const big = rows.reduce((m, r, i) => (r.value > rows[m].value ? i : m), 0);
      rows[big] = { ...rows[big], value: rows[big].value + diff };
    }
  }
  return rows;
}

export interface CfopTotal {
  cfop: string;
  docs: number;
  value: number;
  icmsBase: number;
  icms: number;
  stBase: number;
  st: number;
  ipi: number;
}

/** Totais por CFOP dos documentos regulares (sem cancelados/denegados/inutilizados). */
export function totalsByCfop(docs: FiscalDocRecord[]): CfopTotal[] {
  const by = new Map<string, CfopTotal & { set: Set<string> }>();
  for (const d of docs) {
    if (!["00", "06"].includes(d.sit)) continue;
    for (const r of analyticRows(d.lines, d.total)) {
      const g = by.get(r.cfop) ?? { cfop: r.cfop, docs: 0, value: 0, icmsBase: 0, icms: 0, stBase: 0, st: 0, ipi: 0, set: new Set<string>() };
      g.set.add(d.id);
      g.value += r.value;
      g.icmsBase += r.icmsBase;
      g.icms += r.icms;
      g.stBase += r.stBase;
      g.st += r.st;
      g.ipi += r.ipi;
      by.set(r.cfop, g);
    }
  }
  return [...by.values()].map(({ set, ...g }) => ({ ...g, docs: set.size })).sort((a, b) => a.cfop.localeCompare(b.cfop));
}

// ───────────────────────────── Inventário (bloco H / registro 74 do Sintegra)

export interface InventoryItemRow {
  itemCode: string;
  unit: string;
  /** milésimos */
  qty: number;
  /** centavos */
  value: number;
  /** valor unitário em milionésimos de real (6 casas) */
  unitMicro: number;
}

export interface InventoryForFile {
  date: string;
  rows: InventoryItemRow[];
  total: number;
  negatives: number;
}

/**
 * Inventário em data-base (src/domain/inventory-fiscal.ts — mesma regra da tela) por ITEM nas filiais pedidas: soma os
 * depósitos (venda, almoxarifado, uso e consumo e avarias — tudo em poder do informante). Saldo negativo fica fora e
 * vira pendência. Itens são registrados no bloco 0.
 */
export async function inventoryForFile(ctx: Ctx, branchIds: string[], date: string, reg: FileRegistry): Promise<InventoryForFile> {
  const inv = await fiscalInventory(ctx.store, ctx.companyId, { date, branchIds });
  const skus = await byIds(ctx.store, "skus", inv.rows.map((r) => r.skuId));
  const products = await byIds(ctx.store, "products", [...skus.values()].map((s) => s.productId));
  const by = new Map<string, InventoryItemRow>();
  let negatives = 0;
  for (const r of inv.rows) {
    if (r.negative) {
      negatives++;
      reg.pend({ severity: "warning", code: "inventory_negative", message: `Inventário de ${date.split("-").reverse().join("/")}: saldo negativo de ${r.skuCode} em ${r.warehouseName} — fora do bloco H (corrija por inventário).`, href: "/estoque/inventario-fiscal" });
      continue;
    }
    const sku = skus.get(r.skuId);
    const code = reg.addItem(catalogItem(sku, products.get(sku?.productId), { code: r.skuCode, description: r.skuName, unit: r.unitCode, ncm: r.ncm }), r.productId ? `/produtos/${r.productId}` : null);
    const g = by.get(code) ?? { itemCode: code, unit: reg.addUnit(r.unitCode), qty: 0, value: 0, unitMicro: 0 };
    g.qty += r.qty;
    g.value += r.value;
    by.set(code, g);
  }
  const rows = [...by.values()].filter((r) => r.qty > 0).map((r) => ({ ...r, unitMicro: roundDiv(r.value * 10 * 1_000_000, r.qty) })).sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  return { date, rows, total: rows.reduce((a, r) => a + r.value, 0), negatives };
}

/** Data-base padrão do inventário: 31/12 do ano anterior no arquivo de fevereiro; nos demais meses, nenhuma. */
export function defaultInventoryDate(period: string): string | null {
  return period.slice(5, 7) === "02" ? `${Number(period.slice(0, 4)) - 1}-12-31` : null;
}

/** Último dia útil não é calculado: vencimento = dia informado do mês seguinte ao período (limitado ao fim do mês). */
export function dueDateFor(period: string, day: number): string {
  const next = addDays(monthEnd(`${period}-01`), 1);
  const last = Number(monthEnd(next).slice(8, 10));
  return `${next.slice(0, 8)}${String(Math.min(Math.max(1, day), last)).padStart(2, "0")}`;
}

// ───────────────────────────── Escrita dos registros (EFD: "|REG|campo|...|")

/** Acumula as linhas do arquivo e a contagem por registro (bloco 9) e por bloco (registros x990). */
export class RecordWriter {
  lines: string[] = [];
  counts = new Map<string, number>();

  add(reg: string, ...fields: Field[]) {
    this.lines.push(line([reg, ...fields]));
    this.counts.set(reg, (this.counts.get(reg) ?? 0) + 1);
  }

  /** Linhas já escritas do bloco (1º caractere do registro), incluindo abertura e encerramento. */
  blockLines(block: string) {
    let n = 0;
    for (const [reg, c] of this.counts) if (reg[0] === block) n += c;
    return n;
  }

  /** Encerra o bloco (registro x990 com a quantidade de linhas do bloco, contando o próprio). */
  close(block: string) {
    this.add(`${block}990`, this.blockLines(block) + 1);
  }

  /** Bloco 9: 9001, um 9900 por registro (inclusive 9900, 9990 e 9999), 9990 e 9999. */
  finish() {
    this.add("9001", "0");
    const regs = [...this.counts.keys()];
    const total9900 = regs.length + 3; // + 9900, 9990, 9999
    for (const reg of regs) this.add("9900", reg, this.counts.get(reg));
    this.add("9900", "9900", total9900);
    this.add("9900", "9990", 1);
    this.add("9900", "9999", 1);
    this.add("9990", 1 + total9900 + 1 + 1); // 9001 + 9900s + 9990 + 9999
    this.add("9999", this.lines.length + 1);
  }

  /** Quantidade de linhas por bloco, na ordem do arquivo (para a prévia). */
  blocks(): Array<{ block: string; lines: number }> {
    const order: string[] = [];
    for (const l of this.lines) {
      const b = l[1];
      if (!order.includes(b)) order.push(b);
    }
    return order.map((b) => ({ block: b, lines: this.blockLines(b) }));
  }
}

/** Conferência estrutural do arquivo pronto: abertura/encerramento de cada bloco, x990, 9900 e 9999. */
export function checkStructure(lines: string[]): string[] {
  const problems: string[] = [];
  const regs = lines.map((l) => {
    if (!l.startsWith("|") || !l.endsWith("|")) problems.push(`Linha fora do formato |REG|...|: ${l.slice(0, 40)}`);
    return l.split("|")[1] ?? "";
  });
  const counts = new Map<string, number>();
  for (const r of regs) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const b of [...new Set(regs.map((r) => r[0]))]) {
    const idx = regs.map((r, i) => (r[0] === b ? i : -1)).filter((i) => i >= 0);
    const close = regs[idx[idx.length - 1]];
    if (b === "0" && (regs[0] !== "0000" || regs[1] !== "0001")) problems.push("Bloco 0 não abre com 0000/0001.");
    if (b !== "9" && b !== "0" && regs[idx[0]] !== `${b}001`) problems.push(`Bloco ${b} não abre com ${b}001.`);
    if (b === "9" && regs[idx[0]] !== "9001") problems.push("Bloco 9 não abre com 9001.");
    if (b !== "9" && close !== `${b}990`) problems.push(`Bloco ${b} não fecha com ${b}990.`);
    if (b !== "9" && Number(lines[idx[idx.length - 1]].split("|")[2]) !== idx.length) problems.push(`${b}990 não confere com as ${idx.length} linha(s) do bloco.`);
    if (b === "9") {
      const l9990 = lines.find((x) => x.startsWith("|9990|"));
      if (!l9990 || Number(l9990.split("|")[2]) !== idx.length) problems.push(`9990 não confere com as ${idx.length} linha(s) do bloco 9.`);
    }
    for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) problems.push(`Bloco ${b} com registros fora de ordem.`);
  }
  const declared = new Map(lines.filter((x) => x.startsWith("|9900|")).map((l) => [l.split("|")[2], Number(l.split("|")[3])] as const));
  for (const [reg, n] of counts) if (declared.get(reg) !== n) problems.push(`9900 de ${reg} não confere (${declared.get(reg) ?? "ausente"} × ${n}).`);
  const last = lines[lines.length - 1] ?? "";
  if (!last.startsWith("|9999|") || Number(last.split("|")[2]) !== lines.length) problems.push("9999 não confere com o total de linhas.");
  return [...new Set(problems)];
}
