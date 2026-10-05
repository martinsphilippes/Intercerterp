import { clean, dateYYYYMMDD, normalizeBankCode, parseDecimalToCents, BANK_NAMES, type LineIssue, type ParseResult, type ParsedTx } from "./common";

/**
 * Leitor OFX 1.x (SGML, elementos sem fechamento) e 2.x (XML).
 * Cada <STMTTRN> vira uma transação de extrato; FITID é a identidade da transação no banco.
 * Transações inválidas são reportadas por linha sem descartar as demais.
 */

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function lineAt(text: string, index: number) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function looksLikeOfx(text: string) {
  return /OFXHEADER|<OFX>/i.test(text.slice(0, 4000));
}

export function parseOfx(text: string): ParseResult {
  const issues: LineIssue[] = [];
  const transactions: ParsedTx[] = [];
  const header = text.slice(0, 600);
  const version = header.match(/<\?OFX[^>]*\bVERSION="(\d+)"/i)?.[1] ?? header.match(/^\s*VERSION:(\d+)/im)?.[1] ?? null;
  const totalLines = text.split(/\r\n|\n|\r/).length;
  if (!/<OFX>/i.test(text)) {
    return { format: "ofx", kind: "statement", bankCode: null, layoutVersion: version ? `OFX ${version}` : "OFX", transactions, issues, totalLines, fatal: "Arquivo OFX sem o bloco <OFX>." };
  }
  const bankId = tag(text, "BANKID");
  const bankCode = normalizeBankCode(bankId);
  const acct = { bankId, branch: tag(text, "BRANCHID"), accountId: tag(text, "ACCTID") };
  const dtStart = tag(text, "DTSTART");
  const dtEnd = tag(text, "DTEND");
  const ledger = text.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i)?.[1] ?? null;
  const balAmt = ledger ? tag(ledger, "BALAMT") : null;
  const balDate = ledger ? tag(ledger, "DTASOF") : null;

  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const block = m[1];
    const lineNo = lineAt(text, m.index);
    const rawDate = tag(block, "DTPOSTED");
    const rawAmt = tag(block, "TRNAMT");
    const date = rawDate ? dateYYYYMMDD(rawDate) : null;
    const amount = rawAmt != null ? parseDecimalToCents(rawAmt) : null;
    const fitId = tag(block, "FITID");
    const name = clean(tag(block, "NAME"));
    const memo = clean(tag(block, "MEMO"));
    const type = tag(block, "TRNTYPE");
    const doc = clean(tag(block, "CHECKNUM") || tag(block, "REFNUM")) || null;
    const problems: string[] = [];
    if (!date) problems.push(`data inválida (DTPOSTED=${rawDate ?? "ausente"})`);
    if (amount == null) problems.push(`valor inválido (TRNAMT=${rawAmt ?? "ausente"})`);
    else if (amount === 0) problems.push("valor zero");
    if (problems.length) {
      issues.push({ lineNo, status: "invalid", message: `Transação ignorada: ${problems.join("; ")}.`, raw: block.replace(/\s+/g, " ").slice(0, 200) });
      continue;
    }
    const description = [name, memo && memo !== name ? memo : ""].filter(Boolean).join(" — ") || type || "Lançamento";
    transactions.push({ lineNo, kind: "statement", date: date!, amount: amount!, description, docNumber: doc, externalId: fitId || null });
  }
  // blocos abertos sem fechamento (arquivo truncado)
  const opened = (text.match(/<STMTTRN>/gi) ?? []).length;
  const closed = (text.match(/<\/STMTTRN>/gi) ?? []).length;
  if (opened > closed) {
    const idx = text.toUpperCase().lastIndexOf("<STMTTRN>");
    issues.push({ lineNo: lineAt(text, idx), status: "invalid", message: "Bloco <STMTTRN> sem fechamento (arquivo truncado?)." });
  }
  return {
    format: "ofx",
    kind: "statement",
    bankCode,
    bankName: bankCode ? (BANK_NAMES[bankCode] ?? null) : null,
    layoutVersion: version ? `OFX ${version}` : "OFX",
    account: acct,
    period: { from: dtStart ? dateYYYYMMDD(dtStart) : null, to: dtEnd ? dateYYYYMMDD(dtEnd) : null },
    balance: balAmt != null && parseDecimalToCents(balAmt) != null ? { amount: parseDecimalToCents(balAmt)!, date: balDate ? dateYYYYMMDD(balDate) : null } : null,
    transactions,
    issues,
    totalLines,
  };
}
