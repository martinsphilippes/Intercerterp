/**
 * Esquema único do ERP Intercert.
 *
 * Fonte de verdade para:
 *  - provisionamento das tabelas no Appwrite (scripts/appwrite-setup.ts);
 *  - validação/coerção e índices únicos no armazenamento local (dev/testes);
 *  - backup/restauração (lista de coleções).
 *
 * Convenções de tipos (ver docs/regras-assumidas.md):
 *  - Valores monetários: inteiro em CENTAVOS (tipo "money").
 *  - Quantidades: inteiro em MILÉSIMOS da unidade (tipo "qty"; 1 un = 1000).
 *  - Percentuais: inteiro em pontos-base (sufixo Bps; 1% = 100).
 *  - Datas de calendário (vencimento, competência): string "AAAA-MM-DD" (tipo "date").
 *  - Instantes: ISO-8601 UTC (tipo "datetime").
 *  - JSON: serializado em texto longo (tipo "json").
 */

export type FieldType =
  | "string"
  | "text"
  | "int"
  | "money"
  | "qty"
  | "bool"
  | "datetime"
  | "date"
  | "json"
  | "strings"; // array de strings

export interface FieldDef {
  type: FieldType;
  size?: number; // para string
  required?: boolean;
}

export interface IndexDef {
  key: string;
  type: "key" | "unique";
  fields: string[];
}

export interface CollectionDef {
  id: string;
  label: string;
  fields: Record<string, FieldDef>;
  indexes?: IndexDef[];
  /** coleções que não entram no backup (sessões, locks) */
  ephemeral?: boolean;
}

const s = (size = 255, required = false): FieldDef => ({ type: "string", size, required });
const id = (required = false): FieldDef => ({ type: "string", size: 64, required });
const txt: FieldDef = { type: "text" };
const int: FieldDef = { type: "int" };
const money: FieldDef = { type: "money" };
const qty: FieldDef = { type: "qty" };
const bool: FieldDef = { type: "bool" };
const dt: FieldDef = { type: "datetime" };
const date: FieldDef = { type: "date" };
const json: FieldDef = { type: "json" };
const strings: FieldDef = { type: "strings" };

const k = (key: string, ...fields: string[]): IndexDef => ({ key, type: "key", fields });
const u = (key: string, ...fields: string[]): IndexDef => ({ key, type: "unique", fields });

/** campos de contexto presentes em quase todos os registros transacionais */
const ctx = { companyId: id(true), branchId: id(), createdBy: id(), isDemo: bool };

export const COLLECTIONS: CollectionDef[] = [
  // ───────────────────────────── Acesso e gestão
  {
    id: "companies",
    label: "Empresas",
    fields: {
      name: s(200, true), tradeName: s(200), cnpj: s(20), ie: s(30), im: s(30), regime: s(20), crt: s(2),
      cnae: s(20), email: s(200), phone: s(40), address: json, status: s(20), isDemo: bool, notes: txt, createdBy: id(),
    },
    indexes: [u("u_cnpj", "cnpj")],
  },
  {
    id: "branches",
    label: "Filiais",
    fields: {
      companyId: id(true), code: s(20), name: s(200, true), cnpj: s(20), ie: s(30), im: s(30), uf: s(2),
      cityCode: s(10), cityName: s(120), address: json, phone: s(40), email: s(200), status: s(20),
      fiscalStatus: s(30), defaultWarehouseId: id(), defaultPriceTableId: id(), timezone: s(60), isDemo: bool, createdBy: id(), managerUserId: id(),
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "users",
    label: "Usuários",
    fields: {
      authId: id(), name: s(200, true), email: s(200, true), login: s(80), status: s(20), roleId: id(), isAdmin: bool,
      companyIds: strings, branchIds: strings, discountLimitBps: int, passwordHash: s(300), inviteTokenHash: s(128),
      inviteExpiresAt: dt, resetTokenHash: s(128), resetExpiresAt: dt, lastAccessAt: dt, firstAccessAt: dt,
      suspendedReason: s(300), phone: s(40), isDemo: bool, createdBy: id(),
      inviteSentAt: dt, inviteDelivery: s(300), invitedBy: id(), suspendedAt: dt,
      // perfil por empresa: { [companyId]: roleId } (roleId = perfil legado/da empresa de origem)
      roleByCompany: json,
    },
    indexes: [u("u_email", "email"), k("i_login", "login"), k("i_auth", "authId")],
  },
  {
    id: "roles",
    label: "Perfis",
    fields: {
      companyId: id(), key: s(40), name: s(120, true), description: s(500), permissions: json, actions: strings,
      discountLimitBps: int, system: bool, active: bool, isDemo: bool, createdBy: id(),
      // perfis de sistema: operações do modelo padrão já aplicadas (sincronização de operações novas do modelo)
      templateActions: strings,
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "sessions",
    label: "Sessões",
    ephemeral: true,
    fields: { userId: id(true), tokenHash: s(128, true), expiresAt: dt, persistent: bool, userAgent: s(300), ip: s(60) },
    indexes: [u("u_token", "tokenHash"), k("i_user", "userId")],
  },
  {
    id: "terminals",
    label: "Terminais PDV",
    fields: {
      ...ctx, code: s(20, true), name: s(120, true), status: s(20), nfceSeries: int, printerMode: s(20),
      printerName: s(120), connectorUrl: s(300), paperWidth: int, scannerMode: s(20), tefProvider: s(40),
      tefConfig: json, allowNegativeStock: bool, defaultWarehouseId: id(), lastPrinterTestAt: dt, lastPrinterTestResult: s(300), drawerOnCash: bool,
    },
    indexes: [k("i_branch", "branchId"), u("u_code", "companyId", "code")],
  },
  {
    id: "user_prefs",
    label: "Preferências",
    fields: { userId: id(true), key: s(120, true), value: json },
    indexes: [u("u_user_key", "userId", "key")],
  },
  {
    id: "settings",
    label: "Parâmetros",
    fields: { companyId: id(true), branchId: id(), scopeKey: s(200, true), key: s(120, true), value: json, updatedBy: id() },
    indexes: [u("u_scope", "scopeKey")],
  },
  {
    id: "counters",
    label: "Numeradores",
    ephemeral: false,
    fields: { key: s(200, true), value: int },
    indexes: [u("u_key", "key")],
  },
  {
    id: "goals",
    label: "Metas",
    fields: { ...ctx, period: s(7, true), metric: s(30, true), target: int, notes: s(500) },
    indexes: [k("i_period", "companyId", "period")],
  },

  // ───────────────────────────── Pessoas
  {
    id: "customers",
    label: "Clientes",
    fields: {
      ...ctx, personType: s(2, true), doc: s(20), code: s(30), name: s(200, true), tradeName: s(200), email: s(200),
      phone: s(40), mobile: s(40), birthDate: date, gender: s(20), maritalStatus: s(30), profession: s(120),
      sellerId: id(), vip: bool, finalConsumer: bool, acceptsPromotions: bool, promoChannels: strings, ie: s(30),
      ieIndicator: s(2), im: s(30), suframa: s(30), addresses: json, contacts: json, creditLimit: money, paymentTermDays: int,
      paymentTermId: id(), priceTableId: id(), notes: txt, status: s(20), searchText: s(1000), docLookup: json,
    },
    indexes: [k("i_company", "companyId"), u("u_doc", "companyId", "doc"), k("i_name", "name")],
  },
  {
    id: "suppliers",
    label: "Fornecedores",
    fields: {
      ...ctx, personType: s(2, true), doc: s(20), code: s(30), name: s(200, true), tradeName: s(200), email: s(200),
      phone: s(40), ie: s(30), im: s(30), addresses: json, contacts: json, paymentTermId: id(), paymentTermsText: s(200),
      leadTimeDays: int, minOrderValue: money, freightPolicy: s(200), notes: txt, status: s(20), searchText: s(1000),
      category: s(60), statusReason: s(300),
    },
    indexes: [k("i_company", "companyId"), u("u_doc", "companyId", "doc")],
  },

  // ───────────────────────────── Catálogo
  { id: "categories", label: "Categorias", fields: { ...ctx, name: s(120, true), parentId: id(), status: s(20) }, indexes: [k("i_company", "companyId")] },
  { id: "brands", label: "Marcas", fields: { ...ctx, name: s(120, true), status: s(20) }, indexes: [k("i_company", "companyId")] },
  {
    id: "units",
    label: "Unidades",
    fields: { ...ctx, code: s(10, true), name: s(60, true), decimals: int, status: s(20) },
    indexes: [u("u_code", "companyId", "code")],
  },
  {
    id: "products",
    label: "Produtos e serviços",
    fields: {
      ...ctx, type: s(20, true), code: s(40), name: s(200, true), description: txt, gtin: s(20), unitCode: s(10),
      categoryId: id(), brandId: id(), supplierId: id(), imageFileId: id(), active: bool, availablePdv: bool,
      availableEcommerce: bool, hasVariants: bool, variantAxes: json, ncm: s(10), cest: s(10), origin: s(2),
      taxGroupId: id(), cfop: s(10), cstCsosn: s(5), serviceListItem: s(10), municipalServiceCode: s(30),
      issRateBps: int, cnaeService: s(20), weightGrams: int, searchText: s(1000), status: s(20),
    },
    indexes: [k("i_company", "companyId"), u("u_code", "companyId", "code"), k("i_category", "categoryId")],
  },
  {
    id: "skus",
    label: "Variações / SKU",
    fields: {
      ...ctx, productId: id(true), sku: s(60, true), barcode: s(30), extraBarcodes: strings, attributes: json,
      name: s(250), unitCode: s(10), active: bool, costAcquisition: money, costAdditional: money, costTotal: money,
      additionalCosts: json, searchText: s(1000),
    },
    indexes: [k("i_product", "productId"), u("u_sku", "companyId", "sku"), k("i_barcode", "barcode")],
  },
  {
    id: "unit_conversions",
    label: "Conversões de unidade",
    fields: { ...ctx, productId: id(true), fromUnit: s(10, true), toUnit: s(10, true), factor: qty },
    indexes: [k("i_product", "productId")],
  },
  {
    id: "price_tables",
    label: "Tabelas de preço",
    fields: { ...ctx, name: s(120, true), kind: s(20), active: bool, isDefault: bool, notes: s(500) },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "prices",
    label: "Preços",
    fields: {
      ...ctx, priceTableId: id(true), skuId: id(true), productId: id(), scopeKey: s(200, true), price: money,
      wholesalePrice: money, wholesaleMinQty: qty, maxDiscountBps: int, validFrom: date, validTo: date,
    },
    indexes: [u("u_scope", "scopeKey"), k("i_sku", "skuId"), k("i_table", "priceTableId")],
  },
  {
    id: "price_history",
    label: "Histórico de preços e custos",
    fields: { ...ctx, skuId: id(true), productId: id(), priceTableId: id(), field: s(40), oldValue: money, newValue: money, reason: s(300) },
    indexes: [k("i_sku", "skuId")],
  },
  {
    id: "supplier_products",
    label: "Produtos por fornecedor",
    fields: {
      ...ctx, supplierId: id(true), skuId: id(true), supplierCode: s(60), supplierDescription: s(250), conversionFactor: qty,
      lastCost: money, lastPurchaseAt: dt, leadTimeDays: int, minQty: qty, multiple: qty, preferred: bool,
    },
    indexes: [k("i_supplier", "supplierId"), k("i_sku", "skuId"), u("u_pair", "supplierId", "skuId")],
  },
  {
    id: "product_imports",
    label: "Importações de produtos",
    fields: {
      ...ctx, number: int, fileName: s(250), mode: s(20), matchBy: s(20), mapping: json, status: s(20), totals: json,
      results: json, idemKey: s(120), finishedAt: dt,
    },
    indexes: [k("i_company", "companyId"), u("u_idem", "idemKey")],
  },

  // ───────────────────────────── Estoque
  {
    id: "warehouses",
    label: "Depósitos",
    fields: { ...ctx, code: s(20), name: s(120, true), kind: s(20), isDefault: bool, status: s(20) },
    indexes: [k("i_branch", "branchId")],
  },
  {
    id: "stock_balances",
    label: "Saldos de estoque",
    fields: {
      ...ctx, warehouseId: id(true), skuId: id(true), productId: id(), physical: qty, reserved: qty, inTransit: qty,
      avgCost: money, minQty: qty, maxQty: qty, safetyQty: qty, reorderMultiple: qty, seq: int, lastMovementAt: dt,
      location: s(60),
    },
    indexes: [u("u_wh_sku", "warehouseId", "skuId"), k("i_sku", "skuId"), k("i_branch", "branchId")],
  },
  {
    id: "stock_movements",
    label: "Movimentos de estoque",
    fields: {
      ...ctx, balanceId: id(true), warehouseId: id(true), skuId: id(true), productId: id(), type: s(30, true), qty: qty,
      balanceBefore: qty, balanceAfter: qty, unitCost: money, totalCost: money, avgCostAfter: money, seq: int,
      originType: s(40), originId: id(), operationId: id(), reason: s(300), occurredAt: dt, idemKey: s(120, true),
      lot: s(60), lotExpiry: date, documentRef: s(120), notes: s(500),
    },
    indexes: [u("u_seq", "balanceId", "seq"), u("u_idem", "idemKey"), k("i_sku", "skuId"), k("i_origin", "originType", "originId"), k("i_branch_date", "branchId", "occurredAt")],
  },
  {
    id: "stock_reservations",
    label: "Reservas de estoque",
    fields: { ...ctx, warehouseId: id(true), skuId: id(true), qty: qty, originType: s(40), originId: id(), status: s(20), idemKey: s(120) },
    indexes: [k("i_origin", "originType", "originId"), u("u_idem", "idemKey")],
  },
  {
    id: "transfers",
    label: "Transferências",
    fields: {
      ...ctx, number: int, fromBranchId: id(true), toBranchId: id(true), fromWarehouseId: id(), toWarehouseId: id(),
      status: s(20), items: json, responsibleId: id(), notes: txt, separatedAt: dt, shippedAt: dt, receivedAt: dt,
      cancelledAt: dt, divergences: json, documentRef: s(200),
      receipts: json, returnedAt: dt, shippedBy: id(), receivedBy: id(), totalCost: money, cancelReason: s(500),
      expectedAt: date,
    },
    indexes: [k("i_from", "fromBranchId"), k("i_to", "toBranchId")],
  },
  {
    id: "inventories",
    label: "Inventários",
    fields: {
      ...ctx, number: int, warehouseId: id(true), scope: s(20), categoryId: id(), location: s(120), status: s(20),
      baseAt: dt, startedAt: dt, completedAt: dt, completedBy: id(), method: s(40), summary: json, notes: txt,
      closingAt: dt, cancelledAt: dt, cancelReason: s(500), itemsCount: int, code: s(30), responsibleId: id(),
    },
    indexes: [k("i_branch", "branchId")],
  },
  {
    id: "inventory_counts",
    label: "Contagens de inventário",
    fields: {
      ...ctx, inventoryId: id(true), skuId: id(true), productId: id(), baseQty: qty, countedQty: qty, recountQty: qty,
      counted: bool, movementsDuringCount: qty, expectedQty: qty, difference: qty, unitCost: money, differenceValue: money,
      note: s(500), countedBy: id(), countedAt: dt, adjustmentMovementId: id(),
      baseSeq: int, countSeq: int, recountAt: dt, recountBy: id(), finalQty: qty, location: s(60),
    },
    indexes: [k("i_inventory", "inventoryId"), u("u_inv_sku", "inventoryId", "skuId")],
  },

  // ───────────────────────────── Vendas e caixa
  {
    id: "cash_sessions",
    label: "Sessões de caixa",
    fields: {
      ...ctx, terminalId: id(true), operatorId: id(true), status: s(20), number: int, openedAt: dt, openingFund: money,
      closedAt: dt, closedBy: id(), version: int, expected: json, counted: json, differences: json, justification: txt,
      checklist: json, history: json, peripheralsCheck: json, lockKey: s(120),
      // conferência cega: contagem registrada no servidor antes de revelar o previsto { version, counted, at, by }
      blindCount: json,
    },
    indexes: [k("i_terminal", "terminalId"), u("u_lock", "lockKey"), k("i_branch", "branchId")],
  },
  {
    id: "cash_movements",
    label: "Movimentos de caixa",
    fields: {
      ...ctx, sessionId: id(true), number: int, type: s(30, true), method: s(30), amount: money, reason: s(300),
      recipient: s(200), accountId: id(), saleId: id(), returnId: id(), occurredAt: dt, idemKey: s(120), notes: s(500),
      transferId: id(), sessionVersion: int, responsibleId: id(), approvedBy: id(),
    },
    indexes: [k("i_session", "sessionId"), u("u_idem", "idemKey")],
  },
  {
    id: "carts",
    label: "Atendimentos / pré-vendas",
    fields: {
      ...ctx, terminalId: id(), operatorId: id(), status: s(20), name: s(120), customerId: id(), priceTableId: id(),
      items: json, globalDiscount: money, globalDiscountBps: int, surcharge: money, notes: s(500), saleId: id(), expiresAt: dt,
      payments: json, exchangeReturnId: id(), cpfOnInvoice: s(20), sellerId: id(), parkedAt: dt, cancelReason: s(300),
      customerName: s(200), total: money, itemsCount: int, revision: int, emitFiscal: bool,
    },
    indexes: [k("i_terminal", "terminalId", "status"), k("i_branch_status", "branchId", "status")],
  },
  {
    id: "sales",
    label: "Vendas",
    fields: {
      ...ctx, number: int, terminalId: id(), cashSessionId: id(), operatorId: id(), sellerId: id(), customerId: id(),
      customerSnapshot: json, origin: s(20), status: s(20), paymentStatus: s(20), fiscalStatus: s(20), fiscalDocumentId: id(),
      priceTableId: id(), itemsCount: int, subtotal: money, discountTotal: money, surchargeTotal: money, total: money,
      costTotal: money, paidTotal: money, changeAmount: money, returnedTotal: money, returnedCost: money, idemKey: s(120),
      cartId: id(), exchangeReturnId: id(), completedAt: dt, cancelledAt: dt, cancelReason: s(500), cancelledBy: id(),
      notes: txt, operationId: id(), effectsStatus: s(20), discountApprovedBy: id(),
      cancelEffectsStatus: s(20),
      // pendências do cancelamento repassadas ao Financeiro (títulos com baixa mantidos): [{ titleId, number, message }]
      cancelPending: json,
    },
    indexes: [u("u_idem", "idemKey"), k("i_branch_date", "branchId", "completedAt"), k("i_customer", "customerId"), k("i_session", "cashSessionId"), k("i_number", "companyId", "number")],
  },
  {
    id: "sale_items",
    label: "Itens de venda",
    fields: {
      ...ctx, saleId: id(true), seq: int, skuId: id(true), productId: id(), sku: s(60), description: s(250), unitCode: s(10),
      qty: qty, unitPrice: money, grossTotal: money, itemDiscount: money, globalDiscount: money, surcharge: money,
      total: money, unitCost: money, costTotal: money, returnedQty: qty, warehouseId: id(), ncm: s(10), cfop: s(10),
      categoryId: id(), completedAt: dt,
    },
    indexes: [k("i_sale", "saleId"), k("i_sku", "skuId"), k("i_branch_date", "branchId", "completedAt")],
  },
  {
    id: "sale_payments",
    label: "Pagamentos de venda",
    fields: {
      ...ctx, saleId: id(true), seq: int, methodId: id(), methodKind: s(30, true), methodName: s(120), amount: money,
      received: money, change: money, installments: int, paymentTermId: id(), status: s(20), provider: s(40),
      providerRef: s(120), intentId: id(), nsu: s(60), authCode: s(60), cardBrand: s(40), feeAmount: money, netAmount: money,
      settlementDate: date, confirmedAt: dt, manual: bool, voucherId: id(), titleId: id(), dueDates: json,
      refundedAt: dt, refundMessage: s(500),
    },
    indexes: [k("i_sale", "saleId")],
  },
  {
    id: "payment_intents",
    label: "Cobranças Pix/cartão",
    fields: {
      ...ctx, provider: s(40), kind: s(20), amount: money, status: s(20), reference: s(120, true), providerId: s(120),
      qrCode: txt, qrCodeImage: txt, expiresAt: dt, cartId: id(), saleId: id(), attempts: int, lastCheckedAt: dt,
      raw: json, errorMessage: s(500), isSimulated: bool,
      cancelRequestedAt: dt, cancelConfirmedAt: dt, refundRequestedAt: dt, refundedAt: dt,
    },
    indexes: [u("u_ref", "reference"), k("i_cart", "cartId")],
  },
  {
    id: "returns",
    label: "Devoluções e trocas",
    fields: {
      ...ctx, number: int, saleId: id(true), customerId: id(), kind: s(20), status: s(20), reason: s(300),
      compensation: s(20), itemsTotal: money, costTotal: money, refundMethod: s(30), refundAccountId: id(),
      creditVoucherId: id(), exchangeSaleId: id(), difference: money, fiscalDocumentId: id(), idemKey: s(120),
      completedAt: dt, notes: txt, cashSessionId: id(),
      // linhas devolvidas (fonte do saldo devolvível), abatimento do título a prazo e valor compensado (vale/reembolso)
      lines: json, abatedAmount: money, compensatedAmount: money, effectsStatus: s(20), confirmedBy: id(), confirmationRef: s(120),
    },
    indexes: [k("i_sale", "saleId"), u("u_idem", "idemKey")],
  },
  {
    id: "return_items",
    label: "Itens devolvidos",
    fields: {
      ...ctx, returnId: id(true), saleId: id(), saleItemId: id(true), skuId: id(true), qty: qty, condition: s(20),
      warehouseId: id(), unitPrice: money, total: money, unitCost: money, costTotal: money, completedAt: dt, reason: s(300),
    },
    indexes: [k("i_return", "returnId"), k("i_sale_item", "saleItemId"), k("i_sku", "skuId")],
  },
  {
    id: "credit_vouchers",
    label: "Vales-crédito",
    fields: {
      ...ctx, customerId: id(), code: s(30, true), originalAmount: money, balance: money, status: s(20), returnId: id(),
      expiresAt: date, seq: int,
    },
    indexes: [u("u_code", "code"), k("i_customer", "customerId")],
  },
  {
    id: "credit_voucher_moves",
    label: "Movimentos de vale-crédito",
    fields: { ...ctx, voucherId: id(true), seq: int, kind: s(20), amount: money, balanceAfter: money, saleId: id(), returnId: id(), idemKey: s(120) },
    indexes: [k("i_voucher", "voucherId"), u("u_idem", "idemKey")],
  },

  // ───────────────────────────── Financeiro
  {
    id: "financial_accounts",
    label: "Contas financeiras",
    fields: {
      ...ctx, name: s(120, true), kind: s(30), bankCode: s(10), agency: s(20), accountNumber: s(30), initialBalance: money,
      initialBalanceDate: date, balance: money, seq: int, active: bool, pixKey: s(120),
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "account_entries",
    label: "Lançamentos em conta",
    fields: {
      ...ctx, accountId: id(true), seq: int, date: date, amount: money, balanceAfter: money, kind: s(30),
      description: s(300), titleId: id(), installmentId: id(), settlementId: id(), transferId: id(), categoryId: id(),
      costCenterId: id(), reconciled: bool, reconciliationId: id(), reversalOf: id(), reversedBy: id(), operationId: id(),
      originType: s(40), originId: id(), idemKey: s(120, true),
    },
    indexes: [u("u_seq", "accountId", "seq"), u("u_idem", "idemKey"), k("i_account_date", "accountId", "date"), k("i_company_date", "companyId", "date")],
  },
  {
    id: "payment_methods",
    label: "Meios de pagamento",
    fields: {
      ...ctx, name: s(120, true), kind: s(30, true), accountId: id(), feeBps: int, settlementDays: int, allowsChange: bool,
      requiresCustomer: bool, integrationId: id(), maxInstallments: int, active: bool, sortOrder: int, availablePdv: bool,
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "payment_terms",
    label: "Condições de pagamento",
    fields: { ...ctx, name: s(120, true), installments: int, firstDueDays: int, intervalDays: int, interestBps: int, active: bool, kind: s(20) },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "fin_categories",
    label: "Categorias financeiras",
    fields: { ...ctx, name: s(120, true), type: s(20, true), parentId: id(), dreGroup: s(60), active: bool },
    indexes: [k("i_company", "companyId")],
  },
  { id: "cost_centers", label: "Centros de custo", fields: { ...ctx, name: s(120, true), code: s(20), active: bool }, indexes: [k("i_company", "companyId")] },
  {
    id: "titles",
    label: "Títulos",
    fields: {
      ...ctx, kind: s(20, true), number: int, partyType: s(20), partyId: id(), partyName: s(200), description: s(300),
      documentNumber: s(60), originType: s(40), originId: id(), operationId: id(), issueDate: date, competenceDate: date,
      categoryId: id(), costCenterId: id(), total: money, balance: money, installmentsCount: int, status: s(20),
      approvalStatus: s(20), approvedBy: id(), approvedAt: dt, attachments: json, notes: txt, idemKey: s(120),
    },
    indexes: [u("u_idem", "idemKey"), k("i_kind", "companyId", "kind"), k("i_origin", "originType", "originId"), k("i_party", "partyId")],
  },
  {
    id: "installments",
    label: "Parcelas",
    fields: {
      ...ctx, titleId: id(true), kind: s(20, true), number: int, dueDate: date, competenceDate: date, amount: money,
      interest: money, fine: money, discount: money, paid: money, balance: money, status: s(20), seq: int,
      partyId: id(), partyName: s(200), categoryId: id(), costCenterId: id(), lastSettlementAt: date, methodKind: s(30),
      description: s(300), ourNumber: s(40),
    },
    indexes: [k("i_title", "titleId"), k("i_due", "companyId", "kind", "dueDate"), k("i_party", "partyId")],
  },
  {
    id: "settlements",
    label: "Baixas",
    fields: {
      ...ctx, installmentId: id(true), titleId: id(true), kind: s(20), seq: int, date: date, principal: money,
      interest: money, fine: money, discount: money, fee: money, total: money, methodId: id(), methodKind: s(30),
      accountId: id(), accountEntryId: id(), reference: s(120), notes: s(500), attachmentFileId: id(), status: s(20),
      reversedAt: dt, reversedBy: id(), reversalReason: s(300), operationId: id(), idemKey: s(120, true),
    },
    indexes: [u("u_seq", "installmentId", "seq"), u("u_idem", "idemKey"), k("i_title", "titleId"), k("i_date", "companyId", "date")],
  },
  {
    id: "fin_transfers",
    label: "Transferências entre contas",
    fields: { ...ctx, fromAccountId: id(true), toAccountId: id(true), amount: money, date: date, description: s(300), status: s(20), idemKey: s(120) },
    indexes: [u("u_idem", "idemKey")],
  },
  {
    id: "bank_imports",
    label: "Importações de extrato/retorno",
    fields: {
      ...ctx, accountId: id(true), format: s(20), fileName: s(200), fileId: id(), fileHash: s(80), bankCode: s(10),
      layoutVersion: s(40), kind: s(30), status: s(20), summary: json, lineResults: json, scopeKey: s(200),
    },
    indexes: [u("u_scope", "scopeKey"), k("i_account", "accountId")],
  },
  {
    id: "bank_transactions",
    label: "Transações bancárias",
    fields: {
      ...ctx, accountId: id(true), importId: id(), uniqueKey: s(200, true), externalId: s(120), date: date, amount: money,
      description: s(300), docNumber: s(60), kind: s(30), cnabOccurrence: s(10), cnabOccurrenceText: s(200),
      ourNumber: s(40), yourNumber: s(40), status: s(20), reconciliationId: id(), installmentId: id(), feeAmount: money,
      lineNo: int, bankCode: s(10), dueDate: date, creditDate: date, paidAmount: money, interestAmount: money, discountAmount: money,
      payerName: s(200), settlementId: id(), notes: s(500),
    },
    indexes: [u("u_key", "uniqueKey"), k("i_account_date", "accountId", "date"), k("i_import", "importId")],
  },
  {
    id: "reconciliations",
    label: "Conciliações",
    fields: {
      ...ctx, accountId: id(true), status: s(20), bankTxIds: strings, entryIds: strings, allocations: json, difference: money,
      feeEntryId: id(), undoneAt: dt, undoneBy: id(), notes: s(500), kind: s(20), undoReason: s(300),
    },
    indexes: [k("i_account", "accountId")],
  },
  {
    // trava de concorrência: um extrato/lançamento só participa de UMA conciliação ativa (id determinístico por alvo)
    id: "reconciliation_links",
    label: "Vínculos de conciliação",
    fields: { ...ctx, accountId: id(true), reconciliationId: id(true), targetType: s(20, true), targetId: id(true), amount: money },
    indexes: [k("i_recon", "reconciliationId"), k("i_target", "targetId")],
  },

  // ───────────────────────────── Compras
  {
    id: "quotations",
    label: "Cotações",
    fields: {
      ...ctx, number: int, title: s(200), origin: s(30), originId: id(), status: s(20), items: json, supplierIds: strings,
      selection: json, selectionMode: s(20), responseDue: date, notes: txt, ordersCreated: bool, closedAt: dt,
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "quotation_proposals",
    label: "Propostas de fornecedores",
    fields: {
      ...ctx, quotationId: id(true), supplierId: id(true), items: json, freight: money, leadTimeDays: int, paymentTermId: id(),
      paymentTermsText: s(200), minOrderValue: money, validUntil: date, notes: s(500), status: s(20), receivedAt: dt,
      version: int, source: s(20),
    },
    indexes: [k("i_quotation", "quotationId"), u("u_pair", "quotationId", "supplierId")],
  },
  {
    id: "purchase_orders",
    label: "Pedidos de compra",
    fields: {
      ...ctx, number: int, supplierId: id(true), supplierSnapshot: json, warehouseId: id(), status: s(20), revision: int,
      expectedDate: date, subtotal: money, discountTotal: money, freight: money, otherExpenses: money, total: money,
      paymentTermId: id(), paymentTermsText: s(200), installmentsPlan: json, notes: txt, origin: s(30), originId: id(),
      quotationId: id(), requestId: id(), approvedAt: dt, approvedRevision: int, sentAt: dt, sentMethod: s(30),
      receivedValue: money, cancelledAt: dt, rejectReason: s(500), idemKey: s(120),
      proposalRef: json, originData: json, sentInfo: json, searchText: s(1000),
      purpose: s(200), buyerId: id(), paymentMethodId: id(), costCenterId: id(), insurance: money, ipiTotal: money,
    },
    indexes: [k("i_supplier", "supplierId"), k("i_status", "companyId", "status"), u("u_idem", "idemKey")],
  },
  {
    id: "purchase_order_items",
    label: "Itens de pedido de compra",
    fields: {
      ...ctx, orderId: id(true), seq: int, skuId: id(true), productId: id(), description: s(250), unitCode: s(10), qty: qty,
      unitCost: money, discount: money, total: money, receivedQty: qty, supplierCode: s(60), ipi: money,
    },
    indexes: [k("i_order", "orderId"), k("i_sku", "skuId")],
  },
  {
    id: "purchase_order_revisions",
    label: "Revisões de pedido",
    fields: { ...ctx, orderId: id(true), revision: int, snapshot: json, reason: s(500), requiresReview: bool },
    indexes: [k("i_order", "orderId")],
  },
  {
    id: "purchase_requests",
    label: "Solicitações de compra",
    fields: {
      ...ctx, number: int, requesterId: id(), origin: s(30), originId: id(), orderIds: strings, total: money, freight: money,
      status: s(20), currentStep: int, steps: json, policySnapshot: json, validUntil: date, revision: int, notes: txt,
      decidedAt: dt, quotationId: id(), warnings: json,
      decisionSeq: int,
    },
    indexes: [k("i_status", "companyId", "status")],
  },
  {
    id: "approval_policies",
    label: "Políticas de aprovação",
    fields: {
      ...ctx, name: s(120, true), active: bool, rules: json, autoApproveBelow: money, allowSelfApproval: bool,
      expiredProposalAction: s(20), reviewOnRevision: s(20),
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "approval_decisions",
    label: "Decisões de aprovação",
    fields: { ...ctx, requestId: id(true), step: int, stepName: s(120), decision: s(20), note: txt, revision: int, revokedAt: dt, revokedBy: id(), revokeReason: s(300) },
    indexes: [k("i_request", "requestId")],
  },
  {
    id: "receipts",
    label: "Recebimentos de mercadoria",
    fields: {
      ...ctx, number: int, warehouseId: id(), supplierId: id(), orderIds: strings, nfeKey: s(60), nfeNumber: s(20),
      nfeSeries: s(5), nfeIssueDate: dt, xmlFileId: id(), xmlHash: s(80), status: s(20), items: json, productsTotal: money,
      freight: money, otherExpenses: money, discount: money, total: money, invoicedTotal: money, paymentTermId: id(),
      installments: json, payableTitleId: id(), confirmedAt: dt, divergences: json, notes: txt, scopeKey: s(200),
      dueTotal: money, emitter: json, differenceAction: s(30), searchText: s(1000), confirmedBy: id(),
      entryCfop: s(10), categoryId: id(), costCenterId: id(), paymentMethodId: id(), effects: json,
      orderCharges: json,
    },
    indexes: [u("u_scope", "scopeKey"), k("i_supplier", "supplierId")],
  },

  // ───────────────────────────── Fiscal
  {
    id: "fiscal_configs",
    label: "Configurações fiscais",
    fields: {
      ...ctx, scopeKey: s(200, true), provider: s(40), environment: s(20), tokenRef: s(120), nfeEnabled: bool, nfceEnabled: bool,
      nfseEnabled: bool, nfeSeries: int, nfeNextNumber: int, nfceSeries: int, nfceNextNumber: int, nfseSeries: s(10),
      rpsNextNumber: int, nfseStandard: s(20), cscId: s(20), cscTokenRef: s(120), contingency: bool, contingencyReason: s(300),
      defaultPresence: s(2), defaultTaxGroupId: id(), certificate: json, lastTestAt: dt, lastTestResult: s(500),
      connectionStatus: s(30), validFrom: date, extra: json,
      nfeCancelHours: int, nfceCancelMinutes: int, defaultNature: s(120), simulateOutage: bool, contingencySince: dt,
      autoEmail: bool, checkAvailability: bool, approxTaxBps: int,
    },
    indexes: [u("u_scope", "scopeKey")],
  },
  {
    id: "tax_groups",
    label: "Grupos tributários",
    fields: {
      ...ctx, name: s(120, true), regime: s(20), cfopInternal: s(10), cfopInterstate: s(10), cfopReturn: s(10), cstCsosn: s(5),
      icmsRateBps: int, icmsBaseReductionBps: int, fcpRateBps: int, pisCst: s(5), pisRateBps: int, cofinsCst: s(5),
      cofinsRateBps: int, ipiCst: s(5), ipiRateBps: int, validFrom: date, validTo: date, active: bool, notes: s(500),
      approxTaxBps: int,
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "fiscal_documents",
    label: "Documentos fiscais",
    fields: {
      ...ctx, model: s(10, true), environment: s(20), provider: s(40), ref: s(120, true), series: s(10), number: int,
      accessKey: s(60), status: s(20), originType: s(40), originId: id(), operationId: id(), nature: s(120), purpose: s(20),
      operationType: s(20), recipient: json, items: json, totals: json, transport: json, payments: json, service: json,
      protocol: s(60), statusCode: s(20), statusMessage: txt, xmlFileId: id(), danfeUrl: s(500), xmlUrl: s(500),
      qrCodeUrl: txt, issuedAt: dt, authorizedAt: dt, cancelledAt: dt, attempts: int, lastAttemptAt: dt, isSimulated: bool,
      contingency: bool, total: money, recipientName: s(200), recipientDoc: s(20), terminalId: id(), operatorId: id(),
      rpsNumber: int, rpsSeries: s(10), verificationCode: s(60), correctionCount: int, nextCheckAt: dt,
      partyType: s(20), partyId: id(), effects: json, titleId: id(), cancelReason: s(500), cancelRequestedAt: dt,
      competenceDate: date, presence: s(2), lastEmailTo: s(200), exitAt: dt,
    },
    indexes: [u("u_ref", "ref"), k("i_model_date", "companyId", "model", "issuedAt"), k("i_origin", "originType", "originId")],
  },
  {
    id: "fiscal_events",
    label: "Eventos fiscais",
    fields: { ...ctx, documentId: id(true), type: s(30), status: s(20), seq: int, message: txt, request: json, response: json, protocol: s(60), occurredAt: dt },
    indexes: [k("i_document", "documentId")],
  },
  {
    id: "fiscal_obligations",
    label: "Obrigações fiscais",
    fields: {
      ...ctx, kind: s(30), name: s(120), period: s(7), dueDate: date, status: s(20), proofFileId: id(), deliveredAt: dt, notes: s(500), responsibleId: id(), recurrence: s(20),
      templateKey: s(60), scopeKey: s(200), receiptNumber: s(120), amount: money, exportFileId: id(), completedBy: id(),
    },
    indexes: [k("i_company", "companyId", "dueDate")],
  },
  {
    id: "fiscal_sim_state",
    label: "Simulação fiscal (estado do provedor simulado)",
    fields: { companyId: id(), ref: s(120, true), model: s(10), status: s(20), data: json },
    indexes: [u("u_ref", "ref")],
  },

  // ───────────────────────────── Integrações, operação e suporte
  {
    id: "integrations",
    label: "Integrações",
    fields: {
      ...ctx, scopeKey: s(200, true), kind: s(30, true), provider: s(40), environment: s(20), config: json, secretRefs: json,
      status: s(30), lastTestAt: dt, lastTestMessage: s(1000), lastRunAt: dt, lastRunStatus: s(20), enabled: bool,
    },
    indexes: [u("u_scope", "scopeKey")],
  },
  {
    id: "integration_logs",
    label: "Execuções de integração",
    fields: { ...ctx, integrationId: id(), kind: s(30), action: s(60), status: s(20), message: txt, payload: json, durationMs: int, occurredAt: dt },
    indexes: [k("i_integration", "integrationId"), k("i_company_date", "companyId", "occurredAt")],
  },
  {
    id: "webhook_events",
    label: "Eventos recebidos",
    fields: { ...ctx, provider: s(40), externalId: s(200, true), payload: json, status: s(20), processedAt: dt, error: txt },
    indexes: [u("u_ext", "externalId")],
  },
  {
    id: "jobs",
    label: "Tarefas",
    fields: {
      companyId: id(), type: s(60, true), payload: json, status: s(20), runAt: dt, attempts: int, maxAttempts: int,
      lastError: txt, dedupeKey: s(200, true), lockedUntil: dt, result: json, finishedAt: dt, createdBy: id(),
    },
    indexes: [u("u_dedupe", "dedupeKey"), k("i_status_run", "status", "runAt"), k("i_status_lock", "status", "lockedUntil")],
  },
  {
    id: "operations",
    label: "Operações (idempotência)",
    fields: { companyId: id(), type: s(60), status: s(20), entityType: s(40), entityId: id(), error: txt, result: json, createdBy: id() },
  },
  {
    id: "notifications",
    label: "Notificações",
    fields: {
      ...ctx, userId: id(true), type: s(40), priority: s(20), title: s(200), body: txt, link: s(300), originType: s(40),
      originId: id(), occurrenceKey: s(200), occurrenceStatus: s(20), responsibleName: s(200), readAt: dt, archivedAt: dt,
      dedupeKey: s(200, true),
    },
    indexes: [u("u_dedupe", "dedupeKey"), k("i_user", "userId", "readAt"), k("i_occ", "occurrenceKey")],
  },
  {
    id: "audit_logs",
    label: "Histórico e auditoria",
    fields: {
      companyId: id(), branchId: id(), userId: id(), userName: s(200), module: s(40), action: s(60), entityType: s(40),
      entityId: id(), summary: s(500), before: json, after: json, reason: s(500), result: s(20), ip: s(60),
      occurredAt: dt, operationId: id(), related: strings, userRole: s(120),
    },
    indexes: [k("i_company_date", "companyId", "occurredAt"), k("i_entity", "entityType", "entityId")],
  },
  {
    id: "tickets",
    label: "Chamados",
    fields: { ...ctx, number: int, userId: id(), category: s(40), priority: s(20), subject: s(200), status: s(20), context: json, assigneeId: id(), externalRef: s(120), externalStatus: s(40), lastMessageAt: dt, resolvedAt: dt },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "ticket_messages",
    label: "Mensagens de chamado",
    fields: { ...ctx, ticketId: id(true), userId: id(), userName: s(200), body: txt, attachments: json, internal: bool },
    indexes: [k("i_ticket", "ticketId")],
  },
  {
    id: "help_articles",
    label: "Artigos de ajuda",
    fields: { companyId: id(), area: s(60), title: s(200, true), slug: s(120, true), body: txt, tags: strings, contextRoutes: strings, published: bool, summary: s(300) },
    indexes: [u("u_slug", "slug")],
  },
  {
    id: "backups",
    label: "Backups",
    fields: {
      ...ctx, number: int, kind: s(20), scope: json, status: s(20), fileId: id(), sizeBytes: int, checksum: s(100), counts: json,
      startedAt: dt, finishedAt: dt, verifiedAt: dt, verifyResult: json, error: txt, retentionUntil: date,
    },
    indexes: [k("i_company", "companyId")],
  },
  {
    id: "restore_jobs",
    label: "Restaurações",
    fields: { ...ctx, backupId: id(true), target: s(30), status: s(20), preview: json, result: json, startedAt: dt, finishedAt: dt, error: txt },
  },
  {
    id: "files",
    label: "Arquivos",
    fields: { ...ctx, name: s(250), mime: s(120), sizeBytes: int, sha256: s(80), storageId: s(120), bucket: s(60), entityType: s(40), entityId: id(), kind: s(40) },
    indexes: [k("i_entity", "entityType", "entityId")],
  },
];

export const COLLECTION_MAP: Record<string, CollectionDef> = Object.fromEntries(COLLECTIONS.map((c) => [c.id, c]));

export type CollectionId = (typeof COLLECTIONS)[number]["id"];

export function getCollection(id: string): CollectionDef {
  const c = COLLECTION_MAP[id];
  if (!c) throw new Error(`Coleção desconhecida: ${id}`);
  return c;
}
