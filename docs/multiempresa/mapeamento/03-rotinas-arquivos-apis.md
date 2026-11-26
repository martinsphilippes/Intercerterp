# 03 — Rotinas, arquivos, notificações, exportações, APIs, backups, integrações e cache

Mapeamento do estado atual, **somente leitura**: nenhum código foi alterado.

- **Base:** commit `0aa96c2`, de 26/11/2026.
- **Referências:** estão no formato `arquivo:linha`, relativas à raiz do repositório.
- **Documento irmão:** `02-identidade-e-permissoes.md` trata de usuários, perfis, `isAdmin` e "plataforma". Aqui esses temas só aparecem quando afetam rotinas, arquivos ou rotas.

**Convenções**

- **Store com escopo:** o `ScopedStore` restrito a uma empresa (`src/lib/db/scoped-store.ts`).
- **Store sem escopo:** `getStore()` ou `unscoped(...)`, que enxergam a instalação inteira.
- **Empresa:** um registro da coleção `companies`.

---

## Sumário dos achados

1. **Rotinas e tarefas rodam para a instalação inteira.**
   - O cron diário percorre **todas** as empresas, sem filtro de situação (`src/domain/scheduler.ts:21`).
   - O executor de tarefas pega as vencidas de **qualquer** empresa (`src/lib/core/jobs.ts:86`). Isso acontece no cron e "de carona" depois de cada ação de usuário e de cada ação da vitrine pública (`src/lib/server/action.ts:31`; `src/app/loja/[store]/actions.ts:25`).
   - Não há fila nem prazo por empresa.
2. **Empresa inativa continua "viva" em segundo plano.**
   - Só existem as situações `active` e `inactive`. Não existe situação "suspensa" para empresa (`src/domain/companies.ts:217-228`).
   - A inatividade bloqueia a sessão e a vitrine.
   - Rotinas, tarefas (transmissão fiscal, e-mail, cópia de segurança), webhook do gateway e link público de documento **não** conferem a situação da empresa.
3. **Arquivos não têm partição física por empresa.**
   - O Blob usa o caminho `<bucket>/<id>` (`src/lib/core/files.ts:98`).
   - A tabela `_intercert_files` não tem `companyId` (`src/lib/db/postgres/ddl.ts:144`).
   - O isolamento depende só do registro `files.companyId` e das rotas de download, que estão corretas: `src/lib/core/files.ts:255`; `src/app/api/files/[id]/route.ts:19-36`.
4. **A cópia de segurança "da empresa" leva dados de fora dela.**
   - Leva todos os administradores globais e os usuários vinculados, **com `passwordHash`, segredo TOTP cifrado e hashes de recuperação**. Leva também os chamados públicos da tela de login (`src/domain/backup.ts:140-152`).
   - O artefato pode ser baixado por quem tem `admin.backup` naquela empresa (`src/app/(app)/administracao/backups/[id]/download/route.ts:11-19`).
5. **Credenciais de integração são nomes de variáveis de ambiente sem dono.**
   - O prefixo validado protege os segredos do sistema (`src/domain/integrations.ts:280-305`).
   - Mas **qualquer empresa** pode vincular uma variável criada para outra empresa, se ela tiver o prefixo do provedor. Os padrões (`FOCUSNFE_TOKEN`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`...) são os mesmos para todas.
   - O remetente do e-mail e o projeto ou equipe da API de hospedagem são texto livre.
6. **O cache não vaza entre empresas.**
   - As chaves de listagem embutem o filtro de empresa, e o `ScopedStore` filtra depois do cache (`src/lib/db/read-cache.ts:72-84`).
   - O cache compartilhado de 15 s, por instância, pode atrasar a inativação de empresa, a troca de perfil e a mudança de parâmetro (`read-cache.ts:15-16`).
7. **Todas as 396 server actions das telas do ERP passam por `runAction`.** As exceções são as ações globais de sessão e instalação, o chamado público e a vitrine.

Riscos priorizados: §11.

---

## 1. Peças comuns usadas por tudo o que segue

### 1.1 Banco único

- Um único banco, com tabelas compartilhadas por todas as empresas: `getStore()` devolve `ReadCachedStore(PostgresStore)` (`src/lib/db/index.ts:46-66`).
- Não há segurança por linha no Postgres. As tabelas são geradas do esquema único (`src/lib/db/postgres/ddl.ts:6-17`).
- O isolamento é **só** de aplicação.

### 1.2 Regras do `ScopedStore`

| Operação | Comportamento | Linhas |
|---|---|---|
| `get` / `getOrThrow` | Registro de outra empresa vira "inexistente". Registro com `companyId` nulo é visível. `"public"` é visível só em `tickets`/`ticket_messages`. | `scoped-store.ts:43-68` |
| `list` | Acrescenta `companyId = ativa OU nulo`. **Não acrescenta nada se qualquer filtro mencionar `companyId`**, com qualquer valor. | `scoped-store.ts:24-31, 70-76` |
| `create` / `update` | Recusa gravar `companyId` de outra empresa **no dado enviado**. Não confere a empresa do registro que já existe. | `scoped-store.ts:49-54, 78-86` |
| `delete` / `increment` | Repassam direto, sem conferir a empresa. | `scoped-store.ts:88-94` |
| `transaction` | Mantém o escopo dentro da transação. | `scoped-store.ts:96-98` |
| `unscoped()` | Devolve o Store sem escopo (uso "explícito"). | `scoped-store.ts:109-111` |

- **Coleções sem `companyId`:** `companies`, `users`, `user_prefs`, `counters`, `sessions`, `auth_challenges`. Elas ficam inteiras visíveis em qualquer contexto (conferido no esquema `src/lib/db/schema.ts`; ver também `02-…` §2.9).
- **Pseudo-empresas:**
  - `"public"`: chamados da tela de login (`src/app/actions/public.ts:15-16`).
  - `"platform"`: registros da rede de certificação (`src/domain/network/common.ts:19-24`) e o sinal diário (`src/app/api/keepalive/route.ts:24-25`).

### 1.3 Contextos

| Contexto | Empresa | Linhas |
|---|---|---|
| Sessão | Cookie `ic_unit` (`empresa:filial`), validado contra as empresas acessíveis e ativas. Store com escopo. | `src/lib/server/session.ts:31-82` (empresa inativa descartada em `:46`) |
| `requireApiSession` | Exige sessão e contexto completo (empresa + filial, ou consolidado). Senão responde 401/409. | `session.ts:104-110` |
| `systemCtx(store, companyId)` | Store com escopo da empresa e usuário técnico `isAdmin: true`. **Com `companyId` vazio, devolve o Store sem escopo.** | `src/lib/core/ctx.ts:58-65` (`:60`) |
| `ctxForCompany` / `companyAdminCtx` | Outra empresa à qual o usuário tem acesso. | `ctx.ts:51-55`; `src/domain/companies.ts:175-185` |
| `companyCtx` (rede) | Store com escopo de qualquer empresa, com `SYSTEM_USER`. | `src/domain/network/billing.ts:25-32` |
| `readOnly(...)` | Leitura de outra empresa sem gravação. | `src/lib/db/read-only.ts:9-56` |

---

## 2. Rotinas e tarefas em segundo plano

### 2.1 Gatilhos

| Gatilho | Onde | O que executa | Empresas atingidas |
|---|---|---|---|
| Vercel Cron `47 8 * * *` (08:47 UTC, diário) → `GET /api/jobs` | `vercel.json:4-9`; `src/app/api/jobs/route.ts:12-20` | `runScheduled` (todas as rotinas × todas as empresas) e depois `runDueJobs` (até 50 tarefas, prazo de 240 s); `maxDuration = 300` (`route.ts:10`) | **todas** |
| Vercel Cron `17 3 * * *` → `GET /api/keepalive` | `vercel.json:10-13` | Leitura e gravação de `settings` da pseudo-empresa `"platform"` | nenhuma |
| Depois de **cada** server action do ERP | `src/lib/server/action.ts:31` → `src/lib/server/background-jobs.ts:13-29` | `runDueJobs(getStore(), { limit: 10, deadlineMs: +20 s })` em `after()`, no máximo a cada 30 s por instância (`:10, :16`). Desligável com `BACKGROUND_JOBS=off` (`:14`). | **todas**, não só a da requisição |
| Depois de cada ação da **vitrine pública** (anônima) | `src/app/loja/[store]/actions.ts:22-35` (`:25`) | Igual ao anterior | **todas** |
| "Executar tarefas pendentes agora" e "Reprocessar" (Central de integrações) | `src/app/(app)/administracao/integracoes/actions.ts:83-97` → `src/domain/integrations.ts:704-734` | `runDueJobs(ctx.store, { jobIds })`, com Store com escopo e ids filtrados por `companyId`. **Não roda rotinas.** | só a empresa ativa |
| Consulta fiscal da venda | `src/domain/sales.ts:1693-1729` | `runDueJobs` pelos ids da venda | empresa ativa |
| Restauração em nova base | `src/app/(app)/administracao/backups/actions.ts:47-51` | `runDueJobs(getStore(), { jobIds: [id] })` em `after()` | a empresa da cópia |
| Carga da demonstração | `src/domain/seed/history.ts:94, 165` | `runDueJobs(store, { limit: 2000 / 200 })` com o Store da instalação | **todas** (enquanto a carga não termina) |

O comentário de `/api/jobs` diz que a rota é "acionada manualmente pela Central de integrações" (`route.ts:7`). Nenhuma tela chama a rota: a Central usa `runCompanyJobs`.

### 2.2 Rotinas diárias (`src/domain/scheduler.ts`)

**Registro**

- As rotinas se registram com `registerRoutine` (`scheduler.ts:16-18`).
- Os módulos são carregados por `src/domain/jobs-registry.ts:2-5` → `src/domain/routines/index.ts:1-9`.
- Ordem de execução: finance, purchases, fiscal, admin, stock, accounting, sales, network, ecommerce.

**Iteração (`scheduler.ts:20-37`)**

1. `listAll(store, "companies")` sem filtro (`:21`): todas as empresas, inclusive inativas e de demonstração, uma após a outra.
2. Para cada empresa e cada rotina, lê o marcador `routine.<chave>.lastRun` em `settings` da empresa (`:26-27`) e compara com `today()`. O fuso é **único da instalação** (`APP_TIMEZONE`, `src/lib/dates.ts:7, 31`).
3. A rotina recebe `(store, companyId)` com o Store **sem escopo**: o da rota (`src/app/api/jobs/route.ts:17`).
4. Sucesso grava o marcador (`:31`). Erro vai para o resultado e **não** grava o marcador (`:32-34`). A nova tentativa só acontece na próxima chamada do cron, que no plano Hobby é diária (`background-jobs.ts:6-7`).
5. Não há prazo interno. Com muitas empresas, o limite de 300 s da função pode cortar as últimas da lista. `runDueJobs` só roda depois de todas as rotinas (`route.ts:18-19`).

**As 19 rotinas e como cada uma determina a empresa**

| Chave | Registro → implementação | Como restringe à empresa | Cruza empresas? |
|---|---|---|---|
| `finance.due` | `routines/finance.ts:53` → `:16-51` | Filtros `companyId` em `installments` (`:17`) e `notifications` (`:39`) | `store.get("installments", id)` sem escopo (`:45`), com id vindo das notificações da própria empresa. `resolveOccurrence` sem filtro de empresa (`:48`; ver §4.1). |
| `finance.delinquency` | `routines/finance.ts:95` → `:60-93` | Filtros (`:62, :87`) e conferência de `customer.companyId` (`:75-76`) | Reabre e resolve ocorrências por chave global (`:79, :90`) |
| `purchases.followup` | `routines/purchases.ts:14-44` | Filtro (`:16`) | Não |
| `purchases.pending_invoice` | `routines/purchases.ts:51-54` → `src/domain/pending-invoice.ts:1007-1035` | Filtros (`pending-invoice.ts:269, 1011`) | `store.get("suppliers")` sem escopo (`:1025`), com id do recebimento da empresa |
| `fiscal.obligations` | `routines/fiscal.ts:16-22` | `systemCtx`, Store com escopo (`:17`) | Não |
| `fiscal.certificate` | `routines/fiscal.ts:24-47` | Filtro (`:26`) | Não |
| `fiscal.accountingExport` | `routines/fiscal.ts:49-52` → `src/domain/fiscal/export.ts:406-418` | `systemCtx` | **Sim, deliberado:** grava a entrega na empresa do escritório vinculado (`export.ts:318`; `src/domain/accounting/deliveries.ts:31-70`) |
| `fiscal.stuck` | `routines/fiscal.ts:54-65` | Filtro (`:56`); a tarefa nasce com `companyId` (`:61`) | Não. Retransmite documentos parados **também de empresa inativa**. |
| `admin.backup` | `routines/admin.ts:10` → `src/domain/backup.ts:634-646` | Filtro e `systemCtx` (`backup.ts:595, 636-638`); tarefa com `companyId` (`:644`) | O conteúdo da cópia inclui dados globais (§6) |
| `admin.roles` | `routines/admin.ts:13` → `src/lib/auth/role-sync.ts:101-112` | Store sem escopo com filtro `companyId` (`role-sync.ts:103`) | Não |
| `stock.transfers_overdue` | `routines/stock.ts:13-36` | Filtro (`:15`) | Não |
| `stock.inventories_stale` | `routines/stock.ts:38-59` | Filtro (`:40`) | Não |
| `stock.lot_expiry` | `routines/stock.ts:62-65` → `src/domain/lots.ts:196-219` | Filtros (`lots.ts:157, 161, 213`) | `resolveOccurrence` global (`:216`) |
| `accounting.certificates` | `routines/accounting.ts:9` → `src/domain/accounting/certificates.ts:872-903` | Só empresa `kind=accounting` (`:874`); `systemCtx` (`:876`) | **Sim, deliberado:** lê `fiscal_configs` das empresas vinculadas com leitor somente leitura autorizado (`certificates.ts:800-815`) |
| `sales.documents_expire` | `routines/sales.ts:11` → `src/domain/sales-documents.ts:1033-1052` | Filtro e `systemCtx` por documento | Não |
| `sales.presale_reservations` | `routines/sales.ts:14` → `src/domain/carts.ts:266-279` | Filtro em `stock_reservations` (`carts.ts:268`) | `store.get("carts")` sem escopo (`:271`), com id das reservas da empresa |
| `network.renewals` | `routines/network.ts:10` → `src/domain/network/renewals.ts:337-378` | Nó da empresa (`:338`) | **Sim, deliberado:** lê certificados e solicitações de **toda a rede** pelo CPF/CNPJ do titular (`renewals.ts:101-107`), expõe `renewedBy` de outra empresa (`:125-127, 138`) e notifica a empresa do nó acima (`:368-374`) |
| `network.billing` | `routines/network.ts:17-20` → `src/domain/network/ledger.ts:654-669` | Store sem escopo em `cert_sale_finance` por `requestCompanyId` (`:658`); `companyCtx` (`:659`) | **Sim, deliberado:** fechamentos com títulos nas empresas pagadora e recebedora (`ledger.ts:628-651`); aviso de saldo baixo à empresa acima (`billing.ts:417-418`) |
| `ecommerce.expire` | `routines/ecommerce.ts:8` → `src/domain/ecommerce/orders.ts:328-341` | Store sem escopo com filtro `companyId` (`:330-331`) | Não |

Quase todas as rotinas notificam com `notify(store, …)` e o Store sem escopo. Cada chamada lista **todos** os usuários ativos e **todos** os perfis da instalação (`src/lib/core/notify.ts:26-28`).

### 2.3 Tarefas duráveis (outbox `jobs`, `src/lib/core/jobs.ts`)

**Gravação**

- A coleção `jobs` tem `companyId`.
- O id é determinístico: `detId("job", dedupeKey)` (`jobs.ts:30`).
- `dedupeKey` é **único na instalação** (`schema.ts:938`).
- Sem `companyId` informado, a tarefa nasce com `companyId: null` (`jobs.ts:35`).
- Todos os pontos que enfileiram passam `companyId`:
  - `enqueue` em `fiscal/service.ts` (várias linhas, por exemplo `:1037`), `routines/fiscal.ts:61`, `backup.ts:644`, `backups/actions.ts:47`, `src/domain/finance.ts:1093` e `src/domain/sales.ts:1718`;
  - `jobRow` nas vendas (`sales.ts:99-104`).

**Execução (`runDueJobs`, `jobs.ts:77-150`)**

- Lista as tarefas vencidas, mais a "running" com trava vencida (`:79-82`), por `runAt` crescente com limite (`:86`).
- Com Store sem escopo (cron, `after()`), a fila é **única e global**: uma empresa com muitas tarefas atrasa as outras.
- Reivindica cada tentativa num registro único em `operations`, gravado **sem `companyId`** (`:92`). Depois trava por 10 min (`:70, :98`).
- O executor roda com `systemCtx(store, job.companyId ?? "", job.payload?.branchId)` (`:106`). O Store fica com escopo da empresa da tarefa. Com `companyId` vazio, fica **sem escopo e com `isAdmin`** (`ctx.ts:60`).
- `__retryAt` reagenda, com teto de 200 vezes (`:108-113`). Erro: recuo exponencial e, no fim, `dead` (`:118-131`).
- Tarefa `dead` gera a notificação `integration_failure` para quem tem `admin.integrations` na empresa da tarefa (`:132-146`).

**Tipos registrados (10)**

| Tipo | Executor | Empresa |
|---|---|---|
| `sale.effects`, `sale.cancel.effects`, `return.effects` | `src/domain/sales.ts:857, 1214, 1634` | Gravadas na transação da venda com `ctx.companyId` (`sales.ts:99-104, 690`) |
| `fiscal.transmit`, `fiscal.query`, `fiscal.cancel`, `fiscal.email` | `src/domain/fiscal/service.ts:2130, 2166, 2174, 2191` | Documento lido pelo Store com escopo. De outra empresa: `skipped`. |
| `finance.account.rebuild` | `src/domain/jobs/finance.ts:7` | `ctx.store` com escopo |
| `admin.backup.scheduled`, `admin.restore.run` | `src/domain/jobs/admin.ts:7, 10` | `ctx` da tarefa (§6) |

`src/domain/jobs/purchases.ts:9` não registra nada.

### 2.4 Empresa inativa ou "suspensa"

**Situações que existem**

- Empresa só tem `active` e `inactive` (`setCompanyStatus`, `src/domain/companies.ts:217-228`).
- "Suspenso" existe só para usuários e para nós da rede (`src/components/ui/badge.tsx:55, 71`).
- Inativar só grava `status` (`companies.ts:225`). Não cancela tarefas, agenda nem integrações.

**Onde a inativação vale**

- Seleção de unidade e sessão: `session.ts:46`; `src/lib/auth/users.ts:97-101`; `src/app/actions/session.ts:120, 196`.
- Vitrine: `src/app/loja/[store]/_lib.ts:31`.
- Criação de filial: `companies.ts:270`.

**Onde não vale**

- `runScheduled` (`scheduler.ts:21`): todas as rotinas continuam. Isso inclui a cópia diária, a geração de obrigações, a retransmissão de documentos parados, os fechamentos da rede e as notificações.
- `runDueJobs` (`jobs.ts:77-106`): transmissão e consulta fiscal, e-mails e cópias seguem.
- Webhook do gateway (`src/app/api/loja/gateway/[provider]/[storeId]/route.ts:16-50`).
- Link público de documento (`src/app/documento/[token]/page.tsx:22-24`): confere só o recurso ligado.
- `notify` continua criando notificações (`notify.ts:24-94`).

**Nó da rede suspenso ou encerrado**

`notifyRenewalAlerts` e `runNetworkBilling` não conferem a situação do nó (`renewals.ts:338-339`; `ledger.ts:654-669`).

**Usuários**

Usuários não ativos não recebem notificações: o filtro `status = active` fica em `notify.ts:26`.

---

## 3. Arquivos

### 3.1 Onde o conteúdo fica

| Backend | Implementação | Local | Partição por empresa |
|---|---|---|---|
| Postgres com Blob conectado | `VercelBlobStorage` (`src/lib/core/files.ts:96-116`) | Blob **privado** (`:102`), caminho `<bucket>/<id>` (`:98`), sem cache na leitura (`:108`) | Nenhuma |
| Postgres sem Blob, ou Blob recusou | `PostgresFileStorage` (`files.ts:123-143`) | Tabela `_intercert_files` (`id`, `bucket`, `data`, `createdAt`; `ddl.ts:26, 144`). Id com prefixo `db:` (`files.ts:146, 168`). A gravação recua do Blob para o banco (`:161-168`). | Nenhuma: não há coluna de empresa |
| Appwrite (legado) | `AppwriteFileStorage` (`files.ts:61-84`) | Bucket lógico, ou um único bucket físico `APPWRITE_BUCKET_ID` (`:27-29`) | Nenhuma |
| Local ou memória | `LocalFileStorage` (`files.ts:31-59`) | `.data/files/<bucket>/<id>` ou memória | Nenhuma |

**Buckets lógicos** (`files.ts:21`)

| Bucket | Conteúdo |
|---|---|
| `documents` | XML/DANFE fiscal, PFX do A1, SPED/EFD, Sintegra, pacote contábil, arquivo da Domínio, XML de NF-e/CT-e de entrada, carga de balança, certificado emitido e evidência de autenticação |
| `attachments` | Títulos, comprovantes, extratos, arquivos de adquirente, comprovantes de obrigação, anexos de chamado |
| `images` | Produtos e identidade da loja |
| `backups` | Artefatos das cópias |

São 25 chamadas a `saveFile` (fora a definição).

**Metadados e acesso**

- A coleção `files` guarda `companyId` e `branchId` (`schema.ts:1379-1383`). É o **único** elo entre o conteúdo e a empresa.
- `saveFile` grava `companyId = ctx.companyId` (`files.ts:234-251`, `:238`).
- `readFile` exige `meta.companyId === ctx.companyId` (`files.ts:253-258`, `:255`). Arquivo com `companyId` nulo também é recusado.
- Consequência: cota, exportação e expurgo por empresa só existem passando pelos metadados. Não há rotina de remoção de empresa (nenhum `delete("companies")` no código). `databaseFileUsage` mede o total da instalação (`files.ts:199-204`).

### 3.2 `GET /api/files/[id]` e `access.ts`

**Fluxo** (`src/app/api/files/[id]/route.ts:15-53`)

1. `requireApiSession("text")` (`:16-17`).
2. `s.ctx.store.get("files", id)` com escopo (`:19`).
3. Se o arquivo for da empresa ativa: aplica `fileAccessDenial` (`:34-35`) e lê com `readFile` (`:38`). Esse download não é auditado.
4. Senão, a exceção do escritório contábil (`:21-33`):
   - Vale só se a empresa ativa for `kind=accounting` e o usuário tiver `accounting` (ver) (`:24`).
   - Exige uma entrega (`accounting_deliveries`) com aquele `fileId` (`src/domain/accounting/deliveries.ts:105-108`).
   - Lê com Store **somente leitura** restrito à empresa de origem (`route.ts:26-29`) e audita o download (`:31-32`).
   - Não aplica `fileAccessDenial`.
   - `deliveryForFile` não confere se o vínculo continua ativo nem se o cliente está na carteira visível do usuário (`deliveries.ts:105-108`; compare com `listDeliveries`, `:85-86`).
5. Resposta: `inline` só para png/jpeg/gif/webp/pdf (`route.ts:8, 40`); `nosniff`, CSP `sandbox` e `Cache-Control: private, no-store` (`:41-48`).

**Quem baixa o quê** (`src/app/api/files/[id]/access.ts:31-60`; `can`/`canDo` são sempre verdadeiros para `isAdmin`, `src/lib/permissions.ts:274-282`)

| Arquivo (bucket, `entityType` ou `kind`) | Exigência |
|---|---|
| bucket `backups`, `backup`, `restore_job` | `admin.backup` (`:32-34`) |
| `certificate_a1`, `fiscal_config` | `fiscal.configure` (`:35-37`) |
| `certificate_issued` | Sempre recusado aqui; só pela rota própria (`:39`) |
| `certificate_auth_evidence`, `certificate_request` | `accounting` (ver) (`:40-42`) |
| `fiscal_file`, `sped_fiscal`, `efd_contribuicoes`, `sintegra` | `fiscal` (ver) + `fiscal.files` (`:44-47, 53-56`) |
| `accounting_package`, `fiscal_export` | `fiscal` (ver) + `data.export` (`:48-51`) |
| Demais | Módulo de origem pelo `ENTITY_MODULE` (`:4-21`), ou `products` para o bucket `images`; sem mapeamento, recusado (`:57-58`) |

### 3.3 Outras rotas que entregam arquivos

| Rota | Regra de empresa |
|---|---|
| `GET /administracao/backups/[id]/download` (`src/app/(app)/administracao/backups/[id]/download/route.ts:8-27`) | `admin` (ver) + `admin.backup` (`:11-14`); `backup.companyId === ctx.companyId` (`:16-17`); auditado |
| `POST /api/certificados/[id]` (`src/app/api/certificados/[id]/route.ts:11-35`) | **Entre empresas, deliberado.** Lê a solicitação sem escopo (`src/domain/accounting/certificates.ts:702`). Libera o escritório dono com autorização do titular (`:704, 709`) ou o titular, empresa vinculada com `fiscal.configure` (`:705`). Confirma a senha (`:710`) e lê o arquivo na empresa do escritório (`:711-712`). |
| `GET /loja/[store]/imagem/[id]` (`src/app/loja/[store]/imagem/[id]/route.ts:10-27`) | Pública. Exige o arquivo da empresa da loja (`:16`), só png/jpeg/webp, ligado à identidade ou ao catálogo da loja (`src/domain/ecommerce/catalog.ts:481-491`). `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (`:22`). |
| `GET /api/export/[key]` | Gera CSV/XLSX na hora (§5.1) |

---

## 4. Notificações e e-mail

### 4.1 `src/lib/core/notify.ts`

**Audiência** (`resolveAudience`, `:24-44`)

- Com `audience.userIds`, usa a lista como veio, **sem conferir** se o usuário pertence à empresa (`:25`).
- Senão:
  1. lista os usuários ativos (`users` não tem `companyId`: lê a instalação inteira) e **todos** os perfis sem escopo (`:26-29`);
  2. mantém quem tem a empresa em `companyIds` **ou é `isAdmin`** (`:31`). O administrador global recebe notificações de todas as empresas;
  3. filtra pela filial (`:32`) e pela permissão no perfil **daquela** empresa (`:36-41`).

**Preferências**

- `user_prefs "notifications"` é por **usuário**, não por empresa (`:50-58`; `src/domain/notifications.ts:171-186`).
- Silenciar um tipo vale em todas as empresas. Prioridade crítica é sempre entregue.

**Gravação**

- Uma notificação por destinatário, com `companyId = input.companyId` (`:61-94`).
- `dedupeKey = "<ocorrência>|<usuário>"`, com id determinístico (`:66, 86`). O índice único é global (`schema.ts:953`).

**Ocorrências**

- `resolveOccurrence` e `reopenOccurrence` filtram só por `occurrenceKey` (`:97-106`). Com o Store sem escopo das rotinas, alcançam qualquer empresa com a mesma chave.
- Hoje as chaves embutem ids de registro (`overdue:<parcela>`, `delinquent:<cliente>`, `job:<tarefa>`...). A colisão depende da unicidade dos ids.

**Canais**

Não há envio de e-mail, push ou WhatsApp a partir de `notify`. O WhatsApp é só link `wa.me` aberto pelo operador (`src/lib/whatsapp.ts:1-4`).

### 4.2 Central de notificações (`src/domain/notifications.ts`)

- A caixa filtra `userId` **e** `companyId` da sessão (`:82-105`, `:83`). Os contadores também (`:154-163`).
- Marcar e arquivar exige `n.userId === ctx.user.id` (`:107-117`), com Store com escopo.

### 4.3 E-mail (`src/lib/core/email.ts`)

**`sendEmail(companyId, msg)`** (`:8-55`)

- Usa o Store sem escopo (`:12`) e a integração `email` **da empresa informada** (`:13`).
- Sem integração ou com `companyId` nulo, devolve `not_configured` (`:14`).

**Resend**

- Chave lida da variável vinculada; padrão `RESEND_API_KEY` (`:18-20`).
- Remetente vem de `config.from`, texto livre, com padrão `Intercert ERP <onboarding@resend.dev>` (`:25`).
- O registro vai para `integration_logs` da empresa, com destinatário e assunto (`:35, 52`).

**Appwrite Messaging (legado)**

- Usa o projeto da instalação e procura o destinatário entre os usuários Appwrite (`:38-49`).

**Quem chama `sendEmail` e com qual empresa (12 pontos)**

| Ponto | Empresa usada |
|---|---|
| Recuperação de senha (`src/lib/auth/provider.ts:87`) | **`u.companyIds[0]`**: a primeira empresa da lista do usuário. Para `isAdmin` sem empresas, `null` e não envia. |
| Convite (`src/domain/users.ts:238`) | `ctx.companyId` |
| Resposta de chamado (`src/domain/support.ts:219`) | A do chamado. Se o chamado for `"public"`, a do atendente. |
| Comprovante de venda (`src/domain/sales.ts:1772`) | `ctx.companyId` |
| Documento fiscal (`src/domain/fiscal/service.ts:1976`) | `ctx.companyId` |
| Pacote contábil (`src/domain/fiscal/export.ts:360`) | `ctx.companyId` |
| Aviso de cobrança (`src/domain/finance.ts:1694`) | `ctx.companyId` |
| Cobrança de certificado (`src/domain/accounting/certificates.ts:471`) | `ctx.companyId` |
| Pedido da loja (`src/domain/ecommerce/orders.ts:78`) | `st.companyId` |
| Orçamento ou pedido (`src/domain/sales-documents.ts:1024`) | `ctx.companyId` |
| Pedido de compra (`src/domain/purchases.ts:506`) | `ctx.companyId` |
| Teste da integração (`src/domain/integrations.ts:598`) | `ctx.companyId` |

---

## 5. Exportações, pesquisa e demais rotas

### 5.1 `GET /api/export/[key]`

**Rota** (`src/app/api/export/[key]/route.ts:13-34`)

- Exige `requireApiSession`, o módulo do exportador (ver) e `data.export` (`:14-19`).
- Os parâmetros da URL vão direto para `def.rows(s, sp)` (`:20-24`), com `s.ctx` com escopo.
- Audita a exportação com os filtros (`:25`). CSV por padrão; XLSX com `formato=xlsx` (`:27-33`).

**Registro** (`src/lib/exporters.ts:24-33`)

- São 62 chaves em 15 arquivos de `src/exports/*` (`src/exports/index.ts:2-16`). São 60 chamadas a `defineExport`, uma delas num laço de três modelos fiscais (`src/exports/fiscal.ts:31-33`).
- Neutraliza fórmulas (`exporters.ts:63-67`).
- A Central de relatórios só aponta para as mesmas chaves (`src/lib/report-catalog.ts:1-8, 85`).

**Exportadores que escolhem empresa ou leem fora do escopo**

| Exportador | Comportamento |
|---|---|
| `admin.companies` (`src/exports/admin.ts:68-83`) | Lista todas as empresas acessíveis. Para `isAdmin`, todas as da instalação. As contagens vêm de leituras sem escopo de `companies`, `branches`, `users` e `terminals` (`src/app/(app)/administracao/empresas/queries.ts:10-41`). |
| `admin.branches` (`admin.ts:85-103`) | Aceita `?empresa=` só se estiver em `s.companies` (`:102`); depois `companyAdminCtx`. |
| `network-closing` (`src/exports/network.ts:7-28`) | A autorização é da rede (`src/domain/network/results.ts:251-260`), que lê `cert_closings` sem escopo. |
| `fin-account-entries`, `fin-acquirer-lines` | Conferem `companyId` do registro pedido (`src/exports/finance.ts:82`; `src/exports/finance-reports.ts:126`). |

- Os relatórios gerenciais usam `scope.companyId = s.ctx.companyId` e as filiais acessíveis (`src/app/(app)/relatorios/params.ts:24-34`).
- Arquivos gerados por ações (pacote contábil, SPED/EFD, Sintegra, Domínio) são gravados com `saveFile` na empresa ativa e baixados por `/api/files/[id]` (§3).

### 5.2 `GET /api/search`

- Rota em `src/app/api/search/route.ts:8-87`.
- Exige `requireApiSession` e permissão por grupo.
- Toda consulta leva `["eq","companyId", s.ctx.companyId]` explícito: `skus`, `customers`, `suppliers`, `sales`, `purchase_orders`, `titles`, `fiscal_documents` (`:24, 32, 42, 51, 58, 65, 72, 80`).
- Não restringe por filial.

### 5.3 `GET /api/unit`

- Rota em `src/app/api/unit/route.ts:7-18`.
- Usa `getSession()`, que aceita contexto incompleto (`:8`).
- Valida `c` e `b` contra `accessibleUnits` (`:12-15`) e grava o cookie `ic_unit` (`:17`).
- Não grava a unidade lembrada e não confere empresa inativa: a sessão seguinte descarta (`session.ts:46`).
- Troca o contexto **por GET**. Usada pela seleção automática (`src/app/(auth)/selecionar-unidade/page.tsx:22`).

### 5.4 `/api/pdv/**`

Todas exigem `requireApiSession` e a permissão `pdv`.

| Rota | Escopo |
|---|---|
| `GET /api/pdv/customers` (`src/app/api/pdv/customers/route.ts:12-77`) | Também aceita `customers`. Por id: confere `companyId` (`:22-23`). Na busca: filtro explícito (`:28`). As demais consultas usam o Store com escopo (`:38-50`). |
| `GET /api/pdv/products` (`src/app/api/pdv/products/route.ts:21-143`) | Exige filial (`:25-26`). Filtros `companyId` explícitos (`:43-75`). |
| `GET /api/pdv/lots` (`src/app/api/pdv/lots/route.ts:10-31`) | Confere `sku.companyId` (`:20`). O terminal precisa ser da filial (`:23`). |
| `GET /api/pdv/vouchers` (`src/app/api/pdv/vouchers/route.ts:7-20`) | Código + `companyId` (`:13`). O índice único de `code` é global (`schema.ts:573`). |
| `GET /api/pdv/intents/[id]` (`src/app/api/pdv/intents/[id]/route.ts:7-18`) | `intent.companyId === ctx.companyId` (`src/domain/payments/intents.ts:121-127`) |

### 5.5 `GET /api/keepalive`

- Rota em `src/app/api/keepalive/route.ts:17-33`.
- Exige `Bearer CRON_SECRET`. Responde 503 sem o segredo em produção (`:18-20`).
- Grava em `settings` da pseudo-empresa `"platform"` com Store sem escopo (`:21-25`). Não toca dados de empresa.

### 5.6 `GET /api/setup/run` (instalação, nível plataforma)

**Acesso** (`src/app/api/setup/run/route.ts`)

- Exige `SETUP_TOKEN` pelo cabeçalho `x-setup-token` **ou** pela query `?token=` (`:19-25`).
- Opera com o Store sem escopo (`:44`).

**Etapas que funcionam mesmo depois de `finish`**

- `diagnostico` (`:46-108`), `provision` (`:110-129`) e `demo-update` (`:134-142`).

**Etapas bloqueadas depois de `finish`** (410 em `:144`)

- `demo` (`:146-152`).
- `status`: contagens da instalação inteira (`:154-162`).
- `check-login`: recebe `login` e **`password` na query** (`:164-179`).
- `owner`: cria usuário `isAdmin` com `companyIds` = até 100 empresas (`:181-197`).
- `finish` (`:199-202`).

### 5.7 `POST /api/loja/gateway/[provider]/[storeId]` (webhook)

- Rota em `src/app/api/loja/gateway/[provider]/[storeId]/route.ts:16-50`.
- **Pública.** Valida o formato de `storeId` e `provider` (`:18`).

**Como determina a empresa**

1. Lê a loja sem escopo (`:20`).
2. Usa a integração `store_gateway` de `st.companyId` (`:22`). O provedor simulado responde 404 (`:24`).
3. Confere a assinatura HMAC com o segredo da variável vinculada pela empresa da loja (`:26`; `src/domain/ecommerce/providers.ts:134-157`). Recusa é registrada (`:27`).

**Processamento**

- Para **cada** evento, lista até 5000 pedidos da loja e procura pela `providerRef` (`:39-40`).
- Aplica com `handlePaymentEvent` (`:46`), que usa `storeCtx`, um `systemCtx` da empresa da loja (`src/domain/ecommerce/common.ts:108`).
- Deduplica por `detId("cevent", externalKey)`, **global e sem empresa** (`common.ts:164`; índice único em `schema.ts:1348`).
- Não confere a situação da empresa nem da loja.

### 5.8 Rotas públicas da vitrine e do documento

**Domínio próprio** (`src/middleware.ts:11-43`)

- Host que não é do ERP é reescrito para `/loja/~<host>/...` (`:29-37`).
- No domínio da loja, `/loja/...` responde 404 (`:35`).
- O matcher exclui `api/`, `_next/`, ícones e `sw.js` (`:40-43`). As APIs respondem também pelos domínios das lojas, mas os cookies de sessão são do host do ERP.

**Resolução da loja** (`src/app/loja/[store]/_lib.ts:25-39`)

1. Por endereço (`slug`) ou por domínio **verificado e ativo** (`src/domain/ecommerce/storefront.ts:23-32`; `src/domain/ecommerce/domains.ts:170-176`).
2. Empresa inativa → `null` (`_lib.ts:31`).
3. Recurso `comercioDigital` desligado → `null` (`:33`).
4. Loja publicada abre para todos. Rascunho ou pausa abre só com o cookie de prévia, comparado em tempo constante (`storefront.ts:37-42`).

**Dados das ações públicas e do pedido**

- Tudo deriva de `st` (`src/app/loja/[store]/actions.ts:37-43`).
- O carrinho vem só de cookie httpOnly (`:46-55`).
- Pedido por token de 128 bits **e** `storeId` da loja (`src/domain/ecommerce/orders.ts:48-52`).
- Um domínio só pode estar ativo em uma loja (`domains.ts:60-70, 118-120`).

**Robots e sitemap**

- `robots.txt` e `sitemap.xml` usam `loadStore` e cache público de 1 h (`src/app/loja/[store]/robots.txt/route.ts:5-13`; `src/app/loja/[store]/sitemap.xml/route.ts:7-19`).

**Link público de documento** (`/documento/[token]`, `src/app/documento/[token]/page.tsx:17-34`)

- Token de 128 bits, lido com Store sem escopo (`src/domain/sales-documents.ts:999-1009`).
- Confere só o recurso da empresa e filial do documento (`page.tsx:24`), não a situação da empresa.

---

## 6. Backups e restauração (`src/domain/backup.ts`; telas em `src/app/(app)/administracao/backups/**`)

### 6.1 Escopo: "por empresa", com dados globais incluídos

O plano exibido na tela está em `backup.ts:115-129`. A coleta real fica em `collectRows`, `:131-163`.

| Coleção | Critério | Linhas |
|---|---|---|
| `companies` | Só a própria | `:137-139` |
| `users` | **Todos os `isAdmin` da instalação + vinculados à empresa.** Inclui `passwordHash`, `inviteTokenHash`, `resetTokenHash`, `totpSecretEnc`, `totpPendingEnc` e `totpRecoveryHashes` (`schema.ts:94-111`). | `:140-142` |
| `user_prefs` | Dos usuários incluídos: preferência de notificação e "última unidade", que pode apontar para outra empresa | `:143-145` |
| `counters` | Chave contendo o id da empresa ou, com `includeGlobal`, `"public"`. Numeradores com chave por terminal, sessão, filial ou lote (`cash:<terminal>`, `cashmov:<sessão>`, `rps:<filial>`, `cert_voucher_code:<lote>`) ficam de fora. | `:146-147` |
| `help_articles` | Da empresa + globais (com `includeGlobal`) | `:148-149` |
| `tickets`, `ticket_messages` | Da empresa + **`"public"`**: todos os chamados da tela de login da instalação (com `includeGlobal`) | `:150-152` |
| `files` | Da empresa, exceto o bucket `backups`. Com `includeFiles`, o conteúdo vai em base64 até 300 MB (`:29, 179-195`). | `:153-154` |
| Demais com `companyId` | `companyId = empresa`. Registros `"platform"` e lançamentos entre empresas da rede ficam fora. | `:155-156` |

**`includeGlobal` é sempre verdadeiro**

- Na cópia manual: `src/app/(app)/administracao/backups/actions.ts:12`.
- Na automática: `backup.ts:651`.
- O padrão da função também é verdadeiro: `backup.ts:361`.

### 6.2 Ciclo

**Cópia** (`createBackup`, `:355-378`; `executeBackup`, `:380-410`)

- Exige `admin` (ver) + `admin.backup` na cópia manual (`:311-321, 356`).
- O artefato JSON+gzip é dividido em partes de 25 MB, gravadas com `saveFile` no bucket `backups` da empresa (`:28, 384-393`).

**Agenda** (`backup.schedule`)

- Ligada por padrão: diária, 02:00, retenção de 30 dias, **com arquivos** (`src/lib/core/settings.ts:46`).
- Editável em `src/app/(app)/administracao/parametros/params.ts:154-167`.
- A rotina diária enfileira a cópia no horário do fuso único (`backup.ts:634-646`).
- Como o cron roda às 08:47 UTC, as cópias do dia de todas as empresas tendem a vencer juntas e a cair no mesmo executor (§2.3).

**Verificação** (`:413-421`)

- Restaura numa `MemoryStore` nova (`:493`) e compara contagens e checksums.
- A cópia precisa ser da empresa (`:416`).

**Restauração** (`createRestoreJob`, `:449-466`; `runRestoreJob`, `:469-549`)

- Os alvos são "base de teste em memória" ou "nova base Appwrite" (`:451-456, 482-494`). A nova base só existe com o Appwrite configurado.
- No Postgres atual, não há restauração para a base em uso nem restauração de uma empresa dentro da base compartilhada.
- A nova base Appwrite recusa destino com dados de outra empresa (`:491`).
- O pedido e a execução conferem a empresa (`:450, 471, 474`; `actions.ts:36-38`).

**Retenção e execuções abandonadas**

- Por empresa: `applyRetention` (`:567-590`) e `failStaleBackups` (`:593-604`).

**Download do artefato**

- §3.3. A listagem de cópias filtra `companyId` (`src/app/(app)/administracao/backups/queries.ts:18-21`).

---

## 7. Integrações (`src/domain/integrations.ts`, Central de integrações)

### 7.1 Modelo

**Registro**

- Um registro por empresa, ou por empresa + filial.
- O id é determinístico: `detId("integration", "<empresa>|<filial ou *>|<tipo>")` (`:268-269`).
- A filial habilitada tem precedência sobre a empresa (`findIntegration`, `:358-365`).
- As integrações da loja são sempre da empresa (`:30, 386`).
- O registro grava `companyId = ctx.companyId` (`:413-427`). Salvar exige `admin.integrations` (`:382`).

**Credenciais por referência**

O banco guarda **o nome da variável de ambiente** (`secretRefs`), nunca o valor (`:11`). A validação do nome (`:274-305`, aplicada em `:395-402`) confere:

- formato;
- lista de nomes e prefixos reservados do sistema (`:280-289`);
- prefixos do provedor.

**Não existe vínculo variável → empresa.** Duas empresas podem apontar para a mesma variável. Todas recebem o mesmo nome padrão (`defaultRefs`).

**Configuração**

- `baseUrl` é proibida (`:323, 390-393`).
- As demais chaves do provedor são copiadas sem validação de conteúdo (`:404`). As exceções são `accountantEmail` e `connectorUrl` (`:406-407`) e o layout da Domínio (`:408-412`).
- Uso efetivo: `getIntegration` descarta vínculo com nome proibido e entrega só os segredos do provedor atual (`:328-375`).
- Teste e registro: `testIntegration` (`:542-612`), `logIntegration` em `integration_logs` com `companyId` (`:448-465`), pendências e histórico filtrados por `companyId` (`:688-753`).

### 7.2 Por integração

| Integração | Escopo | Variável padrão / prefixos aceitos | Onde se usa | Webhook ou consulta |
|---|---|---|---|---|
| Pix — Mercado Pago | Empresa ou filial (`intents.ts:17-18`) | `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_`, `MP_` (`integrations.ts:59`) | `pixProviderFrom` (`src/domain/payments/providers.ts:217-230`); URL base só pela variável global `MERCADOPAGO_BASE_URL` (`:64-70`) | Consulta: `/api/pdv/intents/[id]` |
| Cartões / TEF | Empresa ou filial; terminal | Sem segredo (`integrations.ts:65-74`) | O conector roda no navegador do caixa. O estado vem das verificações registradas em `audit_logs` da empresa (`integrations.ts:514-539`). | — |
| NF-e, NFC-e e NFS-e — Focus NFe | `fiscal_configs` por empresa ou filial | `FOCUSNFE_TOKEN` / `FOCUSNFE_`, `FOCUS_`, `NFE_`, `NFCE_`, `NFSE_` (`integrations.ts:50, 79, 89, 647`). CSC: `NFCE_`, `CSC_`, `FOCUSNFE_`, `FOCUS_` (`integrations.ts:52`). | `fiscalProviderFrom` (`src/domain/fiscal/providers.ts:401-418`); `FOCUSNFE_BASE_URL` global (`:415`); XML por chave (`src/domain/receipts.ts:848-869`) | Consulta: tarefas `fiscal.query` |
| Senha do certificado A1 | Configuração fiscal | Sem prefixo de provedor, só os reservados (`src/domain/fiscal/config.ts:168-171`) | Informativo: só "definida/não definida" (`:180`) | — |
| E-mail — Resend ou Appwrite | Empresa ou filial; `sendEmail` lê o da empresa | `RESEND_API_KEY` / `RESEND_` (`integrations.ts:217`) | §4.3; remetente livre | — |
| Área da contabilidade | Empresa | Sem segredo | Pacote por e-mail e/ou entrega ao escritório vinculado (`export.ts:327-379`; `deliveries.ts:31-70`) | — |
| Domínio (Thomson Reuters) | Empresa ou filial | Sem segredo | Arquivo texto | — |
| Banco / Open Finance | — | `BANK_CLIENT_ID`/`SECRET` (`integrations.ts:100`) | Não implementado (`integrations.ts:580-584`) | — |
| Gateway da loja (Intercert) | **Empresa** | `GATEWAY_INTERCERT_API_KEY`, `GATEWAY_INTERCERT_WEBHOOK_SECRET` / `GATEWAY_INTERCERT_`, `INTERCERT_GATEWAY_` (`integrations.ts:136-139`) | Cobrança "reservada", sem chamada real (`src/domain/ecommerce/providers.ts:134-149`); assinatura dos avisos (`:151-157`) | Webhook (§5.7) |
| Banco Intercert (loja) | Empresa | `BANCO_INTERCERT_*` (`integrations.ts:155-158`) | Reservado; só simulação | — |
| Logística da loja | Empresa | `FRETES_API_TOKEN`, `ENTREGAS_API_TOKEN` (`integrations.ts:176-186`) | Reservado; só simulação | — |
| Domínio próprio da loja | Empresa | `DOMINIOS_API_TOKEN` / `DOMINIOS_` (`integrations.ts:204-205`); `projectId` e `teamId` **livres** na configuração | Chama a API da Vercel com o token vinculado no projeto e equipe informados pela empresa (`src/domain/ecommerce/providers.ts:403-439`) | — |

**Serviços públicos sem credencial**, compartilhados por todas as empresas:

- BrasilAPI CNPJ: `src/domain/customers.ts:221` e `src/domain/accounting/clients.ts:262`.
- ViaCEP: `src/domain/ecommerce/checkout.ts:89-91`, desligável com `STORE_CEP_LOOKUP=off`.

### 7.3 Variáveis de ambiente da instalação (valem para todas as empresas)

| Grupo | Variáveis |
|---|---|
| Banco | `DATABASE_URL`, `POSTGRES_URL`, `PG_POOL_MAX`, `PG_TX_ISOLATION`, `DATA_BACKEND` |
| Arquivos | `BLOB_READ_WRITE_TOKEN` (ou `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`, `files.ts:87-89`), `LOCAL_FILES_DIR`, `APPWRITE_BUCKET_ID` |
| Rotinas e instalação | `CRON_SECRET`, `SETUP_TOKEN`, `BACKGROUND_JOBS` |
| Segurança | `AUTH_ENCRYPTION_KEY` (cifra do TOTP) |
| Fuso | `APP_TIMEZONE` (fuso único; `src/lib/dates.ts:7`) |
| Endereços | `APP_URL`, `APP_HOSTS`, `VERCEL_*` (`src/middleware.ts:11-20`) |
| DNS das lojas | `STORE_DNS_CNAME`, `STORE_DNS_A` (`src/domain/ecommerce/providers.ts:334-335`) |
| Rede de certificação | `CERT_PAYMENT_URL_BASE` (`src/domain/accounting/certificates.ts:84`) |
| URLs base dos provedores | `FOCUSNFE_BASE_URL`, `MERCADOPAGO_BASE_URL` |
| Demonstração | `DEMO_PASSWORD`, `SHOW_DEMO_LOGIN` |
| Appwrite (legado) | `APPWRITE_*` |

A lista documentada está em `.env.example:1-39`.

---

## 8. Cache

### 8.1 `ReadCachedStore` (`src/lib/db/read-cache.ts`)

**Duas camadas**

- **Por requisição:** React `cache`, chamado `requestMemo` (`:18`).
- **Compartilhada entre requisições:** 15 s, só em `companies`, `branches`, `roles`, `settings` e `payment_methods` (`:15-16, 45-49`). Fica em memória da instância.

**Chaves e vazamento entre empresas**

- `get`: `<coleção>|get|<id>` (`:73`).
- `list`: `<coleção>|list|<JSON das opções>` (`:83`).
- Embrulha o Store **abaixo** do `ScopedStore` (`src/lib/db/index.ts:64`):
  - na listagem, o filtro de empresa acrescentado pelo `ScopedStore` entra no JSON da chave;
  - no `get`, a chave não tem a empresa, mas a visibilidade é aplicada depois, a cada requisição (`scoped-store.ts:56-59`).
- **Não há entrega de dados de uma empresa a outra pelo cache.**

**Invalidação e defasagem**

- Qualquer gravação limpa o cache da requisição e as entradas da coleção **na mesma instância** (`:32-36, 86-130`).
- Em outras instâncias, o valor antigo vale até 15 s. Exemplos: empresa inativada, perfil alterado, parâmetro ou recurso (`settings`).
- Dentro de transação, a leitura vai direto ao banco (`:38-41, 68-70`).

### 8.2 Outros caches e singletons

**React `cache` por requisição**

- `getSession` (`src/lib/server/session.ts:31`) e `loadStore` (`src/app/loja/[store]/_lib.ts:25`).

**`globalThis`, por instância e para a instalação inteira**

- `__intercertStore` (`src/lib/db/index.ts:30`).
- `__intercertFiles` (`src/lib/core/files.ts:206`).
- `__intercertAuth` (`src/lib/auth/provider.ts:189`).
- `__intercertJobsAt`: limitador de 30 s do executor oportunista, **comum a todas as empresas** (`src/lib/server/background-jobs.ts:11`).
- Simuladores em memória **compartilhados entre empresas**: `__simPix` (`src/domain/payments/providers.ts:209-210`) e `__simFiscal` (`src/domain/fiscal/providers.ts:405-406`).

**HTTP**

- Imagem da vitrine: público, 1 h + 1 dia de reaproveitamento (`imagem/[id]/route.ts:22`).
- `robots` e `sitemap`: público, 1 h.
- Arquivos: `private, no-store` (`files/[id]/route.ts:47`).
- Certificado: `no-store` (`certificados/[id]/route.ts:26`).

**Service worker** (`public/sw.js:1-49`)

- Guarda só os estáticos.
- Nunca intercepta `/api/` (`:29`). Páginas vão sempre à rede (`:46-48`).

---

## 9. Inventário completo das rotas

São 19 `route.ts`: 14 em `src/app/api` e 5 fora dela.

| Rota | Método | Autenticação | Como determina a empresa | Finalidade |
|---|---|---|---|---|
| `/api/jobs` | GET | `Bearer CRON_SECRET`; 503 sem segredo em produção (`jobs/route.ts:13-16`) | Nenhuma: todas (`runScheduled` + `runDueJobs`) | Executor do cron |
| `/api/keepalive` | GET | `Bearer CRON_SECRET` (`keepalive/route.ts:18-20`) | Pseudo-empresa `"platform"` | Sinal diário do banco |
| `/api/setup/run` | GET | `SETUP_TOKEN` (cabeçalho ou query) (`setup/run/route.ts:19-28`) | Instalação inteira | Provisionar, demonstração, administrador geral, diagnóstico |
| `/api/unit` | GET | Sessão, contexto incompleto aceito (`unit/route.ts:8`) | `c`/`b` validados contra as unidades acessíveis | Grava o cookie da unidade |
| `/api/search` | GET | `requireApiSession` + módulo por grupo | `ctx.companyId` explícito | Pesquisa global |
| `/api/export/[key]` | GET | `requireApiSession` + módulo + `data.export` | Sessão (Store com escopo) | CSV/XLSX das listagens |
| `/api/files/[id]` | GET | `requireApiSession` + `fileAccessDenial` | `files.companyId`; exceção: entrega ao escritório | Download |
| `/api/certificados/[id]` | POST | `requireApiSession` + senha + escritório/titular | Solicitação lida sem escopo e conferida | Certificado emitido |
| `/api/pdv/customers` | GET | `requireApiSession` + `pdv` ou `customers` | `ctx.companyId` | Cliente no PDV |
| `/api/pdv/products` | GET | `requireApiSession` + `pdv` + filial | `ctx.companyId` / filial | Produtos no PDV |
| `/api/pdv/lots` | GET | `requireApiSession` + `pdv` + filial | `sku.companyId` | Lotes FEFO |
| `/api/pdv/vouchers` | GET | `requireApiSession` + `pdv` | Código + `companyId` | Vale-crédito |
| `/api/pdv/intents/[id]` | GET | `requireApiSession` + `pdv` | `intent.companyId` | Consulta do Pix |
| `/api/loja/gateway/[provider]/[storeId]` | POST | **Pública**; assinatura HMAC | `storeId` → `stores.companyId` | Avisos do gateway |
| `/administracao/backups/[id]/download` | GET | `requireApiSession` + `admin` + `admin.backup` | `backup.companyId` | Artefato da cópia |
| `/comercio-digital/ver-loja` | GET | `requireApiSession` + ações do comércio + recurso (`ver-loja/route.ts:15-18`) | `storeOfCompany(ctx.companyId)` | Abrir a loja ou gravar o cookie de prévia |
| `/loja/[store]/imagem/[id]` | GET | **Pública** | Loja → `st.companyId` | Imagem da vitrine |
| `/loja/[store]/robots.txt` | GET | **Pública** | Loja | robots |
| `/loja/[store]/sitemap.xml` | GET | **Pública** | Loja | sitemap |

**Fora de `route.ts`, também públicas**

- Páginas `/loja/[store]/**` (§5.8) e `/documento/[token]` (§5.8).
- Manifesto PWA estático (`src/app/manifest.ts:4-30`).
- Middleware de domínio próprio (`src/middleware.ts`).

---

## 10. Server actions

### 10.1 Padrão `runAction` (`src/lib/server/action.ts:16-53`)

1. `requireSession()` (`:21`): sem sessão, redireciona para `/login`; sem contexto completo, para `/selecionar-unidade` (`session.ts:90-96`). O redirecionamento é repassado (`action.ts:35`).
2. Permissão de módulo e operação no perfil **da empresa ativa** (`:22-26`). A negação é auditada.
3. `requireBranch` opcional, que recusa o consolidado (`:27`).
4. Executa `fn(s)` com o `SessionInfo`, cujo `ctx` tem Store com escopo (`:28`).
5. `revalidatePath` dos caminhos informados (`:29`).
6. **`scheduleBackgroundJobs()`**: executa tarefas vencidas de **qualquer** empresa depois da resposta (`:31`; §2.1).
7. Converte erros: regra de negócio vira mensagem, com auditoria se `forbidden` (`:36-47`); conflito (`:48`); não encontrado (`:49`); inesperado devolve `e.message` ao cliente (`:50-51`).

Utilitários de leitura do `FormData`: `:56-82`.

### 10.2 Cobertura

- **396 funções exportadas em 49 arquivos `actions.ts` de `src/app/(app)/**`, todas embrulhadas em `runAction`.** A conferência foi automática, incluindo a forma `runAction<T>(…)`.
- Ações que recebem uma empresa como argumento validam contra `s.companies` ou `companyAdminCtx` (`src/domain/companies.ts:175-194`; `src/app/(app)/administracao/empresas/access.ts:15-32`).

### 10.3 `src/app/actions` e vitrine (fora de `runAction`)

| Arquivo | Ações | Empresa |
|---|---|---|
| `src/app/actions/session.ts` (10 exportadas) | Login, duas etapas, saída, troca e seleção de unidade, recuperação, convite | Store sem escopo. A troca de unidade valida acesso e situação (`:190-208`). O login restaura só unidade ativa (`:111-136`). Detalhes em `02-…` §1. |
| `src/app/actions/setup.ts` | `provisionAction`, `setupInstallationAction` | Só com instalação vazia + `SETUP_TOKEN` (`:11-28`). Cria a primeira empresa e o `isAdmin` (`:70-79`). |
| `src/app/actions/public.ts` | `publicTicketAction`, anônima | Grava chamado `companyId: "public"` (`:13-16`). Sem limite de frequência no código. |
| `src/app/loja/[store]/actions.ts` (12 exportadas) | Carrinho, cupom, frete, checkout e ações do pedido | Empresa = loja do endereço (`:37-43`). Chama `scheduleBackgroundJobs` (`:25`). |

---

## 11. Riscos priorizados para o multiempresa

| # | Severidade | Risco | Evidência | Direção a considerar |
|---|---|---|---|---|
| R1 | **Crítica** | A cópia de uma empresa leva usuários de fora dela (todos os `isAdmin`, com `passwordHash`, TOTP cifrado e hashes de recuperação) e os chamados públicos de toda a instalação. O artefato pode ser baixado por quem tem `admin.backup` naquela empresa. | `backup.ts:140-152, 361, 651`; `backups/actions.ts:12`; `backups/[id]/download/route.ts:11-19`; `schema.ts:94-111` | Excluir os segredos de autenticação e os dados globais da cópia por empresa; separar a cópia da plataforma |
| R2 | **Crítica** | Credenciais por nome de variável sem dono. Qualquer empresa com `admin.integrations` pode usar a variável de outra (mesmo prefixo) e emitir, cobrar ou enviar e-mail com a conta alheia. Padrões idênticos para todas. Remetente livre. Token de hospedagem da plataforma com `projectId`/`teamId` escolhidos pela empresa. | `integrations.ts:59, 79, 136-139, 204-205, 217, 299-305, 395-404`; `email.ts:18-25`; `fiscal/providers.ts:408-415`; `payments/providers.ts:222-226`; `ecommerce/providers.ts:403-439` | Cofre de credenciais por empresa (ou mapa variável → empresa) e remetente validado por domínio da empresa |
| R3 | **Alta** | Operações de plataforma (`network.manage`, `certification.operate`) cabem em qualquer perfil de qualquer empresa e dão acesso entre empresas: a fila de certificação lê todas as solicitações e opera nelas. Criar empresa exige só `admin.create` na empresa ativa, e a mensagem de CNPJ duplicado revela o nome da outra empresa. | `src/lib/permissions.ts:71-73`; `src/domain/roles.ts:84-87, 136-140, 212-226`; `network/common.ts:62-64`; `certificates.ts:406-417, 838-850`; `companies.ts:139-153` (`:144`). Ver `02-…` §2.5. | Restringir essas operações a uma empresa de plataforma ou papel fora dos perfis de empresa |
| R4 | **Alta** | Empresa inativa continua com rotinas, tarefas (fiscal, e-mail, cópia), webhook e link público. Não há situação "suspensa" para empresa contratante. | `scheduler.ts:21`; `jobs.ts:77-106`; `companies.ts:217-228`; `gateway/.../route.ts:16-50`; `documento/[token]/page.tsx:22-24` | Situação de contrato da empresa (ativa / suspensa / encerrada) conferida no executor, nas rotinas e nas rotas públicas |
| R5 | **Alta** | Executor único sem justiça por empresa. O cron percorre todas as empresas em sequência, sem prazo, dentro de 300 s. A fila é global FIFO com limite de 50/10. Tarefas de qualquer empresa rodam "de carona" em requisições de outra empresa e de visitantes anônimos da vitrine. | `scheduler.ts:20-37`; `jobs/route.ts:10, 18-19`; `jobs.ts:86`; `background-jobs.ts:13-29`; `action.ts:31`; `loja/[store]/actions.ts:25` | Fila e prazo por empresa (ou rodízio); executor fora da requisição do usuário; prazo em `runScheduled` |
| R6 | **Alta** | Brechas estruturais do `ScopedStore`: (a) `list` com qualquer filtro `companyId` desliga o escopo; (b) `update`, `delete` e `increment` não conferem a empresa do registro existente; (c) `companyId` nulo fica visível a todas; (d) `systemCtx("")` devolve o Store sem escopo com `isAdmin`. O teste cobre só get/list/create/update básicos. | `scoped-store.ts:24-31, 43-47, 70-94`; `ctx.ts:60`; `jobs.ts:35, 106`; `tests/scoped-store.test.ts:6-27` | Endurecer o Store (conferir o registro antes de gravar e excluir; recusar filtro de outra empresa) e recusar tarefa sem empresa |
| R7 | Média-alta | Pseudo-empresa `"public"`: os chamados da tela de login ficam visíveis aos atendentes de **todas** as empresas, entram nas cópias de todas, e a resposta sai pelo e-mail e anexo da empresa do atendente. | `scoped-store.ts:18, 46, 72-74`; `support.ts:72, 308-312, 198-241`; `actions/public.ts:8-18`; `backup.ts:150-152` | Atendimento de plataforma separado das empresas |
| R8 | Média | O `isAdmin` global vê e recebe tudo: todas as empresas, notificações de todas, presença nas listas de usuários e vendedores de todas, e cópia nos backups. | `auth/users.ts:86`; `notify.ts:31`; `lookups.ts:31-37`; `backup.ts:141`; `setup/run/route.ts:181-197` | Papel de operador da plataforma fora do cadastro de usuários das empresas |
| R9 | Média | Arquivos sem partição física por empresa (Blob, tabela de arquivos, bucket único). Não há cota, exportação ou expurgo por empresa, nem remoção de empresa. | `files.ts:27-29, 98, 132`; `ddl.ts:144`; ausência de `delete("companies")` | Prefixo `<empresa>/` no caminho, `companyId` na tabela de conteúdo e rotina de encerramento de contrato |
| R10 | Média | Fluxos entre empresas sem política explícita de contrato. O escritório baixa arquivo entregue mesmo depois de desfeito o vínculo e sem conferir a carteira visível. A rede lê certificados de toda a rede e avisa empresas acima. | `files/[id]/route.ts:21-33`; `deliveries.ts:31-70, 105-108`; `certificates.ts:701-717, 800-815`; `renewals.ts:101-107, 368-374`; `billing.ts:417-418` | Catálogo de fluxos entre empresas com consentimento, revogação e auditoria |
| R11 | Média | Chaves globais sem empresa: `resolveOccurrence`/`reopenOccurrence` (Store sem escopo nas rotinas), `commerce_events.externalKey` (evento repetido entre lojas seria tratado como duplicado) e `jobs.dedupeKey`. | `notify.ts:97-106`; `routines/finance.ts:48, 79, 90`; `lots.ts:216`; `ecommerce/common.ts:164`; `schema.ts:938, 953, 1348` | Incluir a empresa nas chaves e filtros |
| R12 | Média | O e-mail de recuperação de senha sai pelo canal e remetente da **primeira** empresa do usuário e fica no histórico de integração dela. | `auth/provider.ts:87`; `email.ts:35` | Canal de e-mail da plataforma para mensagens de conta |
| R13 | Baixa-média | O cache compartilhado de 15 s por instância atrasa inativação, perfil e parâmetros em outras instâncias. | `read-cache.ts:15-16, 45-49` | Excluir `companies`/`roles`/`settings` do cache compartilhado ou invalidar entre instâncias |
| R14 | Baixa | Rota de instalação: token aceito na query; `check-login` com senha na URL; `owner` cria `isAdmin` com todas as empresas; `provision`, `demo-update` e `diagnostico` seguem depois de `finish`. | `setup/run/route.ts:22, 110-142, 164-197` | Só cabeçalho e desligamento total depois de `finish` |
| R15 | Baixa | `/api/unit` troca a empresa ativa por GET, com cookie `SameSite=Lax`: um link externo troca o contexto do usuário. | `unit/route.ts:7-18` | POST com verificação de origem |
| R16 | Baixa | Fuso único para todas as empresas nas rotinas (marcador diário, agenda de cópia). | `dates.ts:7, 31`; `scheduler.ts:23`; `backup.ts:640` | Fuso por empresa |
| R17 | Baixa | Simuladores de Pix e fiscal em memória global, e serviços públicos (BrasilAPI, ViaCEP) com limite compartilhado. Webhook lista até 5000 pedidos por evento. | `payments/providers.ts:209-210`; `fiscal/providers.ts:405-406`; `customers.ts:221`; `checkout.ts:91`; `gateway/.../route.ts:39-40` | Estado do simulador por empresa e busca do pedido pela referência |
| R18 | Baixa | Cache público das imagens da vitrine (1 h + 1 dia) mantém as imagens acessíveis depois de despublicar ou inativar. | `imagem/[id]/route.ts:22` | Cache menor ou URL versionada |

---

## 12. Observações laterais (não são de multiempresa, encontradas no caminho)

1. **Downloads recusados por falta de módulo:**
   - Os arquivos `entityType: "dominio_export"` e `"inbound_cte"`, ambos no bucket `documents`, não têm módulo em `ENTITY_MODULE`.
   - Por isso, `/api/files/[id]` responde 403 até para administrador (`access.ts:4-21, 57-58`; `src/domain/accounting/dominio.ts:273`; `src/domain/freight-cte.ts:176`).
   - A tela da Domínio mostra o link de download mesmo assim (`src/app/(app)/financeiro/exportacao-dominio/forms.tsx:24`; `page.tsx:174`).
2. **Downloads comuns sem auditoria:** em `/api/files/[id]`, só a entrega ao escritório é auditada (`route.ts:31-35`).
3. **Restauração no Postgres:** é só verificação em memória. A "nova base" existe apenas para o Appwrite (`backup.ts:451-456, 482-494`).
4. **Comentário desatualizado:** o comentário de `/api/jobs` sobre acionamento pela Central não corresponde ao código (`route.ts:7`; `integrations.ts:717-734`).
