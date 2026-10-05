import { registerJob } from "@/lib/core/jobs";
import { runRestoreJob, runScheduledBackup } from "../backup";

/** Tarefas duráveis do módulo (admin). */

// cópia automática agendada pela rotina diária (cria, verifica em base de teste e aplica retenção)
registerJob("admin.backup.scheduled", (ctx, payload) => runScheduledBackup(ctx, payload));

// restauração longa (nova base Appwrite) executada fora da requisição
registerJob("admin.restore.run", (ctx, payload) => runRestoreJob(ctx, payload.restoreJobId));
