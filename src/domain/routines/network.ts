import { registerRoutine } from "../scheduler";
import { notifyRenewalAlerts } from "../network/renewals";

/**
 * Rotina diária da rede de certificação (§45), por empresa que é nó da rede (nas demais não faz nada):
 *  - network.renewals: avisos de renovação a 90/60/30 dias ao vendedor (ou ao responsável do cliente no contador) e o
 *    alerta "ninguém agiu" (≤ N dias do vencimento, sem contato nem renovação aberta) ao responsável do nó e ao nível
 *    imediatamente acima. Idempotente por certificado + vencimento + marco.
 */
registerRoutine("network.renewals", (store, companyId) => notifyRenewalAlerts(store, companyId));
