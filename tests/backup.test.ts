import { describe, it, expect, beforeAll } from "vitest";
import zlib from "node:zlib";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { seedBase, type DemoRefs } from "@/domain/seed/base";
import { listAll, sha256 } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { getFileStorage, saveFile } from "@/lib/core/files";
import { runDueJobs } from "@/lib/core/jobs";
import { setSetting } from "@/lib/core/settings";
import { addDays, today } from "@/lib/dates";
import { createBackup, verifyBackup, applyRetention, loadBackupPayload, scheduleDailyBackup, scheduleDue, collectionChecksum, buildPayload, compareWithManifest, restoreInto } from "@/domain/backup";
import { COLLECTION_MAP } from "@/lib/db/schema";
import { MemoryStore as MS } from "@/lib/db/memory-store";
import "@/domain/jobs-registry";
import type { Ctx } from "@/lib/core/ctx";

let store: MemoryStore;
let refs: DemoRefs;
let admin: Ctx;
let companyId: string;

const snapshot = async () => {
  const out: Record<string, string> = {};
  for (const c of ["sales", "stock_movements", "titles", "customers", "users", "account_entries"]) out[c] = collectionChecksum(COLLECTION_MAP[c], await listAll(store, c));
  return out;
};

beforeAll(async () => {
  store = freshStore();
  const r = await seedDemo(store, { historyDays: 3 });
  companyId = r.companyId;
  refs = await seedBase(store);
  admin = await refs.ctxFor("admin");
  await saveFile(admin, { bucket: "attachments", name: "nota.xml", mime: "application/xml", data: Buffer.from("<nfe>teste</nfe>"), entityType: "customer", entityId: refs.customers.maria.id });
}, 120000);

describe("backup e restauração", () => {
  it("gera a cópia (gzip + manifesto + SHA-256) e comprova a recuperação em base de teste isolada", async () => {
    const before = await snapshot();
    const b = await createBackup(admin, { kind: "manual", includeFiles: true, verify: true, idemKey: "t1" });
    expect(b.status).toBe("verified");
    expect(b.verifyResult.ok).toBe(true);
    expect(b.verifyResult.checksum.expected).toBe(b.checksum);
    expect(b.verifyResult.checksum.actual).toBe(b.checksum);
    expect(b.verifyResult.restoredRows).toBe(b.verifyResult.expectedRows);
    expect(b.verifyResult.files.checked).toBeGreaterThan(0);
    expect(b.verifyResult.files.ok).toBe(b.verifyResult.files.checked);
    // artefato salvo no bucket de backups e registrado em files
    const file = (await store.get("files", b.fileId))!;
    expect(file.bucket).toBe("backups");
    const blob = await getFileStorage().get(file.bucket, file.storageId);
    expect(sha256(blob)).toBe(b.scope.artifactSha256);
    expect(file.sha256).toBe(b.scope.artifactSha256);
    const { payload } = await loadBackupPayload(store, b);
    expect(payload.manifest.counts.sales).toBe((await listAll(store, "sales", { filters: [["eq", "companyId", companyId]] })).length);
    expect(payload.manifest.counts.sales).toBeGreaterThan(0);
    expect(payload.manifest.excluded).toContain("sessions");
    // contagens por coleção restauradas = manifesto
    const job = (await store.get("restore_jobs", b.verifyResult.restoreJobId))!;
    expect(job.status).toBe("completed");
    expect(job.result.collections.every((c: any) => c.checksumOk && c.expected === c.restored)).toBe(true);
    // a base do usuário não foi tocada pela verificação
    expect(await snapshot()).toEqual(before);
    // idempotente pela chave
    expect((await createBackup(admin, { kind: "manual", includeFiles: true, idemKey: "t1" })).id).toBe(b.id);
  }, 120000);

  it("detecta divergência: artefato adulterado e dados diferentes não passam na verificação", async () => {
    const b = await createBackup(admin, { kind: "manual", includeFiles: false, idemKey: "t2" });
    expect(b.status).toBe("completed");
    const file = (await store.get("files", b.fileId))!;
    const fs = getFileStorage();
    const original = await fs.get(file.bucket, file.storageId);
    // adultera o conteúdo mantendo um gzip válido
    const p = JSON.parse(zlib.gunzipSync(original).toString("utf8"));
    p.collections.customers[0].name = "Adulterado";
    const tampered = zlib.gzipSync(Buffer.from(JSON.stringify(p)));
    const sid = await fs.put(file.bucket, file.name, tampered, file.mime);
    await store.update("files", file.id, { storageId: sid });
    const r = await verifyBackup(admin, b.id);
    expect(r.job.status).toBe("failed");
    expect(r.backup.status).toBe("completed");
    expect(r.job.error).toMatch(/SHA-256|corrompido/);
    // comparação por checksum detecta alteração de dado mesmo com sha do artefato ignorado
    const payload = await buildPayload(store, companyId, { includeFiles: false, includeGlobal: true });
    const test = new MS();
    await restoreInto(test, payload);
    const ok = await compareWithManifest(test, payload, companyId);
    expect(ok.mismatches).toHaveLength(0);
    const first = (await listAll(test, "customers"))[0];
    await test.update("customers", first.id, { name: "Mudado na base de teste" });
    const bad = await compareWithManifest(test, payload, companyId);
    expect(bad.mismatches.map((m) => m.id)).toEqual(["customers"]);
  }, 120000);

  it("retenção remove artefatos vencidos e preserva a cópia válida mais recente", async () => {
    const old1 = await createBackup(admin, { kind: "manual", includeFiles: false, idemKey: "r1" });
    const old2 = await createBackup(admin, { kind: "manual", includeFiles: false, idemKey: "r2" });
    const recent = await createBackup(admin, { kind: "manual", includeFiles: false, idemKey: "r3" });
    const past = addDays(today(), -2);
    for (const b of await listAll(store, "backups")) await store.update("backups", b.id, { retentionUntil: past });
    // garante ordenação por conclusão
    await store.update("backups", recent.id, { finishedAt: new Date(Date.now() + 1000).toISOString() });
    const f1 = (await store.get("files", old1.fileId))!;
    const res = await applyRetention(admin);
    expect(res.kept).toBe(recent.id);
    expect(res.removed).toBeGreaterThanOrEqual(2);
    expect((await store.get("backups", old1.id))!.status).toBe("expired");
    expect((await store.get("backups", old2.id))!.fileId).toBeNull();
    expect(await store.get("files", f1.id)).toBeNull();
    await expect(getFileStorage().get(f1.bucket, f1.storageId)).rejects.toThrow();
    expect((await store.get("backups", recent.id))!.status).toBe("completed");
    expect(await store.get("files", recent.fileId)).not.toBeNull();
    await expect(verifyBackup(admin, old1.id)).rejects.toThrow(/concluídas/);
  }, 120000);

  it("rotina diária agenda a cópia automática no horário configurado e o executor cria e verifica", async () => {
    expect(scheduleDue({ enabled: true, frequency: "weekly", weekday: 1, time: "02:00", retentionDays: 7, includeFiles: false }, "2026-10-05")).toBe(true); // segunda
    expect(scheduleDue({ enabled: true, frequency: "weekly", weekday: 2, time: "02:00", retentionDays: 7, includeFiles: false }, "2026-10-05")).toBe(false);
    expect(scheduleDue({ enabled: true, frequency: "monthly", time: "02:00", retentionDays: 7, includeFiles: false }, "2026-10-01")).toBe(true);
    await setSetting(store, companyId, null, "backup.schedule", { enabled: true, frequency: "daily", time: "00:00", retentionDays: 10, includeFiles: false, verify: true });
    const r: any = await scheduleDailyBackup(store, companyId);
    expect(r.scheduled.jobId).toBeTruthy();
    const job = (await store.get("jobs", r.scheduled.jobId))!;
    expect(job.type).toBe("admin.backup.scheduled");
    const results = await runDueJobs(store, { jobIds: [job.id] });
    expect(results[0].status).toBe("done");
    const autos = (await listAll(store, "backups")).filter((b) => b.kind === "auto");
    expect(autos).toHaveLength(1);
    expect(autos[0].status).toBe("verified");
    expect(autos[0].retentionUntil).toBe(addDays(today(), 10));
    // reagendar no mesmo dia não duplica
    const r2: any = await scheduleDailyBackup(store, companyId);
    expect(r2.scheduled.jobId).toBe(job.id);
  }, 120000);
});
