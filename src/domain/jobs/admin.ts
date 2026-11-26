import { registerJob } from "@/lib/core/jobs";
import { runRestoreJob, runScheduledBackup } from "../backup";

/** Tarefas duráveis do módulo (admin). */

// cópia automática agendada pela rotina diária (cria, verifica em base de teste e aplica retenção)
registerJob("admin.backup.scheduled", (ctx, payload) => runScheduledBackup(ctx, payload));

// restauração registrada em restore_jobs executada fora da requisição (as telas hoje restauram na própria ação, em base
// de teste; o executor continua para tarefas já enfileiradas)
registerJob("admin.restore.run", (ctx, payload) => runRestoreJob(ctx, payload.restoreJobId));
