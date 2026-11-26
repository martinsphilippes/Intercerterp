# Mapeamento 01 — Dados e escopo por empresa

> **Estado analisado:** branch `claude/eager-tesla-oark2w`, commit `0aa96c2` (26/11/2026). Trabalho somente de leitura: nenhum
> código foi alterado. Referências no formato `arquivo:linha`, a partir da raiz do repositório. O comportamento do
> `ScopedStore` descrito na seção 3.2 foi conferido também por uma sondagem executada fora do repositório (Apêndice A).
> Durante o levantamento, outra frente de trabalho passou a alterar a cópia de trabalho sem commit (novas coleções no fim de
> `src/lib/db/schema.ts`, depois da linha 1383; `src/domain/tenancy/`, `src/lib/service/`, `scripts/interos/`). Essas mudanças
> **não** foram consideradas; as linhas citadas valem para o commit `0aa96c2`.
> Identidade/permissões, rotinas/arquivos/APIs e hierarquias entre empresas têm documentos próprios nesta pasta (02 a 04);
> aqui o foco é **onde mora a empresa de cada dado e o que garante (ou não) o isolamento**.

## Sumário dos achados

1. **Um único banco para todas as empresas, isolamento só na aplicação.** Uma tabela Postgres por coleção, sem RLS, sem
   `NOT NULL` nem chave estrangeira em `companyId` (`src/lib/db/postgres/ddl.ts:61-79`). A fronteira é o `ScopedStore`
   (`src/lib/db/scoped-store.ts`) mais checagens manuais espalhadas pelo domínio.
2. **O `ScopedStore` protege leitura por id e listagem, mas não protege escrita por id.** `update`, `delete` e
   `increment` não conferem a empresa do registro-alvo; `update` aceita `companyId: null` (o registro passa a ser
   "global"); `create` não injeta `companyId`; e qualquer filtro que mencione `companyId` desliga o escopo da consulta
   (`scoped-store.ts:24-31,71,83-94`). Comprovado no Apêndice A.
3. **Seis coleções não têm `companyId`** (`companies`, `users`, `sessions`, `auth_challenges`, `user_prefs`, `counters`):
   o Store restrito não as filtra. `users.isAdmin` é um superadministrador de **todas** as empresas; e-mail, login e CNPJ
   são espaços de nomes globais, e várias mensagens de duplicidade revelam nomes de outras empresas/usuários.
4. **297 chamadas a `unscoped()`** (mais acessos diretos a `getStore()`): 112 na rede de certificação, 85 no comércio
   digital (inclusive em telas internas da própria empresa), 26 no módulo contábil. A maior parte é legítima ou de sistema;
   os riscos concretos estão na seção 4 e priorizados na seção 6.
5. **Poderes de plataforma são operações de perfil comum**: `network.manage` e `certification.operate` podem ser
   concedidos por qualquer administrador de empresa ao próprio perfil (`src/domain/roles.ts:84-87`), e dão leitura/gravação
   entre empresas. Com o acesso rápido ligado, os logins públicos `rede` e `certificacao` já os têm.
6. **A cópia de segurança de uma empresa leva usuários de outras empresas** (todos os `isAdmin` e quem tem vínculo com
   ela), com `passwordHash`, segredos de 2FA cifrados e hashes de convite/recuperação (`src/domain/backup.ts:140-142`).
7. Os **testes de isolamento** cobrem bem as checagens explícitas por módulo e o caminho feliz do `ScopedStore`; não
   cobrem escrita por id de outra empresa, o desvio por filtro em `companyId`, coleções globais, backup, chamados públicos
   nem o comércio digital entre empresas.

---

## 1. Empresa ↔ matriz/filial ↔ terminal ↔ depósito

### 1.1 Modelo e campos de ligação

```
companies  (sem companyId: é a própria "empresa"/tenant)          users (global, sem companyId)
 ├─ kind: retail (padrão) | accounting | certification             ├─ companyIds[]        empresas com acesso
 ├─ status: active | inactive        isDemo                        ├─ branchIds[]         filiais (vazio = todas, em TODAS as empresas)
 ├─ cnpj  (único na instalação)                                    ├─ roleByCompany{}     { companyId: roleId }  + roleId (legado)
 └─ branches (companyId)                                           └─ isAdmin             acesso total a todas as empresas
     ├─ "Matriz" × "Filial" é derivado (CNPJ ordem 0001 ou código "01")
     ├─ defaultWarehouseId ──► warehouses (companyId, branchId, kind, purpose, isDefault)
     │                              └─ stock_balances (companyId, branchId, warehouseId+skuId)
     ├─ defaultPriceTableId ─► price_tables (companyId)
     ├─ terminals (companyId, branchId, code, nfceSeries, defaultWarehouseId)
     │     └─ cash_sessions (terminalId, branchId, lockKey "open:<terminal>") ─► cash_movements
     └─ financial_accounts (caixa por filial; conta bancária da empresa com branchId nulo)
```

| Vínculo | Campo(s) | Regra / onde é garantido |
|---|---|---|
| empresa → filial | `branches.companyId` (obrigatório) | `src/lib/db/schema.ts:87`. Não há índice único de código: a unicidade do código por empresa vem do id determinístico `detId("branch", companyId, code)` (`src/domain/companies.ts:280`) e da checagem `:272-274`. CNPJ de filial só é conferido dentro da própria empresa (`:274`). |
| matriz × filial | (derivado) | `branchKind()` — CNPJ com ordem `0001` ou código `01` (`src/domain/companies.ts:254-258`). A empresa criada nasce com a filial código `01` "Matriz" (`src/domain/setup.ts:51-54`). Não há campo explícito. |
| filial → depósito padrão | `branches.defaultWarehouseId` | Precisa pertencer à filial e ser de venda/almoxarifado (`src/domain/companies.ts:316-322`); fallback: primeiro depósito `available` da filial (`src/domain/stock.ts:572-581`). |
| filial → tabela de preço | `branches.defaultPriceTableId` | Conferida contra a empresa (`src/domain/companies.ts:327-330`). |
| depósito → filial/empresa | `warehouses.companyId`, `branchId` | Criados com a filial: `detId("warehouse", branchId, "main"/"damaged")` (`companies.ts:281-282,299-300`) ou `detId("setup", key, "warehouses", …)` (`setup.ts:50,97-98`). Tipos por `kind`+`purpose` (`src/domain/warehouse-rules.ts:6-12,36-40`). Código único por filial só na aplicação (`src/domain/warehouses.ts:59-61`). |
| terminal → filial/empresa | `terminals.companyId`, `branchId`; índice `u_code(companyId, code)` | Filial precisa ser da empresa ativa (`src/domain/terminals.ts:76`); id `detId("terminal", companyId, code)` (`:121`); `branchId` é obrigatório só na aplicação (no esquema é opcional, `schema.ts:67,149`). |
| terminal → depósito | `terminals.defaultWarehouseId` | Do mesmo `branchId` do terminal, ativo e `available` (`terminals.ts:83-91`). |
| terminal → série NFC-e | `terminals.nfceSeries` | Única por filial entre terminais ativos, só na aplicação (`terminals.ts:95-99`). |
| caixa → terminal | `cash_sessions.terminalId`, `lockKey` | `lockKey = "open:<terminalId>"` (`src/domain/cash.ts:95`) com índice único global (é id, sem risco). |
| usuário → empresas/filiais | `users.companyIds[]`, `branchIds[]`, `roleByCompany{}`, `roleId`, `isAdmin` | `schema.ts:97-103`. `branchIds` é uma lista **plana**: qualquer restrição de filial vale para todas as empresas do usuário (`src/lib/auth/users.ts:87-89`; teste `tests/round3-admin-painel.test.ts:39`). |

### 1.2 Tipos de empresa (`kind`)

| Valor | Uso | Efeitos no código |
|---|---|---|
| `retail` (padrão quando ausente) | empresa operacional (comércio/serviços) | parametrização completa: depósitos, tabela de preço, unidades, meios de PDV (`src/domain/setup.ts:97-125`); perfis `DEFAULT_ROLES` (`src/lib/permissions.ts:263-266`); comércio digital ligado por padrão (`src/lib/core/settings.ts:84`). |
| `accounting` | escritório contábil (carteira de clientes) | sem depósitos/preços/PDV, departamentos padrão (`setup.ts:59-95`); perfis `FIRM_ROLES`; rede de certificação ligada (`settings.ts:82`); menu próprio (`src/components/shell/nav.ts:281-282`). |
| `certification` | parceiro da rede (Master/Regional/Revenda) | categorias da certificação (`setup.ts:73-84`); perfis `PARTNER_ROLES`. |

`kind` é validado na criação (`src/domain/companies.ts:119-120`) e **não muda** depois (`:199-200`). Quem escolhe o tipo
é quem cria a empresa — qualquer perfil com `admin/criar` (ver risco R7).

### 1.3 Flags e situação

- **`isDemo`** faz parte do bloco `ctx` de quase todas as coleções (`schema.ts:67`) e de `companies` (`:76`). Não é
  fronteira de segurança dos dados; efeitos: aceitar NF-e de homologação em entradas (`src/domain/receipts.ts:530`,
  `src/domain/pending-invoice.ts:488`), selos na interface, e o **acesso rápido** da tela de login, que lista usuários
  `isDemo` com senha pública (`src/app/(auth)/login/access.ts:17-30`; `src/lib/auth/quick-access.ts:21-67`).
- **`status`** da empresa/filial: `inactive` impede a seleção como contexto (`src/lib/server/session.ts:46-48`;
  `src/lib/auth/users.ts:97-101`). É lido por cache compartilhado de 15 s (seção 3.7).

### 1.4 Registros que apontam para outra empresa

| Campo | Significado | Onde |
|---|---|---|
| `accounting_clients.linkedCompanyId` (+ `linkStatus`, `linkCodeHash`) | cliente do escritório ↔ empresa que usa o ERP, com consentimento por código | `schema.ts:1009`; `src/domain/accounting/link.ts:64-92` |
| `accounting_client_establishments.linkedBranchId` | estabelecimento ↔ filial da empresa vinculada | `schema.ts:1027` |
| `integrations(kind "accounting").config.linkedFirmCompanyId/linkedClientId` | lado da empresa vinculada | `link.ts:84-87` |
| `accounting_deliveries.sourceCompanyId` | entrega gravada pela empresa vinculada no escritório | `schema.ts:1065`; `src/domain/accounting/deliveries.ts:46-53` |
| `certificate_requests.linkedCompanyId` | titular do certificado no ERP | `schema.ts:1074` |
| `cert_network_nodes.nodeCompanyId` (único) | empresa que ocupa o nó da rede | `schema.ts:1106,1110` |
| `cert_*.*CompanyId` (`requestCompanyId`, `payerCompanyId`, `payeeCompanyId`, `childCompanyId`…) | partes das operações da rede | `schema.ts:1132-1265` |
| `stores.companyId` (`u_company`), `fulfillmentBranchId`, `pickupBranchIds` | uma loja por empresa e filiais que atendem | `schema.ts:1274,1277`; validação `src/domain/ecommerce/store.ts:458-475` |

**Pseudo-empresas:** `companyId = "platform"` (registros da rede e parâmetros da plataforma — `src/domain/network/common.ts:24`,
`src/domain/accounting/certificates.ts:37`, `src/app/api/keepalive/route.ts:24-25`) e `companyId = "public"` (chamados
abertos na tela de login — `src/app/actions/public.ts:15-16`). Registros `companyId` **nulo** são tratados como globais.

### 1.5 Contexto de trabalho (como a empresa ativa é escolhida)

- Cookie `ic_unit = "<companyId>:<branchId|all>"` (`src/lib/server/session.ts:15,43-44`), validado contra
  `accessibleUnits()` — lista **todas** as empresas e filiais e filtra por `companyIds`/`branchIds`/`isAdmin`
  (`src/lib/auth/users.ts:82-91`). Não há resolução por domínio/host no ERP (o `src/middleware.ts` só reescreve domínios de
  loja).
- Consolidado (`branchId = null`) só para `isAdmin` ou usuário sem `branchIds` (`session.ts:50-51`); operações
  transacionais exigem filial (`src/lib/core/ctx.ts:42-45`; `src/lib/server/action.ts:27`).
- Contexto incompleto usa `new ScopedStore(store, "")` (só registros globais), nunca o Store sem escopo
  (`session.ts:58-71`); rotas `/api` recusam com 409 (`:104-110`).

---

## 2. Esquema (`src/lib/db/schema.ts`)

### 2.1 Todas as coleções (132)

Legenda — **companyId**: obrigatório / opcional / **não** (coleção global). **branchId**: campo presente. **Únicos globais**
(índices `unique` sem `companyId`), classificados: **N** natural/por desenho (token, e-mail, slug público); **E** chave
composta que já carrega a empresa (`scopeKey` etc.); **I** derivada de ids de registros da própria empresa; **C** chave de
idempotência fornecida pelo cliente, sem empresa (colisão entre empresas vira conflito); **⚠** código de negócio por
empresa (ou identificador sem empresa) num espaço global. Linha = linha do `id:` da coleção.

| Coleção | Linha | companyId | branchId | Únicos globais | Únicos por empresa | Observações |
|---|---|---|---|---|---|---|
| `companies` | 72 | **não** | — | `cnpj` ⚠ | — | a própria empresa (tenant); `kind`, `status`, `isDemo` |
| `branches` | 84 | obrig. | — | — | — | matriz/filial; `defaultWarehouseId`, `defaultPriceTableId`; sem índice único de código (id = detId da empresa+código) |
| `users` | 94 | **não** | — | `email` ⚠ | — | `companyIds[]`, `branchIds[]`, `roleByCompany{}`, `roleId` legado, `isAdmin` global; `login` só com índice comum (unicidade pela aplicação, global) · refs: `companyIds` |
| `roles` | 114 | opcional | — | — | — | perfil por empresa; `companyId` nulo seria aceito em qualquer empresa (src/lib/auth/users.ts:18,22) |
| `sessions` | 127 | **não** | — | `tokenHash` N | — | efêmera |
| `auth_challenges` | 136 | **não** | — | `tokenHash` N | — | efêmera |
| `terminals` | 146 | obrig. | sim | — | `companyId+code` | `branchId` obrigatório só na aplicação; `defaultWarehouseId` |
| `user_prefs` | 156 | **não** | — | `userId+key` I | — | — |
| `settings` | 162 | obrig. | sim | `scopeKey` E | — | `scopeKey` = empresa\|filial\|chave; registros da plataforma com companyId "platform" |
| `counters` | 168 | **não** | — | `key` E/I/N | — | sem empresa: a chave carrega (ou não) a empresa por convenção |
| `goals` | 175 | obrig. | sim | — | — | — |
| `customers` | 184 | obrig. | sim | — | `companyId+doc` | — |
| `suppliers` | 196 | obrig. | sim | — | `companyId+doc` | — |
| `categories` | 210 | obrig. | sim | — | — | — |
| `brands` | 211 | obrig. | sim | — | — | — |
| `units` | 213 | obrig. | sim | — | `companyId+code` | — |
| `products` | 219 | obrig. | sim | — | `companyId+code`, `companyId+plu` | — |
| `product_components` | 241 | obrig. | sim | — | — | — |
| `skus` | 252 | obrig. | sim | — | `companyId+sku` | — |
| `unit_conversions` | 262 | obrig. | sim | — | — | — |
| `price_tables` | 268 | obrig. | sim | — | — | — |
| `prices` | 274 | obrig. | sim | `scopeKey` I | — | — |
| `promotions` | 286 | obrig. | sim | `idemKey` C | — | — |
| `price_history` | 296 | obrig. | sim | — | — | — |
| `supplier_products` | 302 | obrig. | sim | `supplierId+skuId` I | — | — |
| `product_imports` | 311 | obrig. | sim | `idemKey` C | — | — |
| `warehouses` | 324 | obrig. | sim | — | — | código único por filial só na aplicação |
| `stock_balances` | 335 | obrig. | sim | `warehouseId+skuId` I | — | — |
| `stock_movements` | 347 | obrig. | sim | `balanceId+seq` I; `idemKey` I/C | — | — |
| `stock_reservations` | 360 | obrig. | sim | `idemKey` I/C | — | — |
| `transfers` | 366 | obrig. | sim | — | — | — |
| `inventories` | 380 | obrig. | sim | — | — | — |
| `inventory_counts` | 390 | obrig. | sim | `inventoryId+skuId` I | — | — |
| `cash_sessions` | 405 | obrig. | sim | `lockKey` I | — | — |
| `cash_movements` | 417 | obrig. | sim | `idemKey` I | — | — |
| `carts` | 429 | obrig. | sim | — | — | — |
| `sales` | 445 | obrig. | sim | `idemKey` C | — | — |
| `sales_documents` | 467 | obrig. | sim | `scopeKey` E; `idemKey` C; `shareToken` N | — | — |
| `sales_document_items` | 484 | obrig. | sim | — | — | — |
| `sale_items` | 494 | obrig. | sim | — | — | — |
| `sale_payments` | 513 | obrig. | sim | — | — | — |
| `payment_intents` | 529 | obrig. | sim | `reference` I | — | — |
| `returns` | 540 | obrig. | sim | `idemKey` C | — | — |
| `return_items` | 555 | obrig. | sim | — | — | — |
| `credit_vouchers` | 564 | obrig. | sim | `code` ⚠ | — | código `VC/FD` + nº da empresa + 4 hex em índice global |
| `credit_voucher_moves` | 576 | obrig. | sim | `idemKey` I | — | — |
| `financial_accounts` | 584 | obrig. | sim | — | — | — |
| `account_entries` | 595 | obrig. | sim | `accountId+seq` I; `idemKey` I/C | — | — |
| `payment_methods` | 606 | obrig. | sim | — | — | — |
| `payment_terms` | 618 | obrig. | sim | — | — | — |
| `fin_categories` | 624 | obrig. | sim | — | — | — |
| `cost_centers` | 632 | obrig. | sim | — | — | — |
| `titles` | 634 | obrig. | sim | `idemKey` C/I | — | — |
| `installments` | 650 | obrig. | sim | — | — | — |
| `settlements` | 661 | obrig. | sim | `installmentId+seq` I; `idemKey` C/I | — | — |
| `fin_transfers` | 672 | obrig. | sim | `idemKey` C | — | — |
| `bank_imports` | 678 | obrig. | sim | `scopeKey` E | — | — |
| `bank_transactions` | 687 | obrig. | sim | `uniqueKey` I | — | — |
| `reconciliations` | 699 | obrig. | sim | — | — | — |
| `reconciliation_links` | 709 | obrig. | sim | — | — | — |
| `quotations` | 717 | obrig. | sim | — | — | — |
| `quotation_proposals` | 726 | obrig. | sim | `quotationId+supplierId` I | — | — |
| `purchase_orders` | 736 | obrig. | sim | `idemKey` C | — | — |
| `purchase_order_items` | 752 | obrig. | sim | — | — | — |
| `purchase_order_revisions` | 761 | obrig. | sim | — | — | — |
| `purchase_requests` | 767 | obrig. | sim | — | — | — |
| `approval_policies` | 778 | obrig. | sim | — | — | — |
| `approval_decisions` | 787 | obrig. | sim | — | — | — |
| `receipts` | 793 | obrig. | sim | `scopeKey` E | — | — |
| `inbound_ctes` | 822 | obrig. | sim | `scopeKey` E | — | — |
| `fiscal_configs` | 836 | obrig. | sim | `scopeKey` E | — | — |
| `tax_groups` | 852 | obrig. | sim | — | — | — |
| `fiscal_documents` | 870 | obrig. | sim | `ref` I/C | — | — |
| `fiscal_events` | 888 | obrig. | sim | — | — | — |
| `fiscal_obligations` | 894 | obrig. | sim | — | — | — |
| `fiscal_sim_state` | 903 | opcional | — | `ref` I/C | — | criado sem companyId (src/domain/fiscal/providers.ts:235) |
| `integrations` | 911 | obrig. | sim | `scopeKey` E | — | — |
| `integration_logs` | 920 | obrig. | sim | — | — | — |
| `webhook_events` | 926 | obrig. | sim | `externalId` N (sem uso) | — | — |
| `jobs` | 932 | opcional | — | `dedupeKey` I | — | sem companyId ⇒ contexto sem escopo no executor |
| `operations` | 941 | opcional | — | — | — | travas/marcadores; parte criada sem companyId |
| `notifications` | 946 | obrig. | sim | `dedupeKey` I | — | — |
| `audit_logs` | 956 | opcional | sim | — | — | login de usuário inexistente gravado com companyId nulo |
| `tickets` | 966 | obrig. | sim | — | — | companyId "public" (tela de login) visível às empresas |
| `ticket_messages` | 972 | obrig. | sim | — | — | idem `tickets` |
| `help_articles` | 978 | opcional | — | `slug` N | — | artigos globais (companyId nulo) |
| `backups` | 984 | obrig. | sim | — | — | — |
| `restore_jobs` | 993 | obrig. | sim | — | — | — |
| `accounting_clients` | 999 | obrig. | sim | — | `companyId+doc` | vínculo com a empresa do ERP (`linkedCompanyId`) · refs: `linkedCompanyId` |
| `accounting_client_people` | 1014 | obrig. | sim | — | — | — |
| `accounting_client_establishments` | 1023 | obrig. | sim | — | — | — |
| `accounting_client_regimes` | 1032 | obrig. | sim | — | — | — |
| `accounting_client_groups` | 1038 | obrig. | sim | — | — | — |
| `departments` | 1044 | obrig. | sim | — | `companyId+key` | — |
| `department_members` | 1050 | obrig. | sim | `departmentId+userId` I | — | — |
| `accounting_client_assignments` | 1056 | obrig. | sim | — | — | — |
| `accounting_deliveries` | 1062 | obrig. | sim | — | — | gravado pela empresa vinculada no escritório · refs: `sourceCompanyId` |
| `certificate_requests` | 1071 | obrig. | sim | — | `companyId+protocol` | lida/gravada pela equipe de certificação e pelo titular · refs: `linkedCompanyId` |
| `accounting_certificates` | 1091 | obrig. | sim | — | — | — |
| `cert_network_nodes` | 1103 | obrig. | sim | `nodeCompanyId` N | `companyId+code` | companyId "platform"; `nodeCompanyId` = empresa do nó · refs: `nodeCompanyId` |
| `cert_price_rules` | 1113 | obrig. | sim | — | — | — |
| `cert_customers` | 1123 | obrig. | sim | — | `companyId+doc` | — |
| `cert_voucher_packages` | 1132 | obrig. | sim | — | — | refs: `sellerCompanyId` |
| `cert_voucher_purchases` | 1138 | obrig. | sim | — | — | refs: `sellerCompanyId`, `buyerCompanyId` |
| `cert_voucher_lots` | 1147 | obrig. | sim | — | — | — |
| `cert_voucher_codes` | 1156 | obrig. | sim | `code` N (plataforma) | — | — |
| `cert_voucher_redemptions` | 1162 | obrig. | sim | — | — | refs: `requestCompanyId` |
| `cert_coupons` | 1168 | obrig. | sim | `code` N (plataforma) | — | — |
| `cert_coupon_uses` | 1177 | obrig. | sim | — | — | refs: `requestCompanyId` |
| `cert_coupon_holders` | 1183 | obrig. | sim | — | — | — |
| `cert_free_claims` | 1189 | obrig. | sim | — | — | refs: `requestCompanyId` |
| `cert_sale_cascades` | 1197 | obrig. | sim | — | — | refs: `requestCompanyId` |
| `cert_renewal_contacts` | 1203 | obrig. | sim | — | — | — |
| `cert_billing_agreements` | 1211 | obrig. | sim | — | — | — |
| `cert_wallets` | 1217 | obrig. | sim | — | — | refs: `childCompanyId`, `parentCompanyId` |
| `cert_wallet_moves` | 1223 | obrig. | sim | — | — | — |
| `cert_wallet_recharges` | 1229 | obrig. | sim | — | — | refs: `receivableCompanyId`, `payableCompanyId` |
| `cert_sale_finance` | 1238 | obrig. | sim | — | — | refs: `requestCompanyId`, `collectorCompanyId` |
| `cert_fin_entries` | 1247 | obrig. | sim | — | — | refs: `requestCompanyId`, `payerCompanyId`, `payeeCompanyId` |
| `cert_closings` | 1257 | obrig. | sim | — | — | refs: `payerCompanyId`, `payeeCompanyId`, `receivableCompanyId`, `payableCompanyId` |
| `stores` | 1268 | obrig. | sim | `slug` N; `previewToken` N | `companyId` | uma loja por empresa; `fulfillmentBranchId`, `pickupBranchIds` |
| `store_domains` | 1280 | obrig. | sim | `storeId+domain` I | — | — |
| `store_products` | 1291 | obrig. | sim | `storeId+productId` I; `storeId+slug` I | — | — |
| `store_carts` | 1302 | obrig. | sim | `token` N | — | — |
| `store_coupons` | 1312 | obrig. | sim | `storeId+code` I | — | — |
| `online_orders` | 1321 | obrig. | sim | `token` N; `idemKey` I | — | — |
| `online_order_events` | 1334 | obrig. | sim | — | — | — |
| `commerce_events` | 1340 | obrig. | sim | `externalKey` ⚠ | — | id = detId("cevent", externalKey) sem loja/empresa |
| `store_channels` | 1351 | obrig. | sim | `storeId+channel` I | — | — |
| `gateway_transactions` | 1360 | obrig. | sim | `orderId` I | — | — |
| `store_payouts` | 1370 | obrig. | sim | — | — | — |
| `files` | 1379 | obrig. | sim | — | — | metadados; conteúdo em Blob/`_intercert_files` sem empresa |

### 2.2 Coleções globais e com `companyId` opcional

| Grupo | Coleções | Consequência no `ScopedStore` |
|---|---|---|
| **Sem `companyId`** | `companies`, `users`, `sessions`, `auth_challenges`, `user_prefs`, `counters` | Passam direto (`scoped-store.ts:20-22,44,71`): todo Store "restrito" lê e grava qualquer empresa, usuário e numerador. |
| **`companyId` opcional** | `roles`, `fiscal_sim_state`, `jobs`, `operations`, `audit_logs`, `help_articles` | Registro com `companyId` nulo é **visível a todas as empresas** (`scoped-store.ts:46,74`). |
| **`companyId` obrigatório** (120 coleções) | demais | Obrigatoriedade conferida só na criação pelo backend (`src/lib/db/memory-store.ts:201`, `src/lib/db/postgres/store.ts:340`); `update` pode zerá-lo (seção 3.2). |
| **Pseudo-empresas** | `"platform"` (rede, parâmetros da plataforma), `"public"` (chamados da tela de login) | `"platform"` só é lido com `unscoped()`; `"public"` é visível em `tickets`/`ticket_messages` de **todas** as empresas (`scoped-store.ts:18,46,72-73`). |

### 2.3 Unicidade: global × por empresa × só na aplicação

| Dado | Regra hoje | Onde |
|---|---|---|
| E-mail do usuário | **único global** (`u_email`) | `schema.ts:111`; duplicidade revela o nome do outro usuário (`src/domain/users.ts:187-188`) |
| Login do usuário | índice **comum** (`i_login`); unicidade **global** só na aplicação (corrida pode duplicar); login de demonstração (`admin`, `caixa`, `gerente`…) ocupa o espaço de todas as empresas | `schema.ts:111`; `users.ts:189-192`; `src/lib/auth/users.ts:71-75`; `src/lib/auth/quick-access.ts:21-46` |
| CNPJ da empresa | **único global** (`u_cnpj`); mensagem revela o nome da empresa existente | `schema.ts:81`; `src/domain/companies.ts:142-147,201-204`; `src/domain/fiscal/config.ts:40-43`; `src/domain/network/nodes.ts:113-116` |
| CNPJ da filial | sem índice; conferido só dentro da empresa | `src/domain/companies.ts:274,315` |
| Documento de cliente/fornecedor | por empresa (`companyId+doc`) | `schema.ts:193,206` |
| Código de produto, PLU, SKU, unidade | por empresa | `schema.ts:216,238,259` |
| Código de barras | sem índice único (`i_barcode` comum); unicidade **por empresa** só na aplicação | `schema.ts:259`; `src/domain/products.ts:370` |
| Código de terminal | por empresa (`companyId+code`) | `schema.ts:153` |
| Código de filial / depósito | só na aplicação (empresa / filial) | `companies.ts:272-274`; `warehouses.ts:59-61` |
| Código de vale-crédito/fidelidade | **global** (`credit_vouchers.u_code`), mas gerado com o número **por empresa** + 4 hex | `schema.ts:573`; `src/domain/sales.ts:1479`; `src/domain/loyalty.ts:121` |
| Numeração de documentos (venda, título, pedido…) | contador por empresa; `sales.i_number(companyId, number)` é índice comum | seção 3.5 |
| Protocolo de certificado | por empresa (`companyId+protocol`) | `schema.ts:1088` |
| Endereço (slug) e domínio da loja | **global** por desenho (endereço público); domínio: 1 ativo por domínio, regra da aplicação | `schema.ts:1277,1288`; `src/domain/ecommerce/domains.ts:67-70,117-121` |
| Chaves de idempotência (`idemKey`) | **globais** em `sales`, `titles`, `returns`, `purchase_orders`, `promotions`, `fin_transfers`… | tabela 2.1 (classe C) |

### 2.4 Camada física (Postgres)

- Uma tabela por coleção, compartilhada por todas as empresas; `id` texto é a chave primária; colunas de campo sem
  `NOT NULL` (`src/lib/db/postgres/ddl.ts:61-64`); índices únicos **parciais** que ignoram nulo e vazio (`:74-76`), igual
  ao armazenamento em memória (`src/lib/db/memory-store.ts:134-147`). Sem RLS, sem chave estrangeira, sem esquema por
  empresa.
- Conteúdo de arquivos sem Blob: tabela `_intercert_files(id, bucket, data)` sem empresa (`ddl.ts:26,144`).
- O filtro de escopo gera `("companyId" = $1 OR "companyId" IS NULL)` em toda listagem; parte das coleções não tem índice
  começando por `companyId` (ex.: `sale_items`, `stock_movements`, `sale_payments`), o que pesa com muitas empresas.

---

## 3. Como o servidor determina a empresa de cada registro

### 3.1 Origem do `companyId` na criação

- O domínio grava `companyId` **explicitamente**, quase sempre `ctx.companyId` (207 ocorrências de
  `companyId: ctx.companyId`), muitas vezes num objeto `base` espalhado nas linhas filhas
  (ex.: `src/domain/companies.ts:279`, `src/domain/setup.ts:49`). Auditoria e arquivos usam `ctx.companyId`
  (`src/lib/core/audit.ts:38`, `src/lib/core/files.ts:238`); notificações e tarefas usam o `companyId` informado
  (`src/lib/core/notify.ts:71`, `src/lib/core/jobs.ts:35`); a rede usa `NETWORK_SCOPE = "platform"` (22 ocorrências).
- `ctx.companyId` vem da sessão (`src/lib/server/session.ts:72-73`), de `ctxForCompany()` (`src/lib/core/ctx.ts:51-55`),
  de `systemCtx()` (`ctx.ts:58-65`) ou de contextos delegados montados à mão
  (`src/domain/network/billing.ts:25-29`, `src/domain/network/nodes.ts:64-69`, `src/domain/accounting/certificates.ts:596,711`).
- **O `ScopedStore` não injeta `companyId`** (`scoped-store.ts:78-81`): sem o campo, a criação só falha nas coleções em
  que ele é obrigatório. Observação: `docs/analise-gestao-contabil.md:178` afirma que o `ScopedStore` "injeta companyId" —
  o código não faz isso.

### 3.2 `ScopedStore` operação por operação (`src/lib/db/scoped-store.ts`)

| Operação | Linhas | O que faz | O que **não** faz |
|---|---|---|---|
| `get` / `getOrThrow` | 56-68 | Lê do Store base e trata como inexistente o registro cujo `companyId` não é o ativo; nulo é visível; `"public"` visível em `tickets`/`ticket_messages` (`visible`, 43-47). | Não filtra coleções sem `companyId`. |
| `list` | 70-76 | Acrescenta `companyId = ativa OR companyId IS NULL` (chamados: `IN (ativa, "public") OR IS NULL`). | **Se algum filtro mencionar `companyId`** — `eq`, `ne`, `isNull`, `notNull`, inclusive dentro de `or`/`and` (`mentionsCompany`, 24-31) — a consulta vai ao base **sem escopo e sem pós-filtro** (71). Coleções sem `companyId` passam direto. |
| `create` | 78-81 | `assertWritable` (49-54): recusa `companyId` de outra empresa (`BusinessError "cross_company"`). | Não injeta `companyId`; aceita `companyId` ausente ou nulo. |
| `update` | 83-86 | `assertWritable` no *patch*. | **Não confere a empresa do registro-alvo**: atualiza por id registro de outra empresa; aceita `companyId: null`, tornando-o visível a todas. |
| `delete` | 88-90 | Repassa. | **Apaga por id registro de outra empresa.** |
| `increment` | 92-94 | Repassa. | **Incrementa campo de registro de outra empresa** (saldos, contadores, usos). |
| `transaction` | 96-98 | Reembrulha o `tx` num `ScopedStore` da mesma empresa (o escopo vale dentro da transação). | — |

Conclusão: o isolamento de **escrita por id** e de consultas que citam `companyId` depende inteiramente do padrão manual
`getOrThrow` + `assert(x.companyId === ctx.companyId)` usado nos módulos (ex.: `src/domain/products.ts:1015-1018`,
`src/domain/terminals.ts:134-135`, `src/domain/fiscal/config.ts:275-276`). O padrão está presente nos `delete` revisados,
mas não há defesa em profundidade.

### 3.3 Composição dos Stores e atalhos

| Peça | Comportamento | Cuidado |
|---|---|---|
| `getStore()` | `ReadCachedStore(PostgresStore \| MemoryStore \| AppwriteStore)` singleton (`src/lib/db/index.ts:46-66`) | **Sem escopo.** Composição da requisição: `ScopedStore → ReadCachedStore → PostgresStore` (`session.ts:36,73`). |
| `scopeStore(store, id)` | Desembrulha um `ScopedStore` e reembrulha com a nova empresa (`scoped-store.ts:102-106`) | **`scopeStore(store, "")` devolve o Store sem escopo** (`:103`). |
| `unscoped(store)` | Devolve `store.base` se for `ScopedStore` (`:109-111`) | Em `getStore()` é inócuo; sobre `readOnly(...)` não remove o somente-leitura (o `ReadOnlyStore` não é `ScopedStore`). |
| `readOnly(store)` | Recusa `create/update/delete/increment/transaction` com `PermissionError` (`src/lib/db/read-only.ts:9-56`) | Usado só em 2 lugares: leitor do escritório (`src/domain/accounting/link.ts:139`) e download de entrega (`src/app/api/files/[id]/route.ts:28`). |
| `ctxForCompany(ctx, id)` | Exige `isAdmin` ou `companyIds` contendo a empresa e devolve contexto restrito a ela, com `branchId` nulo (`src/lib/core/ctx.ts:51-55`) | `isAdmin` aceita **qualquer** id (inclusive `"platform"`). Permissão na empresa-alvo é conferida em `companyAdminCtx` (`src/domain/companies.ts:175-185`). |
| `systemCtx(store, id)` | Usuário "system" com `isAdmin: true`; Store restrito se `id` não for vazio (`ctx.ts:58-65`) | **Com `id` vazio, o Store fica sem escopo** — o executor de tarefas passa `job.companyId ?? ""` (`src/lib/core/jobs.ts:106`). |

### 3.4 Ids determinísticos (`detId`, `src/lib/db/ids.ts:13-15`)

`detId(...partes)` = SHA-256 truncado de `partes.join("|")`. Há cerca de 310 chamadas em `src`. Como o `get` restrito esconde o registro de
outra empresa, uma colisão de id entre empresas vira `ConflictError` (negação de serviço), não vazamento — **exceto** nos
caminhos com `unscoped()`, em que o registro alheio é encontrado e reaproveitado.

| Categoria | Exemplos |
|---|---|
| **Incluem a empresa** (diretamente ou via `scopeKey`) | `branch` (`companies.ts:280`), `terminal` (`terminals.ts:121`), `receipt` (`receipts.ts:619`), `product`/`customer`/`supplier` por idemKey (`products.ts:474`, `customers.ts:136`, `suppliers.ts:126`), `transfer`, `inventory`, `backup`, `role`, `ticket`, `sdoc`, `acct_client`, `cert_sale`, `seller`, `pimport`, `dimport`, `pricejob`, `obligation` (`fiscal/obligations.ts:101`), `approval-policy` (`approvals.ts:65`), `store` (`ecommerce/store.ts:320`), `setting` (`src/lib/core/settings.ts:4,9`), `integration` (`integrations.ts:268-269`), `fiscalcfg` (`fiscal/service.ts:102`), `fin_category` da rede (`network/billing.ts:71`). |
| **Derivados de ids da própria empresa** (seguros por construção) | `warehouse`/`account` (filial), `bal` (depósito+SKU, `stock.ts:113`), `sku` (produto), `invcount`, `inst`, `saleitem`, `salepay`, `retitem`, `poi`, `qprop`, `supprod`, `slisting`/`scart`/`scoupon`/`sdomain` (loja), `gwtx` (pedido), `delivery` (cliente+arquivo), `ticketmsg`, `notif` (`occurrenceKey` com id + usuário), `pref`/`mfa_use`/`login` (usuário), `cert_*` (venda/lote/carteira). |
| **De chaves do cliente ou externas, sem empresa** | `sale` (`sales.ts:285`), `title` (`finance.ts:96`), `settle` (`finance.ts:321`), `return` (`sales.ts:1336`), `po` (`purchases.ts:196`), `quotation` (`quotations.ts:87`), `promotion` (`promotions.ts:147`), `rsv`/`adj` (`stock.ts:369,516`), `asm`, `recon`, `fintransfer`, `pdvrec`, `replenishment-run`, `user` (`users.ts:261`), `mov` por idemKey, `entry`, `job` (`jobs.ts:30`), `intent` (`payments/intents.ts:87-88`), `fiscaldoc` (`fiscal/service.ts:950`; `ref = nfse-<idemKey>`, `:2047`), `fiscalsim`, **`cevent` (`ecommerce/common.ts:164`, chave externa do gateway/rotina)**. |
| **Globais por desenho** | `help` (slug), `cert_coupon` (código), `cert_free_claim` (CPF), `installation` (`api/setup/run/route.ts:17`), `demo`/`setup` (instalação). |

### 3.5 Numeradores (`nextNumber`, `src/lib/core/numbering.ts:5-17`)

`counters` não tem `companyId`; o id é `detId("counter", key)` e a empresa só existe se estiver na chave. Leitura/escrita
de qualquer contador passa pelo `ScopedStore` sem filtro.

| Escopo da chave | Chaves |
|---|---|
| **Por empresa** | `sale:<e>`, `return:<e>`, `title:<kind>:<e>`, `receipt:<e>`, `purchase_order:<e>`, `purchase_request:<e>`, `quotation:<e>`, `transfer:<e>`, `inventory:<e>:<ano>`, `customer:<e>`, `supplier:<e>`, `product:<e>`, `sales_document:<tipo>:<e>`, `cte:<e>`, `backup:<e>`, `ticket:<e>`, `pdvrec:<e>`, `dimport:<e>`, `pimport:<e>`, `acct_client:<e>`, `cert_request:<e>`, `cert_customer:<e>`, `online_order:<e>`, `commerce_event:<e>` |
| **Por empresa+filial+modelo+série** | `fiscalnum:<e>:<filial>:<modelo>:<série>` (`src/domain/fiscal/service.ts:195-197`) |
| **Por entidade (sem empresa na chave)** | `rps:<filial>` (`fiscal/service.ts:203`; ajuste em `fiscal/config.ts:94`), `cash:<terminal>` (`cash.ts:94`), `cashmov:<sessão>` (`cash.ts:172`), `transfer-separation:<id>` (`transfers.ts:107`), `cert_voucher_code:<lote>` (`network/vouchers.ts:390`) |
| **Globais / plataforma** | `network:node` (`network/nodes.ts:134`), `cert_closing` (`network/ledger.ts:534`), `cert_wallet_recharge` (`network/billing.ts:286`), `cert_voucher_package:platform` (`vouchers.ts:103`), `ticket:public` (`src/app/actions/public.ts:14`), `sim-nfse-number` (simulador fiscal compartilhado, `fiscal/providers.ts:374`) |

Os ids das entidades são da própria empresa, então as chaves "por entidade" não colidem; mas (i) o ajuste de numeração
(`setNextNumber`, `fiscal/config.ts:90-107`) só é seguro porque o chamador passa `requireBranch(s.ctx)`
(`src/app/(app)/fiscal/actions.ts:318`), e (ii) a cópia de segurança só leva contadores cuja chave contém o id da empresa
(`src/domain/backup.ts:146-147`) — `rps:`, `cash:`, `cashmov:` etc. ficam de fora.

### 3.6 Parâmetros (`settings`, `src/lib/core/settings.ts`)

- `scopeKey = "<companyId>|<branchId ou *>|<chave>"` e id `detId("setting", scopeKey)` (`:4,9,12,17-18`); leitura
  filial → empresa → padrão (`:7-14`). O mesmo esquema é repetido em `src/app/(app)/administracao/parametros/params.ts:14-15`.
- Padrões por tipo de empresa (`KIND_FEATURE_DEFAULTS`, `:81-92`) e chaves de recurso `feature.<x>` (`:104-106`).
- Marcadores de rotina `routine.<x>.lastRun` por empresa (`src/domain/scheduler.ts:26-31`).
- Parâmetros da plataforma com `companyId = "platform"`: `network` (`network/common.ts:82,110`), `certification`
  (`accounting/certificates.ts:88,132`), `keepalive` (`api/keepalive/route.ts:24-25`) — só legíveis com `unscoped()`;
  pelo Store restrito o `get` devolve nulo e vale o padrão.
- Fuso: único da instalação (`APP_TIMEZONE`), não por empresa/filial (`companies.ts:287`).

### 3.7 Cache de leitura (`src/lib/db/read-cache.ts`)

- Fica **abaixo** do `ScopedStore`. Memória por requisição (React `cache`, `:18-27`) e memória **compartilhada por
  instância** de 15 s só para `companies`, `branches`, `roles`, `settings`, `payment_methods` (`:15-16,45-49`).
- Chave da listagem = coleção + `JSON.stringify(opts)` **depois** de o `ScopedStore` acrescentar o filtro da empresa
  (`:83`); chave do `get` não tem empresa (`:73`), mas o `ScopedStore` aplica `visible` sobre o resultado. Não foi
  encontrado caminho de vazamento pelo cache.
- Limites: invalidação só na instância que gravou (`:32-36`) — outra instância pode servir perfil, parâmetro ou
  situação de empresa antigos por até 15 s (revogação de permissão, inativação, liga/desliga de recurso); o mapa
  compartilhado não tem limite de tamanho (`:19`) e cresce com combinações de filtros × empresas.

### 3.8 Arquivos (`src/lib/core/files.ts`)

Metadados em `files` (com `companyId`, `:237-250`); conteúdo no Blob em `<bucket>/<id>` (`:98-103`) ou em
`_intercert_files` (`:130-138`), **sem empresa no caminho**. O isolamento é a checagem `meta.companyId !== ctx.companyId`
em `readFile` (`:253-258`), na rota `/api/files/[id]` (`src/app/api/files/[id]/route.ts:19-36`) e na imagem da vitrine
(`src/app/loja/[store]/imagem/[id]/route.ts:15-17`).

### 3.9 Tarefas e rotinas

- `runDueJobs` lista tarefas vencidas de **todas** as empresas (`src/lib/core/jobs.ts:77-86`) e executa cada uma com
  `systemCtx(store, job.companyId ?? "", …)` (`:106`). É disparado pelo cron (`src/app/api/jobs/route.ts:17-19`), **após
  qualquer ação de usuário de qualquer empresa** (`src/lib/server/background-jobs.ts:13-27`, chamado em
  `src/lib/server/action.ts:31`) e na restauração (`src/app/(app)/administracao/backups/actions.ts:50`).
- `runScheduled` percorre todas as empresas × rotinas em série com o Store **sem escopo** (`src/domain/scheduler.ts:20-37`).
  Cada rotina recebe `(store, companyId)` e escolhe: `systemCtx` (`src/domain/routines/fiscal.ts:17,51`,
  `src/domain/backup.ts:636`, `src/domain/accounting/certificates.ts:876`, `src/domain/sales-documents.ts:1039`,
  `src/domain/carts.ts:274`) ou filtro manual `["eq","companyId",companyId]` (`routines/finance.ts:17`,
  `routines/purchases.ts:16`, `routines/stock.ts:15,40`, `routines/fiscal.ts:26,56`, `carts.ts:268`).
  `expirePendingOrders` só filtra se receber a empresa (`src/domain/ecommerce/orders.ts:328-331`; todos os chamadores
  passam).

---

## 4. Inventário de `unscoped(` e de acesso direto ao Store sem escopo

### 4.1 Critério e totais

`rg -o "unscoped\(" src` → **301 ocorrências** em 299 linhas; descontadas a definição e 3 comentários
(`scoped-store.ts:15,109`, `schema.ts:1101`, `network/common.ts:20`), são **297 chamadas**:

| Área | Chamadas |
|---|---|
| Rede de certificação (`src/domain/network`) | 112 |
| Comércio digital (`src/domain/ecommerce`) | 85 |
| Telas e rotas (`src/app`) | 31 |
| Núcleo do domínio (`two-factor`, `users`, `companies`, `roles`, `approvals`, `fiscal/files`) | 28 |
| Contábil e certificados (`src/domain/accounting`) | 26 |
| Demonstração (`src/domain/seed`) | 10 |
| `src/lib` (`notify`, `role-sync`, `auth/users`) | 5 |

Classes: **(a)** legítimo entre empresas (escritório ↔ empresa vinculada, rede, equipe de certificação, administração
multiempresa autorizada); **(b)** rotina do sistema, instalação ou autenticação; **(c)** rota pública (loja, avisos do
gateway, link compartilhado); **(d)** risco de vazamento — **(d) concreto** quando há caminho atual de leitura/escrita
indevida ou revelação de dado de outra empresa; **(d) latente** quando o uso é da própria empresa, o `unscoped()` é
desnecessário e o isolamento depende só de checagem manual (uma omissão futura vaza sem nenhuma barreira).

> Observação geral: em `users` e `companies` o `unscoped()` é **redundante** — essas coleções não têm `companyId` e o Store
> restrito já as lê por inteiro (seção 4.9).

### 4.2 Núcleo (`src/lib` e domínio)

| Local | Função | Finalidade | Classe | Por quê / observação |
|---|---|---|---|---|
| `src/lib/core/notify.ts:28` | `resolveAudience` | Ler todos os perfis para resolver o perfil do usuário na empresa da notificação | (b) | Também lista **todos** os usuários (`:26`) e inclui todo `isAdmin` (`:31`): administradores globais recebem notificações de todas as empresas. |
| `src/lib/auth/role-sync.ts:72` | `syncRoleTemplate` | Gravar operações novas do modelo em perfil de sistema e a auditoria (empresa do perfil) | (b) | Roda na montagem de sessão (`src/lib/auth/users.ts:53`). |
| `src/lib/auth/role-sync.ts:102` | `syncSystemRoles` | Rotina `admin.roles` | (b) | — |
| `src/lib/auth/users.ts:29` | `userRoleIn` | Ler perfil explícito/legado por id e o equivalente da empresa-alvo | (b) | — |
| `src/lib/auth/users.ts:84` | `accessibleUnits` | Listar todas as empresas e filiais e filtrar | (b) | Varredura completa por sessão. |
| `src/domain/two-factor.ts:42` | `recentLoginFailures` | Contar falhas de login para bloqueio | (b) | — |
| `src/domain/two-factor.ts:50` | `logLoginAttempt` | Registrar tentativa de login | (b) | Grava `companyId = companyIds[0]` ou **nulo** se o login não existe (`:52`): o registro nulo (com o texto digitado e o IP) é visível a todas as empresas pelo Store restrito. |
| `src/domain/two-factor.ts:71, 84, 142, 144, 155, 168, 174, 190` | 2ª etapa do login | Perfil exigido, trava de uso único em `operations` com `companyId: null` (`:89`), desafios | (b) | — |
| `src/domain/two-factor.ts:247, 268, 283, 312, 323` | autenticador do próprio usuário | Ler/gravar o próprio `users` | (b) | Redundante. |
| `src/domain/users.ts:123` | `manageableCompanyIds` | Ler o próprio cadastro | (b) | — |
| `src/domain/users.ts:151` | `companyNames` | Nomes das empresas do usuário-alvo para a mensagem de recusa | **(d) concreto** | A mensagem (`:164-166`) lista empresas em que o gestor **não** tem acesso — revela outras contratantes ligadas ao mesmo usuário. |
| `src/domain/users.ts:198` | `validateInput` | Validar empresas, filiais e perfil informados | (a) | E-mail/login duplicado revela o nome do usuário de outra empresa (`:188,191`). |
| `src/domain/users.ts:314` | `updateUser` | Preservar vínculos com filiais fora do alcance do gestor | (a) | — |
| `src/domain/users.ts:542` | `adminResetTwoFactor` | Limpar 2FA após `loadManagedUser` + `assertManagesWholeUser` | (a) | — |
| `src/domain/roles.ts:184` | `usersByRole` | Contagem de usuários por perfil | (b) | Lê todos os usuários e perfis. |
| `src/domain/roles.ts:198` | `roleUsers` | Usuários de um perfil (id validado pelo chamador) | (b) | — |
| `src/domain/companies.ts:149, 154` | `createCompany` | Criar empresa nova e parametrização; vincular o criador | (a) | Exige só `admin/criar` (`:140`): qualquer administrador de empresa cria novas empresas na instalação. Duplicidade revela o nome da empresa existente (`:143-147`). |
| `src/domain/companies.ts:179` | `companyAdminCtx` | Ler o próprio cadastro para avaliar o perfil na empresa-alvo | (a) | — |
| `src/domain/companies.ts:189` | `branchAdminCtx` | Ler filial de qualquer empresa e então validar acesso | (a) | — |
| `src/domain/approvals.ts:128` | `usersWithRoles` | Perfis para resolver aprovadores | (b) | Também lista todos os usuários (`:126`). |
| `src/domain/fiscal/files/settings.ts:104` | `loadAccountant` | Dados do escritório vinculado (registro 0100) | (a) | Redundante (`companies`). |

### 4.3 Contábil e certificados (`src/domain/accounting`)

| Local | Função | Finalidade | Classe | Observação |
|---|---|---|---|---|
| `certificates.ts:88, 132` | `certificationSettings`, `saveCertificationSettings` | Catálogo/parâmetros da certificação em `settings` "platform" | (a) | Gravação exige `certification.operate` ou `network.manage` (`:95`) — ver R4. |
| `certificates.ts:147, 170, 206` | autorização de acompanhamento | Ler integração da empresa vinculada; gravar auditoria/notificação no escritório e na empresa | (a) | Consentimento do titular. |
| `certificates.ts:383, 391, 399, 614, 677` | `logEvent`, `notifyFirm`, `notifyTeam`, notificações | Auditoria/notificação na empresa dona da solicitação | (a) | — |
| `certificates.ts:407, 420` | `loadForActor`, `patch` | Ler/gravar a solicitação pela equipe ou pelo dono | (a) | Guarda: equipe (`certification.operate`) ou dono (`:409-417`). |
| `certificates.ts:596, 711` | contexto do escritório | `scopeStore(unscoped(...), r.companyId)` para ler arquivo do escritório | (a) | — |
| `certificates.ts:641, 702` | titular autoriza / baixa | Ler solicitação por id e conferir `linkedCompanyId === ctx.companyId` ou dono | (a) | Exige confirmação de senha no download. |
| `certificates.ts:840, 857` | `listCertificationQueue`, `teamCertificateRequest` | Fila de **todas** as solicitações de **todos** os escritórios | (a) | Só `certification.operate` (`:839,856`) — operação concedível por qualquer administrador de empresa (R4). |
| `certificates.ts:866` | `companyCertificateRequests` | Solicitações abertas para a empresa titular | (a) | — |
| `certificates.ts:873` | `notifyCertificateDeadlines` | Rotina diária do escritório | (b) | — |
| `link.ts:70, 96, 125` | aceitar/desfazer/consultar vínculo | Achar cliente pelo hash do código; gravar nos dois lados | (a) | Consentimento das duas partes; CNPJ conferido (`:75`). |
| `link.ts:139` | `linkedCompanyReader` | Store **somente leitura** restrito à empresa vinculada | (a) | Exige vínculo ativo e cliente do próprio escritório (`:137-138`). |
| `deliveries.ts:32` | `deliverPackageToFirm` | Empresa grava a entrega na caixa do escritório | (a) | Confere vínculo ativo e destino (`:39-40`). |
| `deliveries.ts:106` | `deliveryForFile` | Autorizar o escritório a baixar o arquivo da empresa | (a) | Entrega antiga continua baixável após revogar o vínculo (por desenho); a rota não aplica a carteira restrita do analista (`visibleClientIds`). |

### 4.4 Rede de certificação (`src/domain/network`)

Registros da plataforma (`companyId = "platform"`) são lidos/gravados sempre com `unscoped()` e a visibilidade de
`computeVisible`/`visibleNodeIds` (`common.ts:163-189`); títulos de cada camada são gravados no financeiro da empresa da
camada por contexto delegado restrito (`billing.ts:25-29`, usuário técnico `isAdmin: true`, `:32`).

| Local | Função | Finalidade | Classe | Observação |
|---|---|---|---|---|
| `common.ts:82, 110, 130, 142` | parâmetros da rede | Ler/gravar `platform\|*\|network` | (a) | Gravação exige `network.manage` (R4). |
| `common.ts:121` | `savePlatformFinance` | Conferir a empresa escolhida como plataforma | (a) | — |
| `common.ts:150, 155` | `allNodes`, `nodeOfCompany` | Todos os nós; nó de uma empresa | (a) | Base da visibilidade. |
| `common.ts:195` | `auditNode` | Auditoria também na empresa do nó | (a) | — |
| `nodes.ts:66` | `delegatedCtx` | Contexto na empresa nova (usuário com `isAdmin: true`) só para o convite | (a) | Restrito à empresa nova. |
| `nodes.ts:72` | `createNode` | Criar parceiro/escritório e nó, ou **vincular escritório existente pelo CNPJ** | **(d) concreto** | `:91-99`: qualquer nó com `network.children` coloca abaixo de si, como Contador, o escritório de **outra contratante** apenas pelo CNPJ, sem consentimento; `:93` e `:113-116` revelam o nome de qualquer empresa pelo CNPJ. |
| `nodes.ts:167, 209` | `moveNode`, `setNodeStatus` | Plataforma muda/suspende nós | (a) | Guarda `isPlatform` (`:164,207`). |
| `nodes.ts:251 (2×), 258` | `nodeUsers`, `nodeHistory` | Usuários da empresa do nó; histórico do nó | (a) | Guarda `getNode` (`:50-55`). |
| `prices.ts:89, 196, 311, 322` | regras de preço | Regras em cascata da plataforma | (a) | — |
| `sales.ts:177` | `findDuplicates` | Procurar certificado do mesmo titular em qualquer canal | (a) por desenho | Revela a qualquer vendedor a existência e validade de certificado de um CPF/CNPJ em outra empresa (sem protocolo) — ponto de LGPD. |
| `sales.ts:245, 307, 400, 469, 486, 494` | BirdID gratuito, contador de cupom, ganchos de emissão/cancelamento | Registros da plataforma por titular | (a) | `cert_free_claims` é único por CPF na instalação. |
| `sales.ts:349, 535, 587` | criar venda / venda do escritório / retrato | Gravar venda e cascata completa | (a) | — |
| `sales.ts:457` | aviso à equipe | `notify` sem escopo | (a) | — |
| `sales.ts:570, 579` | `saleCascade(s)` | Ler retrato completo | (a) | Mascarado por `maskCascade`. |
| `sales.ts:632, 664` | `listNetworkSales`, `getNetworkSale` | Vendas dos nós visíveis | (a) | Guarda `saleVisible` (`:620-626`). |
| `renewals.ts:97, 303, 313, 323, 328, 340, 345` | renovações | Certificados e contatos dos nós visíveis; rotina | (a) | Contato exige certificado da própria empresa (`:304`). |
| `coupons.ts:74, 95, 109, 123, 134, 159, 175, 197, 205, 228` | cupons da rede | Cupons/usos (código único global) | (a) | Guarda `couponForManage` (`:108-116`). |
| `vouchers.ts:105, 114, 118, 127, 207, 298, 316, 323, 327, 353, 378, 389, 410, 437, 446` | vouchers | Pacotes, lotes e códigos da plataforma | (a) | — |
| `vouchers.ts:153, 164` | financeiro da compra | Categoria/títulos no financeiro de comprador e vendedor | (a) | Contexto delegado (`:170`). |
| `billing.ts:26, 38, 61, 87, 106, 120, 139, 162, 195, 227, 242, 278, 330, 375, 400, 405` | modalidade, carteira, recargas | Registros da plataforma; categorias e conta de recebimento na empresa da camada | (a) | Guarda `canBillChild` (`:131-136`). |
| `ledger.ts:41, 63, 102, 110, 166, 179, 211, 220, 269, 305, 343, 373, 443, 480, 509, 522, 563, 616, 648, 657, 674, 678, 684, 689` | razão da rede | Lançamentos por camada, fechamentos e títulos em cada empresa | (a) | Estorno: plataforma ou `certification.operate` (`:342`). |
| `results.ts:38, 118, 229, 266` | resultado da rede | Fluxos e fechamentos de todas as camadas | (a) | Recorte por `visible`. |

### 4.5 Comércio digital (`src/domain/ecommerce`)

O módulo usa `unscoped()` também nas telas internas, porque as mesmas funções servem a vitrine (Store sem escopo) e a
gestão (Store restrito); o isolamento é feito por `requireStore(ctx)` (loja da empresa ativa, `common.ts:100-104`) mais
`storeId === st.id` / `companyId === ctx.companyId`.

| Local | Função | Finalidade | Classe | Observação |
|---|---|---|---|---|
| `cart.ts:28, 36, 48, 115, 127, 133, 143, 149, 193, 279` | carrinho | Carrinho pela loja + token; cupom; frete; contato | (c) | `cartView` descarta SKU de outra empresa (`:194`). |
| `checkout.ts:141, 301` | `placeOrder`, `createChargeFor` | Pedido público, reserva (`:222`) e cobrança | (c) | — |
| `storefront.ts:30`; `domains.ts:173, 175` | resolução da loja | Loja por endereço ou domínio verificado | (c) | — |
| `shipping.ts:57, 81` | frete | Embalagem e opções | (c) | — |
| `catalog.ts:366, 367, 378, 471, 472, 487` | vitrine | Catálogo, produto, imagem pública | (c) | Filtra por produtos da loja/`st.companyId`. |
| `orders.ts:50` | `orderByToken` | Acompanhamento do pedido | (c) | Confere `storeId` (`:51`). |
| `orders.ts:55, 62, 117, 183, 245, 262` | `storeOf`, `patchOrder`, `handlePaymentEvent`, `markPaid`, `cancelInternal` | Efeitos do pedido (vitrine, gateway, rotina e gestão) | (c)/(b) | Efeitos usam `storeCtx` restrito à empresa da loja (`common.ts:107-110`). |
| `common.ts:96` | `storeOfCompany` | Loja de uma empresa | (b) | — |
| `common.ts:163, 204` | `commerceEvent`, `settleCommerceEvent` | Monitor; idempotência por `externalKey` | **(d) concreto** | Id `detId("cevent", externalKey)` sem loja/empresa (`:164`): um evento com a mesma chave em outra empresa é encontrado, tem `attempts` incrementado (`:167-170`) e o efeito do chamador é descartado como "repetido" (`orders.ts:112`). Ver `pagamentos/page.tsx:42` (4.7). |
| `orders.ts:331` | `expirePendingOrders` | Rotina/checkout | (b) | Filtra empresa quando informada. |
| `catalog.ts:51, 55, 106, 111`; `orders.ts:555`; `store.ts:576` | listagens, estoque da loja, linha do tempo, domínio principal | Usadas pela vitrine e pela gestão | (c) / (d) latente | — |
| `catalog.ts:151, 184, 272, 287, 318, 327` | catálogo (gestão) | Incluir, editar, publicar, validar | (d) latente | Produto conferido (`:180`), fotos conferidas (`:241-244`). |
| `orders.ts:43` | `orderOfCompany` | Pedido da empresa ativa | (d) latente | Checagem explícita (`:44`). |
| `orders.ts:396, 499` | `consumeStock`, `completeReturn` | Baixa/devolução de estoque do pedido | **(d) latente (grave)** | Passa Store **sem escopo** para `postMovements`; `ensureBalance` não confere empresa do depósito/SKU (`src/domain/stock.ts:188-197`). Hoje os itens vêm do próprio pedido. |
| `store.ts:264` | `uniqueSlug` | Endereço da loja único na instalação | (a)/(c) | Espaço de nomes público. |
| `store.ts:320, 336, 552, 563` | criar/editar/publicar/pausar a loja | Loja da empresa ativa | (d) latente | — |
| `promotions.ts:39, 52, 87, 128, 157` | cupons e carrinhos abandonados | Gestão | (d) latente | Confere `storeId` (`:89,159`). |
| `channels.ts:43, 57` | canais | Gestão | (d) latente | — |
| `domains.ts:54, 66, 111, 146, 158` | domínios | Gestão | (d) latente | `addDomain` consulta o domínio em todas as lojas (`:67-70`), por desenho. |
| `bank.ts:31, 33, 41, 46, 70, 74, 85, 117, 131` | recebimentos e repasses | Gestão financeira da loja | (d) latente | Confere `storeId` (`:86-87`). |
| `monitor.ts:19, 46, 69, 84, 88, 116` | monitor | Eventos e reprocessamento | (d) latente | Confere `companyId` do evento (`:47,117`). |
| `fiscal.ts:44, 82, 96, 102` | NF-e do pedido | Pré-preenchimento, emissão, sincronização | (d) latente | Confere `companyId` (`:45,83,105`). |

### 4.6 Demonstração (`src/domain/seed`)

`seed/modules/network.ts:68, 256`; `seed/modules/ecommerce.ts:112, 122, 132, 194, 212, 221, 244, 263` — carga da
demonstração — **(b)**. Ponto de atenção: a demonstração cria o perfil "Gestão da rede Intercert (DEMO)" com
`network.manage` e `certification.operate` (`seed/modules/network.ts:111-114`) e a "Equipe de certificação (DEMO)"
(`seed/modules/certificates.ts:40-43`), usados pelos logins públicos `rede` e `certificacao`
(`src/lib/auth/quick-access.ts:34,36`).

### 4.7 Telas e rotas (`src/app`)

| Local | Finalidade | Classe | Observação |
|---|---|---|---|
| `api/keepalive/route.ts:21` | Sinal diário em `settings` "platform" | (b) | Redundante (`getStore()` já é sem escopo). |
| `api/files/[id]/route.ts:28` | Download de arquivo entregue ao escritório | (a) | `readOnly(scopeStore(...))`. |
| `api/loja/gateway/[provider]/[storeId]/route.ts:20, 39` | Aviso do gateway: loja por id e pedidos da loja | (c) | Assinatura obrigatória (`:26`). |
| `(app)/rede/parametros/page.tsx:20, 21` | Lista **todas as empresas** da instalação e o histórico da rede | (a) | Só plataforma (`:17`) — R4. |
| `(app)/rede/cupons/page.tsx:36` | Vendedores dos nós visíveis | (a) | — |
| `(app)/rede/[id]/page.tsx:37` | Empresa do nó | (a) | Guarda `getNode` (`:30`). |
| `(app)/rede/vendas/page.tsx:52` | Nomes dos vendedores | (a) | — |
| `(app)/rede/vendas/nova/page.tsx:46` | Certificado anterior (renovação) | (a) | Confere `companyId` (`:47`). |
| `(app)/rede/vendas/[id]/page.tsx:44` | Histórico da venda na empresa vendedora | (a) | Venda já validada (`:34`). |
| `(app)/administracao/certificacao/[id]/page.tsx:99` | Solicitação na empresa do escritório | (a) | `certification.operate` (`:88`). |
| `(app)/administracao/usuarios/queries.ts:15` | Todos os perfis para resolver o perfil na empresa | (b) | — |
| `(app)/administracao/usuarios/[id]/page.tsx:36 (2×)` | Todas as empresas e filiais | **(d) concreto** | Exibe nomes de todas as empresas do usuário, inclusive as que o leitor não acessa (`:48`). |
| `(app)/administracao/usuarios/form-data.ts:18` | Filiais das empresas administráveis | (a) | Filtra por `manageableCompanyIds`. |
| `(app)/administracao/empresas/queries.ts:13` | Contagens de empresas autorizadas | (a) | Lê todos os usuários/filiais/terminais e filtra. |
| `(app)/administracao/empresas/[id]/page.tsx:40` | Perfis para resolver o perfil dos usuários | (b) | — |
| `(app)/comercio-digital/page.tsx:75`; `editor/page.tsx:61`; `pedidos/page.tsx:29`; `pedidos/[id]/page.tsx:30, 35`; `expedicao/page.tsx:27, 30`; `monitor/page.tsx:36`; `pagamentos/page.tsx:40` | Telas da loja da empresa ativa | (d) latente | Checagens explícitas (`pedidos/[id]:31`, `expedicao:31`, `monitor:37`). |
| `(app)/comercio-digital/pagamentos/page.tsx:42` | Último evento de pagamento do pedido do simulador | **(d) concreto** | `orderId` vem de `?pedido=` **sem conferir** que o pedido é da loja; a chave externa e o tipo do evento de outra empresa vão para campos ocultos (`:103-107`). Com `repeatOf` livre (`comercio-digital/actions.ts:439-440` → `checkout.ts:338`), a ação grava no evento da outra empresa (incrementa tentativas) e um evento ainda não recebido por ela pode ser "pré-ocupado" e descartado como repetido. Exige conhecer o id do pedido/evento alheio. |
| `(app)/comercio-digital/actions.ts:257, 269, 396` | Fotos do produto; teste de cupom | (d) latente | Cupom confere loja (`:397`). |

### 4.8 Acesso direto ao Store sem escopo (sem chamar `unscoped`)

| Local | Uso | Classe |
|---|---|---|
| `src/lib/server/session.ts:36` | Montar a sessão e o `ScopedStore` | (b) |
| `src/lib/server/bootstrap.ts:14, 31, 46`; `src/app/api/setup/run/route.ts:44`; `src/app/actions/setup.ts:54` | Instalação, demonstração, diagnóstico | (b) |
| `src/app/actions/session.ts:22, 57, 112, 154, 176-177, 194, 225, 278, 292`; `src/app/api/unit/route.ts:12-13`; `src/app/(app)/layout.tsx:15`; `src/app/(auth)/login/duas-etapas/page.tsx:22`; `src/app/(app)/conta/seguranca/page.tsx:17, 19` | Login, 2ª etapa, troca de unidade, recuperação, convite, conta | (b) |
| `src/app/(auth)/selecionar-unidade/page.tsx:15` | Lista **todas** as filiais da instalação e filtra | (b) |
| `src/app/(auth)/login/access.ts:62` | Acesso rápido: lista pública de usuários `isDemo` | (c) — ver R4 |
| `src/app/actions/public.ts:13` | Chamado sem login, `companyId: "public"` | (c) — ver R6 |
| `src/app/documento/[token]/page.tsx:21` | Orçamento/pedido por token de 128 bits | (c) |
| `src/app/loja/[store]/_lib.ts:27`; `src/app/api/loja/gateway/[provider]/[storeId]/route.ts:19` | Vitrine; aviso do gateway | (c) |
| `src/app/api/jobs/route.ts:17`; `src/lib/server/background-jobs.ts:22`; `src/app/(app)/administracao/backups/actions.ts:50` | Executor de tarefas (todas as empresas) e rotinas | (b) |
| `src/lib/core/jobs.ts:106` | `systemCtx(store, job.companyId ?? "")` | (b) — **(d) latente**: tarefa sem empresa roda sem escopo como "system" `isAdmin` |
| `src/domain/scheduler.ts:20-37` | Rotinas por empresa com Store sem escopo | (b) — **(d) latente**: cada rotina filtra à mão |
| `src/lib/core/email.ts:12` | Canal de e-mail da empresa informada | (b) |
| `src/lib/core/files.ts:126, 200` | `postgresStore()` + SQL em `_intercert_files` | (b) |
| `src/domain/backup.ts:493` | `new MemoryStore()` para restauração de teste | (b) |
| `systemCtx(...)` com empresa explícita: `carts.ts:274`, `pending-invoice.ts:233`, `backup.ts:636`, `sales-documents.ts:1039`, `ecommerce/common.ts:108`, `routines/fiscal.ts:17, 51`, `accounting/certificates.ts:876` | Contexto técnico restrito | (b) |
| `src/lib/server/session.ts:62` | `new ScopedStore(store, "")` no contexto incompleto (deliberadamente **não** usa `scopeStore`) | (b) |

### 4.9 Escopo que não protege: coleções sem `companyId` lidas pelo Store restrito

Mesmo sem `unscoped()`, estes acessos leem dados de todas as empresas: `listAll(store, "users")` em `notify.ts:26`,
`approvals.ts:126`, `src/domain/users.ts:84-85` (`companyUsers`), `src/domain/companies.ts:364,422`,
`src/lib/server/lookups.ts:42` (`nameMap` de usuários sem filtro); `listAll(ctx.store, "companies")` em
`src/domain/companies.ts:146` e `src/app/(app)/administracao/empresas/page.tsx:26-28` (o número exibido da empresa é a
posição dela entre **todas** as empresas da instalação). Administradores globais aparecem na lista de usuários de toda
empresa (`src/domain/users.ts:83-86`, `:109`).

---

## 5. Testes de isolamento existentes

### 5.1 O que já comprovam

| Teste | O que comprova |
|---|---|
| `tests/scoped-store.test.ts:6-27` | `get`/`getOrThrow` escondem a outra empresa; `list` sem filtro só traz a ativa; artigos globais e chamado `"public"` visíveis; `create` e `update` com `companyId` alheio são recusados; o escopo vale na transação; `unscoped()` reabre. Só `MemoryStore`, sem o cache. |
| `tests/admin-access.test.ts:70-123` | Administração de outra empresa autorizada (editar, filial, vínculos) funciona; sem acesso ou com perfil de Caixa na empresa-alvo, tudo é recusado (perfil por empresa); CNPJ reutilizado nunca sobrescreve empresa existente. |
| `tests/admin-access.test.ts:125-203` | Gestor não-administrador não altera administrador global nem vincula a empresa alheia; vínculos fora do alcance são preservados; perfil de uma empresa não vale na outra. |
| `tests/admin-access.test.ts:289-299` | Restauração/verificação recusa cópia ou tarefa de outra empresa. |
| `tests/admin-round2.test.ts:144-160` | Filial inativada ⇒ API responde 409 (nunca opera sem escopo/`branchId` nulo). |
| `tests/admin-round2.test.ts:189` | Notificação por módulo alcança perfil legado de outra empresa (equivalente de sistema). |
| `tests/customers.test.ts:39-61, 62-100` | Inativar/excluir/editar cliente de outra empresa é recusado tanto pela checagem explícita (Store sem escopo) quanto pelo Store restrito; documentos fiscais só da empresa ativa; mesmo CPF pode existir em outra empresa. |
| `tests/finance-fixes.test.ts:49-82` | Baixa recusa conta financeira de outra empresa sem alterar saldo; estorno, cancelamento e aprovação com contexto alheio são recusados. |
| `tests/cash.test.ts:142-150` | Fechamento de caixa recusa conta de destino de outra empresa. |
| `tests/products.test.ts:147-170` | Categoria/marca e parâmetros de estoque de outra empresa não são alterados pelo id. |
| `tests/purchases-fixes.test.ts:249-260` | Fornecedor de outra empresa é recusado e não aparece na cotação. |
| `tests/fiscal-fixes.test.ts:99-111, 320` | Documento fiscal de outra empresa não é consultado/transmitido; escritas exigem a filial do documento. |
| `tests/stock-fixes.test.ts:357`; `tests/goals.test.ts:70`; `tests/round3-admin-painel.test.ts:39-128` | Restrição de filial (dentro da empresa) em estoque, metas e cadastro de usuário. |
| `tests/accounting.test.ts:94-100, 139, 201-213` | Cliente de um escritório não aparece nem abre no outro; carteira restrita do analista; leitura da empresa vinculada é somente leitura e outro escritório não lê. |
| `tests/certificates.test.ts:161, 244` | Arquivo de outro titular recusado; carteira restrita e fila da equipe. |
| `tests/network.test.ts:155-170`; `tests/network-sales.test.ts:154, 424`; `tests/network-billing.test.ts:180, 457` | Visibilidade da rede (si mesmo e descendentes; nunca irmãos/ancestrais), custos acima do pai mascarados. |
| `tests/read-cache.test.ts:11-57` | Cache: segunda leitura não vai ao banco, gravação invalida, cópias, transação limpa. |
| `tests/quick-access-pin.test.ts:154-162` | Com empresa real na instalação, o acesso rápido continua listando só a demonstração (contas reais nunca entram). |

### 5.2 O que não é testado

- `update`/`delete`/`increment` por id de registro de outra empresa via Store restrito (passam — Apêndice A).
- Filtro mencionando `companyId` (`eq` alheio, `ne`, `notNull`) desligando o escopo.
- `update` com `companyId: null`; registros nulos em `audit_logs`, `jobs`, `operations`, `fiscal_sim_state`.
- Coleções globais (`users`, `companies`, `counters`) lidas/gravadas por contexto de outra empresa.
- Composição real `ScopedStore → ReadCachedStore → PostgresStore` (a suíte usa `MemoryStore` ou Postgres embutido sem o
  cache, `tests/helpers.ts:11-22`).
- Conteúdo da cópia de segurança quanto a usuários de outras empresas e campos de credencial (`tests/backup.test.ts`).
- Chamados `"public"` vistos por empresas diferentes.
- Concessão de `network.manage`/`certification.operate` por administrador de empresa comum.
- Comércio digital entre duas empresas (nenhum teste cria duas lojas em `tests/ecommerce.test.ts`).
- Tarefas sem `companyId` e rotinas que esqueçam o filtro.

---

## 6. Lacunas e riscos para o modelo multiempresa (priorizados)

**P0 — críticos (impedem isolamento integral)**

1. **R1 · Escrita por id sem conferência de dono no `ScopedStore`.** `update`, `delete` e `increment` atingem qualquer
   empresa; `update` aceita `companyId: null` (registro vira global) (`scoped-store.ts:49-54,83-94`). Todo o isolamento
   de escrita depende do padrão manual `getOrThrow + assert` em cada função.
2. **R2 · Filtro em `companyId` desliga o escopo.** `mentionsCompany` aceita qualquer menção, de qualquer valor, sem
   pós-filtrar o resultado (`scoped-store.ts:24-31,71`). Hoje os filtros usam `ctx.companyId`, mas um `companyId` vindo de
   entrada, payload ou registro errado lê outra empresa sem barreira.
3. **R3 · Coleções globais e superadministrador.** `users`, `companies`, `counters`, `user_prefs`, `sessions`,
   `auth_challenges` não são filtradas; `users.isAdmin` dá acesso a todas as empresas (`src/lib/auth/users.ts:86`,
   `src/lib/core/ctx.ts:53`) e recebe notificações de todas (`notify.ts:31`); e-mail/login/CNPJ globais com mensagens que
   revelam nomes de outras empresas e usuários (`src/domain/users.ts:188,191`, `companies.ts:144`, `nodes.ts:115`).
   Não existe a figura "administrador da contratante" separada do administrador da plataforma.
4. **R4 · Poderes de plataforma concedíveis por qualquer empresa.** `normalizeActions` aceita `network.manage` e
   `certification.operate` em perfis de qualquer empresa (`src/domain/roles.ts:84-87,212-226`); `isPlatform` não confere
   empresa (`network/common.ts:62-64`). Quem tem `admin.users` concede a si mesmo e passa a ver/gravar a rede inteira
   (`rede/parametros/page.tsx:20` lista todas as empresas) e a fila de certificados de todos os escritórios
   (`accounting/certificates.ts:838-853`). Com `SHOW_DEMO_LOGIN=1`, os logins públicos `rede` e `certificacao` já têm
   esses poderes numa instalação compartilhada (`quick-access.ts:34,36`; `seed/modules/network.ts:111-114`).
5. **R5 · Cópia de segurança com credenciais de terceiros.** A cópia da empresa inclui todos os `isAdmin` e todo usuário
   com vínculo a ela (inclusive vínculos com outras empresas), sem remover `passwordHash`, `totpSecretEnc`,
   `totpRecoveryHashes`, `inviteTokenHash`, `resetTokenHash` (`backup.ts:140-145,166-210`); o download exige só
   `admin.backup` (`src/app/api/files/[id]/access.ts:32-33`).

**P1 — altos**

6. **R6 · Pseudo-empresa `"public"` compartilhada.** Chamados da tela de login (nome, e-mail, mensagem) aparecem e são
   respondidos por qualquer empresa com `support.manage` (`scoped-store.ts:18,72-73`; `src/domain/support.ts:72,311-312`);
   a resposta sai pelo canal de e-mail da empresa que atendeu (`support.ts:219`).
7. **R7 · Criação de empresas e CNPJ global.** Qualquer perfil com `admin/criar` cria empresas de qualquer tipo na
   instalação (`companies.ts:139-140`; `src/app/(app)/administracao/empresas/actions.ts:22,31`); o CNPJ único global
   (`schema.ts:81`) permite "ocupar" o CNPJ de terceiro e serve de oráculo de existência.
8. **R8 · Vínculo de escritório à rede sem consentimento** (`network/nodes.ts:91-99`), ao contrário do vínculo contábil,
   que exige código (`accounting/link.ts:13-20`).
9. **R9 · Credenciais por nome de variável de ambiente, espaço único da instalação.** A integração guarda o NOME da
   variável e só confere o prefixo do provedor (`src/domain/integrations.ts:299-305,394-402`; uso em
   `src/lib/core/email.ts:17-19`): uma empresa pode apontar para a variável de outra (ex.: `FOCUSNFE_TOKEN_<outra>`).
10. **R10 · Tarefas e rotinas sem escopo por padrão.** Tarefa sem `companyId` roda sem escopo como "system" `isAdmin`
    (`jobs.ts:106`; `ctx.ts:60,63`); `scopeStore(store, "")` devolve o Store sem escopo (`scoped-store.ts:103`); rotinas
    recebem o Store sem escopo e filtram à mão (`scheduler.ts:20-37`); a requisição de uma empresa executa tarefas de
    outras (`background-jobs.ts:22`).
11. **R11 · Comércio digital fora do `ScopedStore`.** 85 chamadas, muitas em telas internas; ponto concreto em
    `pagamentos/page.tsx:42` + `repeatOf` (seção 4.7); `commerce_events.externalKey` global
    (`ecommerce/common.ts:164-170`); baixa de estoque do pedido com Store sem escopo e `ensureBalance` sem conferência de
    empresa (`ecommerce/orders.ts:396,499`; `stock.ts:188-197`).
12. **R12 · Códigos e chaves globais derivados de dados por empresa.** `credit_vouchers.code` global gerado a partir do
    número da empresa + 4 hex (`schema.ts:573`; `sales.ts:1479`; `loyalty.ts:121`) — com muitas empresas, a colisão é
    provável e derruba a devolução/fidelidade com conflito; ids/índices de idempotência sem empresa (`sale`, `title`,
    `settle`, `return`, `po`… seção 3.4) transformam colisão em negação de serviço.

**P2 — médios**

13. **R13 · Registros com `companyId` nulo vistos por todas as empresas**: auditoria de login inexistente
    (`two-factor.ts:52`), `fiscal_sim_state` (`fiscal/providers.ts:235-238`), marcadores em `operations`
    (`jobs.ts:92`, `two-factor.ts:89`), tarefas sem empresa; a linha do tempo por entidade lista `audit_logs` sem filtro de
    empresa e herda esses nulos (`src/components/ui/timeline.tsx:11-12`).
14. **R14 · Revelações informativas entre empresas**: nomes das outras empresas de um usuário
    (`usuarios/[id]/page.tsx:36,48`; `users.ts:150-166`), posição/quantidade de empresas (`empresas/page.tsx:26-28`),
    administradores globais em toda lista de usuários (`users.ts:83-86`), certificados de um CPF em outra empresa
    (`network/sales.ts:170-177`, por desenho).
15. **R15 · Cache entre instâncias**: perfis, parâmetros e situação da empresa podem ficar até 15 s desatualizados por
    instância; mapa compartilhado sem limite (`read-cache.ts:15-19,32-36`).
16. **R16 · Camada física sem fronteira**: tabelas compartilhadas sem RLS/`NOT NULL`/FK (`ddl.ts:61-79`); arquivos sem
    prefixo de empresa (`files.ts:98,132`); não há exportação/remoção por empresa no banco (a restauração só ocorre em base
    nova ou de teste, `backup.ts:482-494`).
17. **R17 · Numeradores fora da cópia**: chaves `rps:<filial>`, `cash:<terminal>`, `cashmov:<sessão>` não contêm a empresa
    e não entram no backup (`backup.ts:146-147`) — restaurar reinicia essas sequências (RPS repetido).

**P3 — escala e modelo**

18. **R18 · Varreduras globais por requisição**: `accessibleUnits` (todas as empresas e filiais por sessão),
    `notify`/`companyUsers`/`usersByRole` (todos os usuários e perfis), `runScheduled` serial por empresa dentro do limite
    de 300 s do cron (`src/app/api/jobs/route.ts:10`); índices de várias coleções não começam por `companyId`.
19. **R19 · Filial não é fronteira de dados**: a restrição de filial é filtro de cada módulo (`src/lib/server/lookups.ts:48-50`,
    `src/app/(app)/estoque/queries.ts:16-40`) e `users.branchIds` é plano entre empresas (`src/lib/auth/users.ts:87-89`).
20. **R20 · Rede e certificação como serviço único da instalação**: uma só plataforma (`"platform"`), BirdID gratuito
    único por CPF na instalação (`cert_free_claims`), códigos de cupom/voucher globais — adequado a um único operador
    (Intercert), a decidir se o modelo multiempresa prevê várias plataformas.

---

## Apêndice A — sondagem do `ScopedStore`

Script executado com `tsx` **fora do repositório** (nenhum arquivo do projeto alterado), usando `MemoryStore`,
`scopeStore`, `unscoped` e `readOnly` reais:

```ts
const base = new MemoryStore();
await base.create("customers", { companyId: "A", personType: "PF", name: "Cliente A" }, "ca");
await base.create("customers", { companyId: "B", personType: "PF", name: "Cliente B" }, "cb");
const a = scopeStore(base, "A");
await a.update("customers", "cb", { name: "alterado por A" });        // passa
await a.increment("credit_vouchers", "v1", "balance", 5000);         // v1 é da empresa B: passa
await a.list("customers", { filters: [["eq", "companyId", "B"]] });   // devolve cb
await a.list("customers", { filters: [["ne", "companyId", "A"]] });   // devolve cb
await a.update("customers", "ca2", { companyId: null });             // ca2 passa a ser visível para B
await a.delete("customers", "cb");                                   // apaga o registro de B
```

Resultado: `update` alterou o cliente de B; `increment` levou o saldo de 1000 para 6000; as duas listagens devolveram
`["cb"]`; `list("users")`, `list("companies")` e `get("counters", …)` devolveram os registros da outra empresa;
`companyId: null` tornou o registro visível pelo Store da empresa B; `delete` apagou o registro de B;
`unscoped(readOnly(scopeStore(base,"B")))` continuou somente leitura; `scopeStore(base, "")` devolveu o próprio `base`.

## Apêndice B — comandos usados no levantamento

- `rg -n "unscoped\(" src` e `rg -o "unscoped\(" src | wc -l` (contagem e linhas).
- `rg -n "getStore\(\)|systemCtx\(|scopeStore\(|ctxForCompany\(|readOnly\(|postgresStore\(\)" src` (acessos sem escopo).
- `rg -n "nextNumber\(|peekNumber\(" src` e `rg -o "detId\([^;]{0,140}" src` (numeradores e ids determinísticos).
- Tabela da seção 2.1 gerada a partir de `COLLECTIONS` (`src/lib/db/schema.ts`) com `tsx`, fora do repositório.
