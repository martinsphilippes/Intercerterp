import JSZip from "jszip";
import crypto from "node:crypto";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { addMonths, formatDate, monthEnd, monthStart, nowIso, today, toLocalDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { readFile, saveFile } from "@/lib/core/files";
import { getSetting, setSetting } from "@/lib/core/settings";
import { getIntegration, logIntegration } from "../integrations";
import { MODEL_LABEL, DOC_STATUS_LABEL } from "./service";
import { cancellations, outputBook, periodDocuments, rejections, servicesSummary, summarize, summaryByCfop, taxesByNcm, type FiscalReportFilter } from "./reports";

/**
 * Pacote para a contabilidade (Tela 35): ZIP com os XMLs ARMAZENADOS do período e relatórios CSV.
 * Natureza: arquivos de apoio à escrituração. NÃO é arquivo de obrigação acessória (SPED, SINTEGRA, PGDAS-D, DEFIS):
 * o sistema acompanha essas obrigações, não as gera.
 */

type Col = { key: string; label: string; type?: "money" | "date" | "datetime" | "qty" };

function csvCell(v: any, type?: Col["type"]) {
  if (v == null) return "";
  if (type === "money") return (v / 100).toFixed(2).replace(".", ",");
  if (type === "qty") return String(v / 1000).replace(".", ",");
  if (type === "date") return formatDate(String(v));
  if (type === "datetime") return new Date(v).toLocaleString("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo" });
  return String(v);
}

/**
 * Número negativo já formatado em texto ("-12,34", "-1.234,56", "-R$ 12,34", "-12,5%"): só sinal, "R$", espaços,
 * dígitos, separadores e "%" — não compõe fórmula (mesma regra de src/lib/exporters.ts).
 */
const PREFORMATTED_NEGATIVE = /^-\s*(R\$\s*)?\d[\d.,]*%?$/;

/** Neutraliza fórmulas em texto (injeção de fórmula no Excel/planilhas) com o prefixo "'"; colunas numéricas não são afetadas. */
export function neutralizeCsvText(s: string, numeric = false): string {
  if (numeric || !s) return s;
  if (PREFORMATTED_NEGATIVE.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** CSV compatível com Excel pt-BR (UTF-8 com BOM, separador ;) — mesmo formato (e neutralização) das exportações de tela. */
export function csv(cols: Col[], rows: Record<string, any>[]) {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const isNum = (t?: Col["type"]) => t === "money" || t === "qty";
  return (
    "﻿" +
    [cols.map((c) => esc(neutralizeCsvText(c.label))).join(";"), ...rows.map((r) => cols.map((c) => esc(neutralizeCsvText(csvCell(r[c.key], c.type), isNum(c.type)))).join(";"))].join("\r\n")
  );
}

export const BOOK_COLS: Col[] = [
  { key: "date", label: "Data", type: "date" },
  { key: "modelLabel", label: "Espécie" },
  { key: "series", label: "Série" },
  { key: "number", label: "Número" },
  { key: "accessKey", label: "Chave de acesso" },
  { key: "recipient", label: "Destinatário" },
  { key: "recipientDoc", label: "CPF/CNPJ" },
  { key: "uf", label: "UF" },
  { key: "cfop", label: "CFOP" },
  { key: "value", label: "Valor contábil", type: "money" },
  { key: "icmsBase", label: "Base ICMS", type: "money" },
  { key: "icms", label: "ICMS", type: "money" },
  { key: "exemptOther", label: "Isentas/outras", type: "money" },
  { key: "note", label: "Observações" },
];
export const NCM_COLS: Col[] = [
  { key: "ncm", label: "NCM" },
  { key: "description", label: "Descrição (exemplo)" },
  { key: "docs", label: "Documentos" },
  { key: "qty", label: "Quantidade", type: "qty" },
  { key: "value", label: "Valor", type: "money" },
  { key: "icmsBase", label: "Base ICMS", type: "money" },
  { key: "icms", label: "ICMS", type: "money" },
  { key: "pis", label: "PIS", type: "money" },
  { key: "cofins", label: "COFINS", type: "money" },
];
export const CFOP_COLS: Col[] = [
  { key: "cfop", label: "CFOP" },
  { key: "direction", label: "Natureza" },
  { key: "docs", label: "Documentos" },
  { key: "value", label: "Valor contábil", type: "money" },
  { key: "icmsBase", label: "Base ICMS", type: "money" },
  { key: "icms", label: "ICMS", type: "money" },
  { key: "pis", label: "PIS", type: "money" },
  { key: "cofins", label: "COFINS", type: "money" },
];
export const CANCEL_COLS: Col[] = [
  { key: "cancelledAt", label: "Cancelado em", type: "datetime" },
  { key: "modelLabel", label: "Documento" },
  { key: "series", label: "Série" },
  { key: "number", label: "Número" },
  { key: "accessKey", label: "Chave" },
  { key: "issuedAt", label: "Emitido em", type: "datetime" },
  { key: "total", label: "Valor", type: "money" },
  { key: "reason", label: "Justificativa" },
  { key: "simLabel", label: "Simulação" },
];
export const REJECT_COLS: Col[] = [
  { key: "occurredAt", label: "Retorno em", type: "datetime" },
  { key: "modelLabel", label: "Documento" },
  { key: "numberOrRef", label: "Número/referência" },
  { key: "statusLabel", label: "Retorno" },
  { key: "message", label: "Mensagem do provedor" },
  { key: "currentLabel", label: "Situação atual" },
  { key: "total", label: "Valor", type: "money" },
];
export const DOC_COLS: Col[] = [
  { key: "issuedAt", label: "Emissão", type: "datetime" },
  { key: "modelLabel", label: "Modelo" },
  { key: "series", label: "Série" },
  { key: "number", label: "Número" },
  { key: "accessKey", label: "Chave" },
  { key: "statusLabel", label: "Situação" },
  { key: "operationType", label: "Operação" },
  { key: "nature", label: "Natureza" },
  { key: "recipientName", label: "Destinatário/tomador" },
  { key: "recipientDoc", label: "CPF/CNPJ" },
  { key: "total", label: "Valor", type: "money" },
  { key: "protocol", label: "Protocolo" },
  { key: "simLabel", label: "Simulação" },
];
export const SERVICE_COLS: Col[] = [
  { key: "serviceListItem", label: "Item LC 116" },
  { key: "docs", label: "NFS-e" },
  { key: "amount", label: "Serviços", type: "money" },
  { key: "base", label: "Base ISS", type: "money" },
  { key: "iss", label: "ISS calculado", type: "money" },
  { key: "issWithheld", label: "ISS retido", type: "money" },
  { key: "federalWithheld", label: "Retenções federais", type: "money" },
  { key: "net", label: "Líquido", type: "money" },
];

export function docRows(docs: Doc[]): Array<Record<string, any> & { id: string }> {
  return docs.map((d) => ({ ...d, modelLabel: MODEL_LABEL[d.model] ?? d.model, statusLabel: DOC_STATUS_LABEL[d.status] ?? d.status, simLabel: d.isSimulated ? "SIMULAÇÃO" : "", number: d.number ?? d.rpsNumber ?? null }));
}

export interface PackageResult {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  xmlCount: number;
  simulatedXml: number;
  missingXml: Array<{ id: string; label: string }>;
  docs: number;
  period: { from: string; to: string };
}

/** Gera o ZIP do período e grava no armazenamento (Arquivos), retornando o resumo real do conteúdo. */
export async function buildAccountingPackage(ctx: Ctx, f: FiscalReportFilter): Promise<PackageResult> {
  // todos os XML e CSV (CPF/CNPJ e valores de clientes) do período: exportação de dados
  requireAction(ctx, "data.export");
  const docs = await periodDocuments(ctx, { ...f, includeSimulated: true });
  const zip = new JSZip();
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const branchName = f.branchId ? (await ctx.store.get("branches", f.branchId))?.name : ctx.branchId ? (await ctx.store.get("branches", ctx.branchId))?.name : "Todas as filiais";
  let xmlCount = 0;
  let simulatedXml = 0;
  const missingXml: Array<{ id: string; label: string }> = [];
  const manifest: Array<{ path: string; sha256: string; bytes: number }> = [];
  const add = (path: string, data: Buffer | string) => {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    zip.file(path, buf);
    manifest.push({ path, sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
  };
  for (const d of docs.filter((x) => ["authorized", "cancelled"].includes(x.status))) {
    const label = `${MODEL_LABEL[d.model]} ${d.number ?? d.rpsNumber ?? d.ref}`;
    if (!d.xmlFileId) {
      missingXml.push({ id: d.id, label });
      continue;
    }
    try {
      const { meta, data } = await readFile(ctx, d.xmlFileId);
      const folder = d.isSimulated ? "xml/SIMULACAO-sem-validade-fiscal" : "xml";
      const sub = d.status === "cancelled" ? "canceladas" : "autorizadas";
      add(`${folder}/${sub}/${d.model}/${meta.name}`, data);
      xmlCount++;
      if (d.isSimulated) simulatedXml++;
    } catch {
      missingXml.push({ id: d.id, label: `${label} (arquivo ilegível)` });
    }
  }
  const summary = summarize(docs, f);
  const book = outputBook(docs).map((r) => ({ ...r, modelLabel: MODEL_LABEL[r.model] }));
  add("relatorios/livro-registro-saidas.csv", csv(BOOK_COLS, book));
  add("relatorios/resumo-por-cfop.csv", csv(CFOP_COLS, summaryByCfop(docs)));
  add("relatorios/tributos-por-ncm.csv", csv(NCM_COLS, taxesByNcm(docs)));
  add("relatorios/servicos-nfse.csv", csv(SERVICE_COLS, servicesSummary(docs)));
  add("relatorios/cancelamentos.csv", csv(CANCEL_COLS, (await cancellations(ctx, { ...f, includeSimulated: true })).map((r) => ({ ...r, modelLabel: MODEL_LABEL[r.model], simLabel: r.simulated ? "SIMULAÇÃO" : "" }))));
  add("relatorios/rejeicoes.csv", csv(REJECT_COLS, (await rejections(ctx, { ...f, includeSimulated: true })).map((r) => ({ ...r, modelLabel: MODEL_LABEL[r.model], numberOrRef: r.number ?? r.ref, statusLabel: DOC_STATUS_LABEL[r.status], currentLabel: DOC_STATUS_LABEL[r.currentStatus] }))));
  add("relatorios/documentos-do-periodo.csv", csv(DOC_COLS, docRows(docs)));
  const readme = [
    `PACOTE PARA A CONTABILIDADE — ${company.name} (CNPJ ${company.cnpj ?? "—"})`,
    `Filial: ${branchName ?? "—"}`,
    `Período: ${formatDate(f.from)} a ${formatDate(f.to)} (data de emissão; cancelamentos e rejeições pela data do evento)`,
    `Gerado em: ${new Date().toLocaleString("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo" })} por ${ctx.user.name}`,
    "",
    "NATUREZA DOS ARQUIVOS",
    "- XMLs: cópias dos XMLs armazenados no sistema (autorizados e cancelados).",
    "- Relatórios: CSV (separador ;, UTF-8) — livro de saídas, resumo por CFOP, tributos por NCM, serviços (NFS-e), cancelamentos, rejeições e lista de documentos.",
    "- ESTE PACOTE NÃO É ARQUIVO DE OBRIGAÇÃO ACESSÓRIA (SPED Fiscal/EFD, SINTEGRA, PGDAS-D, DEFIS). Essas obrigações são acompanhadas no sistema, não geradas por ele.",
    "",
    "TOTAIS (critério: notas AUTORIZADAS de saída, exceto devoluções, transferências entre filiais e remessas/outras saídas sem venda; canceladas/rejeitadas/pendentes excluídas)",
    `- Documentos no período: ${summary.count} (autorizadas de saída no faturamento: ${summary.revenueCount})`,
    `- Faturamento fiscal bruto: ${formatMoney(summary.gross)} · devoluções recebidas: ${formatMoney(summary.returns)} · líquido: ${formatMoney(summary.net)}`,
    `- Transferências/remessas autorizadas (fora do faturamento): ${summary.nonRevenueCount} documento(s), ${formatMoney(summary.nonRevenue)} — CFOP 515x, 5408/5409, 552–557, 59xx (exceto 5922/5933), devoluções 520x/521x/541x e equivalentes 6xxx/7xxx.`,
    `- ICMS: ${formatMoney(summary.taxes.icms)} · PIS: ${formatMoney(summary.taxes.pis)} · COFINS: ${formatMoney(summary.taxes.cofins)} · ISS: ${formatMoney(summary.taxes.iss)} (retido: ${formatMoney(summary.taxes.issWithheld)})`,
    `- Pendentes/rejeitados (fora dos totais): ${summary.pendingCount}`,
    "",
    `XML incluídos: ${xmlCount}${simulatedXml ? ` — dos quais ${simulatedXml} de SIMULAÇÃO (pasta xml/SIMULACAO-sem-validade-fiscal), SEM VALIDADE FISCAL` : ""}`,
    missingXml.length ? `XML AUSENTES no armazenamento (${missingXml.length}): ${missingXml.map((m) => m.label).join("; ")}` : "Nenhum XML ausente.",
    summary.simulatedCount ? `ATENÇÃO: ${summary.simulatedCount} documento(s) do período foram emitidos pelo provedor de SIMULAÇÃO e não têm validade fiscal.` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\r\n");
  add("LEIA-ME.txt", readme);
  zip.file("manifesto.json", JSON.stringify({ geradoEm: nowIso(), periodo: { de: f.from, ate: f.to }, filial: branchName, arquivos: manifest }, null, 2));
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const fileName = `contabilidade-${f.from}-a-${f.to}${f.branchId || ctx.branchId ? "-filial" : ""}.zip`;
  const file = await saveFile(ctx, { bucket: "documents", name: fileName, mime: "application/zip", data: buf, entityType: "fiscal_export", entityId: `${f.from}:${f.to}`, kind: "accounting_package", branchId: f.branchId ?? ctx.branchId });
  await audit(ctx, { module: "fiscal", action: "export.package", entityType: "file", entityId: file.id, summary: `Pacote contábil ${formatDate(f.from)}–${formatDate(f.to)} gerado: ${xmlCount} XML, ${docs.length} documentos${missingXml.length ? `, ${missingXml.length} XML ausente(s)` : ""}`, after: { xmlCount, simulatedXml, missing: missingXml.length } });
  return { fileId: file.id, fileName, sizeBytes: buf.length, xmlCount, simulatedXml, missingXml, docs: docs.length, period: { from: f.from, to: f.to } };
}

/** Envia o pacote pelo canal da integração "contabilidade" (e-mail) e registra o resultado real. */
export async function sendAccountingPackage(ctx: Ctx, f: FiscalReportFilter, opts: { to?: string | null; reason: "manual" | "scheduled" }) {
  // envio do pacote a um e-mail: somente quem configura o fiscal (a rotina agendada usa o contexto do sistema)
  requireAction(ctx, "fiscal.configure");
  const integ = await getIntegration(ctx.store, ctx.companyId, null, "accounting");
  const to = (opts.to || integ?.config?.accountantEmail || "").trim();
  assert(!to || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to), "Informe um e-mail válido para o envio do pacote.");
  if (!integ || !to) {
    const message = !integ ? "Integração Área da contabilidade não configurada (Administração → Integrações)." : "E-mail da contabilidade não informado na integração.";
    await logIntegration(ctx.store, { companyId: ctx.companyId, integrationId: integ?.id ?? null, kind: "accounting", action: "send_package", status: "failure", message });
    return { delivered: false, message, package: null as PackageResult | null };
  }
  const pkg = await buildAccountingPackage(ctx, f);
  const { data } = await readFile(ctx, pkg.fileId);
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const { sendEmail } = await import("@/lib/core/email");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
<p>Olá${integ.config?.accountantName ? ", " + integ.config.accountantName : ""}.</p>
<p>Segue o pacote fiscal de <b>${formatDate(f.from)} a ${formatDate(f.to)}</b> de ${company.name} (CNPJ ${company.cnpj ?? ""}).</p>
<ul><li>XMLs incluídos: ${pkg.xmlCount}${pkg.simulatedXml ? ` (${pkg.simulatedXml} de SIMULAÇÃO, sem validade fiscal)` : ""}</li><li>Documentos no período: ${pkg.docs}</li>${pkg.missingXml.length ? `<li><b>XML ausentes: ${pkg.missingXml.length}</b></li>` : ""}</ul>
<p>Detalhes e critérios no arquivo LEIA-ME.txt do pacote. Este pacote não substitui arquivos de obrigações acessórias.</p></div>`;
  const r = await sendEmail(ctx.companyId, { to, subject: `Pacote fiscal ${formatDate(f.from)}–${formatDate(f.to)} — ${company.tradeName || company.name}`, html, attachments: [{ filename: pkg.fileName, content: data }] });
  const message = r.delivered ? `Pacote ${pkg.fileName} entregue ao canal ${r.channel} para ${to}` : `Pacote ${pkg.fileName} gerado, mas NÃO enviado (${r.channel}): ${r.message ?? "falha"}`;
  await logIntegration(ctx.store, { companyId: ctx.companyId, integrationId: integ.id, kind: "accounting", action: opts.reason === "scheduled" ? "scheduled_package" : "send_package", status: r.delivered ? "success" : "failure", message, payload: { fileId: pkg.fileId, from: f.from, to: f.to, xmlCount: pkg.xmlCount, missing: pkg.missingXml.length, to_address: to } });
  await audit(ctx, { module: "fiscal", action: "export.send", entityType: "file", entityId: pkg.fileId, summary: message, result: r.delivered ? "success" : "failure" });
  // a obrigação "Entrega de XML" é da EMPRESA: só é concluída pelo pacote de todas as filiais enviado ao e-mail da contabilidade
  const accountant = String(integ.config?.accountantEmail ?? "").trim().toLowerCase();
  const wholeCompany = (f.branchId ?? ctx.branchId) == null;
  if (r.delivered && wholeCompany && accountant && to.toLowerCase() === accountant) {
    const { markXmlDelivery } = await import("./obligations");
    await markXmlDelivery(ctx, f, pkg.fileId, to).catch(() => undefined);
  }
  return { delivered: r.delivered, message, package: pkg };
}

export interface AccountingSchedule {
  enabled: boolean;
  day: number;
  lastPeriod?: string | null;
  lastRunAt?: string | null;
  lastResult?: string | null;
}

export const SCHEDULE_KEY = "fiscal.accounting.schedule";

export async function getAccountingSchedule(ctx: Ctx): Promise<AccountingSchedule> {
  return getSetting<AccountingSchedule>(ctx.store, ctx.companyId, null, SCHEDULE_KEY, { enabled: false, day: 5 });
}

export async function saveAccountingSchedule(ctx: Ctx, input: { enabled: boolean; day: number }) {
  requireAction(ctx, "fiscal.configure");
  assert(Number.isInteger(input.day) && input.day >= 1 && input.day <= 28, "Dia do envio deve estar entre 1 e 28.");
  const cur = await getAccountingSchedule(ctx);
  const next = { ...cur, enabled: input.enabled, day: input.day };
  await setSetting(ctx.store, ctx.companyId, null, SCHEDULE_KEY, next, ctx.user.id);
  await audit(ctx, { module: "fiscal", action: "export.schedule", entityType: "setting", entityId: SCHEDULE_KEY, summary: `Envio mensal à contabilidade ${input.enabled ? `ativado (dia ${input.day})` : "desativado"}`, before: cur, after: next });
  return next;
}

/** Rotina mensal: no dia configurado (ou depois, se falhou), envia o pacote do mês anterior. Idempotente por período. */
export async function runScheduledAccountingExport(ctx: Ctx, ref = today()) {
  const sch = await getAccountingSchedule(ctx);
  if (!sch.enabled) return { skipped: "disabled" };
  const day = Number(ref.slice(8, 10));
  if (day < sch.day) return { skipped: "before_day" };
  const prev = addMonths(monthStart(ref), -1);
  const period = prev.slice(0, 7);
  if (sch.lastPeriod === period) return { skipped: "already_sent", period };
  const r = await sendAccountingPackage(ctx, { from: prev, to: monthEnd(prev), branchId: null, includeSimulated: true }, { reason: "scheduled" });
  const next: AccountingSchedule = { ...sch, lastRunAt: nowIso(), lastResult: r.message, lastPeriod: r.delivered ? period : sch.lastPeriod ?? null };
  await setSetting(ctx.store, ctx.companyId, null, SCHEDULE_KEY, next);
  return { period, delivered: r.delivered, message: r.message };
}

/** Pacotes gerados (arquivos) — histórico com download. */
export async function packageHistory(ctx: Ctx) {
  const files = await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", "accounting_package"]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 50);
  return files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.sizeBytes, createdAt: f.createdAt, period: f.entityId, date: toLocalDate(f.createdAt) }));
}
