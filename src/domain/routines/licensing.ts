import { registerRoutine } from "../scheduler";
import { maintainLicense } from "../licensing/license";
import { reconcileLicense } from "../licensing/sync";

/**
 * Licenciamento (contrato Interos v2), sempre ativo:
 *  - licenses.maintenance: transições locais do retrato vigente (teste vencido e carência, agendamentos, vigência);
 *  - interos.reconcile: consulta o Interos (pull) e avisa retrato envelhecido (sync.stale).
 */
registerRoutine("licenses.maintenance", (store, companyId) => maintainLicense(store, companyId));
registerRoutine("interos.reconcile", (store, companyId) => reconcileLicense(store, companyId));
