import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { scopeStore } from "@/lib/db/scoped-store";
import type { Ctx } from "@/lib/core/ctx";
import { createCompanyWithDefaults } from "@/domain/setup";
import { saveFiscalConfig } from "@/domain/fiscal/service";
import { saveIntegration } from "@/domain/integrations";
import { addTitleAttachment } from "@/domain/finance";
import { notify } from "@/lib/core/notify";

/**
 * Referências conferidas no servidor (docs/multiempresa/homologacao.md §11, itens corrigidos na integração): filial,
 * arquivo e destinatário de outra empresa não entram num registro desta — nem como registro órfão.
 */
let store: Store;
let A: { company: Doc; branch: Doc };
let B: { company: Doc; branch: Doc };
let ana: Doc;
let bia: Doc;

function ctxOf(c: { company: Doc; branch: Doc }): Ctx {
  return {
    store: scopeStore(store, c.company.id),
    companyId: c.company.id,
    branchId: c.branch.id,
    user: { id: "adm-teste", name: "Administração", email: "", isAdmin: true, permissions: {}, actions: [], discountLimitBps: 0, branchIds: [], companyIds: [c.company.id] },
  };
}

beforeAll(async () => {
  store = freshStore();
  A = await createCompanyWithDefaults(store, { name: "Alfa Referências Ltda", key: "ref-alfa" });
  B = await createCompanyWithDefaults(store, { name: "Bravo Referências Ltda", key: "ref-bravo" });
  ana = await store.create("users", { name: "Ana Alfa", email: "ana@ref.example", status: "active", companyIds: [A.company.id], branchIds: [] }, "ref-ana");
  bia = await store.create("users", { name: "Bia Bravo", email: "bia@ref.example", status: "active", companyIds: [B.company.id], branchIds: [] }, "ref-bia");
});

describe("referências de outra empresa são recusadas", () => {
  it("configuração fiscal com filial de outra empresa: recusada, nada gravado; a própria filial continua aceita", async () => {
    const before = (await listAll(store, "fiscal_configs")).length;
    await expect(saveFiscalConfig(ctxOf(A), B.branch.id, { environment: "homologacao" })).rejects.toThrow(/Filial não encontrada nesta empresa/);
    expect((await listAll(store, "fiscal_configs")).length).toBe(before);
    const own = await saveFiscalConfig(ctxOf(A), A.branch.id, { environment: "homologacao" });
    expect(own.branchId).toBe(A.branch.id);
  });

  it("integração com filial de outra empresa: recusada", async () => {
    await expect(saveIntegration(ctxOf(A), { kind: "email", branchId: B.branch.id, provider: "resend", config: { from: "nao@ref.example" } })).rejects.toThrow(/Filial não encontrada nesta empresa/);
    expect((await listAll(store, "integrations", { filters: [["eq", "branchId", B.branch.id]] })).length).toBe(0);
  });

  it("anexo de título com arquivo de outra empresa: recusado; arquivo da própria empresa continua aceito", async () => {
    const title = await store.create("titles", { companyId: A.company.id, branchId: A.branch.id, kind: "receivable", description: "Título de teste", total: 1000, balance: 1000, status: "open", attachments: [] });
    const fileB = await store.create("files", { companyId: B.company.id, bucket: "attachments", name: "comprovante-bravo.pdf", mime: "application/pdf", sizeBytes: 10 });
    const fileA = await store.create("files", { companyId: A.company.id, bucket: "attachments", name: "comprovante-alfa.pdf", mime: "application/pdf", sizeBytes: 10 });
    await expect(addTitleAttachment(ctxOf(A), title.id, { fileId: fileB.id, name: "comprovante-bravo.pdf", mime: "application/pdf", size: 10 } as any)).rejects.toThrow(/Arquivo não encontrado nesta empresa/);
    const ok = await addTitleAttachment(ctxOf(A), title.id, { fileId: fileA.id, name: "comprovante-alfa.pdf", mime: "application/pdf", size: 10 } as any);
    expect((ok.attachments as any[]).map((a) => a.fileId)).toEqual([fileA.id]);
  });

  it("notificação com destinatário de outra empresa: só os vinculados à empresa recebem", async () => {
    const n = await notify(store, { companyId: A.company.id, type: "info", title: "Aviso interno da Alfa", audience: { userIds: [ana.id, bia.id] } });
    expect(n).toBe(1);
    const rows = await listAll(store, "notifications", { filters: [["eq", "companyId", A.company.id]] });
    expect(rows.map((r) => r.userId)).toEqual([ana.id]);
  });
});
