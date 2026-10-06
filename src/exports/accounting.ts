import "server-only";
import { defineExport } from "@/lib/exporters";
import { parseList, sp } from "@/lib/list";
import { listDeliveries } from "@/domain/accounting";
import { queryPortfolio, portfolioRefs } from "@/app/(app)/contabil/queries";

/** Carteira de clientes do escritório contábil — mesma consulta e filtros da tela /contabil/clientes. */
defineExport("accounting_clients", {
  module: "accounting",
  title: "Clientes contábeis",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome / razão social" },
    { key: "tradeName", label: "Nome fantasia" },
    { key: "personType", label: "Tipo" },
    { key: "doc", label: "CPF/CNPJ" },
    { key: "email", label: "E-mail" },
    { key: "phone", label: "Telefone" },
    { key: "regimeLabel", label: "Regime tributário" },
    { key: "cnae", label: "CNAE principal" },
    { key: "servicesLabel", label: "Serviços contratados" },
    { key: "responsibleName", label: "Responsável" },
    { key: "groupName", label: "Grupo" },
    { key: "city", label: "Cidade/UF" },
    { key: "statusLabel", label: "Situação" },
    { key: "linkLabel", label: "Vínculo com o ERP" },
    { key: "onboardedAt", label: "Entrada no escritório", type: "date" },
    { key: "serviceStartAt", label: "Início dos serviços", type: "date" },
    { key: "employeesCount", label: "Funcionários", type: "number" },
    { key: "monthlyDocs", label: "Documentos/mês", type: "number" },
    { key: "monthlyEntries", label: "Lançamentos/mês", type: "number" },
  ],
  rows: (s, params) => queryPortfolio(s.ctx, parseList(params)),
});

/** Caixa de entrada do escritório — mesmos filtros da tela /contabil/entregas (cliente, status, periodo). */
defineExport("accounting_deliveries", {
  module: "accounting",
  title: "Caixa de entrada (entregas)",
  columns: [
    { key: "clientCode", label: "Código" },
    { key: "clientName", label: "Cliente" },
    { key: "period", label: "Período" },
    { key: "periodFrom", label: "De", type: "date" },
    { key: "periodTo", label: "Até", type: "date" },
    { key: "fileName", label: "Arquivo" },
    { key: "xmlCount", label: "XML", type: "number" },
    { key: "docs", label: "Documentos", type: "number" },
    { key: "missingXml", label: "XML ausentes", type: "number" },
    { key: "receivedAt", label: "Recebida em", type: "datetime" },
    { key: "statusLabel", label: "Situação" },
    { key: "reviewedAt", label: "Conferida em", type: "datetime" },
    { key: "reviewedByName", label: "Conferida por" },
    { key: "notes", label: "Observação" },
  ],
  rows: async (s, params) => {
    const period = sp(params, "periodo").trim();
    const [deliveries, clients, refs] = await Promise.all([
      listDeliveries(s.ctx, { clientId: sp(params, "cliente").trim() || null, status: sp(params, "status").trim() || null, period: /^\d{4}-\d{2}$/.test(period) ? period : null }),
      queryPortfolio(s.ctx, { q: "", f: {} }),
      portfolioRefs(s.ctx),
    ]);
    const byId = new Map(clients.map((c) => [c.id, c]));
    return deliveries.map((d) => ({
      clientCode: byId.get(d.clientId)?.code ?? "",
      clientName: byId.get(d.clientId)?.name ?? "Cliente fora da carteira",
      period: d.period,
      periodFrom: d.periodFrom ?? d.payload?.from ?? null,
      periodTo: d.periodTo ?? d.payload?.to ?? null,
      fileName: d.fileName,
      xmlCount: d.payload?.xmlCount ?? 0,
      docs: d.payload?.docs ?? 0,
      missingXml: d.payload?.missingXml ?? 0,
      receivedAt: d.receivedAt,
      statusLabel: d.status === "reviewed" ? "Conferida" : "Recebida — a conferir",
      reviewedAt: d.reviewedAt ?? null,
      reviewedByName: d.reviewedBy ? (refs.userName.get(d.reviewedBy) ?? "") : "",
      notes: d.notes ?? "",
    }));
  },
});
