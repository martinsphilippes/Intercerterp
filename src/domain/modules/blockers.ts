import type { Filter, Store } from "@/lib/db/types";

/**
 * Pendências em andamento que o desligamento de um módulo precisa respeitar (política de desligamento no catálogo).
 * Cada verificação conta registros da PRÓPRIA empresa (filtro companyId explícito) — nunca toca outra empresa.
 */
export interface BlockerResult {
  key: string;
  label: string;
  count: number;
}

interface BlockerDef {
  label: string;
  collection: string;
  /** filtros fixos, ou calculados na hora (prazos relativos ao instante da verificação) */
  filters: Filter[] | (() => Filter[]);
}

/** Prazo do CDC (art. 26, II) para reclamar de vício aparente em bem durável: 90 dias da entrega. */
export const CDC_RETURN_DAYS = 90;

const IN = (field: string, values: string[]): Filter => ["eq", field, values];

export const BLOCKERS: Record<string, BlockerDef> = {
  "cash.open_sessions": { label: "Caixas abertos", collection: "cash_sessions", filters: [IN("status", ["open", "reopened"])] },
  "pdv.parked_carts": { label: "Atendimentos do PDV em aberto ou em espera (pré-venda)", collection: "carts", filters: [IN("status", ["open", "parked"])] },
  "pdv.pending_pix": { label: "Pix do PDV aguardando confirmação", collection: "payment_intents", filters: [IN("status", ["pending", "unknown"])] },
  "pdv.presale_reservations": { label: "Reservas de estoque de pré-vendas", collection: "stock_reservations", filters: [["eq", "originType", "cart"], ["eq", "status", "active"]] },
  // vendas ainda no prazo de reclamação do CDC: as trocas e devoluções seguem aceitas até a última sair do prazo
  // (desligamento gradual — correção 5 da homologação com o Interos)
  "sales.cdc_return_window": {
    label: `Vendas dos últimos ${CDC_RETURN_DAYS} dias (prazo do CDC para trocas e devoluções)`,
    collection: "sales",
    filters: () => [["eq", "status", "completed"], ["gte", "completedAt", new Date(Date.now() - CDC_RETURN_DAYS * 86400000).toISOString()]],
  },
  "sales_doc.open_orders": { label: "Pedidos de venda com reserva de estoque", collection: "stock_reservations", filters: [["eq", "originType", "sales_document"], ["eq", "status", "active"]] },
  "ecommerce.open_orders": { label: "Pedidos on-line em andamento (pagamento, nota, separação, expedição, retirada ou devolução)", collection: "online_orders", filters: [IN("status", ["pending_payment", "paid", "invoiced", "ready_for_pickup", "shipped", "return_requested"])] },
  "ecommerce.pending_payouts": { label: "Recebimentos do gateway a creditar/conciliar", collection: "gateway_transactions", filters: [IN("status", ["awaiting_credit", "credited", "partial", "divergent"])] },
  "stock.transfers_in_transit": { label: "Transferências separadas ou em trânsito", collection: "transfers", filters: [IN("status", ["separated", "shipping", "in_transit", "partial"])] },
  "stock.open_inventories": { label: "Inventários abertos ou em contagem", collection: "inventories", filters: [IN("status", ["open", "counting"])] },
  "stock.lot_controlled_products": { label: "Produtos com controle de lote ligado (saldo por lote)", collection: "products", filters: [["eq", "lotControl", true]] },
  "purchase.open_orders": { label: "Pedidos de compra aprovados, enviados ou parcialmente recebidos", collection: "purchase_orders", filters: [IN("status", ["approved", "sent", "partial"])] },
  "purchase.pending_approvals": { label: "Solicitações de compra em análise ou ajuste", collection: "purchase_requests", filters: [IN("status", ["in_review", "adjust"])] },
  "purchase.receipts_in_progress": { label: "Recebimentos em rascunho ou em conferência", collection: "receipts", filters: [IN("status", ["draft", "confirming"])] },
  "purchase.pending_invoices": { label: "Entradas aguardando a nota do fornecedor", collection: "receipts", filters: [["eq", "documentStatus", "pending_invoice"], ["ne", "status", "cancelled"]] },
  "finance.open_receivables": { label: "Títulos a receber em aberto", collection: "titles", filters: [["eq", "kind", "receivable"], IN("status", ["open", "partial"])] },
  "finance.open_payables": { label: "Títulos a pagar em aberto", collection: "titles", filters: [["eq", "kind", "payable"], IN("status", ["open", "partial"])] },
  "finance.open_card_receivables": { label: "Recebíveis de cartão a liquidar", collection: "titles", filters: [["eq", "originType", "sale_card"], IN("status", ["open", "partial"])] },
  "fiscal.processing_nfce": { label: "NFC-e em processamento, pendente ou com erro", collection: "fiscal_documents", filters: [["eq", "model", "nfce"], IN("status", ["queued", "processing", "pending", "error"])] },
  "fiscal.processing_nfe": { label: "NF-e em processamento, pendente ou com erro", collection: "fiscal_documents", filters: [["eq", "model", "nfe"], IN("status", ["queued", "processing", "pending", "error"])] },
  "fiscal.processing_nfse": { label: "NFS-e em processamento, pendente ou com erro", collection: "fiscal_documents", filters: [["eq", "model", "nfse"], IN("status", ["queued", "processing", "pending", "error"])] },
  "accounting.open_certificate_requests": { label: "Solicitações de certificado em andamento", collection: "certificate_requests", filters: [IN("status", ["open", "awaiting_payment", "validation", "ready_to_issue", "issuing", "awaiting_authorization", "ready_to_download"])] },
  "network.open_sales": { label: "Vendas de certificado da rede em andamento", collection: "certificate_requests", filters: [IN("status", ["awaiting_payment", "validation", "ready_to_issue", "issuing", "awaiting_authorization", "ready_to_download"])] },
  "network.open_closings": { label: "Recargas de carteira da rede pendentes", collection: "cert_wallet_recharges", filters: [["eq", "status", "pending"]] },
};

/** Conta as pendências de cada verificação para a empresa (limite de leitura: basta saber se há e quantas, até 1000). */
export async function evaluateBlockers(store: Store, companyId: string, keys: string[]): Promise<BlockerResult[]> {
  const out: BlockerResult[] = [];
  for (const key of keys) {
    const def = BLOCKERS[key];
    if (!def) continue;
    const filters = typeof def.filters === "function" ? def.filters() : def.filters;
    const res = await store.list(def.collection, { filters: [["eq", "companyId", companyId], ...filters], limit: 1000, total: true });
    if (res.total > 0) out.push({ key, label: def.label, count: res.total });
  }
  return out;
}
