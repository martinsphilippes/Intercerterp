import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { allocate } from "@/lib/money";
import { dayRange, toLocalDate } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import type { ReceiptItem, ReceiptItemFiscal } from "../receipts";
import type { DocItem } from "./service";

/**
 * Livro / relatório de ENTRADAS (FIS-24) — leitura, sem gravar nada.
 *
 * Fontes (fiscal_documents continua sendo SÓ documentos emitidos pela empresa — inventario-fiscal-documents.md):
 *  - recebimentos de mercadoria CONCLUÍDOS (`receipts`), pela data de entrada (conclusão);
 *  - notas de entrada sem estoque (`receipts.entryKind = "no_stock"`), pela data do lançamento;
 *  - CT-e de entrada registrados (`inbound_ctes`), pela data do registro;
 *  - NF-e de ENTRADA emitidas pela própria empresa (devolução de venda etc.), lidas de fiscal_documents pela emissão
 *    — apenas leitura; essas notas já ficavam fora do livro de saídas (outputBook ignora operationType "entrada").
 * Uma linha por documento × CFOP de entrada. Valor contábil por item = vProd − vDesc + vFrete + vSeg + vOutro + vIPI +
 * vIPIDevol + vICMSST + vFCPST + vII (valores do XML guardados no item); a diferença para o vNF da nota (ex.: ICMS
 * desonerado) vai para a maior linha, de modo que o documento soma o seu valor total. Recebimentos importados antes
 * dos valores por item: os totais do XML são rateados pelo valor dos itens. Recebimentos sem XML: valores do
 * lançamento (produtos + frete/despesas − desconto rateados), sem base/ICMS (não informados).
 */

export interface EntryBookFilter {
  from: string;
  to: string;
  branchId?: string | null;
}

export type EntrySource = "receipt" | "no_stock" | "cte" | "own";

export const ENTRY_SOURCE_LABEL: Record<EntrySource, string> = { receipt: "Recebimento de mercadoria", no_stock: "Nota sem estoque", cte: "CT-e de frete", own: "Emissão própria (entrada)" };

export interface EntryBookRow {
  id: string;
  source: EntrySource;
  sourceId: string;
  href: string | null;
  /** data de entrada (escrituração) AAAA-MM-DD */
  entryDate: string;
  issueDate: string | null;
  model: string;
  modelLabel: string;
  series: string;
  number: string | null;
  accessKey: string | null;
  emitter: string;
  emitterDoc: string;
  uf: string;
  cfop: string;
  value: number;
  icmsBase: number;
  icms: number;
  ipi: number;
  stBase: number;
  st: number;
  /** isentas/outras = valor contábil − base do ICMS */
  exemptOther: number;
  note: string;
  xmlFileId: string | null;
}

export interface EntryCfopRow {
  id: string;
  cfop: string;
  label: string;
  docs: number;
  value: number;
  icmsBase: number;
  icms: number;
  ipi: number;
  stBase: number;
  st: number;
  exemptOther: number;
}

/** Descrição resumida dos CFOP de entrada mais comuns no varejo (tabela do Ajuste SINIEF 07/2001). */
export const ENTRY_CFOP_LABEL: Record<string, string> = {
  "1102": "Compra para comercialização",
  "2102": "Compra para comercialização (interestadual)",
  "1101": "Compra para industrialização",
  "2101": "Compra para industrialização (interestadual)",
  "1403": "Compra para comercialização com ST",
  "2403": "Compra para comercialização com ST (interestadual)",
  "1556": "Compra de material de uso e consumo",
  "2556": "Compra de material de uso e consumo (interestadual)",
  "1551": "Compra de ativo imobilizado",
  "2551": "Compra de ativo imobilizado (interestadual)",
  "1353": "Aquisição de serviço de transporte (comércio)",
  "2353": "Aquisição de serviço de transporte (comércio, interestadual)",
  "1933": "Aquisição de serviço tributado pelo ISSQN",
  "2933": "Aquisição de serviço tributado pelo ISSQN (interestadual)",
  "1202": "Devolução de venda de mercadoria",
  "2202": "Devolução de venda de mercadoria (interestadual)",
  "1411": "Devolução de venda com ST",
  "2411": "Devolução de venda com ST (interestadual)",
  "1152": "Transferência para comercialização",
  "2152": "Transferência para comercialização (interestadual)",
  "1409": "Transferência com ST",
  "1910": "Bonificação, doação ou brinde",
  "2910": "Bonificação, doação ou brinde (interestadual)",
  "1911": "Amostra grátis",
  "1912": "Mercadoria para demonstração",
  "1913": "Retorno de demonstração",
  "1917": "Consignação mercantil",
  "1922": "Simples faturamento (entrega futura)",
  "1117": "Compra para comercialização — entrega futura",
  "1923": "Remessa por conta e ordem de terceiros",
  "1949": "Outra entrada não especificada",
  "2949": "Outra entrada não especificada (interestadual)",
};

export const cfopLabel = (cfop: string) => (cfop ? (ENTRY_CFOP_LABEL[cfop] ?? "—") : "Sem CFOP (serviço tomado — fora do ICMS)");

interface Line {
  cfop: string;
  value: number;
  icmsBase: number;
  icms: number;
  ipi: number;
  stBase: number;
  st: number;
}

const f0 = (v: number | undefined | null) => v ?? 0;

/** Valor contábil do item a partir dos valores fiscais do XML. */
export function itemAccountingValue(f: ReceiptItemFiscal) {
  if (f.vItem != null) return f.vItem;
  return f0(f.vProd) - f0(f.vDesc) + f0(f.vFrete) + f0(f.vSeg) + f0(f.vOutro) + f0(f.vIPI) + f0(f.vIPIDevol) + f0(f.vICMSST) + f0(f.vFCPST) + f0(f.vII);
}

/** Leva a soma das linhas ao total do documento (diferença na maior linha). */
function closeTo(lines: Line[], total: number | null | undefined) {
  if (total == null || !lines.length) return lines;
  const diff = total - lines.reduce((a, l) => a + l.value, 0);
  if (!diff) return lines;
  const big = lines.reduce((m, l, i) => (l.value > lines[m].value ? i : m), 0);
  lines[big] = { ...lines[big], value: lines[big].value + diff };
  return lines;
}

/** Linhas fiscais por item de um recebimento (antes do agrupamento por CFOP). */
export function receiptItemLines(r: Doc): Line[] {
  const items: ReceiptItem[] = r.items ?? [];
  const head = (r.entryCfop as string | null) ?? "";
  const cfopOf = (it: ReceiptItem) => it.entryCfop || head || "";
  const totals = r.emitter?.totals ?? null;
  const docTotal: number | null = totals?.vNF ?? (r.entryKind === "no_stock" ? (r.invoicedTotal ?? r.total ?? null) : null);
  if (items.some((it) => it.fiscal && Object.keys(it.fiscal).length)) {
    // valores do XML guardados por item (ou informados na nota sem estoque)
    const lines = items.map((it) => {
      const f = it.fiscal ?? {};
      return { cfop: cfopOf(it), value: itemAccountingValue(f), icmsBase: f0(f.vBC), icms: f0(f.vICMS), ipi: f0(f.vIPI), stBase: f0(f.vBCST), st: f0(f.vICMSST) };
    });
    return closeTo(lines, docTotal);
  }
  if (r.xmlFileId && totals) {
    // importado antes dos valores por item: totais do XML rateados pelo valor dos itens (todos os itens da nota)
    const w = items.map((it) => Math.max(0, it.invoicedValue ?? 0));
    const share = (v: number | undefined) => allocate(f0(v), w);
    const fr = share(totals.vFrete);
    const ot = share(f0(totals.vOutro) + f0(totals.vSeg));
    const ipi = share(totals.vIPI);
    const st = share(totals.vST);
    const base = share(totals.vBC);
    const icms = share(totals.vICMS);
    const stBase = share(totals.vBCST);
    const lines = items.map((it, i) => ({ cfop: cfopOf(it), value: (it.invoicedValue ?? 0) + fr[i] + ot[i] + ipi[i] + st[i], icmsBase: base[i], icms: icms[i], ipi: ipi[i], stBase: stBase[i], st: st[i] }));
    return closeTo(lines, totals.vNF);
  }
  // sem XML: valores do lançamento (o que entrou: produtos + frete/despesas − desconto rateados), sem tributos
  const active = items.filter((it) => !it.ignore && it.skuId && it.receivedQty > 0);
  const lines = active.map((it) => ({ cfop: cfopOf(it), value: (it.lineValue ?? 0) + f0(it.freightShare) + f0(it.otherShare) - f0(it.discountShare), icmsBase: 0, icms: 0, ipi: 0, stBase: 0, st: 0 }));
  return closeTo(lines, r.dueTotal ?? null);
}

function groupByCfop(lines: Line[]) {
  const by = new Map<string, Line>();
  for (const l of lines) {
    const g = by.get(l.cfop) ?? { cfop: l.cfop, value: 0, icmsBase: 0, icms: 0, ipi: 0, stBase: 0, st: 0 };
    g.value += l.value;
    g.icmsBase += l.icmsBase;
    g.icms += l.icms;
    g.ipi += l.ipi;
    g.stBase += l.stBase;
    g.st += l.st;
    by.set(l.cfop, g);
  }
  return [...by.values()].sort((a, b) => a.cfop.localeCompare(b.cfop));
}

const modelLabelOf = (m: string) => ({ "55": "NF-e", "57": "CT-e", nfse: "NFS-e", other: "Outro" })[m] ?? m;

/** Linhas do livro de um recebimento concluído (mercadoria ou nota sem estoque). */
export function receiptBookRows(r: Doc, supplier: Doc | null | undefined): EntryBookRow[] {
  const noStock = r.entryKind === "no_stock";
  const model = r.nfeKey ? "55" : noStock ? (r.emitter?.docModel ?? "other") : "55";
  const notes = [
    noStock ? "Sem estoque" : "",
    !r.xmlFileId ? "Sem XML — valores do lançamento" : "",
    r.emitter?.environment === "homologacao" ? "HOMOLOGAÇÃO — sem valor fiscal" : "",
    (r.cteFreight ?? 0) > 0 ? "Frete por CT-e (lançado à parte)" : "",
  ].filter(Boolean);
  const doc = onlyDigits(r.emitter?.cnpj ?? r.emitter?.cpf ?? supplier?.doc ?? "");
  const uf = r.emitter?.address?.uf ?? r.emitter?.uf ?? supplier?.addresses?.[0]?.uf ?? "";
  return groupByCfop(receiptItemLines(r)).map((g) => ({
    id: `receipt:${r.id}:${g.cfop}`,
    source: noStock ? "no_stock" : "receipt",
    sourceId: r.id,
    href: `/compras/recebimentos/${r.id}`,
    entryDate: toLocalDate(r.confirmedAt ?? r.createdAt),
    issueDate: r.nfeIssueDate ? toLocalDate(r.nfeIssueDate) : null,
    model,
    modelLabel: modelLabelOf(model),
    series: r.nfeSeries ?? "",
    number: r.nfeNumber ?? null,
    accessKey: r.nfeKey ?? null,
    emitter: supplier?.name ?? r.emitter?.name ?? "—",
    emitterDoc: doc,
    uf: uf ?? "",
    cfop: g.cfop,
    value: g.value,
    icmsBase: g.icmsBase,
    icms: g.icms,
    ipi: g.ipi,
    stBase: g.stBase,
    st: g.st,
    exemptOther: g.value - g.icmsBase,
    note: notes.join(" · "),
    xmlFileId: r.xmlFileId ?? null,
  }));
}

/** Linha do livro de um CT-e de entrada. */
export function cteBookRow(c: Doc, carrier: Doc | null | undefined): EntryBookRow {
  const icms = c.icms ?? {};
  return {
    id: `cte:${c.id}`,
    source: "cte",
    sourceId: c.id,
    href: `/compras/cte/${c.id}`,
    entryDate: toLocalDate(c.registeredAt ?? c.createdAt),
    issueDate: c.issueDate ? toLocalDate(c.issueDate) : null,
    model: "57",
    modelLabel: "CT-e",
    series: c.cteSeries ?? "",
    number: c.cteNumber ?? null,
    accessKey: c.cteKey ?? null,
    emitter: carrier?.name ?? c.emitter?.name ?? "—",
    emitterDoc: onlyDigits(c.emitter?.cnpj ?? c.emitter?.cpf ?? ""),
    uf: c.emitter?.uf ?? "",
    cfop: c.entryCfop ?? "",
    value: c.total ?? 0,
    icmsBase: icms.vBC ?? 0,
    icms: icms.vICMS ?? 0,
    ipi: 0,
    stBase: 0,
    st: 0,
    exemptOther: (c.total ?? 0) - (icms.vBC ?? 0),
    note: [c.environment === "homologacao" ? "HOMOLOGAÇÃO — sem valor fiscal" : "", (c.allocations ?? []).length ? `Frete de ${(c.allocations ?? []).map((a: any) => `rec. nº ${a.receiptNumber}`).join(", ")}` : ""].filter(Boolean).join(" · "),
    xmlFileId: c.xmlFileId ?? null,
  };
}

/** Linhas do livro de NF-e de ENTRADA emitida pela empresa (leitura de fiscal_documents). */
export function ownEntryRows(d: Doc): EntryBookRow[] {
  const groups = new Map<string, Line>();
  for (const i of (d.items ?? []) as DocItem[]) {
    const g = groups.get(i.cfop) ?? { cfop: i.cfop, value: 0, icmsBase: 0, icms: 0, ipi: 0, stBase: 0, st: 0 };
    g.value += i.total ?? 0;
    g.icmsBase += i.icmsBase ?? 0;
    g.icms += i.icms ?? 0;
    groups.set(i.cfop, g);
  }
  const cancelled = d.status === "cancelled";
  return [...groups.values()].map((g) => ({
    id: `own:${d.id}:${g.cfop}`,
    source: "own" as const,
    sourceId: d.id,
    href: `/fiscal/nfe/${d.id}`,
    entryDate: toLocalDate(d.issuedAt),
    issueDate: toLocalDate(d.issuedAt),
    model: "55",
    modelLabel: "NF-e",
    series: d.series ?? "",
    number: d.number != null ? String(d.number) : null,
    accessKey: d.accessKey ?? null,
    emitter: d.recipientName ?? "—",
    emitterDoc: d.recipientDoc ?? "",
    uf: d.recipient?.address?.uf ?? "",
    cfop: g.cfop,
    value: cancelled ? 0 : g.value,
    icmsBase: cancelled ? 0 : g.icmsBase,
    icms: cancelled ? 0 : g.icms,
    ipi: 0,
    stBase: 0,
    st: 0,
    exemptOther: cancelled ? 0 : g.value - g.icmsBase,
    note: ["Emissão própria (remetente/participante ao lado)", cancelled ? "DOCUMENTO CANCELADO" : "", d.isSimulated ? "SIMULAÇÃO — sem validade fiscal" : "", d.purpose === "devolucao" ? "Devolução" : ""].filter(Boolean).join(" · "),
    xmlFileId: d.xmlFileId ?? null,
  }));
}

export function entriesByCfop(rows: EntryBookRow[]): EntryCfopRow[] {
  const by = new Map<string, EntryCfopRow & { docSet: Set<string> }>();
  for (const r of rows) {
    const g = by.get(r.cfop) ?? { id: r.cfop || "-", cfop: r.cfop, label: cfopLabel(r.cfop), docs: 0, value: 0, icmsBase: 0, icms: 0, ipi: 0, stBase: 0, st: 0, exemptOther: 0, docSet: new Set<string>() };
    g.docSet.add(`${r.source}:${r.sourceId}`);
    g.value += r.value;
    g.icmsBase += r.icmsBase;
    g.icms += r.icms;
    g.ipi += r.ipi;
    g.stBase += r.stBase;
    g.st += r.st;
    g.exemptOther += r.exemptOther;
    by.set(r.cfop, g);
  }
  return [...by.values()].map(({ docSet, ...g }) => ({ ...g, docs: docSet.size })).sort((a, b) => (a.cfop || "9999").localeCompare(b.cfop || "9999"));
}

export interface EntriesBook {
  rows: EntryBookRow[];
  byCfop: EntryCfopRow[];
  totals: { docs: number; value: number; icmsBase: number; icms: number; ipi: number; stBase: number; st: number; exemptOther: number };
  /** recebimentos em conferência com NF-e emitida no período (ainda não escriturados) */
  pendingReceipts: Array<{ id: string; number: number; nfeNumber: string | null; supplier: string }>;
  /**
   * §40: entradas de mercadoria com NOTA A CONFIRMAR realizadas no período (sem documento do fornecedor ainda): ficam
   * fora do livro até a confirmação da nota — depois entram pela data da entrada, como recebimento comum
   */
  awaitingInvoice: Array<{ id: string; number: number; supplier: string; value: number }>;
  /** documentos de entrada com XML no período (pacote contábil) */
  xmlFiles: Array<{ fileId: string; kind: "nfe" | "cte"; label: string }>;
}

/** Livro de entradas do período (data de entrada), por documento × CFOP, com totais por CFOP. */
export async function entriesBook(ctx: Ctx, f: EntryBookFilter): Promise<EntriesBook> {
  const { start, end } = dayRange(f.from, f.to);
  const branch = f.branchId ?? ctx.branchId;
  const scope: any[] = [["eq", "companyId", ctx.companyId], ...(branch ? [["eq", "branchId", branch]] : [])];
  const [allReceipts, ctes, own, drafts] = await Promise.all([
    listAll(ctx.store, "receipts", { filters: [...scope, ["eq", "status", "confirmed"], ["gte", "confirmedAt", start], ["lt", "confirmedAt", end]], orderBy: [{ field: "confirmedAt", dir: "asc" }] }),
    listAll(ctx.store, "inbound_ctes", { filters: [...scope, ["eq", "status", "registered"], ["gte", "registeredAt", start], ["lt", "registeredAt", end]], orderBy: [{ field: "registeredAt", dir: "asc" }] }),
    listAll(ctx.store, "fiscal_documents", { filters: [...scope, ["eq", "model", "nfe"], ["gte", "issuedAt", start], ["lt", "issuedAt", end]], orderBy: [{ field: "issuedAt", dir: "asc" }] }),
    listAll(ctx.store, "receipts", { filters: [...scope, ["eq", "status", ["draft", "confirming"]]] }),
  ]);
  // entrada com nota a confirmar (§40) ainda sem a nota: fora do livro (sem documento fiscal do fornecedor)
  const receipts = allReceipts.filter((r) => r.documentStatus !== "pending_invoice");
  const awaiting = allReceipts.filter((r) => r.documentStatus === "pending_invoice");
  const supplierIds = [...new Set([...allReceipts.map((r) => r.supplierId), ...ctes.map((c) => c.carrierId), ...drafts.map((r) => r.supplierId)].filter(Boolean))];
  const suppliers = new Map<string, Doc>();
  for (let i = 0; i < supplierIds.length; i += 100) for (const s of await listAll(ctx.store, "suppliers", { filters: [["eq", "id", supplierIds.slice(i, i + 100)]] })) suppliers.set(s.id, s);
  const rows: EntryBookRow[] = [
    ...receipts.flatMap((r) => receiptBookRows(r, suppliers.get(r.supplierId))),
    ...ctes.map((c) => cteBookRow(c, suppliers.get(c.carrierId))),
    ...own.filter((d) => d.operationType === "entrada" && ["authorized", "cancelled"].includes(d.status)).flatMap(ownEntryRows),
  ].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.modelLabel.localeCompare(b.modelLabel) || String(a.number ?? "").localeCompare(String(b.number ?? ""), "pt-BR", { numeric: true }) || a.cfop.localeCompare(b.cfop));
  const sum = (k: keyof EntryBookRow) => rows.reduce((a, r) => a + ((r[k] as number) ?? 0), 0);
  const docs = new Set(rows.map((r) => `${r.source}:${r.sourceId}`)).size;
  const pendingReceipts = drafts
    .filter((r) => r.entryKind !== "no_stock" && r.documentStatus !== "pending_invoice" && r.nfeIssueDate && toLocalDate(r.nfeIssueDate) >= f.from && toLocalDate(r.nfeIssueDate) <= f.to)
    .map((r) => ({ id: r.id, number: r.number as number, nfeNumber: (r.nfeNumber as string | null) ?? null, supplier: suppliers.get(r.supplierId)?.name ?? r.emitter?.name ?? "—" }));
  const xmlFiles = [
    ...receipts.filter((r) => r.xmlFileId).map((r) => ({ fileId: r.xmlFileId as string, kind: "nfe" as const, label: `NF-e ${r.nfeNumber ?? ""} (recebimento nº ${r.number})` })),
    ...ctes.filter((c) => c.xmlFileId).map((c) => ({ fileId: c.xmlFileId as string, kind: "cte" as const, label: `CT-e ${c.cteNumber ?? ""} (nº ${c.number})` })),
  ];
  return {
    rows,
    byCfop: entriesByCfop(rows),
    totals: { docs, value: sum("value"), icmsBase: sum("icmsBase"), icms: sum("icms"), ipi: sum("ipi"), stBase: sum("stBase"), st: sum("st"), exemptOther: sum("exemptOther") },
    pendingReceipts,
    awaitingInvoice: awaiting.map((r) => ({ id: r.id, number: r.number as number, supplier: suppliers.get(r.supplierId)?.name ?? r.emitter?.name ?? "—", value: (r.dueTotal as number) ?? 0 })),
    xmlFiles,
  };
}

type Col = { key: string; label: string; type?: "money" | "date" | "datetime" | "qty" };

/** Colunas do livro de entradas (CSV da tela e do pacote contábil). */
export const ENTRY_BOOK_COLS: Col[] = [
  { key: "entryDate", label: "Data de entrada", type: "date" },
  { key: "issueDate", label: "Data de emissão", type: "date" },
  { key: "modelLabel", label: "Espécie" },
  { key: "series", label: "Série" },
  { key: "number", label: "Número" },
  { key: "accessKey", label: "Chave de acesso" },
  { key: "emitter", label: "Emitente" },
  { key: "emitterDoc", label: "CPF/CNPJ" },
  { key: "uf", label: "UF" },
  { key: "cfop", label: "CFOP" },
  { key: "value", label: "Valor contábil", type: "money" },
  { key: "icmsBase", label: "Base ICMS", type: "money" },
  { key: "icms", label: "ICMS", type: "money" },
  { key: "ipi", label: "IPI", type: "money" },
  { key: "stBase", label: "Base ICMS-ST", type: "money" },
  { key: "st", label: "ICMS-ST", type: "money" },
  { key: "exemptOther", label: "Isentas/outras", type: "money" },
  { key: "sourceLabel", label: "Origem" },
  { key: "note", label: "Observações" },
];

export const ENTRY_CFOP_COLS: Col[] = [
  { key: "cfop", label: "CFOP" },
  { key: "label", label: "Descrição" },
  { key: "docs", label: "Documentos" },
  { key: "value", label: "Valor contábil", type: "money" },
  { key: "icmsBase", label: "Base ICMS", type: "money" },
  { key: "icms", label: "ICMS", type: "money" },
  { key: "ipi", label: "IPI", type: "money" },
  { key: "stBase", label: "Base ICMS-ST", type: "money" },
  { key: "st", label: "ICMS-ST", type: "money" },
  { key: "exemptOther", label: "Isentas/outras", type: "money" },
];

/** Linhas planas para CSV (rótulo da origem incluído). */
export const entryCsvRows = (rows: EntryBookRow[]) => rows.map((r) => ({ ...r, sourceLabel: ENTRY_SOURCE_LABEL[r.source] }));
