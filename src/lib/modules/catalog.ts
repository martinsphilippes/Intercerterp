import type { DeactivationPolicy, ModuleDef } from "./types";

/**
 * Catálogo de módulos do ERP — versão 1 (catalogo-modulos-erp-v1).
 *
 * Fonte única: o JSON entregue ao Interos (docs/modulos/catalogo-modulos-erp-v1.json) é gerado daqui
 * (`node --import tsx scripts/modules/build-catalog.ts`) e um teste confere que está em dia.
 *
 * CHAVES SÃO ESTÁVEIS: nunca renomeie nem reaproveite uma chave publicada. Para mudar o recorte, crie a chave nova,
 * marque a antiga como substituída nas notas e migre as empresas por operação do Interos.
 */
export const CATALOG_VERSION = "1.0.0";

const V = "1.0.0";
const ALL = ["retail", "accounting", "certification"] as const;
const RETAIL = ["retail"] as const;

const immediate = (extra: Partial<DeactivationPolicy> = {}): DeactivationPolicy => ({ mode: "immediate", afterOff: "read_history", ...extra });
const never: DeactivationPolicy = { mode: "immediate", afterOff: "read_history", obligations: ["Recurso da plataforma: não pode ser desligado."] };

export const MODULES_CATALOG: ModuleDef[] = [
  // ═══════════════════════════════ PLATAFORMA (obrigatórios) ═══════════════════════════════
  {
    key: "plataforma.acesso", name: "Autenticação e sessão", family: "plataforma", version: V, classification: "platform", availability: "available", kinds: [...ALL],
    description: "Login próprio, autenticação em duas etapas, convite, recuperação de senha, seleção de empresa/filial e segurança da conta.",
    surfaces: { routes: ["/conta", "/sem-permissao", "/modulo-indisponivel"], publicRoutes: ["/login", "/convite", "/recuperar-senha", "/redefinir-senha", "/selecionar-unidade", "/primeiro-acesso", "/suporte"], apis: ["/api/unit", "/api/setup/run", "/api/keepalive"] },
    deactivation: never, existing: "exists",
  },
  {
    key: "plataforma.administracao", name: "Administração essencial", family: "plataforma", version: V, classification: "platform", availability: "available", kinds: [...ALL],
    description: "Usuários e perfis, empresas e filiais, parâmetros, central de integrações (moldura), histórico e auditoria.",
    surfaces: {
      routes: ["/administracao/usuarios", "/administracao/empresas", "/administracao/parametros", "/administracao/historico", "/administracao/integracoes", "/administracao/integracoes/email", "/administracao/modulos"],
      // /api/export: cada exportação é conferida pelo módulo da sua chave; /api/interos: integração de gestão (escopos próprios)
      apis: ["/api/export", "/api/interos"],
      exports: ["admin.users", "admin.roles", "admin.audit", "admin.companies", "admin.branches", "integration-logs"],
      jobs: ["interos.event"],
      routines: ["admin.roles", "modules.maintenance", "licenses.maintenance", "interos.reconcile"], permissions: ["admin.users", "admin.integrations", "data.export"],
    },
    deactivation: never, existing: "exists",
  },
  {
    key: "plataforma.backup", name: "Backup e restauração", family: "plataforma", version: V, classification: "platform", availability: "available", kinds: [...ALL],
    description: "Cópias agendadas, restauração e retenção. Obrigatório: proteção dos dados da empresa.",
    surfaces: { routes: ["/administracao/backups"], exports: ["admin.backups"], jobs: ["admin.backup.scheduled", "admin.restore.run"], routines: ["admin.backup"], permissions: ["admin.backup"] },
    deactivation: never, existing: "exists",
  },
  {
    key: "plataforma.painel", name: "Painel, notificações e suporte", family: "plataforma", version: V, classification: "platform", availability: "available", kinds: [...ALL],
    description: "Painel do gestor (cartões condicionados aos módulos habilitados), central de notificações, ajuda e chamados.",
    surfaces: { routes: ["/dashboard", "/notificacoes", "/ajuda"], apis: ["/api/search", "/api/jobs"], exports: ["notifications", "support.tickets"], permissions: ["support.manage"] },
    deactivation: never, existing: "exists",
  },
  {
    key: "plataforma.arquivos", name: "Arquivos e documentos", family: "plataforma", version: V, classification: "platform", availability: "available", kinds: [...ALL],
    description: "Download de XML, anexos e cópias com conferência de empresa e permissão. Continua disponível para documentos históricos de módulos desligados.",
    surfaces: { apis: ["/api/files"] }, deactivation: never, existing: "exists",
  },

  // ═══════════════════════════════ COMPONENTES TÉCNICOS COMPARTILHADOS ═══════════════════════════════
  {
    key: "tec.estoque", name: "Motor de estoque", family: "tecnico", version: V, classification: "technical", availability: "available", kinds: [...RETAIL],
    description: "Saldos, movimentos, reservas, custo médio e depósitos (src/domain/stock.ts, warehouses.ts). Usado por PDV, loja, compras e estoque.",
    surfaces: { jobs: ["sale.effects", "sale.cancel.effects", "return.effects"] }, deactivation: never, existing: "exists",
  },
  {
    key: "tec.financeiro", name: "Motor financeiro", family: "tecnico", version: V, classification: "technical", availability: "available", kinds: [...ALL],
    description: "Contas (caixa/banco), lançamentos, títulos e baixas, meios e condições de pagamento (src/domain/finance.ts). Recebe as vendas, compras e repasses mesmo sem as telas financeiras contratadas.",
    surfaces: { routes: ["/financeiro", "/financeiro/cadastros", "/financeiro/contas"], jobs: ["finance.account.rebuild"], exports: ["fin-account-entries"] },
    deactivation: never, existing: "exists",
  },
  {
    key: "tec.fiscal", name: "Motor fiscal", family: "tecnico", version: V, classification: "technical", availability: "available", kinds: [...ALL],
    description: "Configuração fiscal, emitente, certificado, numeração, grupos tributários, provedor (Focus NFe/simulação), transmissão, consulta, cancelamento, obrigações e relatórios fiscais.",
    surfaces: {
      routes: ["/fiscal", "/fiscal/configuracoes", "/fiscal/relatorios", "/administracao/integracoes/fiscal_nfe"],
      exports: ["fiscal-documentos", "fiscal-livro-saidas", "fiscal-ncm", "fiscal-cfop", "fiscal-servicos", "fiscal-cancelamentos", "fiscal-rejeicoes", "fiscal-obrigacoes"],
      jobs: ["fiscal.transmit", "fiscal.query", "fiscal.cancel", "fiscal.email"],
      routines: ["fiscal.obligations", "fiscal.certificate", "fiscal.stuck"],
      permissions: ["fiscal.configure", "fiscal.cancel"],
    },
    deactivation: {
      ...never,
      // documentos já criados: transmitir, consultar, cancelar no prazo legal, CC-e e reenvio continuam mesmo sem módulo fiscal ativo
      historyActions: ["transmitAction", "retransmitAction", "queryAction", "refreshAction", "cancelAction", "cceAction", "emailAction", "batchRetransmitAction", "toggleContingencyAction", "refreshFiscalAction", "completeObligationAction", "obligationStatusAction"],
      obligations: ["Documentos em processamento continuam sendo transmitidos/consultados até a resposta da SEFAZ.", "Cancelamento e CC-e de documentos autorizados continuam dentro do prazo legal.", "Prazos de obrigações e validade do certificado continuam avisados."],
    },
    existing: "exists",
  },
  {
    key: "tec.precos", name: "Motor de preços", family: "tecnico", version: V, classification: "technical", availability: "available", kinds: [...RETAIL],
    description: "Tabelas de preço por filial e vigência, atacado e cálculo de totais e rateio (pricing.ts, pricing-calc.ts).",
    surfaces: {}, deactivation: never, existing: "exists",
  },
  {
    key: "tec.pagamentos", name: "Intenções de pagamento (Pix)", family: "tecnico", version: V, classification: "technical", availability: "available", kinds: [...RETAIL],
    description: "Contrato de Pix (Mercado Pago e simulação) e intenções de pagamento usadas pelo PDV (src/domain/payments).",
    surfaces: { routes: ["/administracao/integracoes/pix"], apis: ["/api/pdv/intents"] }, deactivation: never, existing: "exists",
  },

  // ═══════════════════════════════ CADASTROS ═══════════════════════════════
  {
    key: "cadastros.produtos", name: "Produtos e serviços", family: "cadastros", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Cadastro de produtos, variações, preços, custos, parâmetros de estoque, conversões, cadastros auxiliares e importação de produtos por planilha.",
    components: ["tec.precos", "tec.estoque"],
    surfaces: { routes: ["/produtos", "/produtos/cadastros", "/produtos/importar", "/produtos/novo"], exports: ["products"] },
    deactivation: immediate({ obligations: ["Produtos continuam sendo lidos por PDV, loja, compras e notas já emitidas."] }), existing: "exists",
  },
  {
    key: "produtos.alteracao_massa", name: "Alteração de produtos em massa", family: "cadastros", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "cadastros.produtos",
    description: "Reajuste de preços e alteração de categoria, marca, NCM, grupo tributário e situação de vários produtos com prévia.",
    surfaces: { routes: ["/produtos/alteracao-em-massa"], features: ["alteracaoMassa"], permissions: ["products.bulk_edit"] },
    deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
    notes: "Isolado: só a tela /produtos/alteracao-em-massa e product-bulk.ts; a precificação após a entrada usa price-adjust.ts/receipt-pricing.ts, não a alteração em massa.",
  },
  {
    key: "produtos.etiquetas", name: "Etiquetas de produtos", family: "cadastros", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "cadastros.produtos",
    description: "Etiquetas de gôndola e adesivas com preço e código de barras, inclusive a partir de um recebimento.",
    optionalIntegrations: [{ module: "compras.recebimento", effect: "Atalho de etiquetas a partir do recebimento concluído" }],
    surfaces: { routes: ["/produtos/etiquetas"], features: ["etiquetas"] }, deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },
  {
    key: "produtos.balanca", name: "Balança etiquetadora", family: "cadastros", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "cadastros.produtos",
    description: "Código de peso/valor no PDV, aba Balança no produto e carga de PLU.",
    optionalIntegrations: [{ module: "vendas.pdv", effect: "Leitura da etiqueta de balança no PDV" }],
    surfaces: { routes: ["/produtos/balanca"], features: ["balanca"], embedded: ["Produto › aba Balança", "PDV › leitura EAN-13 iniciado por 2"] },
    deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },
  {
    key: "produtos.promocoes", name: "Promoções", family: "cadastros", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "cadastros.produtos",
    description: "Promoções por período, leve-pague e preço promocional aplicadas no PDV.",
    surfaces: { routes: ["/produtos/promocoes"], features: ["promocoes"] },
    deactivation: immediate({ obligations: ["Vendas já concluídas mantêm o desconto registrado."] }), existing: "exists",
  },
  {
    key: "produtos.kits", name: "Kits e composição", family: "cadastros", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "cadastros.produtos",
    description: "Componentes do produto, venda de kit com baixa dos componentes e montagem/desmembramento.",
    surfaces: { routes: ["/estoque/montagem"], features: ["kits"], embedded: ["Produto › aba Componentes"] },
    deactivation: immediate({ obligations: ["Cancelamento e devolução de vendas de kit anteriores continuam estornando os componentes."] }), existing: "exists",
  },
  {
    key: "cadastros.clientes", name: "Gestão de clientes", family: "cadastros", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Cadastro de clientes (identidade única por CPF/CNPJ), ficha, limite de crédito e histórico.",
    surfaces: { routes: ["/clientes"], exports: ["customers"], permissions: ["customer.credit_limit"] },
    deactivation: immediate({ obligations: ["Clientes continuam identificáveis no PDV, na loja e nas notas (identidade compartilhada)."] }), existing: "exists",
  },
  {
    key: "clientes.fidelidade", name: "Programa de fidelidade", family: "cadastros", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "cadastros.clientes",
    description: "Pontos por compra e resgate no PDV.",
    requires: ["vendas.pdv"],
    surfaces: { routes: ["/clientes/fidelidade"], features: ["fidelidade"] },
    deactivation: immediate({ obligations: ["Saldo de pontos preservado; resgate bloqueado enquanto desligado."] }), existing: "exists",
  },
  {
    key: "cadastros.fornecedores", name: "Fornecedores", family: "cadastros", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Cadastro de fornecedores, contatos e condições.",
    surfaces: { routes: ["/fornecedores"], exports: ["suppliers"] }, deactivation: immediate(), existing: "exists",
  },

  // ═══════════════════════════════ VENDAS E CAIXA ═══════════════════════════════
  {
    key: "caixa.operacao", name: "Caixa", family: "vendas", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Abertura, suprimento, sangria, fechamento (cego ou não), reabertura e relatório do caixa.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/caixa"], exports: ["cash_sessions", "cash_movements"], permissions: ["cash.reopen", "cash.withdrawal"] },
    deactivation: {
      mode: "drain", afterOff: "read_history", drainDays: 3, blockers: ["cash.open_sessions"],
      drainActions: ["closeSessionAction", "addMovementAction", "previewCloseAction", "retryCloseTransferAction"],
      obligations: ["Caixas abertos podem ser fechados (com sangria/suprimento) até a conclusão; nenhum caixa novo abre."],
    },
    existing: "exists",
  },
  {
    key: "vendas.pdv", name: "Frente de caixa (PDV)", family: "vendas", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Atendimento no PDV, pré-venda, troca, pagamento (dinheiro, cartão, Pix, vale), terminais e histórico de vendas.",
    requires: ["caixa.operacao", "cadastros.produtos"],
    components: ["tec.estoque", "tec.precos", "tec.financeiro", "tec.pagamentos"],
    optionalIntegrations: [
      { module: "fiscal.nfce", effect: "Emissão da NFC-e na conclusão da venda; sem ele a venda sai com recibo não fiscal" },
      { module: "cadastros.clientes", effect: "Identificação e cadastro rápido do cliente no PDV" },
      { module: "financeiro.contas_receber", effect: "Venda a prazo (crediário) gera títulos a receber" },
      { module: "vendas.documentos", effect: "Importar orçamento/pedido no PDV" },
    ],
    configPrereqs: [{ key: "terminal", description: "Ao menos um terminal ativo na filial (Administração › Terminais)" }],
    surfaces: {
      routes: ["/pdv", "/vendas", "/administracao/terminais", "/administracao/integracoes/card_tef"],
      apis: ["/api/pdv/products", "/api/pdv/customers", "/api/pdv/vouchers"],
      exports: ["sales", "admin.terminals"],
      permissions: ["sale.cancel", "sale.discount_over_limit", "sale.overdue_override", "pdv.remove_item", "pdv.cancel_cart"],
    },
    deactivation: {
      mode: "drain", afterOff: "read_history", drainDays: 1, blockers: ["pdv.parked_carts", "pdv.pending_pix"],
      drainActions: ["cancelCartAction", "cancelPixAction", "simulatePixAction", "cancelSaleAction"],
      historyActions: ["sendReceiptAction"],
      obligations: ["Histórico de vendas, recibos e segunda via continuam em consulta.", "Pix pendentes podem ser confirmados ou cancelados."],
    },
    existing: "exists",
  },
  {
    key: "vendas.devolucoes", name: "Trocas e devoluções", family: "vendas", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "vendas.pdv",
    description: "Devolução/troca de vendas com vale-crédito ou estorno, limite de valor e autorização.",
    surfaces: { routes: ["/vendas/devolucoes", "/vendas/[id]/devolucoes"], exports: ["returns"], permissions: ["sale.return", "sale.return_over_limit"], embedded: ["Venda › Devoluções"] },
    deactivation: {
      mode: "drain", afterOff: "read_history", drainDays: 90,
      drainActions: ["processReturnAction", "confirmCardReversalAction"],
      obligations: ["Devoluções de vendas feitas ANTES do desligamento continuam aceitas por 90 dias (CDC: prazo de reclamação de vício em bens duráveis)."],
    },
    existing: "exists",
  },
  {
    key: "pdv.recebimento_crediario", name: "Recebimento de parcelas no PDV", family: "vendas", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "vendas.pdv",
    description: "Receber parcelas do crediário no caixa aberto (F9), com estorno.",
    requires: ["financeiro.contas_receber"],
    surfaces: { routes: ["/caixa/recebimentos"], features: ["recebimentoPdv"], permissions: ["pdv.receive_installments", "pdv.reverse_receipt"], embedded: ["PDV › Receber parcelas (F9)"] },
    deactivation: immediate({ obligations: ["Recebimentos já registrados continuam no caixa e no fechamento."] }), existing: "exists",
  },
  {
    key: "pdv.reserva_prevenda", name: "Reserva de estoque na pré-venda", family: "vendas", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "vendas.pdv",
    description: "Reserva os itens físicos ao salvar a pré-venda (F6); consumida na conclusão e liberada no cancelamento ou expiração.",
    surfaces: { features: ["reservaPreVenda"], routines: ["sales.presale_reservations"] },
    deactivation: { mode: "drain", afterOff: "hidden", drainDays: 3, blockers: ["pdv.presale_reservations"], obligations: ["Reservas existentes são consumidas ou liberadas pela rotina de expiração."] },
    existing: "exists",
  },
  {
    key: "vendas.documentos", name: "Orçamentos e pedidos de venda", family: "vendas", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Orçamento com validade e envio, pedido com reserva de estoque, faturamento parcial no PDV ou em NF-e e link público do documento.",
    requires: ["cadastros.produtos"],
    components: ["tec.estoque", "tec.precos"],
    optionalIntegrations: [{ module: "vendas.pdv", effect: "Faturar no PDV (importar documento)" }, { module: "fiscal.nfe", effect: "Faturar pedido em NF-e" }],
    surfaces: { routes: ["/vendas/orcamentos", "/vendas/pedidos"], publicRoutes: ["/documento"], features: ["documentoComercial"], routines: ["sales.documents_expire"], permissions: ["sales_doc.quote", "sales_doc.order", "sales_doc.cancel"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 30, blockers: ["sales_doc.open_orders"], drainActions: ["cancelOrderAction", "renewReservationAction"], obligations: ["Pedidos com reserva podem ser faturados ou cancelados; a rotina de expiração libera as reservas."] },
    existing: "exists",
  },
  {
    key: "vendas.comissoes", name: "Vendedores e comissões", family: "vendas", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Cadastro de vendedores, percentuais, apuração, fechamento e reabertura de comissões.",
    requiresAny: [["vendas.pdv", "vendas.documentos", "ecommerce.loja"]],
    surfaces: { routes: ["/vendas/vendedores", "/vendas/comissoes"], features: ["comissoes"], exports: ["sales-commissions"], permissions: ["sales.commissions"] },
    deactivation: immediate({ obligations: ["Fechamentos de comissão já feitos ficam em consulta."] }), existing: "exists",
  },

  // ═══════════════════════════════ COMÉRCIO DIGITAL ═══════════════════════════════
  {
    key: "ecommerce.loja", name: "Loja virtual", family: "comercio_digital", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Loja própria: modelos, identidade, domínio, catálogo digital, vitrine pública, carrinho, checkout com gateway, pedidos on-line, frete, expedição, retirada e monitor de integrações.",
    requires: ["cadastros.produtos", "fiscal.nfe"],
    components: ["tec.estoque", "tec.precos", "tec.fiscal", "tec.financeiro"],
    configPrereqs: [{ key: "store.published", description: "Loja criada, com dados legais, pagamentos e frete configurados e publicada" }],
    surfaces: {
      routes: ["/comercio-digital", "/comercio-digital/modelos", "/comercio-digital/editor", "/comercio-digital/catalogo", "/comercio-digital/pedidos", "/comercio-digital/pagamentos", "/comercio-digital/frete", "/comercio-digital/expedicao", "/comercio-digital/monitor", "/comercio-digital/ver-loja", "/administracao/integracoes/store_gateway", "/administracao/integracoes/store_logistics", "/administracao/integracoes/store_domains"],
      publicRoutes: ["/loja"], webhooks: ["/api/loja/gateway"], features: ["comercioDigital"], routines: ["ecommerce.expire"],
      permissions: ["ecommerce.manage", "ecommerce.catalog", "ecommerce.orders", "ecommerce.cancel"],
    },
    deactivation: {
      mode: "drain", afterOff: "read_history", drainDays: 30, blockers: ["ecommerce.open_orders"],
      drainActions: ["invoiceOrderAction", "cancelOrderAction", "confirmPickingAction", "generateLabelAction", "dispatchOrderAction", "confirmPickupAction", "confirmDeliveryAction", "completeReturnAction", "retryChargeAction", "reprocessEventAction", "dismissEventAction", "pauseStoreAction"],
      obligations: [
        "A vitrine deixa de aceitar pedidos novos na hora (página de loja indisponível); o acompanhamento do pedido pelo cliente continua.",
        "Pedidos pagos seguem para nota, separação, expedição e entrega; avisos do gateway continuam processados.",
        "Arrependimento (7 dias, CDC art. 49) e devoluções de pedidos anteriores continuam aceitos durante a conclusão.",
        "Pedidos pendentes expiram pela rotina e liberam as reservas.",
      ],
    },
    existing: "exists",
  },
  {
    key: "ecommerce.promocoes", name: "Cupons e recuperação de carrinhos", family: "comercio_digital", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "ecommerce.loja",
    description: "Cupons da loja e rascunhos de recuperação de carrinho abandonado.",
    surfaces: { routes: ["/comercio-digital/promocoes"], permissions: ["ecommerce.marketing"] },
    deactivation: immediate({ obligations: ["Cupons já aplicados em pedidos são preservados."] }), existing: "exists",
  },
  {
    key: "ecommerce.banco", name: "Banco Intercert e repasses", family: "comercio_digital", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "ecommerce.loja",
    description: "Conciliação dos recebimentos do gateway (bruto, taxa, líquido), conta de liquidação e repasses.",
    surfaces: { routes: ["/comercio-digital/banco", "/administracao/integracoes/store_bank"], permissions: ["ecommerce.finance"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 60, blockers: ["ecommerce.pending_payouts"], drainActions: ["reconcileAction", "preparePayoutAction"], obligations: ["Repasses solicitados e créditos a conciliar continuam até a liquidação."] },
    existing: "exists",
  },
  {
    key: "ecommerce.canais", name: "Canais de venda (marketplaces e redes)", family: "comercio_digital", version: V, classification: "optional_function", availability: "needs_confirmation", kinds: [...RETAIL], parent: "ecommerce.loja",
    description: "Contas preparadas em marketplaces, redes sociais e descoberta. Hoje só PREPARA a conta (sem integração ativa de pedidos).",
    surfaces: { routes: ["/comercio-digital/canais"] },
    deactivation: immediate(), existing: "needs_confirmation",
    notes: "src/domain/ecommerce/channels.ts registra contas 'preparadas'; não há sincronização de pedidos com marketplace — contratar como módulo só depois da integração real (lacuna).",
  },

  // ═══════════════════════════════ ESTOQUE ═══════════════════════════════
  {
    key: "estoque.gestao", name: "Saldos e movimentação de estoque", family: "estoque", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Consulta de saldos por depósito, movimentos, ajustes e cadastro de depósitos.",
    requires: ["cadastros.produtos"], components: ["tec.estoque"],
    surfaces: { routes: ["/estoque", "/estoque/movimentos", "/estoque/transferencias/depositos"], exports: ["stock-balances", "stock-movements"], permissions: ["stock.adjust", "stock.warehouses"] },
    deactivation: immediate({ obligations: ["O motor de estoque continua baixando vendas e recebimentos (saldos preservados)."] }), existing: "exists",
  },
  {
    key: "estoque.transferencias", name: "Transferências entre depósitos e filiais", family: "estoque", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "estoque.gestao",
    description: "Transferência com separação, expedição, recebimento, divergência e documento fiscal.",
    surfaces: { routes: ["/estoque/transferencias"], exports: ["transfers"], routines: ["stock.transfers_overdue"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 30, blockers: ["stock.transfers_in_transit"], drainActions: ["receiveTransferAction", "resolveTransferAction", "cancelTransferAction", "setTransferDocumentAction"], obligations: ["Mercadoria em trânsito precisa ser recebida ou cancelada (saldo em trânsito)."] },
    existing: "exists",
  },
  {
    key: "estoque.inventario", name: "Inventário e contagem", family: "estoque", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "estoque.gestao",
    description: "Inventário com folha de contagem (inclusive bipagem), conclusão com ajuste e retomada.",
    surfaces: { routes: ["/estoque/inventarios"], exports: ["inventories", "inventory-items"], routines: ["stock.inventories_stale"], features: ["bipagemContagem"], permissions: ["stock.inventory_close"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 15, blockers: ["stock.open_inventories"], drainActions: ["saveCountsAction", "addInventoryItemAction", "concludeInventoryAction", "cancelInventoryAction", "resumeInventoryAction"], obligations: ["Inventários abertos congelam o saldo contado: precisam ser concluídos ou cancelados."] },
    existing: "exists",
  },
  {
    key: "estoque.lotes", name: "Lotes e validades", family: "estoque", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "estoque.gestao",
    description: "Saldo por lote, FEFO na venda, lote no recebimento, relatório de validades e alerta diário.",
    surfaces: { routes: ["/estoque/validades"], apis: ["/api/pdv/lots"], features: ["lotes"], routines: ["stock.lot_expiry"], embedded: ["Produto › Controla lote e validade", "Recebimento › lote na conferência", "PDV › escolha do lote"] },
    deactivation: {
      mode: "scheduled", afterOff: "read_history", blockers: ["stock.lot_controlled_products"],
      obligations: ["Enquanto houver produto com controle de lote ligado, o desligamento fica agendado: o saldo por lote é integridade do estoque (PDV, recebimento e transferência dependem dele). Desligue o controle nos produtos (ou o recurso em Parâmetros) e o módulo desliga sozinho."],
    },
    existing: "exists",
  },
  {
    key: "estoque.inventario_fiscal", name: "Inventário em data-base", family: "estoque", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "estoque.gestao",
    description: "Saldo de cada produto por depósito numa data passada, valorizado pelo custo médio, com totais por NCM.",
    surfaces: { routes: ["/estoque/inventario-fiscal"], features: ["inventarioFiscal"], exports: ["stock-fiscal-inventory"] },
    deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },

  // ═══════════════════════════════ COMPRAS ═══════════════════════════════
  {
    key: "compras.reposicao", name: "Planejamento de reposição", family: "compras", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Sugestão de compra pela cobertura em dias e histórico de vendas.",
    requires: ["cadastros.produtos"], components: ["tec.estoque"],
    optionalIntegrations: [{ module: "compras.pedidos", effect: "Gerar pedido de compra a partir da sugestão" }, { module: "compras.cotacoes", effect: "Gerar cotação a partir da sugestão" }],
    surfaces: { routes: ["/compras/reposicao"], exports: ["replenishment"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "compras.pedidos", name: "Pedidos de compra", family: "compras", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Pedido de compra com revisão, envio ao fornecedor e acompanhamento de entrega.",
    requires: ["cadastros.fornecedores", "cadastros.produtos"],
    optionalIntegrations: [{ module: "compras.aprovacoes", effect: "Pedido passa pela política de aprovação" }, { module: "compras.recebimento", effect: "Receber mercadorias contra o pedido" }],
    surfaces: { routes: ["/compras/pedidos"], exports: ["purchase_orders"], routines: ["purchases.followup"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 60, blockers: ["purchase.open_orders"], obligations: ["Pedidos já enviados ao fornecedor podem ser recebidos ou cancelados."], drainActions: ["cancelOrderAction", "closeBalanceAction", "registerTransitAction", "registerSentAction"] },
    existing: "exists",
  },
  {
    key: "compras.cotacoes", name: "Cotações de compra", family: "compras", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Cotação com vários fornecedores, mapa comparativo, seleção por item e geração do pedido.",
    requires: ["compras.pedidos"],
    surfaces: { routes: ["/compras/cotacoes"], exports: ["quotations"] },
    deactivation: immediate({ obligations: ["Cotações concluídas e pedidos gerados ficam em consulta."] }), existing: "exists",
    notes: "A cotação termina gerando pedido(s) de compra: dependência real de compras.pedidos. Compras sem cotação é suportado (pedido direto).",
  },
  {
    key: "compras.aprovacoes", name: "Aprovação de compras", family: "compras", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Política de alçadas, solicitação de compra com etapas, aprovação, reprovação e orçamento mensal.",
    requires: ["compras.pedidos"],
    surfaces: { routes: ["/compras/aprovacoes"], exports: ["purchase_requests"], permissions: ["purchase.approve"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 15, blockers: ["purchase.pending_approvals"], drainActions: ["decideAction"], obligations: ["Solicitações em análise precisam ser decididas.", "Sem o módulo (desligado ou em desligamento), o envio do pedido é aprovado automaticamente e registrado na solicitação ('Sem etapa de aprovação') — sem isso o pedido ficaria parado sem tela para aprovar."] },
    existing: "exists",
  },
  {
    key: "compras.recebimento", name: "Recebimento de mercadorias", family: "compras", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Entrada por XML/chave ou manual, conferência, entrada no estoque, contas a pagar, conversão de CFOP e devolução a fornecedor.",
    requires: ["cadastros.produtos", "cadastros.fornecedores"],
    components: ["tec.estoque", "tec.financeiro", "tec.fiscal"],
    optionalIntegrations: [{ module: "compras.pedidos", effect: "Conferência contra o pedido; sem ele a entrada é sem pedido" }],
    surfaces: { routes: ["/compras/recebimentos"], exports: ["receipts"], features: ["entradaSemPedido", "conversorCfop", "devolucaoFornecedor"], permissions: ["purchase.receive"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 15, blockers: ["purchase.receipts_in_progress"], drainActions: ["saveReceiptAction", "resumeConfirmAction", "cancelReceiptAction"], obligations: ["Recebimentos em conferência podem ser concluídos ou cancelados."] },
    existing: "exists",
  },
  {
    key: "compras.nota_a_confirmar", name: "Entrada com nota a confirmar", family: "compras", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "compras.recebimento",
    description: "Mercadoria que chega antes da nota: entrada provisória, conta a pagar provisória e confirmação com a nota.",
    surfaces: { routes: ["/compras/aguardando-nota"], features: ["notaAConfirmar"], exports: ["purchase-pending-invoices"], routines: ["purchases.pending_invoice"], permissions: ["purchase.receive_pending_invoice", "purchase.confirm_invoice"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 60, blockers: ["purchase.pending_invoices"], drainActions: ["invoiceConfirmAction", "cancelScheduledAction"], obligations: ["Entradas aguardando nota precisam ser confirmadas com a nota do fornecedor."] },
    existing: "exists",
  },
  {
    key: "compras.cte", name: "CT-e de frete (entrada)", family: "compras", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "compras.recebimento",
    description: "Importa o CT-e da transportadora e rateia o frete no custo dos recebimentos.",
    surfaces: { routes: ["/compras/cte"], features: ["cteEntrada"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "compras.precificacao", name: "Precificação após a entrada", family: "compras", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "compras.recebimento",
    description: "Sugere o novo preço de venda a partir do custo do recebimento, com prévia.",
    surfaces: { routes: ["/compras/precificacao", "/compras/recebimentos/[id]/precificacao"], features: ["precificacaoEntrada"], permissions: ["purchase.pricing"] },
    deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },

  // ═══════════════════════════════ FINANCEIRO ═══════════════════════════════
  {
    key: "financeiro.contas_receber", name: "Contas a receber", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "Títulos a receber, parcelas, baixa, estorno, renegociação, recibo e aviso de vencimento.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/financeiro/receber"], exports: ["fin-receivables"], routines: ["finance.due"], permissions: ["finance.settle", "finance.reverse"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 365, blockers: ["finance.open_receivables"], drainActions: ["settleAction", "reverseSettlementAction", "settleBatchAction", "previewBatchSettleAction", "cancelTitleAction", "sendNoticeAction", "uploadAttachmentAction"], obligations: ["Títulos em aberto continuam podendo ser baixados (recebimento é direito da empresa e obrigação do cliente); nenhum título novo é lançado manualmente."] },
    existing: "exists",
  },
  {
    key: "financeiro.inadimplencia", name: "Alerta e bloqueio de inadimplentes", family: "financeiro", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "financeiro.contas_receber",
    description: "Política de aviso/bloqueio de venda para cliente em atraso e aviso diário.",
    surfaces: { features: ["inadimplencia"], routines: ["finance.delinquency"] }, deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },
  {
    key: "financeiro.cobranca_whatsapp", name: "Cobrança pelo WhatsApp", family: "financeiro", version: V, classification: "optional_function", availability: "available", kinds: [...ALL], parent: "financeiro.contas_receber",
    description: "Modelos de mensagem e botão 'Cobrar no WhatsApp' nas parcelas.",
    surfaces: { routes: ["/financeiro/cobranca"], features: ["cobrancaWhatsapp"] }, deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },
  {
    key: "financeiro.carne", name: "Impressão de carnê", family: "financeiro", version: V, classification: "optional_function", availability: "available", kinds: [...ALL], parent: "financeiro.contas_receber",
    description: "Carnê com uma lâmina por parcela.",
    surfaces: { routes: ["/financeiro/receber/[id]/carne"], features: ["carne"] }, deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
  },
  {
    key: "financeiro.contas_pagar", name: "Contas a pagar", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "Títulos a pagar, autorização, baixa, estorno e recibo.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/financeiro/pagar"], exports: ["fin-payables"], permissions: ["finance.approve_payable"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 365, blockers: ["finance.open_payables"], drainActions: ["settleAction", "reverseSettlementAction", "settleBatchAction", "previewBatchSettleAction", "approvePayableAction", "revokeApprovalAction", "cancelTitleAction", "uploadAttachmentAction"], obligations: ["Contas em aberto (inclusive as geradas por compras) continuam podendo ser pagas."] },
    existing: "exists",
  },
  {
    key: "financeiro.baixa_lote", name: "Baixa de títulos em lote", family: "financeiro", version: V, classification: "optional_function", availability: "available", kinds: [...ALL], parent: "financeiro.contas_receber",
    description: "Seleção múltipla de parcelas com prévia e baixa conjunta.",
    surfaces: { features: ["baixaLote"], embedded: ["Contas a receber/pagar › Baixar selecionadas"] }, deactivation: immediate({ afterOff: "hidden" }), existing: "exists",
    notes: "Serve a receber e a pagar; o pai é contas a receber por ser a lista em que a função nasceu. Confirmar se deve ser contratável com apenas contas a pagar.",
  },
  {
    key: "financeiro.fluxo_caixa", name: "Fluxo de caixa", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "Fluxo realizado e previsto, lançamentos avulsos e transferências entre contas.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/financeiro/fluxo-caixa"], exports: ["fin-cashflow"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "financeiro.conciliacao", name: "Conciliação bancária", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "Importação de extrato (OFX, CNAB, CSV), conciliação, baixa a partir do extrato e integração bancária.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/financeiro/conciliacao", "/administracao/integracoes/bank"], exports: ["fin-bank-transactions"], permissions: ["finance.reconcile"] },
    deactivation: immediate({
      historyActions: ["undoReconciliationAction"],
      obligations: ["Conciliações feitas ficam em consulta. Desfazer uma conciliação continua permitido: o estorno de baixa conciliada exige desfazê-la antes (finance.ts), e sem isso a baixa ficaria sem correção."],
    }), existing: "exists",
    notes: "Baixa de boleto pelo arquivo de retorno CNAB só existe aqui (reconciliation.ts settleFromBankTx): sem a conciliação, boletos são baixados manualmente em contas a receber.",
  },
  {
    key: "financeiro.cartoes", name: "Recebíveis de cartão", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Acompanhamento e baixa dos recebíveis de cartão das vendas.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/financeiro/cartoes"], exports: ["fin-cards"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 400, blockers: ["finance.open_card_receivables"], drainActions: ["settleCardAction", "settleCardsBatchAction"], obligations: ["Recebíveis de vendas anteriores continuam podendo ser baixados até a liquidação pela adquirente."] },
    existing: "exists",
  },
  {
    key: "financeiro.taxas_adquirente", name: "Taxas por bandeira e arquivo da adquirente", family: "financeiro", version: V, classification: "optional_function", availability: "available", kinds: [...RETAIL], parent: "financeiro.cartoes",
    description: "Taxa por bandeira × parcelas e conciliação com o arquivo da adquirente.",
    surfaces: { routes: ["/financeiro/cartoes/adquirente"], features: ["taxasCartao"], exports: ["fin-acquirer-lines"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "financeiro.relatorios", name: "DRE gerencial e aging", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "DRE por competência, aging de receber e pagar e plano de contas.",
    components: ["tec.financeiro"],
    surfaces: { routes: ["/relatorios/financeiros"], features: ["dre"], exports: ["fin-dre", "fin-aging", "fin-chart-of-accounts"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "financeiro.fechamento_periodo", name: "Fechamento de período", family: "financeiro", version: V, classification: "optional_function", availability: "available", kinds: [...ALL], parent: "financeiro.fluxo_caixa",
    description: "Fecha o período financeiro recusando lançamentos retroativos; reabertura auditada.",
    surfaces: { routes: ["/financeiro/fechamento"], features: ["fechamentoPeriodo"], permissions: ["finance.close_period"] },
    deactivation: immediate({ obligations: ["Períodos já fechados continuam fechados (a trava não é removida pelo desligamento); reabrir exige o módulo."] }), existing: "exists",
  },
  {
    key: "financeiro.exportacao_dominio", name: "Exportação para a Domínio", family: "financeiro", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "Arquivo de lançamentos contábeis no layout de importação da Domínio.",
    requiresAny: [["financeiro.contas_receber", "financeiro.contas_pagar"]],
    surfaces: { routes: ["/financeiro/exportacao-dominio", "/administracao/integracoes/accounting_dominio"], features: ["exportacaoDominio"] }, deactivation: immediate(), existing: "exists",
  },

  // ═══════════════════════════════ FISCAL ═══════════════════════════════
  {
    key: "fiscal.nfce", name: "NFC-e", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Emissão, contingência, consulta, cancelamento e reimpressão de NFC-e.",
    components: ["tec.fiscal"],
    configPrereqs: [{ key: "fiscal.config", description: "Configuração fiscal da filial, certificado e CSC" }],
    surfaces: { routes: ["/fiscal/nfce"], permissions: ["fiscal.issue"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 30, blockers: ["fiscal.processing_nfce"], obligations: ["NFC-e em processamento ou em contingência é transmitida/consultada até a resposta; cancelamento dentro do prazo legal continua permitido."] },
    existing: "exists",
  },
  {
    key: "fiscal.nfe", name: "NF-e", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Assistente de NF-e (venda, devolução, transferência, entrada), carta de correção, cancelamento e inutilização.",
    components: ["tec.fiscal"],
    configPrereqs: [{ key: "fiscal.config", description: "Configuração fiscal da filial e certificado" }],
    surfaces: { routes: ["/fiscal/nfe"], permissions: ["fiscal.issue"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 30, blockers: ["fiscal.processing_nfe"], obligations: ["NF-e em processamento é concluída; cancelamento e CC-e dentro do prazo legal continuam permitidos."] },
    existing: "exists",
  },
  {
    key: "fiscal.nfse", name: "NFS-e", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "Emissão e cancelamento de NFS-e (serviços, LC 116).",
    components: ["tec.fiscal"],
    configPrereqs: [{ key: "fiscal.nfse", description: "Integração de NFS-e do município" }],
    surfaces: { routes: ["/fiscal/nfse", "/administracao/integracoes/fiscal_nfse"], exports: [], permissions: ["fiscal.issue"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 30, blockers: ["fiscal.processing_nfse"], obligations: ["NFS-e em processamento é concluída."] },
    existing: "exists",
  },
  {
    key: "fiscal.livro_entradas", name: "Livro de entradas", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Livro de entradas por período e nota de entrada sem estoque.",
    components: ["tec.fiscal"],
    surfaces: { routes: ["/fiscal/entradas"], features: ["livroEntradas"], exports: ["fiscal-livro-entradas", "fiscal-entradas-cfop"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "fiscal.sped", name: "SPED Fiscal e EFD Contribuições", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...ALL],
    description: "EFD ICMS/IPI por estabelecimento e EFD Contribuições, com prévia de pendências, geração e histórico.",
    components: ["tec.fiscal"],
    surfaces: { routes: ["/fiscal/arquivos"], features: ["arquivosFiscais"], permissions: ["fiscal.files"] },
    deactivation: immediate({ obligations: ["Arquivos gerados continuam para download; o pacote contábil segue sem o SPED do período."] }), existing: "shared_screen",
    notes: "Hoje o recurso arquivosFiscais liga SPED e Sintegra juntos; a habilitação separa /fiscal/arquivos (SPED) de /fiscal/arquivos/sintegra.",
  },
  {
    key: "fiscal.sintegra", name: "Sintegra", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Arquivo Sintegra (registros 50, 54, 61, 61R, 74, 75).",
    components: ["tec.fiscal"],
    surfaces: { routes: ["/fiscal/arquivos/sintegra"], features: ["arquivosFiscais"], permissions: ["fiscal.files"] },
    deactivation: immediate(), existing: "shared_screen",
  },
  {
    key: "fiscal.tributacao_avancada", name: "Tributação avançada", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Tributação completa (ICMS-ST, MVA, FCP, DIFAL), naturezas de operação e crédito do Simples Nacional.",
    requiresAny: [["fiscal.nfe", "fiscal.nfce"]],
    surfaces: { features: ["tributacaoCompleta", "naturezasOperacao", "creditoSimples"], embedded: ["Fiscal › Configurações › Tributação completa / Naturezas / Crédito do Simples"] },
    deactivation: immediate({ obligations: ["Documentos emitidos mantêm os valores calculados; a configuração é preservada para a reativação."] }), existing: "exists",
  },
  {
    key: "fiscal.reforma_tributaria", name: "Reforma tributária (IBS/CBS/IS)", family: "fiscal", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    requiresAny: [["fiscal.nfe", "fiscal.nfce"]],
    description: "Grupos IBS/CBS/IS nos documentos, conforme a adesão na configuração fiscal.",
    surfaces: { features: ["reformaTributaria"] }, deactivation: immediate(), existing: "exists",
  },

  // ═══════════════════════════════ ANÁLISE ═══════════════════════════════
  {
    key: "relatorios.gerenciais", name: "Central de relatórios e relatórios gerenciais", family: "analise", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Central de relatórios, relatórios gerenciais por filial e por período.",
    surfaces: { routes: ["/relatorios", "/relatorios/gerenciais"], exports: ["reports-units", "reports-breakdown", "reports-branch-ops"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "relatorios.curva_abc", name: "Curva ABC de produtos", family: "analise", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Classificação ABC por faturamento/margem e ficha analítica do produto.",
    surfaces: { routes: ["/relatorios/curva-abc"], exports: ["reports-abc", "reports-abc-product"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "gestao.metas", name: "Metas de vendas", family: "analise", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Metas por filial e vendedor com acompanhamento no painel.",
    surfaces: { routes: ["/dashboard/metas"], exports: ["reports-goals"] }, deactivation: immediate(), existing: "exists",
  },

  // ═══════════════════════════════ IMPLANTAÇÃO E INTEGRAÇÕES ═══════════════════════════════
  {
    key: "implantacao.importacao", name: "Importação de cadastros e saldos", family: "implantacao", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Assistente de importação por CSV de clientes, fornecedores, saldos iniciais e títulos.",
    surfaces: { routes: ["/administracao/importacao"], features: ["importacaoCadastros"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "integracao.contabilidade", name: "Área da contabilidade (vínculo com escritório)", family: "implantacao", version: V, classification: "commercial", availability: "available", kinds: [...RETAIL],
    description: "Vínculo com o escritório contábil, envio automático do pacote mensal de XMLs e autorização de certificados.",
    components: ["tec.fiscal"],
    surfaces: { routes: ["/administracao/integracoes/accounting"], routines: ["fiscal.accountingExport"] },
    deactivation: immediate({ obligations: ["Pacotes já entregues continuam na caixa do escritório."] }), existing: "exists",
  },

  // ═══════════════════════════════ ESCRITÓRIO CONTÁBIL ═══════════════════════════════
  {
    key: "contabil.carteira", name: "Carteira de clientes contábeis", family: "contabil", version: V, classification: "commercial", availability: "available", kinds: ["accounting"],
    description: "Painel da carteira, clientes PF/PJ, regime, grupos, departamentos, equipe e responsáveis.",
    surfaces: { routes: ["/contabil", "/contabil/clientes", "/contabil/grupos", "/contabil/equipe"], exports: ["accounting_clients"], permissions: ["accounting.all_clients", "accounting.link", "accounting.manage_team"] },
    deactivation: immediate(), existing: "exists",
  },
  {
    key: "contabil.entregas", name: "Caixa de entrada de entregas", family: "contabil", version: V, classification: "optional_function", availability: "available", kinds: ["accounting"], parent: "contabil.carteira",
    description: "Recebimento dos pacotes de XML das empresas vinculadas, conferência e download auditado.",
    surfaces: { routes: ["/contabil/entregas"], exports: ["accounting_deliveries"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "contabil.certificados", name: "Certificados digitais dos clientes", family: "contabil", version: V, classification: "optional_function", availability: "available", kinds: ["accounting"], parent: "contabil.carteira",
    description: "Solicitação, cobrança, validação, emissão e download de certificados A1 dos clientes.",
    surfaces: { routes: ["/contabil/certificados"], apis: ["/api/certificados"], routines: ["accounting.certificates"], permissions: ["accounting.certificates"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 60, blockers: ["accounting.open_certificate_requests"], obligations: ["Solicitações pagas seguem até a emissão e o download."] },
    existing: "exists",
  },

  // ═══════════════════════════════ REDE DE CERTIFICAÇÃO ═══════════════════════════════
  {
    key: "rede.parceiro", name: "Rede de certificação — nó do parceiro", family: "rede", version: V, classification: "commercial", availability: "available", kinds: ["certification", "accounting", "retail"],
    description: "Minha rede: parceiros abaixo, preços dos filhos e posição na hierarquia.",
    surfaces: { routes: ["/rede/minha", "/rede/novo", "/rede/[id]"], features: ["redeCertificacao"], permissions: ["network.children", "network.prices"] },
    deactivation: immediate(), existing: "exists",
  },
  {
    key: "rede.vendas", name: "Vendas de certificados pela rede", family: "rede", version: V, classification: "optional_function", availability: "available", kinds: ["certification", "accounting", "retail"], parent: "rede.parceiro",
    description: "Nova venda com o preço da rede, clientes de certificado, cobrança e entrega.",
    surfaces: { routes: ["/rede/vendas", "/rede/clientes"], permissions: ["network.sell", "network.sales_all"] },
    deactivation: { mode: "drain", afterOff: "read_history", drainDays: 60, blockers: ["network.open_sales"], obligations: ["Vendas pagas seguem até a emissão do certificado."] },
    existing: "exists",
  },
  {
    key: "rede.vouchers_cupons", name: "Vouchers e cupons da rede", family: "rede", version: V, classification: "optional_function", availability: "available", kinds: ["certification", "accounting", "retail"], parent: "rede.vendas",
    description: "Pacotes de vouchers e cupons de desconto.",
    surfaces: { routes: ["/rede/vouchers", "/rede/cupons"], permissions: ["network.vouchers", "network.coupons"] },
    deactivation: immediate({ obligations: ["Vouchers vendidos continuam resgatáveis (saldo do cliente)."] }), existing: "exists",
  },
  {
    key: "rede.renovacoes", name: "Renovações", family: "rede", version: V, classification: "optional_function", availability: "available", kinds: ["certification", "accounting", "retail"], parent: "rede.parceiro",
    description: "Acompanhamento de vencimentos e contatos de renovação.",
    surfaces: { routes: ["/rede/renovacoes"], routines: ["network.renewals"], permissions: ["network.renewals"] }, deactivation: immediate(), existing: "exists",
  },
  {
    key: "rede.financeiro", name: "Financeiro em camadas da rede", family: "rede", version: V, classification: "optional_function", availability: "available", kinds: ["certification", "accounting", "retail"], parent: "rede.parceiro",
    description: "Modalidade pré/pós-pago, carteira de créditos, fechamentos e resultado por camada.",
    surfaces: { routes: ["/rede/financeiro", "/rede/minha/financeiro", "/rede/fechamentos"], routines: ["network.billing"], exports: ["network-closing"], permissions: ["network.billing", "network.finance_view"] },
    deactivation: { mode: "scheduled", afterOff: "read_history", blockers: ["network.open_closings"], obligations: ["Fechamentos de período em aberto precisam ser concluídos antes do desligamento."] },
    existing: "exists",
  },
  {
    key: "rede.plataforma", name: "Gestão da rede (plataforma Intercert)", family: "rede", version: V, classification: "platform", availability: "available", kinds: [...ALL],
    description: "Árvore completa, preços padrão, catálogo e parâmetros da rede, e a equipe de certificação. Exclusivo da plataforma Intercert, governado pelas operações network.manage e certification.operate.",
    surfaces: { routes: ["/rede", "/rede/precos", "/rede/parametros", "/administracao/certificacao"], permissions: ["network.manage", "certification.operate"] },
    deactivation: never, existing: "exists",
  },

  // ═══════════════════════════════ LACUNAS DOCUMENTADAS (não ativáveis) ═══════════════════════════════
  {
    key: "fiscal.mdfe", name: "MDF-e", family: "fiscal", version: V, classification: "commercial", availability: "planned", kinds: [...RETAIL],
    description: "Manifesto de documentos fiscais para transporte próprio. Não existe no ERP.", surfaces: {}, deactivation: immediate(), existing: "gap",
  },
  {
    key: "vendas.pdv_offline", name: "PDV em contingência offline", family: "vendas", version: V, classification: "optional_function", availability: "planned", kinds: [...RETAIL], parent: "vendas.pdv",
    description: "Operação do PDV sem internet. O PWA hoje só mostra a página de sem conexão.", surfaces: {}, deactivation: immediate(), existing: "gap",
  },
  {
    key: "ecommerce.marketplaces", name: "Integração de pedidos com marketplaces", family: "comercio_digital", version: V, classification: "optional_function", availability: "planned", kinds: [...RETAIL], parent: "ecommerce.loja",
    description: "Importação de pedidos e sincronização de estoque com marketplaces. Hoje só há contas preparadas.", surfaces: {}, deactivation: immediate(), existing: "gap",
  },
];

/**
 * Rotinas que rodam mesmo com o módulo desligado: liberam reservas de estoque e encerram pendências (obrigações).
 * Sem nada pendente elas não fazem nada. As demais rotinas só rodam com o módulo habilitado ou em desligamento.
 */
export const ALWAYS_RUN_ROUTINES = new Set(["ecommerce.expire", "sales.documents_expire", "sales.presale_reservations", "fiscal.stuck", "fiscal.obligations", "admin.backup", "admin.roles", "modules.maintenance", "licenses.maintenance", "interos.reconcile"]);

export const MODULE_MAP: Map<string, ModuleDef> = new Map(MODULES_CATALOG.map((m) => [m.key, m]));

export function moduleDef(key: string): ModuleDef | undefined {
  return MODULE_MAP.get(key);
}

/** Entradas que uma empresa pode ter habilitadas (contratáveis e existentes). */
export const CONTRACTABLE = MODULES_CATALOG.filter((m) => (m.classification === "commercial" || m.classification === "optional_function") && m.availability !== "planned");

/** Família → rótulo. */
export const FAMILIES: Record<string, string> = {
  plataforma: "Plataforma", tecnico: "Componentes técnicos", cadastros: "Cadastros", vendas: "Vendas e caixa", comercio_digital: "Comércio digital",
  estoque: "Estoque", compras: "Compras", financeiro: "Financeiro", fiscal: "Fiscal", analise: "Análise", implantacao: "Implantação e integrações",
  contabil: "Escritório contábil", rede: "Rede de certificação",
};
