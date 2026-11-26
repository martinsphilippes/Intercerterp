# Contrato Interos ↔ ERP — v1

Integração de gestão de módulos por empresa contratante.
- O **ERP é a fonte oficial da habilitação operacional**: o Interos solicita e o ERP confirma.
- Toda resposta traz o estado que o ERP efetivamente gravou.
- Implementação: `src/app/api/interos/v1/*`, `src/domain/modules/*` e `src/lib/modules/*`.

## Visão geral

| Operação | Método e caminho | Escopo |
|---|---|---|
| Catálogo | `GET /api/interos/v1/catalog` | `erp.modules.read` |
| Empresas | `GET /api/interos/v1/companies` | `erp.modules.read` |
| Módulos de uma empresa | `GET /api/interos/v1/companies/{companyId}/modules` | `erp.modules.read` |
| Simular impacto | `POST /api/interos/v1/companies/{companyId}/modules/simulate` | `erp.modules.read` (não grava) |
| Aplicar lote | `POST /api/interos/v1/companies/{companyId}/modules/apply` | `erp.modules.write` |
| Histórico | `GET /api/interos/v1/companies/{companyId}/modules/history?limit=50` | `erp.modules.read` |
| Linha de base | `GET` / `POST /api/interos/v1/companies/{companyId}/modules/baseline` | read / write |
| Status da operação | `GET /api/interos/v1/operations/{operationId}` | `erp.modules.read` |
| Cancelar operação agendada | `POST /api/interos/v1/operations/{operationId}/cancel` | `erp.modules.write` |

**Versionamento.**
- A versão da API está no caminho (`/v1`). Mudança incompatível vira `/v2`, e as duas convivem durante a transição.
- O catálogo tem versão própria (`catalogVersion`, semver), devolvida em `meta.catalogVersion` em toda resposta.
- Chaves de módulo nunca são renomeadas nem reaproveitadas.

**`companyId`** é o identificador ERP da empresa contratante, o mesmo de `companies.id`. Use `GET /companies` para mapear CNPJ → `companyId`. Filiais e usuários seguem o modelo de isolamento do ERP: a habilitação vale para a empresa inteira.

## Autenticação (servidor a servidor)

```
Authorization: Bearer <id>.<segredo>
```

- Mesmo registro e mesmo formato das outras APIs do Interos no ERP (`INTEROS_CREDENCIAIS`, só o hash do segredo):
  `docs/interos/credenciais.md`. O registro separado `INTEROS_CLIENTS` foi retirado.
- A credencial é gerada com `node scripts/interos/credencial.mjs <id> erp.modules.read [erp.modules.write]`. O comando
  mostra o token uma única vez.
- **Rotação:** cadastre a credencial nova junto com a antiga, troque no Interos e só então remova a antiga.
- Use credenciais distintas para homologação e produção, com um `id` próprio cada (aparece no registro das operações).
- Escopos:
  - `erp.modules.read`: leitura e simulação;
  - `erp.modules.write`: aplicar, gravar a linha de base e cancelar operação agendada. **Legado:** a licença v2 é o
    caminho de gravação do Interos; a credencial de licenças do Interos não leva este escopo.
- **Empresas permitidas** (`empresas` na credencial): leitura, simulação, aplicação, linha de base, histórico e
  operações de uma empresa fora da lista respondem `403 company_not_allowed`, antes de qualquer leitura ou gravação. A
  lista `GET /companies` só traz as empresas da credencial.
- Credencial com `assinatura`: toda gravação exige `X-Interos-Signature` (mesmo formato da v2).
- A comparação do token é feita em tempo constante. Respostas: 401 para token ausente ou inválido, 403 para escopo
  insuficiente ou empresa não permitida, 503 para integração não configurada.
- Uma operação só é visível para o cliente (`id`) que a criou.

## Envelope

Sucesso:

```json
{ "data": { }, "meta": { "apiVersion": "v1", "catalogVersion": "1.0.0", "requestId": "…" } }
```

Erro:

```json
{ "error": { "code": "version_conflict", "message": "…", "details": { } }, "meta": { "apiVersion": "v1", "requestId": "…" } }
```

- Envie `X-Request-Id` para correlacionar com os logs do ERP. Ele é devolvido em `meta.requestId` e no cabeçalho `X-Request-Id`.
- As respostas usam `Cache-Control: no-store`.

## Estados

| Campo | Valores |
|---|---|
| `mode` (empresa) | `legacy`: sem controle, comportamento anterior. `shadow`: avalia e registra o que seria negado, sem bloquear. `enforced`: aplica. |
| `state` (módulo na empresa) | `absent` (não contratado), `enabled`, `scheduled_off`, `draining`, `disabled` |
| `access` (efetivo agora) | `full`, `drain` (só concluir pendências), `read` (consulta histórica), `none` |
| `accessIfEnforced` | O nível que valeria com o controle aplicado. Útil no modo `shadow`. |
| `status` (operação) | `processing`, `applied`, `rejected`, `scheduled`, `cancelled` |

## Operações

### GET /catalog

Devolve o documento `catalogo-modulos-erp-v1`, o mesmo de [catalogo-modulos-erp-v1.json](catalogo-modulos-erp-v1.json). O cabeçalho `ETag` traz a versão do catálogo.

Cada módulo traz:
- `key`, `name`, `description`, `family`, `version`;
- `classification`, `availability`, `companyKinds`, `parent`;
- `dependencies`: `required`, `requiredAnyOf`, `transitive`, `technicalComponents`, `dependents`;
- `optionalIntegrations`, `configurationPrerequisites`;
- `surfaces`: telas, APIs, exportações, rotinas, recursos e permissões;
- `deactivation`: `mode`, `afterOff`, `drainDays`, `blockers`, `obligations`.

O documento também traz `permissions` (permissão de perfil → módulo que a governa) e `validation`, que confirma que o grafo não tem ciclos.

### GET /companies/{companyId}/modules

O cabeçalho `ETag` traz a versão do registro da empresa. Exemplo de resposta:

```json
{ "data": {
  "companyId": "c0ffee00000000000000000000000001", "companyName": "Alfa Comércio Fictício", "companyKind": "retail",
  "companyStatus": "active", "operational": true, "mode": "enforced", "version": 7, "catalogVersion": "1.0.0",
  "baseline": { "takenAt": "2026-11-26T03:00:00.000Z", "status": "reviewed", "divergences": [] },
  "modules": [
    { "module": "vendas.pdv", "name": "Frente de caixa (PDV)", "state": "enabled", "since": "2026-11-26T03:00:00.000Z",
      "source": "baseline", "drainUntil": null, "history": null, "config": null, "access": "full", "accessIfEnforced": "full",
      "configuration": { "ready": false, "missing": ["Ao menos um terminal ativo na filial (Administração › Terminais)"] } },
    { "module": "compras.cotacoes", "name": "Cotações de compra", "state": "disabled", "access": "read", "...": "..." }
  ] } }
```

### POST /companies/{companyId}/modules/simulate

O corpo é o mesmo de `apply`, sem `reason`. Não grava nada.

```json
{ "changes": [ { "module": "caixa.operacao", "action": "disable" } ], "cascade": true }
```

Resposta (resumida):

```json
{ "data": {
  "companyId": "…", "catalogVersion": "1.0.0", "version": 7, "mode": "enforced", "nextMode": "enforced", "valid": true,
  "impacts": [
    { "module": "caixa.operacao", "name": "Caixa", "action": "disable", "from": "enabled", "to": "draining", "policy": "drain",
      "blockers": [ { "key": "cash.open_sessions", "label": "Caixas abertos", "count": 2 } ],
      "obligations": ["Caixas abertos podem ser fechados (com sangria/suprimento) até a conclusão; nenhum caixa novo abre."],
      "integrationsAffected": [], "requires": [], "dependents": ["vendas.pdv", "…"] },
    { "module": "vendas.pdv", "cascadedFrom": "caixa.operacao", "to": "disabled", "…": "…" }
  ],
  "errors": [], "warnings": [], "resulting": { "caixa.operacao": "draining", "vendas.pdv": "disabled", "…": "…" } } }
```

Mostre ao usuário, antes de confirmar:
- os `impacts` com `to`, `blockers`, `obligations` e `integrationsAffected`;
- os módulos em cascata (`cascadedFrom`);
- os `errors`, que impedem a aplicação.

### POST /companies/{companyId}/modules/apply

Cabeçalhos:

| Cabeçalho | Obrigatório | Uso |
|---|---|---|
| `Idempotency-Key` | sim | 8 a 200 caracteres `[A-Za-z0-9._:-]`, única por operação lógica (sugestão: o id da alteração no Interos) |
| `X-Interos-Actor` | sim | Quem pediu a alteração (e-mail ou id da pessoa no Interos) |
| `If-Match: "<versão>"` | recomendado | Controle de edição concorrente. O mesmo valor pode ir em `expectedVersion` no corpo. |

Corpo:

```json
{
  "changes": [
    { "module": "compras.cotacoes", "action": "disable", "history": "read" },
    { "module": "ecommerce.promocoes", "action": "enable", "config": { "limiteCupons": 10 } }
  ],
  "mode": "enforced",
  "cascade": false,
  "reviewDivergences": false,
  "reason": "Plano Varejo Essencial — contrato 2026-118",
  "effectiveAt": null
}
```

- `action`: `enable` ou `disable`.
- `history`: `read` (padrão da política) ou `none`, e define o que fica disponível depois de desligado.
- `config`: configuração do módulo, preservada na reativação. Se for omitida, a anterior é mantida.
- `mode`: troca o modo de controle da empresa.
- `cascade`: desliga também os dependentes, inclusive grupos "basta um" que fiquem sem alternativa. Sem `cascade`, um dependente ligado faz o lote ser recusado.
- `reviewDivergences`: marca as divergências da linha de base como revisadas por este ator. É exigido para passar a `enforced` quando há divergências abertas.
- `effectiveAt`: data/hora ISO. No futuro, a operação fica `scheduled` e o ERP aplica na data contra a versão vigente. A versão esperada vale só para aplicação imediata.
- `reason`: obrigatório. Fica no histórico e na auditoria da empresa.

O lote é **atômico**. Todas as alterações são validadas juntas contra o conjunto resultante: dependências obrigatórias e grupos `requiredAnyOf`. Ou tudo é aplicado, ou nada é.

Respostas:

| HTTP | `data.status` | Quando |
|---|---|---|
| 201 | `applied` | Primeira aplicação |
| 200 | `applied` | Repetição da mesma chave e do mesmo corpo. Cabeçalho `Idempotent-Replayed: true`, mesmo `operationId`. |
| 202 | `scheduled` | `effectiveAt` no futuro |
| 422 | `rejected` | Lote inválido ou versão divergente. O erro fica em `data.error`, e a operação também é registrada. |

```json
{ "data": {
  "operationId": "9f2c…", "companyId": "…", "status": "applied", "kind": "apply", "actor": "ana@interos", "reason": "…",
  "idempotencyKey": "chg-118-3", "versionBefore": 7, "versionAfter": 8, "scheduledFor": null,
  "createdAt": "…", "finishedAt": "…",
  "result": { "changeId": "…", "simulation": { "impacts": [ ], "warnings": [ ] } }, "error": null } }
```

**Idempotência.**
- A mesma `Idempotency-Key` com o mesmo corpo devolve a **mesma** operação, com o resultado original e sem aplicar de novo.
- A mesma chave com corpo diferente devolve 409 `idempotency_mismatch`.
- Se a primeira tentativa falhou por erro interno (500), reenviar com a mesma chave retoma a operação.

**Concorrência.**
- O registro de cada empresa tem `version`.
- Com `If-Match`/`expectedVersion` diferente da versão atual, a resposta é `version_conflict`.
- Duas aplicações simultâneas na mesma versão: uma vence, e a outra recebe `version_conflict`. O ERP garante isso por um índice único `(empresa, versão)` no histórico.
- Diante de um conflito, consulte o estado, simule de novo e reenvie com **nova** chave.

### GET /companies/{companyId}/modules/history

Lista as versões em ordem decrescente: `version`, `at`, `actor`, `actorType` (`interos`, `migration`, `provisioning`, `platform_admin`, `system`), `reason`, `operationId` e `changes` (pedido, cascata, modo e impactos).

A conclusão automática de desligamentos aparece como `actorType: system`.

### GET/POST /companies/{companyId}/modules/baseline

- `GET` devolve a linha de base registrada (módulos, uso, recursos, permissões e divergências). Se ainda não houver, devolve a linha calculada naquele momento (`recorded: false`).
- `POST` grava a linha de base em modo `legacy`. É idempotente: empresa que já tem estado não é alterada.
- Sem linha de base, `simulate` e `apply` respondem `baseline_required`.

### GET /operations/{operationId}

- Devolve o estado confirmado pelo ERP.
- Uma operação agendada e vencida é executada no momento da consulta. Ela também é executada pela rotina diária `modules.maintenance`.

### POST /operations/{operationId}/cancel

Cancela uma operação `scheduled`. Qualquer outro estado devolve 409 `invalid_state`.

## Erros

| HTTP | `code` | Significado |
|---|---|---|
| 400 | `invalid_request`, `reason_required`, `actor_required`, `idempotency_key_required`, `idempotency_key_invalid` | Requisição malformada |
| 401 | `unauthenticated` | Token ausente ou inválido |
| 403 | `insufficient_scope` | Escopo insuficiente |
| 404 | `company_not_found`, `operation_not_found` | Empresa ou operação inexistente (ou operação de outro cliente) |
| 409 | `version_conflict`, `idempotency_mismatch`, `invalid_state` | Concorrência e idempotência |
| 422 | `changes_rejected` (com `details.errors[]`), `baseline_required` | Lote inválido |
| 500 | `internal_error` | Falha inesperada; repita com a mesma `Idempotency-Key` |
| 403 | `company_not_allowed` | Empresa fora de `empresas` da credencial |
| 503 | `integration_not_configured` | `INTEROS_CREDENCIAIS` ausente |

Códigos em `details.errors[].code` (também em `simulate.errors`):

| Código | Causa |
|---|---|
| `unknown_module` | Chave inexistente no catálogo |
| `not_contractable` | Plataforma ou componente técnico |
| `module_planned` | Lacuna: não existe no ERP |
| `kind_not_supported` | Módulo não se aplica ao tipo da empresa (`retail`, `accounting`, `certification`) |
| `dependency_missing` | Habilitar sem as obrigatórias no mesmo lote |
| `dependents_enabled` | Desligar com dependente ligado e sem `cascade` |
| `duplicate_change` | Mesmo módulo duas vezes no lote |
| `divergences_open` | Passar a `enforced` sem revisar as divergências da linha de base |
| `baseline_required` | Empresa sem linha de base |

Avisos em `warnings[].code`: `no_change`, `needs_confirmation`, `inherited_inconsistency`, `company_inactive`.

## Permissões dentro do ERP

- Habilitar um módulo **não** concede permissões a ninguém, e desligar não remove nada do perfil.
- O administrador da empresa continua decidindo quem pode o quê em Administração › Usuários e permissões.
- Administração › Módulos contratados mostra, somente para consulta, o estado, a configuração pendente e o histórico.

## Exemplos fictícios

```bash
ERP=https://erp-homologacao.example
TOKEN=…   # credencial de homologação

# 1. catálogo
curl -s -H "Authorization: Bearer $TOKEN" $ERP/api/interos/v1/catalog | jq '.data.modules[] | {key, classification}'

# 2. estado da empresa (guarde a versão do ETag)
curl -si -H "Authorization: Bearer $TOKEN" $ERP/api/interos/v1/companies/$CID/modules | grep -i etag

# 3. simular desligamento de cotações
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"changes":[{"module":"compras.cotacoes","action":"disable"}]}' \
  $ERP/api/interos/v1/companies/$CID/modules/simulate | jq '.data | {valid, impacts, errors}'

# 4. aplicar com idempotência e versão
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: chg-118-3" -H "X-Interos-Actor: ana@interos.example" -H 'If-Match: "7"' \
  -d '{"changes":[{"module":"compras.cotacoes","action":"disable"}],"reason":"Plano Essencial — contrato 118"}' \
  $ERP/api/interos/v1/companies/$CID/modules/apply | jq '.data | {operationId, status, versionAfter}'

# 5. repetir o mesmo comando → mesma operação (Idempotent-Replayed: true)
# 6. histórico
curl -s -H "Authorization: Bearer $TOKEN" "$ERP/api/interos/v1/companies/$CID/modules/history?limit=5" | jq '.data[0]'
```

## Instruções de teste

1. **Automatizados** (banco em memória ou Postgres embutido):

   ```bash
   npx vitest run tests/modules-catalog.test.ts tests/modules-enablement.test.ts tests/modules-combinations.test.ts
   TEST_STORE=postgres npx vitest run tests/modules-enablement.test.ts
   ```

   Cobrem:
   - autenticação e escopos, catálogo, estado com ETag e simulação sem gravação;
   - aplicação 201/200 com repetição idempotente, versão divergente, operação de outro cliente e 404;
   - operação agendada, histórico, concorrência e cascata;
   - conclusão de desligamento e as duas empresas fictícias.
2. **Homologação manual**, com duas empresas fictícias criadas em Administração › Empresas:
   1. `GET /companies` e anote os `companyId`.
   2. `POST .../baseline` nas duas.
   3. Na empresa A, aplique `{"mode":"shadow"}`. Navegue pelas telas e confira `module.shadow_denied` em Administração › Histórico.
   4. Na empresa A, aplique `{"changes":[{"module":"compras.cotacoes","action":"disable"}],"mode":"enforced","reviewDivergences":true}`.
   5. Confira na empresa A: "Cotações" some do menu; `/compras/cotacoes` vira "consulta"; o botão "criar cotação" do pedido é recusado.
   6. Confira na empresa B: nada mudou (estado, versão e histórico).
   7. Repita o `apply` com a mesma chave e confira `Idempotent-Replayed: true`.
   8. Abra um caixa na empresa A e simule desligar `caixa.operacao` com `cascade`. O caixa vai para `draining`, com a pendência "Caixas abertos". Feche o caixa, rode a rotina diária (`npm run jobs`) e confira que o caixa vai para `disabled`.
