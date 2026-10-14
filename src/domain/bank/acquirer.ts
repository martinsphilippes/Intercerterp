import { clean, dateFlexible, decodeBankFile, parseDecimalToCents, splitLines, type LineIssue } from "./common";
import { splitCsvLine } from "./csv";

/**
 * FIN-24 — Leitor genérico do arquivo de vendas/pagamentos da adquirente em CSV (Cielo, Rede, Stone, GetNet,
 * PagSeguro e outras exportam planilhas com estas colunas, cada uma com nomes e ordem próprios).
 *
 * Layout configurável: separador, linhas a pular, cabeçalho, ordem da data, separador decimal e, para cada campo,
 * o índice (0-based) da coluna:
 *   saleDate (data da venda) · nsu (NSU/CV/DOC) · authCode (autorização, opcional) · brand (bandeira) ·
 *   installments (parcela "2/3", "2 de 3" ou total "3") · gross (valor bruto) · fee (taxa/MDR em R$ ou %) ·
 *   net (valor líquido) · creditDate (data de crédito/pagamento).
 * Taxa ausente = bruto − líquido; líquido ausente = bruto − taxa; taxa em "%" (ex.: "3,49%") é aplicada ao bruto.
 * Todos os valores saem em CENTAVOS e datas em AAAA-MM-DD. O layout de exemplo está em docs/regras-assumidas.md (§36)
 * e em tests/fixtures/adquirente-exemplo.csv.
 */

export interface AcquirerLayout {
  delimiter: string;
  hasHeader: boolean;
  skipRows: number;
  dateOrder: "dmy" | "ymd" | "mdy";
  decimal: "," | ".";
  saleDate: number | null;
  nsu: number | null;
  authCode: number | null;
  brand: number | null;
  installments: number | null;
  gross: number | null;
  fee: number | null;
  net: number | null;
  creditDate: number | null;
}

export const ACQUIRER_FIELDS: Array<{ key: keyof AcquirerLayout; label: string; required: boolean }> = [
  { key: "saleDate", label: "Data da venda", required: false },
  { key: "nsu", label: "NSU / CV / documento", required: true },
  { key: "authCode", label: "Código de autorização", required: false },
  { key: "brand", label: "Bandeira", required: false },
  { key: "installments", label: "Parcela (ex.: 2/3)", required: false },
  { key: "gross", label: "Valor bruto", required: true },
  { key: "fee", label: "Taxa (R$ ou %)", required: false },
  { key: "net", label: "Valor líquido", required: false },
  { key: "creditDate", label: "Data de crédito", required: true },
];

export interface AcquirerLine {
  lineNo: number;
  saleDate: string | null;
  nsu: string | null;
  authCode: string | null;
  brand: string | null;
  /** número da parcela (1-based) quando o arquivo informa "k/n" */
  installment: number | null;
  /** total de parcelas da venda */
  installments: number | null;
  gross: number;
  fee: number;
  net: number;
  creditDate: string;
}

export interface AcquirerParse {
  lines: AcquirerLine[];
  issues: LineIssue[];
  totalLines: number;
  fatal: string | null;
}

export interface AcquirerSniff {
  delimiter: string;
  header: string[] | null;
  rows: string[][];
  columns: number;
  guess: AcquirerLayout;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function detectDelimiter(lines: string[]) {
  let best = ";";
  let bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const freq = new Map<number, number>();
    for (const l of lines.slice(0, 15)) {
      const c = splitCsvLine(l, d).length;
      freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    let common = 1;
    let commonFreq = 0;
    for (const [c, f] of freq) if (f > commonFreq || (f === commonFreq && c > common)) [common, commonFreq] = [c, f];
    const score = common > 1 ? commonFreq * 100 + common : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Pré-visualização: separador, cabeçalho e o layout sugerido pelos nomes das colunas. */
export function sniffAcquirerCsv(text: string): AcquirerSniff {
  const lines = splitLines(text).filter((l) => l.trim() !== "");
  const delimiter = detectDelimiter(lines);
  const all = lines.map((l) => splitCsvLine(l, delimiter));
  const columns = Math.max(0, ...all.map((r) => r.length));
  let headerIdx = -1;
  for (let i = 0; i < Math.min(all.length, 10); i++) {
    const r = all[i].map(norm);
    if (r.some((c) => /(nsu|bruto|bandeira|autoriza|liquido)/.test(c)) && !all[i].some((c) => dateFlexible(c))) {
      headerIdx = i;
      break;
    }
  }
  const header = headerIdx >= 0 ? all[headerIdx] : null;
  const h = header ? header.map(norm) : [];
  const used = new Set<number>();
  const find = (re: RegExp, not?: RegExp) => {
    const i = h.findIndex((c, k) => !used.has(k) && re.test(c) && !(not && not.test(c)));
    if (i >= 0) used.add(i);
    return i >= 0 ? i : null;
  };
  // ordem importa: data de crédito antes da data da venda (ambas começam por "data")
  const creditDate = find(/(credito|pagamento|liquidac|recebimento|previs|deposito)/, /(valor|vlr|taxa)/);
  const saleDate = find(/(data|dt|date)/, /(valor|vlr)/);
  const nsu = find(/(nsu|^cv$|comprovante|^doc|documento|^tid)/);
  const authCode = find(/autoriz/);
  const brand = find(/(bandeira|brand|cartao)/);
  const installments = find(/(parcela|plano|prestac)/);
  const gross = find(/(bruto|valor da venda|valor venda|valor original|^valor$)/);
  const fee = find(/(taxa|mdr|desconto|tarifa|comissao)/);
  const net = find(/(liquido|valor a receber|valor creditado|valor pago)/);
  const body = all.slice(headerIdx + 1);
  const amounts = body.slice(0, 20).map((r) => r[gross ?? 0] ?? "");
  const decimal: "," | "." = amounts.some((s) => /,\d{1,2}$/.test(s.trim())) ? "," : amounts.some((s) => /\.\d{1,2}$/.test(s.trim())) ? "." : ",";
  const dates = body.slice(0, 20).map((r) => r[creditDate ?? saleDate ?? 0] ?? "");
  // ISO (AAAA-MM-DD) é lido em qualquer ordem; "ymd" só quando a maioria das datas começa pelo ano
  const ymd = dates.filter((d) => /^\d{4}[/.-]/.test(d)).length;
  const dateOrder: "dmy" | "ymd" = ymd > dates.filter((d) => /^\d{1,2}[/.-]/.test(d)).length ? "ymd" : "dmy";
  return {
    delimiter,
    header,
    rows: body.slice(0, 50),
    columns,
    guess: { delimiter, hasHeader: headerIdx >= 0, skipRows: Math.max(0, headerIdx), dateOrder, decimal, saleDate, nsu, authCode, brand, installments, gross, fee, net, creditDate },
  };
}

export function validateAcquirerLayout(l: AcquirerLayout, columns: number): string | null {
  const ok = (c: number | null | undefined) => c != null && c >= 0 && c < Math.max(columns, 1);
  for (const f of ACQUIRER_FIELDS) if (f.required && !ok(l[f.key] as number | null)) return `Selecione a coluna "${f.label}".`;
  if (!ok(l.fee) && !ok(l.net)) return "Selecione a coluna da taxa ou a do valor líquido.";
  return null;
}

/** "2/3", "2 de 3", "02-03" → { k: 2, n: 3 }; "3" → { k: null, n: 3 }; "à vista"/"1" → n = 1. */
export function parseInstallment(raw: string): { k: number | null; n: number | null } {
  const s = norm(raw);
  if (!s) return { k: null, n: null };
  if (/vista|debito|^0$/.test(s)) return { k: 1, n: 1 };
  const m = s.match(/^(\d{1,2})\s*(?:\/|de|-|\|)\s*(\d{1,2})/);
  if (m) return { k: Number(m[1]), n: Number(m[2]) };
  const n = s.match(/^(\d{1,2})\s*x?$/);
  if (n) return { k: Number(n[1]) === 1 ? 1 : null, n: Number(n[1]) };
  return { k: null, n: null };
}

/** Lê o arquivo da adquirente com o layout informado. Linhas inválidas viram ocorrências (não interrompem). */
export function parseAcquirerCsv(data: Buffer | string, layout: AcquirerLayout): AcquirerParse {
  const text = decodeBankFile(data);
  const lines = splitLines(text);
  const columns = Math.max(0, ...lines.map((l) => splitCsvLine(l, layout.delimiter).length));
  const problem = validateAcquirerLayout(layout, columns);
  if (problem) return { lines: [], issues: [], totalLines: lines.length, fatal: problem };
  const out: AcquirerLine[] = [];
  const issues: LineIssue[] = [];
  const startAt = layout.skipRows + (layout.hasHeader ? 1 : 0);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    if (i < startAt || raw.trim() === "") continue;
    const cols = splitCsvLine(raw, layout.delimiter);
    const get = (c: number | null) => (c == null ? "" : clean(cols[c] ?? ""));
    if (/^(total|totais|subtotal|resumo)/i.test(norm(cols.join(" ")))) {
      issues.push({ lineNo, status: "info", message: "Linha de totais ignorada.", raw: raw.slice(0, 200) });
      continue;
    }
    const problems: string[] = [];
    const gross = parseDecimalToCents(get(layout.gross), layout.decimal);
    const feeRaw = get(layout.fee);
    let fee: number | null = null;
    if (feeRaw) {
      if (/%\s*$/.test(feeRaw) && gross != null) {
        const bps = parseDecimalToCents(feeRaw.replace(/%\s*$/, ""), layout.decimal);
        fee = bps == null ? null : Math.round((Math.abs(gross) * Math.abs(bps)) / 10000);
      } else {
        const v = parseDecimalToCents(feeRaw, layout.decimal);
        fee = v == null ? null : Math.abs(v);
      }
    }
    const netRaw = get(layout.net);
    let net = netRaw ? parseDecimalToCents(netRaw, layout.decimal) : null;
    if (gross == null || gross === 0) problems.push(`valor bruto inválido ("${get(layout.gross)}")`);
    if (gross != null) {
      if (fee == null && net == null) problems.push("informe a taxa ou o valor líquido");
      if (fee == null && net != null) fee = Math.abs(gross) - Math.abs(net);
      if (net == null && fee != null) net = Math.abs(gross) - fee;
    }
    const creditDate = dateFlexible(get(layout.creditDate), layout.dateOrder);
    if (!creditDate) problems.push(`data de crédito inválida ("${get(layout.creditDate)}")`);
    const saleDate = layout.saleDate != null ? dateFlexible(get(layout.saleDate), layout.dateOrder) : null;
    const nsu = get(layout.nsu).replace(/\s/g, "") || null;
    const authCode = layout.authCode != null ? get(layout.authCode).replace(/\s/g, "") || null : null;
    if (!nsu && !authCode) problems.push("sem NSU/autorização");
    if (gross != null && fee != null && net != null && Math.abs(Math.abs(gross) - fee - Math.abs(net)) > 1) problems.push(`bruto − taxa ≠ líquido (${(gross / 100).toFixed(2)} − ${(fee / 100).toFixed(2)} ≠ ${(net / 100).toFixed(2)})`);
    if (gross != null && gross < 0) problems.push("lançamento negativo (cancelamento/chargeback) — tratar manualmente");
    if (problems.length) {
      issues.push({ lineNo, status: "invalid", message: `Linha ignorada: ${problems.join("; ")}.`, raw: raw.slice(0, 200) });
      continue;
    }
    const inst = layout.installments != null ? parseInstallment(get(layout.installments)) : { k: null, n: null };
    out.push({
      lineNo, saleDate, nsu, authCode, brand: layout.brand != null ? get(layout.brand) || null : null, installment: inst.k, installments: inst.n,
      gross: gross!, fee: fee!, net: Math.abs(net!), creditDate: creditDate!,
    });
  }
  return { lines: out, issues, totalLines: lines.length, fatal: out.length || issues.length ? null : "Nenhuma linha de venda encontrada no arquivo." };
}

/** NSU/autorização comparáveis: só dígitos e letras, sem zeros à esquerda. */
export function normalizeNsu(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^0+(?=.)/, "");
}
