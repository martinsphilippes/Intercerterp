# 05 — Indicadores oficiais para a Torre de Controle (Interos)

> **Natureza.** Mapeamento factual, somente leitura, de onde e como o ERP calcula os indicadores exibidos nas telas, para que a API consumida pela Torre de Controle (Interos) reutilize **os mesmos cálculos**. Nenhum código foi alterado. Referências no formato `arquivo:linha`, relativas à raiz do repositório (branch `claude/eager-tesla-oark2w`, commit `0aa96c2`).
>
> **Unidades.** Dinheiro em **centavos** inteiros; quantidades em **milésimos** (`QTY = 1000`); percentuais, margens e variações em **pontos-base** (1% = 100 bps) — `src/lib/money.ts`.

## Sumário

0. Base comum (unidades, datas e fuso, período e filial, serviço único de métricas, camada de leitura)
1. Painel do gestor
2. Relatórios gerenciais, metas e relatórios financeiros
3. Curva ABC
4. Fontes por domínio para a API analítica
5. Sinais de adoção e operação
6. Lacunas e cuidados
7. Anexo — funções reutilizáveis e suas dependências

---

## 0. Base comum

### 0.1 Unidades e arredondamento

| Função | Onde | Regra |
|---|---|---|
| `QTY` | `src/lib/money.ts:7` | 1 unidade = 1000 milésimos |
| `roundDiv` | `src/lib/money.ts:10-18` | divisão inteira, arredondamento "metade para longe de zero"; divisor 0 lança erro |
| `lineTotal` | `src/lib/money.ts:21-23` | preço (centavos) × quantidade (milésimos) ÷ 1000 |
| `pct` | `src/lib/money.ts:26-28` | valor × bps ÷ 10000 |
| `allocate` | `src/lib/money.ts:34-53` | rateio pelo maior resto (fecha os centavos): desconto/acréscimo global, frete da NF-e, cupom do e-commerce |
| `marginBps` | `src/lib/money.ts:115-118` | (receita − custo) × 10000 ÷ receita; **`null` quando receita ≤ 0** |
| `markupBps` | `src/lib/money.ts:120-123` | (preço − custo) × 10000 ÷ custo; `null` quando custo ≤ 0 |

Telas que usam `Math.round` em vez de `roundDiv` (podem divergir em .5 e em negativos): `src/app/(app)/vendas/page.tsx:53` (tendência) e `:95` (ticket da listagem), `src/app/(app)/clientes/queries.ts:77` (ticket de 30 dias), `src/app/(app)/compras/pedidos/page.tsx:128` (% no prazo).

### 0.2 Datas, instantes e fuso

- **Instantes** (`completedAt`, `authorizedAt`, `occurredAt`, `createdAt`…) em ISO-8601 UTC; **datas de calendário** (`dueDate`, `competenceDate`, `account_entries.date`, `settlements.date`, `goals.period`) em texto `AAAA-MM-DD` (`src/lib/db/schema.ts:9-16`; `src/lib/dates.ts:1-5`).
- **Fuso único da instalação**: `DEFAULT_TZ = process.env.APP_TIMEZONE || "America/Sao_Paulo"` (`src/lib/dates.ts:7`). Vale para todas as empresas e filiais (`src/app/(app)/administracao/parametros/catalog.ts:329-330`); `branches.timezone` é gravado só como referência (`src/domain/companies.ts:287-288`). Não há fuso por empresa nem por filial.
- **Recorte de instantes**: `dayRange(from, to)` = [00:00 local do 1º dia, 00:00 local do dia seguinte ao último), convertido para UTC, com ajuste de horário de verão (`src/lib/dates.ts:42-51`, `:66-69`). Dia local de um instante: `toLocalDate` (`:26-29`); "hoje": `today()` (`:31-33`).
- Datas de calendário já nascem no dia local (ex.: `date = toLocalDate(completedAt)` na venda — `src/domain/sales.ts:442`) e são comparadas como texto com `today()`.
- Exceções que cortam por **UTC**: §6.2.3.

### 0.3 Período, comparação e filial nas telas de análise

- `resolvePeriod` (`src/domain/reports.ts:87-101`): `periodo` = `hoje` | `7d` | `mes` | `mes-anterior`, ou `de`/`ate` (dd/mm/aaaa ou AAAA-MM-DD). Data inválida ou invertida → período padrão + mensagem; limite de **400 dias** (`MAX_PERIOD_DAYS`, `:47`, `:97`). "Mês atual" = dia 1º até hoje (`:63-65`).
- Período anterior = mesma quantidade de dias imediatamente antes (`previousPeriod`, `:104-108`). Ex.: 01–26/11 compara com 06–31/10, não com 01–26/10.
- `resolveReportParams` (`src/app/(app)/relatorios/params.ts:24-35`): filial = `filial` da URL (`todas` ou id acessível) → filial do contexto da sessão → `todas`; uma única filial acessível é forçada (`:29`); `branchIds` = filiais acessíveis, **nunca nulo** (`:30`); `scope = { companyId, branchIds, from, to }` (`:34`).
- Filiais acessíveis = `s.branches` (filiais da empresa ativa liberadas ao usuário — `src/lib/server/session.ts:78`); contexto "consolidado" só para administrador ou usuário sem restrição de filial (`:50-51`).
- As **listagens operacionais** (vendas, devoluções, caixa, financeiro) obedecem à filial do **contexto** da sessão, não à da URL, salvo no contexto consolidado: `params.ts:44-51`; `src/app/(app)/vendas/queries.ts:46`, `:207`; `src/app/(app)/caixa/queries.ts:22`; `src/app/(app)/financeiro/queries.ts:59-61`. Por isso o painel só cria links de detalhe quando a listagem abre exatamente o mesmo recorte (`contextShowsScope` `params.ts:49-51`; `fiscalShowsScope` `:54-56`).

### 0.4 Serviço único de métricas comerciais — `src/domain/reports.ts`

Painel, relatórios gerenciais, detalhe por filial, curva ABC, metas e o CMV do DRE usam a mesma base: `loadFacts` + `totalsOf` (definições no cabeçalho: `src/domain/reports.ts:7-23`). Regras da base comercial, citadas adiante como **RBC-n**:

- **RBC-1 — Vendas.** `sales` com `completedAt` ∈ recorte e `branchId` ∈ filiais do recorte (`:203`; filtros `:126-131`). Entram só `status = "completed"` (`:204`); `status = "cancelled"` vai para lista à parte (`:205`); outros estados são ignorados.
- **RBC-2 — Itens.** `sale_items` filtrados pelo `completedAt`/`branchId` gravados no próprio item (`:208`), mantidos só se a venda está concluída. Por linha: bruto = `grossTotal`; desconto = `itemDiscount + globalDiscount`; `surcharge`; `total`; custo = `costTotal`; `qty`; categoria gravada no item no momento da venda; operador e cliente da venda (`:210-239`). Dia = dia local de `completedAt` (`:222`).
- **RBC-3 — Devoluções.** `return_items` com `completedAt` ∈ recorte (`:249`) cujo documento tem `returns.status` ∈ {`completed`, `processing`} (`ELIGIBLE_RETURN_STATUSES`, `:200`, `:251-252`). Devolução gravada com efeitos ainda pendentes (`effectsStatus = "pending"`) entra pelas linhas do próprio documento (`returns.lines`), na data `returns.createdAt`, sem duplicar (`:241-263`). Data e filial **do movimento da devolução** (`:279-281`), mesmo com venda anterior ao recorte; SKU, categoria e descrição do item vendido (`:283-287`); operador da venda original (`:288`). Na linha de devolução `total` = valor devolvido e `cost` = custo revertido (`:290-296`).
- **RBC-4 — Totais** (`totalsOf`, `:337-366`):
  - `salesNet = gross − discounts + surcharges`;
  - `netRevenue = salesNet − returns` (**receita líquida comercial** = "vendas líquidas" = "faturamento" do painel);
  - `cmv = costSold − costReturned`; `grossProfit = netRevenue − cmv`;
  - `marginBps = marginBps(netRevenue, cmv)` (`null` se `netRevenue ≤ 0`);
  - `salesCount` = vendas distintas que têm linhas; `returnsCount` = documentos de devolução distintos;
  - `ticket = roundDiv(netRevenue, salesCount)` (`null` sem vendas);
  - `qtySold`, `qtyReturned`, `qtyNet = qtySold − qtyReturned` (milésimos; unidades misturadas).
- **RBC-5 — Agregação.** Grupos e totais sempre recalculados a partir das somas (`groupTotals`, `:368-377`) — nunca média de margens ou tickets.
- **RBC-6 — Variação.** `variationBps(cur, prev) = (cur − prev) × 10000 ÷ |prev|`; `null` com anterior 0 ou nulo (`:380-383`). Margem compara em pontos percentuais (`src/app/(app)/relatorios/_components/report-ui.tsx:125-127`).
- **RBC-7 — Descontos e acréscimos.** Desconto do item (inclui o de promoção) + rateio do desconto global pelo líquido de cada item; acréscimo do item + rateio do acréscimo global (`src/domain/pricing-calc.ts:48-86`). Pagamento com vale-crédito ou com pontos de fidelidade é **meio de pagamento**, não desconto: não reduz a receita.
- **RBC-8 — Fora da base.** Frete e impostos não são receita de produto (`reports.ts:13-14`; `report-ui.tsx:178`); taxas de cartão ficam no financeiro (`src/app/(app)/relatorios/gerenciais/page.tsx:256`). Pedidos on-line, NF-e de pedido de venda e NF-e avulsa **não geram `sales`** — o único `create` de `sales` está em `src/domain/sales.ts:557` (ver §4.3 e §6.1).
- **RBC-9 — Custo ausente.** Custo do item = custo médio vigente do saldo, senão `skus.costTotal`, senão **0**; serviço tem custo 0 (`src/domain/sales.ts:451-457`). Custo 0 infla a margem.
- **RBC-10 — Valores ausentes.** Números nulos viram 0 (`?? 0`); categoria ausente = "Sem categoria"; operador ausente = "Não identificado"; cadastro removido = "Categoria removida"/"Usuário removido" (`reports.ts:531-536`).
- Definições exibidas ao usuário: `report-ui.tsx:177-187` ("Como calculamos"); regras assumidas: `docs/regras-assumidas.md:137-145`. Testes de regressão: `tests/reports.test.ts:17-187` (inclui "painel e gerenciais retornam o mesmo faturamento", `:164`), `tests/painel-round2.test.ts:22-110`, `tests/abc.test.ts:41-124`, `tests/goals.test.ts:26-110`.

### 0.5 Camada de leitura

- `listAll` (`src/lib/db/index.ts:99-110`): lê páginas de 1000 e **para em `max` (padrão 100 000) sem aviso**. No Postgres, sem `orderBy` a ordem é a de inserção (`_seq` — `src/lib/db/postgres/store.ts:305-309`, `:314-318`): com corte, ficam os registros **mais antigos**.
- Filtro sobre campo fora do esquema devolve **nenhuma linha** (`src/lib/db/postgres/store.ts:95-96`).
- Isolamento por empresa: `ScopedStore` acrescenta `companyId` às consultas (`src/lib/db/scoped-store.ts:5-17`); o comércio digital usa `unscoped()` com filtros explícitos por loja/empresa.
- Cache: memória por requisição + 15 s entre requisições só para `companies`, `branches`, `roles`, `settings`, `payment_methods` (`src/lib/db/read-cache.ts:4-16`).

---

## 1. Painel do gestor — `/dashboard`

- Página `src/app/(app)/dashboard/page.tsx:53-81`; consultas operacionais em `src/app/(app)/dashboard/queries.ts` (o comercial vem de `src/domain/reports.ts` — `queries.ts:7-10`).
- Empresa do tipo escritório contábil → `/contabil`; parceiro da rede de certificação → `/rede/minha` (`page.tsx:56-58`) — painéis próprios, fora deste mapeamento.
- Filtros: `periodo`, `de`, `ate`, `filial` (`page.tsx:60`, `:185`; `report-ui.tsx:17-68`). Padrão: mês atual. **Sem paginação.**
- Visibilidade por perfil (`page.tsx:61-67`): comercial = `sales` ou `reports`; custo/margem = `reports`; financeiro = `finance`; fiscal = `fiscal`; estoque = `stock` ou `purchases`; caixa = `cash` ou `pdv`.
- "Como calculamos" do painel: `page.tsx:606-616`.

### 1.1 Indicadores comerciais (seguem período e filial)

Fonte: `commercialOverview(store, scope)` (`src/domain/reports.ts:459-472`) — `loadFacts` do recorte e do período anterior equivalente, série e canceladas. Valem RBC-1 a RBC-10: data de conclusão da venda / data do movimento da devolução, corte no fuso da instalação; canceladas fora; devoluções concluídas e em processamento abatidas na data do movimento; descontos abatidos; frete fora; escopo = filiais do recorte (consolidado = soma das filiais acessíveis).

| Indicador (rótulo) | Exibição | Cálculo | Particularidades |
|---|---|---|---|
| Vendas líquidas (faturamento) | `page.tsx:198` | `totals.netRevenue` | Variação vs. período anterior (`report-ui.tsx:121-147`). Link: `/vendas?situacao=completed` quando a listagem abre o recorte; senão operações dos gerenciais (`page.tsx:94`; `params.ts:59-71`) |
| Vendas concluídas | `page.tsx:199` | `totals.salesCount` | Devolução não reduz a contagem; conta vendas que têm ao menos uma linha (venda grande entra com receita parcial até a gravação dos itens restantes — §6.2.4) |
| Ticket médio | `page.tsx:200` | `totals.ticket` | "Sem vendas" quando `null` |
| Margem bruta | `page.tsx:201` | `totals.marginBps`; dica `grossProfit` | Só com permissão `reports` (`:66-67`); "Sem receita" quando `null` (`report-ui.tsx:149-151`); variação em p.p. |
| Devoluções no período | `page.tsx:202` | `totals.returns`, `returnsCount`; com `reports`, `costReturned` | Data do movimento; inclui devolução "em processamento" (estorno de cartão) |
| Nota "N venda(s) cancelada(s)" | `page.tsx:209-222` | `facts.cancelled`: quantidade e Σ `sales.total` (`reports.ts:469`) | Referência = data de **conclusão** da venda, não a do cancelamento |
| Gráfico "Faturamento por dia/por hora" | `page.tsx:240-267` | `revenueSeries` (`reports.ts:428-454`): `netRevenue` por dia local, todos os dias do período; com 1 dia, por hora local (`localHour` `:144-147`), cortando horas sem movimento nas pontas mas mantendo 8h–20h (`:438-442`); anterior alinhado por posição | Total e máximo do gráfico somados no navegador sobre os pontos do servidor (`src/components/charts/revenue-chart.tsx:45-47`) |

### 1.2 Meta mensal (card do painel)

- Fonte: `goalsProgress(ctx, mês, { branchIds })` (`src/domain/goals.ts:219-283`); mês = mês da **data final** do período escolhido (`page.tsx:69`), qualquer que seja o período.
- Realizado = do dia 1º até min(fim do mês, hoje) (`goals.ts:221-223`), pela base comercial: receita líquida, nº de vendas ou ticket (`actualFor` `:209-213`; métricas `:19-23`). Meta de vendedor: só as vendas (e devoluções delas) do vendedor da venda ou, sem vendedor, do operador (`:243-247`).
- Progresso = `roundDiv(realizado × 10000, meta)` (`:258`); esperado = meta × dias decorridos ÷ dias do mês (ticket: a própria meta) (`:259`); projeção linear (`:260`); situação: atingida (≥ 100%), mês encerrado abaixo, no ritmo (realizado ≥ esperado) ou abaixo do ritmo (`:262-267`; rótulos `:295-301`).
- Escopo: meta por filial ou da empresa (`goals.branchId` nulo); meta da empresa só para quem acessa todas as filiais (`:226-229`); com filial única no painel, só metas daquela filial (`page.tsx:83`).

### 1.3 Indicadores de situação atual (não seguem o período, salvo indicação)

| Indicador | Função (`dashboard/queries.ts`) | Regra | Escopo / observações |
|---|---|---|---|
| Saldo disponível (+ "a receber hoje") | `financeSnapshot` `:98-120` | Σ `financial_accounts.balance` das contas **ativas** (`:106-108`, `:118`); a receber hoje = parcelas `receivable` `open`/`partial` com `dueDate = hoje`, pelo **saldo** (`:102-103`, `:113`) | Contas sem filial (compartilhadas) entram sempre; parcelas sem filial só no consolidado (`:101`, `:107`). Exibição `page.tsx:205` |
| Recebíveis vencidos · A pagar hoje · A pagar — próximos 7 dias · A pagar vencidas | `financeSnapshot` `:112-116` | Parcelas `open`/`partial` pelo saldo: vencidas `dueDate < hoje`; hoje `= hoje`; 7 dias `> hoje` e `≤ hoje + 7` | Lê só `installments`: títulos "previstos"/"provisórios" da entrada com nota a confirmar (`titles.forecast`/`provisional`, `schema.ts:634-647`) não são distinguidos. Exibição `page.tsx:526-563` |
| Estoque crítico (sem estoque / abaixo do mínimo) | `stockAlerts` `:79-95` | Saldo SKU × depósito: disponível = `physical − reserved`; alerta se `minQty > 0` e disponível ≤ mínimo (`:82-83`); "sem estoque" = disponível ≤ 0 (`page.tsx:99`) | Todos os depósitos das filiais do recorte; mesmo critério de `/estoque?situacao=below_min` (`src/app/(app)/estoque/queries.ts:122`, `:131`). O card lista 7 (`page.tsx:573`); a contagem é total |
| Pendências fiscais (pendentes · processando · rejeitados) | `fiscalSnapshot` `:135-155` + `FISCAL_BUCKETS` `:122-126` | Contagem por modelo (`nfce`, `nfe`, `nfse`) de `fiscal_documents` com status: pendentes = `pending`, `draft`, `contingency`; processando = `queued`, `processing`; rejeitados = `rejected`, `denied`, `error` | **Estado atual, sem recorte de data** (`:139`). Exibição `page.tsx:207`; links com `from=2000-01-01` (`page.tsx:101`) |
| Resumo fiscal — autorizadas | `fiscalSnapshot` `:137`, `:146-150` | Quantidade e Σ `total` dos documentos com `status = "authorized"` **agora** e `authorizedAt` no período; `isSimulated` à parte | **Segue o período.** Autorizado no período e cancelado depois sai da contagem. Homologação conta como autorizada (§6.2.7). Exibição `page.tsx:436-525` |
| Caixas abertos / "Caixa aberto desde…" | `openCashSessions` `:40-46` | `cash_sessions.status ∈ {open, reopened}`; antigo = dia local de `openedAt` < hoje (`:45`) | Exibição `page.tsx:152-166`; alerta `:128` |
| Últimas vendas | `latestSales` `:12-37` | 8 vendas mais recentes por `completedAt` | **Sem filtro de período nem de situação** (inclui canceladas); valor `sales.total` e `returnedTotal` (`page.tsx:376-377`) |
| Certificado digital | `certificateAlerts` `:49-59` | `fiscal_configs.certificate.validTo` vencido ou a ≤ 30 dias | Configuração da empresa vale para todas as filiais (`:53`) |
| Compras aguardando nota com prazo vencido | `page.tsx:124-127` | `receipts` com `documentStatus = "pending_invoice"`, `status = "confirmed"`, `invoiceDueAt < hoje`; valor Σ `dueTotal` | Só com permissão `purchases` e recurso `notaAConfirmar` |
| Alertas importantes | `page.tsx:110-128` | Regras acima + contas vencidas/a pagar hoje + documentos rejeitados/pendentes | Exibe 8 (`page.tsx:408`) |

---

## 2. Relatórios gerenciais, metas e relatórios financeiros

### 2.1 Central de relatórios — `/relatorios`

- `src/app/(app)/relatorios/page.tsx:27-37` lista o catálogo `REPORT_CATALOG` (`src/lib/report-catalog.ts:28-80`) filtrado por módulo, operação especial e recurso (`visibleReports`, `:85-87`). **Não calcula nada**: cada item aponta para uma tela e para chaves de `/api/export/<chave>`.
- Chaves de Gestão: `reports-units`, `reports-breakdown` (gerenciais), `reports-abc` (curva ABC), `reports-goals` (metas) — `report-catalog.ts:31-33`; financeiros: `fin-dre`, `fin-aging` (`:63`).

### 2.2 Relatórios gerenciais — `/relatorios/gerenciais`

Tela `src/app/(app)/relatorios/gerenciais/page.tsx`. Fonte: `managerialReport(store, scope, { compare, branchIds })` (`src/domain/reports.ts:505-550`) e, na aba de pagamento, `paymentBreakdown` (`:573-620`). Filtros: período, filial, `tab` (`dia` | `categoria` | `operador` | `pagamento` — `params.ts:80-85`), `cmp=0` desliga a comparação (`page.tsx:36-38`). Regras RBC.

| Bloco | Exibição | Cálculo |
|---|---|---|
| Vendas líquidas · Vendas brutas (descontos e devoluções na dica) · Custo direto (CMV) · Margem bruta · Vendas concluídas · Ticket médio | `page.tsx:94-101` | `totals` (`netRevenue`, `gross`, `discounts`, `returns`, `cmv`, `costReturned`, `marginBps`, `grossProfit`, `salesCount`, `returnsCount`, `ticket`) |
| Canceladas no período | `page.tsx:102-115`, `:127-128` | Mesma regra do painel (`reports.ts:547`) |
| Resultado por filial | `page.tsx:117-136`; tabela `src/app/(app)/relatorios/_components/tables.tsx:16-120` | `byBranch`: todas as filiais do recorte, **inclusive sem movimento** (`reports.ts:519-524`); total consolidado = `totals` (margem/ticket pelos totais) |
| Comparação com o período anterior | `page.tsx:138-142`; `tables.tsx:122-170` | `previous` e `previousByBranch` (`reports.ts:513-518`, `:546`) |
| Por dia | `page.tsx:159-174` | `byDay`: todos os dias do período, dia local (`reports.ts:525-530`); um dia pode ter receita negativa (devolução) |
| Por categoria | `page.tsx:175-200` | `byCategory`: categoria gravada no item; venda com itens de várias categorias conta em cada uma (`reports.ts:531-533`; `page.tsx:267`); participação = receita da categoria ÷ total |
| Por operador | `page.tsx:201-205` | `byOperator`: operador da venda; devoluções vão para o operador da venda original (`reports.ts:534-536`) |
| Por meio de pagamento | `page.tsx:206-260` | `paymentBreakdown`: Σ `sale_payments.amount` (valor aplicado, sem troco) por `methodKind` das vendas concluídas; contagem = vendas distintas por meio (`reports.ts:575-589`). Devoluções por documento: parte **abatida do título a prazo** (`abatedAmount`), parte **coberta por desconto concedido no recebimento** e parte **compensada** (forma de compensação/reembolso) (`:601-615`). Identidade: pagamentos − devoluções = receita líquida (`page.tsx:245-249`) |

`paymentBreakdown` não filtra `sale_payments.status` (`reports.ts:575-589`); o resumo do caixa ignora `cancelled`/`failed` (`src/domain/cash.ts:261`). Vale-crédito usado em troca aparece como meio de pagamento (`page.tsx:256`).

### 2.3 Resultado detalhado por filial — `/relatorios/gerenciais/filial/[id]`

- `branchOperations(store, scope)` (`src/domain/reports.ts:658-695`): uma linha por venda (bruto, descontos, acréscimos, líquido = bruto − desconto + acréscimo, custo, margem da venda) e por devolução (com marca "venda anterior ao período", `:683`); canceladas à parte.
- Tela `src/app/(app)/relatorios/gerenciais/filial/[id]/page.tsx:27-48`, indicadores `:112-120`. Conferência automática: Σ vendas − Σ devoluções = receita da filial = receita do `commercialOverview` (`:42-46`; mensagem `:154-155`).
- Paginação **em memória** de 50 linhas (`:40-41`; `src/lib/list.ts:37-54`) depois de carregar tudo.

### 2.4 Metas — `/dashboard/metas`

- `goalsScreen(ctx, mês, { accessibleBranchIds, filial, vendedor })` (`src/domain/goals.ts:286-293`) sobre `goalsProgress` (§1.2). Indicadores: metas no mês, atingidas, abaixo do ritmo/não atingidas, "realizado até" (`src/app/(app)/dashboard/metas/page.tsx:130-133`). Exportação `reports-goals` = mesma regra (`tests/goals.test.ts:90`).

### 2.5 Relatórios financeiros — `/relatorios/financeiros` (`src/domain/finance-reports.ts`)

Exige o módulo `finance` e o recurso `dre` (ligado por padrão) — `src/app/(app)/relatorios/financeiros/page.tsx:31-32`; `src/lib/core/settings.ts:63`. Parâmetros `financeReportParams` (`src/app/(app)/relatorios/financeiros/params.ts:21-35`): período/filial dos gerenciais; `aba` = `dre` | `receber` | `pagar`; `ref` (data de referência do aging, padrão hoje); `faixa`; **`domainBranchIds = null` quando o recorte cobre todas as filiais da empresa** (`:29-33`).

**DRE gerencial** — `computeDre(ctx, { from, to, branchIds })` (`finance-reports.ts:113-206`):
- Base = itens de competência (`competenceItems`, `src/domain/cashflow.ts:399-454`): títulos não cancelados (exceto renegociação) pelo **total** na `competenceDate` (a receber = receita, a pagar = despesa); lançamentos diretos sem título (vendas à vista, cancelamentos, devoluções pagas, tarifas) pela `date`; abatimentos de devolução pela data do abatimento. Encargos de baixa (juros, multa, desconto) não entram (`cashflow.ts:367-374`).
- Grupo = grupo DRE da categoria (ou do ancestral). Sem grupo: receita de origem `sale`, `sale_card`, `sale_payment`, `sale_cancel` → Receita bruta; outra receita → Outras receitas; tarifa → Despesas financeiras; compra → fora do resultado; demais → Outras despesas; devoluções de venda → Deduções (`finance-reports.ts:39`, `:85-96`).
- **CMV pela base comercial** (`loadFacts`): −custo das vendas + custo das devoluções, pela data de cada movimento (`:142-156`). Itens da rede de certificação somados à parte (`:157-170`).
- Subtotais: receita líquida, lucro bruto, resultado operacional, resultado antes de IRPJ/CSLL (`:185-190`). Conferência: resultado = competência − fora do resultado − CMV (+ rede); diferença deve ser 0 (`:192-203`; tela `page.tsx:147-150`).
- Filial: filial única → itens da filial; várias filiais → itens das filiais **e itens sem filial** (`:114-116`); `null` = empresa inteira.

**Aging** — `computeAging(ctx, { kind, ref, branchIds, bucket })` (`finance-reports.ts:285-322`):
- Parcelas `open`/`partial` com saldo > 0 de títulos não cancelados (`:287-289`, `:299`); atraso = `diffDays(dueDate, ref)` (`:300`); faixas: a vencer (≤ 0, inclui vencendo no dia), 1–30, 31–60, 61–90, > 90 (`:228-241`); vencido = atraso > 0 (`:311`); agrupado por cliente/fornecedor (`:303-318`).
- **Posição pelo saldo atual**: `ref` no passado não reconstrói saldos antigos (`:280-284`).
- Com lista de filiais, parcelas sem filial ficam de fora (`:289`); com `domainBranchIds = null`, entram.
- Indicadores por faixa e "Total em aberto/Vencido" (`page.tsx:229-231`); lista paginada em memória, exceto na impressão (`page.tsx:171`).

### 2.6 Exportações que reaproveitam as mesmas consultas

| Chave | Definição | Consulta |
|---|---|---|
| `reports-units` | `src/exports/reports.ts:33` | `managerialReport` |
| `reports-breakdown` | `src/exports/reports.ts:60` | `managerialReport` / `paymentBreakdown` |
| `reports-branch-ops` | `src/exports/reports.ts:87` | `branchOperations` |
| `reports-abc` · `reports-abc-product` | `src/exports/reports.ts:121` · `:157` | `abcReport` · `abcProductLines` |
| `reports-goals` | `src/exports/reports.ts:185` | `goalsScreen` |
| `fin-dre` · `fin-aging` | `src/exports/finance-reports.ts:15` · `:42` | `computeDre` · `computeAging` |

O exportador recebe a **sessão do usuário** e os parâmetros de URL (`src/lib/exporters.ts:17-22`); `/api/export/[key]` exige sessão + permissão do módulo + `data.export` e audita (`src/app/api/export/[key]/route.ts:13-25`). No CSV, dinheiro sai como texto "12,34" (`src/lib/exporters.ts:38-39`).

---

## 3. Curva ABC — `src/domain/abc.ts` e `/relatorios/curva-abc`

- **Base**: `abcReport(store, scope, { criterion, categoryId, limits })` (`abc.ts:150-184`) = `loadFacts` (RBC) → filtro pela categoria do item (`filterLines` `:146-148`; `__none__` = sem categoria) → agregação por SKU (`skuRows`, `src/domain/reports.ts:709-720`, metadados da linha de venda) → acrescenta SKUs **ativos sem movimento** de produtos ativos, com valor 0 (`noMovement`) (`abc.ts:163-171`).
- **Critérios** (`:23-27`; `criterionValue` `:142-144`): receita líquida (padrão, `netRevenue`), quantidade líquida (`qtyNet`), lucro bruto (`grossProfit`).
- **Classificação** (`classifyAbc` `:91-121`; política `:7-18`):
  1. base = itens com valor > 0; valor ≤ 0 → "sem classe", fora do denominador (`:93-94`);
  2. ordem: valor desc; empate pela maior quantidade líquida; depois código do SKU crescente (`:95`);
  3. classe pelo acumulado **anterior** ao item: < limite A → A; < limite B → B; senão C, em aritmética inteira (`:103`);
  4. participação e acumulado sobre a base inteira, em bps com `roundDiv` (`:111-115`, `:119`); filtrar por classe não recalcula o denominador.
- **Limites**: `abc.limitA` = 8000 e `abc.limitB` = 9500 (80%/95%) por empresa ou filial (`src/lib/core/settings.ts:39-40`; `getAbcLimits` `abc.ts:36-40`; filial só quando o recorte é de uma filial — `params.ts:107`); `la`/`lb` na URL ajustam só o recorte, validados 0 < A < B ≤ 100% (`abc.ts:42-57`).
- **Reconciliação**: total do critério = base + sem classe; receita do recorte = receita da base + receita dos sem classe = a dos gerenciais/painel (`abc.ts:173-182`; tela `page.tsx:184-189`).
- **Tela** (`src/app/(app)/relatorios/curva-abc/page.tsx`): parâmetros `criterio`, `categoria`, `classe` (`A`|`B`|`C`|`sem`), `la`, `lb` + período/filial (`params.ts:101-119`). Indicadores: receita líquida do recorte, produtos na curva (A/B/C), sem classe com/sem movimento (`:180-182`); Pareto (`:195-201`); tabela paginada em memória (50) com totais das linhas visíveis e margem recalculada pelos totais (`:55-58`, `:237-244`); markup por SKU (`:51-52`); "Como calculamos" `:255-266`.
- **Detalhe do produto** (`src/app/(app)/relatorios/curva-abc/produto/[skuId]/page.tsx:31-37`): `abcReport` sem SKUs sem movimento + `abcProductLines` (`abc.ts:187-191`) — vendas e devoluções que formam o valor.
- A reposição de compras reclassifica com `classifyAbc` sobre outra base (§6.2.5, linha 19).

---

## 4. Fontes por domínio para a API analítica

### 4.1 Vendas — `sales`, `sale_items`, `sale_payments`

| Coleção | Esquema | Campos relevantes |
|---|---|---|
| `sales` | `src/lib/db/schema.ts:445-462` | `status` (`completed`/`cancelled`), `origin` (`pdv`/`exchange`), `completedAt`, `cancelledAt`, `subtotal`, `discountTotal`, `surchargeTotal`, `total`, `costTotal`, `returnedTotal`, `returnedCost`, `paymentStatus`, `fiscalStatus`, `fiscalDocumentId`, `terminalId`, `cashSessionId`, `operatorId`, `sellerId`, `customerId`, `itemsCount`, `effectsStatus`; índice `branchId + completedAt` |
| `sale_items` | `schema.ts:494-510` | `qty`, `unitPrice`, `grossTotal`, `itemDiscount` (inclui `promoDiscount`), `globalDiscount`, `surcharge`, `total`, `unitCost`, `costTotal`, `returnedQty`, `categoryId`, `completedAt`, `branchId` (copiados da venda) |
| `sale_payments` | `schema.ts:513-526` | `methodKind` (`cash`, `debit`, `credit`, `pix`, `store_credit`, `loyalty`, `crediario`, `boleto`, `voucher`, `other`), `amount` (aplicado), `received`, `change`, `installments`, `feeAmount`, `netAmount`, `status`, `titleId` |

- Criação só pelo PDV (`finalizeSale`, `src/domain/sales.ts:283`; gravação `:557-593`; `status: "completed"` `:569`; `origin` `:568`; `completedAt` = agora `:440`). Total do item = bruto − desconto do item − rateio do global + acréscimo (`src/domain/pricing-calc.ts:48-86`).
- Itens que não cabem na transação são gravados depois pela tarefa `sale.effects` (`sales.ts:502-505`; `ensureSaleItems` `:788-811`): a venda fica concluída sem todos os `sale_items` por um tempo (comparar `sales.itemsCount` com os itens gravados).
- Financeiro por meio de pagamento (`sales.ts:600-683`): dinheiro/Pix/outros → lançamento em conta (`sale_payment`); cartão → título `sale_card` (`:644-648`); crediário/boleto → título `sale` (`:605-609`); **vale-crédito e pontos não geram lançamento nem título** (`:654-670`).
- Cancelamento (`cancelSale`, `sales.ts:920-1000`): muda `status` para `cancelled`, grava `cancelledAt` e **mantém `completedAt`** (`:984`); estornos financeiros datados no dia do cancelamento (`:947`, `:965`, `:971`); venda com devolução não pode ser cancelada (`:930`).
- Consultas: `loadFacts`/`totalsOf` (oficial); `querySales` + `salesTotals` (`src/app/(app)/vendas/queries.ts:40-149`) para a listagem — **outra regra de totais** (§6.2.5).

### 4.2 PDV — `cash_sessions`, `cash_movements`, `terminals`

| Coleção | Esquema | Campos |
|---|---|---|
| `cash_sessions` | `schema.ts:405-414` | `status` (`open`/`reopened`/`closed`), `terminalId`, `operatorId`, `number`, `openedAt`, `openingFund`, `closedAt`, `closedBy`, `version`, `expected`, `counted`, `differences`, `justification`, `blindCount` |
| `cash_movements` | `schema.ts:417-426` | `type` (`opening`, `sale`, `supply`, `withdrawal`, `refund`, `receivable`, `closing_adjust`…), `method`, `amount`, `saleId`, `returnId`, `settlementId`, `occurredAt` |
| `terminals` | `schema.ts:146-153` | `status` (`active`/`inactive`), `nfceSeries`, `tefProvider`, `connectorUrl`, `lastPrinterTestAt`, `lastPrinterTestResult` — **sem última atividade/heartbeat** |

- Previsto por meio (`sessionSummary`, `src/domain/cash.ts:249-305`): pagamentos das vendas concluídas da sessão por `methodKind`, ignorando `cancelled`/`failed` (`:261`); dinheiro esperado = abertura + vendas em dinheiro (já sem troco) + recebimentos de parcelas em dinheiro + suprimentos − sangrias − reembolsos + ajustes (`:293`).
- Fechamento grava `expected`, `counted`, `differences` (contado − previsto por meio) e exige justificativa com divergência (`closeSession` `cash.ts:477-560`; `:512`, `:541-552`); reabertura `:569`.
- Listagem/exportação `querySessions` (`src/app/(app)/caixa/queries.ts:18-77`): sessões com **`openedAt`** no período + as ainda abertas de antes (`:21`, `:28-32`); aberta: previsto calculado agora; fechada: valores gravados; diferença total = Σ `differences` (`:52`); filtro `divergencia=1` (`:76`).
- **Conferência cega**: com o recurso ligado, previsto e total vendido de sessão aberta ficam ocultos até a contagem, exceto para supervisor (`cash.reopen`) — `expectedVisible` (`cash.ts:72-79`); `caixa/queries.ts:45-49`, `:67`; também nas vendas da sessão (`vendas/queries.ts:30-33`, `:60-62`).
- Atividade de terminal só por derivação: `sales.terminalId`/`completedAt`, `cash_sessions.terminalId`/`openedAt`, auditoria de teste de impressão/conector (`src/domain/terminals.ts:172-190`, `:221-231`).

### 4.3 Comércio digital — `online_orders` e `src/domain/ecommerce`

| Coleção | Esquema | Campos |
|---|---|---|
| `online_orders` | `schema.ts:1321-1331` | `status`, `paymentStatus`, `fiscalStatus`, `refundStatus`, `subtotal`, `discount`, `shippingAmount`, `total`, `items` (JSON), `branchId` (filial que atende), `storeId`, `createdAt`, `paidAt`, `invoicedAt`, `readyAt`, `dispatchedAt`, `deliveredAt`, `cancelledAt`, `receivableTitleId`, `fiscalDocumentId` |
| `gateway_transactions` | `schema.ts:1360-1367` | `gross`, `fee`, `net`, `status` (`awaiting_credit`, `credited`, `partial`, `reconciled`, `refunded`, `divergent` — `src/domain/ecommerce/bank.ts:18-27`), `expectedAt`, `creditedAt`, `reconciledAt` |
| `commerce_events` | `schema.ts:1340-1348` | `area`, `action`, `status` (`ok`/`failed`/`ignored`/`pending`), `attempts`, `diagnostic`, `orderId`, `number` |
| `store_carts` | `schema.ts:1302` | `status`, `itemsCount`, `subtotal`, `lastActivityAt` (carrinhos ociosos: `src/domain/ecommerce/promotions.ts:123-143`) |

- Estados (`src/domain/ecommerce/common.ts:39-49`; máquina `orders.ts:29-38`): `pending_payment` → `paid` → `invoiced` → `ready_for_pickup`/`shipped` → `delivered`; `cancelled`; `return_requested` → `returned`. Encerrados: `cancelled`, `returned` (`common.ts:73`).
- Valor: `total = subtotal − desconto (cupom rateado nos itens) + frete` (`src/domain/ecommerce/checkout.ts:204-218`, `:254-259`) — **inclui frete**.
- Pagamento aprovado (`markPaid`, `orders.ts:167-247`): título a receber contra o gateway, `originType = "online_order"`, **`competenceDate` = data UTC do instante do pagamento** (`:173`, `:186-203`); transação do gateway com taxa informada ou estimada (`:205-229`; `estimatedFee` `:160-164`).
- Estoque reservado no checkout; baixa `type = "sale"`, `originType = "online_order"` na expedição/retirada (`consumeStock`, `orders.ts:395-419`); devolução volta ao estoque (`completeReturn`, `:494-523`). NF-e com `originType = "online_order"` (`src/domain/ecommerce/fiscal.ts:100-138`).
- **Não há `sales`/`sale_items` para pedidos on-line** → ficam fora de todos os indicadores comerciais (RBC-8), mas entram no estoque (saída por venda), no fiscal (NF-e autorizada) e no financeiro (título `online_order`; sem categoria, vai para "Outras receitas" no DRE — `finance-reports.ts:92`).
- Indicadores existentes:
  - Central (`src/app/(app)/comercio-digital/page.tsx:122-129`): "Pedidos hoje" = pedidos não cancelados com `createdAt` no dia **UTC** e Σ `total` (com frete, inclui `pending_payment`) (`:90-92`); "A faturar" = `paid`; "A expedir/retirar" = `invoiced` + `ready_for_pickup`; base limitada a 5000 pedidos (`:80`). A página chama `expirePendingOrders` ao abrir (`:74`).
  - Pedidos (`src/app/(app)/comercio-digital/pedidos/page.tsx:29-46`): contagens por status sobre até 5000 pedidos; lista 300.
  - Banco (`bankOverview`, `src/domain/ecommerce/bank.ts:39-58`): previsto, creditado, conciliado, taxas, bruto — **sem recorte de período** apesar do rótulo "Taxas do período" (`src/app/(app)/comercio-digital/banco/page.tsx:45`), até 5000 transações.
  - Monitor (`src/domain/ecommerce/monitor.ts:17-30`): §5.3.
- Canais/marketplaces só planejados (`src/domain/ecommerce/channels.ts:10-14`).

### 4.4 Devoluções e trocas — `returns`, `return_items`, `credit_vouchers`

| Coleção | Esquema | Campos |
|---|---|---|
| `returns` | `schema.ts:540-552` | `kind` (`return`/`exchange`), `status` (`completed`; `processing` = estorno no cartão aguardando a adquirente), `compensation` (`store_credit`, `exchange`, `refund`), `refundMethod`, `itemsTotal`, `costTotal`, `abatedAmount`, `compensatedAmount`, `lines`, `effectsStatus`, `createdAt`, `completedAt`, `exchangeSaleId` |
| `return_items` | `schema.ts:555-561` | `saleItemId`, `skuId`, `qty`, `total`, `costTotal`, `completedAt` (= `returns.createdAt`), `branchId` |
| `credit_vouchers` | `schema.ts:564` | vale-crédito (`balance`, `status`) e pontos de fidelidade (`kind = "loyalty"`) |

- Registro (`processReturn`, `src/domain/sales.ts:1334`): só de venda concluída e na mesma filial da venda (`:1346-1348`); `processing` só para reembolso por estorno no cartão com valor compensado (`:1453`); `return_items` gravados pela tarefa `return.effects` com `completedAt = returns.createdAt` (`:1557`); confirmação do estorno passa a `completed` (`confirmCardReversal`, `:1643-1653`).
- Venda a prazo: abate primeiro o saldo em aberto do título (baixa `kind = "abatement"`, sem lançamento em conta) e só compensa (vale/reembolso) o que já foi pago (`docs/regras-assumidas.md:222`); a quebra por pagamento separa abatido, absorvido por desconto e compensado (`reports.ts:601-615`).
- Troca: devolução (vale) + nova venda `origin = "exchange"` paga com o vale — as duas entram nos indicadores (a devolução abate a receita na data do movimento; a nova venda conta na receita, no nº de vendas e no ticket).
- Indicador oficial pela RBC-3. A listagem `/vendas/devolucoes` usa `returns.createdAt` e todos os status, somando `itemsTotal` (`vendas/queries.ts:203-206`; `src/app/(app)/vendas/devolucoes/page.tsx:25`, `:49-52`). Devolução de pedido on-line é outro fluxo, fora da RBC (`orders.ts:494-523`).

### 4.5 Estoque — `stock_balances`, `stock_movements`, valorização

| Coleção | Esquema | Campos |
|---|---|---|
| `stock_balances` | `schema.ts:335-344` | um saldo por depósito × SKU: `physical`, `reserved`, `inTransit`, `avgCost`, `minQty`, `maxQty`, `safetyQty`, `reorderMultiple`, `lastMovementAt`, `lots` |
| `stock_movements` | `schema.ts:347-357` | `type`, `qty` (com sinal), `balanceBefore/After`, `unitCost`, `totalCost`, `avgCostAfter`, `originType`, `originId`, `occurredAt`, `seq` |
| `warehouses` | `schema.ts:324-332` | `kind` (`available`, `damaged`, `consumption`), `purpose`, `status` |
| `stock_reservations` | `schema.ts:360-363` | reservas por origem (pré-venda, pedido on-line, transferência) |

- Tipos de movimento: `src/domain/stock.ts:17-64` (`sale` inclui PDV e pedido on-line; NF-e avulsa ou de pedido de venda sai como `manual_out` — `src/domain/fiscal/service.ts:1217-1219`; `cost_adjust` = só custo, `stock.ts:37-41`).
- Posição atual (`queryBalances`, `src/app/(app)/estoque/queries.ts:93-149`): disponível = físico − reservado; valor = `roundDiv(physical × avgCost, 1000)` — **saldo negativo gera valor negativo** (`:121`); abaixo do mínimo = `minQty` > 0 e disponível ≤ mínimo (`:122`); situações `below_min`, `zero`, `negative`, `transit`, `reserved`, `incoming`, `positive` (`:129-147`). Totais da tela: valor em estoque, físico (unidades mistas), reservado, em trânsito, abaixo do mínimo (`src/app/(app)/estoque/page.tsx:44`, `:62-66`). Filial: `filial=all` = filiais permitidas ao usuário (`estoque/queries.ts:16-41`).
- Valorização em data-base (`fiscalInventory`, `src/domain/inventory-fiscal.ts:142-200`): soma os movimentos com `occurredAt` < início do dia seguinte (fuso da instalação) e usa o `avgCostAfter` do último movimento; **saldo negativo não é valorizado** (`:195`); na data de hoje bate com o saldo atual (`:10-20`).
- Movimentos (`queryMovements`, `estoque/queries.ts:195-247`): período padrão de 31 dias por `occurredAt` (`:188-193`).
- O custo médio absorve frete e despesas da entrada (recebimento e CT-e: `receipts.freight`, `otherExpenses`, `cteFreight` — `schema.ts:793-817`).

### 4.6 Compras — `purchase_orders`, `receipts`

| Coleção | Esquema | Campos |
|---|---|---|
| `purchase_orders` | `schema.ts:736-749` | `status`, `subtotal`, `discountTotal`, `freight`, `otherExpenses`, `ipiTotal`, `insurance`, `total`, `receivedValue`, `expectedDate`, `approvedAt`, `sentAt`, `cancelledAt`, `transitAt`, `origin` |
| `purchase_order_items` | `schema.ts:752-758` | `qty`, `receivedQty`, `unitCost`, `total` |
| `purchase_requests` | `schema.ts:767-775` | aprovação: `status`, `decidedAt`, `total` |
| `receipts` | `schema.ts:793-817` | `status` (`draft`, `confirming`, `confirmed`, `cancelled`, `scheduled`), `invoicedTotal` (NF-e), `dueTotal` (devido), `freight`, `cteFreight`, `divergences`, `confirmedAt`, `documentStatus` (`pending_invoice`/`confirmed`), `entryAt`, `invoiceDueAt`, `entryKind` |

- Estados do pedido: `draft`, `in_review`, `adjust`, `approved`, `sent`, `partial`, `received`, `rejected`, `cancelled` (`src/domain/purchase-calc.ts:10-43`); do recebimento: `src/domain/receipts.ts:145`.
- Indicadores das telas (sem serviço único):
  - Pedidos (`src/app/(app)/compras/pedidos/page.tsx:46-53`, `:104`, `:125-128`): "Pedidos no mês" por `createdAt` (mês **UTC**; exclui cancelados); "Aguardando aprovação" (`in_review`); "A receber" = Σ valor restante de `approved`/`sent`/`partial`, com entregas em 7 dias e atrasadas; "Recebidos no mês" por **`updatedAt`** (UTC), com % no prazo.
  - Recebimentos (`src/app/(app)/compras/recebimentos/page.tsx:30-38`, `:60-64`): em conferência; "Entradas confirmadas no mês" por `confirmedAt` (mês UTC), Σ `dueTotal`; com divergência; faturado × devido; aguardando nota.
  - Aguardando nota (entrada com nota a confirmar): `src/app/(app)/compras/aguardando-nota/page.tsx:125-128` e alerta do painel (§1.3).
- Títulos a pagar gerados entram no financeiro (§4.7); compras de mercadoria ficam fora do resultado no DRE (`finance-reports.ts:32-37`, `:88`, `:94`).

### 4.7 Financeiro — títulos, baixas e fluxo de caixa

| Coleção | Esquema | Campos |
|---|---|---|
| `titles` | `schema.ts:634-647` | `kind` (`receivable`/`payable`), `status` (`open`, `partial`, `paid`, `cancelled`, `renegotiated`), `total`, `balance`, `issueDate`, `competenceDate`, `categoryId`, `costCenterId`, `originType`, `approvalStatus`, `provisional`, `forecast` |
| `installments` | `schema.ts:650-658` | `dueDate`, `amount`, `paid`, `interest`, `fine`, `discount`, `balance`, `status`, `methodKind`, `branchId` |
| `settlements` | `schema.ts:661-669` | `kind` (`settlement`, `abatement`), `status` (`active` = vigente), `date`, `principal`, `interest`, `fine`, `discount`, `fee`, `total` |
| `account_entries` | `schema.ts:595-603` | `date`, `amount` (com sinal), `kind` (`receipt`, `payment`, `fee`, `reversal`, `transfer_in/out`, `initial`…), `titleId`, `settlementId`, `originType`, `categoryId`, `reconciled` |
| `financial_accounts` | `schema.ts:584-592` | `balance` (saldo atual do extrato interno), `initialBalance`, `initialBalanceDate`, `active`, `kind`, `branchId` (nulo = compartilhada) |

- Contas a receber/pagar (`queryInstallments`, `src/app/(app)/financeiro/queries.ts:93-189`): uma linha por parcela; situações `overdue` (`dueDate < hoje`), `due_today`, `upcoming`, `open`, `partial`, `paid`, `cancelled`; padrão exclui canceladas (`:99-106`); recebido/pago sem abatimentos; abatido por devolução em coluna própria. Indicadores fixos (`installmentKpis`, `:191-221`; tela `src/app/(app)/financeiro/_components/titles-list.tsx:404-407`): total em aberto; recebido/pago no mês (baixas `kind = "settlement"` ativas desde o dia 1º, com encargos — `:206-210`); em atraso; próximos 7 dias (**inclui hoje**); a autorizar (a pagar).
- Fluxo de caixa (`computeCashflow`, `src/domain/cashflow.ts:188-343`): realizado = `account_entries` pela `date` (estorno reduz o lado do original; transferências à parte; saldo inicial não é movimento — `:34-39`); previsto = parcelas abertas pelo saldo e vencimento (vencidas só com `includeOverdue`, deslocadas para hoje), recebível de cartão líquido da taxa prevista (`:275-322`); saldo inicial posicionado a partir do saldo atual (`:208-216`); contas da filial + compartilhadas, **inclusive inativas** (`:194`). Tela: `src/app/(app)/financeiro/fluxo-caixa/page.tsx:43`, `:77-81`.
- Competência e DRE: §2.5.
- Fechamento de período (recurso `fechamentoPeriodo`, **desligado por padrão**): recusa gravação financeira datada até `finance.closedUntil` (`src/domain/period-close.ts:7-19`; `src/lib/core/settings.ts:61`). Não impede cancelar venda/NF-e de período fechado — os estornos são datados no dia do cancelamento.

### 4.8 Fiscal — `fiscal_documents` e situação de autorização

| Coleção | Esquema | Campos |
|---|---|---|
| `fiscal_documents` | `schema.ts:870-885` | `model` (`nfce`, `nfe`, `nfse`), `status`, `environment` (`simulacao`, `homologacao`, `producao` — `src/domain/fiscal/service.ts:983`), `isSimulated`, `operationType`, `purpose`, `originType`, `issuedAt`, `authorizedAt`, `cancelledAt`, `total`, `totals`, `items`, `contingency`, `attempts`, `lastAttemptAt`, `nextCheckAt`, `statusCode`, `statusMessage` |
| `fiscal_events` | `schema.ts:888-891` | `type` (`send`, `query`…), `status`, `occurredAt`, `message` |
| `fiscal_configs` | `schema.ts:836` | provedor, ambiente, `connectionStatus`, `lastTestAt`, `certificate.validTo` |

- Estados: `draft` → `queued` → `processing` → `authorized` | `rejected` | `denied` | `error`; `authorized` → `cancelled`; `pending` = aguardando cadastro/configuração; também `contingency`, `unused` (inutilizado), `discarded` (`src/domain/fiscal/service.ts:21-41`; rótulos `src/components/ui/badge.tsx:31-34`). Nenhum estado é presumido: autorizado só com retorno do provedor (`service.ts:23-25`).
- Relatórios fiscais (`src/domain/fiscal/reports.ts`, critérios `:7-16`):
  - documentos do período por **`issuedAt`**, exceto registros de inutilização (`periodDocuments` `:49-53`); filial = filtro ou contexto (`:40-46`); simulação **incluída por padrão** (`sim` ≠ `0`, `:33-37`);
  - faturamento fiscal = Σ notas autorizadas de saída, exceto devolução e não-receita (transferência, CFOP de remessa/retorno — `NON_REVENUE_CFOP` `:60`); em nota mista, só itens de venda (`:61-75`); devoluções recebidas = NF-e de entrada autorizada com finalidade devolução (`:77`); líquido = bruto − devoluções (`:129`); o valor do documento **inclui frete, seguro, outras despesas e ICMS-ST** (`service.ts:367-387`, `:466`);
  - pendentes = `draft`, `pending`, `queued`, `processing`, `rejected`, `error` **entre os emitidos no período** (`:26`, `:121`, `:138`);
  - cancelamentos por `cancelledAt` (`:303-310`); rejeições por evento `send`/`query` rejeitado/denegado no período (`:312-334`).
- Painel: §1.3 (autorizados por `authorizedAt`, sem simulação; pendências pelo estado atual).
- Venda: `sales.fiscalStatus` espelha o documento (pendências da listagem de vendas: `src/app/(app)/vendas/page.tsx:54`).
- Rotina `fiscal.stuck`: `processing`/`queued` sem atualização há 30 min são reenfileirados para consulta/transmissão (`src/domain/routines/fiscal.ts:54-65`).

---

## 5. Sinais de adoção e operação

### 5.1 Última atividade

| Sinal | Fonte | Regra / confiabilidade |
|---|---|---|
| Última ação por empresa, filial e usuário | `audit_logs` (`schema.ts:956-963`; índice `companyId + occurredAt`) gravado por `audit()` (`src/lib/core/audit.ts:35-61`) | Registra operações: venda (`sale.complete`, `src/domain/sales.ts:704`), cancelamento, caixa (`cash.ts:119`, `:558`), exportação, parâmetros, login… **Não registra navegação/leitura.** Gravação "melhor esforço": falha só vai ao log do servidor (`audit.ts:57-60`). A tela de histórico lê no máximo 50 000 por consulta (`src/app/(app)/administracao/historico/queries.ts:48`) |
| Login (sucesso, falha, 2ª etapa) | `audit_logs` com `entityType = "login"` (`src/domain/two-factor.ts:48-56`) | `companyId` = **primeira empresa** do usuário (`:52`), não a empresa em que entrou; ações `auth.login`, `auth.login_failed`, `auth.password_ok` |
| Último acesso do usuário | `users.lastAccessAt` / `firstAccessAt` (`schema.ts:94-111`) | Atualizado **só no login** (`src/app/actions/session.ts:111-115`); campo global (usuário pode ter várias empresas); não mede uso contínuo |
| Sessões | `sessions` (`schema.ts:127-131`; efêmera, fora do backup) | Só no provedor de autenticação próprio (`src/lib/auth/provider.ts:6-12`, `:63-64`): `createdAt` = login, `expiresAt` (1 ou 30 dias); sem empresa, sem último uso; `userAgent`/`ip` não são preenchidos; apagada no logout |
| Última unidade usada | `user_prefs` chave `lastUnit` (`session.ts:117`) | "empresa:filial" lembrada; sem data de uso |
| Atividade operacional | `sales.completedAt` (índice `branchId + completedAt`, `schema.ts:462`), `cash_sessions.openedAt/closedAt`, `stock_movements.occurredAt` (índice `branchId + occurredAt`, `:357`), `stock_balances.lastMovementAt` (`:339`), `fiscal_documents.issuedAt`, `account_entries.date`, `online_orders.createdAt` | Fontes primárias do uso real por filial; terminal não tem atividade própria (§4.2) |
| Sinal diário do banco | `settings` da plataforma, chave `keepalive` `{at, count}` (`src/app/api/keepalive/route.ts:7-27`) | Nível instalação, não empresa |

### 5.2 Usuários ativos

- `userStats(store, companyId)` (`src/domain/users.ts:598-610`): total, ativos (`status = "active"`), convites pendentes/expirados, suspensos, inativos, administradores, "nunca acessaram" (ativos sem `lastAccessAt`). Base = `companyUsers` (`:83-86`): usuários com a empresa em `companyIds` **mais todos os administradores da instalação**; exclui vendedores sem acesso (`isSellerOnly`, `:76`).
- Situações: `active`, `invited` (pendente/expirado por `inviteExpiresAt` — `:70-73`), `inactive`, `suspended` (`src/components/ui/badge.tsx:55`).
- "Usuário ativo no período" não existe como indicador. Deriváveis: `audit_logs.userId` distintos com `occurredAt` no período (excluindo `userId = "system"` das tarefas — `src/lib/core/ctx.ts:58-65`); `sales.operatorId` distintos (PDV).

### 5.3 Pendências de integração e de operação

| Pendência | Fonte | Regra |
|---|---|---|
| Monitor do comércio digital | `commerce_events` via `monitorCounts` (`src/domain/ecommerce/monitor.ts:26-30`) | Contagens `failed`/`pending`/`ok`/`ignored` sobre **até 5000 eventos lidos sem ordenação** (os mais antigos, §0.5) (`:19`); exige loja criada (`requireStore`, `src/domain/ecommerce/common.ts:100-104`); reprocessar/ignorar em `monitor.ts:43-120` |
| Pedidos on-line parados | `online_orders` | `paid` = a faturar; `invoiced`/`ready_for_pickup` = a expedir; `return_requested`; `payment.status = "error"`; `refundStatus = "pending"` (`monitor.ts:87-97`) |
| Recebimentos do gateway | `gateway_transactions.status` | `awaiting_credit` vencido, `credited` não conciliado, `divergent` (`bank.ts:18-27`) |
| Cobranças Pix/cartão | `payment_intents` (`schema.ts:529-537`) | `status`, `errorMessage`, `isSimulated`, `refundRequestedAt`/`refundedAt` |
| Extratos não conciliados | `bank_transactions` (`schema.ts:687-696`) | `status`, `reconciliationId` |
| Documentos fiscais pendentes | `fiscal_documents.status` | Painel: `FISCAL_BUCKETS` (§1.3); relatório fiscal: `PENDING_STATES` (§4.8); parados > 30 min: `fiscal.stuck` |
| Tarefas duráveis com falha | `jobs` (`schema.ts:932-938`) | `pending` → `running` → `done` \| `retry` (recuo exponencial) \| `dead` (esgotou `maxAttempts`, padrão 8) (`src/lib/core/jobs.ts:77-151`); `lastError`, `attempts`, `finishedAt`, `companyId` (pode ser nulo); travada = `running` com `lockedUntil` vencido (`:153-156`); ao morrer gera notificação `integration_failure` (`:133-149`). Tipos registrados: `sale.effects`, `sale.cancel.effects`, `return.effects`, `fiscal.transmit`, `fiscal.query`, `fiscal.cancel`, `fiscal.email`, `finance.account.rebuild`, `admin.backup.scheduled`, `admin.restore.run` |
| Pendências da Central de integrações | `integrationJobs` (`src/domain/integrations.ts:688-702`) | Só tarefas cujo tipo casa com o prefixo da integração (`:672-685`); entre os tipos registrados, **só os `fiscal.*` têm prefixo** — `sale.effects`, `return.effects`, `finance.account.rebuild` e backup não aparecem em nenhuma integração. Contador da tela = `retry` + `dead` (`src/app/(app)/administracao/integracoes/queries.ts:58`) |
| Integrações em erro | `integrations.status` (`not_configured`, `configured_untested`, `operational`, `simulated`, `unavailable`, `error` — `integrations.ts:259-266`), `lastTestAt`, `lastRunAt`, `lastRunStatus` (`:448-465`); fiscal em `fiscal_configs` (`measuredStatus`, `src/domain/fiscal/service.ts:119-123`) | A tela resolve por filial do contexto (registro da filial ou da empresa) e consulta variáveis de ambiente para credenciais ausentes (`integracoes/queries.ts:52-80`; `integrations.ts:472-479`) — parte do estado **não está no banco** |
| Execuções de integração | `integration_logs` (`schema.ts:920-923`) | `status` `success`/`failure`/`info`, `occurredAt`; resumo de 30 dias limitado a 5000 (`integrations.ts:742-754`) |
| Rotinas diárias | `settings` `routine.<chave>.lastRun` (`src/domain/scheduler.ts:26-31`) | Só o **sucesso** é gravado (data local); a falha vai apenas na resposta HTTP de `/api/jobs` (`scheduler.ts:32-34`; `src/app/api/jobs/route.ts:18-20`) — **não persistida**. Cron diário às 08:47 UTC (`vercel.json`). Rotinas: `accounting.certificates`, `admin.backup`, `admin.roles`, `ecommerce.expire`, `finance.delinquency`, `finance.due`, `fiscal.accountingExport`, `fiscal.certificate`, `fiscal.obligations`, `fiscal.stuck`, `network.billing`, `network.renewals`, `purchases.followup`, `purchases.pending_invoice`, `sales.documents_expire`, `sales.presale_reservations`, `stock.inventories_stale`, `stock.lot_expiry`, `stock.transfers_overdue` |
| Ocorrências notificadas | `notifications` (`schema.ts:946-953`) | Uma linha **por usuário destinatário**; situação (`occurrenceKey`, `occurrenceStatus` aberta/resolvida/informativa) vem da origem (`src/domain/notifications.ts:9-13`; tipos `:15-27`) — contar por `occurrenceKey` distinta |
| Backups | `backups.status` (`schema.ts:984-990`) | `running`, `completed`, `failed`, `verified`, `expired` (`badge.tsx:57`) |
| Certificados | `fiscal_configs.certificate.validTo` | ≤ 30 dias (painel e rotina `fiscal.certificate`, `src/domain/routines/fiscal.ts:24-47`) |
| Eventos de webhook | `webhook_events` (`schema.ts:926-929`) | Coleção definida e **não usada** no código |

---

## 6. Lacunas e cuidados

### 6.1 Lacunas (sem fonte oficial ou sem fonte confiável)

1. **Receita omnicanal.** Nenhum indicador soma PDV + pedidos on-line + NF-e de pedido de venda/avulsa. A base comercial só conhece `sales` do PDV (RBC-8); o e-commerce só tem "Pedidos hoje" (dia UTC, com frete, inclui não pagos) e a visão do banco sem período (§4.3); NF-e de pedido de venda gera estoque `manual_out` e título `fiscal_document` (`src/domain/fiscal/service.ts:1217-1219`, `:1234-1248`; `src/domain/sales-documents.ts:32`).
2. **Histórico fechado.** Não há fechamento/snapshot comercial: cancelar depois uma venda a retira do período original (filtro por `completedAt` + status atual — `reports.ts:203-205`; `sales.ts:984`); idem NF-e autorizada e depois cancelada no "Resumo fiscal" (`dashboard/queries.ts:137`). O fechamento financeiro é opcional e desligado por padrão (§4.7).
3. **Uso por usuário e por empresa.** Só existe o último login, global (`session.ts:115`); sessões não têm empresa nem último uso (`schema.ts:127-131`); navegação não é auditada; login é atribuído à primeira empresa do usuário (`two-factor.ts:52`).
4. **Falha de rotina.** Não é gravada; só o último sucesso por empresa (`scheduler.ts:26-34`).
5. **Terminal ativo / heartbeat.** Inexistente (`schema.ts:146-153`); só por derivação.
6. **Série de estoque valorizado, giro e cobertura consolidados.** Só reconstrução sob demanda em data-base (`inventory-fiscal.ts:142-200`) e o cálculo de reposição por filial (`src/domain/replenishment.ts:115`); não há indicador de giro.
7. **Taxa de inadimplência, conversão da loja, recompra.** Sem indicador oficial; insumos: aging (§2.5), carrinhos ociosos (`src/domain/ecommerce/promotions.ts:123-143`), compradores em 90 dias da carteira (`src/app/(app)/clientes/queries.ts:66-81`).
8. **Agregação entre empresas.** Todas as funções recebem uma empresa; o único laço por todas as empresas é o agendador (`scheduler.ts:21-24`). Leitura de outra empresa só existe para o escritório contábil vinculado (`src/domain/accounting/link.ts:136-140`; `ReadOnlyStore` `src/lib/db/read-only.ts:4-8`) — e o resumo fiscal desse vínculo filtra `fiscal_documents.issueDate`, campo inexistente no esquema (`link.ts:161`, `:171`; o esquema tem `issuedAt` — `schema.ts:870-885`), logo devolve zero documentos (§0.5).
9. **API por token.** Não há rota de dados para sistema externo: `/api/export/[key]` exige sessão de usuário com contexto completo e `data.export` (`src/app/api/export/[key]/route.ts:13-19`; `src/lib/server/session.ts:104-111`); `/api/jobs` e `/api/keepalive` só com `CRON_SECRET`.
10. **Marketplaces.** Apenas planejados (`src/domain/ecommerce/channels.ts:10-14`); `webhook_events` sem uso.

### 6.2 Cuidados

#### 6.2.1 Totais calculados no navegador

Nenhum indicador oficial é calculado no navegador: as telas são componentes de servidor e a tabela só exibe totais prontos (`src/components/ui/data-table.tsx:128-133`). Cálculos no cliente, só de exibição ou prévia:
- gráfico de receita: converte centavos em reais (ponto flutuante) e soma total/máximo dos pontos (`src/components/charts/revenue-chart.tsx:45-47`);
- tooltip dos gráficos fiscais (`src/app/(app)/fiscal/relatorios/charts.tsx:13`);
- total dos itens selecionados na reposição (`src/app/(app)/compras/reposicao/replenishment-table.tsx:108`);
- prévia das diferenças no fechamento de caixa (`src/app/(app)/caixa/fechamento/closing-form.tsx:43-45`) — o servidor recalcula ao fechar (`src/domain/cash.ts:477-560`);
- carrinho do PDV — o servidor recalcula a venda (`prepareSale`, `src/domain/sales.ts:112-126`).

#### 6.2.2 Limites de listagem

| Consulta | Limite | Onde | Efeito |
|---|---|---|---|
| `listAll` (padrão) | 100 000 registros | `src/lib/db/index.ts:99-110` | corte silencioso; base de `loadFacts`, do painel e de quase todas as telas |
| Período das telas de análise | 400 dias | `src/domain/reports.ts:47`, `:97` | período maior volta ao padrão, com mensagem |
| Histórico/auditoria | 50 000 | `src/app/(app)/administracao/historico/queries.ts:48` | mantém os mais recentes (ordem desc) |
| Monitor do comércio digital | 5 000 eventos; lista 300 | `src/domain/ecommerce/monitor.ts:19`, `:23`, `:27` | leitura sem ordenação: mantém os mais antigos; contagens sobre eles |
| Pedidos on-line (Central/Pedidos) | 5 000; lista 300 | `src/app/(app)/comercio-digital/page.tsx:80`; `pedidos/page.tsx:29`, `:31` | idem |
| Expedição · pagamentos · expiração de pedidos | 2 000 | `comercio-digital/expedicao/page.tsx:27`; `pagamentos/page.tsx:40`; `src/domain/ecommerce/orders.ts:331` | idem |
| Transações do gateway | 5 000 | `src/domain/ecommerce/bank.ts:31`, `:41` | idem |
| Tarefas por integração | 500 (por `runAt` desc) | `src/domain/integrations.ts:689` | |
| Execuções de integração (30 dias) | 5 000 | `src/domain/integrations.ts:744` | |
| Documentos fiscais parados | 500 | `src/domain/routines/fiscal.ts:56` | |
| Últimas vendas · alertas · itens de estoque crítico | 8 · 8 · 7 | `src/app/(app)/dashboard/queries.ts:12`; `page.tsx:408`, `:573` | só exibição; contagens completas |
| Paginação das telas | 5–200 por página (padrão 25; 50 na ABC e no detalhe da filial) | `src/lib/list.ts:25`, `:37-54` | carrega tudo e fatia em memória |

#### 6.2.3 Cortes por UTC (não pelo fuso da instalação)

| Tela / regra | Onde | Campo |
|---|---|---|
| "Pedidos hoje" (comércio digital) | `src/app/(app)/comercio-digital/page.tsx:91-92` | `online_orders.createdAt` × `new Date().toISOString()` |
| Competência do recebível do pedido on-line | `src/domain/ecommerce/orders.ts:173`, `:197` | data UTC do pagamento |
| "Pedidos no mês", "Recebidos no mês", % no prazo | `src/app/(app)/compras/pedidos/page.tsx:49`, `:53`, `:104` | `createdAt`, `updatedAt` |
| "Entradas confirmadas no mês" | `src/app/(app)/compras/recebimentos/page.tsx:33` | `confirmedAt` |
| "Aprovadas no mês" | `src/app/(app)/compras/aprovacoes/page.tsx:30`, `:72` | `decidedAt` e mês UTC |
| Indicadores de fornecedor | `src/app/(app)/fornecedores/queries.ts:54`, `:96-97` | `confirmedAt`, `createdAt` |
| Clientes: vendas e ticket de 30 dias, compradores de 90 dias | `src/app/(app)/clientes/queries.ts:68-72` | janela corrida em milissegundos, não dias de calendário |

Entre 21h e 24h (horário de Brasília) esses cortes já contam o dia/mês seguinte.

#### 6.2.4 Consistência eventual e retroatividade

- Venda concluída pode ficar sem parte dos itens até a tarefa `sale.effects` gravá-los (`sales.ts:502-505`, `:788-811`): a transação grava pelo menos um item (orçamento de 95 operações — `sales.ts:94`, `:434-437`), então a venda já conta, mas receita, custo e quantidade sobem depois.
- Devolução com efeitos pendentes já entra pelas linhas do documento (RBC-3) — sem defasagem.
- Cancelamento de venda e de NF-e altera períodos passados (§6.1, item 2).
- Aging com `ref` no passado usa saldos atuais (`finance-reports.ts:280-284`).
- Pedido on-line muda de situação sem gerar venda; as contagens por status são instantâneas.

#### 6.2.5 Diferenças entre telas (mesmo nome, regras diferentes)

| # | Indicador | Regra do painel/gerenciais | Outra tela | Diferença |
|---|---|---|---|---|
| 1 | Faturamento | RBC (`reports.ts:337-366`) | Histórico de vendas — "Faturamento líquido" (`vendas/queries.ts:108`, `:132-149`; `vendas/page.tsx:95`) | Σ (`total` − `returnedTotal`) das vendas concluídas no período: devolução atribuída à venda original, acumulada até hoje, não ao dia em que ocorreu |
| 2 | Faturamento | RBC | Clientes — vendas de 30 dias (`clientes/queries.ts:66-81`) | só vendas com cliente; janela corrida; mesma atribuição de devolução da linha 1 |
| 3 | Faturamento | RBC | Faturamento fiscal (`fiscal/reports.ts:68-75`, `:79-140`) | notas autorizadas de saída por `issuedAt`; inclui pedidos on-line, NF-e de pedido/avulsa, frete, seguro, ICMS-ST; exclui venda sem documento; simulação incluída por padrão |
| 4 | Receita | RBC | DRE (`finance-reports.ts:85-96`) | base financeira (títulos pela competência + lançamentos): sem valores pagos com vale-crédito/pontos (`sales.ts:654-670`); pedido on-line e NF-e sem categoria vão para "Outras receitas" |
| 5 | Ticket médio | `roundDiv(netRevenue, salesCount)` | Histórico de vendas (`vendas/page.tsx:95`) | `Math.round(Σ total ÷ nº)` — antes das devoluções |
| 6 | Ticket médio | idem | Clientes `ticket30` (`clientes/queries.ts:77`) | `Math.round`, só vendas com cliente, 30 dias corridos |
| 7 | Devoluções | `return_items` na data do movimento; `completed`/`processing` | `/vendas/devolucoes` (`vendas/queries.ts:203-206`; `devolucoes/page.tsx:25`, `:49`) | `returns.createdAt`, todos os status, Σ `itemsTotal` |
| 8 | Devoluções | idem | Histórico de vendas — "Devolvido" (`vendas/page.tsx:96`) | Σ `returnedTotal` das vendas do período (data da venda) |
| 9 | Canceladas | `completedAt` no período, status atual (`reports.ts:205`) | Comissões (`src/domain/commissions.ts:375`) | pela data do cancelamento (`cancelledAt`) |
| 10 | Pendências fiscais | `FISCAL_BUCKETS`, estado atual, todos os períodos (`dashboard/queries.ts:122-126`, `:139`) | Relatórios fiscais (`fiscal/reports.ts:26`, `:121`) | `draft`, `pending`, `queued`, `processing`, `rejected`, `error` (sem `contingency`/`denied`), só emitidos no período |
| 11 | Pendências fiscais | idem | Histórico de vendas — "Documentos pendentes" (`vendas/page.tsx:54`) | `sales.fiscalStatus` ∈ {`pending`, `queued`, `processing`, `error`, `rejected`, `contingency`} das vendas do período |
| 12 | Pendências fiscais | idem | Painel do escritório contábil (`link.ts:170-179`) | `pending`, `queued`, `processing`, `contingency` por mês — sempre vazio (§6.1, item 8) |
| 13 | Autorizadas | `authorizedAt` no período, sem simulação (`dashboard/queries.ts:137`, `:147`) | Relatórios fiscais (`fiscal/reports.ts:37`, `:49-53`) | `issuedAt` no período, simulação incluída por padrão |
| 14 | A pagar — 7 dias | vencimento > hoje e ≤ hoje + 7 (`dashboard/queries.ts:116`) | Contas a pagar — "Próximos 7 dias" (`titles-list.tsx:407`; `financeiro/queries.ts:198-199`) | inclui o dia de hoje |
| 15 | Saldo disponível | contas ativas (`dashboard/queries.ts:106-108`) | Fluxo de caixa — "Saldo disponível hoje" (`fluxo-caixa/page.tsx:43`, `:77`; `cashflow.ts:194`) | inclui contas inativas |
| 16 | Títulos sem filial | só no consolidado (`dashboard/queries.ts:101`) | Aging (`finance-reports.ts:289`) · DRE (`:114-116`) | aging: fora sempre que há lista de filiais, dentro quando o recorte cobre a empresa (`financeiros/params.ts:29-33`); DRE: dentro com várias filiais, fora com filial única |
| 17 | Vencidos | parcelas `open`/`partial` (`dashboard/queries.ts:102-103`) | Aging | só saldo > 0 de título não cancelado (`finance-reports.ts:289`, `:299`) |
| 18 | Valor do estoque | `/estoque`: negativo vira valor negativo (`estoque/queries.ts:121`) | Inventário em data-base (`inventory-fiscal.ts:195`) | negativo não é valorizado |
| 19 | Classe ABC | Curva ABC (§3) | Reposição (`src/domain/replenishment.ts:142-166`) | devoluções sem filtro de status e sem linhas pendentes; período [hoje − N, hoje) sem o dia corrente; desempate pelo id do SKU; mesmos limites |
| 20 | Vendas por meio | `paymentBreakdown` não filtra `sale_payments.status` (`reports.ts:575-589`) | Resumo do caixa (`cash.ts:261`) | ignora `cancelled`/`failed` |

#### 6.2.6 Escopo, permissões e ocultação

- Listagens seguem a filial do contexto (§0.3); contas compartilhadas sempre entram no saldo; parcelas sem filial só no consolidado (painel).
- Custo e margem só com permissão `reports` (`dashboard/page.tsx:66-67`); metas da empresa só com acesso a todas as filiais (`goals.ts:226-229`).
- Conferência cega oculta valores de sessões abertas (§4.2).
- `companyUsers` inclui administradores globais (§5.2).

#### 6.2.7 Simulação, homologação e demonstração

- `isSimulated`: o painel exclui dos autorizados e mostra à parte (`dashboard/queries.ts:147-150`); os relatórios fiscais incluem por padrão (`fiscal/reports.ts:37`); o escritório contábil conta à parte (`link.ts:178`).
- `environment = "homologacao"` (provedor real em ambiente de testes) não é filtrado em nenhum indicador: documento de homologação autorizado conta como autorizado (`fiscal/service.ts:983`; `dashboard/queries.ts:137`).
- Demonstração: campo `isDemo` em quase todos os registros e nas empresas (`schema.ts:67`, `:76`) — nenhum indicador o filtra.

#### 6.2.8 Efeitos colaterais ao ler

- Abrir a Central do comércio digital expira pedidos pendentes vencidos (`comercio-digital/page.tsx:74`); a rotina `ecommerce.expire` faz o mesmo diariamente.

#### 6.2.9 Desempenho

- `loadFacts` carrega todas as linhas do recorte em memória; o painel e os gerenciais carregam dois recortes (atual e anterior — `reports.ts:463`, `:513-518`); a curva ABC carrega todos os produtos e SKUs da empresa (`abc.ts:155-159`); `nameMaps` lê todos os usuários da instalação (`reports.ts:404`).

---

## 7. Anexo — funções reutilizáveis e suas dependências

| Função | Onde | Recebe | Observação |
|---|---|---|---|
| `loadFacts`, `totalsOf`, `groupTotals`, `reportTotals`, `commercialOverview`, `managerialReport`, `paymentBreakdown`, `branchOperations`, `revenueSeries`, `skuRows`, `firstMovementDate`, `variationBps`, `resolvePeriod`, `previousPeriod` | `src/domain/reports.ts:87-720` | `Store` + `ReportScope` (`companyId`, `branchIds`, `from`, `to`) | Não dependem de usuário; `totalsOf`/`variationBps`/`revenueSeries` são puras |
| `abcReport`, `abcProductLines`, `classifyAbc`, `getAbcLimits`, `parseLimits` | `src/domain/abc.ts:36-191` | `Store` + escopo + limites | `classifyAbc` pura |
| `goalsProgress`, `goalsScreen` | `src/domain/goals.ts:219`, `:286` | `Ctx` | Usa `ctx.user` para restringir metas (`:226-229`) |
| `computeDre`, `computeAging` | `src/domain/finance-reports.ts:113`, `:285` | `Ctx` | Usam `ctx.store` e `ctx.companyId` |
| `computeCashflow`, `competenceItems`, `computeCompetence` | `src/domain/cashflow.ts:188`, `:399`, `:464` | `Ctx` + filtro | |
| `latestSales`, `openCashSessions`, `certificateAlerts`, `stockAlerts`, `financeSnapshot`, `fiscalSnapshot` | `src/app/(app)/dashboard/queries.ts:12-155` | `Ctx` + `branchIds` | Arquivo da camada de telas (`server-only`) |
| `periodDocuments`, `summarize`, `cancellations`, `rejections` | `src/domain/fiscal/reports.ts:49`, `:79`, `:303`, `:312` | `Ctx` + filtro | Filial padrão = contexto (`:42`) |
| `querySales`, `salesTotals`, `queryReturns` | `src/app/(app)/vendas/queries.ts:40`, `:132`, `:203` | `Ctx` + filtros de URL | Filial do contexto |
| `querySessions`, `sessionSummary`, `expectedVisible` | `src/app/(app)/caixa/queries.ts:18`; `src/domain/cash.ts:249`, `:72` | `Ctx` | Usuário define a ocultação |
| `queryBalances`, `queryMovements` | `src/app/(app)/estoque/queries.ts:93`, `:195` | `Ctx` | `ctx.user.branchIds` restringe filiais |
| `fiscalInventory` | `src/domain/inventory-fiscal.ts:142` | `Store` + `companyId` | |
| `queryInstallments`, `installmentKpis` | `src/app/(app)/financeiro/queries.ts:93`, `:191` | `Ctx` | |
| `monitorEvents`, `monitorCounts`, `bankOverview`, `gatewayTransactions` | `src/domain/ecommerce/monitor.ts:17`, `:26`; `bank.ts:29`, `:39` | `Ctx` | Exigem loja criada |
| `userStats`, `companyUsers` | `src/domain/users.ts:598`, `:83` | `Store` + `companyId` | |
| `integrationJobs`, `usageSummary`, `integrationLogs` | `src/domain/integrations.ts:688`, `:742`, `:736` | `Ctx` | |
| Exportações (`defineExport`) | `src/lib/exporters.ts:17-29`; `src/exports/*` | `SessionInfo` + parâmetros de URL | `resolveReportParams` também exige `SessionInfo` (`relatorios/params.ts:24`) |
| `systemCtx` | `src/lib/core/ctx.ts:58-65` | `Store` + `companyId` (+ filial) | Contexto "Sistema" (administrador, sem restrição de filial) usado por tarefas e rotinas |
