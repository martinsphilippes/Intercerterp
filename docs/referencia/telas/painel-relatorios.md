# Telas do PDF — painel-relatorios

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

### Tela 03 — Painel do gestor (p. 7)

Grupo: Acesso e gestão

**Objetivo:** Oferece uma visão inicial da operação, reunindo vendas, metas, alertas e situação fiscal para orientar as prioridades do gestor.

**Principais ações (comentário)**
- Acompanhar faturamento e evolução das vendas.
- Ver metas, últimas vendas e alertas.
- Acessar atalhos dos módulos do ERP.

**Ponto de atenção**
- Cada indicador precisa ter período, origem e regra de cálculo definidos. Totais do painel devem conciliar com os relatórios e com os movimentos de origem.

**Regiões da tela**
- Menu lateral esquerdo azul-marinho com logotipo 'Intercert ERP' / 'Gestão inteligente', itens de módulo e rodapé 'Intercert Soluções • v1.0'
- Barra superior: ícone de loja + 'Loja Modelo — Matriz' / 'Juazeiro do Norte • Caixa aberto'; à direita sino de notificações com contador e avatar 'HB'
- Faixa de saudação: 'Olá, Hércules!' / 'Veja o desempenho da sua empresa hoje, 21 de setembro de 2026.' com seletor de período e botão 'Nova venda'
- Linha de 4 cartões de indicadores (KPIs)
- Painel de gráfico de barras 'Faturamento dos últimos 7 dias'
- Painel 'Meta mensal de vendas' com barras de progresso
- Linha inferior com 3 painéis: 'Últimas vendas', 'Resumo fiscal', 'Alertas importantes'

**Campos observados**
- Seletor de período (dropdown; valor 'Hoje')
- Identificação da unidade no topo (Loja Modelo — Matriz)
- Cidade e situação do caixa (Juazeiro do Norte • Caixa aberto)
- Saudação com nome do usuário (Hércules)
- Data de referência por extenso (21 de setembro de 2026)
- Última venda: número • cliente (#10482 • Maria Silva)
- Última venda: tipo de documento • hora (NFC-e • 20:42)
- Última venda: valor (R$ 389,90)
- Última venda: forma de pagamento (Pix)
- Resumo fiscal: tipo de documento, quantidade, observação e valor
- Alerta: título e descrição

**Botões e ações observados**
- Botão primário laranja '+ Nova venda'
- Seletor de período 'Hoje' (dropdown)
- Link 'Ver relatório' (painel Faturamento dos últimos 7 dias)
- Link 'Detalhes' (painel Meta mensal de vendas)
- Link 'Ver todas' (painel Últimas vendas)
- Link 'Central fiscal' (painel Resumo fiscal)
- Link 'Ver central' (painel Alertas importantes)
- Sino de notificações com badge
- Avatar 'HB' (menu do usuário)
- Itens do menu lateral (navegação entre módulos)

**Abas / etapas**
- Menu lateral: 'Painel' é o item ativo (destaque com barra laranja)

**Colunas de tabelas**
- Últimas vendas (lista): Nº venda • Cliente | Documento • Hora | Valor | Forma de pagamento
- Resumo fiscal (lista): Tipo de documento | Observação/situação | Quantidade | Valor
- Alertas importantes (lista): Ícone | Título | Descrição

**Filtros**
- Período: Hoje (dropdown)

**Indicadores / cartões / gráficos**
- Vendas líquidas (R$ 8.462,90; '↑ 12,4% sobre ontem' em verde; ícone cifrão)
- Pedidos concluídos (47; 'Ticket médio R$ 180,06' em verde; ícone sacola)
- Saldo disponível (R$ 32.580,40; 'R$ 6.240 a receber hoje' em laranja; ícone bandeja)
- Estoque crítico (12 itens; '3 produtos sem estoque' em vermelho; ícone caixa com lupa)
- Gráfico de barras 'Faturamento dos últimos 7 dias' (Seg, Ter, Qua, Qui, Sex, Sáb, Hoje — barra 'Hoje' em laranja; 'Total do período' R$ 46.817,30)
- Meta mensal de vendas (R$ 78.450 de R$ 100.000)
- Meta: barra 'Faturamento' (78%, laranja)
- Meta: barra 'Vendas realizadas' (342 / 430)
- Meta: barra 'Ticket médio' (R$ 229,39)
- Últimas vendas: #10482 • Maria Silva — NFC-e • 20:42 — R$ 389,90 — Pix
- Últimas vendas: #10481 • Consumidor — NFC-e • 20:35 — R$ 74,50 — Cartão
- Últimas vendas: #10480 • JL Comércio — NF-e • 20:18 — R$ 1.240,00 — Boleto
- Resumo fiscal: NFC-e autorizadas (42; Sem rejeições; R$ 6.980)
- Resumo fiscal: NF-e autorizadas (4; 1 aguardando envio; R$ 8.420)
- Resumo fiscal: NFS-e emitidas (2; Serviços; R$ 860)
- Alerta: 3 produtos sem estoque — Reposição necessária (ícone triângulo de aviso)
- Alerta: 5 contas vencidas — Total de R$ 1.240,00 (ícone cifrão)
- Alerta: 1 NF-e pendente — Aguardando transmissão (ícone documento com exclamação)
- Alerta: Certificado vence em 28 dias — Renovação recomendada (ícone calendário com relógio)

**Estados e selos**
- Caixa aberto (situação do caixa no topo)
- Badge de notificações (5)
- Variação positiva em verde (↑ 12,4% sobre ontem)
- Valor a receber em laranja
- Estoque sem saldo em vermelho
- Sem rejeições (NFC-e)
- 1 aguardando envio (NF-e)
- Barra do dia atual 'Hoje' destacada em laranja
- Ícones de alerta em laranja

**Itens de menu**
- Painel (ativo)
- Vendas e PDV
- Produtos e estoque
- Clientes e CRM
- Financeiro
- Fiscal
- Serviços
- Relatórios
- Configurações
- Rodapé: Intercert Soluções • v1.0

**Regras e políticas ilustradas (exemplos)**
- Ticket médio = vendas líquidas ÷ pedidos concluídos (R$ 8.462,90 ÷ 47 ≈ R$ 180,06)
- Variação percentual comparada ao dia anterior (12,4% sobre ontem)
- Meta mensal com % de atingimento = realizado ÷ meta (78.450 ÷ 100.000 = 78%)
- Meta de quantidade de vendas (342 de 430)
- Ticket médio do mês = faturamento ÷ vendas realizadas (78.450 ÷ 342 = R$ 229,39)
- Estoque crítico inclui itens abaixo do mínimo e sem saldo (12 itens, 3 sem estoque)
- Alerta de vencimento do certificado digital com antecedência (28 dias)
- Alertas de contas vencidas, NF-e pendente de transmissão e reposição de estoque
- Indicadores filtráveis por período (Hoje)

**Inconsistências do protótipo**
- A data '21 de setembro de 2026' é uma segunda-feira, mas o gráfico de 7 dias termina em 'Sáb' seguido de 'Hoje' (implicando domingo)
- Resumo fiscal soma R$ 16.260 (6.980 + 8.420 + 860) e 46 documentos de venda (42 NFC-e + 4 NF-e), enquanto Vendas líquidas = R$ 8.462,90 e 47 pedidos no filtro 'Hoje' — o período do resumo fiscal não é explicitado e os totais não conciliam
- Badge de notificações indica 5, mas o painel lista 4 alertas
- Cliente aparece como 'Maria Silva' nas últimas vendas e como 'Maria da Silva' nas telas do PDV
- Nomes de menu divergem dos grupos do sumário ('Vendas e PDV' x 'Vendas e caixa'; 'Clientes e CRM' x 'Clientes'); menu tem 'Serviços' sem grupo correspondente e não exibe 'Compras', 'Análise e planejamento' nem 'Administração e suporte'

### Tela 44 — Relatórios gerenciais (p. 64)

Grupo: Análise e planejamento

**Objetivo:** Transforma os movimentos da operação em informações de gestão, permitindo comparar resultados por período e filial e abrir os detalhes que compõem os totais.

**Principais ações (comentário)**
- Selecionar o contexto da análise.
- Consultar vendas, custos e resultados.
- Comparar filiais e detalhar os registros.

**Ponto de atenção**
- Receita, devoluções, descontos e custos devem seguir critérios consistentes. A margem agregada precisa ser calculada pelos totais, e não pela média simples das margens dos itens.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, trilha 'Gestão / Relatórios', seletor de empresa (Varejo Exemplo), avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Relatórios' ativo
- Cabeçalho da página: título 'Relatórios gerenciais' e subtítulo 'Compare as unidades e consulte a composição de cada resultado.'
- Cartão de filtros (4 campos em linha + checkbox + botão 'Aplicar filtros' + texto de ajuda)
- Cabeçalho do resultado: 'Vendas e margem' com contexto (Varejo Exemplo · Todas as filiais · 17/09/2026 a 23/09/2026) e selo 'Data de cada movimento' à direita
- Linha de 3 cartões KPI (Vendas líquidas, Margem bruta estimada, Vendas concluídas), cada um com valor, subtexto e variação vs. período anterior separada por linha divisória
- Início do cartão 'Resultado por filial' (continua na página 65) com texto 'Abra os detalhes para conferir os movimentos'

**Campos observados**
- Seletor de empresa no cabeçalho (select; Varejo Exemplo)
- Relatório (select; 'Vendas e margem')
- Filial (select; 'Todas as filiais')
- Data inicial (campo de data com ícone de calendário; 09/17/2026)
- Data final (campo de data com ícone de calendário; 09/23/2026)
- Comparar com o período anterior (checkbox; marcado)
- Texto de ajuda: 'Base de exemplo disponível de 10 a 23/09/2026. Datas inclusivas, no horário de Brasília.'
- Título do resultado: nome do relatório (Vendas e margem)
- Contexto do resultado: empresa · filial · período (Varejo Exemplo · Todas as filiais · 17/09/2026 a 23/09/2026)

**Botões e ações observados**
- Aplicar filtros (botão primário laranja com ícone de funil)
- Checkbox 'Comparar com o período anterior'
- Seletor de empresa (cabeçalho)
- Avatar HB (menu do usuário)
- Itens do menu lateral (navegação)

**Colunas de tabelas**
- Resultado por filial (cabeçalho visível apenas parcialmente nesta página; colunas na página 65)

**Filtros**
- Relatório (Vendas e margem)
- Filial (Todas as filiais)
- Data inicial (17/09/2026)
- Data final (23/09/2026)
- Comparar com o período anterior (checkbox)

**Indicadores / cartões / gráficos**
- Vendas líquidas (R$ 10.225,00) — 'Após descontos e devoluções' — '+81,62% vs. período anterior'
- Margem bruta estimada (33,52%) — 'R$ 3.427,50 de resultado bruto' — '+0,31 p.p. vs. período anterior'
- Vendas concluídas (10) — '1 devolução(ões) no período' — '+66,67% vs. período anterior'

**Estados e selos**
- Selo 'Data de cada movimento' (critério de data do relatório)
- Variações em azul vs. período anterior (+81,62%, +0,31 p.p., +66,67%)

**Itens de menu**
- PRINCIPAL (rótulo de seção)
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Relatórios (ativo)
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Vendas líquidas = vendas após descontos e devoluções
- Margem bruta estimada = resultado bruto / vendas líquidas (R$ 3.427,50 / R$ 10.225,00 = 33,52%)
- Resultado bruto = vendas líquidas − custo direto (R$ 10.225,00 − R$ 6.797,50 = R$ 3.427,50)
- Variação de margem expressa em pontos percentuais (p.p.); variações de valor/quantidade em %
- Comparação com período anterior de mesmo número de dias
- Datas inclusivas, no horário de Brasília; base de exemplo disponível de 10 a 23/09/2026
- Movimentos considerados pela data de cada movimento

**Inconsistências do protótipo**
- Campos de data exibem formato MM/DD/AAAA (09/17/2026, 09/23/2026) enquanto o restante da tela usa DD/MM/AAAA (17/09/2026 a 23/09/2026)
- Menu lateral não inclui 'Compras' (presente na Tela 46) nem 'Ajuda e suporte' (presente na Tela 43)
- Texto com plural genérico 'devolução(ões)' em vez de concordância dinâmica

### Tela 44 — Relatórios gerenciais (parte 2 de 2) (p. 65)

Grupo: Análise e planejamento

**Objetivo:** Continuação da mesma visão: tabela 'Resultado por filial', notas de cálculo e comparação. Transforma os movimentos da operação em informações de gestão, permitindo comparar resultados por período e filial e abrir os detalhes que compõem os totais.

**Ponto de atenção**
- Parte 2 de 2 da mesma visão. A divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo. Visão principal e comentários na página 64.

**Regiões da tela**
- Menu lateral escuro (recortado)
- Cartão 'Resultado por filial' com texto à direita 'Abra os detalhes para conferir os movimentos'
- Tabela de filiais com linha de total destacada
- Notas de rodapé da tabela (cancelamentos/devoluções e período de comparação)
- Seção expansível 'Como os valores são calculados'
- Aviso de dados demonstrativos com ícone de frasco

**Campos observados**
- Filial (texto em negrito; Centro, Crato, Barbalha)
- Vendas (quantidade; 4, 3, 3)
- Líquido (R$; 5.640,00 / 2.285,00 / 2.300,00)
- Custo direto (R$; 3.700,00 / 1.527,50 / 1.570,00)
- Margem (%; 34,4% / 33,15% / 31,74%)
- Linha Total (10; R$ 10.225,00; R$ 6.797,50; 33,52%)
- Nota: '1 venda(s) cancelada(s) fora dos cálculos. Devoluções consideradas na data em que ocorreram.'
- Nota: 'Comparação: 10/09/2026 a 16/09/2026 · mesmo número de dias.'
- Aviso: 'Dados demonstrativos. Os filtros e cálculos desta prévia não alteram a operação.'

**Botões e ações observados**
- Link 'Detalhes' na linha Centro (abre detalhamento da filial — página 66)
- Link 'Detalhes' na linha Crato
- Link 'Detalhes' na linha Barbalha
- Expansor '▸ Como os valores são calculados'

**Colunas de tabelas**
- Resultado por filial: Filial
- Resultado por filial: Vendas
- Resultado por filial: Líquido
- Resultado por filial: Custo direto
- Resultado por filial: Margem
- Resultado por filial: Ação

**Indicadores / cartões / gráficos**
- Cartão-tabela 'Resultado por filial'

**Estados e selos**
- Linha 'Total' em negrito com fundo destacado

**Regras e políticas ilustradas (exemplos)**
- Margem por filial = (Líquido − Custo direto) / Líquido (Crato: 757,50/2.285,00 = 33,15%; Barbalha: 730,00/2.300,00 = 31,74%)
- Margem total calculada pelos totais (R$ 3.427,50 / R$ 10.225,00 = 33,52%), não pela média simples das margens das filiais
- Total = soma das filiais (4+3+3 = 10; 5.640+2.285+2.300 = 10.225; 3.700+1.527,50+1.570 = 6.797,50)
- Vendas canceladas ficam fora dos cálculos
- Devoluções consideradas na data em que ocorreram
- Período de comparação = período imediatamente anterior com o mesmo número de dias (10/09/2026 a 16/09/2026 vs. 17/09/2026 a 23/09/2026)

**Inconsistências do protótipo**
- Precisão de margem diferente entre linhas: Centro '34,4%' (1 casa decimal) vs. demais '33,15%', '31,74%', '33,52%' (2 casas)
- Plural genérico 'venda(s) cancelada(s)'

### Tela 44 — Detalhamento do resultado por filial (p. 66)

_Visão complementar: Relatórios gerenciais: detalhamento do resultado por filial (Centro · Vendas e margem)_

Grupo: Análise e planejamento

**Objetivo:** O detalhamento permite verificar quais registros compõem os totais de uma filial.

**Principais ações (comentário)**
- Voltar ao relatório agregado
- Conferir os movimentos que compõem o período da filial

**Ponto de atenção**
- Manter os mesmos filtros e critérios da visão agregada para permitir a conciliação dos números.
- Esta visão complementa a Tela 44: Relatórios gerenciais. Consulte a página 64 para a visão principal e os comentários gerais.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, trilha 'Gestão / Relatórios', seletor de empresa (Varejo Exemplo, aparência desabilitada), avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Relatórios' ativo
- Título 'Relatórios gerenciais' e subtítulo 'Compare as unidades e consulte a composição de cada resultado.'
- Cartão de detalhe: link 'Voltar ao relatório' à esquerda do título 'Centro · Vendas e margem' com contexto 'Varejo Exemplo · 17/09/2026 a 23/09/2026'
- Grade de resumo 3x2 com seis valores
- Subtítulo 'Movimentos que compõem o período' e tabela de movimentos
- Rodapé da tabela: '5 registro(s) de exemplo · cancelamentos excluídos dos totais.'
- Aviso de dados demonstrativos com ícone de frasco

**Campos observados**
- Título do detalhe: Filial · Relatório (Centro · Vendas e margem)
- Contexto: empresa · período (Varejo Exemplo · 17/09/2026 a 23/09/2026)
- Vendas brutas (R$ 5.850,00)
- Descontos (R$ 210,00)
- Devoluções (R$ 0,00)
- Vendas líquidas (R$ 5.640,00)
- Custo direto (R$ 3.700,00)
- Resultado bruto (R$ 1.940,00)
- Movimento / data (código em negrito + data; ex.: V-0201 / 17/09/2026)
- Tipo (selo; Venda / Cancelada)
- Valor líquido (R$; ex.: 1.400,00; 'Excluída' para cancelada)
- Custo direto (R$; ex.: 910,00; 'Excluído' para cancelada)
- Rodapé: '5 registro(s) de exemplo · cancelamentos excluídos dos totais.'
- Aviso: 'Dados demonstrativos. Os filtros e cálculos desta prévia não alteram a operação.'

**Botões e ações observados**
- Link 'Voltar ao relatório'
- Seletor de empresa (cabeçalho; aparência desabilitada nesta visão)
- Avatar HB
- Itens do menu lateral

**Colunas de tabelas**
- Movimentos que compõem o período: Movimento / data
- Movimentos que compõem o período: Tipo
- Movimentos que compõem o período: Valor líquido
- Movimentos que compõem o período: Custo direto

**Filtros**
- Filtros herdados da visão agregada (filial Centro, relatório Vendas e margem, período 17/09/2026 a 23/09/2026)

**Indicadores / cartões / gráficos**
- Vendas brutas (R$ 5.850,00)
- Descontos (R$ 210,00)
- Devoluções (R$ 0,00)
- Vendas líquidas (R$ 5.640,00)
- Custo direto (R$ 3.700,00)
- Resultado bruto (R$ 1.940,00)

**Estados e selos**
- Tipo 'Venda' (selo cinza)
- Tipo 'Cancelada' (selo cinza)
- Valores 'Excluída' / 'Excluído' para movimento cancelado

**Itens de menu**
- PRINCIPAL (rótulo de seção)
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Relatórios (ativo)
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Vendas líquidas = Vendas brutas − Descontos − Devoluções (5.850 − 210 − 0 = 5.640)
- Resultado bruto = Vendas líquidas − Custo direto (5.640 − 3.700 = 1.940)
- Soma dos movimentos válidos confere com o agregado da filial (1.400+1.740+1.100+1.400 = 5.640; 910+1.170+720+900 = 3.700)
- Movimento cancelado (V-0211, 23/09/2026) listado, mas excluído dos totais
- Quantidade de vendas da filial no agregado (4) = movimentos do tipo Venda no detalhe (4 de 5 registros)
- Detalhe mantém os mesmos filtros e critérios da visão agregada para conciliação

**Inconsistências do protótipo**
- Rótulo 'Excluída' (feminino) na coluna 'Valor líquido' e 'Excluído' na coluna 'Custo direto' — concordância inconsistente
- Cabeçalho 'Valor líquido' aparenta alinhamento diferente dos valores (alinhados à direita)
- Título da página permanece 'Relatórios gerenciais' enquanto a página do guia nomeia a visão 'Detalhamento do resultado por filial'
- Seletor de empresa aparece esmaecido/desabilitado apenas nesta visão

### Tela 45 — Produtos e curva ABC (p. 67)

Grupo: Análise e planejamento

**Objetivo:** Classifica a participação dos produtos na receita para apoiar prioridades de gestão, destacando a concentração do resultado e os itens sem receita no recorte.

**Principais ações (comentário)**
- Definir período, filial e categoria.
- Consultar classificação e curva acumulada.
- Abrir a composição do resultado de um produto.

**Ponto de atenção**
- A classe depende do critério e do período escolhidos. Filtrar uma classe não deve alterar silenciosamente a base utilizada para calcular a participação dos produtos.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, trilha 'Relatórios / Produtos e curva ABC', seletor de empresa (Varejo Exemplo), avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Relatórios' ativo
- Título 'Produtos e curva ABC' e subtítulo 'Identifique os produtos que concentram a receita da operação.'
- Cartão de filtros: 4 campos em linha, expansor 'Critérios da classificação ABC', texto de base e botão 'Aplicar análise'
- Cabeçalho do resultado 'ABC por receita líquida' com contexto
- Cartão-resumo com três indicadores
- Faixa de alerta (fundo pêssego) sobre produtos sem classe
- Início do cartão 'Concentração da receita' com 'Referências acumuladas: A 80% · B 95%' (continua na página 68)

**Campos observados**
- Seletor de empresa no cabeçalho (select; Varejo Exemplo)
- Filial (select; 'Todas as filiais')
- Categoria (select; 'Todas as categorias')
- Data inicial (campo de data; 09/17/2026)
- Data final (campo de data; 09/23/2026)
- Texto de ajuda: 'Base demonstrativa: 10 a 23/09/2026 · datas inclusivas.'
- Título do resultado: 'ABC por receita líquida'
- Contexto: empresa · filial · categoria · período (Varejo Exemplo · Todas as filiais · Todas as categorias · 17/09/2026 a 23/09/2026)
- Alerta: '1 produto(s) sem classe somam R$ 0,00. Base positiva usada na ABC: R$ 10.225,00.'

**Botões e ações observados**
- Aplicar análise (botão primário laranja com ícone de funil)
- Expansor '▸ Critérios da classificação ABC'
- Seletor de empresa (cabeçalho)
- Avatar HB
- Itens do menu lateral

**Filtros**
- Filial (Todas as filiais)
- Categoria (Todas as categorias)
- Data inicial (17/09/2026)
- Data final (23/09/2026)

**Indicadores / cartões / gráficos**
- Receita líquida do recorte (R$ 10.225,00)
- Produtos na curva (8)
- Sem classe (1 · líquido não positivo)
- Cartão 'Concentração da receita' — Referências acumuladas: A 80% · B 95% (início)

**Estados e selos**
- Alerta informativo de produtos sem classe (fundo pêssego)
- Indicador 'Sem classe' com motivo 'líquido não positivo'

**Itens de menu**
- PRINCIPAL (rótulo de seção)
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Relatórios (ativo)
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Critério da curva: receita líquida
- Produtos com receita líquida não positiva ficam 'Sem classe' e fora da base da ABC
- Base positiva usada na ABC = soma das receitas líquidas positivas (R$ 10.225,00)
- Referências acumuladas: classe A até 80%, classe B até 95%, restante C
- Receita líquida do recorte (R$ 10.225,00) coincide com Vendas líquidas da Tela 44 no mesmo período
- Datas inclusivas; base demonstrativa de 10 a 23/09/2026

**Inconsistências do protótipo**
- Campos de data em formato MM/DD/AAAA (09/17/2026) enquanto o contexto usa DD/MM/AAAA (17/09/2026)
- Trilha 'Relatórios / Produtos e curva ABC' usa raiz diferente da Tela 44 ('Gestão / Relatórios')
- Botão de execução chama-se 'Aplicar análise' aqui e 'Aplicar filtros' na Tela 44
- Texto de ajuda 'Base demonstrativa: ...' vs. 'Base de exemplo disponível ...' na Tela 44 (sem menção ao horário de Brasília)
- Plural genérico 'produto(s)'

### Tela 45 — Produtos e curva ABC (parte 2 de 3) (p. 68)

Grupo: Análise e planejamento

**Objetivo:** Continuação: gráfico de concentração da receita (curva ABC) e início da tabela de produtos classificados. Classifica a participação dos produtos na receita para apoiar prioridades de gestão.

**Ponto de atenção**
- Parte 2 de 3 da mesma visão. A divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo. Visão principal e comentários na página 67.

**Regiões da tela**
- Menu lateral escuro (recortado)
- Cartão 'Concentração da receita' com legenda de referências à direita, gráfico de linha e legenda por classe abaixo
- Cartão 'Produtos classificados' com seletor 'Exibir' à direita e tabela

**Campos observados**
- Gráfico: eixo Y 'Receita acumulada (%)' (0%, 50%, 100%)
- Gráfico: eixo X 'Posição no ranking' (marcas 0, 3, 5, 8)
- Gráfico: pontos coloridos por classe (azul A, laranja B, cinza C)
- Legenda A (3 produtos · 85,09% da receita)
- Legenda B (2 produtos · 12,22% da receita)
- Legenda C (3 produtos · 2,69% da receita)
- Exibir (select; 'Todos')
- Produto / posição: nome do produto (link azul) + '#posição · código · categoria' (ex.: Cafeteira elétrica 15 xícaras / #1 · PRD-0101 · Eletroportáteis)
- Receita líquida (R$; ex.: 4.400,00)
- Participação (%; ex.: 43,03%)
- Acumulado (%; ex.: 43,03%)
- Classe (selo; A)

**Botões e ações observados**
- Seletor 'Exibir' (Todos)
- Link do nome do produto (abrir composição do resultado do produto): Cafeteira elétrica 15 xícaras
- Link: Ventilador de mesa 40 cm
- Link: Jogo de panelas 5 peças

**Colunas de tabelas**
- Produtos classificados: Produto / posição
- Produtos classificados: Receita líquida
- Produtos classificados: Participação
- Produtos classificados: Acumulado
- Produtos classificados: Classe

**Filtros**
- Exibir (Todos; filtra a lista por classe sem alterar a base de cálculo)

**Indicadores / cartões / gráficos**
- Gráfico de linha 'Concentração da receita' (curva acumulada por posição no ranking)
- Referências acumuladas: A 80% · B 95%
- Resumo por classe: A 3 produtos · 85,09%; B 2 produtos · 12,22%; C 3 produtos · 2,69%

**Estados e selos**
- Selo de classe A (azul)
- Selo de classe B (laranja)
- Selo de classe C (cinza)

**Regras e políticas ilustradas (exemplos)**
- Participação = receita líquida do produto / base positiva (4.400/10.225 = 43,03%; 2.600/10.225 = 25,43%; 1.700/10.225 = 16,63%)
- Acumulado = soma das participações até a posição (43,03% → 68,46% → 85,09%)
- Produto que cruza a referência de 80% permanece na classe A (#3 com acumulado 85,09% é A)
- Ranking ordenado por receita líquida decrescente
- Soma das classes = 100% (85,09 + 12,22 + 2,69)

**Inconsistências do protótipo**
- Eixo X do gráfico com marcas irregulares (0, 3, 5, 8)
- As referências de 80% e 95% não são desenhadas como linhas no gráfico, apenas informadas no texto

### Tela 45 — Produtos e curva ABC (parte 3 de 3) (p. 69)

Grupo: Análise e planejamento

**Objetivo:** Continuação da visão 'Produtos e curva ABC': fim da tabela 'Produtos classificados' (posições #4 a #8, classes B e C, e o item 'Sem classe'), rodapé com contagem, expansor 'Como interpretar esta análise' e aviso de dados demonstrativos. Contexto da página: classifica a participação dos produtos na receita para apoiar prioridades de gestão, destacando a concentração do resultado e os itens sem receita no recorte.

**Ponto de atenção**
- CONTINUAÇÃO: Parte 3 de 3 da mesma visão. A divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo.
- CONTEXTO: Classifica a participação dos produtos na receita para apoiar prioridades de gestão, destacando a concentração do resultado e os itens sem receita no recorte.
- CONSULTA: Tela 45 - Produtos e curva ABC. Visão principal e comentários na página 67.

**Regiões da tela**
- Cabeçalho da página do guia: 'TELA 45 / ANÁLISE E PLANEJAMENTO / PARTE 3 DE 3' com barra laranja, título 'Produtos e curva ABC' e link 'SUMÁRIO' à direita (navegação do documento)
- Menu lateral escuro (azul-marinho) recortado, sem itens visíveis neste trecho
- Área de conteúdo com fundo cinza-claro
- Cartão branco de bordas arredondadas com a continuação da tabela 'Produtos classificados' (cabeçalho de colunas não repetido neste trecho; topo cortado mostrando apenas a borda da linha anterior)
- Linhas de tabela em duas linhas de texto: nome do produto (link azul) e subtítulo cinza '#posição · código · categoria'; valores alinhados à direita; selo de classe à direita
- Rodapé interno do cartão com contagem de produtos e nota sobre o filtro
- Cartão separado com expansor '▸ Como interpretar esta análise' (recolhido)
- Linha de aviso com ícone de frasco de laboratório: dados demonstrativos
- Bloco de comentários do guia em três colunas: CONTINUAÇÃO, CONTEXTO, CONSULTA
- Rodapé do documento: 'INTERCERT ERP / Guia visual do MVP' e paginação '69 / 80'

**Campos observados**
- Produto (nome, link) com subtítulo 'posição · código · categoria' (ex.: Garrafa térmica 1 L / #4 · PRD-0104 · Utilidades)
- Receita líquida (R$) (ex.: R$ 900,00)
- Participação (%) (ex.: 8,8%)
- Acumulado (%) (ex.: 93,89%)
- Classe (selo: B, C ou 'Sem classe')
- Linha #4: Garrafa térmica 1 L · PRD-0104 · Utilidades · R$ 900,00 · 8,8% · 93,89% · B
- Linha #5: Toalha de banho · PRD-0105 · Utilidades · R$ 350,00 · 3,42% · 97,31% · B
- Linha #6: Pote plástico 1 L · PRD-0106 · Utilidades · R$ 150,00 · 1,47% · 98,78% · C
- Linha #7: Detergente neutro 500 ml · PRD-0087 · Limpeza · R$ 95,00 · 0,93% · 99,71% · C
- Linha #8: Esponja multiuso · PRD-0108 · Limpeza · R$ 30,00 · 0,29% · 100% · C
- Linha sem posição: Lâmpada LED 9 W · PRD-0109 · Iluminação · R$ 0,00 · — · — · Sem classe
- Rodapé da tabela: '9 de 9 produtos · o filtro da lista mantém a classificação da análise completa.'
- Aviso: 'Dados demonstrativos. A classificação desta prévia não altera compras, preços ou estoque.'

**Botões e ações observados**
- Link do produto 'Garrafa térmica 1 L' (abre o produto)
- Link do produto 'Toalha de banho'
- Link do produto 'Pote plástico 1 L'
- Link do produto 'Detergente neutro 500 ml'
- Link do produto 'Esponja multiuso'
- Link do produto 'Lâmpada LED 9 W'
- Expansor/acordeão '▸ Como interpretar esta análise' (recolhido)
- Link 'SUMÁRIO' no cabeçalho da página (navegação do guia, não da tela)

**Colunas de tabelas**
- Produtos classificados: Produto / posição (nome + '#posição · código · categoria') — cabeçalho inferido das partes anteriores
- Produtos classificados: Receita líquida
- Produtos classificados: Participação
- Produtos classificados: Acumulado
- Produtos classificados: Classe

**Filtros**
- Nenhum filtro visível neste trecho; o rodapé referencia o filtro da lista ('o filtro da lista mantém a classificação da análise completa'), cujo controle está nas partes anteriores

**Indicadores / cartões / gráficos**
- Contagem no rodapé da tabela: '9 de 9 produtos'
- Cartão 'Como interpretar esta análise' (conteúdo recolhido)

**Estados e selos**
- Selo 'B' (texto laranja sobre fundo laranja-claro) — linhas #4 e #5
- Selo 'C' (texto cinza sobre fundo cinza-claro) — linhas #6, #7 e #8
- Selo 'Sem classe' (texto cinza em negrito sobre fundo cinza-claro) — Lâmpada LED 9 W
- Traço '—' em Participação e Acumulado para o produto sem classe
- Ausência de '#posição' no subtítulo do produto sem classe
- Ícone de frasco no aviso de dados demonstrativos

**Regras e políticas ilustradas (exemplos)**
- Ranking por receita líquida decrescente com posição '#n' (#4 a #8 neste trecho)
- Participação = receita líquida do produto / receita total da curva; total implícito R$ 10.225,00 (ex.: 900/10.225 = 8,80%; 350/10.225 = 3,42%; 150/10.225 = 1,47%; 95/10.225 = 0,93%; 30/10.225 = 0,29%)
- Acumulado = soma das participações até a posição; antes de #4 o acumulado implícito é 85,09% (R$ 8.700,00 nas posições #1 a #3)
- O item que cruza a referência de 95% permanece na classe B: #5 tem acumulado 97,31%, mas o acumulado anterior era 93,89% (< 95%), então fica B
- Depois disso, os itens são classe C até 100% (#6, #7, #8)
- O último item classificado fecha em 100% de acumulado
- Produto com receita líquida zero (R$ 0,00) fica 'Sem classe': sem posição no ranking, sem participação nem acumulado (—), listado depois dos classificados
- Contagem total = 8 produtos na curva + 1 sem classe = 9 produtos
- Filtrar a lista não recalcula a curva: a classificação continua sendo a da análise completa
- A prévia é demonstrativa e não altera compras, preços ou estoque

**Inconsistências do protótipo**
- Participação '8,8%' com uma casa decimal, enquanto as demais usam duas (ex.: 3,42%); o esperado seria '8,80%' (900/10.225 = 8,80%)
- Acumulado '100%' sem casas decimais, enquanto os demais usam duas (esperado '100,00%')
- Código PRD-0087 (Detergente neutro 500 ml) fora da sequência dos demais (PRD-0104 a PRD-0109; o esperado seria PRD-0107); é apenas uma observação sobre os dados de exemplo
- O cabeçalho das colunas não se repete nesta parte; os nomes das colunas dependem da parte 2

