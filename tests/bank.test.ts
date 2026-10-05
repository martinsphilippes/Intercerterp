import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import { detectFormat, parseBankFile, parseCnab240, parseCnab400, parseCsv, parseOfx, sniffCsv, parseDecimalToCents } from "@/domain/bank";
import { importBankFile, previewBankImport } from "@/domain/reconciliation";

const fx = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));

describe("leitores de arquivos bancários", () => {
  it("converte valores para centavos sem ponto flutuante", () => {
    expect(parseDecimalToCents("-4.500,00")).toBe(-450000);
    expect(parseDecimalToCents("1,234.56")).toBe(123456);
    expect(parseDecimalToCents("12.90")).toBe(1290);
    expect(parseDecimalToCents("0,1")).toBe(10);
    expect(parseDecimalToCents("(15,00)")).toBe(-1500);
    expect(parseDecimalToCents("abc")).toBeNull();
    expect(parseDecimalToCents("1.005", ".")).toBeNull(); // 3 casas significativas
  });

  it("OFX 1.x (SGML): transações, FITID, saldo e linha inválida reportada", () => {
    const text = fx("extrato-itau.ofx").toString("latin1");
    expect(detectFormat(text, "x.ofx")).toBe("ofx");
    const r = parseOfx(text);
    expect(r.bankCode).toBe("341");
    expect(r.layoutVersion).toBe("OFX 102");
    expect(r.transactions).toHaveLength(4);
    expect(r.transactions.map((t) => t.amount)).toEqual([-450000, 150000, -1290, 25000]);
    expect(r.transactions[0]).toMatchObject({ date: "2026-09-05", externalId: "202609050001", docNumber: "000123" });
    expect(r.transactions[3].description).toBe("PIX RECEBIDO — JOAO PEDRO LIMA");
    expect(r.balance).toEqual({ amount: 1234567, date: "2026-10-05" });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].status).toBe("invalid");
    expect(r.issues[0].lineNo).toBeGreaterThan(30);
    expect(r.issues[0].message).toMatch(/data inválida/);
  });

  it("OFX 2.x (XML) com elementos fechados", () => {
    const xml = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="211"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>237</BANKID><ACCTID>999</ACCTID></BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261002</DTPOSTED><TRNAMT>10.50</TRNAMT><FITID>A1</FITID><MEMO>Crédito</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = parseOfx(xml);
    expect(r.layoutVersion).toBe("OFX 211");
    expect(r.bankCode).toBe("237");
    expect(r.transactions).toEqual([expect.objectContaining({ amount: 1050, date: "2026-10-02", externalId: "A1", description: "Crédito" })]);
  });

  it("CSV: detecta cabeçalho, colunas débito/crédito, ignora saldo e reporta linha inválida", () => {
    const text = fx("extrato-bradesco.csv").toString("utf8");
    expect(detectFormat(text, "extrato.csv")).toBe("csv");
    const sn = sniffCsv(text);
    expect(sn.delimiter).toBe(";");
    expect(sn.header?.[1]).toBe("Histórico");
    expect(sn.guess).toMatchObject({ hasHeader: true, skipRows: 2, date: 0, description: 1, document: 2, signMode: "split", credit: 3, debit: 4, decimal: "," });
    const r = parseCsv(text, sn.guess);
    expect(r.transactions.map((t) => [t.lineNo, t.date, t.amount])).toEqual([
      [5, "2026-09-05", -450000],
      [6, "2026-09-10", 150000],
      [8, "2026-09-30", -1290],
      [9, "2026-09-30", -1290],
    ]);
    expect(r.transactions[0].docNumber).toBe("000123");
    expect(r.issues.map((i) => [i.lineNo, i.status])).toEqual([
      [4, "info"],
      [7, "invalid"],
    ]);
    // mapeamento manual: coluna única com sinal D/C
    const dc = "data,descricao,valor,dc\n2026-10-01,Tarifa,5.00,D\n2026-10-02,Deposito,100.00,C\n";
    const s2 = sniffCsv(dc);
    const r2 = parseCsv(dc, { ...s2.guess, signMode: "dc_column", amount: 2, dcColumn: 3, decimal: "." });
    expect(r2.transactions.map((t) => t.amount)).toEqual([-500, 10000]);
    expect(parseCsv(dc, { ...s2.guess, signMode: "dc_column", amount: 2, dcColumn: null }).fatal).toMatch(/D\/C/);
  });

  it("CNAB 240 FEBRABAN: T/U de liquidação, tarifa, ocorrência informativa, segmento não suportado e T sem U", () => {
    const text = fx("retorno-cobranca-bb.cnab240.ret").toString("latin1");
    expect(detectFormat(text, "ret.txt")).toBe("cnab240");
    const r = parseCnab240(text);
    expect(r.fatal).toBeFalsy();
    expect(r.bankCode).toBe("001");
    expect(r.layoutVersion).toBe("CNAB 240 v087");
    expect(r.kind).toBe("collection_return");
    const liq = r.transactions.find((t) => t.kind === "collection")!;
    expect(liq).toMatchObject({ lineNo: 3, occurrence: "06", ourNumber: "12345", yourNumber: "900/1", titleAmount: 15000, paidAmount: 15300, interest: 300, discount: 0, fee: 250, amount: 15050, date: "2026-10-05", dueDate: "2026-10-01" });
    const fee = r.transactions.find((t) => t.kind === "collection_fee")!;
    expect(fee).toMatchObject({ lineNo: 7, amount: -180, occurrence: "28" });
    const st = (s: string) => r.issues.filter((i) => i.status === s).map((i) => i.lineNo);
    expect(st("info")).toContain(5); // entrada confirmada
    expect(st("unsupported")).toEqual([9]); // segmento Y
    expect(st("invalid")).toEqual([10]); // T sem U
    // remessa é rejeitada por inteiro
    const remessa = text.split("\r\n").map((l, i) => (i === 0 ? l.slice(0, 142) + "1" + l.slice(143) : l)).join("\r\n");
    expect(parseCnab240(remessa).fatal).toMatch(/REMESSA/);
  });

  it("CNAB 400: Itaú e Bradesco suportados; outro banco listado como não suportado", () => {
    const itau = parseCnab400(fx("retorno-cobranca-itau.cnab400.ret").toString("latin1"));
    expect(itau.bankCode).toBe("341");
    expect(itau.layoutVersion).toMatch(/Itaú/);
    expect(itau.transactions.filter((t) => t.kind === "collection")).toEqual([
      expect.objectContaining({ lineNo: 2, ourNumber: "54321", yourNumber: "901/1", paidAmount: 19500, discount: 500, fee: 180, amount: 19320, date: "2026-10-05", payerName: "ESCOLA SABER MAIS LTDA" }),
    ]);
    expect(itau.transactions.filter((t) => t.kind === "collection_fee")).toEqual([expect.objectContaining({ lineNo: 4, amount: -350 })]);
    expect(itau.issues.map((i) => [i.lineNo, i.status])).toEqual([
      [3, "info"],
      [5, "unsupported"],
      [6, "invalid"],
    ]);
    const brad = parseCnab400(fx("retorno-cobranca-bradesco.cnab400.ret").toString("latin1"));
    expect(brad.bankCode).toBe("237");
    expect(brad.transactions).toEqual([expect.objectContaining({ ourNumber: "77777", yourNumber: "902/2", paidAmount: 10100, interest: 100, fee: 150, amount: 9950 })]);
    expect(brad.issues).toEqual([expect.objectContaining({ lineNo: 3, status: "info" })]);
    const san = parseCnab400(fx("retorno-cobranca-santander.cnab400.ret").toString("latin1"));
    expect(san.bankCode).toBe("033");
    expect(san.transactions).toHaveLength(0);
    expect(san.issues).toEqual([expect.objectContaining({ lineNo: 2, status: "unsupported" })]);
    expect(san.layoutVersion).toMatch(/não suportado/);
  });

  it("decodifica Latin-1 (Windows-1252) quando o arquivo não é UTF-8", () => {
    const latin = Buffer.from("Data;Histórico;Valor\n01/10/2026;Depósito em espécie;10,00\n", "latin1");
    const { result } = parseBankFile(latin, "x.csv");
    expect(result.transactions[0].description).toBe("Depósito em espécie");
  });
});

describe("importação de extrato/retorno", () => {
  let refs: DemoRefs;
  beforeAll(async () => {
    const store = freshStore();
    refs = await seedBase(store);
  });

  it("importação repetida não duplica (arquivo e transações) e arquivo sobreposto só traz as novas", async () => {
    const ctx = await refs.ctxFor("finance", "matriz");
    const store = ctx.store;
    const acc = refs.accounts.banco;
    const data = fx("extrato-itau.ofx");
    const pv = await previewBankImport(ctx, { accountId: acc.id, fileName: "extrato-itau.ofx", data });
    expect(pv.newCount).toBe(4);
    expect(pv.alreadyImported).toBeNull();
    const r1 = await importBankFile(ctx, { accountId: acc.id, fileName: "extrato-itau.ofx", data });
    expect(r1.alreadyImported).toBe(false);
    expect(r1.import.summary).toMatchObject({ created: 4, duplicates: 0, invalid: 1, bankCode: "341" });
    expect(r1.import.lineResults.find((l: any) => l.status === "invalid").line).toBeGreaterThan(30);
    const r2 = await importBankFile(ctx, { accountId: acc.id, fileName: "copia.ofx", data });
    expect(r2.alreadyImported).toBe(true);
    expect(r2.import.id).toBe(r1.import.id);
    expect((await listAll(store, "bank_transactions", { filters: [["eq", "accountId", acc.id]] })).length).toBe(4);
    // arquivo diferente com período sobreposto: FITIDs repetidos não duplicam
    const extra = data.toString("latin1").replace("</BANKTRANLIST>", "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261004<TRNAMT>-99.00<FITID>202610040009<MEMO>NOVA</STMTTRN></BANKTRANLIST>");
    const pv2 = await previewBankImport(ctx, { accountId: acc.id, fileName: "ext2.ofx", data: Buffer.from(extra, "latin1") });
    expect(pv2.duplicateCount).toBe(4);
    expect(pv2.newCount).toBe(1);
    const r3 = await importBankFile(ctx, { accountId: acc.id, fileName: "ext2.ofx", data: Buffer.from(extra, "latin1") });
    expect(r3.import.summary).toMatchObject({ created: 1, duplicates: 4 });
    expect((await listAll(store, "bank_transactions", { filters: [["eq", "accountId", acc.id]] })).length).toBe(5);
    // CSV: duas tarifas iguais no mesmo dia são transações distintas (ordem), reimportação não duplica
    const csv = fx("extrato-bradesco.csv");
    const c1 = await importBankFile(ctx, { accountId: refs.accounts.pix.id, fileName: "a.csv", data: csv });
    expect(c1.import.summary).toMatchObject({ created: 4, invalid: 1, info: 1 });
    const c2 = await importBankFile(ctx, { accountId: refs.accounts.pix.id, fileName: "b.csv", data: Buffer.concat([csv, Buffer.from("\n")]) });
    expect(c2.import.summary).toMatchObject({ created: 0, duplicates: 4 });
  });

  it("retorno CNAB de banco diferente da conta é recusado; retorno sem movimento lista ocorrências", async () => {
    const ctx = await refs.ctxFor("finance", "matriz");
    await expect(importBankFile(ctx, { accountId: refs.accounts.banco.id, fileName: "bb.ret", data: fx("retorno-cobranca-bb.cnab240.ret") })).rejects.toThrow(/banco 001/);
    const r = await importBankFile(ctx, { accountId: refs.accounts.banco.id, fileName: "itau.ret", data: fx("retorno-cobranca-itau.cnab400.ret") });
    expect(r.import.kind).toBe("collection_return");
    expect(r.import.summary).toMatchObject({ created: 2, unsupported: 1, invalid: 1, info: 1 });
    const txs = await listAll(ctx.store, "bank_transactions", { filters: [["eq", "importId", r.import.id]] });
    expect(txs.map((t) => t.kind).sort()).toEqual(["collection", "collection_fee"]);
  });
});
