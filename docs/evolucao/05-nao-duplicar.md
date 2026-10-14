# Relatório 5 — O que o Intercert já tem e será reutilizado/ampliado (o que NÃO será criado)

Base: `matriz.json` (176 linhas, 525 recursos GDoor) e conferência no código em 13/10/2026. Para cada área: a estrutura existente que absorve os recursos do GDoor (tabela em `src/lib/db/schema.ts`, serviço em `src/domain/…`, rota em `src/app/(app)/…`, componente) e a lista explícita do que **não** será criado.

Regra: **REUTILIZAR → AMPLIAR → INTEGRAR → CRIAR SOMENTE QUANDO NECESSÁRIO.** Toda mudança de banco é aditiva (campo novo opcional, índice novo ou coleção nova); `scripts/appwrite-setup.ts` já provisiona só por adição — nenhuma migração destrutiva.

---

## 1. Mecanismos transversais que todas as ampliações devem usar

| Necessidade de qualquer recurso novo | Estrutura existente a reutilizar | Não criar |
|---|---|---|
| Liga/desliga por empresa/filial (feature flag) | `settings` + `getSetting/setSetting` (`src/lib/core/settings.ts`), catálogo em `src/app/(app)/administracao/parametros/catalog.ts` (origem empresa/filial, histórico) | Sistema próprio de feature flags ou variável de ambiente por cliente |
| Permissões de novas telas/ações | `MODULES` × CRUD e `SPECIAL_ACTIONS` em `src/lib/permissions.ts`; sincronização de `templateActions` dos perfis padrão (`src/domain/roles.ts`) | Verificações de permissão ad hoc nas páginas |
| Numeração de documentos (orçamento, pedido, carnê) | `counters` + `src/lib/core/numbering.ts` | Contadores em memória ou por consulta de máximo |
| Idempotência e concorrência | ids determinísticos `detId`, `_idem` nos formulários, `operations`, `applyOnce` (`src/domain/stock.ts:358`), sequência única por agregado | Novas estratégias de trava |
| Auditoria e linha do tempo | `audit()` (`src/lib/core/audit.ts`) + `Timeline` (`src/components/ui/timeline.tsx`) | Tabelas de histórico por módulo |
| Avisos e alertas | `notifications` + `src/lib/core/notify.ts` + rotinas `src/domain/routines/*` (cron `/api/jobs`) | Nova central de alertas |
| Tarefas assíncronas e reprocessamento | `jobs` (outbox com reivindicação única) + `src/lib/core/jobs.ts`, `src/domain/jobs/*` | Filas paralelas |
| Integrações externas (boletos, MD-e, TEF, Domínio, iMendes) | `integrations`, `integration_logs`, `/administracao/integracoes/[kind]` (`src/domain/integrations.ts`) | Telas de configuração de integração espalhadas |
| Arquivos (XML, PDF, imagens, anexos) | `files` + `src/lib/core/files.ts` + `GET /api/files/[id]` | Buckets ou rotas de download novas |
| E-mail | `src/lib/core/email.ts` (Resend/Appwrite Messaging) | Cliente SMTP próprio |
| Exportação | `GET /api/export/[key]`, `src/exports/*.ts`, `src/lib/exporters.ts` (mesma consulta da tela) | Segunda consulta para relatório/exportação |
| Listas, filtros, colunas | `DataTable`, `Filters`, `column-config` (`src/components/ui/*`), `paginate` (`src/lib/list.ts`) | Componentes de tabela novos |
| Impressão | páginas `?print=1` (padrão `fiscal/_components/print-page.tsx`, `print-toolbar.tsx`) | Gerador de PDF no servidor (avaliar só em fase própria) |
| Valores monetários e quantidades | centavos/milésimos/pontos-base, `roundDiv`, `allocate` (`src/lib/money.ts`) | Ponto flutuante ou precisão configurável |

---

## 2. Por área

### 2.1 Acesso, empresas, parâmetros
- **Absorve:** PLA-01 (emitente/contador), PLA-02 (usuários e perfis), PLA-20 (integrações), PLA-21 (notificações), PLA-23 (configurações), PLA-03 (verificação de IP), PLA-14 (termos/LGPD).
- **Estruturas:** `companies`, `branches`, `users`, `roles`, `sessions` (campos `ip`/`userAgent` já existem), `settings`, `user_prefs`; serviços `src/domain/companies.ts`, `users.ts`, `roles.ts`; rotas `/administracao/empresas`, `/administracao/usuarios`, `/administracao/parametros`, `/administracao/integracoes`.
- **Ampliar:** `companies.logoFileId` (CAD-07), CRC/CPF do contador em `integrations` kind `accounting` (só se FIS-22 for feito); aceite de termos em `user_prefs` + `audit_logs`; IP permitido como parâmetro.
- **Não criar:** cadastro de contador separado; tela de configurações única "estilo Gdoor" (a configuração distribuída por módulo é decisão vigente — PLA-23 classe C); tabela de licenças/revenda (PLA-15, classe E).

### 2.2 Pessoas (clientes, fornecedores, transportadoras, vendedores)
- **Absorve:** CAD-01, CAD-02, CAD-03, CAD-05, VEN-07, CAD-23.
- **Estruturas:** `customers` (limite de crédito, tabela de preço, vendedor), `suppliers` (campo `category` já existe), `supplier_products`, `users`; `src/domain/customers.ts`, `suppliers.ts`; `/clientes`, `/fornecedores`.
- **Ampliar:** transportadora = fornecedor com `category = "Transportadora"` + seletor no passo Transporte da NF-e (`src/app/(app)/fiscal/nfe/nova/nfe-wizard.tsx`); vendedor externo = usuário com flag "sem acesso ao sistema" e `commissionBps` (campo aditivo em `users`); inadimplência como parâmetro sobre `installments` vencidas.
- **Não criar:** tabela `pessoas` unificada (Gweb) — quebraria `partyType/partyId` de títulos, vendas e documentos fiscais; tabela `carriers`; tabela `sellers`; tabela de convênios (conveniada = cliente; acerto = título a receber).

### 2.3 Catálogo e preços
- **Absorve:** CAD-06…CAD-11, CAD-14, CAD-15, CAD-18, CAD-19, CAD-12, CAD-13, CAD-16, CAD-17, CAD-21, COM-07.
- **Estruturas:** `products`, `skus` (variações), `units`, `unit_conversions`, `categories`, `brands`, `price_tables` (tipo "promo" já existe), `prices` (atacado, vigência, desconto máximo), `price_history`, `product_imports`, `credit_vouchers`; `src/domain/products.ts`, `pricing.ts` (`resolvePrices`, `priceMetrics`, `savePrice`, `recordPriceHistory`), `pricing-calc.ts` (`calcSale`), `product-import.ts`; `/produtos`, `/produtos/[id]`, `/produtos/cadastros`, `/produtos/importar`.
- **Ampliar:** precificação pós-entrada chama `savePrice` (com motivo e `price_history`) em lote; alteração em massa reaproveita o motor de "só atualizar" do `product-import.ts`; promoções leve-X-pague-Y como regra que gera desconto de item explícito dentro de `calcSale`; campos de balança (`plu`, `shelfLifeDays`, `nutrition` json) aditivos em `products`; fidelidade = `credit_vouchers` com `kind = "loyalty"`.
- **Criar (inevitável, justificado):** coleção `product_components` (produto pai, componente SKU, quantidade, tipo kit|composição) — não há estrutura de lista de materiais; uma única coleção serve kits (CAD-12) e composição/montagem (CAD-13).
- **Fase 6 (feito):** promoções como REGRAS de desconto em `promotions` (não guardam preço; o preço continua em `prices`) — `prices.promoRule` não comportava regra por categoria nem vigência independente do reajuste; fidelidade em `credit_vouchers.kind = "loyalty"` (ver `docs/regras-assumidas.md` §30).
- **Não criar:** "tabela de promoções" paralela a `prices`; carteira de pontos; segundo histórico de preços; cadastro de grade separado (variações já existem); "fator de conversão" novo (usar `unit_conversions` e `supplier_products.conversionFactor`).

### 2.4 Estoque
- **Absorve:** EST-01…EST-05, VEN-03 (reserva da pré-venda), CAD-12/13 (baixa de componentes).
- **Estruturas:** `warehouses`, `stock_balances`, `stock_movements` (`lot`, `lotExpiry`, `avgCostAfter`, `balanceAfter`, `seq`), `stock_reservations`, `inventories`, `inventory_counts`; `src/domain/stock.ts` (`postMovements`, `reserve`, `releaseReservations`, `applyOnce`, `adjustStock`), `inventory.ts`; `/estoque`, `/estoque/movimentos`, `/estoque/inventarios`.
- **Ampliar:** saldo por lote derivado de `stock_movements` (consulta/visão por `skuId+lot`), propagação de `lot/lotExpiry` em `confirmReceipt`; relatório de inventário em data-base a partir de `balanceAfter/avgCostAfter`; reservas de pré-venda e de pedido de venda via `reserve()`; bipagem na tela de contagem existente.
- **Não criar:** tabela de saldos por lote independente sem conciliação com movimentos; "balanço" alternativo ao inventário (EST-03 já é mais rigoroso); outra forma de reserva.

### 2.5 Compras e entrada de mercadorias
- **Absorve:** COM-01…COM-11, CAD-17 (etiquetas pós-entrada).
- **Estruturas:** `purchase_orders`, `purchase_order_items`, `quotations`, `quotation_proposals`, `purchase_requests`, `approval_policies`, `receipts` (itens json com alocação, `entryCfop`, `installments`, `effects`), `supplier_products`; `src/domain/purchases.ts`, `quotations.ts`, `approvals.ts`, `replenishment.ts`, `receipts.ts` (`importNfeXml`, `createManualReceipt`, `confirmReceipt`, `fetchXmlByKey`), `nfe-xml.ts`; `/compras/*`.
- **Ampliar:** `createManualReceipt` aceitar entrada sem pedido; `importNfeXml`/conferência com ação "cadastrar produto a partir do item" (buscando antes por GTIN/código do fornecedor); tabela de pares de CFOP em `settings`; gancho opcional de precificação após `confirmReceipt`; MD-e como modo novo em `/compras/recebimentos/novo` usando `integrations` (Focus); devolução a fornecedor com origem `receipt` em `loadOrigin` (`src/domain/fiscal/nfe.ts`).
- **Não criar:** "nota de compra" como entidade separada do recebimento; módulo de devolução de compra; tela de manifestação fora de Compras; cotação nova (COM-02 já supera o GDoor).

### 2.6 Vendas, PDV e caixa
- **Absorve:** PDV-01…PDV-16, VEN-01…VEN-13, FIN-02 (lógica de baixa reaproveitada no PDV).
- **Estruturas:** `carts` (pré-venda), `sales`, `sale_items`, `sale_payments`, `payment_intents`, `returns`, `return_items`, `credit_vouchers`, `cash_sessions`, `cash_movements`, `terminals`, `goals`; `src/domain/carts.ts`, `sales.ts` (`prepareSale`, `finalizeSale`, `applySaleEffects`, `cancelSale`, `processReturn`), `cash.ts` (`addCashMovement`, `sessionSummary`, `closeSession`), `cart-calc.ts`, `pricing-calc.ts`, `supervisor.ts`, `goals.ts`; `/pdv`, `/pdv/pagamento`, `/vendas`, `/caixa`, `/dashboard/metas`.
- **Ampliar:** recebimento de parcela no PDV chamando `finance.settleInstallment` e registrando `cash_movements.type = "receivable"` (tipo novo, aditivo) para entrar no "dinheiro esperado"; importação de orçamento/pedido = criar `cart` a partir do documento (`createCart` + itens) e marcar o documento como faturado na conclusão da venda; `goals.sellerId` aditivo; leitura de código de balança em `product-search.tsx` e `/api/pdv/products`.
- **Criar (inevitável, justificado):** coleções `sales_documents` + `sales_document_items` (um único documento comercial com `stage = quote | order`, validade, saldo a entregar por item, vínculo às vendas/NF-e geradas). Justificativa: `carts` é atendimento de PDV (ligado a terminal, expira por `sales.presaleExpiryHours`, aparece na gaveta de pré-vendas e tem revisão própria) e `sales` é venda concluída com efeitos aplicados — nenhum dos dois representa um compromisso comercial pendente de entrega/faturamento. Cálculo, preço, reserva, venda, título e NF-e continuam nos serviços existentes.
- **Não criar:** baixa de título própria do PDV; segundo cálculo de totais; "DAV"/pré-venda PAF (classe E); app de PDV nativo/offline (PDV-13/15 classe C); tabela de comissões apuradas paralela ao financeiro (comissão apurada vira título a pagar via `finance.createTitle`, origem `commission`; a memória de cálculo por venda/devolução pode ser anexada ao título em `attachments`/`files` ou, se for preciso consultá-la, guardada num campo json aditivo — decidir na fase 5).

### 2.7 Financeiro
- **Absorve:** FIN-01…FIN-26, PLA-27 (modelos de cobrança).
- **Estruturas:** `financial_accounts`, `account_entries`, `payment_methods`, `payment_terms`, `fin_categories` (`parentId`, `dreGroup`), `cost_centers`, `titles`, `installments` (`ourNumber`), `settlements`, `fin_transfers`, `bank_imports`, `bank_transactions`, `reconciliations`; `src/domain/finance.ts` (`createTitle`, `settleInstallment`, `reverseSettlement`, `renegotiate`, `lateChargeParams`, `sendCollectionNotice`, `cardFeeByInstallment`), `cashflow.ts`, `reconciliation.ts`, `src/domain/bank/*` (OFX, CSV, CNAB 240/400); `/financeiro/*`.
- **Ampliar:** boleto = registro da parcela na API bancária (grava `ourNumber`, linha digitável e PDF em `files`) + leitura de retorno já existente; carnê = página de impressão das parcelas do título; taxas de cartão por bandeira/parcelas em `payment_methods` (json aditivo, com *fallback* para `feeBps`); leitor de arquivo da adquirente em `src/domain/bank/`; DRE a partir de `fin_categories.dreGroup` e da competência já calculada em `cashflow.ts`; fechamento de período validado em `postEntry`; hierarquia de centros de custo (`cost_centers.parentId`).
- **Não criar:** coleção `boletos`; "livro caixa" (FIN-18 classe C); plano de contas paralelo; módulo de cheques separado; conciliação de cartões fora de `/financeiro/cartoes` e da importação bancária.

### 2.8 Fiscal
- **Absorve:** FIS-01…FIS-29, PDV-08, PDV-11, PDV-14, VEN-09, COM-08…COM-11.
- **Estruturas:** `fiscal_configs`, `tax_groups`, `fiscal_documents`, `fiscal_events`, `fiscal_obligations`, `fiscal_sim_state`; `src/domain/fiscal/service.ts` (`taxFor`, `defaultCfop`, `buildItems`, `computeTotals`, `validateDocument`, `toProviderPayload`, `transmitDocument`, `correctionLetter`, `disableNumbers`), `nfe.ts` (`loadOrigin`, `buildNfe`, `saveNfe`), `calc.ts`, `providers.ts` (Focus + simulação), `export.ts` (pacote contábil), `obligations.ts`, `reports.ts`; `/fiscal/*`.
- **Ampliar:** `tax_groups` com MVA/ST, alíquotas por UF (json), campos IBS/CBS/IS e cClassTrib (aditivos); resolução por NCM/operação dentro de `taxFor` mantendo o resultado atual como padrão; novas origens em `NfeOriginType` (`sales_document`, `receipt`, `nfce` para CFOP 5929); escrituração de entradas em `fiscal_documents` com campo `issuer = "third_party"` (ausente = emissão própria) e status próprio — uma única tabela de documentos fiscais para livro de entradas e futuros SPED/Sintegra; XML de compras no pacote contábil existente.
- **Não criar:** tabela de "regras de tributação" paralela a `tax_groups`; tabela de documentos de entrada separada; gerador de pacote para contador diferente do `export.ts`; segunda simulação fiscal.

### 2.9 Gestão contábil, certificados e BI
- **Absorve:** CTB-01…CTB-03, FIS-21, FIS-28, PLA-04.
- **Estruturas:** `accounting_clients` e coleções da carteira, `accounting_deliveries`, `certificate_requests`, `accounting_certificates`; `src/domain/accounting/*` (`certificates.ts`, `deliveries.ts`, `link.ts`); `/contabil/*`, `/contabil/certificados`, `/contabil/certificados/nova`, `/contabil/certificados/[id]`, `/administracao/certificacao` (Tela 67, funcional); `/dashboard`, `/relatorios/*`.
- **Ampliar:** integração Domínio (API Onvio) como novo `kind` de integração consumindo o mesmo pacote de `fiscal/export.ts`; relatórios do escritório reaproveitando os dados da carteira.
- **Não criar:** portal do contador separado (Gcontábil); app de BI (Gview) — painel e relatórios web/PWA cobrem.

### 2.10 Relatórios, exportação e impressão
- **Absorve:** PLA-09, PLA-11, FIN-22, FIN-20, EST-05, CAD-17, FIN-06.
- **Estruturas:** `src/domain/reports.ts`, `abc.ts`, `src/exports/*.ts`, `/api/export/[key]`, páginas `?print=1`.
- **Ampliar:** cada relatório novo nasce como função de consulta reutilizada pela tela, pelo CSV e (se aprovado) pelo XLSX.
- **Não criar:** "assistente de relatórios" genérico com SQL livre; gerador de etiquetas fora do padrão de páginas de impressão.

---

## 3. Resumo — estruturas novas estritamente necessárias

| Estrutura nova | Por que não dá para reutilizar | Reuso obrigatório em volta |
|---|---|---|
| `sales_documents` + `sales_document_items` (orçamento/pedido) | Nenhuma entidade representa compromisso comercial pendente; `carts` é atendimento de PDV com expiração e terminal; `sales` já tem efeitos aplicados | `calcSale`, `resolvePrices`, `reserve()`, `createCart`, `finalizeSale`, `createTitle`, `loadOrigin` |
| `product_components` (kits e composição) | Não há lista de materiais | `postMovements`, custo médio, `buildItems` |
| Campo `issuer` em `fiscal_documents` (escrituração de terceiros) | — (ampliação, não tabela nova) | Filtro padrão "emissão própria" em `fiscal/reports.ts`, `export.ts`, jobs `fiscal.transmit/query` e listas |
| Tipo `receivable` em `cash_movements` | — (valor novo de campo existente) | `sessionSummary`/`expectedOf` precisam somá-lo; documentar mudança da fórmula do caixa |

> **Revisão da Fase 0 (inventário `inventario-fiscal-documents.md`):** entradas de mercadoria serão escrituradas evoluindo `receipts` (que já guarda chave, número, série e XML da NF-e de entrada); `fiscal_documents` permanece só com documentos emitidos pela empresa. O campo `issuer` deixa de ser o caminho padrão — 15 leitores agregados (4 de numeração/inutilização) seriam contaminados.


Tudo o mais é **ampliação aditiva** de coleções e serviços existentes ou **integração** pela Central de integrações.
