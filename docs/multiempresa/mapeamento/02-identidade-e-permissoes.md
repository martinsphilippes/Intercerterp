# 02 — Identidade, sessão e permissões (mapeamento do estado atual)

Mapeamento feito só pela leitura do código, sem alterar nada. Revisão analisada: `0aa96c2`. As referências usam o formato `arquivo:linha`.

Observação sobre nomes de rota: a recuperação de senha fica em `/recuperar-senha` e a redefinição em `/redefinir-senha` (não em `/recuperar` e `/redefinir`). O primeiro acesso por convite fica em `/convite/<token>`.

---

## Sumário dos achados

1. **A identidade vale para a instalação inteira, não para cada contratante.** Há uma única tabela `users`, sem dono por empresa (não tem `companyId`). Por isso ela fica fora do `ScopedStore`, o filtro que restringe cada consulta à empresa ativa. O e-mail é único na instalação. O login também é único, mas só a aplicação garante isso. Um usuário pode ter várias empresas (`companyIds`) e um perfil em cada uma (`roleByCompany`). Já a restrição de filiais (`branchIds`) é **uma lista só, que vale para todas as empresas do usuário**.
2. **A sessão é própria e fica no banco.** O navegador guarda um segredo aleatório e o banco guarda só o hash dele. A sessão dura 1 dia, ou 30 dias com "manter conectado". O prazo conta a partir do login e não se renova com o uso. Não há expiração por inatividade.
3. **Não existe revogação explícita de sessões.** Também não há lista de sessões ativas nem "sair de todos os dispositivos". As sessões só terminam no logout, ao suspender ou inativar o usuário, quando o administrador redefine a senha e quando ele redefine as duas etapas. A recuperação feita pelo próprio usuário **não** encerra as sessões abertas.
4. **Ciclo de vida.** O convite é de uso único, o banco guarda só o hash e a validade é configurável (padrão 7 dias). A recuperação usa link de uso único válido por 1 hora. O administrador **não tem como enviar um link de recuperação**: ele só define a senha diretamente. Não existe troca de senha pelo próprio usuário logado nem troca obrigatória no primeiro acesso.
5. **Modelo de permissões.** São 15 módulos, cada um com visualizar/criar/editar/excluir, mais 60 operações especiais. O perfil vale por empresa. O administrador geral (`isAdmin`) ignora a matriz. As verificações são **repetidas à mão** no menu, nas páginas, nas server actions, no domínio e nas rotas de API. Não há uma política central.
6. **Não existe a regra "não conceder acesso acima do próprio"**, exceto para `isAdmin`. Quem tem `admin.users` pode atribuir qualquer perfil e editar qualquer perfil, inclusive o próprio. Pode também incluir operações de plataforma, que alcançam outras empresas: `network.manage` e `certification.operate`.
7. **A proteção do "último administrador" vale só para o administrador geral da instalação.** Nada impede que uma empresa fique sem nenhum administrador próprio ativo.
8. **Demonstração em produção.** O acesso rápido (`SHOW_DEMO_LOGIN=1`) está ligado na publicação por decisão do titular. A senha aparece na tela de login. Entre os usuários listados estão `rede` (que tem `network.manage` e `certification.operate`) e `admin` (que pode criar empresas). As proteções existentes só impedem que alguém tranque esses acessos; não limitam o que eles podem fazer.
9. **Provisionamento.** Os caminhos que existem são:
   - a rota de instalação `/api/setup/run`, protegida por `SETUP_TOKEN`, que cria o administrador geral;
   - telas: nova empresa e novo parceiro da rede (empresa nova mais convite do administrador dela).

   Não existe API de provisionamento externo de contratante.

---

## 1. Login e sessão

### 1.1 Provedor de autenticação

| Item | Onde | Detalhe |
|---|---|---|
| Interface | `src/lib/auth/provider.ts:14-25` | `createUser`, `setPassword`, `setBlocked`, `login`, `verify`, `logout`, `requestRecovery`, `completeRecovery` |
| Provedor próprio (`LocalAuth`) | `src/lib/auth/provider.ts:40-98` | Usado com Postgres, local e memória. A senha usa scrypt com sal de 16 bytes e chave de 32 bytes, guardada como `scrypt$sal$hash` em `users.passwordHash` (`provider.ts:27-38`). A comparação é feita em tempo constante (`provider.ts:37`) |
| Provedor Appwrite (legado) | `src/lib/auth/provider.ts:100-187` | Usa a sessão do Appwrite. O `verify` guarda o resultado em memória por **60 s** em cada instância (`provider.ts:148-158`): uma revogação pode levar até 1 min para valer |
| Escolha | `src/lib/auth/provider.ts:191-194` | `configuredBackend() === "appwrite"` usa o Appwrite; qualquer outro valor usa `LocalAuth` |
| Dados de acesso do ERP | `src/lib/auth/provider.ts:6-12` | Empresa, filiais e perfil ficam sempre na tabela `users` |

### 1.2 Fluxo do login (`loginAction`)

1. O formulário (`src/app/(auth)/login/form.tsx:12-35`) envia `login`, `password`, `remember` e `next` para `loginAction` (`src/app/actions/session.ts:47-49`). A ação passa por `guardAccess`: banco fora do ar vira mensagem na tela, e erro inesperado vira mensagem genérica (`session.ts:34-45`).
2. **Identificação:** se o texto contém "@", procura pelo e-mail; senão, procura pelo campo `login` (`src/lib/auth/users.ts:71-75`).
3. **Bloqueio temporário**, conferido **antes** da senha (`session.ts:60-67`).
4. **Usuário inexistente:** a tentativa é registrada e a mensagem é genérica (`session.ts:71-74`).
5. **Situação** `inactive`, `suspended` ou `invited`: o login é recusado com mensagem específica, que inclui o motivo da suspensão. **Isso acontece sem conferir a senha** (`session.ts:75-82`).
6. **Senha** conferida no provedor (`session.ts:83-98`). Na senha errada, a mensagem informa quantas tentativas restam (`session.ts:86-92`).
7. **Segunda etapa**, se o usuário tiver: cria um desafio, grava o cookie `ic_2fa` e redireciona para `/login/duas-etapas` (`session.ts:99-106`).
8. **`finishLogin`** (`session.ts:111-136`):
   - grava o cookie `ic_session` (`:114`);
   - atualiza `lastAccessAt` e `firstAccessAt` (`:115`);
   - escolhe a unidade lembrada em `user_prefs` ou a única disponível, só entre empresas e filiais ativas (`:116-127`);
   - registra `auth.login` (`:128`);
   - redireciona para `next`, depois de filtrado (`:131-133`), ou para `/selecionar-unidade` (`:135`).

`authenticate()` em `src/domain/users.ts:574-595` aplica as mesmas regras de situação, mas sem bloqueio nem segunda etapa. Só os testes a usam.

### 1.3 Cookies

| Cookie | Constante | Conteúdo | Atributos | Duração |
|---|---|---|---|---|
| `ic_session` | `src/lib/server/session.ts:14` | Segredo da sessão: 32 bytes aleatórios em hexadecimal (`provider.ts:62`) | `httpOnly`, `sameSite=lax`, `secure` em produção, `path=/` (`session.ts:114`) | Cookie de sessão do navegador. Com "manter conectado", `expires` igual ao prazo da sessão |
| `ic_unit` | `session.ts:15` | `companyId:branchId` ou `companyId:all`. **Sem assinatura**, mas conferido a cada requisição contra as unidades permitidas (`session.ts:41-51`) | `httpOnly`, `lax`, `secure` em produção | 1 ano (`src/app/actions/session.ts:132, 205`; `src/app/api/unit/route.ts:17`) |
| `ic_2fa` | `session.ts:17` | Token do desafio da segunda etapa (o banco guarda só o hash) | `httpOnly`, `lax`, `secure` em produção | 10 min (`src/app/actions/session.ts:104`; `src/domain/two-factor.ts:29`) |

### 1.4 Onde a sessão fica, como é verificada e quanto dura

- **Gravação:** tabela `sessions` com `userId`, `tokenHash` (sha256 do segredo), `expiresAt` e `persistent` (`src/lib/auth/provider.ts:64`). A tabela também tem os campos `userAgent` e `ip`, mas **eles não são preenchidos** (`src/lib/db/schema.ts:127-132`). A tabela é marcada como efêmera e não entra no backup (`schema.ts:129`).
- **Duração:** 30 dias com "manter conectado" e 1 dia sem (`provider.ts:63`). O prazo conta a partir do login. `verify` confere apenas `expiresAt` e nunca o prorroga (`provider.ts:68-73`). Não há expiração por inatividade.
- **"Manter conectado":** é a caixa `remember` (`src/app/(auth)/login/form.tsx:27`), que vira `persistent` (`src/app/actions/session.ts:55`). Ela **não dispensa** a segunda etapa (`session.ts:99`; regra em `docs/regras-assumidas.md:955`).
- **Verificação a cada requisição** (`getSession`, memorizada só dentro da mesma requisição — `src/lib/server/session.ts:31-82`):
  1. lê o cookie e chama `verify` (`:34-38`);
  2. busca o usuário pelo `authId` e exige `status === "active"` e `!loginDisabled` (`:39-40`);
  3. calcula as unidades acessíveis; sem nenhuma empresa, a sessão não vale (`:41-42`);
  4. resolve empresa e filial a partir do `ic_unit` (`:43-51`);
  5. monta o usuário com o perfil **da empresa ativa** (`:53`);
  6. se o perfil passou a exigir a segunda etapa e o usuário ainda não cadastrou o aplicativo, a sessão deixa de valer (`:54-56`);
  7. devolve `ctx` com o `Store` restrito à empresa (`:72-81`).
- **Exigências de página e de API:**
  - `requireSession(module, op)`: sem sessão vai para `/login`, sem unidade de trabalho vai para `/selecionar-unidade`, sem permissão vai para `/sem-permissao` (`session.ts:90-96`).
  - `requireApiSession()`: devolve 401 sem sessão e 409 sem unidade de trabalho (`session.ts:104-110`).
- **Limpeza:** nenhuma rotina apaga sessões vencidas. O único código que apaga linhas de `sessions` está em `provider.ts:77` (logout) e `src/domain/users.ts:439-443` (encerramento pelo administrador).

### 1.5 Encerramento e revogação

| Situação | Efeito | Onde |
|---|---|---|
| "Sair" | Apaga a sessão no banco e o cookie `ic_session`. O cookie `ic_unit` continua. **Não é auditado** | `src/app/actions/session.ts:182-188`; `src/components/shell/user-menu.tsx:30-32` |
| Suspender ou inativar | Encerra todas as sessões do usuário | `src/domain/users.ts:472` |
| Senha definida pelo administrador | Encerra todas as sessões | `src/domain/users.ts:526` |
| Duas etapas redefinidas pelo administrador | Encerra todas as sessões | `src/domain/users.ts:543` |
| Recuperação feita pelo próprio usuário (`completeRecovery`) | **Não encerra** as sessões | `src/lib/auth/provider.ts:93-97` |
| Troca de e-mail ou login, troca de perfil, retirada de empresa | Não encerra as sessões. A permissão nova vale na próxima requisição, porque `getSession` recalcula tudo. Perfis podem ficar até 15 s em cache em cada instância (ver §4.10) | `src/domain/users.ts:311-437` |
| Revogar uma sessão específica, listar dispositivos, "sair de todos" | **Não existe** | — |

### 1.6 Bloqueio por tentativas

- São 5 tentativas inválidas em 15 minutos (`src/domain/two-factor.ts:27-28`). As tentativas são contadas **no histórico de auditoria** (`audit_logs` com `entityType="login"`), e o contador zera no último login bem-sucedido (`two-factor.ts:39-45`). Cada tentativa é gravada por `logLoginAttempt` (`two-factor.ts:47-56`).
- **A chave do contador é a conta**, não o IP. Pode ser o id do usuário ou o texto digitado, quando o usuário não existe (`two-factor.ts:34-37`). Não há limite por IP nem CAPTCHA. Como o bloqueio é conferido antes da senha, quem conhece o login de alguém consegue bloquear a pessoa por 15 minutos (`src/app/actions/session.ts:64-67`).
- Os códigos errados da segunda etapa entram no mesmo contador (`two-factor.ts:199-233`).
- **Os usuários do acesso rápido não são bloqueados** (`session.ts:65-67, 90`).
- Três verificações de senha **fora** da tela de login não passam pelo contador:
  - autorização de supervisor no PDV: `src/domain/supervisor.ts:17-41`;
  - confirmação antes de baixar certificado: `src/domain/accounting/certificates.ts:685-695`;
  - desativação das duas etapas: `src/domain/two-factor.ts:288-299`.
- **Dá para descobrir se uma conta existe:**
  - as situações inativo, suspenso e convite pendente têm mensagens próprias, mostradas sem conferir a senha (`session.ts:75-82`);
  - o aviso de "tentativas restantes" só aparece quando o usuário existe (`session.ts:89-91`);
  - na recuperação, se o canal de e-mail não estiver configurado, a resposta muda quando o usuário existe (`session.ts:231-243`).

### 1.7 Duas etapas (TOTP)

- **Algoritmo:** RFC 6238 sobre HOTP com SHA-1, intervalo de 30 s, 6 dígitos e tolerância de um intervalo para cada lado. O mesmo intervalo não é aceito duas vezes (`src/lib/auth/totp.ts:3-7, 78-91`).
- **Guarda dos segredos:** o segredo do aplicativo e a sessão pendente ficam cifrados com AES-256-GCM. A chave vem de `AUTH_ENCRYPTION_KEY` e, em produção sem ela, gravar falha (`src/lib/auth/secret-box.ts:4-23, 34-41`). São gerados 10 códigos de recuperação de uso único, guardados só como hash (`totp.ts:112-130`; `two-factor.ts:115-121`).
- **Exigência:** é uma opção do perfil (`roles.requireTwoFactor`). Vale quando **algum perfil do usuário, em qualquer empresa**, a exige (`two-factor.ts:61-75`). O **administrador geral nunca é obrigado** (`two-factor.ts:62`; `src/lib/auth/users.ts:67`).
- **No login:** a sessão criada pelo provedor fica guardada cifrada em `auth_challenges` por 10 minutos (`schema.ts:136-144`; `two-factor.ts:135-150`). O cookie de sessão só é entregue depois de um código válido (`two-factor.ts:189-242`; `src/app/actions/session.ts:142-170`). "Voltar ao login" descarta o desafio (`session.ts:173-180`).
- **Pelo próprio usuário**, em Minha conta › Segurança: ativar (`two-factor.ts:261-286`), desativar com senha e código, o que é recusado se o perfil exige (`:302-314`), e gerar novos códigos (`:317-326`). Telas: `src/app/(app)/conta/seguranca/page.tsx:16-19`; ações: `src/app/(app)/conta/seguranca/actions.ts:11-32`.
- **Pelo administrador:** redefinição com motivo, que apaga segredo e códigos e encerra as sessões (`src/domain/users.ts:534-545`).

### 1.8 Destino depois do login

`safeNextPath` aceita só caminho relativo interno. Recusa `//host`, `/\`, caracteres de controle, esquemas e caminhos que, depois de normalizados, virariam outro host (`src/lib/auth/redirect.ts:6-21`).

### 1.9 Middleware

`src/middleware.ts:29-43` **não trata autenticação**. Ele só reescreve para a vitrine (`/loja/~host`) as requisições que chegam por domínios que não são do ERP. Rotas `/api` ficam fora do `matcher` (`:40-43`). A autenticação das páginas internas é feita no layout (`src/app/(app)/layout.tsx:10`), em cada página, em cada server action (`runAction`) e em cada rota de API (`requireApiSession`).

### 1.10 Telas em `src/app/(auth)`

| Rota | Arquivos | O que faz |
|---|---|---|
| `/login` | `login/page.tsx`, `form.tsx`, `access.ts`, `quick-access.tsx`, `outage-notice.tsx` | Formulário, aviso de banco indisponível e acesso rápido. Instalação vazia vai para `/primeiro-acesso` (`page.tsx:27-28`). Quem já tem sessão vai para o painel (`page.tsx:25`) |
| `/login/duas-etapas` | `login/duas-etapas/page.tsx:19-26`, `form.tsx` | Pede o código ou faz o cadastro obrigatório com QR code |
| `/selecionar-unidade` | `selecionar-unidade/page.tsx:11-46`, `picker.tsx:27-53` | Escolha de empresa e depois de filial (ou consolidado). Seleção automática quando há uma opção só (`page.tsx:20-23`) |
| `/convite/[token]` | `convite/[token]/page.tsx:5-13`, `form.tsx:7-27` | Define a senha e ativa o acesso. O token **só é validado no envio** do formulário |
| `/recuperar-senha` | `recuperar-senha/page.tsx`, `form.tsx` | Pede o link por usuário ou e-mail (`requestRecoveryAction`) |
| `/redefinir-senha` | `redefinir-senha/page.tsx:5-10`, `form.tsx` | Recebe `userId` e `secret` **na URL** e define a nova senha |
| `/primeiro-acesso` | `primeiro-acesso/page.tsx:11-29`, `form.tsx` | Instalação vazia: cria a empresa e o administrador geral, ou carrega a demonstração. Exige `SETUP_TOKEN` em produção (`src/app/actions/setup.ts:11-20`) |
| `/suporte` | `suporte/page.tsx`, `form.tsx` | Chamado público de quem não consegue entrar (`companyId="public"`, ver `src/lib/db/scoped-store.ts:12-13, 18`) |

---

## 2. Como o servidor determina a empresa e a filial do usuário

### 2.1 Dados do usuário

Tabela `users` (`src/lib/db/schema.ts:94-112`):

| Campo | Significado |
|---|---|
| `isAdmin` | Administrador geral da instalação: vê todas as empresas e ignora a matriz (`src/lib/permissions.ts:274-282`; `src/lib/auth/users.ts:86-88`) |
| `companyIds` (lista) | Empresas vinculadas. **Um usuário pode ter várias** |
| `roleByCompany` (JSON) | Perfil de cada empresa: `{ [companyId]: roleId }` (`schema.ts:102-103`) |
| `roleId` | Perfil "legado", da empresa de origem |
| `branchIds` (lista) | Restrição de filiais, **uma lista para todas as empresas do usuário**. Vazia significa todas as filiais (`src/domain/users.ts:32-35`) |
| `discountLimitBps` | Limite de desconto próprio, que vale em todas as empresas (`src/lib/auth/users.ts:64`) |
| `status`, `loginDisabled`, `isDemo`, `authId`, `passwordHash`, tokens de convite e recuperação, `totp*` | Situação e credenciais (§3) |

O índice de e-mail é **único na instalação**. O de login **não é único** (`schema.ts:111`): a unicidade do login é conferida só na aplicação (`src/domain/users.ts:187-192`). Não existe campo de cargo.

### 2.2 Resolução a cada requisição

- `accessibleUnits` (`src/lib/auth/users.ts:82-91`): o administrador geral recebe todas as empresas e filiais. Os demais recebem as empresas de `companyIds` e as filiais dessas empresas, limitadas por `branchIds` se a lista não estiver vazia.
- `getSession` (`src/lib/server/session.ts:43-53`):
  - empresa e filial vêm de `ic_unit` e precisam estar na lista acessível e ativas;
  - o **consolidado** (`branchId="all"`) só vale para o administrador geral ou para quem não tem restrição de filial (`:50-51`);
  - o perfil é o da empresa ativa (`:53`).
- Empresa e filial inativas não são contexto de trabalho, e a tela explica o motivo (`src/lib/auth/users.ts:97-101`). Sem contexto completo, as páginas vão para a seleção e as APIs respondem 409. O `Store` continua restrito mesmo assim (`session.ts:58-71`).
- Com a unidade definida, `ctx.store = scopeStore(store, companyId)` (`session.ts:73`).

### 2.3 Troca de unidade

- `switchUnitAction` (`src/app/actions/session.ts:190-208`):
  - confere se a empresa está entre as do usuário, se não está inativa, se o consolidado é permitido e se a filial pertence à empresa e está ativa;
  - grava `ic_unit` e lembra a escolha em `user_prefs` (chave `lastUnit`, sem empresa — `session.ts:21-28`; `schema.ts:156-160`).
  - **A troca não é auditada.**
- Quem chama:
  - seletor no cabeçalho (`src/components/shell/unit-switcher.tsx:16`);
  - tela `/selecionar-unidade` (`src/app/(auth)/selecionar-unidade/picker.tsx:42-53`);
  - `selectUnitAction` (`session.ts:210-216`);
  - rota `GET /api/unit`, usada na seleção automática (`src/app/api/unit/route.ts:7-18`).

### 2.4 Filiais autorizadas e consolidado

- A restrição é por usuário e vale em todas as empresas. O editor que não administra todas as empresas do usuário tem regras próprias:
  - as filiais das empresas fora do seu alcance são preservadas;
  - ele não pode incluir uma restrição em quem não tem, nem retirar a de quem tem (`src/domain/users.ts:317-369`).
- As operações exigem filial; o consolidado é só consulta:
  - `requireBranch` (`src/lib/core/ctx.ts:42-45`);
  - `runAction({ requireBranch })` (`src/lib/server/action.ts:27`).
- As listagens respeitam a filial da sessão (`docs/regras-assumidas.md:234`; `src/lib/server/lookups.ts:47-50`).

### 2.5 "Administrador geral" e "plataforma"

- **`isAdmin`** é o administrador da instalação:
  - `can` e `canDo` devolvem sempre verdadeiro (`src/lib/permissions.ts:274-282`);
  - vê todas as empresas (`src/lib/auth/users.ts:86-88`);
  - **aparece na lista de usuários e nos seletores de vendedor de todas as empresas** (`src/domain/users.ts:83-86`; `src/lib/server/lookups.ts:31-37`).
  - Como é criado:
    - na instalação (`src/app/actions/setup.ts:76`);
    - pela etapa `owner` de `/api/setup/run` (`src/app/api/setup/run/route.ts:181-196`);
    - por outro `isAdmin` (`src/domain/users.ts:186`).
  - Documentação: a produção ainda **não tem** administrador geral, porque falta o titular informar o e-mail, e "o acesso administrativo é o 'Administração' da demonstração" (`docs/pendencias-externas.md:7`; `docs/progresso.md:61`).
- **"Plataforma" da rede de certificação** é qualquer usuário com a operação `network.manage`, em qualquer empresa (`src/domain/network/common.ts:61-64`). Não existe uma entidade "empresa da plataforma" que restrinja isso.
  - Os registros da rede usam `companyId="platform"`, que nenhum `Store` restrito enxerga (`common.ts:19-24`).
  - A plataforma vê todos os nós (`common.ts:163-169`).
- **Equipe de certificação** é quem tem `certification.operate`. A fila dela lê `certificate_requests` de **todas** as empresas, sem filtro (`src/domain/accounting/certificates.ts:836-852`).

### 2.6 Escritório contábil com acesso a outras empresas

- O usuário do escritório **não recebe** as empresas dos clientes em `companyIds`.
- O acesso aos dados do cliente depende de um vínculo consentido. O escritório emite um código, e o administrador da empresa no ERP o aceita (`src/domain/accounting/link.ts:13-21, 64-92`). Qualquer um dos lados pode desfazer o vínculo (`link.ts:95-121`).
- A leitura é feita por um `Store` **somente leitura**, restrito à empresa vinculada (`link.ts:136-140`; `src/lib/db/read-only.ts:4-8`). O download de arquivos entregues também segue essa regra (`src/app/api/files/[id]/route.ts:23-28`).
- Dentro do escritório, a carteira visível depende de `accounting.all_clients`. Sem essa operação, o usuário vê só os clientes em que é responsável, titular ou substituto (`src/domain/accounting/team.ts:20-36`).

### 2.7 Rede de certificação

- Cada nó da rede é uma empresa (`kind="certification"`, ou `accounting` no nível contador).
- O usuário de um nó vê o próprio nó e os descendentes, só em consulta. Nunca vê irmãos nem ancestrais (`src/domain/network/common.ts:159-169`).
- Ele vê também os usuários dos nós descendentes (`src/domain/network/nodes.ts:249-253`).
- O cadastro de um parceiro cria a empresa e envia o convite ao administrador dela, por um **contexto delegado com `isAdmin: true`**. Quem cadastra não ganha acesso à empresa nova (`nodes.ts:63-69, 118-130`).
- As vendas próprias e as de todo o nó são separadas pela operação `network.sales_all` (`src/domain/network/sales.ts:33, 55`).

### 2.8 Contextos técnicos

- `systemCtx`, usado pelas rotinas: `isAdmin: true` e `Store` restrito à empresa (`src/lib/core/ctx.ts:58-65`).
- `SYSTEM_USER` da rede: `isAdmin: true`, para lançamentos automáticos em outras empresas (`src/domain/network/billing.ts:24-32`).
- `ctxForCompany` e `companyAdminCtx`: administrar outra empresa exige acesso a ela e o perfil de administração **daquela** empresa (`src/lib/core/ctx.ts:51-55`; `src/domain/companies.ts:175-185`).

### 2.9 Tabelas globais (fora do filtro por empresa)

O `ScopedStore` só filtra tabelas que têm `companyId` (`src/lib/db/scoped-store.ts:20-22, 43-47, 70-76`). Ficam **sem filtro**:

- `users`, `sessions`, `auth_challenges` e `user_prefs` (`schema.ts:94-160`);
- `companies` (`schema.ts:72-82`).

Consequências que aparecem no código:

- a unicidade de e-mail e login vale na instalação inteira;
- as mensagens de duplicidade **mostram o nome do usuário de outra empresa**: `src/domain/users.ts:188, 191` e `src/domain/sellers.ts:112-113`;
- `nameMap(ctx, "users")` lê todos os usuários da instalação (`src/lib/server/lookups.ts:41-44`);
- a proteção depende de filtros explícitos, como `companyUsers` (`src/domain/users.ts:83-86`) e `loadManagedUser` (`users.ts:107-113`).

---

## 3. Ciclo de vida do usuário

### 3.1 Situações

| Situação | Efeito no login | Onde |
|---|---|---|
| `active` | Pode entrar | — |
| `invited` | Recusado: "Convite pendente" | `src/app/actions/session.ts:79-82` |
| `suspended` (motivo obrigatório) | Recusado e o motivo é mostrado. As sessões são encerradas | `src/domain/users.ts:446-479` |
| `inactive` | Recusado. As sessões são encerradas e o convite, invalidado | `users.ts:464, 472` |
| `loginDisabled` (vendedor sem acesso) | Sempre recusado | `src/domain/users.ts:563-571`; `src/lib/server/session.ts:40` |

O motivo de bloqueio vem de `loginBlockReason` (`src/domain/users.ts:563-571`).

### 3.2 Criação: convite ou senha inicial

`createUser` (`src/domain/users.ts:256-307`) exige `admin/create` e `admin.users` (`users.ts:59-68`). Há dois modos:

- **Senha inicial:** o administrador define a senha (mínimo de 8 caracteres) e o usuário já fica ativo (`users.ts:270-288`). Não existe troca obrigatória no primeiro acesso.
- **Convite:**
  - token aleatório de 24 bytes, com só o hash gravado (`users.ts:230-232, 294`);
  - validade dada pelo parâmetro da empresa `users.inviteExpiryDays` (padrão 7, de 1 a 30 — `users.ts:55, 289-291`; `src/app/(app)/administracao/parametros/catalog.ts:272`);
  - e-mail enviado pelo canal **da empresa em uso** (`users.ts:234-245`; `src/lib/core/email.ts:8-14`). Sem canal, o link aparece **uma vez** para o administrador (`src/app/(app)/administracao/usuarios/invite-link.tsx:14-49`);
  - o endereço do link vem de `APP_URL` ou dos cabeçalhos da requisição (`src/app/(app)/administracao/usuarios/actions.ts:9-13`).

Validações comuns:

- e-mail único **na instalação**;
- login no formato `[a-z0-9._-]{3,40}`, único;
- ao menos uma empresa;
- o usuário precisa continuar na empresa em uso;
- perfil da empresa em uso e ativo;
- só o administrador geral concede `isAdmin` (`users.ts:180-228`).

### 3.3 Aceite do convite (primeiro acesso)

`acceptInviteAction` (`src/app/actions/session.ts:272-285`) chama `acceptInvite` (`src/domain/users.ts:548-560`), que:

- procura o usuário pelo hash do token e exige `status="invited"` e convite dentro da validade;
- cria a credencial e ativa o usuário;
- **apaga o hash**, o que torna o link de uso único;
- registra `user.invite_accept`.

Outras regras do convite:

- **Reenviar** gera um token novo e invalida o anterior (`users.ts:482-496`). Não vale para usuário suspenso nem para quem já ativou o acesso (`users.ts:486-487`).
- **Cancelar** deixa o usuário inativo e apaga o token (`users.ts:498-506`).

### 3.4 Recuperação de senha (`/recuperar-senha` e `/redefinir-senha`)

- **Pedido** (`src/app/actions/session.ts:218-251`):
  - a resposta é neutra quando o usuário não existe (`:229-231`);
  - o endereço do link vem de `x-forwarded-proto` e `host` (`:228`);
  - em `LocalAuth` (`src/lib/auth/provider.ts:80-91`): segredo de 24 bytes guardado como hash, **validade de 1 hora** (`:84`), link `.../redefinir-senha?userId=<id>&secret=<segredo>` (`:85`), enviado pelo canal de e-mail da **primeira empresa** do usuário (`:87`);
  - fora de produção, sem canal de e-mail, o link aparece no log e na tela (`:88-90`; `session.ts:236-243`).
  - Não há conferência da situação do usuário: um usuário inativo também recebe o link.
- **Conclusão** (`session.ts:253-269` e `provider.ts:93-97`):
  - confere o hash e a validade, grava a senha nova e **apaga o token** (uso único);
  - pedir de novo substitui o token anterior.
  - **Não encerra as sessões nem registra auditoria** em nenhuma das duas etapas.
- **Acesso rápido:** os usuários da lista não recebem link (`session.ts:232-233`).

### 3.5 Senha definida pelo administrador

`adminSetPassword` (`src/domain/users.ts:509-528`):

- só para usuário ativo, com mínimo de 8 caracteres;
- encerra as sessões e registra `user.password_reset`;
- o administrador **fica sabendo a senha**;
- não existe a opção "enviar link de redefinição ao usuário".

Tela: `src/app/(app)/administracao/usuarios/password-dialog.tsx:11-43`. A regra geral de senha é só o mínimo de 8 caracteres (`users.ts:271, 511, 549`; `src/app/actions/session.ts:258`). Não existe troca de senha pelo próprio usuário logado (nenhuma ação desse tipo em `src/`).

### 3.6 Suspensão, inativação e reativação

`setUserStatus` (`src/domain/users.ts:446-479`):

- ninguém altera a própria situação (`:449`);
- quem não é administrador geral precisa administrar usuários em **todas** as empresas do usuário (`:450`; regra em `users.ts:158-168`);
- os usuários do acesso rápido estão protegidos (`:452`);
- a suspensão exige motivo (`:453`);
- o último administrador geral ativo está protegido, com nova conferência depois de gravar para cobrir operações simultâneas (`:456, 466-469`);
- no Appwrite, a conta também é bloqueada (`:470`);
- as sessões são encerradas (`:472`);
- a auditoria guarda o antes e o depois (`:474-477`);
- a reativação exige que o usuário já tenha credencial (`:460`).

### 3.7 Troca de e-mail e de login

É feita no `updateUser` (`src/domain/users.ts:311-437`):

- a unicidade vale na instalação (`:187-192`);
- quem não é administrador geral precisa administrar todas as empresas do usuário (`:371-373`);
- os usuários do acesso rápido não podem mudar (`:387-391`);
- no Appwrite, o e-mail e o nome também são atualizados lá (`:418-430`).

**Não há confirmação do novo e-mail, aviso no e-mail antigo nem encerramento de sessões.** Em `LocalAuth` o `authId` continua `local:<e-mail original>` (`src/lib/auth/provider.ts:44-48`). A consulta por `authId` continua funcionando, mas o identificador deixa de bater com o e-mail.

### 3.8 Vendedor sem acesso

É gerido em Vendas › Vendedores: `users` com `loginDisabled=true`, sem senha nem perfil (`src/domain/sellers.ts:100-125`). Esse cadastro fica fora da tela de usuários (`src/domain/users.ts:75-80`; `src/app/(app)/administracao/usuarios/queries.ts:20-21`).

### 3.9 Proteções do acesso rápido (usuários de demonstração)

`isQuickAccessUser` vale com `SHOW_DEMO_LOGIN=1` para usuários com `isDemo`, sem `isAdmin` e com login da lista (`src/lib/auth/quick-access.ts:65-67`). Enquanto o acesso rápido estiver ligado:

- não dá para inativar nem suspender (`src/domain/users.ts:452`);
- a senha só pode voltar a ser a da demonstração (`users.ts:516-517`);
- e-mail e login não mudam e o usuário não vira administrador geral (`users.ts:387-391`);
- não há link de recuperação (`src/app/actions/session.ts:233`);
- não há bloqueio por tentativas (`session.ts:66-67`);
- não há duas etapas (`src/domain/two-factor.ts:64, 138, 263, 276`).

Detalhes em §6.

### 3.10 Auditoria

- **É registrado:**
  - usuários: `user.create`, `user.invite`, `user.update` (com a diferença de campos), `user.activate`, `user.deactivate`, `user.suspend`, `user.invite_resend`, `user.invite_cancel`, `user.password_reset`, `user.2fa_reset`, `user.invite_accept`, `user.2fa_enable`, `user.2fa_disable`, `user.2fa_recovery_codes` (`src/domain/users.ts`, `src/domain/two-factor.ts`);
  - login: `auth.login`, `auth.login_failed`, `auth.password_ok` (resultado "pendente"), `auth.2fa_failed`, `auth.2fa_recovery_used` (`src/app/actions/session.ts:68-69, 102, 164`; `src/domain/two-factor.ts:227, 239`);
  - perfis: `role.create`, `role.duplicate`, `role.update` (antes e depois legível), `role.delete`, `role.template_sync` (`src/domain/roles.ts:230-286`; `src/lib/auth/role-sync.ts:75-96`);
  - vínculos: `company.users` (`src/domain/companies.ts:402-410`);
  - negações: `*.denied` (`src/lib/server/action.ts:22-25, 37-45`; `src/domain/roles.ts:150-159`).
- **Não é registrado:** logout, pedido e conclusão de recuperação, troca de unidade (nenhuma chamada de `audit` em `src/app/actions/session.ts:182-269`). Também não é registrada a negação feita por `assert`, como em `src/domain/products.ts:869, 896`, porque isso não é `PermissionError`.
- As tentativas de login ficam com o `companyId` da **primeira** empresa do usuário, ou nulo quando o usuário não existe (`two-factor.ts:52`). O IP vem de `x-forwarded-for` (`src/lib/server/session.ts:62, 73`).

---

## 4. Modelo de permissões

### 4.1 Módulos e operações

- **15 módulos** (`src/lib/permissions.ts:3-19`): `dashboard`, `pdv`, `sales`, `cash`, `products`, `stock`, `customers`, `suppliers`, `finance`, `purchases`, `fiscal`, `reports`, `admin`, `support`, `accounting`.
  - Módulos só do escritório: `ACCOUNTING_MODULES` (`:22`).
  - Módulos que o escritório não usa: `RETAIL_ONLY_MODULES` (`:24`).
- **Operações da matriz:** `view`, `create`, `edit` e `delete` (`permissions.ts:27-28`; rótulos em `src/domain/roles.ts:18-23`).
  - Algumas não se aplicam: excluir em PDV, vendas, caixa e estoque; relatórios só têm visualizar (`roles.ts:29-35`).
  - Qualquer operação implica visualizar (`roles.ts:72-82`).

### 4.2 Operações especiais

São **60** (`src/lib/permissions.ts:30-96`), por exemplo `sale.cancel`, `finance.approve_payable`, `purchase.approve`, `fiscal.cancel`, `data.export`, `admin.users`, `admin.integrations`, `admin.backup`, `accounting.*`, `certification.operate`, `network.*` e `ecommerce.*`.

- "Aprovar", "cancelar" e "exportar" existem como operações especiais de cada domínio. "Exportar" é uma operação **só**, `data.export`, que vale para todos os módulos junto com o direito de visualizar o módulo (`src/app/api/export/[key]/route.ts:19`).
- No formulário de perfil, as operações são agrupadas pelo prefixo (`src/domain/roles.ts:42-58`). Prefixos sem módulo próprio caem em "Administração": `network.`, `certification.`, `accounting.`, `ecommerce.`, `sales.`, `sales_doc.` e `products.`.

### 4.3 Perfis padrão (copiados para cada empresa na criação)

São criados como perfis de sistema em `src/domain/setup.ts:55-56`, conforme `roleTemplatesFor(kind)` (`src/lib/permissions.ts:263-266`).

| Tipo de empresa | Perfis | Onde |
|---|---|---|
| Varejo (`retail`) | Administrador (todos os módulos e as operações de varejo, **sem** `accounting.*`, `certification.*` nem `network.*`), Gerente (`admin` só consulta), Caixa, Estoquista, Financeiro, Fiscal | `permissions.ts:113-175` |
| Escritório (`accounting`) | Sócio/Administrador, Gestor de departamento, Analista, Financeiro do escritório | `permissions.ts:181-214` |
| Parceiro da rede (`certification`) | Administrador do parceiro, Gestor, Vendedor, Financeiro. Nenhum recebe `network.manage` | `permissions.ts:216-257` |

Os perfis de sistema podem ser editados, mas não excluídos (`src/domain/roles.ts:281`).

### 4.4 Perfil por empresa

`resolveRoleId` e `userRoleIn` (`src/lib/auth/users.ts:13-43`) aplicam esta ordem:

1. o perfil explícito de `roleByCompany[empresa]`, se for daquela empresa ou global;
2. senão, o perfil legado `roleId`, se for da empresa ou global;
3. senão, o **perfil de sistema com a mesma chave** naquela empresa.

Consequências:

- vincular a uma empresa nova já dá o perfil de sistema equivalente (`src/domain/companies.ts:373-377`);
- um perfil com `companyId` nulo seria aceito em qualquer empresa (`users.ts:18, 22`; o campo é opcional em `schema.ts:117`), embora nenhuma tela crie esse tipo de perfil.

`toCtxUser` monta as permissões da empresa ativa (`users.ts:49-69`).

### 4.5 Sincronização dos perfis de sistema

Quando um modelo padrão ganha operações novas, elas são **acrescentadas automaticamente** aos perfis de sistema de todas as empresas. Isso acontece de três formas:

- ao ler o perfil (`src/lib/auth/users.ts:52-53`; `src/domain/roles.ts:175`);
- na rotina diária `admin.roles` (`src/domain/routines/admin.ts:13`);
- na carga da demonstração.

A sincronização não remove o que o administrador retirou e é auditada (`src/lib/auth/role-sync.ts:8-15, 22-49, 55-112`).

### 4.6 Funções de verificação

| Função | Onde | Uso |
|---|---|---|
| `can(user, módulo, op)` e `canDo(user, ação)` | `src/lib/permissions.ts:274-282` | Base de tudo. `isAdmin` passa sempre |
| `requirePerm` e `requireAction` | `src/lib/core/ctx.ts:33-39` | Lançam `PermissionError` no domínio |
| `auditedGuard` | `src/domain/roles.ts:150-159` | Registra a tentativa negada antes de lançar o erro |
| `requireSession(módulo, op)` | `src/lib/server/session.ts:90-96` | Páginas |
| `runAction({ module, op, requireBranch })` | `src/lib/server/action.ts:16-53` | Server actions. Registra `*.denied` (`:21-26, 36-45`) |
| `requireApiSession()` + `can` / `canDo` | `src/lib/server/session.ts:104-110` | Rotas de API |

### 4.7 Onde cada camada confere

- **Menu:**
  - cada item de `nav.ts` declara `module`, `action`, `anyAction` ou `feature` (`src/components/shell/nav.ts:3-14`);
  - o filtro do layout usa `can(módulo, "view")` e `canDo(ação)` (`src/app/(app)/layout.tsx:12-13`);
  - há menus diferentes por tipo de empresa (`nav.ts:280-283`).
- **Páginas:** são 204 `page.tsx` em `src/app/(app)`.
  - 145 chamam `requireSession("<módulo>")` diretamente.
  - 3 chamam sem módulo: `conta/seguranca`, `caixa/recebimentos/[id]` e `financeiro/receber/[id]/carne`.
  - 56 usam guardas próprias ou só redirecionam:
    - `requireFirmSession` (`src/app/(app)/contabil/guard.ts:11-15`);
    - `requireNetworkSession`, que exige só `dashboard` e o recurso ligado (`src/app/(app)/rede/shared.tsx:14-18`);
    - `ecomStorePage` e `DocumentsList`.
  - Depois disso, muitas páginas fazem a própria conferência de operação com `canDo` e redirecionamento, por exemplo `src/app/(app)/administracao/usuarios/novo/page.tsx:11-12` e `src/app/(app)/administracao/certificacao/page.tsx:52-53`.
- **Server actions:** são 395 chamadas de `runAction` em 53 arquivos.
  - 386 declaram o módulo, como literal ou por variável (por exemplo, `src/app/(app)/comercio-digital/actions.ts:43`).
  - 9 não declaram e dependem do domínio:
    - `conta/seguranca/actions.ts:12-31`;
    - `produtos/actions.ts:211, 227`;
    - depósitos em `administracao/empresas/actions.ts:86-106`.
  - Algumas operações especiais são conferidas na ação, não no domínio. Exemplos: `requireAction(..., "finance.reverse")` em `src/app/(app)/financeiro/actions.ts:189`, enquanto `src/domain/finance.ts` não confere nada.
- **Domínio:** `requirePerm` aparece 164 vezes em 48 arquivos e `requireAction` 137 vezes em 51 arquivos de `src/domain`.
- **APIs:**
  - `/api/search` confere por entidade (`src/app/api/search/route.ts:21-77`);
  - `/api/export/[key]` exige o módulo e `data.export` (`:19`);
  - `/api/pdv/*` exige `pdv`;
  - `/api/files/[id]` aplica `fileAccessDenial` (`src/app/api/files/[id]/route.ts:34`);
  - `/api/certificados/[id]` delega ao domínio;
  - `/api/jobs` e `/api/keepalive` exigem `CRON_SECRET`;
  - `/api/setup/run` exige `SETUP_TOKEN`.
- **Não existe uma política central** (rota → permissão) usada ao mesmo tempo pelo menu, pela página, pela ação e pela API. Cada camada repete a regra à mão. Exemplos de divergência:
  - o item "Precificação após a entrada" exige `purchases` e `purchase.pricing` (`nav.ts:107`), mas a página também exige `products/view` (`src/app/(app)/compras/precificacao/page.tsx:24`): o item aparece no menu e leva a `/sem-permissao`;
  - a página "Comissões" nega com `notFound()` (`src/app/(app)/vendas/comissoes/page.tsx:34`), enquanto as outras redirecionam para `/sem-permissao` (`src/app/(app)/sem-permissao/page.tsx:9`).

### 4.8 Cargo, perfil e filial

- **Perfil:** `roles`, por empresa, ligado ao usuário por `roleByCompany`.
- **Filial:** `branchIds`, por usuário, numa lista só para todas as empresas.
- **Cargo:** não existe esse campo. O nome do perfil faz esse papel. Alguns conceitos de função ficam em outras estruturas:
  - responsável da filial: `branches.managerUserId` (`schema.ts:89`);
  - departamentos e atribuições do escritório (`src/domain/accounting/team.ts:10-16`);
  - vendedor: `loginDisabled` e comissão (`src/domain/sellers.ts:14`).
- **Limite de desconto:** fica no perfil, mas pode ser substituído por um limite próprio do usuário, que vale em todas as empresas (`src/lib/auth/users.ts:64`).

### 4.9 Escopo dos dados

- **Empresa:** é sempre a empresa ativa (`ScopedStore`). Para ler outra empresa só há caminhos explícitos: `ctxForCompany`, `readOnly` e `unscoped`.
- **Filial:**
  - restrição por usuário (`branchIds`);
  - o consolidado é só consulta e só para quem acessa todas as filiais (`src/lib/server/session.ts:50-51`);
  - algumas regras de domínio conferem a filial, por exemplo `src/domain/goals.ts:61`, `src/domain/commissions.ts:143` e `src/domain/fiscal/files/sintegra.ts:379`.
- **Registros próprios:** existem **só** em dois lugares:
  - carteira do escritório (`accounting.all_clients`, `src/domain/accounting/team.ts:20-36`);
  - vendas da rede (`network.sales_all`, `src/domain/network/sales.ts:33, 55`).
  - No varejo não há "vê só as próprias vendas".
- **Não existe um atributo de escopo no perfil** (própria filial, empresa ou próprios registros).

### 4.10 Quando uma mudança de permissão passa a valer

- `getSession` recalcula usuário e perfil a cada requisição (`src/lib/server/session.ts:31-82`).
- Os perfis (`roles`) ficam numa **memória de 15 s em cada instância** (`src/lib/db/read-cache.ts:15-16`). A gravação limpa só a memória da instância que gravou.
- Mensagem na tela: "As permissões valem a partir da próxima ação de cada usuário" (`src/app/(app)/administracao/usuarios/actions.ts:104`).

---

## 5. Telas de administração existentes

### 5.1 Administração › Usuários e permissões (`src/app/(app)/administracao/usuarios/**`)

| Capacidade | Existe? | Onde | Observações |
|---|---|---|---|
| Listar com indicadores e filtros | Sim | `page.tsx:23-123` | Exige só `admin/view`. O perfil Gerente, que tem `admin` em consulta, vê todos os usuários. A lista inclui os administradores gerais (`queries.ts:11-48`) |
| Convidar ou criar com senha inicial | Sim | `novo/page.tsx:10-19`; `user-form.tsx:93-113`; `actions.ts:36-55` | Exige `admin/create` e `admin.users` |
| Editar dados, perfil desta empresa, empresas, filiais e limite | Sim | `[id]/editar/page.tsx:11-31`; `user-form.tsx` | O perfil escolhido vale só na empresa em uso (`user-form.tsx:130-147`). O checkbox de administrador geral fica desabilitado para quem não é `isAdmin` (`user-form.tsx:136-145`) |
| Atribuir filiais | Sim | `user-form.tsx:163-209` | Lista única para todas as empresas (§2.4) |
| Reenviar convite | Sim | `invite-link.tsx:51-81`; `actions.ts:64-69` | Gera um link novo e invalida o anterior |
| Cancelar convite | Sim | `[id]/page.tsx:82`; `actions.ts:71-76` | — |
| Iniciar recuperação (enviar link ao usuário) | **Não** | — | Só "Definir nova senha" (`[id]/page.tsx:74`; `password-dialog.tsx`) |
| Suspender (com motivo), inativar e reativar | Sim | `[id]/page.tsx:75-81`; `actions.ts:57-62` | Encerra as sessões |
| Revogar sessões | **Não** de forma explícita | — | Só como efeito colateral (§1.5) |
| Redefinir duas etapas | Sim | `[id]/page.tsx:83`; `actions.ts:89-94` | Exige motivo |
| Ver permissões efetivas, atividades e histórico | Sim | `[id]/page.tsx:101-192` | — |
| Exportar | Sim | `page.tsx:108` (`exportKey="admin.users"`) | Exige `data.export` |
| Impedir que a empresa fique sem administrador | **Só para o administrador geral** | `src/domain/users.ts:88-101, 407-416, 456, 466-469` | Conta só usuários `isAdmin` ativos da instalação |
| Impedir conceder acesso acima do próprio | **Só para `isAdmin`** | `users.ts:186, 408` | Qualquer perfil ativo da empresa pode ser atribuído por quem tem `admin.users`, inclusive o "Administrador" |
| Editor que administra só parte das empresas do usuário | Sim | `users.ts:115-168, 317-383`; aviso em `[id]/page.tsx:87-93` | Senha, situação, convite, e-mail, login e limite exigem administrar usuários em todas as empresas do usuário |
| Autoproteção | Sim | `users.ts:375-382, 449, 538` | Ninguém altera o próprio vínculo, perfil, limite, situação ou duas etapas por aqui |
| Não administrador gerindo administrador geral | Bloqueado | `users.ts:107-113`; `[id]/editar/page.tsx:18` | — |

### 5.2 Perfis (`.../usuarios/perfis/**`)

| Capacidade | Existe? | Onde | Observações |
|---|---|---|---|
| Listar com cobertura e número de usuários | Sim | `perfis/page.tsx:19-49`; `queries.ts:50-54` | — |
| Criar, editar, duplicar e excluir | Sim | `role-form.tsx:14-179`; `actions.ts:98-120`; `src/domain/roles.ts:212-286` | Exclusão só de perfil que não é de sistema e não tem usuários (`roles.ts:281-283`). Desativação recusada se houver usuários ativos ou convidados (`roles.ts:260-263`) |
| Exigir duas etapas por perfil | Sim | `role-form.tsx:74-80` | — |
| Motivo da alteração e auditoria com antes e depois | Sim | `role-form.tsx:160-164`; `roles.ts:269-273` | — |
| Mostrar os afetados antes de salvar | **Em parte** | `role-form.tsx:168` (só a contagem); aba "Usuários" em `perfis/[id]/page.tsx:66-88` | Não há confirmação com a lista nem prévia da diferença |
| Restringir as operações conforme o tipo de empresa ou o alcance do editor | **Não** | `role-options.ts:4-9` (todas as 60 operações); `roles.ts:84-87, 253-275` | Quem tem `admin/edit` e `admin.users` pode editar **qualquer** perfil da empresa, **inclusive o próprio**, e incluir `network.manage` ou `certification.operate`, que dão alcance sobre outras empresas (§2.5) |

### 5.3 Administração › Empresas e filiais (`src/app/(app)/administracao/empresas/**`)

| Capacidade | Onde | Observações |
|---|---|---|
| Listar empresas acessíveis e filiais | `page.tsx:21-154`; `queries.ts:10-76` | — |
| Nova empresa | `nova/page.tsx:9`; `actions.ts:20-34`; `src/domain/companies.ts:139-168` | Exige **só** `admin/create` na empresa em uso (`companies.ts:140`). Quem cria fica vinculado com o perfil Administrador da empresa nova (`companies.ts:157-164`) |
| Editar empresa e inativar/reativar | `[id]/page.tsx:46-75`; `companies.ts:196-228` | Não inativa a empresa em uso nem empresa com caixa aberto (`companies.ts:221-223`) |
| Nova filial, editar e inativar | `companies.ts:267-352` | A empresa precisa manter ao menos uma filial ativa (`companies.ts:346-347`) |
| Vincular e desvincular usuários da empresa | `[id]/page.tsx:167-178`; `forms.tsx:158-201`; `companies.ts:359-414` | Exige `admin/edit` e `admin.users` na empresa-alvo. Mostra os usuários que têm alguma empresa em comum com o editor (`companies.ts:364`). Recusa deixar um usuário ativo sem empresa (`:379-382`). Avisa quem fica sem perfil equivalente. **Não permite convidar uma pessoa que já existe em outra empresa** sem empresa em comum |
| Administrar outra empresa | `access.ts:15-32`; `companies.ts:175-194` | Perfil de administração na empresa em uso **e** na empresa-alvo |

### 5.4 Minha conta › Segurança

Página de duas etapas pelo próprio usuário (`src/app/(app)/conta/seguranca/page.tsx`), aberta pelo menu do usuário (`src/components/shell/user-menu.tsx:28`). Nessa página **não há troca de senha**.

---

## 6. Credenciais de demonstração

### 6.1 Onde ficam

| Item | Onde |
|---|---|
| `SHOW_DEMO_LOGIN=1` liga o acesso rápido e as proteções (`quickAccessPinned`) | `src/lib/auth/quick-access.ts:51-54` |
| Acesso rápido sempre ligado na demonstração em memória, mas sem proteções | `quick-access.ts:56-59` |
| Decisão do titular: o acesso rápido fica ligado em produção até ele mandar tirar | `quick-access.ts:3-14`; `README.md:21`; `docs/regras-assumidas.md:1052`; `docs/progresso.md:59` |
| Padrão do arquivo de exemplo: `SHOW_DEMO_LOGIN=0` | `.env.example:31-33` |
| `DEMO_PASSWORD`, com **valor padrão fixo no código** (o mesmo literal em vários lugares) | `src/domain/seed/base.ts:18`; `src/app/(auth)/login/page.tsx:50`; `src/domain/users.ts:516`; `src/app/actions/setup.ts:59`; `.env.example:30` |
| Lista fixa de 21 logins (`DEMO_DIRECTORY`), também usada como reserva quando o banco não responde | `quick-access.ts:21-46`; `src/app/(auth)/login/access.ts:12-14, 69` |
| Lista mostrada: usuários com `isDemo`, ativos, com credencial, sem `loginDisabled` e sem `isAdmin` | `src/app/(auth)/login/access.ts:16-31` |
| O botão envia login e senha em campos ocultos do HTML | `src/app/(auth)/login/quick-access.tsx:60-64` |
| Marca de demonstração: `users.isDemo` e `companies.isDemo` | `schema.ts:76, 100` |

### 6.2 Usuários semeados

| Login | Empresa / perfil | Poderes relevantes | Onde |
|---|---|---|---|
| `admin`, `gerente`, `diretoria`, `caixa`, `estoque`, `financeiro`, `fiscal` | Loja de demonstração / perfis de varejo. `caixa` e `estoque` têm restrição de filial | `admin` tem `admin.users` e `admin/create`, e portanto **pode criar empresas novas** (`src/domain/companies.ts:140`) | `src/domain/seed/base.ts:116-142` |
| `vendedora` | Loja de demonstração / perfil Caixa, filial Matriz, comissão de 2,5% | — | `src/domain/seed/modules/commissions.ts:22-29` |
| `contador`, `analista` | Escritório de demonstração / Sócio-Administrador e Analista | — | `src/domain/seed/modules/accounting.ts:33-38` |
| `certificacao` | Escritório / perfil com `certification.operate` | Fila de certificados de **todas** as empresas (`src/domain/accounting/certificates.ts:836-852`) | `src/domain/seed/modules/certificates.ts:41-44` |
| `rede` | Empresa da plataforma de demonstração / perfil com `network.manage` e `certification.operate` | **Plataforma da rede**: vê e gere todos os nós e cadastra parceiros, criando empresa e convite (`src/domain/network/nodes.ts:58-60, 71-130`) | `src/domain/seed/modules/network.ts:107-117` |
| `master`, `regional.*`, `revenda.*`, `vendedor.*` | Parceiros de demonstração / Administrador do parceiro e Vendedor | `admin.users`, `network.children`, `network.prices` | `src/domain/seed/modules/network.ts:55-60, 124-146` |
| `paula.prado` | Loja / convite pendente | — | `src/domain/seed/modules/admin.ts:45-56` |

A demonstração é carregada por `/primeiro-acesso` (`src/app/(auth)/primeiro-acesso/form.tsx:87-97`), por `/api/setup/run?step=demo|demo-update` (`src/app/api/setup/run/route.ts:134-152`; `demo-update` continua funcionando depois de `finish`) ou automaticamente no backend em memória (`src/lib/server/bootstrap.ts:11-24`).

### 6.3 Proteções e o que elas não cobrem

- As proteções de §3.9 impedem que um visitante **tranque** o acesso: inativar, trocar a senha, cadastrar duas etapas ou bloquear por tentativas (`tests/quick-access-pin.test.ts`).
- Elas **não limitam o que esses usuários fazem**. As operações de plataforma (`network.manage`, `certification.operate`) não filtram `isDemo`, conforme `src/domain/network/common.ts:149-151, 163-169` e `src/domain/accounting/certificates.ts:836-852`. Assim, com a senha pública, um visitante tem esse alcance sobre todos os nós da rede e todas as solicitações de certificado da instalação. Com o usuário `admin`, consegue criar empresas.
- `isQuickAccessUser` só protege logins que estão na lista fixa. A tela, porém, lista qualquer usuário `isDemo` ativo, sem conferir a lista. Um usuário de demonstração fora dela apareceria no acesso rápido sem as travas (`src/app/(auth)/login/access.ts:18`; `quick-access.ts:65-67`). Hoje o teste exige que a lista e a demonstração coincidam (`quick-access.ts:17-20`).

---

## 7. Lacunas em relação aos objetivos

### 7.1 Requisitos pedidos

| Requisito | Estado atual | Lacuna |
|---|---|---|
| **Convidar** | Sim, por link com validade (§3.2) | O e-mail é único na **instalação**: não dá para convidar uma pessoa que já é usuária de outra empresa. A mensagem de duplicidade revela o nome dela (`src/domain/users.ts:187-188`). O link depende do canal de e-mail da empresa ou é mostrado ao administrador |
| **Configurar perfis** | Sim: matriz, 60 operações, desconto, duas etapas (§4) | Não há filtro de operações por tipo de empresa nem por alcance do editor (`role-options.ts:4-9`). Os modelos de sistema mudam sozinhos em todas as empresas (`role-sync.ts`). Não há versões nem como desfazer, só o histórico |
| **Atribuir filiais** | Sim (`branchIds`) | A lista é única para todas as empresas do usuário (`src/domain/users.ts:32-35`). Não existe filial por empresa nem escopo por perfil |
| **Reenviar convites** | Sim (`resendInvite`) | — |
| **Iniciar recuperação** (pelo administrador) | **Não**: só "Definir nova senha" (`src/domain/users.ts:509-528`) | O administrador conhece a senha. Não há envio de link pelo administrador nem troca obrigatória depois |
| **Suspender** | Sim, com motivo e encerramento de sessões (`users.ts:446-479`) | O motivo aparece a quem digitar o login, sem precisar da senha (`src/app/actions/session.ts:75-78`) |
| **Revogar sessões** | **Não** de forma explícita (§1.5) | Não há lista de sessões. `userAgent` e `ip` não são preenchidos. Sessões vencidas não são apagadas. A recuperação de senha não encerra as sessões |
| **Senha por link de uso único com expiração** | Convite com hash e validade de 1 a 30 dias. Recuperação de 1 h, uso único | A senha inicial definida pelo administrador e a redefinição pelo administrador não usam link. O segredo da recuperação vai na URL (`provider.ts:85`). O endereço do link vem dos cabeçalhos da requisição (`src/app/actions/session.ts:228`). A recuperação não é auditada nem confere a situação do usuário. A regra de senha é só o mínimo de 8 caracteres. Não há troca de senha pelo próprio usuário logado |
| **Permissões por módulo, tela e ação** (consultar, criar, editar, aprovar, cancelar, exportar) | Módulo × CRUD mais operações especiais | Não há permissão por tela. "Exportar" é uma operação global (`data.export`). Aprovar e cancelar estão espalhados em operações de cada domínio. "Excluir" significa coisas diferentes conforme o módulo |
| **Escopo de dados** | Empresa (`ScopedStore`), filial por usuário e registros próprios só no escritório e na rede (§4.9) | Não existe escopo no perfil (própria filial, empresa ou próprios registros) nem nas consultas do varejo |
| **Mesma autorização em menu, rota e API** | Conferências repetidas em cada camada (§4.7) | Não há política central. Já há divergências (precificação; `notFound` × `/sem-permissao`). Páginas da rede exigem só `dashboard` e confiam no domínio |
| **Mostrar afetados antes de salvar perfil compartilhado** | Só a contagem (`role-form.tsx:168`) e a aba "Usuários" | Não há confirmação com a lista nem prévia da diferença antes de gravar |
| **Impedir conceder acesso fora do escopo** | Só `isAdmin` é protegido (`users.ts:186, 408`). O alcance por empresas é conferido (`users.ts:140-147`) | Qualquer perfil pode ser atribuído. Qualquer perfil pode ser editado, inclusive o próprio, incluindo operações de plataforma com alcance sobre outras empresas (`src/domain/network/common.ts:61-64`; `src/domain/accounting/certificates.ts:836-852`) |
| **Impedir ficar sem administrador ativo** | Só para o administrador geral, com conferência sob concorrência (`users.ts:88-101, 407-416, 466-469`) | Nada impede uma empresa de ficar sem nenhum usuário ativo com `admin.users`, seja editando o perfil "Administrador", seja suspendendo ou desvinculando quem o tem. Segundo a documentação, a produção não tem administrador geral (`docs/pendencias-externas.md:7`) |

### 7.2 Outras lacunas de identidade para várias empresas contratantes

1. **Identidade global sem dono.** `users` não tem `companyId`, fica fora do `ScopedStore` (`src/lib/db/scoped-store.ts:20-22`) e é lida sem filtro em vários pontos:
   - `src/lib/server/lookups.ts:41-44`;
   - `src/domain/companies.ts:364`;
   - `src/app/(app)/administracao/empresas/queries.ts:17`.
2. **A equipe da plataforma aparece para o cliente.** Os administradores gerais entram na lista de usuários, nos seletores e nos vínculos de todas as empresas:
   - `src/domain/users.ts:83-86`;
   - `src/lib/server/lookups.ts:31-37`;
   - `src/app/(app)/administracao/empresas/[id]/page.tsx:37`.
3. **Os poderes de plataforma vêm de operações de perfil de empresa** (`network.manage`, `certification.operate`), e não de uma identidade de plataforma separada (`src/domain/network/common.ts:61-64`).
4. **Qualquer "Administrador" de empresa cria empresas novas** na instalação (`src/domain/companies.ts:139-164`).
5. **O administrador geral não pode ser obrigado a usar as duas etapas** (`src/domain/two-factor.ts:62`; `src/lib/auth/users.ts:67`).
6. **Proteção contra força bruta.** O limite é só por conta. Um terceiro consegue bloquear uma conta (§1.6). As verificações de senha fora do login (supervisor, certificado, desativar duas etapas) ignoram o contador. Há meios de descobrir se uma conta existe (§1.6).
7. **Troca de e-mail** sem confirmação, sem aviso e sem encerrar as sessões (§3.7).
8. **Auditoria incompleta.** Logout, recuperação e troca de unidade não são registrados. As tentativas de login ficam na primeira empresa do usuário (§3.10).
9. **Provisionamento externo inexistente.** As únicas automações são de instalação, protegidas por `SETUP_TOKEN`:
   - a etapa `owner` cria um **administrador geral**, com a senha devolvida na resposta (`src/app/api/setup/run/route.ts:181-196`);
   - `check-login` recebe a senha **na URL** (`route.ts:164-179`);
   - `diagnostico` e `demo-update` continuam disponíveis depois de `finish` (`route.ts:5-13, 132-144`).

   Criar empresa e administrador só é possível pelas telas (`createCompany`, `createNode`). Não há API com credencial de integração para criar o contratante, convidar o primeiro administrador ou suspender o contratante.
10. **A suspensão de um parceiro da rede não bloqueia os usuários da empresa dele.** O nó muda de situação (`src/domain/network/nodes.ts:206-228`), mas `getSession` só confere usuário, empresa e filial (`src/lib/server/session.ts:40-48`). Também não existe suspensão de contratante além de inativar a empresa (`src/domain/companies.ts:217-228`).
11. **Tempo de propagação.** A alteração de perfil leva até 15 s para valer em cada instância (`src/lib/db/read-cache.ts:15-16`). No legado Appwrite, a revogação leva até 60 s (`src/lib/auth/provider.ts:148-158`).

---

## 8. Testes existentes relacionados

| Arquivo | O que cobre |
|---|---|
| `tests/admin.test.ts:38-172` | Matriz e operações especiais; perfis de sistema; convite, primeiro acesso e login; reenvio, cancelamento e convite vencido; suspensão; último administrador; autoproteção |
| `tests/admin-access.test.ts:70-374` | Administração de outra empresa; editor que administra só parte das empresas; perfil por empresa; `setCompanyUsers`; último administrador sob concorrência; `next`; unidades inativas; sincronização de modelos |
| `tests/admin-round2.test.ts:78-240` | Editor parcial e senha, situação ou convite; preservação de filiais e limite; `requireApiSession` com 409; pacote contábil com `data.export`; perfil equivalente |
| `tests/round3-admin-painel.test.ts:39-127` | Restrição de filiais única para todas as empresas |
| `tests/ajustes-telas.test.ts`, `tests/role-sync.test.ts` | Duas etapas (TOTP, cifra, recuperação, bloqueio, redefinição, perfil que exige) e sincronização de perfis (`docs/regras-assumidas.md:959`) |
| `tests/quick-access-pin.test.ts:69-170` | Proteções do acesso rápido, com contraprova |
| `tests/login-screen.test.ts` | Tela de login com o banco fora do ar, mensagens e lista de reserva (`docs/regras-assumidas.md:1061`) |
| `tests/scoped-store.test.ts` | Isolamento do `ScopedStore` |
| `tests/network.test.ts`, `tests/certificates.test.ts`, `tests/accounting.test.ts` | Visibilidade da rede, equipe de certificação e vínculo do escritório |

## 9. Regras documentadas consultadas

- `docs/regras-assumidas.md`:
  - §10 Acesso (`:77-80`);
  - §11 Isolamento (`:83-88`);
  - §17 Administração (`:148-155`);
  - administração e acesso (`:209-220`);
  - §43 rede (`:911-931`);
  - §44 duas etapas (`:933-961`);
  - §47 acesso rápido (`:1038-1063`);
  - §48 login próprio (`:1065-1118`).
- `README.md:21, 39, 63, 72-73`.
- `docs/pendencias-externas.md:7`.
