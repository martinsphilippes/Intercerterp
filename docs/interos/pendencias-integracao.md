# Pendências da integração Interos × ERP Intercert: o que o ERP entregou

> Resposta ao documento "Pendências da integração INTEROS × ERP Intercert" (26/11/2026).
> - Versão: branch `claude/eager-tesla-oark2w` (as quatro APIs numa versão só).
> - Testes: suíte inteira na memória e no Postgres. Cada correção tem um teste de regressão, indicado abaixo.

## 1. As seis entregas

| # | Pendência | Situação | Onde está |
|---|---|---|---|
| 1 | Unificar as duas branches | **Feito.** Uma versão com provisionamento, Torre, módulos (v1) e licenças (v2). Empresa criada pelo provisionamento aparece na API de licenças, e o código de vínculo vale para as duas. | merge `da01ada` |
| 2 | Um prefixo e uma autenticação | **Feito.** Ver §3. | `docs/interos/credenciais.md` |
| 3 | v1 de módulos respeita `companyIds` | **Feito.** Empresa fora da lista: `403 company_not_allowed` em leitura, simulação, aplicação, linha de base, histórico e operações, antes de qualquer gravação. | `tests/modules-enablement.test.ts` ("credencial restrita às empresas do piloto") |
| 4 | Um vocabulário de módulos | **Feito.** Ver §4. | `catalogo-modulos-erp-v2.json` → `translations` |
| 5 | Validar o catálogo v2 | **Pronto para o titular validar.** Ver §5. | `docs/MODULE_CATALOG/` |
| 6 | Credenciais de homologação e produção | **Em andamento.** Homologação: cadastradas em 27/11 (a de licenças restrita às empresas do piloto) e usadas na rodada da §10. Produção: depois da homologação aprovada, as três sem lista; a de licenças alcança só as empresas ligadas ao Interos (`credenciais.md` §4). | §6 |

## 2. Correções de comportamento

| # | Prioridade | Correção | Teste |
|---|---|---|---|
| 1 | Alta | `POST /empresas` com outra `Idempotency-Key` nunca refaz a criação. A empresa já criada volta **como está** (`200`, `criacao: "ja_existia"`, `aviso`): não voltam módulos, unidade inicial nem situação (empresa inativada continua inativa). Implantação incompleta só completa as etapas que faltam. | `interos-provisionamento` ("correção 1") |
| 2 | Alta | O teto da empresa (suspensa, somente leitura, vigência vencida depois da carência) vale para **todas** as unidades, inclusive NF-e, NFC-e, NFS-e, Banco Intercert e Canais. O direito preservado continua registrado (`preservedAccess`) e volta na reativação. Só um item `inactive` explícito, ou a saída de uma dependência, encerra o direito. | `licensing` ("correção 2") |
| 3 | Alta | Teste, carência, agendamentos, fim de vigência, operações agendadas e desligamentos em conclusão valem **na hora**. A primeira requisição da empresa, ou leitura do Interos (licença, sincronização, histórico, módulos e as listas `GET /v2/companies` e `GET /v1/companies`, que aplicam o vencido de todas as empresas listadas), depois do instante aplica. Com a consulta do Interos a cada 5 minutos, o atraso máximo é de 5 minutos. O histórico de licença mostra a transição (`kind: "transition"`). A rotina diária fica como rede de segurança. | `licensing` ("correção 3") |
| 4 | Alta | `upsell-requests` manda `requestedBy` como identificador pseudônimo e estável (`usr_…`) e `requesterRole` (perfil), nunca o nome. O ERP deixou de gravar o nome na solicitação. | `licensing` ("correção 4 (LGPD)") |
| 5 | Alta | Devoluções (CDC, 90 dias): pendência declarada (vendas no prazo). Desligar o PDV, direto ou em cascata, deixa as devoluções **em conclusão** até a última venda sair do prazo. A simulação mostra a pendência e a obrigação. | `modules-enablement` ("correção 5") |
| 6 | Média | A Torre respeita o contrato. O bloco de módulo não contratado vem `null` no resumo, a rota própria responde `409 modulo_nao_contratado` e `meta.modulosContratados` lista os contratados. Suspenso continua contratado. | `interos-torre` ("respeita o contrato") |
| 7 | Média | `X-Interos-Event-Id` registrado só **depois** da validação. Corpo inválido não consome o evento: corrija e reenvie com o mesmo id. Evento ainda em processamento: `409 event_in_progress`. | `licensing` ("correção 7") |
| 8 | Média | `activation_scheduled` numa unidade já ligada mantém a unidade ligada: agendar nunca desliga. | `licensing` ("correção 8") |
| 9 | Média | `controlMode: "enforced"` não marca divergências como revisadas. Com divergência aberta, exige `baselineReview: { reviewedBy, notes }` no retrato. Sem ela, as unidades valem, o controle não muda e vem o aviso `review_required`. | `licensing` ("correção 9") |
| 10 | Média | Sem `INTEROS_EVENTS_URL`/`INTEROS_OUTBOUND_SECRET`, o evento **fica na fila** (nunca dado como entregue) e aparece em `GET /v2/errors` (`event.undelivered`, `reason: "not_configured"`). Configurado o destino, os guardados são enviados. | `licensing` ("correção 10") |
| 11 | Média | `branches` da licença aplicado. Fora da lista, a filial opera **só em consulta** (nenhuma gravação, com o motivo na tela). Id inexistente gera o aviso `unknown_branch`. | `licensing` ("correção 11") |
| 12 | Média | Contrato v2 alinhado ao código: sem `unavailable`, `stale_version`, `operationalState` e `pendingObligations`, e com os campos e motivos reais. O catálogo publica `sellable`, `includedInParent` e `companyKinds` por unidade. O módulo `NN` liga só as unidades principais (`includedInParent`); as adicionais exigem item próprio. | `licensing` ("resolução de códigos") |
| 13 | Baixa | v1: `version_conflict` responde `409` no envelope de erro, com a operação recusada nos detalhes. Aplicação em empresa inexistente: `404 company_not_found`, sem registrar operação. | `modules-enablement` ("catálogo, módulos da empresa…") |
| 14 | Baixa | Quem cria um escritório contábil recebe o perfil de administrador do escritório (`firm_admin`), com menu. | `admin-access` ("correção 14") |
| 15 | Baixa | `vincular` confere o código **antes** de qualquer outra resposta. Sem código válido, a resposta é sempre `identidade_nao_confere`. Como empresa vinculada não gera código, não há enumeração. Reenviar o mesmo vínculo devolve `200`. | `interos-provisionamento` ("vínculo de empresa existente") |
| 16 | Alta | Credencial de licenças sem `empresas` alcança só as empresas ligadas ao Interos (`interosAccountId`), como o provisionamento e a Torre. Empresa não vinculada responde `404 company_not_found`, igual a uma inexistente, e fica fora das listas (`/companies`, `/errors`, `/upsell-requests` e `/v1/companies`). Antes, sem lista, a credencial alcançava todas as empresas do ERP. | `interos-credenciais` ("credencial de licenças sem `empresas`") |

## 3. Um prefixo e uma autenticação (pendência 2)

- **Um endereço.** As três APIs ficam no mesmo endereço do ERP (`ERP_INTERCERT_URL`), sob `/api/interos`, sem colisão:

  | API | Caminhos |
  |---|---|
  | Provisionamento | `/v1/status`, `/v1/empresas/...` |
  | Torre de Controle | `/v1/empresas/{id}/torre/...` |
  | Módulos (legado) | `/v1/catalog`, `/v1/companies/...`, `/v1/operations/...` |
  | Licenças | `/v2/...` |

  As variáveis `ERP_INTERCERT_URL_PROVISIONAMENTO` e `ERP_INTERCERT_URL_TORRE` deixam de ser necessárias.
- **Um esquema de credencial.** Um registro (`INTEROS_CREDENCIAIS`, só hashes) e um formato de token
  (`Bearer <id>.<segredo>`) para as três APIs. O registro separado `INTEROS_CLIENTS` foi retirado.
- **Escopos separados.** Três famílias: provisionamento, Torre e licenças. Uma credencial que misture famílias é
  recusada inteira.
- **Restrição por empresa.** O campo `empresas` vale para todas as APIs. Uma credencial restrita não cria nem vincula
  empresas.
- **Assinatura.** HMAC no mesmo formato em todas as gravações. A gravação de licença é sempre assinada.
- **Rotação sem parada.** O token novo e o antigo valem ao mesmo tempo, e o segredo de assinatura também (lista com os
  dois nomes).
- Detalhes, respostas e exemplos: `docs/interos/credenciais.md`.

## 4. Um vocabulário de módulos (pendência 4)

**As unidades v2 são a referência do contrato.** As outras chaves viraram traduções, publicadas no catálogo
(`GET /api/interos/v2/catalog`):
- `translations.provisioningModules`: cada módulo amplo do provisionamento e as suas unidades;
- `translations.v1Keys`: cada chave v1 e a sua unidade.

Na prática:
- **Empresa criada pelo provisionamento** nasce com a habilitação real dos módulos amplos traduzidos. Só entram as
  unidades vendáveis, com as dependências fechadas e o controle aplicado. Ela não recebe mais a linha de base "legada",
  que ligaria tudo, inclusive NF-e não homologada.
- **Com licença v2 aplicada**:
  - o contrato amplo da empresa passa a ser derivado do retrato (`contrato.origemModulos: "licenca"` na consulta do
    provisionamento);
  - `PUT /empresas/{id}/modulos` responde `409 licenca_governa`. Uma referência só, sem duas fontes brigando.

**Duas alavancas de suspensão, papéis diferentes.** Vale sempre a mais restritiva:

| Alavanca | Uso | Efeito |
|---|---|---|
| Conta (`POST /empresas/{id}/suspender`, provisionamento) | Encerramento, fraude, bloqueio total | `bloqueio`: ninguém entra. `somente_leitura`: entra, consulta e exporta, sem gravar. |
| Licença (`commercialStatus` no retrato v2) | Situação comercial do contrato (inadimplência, vigência) | Módulos suspensos ou em consulta. Login, administração e obrigações em curso continuam. |

## 5. Catálogo v2 (pendência 5): o que falta é a validação do titular

Já está no catálogo:
- **`companyKinds` por unidade** (`retail`, `accounting`, `certification`);
- **dependências "basta um"** em `dependencies.requiredAnyOf`, incluindo as quatro citadas:

  | Unidade | Basta uma de |
  |---|---|
  | `06.12` (comissões) | `06.01`, `07.01`, `12.01` |
  | `22.21` (exportação Domínio) | `18.01`, `18.02` |
  | `02.09` (substituição tributária) | `04.01`, `04.02` |
  | `02.14` (IBS e CBS) | `04.01`, `04.02` |

- **`sellable` e `includedInParent`** por unidade.

**Falta:** a versão sem "proposta" (`2.0.0`) depende da validação do titular das 67 unidades comerciais. Validado, a
troca é de uma linha e a publicação segue na hora.

## 6. Credenciais (pendência 6) e validação conjunta

Ordem combinada:
1. O ERP publica esta versão na homologação e cadastra as credenciais (a de licenças restrita às empresas do piloto).
2. O Interos liga a integração e importa o catálogo.
3. Vinculam-se 2 a 3 empresas de teste.
4. Os 9 cenários são repetidos.
5. Confere-se junto o histórico de licença.
6. As credenciais de produção vêm depois da aprovação, sem lista; a de licenças alcança só as empresas ligadas ao Interos.

**Variáveis no Interos (homologação):**

| Variável | Valor |
|---|---|
| `ERP_INTERCERT_URL` | endereço da homologação do ERP |
| `ERP_INTERCERT_TOKEN_LICENCAS` | `interos-licencas-hml.<segredo>`, com escopos `erp.license.read`, `erp.license.write`, `erp.modules.read`, `erp.usage.read` e restrita às empresas do piloto |
| `ERP_INTERCERT_SEGREDO_ASSINATURA` | segredo HMAC (o mesmo valor fica no ERP, na variável indicada em `assinatura`) |
| `ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO` | `interos-prov-hml.<segredo>` |
| `ERP_INTERCERT_CREDENCIAL_TORRE` | `interos-torre-hml.<segredo>` |
| `ERP_INTERCERT_AMBIENTE` | `homologacao` |
| `ERP_INTERCERT_SEGREDO_EVENTOS` | segredo dos avisos do ERP para o Interos (o mesmo valor de `INTEROS_OUTBOUND_SECRET` no ERP) |

Cada valor vai **direto para as variáveis da Vercel**, colado por quem tem acesso a elas. Nunca por chat, e-mail ou
documento.

- **No Interos, as variáveis vão no ambiente Production**, com `ERP_INTERCERT_AMBIENTE=homologacao`: as prévias do
  Interos não têm banco. Vínculos, catálogo e histórico do Interos ficam separados por ambiente, então a troca para a
  produção do ERP depois não mistura nada.
- `ERP_INTERCERT_URL_PROVISIONAMENTO` e `ERP_INTERCERT_URL_TORRE` não são mais usadas: as três APIs ficam no mesmo
  endereço.
- **Empresa criada depois pelo provisionamento:** com a credencial de licenças restrita (`empresas`), a empresa nova
  só recebe licença depois de entrar na lista (`403 company_not_allowed` até lá). Na homologação, acrescente o id da
  empresa criada ao `empresas` da credencial de licenças e publique.

## 7. Resultado na homologação (prévia publicada, 26/11/2026)

A versão unificada foi publicada na homologação e homologada de ponta a ponta na prévia real (Vercel + Neon), com
duas empresas fictícias criadas pelo provisionamento: **97 verificações, 0 falhas**. A evidência, sem tokens, senhas
nem links de convite, está em `docs/multiempresa/evidencias/homologacao-unificada/`.

| Bloco | O que foi conferido |
|---|---|
| Interface de serviço | Credencial ausente ou errada (401, mesma resposta), escopos separados (403) e produção sem credenciais (503) |
| Migração | Simular e aplicar com o retrato antes e depois idêntico |
| Provisionamento | Criar; reenviar com a mesma chave (resposta original); reenviar com outra chave (volta como está, `criacao: "ja_existia"`) |
| Acesso pela tela | Convites aceitos e de uso único; dados próprios cadastrados |
| Isolamento | Acesso cruzado entre as empresas e a demonstração (tela, APIs, busca, exportação, arquivos, troca de empresa, Torre e provisionamento): bloqueado, sem vazar dados. Módulo não contratado leva a "módulo indisponível". |
| Administração pelo cliente | Logins e filiais da própria empresa; empresa nova, não |
| Suspensão | Somente leitura, bloqueio e reativação na hora |
| Licenças (v2) | Catálogo com a tradução; retrato inválido sem consumir o Event-Id; o mesmo Event-Id corrigido aceito; repetição idêntica devolve a original; outro conteúdo, `409`; sem assinatura, `401`; licença como referência (`origemModulos: "licenca"`, `409 licenca_governa`); Torre pelo contrato (`null` e `409 modulo_nao_contratado`); histórico; LGPD; credencial restrita ao piloto com `403 company_not_allowed` (v2 e v1) e lista filtrada |

## 8. Avisos do ERP para o Interos (pedido de 27/11)

| # | Pedido | Situação |
|---|---|---|
| 1 | Configurar os avisos em homologação | **Feito.** `INTEROS_EVENTS_URL=https://interos-two.vercel.app/api/webhooks/erp` e `INTEROS_OUTBOUND_SECRET` configurados na homologação do ERP em 27/11; os avisos foram entregues na hora (§10). |
| 2 | Entregar o aviso na hora | **Feito.** Logo depois de enfileirar, o ERP tenta entregar aquele aviso (`runDueJobs` com o id do job, em `after()`). Se falhar, as novas tentativas vêm a cada consulta do Interos e depois de cada ação de usuário; a rotina diária fica como rede de segurança. Teste: `tests/interos-avisos.test.ts`. |
| 3 | Rever o `sync.stale` | **Feito.** Conta desde a última confirmação (retrato recebido, novo ou repetido; consulta do Interos; consulta diária que responde). Só é enviado com a consulta diária configurada. Teste: `licensing` ("reconciliação"). |
| 4 | Código comercial em `license.transition` | **Feito.** Cada item de `changes` traz `code` (por exemplo `07.01`) além de `module`. O histórico de licença (`kind: "transition"`) usa o mesmo formato. Teste: `licensing` ("teste vencido e suspensão programada"). |

## 9. Homologação com o Interos real (27/11/2026)

O Interos (build de produção) foi ligado a esta versão do ERP (build de produção, uma instância, armazenamento local)
com credenciais descartáveis geradas pelo `scripts/interos/credencial.mjs`: uma por família, **um endereço só**.

| Cenário | Resultado |
|---|---|
| Credenciais | `GET /api/interos/v1/status` reconhece cada família; o Interos funciona sem `ERP_INTERCERT_URL_PROVISIONAMENTO` e `ERP_INTERCERT_URL_TORRE` |
| Catálogo | Importado pelo Interos (67 unidades, 62 vendáveis); a diferença para a versão anterior foi registrada |
| Criar empresa pelo Interos | Empresa criada e vinculada; **licença inicial aplicada (v1)**. Na homologação com as branches separadas ela ficava aguardando: a API de licenças não conhecia a empresa |
| Alteração de módulo | 18.10 Conciliação bancária: aplicada pelo ERP (v2) em 0,3 s |
| Avisos do ERP | Dois `license.applied` entregues **na hora**, sem rodar `/api/jobs`, cada um na primeira tentativa; o Interos conferiu e registrou |
| Torre de Controle | Pela credencial da Torre, no mesmo endereço; empresa nova "sem movimento" |
| Suíte do ERP | 1812 de 1812 (memória); typecheck, lint e build de produção limpos |

**Achado fora da integração (já existe na `master`):** a demonstração local (`npm run seed`) parou em 27/11 com
"Estoque insuficiente — CADERNO: disponível 1, vendido 8" num módulo da demonstração que depende da data. Os arquivos
da demonstração são os mesmos da `master`; a produção só é afetada se um `demo-update` rodar numa data assim.

## 10. Homologação com empresas de teste (27/11/2026)

O Interos de produção (`ERP_INTERCERT_AMBIENTE=homologacao`) foi ligado à prévia de homologação deste ERP com as
credenciais `interos-*-hml`. Do lado do Interos, os dados de teste (dois clientes "TESTE HML") foram apagados no fim. O
mesmo resultado, visto do Interos: `docs/central-de-produtos.md`, seção 12.1, no repositório do Interos.

| Cenário | Resultado |
|---|---|
| Vincular empresa existente | A empresa A do piloto, achada pelo CNPJ na API de licenças e vinculada |
| Criar empresa pelo Interos | Empresa `273b6b98…` ("TESTE HML Empresa Nova"), administrador e convite criados. A licença inicial foi recusada (`403 company_not_allowed`): a empresa nova não estava em `empresas` da credencial de licenças. Incluído o id e publicada a prévia, a nova tentativa aplicou a licença versão 1 |
| Convite e pedido de módulo | O administrador ativou o acesso, entrou e pediu 05.02 Cotação com fornecedores; o `upsell.requested` chegou na hora e virou tarefa no Interos |
| Primeira licença pelo Interos | Empresa A: 03.13 com 05.06 por dependência, simulada e aplicada (licença versão 2; o ERP estava na 1) |
| "Basta um" | 02.09 e 02.14 barrados no Interos: exigem 04.01 ou 04.02 |
| Isolamento | A empresa fora da lista da credencial de licenças foi recusada antes de qualquer gravação |
| Torre e uso | Torre de Controle e uso das duas empresas lidos pelas credenciais da Torre e de licenças |
| Avisos | `license.applied` das duas empresas entregues e processados |

Não repetidos nesta rodada: dois usuários na mesma empresa, desligar com pendência e aprovação, falha de assinatura e
teste com data. Passaram na homologação local do Interos (26/11) e nos testes automáticos.

**Para aprovar a homologação** ainda faltam a conferência conjunta do histórico de licença (§6, passo 5) e a validação do
catálogo v2 pelo titular (§5).

Ficam na homologação do ERP:
- a empresa `273b6b98…` e o administrador de teste dela. O Interos apagou o vínculo do lado dele, mas a empresa continua
  com `interosAccountId`. Se ela for apagada, tire o id também de `empresas` da `interos-licencas-hml`;
- a empresa A com 03.13 e 05.06 ligados (licença versão 2).

**Decisão (27/11), revista no mesmo dia:** na produção, a credencial de licenças fica sem `empresas` e alcança só as
empresas ligadas ao Interos (`credenciais.md` §4, correção 16). Com lista, cada empresa criada pelo Interos exigiria
incluir o id e publicar o ERP antes da licença inicial. Sem lista e sem a correção 16, a credencial alcançaria todas as
empresas do ERP, e o Interos vincularia pelo CNPJ uma empresa que nunca deu consentimento.
