# Lançamento gradual, monitoramento e reversão

Nada é removido de nenhuma empresa existente. Todas as mudanças de esquema são aditivas, com quatro tabelas novas:
- `company_modules`;
- `module_changes`;
- `module_operations`;
- `module_baselines`.

O Postgres cria essas tabelas sozinho na primeira consulta da nova versão. As quatro ficam **fora** do backup/restauração da empresa: restaurar uma cópia antiga nunca devolve nem remove módulos contratados.

## Etapas

| # | Etapa | Como | Efeito para os clientes | Critério para avançar |
|---|---|---|---|---|
| 0 | Publicar a versão | deploy normal | Nenhum. Empresa sem estado é `legacy` e tudo funciona como antes. | Suíte verde (`npm test`, `TEST_STORE=postgres npm test`) e build |
| 1 | Linha de base | Rotina diária `modules.maintenance` (automática), ou `GET /api/setup/run?step=modules-baseline`, ou `npm run modules:baseline`, ou `POST /api/interos/v1/companies/{id}/modules/baseline` | Nenhum: modo `legacy`, com tudo que o tipo de empresa já tinha e mais o que estiver em uso | Toda empresa com `hasBaseline: true` em `GET /companies` |
| 2 | Revisar divergências | `GET .../baseline`. Em Administração › Módulos contratados, a seção "Divergências". | Nenhum | Cada divergência analisada pelo time comercial e pelo suporte |
| 3 | Conciliar com o contrato | O Interos simula (`simulate`) o conjunto contratado contra o vigente | Nenhum (simulação) | Diferenças aceitas pelo cliente |
| 4 | Shadow | `apply {"mode":"shadow", "changes":[…]}` | Nenhum bloqueio. O que seria negado vai para `audit_logs` (`module.shadow_denied`), no máximo uma vez por minuto para cada empresa e superfície. | 7 dias sem negação inesperada (ver monitoramento) |
| 5 | Enforced | `apply {"mode":"enforced","reviewDivergences":true}` | Módulos não contratados saem do menu; telas em consulta; ações recusadas com mensagem | — |
| 6 | Empresas novas | Administração › Empresas › Nova empresa, com a seleção de módulos | Nascem `enforced` com os módulos selecionados (sem seleção, o padrão do tipo) | — |

A ordem sugerida é por ondas:
1. empresas de demonstração;
2. 1 a 3 clientes piloto;
3. clientes por plano;
4. o restante.

A empresa de demonstração e as contas do acesso rápido continuam em `legacy` enquanto `SHOW_DEMO_LOGIN` estiver ligado.

## Homologação

1. Banco de homologação **separado** do de produção (regras §48).
2. Duas empresas fictícias, A e B. O roteiro está em `contrato-interos-erp-v1.md` › Instruções de teste.
3. Varredura de navegação com login real (`node scripts/dev/crawl.mjs`) em três situações:
   - empresa em `legacy`: nenhuma diferença em relação à versão anterior;
   - empresa em `enforced` com o conjunto completo: nenhuma diferença;
   - empresa em `enforced` com módulos desligados: só as telas esperadas em consulta ou indisponíveis.
4. Conferir o prazo de revogação. Desligue um módulo e acesse a tela por outra instância. A tela deve ficar indisponível em até 15 segundos.

## Monitoramento

| Sinal | Onde | Ação |
|---|---|---|
| `module.shadow_denied` | `audit_logs` da empresa (Administração › Histórico) | Na fase shadow, cada ocorrência é uma tela ou ação que o contrato tiraria. Confirme com o cliente antes do enforced. |
| `module.denied` | `audit_logs` | Ação recusada no enforced. Pico depois de uma alteração indica contrato errado. |
| Módulos em `draining` além de `drainUntil` | `finalizePendingDeactivations` (retorno `overdue` na rotina) | Pendência que não conclui. Contate o cliente; o módulo não é desligado à força. |
| Diferença em relação à linha de base | `baselineDrift(store, companyId)` (`src/domain/modules/baseline.ts`) | Lista o que saiu e o que entrou desde a migração |
| Operações `rejected` | `module_operations` | Lote inválido enviado pelo Interos |

## Reversão

| Situação | Reversão | Tempo |
|---|---|---|
| Uma empresa bloqueada indevidamente | `apply {"mode":"legacy"}`: comportamento anterior imediato. Os módulos e o histórico ficam gravados. | Imediato; 15 s nas demais instâncias |
| Um módulo desligado por engano | `apply {"changes":[{"module":"…","action":"enable"}]}`. Reaproveita a configuração e o histórico: os dados nunca foram apagados e os perfis não foram tocados. | Imediato |
| Todas as empresas | `apply {"mode":"legacy"}` em lote pelo Interos. Ou, em último caso, apagar os registros de `company_modules`: sem registro, a empresa volta a `legacy`. | Imediato |
| A versão inteira | Redeploy da versão anterior. As tabelas novas ficam no banco sem uso e não interferem. | Um deploy |

A reversão não exige migração de dados: as tabelas antigas não foram alteradas.
