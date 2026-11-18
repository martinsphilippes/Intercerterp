import { registerRoutine } from "../scheduler";
import { expirePendingOrders } from "../ecommerce/orders";

/**
 * Comércio digital (§49): pedidos com pagamento vencido (Pix/boleto) são cancelados e liberam a reserva. Também roda,
 * de forma oportunista, a cada checkout e na lista de pedidos — a rotina diária garante a limpeza sem acesso à loja.
 */
registerRoutine("ecommerce.expire", (store, companyId) => expirePendingOrders(store, companyId));
