# Inventário de capacidades → implementação (catálogo 1.0.0)

> Gerado por `npm run modules:inventory` a partir do código (rotas, menu, ações marcadas, recursos, exportações, rotinas).
> Não edite à mão. Testes em `tests/modules-catalog.test.ts` recusam tela, ação, exportação, rotina ou recurso sem módulo.

Legenda de situação: **exists** já existe e está isolado · **shared_screen** usa tela/recurso compartilhado · **needs_confirmation** precisa de confirmação de negócio · **gap** lacuna (não existe; não ativável).


## Plataforma

### `plataforma.acesso` — Autenticação e sessão

Login próprio, autenticação em duas etapas, convite, recuperação de senha, seleção de empresa/filial e segurança da conta.

- **Classe:** platform · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/conta/seguranca` — src/app/(app)/conta/seguranca/page.tsx
  - `/convite/[token]` — src/app/(auth)/convite/[token]/page.tsx
  - `/login/duas-etapas` — src/app/(auth)/login/duas-etapas/page.tsx
  - `/login` — src/app/(auth)/login/page.tsx
  - `/modulo-indisponivel` — src/app/(app)/modulo-indisponivel/page.tsx
  - `/primeiro-acesso` — src/app/(auth)/primeiro-acesso/page.tsx
  - `/recuperar-senha` — src/app/(auth)/recuperar-senha/page.tsx
  - `/redefinir-senha` — src/app/(auth)/redefinir-senha/page.tsx
  - `/selecionar-unidade` — src/app/(auth)/selecionar-unidade/page.tsx
  - `/sem-permissao` — src/app/(app)/sem-permissao/page.tsx
  - `/suporte` — src/app/(auth)/suporte/page.tsx
- **Server actions (gravações):**
  - `confirmTwoFactorSetupAction` — src/app/(app)/conta/seguranca/actions.ts
  - `disableTwoFactorAction` — src/app/(app)/conta/seguranca/actions.ts
  - `regenerateRecoveryCodesAction` — src/app/(app)/conta/seguranca/actions.ts
  - `startTwoFactorSetupAction` — src/app/(app)/conta/seguranca/actions.ts
- **APIs:**
  - `/api/keepalive` — src/app/api/keepalive/route.ts
  - `/api/setup/run` — src/app/api/setup/run/route.ts
  - `/api/unit` — src/app/api/unit/route.ts
- **Páginas públicas:** `/login`, `/convite`, `/recuperar-senha`, `/redefinir-senha`, `/selecionar-unidade`, `/primeiro-acesso`, `/suporte`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `plataforma.administracao` — Administração essencial

Usuários e perfis, empresas e filiais, parâmetros, central de integrações (moldura), histórico e auditoria.

- **Classe:** platform · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/administracao/empresas/[id]/editar` — src/app/(app)/administracao/empresas/[id]/editar/page.tsx
  - `/administracao/empresas/[id]/filiais/nova` — src/app/(app)/administracao/empresas/[id]/filiais/nova/page.tsx
  - `/administracao/empresas/[id]` — src/app/(app)/administracao/empresas/[id]/page.tsx
  - `/administracao/empresas/filiais/[id]` — src/app/(app)/administracao/empresas/filiais/[id]/page.tsx
  - `/administracao/empresas/nova` — src/app/(app)/administracao/empresas/nova/page.tsx
  - `/administracao/empresas` — src/app/(app)/administracao/empresas/page.tsx
  - `/administracao/historico/[id]` — src/app/(app)/administracao/historico/[id]/page.tsx
  - `/administracao/historico` — src/app/(app)/administracao/historico/page.tsx
  - `/administracao/integracoes/[kind]` — src/app/(app)/administracao/integracoes/[kind]/page.tsx
  - `/administracao/integracoes` — src/app/(app)/administracao/integracoes/page.tsx
  - `/administracao/modulos` — src/app/(app)/administracao/modulos/page.tsx
  - `/administracao/parametros` — src/app/(app)/administracao/parametros/page.tsx
  - `/administracao/usuarios/[id]/editar` — src/app/(app)/administracao/usuarios/[id]/editar/page.tsx
  - `/administracao/usuarios/[id]` — src/app/(app)/administracao/usuarios/[id]/page.tsx
  - `/administracao/usuarios/novo` — src/app/(app)/administracao/usuarios/novo/page.tsx
  - `/administracao/usuarios/perfis/[id]` — src/app/(app)/administracao/usuarios/perfis/[id]/page.tsx
  - `/administracao/usuarios/perfis/novo` — src/app/(app)/administracao/usuarios/perfis/novo/page.tsx
  - `/administracao/usuarios/perfis` — src/app/(app)/administracao/usuarios/perfis/page.tsx
  - `/administracao/usuarios` — src/app/(app)/administracao/usuarios/page.tsx
- **Itens de menu:**
  - Administração › Central de integrações (escritório)
  - Administração › Central de integrações (parceiro da rede)
  - Administração › Central de integrações (varejo)
  - Administração › Empresas e filiais (varejo)
  - Administração › Empresas e unidades (escritório)
  - Administração › Empresas e unidades (parceiro da rede)
  - Administração › Histórico e auditoria (escritório)
  - Administração › Histórico e auditoria (parceiro da rede)
  - Administração › Histórico e auditoria (varejo)
  - Administração › Módulos contratados (escritório)
  - Administração › Módulos contratados (varejo)
  - Administração › Parâmetros (escritório)
  - Administração › Parâmetros (parceiro da rede)
  - Administração › Parâmetros (varejo)
  - Administração › Usuários e permissões (escritório)
  - Administração › Usuários e permissões (parceiro da rede)
  - Administração › Usuários e permissões (varejo)
- **Server actions (gravações):**
  - `cancelInviteAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `deleteRoleAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `duplicateRoleAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `requeueJobAction` — src/app/(app)/administracao/integracoes/actions.ts
  - `resendInviteAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `resetTwoFactorAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `runJobsAction` — src/app/(app)/administracao/integracoes/actions.ts
  - `saveBackupScheduleAction` — src/app/(app)/administracao/parametros/actions.ts
  - `saveBranchAction` — src/app/(app)/administracao/empresas/actions.ts
  - `saveCompanyAction` — src/app/(app)/administracao/empresas/actions.ts
  - `saveFiscalIntegrationAction` — src/app/(app)/administracao/integracoes/actions.ts
  - `saveIntegrationAction` — src/app/(app)/administracao/integracoes/actions.ts
  - `saveParametersAction` — src/app/(app)/administracao/parametros/actions.ts
  - `saveRoleAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `saveWarehouseAction` — src/app/(app)/administracao/empresas/actions.ts
  - `setBranchStatusAction` — src/app/(app)/administracao/empresas/actions.ts
  - `setCompanyStatusAction` — src/app/(app)/administracao/empresas/actions.ts
  - `setCompanyUsersAction` — src/app/(app)/administracao/empresas/actions.ts
  - `setDefaultWarehouseAction` — src/app/(app)/administracao/empresas/actions.ts
  - `setPasswordAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `setUserStatusAction` — src/app/(app)/administracao/usuarios/actions.ts
  - `setWarehouseStatusAction` — src/app/(app)/administracao/empresas/actions.ts
  - `testIntegrationAction` — src/app/(app)/administracao/integracoes/actions.ts
  - `unlinkCredentialAction` — src/app/(app)/administracao/integracoes/actions.ts
- **APIs:**
  - `/api/export/[key]` — src/app/api/export/[key]/route.ts
  - `/api/interos/v1/catalog` — src/app/api/interos/v1/catalog/route.ts
  - `/api/interos/v1/companies/[companyId]/modules/apply` — src/app/api/interos/v1/companies/[companyId]/modules/apply/route.ts
  - `/api/interos/v1/companies/[companyId]/modules/baseline` — src/app/api/interos/v1/companies/[companyId]/modules/baseline/route.ts
  - `/api/interos/v1/companies/[companyId]/modules/history` — src/app/api/interos/v1/companies/[companyId]/modules/history/route.ts
  - `/api/interos/v1/companies/[companyId]/modules/simulate` — src/app/api/interos/v1/companies/[companyId]/modules/simulate/route.ts
  - `/api/interos/v1/companies/[companyId]/modules` — src/app/api/interos/v1/companies/[companyId]/modules/route.ts
  - `/api/interos/v1/companies` — src/app/api/interos/v1/companies/route.ts
  - `/api/interos/v1/operations/[operationId]/cancel` — src/app/api/interos/v1/operations/[operationId]/cancel/route.ts
  - `/api/interos/v1/operations/[operationId]` — src/app/api/interos/v1/operations/[operationId]/route.ts
  - `/api/interos/v2/catalog/[code]` — src/app/api/interos/v2/catalog/[code]/route.ts
  - `/api/interos/v2/catalog` — src/app/api/interos/v2/catalog/route.ts
  - `/api/interos/v2/companies/[companyId]/license/history` — src/app/api/interos/v2/companies/[companyId]/license/history/route.ts
  - `/api/interos/v2/companies/[companyId]/license/simulate` — src/app/api/interos/v2/companies/[companyId]/license/simulate/route.ts
  - `/api/interos/v2/companies/[companyId]/license` — src/app/api/interos/v2/companies/[companyId]/license/route.ts
  - `/api/interos/v2/companies/[companyId]/sync` — src/app/api/interos/v2/companies/[companyId]/sync/route.ts
  - `/api/interos/v2/companies/[companyId]/usage` — src/app/api/interos/v2/companies/[companyId]/usage/route.ts
  - `/api/interos/v2/companies` — src/app/api/interos/v2/companies/route.ts
  - `/api/interos/v2/errors` — src/app/api/interos/v2/errors/route.ts
  - `/api/interos/v2/upsell-requests` — src/app/api/interos/v2/upsell-requests/route.ts
- **Exportações:** `admin.users`, `admin.roles`, `admin.audit`, `admin.companies`, `admin.branches`, `integration-logs`
- **Tarefas duráveis (fila):** `interos.event`
- **Rotinas diárias:** `admin.roles`, `modules.maintenance`, `licenses.maintenance`, `interos.reconcile`
- **Permissões de perfil:** `admin.users`, `admin.integrations`, `data.export`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `plataforma.backup` — Backup e restauração

Cópias agendadas, restauração e retenção. Obrigatório: proteção dos dados da empresa.

- **Classe:** platform · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/administracao/backups/[id]/download` — src/app/(app)/administracao/backups/[id]/download/route.ts
  - `/administracao/backups/[id]` — src/app/(app)/administracao/backups/[id]/page.tsx
  - `/administracao/backups` — src/app/(app)/administracao/backups/page.tsx
- **Itens de menu:**
  - Administração › Backup e restauração (escritório)
  - Administração › Backup e restauração (parceiro da rede)
  - Administração › Backup e restauração (varejo)
- **Server actions (gravações):**
  - `applyRetentionAction` — src/app/(app)/administracao/backups/actions.ts
  - `createBackupAction` — src/app/(app)/administracao/backups/actions.ts
  - `restoreAction` — src/app/(app)/administracao/backups/actions.ts
  - `verifyBackupAction` — src/app/(app)/administracao/backups/actions.ts
- **Exportações:** `admin.backups`
- **Tarefas duráveis (fila):** `admin.backup.scheduled`, `admin.restore.run`
- **Rotinas diárias:** `admin.backup`
- **Permissões de perfil:** `admin.backup`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `plataforma.painel` — Painel, notificações e suporte

Painel do gestor (cartões condicionados aos módulos habilitados), central de notificações, ajuda e chamados.

- **Classe:** platform · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/ajuda/artigos/[slug]` — src/app/(app)/ajuda/artigos/[slug]/page.tsx
  - `/ajuda/chamados/[id]` — src/app/(app)/ajuda/chamados/[id]/page.tsx
  - `/ajuda/chamados/novo` — src/app/(app)/ajuda/chamados/novo/page.tsx
  - `/ajuda/chamados` — src/app/(app)/ajuda/chamados/page.tsx
  - `/ajuda` — src/app/(app)/ajuda/page.tsx
  - `/dashboard` — src/app/(app)/dashboard/page.tsx
  - `/notificacoes` — src/app/(app)/notificacoes/page.tsx
- **Itens de menu:**
  - Gestão › Painel do gestor (varejo)
  - Suporte › Ajuda e suporte (escritório)
  - Suporte › Ajuda e suporte (parceiro da rede)
  - Suporte › Ajuda e suporte (varejo)
  - Suporte › Notificações (escritório)
  - Suporte › Notificações (parceiro da rede)
  - Suporte › Notificações (varejo)
- **Server actions (gravações):**
  - `archiveAction` — src/app/(app)/notificacoes/actions.ts
  - `createTicketAction` — src/app/(app)/ajuda/chamados/actions.ts
  - `markAction` — src/app/(app)/notificacoes/actions.ts
  - `replyTicketAction` — src/app/(app)/ajuda/chamados/actions.ts
  - `requestUpsellAction` — src/app/(app)/modulo-indisponivel/actions.ts
  - `savePrefsAction` — src/app/(app)/notificacoes/actions.ts
  - `setTicketStatusAction` — src/app/(app)/ajuda/chamados/actions.ts
  - `unarchiveAction` — src/app/(app)/notificacoes/actions.ts
  - `updateTicketAction` — src/app/(app)/ajuda/chamados/actions.ts
- **APIs:**
  - `/api/jobs` — src/app/api/jobs/route.ts
  - `/api/search` — src/app/api/search/route.ts
- **Exportações:** `notifications`, `support.tickets`
- **Permissões de perfil:** `support.manage`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `plataforma.arquivos` — Arquivos e documentos

Download de XML, anexos e cópias com conferência de empresa e permissão. Continua disponível para documentos históricos de módulos desligados.

- **Classe:** platform · **Disponibilidade:** available · **Situação no repositório:** exists
- **APIs:**
  - `/api/files/[id]` — src/app/api/files/[id]/route.ts
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

## Componentes técnicos

### `tec.estoque` — Motor de estoque

Saldos, movimentos, reservas, custo médio e depósitos (src/domain/stock.ts, warehouses.ts). Usado por PDV, loja, compras e estoque.

- **Classe:** technical · **Disponibilidade:** available · **Situação no repositório:** exists
- **Tarefas duráveis (fila):** `sale.effects`, `sale.cancel.effects`, `return.effects`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `tec.financeiro` — Motor financeiro

Contas (caixa/banco), lançamentos, títulos e baixas, meios e condições de pagamento (src/domain/finance.ts). Recebe as vendas, compras e repasses mesmo sem as telas financeiras contratadas.

- **Classe:** technical · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/financeiro/cadastros` — src/app/(app)/financeiro/cadastros/page.tsx
  - `/financeiro/contas/[id]` — src/app/(app)/financeiro/contas/[id]/page.tsx
  - `/financeiro` — src/app/(app)/financeiro/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Cadastros financeiros (escritório)
  - Financeiro › Cadastros financeiros (parceiro da rede)
  - Financeiro › Cadastros financeiros (varejo)
- **Server actions (gravações):**
  - `changeInitialBalanceAction` — src/app/(app)/financeiro/actions.ts
  - `rebuildBalancesAction` — src/app/(app)/financeiro/actions.ts
  - `saveAccountAction` — src/app/(app)/financeiro/actions.ts
  - `saveCategoryAction` — src/app/(app)/financeiro/actions.ts
  - `saveCostCenterAction` — src/app/(app)/financeiro/actions.ts
  - `saveFinanceParamsAction` — src/app/(app)/financeiro/actions.ts
  - `savePaymentMethodAction` — src/app/(app)/financeiro/actions.ts
  - `savePaymentTermAction` — src/app/(app)/financeiro/actions.ts
  - `setActiveAction` — src/app/(app)/financeiro/actions.ts
- **Exportações:** `fin-account-entries`
- **Tarefas duráveis (fila):** `finance.account.rebuild`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `tec.fiscal` — Motor fiscal

Configuração fiscal, emitente, certificado, numeração, grupos tributários, provedor (Focus NFe/simulação), transmissão, consulta, cancelamento, obrigações e relatórios fiscais.

- **Classe:** technical · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/fiscal/configuracoes` — src/app/(app)/fiscal/configuracoes/page.tsx
  - `/fiscal/relatorios` — src/app/(app)/fiscal/relatorios/page.tsx
  - `/fiscal` — src/app/(app)/fiscal/page.tsx
- **Itens de menu:**
  - Fiscal (serviços do escritório) › Configurações fiscais (escritório)
  - Fiscal (serviços do escritório) › Relatórios fiscais (escritório)
  - Fiscal (serviços) › Configurações fiscais (parceiro da rede)
  - Fiscal (serviços) › Relatórios fiscais (parceiro da rede)
  - Fiscal › Configurações fiscais (varejo)
  - Fiscal › Relatórios fiscais (varejo)
- **Server actions (gravações):**
  - `batchRetransmitAction` — src/app/(app)/fiscal/actions.ts
  - `cancelAction` — src/app/(app)/fiscal/actions.ts
  - `cceAction` — src/app/(app)/fiscal/actions.ts
  - `completeObligationAction` — src/app/(app)/fiscal/actions.ts
  - `deleteObligationAction` — src/app/(app)/fiscal/actions.ts
  - `deleteTaxGroupAction` — src/app/(app)/fiscal/actions.ts
  - `disableAction` — src/app/(app)/fiscal/actions.ts
  - `emailAction` — src/app/(app)/fiscal/actions.ts
  - `generateObligationsAction` — src/app/(app)/fiscal/actions.ts
  - `generatePackageAction` — src/app/(app)/fiscal/actions.ts
  - `obligationStatusAction` — src/app/(app)/fiscal/actions.ts
  - `queryAction` — src/app/(app)/fiscal/actions.ts
  - `refreshAction` — src/app/(app)/fiscal/actions.ts
  - `refreshFiscalAction` — src/app/(app)/vendas/actions.ts
  - `retransmitAction` — src/app/(app)/fiscal/actions.ts
  - `saveConfigAction` — src/app/(app)/fiscal/actions.ts
  - `saveIssuerAction` — src/app/(app)/fiscal/actions.ts
  - `saveObligationAction` — src/app/(app)/fiscal/actions.ts
  - `saveScheduleAction` — src/app/(app)/fiscal/actions.ts
  - `saveTaxGroupAction` — src/app/(app)/fiscal/actions.ts
  - `saveTemplatesAction` — src/app/(app)/fiscal/actions.ts
  - `searchSkusAction` — src/app/(app)/fiscal/actions.ts
  - `setNumberAction` — src/app/(app)/fiscal/actions.ts
  - `testConnectionAction` — src/app/(app)/fiscal/actions.ts
  - `toggleContingencyAction` — src/app/(app)/fiscal/actions.ts
  - `transmitAction` — src/app/(app)/fiscal/actions.ts
  - `uploadCertificateAction` — src/app/(app)/fiscal/actions.ts
- **Exportações:** `fiscal-documentos`, `fiscal-livro-saidas`, `fiscal-ncm`, `fiscal-cfop`, `fiscal-servicos`, `fiscal-cancelamentos`, `fiscal-rejeicoes`, `fiscal-obrigacoes`
- **Tarefas duráveis (fila):** `fiscal.transmit`, `fiscal.query`, `fiscal.cancel`, `fiscal.email`
- **Rotinas diárias:** `fiscal.obligations`, `fiscal.certificate`, `fiscal.stuck`
- **Permissões de perfil:** `fiscal.configure`, `fiscal.cancel`
- **Ao desligar:** immediate; depois: consulta histórica. Documentos em processamento continuam sendo transmitidos/consultados até a resposta da SEFAZ. Cancelamento e CC-e de documentos autorizados continuam dentro do prazo legal. Prazos de obrigações e validade do certificado continuam avisados.

### `tec.precos` — Motor de preços

Tabelas de preço por filial e vigência, atacado e cálculo de totais e rateio (pricing.ts, pricing-calc.ts).

- **Classe:** technical · **Disponibilidade:** available · **Situação no repositório:** exists
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

### `tec.pagamentos` — Intenções de pagamento (Pix)

Contrato de Pix (Mercado Pago e simulação) e intenções de pagamento usadas pelo PDV (src/domain/payments).

- **Classe:** technical · **Disponibilidade:** available · **Situação no repositório:** exists
- **APIs:**
  - `/api/pdv/intents/[id]` — src/app/api/pdv/intents/[id]/route.ts
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

## Cadastros

### `cadastros.produtos` — Produtos e serviços

Cadastro de produtos, variações, preços, custos, parâmetros de estoque, conversões, cadastros auxiliares e importação de produtos por planilha.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/produtos/[id]` — src/app/(app)/produtos/[id]/page.tsx
  - `/produtos/cadastros` — src/app/(app)/produtos/cadastros/page.tsx
  - `/produtos/importar/[id]` — src/app/(app)/produtos/importar/[id]/page.tsx
  - `/produtos/importar` — src/app/(app)/produtos/importar/page.tsx
  - `/produtos/novo` — src/app/(app)/produtos/novo/page.tsx
  - `/produtos` — src/app/(app)/produtos/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Cadastros auxiliares (varejo)
  - Produtos e estoque › Produtos e serviços (varejo)
- **Server actions (gravações):**
  - `analyzeCsvAction` — src/app/(app)/produtos/actions.ts
  - `createProductAction` — src/app/(app)/produtos/actions.ts
  - `deleteAuxAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `deleteConversionAction` — src/app/(app)/produtos/actions.ts
  - `deletePriceAction` — src/app/(app)/produtos/actions.ts
  - `deleteProductAction` — src/app/(app)/produtos/actions.ts
  - `initialBalanceAction` — src/app/(app)/produtos/actions.ts
  - `previewImportAction` — src/app/(app)/produtos/actions.ts
  - `removeImageAction` — src/app/(app)/produtos/actions.ts
  - `removeVariantAction` — src/app/(app)/produtos/actions.ts
  - `runImportAction` — src/app/(app)/produtos/actions.ts
  - `saveBrandAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `saveCategoryAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `saveConversionAction` — src/app/(app)/produtos/actions.ts
  - `saveCostsAction` — src/app/(app)/produtos/actions.ts
  - `savePriceAction` — src/app/(app)/produtos/actions.ts
  - `savePriceTableAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `saveProductReformAction` — src/app/(app)/produtos/actions.ts
  - `saveStockParamsAction` — src/app/(app)/produtos/actions.ts
  - `saveTaxGroupAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `saveUnitAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `saveVariantsAction` — src/app/(app)/produtos/actions.ts
  - `setAuxStatusAction` — src/app/(app)/produtos/cadastros/actions.ts
  - `setProductStatusAction` — src/app/(app)/produtos/actions.ts
  - `updateProductAction` — src/app/(app)/produtos/actions.ts
  - `uploadImageAction` — src/app/(app)/produtos/actions.ts
- **Exportações:** `products`
- **Dados (evidência de uso na linha de base):** tabela `products`
- **Ao desligar:** immediate; depois: consulta histórica. Produtos continuam sendo lidos por PDV, loja, compras e notas já emitidas.

### `produtos.alteracao_massa` — Alteração de produtos em massa

Reajuste de preços e alteração de categoria, marca, NCM, grupo tributário e situação de vários produtos com prévia.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `cadastros.produtos`
- **Observação do levantamento:** Isolado: só a tela /produtos/alteracao-em-massa e product-bulk.ts; a precificação após a entrada usa price-adjust.ts/receipt-pricing.ts, não a alteração em massa.
- **Telas e rotas:**
  - `/produtos/alteracao-em-massa` — src/app/(app)/produtos/alteracao-em-massa/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Alteração em massa (varejo) · exige products.bulk_edit · recurso alteracaoMassa
- **Server actions (gravações):**
  - `applyBulkFieldAction` — src/app/(app)/produtos/alteracao-em-massa/actions.ts
  - `applyBulkPriceAction` — src/app/(app)/produtos/alteracao-em-massa/actions.ts
  - `previewBulkFieldAction` — src/app/(app)/produtos/alteracao-em-massa/actions.ts
  - `previewBulkPriceAction` — src/app/(app)/produtos/alteracao-em-massa/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("alteracaoMassa") — src/app/(app)/produtos/alteracao-em-massa/actions.ts
  - requireFeaturePage("alteracaoMassa") — src/app/(app)/produtos/alteracao-em-massa/page.tsx
- **Recursos de Parâmetros:** `alteracaoMassa`
- **Permissões de perfil:** `products.bulk_edit`
- **Ao desligar:** immediate; depois: oculto.

### `produtos.etiquetas` — Etiquetas de produtos

Etiquetas de gôndola e adesivas com preço e código de barras, inclusive a partir de um recebimento.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `cadastros.produtos`
- **Telas e rotas:**
  - `/produtos/etiquetas` — src/app/(app)/produtos/etiquetas/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Etiquetas de produtos (varejo) · recurso etiquetas
- **Server actions (gravações):**
  - `searchLabelSkusAction` — src/app/(app)/produtos/etiquetas/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("etiquetas") — src/app/(app)/compras/recebimentos/[id]/precificacao/page.tsx
  - featureOn("etiquetas") — src/app/(app)/compras/recebimentos/[id]/receipt-shortcuts.tsx
  - requireFeature("etiquetas") — src/app/(app)/produtos/etiquetas/actions.ts
  - requireFeaturePage("etiquetas") — src/app/(app)/produtos/etiquetas/page.tsx
- **Recursos de Parâmetros:** `etiquetas`
- **Ao desligar:** immediate; depois: oculto.

### `produtos.balanca` — Balança etiquetadora

Código de peso/valor no PDV, aba Balança no produto e carga de PLU.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `cadastros.produtos`
- **Telas e rotas:**
  - `/produtos/balanca` — src/app/(app)/produtos/balanca/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Balança (carga e PLU) (varejo) · recurso balanca
- **Server actions (gravações):**
  - `generateScaleLoadAction` — src/app/(app)/produtos/balanca/actions.ts
  - `saveScaleDataAction` — src/app/(app)/produtos/balanca/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("balanca") — src/app/(app)/produtos/[id]/page.tsx
  - requireFeature("balanca") — src/app/(app)/produtos/balanca/actions.ts
  - requireFeaturePage("balanca") — src/app/(app)/produtos/balanca/page.tsx
- **Recursos de Parâmetros:** `balanca`
- **Pontos dentro de outras telas:** Produto › aba Balança; PDV › leitura EAN-13 iniciado por 2
- **Ao desligar:** immediate; depois: oculto.

### `produtos.promocoes` — Promoções

Promoções por período, leve-pague e preço promocional aplicadas no PDV.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `cadastros.produtos`
- **Telas e rotas:**
  - `/produtos/promocoes` — src/app/(app)/produtos/promocoes/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Promoções (varejo) · recurso promocoes
- **Server actions (gravações):**
  - `savePromotionAction` — src/app/(app)/produtos/promocoes/actions.ts
  - `setPromotionActiveAction` — src/app/(app)/produtos/promocoes/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("promocoes") — src/app/(app)/produtos/promocoes/actions.ts
  - requireFeaturePage("promocoes") — src/app/(app)/produtos/promocoes/page.tsx
- **Recursos de Parâmetros:** `promocoes`
- **Ao desligar:** immediate; depois: consulta histórica. Vendas já concluídas mantêm o desconto registrado.

### `produtos.kits` — Kits e composição

Componentes do produto, venda de kit com baixa dos componentes e montagem/desmembramento.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `cadastros.produtos`
- **Telas e rotas:**
  - `/estoque/montagem` — src/app/(app)/estoque/montagem/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Montagem e desmembramento (varejo) · recurso kits
- **Server actions (gravações):**
  - `removeComponentAction` — src/app/(app)/produtos/actions.ts
  - `runAssemblyAction` — src/app/(app)/estoque/actions.ts
  - `saveComponentAction` — src/app/(app)/produtos/actions.ts
  - `searchComponentSkusAction` — src/app/(app)/produtos/actions.ts
  - `setCompositionAction` — src/app/(app)/produtos/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("kits") — src/app/(app)/produtos/[id]/page.tsx
  - requireFeaturePage("kits") — src/app/(app)/estoque/montagem/page.tsx
- **Recursos de Parâmetros:** `kits`
- **Pontos dentro de outras telas:** Produto › aba Componentes
- **Ao desligar:** immediate; depois: consulta histórica. Cancelamento e devolução de vendas de kit anteriores continuam estornando os componentes.

### `cadastros.clientes` — Gestão de clientes

Cadastro de clientes (identidade única por CPF/CNPJ), ficha, limite de crédito e histórico.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/clientes/[id]/editar` — src/app/(app)/clientes/[id]/editar/page.tsx
  - `/clientes/[id]` — src/app/(app)/clientes/[id]/page.tsx
  - `/clientes/novo` — src/app/(app)/clientes/novo/page.tsx
  - `/clientes` — src/app/(app)/clientes/page.tsx
- **Itens de menu:**
  - Clientes › Gestão de clientes (varejo)
- **Server actions (gravações):**
  - `checkDocAction` — src/app/(app)/clientes/actions.ts
  - `deleteCustomerAction` — src/app/(app)/clientes/actions.ts
  - `lookupCnpjAction` — src/app/(app)/clientes/actions.ts
  - `quickCustomerAction` — src/app/(app)/clientes/actions.ts
  - `saveCustomerAction` — src/app/(app)/clientes/actions.ts
  - `setCustomerStatusAction` — src/app/(app)/clientes/actions.ts
- **Exportações:** `customers`
- **Permissões de perfil:** `customer.credit_limit`
- **Dados (evidência de uso na linha de base):** tabela `customers`
- **Ao desligar:** immediate; depois: consulta histórica. Clientes continuam identificáveis no PDV, na loja e nas notas (identidade compartilhada).

### `clientes.fidelidade` — Programa de fidelidade

Pontos por compra e resgate no PDV.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `cadastros.clientes`
- **Telas e rotas:**
  - `/clientes/fidelidade` — src/app/(app)/clientes/fidelidade/page.tsx
- **Itens de menu:**
  - Clientes › Programa de fidelidade (varejo) · recurso fidelidade
- **Abas, botões e telas condicionados a recurso:**
  - requireFeaturePage("fidelidade") — src/app/(app)/clientes/fidelidade/page.tsx
- **Recursos de Parâmetros:** `fidelidade`
- **Ao desligar:** immediate; depois: consulta histórica. Saldo de pontos preservado; resgate bloqueado enquanto desligado.

### `cadastros.fornecedores` — Fornecedores

Cadastro de fornecedores, contatos e condições.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/fornecedores/[id]/editar` — src/app/(app)/fornecedores/[id]/editar/page.tsx
  - `/fornecedores/[id]` — src/app/(app)/fornecedores/[id]/page.tsx
  - `/fornecedores/novo` — src/app/(app)/fornecedores/novo/page.tsx
  - `/fornecedores` — src/app/(app)/fornecedores/page.tsx
- **Itens de menu:**
  - Compras › Fornecedores (varejo)
- **Server actions (gravações):**
  - `deleteSupplierAction` — src/app/(app)/fornecedores/actions.ts
  - `lookupSupplierCnpjAction` — src/app/(app)/fornecedores/actions.ts
  - `removeSupplierProductAction` — src/app/(app)/fornecedores/actions.ts
  - `saveSupplierAction` — src/app/(app)/fornecedores/actions.ts
  - `saveSupplierProductAction` — src/app/(app)/fornecedores/actions.ts
  - `setSupplierStatusAction` — src/app/(app)/fornecedores/actions.ts
- **Exportações:** `suppliers`
- **Dados (evidência de uso na linha de base):** tabela `suppliers`
- **Ao desligar:** immediate; depois: consulta histórica.

## Vendas e caixa

### `caixa.operacao` — Caixa

Abertura, suprimento, sangria, fechamento (cego ou não), reabertura e relatório do caixa.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/caixa/[id]/relatorio` — src/app/(app)/caixa/[id]/relatorio/page.tsx
  - `/caixa/[id]` — src/app/(app)/caixa/[id]/page.tsx
  - `/caixa/abertura` — src/app/(app)/caixa/abertura/page.tsx
  - `/caixa/fechamento` — src/app/(app)/caixa/fechamento/page.tsx
  - `/caixa/movimentos/[id]/comprovante` — src/app/(app)/caixa/movimentos/[id]/comprovante/page.tsx
  - `/caixa/movimentos` — src/app/(app)/caixa/movimentos/page.tsx
  - `/caixa` — src/app/(app)/caixa/page.tsx
- **Itens de menu:**
  - Vendas e caixa › Caixa (abertura, movimentos, fechamento) (varejo)
- **Server actions (gravações):**
  - `addMovementAction` — src/app/(app)/caixa/actions.ts
  - `closeSessionAction` — src/app/(app)/caixa/actions.ts
  - `openSessionAction` — src/app/(app)/caixa/actions.ts
  - `previewCloseAction` — src/app/(app)/caixa/actions.ts
  - `reopenSessionAction` — src/app/(app)/caixa/actions.ts
  - `retryCloseTransferAction` — src/app/(app)/caixa/actions.ts
- **Exportações:** `cash_sessions`, `cash_movements`
- **Permissões de perfil:** `cash.reopen`, `cash.withdrawal`
- **Dados (evidência de uso na linha de base):** tabela `cash_sessions`
- **Ao desligar:** drain (pendências: `cash.open_sessions`); depois: consulta histórica. Caixas abertos podem ser fechados (com sangria/suprimento) até a conclusão; nenhum caixa novo abre.

### `vendas.pdv` — Frente de caixa (PDV)

Atendimento no PDV, pré-venda, troca, pagamento (dinheiro, cartão, Pix, vale), terminais e histórico de vendas.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/administracao/terminais/[id]/teste-impressao` — src/app/(app)/administracao/terminais/[id]/teste-impressao/page.tsx
  - `/administracao/terminais/[id]` — src/app/(app)/administracao/terminais/[id]/page.tsx
  - `/administracao/terminais/novo` — src/app/(app)/administracao/terminais/novo/page.tsx
  - `/administracao/terminais` — src/app/(app)/administracao/terminais/page.tsx
  - `/pdv/pagamento` — src/app/(app)/pdv/pagamento/page.tsx
  - `/pdv` — src/app/(app)/pdv/page.tsx
  - `/vendas/[id]/conclusao` — src/app/(app)/vendas/[id]/conclusao/page.tsx
  - `/vendas/[id]/recibo` — src/app/(app)/vendas/[id]/recibo/page.tsx
  - `/vendas/[id]` — src/app/(app)/vendas/[id]/page.tsx
  - `/vendas` — src/app/(app)/vendas/page.tsx
- **Itens de menu:**
  - Administração › Terminais do PDV (varejo)
  - Vendas e caixa › Frente de caixa (PDV) (varejo)
  - Vendas e caixa › Histórico de vendas (varejo)
- **Server actions (gravações):**
  - `cancelCartAction` — src/app/(app)/pdv/actions.ts
  - `cancelPixAction` — src/app/(app)/pdv/actions.ts
  - `cancelSaleAction` — src/app/(app)/vendas/actions.ts
  - `createPixAction` — src/app/(app)/pdv/actions.ts
  - `finalizeCartAction` — src/app/(app)/pdv/actions.ts
  - `parkCartAction` — src/app/(app)/pdv/actions.ts
  - `recordBrowserConnectorAction` — src/app/(app)/administracao/terminais/actions.ts
  - `recordNoConnectorAction` — src/app/(app)/administracao/terminais/actions.ts
  - `recordPrintPageAction` — src/app/(app)/administracao/terminais/actions.ts
  - `removeCartItemAction` — src/app/(app)/pdv/actions.ts
  - `resumeCartAction` — src/app/(app)/pdv/actions.ts
  - `saveCartAction` — src/app/(app)/pdv/actions.ts
  - `saveTerminalAction` — src/app/(app)/administracao/terminais/actions.ts
  - `sendReceiptAction` — src/app/(app)/vendas/actions.ts
  - `setTerminalStatusAction` — src/app/(app)/administracao/terminais/actions.ts
  - `simulatePixAction` — src/app/(app)/pdv/actions.ts
- **APIs:**
  - `/api/pdv/customers` — src/app/api/pdv/customers/route.ts
  - `/api/pdv/products` — src/app/api/pdv/products/route.ts
  - `/api/pdv/vouchers` — src/app/api/pdv/vouchers/route.ts
- **Exportações:** `sales`, `admin.terminals`
- **Permissões de perfil:** `sale.cancel`, `sale.discount_over_limit`, `sale.overdue_override`, `pdv.remove_item`, `pdv.cancel_cart`
- **Dados (evidência de uso na linha de base):** tabela `sales`
- **Ao desligar:** drain (pendências: `pdv.parked_carts`, `pdv.pending_pix`); depois: consulta histórica. Histórico de vendas, recibos e segunda via continuam em consulta. Pix pendentes podem ser confirmados ou cancelados.

### `vendas.devolucoes` — Trocas e devoluções

Devolução/troca de vendas com vale-crédito ou estorno, limite de valor e autorização.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `vendas.pdv`
- **Telas e rotas:**
  - `/vendas/[id]/devolucoes` — src/app/(app)/vendas/[id]/devolucoes/page.tsx
  - `/vendas/devolucoes/[id]` — src/app/(app)/vendas/devolucoes/[id]/page.tsx
  - `/vendas/devolucoes` — src/app/(app)/vendas/devolucoes/page.tsx
- **Itens de menu:**
  - Vendas e caixa › Trocas e devoluções (varejo)
- **Server actions (gravações):**
  - `confirmCardReversalAction` — src/app/(app)/vendas/actions.ts
  - `processReturnAction` — src/app/(app)/vendas/actions.ts
  - `startExchangeAction` — src/app/(app)/pdv/actions.ts
- **Exportações:** `returns`
- **Permissões de perfil:** `sale.return`, `sale.return_over_limit`
- **Pontos dentro de outras telas:** Venda › Devoluções
- **Dados (evidência de uso na linha de base):** tabela `returns`
- **Ao desligar:** drain; depois: consulta histórica. Devoluções de vendas feitas ANTES do desligamento continuam aceitas por 90 dias (CDC: prazo de reclamação de vício em bens duráveis).

### `pdv.recebimento_crediario` — Recebimento de parcelas no PDV

Receber parcelas do crediário no caixa aberto (F9), com estorno.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `vendas.pdv`
- **Telas e rotas:**
  - `/caixa/recebimentos/[id]` — src/app/(app)/caixa/recebimentos/[id]/page.tsx
- **Server actions (gravações):**
  - `pdvOpenInstallmentsAction` — src/app/(app)/pdv/actions.ts
  - `pdvReceiveInstallmentsAction` — src/app/(app)/pdv/actions.ts
  - `pdvReverseReceiptAction` — src/app/(app)/pdv/actions.ts
  - `pdvSessionReceiptsAction` — src/app/(app)/pdv/actions.ts
- **Recursos de Parâmetros:** `recebimentoPdv`
- **Permissões de perfil:** `pdv.receive_installments`, `pdv.reverse_receipt`
- **Pontos dentro de outras telas:** PDV › Receber parcelas (F9)
- **Ao desligar:** immediate; depois: consulta histórica. Recebimentos já registrados continuam no caixa e no fechamento.

### `pdv.reserva_prevenda` — Reserva de estoque na pré-venda

Reserva os itens físicos ao salvar a pré-venda (F6); consumida na conclusão e liberada no cancelamento ou expiração.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `vendas.pdv`
- **Rotinas diárias:** `sales.presale_reservations`
- **Recursos de Parâmetros:** `reservaPreVenda`
- **Ao desligar:** drain (pendências: `pdv.presale_reservations`); depois: oculto. Reservas existentes são consumidas ou liberadas pela rotina de expiração.

### `vendas.documentos` — Orçamentos e pedidos de venda

Orçamento com validade e envio, pedido com reserva de estoque, faturamento parcial no PDV ou em NF-e e link público do documento.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/documento/[token]` — src/app/documento/[token]/page.tsx
  - `/vendas/orcamentos/[id]/imprimir` — src/app/(app)/vendas/orcamentos/[id]/imprimir/page.tsx
  - `/vendas/orcamentos/[id]` — src/app/(app)/vendas/orcamentos/[id]/page.tsx
  - `/vendas/orcamentos/novo` — src/app/(app)/vendas/orcamentos/novo/page.tsx
  - `/vendas/orcamentos` — src/app/(app)/vendas/orcamentos/page.tsx
  - `/vendas/pedidos/[id]/imprimir` — src/app/(app)/vendas/pedidos/[id]/imprimir/page.tsx
  - `/vendas/pedidos/[id]` — src/app/(app)/vendas/pedidos/[id]/page.tsx
  - `/vendas/pedidos/novo` — src/app/(app)/vendas/pedidos/novo/page.tsx
  - `/vendas/pedidos` — src/app/(app)/vendas/pedidos/page.tsx
- **Itens de menu:**
  - Vendas e caixa › Orçamentos (varejo) · recurso documentoComercial
  - Vendas e caixa › Pedidos de venda (varejo) · recurso documentoComercial
- **Server actions (gravações):**
  - `approveQuoteAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `billableDocumentsAction` — src/app/(app)/pdv/actions.ts
  - `cancelOrderAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `convertToOrderAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `documentLinesAction` — src/app/(app)/pdv/actions.ts
  - `duplicateDocumentAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `emailSendAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `importDocumentAction` — src/app/(app)/pdv/actions.ts
  - `markPrintedAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `rejectQuoteAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `renewReservationAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `saveDocumentAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `searchDocSkusAction` — src/app/(app)/vendas/_documentos/actions.ts
  - `whatsappSendAction` — src/app/(app)/vendas/_documentos/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("documentoComercial") — src/app/(app)/vendas/_documentos/detail-page.tsx
  - requireFeature("documentoComercial") — src/app/(app)/vendas/_documentos/actions.ts
  - requireFeaturePage("documentoComercial") — src/app/(app)/vendas/_documentos/detail-page.tsx
  - requireFeaturePage("documentoComercial") — src/app/(app)/vendas/_documentos/list-page.tsx
  - requireFeaturePage("documentoComercial") — src/app/(app)/vendas/_documentos/new-page.tsx
  - requireFeaturePage("documentoComercial") — src/app/(app)/vendas/_documentos/print-page.tsx
- **Páginas públicas:** `/documento`
- **Rotinas diárias:** `sales.documents_expire`
- **Recursos de Parâmetros:** `documentoComercial`
- **Permissões de perfil:** `sales_doc.quote`, `sales_doc.order`, `sales_doc.cancel`
- **Dados (evidência de uso na linha de base):** tabela `sales_documents`
- **Ao desligar:** drain (pendências: `sales_doc.open_orders`); depois: consulta histórica. Pedidos com reserva podem ser faturados ou cancelados; a rotina de expiração libera as reservas.

### `vendas.comissoes` — Vendedores e comissões

Cadastro de vendedores, percentuais, apuração, fechamento e reabertura de comissões.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/vendas/comissoes` — src/app/(app)/vendas/comissoes/page.tsx
  - `/vendas/vendedores` — src/app/(app)/vendas/vendedores/page.tsx
- **Itens de menu:**
  - Vendas e caixa › Comissões (varejo) · exige sales.commissions · recurso comissoes
  - Vendas e caixa › Vendedores (varejo)
- **Server actions (gravações):**
  - `closeCommissionAction` — src/app/(app)/vendas/comissoes/actions.ts
  - `reopenCommissionAction` — src/app/(app)/vendas/comissoes/actions.ts
  - `saveSellerAction` — src/app/(app)/vendas/vendedores/actions.ts
  - `setSellerActiveAction` — src/app/(app)/vendas/vendedores/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("comissoes") — src/app/(app)/vendas/vendedores/page.tsx
  - requireFeature("comissoes") — src/app/(app)/vendas/comissoes/actions.ts
  - requireFeaturePage("comissoes") — src/app/(app)/vendas/comissoes/page.tsx
- **Exportações:** `sales-commissions`
- **Recursos de Parâmetros:** `comissoes`
- **Permissões de perfil:** `sales.commissions`
- **Dados (evidência de uso na linha de base):** tabela `titles` com [["eq","originType","commission"]]
- **Ao desligar:** immediate; depois: consulta histórica. Fechamentos de comissão já feitos ficam em consulta.

### `vendas.pdv_offline` — PDV em contingência offline

Operação do PDV sem internet. O PWA hoje só mostra a página de sem conexão.

- **Classe:** optional_function · **Disponibilidade:** planned · **Situação no repositório:** gap · **Pai:** `vendas.pdv`
- **Ao desligar:** immediate; depois: consulta histórica.

## Comércio digital

### `ecommerce.loja` — Loja virtual

Loja própria: modelos, identidade, domínio, catálogo digital, vitrine pública, carrinho, checkout com gateway, pedidos on-line, frete, expedição, retirada e monitor de integrações.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/comercio-digital/catalogo` — src/app/(app)/comercio-digital/catalogo/page.tsx
  - `/comercio-digital/editor` — src/app/(app)/comercio-digital/editor/page.tsx
  - `/comercio-digital/expedicao` — src/app/(app)/comercio-digital/expedicao/page.tsx
  - `/comercio-digital/frete` — src/app/(app)/comercio-digital/frete/page.tsx
  - `/comercio-digital/modelos` — src/app/(app)/comercio-digital/modelos/page.tsx
  - `/comercio-digital/monitor` — src/app/(app)/comercio-digital/monitor/page.tsx
  - `/comercio-digital/pagamentos` — src/app/(app)/comercio-digital/pagamentos/page.tsx
  - `/comercio-digital/pedidos/[id]` — src/app/(app)/comercio-digital/pedidos/[id]/page.tsx
  - `/comercio-digital/pedidos` — src/app/(app)/comercio-digital/pedidos/page.tsx
  - `/comercio-digital/ver-loja` — src/app/(app)/comercio-digital/ver-loja/route.ts
  - `/comercio-digital` — src/app/(app)/comercio-digital/page.tsx
  - `/loja/[store]/carrinho` — src/app/loja/[store]/carrinho/page.tsx
  - `/loja/[store]/checkout` — src/app/loja/[store]/checkout/page.tsx
  - `/loja/[store]/imagem/[id]` — src/app/loja/[store]/imagem/[id]/route.ts
  - `/loja/[store]/pagina/[slug]` — src/app/loja/[store]/pagina/[slug]/page.tsx
  - `/loja/[store]/pedido/[token]` — src/app/loja/[store]/pedido/[token]/page.tsx
  - `/loja/[store]/produto/[slug]` — src/app/loja/[store]/produto/[slug]/page.tsx
  - `/loja/[store]/robots.txt` — src/app/loja/[store]/robots.txt/route.ts
  - `/loja/[store]/sitemap.xml` — src/app/loja/[store]/sitemap.xml/route.ts
  - `/loja/[store]` — src/app/loja/[store]/page.tsx
- **Itens de menu:**
  - Comércio digital › Catálogo digital (varejo) · exige ecommerce.catalog · recurso comercioDigital
  - Comércio digital › Central de comércio digital (varejo) · recurso comercioDigital
  - Comércio digital › Editor e domínio (varejo) · exige ecommerce.manage · recurso comercioDigital
  - Comércio digital › Expedição e rastreio (varejo) · exige ecommerce.orders · recurso comercioDigital
  - Comércio digital › Frete e logística (varejo) · exige ecommerce.manage · recurso comercioDigital
  - Comércio digital › Gateway e checkout (varejo) · exige ecommerce.manage · recurso comercioDigital
  - Comércio digital › Modelos da loja (varejo) · exige ecommerce.manage · recurso comercioDigital
  - Comércio digital › Monitor de integrações (varejo) · exige ecommerce.manage · recurso comercioDigital
  - Comércio digital › Pedidos on-line (varejo) · exige ecommerce.orders · recurso comercioDigital
  - Comércio digital › Ver loja pública (varejo) · recurso comercioDigital
- **Server actions (gravações):**
  - `addDomainAction` — src/app/(app)/comercio-digital/actions.ts
  - `addToCatalogAction` — src/app/(app)/comercio-digital/actions.ts
  - `applyTemplateAction` — src/app/(app)/comercio-digital/actions.ts
  - `cancelOrderAction` — src/app/(app)/comercio-digital/actions.ts
  - `completeReturnAction` — src/app/(app)/comercio-digital/actions.ts
  - `confirmDeliveryAction` — src/app/(app)/comercio-digital/actions.ts
  - `confirmPickingAction` — src/app/(app)/comercio-digital/actions.ts
  - `confirmPickupAction` — src/app/(app)/comercio-digital/actions.ts
  - `createStoreAction` — src/app/(app)/comercio-digital/actions.ts
  - `dismissEventAction` — src/app/(app)/comercio-digital/actions.ts
  - `dispatchOrderAction` — src/app/(app)/comercio-digital/actions.ts
  - `generateLabelAction` — src/app/(app)/comercio-digital/actions.ts
  - `invoiceOrderAction` — src/app/(app)/comercio-digital/actions.ts
  - `pauseStoreAction` — src/app/(app)/comercio-digital/actions.ts
  - `publishStoreAction` — src/app/(app)/comercio-digital/actions.ts
  - `removeDomainAction` — src/app/(app)/comercio-digital/actions.ts
  - `removeListingImageAction` — src/app/(app)/comercio-digital/actions.ts
  - `removeThemeImageAction` — src/app/(app)/comercio-digital/actions.ts
  - `reprocessEventAction` — src/app/(app)/comercio-digital/actions.ts
  - `restoreDefaultPagesAction` — src/app/(app)/comercio-digital/actions.ts
  - `retryChargeAction` — src/app/(app)/comercio-digital/actions.ts
  - `saveCheckoutAction` — src/app/(app)/comercio-digital/actions.ts
  - `saveIdentityAction` — src/app/(app)/comercio-digital/actions.ts
  - `saveLegalContactAction` — src/app/(app)/comercio-digital/actions.ts
  - `saveListingAction` — src/app/(app)/comercio-digital/actions.ts
  - `savePagesAction` — src/app/(app)/comercio-digital/actions.ts
  - `savePaymentsAction` — src/app/(app)/comercio-digital/actions.ts
  - `saveShippingAction` — src/app/(app)/comercio-digital/actions.ts
  - `setPresenceAction` — src/app/(app)/comercio-digital/actions.ts
  - `setPrimaryDomainAction` — src/app/(app)/comercio-digital/actions.ts
  - `simulateEventAction` — src/app/(app)/comercio-digital/actions.ts
  - `uploadListingImageAction` — src/app/(app)/comercio-digital/actions.ts
  - `uploadThemeImageAction` — src/app/(app)/comercio-digital/actions.ts
  - `validateSelectionAction` — src/app/(app)/comercio-digital/actions.ts
  - `verifyDomainAction` — src/app/(app)/comercio-digital/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("comercioDigital") — src/app/(app)/comercio-digital/actions.ts
  - requireFeaturePage("comercioDigital") — src/app/(app)/comercio-digital/_lib.ts
- **APIs:**
  - `/api/loja/gateway/[provider]/[storeId]` — src/app/api/loja/gateway/[provider]/[storeId]/route.ts
- **Páginas públicas:** `/loja`
- **Rotinas diárias:** `ecommerce.expire`
- **Avisos de terceiros (webhooks):** `/api/loja/gateway`
- **Recursos de Parâmetros:** `comercioDigital`
- **Permissões de perfil:** `ecommerce.manage`, `ecommerce.catalog`, `ecommerce.orders`, `ecommerce.cancel`
- **Dados (evidência de uso na linha de base):** tabela `stores`
- **Ao desligar:** drain (pendências: `ecommerce.open_orders`); depois: consulta histórica. A vitrine deixa de aceitar pedidos novos na hora (página de loja indisponível); o acompanhamento do pedido pelo cliente continua. Pedidos pagos seguem para nota, separação, expedição e entrega; avisos do gateway continuam processados. Arrependimento (7 dias, CDC art. 49) e devoluções de pedidos anteriores continuam aceitos durante a conclusão. Pedidos pendentes expiram pela rotina e liberam as reservas.

### `ecommerce.promocoes` — Cupons e recuperação de carrinhos

Cupons da loja e rascunhos de recuperação de carrinho abandonado.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `ecommerce.loja`
- **Telas e rotas:**
  - `/comercio-digital/promocoes` — src/app/(app)/comercio-digital/promocoes/page.tsx
- **Itens de menu:**
  - Comércio digital › Promoções e carrinhos (varejo) · exige ecommerce.marketing · recurso comercioDigital
- **Server actions (gravações):**
  - `saveCouponAction` — src/app/(app)/comercio-digital/actions.ts
  - `saveRecoveryDraftAction` — src/app/(app)/comercio-digital/actions.ts
  - `setCouponActiveAction` — src/app/(app)/comercio-digital/actions.ts
- **Permissões de perfil:** `ecommerce.marketing`
- **Dados (evidência de uso na linha de base):** tabela `store_coupons`
- **Ao desligar:** immediate; depois: consulta histórica. Cupons já aplicados em pedidos são preservados.

### `ecommerce.banco` — Banco Intercert e repasses

Conciliação dos recebimentos do gateway (bruto, taxa, líquido), conta de liquidação e repasses.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `ecommerce.loja`
- **Telas e rotas:**
  - `/comercio-digital/banco` — src/app/(app)/comercio-digital/banco/page.tsx
- **Itens de menu:**
  - Comércio digital › Banco Intercert e repasses (varejo) · exige ecommerce.finance · recurso comercioDigital
- **Server actions (gravações):**
  - `preparePayoutAction` — src/app/(app)/comercio-digital/actions.ts
  - `reconcileAction` — src/app/(app)/comercio-digital/actions.ts
  - `setSettlementAccountAction` — src/app/(app)/comercio-digital/actions.ts
  - `simulateCreditsAction` — src/app/(app)/comercio-digital/actions.ts
- **Permissões de perfil:** `ecommerce.finance`
- **Dados (evidência de uso na linha de base):** tabela `store_payouts`
- **Ao desligar:** drain (pendências: `ecommerce.pending_payouts`); depois: consulta histórica. Repasses solicitados e créditos a conciliar continuam até a liquidação.

### `ecommerce.canais` — Canais de venda (marketplaces e redes)

Contas preparadas em marketplaces, redes sociais e descoberta. Hoje só PREPARA a conta (sem integração ativa de pedidos).

- **Classe:** optional_function · **Disponibilidade:** needs_confirmation · **Situação no repositório:** needs_confirmation · **Pai:** `ecommerce.loja`
- **Observação do levantamento:** src/domain/ecommerce/channels.ts registra contas 'preparadas'; não há sincronização de pedidos com marketplace — contratar como módulo só depois da integração real (lacuna).
- **Telas e rotas:**
  - `/comercio-digital/canais` — src/app/(app)/comercio-digital/canais/page.tsx
- **Itens de menu:**
  - Comércio digital › Canais e contas (varejo) · exige ecommerce.manage · recurso comercioDigital
- **Server actions (gravações):**
  - `prepareChannelAction` — src/app/(app)/comercio-digital/actions.ts
- **Dados (evidência de uso na linha de base):** tabela `store_channels`
- **Ao desligar:** immediate; depois: consulta histórica.

### `ecommerce.marketplaces` — Integração de pedidos com marketplaces

Importação de pedidos e sincronização de estoque com marketplaces. Hoje só há contas preparadas.

- **Classe:** optional_function · **Disponibilidade:** planned · **Situação no repositório:** gap · **Pai:** `ecommerce.loja`
- **Ao desligar:** immediate; depois: consulta histórica.

## Estoque

### `estoque.gestao` — Saldos e movimentação de estoque

Consulta de saldos por depósito, movimentos, ajustes e cadastro de depósitos.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/estoque/movimentos` — src/app/(app)/estoque/movimentos/page.tsx
  - `/estoque/transferencias/depositos` — src/app/(app)/estoque/transferencias/depositos/page.tsx
  - `/estoque` — src/app/(app)/estoque/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Movimentação de estoque (varejo)
  - Produtos e estoque › Saldos de estoque (varejo)
- **Server actions (gravações):**
  - `adjustStockAction` — src/app/(app)/estoque/actions.ts
  - `searchSkusAction` — src/app/(app)/estoque/actions.ts
  - `skuBalanceAction` — src/app/(app)/estoque/actions.ts
  - `skuLotsAction` — src/app/(app)/estoque/actions.ts
- **Exportações:** `stock-balances`, `stock-movements`
- **Permissões de perfil:** `stock.adjust`, `stock.warehouses`
- **Ao desligar:** immediate; depois: consulta histórica. O motor de estoque continua baixando vendas e recebimentos (saldos preservados).

### `estoque.transferencias` — Transferências entre depósitos e filiais

Transferência com separação, expedição, recebimento, divergência e documento fiscal.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `estoque.gestao`
- **Telas e rotas:**
  - `/estoque/transferencias/[id]/editar` — src/app/(app)/estoque/transferencias/[id]/editar/page.tsx
  - `/estoque/transferencias/[id]` — src/app/(app)/estoque/transferencias/[id]/page.tsx
  - `/estoque/transferencias/novo` — src/app/(app)/estoque/transferencias/novo/page.tsx
  - `/estoque/transferencias` — src/app/(app)/estoque/transferencias/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Transferências (varejo)
- **Server actions (gravações):**
  - `cancelTransferAction` — src/app/(app)/estoque/actions.ts
  - `receiveTransferAction` — src/app/(app)/estoque/actions.ts
  - `resolveTransferAction` — src/app/(app)/estoque/actions.ts
  - `saveTransferAction` — src/app/(app)/estoque/actions.ts
  - `separateTransferAction` — src/app/(app)/estoque/actions.ts
  - `setTransferDocumentAction` — src/app/(app)/estoque/actions.ts
  - `shipTransferAction` — src/app/(app)/estoque/actions.ts
  - `warehouseTransferAction` — src/app/(app)/estoque/actions.ts
- **Exportações:** `transfers`
- **Rotinas diárias:** `stock.transfers_overdue`
- **Dados (evidência de uso na linha de base):** tabela `transfers`
- **Ao desligar:** drain (pendências: `stock.transfers_in_transit`); depois: consulta histórica. Mercadoria em trânsito precisa ser recebida ou cancelada (saldo em trânsito).

### `estoque.inventario` — Inventário e contagem

Inventário com folha de contagem (inclusive bipagem), conclusão com ajuste e retomada.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `estoque.gestao`
- **Telas e rotas:**
  - `/estoque/inventarios/[id]` — src/app/(app)/estoque/inventarios/[id]/page.tsx
  - `/estoque/inventarios` — src/app/(app)/estoque/inventarios/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Inventário e contagem (varejo)
- **Server actions (gravações):**
  - `addInventoryItemAction` — src/app/(app)/estoque/actions.ts
  - `cancelInventoryAction` — src/app/(app)/estoque/actions.ts
  - `concludeInventoryAction` — src/app/(app)/estoque/actions.ts
  - `createInventoryAction` — src/app/(app)/estoque/actions.ts
  - `resumeInventoryAction` — src/app/(app)/estoque/actions.ts
  - `saveCountsAction` — src/app/(app)/estoque/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("bipagemContagem") — src/app/(app)/estoque/inventarios/[id]/page.tsx
- **Exportações:** `inventories`, `inventory-items`
- **Rotinas diárias:** `stock.inventories_stale`
- **Recursos de Parâmetros:** `bipagemContagem`
- **Permissões de perfil:** `stock.inventory_close`
- **Dados (evidência de uso na linha de base):** tabela `inventories`
- **Ao desligar:** drain (pendências: `stock.open_inventories`); depois: consulta histórica. Inventários abertos congelam o saldo contado: precisam ser concluídos ou cancelados.

### `estoque.lotes` — Lotes e validades

Saldo por lote, FEFO na venda, lote no recebimento, relatório de validades e alerta diário.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `estoque.gestao`
- **Telas e rotas:**
  - `/estoque/validades` — src/app/(app)/estoque/validades/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Validades e lotes (varejo) · recurso lotes
- **Server actions (gravações):**
  - `setLotControlAction` — src/app/(app)/produtos/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("lotes") — src/app/(app)/estoque/inventarios/[id]/page.tsx
  - requireFeaturePage("lotes") — src/app/(app)/estoque/validades/page.tsx
- **APIs:**
  - `/api/pdv/lots` — src/app/api/pdv/lots/route.ts
- **Rotinas diárias:** `stock.lot_expiry`
- **Recursos de Parâmetros:** `lotes`
- **Pontos dentro de outras telas:** Produto › Controla lote e validade; Recebimento › lote na conferência; PDV › escolha do lote
- **Dados (evidência de uso na linha de base):** tabela `products` com [["eq","lotControl",true]]
- **Ao desligar:** scheduled (pendências: `stock.lot_controlled_products`); depois: consulta histórica. Enquanto houver produto com controle de lote ligado, o desligamento fica agendado: o saldo por lote é integridade do estoque (PDV, recebimento e transferência dependem dele). Desligue o controle nos produtos (ou o recurso em Parâmetros) e o módulo desliga sozinho.

### `estoque.inventario_fiscal` — Inventário em data-base

Saldo de cada produto por depósito numa data passada, valorizado pelo custo médio, com totais por NCM.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `estoque.gestao`
- **Telas e rotas:**
  - `/estoque/inventario-fiscal` — src/app/(app)/estoque/inventario-fiscal/page.tsx
- **Itens de menu:**
  - Produtos e estoque › Inventário em data-base (varejo) · recurso inventarioFiscal
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("inventarioFiscal") — src/exports/stock.ts
  - requireFeaturePage("inventarioFiscal") — src/app/(app)/estoque/inventario-fiscal/page.tsx
- **Exportações:** `stock-fiscal-inventory`
- **Recursos de Parâmetros:** `inventarioFiscal`
- **Ao desligar:** immediate; depois: oculto.

## Compras

### `compras.reposicao` — Planejamento de reposição

Sugestão de compra pela cobertura em dias e histórico de vendas.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/compras/reposicao/[skuId]` — src/app/(app)/compras/reposicao/[skuId]/page.tsx
  - `/compras/reposicao` — src/app/(app)/compras/reposicao/page.tsx
- **Itens de menu:**
  - Compras › Planejamento de reposição (varejo)
- **Exportações:** `replenishment`
- **Ao desligar:** immediate; depois: consulta histórica.

### `compras.pedidos` — Pedidos de compra

Pedido de compra com revisão, envio ao fornecedor e acompanhamento de entrega.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/compras/pedidos/[id]/editar` — src/app/(app)/compras/pedidos/[id]/editar/page.tsx
  - `/compras/pedidos/[id]` — src/app/(app)/compras/pedidos/[id]/page.tsx
  - `/compras/pedidos/novo` — src/app/(app)/compras/pedidos/novo/page.tsx
  - `/compras/pedidos` — src/app/(app)/compras/pedidos/page.tsx
- **Itens de menu:**
  - Compras › Pedidos de compra (varejo)
- **Server actions (gravações):**
  - `cancelOrderAction` — src/app/(app)/compras/pedidos/actions.ts
  - `closeBalanceAction` — src/app/(app)/compras/pedidos/actions.ts
  - `createDraftsAction` — src/app/(app)/compras/reposicao/actions.ts
  - `registerSentAction` — src/app/(app)/compras/pedidos/actions.ts
  - `registerTransitAction` — src/app/(app)/compras/pedidos/actions.ts
  - `saveOrderAction` — src/app/(app)/compras/pedidos/actions.ts
  - `searchSkusAction` — src/app/(app)/compras/_shared/actions.ts
  - `submitOrderAction` — src/app/(app)/compras/pedidos/actions.ts
  - `suggestionsForSupplierAction` — src/app/(app)/compras/pedidos/actions.ts
  - `supplierCostsAction` — src/app/(app)/compras/_shared/actions.ts
- **Exportações:** `purchase_orders`
- **Rotinas diárias:** `purchases.followup`
- **Dados (evidência de uso na linha de base):** tabela `purchase_orders`
- **Ao desligar:** drain (pendências: `purchase.open_orders`); depois: consulta histórica. Pedidos já enviados ao fornecedor podem ser recebidos ou cancelados.

### `compras.cotacoes` — Cotações de compra

Cotação com vários fornecedores, mapa comparativo, seleção por item e geração do pedido.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Observação do levantamento:** A cotação termina gerando pedido(s) de compra: dependência real de compras.pedidos. Compras sem cotação é suportado (pedido direto).
- **Telas e rotas:**
  - `/compras/cotacoes/[id]` — src/app/(app)/compras/cotacoes/[id]/page.tsx
  - `/compras/cotacoes/nova` — src/app/(app)/compras/cotacoes/nova/page.tsx
  - `/compras/cotacoes` — src/app/(app)/compras/cotacoes/page.tsx
- **Itens de menu:**
  - Compras › Cotações (varejo)
- **Server actions (gravações):**
  - `cancelQuotationAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `generateOrdersAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `importCsvAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `quotationFromFormAction` — src/app/(app)/compras/pedidos/actions.ts
  - `quotationFromReplenishmentAction` — src/app/(app)/compras/reposicao/actions.ts
  - `removeProposalAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `saveProposalAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `saveQuotationAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `searchSkusAction` — src/app/(app)/compras/_shared/actions.ts
  - `selectionAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `suggestAction` — src/app/(app)/compras/cotacoes/actions.ts
  - `supplierCostsAction` — src/app/(app)/compras/_shared/actions.ts
- **Exportações:** `quotations`
- **Dados (evidência de uso na linha de base):** tabela `quotations`
- **Ao desligar:** immediate; depois: consulta histórica. Cotações concluídas e pedidos gerados ficam em consulta.

### `compras.aprovacoes` — Aprovação de compras

Política de alçadas, solicitação de compra com etapas, aprovação, reprovação e orçamento mensal.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/compras/aprovacoes/[id]` — src/app/(app)/compras/aprovacoes/[id]/page.tsx
  - `/compras/aprovacoes/politica` — src/app/(app)/compras/aprovacoes/politica/page.tsx
  - `/compras/aprovacoes` — src/app/(app)/compras/aprovacoes/page.tsx
- **Itens de menu:**
  - Compras › Aprovação de compras (varejo)
- **Server actions (gravações):**
  - `decideAction` — src/app/(app)/compras/aprovacoes/actions.ts
  - `revokeAction` — src/app/(app)/compras/aprovacoes/actions.ts
  - `savePolicyAction` — src/app/(app)/compras/aprovacoes/actions.ts
- **Exportações:** `purchase_requests`
- **Permissões de perfil:** `purchase.approve`
- **Dados (evidência de uso na linha de base):** tabela `purchase_requests`
- **Ao desligar:** drain (pendências: `purchase.pending_approvals`); depois: consulta histórica. Solicitações em análise precisam ser decididas. Sem o módulo (desligado ou em desligamento), o envio do pedido é aprovado automaticamente e registrado na solicitação ('Sem etapa de aprovação') — sem isso o pedido ficaria parado sem tela para aprovar.

### `compras.recebimento` — Recebimento de mercadorias

Entrada por XML/chave ou manual, conferência, entrada no estoque, contas a pagar, conversão de CFOP e devolução a fornecedor.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/compras/recebimentos/[id]` — src/app/(app)/compras/recebimentos/[id]/page.tsx
  - `/compras/recebimentos/novo` — src/app/(app)/compras/recebimentos/novo/page.tsx
  - `/compras/recebimentos` — src/app/(app)/compras/recebimentos/page.tsx
- **Itens de menu:**
  - Compras › Recebimento de mercadorias (varejo)
- **Server actions (gravações):**
  - `cancelReceiptAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `createProductsFromReceiptAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `fetchByKeyAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `importXmlAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `manualReceiptAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `resumeConfirmAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `saveReceiptAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `searchSkusAction` — src/app/(app)/compras/_shared/actions.ts
  - `supplierCostsAction` — src/app/(app)/compras/_shared/actions.ts
- **Exportações:** `receipts`
- **Recursos de Parâmetros:** `entradaSemPedido`, `conversorCfop`, `devolucaoFornecedor`
- **Permissões de perfil:** `purchase.receive`
- **Dados (evidência de uso na linha de base):** tabela `receipts`
- **Ao desligar:** drain (pendências: `purchase.receipts_in_progress`); depois: consulta histórica. Recebimentos em conferência podem ser concluídos ou cancelados.

### `compras.nota_a_confirmar` — Entrada com nota a confirmar

Mercadoria que chega antes da nota: entrada provisória, conta a pagar provisória e confirmação com a nota.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `compras.recebimento`
- **Telas e rotas:**
  - `/compras/aguardando-nota` — src/app/(app)/compras/aguardando-nota/page.tsx
- **Itens de menu:**
  - Compras › Compras aguardando nota (varejo) · recurso notaAConfirmar
- **Server actions (gravações):**
  - `cancelScheduledAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `invoiceConfirmAction` — src/app/(app)/compras/recebimentos/actions.ts
  - `pendingInvoiceEntryAction` — src/app/(app)/compras/recebimentos/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("notaAConfirmar") — src/app/(app)/compras/recebimentos/novo/page.tsx
  - featureOn("notaAConfirmar") — src/app/(app)/compras/recebimentos/page.tsx
  - featureOn("notaAConfirmar") — src/app/(app)/dashboard/page.tsx
  - requireFeature("notaAConfirmar") — src/app/(app)/compras/recebimentos/actions.ts
  - requireFeaturePage("notaAConfirmar") — src/app/(app)/compras/aguardando-nota/page.tsx
- **Exportações:** `purchase-pending-invoices`
- **Rotinas diárias:** `purchases.pending_invoice`
- **Recursos de Parâmetros:** `notaAConfirmar`
- **Permissões de perfil:** `purchase.receive_pending_invoice`, `purchase.confirm_invoice`
- **Ao desligar:** drain (pendências: `purchase.pending_invoices`); depois: consulta histórica. Entradas aguardando nota precisam ser confirmadas com a nota do fornecedor.

### `compras.cte` — CT-e de frete (entrada)

Importa o CT-e da transportadora e rateia o frete no custo dos recebimentos.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `compras.recebimento`
- **Telas e rotas:**
  - `/compras/cte/[id]` — src/app/(app)/compras/cte/[id]/page.tsx
  - `/compras/cte` — src/app/(app)/compras/cte/page.tsx
- **Itens de menu:**
  - Compras › CT-e de frete (entrada) (varejo) · recurso cteEntrada
- **Server actions (gravações):**
  - `importCteAction` — src/app/(app)/compras/cte/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("cteEntrada") — src/app/(app)/fiscal/entradas/page.tsx
  - requireFeature("cteEntrada") — src/app/(app)/compras/cte/actions.ts
  - requireFeaturePage("cteEntrada") — src/app/(app)/compras/cte/page.tsx
- **Recursos de Parâmetros:** `cteEntrada`
- **Ao desligar:** immediate; depois: consulta histórica.

### `compras.precificacao` — Precificação após a entrada

Sugere o novo preço de venda a partir do custo do recebimento, com prévia.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `compras.recebimento`
- **Telas e rotas:**
  - `/compras/precificacao` — src/app/(app)/compras/precificacao/page.tsx
  - `/compras/recebimentos/[id]/precificacao` — src/app/(app)/compras/recebimentos/[id]/precificacao/page.tsx
- **Itens de menu:**
  - Compras › Precificação após a entrada (varejo) · exige purchase.pricing · recurso precificacaoEntrada
- **Server actions (gravações):**
  - `applyReceiptPricingAction` — src/app/(app)/compras/recebimentos/[id]/precificacao/actions.ts
  - `previewReceiptPricingAction` — src/app/(app)/compras/recebimentos/[id]/precificacao/actions.ts
  - `suggestReceiptPricingAction` — src/app/(app)/compras/recebimentos/[id]/precificacao/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("precificacaoEntrada") — src/app/(app)/compras/recebimentos/[id]/receipt-shortcuts.tsx
  - requireFeature("precificacaoEntrada") — src/app/(app)/compras/recebimentos/[id]/precificacao/actions.ts
  - requireFeaturePage("precificacaoEntrada") — src/app/(app)/compras/precificacao/page.tsx
  - requireFeaturePage("precificacaoEntrada") — src/app/(app)/compras/recebimentos/[id]/precificacao/page.tsx
- **Recursos de Parâmetros:** `precificacaoEntrada`
- **Permissões de perfil:** `purchase.pricing`
- **Ao desligar:** immediate; depois: oculto.

## Financeiro

### `financeiro.contas_receber` — Contas a receber

Títulos a receber, parcelas, baixa, estorno, renegociação, recibo e aviso de vencimento.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/financeiro/receber/[id]/recibo` — src/app/(app)/financeiro/receber/[id]/recibo/page.tsx
  - `/financeiro/receber/[id]` — src/app/(app)/financeiro/receber/[id]/page.tsx
  - `/financeiro/receber/novo` — src/app/(app)/financeiro/receber/novo/page.tsx
  - `/financeiro/receber` — src/app/(app)/financeiro/receber/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Contas a receber (escritório)
  - Financeiro › Contas a receber (parceiro da rede)
  - Financeiro › Contas a receber (varejo)
- **Server actions (gravações):**
  - `cancelTitleAction` — src/app/(app)/financeiro/actions.ts
  - `createTitleAction` — src/app/(app)/financeiro/actions.ts
  - `previewBatchSettleAction` — src/app/(app)/financeiro/actions.ts
  - `renegotiateAction` — src/app/(app)/financeiro/actions.ts
  - `reverseSettlementAction` — src/app/(app)/financeiro/actions.ts
  - `sendNoticeAction` — src/app/(app)/financeiro/actions.ts
  - `settleAction` — src/app/(app)/financeiro/actions.ts
  - `settleBatchAction` — src/app/(app)/financeiro/actions.ts
  - `undoRenegotiationAction` — src/app/(app)/financeiro/actions.ts
  - `updateInstallmentAction` — src/app/(app)/financeiro/actions.ts
  - `updateTitleAction` — src/app/(app)/financeiro/actions.ts
  - `uploadAttachmentAction` — src/app/(app)/financeiro/actions.ts
- **Exportações:** `fin-receivables`
- **Rotinas diárias:** `finance.due`
- **Permissões de perfil:** `finance.settle`, `finance.reverse`
- **Dados (evidência de uso na linha de base):** tabela `titles` com [["eq","kind","receivable"]]
- **Ao desligar:** drain (pendências: `finance.open_receivables`); depois: consulta histórica. Títulos em aberto continuam podendo ser baixados (recebimento é direito da empresa e obrigação do cliente); nenhum título novo é lançado manualmente.

### `financeiro.inadimplencia` — Alerta e bloqueio de inadimplentes

Política de aviso/bloqueio de venda para cliente em atraso e aviso diário.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `financeiro.contas_receber`
- **Rotinas diárias:** `finance.delinquency`
- **Recursos de Parâmetros:** `inadimplencia`
- **Ao desligar:** immediate; depois: oculto.

### `financeiro.cobranca_whatsapp` — Cobrança pelo WhatsApp

Modelos de mensagem e botão 'Cobrar no WhatsApp' nas parcelas.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `financeiro.contas_receber`
- **Telas e rotas:**
  - `/financeiro/cobranca/modelos` — src/app/(app)/financeiro/cobranca/modelos/page.tsx
- **Itens de menu:**
  - Financeiro › Modelos de cobrança (varejo) · recurso cobrancaWhatsapp
- **Server actions (gravações):**
  - `registerWhatsappCollectionAction` — src/app/(app)/financeiro/cobranca/actions.ts
  - `saveCollectionTemplatesAction` — src/app/(app)/financeiro/cobranca/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("cobrancaWhatsapp") — src/app/(app)/financeiro/cobranca/actions.ts
  - requireFeaturePage("cobrancaWhatsapp") — src/app/(app)/financeiro/cobranca/modelos/page.tsx
- **Recursos de Parâmetros:** `cobrancaWhatsapp`
- **Ao desligar:** immediate; depois: oculto.

### `financeiro.carne` — Impressão de carnê

Carnê com uma lâmina por parcela.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `financeiro.contas_receber`
- **Telas e rotas:**
  - `/financeiro/receber/[id]/carne` — src/app/(app)/financeiro/receber/[id]/carne/page.tsx
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("carne") — src/app/(app)/financeiro/_components/title-detail.tsx
  - featureOn("carne") — src/app/(app)/financeiro/_components/titles-list.tsx
  - featureOn("carne") — src/app/(app)/financeiro/receber/[id]/carne/page.tsx
  - featureOn("carne") — src/app/(app)/vendas/[id]/conclusao/page.tsx
  - featureOn("carne") — src/app/(app)/vendas/[id]/page.tsx
- **Recursos de Parâmetros:** `carne`
- **Ao desligar:** immediate; depois: oculto.

### `financeiro.contas_pagar` — Contas a pagar

Títulos a pagar, autorização, baixa, estorno e recibo.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/financeiro/pagar/[id]/recibo` — src/app/(app)/financeiro/pagar/[id]/recibo/page.tsx
  - `/financeiro/pagar/[id]` — src/app/(app)/financeiro/pagar/[id]/page.tsx
  - `/financeiro/pagar/novo` — src/app/(app)/financeiro/pagar/novo/page.tsx
  - `/financeiro/pagar` — src/app/(app)/financeiro/pagar/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Contas a pagar (escritório)
  - Financeiro › Contas a pagar (parceiro da rede)
  - Financeiro › Contas a pagar (varejo)
- **Server actions (gravações):**
  - `approvePayableAction` — src/app/(app)/financeiro/actions.ts
  - `cancelTitleAction` — src/app/(app)/financeiro/actions.ts
  - `createTitleAction` — src/app/(app)/financeiro/actions.ts
  - `previewBatchSettleAction` — src/app/(app)/financeiro/actions.ts
  - `reverseSettlementAction` — src/app/(app)/financeiro/actions.ts
  - `revokeApprovalAction` — src/app/(app)/financeiro/actions.ts
  - `settleAction` — src/app/(app)/financeiro/actions.ts
  - `settleBatchAction` — src/app/(app)/financeiro/actions.ts
  - `updateInstallmentAction` — src/app/(app)/financeiro/actions.ts
  - `updateTitleAction` — src/app/(app)/financeiro/actions.ts
  - `uploadAttachmentAction` — src/app/(app)/financeiro/actions.ts
- **Exportações:** `fin-payables`
- **Permissões de perfil:** `finance.approve_payable`
- **Dados (evidência de uso na linha de base):** tabela `titles` com [["eq","kind","payable"]]
- **Ao desligar:** drain (pendências: `finance.open_payables`); depois: consulta histórica. Contas em aberto (inclusive as geradas por compras) continuam podendo ser pagas.

### `financeiro.baixa_lote` — Baixa de títulos em lote

Seleção múltipla de parcelas com prévia e baixa conjunta.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `financeiro.contas_receber`
- **Observação do levantamento:** Serve a receber e a pagar; o pai é contas a receber por ser a lista em que a função nasceu. Confirmar se deve ser contratável com apenas contas a pagar.
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("baixaLote") — src/app/(app)/financeiro/_components/titles-list.tsx
  - requireFeature("baixaLote") — src/app/(app)/financeiro/actions.ts
- **Recursos de Parâmetros:** `baixaLote`
- **Pontos dentro de outras telas:** Contas a receber/pagar › Baixar selecionadas
- **Ao desligar:** immediate; depois: oculto.

### `financeiro.fluxo_caixa` — Fluxo de caixa

Fluxo realizado e previsto, lançamentos avulsos e transferências entre contas.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/financeiro/fluxo-caixa` — src/app/(app)/financeiro/fluxo-caixa/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Fluxo de caixa (escritório)
  - Financeiro › Fluxo de caixa (parceiro da rede)
  - Financeiro › Fluxo de caixa (varejo)
- **Server actions (gravações):**
  - `createEntryAction` — src/app/(app)/financeiro/actions.ts
  - `reverseEntryAction` — src/app/(app)/financeiro/actions.ts
  - `transferAction` — src/app/(app)/financeiro/actions.ts
- **Exportações:** `fin-cashflow`
- **Ao desligar:** immediate; depois: consulta histórica.

### `financeiro.conciliacao` — Conciliação bancária

Importação de extrato (OFX, CNAB, CSV), conciliação, baixa a partir do extrato e integração bancária.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Observação do levantamento:** Baixa de boleto pelo arquivo de retorno CNAB só existe aqui (reconciliation.ts settleFromBankTx): sem a conciliação, boletos são baixados manualmente em contas a receber.
- **Telas e rotas:**
  - `/financeiro/conciliacao/importacoes/[id]` — src/app/(app)/financeiro/conciliacao/importacoes/[id]/page.tsx
  - `/financeiro/conciliacao/importar` — src/app/(app)/financeiro/conciliacao/importar/page.tsx
  - `/financeiro/conciliacao` — src/app/(app)/financeiro/conciliacao/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Conciliação bancária (escritório)
  - Financeiro › Conciliação bancária (parceiro da rede)
  - Financeiro › Conciliação bancária (varejo)
- **Server actions (gravações):**
  - `ignoreTxAction` — src/app/(app)/financeiro/actions.ts
  - `importAction` — src/app/(app)/financeiro/actions.ts
  - `previewImportAction` — src/app/(app)/financeiro/actions.ts
  - `reconcileAction` — src/app/(app)/financeiro/actions.ts
  - `restoreTxAction` — src/app/(app)/financeiro/actions.ts
  - `settleFromTxAction` — src/app/(app)/financeiro/actions.ts
  - `undoReconciliationAction` — src/app/(app)/financeiro/actions.ts
- **Exportações:** `fin-bank-transactions`
- **Permissões de perfil:** `finance.reconcile`
- **Dados (evidência de uso na linha de base):** tabela `bank_imports`
- **Ao desligar:** immediate; depois: consulta histórica. Conciliações feitas ficam em consulta. Desfazer uma conciliação continua permitido: o estorno de baixa conciliada exige desfazê-la antes (finance.ts), e sem isso a baixa ficaria sem correção.

### `financeiro.cartoes` — Recebíveis de cartão

Acompanhamento e baixa dos recebíveis de cartão das vendas.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/financeiro/cartoes` — src/app/(app)/financeiro/cartoes/page.tsx
- **Itens de menu:**
  - Financeiro › Recebíveis de cartão (varejo)
- **Server actions (gravações):**
  - `settleCardAction` — src/app/(app)/financeiro/actions.ts
  - `settleCardsBatchAction` — src/app/(app)/financeiro/actions.ts
- **Exportações:** `fin-cards`
- **Ao desligar:** drain (pendências: `finance.open_card_receivables`); depois: consulta histórica. Recebíveis de vendas anteriores continuam podendo ser baixados até a liquidação pela adquirente.

### `financeiro.taxas_adquirente` — Taxas por bandeira e arquivo da adquirente

Taxa por bandeira × parcelas e conciliação com o arquivo da adquirente.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `financeiro.cartoes`
- **Telas e rotas:**
  - `/financeiro/cartoes/adquirente/[id]` — src/app/(app)/financeiro/cartoes/adquirente/[id]/page.tsx
  - `/financeiro/cartoes/adquirente` — src/app/(app)/financeiro/cartoes/adquirente/page.tsx
- **Itens de menu:**
  - Financeiro › Arquivo da adquirente (varejo) · recurso taxasCartao
- **Server actions (gravações):**
  - `applyAcquirerAction` — src/app/(app)/financeiro/cartoes/adquirente/actions.ts
  - `previewAcquirerAction` — src/app/(app)/financeiro/cartoes/adquirente/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("taxasCartao") — src/app/(app)/financeiro/actions.ts
  - featureOn("taxasCartao") — src/app/(app)/financeiro/cadastros/page.tsx
  - featureOn("taxasCartao") — src/app/(app)/financeiro/cartoes/page.tsx
  - featureOn("taxasCartao") — src/exports/finance-reports.ts
  - requireFeature("taxasCartao") — src/app/(app)/financeiro/cartoes/adquirente/actions.ts
  - requireFeaturePage("taxasCartao") — src/app/(app)/financeiro/cartoes/adquirente/[id]/page.tsx
  - requireFeaturePage("taxasCartao") — src/app/(app)/financeiro/cartoes/adquirente/page.tsx
- **Exportações:** `fin-acquirer-lines`
- **Recursos de Parâmetros:** `taxasCartao`
- **Ao desligar:** immediate; depois: consulta histórica.

### `financeiro.relatorios` — DRE gerencial e aging

DRE por competência, aging de receber e pagar e plano de contas.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/relatorios/financeiros` — src/app/(app)/relatorios/financeiros/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Relatórios financeiros (DRE e aging) (escritório) · recurso dre
  - Financeiro › Relatórios financeiros (DRE e aging) (parceiro da rede) · recurso dre
  - Financeiro › Relatórios financeiros (DRE e aging) (varejo) · recurso dre
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("dre") — src/exports/finance-reports.ts
  - requireFeaturePage("dre") — src/app/(app)/relatorios/financeiros/page.tsx
- **Exportações:** `fin-dre`, `fin-aging`, `fin-chart-of-accounts`
- **Recursos de Parâmetros:** `dre`
- **Ao desligar:** immediate; depois: consulta histórica.

### `financeiro.fechamento_periodo` — Fechamento de período

Fecha o período financeiro recusando lançamentos retroativos; reabertura auditada.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `financeiro.fluxo_caixa`
- **Telas e rotas:**
  - `/financeiro/fechamento` — src/app/(app)/financeiro/fechamento/page.tsx
- **Itens de menu:**
  - Financeiro do escritório › Fechamento de período (escritório) · recurso fechamentoPeriodo
  - Financeiro › Fechamento de período (parceiro da rede) · recurso fechamentoPeriodo
  - Financeiro › Fechamento de período (varejo) · recurso fechamentoPeriodo
- **Server actions (gravações):**
  - `closePeriodAction` — src/app/(app)/financeiro/fechamento/actions.ts
  - `reopenPeriodAction` — src/app/(app)/financeiro/fechamento/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("fechamentoPeriodo") — src/app/(app)/financeiro/fechamento/actions.ts
  - requireFeaturePage("fechamentoPeriodo") — src/app/(app)/financeiro/fechamento/page.tsx
- **Recursos de Parâmetros:** `fechamentoPeriodo`
- **Permissões de perfil:** `finance.close_period`
- **Ao desligar:** immediate; depois: consulta histórica. Períodos já fechados continuam fechados (a trava não é removida pelo desligamento); reabrir exige o módulo.

### `financeiro.exportacao_dominio` — Exportação para a Domínio

Arquivo de lançamentos contábeis no layout de importação da Domínio.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/financeiro/exportacao-dominio` — src/app/(app)/financeiro/exportacao-dominio/page.tsx
- **Itens de menu:**
  - Financeiro › Exportação Domínio (varejo) · exige data.export · recurso exportacaoDominio
- **Server actions (gravações):**
  - `generateDominioAction` — src/app/(app)/financeiro/exportacao-dominio/actions.ts
  - `saveAccountingCodesAction` — src/app/(app)/financeiro/exportacao-dominio/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("exportacaoDominio") — src/app/(app)/financeiro/exportacao-dominio/actions.ts
  - requireFeaturePage("exportacaoDominio") — src/app/(app)/financeiro/exportacao-dominio/page.tsx
- **Recursos de Parâmetros:** `exportacaoDominio`
- **Ao desligar:** immediate; depois: consulta histórica.

## Fiscal

### `fiscal.nfce` — NFC-e

Emissão, contingência, consulta, cancelamento e reimpressão de NFC-e.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/fiscal/nfce/[id]/imprimir` — src/app/(app)/fiscal/nfce/[id]/imprimir/page.tsx
  - `/fiscal/nfce/[id]` — src/app/(app)/fiscal/nfce/[id]/page.tsx
  - `/fiscal/nfce` — src/app/(app)/fiscal/nfce/page.tsx
- **Itens de menu:**
  - Fiscal › NFC-e (varejo)
- **Permissões de perfil:** `fiscal.issue`
- **Dados (evidência de uso na linha de base):** tabela `fiscal_documents` com [["eq","model","nfce"]]
- **Ao desligar:** drain (pendências: `fiscal.processing_nfce`); depois: consulta histórica. NFC-e em processamento ou em contingência é transmitida/consultada até a resposta; cancelamento dentro do prazo legal continua permitido.

### `fiscal.nfe` — NF-e

Assistente de NF-e (venda, devolução, transferência, entrada), carta de correção, cancelamento e inutilização.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/fiscal/nfe/[id]/imprimir` — src/app/(app)/fiscal/nfe/[id]/imprimir/page.tsx
  - `/fiscal/nfe/[id]` — src/app/(app)/fiscal/nfe/[id]/page.tsx
  - `/fiscal/nfe/nova` — src/app/(app)/fiscal/nfe/nova/page.tsx
  - `/fiscal/nfe` — src/app/(app)/fiscal/nfe/page.tsx
- **Itens de menu:**
  - Fiscal › NF-e (varejo)
- **Server actions (gravações):**
  - `previewNfeAction` — src/app/(app)/fiscal/actions.ts
  - `saveNfeAction` — src/app/(app)/fiscal/actions.ts
- **Permissões de perfil:** `fiscal.issue`
- **Dados (evidência de uso na linha de base):** tabela `fiscal_documents` com [["eq","model","nfe"]]
- **Ao desligar:** drain (pendências: `fiscal.processing_nfe`); depois: consulta histórica. NF-e em processamento é concluída; cancelamento e CC-e dentro do prazo legal continuam permitidos.

### `fiscal.nfse` — NFS-e

Emissão e cancelamento de NFS-e (serviços, LC 116).

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/fiscal/nfse/[id]/imprimir` — src/app/(app)/fiscal/nfse/[id]/imprimir/page.tsx
  - `/fiscal/nfse/[id]` — src/app/(app)/fiscal/nfse/[id]/page.tsx
  - `/fiscal/nfse/nova` — src/app/(app)/fiscal/nfse/nova/page.tsx
  - `/fiscal/nfse` — src/app/(app)/fiscal/nfse/page.tsx
- **Itens de menu:**
  - Fiscal (serviços do escritório) › NFS-e (escritório)
  - Fiscal (serviços) › NFS-e (parceiro da rede)
  - Fiscal › NFS-e (varejo)
- **Server actions (gravações):**
  - `saveNfseAction` — src/app/(app)/fiscal/actions.ts
- **Permissões de perfil:** `fiscal.issue`
- **Dados (evidência de uso na linha de base):** tabela `fiscal_documents` com [["eq","model","nfse"]]
- **Ao desligar:** drain (pendências: `fiscal.processing_nfse`); depois: consulta histórica. NFS-e em processamento é concluída.

### `fiscal.livro_entradas` — Livro de entradas

Livro de entradas por período e nota de entrada sem estoque.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/fiscal/entradas/nova` — src/app/(app)/fiscal/entradas/nova/page.tsx
  - `/fiscal/entradas` — src/app/(app)/fiscal/entradas/page.tsx
- **Itens de menu:**
  - Fiscal › Livro de entradas (varejo) · recurso livroEntradas
- **Server actions (gravações):**
  - `createNoStockEntryAction` — src/app/(app)/fiscal/entradas/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("livroEntradas") — src/app/(app)/fiscal/entradas/actions.ts
  - requireFeaturePage("livroEntradas") — src/app/(app)/fiscal/entradas/nova/page.tsx
  - requireFeaturePage("livroEntradas") — src/app/(app)/fiscal/entradas/page.tsx
- **Exportações:** `fiscal-livro-entradas`, `fiscal-entradas-cfop`
- **Recursos de Parâmetros:** `livroEntradas`
- **Ao desligar:** immediate; depois: consulta histórica.

### `fiscal.sped` — SPED Fiscal e EFD Contribuições

EFD ICMS/IPI por estabelecimento e EFD Contribuições, com prévia de pendências, geração e histórico.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** shared_screen
- **Observação do levantamento:** Hoje o recurso arquivosFiscais liga SPED e Sintegra juntos; a habilitação separa /fiscal/arquivos (SPED) de /fiscal/arquivos/sintegra.
- **Telas e rotas:**
  - `/fiscal/arquivos` — src/app/(app)/fiscal/arquivos/page.tsx
- **Itens de menu:**
  - Fiscal (serviços do escritório) › Arquivos fiscais (SPED) (escritório) · exige fiscal.files · recurso arquivosFiscais
  - Fiscal › Arquivos fiscais (SPED) (varejo) · exige fiscal.files · recurso arquivosFiscais
- **Server actions (gravações):**
  - `generateFiscalFileAction` — src/app/(app)/fiscal/arquivos/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("arquivosFiscais") — src/app/(app)/fiscal/arquivos/actions.ts
  - requireFeature("arquivosFiscais") — src/app/(app)/fiscal/arquivos/sintegra/actions.ts
  - requireFeaturePage("arquivosFiscais") — src/app/(app)/fiscal/arquivos/page.tsx
  - requireFeaturePage("arquivosFiscais") — src/app/(app)/fiscal/arquivos/sintegra/page.tsx
- **Recursos de Parâmetros:** `arquivosFiscais`
- **Permissões de perfil:** `fiscal.files`
- **Ao desligar:** immediate; depois: consulta histórica. Arquivos gerados continuam para download; o pacote contábil segue sem o SPED do período.

### `fiscal.sintegra` — Sintegra

Arquivo Sintegra (registros 50, 54, 61, 61R, 74, 75).

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** shared_screen
- **Telas e rotas:**
  - `/fiscal/arquivos/sintegra` — src/app/(app)/fiscal/arquivos/sintegra/page.tsx
- **Itens de menu:**
  - Fiscal › Sintegra (varejo) · exige fiscal.files · recurso arquivosFiscais
- **Server actions (gravações):**
  - `generateSintegraAction` — src/app/(app)/fiscal/arquivos/sintegra/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("arquivosFiscais") — src/app/(app)/fiscal/arquivos/actions.ts
  - requireFeature("arquivosFiscais") — src/app/(app)/fiscal/arquivos/sintegra/actions.ts
  - requireFeaturePage("arquivosFiscais") — src/app/(app)/fiscal/arquivos/page.tsx
  - requireFeaturePage("arquivosFiscais") — src/app/(app)/fiscal/arquivos/sintegra/page.tsx
- **Recursos de Parâmetros:** `arquivosFiscais`
- **Permissões de perfil:** `fiscal.files`
- **Ao desligar:** immediate; depois: consulta histórica.

### `fiscal.tributacao_avancada` — Tributação avançada

Tributação completa (ICMS-ST, MVA, FCP, DIFAL), naturezas de operação e crédito do Simples Nacional.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Server actions (gravações):**
  - `saveCompleteSettingsAction` — src/app/(app)/fiscal/actions.ts
  - `saveNatureAction` — src/app/(app)/fiscal/actions.ts
  - `saveSimplesCreditAction` — src/app/(app)/fiscal/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("creditoSimples") — src/app/(app)/fiscal/configuracoes/page.tsx
  - featureOn("naturezasOperacao") — src/app/(app)/fiscal/configuracoes/page.tsx
  - featureOn("naturezasOperacao") — src/app/(app)/fiscal/nfe/nova/page.tsx
  - featureOn("naturezasOperacao") — src/app/(app)/produtos/cadastros/page.tsx
  - featureOn("tributacaoCompleta") — src/app/(app)/fiscal/configuracoes/page.tsx
  - featureOn("tributacaoCompleta") — src/app/(app)/produtos/cadastros/page.tsx
  - requireFeature("creditoSimples") — src/app/(app)/fiscal/actions.ts
  - requireFeature("naturezasOperacao") — src/app/(app)/fiscal/actions.ts
  - requireFeature("tributacaoCompleta") — src/app/(app)/fiscal/actions.ts
- **Recursos de Parâmetros:** `tributacaoCompleta`, `naturezasOperacao`, `creditoSimples`
- **Pontos dentro de outras telas:** Fiscal › Configurações › Tributação completa / Naturezas / Crédito do Simples
- **Ao desligar:** immediate; depois: consulta histórica. Documentos emitidos mantêm os valores calculados; a configuração é preservada para a reativação.

### `fiscal.reforma_tributaria` — Reforma tributária (IBS/CBS/IS)

Grupos IBS/CBS/IS nos documentos, conforme a adesão na configuração fiscal.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Server actions (gravações):**
  - `saveReformAdherenceAction` — src/app/(app)/fiscal/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("reformaTributaria") — src/app/(app)/fiscal/configuracoes/page.tsx
  - featureOn("reformaTributaria") — src/app/(app)/produtos/[id]/page.tsx
  - featureOn("reformaTributaria") — src/app/(app)/produtos/cadastros/page.tsx
  - requireFeature("reformaTributaria") — src/app/(app)/fiscal/actions.ts
  - requireFeature("reformaTributaria") — src/app/(app)/produtos/actions.ts
- **Recursos de Parâmetros:** `reformaTributaria`
- **Ao desligar:** immediate; depois: consulta histórica.

### `fiscal.mdfe` — MDF-e

Manifesto de documentos fiscais para transporte próprio. Não existe no ERP.

- **Classe:** commercial · **Disponibilidade:** planned · **Situação no repositório:** gap
- **Ao desligar:** immediate; depois: consulta histórica.

## Análise

### `relatorios.gerenciais` — Central de relatórios e relatórios gerenciais

Central de relatórios, relatórios gerenciais por filial e por período.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/relatorios/gerenciais/filial/[id]` — src/app/(app)/relatorios/gerenciais/filial/[id]/page.tsx
  - `/relatorios/gerenciais` — src/app/(app)/relatorios/gerenciais/page.tsx
  - `/relatorios` — src/app/(app)/relatorios/page.tsx
- **Itens de menu:**
  - Análise › Central de relatórios (varejo)
  - Análise › Relatórios gerenciais (varejo)
- **Exportações:** `reports-units`, `reports-breakdown`, `reports-branch-ops`
- **Ao desligar:** immediate; depois: consulta histórica.

### `relatorios.curva_abc` — Curva ABC de produtos

Classificação ABC por faturamento/margem e ficha analítica do produto.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/relatorios/curva-abc/produto/[skuId]` — src/app/(app)/relatorios/curva-abc/produto/[skuId]/page.tsx
  - `/relatorios/curva-abc` — src/app/(app)/relatorios/curva-abc/page.tsx
- **Itens de menu:**
  - Análise › Produtos e curva ABC (varejo)
- **Exportações:** `reports-abc`, `reports-abc-product`
- **Ao desligar:** immediate; depois: consulta histórica.

### `gestao.metas` — Metas de vendas

Metas por filial e vendedor com acompanhamento no painel.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/dashboard/metas` — src/app/(app)/dashboard/metas/page.tsx
- **Server actions (gravações):**
  - `copyGoalsAction` — src/app/(app)/dashboard/metas/actions.ts
  - `deleteGoalAction` — src/app/(app)/dashboard/metas/actions.ts
  - `saveGoalAction` — src/app/(app)/dashboard/metas/actions.ts
- **Exportações:** `reports-goals`
- **Dados (evidência de uso na linha de base):** tabela `goals`
- **Ao desligar:** immediate; depois: consulta histórica.

## Implantação e integrações

### `implantacao.importacao` — Importação de cadastros e saldos

Assistente de importação por CSV de clientes, fornecedores, saldos iniciais e títulos.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/administracao/importacao/[id]` — src/app/(app)/administracao/importacao/[id]/page.tsx
  - `/administracao/importacao` — src/app/(app)/administracao/importacao/page.tsx
- **Itens de menu:**
  - Administração › Importação de cadastros e saldos (varejo) · recurso importacaoCadastros
- **Server actions (gravações):**
  - `analyzeDataCsvAction` — src/app/(app)/administracao/importacao/actions.ts
  - `previewDataImportAction` — src/app/(app)/administracao/importacao/actions.ts
  - `runDataImportAction` — src/app/(app)/administracao/importacao/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - requireFeature("importacaoCadastros") — src/app/(app)/administracao/importacao/actions.ts
  - requireFeaturePage("importacaoCadastros") — src/app/(app)/administracao/importacao/page.tsx
- **Recursos de Parâmetros:** `importacaoCadastros`
- **Ao desligar:** immediate; depois: consulta histórica.

### `integracao.contabilidade` — Área da contabilidade (vínculo com escritório)

Vínculo com o escritório contábil, envio automático do pacote mensal de XMLs e autorização de certificados.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Server actions (gravações):**
  - `acceptLinkCodeAction` — src/app/(app)/contabil/actions.ts
  - `authorizeDownloadAction` — src/app/(app)/contabil/certificados/actions.ts
  - `recordAuthorizationAction` — src/app/(app)/contabil/certificados/actions.ts
  - `revokeLinkByCompanyAction` — src/app/(app)/contabil/actions.ts
  - `setCertificateTrackingAction` — src/app/(app)/contabil/certificados/actions.ts
- **Rotinas diárias:** `fiscal.accountingExport`
- **Ao desligar:** immediate; depois: consulta histórica. Pacotes já entregues continuam na caixa do escritório.

## Escritório contábil

### `contabil.carteira` — Carteira de clientes contábeis

Painel da carteira, clientes PF/PJ, regime, grupos, departamentos, equipe e responsáveis.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/contabil/clientes/[id]/editar` — src/app/(app)/contabil/clientes/[id]/editar/page.tsx
  - `/contabil/clientes/[id]` — src/app/(app)/contabil/clientes/[id]/page.tsx
  - `/contabil/clientes/novo` — src/app/(app)/contabil/clientes/novo/page.tsx
  - `/contabil/clientes` — src/app/(app)/contabil/clientes/page.tsx
  - `/contabil/equipe` — src/app/(app)/contabil/equipe/page.tsx
  - `/contabil/grupos` — src/app/(app)/contabil/grupos/page.tsx
  - `/contabil` — src/app/(app)/contabil/page.tsx
- **Itens de menu:**
  - Carteira › Clientes contábeis (escritório)
  - Carteira › Departamentos e equipe (escritório)
  - Carteira › Grupos de clientes (escritório)
  - Gestão › Painel da carteira (escritório)
- **Server actions (gravações):**
  - `assignResponsibleAction` — src/app/(app)/contabil/actions.ts
  - `cancelLinkCodeAction` — src/app/(app)/contabil/actions.ts
  - `changeRegimeAction` — src/app/(app)/contabil/actions.ts
  - `endAssignmentAction` — src/app/(app)/contabil/actions.ts
  - `issueLinkCodeAction` — src/app/(app)/contabil/actions.ts
  - `lookupClientCnpjAction` — src/app/(app)/contabil/actions.ts
  - `removeEstablishmentAction` — src/app/(app)/contabil/actions.ts
  - `removePersonAction` — src/app/(app)/contabil/actions.ts
  - `revokeLinkByFirmAction` — src/app/(app)/contabil/actions.ts
  - `saveClientAction` — src/app/(app)/contabil/actions.ts
  - `saveDepartmentAction` — src/app/(app)/contabil/actions.ts
  - `saveEstablishmentAction` — src/app/(app)/contabil/actions.ts
  - `saveGroupAction` — src/app/(app)/contabil/actions.ts
  - `savePersonAction` — src/app/(app)/contabil/actions.ts
  - `setClientStatusAction` — src/app/(app)/contabil/actions.ts
  - `setDepartmentMemberAction` — src/app/(app)/contabil/actions.ts
- **Exportações:** `accounting_clients`
- **Permissões de perfil:** `accounting.all_clients`, `accounting.link`, `accounting.manage_team`
- **Dados (evidência de uso na linha de base):** tabela `accounting_clients`
- **Ao desligar:** immediate; depois: consulta histórica.

### `contabil.entregas` — Caixa de entrada de entregas

Recebimento dos pacotes de XML das empresas vinculadas, conferência e download auditado.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `contabil.carteira`
- **Telas e rotas:**
  - `/contabil/entregas` — src/app/(app)/contabil/entregas/page.tsx
- **Itens de menu:**
  - Carteira › Caixa de entrada (entregas) (escritório)
- **Server actions (gravações):**
  - `reviewDeliveryAction` — src/app/(app)/contabil/actions.ts
- **Exportações:** `accounting_deliveries`
- **Ao desligar:** immediate; depois: consulta histórica.

### `contabil.certificados` — Certificados digitais dos clientes

Solicitação, cobrança, validação, emissão e download de certificados A1 dos clientes.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `contabil.carteira`
- **Telas e rotas:**
  - `/contabil/certificados/[id]` — src/app/(app)/contabil/certificados/[id]/page.tsx
  - `/contabil/certificados/nova` — src/app/(app)/contabil/certificados/nova/page.tsx
  - `/contabil/certificados` — src/app/(app)/contabil/certificados/page.tsx
- **Itens de menu:**
  - Carteira › Certificados digitais (escritório)
- **Server actions (gravações):**
  - `authorizeDownloadAction` — src/app/(app)/contabil/certificados/actions.ts
  - `cancelRequestAction` — src/app/(app)/contabil/certificados/actions.ts
  - `createCertificateRequestAction` — src/app/(app)/contabil/certificados/actions.ts
  - `recordAuthorizationAction` — src/app/(app)/contabil/certificados/actions.ts
  - `registerKnownCertificateAction` — src/app/(app)/contabil/certificados/actions.ts
  - `requestDownloadAuthorizationAction` — src/app/(app)/contabil/certificados/actions.ts
  - `requestEmissionAction` — src/app/(app)/contabil/certificados/actions.ts
  - `requestTrackingAccessAction` — src/app/(app)/contabil/certificados/actions.ts
  - `sendChargeAction` — src/app/(app)/contabil/certificados/actions.ts
  - `setCertificateTrackingAction` — src/app/(app)/contabil/certificados/actions.ts
- **APIs:**
  - `/api/certificados/[id]` — src/app/api/certificados/[id]/route.ts
- **Rotinas diárias:** `accounting.certificates`
- **Permissões de perfil:** `accounting.certificates`
- **Dados (evidência de uso na linha de base):** tabela `certificate_requests`
- **Ao desligar:** drain (pendências: `accounting.open_certificate_requests`); depois: consulta histórica. Solicitações pagas seguem até a emissão e o download.

## Rede de certificação

### `rede.parceiro` — Rede de certificação — nó do parceiro

Minha rede: parceiros abaixo, preços dos filhos e posição na hierarquia.

- **Classe:** commercial · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/rede/[id]` — src/app/(app)/rede/[id]/page.tsx
  - `/rede/minha` — src/app/(app)/rede/minha/page.tsx
  - `/rede/novo` — src/app/(app)/rede/novo/page.tsx
- **Itens de menu:**
  - Carteira › Minha rede de certificação (escritório) · recurso redeCertificacao
  - Gestão › Minha rede (parceiro da rede) · recurso redeCertificacao
- **Server actions (gravações):**
  - `clearNodePriceRuleAction` — src/app/(app)/rede/actions.ts
  - `createNodeAction` — src/app/(app)/rede/actions.ts
  - `moveNodeAction` — src/app/(app)/rede/actions.ts
  - `saveLevelLabelsAction` — src/app/(app)/rede/actions.ts
  - `savePriceRuleAction` — src/app/(app)/rede/actions.ts
  - `setNodeStatusAction` — src/app/(app)/rede/actions.ts
- **Abas, botões e telas condicionados a recurso:**
  - featureOn("redeCertificacao") — src/app/(app)/contabil/network-card.tsx
  - requireFeature("redeCertificacao") — src/app/(app)/rede/actions.ts
  - requireFeature("redeCertificacao") — src/app/(app)/rede/financeiro/actions.ts
  - requireFeature("redeCertificacao") — src/app/(app)/rede/vendas/actions.ts
  - requireFeaturePage("redeCertificacao") — src/app/(app)/rede/shared.tsx
- **Recursos de Parâmetros:** `redeCertificacao`
- **Permissões de perfil:** `network.children`, `network.prices`
- **Ao desligar:** immediate; depois: consulta histórica.

### `rede.vendas` — Vendas de certificados pela rede

Nova venda com o preço da rede, clientes de certificado, cobrança e entrega.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `rede.parceiro`
- **Telas e rotas:**
  - `/rede/clientes/[id]` — src/app/(app)/rede/clientes/[id]/page.tsx
  - `/rede/clientes/novo` — src/app/(app)/rede/clientes/novo/page.tsx
  - `/rede/clientes` — src/app/(app)/rede/clientes/page.tsx
  - `/rede/vendas/[id]` — src/app/(app)/rede/vendas/[id]/page.tsx
  - `/rede/vendas/nova` — src/app/(app)/rede/vendas/nova/page.tsx
  - `/rede/vendas` — src/app/(app)/rede/vendas/page.tsx
- **Itens de menu:**
  - Administração › Vendas da rede (plataforma) (escritório) · exige network.manage · recurso redeCertificacao
  - Administração › Vendas da rede (plataforma) (varejo) · exige network.manage · recurso redeCertificacao
  - Rede de certificação › Clientes de certificado (parceiro da rede) · recurso redeCertificacao
  - Rede de certificação › Vendas de certificados (parceiro da rede) · recurso redeCertificacao
- **Server actions (gravações):**
  - `cancelSaleAction` — src/app/(app)/rede/vendas/actions.ts
  - `createSaleAction` — src/app/(app)/rede/vendas/actions.ts
  - `recordSaleAuthorizationAction` — src/app/(app)/rede/vendas/actions.ts
  - `requestSaleEmissionAction` — src/app/(app)/rede/vendas/actions.ts
  - `saveCustomerAction` — src/app/(app)/rede/vendas/actions.ts
  - `sendSaleChargeAction` — src/app/(app)/rede/vendas/actions.ts
- **Permissões de perfil:** `network.sell`, `network.sales_all`
- **Ao desligar:** drain (pendências: `network.open_sales`); depois: consulta histórica. Vendas pagas seguem até a emissão do certificado.

### `rede.vouchers_cupons` — Vouchers e cupons da rede

Pacotes de vouchers e cupons de desconto.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `rede.vendas`
- **Telas e rotas:**
  - `/rede/cupons` — src/app/(app)/rede/cupons/page.tsx
  - `/rede/vouchers` — src/app/(app)/rede/vouchers/page.tsx
- **Itens de menu:**
  - Rede de certificação › Cupons (parceiro da rede) · recurso redeCertificacao
  - Rede de certificação › Vouchers (parceiro da rede) · recurso redeCertificacao
- **Server actions (gravações):**
  - `cancelCodeAction` — src/app/(app)/rede/vendas/actions.ts
  - `createCouponAction` — src/app/(app)/rede/vendas/actions.ts
  - `createPackageAction` — src/app/(app)/rede/vendas/actions.ts
  - `issueCodeAction` — src/app/(app)/rede/vendas/actions.ts
  - `purchasePackageAction` — src/app/(app)/rede/vendas/actions.ts
  - `setCouponActiveAction` — src/app/(app)/rede/vendas/actions.ts
  - `setPackageActiveAction` — src/app/(app)/rede/vendas/actions.ts
- **Permissões de perfil:** `network.vouchers`, `network.coupons`
- **Ao desligar:** immediate; depois: consulta histórica. Vouchers vendidos continuam resgatáveis (saldo do cliente).

### `rede.renovacoes` — Renovações

Acompanhamento de vencimentos e contatos de renovação.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `rede.parceiro`
- **Telas e rotas:**
  - `/rede/renovacoes` — src/app/(app)/rede/renovacoes/page.tsx
- **Itens de menu:**
  - Administração › Renovações da rede (plataforma) (escritório) · exige network.manage · recurso redeCertificacao
  - Administração › Renovações da rede (plataforma) (varejo) · exige network.manage · recurso redeCertificacao
  - Carteira › Renovações da rede (escritório) · recurso redeCertificacao
  - Rede de certificação › Renovações (parceiro da rede) · recurso redeCertificacao
- **Server actions (gravações):**
  - `registerContactAction` — src/app/(app)/rede/vendas/actions.ts
  - `saveIdleDaysAction` — src/app/(app)/rede/vendas/actions.ts
- **Rotinas diárias:** `network.renewals`
- **Permissões de perfil:** `network.renewals`
- **Ao desligar:** immediate; depois: consulta histórica.

### `rede.financeiro` — Financeiro em camadas da rede

Modalidade pré/pós-pago, carteira de créditos, fechamentos e resultado por camada.

- **Classe:** optional_function · **Disponibilidade:** available · **Situação no repositório:** exists · **Pai:** `rede.parceiro`
- **Telas e rotas:**
  - `/rede/fechamentos/[id]` — src/app/(app)/rede/fechamentos/[id]/page.tsx
  - `/rede/financeiro` — src/app/(app)/rede/financeiro/page.tsx
  - `/rede/minha/financeiro` — src/app/(app)/rede/minha/financeiro/page.tsx
- **Itens de menu:**
  - Administração › Resultado da rede (plataforma) (escritório) · exige network.manage · recurso redeCertificacao
  - Administração › Resultado da rede (plataforma) (varejo) · exige network.manage · recurso redeCertificacao
  - Carteira › Financeiro com a revenda (rede) (escritório) · recurso redeCertificacao
  - Rede de certificação › Meu financeiro com o nível acima (parceiro da rede) · recurso redeCertificacao
  - Rede de certificação › Resultado da rede (parceiro da rede) · recurso redeCertificacao
- **Server actions (gravações):**
  - `adjustWalletAction` — src/app/(app)/rede/financeiro/actions.ts
  - `cancelRechargeAction` — src/app/(app)/rede/financeiro/actions.ts
  - `closeNowAction` — src/app/(app)/rede/financeiro/actions.ts
  - `confirmRechargeAction` — src/app/(app)/rede/financeiro/actions.ts
  - `reprocessSaleAction` — src/app/(app)/rede/financeiro/actions.ts
  - `requestRechargeAction` — src/app/(app)/rede/financeiro/actions.ts
  - `reverseSaleAction` — src/app/(app)/rede/financeiro/actions.ts
  - `saveAgreementAction` — src/app/(app)/rede/financeiro/actions.ts
  - `savePlatformFinanceAction` — src/app/(app)/rede/financeiro/actions.ts
- **Exportações:** `network-closing`
- **Rotinas diárias:** `network.billing`
- **Permissões de perfil:** `network.billing`, `network.finance_view`
- **Ao desligar:** scheduled (pendências: `network.open_closings`); depois: consulta histórica. Fechamentos de período em aberto precisam ser concluídos antes do desligamento.

### `rede.plataforma` — Gestão da rede (plataforma Intercert)

Árvore completa, preços padrão, catálogo e parâmetros da rede, e a equipe de certificação. Exclusivo da plataforma Intercert, governado pelas operações network.manage e certification.operate.

- **Classe:** platform · **Disponibilidade:** available · **Situação no repositório:** exists
- **Telas e rotas:**
  - `/administracao/certificacao/[id]` — src/app/(app)/administracao/certificacao/[id]/page.tsx
  - `/administracao/certificacao` — src/app/(app)/administracao/certificacao/page.tsx
  - `/rede/parametros` — src/app/(app)/rede/parametros/page.tsx
  - `/rede/precos` — src/app/(app)/rede/precos/page.tsx
  - `/rede` — src/app/(app)/rede/page.tsx
- **Itens de menu:**
  - Administração › Certificação digital (equipe) (escritório) · exige certification.operate
  - Administração › Certificação digital (equipe) (parceiro da rede) · exige certification.operate
  - Administração › Certificação digital (equipe) (varejo) · exige certification.operate
  - Administração › Rede de certificação (plataforma) (escritório) · exige network.manage · recurso redeCertificacao
  - Administração › Rede de certificação (plataforma) (varejo) · exige network.manage · recurso redeCertificacao
  - Rede de certificação › Parâmetros da rede (parceiro da rede) · exige network.manage · recurso redeCertificacao
  - Rede de certificação › Preços da rede e catálogo (parceiro da rede) · exige network.manage · recurso redeCertificacao
  - Rede de certificação › Rede (plataforma) (parceiro da rede) · exige network.manage · recurso redeCertificacao
- **Server actions (gravações):**
  - `approveValidationAction` — src/app/(app)/contabil/certificados/actions.ts
  - `confirmPaymentAction` — src/app/(app)/contabil/certificados/actions.ts
  - `emissionFailureAction` — src/app/(app)/contabil/certificados/actions.ts
  - `registerEmissionAction` — src/app/(app)/contabil/certificados/actions.ts
  - `rejectValidationAction` — src/app/(app)/contabil/certificados/actions.ts
  - `saveCertificationSettingsAction` — src/app/(app)/contabil/certificados/actions.ts
  - `scheduleValidationAction` — src/app/(app)/contabil/certificados/actions.ts
  - `teamCancelRequestAction` — src/app/(app)/contabil/certificados/actions.ts
  - `teamRequestEmissionAction` — src/app/(app)/contabil/certificados/actions.ts
- **Permissões de perfil:** `network.manage`, `certification.operate`
- **Ao desligar:** immediate; depois: consulta histórica. Recurso da plataforma: não pode ser desligado.

## Superfícies compartilhadas

| Superfície | Donos | Regra |
|---|---|---|
| `src/app/(app)/compras/_shared/actions.ts#searchSkusAction` | `compras.pedidos`, `compras.cotacoes`, `compras.recebimento` | ação compartilhada: basta um dono |
| `src/app/(app)/compras/_shared/actions.ts#supplierCostsAction` | `compras.pedidos`, `compras.cotacoes`, `compras.recebimento` | ação compartilhada: basta um dono |
| `src/app/(app)/contabil/certificados/actions.ts#authorizeDownloadAction` | `contabil.certificados`, `integracao.contabilidade` | ação compartilhada: basta um dono |
| `src/app/(app)/contabil/certificados/actions.ts#recordAuthorizationAction` | `contabil.certificados`, `integracao.contabilidade` | ação compartilhada: basta um dono |
| `src/app/(app)/contabil/certificados/actions.ts#setCertificateTrackingAction` | `contabil.certificados`, `integracao.contabilidade` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#cancelTitleAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#createTitleAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#previewBatchSettleAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#reverseSettlementAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#settleAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#settleBatchAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#updateInstallmentAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#updateTitleAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |
| `src/app/(app)/financeiro/actions.ts#uploadAttachmentAction` | `financeiro.contas_receber`, `financeiro.contas_pagar` | ação compartilhada: basta um dono |

## Sem dono

- **Itens:**
  - `/` — src/app/page.tsx

