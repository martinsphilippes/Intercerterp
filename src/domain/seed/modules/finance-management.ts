import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { addDays, monthStart, today } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/core/settings";
import type { DemoRefs } from "../base";
import { cardFeeByInstallment, createManualTitle } from "../../finance";
import type { CardFeeRow } from "../../card-fees";
import { saveFile } from "@/lib/core/files";
import { ACQUIRER_SAMPLE_KEY } from "../../card-reconciliation";

/**
 * Demonstração da Fase 7 — gestão financeira (idempotente: ids determinísticos, "só se ausente" e marcador
 * "demo.financeManagement.done"):
 *  - tabela de taxas por bandeira × parcelas nos meios "Cartão de crédito" e "Cartão de débito" (FIN-24);
 *  - arquivo CSV da adquirente de exemplo (layout documentado em docs/regras-assumidas.md §36) gerado a partir dos
 *    recebíveis de cartão em aberto, guardado nos arquivos do sistema (`files`, kind "acquirer_sample") e oferecido
 *    para download em Financeiro › Arquivo da adquirente: linhas que casam, uma com taxa diferente da prevista, uma
 *    sem correspondência e uma com valor divergente (o usuário faz a prévia e a baixa pela tela);
 *  - plano de contas com códigos e código contábil, um grupo sintético "Despesas administrativas" com subcategoria
 *    que herda o grupo do DRE, uma despesa do mês nela e centros de custo em hierarquia (FIN-19/FIN-22).
 * O fechamento de período (FIN-21) nasce desligado e não é demonstrado com data fechada.
 */

export const DEMO_CREDIT_FEE_TABLE: CardFeeRow[] = [
  { brand: "Elo", minInstallments: 1, maxInstallments: 1, feeBps: 329, settlementDays: 30 },
  { brand: "Elo", minInstallments: 2, maxInstallments: 6, feeBps: 389, settlementDays: 30 },
  { brand: "Mastercard", minInstallments: 1, maxInstallments: 1, feeBps: 299, settlementDays: 30 },
  { brand: "Mastercard", minInstallments: 2, maxInstallments: 6, feeBps: 349, settlementDays: 30 },
  { brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 299, settlementDays: 30 },
  { brand: "Visa", minInstallments: 2, maxInstallments: 6, feeBps: 349, settlementDays: 30 },
];

export const DEMO_DEBIT_FEE_TABLE: CardFeeRow[] = [
  { brand: "Elo", minInstallments: 1, maxInstallments: 1, feeBps: 129, settlementDays: 1 },
  { brand: "Mastercard", minInstallments: 1, maxInstallments: 1, feeBps: 99, settlementDays: 1 },
  { brand: "Visa", minInstallments: 1, maxInstallments: 1, feeBps: 99, settlementDays: 1 },
];

const money = (c: number) => `${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, "0")}`;
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export const ACQUIRER_CSV_HEADER = "Data da venda;NSU;Autorização;Bandeira;Parcela;Valor bruto;Taxa;Valor líquido;Data de crédito";

/** Monta uma linha do CSV de exemplo (separador ";", vírgula decimal, datas dd/mm/aaaa). */
export function acquirerCsvLine(l: { saleDate: string; nsu: string; auth?: string; brand: string; parcel: string; gross: number; fee: number; creditDate: string }) {
  return [dmy(l.saleDate), l.nsu, l.auth ?? "", l.brand, l.parcel, money(l.gross), money(l.fee), money(l.gross - l.fee), dmy(l.creditDate)].join(";");
}

export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const companyId = refs.company.id;
  if (await getSetting(store, companyId, null, "demo.financeManagement.done", false)) return { skipped: true };
  const base = { companyId, isDemo: true };
  const t0 = today();

  // 1) Tabela de taxas por bandeira × parcelas (só se o meio ainda não tem tabela)
  for (const [key, table] of [["credito", DEMO_CREDIT_FEE_TABLE], ["debito", DEMO_DEBIT_FEE_TABLE]] as const) {
    const m = await store.get("payment_methods", refs.methods[key].id);
    if (m && !(Array.isArray(m.feeTable) && m.feeTable.length)) await store.update("payment_methods", m.id, { feeTable: table });
  }

  // 2) Plano de contas: códigos, código contábil e um grupo sintético com subcategoria que herda o grupo do DRE
  const codes: Record<string, [string, string]> = {
    vendas: ["3.1.01", "3.1.1.01"], servicos: ["3.1.02", "3.1.1.02"], "outras-receitas": ["3.9.01", "3.9.1.01"], compras: ["4.1.01", "1.1.4.01"], aluguel: ["4.2.01", "4.2.1.01"],
    energia: ["4.2.02", "4.2.1.02"], salarios: ["4.4.01", "4.4.1.01"], tarifas: ["4.5.01", "4.5.1.01"], impostos: ["3.2.01", "3.2.1.01"], frete: ["4.2.03", "4.2.1.03"],
  };
  for (const [key, [code, accountingCode]] of Object.entries(codes)) {
    const c = refs.finCategories[key] ? await store.get("fin_categories", refs.finCategories[key].id) : null;
    if (c && !c.code) await store.update("fin_categories", c.id, { code, accountingCode, level: c.parentId ? c.level ?? 2 : 1 });
  }
  const admGroup = await refs.seeder.put("fin_categories", "grupo-administrativas", { ...base, name: "Despesas administrativas", type: "expense", dreGroup: "Despesas administrativas", active: true, code: "4.3", level: 1, accountingCode: "4.3.1" });
  const office = await refs.seeder.put("fin_categories", "material-escritorio", { ...base, name: "Material de escritório", type: "expense", parentId: admGroup.id, dreGroup: null, active: true, code: "4.3.01", level: 2, accountingCode: "4.3.1.01" });
  const lojas = await refs.seeder.put("cost_centers", "lojas", { ...base, name: "Lojas", code: "1", active: true, parentId: null, level: 1 });
  for (const key of ["loja-matriz", "loja-shopping"]) {
    const cc = refs.costCenters[key] ? await store.get("cost_centers", refs.costCenters[key].id) : null;
    if (cc && !cc.parentId) await store.update("cost_centers", cc.id, { parentId: lojas.id, level: 2 });
  }
  const fin = await refs.ctxFor("finance", "matriz");
  await createManualTitle(fin, {
    kind: "payable", partyType: "other", partyName: "Papelaria Central", description: "Material de escritório — resmas, toner e pastas", documentNumber: "NF 3321",
    issueDate: monthStart(t0), competenceDate: monthStart(t0), categoryId: office.id, costCenterId: refs.costCenters.adm?.id ?? null,
    installments: [{ amount: 38790, dueDate: addDays(monthStart(t0), 20) }], approved: true, idemKey: "demo-fase7-material-escritorio",
  });

  // 3) Arquivo CSV da adquirente de exemplo a partir dos recebíveis de cartão em aberto (créditos até hoje)
  const cardTitles = await listAll(store, "titles", { filters: [["eq", "companyId", companyId], ["eq", "originType", "sale_card"], ["eq", "status", ["open", "partial"]]] });
  const fees = await cardFeeByInstallment(store, cardTitles);
  const byTitle = new Map(cardTitles.map((t) => [t.id, t]));
  const open: Doc[] = [];
  for (let i = 0; i < cardTitles.length; i += 100) open.push(...(await listAll(store, "installments", { filters: [["eq", "titleId", cardTitles.slice(i, i + 100).map((t) => t.id)], ["eq", "status", "open"], ["lte", "dueDate", t0]] })));
  open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || String(a.id).localeCompare(String(b.id)));
  const pays = new Map<string, Doc>();
  for (const p of open.length ? await listAll(store, "sale_payments", { filters: [["eq", "titleId", [...new Set(open.map((i) => i.titleId))]]] }) : []) pays.set(p.titleId, p);
  const lines: string[] = [ACQUIRER_CSV_HEADER];
  const pick = open.filter((i) => pays.get(i.titleId)?.nsu).slice(0, 6);
  const brands = ["Visa", "Mastercard", "Elo"];
  pick.forEach((i, k) => {
    const t = byTitle.get(i.titleId)!;
    const p = pays.get(i.titleId)!;
    const expFee = fees.get(i.id) ?? 0;
    // linha 2: taxa cobrada 5 centavos acima da prevista (baixa com aviso); última: bruto divergente (não baixa)
    const gross = k === pick.length - 1 && pick.length > 2 ? i.balance + 150 : i.balance;
    const fee = k === 1 ? expFee + 5 : expFee;
    lines.push(acquirerCsvLine({ saleDate: t.issueDate, nsu: p.nsu, auth: p.authCode ?? "", brand: p.cardBrand ?? brands[k % brands.length], parcel: `${i.number}/${t.installmentsCount ?? 1}`, gross, fee, creditDate: i.dueDate }));
  });
  // venda que não existe no sistema (sem correspondência) e o rodapé de totais (ignorado)
  lines.push(acquirerCsvLine({ saleDate: addDays(t0, -3), nsu: "000999123", auth: "A1B2C3", brand: "Visa", parcel: "1/1", gross: 12990, fee: 388, creditDate: addDays(t0, -2) }));
  lines.push("Total;;;;;;;;");
  const csv = lines.join("\r\n") + "\r\n";
  let sampleId = await getSetting<string | null>(store, companyId, null, ACQUIRER_SAMPLE_KEY, null);
  if (!sampleId || !(await store.get("files", sampleId))) {
    const file = await saveFile(fin, { bucket: "attachments", name: "VENDAS-ADQUIRENTE-DEMO.csv", mime: "text/csv", data: Buffer.from(csv, "utf8"), entityType: "bank_import", entityId: `acquirer-sample:${companyId}`, kind: "acquirer_sample", branchId: null });
    sampleId = file.id;
    await setSetting(store, companyId, null, ACQUIRER_SAMPLE_KEY, sampleId);
  }

  await setSetting(store, companyId, null, "demo.financeManagement.done", true);
  return { feeTables: 2, acquirerSampleFileId: sampleId, acquirerLines: lines.length - 2 };
}
