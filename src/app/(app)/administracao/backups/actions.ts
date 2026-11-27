"use server";

import { runAction, fstr, fbool } from "@/lib/server/action";
import { requireAction } from "@/lib/core/ctx";
import { createBackup, verifyBackup, createRestoreJob, runRestoreJob, applyRetention } from "@/domain/backup";

export async function createBackupAction(fd: FormData) {
  return runAction({ entitlement: "plataforma.backup", action: "createBackupAction", module: "admin", revalidate: ["/administracao/backups"] }, async (s) => {
    const b = await createBackup(s.ctx, { kind: "manual", includeFiles: fbool(fd, "includeFiles"), includeGlobal: true, verify: fbool(fd, "verify"), idemKey: `manual:${fstr(fd, "_idem") || Date.now()}` });
    if (b.status === "failed") return { ok: false as const, error: `A cópia falhou: ${b.error ?? "erro desconhecido"}` };
    return {
      ok: true as const,
      message: b.status === "verified" ? "Cópia criada e comprovada restaurável em base de teste." : b.verifyResult?.ok === false ? "Cópia criada, mas a verificação encontrou divergências — veja o detalhe." : "Cópia criada. Integridade pendente: execute a verificação.",
      redirect: `/administracao/backups/${b.id}`,
    };
  });
}

export async function verifyBackupAction(id: string, fd: FormData) {
  return runAction({ entitlement: "plataforma.backup", action: "verifyBackupAction", module: "admin", revalidate: [`/administracao/backups/${id}`, "/administracao/backups"] }, async (s) => {
    const r = await verifyBackup(s.ctx, id, { idemKey: fstr(fd, "_idem") || undefined });
    return r.backup.status === "verified"
      ? { ok: true as const, message: "Verificada: restauração em base de teste com contagens e checksums iguais.", redirect: `/administracao/backups/${id}?tab=verificacao` }
      : { ok: false as const, error: `Verificação não passou: ${r.job.error ?? "divergências encontradas"}` };
  });
}

export async function restoreAction(id: string, fd: FormData) {
  return runAction({ entitlement: "plataforma.backup", action: "restoreAction", module: "admin", revalidate: [`/administracao/backups/${id}`] }, async (s) => {
    requireAction(s.ctx, "admin.backup");
    if (!fbool(fd, "confirm")) return { ok: false as const, error: "Confirme que revisou o escopo e o destino da restauração." };
    const b = await s.ctx.store.get("backups", id);
    // a cópia precisa ser da empresa em uso (nunca restaurar/verificar cópia de outra empresa)
    if (!b || b.companyId !== s.ctx.companyId) return { ok: false as const, error: "Registro não encontrado.", code: "not_found" };
    // destino único: base de teste isolada
    const job = await createRestoreJob(s.ctx, b, "test", fstr(fd, "_idem") || undefined);
    const done = await runRestoreJob(s.ctx, job.id);
    return done.status === "completed"
      ? { ok: true as const, message: "Restauração em base de teste concluída: contagens e checksums iguais.", redirect: `/administracao/backups/${id}?tab=restauracao` }
      : { ok: false as const, error: `Restauração em base de teste com falha: ${done.error ?? "divergência"}` };
  });
}

export async function applyRetentionAction() {
  return runAction({ entitlement: "plataforma.backup", action: "applyRetentionAction", module: "admin", revalidate: ["/administracao/backups"] }, async (s) => {
    requireAction(s.ctx, "admin.backup");
    const r = await applyRetention(s.ctx);
    return { ok: true as const, message: r.removed ? `${r.removed} artefato(s) vencido(s) removido(s).` : "Nenhuma cópia vencida para remover." };
  });
}
