import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import JSZip from "jszip";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import "@/domain/jobs-registry";
import { listAll, detId } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { runDueJobs } from "@/lib/core/jobs";
import { readFile } from "@/lib/core/files";
import { calcNfse, cancelDocument, correctionLetter, createNfse, disableNumbers, getFiscalConfig, numberingGaps, queryDocument, retransmit, retransmitBatch, saveFiscalConfig, submitDraft, testFiscalConnection, transmitDocument } from "@/domain/fiscal/service";
import { saveNfe, refreshFromCatalog, type NfeInput } from "@/domain/fiscal/nfe";
import { FocusNfeProvider } from "@/domain/fiscal/providers";
import { parsePfx } from "@/domain/fiscal/config";
import { buildAccountingPackage } from "@/domain/fiscal/export";
import { completeObligation, generateObligations, listObligations } from "@/domain/fiscal/obligations";
import { periodDocuments, summarize, outputBook } from "@/domain/fiscal/reports";
import { finalizeSale, cancelSale } from "@/domain/sales";
import { openSession } from "@/domain/cash";
import { today, monthStart } from "@/lib/dates";

let store: Store;
let refs: DemoRefs;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
}, 60000);

const adminCtx = () => refs.ctxFor("admin", "matriz");

function nfeInput(skuKey: string, over: Partial<NfeInput> = {}): NfeInput {
  const c = refs.customers.mercado;
  const sku = refs.skus[skuKey];
  return {
    branchId: refs.branches.matriz.id,
    origin: { type: "manual" },
    nature: "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: "1",
    recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] },
    items: [{ skuId: sku.id, qty: 2000, unitPrice: 5000, discount: 0 }],
    freight: 0,
    insurance: 0,
    other: 0,
    transport: { mode: "9" },
    payments: [{ kind: "boleto", amount: 10000 }],
    referencedKeys: [],
    effects: { stock: false, financial: false },
    ...over,
  };
}

async function productWithNcm(key: string, ncm: string) {
  const sd = refs.seeder;
  const p = await sd.put("products", key, { companyId: refs.company.id, type: "product", code: key.toUpperCase(), name: `Produto teste ${key}`, unitCode: "UN", ncm, origin: "0", taxGroupId: refs.products.caneca.taxGroupId, status: "active", active: true });
  const s = await sd.put("skus", `${key}-u`, { companyId: refs.company.id, productId: p.id, sku: key.toUpperCase(), name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
  refs.skus[`${key}-u`] = s;
  return { p, s };
}

describe("NF-e: rejeição/pendência → correção → retransmissão com a mesma referência", () => {
  it("rejeitada por NCM inexistente: corrige cadastro, retransmite sem novo documento, consulta e autoriza, cancela", async () => {
    const ctx = await adminCtx();
    const { p } = await productWithNcm("ncmruim", "00000000");
    let doc = await saveNfe(ctx, nfeInput("ncmruim-u"), { idemKey: "t-rej-1", transmit: true });
    expect(doc.status).toBe("rejected");
    expect(doc.statusMessage).toMatch(/778/);
    expect(doc.authorizedAt ?? null).toBeNull();
    const number = doc.number;
    expect(number).toBeGreaterThan(0);
    // correção no cadastro do produto e atualização do documento
    await store.update("products", p.id, { ncm: "69120000" });
    const r = await refreshFromCatalog(ctx, doc.id);
    expect(r.changes.join(" ")).toMatch(/NCM 00000000→69120000/);
    doc = await retransmit(ctx, doc.id);
    expect(doc.status).toBe("processing"); // NF-e: lote em processamento — nunca "autorizada" sem retorno
    expect(doc.number).toBe(number);
    expect(doc.ref).toBe("nfe-t-rej-1");
    const all = await listAll(store, "fiscal_documents", { filters: [["eq", "ref", "nfe-t-rej-1"]] });
    expect(all).toHaveLength(1);
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
    expect(doc.protocol).toBeTruthy();
    expect(doc.accessKey).toHaveLength(44);
    expect(doc.xmlFileId).toBeTruthy();
    const xml = await readFile(ctx, doc.xmlFileId);
    expect(xml.data.toString()).toMatch(/SIMULAÇÃO/);
    // carta de correção (somente autorizada)
    doc = await correctionLetter(ctx, doc.id, "Corrige o complemento do endereço do destinatário para sala 2");
    expect(doc.correctionCount).toBe(1);
    const cce = await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "cce"]] });
    expect(cce).toHaveLength(1);
    // cancelamento suportado
    await expect(cancelDocument(ctx, doc.id, "curta")).rejects.toThrow(/15 caracteres/);
    doc = await cancelDocument(ctx, doc.id, "Cliente desistiu da compra após a emissão");
    expect(doc.status).toBe("cancelled");
    await expect(correctionLetter(ctx, doc.id, "Correção após cancelamento não pode")).rejects.toThrow();
  });

  it("pendente por NCM ausente (validação prévia) não é transmitida; após correção é transmitida com a mesma referência", async () => {
    const ctx = await adminCtx();
    const { p } = await productWithNcm("semncm", "");
    let doc = await saveNfe(ctx, nfeInput("semncm-u"), { idemKey: "t-pend-1", transmit: true });
    expect(doc.status).toBe("pending");
    expect(doc.attempts ?? 0).toBe(0);
    expect(doc.statusMessage).toMatch(/NCM ausente/);
    await store.update("products", p.id, { ncm: "48202000" });
    await refreshFromCatalog(ctx, doc.id);
    doc = await submitDraft(ctx, doc.id);
    expect(doc.status).toBe("processing");
    expect(doc.attempts).toBe(1);
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
    expect((await listAll(store, "fiscal_documents", { filters: [["eq", "ref", "nfe-t-pend-1"]] })).length).toBe(1);
  });

  it("operação avulsa aplica estoque e título uma única vez na autorização e reverte no cancelamento", async () => {
    const ctx = await adminCtx();
    const sku = refs.skus["caneca-u"];
    const wh = refs.warehouses["matriz-main"];
    const balBefore = (await store.get("stock_balances", detId("bal", wh.id, sku.id)))!.physical;
    let doc = await saveNfe(ctx, nfeInput("caneca-u", { effects: { stock: true, financial: true, dueDate: today() } }), { idemKey: "t-eff-1", transmit: true });
    expect(doc.status).toBe("processing");
    // nada aplicado antes da autorização
    expect((await store.get("stock_balances", detId("bal", wh.id, sku.id)))!.physical).toBe(balBefore);
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
    doc = await queryDocument(ctx, doc.id); // consulta repetida não duplica efeitos
    const movs = await listAll(store, "stock_movements", { filters: [["eq", "originType", "fiscal_document"], ["eq", "originId", doc.id]] });
    expect(movs).toHaveLength(1);
    expect((await store.get("stock_balances", detId("bal", wh.id, sku.id)))!.physical).toBe(balBefore - 2000);
    const titles = await listAll(store, "titles", { filters: [["eq", "originType", "fiscal_document"], ["eq", "originId", doc.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0].total).toBe(10000);
    doc = await cancelDocument(ctx, doc.id, "Erro de digitação no pedido do cliente");
    expect(doc.status).toBe("cancelled");
    expect((await store.get("stock_balances", detId("bal", wh.id, sku.id)))!.physical).toBe(balBefore);
    expect((await store.get("titles", titles[0].id))!.status).toBe("cancelled");
  });
});

describe("NFC-e da venda", () => {
  it("cancelamento de venda com NFC-e autorizada enfileira o cancelamento fiscal; retransmissão não duplica", async () => {
    const ctx = await adminCtx();
    await openSession(ctx, { terminalId: refs.terminals.cx1.id, openingFund: 10000 });
    const sale = await finalizeSale(ctx, { idemKey: "t-sale-nfce-1", terminalId: refs.terminals.cx1.id, items: [{ skuId: refs.skus["bone-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 4490, received: 5000 }] });
    await runDueJobs(store, { limit: 50 });
    await runDueJobs(store, { limit: 50 });
    let s = (await store.get("sales", sale.id))!;
    expect(s.fiscalStatus).toBe("authorized");
    const docId = s.fiscalDocumentId;
    const nfce = (await store.get("fiscal_documents", docId))!;
    expect(nfce.model).toBe("nfce");
    expect(nfce.isSimulated).toBe(true);
    expect(nfce.qrCodeUrl).toMatch(/simulacao\.invalid/);
    expect(nfce.series).toBe("1"); // série do terminal
    // retransmitir documento autorizado é recusado; não cria outro
    await expect(retransmit(ctx, docId)).rejects.toThrow();
    await cancelSale(ctx, sale.id, "Cliente desistiu na saída da loja");
    const job = await store.get("jobs", detId("job", `fiscal-cancel:${docId}`));
    expect(job?.type).toBe("fiscal.cancel");
    expect(job?.status).toBe("pending");
    await runDueJobs(store, { limit: 50 });
    expect((await store.get("fiscal_documents", docId))!.status).toBe("cancelled");
    s = (await store.get("sales", sale.id))!;
    expect(s.fiscalStatus).toBe("cancelled");
    expect((await listAll(store, "fiscal_documents", { filters: [["eq", "originId", sale.id]] })).length).toBe(1);
  });

  it("prazo de cancelamento parametrizado bloqueia cancelamento tardio", async () => {
    const ctx = await adminCtx();
    const sale = await finalizeSale(ctx, { idemKey: "t-sale-nfce-2", terminalId: refs.terminals.cx1.id, items: [{ skuId: refs.skus["meia-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 2990, received: 2990 }] });
    await runDueJobs(store, { limit: 50 });
    await runDueJobs(store, { limit: 50 });
    const docId = (await store.get("sales", sale.id))!.fiscalDocumentId;
    await store.update("fiscal_documents", docId, { authorizedAt: new Date(Date.now() - 31 * 60000).toISOString() });
    await expect(cancelDocument(ctx, docId, "Tentativa de cancelamento fora do prazo")).rejects.toThrow(/Prazo de cancelamento/);
    expect((await store.get("fiscal_documents", docId))!.status).toBe("authorized");
  });

  it("contingência retém a fila e a retransmissão em lote envia sem duplicar", async () => {
    const ctx = await adminCtx();
    const cfg = (await getFiscalConfig(store, refs.company.id, refs.branches.matriz.id))!;
    await saveFiscalConfig(ctx, refs.branches.matriz.id, { contingency: true, contingencyReason: "SEFAZ indisponível (teste)" });
    const sale = await finalizeSale(ctx, { idemKey: "t-sale-cont-1", terminalId: refs.terminals.cx1.id, items: [{ skuId: refs.skus["caderno-u"].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount: 2490, received: 2490 }] });
    await runDueJobs(store, { limit: 50 });
    await runDueJobs(store, { limit: 50 });
    const docId = (await store.get("sales", sale.id))!.fiscalDocumentId;
    let doc = (await store.get("fiscal_documents", docId))!;
    expect(doc.status).toBe("queued");
    expect(doc.contingency).toBe(true);
    expect(doc.attempts ?? 0).toBe(0);
    // indisponibilidade simulada: retransmissão em lote resulta em erro de comunicação (estado real), sem autorizar
    await saveFiscalConfig(ctx, refs.branches.matriz.id, { simulateOutage: true });
    await retransmitBatch(ctx, { model: "nfce", branchId: refs.branches.matriz.id, ids: [docId] });
    doc = (await store.get("fiscal_documents", docId))!;
    expect(doc.status).toBe("error");
    await saveFiscalConfig(ctx, refs.branches.matriz.id, { simulateOutage: false, contingency: false });
    const out = await retransmitBatch(ctx, { model: "nfce", branchId: refs.branches.matriz.id, ids: [docId] });
    expect(out[0].after).toBe("authorized");
    expect((await listAll(store, "fiscal_documents", { filters: [["eq", "originId", sale.id]] })).length).toBe(1);
    expect((await listAll(store, "sales", { filters: [["eq", "idemKey", "t-sale-cont-1"]] })).length).toBe(1);
    void cfg;
  });
});

describe("NFS-e", () => {
  it("calcula base, ISS (calculado ≠ retido), retenções e líquido", () => {
    const c = calcNfse({ amount: 100000, unconditionalDiscount: 10000, deductions: 5000, issRateBps: 500, issWithheld: true, pisBps: 65, cofinsBps: 300, csllBps: 100, irBps: 150, inssBps: 1100, withhold: { pis: true, cofins: true, csll: true, ir: true, inss: false } });
    expect(c.base).toBe(85000); // 1000 − 100 − 50
    expect(c.iss).toBe(4250); // 5% de 850
    expect(c.issWithheldValue).toBe(4250);
    expect(c.pis).toBe(585); // 0,65% de 900
    expect(c.cofins).toBe(2700);
    expect(c.csll).toBe(900);
    expect(c.ir).toBe(1350);
    expect(c.inss).toBe(9900); // calculado mas não retido
    expect(c.federalWithheld).toBe(585 + 2700 + 900 + 1350);
    expect(c.withheld).toBe(4250 + 5535);
    expect(c.net).toBe(90000 - 9785);
    const n = calcNfse({ amount: 50000, issRateBps: 200, issWithheld: false });
    expect(n.iss).toBe(1000);
    expect(n.issWithheldValue).toBe(0);
    expect(n.issDue).toBe(1000);
    expect(n.net).toBe(50000);
    expect(() => calcNfse({ amount: 100, unconditionalDiscount: 200, issRateBps: 100, issWithheld: false })).toThrow();
  });

  it("emite NFS-e (RPS → processamento → autorizada) e gera conta a receber do líquido uma única vez", async () => {
    const ctx = await adminCtx();
    const c = refs.customers.escola;
    let doc = await createNfse(ctx, {
      branchId: refs.branches.matriz.id,
      recipient: { name: c.name, doc: c.doc, email: c.email, im: "998877", address: c.addresses[0] },
      customerId: c.id,
      serviceProductId: refs.products.consultoria.id,
      competence: today(),
      description: "Consultoria de imagem — 2 horas",
      serviceListItem: "17.01",
      municipalCode: "03115",
      calc: { amount: 36000, issRateBps: 500, issWithheld: true, irBps: 150, withhold: { ir: true } },
      createReceivable: { dueDate: today() },
      idemKey: "t-nfse-1",
    });
    await runDueJobs(store, { limit: 20 });
    doc = (await store.get("fiscal_documents", doc.id))!;
    expect(doc.rpsNumber).toBeGreaterThan(0);
    expect(doc.status).toBe("processing");
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
    expect(doc.number).toBeGreaterThan(0);
    expect(doc.verificationCode).toBeTruthy();
    await queryDocument(ctx, doc.id);
    const titles = await listAll(store, "titles", { filters: [["eq", "originId", doc.id]] });
    expect(titles).toHaveLength(1);
    expect(titles[0].total).toBe(36000 - 1800 - 540);
  });
});

describe("Inutilização e lacunas", () => {
  it("inutiliza lacuna de numeração e recusa números usados", async () => {
    const ctx = await adminCtx();
    const { s } = await productWithNcm("lacuna", "00000000");
    const doc = await saveNfe(ctx, nfeInput("lacuna-u"), { idemKey: "t-gap-1", transmit: true });
    expect(doc.status).toBe("rejected");
    await cancelDocument(ctx, doc.id, "Documento rejeitado e abandonado pelo emissor");
    const gaps = await numberingGaps(ctx, refs.branches.matriz.id, "nfe");
    expect(gaps.map((g) => g.number)).toContain(doc.number);
    const used = await listAll(store, "fiscal_documents", { filters: [["eq", "model", "nfe"], ["eq", "status", "cancelled"]] });
    await expect(disableNumbers(ctx, { branchId: refs.branches.matriz.id, model: "nfe", series: "1", from: used[0].number, to: used[0].number, justification: "Tentativa indevida de inutilizar número usado" })).rejects.toThrow(/já utilizados/);
    const inut = await disableNumbers(ctx, { branchId: refs.branches.matriz.id, model: "nfe", series: doc.series, from: doc.number, to: doc.number, justification: "Numeração não utilizada por rejeição abandonada" });
    expect(inut.status).toBe("unused");
    expect(await numberingGaps(ctx, refs.branches.matriz.id, "nfe")).not.toContainEqual(expect.objectContaining({ number: doc.number }));
    void s;
  });
});

describe("Adaptador Focus NFe contra servidor HTTP falso (contrato — não comprova integração real)", () => {
  let server: http.Server;
  let base = "";
  const calls: Array<{ method: string; url: string; auth: string; body: any }> = [];
  const state = new Map<string, number>();
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const auth = String(req.headers.authorization ?? "");
        const body = raw ? JSON.parse(raw) : null;
        calls.push({ method: req.method!, url: req.url!, auth, body });
        const send = (code: number, json: any) => {
          res.writeHead(code, { "Content-Type": "application/json" });
          res.end(JSON.stringify(json));
        };
        if (auth !== "Basic " + Buffer.from("token-bom:").toString("base64")) return send(401, { codigo: "nao_autorizado", mensagem: "Token de acesso inválido" });
        const url = new URL(req.url!, "http://x");
        if (req.method === "GET" && url.pathname.startsWith("/arquivos/")) {
          res.writeHead(200, { "Content-Type": "application/xml" });
          return res.end('<?xml version="1.0"?><nfeProc versao="4.00"><NFe/></nfeProc>');
        }
        if (req.method === "GET" && url.pathname.startsWith("/v2/nfe/teste-conexao")) return send(404, { codigo: "nao_encontrado", mensagem: "Nota fiscal não encontrada" });
        if (req.method === "POST" && url.pathname === "/v2/nfe") {
          const ref = url.searchParams.get("ref")!;
          if (body.items?.some((i: any) => i.codigo_ncm === "11111111")) return send(200, { cnpj_emitente: body.cnpj_emitente, ref, status: "erro_autorizacao", status_sefaz: "778", mensagem_sefaz: "Rejeição: Informado NCM inexistente" });
          state.set(ref, 1);
          return send(202, { cnpj_emitente: body.cnpj_emitente, ref, status: "processando_autorizacao" });
        }
        const m = url.pathname.match(/^\/v2\/nfe\/([^/]+)$/);
        if (req.method === "GET" && m) {
          const ref = decodeURIComponent(m[1]);
          if (!state.has(ref)) return send(404, { codigo: "nao_encontrado", mensagem: "Nota fiscal não encontrada" });
          return send(200, { cnpj_emitente: "11222333000181", ref, status: "autorizado", status_sefaz: "100", mensagem_sefaz: "Autorizado o uso da NF-e", chave_nfe: "NFe35261011222333000181550010000000011000000019", numero: "1", serie: "1", protocolo: "135260000000001", caminho_xml_nota_fiscal: "/arquivos/x-nfe.xml", caminho_danfe: "/arquivos/x.pdf" });
        }
        if (req.method === "DELETE" && m) return send(200, { status_sefaz: "135", mensagem_sefaz: "Evento registrado e vinculado a NF-e", status: "cancelado" });
        send(404, { codigo: "nao_encontrado", mensagem: "rota" });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    delete process.env.FOCUSNFE_BASE_URL;
    delete process.env.FOCUS_TESTE_TOKEN;
  });

  it("mapeia 202/processando, consulta autorizada, rejeição e 401 → erro (nunca rejeição/autorização falsa)", async () => {
    const ok = new FocusNfeProvider("token-bom", "homologacao", base);
    const sent = await ok.send("nfe", "ref-a", { items: [{ codigo_ncm: "69120000" }], cnpj_emitente: "11222333000181" });
    expect(sent.status).toBe("processing");
    expect(sent.httpStatus).toBe(202);
    const q = await ok.query("nfe", "ref-a");
    expect(q.status).toBe("authorized");
    expect(q.accessKey).toBe("35261011222333000181550010000000011000000019");
    expect(q.protocol).toBe("135260000000001");
    const rej = await ok.send("nfe", "ref-b", { items: [{ codigo_ncm: "11111111" }] });
    expect(rej.status).toBe("rejected");
    expect(rej.statusCode).toBe("778");
    const bad = new FocusNfeProvider("token-ruim", "homologacao", base);
    const e = await bad.send("nfe", "ref-c", { items: [] });
    expect(e.status).toBe("error");
    expect(e.message).toMatch(/401/);
    expect((await ok.test("11222333000181")).ok).toBe(true);
    const t = await bad.test("11222333000181");
    expect(t.ok).toBe(false);
    expect(t.message).toMatch(/401/);
    expect(calls.some((c) => c.auth === "Basic " + Buffer.from("token-bom:").toString("base64"))).toBe(true);
  });

  it("fluxo completo pelo serviço: envia, consulta, baixa e guarda o XML; credencial inválida → estado erro", async () => {
    const ctx = await adminCtx();
    process.env.FOCUSNFE_BASE_URL = base;
    process.env.FOCUS_TESTE_TOKEN = "token-bom";
    const branchId = refs.branches.shopping.id;
    await saveFiscalConfig(ctx, branchId, { provider: "focusnfe", environment: "homologacao", tokenRef: "FOCUS_TESTE_TOKEN", nfeEnabled: true, nfceEnabled: true, nfseEnabled: true, nfeSeries: 1, contingency: false });
    const conn = await testFiscalConnection(ctx, branchId);
    expect(conn.status).toBe("operational");
    let doc = await saveNfe(ctx, nfeInput("caneca-u", { branchId }), { idemKey: "t-focus-1", transmit: true });
    expect(doc.isSimulated).toBe(false);
    expect(doc.status).toBe("processing");
    const post = calls.find((c) => c.method === "POST" && c.url.includes("ref=nfe-t-focus-1"))!;
    expect(post.body.numero).toBe(doc.number);
    expect(post.body.items[0].codigo_ncm).toBe("69120000");
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
    expect(doc.danfeUrl).toBe(`${base}/arquivos/x.pdf`);
    expect(doc.xmlFileId).toBeTruthy();
    expect((await readFile(ctx, doc.xmlFileId)).data.toString()).toMatch(/nfeProc/);
    // token trocado por um inválido: novo documento fica em "erro", não autorizado nem rejeitado
    process.env.FOCUS_TESTE_TOKEN = "token-ruim";
    const conn2 = await testFiscalConnection(ctx, branchId);
    expect(conn2.status).toBe("error");
    let d2 = await saveNfe(ctx, nfeInput("caneca-u", { branchId }), { idemKey: "t-focus-2", transmit: true });
    expect(d2.status).toBe("error");
    expect(d2.statusMessage).toMatch(/Credencial recusada/);
    // credencial corrigida: retransmissão com a mesma referência
    process.env.FOCUS_TESTE_TOKEN = "token-bom";
    d2 = await retransmit(ctx, d2.id);
    expect(d2.status).toBe("processing");
    expect(calls.filter((c) => c.method === "POST" && c.url.includes("ref=nfe-t-focus-2")).length).toBe(2);
    // sem credencial no servidor → pendente de configuração (não transmite)
    delete process.env.FOCUS_TESTE_TOKEN;
    const d3 = await saveNfe(ctx, nfeInput("caneca-u", { branchId }), { idemKey: "t-focus-3", transmit: true });
    expect(d3.status).toBe("pending");
    expect(d3.statusMessage).toMatch(/FOCUS_TESTE_TOKEN/);
    await saveFiscalConfig(ctx, branchId, { provider: "simulated" });
  });
});

describe("Relatórios, pacote contábil e obrigações", () => {
  it("totais consideram apenas autorizadas de saída e o pacote identifica XML de simulação", async () => {
    const ctx = await adminCtx();
    const f = { from: monthStart(today()), to: today(), branchId: null, includeSimulated: true };
    const docs = await periodDocuments({ ...ctx, branchId: null }, f);
    const sum = summarize(docs, f);
    const expected = docs.filter((d) => d.status === "authorized" && d.operationType === "saida" && d.purpose !== "devolucao").reduce((a, d) => a + d.total, 0);
    expect(sum.gross).toBe(expected);
    expect(sum.byStatus.cancelled.count).toBeGreaterThan(0);
    const book = outputBook(docs);
    expect(book.filter((b) => b.status === "cancelled").every((b) => b.value === 0)).toBe(true);
    const pkg = await buildAccountingPackage({ ...ctx, branchId: null }, f);
    expect(pkg.xmlCount).toBeGreaterThan(0);
    const { data } = await readFile(ctx, pkg.fileId);
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files);
    expect(names).toContain("LEIA-ME.txt");
    expect(names.some((n) => n.startsWith("xml/SIMULACAO-sem-validade-fiscal/"))).toBe(true);
    expect(names).toContain("relatorios/livro-registro-saidas.csv");
    const readme = await zip.file("LEIA-ME.txt")!.async("string");
    expect(readme).toMatch(/NÃO É ARQUIVO DE OBRIGAÇÃO ACESSÓRIA/);
  });

  it("obrigações: geração idempotente e comprovação exigida", async () => {
    const ctx = await adminCtx();
    const a = await generateObligations(ctx, "2026-10-05");
    const b = await generateObligations(ctx, "2026-10-05");
    expect(a.created).toBeGreaterThan(0);
    expect(b.created).toBe(0);
    const list = await listObligations(ctx, {});
    const pgdas = list.find((o) => o.kind === "pgdas_d" && o.period === "2026-09")!;
    expect(pgdas.dueDate).toBe("2026-10-20");
    await expect(completeObligation(ctx, pgdas.id, { deliveredAt: "2026-10-05" })).rejects.toThrow(/comprovante/);
    const done = await completeObligation(ctx, pgdas.id, { deliveredAt: "2026-10-05", receiptNumber: "REC-1", proof: { name: "recibo.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 recibo") } });
    expect(done.status).toBe("done");
    expect(done.proofFileId).toBeTruthy();
  });
});

describe("Certificado A1", () => {
  it("lê titular, CNPJ e validade com a senha informada; senha errada é recusada", () => {
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "0A1B2C";
    cert.validity.notBefore = new Date("2026-01-01T00:00:00Z");
    cert.validity.notAfter = new Date("2027-01-01T00:00:00Z");
    const attrs = [{ name: "commonName", value: "INTERCERT COMERCIO LTDA:11222333000181" }, { name: "countryName", value: "BR" }];
    cert.setSubject(attrs);
    cert.setIssuer([{ name: "commonName", value: "AC TESTE" }]);
    cert.sign(keys.privateKey);
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "senha123", { algorithm: "3des" });
    const der = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
    const info = parsePfx(der, "senha123");
    expect(info.cnpj).toBe("11222333000181");
    expect(info.validTo.slice(0, 10)).toBe("2027-01-01");
    expect(() => parsePfx(der, "errada")).toThrow(/Senha/);
  });
});

describe("Demonstração fiscal (seed/modules/fiscal) — idempotente", () => {
  it("cria NF-e pendente/rejeitada/autorizada com CC-e, NFS-e autorizada e obrigações; repetir não duplica", async () => {
    const st = freshStore();
    const { seedDemo } = await import("@/domain/seed");
    await seedDemo(st, { historyDays: 2 });
    const get = (ref: string) => st.get("fiscal_documents", detId("fiscaldoc", ref));
    expect((await get("nfe-demo-fiscal-pendente"))?.status).toBe("pending");
    expect((await get("nfe-demo-fiscal-rejeitada"))?.status).toBe("rejected");
    const auth = (await get("nfe-demo-fiscal-autorizada"))!;
    expect(auth.status).toBe("authorized");
    expect(auth.correctionCount).toBe(1);
    expect((await get("nfse-demo-fiscal-nfse-1"))?.status).toBe("authorized");
    const obl = await listAll(st, "fiscal_obligations");
    expect(obl.some((o) => o.kind === "pgdas_d" && o.status === "done" && o.proofFileId)).toBe(true);
    expect(obl.some((o) => o.kind === "xml_contabilidade")).toBe(true);
    const counts = [(await listAll(st, "fiscal_documents")).length, obl.length, (await listAll(st, "titles")).length];
    await seedDemo(st, { historyDays: 2 });
    expect([(await listAll(st, "fiscal_documents")).length, (await listAll(st, "fiscal_obligations")).length, (await listAll(st, "titles")).length]).toEqual(counts);
  }, 60000);
});

describe("Rotinas fiscais", () => {
  it("envio mensal agendado registra falha real sem canal e não marca o período como enviado", async () => {
    const st = freshStore();
    const r2 = await seedBase(st);
    const ctx = await r2.ctxFor("admin", "matriz");
    const { saveAccountingSchedule, runScheduledAccountingExport, getAccountingSchedule } = await import("@/domain/fiscal/export");
    const { saveIntegration } = await import("@/domain/integrations");
    await saveIntegration(ctx, { kind: "accounting", branchId: null, provider: "export_package", config: { accountantEmail: "contab@example.com" } });
    await saveAccountingSchedule(ctx, { enabled: true, day: 3 });
    expect((await runScheduledAccountingExport(ctx, "2026-10-02")).skipped).toBe("before_day");
    const r = await runScheduledAccountingExport(ctx, "2026-10-05");
    expect(r.delivered).toBe(false);
    expect(r.message).toMatch(/NÃO enviado/);
    const sch = await getAccountingSchedule(ctx);
    expect(sch.lastPeriod ?? null).toBeNull();
    const logs = await listAll(st, "integration_logs", { filters: [["eq", "kind", "accounting"]] });
    expect(logs.some((l) => l.action === "scheduled_package" && l.status === "failure")).toBe(true);
    const files = await listAll(st, "files", { filters: [["eq", "kind", "accounting_package"]] });
    expect(files.length).toBe(1);
  });

  it("avisos de vencimento/atraso de obrigações são deduplicados por ocorrência", async () => {
    const st = freshStore();
    const r2 = await seedBase(st);
    const ctx = await r2.ctxFor("admin", "matriz");
    const { generateObligations, notifyDeadlines } = await import("@/domain/fiscal/obligations");
    await generateObligations(ctx, "2026-10-05");
    const a = await notifyDeadlines(ctx, "2026-10-05");
    const b = await notifyDeadlines(ctx, "2026-10-05");
    expect(a.sent).toBeGreaterThan(0);
    expect(b.sent).toBe(0);
  });
});
