import { registerRoutine } from "../scheduler";
import { runModulesMaintenance } from "../modules/operations";

/**
 * modules.maintenance (habilitação de módulos — docs/modulos): linha de base das empresas sem estado (modo legacy,
 * comportamento anterior), execução das alterações agendadas vencidas e conclusão dos desligamentos sem pendências.
 */
registerRoutine("modules.maintenance", (store, companyId) => runModulesMaintenance(store, companyId));
