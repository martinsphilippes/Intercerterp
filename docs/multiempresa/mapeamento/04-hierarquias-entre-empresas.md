# 04 — Hierarquias entre empresas (mapeamento do estado atual)

> Mapeamento feito só com leitura do código: nenhum arquivo do sistema foi alterado.
> Base: commit `0aa96c2`, em 26/11/2026. As referências `arquivo:linha` partem da raiz do repositório.
> Login, sessão e perfis estão em `02-identidade-e-permissoes.md`. Aqui o foco é **o que atravessa empresas** nas três hierarquias do ambiente de teste.

## Sumário dos achados

1. **Nenhuma das três hierarquias usa `ctxForCompany`** (`src/lib/core/ctx.ts:51-55`). O único uso está em `src/domain/companies.ts:177`.
   - Todas atravessam empresas com `unscoped()` e checagens próprias, função a função. São cerca de 140 chamadas `unscoped(` em `src/domain/accounting` e `src/domain/network`.
2. **Escritório contábil:** o vínculo é o único relacionamento entre empresas com consentimento das duas partes (código emitido pelo escritório e aceito pela empresa).
   - A leitura é somente leitura e o vínculo é conferido a cada acesso.
   - Os consentimentos derivados não seguem o ciclo do vínculo. São eles: o acompanhamento de certificados, a autorização de download e o `linkedCompanyId` gravado no pedido de certificado.
3. **Certificação:** a "equipe Intercert" não é uma empresa nem um vínculo. É a operação `certification.operate`.
   - Qualquer administrador de empresa pode pôr essa operação num perfil. O seed da demonstração faz isso dentro do escritório.
   - Com ela, o usuário lê e opera pedidos de certificado de **todas** as empresas e edita o catálogo e os preços da plataforma.
4. **Rede:** cada nó é uma empresa. A posição na árvore basta para:
   - ler dados pessoais dos clientes dos descendentes;
   - gravar no financeiro de outras empresas (títulos, baixas, categorias);
   - tudo isso sem aceite da empresa afetada.

   Além disso, um escritório que já existe pode ser posto na rede pelo CNPJ, sem consentimento dele. `network.manage` (a "plataforma") também pode ser concedida por qualquer administrador.
5. **Suspender ou encerrar um nó** bloqueia vendas e cadastros novos, mas não a leitura nem os lançamentos financeiros. No escritório-contador, bloqueia **toda** a Tela 67, inclusive para clientes fora da rede.

---

## 0. Base comum usada pelas três hierarquias

### 0.1 Portas de acesso a dados de outra empresa

| Peça | Comportamento | Onde |
|---|---|---|
| `ScopedStore` | `get` esconde registro de outra empresa. `list` acrescenta o filtro da empresa. `create`/`update` recusam `companyId` alheio **no conteúdo gravado** | `src/lib/db/scoped-store.ts:43-86` |
| Lacunas do `ScopedStore` | `list` com filtro explícito de `companyId` (qualquer valor) não recebe o escopo (`:71`). `update` por id não confere o dono do registro existente, só o `companyId` do patch (`:83-86`). `delete` e `increment` passam direto (`:88-94`) | `src/lib/db/scoped-store.ts:71, 83-94` |
| `unscoped()` | Devolve o Store sem restrição | `src/lib/db/scoped-store.ts:108-111` |
| `ReadOnlyStore` | Recusa qualquer gravação. É usado com `scopeStore` para a leitura do escritório | `src/lib/db/read-only.ts:9-56` |
| Tabelas sem `companyId` | `companies` e `users` não são filtradas por nenhum Store restrito | `src/lib/db/schema.ts:72-83, 94-112` |
| Registros "da plataforma" | `companyId = "platform"` (rede e parâmetros da certificação). Nenhum Store restrito os vê; só `unscoped()` | `src/domain/network/common.ts:19-24`; `src/domain/accounting/certificates.ts:37, 87-91` |
| Notificações | O público é formado pelos usuários **da empresa de destino** (`companyIds`), mais os `isAdmin` | `src/lib/core/notify.ts:24-44` |
| Auditoria | `audit(ctx)` grava na empresa do contexto. Quando o registro deve ir para outra empresa, cada função monta um `unscoped().create("audit_logs", …)` à mão | `src/lib/core/audit.ts:35-38` |

### 0.2 Operações especiais que valem fora da própria empresa

- `can`/`canDo` liberam tudo para `isAdmin` (`src/lib/permissions.ts:274-282`). O `isAdmin` também vê todas as empresas (`src/lib/auth/users.ts:86`).
  - Logo, o administrador da instalação é ao mesmo tempo **plataforma da rede**, **equipe de certificação** e **administrador de todas as empresas**.
- `certification.operate` e `network.manage` existem como operações (`src/lib/permissions.ts:71-73`), mas **nenhum modelo de perfil** as recebe (`src/lib/permissions.ts:114-115, 220-223`).
- Mesmo assim, qualquer administrador de empresa pode concedê-las:
  - `normalizeActions` aceita qualquer operação da lista (`src/domain/roles.ts:84-87`);
  - `createRole` e `updateRole` exigem só `admin` (criar/editar) e `admin.users` **na empresa ativa** (`src/domain/roles.ts:161-170, 212-241, 253-276`);
  - o editor de perfis oferece todas as operações, em qualquer tipo de empresa (`src/app/(app)/administracao/usuarios/perfis/role-options.ts:7`; `src/domain/roles.ts:56-58`);
  - a server action repassa sem filtro (`src/app/(app)/administracao/usuarios/actions.ts:98-106`).
- Contextos técnicos com `isAdmin: true`:
  - `systemCtx` (`src/lib/core/ctx.ts:58-65`);
  - `SYSTEM_USER` da rede (`src/domain/network/billing.ts:32`);
  - contexto delegado do cadastro de parceiro (`src/domain/network/nodes.ts:64-69`).

---

## 1. Escritório contábil ↔ empresas clientes

### 1.1 Atores e usuários de teste

| Lado | Empresa (tipo) | Usuários de teste | Perfil |
|---|---|---|---|
| Escritório | "Contábil Horizonte (DEMO)" (`accounting`) | `contador` | `firm_admin` |
| Escritório | (mesma) | `analista` | `firm_analyst` (carteira restrita) |
| Empresa cliente | "Loja Demonstração Intercert" (`retail`) | `admin` | `admin` do varejo (aceita o vínculo e autoriza certificados) |

Fontes: `src/domain/seed/modules/accounting.ts:26-40`; `src/domain/seed/base.ts:64-78, 119-142`.

### 1.2 Modelo de dados: quem é dono de cada registro

O cliente contábil **não é** a empresa do ERP. É um cadastro do escritório que pode apontar para ela (`src/domain/accounting/common.ts:5-15`).

| Coleção | Dono (`companyId`) | Aponta para outra empresa | Onde |
|---|---|---|---|
| `accounting_clients` | escritório | `linkedCompanyId` (empresa do ERP). Também guarda `linkStatus` (none/pending/active/revoked), `linkCodeHash`, `linkCodeExpiresAt`, `linkedAt`, `linkedBy` e `linkRequestedBy` | `src/lib/db/schema.ts:999-1012` |
| `accounting_client_people`, `_establishments`, `_regimes`, `_groups`, `departments`, `department_members`, `accounting_client_assignments` | escritório | não | `src/lib/db/schema.ts:1014-1060` |
| `accounting_deliveries` | escritório | `sourceCompanyId` e `fileId` (arquivo que pertence à empresa cliente) | `src/lib/db/schema.ts:1062-1069`; `src/domain/accounting/deliveries.ts:48-51` |
| `integrations` (kind `accounting`) | **empresa cliente** | `config.linkedFirmCompanyId`, `linkedClientId`, `linkedFirmName`, `linkedAt` e `certificatesTracking`(+`At`) | `src/domain/accounting/link.ts:84-87`; `src/domain/accounting/certificates.ts:163` |
| `files` (kind `accounting_package`) | empresa cliente | não | `src/domain/fiscal/export.ts:313` |
| `certificate_requests`, `accounting_certificates` | escritório | `linkedCompanyId` (ver seção 2) | `src/lib/db/schema.ts:1071-1099` |
| `audit_logs`, `notifications` | as duas | gravadas de um lado para o outro | ver inventário (seção 4.1) |

Regras de unicidade:

- Uma empresa só tem **um vínculo ativo** (`src/domain/accounting/link.ts:76-77`).
- Vários escritórios podem ter o mesmo CNPJ na carteira, porque o índice único é por escritório (`src/lib/db/schema.ts:1011`).

### 1.3 Ciclo do vínculo

| Etapa | Quem | Exige | O que grava | Onde |
|---|---|---|---|---|
| Emitir o código | escritório | `accounting.link` + `accounting`/editar (action) + empresa do tipo escritório | No cliente do escritório: `linkStatus=pending` e o hash do código (10 caracteres, válido por 30 dias). Só aceita PJ, cliente não encerrado e ainda não vinculado | `src/domain/accounting/link.ts:36-48`; `src/app/(app)/contabil/actions.ts:190-195` |
| Cancelar o código | escritório | `accounting.link` | Volta o cliente para `none` | `src/domain/accounting/link.ts:51-58` |
| Aceitar | empresa cliente | `admin.integrations` + `admin`/editar (action). A empresa não pode ser um escritório | Busca o cliente pelo hash, sem escopo (`:70-72`). Confere pendência e validade (`:73-74`), o CNPJ **só quando os dois existem** (`:75`) e se não há outro vínculo (`:76-77`). Grava o cliente **do escritório** (`:80`) e a integração da empresa (`:83-87`). Audita nos dois lados (`:88`, `:90`) | `src/domain/accounting/link.ts:64-92`; `src/app/(app)/contabil/actions.ts:212-217` |
| Desfazer pelo escritório | escritório | `accounting.link` | Cliente fica `revoked` e quatro chaves saem da integração **da empresa** (`:109-117`). Audita nos dois lados | `src/domain/accounting/link.ts:95-121`; `src/app/(app)/contabil/actions.ts:204-209` |
| Desfazer pela empresa | empresa cliente | `admin.integrations` | Mesmo efeito, partindo da empresa (`:103-107`) | `src/domain/accounting/link.ts:95-121`; `src/app/(app)/contabil/actions.ts:219-224` |

Na revogação, as entregas já recebidas são **mantidas** por decisão documentada (`src/domain/accounting/link.ts:20`; `docs/regras-assumidas.md:340, 342`).

### 1.4 O que atravessa a fronteira

**O escritório lê na empresa cliente** (só com vínculo ativo, por Store somente leitura restrito a ela):

- `linkedSnapshot` (`src/domain/accounting/link.ts:153-193`) lê:
  - o cadastro da empresa e as filiais;
  - até 20.000 `fiscal_documents` dos últimos meses;
  - `fiscal_obligations`;
  - `fiscal_configs`, de onde tira a **validade do certificado A1** (`:189`);
  - a lista dos arquivos `accounting_package`.

  É usado na aba Fiscal do cliente (`src/app/(app)/contabil/clientes/[id]/queries.ts:60-66`) e no painel da carteira (`src/app/(app)/contabil/queries.ts:82-102`).
- `linkedCompanyRef` lê o nome e o CNPJ da empresa (`src/app/(app)/contabil/clientes/[id]/queries.ts:29-38`).
- Certificados de emissão (`fiscal_configs` e `branches`), quando a empresa autorizou o acompanhamento (`src/domain/accounting/certificates.ts:800-816`).
- O conteúdo dos arquivos **entregues**, pela rota de arquivos (`src/app/api/files/[id]/route.ts:21-32`).

**O escritório grava na empresa cliente:**

- a integração, ao desfazer o vínculo (`src/domain/accounting/link.ts:109-117`);
- notificações e auditoria ao pedir autorização de acompanhamento ou de download (`src/domain/accounting/certificates.ts:206-219, 677-681`).

O escritório **nunca grava dados fiscais nem financeiros** da empresa, porque a leitura passa pelo `ReadOnlyStore`.

**A empresa cliente grava no escritório:**

- o cliente contábil, no aceite e na revogação (`src/domain/accounting/link.ts:80, 107`);
- a entrega, a notificação e a auditoria do pacote (`src/domain/accounting/deliveries.ts:48-68`);
- auditoria e notificação ao autorizar ou retirar o acompanhamento (`src/domain/accounting/certificates.ts:170-183`);
- a autorização de download **dentro do pedido do escritório** (`src/domain/accounting/certificates.ts:646-649`).

**O que não atravessa:**

- pessoas, estabelecimentos, regimes, grupos e equipe (`src/domain/accounting/people.ts:46-165`; `src/domain/accounting/team.ts:68-200`);
- a exportação Domínio, que é feita pela própria empresa e fica nela (`src/domain/accounting/dominio.ts:261-279, 288-304`).

### 1.5 Permissões exigidas

| Ação | Exigência | Onde |
|---|---|---|
| Telas `/contabil` | Módulo `accounting` + empresa ativa do tipo `accounting` | `src/app/(app)/contabil/guard.ts:11-15` |
| Ver cliente ou entrega | `accounting`/ver + carteira visível, salvo com `accounting.all_clients` ou `isAdmin` | `src/domain/accounting/clients.ts:133-140`; `src/domain/accounting/team.ts:21-36` |
| Vincular ou desvincular | `accounting.link` (`firm_admin`, `firm_manager`) | `src/lib/permissions.ts:187, 195` |
| Certificados da carteira | `accounting.certificates` | idem |
| Equipe e responsáveis | `accounting.manage_team` | `src/domain/accounting/team.ts:69, 100, 135, 159` |
| Lado da empresa: aceitar, desfazer, acompanhamento e autorizar download | `admin.integrations` (+ `admin`/editar) | `src/domain/accounting/link.ts:65, 102`; `src/domain/accounting/certificates.ts:153-154, 639-640` |
| Lado da empresa: gerar o pacote, que **entrega automaticamente** ao escritório | `fiscal`/ver + `data.export`. Enviar por e-mail exige `fiscal.configure` | `src/app/(app)/fiscal/actions.ts:369-382`; `src/domain/fiscal/export.ts:316-322` |

O `analista` não tem operações especiais (`src/lib/permissions.ts:198-205`). Mesmo assim, lê o snapshot fiscal dos clientes **da própria carteira**, porque basta `getClient`.

### 1.6 Telas e rotinas

- **Telas do escritório:**
  - `src/app/(app)/contabil/**`: carteira, cliente 360°, entregas, equipe, grupos e certificados;
  - cartão do vínculo: `src/app/(app)/contabil/clientes/[id]/link-card.tsx`.
- **Lado da empresa:**
  - `src/app/(app)/administracao/integracoes/accounting-link.tsx:21-34`;
  - `src/app/(app)/administracao/integracoes/accounting-certificates.tsx:22-35`.
- **Rotinas:**
  - `accounting.certificates` (`src/domain/routines/accounting.ts:9` → `src/domain/accounting/certificates.ts:872-903`) roda com `systemCtx` (`isAdmin`). Lê `fiscal_configs` das empresas vinculadas quando o acompanhamento está autorizado.
  - `fiscal.accountingExport` (`src/domain/routines/fiscal.ts:49-52`) gera o pacote e, com isso, entrega ao escritório.

### 1.7 Inconsistências observadas

1. **A autorização de acompanhamento de certificados sobrevive ao vínculo.**
   - `certificatesTracking` fica na integração da empresa.
   - A revogação remove só quatro chaves (`src/domain/accounting/link.ts:111-115`).
   - O aceite seguinte mescla a configuração antiga (`:85`).
   - Resultado: um **novo** escritório vinculado herda a autorização sem novo consentimento.
2. **A mesma autorização some quando a empresa salva o formulário da integração.**
   - A configuração é refeita só com `accountantEmail`/`accountantName` (`src/domain/integrations.ts:108, 403-404`).
   - Só as quatro chaves do vínculo são preservadas (`src/domain/integrations.ts:429-432`).
3. **A validade do certificado A1 da empresa aparece ao escritório pelo snapshot fiscal** sem a autorização de acompanhamento (`src/domain/accounting/link.ts:163, 189`; `src/app/(app)/contabil/queries.ts:91`). A lista de certificados, ao contrário, exige essa autorização (`src/domain/accounting/certificates.ts:805`).
4. **A rota de download de entregas** (`src/app/api/files/[id]/route.ts:24`):
   - não confere a carteira do usuário (a lista confere: `src/domain/accounting/deliveries.ts:85-86`);
   - não confere se o vínculo ainda está ativo.
5. **O aceite com empresa ou cliente sem CNPJ** dispensa a conferência de CNPJ (`src/domain/accounting/link.ts:75`).
6. **A situação das empresas não é conferida:** a leitura e a entrega não olham `companies.status` da empresa vinculada nem do escritório (`src/domain/accounting/link.ts:136-140`; `src/domain/accounting/deliveries.ts:31-40`).

---

## 2. Certificação digital (equipe Intercert)

### 2.1 Atores

| Ator | Como é identificado hoje | Onde |
|---|---|---|
| Escritório (lado dono, Tela 67) | Empresa `accounting` + `accounting.certificates` | `src/domain/accounting/certificates.ts:258-262` |
| Parceiro da rede (lado dono, venda) | Empresa-nó + `network.sell`. Pedidos de outros vendedores do nó exigem também `network.sales_all` | `src/domain/accounting/certificates.ts:261` |
| Equipe Intercert | **Qualquer** usuário com `certification.operate` no perfil da empresa ativa, ou `isAdmin`. Não há empresa nem vínculo da equipe | `src/domain/accounting/certificates.ts:406-417` |
| Titular com ERP | A empresa cujo id está em `certificate_requests.linkedCompanyId`: `admin.integrations` para autorizar e `fiscal.configure` para baixar | `src/domain/accounting/certificates.ts:638-651, 705` |
| Titular sem ERP | Nenhum acesso. O dono registra a autorização em nome dele | `src/domain/accounting/certificates.ts:654-669` |

Na demonstração:

- `certificacao` é usuária **do escritório** Contábil Horizonte, com um perfil próprio criado pelo `contador` (`src/domain/seed/modules/certificates.ts:39-45`).
- `rede` também tem `certification.operate` (`src/domain/seed/modules/network.ts:111-114`) e é quem opera as vendas da rede no seed (`:232`).

### 2.2 Modelo de dados

| Registro | Dono | Observação | Onde |
|---|---|---|---|
| `certificate_requests` | Escritório ou parceiro que vendeu | `clientId` (`accounting_clients` ou `cert_customers`). `linkedCompanyId` é um **retrato** gravado na criação. Também guarda canal, vendedor, cascata, pagamento, validação, emissão, autorização e downloads | `src/lib/db/schema.ts:1071-1089`; `src/domain/accounting/certificates.ts:313-322` |
| `accounting_certificates` | Escritório ou parceiro | Criado pela equipe na emissão (`:598-602`) ou pelo escritório (certificado informado, `:776-779`) | `src/lib/db/schema.ts:1091-1099` |
| Arquivo `.pfx` emitido | Empresa dona do pedido | A equipe grava com um contexto da empresa dona (`:596-597`) | `src/domain/accounting/certificates.ts:596-597` |
| Parâmetros `certification` | Plataforma (`companyId="platform"`) | Catálogo, preço, custo AC, instruções e link de pagamento. Valem para todas as empresas | `src/domain/accounting/certificates.ts:87-91, 132` |
| Histórico do protocolo | Empresa dona | Ações de quem é de outra empresa (equipe ou titular) são gravadas **só** na empresa dona | `src/domain/accounting/certificates.ts:377-388` |

### 2.3 Ciclo do protocolo e quem age

| Etapa | Ator | Função | Onde |
|---|---|---|---|
| Abrir | Dono | `createCertificateRequest` (escritório): exige acompanhamento autorizado se o cliente é vinculado (`:292`) e usa o preço da rede se o escritório é nó (`:300-304`). `createNetworkSale` (parceiro) | `src/domain/accounting/certificates.ts:286-335`; `src/domain/network/sales.ts:344-463` |
| Cobrar | Dono | `sendCertificateCharge`. O e-mail sai pelo canal **da empresa dona** (`:471`) | `src/domain/accounting/certificates.ts:448-489` |
| Confirmar o pagamento | Equipe | `confirmCertificatePayment`, com referência manual | `src/domain/accounting/certificates.ts:491-514` |
| Validar o titular | Equipe | agendar, aprovar e recusar | `src/domain/accounting/certificates.ts:519-550` |
| Pedir a emissão | Dono ou equipe | `requestCertificateEmission` | `src/domain/accounting/certificates.ts:555-563` |
| Emitir ou registrar falha | Equipe | Grava o arquivo e `accounting_certificates` na empresa dona. Na venda da rede, atualiza `cert_customers` do parceiro (`:603-606` → `src/domain/network/sales.ts:468-478`). Notifica o dono e a empresa vinculada (`:612-619`) | `src/domain/accounting/certificates.ts:575-632` |
| Autorizar o download | Titular com ERP, ou o dono em nome do titular sem ERP | `authorizeCertificateDownloadByCompany` / `recordCertificateAuthorization` | `src/domain/accounting/certificates.ts:638-669` |
| Baixar | Dono (com autorização) ou titular com ERP | `downloadIssuedCertificate`, com confirmação de senha | `src/domain/accounting/certificates.ts:701-717` |
| Cancelar antes do pagamento | Dono ou equipe | `cancelCertificateRequest` | `src/domain/accounting/certificates.ts:719-739` |
| Estornar após o pagamento | Plataforma ou equipe | `reverseNetworkSale` | `src/domain/network/ledger.ts:341-370` |

Telas da equipe:

- fila: `src/app/(app)/administracao/certificacao/page.tsx:52-63`, com `admin`/ver + `certification.operate`;
- protocolo: `src/app/(app)/administracao/certificacao/[id]/page.tsx:86-101`, que lê o cliente do escritório e os usuários com escopo da empresa dona.

Server actions da equipe: `src/app/(app)/contabil/certificados/actions.ts:102-163` (módulo `admin`/ver; a operação é conferida no domínio).

### 2.4 Pagamentos

- **Não há gateway.** A cobrança leva instruções e um link montado a partir de `paymentUrlBase` (`src/domain/accounting/certificates.ts:427-438`). A equipe confirma com a referência da transação. Pendência externa nº 11 (`docs/pendencias-externas.md:17`).
- **Pedido do escritório fora da rede:** nenhum título financeiro é criado. O valor fica só no pedido (`src/domain/accounting/certificates.ts:329`).
- **Pedido da rede (inclusive do escritório-contador):**
  - na abertura, cria um título a receber na empresa que cobra (`src/domain/network/ledger.ts:149-173`);
  - na confirmação, faz os lançamentos de todas as camadas (`src/domain/network/ledger.ts:178-199`, chamado em `src/domain/accounting/certificates.ts:507-511`). Detalhe na seção 3.5.

### 2.5 `/api/certificados/[id]` e arquivos

- `POST /api/certificados/[id]` (`src/app/api/certificados/[id]/route.ts:11-35`) faz, nesta ordem:
  1. `requireApiSession`;
  2. lê a senha do corpo;
  3. chama `downloadIssuedCertificate`.
- `downloadIssuedCertificate` (`src/domain/accounting/certificates.ts:701-717`):
  - Pelo escritório: `isOwnerActor`, carteira visível e `downloadAuthorized` (`:704-709`).
  - Pelo titular: `r.linkedCompanyId === empresa ativa` e `fiscal.configure` (`:705`).
  - Nos dois casos, confirma a senha pelo provedor (`:685-695`) e lê o `.pfx` **na empresa dona** (`:711-712`).
  - Conta o download e registra na empresa dona; o titular também registra na empresa dele (`:713-715`).
- A evidência de autorização é um arquivo do escritório. Só a baixa quem está nessa empresa com `accounting`/ver (`src/app/(app)/administracao/certificacao/[id]/page.tsx:114-116`).

### 2.6 Inconsistências observadas

1. **`certification.operate` não pertence a nenhuma empresa** (seção 0.2). Quem a tem, em qualquer empresa:
   - lê todos os pedidos de todas as empresas, com nome, CPF/CNPJ, contatos e valores (`src/domain/accounting/certificates.ts:838-862`);
   - confirma pagamentos, o que gera lançamentos financeiros em várias empresas;
   - grava arquivos e certificados em outras empresas;
   - cancela pedidos e estorna vendas;
   - **edita o catálogo e os preços da plataforma** (`src/domain/accounting/certificates.ts:95`).
2. **As notificações da equipe vão para a empresa dona do pedido** (`src/domain/accounting/certificates.ts:398-403`; `src/domain/network/sales.ts:457-460`).
   - Como o público é formado pelos usuários daquela empresa (`src/lib/core/notify.ts:31`), só são avisados os membros da empresa dona ou os `isAdmin`.
   - Na demonstração, a `certificacao` só é avisada dos pedidos do escritório dela.
3. **A trilha das ações da equipe fica só na empresa dona** (`src/domain/accounting/certificates.ts:383-387`). Nada é registrado na empresa de quem agiu.
4. **O `linkedCompanyId` do pedido é um retrato que a revogação não atualiza.** Depois de desfeito o vínculo:
   - a ex-empresa continua vendo os pedidos (`src/domain/accounting/certificates.ts:865-867`);
   - pode autorizar o download (`:638-651`) e baixar como titular (`:705`);
   - o escritório continua notificando a ex-empresa (`:613-619, 677-681`);
   - se já tinha autorização, o escritório continua baixando o `.pfx` (`:709`).
5. **A autorização de download vale por pedido e não tem revogação.** Não existe função para retirá-la, e ela não acompanha a retirada do acompanhamento nem a do vínculo.

---

## 3. Rede de revendas/certificação

### 3.1 Estrutura

Os níveis são `plataforma → master → regional → revenda → contador`, com chaves fixas e rótulos configuráveis (`src/domain/network/common.ts:26-29`).

- **Cada nó é uma empresa.**
  - `cert_network_nodes.nodeCompanyId` tem índice único (`src/lib/db/schema.ts:1110`).
  - Master, Regional e Revenda são do tipo `certification`. O Contador é um escritório `accounting` (`src/domain/network/common.ts:42`).
- O filho fica estritamente abaixo do pai e pode pular níveis. O contador é sempre folha (`src/domain/network/common.ts:48-54`).
- **"Plataforma" não é um nó.** É quem tem `network.manage` (`src/domain/network/common.ts:62-64`).
  - Para os lançamentos financeiros existe uma **empresa da plataforma** configurável, `platformCompanyId`, que não pode ser nó (`src/domain/network/common.ts:73, 93, 116-133`).
- **O vendedor não é um nó.** É um usuário da Revenda com o perfil `partner_seller` (`src/lib/permissions.ts:241-248`).
- Perfis do parceiro (`src/lib/permissions.ts:224-257`):
  - `partner_admin`: rede abaixo, preços, financeiro e usuários;
  - `partner_manager`: rede abaixo, preços, vendas, vouchers, cupons e renovações; financeiro só em consulta (sem `network.billing` nem `admin.users`);
  - `partner_seller`;
  - `partner_finance`.

### 3.2 Onde ficam os registros

| Na plataforma (`companyId="platform"`, só com `unscoped`) | Na empresa do nó |
|---|---|
| Nós (`cert_network_nodes`); regras de preço (`cert_price_rules`); retrato completo da cascata (`cert_sale_cascades`) | `cert_customers` (clientes do parceiro) |
| Plano de cada venda (`cert_sale_finance`); lançamentos (`cert_fin_entries`); fechamentos (`cert_closings`) | `certificate_requests` e `accounting_certificates` (vendas e certificados) |
| Modalidades (`cert_billing_agreements`); carteiras, extrato e recargas (`cert_wallets`, `cert_wallet_moves`, `cert_wallet_recharges`) | `titles`, `installments` e `settlements`: títulos e baixas gerados pela rede, **muitas vezes por usuário de outra empresa** |
| Vouchers (`cert_voucher_*`); cupons (`cert_coupon*`); BirdID gratuito (`cert_free_claims`) | `fin_categories` da certificação, criadas sob demanda (`src/domain/network/billing.ts:60-80`) |
| Parâmetros da rede (`settings` "network") | `cert_renewal_contacts` (contatos de renovação) |

Fonte: `src/lib/db/schema.ts:1101-1265`.

### 3.3 Quem vê o quê

A regra base é `computeVisible`: o próprio nó e os descendentes pelo caminho materializado. A plataforma vê tudo. Do pai só aparece o nome (`src/domain/network/common.ts:163-169, 180-184`). A situação do nó (ativo/suspenso/encerrado) **não** entra nessa regra.

| Dado | Vendedor (`partner_seller`) | Admin/gestor do nó (`sales_all`) | Nós acima | Plataforma | Onde |
|---|---|---|---|---|---|
| Nós, dados da empresa (razão social, CNPJ), histórico | o próprio nó (*) | o próprio nó | todos os descendentes (*) | todos | `src/domain/network/nodes.ts:50-55, 256-260`; `src/app/(app)/rede/[id]/page.tsx:37-38, 88` |
| Usuários (nome, e-mail, situação) | o próprio nó (*) | o próprio nó | descendentes (*) | todos | `src/domain/network/nodes.ts:249-253`; `src/app/(app)/rede/[id]/page.tsx:236-256` |
| Clientes de certificado (`cert_customers`) | os que cadastrou ou atendeu | todos do nó | **não** (só a própria empresa) | só o da empresa ativa | `src/domain/network/sales.ts:72-97` |
| Vendas: titular, CPF/CNPJ, e-mail, telefone, valor | as próprias | todas do nó | vendas dos descendentes com `sales_all`, **inclusive as da Tela 67 do escritório-contador** | todas | `src/domain/network/sales.ts:620-675`; `src/app/(app)/rede/vendas/[id]/page.tsx:131-134`; `src/domain/accounting/certificates.ts:321` |
| Histórico (auditoria) da venda | das próprias vendas | das vendas do nó | dos descendentes, lido na empresa vendedora | idem | `src/app/(app)/rede/vendas/[id]/page.tsx:44, 125` |
| Cascata (custos e margens) | visão do vendedor | o próprio custo, o nome do pai e as camadas abaixo | idem, a partir do próprio nível | tudo, inclusive o custo AC | `src/domain/network/cascade.ts:124-149` |
| Renovações | as próprias | do nó | descendentes, **com toda a carteira de certificados do escritório-contador** | todas | `src/domain/network/renewals.ts:96-148, 186-196` |
| Financeiro (modalidade, carteira, fechamentos, resultado) | — | com `finance_view`/`billing`: a própria relação, a dos filhos e o resultado da subárvore | descendentes | tudo | `src/domain/network/results.ts:99-302`; `src/domain/network/billing-plan.ts:330-348` |
| Duplicidade de certificado | **qualquer empresa** da instalação, pelo CPF/CNPJ (só produto e validade) | idem | idem | idem | `src/domain/network/sales.ts:173-195` |

(*) A página do nó (`/rede/[id]`) não exige operação especial. Basta o módulo `dashboard` e o recurso ligado (`src/app/(app)/rede/shared.tsx:14-18`), e as abas "Usuários" e "Histórico" aparecem sempre (`src/app/(app)/rede/[id]/page.tsx:30, 55-60`). Assim, qualquer usuário de uma empresa-nó, inclusive um vendedor, vê esses dados do próprio nó e dos descendentes.

### 3.4 Preço em cascata e retrato

- **Quem define a regra do filho:** o pai (`network.prices`, nó ativo) ou a plataforma (`src/domain/network/prices.ts:233-240`).
  - O nó sem regra própria herda a tabela padrão do pai para o nível dele (`src/domain/network/prices.ts:59-65`).
  - Invariantes: custo do filho ≥ custo do pai e custo ≤ mínimo ≤ padrão (`src/domain/network/prices.ts:71-86`).
- **Na venda**, grava-se um retrato imutável (`src/domain/network/sales.ts:320-333, 416`):
  - a visão do vendedor vai para a própria solicitação;
  - o retrato completo vai para a plataforma.

  O financeiro usa o plano montado na venda, mesmo que a árvore mude depois.
- **O escritório-contador vende pela Tela 67 com o preço da rede** (`src/domain/network/sales.ts:506-548`). Esse preço é definido pela Revenda acima.

### 3.5 Dinheiro em camadas

A modalidade de cada relação pai→filho é definida **pelo pai** (`network.billing`) ou pela plataforma (`src/domain/network/billing.ts:131-136, 150-187`). Sem registro, vale pós-pago mensal (`src/domain/network/billing-plan.ts:56-59`). O plano é calculado por `planSale` (`src/domain/network/billing-plan.ts:207-303`).

| Modalidade | Como liquida | Títulos e saldos em quais empresas | Quem dispara | Onde |
|---|---|---|---|---|
| Cliente final | Título a receber na empresa **que cobra**: o vendedor; o primeiro ancestral não comissionado, quando a relação é comissionada; ou a empresa da plataforma | Na empresa que cobra, criado com o usuário do **vendedor**. A baixa é feita na confirmação do pagamento, pela **equipe** | vendedor; equipe | `src/domain/network/ledger.ts:149-173, 225-228, 268-280`; `src/domain/network/billing-plan.ts:256-267` |
| Pré-pago | Na venda, reserva o custo na carteira de **cada** relação pré-paga do caminho. No pagamento, debita. No cancelamento, libera | Carteira (registro da plataforma). A recarga cria um título a receber no pai e **um a pagar no filho** | vendedor (reserva); equipe (débito); pai ou plataforma (recarga, ajuste, confirmação) | `src/domain/network/ledger.ts:62-92, 230-251`; `src/domain/network/billing.ts:231-397` |
| Pós-pago | Lançamento acumulado até o fechamento do período | Fechamento: título a pagar no pagador e a receber no recebedor | rotina `network.billing` (por empresa pagadora, `SYSTEM_USER`), ou o pai/plataforma manualmente | `src/domain/network/ledger.ts:520-612, 628-669`; `src/domain/network/results.ts:291-302` |
| Comissionado | A empresa que cobra sobe na árvore; cada nível comissionado recebe a comissão (margem ou %) | Por período, igual ao pós-pago. Por **split**: títulos a pagar e a receber **já baixados** nas duas pontas, "a conciliar" (Safe2Pay ainda não integrado) | equipe (confirmação) | `src/domain/network/billing-plan.ts:266-280`; `src/domain/network/ledger.ts:257-299` |
| Custo AC | A plataforma acumula o valor devido à AC de 1º nível | Fechamento mensal: título a pagar na empresa da plataforma | rotina | `src/domain/network/billing-plan.ts:288`; `src/domain/network/ledger.ts:566-568` |
| Indicação | Um contador indicado recebe do vendedor (% ou valor fixo) | Acumulado ou split. **O escritório passa a ter títulos a receber** | vendedor (indica); rotina | `src/domain/network/billing-plan.ts:290-301`; `src/domain/network/sales.ts:376-383` |
| Voucher | Pacote comprado antecipadamente | A receber na empresa que vende o pacote e a pagar na que compra. Na **atribuição** por quem vende, o a pagar é criado no filho sem aceite dele | comprador; dono do pacote; plataforma | `src/domain/network/vouchers.ts:162-195, 206-283` |
| Estorno | Inverso de todos os lançamentos | Estorna baixas e cancela títulos em todas as empresas; recredita carteiras | plataforma ou equipe | `src/domain/network/ledger.ts:341-439` |

Exemplos da demonstração (`src/domain/seed/modules/network.ts:187-203`):

| Relação | Modalidade |
|---|---|
| Intercert → Master | pós-pago |
| Master → Regionais | pós-pago |
| Ceará → Juazeiro | pré-pago, com recarga de R$ 1.000 e indicação de 10% |
| Ceará → Fortaleza | pós-pago quinzenal |
| Bahia → Salvador | comissionado por split |

Nas vendas de Salvador, quem cobra o cliente é a **Regional Bahia** (`src/domain/network/billing-plan.ts:266`).

### 3.6 Suspensão, encerramento e mudança de lugar

| Efeito | Comportamento | Onde |
|---|---|---|
| Bloqueado com o nó não ativo | Vender (`src/domain/network/sales.ts:51`), cadastrar filhos (`src/domain/network/nodes.ts:60, 83`), definir preços dos filhos (`src/domain/network/prices.ts:239`), faturar filhos (`src/domain/network/billing.ts:135`), recarga (`:271`), cupom (`src/domain/network/coupons.ts:58`), pacote (`src/domain/network/vouchers.ts:72, 223`) e receber indicação (`src/domain/network/sales.ts:381`) | idem |
| **Escritório-contador** | Com o nó suspenso **ou encerrado**, toda nova solicitação da Tela 67 é recusada, inclusive para clientes fora da rede (`src/domain/network/sales.ts:507-509`). O encerramento é definitivo (`src/domain/network/nodes.ts:214`) | idem |
| **Não** bloqueado | Leitura da subárvore (`src/domain/network/common.ts:163-169`). Cascata e plano das vendas, que incluem o nó suspenso e o creditam (`src/domain/network/prices.ts:155-169`; `src/domain/network/ledger.ts:47-57`). Lançamentos do pagamento (`:178-199`). Fechamentos pela rotina (`:628-651`). Avisos "ninguém agiu" (`src/domain/network/renewals.ts:368-375`) | idem |
| Filhos do suspenso | Continuam ativos e aparecem sinalizados (`src/domain/network/nodes.ts:202-205, 233-239`) | idem |
| Mover (só a plataforma) | Recalcula os caminhos e encerra as exceções de preço do pai anterior (`src/domain/network/nodes.ts:163-200`). **Não** migra a carteira nem a modalidade, que são identificadas por filho × pai (`src/domain/network/billing.ts:110-117, 191`). As vendas abertas seguem o retrato antigo | idem |

### 3.7 Telas e rotinas

- **Telas** (`src/app/(app)/rede/**`):
  - a guarda da página exige só `dashboard` + o recurso `redeCertificacao` (`src/app/(app)/rede/shared.tsx:14-18`); as regras ficam no domínio;
  - as páginas da plataforma redirecionam quem não é plataforma (`src/app/(app)/rede/parametros/page.tsx:15-17`; `src/app/(app)/rede/precos/page.tsx:20`);
  - as ações conferem o recurso (`src/app/(app)/rede/financeiro/actions.ts:15-17`).
- **Cartão do contador:** `src/app/(app)/contabil/network-card.tsx:13-21`.
- **Rotinas por empresa-nó:**
  - `network.renewals` (`src/domain/routines/network.ts:10`);
  - `network.billing` (`src/domain/routines/network.ts:17-20`);
  - ambas executadas por `runScheduled` sobre o Store sem escopo (`src/domain/scheduler.ts:20-38`).

### 3.8 Inconsistências observadas

1. **Um escritório entra na rede sem consentimento.** O pai (`network.children`) ou a plataforma o vincula como contador só pelo CNPJ (`src/domain/network/nodes.ts:91-98`). A partir daí o escritório:
   - passa a ter preço ditado pelo pai (`src/domain/network/sales.ts:506-521`);
   - pode ficar com a Tela 67 bloqueada (`:509`) ou presa ao saldo pré-pago (`src/domain/network/ledger.ts:62-78`);
   - pode receber contas a pagar lançadas pelo pai (`src/domain/network/billing.ts:309-312`);
   - expõe aos ancestrais os usuários, as vendas e a carteira de certificados (seção 3.3).
2. **Gravação no financeiro de outras empresas sem permissão da empresa afetada.** `companyCtx` usa o **usuário de quem agiu** (vendedor, equipe ou pai), com Store restrito à empresa alvo (`src/domain/network/billing.ts:25-29`). `createTitle` não confere permissão (`src/domain/finance.ts:99-108`).
3. **`network.manage` é concedível por qualquer administrador** (seção 0.2). Com ela:
   - vê e gere toda a rede;
   - estorna vendas;
   - define qual empresa recebe pela plataforma (`src/domain/network/common.ts:116-133`).
4. **Parceiros criam empresas novas na instalação** (`src/domain/network/nodes.ts:100-131`), com contexto delegado `isAdmin` (`:64-69`).
5. **`renewalWorld` carrega os dados de todas as empresas-nó e filtra em memória:** certificados, clientes dos escritórios e todos os usuários (`src/domain/network/renewals.ts:96-115, 284-289`).

---

## 4. Inventário das operações que leem ou gravam dados de outra empresa

Legenda:

- **L** = lê; **G** = grava.
- "Vínculo" = o que autoriza hoje.
- "Servidor" = se o vínculo é conferido no servidor no momento da operação.

### 4.1 Escritório contábil (C)

| # | Operação (arquivo:linha) | L/G em outra empresa | Quem dispara | Vínculo | Servidor | Risco se o vínculo for removido/suspenso |
|---|---|---|---|---|---|---|
| C-01 | `acceptAccountingLink` — `src/domain/accounting/link.ts:64-92` | L: clientes de escritórios por hash (`:72`), empresa do escritório (`:78`). G: cliente do escritório (`:80`), auditoria nele (`:90`) | admin da empresa (`admin.integrations`) | Posse do código, status `pending`, validade e CNPJ quando existe | Sim (`:73-77`) | Código vazado vincula empresa sem CNPJ. Não há confirmação final do escritório |
| C-02 | `revokeAccountingLink` pelo escritório — `src/domain/accounting/link.ts:95-121` | G: integração (`:109-117`) e auditoria (`:120`) da empresa | `accounting.link` | Cliente na carteira (`getClient`) | Sim | Não limpa `certificatesTracking` nem os pedidos de certificado (2.6.4) |
| C-03 | `revokeAccountingLink` pela empresa — `src/domain/accounting/link.ts:103-107, 119` | L/G: cliente do escritório; auditoria nele | `admin.integrations` | `linkedCompanyId` = empresa ativa e vínculo ativo | Sim | Idem |
| C-04 | `linkedSnapshot` / `linkedCompanyReader` — `src/domain/accounting/link.ts:136-193` | L: cadastro, filiais, documentos fiscais, obrigações, `fiscal_configs`, pacotes | escritório: `accounting`/ver + carteira. Telas: `src/app/(app)/contabil/clientes/[id]/queries.ts:60-66`, `src/app/(app)/contabil/queries.ts:82-102` | `linkStatus=active` + `linkedCompanyId` + cliente do escritório ativo | Sim, a cada leitura (`:137-138`), Store só leitura | Leitura para na hora (correto). Validade do certificado exposta sem autorização de acompanhamento (`:189`) |
| C-05 | `linkedCompanyRef` — `src/app/(app)/contabil/clientes/[id]/queries.ts:29-38` | L: nome e CNPJ da empresa | escritório | Igual a C-04 | Sim | — |
| C-06 | `deliverPackageToFirm` — `src/domain/accounting/deliveries.ts:31-70` | G: entrega (`:48-51`), notificação (`:56-67`) e auditoria (`:68`) no escritório | quem gera o pacote na empresa (`src/app/(app)/fiscal/actions.ts:369-382`) e a rotina (`src/domain/routines/fiscal.ts:49-52`) | Config da integração + cliente ativo apontando para a empresa | Sim (`:34-40`) | Revogado, nada é entregue (correto). Escritório inativo continua recebendo |
| C-07 | Download de arquivo entregue — `src/app/api/files/[id]/route.ts:21-32` | L: arquivo da empresa de origem (Store só leitura) | usuário do escritório com `accounting`/ver | Existência de `accounting_deliveries` com o `fileId` (`src/domain/accounting/deliveries.ts:105-108`) | Parcial: não confere vínculo vigente nem carteira (`:24`) | Após a revogação, baixa tudo o que já foi entregue (decisão §21). Analista baixa fora da carteira se tiver o id |
| C-08 | `certificateTrackingAuthorized` / `clientTrackingAllowed` — `src/domain/accounting/certificates.ts:145-149, 187-196` | L: integração da empresa vinculada | escritório; rotina | Vínculo ativo + `certificatesTracking` | Sim | A autorização sobrevive à revogação e passa ao próximo escritório; some ao salvar a integração (1.7) |
| C-09 | `listKnownCertificates` (fonte ERP) — `src/domain/accounting/certificates.ts:800-816` | L: `fiscal_configs` e filiais da empresa | escritório; rotina `accounting.certificates` (`:872-903`, `systemCtx`) | Igual a C-08 | Sim | Igual a C-08 |
| C-10 | `setCertificateTracking` — `src/domain/accounting/certificates.ts:152-184` | G: auditoria e notificação no escritório (`:170-183`) | empresa (`admin.integrations` + `admin`/editar) | Vínculo ativo (`:156-157`) | Sim | — |
| C-11 | `requestTrackingAccess` — `src/domain/accounting/certificates.ts:199-220` | G: notificação e auditoria na empresa | `accounting.certificates` | Cliente vinculado e na carteira | Sim (`:202-205`) | — |
| C-12 | Contabilista no SPED (registro 0100) — `src/domain/fiscal/files/settings.ts:99-104` | L: cadastro (`companies`) do escritório | a empresa, ao gerar arquivos fiscais | `integrations.config.linkedFirmCompanyId` da própria empresa | Só o config próprio; a chave sai na revogação (`src/domain/accounting/link.ts:112`) | Baixo (dados cadastrais) |
| C-13 | Responsável e membro da equipe — `src/domain/accounting/clients.ts:120-123`; `src/domain/accounting/team.ts:57-61` | L: `users` (tabela global) | escritório | `companyIds` contém o escritório, **ou** `isAdmin` | Sim | Admin da instalação pode ser responsável em qualquer escritório |

### 4.2 Certificação (K)

| # | Operação (arquivo:linha) | L/G em outra empresa | Quem dispara | Vínculo | Servidor | Risco se o vínculo for removido/suspenso |
|---|---|---|---|---|---|---|
| K-01 | `loadForActor` + `patch` (base das ações da equipe) — `src/domain/accounting/certificates.ts:406-421` | L/G: `certificate_requests` de qualquer empresa | `certification.operate` ou `isAdmin` | **Nenhum.** Só a operação | Só `canDo` | Perfil com a operação em qualquer empresa opera pedidos de todas |
| K-02 | Fila e protocolo — `src/domain/accounting/certificates.ts:838-862`; `src/app/(app)/administracao/certificacao/[id]/page.tsx:99-101` | L: todos os pedidos (titular, CPF/CNPJ, contatos, valor), o cliente do escritório e usuários | equipe | Nenhum | Só `canDo` | Dados pessoais de todas as carteiras |
| K-03 | `confirmCertificatePayment` — `src/domain/accounting/certificates.ts:491-514` | G: pedido, auditoria no dono, cupom (`:502-506`) e lançamentos de todas as camadas (`:507-511`) | equipe | Nenhum | Só `canDo` | Gera títulos e baixas em várias empresas (R-14) |
| K-04 | `registerCertificateEmission` — `src/domain/accounting/certificates.ts:575-621` | G: `.pfx`, certificado e inativação do anterior na empresa dona (`:596-608`); `cert_customers` do parceiro (`:603-606`). Notifica o dono e a empresa vinculada (`:612-619`) | equipe | Nenhum (equipe). Para notificar o titular, usa o retrato `linkedCompanyId` | Só `canDo` | Notifica a ex-empresa mesmo após a revogação |
| K-05 | Agendar, aprovar, recusar, falha, pedir emissão e cancelar — `src/domain/accounting/certificates.ts:519-563, 623-632, 719-739` | G: pedido + auditoria na empresa dona | equipe (algumas também o dono) | Nenhum (equipe) | Só `canDo` | — |
| K-06 | `saveCertificationSettings` — `src/domain/accounting/certificates.ts:93-135` | G: parâmetros da plataforma (preço e custo AC de todos) | `certification.operate` **ou** `network.manage` | Nenhum | Só `canDo` | Perfil concedido por admin de qualquer empresa muda os preços de toda a instalação |
| K-07 | `logEvent` / `notifyFirm` / `notifyTeam` — `src/domain/accounting/certificates.ts:377-403` | G: auditoria e notificação na empresa dona | equipe e titular | — | — | Trilha só no dono; aviso da equipe só para membros do dono |
| K-08 | `companyCertificateRequests` — `src/domain/accounting/certificates.ts:865-867`; `src/app/(app)/administracao/integracoes/accounting-certificates.tsx:22-35` | L: pedidos do escritório sobre a empresa | empresa titular | Retrato `linkedCompanyId` | Só o campo | Ex-empresa continua vendo após a revogação |
| K-09 | `authorizeCertificateDownloadByCompany` — `src/domain/accounting/certificates.ts:638-651` | G: pedido do escritório (`:646`), auditoria (`:647`) e notificação (`:649`) | empresa titular | Retrato `linkedCompanyId` | Não confere o vínculo vigente | Autorização dada fora de um vínculo ativo |
| K-10 | `requestDownloadAuthorization` — `src/domain/accounting/certificates.ts:672-683` | G: notificação na empresa titular | dono (escritório) | Retrato `linkedCompanyId` | Não confere o vínculo vigente | Escritório desvinculado continua notificando |
| K-11 | `downloadIssuedCertificate` — `src/domain/accounting/certificates.ts:701-717`; `src/app/api/certificados/[id]/route.ts:11-35` | L: `.pfx` na empresa dona (`:711-712`). G: contador e auditoria | dono (carteira + autorização) ou titular (`fiscal.configure`) | `downloadAuthorized` / retrato `linkedCompanyId`, mais a senha | Sim, mas sem conferir o vínculo vigente | Após a revogação, o escritório autorizado continua baixando o arquivo com a chave privada; a ex-empresa também |
| K-12 | `reverseNetworkSale` — `src/domain/network/ledger.ts:341-370` | G: pedido, títulos, baixas e carteiras de todas as camadas | plataforma ou equipe | Nenhum | Só `canDo` | Igual a K-01 |

### 4.3 Rede (R)

| # | Operação (arquivo:linha) | L/G em outra empresa | Quem dispara | Vínculo | Servidor | Risco se o vínculo for removido/suspenso |
|---|---|---|---|---|---|---|
| R-01 | `createNode` com empresa nova — `src/domain/network/nodes.ts:100-131, 137-142` | G: empresa nova com parametrização e usuário convidado (contexto delegado `isAdmin`) | plataforma ou admin do pai (`network.children`) | Posição na árvore (`:77-85`) | Sim | Parceiro cria tenants na instalação |
| R-02 | `createNode` com escritório existente — `src/domain/network/nodes.ts:91-98, 133-153` | G: nó apontando para empresa de terceiro; auditoria nela | plataforma ou pai | **Só o CNPJ** + tipo `accounting` | Sim (tipo e unicidade) | Sem consentimento do escritório (3.8.1) |
| R-03 | `moveNode` / `setNodeStatus` — `src/domain/network/nodes.ts:163-230` | G: nós e regras (plataforma); auditoria nas empresas | plataforma | `network.manage` | Sim | Ver 3.6 |
| R-04 | `nodeUsers` — `src/domain/network/nodes.ts:249-253` | L: usuários das empresas descendentes | qualquer usuário de empresa-nó com `dashboard` (sem operação especial) | Caminho | Sim (`getNode`) | Nó suspenso continua vendo |
| R-05 | `nodeHistory` — `src/domain/network/nodes.ts:256-260` | L: auditoria de qualquer empresa sobre o nó | idem | Caminho | Sim | Idem |
| R-06 | Regras de preço — `src/domain/network/prices.ts:243-318` | G: termos de preço da empresa filha, inclusive do escritório-contador | pai (`network.prices`, ativo) ou plataforma | Pai direto | Sim (`:233-240`) | Filho não aceita o preço |
| R-07 | `listNetworkSales` / `getNetworkSale` — `src/domain/network/sales.ts:620-675` | L: vendas dos descendentes com dados pessoais; auditoria da vendedora (`src/app/(app)/rede/vendas/[id]/page.tsx:44`) | `network.sell` ou `sales_all` (descendentes só com `sales_all`) | Caminho | Sim (`saleVisible`) | Suspenso/encerrado mantém leitura. Inclui a Tela 67 do contador |
| R-08 | `findDuplicates` — `src/domain/network/sales.ts:173-195` | L: certificados e pedidos de **todas** as empresas pelo CPF/CNPJ | vendedor ao cotar | Nenhum | — | Revela que o documento tem certificado ou pedido em outro canal |
| R-09 | `renewalWorld` / `renewalPanel` — `src/domain/network/renewals.ts:96-148, 284-294` | L: certificados de todas as empresas-nó, clientes dos escritórios, usuários | `network.renewals`/`sales_all` ou `accounting.certificates` | Caminho (`:186-196`) | Sim (filtra em memória) | Ancestral vê certificados do escritório que não passaram pela rede |
| R-10 | `notifyRenewalAlerts` — `src/domain/network/renewals.ts:337-378` | G: notificação na empresa do pai, com o nome do titular | rotina `network.renewals` | `parentNodeId` | — | Pai suspenso continua avisado |
| R-11 | `createNetworkSale` (transação) — `src/domain/network/sales.ts:404-429` | G: registros da plataforma e reserva nas carteiras dos ancestrais pré-pagos (`src/domain/network/ledger.ts:88-91`) | vendedor | Caminho + modalidade | Saldo sim; consentimento não | Venda de baixo consome o saldo dos ancestrais |
| R-12 | `afterSaleOpened` — `src/domain/network/ledger.ts:149-173` | G: título do cliente e categorias na empresa que cobra (às vezes um ancestral ou a plataforma) | vendedor ou escritório-contador | Plano da venda | Não há consentimento da empresa que cobra | Títulos de clientes alheios no financeiro do ancestral |
| R-13 | `onSalePaid` / `postPaidFlow` / `settleTitle` / `splitTitles` — `src/domain/network/ledger.ts:178-299` | G: baixas com lançamento em conta, débitos de carteira, títulos de split baixados nas duas pontas | equipe (confirmação) | Plano gravado (retrato) | Não confere a situação atual dos nós | Nó suspenso, encerrado ou movido continua recebendo e pagando pelo retrato |
| R-14 | `onSaleCancelledFinance` — `src/domain/network/ledger.ts:304-330` | G: libera reservas e cancela o título na empresa que cobra | dono ou equipe | Plano | — | — |
| R-15 | `reverseFinance` — `src/domain/network/ledger.ts:372-439` | G: estornos e cancelamentos em todas as empresas | plataforma ou equipe | Nenhum além da operação | Só `canDo` | Igual a K-12 |
| R-16 | `closeRelation` / `closingTitles` — `src/domain/network/ledger.ts:520-612` | G: título a pagar e a receber nas duas empresas; notificações | rotina (`SYSTEM_USER`, `:628-651`) ou pai/plataforma (`src/domain/network/results.ts:291-302`) | Chave da relação + modalidade | Manual: `canBillChild`. Rotina: nenhum | Continua após a suspensão; relação antiga segue fechando após mudança de lugar |
| R-17 | `saveBillingAgreement` — `src/domain/network/billing.ts:150-187` | G: modalidade que governa o financeiro do filho | pai (`network.billing`) ou plataforma | `canBillChild` | Sim | Sem aceite do filho (ex.: pré-pago que bloqueia vendas) |
| R-18 | `requestRecharge` — `src/domain/network/billing.ts:266-323` | G: a receber no pai (`:303-305`) e **a pagar no filho** (`:309-312`) | pai, plataforma ou o próprio filho | `canBillChild` | Sim | Conta a pagar no financeiro do filho sem aceite |
| R-19 | `confirmRecharge` / `cancelRecharge` / `adjustWallet` — `src/domain/network/billing.ts:231-256, 329-397` | G: baixa no pai, crédito ou débito na carteira, cancelamento de títulos nas duas empresas | pai ou plataforma | `canBillChild` | Sim | — |
| R-20 | `notifyLowBalances` — `src/domain/network/billing.ts:404-421` | G: notificação no filho e no pai | rotina | Carteira | — | — |
| R-21 | `purchaseVoucherPackage` / `postPurchaseFinance` — `src/domain/network/vouchers.ts:162-195, 206-283` | G: a receber em quem vende o pacote e a pagar em quem compra; notificação | comprador, dono do pacote (atribuição) ou plataforma | Caminho (`:215-223`) | Sim | Atribuição cria a pagar no filho sem aceite |
| R-22 | `createCoupon` — `src/domain/network/coupons.ts:52-106` | G: cupom para nó abaixo; o emissor absorve o desconto abaixo do mínimo (`src/domain/network/billing-plan.ts:236-241`) | `network.coupons` | Caminho (`:68`) | Sim | Margens das camadas intermediárias alteradas por cima |
| R-23 | Financeiro: `relationFinance`, `networkResult`, `readClosing`, `listClosings`, `saleFinanceView` — `src/domain/network/results.ts:109-285` | L: lançamentos, fechamentos e carteiras de várias empresas (mascarados) | `finance_view`/`billing` ou `finance`/ver do próprio filho | Caminho | Sim | Suspenso mantém leitura |
| R-24 | Tela 67 do contador — `src/domain/network/sales.ts:506-548` | G: registros da plataforma, reserva de carteira, título na empresa que cobra | escritório | Nó contador | Sim (`:509`) | Nó suspenso ou encerrado bloqueia toda a Tela 67 |
| R-25 | `savePlatformFinance` — `src/domain/network/common.ts:116-133` | G: define a empresa que recebe e paga pela plataforma | `network.manage` | Nenhum | Só `canDo` | Qualquer perfil com a operação aponta qualquer empresa não-nó |
| R-26 | Listas de usuários nas telas — `src/app/(app)/rede/cupons/page.tsx:36`; `src/app/(app)/rede/vendas/page.tsx:52` | L: nomes de usuários de outras empresas | partner com cupons ou vendas | Caminho | Sim | Baixo |

### 4.4 Transversais (T)

| # | Ponto | Onde | Efeito |
|---|---|---|---|
| T-01 | Concessão de `network.manage` / `certification.operate` por qualquer admin | `src/domain/roles.ts:84-87, 212-276`; `src/app/(app)/administracao/usuarios/perfis/role-options.ts:7` | Escala de empresa para plataforma ou equipe |
| T-02 | `isAdmin` global | `src/lib/auth/users.ts:86`; `src/lib/permissions.ts:274-282` | Um papel único acumula plataforma, equipe e todas as empresas |
| T-03 | Lacunas do `ScopedStore` | `src/lib/db/scoped-store.ts:71, 83-94` | O escopo não protege `update`/`delete`/`increment` por id nem `list` com filtro explícito de empresa |
| T-04 | `companies` e `users` globais | `src/lib/db/schema.ts:72-112`; ex.: `src/app/(app)/contabil/queries.ts:17`, `src/domain/network/renewals.ts:111` | Qualquer Store restrito lê cadastros de qualquer empresa e usuário |
| T-05 | Auditoria e notificação entre empresas montadas à mão | `src/domain/accounting/link.ts:90, 119-120`; `src/domain/accounting/deliveries.ts:68`; `src/domain/accounting/certificates.ts:171-176, 215-219, 383-387`; `src/domain/network/common.ts:192-203`; `src/domain/network/ledger.ts:363-368` | Padrão diferente em cada função; parte das trilhas só existe de um lado |
| T-06 | Rotinas como `isAdmin` | `src/lib/core/ctx.ts:58-65`; `src/domain/network/billing.ts:32` | Lançamentos automáticos em outras empresas com o usuário "Sistema" |

---

## 5. Como a demonstração cria essas empresas e usuários

### 5.1 Ordem e contextos

- `seedDemo` faz, nesta ordem (`src/domain/seed/index.ts:6-25`):
  1. base;
  2. histórico;
  3. módulos.
- A ordem dos módulos é `… accounting, certificates, … network, ecommerce` (`src/domain/seed/modules.ts:27`).
- Cada módulo é idempotente:
  - ids determinísticos (`src/domain/seed/base.ts:20-38`);
  - marcadores em `settings`, como `demo.accounting.done` e `demo.network.done`.
- **Os contextos da loja usam o Store sem escopo:** `refs.ctxFor` devolve `store` cru (`src/domain/seed/base.ts:144-149`).
  - Isso vale para o aceite do vínculo, a autorização de acompanhamento e os pacotes gerados pela loja.
  - Os módulos do escritório e da rede usam `scopeStore` (`src/domain/seed/modules/accounting.ts:41`; `certificates.ts:35`; `network.ts:118-121`).
- **Quando o seed roda:**
  - automaticamente só no modo memória (`src/lib/server/bootstrap.ts:11-24`);
  - nos demais casos, por comando ou pela tela de instalação (`scripts/seed.ts`; `src/app/actions/setup.ts:57-58`; `src/app/api/setup/run/route.ts:139-150`).

### 5.2 Empresas

| Empresa | Tipo | CNPJ | Papel | Criada em |
|---|---|---|---|---|
| Loja Demonstração Intercert | `retail` | 11222333000181 | cliente do escritório | `src/domain/seed/base.ts:64-78` |
| Contábil Horizonte (DEMO) | `accounting` | 33444555000170 | escritório; depois Contador abaixo de Juazeiro | `src/domain/seed/modules/accounting.ts:26` |
| Intercert Certificação (DEMO) | `certification` | 20301510000106 | empresa da plataforma (não é nó) | `src/domain/seed/modules/network.ts:108` |
| Rede Nordeste (DEMO) | `certification` | 20301621000112 | Master | `src/domain/seed/modules/network.ts:55` |
| Regional Ceará (DEMO) | `certification` | 20301732000129 | Regional (pai: Master) | `:56` |
| Regional Bahia (DEMO) | `certification` | 20301843000135 | Regional (pai: Master) | `:57` |
| Revenda Juazeiro do Norte (DEMO) | `certification` | 20301954000141 | Revenda (pai: Ceará) | `:58` |
| Revenda Fortaleza (DEMO) | `certification` | 20302065000107 | Revenda (pai: Ceará) | `:59` |
| Revenda Salvador (DEMO) | `certification` | 20302176000105 | Revenda (pai: Bahia) | `:60` |

Os parceiros são criados por `createNode` com o contexto da plataforma (`src/domain/seed/modules/network.ts:126-137`), que chama `createCompanyWithDefaults` (`src/domain/setup.ts:13-56`).

### 5.3 Usuários

A senha é única para todos: `DEMO_PASSWORD` (`src/domain/seed/base.ts:18`). Os logins aparecem no acesso rápido (`src/lib/auth/quick-access.ts:21-44`). Nenhum deles é `isAdmin`.

| Login | Empresa | Perfil | Como é criado |
|---|---|---|---|
| `admin` (e demais da loja) | Loja | modelos de varejo (`admin` tem `admin.users`) | `src/domain/seed/base.ts:119-142` |
| `contador` | Contábil Horizonte | `firm_admin` | `src/domain/seed/modules/accounting.ts:32-40` |
| `analista` | Contábil Horizonte | `firm_analyst` | idem |
| `certificacao` | **Contábil Horizonte** | "Equipe de certificação (DEMO)", com `certification.operate`, criado pelo `contador` via `createRole` | `src/domain/seed/modules/certificates.ts:39-45` |
| `rede` | Intercert Certificação | "Gestão da rede Intercert (DEMO)" = ações de `partner_admin` + `network.manage` + `certification.operate`, gravado direto com `Seeder.put` | `src/domain/seed/modules/network.ts:110-117` |
| `master`, `regional.ce`, `regional.ba`, `revenda.juazeiro`, `revenda.fortaleza`, `revenda.salvador` | cada parceiro | `partner_admin` | convidados pelo `createNode` (`src/domain/network/nodes.ts:124-130`) e ativados pelo seed (`src/domain/seed/modules/network.ts:89-94, 140-141`) |
| `vendedor.juazeiro`, `vendedor.fortaleza`, `vendedor.salvador` | cada revenda | `partner_seller` | `src/domain/seed/modules/network.ts:142-147` |

### 5.4 Vínculos e cenários criados

**Contábil:**

- a loja é cliente do escritório;
- o `contador` emite o código e o `admin` da loja aceita (`src/domain/seed/modules/accounting.ts:60-73`);
- dois pacotes são entregues ao escritório (`:45-51, 95-99`).

**Certificação:**

- `certificacao` grava o catálogo padrão (`src/domain/seed/modules/certificates.ts:47-51`);
- a loja autoriza o acompanhamento (`:58`);
- quatro protocolos em etapas diferentes, operados pelo `contador` e pela `certificacao` (`:64-90`).

  Como o módulo `certificates` roda **antes** de `network`, esses protocolos não usam preço da rede (não têm `sellerNodeId`).

**Rede:**

- A plataforma cria os nós e **vincula o escritório como Contador pelo CNPJ** (`src/domain/seed/modules/network.ts:151-152`). Não há nenhum passo de aceite do escritório.
- Cada pai define a tabela do nível abaixo (`:154-170`).
- Financeiro em camadas (`:187-203`).
- Cupons, pacote de vouchers, clientes e 11 vendas (`:226-307`). Nessas vendas a "equipe" é o usuário `rede` (`:232`).
- Certificados antigos gravados direto com `store.create` (`:309-319`) e contatos de renovação (`:332-333`).

**Efeitos observáveis no ambiente de teste:**

- `revenda.juazeiro`, `regional.ce` e `master` veem nas Renovações os certificados dos clientes do escritório: Loja, Holding, Café do Largo e Oficina Nordeste (`src/domain/network/renewals.ts:101`).
- Os mesmos usuários veem os usuários do escritório (`src/domain/network/nodes.ts:249-253`).

### 5.5 Particularidades

- O papel de equipe nasce **dentro de um escritório**, por um administrador de escritório. É o mesmo caminho que qualquer administrador de empresa pode usar.
- Com o acesso rápido ligado (`SHOW_DEMO_LOGIN`), qualquer visitante entra como `admin`, `contador`, `master`, `regional.*` ou `revenda.*`, que têm `admin.users`.
  - As proteções desses usuários cobrem e-mail, login, `isAdmin`, situação e senha (`src/domain/users.ts:387-390, 452, 516`).
  - **Não cobrem** a edição de perfis (`src/domain/roles.ts:253-276`).

---

## 6. Recomendações: o que precisa virar vínculo ou permissão explícita

Recomendações factuais, sem implementação. A sigla entre parênteses aponta as operações da seção 4.

### 6.1 Um registro único de "relação entre empresas"

Hoje há três formas diferentes de relação, e cada função confere a sua:

- `accounting_clients.linkStatus` + `integrations.config` (contábil);
- nenhuma relação (equipe de certificação);
- `cert_network_nodes.path` + `cert_billing_agreements` (rede).

O modelo multiempresa precisa de uma relação explícita com:

- as partes;
- o tipo (contabilidade, serviço de certificação, rede comercial);
- **escopos com nome**, por exemplo `fiscal.read`, `package.deliver`, `cert.track`, `cert.download`, `network.sales.read`, `network.customers.pii`, `network.finance.post`, `network.wallet`, `network.pricing`;
- o estado (pendente, ativo, suspenso, revogado);
- a vigência, quem consentiu de cada lado e a trilha.

Toda operação das tabelas 4.1 a 4.3 deveria conferir essa relação no servidor, em vez das checagens espalhadas (`src/domain/accounting/link.ts:136-140`, `src/domain/accounting/deliveries.ts:40`, `src/domain/network/billing.ts:131-136` e outras).

### 6.2 Escritório contábil

- Guardar o consentimento de acompanhamento de certificados na relação, e não na configuração da integração. Ele deve **zerar** na revogação e num novo vínculo, e não pode se perder ao salvar o formulário (C-08, C-09).
- Definir no servidor o efeito da revogação sobre:
  - entregas já recebidas (C-07);
  - `certificate_requests.linkedCompanyId`;
  - autorizações de download pendentes ou dadas;
  - notificações (K-08 a K-11).
- Separar a validade do certificado A1 do escopo fiscal, ou exigir o escopo de certificado no snapshot (C-04).
- Conferir a carteira do usuário e o escopo vigente na rota de arquivos (C-07).
- Decidir se o CNPJ é obrigatório no aceite (C-01) e se a situação das empresas bloqueia leitura e entrega.

### 6.3 Certificação

- Representar a equipe Intercert como uma empresa ou papel de plataforma **fora dos tenants**. Cada escritório e cada parceiro teria uma relação de serviço explícita com ela.
- Restringir `certification.operate` a esse contexto e impedir que administradores de empresa a concedam (T-01, K-01 a K-06).
- Registrar a trilha nos dois lados e encaminhar as notificações da equipe ao contexto da equipe, não à empresa dona (K-07).
- Separar quem edita o catálogo e os preços da plataforma de quem opera pedidos (K-06).
- Dar à autorização de download uma revogação e ligá-la à relação vigente com o titular (K-11).

### 6.4 Rede

- **Exigir o aceite da empresa** para entrar na rede, sobretudo ao vincular um escritório existente pelo CNPJ (R-02), e para as condições comerciais: preço e modalidade (R-06, R-17).
- Transformar em escopos explícitos e consentidos as gravações no financeiro de outra empresa:
  - título do cliente na empresa que cobra (R-12);
  - baixas e split (R-13);
  - fechamentos (R-16);
  - recarga (R-18);
  - atribuição de pacote (R-21);
  - categorias.

  Também é preciso decidir **com qual usuário** essas gravações são feitas: hoje é quem agiu na outra empresa (`src/domain/network/billing.ts:25-29`).
- Separar a leitura de dados pessoais dos clientes dos descendentes (R-07, R-09) da leitura de números da rede. Tratar à parte a carteira do escritório-contador que não passou pela rede (R-09) e os usuários (R-04).
- Definir a semântica de suspensão e encerramento:
  - leitura;
  - recebimento de margens;
  - fechamentos;
  - bloqueio da Tela 67 do contador (R-24);
  - migração de carteira e modalidade ao mover (3.6).
- Restringir `network.manage` e a escolha da empresa da plataforma (R-25), e definir quem pode criar empresas novas (R-01).

### 6.5 Transversais

- Restringir as operações especiais pelo tipo ou papel do tenant em `normalizeActions`, `createRole`/`updateRole` e no editor de perfis (T-01).
- Separar o `isAdmin` da instalação dos papéis de plataforma e de equipe (T-02).
- Fechar no `ScopedStore` as lacunas de `update`/`delete`/`increment` por id e do `list` com filtro explícito. Assim, toda travessia fica obrigada a passar por uma porta explícita (T-03).
- Tratar `companies` e `users` como dados globais com leitura controlada (T-04).
- Padronizar a auditoria e a notificação entre empresas num serviço que conheça a relação (T-05).

---

## 7. Riscos prioritários (síntese)

1. **Escalada de empresa para plataforma ou equipe.** Qualquer administrador de empresa pode pôr `network.manage` ou `certification.operate` num perfil (T-01). O mesmo vale no ambiente de teste com o acesso rápido ligado.
2. **Equipe de certificação sem vínculo.** Lê dados pessoais de todos os pedidos e grava em todas as empresas, inclusive os preços da plataforma (K-01 a K-06).
3. **Escritório posto na rede sem consentimento**, com preço, bloqueio, lançamentos e exposição da carteira ditados pelo nó acima (R-02, R-06, R-09, R-18, R-24).
4. **Lançamentos financeiros em outras empresas** feitos com o usuário de quem agiu, sem permissão da empresa afetada (R-12, R-13, R-16, R-18, R-21).
5. **Consentimentos de certificado fora do ciclo do vínculo.** O acompanhamento é herdado por um novo escritório e o download continua após a revogação (C-08, K-08 a K-11).
6. **A suspensão não corta leitura nem lançamentos.** E bloqueia, de forma definitiva no encerramento, toda a Tela 67 do escritório-contador (3.6).
