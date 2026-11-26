import type { Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { applyLicense, licenseId } from "./license";
import { emitInterosEvent } from "./events";
import { LICENSE_POLICY } from "./effective";

/**
 * Reconciliação (decisão do titular: o ERP CONSULTA o Interos e o Interos REENVIA quando divergir).
 *  - pull diário: GET INTEROS_LICENSE_URL (com {companyId}) e Bearer INTEROS_OUTBOUND_TOKEN; retrato mais novo é aplicado;
 *  - sem retrato novo há mais de 3 dias: evento sync.stale (uma vez por dia) — a última licença válida continua valendo;
 *  - Interos indisponível: nada muda (cópia local), a falha fica em lastSyncResult.
 */
export async function reconcileLicense(store: Store, companyId: string, fetcher: typeof fetch = fetch) {
  const id = licenseId(companyId);
  const lic = await store.get("company_licenses", id);
  const template = process.env.INTEROS_LICENSE_URL;
  const token = process.env.INTEROS_OUTBOUND_TOKEN;
  const out: Record<string, unknown> = {};
  if (template && token) {
    const url = template.replace("{companyId}", encodeURIComponent(companyId));
    try {
      const res = await fetcher(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) out.pull = "not_found";
      else if (!res.ok) out.pull = `http_${res.status}`;
      else {
        const body: any = await res.json();
        const snapshot = body?.data ?? body;
        const applied = lic?.licenseVersion ?? 0;
        if (typeof snapshot?.licenseVersion === "number" && snapshot.licenseVersion > applied) {
          const r = await applyLicense(store, companyId, snapshot, { clientId: "interos-pull", source: "pull", actor: "reconciliação" });
          out.pull = r.status;
        } else out.pull = "up_to_date";
      }
    } catch (e: any) {
      out.pull = `error: ${String(e?.message ?? e).slice(0, 200)}`;
    }
    if (lic || out.pull !== "not_found") {
      const cur = await store.get("company_licenses", id);
      if (cur) await store.update("company_licenses", id, { lastSyncAt: nowIso(), lastSyncResult: String(out.pull).slice(0, 300) });
    }
  } else out.pull = "not_configured";
  // proteção contra repetição: Event-Id guardado por 7 dias
  const old = await store.list("interos_events", { filters: [["eq", "companyId", companyId], ["lt", "at", new Date(Date.now() - 7 * 86400000).toISOString()]], limit: 500 });
  for (const e of old.items) await store.delete("interos_events", e.id);
  // retrato envelhecido
  const cur = await store.get("company_licenses", id);
  if (cur?.licenseVersion > 0 && cur.lastSnapshotAt) {
    const ageDays = (Date.now() - Date.parse(cur.lastSnapshotAt)) / 86400000;
    const notifiedToday = cur.staleNotifiedAt && cur.staleNotifiedAt.slice(0, 10) === nowIso().slice(0, 10);
    if (ageDays > LICENSE_POLICY.staleSyncDays && !notifiedToday) {
      await emitInterosEvent(store, companyId, "sync.stale", { appliedVersion: cur.licenseVersion, lastSnapshotAt: cur.lastSnapshotAt, ageDays: Math.floor(ageDays) }, `stale:${companyId}:${nowIso().slice(0, 10)}`);
      await store.update("company_licenses", id, { staleNotifiedAt: nowIso() });
      out.stale = true;
    }
  }
  return out;
}
