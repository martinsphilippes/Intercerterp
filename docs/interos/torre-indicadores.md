# Torre de Controle — indicadores oficiais (consultas analíticas v1)

> Parte do contrato da interface de serviço Interos → ERP (`/api/interos/v1`). Este documento define **cada indicador** que a
> Torre de Controle do Interos consome: rota, escopo, origem no ERP (função e arquivo), fórmula, situações incluídas e
> excluídas, data de referência, fuso, tratamento de cancelamentos, devoluções, descontos, frete e valores ausentes, e
> limites conhecidos. Versão dos indicadores: **`2026-11-v1`** (campo `meta.versaoIndicadores`).
>
> Princípio: a Torre **não tem fórmulas próprias**. Cada número sai da mesma função que alimenta a tela do ERP (painel do
> gestor, relatórios gerenciais, curva ABC, estoque, financeiro, fiscal, compras, comércio digital). O código da Torre
> (`src/domain/tower/*.ts`) só escolhe o recorte (empresa, período, unidades) e traduz para o contrato. O mapeamento
> factual das telas está em `docs/multiempresa/mapeamento/05-indicadores-torre.md` (citado como **mapa 05**).
>
> Todos os exemplos deste documento usam **dados fictícios**.

## Sumário

1. Acesso, convenções e erros
2. Rotas
3. Base comercial (vendas e devoluções) — regras comuns
4. Indicadores por bloco
   - 4.1 Vendas · 4.2 Devoluções · 4.3 Série · 4.4 Por unidade · 4.5 Produtos e SKUs · 4.6 Transações
   - 4.7 PDV · 4.8 Estoque · 4.9 Compras · 4.10 Financeiro · 4.11 Fiscal · 4.12 Comércio digital · 4.13 Adoção
5. Exemplos de resposta (um por rota)
6. Limites conhecidos e decisões
7. Referência por rota (fichas para o contrato): caminho, escopo, parâmetros, paginação, campos com tipo e unidade, data de referência e fuso, erros

---

## 1. Acesso, convenções e erros

### 1.1 Autenticação, escopos e empresa

- Cabeçalho `Authorization: Bearer <id>.<segredo>` (credencial de serviço configurada em `INTEROS_CREDENCIAIS`; ver
  `src/lib/service/credentials.ts`). Opcional: `X-Request-Id` (8 a 100 caracteres `A-Z a-z 0-9 . _ : -`); toda resposta
  devolve `X-Request-Id` e `API-Version: v1`, com `Cache-Control: no-store`.
- Escopos (a rota exige o escopo do **nível de detalhe que entrega**; não há hierarquia entre eles — uma credencial da
  Torre normalmente recebe os três):

  | Escopo | Entrega | Rotas |
  |---|---|---|
  | `torre:resumo` | totais, séries e agregados | `resumo`, `vendas/serie`, `vendas/por-unidade`, `financeiro`, `fiscal`, `compras`, `comercio-digital`, `adocao` |
  | `torre:detalhe` | por produto, por SKU, posição de estoque por SKU e depósito | `produtos`, `skus`, `estoque` |
  | `torre:transacoes` | uma linha por venda ou por devolução | `transacoes/vendas`, `transacoes/devolucoes` |

- **Empresa**: só empresas vinculadas ao Interos (com conta Interos) existem para a Torre (`linkedCompany`,
  `src/domain/tenancy/provisioning.ts`). Qualquer outra — inclusive inexistente — responde `404 nao_encontrado`, antes de
  qualquer validação de parâmetro.
- **Isolamento**: toda leitura usa o contexto técnico restrito à empresa (`systemCtx`, `src/lib/core/ctx.ts` → Store com
  isolamento estrito por empresa, `src/lib/db/scoped-store.ts`). Nenhuma resposta contém registro de outra empresa.
- **Somente leitura**: a Torre não grava nada nos dados da empresa (por exemplo, não expira pedidos on-line pendentes,
  ao contrário da Central do comércio digital — mapa 05 §6.2.8). Cada consulta é contada na trilha de solicitações do
  serviço (`service_requests`, contador diário por credencial, operação e empresa).
- **Limite**: 240 consultas por minuto por credencial (`INTEROS_LIMITE_LEITURA_MINUTO`); acima disso, `429
  limite_excedido` com `Retry-After`.

### 1.2 Convenções do contrato

| Convenção | Regra |
|---|---|
| Nomes | português, camelCase, sem acento |
| Dinheiro | centavos inteiros, sufixo `Centavos` (pode ser negativo: devolução maior que a venda no dia, diferença de caixa, saldo negativo de estoque) |
| Quantidades | milésimos inteiros, sufixo `Milesimos` (1 unidade = 1000). Somas de quantidades misturam unidades de medida diferentes |
| Percentuais | pontos-base inteiros, sufixo `Bps` (1% = 100 bps; arredondamento "metade para longe de zero", `roundDiv` em `src/lib/money.ts`). `PontosBps` = diferença em pontos percentuais (margem atual − margem anterior) |
| Datas de calendário | `AAAA-MM-DD` no fuso do ERP |
| Instantes | ISO-8601 em UTC (`2026-10-01T13:42:10.000Z`) |
| Fuso | único da instalação: `APP_TIMEZONE`, padrão `America/Sao_Paulo` (`src/lib/dates.ts`). Não há fuso por empresa nem por filial (mapa 05 §0.2) |
| Valores de situação | português, minúsculas, sem acento, com `_` (ex.: `concluida`, `em_processamento`, `aguardando_pagamento`). Valor interno desconhecido é repassado como está |
| Ausente | `null` quando o indicador não se aplica (ex.: ticket sem vendas, margem sem receita) ou quando **não há fonte confiável** (documentado em cada campo) |

### 1.3 Parâmetros comuns

| Parâmetro | Regra |
|---|---|
| `de`, `ate` | Obrigatórios nas rotas de período. `AAAA-MM-DD`, inclusivos, `de ≤ ate`, no máximo **400 dias** (o mesmo limite das telas de análise, `MAX_PERIOD_DAYS` em `src/domain/reports.ts`). Recorte técnico: [00:00 local de `de`, 00:00 local do dia seguinte a `ate`) convertido para UTC, com horário de verão (`dayRange`). Diferente das telas, a Torre **não** adota período padrão: data ausente ou inválida é erro |
| `idUnidade` | Opcional. Ids de filial separados por vírgula (ou o parâmetro repetido). Sem ele: todas as filiais da empresa (consolidado). Filial que não pertence à empresa (de outra empresa ou inexistente) → `422 validacao` (`campo: "idUnidade"`) |
| `limite` | Rotas paginadas: inteiro de 1 a 500, padrão 100 |
| `cursor` | Rotas paginadas: valor opaco recebido em `proximoCursor`. Vale só para a mesma rota, empresa, período, unidades e filtros; caso contrário (ou corrompido) → `422 validacao` (`campo: "cursor"`) |

Parâmetros desconhecidos são ignorados. Nas rotas sem paginação, `limite` e `cursor` são ignorados.

### 1.4 `meta` (em toda resposta de sucesso)

```json
"meta": {
  "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa",
  "periodo": { "de": "2026-10-01", "ate": "2026-10-31" },
  "unidades": null,
  "fuso": "America/Sao_Paulo",
  "geradoEm": "2026-11-02T13:15:42.120Z",
  "versaoIndicadores": "2026-11-v1"
}
```

`periodo` é `null` nas rotas sem período (`estoque`, `adocao`); `unidades` é `null` sem filtro de unidade (todas as
filiais) ou a lista validada de ids; `geradoEm` é o instante da consulta (os números refletem o estado do banco nesse
momento — ver §6, retroatividade).

### 1.5 Paginação

Resposta das listas: `{ meta, itens: [...], proximoCursor: string | null, ... }` (`proximoCursor: null` = última página).
A paginação é **por chave** (`src/domain/tower/pagination.ts`): cada lista tem uma ordem total (a última parte da chave é
um id único) e o cursor guarda a chave do último item entregue; a página seguinte começa no primeiro item estritamente
depois dela. Nenhum item se repete nem é pulado; um registro novo que entre "antes" do cursor durante a varredura só
aparece numa nova varredura. As listas trazem também totais da consulta inteira (`totais` ou `curva`), iguais em todas as
páginas.

### 1.6 Erros

Formato único (`src/lib/service/http.ts`):

```json
{ "erro": { "codigo": "validacao", "mensagem": "Há campos inválidos na solicitação.", "campos": [ { "campo": "ate", "mensagem": "Período limitado a 400 dias (o informado tem 431 dias)." } ] }, "requestId": "req_2906b115dddb716f83273e81" }
```

| HTTP | `codigo` | Quando |
|---|---|---|
| 401 | `nao_autenticado` | credencial ausente ou inválida |
| 403 | `sem_permissao` | credencial sem o escopo da rota |
| 404 | `nao_encontrado` | empresa não vinculada ao Interos ou inexistente |
| 422 | `validacao` | parâmetro inválido (`campos` lista **todos** os problemas da solicitação) |
| 429 | `limite_excedido` | limite por minuto |
| 500 | `erro_interno` | erro inesperado (pode repetir) |
| 503 | `servico_nao_configurado` | nenhuma credencial configurada no ERP |

---

## 2. Rotas

Base: `GET /api/interos/v1/empresas/{idEmpresa}/torre/...`. Todas são `GET` (sem `Idempotency-Key`).

| Rota | Escopo | Período | Paginação | Parâmetros próprios | Função (`src/domain/tower/handlers.ts`) |
|---|---|---|---|---|---|
| `resumo` | `torre:resumo` | obrigatório | — | — | `towerSummary` |
| `vendas/serie` | `torre:resumo` | obrigatório | — | `granularidade` = `dia` (padrão) \| `mes` | `towerSalesSeries` |
| `vendas/por-unidade` | `torre:resumo` | obrigatório | — | — | `towerSalesByUnit` |
| `produtos` | `torre:detalhe` | obrigatório | sim | `incluirSemMovimento` = `0` (padrão) \| `1` | `towerProducts` |
| `skus` | `torre:detalhe` | obrigatório | sim | `incluirSemMovimento` = `0` (padrão) \| `1` | `towerSkus` |
| `transacoes/vendas` | `torre:transacoes` | obrigatório | sim | `situacao` = `concluida` (padrão) \| `cancelada` \| `todas` | `towerSaleTransactions` |
| `transacoes/devolucoes` | `torre:transacoes` | obrigatório | sim | — | `towerReturnTransactions` |
| `estoque` | `torre:detalhe` | — (posição atual) | sim | — | `towerStock` |
| `financeiro` | `torre:resumo` | obrigatório | — | — | `towerFinance` |
| `fiscal` | `torre:resumo` | obrigatório | — | — | `towerFiscal` |
| `compras` | `torre:resumo` | obrigatório | — | — | `towerPurchases` |
| `comercio-digital` | `torre:resumo` | obrigatório | — | — | `towerCommerce` |
| `adocao` | `torre:resumo` | — | — | — | `towerAdoption` |

Arquivos de rota: `src/app/api/interos/v1/empresas/[idEmpresa]/torre/<rota>/route.ts`.

**Convenção dos blocos operacionais**: `noPeriodo` segue `de`/`ate`; `posicaoAtual` é a situação no momento da consulta
(independe do período, como nos cartões de situação do painel). Vendas e devoluções são inteiramente do período.

---

## 3. Base comercial (vendas e devoluções) — regras comuns

Vendas, devoluções, série, por unidade, produtos, SKUs e transações usam a **base comercial única** do ERP — a mesma do
painel do gestor, dos relatórios gerenciais, do detalhe por filial, da curva ABC, das metas e do CMV do DRE:
`loadFacts` + `totalsOf` (`src/domain/reports.ts:202` e `:337`; mapa 05 §0.4, regras RBC-1 a RBC-10).

| Regra | Definição |
|---|---|
| Vendas incluídas | `sales.status = "completed"` com `completedAt` no recorte e filial (`branchId`) no filtro. Origem `pdv` e `exchange` (nova venda de uma troca) |
| Cancelamentos | venda `cancelled` **não entra** nos totais; é informada à parte (`canceladas`), pela data de **conclusão** (o cancelamento mantém `completedAt`). Cancelar depois retira a venda do período original (não há fechamento comercial) |
| Itens | `sale_items` da venda (data e filial gravadas no item). Bruto = `grossTotal` (preço × quantidade); desconto = desconto do item (inclui promoção) + rateio do desconto global; acréscimo = acréscimo do item + rateio do acréscimo global |
| Devoluções | `return_items` com data de movimento no recorte, de documentos `completed` ou `processing` (estorno de cartão aguardando a adquirente). Devolução com efeitos pendentes entra pelas linhas do próprio documento. Data e filial **do movimento da devolução**, mesmo que a venda seja anterior ao período — por isso um dia pode ter receita negativa |
| Data de referência | venda: dia local de `completedAt`; devolução: dia local do movimento (`return_items.completedAt` = `returns.createdAt`) |
| Frete e impostos | não são receita de produto (não compõem os itens). Taxas de cartão ficam no financeiro |
| Vale-crédito e pontos | são meio de pagamento, não desconto: não reduzem a receita |
| Custo | custo histórico gravado no item (custo médio vigente na venda; sem custo médio, custo do SKU; senão **0**; serviço = 0). Custo ausente vira 0 e infla a margem — por isso produtos/SKUs devolvem margem `null` sem custo registrado (§4.5) |
| Valores ausentes | números nulos viram 0; categoria ausente = sem categoria; operador ausente = não identificado |
| Agregação | grupos e totais sempre pelas somas (`groupTotals`, `:368`) — nunca média de margens ou tickets |
| Pedidos on-line, NF-e de pedido de venda, NF-e avulsa | **não geram `sales`**: ficam fora da base comercial (RBC-8). O comércio digital aparece à parte (§4.12 e `vendas.porCanal`) |

Fórmulas (`totalsOf`): `receitaAntesDevolucoes = bruto − descontos + acréscimos`; `receitaLiquida = receitaAntesDevolucoes
− devoluções`; `cmv = custoVendas − custoDevolucoes`; `lucroBruto = receitaLiquida − cmv`; `margemBrutaBps = lucroBruto ×
10000 ÷ receitaLiquida` (`null` se `receitaLiquida ≤ 0`); `ticketMedio = receitaLiquida ÷ quantidadeVendas` (`null` sem
vendas); `quantidadeVendas` = vendas distintas com ao menos uma linha no recorte; `quantidadeDevolucoes` = documentos de
devolução distintos.

---

## 4. Indicadores por bloco

### 4.1 Vendas — bloco `vendas` de `resumo`

Rota `resumo` · escopo `torre:resumo` · origem `commercialOverview` (`src/domain/reports.ts:459`; Torre:
`salesSummary`/`salesFigures`, `src/domain/tower/sales.ts`) · referência e fuso conforme §3 · filtro `idUnidade` aplicado.
É exatamente o cartão comercial do painel do gestor e o topo dos relatórios gerenciais para o mesmo período e filiais.

| Campo | Fórmula / origem | Inclui / exclui |
|---|---|---|
| `receitaBrutaCentavos` | Σ `sale_items.grossTotal` (`Totals.gross`) | vendas concluídas; exclui canceladas |
| `descontosCentavos` | Σ (`itemDiscount` + `globalDiscount`) (`discounts`) | inclui desconto de promoção; vale-crédito/pontos não são desconto |
| `acrescimosCentavos` | Σ `surcharge` (`surcharges`) | |
| `receitaAntesDevolucoesCentavos` | bruto − descontos + acréscimos (`salesNet`) | |
| `devolucoesCentavos` | Σ valor devolvido (`returns`) | devoluções `completed` e `processing` com movimento no período |
| `receitaLiquidaCentavos` | antes − devoluções (`netRevenue`) = "Vendas líquidas (faturamento)" do painel | frete fora |
| `custoVendasCentavos` · `custoDevolucoesCentavos` | Σ custo histórico dos itens vendidos · Σ custo revertido nas devoluções | custo ausente = 0 |
| `custoMercadoriaVendidaCentavos` | custoVendas − custoDevolucoes (`cmv`) | |
| `lucroBrutoCentavos` | receitaLiquida − cmv (`grossProfit`) | |
| `margemBrutaBps` | `marginBps(receitaLiquida, cmv)`; `null` se receita ≤ 0 | |
| `quantidadeVendas` | vendas distintas com linhas (`salesCount`) | devolução não reduz a contagem |
| `quantidadeDevolucoes` | documentos distintos (`returnsCount`) | |
| `ticketMedioCentavos` | `roundDiv(receitaLiquida, quantidadeVendas)`; `null` sem vendas | |
| `quantidadeVendidaMilesimos` · `quantidadeDevolvidaMilesimos` · `quantidadeLiquidaMilesimos` | Σ quantidades (`qtySold`, `qtyReturned`, `qtyNet`) | unidades de medida misturadas |
| `canceladas.quantidade` · `canceladas.valorCentavos` | vendas `cancelled` com `completedAt` no período: contagem e Σ `sales.total` (aviso "N venda(s) cancelada(s)" do painel) | referência = data de conclusão, não a do cancelamento |
| `periodoAnterior` | mesmos campos no período imediatamente anterior com a mesma quantidade de dias (`previousPeriod`); traz `de`/`ate` | ex.: 01–31/10 compara com 31/08–30/09 |
| `variacao.receitaLiquidaBps` · `quantidadeVendasBps` · `ticketMedioBps` | `variationBps(atual, anterior)` = (atual − anterior) × 10000 ÷ \|anterior\|; `null` com anterior 0 ou nulo | |
| `variacao.margemBrutaPontosBps` | margem atual − margem anterior (pontos), `null` se alguma for `null` | |
| `porCanal.pdv` | `receitaLiquidaCentavos`, `quantidadeVendas`, `ticketMedioCentavos`, `devolucoesCentavos` — a base comercial inteira é PDV (inclui trocas) | igual ao total do bloco |
| `porCanal.comercioDigital` | pedidos on-line **pagos no período** (§4.12): `quantidadePedidosPagos`, `valorPedidosPagosCentavos` (com frete), `freteCentavos`, `incluidoNaReceitaLiquida: false`; `null` sem loja virtual | **não somado** à receita líquida (RBC-8) |
| `porCanal.pedidoDeVenda` | sempre `null`: NF-e de pedido de venda/avulsa não gera venda comercial e não há indicador oficial (mapa 05 §6.1-1) | sem fonte |

Limites: venda grande pode ter itens gravados depois pela tarefa `sale.effects` — a venda já conta, mas receita, custo e
quantidade sobem quando os itens restantes são gravados (mapa 05 §6.2.4).

### 4.2 Devoluções — bloco `devolucoes` de `resumo`

Rota `resumo` · escopo `torre:resumo` · origem: as linhas de devolução da mesma base (`loadFacts`), agregadas por
`groupTotals` · referência: data e filial do movimento da devolução.

| Campo | Fórmula / origem | Observação |
|---|---|---|
| `valorCentavos` · `quantidadeDocumentos` · `custoRevertidoCentavos` · `quantidadeItensMilesimos` | `returns`, `returnsCount`, `costReturned`, `qtyReturned` | iguais a `vendas.devolucoesCentavos`/`quantidadeDevolucoes` |
| `deVendasAnterioresAoPeriodo` | devoluções cuja venda original é anterior ao início do período (mesma marcação `priorSale` do detalhe por filial, `branchOperations`) | |
| `porSituacao[]` | `situacao` (`concluida`, `em_processamento`), `valorCentavos`, `quantidadeDocumentos`, `custoRevertidoCentavos` | `em_processamento` = estorno de cartão aguardando a adquirente (a mercadoria já voltou) |
| `porTipo[]` | `tipo` (`devolucao`, `troca`) | troca = devolução + nova venda `origem: troca` (que conta em vendas) |

Excluídas: devoluções canceladas. Diferença conhecida: a listagem "Devoluções" da tela usa `returns.createdAt`, todos os
status e `itemsTotal`; o histórico de vendas atribui a devolução à venda original (mapa 05 §6.2.5, linhas 7 e 8). A Torre
segue a regra oficial (painel/gerenciais).

### 4.3 Série — `vendas/serie`

Escopo `torre:resumo` · `granularidade=dia`: `managerialReport(...).byDay` (`src/domain/reports.ts:505`) — todos os dias do
período, inclusive sem movimento; `granularidade=mes`: `loadFacts` + `groupTotals` por mês (`AAAA-MM` do dia local). Cada
item traz os mesmos campos de `salesFigures` do §4.1 (sem `canceladas`, `periodoAnterior`, `variacao`, `porCanal`), mais
`data` (dia) ou `mes` + `de` + `ate` (mês; o primeiro e o último mês podem ser parciais, limitados ao período). `total` = os
mesmos campos para o período inteiro. Não paginada (no máximo 400 pontos). Um dia pode ter receita negativa (só devolução).

### 4.4 Por unidade — `vendas/por-unidade`

Escopo `torre:resumo` · origem `managerialReport(..., { compare: true, branchIds })`: `byBranch` (todas as filiais do
recorte, **inclusive sem movimento**, ordenadas pelo nome) e `previousByBranch`. Item: `idUnidade`, `codigo`, `nome`,
`situacaoUnidade` (`ativa`/`inativa`), campos de `salesFigures`, `periodoAnterior` (`receitaLiquidaCentavos`,
`quantidadeVendas`, `ticketMedioCentavos`, `margemBrutaBps`) e `variacao` (§4.1). `total` = totais do recorte
(margem e ticket pelos totais, nunca média das unidades); `periodoAnterior` = total do período anterior. Devolução conta
na filial onde foi registrada.

### 4.5 Produtos e SKUs — `produtos` e `skus`

Escopo `torre:detalhe` · paginadas · ordem: receita líquida (desc), quantidade líquida (desc), código (asc), id (asc) — a
ordem da curva ABC.

**SKUs** — origem `abcReport` (`src/domain/abc.ts:150`), critério receita líquida, com limites `getAbcLimits` (`:36`:
parâmetros `abc.limitA`/`abc.limitB` da empresa — padrão 80%/95% —, ou da filial quando `idUnidade` tem uma única filial,
como na tela). Classe, posição, participação e acumulado são **os mesmos da tela Curva ABC** para o mesmo recorte.
**Produtos** — mesmas linhas da base agrupadas por produto (`groupTotals` por `productId`) e a mesma política de
classificação (`classifyAbc`, `:91`, mesmos limites). A tela não tem curva por produto: é a aplicação da mesma política
ao agregado por produto (as classes por produto não precisam coincidir com as dos SKUs).

| Campo | Fórmula / origem | Observação |
|---|---|---|
| `idSku`, `codigoSku`, `descricao`, `unidadeMedida` (SKUs) · `idProduto`, `codigoProduto`, `nomeProduto`, `quantidadeSkusComMovimento` (produtos) | metadados da linha de venda (retrato do item) ou do cadastro | produto sem cadastro: `idProduto: null`, "Produto não identificado" |
| `idCategoria`, `nomeCategoria` | SKUs: categoria gravada no item; produtos: categoria atual do cadastro | |
| `receitaBrutaCentavos` … `receitaLiquidaCentavos`, `quantidade*Milesimos`, `quantidadeVendas` | `totalsOf` do agrupamento (§3) | |
| `custoRegistrado` | há custo histórico nas vendas do período (`custoVendas > 0`) | |
| `custoMercadoriaVendidaCentavos`, `lucroBrutoCentavos`, `margemBrutaBps` | `cmv`, `grossProfit`, `marginBps` — **`null` sem custo registrado** | a tela da curva ABC mostra a margem mesmo com custo 0 (100%); a Torre não devolve margem inflada |
| `classeAbc` | `A`/`B`/`C` pelo acumulado **anterior** ao item (< limite A → A; < limite B → B; senão C); `null` = sem classe (receita ≤ 0) | |
| `posicaoAbc` | posição na curva (1 = maior receita); `null` sem classe | |
| `participacaoBps` · `acumuladoBps` | receita do item ÷ receita da base da curva; acumulado incluindo o item | denominador = base inteira da curva, nunca a página |
| `semMovimento` | SKU ativo (de produto ativo) / produto ativo sem venda nem devolução no período | só aparecem com `incluirSemMovimento=1` |
| `curva` | `criterio`, `limites` (`classeABps`, `classeBBps`), `receitaLiquidaCentavos` (= receita do recorte), `receitaNaCurvaCentavos`, `receitaForaDaCurvaCentavos`, `classes.A/B/C` (`quantidade`, `receitaLiquidaCentavos`, `participacaoBps`), `semClasse` (`comMovimento`, `semMovimento`) | reconciliação: na curva + fora da curva = receita líquida do resumo |

### 4.6 Transações — `transacoes/vendas` e `transacoes/devolucoes`

Escopo `torre:transacoes` · paginadas · origem `branchOperations` (`src/domain/reports.ts:658`) — as **mesmas operações**
que formam os totais: Σ `valorLiquidoCentavos` das vendas concluídas − Σ `valorCentavos` das devoluções = receita líquida
do resumo. Ordem: instante (asc), id (asc). **Dados pessoais**: nenhuma transação traz nome, CPF/CNPJ, e-mail, telefone ou
endereço de cliente — só `idCliente` (quando houver); operador e vendedor só por id.

Venda (`transacoes/vendas`): `idVenda`, `numero`, `situacao` (`concluida`/`cancelada`), `origem` (`pdv`/`troca`), `canal`
(`pdv`), `idUnidade`, `idTerminal`, `idSessaoCaixa`, `idOperador`, `idVendedor`, `idCliente`, `situacaoFiscal`
(situação do documento fiscal da venda: `autorizado`, `pendente`, `nao_exigido`…), `idDocumentoFiscal`, `concluidaEm`
(instante), `data` (dia local), `canceladaEm`, `quantidadeLinhas` (itens considerados no período), `quantidadeItensVenda`
(itens da venda — maior que `quantidadeLinhas` enquanto a tarefa `sale.effects` não gravou todos), `receitaBrutaCentavos`,
`descontosCentavos`, `acrescimosCentavos`, `valorLiquidoCentavos` (bruto − descontos + acréscimos), `custoCentavos`,
`margemBrutaBps` (da venda; `null` sem receita). Canceladas (`situacao=cancelada|todas`): valores do documento da venda
(`subtotal`, `discountTotal`, `surchargeTotal`, `total`, `costTotal`), `quantidadeLinhas: null`, `margemBrutaBps: null`,
pela data de conclusão. `totais`: `concluidas` (`quantidade`, `valorLiquidoCentavos`) e `canceladas` (`null` com
`situacao=concluida`).

Devolução (`transacoes/devolucoes`): `idDevolucao`, `numero`, `tipo` (`devolucao`/`troca`), `situacao`
(`concluida`/`em_processamento`), `compensacao` (`vale_credito`, `troca`, `reembolso`), `formaReembolso` (`dinheiro`,
`pix`, `conta`, `estorno_cartao`; só com reembolso), `idUnidade`, `idCliente`, `registradaEm` (instante do movimento),
`data`, `idVendaOriginal`, `numeroVendaOriginal`, `vendaOriginalEm`, `vendaAnteriorAoPeriodo`, `quantidadeLinhas`,
`valorCentavos`, `custoRevertidoCentavos`, `valorAbatidoTituloCentavos` (parte abatida do título a prazo; `null` em
devoluções antigas sem o registro). `totais`: `quantidade`, `valorCentavos`, `custoRevertidoCentavos`.

### 4.7 PDV — bloco `pdv` de `resumo`

Escopo `torre:resumo` · origem `querySessions` (`src/app/(app)/caixa/queries.ts:18`, a listagem de Caixa) e
`openCashSessions` (`src/app/(app)/dashboard/queries.ts:40`, situação do caixa no topo do painel).

| Campo | Fórmula / origem | Referência |
|---|---|---|
| `noPeriodo.caixasAbertos` | sessões de caixa com abertura (`openedAt`) no período | dia local da abertura |
| `noPeriodo.caixasFechados` | dessas, as fechadas (`status = closed`) | |
| `noPeriodo.caixasComDiferenca` | fechadas com diferença registrada no fechamento (`differences` não vazio) | |
| `noPeriodo.diferencaTotalCentavos` | Σ diferenças (contado − previsto, todos os meios) das fechadas | sessão aberta não tem diferença |
| `noPeriodo.sobrasCentavos` · `faltasCentavos` | Σ das sessões com diferença total positiva · negativa (negativo) | por sessão, não por meio |
| `posicaoAtual.caixasEmAberto` | sessões `open`/`reopened` agora | |
| `posicaoAtual.caixasAbertosDeDiasAnteriores` | abertas com abertura anterior a hoje (alerta "Caixa aberto desde…") | |
| `posicaoAtual.terminaisAtivos` | terminais `active` das unidades | |

Notas: a conferência cega não se aplica (a Torre lê como supervisor técnico, sem ocultar o previsto). Diferenças por meio
de pagamento e justificativas não são expostas na v1. Não há atividade de terminal (sem registro de atividade/heartbeat).

### 4.8 Estoque — bloco `estoque` de `resumo` e rota `estoque`

Escopo `torre:resumo` (bloco) e `torre:detalhe` (rota) · **posição atual** (não segue o período) · origem `queryBalances`
(`src/app/(app)/estoque/queries.ts:93`, tela Saldos de estoque, com "Todas as filiais") e `stockAlerts`
(`src/app/(app)/dashboard/queries.ts:79`). Granularidade do ERP: um saldo por SKU × depósito; cada depósito pertence a
uma unidade (inclui depósitos de avarias e de uso e consumo, como a tela).

| Campo (bloco `estoque.posicaoAtual`) | Fórmula / origem |
|---|---|
| `saldos` | quantidade de saldos (SKU × depósito) |
| `valorCentavos` | Σ `roundDiv(físico × custo médio, 1000)` — "Valor em estoque" da tela; **saldo negativo gera valor negativo** (o inventário em data-base não valoriza negativo — mapa 05 §6.2.5-18) |
| `fisicoMilesimos` · `reservadoMilesimos` · `disponivelMilesimos` · `emTransitoMilesimos` | Σ físico, reservado, disponível (= físico − reservado), em trânsito (unidades misturadas) |
| `abaixoDoMinimo` | saldos com mínimo > 0 e disponível ≤ mínimo (situação "Abaixo do mínimo" da tela = total de alertas do painel; inclui as rupturas) |
| `rupturas` | desses, os com disponível ≤ 0 (alerta "sem estoque" do painel; o painel mostra "abaixo do mínimo" = `abaixoDoMinimo − rupturas`) |
| `saldosZerados` · `saldosNegativos` | físico = 0 · físico < 0 (situações "Sem saldo" e "Negativo") |

Rota `estoque` (paginada; ordem: código do SKU, unidade, depósito, id): `idSaldo`, `idSku`, `codigoSku`, `descricaoSku`,
`idProduto`, `nomeProduto`, `idCategoria`, `produtoAtivo`, `unidadeMedida`, `idUnidade`, `idDeposito`, `nomeDeposito`,
`tipoDeposito` (`disponivel`, `avarias`, `uso_consumo`), `fisicoMilesimos`, `reservadoMilesimos`, `disponivelMilesimos`,
`emTransitoMilesimos`, `aChegarMilesimos` (entradas previstas com nota a confirmar), `minimoMilesimos`, `custoMedioCentavos`
(por unidade = 1000 milésimos), `valorCentavos`, `abaixoDoMinimo`, `ultimoMovimentoEm`. `totais`: `saldos`, `valorCentavos`,
`fisicoMilesimos`, `reservadoMilesimos`, `disponivelMilesimos`, `abaixoDoMinimo`. O custo médio absorve frete e despesas da
entrada. Não há série histórica, giro nem cobertura na v1 (mapa 05 §6.1-6).

### 4.9 Compras — bloco `compras` de `resumo` e rota `compras`

Escopo `torre:resumo` · origem `queryOrders` (`src/app/(app)/compras/pedidos/queries.ts:23`) e `queryReceipts`
(`src/app/(app)/compras/recebimentos/queries.ts:11`), com os critérios dos indicadores das telas Pedidos de compra
(`compras/pedidos/page.tsx:46-53`) e Recebimentos (`compras/recebimentos/page.tsx:30-38`).

| Campo | Fórmula / origem | Referência / diferença da tela |
|---|---|---|
| `noPeriodo.pedidosCriados` (`quantidade`, `valorCentavos`) | pedidos criados no período, **exceto cancelados**; Σ `total` | `createdAt` no fuso do ERP (a tela usa o mês UTC) |
| `noPeriodo.pedidosRecebidos` (`quantidade`, `noPrazo`) | pedidos `received` com última alteração no período; no prazo = sem previsão ou concluído até a previsão | `updatedAt` (aproximação da tela: é a última alteração do pedido); `noPrazo` compara a data UTC de `updatedAt`, como a tela |
| `noPeriodo.recebimentosConfirmados` (`quantidade`, `valorDevidoCentavos`, `valorFaturadoCentavos`) | recebimentos `confirmed` com `confirmedAt` no período; Σ devido (recebido) e Σ faturado (NF-e) | tela "Entradas confirmadas no mês" (mês UTC) |
| `posicaoAtual.aguardandoAprovacao` | pedidos `in_review`: quantidade e Σ `total` | |
| `posicaoAtual.aReceber` | pedidos `approved`/`sent`/`partial`: `quantidade`, `valorRestanteCentavos` (Σ max(0, total − recebido)), `atrasados` (previsão vencida), `previstosProximos7Dias` | |
| `posicaoAtual.recebimentosEmConferencia` | recebimentos `draft`/`confirming`: quantidade e Σ faturado | |
| `posicaoAtual.recebimentosComDivergencia` | recebimentos não cancelados com divergência registrada | |
| `posicaoAtual.aguardandoNota` | entradas com nota a confirmar: `quantidade`, `valorProvisorioCentavos` (Σ devido), `comPrazoVencido` (prazo da nota vencido, exceto entradas previstas) | |
| rota `compras`: `noPeriodo.pedidosCriadosPorSituacao[]`, `posicaoAtual.pedidosPorSituacao[]`, `posicaoAtual.recebimentosPorSituacao[]` | `situacao`, `quantidade`, `valorCentavos` (pedidos: Σ `total`, inclusive cancelados; recebimentos: Σ devido, exceto cancelados) | situações: `rascunho`, `em_analise`, `em_ajuste`, `aprovado`, `enviado`, `parcial`, `recebido`, `rejeitado`, `cancelado`; recebimentos: `rascunho`, `em_confirmacao`, `confirmado`, `previsto` |

Valores de compra: `total` do pedido inclui frete, despesas, IPI e seguro do pedido. Fornecedores não são expostos.

### 4.10 Financeiro — bloco `financeiro` de `resumo` e rota `financeiro`

Escopo `torre:resumo` · origem `installmentKpis` (`src/app/(app)/financeiro/queries.ts:191`, indicadores das Contas a
receber/pagar), `financeSnapshot` (`src/app/(app)/dashboard/queries.ts:98`, "Saldo disponível" do painel),
`computeAging` e `computeDre` (`src/domain/finance-reports.ts:285` e `:113`, Relatórios financeiros).

| Campo | Fórmula / origem | Referência / inclui-exclui |
|---|---|---|
| `noPeriodo.recebido` · `noPeriodo.pago` (`quantidadeBaixas`, `valorCentavos`) | baixas (`settlements.kind = settlement`, vigentes) com data no período, de títulos a receber · a pagar; Σ `total` **com encargos** (juros, multa; menos desconto concedido) | mesma regra de "Recebido/Pago no mês" das contas a receber/pagar, com o intervalo `de`/`ate` (`settledInPeriod`, `src/domain/tower/operations.ts`). Exclui abatimentos por devolução. **Não inclui** vendas à vista em dinheiro/Pix (entram direto em conta, sem título) |
| `posicaoAtual.dataReferencia` | hoje (fuso do ERP) | |
| `posicaoAtual.aReceber` · `aPagar`: `emAberto`, `vencido`, `venceHoje`, `proximos7Dias` (`quantidade`, `valorCentavos`) | parcelas `open`/`partial` pelo **saldo**: todas · vencimento < hoje · = hoje · > hoje e ≤ hoje + 7 | títulos "previstos"/"provisórios" não são distinguidos (mapa 05 §1.3) |
| `posicaoAtual.aPagar.aAutorizar` | parcelas abertas de títulos a pagar com aprovação pendente | |
| `posicaoAtual.saldoContasCentavos` | Σ saldo das contas financeiras **ativas** das unidades + contas compartilhadas (sem filial) | o fluxo de caixa inclui contas inativas (mapa 05 §6.2.5-15) |
| rota: `noPeriodo.dre` | DRE gerencial por competência: `receitaLiquidaCentavos`, `lucroBrutoCentavos`, `resultadoOperacionalCentavos`, `resultadoCentavos`, `cmvCentavos` (negativo), `grupos[]` e `foraDoResultado[]` (`grupo`, `rotulo`, `valorCentavos`), `conferenciaDiferencaCentavos` (deve ser 0), `itensSemClassificacao` | base financeira (títulos pela competência + lançamentos diretos); CMV pela base comercial. **Difere da receita comercial**: vale-crédito/pontos não são receita, pedidos on-line e NF-e sem categoria vão para "Outras receitas" (mapa 05 §2.5, §6.2.5-4) |
| rota: `posicaoAtual.aging.aReceber` · `aPagar` | `dataReferencia`, `totalCentavos`, `vencidoCentavos`, `faixas[]` (`a_vencer`, `de_1_a_30_dias`, `de_31_a_60_dias`, `de_61_a_90_dias`, `acima_de_90_dias`: `valorCentavos`, `quantidadeParcelas`) | parcelas com saldo > 0 de títulos não cancelados, pelo saldo atual |
| rota: `posicaoAtual.contas[]` | `idConta`, `nome`, `tipo` (`caixa`, `banco`, `carteira_digital`), `compartilhada`, `saldoCentavos` | contas ativas do recorte |

Unidades: sem `idUnidade`, entram também parcelas, baixas e contas sem filial; com `idUnidade`, só as das unidades (exceto
contas compartilhadas, que sempre entram no saldo; e o DRE, que com várias unidades inclui os itens sem filial — regra da
tela). Datas de vencimento, competência e baixa são datas de calendário (já no dia local).

### 4.11 Fiscal — bloco `fiscal` de `resumo` e rota `fiscal` (mesmo corpo)

Escopo `torre:resumo` · origem `fiscalSnapshot` (`src/app/(app)/dashboard/queries.ts:135`, resumo fiscal do painel, com
`FISCAL_BUCKETS`) e Relatórios fiscais (`src/domain/fiscal/reports.ts`: `periodDocuments` `:49`, `summarize` `:79`,
`cancellations` `:303`, `rejections` `:312`, `PENDING_STATES`).

| Campo | Fórmula / origem | Referência / inclui-exclui |
|---|---|---|
| `noPeriodo.autorizadas` (`quantidade`, `valorCentavos`) | documentos `authorized` **agora** com `authorizedAt` no período, **sem simulação**; Σ `total` | regra do painel. Autorizado e cancelado depois sai. Homologação conta como autorizada |
| `noPeriodo.simuladas` | idem, só documentos do provedor de simulação (sem validade fiscal) | |
| `noPeriodo.documentosEmitidos` · `documentosEmitidosSimulados` | documentos com `issuedAt` no período, exceto inutilizações; simulação **incluída** (padrão dos relatórios fiscais) | |
| `noPeriodo.faturamentoFiscal` (`brutoCentavos`, `devolucoesCentavos`, `liquidoCentavos`, `documentos`) | Σ notas autorizadas de saída emitidas no período, exceto devolução e não receita (transferência, CFOP de remessa/retorno; nota mista só itens de venda); devoluções = NF-e de entrada autorizada com finalidade devolução; líquido = bruto − devoluções | o valor do documento **inclui frete, seguro, outras despesas e ICMS-ST** e abrange pedidos on-line e NF-e de pedido — não é a receita comercial |
| `noPeriodo.pendentesEntreEmitidos` | emitidos no período em `draft`, `pending`, `queued`, `processing`, `rejected`, `error`: quantidade e Σ `total` | regra dos relatórios fiscais |
| `noPeriodo.rejeicoes` | eventos de envio/consulta rejeitados ou denegados no período (inclusive de documentos depois corrigidos) | data do evento |
| `noPeriodo.cancelamentos` | documentos cancelados com `cancelledAt` no período: quantidade e Σ `total` | data do cancelamento |
| `noPeriodo.porModelo[]` | por `modelo` (`nfce`, `nfe`, `nfse`): `autorizadas`, `simuladas`, `emitidos`, `porSituacao[]` (`situacao`, `quantidade`, `valorCentavos` dos emitidos no período, pela situação atual), `faturamentoFiscalBrutoCentavos`, `rejeicoes`, `cancelamentos` | |
| `posicaoAtual.pendencias` (`pendentes`, `processando`, `rejeitados`) e `posicaoAtual.porModelo[]` | **estado atual, sem recorte de data**: pendentes = `pending`, `draft`, `contingency`; processando = `queued`, `processing`; rejeitados = `rejected`, `denied`, `error` | regra do painel (`FISCAL_BUCKETS`) |

Situações: `rascunho`, `pendente`, `na_fila`, `processando`, `autorizado`, `rejeitado`, `denegado`, `erro`, `cancelado`,
`contingencia`, `inutilizado`, `descartado`. Documentos sem filial só entram sem `idUnidade`.

### 4.12 Comércio digital — bloco `comercioDigital` de `resumo` e rota `comercio-digital`

Escopo `torre:resumo` · origem: pedidos da loja virtual da empresa (`online_orders`, loja por `storeOfCompany`,
`src/domain/ecommerce/common.ts:95`; situações em `common.ts`), `bankOverview` (`src/domain/ecommerce/bank.ts:39`) e
`monitorCounts` (`src/domain/ecommerce/monitor.ts:26`). **Fora da base comercial** do PDV (RBC-8): não há venda comercial
para pedido on-line; os pedidos entram no estoque (baixa na expedição/retirada), no fiscal (NF-e) e no financeiro
(recebível do gateway).

| Campo | Fórmula / origem | Referência / inclui-exclui |
|---|---|---|
| `lojaCriada` · `situacaoLoja` | loja existe · `rascunho`/`publicada`/`pausada` | sem loja: `noPeriodo` e `posicaoAtual` = `null` |
| `noPeriodo.pedidosCriados` | pedidos criados no período **exceto cancelados**: quantidade e Σ `total` | mesma regra do cartão "Pedidos hoje" da Central, mas no período e no fuso do ERP (a Central usa o dia UTC); inclui pedidos aguardando pagamento |
| `noPeriodo.pedidosPagos` (`quantidade`, `valorCentavos`, `freteCentavos`, `descontosCentavos`) | pedidos com pagamento aprovado (`paidAt`) no período e não cancelados; Σ `total`, `shippingAmount`, `discount` | **receita do comércio digital** da Torre (sem indicador oficial na tela — mapa 05 §6.1-1). `total` = subtotal − cupom + frete (**inclui frete**), bruto das taxas do gateway |
| `noPeriodo.pedidosCancelados` | pedidos cancelados com `cancelledAt` no período | |
| `noPeriodo.porSituacao[]` | pedidos criados no período, pela situação atual (inclui cancelados): `situacao`, `quantidade`, `valorCentavos` | |
| `posicaoAtual.aguardandoPagamento` · `aFaturar` · `aExpedirOuRetirar` · `devolucoesSolicitadas` | contagens atuais: `pending_payment` · `paid` · `invoiced` + `ready_for_pickup` · `return_requested` | cartões da Central e da tela Pedidos |
| rota: `posicaoAtual.porSituacao[]` | todos os pedidos, pela situação atual | |
| rota: `posicaoAtual.banco` | `previstoLiquidoCentavos`, `creditadoLiquidoCentavos`, `conciliadoLiquidoCentavos`, `transacoesConciliadas`, `brutoCentavos`, `taxasCentavos`, `disponivelCentavos`, `simulado` | visão do Banco da loja **sem recorte de período** (como a tela), até 5000 transações, exclui estornadas |
| rota: `posicaoAtual.monitor` | `falhas`, `pendentes`, `concluidos`, `ignorados`, `total` dos eventos do monitor das integrações | até 5000 eventos lidos sem ordenação (herdado da tela) |

Situações do pedido: `aguardando_pagamento`, `pago`, `faturado`, `pronto_para_retirada`, `despachado`, `entregue`,
`cancelado`, `devolucao_solicitada`, `devolvido`. Filtro de unidade: pela filial que atende o pedido. Dados do comprador
nunca são expostos. A Torre não expira pedidos vencidos (só a Central e a rotina diária): pedido com prazo de pagamento
vencido pode aparecer como `aguardando_pagamento` até a rotina rodar.

### 4.13 Adoção — rota `adocao`

Escopo `torre:resumo` · sem período · origem `src/domain/tower/adoption.ts` sobre as fontes do mapa 05 §5. `idUnidade`
vale para os sinais operacionais (venda, caixa, estoque, fiscal, pedido on-line, terminais, pendências fiscais); os sinais
de usuário são da empresa.

| Campo | Fonte | Confiabilidade / regra |
|---|---|---|
| `ultimaAtividade.em` (`fonte: "auditoria"`) | `audit_logs` da empresa: instante do registro mais recente feito por usuário | registra **operações** (venda, caixa, cadastros, exportações, parâmetros…), não navegação nem leitura. Excluídos: tarefas do sistema (`system`), a interface de serviço (`servico:*`) e registros de login (o login é gravado na primeira empresa do usuário, não na empresa em que entrou). Sem registro nos últimos 30 dias, procura entre os 200 registros anteriores; senão `null` |
| `ultimoAcesso.em` (`fonte: "login"`) | maior `users.lastAccessAt` dos usuários vinculados à empresa | atualizado **só no login**; campo global do usuário (com várias empresas, o login pode ter sido em outra) |
| `usuarios` (`total`, `ativos`, `convitesPendentes`, `convitesExpirados`, `suspensos`, `inativos`, `nuncaAcessaram`) | `userStats` (`src/domain/users.ts`), indicadores da tela de usuários | usuários vinculados à empresa (isolamento estrito); vendedores sem acesso ao sistema não contam |
| `usuariosAtivos.ultimos7Dias` · `ultimos30Dias` (`fonte: "auditoria"`) | usuários distintos com registro de auditoria (mesmos critérios de `ultimaAtividade`) nas últimas 168 h / 720 h | quem só consulta telas não aparece |
| `usuariosComAcesso.ultimos7Dias` · `ultimos30Dias` (`fonte: "login"`) | usuários vinculados com `lastAccessAt` na janela | mesmas ressalvas de `ultimoAcesso` |
| `atividadeOperacional.ultimaVenda` (`em`, `idUnidade`, `situacao`) | venda mais recente por `completedAt` ("Últimas vendas" do painel, qualquer situação) | |
| `atividadeOperacional.ultimaAberturaCaixaEm` · `ultimoMovimentoEstoqueEm` · `ultimoDocumentoFiscalEm` · `ultimoPedidoOnlineEm` | maior `cash_sessions.openedAt` · `stock_movements.occurredAt` · `fiscal_documents.issuedAt` (inclui simulação) · `online_orders.createdAt` | fontes primárias de uso real |
| `terminais.ativos` · `terminais.ultimaAtividadeEm` | terminais `active` · **`null`** | sem fonte confiável: o terminal não registra atividade própria (sem heartbeat) |
| `pendenciasIntegracao.documentosFiscais` | `pendentes`, `processando`, `rejeitados` — mesmo critério de `fiscal.posicaoAtual.pendencias` | estado atual |
| `pendenciasIntegracao.comercioDigital` | `falhas`, `pendentes` do monitor do comércio digital; `null` sem loja | até 5000 eventos (herdado) |
| `pendenciasIntegracao.tarefas` | tarefas duráveis da empresa: `comFalhaEmNovaTentativa` (`retry`), `esgotadas` (`dead`), `travadas` (`running` com trava vencida), `retidas` (`held`, empresa suspensa) | inclui todos os tipos (`sale.effects`, `return.effects`, `fiscal.*`, `finance.account.rebuild`…), não só os que a Central de integrações mostra |
| `pendenciasIntegracao.rotinasComFalha` | **`null`** | sem fonte confiável: só o último sucesso das rotinas diárias é gravado |

---

## 5. Exemplos de resposta (dados fictícios)

Todos os exemplos: empresa `0b90b70e6fdbf0663f40978c3454eaaa`, unidades `a500b5d9c811e32f05c2e62dff930fbc` (Matriz, código
01) e `d76c60d5a4e16fe83b06d5f9878f93d0` (Filial, código 02), período de 01/10/2026 a 31/10/2026 salvo indicação.

### 5.1 `GET .../torre/resumo?de=2026-10-01&ate=2026-10-31`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "vendas": {
    "receitaBrutaCentavos": 1250000, "descontosCentavos": 37500, "acrescimosCentavos": 2500, "receitaAntesDevolucoesCentavos": 1215000,
    "devolucoesCentavos": 45000, "receitaLiquidaCentavos": 1170000, "custoVendasCentavos": 520000, "custoDevolucoesCentavos": 18000,
    "custoMercadoriaVendidaCentavos": 502000, "lucroBrutoCentavos": 668000, "margemBrutaBps": 5709, "quantidadeVendas": 96, "quantidadeDevolucoes": 3,
    "ticketMedioCentavos": 12188, "quantidadeVendidaMilesimos": 214000, "quantidadeDevolvidaMilesimos": 4000, "quantidadeLiquidaMilesimos": 210000,
    "canceladas": { "quantidade": 2, "valorCentavos": 8990 },
    "periodoAnterior": {
      "de": "2026-08-31", "ate": "2026-09-30",
      "receitaBrutaCentavos": 1100000, "descontosCentavos": 30000, "acrescimosCentavos": 0, "receitaAntesDevolucoesCentavos": 1070000,
      "devolucoesCentavos": 20000, "receitaLiquidaCentavos": 1050000, "custoVendasCentavos": 470000, "custoDevolucoesCentavos": 8000,
      "custoMercadoriaVendidaCentavos": 462000, "lucroBrutoCentavos": 588000, "margemBrutaBps": 5600, "quantidadeVendas": 90, "quantidadeDevolucoes": 2,
      "ticketMedioCentavos": 11667, "quantidadeVendidaMilesimos": 200000, "quantidadeDevolvidaMilesimos": 2000, "quantidadeLiquidaMilesimos": 198000
    },
    "variacao": { "receitaLiquidaBps": 1143, "quantidadeVendasBps": 667, "ticketMedioBps": 447, "margemBrutaPontosBps": 109 },
    "porCanal": {
      "pdv": { "receitaLiquidaCentavos": 1170000, "quantidadeVendas": 96, "ticketMedioCentavos": 12188, "devolucoesCentavos": 45000 },
      "comercioDigital": { "quantidadePedidosPagos": 12, "valorPedidosPagosCentavos": 189000, "freteCentavos": 9000, "incluidoNaReceitaLiquida": false },
      "pedidoDeVenda": null
    }
  },
  "devolucoes": {
    "valorCentavos": 45000, "quantidadeDocumentos": 3, "custoRevertidoCentavos": 18000, "quantidadeItensMilesimos": 4000,
    "deVendasAnterioresAoPeriodo": { "valorCentavos": 15000, "quantidadeDocumentos": 1 },
    "porSituacao": [
      { "situacao": "concluida", "valorCentavos": 30000, "quantidadeDocumentos": 2, "custoRevertidoCentavos": 12000 },
      { "situacao": "em_processamento", "valorCentavos": 15000, "quantidadeDocumentos": 1, "custoRevertidoCentavos": 6000 }
    ],
    "porTipo": [
      { "tipo": "devolucao", "valorCentavos": 25000, "quantidadeDocumentos": 2, "custoRevertidoCentavos": 10000 },
      { "tipo": "troca", "valorCentavos": 20000, "quantidadeDocumentos": 1, "custoRevertidoCentavos": 8000 }
    ]
  },
  "pdv": {
    "noPeriodo": { "caixasAbertos": 30, "caixasFechados": 29, "caixasComDiferenca": 2, "diferencaTotalCentavos": -1500, "sobrasCentavos": 500, "faltasCentavos": -2000 },
    "posicaoAtual": { "caixasEmAberto": 1, "caixasAbertosDeDiasAnteriores": 0, "terminaisAtivos": 4 }
  },
  "comercioDigital": {
    "lojaCriada": true, "situacaoLoja": "publicada",
    "noPeriodo": {
      "pedidosCriados": { "quantidade": 14, "valorCentavos": 221000 },
      "pedidosPagos": { "quantidade": 12, "valorCentavos": 189000, "freteCentavos": 9000, "descontosCentavos": 4500 },
      "pedidosCancelados": { "quantidade": 1, "valorCentavos": 12900 },
      "porSituacao": [
        { "situacao": "aguardando_pagamento", "quantidade": 1, "valorCentavos": 14500 },
        { "situacao": "pago", "quantidade": 2, "valorCentavos": 31000 },
        { "situacao": "faturado", "quantidade": 2, "valorCentavos": 27500 },
        { "situacao": "pronto_para_retirada", "quantidade": 1, "valorCentavos": 9900 },
        { "situacao": "despachado", "quantidade": 3, "valorCentavos": 52000 },
        { "situacao": "entregue", "quantidade": 4, "valorCentavos": 68600 },
        { "situacao": "cancelado", "quantidade": 1, "valorCentavos": 12900 },
        { "situacao": "devolucao_solicitada", "quantidade": 1, "valorCentavos": 17500 },
        { "situacao": "devolvido", "quantidade": 0, "valorCentavos": 0 }
      ]
    },
    "posicaoAtual": { "aguardandoPagamento": 1, "aFaturar": 2, "aExpedirOuRetirar": 3, "devolucoesSolicitadas": 1 }
  },
  "estoque": {
    "posicaoAtual": { "saldos": 320, "valorCentavos": 8455000, "fisicoMilesimos": 4120000, "reservadoMilesimos": 35000, "disponivelMilesimos": 4085000, "emTransitoMilesimos": 12000, "abaixoDoMinimo": 7, "rupturas": 2, "saldosZerados": 11, "saldosNegativos": 0 }
  },
  "compras": {
    "noPeriodo": {
      "pedidosCriados": { "quantidade": 5, "valorCentavos": 1230000 },
      "pedidosRecebidos": { "quantidade": 3, "noPrazo": 2 },
      "recebimentosConfirmados": { "quantidade": 4, "valorDevidoCentavos": 980000, "valorFaturadoCentavos": 985000 }
    },
    "posicaoAtual": {
      "aguardandoAprovacao": { "quantidade": 1, "valorCentavos": 250000 },
      "aReceber": { "quantidade": 2, "valorRestanteCentavos": 410000, "atrasados": 1, "previstosProximos7Dias": 1 },
      "recebimentosEmConferencia": { "quantidade": 1, "valorFaturadoCentavos": 98000 },
      "recebimentosComDivergencia": 1,
      "aguardandoNota": { "quantidade": 0, "valorProvisorioCentavos": 0, "comPrazoVencido": 0 }
    }
  },
  "financeiro": {
    "noPeriodo": { "recebido": { "quantidadeBaixas": 18, "valorCentavos": 312000 }, "pago": { "quantidadeBaixas": 9, "valorCentavos": 845000 } },
    "posicaoAtual": {
      "dataReferencia": "2026-11-02",
      "aReceber": { "emAberto": { "quantidade": 42, "valorCentavos": 865000 }, "vencido": { "quantidade": 5, "valorCentavos": 120000 }, "venceHoje": { "quantidade": 2, "valorCentavos": 31000 }, "proximos7Dias": { "quantidade": 6, "valorCentavos": 98000 } },
      "aPagar": { "emAberto": { "quantidade": 15, "valorCentavos": 1320000 }, "vencido": { "quantidade": 1, "valorCentavos": 45000 }, "venceHoje": { "quantidade": 0, "valorCentavos": 0 }, "proximos7Dias": { "quantidade": 3, "valorCentavos": 380000 }, "aAutorizar": { "quantidade": 2, "valorCentavos": 150000 } },
      "saldoContasCentavos": 2450000
    }
  },
  "fiscal": {
    "noPeriodo": {
      "autorizadas": { "quantidade": 101, "valorCentavos": 1380000 },
      "simuladas": { "quantidade": 0, "valorCentavos": 0 },
      "documentosEmitidos": 107, "documentosEmitidosSimulados": 0,
      "faturamentoFiscal": { "brutoCentavos": 1360000, "devolucoesCentavos": 20000, "liquidoCentavos": 1340000, "documentos": 100 },
      "pendentesEntreEmitidos": { "quantidade": 4, "valorCentavos": 43980 },
      "rejeicoes": 2,
      "cancelamentos": { "quantidade": 2, "valorCentavos": 8990 },
      "porModelo": [
        { "modelo": "nfce", "autorizadas": { "quantidade": 96, "valorCentavos": 1215000 }, "simuladas": { "quantidade": 0, "valorCentavos": 0 }, "emitidos": 100,
          "porSituacao": [ { "situacao": "autorizado", "quantidade": 96, "valorCentavos": 1215000 }, { "situacao": "cancelado", "quantidade": 2, "valorCentavos": 8990 }, { "situacao": "processando", "quantidade": 1, "valorCentavos": 3990 }, { "situacao": "rejeitado", "quantidade": 1, "valorCentavos": 2990 } ],
          "faturamentoFiscalBrutoCentavos": 1215000, "rejeicoes": 1, "cancelamentos": { "quantidade": 2, "valorCentavos": 8990 } },
        { "modelo": "nfe", "autorizadas": { "quantidade": 5, "valorCentavos": 165000 }, "simuladas": { "quantidade": 0, "valorCentavos": 0 }, "emitidos": 7,
          "porSituacao": [ { "situacao": "autorizado", "quantidade": 5, "valorCentavos": 165000 }, { "situacao": "pendente", "quantidade": 1, "valorCentavos": 12000 }, { "situacao": "rascunho", "quantidade": 1, "valorCentavos": 25000 } ],
          "faturamentoFiscalBrutoCentavos": 145000, "rejeicoes": 1, "cancelamentos": { "quantidade": 0, "valorCentavos": 0 } },
        { "modelo": "nfse", "autorizadas": { "quantidade": 0, "valorCentavos": 0 }, "simuladas": { "quantidade": 0, "valorCentavos": 0 }, "emitidos": 0,
          "porSituacao": [], "faturamentoFiscalBrutoCentavos": 0, "rejeicoes": 0, "cancelamentos": { "quantidade": 0, "valorCentavos": 0 } }
      ]
    },
    "posicaoAtual": {
      "pendencias": { "pendentes": 2, "processando": 1, "rejeitados": 1 },
      "porModelo": [ { "modelo": "nfce", "pendentes": 0, "processando": 1, "rejeitados": 1 }, { "modelo": "nfe", "pendentes": 2, "processando": 0, "rejeitados": 0 }, { "modelo": "nfse", "pendentes": 0, "processando": 0, "rejeitados": 0 } ]
    }
  }
}
```

### 5.2 `GET .../torre/vendas/serie?de=2026-10-01&ate=2026-10-03&granularidade=dia`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-03" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "granularidade": "dia",
  "itens": [
    { "data": "2026-10-01", "receitaBrutaCentavos": 410000, "descontosCentavos": 12000, "acrescimosCentavos": 0, "receitaAntesDevolucoesCentavos": 398000, "devolucoesCentavos": 0, "receitaLiquidaCentavos": 398000, "custoVendasCentavos": 170000, "custoDevolucoesCentavos": 0, "custoMercadoriaVendidaCentavos": 170000, "lucroBrutoCentavos": 228000, "margemBrutaBps": 5729, "quantidadeVendas": 32, "quantidadeDevolucoes": 0, "ticketMedioCentavos": 12438, "quantidadeVendidaMilesimos": 70000, "quantidadeDevolvidaMilesimos": 0, "quantidadeLiquidaMilesimos": 70000 },
    { "data": "2026-10-02", "receitaBrutaCentavos": 380000, "descontosCentavos": 9000, "acrescimosCentavos": 2500, "receitaAntesDevolucoesCentavos": 373500, "devolucoesCentavos": 15000, "receitaLiquidaCentavos": 358500, "custoVendasCentavos": 160000, "custoDevolucoesCentavos": 6000, "custoMercadoriaVendidaCentavos": 154000, "lucroBrutoCentavos": 204500, "margemBrutaBps": 5704, "quantidadeVendas": 30, "quantidadeDevolucoes": 1, "ticketMedioCentavos": 11950, "quantidadeVendidaMilesimos": 66000, "quantidadeDevolvidaMilesimos": 1000, "quantidadeLiquidaMilesimos": 65000 },
    { "data": "2026-10-03", "receitaBrutaCentavos": 0, "descontosCentavos": 0, "acrescimosCentavos": 0, "receitaAntesDevolucoesCentavos": 0, "devolucoesCentavos": 4990, "receitaLiquidaCentavos": -4990, "custoVendasCentavos": 0, "custoDevolucoesCentavos": 1890, "custoMercadoriaVendidaCentavos": -1890, "lucroBrutoCentavos": -3100, "margemBrutaBps": null, "quantidadeVendas": 0, "quantidadeDevolucoes": 1, "ticketMedioCentavos": null, "quantidadeVendidaMilesimos": 0, "quantidadeDevolvidaMilesimos": 1000, "quantidadeLiquidaMilesimos": -1000 }
  ],
  "total": { "receitaBrutaCentavos": 790000, "descontosCentavos": 21000, "acrescimosCentavos": 2500, "receitaAntesDevolucoesCentavos": 771500, "devolucoesCentavos": 19990, "receitaLiquidaCentavos": 751510, "custoVendasCentavos": 330000, "custoDevolucoesCentavos": 7890, "custoMercadoriaVendidaCentavos": 322110, "lucroBrutoCentavos": 429400, "margemBrutaBps": 5714, "quantidadeVendas": 62, "quantidadeDevolucoes": 2, "ticketMedioCentavos": 12121, "quantidadeVendidaMilesimos": 136000, "quantidadeDevolvidaMilesimos": 2000, "quantidadeLiquidaMilesimos": 134000 }
}
```

Com `granularidade=mes`, cada item tem `mes` (`"2026-10"`), `de` e `ate` (parte do mês coberta pelo período) no lugar de
`data`, com os mesmos campos de valores.

### 5.3 `GET .../torre/vendas/por-unidade?de=2026-10-01&ate=2026-10-31`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "itens": [
    { "idUnidade": "d76c60d5a4e16fe83b06d5f9878f93d0", "codigo": "02", "nome": "Filial — Centro Comercial", "situacaoUnidade": "ativa",
      "receitaBrutaCentavos": 450000, "descontosCentavos": 12500, "acrescimosCentavos": 0, "receitaAntesDevolucoesCentavos": 437500, "devolucoesCentavos": 0, "receitaLiquidaCentavos": 437500,
      "custoVendasCentavos": 190000, "custoDevolucoesCentavos": 0, "custoMercadoriaVendidaCentavos": 190000, "lucroBrutoCentavos": 247500, "margemBrutaBps": 5657,
      "quantidadeVendas": 36, "quantidadeDevolucoes": 0, "ticketMedioCentavos": 12153, "quantidadeVendidaMilesimos": 80000, "quantidadeDevolvidaMilesimos": 0, "quantidadeLiquidaMilesimos": 80000,
      "periodoAnterior": { "receitaLiquidaCentavos": 400000, "quantidadeVendas": 35, "ticketMedioCentavos": 11429, "margemBrutaBps": 5525 },
      "variacao": { "receitaLiquidaBps": 938, "quantidadeVendasBps": 286, "ticketMedioBps": 633, "margemBrutaPontosBps": 132 } },
    { "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "codigo": "01", "nome": "Matriz", "situacaoUnidade": "ativa",
      "receitaBrutaCentavos": 800000, "descontosCentavos": 25000, "acrescimosCentavos": 2500, "receitaAntesDevolucoesCentavos": 777500, "devolucoesCentavos": 45000, "receitaLiquidaCentavos": 732500,
      "custoVendasCentavos": 330000, "custoDevolucoesCentavos": 18000, "custoMercadoriaVendidaCentavos": 312000, "lucroBrutoCentavos": 420500, "margemBrutaBps": 5741,
      "quantidadeVendas": 60, "quantidadeDevolucoes": 3, "ticketMedioCentavos": 12208, "quantidadeVendidaMilesimos": 134000, "quantidadeDevolvidaMilesimos": 4000, "quantidadeLiquidaMilesimos": 130000,
      "periodoAnterior": { "receitaLiquidaCentavos": 650000, "quantidadeVendas": 55, "ticketMedioCentavos": 11818, "margemBrutaBps": 5650 },
      "variacao": { "receitaLiquidaBps": 1269, "quantidadeVendasBps": 909, "ticketMedioBps": 330, "margemBrutaPontosBps": 91 } }
  ],
  "total": { "receitaBrutaCentavos": 1250000, "descontosCentavos": 37500, "acrescimosCentavos": 2500, "receitaAntesDevolucoesCentavos": 1215000, "devolucoesCentavos": 45000, "receitaLiquidaCentavos": 1170000, "custoVendasCentavos": 520000, "custoDevolucoesCentavos": 18000, "custoMercadoriaVendidaCentavos": 502000, "lucroBrutoCentavos": 668000, "margemBrutaBps": 5709, "quantidadeVendas": 96, "quantidadeDevolucoes": 3, "ticketMedioCentavos": 12188, "quantidadeVendidaMilesimos": 214000, "quantidadeDevolvidaMilesimos": 4000, "quantidadeLiquidaMilesimos": 210000 },
  "periodoAnterior": { "de": "2026-08-31", "ate": "2026-09-30", "receitaBrutaCentavos": 1100000, "descontosCentavos": 30000, "acrescimosCentavos": 0, "receitaAntesDevolucoesCentavos": 1070000, "devolucoesCentavos": 20000, "receitaLiquidaCentavos": 1050000, "custoVendasCentavos": 470000, "custoDevolucoesCentavos": 8000, "custoMercadoriaVendidaCentavos": 462000, "lucroBrutoCentavos": 588000, "margemBrutaBps": 5600, "quantidadeVendas": 90, "quantidadeDevolucoes": 2, "ticketMedioCentavos": 11667, "quantidadeVendidaMilesimos": 200000, "quantidadeDevolvidaMilesimos": 2000, "quantidadeLiquidaMilesimos": 198000 }
}
```

### 5.4 `GET .../torre/skus?de=2026-10-01&ate=2026-10-31&limite=2`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "itens": [
    { "idSku": "7947fd162c85ff0ba920079f774ade8a", "codigoSku": "CAM-BAS-M", "descricao": "Camiseta Básica M", "idProduto": "2b12e7d3a5a2c6ed2b8e7db4396458cf", "nomeProduto": "Camiseta Básica",
      "idCategoria": "fca505395dfb60444ccb313b37d86516", "nomeCategoria": "Vestuário", "unidadeMedida": "UN",
      "receitaBrutaCentavos": 180000, "descontosCentavos": 5000, "acrescimosCentavos": 0, "devolucoesCentavos": 6000, "receitaLiquidaCentavos": 169000,
      "quantidadeVendidaMilesimos": 40000, "quantidadeDevolvidaMilesimos": 1000, "quantidadeLiquidaMilesimos": 39000, "quantidadeVendas": 31,
      "custoRegistrado": true, "custoMercadoriaVendidaCentavos": 64000, "lucroBrutoCentavos": 105000, "margemBrutaBps": 6213,
      "classeAbc": "A", "posicaoAbc": 1, "participacaoBps": 1441, "acumuladoBps": 1441, "semMovimento": false },
    { "idSku": "0133767603e0d7d2d700173869ad6a53", "codigoSku": "CAN-350", "descricao": "Caneca 350 ml", "idProduto": "3a7b75e72a153ee905f47e1524e887dd", "nomeProduto": "Caneca 350 ml",
      "idCategoria": "b30a0bb956d0730c46cb31c89dcb7c56", "nomeCategoria": "Casa", "unidadeMedida": "UN",
      "receitaBrutaCentavos": 120000, "descontosCentavos": 0, "acrescimosCentavos": 0, "devolucoesCentavos": 0, "receitaLiquidaCentavos": 120000,
      "quantidadeVendidaMilesimos": 40000, "quantidadeDevolvidaMilesimos": 0, "quantidadeLiquidaMilesimos": 40000, "quantidadeVendas": 25,
      "custoRegistrado": true, "custoMercadoriaVendidaCentavos": 45000, "lucroBrutoCentavos": 75000, "margemBrutaBps": 6250,
      "classeAbc": "A", "posicaoAbc": 2, "participacaoBps": 1023, "acumuladoBps": 2465, "semMovimento": false }
  ],
  "proximoCursor": "eyJ2IjoxLCJmIjoiM2Y5YzJhN2IxZDBlNGM1YSIsImsiOlsxMjAwMDAsNDAwMDAsIkNBTi0zNTAiLCIwMTMzNzY3NjAzZTBkN2QyZDcwMDE3Mzg2OWFkNmE1MyJdfQ",
  "curva": {
    "criterio": "receita_liquida", "limites": { "classeABps": 8000, "classeBBps": 9500 },
    "receitaLiquidaCentavos": 1170000, "receitaNaCurvaCentavos": 1172500, "receitaForaDaCurvaCentavos": -2500,
    "classes": { "A": { "quantidade": 9, "receitaLiquidaCentavos": 936500, "participacaoBps": 7987 }, "B": { "quantidade": 7, "receitaLiquidaCentavos": 176000, "participacaoBps": 1501 }, "C": { "quantidade": 11, "receitaLiquidaCentavos": 60000, "participacaoBps": 512 } },
    "semClasse": { "comMovimento": 1, "semMovimento": 14 }
  }
}
```

### 5.5 `GET .../torre/produtos?de=2026-10-01&ate=2026-10-31&limite=1`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "itens": [
    { "idProduto": "2b12e7d3a5a2c6ed2b8e7db4396458cf", "codigoProduto": "CAMISETA", "nomeProduto": "Camiseta Básica", "idCategoria": "fca505395dfb60444ccb313b37d86516", "nomeCategoria": "Vestuário",
      "quantidadeSkusComMovimento": 3,
      "receitaBrutaCentavos": 410000, "descontosCentavos": 9000, "acrescimosCentavos": 0, "devolucoesCentavos": 6000, "receitaLiquidaCentavos": 395000,
      "quantidadeVendidaMilesimos": 92000, "quantidadeDevolvidaMilesimos": 1000, "quantidadeLiquidaMilesimos": 91000, "quantidadeVendas": 64,
      "custoRegistrado": true, "custoMercadoriaVendidaCentavos": 151000, "lucroBrutoCentavos": 244000, "margemBrutaBps": 6177,
      "classeAbc": "A", "posicaoAbc": 1, "participacaoBps": 3369, "acumuladoBps": 3369, "semMovimento": false }
  ],
  "proximoCursor": "eyJ2IjoxLCJmIjoiOWE0MWMwN2JlMmQzNWYxOCIsImsiOlsxMjAwMDAsNDAwMDAsIkNBTkVDQSIsIjNhN2I3NWU3MmExNTNlZTkwNWY0N2UxNTI0ZTg4N2RkIl19",
  "curva": {
    "criterio": "receita_liquida", "limites": { "classeABps": 8000, "classeBBps": 9500 },
    "receitaLiquidaCentavos": 1170000, "receitaNaCurvaCentavos": 1172500, "receitaForaDaCurvaCentavos": -2500,
    "classes": { "A": { "quantidade": 4, "receitaLiquidaCentavos": 921000, "participacaoBps": 7855 }, "B": { "quantidade": 3, "receitaLiquidaCentavos": 180500, "participacaoBps": 1539 }, "C": { "quantidade": 5, "receitaLiquidaCentavos": 71000, "participacaoBps": 606 } },
    "semClasse": { "comMovimento": 1, "semMovimento": 6 }
  }
}
```

### 5.6 `GET .../torre/transacoes/vendas?de=2026-10-01&ate=2026-10-31&situacao=todas&limite=2`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "itens": [
    { "idVenda": "0773ac34e6fc2588984ce9cf0a4fe0f2", "numero": 1532, "situacao": "concluida", "origem": "pdv", "canal": "pdv",
      "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "idTerminal": "9e678acc4237c7f885eb2f38ec6db3bb", "idSessaoCaixa": "8bd5661ed89fc5eb779f486b1dfb8170",
      "idOperador": "888aa7d3e09886ae7fdf0fca6f8033c6", "idVendedor": "b29ad9ee441e62f69f1a4ff8faff6a33", "idCliente": "f39d3c766e62c748988acb3efad08fd4",
      "situacaoFiscal": "autorizado", "idDocumentoFiscal": "0d19b5db005290c5d50d96f3d8f9e35e",
      "concluidaEm": "2026-10-01T13:42:10.000Z", "data": "2026-10-01", "canceladaEm": null, "quantidadeLinhas": 2, "quantidadeItensVenda": 2,
      "receitaBrutaCentavos": 15980, "descontosCentavos": 800, "acrescimosCentavos": 0, "valorLiquidoCentavos": 15180, "custoCentavos": 6100, "margemBrutaBps": 5982 },
    { "idVenda": "c38ffac75882e2c6d0b391637104fecc", "numero": 1533, "situacao": "cancelada", "origem": "pdv", "canal": "pdv",
      "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "idTerminal": "9e678acc4237c7f885eb2f38ec6db3bb", "idSessaoCaixa": "8bd5661ed89fc5eb779f486b1dfb8170",
      "idOperador": "888aa7d3e09886ae7fdf0fca6f8033c6", "idVendedor": null, "idCliente": null,
      "situacaoFiscal": "cancelado", "idDocumentoFiscal": "d6659ad04cc75c516f96c3d8374330a6",
      "concluidaEm": "2026-10-01T14:05:33.000Z", "data": "2026-10-01", "canceladaEm": "2026-10-01T14:20:02.000Z", "quantidadeLinhas": null, "quantidadeItensVenda": 1,
      "receitaBrutaCentavos": 4990, "descontosCentavos": 0, "acrescimosCentavos": 0, "valorLiquidoCentavos": 4990, "custoCentavos": 1890, "margemBrutaBps": null }
  ],
  "proximoCursor": "eyJ2IjoxLCJmIjoiNWQyZThmMWEwYjdjMzk2NCIsImsiOlsiMjAyNi0xMC0wMVQxNDowNTozMy4wMDBaIiwiYzM4ZmZhYzc1ODgyZTJjNmQwYjM5MTYzNzEwNGZlY2MiXX0",
  "totais": { "concluidas": { "quantidade": 96, "valorLiquidoCentavos": 1215000 }, "canceladas": { "quantidade": 2, "valorLiquidoCentavos": 8990 } }
}
```

### 5.7 `GET .../torre/transacoes/devolucoes?de=2026-10-01&ate=2026-10-31&limite=1`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "itens": [
    { "idDevolucao": "7f0589bb1735032e29c2d26316b9d94b", "numero": 87, "tipo": "devolucao", "situacao": "em_processamento", "compensacao": "reembolso", "formaReembolso": "estorno_cartao",
      "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "idCliente": "37a4db3e9cb654525ceeed203bbd853f",
      "registradaEm": "2026-10-02T18:11:45.000Z", "data": "2026-10-02",
      "idVendaOriginal": "4f3e1d0c9b8a7f6e5d4c3b2a19087f6e", "numeroVendaOriginal": 1490, "vendaOriginalEm": "2026-09-28T16:30:00.000Z", "vendaAnteriorAoPeriodo": true,
      "quantidadeLinhas": 1, "valorCentavos": 15000, "custoRevertidoCentavos": 6000, "valorAbatidoTituloCentavos": 0 }
  ],
  "proximoCursor": "eyJ2IjoxLCJmIjoiZTA3YjVjOWQyYTRmMTM4NiIsImsiOlsiMjAyNi0xMC0wMlQxODoxMTo0NS4wMDBaIiwiN2YwNTg5YmIxNzM1MDMyZTI5YzJkMjYzMTZiOWQ5NGIiXX0",
  "totais": { "quantidade": 3, "valorCentavos": 45000, "custoRevertidoCentavos": 18000 }
}
```

### 5.8 `GET .../torre/estoque?limite=2`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": null, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "itens": [
    { "idSaldo": "132a23d5e16bc82321ff6eb589ec357f", "idSku": "7947fd162c85ff0ba920079f774ade8a", "codigoSku": "CAM-BAS-M", "descricaoSku": "Camiseta Básica M",
      "idProduto": "2b12e7d3a5a2c6ed2b8e7db4396458cf", "nomeProduto": "Camiseta Básica", "idCategoria": "fca505395dfb60444ccb313b37d86516", "produtoAtivo": true, "unidadeMedida": "UN",
      "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "idDeposito": "da5831ac7790f8c2010c2e4b4475b11b", "nomeDeposito": "Depósito principal", "tipoDeposito": "disponivel",
      "fisicoMilesimos": 24000, "reservadoMilesimos": 2000, "disponivelMilesimos": 22000, "emTransitoMilesimos": 0, "aChegarMilesimos": 0, "minimoMilesimos": 10000,
      "custoMedioCentavos": 1650, "valorCentavos": 39600, "abaixoDoMinimo": false, "ultimoMovimentoEm": "2026-11-01T19:02:11.000Z" },
    { "idSaldo": "38396fb2b57a754db3d06a01396bfe70", "idSku": "0133767603e0d7d2d700173869ad6a53", "codigoSku": "CAN-350", "descricaoSku": "Caneca 350 ml",
      "idProduto": "3a7b75e72a153ee905f47e1524e887dd", "nomeProduto": "Caneca 350 ml", "idCategoria": "b30a0bb956d0730c46cb31c89dcb7c56", "produtoAtivo": true, "unidadeMedida": "UN",
      "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "idDeposito": "da5831ac7790f8c2010c2e4b4475b11b", "nomeDeposito": "Depósito principal", "tipoDeposito": "disponivel",
      "fisicoMilesimos": 3000, "reservadoMilesimos": 0, "disponivelMilesimos": 3000, "emTransitoMilesimos": 0, "aChegarMilesimos": 12000, "minimoMilesimos": 6000,
      "custoMedioCentavos": 1125, "valorCentavos": 3375, "abaixoDoMinimo": true, "ultimoMovimentoEm": "2026-10-31T21:40:00.000Z" }
  ],
  "proximoCursor": "eyJ2IjoxLCJmIjoiYjE4ZTZkMGM0ZjJhOTM1NyIsImsiOlsiQ0FOLTM1MCIsImE1MDBiNWQ5YzgxMWUzMmYwNWMyZTYyZGZmOTMwZmJjIiwiZGE1ODMxYWM3NzkwZjhjMjAxMGMyZTRiNDQ3NWIxMWIiLCIzODM5NmZiMmI1N2E3NTRkYjNkMDZhMDEzOTZiZmU3MCJdfQ",
  "totais": { "saldos": 320, "valorCentavos": 8455000, "fisicoMilesimos": 4120000, "reservadoMilesimos": 35000, "disponivelMilesimos": 4085000, "abaixoDoMinimo": 7 }
}
```

### 5.9 `GET .../torre/financeiro?de=2026-10-01&ate=2026-10-31`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "noPeriodo": {
    "recebido": { "quantidadeBaixas": 18, "valorCentavos": 312000 },
    "pago": { "quantidadeBaixas": 9, "valorCentavos": 845000 },
    "dre": {
      "receitaLiquidaCentavos": 1350000, "lucroBrutoCentavos": 848000, "resultadoOperacionalCentavos": 273000, "resultadoCentavos": 282400, "cmvCentavos": -502000,
      "grupos": [
        { "grupo": "receita_bruta", "rotulo": "Receita bruta", "valorCentavos": 1395000 },
        { "grupo": "deducoes", "rotulo": "(−) Deduções da receita", "valorCentavos": -45000 },
        { "grupo": "cmv", "rotulo": "(−) CMV — custo das mercadorias vendidas", "valorCentavos": -502000 },
        { "grupo": "custo_dos_servicos", "rotulo": "(−) Custo dos serviços — certificados, comissões e custo AC", "valorCentavos": 0 },
        { "grupo": "despesas_operacionais", "rotulo": "(−) Despesas operacionais", "valorCentavos": -310000 },
        { "grupo": "despesas_com_pessoal", "rotulo": "(−) Despesas com pessoal", "valorCentavos": -220000 },
        { "grupo": "despesas_administrativas", "rotulo": "(−) Despesas administrativas", "valorCentavos": -45000 },
        { "grupo": "outras_despesas", "rotulo": "(−) Outras despesas", "valorCentavos": 0 },
        { "grupo": "receitas_financeiras", "rotulo": "(+) Receitas financeiras", "valorCentavos": 1200 },
        { "grupo": "despesas_financeiras", "rotulo": "(−) Despesas financeiras", "valorCentavos": -9800 },
        { "grupo": "outras_receitas", "rotulo": "(+) Outras receitas", "valorCentavos": 18000 }
      ],
      "foraDoResultado": [
        { "grupo": "compras_mercadorias", "rotulo": "Compras de mercadorias (grupo CMV — entram no estoque)", "valorCentavos": -610000 },
        { "grupo": "investimentos", "rotulo": "Investimentos", "valorCentavos": 0 },
        { "grupo": "adiantamentos_rede", "rotulo": "Adiantamentos — créditos pré-pagos da rede (o custo entra a cada venda debitada)", "valorCentavos": 0 }
      ],
      "conferenciaDiferencaCentavos": 0, "itensSemClassificacao": 0
    }
  },
  "posicaoAtual": {
    "dataReferencia": "2026-11-02",
    "aReceber": { "emAberto": { "quantidade": 42, "valorCentavos": 865000 }, "vencido": { "quantidade": 5, "valorCentavos": 120000 }, "venceHoje": { "quantidade": 2, "valorCentavos": 31000 }, "proximos7Dias": { "quantidade": 6, "valorCentavos": 98000 } },
    "aPagar": { "emAberto": { "quantidade": 15, "valorCentavos": 1320000 }, "vencido": { "quantidade": 1, "valorCentavos": 45000 }, "venceHoje": { "quantidade": 0, "valorCentavos": 0 }, "proximos7Dias": { "quantidade": 3, "valorCentavos": 380000 }, "aAutorizar": { "quantidade": 2, "valorCentavos": 150000 } },
    "saldoContasCentavos": 2450000,
    "aging": {
      "aReceber": { "dataReferencia": "2026-11-02", "totalCentavos": 865000, "vencidoCentavos": 120000, "faixas": [ { "faixa": "a_vencer", "valorCentavos": 745000, "quantidadeParcelas": 37 }, { "faixa": "de_1_a_30_dias", "valorCentavos": 95000, "quantidadeParcelas": 4 }, { "faixa": "de_31_a_60_dias", "valorCentavos": 25000, "quantidadeParcelas": 1 }, { "faixa": "de_61_a_90_dias", "valorCentavos": 0, "quantidadeParcelas": 0 }, { "faixa": "acima_de_90_dias", "valorCentavos": 0, "quantidadeParcelas": 0 } ] },
      "aPagar": { "dataReferencia": "2026-11-02", "totalCentavos": 1320000, "vencidoCentavos": 45000, "faixas": [ { "faixa": "a_vencer", "valorCentavos": 1275000, "quantidadeParcelas": 14 }, { "faixa": "de_1_a_30_dias", "valorCentavos": 45000, "quantidadeParcelas": 1 }, { "faixa": "de_31_a_60_dias", "valorCentavos": 0, "quantidadeParcelas": 0 }, { "faixa": "de_61_a_90_dias", "valorCentavos": 0, "quantidadeParcelas": 0 }, { "faixa": "acima_de_90_dias", "valorCentavos": 0, "quantidadeParcelas": 0 } ] }
    },
    "contas": [
      { "idConta": "c599d1db21e88604477d0e57545afb3a", "nome": "Caixa — Matriz", "tipo": "caixa", "compartilhada": false, "saldoCentavos": 85000 },
      { "idConta": "20143b1972d110f77cba032877952d9c", "nome": "Conta bancária principal", "tipo": "banco", "compartilhada": true, "saldoCentavos": 2365000 }
    ]
  }
}
```

### 5.10 `GET .../torre/fiscal?de=2026-10-01&ate=2026-10-31`

O corpo é `{ meta, noPeriodo, posicaoAtual }` com o mesmo conteúdo do bloco `fiscal` do resumo para o mesmo recorte
(§5.1). Exemplo com `idUnidade=a500b5d9c811e32f05c2e62dff930fbc`:

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": ["a500b5d9c811e32f05c2e62dff930fbc"], "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "noPeriodo": {
    "autorizadas": { "quantidade": 60, "valorCentavos": 777500 },
    "simuladas": { "quantidade": 0, "valorCentavos": 0 },
    "documentosEmitidos": 63, "documentosEmitidosSimulados": 0,
    "faturamentoFiscal": { "brutoCentavos": 777500, "devolucoesCentavos": 0, "liquidoCentavos": 777500, "documentos": 60 },
    "pendentesEntreEmitidos": { "quantidade": 2, "valorCentavos": 6980 },
    "rejeicoes": 1,
    "cancelamentos": { "quantidade": 1, "valorCentavos": 4990 },
    "porModelo": [
      { "modelo": "nfce", "autorizadas": { "quantidade": 60, "valorCentavos": 777500 }, "simuladas": { "quantidade": 0, "valorCentavos": 0 }, "emitidos": 63,
        "porSituacao": [ { "situacao": "autorizado", "quantidade": 60, "valorCentavos": 777500 }, { "situacao": "cancelado", "quantidade": 1, "valorCentavos": 4990 }, { "situacao": "processando", "quantidade": 1, "valorCentavos": 3990 }, { "situacao": "rejeitado", "quantidade": 1, "valorCentavos": 2990 } ],
        "faturamentoFiscalBrutoCentavos": 777500, "rejeicoes": 1, "cancelamentos": { "quantidade": 1, "valorCentavos": 4990 } },
      { "modelo": "nfe", "autorizadas": { "quantidade": 0, "valorCentavos": 0 }, "simuladas": { "quantidade": 0, "valorCentavos": 0 }, "emitidos": 0, "porSituacao": [], "faturamentoFiscalBrutoCentavos": 0, "rejeicoes": 0, "cancelamentos": { "quantidade": 0, "valorCentavos": 0 } },
      { "modelo": "nfse", "autorizadas": { "quantidade": 0, "valorCentavos": 0 }, "simuladas": { "quantidade": 0, "valorCentavos": 0 }, "emitidos": 0, "porSituacao": [], "faturamentoFiscalBrutoCentavos": 0, "rejeicoes": 0, "cancelamentos": { "quantidade": 0, "valorCentavos": 0 } }
    ]
  },
  "posicaoAtual": {
    "pendencias": { "pendentes": 0, "processando": 1, "rejeitados": 1 },
    "porModelo": [ { "modelo": "nfce", "pendentes": 0, "processando": 1, "rejeitados": 1 }, { "modelo": "nfe", "pendentes": 0, "processando": 0, "rejeitados": 0 }, { "modelo": "nfse", "pendentes": 0, "processando": 0, "rejeitados": 0 } ]
  }
}
```

### 5.11 `GET .../torre/compras?de=2026-10-01&ate=2026-10-31`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "noPeriodo": {
    "pedidosCriados": { "quantidade": 5, "valorCentavos": 1230000 },
    "pedidosRecebidos": { "quantidade": 3, "noPrazo": 2 },
    "recebimentosConfirmados": { "quantidade": 4, "valorDevidoCentavos": 980000, "valorFaturadoCentavos": 985000 },
    "pedidosCriadosPorSituacao": [
      { "situacao": "aprovado", "quantidade": 1, "valorCentavos": 160000 }, { "situacao": "cancelado", "quantidade": 1, "valorCentavos": 75000 }, { "situacao": "em_analise", "quantidade": 1, "valorCentavos": 250000 },
      { "situacao": "parcial", "quantidade": 1, "valorCentavos": 320000 }, { "situacao": "recebido", "quantidade": 1, "valorCentavos": 500000 }
    ]
  },
  "posicaoAtual": {
    "aguardandoAprovacao": { "quantidade": 1, "valorCentavos": 250000 },
    "aReceber": { "quantidade": 2, "valorRestanteCentavos": 410000, "atrasados": 1, "previstosProximos7Dias": 1 },
    "recebimentosEmConferencia": { "quantidade": 1, "valorFaturadoCentavos": 98000 },
    "recebimentosComDivergencia": 1,
    "aguardandoNota": { "quantidade": 0, "valorProvisorioCentavos": 0, "comPrazoVencido": 0 },
    "pedidosPorSituacao": [
      { "situacao": "aprovado", "quantidade": 1, "valorCentavos": 160000 }, { "situacao": "cancelado", "quantidade": 3, "valorCentavos": 210000 }, { "situacao": "em_analise", "quantidade": 1, "valorCentavos": 250000 },
      { "situacao": "parcial", "quantidade": 1, "valorCentavos": 320000 }, { "situacao": "rascunho", "quantidade": 2, "valorCentavos": 88000 }, { "situacao": "recebido", "quantidade": 41, "valorCentavos": 9850000 }
    ],
    "recebimentosPorSituacao": [ { "situacao": "confirmado", "quantidade": 44, "valorCentavos": 10120000 }, { "situacao": "rascunho", "quantidade": 1, "valorCentavos": 98000 } ]
  }
}
```

### 5.12 `GET .../torre/comercio-digital?de=2026-10-01&ate=2026-10-31`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "lojaCriada": true,
  "situacaoLoja": "publicada",
  "noPeriodo": {
    "pedidosCriados": { "quantidade": 14, "valorCentavos": 221000 },
    "pedidosPagos": { "quantidade": 12, "valorCentavos": 189000, "freteCentavos": 9000, "descontosCentavos": 4500 },
    "pedidosCancelados": { "quantidade": 1, "valorCentavos": 12900 },
    "porSituacao": [
      { "situacao": "aguardando_pagamento", "quantidade": 1, "valorCentavos": 14500 }, { "situacao": "pago", "quantidade": 2, "valorCentavos": 31000 }, { "situacao": "faturado", "quantidade": 2, "valorCentavos": 27500 },
      { "situacao": "pronto_para_retirada", "quantidade": 1, "valorCentavos": 9900 }, { "situacao": "despachado", "quantidade": 3, "valorCentavos": 52000 }, { "situacao": "entregue", "quantidade": 4, "valorCentavos": 68600 },
      { "situacao": "cancelado", "quantidade": 1, "valorCentavos": 12900 }, { "situacao": "devolucao_solicitada", "quantidade": 1, "valorCentavos": 17500 }, { "situacao": "devolvido", "quantidade": 0, "valorCentavos": 0 }
    ]
  },
  "posicaoAtual": {
    "aguardandoPagamento": 1, "aFaturar": 2, "aExpedirOuRetirar": 3, "devolucoesSolicitadas": 1,
    "porSituacao": [
      { "situacao": "aguardando_pagamento", "quantidade": 1, "valorCentavos": 14500 }, { "situacao": "pago", "quantidade": 2, "valorCentavos": 31000 }, { "situacao": "faturado", "quantidade": 2, "valorCentavos": 27500 },
      { "situacao": "pronto_para_retirada", "quantidade": 1, "valorCentavos": 9900 }, { "situacao": "despachado", "quantidade": 3, "valorCentavos": 52000 }, { "situacao": "entregue", "quantidade": 37, "valorCentavos": 612300 },
      { "situacao": "cancelado", "quantidade": 6, "valorCentavos": 71400 }, { "situacao": "devolucao_solicitada", "quantidade": 1, "valorCentavos": 17500 }, { "situacao": "devolvido", "quantidade": 2, "valorCentavos": 25800 }
    ],
    "banco": { "previstoLiquidoCentavos": 64200, "creditadoLiquidoCentavos": 655100, "conciliadoLiquidoCentavos": 640300, "transacoesConciliadas": 39, "brutoCentavos": 741000, "taxasCentavos": 21700, "disponivelCentavos": 120300, "simulado": false },
    "monitor": { "falhas": 1, "pendentes": 2, "concluidos": 214, "ignorados": 3, "total": 220 }
  }
}
```

### 5.13 `GET .../torre/adocao`

```json
{
  "meta": { "idEmpresa": "0b90b70e6fdbf0663f40978c3454eaaa", "periodo": null, "unidades": null, "fuso": "America/Sao_Paulo", "geradoEm": "2026-11-02T13:15:42.120Z", "versaoIndicadores": "2026-11-v1" },
  "ultimaAtividade": { "em": "2026-11-02T12:58:03.410Z", "fonte": "auditoria" },
  "ultimoAcesso": { "em": "2026-11-02T11:02:47.000Z", "fonte": "login" },
  "usuarios": { "total": 12, "ativos": 10, "convitesPendentes": 1, "convitesExpirados": 0, "suspensos": 0, "inativos": 1, "nuncaAcessaram": 2 },
  "usuariosAtivos": { "ultimos7Dias": 7, "ultimos30Dias": 9, "fonte": "auditoria" },
  "usuariosComAcesso": { "ultimos7Dias": 8, "ultimos30Dias": 9, "fonte": "login" },
  "atividadeOperacional": {
    "ultimaVenda": { "em": "2026-11-02T12:57:40.000Z", "idUnidade": "a500b5d9c811e32f05c2e62dff930fbc", "situacao": "concluida" },
    "ultimaAberturaCaixaEm": "2026-11-02T11:05:12.000Z",
    "ultimoMovimentoEstoqueEm": "2026-11-02T12:57:41.000Z",
    "ultimoDocumentoFiscalEm": "2026-11-02T12:57:42.000Z",
    "ultimoPedidoOnlineEm": "2026-11-01T22:14:09.000Z"
  },
  "terminais": { "ativos": 4, "ultimaAtividadeEm": null },
  "pendenciasIntegracao": {
    "documentosFiscais": { "pendentes": 2, "processando": 1, "rejeitados": 1 },
    "comercioDigital": { "falhas": 1, "pendentes": 2 },
    "tarefas": { "comFalhaEmNovaTentativa": 0, "esgotadas": 1, "travadas": 0, "retidas": 0 },
    "rotinasComFalha": null
  }
}
```

### 5.14 Erro de validação (`GET .../torre/skus?de=2025-01-01&ate=2026-10-31&idUnidade=99c0ffee00000000000000000000beef&limite=900`)

```json
{
  "erro": {
    "codigo": "validacao",
    "mensagem": "Há campos inválidos na solicitação.",
    "campos": [
      { "campo": "ate", "mensagem": "Período limitado a 400 dias (o informado tem 669 dias)." },
      { "campo": "limite", "mensagem": "limite deve ser um inteiro de 1 a 500 (padrão 100)." },
      { "campo": "idUnidade", "mensagem": "Unidade(s) que não pertence(m) a esta empresa: 99c0ffee00000000000000000000beef." }
    ]
  },
  "requestId": "req_2906b115dddb716f83273e81"
}
```

---

## 6. Limites conhecidos e decisões

1. **Mesma base das telas, mesmos limites.** As consultas carregam o recorte em memória (como as telas): `listAll` para em
   100 000 registros por consulta sem aviso (mapa 05 §0.5, §6.2.2); o período máximo é de 400 dias. `resumo` calcula o
   período atual e o anterior (dois recortes comerciais) e todos os blocos: é a consulta mais pesada (limite da função:
   60 s). Para séries longas, prefira `vendas/serie` e blocos específicos.
2. **Retroatividade.** Não há fechamento comercial: cancelar uma venda ou uma NF-e depois a retira do período original;
   itens de venda gravados depois (`sale.effects`) aumentam receita e custo de um período já consultado. O financeiro
   respeita o fechamento de período só quando o recurso está ligado (desligado por padrão). Consulte de novo para
   reconciliar; `meta.geradoEm` registra o instante da leitura.
3. **Receita comercial ≠ faturamento fiscal ≠ DRE.** `vendas.receitaLiquidaCentavos` (base comercial, só PDV, sem frete),
   `fiscal.noPeriodo.faturamentoFiscal` (notas autorizadas por emissão, com frete e ICMS-ST, inclui pedidos on-line e NF-e
   de pedido) e `financeiro.noPeriodo.dre.receitaLiquidaCentavos` (competência financeira; vale-crédito e pontos não são
   receita) medem coisas diferentes por definição (mapa 05 §6.2.5, linhas 1–4). Não há receita omnicanal oficial
   (`porCanal.pedidoDeVenda: null`).
4. **Comércio digital.** Os valores dos pedidos incluem frete e são brutos das taxas do gateway; a visão do banco e o
   monitor não têm recorte de período e leem até 5000 registros (herdado das telas). A Torre não expira pedidos vencidos.
5. **Cortes por UTC nas telas.** A Torre corta todos os períodos no fuso do ERP. Telas que cortam por UTC ("Pedidos hoje",
   "Pedidos no mês", "Recebidos no mês", "Entradas confirmadas no mês") podem divergir para eventos entre 21h e 24h
   (horário de Brasília). Exceção mantida da tela: `compras.noPeriodo.pedidosRecebidos.noPrazo` compara a data UTC.
6. **Simulação, homologação e demonstração.** Documentos do provedor de simulação ficam fora de `autorizadas` (à parte em
   `simuladas`) e dentro de `documentosEmitidos`/`faturamentoFiscal` (padrão dos relatórios fiscais); ambiente de
   homologação conta como autorizado; registros de demonstração (`isDemo`) não são filtrados — como nas telas.
7. **Unidades.** Sem `idUnidade` = consolidado da empresa, incluindo registros sem filial (parcelas, baixas, contas
   compartilhadas, documentos fiscais). Com `idUnidade`, só registros das unidades — exceto contas compartilhadas (sempre no
   saldo) e itens sem filial do DRE com várias unidades. Na `adocao`, os sinais de usuário são sempre da empresa.
8. **Margem sem custo.** O ERP grava custo 0 quando não há custo médio nem custo do SKU; produtos e SKUs devolvem
   `margemBrutaBps`, `lucroBrutoCentavos` e `custoMercadoriaVendidaCentavos` `null` nesses casos (`custoRegistrado: false`).
   Nos totais (`vendas`, série, por unidade) a margem segue a tela (custo 0 entra como 0).
9. **Sem fonte confiável → `null`.** Atividade de terminal, falha de rotina diária e canal "pedido de venda". O uso por
   usuário vem da auditoria (operações, não navegação) e do último login (global), cada um com a fonte declarada.
10. **Dados pessoais.** Nenhuma rota devolve nome, CPF/CNPJ, e-mail, telefone ou endereço de cliente, nem nomes de
    operador/vendedor (só ids). Nomes de unidades, depósitos, produtos, categorias e contas financeiras da empresa são
    dados cadastrais da própria empresa.
11. **Versão.** Mudança de fórmula, de critério ou de campo gera nova `versaoIndicadores`; campos novos podem ser
    acrescentados sem mudar a versão (o consumidor deve ignorar campos desconhecidos).

---

## 7. Referência por rota (fichas para o contrato)

### 7.1 Legenda de tipos e unidades

| Sigla | Tipo JSON | Unidade / formato |
|---|---|---|
| `C` | inteiro | **centavos de real (BRL)**; pode ser negativo |
| `M` | inteiro | milésimos (1 unidade de medida = 1000) |
| `B` | inteiro | pontos-base (1% = 100) |
| `N` | inteiro | contagem (≥ 0) |
| `D` | string | data de calendário `AAAA-MM-DD`, no fuso do ERP |
| `I` | string | instante ISO-8601 em UTC (`…Z`) |
| `id` | string | identificador opaco (até 100 caracteres) |
| `S` | string | texto livre (nome, código, rótulo) |
| `E` | string | lista fechada de valores (indicados na ficha ou no §4) |
| `L` | booleano | |
| `?` | sufixo | o campo pode ser `null` |

Grupos reutilizados:

- **`QV`** = `{ quantidade: N, valorCentavos: C }`.
- **`VC`** (valores comerciais, `salesFigures`): `receitaBrutaCentavos C` · `descontosCentavos C` · `acrescimosCentavos C` ·
  `receitaAntesDevolucoesCentavos C` · `devolucoesCentavos C` · `receitaLiquidaCentavos C` · `custoVendasCentavos C` ·
  `custoDevolucoesCentavos C` · `custoMercadoriaVendidaCentavos C` · `lucroBrutoCentavos C` · `margemBrutaBps B?` ·
  `quantidadeVendas N` · `quantidadeDevolucoes N` · `ticketMedioCentavos C?` · `quantidadeVendidaMilesimos M` ·
  `quantidadeDevolvidaMilesimos M` · `quantidadeLiquidaMilesimos M`.
- **`VAR`** (variação): `receitaLiquidaBps B?` · `quantidadeVendasBps B?` · `ticketMedioBps B?` · `margemBrutaPontosBps B?`.
- **`SQV`** (situação): `{ situacao: E, quantidade: N, valorCentavos: C }`.
- **`meta`**: `idEmpresa id` · `periodo { de D, ate D }?` · `unidades id[]?` · `fuso S` (nome IANA) · `geradoEm I` ·
  `versaoIndicadores S`.

### 7.2 Parâmetros de consulta

| Nome | Formato | Obrigatório | Padrão | Limites / regras | Rotas |
|---|---|---|---|---|---|
| `de` | `AAAA-MM-DD` (só este formato) | sim | — | data válida; `de ≤ ate` | todas, exceto `estoque` e `adocao` |
| `ate` | `AAAA-MM-DD` | sim | — | `ate − de + 1 ≤ 400` dias; inclusivo | idem |
| `idUnidade` | ids separados por vírgula (ou parâmetro repetido) | não | todas as filiais | ≤ 200 ids, sem repetição; cada id da empresa | todas |
| `limite` | inteiro | não | 100 | 1 a 500 | `produtos`, `skus`, `transacoes/vendas`, `transacoes/devolucoes`, `estoque` |
| `cursor` | string opaca (base64url, ≤ 2000 caracteres) | não | — | o `proximoCursor` da mesma consulta | idem |
| `granularidade` | `dia` \| `mes` | não | `dia` | | `vendas/serie` |
| `situacao` | `concluida` \| `cancelada` \| `todas` | não | `concluida` | | `transacoes/vendas` |
| `incluirSemMovimento` | `1`/`true` \| `0`/`false` | não | `0` | | `produtos`, `skus` |

Paginação (rotas paginadas): resposta `{ meta, itens: lista, proximoCursor: string? , totais | curva }`; `proximoCursor:
null` na última página; o mesmo `cursor` com outra rota, empresa, período, unidades ou filtro → 422 (`campo: "cursor"`).

### 7.3 Erros (todas as rotas)

A Torre **não cria códigos de erro novos**; usa os do contrato v1 (`src/lib/service/http.ts`): `401 nao_autenticado`,
`403 sem_permissao` (escopo da rota ausente), `404 nao_encontrado` (empresa não vinculada ao Interos ou inexistente),
`422 validacao`, `429 limite_excedido`, `500 erro_interno`, `503 servico_nao_configurado`. Em `422 validacao`, o campo
`erro.campos[].campo` usado pela Torre é um de: `de`, `ate`, `idUnidade`, `limite`, `cursor`, `granularidade`, `situacao`,
`incluirSemMovimento` (todos os problemas da solicitação na mesma resposta; validação feita só depois de confirmada a
empresa).

### 7.4 Fichas

#### `GET /api/interos/v1/empresas/{idEmpresa}/torre/resumo`

- **Escopo** `torre:resumo` · **operação** `torre.resumo` · **parâmetros** `de`, `ate`, `idUnidade` · **sem paginação**.
- **Data de referência**: `vendas`/`devolucoes` = dia local da conclusão da venda e do movimento da devolução; blocos
  `noPeriodo` = data indicada em cada campo (§4.7–§4.12); `posicaoAtual` = instante da consulta. Fuso: `APP_TIMEZONE`
  (padrão `America/Sao_Paulo`), recorte [00:00 local de `de`, 00:00 local do dia seguinte a `ate`).
- **Resposta**:

| Campo | Tipo |
|---|---|
| `meta` | `meta` |
| `vendas` | `VC` + `canceladas QV` + `periodoAnterior { de D, ate D, VC }` + `variacao VAR` + `porCanal { pdv { receitaLiquidaCentavos C, quantidadeVendas N, ticketMedioCentavos C?, devolucoesCentavos C }, comercioDigital { quantidadePedidosPagos N, valorPedidosPagosCentavos C, freteCentavos C, incluidoNaReceitaLiquida L }?, pedidoDeVenda null }` |
| `devolucoes` | `valorCentavos C`, `quantidadeDocumentos N`, `custoRevertidoCentavos C`, `quantidadeItensMilesimos M`, `deVendasAnterioresAoPeriodo { valorCentavos C, quantidadeDocumentos N }`, `porSituacao [ { situacao E (concluida, em_processamento), valorCentavos C, quantidadeDocumentos N, custoRevertidoCentavos C } ]`, `porTipo [ { tipo E (devolucao, troca), valorCentavos C, quantidadeDocumentos N, custoRevertidoCentavos C } ]` |
| `pdv` | `noPeriodo { caixasAbertos N, caixasFechados N, caixasComDiferenca N, diferencaTotalCentavos C, sobrasCentavos C, faltasCentavos C (≤ 0) }`, `posicaoAtual { caixasEmAberto N, caixasAbertosDeDiasAnteriores N, terminaisAtivos N }` |
| `comercioDigital` | `lojaCriada L`, `situacaoLoja E?` (rascunho, publicada, pausada), `noPeriodo { pedidosCriados QV, pedidosPagos { quantidade N, valorCentavos C, freteCentavos C, descontosCentavos C }, pedidosCancelados QV, porSituacao SQV[] }?`, `posicaoAtual { aguardandoPagamento N, aFaturar N, aExpedirOuRetirar N, devolucoesSolicitadas N }?` |
| `estoque` | `posicaoAtual { saldos N, valorCentavos C, fisicoMilesimos M, reservadoMilesimos M, disponivelMilesimos M, emTransitoMilesimos M, abaixoDoMinimo N, rupturas N, saldosZerados N, saldosNegativos N }` |
| `compras` | `noPeriodo { pedidosCriados QV, pedidosRecebidos { quantidade N, noPrazo N }, recebimentosConfirmados { quantidade N, valorDevidoCentavos C, valorFaturadoCentavos C } }`, `posicaoAtual { aguardandoAprovacao QV, aReceber { quantidade N, valorRestanteCentavos C, atrasados N, previstosProximos7Dias N }, recebimentosEmConferencia { quantidade N, valorFaturadoCentavos C }, recebimentosComDivergencia N, aguardandoNota { quantidade N, valorProvisorioCentavos C, comPrazoVencido N } }` |
| `financeiro` | `noPeriodo { recebido { quantidadeBaixas N, valorCentavos C }, pago { quantidadeBaixas N, valorCentavos C } }`, `posicaoAtual { dataReferencia D, aReceber { emAberto QV, vencido QV, venceHoje QV, proximos7Dias QV }, aPagar { emAberto QV, vencido QV, venceHoje QV, proximos7Dias QV, aAutorizar QV }, saldoContasCentavos C }` |
| `fiscal` | igual ao corpo de `/torre/fiscal` (abaixo), sem `meta` |

#### `GET .../torre/vendas/serie`

- **Escopo** `torre:resumo` · **operação** `torre.vendas.serie` · **parâmetros** `de`, `ate`, `idUnidade`, `granularidade`
  · **sem paginação** (até 400 pontos).
- **Data de referência**: dia local da conclusão/movimento; `mes` = mês do dia local. Fuso do ERP.
- **Resposta**: `meta`; `granularidade E` (dia, mes); `itens [ { data D, VC } ]` (dia: todos os dias do período, inclusive
  sem movimento) ou `itens [ { mes S (AAAA-MM), de D, ate D, VC } ]` (mês: todos os meses tocados pelo período, o primeiro e
  o último podem ser parciais); `total VC`.

#### `GET .../torre/vendas/por-unidade`

- **Escopo** `torre:resumo` · **operação** `torre.vendas.por_unidade` · **parâmetros** `de`, `ate`, `idUnidade` · **sem
  paginação** (uma linha por unidade do recorte, inclusive sem movimento, ordem alfabética do nome).
- **Data de referência**: como em `resumo.vendas`; a devolução conta na unidade onde foi registrada.
- **Resposta**: `meta`; `itens [ { idUnidade id, codigo S?, nome S, situacaoUnidade E (ativa, inativa), VC, periodoAnterior
  { receitaLiquidaCentavos C, quantidadeVendas N, ticketMedioCentavos C?, margemBrutaBps B? }, variacao VAR } ]`; `total VC`;
  `periodoAnterior { de D, ate D, VC }`.

#### `GET .../torre/produtos` e `GET .../torre/skus`

- **Escopo** `torre:detalhe` · **operações** `torre.produtos`, `torre.skus` · **parâmetros** `de`, `ate`, `idUnidade`,
  `incluirSemMovimento`, `limite`, `cursor` · **paginadas**; ordem: `receitaLiquidaCentavos` desc, `quantidadeLiquidaMilesimos`
  desc, código asc, id asc.
- **Data de referência**: como em `resumo.vendas` (base comercial do período). Fuso do ERP.
- **Item (`skus`)**: `idSku id`, `codigoSku S`, `descricao S`, `idProduto id?`, `nomeProduto S?`, `idCategoria id?`,
  `nomeCategoria S?`, `unidadeMedida S?`, `receitaBrutaCentavos C`, `descontosCentavos C`, `acrescimosCentavos C`,
  `devolucoesCentavos C`, `receitaLiquidaCentavos C`, `quantidadeVendidaMilesimos M`, `quantidadeDevolvidaMilesimos M`,
  `quantidadeLiquidaMilesimos M`, `quantidadeVendas N`, `custoRegistrado L`, `custoMercadoriaVendidaCentavos C?`,
  `lucroBrutoCentavos C?`, `margemBrutaBps B?`, `classeAbc E?` (A, B, C), `posicaoAbc N?`, `participacaoBps B?`,
  `acumuladoBps B?`, `semMovimento L`.
- **Item (`produtos`)**: `idProduto id?`, `codigoProduto S?`, `nomeProduto S`, `idCategoria id?`, `nomeCategoria S?`,
  `quantidadeSkusComMovimento N` e os mesmos campos de valores, custo, classe e `semMovimento` do item de SKU.
- **Além da página**: `curva { criterio E (receita_liquida), limites { classeABps B, classeBBps B }, receitaLiquidaCentavos C,
  receitaNaCurvaCentavos C, receitaForaDaCurvaCentavos C, classes { A, B, C: { quantidade N, receitaLiquidaCentavos C,
  participacaoBps B } }, semClasse { comMovimento N, semMovimento N } }`.

#### `GET .../torre/transacoes/vendas`

- **Escopo** `torre:transacoes` · **operação** `torre.transacoes.vendas` · **parâmetros** `de`, `ate`, `idUnidade`,
  `situacao`, `limite`, `cursor` · **paginada**; ordem `concluidaEm` asc, `idVenda` asc.
- **Data de referência**: dia local de `concluidaEm` (também para as canceladas). Fuso do ERP.
- **Item**: `idVenda id`, `numero N?`, `situacao E` (concluida, cancelada), `origem E` (pdv, troca), `canal E` (pdv),
  `idUnidade id?`, `idTerminal id?`, `idSessaoCaixa id?`, `idOperador id?`, `idVendedor id?`, `idCliente id?`,
  `situacaoFiscal E?`, `idDocumentoFiscal id?`, `concluidaEm I`, `data D`, `canceladaEm I?`, `quantidadeLinhas N?`,
  `quantidadeItensVenda N?`, `receitaBrutaCentavos C`, `descontosCentavos C`, `acrescimosCentavos C`, `valorLiquidoCentavos C`,
  `custoCentavos C`, `margemBrutaBps B?`.
- **Além da página**: `totais { concluidas { quantidade N, valorLiquidoCentavos C }, canceladas { quantidade N,
  valorLiquidoCentavos C }? }`.

#### `GET .../torre/transacoes/devolucoes`

- **Escopo** `torre:transacoes` · **operação** `torre.transacoes.devolucoes` · **parâmetros** `de`, `ate`, `idUnidade`,
  `limite`, `cursor` · **paginada**; ordem `registradaEm` asc, `idDevolucao` asc.
- **Data de referência**: dia local do movimento da devolução (`registradaEm`). Fuso do ERP.
- **Item**: `idDevolucao id`, `numero N?`, `tipo E` (devolucao, troca), `situacao E` (concluida, em_processamento),
  `compensacao E?` (vale_credito, troca, reembolso), `formaReembolso E?` (dinheiro, pix, conta, estorno_cartao, reembolso),
  `idUnidade id?`, `idCliente id?`, `registradaEm I`, `data D`, `idVendaOriginal id`, `numeroVendaOriginal N?`,
  `vendaOriginalEm I?`, `vendaAnteriorAoPeriodo L`, `quantidadeLinhas N`, `valorCentavos C`, `custoRevertidoCentavos C`,
  `valorAbatidoTituloCentavos C?`.
- **Além da página**: `totais { quantidade N, valorCentavos C, custoRevertidoCentavos C }`.

#### `GET .../torre/estoque`

- **Escopo** `torre:detalhe` · **operação** `torre.estoque` · **parâmetros** `idUnidade`, `limite`, `cursor` (sem período:
  `de`/`ate` são ignorados e `meta.periodo` é `null`) · **paginada**; ordem `codigoSku`, `idUnidade`, `idDeposito`, `idSaldo`
  (asc).
- **Data de referência**: posição no instante da consulta (`ultimoMovimentoEm` em UTC).
- **Item**: `idSaldo id`, `idSku id`, `codigoSku S`, `descricaoSku S`, `idProduto id?`, `nomeProduto S`, `idCategoria id?`,
  `produtoAtivo L`, `unidadeMedida S?`, `idUnidade id`, `idDeposito id`, `nomeDeposito S`, `tipoDeposito E?` (disponivel,
  avarias, uso_consumo), `fisicoMilesimos M`, `reservadoMilesimos M`, `disponivelMilesimos M`, `emTransitoMilesimos M`,
  `aChegarMilesimos M`, `minimoMilesimos M`, `custoMedioCentavos C` (por unidade de medida = 1000 milésimos),
  `valorCentavos C`, `abaixoDoMinimo L`, `ultimoMovimentoEm I?`.
- **Além da página**: `totais { saldos N, valorCentavos C, fisicoMilesimos M, reservadoMilesimos M, disponivelMilesimos M,
  abaixoDoMinimo N }`.

#### `GET .../torre/financeiro`

- **Escopo** `torre:resumo` · **operação** `torre.financeiro` · **parâmetros** `de`, `ate`, `idUnidade` · **sem paginação**.
- **Data de referência**: baixas pela data da baixa (`D`, já no dia local); DRE pela data de competência; posição e aging
  com `dataReferencia` = hoje no fuso do ERP, pelo saldo atual das parcelas.
- **Resposta**: `meta`; `noPeriodo { recebido { quantidadeBaixas N, valorCentavos C }, pago { quantidadeBaixas N,
  valorCentavos C }, dre { receitaLiquidaCentavos C, lucroBrutoCentavos C, resultadoOperacionalCentavos C,
  resultadoCentavos C, cmvCentavos C, grupos [ { grupo E, rotulo S, valorCentavos C } ], foraDoResultado [ { grupo E,
  rotulo S, valorCentavos C } ], conferenciaDiferencaCentavos C, itensSemClassificacao N } }`; `posicaoAtual { dataReferencia
  D, aReceber { emAberto QV, vencido QV, venceHoje QV, proximos7Dias QV }, aPagar { emAberto QV, vencido QV, venceHoje QV,
  proximos7Dias QV, aAutorizar QV }, saldoContasCentavos C, aging { aReceber, aPagar: { dataReferencia D, totalCentavos C,
  vencidoCentavos C, faixas [ { faixa E (a_vencer, de_1_a_30_dias, de_31_a_60_dias, de_61_a_90_dias, acima_de_90_dias),
  valorCentavos C, quantidadeParcelas N } ] } }, contas [ { idConta id, nome S, tipo E (caixa, banco, carteira_digital), compartilhada L,
  saldoCentavos C } ] }`. Valores de `grupo` do DRE: receita_bruta, deducoes, cmv, custo_dos_servicos,
  despesas_operacionais, despesas_com_pessoal, despesas_administrativas, outras_despesas, receitas_financeiras,
  despesas_financeiras, outras_receitas; fora do resultado: compras_mercadorias, investimentos, adiantamentos_rede.

#### `GET .../torre/fiscal`

- **Escopo** `torre:resumo` · **operação** `torre.fiscal` · **parâmetros** `de`, `ate`, `idUnidade` · **sem paginação**.
- **Data de referência**: `autorizadas`/`simuladas` por `authorizedAt`; emitidos, faturamento e pendentes entre emitidos
  por `issuedAt`; `cancelamentos` por `cancelledAt`; `rejeicoes` pelo instante do evento — todos com o recorte no fuso do
  ERP. `posicaoAtual` = estado atual, sem recorte de data.
- **Resposta**: `meta`; `noPeriodo { autorizadas QV, simuladas QV, documentosEmitidos N, documentosEmitidosSimulados N,
  faturamentoFiscal { brutoCentavos C, devolucoesCentavos C, liquidoCentavos C, documentos N }, pendentesEntreEmitidos QV,
  rejeicoes N, cancelamentos QV, porModelo [ { modelo E (nfce, nfe, nfse), autorizadas QV, simuladas QV, emitidos N,
  porSituacao SQV[], faturamentoFiscalBrutoCentavos C, rejeicoes N, cancelamentos QV } ] }`; `posicaoAtual { pendencias
  { pendentes N, processando N, rejeitados N }, porModelo [ { modelo E, pendentes N, processando N, rejeitados N } ] }`.
  Valores de `situacao`: rascunho, pendente, na_fila, processando, autorizado, rejeitado, denegado, erro, cancelado,
  contingencia, inutilizado, descartado.

#### `GET .../torre/compras`

- **Escopo** `torre:resumo` · **operação** `torre.compras` · **parâmetros** `de`, `ate`, `idUnidade` · **sem paginação**.
- **Data de referência**: pedidos criados por `createdAt`; pedidos recebidos por `updatedAt` (última alteração);
  recebimentos por `confirmedAt` — recorte no fuso do ERP; `posicaoAtual` = estado atual.
- **Resposta**: `meta`; `noPeriodo { pedidosCriados QV, pedidosRecebidos { quantidade N, noPrazo N },
  recebimentosConfirmados { quantidade N, valorDevidoCentavos C, valorFaturadoCentavos C }, pedidosCriadosPorSituacao SQV[] }`;
  `posicaoAtual { aguardandoAprovacao QV, aReceber { quantidade N, valorRestanteCentavos C, atrasados N,
  previstosProximos7Dias N }, recebimentosEmConferencia { quantidade N, valorFaturadoCentavos C }, recebimentosComDivergencia
  N, aguardandoNota { quantidade N, valorProvisorioCentavos C, comPrazoVencido N }, pedidosPorSituacao SQV[],
  recebimentosPorSituacao SQV[] }`.

#### `GET .../torre/comercio-digital`

- **Escopo** `torre:resumo` · **operação** `torre.comercio_digital` · **parâmetros** `de`, `ate`, `idUnidade` · **sem
  paginação**.
- **Data de referência**: criados por `createdAt`, pagos por `paidAt`, cancelados por `cancelledAt` (recorte no fuso do
  ERP); `posicaoAtual`, `banco` e `monitor` = estado atual, sem recorte de período.
- **Resposta**: `meta`; `lojaCriada L`; `situacaoLoja E?`; `noPeriodo { pedidosCriados QV, pedidosPagos { quantidade N,
  valorCentavos C, freteCentavos C, descontosCentavos C }, pedidosCancelados QV, porSituacao SQV[] }?`; `posicaoAtual {
  aguardandoPagamento N, aFaturar N, aExpedirOuRetirar N, devolucoesSolicitadas N, porSituacao SQV[], banco {
  previstoLiquidoCentavos C, creditadoLiquidoCentavos C, conciliadoLiquidoCentavos C, transacoesConciliadas N,
  brutoCentavos C, taxasCentavos C, disponivelCentavos C, simulado L }?, monitor { falhas N, pendentes N, concluidos N,
  ignorados N, total N }? }?`. Sem loja virtual: `lojaCriada: false` e os demais `null`.

#### `GET .../torre/adocao`

- **Escopo** `torre:resumo` · **operação** `torre.adocao` · **parâmetros** `idUnidade` (só para os sinais operacionais;
  sem período: `meta.periodo` é `null`) · **sem paginação**.
- **Data de referência**: instantes em UTC; janelas de 7 e 30 dias contadas para trás a partir do instante da consulta
  (168 h e 720 h).
- **Resposta**: `meta`; `ultimaAtividade { em I?, fonte E (auditoria) }`; `ultimoAcesso { em I?, fonte E (login) }`;
  `usuarios { total N, ativos N, convitesPendentes N, convitesExpirados N, suspensos N, inativos N, nuncaAcessaram N }`;
  `usuariosAtivos { ultimos7Dias N, ultimos30Dias N, fonte E (auditoria) }`; `usuariosComAcesso { ultimos7Dias N,
  ultimos30Dias N, fonte E (login) }`; `atividadeOperacional { ultimaVenda { em I, idUnidade id?, situacao E? }?,
  ultimaAberturaCaixaEm I?, ultimoMovimentoEstoqueEm I?, ultimoDocumentoFiscalEm I?, ultimoPedidoOnlineEm I? }`;
  `terminais { ativos N, ultimaAtividadeEm null }`; `pendenciasIntegracao { documentosFiscais { pendentes N, processando N,
  rejeitados N }, comercioDigital { falhas N, pendentes N }?, tarefas { comFalhaEmNovaTentativa N, esgotadas N, travadas N,
  retidas N }, rotinasComFalha null }`.
