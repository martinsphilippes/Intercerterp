import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import "@/domain/jobs-registry";
import { detId, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { enqueue, runDueJobs } from "@/lib/core/jobs";
import { nowIso } from "@/lib/dates";
import {
  INTEGRATION_CATALOG,
  getIntegration,
  integrationId,
  missingSecrets,
  providerSecretProblem,
  saveFiscalIntegration,
  saveIntegration,
  secretStatus,
  testIntegration,
} from "@/domain/integrations";
import { pixProviderFrom } from "@/domain/payments/providers";
import { fiscalProviderFrom } from "@/domain/fiscal/providers";
import { cancelDocument, getFiscalConfig, disableNumbers, queryDocument, retransmit, retransmitBatch, saveFiscalConfig, testFiscalConnection, transmitDocument } from "@/domain/fiscal/service";
import { uploadCertificate } from "@/domain/fiscal/config";
import { loadOrigin, saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { csv, packageHistory } from "@/domain/fiscal/export";
import { markXmlDelivery } from "@/domain/fiscal/obligations";
import type { Ctx } from "@/lib/core/ctx";

/** Rodada 2 — regressões do módulo fiscal/integrações (verificação independente). */

let store: Store;
let refs: DemoRefs;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

const adminCtx = () => refs.ctxFor("admin", "matriz");
const matriz = () => refs.branches.matriz.id;
const shopping = () => refs.branches.shopping.id;

async function upsert(collection: string, id: string, data: Record<string, any>) {
  if (await store.get(collection, id)) return store.update(collection, id, data);
  return store.create(collection, data, id);
}

/** Executa com variáveis de ambiente temporárias (restaura os valores anteriores). */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

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

async function product(key: string, ncm: string) {
  const sd = refs.seeder;
  const p = await sd.put("products", key, { companyId: refs.company.id, type: "product", code: key.toUpperCase(), name: `Produto ${key}`, unitCode: "UN", ncm, origin: "0", taxGroupId: refs.products.caneca.taxGroupId, status: "active", active: true });
  const s = await sd.put("skus", `${key}-u`, { companyId: refs.company.id, productId: p.id, sku: key.toUpperCase(), name: p.name, unitCode: "UN", active: true, costTotal: 1000 });
  return { p, s };
}

describe("SSRF / exfiltração de segredo pela Central de integrações (high)", () => {
  it("nenhum provedor aceita URL base; saveIntegration recusa config.baseUrl", async () => {
    for (const cat of Object.values(INTEGRATION_CATALOG)) for (const p of cat.providers) expect(p.config).not.toContain("baseUrl");
    const c = await adminCtx();
    await expect(
      saveIntegration(c, { kind: "pix", branchId: null, provider: "mercadopago", config: { baseUrl: "https://atacante.example" }, secretRefs: { accessToken: "MERCADOPAGO_ACCESS_TOKEN" } }),
    ).rejects.toThrow(/URL base/);
    await expect(saveIntegration(c, { kind: "bank", branchId: null, provider: "open_finance", config: { baseUrl: "https://atacante.example" } })).rejects.toThrow(/URL base/);
    // nada gravado: o registro da empresa continua o da demonstração
    expect((await store.get("integrations", integrationId(refs.company.id, null, "pix")))!.provider).toBe("simulated");
  });

  it("secretRefs: recusa segredos do sistema e nomes fora do prefixo do provedor; aceita os nomes sugeridos e os prefixos do provedor", async () => {
    const c = await adminCtx();
    for (const name of ["APPWRITE_API_KEY", "CRON_SECRET", "SETUP_TOKEN", "DATA_BACKEND", "DATABASE_URL", "VERCEL_TOKEN", "NEXT_PUBLIC_X", "NODE_OPTIONS", "SESSION_SECRET", "AWS_SECRET_ACCESS_KEY", "GOOGLE_KEY", "PATH", "HOME"]) {
      await expect(saveIntegration(c, { kind: "pix", branchId: null, provider: "mercadopago", secretRefs: { accessToken: name } }), name).rejects.toThrow(/próprio sistema|deve começar com/);
    }
    await expect(saveIntegration(c, { kind: "pix", branchId: null, provider: "mercadopago", secretRefs: { accessToken: "OUTRA_CHAVE_QUALQUER" } })).rejects.toThrow(/deve começar com MERCADOPAGO_, MP_/);
    await expect(saveIntegration(c, { kind: "email", branchId: null, provider: "resend", secretRefs: { apiKey: "MP_TOKEN" } })).rejects.toThrow(/RESEND_/);
    await expect(saveIntegration(c, { kind: "bank", branchId: null, provider: "open_finance", secretRefs: { clientId: "APPWRITE_API_KEY", clientSecret: "BANK_SECRET_X" } })).rejects.toThrow(/próprio sistema/);
    // nomes sugeridos (defaultRefs) de todos os provedores continuam válidos
    for (const cat of Object.values(INTEGRATION_CATALOG)) for (const p of cat.providers) for (const s of p.secrets) expect(providerSecretProblem(p, s, p.defaultRefs?.[s])).toBeNull();
    const ok = await saveIntegration(c, { kind: "email", branchId: matriz(), provider: "resend", secretRefs: { apiKey: "RESEND_LOJA_MATRIZ" } });
    expect(ok.secretRefs).toEqual({ apiKey: "RESEND_LOJA_MATRIZ" });
    await store.delete("integrations", ok.id);
  });

  it("integração fiscal e configuração fiscal: token/CSC/senha do certificado não aceitam segredos do sistema", async () => {
    const c = await adminCtx();
    await expect(saveFiscalIntegration(c, shopping(), { kind: "fiscal_nfe", provider: "focusnfe", environment: "homologacao", tokenRef: "APPWRITE_API_KEY" })).rejects.toThrow(/próprio sistema/);
    await expect(saveFiscalIntegration(c, shopping(), { kind: "fiscal_nfe", provider: "focusnfe", environment: "homologacao", tokenRef: "MERCADOPAGO_ACCESS_TOKEN" })).rejects.toThrow(/deve começar com FOCUSNFE_/);
    await expect(saveFiscalIntegration(c, shopping(), { kind: "fiscal_nfe", provider: "simulated", environment: "homologacao", tokenRef: "CRON_SECRET" })).rejects.toThrow(/próprio sistema/);
    await expect(saveFiscalIntegration(c, shopping(), { kind: "fiscal_nfe", provider: "focusnfe", environment: "homologacao", tokenRef: "FOCUSNFE_TOKEN", cscTokenRef: "SETUP_TOKEN" })).rejects.toThrow(/próprio sistema/);
    await expect(saveFiscalConfig(c, matriz(), { tokenRef: "APPWRITE_API_KEY" })).rejects.toThrow(/próprio sistema/);
    await expect(saveFiscalConfig(c, matriz(), { cscTokenRef: "DATABASE_URL" })).rejects.toThrow(/próprio sistema/);
    await expect(uploadCertificate(c, matriz(), { fileName: "a.pfx", data: Buffer.alloc(500), password: "x", passwordRef: "APPWRITE_API_KEY" })).rejects.toThrow(/próprio sistema/);
    expect((await getFiscalConfig(store, refs.company.id, matriz()))!.tokenRef).toBe("FOCUSNFE_TOKEN");
  });

  it("registro gravado antes da validação com segredo do sistema: tratado como não configurado — o segredo nunca é lido nem enviado", async () => {
    const c = await adminCtx();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const pixId = integrationId(refs.company.id, null, "pix");
    const before = (await store.get("integrations", pixId))!;
    await withEnv({ APPWRITE_API_KEY: "segredo-do-banco" }, async () => {
      await upsert("integrations", pixId, { provider: "mercadopago", config: { baseUrl: "https://atacante.example" }, secretRefs: { accessToken: "APPWRITE_API_KEY" }, enabled: true });
      expect(await getIntegration(store, refs.company.id, matriz(), "pix")).toBeNull();
      expect(pixProviderFrom(await getIntegration(store, refs.company.id, matriz(), "pix"))).toBeNull();
      const st = secretStatus("pix", "mercadopago", { accessToken: "APPWRITE_API_KEY" });
      expect(st[0].defined).toBe(false);
      expect(st[0].problem).toMatch(/próprio sistema/);
      const r = await testIntegration(c, "pix", null);
      expect(r.ok).toBe(false);
      expect(r.status).toBe("not_configured");
      expect(r.message).toMatch(/APPWRITE_API_KEY.*próprio sistema/);
      expect((await store.get("integrations", pixId))!.status).toBe("not_configured");
      // e-mail (Resend) com vínculo ao segredo de rotinas: canal não configurado, nenhuma requisição
      const emailId = integrationId(refs.company.id, null, "email");
      await upsert("integrations", emailId, { companyId: refs.company.id, branchId: null, scopeKey: `${refs.company.id}|*|email`, kind: "email", provider: "resend", config: {}, secretRefs: { apiKey: "CRON_SECRET" }, enabled: true });
      await withEnv({ CRON_SECRET: "segredo-cron" }, async () => {
        const { sendEmail } = await import("@/lib/core/email");
        const sent = await sendEmail(refs.company.id, { to: "x@example.com", subject: "t", html: "t" });
        expect(sent.delivered).toBe(false);
        expect(sent.channel).toBe("not_configured");
      });
      await store.delete("integrations", emailId);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await store.update("integrations", pixId, { provider: before.provider, config: before.config, secretRefs: before.secretRefs, status: before.status });
  });

  it("registro antigo com URL base: a configuração entregue aos consumidores não traz a URL (credencial vai só ao endereço oficial)", async () => {
    const c = await adminCtx();
    const pixId = integrationId(refs.company.id, null, "pix");
    const before = (await store.get("integrations", pixId))!;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("[]", { status: 200 }));
    await withEnv({ MP_TOKEN_R2: "tok-mp", MERCADOPAGO_BASE_URL: undefined }, async () => {
      await upsert("integrations", pixId, { provider: "mercadopago", config: { baseUrl: "https://atacante.example", connectionName: "Pix" }, secretRefs: { accessToken: "MP_TOKEN_R2" }, enabled: true });
      const integ = (await getIntegration(store, refs.company.id, null, "pix"))!;
      expect(integ.config.baseUrl).toBeUndefined();
      expect(integ.config.connectionName).toBe("Pix");
      const r = await testIntegration(c, "pix", null);
      expect(r.status).toBe("operational");
    });
    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) expect(String(call[0])).toMatch(/^https:\/\/api\.mercadopago\.com\//);
    await store.update("integrations", pixId, { provider: before.provider, config: before.config, secretRefs: before.secretRefs, status: before.status });
  });

  it("configuração fiscal antiga com token apontando para segredo do sistema: provedor não é iniciado, teste não faz requisição", async () => {
    const c = await adminCtx();
    const cfg = (await getFiscalConfig(store, refs.company.id, matriz()))!;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await withEnv({ APPWRITE_API_KEY: "segredo-do-banco" }, async () => {
      await store.update("fiscal_configs", cfg.id, { provider: "focusnfe", tokenRef: "APPWRITE_API_KEY" });
      expect(fiscalProviderFrom({ ...cfg, provider: "focusnfe", tokenRef: "APPWRITE_API_KEY" })).toBeNull();
      const r = await testFiscalConnection(c, matriz());
      expect(r.ok).toBe(false);
      expect(r.status).toBe("not_configured");
      expect(r.message).toMatch(/próprio sistema/);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await store.update("fiscal_configs", cfg.id, { provider: cfg.provider, tokenRef: cfg.tokenRef, connectionStatus: cfg.connectionStatus ?? null, lastTestAt: cfg.lastTestAt ?? null });
  });
});

describe("TEF via conector (low)", () => {
  it("registro antigo com secretRefs.connectorToken não exige TEF_CONNECTOR_TOKEN (só segredos do provedor no catálogo)", async () => {
    const c = await adminCtx();
    const id = integrationId(refs.company.id, null, "card_tef");
    const before = (await store.get("integrations", id))!;
    await withEnv({ TEF_CONNECTOR_TOKEN: undefined }, async () => {
      await store.update("integrations", id, { provider: "tef_connector", secretRefs: { connectorToken: "TEF_CONNECTOR_TOKEN" } });
      expect(missingSecrets((await store.get("integrations", id))!)).toEqual([]);
      const r = await testIntegration(c, "card_tef", null);
      expect(r.message).not.toMatch(/Credencial ausente/);
      expect(r.status).toBe("configured_untested");
    });
    await store.update("integrations", id, { provider: before.provider, secretRefs: before.secretRefs ?? {}, status: before.status });
  });
});

describe("Pacote contábil (partial)", () => {
  it("histórico de pacotes exige 'Exportar dados'", async () => {
    const mgr = await refs.ctxFor("manager", "matriz");
    const noExport: Ctx = { ...mgr, user: { ...mgr.user, actions: mgr.user.actions.filter((a) => a !== "data.export") } };
    await expect(packageHistory(noExport)).rejects.toThrow(/permissão/);
    await expect(packageHistory(await adminCtx())).resolves.toBeInstanceOf(Array);
  });

  it("obrigação 'Entrega de XML' só é concluída pelo pacote do mês inteiro", async () => {
    const c = await adminCtx();
    const o = await store.create("fiscal_obligations", { companyId: refs.company.id, branchId: null, kind: "xml_contabilidade", name: "Entrega de XML", period: "2026-08", dueDate: "2026-09-10", status: "pending", templateKey: "xml_contabilidade" });
    const f = (from: string, to: string) => ({ from, to, branchId: null, includeSimulated: true }) as any;
    expect(await markXmlDelivery(c, f("2026-08-01", "2026-08-15"), "file-parcial", "contabil@example.com")).toBeNull();
    expect(await markXmlDelivery(c, f("2026-08-10", "2026-08-31"), "file-parcial", "contabil@example.com")).toBeNull();
    expect((await store.get("fiscal_obligations", o.id))!.status).toBe("pending");
    const done = await markXmlDelivery(c, f("2026-08-01", "2026-08-31"), "file-mes", "contabil@example.com");
    expect(done?.status).toBe("done");
    expect((await store.get("fiscal_obligations", o.id))!.exportFileId).toBe("file-mes");
  });

  it("CSV do pacote neutraliza fórmulas (=, +, -, @, TAB, CR) sem afetar números negativos", () => {
    const out = csv(
      [
        { key: "t", label: "=Rótulo" },
        { key: "m", label: "Valor", type: "money" },
      ],
      [
        { t: '=HYPERLINK("http://x")', m: -1234 },
        { t: "+5511", m: 0 },
        { t: "@SUM(A1)", m: 1 },
        { t: "-cmd", m: 1 },
        { t: "\tx", m: 1 },
        { t: "-12,34", m: 1 },
        { t: "Cliente normal", m: 1 },
      ],
    );
    const lines = out.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("'=Rótulo;Valor");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")";-12,34`);
    expect(lines[2]).toBe("'+5511;0,00");
    expect(lines[3]).toBe("'@SUM(A1);0,01");
    expect(lines[4]).toBe("'-cmd;0,01");
    expect(lines[5]).toBe("'\tx;0,01");
    expect(lines[6]).toBe("-12,34;0,01");
    expect(lines[7]).toBe("Cliente normal;0,01");
  });
});

describe("Reivindicação de envio (medium)", () => {
  it("falha entre a reivindicação e o registro da tentativa libera a reivindicação; a tarefa reenvia o documento", async () => {
    const ctx = await adminCtx();
    const doc = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "r2-claim-1", transmit: false });
    await store.update("fiscal_documents", doc.id, { status: "queued" });
    const job = await enqueue(store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: matriz() }, dedupeKey: `r2-claim-job-${doc.id}`, companyId: refs.company.id });
    const original = store.update.bind(store);
    let failOnce = true;
    (store as any).update = async (collection: string, id: string, patch: Record<string, any>) => {
      if (failOnce && collection === "fiscal_documents" && id === doc.id && patch.status === "processing") {
        failOnce = false;
        throw new Error("Falha transitória do banco (teste)");
      }
      return original(collection, id, patch);
    };
    try {
      const r1 = await runDueJobs(store, { jobIds: [job.id], limit: 1 });
      expect(r1[0].status).toBe("retry");
    } finally {
      delete (store as any).update;
    }
    let cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.status).toBe("queued");
    expect(cur.attempts ?? 0).toBe(0);
    const claim = (await store.get("operations", detId("fiscalsend", doc.id, 1)))!;
    expect(claim.status).toBe("failed");
    // retentativa da tarefa: reaproveita a mesma tentativa (nº 1) e envia
    await store.update("jobs", job.id, { runAt: nowIso() });
    const r2 = await runDueJobs(store, { jobIds: [job.id], limit: 1 });
    expect(r2[0].status).toBe("done");
    cur = (await store.get("fiscal_documents", doc.id))!;
    expect(["processing", "authorized"]).toContain(cur.status);
    expect(cur.attempts).toBe(1);
    expect(await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "request"]] })).toHaveLength(1);
    expect((await store.get("operations", detId("fiscalsend", doc.id, 1)))!.status).toBe("done");
  });

  it("tarefa que encontra o envio reivindicado por outro processo é reagendada (não concluída)", async () => {
    const ctx = await adminCtx();
    const doc = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "r2-claim-2", transmit: false });
    await store.update("fiscal_documents", doc.id, { status: "queued" });
    const claimId = detId("fiscalsend", doc.id, 1);
    await store.create("operations", { companyId: refs.company.id, type: "fiscal.send", status: "running", entityType: "fiscal_document", entityId: doc.id, result: { claimedAt: nowIso() } }, claimId);
    const job = await enqueue(store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: matriz() }, dedupeKey: `r2-claim-job-${doc.id}`, companyId: refs.company.id });
    const r1 = await runDueJobs(store, { jobIds: [job.id], limit: 1 });
    expect(r1[0].status).toBe("retry");
    const j = (await store.get("jobs", job.id))!;
    expect(j.status).toBe("retry");
    expect(j.runAt > nowIso()).toBe(true);
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("queued");
    // o outro processo falhou antes de registrar a tentativa: a próxima execução envia
    await store.update("operations", claimId, { status: "failed", result: { failures: 1 } });
    await store.update("jobs", job.id, { runAt: nowIso() });
    const r2 = await runDueJobs(store, { jobIds: [job.id], limit: 1 });
    expect(r2[0].status).toBe("done");
    const cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.attempts).toBe(1);
    expect(["processing", "authorized"]).toContain(cur.status);
    // envios simultâneos sobre a mesma falha: um único processo retoma (sem envio duplicado)
    const doc2 = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id), { idemKey: "r2-claim-3", transmit: false });
    await store.update("fiscal_documents", doc2.id, { status: "queued" });
    await store.create("operations", { companyId: refs.company.id, type: "fiscal.send", status: "failed", entityType: "fiscal_document", entityId: doc2.id, result: { failures: 1 } }, detId("fiscalsend", doc2.id, 1));
    await Promise.all([transmitDocument(ctx, doc2.id), transmitDocument(ctx, doc2.id), transmitDocument(ctx, doc2.id)]);
    expect((await store.get("fiscal_documents", doc2.id))!.attempts).toBe(1);
    expect(await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc2.id], ["eq", "type", "request"]] })).toHaveLength(1);
  });
});

describe("NF-e de operação: filial da origem (medium)", () => {
  it("venda e pedido de compra de outra filial bloqueiam a emissão; pedido de compra usa o depósito do pedido", async () => {
    const mat = await adminCtx();
    const shop = await refs.ctxFor("admin", "shopping");
    const sale = await store.create("sales", { companyId: refs.company.id, branchId: matriz(), number: 7701, status: "completed", customerId: refs.customers.mercado.id, total: 10000 });
    const fromShop = await loadOrigin(shop, "sale", sale.id, shopping());
    expect(fromShop.blockers.join(" ")).toMatch(/filial/);
    expect((await loadOrigin(mat, "sale", sale.id, matriz())).blockers.join(" ")).not.toMatch(/pertence/);
    await expect(saveNfe(shop, { ...nfeInput(refs.skus["caneca-u"].id), branchId: shopping(), origin: { type: "sale", id: sale.id } }, { idemKey: "r2-origin-sale", transmit: false })).rejects.toThrow(/filial/);

    const wh = refs.warehouses["matriz-damaged"];
    const po = await store.create("purchase_orders", { companyId: refs.company.id, branchId: matriz(), number: 7702, supplierId: refs.suppliers.papel.id, warehouseId: wh.id, status: "received" });
    const preMat = await loadOrigin(mat, "purchase_order", po.id, matriz());
    expect(preMat.blockers.join(" ")).not.toMatch(/pertence/);
    expect(preMat.input.effects.warehouseId).toBe(wh.id);
    const preShop = await loadOrigin(shop, "purchase_order", po.id, shopping());
    expect(preShop.blockers.join(" ")).toMatch(/filial/);
    expect(preShop.input.effects.warehouseId ?? null).toBeNull();
  });

  it("depósito dos efeitos de estoque deve ser da filial emitente", async () => {
    const ctx = await adminCtx();
    await expect(
      saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id, { effects: { stock: true, financial: false, warehouseId: refs.warehouses["shopping-main"].id } }), { idemKey: "r2-wh-1", transmit: false }),
    ).rejects.toThrow(/depósito/);
    const ok = await saveNfe(ctx, nfeInput(refs.skus["caneca-u"].id, { effects: { stock: true, financial: false, warehouseId: refs.warehouses["matriz-main"].id } }), { idemKey: "r2-wh-2", transmit: false });
    expect(ok.effects.warehouseId).toBe(refs.warehouses["matriz-main"].id);
  });
});

describe("Inutilização (low)", () => {
  it("registro de inutilização com erro não é descartável, consultável nem retransmitível; lote o ignora", async () => {
    const ctx = await adminCtx();
    const input = { branchId: matriz(), model: "nfe" as const, series: "7", from: 500, to: 502, justification: "Faixa de numeração não utilizada (teste)" };
    await saveFiscalConfig(ctx, matriz(), { simulateOutage: true });
    try {
      await expect(disableNumbers(ctx, input)).rejects.toThrow(/não homologada/);
    } finally {
      await saveFiscalConfig(ctx, matriz(), { simulateOutage: false });
    }
    const rec = (await store.get("fiscal_documents", detId("fiscaldoc", `inut-nfe-${matriz()}-7-500-502`)))!;
    expect(rec.status).toBe("error");
    expect(rec.attempts).toBe(1);
    await expect(cancelDocument(ctx, rec.id, "Descartar pedido de inutilização (teste)")).rejects.toThrow(/inutilização/i);
    await expect(retransmit(ctx, rec.id)).rejects.toThrow(/inutilização/i);
    await expect(queryDocument(ctx, rec.id)).rejects.toThrow(/inutilização/i);
    const batch = await retransmitBatch(ctx, { model: "nfe" });
    expect(batch.map((b) => b.id)).not.toContain(rec.id);
    expect((await store.get("fiscal_documents", rec.id))!.status).toBe("error");
    // repetir o pedido obtém o resultado
    expect((await disableNumbers(ctx, input)).status).toBe("unused");
  });

  it("repetir inutilização já homologada completa a marcação dos documentos da faixa", async () => {
    const ctx = await adminCtx();
    const { s } = await product("r2gap", "00000000");
    const doc = await saveNfe(ctx, nfeInput(s.id), { idemKey: "r2-gap-1", transmit: true });
    expect(doc.status).toBe("rejected");
    const input = { branchId: matriz(), model: "nfe" as const, series: doc.series, from: doc.number, to: doc.number, justification: "Numeração rejeitada e abandonada (teste)" };
    const inut = await disableNumbers(ctx, input);
    expect(inut.status).toBe("unused");
    // execução anterior interrompida depois da homologação: documento da faixa ficou sem a marcação
    await store.update("fiscal_documents", doc.id, { status: "rejected" });
    const again = await disableNumbers(ctx, input);
    expect(again.protocol).toBe(inut.protocol);
    expect((await store.get("fiscal_documents", doc.id))!.status).toBe("unused");
  });
});
