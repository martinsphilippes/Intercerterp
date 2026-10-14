import "server-only";
import { listAll } from "@/lib/db";
import { defineExport } from "@/lib/exporters";
import { featureOn } from "@/lib/server/features";
import { AGING_BUCKETS, computeAging, computeDre, dreRows } from "@/domain/finance-reports";
import { codedName, effectiveDreGroup, flattenTree } from "@/domain/chart-of-accounts";
import { ACQUIRER_STATUS_LABEL, acquirerReportLines, type AcquirerStatus } from "@/domain/card-reconciliation";
import { financeReportParams } from "@/app/(app)/relatorios/financeiros/params";

/** Fase 7 — exportações dos relatórios financeiros (mesmas funções das telas). */

const KIND_LABEL = { section: "Grupo", line: "Linha", subtotal: "Subtotal", outside: "Fora do resultado" } as const;

/** DRE gerencial (FIN-22): uma linha por item do demonstrativo e competência (mês) + total. */
defineExport("fin-dre", {
  module: "finance",
  title: "DRE gerencial",
  columns: [
    { key: "order", label: "Ordem", type: "number" },
    { key: "kind", label: "Tipo" },
    { key: "label", label: "Descrição" },
    { key: "month", label: "Competência" },
    { key: "value", label: "Valor", type: "money" },
    { key: "from", label: "Período de", type: "date" },
    { key: "to", label: "Período até", type: "date" },
    { key: "branch", label: "Filial" },
  ],
  rows: async (s, params) => {
    if (!(await featureOn(s, "dre"))) return [];
    const fp = await financeReportParams(s, params);
    const r = await computeDre(s.ctx, { from: fp.period.from, to: fp.period.to, branchIds: fp.domainBranchIds });
    const out: Record<string, any>[] = [];
    dreRows(r).forEach((row, i) => {
      for (const m of r.months) if (row.months[m.key]) out.push({ order: i + 1, kind: KIND_LABEL[row.kind], label: row.label, month: m.label, value: row.months[m.key], from: r.from, to: r.to, branch: fp.branchName });
      out.push({ order: i + 1, kind: KIND_LABEL[row.kind], label: row.label, month: "Total", value: row.total, from: r.from, to: r.to, branch: fp.branchName });
    });
    return out;
  },
});

/** Aging (FIN-22): uma linha por parcela em aberto, com a faixa de atraso na data da posição. */
defineExport("fin-aging", {
  module: "finance",
  title: "Aging de contas a receber/pagar",
  columns: [
    { key: "kind", label: "Tipo" },
    { key: "partyName", label: "Cliente / fornecedor" },
    { key: "titleNumber", label: "Título", type: "number" },
    { key: "installment", label: "Parcela" },
    { key: "description", label: "Descrição" },
    { key: "dueDate", label: "Vencimento", type: "date" },
    { key: "daysLate", label: "Dias de atraso", type: "number" },
    { key: "bucket", label: "Faixa" },
    { key: "balance", label: "Saldo em aberto", type: "money" },
    { key: "ref", label: "Posição em", type: "date" },
  ],
  rows: async (s, params) => {
    if (!(await featureOn(s, "dre"))) return [];
    const fp = await financeReportParams(s, params);
    const kind = fp.aba === "pagar" ? "payable" : "receivable";
    const r = await computeAging(s.ctx, { kind, ref: fp.ref, branchIds: fp.domainBranchIds, bucket: fp.faixa });
    return r.items.map((x) => ({
      kind: kind === "receivable" ? "A receber" : "A pagar", partyName: x.partyName, titleNumber: x.titleNumber, installment: `${x.number}/${x.installments}`, description: x.description,
      dueDate: x.dueDate, daysLate: x.daysLate, bucket: AGING_BUCKETS.find((b) => b.key === x.bucket)?.label ?? x.bucket, balance: x.balance, ref: r.ref,
    }));
  },
});

/** Plano de contas (FIN-19) para o contador: hierarquia, códigos, grupo do DRE efetivo e conta contábil. */
defineExport("fin-chart-of-accounts", {
  module: "finance",
  title: "Plano de contas",
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Categoria" },
    { key: "path", label: "Caminho" },
    { key: "level", label: "Nível", type: "number" },
    { key: "structure", label: "Estrutura" },
    { key: "type", label: "Tipo" },
    { key: "dreGroup", label: "Grupo do DRE" },
    { key: "inherited", label: "Grupo herdado" },
    { key: "accountingCode", label: "Conta contábil" },
    { key: "parent", label: "Categoria pai" },
    { key: "active", label: "Situação" },
  ],
  rows: async (s) => {
    const cats = await listAll(s.ctx.store, "fin_categories", { filters: [["eq", "companyId", s.ctx.companyId]] });
    const byId = new Map(cats.map((c) => [c.id, c]));
    return flattenTree(cats as any[]).map((c) => {
      const eff = effectiveDreGroup(c.id, byId as Map<string, any>);
      const parent = c.parentId ? byId.get(c.parentId) : null;
      return {
        code: c.code ?? "", name: c.name, path: c.path, level: c.depth, structure: c.synthetic ? "Sintética" : "Analítica", type: c.type === "revenue" ? "Receita" : "Despesa", dreGroup: eff ?? "",
        inherited: eff && !c.dreGroup ? "Sim" : "Não", accountingCode: c.accountingCode ?? "", parent: parent ? codedName(parent as any) : "", active: c.active === false ? "Inativa" : "Ativa",
      };
    });
  },
});

/** Linhas do relatório de uma conciliação com o arquivo da adquirente (FIN-24). */
defineExport("fin-acquirer-lines", {
  module: "finance",
  title: "Conciliação com a adquirente",
  columns: [
    { key: "lineNo", label: "Linha", type: "number" },
    { key: "status", label: "Situação" },
    { key: "message", label: "Detalhe" },
    { key: "nsu", label: "NSU" },
    { key: "authCode", label: "Autorização" },
    { key: "brand", label: "Bandeira" },
    { key: "installmentLabel", label: "Parcela" },
    { key: "saleDate", label: "Data da venda", type: "date" },
    { key: "creditDate", label: "Data de crédito", type: "date" },
    { key: "expectedDate", label: "Previsão no sistema", type: "date" },
    { key: "gross", label: "Bruto", type: "money" },
    { key: "fee", label: "Taxa cobrada", type: "money" },
    { key: "expectedFee", label: "Taxa prevista", type: "money" },
    { key: "feeDiff", label: "Diferença de taxa", type: "money" },
    { key: "net", label: "Líquido", type: "money" },
    { key: "saleNumber", label: "Venda nº", type: "number" },
    { key: "titleNumber", label: "Título nº", type: "number" },
  ],
  rows: async (s, params) => {
    if (!(await featureOn(s, "taxasCartao"))) return [];
    const imp = params.import ? await s.ctx.store.get("bank_imports", String(params.import)) : null;
    if (!imp || imp.companyId !== s.ctx.companyId || imp.kind !== "acquirer") return [];
    return acquirerReportLines(imp, params.situacao ? String(params.situacao) : null).map((l) => ({ ...l, status: ACQUIRER_STATUS_LABEL[l.status as AcquirerStatus] ?? l.status }));
  },
});
