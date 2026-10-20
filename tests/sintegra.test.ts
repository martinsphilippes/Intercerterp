import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { readFile } from "@/lib/core/files";
import { setSetting } from "@/lib/core/settings";
import { QTY } from "@/lib/money";
import { monthStart, today, monthEnd } from "@/lib/dates";
import { DEFAULT_ROLES, canDo } from "@/lib/permissions";
import { ACTIONS_ADDED_TO_TEMPLATES, templateSyncPlan } from "@/lib/auth/role-sync";
import { PARAM_MAP } from "@/app/(app)/administracao/parametros/catalog";
import { NAV } from "@/components/shell/nav";
import { fileAccessDenial } from "@/app/api/files/[id]/access";
import { buildSampleNfeXml } from "@/domain/nfe-xml";
import { buildSampleCteXml } from "@/domain/cte-xml";
import { confirmReceipt, importNfeXml, updateReceipt } from "@/domain/receipts";
import { importCteXml } from "@/domain/freight-cte";
import { createPendingInvoiceEntry } from "@/domain/pending-invoice";
import { saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { cancelDocument, disableNumbers, queryDocument } from "@/domain/fiscal/service";
import { fiscalInventory } from "@/domain/inventory-fiscal";
import { buildAccountingPackage } from "@/domain/fiscal/export";
import { buildSintegra, generateSintegraFile, isExemptCst, latestSintegraFiles, sintegraCst, sintegraHistory, type SintegraResult } from "@/domain/fiscal/files/sintegra";
import { alpha, code, num, toAscii, ymd } from "@/domain/fiscal/files/sintegra-common";

let store: Store;
let refs: DemoRefs;
let admin: Ctx;
let stockist: Ctx;
const MATRIZ = "11222333000181";
const t0 = today();
const period = t0.slice(0, 7);
let saleDocId = "";
let cancelledDocId = "";
let receiptId = "";
let pendingId = "";
let res: SintegraResult;

/** Campo (posições 1-based, inclusivas) de uma linha. */
const at = (line: string, from: number, to: number) => line.slice(from - 1, to);
/** Código do produto no Sintegra: SKU até 14 posições; acima, o GTIN. */
const sc = (key: string) => {
  const s = refs.skus[key];
  return s.sku.length <= 14 ? s.sku : String(s.barcode);
};
const linesOf = (r: SintegraResult, type: string) => r.lines.filter((l) => (type === "61R" ? l.startsWith("61R") : l.startsWith(type) && !(type === "61" && l.startsWith("61R"))));

function nfeInput(over: Partial<NfeInput> = {}): NfeInput {
  const c = refs.customers.mercado;
  return {
    branchId: refs.branches.matriz.id,
    origin: { type: "manual" },
    nature: "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: "1",
    recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] },
    items: [
      { skuId: refs.skus["caneca-u"].id, qty: 2000, unitPrice: 5000, discount: 0 },
      { skuId: refs.skus["caderno-u"].id, qty: 3000, unitPrice: 1000, discount: 500 },
    ],
    freight: 1000,
    insurance: 0,
    other: 0,
    transport: { mode: "0" },
    payments: [{ kind: "boleto", amount: 13500 }],
    referencedKeys: [],
    effects: { stock: false, financial: false },
    ...over,
  };
}

/** NF-e de compra do regime normal: ICMS 18%, IPI 5% no 1º item e ICMS-ST no 2º (CFOP 1102 e 1403 na entrada). */
function taxedXml(number: number) {
  const camiseta = refs.skus["camiseta-m-preta"];
  const bone = refs.skus["bone-u"];
  return buildSampleNfeXml({
    number,
    issueDate: t0,
    emitter: { cnpj: refs.suppliers.textil.doc, name: refs.suppliers.textil.name, ie: "110042490999" },
    recipient: { cnpj: MATRIZ, name: refs.company.name },
    items: [
      { cProd: "T-cam", cEAN: camiseta.barcode, xProd: camiseta.name, cfop: "5102", qCom: 10000, vUnCom: 2000, icms: { vBC: 20000, pICMS: 1800, vICMS: 3600 }, ipi: { vBC: 20000, pIPI: 500, vIPI: 1000 } },
      { cProd: "T-bone", cEAN: bone.barcode, xProd: bone.name, cfop: "5405", qCom: 5000, vUnCom: 1600, icms: { vBC: 8000, pICMS: 1800, vICMS: 1440, vBCST: 16000, pICMSST: 1800, vICMSST: 900 } },
    ],
    freight: 1000,
  });
}

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  // saída NF-e autorizada (2 itens, frete) e uma cancelada
  let d = await saveNfe(admin, nfeInput(), { idemKey: "sintegra-sale-1", transmit: true });
  d = await queryDocument(admin, d.id);
  expect(d.status).toBe("authorized");
  saleDocId = d.id;
  let c = await saveNfe(admin, nfeInput({ items: [{ skuId: refs.skus["caneca-u"].id, qty: 1000, unitPrice: 5000, discount: 0 }], freight: 0, payments: [{ kind: "boleto", amount: 5000 }] }), { idemKey: "sintegra-sale-2", transmit: true });
  c = await queryDocument(admin, c.id);
  c = await cancelDocument(admin, c.id, "Cliente desistiu da compra após a emissão");
  expect(c.status).toBe("cancelled");
  cancelledDocId = c.id;
  // entrada: recebimento concluído com NF-e do fornecedor (XML com ICMS, IPI e ST)
  const r = await importNfeXml(stockist, { xml: taxedXml(77001), withoutOrder: true, allowHomologation: true });
  await updateReceipt(stockist, r.id, { checkAll: true });
  const rc = await confirmReceipt(stockist, r.id);
  expect(rc.status).toBe("confirmed");
  receiptId = r.id;
  // CT-e do frete dessa compra
  const cteXml = buildSampleCteXml({ number: 5501, issueDate: t0, emitter: { cnpj: "19131243000197", name: "Rápido Transportes Ltda" }, sender: { cnpj: refs.suppliers.textil.doc, name: "Têxtil" }, recipient: { cnpj: MATRIZ, name: refs.company.name }, total: 12000, icms: { vBC: 12000, pICMS: 1200, vICMS: 1440 }, nfeKeys: [rc.nfeKey] });
  const cte = await importCteXml(admin, { xml: cteXml, allowHomologation: true });
  expect(cte.status).toBe("registered");
  // entrada com nota a confirmar (sem documento do fornecedor ainda)
  const p = await createPendingInvoiceEntry(stockist, { supplierId: refs.suppliers.papel.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 4 * QTY, unitCost: 700 }], entryAt: new Date(Date.now() - 60_000).toISOString(), idemKey: "sintegra-pi" });
  expect(p.documentStatus).toBe("pending_invoice");
  pendingId = p.id;
  // NFC-e autorizada (documento emitido, fixture)
  const caneca = refs.skus["caneca-u"];
  await store.create("fiscal_documents", {
    companyId: refs.company.id, branchId: refs.branches.matriz.id, model: "nfce", ref: "nfce-sintegra-901", series: "1", number: 901, status: "authorized", originType: "sale", operationType: "saida", issuedAt: new Date().toISOString(), isSimulated: true, total: 4500,
    items: [{ seq: 1, skuId: caneca.id, code: caneca.sku, description: caneca.name, ncm: "69120000", cfop: "5102", unit: "UN", qty: 1000, unitPrice: 5000, gross: 5000, discount: 500, freight: 0, other: 0, total: 4500, origin: "0", cstCsosn: "102", icmsRateBps: 0, icmsBase: 0, icms: 0, pisCst: "49", pis: 0, cofinsCst: "49", cofins: 0 }],
    totals: { products: 5000, discount: 500, freight: 0, insurance: 0, other: 0, icmsBase: 0, icms: 0, pis: 0, cofins: 0, total: 4500 },
  });
  res = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period, inventoryDate: t0, includeNfce: true });
}, 120000);

describe("Sintegra — formatação (sintegra-common)", () => {
  it("zeros à esquerda, espaços à direita, datas AAAAMMDD, ASCII sem acentos", () => {
    expect(num(1234, 13)).toBe("0000000001234");
    expect(alpha("Ação", 6)).toBe("Acao  ");
    expect(alpha("texto longo demais", 5)).toBe("texto");
    expect(code("11.222.333/0001-81", 14)).toBe("11222333000181");
    expect(code(1234567, 6)).toBe("234567"); // número com mais de 6 dígitos: os 6 últimos
    expect(ymd("2026-10-05")).toBe("20261005");
    expect(toAscii("Comércio nº 1 — Pão")).toBe("Comercio no 1   Pao");
    expect(() => num(-1, 4)).toThrow(/negativo/);
    expect(() => num(123456, 4)).toThrow(/não cabe/);
    expect(sintegraCst("0", "00")).toBe("000");
    expect(sintegraCst("2", "60")).toBe("260");
    expect(sintegraCst("0", "102")).toBe("102");
    expect(isExemptCst("40")).toBe(true);
    expect(isExemptCst("300")).toBe(true);
    expect(isExemptCst("00")).toBe(false);
    expect(isExemptCst("102")).toBe(false);
  });

  it("todas as linhas com 126 posições, CRLF e ASCII", () => {
    expect(res.lines.length).toBeGreaterThan(10);
    for (const l of res.lines) expect(l).toHaveLength(126);
    expect(res.text.endsWith("\r\n")).toBe(true);
    expect(res.text.split("\r\n").slice(0, -1)).toEqual(res.lines);
    expect(/^[\x20-\x7e\r\n]*$/.test(res.text)).toBe(true);
  });
});

describe("Sintegra — registros", () => {
  it("10 e 11: estabelecimento, período, convênio 3, natureza e finalidade", () => {
    const r10 = res.lines[0];
    expect(at(r10, 1, 2)).toBe("10");
    expect(at(r10, 3, 16)).toBe(MATRIZ);
    expect(at(r10, 17, 30)).toBe("110042490114  ");
    expect(at(r10, 31, 65)).toBe(alpha(refs.company.name, 35));
    expect(at(r10, 31, 65).startsWith("Intercert Comercio Varejista")).toBe(true);
    expect(at(r10, 66, 95).trim()).toBe("Sao Paulo");
    expect(at(r10, 96, 97)).toBe("SP");
    expect(at(r10, 98, 107)).toBe("0000000000");
    expect(at(r10, 108, 115)).toBe(ymd(monthStart(t0)));
    expect(at(r10, 116, 123)).toBe(ymd(monthEnd(t0)));
    expect(at(r10, 124, 126)).toBe("331");
    const r11 = res.lines[1];
    expect(at(r11, 1, 2)).toBe("11");
    expect(at(r11, 3, 36).trim()).toBe("Rua das Flores");
    expect(at(r11, 37, 41)).toBe("00100");
    expect(at(r11, 64, 78).trim()).toBe("Centro");
    expect(at(r11, 79, 86)).toBe("01001000");
    expect(at(r11, 87, 114).trim()).toBe("Ana Administradora");
    expect(at(r11, 115, 126)).toBe("001133334444");
  });

  it("saída NF-e: 50 por CFOP × alíquota batendo com os 54 (itens + 991 de frete); cancelada com situação S", async () => {
    const d = await store.getOrThrow("fiscal_documents", saleDocId);
    const num6 = String(d.number).padStart(6, "0");
    const mine50 = linesOf(res, "50").filter((l) => at(l, 46, 51) === num6 && at(l, 56, 56) === "P");
    expect(mine50.length).toBeGreaterThanOrEqual(1);
    expect(at(mine50[0], 3, 16)).toBe(refs.customers.mercado.doc.replace(/\D/g, ""));
    expect(at(mine50[0], 41, 42)).toBe("55");
    expect(mine50.every((l) => at(l, 126, 126) === "N")).toBe(true);
    const total50 = mine50.reduce((a, l) => a + Number(at(l, 57, 69)), 0);
    expect(total50).toBe(d.total);
    const mine54 = linesOf(res, "54").filter((l) => at(l, 22, 27) === num6 && at(l, 3, 16) === at(mine50[0], 3, 16));
    const items = mine54.filter((l) => Number(at(l, 35, 37)) <= 990);
    expect(items).toHaveLength(2);
    const freight = mine54.find((l) => at(l, 35, 37) === "991")!;
    expect(Number(at(freight, 75, 86))).toBe(1000);
    expect(at(freight, 38, 51)).toBe(" ".repeat(14));
    expect(Number(at(freight, 52, 62))).toBe(0);
    // Σ54 = (produto − desconto + IPI) dos itens + despesas 99x
    const sum54 = items.reduce((a, l) => a + Number(at(l, 63, 74)) - Number(at(l, 75, 86)) + Number(at(l, 111, 122)), 0) + mine54.filter((l) => Number(at(l, 35, 37)) > 990).reduce((a, l) => a + Number(at(l, 75, 86)), 0);
    expect(sum54).toBe(total50);
    // quantidade com 3 casas: 2 un = 00000002000
    expect(items.some((l) => at(l, 52, 62) === "00000002000")).toBe(true);
    expect(res.checks.mismatches).toBe(0);
    // cancelada: 50 com situação S, valores zerados, sem 54
    const cd = await store.getOrThrow("fiscal_documents", cancelledDocId);
    const c6 = String(cd.number).padStart(6, "0");
    const c50 = linesOf(res, "50").filter((l) => at(l, 46, 51) === c6 && at(l, 56, 56) === "P");
    expect(c50.length).toBeGreaterThanOrEqual(1);
    expect(c50.every((l) => at(l, 126, 126) === "S" && Number(at(l, 57, 69)) === 0)).toBe(true);
    expect(linesOf(res, "54").some((l) => at(l, 22, 27) === c6 && at(l, 3, 16) === at(c50[0], 3, 16))).toBe(false);
  });

  it("entrada de recebimento confirmado: 50 (T) por CFOP 1102/1403 a 18%, 53 da ST, 54 com IPI e base ST, total = vNF", async () => {
    const r = await store.getOrThrow("receipts", receiptId);
    const sup = refs.suppliers.textil.doc;
    const in50 = linesOf(res, "50").filter((l) => at(l, 3, 16) === sup && at(l, 46, 51) === "077001");
    expect(in50.map((l) => at(l, 52, 55))).toEqual(["1102", "1403"]);
    expect(in50.every((l) => at(l, 56, 56) === "T" && at(l, 122, 125) === "1800" && at(l, 17, 30) === "110042490999  " && at(l, 39, 40) === "SP")).toBe(true);
    expect(in50.reduce((a, l) => a + Number(at(l, 57, 69)), 0)).toBe(r.emitter.totals.vNF);
    expect(in50.reduce((a, l) => a + Number(at(l, 70, 82)), 0)).toBe(28000);
    expect(in50.reduce((a, l) => a + Number(at(l, 83, 95)), 0)).toBe(5040);
    const st = linesOf(res, "53").filter((l) => at(l, 3, 16) === sup);
    expect(st).toHaveLength(1);
    expect(at(st[0], 52, 55)).toBe("1403");
    expect(Number(at(st[0], 57, 69))).toBe(16000);
    expect(Number(at(st[0], 70, 82))).toBe(900);
    const in54 = linesOf(res, "54").filter((l) => at(l, 3, 16) === sup && at(l, 22, 27) === "077001");
    const cam = in54.find((l) => at(l, 38, 51).trim() === sc("camiseta-m-preta"))!;
    expect(Number(at(cam, 111, 122))).toBe(1000); // IPI
    expect(at(cam, 32, 34)).toBe("000");
    const bone = in54.find((l) => at(l, 38, 51).trim() === sc("bone-u"))!;
    expect(Number(at(bone, 99, 110))).toBe(16000); // base ST
    expect(in54.some((l) => at(l, 35, 37) === "991")).toBe(true);
    // sem IPI de contribuinte: nenhum 51 (padrão)
    expect(linesOf(res, "51")).toHaveLength(0);
  });

  it("nota a confirmar fica fora e é listada como pendência", async () => {
    const p = await store.getOrThrow("receipts", pendingId);
    expect(res.pendencies.some((x) => x.code === "pending_invoice" && x.message.includes(`nº ${p.number}`))).toBe(true);
    expect(res.documents.some((d) => d.key === `rc:${pendingId}`)).toBe(false);
    expect(res.documents.some((d) => d.key === `rc:${receiptId}`)).toBe(true);
    // a mesma entrada, depois de confirmada a nota, entraria pela data: aqui só confere que nada dela está no 50
    expect(linesOf(res, "50").some((l) => at(l, 3, 16) === refs.suppliers.papel.doc)).toBe(false);
  });

  it("CT-e de entrada no 70 (modelo 57, FOB, situação N)", () => {
    const l70 = linesOf(res, "70");
    expect(l70).toHaveLength(1);
    const l = l70[0];
    expect(at(l, 3, 16)).toBe("19131243000197");
    expect(at(l, 41, 42)).toBe("57");
    expect(at(l, 46, 51)).toBe("005501");
    expect(at(l, 52, 55)).toBe("1353");
    expect(Number(at(l, 56, 68))).toBe(12000);
    expect(Number(at(l, 69, 82))).toBe(12000);
    expect(Number(at(l, 83, 96))).toBe(1440);
    expect(at(l, 125, 126)).toBe("2N");
  });

  it("inventário no 74 bate com o inventário em data-base", async () => {
    const inv = await fiscalInventory(store, refs.company.id, { date: t0, branchIds: [refs.branches.matriz.id] });
    const l74 = linesOf(res, "74");
    expect(l74.length).toBeGreaterThan(0);
    expect(l74.every((l) => at(l, 3, 10) === ymd(t0) && at(l, 51, 51) === "1" && at(l, 52, 65) === "0".repeat(14))).toBe(true);
    expect(l74.reduce((a, l) => a + Number(at(l, 38, 50)), 0)).toBe(inv.totals.value);
    const bySku = new Map<string, number>();
    const key = (code: string) => (code.length <= 14 ? code : String(Object.values(refs.skus).find((x) => x.sku === code)?.barcode));
    for (const r of inv.rows.filter((x) => !x.negative)) bySku.set(key(r.skuCode), (bySku.get(key(r.skuCode)) ?? 0) + r.qty);
    expect(l74).toHaveLength(bySku.size);
    for (const l of l74) expect(Number(at(l, 25, 37))).toBe(bySku.get(at(l, 11, 24).trim()));
    // SKU com mais de 14 posições: GTIN no 74 e no 75 (o mesmo código)
    expect(l74.some((l) => at(l, 11, 24).trim() === sc("camiseta-m-preta"))).toBe(true);
    expect(res.pendencies.some((p) => p.code === "product_code_long" && p.level === "warning")).toBe(true);
    expect(res.inventory).toMatchObject({ date: t0, value: inv.totals.value });
  });

  it("NFC-e nos 61/61R quando incluída; fora (com aviso) pelo parâmetro padrão", async () => {
    const l61 = linesOf(res, "61");
    expect(l61).toHaveLength(1);
    expect(at(l61[0], 3, 30)).toBe(" ".repeat(28));
    expect(at(l61[0], 39, 40)).toBe("65");
    expect(at(l61[0], 46, 57)).toBe("000901000901");
    expect(Number(at(l61[0], 58, 70))).toBe(4500);
    const r61 = linesOf(res, "61R");
    expect(r61).toHaveLength(1);
    expect(at(r61[0], 4, 9)).toBe(`${period.slice(5, 7)}${period.slice(0, 4)}`);
    expect(at(r61[0], 10, 23).trim()).toBe(refs.skus["caneca-u"].sku);
    const off = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period });
    expect(off.options.includeNfce).toBe(false);
    expect(off.lines.some((l) => l.startsWith("61"))).toBe(false);
    expect(off.pendencies.some((p) => p.code === "nfce_excluded")).toBe(true);
    await setSetting(store, refs.company.id, null, "sintegra.includeNfce", true);
    const on = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period });
    expect(on.options.includeNfce).toBe(true);
    expect(on.lines.some((l) => l.startsWith("61R"))).toBe(true);
    await setSetting(store, refs.company.id, null, "sintegra.includeNfce", false);
  });

  it("75 para todo produto referenciado em 54, 61R e 74 (com NCM e unidade)", () => {
    const codes75 = new Set(linesOf(res, "75").map((l) => at(l, 19, 32).trim()));
    const referenced = new Set<string>([
      ...linesOf(res, "54").filter((l) => Number(at(l, 35, 37)) <= 990).map((l) => at(l, 38, 51).trim()),
      ...linesOf(res, "61R").map((l) => at(l, 10, 23).trim()),
      ...linesOf(res, "74").map((l) => at(l, 11, 24).trim()),
    ]);
    for (const c of referenced) expect(codes75.has(c)).toBe(true);
    expect(codes75.size).toBe(referenced.size);
    for (const l of linesOf(res, "75")) {
      expect(at(l, 3, 10)).toBe(ymd(monthStart(t0)));
      expect(at(l, 33, 40).trim()).toMatch(/^\d{8}$/);
      expect(at(l, 94, 99).trim()).not.toBe("");
    }
  });

  it("90: pares tipo × quantidade iguais à contagem real, 99 = total de linhas, nº de registros 90 na posição 126", () => {
    const l90 = res.lines.filter((l) => l.startsWith("90"));
    expect(l90.length).toBeGreaterThanOrEqual(1);
    expect(res.lines[res.lines.length - 1].startsWith("90")).toBe(true);
    const pairs = new Map<string, number>();
    for (const l of l90) {
      expect(at(l, 3, 16)).toBe(MATRIZ);
      expect(at(l, 126, 126)).toBe(String(l90.length));
      const body = at(l, 31, 125);
      for (let i = 0; i + 10 <= body.length; i += 10) {
        const p = body.slice(i, i + 10);
        if (p.trim()) pairs.set(p.slice(0, 2), Number(p.slice(2)));
      }
    }
    expect(pairs.get("99")).toBe(res.lines.length);
    for (const t of ["50", "53", "54", "61", "70", "74", "75"]) expect(pairs.get(t)).toBe(res.lines.filter((l) => l.startsWith(t)).length);
    expect(pairs.has("10")).toBe(false);
    expect(pairs.has("11")).toBe(false);
    expect(res.counts["61R"]).toBe(1);
    expect(res.totalLines).toBe(res.lines.length);
  });

  it("muitos tipos: mais de um registro 90 quando os pares não cabem (IPI ligado acrescenta o 51)", async () => {
    const r = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period, inventoryDate: t0, includeNfce: true, ipiContributor: true });
    const l51 = linesOf(r, "51");
    expect(l51.length).toBeGreaterThan(0);
    expect(l51.reduce((a, l) => a + Number(at(l, 67, 79)), 0)).toBe(1000);
    const l90 = r.lines.filter((l) => l.startsWith("90"));
    // 50, 51, 53, 54, 61, 70, 74, 75 + 99 = 9 pares: cabem em 1 registro
    expect(l90).toHaveLength(1);
    expect(at(l90[0], 31, 120).replace(/ /g, "")).toHaveLength(90);
  });

  it("natureza 2 (interestaduais): operações internas ficam fora; finalidade 5 só 10/11/90", async () => {
    const r2 = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period, natureza: "2" });
    expect(r2.lines.some((l) => l.startsWith("50") || l.startsWith("54") || l.startsWith("70"))).toBe(false);
    expect(at(r2.lines[0], 125, 125)).toBe("2");
    const r5 = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period, finalidade: "5" });
    expect(r5.lines.map((l) => l.slice(0, 2))).toEqual(["10", "11", "90"]);
    expect(at(r5.lines[0], 126, 126)).toBe("5");
  });
});

describe("Sintegra — pendências, geração, idempotência e pacote", () => {
  it("pendências: item sem NCM e participante sem UF bloqueiam; gerar exige confirmação", async () => {
    const sku = refs.skus["caderno-u"];
    const prod = await store.getOrThrow("products", sku.productId);
    await store.update("products", prod.id, { ncm: "" });
    const r = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period });
    expect(r.pendencies.some((p) => p.level === "error" && p.code === "product_ncm" && p.message.includes(sku.sku))).toBe(true);
    await expect(generateSintegraFile(admin, { branchId: refs.branches.matriz.id, period })).rejects.toThrow(/pendência/);
    const forced = await generateSintegraFile(admin, { branchId: refs.branches.matriz.id, period, allowPendencies: true });
    expect(forced.errors).toBeGreaterThan(0);
    await store.update("products", prod.id, { ncm: prod.ncm });
    expect((await buildSintegra(admin, { branchId: refs.branches.matriz.id, period })).pendencies.some((p) => p.code === "product_ncm")).toBe(false);
  });

  it("idempotência: mesmo período e dados → mesmo conteúdo; gerar de novo devolve o mesmo arquivo", async () => {
    const a = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period, inventoryDate: t0, includeNfce: true });
    const b = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period, inventoryDate: t0, includeNfce: true });
    expect(a.text).toBe(b.text);
    expect(a.sha256).toBe(b.sha256);
    expect(a.text).toBe(res.text);
    const g1 = await generateSintegraFile(admin, { branchId: refs.branches.matriz.id, period, inventoryDate: t0, includeNfce: true });
    const g2 = await generateSintegraFile(admin, { branchId: refs.branches.matriz.id, period, inventoryDate: t0, includeNfce: true });
    expect(g1.reused).toBe(false);
    expect(g2.reused).toBe(true);
    expect(g2.fileId).toBe(g1.fileId);
    const { data, meta } = await readFile(admin, g1.fileId);
    expect(data.toString("latin1")).toBe(a.text);
    expect(meta.kind).toBe("sintegra");
    expect(meta.name).toBe(`SINTEGRA-${MATRIZ}-${period.replace("-", "")}-fin1.txt`);
    const hist = await sintegraHistory(admin);
    expect(hist[0]).toMatchObject({ id: g1.fileId, period, branchId: refs.branches.matriz.id, finalidade: "1" });
    const audits = await listAll(store, "audit_logs", { filters: [["eq", "action", "sintegra.generate"]] });
    expect(audits.length).toBe(2); // o forçado com pendências e este
  });

  it("pacote contábil inclui o último Sintegra do período", async () => {
    const latest = await latestSintegraFiles(admin, { from: monthStart(t0), to: t0, branchId: refs.branches.matriz.id });
    expect(latest).toHaveLength(1);
    const pkg = await buildAccountingPackage(admin, { from: monthStart(t0), to: t0, branchId: refs.branches.matriz.id, includeSimulated: true });
    expect(pkg.sintegraFiles).toBe(1);
    const zip = await JSZip.loadAsync((await readFile(admin, pkg.fileId)).data);
    const name = `sintegra/SINTEGRA-${MATRIZ}-${period.replace("-", "")}-fin1.txt`;
    expect(zip.file(name)).toBeTruthy();
    expect(await zip.file(name)!.async("string")).toBe(res.text);
    expect(await zip.file("LEIA-ME.txt")!.async("string")).toMatch(/SINTEGRA \(Convênio ICMS 57\/95\)/);
    // outro mês sem arquivo: nada a incluir
    expect(await latestSintegraFiles(admin, { from: "2000-01-01", to: "2000-01-31", branchId: refs.branches.matriz.id })).toHaveLength(0);
  });

  it("documentos emitidos não mudam: fiscal_documents só tem o que a empresa emitiu", async () => {
    const all = await listAll(store, "fiscal_documents");
    expect(all.some((d) => d.recipientDoc === refs.suppliers.textil.doc && d.operationType === "entrada")).toBe(false);
    expect(all.length).toBe(3);
  });
});

describe("Sintegra — permissões, parâmetros e menu", () => {
  it("fiscal.files: Fiscal e Administrador; demais perfis recusados", async () => {
    expect(DEFAULT_ROLES.find((r) => r.key === "fiscal")!.actions).toContain("fiscal.files");
    expect(DEFAULT_ROLES.find((r) => r.key === "admin")!.actions).toContain("fiscal.files");
    for (const k of ["manager", "cashier", "stockist", "finance"]) expect(DEFAULT_ROLES.find((r) => r.key === k)!.actions).not.toContain("fiscal.files");
    expect(ACTIONS_ADDED_TO_TEMPLATES).toContain("fiscal.files");
    // perfil Fiscal gravado antes da operação nova recebe-a na sincronização
    const plan = templateSyncPlan({ system: true, key: "fiscal", actions: ["fiscal.issue", "fiscal.cancel", "fiscal.configure", "data.export"] });
    expect(plan?.missing).toEqual(["fiscal.files"]);
    const fiscal = await refs.ctxFor("fiscal", "matriz");
    expect(canDo(fiscal.user, "fiscal.files")).toBe(true);
    expect((await buildSintegra(fiscal, { branchId: refs.branches.matriz.id, period })).lines.length).toBeGreaterThan(3);
    for (const k of ["manager", "stockist", "finance"]) {
      const c = await refs.ctxFor(k, "matriz");
      await expect(buildSintegra(c, { branchId: refs.branches.matriz.id, period })).rejects.toThrow();
      await expect(sintegraHistory(c)).rejects.toThrow();
    }
    // download do arquivo: consulta do fiscal + fiscal.files
    const meta = { kind: "sintegra", entityType: "sintegra", bucket: "documents" };
    expect(fileAccessDenial(fiscal.user as any, meta)).toBeNull();
    expect(fileAccessDenial((await refs.ctxFor("manager", "matriz")).user as any, meta)).toMatch(/Sintegra/);
    expect(fileAccessDenial((await refs.ctxFor("stockist", "matriz")).user as any, meta)).toMatch(/permissão/);
    // outra filial que não a do contexto
    await expect(buildSintegra(admin, { branchId: refs.branches.shopping.id, period })).rejects.toThrow(/filial atual/);
    const consolidated = await refs.ctxFor("admin", null);
    expect((await buildSintegra(consolidated, { branchId: refs.branches.shopping.id, period })).options.branchId).toBe(refs.branches.shopping.id);
  });

  it("parâmetros feature.arquivosFiscais (ligado) e sintegra.includeNfce (desligado); menu Fiscal › Sintegra", () => {
    expect(PARAM_MAP["feature.arquivosFiscais"]).toMatchObject({ group: "Recursos", default: true, type: "bool" });
    expect(PARAM_MAP["sintegra.includeNfce"]).toMatchObject({ group: "Fiscal", default: false, type: "bool" });
    const item = NAV.flatMap((g) => g.items).find((i) => i.href === "/fiscal/arquivos/sintegra")!;
    expect(item).toMatchObject({ label: "Sintegra", module: "fiscal", action: "fiscal.files", feature: "arquivosFiscais" });
  });

  it("período inválido/futuro e data-base posterior são recusados", async () => {
    await expect(buildSintegra(admin, { branchId: refs.branches.matriz.id, period: "2026-13" })).rejects.toThrow(/AAAA-MM/);
    await expect(buildSintegra(admin, { branchId: refs.branches.matriz.id, period: "2999-01" })).rejects.toThrow(/futuro/);
    await expect(buildSintegra(admin, { branchId: refs.branches.matriz.id, period: "2020-01", inventoryDate: t0 })).rejects.toThrow(/posterior/);
  });
});

describe("Sintegra — numeração inutilizada", () => {
  it("faixa inutilizada homologada: um 50 por número com situação 4, informante como participante, sem 54", async () => {
    const sale = await store.getOrThrow("fiscal_documents", saleDocId);
    await disableNumbers(admin, { branchId: refs.branches.matriz.id, model: "nfe", series: sale.series, from: 8001, to: 8002, justification: "Numeração pulada por falha do sistema emissor" });
    const r = await buildSintegra(admin, { branchId: refs.branches.matriz.id, period });
    const l4 = linesOf(r, "50").filter((l) => at(l, 126, 126) === "4");
    expect(l4.map((l) => at(l, 46, 51))).toEqual(["008001", "008002"]);
    expect(l4.every((l) => at(l, 3, 16) === MATRIZ && at(l, 56, 56) === "P" && Number(at(l, 57, 69)) === 0)).toBe(true);
    expect(linesOf(r, "54").some((l) => at(l, 22, 27) === "008001")).toBe(false);
    for (const l of r.lines) expect(l).toHaveLength(126);
  });
});
