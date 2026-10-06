import "server-only";
import { detId } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { DEFAULT_SETTINGS, setSetting } from "@/lib/core/settings";
import { DEFAULT_TZ } from "@/lib/dates";
import { TIMEZONES } from "@/domain/companies";
import { PARAMS, PARAM_MAP, type ParamDef } from "./catalog";

const scopeKey = (companyId: string, branchId: string | null, key: string) => `${companyId}|${branchId ?? "*"}|${key}`;
const settingId = (companyId: string, branchId: string | null, key: string) => detId("setting", scopeKey(companyId, branchId, key));

export interface ParamState {
  def: ParamDef;
  company: unknown;
  branch: unknown;
  effective: unknown;
  source: "padrão" | "empresa" | "filial" | "instalação";
  updatedAt: string | null;
}

/** Valor efetivo e origem (padrão → empresa → filial) de cada parâmetro. */
export async function loadParameters(store: Store, companyId: string, branchId: string | null): Promise<ParamState[]> {
  const out: ParamState[] = [];
  for (const def of PARAMS) {
    if (def.installation) {
      // fuso único da instalação (APP_TIMEZONE): valor efetivo real, sem gravação por empresa/filial
      out.push({ def, company: undefined, branch: undefined, effective: DEFAULT_TZ, source: "instalação", updatedAt: null });
      continue;
    }
    const c = await store.get("settings", settingId(companyId, null, def.key));
    const b = branchId ? await store.get("settings", settingId(companyId, branchId, def.key)) : null;
    const fallback = (DEFAULT_SETTINGS as Record<string, unknown>)[def.key] ?? def.default;
    const effective = b ? b.value : c ? c.value : fallback;
    out.push({ def, company: c ? c.value : undefined, branch: b ? b.value : undefined, effective, source: b ? "filial" : c ? "empresa" : "padrão", updatedAt: (b ?? c)?.updatedAt ?? null });
  }
  return out;
}

function coerce(def: ParamDef, raw: string): unknown {
  switch (def.type) {
    case "bool":
      return raw === "true" || raw === "on" || raw === "1";
    case "int": {
      const n = Number(raw);
      assert(Number.isInteger(n), `${def.label}: informe um número inteiro.`);
      if (def.min != null) assert(n >= def.min, `${def.label}: mínimo ${def.min}.`);
      if (def.max != null) assert(n <= def.max, `${def.label}: máximo ${def.max}.`);
      return n;
    }
    case "bps": {
      const n = Math.round(Number(raw.replace(",", ".")) * 100);
      assert(Number.isFinite(n), `${def.label}: percentual inválido.`);
      if (def.min != null) assert(n >= def.min, `${def.label}: mínimo ${def.min / 100}%.`);
      if (def.max != null) assert(n <= def.max, `${def.label}: máximo ${def.max / 100}%.`);
      return n;
    }
    case "money": {
      const n = Number(raw);
      assert(Number.isInteger(n) && n >= 0, `${def.label}: valor inválido.`);
      return n;
    }
    case "select":
      assert(def.options?.some((o) => o.value === raw), `${def.label}: opção inválida.`);
      return raw;
    case "timezone":
      assert(TIMEZONES.includes(raw), `${def.label}: fuso inválido.`);
      return raw;
  }
}

/**
 * Grava os parâmetros alterados no escopo (empresa ou filial). Cada alteração é auditada com antes/depois.
 * `clear` remove a substituição da filial (volta a valer o valor da empresa).
 */
export async function saveParameters(ctx: Ctx, branchId: string | null, values: Record<string, string>, clear: string[] = [], reason?: string | null) {
  requirePerm(ctx, "admin", "edit");
  if (branchId) {
    const b = await ctx.store.get("branches", branchId);
    assert(b && b.companyId === ctx.companyId, "Filial inválida.");
  }
  const changes: string[] = [];
  const parsed: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    const def = PARAM_MAP[key];
    if (!def) continue;
    if (def.installation) throw new BusinessError(`${def.label}: definido para toda a instalação (variável APP_TIMEZONE do servidor); não pode ser alterado por empresa ou filial.`, "installation_setting");
    if (!def.scopes.includes(branchId ? "branch" : "company")) continue;
    if (clear.includes(key)) continue;
    parsed[key] = coerce(def, raw);
  }
  // consistência entre parâmetros
  const current = Object.fromEntries((await loadParameters(ctx.store, ctx.companyId, branchId)).map((p) => [p.def.key, p.effective]));
  const limitA = Number(parsed["abc.limitA"] ?? current["abc.limitA"]);
  const limitB = Number(parsed["abc.limitB"] ?? current["abc.limitB"]);
  if (limitA >= limitB) throw new BusinessError("O limite da classe B deve ser maior que o da classe A.", "invalid");
  for (const [key, value] of Object.entries(parsed)) {
    const id = settingId(ctx.companyId, branchId, key);
    const before = await ctx.store.get("settings", id);
    const prev = before ? before.value : undefined;
    if (before && JSON.stringify(prev) === JSON.stringify(value)) continue;
    if (!before && branchId && JSON.stringify(current[key]) === JSON.stringify(value)) continue; // filial sem substituição e mesmo valor: não cria
    if (!before && !branchId && JSON.stringify(current[key]) === JSON.stringify(value)) continue;
    await setSetting(ctx.store, ctx.companyId, branchId, key, value, ctx.user.id);
    changes.push(key);
    await audit(
      { ...ctx, branchId },
      {
        module: "admin", action: "setting.update", entityType: "setting", entityId: id,
        summary: `Parâmetro "${PARAM_MAP[key].label}" alterado ${branchId ? "na filial" : "na empresa"}${prev === undefined ? " (antes: valor herdado)" : ""}`,
        before: { [key]: prev ?? current[key] ?? null }, after: { [key]: value }, reason: reason ?? null,
      },
    );
  }
  for (const key of clear) {
    if (!branchId) continue;
    const id = settingId(ctx.companyId, branchId, key);
    const before = await ctx.store.get("settings", id);
    if (!before) continue;
    await ctx.store.delete("settings", id);
    changes.push(key);
    await audit({ ...ctx, branchId }, { module: "admin", action: "setting.reset", entityType: "setting", entityId: id, summary: `Substituição da filial removida: "${PARAM_MAP[key]?.label ?? key}" volta a seguir a empresa`, before: { [key]: before.value }, after: { [key]: "(valor da empresa)" }, reason: reason ?? null });
  }
  return changes;
}

/** Agenda de backup (parâmetro backup.schedule da empresa). */
export async function saveBackupSchedule(ctx: Ctx, input: { enabled: boolean; frequency: string; time: string; retentionDays: number; includeFiles: boolean; weekday: number; verify: boolean }) {
  requirePerm(ctx, "admin", "edit");
  requireAction(ctx, "admin.backup");
  assert(["daily", "weekly", "monthly"].includes(input.frequency), "Frequência inválida.");
  assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time), "Horário inválido (HH:MM).");
  assert(Number.isInteger(input.retentionDays) && input.retentionDays >= 1 && input.retentionDays <= 3650, "Retenção entre 1 e 3650 dias.");
  assert(Number.isInteger(input.weekday) && input.weekday >= 0 && input.weekday <= 6, "Dia da semana inválido.");
  const id = settingId(ctx.companyId, null, "backup.schedule");
  const before = await ctx.store.get("settings", id);
  const value = { enabled: input.enabled, frequency: input.frequency, time: input.time, retentionDays: input.retentionDays, includeFiles: input.includeFiles, weekday: input.weekday, verify: input.verify };
  if (before && JSON.stringify(before.value) === JSON.stringify(value)) return false;
  await setSetting(ctx.store, ctx.companyId, null, "backup.schedule", value, ctx.user.id);
  await audit(ctx, { module: "admin", action: "setting.update", entityType: "setting", entityId: id, summary: "Programação de backup alterada", before: { "backup.schedule": before?.value ?? DEFAULT_SETTINGS["backup.schedule"] }, after: { "backup.schedule": value } });
  return true;
}
