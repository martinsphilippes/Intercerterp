import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { setSetting } from "@/lib/core/settings";
import { readFile } from "@/lib/core/files";
import { monthStart, nowIso, today, toLocalDate } from "@/lib/dates";
import { roundDiv } from "@/lib/money";
import { canDo } from "@/lib/permissions";
import { templateSyncPlan, ACTIONS_ADDED_TO_TEMPLATES } from "@/lib/auth/role-sync";
import { fileAccessDenial } from "@/app/api/files/[id]/access";
import { PARAMS } from "@/app/(app)/administracao/parametros/catalog";
import { buildSampleNfeXml } from "@/domain/nfe-xml";
import { buildSampleCteXml } from "@/domain/cte-xml";
import { confirmReceipt, importNfeXml, updateReceipt } from "@/domain/receipts";
import { importCteXml } from "@/domain/freight-cte";
import { fiscalInventory } from "@/domain/inventory-fiscal";
import { partyRecipient, saveNfe } from "@/domain/fiscal/nfe";
import { cancelDocument, disableNumbers, queryDocument } from "@/domain/fiscal/service";
import { buildAccountingPackage } from "@/domain/fiscal/export";
import { buildFiscalFile, generateFiscalFile, latestFilesForPackage } from "@/domain/fiscal/files/service";
import { checkStructure, fmtDate, fmtMoney, toLatin1 } from "@/domain/fiscal/files/common";
import { parseRecolhimento } from "@/domain/fiscal/files/settings";

let store: Store;
let refs: DemoRefs;
let fiscal: Ctx;
let admin: Ctx;
let stockist: Ctx;
const period = today().slice(0, 7);
const MATRIZ = "11222333000181";

/** Campos de uma linha "|REG|a|b|" (índice 0 = REG). */
const fields = (l: string) => l.split("|").slice(1, -1);
const cents = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);
const regs = (lines: string[], reg: string) => lines.filter((l) => l.startsWith(`|${reg}|`)).map(fields);

/** Registros C100 com os filhos (C101/C170/C190) até o próximo C100. */
function c100Groups(lines: string[]) {
  const out: Array<{ c100: string[]; c170: string[][]; c190: string[][]; c101: string[][] }> = [];
  for (const l of lines) {
    const f = fields(l);
    if (f[0] === "C100") out.push({ c100: f, c170: [], c190: [], c101: [] });
    else if (out.length && f[0] === "C170") out[out.length - 1].c170.push(f);
    else if (out.length && f[0] === "C190") out[out.length - 1].c190.push(f);
    else if (out.length && f[0] === "C101") out[out.length - 1].c101.push(f);
  }
  return out;
}

const spedOf = (ctx: Ctx, extra: Record<string, unknown> = {}) => buildFiscalFile(ctx, { kind: "sped_fiscal", period, branchId: refs.branches.matriz.id, ...extra });

beforeAll(async () => {
  store = freshStore();
  await seedDemo(store, { historyDays: 3 });
  refs = await seedBase(store);
  fiscal = await refs.ctxFor("fiscal", "matriz");
  admin = await refs.ctxFor("admin", "matriz");
  stockist = await refs.ctxFor("stockist", "matriz");
  // contabilista (0100) e recolhimento do ICMS por UF (E116) — Parâmetros › Arquivos fiscais
  for (const [k, v] of Object.entries({ accountantName: "Maria Contadora", accountantCpf: "52998224725", accountantCrc: "1SP123456O0", accountantEmail: "maria@contabil.demo", accountantCityCode: "3550308" })) await setSetting(store, refs.company.id, null, `fiscal.files.${k}`, v);
  await setSetting(store, refs.company.id, null, "fiscal.sped.recolhimento", parseRecolhimento("SP=046-2;20\nBA=0759;9"));
}, 300000);

describe("§41 — parâmetros, permissões e recurso", () => {
  it("catálogo: recurso ligado, perfil, atividade, recolhimento e contabilista", () => {
    expect(PARAMS.find((p) => p.key === "feature.arquivosFiscais")).toMatchObject({ group: "Recursos", type: "bool", default: true });
    expect(PARAMS.find((p) => p.key === "fiscal.sped.profile")?.options?.map((o) => o.value)).toEqual(["A", "B", "C"]);
    expect(PARAMS.find((p) => p.key === "fiscal.sped.activity")?.default).toBe("1");
    expect(PARAMS.find((p) => p.key === "fiscal.sped.recolhimento")?.type).toBe("ufCodes");
    expect(PARAMS.find((p) => p.key === "fiscal.files.accountantCpf")?.type).toBe("text");
    expect(parseRecolhimento("sp=046-2;20\nRJ=1234")).toEqual({ SP: { code: "046-2", day: 20 }, RJ: { code: "1234", day: 20 } });
    expect(() => parseRecolhimento("XX=1")).toThrow(/UF inválida/);
  });

  it("permissão fiscal.files: Fiscal e Administrador geram; Gerente, Caixa e Estoquista não", async () => {
    const [manager, cashier] = [await refs.ctxFor("manager", "matriz"), await refs.ctxFor("cashier", "matriz")];
    expect(canDo(fiscal.user, "fiscal.files")).toBe(true);
    expect(canDo(admin.user, "fiscal.files")).toBe(true);
    for (const c of [manager, cashier, stockist]) await expect(spedOf(c)).rejects.toThrow(/permissão|Fiscal/i);
    // download do arquivo guardado: consulta do fiscal + fiscal.files
    const meta = { entityType: "fiscal_file", kind: "sped_fiscal", bucket: "documents" };
    expect(fileAccessDenial(fiscal.user, meta)).toBeNull();
    expect(fileAccessDenial(manager.user, meta)).toMatch(/arquivos fiscais/);
    // perfis de sistema já gravados recebem a operação nova pela sincronização dos modelos
    expect(ACTIONS_ADDED_TO_TEMPLATES).toContain("fiscal.files");
    expect(templateSyncPlan({ system: true, key: "fiscal", actions: ["fiscal.issue"], templateActions: [] })?.missing).toContain("fiscal.files");
    expect(templateSyncPlan({ system: true, key: "firm_admin", actions: [], templateActions: [] })?.missing).toContain("fiscal.files");
  });

  it("recurso desligado: geração recusada", async () => {
    await setSetting(store, refs.company.id, null, "feature.arquivosFiscais", false);
    await expect(spedOf(fiscal)).rejects.toThrow(/desligad/);
    await setSetting(store, refs.company.id, null, "feature.arquivosFiscais", true);
  });

  it("pacote contábil sem arquivo gerado: igual ao de antes (sem pasta sped)", async () => {
    const pkg = await buildAccountingPackage(admin, { from: monthStart(today()), to: today(), branchId: null, includeSimulated: true });
    expect(pkg.spedFiles).toBeUndefined();
    const zip = await JSZip.loadAsync((await readFile(admin, pkg.fileId)).data);
    expect(Object.keys(zip.files).some((n) => n.startsWith("sped/"))).toBe(false);
  });
});

describe("§41 — EFD ICMS/IPI do mês da demonstração (Simples Nacional)", () => {
  let cancelledKey = "";

  beforeAll(async () => {
    // NF-e autorizada e cancelada (COD_SIT 02) e faixa inutilizada (COD_SIT 05)
    const mercado = refs.customers.mercado;
    let d = await saveNfe(
      fiscal,
      {
        branchId: refs.branches.matriz.id, origin: { type: "manual" }, nature: "Venda de mercadoria", purpose: "normal", operationType: "saida", presence: "1", recipient: partyRecipient(mercado, "customer"),
        items: [{ skuId: refs.skus["caneca-u"].id, qty: 1000, unitPrice: 3490, discount: 0 }], freight: 0, insurance: 0, other: 0, transport: { mode: "9" }, payments: [{ kind: "cash", amount: 3490 }], referencedKeys: [], effects: { stock: false, financial: false },
      },
      { idemKey: "sped-cancelada", transmit: true },
    );
    if (d.status === "processing") d = await queryDocument(fiscal, d.id);
    expect(d.status).toBe("authorized");
    d = await cancelDocument(fiscal, d.id, "Cancelamento para teste do arquivo SPED fiscal");
    expect(d.status).toBe("cancelled");
    cancelledKey = d.accessKey;
    await disableNumbers(fiscal, { branchId: refs.branches.matriz.id, model: "nfe", series: "1", from: 900, to: 901, justification: "Inutilização para teste do arquivo SPED fiscal" });
  });

  it("estrutura válida: blocos abrem e fecham, 9900 = linhas de cada registro, 9990 e 9999 = total", async () => {
    const b = await spedOf(fiscal);
    expect(b.blocked).toBeNull();
    expect(checkStructure(b.lines)).toEqual([]);
    expect(b.pendencies.filter((p) => ["structure", "c190_total", "e110", "ref_0150", "ref_0200"].includes(p.code))).toEqual([]);
    const blocks = b.lines.map((l) => fields(l)[0][0]);
    expect([...new Set(blocks)]).toEqual(["0", "B", "C", "D", "E", "G", "H", "K", "1", "9"]);
    for (const [reg, qty] of regs(b.lines, "9900").map((f) => [f[1], Number(f[2])] as const)) expect(b.lines.filter((l) => l.startsWith(`|${reg}|`)).length).toBe(qty);
    expect(Number(fields(b.lines[b.lines.length - 1])[1])).toBe(b.lines.length);
    expect(fields(b.lines[0])).toEqual(["0000", "020", "0", fmtDate(`${period}-01`), expect.any(String), "Intercert Comércio Varejista Ltda (DEMO)", MATRIZ, "", "SP", "110042490114", "3550308", "1234567", "", "A", "1"]);
    expect(regs(b.lines, "0100")[0].slice(1, 4)).toEqual(["Maria Contadora", "52998224725", "1SP123456O0"]);
    // B, G e K sem dados; Simples: aviso de dispensa (gera mesmo assim)
    expect(regs(b.lines, "B001")[0][1]).toBe("1");
    expect(regs(b.lines, "G001")[0][1]).toBe("1");
    expect(regs(b.lines, "K001")[0][1]).toBe("1");
    expect(regs(b.lines, "1010")[0].slice(1)).toEqual(Array(13).fill("N"));
    expect(b.pendencies.find((p) => p.code === "simples")?.severity).toBe("warning");
    // participantes e itens referenciados existem no bloco 0 — e só eles
    const parts = new Set(regs(b.lines, "0150").map((f) => f[1]));
    for (const g of c100Groups(b.lines)) if (g.c100[3]) expect(parts.has(g.c100[3])).toBe(true);
    const items = new Set(regs(b.lines, "0200").map((f) => f[1]));
    for (const f of regs(b.lines, "C170")) expect(items.has(f[2])).toBe(true);
    expect(regs(b.lines, "0150").every((f) => b.lines.some((l) => l.startsWith("|C100|") && fields(l)[3] === f[1]) || b.lines.some((l) => l.startsWith("|D100|") && fields(l)[3] === f[1]))).toBe(true);
  });

  it("C100/C190 das NF-e e NFC-e emitidas batem com os documentos (NFC-e sem C170 e sem participante)", async () => {
    const b = await spedOf(fiscal);
    const groups = c100Groups(b.lines);
    const { start, end } = { start: `${period}-01`, end: today() };
    const docs = (await listAll(store, "fiscal_documents", { filters: [["eq", "branchId", refs.branches.matriz.id], ["eq", "status", "authorized"], ["eq", "model", ["nfe", "nfce"]]] })).filter((d: Doc) => toLocalDate(d.issuedAt) >= start && toLocalDate(d.issuedAt) <= end && d.originType !== "disable");
    expect(docs.length).toBeGreaterThan(2);
    expect(docs.some((d) => d.model === "nfce")).toBe(true);
    for (const d of docs) {
      const g = groups.find((x) => x.c100[8] === d.accessKey);
      expect(g, `documento ${d.model} ${d.number}`).toBeTruthy();
      expect(g!.c100.slice(1, 8)).toEqual([d.operationType === "entrada" ? "0" : "1", "0", d.model === "nfce" ? "" : expect.any(String), d.model === "nfce" ? "65" : "55", "00", String(d.series), String(d.number)]);
      expect(cents(g!.c100[11])).toBe(d.total);
      expect(g!.c190.reduce((a, f) => a + cents(f[4]), 0)).toBe(d.total);
      expect(g!.c190.reduce((a, f) => a + cents(f[6]), 0)).toBe(d.totals?.icms ?? 0);
      if (d.model === "nfce") {
        expect(g!.c170).toEqual([]);
        expect(g!.c100[3]).toBe("");
        expect(g!.c100.slice(22)).toEqual(["", "", "", "", "", "", ""]);
      } else expect(g!.c170).toEqual([]); // emissão própria: sem C170
    }
  });

  it("cancelada com COD_SIT 02 (só chave, sem C190) e inutilizada com COD_SIT 05 (um C100 por número, sem chave)", async () => {
    const b = await spedOf(fiscal);
    const groups = c100Groups(b.lines);
    const canc = groups.find((g) => g.c100[8] === cancelledKey)!;
    expect(canc.c100[5]).toBe("02");
    expect(canc.c100.slice(9).every((x) => x === "")).toBe(true);
    expect(canc.c190).toEqual([]);
    const inut = groups.filter((g) => g.c100[5] === "05");
    expect(inut.map((g) => [g.c100[4], g.c100[6], g.c100[7], g.c100[8]])).toEqual([
      ["55", "1", "900", ""],
      ["55", "1", "901", ""],
    ]);
  });

  it("entradas dos recebimentos concluídos com chave (C100 + C170 + C190); nota a confirmar pendente fica fora e vira pendência", async () => {
    const b = await spedOf(fiscal);
    const receipts = (await listAll(store, "receipts", { filters: [["eq", "branchId", refs.branches.matriz.id], ["eq", "status", "confirmed"]] })).filter((r: Doc) => toLocalDate(r.confirmedAt) >= `${period}-01`);
    const withKey = receipts.filter((r) => r.nfeKey && r.documentStatus !== "pending_invoice");
    const pending = receipts.filter((r) => r.documentStatus === "pending_invoice");
    expect(withKey.length).toBeGreaterThan(0);
    expect(pending.length).toBeGreaterThan(0);
    const groups = c100Groups(b.lines);
    for (const r of withKey) {
      const g = groups.find((x) => x.c100[8] === r.nfeKey)!;
      expect(g.c100.slice(1, 6)).toEqual(["0", "1", r.emitter.cnpj, "55", "00"]);
      expect(g.c100[10]).toBe(fmtDate(toLocalDate(r.confirmedAt)));
      expect(g.c170.length).toBeGreaterThan(0);
      expect(g.c190.reduce((a, f) => a + cents(f[4]), 0)).toBe(cents(g.c100[11]));
      // Simples: entrada sem crédito de ICMS
      expect(g.c190.every((f) => cents(f[6]) === 0)).toBe(true);
    }
    for (const r of pending) {
      expect(b.pendencies.some((p) => p.code === "pending_invoice" && p.message.includes(`nº ${r.number}`))).toBe(true);
      if (r.nfeKey) expect(groups.some((g) => g.c100[8] === r.nfeKey)).toBe(false);
    }
    expect(b.docs.entries).toBe(withKey.length);
  });

  it("formato: ISO-8859-1, CRLF, vírgula decimal sem milhar e datas DDMMAAAA", async () => {
    const b = await spedOf(fiscal);
    const buf = toLatin1(b.lines);
    const text = buf.toString("latin1");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n").length).toBe(b.lines.length + 1);
    expect(/[^\r]\n/.test(text)).toBe(false);
    // "Comércio" em ISO-8859-1: é = 0xE9 (um byte), sem a sequência UTF-8 C3 A9
    expect(buf.includes(Buffer.from([0xe9]))).toBe(true);
    expect(buf.includes(Buffer.from([0xc3, 0xa9]))).toBe(false);
    for (const g of c100Groups(b.lines)) {
      if (g.c100[5] !== "00") continue;
      expect(g.c100[11]).toMatch(/^\d+,\d{2}$/);
      expect(g.c100[9]).toMatch(/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])\d{4}$/);
    }
    expect(fmtMoney(123456789)).toBe("1234567,89");
    expect(fmtMoney(-5)).toBe("-0,05");
  });

  it("H010 = inventário em data-base (pedido na tela) e H005 com o total", async () => {
    const date = today();
    const b = await spedOf(fiscal, { inventoryDate: date });
    expect(b.inventoryDate).toBe(date);
    const inv = await fiscalInventory(store, refs.company.id, { date, branchIds: [refs.branches.matriz.id] });
    const bySku = new Map<string, { qty: number; value: number }>();
    for (const r of inv.rows.filter((x) => !x.negative)) {
      const g = bySku.get(r.skuCode) ?? { qty: 0, value: 0 };
      g.qty += r.qty;
      g.value += r.value;
      bySku.set(r.skuCode, g);
    }
    const h010 = regs(b.lines, "H010");
    expect(h010.length).toBe([...bySku.values()].filter((g) => g.qty > 0).length);
    for (const f of h010) {
      const g = bySku.get(f[1])!;
      expect(Math.round(Number(f[3].replace(",", ".")) * 1000)).toBe(g.qty);
      expect(cents(f[5])).toBe(g.value);
      expect(f[6]).toBe("0");
    }
    const h005 = regs(b.lines, "H005")[0];
    expect(h005).toEqual(["H005", fmtDate(date), fmtMoney(inv.rows.filter((x) => !x.negative).reduce((a, r) => a + r.value, 0)), "01"]);
    expect(regs(b.lines, "H001")[0][1]).toBe("0");
    // itens do inventário no 0200
    const items = new Set(regs(b.lines, "0200").map((f) => f[1]));
    expect(h010.every((f) => items.has(f[1]))).toBe(true);
    // sem data (fora de fevereiro): H001 sem dados
    expect(regs((await spedOf(fiscal)).lines, "H001")[0][1]).toBe("1");
    expect((await spedOf(fiscal, { inventoryDate: "" })).inventoryDate).toBeNull();
  });

  it("geração: pendência de erro exige confirmação; mesmo período gera o mesmo conteúdo (idempotente)", async () => {
    // o escritório da demonstração tem CNPJ fictício: pendência de erro no 0100
    const pre = await spedOf(fiscal);
    expect(pre.pendencies.some((p) => p.severity === "error")).toBe(true);
    await expect(generateFiscalFile(fiscal, { kind: "sped_fiscal", period, branchId: refs.branches.matriz.id })).rejects.toThrow(/pendência/);
    const a = await generateFiscalFile(fiscal, { kind: "sped_fiscal", period, branchId: refs.branches.matriz.id, acceptPendencies: true });
    const b = await generateFiscalFile(fiscal, { kind: "sped_fiscal", period, branchId: refs.branches.matriz.id, acceptPendencies: true });
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect(b.fileId).toBe(a.fileId);
    const stored = (await readFile(fiscal, a.fileId)).data;
    expect(stored.equals(toLatin1((await spedOf(fiscal)).lines))).toBe(true);
    expect(a.fileName).toBe(`SPED-EFD-ICMS-IPI_${MATRIZ}_${period.replace("-", "")}.txt`);
    // histórico e pacote contábil com o último arquivo do período
    expect((await latestFilesForPackage(admin, { from: `${period}-01`, to: today(), branchId: null })).map((f) => f.id)).toEqual([a.fileId]);
    const pkg = await buildAccountingPackage(admin, { from: monthStart(today()), to: today(), branchId: null, includeSimulated: true });
    expect(pkg.spedFiles).toBe(1);
    const zip = await JSZip.loadAsync((await readFile(admin, pkg.fileId)).data);
    expect(Object.keys(zip.files)).toContain(`sped/${a.fileName}`);
    expect(await zip.file("LEIA-ME.txt")!.async("string")).toMatch(/VALIDAR NO PVA/);
  });

  it("EFD Contribuições: empresa do Simples Nacional é bloqueada com mensagem clara", async () => {
    const b = await buildFiscalFile(fiscal, { kind: "efd_contribuicoes", period });
    expect(b.blocked).toMatch(/Simples Nacional não entrega a EFD Contribuições/);
    expect(b.lines).toEqual([]);
    await expect(generateFiscalFile(fiscal, { kind: "efd_contribuicoes", period, acceptPendencies: true })).rejects.toThrow(/Simples Nacional/);
  });
});

/** NF-e/NFC-e de regime normal gravadas como documentos emitidos (fixture), com ICMS 18% e PIS/COFINS cumulativos. */
async function putIssued(n: number, o: { model: "nfe" | "nfce"; sku: string; qty: number; price: number; cfop?: string; difal?: { dest: number; fcp: number }; st?: number; uf?: string }) {
  const sku = refs.skus[o.sku];
  const net = roundDiv(o.qty * o.price, 1000);
  const icms = roundDiv(net * 1800, 10000);
  const pis = roundDiv(net * 65, 10000);
  const cofins = roundDiv(net * 300, 10000);
  const st = o.st ?? 0;
  const item = {
    seq: 1, skuId: sku.id, productId: sku.productId, code: sku.sku, description: sku.name, ncm: "61091000", cfop: o.cfop ?? "5102", unit: "UN", qty: o.qty, unitPrice: o.price, gross: net, discount: 0, freight: 0, insurance: 0, other: 0, total: net,
    origin: "0", cstCsosn: st ? "10" : "00", icmsRateBps: 1800, icmsBase: net, icms, pisCst: "01", pisBase: net, pisRateBps: 65, pis, cofinsCst: "01", cofinsBase: net, cofinsRateBps: 300, cofins,
    ...(o.difal || st ? { tc: { ...(o.difal ? { difal: { mode: "fora", base: net, fcpBase: net, fcpRateBps: 200, internalRateBps: 1800, interRateBps: 700, partBps: 10000, fcp: o.difal.fcp, dest: o.difal.dest, remet: 0 } } : {}), ...(st ? { st: { mvaBps: 4000, mvaAdjusted: false, redBps: 0, base: net * 2, rateBps: 1800, value: st, fcpBase: 0, fcpRateBps: 0, fcp: 0 } } : {}) } } : {}),
  };
  const mercado = refs.customers.mercado;
  const key = `3526101122233300018155${o.model === "nfce" ? "65" : "55"}009${String(n).padStart(9, "0")}1${String(n).padStart(8, "0")}`.slice(0, 43) + "0";
  return store.create("fiscal_documents", {
    companyId: refs.company.id, branchId: refs.branches.matriz.id, model: o.model, ref: `sped-fixture-${n}`, series: "9", number: n, accessKey: key, status: "authorized", originType: "manual", operationType: "saida", purpose: "normal",
    recipient: o.model === "nfe" ? { name: mercado.name, doc: mercado.doc, ie: mercado.ie, address: { ...(mercado.addresses?.[0] ?? {}), uf: o.uf ?? "SP" } } : null, recipientName: o.model === "nfe" ? mercado.name : null, recipientDoc: o.model === "nfe" ? mercado.doc : null,
    items: [item], totals: { products: net, discount: 0, freight: 0, insurance: 0, other: 0, icmsBase: net, icms, pis, cofins, total: net + st, ...(o.difal ? { icmsUfDest: o.difal.dest, fcpUfDest: o.difal.fcp, icmsUfRemet: 0 } : {}), ...(st ? { icmsStBase: net * 2, icmsSt: st, fcpSt: 0 } : {}) },
    payments: [{ kind: "cash", amount: net + st }], total: net + st, issuedAt: nowIso(), authorizedAt: nowIso(), isSimulated: false, environment: "producao",
  });
}

describe("§41 — regime normal (Lucro Presumido): apuração do ICMS, CT-e e EFD Contribuições", () => {
  let receiptCredit = 0;
  let cteIcms = 0;
  let fixtures: Doc[] = [];

  beforeAll(async () => {
    await store.update("companies", refs.company.id, { regime: "presumido", crt: "3" });
    fixtures = [
      await putIssued(7001, { model: "nfe", sku: "camiseta-m-preta", qty: 10000, price: 5000 }),
      await putIssued(7002, { model: "nfce", sku: "bone-u", qty: 2000, price: 4000 }),
      await putIssued(7003, { model: "nfe", sku: "caneca-u", qty: 5000, price: 3000, cfop: "6108", difal: { dest: 1650, fcp: 300 }, uf: "BA" }),
      await putIssued(7004, { model: "nfe", sku: "camiseta-m-preta", qty: 1000, price: 10000, cfop: "5403", st: 1440 }),
    ];
    // entrada tributada (CST 00 com 18% → crédito; CFOP 5405 → 1403 sem crédito) e CT-e do frete com ICMS 12%
    const camiseta = refs.skus["camiseta-m-preta"];
    const bone = refs.skus["bone-u"];
    const xml = buildSampleNfeXml({
      number: 77001, issueDate: today(), emitter: { cnpj: refs.suppliers.textil.doc, name: refs.suppliers.textil.name, ie: "110042490999" }, recipient: { cnpj: MATRIZ, name: refs.company.name },
      items: [
        { cProd: "T-CAM", cEAN: camiseta.barcode, xProd: camiseta.name, cfop: "5102", qCom: 10000, vUnCom: 2000, icms: { vBC: 20000, pICMS: 1800, vICMS: 3600 } },
        { cProd: "T-BON", cEAN: bone.barcode, xProd: bone.name, cfop: "5405", qCom: 5000, vUnCom: 1600, icms: { vBC: 8000, pICMS: 1800, vICMS: 1440, vBCST: 16000, pICMSST: 1800, vICMSST: 900 } },
      ],
    });
    const r = await importNfeXml(stockist, { xml, withoutOrder: true, allowHomologation: true });
    await updateReceipt(stockist, r.id, { checkAll: true });
    await confirmReceipt(stockist, r.id);
    receiptCredit = 3600;
    const cte = await importCteXml(admin, { xml: buildSampleCteXml({ number: 8801, issueDate: today(), emitter: { cnpj: "19131243000197", name: "Rápido Transportes Ltda" }, sender: { cnpj: refs.suppliers.textil.doc, name: "Têxtil" }, recipient: { cnpj: MATRIZ, name: refs.company.name }, total: 10000, icms: { vBC: 10000, pICMS: 1200, vICMS: 1200 }, nfeKeys: [r.nfeKey] }), allowHomologation: true });
    expect(cte.status).toBe("registered");
    cteIcms = 1200;
  });

  it("CT-e de entrada no bloco D (D100 + D190 com crédito) e participante da transportadora no 0150", async () => {
    const b = await spedOf(fiscal);
    const d100 = regs(b.lines, "D100");
    const cte = (await listAll(store, "inbound_ctes", { filters: [["eq", "cteNumber", "8801"]] }))[0];
    const row = d100.find((f) => f[9] === cte.cteKey)!;
    expect(row.slice(1, 9)).toEqual(["0", "1", "19131243000197", "57", "00", "1", "", "8801"]);
    expect([cents(row[14]), cents(row[18]), cents(row[19])]).toEqual([10000, 10000, 1200]);
    expect(row[23]).toBe("3550308");
    const idx = b.lines.findIndex((l) => l.includes(`|${cte.cteKey}|`));
    expect(fields(b.lines[idx + 1])).toEqual(["D190", "000", "1353", "12,00", "100,00", "100,00", "12,00", "0,00", ""]);
    expect(regs(b.lines, "0150").some((f) => f[1] === "19131243000197")).toBe(true);
    expect(regs(b.lines, "D001")[0][1]).toBe("0");
  });

  it("E110 = débitos (C190 de saída) − créditos (C190/D190 de entrada), E116 a recolher; ST (E200/E210) e DIFAL (C101, E300/E310)", async () => {
    const b = await spedOf(fiscal);
    const c190 = regs(b.lines, "C190");
    const d190 = regs(b.lines, "D190");
    const debits = c190.filter((f) => /^[567]/.test(f[2])).reduce((a, f) => a + cents(f[6]), 0);
    const credits = [...c190, ...d190].filter((f) => /^[123]/.test(f[2])).reduce((a, f) => a + cents(f[6]), 0);
    const expectedDebits = fixtures.reduce((a, d) => a + d.totals.icms, 0);
    expect(debits).toBe(expectedDebits);
    expect(credits).toBe(receiptCredit + cteIcms);
    const e110 = regs(b.lines, "E110")[0];
    expect(cents(e110[1])).toBe(debits);
    expect(cents(e110[5])).toBe(credits);
    expect(cents(e110[10])).toBe(debits - credits);
    expect(cents(e110[12])).toBe(debits - credits);
    expect(cents(e110[13])).toBe(0);
    expect(b.apuracao).toMatchObject({ debits, credits, toPay: debits - credits, carryOut: 0 });
    const e116 = regs(b.lines, "E116")[0];
    expect(e116[1]).toBe("000");
    expect(cents(e116[2])).toBe(debits - credits);
    expect(e116[4]).toBe("046-2");
    expect(e116[3].slice(0, 2)).toBe("20");
    expect(e116[9]).toBe(`${period.slice(5, 7)}${period.slice(0, 4)}`);
    // entrada: CST 00 com crédito; CST 10 com CFOP 1403 (ST) sem crédito
    const entry = c100Groups(b.lines).find((g) => g.c100[7] === "77001")!;
    expect(entry.c170.map((f) => [f[9], f[10], cents(f[14])])).toEqual([
      ["000", "1102", 3600],
      ["010", "1403", 0],
    ]);
    // ST retido nas saídas
    expect(regs(b.lines, "E200")).toEqual([["E200", "SP", fmtDate(`${period}-01`), expect.any(String)]]);
    expect(cents(regs(b.lines, "E210")[0][7])).toBe(1440);
    expect(regs(b.lines, "E250")[0].slice(1, 3)).toEqual(["002", "14,40"]);
    // DIFAL: C101 no documento e E300/E310 da UF de destino
    const difal = c100Groups(b.lines).find((g) => g.c100[7] === "7003")!;
    expect(difal.c101).toEqual([["C101", "3,00", "16,50", "0,00"]]);
    expect(regs(b.lines, "E300")[0][1]).toBe("BA");
    const e310 = regs(b.lines, "E310")[0];
    expect([cents(e310[3]), cents(e310[9]), cents(e310[13]), cents(e310[19])]).toEqual([1650, 1650, 300, 300]);
    expect(regs(b.lines, "E316").map((f) => [f[1], f[4]])).toEqual([
      ["000", "0759"],
      ["006", "0759"],
    ]);
    expect(checkStructure(b.lines)).toEqual([]);
    expect(b.pendencies.filter((p) => ["structure", "c190_total", "e110", "recolhimento"].includes(p.code))).toEqual([]);
  });

  it("saldo credor: créditos maiores que os débitos vão para o 'a transportar' e entram no mês seguinte", async () => {
    const b = await spedOf(fiscal, { creditCarry: 10_000_000 });
    expect(b.apuracao?.toPay).toBe(0);
    expect(b.apuracao?.carryOut).toBe(10_000_000 - (b.apuracao!.debits - b.apuracao!.credits));
    expect(regs(b.lines, "E116")).toEqual([]);
    expect(checkStructure(b.lines)).toEqual([]);
  });

  it("EFD Contribuições (cumulativo): 0110, 0140 por estabelecimento, C100/C170 da NF-e, C175 da NFC-e, A100 da NFS-e e M200/M600 = bases × alíquotas", async () => {
    const b = await buildFiscalFile(fiscal, { kind: "efd_contribuicoes", period });
    expect(b.blocked).toBeNull();
    expect(checkStructure(b.lines)).toEqual([]);
    expect(fields(b.lines[0]).slice(0, 3)).toEqual(["0000", "006", "0"]);
    expect(regs(b.lines, "0110")[0]).toEqual(["0110", "2", "", "1", "9"]);
    expect(regs(b.lines, "0140").length).toBe((await listAll(store, "branches", { filters: [["eq", "companyId", refs.company.id]] })).length);
    expect([...new Set(b.lines.map((l) => fields(l)[0][0]))]).toEqual(["0", "A", "C", "D", "F", "I", "M", "P", "1", "9"]);
    // bases: itens de saída com CST 01 (documentos do período, todas as filiais) + NFS-e autorizadas
    const { start } = { start: `${period}-01` };
    const own = (await listAll(store, "fiscal_documents", { filters: [["eq", "companyId", refs.company.id], ["eq", "status", "authorized"]] })).filter((d: Doc) => toLocalDate(d.issuedAt) >= start && d.operationType !== "entrada");
    const goods = own.filter((d) => d.model !== "nfse").flatMap((d) => d.items ?? []).filter((i: any) => i.pisCst === "01").reduce((a: number, i: any) => a + i.pisBase, 0);
    const services = own.filter((d) => d.model === "nfse").reduce((a, d) => a + d.service.amount - (d.service.unconditionalDiscount ?? 0), 0);
    expect(services).toBeGreaterThan(0);
    const base = goods + services;
    expect(b.contrib).toMatchObject({ regime: "cumulative", pisBase: base, cofinsBase: base, pis: roundDiv(base * 65, 10000), cofins: roundDiv(base * 300, 10000) });
    const m210 = regs(b.lines, "M210");
    expect(m210.length).toBe(1);
    expect([m210[0][1], cents(m210[0][3]), m210[0][7], cents(m210[0][15])]).toEqual(["51", base, "0,65", roundDiv(base * 65, 10000)]);
    const m200 = regs(b.lines, "M200")[0];
    expect([cents(m200[8]), cents(m200[11]), cents(m200[12])]).toEqual([roundDiv(base * 65, 10000), roundDiv(base * 65, 10000), roundDiv(base * 65, 10000)]);
    const m600 = regs(b.lines, "M600")[0];
    expect(cents(m600[12])).toBe(roundDiv(base * 300, 10000));
    expect(regs(b.lines, "M205")[0].slice(1)).toEqual(["12", "810902", fmtMoney(roundDiv(base * 65, 10000))]);
    // NFC-e: C100 modelo 65 + C175 (sem C170); NF-e: C170
    const nfce = b.lines.findIndex((l) => l.startsWith("|C100|") && fields(l)[4] === "65" && fields(l)[7] === "7002");
    expect(fields(b.lines[nfce + 1])[0]).toBe("C175");
    expect(fields(b.lines[nfce + 1]).slice(1, 6)).toEqual(["5102", "80,00", "0,00", "01", "80,00"]);
    const nfe = b.lines.findIndex((l) => l.startsWith("|C100|") && fields(l)[4] === "55" && fields(l)[7] === "7001");
    expect(fields(b.lines[nfe + 1]).slice(0, 3)).toEqual(["C170", "1", "CAMISETA-M-PRETA"]);
    expect(regs(b.lines, "A100").length).toBe(own.filter((d) => d.model === "nfse").length);
    // cumulativo: entradas não são escrituradas
    expect(b.lines.some((l) => l.startsWith("|C100|0|1|"))).toBe(false);
    // idempotência
    expect((await buildFiscalFile(fiscal, { kind: "efd_contribuicoes", period })).lines).toEqual(b.lines);
  });

  it("EFD Contribuições (não cumulativo — Lucro Real): créditos das entradas (M100/M500) descontados da contribuição", async () => {
    await store.update("companies", refs.company.id, { regime: "real" });
    try {
      const b = await buildFiscalFile(fiscal, { kind: "efd_contribuicoes", period });
      expect(regs(b.lines, "0110")[0]).toEqual(["0110", "1", "1", "1", ""]);
      expect(checkStructure(b.lines)).toEqual([]);
      const m100 = regs(b.lines, "M100")[0];
      expect(m100[1]).toBe("101");
      const credit = cents(m100[7]);
      expect(credit).toBeGreaterThan(0);
      const m200 = regs(b.lines, "M200")[0];
      expect(cents(m200[1]) - cents(m200[2])).toBe(cents(m200[4]));
      expect(cents(m200[12])).toBe(b.contrib!.pisDue);
      expect(b.contrib!.pisDue).toBe(b.contrib!.pis - b.contrib!.pisCredit);
      expect(b.lines.some((l) => l.startsWith("|C100|0|1|"))).toBe(true);
    } finally {
      await store.update("companies", refs.company.id, { regime: "presumido" });
    }
  });
});
