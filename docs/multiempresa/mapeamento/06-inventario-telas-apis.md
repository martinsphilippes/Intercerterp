# 06 — Inventário de telas, rotas de API e server actions (mapeamento multiempresa)

Inventário feito só pela leitura do código, sem alterar nada. Revisão analisada: `0aa96c2` (18/11/2026). As referências usam o formato `arquivo:linha`.

**Método.** Scripts de leitura (`rg` e `node`, executados fora do repositório) extraíram as guardas de cada `page.tsx`, `route.ts` e arquivo de server actions. Para as ações, os scripts seguiram as funções de domínio importadas até 3 níveis, procurando `requirePerm`, `requireAction`, `canDo`/`can`, `isPlatform`, carteira e visibilidade da rede. Também marcaram os usos de `unscoped`, `getStore()`, `scopeStore`, `ctxForCompany`, `systemCtx` e `linkedCompanyReader`. Todos os casos fora do padrão foram revisados à mão. A numeração das telas da referência está em `docs/matriz-cobertura.md`. Identidade, sessão e o modelo de perfis estão detalhados em `02-identidade-e-permissoes.md`.

**Números.**

| Item | Quantidade |
|---|---|
| Telas (`page.tsx`) | **220**: 204 autenticadas (grupo `(app)`), 8 de acesso público `(auth)`, 6 da vitrine (`/loja`), 1 documento público e 1 raiz |
| Rotas de API e handlers (`route.ts`) | **19**: 14 em `/api`, 2 no grupo `(app)` e 3 na vitrine. Há ainda `middleware.ts` e `manifest.ts` |
| Arquivos de server actions | **53**: 50 `actions.ts` e 3 em `src/app/actions/` |
| Funções exportadas nesses arquivos | **421**: 396 autenticadas, todas com `runAction`, e 25 públicas |
| Itens de menu | `NAV` 83, `NAV_ACCOUNTING` 33 e `NAV_CERTIFICATION` 30 |
| Módulos / operações especiais | 15 módulos × CRUD e 60 operações especiais (`src/lib/permissions.ts`) |
| Coleções do esquema | 132. Destas, 126 têm `companyId`; não têm `companies`, `users`, `sessions`, `auth_challenges`, `user_prefs` e `counters` |

## Sumário

1. [Modelo de autorização e de escopo](#1-modelo-de-autorização-e-de-escopo-como-ler-as-tabelas)
2. [Telas](#2-telas-220-pagetsx)
3. [Rotas de API e entradas públicas](#3-rotas-de-api-routets-e-entradas-públicas)
4. [Server actions por arquivo](#4-server-actions-por-arquivo)
5. [Menu × página × ação](#5-menu-navts--página--ação)
6. [Dependências externas relevantes para multiempresa](#6-dependências-externas-relevantes-para-multiempresa)
7. [Achados priorizados](#7-achados-priorizados)

---

## 1. Modelo de autorização e de escopo (como ler as tabelas)

### 1.1 Guardas

| Guarda | Arquivo | O que exige | Falha |
|---|---|---|---|
| `requireSession(mód?, op = "view")` | `src/lib/server/session.ts:90` | Login, mais contexto de trabalho completo (empresa ativa e filial, ou consolidado), mais `can(usuário, mód, op)` | `/login`, `/selecionar-unidade` ou `/sem-permissao` |
| Layout `(app)` | `src/app/(app)/layout.tsx:10` | `requireSession()` **sem módulo**. Monta o menu filtrado por módulo (`view`), `action`, `anyAction` e recurso | Layout e página renderizam em paralelo, por isso **cada página repete a sua guarda** |
| `requireFirmSession(op)` | `src/app/(app)/contabil/guard.ts:11` | `accounting` (op) e empresa ativa com `kind = "accounting"` | `/sem-permissao` ou `/dashboard` |
| `requireNetworkSession()` | `src/app/(app)/rede/shared.tsx:14` | `dashboard` (ver) e recurso `redeCertificacao` ligado. As regras finas ficam no domínio (`networkViewer`, `isPlatform`) | `/sem-permissao` ou 404 |
| `ecomPage(ops)` / `ecomStorePage(ops)` | `src/app/(app)/comercio-digital/_lib.ts:29` | `sales` (ver), recurso `comercioDigital` e **uma** das operações listadas. A variante `*` exige que a loja já exista | `/sem-permissao` ou `/comercio-digital` |
| `requireFeaturePage(s, chave)` | `src/lib/server/features.ts:18` | Recurso ligado (`feature.<chave>`, por filial e empresa) | 404 |
| `runAction({module, op, requireBranch})` | `src/lib/server/action.ts:16` | `requireSession()`, depois `can(módulo, op)` (a negativa é auditada) e, se pedido, filial específica | `{ ok:false, code:"forbidden" }` |
| `requireAction` / `requirePerm` / `auditedGuard` | `src/lib/core/ctx.ts:33-38`, `src/domain/roles.ts:150` | Operação especial e módulo **no domínio**: a maior parte das operações especiais é conferida aqui | `PermissionError` |
| `requireFeature(s, chave)` | `src/lib/server/features.ts:23` | Recurso ligado, nas ações | `BusinessError feature_off` |
| `requireApiSession()` | `src/lib/server/session.ts:104` | Login e contexto completo, para os route handlers | 401 ou 409 |

### 1.2 Escopo de empresa

- **Empresa ativa.** Vem do cookie `ic_unit` (`empresa:filial`), validado a cada requisição contra `accessibleUnits` (`src/lib/auth/users.ts:82`). O contexto recebe `ctx.store = ScopedStore(empresa ativa)` (`session.ts:73`). O perfil é resolvido **pela empresa ativa** (`roleByCompany`, em `toCtxUser`).
- **`ScopedStore`** (`src/lib/db/scoped-store.ts`):
  - `get` trata registro de outra empresa como inexistente.
  - `list` acrescenta o filtro da empresa, mas **não** o faz quando o filtro já menciona `companyId` (`:24`, `:70`).
  - `create`/`update` recusam `companyId` de outra empresa.
  - **`delete` e `increment` não conferem a empresa** (`:88`, `:92`).
  - Registros com `companyId` nulo (globais) são visíveis. Os `public` só aparecem em `tickets`/`ticket_messages`.
  - Coleções sem `companyId` (`users`, `companies`…) **não são filtradas**.
- **Saídas explícitas do escopo.**
  - `unscoped()`.
  - `ctxForCompany()` → `companyAdminCtx()` / `branchAdminCtx()`, para outra empresa autorizada, com o perfil **daquela** empresa (`src/domain/companies.ts:175-194`).
  - `scopeStore(unscoped(...), outra)`.
  - `linkedCompanyReader()`: leitura somente leitura da empresa vinculada a um escritório (`src/domain/accounting/link.ts:136`).
  - `systemCtx()`: tarefas.
  - `getStore()` direto: rotas públicas, cron, sessão e vitrine.
- **Escopos especiais.**
  - `companyId = "platform"`: nós da rede, regras de preço, parâmetros da rede e da certificação, *keepalive*.
  - `companyId = "public"`: chamados abertos na tela de login.
- **`isAdmin`.** É o administrador geral: `can`/`canDo` sempre verdadeiros (`src/lib/permissions.ts:274-282`), acesso a todas as empresas e “plataforma” da rede.
- **Recursos (feature flags).** Ficam por empresa ou filial e são alteráveis em Parâmetros por quem tem `admin` (editar).

### 1.3 Legenda das tabelas

- **Guarda.** `` `mód` (op) `` = `requireSession`. **F** = `requireFirmSession`. **N** = `requireNetworkSession`. **E / E\*** = `ecomPage` / `ecomStorePage` (operações sem o prefixo `ecommerce.`).
- **Recurso.** `requireFeaturePage`: com o recurso desligado, a resposta é 404.
- **Operações especiais.** **▸** bloqueia a tela (redireciona, devolve 404 ou mostra um aviso no lugar do conteúdo). **·** só habilita botões, abas ou formulários; a ação correspondente confere de novo no servidor (seção 4).
- **Outras empresas.** “—” significa que a tela só lê a empresa ativa (`ScopedStore`). Os códigos **A1–A7** e **D1–D18** remetem à seção 7.

---

## 2. Telas (220 `page.tsx`)

Regra geral: as 204 telas do grupo `(app)` passam pelo layout (sessão e contexto), e 198 delas chamam a própria guarda com módulo. As outras 6 são:

- `/financeiro` e `/fiscal`, que só redirecionam;
- `/sem-permissao`, que é estática;
- `/conta/seguranca`, `/caixa/recebimentos/[id]` e `/financeiro/receber/[id]/carne`, que exigem só a sessão e aplicam regra própria.

A raiz `/` fica fora do grupo e só redireciona.

Ponto comum a muitas telas: a coleção `users` é global. Consultas como `lookups.users`, `portfolioRefs`, as de `estoque/queries.ts` e `dashboard/queries.ts` e a política de compras leem **todos os usuários da instalação** e filtram em memória (D1). Isso não aparece linha a linha.

### Administração (28)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/administracao/backups` | `admin` (ver) | — | · `admin.backup` | Lista só cópias da empresa ativa; o **conteúdo** da cópia inclui usuários vinculados + todos os administradores globais (ver A2) |
| `/administracao/backups/[id]` | `admin` (ver) | — | · `admin.backup` | Idem (cópia conferida `companyId` = ativa) |
| `/administracao/certificacao` | `admin` (ver) | — | ▸ `certification.operate` (→ /sem-permissao) | **Sim** — fila de solicitações de certificado de TODAS as empresas (`listCertificationQueue`, unscoped) |
| `/administracao/certificacao/[id]` | `admin` (ver) | — | ▸ `certification.operate` (→ /sem-permissao)<br>· `accounting.certificates` | **Sim** — solicitação de qualquer empresa (unscoped) e histórico/evidências na empresa dona (`scopeStore`) |
| `/administracao/empresas` | `admin` (ver) | — | — | **Sim (autorizadas)** — lista as empresas acessíveis ao usuário (leitura unscoped de companies/branches/users/terminals filtrada por `s.companies`); `?empresa=` abre filiais de outra empresa via `companyView` |
| `/administracao/empresas/[id]` | `admin` (ver) | — | — | **Sim (autorizada)** — `companyView` → `companyAdminCtx` (perfil admin NAQUELA empresa); aba usuários lê users/roles sem escopo |
| `/administracao/empresas/[id]/editar` | `admin` (editar) | — | — | **Sim (autorizada)** — `companyView(…, "edit")` |
| `/administracao/empresas/[id]/filiais/nova` | `admin` (criar) | — | — | **Sim (autorizada)** — `companyView(…, "create")` |
| `/administracao/empresas/filiais/[id]` | `admin` (ver) | — | — | **Sim (autorizada)** — `branchView` → `branchAdminCtx` (empresa da filial) |
| `/administracao/empresas/nova` | `admin` (criar) | — | — | Cria **nova empresa** (unscoped); o criador vira administrador dela |
| `/administracao/historico` | `admin` (ver) | — | — | — (registros de outras empresas/plataforma também gravam no histórico desta empresa) |
| `/administracao/historico/[id]` | `admin` (ver) | — | — | — |
| `/administracao/importacao` | `admin` (ver) | `importacaoCadastros` | — | — |
| `/administracao/importacao/[id]` | `admin` (ver) | — | — | — |
| `/administracao/integracoes` | `admin` (ver) | — | · `admin.integrations` | — |
| `/administracao/integracoes/[kind]` | `admin` (ver) | — | · `admin.integrations` | `accounting`: vínculo com o escritório (cliente e empresa do escritório) e solicitações de certificado abertas pelo escritório para esta empresa (unscoped) |
| `/administracao/parametros` | `admin` (ver) | — | · `admin.backup` | — |
| `/administracao/terminais` | `admin` (ver) | — | — | — |
| `/administracao/terminais/[id]` | `admin` (ver) | — | — | — |
| `/administracao/terminais/[id]/teste-impressao` | `admin` (ver) | — | — | — |
| `/administracao/terminais/novo` | `admin` (criar) | — | — | — |
| `/administracao/usuarios` | `admin` (ver) | — | · `admin.users` | Usuários vinculados + administradores globais; perfis de **todas** as empresas lidos sem escopo para resolver o perfil nesta |
| `/administracao/usuarios/[id]` | `admin` (ver) | — | · `admin.users` | Nomes de empresas/filiais do usuário em outras empresas (unscoped) |
| `/administracao/usuarios/[id]/editar` | `admin` (editar) | — | ▸ `admin.users` (→ /sem-permissao); alvo administrador global só por administrador global | Empresas/filiais em que o editor administra usuários (`manageableCompanyIds`, branches unscoped) |
| `/administracao/usuarios/novo` | `admin` (criar) | — | ▸ `admin.users` (→ /sem-permissao) | Idem (opções de empresas/filiais autorizadas) |
| `/administracao/usuarios/perfis` | `admin` (ver) | — | · `admin.users` | Contagem de usuários por perfil lê users/roles sem escopo (`usersByRole`) |
| `/administracao/usuarios/perfis/[id]` | `admin` (ver) | — | · `admin.users` | Idem (`roleUsers`) |
| `/administracao/usuarios/perfis/novo` | `admin` (criar) | — | ▸ `admin.users` (→ /sem-permissao) | — |

### Ajuda e suporte (5)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/ajuda` | `support` (ver) | — | · `support.manage` | **Sim** — chamados `public` (tela de login) para quem tem `support.manage` em qualquer empresa |
| `/ajuda/artigos/[slug]` | `support` (ver) | — | — | Artigos globais (`companyId` nulo) + da empresa |
| `/ajuda/chamados` | `support` (ver) | — | · `support.manage` | **Sim** — idem (`queryTickets` escopo `all` = empresa + `public`) |
| `/ajuda/chamados/[id]` | `support` (ver) | — | · `support.manage` | **Sim** — chamado `public` abre para `support.manage`; lista de usuários global filtrada em memória |
| `/ajuda/chamados/novo` | `support` (criar) | — | — | — |

### Caixa (8)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/caixa` | `cash` (ver) | — | — | — |
| `/caixa/[id]` | `cash` (ver) | — | · `cash.reopen` | — |
| `/caixa/[id]/relatorio` | `cash` (ver) | — | — | — |
| `/caixa/abertura` | `cash` (criar) | — | — | — |
| `/caixa/fechamento` | `cash` (editar) | — | · `cash.reopen` | — |
| `/caixa/movimentos` | `cash` (ver) | — | · `cash.reopen`, `cash.withdrawal` | — |
| `/caixa/movimentos/[id]/comprovante` | `cash` (ver) | — | — | — |
| `/caixa/recebimentos/[id]` | sessão (sem módulo) | — | ▸ módulo `pdv` OU `cash` OU `finance` (ver) (→ /sem-permissao) | — |

### Clientes (5)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/clientes` | `customers` (ver) | — | — | — |
| `/clientes/[id]` | `customers` (ver) | — | — | — |
| `/clientes/[id]/editar` | `customers` (editar) | — | — | — |
| `/clientes/fidelidade` | `customers` (ver) | `fidelidade` | — | — |
| `/clientes/novo` | `customers` (criar) | — | — | — |

### Comércio digital (13)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/comercio-digital` | E: `sales` (ver) + recurso `comercioDigital` + uma de {manage, catalog, orders, cancel, marketing, finance} | — | · `ecommerce.manage` | unscoped em store_products/online_orders filtrado pela loja da empresa |
| `/comercio-digital/banco` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {finance, manage} | — | · `ecommerce.finance` | — |
| `/comercio-digital/canais` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {manage, catalog} | — | · `ecommerce.manage` | — |
| `/comercio-digital/catalogo` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {catalog, manage} | — | · `ecommerce.catalog` | — |
| `/comercio-digital/editor` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {manage, catalog, marketing} | — | · `ecommerce.manage` | unscoped em store_products filtrado por `storeId` |
| `/comercio-digital/expedicao` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {orders, manage} | — | · `ecommerce.orders` | unscoped em online_orders; pedido da URL conferido (`companyId` e `storeId`) |
| `/comercio-digital/frete` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {manage, orders} | — | · `ecommerce.manage` | — |
| `/comercio-digital/modelos` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {manage, catalog, marketing} | — | · `ecommerce.manage` | — |
| `/comercio-digital/monitor` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {manage, orders, finance} | — | · `ecommerce.manage` | unscoped em commerce_events; evento da URL conferido (`companyId`) |
| `/comercio-digital/pagamentos` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {manage, finance, orders} | — | · `ecommerce.manage`, `ecommerce.finance` | unscoped; **último evento lido pelo `orderId` da URL sem conferir loja/empresa** (D16) |
| `/comercio-digital/pedidos` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {orders, cancel, finance, manage} | — | — | unscoped em online_orders filtrado por `storeId` |
| `/comercio-digital/pedidos/[id]` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {orders, cancel, finance, manage} | — | · `fiscal.issue`, `ecommerce.cancel`, `ecommerce.orders` | unscoped; pedido conferido (`companyId` e `storeId`) |
| `/comercio-digital/promocoes` | E\*: `sales` (ver) + recurso `comercioDigital` + uma de {marketing, manage} | — | · `ecommerce.marketing` | — |

### Compras (20)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/compras/aguardando-nota` | `purchases` (ver) | `notaAConfirmar` | · `purchase.receive_pending_invoice` | — |
| `/compras/aprovacoes` | `purchases` (ver) | — | · `purchase.approve` | — |
| `/compras/aprovacoes/[id]` | `purchases` (ver) | — | — | — |
| `/compras/aprovacoes/politica` | `purchases` (ver) | — | · salvar a política exige `admin` (editar) | Lista global de usuários filtrada em memória |
| `/compras/cotacoes` | `purchases` (ver) | — | — | — |
| `/compras/cotacoes/[id]` | `purchases` (ver) | — | — | — |
| `/compras/cotacoes/nova` | `purchases` (criar) | — | — | — |
| `/compras/cte` | `purchases` (ver) | `cteEntrada` | · `purchase.receive` | — |
| `/compras/cte/[id]` | `purchases` (ver) | — | — | — |
| `/compras/pedidos` | `purchases` (ver) | — | · `purchase.receive` | — |
| `/compras/pedidos/[id]` | `purchases` (ver) | — | · `purchase.receive` | — |
| `/compras/pedidos/[id]/editar` | `purchases` (editar) | — | — | — |
| `/compras/pedidos/novo` | `purchases` (criar) | — | — | — |
| `/compras/precificacao` | `purchases` (ver) | `precificacaoEntrada` | ▸ `purchase.pricing` + `products` (ver) (→ /sem-permissao) | — |
| `/compras/recebimentos` | `purchases` (ver) | — | · `purchase.receive`, `purchase.receive_pending_invoice` | — |
| `/compras/recebimentos/[id]` | `purchases` (ver) | — | · `purchase.receive`, `fiscal.issue`, `purchase.confirm_invoice`, `purchase.receive_pending_invoice` | — |
| `/compras/recebimentos/[id]/precificacao` | `purchases` (ver) | `precificacaoEntrada` | ▸ `purchase.pricing` + `products` (ver) (→ /sem-permissao) | — |
| `/compras/recebimentos/novo` | `purchases` (ver) | — | · `purchase.receive`, `purchase.receive_pending_invoice` | — |
| `/compras/reposicao` | `purchases` (ver) | — | — | — |
| `/compras/reposicao/[skuId]` | `purchases` (ver) | — | — | — |

### Conta do usuário (1)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/conta/seguranca` | sessão (sem módulo) — próprio usuário | — | — | Documento global do próprio usuário (`getStore()`) |

### Gestão contábil (escritório) (11)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/contabil` | F: `accounting` (ver) + empresa tipo escritório | — | · `accounting.all_clients`, `accounting.manage_team` | **Sim (vinculadas)** — resumo das empresas vinculadas da carteira visível (`linkedSnapshot` via `linkedCompanyReader`, só leitura) |
| `/contabil/certificados` | F: `accounting` (ver) + empresa tipo escritório | — | · `accounting.certificates`, `accounting.all_clients` | **Sim (vinculadas)** — certificados A1 das empresas vinculadas que autorizaram o acompanhamento (fiscal_configs, só leitura) |
| `/contabil/certificados/[id]` | F: `accounting` (ver) + empresa tipo escritório | — | ▸ solicitação na carteira visível (aviso; 404 se inexistente)<br>· `certification.operate`, `accounting.certificates` | Solicitação do escritório (certificate_requests); a equipe é enviada à fila |
| `/contabil/certificados/nova` | F: `accounting` (criar) + empresa tipo escritório | — | ▸ `accounting.certificates` (aviso no lugar do formulário) | — |
| `/contabil/clientes` | F: `accounting` (ver) + empresa tipo escritório | — | · `accounting.all_clients`, `data.export` | **Sim (vinculadas)** — `linkedSummaries` dos clientes da página (só leitura) |
| `/contabil/clientes/[id]` | F: `accounting` (ver) + empresa tipo escritório | — | ▸ cliente na carteira visível (`getClient`; 404)<br>· `accounting.link`, `accounting.manage_team`, `accounting.certificates` | **Sim (vinculada)** — documentos, obrigações, certificados e pacotes da empresa vinculada (`linkedCompanyReader`, só leitura) |
| `/contabil/clientes/[id]/editar` | F: `accounting` (editar) + empresa tipo escritório | — | ▸ cliente na carteira visível (404) | — |
| `/contabil/clientes/novo` | F: `accounting` (criar) + empresa tipo escritório | — | — | — |
| `/contabil/entregas` | F: `accounting` (ver) + empresa tipo escritório | — | · `data.export` | **Sim (vinculadas)** — entregas recebidas; download do arquivo na empresa de origem via `/api/files` (A6) |
| `/contabil/equipe` | F: `accounting` (ver) + empresa tipo escritório | — | · `accounting.manage_team`, `accounting.all_clients` | — |
| `/contabil/grupos` | F: `accounting` (ver) + empresa tipo escritório | — | · `accounting.all_clients` | — |

### Painel (2)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/dashboard` | `dashboard` (ver) | — | — | — |
| `/dashboard/metas` | `dashboard` (ver) | — | · `data.export` | — |

### Estoque (12)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/estoque` | `stock` (ver) | — | — | — |
| `/estoque/inventario-fiscal` | `stock` (ver) | `inventarioFiscal` | · `data.export` | — |
| `/estoque/inventarios` | `stock` (ver) | — | — | — |
| `/estoque/inventarios/[id]` | `stock` (ver) | — | · `stock.inventory_close` | — |
| `/estoque/montagem` | `stock` (ver) | `kits` | · `stock.adjust` | — |
| `/estoque/movimentos` | `stock` (ver) | — | · `stock.adjust` | — |
| `/estoque/transferencias` | `stock` (ver) | — | — | — |
| `/estoque/transferencias/[id]` | `stock` (ver) | — | — | — (origem/destino sempre filiais da empresa ativa) |
| `/estoque/transferencias/[id]/editar` | `stock` (editar) | — | — | — |
| `/estoque/transferencias/depositos` | `stock` (criar) | — | — | — |
| `/estoque/transferencias/novo` | `stock` (criar) | — | — | — |
| `/estoque/validades` | `stock` (ver) | `lotes` | — | — |

### Financeiro (22)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/financeiro` | — (só `redirect` para /financeiro/receber) | — | — | — |
| `/financeiro/cadastros` | `finance` (ver) | — | · `data.export` | — |
| `/financeiro/cartoes` | `finance` (ver) | — | · `finance.settle` | — |
| `/financeiro/cartoes/adquirente` | `finance` (ver) | `taxasCartao` | · `finance.settle` | — |
| `/financeiro/cartoes/adquirente/[id]` | `finance` (ver) | `taxasCartao` | · `data.export` | — |
| `/financeiro/cobranca/modelos` | `finance` (ver) | `cobrancaWhatsapp` | — | — |
| `/financeiro/conciliacao` | `finance` (ver) | — | · `finance.reconcile` | — |
| `/financeiro/conciliacao/importacoes/[id]` | `finance` (ver) | — | — | — |
| `/financeiro/conciliacao/importar` | `finance` (ver) | — | · `finance.reconcile` | — |
| `/financeiro/contas/[id]` | `finance` (ver) | — | · `finance.reverse` | — |
| `/financeiro/exportacao-dominio` | `finance` (ver) | `exportacaoDominio` | ▸ `data.export` (404)<br>· `admin.integrations` | — |
| `/financeiro/fechamento` | `finance` (ver) | `fechamentoPeriodo` | · `finance.close_period` | — |
| `/financeiro/fluxo-caixa` | `finance` (ver) | — | — | — |
| `/financeiro/pagar` | `finance` (ver) | — | · `finance.settle`, `finance.approve_payable` | — |
| `/financeiro/pagar/[id]` | `finance` (ver) | — | · `finance.settle`, `finance.reverse`, `finance.approve_payable` | — |
| `/financeiro/pagar/[id]/recibo` | `finance` (ver) | — | — | — |
| `/financeiro/pagar/novo` | `finance` (criar) | — | · `finance.approve_payable` | — |
| `/financeiro/receber` | `finance` (ver) | — | · `finance.settle`, `finance.approve_payable` | — |
| `/financeiro/receber/[id]` | `finance` (ver) | — | · `finance.settle`, `finance.reverse`, `finance.approve_payable` | — |
| `/financeiro/receber/[id]/carne` | sessão (sem módulo) | `carne` (404) | ▸ `finance` (ver) ou `sales` (ver) se o título é de venda (404) | — |
| `/financeiro/receber/[id]/recibo` | `finance` (ver) | — | — | — |
| `/financeiro/receber/novo` | `finance` (criar) | — | · `finance.approve_payable` | — |

### Fiscal (18)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/fiscal` | — (só `redirect` para /fiscal/nfe) | — | — | — |
| `/fiscal/arquivos` | `fiscal` (ver) | `arquivosFiscais` | ▸ `fiscal.files` (404) | — |
| `/fiscal/arquivos/sintegra` | `fiscal` (ver) | `arquivosFiscais` | ▸ `fiscal.files` (404) | — |
| `/fiscal/configuracoes` | `fiscal` (ver) | — | · `fiscal.configure` | — |
| `/fiscal/entradas` | `fiscal` (ver) | `livroEntradas` | · `purchase.receive`, `data.export` | — |
| `/fiscal/entradas/nova` | `purchases` (ver) | `livroEntradas` | ▸ `purchase.receive` (404) — módulo exigido é `purchases`, não `fiscal` (D7) | — |
| `/fiscal/nfce` | `fiscal` (ver) | — | · `fiscal.issue`, `fiscal.cancel`, `fiscal.configure` | — |
| `/fiscal/nfce/[id]` | `fiscal` (ver) | — | · `fiscal.issue`, `fiscal.cancel` | — |
| `/fiscal/nfce/[id]/imprimir` | `fiscal` (ver) (componente `PrintPage`) | — | — | — |
| `/fiscal/nfe` | `fiscal` (ver) | — | · `fiscal.issue`, `fiscal.cancel` | — |
| `/fiscal/nfe/[id]` | `fiscal` (ver) | — | · `fiscal.issue`, `fiscal.cancel` | — |
| `/fiscal/nfe/[id]/imprimir` | `fiscal` (ver) (componente `PrintPage`) | — | — | — |
| `/fiscal/nfe/nova` | `fiscal` (criar) | — | — | — |
| `/fiscal/nfse` | `fiscal` (ver) | — | · `fiscal.issue` | — |
| `/fiscal/nfse/[id]` | `fiscal` (ver) | — | · `fiscal.issue`, `fiscal.cancel` | — |
| `/fiscal/nfse/[id]/imprimir` | `fiscal` (ver) (componente `PrintPage`) | — | — | — |
| `/fiscal/nfse/nova` | `fiscal` (criar) | — | — | — |
| `/fiscal/relatorios` | `fiscal` (ver) | — | · `fiscal.configure`, `data.export`, `fiscal.issue` | — |

### Fornecedores (4)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/fornecedores` | `suppliers` (ver) | — | — | — |
| `/fornecedores/[id]` | `suppliers` (ver) | — | — | — |
| `/fornecedores/[id]/editar` | `suppliers` (editar) | — | — | — |
| `/fornecedores/novo` | `suppliers` (criar) | — | — | — |

### Notificações (1)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/notificacoes` | `dashboard` (ver) | — | · `data.export` | — |

### PDV (2)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/pdv` | `pdv` (ver) | — | · `cash.reopen`, `pdv.receive_installments`, `pdv.reverse_receipt`, `sale.discount_over_limit`, `pdv.cancel_cart` | — |
| `/pdv/pagamento` | `pdv` (criar) | — | · `sale.overdue_override` | — |

### Produtos (10)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/produtos` | `products` (ver) | — | · `data.export` | — |
| `/produtos/[id]` | `products` (ver) | — | — | — |
| `/produtos/alteracao-em-massa` | `products` (ver) | `alteracaoMassa` | ▸ `products.bulk_edit` (→ /sem-permissao) | — |
| `/produtos/balanca` | `products` (ver) | `balanca` | — | — |
| `/produtos/cadastros` | `products` (ver) | — | — | — |
| `/produtos/etiquetas` | `products` (ver) | `etiquetas` | — | — |
| `/produtos/importar` | `products` (criar) | — | — | — |
| `/produtos/importar/[id]` | `products` (ver) | — | — | — |
| `/produtos/novo` | `products` (criar) | — | — | — |
| `/produtos/promocoes` | `products` (ver) | `promocoes` | — | — |

### Rede de certificação (18)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/rede` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma (`network.manage`) — senão → /rede/minha | **Sim (rede)** — todos os nós (`companyId = "platform"`, unscoped) |
| `/rede/[id]` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ nó visível (próprio/descendente; plataforma vê todos) (404)<br>· `network.prices`, `network.finance_view`, `network.billing` | **Sim (rede)** — nó e empresa do nó (outra empresa), regras de preço e financeiro da relação |
| `/rede/clientes` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ nó não contador + `network.sell` ou `network.sales_all` (aviso) | Clientes de certificado do nó (plataforma: todos) |
| `/rede/clientes/[id]` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ `network.sell` ou `network.sales_all` + cliente visível (404) | Idem |
| `/rede/clientes/novo` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ `network.sell` (aviso no lugar do formulário) | — |
| `/rede/cupons` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma, `network.coupons` ou `network.sales_all` (aviso) | **Sim (rede)** — cupons da plataforma/nós visíveis; usuários das empresas dos nós (unscoped) |
| `/rede/fechamentos/[id]` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ fechamento visível + `network.finance_view`, `network.billing` ou `finance` (ver) (404)<br>· `data.export` | **Sim (rede)** — lançamentos entre camadas (empresas diferentes) |
| `/rede/financeiro` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma, `network.finance_view`, `network.billing` ou `finance` (ver) (aviso) | **Sim (rede)** — resultado do nó e descendentes (plataforma: rede toda) |
| `/rede/minha` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | aviso quando a empresa não é nó<br>· `network.prices`, `network.finance_view`, `network.billing` | **Sim (rede)** — nó próprio, filhos (outras empresas) e preços herdados |
| `/rede/minha/financeiro` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ empresa é nó da rede + `network.finance_view`, `network.billing` ou `finance` (ver) (aviso) | **Sim (rede)** — relação com o nível acima (outra empresa) |
| `/rede/novo` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma ou `network.children` com pai elegível (senão → /rede/minha) | Cria empresa nova ou **vincula escritório existente por CNPJ** (A5) |
| `/rede/parametros` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma (`network.manage`) — senão → /rede/minha | **Sim** — todas as empresas (unscoped) e auditoria da plataforma |
| `/rede/precos` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma (`network.manage`) — senão → /rede/minha | **Sim (rede)** — tabela de preços da plataforma |
| `/rede/renovacoes` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma; escritório: `accounting.certificates`; parceiro: `network.renewals` ou `network.sales_all` (aviso) | **Sim (rede)** — accounting_certificates, contatos e clientes contábeis de todas as empresas-nó (unscoped), filtrados por visibilidade |
| `/rede/vendas` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma, `network.sell` ou `network.sales_all` (aviso) | **Sim (rede)** — certificate_requests dos nós visíveis (unscoped) + vendedores de outras empresas |
| `/rede/vendas/[id]` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ venda visível (404)<br>· `certification.operate` | **Sim (rede)** — histórico da empresa vendedora (`scopeStore`) |
| `/rede/vendas/nova` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ `network.sell` + nó ativo não contador (aviso) | Certificado anterior (unscoped, conferido `companyId`) |
| `/rede/vouchers` | N: `dashboard` (ver) + recurso `redeCertificacao` | — | ▸ plataforma, `network.vouchers` ou `network.sales_all` (aviso) | **Sim (rede)** — pacotes/códigos do nó e dos parceiros abaixo |

### Relatórios (6)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/relatorios` | `reports` (ver) | — | · `data.export` | — |
| `/relatorios/curva-abc` | `reports` (ver) | — | · `data.export` | — |
| `/relatorios/curva-abc/produto/[skuId]` | `reports` (ver) | — | · `data.export` | — |
| `/relatorios/financeiros` | `finance` (ver) | `dre` | · `data.export` | — |
| `/relatorios/gerenciais` | `reports` (ver) | — | · `data.export` | — |
| `/relatorios/gerenciais/filial/[id]` | `reports` (ver) | — | · `data.export` | — |

### Sem permissão (1)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/sem-permissao` | — (estática; o layout exige sessão) | — | — | — |

### Vendas (17)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/vendas` | `sales` (ver) | — | — | — |
| `/vendas/[id]` | `sales` (ver) | — | · `sale.cancel`, `sale.return` | — |
| `/vendas/[id]/conclusao` | `sales` (ver) | — | — | — |
| `/vendas/[id]/devolucoes` | `sales` (ver) | — | · `sale.return`, `sale.return_over_limit` | — |
| `/vendas/[id]/recibo` | `sales` (ver) | — | — | — |
| `/vendas/comissoes` | `sales` (ver) | `comissoes` | ▸ `sales.commissions` (404)<br>· `data.export` | — |
| `/vendas/devolucoes` | `sales` (ver) | — | — | — |
| `/vendas/devolucoes/[id]` | `sales` (ver) | — | · `sale.return` | — |
| `/vendas/orcamentos` | `sales` (ver) (componente `DocumentsList`) | `documentoComercial` | · `sales_doc.quote` | — |
| `/vendas/orcamentos/[id]` | `sales` (ver) (componente `DocumentDetail`) | `documentoComercial` | · `sales_doc.quote`, `sales_doc.order`, `sale.discount_over_limit`, `fiscal.issue`, `sales_doc.cancel` | — |
| `/vendas/orcamentos/[id]/imprimir` | `sales` (ver) (componente `DocumentPrintPage`) | `documentoComercial` | — | — |
| `/vendas/orcamentos/novo` | `sales` (ver) (componente `NewDocumentPage`) | `documentoComercial` | ▸ `sales_doc.quote` (→ /sem-permissao)<br>· `sale.discount_over_limit` | — |
| `/vendas/pedidos` | `sales` (ver) (componente `DocumentsList`) | `documentoComercial` | · `sales_doc.order` | — |
| `/vendas/pedidos/[id]` | `sales` (ver) (componente `DocumentDetail`) | `documentoComercial` | · `sales_doc.quote`, `sales_doc.order`, `sale.discount_over_limit`, `fiscal.issue`, `sales_doc.cancel` | — |
| `/vendas/pedidos/[id]/imprimir` | `sales` (ver) (componente `DocumentPrintPage`) | `documentoComercial` | — | — |
| `/vendas/pedidos/novo` | `sales` (ver) (componente `NewDocumentPage`) | `documentoComercial` | ▸ `sales_doc.order` (→ /sem-permissao)<br>· `sale.discount_over_limit` | — |
| `/vendas/vendedores` | `sales` (ver) | — | · `sales.commissions` | Vendedores = usuários (coleção global) vinculados + administradores globais |

### Acesso público — grupo (auth) (8)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/convite/[token]` | Pública (token do convite) | — | — | — |
| `/login` | Pública (`getSession` só para redirecionar quem já entrou) | — | — | — |
| `/login/duas-etapas` | Pública (cookie `ic_2fa` do desafio) | — | — | Desafio de login (`getStore()`) |
| `/primeiro-acesso` | Pública só com instalação vazia (+ `SETUP_TOKEN` na ação) | — | — | — |
| `/recuperar-senha` | Pública | — | — | — |
| `/redefinir-senha` | Pública (token de recuperação) | — | — | — |
| `/selecionar-unidade` | `getSession` (login, sem contexto) | — | — | Todas as filiais (`getStore()`) filtradas pelas empresas do usuário |
| `/suporte` | Pública (chamado `public`) | — | — | — |

### Documento público (1)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/documento/[token]` | Pública (token aleatório de 128 bits) | `documentoComercial` da empresa do documento | — | Documento de qualquer empresa pelo token (`getStore()`) |

### Vitrine pública (loja virtual) (6)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/loja/[store]` | Pública (loja publicada ou prévia com cookie) | `comercioDigital` da empresa da loja | — | Loja resolvida por endereço/domínio (`getStore()`); dados da empresa dona |
| `/loja/[store]/carrinho` | Pública (carrinho pelo cookie httpOnly) | `comercioDigital` | — | Idem |
| `/loja/[store]/checkout` | Pública (loja publicada) | `comercioDigital` | — | Idem |
| `/loja/[store]/pagina/[slug]` | Pública | `comercioDigital` | — | Idem |
| `/loja/[store]/pedido/[token]` | Pública (token do pedido) | `comercioDigital` | — | Idem |
| `/loja/[store]/produto/[slug]` | Pública | `comercioDigital` | — | Idem |

### Raiz (1)

| Rota | Guarda (módulo/permissão) | Recurso | Operações especiais (▸ bloqueia a tela · só habilita ações) | Outras empresas |
|---|---|---|---|---|
| `/` | — (só `redirect` para /dashboard) | — | — | — |

---

## 3. Rotas de API (`route.ts`) e entradas públicas

### 3.1 Route handlers (19)

| Rota | Método | Autenticação | Permissão | Escopo de empresa |
|---|---|---|---|---|
| `/administracao/backups/[id]/download` | GET | `requireApiSession("text")`: sessão e contexto (401/409) | `admin` (ver) e `admin.backup`. Sem elas, 403 e tentativa auditada | Cópia com `companyId` = empresa ativa (senão 404). O artefato inclui usuários de outras empresas e os administradores gerais (A2) |
| `/comercio-digital/ver-loja` | GET | `requireApiSession("text")` | Uma de `ecommerce.manage`/`catalog`/`orders`/`marketing` e recurso `comercioDigital` (403). **Não confere o módulo `sales`** (D6) | Loja da empresa ativa. Grava o cookie httpOnly de prévia no caminho da loja |
| `/api/certificados/[id]` | POST (senha no corpo) | `requireApiSession("text")` e confirmação da senha do usuário | No domínio (`downloadIssuedCertificate`): o escritório dono (carteira e autorização do titular) ou o titular (empresa vinculada e `fiscal.configure`) | Lê `certificate_requests` sem escopo (unscoped) e o arquivo na empresa do escritório (`scopeStore`) |
| `/api/export/[key]` | GET | `requireApiSession("text")` | `can(módulo da exportação)` e `data.export` (403), para as 62 chaves de `src/exports/*`. `sales-commissions` devolve vazio sem `sales.commissions`. Recursos desligados e operações das telas **não** são conferidos (D15) | Consultas com o `ctx` da empresa ativa. `admin.branches` só aceita `empresa=` entre as empresas do usuário (via `companyView`) |
| `/api/files/[id]` | GET | `requireApiSession("text")` | `fileAccessDenial` (`src/app/api/files/[id]/access.ts`): módulo do registro de origem; backups → `admin.backup`; certificado A1 → `fiscal.configure`; SPED/Sintegra → `fiscal` e `fiscal.files`; pacote contábil → `fiscal` e `data.export`; certificado emitido → só pela rota própria | Arquivo da empresa ativa. **Exceção:** um escritório (`kind = accounting` e `accounting` ver) baixa o arquivo **entregue por empresa vinculada**, lido em modo somente leitura na empresa de origem, **sem filtro de carteira** (A6) |
| `/api/jobs` | GET | `Authorization: Bearer CRON_SECRET`. Em produção sem segredo → 503; fora de produção sem segredo, fica aberta | — (rotina técnica do Vercel Cron) | **Todas as empresas**: `runScheduled` e `runDueJobs` sobre `getStore()`, cada tarefa no `systemCtx` da sua empresa |
| `/api/keepalive` | GET | Bearer `CRON_SECRET` | — | Parâmetro da plataforma (`companyId = "platform"`) |
| `/api/loja/gateway/[provider]/[storeId]` | POST | **Pública**. Exige a assinatura do aviso (`verifyWebhook`, com o segredo da integração `store_gateway` da empresa da loja) e corpo de até 64 KB | — | A loja é lida por id (unscoped), depois os pedidos dela. Cada evento é aplicado uma única vez pela chave do provedor |
| `/api/pdv/customers` | GET | `requireApiSession()` | `pdv` ou `customers` (ver) | Filtro explícito `companyId` = empresa ativa |
| `/api/pdv/intents/[id]` | GET | `requireApiSession()` | `pdv` (ver) | `checkIntent(ctx)`, no Store da empresa |
| `/api/pdv/lots` | GET | `requireApiSession()` | `pdv` (ver) e filial | SKU conferido contra a empresa; depósito do terminal da filial |
| `/api/pdv/products` | GET | `requireApiSession()` | `pdv` (ver) e filial | `companyId` = empresa ativa em todas as consultas |
| `/api/pdv/vouchers` | GET | `requireApiSession()` | `pdv` (ver) | `companyId` = empresa ativa |
| `/api/search` | GET | `requireApiSession()` | Por grupo: `products`, `customers`, `suppliers`, `sales`, `purchases`, `finance`, `fiscal` (ver) | `companyId` = empresa ativa |
| `/api/setup/run` | GET | `SETUP_TOKEN` (cabeçalho `x-setup-token` ou `?token=`, com comparação em tempo constante). Depois de `finish`, responde 410, exceto nas etapas idempotentes | — (instalação) | Global: cria tabelas, a demonstração e o **administrador geral** |
| `/api/unit` | GET | `getSession()`: exige login, mas não contexto | Empresa e filial precisam estar em `accessibleUnits`; o consolidado só para quem acessa todas as filiais | Troca a empresa ativa (cookie `ic_unit`, `SameSite=Lax`) por **GET**, sem proteção anti-CSRF (D14) |
| `/loja/[store]/imagem/[id]` | GET | **Pública** | Loja visível (`loadStore`) e imagem da empresa da loja ligada à identidade ou ao catálogo (`isPublicImage`) | Empresa dona da loja |
| `/loja/[store]/robots.txt` | GET | **Pública** | — | Loja publicada; senão, `Disallow: /` |
| `/loja/[store]/sitemap.xml` | GET | **Pública** | Loja publicada | Produtos vendáveis da loja |

### 3.2 Outras entradas sem sessão do ERP

| Entrada | Tipo | Proteção | Escopo |
|---|---|---|---|
| `src/middleware.ts` | Middleware (todas as rotas, exceto `_next`, `api`, ícones e service worker) | Host que não é do ERP é reescrito para `/loja/~<host>`; `/loja/...` acessado pelo domínio de uma loja → 404. Hosts do ERP: localhost, `*.vercel.app`, `APP_URL`, `VERCEL_*` e `APP_HOSTS` | Uma instalação atende todas as lojas; a loja é resolvida pelo domínio verificado |
| `src/app/manifest.ts` e `public/sw.js` | PWA | O service worker não intercepta `/api` nem ações e não guarda páginas em cache | — |
| `src/app/actions/session.ts` (10 funções) | Server actions | Login com bloqueio por tentativas; duas etapas (cookie `ic_2fa`); convite e recuperação por token. `switchUnitAction`/`selectUnitAction` validam `accessibleUnits` e a situação da empresa e da filial | Global (`users`, `sessions`) |
| `src/app/actions/setup.ts` (2) | Server actions | Instalação vazia e `SETUP_TOKEN` (obrigatório em produção com banco real) | Global |
| `src/app/actions/public.ts` (1) | Server action `publicTicketAction` | Sem sessão; só valida os campos | Grava o chamado com `companyId = "public"` (A4) |
| `src/app/loja/[store]/actions.ts` (12) | Server actions da vitrine | Loja pelo endereço ou domínio (`open`); carrinho só pelo cookie httpOnly; pedido pelo token; checkout só com a loja publicada. `simulatePayAction` aprova pagamento de pedido em modo simulação | Empresa dona da loja (`getStore`, `storeCtx`) |
| Páginas públicas | `/login`, `/login/duas-etapas`, `/primeiro-acesso`, `/recuperar-senha`, `/redefinir-senha`, `/convite/[token]`, `/suporte`, `/documento/[token]`, `/loja/*` | Ver a seção 2 | — |

Todas as 396 server actions autenticadas (49 arquivos do grupo `(app)`) passam por `runAction` → `requireSession`. Nenhuma fica acessível sem login e contexto de trabalho.

---

## 4. Server actions por arquivo

Colunas:

- **Ação (`runAction`)**: o módulo e a operação conferidos antes de executar; `+filial` indica `requireBranch`.
- **Domínio**: operações especiais e regras conferidas nas funções chamadas.
- **Escopo**: “empresa” significa o `ctx` da empresa ativa.

Em 146 das 396 ações autenticadas, só o módulo (CRUD) é conferido, sem nenhuma operação especial. Isso é normal em cadastros. Os casos em que a tela pede uma operação que a ação não confere estão destacados (D3, D4).

| Arquivo (`src/app/…`) | Nº | Ação (`runAction`) | Domínio (operações e regras) | Escopo / outras empresas | Destaques |
|---|---|---|---|---|---|
| `(app)/administracao/backups/actions.ts` | 4 | `admin` (ver) | `admin` (ver) e `admin.backup` (`auditedGuard`). Restaurar e aplicar retenção repetem `admin.backup` na ação | Empresa. A cópia precisa ter `companyId` = empresa ativa. Restauração só em base de teste ou em nova base Appwrite | Conteúdo da cópia: A2 |
| `(app)/administracao/empresas/actions.ts` | 8 | `admin` (criar/editar). **Os 3 de depósito não têm módulo** | `companyAdminCtx`/`branchAdminCtx` (perfil `admin` **na empresa-alvo**); `admin.users` para vínculos; `stock.warehouses` para depósitos | **Outra empresa autorizada** (`ctxForCompany`). Criar empresa usa `unscoped` | Criar empresa só exige `admin` (criar) (D8). Depósito em filial de outra empresa: criar funciona, editar não (D10) |
| `(app)/administracao/importacao/actions.ts` | 3 | `admin` (criar) e recurso `importacaoCadastros` | Módulo do tipo importado (`customers`/`suppliers`/`stock`/`finance` criar; `stock.adjust` para saldos) | Empresa | — |
| `(app)/administracao/integracoes/actions.ts` | 6 | `admin` (editar; teste: ver) | `admin.integrations`; integração fiscal também exige `fiscal.configure` | Empresa. `requeueJobAction`/`runJobsAction` executam tarefas com `systemCtx` | A credencial é o **nome** de uma variável de ambiente da instalação (A7) |
| `(app)/administracao/parametros/actions.ts` | 2 | `admin` (editar) | `admin` (editar); a programação de backup também exige `admin.backup` | Empresa ou filial (a filial é conferida contra a empresa) | Liga e desliga recursos da própria empresa (D18) |
| `(app)/administracao/terminais/actions.ts` | 5 | `admin` (ver/criar/editar) | `admin` | Empresa | — |
| `(app)/administracao/usuarios/actions.ts` | 9 | `admin` (criar/editar/excluir) | `admin` e `admin.users` (`auditedGuard`). Vínculos com outras empresas só onde o editor também administra usuários (`manageableCompanyIds`). Só quem é `isAdmin` concede ou revoga `isAdmin` | `users` é global (unscoped) | **O perfil aceita qualquer uma das 60 operações**, inclusive `network.manage` e `certification.operate` (A1) |
| `(app)/ajuda/chamados/actions.ts` | 4 | `support` (criar/ver) | Atender exige `support.manage`; o solicitante só mexe no próprio chamado | Empresa e chamados `public` | Agentes de qualquer empresa atendem chamados `public` (A4) |
| `(app)/caixa/actions.ts` | 6 | `cash` (ver/criar/editar) `+filial` | `cash.withdrawal`; `cash.reopen` (reabrir e operador diferente) | Empresa e filial | — |
| `(app)/clientes/actions.ts` | 6 | `customers` (CRUD) | `customer.credit_limit` para o limite de crédito | Empresa | Consulta de CNPJ externa |
| `(app)/comercio-digital/actions.ts` | 45 | `sales` (ver) em todas, mais recurso `comercioDigital` | `ecommerce.manage`/`catalog`/`orders`/`cancel`/`marketing`/`finance`; `fiscal.issue` para faturar | Loja da empresa ativa (unscoped filtrado por loja e `companyId`) | **Sem operação:** `simulateEventAction` (`:433`), `simulateCreditsAction` (`:448`), `retryChargeAction` (`:353`) e, só de consulta, `testCouponAction` (`:392`) e `sampleQuoteAction` (`:509`) (D3) |
| `(app)/compras/_shared/actions.ts` | 2 | `purchases` (ver) | — (consulta) | Empresa | — |
| `(app)/compras/aprovacoes/actions.ts` | 3 | `purchases` `+filial`; a política exige `admin` (editar) | `purchase.approve` | Empresa | — |
| `(app)/compras/cotacoes/actions.ts` | 8 | `purchases` (criar/editar) `+filial` | Módulo | Empresa | — |
| `(app)/compras/cte/actions.ts` | 1 | `purchases` `+filial` e recurso `cteEntrada` | `purchase.receive`; `suppliers` (criar) | Empresa | — |
| `(app)/compras/pedidos/actions.ts` | 8 | `purchases` (criar/editar) `+filial` | Módulo | Empresa | — |
| `(app)/compras/recebimentos/[id]/precificacao/actions.ts` | 3 | `purchases` e recurso `precificacaoEntrada` | `purchase.pricing`; `products` (ver; editar para aplicar) | Empresa | — |
| `(app)/compras/recebimentos/actions.ts` | 10 | `purchases` `+filial` | `purchase.receive`, `purchase.receive_pending_invoice`, `purchase.confirm_invoice`; `products` (criar); recurso `notaAConfirmar` | Empresa (tarefas com `systemCtx`) | — |
| `(app)/compras/reposicao/actions.ts` | 2 | `purchases` (criar) | Módulo | Empresa | — |
| `(app)/conta/seguranca/actions.ts` | 4 | **Sem módulo** (só sessão) | — (duas etapas do próprio usuário) | Documento global do próprio usuário | Adequado: é autoatendimento |
| `(app)/contabil/actions.ts` | 19 | `accounting` (ver/criar/editar). Aceitar ou desfazer vínculo pelo lado da empresa: `admin` (editar) | Carteira (`getClient`/`visibleClientIds`), `accounting.manage_team`, `accounting.link`, `admin.integrations` | Escritório, mais `accounting_clients` e integração da empresa vinculada (unscoped) | A ação não confere o tipo da empresa, mas o domínio confere (`requireFirm`) nas criações (D11) |
| `(app)/contabil/certificados/actions.ts` | 19 | Escritório: `accounting` (criar/editar). Equipe e configurações: `admin` (ver). Titular: `admin` (editar) | Escritório: `accounting.certificates` e carteira. Equipe: `certification.operate` (`loadForActor`). Configurações: `certification.operate` ou `network.manage`. Titular: `admin.integrations` | A equipe vê **todas as empresas** (unscoped); escritório ↔ empresa vinculada | A operação da equipe pode ser concedida por qualquer administrador de empresa (A1) |
| `(app)/dashboard/metas/actions.ts` | 3 | `dashboard` (criar/editar/excluir) | Módulo | Empresa | — |
| `(app)/estoque/actions.ts` | 19 | `stock` (ver/criar/editar) `+filial` | `stock.adjust`, `stock.inventory_close` | Empresa (o destino da transferência é conferido na empresa) | — |
| `(app)/financeiro/actions.ts` | 35 | `finance` (ver/criar/editar/excluir), quase todas `+filial` | `finance.settle`, `finance.reverse`, `finance.reconcile`, `finance.approve_payable` (conferidas na própria ação); recurso `baixaLote` | Empresa | Contas, cadastros e lançamentos só exigem o módulo |
| `(app)/financeiro/cartoes/adquirente/actions.ts` | 2 | `finance` e recurso `taxasCartao` | `finance.settle` | Empresa | — |
| `(app)/financeiro/cobranca/actions.ts` | 2 | `finance` (editar) e recurso `cobrancaWhatsapp` | Módulo | Empresa | — |
| `(app)/financeiro/exportacao-dominio/actions.ts` | 2 | `finance` e recurso `exportacaoDominio` | `data.export` (gerar) | Empresa | — |
| `(app)/financeiro/fechamento/actions.ts` | 2 | `finance` (editar) e recurso `fechamentoPeriodo` | `finance.close_period` | Empresa | — |
| `(app)/fiscal/actions.ts` | 33 | `fiscal` (ver/criar/editar/excluir); as de transmissão `+filial` | `fiscal.issue`, `fiscal.cancel`, `fiscal.configure`, `data.export`; recursos fiscais da Fase 7 | Empresa e filial | **`generateObligationsAction` não confere operação** (D4). `previewNfeAction`, `testConnectionAction` e `searchSkusAction` só exigem o módulo (consulta) |
| `(app)/fiscal/arquivos/actions.ts` | 1 | `fiscal` e recurso `arquivosFiscais` | `fiscal` (ver) e `fiscal.files` | Empresa | — |
| `(app)/fiscal/arquivos/sintegra/actions.ts` | 1 | `fiscal` e recurso `arquivosFiscais` | `fiscal.files` | Empresa | — |
| `(app)/fiscal/entradas/actions.ts` | 1 | `purchases` `+filial` e recurso `livroEntradas` | `purchase.receive` | Empresa | Módulo `purchases` numa tela do Fiscal (D7) |
| `(app)/fornecedores/actions.ts` | 6 | `suppliers` (CRUD) | Módulo | Empresa | Consulta de CNPJ externa |
| `(app)/notificacoes/actions.ts` | 4 | `dashboard` | Só notificações do próprio usuário (`own`) | Usuário e empresa | — |
| `(app)/pdv/actions.ts` | 17 | `pdv` (criar) `+filial` | `pdv.receive_installments`, `pdv.reverse_receipt`, `pdv.cancel_cart`, `pdv.remove_item` (ou autorização de supervisor), `sale.discount_over_limit`, `sale.overdue_override`, `cash.reopen` | Empresa e filial. O supervisor é um usuário global, verificado como vinculado à empresa e com o perfil **desta** empresa | — |
| `(app)/produtos/actions.ts` | 24 | `products` (CRUD). **2 sem módulo**: `saveStockParamsAction` e `initialBalanceAction` | Essas duas: `products`/`stock` (editar); `stock.adjust` e `stock` (criar) | Empresa | — |
| `(app)/produtos/alteracao-em-massa/actions.ts` | 4 | `products` e recurso `alteracaoMassa` | `products.bulk_edit` (campos); `products` (editar) para preços | Empresa | — |
| `(app)/produtos/balanca/actions.ts` | 2 | `products` (editar) e recurso `balanca` | Módulo | Empresa | — |
| `(app)/produtos/cadastros/actions.ts` | 7 | `products` (CRUD) | Grupo tributário: `fiscal.configure` | Empresa | — |
| `(app)/produtos/etiquetas/actions.ts` | 1 | `products` e recurso `etiquetas` | Módulo | Empresa | — |
| `(app)/produtos/promocoes/actions.ts` | 2 | `products` e recurso `promocoes` | Módulo | Empresa | — |
| `(app)/rede/actions.ts` | 6 | `dashboard` e recurso `redeCertificacao` | Plataforma (`network.manage`) ou `network.children`/`network.prices` no próprio nó | **Outras empresas** (nós). Cadastrar um nó **cria uma empresa** e convida o administrador dela | Escritório existente vinculado por CNPJ sem consentimento (A5) |
| `(app)/rede/financeiro/actions.ts` | 9 | `dashboard` e recurso | `network.billing` ou plataforma. Estorno: plataforma ou `certification.operate`. Parâmetros financeiros: `network.manage` | **Outras empresas** (carteiras e lançamentos entre camadas) | — |
| `(app)/rede/vendas/actions.ts` | 16 | `dashboard` e recurso | `network.sell`, `network.coupons`, `network.vouchers`, `network.renewals`/`network.sales_all`, `loadForActor`, visibilidade da rede | **Outras empresas** (pedido de certificado compartilhado com a equipe e com a plataforma) | — |
| `(app)/vendas/_documentos/actions.ts` | 11 | `sales` `+filial` e recurso `documentoComercial` | `sales_doc.quote`/`order`/`cancel`, `sale.discount_over_limit` | Empresa | — |
| `(app)/vendas/actions.ts` | 5 | `sales` (`+filial` nas que alteram) | `sale.cancel`, `sale.return`, `sale.return_over_limit` | Empresa | — |
| `(app)/vendas/comissoes/actions.ts` | 2 | `sales` e recurso `comissoes` | `sales.commissions` | Empresa | — |
| `(app)/vendas/vendedores/actions.ts` | 2 | `sales` (criar/editar) | `sales.commissions` | **Grava na coleção global `users`** | A comissão fica no usuário e vale em todas as empresas dele (D12) |
| `loja/[store]/actions.ts` | 12 | **Pública** (sem sessão) | Loja visível; carrinho pelo cookie httpOnly; pedido pelo token; checkout só com a loja publicada | Empresa dona da loja (`getStore`, `storeCtx`) | `simulatePayAction` aprova o pagamento de qualquer pedido que não esteja marcado como cobrança real (`payment.simulated !== false`). Basta ter o token do pedido |
| `actions/session.ts` | 10 | **Pública/sessão** | Login, duas etapas, convite e recuperação; troca de unidade valida `accessibleUnits` | Global (`users`) | `currentUserAuthId` é exportada, não tem uso e devolve o documento inteiro do usuário (D13) |
| `actions/setup.ts` | 2 | **Pública** | `SETUP_TOKEN` e instalação vazia | Global | — |
| `actions/public.ts` | 1 | **Pública** | — | Chamado com `companyId = "public"` | A4 |

**Ações sem verificação de módulo em `runAction`.** São 9, e todas têm verificação no domínio ou são do próprio usuário:

- `saveWarehouseAction`, `setWarehouseStatusAction` e `setDefaultWarehouseAction`: `admin` na empresa da filial e `stock.warehouses`.
- As 4 de `conta/seguranca`: duas etapas do próprio usuário.
- `saveStockParamsAction` e `initialBalanceAction`: `products`/`stock`.

**Ações sem escopo de empresa.** Nenhuma ação autenticada lê ou grava outra empresa fora destes caminhos explícitos:

- `companyAdminCtx`/`branchAdminCtx` (administração multiempresa, com o perfil da empresa-alvo);
- o código de vínculo entre empresa e escritório (`acceptLinkCodeAction` grava no cliente do escritório) e o `linkedCompanyReader` (somente leitura);
- a rede (`unscoped` com a visibilidade de `networkViewer` e `isPlatform`);
- a equipe de certificação (`certification.operate`).

Como efeito colateral, auditoria e notificações também são gravadas na empresa do outro lado (`auditNode`, `notify(unscoped(...))`).

As exceções de dado global são:

- `users`: vendedores e comissões (D12) e perfis (A1);
- registros `platform` da rede e da certificação: liberados pelas operações de plataforma, que qualquer administrador de empresa consegue conceder (A1).

---

## 5. Menu (`nav.ts`) × página × ação

O layout escolhe o menu pelo tipo da empresa ativa (`navFor(kind)`, `src/components/shell/nav.ts:280`). Um item aparece quando o usuário tem:

- o módulo com `view`;
- a `action`, se o item tiver uma;
- ao menos uma das operações de `anyAction`, se houver;
- o recurso ligado, calculado com o padrão do tipo da empresa (`src/app/(app)/layout.tsx:12-13`).

Fora a Gestão contábil, as páginas **não** conferem o tipo da empresa. O tipo só decide qual menu aparece (D17).

### Menu `NAV` — empresas operacionais (varejo) — 83 itens

| Grupo › item | Rota | Exibido quando (módulo `ver` + …) | Verificação da página | Divergência |
|---|---|---|---|---|
| Gestão › Painel do gestor | `/dashboard` | `dashboard` | `dashboard` (ver) | — |
| Vendas e caixa › Frente de caixa (PDV) | `/pdv` | `pdv` | `pdv` (ver) | — |
| Vendas e caixa › Histórico de vendas | `/vendas` | `sales` | `sales` (ver) | — |
| Vendas e caixa › Orçamentos | `/vendas/orcamentos` | `sales` + recurso `documentoComercial` | `sales` (ver) + recurso `documentoComercial` | — |
| Vendas e caixa › Pedidos de venda | `/vendas/pedidos` | `sales` + recurso `documentoComercial` | `sales` (ver) + recurso `documentoComercial` | — |
| Vendas e caixa › Trocas e devoluções | `/vendas/devolucoes` | `sales` | `sales` (ver) | — |
| Vendas e caixa › Vendedores | `/vendas/vendedores` | `sales` | `sales` (ver) | Consistente: menu sem operação; manutenção exige `sales.commissions` (tela e domínio) |
| Vendas e caixa › Comissões | `/vendas/comissoes` | `sales` + op `sales.commissions` + recurso `comissoes` | `sales` (ver) + recurso `comissoes` + ▸ `sales.commissions` (404) | — |
| Vendas e caixa › Caixa (abertura, movimentos, fechamento) | `/caixa` | `cash` | `cash` (ver) | — |
| Comércio digital › Central de comércio digital | `/comercio-digital` | `sales` + uma de {manage, catalog, orders, marketing, finance} + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, catalog, orders, cancel, marketing, finance} | Página também abre só com `ecommerce.cancel` (fora do `anyAction` do menu) — D5 |
| Comércio digital › Modelos da loja | `/comercio-digital/modelos` | `sales` + op `ecommerce.manage` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, catalog, marketing} | Menu exige `manage`; página abre também com `catalog` ou `marketing` (consulta) — D5 |
| Comércio digital › Editor e domínio | `/comercio-digital/editor` | `sales` + op `ecommerce.manage` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, catalog, marketing} | Menu exige `manage`; página abre também com `catalog` ou `marketing` (consulta) — D5 |
| Comércio digital › Catálogo digital | `/comercio-digital/catalogo` | `sales` + op `ecommerce.catalog` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {catalog, manage} | Menu exige `catalog`; página abre também com `manage` (consulta) — D5 |
| Comércio digital › Canais e contas | `/comercio-digital/canais` | `sales` + op `ecommerce.manage` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, catalog} | Menu exige `manage`; página abre também com `catalog` — D5 |
| Comércio digital › Pedidos on-line | `/comercio-digital/pedidos` | `sales` + op `ecommerce.orders` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {orders, cancel, finance, manage} | Menu exige `orders`; página abre também com `cancel`, `finance` ou `manage` — D5 |
| Comércio digital › Promoções e carrinhos | `/comercio-digital/promocoes` | `sales` + op `ecommerce.marketing` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {marketing, manage} | Menu exige `marketing`; página abre também com `manage`; `testCouponAction` só exige `sales` — D5/D3 |
| Comércio digital › Gateway e checkout | `/comercio-digital/pagamentos` | `sales` + op `ecommerce.manage` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, finance, orders} | Menu exige `manage`; página abre com `finance`/`orders`; **`simulateEventAction` só exige `sales`** (a tela pede `manage`/`finance`) — D3 |
| Comércio digital › Banco Intercert e repasses | `/comercio-digital/banco` | `sales` + op `ecommerce.finance` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {finance, manage} | Menu exige `finance`; página abre com `manage`; **`simulateCreditsAction` só exige `sales`** (a tela pede `finance`) — D3 |
| Comércio digital › Frete e logística | `/comercio-digital/frete` | `sales` + op `ecommerce.manage` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, orders} | Menu exige `manage`; página abre também com `orders`; `sampleQuoteAction` só exige `sales` — D5 |
| Comércio digital › Expedição e rastreio | `/comercio-digital/expedicao` | `sales` + op `ecommerce.orders` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {orders, manage} | Menu exige `orders`; página abre também com `manage` — D5 |
| Comércio digital › Monitor de integrações | `/comercio-digital/monitor` | `sales` + op `ecommerce.manage` + recurso `comercioDigital` | `sales` + `comercioDigital` + uma de {manage, orders, finance} | Menu exige `manage`; página abre também com `orders` ou `finance` — D5 |
| Comércio digital › Ver loja pública | `/comercio-digital/ver-loja` | `sales` + uma de {manage, catalog, orders, marketing} + recurso `comercioDigital` | rota `GET` (não é página): sessão + uma de {manage, catalog, orders, marketing} + recurso; **não confere `sales`** | **A rota não confere o módulo `sales`** (o menu confere) — D6 |
| Produtos e estoque › Produtos e serviços | `/produtos` | `products` | `products` (ver) | — |
| Produtos e estoque › Saldos de estoque | `/estoque` | `stock` | `stock` (ver) | — |
| Produtos e estoque › Movimentação de estoque | `/estoque/movimentos` | `stock` | `stock` (ver) | — |
| Produtos e estoque › Transferências | `/estoque/transferencias` | `stock` | `stock` (ver) | — |
| Produtos e estoque › Inventário e contagem | `/estoque/inventarios` | `stock` | `stock` (ver) | — |
| Produtos e estoque › Montagem e desmembramento | `/estoque/montagem` | `stock` + recurso `kits` | `stock` (ver) + recurso `kits` | — |
| Produtos e estoque › Validades e lotes | `/estoque/validades` | `stock` + recurso `lotes` | `stock` (ver) + recurso `lotes` | — |
| Produtos e estoque › Inventário em data-base | `/estoque/inventario-fiscal` | `stock` + recurso `inventarioFiscal` | `stock` (ver) + recurso `inventarioFiscal` | — |
| Produtos e estoque › Alteração em massa | `/produtos/alteracao-em-massa` | `products` + op `products.bulk_edit` + recurso `alteracaoMassa` | `products` (ver) + recurso `alteracaoMassa` + ▸ `products.bulk_edit` | — |
| Produtos e estoque › Etiquetas de produtos | `/produtos/etiquetas` | `products` + recurso `etiquetas` | `products` (ver) + recurso `etiquetas` | — |
| Produtos e estoque › Balança (carga e PLU) | `/produtos/balanca` | `products` + recurso `balanca` | `products` (ver) + recurso `balanca` | — |
| Produtos e estoque › Promoções | `/produtos/promocoes` | `products` + recurso `promocoes` | `products` (ver) + recurso `promocoes` | — |
| Produtos e estoque › Cadastros auxiliares | `/produtos/cadastros` | `products` | `products` (ver) | — |
| Clientes › Gestão de clientes | `/clientes` | `customers` | `customers` (ver) | — |
| Clientes › Programa de fidelidade | `/clientes/fidelidade` | `customers` + recurso `fidelidade` | `customers` (ver) + recurso `fidelidade` | — |
| Financeiro › Contas a receber | `/financeiro/receber` | `finance` | `finance` (ver) | — |
| Financeiro › Contas a pagar | `/financeiro/pagar` | `finance` | `finance` (ver) | — |
| Financeiro › Fluxo de caixa | `/financeiro/fluxo-caixa` | `finance` | `finance` (ver) | — |
| Financeiro › Conciliação bancária | `/financeiro/conciliacao` | `finance` | `finance` (ver) | — |
| Financeiro › Recebíveis de cartão | `/financeiro/cartoes` | `finance` | `finance` (ver) | — |
| Financeiro › Arquivo da adquirente | `/financeiro/cartoes/adquirente` | `finance` + recurso `taxasCartao` | `finance` (ver) + recurso `taxasCartao` | — |
| Financeiro › Relatórios financeiros (DRE e aging) | `/relatorios/financeiros` | `finance` + recurso `dre` | `finance` (ver) + recurso `dre` | — |
| Financeiro › Fechamento de período | `/financeiro/fechamento` | `finance` + recurso `fechamentoPeriodo` | `finance` (ver) + recurso `fechamentoPeriodo` | — |
| Financeiro › Modelos de cobrança | `/financeiro/cobranca/modelos` | `finance` + recurso `cobrancaWhatsapp` | `finance` (ver) + recurso `cobrancaWhatsapp` | — |
| Financeiro › Exportação Domínio | `/financeiro/exportacao-dominio` | `finance` + op `data.export` + recurso `exportacaoDominio` | `finance` (ver) + recurso `exportacaoDominio` + ▸ `data.export` (404) | — |
| Financeiro › Cadastros financeiros | `/financeiro/cadastros` | `finance` | `finance` (ver) | — |
| Compras › Fornecedores | `/fornecedores` | `suppliers` | `suppliers` (ver) | — |
| Compras › Planejamento de reposição | `/compras/reposicao` | `purchases` | `purchases` (ver) | — |
| Compras › Cotações | `/compras/cotacoes` | `purchases` | `purchases` (ver) | — |
| Compras › Pedidos de compra | `/compras/pedidos` | `purchases` | `purchases` (ver) | — |
| Compras › Aprovação de compras | `/compras/aprovacoes` | `purchases` | `purchases` (ver) | — |
| Compras › Recebimento de mercadorias | `/compras/recebimentos` | `purchases` | `purchases` (ver) | — |
| Compras › Compras aguardando nota | `/compras/aguardando-nota` | `purchases` + recurso `notaAConfirmar` | `purchases` (ver) + recurso `notaAConfirmar` | — |
| Compras › CT-e de frete (entrada) | `/compras/cte` | `purchases` + recurso `cteEntrada` | `purchases` (ver) + recurso `cteEntrada` | — |
| Compras › Precificação após a entrada | `/compras/precificacao` | `purchases` + op `purchase.pricing` + recurso `precificacaoEntrada` | `purchases` (ver) + recurso `precificacaoEntrada` + ▸ `purchase.pricing` + `products` (ver) | **Menu mais permissivo**: o item aparece sem `products` (ver), que a página exige (→ /sem-permissao) — D7 |
| Fiscal › NF-e | `/fiscal/nfe` | `fiscal` | `fiscal` (ver) | — |
| Fiscal › NFC-e | `/fiscal/nfce` | `fiscal` | `fiscal` (ver) | — |
| Fiscal › NFS-e | `/fiscal/nfse` | `fiscal` | `fiscal` (ver) | — |
| Fiscal › Livro de entradas | `/fiscal/entradas` | `fiscal` + recurso `livroEntradas` | `fiscal` (ver) + recurso `livroEntradas` | Botão de entrada sem estoque (`purchase.receive`) leva a `/fiscal/entradas/nova`, que exige o módulo `purchases`, não `fiscal` — D7 |
| Fiscal › Relatórios fiscais | `/fiscal/relatorios` | `fiscal` | `fiscal` (ver) | Botão “Gerar da competência” só aparece com `fiscal.issue`; a ação só exige `fiscal` (editar) — D4 |
| Fiscal › Arquivos fiscais (SPED) | `/fiscal/arquivos` | `fiscal` + op `fiscal.files` + recurso `arquivosFiscais` | `fiscal` (ver) + recurso `arquivosFiscais` + ▸ `fiscal.files` (404) | — |
| Fiscal › Sintegra | `/fiscal/arquivos/sintegra` | `fiscal` + op `fiscal.files` + recurso `arquivosFiscais` | `fiscal` (ver) + recurso `arquivosFiscais` + ▸ `fiscal.files` (404) | — |
| Fiscal › Configurações fiscais | `/fiscal/configuracoes` | `fiscal` | `fiscal` (ver) | — |
| Análise › Central de relatórios | `/relatorios` | `reports` | `reports` (ver) | — |
| Análise › Relatórios gerenciais | `/relatorios/gerenciais` | `reports` | `reports` (ver) | — |
| Análise › Produtos e curva ABC | `/relatorios/curva-abc` | `reports` | `reports` (ver) | — |
| Administração › Usuários e permissões | `/administracao/usuarios` | `admin` | `admin` (ver) | Consistente quanto à tela (`admin.users` bloqueia criar/editar), mas o formulário de perfil oferece **todas** as operações, inclusive as de plataforma — A1 |
| Administração › Empresas e filiais | `/administracao/empresas` | `admin` | `admin` (ver) | Criar empresa só exige `admin` (criar) na empresa ativa — D8 |
| Administração › Terminais do PDV | `/administracao/terminais` | `admin` | `admin` (ver) | — |
| Administração › Central de integrações | `/administracao/integracoes` | `admin` | `admin` (ver) | — |
| Administração › Backup e restauração | `/administracao/backups` | `admin` | `admin` (ver) | Consistente: menu sem `admin.backup`; a tela fica em consulta e ações/download exigem `admin.backup` (conteúdo da cópia: A2) |
| Administração › Importação de cadastros e saldos | `/administracao/importacao` | `admin` + recurso `importacaoCadastros` | `admin` (ver) + recurso `importacaoCadastros` | — |
| Administração › Histórico e auditoria | `/administracao/historico` | `admin` | `admin` (ver) | — |
| Administração › Parâmetros | `/administracao/parametros` | `admin` | `admin` (ver) | Liga/desliga recursos da empresa — inclusive `redeCertificacao` e `comercioDigital` — com `admin` (editar) |
| Administração › Certificação digital (equipe) | `/administracao/certificacao` | `admin` + op `certification.operate` | `admin` (ver) + ▸ `certification.operate` | Consistente; porém `certification.operate` (fila de todas as empresas) é concedível por qualquer administrador de empresa — A1 |
| Administração › Rede de certificação (plataforma) | `/rede` | `dashboard` + op `network.manage` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma (`network.manage`) | Consistente (plataforma = `network.manage`); `network.manage` é concedível por qualquer administrador de empresa — A1 |
| Administração › Vendas da rede (plataforma) | `/rede/vendas` | `dashboard` + op `network.manage` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma, `network.sell` ou `network.sales_all` (aviso) | Item “(plataforma)” exige `network.manage`, mas a página não: abre para qualquer `dashboard` com o recurso (aviso ou dados do próprio nó) — D9 |
| Administração › Renovações da rede (plataforma) | `/rede/renovacoes` | `dashboard` + op `network.manage` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma; escritório: `accounting.certificates`; parceiro: `network.renewals` ou `network.sales_all` (aviso) | Item “(plataforma)” exige `network.manage`, mas a página não (regras do nó/escritório) — D9 |
| Administração › Resultado da rede (plataforma) | `/rede/financeiro` | `dashboard` + op `network.manage` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma, `network.finance_view`, `network.billing` ou `finance` (ver) (aviso) | Item “(plataforma)” exige `network.manage`; página aceita `network.finance_view`/`network.billing` e até `finance` (ver) — D9 |
| Suporte › Notificações | `/notificacoes` | `dashboard` | `dashboard` (ver) | — |
| Suporte › Ajuda e suporte | `/ajuda` | `support` | `support` (ver) | — |

### Menu `NAV_ACCOUNTING` — escritórios contábeis (`kind = accounting`) — 33 itens (24 idênticos a itens do `NAV`, omitidos; abaixo só os específicos)

| Grupo › item | Rota | Exibido quando (módulo `ver` + …) | Verificação da página | Divergência |
|---|---|---|---|---|
| Gestão › Painel da carteira | `/contabil` | `accounting` | `accounting` + tipo escritório | Consistente (menu só para escritório; a página confere o tipo da empresa) |
| Carteira › Clientes contábeis | `/contabil/clientes` | `accounting` | `accounting` + tipo escritório | Consistente |
| Carteira › Grupos de clientes | `/contabil/grupos` | `accounting` | `accounting` + tipo escritório | Consistente |
| Carteira › Caixa de entrada (entregas) | `/contabil/entregas` | `accounting` | `accounting` + tipo escritório | Consistente na tela; o download de arquivo entregue (`/api/files`) não aplica o filtro de carteira — A6 |
| Carteira › Certificados digitais | `/contabil/certificados` | `accounting` | `accounting` + tipo escritório | Consistente (operações na tela: `accounting.certificates`) |
| Carteira › Departamentos e equipe | `/contabil/equipe` | `accounting` | `accounting` + tipo escritório | Consistente (`accounting.manage_team` na tela e no domínio) |
| Carteira › Minha rede de certificação | `/rede/minha` | `dashboard` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` | Consistente |
| Carteira › Renovações da rede | `/rede/renovacoes` | `dashboard` + uma de {accounting.certificates, network.manage} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma; escritório: `accounting.certificates`; parceiro: `network.renewals` ou `network.sales_all` (aviso) | Consistente (escritório precisa de `accounting.certificates`; plataforma, de `network.manage`) |
| Carteira › Financeiro com a revenda (rede) | `/rede/minha/financeiro` | `finance` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ empresa é nó da rede + `network.finance_view`, `network.billing` ou `finance` (ver) (aviso) | **Divergente**: menu usa o módulo `finance` (sem `dashboard`); a página exige `dashboard` e o domínio aceita `network.finance_view`, `network.billing` ou `finance` (ver); no `NAV_CERTIFICATION` o mesmo item usa outra regra — D9 |

### Menu `NAV_CERTIFICATION` — parceiros da rede (`kind = certification`) — 30 itens (20 idênticos a itens do `NAV`, omitidos; abaixo só os específicos)

| Grupo › item | Rota | Exibido quando (módulo `ver` + …) | Verificação da página | Divergência |
|---|---|---|---|---|
| Gestão › Minha rede | `/rede/minha` | `dashboard` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` | Consistente |
| Rede de certificação › Vendas de certificados | `/rede/vendas` | `dashboard` + uma de {network.sell, network.sales_all, network.manage} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma, `network.sell` ou `network.sales_all` (aviso) | Consistente (página: plataforma, `network.sell` ou `network.sales_all`) |
| Rede de certificação › Clientes de certificado | `/rede/clientes` | `dashboard` + uma de {network.sell, network.sales_all} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ nó não contador + `network.sell` ou `network.sales_all` (aviso) | Consistente (plataforma sem nó vê só aviso) |
| Rede de certificação › Renovações | `/rede/renovacoes` | `dashboard` + uma de {network.renewals, network.sales_all, network.manage} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma; escritório: `accounting.certificates`; parceiro: `network.renewals` ou `network.sales_all` (aviso) | Consistente |
| Rede de certificação › Vouchers | `/rede/vouchers` | `dashboard` + uma de {network.vouchers, network.sales_all, network.manage} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma, `network.vouchers` ou `network.sales_all` (aviso) | Consistente |
| Rede de certificação › Cupons | `/rede/cupons` | `dashboard` + uma de {network.coupons, network.sales_all, network.manage} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma, `network.coupons` ou `network.sales_all` (aviso) | Consistente |
| Rede de certificação › Meu financeiro com o nível acima | `/rede/minha/financeiro` | `dashboard` + uma de {network.finance_view, network.billing} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ empresa é nó da rede + `network.finance_view`, `network.billing` ou `finance` (ver) (aviso) | Domínio também aceita `finance` (ver) sem operação da rede (menu não) — D9 |
| Rede de certificação › Resultado da rede | `/rede/financeiro` | `dashboard` + uma de {network.finance_view, network.billing, network.manage} + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma, `network.finance_view`, `network.billing` ou `finance` (ver) (aviso) | Domínio também aceita `finance` (ver) (menu não) — D9 |
| Rede de certificação › Preços da rede e catálogo | `/rede/precos` | `dashboard` + op `network.manage` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma (`network.manage`) | Consistente; só existe neste menu (plataforma em empresa varejo/escritório não tem atalho) |
| Rede de certificação › Parâmetros da rede | `/rede/parametros` | `dashboard` + op `network.manage` + recurso `redeCertificacao` | `dashboard` + `redeCertificacao` + ▸ plataforma (`network.manage`) | Consistente; só existe neste menu |

### Resumo das divergências entre menu, tela e ação

| Tipo | Casos |
|---|---|
| **Item visível sem a permissão da página** | `/compras/precificacao`: o menu não exige `products` (ver), a página exige. `NAV_ACCOUNTING › /rede/minha/financeiro`: o menu usa `finance`, a página exige `dashboard` |
| **Página mais permissiva que o menu** (acesso sem item de menu) | 12 telas do comércio digital (D5). `/comercio-digital/ver-loja` não confere `sales` (D6). Itens “(plataforma)” de `/rede/vendas`, `/rede/renovacoes` e `/rede/financeiro`: o menu exige `network.manage`, a página não. O financeiro da rede aceita `finance` (ver) (D9) |
| **Botão exige operação que a ação não confere** | `simulateEventAction`, `simulateCreditsAction` e `retryChargeAction` (D3); `generateObligationsAction` (D4) |
| **Módulo trocado entre tela e ação** | `/fiscal/entradas` (`fiscal`) → `/fiscal/entradas/nova` e `createNoStockEntryAction` (`purchases`) (D7) |
| **Telas sem item de menu** (só por link) | `/dashboard/metas`, `/rede/novo`, `/rede/[id]`, `/rede/fechamentos/[id]`, `/rede/clientes/novo`, `/rede/vendas/nova`, `/compras/aprovacoes/politica`, `/estoque/transferencias/depositos`, `/produtos/importar`, `/conta/seguranca`, `/caixa/recebimentos/[id]` e as telas de detalhe e de impressão. `/rede/precos` e `/rede/parametros` só aparecem no `NAV_CERTIFICATION`, embora a plataforma também opere a partir de empresas de varejo e de escritórios |
| **Áreas escondidas pelo tipo, mas acessíveis por URL** | `NAV_ACCOUNTING` e `NAV_CERTIFICATION` omitem PDV, vendas, estoque, `/administracao/terminais`, `/administracao/importacao` etc. As páginas continuam abertas a quem tiver o módulo, como `isAdmin` ou um perfil personalizado |

---

## 6. Dependências externas relevantes para multiempresa

### 6.1 Pacotes (`package.json`)

| Pacote | Versão | Uso | Relevância multiempresa |
|---|---|---|---|
| `next` | ^15.5.27 | App Router, server actions, middleware | O middleware atende o domínio próprio de **todas** as lojas na mesma instalação. Cada server action exportada vira um endpoint POST; todas as do ERP passam por `runAction` |
| `react` / `react-dom` | ^19.3.0 | `cache()` por requisição | Sessão e leituras memoizadas por requisição |
| `pg` | ^8.23.1 | Postgres | **Um banco para todas as empresas.** O isolamento fica só na aplicação (`companyId` e `ScopedStore`); não há RLS |
| `node-appwrite` | ^20.3.0 | Backend legado (banco, Auth, Storage) | Mesma regra de isolamento; o Auth do Appwrite é único para a instalação |
| `@vercel/blob` | ^2.9.0 | Arquivos privados | Um store para todos. O caminho `<bucket>/<id>` não leva a empresa; quem isola é a tabela `files` (`readFile` confere `companyId`) |
| `@vercel/functions` | ^3.11.2 | `attachDatabasePool`: pool do Postgres nas funções | Um pool por instância, compartilhado por todas as empresas. As tarefas depois da resposta usam `after` (de `next/server`): depois de **qualquer** ação, `scheduleBackgroundJobs` roda até 10 tarefas vencidas de **qualquer empresa**, cada uma em `systemCtx` |
| `node-forge` | ^1.4.0 | Certificado A1 (PFX) | Certificado por empresa ou filial (`fiscal_configs`); download exige `fiscal.configure` |
| `fast-xml-parser` | ^5.11.2 | XML de NF-e e CT-e (entradas) | Importação na empresa ativa |
| `jszip` | ^3.10.2 | Pacote contábil (ZIP) | Gerado por empresa; entregue ao escritório vinculado |
| `qrcode`, `zod`, `recharts`, `lucide-react`, `clsx`, `server-only` | — | QR Pix/NFC-e, validação, interface | Sem efeito no isolamento |
| Desenvolvimento: `@electric-sql/pglite`, `vitest`, `@playwright/test`, `tsx` | — | Testes | Há um teste do isolamento (`tests/scoped-store.test.ts`) |

### 6.2 Serviços

| Serviço | Onde / variável | Como é compartilhado hoje | Relevância |
|---|---|---|---|
| Postgres (Vercel/Neon) | `DATABASE_URL` / `POSTGRES_URL` | Um banco por instalação | Base do isolamento lógico |
| Vercel (hospedagem, região `gru1`) | `vercel.json`, `APP_URL`, `APP_HOSTS` | Um projeto para o ERP e para as lojas | Os domínios próprios das lojas entram no mesmo projeto |
| Vercel Cron | `/api/jobs` (diário, 08:47 UTC) e `/api/keepalive` (03:17 UTC); `CRON_SECRET` | Rotina única | Processa tarefas e rotinas diárias de todas as empresas |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` | Store único e privado | Ver acima |
| API da Vercel (domínios) | Integração `store_domains` / `hosting_api` (`src/domain/ecommerce/providers.ts:403`); token `DOMINIOS_API_TOKEN`; `projectId`/`teamId` informados por cada empresa | Token da instalação | Uma empresa escolhe o projeto e o time em que o token age (A7) |
| DNS público | `node:dns` `resolveTxt` (verificação TXT); `STORE_DNS_CNAME` / `STORE_DNS_A` | — | Comprova a posse do domínio de cada loja |
| Appwrite (legado) | `APPWRITE_*` | Projeto único | — |
| Focus NFe (NF-e, NFC-e, NFS-e) | `api.focusnfe.com.br` / `homologacao.focusnfe.com.br`; `FOCUSNFE_TOKEN` (prefixos `FOCUSNFE_`, `FOCUS_`, `NFE_`, `NFCE_`, `NFSE_`); CSC `NFCE_CSC` | Configuração por empresa ou filial, mas a **variável é da instalação** e o nome padrão é o mesmo para todas | A7 |
| Mercado Pago (Pix do PDV) | `api.mercadopago.com`; `MERCADOPAGO_ACCESS_TOKEN` | Idem: **mesma conta para todas as empresas** sem configuração própria | A7 |
| E-mail (Resend ou Appwrite Messaging) | `api.resend.com`; `RESEND_API_KEY` | Conta única: convites, recuperação, cobranças, documentos, chamados e entregas ao escritório | A7 |
| Gateway Intercert, Banco Intercert, fretes e entregas | `GATEWAY_INTERCERT_*`, `BANCO_INTERCERT_*`, `FRETES_*`, `ENTREGAS_*` | Hoje só simulação; integrações por empresa (loja) com variável da instalação | A7 |
| BrasilAPI (CNPJ) e ViaCEP | `brasilapi.com.br/api/cnpj/v1/`, `viacep.com.br` (desligável com `STORE_CEP_LOOKUP=off`) | Públicas | Nenhuma credencial |
| WhatsApp | Só links `wa.me` | — | — |
| Conector local de periféricos/TEF | `http://127.0.0.1:9100`, chamado pelo navegador do caixa | Por terminal | O servidor nunca chama o conector |
| Domínio Sistemas | Integração `accounting_dominio` (arquivo) | Por empresa | — |
| Escritório contábil | Integração `accounting` (vínculo por código de uso único) | Empresa ↔ escritório | Leitura somente leitura (`linkedCompanyReader`) |

Observações de infraestrutura:

- O cache de leitura (`src/lib/db/read-cache.ts`) guarda por 15 s, compartilhado na instância, `companies`, `branches`, `roles`, `settings` e `payment_methods`. A chave inclui os filtros (inclusive o de empresa), e não foi encontrado vazamento. O efeito é que uma mudança de perfil, de recurso ou de situação da empresa pode levar até 15 s para valer nas outras instâncias.
- O executor de tarefas (`runDueJobs`) é único para todas as empresas. Uma empresa com muitas tarefas atrasa as demais.

---

## 7. Achados priorizados

### Alta — acesso ou exposição entre empresas

**A1 — O administrador de qualquer empresa consegue conceder operações de plataforma.**

- **Onde.**
  - O formulário de perfil lista as 60 operações (`src/app/(app)/administracao/usuarios/perfis/role-options.ts:7`).
  - `normalizeActions` aceita qualquer chave válida (`src/domain/roles.ts:84`).
  - `createRole` (`:212`) e `updateRole` (`:253`) só exigem `admin` (criar/editar) e `admin.users` na empresa ativa.
  - Não há regra “só concede o que possui” nem restrição por tipo de empresa. Basta editar o próprio perfil, inclusive o de sistema “Administrador”.
- **Efeito.**
  - `network.manage` torna `isPlatform()` verdadeiro (`src/domain/network/common.ts:62`). O usuário passa a ver e gerir a rede inteira: nós de todas as empresas, vendas, renovações, resultado, preços, parâmetros, empresa da plataforma e estorno.
  - `certification.operate` dá a fila de certificados de **todas** as empresas (`listCertificationQueue`) e permite confirmar pagamento, validar e emitir.
  - Ambas permitem alterar o catálogo e o custo AC globais (`saveCertificationSettings`).
  - O recurso `redeCertificacao` o próprio administrador liga em Parâmetros (D18).
- **Quem consegue.** Os perfis padrão “Administrador” (varejo), “Sócio / Administrador do escritório” e “Administrador do parceiro”.
- **Divergência.** Os modelos `DEFAULT_ROLES`, `FIRM_ROLES` e `PARTNER_ROLES` excluem essas operações, mas o servidor não impede que um perfil as receba. O mesmo vale para módulos fora do tipo da empresa: `ACCOUNTING_MODULES` e `RETAIL_ONLY_MODULES` são só convenção.

**A2 — A cópia de segurança de uma empresa leva usuários globais com credenciais.**

- **Onde.** `collectRows` (`src/domain/backup.ts:140`) inclui os usuários vinculados e **todos os administradores gerais** (`isAdmin`), sem remover nenhum campo. O artefato pode ser baixado em `/administracao/backups/[id]/download` e em `/api/files/[id]` por quem tem `admin.backup` na empresa, o que inclui o perfil padrão “Administrador”.
- **Efeito.** O administrador de uma empresa cliente obtém dos administradores gerais e dos usuários que também acessam outras empresas:
  - `passwordHash` (na autenticação própria, com Postgres);
  - `totpSecretEnc` e `totpRecoveryHashes`;
  - `inviteTokenHash`;
  - `companyIds`/`roleByCompany`, que revelam quais são as outras empresas;
  - as `user_prefs` desses usuários.

**A3 — `isAdmin` é superusuário de todas as empresas, e não existe outro papel de plataforma (estrutural).**

- `can`/`canDo` são sempre verdadeiros (`src/lib/permissions.ts:274-282`).
- `accessibleUnits` devolve todas as empresas (`src/lib/auth/users.ts:82`).
- `ctxForCompany` libera qualquer empresa e `isPlatform` é verdadeiro.
- Esses usuários entram na cópia de qualquer empresa (A2) e na lista de usuários e vendedores de todas.
- A operação da plataforma (rede e certificação) depende de `isAdmin` ou de operações concedidas por perfil de empresa (A1).

**A4 — Chamados públicos ficam visíveis para todas as empresas.**

- **Onde.**
  - `publicTicketAction` grava `companyId = "public"` (`src/app/actions/public.ts`).
  - O `ScopedStore` libera `public` em `tickets`/`ticket_messages`.
  - `getTicketFor` (`src/domain/support.ts:68`) e `queryTickets` (`:308`) entregam esses chamados a quem tem `support.manage`.
- **Efeito.** O “Administrador” de cada empresa de varejo e o “Sócio” de cada escritório, que têm `support.manage` no perfil padrão, leem, respondem e alteram chamados abertos na tela de login por qualquer pessoa (nome, e-mail, mensagem).

**A5 — Um escritório existente pode ser vinculado à rede sem consentimento.**

- **Onde.** Em `createNode` (`src/domain/network/nodes.ts:71`), no ramo `linkCnpj` (`:90`), quem tem `network.children` (ou é plataforma) vincula **qualquer** empresa `accounting` ativa, pelo CNPJ, como nó “contador” abaixo do próprio nó. A regra “uma empresa ocupa um único lugar na rede” transforma isso em quem chegar primeiro.
- **Efeito.**
  - `renewalWorld` (`src/domain/network/renewals.ts:96`) passa a ler `accounting_certificates`, contatos e `accounting_clients` do escritório.
  - `rowVisible` (`:186`) mostra esses dados aos níveis acima que têm `network.renewals`/`network.sales_all`.
  - O escritório não aceita o vínculo e não recebe notificação. Há só um registro no histórico de auditoria dele (`auditNode`).

**A6 — O download de arquivo entregue não respeita a carteira.**

- **Onde.** `src/app/api/files/[id]/route.ts:24` exige só `kind = accounting`, `accounting` (ver) e que a entrega pertença ao escritório. Não aplica `visibleClientIds`, que `listDeliveries` e `reviewDelivery` aplicam.
- **Efeito.** Um analista restrito à própria carteira baixa XML e pacotes de clientes de outros responsáveis se tiver o id do arquivo. Os ids aleatórios de 32 caracteres hexadecimais reduzem a exploração, mas a regra diverge da tela.

**A7 — Credenciais de integração são compartilhadas entre empresas.**

- **Onde.**
  - `secretRefProblem` (`src/domain/integrations.ts:299`) só valida o formato, os nomes reservados e o prefixo do provedor.
  - Os nomes padrão são iguais para todas as empresas: `MERCADOPAGO_ACCESS_TOKEN` (`:59`), `FOCUSNFE_TOKEN`, `RESEND_API_KEY` (`:217`), `DOMINIOS_API_TOKEN` (`:204`), `GATEWAY_INTERCERT_*`, `BANCO_INTERCERT_*`.
  - `hostingApiDomains` usa o token da instalação com `projectId`/`teamId` escolhidos pela empresa.
- **Efeito.**
  - Sem configuração própria, todas as empresas usam a **mesma** conta: Pix na mesma conta Mercado Pago, emissão com o mesmo token fiscal e e-mail pela mesma conta.
  - Com `admin.integrations` (ou `fiscal.configure`, no caso fiscal), uma empresa pode apontar para a variável de outra.
  - Uma empresa pode cadastrar domínios em outro projeto da Vercel ao qual o token tenha acesso.

### Média

- **D1 — Lacunas estruturais do `ScopedStore`** (`src/lib/db/scoped-store.ts`).
  - As coleções sem `companyId` (`users`, `companies`, `user_prefs`, `counters`, `sessions`, `auth_challenges`) não são filtradas. Dezenas de consultas leem **todos** os usuários da instalação e filtram em memória.
  - `list()` não acrescenta o escopo quando o filtro já cita `companyId`, qualquer que seja o valor (`:24`, `:70`).
  - `delete()` e `increment()` (`:88`, `:92`) não conferem a empresa.
  - Hoje os chamadores conferem antes, mas o isolamento depende de disciplina.
- **D3 — Ações do comércio digital sem a operação que a tela pede.** Exigem só `sales` (ver) e o recurso:
  - `simulateEventAction` (`src/app/(app)/comercio-digital/actions.ts:433`); a tela pede `manage`/`finance`.
  - `simulateCreditsAction` (`:448`); a tela pede `finance`.
  - `retryChargeAction` (`:353`); a tela pede `orders`.
  - De consulta: `testCouponAction` (`:392`) e `sampleQuoteAction` (`:509`).

  Um caixa com `sales` (ver) consegue, por chamada direta, aprovar o pagamento simulado de um pedido.
- **D8 — Qualquer administrador de empresa cria empresas.**
  - `createCompany` (`src/domain/companies.ts:139`) só exige `admin` (criar) na empresa ativa e aceita qualquer tipo (`retail`, `accounting`, `certification`); o criador vira administrador da nova empresa.
  - Parceiros com `network.children` também criam empresas, ao cadastrar nós, e convidam o administrador delas.
  - Não há papel nem limite de plataforma.
- **D12 — Dados por empresa guardados no usuário global.**
  - Os percentuais de comissão (`commissionBps`, `commissionByCategory`, em `src/domain/sellers.ts:150`) ficam no usuário e valem em **todas** as empresas dele. `commissionByCategory` ainda guarda ids de categorias de uma única empresa.
  - `updateSeller` não exige que o gestor administre todas as empresas do usuário. Já o limite de desconto próprio (`discountLimitBps`), também global, exige (`assertManagesWholeUser` em `updateUser`).
  - `loadSeller` (`:140`) aceita `isAdmin`: o gestor de comissões de uma empresa altera o cadastro de um administrador geral.
- **D17 — O tipo de empresa só existe no menu.** `navFor(kind)` esconde áreas, mas só a Gestão contábil confere `company.kind`. A rede e o comércio digital dependem do recurso e do perfil.
- **D18 — Os recursos ficam nas mãos da própria empresa.** `saveParameters` (`admin` editar) liga `feature.redeCertificacao`, `feature.comercioDigital` etc. na própria empresa. O comentário de `KIND_FEATURE_DEFAULTS` diz que “a plataforma pode ligá-la”, mas não existe controle da plataforma.

### Baixa — divergências entre menu, tela e ação

- **D2 —** A guarda do layout `(app)` não exige módulo e não substitui a da página, porque layout e página renderizam em paralelo. Hoje 198 das 204 telas autenticadas têm guarda própria com módulo (seção 2). As telas novas precisam manter essa regra.
- **D4 —** `generateObligationsAction` (`src/app/(app)/fiscal/actions.ts:427`) exige só `fiscal` (editar). O botão “Gerar da competência” aparece só com `fiscal.issue` (`src/app/(app)/fiscal/relatorios/page.tsx:466`).
- **D5 —** 12 telas do comércio digital abrem, em consulta, com mais operações do que as que o item de menu exige (detalhes na seção 5).
- **D6 —** `/comercio-digital/ver-loja` não confere o módulo `sales`, que o menu confere.
- **D7 —** Há troca de módulo. `/fiscal/entradas` exige `fiscal`, mas `/fiscal/entradas/nova` e `createNoStockEntryAction` exigem `purchases`. `/compras/precificacao` aparece no menu sem `products` (ver), que a página exige.
- **D9 —** Na rede, os itens “(plataforma)” de `/rede/vendas`, `/rede/renovacoes` e `/rede/financeiro` exigem `network.manage` no menu, mas as páginas não. `assertFinanceReader`, `relationFinance` e `readClosing` aceitam `finance` (ver), que o menu não aceita. `/rede/minha/financeiro` usa `finance` no `NAV_ACCOUNTING` e `network.finance_view`/`billing` no `NAV_CERTIFICATION`, enquanto a página exige `dashboard`.
- **D10 —** Depósito de filial de outra empresa: `createWarehouse` usa `branchAdminCtx` e funciona, mas `loadWarehouse` (`src/domain/warehouses.ts:36`) procura o depósito no Store da empresa ativa. Por isso editar, inativar e definir o padrão falham com “Depósito não encontrado” fora da empresa ativa.
- **D11 — Verificado, sem problema.** As ações contábeis conferem só o módulo `accounting` em `runAction`, mas o domínio chama `requireFirm` em todas as criações: clientes, grupos, departamentos, solicitações, certificados conhecidos e código de vínculo. As demais operações só alcançam registros que existem no escritório.
- **D13 —** `currentUserAuthId` (`src/app/actions/session.ts:287`) é exportada num arquivo `"use server"` e não tem uso. Se estiver alcançável como ação, devolve o documento completo do usuário, com o hash da senha e os segredos de duas etapas cifrados.
- **D14 —** `/api/unit` troca a empresa ativa por GET (cookie `SameSite=Lax`). Um link externo pode trocar o contexto de quem acessa várias empresas.
- **D15 —** `/api/export/[key]` confere só o módulo e `data.export`. Não aplica recursos desligados (DRE, inventário fiscal, adquirente, nota a confirmar, livro de entradas) nem as operações das telas; a única exceção é comissões.
- **D16 —** `/comercio-digital/pagamentos` lê `commerce_events` (unscoped) pelo `orderId` da URL sem conferir a loja nem a empresa. É só leitura do último evento de pagamento.

### Telas e ações sem verificação própria — síntese

- **Telas sem guarda de módulo:**
  - só redirecionam: `/`, `/financeiro`, `/fiscal`;
  - estática: `/sem-permissao`;
  - só sessão, com regra própria: `/conta/seguranca` (próprio usuário), `/caixa/recebimentos/[id]` (exige `pdv`, `cash` ou `finance`) e `/financeiro/receber/[id]/carne` (exige `finance`, ou `sales` para título de venda);
  - públicas por definição: 8 de acesso, 6 da vitrine e `/documento/[token]`.

  As outras 198 telas autenticadas chamam guarda com módulo.
- **Ações sem módulo em `runAction`:** 9, todas com verificação no domínio ou restritas ao próprio usuário (seção 4).
- **Ações sem a operação especial exigida pela tela:** D3 e D4.
- **Funções públicas:** 25 (vitrine 12, sessão 10, instalação 2, chamado público 1). Todas exigem um token, um cookie ou um segredo, exceto a criação de chamado público e as ações da vitrine, que são abertas por definição.

---

## Limites do levantamento

- **Leitura estática.** O sistema não foi executado. As guardas das páginas vêm do próprio `page.tsx` e dos componentes de página compartilhados: `PrintPage`, `DocumentsList`, `DocumentDetail`, `NewDocumentPage`, `DocumentPrintPage`, `TitlesList`, `TitleDetail`, `TitleReceipt` e `DocDetail`.
- **Coluna “·”.** Lista os `canDo(s.user, …)` usados diretamente na página ou nesses componentes. Formulários de cliente e subcomponentes podem ter regras adicionais de exibição.
- **Coluna “Domínio” das ações.** Foi obtida seguindo as funções importadas por cada ação até 3 níveis. Ficou revisada à mão nos casos sem operação especial (D3, D4), nas ações sem módulo e nas que saem do escopo.
- **Achados de segurança A1–A7.** Descrevem o comportamento do código na revisão `0aa96c2`. Não foram reproduzidos contra uma instalação.
