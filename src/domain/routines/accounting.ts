import { registerRoutine } from "../scheduler";
import { notifyCertificateDeadlines } from "../accounting/certificates";

/**
 * Rotinas diárias do escritório contábil (empresas do tipo "accounting"; nas demais não fazem nada):
 *  - accounting.certificates: certificados da carteira vencidos ou a vencer em 30 dias e cobranças de certificado
 *    vencidas avisam o responsável pelo cliente (ou quem vê a carteira).
 */
registerRoutine("accounting.certificates", (store, companyId) => notifyCertificateDeadlines(store, companyId));
