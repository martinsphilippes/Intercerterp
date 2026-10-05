import "server-only";
import { defineExport, type ExportColumn } from "@/lib/exporters";
import { parseList } from "@/lib/list";
import { queryDocuments } from "@/app/(app)/fiscal/queries";
import { bookRows, cancelRows, cfopRows, ncmRows, periodDocRows, rejectRows, serviceRows } from "@/app/(app)/fiscal/relatorios/queries";
import { BOOK_COLS, CANCEL_COLS, CFOP_COLS, DOC_COLS, NCM_COLS, REJECT_COLS, SERVICE_COLS } from "@/domain/fiscal/export";
import { listObligations, OBLIGATION_KIND_LABEL, OBLIGATION_STATUS_LABEL } from "@/domain/fiscal/obligations";
import { listAll } from "@/lib/db";

/** Exportações do recorte (mesmas consultas das telas fiscais e da central de integrações). */
const docCols = (model: string): ExportColumn[] => [
  { key: "issuedAt", label: "Emissão", type: "datetime" },
  { key: "series", label: "Série" },
  { key: "number", label: "Número" },
  ...(model === "nfse" ? [{ key: "rpsNumber", label: "RPS" }, { key: "verificationCode", label: "Código de verificação" }, { key: "competence", label: "Competência", type: "date" as const }, { key: "serviceItem", label: "Item LC 116" }] : [{ key: "accessKey", label: "Chave de acesso" }]),
  ...(model === "nfce" ? [{ key: "saleNumber", label: "Venda" }, { key: "terminalCode", label: "Caixa" }, { key: "operatorName", label: "Operador" }, { key: "paymentLabel", label: "Pagamento" }] : []),
  { key: "recipientName", label: model === "nfse" ? "Tomador" : "Destinatário" },
  { key: "recipientDoc", label: "CPF/CNPJ" },
  ...(model === "nfe" ? [{ key: "nature", label: "Natureza" }, { key: "operationType", label: "Operação" }, { key: "purpose", label: "Finalidade" }, { key: "originLabel", label: "Origem" }] : []),
  { key: "branchName", label: "Filial" },
  { key: "statusLabel", label: "Situação" },
  { key: "statusCode", label: "Código de retorno" },
  { key: "protocol", label: "Protocolo" },
  { key: "total", label: model === "nfse" ? "Valor dos serviços" : "Valor", type: "money" },
  ...(model === "nfse" ? [{ key: "issValue", label: "ISS", type: "money" as const }, { key: "issWithheld", label: "ISS retido", type: "money" as const }, { key: "netValue", label: "Líquido", type: "money" as const }] : []),
  { key: "simLabel", label: "Simulação" },
];

for (const [model, title] of [["nfe", "NF-e"], ["nfce", "NFC-e"], ["nfse", "NFS-e"]] as const) {
  defineExport(`fiscal-${model}`, { module: "fiscal", title, columns: docCols(model), rows: (s, params) => queryDocuments(s.ctx, model, parseList(params)) });
}

const cast = (cols: Array<{ key: string; label: string; type?: string }>) => cols as ExportColumn[];
defineExport("fiscal-documentos", { module: "fiscal", title: "Documentos fiscais do período", columns: cast([...DOC_COLS, { key: "approxTax", label: "Tributos aproximados", type: "money" }]), rows: (s, p) => periodDocRows(s.ctx, p) });
defineExport("fiscal-livro-saidas", { module: "fiscal", title: "Livro de registro de saídas", columns: cast(BOOK_COLS), rows: (s, p) => bookRows(s.ctx, p) });
defineExport("fiscal-ncm", { module: "fiscal", title: "Tributos por NCM", columns: cast(NCM_COLS), rows: (s, p) => ncmRows(s.ctx, p) });
defineExport("fiscal-cfop", { module: "fiscal", title: "Resumo contábil por CFOP", columns: cast(CFOP_COLS), rows: (s, p) => cfopRows(s.ctx, p) });
defineExport("fiscal-servicos", { module: "fiscal", title: "Serviços (NFS-e) por item", columns: cast(SERVICE_COLS), rows: (s, p) => serviceRows(s.ctx, p) });
defineExport("fiscal-cancelamentos", { module: "fiscal", title: "Cancelamentos", columns: cast(CANCEL_COLS), rows: (s, p) => cancelRows(s.ctx, p) });
defineExport("fiscal-rejeicoes", { module: "fiscal", title: "Rejeições", columns: cast(REJECT_COLS), rows: (s, p) => rejectRows(s.ctx, p) });
defineExport("fiscal-obrigacoes", {
  module: "fiscal",
  title: "Obrigações fiscais",
  columns: [
    { key: "kindLabel", label: "Tipo" },
    { key: "name", label: "Obrigação" },
    { key: "period", label: "Competência" },
    { key: "dueDate", label: "Vencimento (parâmetro)", type: "date" },
    { key: "statusLabel", label: "Situação" },
    { key: "deliveredAt", label: "Entrega", type: "datetime" },
    { key: "receiptNumber", label: "Recibo/protocolo" },
    { key: "amount", label: "Valor", type: "money" },
  ],
  rows: async (s) => (await listObligations(s.ctx, {})).map((o) => ({ ...o, kindLabel: OBLIGATION_KIND_LABEL[o.kind] ?? o.kind, statusLabel: OBLIGATION_STATUS_LABEL[o.display] ?? o.display })),
});
defineExport("integration-logs", {
  module: "admin",
  title: "Histórico de integrações",
  columns: [
    { key: "occurredAt", label: "Data/hora", type: "datetime" },
    { key: "kind", label: "Integração" },
    { key: "action", label: "Ação" },
    { key: "status", label: "Resultado" },
    { key: "message", label: "Mensagem" },
    { key: "durationMs", label: "Duração (ms)", type: "number" },
  ],
  rows: async (s, p) => {
    const kind = typeof p.kind === "string" ? p.kind : null;
    const filters: any[] = [["eq", "companyId", s.ctx.companyId]];
    if (kind) filters.push(["eq", "kind", kind]);
    return listAll(s.ctx.store, "integration_logs", { filters, orderBy: [{ field: "occurredAt", dir: "desc" }] }, 5000);
  },
});
