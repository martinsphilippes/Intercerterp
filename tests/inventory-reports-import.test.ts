import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import { addDays, toLocalDate, today } from "@/lib/dates";
import { QTY, roundDiv } from "@/lib/money";
import { balanceId, postMovements } from "@/domain/stock";
import { compareWithCurrent, fiscalInventory } from "@/domain/inventory-fiscal";
import { getExport, toCsv, toXlsx, exportFormat, type ExportColumn } from "@/lib/exporters";
import { buildXlsx, colLetter, excelDate, sheetName } from "@/lib/xlsx";
import { analyzeCsvFor, guessMappingFor, parseCsv as engineParseCsv } from "@/domain/csv-import";
import { analyzeCsv, guessMapping, IMPORT_FIELDS, MAX_IMPORT_ROWS, parseCsv, previewImport, runImport } from "@/domain/product-import";
import { analyzeDataCsv, dataImportDef, DATA_IMPORTS, previewDataImport, runDataImport, IMPORT_BATCH_SIZE } from "@/domain/data-import";
import { REPORT_CATALOG, visibleReports } from "@/lib/report-catalog";
import type { SessionInfo } from "@/lib/server/session";
import type { Ctx } from "@/lib/core/ctx";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// exportadores que carregam no ambiente de teste (vendas e caixa importam componentes .tsx)
import "@/exports/stock";
import "@/exports/customers";
import "@/exports/suppliers";
import "@/exports/products";

/** Chaves de todas as exportações registradas em src/exports (lidas do código-fonte). */
function exportKeysInSource(): Set<string> {
  const dir = path.resolve(__dirname, "../src/exports");
  const keys = new Set<string>();
  for (const f of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, f), "utf8");
    for (const m of text.matchAll(/defineExport\(\s*"([^"]+)"/g)) keys.add(m[1]);
    if (text.includes("defineExport(`fiscal-${model}`")) for (const m of ["nfe", "nfce", "nfse"]) keys.add(`fiscal-${m}`);
  }
  return keys;
}

async function setup() {
  const store = freshStore();
  const refs = await seedBase(store);
  const admin = await refs.ctxFor("admin", "matriz");
  return { store, refs, admin };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const localDaysAgo = (n: number) => toLocalDate(new Date(Date.now() - n * 86400000));
const session = (ctx: Ctx): SessionInfo => ({ ctx, user: ctx.user as any, company: { id: ctx.companyId, name: "Demo" }, branch: null, companies: [], branches: [], consolidated: false, canConsolidate: true });

// ───────────────────────────── EST-05 — inventário em data-base

describe("inventário em data-base (EST-05)", () => {
  it("reconstrói saldo e custo médio numa data passada e confere com o saldo atual hoje", async () => {
    const { store, refs, admin } = await setup();
    const sku = refs.skus["caderno-u"];
    const wh = refs.warehouses["matriz-main"];
    // semeado há 70 dias: 60 un a R$ 9,90. Compra há 30 dias: +40 a R$ 12,90. Venda hoje: −10.
    await postMovements(admin, [{ warehouseId: wh.id, skuId: sku.id, qty: 40 * QTY, type: "purchase", unitCost: 1290, originType: "test", idemKey: "t-purchase", occurredAt: daysAgo(30) }]);
    await postMovements(admin, [{ warehouseId: wh.id, skuId: sku.id, qty: -10 * QTY, type: "sale", originType: "test", idemKey: "t-sale" }]);
    const branchIds = [refs.branches.matriz.id];
    const row = (res: Awaited<ReturnType<typeof fiscalInventory>>) => res.rows.find((r) => r.balanceId === balanceId(wh.id, sku.id));

    const before = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(100), branchIds });
    expect(row(before)).toBeUndefined(); // antes do saldo inicial

    const d50 = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(50), branchIds });
    expect(row(d50)).toMatchObject({ qty: 60 * QTY, avgCost: 990, value: 59400, ncm: "48202000", categoryName: "Papelaria" });

    const d10 = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(10), branchIds });
    const avg = roundDiv(60 * QTY * 990 + 40 * QTY * 1290, 100 * QTY); // 1110
    expect(row(d10)).toMatchObject({ qty: 100 * QTY, avgCost: avg, value: 100 * avg });

    const now = await fiscalInventory(store, admin.companyId, { date: today(), branchIds });
    expect(row(now)).toMatchObject({ qty: 90 * QTY, avgCost: avg, value: 90 * avg });
    // hoje = saldo atual em TODOS os SKU × depósito da filial
    const bals = (await listAll(store, "stock_balances", { filters: [["eq", "branchId", refs.branches.matriz.id]] })).filter((b) => b.physical !== 0);
    expect(now.rows.length).toBe(bals.length);
    for (const b of bals) {
      const r = now.rows.find((x) => x.balanceId === b.id)!;
      expect(r.qty).toBe(b.physical);
      expect(r.avgCost).toBe(b.avgCost);
      expect(r.value).toBe(roundDiv(b.physical * b.avgCost, QTY));
    }
    expect(now.totals.value).toBe(bals.reduce((a, b) => a + roundDiv(b.physical * b.avgCost, QTY), 0));
    const conf = await compareWithCurrent(store, admin.companyId, { branchIds: null });
    expect(conf.ok).toBe(true);
    expect(conf.checked).toBeGreaterThan(0);

    // totais por NCM e por categoria fecham com o total
    expect(now.byNcm.reduce((a, g) => a + g.value, 0)).toBe(now.totals.value);
    expect(now.byCategory.reduce((a, g) => a + g.value, 0)).toBe(now.totals.value);
    // filtros: NCM (prefixo) e categoria
    const papel = await fiscalInventory(store, admin.companyId, { date: today(), branchIds, ncm: "4820" });
    expect(papel.rows.every((r) => r.ncm.startsWith("4820"))).toBe(true);
    expect(papel.rows.length).toBe(1);
    const cat = await fiscalInventory(store, admin.companyId, { date: today(), branchIds, categoryId: refs.categories["Papelaria"].id });
    expect(cat.rows.every((r) => r.categoryName === "Papelaria")).toBe(true);
    // data futura é recusada
    await expect(fiscalInventory(store, admin.companyId, { date: addDays(today(), 1), branchIds })).rejects.toThrow(/futura/);
  });

  it("movimento com data retroativa entra pela soma e a exportação usa os mesmos parâmetros da tela", async () => {
    const { store, refs, admin } = await setup();
    const sku = refs.skus["caneca-u"];
    const wh = refs.warehouses["matriz-main"];
    // lançado agora com data de 40 dias atrás (carga histórica): conta para datas ≥ 40 dias atrás
    await postMovements(admin, [{ warehouseId: wh.id, skuId: sku.id, qty: -5 * QTY, type: "loss", originType: "test", idemKey: "t-loss", occurredAt: daysAgo(40) }]);
    const branchIds = [refs.branches.matriz.id];
    const d60 = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(60), branchIds });
    const d30 = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(30), branchIds });
    const bid = balanceId(wh.id, sku.id);
    expect(d60.rows.find((r) => r.balanceId === bid)!.qty).toBe(20 * QTY);
    expect(d30.rows.find((r) => r.balanceId === bid)!.qty).toBe(15 * QTY);

    const def = getExport("stock-fiscal-inventory")!;
    expect(def.module).toBe("stock");
    const rows = await def.rows(session(admin), { data: localDaysAgo(30), ncm: "69120000" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 15 * QTY, ncm: "69120000", date: localDaysAgo(30) });
    const csv = toCsv(def.columns, rows);
    expect(csv).toContain("Caneca Cerâmica 350 ml");
    expect(csv).toContain(";15;");
  });
});

// ───────────────────────────── PLA-11 — XLSX

describe("exportação XLSX (PLA-11)", () => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

  it("gera um pacote OOXML válido com tipos de célula corretos", async () => {
    const cols: ExportColumn[] = [
      { key: "name", label: "Nome" },
      { key: "price", label: "Preço", type: "money" },
      { key: "qty", label: "Quantidade", type: "qty" },
      { key: "when", label: "Data", type: "date" },
      { key: "at", label: "Quando", type: "datetime" },
    ];
    const rows = [
      { name: "=HYPERLINK(\"x\")", price: 123456, qty: 2500, when: "2026-01-31", at: "2026-01-31T15:00:00.000Z" },
      { name: "Café & Cia <teste>", price: -50, qty: null, when: null, at: null },
    ];
    const bin = await toXlsx("Relatório: teste/1", cols, rows);
    const zip = await JSZip.loadAsync(bin);
    for (const f of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) expect(zip.file(f), f).toBeTruthy();
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
    const wb = parser.parse(await zip.file("xl/workbook.xml")!.async("string"));
    expect(wb.workbook.sheets.sheet["@name"]).toBe("Relatório teste 1");
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const ws = parser.parse(sheetXml);
    const rowsXml = ws.worksheet.sheetData.row;
    expect(rowsXml).toHaveLength(3);
    const header = rowsXml[0].c.map((c: any) => c.is.t["#text"] ?? c.is.t);
    expect(header).toEqual(["Nome", "Preço", "Quantidade", "Data", "Quando"]);
    const r1 = rowsXml[1].c;
    expect(r1[0]["@t"]).toBe("inlineStr"); // fórmula vira texto
    expect(r1[0].is.t["#text"] ?? r1[0].is.t).toBe('=HYPERLINK("x")');
    expect(r1[1]).toMatchObject({ "@r": "B2", "@s": "2", v: 1234.56 });
    expect(r1[2]).toMatchObject({ "@r": "C2", v: 2.5 });
    expect(r1[3]).toMatchObject({ "@r": "D2", "@s": "3", v: excelDate("2026-01-31") });
    expect(r1[4]["@s"]).toBe("4");
    expect(sheetXml).toContain("Café &amp; Cia &lt;teste&gt;");
    expect(ws.worksheet.autoFilter["@ref"]).toBe("A1:E3");
    expect(rowsXml[2].c).toHaveLength(2); // vazios não geram célula
    expect(rowsXml[2].c[1]).toMatchObject({ v: -0.5 });
  });

  it("utilitários: colunas, nome de aba, várias abas e formato pedido", async () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(701)).toBe("ZZ");
    const used = new Set<string>();
    expect(sheetName("Inventário em data-base: 31/12/2025 [geral]", used).length).toBeLessThanOrEqual(31);
    expect(sheetName("A", used)).toBe("A");
    expect(sheetName("a", used)).toBe("a (2)");
    expect(excelDate("1900-03-01")).toBe(61);
    const zip = await JSZip.loadAsync(await buildXlsx([{ name: "Um", columns: [{ label: "x" }], rows: [["1"]] }, { name: "Dois", columns: [{ label: "y", kind: "number" }], rows: [[2]] }]));
    expect(zip.file("xl/worksheets/sheet2.xml")).toBeTruthy();
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    expect(rels).toContain("worksheets/sheet2.xml");
    expect(rels).toContain("styles.xml");
    expect(exportFormat("XLSX")).toBe("xlsx");
    expect(exportFormat(undefined)).toBe("csv");
    expect(exportFormat("pdf")).toBe("csv");
  });

  it("XLSX de uma exportação existente tem as mesmas linhas do CSV", async () => {
    const { admin } = await setup();
    const def = getExport("customers")!;
    const rows = await def.rows(session(admin), {});
    const csvLines = toCsv(def.columns, rows).split("\r\n");
    const zip = await JSZip.loadAsync(await toXlsx(def.title, def.columns, rows));
    const ws = parser.parse(await zip.file("xl/worksheets/sheet1.xml")!.async("string"));
    const xr = Array.isArray(ws.worksheet.sheetData.row) ? ws.worksheet.sheetData.row : [ws.worksheet.sheetData.row];
    expect(xr.length).toBe(csvLines.length);
  });
});

// ───────────────────────────── PLA-09 — central de relatórios

describe("central de relatórios (PLA-09)", () => {
  it("lista os relatórios por área respeitando permissões e recursos", async () => {
    const { refs } = await setup();
    const keys = new Set(REPORT_CATALOG.map((r) => r.key));
    expect(keys.size).toBe(REPORT_CATALOG.length);
    // toda exportação citada existe no registro
    const known = exportKeysInSource();
    expect(known.has("stock-fiscal-inventory")).toBe(true);
    for (const r of REPORT_CATALOG) for (const e of r.exports ?? []) expect(known.has(e), `${r.key} → ${e}`).toBe(true);
    const admin = await refs.ctxFor("admin", "matriz");
    const cashier = await refs.ctxFor("cashier", "matriz");
    const all = visibleReports(admin.user, () => true);
    expect(all.some((r) => r.key === "inventario-fiscal")).toBe(true);
    expect(all.some((r) => r.href.startsWith("/financeiro"))).toBe(true);
    const off = visibleReports(admin.user, (f) => f !== "inventarioFiscal");
    expect(off.some((r) => r.key === "inventario-fiscal")).toBe(false);
    const few = visibleReports(cashier.user, () => true);
    expect(few.some((r) => r.href.startsWith("/financeiro"))).toBe(false);
    expect(few.length).toBeLessThan(all.length);
  });
});

// ───────────────────────────── PLA-19 — importação de cadastros e saldos

describe("importação de cadastros e saldos (PLA-19)", () => {
  const map = (kind: any, text: string) => analyzeDataCsv(kind, text).mapping;

  it("clientes: prévia com erros por linha, importação e reimportação idempotente", async () => {
    const { store, admin } = await setup();
    const csv = [
      "Tipo;CPF/CNPJ;Nome;E-mail;Celular;Nascimento;CEP;Logradouro;Número;Bairro;Cidade;UF;Limite de crédito",
      "PF;529.982.247-25;Maria Repetida;;;;;;;;;;", // já existe (seed)
      "PF;935.411.347-80;Paulo Novo;paulo@ex.com;(11) 91234-5678;10/05/1990;01310-100;Av. Paulista;1000;Bela Vista;São Paulo;SP;300,00",
      "PF;123.456.789-00;CPF Inválido;;;;;;;;;;",
      "PJ;;Empresa Sem CNPJ;;;;;;;;;;",
      ";;;;;;;;;;;;", // vazia: ignorada pelo leitor
      "PF;;Sem Documento;email-ruim;;31/02/1990;;;;;;XX;",
      "PF;935.411.347-80;Paulo Duplicado;;;;;;;;;;",
      "PJ;11.444.777/0001-61;Papelaria Modelo Ltda;compras@modelo.com.br;;;;;;;;;",
    ].join("\n");
    const mapping = map("customers", csv);
    expect(Object.values(mapping)).toEqual(expect.arrayContaining(["personType", "doc", "name", "email", "mobile", "birthDate", "zip", "street", "number", "district", "cityName", "uf", "creditLimit"]));
    const prev = await previewDataImport(admin, { kind: "customers", text: csv, mapping });
    const by = (line: number) => prev.results.find((r) => r.line === line)!;
    expect(by(2).action).toBe("skip");
    expect(by(3).action).toBe("create");
    expect(by(4).action).toBe("error");
    expect(by(4).messages.join(" ")).toMatch(/CPF .* inválido/);
    expect(by(5).action).toBe("create");
    expect(by(5).messages.join(" ")).toMatch(/rascunho/);
    expect(by(6).action).toBe("error"); // e-mail, data e UF inválidos
    expect(by(6).messages.length).toBe(3);
    expect(by(7).action).toBe("error"); // repetida no arquivo
    expect(by(7).messages.join(" ")).toMatch(/repetida/);
    expect(by(8).action).toBe("create");
    expect(prev.totals).toMatchObject({ rows: 7, create: 3, skip: 1, error: 3 });
    expect(await listAll(store, "customers", { filters: [["eq", "doc", "93541134780"]] })).toHaveLength(0); // prévia não grava

    const res = await runDataImport(admin, { kind: "customers", text: csv, mapping, fileName: "clientes.csv", idemKey: "cli-1" });
    expect(res.status).toBe("completed");
    expect(res.kind).toBe("customers");
    expect(res.totals).toMatchObject({ create: 3, skip: 1, error: 3 });
    const paulo = (await listAll(store, "customers", { filters: [["eq", "doc", "93541134780"]] }))[0];
    expect(paulo).toMatchObject({ name: "Paulo Novo", email: "paulo@ex.com", mobile: "11912345678", birthDate: "1990-05-10", creditLimit: 30000, status: "active" });
    expect(paulo.addresses[0]).toMatchObject({ zip: "01310100", street: "Av. Paulista", uf: "SP" });
    const draft = (await listAll(store, "customers", { filters: [["eq", "name", "Empresa Sem CNPJ"]] }))[0];
    expect(draft.status).toBe("draft");

    // reenvio do mesmo lote: devolve o mesmo registro
    const again = await runDataImport(admin, { kind: "customers", text: csv, mapping, fileName: "clientes.csv", idemKey: "cli-1" });
    expect(again.id).toBe(res.id);
    // reimportação do arquivo (novo lote): nada é duplicado
    const re = await runDataImport(admin, { kind: "customers", text: csv, mapping, fileName: "clientes.csv", idemKey: "cli-2" });
    expect(re.totals).toMatchObject({ create: 0, skip: 4, error: 3 });
    expect(await listAll(store, "customers", { filters: [["eq", "doc", "93541134780"]] })).toHaveLength(1);
    expect(await listAll(store, "customers", { filters: [["eq", "name", "Empresa Sem CNPJ"]] })).toHaveLength(1);
    // as importações de cadastros não aparecem como importação de produtos
    expect(await listAll(store, "product_imports", { filters: [["isNull", "kind"]] })).toHaveLength(0);
  });

  it("fornecedores: cria, recusa documento inválido e permissão de administrador", async () => {
    const { store, refs, admin } = await setup();
    const csv = ["Razão social;CNPJ;Fantasia;Categoria;Prazo de entrega;Condição de pagamento", "Distribuidora Exemplo S.A.;11.222.333/0001-81;Exemplo;Mercadorias;7;28 dias", "Têxtil Paulista Indústria Ltda;45.997.418/0001-53;;;;", "Fornecedor Ruim;11.111.111/1111-11;;;;", "Sem Documento Ltda;;;;abc;"].join("\n");
    const mapping = map("suppliers", csv);
    const prev = await previewDataImport(admin, { kind: "suppliers", text: csv, mapping });
    expect(prev.results.map((r) => r.action)).toEqual(["create", "skip", "error", "error"]);
    const res = await runDataImport(admin, { kind: "suppliers", text: csv, mapping, fileName: "fornecedores.csv", idemKey: "for-1" });
    expect(res.totals).toMatchObject({ create: 1, skip: 1, error: 2 });
    const s = (await listAll(store, "suppliers", { filters: [["eq", "doc", "11222333000181"]] }))[0];
    expect(s).toMatchObject({ tradeName: "Exemplo", category: "Mercadorias", leadTimeDays: 7, paymentTermsText: "28 dias", status: "active" });
    // gerente (Administração somente leitura) não importa
    const manager = await refs.ctxFor("manager", "matriz");
    await expect(previewDataImport(manager, { kind: "suppliers", text: csv, mapping })).rejects.toThrow();
  });

  it("saldos iniciais de estoque: movimento 'initial' com custo e data, idempotente", async () => {
    const { store, refs, admin } = await setup();
    const vela = refs.skus["vela-u"]; // saldo sem movimentos na matriz
    const csv = [
      "SKU;EAN;Depósito;Quantidade;Custo unitário;Data do saldo",
      `VELA;;;12;15,50;${localDaysAgo(20).split("-").reverse().join("/")}`,
      "CADERNO;;;10;9,90;", // já tem movimentos
      "NAOEXISTE;;;1;1,00;",
      "AJUSTE;;;1;;", // serviço
      ";7891000800024;Depósito X;2;;", // depósito inexistente
      "CANETA;;;0;;", // quantidade zero
    ].join("\n");
    const mapping = map("stock", csv);
    expect(Object.values(mapping)).toEqual(expect.arrayContaining(["sku", "barcode", "warehouse", "qty", "unitCost", "date"]));
    const prev = await previewDataImport(admin, { kind: "stock", text: csv, mapping });
    expect(prev.results.map((r) => r.action)).toEqual(["create", "error", "error", "error", "error", "error"]);
    expect(prev.results[1].messages.join(" ")).toMatch(/já tem movimentos/);
    const res = await runDataImport(admin, { kind: "stock", text: csv, mapping, fileName: "saldos.csv", idemKey: "est-1" });
    expect(res.totals).toMatchObject({ create: 1, error: 5 });
    const wh = refs.warehouses["matriz-main"];
    const bal = (await store.get("stock_balances", balanceId(wh.id, vela.id)))!;
    expect(bal.physical).toBe(12 * QTY);
    expect(bal.avgCost).toBe(1550);
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "balanceId", bal.id]] });
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ type: "initial", unitCost: 1550, qty: 12 * QTY });
    expect(movs[0].reason).toMatch(/importad/);
    // a data do saldo vale para o inventário em data-base
    const inv = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(20), branchIds: [refs.branches.matriz.id] });
    expect(inv.rows.find((r) => r.balanceId === bal.id)).toMatchObject({ qty: 12 * QTY, avgCost: 1550 });
    const inv25 = await fiscalInventory(store, admin.companyId, { date: localDaysAgo(25), branchIds: [refs.branches.matriz.id] });
    expect(inv25.rows.find((r) => r.balanceId === bal.id)).toBeUndefined();
    // reimportação: ignorada, sem segundo movimento
    const re = await runDataImport(admin, { kind: "stock", text: csv, mapping, fileName: "saldos.csv", idemKey: "est-2" });
    expect(re.results[0].action).toBe("skip");
    expect(await listAll(store, "stock_movements", { filters: [["eq", "balanceId", bal.id]] })).toHaveLength(1);
    // sem filial selecionada: erro por linha
    const consolidated = await refs.ctxFor("admin", null);
    const p2 = await previewDataImport(consolidated, { kind: "stock", text: csv, mapping });
    expect(p2.results.every((r) => r.action === "error" || r.action === "skip")).toBe(true);
  });

  it("títulos em aberto a receber e a pagar via finance.createTitle, idempotentes", async () => {
    const { store, admin } = await setup();
    const rec = [
      "CPF/CNPJ;Nome;Documento;Parcela;Emissão;Vencimento;Valor;Categoria",
      "529.982.247-25;;VD-1020;2/3;10/09/2026;10/11/2026;150,00;Receita de vendas",
      ";Cliente Avulso;R-77;;;05/12/2026;80,50;",
      "000.000.000-00;;X;;;10/11/2026;10,00;", // cliente não cadastrado
      ";Sem Vencimento;;;;;10,00;",
      ";Valor Zero;;;;10/11/2026;0;",
      ";Categoria Errada;;;;10/11/2026;5,00;Aluguel", // categoria de despesa num título a receber
    ].join("\n");
    const mapping = map("receivables", rec);
    expect(Object.values(mapping)).toEqual(expect.arrayContaining(["doc", "partyName", "documentNumber", "installment", "issueDate", "dueDate", "amount", "category"]));
    const prev = await previewDataImport(admin, { kind: "receivables", text: rec, mapping });
    expect(prev.results.map((r) => r.action)).toEqual(["create", "create", "error", "error", "error", "error"]);
    const res = await runDataImport(admin, { kind: "receivables", text: rec, mapping, fileName: "receber.csv", idemKey: "rec-1" });
    expect(res.totals).toMatchObject({ create: 2, error: 4 });
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "data_import"]] });
    expect(titles).toHaveLength(2);
    const t1 = titles.find((t) => t.documentNumber === "VD-1020")!;
    expect(t1).toMatchObject({ kind: "receivable", partyType: "customer", total: 15000, balance: 15000, status: "open", issueDate: "2026-09-10", originId: res.id });
    expect(t1.description).toMatch(/parcela 2\/3/);
    const inst = await listAll(store, "installments", { filters: [["eq", "titleId", t1.id]] });
    expect(inst).toHaveLength(1);
    expect(inst[0]).toMatchObject({ dueDate: "2026-11-10", amount: 15000, status: "open" });
    const t2 = titles.find((t) => t.documentNumber === "R-77")!;
    expect(t2).toMatchObject({ partyType: "other", partyName: "Cliente Avulso", total: 8050 });
    // reimportação: nenhum título novo
    const re = await runDataImport(admin, { kind: "receivables", text: rec, mapping, fileName: "receber.csv", idemKey: "rec-2" });
    expect(re.totals).toMatchObject({ create: 0, skip: 2 });
    expect(await listAll(store, "titles", { filters: [["eq", "originType", "data_import"]] })).toHaveLength(2);

    const pay = ["CNPJ;Fornecedor;Documento;Vencimento;Valor;Categoria", "33.000.167/0001-01;;NF 4512;30/10/2026;2.350,00;Compra de mercadorias", ";Aluguel Imóveis Ltda;Out/26;05/11/2026;3.000,00;Aluguel"].join("\n");
    const pm = map("payables", pay);
    const pr = await runDataImport(admin, { kind: "payables", text: pay, mapping: pm, fileName: "pagar.csv", idemKey: "pag-1" });
    expect(pr.totals).toMatchObject({ create: 2, error: 0 });
    const payables = await listAll(store, "titles", { filters: [["eq", "originType", "data_import"], ["eq", "kind", "payable"]] });
    expect(payables).toHaveLength(2);
    expect(payables.find((t) => t.documentNumber === "NF 4512")).toMatchObject({ partyType: "supplier", total: 235000, approvalStatus: "pending" });
  });

  it("aplica em lotes de até 100 linhas e retoma um lote interrompido sem duplicar", async () => {
    const { store, admin } = await setup();
    const lines = ["Nome;E-mail"];
    for (let i = 1; i <= IMPORT_BATCH_SIZE + 30; i++) lines.push(`Cliente Lote ${i};lote${i}@ex.com`);
    const csv = lines.join("\n");
    const mapping = map("customers", csv);
    // simula uma execução interrompida: registro "processing" com as 100 primeiras linhas já feitas
    const first = await runDataImport(admin, { kind: "customers", text: lines.slice(0, IMPORT_BATCH_SIZE + 1).join("\n"), mapping, fileName: "lote.csv", idemKey: "lote-a" });
    expect(first.totals.create).toBe(IMPORT_BATCH_SIZE);
    const partial = first.results;
    const { detId } = await import("@/lib/db");
    const id = detId("dimport", admin.companyId, "lote-b");
    await store.create("product_imports", { companyId: admin.companyId, branchId: admin.branchId, createdBy: admin.user.id, number: 999, kind: "customers", fileName: "lote.csv", mode: "create_only", mapping, status: "processing", results: partial, idemKey: "dimport:lote-b" }, id);
    const resumed = await runDataImport(admin, { kind: "customers", text: csv, mapping, fileName: "lote.csv", idemKey: "lote-b" });
    expect(resumed.status).toBe("completed");
    expect(resumed.results).toHaveLength(IMPORT_BATCH_SIZE + 30);
    expect(resumed.totals).toMatchObject({ create: IMPORT_BATCH_SIZE + 30, error: 0 });
    expect((await listAll(store, "customers", { filters: [["startsWith", "name", "Cliente Lote"]] })).length).toBe(IMPORT_BATCH_SIZE + 30);
  });

  it("modelos e definições: cada tipo tem modelo que o próprio assistente reconhece", () => {
    for (const d of DATA_IMPORTS) {
      const a = analyzeDataCsv(d.kind, d.template);
      expect(a.rowCount).toBeGreaterThan(0);
      const mapped = new Set(Object.values(a.mapping));
      for (const g of d.required) expect(g.some((k) => mapped.has(k)), `${d.kind}: ${g.join("|")}`).toBe(true);
    }
    expect(() => dataImportDef("x")).toThrow();
  });
});

// ───────────────────────────── importação de produtos inalterada

describe("importação de produtos inalterada após extrair o motor comum", () => {
  it("parseCsv, guessMapping e analyzeCsv dão o mesmo resultado do motor", async () => {
    const csv = "﻿Código;SKU;Descrição;EAN;Unidade;\"Preço; de venda\";Estoque\r\nA1;A1;\"Produto \"\"A\"\"\";7891234567895;UN;10,00;5\r\n\r\n";
    expect(parseCsv(csv)).toEqual(engineParseCsv(csv));
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["Código", "SKU", "Descrição", "EAN", "Unidade", "Preço; de venda", "Estoque"]);
    expect(rows).toEqual([["A1", "A1", 'Produto "A"', "7891234567895", "UN", "10,00", "5"]]);
    expect(guessMapping(headers)).toEqual(guessMappingFor(IMPORT_FIELDS, headers));
    expect(guessMapping(headers)).toEqual({ "0": "code", "1": "sku", "2": "name", "3": "barcode", "4": "unit", "5": "price", "6": "initialQty" });
    const a = analyzeCsv(csv);
    expect(a).toEqual(analyzeCsvFor(csv, IMPORT_FIELDS, MAX_IMPORT_ROWS));
    expect(a.maxRows).toBe(1000);
    expect(a.fields.map((f) => f.key)).toEqual(IMPORT_FIELDS.map((f) => f.key));
  });

  it("prévia e importação de produtos continuam iguais", async () => {
    const { store, admin } = await setup();
    const csv = ["Código;SKU;Descrição;Unidade;Custo;Preço;Ativo", "NOVO1;NOVO1;Produto Novo;UN;5,00;9,90;S", "CANECA;CANECA;Caneca;UN;;;talvez"].join("\n");
    const mapping = guessMapping(parseCsv(csv).headers);
    const prev = await previewImport(admin, { text: csv, mapping, mode: "create_only", matchBy: "sku" });
    expect(prev.results.map((r) => r.action)).toEqual(["create", "error"]);
    expect(prev.results[1].messages.join(" ")).toMatch(/inválido para Ativo/);
    const res = await runImport(admin, { fileName: "p.csv", text: csv, mapping, mode: "create_only", matchBy: "sku", idemKey: "p-1" });
    expect(res.totals).toMatchObject({ create: 1, error: 1 });
    expect(res.kind ?? null).toBeNull();
    expect(await listAll(store, "product_imports", { filters: [["isNull", "kind"]] })).toHaveLength(1);
  });
});
