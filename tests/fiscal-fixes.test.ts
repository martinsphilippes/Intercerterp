import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import "@/domain/jobs-registry";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import type { Ctx } from "@/lib/core/ctx";
import { runDueJobs } from "@/lib/core/jobs";
import {
  buildItems,
  cancelDocument,
  computeTotals,
  createDocument,
  disableNumbers,
  queryDocument,
  retransmit,
  retransmitBatch,
  saveFiscalConfig,
  submitDraft,
  toProviderPayload,
  transmitDocument,
  validateDocument,
} from "@/domain/fiscal/service";
import { loadOrigin, saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { periodDocuments, summarize } from "@/domain/fiscal/reports";
import { buildAccountingPackage, sendAccountingPackage } from "@/domain/fiscal/export";
import { cancelSale, finalizeSale } from "@/domain/sales";
import { openSession } from "@/domain/cash";
import { monthStart, today } from "@/lib/dates";

/** Regressões das correções do módulo fiscal (revisão adversarial). */

let store: Store;
let refs: DemoRefs;
let seq = 0;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
  const ctx = await refs.ctxFor("admin", "matriz");
  await openSession(ctx, { terminalId: refs.terminals.cx1.id, openingFund: 10000 });
}, 60000);

const adminCtx = () => refs.ctxFor("admin", "matriz");
const matriz = () => refs.branches.matriz.id;
const shopping = () => refs.branches.shopping.id;

function nfeInput(skuId: string, over: Partial<NfeInput> = {}): NfeInput {
  const c = refs.customers.mercado;
  return {
    branchId: matriz(),
    origin: { type: "manual" },
    nature: "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: "1",
    recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] },
    items: [{ skuId, qty: 2000, unitPrice: 5000, discount: 0 }],
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

async function product(key: string, ncm: string, taxGroupId?: string) {
  const sd = refs.seeder;
  const p = await sd.put("products", key, { companyId: refs.company.id, type: "product", code: key.toUpperCase(), name: `Produto ${key}`, unitCode: "UN", ncm, origin: "0", taxGroupId: taxGroupId ?? refs.products.caneca.taxGroupId, status: "active", active: true });
  const s = await sd.put("skus", `${key}-u`, { companyId: refs.company.id, productId: p.id, sku: key.toUpperCase(), name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
  return { p, s };
}

async function transfer(from: string, to: string) {
  seq++;
  return store.create("transfers", {
    companyId: refs.company.id,
    branchId: from,
    number: 900 + seq,
    fromBranchId: from,
    toBranchId: to,
    status: "shipped",
    items: [{ skuId: refs.skus["caneca-u"].id, qty: 2000, shippedQty: 2000, unitCost: 1500, name: "Caneca" }],
  });
}

async function sale(idemKey: string, skuKey = "bone-u", amount = 4490) {
  const ctx = await adminCtx();
  const s = await finalizeSale(ctx, { idemKey, terminalId: refs.terminals.cx1.id, items: [{ skuId: refs.skus[skuKey].id, qty: 1000 }], payments: [{ methodId: refs.methods.dinheiro.id, amount, received: amount }] });
  await runDueJobs(store, { limit: 50 });
  await runDueJobs(store, { limit: 50 });
  return (await store.get("sales", s.id))!;
}

describe("Consulta ao provedor (critical)", () => {
  it("exige permissão de emissão e documento da empresa/filial ativas; contexto alheio não altera o documento", async () => {
    const ctx = await adminCtx();
    let doc = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "fx-query-1", transmit: true });
    expect(doc.status).toBe("processing");
    const other: Ctx = { ...ctx, companyId: "OTHER-COMPANY" };
    await expect(queryDocument(other, doc.id)).rejects.toThrow(/outra empresa/);
    const viewer: Ctx = { ...ctx, user: { ...ctx.user, isAdmin: false, actions: [] } };
    await expect(queryDocument(viewer, doc.id)).rejects.toThrow(/permissão/);
    await expect(queryDocument(await refs.ctxFor("admin", "shopping"), doc.id)).rejects.toThrow(/outra filial/);
    await expect(queryDocument(await refs.ctxFor("admin", null), doc.id)).rejects.toThrow(/filial específica/);
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("processing");
    expect(await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "query"]] })).toHaveLength(0);
    await expect(transmitDocument(other, doc.id)).rejects.toThrow(/outra empresa/);
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
  });
});

describe("Uma operação → um documento fiscal ativo (critical)", () => {
  it("NF-e da venda é bloqueada com NFC-e retida na fila; NFC-e liberada não é transmitida se a venda já tem NF-e autorizada", async () => {
    const ctx = await adminCtx();
    await saveFiscalConfig(ctx, matriz(), { contingency: true, contingencyReason: "SEFAZ indisponível (teste)" });
    const s = await sale("fx-sale-dup-1");
    const nfceId = s.fiscalDocumentId;
    expect((await store.get("fiscal_documents", nfceId))!.status).toBe("queued");
    const pre = await loadOrigin(ctx, "sale", s.id, matriz());
    expect(pre.blockers.join(" ")).toMatch(/NFC-e/);
    const c = refs.customers.mercado;
    const input = { ...pre.input, recipient: { partyType: "customer" as const, partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] }, payments: [{ kind: "cash", amount: 4490 }] };
    await expect(saveNfe(ctx, input, { idemKey: "fx-sale-dup-nfe", transmit: true })).rejects.toThrow(/NFC-e/);

    // situação herdada (NF-e criada antes da regra) — a transmissão da NFC-e liberada é barrada no envio
    const items = await buildItems(ctx, [{ skuId: refs.skus["bone-u"].id, qty: 1000, unitPrice: 4490, discount: 0 }], { branchId: matriz(), kind: "sale" });
    const totals = computeTotals(items);
    const legacy = await createDocument(ctx, {
      model: "nfe", ref: `nfe-legacy-${s.id}`, branchId: matriz(), originType: "sale", originId: s.id, operationId: s.id,
      recipient: input.recipient, partyType: "customer", partyId: c.id, items, totals, payments: [{ kind: "cash", amount: totals.total }], status: "draft", total: totals.total,
    });
    await submitDraft(ctx, legacy.id);
    expect((await queryDocument(ctx, legacy.id)).status).toBe("authorized");
    await saveFiscalConfig(ctx, matriz(), { contingency: false });
    await runDueJobs(store, { limit: 50 });
    const nfce = (await store.get("fiscal_documents", nfceId))!;
    expect(nfce.status).toBe("pending");
    expect(nfce.attempts ?? 0).toBe(0);
    expect(nfce.statusMessage).toMatch(/NF-e/);
    const authorized = (await listAll(store, "fiscal_documents", { filters: [["eq", "originType", "sale"], ["eq", "originId", s.id]] })).filter((d) => d.status === "authorized");
    expect(authorized).toHaveLength(1);
  });

  it("NFC-e retida na fila e depois autorizada normalmente não fica marcada como contingência (low)", async () => {
    const ctx = await adminCtx();
    await saveFiscalConfig(ctx, matriz(), { contingency: true, contingencyReason: "SEFAZ indisponível (teste 2)" });
    const s = await sale("fx-sale-cont-2", "meia-u", 2990);
    expect((await store.get("fiscal_documents", s.fiscalDocumentId))!.contingency).toBe(true);
    await saveFiscalConfig(ctx, matriz(), { contingency: false });
    await runDueJobs(store, { limit: 50 });
    const d = (await store.get("fiscal_documents", s.fiscalDocumentId))!;
    expect(d.status).toBe("authorized");
    expect(d.contingency).toBe(false);
  });
});

describe("Tributação (high/medium)", () => {
  it("CST 20 aplica a redução de base do grupo; payload leva redução, modalidade e os mesmos PIS/COFINS calculados", async () => {
    const ctx = await adminCtx();
    await store.update("companies", refs.company.id, { regime: "presumido" });
    try {
      const g = await store.create("tax_groups", {
        companyId: refs.company.id, name: "Presumido — CST 20", regime: "presumido", cfopInternal: "5102", cfopInterstate: "6102", cstCsosn: "20",
        icmsRateBps: 1800, icmsBaseReductionBps: 3333, pisCst: "01", pisRateBps: 65, cofinsCst: "01", cofinsRateBps: 300, active: true,
      });
      const { s } = await product("fxcst20", "69120000", g.id);
      const items = await buildItems(ctx, [{ skuId: s.id, qty: 1000, unitPrice: 10000, discount: 0 }], { branchId: matriz(), kind: "sale" });
      expect(items[0].icmsBase).toBe(6667);
      expect(items[0].icms).toBe(1200);
      expect(items[0].pis).toBe(65);
      expect(items[0].cofins).toBe(300);
      const company = (await store.get("companies", refs.company.id))!;
      const branch = (await store.get("branches", matriz()))!;
      const doc = { model: "nfe", operationType: "saida", items, totals: computeTotals(items), payments: [], recipient: null } as any;
      const it0 = toProviderPayload(doc, company, branch, null).items[0];
      expect(it0.icms_base_calculo).toBe(66.67);
      expect(it0.icms_valor).toBe(12);
      expect(it0.icms_reducao_base_calculo).toBe(33.33);
      expect(it0.icms_modalidade_base_calculo).toBe(3);
      expect(it0.pis_base_calculo).toBe(100);
      expect(it0.pis_aliquota_porcentual).toBe(0.65);
      expect(it0.pis_valor).toBe(0.65);
      expect(it0.cofins_aliquota_porcentual).toBe(3);
      expect(it0.cofins_valor).toBe(3);
      // CST 20 sem redução e PIS CST 01 sem alíquota viram pendência (não transmite ICMS20 sem pRedBC)
      const g2 = await store.create("tax_groups", { companyId: refs.company.id, name: "CST 20 incompleto", regime: "presumido", cfopInternal: "5102", cstCsosn: "20", icmsRateBps: 1800, pisCst: "01", pisRateBps: 0, cofinsCst: "01", cofinsRateBps: 300, active: true });
      const { s: s2 } = await product("fxcst20b", "69120000", g2.id);
      const items2 = await buildItems(ctx, [{ skuId: s2.id, qty: 1000, unitPrice: 10000, discount: 0 }], { branchId: matriz(), kind: "sale" });
      const issues = validateDocument({ ...doc, items: items2, recipient: { doc: refs.customers.mercado.doc, name: "X", address: refs.customers.mercado.addresses[0] }, payments: [{ kind: "none", amount: 0 }] } as any, company, branch);
      expect(issues.join(" ")).toMatch(/redução da base/);
      expect(issues.join(" ")).toMatch(/PIS CST 01 exige alíquota/);
    } finally {
      await store.update("companies", refs.company.id, { regime: "simples" });
    }
  });
});

describe("Relatórios (high)", () => {
  it("NF-e de transferência entre filiais autorizada não entra no faturamento fiscal", async () => {
    const ctx = await adminCtx();
    const f = { from: monthStart(today()), to: today(), branchId: null, includeSimulated: true };
    const all = { ...ctx, branchId: null };
    const before = summarize(await periodDocuments(all, f), f);
    const t = await transfer(matriz(), shopping());
    const pre = await loadOrigin(ctx, "transfer", t.id, matriz());
    expect(pre.blockers).toEqual([]);
    let doc = await saveNfe(ctx, pre.input, { idemKey: "fx-tr-rev-1", transmit: true });
    doc = await queryDocument(ctx, doc.id);
    expect(doc.status).toBe("authorized");
    expect(doc.items[0].cfop).toBe("5152");
    const after = summarize(await periodDocuments(all, f), f);
    expect(after.gross).toBe(before.gross);
    expect(after.revenueCount).toBe(before.revenueCount);
    expect(after.nonRevenue - before.nonRevenue).toBe(doc.total);
  });
});

describe("NF-e de transferência (high)", () => {
  it("emitente é a filial ativa; destino validado no servidor (empresa, diferente da origem); destinatário não é forjável", async () => {
    const ctx = await adminCtx();
    // branchId forjado no JSON (outra filial)
    await expect(saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id, { branchId: shopping() }), { idemKey: "fx-tr-forged", transmit: false })).rejects.toThrow(/filial ativa/);
    // transferência da outra filial emitida no contexto da matriz
    const tOther = await transfer(shopping(), matriz());
    const preOther = await loadOrigin(ctx, "transfer", tOther.id, matriz());
    expect(preOther.blockers.join(" ")).toMatch(/filial de origem/);
    await expect(saveNfe(ctx, { ...preOther.input, branchId: matriz() }, { idemKey: "fx-tr-other", transmit: false })).rejects.toThrow(/filial de origem/);
    // destino de outra empresa
    const foreign = await store.create("branches", { companyId: "OTHER-COMPANY", name: "Filial alheia", cnpj: "11444777000161", status: "active" });
    const tForeign = await transfer(matriz(), foreign.id);
    expect((await loadOrigin(ctx, "transfer", tForeign.id, matriz())).blockers.join(" ")).toMatch(/destino/);
    // destino igual à origem
    const tSame = await transfer(matriz(), matriz());
    expect((await loadOrigin(ctx, "transfer", tSame.id, matriz())).blockers.join(" ")).toMatch(/igual/);
    // destinatário forjado é substituído pela filial de destino da transferência
    const tOk = await transfer(matriz(), shopping());
    const pre = await loadOrigin(ctx, "transfer", tOk.id, matriz());
    const forged = { ...pre.input, recipient: { ...pre.input.recipient, doc: "11444777000161", name: "Destinatário forjado" } };
    const doc = await saveNfe(ctx, forged, { idemKey: "fx-tr-ok", transmit: false });
    expect(doc.recipientDoc).toBe(refs.branches.shopping.cnpj);
    expect(doc.branchId).toBe(matriz());
  });
});

describe("Documento já enviado (high)", () => {
  it("sem credencial não volta a pendente; descarte consulta o provedor antes e recusa documento autorizado", async () => {
    const ctx = await adminCtx();
    let doc = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "fx-sent-1", transmit: true });
    expect(doc.status).toBe("processing");
    // resposta perdida (timeout): documento local em erro com 1 tentativa — no provedor ele seguirá para autorizado
    await store.update("fiscal_documents", doc.id, { status: "error", statusMessage: "Tempo esgotado (teste)", provider: "focusnfe" });
    await saveFiscalConfig(ctx, matriz(), { tokenRef: "" }); // vínculo de credencial removido
    doc = await transmitDocument(ctx, doc.id);
    expect(doc.status).toBe("error");
    await expect(cancelDocument(ctx, doc.id, "Descartar documento com erro de envio")).rejects.toThrow(/confirmar a situação/);
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("error");
    // credencial de volta: o descarte consulta e encontra o documento AUTORIZADO (situação atualizada, nada descartado)
    await store.update("fiscal_documents", doc.id, { provider: "simulated" });
    await saveFiscalConfig(ctx, matriz(), { tokenRef: "FOCUSNFE_TOKEN" });
    await expect(cancelDocument(ctx, doc.id, "Descartar documento com erro de envio")).rejects.toThrow(/AUTORIZADO/);
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("authorized");
  });

  it("venda cancelada com NFC-e 'pendente' já enviada (autorizada no provedor): consulta e cancela em vez de descartar", async () => {
    const ctx = await adminCtx();
    const s = await sale("fx-sale-sent-1", "caderno-u", 2490);
    const id = s.fiscalDocumentId;
    expect((await store.get("fiscal_documents", id))!.status).toBe("authorized");
    // estado local rebaixado sem consulta (como antes da correção): pendente com 1 tentativa
    await store.update("fiscal_documents", id, { status: "pending", protocol: null, authorizedAt: null });
    await cancelSale(ctx, s.id, "Cliente desistiu da compra (teste)");
    expect((await store.get("fiscal_documents", id))!.status).not.toBe("discarded");
    await runDueJobs(store, { limit: 50 });
    await runDueJobs(store, { limit: 50 });
    expect((await store.get("fiscal_documents", id))!.status).toBe("cancelled");
  });
});

describe("Inutilização (high)", () => {
  it("repetir faixa já homologada é idempotente e preserva o protocolo; número inutilizado sai da retransmissão; sobreposição recusada", async () => {
    const ctx = await adminCtx();
    const { s } = await product("fxgap", "00000000");
    const doc = await saveNfe(ctx, nfeInput(s.id), { idemKey: "fx-gap-1", transmit: true });
    expect(doc.status).toBe("rejected");
    const input = { branchId: matriz(), model: "nfe" as const, series: doc.series, from: doc.number, to: doc.number, justification: "Numeração rejeitada e abandonada (teste)" };
    const inut = await disableNumbers(ctx, input);
    expect(inut.status).toBe("unused");
    expect(inut.protocol).toBeTruthy();
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("unused");
    await expect(retransmit(ctx, doc.id)).rejects.toThrow(/não pode ser retransmitido/);
    // provedor recusaria a repetição (indisponível aqui): o registro homologado não é sobrescrito
    await saveFiscalConfig(ctx, matriz(), { simulateOutage: true });
    try {
      const again = await disableNumbers(ctx, input);
      expect(again.status).toBe("unused");
      expect(again.protocol).toBe(inut.protocol);
    } finally {
      await saveFiscalConfig(ctx, matriz(), { simulateOutage: false });
    }
    await expect(disableNumbers(ctx, { ...input, to: doc.number + 1 })).rejects.toThrow(/já inutilizada/);
  });
});

describe("Retransmissão, filial e concorrência (medium)", () => {
  it("Retransmitir faz a mesma checagem de estoque do Transmitir", async () => {
    const ctx = await adminCtx();
    const { s } = await product("fxstock", "69120000");
    const doc = await saveNfe(ctx, nfeInput(s.id, { items: [{ skuId: s.id, qty: 10000, unitPrice: 1000, discount: 0 }], effects: { stock: true, financial: false } }), { idemKey: "fx-stock-1", transmit: false });
    expect(doc.status).toBe("draft");
    await expect(retransmit(ctx, doc.id)).rejects.toThrow(/Estoque insuficiente/);
    expect((await store.get("fiscal_documents", doc.id))!.attempts ?? 0).toBe(0);
  });

  it("escritas fiscais exigem a filial do documento (consolidado e outra filial recusados)", async () => {
    const ctx = await adminCtx();
    const { s } = await product("fxscope", "00000000");
    const doc = await saveNfe(ctx, nfeInput(s.id), { idemKey: "fx-scope-1", transmit: true });
    expect(doc.status).toBe("rejected");
    await expect(cancelDocument(await refs.ctxFor("admin", null), doc.id, "Descarte no consolidado (teste)")).rejects.toThrow(/filial específica/);
    await expect(cancelDocument(await refs.ctxFor("admin", "shopping"), doc.id, "Descarte em outra filial (teste)")).rejects.toThrow(/outra filial/);
    await expect(retransmit(await refs.ctxFor("admin", "shopping"), doc.id)).rejects.toThrow(/outra filial/);
    await expect(retransmitBatch(await refs.ctxFor("admin", null), { model: "nfce" })).rejects.toThrow(/filial específica/);
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("rejected");
  });

  it("envios concorrentes do mesmo documento: um único envio, uma tentativa e um número", async () => {
    const ctx = await adminCtx();
    const doc = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "fx-conc-1", transmit: false });
    await store.update("fiscal_documents", doc.id, { status: "queued" });
    await Promise.all([transmitDocument(ctx, doc.id), transmitDocument(ctx, doc.id), transmitDocument(ctx, doc.id)]);
    const cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.attempts).toBe(1);
    expect(cur.number).toBeGreaterThan(0);
    expect(await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "request"]] })).toHaveLength(1);
    // próxima NF-e recebe o número seguinte (nenhum número consumido sem registro)
    const next = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "fx-conc-2", transmit: true });
    expect(next.number).toBe(cur.number + 1);
  });

  it("pacote contábil: gerar exige exportação de dados; enviar exige configurar o fiscal", async () => {
    const mgr = await refs.ctxFor("manager", "matriz");
    const f = { from: monthStart(today()), to: today(), branchId: null, includeSimulated: true };
    await expect(sendAccountingPackage(mgr, f, { to: "qualquer@exemplo.com", reason: "manual" })).rejects.toThrow(/permissão/);
    const noExport: Ctx = { ...mgr, user: { ...mgr.user, actions: mgr.user.actions.filter((a) => a !== "data.export") } };
    await expect(buildAccountingPackage(noExport, f)).rejects.toThrow(/permissão/);
    expect((await listAll(store, "files", { filters: [["eq", "kind", "accounting_package"]] })).length).toBe(0);
  });
});

describe("Nova emissão após cancelamento (medium)", () => {
  it("transferência: NF-e cancelada permite nova emissão com ref -r2 vinculada à operação; rascunho descartado → -r3", async () => {
    const ctx = await adminCtx();
    const t = await transfer(matriz(), shopping());
    let d1 = await saveNfe(ctx, (await loadOrigin(ctx, "transfer", t.id, matriz())).input, { idemKey: "fx-re-1", transmit: true });
    d1 = await queryDocument(ctx, d1.id);
    expect(d1.status).toBe("authorized");
    expect(d1.ref).toBe(`nfe-transfer-${t.id}`);
    d1 = await cancelDocument(ctx, d1.id, "Placa do veículo informada errada na nota");
    expect(d1.status).toBe("cancelled");
    const pre = await loadOrigin(ctx, "transfer", t.id, matriz());
    expect(pre.existingDocId ?? null).toBeNull();
    expect(pre.warnings.join(" ")).toMatch(/cancelada/);
    const d2 = await saveNfe(ctx, pre.input, { idemKey: "fx-re-2", transmit: false });
    expect(d2.id).not.toBe(d1.id);
    expect(d2.ref).toBe(`nfe-transfer-${t.id}-r2`);
    expect(d2.originId).toBe(t.id);
    // repetir (duplo clique) reaproveita o mesmo rascunho
    const d2b = await saveNfe(ctx, pre.input, { idemKey: "fx-re-2b", transmit: false });
    expect(d2b.id).toBe(d2.id);
    await cancelDocument(ctx, d2.id, "Rascunho descartado pelo usuário (teste)");
    const d3 = await saveNfe(ctx, (await loadOrigin(ctx, "transfer", t.id, matriz())).input, { idemKey: "fx-re-3", transmit: false });
    expect(d3.ref).toBe(`nfe-transfer-${t.id}-r3`);
  });
});
