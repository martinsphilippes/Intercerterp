# Migração multiempresa: ativação sem interrupção e rollback

> Como levar uma base existente, com uma ou várias empresas, para o isolamento multiempresa sem parar a operação.
> Código: `src/domain/tenancy/migration.ts` (`runTenancyMigration`), passo `multiempresa` de `/api/setup/run`.
> Arquitetura: `arquitetura.md`.

## 1. Princípios

- **Aditiva:** só cria tabelas, colunas e índices. Nada é renomeado nem apagado, então a versão anterior do sistema
  continua funcionando sobre o banco migrado.
- **Verificável:** a migração tira um retrato **antes** e outro **depois** de cada execução. O retrato traz registros
  por coleção e por empresa, mais os valores de conferência: vendas e seu total em centavos, títulos em aberto,
  estoque físico e documentos fiscais. Qualquer diferença nesses valores reprova a execução (`conferencia.ok = false`).
  A migração nunca altera valores de negócio.
- **Sem adivinhação:** só é preenchido o que é inequívoco, como a empresa derivada da filial do próprio registro. O
  ambíguo vai para a fila de revisão (`tenancy_reviews`), com o motivo e as candidatas.
- **Repetível:** rodar de novo não duplica nada.
- **Gradual:** o isolamento pode ser ligado primeiro em modo **observar** (registra sem bloquear) e depois em
  **estrito**.
- **Simulação primeiro:** `simular` não grava nada além do próprio relatório.

## 2. O que muda no banco

**Tabelas novas** (só da plataforma: nenhum Store de empresa as lê):

| Tabela | Conteúdo |
|---|---|
| `service_requests` | Trilha e idempotência da interface de serviço |
| `tenant_provisionings` | Etapas da implantação de cada conta do Interos |
| `company_relations` | Vínculos explícitos entre empresas |
| `tenancy_reviews` | Fila de revisão da migração |
| `tenancy_violations` | Violações registradas no modo observar |
| `migration_runs` | Relatório de cada execução |

**Colunas novas:**
- **`companies`:**
  - `isPlatform`, `contract`;
  - `interosAccountId` (índice único parcial), `interosLinkedAt`;
  - `suspension`, `suspensionHistory`, `statusBeforeSuspension`;
  - `linkCodeHash`, `linkCodeExpiresAt`, `linkCodeCreatedBy`, `linkCodeUsedAt`.
- **`users`:** `jobTitleByCompany`, `branchIdsByCompany`, `sessionsValidAfter`.

A estrutura é criada **sozinha** na primeira consulta da versão nova, numa única transação: ou o esquema fica
completo, ou nada muda. Também pode ser criada antes, de forma explícita, com
`GET /api/setup/run?step=provision` (cabeçalho `x-setup-token`).

## 3. Roteiro de ativação

| Passo | Ação | Conferência |
|---|---|---|
| 0 | Ponto de restauração do banco (no Neon: *branch* ou restauração por instante) e janela combinada | Ponto anotado |
| 1 | Publicar a versão com `MULTIEMPRESA_ISOLAMENTO=observar` (recomendado em produção com clientes reais) | Telas abrem; `step=status` responde |
| 2 | `GET /api/setup/run?step=multiempresa&modo=simular&detalhe=1` | `conferencia.ok: true`; revisar `preenchidos`, `revisao`, `plataforma`, `perfisComOperacaoDePlataforma`, `credenciaisCompartilhadas` e `vinculos` |
| 3 | `GET /api/setup/run?step=multiempresa&modo=aplicar&detalhe=1` | `conferencia.ok: true`; `migration_runs` com `status: ok` |
| 4 | Tratar a fila de revisão: cada item tem coleção, registro, motivo e candidatas | Fila vazia, ou com cada caso decidido |
| 5 | Observar por alguns dias: `tenancy_violations` registra cada acesso que o modo estrito bloquearia | Nenhuma violação legítima pendente |
| 6 | Retirar a variável (o padrão é `estrito`) e publicar de novo | Homologação (`homologacao.md`) e regressões passando |
| 7 | Liberar as credenciais do Interos no ambiente (`INTEROS_CREDENCIAIS`, só hashes) | `GET /api/interos/v1/status` → 200 |

Na **homologação** (prévia), os passos 1 e 5 foram pulados: a prévia já roda em `estrito`, que é o padrão.

## 4. Rollback

| Nível | Quando | Como | Tempo |
|---|---|---|---|
| 1. Comportamento | O isolamento bloqueou um fluxo legítimo | `MULTIEMPRESA_ISOLAMENTO=observar` (registra sem bloquear) ou `legado` (comportamento anterior), e publicar de novo. Nada no banco precisa mudar. | Minutos |
| 2. Versão | Problema na versão nova | Promover a publicação anterior na Vercel (*instant rollback*). O banco migrado é compatível porque as mudanças são só acréscimos. | Segundos |
| 3. Dados | Problema de dados introduzido depois | Restaurar o ponto do passo 0. A migração não altera valores de negócio. | Conforme o banco |

**O que a migração grava e não é desfeito automaticamente.** Nada disso afeta a versão anterior:
- `companyId` preenchido nos registros listados em `preenchidos`, com coleção, registro e empresa; dá para reverter
  por script com essa lista;
- a marcação `isPlatform`;
- os vínculos em `company_relations`;
- a equipe de certificação da demonstração movida para a empresa da plataforma;
- os itens da fila de revisão.

## 5. Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `MULTIEMPRESA_ISOLAMENTO` | `estrito` | `observar` na ativação gradual; `legado` no rollback |
| `ERP_AMBIENTE` | `teste` | `producao` recusa credenciais de demonstração. Decisão pendente com o titular, porque o acesso rápido fica na tela até ele mandar tirar. |
| `INTEROS_CREDENCIAIS` | (vazio) | Só hashes. Sem ela, a interface do Interos responde 503. |
| `SETUP_TOKEN` | (obrigatório) | Protege `/api/setup/run` |

## 6. Resultado na homologação

Base: prévia (branch `claude/eager-tesla-oark2w`, Neon São Paulo), em modo `estrito`, com a demonstração carregada. As
evidências estão em `docs/multiempresa/evidencias/homologacao-previa-execucao-1/` (primeira aplicação) e
`.../homologacao-previa/` (segunda, que confirma a idempotência). Os relatórios completos estão em
`migracao-simular.json` e `migracao-aplicar.json`.

**Retrato da base:** 132 coleções e 11 empresas na primeira execução; na segunda, 13 (as duas a mais são as empresas fictícias criadas pela primeira homologação).

| Execução | Modo | Tempo | Preenchidos | Revisão | Plataforma | Vínculos | Registros (antes → depois) | Valores de conferência (antes = depois) |
|---|---|---|---|---|---|---|---|---|
| 1ª | simular | 3,6 s | 0 | 0 | 1 candidata identificada (não marcada: simulação) | 1 contábil e 6 de rede ativos; 1 sem origem (plataforma ainda não marcada) | 3.314 → 3.314 | 48 vendas · R$ 5.994,22 · estoque 943 un. · 60 documentos fiscais |
| 1ª | aplicar | 2,2 s | 0 | 0 | marcada agora; equipe de certificação da demonstração movida para ela | **8 vínculos criados** (1 contábil e 7 de rede) | 3.314 → 3.324 (+8 vínculos, +1 perfil da equipe na plataforma, +1 registro de auditoria) | idênticos: `conferencia.ok = true`, sem diferenças |
| 2ª | simular | 3,0 s | 0 | 0 | já marcada | 1 contábil e 7 de rede ativos, 0 a criar | 3.441 → 3.441 (com as empresas da 1ª homologação) | idênticos |
| 2ª | aplicar | 1,4 s | 0 | 0 | já marcada | 0 criados e 0 atualizados (idempotente) | 3.441 → 3.441 | idênticos |

**Observações:**
- **Nada ambíguo:** a demonstração já nasce com empresa em todos os registros, então não houve preenchimento nem
  revisão. Uma base vinda de outro sistema pode ter os dois casos, e eles estão cobertos pelos testes de migração
  (`tests/multiempresa-migracao.test.ts`).
- **Perfil para limpeza:** um perfil de cliente tem `certification.operate` (operação da plataforma). Ele aparece em
  `perfisComOperacaoDePlataforma` e não tem efeito fora da plataforma.
- **Credenciais compartilhadas:** nenhuma.

