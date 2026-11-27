import type { Store } from "@/lib/db/types";
import { nowIso } from "@/lib/dates";
import { applyLicense, licenseId } from "./license";
import { emitInterosEvent } from "./events";
import { LICENSE_POLICY } from "./effective";

/**
 * Reconciliação (decisão do titular: o ERP CONSULTA o Interos e o Interos REENVIA quando divergir).
 *  - pull diário: GET INTEROS_LICENSE_URL (com {companyId}) e Bearer INTEROS_OUTBOUND_TOKEN; retrato mais novo é aplicado;
 *  - sem CONFIRMAÇÃO do Interos há mais de 3 dias (retrato recebido, consulta ou pull): evento sync.stale (uma vez por
 *    dia e só com a consulta diária configurada) — a última licença válida continua valendo;
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
      // pull bem-sucedido (o Interos respondeu com o retrato) também é confirmação
      const confirmed = ["up_to_date", "applied", "duplicate", "stale"].includes(String(out.pull));
      if (cur) await store.update("company_licenses", id, { lastSyncAt: nowIso(), lastSyncResult: String(out.pull).slice(0, 300), ...(confirmed ? { lastConfirmedAt: nowIso() } : {}) });
    }
  } else out.pull = "not_configured";
  // proteção contra repetição: Event-Id guardado por 7 dias
  const old = await store.list("interos_events", { filters: [["eq", "companyId", companyId], ["lt", "at", new Date(Date.now() - 7 * 86400000).toISOString()]], limit: 500 });
  for (const e of old.items) await store.delete("interos_events", e.id);
  // sem confirmação do Interos há mais de 3 dias. Conta desde a última CONFIRMAÇÃO (retrato recebido, novo ou
  // repetido; consulta do Interos; pull bem-sucedido) — não desde a última licença nova: empresa estável não envelhece.
  // Só avisa o Interos com a consulta diária (pull) configurada; sem ela, o aviso seria ruído diário sem utilidade.
  const cur = await store.get("company_licenses", id);
  const last = cur?.lastConfirmedAt ?? cur?.lastSnapshotAt ?? null;
  if (cur?.licenseVersion > 0 && last) {
    const ageDays = (Date.now() - Date.parse(last)) / 86400000;
    const notifiedToday = cur.staleNotifiedAt && cur.staleNotifiedAt.slice(0, 10) === nowIso().slice(0, 10);
    if (ageDays > LICENSE_POLICY.staleSyncDays && !notifiedToday) {
      if (template && token) {
        await emitInterosEvent(store, companyId, "sync.stale", { appliedVersion: cur.licenseVersion, lastConfirmedAt: last, lastSnapshotAt: cur.lastSnapshotAt ?? null, ageDays: Math.floor(ageDays) }, `stale:${companyId}:${nowIso().slice(0, 10)}`);
        await store.update("company_licenses", id, { staleNotifiedAt: nowIso() });
        out.stale = true;
      } else out.stale = "local";
    }
  }
  return out;
}
