import { clean, dateFlexible, parseDecimalToCents, splitLines, type LineIssue, type ParseResult, type ParsedTx } from "./common";

/**
 * Leitor de extrato em CSV com mapeamento de colunas (pré-visualização + mapeamento na tela).
 * Sinal do valor: coluna com sinal, coluna D/C, ou colunas separadas de débito e crédito.
 */

export interface CsvMapping {
  delimiter: string;
  hasHeader: boolean;
  /** linhas a pular antes do cabeçalho (cabeçalhos de banco com nome da conta etc.) */
  skipRows: number;
  date: number;
  description: number;
  document: number | null;
  signMode: "signed" | "dc_column" | "split";
  amount: number | null;
  /** coluna D/C quando signMode = dc_column */
  dcColumn: number | null;
  /** colunas separadas (signMode = split) */
  debit: number | null;
  credit: number | null;
  dateOrder: "dmy" | "ymd" | "mdy";
  decimal: "," | ".";
}

export interface CsvSniff {
  delimiter: string;
  header: string[] | null;
  rows: string[][];
  columns: number;
  guess: CsvMapping;
}

/** Divide uma linha CSV respeitando aspas. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(lines: string[]) {
  const sample = lines.slice(0, 15);
  let best = ";";
  let bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const counts = sample.map((l) => splitCsvLine(l, d).length);
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
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

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function sniffCsv(text: string): CsvSniff {
  const lines = splitLines(text).filter((l) => l.trim() !== "");
  const delimiter = detectDelimiter(lines);
  const all = lines.map((l) => splitCsvLine(l, delimiter));
  const columns = Math.max(0, ...all.map((r) => r.length));
  // cabeçalho = primeira linha que tem uma coluna parecida com "data" e nenhuma data válida
  let headerIdx = -1;
  for (let i = 0; i < Math.min(all.length, 10); i++) {
    const r = all[i].map(norm);
    if (r.some((c) => /^(data|date|dt)/.test(c)) && !all[i].some((c) => dateFlexible(c))) {
      headerIdx = i;
      break;
    }
  }
  const header = headerIdx >= 0 ? all[headerIdx] : null;
  const find = (re: RegExp) => (header ? header.findIndex((h) => re.test(norm(h))) : -1);
  const dateCol = Math.max(0, find(/^(data|date|dt)/));
  let descCol = find(/(descri|historico|lancamento|memo|detalhe|estabelecimento)/);
  const docCol = find(/(documento|^doc|n[ºo°]? ?doc|numero|referencia|^ref)/);
  const amountCol = find(/^(valor|amount|vlr|quantia)/);
  const debitCol = find(/(debito|saida|debit)/);
  const creditCol = find(/(credito|entrada|credit)/);
  const dcCol = find(/^(d\/?c|tipo|natureza|sinal)$/);
  const body = all.slice(headerIdx + 1);
  if (descCol < 0) {
    // coluna com mais texto
    let best = -1;
    let bestLen = -1;
    for (let c = 0; c < columns; c++) {
      if (c === dateCol) continue;
      const len = body.slice(0, 10).reduce((a, r) => a + (/[a-z]/i.test(r[c] ?? "") ? (r[c] ?? "").length : 0), 0);
      if (len > bestLen) {
        best = c;
        bestLen = len;
      }
    }
    descCol = Math.max(0, best);
  }
  const sampleAmounts = body.slice(0, 20).map((r) => r[amountCol >= 0 ? amountCol : creditCol >= 0 ? creditCol : 0] ?? "");
  const decimal: "," | "." = sampleAmounts.some((s) => /,\d{1,2}$/.test(s.trim())) ? "," : sampleAmounts.some((s) => /\.\d{1,2}$/.test(s.trim())) ? "." : ",";
  const dates = body.slice(0, 20).map((r) => r[dateCol] ?? "");
  const dateOrder: "dmy" | "ymd" | "mdy" = dates.some((d) => /^\d{4}-/.test(d)) ? "ymd" : "dmy";
  const signMode: CsvMapping["signMode"] = amountCol >= 0 ? (dcCol >= 0 ? "dc_column" : "signed") : debitCol >= 0 && creditCol >= 0 ? "split" : "signed";
  return {
    delimiter,
    header,
    rows: body.slice(0, 50),
    columns,
    guess: {
      delimiter,
      hasHeader: headerIdx >= 0,
      skipRows: Math.max(0, headerIdx),
      date: dateCol,
      description: descCol,
      document: docCol >= 0 ? docCol : null,
      signMode,
      amount: amountCol >= 0 ? amountCol : signMode === "signed" ? Math.max(0, columns - 1) : null,
      dcColumn: dcCol >= 0 ? dcCol : null,
      debit: debitCol >= 0 ? debitCol : null,
      credit: creditCol >= 0 ? creditCol : null,
      dateOrder,
      decimal,
    },
  };
}

export function validateMapping(m: CsvMapping, columns: number): string | null {
  const inRange = (c: number | null | undefined) => c != null && c >= 0 && c < Math.max(columns, 1);
  if (!inRange(m.date)) return "Selecione a coluna de data.";
  if (!inRange(m.description)) return "Selecione a coluna de descrição.";
  if (m.signMode === "split") {
    if (!inRange(m.debit) || !inRange(m.credit)) return "Selecione as colunas de débito e crédito.";
  } else if (!inRange(m.amount)) return "Selecione a coluna de valor.";
  if (m.signMode === "dc_column" && !inRange(m.dcColumn)) return "Selecione a coluna D/C (natureza).";
  return null;
}

export function parseCsv(text: string, mapping: CsvMapping): ParseResult {
  const lines = splitLines(text);
  const transactions: ParsedTx[] = [];
  const issues: LineIssue[] = [];
  const problem = validateMapping(mapping, Math.max(...lines.map((l) => splitCsvLine(l, mapping.delimiter).length), 0));
  if (problem) return { format: "csv", kind: "statement", bankCode: null, layoutVersion: "CSV", transactions, issues, totalLines: lines.length, fatal: problem };
  let seenData = 0;
  const startAt = mapping.skipRows + (mapping.hasHeader ? 1 : 0);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    if (i < startAt || raw.trim() === "") continue;
    const cols = splitCsvLine(raw, mapping.delimiter);
    const get = (c: number | null) => (c == null ? "" : (cols[c] ?? ""));
    const description = clean(get(mapping.description));
    if (/^saldo\b|^saldo do dia|^saldo anterior|^s\s*a\s*l\s*d\s*o/i.test(description)) {
      issues.push({ lineNo, status: "info", message: "Linha de saldo ignorada (não é transação).", raw: raw.slice(0, 200) });
      continue;
    }
    const date = dateFlexible(get(mapping.date), mapping.dateOrder);
    let amount: number | null = null;
    if (mapping.signMode === "split") {
      const d = get(mapping.debit) ? parseDecimalToCents(get(mapping.debit), mapping.decimal) : 0;
      const c = get(mapping.credit) ? parseDecimalToCents(get(mapping.credit), mapping.decimal) : 0;
      amount = d == null || c == null ? null : Math.abs(c) - Math.abs(d);
    } else {
      amount = parseDecimalToCents(get(mapping.amount), mapping.decimal);
      if (amount != null && mapping.signMode === "dc_column") {
        const dc = norm(get(mapping.dcColumn));
        if (/^(d|deb|debito|saida|-)/.test(dc)) amount = -Math.abs(amount);
        else if (/^(c|cred|credito|entrada|\+)/.test(dc)) amount = Math.abs(amount);
        else amount = null;
      }
    }
    const problems: string[] = [];
    if (!date) problems.push(`data inválida ("${get(mapping.date)}")`);
    if (amount == null) problems.push(`valor inválido ("${mapping.signMode === "split" ? `${get(mapping.debit)}/${get(mapping.credit)}` : get(mapping.amount)}")`);
    else if (amount === 0) problems.push("valor zero");
    if (problems.length) {
      // cabeçalho não declarado ou rodapé de totais: informa sem perder as demais linhas
      issues.push({ lineNo, status: "invalid", message: `Linha ignorada: ${problems.join("; ")}.`, raw: raw.slice(0, 200) });
      continue;
    }
    seenData++;
    transactions.push({ lineNo, kind: "statement", date: date!, amount: amount!, description: description || "Lançamento", docNumber: clean(get(mapping.document)) || null, externalId: null });
  }
  const dates = transactions.map((t) => t.date).sort();
  void seenData;
  return { format: "csv", kind: "statement", bankCode: null, layoutVersion: "CSV", period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }, transactions, issues, totalLines: lines.length };
}
