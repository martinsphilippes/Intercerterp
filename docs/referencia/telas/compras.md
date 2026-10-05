# Telas do PDF — compras

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

### Tela 26 — Gestão de fornecedores (p. 35)

Grupo: Compras

**Objetivo:** Centraliza os parceiros de fornecimento, seus contatos e o histórico comercial, servindo de base para cotações, pedidos e obrigações financeiras.

**Principais ações (comentário)**
- Pesquisar e filtrar fornecedores.
- Consultar dados e contatos comerciais.
- Acompanhar pedidos e acessar o cadastro.

**Ponto de atenção**
- Padronizar a identificação do fornecedor entre compra, recebimento e financeiro. Alterações cadastrais não devem eliminar a referência dos documentos históricos.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Gestão de fornecedores'; contexto 'Compras — Matriz'; avatar 'HB'
- Cabeçalho: título 'Fornecedores' + subtítulo 'Gerencie cadastros, contatos, compras, condições comerciais e situação financeira.' + botão 'Novo fornecedor'
- Faixa de 4 cartões de KPI
- Painel com barra de filtros (busca, 2 selects, Mais filtros, Exportar)
- Tabela de fornecedores com avatar de iniciais
- Rodapé com contador e paginação numerada

**Campos observados**
- Busca: 'Buscar razão social, CNPJ, produto ou contato' (texto; placeholder truncado na imagem)
- Categoria (select) (Todas as categorias)
- Status (select) (Todos os status)
- Fornecedor – avatar com iniciais (DN, TC, SG, GM, IA)
- Fornecedor – razão social/nome (Distribuidora Nordeste)
- Fornecedor – cidade — UF (Fortaleza — CE)
- Fornecedor – linha de fornecimento/quantidade (128 produtos; Fretes; Sistemas; Materiais gráficos; Acessórios)
- CNPJ (12.845.330/0001-42)
- Categoria (Mercadorias; Logística; Tecnologia; Serviços)
- Última compra – data (20/09/2026)
- Última compra – documento (NF-e 352609; CT-e 000849; NFS-e 009184; NFS-e 001427; NF-e 088147)
- Total comprado (R$ 184.650,00)
- Saldo a pagar (R$ 16.900,00)
- Avaliação (estrela + nota) (4,8)
- Status (Ativo; Docs. pendentes; Bloqueado)

**Botões e ações observados**
- Novo fornecedor (botão primário laranja; ícone de prédio)
- Mais filtros (ícone de controles deslizantes)
- Exportar (ícone de download)
- Ver fornecedor (ícone de olho) por linha
- Editar fornecedor (ícone de lápis) por linha
- Mais ações (ícone '...') por linha
- Paginação: 1 (ativa), 2, 3, próxima (›)

**Colunas de tabelas**
- Fornecedores: Fornecedor | CNPJ | Categoria | Última compra | Total comprado | Saldo a pagar | Avaliação | Status | Ações

**Filtros**
- Busca por razão social, CNPJ, produto ou contato
- Categoria (Todas as categorias)
- Status (Todos os status)
- Mais filtros

**Indicadores / cartões / gráficos**
- Total de fornecedores (184) — '156 ativos'
- Compras neste mês (R$ 86.420, azul) — '42 pedidos recebidos'
- Prazo médio negociado (34 dias) — '+4 dias versus mês anterior'
- Saldo a pagar (R$ 38.760, vermelho) — '28 títulos em aberto'

**Estados e selos**
- Ativo (verde)
- Docs. pendentes (âmbar)
- Bloqueado (vermelho)
- Avaliação com estrela âmbar (4,8; 4,5; 4,2; 3,9; 2,6)
- Página ativa em azul escuro

**Regras e políticas ilustradas (exemplos)**
- Última compra referenciada pelo documento fiscal de origem (NF-e para mercadorias, CT-e para frete, NFS-e para serviços)
- Avaliação do fornecedor em escala 0–5 (mostrada como '4,8 de 5' na Tela 28)
- Fornecedor com status 'Bloqueado' e avaliação baixa (2,6) e saldo a pagar zerado
- Fornecedor com documentação incompleta recebe status 'Docs. pendentes'
- Prazo médio negociado comparado com o mês anterior (+4 dias)

**Inconsistências do protótipo**
- Paginação mostra apenas páginas 1, 2, 3 para 184 fornecedores exibidos de 5 em 5 (seriam 37 páginas)
- KPI 'Compras neste mês: 42 pedidos recebidos' conflita com a Tela 27 (42 pedidos no mês, mas apenas 24 recebidos)
- Valor de compras do mês R$ 86.420 conflita com o orçamento consumido R$ 68.420 mostrado na Tela 28
- Distribuidora Nordeste: última compra 20/09/2026 com NF-e 352609, mas na Tela 29 essa NF-e foi emitida em 22/09/2026
- Saldo a pagar de Distribuidora Nordeste R$ 16.900,00, embora a Tela 25 mostre pagamento da parcela 1/2 (R$ 8.450,00) em 21/09
- Importadora Atlântico está 'Bloqueado', mas tem pedido PC-00480 em elaboração na Tela 27 (falta regra sobre bloqueio para novos pedidos)
- Placeholder da busca truncado ('...ou contat')

### Tela 27 — Pedidos de compra (p. 36)

Grupo: Compras

**Objetivo:** Acompanha as compras desde o rascunho até as etapas posteriores de aprovação, envio e recebimento, reunindo valores, fornecedores e situações.

**Principais ações (comentário)**
- Pesquisar pedidos e filtrar situações.
- Abrir o detalhamento de uma compra.
- Acessar ações coerentes com a etapa do pedido.

**Ponto de atenção**
- Os estados do pedido precisam ser únicos e consistentes em todas as telas. Uma compra aprovada não deve aparecer automaticamente como enviada ou recebida.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Pedidos de compra'; contexto 'Compras — Matriz'; avatar 'HB'
- Cabeçalho: título 'Pedidos de compra' + subtítulo 'Planeje compras, aprove solicitações e acompanhe o recebimento das mercadorias.' + botões 'Importar cotação' e '+ Novo pedido'
- Faixa de 4 cartões de KPI
- Faixa de 5 cartões de etapa do pipeline com ícones (o cartão 'Para aprovação' está destacado em laranja)
- Painel com barra de filtros (busca, status, fornecedor, data, Filtros)
- Tabela de pedidos
- Rodapé com contador e paginação numerada

**Campos observados**
- Busca: 'Buscar pedido, fornecedor, produto ou so[licitante]' (texto; placeholder truncado)
- Status (select) (Todos os status)
- Fornecedor (select) (Todos os fornecedores)
- Data (date) (09/23/2026)
- Pedido – número (PC-00482)
- Pedido – finalidade/descrição (Compra de reposição; Material promocional; Compra sazonal; Equipamentos de rede; Reposição de calçados)
- Fornecedor – nome (Distribuidora Nordeste)
- Fornecedor – CNPJ (CNPJ 12.845.330/0001-42)
- Solicitado em (20/09/2026)
- Itens – quantidade de produtos (38 produtos)
- Itens – total de unidades (164 unidades)
- Previsão – data (25/09/2026 ou '—')
- Previsão – texto relativo (Em 2 dias; Após aprovação; Não definida; Em 4 dias; Recebido no prazo)
- Valor total (R$ 16.900,00)
- Comprador (Lando; Mateus; Karem; Hércules)
- Status (Em trânsito; Aprovação; Elaboração; Enviado; Recebido)

**Botões e ações observados**
- Importar cotação (ícone de documento)
- + Novo pedido (botão primário laranja)
- Filtros (ícone de controles deslizantes)
- Cartões de etapa clicáveis como filtro rápido (Em elaboração, Para aprovação, Enviados, Em trânsito, Recebidos)
- Ver pedido (ícone de olho) – todas as linhas
- Em trânsito: rastrear entrega (ícone de pino de localização) + Mais ações (...)
- Aprovação: aprovar (ícone check) + reprovar (ícone X)
- Elaboração: editar (ícone lápis) + Mais ações (...)
- Enviado: enviar/reenviar ao fornecedor (ícone de avião de papel) + Mais ações (...)
- Recebido: ver nota/recebimento (ícone de recibo/documento) + Mais ações (...)
- Paginação: 1 (ativa), 2, 3, próxima (›)

**Abas / etapas**
- Cartões de etapa: Em elaboração (3)
- Para aprovação (6) — destacado/selecionado
- Enviados (4)
- Em trânsito (9)
- Recebidos (24)

**Colunas de tabelas**
- Pedidos: Pedido | Fornecedor | Solicitado em | Itens | Previsão | Valor total | Comprador | Status | Ações

**Filtros**
- Busca por pedido, fornecedor, produto ou solicitante
- Status (Todos os status)
- Fornecedor (Todos os fornecedores)
- Data (09/23/2026)
- Filtros adicionais (botão Filtros)
- Cartões de etapa do pipeline

**Indicadores / cartões / gráficos**
- Pedidos no mês (42) — 'R$ 86.420 em compras'
- Aguardando aprovação (6, âmbar) — 'R$ 21.380 pendentes'
- Em trânsito (9, azul) — 'Previsão nos próximos 7 dias'
- Recebidos (24, verde) — '96% entregues no prazo'
- Pipeline: Em elaboração 3 (ícone prancheta) | Para aprovação 6 (ícone selo, destacado laranja) | Enviados 4 (ícone avião de papel) | Em trânsito 9 (ícone caminhão) | Recebidos 24 (ícone caixa com check)

**Estados e selos**
- Em trânsito (âmbar claro)
- Aprovação (âmbar)
- Elaboração (cinza)
- Enviado (azul claro)
- Recebido (verde)
- Cartão de etapa selecionado com borda laranja

**Regras e políticas ilustradas (exemplos)**
- Ciclo do pedido: Em elaboração → Para aprovação → Enviado → Em trânsito → Recebido
- Ações por linha dependem da etapa (aprovar/reprovar só em Aprovação; editar só em Elaboração; rastrear em Em trânsito; ver nota em Recebido)
- Previsão de entrega só é definida após aprovação ('Após aprovação') ou fica 'Não definida' em elaboração
- Indicador de pontualidade: 96% entregues no prazo
- Valor pendente de aprovação somado no KPI (R$ 21.380)

**Inconsistências do protótipo**
- Rótulos de estado divergentes para a mesma etapa: 'Aguardando aprovação' (KPI) × 'Para aprovação' (pipeline) × 'Aprovação' (selo); 'Em elaboração' × 'Elaboração'; 'Enviados' × 'Enviado' — contraria o ponto de atenção sobre estados únicos
- KPI 'Pedidos no mês' = 42, mas a soma do pipeline (3+6+4+9+24) = 46 e o rodapé diz 'Exibindo 5 de 46 pedidos'
- Cartão 'Para aprovação' aparece selecionado, mas a tabela lista pedidos de todos os estados e o select mostra 'Todos os status'
- Paginação mostra 1, 2, 3 para 46 pedidos de 5 em 5 (seriam 10 páginas)
- Filtro de data em formato americano (09/23/2026) enquanto a tabela usa dd/mm/aaaa
- Tela 26 diz '42 pedidos recebidos' no mês, aqui são 24 recebidos
- Karem e Hércules aparecem como compradores aqui, mas na Tela 28 são aprovadores (Financeiro e Gestor)
- PC-00480 é de Importadora Atlântico, fornecedor 'Bloqueado' na Tela 26
- Placeholder da busca truncado ('...produto ou so')

### Tela 28 — Novo pedido de compra (p. 37)

Grupo: Compras

**Objetivo:** Estrutura uma nova compra a partir de fornecedor, produtos, condições comerciais e entrega, apresentando o total antes do encaminhamento para análise.

**Principais ações (comentário)**
- Selecionar fornecedor e dados de entrega.
- Incluir produtos, quantidades e custos.
- Salvar rascunho ou enviar para aprovação.

**Ponto de atenção**
- Validar totais, unidades e condições antes de submeter. Mudanças de valor após a aprovação deverão seguir uma regra de revisão definida no desenvolvimento.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Novo pedido de compra'; contexto 'Compras — Matriz'; avatar 'HB'
- Cabeçalho: título 'Novo pedido de compra' + subtítulo 'Defina fornecedor, produtos, custos, entrega e condição financeira.' + selo 'Rascunho • PC-00483' à direita
- Coluna principal: seção 'Fornecedor e entrega' (com faixa informativa do fornecedor)
- Coluna principal: seção 'Produtos do pedido' (busca, botão adicionar, tabela editável, rodapé com resumo e sugestão de compra)
- Coluna principal: seção 'Condições e observações'
- Coluna lateral direita: cartão 'Resumo financeiro' com sub-cartão de orçamento mensal e barra de progresso
- Coluna lateral direita: cartão 'Fluxo de aprovação' com etapas por pessoa
- Barra de ações inferior direita (Cancelar, Salvar rascunho, Gerar cotação, Enviar para aprovação)

**Campos observados**
- Fornecedor * (select obrigatório) (Distribuidora Nordeste)
- Data do pedido (date) (09/23/2026)
- CNPJ do fornecedor (somente leitura) (12.845.330/0001-42)
- Contato comercial (somente leitura) (Rafael Mendes)
- Prazo negociado (somente leitura) (28 / 56 dias)
- Avaliação (somente leitura) (4,8 de 5)
- Filial de destino (select) (Loja Modelo — Matriz)
- Previsão de entrega * (date obrigatório) (09/30/2026)
- Comprador responsável (select) (Lando)
- Finalidade da compra (texto) (Reposição de estoque — coleção primavera)
- Busca de produto: 'Buscar produto, SKU ou código' (texto)
- Produto – nome (Camiseta básica masculina)
- Produto – variação e SKU (Azul / M • SKU CM-001-AZ-M; Azul / 42 • SKU CJ-042-AZ; Grade 37–42 • SKU TN-ESP-BR)
- Estoque atual (somente leitura) (18 un.; 11 un.; 4 un.)
- Qtd. (input numérico) (40; 24; 36)
- Custo unitário (input numérico) (42.00; 96.00; 107.00)
- Desc. (input numérico) (0)
- IPI (input numérico) (0)
- Total da linha (calculado) (R$ 1.680,00; R$ 2.304,00; R$ 3.852,00)
- Resumo de itens (3 produtos • 100 unidades)
- Condição de pagamento (select) (28 / 56 dias)
- Forma de pagamento (select) (Boleto bancário)
- Centro de custo (select) (Operacional — Estoque)
- Observações ao fornecedor (textarea) (Entregar no depósito da Matriz, de segunda a sexta, das 8h às 17h.)
- Subtotal dos produtos (calculado) (R$ 7.836,00)
- Desconto geral (input) (0.00)
- Frete (input) (650.00)
- Seguro (input) (0.00)
- Outras despesas (input) (150.00)
- IPI estimado (calculado) (R$ 0,00)
- Total do pedido (calculado) (R$ 8.636,00)
- Orçamento mensal de compras (consumido / limite) (R$ 68.420 / R$ 100.000) com barra de progresso
- Saldo após o pedido (Restarão R$ 22.944 após este pedido.)
- Fluxo de aprovação – aprovador: nome, papel/alçada e situação (Lando — Solicitante — Preparando; Karem — Financeiro • acima de R$ 5 mil — Pendente; Hércules — Gestor • acima de R$ 8 mil — Pendente)

**Botões e ações observados**
- Buscar fornecedor (botão azul com lupa ao lado do select)
- Seletor de data do pedido (ícone calendário)
- Seletor de previsão de entrega (ícone calendário)
- + Adicionar (adicionar produto, botão azul)
- Remover produto (X) por linha
- + Adicionar produtos pela sugestão de compra (botão tracejado)
- Cancelar
- Salvar rascunho (ícone de disquete)
- Gerar cotação (botão azul escuro; ícone de documento)
- Enviar para aprovação (botão primário laranja; ícone de avião de papel)

**Colunas de tabelas**
- Produtos do pedido: Produto | Estoque | Qtd. | Custo unitário | Desc. | IPI | Total | (remover)

**Indicadores / cartões / gráficos**
- Resumo financeiro (Subtotal R$ 7.836,00; Frete 650.00; Outras despesas 150.00; Total do pedido R$ 8.636,00)
- Orçamento mensal de compras (R$ 68.420 / R$ 100.000; barra de progresso ~68%; Restarão R$ 22.944)
- Fluxo de aprovação (3 etapas: Solicitante, Financeiro, Gestor)

**Estados e selos**
- Rascunho • PC-00483 (selo no cabeçalho)
- Preparando (âmbar, etapa do solicitante)
- Pendente (âmbar, etapas de aprovação)
- Estoque baixo destacado em laranja (18 un.; 4 un.), estoque em cinza (11 un.)
- Campos obrigatórios marcados com asterisco laranja (Fornecedor, Previsão de entrega)

**Regras e políticas ilustradas (exemplos)**
- Total da linha = Qtd. × Custo unitário − Desc. + IPI (40 × 42,00 = 1.680,00; 24 × 96,00 = 2.304,00; 36 × 107,00 = 3.852,00)
- Subtotal = soma das linhas (R$ 7.836,00); Total do pedido = Subtotal − Desconto geral + Frete + Seguro + Outras despesas + IPI (7.836 + 650 + 150 = R$ 8.636,00)
- Alçadas de aprovação: Financeiro para pedidos acima de R$ 5 mil; Gestor para pedidos acima de R$ 8 mil (pedido de R$ 8.636 exige ambos)
- Controle de orçamento mensal de compras: limite R$ 100.000; saldo restante = limite − consumido − pedido (100.000 − 68.420 − 8.636 = R$ 22.944)
- Dados do fornecedor (CNPJ, contato, prazo negociado, avaliação) preenchidos automaticamente ao selecionar o fornecedor
- Condição de pagamento herdada do prazo negociado (28 / 56 dias)
- Numeração do pedido reservada já no rascunho (PC-00483)

**Inconsistências do protótipo**
- Datas em formato americano (09/23/2026; 09/30/2026) enquanto o restante do sistema usa dd/mm/aaaa
- Separador decimal com ponto nos inputs (42.00; 650.00; 0.00) e com vírgula nos valores em R$ (R$ 1.680,00)
- Orçamento consumido R$ 68.420 conflita com 'Compras neste mês R$ 86.420' das Telas 26 e 27
- Destaque de estoque baixo incoerente: 18 un. em laranja, mas 11 un. (menor) em cinza
- Karem e Hércules são aprovadores aqui (Financeiro/Gestor), mas aparecem como compradores na Tela 27
- Filial de destino 'Loja Modelo — Matriz' × observação 'Entregar no depósito da Matriz' × Tela 29 'Depósito principal — Matriz' (local de entrega não padronizado)

### Tela 29 — Recebimento de mercadorias (p. 38)

Grupo: Compras

**Objetivo:** Confronta a mercadoria recebida com os dados do documento e da compra, permitindo revisar quantidades e impactos antes da entrada definitiva.

**Principais ações (comentário)**
- Informar a chave ou importar o XML.
- Conferir produtos e quantidades recebidas.
- Revisar os efeitos no estoque e no financeiro.

**Ponto de atenção**
- Identificar divergências e recebimentos parciais. A mesma entrada não pode gerar estoque ou contas a pagar em duplicidade.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Recebimento de mercadorias'; contexto 'Estoque — Matriz'; avatar 'HB'
- Cabeçalho: título 'Receber mercadorias' + subtítulo 'Importe a NF-e, confira os produtos e conclua a entrada fiscal e física.' + botões 'Ler chave de acesso' e 'Importar XML'
- Indicador de etapas (stepper) horizontal com 4 etapas
- Cartão da NF-e: ícone, número/série, chave, selo 'XML validado', 4 campos e faixa de vínculo com pedido
- Cartão 'Conferência dos produtos' com legenda de cores, tabela editável e rodapé
- Cartão 'Dados fiscais e financeiros' com selects e observação
- Coluna lateral: cartão 'Totais da NF-e' + checkboxes de efeitos
- Coluna lateral: cartão 'Impactos da entrada'
- Botão de conclusão em largura total na coluna lateral

**Campos observados**
- NF-e – número e série (NF-e 000.352.609 — Série 1)
- Chave de acesso (3526 0912 8453 3000 0142 5500 1000 3526 0912 8421)
- Fornecedor (Distribuidora Nordeste)
- Emissão – data e hora (22/09/2026 • 16:42)
- Valor total (R$ 16.900,00)
- Natureza da operação (Venda de mercadoria)
- Vínculo com pedido (Pedido PC-00482 vinculado automaticamente — 'Fornecedor, produtos e valores compatíveis' — 98% de correspondência)
- Produto – nome, variação e SKU (Camiseta básica masculina — Azul / M • SKU CM-001-AZ-M; Calça jeans slim — Azul / 42 • SKU CJ-042-AZ; Tênis esportivo branco — Grade 37-42 • SKU TN-ESP-BR; Outros 35 produtos — Itens conferidos por leitura de código)
- Quantidade no Pedido (40 un.)
- Quantidade na NF-e (40 un.)
- Recebido (input numérico editável) (40; 22; 36; 64)
- Diferença (calculada; 0 em verde, negativa em vermelho) (0; − 2)
- Lote / validade (LT-0926-A Sem validade; Vários lotes)
- Status da conferência por item (Confere; Divergência)
- Resumo da conferência (162 de 164 unidades conferidas; 1 divergência encontrada)
- CFOP de entrada (select) (1.102 — Compra para comercialização)
- Local de estoque (select) (Depósito principal — Matriz)
- Plano de contas (select) (Compras de mercadorias)
- Centro de custo (select) (Operacional — Estoque)
- Observações da conferência (textarea) (Identificada falta de 2 unidades da Calça Jeans Slim. Registrar pendência com o fornecedor.)
- Totais da NF-e – Produtos (R$ 16.100,00)
- Totais da NF-e – Frete (R$ 650,00)
- Totais da NF-e – IPI (R$ 0,00)
- Totais da NF-e – ICMS destacado (R$ 2.898,00)
- Totais da NF-e – Outras despesas (R$ 150,00)
- Total da NF-e (R$ 16.900,00)
- Checkbox Atualizar estoque (marcado)
- Checkbox Atualizar custo dos produtos (marcado)
- Checkbox Gerar contas a pagar (marcado)
- Checkbox Escriturar documento fiscal (marcado)
- Impacto – Estoque (+162 unidades)
- Impacto – Novo custo médio (Atualizado em 38 produtos)
- Impacto – Contas a pagar (2 parcelas)
- Impacto – Vencimentos (21/10 e 18/11)
- Impacto – Crédito ICMS (R$ 2.898,00)

**Botões e ações observados**
- Ler chave de acesso (ícone de leitor/scan)
- Importar XML (botão azul escuro; ícone de arquivo)
- Comentário/observação por item (ícone de balão de fala) em cada linha da conferência
- Edição da quantidade recebida por linha (input)
- Marcar/desmarcar efeitos (4 checkboxes)
- Concluir entrada da NF-e (botão primário laranja; ícone de caixa)

**Abas / etapas**
- Etapa 1: NF-e importada — 'XML validado' (concluída, check verde)
- Etapa 2: Pedido vinculado — 'PC-00482' (concluída, check verde)
- Etapa 3: Conferência física — '3 de 4 itens' (ativa, destacada em laranja)
- Etapa 4: Concluir entrada — 'Estoque e financeiro' (pendente)

**Colunas de tabelas**
- Conferência dos produtos: Produto | Pedido | NF-e | Recebido | Diferença | Lote / validade | Status | (comentário)

**Indicadores / cartões / gráficos**
- Totais da NF-e (Produtos R$ 16.100,00; Frete R$ 650,00; IPI R$ 0,00; ICMS destacado R$ 2.898,00; Outras despesas R$ 150,00; Total R$ 16.900,00)
- Impactos da entrada (Estoque +162 unidades; Novo custo médio atualizado em 38 produtos; Contas a pagar 2 parcelas; Vencimentos 21/10 e 18/11; Crédito ICMS R$ 2.898,00)
- Faixa de vínculo: 98% de correspondência

**Estados e selos**
- XML validado (selo verde)
- Confere (selo verde com check)
- Divergência (selo vermelho com triângulo)
- Pendente (legenda cinza)
- Legenda: Confere (verde) • Divergência (vermelho) • Pendente (cinza)
- Etapas concluídas com check verde; etapa ativa em laranja; etapa futura em cinza
- '1 divergência encontrada' em vermelho

**Regras e políticas ilustradas (exemplos)**
- Diferença = Recebido − NF-e (22 − 24 = −2)
- Entrada em estoque = unidades efetivamente recebidas (164 − 2 = +162)
- Total da NF-e = Produtos + Frete + IPI + Outras despesas (16.100 + 650 + 0 + 150 = R$ 16.900,00); ICMS destacado não soma ao total
- Crédito de ICMS = ICMS destacado (18% × R$ 16.100,00 = R$ 2.898,00)
- Vínculo automático NF-e × pedido de compra por fornecedor, produtos e valores (98% de correspondência)
- Contas a pagar geradas conforme condição do pedido (2 parcelas, 28/56 dias)
- Custo médio recalculado para todos os produtos da nota (38)
- Itens em massa podem ser conferidos por leitura de código de barras
- Efeitos opcionais da entrada: atualizar estoque, atualizar custo, gerar contas a pagar, escriturar documento fiscal
- CFOP de entrada 1.102 para compra para comercialização

**Inconsistências do protótipo**
- Coluna 'Lote / validade' concatena sem separador ('LT-0926-ASem validade')
- Página rotulada 'TELA 29 / COMPRAS', mas a barra superior mostra contexto 'Estoque — Matriz'
- Etapa 'Conferência física — 3 de 4 itens' enquanto a tabela já mostra status para os 4 itens (3 conferem + 1 divergência)
- Chave de acesso começa com 35 (UF São Paulo), mas o fornecedor está em Fortaleza — CE e o CFOP é 1.102 (operação interna)
- Vencimentos 21/10 e 18/11 não batem com 28/56 dias a partir da emissão 22/09 (dariam 20/10 e 17/11)
- Contas a pagar geradas sobre o valor integral da NF-e mesmo com falta de 2 unidades registrada
- Crédito ICMS de R$ 2.898,00 conflita com a Tela 31, que indica CSOSN (Simples Nacional) e ICMS R$ 0,00
- Tela 25 mostra a parcela 1/2 desta NF-e já paga em 21/09, antes da emissão (22/09) e do recebimento
- Tela 26 registra a última compra (NF-e 352609) em 20/09/2026, mas a emissão aqui é 22/09/2026

### Tela 46 — Planejamento de compras e reposição (p. 70)

Grupo: Análise e planejamento

**Objetivo:** Sugere compras por filial a partir de estoque, consumo e entregas previstas, mantendo a possibilidade de revisar as quantidades e os dados comerciais.

**Principais ações (comentário)**
- Recalcular cobertura e sugestões.
- Ajustar quantidades, fornecedor, custo e prazo.
- Revisar itens e criar rascunhos por fornecedor.

**Ponto de atenção**
- As sugestões distinguem estoque disponível, entregas confirmadas e quantidades em rascunho. Lotes, mínimos e recebimentos fora do horizonte exigem tratamento explícito.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, trilha 'Compras / Reposição', seletor de empresa (Varejo Exemplo), avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Compras' ativo
- Cabeçalho da página: título 'Compras e reposição', subtítulo 'Planeje quantidades e revise as compras por fornecedor.' e indicador/botão 'Rascunhos 0' à direita
- Cartão de parâmetros: Filial de destino, Cobertura após o prazo de entrega (dias), botão 'Recalcular' e texto de posição simulada
- Cabeçalho 'Sugestões de reposição' com contexto e filtros Fornecedor / Exibir à direita
- Cartão-tabela com cabeçalho 'Selecionar visíveis' e nota 'Quantidades em UN · custos estimados'
- Tabela de sugestões (primeira linha visível)

**Campos observados**
- Seletor de empresa no cabeçalho (select; Varejo Exemplo)
- Filial de destino (select; Centro)
- Cobertura após o prazo de entrega (dias) (campo numérico; 14)
- Texto: 'Posição simulada: 24/09/2026 · consumo médio diário de exemplo · estoque mínimo por produto.'
- Contexto das sugestões: empresa · filial · cobertura (Varejo Exemplo · Centro · cobertura adicional de 14 dias)
- Fornecedor (select; Todos)
- Exibir (select; A repor)
- Selecionar visíveis (checkbox)
- Checkbox de seleção por linha
- Produto (link; Cafeteira elétrica 15 xícaras)
- Código · classe ABC (PRD-0101 · ABC A)
- Fornecedor (Eletro Comercial)
- Estoque disponível (4 disponíveis)
- Pedidos confirmados no horizonte (8 confirmados no horizonte)
- Sugestão (4 UN)
- Alvo (Alvo: 16 UN)
- Comprar (campo numérico editável; 4)
- Indicador 'Sugestão aplicada'
- Estimativa total (R$ 480,00)
- Custo unitário (R$ 120,00 / UN)
- Contador 'Rascunhos' (0)

**Botões e ações observados**
- Rascunhos 0 (botão/indicador no canto superior direito)
- Recalcular (botão primário laranja)
- Checkbox 'Selecionar visíveis'
- Checkbox de linha
- Link do produto 'Cafeteira elétrica 15 xícaras'
- Link 'Usar sugestão'
- Seletor de empresa (cabeçalho)
- Avatar HB
- Itens do menu lateral

**Colunas de tabelas**
- Sugestões de reposição: (checkbox de seleção)
- Sugestões de reposição: Produto / fornecedor
- Sugestões de reposição: Estoque e pedidos
- Sugestões de reposição: Sugestão
- Sugestões de reposição: Comprar
- Sugestões de reposição: Estimativa

**Filtros**
- Filial de destino (Centro)
- Cobertura após o prazo de entrega em dias (14)
- Fornecedor (Todos)
- Exibir (A repor)

**Indicadores / cartões / gráficos**
- Indicador 'Rascunhos 0'

**Estados e selos**
- Selo 'A repor' (azul claro)
- Texto 'Sugestão aplicada'
- Classe ABC exibida junto ao código (ABC A)

**Itens de menu**
- PRINCIPAL (rótulo de seção)
- Visão geral
- Vendas
- Estoque
- Compras (ativo)
- Financeiro
- Relatórios
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Sugestão = Alvo − estoque disponível − pedidos confirmados no horizonte (16 − 4 − 8 = 4 UN)
- Estimativa = quantidade a comprar × custo unitário (4 × R$ 120,00 = R$ 480,00)
- Alvo considera cobertura adicional de 14 dias após o prazo de entrega, consumo médio diário e estoque mínimo por produto
- Posição de estoque simulada em 24/09/2026
- Quantidades em UN; custos estimados
- Classe ABC (Tela 45) exibida para priorização

**Inconsistências do protótipo**
- Título da página no app 'Compras e reposição' difere do nome da tela no guia 'Planejamento de compras e reposição' e da trilha 'Compras / Reposição'
- Menu lateral desta tela inclui 'Compras' mas omite 'Fiscal' (presente nas Telas 43–45) e 'Ajuda e suporte'
- Posição simulada em 24/09/2026 enquanto a base de demonstração das telas de relatório vai de 10 a 23/09/2026

### Tela 46 — Planejamento de compras e reposição (parte 2 de 3) (p. 71)

Grupo: Análise e planejamento

**Objetivo:** Continuação: linhas da tabela de sugestões de reposição (Ventilador, Garrafa térmica, Toalha de banho, Pote plástico).

**Ponto de atenção**
- Parte 2 de 3 da mesma visão. A divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo. Visão principal e comentários na página 70.

**Regiões da tela**
- Menu lateral escuro (recortado)
- Continuação da tabela 'Sugestões de reposição' com 4 linhas

**Campos observados**
- Checkbox de seleção por linha
- Produto (link) + 'código · ABC classe' + fornecedor
- Estoque e pedidos: 'N disponíveis' + 'N confirmados no horizonte' (+ aviso 'Entrega fora do horizonte' quando aplicável)
- Sugestão: quantidade em UN + 'Alvo: N UN' + selo de situação
- Comprar: campo numérico editável + 'Sugestão aplicada' + link 'Usar sugestão'
- Estimativa: total em R$ + custo unitário 'R$ / UN'
- Linha: Ventilador de mesa 40 cm (PRD-0102 · ABC A; Eletro Comercial; 1 disponíveis; 6 confirmados no horizonte; Entrega fora do horizonte; 20 UN; Alvo: 26 UN; Risco antes da entrega; Comprar 20; R$ 1.720,00; R$ 86,00 / UN)
- Linha: Garrafa térmica 1 L (PRD-0104 · ABC B; Casa & Utilidades; 3 disponíveis; 6 confirmados no horizonte; 6 UN; Alvo: 11 UN; A repor; Comprar 6; R$ 252,00; R$ 42,00 / UN)
- Linha: Toalha de banho (PRD-0105 · ABC B; Casa & Utilidades; 9 disponíveis; 0 confirmados no horizonte; 18 UN; Alvo: 24 UN; A repor; Comprar 18; R$ 324,00; R$ 18,00 / UN)
- Linha: Pote plástico 1 L (PRD-0106 · ABC C; Casa & Utilidades; 26 disponíveis; 12 confirmados no horizonte; 12 UN; Alvo: 43 UN; A repor; Comprar 12; R$ 26,40; R$ 2,20 / UN)

**Botões e ações observados**
- Checkbox de seleção em cada linha (4)
- Links de produto: Ventilador de mesa 40 cm, Garrafa térmica 1 L, Toalha de banho, Pote plástico 1 L
- Link 'Usar sugestão' em cada linha (4)
- Campo 'Comprar' editável em cada linha

**Colunas de tabelas**
- Sugestões de reposição: (checkbox)
- Sugestões de reposição: Produto / fornecedor
- Sugestões de reposição: Estoque e pedidos
- Sugestões de reposição: Sugestão
- Sugestões de reposição: Comprar
- Sugestões de reposição: Estimativa

**Estados e selos**
- Selo 'Risco antes da entrega' (vermelho)
- Selo 'A repor' (azul claro)
- Aviso textual 'Entrega fora do horizonte'
- Texto 'Sugestão aplicada'
- Classes ABC A, ABC B, ABC C junto ao código

**Regras e políticas ilustradas (exemplos)**
- Estimativa = quantidade × custo unitário (20 × 86,00 = 1.720,00; 6 × 42,00 = 252,00; 18 × 18,00 = 324,00; 12 × 2,20 = 26,40)
- Selo 'Risco antes da entrega' quando o estoque disponível não cobre o consumo até a chegada / a entrega confirmada cai fora do horizonte
- Sugestão aparentemente arredondada para lote/mínimo de compra acima da necessidade líquida (ex.: Garrafa 11 − 3 − 6 = 2 → 6; Toalha 24 − 9 − 0 = 15 → 18; Pote 43 − 26 − 12 = 5 → 12; Ventilador 26 − 1 − 6 = 19 → 20)
- Classe ABC exibida por produto, coerente com a Tela 45 (PRD-0102 A, PRD-0104 B, PRD-0105 B, PRD-0106 C)

**Inconsistências do protótipo**
- Ventilador mostra '6 confirmados no horizonte' e ao mesmo tempo 'Entrega fora do horizonte' — textos contraditórios
- Sugestões não batem com Alvo − disponível − confirmados (Garrafa 2 vs 6; Toalha 15 vs 18; Pote 5 vs 12; Ventilador 19 ou 25 vs 20) e lote/mínimo de compra não é exibido na tela para justificar o arredondamento
- Concordância '1 disponíveis' (singular com plural)
- Pote plástico com 26 disponíveis + 12 confirmados (38) abaixo do alvo de 43 aparece como 'A repor', mas sugere 12 sem explicitar lote

### Tela 46 — Planejamento de compras e reposição (parte 3 de 3) (p. 72)

Grupo: Análise e planejamento

**Objetivo:** Continuação: últimas linhas da tabela, rodapé de contagem, barra de seleção com total e ações de revisão, critérios da sugestão e aviso de demonstração.

**Ponto de atenção**
- Parte 3 de 3 da mesma visão. A divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo. Visão principal e comentários na página 70.

**Regiões da tela**
- Menu lateral escuro (recortado)
- Últimas linhas da tabela 'Sugestões de reposição'
- Rodapé da tabela: '7 produto(s) exibido(s) · a seleção pode incluir itens fora do filtro.'
- Barra/cartão de seleção com resumo à esquerda e botões à direita
- Seção expansível 'Critérios da sugestão'
- Aviso de demonstração com ícone de frasco

**Campos observados**
- Linha: Detergente neutro 500 ml (PRD-0087 · ABC C; Limpeza Atacado; 20 disponíveis; 24 confirmados no horizonte; 12 UN; Alvo: 48 UN; A repor; Comprar 12; Sugestão aplicada; R$ 33,60; R$ 2,80 / UN)
- Linha: Lâmpada LED 9 W (PRD-0109 · ABC —; Fornecedor a definir; 2 disponíveis; 0 confirmados no horizonte; 10 UN; Alvo: 6 UN; Completar dados; Comprar 10; Sugestão aplicada; Estimativa '—'; 'Custo não informado')
- Rodapé: '7 produto(s) exibido(s) · a seleção pode incluir itens fora do filtro.'
- Resumo da seleção: quantidade selecionada · valor (0 selecionado(s) · R$ 0,00)
- Destino e condições: 'Destino: Centro · sem frete e encargos adicionais.'
- Aviso: 'Demonstração. Nenhum pedido é enviado a fornecedores; estoque e financeiro não são alterados.'

**Botões e ações observados**
- Checkbox de seleção em cada linha (2)
- Links de produto: Detergente neutro 500 ml, Lâmpada LED 9 W
- Link 'Usar sugestão' em cada linha (2)
- Campo 'Comprar' editável em cada linha
- Limpar seleção (botão secundário; desabilitado sem seleção)
- Revisar selecionados (botão primário laranja; desabilitado/esmaecido sem seleção)
- Expansor '▸ Critérios da sugestão'

**Colunas de tabelas**
- Sugestões de reposição: (checkbox)
- Sugestões de reposição: Produto / fornecedor
- Sugestões de reposição: Estoque e pedidos
- Sugestões de reposição: Sugestão
- Sugestões de reposição: Comprar
- Sugestões de reposição: Estimativa

**Indicadores / cartões / gráficos**
- Resumo da seleção (0 selecionado(s) · R$ 0,00)
- Contagem '7 produto(s) exibido(s)'

**Estados e selos**
- Selo 'A repor' (azul claro)
- Selo 'Completar dados' (laranja)
- 'ABC —' (produto sem classe)
- 'Fornecedor a definir'
- 'Custo não informado' com estimativa '—'
- Botões em estado desabilitado

**Regras e políticas ilustradas (exemplos)**
- Estimativa = quantidade × custo unitário (12 × 2,80 = 33,60)
- Produto sem fornecedor e sem custo recebe selo 'Completar dados' e estimativa '—' (Custo não informado)
- Sugestão pode exceder a necessidade líquida por lote/mínimo (Detergente 48 − 20 − 24 = 4 → 12; Lâmpada 6 − 2 − 0 = 4 → 10)
- Seleção pode incluir itens fora do filtro atual (seleção persiste ao trocar filtro)
- Total da seleção desconsidera frete e encargos adicionais
- Ações 'Limpar seleção' e 'Revisar selecionados' habilitadas apenas com itens selecionados
- Revisão gera rascunhos por fornecedor (contador 'Rascunhos'); nenhum pedido é enviado na prévia
- Lista filtrada 'A repor' exibe 7 produtos (PRD-0103 e PRD-0108 da Tela 45 não aparecem)

**Inconsistências do protótipo**
- Lâmpada LED 9 W sugere 10 UN com Alvo de 6 UN e apenas 2 disponíveis, sem lote/mínimo visível que justifique
- Lâmpada LED aparece 'Sem classe' na Tela 45 (receita R$ 0,00) e aqui como 'ABC —' — notação diferente para o mesmo estado
- Plurais genéricos 'produto(s) exibido(s)' e 'selecionado(s)'
- Soma das estimativas visíveis (R$ 2.836,00 sem a lâmpada) não aparece em lugar algum enquanto nada estiver selecionado

### Tela 46 — Detalhamento da sugestão de reposição (p. 73)

_Visão complementar: Tela 46: Detalhamento da sugestão de reposição (visão principal na página 70)_

Grupo: Análise e planejamento

**Objetivo:** Mostra o estoque disponível, o consumo, o alvo, as entregas e os dados comerciais usados para calcular a sugestão de compra de um produto (O que este detalhe mostra).

**Principais ações (comentário)**
- (Página de detalhe: não tem bloco 'Principais ações'.) Ligação com a tela: complementa a Tela 46, Planejamento de compras e reposição; visão principal e comentários gerais na página 70.

**Ponto de atenção**
- Comentário: rascunhos não equivalem a mercadoria recebida nem eliminam o risco de falta antes da entrega.
- Alerta na tela: 'O consumo projetado pode esgotar o saldo antes do prazo de uma nova compra. Avalie antecipar entregas ou transferir estoque.'
- Alerta na tela: 'Há entrega fora do horizonte. Confira a possibilidade de antecipá-la antes de acrescentar outra compra.'

**Regiões da tela**
- Cartão de detalhe isolado, centralizado, sem menu lateral nem cabeçalho do sistema
- Cabeçalho do cartão: link 'Voltar' à esquerda, título com o nome do produto e subtítulo 'código · filial · unidade'
- Grade de indicadores 3x3 (rótulo pequeno em cinza acima do valor)
- Faixa informativa azul com horizonte, lote mínimo e múltiplo de compra
- Dois alertas em laranja-claro (risco de ruptura; entrega fora do horizonte)
- Seção 'Pedidos já em aberto' com tabela
- Seção 'Parâmetros desta simulação' com formulário de 3 colunas
- Rodapé de ações: botão primário laranja 'Aplicar à prévia' e botão secundário 'Cancelar'

**Campos observados**
- Nome do produto, no título (Ventilador de mesa 40 cm)
- Código do produto · filial · unidade, no subtítulo (PRD-0102 · Centro · unidade UN)
- Estoque físico (2 UN)
- Reservas (1 UN)
- Disponível (1 UN)
- Consumo médio (1,2 UN/dia)
- Estoque mínimo (4 UN)
- Alvo calculado (26 UN)
- Confirmado no horizonte (6 UN)
- Já em rascunho (0 UN)
- Sugestão de compra (20 UN)
- Horizonte: quantidade de dias e data-limite (21 dias, até 15/10/2026)
- Lote mínimo (4 UN)
- Múltiplo de compra (4 UN)
- Pedido, coluna da tabela de pedidos em aberto (PC-0311, PC-0312)
- Saldo a receber (6 UN; 12 UN)
- Previsão, data de entrega (02/10/2026; 30/10/2026)
- No cálculo, situação do pedido no cálculo (Considerado; Após o horizonte)
- Fornecedor (lista suspensa) (Eletro Comercial)
- Custo estimado / UN (R$) (campo numérico) (86.00)
- Prazo estimado (dias) (campo numérico inteiro) (7)

**Botões e ações observados**
- Voltar (link no cabeçalho do cartão; volta à visão principal da Tela 46)
- Lista suspensa Fornecedor (troca o fornecedor simulado)
- Campo editável Custo estimado / UN (R$)
- Campo editável Prazo estimado (dias)
- Aplicar à prévia (botão primário laranja)
- Cancelar (botão secundário)

**Abas / etapas**
- Sem abas. Seções: indicadores de estoque e cálculo; Pedidos já em aberto; Parâmetros desta simulação

**Colunas de tabelas**
- Pedidos já em aberto: Pedido | Saldo a receber | Previsão | No cálculo

**Indicadores / cartões / gráficos**
- Estoque físico (2 UN)
- Reservas (1 UN)
- Disponível (1 UN)
- Consumo médio (1,2 UN/dia)
- Estoque mínimo (4 UN)
- Alvo calculado (26 UN)
- Confirmado no horizonte (6 UN)
- Já em rascunho (0 UN)
- Sugestão de compra (20 UN)

**Estados e selos**
- No cálculo: 'Considerado' (pedido dentro do horizonte)
- No cálculo: 'Após o horizonte' (pedido fora do horizonte)
- Faixa informativa azul (parâmetros do horizonte e do lote)
- Alerta laranja: risco de esgotar o saldo antes do prazo da nova compra
- Alerta laranja: entrega fora do horizonte

**Regras e políticas ilustradas (exemplos)**
- Disponível = Estoque físico − Reservas (2 − 1 = 1 UN)
- O horizonte de planejamento conta a partir da data da simulação (24/09/2026 + 21 dias = 15/10/2026)
- Pedidos em aberto com previsão dentro do horizonte entram no cálculo como 'Confirmado no horizonte' (PC-0311, 6 UN); os de previsão posterior ficam fora ('Após o horizonte', PC-0312, 12 UN)
- Pelos números de exemplo, Sugestão de compra = Alvo − Disponível − Confirmado no horizonte − Já em rascunho, arredondada para cima até o múltiplo de compra (26 − 1 − 6 − 0 = 19, arredondado para 20 UN com múltiplo 4)
- A sugestão respeita o lote mínimo (4 UN) e o múltiplo de compra (4 UN)
- O alvo calculado parece ser Consumo médio × Horizonte, arredondado para cima (1,2 × 21 = 25,2, arredondado para 26)
- Alerta de ruptura quando o disponível não cobre o consumo projetado até o prazo da nova compra (1 UN disponível, 1,2 UN/dia, prazo de 7 dias)
- Quando há entrega fora do horizonte, recomenda-se avaliar antecipá-la antes de acrescentar outra compra
- Os parâmetros de fornecedor, custo e prazo valem só para a simulação e são aplicados à prévia (o custo de 86,00 e o prazo de 7 dias batem com a proposta da Eletro Comercial na Tela 47)
- Quantidade em rascunho é abatida da sugestão, mas não conta como estoque recebido

**Inconsistências do protótipo**
- 'Custo estimado / UN (R$)' mostra '86.00', com ponto decimal; no resto do protótipo os valores usam vírgula (R$ 86,00)
- O 'Estoque mínimo' (4 UN) não parece entrar no 'Alvo calculado' (26 UN ≈ 1,2 × 21); a fórmula do alvo não está explícita
- O número do pedido segue o formato 'PC-0311'/'PC-0312', diferente do 'PC-COT-DEMO-0001' usado na Tela 48
- O detalhe não mostra o shell do sistema (menu e cabeçalho), ao contrário das telas principais

### Tela 47 — Cotação e comparação de fornecedores (p. 74)

Grupo: Análise e planejamento

**Objetivo:** Compara as propostas para decidir de quem comprar cada produto, considerando os preços líquidos e as condições que afetam o total da compra.

**Principais ações (comentário)**
- Revisar preço, desconto, frete e prazo.
- Escolher fornecedores por item ou pelo menor total.
- Conferir a escolha e gerar rascunhos demonstrativos.

**Ponto de atenção**
- O menor preço unitário não garante a menor compra total. O comparativo considera frete por fornecedor, mínimos, validade, disponibilidade e atendimento ao prazo.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, trilha 'Compras / Cotações', seletor de empresa e avatar do usuário (HB)
- Menu lateral escuro com a seção PRINCIPAL e o item 'Compras' ativo
- Título da página 'Cotação de fornecedores' e subtítulo 'Compare propostas e escolha onde comprar cada produto.'
- Botão 'Rascunhos 0' no canto superior direito do conteúdo
- Cartão-resumo da cotação (código, filial, resumo e selo de situação)
- Barra de controle: caixa 'Somente entregas no prazo' e botão 'Selecionar menor total com frete'
- Matriz de comparação: primeira coluna 'Produto / demanda' e uma coluna por fornecedor, com o cabeçalho de condições comerciais
- Linhas por produto, com cartões de proposta selecionáveis (radio) em cada coluna de fornecedor

**Campos observados**
- Empresa (lista suspensa no cabeçalho) (Varejo Exemplo)
- Trilha de navegação (Compras / Cotações)
- Contador de rascunhos (Rascunhos 0)
- Código da cotação · filial (CT-DEMO-0047 · Filial Centro)
- Resumo da cotação: produtos da reposição · fornecedores · data da simulação (3 produtos da reposição · 3 fornecedores · simulação em 24/09/2026)
- Situação da cotação (Em comparação)
- Somente entregas no prazo (caixa de seleção, marcada)
- Instrução da coluna de produtos ('Escolha uma proposta por item')
- Fornecedor, no cabeçalho da coluna (Eletro Comercial; Casa & Utilidades; Atacado Cariri)
- Frete do fornecedor (R$ 60,00; R$ 25,00; R$ 90,00)
- Pagamento, em dias (28 dias; 21 dias; 14 dias)
- Válida até, data de validade da proposta (28/09/2026; 27/09/2026; 30/09/2026)
- Mínimo, valor mínimo do pedido (R$ 100,00; R$ 0,00; R$ 500,00)
- Produto: nome (Cafeteira elétrica 15 xícaras)
- Produto: código (PRD-0101)
- Produto: quantidade demandada (4 UN)
- Produto: Necessário até (30/09/2026)
- Proposta: seleção (radio)
- Proposta: preço líquido por UN (R$ 117,60; R$ 120,00; R$ 115,00)
- Proposta: desconto (2% de desconto; 4% de desconto; Sem desconto)
- Proposta: data de entrega (Entrega 29/09/2026; 28/09/2026; 02/10/2026)

**Botões e ações observados**
- Seletor de empresa no cabeçalho
- Avatar do usuário 'HB' (menu do usuário)
- Itens do menu lateral (Visão geral, Vendas, Estoque, Compras, Financeiro, Relatórios, Configurações)
- Rascunhos 0 (botão com contador)
- Caixa de seleção 'Somente entregas no prazo'
- Selecionar menor total com frete (botão)
- Editar proposta (link em cada coluna de fornecedor: Eletro Comercial, Casa & Utilidades, Atacado Cariri)
- Radio de seleção da proposta em cada cartão (uma por item)

**Abas / etapas**
- Sem abas. Parte 1 de 2 da mesma visão

**Colunas de tabelas**
- Matriz de comparação: Produto / demanda | Eletro Comercial | Casa & Utilidades | Atacado Cariri (uma coluna por fornecedor cotado)

**Filtros**
- Somente entregas no prazo (caixa de seleção, marcada)

**Indicadores / cartões / gráficos**
- Cartão da cotação: CT-DEMO-0047 · Filial Centro (3 produtos da reposição · 3 fornecedores · simulação em 24/09/2026)
- Cartões de condições por fornecedor (Frete, Pagamento, Válida até, Mínimo)
- Cartões de proposta por produto e fornecedor (preço líquido, desconto, entrega)

**Estados e selos**
- Em comparação (selo azul da cotação)
- Menor unitário (selo verde)
- Após a data necessária (texto vermelho; cartão cinza e radio desabilitado)
- Proposta selecionada (cartão com borda e fundo azul, radio marcado)
- Proposta disponível não selecionada (radio vazio)
- 2% de desconto / 4% de desconto / Sem desconto

**Itens de menu**
- PRINCIPAL
- Visão geral
- Vendas
- Estoque
- Compras (ativo)
- Financeiro
- Relatórios
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Escolhe-se uma proposta por item (seleção exclusiva por produto)
- Os preços exibidos são líquidos por UN, com o desconto já aplicado (R$ 117,60 com 2% de desconto)
- Frete fixo por fornecedor (R$ 60,00 / R$ 25,00 / R$ 90,00)
- Valor mínimo de pedido por fornecedor (R$ 100,00 / R$ 0,00 / R$ 500,00)
- Cada proposta tem data de validade (Válida até)
- Com 'Somente entregas no prazo' marcado, a proposta com entrega posterior à data necessária fica indisponível (Atacado Cariri: entrega 02/10/2026, necessário até 30/09/2026)
- 'Menor unitário' indica o menor preço líquido entre as propostas que atendem ao prazo
- 'Selecionar menor total com frete' escolhe a combinação de menor custo total, considerando frete, mínimos e prazo

**Inconsistências do protótipo**
- O selo 'Menor unitário' está na Eletro Comercial (R$ 117,60), mas a Atacado Cariri tem preço menor (R$ 115,00). O selo parece considerar só as propostas que atendem ao prazo, e o critério não está explícito
- O cabeçalho difere da Tela 48: aqui há trilha 'Compras / Cotações', seletor sem rótulo e avatar 'HB'; na Tela 48 há seletores rotulados 'Empresa' e 'Perfil na prévia', sem trilha nem avatar
- A tela está no grupo 'Análise e planejamento', mas o menu destaca 'Compras'

### Tela 47 — Cotação e comparação de fornecedores (parte 2 de 2) (p. 75)

Grupo: Análise e planejamento

**Objetivo:** Continuação (parte 2 de 2) da mesma visão. Contexto: compara as propostas para decidir de quem comprar cada produto, considerando os preços líquidos e as condições que afetam o total da compra.

**Principais ações (comentário)**
- Consulta: Tela 47, Cotação e comparação de fornecedores; visão principal e comentários na página 74.

**Ponto de atenção**
- Continuação: a divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo.

**Regiões da tela**
- Menu lateral escuro (continuação)
- Restante da matriz de comparação: linhas Ventilador de mesa 40 cm e Garrafa térmica 1 L
- Rodapé da matriz com a nota de preços líquidos
- Painel 'Sua seleção' com totais, link 'Limpar seleção', contagem e botão primário 'Revisar escolha'
- Nota de demonstração com ícone de frasco de laboratório

**Campos observados**
- Produto: nome (Ventilador de mesa 40 cm; Garrafa térmica 1 L)
- Produto: código (PRD-0102; PRD-0104)
- Produto: quantidade demandada (20 UN; 6 UN)
- Produto: Necessário até (01/10/2026; 30/09/2026)
- Proposta: seleção (radio)
- Proposta: preço líquido por UN (Ventilador: R$ 86,00 / R$ 88,00 / R$ 84,00; Garrafa: sem proposta / R$ 42,00 / R$ 38,00)
- Proposta: desconto (Sem desconto; 5% de desconto)
- Proposta: data de entrega (Entrega 01/10/2026; 27/09/2026; 30/09/2026; 28/09/2026)
- Proposta: disponibilidade parcial (Disponível: 12 de 20 UN)
- Proposta: ausência de cotação (Sem proposta / Não cotado)
- Nota da matriz ('Preços líquidos por UN · descontos já aplicados · frete fixo por fornecedor escolhido.')
- Sua seleção: Produtos (R$ 2.442,40)
- Sua seleção: Frete total (R$ 85,00)
- Sua seleção: Total da seleção (R$ 2.527,40)
- Nota: 'Frete cobrado uma vez por fornecedor. Outros acréscimos: R$ 0,00 nesta prévia.'
- Contagem: produtos selecionados de total · nº de fornecedores (3 de 3 produtos · 2 fornecedor(es))
- Aviso de demonstração ('Demonstração com fornecedores fictícios. Nenhum pedido é enviado; estoque e financeiro não são alterados.')

**Botões e ações observados**
- Radio de seleção da proposta em cada cartão
- Limpar seleção (link)
- Revisar escolha (botão primário laranja; abre a revisão dos fornecedores selecionados)

**Abas / etapas**
- Sem abas. Parte 2 de 2 da mesma visão

**Colunas de tabelas**
- Matriz de comparação (continuação): Produto / demanda | Eletro Comercial | Casa & Utilidades | Atacado Cariri

**Indicadores / cartões / gráficos**
- Sua seleção, Produtos (R$ 2.442,40)
- Sua seleção, Frete total (R$ 85,00)
- Sua seleção, Total da seleção (R$ 2.527,40, destacado em azul)
- Contagem de seleção (3 de 3 produtos · 2 fornecedor(es))

**Estados e selos**
- Menor unitário (selo verde; Atacado Cariri no ventilador e na garrafa)
- Disponível: 12 de 20 UN (texto vermelho; cartão cinza e radio desabilitado)
- Sem proposta / Não cotado (texto vermelho; cartão cinza e radio desabilitado)
- Proposta selecionada (cartão azul; Eletro Comercial no ventilador, Casa & Utilidades na garrafa)
- Sem desconto / 5% de desconto

**Regras e políticas ilustradas (exemplos)**
- Proposta com disponibilidade parcial não pode ser escolhida (Casa & Utilidades: 12 de 20 UN)
- Fornecedor sem cotação para o item aparece como 'Sem proposta / Não cotado' e não é selecionável
- O frete é cobrado uma vez por fornecedor escolhido (Eletro R$ 60,00 + Casa R$ 25,00 = R$ 85,00)
- Produtos = Σ quantidade × preço líquido (4 × 117,60 + 20 × 86,00 + 6 × 42,00 = 2.442,40)
- Total da seleção = Produtos + Frete total + Outros acréscimos (2.442,40 + 85,00 + 0,00 = 2.527,40)
- É possível escolher uma proposta que não tem o selo 'Menor unitário' (ventilador na Eletro a R$ 86,00, com a Atacado a R$ 84,00)
- A demonstração não envia pedidos nem altera estoque e financeiro

**Inconsistências do protótipo**
- A seleção mostrada (Eletro: cafeteira e ventilador; Casa: garrafa; total R$ 2.527,40) não é a mesma da página de revisão (Casa: cafeteira; Atacado: ventilador e garrafa; total R$ 2.503,00). A revisão corresponde à combinação de 'menor total com frete', não à seleção exibida
- Rótulos diferentes para os mesmos conceitos: 'Frete total'/'Total da seleção' aqui; 'Fretes'/'Total estimado' na revisão

### Tela 47 — Revisão dos fornecedores selecionados (p. 76)

_Visão complementar: Tela 47: Revisão dos fornecedores selecionados (título interno 'Revisar fornecedores escolhidos')_

Grupo: Análise e planejamento

**Objetivo:** Os itens selecionados são agrupados por fornecedor, com seus fretes e condições de pagamento (bloco 'O que este detalhe mostra').

**Principais ações (comentário)**
- (Página de detalhe: não tem bloco 'Principais ações'.) Ligação com a tela: complementa a Tela 47, Cotação e comparação de fornecedores; a visão principal e os comentários gerais estão na página 74.
- Principais ações da Tela 47 (página 74), para contexto: revisar preço, desconto, frete e prazo; escolher fornecedores por item ou pelo menor total; conferir a escolha e gerar rascunhos demonstrativos.

**Ponto de atenção**
- Comentário: confirmar prazos, valores e eventuais pendências antes de criar os rascunhos.

**Regiões da tela**
- Cartão de detalhe isolado, centralizado, sem menu lateral nem barra superior do sistema
- Cabeçalho do cartão: link 'Voltar e ajustar' à esquerda, título 'Revisar fornecedores escolhidos' e subtítulo (cotação · destino · nº de produtos), separado por linha
- Faixa de totais com 3 indicadores lado a lado (Produtos, Fretes, Total estimado)
- Bloco do fornecedor Casa & Utilidades: nome em negrito, linha de condições, tabela de itens e linha de totais alinhada à direita
- Bloco do fornecedor Atacado Cariri: nome, condições, tabela com 2 itens e linha de totais
- Nota explicativa sobre a criação de rascunhos, abaixo dos blocos
- Rodapé do cartão (fundo cinza claro): contagem de rascunhos à esquerda e botão primário laranja 'Criar rascunhos na prévia' à direita
- Cabeçalho da página do guia: trilha 'TELA 47 / ANÁLISE E PLANEJAMENTO / DETALHE' e link 'SUMÁRIO'
- Rodapé da página do guia: três blocos de texto (O que este detalhe mostra; Comentário; Ligação com a tela)

**Campos observados**
- Título do cartão (Revisar fornecedores escolhidos)
- Código da cotação (CT-DEMO-0047)
- Destino / filial (destino Centro)
- Nº de produtos (3 produtos)
- Produtos, total geral (R$ 2.388,00)
- Fretes, total geral (R$ 115,00)
- Total estimado (R$ 2.503,00)
- Fornecedor, título do bloco (Casa & Utilidades; Atacado Cariri)
- Pagamento, prazo em dias (21 dias; 14 dias)
- Proposta válida até (27/09/2026; 30/09/2026)
- Produto: nome (Cafeteira elétrica 15 xícaras; Ventilador de mesa 40 cm; Garrafa térmica 1 L)
- Produto: data de entrega, abaixo do nome (Entrega 28/09/2026; Entrega 30/09/2026; Entrega 28/09/2026)
- Quantidade com unidade (4 UN; 20 UN; 6 UN)
- Líquido / UN (R$ 120,00; R$ 84,00; R$ 38,00)
- Desconto, abaixo do preço líquido, só quando houver (Desconto 4% na cafeteira; Desconto 5% na garrafa; ventilador sem desconto)
- Subtotal do item (R$ 480,00; R$ 1.680,00; R$ 228,00)
- Totais por fornecedor, Produtos (R$ 480,00; R$ 1.908,00)
- Totais por fornecedor, Frete (R$ 25,00; R$ 90,00)
- Totais por fornecedor, Total, em negrito (R$ 505,00; R$ 1.998,00)
- Nota (Será criado um rascunho por fornecedor, com o frete cobrado uma única vez.)
- Contagem de rascunhos a criar (2 rascunho(s) demonstrativo(s))

**Botões e ações observados**
- Voltar e ajustar (link azul no cabeçalho; volta à matriz de comparação para mudar a escolha)
- Criar rascunhos na prévia (botão primário laranja no rodapé do cartão; cria um rascunho de pedido por fornecedor)
- SUMÁRIO (link de navegação do guia, no canto superior direito da página; não faz parte da tela)

**Abas / etapas**
- Sem abas. Seções por fornecedor: Casa & Utilidades; Atacado Cariri

**Colunas de tabelas**
- Itens de Casa & Utilidades: Produto (nome + 'Entrega dd/mm/aaaa' abaixo) | Quantidade | Líquido / UN (com 'Desconto x%' abaixo, quando houver) | Subtotal (alinhado à direita)
- Itens de Atacado Cariri: Produto (nome + 'Entrega dd/mm/aaaa' abaixo) | Quantidade | Líquido / UN (com 'Desconto x%' abaixo, quando houver) | Subtotal (alinhado à direita)
- Linha de totais de cada fornecedor (abaixo da tabela): Produtos R$ … | Frete R$ … | Total R$ … (em negrito)

**Indicadores / cartões / gráficos**
- Produtos (R$ 2.388,00)
- Fretes (R$ 115,00)
- Total estimado (R$ 2.503,00, em azul e negrito)
- Totais por fornecedor: Casa & Utilidades (Produtos R$ 480,00 · Frete R$ 25,00 · Total R$ 505,00); Atacado Cariri (Produtos R$ 1.908,00 · Frete R$ 90,00 · Total R$ 1.998,00)

**Estados e selos**
- Desconto 4% / Desconto 5% (texto auxiliar cinza abaixo do preço líquido, não é selo)
- 2 rascunho(s) demonstrativo(s) (texto de rodapé indicando modo de demonstração/prévia)

**Regras e políticas ilustradas (exemplos)**
- Um rascunho de pedido por fornecedor (2 fornecedores = 2 rascunhos)
- Frete cobrado uma única vez por fornecedor, independentemente do nº de itens
- Preço exibido é líquido por unidade, com o desconto já aplicado; o percentual de desconto aparece abaixo
- Subtotal = Quantidade × Líquido/UN (4 × 120,00 = 480,00; 20 × 84,00 = 1.680,00; 6 × 38,00 = 228,00)
- Produtos do fornecedor = soma dos subtotais (1.680,00 + 228,00 = 1.908,00)
- Total do fornecedor = Produtos + Frete (480,00 + 25,00 = 505,00; 1.908,00 + 90,00 = 1.998,00)
- Produtos geral = 480,00 + 1.908,00 = 2.388,00; Fretes geral = 25,00 + 90,00 = 115,00; Total estimado = 2.503,00
- Mínimo do fornecedor atendido: Atacado Cariri tem mínimo de R$ 500,00 (informado na matriz, página 74) e o pedido soma R$ 1.908,00; Casa & Utilidades tem mínimo R$ 0,00
- Os valores e condições (frete, pagamento, validade, desconto, entrega) vêm da matriz de cotação da Tela 47 (Casa: frete 25, 21 dias, válida até 27/09; Atacado: frete 90, 14 dias, válida até 30/09)
- Os rascunhos são demonstrativos e criados apenas na prévia; nenhum pedido é enviado ao fornecedor
- A combinação mostrada corresponde ao menor total com frete (cafeteira na Casa & Utilidades; ventilador e garrafa no Atacado Cariri)

**Inconsistências do protótipo**
- Os itens e o total (R$ 2.503,00) não batem com a seleção mostrada na parte 2 da Tela 47 (página 75: 'Sua seleção' com R$ 2.442,40 + frete R$ 85,00 = R$ 2.527,40, usando Eletro Comercial e Casa & Utilidades), embora o botão 'Revisar escolha' leve a esta revisão
- Rótulos diferentes para os mesmos totais: 'Fretes' e 'Total estimado' aqui; 'Frete total' e 'Total da seleção' na matriz
- Subtítulo usa 'destino Centro', enquanto a matriz usa 'Filial Centro'
- A revisão não mostra o código do produto (PRD-0101 etc.) nem a data necessária, que aparecem na matriz e na análise da Tela 48
- O ventilador não exibe 'Sem desconto' aqui (simplesmente omite), enquanto a matriz escreve 'Sem desconto'

### Tela 48 — Aprovação de compras (p. 77)

Grupo: Análise e planejamento

**Objetivo:** Submete a solicitação à decisão dos responsáveis, mostrando pedidos, fretes, prazos e histórico antes de aprovar, devolver para ajuste ou rejeitar.

**Principais ações (comentário)**
- Filtrar a fila e analisar a solicitação.
- Revisar a decisão e registrar o motivo.
- Acompanhar o parecer do gestor e da diretoria.

**Ponto de atenção**
- A alçada ilustrativa considera o total com frete. Compras acima de R$ 5 mil exigem duas etapas; solicitação própria e proposta vencida têm bloqueios específicos na prévia.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT e os seletores rotulados 'Empresa' e 'Perfil na prévia'
- Menu lateral escuro com a seção PRINCIPAL e o item 'Compras' ativo
- Título 'Aprovação de compras', subtítulo e data da simulação à direita
- Faixa informativa azul com o perfil e a alçada do usuário
- Barra de filtros (Filial, Situação) com contador e valor total à direita
- Tabela da fila de solicitações com nota de rodapé sobre a alçada
- Painel expansível 'Política de aprovação desta prévia'
- Nota de demonstração com ícone de frasco de laboratório

**Campos observados**
- Empresa (lista suspensa no cabeçalho) (Varejo Exemplo)
- Perfil na prévia (lista suspensa no cabeçalho) (Hércules · Gestor)
- Data da simulação (Simulação · 24/09/2026)
- Faixa de perfil ('Seu perfil: Gestor · aprovação final até R$ 5.000,00; acima disso, parecer para a diretoria.')
- Filial (lista suspensa de filtro) (Todas as filiais)
- Situação (lista suspensa de filtro) (Em análise)
- Contador da fila: nº de solicitações · valor total (4 solicitação(ões) · R$ 9.935,20)
- Solicitação: código (SC-DEMO-0047; 0048; 0049; 0050)
- Solicitação: descrição (Reposição de eletro e utilidades; Reposição de ventiladores; Compra solicitada pelo gestor; Reposição de material de limpeza)
- Solicitação: nº de pedidos · hora (2 pedido(s) · 09:15; 1 pedido(s) · 09:22; 09:35; 09:40)
- Filial (Centro; Crato; Barbalha; Centro)
- Solicitante (Compras · Centro; Compras · Crato; Hércules Benevides; Compras · Centro)
- Total com frete (R$ 2.503,00; R$ 6.850,00; R$ 500,00; R$ 82,20)
- Situação / etapa (Aguardando gestor)
- Alerta da linha (Prazo de entrega a revisar; Solicitação própria; Proposta vencida)
- Nota da tabela ('A alçada considera o total da solicitação, incluindo todos os pedidos e fretes.')
- Aviso de demonstração ('Demonstração. Decisões ficam nesta prévia; fornecedores, estoque e financeiro não são alterados.')

**Botões e ações observados**
- Seletor Empresa
- Seletor Perfil na prévia (troca o perfil simulado)
- Itens do menu lateral (Visão geral, Vendas, Estoque, Compras, Financeiro, Relatórios, Configurações)
- Filtro Filial (lista suspensa)
- Filtro Situação (lista suspensa)
- Analisar (link em cada linha; abre a análise da solicitação)
- ▸ Política de aprovação desta prévia (painel expansível)

**Abas / etapas**
- Sem abas

**Colunas de tabelas**
- Fila de solicitações: Solicitação (código, descrição, nº de pedidos · hora) | Filial / solicitante | Total com frete | Situação / etapa | Análise

**Filtros**
- Filial (Todas as filiais)
- Situação (Em análise)

**Indicadores / cartões / gráficos**
- Contador da fila: 4 solicitação(ões) · R$ 9.935,20
- Faixa de alçada do perfil (Gestor: aprovação final até R$ 5.000,00)

**Estados e selos**
- Aguardando gestor (selo azul)
- Prazo de entrega a revisar (alerta em laranja/vermelho)
- Solicitação própria (alerta em laranja/vermelho)
- Proposta vencida (alerta em laranja/vermelho)

**Itens de menu**
- PRINCIPAL
- Visão geral
- Vendas
- Estoque
- Compras (ativo)
- Financeiro
- Relatórios
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Alçada do Gestor: aprovação final até R$ 5.000,00; acima disso, a solicitação segue com parecer para a diretoria (duas etapas)
- A alçada considera o total da solicitação, incluindo todos os pedidos e fretes (Total com frete)
- Bloqueio de solicitação própria: o gestor não aprova a própria solicitação (SC-DEMO-0049, do próprio Hércules Benevides)
- Bloqueio de proposta vencida: proposta fora da validade na data da simulação (SC-DEMO-0050)
- Alerta de prazo de entrega a revisar (SC-DEMO-0048)
- SC-DEMO-0048 (R$ 6.850,00) supera R$ 5.000,00 e por isso exige duas etapas (gestor e diretoria)
- O contador soma os totais da fila filtrada (2.503,00 + 6.850,00 + 500,00 + 82,20 = 9.935,20)
- O perfil da prévia define o que o usuário pode decidir

**Inconsistências do protótipo**
- O filtro 'Situação' mostra 'Em análise', mas os selos das linhas dizem 'Aguardando gestor' (vocabulário diferente)
- A fila não indica que SC-DEMO-0048 (acima de R$ 5 mil) vai exigir a etapa da diretoria; só mostra 'Aguardando gestor'
- O cabeçalho difere da Tela 47: aqui há seletores rotulados 'Empresa'/'Perfil na prévia', sem trilha nem avatar; lá há trilha 'Compras / Cotações' e avatar 'HB'
- A coluna 'Solicitante' mistura setor · filial ('Compras · Centro') com nome de pessoa ('Hércules Benevides')
- A hora da solicitação aparece sem data (09:15)

### Tela 48 — Análise de uma solicitação de compra (parte 1 de 2) (p. 78)

_Visão complementar: Tela 48: Análise de uma solicitação de compra (detalhe, parte 1 de 2)_

Grupo: Análise e planejamento

**Objetivo:** A análise reúne os pedidos da solicitação, seus totais e os dados necessários ao parecer (bloco 'O que este detalhe mostra').

**Principais ações (comentário)**
- (Página de detalhe: não tem bloco 'Principais ações'.) Ligação com a tela: complementa a Tela 48, Aprovação de compras; a visão principal e os comentários gerais estão na página 77.
- Principais ações da Tela 48 (página 77), para contexto: filtrar a fila e analisar a solicitação; revisar a decisão e registrar o motivo; acompanhar o parecer do gestor e a diretoria.

**Ponto de atenção**
- Comentário: registrar motivos, respeitar as alçadas e distinguir a aprovação interna do envio ao fornecedor.
- Ponto de atenção da Tela 48 (página 77), para contexto: a alçada ilustrativa considera o total com frete; compras acima de R$ 5 mil exigem duas etapas; solicitação própria e proposta vencida têm bloqueios específicos na prévia.

**Regiões da tela**
- Cartão de detalhe isolado, centralizado, sem menu lateral nem barra superior do sistema
- Cabeçalho do cartão: link 'Voltar à fila' à esquerda, título (código · descrição), subtítulo (filial · cotação · revisão) e selo de situação no canto direito
- Faixa de 3 indicadores lado a lado (Solicitante, Produtos / fretes, Total para alçada)
- Painel cinza das etapas de aprovação em duas colunas (1. Gestor; 2. Diretoria)
- Bloco do pedido Casa & Utilidades · PC-COT-DEMO-0001: condições, tabela de itens e linha de totais à direita
- Bloco do pedido Atacado Cariri · PC-COT-DEMO-0002: condições e cabeçalho da tabela visíveis; as linhas continuam na parte 2 (página 79)
- Cabeçalho da página do guia: trilha 'TELA 48 / ANÁLISE E PLANEJAMENTO / DETALHE / PARTE 1 DE 2' e link 'SUMÁRIO'
- Rodapé da página do guia: três blocos de texto (O que este detalhe mostra; Comentário; Ligação com a tela)

**Campos observados**
- Código da solicitação (SC-DEMO-0047)
- Descrição da solicitação (Reposição de eletro e utilidades)
- Filial (Centro)
- Cotação de origem (CT-DEMO-0047)
- Revisão (revisão 1)
- Situação da solicitação (Aguardando gestor)
- Solicitante (Compras · Centro)
- Produtos / fretes (R$ 2.388,00 / R$ 115,00)
- Total para alçada (R$ 2.503,00)
- Etapa 1. Gestor, situação da etapa (Análise pendente)
- Etapa 2. Diretoria, situação da etapa (Dispensada pela alçada)
- Fornecedor (Casa & Utilidades; Atacado Cariri)
- Número do pedido gerado (PC-COT-DEMO-0001; PC-COT-DEMO-0002)
- Pagamento, prazo em dias (21 dias; 14 dias)
- Proposta válida até (27/09/2026; 30/09/2026)
- Produto: nome (Cafeteira elétrica 15 xícaras)
- Produto: código (PRD-0101)
- Produto: data de entrega (Entrega 28/09/2026)
- Produto: data necessária (necessário 30/09/2026)
- Quantidade com unidade (4 UN)
- Líquido / UN (R$ 120,00)
- Subtotal do item (R$ 480,00)
- Totais do pedido, Produtos (R$ 480,00)
- Totais do pedido, Frete (R$ 25,00)
- Totais do pedido, Total, em negrito (R$ 505,00)

**Botões e ações observados**
- Voltar à fila (link azul no cabeçalho; retorna à fila de aprovação)
- SUMÁRIO (link de navegação do guia, no canto superior direito da página; não faz parte da tela)
- Nenhum botão de decisão (aprovar / devolver / rejeitar) visível nesta parte; provavelmente na parte 2 (página 79)

**Abas / etapas**
- Etapas de aprovação (indicador de etapas, não abas clicáveis): 1. Gestor (etapa atual, Análise pendente); 2. Diretoria (Dispensada pela alçada)
- Parte 1 de 2 da mesma visão (continua na página 79)

**Colunas de tabelas**
- Itens do pedido Casa & Utilidades · PC-COT-DEMO-0001: Produto (nome; código PRD abaixo; 'Entrega dd/mm/aaaa · necessário dd/mm/aaaa' abaixo) | Quantidade | Líquido / UN | Subtotal (alinhado à direita)
- Itens do pedido Atacado Cariri · PC-COT-DEMO-0002: Produto | Quantidade | Líquido / UN | Subtotal (só o cabeçalho visível; linhas na parte 2)
- Linha de totais de cada pedido (abaixo da tabela): Produtos R$ … | Frete R$ … | Total R$ … (em negrito)

**Indicadores / cartões / gráficos**
- Solicitante (Compras · Centro)
- Produtos / fretes (R$ 2.388,00 / R$ 115,00)
- Total para alçada (R$ 2.503,00, em azul e negrito)
- Etapa 1. Gestor (Análise pendente)
- Etapa 2. Diretoria (Dispensada pela alçada)
- Totais do pedido Casa & Utilidades (Produtos R$ 480,00 · Frete R$ 25,00 · Total R$ 505,00)

**Estados e selos**
- Aguardando gestor (selo azul claro no cabeçalho)
- Análise pendente (situação da etapa 1. Gestor)
- Dispensada pela alçada (situação da etapa 2. Diretoria)

**Regras e políticas ilustradas (exemplos)**
- Total para alçada = Produtos + Fretes (2.388,00 + 115,00 = 2.503,00); a alçada considera o total com frete
- Compras acima de R$ 5.000,00 exigem duas etapas; com R$ 2.503,00, a etapa da Diretoria fica 'Dispensada pela alçada'
- Aprovação em etapas sequenciais: 1. Gestor, depois 2. Diretoria; a situação da solicitação reflete a etapa atual (Aguardando gestor)
- Uma solicitação (SC) agrupa vários pedidos, um por fornecedor (PC-COT-DEMO-0001, PC-COT-DEMO-0002), todos originados da mesma cotação (CT-DEMO-0047)
- Total do pedido = Produtos + Frete (480,00 + 25,00 = 505,00); Subtotal = Quantidade × Líquido/UN (4 × 120,00 = 480,00)
- Cada item mostra a data de entrega e a data necessária, para conferir o atendimento ao prazo (28/09 ≤ 30/09)
- A solicitação tem controle de revisão (revisão 1), sugerindo nova revisão quando devolvida para ajuste
- Condições do fornecedor (pagamento e validade da proposta) acompanham cada pedido; proposta vencida gera bloqueio na prévia
- A aprovação interna é distinta do envio ao fornecedor

**Inconsistências do protótipo**
- As linhas de item não mostram o desconto (Desconto 4%), que aparece na revisão da Tela 47 e na matriz
- A revisão da Tela 47 não mostra código do produto nem data necessária, que aparecem aqui
- O número do pedido segue o formato 'PC-COT-DEMO-0001', diferente de 'PC-0311' usado na Tela 46
- Rótulos diferentes para o mesmo total: 'Total para alçada' aqui, 'Total com frete' na fila (página 77) e 'Total estimado' na Tela 47
- Rótulo 'Produtos / fretes' combina dois valores num só indicador, enquanto a Tela 47 os separa em 'Produtos' e 'Fretes'
- As duas etapas de aprovação têm o mesmo estilo visual; não há destaque da etapa atual (1. Gestor) além do texto

### Tela 48 — Análise de uma solicitação de compra (parte 2 de 2) (p. 79)

_Visão complementar: Tela 48: Análise de uma solicitação de compra_

Grupo: Análise e planejamento

**Objetivo:** Continuação (parte 2 de 2) da mesma visão. Contexto: a análise reúne os pedidos da solicitação, seus totais e os dados necessários ao parecer.

**Principais ações (comentário)**
- Consulta: Tela 48, Aprovação de compras; visão principal e comentários na página 77.

**Ponto de atenção**
- Continuação: a divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo.

**Regiões da tela**
- Continuação da tabela de itens do pedido da Atacado Cariri e linha de totais
- Seção 'Registrar decisão' com lista suspensa, área de texto, texto de ajuda e botão primário
- Painel expansível 'Histórico da solicitação'

**Campos observados**
- Produto: nome (Ventilador de mesa 40 cm; Garrafa térmica 1 L)
- Produto: código (PRD-0102; PRD-0104)
- Produto: entrega · necessário (Entrega 30/09/2026 · necessário 01/10/2026; Entrega 28/09/2026 · necessário 30/09/2026)
- Quantidade (20 UN; 6 UN)
- Líquido / UN (R$ 84,00; R$ 38,00)
- Subtotal (R$ 1.680,00; R$ 228,00)
- Totais do pedido: Produtos / Frete / Total (R$ 1.908,00 / R$ 90,00 / R$ 1.998,00)
- Decisão (lista suspensa; texto inicial 'Escolha uma decisão')
- Observação / motivo (área de texto; texto de exemplo 'Registre o motivo da sua decisão.')
- Ajuda do campo ('Observação opcional · até 500 caracteres.')
- Histórico da solicitação, com contagem de registros (1 registro(s))

**Botões e ações observados**
- Lista suspensa Decisão
- Área de texto Observação / motivo (redimensionável)
- Revisar decisão (botão primário laranja)
- ▸ Histórico da solicitação · 1 registro(s) (painel expansível)

**Abas / etapas**
- Sem abas. Seções: continuação dos itens do pedido; Registrar decisão; Histórico da solicitação (recolhido)

**Colunas de tabelas**
- Itens do pedido (continuação, Atacado Cariri · PC-COT-DEMO-0002): Produto (nome, código, entrega · necessário) | Quantidade | Líquido / UN | Subtotal

**Indicadores / cartões / gráficos**
- Totais do pedido Atacado Cariri (Produtos R$ 1.908,00 · Frete R$ 90,00 · Total R$ 1.998,00)

**Estados e selos**
- Histórico: 1 registro(s)

**Regras e políticas ilustradas (exemplos)**
- Total do pedido = Produtos + Frete (1.908,00 + 90,00 = 1.998,00)
- As decisões possíveis, pelo objetivo da tela, são aprovar, devolver para ajuste ou rejeitar (as opções da lista não aparecem)
- Observação opcional, limitada a 500 caracteres
- A decisão passa por uma revisão antes de ser confirmada ('Revisar decisão')
- O histórico guarda os registros da solicitação (1 registro)

**Inconsistências do protótipo**
- A observação é 'opcional', mas o comentário da tela e as principais ações pedem 'registrar o motivo'; não está definido se o motivo é obrigatório para devolver ou rejeitar
- As opções da lista 'Decisão' não aparecem; só o objetivo as cita (aprovar, devolver para ajuste, rejeitar)

