import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import "@/domain/jobs-registry";
import { detId, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { enqueue, runDueJobs } from "@/lib/core/jobs";
import { nowIso } from "@/lib/dates";
import { diagnose, getIntegration, saveIntegration, secretStatus, testIntegration } from "@/domain/integrations";
import { pixProviderFrom } from "@/domain/payments/providers";
import { retransmit, transmitDocument } from "@/domain/fiscal/service";
import { saveNfe, type NfeInput } from "@/domain/fiscal/nfe";
import { integrationOverview } from "@/app/(app)/administracao/integracoes/queries";

/** Rodada 3 — reivindicação de envio fiscal e vínculo de credenciais (verificação independente). */

let store: Store;
let refs: DemoRefs;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
  delete (store as any).update;
});

const adminCtx = () => refs.ctxFor("admin", "matriz");
const matriz = () => refs.branches.matriz.id;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

function nfeInput(): NfeInput {
  const c = refs.customers.mercado;
  return {
    branchId: matriz(),
    origin: { type: "manual" },
    nature: "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: "1",
    recipient: { partyType: "customer", partyId: c.id, name: c.name, doc: c.doc, ie: c.ie, ieIndicator: "1", email: c.email, address: c.addresses[0] },
    items: [{ skuId: refs.skus["caneca-u"].id, qty: 2000, unitPrice: 5000, discount: 0 }],
    freight: 0,
    insurance: 0,
    other: 0,
    transport: { mode: "9" },
    payments: [{ kind: "boleto", amount: 10000 }],
    referencedKeys: [],
    effects: { stock: false, financial: false },
  };
}

async function queuedDoc(key: string) {
  const ctx = await adminCtx();
  const doc = await saveNfe(ctx, nfeInput(), { idemKey: `r3-${key}`, transmit: false });
  await store.update("fiscal_documents", doc.id, { status: "queued" });
  return doc;
}

const claim = (docId: string, attempt: number, status: string, result: Record<string, any>) =>
  store.create("operations", { companyId: refs.company.id, type: "fiscal.send", status, entityType: "fiscal_document", entityId: docId, result }, detId("fiscalsend", docId, attempt));

const requests = (docId: string) => listAll(store, "fiscal_events", { filters: [["eq", "documentId", docId], ["eq", "type", "request"]] });

async function runJob(jobId: string) {
  await store.update("jobs", jobId, { runAt: nowIso() });
  return (await runDueJobs(store, { jobIds: [jobId], limit: 1 }))[0];
}

/** Falha transitória (uma vez) na gravação da tentativa ("processing") do documento. */
function failProcessingOnce(docId: string) {
  const original = store.update.bind(store);
  let fail = true;
  (store as any).update = async (collection: string, id: string, patch: Record<string, any>) => {
    if (fail && collection === "fiscal_documents" && id === docId && patch.status === "processing") {
      fail = false;
      throw new Error("Falha transitória do banco (teste)");
    }
    return original(collection, id, patch);
  };
}

describe("Reivindicação de envio parada (low): 'abandoned' e vencidas são retomadas; 'busy' não reagenda para sempre", () => {
  it("cenário do revisor: reivindicação 1 abandonada + 2 falhou (dados da versão anterior) — a tarefa e a retransmissão enviam", async () => {
    const doc = await queuedDoc("abandoned-legacy");
    await claim(doc.id, 1, "abandoned", { claimedAt: minutesAgo(10) });
    await claim(doc.id, 2, "failed", { claimedAt: minutesAgo(9), failures: 1 });
    const job = await enqueue(store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: matriz() }, dedupeKey: `r3-job-${doc.id}`, companyId: refs.company.id });
    const r = await runJob(job.id);
    expect(r.status).toBe("done");
    const cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.attempts).toBe(1);
    expect(["processing", "authorized"]).toContain(cur.status);
    expect(await requests(doc.id)).toHaveLength(1);
  });

  it("processo interrompido (reivindicação 'running' vencida) + falha antes de registrar: a próxima execução envia (sem bloqueio)", async () => {
    const doc = await queuedDoc("stale-then-fail");
    await claim(doc.id, 1, "running", { claimedAt: minutesAgo(10) });
    const job = await enqueue(store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: matriz() }, dedupeKey: `r3-job-${doc.id}`, companyId: refs.company.id });
    failProcessingOnce(doc.id);
    const r1 = await runJob(job.id);
    delete (store as any).update;
    expect(r1.status).toBe("retry");
    expect(r1.error).toMatch(/transitória/);
    let cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.attempts ?? 0).toBe(0);
    // a reivindicação vencida foi retomada (não abandonada) e liberada pela falha
    expect((await store.get("operations", detId("fiscalsend", doc.id, 1)))!.status).toBe("failed");
    expect(await store.get("operations", detId("fiscalsend", doc.id, 2))).toBeNull();
    const r2 = await runJob(job.id);
    expect(r2.status).toBe("done");
    cur = (await store.get("fiscal_documents", doc.id))!;
    expect(cur.attempts).toBe(1);
    expect(["processing", "authorized"]).toContain(cur.status);
    expect(await requests(doc.id)).toHaveLength(1);
  });

  it("retransmissão manual com reivindicação abandonada não devolve o documento inalterado", async () => {
    const doc = await queuedDoc("abandoned-manual");
    await store.update("fiscal_documents", doc.id, { status: "error" });
    await claim(doc.id, 1, "abandoned", { claimedAt: minutesAgo(30) });
    const out = await retransmit(await adminCtx(), doc.id);
    expect(out.attempts).toBe(1);
    expect(["processing", "authorized"]).toContain(out.status);
    expect(await requests(doc.id)).toHaveLength(1);
  });

  it("reivindicação vencida disputada por envios simultâneos: um único processo retoma (sem envio duplicado)", async () => {
    const doc = await queuedDoc("stale-concurrent");
    await claim(doc.id, 1, "running", { claimedAt: minutesAgo(10) });
    const ctx = await adminCtx();
    await Promise.all([transmitDocument(ctx, doc.id), transmitDocument(ctx, doc.id), transmitDocument(ctx, doc.id)]);
    expect((await store.get("fiscal_documents", doc.id))!.attempts).toBe(1);
    expect(await requests(doc.id)).toHaveLength(1);
  });

  it("retomada parada além da validade (processo interrompido após retomar) consome a tentativa; retomada recente aguarda", async () => {
    const ctx = await adminCtx();
    const doc = await queuedDoc("retake-stale");
    await claim(doc.id, 1, "failed", { failures: 1 });
    // retomada recente de outro processo: aguarda (documento inalterado, sem envio)
    const retakeId = detId("fiscalsend-retake", doc.id, 1, 1);
    await store.create("operations", { companyId: refs.company.id, type: "fiscal.send_retake", status: "done", entityType: "fiscal_document", entityId: doc.id, result: { retakenAt: nowIso() } }, retakeId);
    let busy = "";
    const same = await transmitDocument(ctx, doc.id, { onBusy: (h) => (busy = h) });
    expect(busy).toBe(retakeId);
    expect(same.attempts ?? 0).toBe(0);
    expect(await requests(doc.id)).toHaveLength(0);
    // a retomada venceu sem que a reivindicação fosse atualizada: segue para a tentativa 2
    await store.update("operations", retakeId, { result: { retakenAt: minutesAgo(10) } });
    const sent = await transmitDocument(ctx, doc.id);
    expect(sent.attempts).toBe(2);
    expect(await requests(doc.id)).toHaveLength(1);
  });

  it("tarefa aguardando um detentor recente reagenda; vencida a reivindicação, retoma e envia", async () => {
    const doc = await queuedDoc("busy-then-stale");
    await claim(doc.id, 1, "running", { claimedAt: nowIso() });
    const job = await enqueue(store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: matriz() }, dedupeKey: `r3-job-${doc.id}`, companyId: refs.company.id });
    const r1 = await runJob(job.id);
    expect(r1.status).toBe("retry");
    expect((await store.get("jobs", job.id))!.runAt > nowIso()).toBe(true);
    // o detentor parou: passada a validade, a próxima execução retoma a mesma tentativa
    await store.update("operations", detId("fiscalsend", doc.id, 1), { result: { claimedAt: minutesAgo(6) } });
    const r2 = await runJob(job.id);
    expect(r2.status).toBe("done");
    expect((await store.get("fiscal_documents", doc.id))!.attempts).toBe(1);
    expect(await requests(doc.id)).toHaveLength(1);
  });

  it("detentor que nunca vence (ex.: relógio adiantado) não reagenda para sempre: encerra com alerta", async () => {
    const doc = await queuedDoc("busy-forever");
    // marca de tempo adiantada (dentro da validade): continua "recente" a cada execução
    await claim(doc.id, 1, "running", { claimedAt: new Date(Date.now() + 2 * 60000).toISOString() });
    const job = await enqueue(store, { type: "fiscal.transmit", payload: { documentId: doc.id, branchId: matriz() }, dedupeKey: `r3-job-${doc.id}`, companyId: refs.company.id });
    expect((await runJob(job.id)).status).toBe("retry");
    expect((await runJob(job.id)).status).toBe("retry");
    const waits = await listAll(store, "operations", { filters: [["eq", "type", "fiscal.send_wait"], ["eq", "entityId", doc.id]] });
    expect(waits).toHaveLength(1);
    // a mesma espera ultrapassa o limite (15 min): para de reagendar e alerta
    await store.update("operations", waits[0].id, { result: { since: minutesAgo(16) } });
    const r = await runJob(job.id);
    expect(r.status).toBe("done");
    const j = (await store.get("jobs", job.id))!;
    expect(j.status).toBe("done");
    expect(j.result).toMatchObject({ busy: true, stopped: true });
    const ev = await listAll(store, "fiscal_events", { filters: [["eq", "documentId", doc.id], ["eq", "type", "retry"]] });
    expect(ev.at(-1)?.message).toMatch(/Envio automático interrompido.*Retransmitir/);
    const notes = await listAll(store, "notifications", { filters: [["eq", "occurrenceKey", `fiscal:${doc.id}`]] });
    expect(notes.length).toBeGreaterThan(0);
    expect(await requests(doc.id)).toHaveLength(0);
  });

  it("marca de tempo inválida ou muito adiantada não segura o envio", async () => {
    const ctx = await adminCtx();
    const a = await queuedDoc("ts-invalid");
    await claim(a.id, 1, "running", { claimedAt: "data-invalida" });
    expect((await transmitDocument(ctx, a.id)).attempts).toBe(1);
    const b = await queuedDoc("ts-future");
    await claim(b.id, 1, "running", { claimedAt: new Date(Date.now() + 60 * 60000).toISOString() });
    expect((await transmitDocument(ctx, b.id)).attempts).toBe(1);
  });
});

describe("Remover vínculo de credencial (low): a tela reflete o uso real", () => {
  it("Pix/Mercado Pago sem vínculo: overview mostra 'sem vínculo' (não a variável padrão) e o diagnóstico pede o vínculo", async () => {
    const ctx = await adminCtx();
    process.env.MERCADOPAGO_ACCESS_TOKEN = "tok-teste";
    try {
      await saveIntegration(ctx, { kind: "pix", branchId: matriz(), provider: "mercadopago", environment: "homologacao", secretRefs: { accessToken: "MERCADOPAGO_ACCESS_TOKEN" } });
      let o = await integrationOverview(ctx, "pix");
      expect(o.secrets[0]).toMatchObject({ envName: "MERCADOPAGO_ACCESS_TOKEN", defined: true });
      // "Remover vínculo" (mesma chamada da ação)
      const integ = (await getIntegration(store, refs.company.id, matriz(), "pix"))!;
      await saveIntegration(ctx, { kind: "pix", branchId: matriz(), provider: "mercadopago", environment: integ.environment, config: integ.config ?? {}, secretRefs: {}, enabled: true }, { unlinkSecrets: true });
      const after = (await getIntegration(store, refs.company.id, matriz(), "pix"))!;
      expect(after.secretRefs).toEqual({});
      expect(pixProviderFrom(after)).toBeNull();
      o = await integrationOverview(ctx, "pix");
      expect(o.secrets[0]).toMatchObject({ envName: "", defined: false });
      const r = await testIntegration(ctx, "pix", matriz());
      expect(r.ok).toBe(false);
      o = await integrationOverview(ctx, "pix");
      expect(o.diagnosis).toMatch(/sem vínculo/);
      expect(o.diagnosis).not.toMatch(/Corrija a causa/);
    } finally {
      delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    }
  });

  it("secretStatus: nome padrão só sem registro salvo; Resend em branco e token fiscal removido aparecem sem vínculo", () => {
    process.env.RESEND_API_KEY = "re-teste";
    try {
      expect(secretStatus("email", "resend", undefined)[0]).toMatchObject({ envName: "RESEND_API_KEY", defined: true });
      expect(secretStatus("email", "resend", null)[0]).toMatchObject({ envName: "RESEND_API_KEY", defined: true });
      const blank = secretStatus("email", "resend", {});
      expect(blank[0]).toMatchObject({ envName: "", defined: false });
      expect(diagnose("error", "Credencial do Resend ausente.", blank)).toMatch(/sem vínculo \(Chave da API\)/);
    } finally {
      delete process.env.RESEND_API_KEY;
    }
    expect(secretStatus("fiscal_nfe", "focusnfe", { token: "" })[0]).toMatchObject({ envName: "", defined: false });
    expect(secretStatus("fiscal_nfe", "focusnfe", { token: "FOCUSNFE_TOKEN" })[0]).toMatchObject({ envName: "FOCUSNFE_TOKEN" });
  });
});
