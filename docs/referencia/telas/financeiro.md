# Telas do PDF — financeiro

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

### Tela 22 — Contas a receber (p. 28)

Grupo: Financeiro

**Objetivo:** Acompanha os valores devidos pelos clientes e permite consultar vencimentos e registrar recebimentos vinculados aos títulos existentes.

**Principais ações (comentário)**
- Filtrar títulos vencidos, a vencer e recebidos.
- Consultar dados e valores do recebimento.
- Registrar a baixa e acompanhar o saldo.

**Ponto de atenção**
- Prever recebimentos parciais, descontos e acréscimos com rastreabilidade. A baixa não pode gerar entrada duplicada ao conciliar a mesma operação no banco.

**Regiões da tela**
- Barra superior global (azul-marinho): logo 'I', 'Intercert ERP' + subtítulo 'Contas a receber e crediário', contexto 'Loja Modelo — Matriz', avatar 'HB'
- Cabeçalho: título 'Contas a receber' + subtítulo 'Acompanhe parcelas, vencimentos, recebimentos e negociações do crediário.'; botões 'Relatório' e '+ Novo lançamento' à direita
- Faixa de 4 cartões de indicadores
- Painel de listagem: linha de busca + filtros (status, forma, data, Filtros), linha de chips de situação, tabela com seleção múltipla, rodapé com 'Exibindo 5 títulos' e 'Página 1 de 26'

**Campos observados**
- Busca (texto com lupa; placeholder 'Buscar cliente, documento ou venda')
- Status (select; valor 'Todos os status')
- Forma de pagamento (select; valor 'Todas as formas')
- Data de referência (date picker; valor '09/21/2026')
- Seleção de título (checkbox por linha)
- Selecionar todos (checkbox no cabeçalho da tabela)
- Nome do cliente
- CPF/CNPJ do cliente (prefixado 'CPF' ou 'CNPJ')
- Número do documento (CR-xxxxx crediário / BOL-xxxxx boleto)
- Origem (Venda #xxxxx ou NF-e xxxxxxx)
- Parcela (n/total)
- Data de vencimento (DD/MM/AAAA)
- Situação relativa do vencimento ('Vence hoje', 'N dias em atraso', 'Em N dias', 'Pago em DD/MM')
- Valor (R$)
- Saldo (R$, com encargos quando atrasado)
- Status (selo)

**Botões e ações observados**
- Botão 'Relatório' (ícone documento)
- Botão laranja '+ Novo lançamento'
- Dropdown 'Todos os status'
- Dropdown 'Todas as formas'
- Seletor de data (ícone calendário)
- Botão 'Filtros' (ícone controles)
- Chips de situação: Todos (ativo), Vencem hoje, Em atraso, Próximos vencimentos, Recebidos
- Ação 'Receber' (ícone $ em círculo) – títulos vence hoje / em atraso / em aberto
- Ação 'Visualizar' (ícone olho) – visível em título 'Vence hoje' e 'Recebido'
- Ação 'Negociar/renegociar' (ícone aperto de mãos) – títulos em atraso
- Ação 'Enviar cobrança/boleto' (ícone avião de papel) – título em aberto (boleto)
- Ação 'Imprimir' (ícone impressora) – título recebido
- Ação 'Mais opções' (ícone …) – títulos não recebidos
- Checkbox de seleção por linha e checkbox geral (ações em lote)
- Avatar 'HB'

**Abas / etapas**
- Todos (ativo)
- Vencem hoje
- Em atraso
- Próximos vencimentos
- Recebidos

**Colunas de tabelas**
- Títulos a receber: [Seleção] (checkbox)
- Títulos a receber: Cliente (nome + CPF/CNPJ)
- Títulos a receber: Documento / origem (CR-xxxxx ou BOL-xxxxx + 'Venda #xxxxx' ou 'NF-e xxxxxxx')
- Títulos a receber: Parcela (n/total)
- Títulos a receber: Vencimento (data + situação relativa)
- Títulos a receber: Valor
- Títulos a receber: Saldo
- Títulos a receber: Status
- Títulos a receber: Ações
- Dados de exemplo: Mariana Oliveira CPF 123.456.789-00 | CR-00841 Venda #10478 | 2/3 | 21/09/2026 Vence hoje | R$ 289,90 | R$ 289,90 | Vence hoje
- Dados de exemplo: João Carlos de Lima CPF 987.654.321-00 | CR-00812 Venda #10391 | 3/4 | 12/09/2026 9 dias em atraso | R$ 198,50 | R$ 204,45 | Em atraso
- Dados de exemplo: Mercadinho São Lucas CNPJ 12.345.678/0001-90 | BOL-00920 NF-e 0000212 | 1/2 | 25/09/2026 Em 4 dias | R$ 740,00 | R$ 740,00 | Em aberto
- Dados de exemplo: Ana Paula Vieira CPF 741.852.963-00 | CR-00789 Venda #9987 | 4/4 | 05/09/2026 16 dias em atraso | R$ 89,90 | R$ 94,15 | Em atraso
- Dados de exemplo: Construtora Cariri Ltda. CNPJ 46.912.332/0001-08 | BOL-00883 NF-e 0000201 | 1/1 | 18/09/2026 Pago em 18/09 | R$ 2.840,00 | R$ 0,00 | Recebido

**Filtros**
- Busca por cliente, documento ou venda
- Status (select: 'Todos os status')
- Forma de pagamento (select: 'Todas as formas')
- Data de referência (09/21/2026)
- Filtros (painel adicional)
- Chips de situação (Todos / Vencem hoje / Em atraso / Próximos vencimentos / Recebidos)

**Indicadores / cartões / gráficos**
- Total a receber (R$ 48.720, azul; '126 títulos em aberto')
- Recebido neste mês (R$ 31.845, verde; '82 títulos liquidados')
- Em atraso (R$ 7.380, vermelho; '19 títulos • 8 clientes')
- Vence nos próximos 7 dias (R$ 12.490, preto; '34 títulos programados')
- Rodapé 'Exibindo 5 títulos' e 'Página 1 de 26'

**Estados e selos**
- Selo 'Vence hoje' (laranja)
- Selo 'Em atraso' (vermelho)
- Selo 'Em aberto' (azul)
- Selo 'Recebido' (verde)
- Data de vencimento em laranja (vence hoje) e vermelho (atrasado)
- Saldo em vermelho quando acrescido de encargos
- Chip ativo 'Todos' em azul-marinho

**Regras e políticas ilustradas (exemplos)**
- Saldo de título em atraso inclui encargos (R$ 198,50 → R$ 204,45 após 9 dias ≈ 0,333%/dia; R$ 89,90 → R$ 94,15 após 16 dias)
- Título recebido fica com saldo R$ 0,00 e mostra data de pagamento ('Pago em 18/09')
- Ações disponíveis variam conforme o status (receber, negociar, enviar cobrança, imprimir)
- Origem do título: crediário (CR-xxxxx vinculado a Venda #) ou boleto (BOL-xxxxx vinculado a NF-e, para PJ)
- Títulos parcelados identificados por parcela n/total (2/3, 3/4, 1/2, 4/4, 1/1)
- Situação relativa calculada a partir da data atual (21/09/2026): vence hoje, X dias em atraso, em X dias
- Em atraso agregado por títulos e por clientes (19 títulos • 8 clientes)
- Boleto de compra parcelada divide o valor da venda: Mercadinho última compra R$ 1.480,00 (Tela 20) → parcela 1/2 R$ 740,00
- Boleto à vista 1/1 igual à compra: Construtora Cariri compra 12/09 R$ 2.840,00 → BOL-00883 R$ 2.840,00 pago em 18/09
- Seleção múltipla para ações em lote

**Inconsistências do protótipo**
- Encargos por atraso não seguem regra uniforme: +3,0% em 9 dias (198,50 → 204,45) e +4,7% em 16 dias (89,90 → 94,15); com a mesma taxa diária de 9 dias o segundo seria ≈ R$ 94,69
- Filtro de data em formato MM/DD/AAAA (09/21/2026) enquanto a tabela usa DD/MM/AAAA
- Venda #10391 (João Carlos) tem parcela 3/4 vencida em 12/09/2026, mas a Tela 17 registra essa venda em 17/09 (parcela vencida antes da venda)
- Venda #10478 (Mariana) tem parcela 2/3 vencendo em 21/09, enquanto a última compra dela é 20/09 (Tela 20)
- Ana Paula Vieira: parcela 4/4 de R$ 89,90 implica venda ≥ R$ 359,60, acima do 'Total comprado' de R$ 327,60 da Tela 20; e vence 7 meses após a última compra (05/02/2026)
- Ação 'Visualizar' (olho) ausente nas linhas de João Carlos, Mercadinho e Ana Paula, presente apenas em Mariana e Construtora — conjunto de ações inconsistente
- 'Página 1 de 26' (≈130 títulos a 5 por página) corresponde aos 126 em aberto, mas o chip 'Todos' inclui recebidos (+82 liquidados no mês)
- Chip 'Próximos vencimentos' sem horizonte definido, enquanto o KPI usa 'próximos 7 dias'
- Chip 'Todos' e select 'Todos os status' filtram a mesma dimensão (redundância)
- Checkboxes de seleção sem barra de ações em lote visível

### Tela 22 — Recebimento de um título (p. 29)

_Visão complementar: Contas a receber: recebimento de um título (modal 'Receber título')_

Grupo: Financeiro

**Objetivo:** O formulário detalha os valores e a conta vinculada à baixa financeira.

**Principais ações (comentário)**
- Conferir cliente, título e vencimento.
- Informar juros/multa, desconto, data e forma de recebimento.
- Confirmar o recebimento.

**Ponto de atenção**
- Preservar o saldo do título e o vínculo com a entrada registrada.
- Esta visão complementa a Tela 22: Contas a receber. Consulte a página 28 para a visão principal e os comentários gerais.

**Regiões da tela**
- Modal sobreposto (sem barra superior global): título 'Receber título' + subtítulo 'Confirme os valores e a forma de recebimento.' e botão X
- Bloco de resumo somente leitura (Cliente, Título, Vencimento)
- Grade de campos em 2 colunas (valores e data)
- Campos em largura total (forma de recebimento, observação)
- Rodapé com total 'Valor a receber' e botões

**Campos observados**
- Cliente (somente leitura; ex.: Mariana Oliveira)
- Título (somente leitura; ex.: CR-00841 • Parcela 2/3)
- Vencimento (somente leitura; ex.: 21/09/2026)
- Valor original (moeda; ex.: R$ 289,90)
- Juros / multa (moeda; ex.: R$ 0,00)
- Desconto (moeda; ex.: R$ 0,00)
- Data do recebimento (data com calendário; ex.: 09/21/2026)
- Forma de recebimento (select; ex.: Pix)
- Observação (área de texto; placeholder 'Informações adicionais do recebimento')
- Valor a receber (calculado, destaque; ex.: R$ 289,90)

**Botões e ações observados**
- Botão X (fechar modal)
- Ícone de calendário 'Data do recebimento'
- Dropdown 'Forma de recebimento'
- Botão 'Cancelar'
- Botão laranja 'Confirmar recebimento' (ícone check)

**Indicadores / cartões / gráficos**
- Total 'Valor a receber' (R$ 289,90)

**Regras e políticas ilustradas (exemplos)**
- Valor a receber = Valor original + Juros/multa − Desconto (289,90 + 0,00 − 0,00 = R$ 289,90)
- Recebimento vinculado a um título/parcela específico (CR-00841 • Parcela 2/3)
- Forma de recebimento obrigatória para a baixa (ex.: Pix)

**Inconsistências do protótipo**
- O texto 'O que este detalhe mostra' cita 'a conta vinculada à baixa financeira', mas o modal não possui campo de conta bancária/caixa de destino (diferente da Baixa de pagamento da Tela 23)
- Data do recebimento em MM/DD/AAAA (09/21/2026) e Vencimento em DD/MM/AAAA (21/09/2026) no mesmo modal
- A Tela 22 exige prever recebimentos parciais, mas não há campo de valor recebido distinto do valor a receber

### Tela 23 — Contas a pagar (p. 30)

Grupo: Financeiro

**Objetivo:** Organiza obrigações e pagamentos, reunindo vencimentos, despesas e situações que exigem conferência ou aprovação antes da baixa.

**Principais ações (comentário)**
- Consultar contas por situação e vencimento.
- Examinar pendências e previsões de saída.
- Registrar o pagamento de uma obrigação.

**Ponto de atenção**
- Aprovar uma obrigação e efetuar seu pagamento são ações distintas. A implementação deve preservar conta financeira, responsável e vínculo com a origem da despesa.

**Regiões da tela**
- Barra superior global (azul-marinho): logo 'I', 'Intercert ERP' + subtítulo 'Contas a pagar', contexto 'Loja Modelo — Matriz', avatar 'HB'
- Cabeçalho: título 'Contas a pagar' + subtítulo 'Controle despesas, fornecedores, vencimentos, aprovações e pagamentos.'; botões 'Relatório' e '+ Nova conta'
- Faixa de 4 cartões de indicadores
- Painel principal (esquerda): busca + filtros, chips de situação, tabela, rodapé 'Exibindo 5 títulos' / 'Página 1 de 19'
- Painel lateral (direita): 'Previsão de caixa' (cartão de saldo), 'Despesas por categoria' (barras horizontais) e 'Aguardando aprovação' (lista com botões Aprovar)

**Campos observados**
- Busca (texto com lupa; placeholder 'Buscar fornecedor, documento ou de[scrição]', truncado)
- Status (select; valor 'Todos os status')
- Centro de custo (select; valor 'Todos os centros')
- Fornecedor (nome)
- Descrição da despesa
- Documento (NF-e, FAT, ALU, NFSe, INV)
- Parcela (ex.: 'Parcela 1/2')
- Categoria
- Data de vencimento (DD/MM/AAAA)
- Situação relativa ('Em N dias', 'N dias em atraso', 'Pago em DD/MM')
- Valor (R$)
- Centro de custo
- Status (selo)
- Saldo disponível (R$)
- Saldo após pagamentos da semana (R$)
- Valor por categoria de despesa (R$)
- Fornecedor e valor aguardando aprovação

**Botões e ações observados**
- Botão 'Relatório' (ícone documento)
- Botão laranja '+ Nova conta'
- Dropdown 'Todos os status'
- Dropdown 'Todos os centros'
- Botão 'Filtros' (ícone controles)
- Chips: Todos (ativo), Vencem em breve, Em atraso, Aprovação, Pagos
- Ação 'Pagar/baixar' (ícone $ em círculo) – títulos em aberto e em atraso
- Ação 'Aprovar' (ícone ✓) – título em aprovação
- Ação 'Visualizar' (ícone olho) – todas as linhas
- Ação 'Comprovante/recibo' (ícone documento com linhas) – título pago
- Botões laranja 'Aprovar' no painel 'Aguardando aprovação' (um por conta: Enel Ceará, Gráfica Modelo, Transportadora CE)
- Avatar 'HB'

**Abas / etapas**
- Todos (ativo)
- Vencem em breve
- Em atraso
- Aprovação
- Pagos

**Colunas de tabelas**
- Contas a pagar: Fornecedor / descrição (nome + descrição da despesa)
- Contas a pagar: Documento (nº + parcela, ex.: 'NF-e 352609' / 'Parcela 1/2')
- Contas a pagar: Categoria
- Contas a pagar: Vencimento (data + situação relativa)
- Contas a pagar: Valor
- Contas a pagar: Centro de custo
- Contas a pagar: Status
- Contas a pagar: Ações
- Despesas por categoria: Categoria / Valor / barra proporcional
- Aguardando aprovação: Fornecedor / Valor / botão Aprovar
- Dados de exemplo: Distribuidora Nordeste — Compra de mercadorias | NF-e 352609 Parcela 1/2 | Estoque | 23/09/2026 Em 2 dias | R$ 8.450,00 | Operacional | Em aberto
- Dados de exemplo: Enel Ceará — Energia elétrica — setembro | FAT-0926-1842 | Utilidades | 25/09/2026 Em 4 dias | R$ 1.286,40 | Administrativo | Aprovação
- Dados de exemplo: Imobiliária Cariri — Aluguel da loja — setembro | ALU-2026-09 | Ocupação | 15/09/2026 6 dias em atraso | R$ 4.620,00 | Administrativo | Em atraso
- Dados de exemplo: Software Gestão Ltda. — Mensalidade ERP e suporte | NFSe-009184 | Tecnologia | 28/09/2026 Em 7 dias | R$ 780,00 | Administrativo | Em aberto
- Dados de exemplo: Meta Platforms — Campanhas de anúncios | INV-884201 | Marketing | 18/09/2026 Pago em 18/09 | R$ 2.350,00 | Comercial | Pago

**Filtros**
- Busca por fornecedor, documento ou descrição
- Status (select: 'Todos os status')
- Centro de custo (select: 'Todos os centros')
- Filtros (painel adicional)
- Chips de situação (Todos / Vencem em breve / Em atraso / Aprovação / Pagos)

**Indicadores / cartões / gráficos**
- Total a pagar (R$ 62.480, azul; '94 títulos em aberto')
- Pago neste mês (R$ 41.275, verde; '68 títulos liquidados')
- Em atraso (R$ 3.240, vermelho; '5 títulos vencidos')
- Próximos 7 dias (R$ 18.960, preto; '27 títulos programados')
- Previsão de caixa: Saldo disponível (R$ 84.630; 'Após pagamentos da semana: R$ 65.670' em verde)
- Despesas por categoria: Estoque R$ 26.480 (barra azul), Administrativo R$ 12.310 (barra laranja), Comercial R$ 7.840 (barra verde)
- Aguardando aprovação: Enel Ceará R$ 1.286,40; Gráfica Modelo R$ 890,00; Transportadora CE R$ 1.140,00
- Rodapé 'Exibindo 5 títulos' e 'Página 1 de 19'

**Estados e selos**
- Selo 'Em aberto' (azul)
- Selo 'Aprovação' (laranja)
- Selo 'Em atraso' (vermelho)
- Selo 'Pago' (verde)
- Vencimento e valor em vermelho quando atrasado
- Chip ativo 'Todos' em azul-marinho

**Regras e políticas ilustradas (exemplos)**
- Saldo após pagamentos da semana = saldo disponível − próximos 7 dias (84.630 − 18.960 = 65.670)
- Título em 'Aprovação' exibe apenas Aprovar + Visualizar (sem Pagar): aprovação precede o pagamento
- Título pago exibe data de pagamento e ação de comprovante, sem ação de pagar
- Situação relativa calculada a partir de 21/09/2026 (Em 2 dias, Em 4 dias, 6 dias em atraso, Em 7 dias)
- Título atrasado destacado em vermelho sem acréscimo de encargos no valor (R$ 4.620,00)
- Cada conta possui categoria (Estoque, Utilidades, Ocupação, Tecnologia, Marketing) e centro de custo (Operacional, Administrativo, Comercial)
- Documentos de origem diversos: NF-e, fatura (FAT), aluguel (ALU), NFS-e, invoice (INV), com parcelamento ('Parcela 1/2')
- Despesas recorrentes identificadas na descrição por mês de referência ('— setembro')
- Fila de aprovação rápida no painel lateral
- Valores alimentam o Fluxo de caixa (Tela 24): Próximos 7 dias R$ 18.960 = Saídas previstas; Saldo disponível R$ 84.630 = Saldo disponível hoje

**Inconsistências do protótipo**
- KPI 'Em atraso' R$ 3.240 (5 títulos) é menor que um único título em atraso listado (Imobiliária Cariri R$ 4.620,00)
- Painel 'Despesas por categoria' mistura categoria (Estoque) com centros de custo (Administrativo, Comercial); as categorias da tabela são Estoque, Utilidades, Ocupação, Tecnologia, Marketing; centro 'Operacional' não aparece
- Barras de 'Despesas por categoria' não proporcionais aos valores (Administrativo 12.310 ≈ 46% de Estoque, mas barra ≈ 58%; Comercial 7.840 ≈ 30%, barra ≈ 39%)
- Período de 'Despesas por categoria' não informado; soma 46.630 não corresponde a 'Pago neste mês' (41.275) nem a 'Total a pagar' (62.480)
- 'Página 1 de 19' (≈95 títulos a 5 por página) corresponde aos 94 em aberto, mas o chip 'Todos' inclui pagos (+68 liquidados)
- Chip 'Vencem em breve' sem horizonte definido, enquanto o KPI usa 'Próximos 7 dias'
- Chip 'Todos' e select 'Todos os status' filtram a mesma dimensão (redundância)
- Padrão de listagem diverge de Contas a receber (Tela 22): sem checkboxes de seleção em lote e sem menu '…'
- Enel Ceará em 'Aprovação' aqui aparece como 'Previsto' no Fluxo de caixa (Tela 24) sem distinção de pendência de aprovação

### Tela 23 — Baixa de pagamento (p. 31)

_Visão complementar: Contas a pagar: baixa de pagamento (modal 'Baixar pagamento')_

Grupo: Financeiro

**Objetivo:** O formulário permite conferir os dados do pagamento antes de registrar sua efetivação.

**Principais ações (comentário)**
- Conferir fornecedor, documento e vencimento.
- Informar valores, data, conta de saída e forma de pagamento.
- Confirmar o pagamento.

**Ponto de atenção**
- Separar a autorização para pagar da comprovação e do registro da saída.
- Esta visão complementa a Tela 23: Contas a pagar. Consulte a página 30 para a visão principal e os comentários gerais.

**Regiões da tela**
- Modal sobreposto (sem barra superior global): título 'Baixar pagamento' + subtítulo 'Informe os dados do pagamento realizado.' e botão X
- Bloco de resumo somente leitura (Fornecedor, Documento, Vencimento)
- Grade de campos em 2 colunas (valores e data)
- Campos em largura total (conta, forma de pagamento, observação)
- Rodapé com 'Total do pagamento' e botões

**Campos observados**
- Fornecedor (somente leitura; ex.: Distribuidora Nordeste)
- Documento (somente leitura; ex.: NF-e 352609 • Parcela 1/2)
- Vencimento (somente leitura; ex.: 23/09/2026)
- Valor original (moeda; ex.: R$ 8.450,00)
- Juros / multa (moeda; ex.: R$ 0,00)
- Desconto (moeda; ex.: R$ 0,00)
- Data do pagamento (data com calendário; ex.: 09/21/2026)
- Conta bancária / caixa (select; ex.: Banco Intercert — Conta movimento)
- Forma de pagamento (select; ex.: Pix)
- Observação (área de texto; placeholder 'Número da transação ou informação adicional')
- Total do pagamento (calculado, destaque; ex.: R$ 8.450,00)

**Botões e ações observados**
- Botão X (fechar modal)
- Ícone de calendário 'Data do pagamento'
- Dropdown 'Conta bancária / caixa'
- Dropdown 'Forma de pagamento'
- Botão 'Cancelar'
- Botão laranja 'Confirmar pagamento' (ícone check)

**Indicadores / cartões / gráficos**
- Total do pagamento (R$ 8.450,00)

**Regras e políticas ilustradas (exemplos)**
- Total do pagamento = Valor original + Juros/multa − Desconto (8.450,00 + 0,00 − 0,00 = R$ 8.450,00)
- Baixa exige conta bancária/caixa de saída e forma de pagamento
- Observação usada para registrar o número da transação (comprovação)
- Pagamento antecipado permitido (data 21/09 para vencimento 23/09)

**Inconsistências do protótipo**
- Data do pagamento em MM/DD/AAAA (09/21/2026) e Vencimento em DD/MM/AAAA (23/09/2026) no mesmo modal
- O comentário pede separar comprovação do registro, mas não há campo para anexar comprovante
- O modal de recebimento (Tela 22) não possui o campo equivalente 'Conta bancária / caixa' presente aqui — assimetria entre as baixas

### Tela 24 — Fluxo de caixa (p. 32)

Grupo: Financeiro

**Objetivo:** Consolida entradas, saídas e saldos para apoiar decisões sobre disponibilidade financeira e compromissos previstos ao longo do período.

**Principais ações (comentário)**
- Selecionar o período de análise.
- Comparar entradas, saídas e saldo projetado.
- Consultar saldos por conta e lançamentos.

**Ponto de atenção**
- Distinguir valores realizados dos previstos. O saldo inicial, a data de competência e a data de caixa precisam ter critérios explícitos na especificação.

**Regiões da tela**
- Barra superior global (azul-marinho): logo 'I', 'Intercert ERP' + subtítulo 'Fluxo de caixa', contexto central 'Todas as filiais', avatar 'HB'
- Cabeçalho: título 'Fluxo de caixa' + subtítulo 'Visualize saldos, movimentações realizadas e projeções financeiras.'; à direita filtros de filial, período e data
- Faixa de 4 cartões de indicadores (Saldo disponível hoje, Entradas previstas, Saídas previstas, Saldo projetado)
- Painel de gráfico (esquerda): 'Entradas, saídas e saldo projetado' — barras agrupadas por dia + linha de saldo, legenda no canto superior direito
- Painel lateral (direita): 'Saldos por conta' com 4 contas e cartão 'Total consolidado'
- Painel inferior: lista de movimentações com busca, filtro de tipo, 'Exportar', '+ Novo lançamento', tabela e rodapé com contagem e nota de saldo acumulado

**Campos observados**
- Filial (select; valor 'Todas as filiais')
- Período (select; valor 'Próximos 7 dias')
- Data de referência (date picker; valor '09/21/2026')
- Busca (texto com lupa; placeholder 'Buscar descrição, documento ou con[ta]', truncado)
- Tipo de movimentação (select; valor 'Entradas e saídas')
- Saldo disponível hoje (R$)
- Entradas previstas (R$)
- Saídas previstas (R$)
- Saldo projetado (R$) e data-alvo ('Para 28/09/2026')
- Nome da conta (Banco Intercert, Caixa da Matriz, Conta Stone, Filial Crato)
- Tipo da conta (Conta movimento, Dinheiro, Recebíveis, Caixa)
- Saldo atual da conta (R$)
- Valor previsto da conta ('+ R$ x previsto')
- Total consolidado (R$)
- Data da movimentação (DD/MM/AAAA)
- Movimentação (título + descrição + ícone de direção)
- Categoria
- Conta
- Documento
- Status (selo)
- Valor (R$ com sinal + / −)
- Saldo acumulado (R$)

**Botões e ações observados**
- Dropdown 'Todas as filiais'
- Dropdown 'Próximos 7 dias'
- Seletor de data '09/21/2026' (ícone calendário)
- Legenda do gráfico: Entradas (verde), Saídas (vermelho), Saldo (azul-marinho)
- Pontos da linha de saldo no gráfico (marcadores por dia)
- Campo de busca de movimentações (lupa)
- Dropdown 'Entradas e saídas'
- Botão 'Exportar' (ícone download)
- Botão laranja '+ Novo lançamento'
- Avatar 'HB'

**Colunas de tabelas**
- Movimentações: Data
- Movimentações: Movimentação (ícone seta entrada/saída + título + descrição)
- Movimentações: Categoria
- Movimentações: Conta
- Movimentações: Documento
- Movimentações: Status
- Movimentações: Valor (com sinal, verde/vermelho)
- Movimentações: Saldo (acumulado)
- Saldos por conta: Nome da conta / Tipo / Saldo / '+ R$ previsto'
- Gráfico: eixo X dias 21/09 a 27/09; eixo Y R$ 0, R$ 5 mil, R$ 10 mil, R$ 20 mil, R$ 30 mil
- Dados de exemplo: 21/09/2026 | Recebimentos do PDV — Vendas consolidadas do dia | Vendas | Caixa Matriz | FECH-00184 | Realizado | + R$ 8.420,00 | R$ 84.630,00
- Dados de exemplo: 23/09/2026 | Distribuidora Nordeste — Compra de mercadorias | Estoque | Banco Intercert | NF-e 352609 | Previsto | − R$ 8.450,00 | R$ 76.180,00
- Dados de exemplo: 24/09/2026 | Parcelas do crediário — 12 títulos programados | Recebimentos | Banco Intercert | LOTE-CR-0924 | Previsto | + R$ 4.860,00 | R$ 81.040,00
- Dados de exemplo: 25/09/2026 | Enel Ceará — Energia elétrica — setembro | Utilidades | Banco Intercert | FAT-0926-1842 | Previsto | − R$ 1.286,40 | R$ 79.753,60

**Filtros**
- Filial (select: 'Todas as filiais')
- Período (select: 'Próximos 7 dias')
- Data de referência (09/21/2026)
- Busca por descrição, documento ou conta
- Tipo de movimento (select: 'Entradas e saídas')

**Indicadores / cartões / gráficos**
- Saldo disponível hoje (R$ 84.630, azul; 'Caixas e contas bancárias')
- Entradas previstas (R$ 29.480, verde; 'Próximos 7 dias')
- Saídas previstas (R$ 18.960, vermelho; 'Próximos 7 dias')
- Saldo projetado (R$ 95.150, preto; 'Para 28/09/2026')
- Gráfico 'Entradas, saídas e saldo projetado' (barras verdes/vermelhas por dia 21/09–27/09 + linha de saldo crescente)
- Saldos por conta: Banco Intercert – Conta movimento – R$ 52.480,30 (+ R$ 8.320 previsto)
- Saldos por conta: Caixa da Matriz – Dinheiro – R$ 8.450,70 (+ R$ 1.180 previsto)
- Saldos por conta: Conta Stone – Recebíveis – R$ 18.920,00 (+ R$ 6.740 previsto)
- Saldos por conta: Filial Crato – Caixa – R$ 4.779,00 (+ R$ 980 previsto)
- Total consolidado (R$ 84.630,00, azul em destaque)
- Rodapé: 'Exibindo 4 movimentações' e 'Saldo acumulado considera lançamentos realizados e previstos'

**Estados e selos**
- Selo 'Realizado' (verde)
- Selo 'Previsto' (azul-acinzentado)
- Ícone de entrada (seta ↙ verde em fundo verde claro)
- Ícone de saída (seta ↗ vermelha em fundo rosa claro)
- Valor de entrada em verde com '+', saída em vermelho com '−'
- Valores previstos por conta em verde ('+ R$ … previsto')

**Regras e políticas ilustradas (exemplos)**
- Saldo projetado = saldo disponível hoje + entradas previstas − saídas previstas (84.630 + 29.480 − 18.960 = 95.150)
- Total consolidado = soma dos saldos por conta (52.480,30 + 8.450,70 + 18.920,00 + 4.779,00 = 84.630,00)
- Saldo acumulado da tabela soma realizados e previstos em ordem cronológica (84.630 − 8.450 = 76.180; + 4.860 = 81.040; − 1.286,40 = 79.753,60)
- Saldo disponível hoje já inclui o realizado do dia (PDV 21/09 + R$ 8.420 → saldo R$ 84.630)
- Saídas previstas (R$ 18.960) = 'Próximos 7 dias' de Contas a pagar (Tela 23); saldo disponível = 'Previsão de caixa' da Tela 23
- Lançamentos previstos originados de Contas a pagar (NF-e 352609, FAT-0926-1842) e de Contas a receber (parcelas do crediário agrupadas em LOTE-CR-0924, 12 títulos)
- Recebimentos do PDV consolidados por fechamento de caixa (FECH-00184)
- Contas financeiras tipificadas: Conta movimento, Dinheiro, Recebíveis, Caixa; cada uma com valor previsto
- Visão consolidada multi-filial com filtro de filial e período padrão de 7 dias a partir da data de referência
- Cada lançamento tem status Realizado ou Previsto

**Inconsistências do protótipo**
- Eixo Y do gráfico não linear: marcas R$ 0, 5 mil, 10 mil, 20 mil e 30 mil igualmente espaçadas
- Barras do gráfico somam aproximadamente R$ 90 mil de entradas e R$ 60 mil de saídas em 7 dias, muito acima dos KPIs (R$ 29.480 e R$ 18.960)
- Linha de saldo varia de ≈ R$ 7 mil a ≈ R$ 19 mil, incompatível com saldo disponível R$ 84.630 e projetado R$ 95.150; e é sempre crescente, embora a tabela mostre queda em 23/09 (84.630 → 76.180)
- Soma dos previstos por conta (8.320 + 1.180 + 6.740 + 980 = 17.220) não bate com entradas previstas (29.480) nem com o líquido previsto (10.520); todos aparecem positivos, embora Banco Intercert tenha saídas previstas de R$ 8.450,00 e R$ 1.286,40
- Nome da conta divergente: 'Caixa Matriz' na tabela vs 'Caixa da Matriz' em Saldos por conta
- 'Filial Crato' listada como conta financeira (tipo Caixa), misturando filial com conta
- Saldo projetado 'Para 28/09/2026', mas o gráfico de 'Próximos 7 dias' cobre 21/09 a 27/09
- Filtro de data em formato MM/DD/AAAA (09/21/2026) enquanto a tabela usa DD/MM/AAAA
- Enel Ceará consta como 'Previsto', mas na Tela 23 ainda está em 'Aprovação' — projeção inclui obrigação não aprovada sem distinção
- Gráfico mostra movimentos em 22/09, 26/09 e 27/09 que não aparecem na lista ('Exibindo 4 movimentações', sem paginação)
- Contexto do topo 'Todas as filiais' difere das demais telas ('Loja Modelo — Matriz')

### Tela 25 — Conciliação bancária (p. 33)

Grupo: Financeiro

**Objetivo:** Relaciona as movimentações do extrato com os registros financeiros do ERP, destacando correspondências, pendências e diferenças que exigem tratamento.

**Principais ações (comentário)**
- Importar o extrato e consultar seus movimentos.
- Examinar sugestões de correspondência.
- Confirmar conciliações e tratar divergências.

**Ponto de atenção**
- Evitar importação e conciliação duplicadas. Uma sugestão de vínculo precisa ser distinguida de uma conciliação efetivamente confirmada pelo usuário.

**Regiões da tela**
- Barra superior escura: logotipo 'I' laranja + 'Intercert ERP' / subtítulo 'Conciliação bancária'; contexto central 'Financeiro — Matriz'; avatar do usuário 'HB' à direita
- Cabeçalho da página: título 'Conciliação bancária' + subtítulo 'Compare o extrato bancário com os lançamentos do ERP e resolva divergências.' + botões à direita (Importar extrato, Sincronizar banco)
- Cartão da conta bancária: ícone de banco + nome da conta + linha de agência/conta/última sincronização; à direita seletor de banco, seletor de data e 'Saldo no extrato'
- Faixa de 4 cartões de KPI (Movimentações importadas, Conciliadas, Pendentes, Com divergência)
- Painel principal: abas de filtro, busca, ordenação, botão 'Sugerir correspondências'
- Lista em duas colunas por linha: à esquerda cartão 'EXTRATO BANCÁRIO', ao centro ícone de estado do vínculo, à direita cartão 'LANÇAMENTO NO ERP' (ou espaço tracejado 'Nenhum lançamento correspondente no ERP'), e coluna de 2 botões de ação por linha
- Rodapé do painel: contador 'Exibindo 4 de 48 movimentações' + botões 'Salvar para depois' e 'Confirmar conciliações'

**Campos observados**
- Seletor de banco/conta (select) (Banco Intercert)
- Data do extrato (date) (09/21/2026)
- Saldo no extrato (R$, somente leitura) (R$ 52.480,30)
- Identificação da conta: nome (Banco Intercert — Conta movimento)
- Agência (0001)
- Conta (45892-7)
- Última sincronização (hoje, 10:42)
- Busca: 'Buscar descrição, documento ou valor' (texto)
- Ordenação (select) (Mais recentes primeiro)
- Cartão Extrato bancário – rótulo 'EXTRATO BANCÁRIO'
- Extrato – data e hora do movimento (21/09 • 09:32)
- Extrato – descrição do movimento (PIX RECEBIDO — M. OLIVEIRA)
- Extrato – identificador/complemento (ID E9040088820260921; 'Débito automático'; 'Antecipação de cartões')
- Extrato – valor com sinal (+ R$ 289,90 em verde; − R$ 8.450,00 em vermelho)
- Cartão Lançamento no ERP – rótulo 'LANÇAMENTO NO ERP'
- ERP – código do lançamento (CR-00841; CP-00642; REC-0918)
- ERP – nome do cliente/fornecedor/origem (Mariana Oliveira; Distribuidora Nordeste; Recebíveis Stone)
- ERP – detalhe do título (Crediário • Parcela 2/3; NF-e 352609 • Parcela 1/2; Vendas de 18/09 • Taxa pendente)
- ERP – valor com sinal (+ R$ 289,90; − R$ 8.450,00; + R$ 18.420,00)
- ERP – 'Correspondência automática' (percentual) (100%)
- ERP – 'Diferença identificada' (R$) (R$ 135,25 em vermelho)
- Mensagem de ausência: 'Nenhum lançamento correspondente no ERP' (com ícone de interrogação)

**Botões e ações observados**
- Importar extrato (ícone de upload; abre diálogo da página 34)
- Sincronizar banco (botão primário laranja; ícone de atualizar)
- Sugerir correspondências (ícone de varinha mágica)
- Abas de filtro clicáveis (Todos / Conciliados / Pendentes / Divergências)
- Linha vinculada: botão verde de confirmar (check) a correspondência
- Linha vinculada: botão desvincular (ícone de corrente quebrada)
- Linha sem correspondência: botão '+' (criar lançamento no ERP)
- Linha sem correspondência: botão ocultar/ignorar (ícone de olho cortado)
- Linha com divergência: botão ajustar/tratar diferença (ícone de controles deslizantes)
- Linha com divergência: botão ver detalhes (ícone de olho)
- Salvar para depois
- Confirmar conciliações (botão primário laranja; ícone de duplo check)
- Seletor de banco (dropdown)
- Seletor de data (ícone de calendário)

**Abas / etapas**
- Todos (48) — ativa
- Conciliados (39)
- Pendentes (7)
- Divergências (2)

**Colunas de tabelas**
- Lista de conciliação – lado Extrato bancário: data•hora | descrição | identificador/complemento | valor
- Lista de conciliação – indicador central: ícone de vínculo (link verde = vinculado; corrente quebrada cinza = sem vínculo; triângulo âmbar = divergência)
- Lista de conciliação – lado Lançamento no ERP: código | nome | detalhe do título | valor | correspondência automática ou diferença identificada
- Lista de conciliação – coluna de ações (2 botões por linha, variando conforme estado)

**Filtros**
- Busca por descrição, documento ou valor
- Abas por situação (Todos, Conciliados, Pendentes, Divergências)
- Ordenação 'Mais recentes primeiro'
- Banco/conta (Banco Intercert)
- Data/período do extrato (09/21/2026)

**Indicadores / cartões / gráficos**
- Movimentações importadas (48) — 'Período selecionado'
- Conciliadas (39, verde) — '81,3% do extrato'
- Pendentes (7, âmbar) — 'Requerem análise'
- Com divergência (2, vermelho) — 'Valor ou data diferentes'
- Saldo no extrato (R$ 52.480,30)
- Cartão da conta: Banco Intercert — Conta movimento; Agência 0001 • Conta 45892-7 • Última sincronização hoje, 10:42

**Estados e selos**
- Vinculado/correspondência automática (ícone de link verde, 'Correspondência automática: 100%')
- Sem correspondência (cartão com borda tracejada + ícone de corrente quebrada)
- Divergência (ícone de triângulo de alerta âmbar + 'Diferença identificada' em vermelho)
- Valores de entrada em verde com '+', saídas em vermelho com '−'
- Aba ativa em azul escuro

**Regras e políticas ilustradas (exemplos)**
- Conciliadas = 39 de 48 movimentações = 81,3% do extrato
- Total de movimentações = Conciliadas + Pendentes + Com divergência (39 + 7 + 2 = 48)
- Diferença identificada = valor ERP − valor extrato (R$ 18.420,00 − R$ 18.284,75 = R$ 135,25), atribuída a taxa pendente de antecipação de cartões (Stone)
- Correspondência automática expressa em percentual de aderência (100%)
- Lançamento de tarifa bancária (débito automático) sem correspondência pode gerar novo lançamento no ERP ('+') ou ser ignorado
- Pagamento de fornecedor vinculado a parcela de título a pagar (CP-00642, NF-e 352609, Parcela 1/2)
- Recebimento de cliente vinculado a parcela de crediário (CR-00841, Parcela 2/3)

**Inconsistências do protótipo**
- Campo de data em formato americano (09/21/2026) enquanto as linhas usam dd/mm (21/09)
- Linhas com 'Correspondência automática: 100%' já exibem ícone de vínculo e botão de confirmar, sem distinção visual clara entre sugestão e conciliação confirmada (exatamente o ponto de atenção)
- Contador 'Exibindo 4 de 48 movimentações' sem controles de paginação ou 'carregar mais'
- Cruzamento com outras telas: PIX de R$ 8.450,00 para Distribuidora Nordeste referente a 'NF-e 352609 • Parcela 1/2' pago em 21/09, mas na Tela 29 a NF-e 000.352.609 foi emitida em 22/09/2026 16:42 e os vencimentos previstos são 21/10 e 18/11; na Tela 27 o pedido correspondente (PC-00482) ainda está 'Em trânsito'
- Cruzamento: Tela 26 mostra saldo a pagar de R$ 16.900,00 para Distribuidora Nordeste, embora a parcela 1/2 (R$ 8.450,00) apareça paga aqui

### Tela 25 — Importação do extrato (detalhe da Conciliação bancária) (p. 34)

_Visão complementar: Conciliação bancária: diálogo 'Importar extrato bancário' (Importação do extrato)_

Grupo: Financeiro

**Objetivo:** O diálogo representa o ponto de entrada das movimentações externas no fluxo de conciliação: o usuário seleciona ou arrasta o arquivo de extrato exportado pelo banco para importar os lançamentos a conciliar.

**Principais ações (comentário)**
- (Página de detalhe sem seção 'Principais ações'.)
- Comentário: Tratar formato, conta de destino e possíveis duplicidades de importação.
- Ligação com a tela: Esta visão complementa a Tela 25: Conciliação bancária. Consulte a página 33 para a visão principal e os comentários gerais.
- O que este detalhe mostra: O diálogo representa o ponto de entrada das movimentações externas no fluxo de conciliação.

**Ponto de atenção**
- Tratar formato, conta de destino e possíveis duplicidades de importação.

**Regiões da tela**
- Cabeçalho da página do guia: trilha 'TELA 25 / FINANCEIRO / DETALHE', título 'Importação do extrato' e link 'SUMÁRIO' à direita (navegação do documento, não da tela)
- Diálogo modal centralizado sobre fundo escurecido (overlay cinza escuro visível nas bordas laterais)
- Cabeçalho do modal: título 'Importar extrato bancário', subtítulo 'Selecione o arquivo exportado pelo seu banco.' e botão fechar (X) em quadrado cinza-claro arredondado no canto superior direito
- Área de arrastar-e-soltar (dropzone) com borda tracejada e fundo cinza-azulado claro: ícone de arquivo com seta para cima, texto principal 'Arraste o extrato para esta área', texto secundário 'ou escolha um arquivo no seu computador', botão 'Selecionar arquivo' e linha de formatos aceitos em texto cinza
- Rodapé do modal alinhado à direita: botão secundário 'Cancelar' (contorno) e botão primário laranja 'Importar extrato' com ícone de upload
- Bloco de comentários do guia em três colunas: 'O QUE ESTE DETALHE MOSTRA', 'COMENTÁRIO', 'LIGAÇÃO COM A TELA'
- Rodapé do guia: 'INTERCERT ERP / Guia visual do MVP' e paginação '34 / 80'

**Campos observados**
- Área de upload por arrastar-e-soltar (dropzone): 'Arraste o extrato para esta área'
- Texto auxiliar: 'ou escolha um arquivo no seu computador'
- Seletor de arquivo do computador (input de arquivo acionado pelo botão 'Selecionar arquivo')
- Indicação de formatos aceitos (texto informativo): OFX, CSV, CNAB 240, CNAB 400
- Subtítulo/instrução: 'Selecione o arquivo exportado pelo seu banco.'

**Botões e ações observados**
- Fechar diálogo (ícone X, canto superior direito)
- Selecionar arquivo (botão azul-escuro/marinho dentro da dropzone; abre seletor de arquivos do sistema)
- Arrastar e soltar arquivo na área tracejada
- Cancelar (botão secundário com contorno; fecha o diálogo sem importar)
- Importar extrato (botão primário laranja com ícone de upload/seta para cima; executa a importação)
- (Documento) Link 'SUMÁRIO' no topo da página do guia

**Estados e selos**
- Rótulos de formato aceito exibidos como texto cinza (não como selos coloridos): OFX, CSV, CNAB 240, CNAB 400
- Trilha do guia: 'TELA 25 / FINANCEIRO / DETALHE'

**Regras e políticas ilustradas (exemplos)**
- Formatos de extrato aceitos: OFX, CSV, CNAB 240 e CNAB 400
- Importação deve validar o formato do arquivo antes de processar
- Importação deve ser vinculada a uma conta bancária de destino
- Importação deve detectar duplicidade de arquivo e/ou de movimentos já importados anteriormente
- Entrada do arquivo por arrastar-e-soltar ou por seleção manual no computador

**Inconsistências do protótipo**
- O comentário exige tratar 'conta de destino', mas o diálogo não tem campo para escolher a conta/banco de destino (presume-se herdada do seletor da tela principal, página 33, sem indicação visual no modal)
- Não há campo de período/data do extrato nem exibição do arquivo selecionado (nome, tamanho) após a escolha
- Botão 'Importar extrato' aparece habilitado mesmo sem arquivo selecionado
- Nenhuma indicação de tamanho máximo de arquivo, codificação (CSV) ou layout de colunas esperado para CSV
- Não há estados de progresso, sucesso, erro ou aviso de duplicidade representados no diálogo, apesar de o comentário pedir tratamento de duplicidades
- Formatos aceitos aparecem como texto simples cinza, sem destaque de selo, podendo passar despercebidos
- Botão 'Selecionar arquivo' em azul-marinho e botão primário 'Importar extrato' em laranja: dois botões de destaque com cores diferentes no mesmo diálogo

