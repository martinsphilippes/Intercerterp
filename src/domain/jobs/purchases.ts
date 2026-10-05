import { registerJob } from "@/lib/core/jobs";

/**
 * Tarefas duráveis do módulo de compras.
 * O envio do pedido por e-mail é síncrono (o usuário vê o resultado real do provedor e o pedido só fica
 * "enviado" se a mensagem for aceita); os efeitos do recebimento são idempotentes e executados na
 * confirmação (retentativa pela tela, estado "confirmando"). Nenhuma tarefa em segundo plano é necessária.
 */
void registerJob;
