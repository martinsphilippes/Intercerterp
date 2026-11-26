# Arquitetura multiempresa do Intercert ERP

> Várias empresas contratantes no mesmo produto, isoladas por completo. O Interos provisiona e acompanha essas
> empresas. Cada cliente administra os próprios usuários e continua operando no ERP como antes.
> Mapeamento que embasou as decisões: `docs/multiempresa/mapeamento/01..06`. Administração: `administracao.md`.
> Migração e ativação: `migracao.md`. Homologação: `homologacao.md`. Contrato com o Interos:
> `docs/interos/contrato-interos-erp-v1.md`.

## 1. Papéis

| Papel | O que é | Onde vive |
|---|---|---|
| **Plataforma (Intercert)** | Empresa marcada `isPlatform`. Opera a rede de certificação inteira e a equipe de certificação. Atende os chamados abertos na tela de login. | Uma única empresa da instalação |
| **Empresa contratante** | Cliente do ERP: varejo, escritório contábil ou parceiro da rede. Dona dos próprios dados, usuários, perfis e unidades. | `companies` + todos os registros com `companyId` |
| **Interos** | Sistema externo que contrata, provisiona e acompanha. Nunca acessa o banco. | Interface de serviço `/api/interos/v1` |
| **Administrador da plataforma** | `users.isAdmin`: suporte da instalação. Fica fora das listas das empresas clientes. | — |
| **Administrador da empresa** | Perfil da empresa com administração de usuários (`admin.users`) | Por empresa |

## 2. Isolamento na camada de dados (defesa em profundidade)

**Ponto único:** todo contexto de trabalho (`Ctx`) recebe um Store restrito à empresa,
`scopeStore(base, companyId, { platform })`, em `src/lib/db/scoped-store.ts`. O servidor determina a empresa e as
filiais pela sessão e pela unidade escolhida, **nunca** por parâmetro do navegador. As telas, ações, APIs, rotinas e a
interface de serviço usam esse Store.

| Operação | Regra do Store restrito |
|---|---|
| `list`/busca | Sempre `AND companyId = <empresa>` no filtro. Registros sem empresa só nas coleções globais legítimas (`roles`, `help_articles`, `fiscal_sim_state`). |
| `get` | Registro de outra empresa = inexistente. Nada revela que ele existe. |
| `create` | Injeta `companyId`; recusa `companyId` de outra empresa |
| `update`/`delete`/`increment` | Condição de dono **dentro do SQL** (`WriteGuard`, `AND "companyId" = $x`), sem leitura extra e sem janela de corrida |
| Identidades | `users`: visíveis por vínculo (`companyIds` contém a empresa). `companies`: só a própria. Chamados públicos: só para a plataforma. |
| Tabelas da plataforma | `service_requests`, `tenant_provisionings`, `company_relations`, `tenancy_reviews`, `tenancy_violations` e `migration_runs`: **nenhum** Store restrito lê ou grava nelas |

**Portas explícitas:** `unscoped(store)` existe para fluxos que atravessam empresas de propósito, com a autorização
conferida antes. Exemplos:
- vínculo entre empresas;
- leitura do escritório contábil;
- rede de certificação;
- login e seleção de unidade;
- interface de serviço.

Cada uso foi classificado no mapeamento (`01-dados-e-escopo.md`). Os novos usos seguem a mesma regra: conferir a
autorização no servidor e registrar na auditoria.

**Modos** (`MULTIEMPRESA_ISOLAMENTO`):
- **`estrito`** (padrão): bloqueia.
- **`observar`**: comportamento anterior, mas cada violação é registrada em `tenancy_violations`. Serve para ativação
  gradual.
- **`legado`**: rollback de emergência.

Ver `migracao.md`.

**Referências validadas:** ao gravar, os ids de outras coleções (cliente, produto, depósito, filial, perfil) são
lidos pelo Store restrito. Id de outra empresa = "não encontrado". Um documento nunca aponta para dado de outra
empresa.

## 3. Identidade, sessão e unidades

- **Uma pessoa, várias empresas:** `users.companyIds` traz os vínculos. Perfil, cargo e filiais são definidos **por
  empresa**:
  - `roleByCompany`;
  - `jobTitleByCompany`;
  - `branchIdsByCompany`: chave ausente = regra antiga (`branchIds`); `[]` = todas as filiais; lista = só essas.
- **Perfil efetivo** (`toCtxUser`): o perfil da empresa em uso, com os módulos fora do contrato removidos (§6) e as
  operações da plataforma removidas fora da empresa da plataforma (§4).
- **Sessão:** `sessionsValidAfter` invalida as sessões anteriores. É usado para encerrar sessões, para a senha nova
  definida pela recuperação e para a suspensão em bloqueio. Ao escolher a unidade, o servidor confere o vínculo e a
  situação da empresa (`companySelectable`).
- **Empresa suspensa em somente leitura:** o Store do contexto é envolvido por `readOnly()` e recusa toda gravação.
- **Credenciais de demonstração:** usuários `isDemo` só alcançam empresas `isDemo`. Em produção (`ERP_AMBIENTE=producao`)
  o login de demonstração é recusado (§7).

## 4. Plataforma

- `companies.isPlatform` marca a empresa da Intercert. A migração a designa quando há uma única candidata; havendo
  mais de uma, a escolha vai para revisão.
- **Operações da plataforma** (`PLATFORM_ACTIONS`: `network.manage`, `certification.operate`) só têm efeito na empresa
  da plataforma. Fora dela:
  - não podem ser concedidas (`assertGrantable`);
  - se já estiverem gravadas num perfil, são mascaradas no perfil efetivo.
- **Concessão dentro do escopo:** quem não é administrador da plataforma só concede o que ele mesmo tem. A mesma regra
  vale para assumir a conta de alguém (`administracao.md` §3.2).
- **Empresas novas** nascem pelo Interos (`POST /empresas`) ou pelo administrador da plataforma. O administrador de uma
  empresa cliente não cria outras empresas no modo estrito.
- **Notificações** destinadas às operações da plataforma vão só para a empresa da plataforma.

## 5. Vínculos explícitos entre empresas

Registro único em `company_relations` (`src/domain/tenancy/relations.ts`). Cada vínculo tem as partes, o tipo, os
**escopos nomeados**, a situação (`pendente`, `ativa`, `suspensa`, `revogada`), o consentimento e o histórico.

| Tipo | De → para | Escopos | Origem do consentimento |
|---|---|---|---|
| `contabilidade` | escritório → empresa cliente | `fiscal.leitura`, `pacote.entrega`, `certificado.acompanhamento` | O administrador da empresa aceita o código do escritório |
| `rede` | nó acima (ou a plataforma) → parceiro | `rede.vendas.leitura`, `rede.clientes.leitura`, `rede.financeiro.lancamento`, `rede.precos`, `rede.usuarios.leitura` | Credenciamento na rede (criar, mover, suspender e encerrar o nó acompanham o vínculo) |
| `certificacao` | plataforma → empresa atendida | `certificado.operacao` | Contratação do serviço |

As portas entre empresas conferem o vínculo no servidor (`requireRelation`). Exemplo: o leitor do escritório contábil
exige um vínculo `contabilidade` **ativo** com `fiscal.leitura`. Suspender ou revogar o vínculo corta o acesso na
mesma hora, sem depender de mais nada.

## 6. Contrato e módulos

`companies.contract = { modules[], reference, plan }`, definido pelo Interos (`src/domain/tenancy/contract.ts`).
- O **perfil efetivo** perde os módulos não contratados (`maskPermissionsByContract`). Menu, telas, ações e APIs
  obedecem juntos.
- Os **recursos de contrato** (`comercioDigital`, `redeCertificacao`) ficam desligados fora do contrato, mesmo que
  alguém ligue o parâmetro (`isFeatureOn` → `featureAllowedByContract`).
- **Empresa sem contrato** (anterior ao multiempresa) continua sem restrição.

## 7. Ambientes

| Variável | Valores | Efeito |
|---|---|---|
| `ERP_AMBIENTE` | `teste` (padrão), `producao` | Em `producao`, credenciais de demonstração são recusadas, o acesso rápido some e a carga da demonstração é bloqueada. A publicação atual continua em `teste`: o titular decidiu manter o acesso rápido na tela de login até ordem em contrário. |
| `MULTIEMPRESA_ISOLAMENTO` | `estrito` (padrão), `observar`, `legado` | §2 e `migracao.md` |
| `INTEROS_CREDENCIAIS` | JSON com id, escopos e **hash** de cada credencial | Sem ela, a interface de serviço responde `503 servico_nao_configurado` |
| `INTEROS_LIMITE_ESCRITA_MINUTO`, `INTEROS_LIMITE_LEITURA_MINUTO` | inteiros (60 e 240) | Limite por credencial |
| `ERP_CREDENCIAIS_COMPARTILHADAS` | nomes de variáveis | Credenciais de integração que podem servir a mais de uma empresa. As demais têm um único dono (`assertSecretRefsOwned`). |
| `APP_URL` | URL pública | Base dos links de convite e recuperação |

## 8. Interface de serviço (Interos)

O contrato completo está em `docs/interos/contrato-interos-erp-v1.md`. Em resumo:
- autenticação por credencial com escopos;
- `X-Request-Id`, e `Idempotency-Key` nas alterações, com a trilha em `service_requests`;
- provisionamento retomável por etapas (`tenant_provisionings`);
- Torre de Controle só de leitura, com os números das mesmas funções das telas (`src/domain/tower`);
- cada leitura e alteração restrita à empresa do caminho, vinculada ao Interos.

## 9. Rotinas, arquivos, notificações, backups e integrações

| Superfície | Regra |
|---|---|
| Tarefas em segundo plano (`jobs`) | Rodam no contexto da empresa da tarefa. Tarefas de empresa suspensa ficam retidas (`held`) e voltam à fila na reativação. |
| Rotinas agendadas | Pulam empresas suspensas (`companyRunsRoutines`) |
| Arquivos (`/api/files/[id]`) | Só da empresa em uso, com a permissão do módulo de origem. Exceção: arquivo **entregue** ao escritório contábil, pelo registro de entrega. |
| Exportações (`/api/export/[key]`) | A mesma consulta da tela, no Store restrito, com permissão do módulo e `data.export`. Auditadas. |
| Notificações | Público resolvido pelos vínculos da empresa. Operações da plataforma só na plataforma. |
| Backups | Só os dados da empresa. Segredos de autenticação removidos. Usuários = só os vinculados. Tabelas da plataforma só no backup global do administrador da plataforma. |
| Loja virtual pública | Resolvida pelo domínio da empresa. Empresa suspensa fica fora do ar. |
| Integrações | Referências a segredos (variáveis de ambiente) com um único dono, salvo a lista de compartilhadas |
| Cache de leitura | Chaveado pelo Store restrito. A janela de 15 s só afeta a atualização, nunca o isolamento. |

## 10. Riscos residuais e próximos passos

1. **Justiça entre empresas na fila de tarefas:** uma empresa com muitas tarefas pode atrasar as outras (não vaza
   dados). Próximo passo: fila por empresa com rodízio.
2. **Credenciais por variável de ambiente:** a conferência de dono é feita ao salvar a integração. Uma auditoria
   periódica (`credenciaisCompartilhadas` na migração) mostra o que ficou compartilhado.
3. **Registro central de autorização:** menu, página e ação conferem a mesma matriz de permissões. Ainda assim, um
   registro único rota → permissão facilitaria a auditoria automática de telas novas.
4. **Fuso por empresa:** a instalação tem um fuso único (`APP_TIMEZONE`). Empresas em outros fusos veem os cortes de
   dia pelo fuso da instalação.
5. **Fechamento comercial:** cancelar depois retira a venda do período original (a Torre documenta isso). Um
   fechamento de período daria números imutáveis para o Interos.
