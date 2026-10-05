import { BANK_NAMES, clean, dateDDMMAAAA, fixedCents, pos, splitLines, type LineIssue, type ParseResult, type ParsedTx } from "./common";

/**
 * Retorno de cobrança FEBRABAN CNAB 240 (segmentos T e U).
 * Posições conforme o layout padrão FEBRABAN (versões de arquivo 040–103, lote de cobrança serviço "01").
 * Segmentos/serviços fora de T/U de cobrança são listados como NÃO SUPORTADOS por linha — nunca viram extrato genérico.
 */

export const CNAB240_OCCURRENCES: Record<string, string> = {
  "02": "Entrada confirmada",
  "03": "Entrada rejeitada",
  "04": "Transferência de carteira/entrada",
  "05": "Transferência de carteira/baixa",
  "06": "Liquidação",
  "07": "Confirmação do recebimento da instrução de desconto",
  "08": "Confirmação do recebimento do cancelamento do desconto",
  "09": "Baixa",
  "11": "Títulos em carteira (em ser)",
  "12": "Confirmação recebimento instrução de abatimento",
  "13": "Confirmação recebimento cancelamento abatimento",
  "14": "Confirmação recebimento alteração de vencimento",
  "15": "Franco de pagamento",
  "17": "Liquidação após baixa ou liquidação de título não registrado",
  "19": "Confirmação recebimento instrução de protesto",
  "20": "Confirmação recebimento instrução de sustação/cancelamento de protesto",
  "23": "Remessa a cartório (aponte em cartório)",
  "24": "Retirada de cartório e manutenção em carteira",
  "25": "Protestado e baixado (baixa por ter sido protestado)",
  "26": "Instrução rejeitada",
  "27": "Confirmação do pedido de alteração de outros dados",
  "28": "Débito de tarifas/custas",
  "29": "Ocorrências do pagador",
  "30": "Alteração de dados rejeitada",
  "33": "Confirmação da alteração dos dados do rateio de crédito",
  "34": "Confirmação do cancelamento dos dados do rateio de crédito",
  "35": "Confirmação do desagendamento do débito automático",
  "36": "Confirmação de envio de e-mail/SMS",
  "37": "Envio de e-mail/SMS rejeitado",
  "38": "Confirmação de alteração do prazo limite de recebimento",
  "39": "Confirmação de dispensa de prazo limite de recebimento",
  "40": "Confirmação da alteração do número do título dado pelo beneficiário",
  "41": "Confirmação da alteração do número controle do participante",
  "42": "Confirmação da alteração dos dados do pagador",
  "43": "Confirmação da alteração dos dados do sacador/avalista",
  "44": "Título pago com cheque devolvido",
  "45": "Título pago com cheque compensado",
  "46": "Instrução para cancelar protesto confirmada",
  "47": "Instrução para protesto para fins falimentares confirmada",
  "48": "Confirmação de instrução de transferência de carteira/modalidade de cobrança",
  "49": "Alteração de contrato de cobrança",
  "50": "Título pendente de pagamento",
  "51": "Título DDA reconhecido pelo pagador",
  "52": "Título DDA não reconhecido pelo pagador",
  "53": "Título DDA recusado pela CIP",
  "54": "Confirmação da instrução de baixa de título negativado sem protesto",
};

/** ocorrências com crédito em conta (liquidação) */
export const CNAB240_LIQUIDATION = new Set(["06", "17"]);
export const CNAB240_FEE = new Set(["28"]);
export const CNAB240_KNOWN_VERSIONS = ["030", "040", "050", "080", "081", "082", "083", "084", "085", "086", "087", "088", "089", "090", "091", "092", "100", "101", "103"];

export function looksLikeCnab240(lines: string[]) {
  const first = lines[0] ?? "";
  // header de arquivo: banco(3) + lote "0000" + tipo "0"; linhas de até 240 posições (espaços finais podem ter sido removidos)
  return first.length >= 150 && first.length <= 242 && pos(first, 8, 8) === "0" && /^\d{3}0000/.test(first) && lines.every((l) => l.length <= 242);
}

export function parseCnab240(text: string): ParseResult {
  const lines = splitLines(text);
  const issues: LineIssue[] = [];
  const transactions: ParsedTx[] = [];
  const header = lines[0] ?? "";
  const bankCode = pos(header, 1, 3);
  const layoutVersion = pos(header, 164, 166).trim() || null;
  const base: ParseResult = {
    format: "cnab240",
    kind: "collection_return",
    bankCode: /^\d{3}$/.test(bankCode) ? bankCode : null,
    bankName: BANK_NAMES[bankCode] ?? null,
    layoutVersion: layoutVersion ? `CNAB 240 v${layoutVersion}` : "CNAB 240",
    account: { bankId: bankCode, branch: pos(header, 53, 57).trim(), accountId: pos(header, 59, 70).replace(/^0+/, "") + "-" + pos(header, 71, 71) },
    generatedAt: dateDDMMAAAA(pos(header, 144, 151)),
    transactions,
    issues,
    totalLines: lines.length,
  };
  if (pos(header, 8, 8) !== "0") return { ...base, fatal: "Primeira linha não é um header de arquivo CNAB 240 (tipo de registro 0)." };
  const remRet = pos(header, 143, 143);
  if (remRet !== "2") return { ...base, fatal: remRet === "1" ? "Este é um arquivo de REMESSA (código 1 na posição 143), não de retorno." : `Código remessa/retorno inválido na posição 143 ("${remRet}").` };
  if (layoutVersion && !CNAB240_KNOWN_VERSIONS.includes(layoutVersion)) {
    issues.push({ lineNo: 1, status: "info", message: `Versão de layout ${layoutVersion} não catalogada — leitura pelas posições padrão FEBRABAN; confira os valores.` });
  }

  let loteService: string | null = null;
  let pendingT: { lineNo: number; line: string } | null = null;
  const flushT = () => {
    if (pendingT) issues.push({ lineNo: pendingT.lineNo, status: "invalid", message: "Segmento T sem o segmento U correspondente (valores pagos ausentes).", raw: pendingT.line.slice(0, 120) });
    pendingT = null;
  };
  let detailCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].replace(/\s+$/, "").padEnd(240, " ");
    if (lines[i].replace(/\s+$/, "").length > 240) {
      issues.push({ lineNo, status: "invalid", message: `Linha com ${lines[i].length} posições (esperado 240).`, raw: lines[i].slice(0, 120) });
      continue;
    }
    const recType = pos(line, 8, 8);
    if (pos(line, 1, 3) !== bankCode) {
      issues.push({ lineNo, status: "invalid", message: `Código do banco ${pos(line, 1, 3)} diferente do header (${bankCode}).`, raw: line.slice(0, 120) });
      continue;
    }
    if (recType === "1") {
      flushT();
      loteService = pos(line, 10, 11);
      if (pos(line, 9, 9) !== "T" || loteService !== "01") {
        issues.push({ lineNo, status: "unsupported", message: `Lote de serviço ${loteService} / operação ${pos(line, 9, 9)} não suportado (apenas retorno de cobrança: operação T, serviço 01). Registros do lote serão listados como não suportados.` });
      }
      continue;
    }
    if (recType === "5" || recType === "9") {
      flushT();
      if (recType === "9") {
        const declared = Number(pos(line, 24, 29));
        if (declared && declared !== lines.length) issues.push({ lineNo, status: "info", message: `Trailer declara ${declared} registros; o arquivo tem ${lines.length}.` });
      }
      continue;
    }
    if (recType !== "3") {
      flushT();
      issues.push({ lineNo, status: "unsupported", message: `Tipo de registro "${recType}" não suportado.`, raw: line.slice(0, 120) });
      continue;
    }
    const segment = pos(line, 14, 14);
    if (loteService !== "01") {
      issues.push({ lineNo, status: "unsupported", message: `Segmento ${segment} de lote não-cobrança (serviço ${loteService ?? "?"}) — não suportado.`, raw: line.slice(0, 120) });
      continue;
    }
    if (segment === "T") {
      flushT();
      pendingT = { lineNo, line };
      continue;
    }
    if (segment !== "U") {
      flushT();
      issues.push({ lineNo, status: "unsupported", message: `Segmento ${segment} não suportado (somente T/U de retorno de cobrança).`, raw: line.slice(0, 120) });
      continue;
    }
    if (!pendingT) {
      issues.push({ lineNo, status: "invalid", message: "Segmento U sem o segmento T anterior.", raw: line.slice(0, 120) });
      continue;
    }
    const t = (pendingT as { lineNo: number; line: string }).line;
    const tLine = (pendingT as { lineNo: number; line: string }).lineNo;
    pendingT = null;
    detailCount++;
    const occurrence = pos(t, 16, 17);
    const occText = CNAB240_OCCURRENCES[occurrence] ?? `Ocorrência ${occurrence}`;
    const ourNumber = pos(t, 38, 57).trim().replace(/^0+(?=\d)/, "");
    const yourNumber = pos(t, 59, 73).trim();
    const dueDate = dateDDMMAAAA(pos(t, 74, 81));
    const titleAmount = fixedCents(pos(t, 82, 96));
    const fee = fixedCents(pos(t, 199, 213));
    const payerName = clean(pos(t, 149, 188));
    const interest = fixedCents(pos(line, 18, 32));
    const discount = fixedCents(pos(line, 33, 47));
    const abatement = fixedCents(pos(line, 48, 62));
    const paid = fixedCents(pos(line, 78, 92));
    const net = fixedCents(pos(line, 93, 107));
    const otherCredits = fixedCents(pos(line, 123, 137));
    const occDate = dateDDMMAAAA(pos(line, 138, 145));
    const creditDate = dateDDMMAAAA(pos(line, 146, 153));
    const nums = { titleAmount, fee, interest, discount, abatement, paid, net, otherCredits };
    const badNum = Object.entries(nums).filter(([, v]) => v == null).map(([k]) => k);
    if (badNum.length) {
      issues.push({ lineNo: tLine, status: "invalid", message: `Campos numéricos inválidos: ${badNum.join(", ")}.`, raw: t.slice(0, 120) });
      continue;
    }
    if (CNAB240_LIQUIDATION.has(occurrence)) {
      const date = creditDate ?? occDate;
      if (!date) {
        issues.push({ lineNo: tLine, status: "invalid", message: "Liquidação sem data de ocorrência/crédito.", raw: t.slice(0, 120) });
        continue;
      }
      if (!paid) {
        issues.push({ lineNo: tLine, status: "invalid", message: "Liquidação com valor pago zerado.", raw: t.slice(0, 120) });
        continue;
      }
      const amount = net || paid! - fee!;
      transactions.push({
        lineNo: tLine, kind: "collection", date, amount, description: `${occText} — ${payerName || "pagador"} (nosso nº ${ourNumber || "—"})`,
        docNumber: yourNumber || null, externalId: null, occurrence, occurrenceText: occText, ourNumber: ourNumber || null, yourNumber: yourNumber || null,
        dueDate, creditDate: creditDate ?? null, titleAmount, paidAmount: paid, interest: interest! + otherCredits!, discount: discount! + abatement!, fee, payerName: payerName || null,
      });
    } else if (CNAB240_FEE.has(occurrence) && fee) {
      const date = creditDate ?? occDate;
      if (!date) {
        issues.push({ lineNo: tLine, status: "invalid", message: "Débito de tarifa sem data.", raw: t.slice(0, 120) });
        continue;
      }
      transactions.push({
        lineNo: tLine, kind: "collection_fee", date, amount: -fee, description: `${occText} (nosso nº ${ourNumber || "—"})`, docNumber: yourNumber || null,
        occurrence, occurrenceText: occText, ourNumber: ourNumber || null, yourNumber: yourNumber || null, fee, payerName: payerName || null,
      });
    } else {
      issues.push({ lineNo: tLine, status: "info", message: `${occText} (ocorrência ${occurrence}) — sem movimento financeiro; nosso nº ${ourNumber || "—"}, seu nº ${yourNumber || "—"}.` });
    }
  }
  flushT();
  if (!detailCount && !issues.some((x) => x.status !== "info")) issues.push({ lineNo: 1, status: "info", message: "Arquivo sem registros de detalhe." });
  const dates = transactions.map((t) => t.date).sort();
  return { ...base, period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null } };
}
