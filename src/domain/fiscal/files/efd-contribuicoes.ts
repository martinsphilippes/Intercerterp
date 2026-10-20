import { onlyDigits } from "@/lib/core/text";
import { roundDiv } from "@/lib/money";
import {
  checkStructure,
  fmtDate,
  fmtMoney,
  fmtQty,
  fmtRate,
  RecordWriter,
  type FiscalDocLine,
  type FiscalDocRecord,
  type FiscalItem,
  type MonthPeriod,
  type Participant,
  type Pendency,
  type ServiceDocRecord,
} from "./common";
import type { Accountant, Establishment } from "./settings";

/**
 * Gerador PURO da EFD Contribuições (PIS/COFINS) da EMPRESA × mês — a matriz centraliza todos os estabelecimentos (§41).
 * Leiaute 006 (Guia Prático da EFD Contribuições, versão 1.35 — COD_VER "006"). Regime pela empresa: Lucro Presumido =
 * cumulativo (0110: COD_INC_TRIB 2, IND_REG_CUM 9 — regime de competência com escrituração detalhada); Lucro Real = não
 * cumulativo (COD_INC_TRIB 1, apropriação direta, alíquota básica). Simples Nacional não entrega (bloqueado antes).
 * Blocos: 0 (0000, 0001, 0100, 0110, 0140 por estabelecimento com 0150/0190/0200), A (NFS-e emitida: A010/A100/A170),
 * C (C010 por estabelecimento; NF-e: C100/C170; NFC-e: C100 + C175 analítico), D/F/I/P vazios, M (M100/M105 e M500/M505
 * créditos no não cumulativo; M200/M205/M210 PIS; M400/M410 receitas não tributadas; M600/M605/M610 COFINS; M800/M810),
 * 1 e 9. VALIDAR NO PVA DA RECEITA E COM A CONTABILIDADE ANTES DO PRIMEIRO ENVIO.
 */

export const EFD_CONTRIB_COD_VER = "006";

export type ContribRegime = "cumulative" | "non_cumulative";

export interface EfdEstablishment {
  branchId: string;
  establishment: Establishment;
  participants: Participant[];
  units: Array<{ code: string; description: string }>;
  items: FiscalItem[];
  docs: FiscalDocRecord[];
  services: ServiceDocRecord[];
}

export interface EfdContribInput {
  period: MonthPeriod;
  /** TIPO_ESCRIT: 0 original, 1 retificadora */
  finality: "0" | "1";
  /** número do recibo da escrituração anterior (retificadora) */
  previousReceipt: string;
  regime: ContribRegime;
  /** IND_ATIV: 0 industrial, 1 serviços, 2 comércio, 3 financeira, 4 imobiliária, 9 outros */
  activity: string;
  company: Establishment;
  accountant: Accountant;
  establishments: EfdEstablishment[];
}

export interface ContribTotals {
  /** receita tributada (base) e contribuição apurada, créditos e a recolher */
  pisBase: number;
  pis: number;
  pisCredit: number;
  pisDue: number;
  cofinsBase: number;
  cofins: number;
  cofinsCredit: number;
  cofinsDue: number;
  /** receita sem incidência/isenta/alíquota zero/suspensão/monofásica (M400/M800) */
  nonTaxed: number;
}

export interface EfdContribResult {
  lines: string[];
  counts: Array<{ reg: string; qty: number }>;
  blocks: Array<{ block: string; lines: number }>;
  totals: ContribTotals;
  checks: Pendency[];
}

/** Alíquotas básicas (pontos-base): cumulativo 0,65% / 3%; não cumulativo 1,65% / 7,6%. */
export const CONTRIB_RATES = { cumulative: { pis: 65, cofins: 300 }, non_cumulative: { pis: 165, cofins: 760 } } as const;
/** Códigos de receita do DARF (M205/M605). */
const DARF = { cumulative: { pis: "810902", cofins: "217201" }, non_cumulative: { pis: "691201", cofins: "585601" } } as const;

const TAXED_CST = ["01", "02", "03", "05"];
const NON_TAXED_CST = ["04", "06", "07", "08", "09"];
const m = fmtMoney;
const r = (bps: number | null | undefined) => (bps == null ? "" : fmtRate(bps));
const regular = (d: { sit: string }) => d.sit === "00" || d.sit === "06";
const cst2 = (c: string | null | undefined) => String(c ?? "").padStart(2, "0").slice(-2);

interface ContribLine {
  cst: string;
  rateBps: number;
  revenue: number;
  base: number;
}

export function buildEfdContribuicoes(i: EfdContribInput): EfdContribResult {
  const w = new RecordWriter();
  const checks: Pendency[] = [];
  const c = i.company;
  const a = i.accountant;
  const p = i.period;
  const dtIni = fmtDate(p.from);
  const dtFin = fmtDate(p.to);
  const nc = i.regime === "non_cumulative";

  // ── Bloco 0
  w.add("0000", EFD_CONTRIB_COD_VER, i.finality, "", i.finality === "1" ? onlyDigits(i.previousReceipt) || i.previousReceipt : "", dtIni, dtFin, c.name, c.cnpj, c.uf, c.cityCode, c.suframa, "00", i.activity);
  w.add("0001", "0");
  w.add("0100", a.name, a.cpf, a.crc, a.cnpj, a.zip, a.street, a.number, a.complement, a.district, a.phone, "", a.email, a.cityCode);
  w.add("0110", nc ? "1" : "2", nc ? "1" : "", "1", nc ? "" : "9");
  for (const est of i.establishments) {
    const e = est.establishment;
    w.add("0140", "", e.name, e.cnpj, e.uf, e.ie, e.cityCode, e.im, e.suframa);
    for (const x of est.participants) w.add("0150", x.code, x.name, x.country, x.cnpj, x.cpf, x.ie, x.cityCode, x.suframa, x.street, x.number, x.complement, x.district);
    for (const u of est.units) w.add("0190", u.code, u.description);
    for (const it of est.items) w.add("0200", it.code, it.description, it.barcode, "", it.unit, it.type, it.type === "09" ? "" : it.ncm, "", it.type !== "09" && it.ncm ? it.ncm.slice(0, 2) : "", "", "");
  }
  w.close("0");

  const rates = CONTRIB_RATES[i.regime];
  const pisLines: ContribLine[] = [];
  const cofinsLines: ContribLine[] = [];
  const pisCredits: Array<{ cst: string; base: number }> = [];
  const cofinsCredits: Array<{ cst: string; base: number }> = [];
  const nonTaxedPis = new Map<string, number>();
  const nonTaxedCofins = new Map<string, number>();
  const revenueOf = (l: FiscalDocLine) => l.gross - l.discount;
  const take = (l: FiscalDocLine) => {
    const pc = cst2(l.pisCst);
    const cc = cst2(l.cofinsCst);
    if (TAXED_CST.includes(pc)) pisLines.push({ cst: pc, rateBps: l.pisRateBps || rates.pis, revenue: revenueOf(l), base: l.pisBase });
    else if (NON_TAXED_CST.includes(pc)) nonTaxedPis.set(pc, (nonTaxedPis.get(pc) ?? 0) + revenueOf(l));
    if (TAXED_CST.includes(cc)) cofinsLines.push({ cst: cc, rateBps: l.cofinsRateBps || rates.cofins, revenue: revenueOf(l), base: l.cofinsBase });
    else if (NON_TAXED_CST.includes(cc)) nonTaxedCofins.set(cc, (nonTaxedCofins.get(cc) ?? 0) + revenueOf(l));
  };

  // ── Bloco A (serviços — NFS-e emitidas)
  const withServices = i.establishments.filter((e) => e.services.some(regular));
  w.add("A001", withServices.length ? "0" : "1");
  for (const est of withServices) {
    w.add("A010", est.establishment.cnpj);
    for (const s of est.services.filter(regular)) {
      const revenue = s.amount - s.discount;
      const pis = roundDiv(revenue * rates.pis, 10000);
      const cofins = roundDiv(revenue * rates.cofins, 10000);
      w.add("A100", "1", "0", s.partCode, s.sit, s.series, "", s.number, s.accessKey, fmtDate(s.issueDate), fmtDate(s.competence), m(s.amount), "1", m(s.discount), m(revenue), m(pis), m(revenue), m(cofins), m(s.pisWithheld), m(s.cofinsWithheld), m(s.iss));
      w.add("A170", 1, s.itemCode, s.description, m(s.amount), m(s.discount), "", "", "01", m(revenue), r(rates.pis), m(pis), "01", m(revenue), r(rates.cofins), m(cofins), "", "");
      pisLines.push({ cst: "01", rateBps: rates.pis, revenue, base: revenue });
      cofinsLines.push({ cst: "01", rateBps: rates.cofins, revenue, base: revenue });
    }
  }
  w.close("A");

  // ── Bloco C (mercadorias)
  const withDocs = i.establishments.filter((e) => e.docs.some((d) => d.oper === "1" || (nc && d.emit === "1")));
  w.add("C001", withDocs.length ? "0" : "1");
  for (const est of withDocs) {
    w.add("C010", est.establishment.cnpj, "2");
    for (const d of est.docs) {
      // cumulativo: só as saídas (receitas); não cumulativo: também as entradas de terceiros com direito a crédito
      if (d.oper === "0" && !(nc && d.emit === "1")) continue;
      if (!regular(d)) {
        w.add("C100", d.oper, d.emit, "", d.model, d.sit, d.series, d.number, d.sit === "05" ? "" : d.accessKey, ...Array(20).fill(""));
        continue;
      }
      const nfce = d.model === "65";
      const sum = (f: (l: FiscalDocLine) => number) => d.lines.reduce((acc, l) => acc + f(l), 0);
      const pis = sum((l) => l.pis);
      const cofins = sum((l) => l.cofins);
      w.add(
        "C100", d.oper, d.emit, nfce ? "" : d.partCode, d.model, d.sit, d.series, d.number, d.accessKey, fmtDate(d.issueDate), fmtDate(d.ioDate ?? d.issueDate),
        m(d.total), d.payInd, m(d.discount), m(0), m(d.merch), d.freightInd, m(d.freight), m(d.insurance), m(d.other), m(sum((l) => l.icmsBase)), m(sum((l) => l.icms)),
        nfce ? "" : m(sum((l) => l.stBase)), nfce ? "" : m(sum((l) => l.st)), nfce ? "" : m(sum((l) => l.ipi)), m(pis), m(cofins), nfce ? "" : m(0), nfce ? "" : m(0),
      );
      if (nfce) {
        // NFC-e (modelo 65): registro analítico C175 por CFOP × CST × alíquota (sem C170)
        const by = new Map<string, { cfop: string; opr: number; desc: number; pc: string; pb: number; pr: number; pv: number; cc: string; cb: number; cr: number; cv: number }>();
        for (const l of d.lines) {
          const k = `${l.cfop}|${l.pisCst}|${l.pisRateBps}|${l.cofinsCst}|${l.cofinsRateBps}`;
          const g = by.get(k) ?? { cfop: l.cfop, opr: 0, desc: 0, pc: cst2(l.pisCst), pb: 0, pr: l.pisRateBps, pv: 0, cc: cst2(l.cofinsCst), cb: 0, cr: l.cofinsRateBps, cv: 0 };
          g.opr += l.gross;
          g.desc += l.discount;
          g.pb += l.pisBase;
          g.pv += l.pis;
          g.cb += l.cofinsBase;
          g.cv += l.cofins;
          by.set(k, g);
          take(l);
        }
        for (const g of [...by.values()].sort((x, y) => x.cfop.localeCompare(y.cfop) || x.pc.localeCompare(y.pc))) w.add("C175", g.cfop, m(g.opr), m(g.desc), g.pc, m(g.pb), r(g.pr), "", "", m(g.pv), g.cc, m(g.cb), r(g.cr), "", "", m(g.cv), "", "");
        continue;
      }
      for (const l of d.lines) {
        w.add(
          "C170", l.num, l.itemCode, "", fmtQty(l.qty), l.unit, m(l.gross), m(l.discount), l.movesStock ? "0" : "1", l.cstIcms, l.cfop, "",
          m(l.icmsBase), r(l.icmsRateBps), m(l.icms), m(l.stBase), r(l.stRateBps), m(l.st), "", l.ipiCst, "", l.ipi ? m(l.ipiBase) : "", l.ipi ? r(l.ipiRateBps) : "", m(l.ipi),
          cst2(l.pisCst), m(l.pisBase), r(l.pisRateBps), "", "", m(l.pis), cst2(l.cofinsCst), m(l.cofinsBase), r(l.cofinsRateBps), "", "", m(l.cofins), "",
        );
        if (d.oper === "1") take(l);
        else if (nc && cst2(l.pisCst) === "50") {
          pisCredits.push({ cst: "50", base: l.pisBase });
          cofinsCredits.push({ cst: "50", base: l.cofinsBase });
        }
      }
    }
  }
  w.close("C");

  for (const b of ["D", "F", "I"]) {
    w.add(`${b}001`, "1");
    w.close(b);
  }

  // ── Bloco M (apuração)
  const contribGroups = (lines: ContribLine[]) => {
    const by = new Map<number, { rateBps: number; revenue: number; base: number }>();
    for (const l of lines) {
      const g = by.get(l.rateBps) ?? { rateBps: l.rateBps, revenue: 0, base: 0 };
      g.revenue += l.revenue;
      g.base += l.base;
      by.set(l.rateBps, g);
    }
    return [...by.values()].sort((x, y) => x.rateBps - y.rateBps).map((g) => ({ ...g, value: roundDiv(g.base * g.rateBps, 10000) }));
  };
  const pisG = contribGroups(pisLines);
  const cofG = contribGroups(cofinsLines);
  const pisApur = pisG.reduce((acc, g) => acc + g.value, 0);
  const cofApur = cofG.reduce((acc, g) => acc + g.value, 0);
  const credBase = (list: Array<{ base: number }>) => list.reduce((acc, x) => acc + x.base, 0);
  const pisCredBase = nc ? credBase(pisCredits) : 0;
  const cofCredBase = nc ? credBase(cofinsCredits) : 0;
  const pisCred = roundDiv(pisCredBase * CONTRIB_RATES.non_cumulative.pis, 10000);
  const cofCred = roundDiv(cofCredBase * CONTRIB_RATES.non_cumulative.cofins, 10000);
  const pisCredUsed = Math.min(pisCred, pisApur);
  const cofCredUsed = Math.min(cofCred, cofApur);
  const pisDue = pisApur - pisCredUsed;
  const cofDue = cofApur - cofCredUsed;
  const codCont = nc ? "01" : "51";
  w.add("M001", "0");
  if (nc && pisCred > 0) {
    w.add("M100", "101", "0", m(pisCredBase), r(CONTRIB_RATES.non_cumulative.pis), "", "", m(pisCred), m(0), m(0), m(0), m(pisCred), pisCredUsed === pisCred ? "0" : "1", m(pisCredUsed), m(pisCred - pisCredUsed));
    w.add("M105", "01", "50", m(pisCredBase), m(0), m(pisCredBase), m(pisCredBase), "", "", "");
  }
  w.add("M200", m(nc ? pisApur : 0), m(nc ? pisCredUsed : 0), m(0), m(nc ? pisDue : 0), m(0), m(0), m(nc ? pisDue : 0), m(nc ? 0 : pisApur), m(0), m(0), m(nc ? 0 : pisDue), m(pisDue));
  if (pisDue > 0) w.add("M205", nc ? "08" : "12", DARF[i.regime].pis, m(pisDue));
  for (const g of pisG) w.add("M210", codCont, m(g.revenue), m(g.base), m(0), m(0), m(g.base), r(g.rateBps), "", "", m(g.value), m(0), m(0), m(0), m(0), m(g.value));
  for (const [cst, value] of [...nonTaxedPis.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    w.add("M400", cst, m(value), "", "");
    w.add("M410", "999", m(value), "", "");
  }
  if (nc && cofCred > 0) {
    w.add("M500", "101", "0", m(cofCredBase), r(CONTRIB_RATES.non_cumulative.cofins), "", "", m(cofCred), m(0), m(0), m(0), m(cofCred), cofCredUsed === cofCred ? "0" : "1", m(cofCredUsed), m(cofCred - cofCredUsed));
    w.add("M505", "01", "50", m(cofCredBase), m(0), m(cofCredBase), m(cofCredBase), "", "", "");
  }
  w.add("M600", m(nc ? cofApur : 0), m(nc ? cofCredUsed : 0), m(0), m(nc ? cofDue : 0), m(0), m(0), m(nc ? cofDue : 0), m(nc ? 0 : cofApur), m(0), m(0), m(nc ? 0 : cofDue), m(cofDue));
  if (cofDue > 0) w.add("M605", nc ? "08" : "12", DARF[i.regime].cofins, m(cofDue));
  for (const g of cofG) w.add("M610", codCont, m(g.revenue), m(g.base), m(0), m(0), m(g.base), r(g.rateBps), "", "", m(g.value), m(0), m(0), m(0), m(0), m(g.value));
  for (const [cst, value] of [...nonTaxedCofins.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    w.add("M800", cst, m(value), "", "");
    w.add("M810", "999", m(value), "", "");
  }
  w.close("M");

  w.add("P001", "1");
  w.close("P");
  w.add("1001", "1");
  w.close("1");
  w.finish();

  // conferências internas
  const parts = new Set(i.establishments.flatMap((e) => e.participants.map((x) => `${e.branchId}|${x.code}`)));
  for (const e of i.establishments) for (const d of e.docs) if (d.partCode && !parts.has(`${e.branchId}|${d.partCode}`)) checks.push({ severity: "error", code: "ref_0150", message: `Participante ${d.partCode} sem 0150 no estabelecimento.`, href: d.href });
  for (const problem of checkStructure(w.lines)) checks.push({ severity: "error", code: "structure", message: problem });
  const nonTaxed = [...nonTaxedPis.values()].reduce((acc, v) => acc + v, 0);
  return {
    lines: w.lines,
    counts: [...w.counts.entries()].map(([reg, qty]) => ({ reg, qty })),
    blocks: w.blocks(),
    totals: { pisBase: pisG.reduce((acc, g) => acc + g.base, 0), pis: pisApur, pisCredit: pisCredUsed, pisDue, cofinsBase: cofG.reduce((acc, g) => acc + g.base, 0), cofins: cofApur, cofinsCredit: cofCredUsed, cofinsDue: cofDue, nonTaxed },
    checks,
  };
}

export const efdContribFileName = (cnpj: string, period: string, finality: "0" | "1") => `EFD-CONTRIBUICOES_${onlyDigits(cnpj)}_${period.replace("-", "")}${finality === "1" ? "_retificadora" : ""}.txt`;
