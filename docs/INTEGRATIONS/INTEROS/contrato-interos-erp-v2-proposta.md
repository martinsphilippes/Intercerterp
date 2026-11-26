# Contrato Interos ↔ ERP Intercert — v2 (PROPOSTA para validação)

> **Situação:** desenho da Fase 5, ainda não implementado.
> - A v1 (`docs/modulos/contrato-interos-erp-v1.md`) está em produção no código e continua válida.
> - A v2 é acrescentada ao lado da v1 (`/api/interos/v2`). A v1 só será desativada depois da migração do Interos.
> - Os pontos marcados com **[DECIDIR]** dependem de você.

## 1. Papéis

| Fonte de verdade | Sobre o quê |
|---|---|
| **Interos** | O que a empresa **contratou**: produto, módulos, submódulos, recursos, filiais autorizadas, limites, vigência, teste, estado comercial |
| **ERP Intercert** | O que **existe e funciona**: catálogo, dependências, disponibilidade técnica. Também o **estado operacional** efetivamente aplicado e a utilização. |

Regras:
- O ERP nunca libera algo que o Interos não contratou.
- O Interos nunca consegue liberar algo que o ERP marca como indisponível tecnicamente.
- O administrador de uma empresa não altera a própria licença.

## 2. Modelo de licença (por empresa)

O Interos envia sempre o **retrato completo** da licença (snapshot), nunca diferenças soltas.

O retrato é versionado por `licenseVersion`, um inteiro que só cresce e é emitido pelo Interos. Isso resolve repetição e eventos fora de ordem:
- versão menor ou igual à aplicada é ignorada, e o ERP responde com a versão vigente;
- versão maior é validada e aplicada.

```json
{
  "licenseVersion": 42,
  "companyId": "c0ffee00000000000000000000000001",
  "product": "erp-intercert",
  "commercialStatus": "active",
  "activationAt": "2026-12-01T03:00:00Z",
  "validUntil": "2027-11-30T23:59:59-03:00",
  "trial": { "until": null },
  "branches": { "mode": "list", "branchIds": ["b1", "b2"] },
  "limits": { "users": 15, "devices": 6, "branches": 2, "fiscalDocumentsPerMonth": 3000 },
  "items": [
    { "code": "07", "state": "active" },
    { "code": "07.12", "state": "trial", "until": "2026-12-15T23:59:59-03:00" },
    { "code": "12", "state": "suspension_scheduled", "effectiveAt": "2027-01-10T00:00:00-03:00", "reason": "inadimplência" },
    { "code": "22.02", "state": "read_only" }
  ],
  "issuedAt": "2026-11-26T15:00:00Z"
}
```

- `items[].code` é o código estável do catálogo v2 (módulo `NN`, submódulo `NN.SS` ou recurso `NN.SS.RR`).
- Contratar o módulo (`"07"`) inclui os submódulos marcados como `includedInParent`. Os demais exigem item próprio, o que evita cobrança dupla.
- Os aliases do catálogo (por exemplo, `07.13` é alias de `36.04`) são resolvidos para o proprietário antes de aplicar. Licenciar alias e proprietário ao mesmo tempo gera aviso `duplicate_entitlement`, nunca cobrança dupla.

### Estados de item e de empresa

| Estado (Interos) | Efeito no ERP (runtime v1 existente) |
|---|---|
| `active` | `enabled`: operação completa |
| `inactive` | `disabled`, histórico em consulta conforme a política do módulo (contrato encerrado) |
| `trial` | `enabled` até `until`. Depois vira `expired` **localmente**, sem depender do Interos. |
| `activation_scheduled` | Nada até `effectiveAt`; então `enabled` (executado pela rotina local) |
| `suspension_scheduled` | `enabled` até `effectiveAt`; então `suspended` |
| `suspended` | Bloqueia novas operações. Obrigações em curso continuam (política `drain`). Consulta histórica mantida. Reversível sem perda. |
| `expired` | Igual a `suspended` depois de uma carência de **[DECIDIR] 7 dias** em consulta |
| `read_only` | Só consulta histórica e ações de correção de histórico (`historyActions`) |
| `unavailable` (técnico) | Definido **pelo ERP**, nunca pelo Interos: o item não está operacional. O ERP recusa ativar e informa em `rejectedItems`. |

`commercialStatus` da empresa aceita os mesmos valores. Ele **limita** todos os itens:
- empresa `suspended` deixa todos os itens, no máximo, em `suspended`;
- empresa `read_only` deixa todos, no máximo, em `read_only`.

Funções da plataforma (CORE) continuam sempre ativas: login, administração essencial, auditoria, backup, isolamento e cumprimento de obrigações fiscais.

## 3. Operações (API v2, servidor a servidor)

| Operação | Método e caminho |
|---|---|
| Catálogo completo (módulos, submódulos, recursos, dependências, disponibilidade) | `GET /api/interos/v2/catalog` |
| Um item do catálogo | `GET /api/interos/v2/catalog/{code}` |
| Empresas vinculadas | `GET /api/interos/v2/companies` |
| Licença aplicada e estado operacional | `GET /api/interos/v2/companies/{id}/license` |
| Simular retrato de licença (impacto, dependências, pendências) | `POST /api/interos/v2/companies/{id}/license/simulate` |
| Aplicar retrato de licença | `PUT /api/interos/v2/companies/{id}/license` |
| Status de sincronização | `GET /api/interos/v2/companies/{id}/sync` |
| Utilização (telemetria agregada) | `GET /api/interos/v2/companies/{id}/usage?from&to` |
| Erros de integração | `GET /api/interos/v2/errors?since` |
| Histórico | `GET /api/interos/v2/companies/{id}/license/history` |
| Solicitações de contratação vindas do ERP | `GET /api/interos/v2/upsell-requests?since` |

Ativar, desativar, suspender, reativar, programar e atualizar limites são todos feitos por `PUT .../license` com um novo retrato. Não existem verbos separados: o retrato é a única verdade e a idempotência fica trivial.

### Segurança das chamadas

- **Autenticação.** Token servidor a servidor com escopos, como na v1: `erp.license.read`, `erp.license.write`, `erp.usage.read`.
  - **[DECIDIR]** Evoluir para **mTLS** ou **OAuth2 client credentials**, conforme o suporte do Interos.
- **Assinatura.** Cabeçalho `X-Interos-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, com segredo por cliente e diferente do token.
- **Proteção contra repetição.** O ERP recusa a requisição quando:
  - `t` está fora de uma janela de ±5 minutos;
  - o `X-Interos-Event-Id` já foi visto (guardado por 7 dias).

  O mesmo `Event-Id` com o mesmo corpo devolve a resposta anterior (idempotência). Com corpo diferente, devolve 409.
- **Ordem.** O `licenseVersion` monotônico garante que um retrato antigo, chegando atrasado, nunca sobrescreve um mais novo.
- **Concorrência.** Dois `PUT` com a mesma versão: o primeiro aplica e o segundo recebe a mesma resposta. Duas versões diferentes ao mesmo tempo: aplica a maior; a menor recebe `stale_version`.
- **Isolamento.** A credencial de um cliente Interos pode ser restrita a uma lista de empresas. Uma empresa nunca altera outra, porque o `companyId` vem da rota e é conferido contra o retrato.
- **Confirmação.** A resposta do `PUT` traz `appliedVersion`, `operationalState` por item, `rejectedItems` (com motivo: `unavailable`, `dependency_missing`, `kind_not_supported`) e `pendingObligations`.

### Eventos do ERP para o Interos (saída)

Usa o mecanismo de tarefas duráveis já existente (`jobs`), com retentativa exponencial e assinatura HMAC no mesmo formato.

| Evento | Quando |
|---|---|
| `license.applied` / `license.rejected` | Depois de cada `PUT` e de cada transição local (teste expirado, agendamento executado) |
| `license.transition` | Desligamento concluído (`draining` → `disabled`) |
| `upsell.requested` | Usuário clicou em "Solicitar contratação" numa função bloqueada |
| `limit.reached` | Um limite contratado foi atingido |
| `sync.stale` | O ERP não recebe o retrato há mais tempo que o limite de contingência |

## 4. Resiliência e contingência

- O ERP **nunca** consulta o Interos durante uma ação do usuário. A decisão usa a cópia local já aplicada (`company_modules`, com cache por empresa de 15 segundos).
- **Reconciliação** em duas vias:
  - o Interos chama `GET .../sync` periodicamente e reenvia o retrato quando a versão diverge;
  - **[DECIDIR]** opcionalmente, o ERP chama `GET {INTEROS_BASE_URL}/licenses/{companyId}` uma vez por dia.
- **Com o Interos indisponível:**
  - mantém a última licença válida;
  - aplica localmente o que tem data: fim de teste, agendamentos, vigência;
  - **não** libera nada novo;
  - registra `sync.stale`.
- **Revogação com o Interos indisponível:** suspensões já recebidas (inclusive programadas) são executadas na data, sem precisar do Interos.
- **Vigência vencida sem renovação recebida:**
  - carência de **[DECIDIR] 7 dias** com operação normal e aviso ao administrador;
  - depois disso, `read_only`;
  - obrigações fiscais em curso continuam sempre (motor fiscal, `drain`).

## 5. Limites contratados

| Limite | Ponto de controle | Ao atingir |
|---|---|---|
| Usuários ativos | Criação ou reativação de usuário | Recusa a criação com mensagem; não inativa ninguém |
| Dispositivos (terminais de PDV e equipamentos) | Cadastro ou ativação de terminal | Recusa o novo; os existentes continuam |
| Filiais | Criação de filial e filtro de filiais autorizadas | Filial não autorizada: só consulta |
| Documentos fiscais por mês | Emissão | **Nunca** bloqueia a emissão legal. Avisa e gera o evento `limit.reached` para cobrança de excedente. **[DECIDIR]** |

## 6. Telemetria (`GET .../usage`)

Só indicadores agregados, por empresa, módulo e submódulo:
- última utilização;
- operações por dia;
- usuários ativos (só a contagem);
- documentos fiscais emitidos por modelo;
- vendas e pedidos on-line (quantidade e valor total);
- caixas abertos;
- filiais;
- integrações ativas;
- erros operacionais por tipo;
- consumo dos limites.

**Nunca são enviados:** nomes, CPF/CNPJ de terceiros, XML, itens de venda, credenciais ou valores individuais.

Fonte dos dados: `audit_logs`, contadores e tabelas de documentos, agregados por consulta com `companyId` explícito.

## 7. Interface do ERP

O comportamento é configurado por empresa, por padrão do Interos: `hidden` | `locked` | `upsell`. **[DECIDIR]** O padrão sugerido é `hidden` para clientes atuais e `upsell` para novos planos.

- **`locked` e `upsell`:**
  - o item aparece no menu com cadeado;
  - a tela mostra só a descrição comercial e o botão "Solicitar contratação", que dispara o evento `upsell.requested`;
  - **nenhum dado nem operação** fica acessível (o bloqueio de servidor não muda).

## 8. Compatibilidade com a v1

- Os códigos v2 mapeiam as chaves v1 como aliases. Exemplo: `caixa.operacao` corresponde a `07.02`, `07.03`, `07.04`, `07.05`, `07.15`, `07.25` e `07.26`.
- O runtime de habilitação (`company_modules`, regra de acesso, desligamento) é **reaproveitado**. A v2 acrescenta a camada de licença, que se traduz em estados do runtime.
- O que a v2 acrescenta:
  - estados comerciais;
  - vigência e teste;
  - limites;
  - eventos assinados;
  - telemetria;
  - modo de exibição.
