import { BANK_NAMES, clean, dateDDMMAA, fixedCents, pos, splitLines, type LineIssue, type ParseResult, type ParsedTx } from "./common";

/**
 * Retorno de cobrança CNAB 400 — layouts padrão Itaú (341) e Bradesco (237).
 * Posições comuns aos dois: ocorrência 109-110, data 111-116, seu número 117-126, vencimento 147-152,
 * valor do título 153-165, tarifa 176-188, abatimento 228-240, desconto 241-253, valor pago 254-266,
 * juros/mora 267-279, outros créditos 280-292, data do crédito 296-301. Nosso número: Itaú 63-70 (+DAC 94),
 * Bradesco 71-82. Outros bancos: arquivo reconhecido, registros listados como não suportados.
 */

const ITAU: Record<string, string> = {
  "02": "Entrada confirmada", "03": "Entrada rejeitada", "04": "Alteração de dados — nova entrada", "05": "Alteração de dados — baixa",
  "06": "Liquidação normal", "07": "Liquidação parcial", "08": "Liquidação em cartório", "09": "Baixa simples", "10": "Baixa por ter sido liquidado",
  "11": "Em ser", "12": "Abatimento concedido", "13": "Abatimento cancelado", "14": "Vencimento alterado", "15": "Baixas rejeitadas",
  "16": "Instruções rejeitadas", "17": "Alteração/exclusão de dados rejeitados", "18": "Cobrança contratual — instruções/alterações rejeitadas",
  "19": "Confirma recebimento de instrução de protesto", "20": "Confirma recebimento de instrução de sustação de protesto/tarifa",
  "21": "Confirma recebimento de instrução de não protestar", "23": "Título enviado a cartório/tarifa", "24": "Instrução de protesto rejeitada/sustada/pendente",
  "25": "Alegações do pagador", "26": "Tarifa de aviso de cobrança", "27": "Tarifa de extrato posição", "28": "Tarifa de relação das liquidações",
  "29": "Tarifa de manutenção de títulos vencidos", "30": "Débito mensal de tarifas", "32": "Baixa por ter sido protestado", "33": "Custas de protesto",
  "34": "Custas de sustação", "35": "Custas de cartório distribuidor", "36": "Custas de edital", "37": "Tarifa de emissão de boleto/envio duplicata",
  "38": "Tarifa de instrução", "39": "Tarifa de ocorrências", "40": "Tarifa mensal de emissão de boleto", "47": "Baixa com transferência para desconto",
};

const BRADESCO: Record<string, string> = {
  "02": "Entrada confirmada", "03": "Entrada rejeitada", "06": "Liquidação normal", "09": "Baixado automaticamente via arquivo", "10": "Baixado conforme instruções da agência",
  "11": "Em ser — títulos pendentes", "12": "Abatimento concedido", "13": "Abatimento cancelado", "14": "Vencimento alterado", "15": "Liquidação em cartório",
  "16": "Título pago em cheque — vinculado", "17": "Liquidação após baixa ou título não registrado", "18": "Acerto de depositária", "19": "Confirmação de recebimento de instrução de protesto",
  "20": "Confirmação de recebimento de instrução de sustação de protesto", "21": "Acerto do controle do participante", "22": "Título com pagamento cancelado",
  "23": "Entrada do título em cartório", "24": "Entrada rejeitada por CEP irregular", "25": "Confirmação de recebimento de instrução de protesto falimentar",
  "27": "Baixa rejeitada", "28": "Débito de tarifas/custas", "29": "Ocorrências do pagador", "30": "Alteração de outros dados rejeitados", "32": "Instrução rejeitada",
  "33": "Confirmação de pedido de alteração de outros dados", "34": "Retirado de cartório e manutenção em carteira", "35": "Desagendamento do débito automático",
  "40": "Estorno de pagamento", "55": "Sustado judicial", "68": "Acerto dos dados do rateio de crédito", "69": "Cancelamento dos dados do rateio",
};

export const CNAB400_LAYOUTS: Record<string, { name: string; occurrences: Record<string, string>; liquidation: Set<string>; fee: Set<string>; ourNumber: (l: string) => string }> = {
  "341": {
    name: "Itaú",
    occurrences: ITAU,
    liquidation: new Set(["06", "07", "08"]),
    fee: new Set(["26", "27", "28", "29", "30", "33", "34", "35", "36", "37", "38", "39", "40"]),
    ourNumber: (l) => pos(l, 63, 70).trim().replace(/^0+(?=\d)/, ""),
  },
  "237": {
    name: "Bradesco",
    occurrences: BRADESCO,
    liquidation: new Set(["06", "15", "16", "17"]),
    fee: new Set(["28"]),
    ourNumber: (l) => pos(l, 71, 82).trim().replace(/^0+(?=\d)/, ""),
  },
};

export function looksLikeCnab400(lines: string[]) {
  const first = lines[0] ?? "";
  return first.length >= 300 && first.length <= 402 && first[0] === "0" && /^02RETORNO|^02/.test(first) && lines.every((l) => l.length <= 402);
}

export function parseCnab400(text: string): ParseResult {
  const lines = splitLines(text);
  const issues: LineIssue[] = [];
  const transactions: ParsedTx[] = [];
  const header = (lines[0] ?? "").padEnd(400, " ");
  const bankCode = pos(header, 77, 79);
  const layout = CNAB400_LAYOUTS[bankCode];
  const base: ParseResult = {
    format: "cnab400",
    kind: "collection_return",
    bankCode: /^\d{3}$/.test(bankCode) ? bankCode : null,
    bankName: clean(pos(header, 80, 94)) || BANK_NAMES[bankCode] || null,
    layoutVersion: layout ? `CNAB 400 — layout ${layout.name}` : `CNAB 400 — banco ${bankCode} (layout não suportado)`,
    generatedAt: dateDDMMAA(pos(header, 95, 100)),
    account: { bankId: bankCode, branch: pos(header, 27, 30).trim(), accountId: null },
    transactions,
    issues,
    totalLines: lines.length,
  };
  if (header[0] !== "0") return { ...base, fatal: "Primeira linha não é um header CNAB 400 (tipo de registro 0)." };
  if (pos(header, 2, 2) !== "2" || !/RETORNO/i.test(pos(header, 3, 9))) {
    return { ...base, fatal: pos(header, 2, 2) === "1" ? "Este é um arquivo de REMESSA, não de retorno." : "Header sem identificação de RETORNO (posições 2–9)." };
  }
  if (pos(header, 10, 11) !== "01") issues.push({ lineNo: 1, status: "info", message: `Serviço ${pos(header, 10, 11)} declarado no header (esperado 01 — cobrança).` });

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const rawLine = lines[i].replace(/\s+$/, "");
    if (rawLine.length > 400) {
      issues.push({ lineNo, status: "invalid", message: `Linha com ${rawLine.length} posições (esperado 400).`, raw: rawLine.slice(0, 120) });
      continue;
    }
    const line = rawLine.padEnd(400, " ");
    const recType = line[0];
    if (recType === "9") continue; // trailer
    if (recType !== "1") {
      issues.push({ lineNo, status: "unsupported", message: `Registro tipo "${recType}" não suportado (somente detalhe tipo 1 de cobrança).`, raw: rawLine.slice(0, 120) });
      continue;
    }
    if (!layout) {
      issues.push({ lineNo, status: "unsupported", message: `Layout CNAB 400 do banco ${bankCode} não suportado (suportados: 341 Itaú, 237 Bradesco).`, raw: rawLine.slice(0, 120) });
      continue;
    }
    const occurrence = pos(line, 109, 110);
    const occText = layout.occurrences[occurrence] ?? `Ocorrência ${occurrence}`;
    const occDate = dateDDMMAA(pos(line, 111, 116));
    const yourNumber = pos(line, 117, 126).trim();
    const ourNumber = layout.ourNumber(line);
    const dueDate = dateDDMMAA(pos(line, 147, 152));
    const nums = {
      titleAmount: fixedCents(pos(line, 153, 165)),
      fee: fixedCents(pos(line, 176, 188)),
      abatement: fixedCents(pos(line, 228, 240)),
      discount: fixedCents(pos(line, 241, 253)),
      paid: fixedCents(pos(line, 254, 266)),
      interest: fixedCents(pos(line, 267, 279)),
      otherCredits: fixedCents(pos(line, 280, 292)),
    };
    const bad = Object.entries(nums).filter(([, v]) => v == null).map(([k]) => k);
    if (bad.length) {
      issues.push({ lineNo, status: "invalid", message: `Campos numéricos inválidos: ${bad.join(", ")}.`, raw: rawLine.slice(0, 120) });
      continue;
    }
    const creditDate = dateDDMMAA(pos(line, 296, 301));
    const payerName = bankCode === "341" ? clean(pos(line, 325, 354)) : null;
    if (layout.liquidation.has(occurrence)) {
      const date = creditDate ?? occDate;
      if (!date) {
        issues.push({ lineNo, status: "invalid", message: "Liquidação sem data de ocorrência/crédito.", raw: rawLine.slice(0, 120) });
        continue;
      }
      if (!nums.paid) {
        issues.push({ lineNo, status: "invalid", message: "Liquidação com valor pago zerado.", raw: rawLine.slice(0, 120) });
        continue;
      }
      transactions.push({
        lineNo, kind: "collection", date, amount: nums.paid! - nums.fee!, description: `${occText} — ${payerName || "pagador"} (nosso nº ${ourNumber || "—"})`,
        docNumber: yourNumber || null, occurrence, occurrenceText: occText, ourNumber: ourNumber || null, yourNumber: yourNumber || null, dueDate,
        creditDate, titleAmount: nums.titleAmount, paidAmount: nums.paid, interest: nums.interest! + nums.otherCredits!, discount: nums.discount! + nums.abatement!, fee: nums.fee, payerName,
      });
    } else if (layout.fee.has(occurrence) && nums.fee) {
      const date = creditDate ?? occDate;
      if (!date) {
        issues.push({ lineNo, status: "invalid", message: "Débito de tarifa sem data.", raw: rawLine.slice(0, 120) });
        continue;
      }
      transactions.push({ lineNo, kind: "collection_fee", date, amount: -nums.fee!, description: `${occText} (nosso nº ${ourNumber || "—"})`, docNumber: yourNumber || null, occurrence, occurrenceText: occText, ourNumber: ourNumber || null, yourNumber: yourNumber || null, fee: nums.fee, payerName });
    } else {
      issues.push({ lineNo, status: "info", message: `${occText} (ocorrência ${occurrence}) — sem movimento financeiro; nosso nº ${ourNumber || "—"}, seu nº ${yourNumber || "—"}.` });
    }
  }
  const dates = transactions.map((t) => t.date).sort();
  return { ...base, period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null } };
}
