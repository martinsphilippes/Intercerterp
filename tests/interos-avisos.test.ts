import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `after` do Next: captura o que seria executado depois da resposta (aqui, fora de uma requisição)
const later = vi.hoisted(() => [] as Array<() => Promise<unknown> | unknown>);
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void later.push(fn as any) }));
vi.mock("server-only", () => ({}));

import { freshStore } from "./helpers";
import { listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { createCompanyWithDefaults } from "@/domain/setup";
import { emitInterosEvent, retryDueEventsSoon, verifySignature } from "@/domain/licensing/events";
import "@/domain/jobs-registry";

/**
 * Avisos do ERP para o Interos (pedido do Interos, 27/11): entrega NA HORA, logo depois de enfileirar (fora do tempo da
 * resposta), e novas tentativas a cada consulta do Interos — a rotina diária fica só como rede de segurança.
 */
let store: Store;
let companyId: string;
const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
let respond = 200;

beforeEach(async () => {
  store = freshStore();
  companyId = (await createCompanyWithDefaults(store, { name: "Avisos Ltda", key: "avisos-empresa" })).company.id;
  later.length = 0;
  calls.length = 0;
  respond = 200;
  process.env.INTEROS_EVENTS_URL = "https://interos.example/api/webhooks/erp";
  process.env.INTEROS_OUTBOUND_SECRET = "s".repeat(40);
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return new Response("{}", { status: respond });
  });
  (globalThis as any).__interosEventsRetryAt = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INTEROS_EVENTS_URL;
  delete process.env.INTEROS_OUTBOUND_SECRET;
});

describe("avisos do ERP para o Interos", () => {
  it("entrega logo depois de enfileirar (after), assinado, sem esperar a rotina diária", async () => {
    const job = await emitInterosEvent(store, companyId, "upsell.requested", { code: "05.02", module: "compras.cotacoes" });
    expect(later.length).toBe(1); // agendado para depois da resposta
    for (const fn of later.splice(0)) await fn();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://interos.example/api/webhooks/erp");
    expect(calls[0].headers["x-erp-event-type"]).toBe("upsell.requested");
    expect(verifySignature("s".repeat(40), calls[0].headers["x-erp-signature"], calls[0].body).ok).toBe(true);
    expect(JSON.parse(calls[0].body)).toMatchObject({ type: "upsell.requested", companyId, data: { code: "05.02" } });
    expect((await store.get("jobs", job.id))!.status).toBe("done");
  });

  it("falhou na hora: fica na fila e sai na próxima consulta do Interos", async () => {
    respond = 503;
    const job = await emitInterosEvent(store, companyId, "license.applied", { licenseVersion: 3 });
    for (const fn of later.splice(0)) await fn();
    const queued = (await store.get("jobs", job.id))!;
    expect(queued.status).toBe("retry");
    // a próxima tentativa vence; a consulta do Interos agenda as novas tentativas
    await store.update("jobs", job.id, { runAt: new Date(Date.now() - 1000).toISOString() });
    respond = 200;
    retryDueEventsSoon();
    expect(later.length).toBe(1);
    for (const fn of later.splice(0)) await fn();
    expect((await store.get("jobs", job.id))!.status).toBe("done");
    expect(calls.length).toBe(2);
  });

  it("sem destino configurado: nada é agendado e o aviso fica na fila (nunca dado como entregue)", async () => {
    delete process.env.INTEROS_EVENTS_URL;
    const job = await emitInterosEvent(store, companyId, "limit.reached", { limit: "users" });
    expect(later.length).toBe(0);
    retryDueEventsSoon();
    expect(later.length).toBe(0);
    expect((await store.get("jobs", job.id))!.status).toBe("pending");
    expect((await listAll(store, "jobs", { filters: [["eq", "type", "interos.event"]] })).length).toBe(1);
  });
});
