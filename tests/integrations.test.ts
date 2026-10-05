import { describe, it, expect, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { freshStore } from "./helpers";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import "@/domain/jobs-registry";
import type { Store } from "@/lib/db/types";
import { detId, listAll } from "@/lib/db";
import { enqueue, registerJob } from "@/lib/core/jobs";
import { diagnose, getIntegration, integrationJobs, requeueJob, runCompanyJobs, saveFiscalIntegration, saveIntegration, secretStatus, testIntegration } from "@/domain/integrations";
import { getFiscalConfig } from "@/domain/fiscal/service";

let store: Store;
let refs: DemoRefs;

beforeAll(async () => {
  store = freshStore();
  refs = await seedBase(store);
}, 60000);

const ctx = () => refs.ctxFor("admin", "matriz");

describe("Central de integrações — estados medidos", () => {
  it("configuração salva começa 'configurada sem teste'; sem credencial no servidor não fica operacional", async () => {
    const c = await ctx();
    delete process.env.MP_TOKEN_TESTE;
    const saved = await saveIntegration(c, { kind: "pix", branchId: null, provider: "mercadopago", environment: "producao", secretRefs: { accessToken: "MP_TOKEN_TESTE" } });
    expect(saved.status).toBe("configured_untested");
    expect(saved.secretRefs).toEqual({ accessToken: "MP_TOKEN_TESTE" });
    const st = secretStatus("pix", "mercadopago", saved.secretRefs);
    expect(st[0]).toEqual({ key: "accessToken", label: "Access token", envName: "MP_TOKEN_TESTE", defined: false });
    const r = await testIntegration(c, "pix", null);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/MP_TOKEN_TESTE/);
    const after = (await getIntegration(store, refs.company.id, null, "pix"))!;
    expect(after.status).toBe("error");
    expect(diagnose(after.status, after.lastTestMessage, st)).toMatch(/Defina no servidor/);
    const logs = await listAll(store, "integration_logs", { filters: [["eq", "kind", "pix"], ["eq", "action", "test"]] });
    expect(logs.at(-1)?.status).toBe("failure");
  });

  it("recusa gravar valor de credencial no lugar do nome da variável", async () => {
    const c = await ctx();
    await expect(saveIntegration(c, { kind: "email", branchId: null, provider: "resend", secretRefs: { apiKey: "re_abc123secreto" } })).rejects.toThrow(/NOME da variável/);
  });

  it("simulação responde como 'Simulação' (não 'Operacional'); TEF manual e importação bancária ficam sem teste com explicação; API bancária indisponível", async () => {
    const c = await ctx();
    await saveIntegration(c, { kind: "pix", branchId: null, provider: "simulated" });
    expect((await testIntegration(c, "pix", null)).status).toBe("simulated");
    await saveIntegration(c, { kind: "card_tef", branchId: null, provider: "manual_pos", config: { acquirer: "X" } });
    const t = await testIntegration(c, "card_tef", null);
    expect(t.status).toBe("configured_untested");
    expect(t.message).toMatch(/não há conexão remota/);
    await saveIntegration(c, { kind: "bank", branchId: null, provider: "open_finance", config: { baseUrl: "https://api.banco.example" }, secretRefs: { clientId: "BANK_ID_X", clientSecret: "BANK_SECRET_X" } });
    const b = await testIntegration(c, "bank", null);
    expect(b.status).toBe("error"); // credenciais ausentes medidas antes de qualquer coisa
    process.env.BANK_ID_X = "x";
    process.env.BANK_SECRET_X = "y";
    expect((await testIntegration(c, "bank", null)).status).toBe("unavailable");
  });

  it("TEF via conector: teste real HTTP (operacional / recusado / inacessível)", async () => {
    const c = await ctx();
    const server = http.createServer((req, res) => {
      res.writeHead(req.headers.authorization === "Bearer tok-ok" ? 200 : 401, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TEF_TOK_X = "tok-ok";
    await saveIntegration(c, { kind: "card_tef", branchId: refs.branches.matriz.id, provider: "tef_connector", config: { connectorUrl: url }, secretRefs: { connectorToken: "TEF_TOK_X" } });
    expect((await testIntegration(c, "card_tef", refs.branches.matriz.id)).status).toBe("operational");
    process.env.TEF_TOK_X = "tok-ruim";
    expect((await testIntegration(c, "card_tef", refs.branches.matriz.id)).status).toBe("error");
    server.close();
    await new Promise((r) => setTimeout(r, 50));
    expect((await testIntegration(c, "card_tef", refs.branches.matriz.id)).status).toBe("unavailable");
  });

  it("e-mail sem canal configurado → erro medido (envio de teste não entregue)", async () => {
    const c = await ctx();
    await saveIntegration(c, { kind: "accounting", branchId: null, provider: "export_package", config: { accountantEmail: "contabil@example.com" } });
    const r = await testIntegration(c, "accounting", null);
    expect(r.ok).toBe(false);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/não configurado/i);
  });

  it("integração fiscal (visão 10) grava em fiscal_configs; Focus sem token → não operacional", async () => {
    const c = await ctx();
    delete process.env.FOCUS_TOKEN_INEXISTENTE;
    await saveFiscalIntegration(c, refs.branches.shopping.id, { kind: "fiscal_nfe", provider: "focusnfe", environment: "homologacao", tokenRef: "FOCUS_TOKEN_INEXISTENTE", cscId: "000001", cscTokenRef: "NFCE_CSC" });
    const cfg = (await getFiscalConfig(store, refs.company.id, refs.branches.shopping.id))!;
    expect(cfg.provider).toBe("focusnfe");
    expect(cfg.connectionStatus).toBe("configured_untested");
    const r = await testIntegration(c, "fiscal_nfe", refs.branches.shopping.id);
    expect(r.ok).toBe(false);
    expect(["not_configured", "error"]).toContain(r.status);
    expect(r.message).toMatch(/FOCUS_TOKEN_INEXISTENTE/);
    const integ = (await store.get("integrations", detId("integration", `${refs.company.id}|${refs.branches.shopping.id}|fiscal_nfe`)))!;
    expect(integ.status).not.toBe("operational");
    await expect(saveFiscalIntegration(c, refs.branches.shopping.id, { kind: "fiscal_nfe", provider: "focusnfe", environment: "homologacao", tokenRef: "abc-token-de-verdade" })).rejects.toThrow(/NOME da variável/);
    await saveFiscalIntegration(c, refs.branches.shopping.id, { kind: "fiscal_nfe", provider: "simulated", environment: "homologacao", tokenRef: "FOCUSNFE_TOKEN" });
    expect((await testIntegration(c, "fiscal_nfe", refs.branches.shopping.id)).status).toBe("simulated");
  });

  it("pendências: tarefa morta é listada, reprocessada e 'executar agora' roda só as da empresa", async () => {
    const c = await ctx();
    let fail = true;
    registerJob("email.teste", async () => {
      if (fail) throw new Error("SMTP fora");
      return { ok: true };
    });
    const job = await enqueue(store, { type: "email.teste", payload: {}, dedupeKey: "email-teste-1", companyId: refs.company.id, maxAttempts: 1 });
    await enqueue(store, { type: "email.teste", payload: {}, dedupeKey: "email-teste-outra", companyId: "outra-empresa" });
    await runCompanyJobs(c);
    expect((await store.get("jobs", job.id))!.status).toBe("dead");
    const pend = await integrationJobs(c, "email", ["dead", "retry"]);
    expect(pend.map((j) => j.id)).toContain(job.id);
    fail = false;
    const r = await requeueJob(c, job.id);
    expect(r[0].status).toBe("done");
    const other = (await store.get("jobs", detId("job", "email-teste-outra")))!;
    expect(other.status).toBe("pending");
  });
});
