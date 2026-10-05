"use server";

import { runAction, fstr, fopt, fbool, fint } from "@/lib/server/action";
import { saveParameters, saveBackupSchedule } from "./params";
import { PARAMS } from "./catalog";

export async function saveParametersAction(fd: FormData) {
  const scope = fstr(fd, "scope");
  const branchId = scope && scope !== "company" ? scope : null;
  return runAction({ module: "admin", op: "edit", revalidate: ["/administracao/parametros"] }, async (s) => {
    const values: Record<string, string> = {};
    for (const p of PARAMS) {
      if (!fd.has(`p.${p.key}`) && p.type !== "bool") continue;
      if (p.type === "bool") {
        if (fd.has(`present.${p.key}`)) values[p.key] = fbool(fd, `p.${p.key}`) ? "true" : "false";
      } else values[p.key] = fstr(fd, `p.${p.key}`);
    }
    const clear = fd.getAll("clear").map(String);
    const changed = await saveParameters(s.ctx, branchId, values, clear, fopt(fd, "reason"));
    return { ok: true as const, message: changed.length ? `${changed.length} parâmetro(s) atualizado(s) e registrado(s) no histórico.` : "Nenhuma alteração." };
  });
}

export async function saveBackupScheduleAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: ["/administracao/backups", "/administracao/parametros"] }, async (s) => {
    const changed = await saveBackupSchedule(s.ctx, {
      enabled: fbool(fd, "enabled"),
      frequency: fstr(fd, "frequency") || "daily",
      time: fstr(fd, "time") || "02:00",
      retentionDays: fint(fd, "retentionDays", 30),
      includeFiles: fbool(fd, "includeFiles"),
      weekday: fint(fd, "weekday", 0),
      verify: fbool(fd, "verify"),
    });
    return { ok: true as const, message: changed ? "Programação de backup salva." : "Nenhuma alteração." };
  });
}
