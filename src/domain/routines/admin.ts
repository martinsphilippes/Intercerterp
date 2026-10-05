import { registerRoutine } from "../scheduler";
import { scheduleDailyBackup } from "../backup";

/**
 * Rotinas diárias do módulo (admin).
 *  - admin.backup: aplica a retenção (remove artefatos vencidos), marca execuções abandonadas como falha
 *    e agenda a cópia automática do dia no horário configurado (parâmetro backup.schedule).
 */
registerRoutine("admin.backup", (store, companyId) => scheduleDailyBackup(store, companyId));
