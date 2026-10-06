import { registerRoutine } from "../scheduler";
import { scheduleDailyBackup } from "../backup";
import { syncSystemRoles } from "@/lib/auth/role-sync";

/**
 * Rotinas diárias do módulo (admin).
 *  - admin.backup: aplica a retenção (remove artefatos vencidos), marca execuções abandonadas como falha
 *    e agenda a cópia automática do dia no horário configurado (parâmetro backup.schedule).
 */
registerRoutine("admin.backup", (store, companyId) => scheduleDailyBackup(store, companyId));

/** admin.roles: perfis de sistema recebem as operações novas dos modelos padrão (idempotente, auditado). */
registerRoutine("admin.roles", (store, companyId) => syncSystemRoles(store, companyId));
