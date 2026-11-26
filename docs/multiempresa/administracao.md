# Administração de usuários pela empresa contratante

Cada empresa contratante administra os próprios usuários, dentro da própria empresa, sem enxergar as outras. Este documento descreve o que o administrador do cliente pode fazer, as regras que valem e as proteções. O estado anterior e as lacunas estão em `mapeamento/02-identidade-e-permissoes.md` (§7).

Código principal: `src/domain/users.ts`, `src/domain/roles.ts`, `src/lib/auth/provider.ts` (conclusão da recuperação), `src/lib/server/lookups.ts` e as telas em `src/app/(app)/administracao/usuarios/**` e `src/app/(app)/conta/seguranca/**`. Testes: `tests/admin-multiempresa.test.ts`.

---

## 1. Quem é quem

| Papel | Definição | Observação |
|---|---|---|
| **Administrador da empresa** | Usuário **ativo**, **vinculado** à empresa, cujo perfil **naquela empresa** tem Administração › Editar e a operação “Gerenciar usuários e perfis” (`admin.users`), com o perfil ativo | `companyAdmins` em `roles.ts`. É quem administra os usuários da empresa |
| **Administrador da plataforma** | `users.isAdmin` (equipe Intercert) | Enxerga todas as empresas e ignora a matriz. **Não conta** como administrador da empresa e **não aparece** nas listas e seletores da empresa contratante |
| **Quem é da plataforma** | O administrador da plataforma ou quem trabalha na empresa da plataforma (`companies.isPlatform`) | Só esses veem o administrador da plataforma nas listas (`seesPlatformAdmins`) |

Tudo o que o administrador da empresa faz vale **na empresa em uso** (a escolhida no seletor de unidade). Os dados da pessoa que valem em todas as empresas dela (senha, situação, e-mail e login, limite de desconto, convite, sessões) seguem as regras de §3.8.

## 2. O que o administrador da empresa pode fazer

| Ação | Onde | Regras principais |
|---|---|---|
| Listar e filtrar usuários | Administração › Usuários | Só os vinculados à empresa. Colunas de cargo, perfil e filiais **desta** empresa. O filtro “Administradores da empresa” mostra quem administra usuários aqui |
| Convidar ou criar com senha inicial | Usuários › Novo | Perfil só dentro do próprio escopo (§3.2); filiais só da empresa e, para quem é restrito a filiais, só dentre as dele (§3.6) |
| Editar dados, **cargo**, perfil e filiais desta empresa | Usuário › Editar | O cargo e as filiais valem por empresa (§3.5 e §3.6). Os vínculos com empresas fora do alcance do editor são preservados |
| Vincular a outra empresa | Usuário › Editar (Empresas) | Só às empresas em que o editor também administra usuários; o perfil equivalente lá também precisa estar no alcance dele naquela empresa |
| **Encerrar sessões** | Usuário › Senha e sessões | Todas as sessões da pessoa, em todos os dispositivos (§3.7) |
| **Enviar link de recuperação** | Usuário › Senha e sessões | Link de uso único com validade; por e-mail quando há canal, senão aparece ao administrador (§3.9) |
| Definir nova senha | Usuário › Definir nova senha | Fluxo anterior, mantido |
| Reenviar ou cancelar convite | Usuário › Convite | Fluxo anterior, mantido |
| Suspender, inativar, reativar | Usuário | Protegido pelo último administrador da empresa (§3.3) |
| Redefinir duas etapas | Usuário | Fluxo anterior, mantido |
| Criar, editar, duplicar e excluir perfis | Usuários › Perfis | Só concede o que o editor tem (`assertGrantable`); ao alterar um perfil usado por pessoas, mostra o impacto e exige confirmação (§3.4); protegido pelo último administrador (§3.3) |
| Encerrar as **outras** sessões da própria conta | Minha conta › Segurança | Qualquer usuário; a sessão atual continua aberta (§3.7) |

## 3. Regras

### 3.1 Isolamento entre empresas

- A camada de dados (Store com escopo) só alcança os usuários vinculados à empresa em uso. Usuário só de outra empresa é tratado como inexistente: não é listado, alterado, suspenso, não tem sessões encerradas nem recebe link de recuperação ou convite a partir desta empresa.
- Listas e seletores de usuários (tela de usuários, indicadores, exportação, `lookups.users` e `lookups.sellers`) mostram só os vinculados à empresa. O administrador da plataforma só aparece para quem é da plataforma.
- A página de um usuário que não é desta empresa, ou do administrador da plataforma para quem não é da plataforma, responde “não encontrado”.
- Perfil de outra empresa nunca é atribuído (“Perfil de outra empresa”).
- As mensagens de erro não nomeiam empresas a que o editor não tem acesso: aparecem como “outra empresa do ERP”. A página do usuário mostra só os nomes das empresas a que o editor tem acesso e conta as demais (“+ N empresa(s) fora do seu acesso”).

### 3.2 Perfil só dentro do próprio escopo

- Quem não é o administrador da plataforma só **atribui** um perfil cujas permissões (módulo × operação) e operações específicas ele mesmo tem na empresa. É a regra de `assertGrantable`, aplicada ao perfil inteiro (`assertAssignable`). Operações da plataforma num perfil de empresa comum e módulos fora do contrato não contam, porque lá não têm efeito.
- **Trocar o perfil de quem já tem acesso maior** que o do editor também é recusado, mesmo que o perfil novo seja menor. Editar os outros dados dessa pessoa continua permitido.
- Ao vincular a pessoa a outra empresa, o perfil equivalente lá também precisa estar dentro do acesso do editor **naquela** empresa.
- Na tela, os perfis acima do acesso do editor aparecem desabilitados (“acima do seu acesso”), e o seletor de perfil fica travado quando o perfil atual da pessoa vai além do do editor.
- **Assumir a conta de quem tem acesso maior** também é recusado. Isso vale para definir a senha, iniciar a recuperação (o link pode voltar ao editor quando não há canal de e-mail), trocar o e-mail ou o login (e-mail novo seguido de “Esqueci minha senha”) e redefinir as duas etapas. Em **cada** empresa da pessoa, o perfil dela precisa caber no acesso do editor naquela empresa (`assertCanTakeOver`). Quem tem o acesso necessário, como o administrador da empresa, continua podendo.
- Código do erro: `forbidden`. A mensagem lista o que está fora do perfil do editor.

### 3.3 Último administrador por empresa

- A empresa precisa manter **ao menos um administrador da empresa ativo** (§1). O administrador da plataforma não conta, nem o vendedor sem acesso.
- São bloqueados, com o código **`last_company_admin`** e uma mensagem que diz quem é o último administrador e o que fazer:
  - suspender ou inativar (a situação vale em todas as empresas da pessoa, então cada uma delas é conferida);
  - trocar o perfil da pessoa na empresa por um que não administra usuários;
  - desvincular a pessoa de uma empresa em que ela é a última administradora;
  - tornar a pessoa administradora da plataforma (ela deixaria de contar);
  - retirar de um perfil Administração › Editar ou “Gerenciar usuários e perfis”, desativar o perfil ou excluí-lo, quando ele é o que mantém os últimos administradores.
- Empresa que já não tinha administrador próprio (por exemplo, administrada só pela plataforma) não é travada por isso: a regra impede **perder** o último, não exige criar um.
- Concorrência: depois de gravar, a conferência é refeita; se duas operações simultâneas tiverem deixado a empresa sem administrador, a alteração é desfeita e recusada (como já acontecia com o administrador da plataforma).
- Para desvincular pela tela Empresas › Usuários (`setCompanyUsers`), há o auxiliar `assertCompanyKeepsAdmin(ctx, empresa, idsRemovidos)` em `users.ts` (ver §6).

### 3.4 Impacto antes de salvar um perfil compartilhado

- Ao salvar um perfil existente, a tela calcula o impacto (`roleChangeImpact`): a **lista das pessoas afetadas** (nome, e-mail e situação, em qualquer situação) e a **diferença das permissões** (`roleDiff`: antes e depois de cada item).
- Se há pessoas no perfil e algo muda, a tela abre a confirmação com a lista e a diferença. Só salva depois de marcar “Revisei as pessoas afetadas e as mudanças” e confirmar.
- O servidor exige a confirmação **do impacto exato**: a ação recebe um identificador (`confirmImpact`) que resume as pessoas e a diferença. Sem ele, a ação recusa salvar (código `impact_confirmation`). Se outra pessoa entrar no perfil ou a diferença mudar depois da confirmação, é preciso confirmar de novo.
- Perfil sem pessoas, ou alteração que não muda nada, salva sem confirmação.

### 3.5 Cargo

- O **cargo** é a função da pessoa na empresa (por exemplo, “Gerente de loja”). Ele é separado do perfil, que dá as permissões, e das filiais, que dão o alcance.
- Fica em `users.jobTitleByCompany[empresa]` e vale só na empresa em uso. Cada empresa define o cargo dela. Desvincular a pessoa apaga o cargo daquela empresa. Limite de 80 caracteres.
- Aparece na lista de usuários (coluna “Cargo”, também na busca) e na página do usuário.
- Quem não é o administrador da plataforma não altera o próprio cargo, como já acontecia com o próprio perfil, vínculo e limite.

### 3.6 Filiais por empresa

- O formulário edita só as filiais **da empresa em uso**: “Todas as filiais desta empresa” (grava `[]`) ou “Somente as filiais marcadas” (ao menos uma). Grava em `users.branchIdsByCompany[empresa]`. As filiais das outras empresas da pessoa não mudam.
- A sessão usa `branchScopeOf(usuário, empresa)`: a atribuição por empresa vale primeiro; sem ela, vale a lista antiga `branchIds`.
- Filial de outra empresa é recusada sem ser nomeada (“Filial inválida: o cadastro só atribui filiais da empresa em uso”).
- **Editor restrito a filiais** (o perfil dele na empresa não acessa todas):
  - só concede filiais dentre as dele;
  - não libera “todas as filiais” para ninguém;
  - não restringe quem já acessa todas, porque isso mexeria em filiais fora do alcance dele;
  - as filiais da pessoa fora do alcance dele são mantidas ao salvar;
  - ao vincular a pessoa a outra empresa, ela recebe lá as filiais que o editor acessa (todas, se ele acessa todas).
- Chamadas antigas que ainda mandam só `branchIds` continuam funcionando como antes (modo legado), com a mesma proteção do editor restrito. Quando a lista legada muda, as atribuições por empresa das empresas ao alcance do editor são retiradas, e a lista legada volta a valer nelas.

### 3.7 Sessões

- **Pelo administrador** (`revokeUserSessions`): grava `sessionsValidAfter` = agora e apaga as linhas de `sessions` da pessoa. Qualquer sessão criada antes disso deixa de valer (`LocalAuth.verify`), inclusive uma que estivesse em andamento. A sessão é da pessoa, então o encerramento vale em todos os dispositivos e em todas as empresas dela. O administrador não encerra as próprias sessões por essa tela.
- **Pelo próprio usuário**, em Minha conta › Segurança (`revokeOtherSessions`): encerra as **outras** sessões e mantém a atual, identificada pelo cookie da requisição.
- A página do usuário mostra quantas sessões estão abertas e quando foram encerradas pela última vez.

### 3.8 Dados que valem em todas as empresas da pessoa

Senha (inclusive o link de recuperação), situação, convite, e-mail e login e limite de desconto valem em todas as empresas da pessoa. Por isso, quem não é o administrador da plataforma só os altera se administra usuários em **todas** as empresas dela. Encerrar sessões é a exceção: o administrador de qualquer empresa da pessoa pode encerrá-las, porque é uma proteção (ela só precisa entrar de novo) e a sessão dá acesso também aos dados da empresa dele.

### 3.9 Recuperação de senha iniciada pelo administrador

- Usa o mesmo mecanismo de “Esqueci minha senha”: `resetTokenHash` (só o hash do segredo é gravado) e a tela `/redefinir-senha`.
- O link vale **uma única vez** e expira em **24 horas** (`ADMIN_RECOVERY_HOURS`). Gerar outro invalida o anterior. Suspender ou inativar a pessoa também invalida o link pendente.
- Vai pelo canal de e-mail da empresa em uso. Sem canal, o link aparece **uma única vez** ao administrador, para ser entregue por um canal seguro, como no convite.
- A senha atual continua valendo até a nova ser definida. **Ao concluir** (`completeRecovery`), as sessões anteriores deixam de valer (`sessionsValidAfter` + linhas apagadas). Isso vale também para a recuperação pedida pelo próprio usuário.
- Só para usuário ativo. Convite pendente usa “Reenviar convite”. Ninguém inicia a recuperação da própria senha por aqui.
- Auditado como `user.recovery_start` (início) e `user.recovery_complete` (nova senha definida pelo link, registrada em cada empresa da pessoa). O segredo do link não vai para o histórico.

### 3.10 Privacidade

- A unicidade de e-mail e de login é conferida em **todos** os usuários da instalação, sem escopo. O Store da empresa só enxerga os vinculados a ela, então sem isso dois usuários poderiam ficar com o mesmo login.
- Quando quem já usa o e-mail ou o login **não é desta empresa** (ou é o administrador da plataforma), a mensagem não revela quem é: “E-mail já cadastrado no ERP” e “Login indisponível”. Dentro da própria empresa, a mensagem continua dizendo o nome. O cadastro de **vendedores** segue a mesma regra.

## 4. Auditoria

| Ação | Registro |
|---|---|
| Encerrar sessões (administrador) | `user.sessions_revoke`, com o motivo, se houver |
| Encerrar as outras sessões (próprio usuário) | `user.sessions_revoke_others` |
| Recuperação iniciada pelo administrador | `user.recovery_start` (resultado do envio e validade) |
| Cadastro, cargo, filiais por empresa e perfil | `user.create`, `user.invite`, `user.update` (com a diferença de campos) |
| Perfil | `role.update` (antes e depois legível e o motivo) e `role.delete` |
| Tentativa sem permissão | `*.denied` (inclusive a atribuição de perfil fora do escopo, código `forbidden`) |

## 5. Acesso rápido da demonstração

As proteções de `isQuickAccessUser` continuam valendo enquanto o acesso rápido estiver ligado. Para os usuários da lista:

- não é possível encerrar as sessões deles, nem pelo administrador nem pelo próprio usuário, porque o mesmo usuário é usado por vários visitantes e um não derruba os demais;
- não se gera link de recuperação, porque a senha é a da tela;
- continuam valendo as travas anteriores: não inativa nem suspende, não troca a senha, o e-mail ou o login, não cadastra duas etapas e não bloqueia por tentativas.

Desligado o acesso rápido, essas travas saem.

## 6. Pendências e limitações conhecidas

Resolvidas na integração (26/11/2026):
- **Desvincular por Empresas › Usuários** (`setCompanyUsers`): confere o último administrador da empresa, com a mesma
  regra e o mesmo código `last_company_admin`, e apaga o cargo e as filiais da empresa desvinculada.
- **Assumir a conta de quem tem mais acesso**: senha, recuperação, e-mail/login e duas etapas seguem a regra de §3.2.
- **Vendedores**: e-mail repetido não revela o titular de outra empresa (§3.10).
- **Exportação de usuários**: tem a coluna Cargo.
- **Conclusão da recuperação de senha**: auditada (`user.recovery_complete`).

Em aberto:
1. O nome do administrador da plataforma como autor de registros depende de `nameMap`, que lê pela lista com escopo e
   por isso não o inclui.
