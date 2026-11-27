# Plano de migração, testes e rollback — catálogo v2

## Situação de partida (já implementada)

- Catálogo v1 em runtime e regra de acesso em todos os pontos de controle.
- Linha de base por empresa em `legacy`.
- API Interos v1.

Nenhum cliente teve acesso alterado (`docs/modulos/lancamento-gradual.md`).

## Etapas propostas (incrementais, sem migração destrutiva)

| # | Etapa | Muda comportamento? | Reversão | Situação (26/11) |
|---|---|---|---|---|
| 1 | Validar com o titular o catálogo v2 e as decisões em aberto (`docs/MODULARIZATION/README.md` §Decisões) | Não | — | ✅ decisões recebidas |
| 2 | Publicar o catálogo v2 como **dado**. Códigos v2 ↔ chaves v1 por alias (`v1Compatibility.unitsByV1Key`); o runtime segue v1. | Não | Remover o arquivo | ✅ |
| 3 | Tabela aditiva `company_licenses` (retrato do Interos) e tradução retrato → estados do runtime v1 | Não, enquanto o Interos não enviar retratos | Ignorar a tabela | ✅ `company_licenses`, `license_history` |
| 4 | API v2: catálogo, licença, simulação, sincronização, eventos assinados | Só para empresas cujo retrato for aplicado | Desligar a rota v2; a v1 continua | ✅ API v2 |
| 5 | Estados de teste, vigência e suspensão programada, com execução local por rotina | Só para empresas com essas datas no retrato | `PUT` de novo retrato, ou modo `legacy` | ✅ |
| 6 | Limites (usuários, dispositivos, filiais) só com aviso (`limit.reached`) | Não bloqueia | — | ✅ (só fiscal: aviso) |
| 7 | Limites com bloqueio de **novos** cadastros | Sim, por empresa | Retrato sem limite | ✅ usuários, dispositivos e filiais |
| 8 | Telemetria agregada `GET usage` | Não | — | ✅ `GET usage` |
| 9 | Interface `locked` e `upsell` e "Solicitar contratação" | Visual, por empresa | Modo `hidden` | ✅ |
| 10 | Divisão fina das unidades v1 conforme decisão comercial. Exemplo: `caixa.operacao` dividido em abertura/fechamento e conferência. | Por empresa e versão do retrato | Retrato anterior | ⏸ mantidas as 67 unidades (decisão 4) |

## Simulação de impacto antes de cada etapa

- Linha de base atual: `GET /api/interos/v1/companies/{id}/modules/baseline`.
- Retrato proposto: `POST .../license/simulate` na v2, ou `POST .../modules/simulate` na v1. A resposta mostra o que mudaria, as pendências e as dependências.
- Monitorar `module.shadow_denied` por pelo menos 7 dias antes de passar a `enforced`.

## Plano de testes

**Já automatizados:**
- 1033 testes: memória e Postgres.
- Isolamento entre empresas.
- Desligamento com pendência, agendado e com reativação.
- Dependências e cascata.
- Versão e concorrência.
- Idempotência.
- API HTTP.
- Combinações reais.

**A acrescentar por etapa:**

| Cenário exigido | Etapa |
|---|---|
| Empresas com módulos diferentes; isolamento | ✅ v1 |
| Empresas com várias filiais; filiais autorizadas | 3–5 |
| Usuários com permissões diferentes sobre o mesmo módulo contratado | ✅ v1 (habilitação antes do perfil); ampliar na etapa 10 |
| Ativação e desativação individual de submódulos | ✅ v1 (unidade v1); etapa 10 para unidades v2 |
| Dependências obrigatórias e sem ciclos | ✅ v1 e teste de geração v2 |
| URL direta e API | ✅ v1 |
| Expiração de teste e suspensão programada | 5 |
| Reativação e preservação histórica | ✅ v1 |
| Falha de comunicação com o Interos | 4–5 (cópia local, `sync.stale`) |
| Eventos duplicados e fora de ordem | 4 (`Event-Id` e `licenseVersion`) |
| Sincronização concorrente | ✅ v1 (versão); 4 |
| Revogação de acesso (prazo de 15 s) | ✅ v1 |
| Migração de clientes existentes | ✅ v1 (linha de base) |
| Integração entre canais e ausência de duplicidade financeira ou de estoque | ✅ testes de idempotência existentes (vendas, loja, baixas); acrescentar o cenário multicanal na etapa 4 |

## Rollback

- **Por empresa:** `apply {"mode":"legacy"}` na v1, ou um retrato anterior na v2.
- **Geral:** redeploy da versão anterior. As tabelas aditivas ficam sem uso e não há migração de dados a desfazer.
- Contratos comerciais nunca são alterados automaticamente. O ERP só aplica o que o Interos enviar.
