import { listAll } from "@/lib/db";
import { systemCtx } from "@/lib/core/ctx";
import { enqueue } from "@/lib/core/jobs";
import { notify } from "@/lib/core/notify";
import { formatDate, today } from "@/lib/dates";
import { registerRoutine } from "../scheduler";

/**
 * Rotinas diárias do módulo fiscal (idempotentes; uma execução por empresa/dia pelo scheduler):
 *  - fiscal.obligations: gera as obrigações da competência e avisa vencimentos/atrasos;
 *  - fiscal.certificate: alerta de vencimento do certificado A1 (≤30 dias ou vencido);
 *  - fiscal.accountingExport: envio mensal do pacote à contabilidade (quando agendado);
 *  - fiscal.stuck: documentos parados em processamento/fila há mais de 30 min recebem nova consulta/transmissão.
 */

registerRoutine("fiscal.obligations", async (store, companyId) => {
  const ctx = systemCtx(store, companyId);
  const { generateObligations, notifyDeadlines } = await import("../fiscal/obligations");
  const g = await generateObligations(ctx);
  const n = await notifyDeadlines(ctx);
  return { ...g, ...n };
});

registerRoutine("fiscal.certificate", async (store, companyId) => {
  const { certificateDaysLeft } = await import("../fiscal/config");
  const cfgs = await listAll(store, "fiscal_configs", { filters: [["eq", "companyId", companyId]] });
  let alerts = 0;
  for (const c of cfgs) {
    const days = certificateDaysLeft(c.certificate);
    if (days == null || days > 30) continue;
    const branch = c.branchId ? await store.get("branches", c.branchId) : null;
    alerts += await notify(store, {
      companyId,
      branchId: c.branchId ?? null,
      type: "deadline",
      priority: days < 0 ? "critical" : days <= 7 ? "high" : "normal",
      title: days < 0 ? `Certificado A1 VENCIDO${branch ? ` — ${branch.name}` : ""}` : `Certificado A1 vence em ${days} dia(s)${branch ? ` — ${branch.name}` : ""}`,
      body: `Validade: ${formatDate(c.certificate.validTo)}. Renove o certificado e atualize-o no provedor fiscal e em Fiscal → Configurações.`,
      link: "/fiscal/configuracoes?tab=certificado",
      originType: "fiscal_config",
      originId: c.id,
      occurrenceKey: `certificate:${c.id}:${c.certificate.validTo}:${days < 0 ? "expired" : days <= 7 ? "7" : "30"}`,
      audience: { action: "fiscal.configure" },
    }).catch(() => 0);
  }
  return { alerts };
});

registerRoutine("fiscal.accountingExport", async (store, companyId) => {
  const { runScheduledAccountingExport } = await import("../fiscal/export");
  return runScheduledAccountingExport(systemCtx(store, companyId), today());
});

registerRoutine("fiscal.stuck", async (store, companyId) => {
  const limit = new Date(Date.now() - 30 * 60000).toISOString();
  const docs = await listAll(store, "fiscal_documents", { filters: [["eq", "companyId", companyId], ["eq", "status", ["processing", "queued"]], ["lt", "updatedAt", limit]] }, 500);
  let n = 0;
  for (const d of docs) {
    if (d.status === "queued" && d.contingency) continue; // retido por contingência
    const type = d.status === "processing" ? "fiscal.query" : "fiscal.transmit";
    await enqueue(store, { type, payload: { documentId: d.id, branchId: d.branchId }, dedupeKey: `fiscal-stuck:${d.id}:${today()}`, companyId });
    n++;
  }
  return { requeued: n };
});
