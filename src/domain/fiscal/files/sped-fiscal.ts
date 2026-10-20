import { onlyDigits } from "@/lib/core/text";
import {
  analyticRows,
  checkStructure,
  dueDateFor,
  fmtDate,
  fmtMoney,
  fmtQty,
  fmtRate,
  fmtScaled,
  fmtText,
  RecordWriter,
  type AnalyticRow,
  type FiscalCteRecord,
  type FiscalDocRecord,
  type FiscalItem,
  type InventoryForFile,
  type MonthPeriod,
  type Participant,
  type Pendency,
} from "./common";
import type { Accountant, Establishment, UfRecolhimento } from "./settings";

/**
 * Gerador PURO da EFD ICMS/IPI (SPED Fiscal) de um estabelecimento × mês (§41). Sem acesso a banco: recebe os dados já
 * coletados (src/domain/fiscal/files/service.ts) e devolve as linhas, a contagem por registro, a apuração e as
 * conferências internas. Mesmos dados → mesmo conteúdo (ordem estável, nenhuma data/hora de geração no arquivo).
 *
 * Leiaute 020 (Ato COTEPE/ICMS 79/2025, Guia Prático 3.2.x, vigência 01/2026) — COD_VER "020". Blocos: 0, B (vazio, fora
 * do DF), C (C100/C101/C170/C190), D (D100/D190), E (E100/E110/E116, E200/E210/E250, E300/E310/E316), G (sem CIAP),
 * H (inventário), K (sem dados), 1 (1010) e 9. VALIDAR NO PVA DA RECEITA E COM A CONTABILIDADE ANTES DO PRIMEIRO ENVIO.
 */

export const SPED_FISCAL_COD_VER = "020";

export interface SpedFiscalInput {
  period: MonthPeriod;
  /** COD_FIN: 0 remessa original, 1 substituta (retificadora) */
  finality: "0" | "1";
  profile: "A" | "B" | "C";
  /** IND_ATIV: 0 industrial ou equiparado, 1 outros */
  activity: "0" | "1";
  establishment: Establishment;
  accountant: Accountant;
  participants: Participant[];
  units: Array<{ code: string; description: string }>;
  items: FiscalItem[];
  docs: FiscalDocRecord[];
  ctes: FiscalCteRecord[];
  inventory: InventoryForFile | null;
  /** saldo credor de ICMS do período anterior (E110 campo 10) */
  creditCarry: number;
  recolhimento: UfRecolhimento;
}

export interface SpedApuracao {
  debits: number;
  credits: number;
  creditCarry: number;
  balance: number;
  toPay: number;
  carryOut: number;
}

export interface SpedFiscalResult {
  lines: string[];
  counts: Array<{ reg: string; qty: number }>;
  blocks: Array<{ block: string; lines: number }>;
  apuracao: SpedApuracao;
  st: Array<{ uf: string; value: number }>;
  difal: Array<{ uf: string; difal: number; fcp: number }>;
  /** conferências internas (soma do C190 = C100, bloco 9, E110, participantes/itens no bloco 0) */
  checks: Pendency[];
}

const isExit = (cfop: string) => /^[567]/.test(cfop);
const isEntry = (cfop: string) => /^[123]/.test(cfop);
const regular = (d: FiscalDocRecord) => d.sit === "00" || d.sit === "06";
const m = fmtMoney;
const r = fmtRate;

export function buildSpedFiscal(i: SpedFiscalInput): SpedFiscalResult {
  const w = new RecordWriter();
  const checks: Pendency[] = [];
  const e = i.establishment;
  const a = i.accountant;
  const p = i.period;
  const dtIni = fmtDate(p.from);
  const dtFin = fmtDate(p.to);
  const mesRef = `${p.period.slice(5, 7)}${p.period.slice(0, 4)}`;

  // ── Bloco 0
  w.add("0000", SPED_FISCAL_COD_VER, i.finality, dtIni, dtFin, e.name, e.cnpj, "", e.uf, e.ie, e.cityCode, e.im, e.suframa, i.profile, i.activity);
  w.add("0001", "0");
  if (i.activity === "0") w.add("0002", "00");
  w.add("0005", e.tradeName, e.zip, e.street, e.number, e.complement, e.district, e.phone, "", e.email);
  w.add("0100", a.name, a.cpf, a.crc, a.cnpj, a.zip, a.street, a.number, a.complement, a.district, a.phone, "", a.email, a.cityCode);
  for (const x of i.participants) w.add("0150", x.code, x.name, x.country, x.cnpj, x.cpf, x.ie, x.cityCode, x.suframa, x.street, x.number, x.complement, x.district);
  for (const u of i.units) w.add("0190", u.code, u.description);
  for (const it of i.items) w.add("0200", it.code, it.description, it.barcode, "", it.unit, it.type, it.type === "09" ? "" : it.ncm, "", it.type !== "09" && it.ncm ? it.ncm.slice(0, 2) : "", "", "", it.cest);
  w.close("0");

  // ── Bloco B (ISS — só para o DF)
  w.add("B001", "1");
  w.close("B");

  // ── Bloco C
  const analytic = new Map<string, AnalyticRow[]>();
  w.add("C001", i.docs.length ? "0" : "1");
  for (const d of i.docs) {
    if (!regular(d)) {
      w.add("C100", d.oper, d.emit, "", d.model, d.sit, d.series, d.number, d.sit === "05" ? "" : d.accessKey, ...Array(20).fill(""));
      continue;
    }
    // entradas: a diferença para o VL_DOC (ex.: ICMS desonerado do XML) vai para o maior grupo; emissão própria: sem ajuste (conferido abaixo)
    const rows = analyticRows(d.lines, d.source === "receipt" ? d.total : null);
    analytic.set(d.id, rows);
    const sum = (f: (x: AnalyticRow) => number) => rows.reduce((acc, x) => acc + f(x), 0);
    const nfce = d.model === "65";
    w.add(
      "C100", d.oper, d.emit, nfce ? "" : d.partCode, d.model, d.sit, d.series, d.number, d.accessKey, fmtDate(d.issueDate), fmtDate(d.ioDate ?? d.issueDate),
      m(d.total), d.payInd, m(d.discount), m(0), m(d.merch), d.freightInd, m(d.freight), m(d.insurance), m(d.other),
      m(sum((x) => x.icmsBase)), m(sum((x) => x.icms)), nfce ? "" : m(sum((x) => x.stBase)), nfce ? "" : m(sum((x) => x.st)), nfce ? "" : m(sum((x) => x.ipi)),
      nfce ? "" : m(d.pis), nfce ? "" : m(d.cofins), nfce ? "" : m(0), nfce ? "" : m(0),
    );
    if (d.difal && (d.difal.dest || d.difal.fcp)) w.add("C101", m(d.difal.fcp), m(d.difal.dest), m(d.difal.remet));
    // C170: itens das ENTRADAS (documentos de terceiros); NF-e/NFC-e de emissão própria dispensam o C170 (Guia Prático)
    if (d.emit === "1") {
      for (const l of d.lines) {
        w.add(
          "C170", l.num, l.itemCode, "", fmtQty(l.qty), l.unit, m(l.gross), m(l.discount), l.movesStock ? "0" : "1", l.cstIcms, l.cfop, "",
          m(l.icmsBase), r(l.icmsRateBps), m(l.icms), m(l.stBase), r(l.stRateBps), m(l.st), "", l.ipiCst, "", l.ipi ? m(l.ipiBase) : "", l.ipi ? r(l.ipiRateBps) : "", m(l.ipi),
          l.pisCst, m(l.pisBase), r(l.pisRateBps), "", "", m(l.pis), l.cofinsCst, m(l.cofinsBase), r(l.cofinsRateBps), "", "", m(l.cofins), "", m(0),
        );
      }
    }
    for (const x of rows) w.add("C190", x.cstIcms, x.cfop, r(x.icmsRateBps), m(x.value), m(x.icmsBase), m(x.icms), m(x.stBase), m(x.st), m(x.redBase), m(x.ipi), "");
    const opr = sum((x) => x.value);
    if (opr !== d.total) checks.push({ severity: "error", code: "c190_total", message: `Documento ${d.model === "65" ? "NFC-e" : "NF-e"} ${d.number}: soma do C190 (${m(opr)}) diferente do valor do documento no C100 (${m(d.total)}).`, href: d.href });
  }
  w.close("C");

  // ── Bloco D (CT-e de entrada — frete de compra)
  const dRows = new Map<string, AnalyticRow[]>();
  w.add("D001", i.ctes.length ? "0" : "1");
  for (const c of i.ctes) {
    const row: AnalyticRow = { cstIcms: c.cstIcms, cfop: c.cfop, icmsRateBps: c.icmsRateBps, value: c.total, icmsBase: c.icmsBase, icms: c.icms, stBase: 0, st: 0, redBase: 0, ipi: 0 };
    dRows.set(c.id, [row]);
    w.add("D100", "0", "1", c.partCode, "57", "00", c.series, "", c.number, c.accessKey, fmtDate(c.issueDate), fmtDate(c.ioDate), c.cteType, "", m(c.total), m(0), c.freightInd, m(c.total), m(c.icmsBase), m(c.icms), m(c.total - c.icmsBase), "", "", c.munStart, c.munEnd || e.cityCode);
    w.add("D190", row.cstIcms, row.cfop, r(row.icmsRateBps), m(row.value), m(row.icmsBase), m(row.icms), m(0), "");
  }
  w.close("D");

  // ── Bloco E (apuração do ICMS a partir dos C190/D190)
  const allRows = [...analytic.values(), ...dRows.values()].flat();
  const debits = allRows.filter((x) => isExit(x.cfop)).reduce((acc, x) => acc + x.icms, 0);
  const credits = allRows.filter((x) => isEntry(x.cfop)).reduce((acc, x) => acc + x.icms, 0);
  const net = debits - credits - i.creditCarry;
  const balance = Math.max(0, net);
  const carryOut = Math.max(0, -net);
  const apuracao: SpedApuracao = { debits, credits, creditCarry: i.creditCarry, balance, toPay: balance, carryOut };
  w.add("E001", "0");
  w.add("E100", dtIni, dtFin);
  w.add("E110", m(debits), m(0), m(0), m(0), m(credits), m(0), m(0), m(0), m(i.creditCarry), m(balance), m(0), m(balance), m(carryOut), m(0));
  const ownUf = e.uf;
  const rec = (uf: string) => i.recolhimento[uf] ?? null;
  if (balance > 0) {
    const x = rec(ownUf);
    w.add("E116", "000", m(balance), fmtDate(dueDateFor(p.period, x?.day ?? 20)), x?.code ?? "", "", "", "", "", mesRef);
  }
  // E200/E210: ICMS-ST retido nas SAÍDAS (contribuinte substituto), por UF do destinatário
  const stByUf = new Map<string, number>();
  for (const d of i.docs) {
    if (!regular(d) || d.oper !== "1") continue;
    const st = (analytic.get(d.id) ?? []).filter((x) => isExit(x.cfop)).reduce((acc, x) => acc + x.st, 0);
    if (!st) continue;
    const uf = d.partyUf || ownUf;
    stByUf.set(uf, (stByUf.get(uf) ?? 0) + st);
  }
  const st = [...stByUf.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([uf, value]) => ({ uf, value }));
  for (const s of st) {
    w.add("E200", s.uf, dtIni, dtFin);
    w.add("E210", "1", m(0), m(0), m(0), m(0), m(0), m(s.value), m(0), m(0), m(s.value), m(0), m(s.value), m(0), m(0));
    const x = rec(s.uf);
    w.add("E250", s.uf === ownUf ? "002" : "999", m(s.value), fmtDate(dueDateFor(p.period, x?.day ?? 20)), x?.code ?? "", "", "", "", "", mesRef);
  }
  // E300/E310: DIFAL/FCP da EC 87/2015 por UF de destino (a partir dos C101)
  const difByUf = new Map<string, { difal: number; fcp: number }>();
  for (const d of i.docs) {
    if (!regular(d) || !d.difal) continue;
    const uf = d.partyUf;
    const g = difByUf.get(uf) ?? { difal: 0, fcp: 0 };
    g.difal += d.difal.dest;
    g.fcp += d.difal.fcp;
    difByUf.set(uf, g);
  }
  const difal = [...difByUf.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([uf, v]) => ({ uf, ...v }));
  for (const df of difal) {
    w.add("E300", df.uf, dtIni, dtFin);
    w.add("E310", "1", m(0), m(df.difal), m(0), m(0), m(0), m(df.difal), m(0), m(df.difal), m(0), m(0), m(0), m(df.fcp), m(0), m(0), m(0), m(df.fcp), m(0), m(df.fcp), m(0), m(0));
    const x = rec(df.uf);
    const due = fmtDate(dueDateFor(p.period, x?.day ?? 20));
    if (df.difal) w.add("E316", "000", m(df.difal), due, x?.code ?? "", "", "", "", "", mesRef);
    if (df.fcp) w.add("E316", "006", m(df.fcp), due, x?.code ?? "", "", "", "", "", mesRef);
  }
  w.close("E");

  // ── Bloco G (sem CIAP)
  w.add("G001", "1");
  w.close("G");

  // ── Bloco H (inventário)
  if (i.inventory) {
    w.add("H001", "0");
    w.add("H005", fmtDate(i.inventory.date), m(i.inventory.total), "01");
    for (const x of i.inventory.rows) w.add("H010", x.itemCode, x.unit, fmtQty(x.qty), fmtScaled(x.unitMicro, 6), m(x.value), "0", "", "", "", "");
  } else w.add("H001", "1");
  w.close("H");

  // ── Bloco K (sem produção/estoque escriturado — indicador sem dados)
  w.add("K001", "1");
  w.close("K");

  // ── Bloco 1 (indicadores S/N)
  w.add("1001", "0");
  w.add("1010", "N", "N", "N", "N", "N", "N", "N", "N", "N", "N", "N", "N", "N");
  w.close("1");

  w.finish();

  // conferências internas
  if (debits - credits - i.creditCarry !== balance - carryOut) checks.push({ severity: "error", code: "e110", message: "E110 não fecha: débitos − créditos − saldo anterior ≠ saldo apurado − saldo credor a transportar." });
  const parts = new Set(i.participants.map((x) => x.code));
  const items = new Set(i.items.map((x) => x.code));
  const units = new Set(i.units.map((x) => x.code));
  for (const d of i.docs) if (d.partCode && !parts.has(d.partCode)) checks.push({ severity: "error", code: "ref_0150", message: `Participante ${d.partCode} do documento ${d.number} sem registro 0150.`, href: d.href });
  for (const c of i.ctes) if (!parts.has(c.partCode)) checks.push({ severity: "error", code: "ref_0150", message: `Participante ${c.partCode} do CT-e ${c.number} sem registro 0150.`, href: c.href });
  for (const d of i.docs) for (const l of d.emit === "1" ? d.lines : []) if (!items.has(l.itemCode) || !units.has(l.unit)) checks.push({ severity: "error", code: "ref_0200", message: `Item ${l.itemCode} do documento ${d.number} sem registro 0200/0190.`, href: d.href });
  for (const x of i.inventory?.rows ?? []) if (!items.has(x.itemCode)) checks.push({ severity: "error", code: "ref_0200", message: `Item ${x.itemCode} do inventário sem registro 0200.` });
  for (const problem of checkStructure(w.lines)) checks.push({ severity: "error", code: "structure", message: problem });

  return { lines: w.lines, counts: [...w.counts.entries()].map(([reg, qty]) => ({ reg, qty })), blocks: w.blocks(), apuracao, st, difal, checks };
}

/** Rótulo do arquivo (nome sugerido): SPED-EFD-ICMS-IPI_<CNPJ>_<AAAAMM>.txt */
export const spedFiscalFileName = (cnpj: string, period: string, finality: "0" | "1") => `SPED-EFD-ICMS-IPI_${onlyDigits(cnpj)}_${period.replace("-", "")}${finality === "1" ? "_retificadora" : ""}.txt`;

export const spedText = fmtText;
