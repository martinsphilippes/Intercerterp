# Telas do PDF — produtos-estoque

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

### Tela 15 — Lista de produtos (p. 19)

Grupo: Produtos e estoque

**Objetivo:** Centraliza a consulta do catálogo, conectando identificação, preços e posição de estoque com o acesso ao cadastro detalhado de cada produto.

**Principais ações (comentário)**
- Pesquisar e filtrar mercadorias.
- Consultar resumo e estoque por filial.
- Acessar cadastro, importação e exportação.

**Ponto de atenção**
- Distinguir produto, variação, unidade de venda e código de barras.
- Os saldos devem indicar claramente a filial a que se referem.

**Regiões da tela**
- Cabeçalho da página do guia (fora do protótipo): 'TELA 15 / PRODUTOS E ESTOQUE', link 'SUMÁRIO' e título 'Lista de produtos'; rodapé 'INTERCERT ERP / Guia visual do MVP' e '19 / 80'
- Menu lateral escuro fixo: logo laranja 'I', 'Intercert ERP' / 'Gestão inteligente', itens com ícones e rodapé 'Intercert Soluções • v1.0'
- Cabeçalho superior branco: 'Loja Modelo — Matriz' (negrito) / 'Estoque da unidade selecionada', avatar circular 'HB'
- Área de título: 'Produtos' + subtítulo 'Gerencie cadastro, preços, estoque, variações e tributação dos produtos.' + grupo de 3 botões à direita (Importar, Exportar, + Novo produto)
- Faixa de 4 cartões de indicadores
- Cartão de filtros: busca com lupa + 3 selects + 'Mais filtros'
- Cartão de tabela 'Catálogo de produtos' com contador '6 produtos exibidos', ícone por produto, linhas com duas linhas de texto e chevron de expansão
- Rodapé da tabela: 'Mostrando 1–6 de 1.284 produtos' e paginação

**Campos observados**
- Busca (texto) — placeholder 'Produto, código, referência, GTIN ou N[CM]' (truncado) com ícone de lupa
- Categoria (select) — 'Todas as cate[gorias]' (truncado)
- Situação de estoque (select) — 'Qualquer est[oque]' (truncado)
- Status (select) — 'Todos os stat[us]' (truncado)
- Contexto do cabeçalho: unidade 'Loja Modelo — Matriz'
- Contexto do cabeçalho: 'Estoque da unidade selecionada'
- Usuário logado: avatar 'HB'
- Linha do produto: ícone/miniatura do produto
- Linha do produto: nome ('Camiseta básica masculina', 'Tênis casual Urban', 'Cinto sintético clássico', 'Sandália Comfort', 'Fone Bluetooth Wave', 'Boné promocional')
- Linha do produto: código interno/referência ('CM-001', 'TN-142', 'CT-020', 'SD-077', 'EL-101', 'BN-009')
- Linha do produto: GTIN ('GTIN 7891000000011' … ou 'Sem GTIN')
- Linha do produto: quantidade de variações ('6 variações', '10 variações', '4 variações', '8 variações', '2 variações') ou 'Produto simples'
- Linha do produto: categoria ('Roupas', 'Calçados', 'Acessórios', 'Eletrônicos')
- Linha do produto: subcategoria/linha/marca sem rótulo ('Essencial', 'Urban', 'Classic', 'Promocional')
- Linha do produto: saldo em estoque ('18 un.', '4 un.', '22 un.', '0 un.', '9 un.', '35 un.')
- Linha do produto: estoque mínimo ('Mínimo: 8', 'Mínimo: 6', 'Mínimo: 10', 'Mínimo: 5', 'Mínimo: 4', 'Mínimo: 10')
- Linha do produto: preço de venda ('R$ 89,90', 'R$ 219,90', 'R$ 34,90', 'R$ 129,90', 'R$ 159,90', 'R$ 29,90')
- Linha do produto: custo ('Custo R$ 42,00', 'Custo R$ 108,00', 'Custo R$ 14,50', 'Custo R$ 61,00', 'Custo R$ 78,00', 'Custo R$ 11,00')
- Linha do produto: situação fiscal ('Configurado', 'Revisar', 'Incompleto')
- Linha do produto: NCM ('NCM 6109.10.00', 'NCM 6404.19.00', 'NCM 4203.30.00', 'NCM 6402.99.90') ou pendência ('CEST pendente', 'NCM pendente')
- Linha do produto: status (selo 'Ativo'/'Inativo')

**Botões e ações observados**
- Importar (botão secundário com ícone de upload)
- Exportar (botão secundário com ícone de download)
- + Novo produto (botão primário laranja)
- Mais filtros
- Abrir select Categoria (seta ⌄)
- Abrir select Estoque (seta ⌄)
- Abrir select Status (seta ⌄)
- Chevron de expansão (⌄) em cada uma das 6 linhas
- Paginação: ‹ (anterior)
- Paginação: 1 (página ativa, fundo azul)
- Paginação: 2
- Paginação: 3
- Paginação: › (próxima)
- Itens do menu lateral (navegação)
- Avatar 'HB' (menu do usuário)
- Link 'SUMÁRIO' do guia (navegação do documento)

**Colunas de tabelas**
- Catálogo de produtos: ícone do produto (camiseta, pegadas para calçados, cubo/caixa para cinto, fone de ouvido, círculo cortado para o boné)
- Catálogo de produtos: Produto (nome + 'código • GTIN • N variações', ex. 'CM-001 • GTIN 7891000000011 • 6 variações' ou 'BN-009 • Sem GTIN • Produto simples')
- Catálogo de produtos: Categoria (categoria + sublinha, ex. 'Roupas'/'Essencial', 'Calçados'/'Urban', 'Acessórios'/'Classic', 'Eletrônicos'/'Urban', 'Acessórios'/'Promocional')
- Catálogo de produtos: Estoque (quantidade em negrito 'N un.' + 'Mínimo: N')
- Catálogo de produtos: Preço (preço de venda em negrito + 'Custo R$ …')
- Catálogo de produtos: Fiscal (situação colorida + 'NCM 6109.10.00' / 'CEST pendente' / 'NCM pendente')
- Catálogo de produtos: Status (selo)
- Catálogo de produtos: coluna sem título com chevron de expansão
- Rodapé: 'Mostrando 1–6 de 1.284 produtos'
- Linhas de exemplo: Camiseta básica masculina — CM-001, GTIN 7891000000011, 6 variações; Roupas/Essencial; 18 un. (Mín. 8); R$ 89,90 (Custo R$ 42,00); Configurado NCM 6109.10.00; Ativo
- Tênis casual Urban — TN-142, GTIN 7891000000028, 10 variações; Calçados/Urban; 4 un. laranja (Mín. 6); R$ 219,90 (Custo R$ 108,00); Configurado NCM 6404.19.00; Ativo
- Cinto sintético clássico — CT-020, GTIN 7891000000035, 4 variações; Acessórios/Classic; 22 un. (Mín. 10); R$ 34,90 (Custo R$ 14,50); Configurado NCM 4203.30.00; Ativo
- Sandália Comfort — SD-077, GTIN 7891000000042, 8 variações; Calçados/Urban; 0 un. vermelho (Mín. 5); R$ 129,90 (Custo R$ 61,00); Configurado NCM 6402.99.90; Ativo
- Fone Bluetooth Wave — EL-101, GTIN 7891000000059, 2 variações; Eletrônicos/Urban; 9 un. (Mín. 4); R$ 159,90 (Custo R$ 78,00); Revisar / CEST pendente; Ativo
- Boné promocional — BN-009, Sem GTIN, Produto simples; Acessórios/Promocional; 35 un. (Mín. 10); R$ 29,90 (Custo R$ 11,00); Incompleto / NCM pendente; Inativo

**Filtros**
- Busca por produto, código, referência, GTIN ou NCM
- Categoria: 'Todas as categorias'
- Estoque: 'Qualquer estoque'
- Status: 'Todos os status'
- 'Mais filtros' (filtros avançados não exibidos)

**Indicadores / cartões / gráficos**
- Produtos ativos (1.284) — sublinha '2.946 variações'
- Valor em estoque (R$ 186.420) — sublinha 'Custo médio atual'
- Estoque baixo (24, valor em laranja) — sublinha 'Abaixo do mínimo'
- Sem estoque (8, valor em vermelho) — sublinha 'Reposição necessária'
- Cartão-tabela 'Catálogo de produtos' com contador '6 produtos exibidos'

**Estados e selos**
- Status: Ativo (selo verde-claro com texto verde)
- Status: Inativo (selo cinza)
- Fiscal: Configurado (texto verde)
- Fiscal: Revisar (texto laranja — 'CEST pendente')
- Fiscal: Incompleto (texto laranja — 'NCM pendente')
- Estoque: quantidade em laranja quando abaixo do mínimo ('4 un.', Mínimo 6)
- Estoque: quantidade em vermelho quando zerado ('0 un.')
- Estoque: quantidade em preto quando acima do mínimo
- Tipo: 'Produto simples' vs. 'N variações'
- Código de barras: 'Sem GTIN'
- KPI 'Estoque baixo' em laranja e 'Sem estoque' em vermelho
- Página ativa '1' (azul)

**Itens de menu**
- Painel (ícone de grade)
- Vendas e PDV (ícone de carrinho)
- Produtos e estoque (ícone de cubo — ativo, fundo destacado e barra laranja à esquerda)
- Clientes e CRM (ícone de pessoas)
- Financeiro (ícone de banco)
- Fiscal (ícone de documento)
- Relatórios (ícone de gráfico)

**Regras e políticas ilustradas (exemplos)**
- Estoque baixo = saldo abaixo do mínimo (4 un. < Mínimo 6 → laranja; 24 produtos)
- Sem estoque = saldo 0 (vermelho, 'Reposição necessária'; 8 produtos)
- Valor em estoque calculado pelo custo médio atual (R$ 186.420)
- Saldo exibido é o da unidade selecionada (Matriz) — 'Estoque da unidade selecionada'
- Produtos com grade mostram saldo e mínimo agregados no nível do produto pai (ex.: 18 un. somando 6 variações)
- Situação fiscal derivada do preenchimento: NCM e CEST ok → 'Configurado'; CEST faltando → 'Revisar'; NCM faltando → 'Incompleto'
- Produto pode ter variações (grade) ou ser 'Produto simples'
- GTIN opcional ('Sem GTIN')
- Código interno com prefixo por tipo de produto + número (CM-, TN-, CT-, SD-, EL-, BN-)
- Produto inativo continua listado (filtro 'Todos os status') e pode manter saldo (Boné 35 un.)
- Contagem de variações separada da contagem de produtos (1.284 produtos / 2.946 variações)
- Paginação de 6 itens por página
- Busca abrange nome, código, referência, GTIN e NCM

**Inconsistências do protótipo**
- 'Produtos ativos' = 1.284, que é o mesmo total da lista ('Mostrando 1–6 de 1.284 produtos') com filtro 'Todos os status', mas a lista inclui um produto 'Inativo' (Boné promocional)
- Paginação mostra só 3 páginas para 1.284 produtos com 6 por página (seriam 214)
- Coluna Preço mostra 'Custo R$ 42,00' para a Camiseta (R$ 89,90), mas o cadastro (tela 16, detalhe 'custos e preços', p. 22) mostra custo de aquisição 42,00 + outros custos 3,50 = custo total R$ 45,50 — não fica claro qual custo a lista exibe; 'Valor em estoque' usa ainda um terceiro conceito ('Custo médio atual')
- Ponto de atenção exige indicar a filial dos saldos, mas não há seletor de filial na tela nem coluna/rótulo de filial na tabela — só o texto do cabeçalho 'Estoque da unidade selecionada'; a ação 'Consultar estoque por filial' não tem controle visível
- Ponto de atenção cita 'unidade de venda', mas não há coluna/campo de unidade (todas as quantidades aparecem só como 'un.')
- Saldo e mínimo de produtos com variações aparecem agregados (ex.: Camiseta 18 un., Mínimo 8, 6 variações) — uma variação pode estar zerada sem o produto aparecer em 'Estoque baixo'/'Sem estoque'; não fica claro se o mínimo é por produto ou por variação
- Não fica claro se 'Estoque baixo' (24) inclui os 8 'Sem estoque' (saldo 0 também está abaixo do mínimo)
- Sublinha da coluna Categoria não tem rótulo e mistura conceitos: 'Urban' aparece para Tênis casual Urban, Sandália Comfort e Fone Bluetooth (marca? linha?), enquanto 'Promocional' e 'Essencial' parecem coleção/linha
- Ícone do Boné promocional é um círculo cortado (sugere inativo/bloqueado) em vez de ícone de categoria; Cinto usa ícone genérico de caixa — ícones misturam categoria e status
- NCM 4203.30.00 (cintos de couro natural ou reconstituído) atribuído ao 'Cinto sintético clássico' — classificação incompatível com material sintético, mas exibido como 'Configurado'
- GTINs de exemplo têm dígito verificador EAN-13 inválido (7891000000011 deveria terminar em 4; …028 → 1; …035 → 8; …042 → 5; …059 → 2) — validação real rejeitaria
- Placeholder da busca e rótulos dos selects truncados ('GTIN ou N', 'Todas as cate', 'Qualquer est', 'Todos os stat')
- A tabela mostra um único preço por produto com variações — não indica se as variações podem ter preços diferentes nem exibe margem
- Esta tela usa menu lateral, enquanto o cadastro de produto (tela 16) usa apenas barra superior escura sem menu lateral

### Tela 16 — Cadastro de produto (p. 20)

Grupo: Produtos e estoque

**Objetivo:** Define a base comercial e operacional da mercadoria. Organiza identificação, variações, preços, estoque e dados fiscais em áreas específicas.

**Principais ações (comentário)**
- Preencher identificação e características.
- Cadastrar variações, custos e tabelas de preço.
- Configurar estoque e informações fiscais.

**Ponto de atenção**
- Padronizar campos obrigatórios, unidades e arredondamentos.
- A parametrização fiscal deve ser validada para o contexto da empresa; os exemplos da tela não são uma regra tributária universal.

**Regiões da tela**
- Barra superior escura: logo + 'Intercert ERP' / 'Cadastro de produtos', centro 'Loja Modelo — Matriz', avatar 'HB'
- Breadcrumb 'Produtos e estoque / Produtos / Novo produto'
- Título 'Novo produto' + subtítulo 'Preencha os dados comerciais, estoque e informações fiscais.' + botões de salvar
- Barra de progresso segmentada em 5 partes (1 preenchida)
- Painel com abas
- Aba Dados gerais: seção 'Identificação do produto' com área de imagem à esquerda e grade de campos à direita; faixa de checkboxes no rodapé

**Campos observados**
- Imagem principal (upload, 'JPG ou PNG', link 'Selecionar imagem')
- Nome do produto * (texto, obrigatório — 'Camiseta básica masculina')
- Tipo (select — 'Produto para revenda')
- Código interno * (texto, obrigatório — 'CM-001')
- GTIN / EAN (texto — '7891000000011')
- Unidade (select — 'UN — Unidade')
- Categoria (select — 'Roupas')
- Marca (select — 'Essencial')
- Fornecedor principal (select — 'Confecções Nordeste Ltda.')
- Descrição (textarea — 'Camiseta masculina em algodão, modelagem regular e acabamento reforçado.')
- Produto ativo (checkbox marcado)
- Disponível no PDV (checkbox marcado)
- Vender na loja virtual (checkbox desmarcado)

**Botões e ações observados**
- Salvar rascunho (botão secundário)
- Salvar produto (botão primário laranja)
- Selecionar imagem (link na área de upload)
- Abas: Dados gerais, Variações, Preços, Estoque, Fiscal
- Links do breadcrumb
- Avatar HB

**Abas / etapas**
- Dados gerais (ativa, sublinhado laranja)
- Variações
- Preços
- Estoque
- Fiscal

**Indicadores / cartões / gráficos**
- Barra de progresso em 5 etapas (1/5 preenchida)
- Cartão de upload 'Imagem principal'

**Estados e selos**
- Asterisco vermelho em campos obrigatórios
- Checkboxes de disponibilidade por canal (ativo, PDV, loja virtual)

**Regras e políticas ilustradas (exemplos)**
- Obrigatórios: Nome do produto e Código interno
- GTIN/EAN opcional (a lista admite 'Sem GTIN')
- Imagem principal aceita JPG ou PNG
- Disponibilidade por canal controlada individualmente (PDV, loja virtual)
- Possibilidade de salvar rascunho antes de concluir
- Cadastro dividido em 5 áreas: Dados gerais, Variações, Preços, Estoque, Fiscal

**Inconsistências do protótipo**
- Tela 'Novo produto' preenchida com o mesmo Código interno 'CM-001' e GTIN de um produto já existente na lista (tela 15) — conflito de unicidade não tratado
- Abas 'Variações' e 'Estoque' não têm visão ilustrada no guia
- Na aba Dados gerais a barra de progresso tem 1/5 preenchido; nas visões complementares, Preços mostra 3/5 e Fiscal 5/5 — parece indicar a posição da aba, não o preenchimento
- Sem menu lateral (só barra superior), diferente da Lista de produtos

### Tela 16 — Cadastro de produto (p. 21)

_Visão complementar: Cadastro do produto - dados fiscais_

Grupo: Produtos e estoque

**Objetivo:** Classificação e parâmetros fiscais ficam em uma área própria, separada da identificação comercial.

**Ponto de atenção**
- Comentário: Conferir consistência de NCM, origem e grupo tributário antes de liberar o uso em emissão.
- Ligação com a tela: Esta visão complementa a Tela 16: Cadastro de produto. Consulte a página 20 para a visão principal e os comentários gerais.

**Regiões da tela**
- Barra superior escura: 'Intercert ERP' / 'Cadastro de produtos', 'Loja Modelo — Matriz', avatar 'HB'
- Breadcrumb 'Produtos e estoque / Produtos / Novo produto'
- Título 'Novo produto' + subtítulo + botões Salvar rascunho / Salvar produto
- Barra de progresso em 5 segmentos (todos preenchidos)
- Painel com abas (Fiscal ativa)
- Seção 'Tributação do produto' com dois cartões lado a lado: 'Classificação fiscal' e 'Regras tributárias'
- Alerta laranja no rodapé da seção

**Campos observados**
- NCM * (texto, obrigatório — '6109.10.00')
- CEST (texto com máscara — placeholder '00.000.00')
- Origem da mercadoria (select — '0 — Nacional')
- Grupo tributário (select — 'Revenda — Simples Nacional')
- CFOP padrão (texto — '5102')
- CSOSN (select — '102 — Sem permissão de crédito')

**Botões e ações observados**
- Salvar rascunho
- Salvar produto (primário)
- Abas: Dados gerais, Variações, Preços, Estoque, Fiscal
- Links do breadcrumb

**Abas / etapas**
- Dados gerais
- Variações
- Preços
- Estoque
- Fiscal (ativa, sublinhado laranja)

**Indicadores / cartões / gráficos**
- Cartão 'Classificação fiscal' (NCM, CEST, Origem da mercadoria)
- Cartão 'Regras tributárias' (Grupo tributário, CFOP padrão, CSOSN)
- Alerta: 'A configuração tributária deve ser validada pelo contador antes da emissão em produção.'

**Estados e selos**
- Asterisco vermelho no NCM (obrigatório)
- Barra de progresso 5/5

**Regras e políticas ilustradas (exemplos)**
- NCM obrigatório (sem NCM o produto fica 'Incompleto — NCM pendente' na lista)
- CEST com máscara 00.000.00 (ausência gera 'Revisar — CEST pendente' em produtos sujeitos)
- Grupo tributário define o regime (ex.: 'Revenda — Simples Nacional')
- CFOP padrão de venda (ex.: 5102) e CSOSN para Simples Nacional (ex.: 102 — sem permissão de crédito)
- Configuração tributária validada pelo contador antes de emitir em produção
- Valores de exemplo não são regra tributária universal

**Inconsistências do protótipo**
- CFOP padrão é campo de texto livre enquanto Origem e CSOSN são selects — sem validação de lista
- Barra de progresso totalmente preenchida na aba Fiscal, embora o produto seja novo e o CEST esteja vazio
- Título do slide 'Cadastro do produto' vs. 'Cadastro de produto' na tela principal

### Tela 16 — Cadastro de produto (p. 22)

_Visão complementar: Cadastro do produto - custos e preços_

Grupo: Produtos e estoque

**Objetivo:** O cadastro permite distinguir custo, preço de venda e condições da tabela de atacado.

**Ponto de atenção**
- Comentário: Definir cálculo de margem, vigência e limites para alterações de preço.
- Ligação com a tela: Esta visão complementa a Tela 16: Cadastro de produto. Consulte a página 20 para a visão principal e os comentários gerais.

**Regiões da tela**
- Barra superior escura: 'Intercert ERP' / 'Cadastro de produtos', 'Loja Modelo — Matriz', avatar 'HB'
- Breadcrumb 'Produtos e estoque / Produtos / Novo produto'
- Título 'Novo produto' + subtítulo + botões Salvar rascunho / Salvar produto
- Barra de progresso em 5 segmentos (3 preenchidos)
- Painel com abas (Preços ativa)
- Seção 'Custos e tabelas de preço' com três cartões lado a lado: 'Custos', 'Tabela padrão', 'Atacado'

**Campos observados**
- Custos — Custo de aquisição (numérico — '42.00')
- Custos — Outros custos (numérico — '3.50')
- Custos — Custo total (calculado — 'R$ 45,50')
- Tabela padrão — Preço de venda (numérico — '89.90')
- Tabela padrão — Desconto máximo (numérico — '10')
- Tabela padrão — Margem estimada (calculado — '49,4%')
- Atacado — Preço de venda (numérico — '74.90')
- Atacado — Quantidade mínima (numérico — '10')
- Atacado — Margem estimada (calculado — '39,3%')

**Botões e ações observados**
- Salvar rascunho
- Salvar produto (primário)
- Abas: Dados gerais, Variações, Preços, Estoque, Fiscal
- Links do breadcrumb

**Abas / etapas**
- Dados gerais
- Variações
- Preços (ativa, sublinhado laranja)
- Estoque
- Fiscal

**Indicadores / cartões / gráficos**
- Cartão 'Custos' com rodapé 'Custo total: R$ 45,50' (verde)
- Cartão 'Tabela padrão' com rodapé 'Margem estimada: 49,4%' (verde)
- Cartão 'Atacado' com rodapé 'Margem estimada: 39,3%' (verde)

**Estados e selos**
- Barra de progresso 3/5
- Valores calculados em verde

**Regras e políticas ilustradas (exemplos)**
- Custo total = Custo de aquisição + Outros custos (R$ 42,00 + R$ 3,50 = R$ 45,50)
- Margem estimada = (Preço de venda − Custo total) / Preço de venda (Padrão: (89,90 − 45,50) / 89,90 = 49,4%; Atacado: (74,90 − 45,50) / 74,90 = 39,3%)
- Tabela de atacado aplica preço diferenciado a partir de uma quantidade mínima (10)
- Tabela padrão limita o desconto máximo (10)
- Múltiplas tabelas de preço por produto (Padrão, Atacado)

**Inconsistências do protótipo**
- 'Desconto máximo' = 10 sem unidade (% ou R$)
- Inputs com ponto decimal ('42.00', '89.90') e resultados com vírgula ('R$ 45,50', '49,4%')
- Lista de produtos (tela 15) mostra 'Custo R$ 42,00' (só aquisição) enquanto aqui o custo total é R$ 45,50
- Não há campos de vigência nem limites de alteração de preço, citados no comentário
- Margem calculada sobre o preço de venda e não sobre o custo (markup) — base de cálculo não identificada na tela

### Tela 17 — Movimentação de estoque (p. 23)

Grupo: Produtos e estoque

**Objetivo:** Permite registrar movimentos avulsos e consultar o histórico do produto, distinguindo entradas, saídas, ajustes, perdas e transferências.

**Principais ações (comentário)**
- Escolher a natureza da movimentação.
- Informar produto, quantidade e motivo.
- Confirmar e consultar o histórico do item.

**Ponto de atenção**
- O saldo resulta de movimentos rastreáveis. Ajustes e perdas precisam de justificativa e permissão, evitando alterações silenciosas no estoque.

**Regiões da tela**
- Barra superior global (azul-escuro): logotipo 'I' laranja, 'Intercert ERP' + subtítulo 'Movimentação de estoque', contexto central 'Loja Modelo — Matriz', avatar 'HB' à direita
- Cabeçalho da página: título 'Movimentar estoque' + subtítulo 'Registre entradas, saídas, perdas, ajustes ou transferências entre filiais.'; à direita indicador 'Saldo atual na Matriz' (18 unidades)
- Painel esquerdo 'Nova movimentação' (formulário): cartão do produto selecionado, grade de botões de tipo, campos, bloco de resumo de saldo e botão principal
- Painel direito 'Histórico do produto': filtros no topo, tabela de movimentos
- Faixa de 3 cartões de saldo por local abaixo do histórico (Matriz, Filial Crato, Em trânsito)
- Sem menu lateral visível

**Campos observados**
- Produto selecionado (cartão somente leitura com ícone: nome + variação 'Camiseta básica masculina — Azul / M'; linha 'SKU CM-001-AZ-M • Local A-02-03 • Custo R$ 42,00')
- Tipo de movimentação (seletor por botões-cartão: Entrada, Saída, Ajuste, Perda, Transferência; um selecionado por vez)
- Motivo (select; ex.: 'Entrada avulsa')
- Quantidade (numérico; ex.: 10)
- Custo unitário (decimal; ex.: 42.00)
- Lote (texto; ex.: LT-0926-A)
- Validade (data com seletor de calendário; ex.: 09/21/2027)
- Documento de referência (texto; placeholder 'NF-e, pedido, OS ou documento i[nterno]')
- Observações (área de texto; placeholder 'Detalhes adicionais para auditoria')
- Saldo anterior (calculado, somente leitura; ex.: 18 un.)
- Movimentação (calculado, com sinal; ex.: + 10 un.)
- Novo saldo estimado (calculado, destaque; ex.: 28 un.)
- Saldo atual na Matriz (indicador no cabeçalho; ex.: 18 unidades)

**Botões e ações observados**
- Botão de tipo 'Entrada' (ícone caixa com +; selecionado com borda laranja)
- Botão de tipo 'Saída' (ícone caixa)
- Botão de tipo 'Ajuste' (ícone controles deslizantes)
- Botão de tipo 'Perda' (ícone lixeira)
- Botão de tipo 'Transferência' (ícone setas ⇆)
- Dropdown 'Motivo'
- Ícone de calendário no campo Validade
- Botão principal laranja 'Confirmar movimentação'
- Dropdown de filtro 'Todos os tipos'
- Dropdown de filtro de período 'Últimos 30 dias'
- Avatar do usuário 'HB' (menu do usuário)

**Colunas de tabelas**
- Histórico do produto: Data (dd/mm hh:mm)
- Histórico do produto: Tipo (selo)
- Histórico do produto: Motivo / documento (descrição + nº do documento em segunda linha, ex.: 'Venda #10483' / 'NFC-e 000001482')
- Histórico do produto: Usuário
- Histórico do produto: Quantidade (com sinal + verde / − vermelho)
- Histórico do produto: Saldo (após o movimento)

**Filtros**
- Tipo de movimento (select: 'Todos os tipos')
- Período (select: 'Últimos 30 dias')

**Indicadores / cartões / gráficos**
- Saldo atual na Matriz (18 unidades)
- Cartão Matriz (18 un.; 'Disponível: 18')
- Cartão Filial Crato (7 un.; 'Disponível: 5')
- Cartão Em trânsito (4 un.; 'Previsão: 22/09')
- Bloco de resumo: Saldo anterior (18 un.) / Movimentação (+ 10 un.) / Novo saldo estimado (28 un.)

**Estados e selos**
- Selo 'Saída' (vermelho claro)
- Selo 'Entrada' (verde claro)
- Selo 'Transferência' (azul claro)
- Quantidade negativa em vermelho (ex.: − 2) e positiva em verde (ex.: + 20)
- Botão de tipo ativo destacado com borda/fundo laranja

**Regras e políticas ilustradas (exemplos)**
- Novo saldo estimado = saldo anterior ± quantidade da movimentação (18 + 10 = 28 un. para Entrada)
- Histórico mantém saldo corrente após cada movimento (15/09 +6 → 6; 17/09 −1 → 5; 18/09 −5 → 0; 20/09 +20 → 20; 21/09 −2 → 18)
- Saldo físico e saldo disponível são distintos por local (Filial Crato 7 un. com Disponível 5 — sugere reserva/compromisso)
- Mercadoria em trânsito é controlada separadamente, com data de previsão de chegada (4 un., previsão 22/09)
- Cada movimento registra usuário e documento de origem (Venda/NFC-e, Compra/NF-e, Transferência TR-xxxxx, Ajuste INV-xxxx)
- Entrada exige custo unitário, lote e validade (rastreabilidade por lote)
- Observações descritas como 'para auditoria'

**Inconsistências do protótipo**
- Custo unitário exibido como '42.00' (ponto decimal) enquanto o cartão do produto mostra 'R$ 42,00' (vírgula)
- Validade em formato MM/DD/AAAA (09/21/2027) enquanto o histórico usa DD/MM
- 'Ajuste de inventário INV-2026-09' aparece com Tipo 'Entrada', embora exista o tipo específico 'Ajuste'
- Código do inventário 'INV-2026-09' difere do padrão 'INV-2026-009' usado na Tela 19
- Transferência TR-00042 consta em 18/09 11:25 no histórico, mas na Tela 18 a mesma TR-00042 está datada de 21/09/2026 14:35
- Histórico mostra −5 un. transferidas para Filial Crato (TR-00042), mas o cartão 'Em trânsito' mostra 4 un.
- Não há campo/ação visível para trocar o produto selecionado (produto chega pré-definido)

### Tela 18 — Transferência entre filiais (p. 24)

Grupo: Produtos e estoque

**Objetivo:** Organiza a movimentação de mercadorias de uma unidade para outra, com identificação dos itens e acompanhamento do andamento da transferência.

**Principais ações (comentário)**
- Definir origem, destino e produtos.
- Revisar quantidades e o resumo da transferência.
- Acompanhar transferências recentes.

**Ponto de atenção**
- Saída da origem e recebimento no destino são momentos distintos. A especificação deverá contemplar mercadoria em trânsito, divergências e documentação necessária.

**Regiões da tela**
- Barra superior global: 'Intercert ERP' + subtítulo 'Transferência entre filiais', contexto 'Loja Modelo — Matriz', avatar 'HB'
- Cabeçalho: título 'Transferência de estoque' + subtítulo 'Movimente produtos entre filiais com rastreabilidade da saída até o recebimento.' e botão '+ Nova transferência'
- Faixa origem → destino: cartão 'Filial de origem', botão circular com seta →, cartão 'Filial de destino'
- Painel 'Produtos da transferência' (esquerda) com busca, tabela de itens e linha tracejada '+ Adicionar outro produto'
- Painel lateral 'Resumo da transferência' (direita) com totais, campos de envio e botão de confirmação
- Painel inferior 'Transferências recentes' com filtro de status e tabela

**Campos observados**
- Filial de origem (select; ex.: 'Loja Modelo — Matriz'; texto auxiliar '1.248 itens disponíveis')
- Filial de destino (select; ex.: 'Filial Crato'; texto auxiliar 'Responsável: Lando')
- Busca de produto (texto com lupa; placeholder 'Buscar produto, SKU ou cód[igo]')
- Quantidade por item (input numérico na linha; ex.: 5, 3, 2)
- Produtos diferentes (calculado; ex.: 3)
- Total de unidades (calculado; ex.: 10)
- Origem (resumo; ex.: Matriz)
- Destino (resumo; ex.: Filial Crato)
- Valor de custo (calculado, destaque; ex.: R$ 712,00)
- Responsável pelo envio (select; ex.: Hércules Benevides)
- Previsão de chegada (data com calendário; ex.: 09/22/2026)
- Documento de referência (texto; ex.: TR-00043)
- Observações (área de texto; placeholder 'Informações para conferência no destino')

**Botões e ações observados**
- Botão laranja '+ Nova transferência'
- Dropdown 'Filial de origem'
- Botão circular com seta → entre origem e destino (indicador de direção/inverter)
- Dropdown 'Filial de destino'
- Campo de busca de produto
- Ícone X em cada linha (remover produto da transferência)
- Botão tracejado '+ Adicionar outro produto'
- Dropdown 'Responsável pelo envio'
- Ícone de calendário 'Previsão de chegada'
- Botão principal laranja 'Confirmar e enviar transferência'
- Dropdown 'Todos os status' (transferências recentes)
- Link no código da transferência (ex.: TR-00042)
- Ação 'Visualizar' (ícone olho) por transferência
- Ação 'Imprimir' (ícone impressora) por transferência
- Avatar 'HB'

**Colunas de tabelas**
- Produtos da transferência: Produto (ícone + nome + variação • SKU, ex.: 'Azul / M • SKU CM-001-AZ-M')
- Produtos da transferência: Estoque origem
- Produtos da transferência: Quantidade (editável)
- Produtos da transferência: Saldo após
- Produtos da transferência: [remover X]
- Transferências recentes: Código
- Transferências recentes: Data (dd/mm/aaaa + hora)
- Transferências recentes: Origem → destino
- Transferências recentes: Itens (N produtos + N unidades)
- Transferências recentes: Responsável
- Transferências recentes: Status
- Transferências recentes: Ações

**Filtros**
- Busca 'Buscar produto, SKU ou cód[igo]' (para adicionar itens)
- Status das transferências recentes (select: 'Todos os status')

**Indicadores / cartões / gráficos**
- Resumo da transferência: Produtos diferentes (3)
- Resumo da transferência: Total de unidades (10)
- Resumo da transferência: Origem (Matriz) / Destino (Filial Crato)
- Resumo da transferência: Valor de custo (R$ 712,00)
- Cartão de origem com contagem de itens disponíveis (1.248 itens disponíveis)
- Cartão de destino com responsável da filial (Lando)

**Estados e selos**
- Selo 'Em trânsito' (laranja)
- Selo 'Recebida' (verde)
- Selo 'Aguardando envio' (azul)
- Estoque origem e saldo após em laranja quando baixo (Tênis: 4 un. → 2 un.)

**Regras e políticas ilustradas (exemplos)**
- Saldo após = estoque origem − quantidade transferida (18 − 5 = 13; 11 − 3 = 8; 4 − 2 = 2)
- Total de unidades = soma das quantidades (5 + 3 + 2 = 10); Produtos diferentes = nº de linhas (3)
- Valor de custo da transferência calculado pelo custo dos itens (R$ 712,00)
- Código da transferência sequencial sugerido automaticamente (TR-00043 após TR-00042)
- Destaque visual de estoque baixo/crítico na origem (laranja)
- Ciclo de status da transferência: Aguardando envio → Em trânsito → Recebida
- Origem e destino podem ser lojas ou CD (ex.: 'CD → Matriz')
- Filial de destino possui responsável (Lando) para conferência no recebimento

**Inconsistências do protótipo**
- TR-00042 está datada de 21/09/2026 14:35 nesta tela, mas aparece em 18/09 11:25 no histórico da Tela 17
- TR-00042 (Matriz → Filial Crato) consta como 'Em trânsito' com 18 unidades, enquanto a Tela 17 mostra apenas 4 un. em trânsito para a camiseta que teve −5 un. nessa transferência
- Previsão de chegada em formato MM/DD/AAAA (09/22/2026), enquanto a tabela usa DD/MM/AAAA
- Resumo mostra 'Origem: Matriz' e o seletor 'Loja Modelo — Matriz' (nomenclatura da unidade não padronizada)

### Tela 19 — Inventário e contagem (p. 25)

Grupo: Produtos e estoque

**Objetivo:** Compara a contagem física com o saldo do sistema e apresenta as diferenças antes da conclusão do inventário e dos ajustes correspondentes.

**Principais ações (comentário)**
- Registrar a quantidade contada por produto.
- Revisar divergências e observações.
- Salvar a contagem ou concluir o inventário.

**Ponto de atenção**
- Definir o tratamento dos movimentos ocorridos durante a contagem. A conclusão deve registrar a base comparada e o ajuste autorizado para cada item.

**Regiões da tela**
- Barra superior global: 'Intercert ERP' + subtítulo 'Inventário de estoque', contexto 'Loja Modelo — Matriz', avatar 'HB'
- Cabeçalho: título 'Inventário e contagem' + subtítulo 'Confira o estoque físico, identifique divergências e ajuste os saldos com segurança.'; botões 'Inventários anteriores' e '+ Novo inventário'
- Faixa de 4 cartões de indicadores
- Painel do inventário em andamento: identificação (código, início, responsável, selo), busca e filtros, barra de progresso, tabela de itens, legenda de cores e botões de rodapé

**Campos observados**
- Identificação do inventário (somente leitura; ex.: 'Inventário INV-2026-009')
- Início/responsável (somente leitura; ex.: 'Iniciado em 21/09/2026 às 08:15 por Lando')
- Busca (texto; placeholder 'Buscar produto ou SKU')
- Contagem física (input numérico por item; ex.: 16, 11, 5, 4; vazio '—' para não contado)
- Observação por item (acionada pelo ícone de comentário)
- Saldo sistema (somente leitura por item)
- Divergência (calculado por item)
- Impacto (calculado em R$ por item)

**Botões e ações observados**
- Botão 'Inventários anteriores' (ícone histórico)
- Botão laranja '+ Novo inventário'
- Campo de busca 'Buscar produto ou SKU'
- Dropdown 'Todos os itens'
- Dropdown 'Todos os setores'
- Botão de comentário/observação (ícone balão) em cada linha
- Botão 'Salvar contagem' (ícone disquete)
- Botão laranja 'Concluir inventário' (ícone check em círculo)
- Avatar 'HB'

**Colunas de tabelas**
- Itens do inventário: Produto (ícone + nome + variação • SKU, ex.: 'Azul / M • SKU CM-001-AZ-M')
- Itens do inventário: Localização (ex.: A-02-03)
- Itens do inventário: Saldo sistema
- Itens do inventário: Contagem física (editável)
- Itens do inventário: Divergência (com sinal e cor)
- Itens do inventário: Impacto (R$)
- Itens do inventário: Status
- Itens do inventário: [ação observação]

**Filtros**
- Busca 'Buscar produto ou SKU'
- Situação do item (select: 'Todos os itens')
- Setor (select: 'Todos os setores')

**Indicadores / cartões / gráficos**
- Produtos no inventário (148; 'Loja Modelo — Matriz')
- Itens já contados (101; '68% concluído')
- Com divergência (3; 'Requerem conferência') – valor em laranja
- Impacto estimado (− R$ 157,00; 'Valor pelo custo médio') – valor em vermelho
- Barra 'Progresso da contagem' (101 de 148)
- Legenda: Saldo confere (verde) / Diferença encontrada (vermelho) / Aguardando contagem (cinza)

**Estados e selos**
- Selo do inventário 'Em contagem' (laranja)
- Selo de item 'Divergência' (vermelho, ícone alerta)
- Selo de item 'Conferido' (verde, ícone check)
- Selo de item 'Não contado' (cinza, ícone relógio)
- Divergência negativa em vermelho (− 2, − 5), positiva em verde (+ 1), zero em cinza-azulado (0)

**Regras e políticas ilustradas (exemplos)**
- Divergência = contagem física − saldo sistema (16 − 18 = −2; 11 − 11 = 0; 5 − 4 = +1; 4 − 9 = −5)
- Impacto = divergência × custo médio (−2 × 42 = −R$ 84,00; +1 × 107 = +R$ 107,00; −5 × 36 = −R$ 180,00)
- Impacto estimado total = soma dos impactos (−84 + 0 + 107 − 180 = −R$ 157,00)
- Percentual concluído = itens contados / produtos no inventário (101/148 ≈ 68%)
- Inventário possui código sequencial anual (INV-2026-009), data/hora de início e responsável
- Contagem pode ser salva parcialmente antes da conclusão; conclusão gera os ajustes
- Inventário pode ser filtrado por setor/localização (endereçamento tipo A-02-03)

**Inconsistências do protótipo**
- Código 'INV-2026-009' difere do formato 'INV-2026-09' exibido no histórico da Tela 17
- Saldo sistema da camiseta = 18 un., mas o inventário iniciou em 21/09/2026 08:15 e, pela Tela 17, o saldo nesse momento era 20 (a venda de −2 ocorreu em 21/09 20:48) — indica saldo não congelado no início da contagem
- Ajuste de inventário anterior foi lançado em 15/09 (Tela 17) com código semelhante, sugerindo numeração/periodicidade não clara

