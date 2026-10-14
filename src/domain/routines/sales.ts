import { registerRoutine } from "../scheduler";
import { expireSalesDocuments } from "../sales-documents";

/**
 * Rotina diária dos documentos comerciais de venda (Fase 5):
 *  - orçamentos com validade vencida passam a "expirado";
 *  - pedidos com reserva de estoque vencida (`sales.orderReservationDays`) têm a reserva liberada.
 * Idempotente: documentos já expirados/liberados não são tocados de novo.
 */
registerRoutine("sales.documents_expire", (store, companyId) => expireSalesDocuments(store, companyId));
