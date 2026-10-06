import zlib from "node:zlib";
import { appwriteConfig, configuredBackend, detId, isConflict, listAll, sha256 } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { COLLECTIONS, COLLECTION_MAP, type CollectionDef } from "@/lib/db/schema";
import { MemoryStore } from "@/lib/db/memory-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, systemCtx, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { BUCKETS, getFileStorage, saveFile } from "@/lib/core/files";
import { DEFAULT_SETTINGS, getSetting } from "@/lib/core/settings";
import { DEFAULT_TZ, addDays, nowIso, startOfLocalDay, today } from "@/lib/dates";

/**
 * Backup e restauração (Tela 41).
 *
 * Cópia: exporta todas as coleções NÃO efêmeras da empresa (filtradas por companyId quando a coleção tem o campo;
 * coleções globais conforme escopo) e, opcionalmente, o conteúdo dos arquivos (XML, anexos) em base64.
 * O artefato é um JSON compactado com gzip, com manifesto (contagens e SHA-256 por coleção) e é salvo no bucket
 * "backups" (registro em `backups` + `files`). Artefatos acima de 25 MB são divididos em partes.
 *
 * Verificação: restaura o artefato em uma base de TESTE isolada (MemoryStore nova, nunca a base do usuário)
 * e compara contagens e checksums → "verificado (restaurável)" com evidência.
 * Restauração "nova base Appwrite": provisiona outro databaseId e grava a cópia lá (nunca sobrescreve a base em uso).
 */

export const BACKUP_FORMAT = "intercert-backup";
export const BACKUP_VERSION = 1;
const PART_BYTES = 25 * 1024 * 1024;
const MAX_FILES_BYTES = 300 * 1024 * 1024;
const STALE_MINUTES = 30;

/** Metadados do próprio backup não entram na cópia (o artefato não pode conter a si mesmo). */
const SELF_EXCLUDED = new Set(["backups", "restore_jobs"]);

export interface BackupScope {
  includeFiles: boolean;
  includeGlobal: boolean;
}

export interface BackupSchedule {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  time: string;
  retentionDays: number;
  includeFiles: boolean;
  weekday?: number;
  verify?: boolean;
}

export interface Manifest {
  format: string;
  version: number;
  companyId: string;
  companyName: string;
  createdAt: string;
  scope: BackupScope;
  counts: Record<string, number>;
  checksums: Record<string, string>;
  checksum: string;
  files: { included: number; bytes: number; missing: string[]; skippedOverLimit: number };
  excluded: string[];
}

export interface Payload {
  manifest: Manifest;
  collections: Record<string, Array<Record<string, any>>>;
  files: Array<{ id: string; bucket: string; storageId: string; sha256: string; name: string; mime: string; sizeBytes: number; data: string }>;
}

// ───────────────────────────── checksum canônico

function stable(v: any): string {
  if (v === null || v === undefined || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
    .join(",")}}`;
}

/** Representação canônica: id + campos do esquema (tipos normalizados). Carimbos de sistema ficam fora. */
export function canonicalRow(def: CollectionDef, row: Record<string, any>): string {
  const o: Record<string, any> = { id: row.id };
  for (const [k, f] of Object.entries(def.fields)) {
    let v = row[k];
    if (v === undefined || v === "") v = v === "" && (f.type === "string" || f.type === "text") ? "" : null;
    if (f.type === "strings") v = Array.isArray(v) ? v.map(String) : [];
    else if (f.type === "datetime" && typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) v = new Date(t).toISOString();
    } else if (f.type === "bool" && v != null) v = Boolean(v);
    o[k] = v;
  }
  return stable(o);
}

export function collectionChecksum(def: CollectionDef, rows: Array<Record<string, any>>): string {
  const lines = rows.map((r) => canonicalRow(def, r)).sort();
  return sha256(lines.join("\n"));
}

function overallChecksum(counts: Record<string, number>, checksums: Record<string, string>) {
  return sha256(
    Object.keys(checksums)
      .sort()
      .map((k) => `${k}:${counts[k]}:${checksums[k]}`)
      .join("\n"),
  );
}

// ───────────────────────────── coleta

/** Critério de cada coleção na cópia (exibido na prévia). */
export function backupPlan(scope: BackupScope) {
  return COLLECTIONS.filter((c) => !c.ephemeral && !SELF_EXCLUDED.has(c.id)).map((c) => {
    let rule: string;
    if (c.id === "companies") rule = "a própria empresa";
    else if (c.id === "users") rule = "usuários vinculados à empresa e administradores";
    else if (c.id === "user_prefs") rule = "preferências dos usuários incluídos";
    else if (c.id === "counters") rule = scope.includeGlobal ? "numeradores da empresa e globais" : "numeradores da empresa";
    else if (c.id === "help_articles") rule = scope.includeGlobal ? "artigos da empresa e artigos globais" : "artigos da empresa";
    else if (c.id === "tickets" || c.id === "ticket_messages") rule = scope.includeGlobal ? "chamados da empresa e chamados públicos (tela de login)" : "chamados da empresa";
    else if (c.id === "files") rule = scope.includeFiles ? "registros e conteúdo dos arquivos (exceto artefatos de backup)" : "registros dos arquivos (sem conteúdo)";
    else if (c.fields.companyId) rule = "registros da empresa (companyId)";
    else rule = scope.includeGlobal ? "coleção global (completa)" : "coleção global — fora do escopo";
    return { id: c.id, label: c.label, rule };
  });
}

async function collectRows(store: Store, companyId: string, scope: BackupScope): Promise<Record<string, Doc[]>> {
  const out: Record<string, Doc[]> = {};
  let users: Doc[] = [];
  for (const c of COLLECTIONS) {
    if (c.ephemeral || SELF_EXCLUDED.has(c.id)) continue;
    let rows: Doc[];
    if (c.id === "companies") {
      const co = await store.get("companies", companyId);
      rows = co ? [co] : [];
    } else if (c.id === "users") {
      rows = (await listAll(store, "users")).filter((u) => u.isAdmin || (u.companyIds ?? []).includes(companyId));
      users = rows;
    } else if (c.id === "user_prefs") {
      const ids = new Set(users.map((u) => u.id));
      rows = (await listAll(store, "user_prefs")).filter((p) => ids.has(p.userId));
    } else if (c.id === "counters") {
      rows = (await listAll(store, "counters")).filter((k) => String(k.key).includes(companyId) || (scope.includeGlobal && String(k.key).includes("public")));
    } else if (c.id === "help_articles") {
      rows = (await listAll(store, "help_articles")).filter((a) => a.companyId === companyId || (scope.includeGlobal && !a.companyId));
    } else if (c.id === "tickets" || c.id === "ticket_messages") {
      const ids = scope.includeGlobal ? [companyId, "public"] : [companyId];
      rows = await listAll(store, c.id, { filters: [["eq", "companyId", ids]] });
    } else if (c.id === "files") {
      rows = (await listAll(store, "files", { filters: [["eq", "companyId", companyId]] })).filter((f) => f.bucket !== BUCKETS.backups);
    } else if (c.fields.companyId) {
      rows = await listAll(store, c.id, { filters: [["eq", "companyId", companyId]] });
    } else {
      rows = scope.includeGlobal ? await listAll(store, c.id) : [];
    }
    out[c.id] = rows;
  }
  return out;
}

/** Monta o conteúdo (manifesto + dados + arquivos) da cópia. */
export async function buildPayload(store: Store, companyId: string, scope: BackupScope): Promise<Payload> {
  const company = await store.getOrThrow("companies", companyId);
  const collections = await collectRows(store, companyId, scope);
  const counts: Record<string, number> = {};
  const checksums: Record<string, string> = {};
  for (const [id, rows] of Object.entries(collections)) {
    counts[id] = rows.length;
    checksums[id] = collectionChecksum(COLLECTION_MAP[id], rows);
  }
  const files: Payload["files"] = [];
  const missing: string[] = [];
  let bytes = 0;
  let skipped = 0;
  if (scope.includeFiles) {
    const storage = getFileStorage();
    for (const f of collections.files ?? []) {
      if (!f.storageId || !f.bucket) continue;
      if (bytes + (f.sizeBytes ?? 0) > MAX_FILES_BYTES) {
        skipped++;
        continue;
      }
      try {
        const data = await storage.get(f.bucket, f.storageId);
        bytes += data.length;
        files.push({ id: f.id, bucket: f.bucket, storageId: f.storageId, sha256: f.sha256 ?? sha256(data), name: f.name, mime: f.mime, sizeBytes: data.length, data: data.toString("base64") });
      } catch {
        missing.push(f.id);
      }
    }
  }
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    companyId,
    companyName: company.name,
    createdAt: nowIso(),
    scope,
    counts,
    checksums,
    checksum: overallChecksum(counts, checksums),
    files: { included: files.length, bytes, missing, skippedOverLimit: skipped },
    excluded: COLLECTIONS.filter((c) => c.ephemeral || SELF_EXCLUDED.has(c.id)).map((c) => c.id),
  };
  return { manifest, collections, files };
}

export function packPayload(p: Payload): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(p), "utf8"), { level: 6 });
}

export function unpackPayload(buf: Buffer): Payload {
  const p = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  if (p?.manifest?.format !== BACKUP_FORMAT) throw new BusinessError("Arquivo não é um backup do Intercert ERP.", "invalid_backup");
  return p;
}

// ───────────────────────────── restauração em uma base (teste isolada ou nova base Appwrite)

export interface RestoreReport {
  ok: boolean;
  target: string;
  durationMs: number;
  restoredRows: number;
  expectedRows: number;
  collections: Array<{ id: string; expected: number; restored: number; checksumOk: boolean }>;
  mismatches: Array<{ id: string; expected: number; restored: number; reason: string }>;
  errors: string[];
  droppedFields: string[];
  skippedCollections: string[];
  files: { checked: number; ok: number; corrupted: string[]; reuploaded?: number };
  artifactSha256Ok: boolean | null;
  checksum: { expected: string; actual: string };
}

export async function restoreInto(target: Store, payload: Payload, opts: { concurrency?: number } = {}) {
  const errors: string[] = [];
  const dropped = new Set<string>();
  const skipped: string[] = [];
  let restored = 0;
  const conc = Math.max(1, opts.concurrency ?? 1);
  for (const [cid, rows] of Object.entries(payload.collections)) {
    const def = COLLECTION_MAP[cid];
    if (!def) {
      skipped.push(cid);
      continue;
    }
    const insert = async (row: Record<string, any>) => {
      const data: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === "id" || k === "createdAt" || k === "updatedAt") continue;
        if (!def.fields[k]) {
          dropped.add(`${cid}.${k}`);
          continue;
        }
        data[k] = v;
      }
      try {
        await target.create(cid, data, row.id);
        restored++;
      } catch (e: any) {
        if (isConflict(e) && (await target.get(cid, row.id))) {
          restored++;
          return;
        }
        if (errors.length < 30) errors.push(`${cid}/${row.id}: ${e?.message ?? e}`);
      }
    };
    for (let i = 0; i < rows.length; i += conc) await Promise.all(rows.slice(i, i + conc).map(insert));
  }
  return { restored, errors, dropped: [...dropped], skipped };
}

/** Relê a base restaurada e compara com o manifesto (contagens e checksums por coleção). */
export async function compareWithManifest(target: Store, payload: Payload, companyId: string) {
  const m = payload.manifest;
  const actual = await collectRows(target, companyId, m.scope);
  const collections: RestoreReport["collections"] = [];
  const mismatches: RestoreReport["mismatches"] = [];
  const counts: Record<string, number> = {};
  const checksums: Record<string, string> = {};
  for (const id of Object.keys(m.counts)) {
    const rows = actual[id] ?? [];
    const def = COLLECTION_MAP[id];
    const cs = def ? collectionChecksum(def, rows) : "";
    counts[id] = rows.length;
    checksums[id] = cs;
    const ok = rows.length === m.counts[id] && cs === m.checksums[id];
    collections.push({ id, expected: m.counts[id], restored: rows.length, checksumOk: cs === m.checksums[id] });
    if (!ok) mismatches.push({ id, expected: m.counts[id], restored: rows.length, reason: rows.length !== m.counts[id] ? "contagem diferente" : "checksum diferente" });
  }
  return { collections, mismatches, checksum: overallChecksum(counts, checksums) };
}

function checkFiles(payload: Payload) {
  const corrupted: string[] = [];
  let ok = 0;
  for (const f of payload.files) {
    if (sha256(Buffer.from(f.data, "base64")) === f.sha256) ok++;
    else corrupted.push(f.id);
  }
  return { checked: payload.files.length, ok, corrupted };
}

// ───────────────────────────── artefato (gravação e leitura)

async function guard(ctx: Ctx, summary: string, entityId?: string | null) {
  const { auditedGuard } = await import("./roles");
  await auditedGuard(
    ctx,
    () => {
      requirePerm(ctx, "admin", "view");
      requireAction(ctx, "admin.backup");
    },
    { action: "backup.operation", entityType: "backup", entityId, summary },
  );
}

async function readArtifact(store: Store, backup: Doc): Promise<{ buf: Buffer; shaOk: boolean | null }> {
  const parts: string[] = backup.scope?.parts?.length ? backup.scope.parts : backup.fileId ? [backup.fileId] : [];
  assert(parts.length, "Esta cópia não possui artefato disponível (removida pela retenção ou falhou).");
  const storage = getFileStorage();
  const bufs: Buffer[] = [];
  for (const fid of parts) {
    const meta = await store.getOrThrow("files", fid);
    bufs.push(await storage.get(meta.bucket, meta.storageId));
  }
  const buf = Buffer.concat(bufs);
  const expected = backup.scope?.artifactSha256 ?? null;
  return { buf, shaOk: expected ? sha256(buf) === expected : null };
}

export async function loadBackupPayload(store: Store, backup: Doc) {
  const { buf, shaOk } = await readArtifact(store, backup);
  if (shaOk === false) throw new BusinessError("O artefato armazenado não confere com o SHA-256 registrado (arquivo corrompido ou alterado).", "corrupted");
  return { payload: unpackPayload(buf), artifact: buf, shaOk };
}

export async function backupArtifact(store: Store, backup: Doc) {
  return readArtifact(store, backup);
}

// ───────────────────────────── operações

export async function getSchedule(store: Store, companyId: string): Promise<BackupSchedule> {
  const raw = await getSetting<any>(store, companyId, null, "backup.schedule", DEFAULT_SETTINGS["backup.schedule"]);
  return { ...DEFAULT_SETTINGS["backup.schedule"], weekday: 0, verify: true, ...(raw ?? {}) } as BackupSchedule;
}

/** Registra uma nova cópia (manual ou automática) e a executa. Idempotente pela chave. */
export async function createBackup(ctx: Ctx, opts: { kind: "manual" | "auto"; includeFiles: boolean; includeGlobal?: boolean; verify?: boolean; idemKey: string }) {
  if (opts.kind === "manual") await guard(ctx, "criar cópia de segurança");
  const id = detId("backup", ctx.companyId, opts.idemKey);
  const existing = await ctx.store.get("backups", id);
  if (existing) return existing;
  const sched = await getSchedule(ctx.store, ctx.companyId);
  const scope: BackupScope = { includeFiles: opts.includeFiles, includeGlobal: opts.includeGlobal ?? true };
  let b: Doc;
  try {
    const { nextNumber } = await import("@/lib/core/numbering");
    const number = await nextNumber(ctx.store, `backup:${ctx.companyId}`);
    b = await ctx.store.create(
      "backups",
      { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, number, kind: opts.kind, scope, status: "running", startedAt: nowIso(), retentionUntil: addDays(today(), Math.max(1, sched.retentionDays)) },
      id,
    );
  } catch (e) {
    if (isConflict(e)) return (await ctx.store.get("backups", id))!;
    throw e;
  }
  b = await executeBackup(ctx, b);
  if (b.status === "completed" && opts.verify) b = (await verifyBackup(ctx, b.id, { system: opts.kind === "auto" })).backup;
  return b;
}

async function executeBackup(ctx: Ctx, b: Doc): Promise<Doc> {
  const t0 = Date.now();
  try {
    const payload = await buildPayload(ctx.store, ctx.companyId, b.scope);
    const gz = packPayload(payload);
    const artifactSha256 = sha256(gz);
    const parts: string[] = [];
    const n = Math.max(1, Math.ceil(gz.length / PART_BYTES));
    const stamp = payload.manifest.createdAt.replace(/[-:]/g, "").slice(0, 15);
    for (let i = 0; i < n; i++) {
      const chunk = gz.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
      const f = await saveFile(ctx, { bucket: "backups", name: `backup-${stamp}${n > 1 ? `.part${i + 1}` : ""}.json.gz`, mime: "application/gzip", data: Buffer.from(chunk), entityType: "backup", entityId: b.id, kind: n > 1 ? "backup_part" : "backup", branchId: null });
      parts.push(f.id);
    }
    const rows = Object.values(payload.manifest.counts).reduce((a, x) => a + x, 0);
    const after = await ctx.store.update("backups", b.id, {
      status: "completed", fileId: parts[0], sizeBytes: gz.length, checksum: payload.manifest.checksum, counts: payload.manifest.counts, finishedAt: nowIso(), error: null,
      scope: { ...b.scope, parts, artifactSha256, rows, rawBytes: Buffer.byteLength(JSON.stringify(payload)), files: payload.manifest.files, durationMs: Date.now() - t0, format: `${BACKUP_FORMAT}/v${BACKUP_VERSION}` },
    });
    await audit(ctx, {
      module: "admin", action: "backup.create", entityType: "backup", entityId: b.id,
      summary: `Cópia de segurança ${b.kind === "auto" ? "automática" : "manual"} concluída: ${rows.toLocaleString("pt-BR")} registros, ${payload.manifest.files.included} arquivos, ${(gz.length / 1024).toFixed(0)} KB compactados`,
      after: { checksum: payload.manifest.checksum, artifactSha256, sizeBytes: gz.length, parts: parts.length },
    });
    return after;
  } catch (e: any) {
    const after = await ctx.store.update("backups", b.id, { status: "failed", error: String(e?.message ?? e).slice(0, 4000), finishedAt: nowIso() });
    await audit(ctx, { module: "admin", action: "backup.create", entityType: "backup", entityId: b.id, summary: `Falha na cópia de segurança: ${String(e?.message ?? e).slice(0, 300)}`, result: "failure" });
    return after;
  }
}

/** Restaura o artefato em base de TESTE isolada (MemoryStore nova) e compara contagens/checksums. */
export async function verifyBackup(ctx: Ctx, backupId: string, opts: { system?: boolean; idemKey?: string } = {}) {
  if (!opts.system) await guard(ctx, "verificar cópia de segurança", backupId);
  const b = await ctx.store.getOrThrow("backups", backupId);
  assert(b.companyId === ctx.companyId, "Cópia de outra empresa.");
  assert(["completed", "verified"].includes(b.status), "Somente cópias concluídas podem ser verificadas.");
  const job = await createRestoreJob(ctx, b, "test", null, opts.idemKey);
  const result = await runRestoreJob(ctx, job.id);
  return { backup: (await ctx.store.get("backups", backupId))!, job: result };
}

export function restorePreview(b: Doc, target: "test" | "appwrite_new", databaseId: string | null) {
  const counts: Record<string, number> = b.counts ?? {};
  const rows = Object.values(counts).reduce((a: number, x: any) => a + Number(x || 0), 0);
  return {
    backupId: b.id,
    createdAt: b.finishedAt ?? b.startedAt,
    checksum: b.checksum,
    rows,
    collections: Object.keys(counts).length,
    files: b.scope?.files?.included ?? 0,
    sizeBytes: b.sizeBytes,
    target,
    databaseId,
    targetLabel: target === "test" ? "Base de teste isolada em memória (descartada após a verificação)" : `Nova base Appwrite "${databaseId}" no mesmo projeto (a base em uso não é alterada)`,
    top: Object.entries(counts)
      .sort((a: any, b2: any) => b2[1] - a[1])
      .slice(0, 12),
  };
}

export function suggestedDatabaseId() {
  const base = appwriteConfig().databaseId || "intercert";
  const d = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `${base}-r${d}`.slice(0, 36);
}

export async function createRestoreJob(ctx: Ctx, b: Doc, target: "test" | "appwrite_new", databaseId: string | null, idemKey?: string) {
  assert(b.companyId === ctx.companyId, "Cópia de outra empresa: a restauração só pode ser solicitada na empresa da cópia.");
  if (target === "appwrite_new") {
    await guard(ctx, `restaurar cópia em nova base Appwrite ${databaseId ?? ""}`, b.id);
    assert(configuredBackend() === "appwrite", "Restauração em nova base Appwrite exige a aplicação conectada ao Appwrite.");
    assert(databaseId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(databaseId), "Identificador da nova base inválido (até 36 caracteres: letras, números, ponto, hífen, sublinhado).");
    assert(databaseId !== appwriteConfig().databaseId, "A restauração nunca sobrescreve a base em uso: informe um identificador diferente.");
  }
  assert(["completed", "verified"].includes(b.status) && (b.fileId || b.scope?.parts?.length), "Cópia sem artefato disponível.");
  const id = idemKey ? detId("restore", b.id, idemKey) : undefined;
  if (id) {
    const ex = await ctx.store.get("restore_jobs", id);
    if (ex) return ex;
  }
  const job = await ctx.store.create("restore_jobs", { companyId: ctx.companyId, branchId: null, createdBy: ctx.user.id, backupId: b.id, target, status: "pending", preview: restorePreview(b, target, databaseId) }, id);
  await audit(ctx, { module: "admin", action: "restore.request", entityType: "restore_job", entityId: job.id, summary: `Restauração solicitada da cópia de ${new Date(b.finishedAt ?? b.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} → ${target === "test" ? "base de teste isolada" : `nova base Appwrite ${databaseId}`}`, related: [`backup:${b.id}`] });
  return job;
}

/** Executa a restauração registrada em restore_jobs. */
export async function runRestoreJob(ctx: Ctx, jobId: string) {
  const job = await ctx.store.getOrThrow("restore_jobs", jobId);
  assert(job.companyId === ctx.companyId, "Restauração de outra empresa.");
  if (job.status === "completed" || job.status === "failed") return job;
  const b = await ctx.store.getOrThrow("backups", job.backupId);
  assert(b.companyId === job.companyId, "Cópia de outra empresa: restauração recusada.");
  const t0 = Date.now();
  await ctx.store.update("restore_jobs", jobId, { status: "running", startedAt: nowIso() });
  try {
    const { payload, shaOk } = await loadBackupPayload(ctx.store, b);
    let target: Store;
    let reuploaded: number | undefined;
    const databaseId: string | null = job.preview?.databaseId ?? null;
    if (job.target === "appwrite_new") {
      assert(configuredBackend() === "appwrite", "Aplicação não conectada ao Appwrite.");
      const cfg = { ...appwriteConfig(), databaseId: databaseId! };
      assert(cfg.databaseId !== appwriteConfig().databaseId, "Destino igual à base em uso — operação recusada.");
      const { provisionAppwrite } = await import("@/lib/db/provision");
      await provisionAppwrite(cfg, () => undefined);
      const { AppwriteStore } = await import("@/lib/db/appwrite-store");
      target = new AppwriteStore(cfg);
      const nonEmpty = await target.list("companies", { limit: 1, total: false });
      assert(nonEmpty.items.length === 0 || nonEmpty.items[0].id === payload.manifest.companyId, "A base de destino já contém dados de outra empresa — escolha outro identificador.");
    } else {
      target = new MemoryStore(); // base de TESTE isolada; nunca a base do usuário
    }
    const r = await restoreInto(target, payload, { concurrency: job.target === "appwrite_new" ? 8 : 1 });
    const cmp = await compareWithManifest(target, payload, payload.manifest.companyId);
    const files = checkFiles(payload);
    if (job.target === "appwrite_new" && payload.files.length) {
      // blobs ausentes no armazenamento são reenviados a partir do artefato
      const storage = getFileStorage();
      reuploaded = 0;
      for (const f of payload.files) {
        try {
          await storage.get(f.bucket, f.storageId);
        } catch {
          const sid = await storage.put(f.bucket, f.name, Buffer.from(f.data, "base64"), f.mime);
          await target.update("files", f.id, { storageId: sid });
          reuploaded++;
        }
      }
    }
    const expectedRows = Object.values(payload.manifest.counts).reduce((a, x) => a + x, 0);
    const ok = cmp.mismatches.length === 0 && r.errors.length === 0 && files.corrupted.length === 0 && cmp.checksum === payload.manifest.checksum;
    const report: RestoreReport = {
      ok,
      target: job.target === "test" ? "Base de teste isolada (MemoryStore em memória, descartada)" : `Nova base Appwrite ${databaseId}`,
      durationMs: Date.now() - t0,
      restoredRows: r.restored,
      expectedRows,
      collections: cmp.collections,
      mismatches: cmp.mismatches,
      errors: r.errors,
      droppedFields: r.dropped,
      skippedCollections: r.skipped,
      files: { ...files, reuploaded },
      artifactSha256Ok: shaOk,
      checksum: { expected: payload.manifest.checksum, actual: cmp.checksum },
    };
    const done = await ctx.store.update("restore_jobs", jobId, { status: ok ? "completed" : "failed", result: report, finishedAt: nowIso(), error: ok ? null : summarizeFailure(report) });
    if (job.target === "test") {
      await ctx.store.update("backups", b.id, { status: ok ? "verified" : "completed", verifiedAt: nowIso(), verifyResult: { ...report, collections: undefined, restoreJobId: jobId } });
    }
    await audit(ctx, {
      module: "admin", action: job.target === "test" ? "backup.verify" : "restore.execute", entityType: "restore_job", entityId: jobId,
      summary: ok
        ? `${job.target === "test" ? "Verificação" : "Restauração"} concluída: ${r.restored.toLocaleString("pt-BR")} de ${expectedRows.toLocaleString("pt-BR")} registros, checksums iguais (${report.target})`
        : `${job.target === "test" ? "Verificação" : "Restauração"} com divergência: ${summarizeFailure(report)}`,
      result: ok ? "success" : "failure", related: [`backup:${b.id}`],
    });
    if (!ok) await notifyBackupProblem(ctx, b, `Cópia de segurança não passou na ${job.target === "test" ? "verificação" : "restauração"}`, summarizeFailure(report));
    return done;
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 4000);
    const done = await ctx.store.update("restore_jobs", jobId, { status: "failed", error: msg, finishedAt: nowIso(), result: { ok: false, durationMs: Date.now() - t0, errors: [msg] } });
    if (job.target === "test") await ctx.store.update("backups", b.id, { verifiedAt: nowIso(), verifyResult: { ok: false, errors: [msg], restoreJobId: jobId } });
    await audit(ctx, { module: "admin", action: job.target === "test" ? "backup.verify" : "restore.execute", entityType: "restore_job", entityId: jobId, summary: `Falha na ${job.target === "test" ? "verificação" : "restauração"}: ${msg.slice(0, 300)}`, result: "failure", related: [`backup:${b.id}`] });
    return done;
  }
}

function summarizeFailure(r: RestoreReport) {
  const parts: string[] = [];
  if (r.artifactSha256Ok === false) parts.push("artefato corrompido");
  if (r.mismatches.length) parts.push(`${r.mismatches.length} coleção(ões) divergente(s): ${r.mismatches.slice(0, 3).map((m) => `${m.id} (${m.reason})`).join(", ")}`);
  if (r.errors.length) parts.push(`${r.errors.length} erro(s) de gravação: ${r.errors[0]}`);
  if (r.files.corrupted.length) parts.push(`${r.files.corrupted.length} arquivo(s) com conteúdo divergente`);
  if (!parts.length && r.checksum.expected !== r.checksum.actual) parts.push("checksum geral diferente");
  return parts.join("; ").slice(0, 1000);
}

async function notifyBackupProblem(ctx: Ctx, b: Doc, title: string, body: string) {
  const { notify } = await import("@/lib/core/notify");
  await notify(ctx.store, { companyId: ctx.companyId, type: "backup", priority: "high", title, body, link: `/administracao/backups/${b.id}`, originType: "backup", originId: b.id, occurrenceKey: `backup:${b.id}:problem`, audience: { action: "admin.backup" } }).catch(() => 0);
}

/** Remove artefatos vencidos (retenção). Nunca remove a cópia válida mais recente. */
export async function applyRetention(ctx: Ctx, day = today()) {
  const all = await listAll(ctx.store, "backups", { filters: [["eq", "companyId", ctx.companyId]] });
  const valid = all.filter((b) => ["completed", "verified"].includes(b.status)).sort((a, b) => String(b.finishedAt ?? "").localeCompare(String(a.finishedAt ?? "")));
  const keep = valid[0]?.id;
  const storage = getFileStorage();
  const removed: string[] = [];
  for (const b of valid) {
    if (b.id === keep || !b.retentionUntil || b.retentionUntil >= day) continue;
    const parts: string[] = b.scope?.parts?.length ? b.scope.parts : b.fileId ? [b.fileId] : [];
    let bytes = 0;
    for (const fid of parts) {
      const meta = await ctx.store.get("files", fid);
      if (meta) {
        await storage.remove(meta.bucket, meta.storageId).catch(() => undefined);
        bytes += meta.sizeBytes ?? 0;
        await ctx.store.delete("files", fid);
      }
    }
    await ctx.store.update("backups", b.id, { status: "expired", fileId: null, scope: { ...b.scope, parts: [], expiredAt: nowIso(), expiredBytes: bytes, previousStatus: b.status } });
    await audit(ctx, { module: "admin", action: "backup.retention", entityType: "backup", entityId: b.id, summary: `Artefato da cópia de ${String(b.finishedAt ?? b.startedAt).slice(0, 10)} removido pela retenção (vencida em ${b.retentionUntil}; ${(bytes / 1024).toFixed(0)} KB liberados)` });
    removed.push(b.id);
  }
  return { removed: removed.length, kept: keep ?? null };
}

/** Cópias "em execução" abandonadas (processo interrompido) passam a "falhou". */
export async function failStaleBackups(store: Store, companyId: string) {
  const limit = new Date(Date.now() - STALE_MINUTES * 60000).toISOString();
  const running = await listAll(store, "backups", { filters: [["eq", "companyId", companyId], ["eq", "status", "running"]] });
  let n = 0;
  for (const b of running) {
    if (b.startedAt && b.startedAt < limit) {
      await store.update("backups", b.id, { status: "failed", error: `Execução interrompida (sem conclusão após ${STALE_MINUTES} min).`, finishedAt: nowIso() });
      n++;
    }
  }
  return n;
}

/** A agenda vence na data informada? */
export function scheduleDue(s: BackupSchedule, day: string): boolean {
  if (!s.enabled) return false;
  if (s.frequency === "daily") return true;
  const d = new Date(`${day}T12:00:00Z`);
  if (s.frequency === "weekly") return d.getUTCDay() === (s.weekday ?? 0);
  if (s.frequency === "monthly") return day.endsWith("-01");
  return false;
}

export function scheduledInstant(day: string, time: string, tz: string) {
  const [h, m] = (time || "02:00").split(":").map(Number);
  return new Date(Date.parse(startOfLocalDay(day, tz)) + ((h || 0) * 60 + (m || 0)) * 60000).toISOString();
}

/** Próxima execução prevista pela agenda (para exibição). */
export function nextRun(s: BackupSchedule, tz: string, from = new Date()) {
  if (!s.enabled) return null;
  for (let i = 0; i < 40; i++) {
    const day = addDays(today(tz), i);
    if (!scheduleDue(s, day)) continue;
    const at = scheduledInstant(day, s.time, tz);
    if (Date.parse(at) > from.getTime()) return at;
  }
  return null;
}

/** Rotina diária (cron): retenção + agendamento da cópia automática do dia no horário configurado. */
export async function scheduleDailyBackup(store: Store, companyId: string) {
  const { enqueue } = await import("@/lib/core/jobs");
  const ctx = systemCtx(store, companyId);
  const stale = await failStaleBackups(store, companyId);
  const retention = await applyRetention(ctx);
  const s = await getSchedule(store, companyId);
  const tz = DEFAULT_TZ; // fuso único da instalação (APP_TIMEZONE)
  const day = today(tz);
  if (!scheduleDue(s, day)) return { stale, retention, scheduled: null };
  const runAt = scheduledInstant(day, s.time, tz);
  const job = await enqueue(store, { type: "admin.backup.scheduled", payload: { day }, dedupeKey: `backup:auto:${companyId}:${day}`, companyId, runAt, maxAttempts: 3 });
  return { stale, retention, scheduled: { jobId: job.id, runAt } };
}

/** Executor da cópia automática agendada. */
export async function runScheduledBackup(ctx: Ctx, payload: { day: string }) {
  const s = await getSchedule(ctx.store, ctx.companyId);
  const b = await createBackup(ctx, { kind: "auto", includeFiles: s.includeFiles, includeGlobal: true, verify: s.verify !== false, idemKey: `auto:${payload.day}` });
  if (b.status === "failed") {
    await notifyBackupProblem(ctx, b, "Cópia de segurança automática falhou", b.error ?? "");
    throw new Error(b.error ?? "Falha na cópia automática");
  }
  const retention = await applyRetention(ctx);
  return { backupId: b.id, status: b.status, retention };
}

/** Resumo da tela (última cópia, última verificada, ocupação, próxima execução). */
export async function backupSummary(store: Store, companyId: string) {
  const all = await listAll(store, "backups", { filters: [["eq", "companyId", companyId]], orderBy: [{ field: "startedAt", dir: "desc" }] });
  const s = await getSchedule(store, companyId);
  const tz = DEFAULT_TZ; // fuso único da instalação (APP_TIMEZONE)
  const valid = all.filter((b) => ["completed", "verified"].includes(b.status));
  return {
    all,
    schedule: s,
    timezone: tz,
    last: all[0] ?? null,
    lastValid: valid[0] ?? null,
    lastVerified: all.find((b) => b.status === "verified") ?? null,
    storedBytes: valid.reduce((a, b) => a + (b.sizeBytes ?? 0), 0),
    storedCount: valid.length,
    failed: all.filter((b) => b.status === "failed").length,
    nextRun: nextRun(s, tz),
  };
}

/** Identificação legível da cópia (ex.: BKP-0005). */
export function backupCode(b: { number?: number | null; id: string }) {
  return b.number ? `BKP-${String(b.number).padStart(4, "0")}` : `BKP-${b.id.slice(0, 6)}`;
}

export function isBackupBucket(bucket: string) {
  return bucket === BUCKETS.backups;
}
