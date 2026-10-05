import { listAll } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import { getSetting, setSetting } from "@/lib/core/settings";
import type { DemoRefs } from "../base";
import { accountBalanceAt, cardFeeByInstallment, createManualTitle, updateInstallment } from "../../finance";
import { importBankFile, reconcile } from "../../reconciliation";
import { settleCardReceivable } from "../../sales";

/**
 * Demonstração do Financeiro (idempotente — ids determinísticos e marcador "demo.finance.done"):
 *  - título a receber manual vencido (aparece em vencidos, fluxo e notificações);
 *  - boleto a receber com nosso número + retorno CNAB 400 (Itaú) de liquidação para baixar a partir do retorno;
 *  - extrato OFX do "Banco Itaú" com linhas que casam com os pagamentos de despesas + tarifa bancária + crédito sem correspondência;
 *  - uma conciliação já confirmada (as demais ficam como sugestão para o usuário confirmar);
 *  - liquidação dos recebíveis de cartão antigos (os recentes ficam em aberto).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const companyId = refs.company.id;
  if (await getSetting(store, companyId, null, "demo.finance.done", false)) return { skipped: true };
  const ctx = await refs.ctxFor("finance", "matriz");
  const bank = refs.accounts.banco;
  const t0 = today();

  // 1) Título manual vencido
  const overdue = await createManualTitle(ctx, {
    kind: "receivable", partyType: "customer", partyId: refs.customers.escola.id, description: "Consultoria de imagem — treinamento da equipe comercial", documentNumber: "RPS 118",
    issueDate: addDays(t0, -40), competenceDate: addDays(t0, -40), categoryId: refs.finCategories.servicos.id, costCenterId: refs.costCenters["loja-matriz"].id,
    installments: [{ amount: 180000, dueDate: addDays(t0, -12) }], notes: "Demonstração: título vencido sem pagamento.", idemKey: "demo-fin-overdue",
  });

  // 2) Boleto com nosso número + retorno CNAB 400 Itaú liquidando-o
  const boleto = await createManualTitle(ctx, {
    kind: "receivable", partyType: "customer", partyId: refs.customers.mercado.id, description: "Uniformes personalizados — pedido corporativo", documentNumber: "BOL-0042",
    issueDate: addDays(t0, -20), competenceDate: addDays(t0, -20), categoryId: refs.finCategories.vendas.id, costCenterId: refs.costCenters["loja-matriz"].id,
    installments: [{ amount: 64000, dueDate: addDays(t0, -3), methodKind: "boleto" }], idemKey: "demo-fin-boleto",
  });
  const [bInst] = await listAll(store, "installments", { filters: [["eq", "titleId", boleto.id]] });
  if (!bInst.ourNumber) await updateInstallment(ctx, bInst.id, { ourNumber: "70042" });
  const cnab = cnab400Itau({ date: addDays(t0, -1), ourNumber: "70042", yourNumber: `${boleto.number}/1`, dueDate: bInst.dueDate, amount: 64000, paid: 65280, interest: 1280, fee: 245, payer: "MERCADINHO BOM PRECO EIRELI" });
  const cnabImp = await importBankFile(ctx, { accountId: bank.id, fileName: "RETORNO-ITAU-DEMO.RET", data: Buffer.from(cnab, "latin1"), mime: "text/plain" });

  // 3) Extrato OFX do Banco Itaú: pagamentos das despesas + tarifa + crédito sem correspondência
  const pays = (await listAll(store, "settlements", { filters: [["eq", "companyId", companyId], ["eq", "accountId", bank.id], ["eq", "status", "active"]] }))
    .filter((s) => String(s.idemKey).startsWith("demo-exp-pay-"))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.idemKey).localeCompare(String(b.idemKey)));
  const entries = await Promise.all(pays.map((p) => store.getOrThrow("account_entries", p.accountEntryId)));
  const lines = entries.map((e, i) => ({ date: e.date as string, amount: e.amount as number, fitid: `DEMO${String(i + 1).padStart(4, "0")}`, memo: memoFor(e.description), doc: null as string | null }));
  const lastDate = lines.length ? lines[lines.length - 1].date : addDays(t0, -2);
  lines.push({ date: lastDate, amount: -3990, fitid: "DEMO9001", memo: "TARIFA PACOTE DE SERVICOS", doc: null });
  lines.push({ date: lastDate, amount: 25000, fitid: "DEMO9002", memo: "TED RECEBIDA 0341 JOAO P LIMA", doc: "778812" });
  const erp = await accountBalanceAt(store, bank.id, lastDate);
  const ofx = ofxText(lines, { from: lines[0]?.date ?? lastDate, to: lastDate, balance: erp - 3990 + 25000 });
  const ofxImp = await importBankFile(ctx, { accountId: bank.id, fileName: "EXTRATO-ITAU-DEMO.ofx", data: Buffer.from(ofx, "latin1"), mime: "application/x-ofx" });

  // 4) Uma conciliação confirmada (a mais antiga); as demais ficam como sugestões
  let reconciled = 0;
  const firstTx = (await listAll(store, "bank_transactions", { filters: [["eq", "accountId", bank.id], ["eq", "externalId", "DEMO0001"]] }))[0];
  if (firstTx && firstTx.status === "pending" && entries[0] && !entries[0].reconciled) {
    await reconcile(ctx, { accountId: bank.id, bankTxIds: [firstTx.id], entryIds: [entries[0].id], idemKey: "demo-recon-1", notes: "Conciliação de demonstração" });
    reconciled++;
  }

  // 5) Recebíveis de cartão antigos liquidados (com taxa prevista), recentes ficam em aberto
  const cardTitles = await listAll(store, "titles", { filters: [["eq", "companyId", companyId], ["eq", "originType", "sale_card"], ["eq", "status", ["open", "partial"]]] });
  const fees = await cardFeeByInstallment(store, cardTitles);
  let cards = 0;
  const due = (await listAll(store, "installments", { filters: [["eq", "companyId", companyId], ["eq", "kind", "receivable"], ["eq", "status", "open"], ["lt", "dueDate", addDays(t0, -2)]] }))
    .filter((i) => cardTitles.some((t) => t.id === i.titleId))
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
    .slice(0, 60);
  for (const i of due) {
    const branchKey = Object.entries(refs.branches).find(([, b]) => b.id === i.branchId)?.[0] ?? "matriz";
    const c = await refs.ctxFor("finance", branchKey);
    await settleCardReceivable(c, { installmentId: i.id, accountId: bank.id, date: i.dueDate, fee: fees.get(i.id) ?? 0, reference: `LOTE-${i.dueDate.replace(/-/g, "")}` });
    cards++;
  }

  await setSetting(store, companyId, null, "demo.finance.done", true);
  return { overdueTitle: overdue.number, boletoTitle: boleto.number, cnabImport: cnabImp.import.id, ofxImport: ofxImp.import.id, reconciled, cardsSettled: cards };
}

function memoFor(desc: string) {
  const d = desc.toUpperCase();
  if (d.includes("ALUGUEL")) return "PAGTO BOLETO IMOBILIARIA CENTRAL";
  if (d.includes("ENERGIA")) return "DEB AUTOMATICO CONCESSIONARIA ENERGIA";
  if (d.includes("DAS")) return "PAGTO DAS SIMPLES NACIONAL RFB";
  return d.normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 60);
}

function ofxText(lines: Array<{ date: string; amount: number; fitid: string; memo: string; doc: string | null }>, opts: { from: string; to: string; balance: number }) {
  const amt = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
  const d = (s: string) => s.replace(/-/g, "");
  const tx = lines
    .map((l) => `<STMTTRN>\r\n<TRNTYPE>${l.amount < 0 ? "DEBIT" : "CREDIT"}\r\n<DTPOSTED>${d(l.date)}120000[-3:BRT]\r\n<TRNAMT>${amt(l.amount)}\r\n<FITID>${l.fitid}\r\n${l.doc ? `<CHECKNUM>${l.doc}\r\n` : ""}<MEMO>${l.memo}\r\n</STMTTRN>`)
    .join("\r\n");
  return [
    "OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "SECURITY:NONE", "ENCODING:USASCII", "CHARSET:1252", "COMPRESSION:NONE", "OLDFILEUID:NONE", "NEWFILEUID:NONE", "",
    "<OFX>", "<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>",
    "<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL",
    "<BANKACCTFROM><BANKID>0341<BRANCHID>0001<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>",
    `<BANKTRANLIST><DTSTART>${d(opts.from)}<DTEND>${d(opts.to)}`, tx, "</BANKTRANLIST>",
    `<LEDGERBAL><BALAMT>${amt(opts.balance)}<DTASOF>${d(opts.to)}</LEDGERBAL>`, "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>", "",
  ].join("\r\n");
}

/** Retorno CNAB 400 Itaú mínimo (header, 1 liquidação, trailer) para a demonstração. */
function cnab400Itau(o: { date: string; ourNumber: string; yourNumber: string; dueDate: string; amount: number; paid: number; interest: number; fee: number; payer: string }) {
  const put = (b: string[], from: number, to: number, v: string, num = false) => {
    const n = to - from + 1;
    const val = num ? v.padStart(n, "0").slice(-n) : v.padEnd(n, " ").slice(0, n);
    for (let i = 0; i < n; i++) b[from - 1 + i] = val[i];
  };
  const ddmmaa = (s: string) => `${s.slice(8, 10)}${s.slice(5, 7)}${s.slice(2, 4)}`;
  const h = Array(400).fill(" ");
  put(h, 1, 1, "0");
  put(h, 2, 2, "2");
  put(h, 3, 9, "RETORNO");
  put(h, 10, 11, "01");
  put(h, 12, 26, "COBRANCA");
  put(h, 27, 30, "0001", true);
  put(h, 33, 37, "12345", true);
  put(h, 38, 38, "6");
  put(h, 47, 76, "INTERCERT COMERCIO VAREJISTA");
  put(h, 77, 79, "341");
  put(h, 80, 94, "BANCO ITAU SA");
  put(h, 95, 100, ddmmaa(o.date));
  put(h, 395, 400, "1", true);
  const d = Array(400).fill(" ");
  put(d, 1, 1, "1");
  put(d, 2, 3, "02");
  put(d, 4, 17, "11222333000181");
  put(d, 18, 21, "0001", true);
  put(d, 24, 28, "12345", true);
  put(d, 29, 29, "6");
  put(d, 63, 70, o.ourNumber, true);
  put(d, 83, 85, "109");
  put(d, 86, 93, o.ourNumber, true);
  put(d, 108, 108, "I");
  put(d, 109, 110, "06");
  put(d, 111, 116, ddmmaa(o.date));
  put(d, 117, 126, o.yourNumber);
  put(d, 127, 134, o.ourNumber, true);
  put(d, 147, 152, ddmmaa(o.dueDate));
  put(d, 153, 165, String(o.amount), true);
  put(d, 166, 168, "341");
  put(d, 176, 188, String(o.fee), true);
  for (const [a, b] of [[215, 227], [228, 240], [241, 253], [280, 292], [312, 324]] as const) put(d, a, b, "0", true);
  put(d, 254, 266, String(o.paid), true);
  put(d, 267, 279, String(o.interest), true);
  put(d, 296, 301, ddmmaa(o.date));
  put(d, 325, 354, o.payer);
  put(d, 395, 400, "2", true);
  const t = Array(400).fill(" ");
  put(t, 1, 1, "9");
  put(t, 2, 2, "2");
  put(t, 3, 4, "01");
  put(t, 5, 7, "341");
  put(t, 395, 400, "3", true);
  return [h.join(""), d.join(""), t.join("")].join("\r\n") + "\r\n";
}
