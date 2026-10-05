# Especificação extraída do PDF — 48 telas e visões complementares

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

### Tela 01 — Login (p. 5)

Grupo: Acesso e gestão

**Objetivo:** É a porta de entrada do ERP. Reúne a identificação do usuário e a apresentação da marca antes de liberar o ambiente de trabalho.

**Principais ações (comentário)**
- Informar usuário ou e-mail e senha.
- Exibir a senha e manter a sessão conectada.
- Acessar recuperação de senha e suporte.

**Ponto de atenção**
- A autenticação real deverá aplicar as permissões do usuário e registrar as tentativas de acesso. O protótipo apresenta o fluxo visual, sem validar credenciais reais.

**Regiões da tela**
- Cabeçalho da página do guia: rótulo 'TELA 01 / ACESSO E GESTÃO', título 'Login' e link 'SUMÁRIO' (navegação do PDF, não faz parte da tela)
- Tela de login em cartão dividido em dois painéis lado a lado, centralizado sobre fundo cinza-claro
- Painel esquerdo de marca (fundo azul-marinho com círculos decorativos em linha fina): logotipo quadrado laranja com 'I' + 'Intercert ERP' + slogan 'Gestão inteligente para o varejo'
- Painel esquerdo, bloco central: sobretítulo laranja 'SUA EMPRESA SOB CONTROLE', título 'Venda mais. Gerencie melhor.' e texto 'Uma plataforma completa para vendas, estoque, financeiro e emissão fiscal, acessível de onde você estiver.'
- Painel esquerdo: linha com 3 selos de benefícios (nuvem, proteção de dados, suporte)
- Painel esquerdo, rodapé: '© 2026 Intercert Soluções • Todos os direitos reservados'
- Painel direito (fundo branco): título 'Bem-vindo!' e subtítulo 'Entre com seus dados para acessar o sistema.'
- Painel direito: formulário com campo de usuário, campo de senha, linha 'Manter conectado' / 'Esqueci minha senha' e botão 'Entrar no sistema'
- Painel direito, rodapé: 'Precisa de ajuda? Fale com o suporte' e indicador 'Ambiente seguro e protegido'
- Bloco de comentários abaixo da imagem em três colunas: Objetivo, Principais ações, Ponto de atenção
- Rodapé do guia: 'INTERCERT ERP / Guia visual do MVP' e paginação '05 / 80'

**Campos observados**
- E-mail ou usuário (texto; ícone de pessoa à esquerda; placeholder 'Digite seu e-mail ou usuário')
- Senha (texto mascarado; ícone de cadeado à esquerda; placeholder 'Digite sua senha'; ícone de olho à direita para exibir/ocultar)
- Manter conectado (checkbox; desmarcado por padrão)

**Botões e ações observados**
- Botão primário laranja 'Entrar no sistema →' (largura total do formulário)
- Link 'Esqueci minha senha' (alinhado à direita, na linha do checkbox; recuperação de senha)
- Link 'Fale com o suporte' (precedido do texto 'Precisa de ajuda?')
- Ícone de olho no campo Senha (mostrar/ocultar senha)
- Checkbox 'Manter conectado' (sessão persistente)
- Link 'SUMÁRIO' no cabeçalho da página do guia (navegação do documento, não da tela)

**Estados e selos**
- Selo '100% na nuvem' (ícone de nuvem laranja)
- Selo 'Dados protegidos' (ícone de escudo com check laranja)
- Selo 'Suporte Intercert' (ícone de headset laranja)
- Indicador 'Ambiente seguro e protegido' (ícone de escudo com check, texto cinza)

**Regras e políticas ilustradas (exemplos)**
- Login aceita tanto e-mail quanto nome de usuário no mesmo campo
- Senha mascarada por padrão, com opção de exibir/ocultar
- Opção de manter sessão conectada (persistência de sessão), desmarcada por padrão
- Recuperação de senha acessível diretamente da tela de login
- Autenticação deve aplicar as permissões do usuário (perfil/acesso) após o login
- Tentativas de acesso devem ser registradas (auditoria de login)
- Posicionamento do produto: 100% em nuvem, cobrindo vendas, estoque, financeiro e emissão fiscal

**Inconsistências do protótipo**
- O protótipo não representa estados de erro (credencial inválida, campo obrigatório vazio, bloqueio por excesso de tentativas), embora o ponto de atenção exija registro de tentativas de acesso
- Não há indicação de seleção de empresa/filial ou de segundo fator de autenticação no fluxo de login
- O cartão de login aparece com o painel direito em largura maior que o esquerdo e margens cinza assimétricas, indicando recorte da captura (sem impacto funcional)

### Tela 02 — Seleção de empresa e filial (p. 6)

Grupo: Acesso e gestão

**Objetivo:** Define em qual empresa e unidade o usuário trabalhará. Essa escolha estabelece o contexto dos cadastros, movimentos e documentos seguintes.

**Principais ações (comentário)**
- Escolher uma empresa disponível.
- Consultar unidades e situação fiscal.
- Selecionar a filial e entrar no painel.

**Ponto de atenção**
- Exibir somente as unidades autorizadas para o usuário. A identificação da empresa e da filial deve permanecer clara durante toda a operação.

**Regiões da tela**
- Cabeçalho superior azul-marinho: logotipo 'I' laranja + 'Intercert ERP' / 'Gestão inteligente' à esquerda
- Cabeçalho à direita: nome do usuário 'Hércules Benevides', avatar com iniciais 'HB' e ícone de sair (logout)
- Área central (fundo cinza-claro): título 'Em qual empresa você deseja entrar?' e subtítulo 'Escolha a empresa e, em seguida, a unidade de trabalho.'
- Campo de busca centralizado
- Grade de cartões de empresa (2 colunas) com ícone, razão social, CNPJ, quantidade de unidades e chevron '>'

**Campos observados**
- Busca de empresa (texto; ícone de lupa; placeholder 'Buscar por razão social, nome fantasia ou CNPJ')
- Cartão de empresa: Ícone por tipo (prédio para Intercert Soluções; fachada de loja para Loja Modelo)
- Cartão de empresa: Razão social (Intercert Soluções Ltda.; Loja Modelo Varejo Ltda.)
- Cartão de empresa: CNPJ (12.345.678/0001-90; 98.765.432/0001-10)
- Cartão de empresa: Quantidade de unidades disponíveis (3; 2)
- Cabeçalho: Nome do usuário logado (Hércules Benevides)
- Cabeçalho: Avatar com iniciais (HB)

**Botões e ações observados**
- Cartão de empresa clicável com chevron '>' (selecionar empresa e avançar para unidades)
- Ícone de sair/logout no cabeçalho
- Avatar 'HB' (acesso ao perfil/usuário)
- Busca por razão social, nome fantasia ou CNPJ

**Abas / etapas**
- Fluxo em duas etapas (implícito no subtítulo): 1) Empresa (etapa visível/ativa) → 2) Unidade de trabalho/filial (não exibida na captura)

**Filtros**
- Busca textual por razão social, nome fantasia ou CNPJ

**Indicadores / cartões / gráficos**
- Cartão 'Intercert Soluções Ltda.' (CNPJ 12.345.678/0001-90; 3 unidades disponíveis)
- Cartão 'Loja Modelo Varejo Ltda.' (CNPJ 98.765.432/0001-10; 2 unidades disponíveis)

**Estados e selos**
- Contador de unidades disponíveis por empresa

**Regras e políticas ilustradas (exemplos)**
- Usuário vê apenas empresas/unidades autorizadas
- Seleção de empresa precede a seleção de filial/unidade de trabalho
- Contexto empresa+filial selecionado define cadastros, movimentos e documentos seguintes e deve ficar visível em toda a operação

**Inconsistências do protótipo**
- Defeito de renderização: o rótulo 'CNPJ' aparece colado ao fim da razão social ('Intercert Soluções Ltda.CNPJ') em vez de antes do número
- Número do CNPJ concatenado com a contagem de unidades: '12.345.678/0001-903 unidades disponíveis' (deveria ser 'CNPJ 12.345.678/0001-90 • 3 unidades disponíveis') e '98.765.432/0001-102 unidades disponíveis' (CNPJ 98.765.432/0001-10 • 2 unidades)
- Principais ações citam 'Consultar unidades e situação fiscal' e 'Selecionar a filial', mas a etapa de filial e a situação fiscal não aparecem na captura
- A busca aceita nome fantasia, porém os cartões não exibem nome fantasia

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

### Tela 04 — Frente de caixa - PDV (p. 8)

Grupo: Vendas e caixa

**Objetivo:** Concentra a venda no balcão: inclusão dos produtos, quantidades, identificação do cliente, descontos e encaminhamento para pagamento.

**Principais ações (comentário)**
- Adicionar itens por busca ou código de barras.
- Alterar quantidades e revisar o resumo.
- Identificar o cliente e iniciar o pagamento.

**Ponto de atenção**
- A operação deve ser rápida e adequada ao teclado e ao leitor. Descontos, exclusões de itens e cancelamentos precisam respeitar as permissões do operador.

**Regiões da tela**
- Cabeçalho azul-marinho: logotipo 'Intercert PDV' / 'Loja Modelo • Matriz' à esquerda
- Cabeçalho centro: 'Venda em andamento' / '#00010483'
- Cabeçalho direita: 'Caixa 01' com indicador '● Aberto' (verde) e botão 'Sair do PDV'
- Painel esquerdo: barra de busca/leitura + botão 'Leitor' + tabela de itens da venda
- Rodapé do painel esquerdo: contador de itens e legenda de atalhos de teclado
- Painel direito: 'Cliente da venda', 'Resumo da venda', 'Total a pagar', 'Forma de pagamento', opção de NFC-e e botões de finalização

**Campos observados**
- Busca/leitura de produto (texto com foco, borda laranja; ícone lupa; placeholder 'Leia o código de barras ou pesquise por nome, código ou referência')
- Item: Nome do produto (Camiseta básica masculina; Tênis casual Urban; Cinto sintético clássico)
- Item: Referência • variação (REF CM-001 • Azul • M; REF TN-142 • Preto • 41; REF CT-020 • Marrom)
- Item: Quantidade (stepper − / valor / +) (2; 1; 1)
- Item: Unitário (R$ 89,90; R$ 219,90; R$ 34,90)
- Item: Subtotal (R$ 179,80; R$ 219,90; R$ 34,90)
- Cliente da venda (Consumidor final; 'CPF não informado')
- Subtotal (R$ 434,60)
- Desconto (R$ 0,00) via '+ Aplicar desconto'
- Acréscimos (R$ 0,00)
- Total a pagar (R$ 434,60)
- Forma de pagamento (seleção por botões: Dinheiro, Cartão, Pix, Outros; Pix selecionado)
- Emitir NFC-e (checkbox; marcado)
- Indicador de ambiente fiscal ('Ambiente de produção')
- Contador '4 itens na venda'
- Número da venda (#00010483)
- Caixa (Caixa 01) e situação (Aberto)

**Botões e ações observados**
- Botão 'Leitor' (ícone de código de barras; ativar leitor)
- Botões '−' e '+' de quantidade por item
- Ícone lixeira vermelha (remover item)
- Link 'Identificar cliente'
- Ícone lápis no cartão do cliente (editar/trocar cliente)
- Link laranja '+ Aplicar desconto'
- Botões de forma de pagamento: 'Dinheiro', 'Cartão', 'Pix' (selecionado), 'Outros'
- Checkbox 'Emitir NFC-e'
- Botão primário laranja 'Finalizar venda • F10'
- Botão 'Salvar pré-venda'
- Botão 'Cancelar venda'
- Botão 'Sair do PDV' (cabeçalho)
- Atalho F2 — Buscar
- Atalho F4 — Cliente
- Atalho F8 — Desconto
- Atalho F10 — Finalizar

**Colunas de tabelas**
- Itens da venda: Produto (ícone + nome + REF • cor • tamanho) | Quantidade | Unitário | Subtotal | (ação excluir)

**Indicadores / cartões / gráficos**
- Cartão 'Cliente da venda' (Consumidor final; CPF não informado)
- Resumo da venda (Subtotal R$ 434,60; Desconto R$ 0,00; Acréscimos R$ 0,00)
- Total a pagar em destaque (R$ 434,60)

**Estados e selos**
- Venda em andamento
- Caixa 01 — ● Aberto (verde)
- Forma de pagamento selecionada destacada em laranja (Pix)
- Ambiente de produção
- Emitir NFC-e marcado

**Regras e políticas ilustradas (exemplos)**
- Subtotal do item = quantidade × unitário (2 × R$ 89,90 = R$ 179,80)
- Total a pagar = subtotal − desconto + acréscimos (434,60 − 0 + 0)
- Contador de itens soma as quantidades (2+1+1 = 4 itens em 3 linhas)
- Cliente padrão 'Consumidor final' com CPF não informado
- Emissão de NFC-e marcada por padrão e ambiente fiscal visível (produção)
- Desconto, exclusão de item e cancelamento sujeitos a permissão do operador
- Venda pode ser salva como pré-venda
- Operação orientada a teclado (F2, F4, F8, F10) e leitor de código de barras

**Inconsistências do protótipo**
- '4 itens na venda' conta unidades enquanto a tabela tem 3 linhas — critério de contagem não explicitado
- Atalho F2 = 'Buscar' no PDV, mas na Tela 08 F2 = 'Iniciar nova venda'
- Formas de pagamento aqui são 4 (Dinheiro, Cartão, Pix, Outros), enquanto a Tela 07 separa Crédito/Débito e acrescenta Crediário, Boleto e Vale/crédito
- Pix aparece pré-selecionado sem ação do operador
- Ícone do 'Tênis casual Urban' é uma sacola aqui e pegadas na busca de produtos (Tela 05)
- Variação do cinto aparece como 'Marrom' aqui e 'Marrom • 100 cm' na busca (Tela 05)

### Tela 05 — Busca de produtos no PDV (p. 9)

Grupo: Vendas e caixa

**Objetivo:** Ajuda o operador a localizar e incluir mercadorias na venda, apresentando informações comerciais e de disponibilidade no mesmo contexto.

**Principais ações (comentário)**
- Pesquisar por descrição ou código.
- Navegar pelas categorias e modos de exibição.
- Selecionar um produto e adicioná-lo à venda.

**Ponto de atenção**
- Preço, unidade e saldo devem corresponder à filial e à tabela aplicável à venda. A inclusão de variações deve distinguir corretamente cada item.

**Regiões da tela**
- Cabeçalho azul-marinho: 'Intercert PDV' / 'Busca de produtos'; botão central '← Voltar à venda'; à direita ícone de carrinho 'Itens no carrinho' com badge
- Título 'Adicionar produtos' / 'Pesquise, escolha a variação e adicione o item diretamente à venda.' com alternador de visualização (grade/lista)
- Barra de filtros: busca, marcas, tabela de preço, botão 'Ler código'
- Linha de chips de categorias
- Linha de contagem '8 produtos encontrados' e 'Estoque da Matriz'
- Grade de cartões de produto (4 colunas × 2 linhas)

**Campos observados**
- Busca (texto; ícone lupa; placeholder 'Nome, código, referência ou código de barras')
- Marca (dropdown; 'Todas as marcas')
- Tabela de preço (dropdown; 'Tabela padrão')
- Cartão: Selo de estoque (quantidade em estoque)
- Cartão: Ícone da categoria
- Cartão: Nome do produto
- Cartão: Código • marca/linha (ex.: CM-001 • Essencial)
- Cartão: Preço (R$) com legenda 'Preço unitário'
- Cartão: Seletor de variação (dropdown; cor • tamanho/medida)
- Contador de resultados ('8 produtos encontrados')
- Origem do estoque ('Estoque da Matriz')
- Itens no carrinho (badge 4)

**Botões e ações observados**
- Botão '← Voltar à venda'
- Botão 'Ler código' (ícone de código de barras)
- Alternador de visualização em grade (ativo)
- Alternador de visualização em lista
- Chips de categoria: Todos, Roupas, Calçados, Acessórios, Casa, Eletrônicos
- Botão '+' laranja em cada cartão (adicionar à venda)
- Botão '+' cinza desabilitado em produto sem estoque
- Seletor de variação em cada cartão
- Ícone de carrinho 'Itens no carrinho'

**Abas / etapas**
- Categorias (chips): Todos (ativo), Roupas, Calçados, Acessórios, Casa, Eletrônicos
- Modo de exibição: Grade (ativo) | Lista

**Filtros**
- Busca por nome, código, referência ou código de barras
- Marca: Todas as marcas
- Tabela de preço: Tabela padrão
- Categoria: Todos / Roupas / Calçados / Acessórios / Casa / Eletrônicos
- Leitura de código de barras ('Ler código')

**Indicadores / cartões / gráficos**
- Camiseta básica masculina (CM-001 • Essencial; R$ 89,90; 18 em estoque; variação Azul • M)
- Tênis casual Urban (TN-142 • Urban; R$ 219,90; 4 em estoque; variação Preto • 41)
- Cinto sintético clássico (CT-020 • Classic; R$ 34,90; 22 em estoque; variação Marrom • 100 cm)
- Calça jeans reta (CJ-208 • Essencial; R$ 149,90; 11 em estoque; variação Azul • 42)
- Bolsa transversal Urban (BL-055 • Urban; R$ 119,90; 2 em estoque; variação Caramelo)
- Fone Bluetooth Wave (EL-101 • Urban; R$ 159,90; 9 em estoque; variação Preto)
- Jogo de toalhas 4 peças (JT-030 • Classic; R$ 99,90; 15 em estoque; variação Branco)
- Sandália Comfort (SD-077 • Urban; R$ 129,90; Sem estoque; variação Caramelo • 37 desabilitada)

**Estados e selos**
- Selo verde 'N em estoque' (estoque normal: 18, 22, 11, 9, 15)
- Selo laranja 'N em estoque' (estoque baixo: 4, 2)
- Selo vermelho 'Sem estoque'
- Botão de adicionar desabilitado (cinza) e variação esmaecida quando sem estoque
- Chip de categoria ativo em azul (Todos)
- Badge laranja de itens no carrinho (4)

**Regras e políticas ilustradas (exemplos)**
- Saldo exibido é da filial corrente ('Estoque da Matriz')
- Preço depende da tabela de preço selecionada ('Tabela padrão')
- Cor do selo de estoque por faixa: verde (normal, ≥ 9 nos exemplos), laranja (baixo, 2 e 4), vermelho (zerado)
- Produto sem estoque não pode ser adicionado (botão '+' desabilitado)
- Variação (cor/tamanho/medida) é escolhida antes de adicionar e deve gerar item distinto

**Inconsistências do protótipo**
- Variação do cinto 'Marrom • 100 cm' aqui aparece só como 'Marrom' no carrinho do PDV (Tela 04)
- Ícone do tênis (pegadas) difere do ícone usado no carrinho do PDV (sacola)
- Saldo exibido por produto não indica a qual variação selecionada se refere (produto x variação)

### Tela 06 — Identificação do cliente (p. 10)

Grupo: Vendas e caixa

**Objetivo:** Vincula o consumidor à venda sem interromper o atendimento. Permite procurar um cadastro existente ou iniciar um cadastro rápido.

**Principais ações (comentário)**
- Buscar cliente por seus dados de identificação.
- Conferir o cliente selecionado.
- Usar o cadastro ou continuar como consumidor final.

**Ponto de atenção**
- A identificação comercial e os dados destinados ao documento fiscal precisam ser coerentes. O cadastro rápido deve evitar duplicidade de clientes.

**Regiões da tela**
- Cabeçalho do PDV azul-marinho: 'Intercert PDV' / 'Loja Modelo • Matriz'; à direita 'Venda #00010483 • Total R$ 434,60'
- Fundo do PDV escurecido (overlay)
- Modal central 'Identificar cliente' com subtítulo e botão fechar (X)
- Abas do modal
- Campo de busca com texto de ajuda
- Lista de resultados em cartões (avatar com iniciais, nome, documento • telefone, situação e informação complementar)
- Rodapé do modal: link à esquerda e botões à direita

**Campos observados**
- Busca de cliente (texto com foco, borda laranja; ícone lupa; placeholder 'Digite CPF, CNPJ, nome ou telefone')
- Texto de ajuda: 'A busca começa automaticamente enquanto você digita.'
- Resultado: Avatar com iniciais (MS; JP; JL)
- Resultado: Nome/razão social (Maria da Silva; João Pereira; JL Comércio de Alimentos Ltda.)
- Resultado: Documento (CPF 123.456.789-00; CPF 987.654.321-00; CNPJ 12.456.789/0001-20)
- Resultado: Telefone ((88) 99999-1111; (88) 98888-2222; (88) 3512-4000)
- Resultado: Situação/tipo (Cliente ativo; Cliente ativo; Pessoa jurídica)
- Resultado: Informação complementar (Última compra há 8 dias; Crédito disponível: R$ 500; Tabela de preço: Atacado)
- Cabeçalho: Venda e total (Venda #00010483 • Total R$ 434,60)

**Botões e ações observados**
- Botão fechar 'X' do modal
- Aba 'Buscar cliente'
- Aba 'Cadastro rápido'
- Cartão de resultado clicável (selecionar cliente)
- Link 'Continuar como consumidor final'
- Botão 'Cancelar'
- Botão primário 'Usar este cliente' (desabilitado até selecionar um cliente)

**Abas / etapas**
- Buscar cliente (ativa)
- Cadastro rápido

**Colunas de tabelas**
- Lista de clientes: Avatar/iniciais | Nome + Documento • Telefone | Situação + Informação complementar

**Filtros**
- Busca incremental por CPF, CNPJ, nome ou telefone

**Indicadores / cartões / gráficos**
- Maria da Silva — CPF 123.456.789-00 • (88) 99999-1111 — Cliente ativo — Última compra há 8 dias
- João Pereira — CPF 987.654.321-00 • (88) 98888-2222 — Cliente ativo — Crédito disponível: R$ 500
- JL Comércio de Alimentos Ltda. — CNPJ 12.456.789/0001-20 • (88) 3512-4000 — Pessoa jurídica — Tabela de preço: Atacado

**Estados e selos**
- Cliente ativo (verde)
- Pessoa jurídica (verde)
- Botão 'Usar este cliente' em estado desabilitado

**Regras e políticas ilustradas (exemplos)**
- Busca inicia automaticamente durante a digitação (busca incremental)
- Cliente pode ter crédito disponível (ex.: R$ 500)
- Cliente PJ pode ter tabela de preço própria (ex.: Atacado) aplicável à venda
- Exibe recência de compra (última compra há N dias)
- Venda pode prosseguir como consumidor final sem identificação
- Cadastro rápido deve impedir duplicidade (CPF/CNPJ)
- Cliente vinculado serve para nota fiscal, histórico, crédito e fidelização

**Inconsistências do protótipo**
- Avatares com iniciais desalinhadas (letras fora do círculo) — defeito de renderização
- O selo de situação mistura conceitos: 'Pessoa jurídica' (tipo de pessoa) ocupa o lugar de 'Cliente ativo' (situação)
- Painel do gestor exibe 'Maria Silva' e 'JL Comércio' em vez de 'Maria da Silva' e 'JL Comércio de Alimentos Ltda.'
- O conteúdo da aba 'Cadastro rápido' não é exibido

### Tela 07 — Pagamento da venda (p. 11)

Grupo: Vendas e caixa

**Objetivo:** Organiza as formas de pagamento e confere o valor necessário para finalizar a venda, incluindo a possibilidade de combinar meios diferentes.

**Principais ações (comentário)**
- Escolher dinheiro, cartão, Pix ou outra forma.
- Adicionar pagamentos e conferir o saldo restante.
- Confirmar a venda e iniciar a emissão da NFC-e.

**Ponto de atenção**
- Separar confirmação do pagamento de autorização fiscal. A implementação deverá tratar troco, arredondamento, integrações e falhas sem duplicar recebimentos.

**Regiões da tela**
- Cabeçalho azul-marinho: 'Intercert PDV' / 'Pagamento da venda'; centro 'Venda #00010483' / '4 itens • Maria da Silva'; à direita botão '← Voltar'
- Título 'Finalizar pagamento' / 'Escolha uma ou mais formas de pagamento até completar o valor da venda.' com indicador de etapas à direita
- Painel 'Selecione a forma de pagamento' (grade 4×2 de botões) com valor, condição, atalhos de valor, aviso Pix e botão adicionar
- Painel 'Pagamentos adicionados' (estado vazio)
- Painel lateral direito 'Resumo da venda' com cliente, totais, valores recebido/restante, opções de NFC-e e botão de confirmação

**Campos observados**
- Forma de pagamento (seleção por botões: Dinheiro, Crédito, Débito, Pix, Crediário, Boleto, Vale / crédito, Outros; Pix selecionado)
- Valor a receber (moeda; prefixo R$; 434.60)
- Condição (dropdown; 'À vista')
- Pagamentos adicionados (lista; vazia — 'Nenhum pagamento')
- Cliente (avatar MS; Maria da Silva; CPF 123.456.789-00)
- Subtotal (R$ 434,60)
- Desconto (R$ 0,00) via '+ Aplicar desconto'
- Acréscimos (R$ 0,00)
- Total da venda (R$ 434,60)
- Valor recebido (R$ 0,00)
- Valor restante (R$ 434,60, em laranja)
- Emitir NFC-e após confirmar (checkbox; marcado)
- Destino do comprovante (dropdown; 'Imprimir DANFE e enviar por WhatsApp')
- Cabeçalho: número da venda, quantidade de itens e cliente (Venda #00010483; 4 itens • Maria da Silva)

**Botões e ações observados**
- Botão '← Voltar'
- Botões de forma de pagamento: Dinheiro, Crédito, Débito, Pix (selecionado), Crediário, Boleto, Vale / crédito, Outros
- Atalho de valor 'R$ 100'
- Atalho de valor 'R$ 200'
- Atalho 'Valor restante'
- Botão azul '+ Adicionar pagamento'
- Link laranja '+ Aplicar desconto'
- Checkbox 'Emitir NFC-e após confirmar'
- Dropdown de envio/impressão do comprovante
- Botão primário 'Confirmar e emitir NFC-e' (desabilitado enquanto há valor restante)

**Abas / etapas**
- Indicador de etapas: 1 Carrinho › 2 Cliente › 3 Pagamento (etapa atual)

**Colunas de tabelas**
- Pagamentos adicionados: lista vazia ('Nenhum pagamento') — colunas não exibidas

**Indicadores / cartões / gráficos**
- Resumo da venda: Total da venda (R$ 434,60)
- Valor recebido (R$ 0,00)
- Valor restante (R$ 434,60)
- Cartão do cliente (Maria da Silva; CPF 123.456.789-00)

**Estados e selos**
- Forma de pagamento selecionada destacada em laranja (Pix)
- Valor restante em laranja (pendente)
- 'Nenhum pagamento' (estado vazio)
- Botão 'Confirmar e emitir NFC-e' desabilitado (esmaecido)
- Etapas do fluxo em laranja (Carrinho, Cliente, Pagamento)
- Aviso informativo: 'O QR Code Pix será gerado após adicionar o pagamento.'

**Regras e políticas ilustradas (exemplos)**
- Venda pode ser paga com múltiplas formas combinadas até completar o total
- Valor restante = total da venda − valor recebido
- 'Valor a receber' sugerido = valor restante
- Confirmação só habilitada quando o valor restante chega a zero
- QR Code Pix gerado somente após adicionar o pagamento
- Condição de pagamento por forma (À vista; parcelamento implícito para crédito/crediário)
- Emissão de NFC-e opcional após confirmar e destino do comprovante configurável (DANFE impresso + WhatsApp)
- Tratar troco, arredondamento e falhas de integração sem duplicar recebimentos

**Inconsistências do protótipo**
- 'Valor a receber' exibido como '434.60' (ponto decimal) enquanto o restante da tela usa formato brasileiro 'R$ 434,60'
- Tela 04 oferece 4 formas (Dinheiro, Cartão, Pix, Outros) e esta tela oferece 8 (Crédito/Débito separados, Crediário, Boleto, Vale/crédito)
- Indicador de etapas mostra as três etapas na mesma cor, sem distinguir a etapa atual das concluídas
- Não há campo de troco visível, apesar de o ponto de atenção exigir tratamento de troco
- Comprovante da NFC-e é chamado de 'DANFE' (o termo usual é DANFE NFC-e)

### Tela 08 — Venda concluída (p. 12)

Grupo: Vendas e caixa

**Objetivo:** Apresenta o resultado do atendimento e os documentos associados. É o ponto de transição entre a venda finalizada e o início da próxima operação.

**Principais ações (comentário)**
- Conferir o resumo e a situação do documento fiscal.
- Imprimir ou disponibilizar os comprovantes.
- Consultar a venda ou começar um novo atendimento.

**Ponto de atenção**
- A mensagem de sucesso deve refletir o estado efetivo da venda e do documento fiscal. Envio de arquivos e mensagens depende de integração na versão real.

**Regiões da tela**
- Cabeçalho azul-marinho: 'Intercert PDV' / 'Loja Modelo • Matriz'; centro 'Caixa 01 • Operador: Hércules'; à direita botão 'Sair do PDV'
- Bloco de sucesso centralizado: ícone de check verde, título 'Venda concluída com sucesso!', texto 'O pagamento foi confirmado e o estoque atualizado automaticamente.' e selo 'NFC-e autorizada pela SEFAZ'
- Cartão esquerdo 'Resumo da venda' (cabeçalho da venda, cliente/vendedor, itens, pagamento)
- Cartão direito 'Documento fiscal' (dados da NFC-e e seção 'Enviar ou baixar comprovantes' com 4 botões)
- Rodapé com botão secundário à esquerda e botão primário à direita

**Campos observados**
- Número da venda (Venda #00010483)
- Data/hora e caixa (21/09/2026 às 20:48 • Caixa 01)
- Total (R$ 434,60)
- Cliente (Maria da Silva; CPF 123.456.789-00)
- Vendedor (Hércules Benevides; Loja Modelo — Matriz)
- Item: nome, quantidade × unitário, total (Camiseta básica masculina 2 × R$ 89,90 = R$ 179,80; Tênis casual Urban 1 × R$ 219,90 = R$ 219,90; Cinto sintético clássico 1 × R$ 34,90 = R$ 34,90)
- Pagamento (Pagamento via Pix; R$ 434,60)
- Documento fiscal: número (NFC-e nº 000.001.482)
- Documento fiscal: situação e série (Autorizada • Série 1)
- Protocolo (326260001234567)
- Data de autorização (21/09/2026 20:48:32)
- Chave de acesso (2326 0912 3456 7800 0190 6500 1000 0014 8210 4830 0017)
- Operador do caixa (Hércules)

**Botões e ações observados**
- Botão 'Imprimir DANFE' (subtítulo 'Impressora do caixa')
- Botão 'Enviar WhatsApp' (subtítulo '(88) 99999-1111')
- Botão 'Enviar por e-mail' (subtítulo 'Cliente cadastrado')
- Botão 'Baixar XML e PDF' (subtítulo 'Arquivo fiscal')
- Botão 'Consultar esta venda'
- Botão primário laranja '+ Iniciar nova venda • F2'
- Botão 'Sair do PDV'
- Atalho F2 — Iniciar nova venda

**Colunas de tabelas**
- Itens da venda (lista): Produto + quantidade × unitário | Valor total do item
- Pagamentos (lista): Forma | Valor

**Indicadores / cartões / gráficos**
- Cartão 'Resumo da venda' (Venda #00010483; Total R$ 434,60)
- Cartão 'Documento fiscal' (NFC-e nº 000.001.482; Autorizada • Série 1)
- Seção 'Enviar ou baixar comprovantes' (4 ações)

**Estados e selos**
- Ícone de sucesso (check verde)
- Selo 'NFC-e autorizada pela SEFAZ' (verde)
- 'Autorizada • Série 1' (verde)

**Regras e políticas ilustradas (exemplos)**
- Confirmação da venda baixa o estoque automaticamente
- Mensagem de sucesso deve refletir o estado real da venda e da NFC-e (autorizada pela SEFAZ)
- Dados fiscais exibidos: número, série, protocolo, data/hora de autorização e chave de acesso de 44 dígitos
- Chave de acesso compõe UF 23 (CE), AAMM 2609, CNPJ emitente, modelo 65 (NFC-e), série 001 e número 000001482
- Comprovantes: DANFE impresso, WhatsApp para o telefone do cliente, e-mail do cadastro, download de XML e PDF
- Envio de arquivos/mensagens depende de integração
- Vendedor e operador vinculados à venda

**Inconsistências do protótipo**
- A chave de acesso contém o CNPJ 12.345.678/0001-90 (Intercert Soluções Ltda.), mas a venda é da 'Loja Modelo — Matriz' (na Tela 02, Loja Modelo Varejo Ltda. tem CNPJ 98.765.432/0001-10)
- O dígito verificador da chave de acesso exibida (7) não confere pelo módulo 11 (seria 2) — chave fictícia
- Atalho F2 = 'Iniciar nova venda' aqui, mas F2 = 'Buscar' na frente de caixa (Tela 04)
- Na Tela 07 foi escolhido 'Imprimir DANFE e enviar por WhatsApp', mas esta tela não indica se a impressão/envio já ocorreu (aparecem apenas como botões)

### Tela 09 — Histórico de vendas (p. 13)

Grupo: Vendas e caixa

**Objetivo:** Reúne as vendas para pesquisa e acompanhamento. Permite encontrar uma operação e consultar seus dados antes de abrir o detalhamento completo.

**Principais ações (comentário)**
- Filtrar vendas por período e situação.
- Selecionar uma operação e ver seu resumo.
- Abrir detalhes e acessar documentos relacionados.

**Ponto de atenção**
- Filtros e totalizadores devem usar o mesmo conjunto de vendas.
- Cancelamentos e devoluções precisam permanecer identificáveis para preservar a rastreabilidade.

**Regiões da tela**
- Cabeçalho da página do guia (fora do protótipo): 'TELA 09 / VENDAS E CAIXA', link 'SUMÁRIO' e título 'Histórico de vendas'; rodapé 'INTERCERT ERP / Guia visual do MVP' e '13 / 80'
- Menu lateral escuro (azul-marinho) fixo: logo quadrado laranja 'I', 'Intercert ERP' / 'Gestão inteligente', separador, itens com ícones e rodapé 'Intercert Soluções • v1.0'
- Cabeçalho superior branco: unidade 'Loja Modelo — Matriz' (negrito), subtítulo 'Juazeiro do Norte • Caixa aberto', avatar circular azul 'HB' à direita
- Área de título: 'Histórico de vendas' + subtítulo 'Consulte vendas, documentos fiscais, pagamentos e operações pós-venda.' + botão primário laranja '+ Nova venda' à direita
- Faixa de 4 cartões de indicadores (rótulo, valor grande, sublinha colorida)
- Cartão de filtros: busca com lupa + 3 selects + botão 'Mais filtros'
- Cartão de tabela 'Vendas encontradas' com contador '6 registros exibidos' no cabeçalho, cabeçalho de colunas em fundo cinza-claro, 6 linhas com duas linhas de texto cada e chevron de expansão
- Rodapé da tabela: 'Mostrando 1–6 de 342 vendas' à esquerda e paginação à direita

**Campos observados**
- Busca (texto) — placeholder 'Venda, cliente, CPF/CNPJ ou docum[ento]' (truncado) com ícone de lupa
- Período (select) — valor 'Este mês'
- Status (select) — valor 'Todos os statu[s]' (truncado)
- Vendedor (select) — valor 'Todos os vend[edores]' (truncado)
- Contexto do cabeçalho: unidade/filial 'Loja Modelo — Matriz'
- Contexto do cabeçalho: cidade 'Juazeiro do Norte'
- Contexto do cabeçalho: situação do caixa 'Caixa aberto'
- Usuário logado: avatar 'HB'
- Linha da venda: número da venda ('#10483')
- Linha da venda: origem/ponto de venda ('Caixa 01', 'Caixa 02', 'Pedido web')
- Linha da venda: data ('21/09/2026') e hora ('20:48')
- Linha da venda: nome do cliente ('Maria da Silva', 'Consumidor final', 'JL Comércio Ltda.', 'Pedro Lima', 'Ana Costa')
- Linha da venda: documento do cliente ('CPF 123.456.789-00', 'CNPJ 12.456.789/0001-20') ou 'Não identificado'
- Linha da venda: tipo e número do documento fiscal ('NFC-e 000001482', 'NF-e 000000245', 'NFC-e pendente')
- Linha da venda: série/situação do documento ('Série 1', 'Cancelada', 'Aguardando transmissão')
- Linha da venda: forma de pagamento ('Pix', 'Cartão', 'Dinheiro', 'Boleto')
- Linha da venda: status (selo)
- Linha da venda: valor total ('R$ 434,60', 'R$ 389,90', 'R$ 74,50', 'R$ 1.240,00', 'R$ 159,90', 'R$ 298,00')

**Botões e ações observados**
- + Nova venda (botão primário laranja, canto superior direito)
- Mais filtros (botão secundário com texto azul)
- Abrir select Período (seta ⌄)
- Abrir select Status (seta ⌄)
- Abrir select Vendedor (seta ⌄)
- Chevron de expansão (⌄) em cada uma das 6 linhas para ver o resumo da venda
- Paginação: ‹ (anterior)
- Paginação: 1 (página ativa, fundo azul)
- Paginação: 2
- Paginação: 3
- Paginação: › (próxima)
- Itens do menu lateral (navegação: Painel, Vendas e PDV, Produtos e estoque, Clientes e CRM, Financeiro, Fiscal, Relatórios)
- Avatar 'HB' (menu do usuário)
- Link 'SUMÁRIO' do guia (navegação do documento, não do sistema)

**Colunas de tabelas**
- Vendas encontradas: Venda (nº '#10483' + origem 'Caixa 01'/'Caixa 02'/'Pedido web')
- Vendas encontradas: Data e hora (data '21/09/2026' + hora '20:48')
- Vendas encontradas: Cliente (nome + 'CPF 123.456.789-00' / 'CNPJ 12.456.789/0001-20', ou 'Consumidor final' + 'Não identificado')
- Vendas encontradas: Documento (tipo e nº 'NFC-e 000001482' / 'NF-e 000000245' / 'NFC-e pendente' + sublinha 'Série 1' / 'Cancelada' / 'Aguardando transmissão')
- Vendas encontradas: Pagamento ('Pix', 'Cartão', 'Dinheiro', 'Boleto')
- Vendas encontradas: Status (selo com ponto colorido)
- Vendas encontradas: Valor (negrito, alinhado à direita)
- Vendas encontradas: coluna sem título com chevron de expansão (⌄)
- Rodapé: 'Mostrando 1–6 de 342 vendas'
- Linhas de exemplo: #10483 Caixa 01, 21/09/2026 20:48, Maria da Silva, NFC-e 000001482 Série 1, Pix, Concluída, R$ 434,60
- #10482 Caixa 01, 20:42, Consumidor final / Não identificado, NFC-e 000001481 Série 1, Cartão, Concluída, R$ 389,90
- #10481 Caixa 02, 20:35, Consumidor final / Não identificado, NFC-e 000001480 Cancelada, Dinheiro, Cancelada, R$ 74,50
- #10480 Pedido web, 20:18, JL Comércio Ltda. CNPJ 12.456.789/0001-20, NF-e 000000245 Série 1, Boleto, Concluída, R$ 1.240,00
- #10479 Caixa 01, 19:56, Pedro Lima CPF 321.654.987-00, NFC-e 000001479 Série 1, Cartão, Concluída, R$ 159,90
- #10478 Caixa 02, 19:42, Ana Costa CPF 456.789.123-00, NFC-e pendente / Aguardando transmissão, Pix, Pendente, R$ 298,00

**Filtros**
- Busca livre por venda, cliente, CPF/CNPJ ou documento
- Período: 'Este mês'
- Status: 'Todos os status'
- Vendedor: 'Todos os vendedores' (rótulo truncado 'Todos os vend')
- 'Mais filtros' (filtros avançados não exibidos)

**Indicadores / cartões / gráficos**
- Vendas no período (342) — sublinha verde '↑ 8,4% no mês'
- Faturamento líquido (R$ 78.450) — sublinha verde 'Ticket médio R$ 229,39'
- Vendas canceladas (6) — sublinha cinza '1,7% do total'
- Documentos pendentes (2) — sublinha laranja 'Requer atenção'
- Cartão-tabela 'Vendas encontradas' com contador '6 registros exibidos'

**Estados e selos**
- Concluída (selo verde com ponto verde)
- Cancelada (selo vermelho/rosa com ponto vermelho)
- Pendente (selo laranja com ponto laranja)
- Situação do documento na sublinha: 'Série 1' (emitido/autorizado), 'Cancelada', 'Aguardando transmissão'
- Documento 'NFC-e pendente' (sem número)
- Situação do caixa no cabeçalho: 'Caixa aberto'
- Origem da venda: 'Caixa 01', 'Caixa 02', 'Pedido web'
- Cliente 'Consumidor final' / 'Não identificado'
- Indicador de tendência '↑ 8,4% no mês' (verde)
- Alerta 'Requer atenção' (laranja)
- Página ativa '1' (azul)

**Itens de menu**
- Painel (ícone de grade)
- Vendas e PDV (ícone de carrinho — ativo, fundo destacado e barra laranja à esquerda)
- Produtos e estoque (ícone de caixa/cubo)
- Clientes e CRM (ícone de pessoas)
- Financeiro (ícone de banco/prédio)
- Fiscal (ícone de documento)
- Relatórios (ícone de gráfico)

**Regras e políticas ilustradas (exemplos)**
- Ticket médio = Faturamento líquido / Vendas no período (R$ 78.450 / 342 = R$ 229,39)
- Percentual de canceladas = canceladas / total de vendas do período (6 / 342 ≈ 1,7%)
- Variação do período exibida como '↑ 8,4% no mês'
- Venda cancelada permanece na lista com status 'Cancelada' e documento marcado 'Cancelada' (rastreabilidade)
- Venda com documento fiscal não transmitido fica com status 'Pendente' e documento 'NFC-e pendente — Aguardando transmissão'; conta em 'Documentos pendentes'
- Venda sem cliente identificado aparece como 'Consumidor final / Não identificado'
- Pedido web para cliente CNPJ gera NF-e (série 1, numeração própria 000000245); vendas de caixa geram NFC-e (numeração própria 0000014xx)
- Numeração fiscal com 9 dígitos e zeros à esquerda; numeração NFC-e sequencial entre caixas (1479–1482) independentemente do caixa
- Número da venda sequencial global (#10478 a #10483) independente da origem
- Lista ordenada por data/hora decrescente
- Uma forma de pagamento exibida por venda
- Paginação com 6 registros por página
- Documentos pendentes destacados em laranja como 'Requer atenção'
- Formato de data dd/mm/aaaa e hora HH:mm; valores em R$ com vírgula decimal

**Inconsistências do protótipo**
- Ticket médio R$ 229,39 = 78.450 / 342 usa como divisor o total de vendas incluindo as 6 canceladas (a lista de 342 contém venda 'Cancelada'); excluindo canceladas seria 78.450 / 336 = R$ 233,48 — conflita com o ponto de atenção 'filtros e totalizadores devem usar o mesmo conjunto'
- 'Vendas canceladas' 6 de 342 = 1,754%, exibido como '1,7%' (truncamento; arredondado seria 1,8%)
- Paginação mostra apenas 3 páginas (1, 2, 3) para 342 vendas exibidas 6 por página (seriam 57 páginas)
- '↑ 8,4% no mês' com período 'Este mês' — base de comparação não definida (mês anterior? mesmo período do mês anterior?)
- Coluna Status mistura situação da venda com situação fiscal: venda '#10478' aparece como 'Pendente' por causa do documento fiscal não transmitido
- Venda #10478 (19:42) ainda 'Aguardando transmissão' e sem número de NFC-e, enquanto vendas posteriores já têm NFC-e 000001479–000001482 autorizadas
- Não existe selo/estado 'Devolvida', 'Troca' ou 'Parcialmente devolvida', embora o subtítulo cite 'operações pós-venda' e o ponto de atenção exija que devoluções permaneçam identificáveis
- Não há botão/ação visível para 'Abrir detalhes' ou 'acessar documentos relacionados' (apenas o chevron de expansão), nem ação de exportar/imprimir
- Coluna Pagamento mostra uma única forma por venda; não há representação de pagamento misto (múltiplas formas)
- Rótulos dos selects truncados ('Todos os statu', 'Todos os vend') e placeholder da busca truncado ('docum') — não fica claro se o 3º filtro é por vendedor ou outro critério
- Cabeçalho indica 'Caixa aberto' sem dizer qual caixa, enquanto a lista contém vendas do Caixa 01, Caixa 02 e Pedido web
- Venda cancelada '#10481' (R$ 74,50) é do 'Caixa 02', mas o fechamento do 'Caixa 01' (tela 14, p. 18) mostra 'Cancelamentos 1 — R$ 74,50'
- CPFs/CNPJ de exemplo têm dígitos verificadores inválidos (123.456.789-00 deveria ser -09; 321.654.987-00 → -91; 456.789.123-00 → -64; CNPJ 12.456.789/0001-20 → -79) — validação real rejeitaria
- Esta tela usa layout com menu lateral, enquanto outras telas (ex.: tela 14 PDV e tela 16 cadastro) usam apenas barra superior escura sem menu lateral

### Tela 10 — Detalhes da venda (p. 14)

Grupo: Vendas e caixa

**Objetivo:** Agrupa as informações de uma venda específica, conectando produtos, cliente, pagamentos, documento fiscal e histórico de ações.

**Principais ações (comentário)**
- Examinar os itens e os valores da operação.
- Consultar pagamento e informações fiscais.
- Acompanhar histórico, impressão e cancelamento.

**Ponto de atenção**
- As ações disponíveis dependem da situação da venda e das permissões.
- Alterações posteriores precisam registrar responsável, motivo e impacto nos outros módulos.

**Regiões da tela**
- Barra superior escura: logo 'I' + 'Intercert ERP' / 'Gestão inteligente', centro 'Loja Modelo — Matriz', avatar 'HB' (sem menu lateral)
- Breadcrumb 'Vendas e PDV / Histórico de vendas / #10483'
- Cabeçalho da venda: título 'Venda #10483', linha de metadados (selo de status, data/hora, caixa, operador) e grupo de botões de ação à direita
- Faixa de 4 cartões de resumo
- Painel com abas
- Aba Visão geral: tabela 'Produtos da venda' (à esquerda) com totais + painel 'Cliente e operação' (à direita)

**Campos observados**
- Status da venda (selo 'Concluída')
- Data e hora ('21/09/2026 às 20:48')
- Caixa ('Caixa 01')
- Operador ('Operador: Hércules')
- Total da venda (R$ 434,60; '4 unidades • 3 produtos')
- Pagamento (Pix; 'Recebido integralmente')
- Documento fiscal (NFC-e 000001482; 'Série 1 • Autorizada')
- Margem estimada (R$ 142,80; '32,9% sobre a venda')
- Indicação de estoque: 'Estoque baixado na Matriz'
- Subtotal (R$ 434,60)
- Desconto (R$ 0,00)
- Total (R$ 434,60, destaque azul)
- Cliente: avatar com iniciais ('MS'), nome ('Maria da Silva'), CPF ('CPF 123.456.789-00')
- Celular ('(88) 99999-1111')
- Vendedor ('Hércules Benevides')
- Tabela de preço ('Padrão')
- Origem ('PDV — Caixa 01')
- Filial ('Loja Modelo — Matriz')

**Botões e ações observados**
- Imprimir (ícone de impressora)
- Enviar (ícone de avião de papel)
- Cancelar venda (ícone de proibido, texto vermelho — ação destrutiva)
- Links do breadcrumb: Vendas e PDV / Histórico de vendas
- Troca de abas: Visão geral, Pagamento e fiscal, Histórico e auditoria
- Avatar HB

**Abas / etapas**
- Visão geral (ativa, sublinhado laranja)
- Pagamento e fiscal
- Histórico e auditoria

**Colunas de tabelas**
- Produtos da venda: Produto (nome + sublinha código • cor • tamanho, ex. 'CM-001 • Azul • M', 'TN-142 • Preto • 41', 'CT-020 • Marrom • 100 cm')
- Produtos da venda: Qtd.
- Produtos da venda: Unitário
- Produtos da venda: Subtotal
- Rodapé da tabela: Subtotal, Desconto, Total

**Indicadores / cartões / gráficos**
- Total da venda (R$ 434,60 — '4 unidades • 3 produtos')
- Pagamento (Pix — 'Recebido integralmente')
- Documento fiscal (NFC-e 000001482 — 'Série 1 • Autorizada')
- Margem estimada (R$ 142,80 — '32,9% sobre a venda')
- Painel 'Cliente e operação' (Celular, Vendedor, Tabela de preço, Origem, Filial)

**Estados e selos**
- Concluída (selo verde)
- Documento 'Autorizada'
- Pagamento 'Recebido integralmente'
- 'Estoque baixado na Matriz'

**Regras e políticas ilustradas (exemplos)**
- Subtotal do item = Qtd. × Unitário (2 × R$ 89,90 = R$ 179,80)
- Subtotal da venda = soma dos itens (R$ 179,80 + R$ 219,90 + R$ 34,90 = R$ 434,60)
- Total = Subtotal − Desconto (R$ 434,60 − R$ 0,00)
- Margem estimada % = margem / total da venda (R$ 142,80 / R$ 434,60 = 32,9%)
- Venda baixa estoque na filial onde ocorreu ('Estoque baixado na Matriz')
- Contagem de unidades vs. produtos distintos ('4 unidades • 3 produtos')
- Ações (cancelar etc.) condicionadas ao status da venda e às permissões

**Inconsistências do protótipo**
- Margem estimada R$ 142,80 não bate com os custos da Lista de produtos (tela 15): custos 2 × R$ 42,00 + R$ 108,00 + R$ 14,50 = R$ 206,50, o que daria margem de R$ 228,10 (52,5%)
- Operador exibido como 'Hércules' no cabeçalho e vendedor como 'Hércules Benevides' no painel — mesma pessoa em dois papéis com nomes em formatos diferentes
- Layout sem menu lateral (só barra superior), diferente da tela 09 que leva até esta
- Botão 'Cancelar venda' visível, mas não há botão para iniciar 'Troca ou devolução' (tela 11), cujo breadcrumb parte desta venda

### Tela 11 — Trocas e devoluções (p. 15)

Grupo: Vendas e caixa

**Objetivo:** Conduz a reversão parcial ou total de itens vendidos e apresenta a forma de compensação ao cliente junto dos impactos da operação.

**Principais ações (comentário)**
- Escolher os itens e as quantidades devolvidas.
- Selecionar vale-crédito, estorno ou troca.
- Revisar os impactos e confirmar a operação.

**Ponto de atenção**
- Impedir devolução acima da quantidade disponível da venda.
- A implementação deve coordenar estoque, compensação financeira e tratamento fiscal aplicável.

**Regiões da tela**
- Barra superior escura: logo + 'Intercert ERP' / 'Trocas e devoluções', centro 'Loja Modelo — Matriz', avatar 'HB'
- Breadcrumb 'Vendas e PDV / Venda #10483 / Nova troca ou devolução'
- Título 'Troca ou devolução' + subtítulo 'Selecione os produtos, informe o motivo e defina como o cliente será compensado.' + botão de voltar
- Cartão de resumo da venda original (ícone de recibo)
- Indicador de etapas (stepper) com 3 passos
- Painel esquerdo superior: tabela 'Produtos disponíveis para troca ou devolução'
- Painel esquerdo inferior: 'Como deseja compensar o cliente?' com 3 cartões de opção + observações
- Painel direito: 'Impactos da operação' (4 blocos) + resumo de valores + botão de confirmação

**Campos observados**
- Venda original ('#10483 • 21/09/2026 às 20:48')
- Cliente ('Maria da Silva')
- Documento ('NFC-e 000001482')
- Valor total (R$ 434,60)
- Seleção do item (checkbox por linha)
- Qtd. (campo numérico por item, valor '1')
- Motivo (select por item — opções visíveis 'Tamanho inadequado' e 'Produto incorreto', truncadas)
- Valor do item (R$ 89,90 / R$ 219,90 / R$ 34,90)
- Informação 'Comprado: N' na sublinha do produto (quantidade disponível)
- Total selecionado (rodapé: 'Nenhum produto selecionado' / R$ 0,00)
- Forma de compensação (seleção única por cartões: Vale-crédito / Estorno / Troca imediata)
- Observações da operação (textarea) — placeholder 'Descreva detalhes relevantes da troca ou devolução'
- Produtos selecionados (0)
- Taxas ou diferenças (R$ 0,00)
- Valor da operação (R$ 0,00, destaque laranja)

**Botões e ações observados**
- ← Voltar à venda
- Checkbox de seleção de cada produto
- Select de Motivo por item
- Cartão 'Vale-crédito' (selecionado)
- Cartão 'Estorno'
- Cartão 'Troca imediata'
- Confirmar troca ou devolução (botão primário, desabilitado/esmaecido)
- Links do breadcrumb
- Avatar HB

**Abas / etapas**
- Etapa 1 — Selecionar produtos (ativa)
- Etapa 2 — Definir compensação
- Etapa 3 — Confirmar operação

**Colunas de tabelas**
- Produtos disponíveis para troca ou devolução: [checkbox]
- Produtos disponíveis para troca ou devolução: Produto (nome + 'CM-001 • Azul • M • Comprado: 2')
- Produtos disponíveis para troca ou devolução: Qtd. (input)
- Produtos disponíveis para troca ou devolução: Motivo (select)
- Produtos disponíveis para troca ou devolução: Valor

**Indicadores / cartões / gráficos**
- Cartão resumo: Venda original, Cliente, Documento, Valor total
- Cartão Vale-crédito — 'Gera saldo para uma nova compra'
- Cartão Estorno — 'Devolve pela forma original'
- Cartão Troca imediata — 'Abre seleção de novos produtos'
- Impacto Estoque — 'Os itens aptos retornarão ao estoque da Matriz após a confirmação.'
- Impacto Fiscal — 'Será gerada a operação fiscal correspondente vinculada à NFC-e original.'
- Impacto Financeiro — 'Será criado um vale-crédito para a cliente.'
- Impacto Auditoria — 'Usuário, data, motivo e autorizações ficarão registrados.'

**Estados e selos**
- Etapa ativa destacada em laranja com número em círculo
- Botão de confirmação desabilitado enquanto nenhum produto está selecionado
- Cartão de compensação selecionado com borda laranja

**Regras e políticas ilustradas (exemplos)**
- Quantidade devolvida limitada a 'Comprado: N' de cada item
- Motivo obrigatório por item (ex.: 'Tamanho inadequado', 'Produto incorreto')
- Valor da operação = soma dos itens selecionados ± Taxas ou diferenças
- Itens aptos retornam ao estoque da filial (Matriz) somente após a confirmação
- Operação fiscal de devolução vinculada à NFC-e original
- Vale-crédito gera saldo para nova compra; Estorno devolve pela forma de pagamento original; Troca imediata abre seleção de novos produtos
- Registro de auditoria com usuário, data, motivo e autorizações
- 'Operações acima do limite exigem autorização do gerente.'

**Inconsistências do protótipo**
- Stepper indica a etapa 1 'Selecionar produtos' ativa, mas o conteúdo da etapa 2 (compensação) já aparece na mesma tela, com 'Vale-crédito' pré-selecionado
- Bloco 'Impactos da operação' já descreve vale-crédito e retorno ao estoque com 0 produtos selecionados
- Campos Qtd. ('1') e Motivo vêm pré-preenchidos em itens não marcados
- Coluna Valor mostra o preço unitário (Camiseta R$ 89,90) embora tenham sido compradas 2 unidades, sem deixar claro se é unitário ou total
- O limite que exige autorização do gerente não tem valor informado
- Subtítulo da barra superior 'Trocas e devoluções' (módulo) vs. título 'Troca ou devolução' e breadcrumb iniciando em 'Vendas e PDV'

### Tela 12 — Abertura de caixa (p. 16)

Grupo: Vendas e caixa

**Objetivo:** Inicia a sessão de trabalho do operador, vinculando terminal, usuário e valor de abertura para o controle posterior do caixa.

**Principais ações (comentário)**
- Conferir os dados da sessão e do terminal.
- Informar o fundo inicial de caixa.
- Abrir o caixa e liberar o início das vendas.

**Ponto de atenção**
- O fundo de abertura não representa faturamento.
- Evitar sessões simultâneas incompatíveis para o mesmo terminal e registrar o responsável pela abertura.

**Regiões da tela**
- Barra superior escura do PDV: logo + 'Intercert PDV' / 'Abertura de caixa', centro 'Loja Modelo • Matriz • Juazeiro do Norte', direita nome 'Hércules Benevides' + avatar 'HB'
- Bloco central de boas-vindas: ícone de cifrão, título 'Vamos abrir o caixa?' e subtítulo 'Confira os dados, informe o fundo inicial e valide os equipamentos antes de iniciar as vendas.'
- Painel esquerdo 'Dados da abertura' (campos informativos + formulário)
- Painel direito 'Conferência do terminal' (checklist de equipamentos com interruptores, alerta, resumo de saldo e botão principal)

**Campos observados**
- Operador (somente leitura — 'Hércules Benevides')
- Data e hora (somente leitura — '21/09/2026 • 08:02')
- Filial (somente leitura — 'Loja Modelo — Matriz')
- Último fechamento (somente leitura — '20/09/2026 • Sem diferença')
- Terminal de caixa (select — 'Caixa 01 — Balcão principal')
- Fundo de troco em dinheiro * (moeda, obrigatório — 'R$ 200.00')
- Valores rápidos do fundo (chips: R$ 100, R$ 150, R$ 200, R$ 300)
- Observações da abertura (textarea) — placeholder 'Ex.: Fundo recebido do financeiro, notas pequenas conferidas...'
- Impressora não fiscal (interruptor ligado — 'Conectada e com papel')
- Leitor de código de barras (interruptor ligado — 'Leitura testada')
- TEF / Pinpad (interruptor ligado — 'Comunicação disponível')
- Internet e SEFAZ (interruptor ligado — 'Serviços operacionais')
- Saldo anterior (R$ 0,00)
- Suprimento inicial (R$ 200,00)
- Saldo de abertura (R$ 200,00, destaque)

**Botões e ações observados**
- Chips de valor rápido: R$ 100, R$ 150, R$ 200, R$ 300
- Interruptores (toggles) de conferência de cada equipamento
- Select de terminal de caixa
- Abrir caixa e iniciar vendas (botão primário laranja com ícone de cadeado aberto)
- Avatar HB / nome do operador

**Indicadores / cartões / gráficos**
- Cartão 'Dados da abertura'
- Cartão 'Conferência do terminal' com 4 itens de equipamento
- Alerta laranja: 'Confirme somente após contar o dinheiro e validar os equipamentos. A abertura ficará registrada na auditoria.'
- Resumo: Saldo anterior / Suprimento inicial / Saldo de abertura (R$ 200,00)
- Nota de rodapé: 'Será gerado um registro com usuário, terminal, IP, data e horário.'

**Estados e selos**
- Interruptores verdes = equipamento conferido/ok
- Status de equipamento: 'Conectada e com papel', 'Leitura testada', 'Comunicação disponível', 'Serviços operacionais'
- Último fechamento: 'Sem diferença'

**Regras e políticas ilustradas (exemplos)**
- Saldo de abertura = Saldo anterior + Suprimento inicial (R$ 0,00 + R$ 200,00 = R$ 200,00)
- Fundo de troco em dinheiro é obrigatório (*)
- Abertura gera registro de auditoria com usuário, terminal, IP, data e horário
- Checklist de equipamentos (impressora, leitor, TEF/Pinpad, Internet/SEFAZ) antes de liberar vendas
- Exibe resultado do último fechamento do terminal ('20/09/2026 • Sem diferença')
- Uma sessão por terminal (evitar sessões simultâneas incompatíveis)
- Fundo de abertura não conta como faturamento

**Inconsistências do protótipo**
- Campo do fundo exibe '200.00' (ponto decimal) enquanto os resumos usam 'R$ 200,00' (vírgula)
- O resumo chama o fundo de 'Suprimento inicial', mas na tela 13 a mesma entrada é do tipo 'Abertura'/'Fundo de abertura' e não entra no total de 'Suprimentos' (R$ 150,00)
- Os equipamentos aparecem como interruptores que o operador pode ligar/desligar, mas os textos ('Leitura testada', 'Comunicação disponível') sugerem verificação automática
- Formato do local no cabeçalho 'Loja Modelo • Matriz • Juazeiro do Norte' difere do padrão 'Loja Modelo — Matriz' das demais telas
- Nome do sistema muda para 'Intercert PDV' (nas telas do ERP aparece 'Intercert ERP')

### Tela 13 — Suprimentos e sangrias (p. 17)

Grupo: Vendas e caixa

**Objetivo:** Registra entradas e retiradas de dinheiro durante a sessão, separando esses movimentos das vendas e facilitando a conferência do caixa.

**Principais ações (comentário)**
- Escolher suprimento ou sangria.
- Informar valor e identificação do movimento.
- Consultar o histórico da sessão.

**Ponto de atenção**
- Toda movimentação deve ter origem, motivo e operador identificados.
- Sangrias precisam respeitar o saldo disponível e a política de autorização da empresa.

**Regiões da tela**
- Barra superior escura do PDV: logo + 'Intercert PDV' / 'Movimentações de caixa', centro 'Caixa 01 • Aberto desde 08:02' / 'Operador: Hércules', avatar 'HB'
- Título 'Suprimentos e sangrias' + subtítulo 'Registre entradas e retiradas de dinheiro durante a sessão do caixa.' + destaque à direita 'Saldo em dinheiro estimado'
- Faixa de 4 cartões de indicadores
- Painel esquerdo 'Nova movimentação' (formulário)
- Painel direito 'Movimentações desta sessão' (tabela com 2 selects e rodapé)

**Campos observados**
- Tipo de movimentação (seleção por cartões: Suprimento / Sangria — 'Sangria' selecionado)
- Valor * (moeda, obrigatório — 'R$ 200.00')
- Motivo * (select, obrigatório — 'Retirada para cofre')
- Destino / origem do numerário (select — 'Cofre da empresa')
- Responsável pela conferência (select — 'Karem — Financeiro')
- Observações (textarea) — placeholder 'Informe detalhes adicionais da movimentação'
- Saldo em dinheiro estimado (R$ 1.382,50)

**Botões e ações observados**
- Cartão 'Suprimento' (ícone ⊕ verde)
- Cartão 'Sangria' (ícone ⊖ vermelho, selecionado com borda laranja)
- Registrar sangria (botão primário laranja com ✓ — rótulo muda conforme o tipo)
- Select 'Todos os tipos'
- Select 'Mais recentes'
- Avatar HB

**Colunas de tabelas**
- Movimentações desta sessão: Horário (hora '14:32' + 'Hoje')
- Movimentações desta sessão: Tipo (selo)
- Movimentações desta sessão: Motivo (motivo + 'Destino: Cofre' / 'Origem: Financeiro' / 'Caixa 01')
- Movimentações desta sessão: Responsável (nome 'Karem'/'Hércules' + 'Por Hércules'/'Operador')
- Movimentações desta sessão: Valor (com sinal: '− R$ 250,00' vermelho, '+ R$ 150,00' verde, 'R$ 200,00' neutro)
- Rodapé: '4 movimentações registradas' e 'Auditoria ativa • Caixa 01'

**Filtros**
- Tipo: 'Todos os tipos' (select)
- Ordenação: 'Mais recentes' (select)

**Indicadores / cartões / gráficos**
- Fundo de abertura (R$ 200,00)
- Vendas em dinheiro (R$ 1.432,50, verde)
- Suprimentos (R$ 150,00, verde)
- Sangrias (R$ 400,00, vermelho)
- Saldo em dinheiro estimado (R$ 1.382,50, destaque azul)
- Alerta: 'Sangrias acima de R$ 500,00 exigem autorização adicional do gerente.'

**Estados e selos**
- Sangria (selo vermelho)
- Suprimento (selo verde)
- Abertura (selo azul)
- Auditoria ativa • Caixa 01
- Caixa aberto desde 08:02

**Regras e políticas ilustradas (exemplos)**
- Saldo em dinheiro estimado = Fundo de abertura + Vendas em dinheiro + Suprimentos − Sangrias (R$ 200,00 + R$ 1.432,50 + R$ 150,00 − R$ 400,00 = R$ 1.382,50)
- Sangrias acima de R$ 500,00 exigem autorização adicional do gerente
- Sangria não pode exceder o saldo disponível em dinheiro
- Valor e Motivo obrigatórios
- Cada movimentação registra quem conferiu (Responsável) e quem lançou ('Por Hércules')
- Sangria tem Destino (ex.: Cofre); suprimento tem Origem (ex.: Financeiro)
- Abertura (fundo de troco) listada como movimentação, mas separada dos totais de Suprimentos
- Sinais/cores: saída negativa em vermelho, entrada positiva em verde

**Inconsistências do protótipo**
- Campo Valor mostra '200.00' (ponto decimal) e os totais usam vírgula ('R$ 200,00')
- Select de destino 'Cofre da empresa' aparece na tabela como 'Destino: Cofre'
- A abertura é chamada 'Suprimento inicial' na tela 12, mas aqui é do tipo 'Abertura' e não entra no total de Suprimentos
- Cabeçalho diz 'Aberto desde 08:02', na tela 14 diz 'Aberto às 08:02'
- O rótulo 'Responsável' mostra quem conferiu (Karem), enquanto quem lançou aparece só na sublinha ('Por Hércules'); na linha de abertura, responsável e operador são a mesma pessoa

### Tela 14 — Fechamento de caixa (p. 18)

Grupo: Vendas e caixa

**Objetivo:** Compara os valores previstos com os informados pelo operador e encerra a sessão, destacando divergências por forma de pagamento.

**Principais ações (comentário)**
- Conferir valores por meio de pagamento.
- Revisar diferenças e conferências finais.
- Consultar o relatório e fechar a sessão.

**Ponto de atenção**
- As diferenças não devem desaparecer automaticamente.
- O fechamento precisa preservar os valores apurados, a conferência informada e a justificativa de eventuais divergências.

**Regiões da tela**
- Barra superior escura do PDV: logo + 'Intercert PDV' / 'Fechamento de caixa', centro 'Caixa 01 • Aberto às 08:02' / 'Operador: Hércules • 12h46 de sessão', avatar 'HB'
- Título 'Conferência e fechamento' + subtítulo 'Informe os valores contados e conciliados para apurar eventuais diferenças.' + botão de voltar
- Faixa de 4 cartões de indicadores
- Painel esquerdo 'Conferência por forma de pagamento' (tabela com inputs, aviso de conferência cega e totais)
- Painel direito 'Conferências finais' (checklist, situação do fechamento e botões)

**Campos observados**
- Informado — Dinheiro (input numérico '1382.50')
- Informado — Cartão de crédito (input '3240.80')
- Informado — Cartão de débito (input '1789.60')
- Informado — Pix (input '2049.00')
- Total esperado (R$ 8.461,90)
- Total informado (R$ 8.461,90)
- Diferença geral (R$ 0,00, destaque)
- Dinheiro contado (checkbox marcado) — 'Notas, moedas e fundo de troco conferidos.'
- TEF conciliado (checkbox marcado) — 'Crédito e débito comparados com os comprovantes.'
- Pix conciliado (checkbox marcado) — 'Transações confirmadas na conta recebedora.'
- Numerário entregue (checkbox desmarcado) — 'Valores encaminhados ao responsável ou cofre.'
- Situação do fechamento ('Sem diferenças', verde)
- Tempo de sessão ('12h46 de sessão')

**Botões e ações observados**
- ← Voltar ao caixa
- Confirmar e fechar caixa (botão primário com cadeado, desabilitado/esmaecido)
- Visualizar relatório antes de fechar (botão secundário)
- Checkboxes de conferências finais
- Inputs de valores informados
- Avatar HB

**Colunas de tabelas**
- Conferência por forma de pagamento: Forma de pagamento (ícone + nome + sublinha: 'Inclui fundo, suprimentos e sangrias' / 'TEF • 18 transações' / 'TEF • 11 transações' / 'Conciliação automática • 14 transações')
- Conferência por forma de pagamento: Esperado (Dinheiro R$ 1.382,50; Crédito R$ 3.240,80; Débito R$ 1.789,60; Pix R$ 2.049,00)
- Conferência por forma de pagamento: Informado (input)
- Conferência por forma de pagamento: Diferença (R$ 0,00 em verde)
- Rodapé: Total esperado, Total informado, Diferença geral

**Indicadores / cartões / gráficos**
- Vendas concluídas (47 — R$ 8.462,90)
- Suprimentos (R$ 150,00 — '1 movimentação')
- Sangrias (R$ 400,00 — '2 movimentações')
- Cancelamentos (1 — R$ 74,50)
- Situação do fechamento ('Sem diferenças')
- Aviso de conferência cega (ícone de olho cortado): 'No modo de conferência cega, a coluna "Esperado" fica oculta para o operador e é exibida somente após a contagem.'
- Nota: 'O fechamento não poderá ser alterado sem autorização administrativa.'

**Estados e selos**
- Situação do fechamento: 'Sem diferenças' (verde)
- Diferença por linha em verde quando zero
- Checkbox marcado (laranja) / desmarcado
- Botão de fechar desabilitado enquanto há conferência final pendente

**Regras e políticas ilustradas (exemplos)**
- Diferença = Informado − Esperado, por forma de pagamento
- Total esperado = soma dos esperados (R$ 1.382,50 + R$ 3.240,80 + R$ 1.789,60 + R$ 2.049,00 = R$ 8.461,90)
- Diferença geral = Total informado − Total esperado
- Dinheiro esperado inclui fundo, suprimentos e sangrias (= saldo em dinheiro estimado da tela 13, R$ 1.382,50)
- Conferência cega: coluna 'Esperado' oculta ao operador até a contagem
- Fechamento só é liberado após todas as conferências finais marcadas (Dinheiro contado, TEF conciliado, Pix conciliado, Numerário entregue)
- Pix com conciliação automática; cartões via TEF com número de transações
- Fechamento imutável sem autorização administrativa
- Diferenças devem ser preservadas com justificativa, nunca zeradas automaticamente

**Inconsistências do protótipo**
- 'Vendas concluídas' R$ 8.462,90 não bate com a soma das vendas por forma de pagamento: R$ 1.432,50 (dinheiro, tela 13) + R$ 3.240,80 + R$ 1.789,60 + R$ 2.049,00 = R$ 8.511,90
- Vendas concluídas (R$ 8.462,90) e Total esperado (R$ 8.461,90) diferem em R$ 1,00 sem explicação
- O cancelamento de R$ 74,50 corresponde à venda #10481, que a tela 09 atribui ao 'Caixa 02', mas aqui aparece no fechamento do 'Caixa 01'
- A tela mostra a coluna 'Esperado' preenchida junto com o aviso de que, em conferência cega, ela fica oculta — não está claro qual modo está ativo
- Inputs usam ponto decimal ('1382.50'), enquanto os valores esperados usam vírgula ('R$ 1.382,50')
- Não há campo de justificativa de divergência, embora o ponto de atenção a exija

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

### Tela 20 — Gestão de clientes (p. 26)

Grupo: Clientes

**Objetivo:** Apresenta a carteira de clientes e oferece acesso ao histórico e aos dados necessários ao relacionamento comercial e ao atendimento.

**Principais ações (comentário)**
- Pesquisar e filtrar os cadastros.
- Consultar detalhes e compras recentes.
- Acessar inclusão e edição do cliente.

**Ponto de atenção**
- Aplicar regras consistentes para duplicidade, situação cadastral e acesso aos dados. A mesma identidade deve ser utilizada em vendas, financeiro e fiscal.

**Regiões da tela**
- Barra superior global (azul-marinho): logo 'I' laranja, 'Intercert ERP' + subtítulo 'Gestão de clientes', contexto central 'Loja Modelo — Matriz', avatar 'HB' à direita
- Cabeçalho da página: título 'Clientes' + subtítulo 'Consulte cadastros, histórico de compras, crédito e relacionamento.'; botão laranja 'Novo cliente' à direita
- Faixa de 4 cartões de indicadores (Total de clientes, Clientes ativos, Ticket médio, Aniversariantes)
- Painel de listagem: barra com busca (esquerda) e filtros/ações (direita), tabela de clientes com 5 linhas, rodapé com contagem (esquerda) e paginação (direita)

**Campos observados**
- Busca (texto com ícone de lupa; placeholder 'Buscar por nome, CPF/CNPJ, telefone ou e-ma[il]', truncado)
- Tipo de pessoa (select; valor 'Pessoa física e jurídica')
- Status (select; valor 'Todos os status')
- Nome do cliente (texto)
- Iniciais do cliente (avatar circular: MO, MS, JL, CC, AV)
- Cliente desde (mês/ano, ex.: 'mar/2023')
- Quantidade de compras (ex.: '28 compras')
- CPF/CNPJ (máscara 000.000.000-00 ou 00.000.000/0000-00)
- Telefone (ex.: '(88) 99912-3401')
- E-mail (ex.: 'mariana@email.com')
- Data da última compra (DD/MM/AAAA)
- Valor da última compra (R$, abaixo da data)
- Total comprado (R$)
- Crédito disponível (R$)
- Status (selo)

**Botões e ações observados**
- Botão laranja 'Novo cliente' (ícone pessoa com +)
- Campo de busca (lupa)
- Dropdown 'Pessoa física e jurídica'
- Dropdown 'Todos os status'
- Botão 'Mais filtros' (ícone de controles/sliders)
- Botão 'Exportar' (ícone download)
- Ação por linha 'Visualizar' (ícone olho)
- Ação por linha 'Editar' (ícone lápis)
- Ação por linha 'Mais opções' (ícone …)
- Paginação: botão '1' (ativo, azul-marinho), '2', '3', '›' (próxima página)
- Avatar do usuário 'HB' (menu do usuário)

**Colunas de tabelas**
- Clientes: Cliente (avatar com iniciais + nome + 'Cliente desde mmm/aaaa • N compras')
- Clientes: CPF/CNPJ
- Clientes: Contato (telefone + e-mail)
- Clientes: Última compra (data DD/MM/AAAA + valor R$)
- Clientes: Total comprado
- Clientes: Crédito disponível
- Clientes: Status (selo)
- Clientes: Ações (visualizar, editar, mais opções)
- Dados de exemplo: Mariana Oliveira | 123.456.789-00 | (88) 99912-3401 mariana@email.com | 20/09/2026 R$ 289,90 | R$ 6.842,70 | R$ 1.200,00 | VIP (desde mar/2023, 28 compras)
- Dados de exemplo: Mercadinho São Lucas | 12.345.678/0001-90 | (88) 3512-4080 compras@saolucas.com.br | 18/09/2026 R$ 1.480,00 | R$ 18.932,50 | R$ 4.000,00 | Ativo (desde ago/2024, 16 compras)
- Dados de exemplo: João Carlos de Lima | 987.654.321-00 | (88) 98841-2209 joaocl@gmail.com | 16/09/2026 R$ 119,80 | R$ 1.246,30 | R$ 500,00 | Ativo (desde jan/2025, 7 compras)
- Dados de exemplo: Construtora Cariri Ltda. | 46.912.332/0001-08 | (88) 3571-6610 financeiro@cariri.com.br | 12/09/2026 R$ 2.840,00 | R$ 47.589,10 | R$ 8.500,00 | Ativo (desde nov/2022, 41 compras)
- Dados de exemplo: Ana Paula Vieira | 741.852.963-00 | (88) 99731-5820 anapaula@email.com | 05/02/2026 R$ 89,90 | R$ 327,60 | R$ 0,00 | Inativo (desde fev/2024, 3 compras)

**Filtros**
- Busca por nome, CPF/CNPJ, telefone ou e-mail
- Tipo de pessoa (select: 'Pessoa física e jurídica' — opções implícitas: física / jurídica / ambas)
- Status (select: 'Todos os status' — Ativo / Inativo / VIP implícitos)
- Mais filtros (painel adicional não exibido)

**Indicadores / cartões / gráficos**
- Total de clientes (2.486, preto; '+38 neste mês')
- Clientes ativos (1.942, azul; 'Compraram nos últimos 90 dias')
- Ticket médio (R$ 184, preto; 'Últimos 30 dias')
- Aniversariantes (16, laranja; 'Nos próximos 7 dias')
- Rodapé da tabela: 'Exibindo 5 de 2.486 clientes'

**Estados e selos**
- Selo 'VIP' (fundo laranja claro, ícone estrela)
- Selo 'Ativo' (fundo verde claro, ícone check)
- Selo 'Inativo' (cinza, sem ícone)
- Avatar circular com iniciais em azul sobre fundo cinza-azulado
- Botão de página ativa em azul-marinho

**Regras e políticas ilustradas (exemplos)**
- Cliente ativo (indicador) = comprou nos últimos 90 dias
- Ticket médio calculado sobre os últimos 30 dias
- Aniversariantes considerados nos próximos 7 dias
- Indicador de novos cadastros no mês ('+38 neste mês')
- Mesma listagem para pessoa física (CPF) e jurídica (CNPJ), filtrável por tipo
- Cada cliente tem crédito disponível e total comprado acumulado
- Linha exibe tempo de relacionamento ('Cliente desde') e quantidade de compras
- Cliente sem compra há mais de 90 dias (Ana Paula, última compra 05/02/2026) aparece 'Inativo' e com crédito disponível R$ 0,00 — sugere bloqueio de crédito por inatividade/inadimplência (ela tem parcela em atraso na Tela 22)
- Paginação de 5 registros por página no exemplo
- Código de cliente sequencial: 2.486 clientes e próximo código CLI-002487 na Tela 21

**Inconsistências do protótipo**
- Ana Paula Vieira tem 'Total comprado' R$ 327,60, mas na Tela 22 possui parcela 4/4 de R$ 89,90 (4 × 89,90 = R$ 359,60, acima do total comprado)
- Ana Paula: última compra 05/02/2026, mas a parcela 4/4 (Tela 22) vence em 05/09/2026 — 7 meses depois, incompatível com parcelamento mensal em 4 vezes
- João Carlos de Lima tem última compra em 16/09/2026 (R$ 119,80), mas a Venda #10391 associada a ele na Tela 22 aparece em 17/09 16:48 na Tela 17 (posterior à 'última compra')
- Mariana Oliveira com última compra em 20/09/2026 de R$ 289,90 — igual ao valor da parcela 2/3 com vencimento em 21/09 (Tela 22), o que é implausível para uma venda do dia anterior
- Tela 21 mostra Mariana Oliveira (mesmo CPF 123.456.789-00) sendo cadastrada como 'Novo cliente' com código CLI-002487 e 'Cliente VIP' desmarcado, enquanto aqui ela já é cliente VIP desde mar/2023 (duplicidade e divergência de VIP)
- O selo 'VIP' substitui o selo 'Ativo' na coluna Status, enquanto a Tela 21 trata 'Cliente ativo' e 'Cliente VIP' como marcações independentes
- 'Clientes ativos' é definido por compra nos últimos 90 dias, mas também existe status cadastral Ativo/Inativo (dois conceitos com o mesmo nome)
- Paginação mostra apenas páginas 1–3 para 2.486 registros (≈498 páginas), sem indicação de última página

### Tela 21 — Cadastro de cliente (p. 27)

Grupo: Clientes

**Objetivo:** Reúne os dados de pessoas físicas e jurídicas, incluindo contatos, endereços, informações fiscais, condições de crédito e observações.

**Principais ações (comentário)**
- Escolher o tipo de pessoa e preencher identificação.
- Manter contatos, endereços e dados fiscais.
- Revisar crédito e salvar o cadastro.

**Ponto de atenção**
- A necessidade de cada campo depende da operação. Definir validações e permissões para crédito sem tornar o cadastro simples desnecessariamente demorado.

**Regiões da tela**
- Barra superior global: 'Intercert ERP' + subtítulo 'Cadastro de cliente', contexto 'Loja Modelo — Matriz', avatar 'HB'
- Cabeçalho: título 'Novo cliente' + subtítulo 'Cadastre os dados pessoais, fiscais, comerciais e de contato do cliente.'; indicador de etapas à direita
- Menu de seções vertical à esquerda (6 seções)
- Painel de formulário 'Dados básicos' à direita (toggle de tipo de pessoa, grade de campos, linha de caixas de seleção)
- Barra de botões de rodapé alinhada à direita

**Campos observados**
- Tipo de pessoa (alternador: Pessoa física / Pessoa jurídica; ativo: Pessoa física)
- CPF * (obrigatório; ex.: 123.456.789-00)
- Nome completo * (obrigatório; ex.: Mariana Oliveira)
- Data de nascimento (data com calendário; ex.: 05/14/1987)
- Gênero (select; ex.: Feminino)
- Código do cliente (texto, gerado; ex.: CLI-002487)
- Estado civil (select; ex.: Não informado)
- Profissão (texto; ex.: Empresária)
- Vendedor responsável (select; ex.: Vinícius)
- Cliente ativo (checkbox; marcado)
- Cliente VIP (checkbox; desmarcado)
- Aceita receber promoções (checkbox; marcado)
- Consumidor final (checkbox; marcado)

**Botões e ações observados**
- Item de menu 'Dados básicos' (ícone pessoa; ativo)
- Item de menu 'Contatos' (ícone telefone)
- Item de menu 'Endereços' (ícone localização)
- Item de menu 'Dados fiscais' (ícone prédio/banco)
- Item de menu 'Crédito e vendas' (ícone cartão/carteira)
- Item de menu 'Observações' (ícone bloco com lápis)
- Botão 'Pessoa física'
- Botão 'Pessoa jurídica'
- Botão 'Consultar' (ícone lupa, ao lado do CPF)
- Ícone de calendário 'Data de nascimento'
- Dropdowns Gênero, Estado civil, Vendedor responsável
- Botão 'Cancelar'
- Botão 'Salvar rascunho' (ícone disquete)
- Botão laranja 'Salvar cliente' (ícone check)
- Avatar 'HB'

**Abas / etapas**
- Etapa 1 'Cadastro' (ativa)
- Etapa 2 'Revisão'
- Etapa 3 'Concluído'
- Seção 'Dados básicos' (ativa)
- Seção 'Contatos'
- Seção 'Endereços'
- Seção 'Dados fiscais'
- Seção 'Crédito e vendas'
- Seção 'Observações'

**Estados e selos**
- Indicador de etapa ativa (círculo azul '1 Cadastro'); etapas futuras em cinza
- Asterisco laranja em campos obrigatórios
- Checkboxes marcados em laranja

**Regras e políticas ilustradas (exemplos)**
- CPF e Nome completo são obrigatórios para pessoa física
- Botão 'Consultar' junto ao CPF sugere validação/consulta do documento (e verificação de duplicidade)
- Código do cliente gerado sequencialmente (CLI-002487 após 2.486 clientes)
- Cadastro pode ser salvo como rascunho antes de concluído
- Fluxo em 3 etapas: Cadastro → Revisão → Concluído
- Cliente vinculado a um vendedor responsável
- Flags de cadastro: ativo, VIP, aceite de promoções (consentimento) e consumidor final (fiscal)

**Inconsistências do protótipo**
- Data de nascimento em formato MM/DD/AAAA (05/14/1987), diferente do padrão DD/MM/AAAA do restante do sistema
- Tela de 'Novo cliente' preenchida com CPF 123.456.789-00 e nome Mariana Oliveira, que já existem na Tela 20 (exemplo de duplicidade)
- 'Cliente VIP' desmarcado, enquanto Mariana Oliveira aparece como VIP na Tela 20
- Dois mecanismos de navegação simultâneos: indicador de 3 etapas (Cadastro/Revisão/Concluído) e menu de 6 seções, sem relação clara entre eles

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

### Tela 30 — Gestão de NF-e de produtos (p. 39)

Grupo: Fiscal

**Objetivo:** Centraliza a consulta dos documentos de produtos, mostrando sua situação e permitindo acompanhar detalhes, eventos e pendências de processamento.

**Principais ações (comentário)**
- Pesquisar NF-e por documento e destinatário.
- Filtrar autorizadas, pendentes, erros e rascunhos.
- Consultar detalhes e documentos relacionados.

**Ponto de atenção**
- Diferenciar envio, processamento e autorização. Eventos e arquivos devem permanecer vinculados à nota correta e ao retorno efetivo da integração fiscal.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Notas fiscais eletrônicas'; indicador central com ponto verde 'SEFAZ CE operacional • Ambiente de produção'; avatar 'HB'
- Cabeçalho: título 'NF-e de produtos' + subtítulo 'Emita, acompanhe e gerencie documentos fiscais eletrônicos modelo 55.' + botões 'Consultar SEFAZ' e 'Emitir NF-e'
- Faixa de 4 cartões de KPI
- Painel com barra de filtros (busca, status, operação, mês, Filtros)
- Abas de situação
- Tabela de documentos
- Rodapé com contador e paginação

**Campos observados**
- Busca: 'Buscar número, chave, destinatário ou CN[PJ]' (texto; placeholder truncado)
- Status (select) (Todos os status)
- Operação (select) (Todas as operações)
- Competência/mês (month) (2026-09)
- Número da NF-e (000.000.218; 'Rascunho')
- Série (Série 1; 'Sem numeração')
- Emissão – data (23/09/2026)
- Emissão – hora (10:42)
- Destinatário – nome (Mercadinho São Lucas; Construtora Cariri Ltda.; João Carlos de Lima; Mariana Oliveira; Loja Cariri Comércio)
- Destinatário – CNPJ/CPF (12.345.678/0001-90; 987.654.321-00)
- Operação (Venda de mercadorias)
- Valor (R$ 1.480,00)
- Protocolo (135260184220481; '—'; 'Rejeição 733')
- Status (Autorizada; Processando; Rejeitada; Cancelada; Rascunho)

**Botões e ações observados**
- Consultar SEFAZ (ícone de escudo)
- Emitir NF-e (botão primário laranja; ícone de documento com +)
- Filtros (ícone de controles deslizantes)
- Autorizada: ver (olho), imprimir DANFE (impressora), baixar XML (download de arquivo)
- Processando: ver (olho), atualizar/consultar retorno (ícone de atualizar)
- Rejeitada: ver (olho), editar (lápis), reenviar/transmitir (avião de papel)
- Cancelada: ver (olho), imprimir (impressora)
- Rascunho: ver (olho), editar (lápis), transmitir (avião de papel)
- Número da NF-e em link azul (abre detalhe da página 40)
- Paginação: 1 (ativa), 2, 3, próxima (›)

**Abas / etapas**
- Todas — ativa
- Autorizadas
- Processando
- Com erro
- Rascunhos

**Colunas de tabelas**
- NF-e: Número | Emissão | Destinatário | Operação | Valor | Protocolo | Status | Ações

**Filtros**
- Busca por número, chave, destinatário ou CNPJ/CPF
- Status (Todos os status)
- Operação (Todas as operações)
- Mês (2026-09)
- Filtros adicionais
- Abas por situação

**Indicadores / cartões / gráficos**
- Autorizadas neste mês (186, verde) — 'R$ 284.760 faturados'
- Em processamento (3, âmbar) — 'Aguardando retorno da SEFAZ'
- Rejeitadas (2, vermelho) — 'Precisam de correção'
- Canceladas (4) — 'R$ 6.840 cancelados'
- Indicador de serviço: SEFAZ CE operacional • Ambiente de produção (ponto verde)

**Estados e selos**
- Autorizada (verde, ícone check)
- Processando (âmbar, ícone relógio)
- Rejeitada (vermelho, ícone triângulo)
- Cancelada (vermelho claro)
- Rascunho (cinza)
- SEFAZ CE operacional (ponto verde)
- Ambiente de produção

**Regras e políticas ilustradas (exemplos)**
- Ações disponíveis variam por situação (XML apenas para autorizada; editar/reenviar para rejeitada e rascunho; atualizar para processando)
- Rascunho não tem numeração nem protocolo ('Sem numeração', '—')
- Nota rejeitada exibe o código de rejeição da SEFAZ (Rejeição 733)
- Nota cancelada mantém o protocolo de autorização original
- Indicação do ambiente (produção/homologação) e disponibilidade da SEFAZ na barra superior
- Documentos fiscais modelo 55, Série 1

**Inconsistências do protótipo**
- Nomenclatura divergente para a mesma situação: KPI 'Rejeitadas' × aba 'Com erro' × selo 'Rejeitada'; KPI 'Em processamento' × aba/selo 'Processando'
- Rodapé 'Exibindo 5 de 195 documentos' (195 = 186+3+2+4, sem contar rascunhos), mas a aba 'Todas' inclui rascunho
- Paginação 1, 2, 3 para 195 documentos de 5 em 5 (seriam 39 páginas)
- Coluna 'Protocolo' mistura número de protocolo com código de rejeição ('Rejeição 733')
- Rascunho exibe data e hora de emissão (22/09/2026 14:20) sem ter sido emitido
- Filtro de mês em formato ISO (2026-09) enquanto a tabela usa dd/mm/aaaa e outras telas usam mm/dd/aaaa
- Placeholder da busca truncado ('...destinatário ou CN')
- Mariana Oliveira aparece como destinatária de NF-e cancelada; na Tela 25 é cliente de crediário (consistência de cadastro a validar)

### Tela 30 — Detalhes de uma NF-e (detalhe da Gestão de NF-e) (p. 40)

_Visão complementar: NF-e de produtos: painel lateral 'Detalhes de uma NF-e'_

Grupo: Fiscal

**Objetivo:** O detalhe reúne a identificação da nota, sua situação e as ações documentais previstas.

**Principais ações (comentário)**
- Comentário: Exibir o retorno efetivo do serviço fiscal e manter a associação entre nota, eventos e arquivos.
- Ligação com a tela: Esta visão complementa a Tela 30: Gestão de NF-e de produtos. Consulte a página 39 para a visão principal e os comentários gerais.

**Ponto de atenção**
- Exibir o retorno efetivo do serviço fiscal e manter a associação entre nota, eventos e arquivos.

**Regiões da tela**
- Painel lateral/drawer branco sobre fundo
- Cabeçalho: 'NF-e 000.000.218' + 'Série 1 • Emitida em 23/09/2026 às 10:42' + botão fechar (X)
- Faixa verde de situação com ícone de escudo: 'NF-e autorizada pela SEFAZ' + protocolo e data/hora
- Grade 2×3 de cartões de dados
- Seção 'Chave de acesso' em caixa cinza
- Seção 'Eventos da NF-e' em linha do tempo com ícones
- Grade 2×2 de botões de ação

**Campos observados**
- Número da NF-e (000.000.218)
- Série (Série 1)
- Data/hora de emissão (Emitida em 23/09/2026 às 10:42)
- Situação SEFAZ (NF-e autorizada pela SEFAZ)
- Protocolo de autorização e data/hora (Protocolo 135260184220481 • 23/09/2026 10:42:18)
- Destinatário (Mercadinho São Lucas)
- CNPJ (12.345.678/0001-90)
- Natureza da operação (Venda de mercadorias)
- Valor total (R$ 1.480,00)
- Produtos (12 itens • 38 unidades)
- Transportadora (Transportadora Ceará)
- Chave de acesso (2326 0912 8453 3000 0142 5500 1000 0002 1813 5260 1842)
- Evento – Autorização de uso (23/09/2026 10:42 • SEFAZ CE)
- Evento – E-mail enviado ao destinatário (23/09/2026 10:43 • XML e DANFE)

**Botões e ações observados**
- Fechar (X)
- Imprimir DANFE (ícone impressora)
- Baixar XML (ícone arquivo com download)
- Reenviar e-mail (ícone envelope)
- Mais ações (ícone '...')

**Indicadores / cartões / gráficos**
- Faixa de situação 'NF-e autorizada pela SEFAZ' com protocolo

**Estados e selos**
- NF-e autorizada pela SEFAZ (faixa verde, ícone de escudo com check)
- Ícone de check circular no evento 'Autorização de uso'
- Ícone de avião de papel no evento 'E-mail enviado ao destinatário'

**Regras e políticas ilustradas (exemplos)**
- Eventos da NF-e registrados em ordem cronológica com origem (SEFAZ CE) e anexos enviados (XML e DANFE)
- E-mail com XML e DANFE enviado automaticamente ao destinatário após a autorização (1 minuto depois)
- Protocolo de autorização com carimbo de data/hora em segundos

**Inconsistências do protótipo**
- Chave de acesso contém o CNPJ 12.845.330/0001-42 (do fornecedor Distribuidora Nordeste, Tela 26) na posição do emitente, como se a nota fosse emitida pelo fornecedor e não pela empresa
- Detalhe usa 'Natureza da operação' e a lista usa 'Operação' (rótulos diferentes para o mesmo dado)
- Grande área vazia abaixo das ações; ações de cancelamento ou carta de correção ficam escondidas em 'Mais ações'

### Tela 31 — Emissão de NF-e (p. 41)

Grupo: Fiscal

**Objetivo:** Organiza o preenchimento da nota de produtos em etapas, reunindo operação, destinatário, mercadorias, tributação, transporte e pagamento.

**Principais ações (comentário)**
- Preencher os dados da operação e do cliente.
- Revisar produtos, totais e parametrização fiscal.
- Salvar rascunho, pré-visualizar e transmitir.

**Ponto de atenção**
- As regras fiscais e validações exigem especificação e homologação com o provedor escolhido. O desenho da tela não representa uma emissão fiscal já implementada.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Emissão de NF-e'; contexto central 'Modelo 55 • Série 1 • Produção • SEFAZ CE disponível'; avatar 'HB'
- Cabeçalho: título 'Emitir nova NF-e' + subtítulo 'Preencha os dados, valide a tributação e transmita o documento à SEFAZ.' + selo 'Rascunho salvo às 11:08'
- Coluna esquerda: navegação vertical por etapas (stepper) com ícones e checks
- Área central: formulário da etapa ativa 'Dados da operação'
- Coluna direita: cartão 'Totais da NF-e'
- Coluna direita: cartão 'Validação fiscal' com lista de verificações e botões de ação

**Campos observados**
- Natureza da operação * (select obrigatório) (Venda de mercadorias)
- Finalidade (select) (NF-e normal)
- Data de emissão (date) (09/23/2026)
- Data de saída (date) (09/23/2026)
- Tipo de atendimento (select) (Operação presencial)
- Consumidor final (select) (Sim)
- Destino da operação (select) (Operação interna — CE)
- Totais – Produtos (R$ 1.480,00)
- Totais – Desconto (R$ 0,00)
- Totais – Frete (R$ 0,00)
- Totais – ICMS (R$ 0,00)
- Totais – Tributos estimados (R$ 374,14)
- Total da nota (R$ 1.480,00)
- Validação – Destinatário válido (CNPJ e IE consultados)
- Validação – Produtos configurados (NCM, CFOP e CSOSN válidos)
- Validação – Totais conferidos (Base e pagamentos compatíveis)
- Validação – Transporte incompleto (Placa do veículo não informada)

**Botões e ações observados**
- Etapa Operação (ativa, com check)
- Etapa Destinatário (com check)
- Etapa Produtos
- Etapa Tributação
- Etapa Transporte
- Etapa Pagamento
- Etapa Informações
- Seletores de data (ícone de calendário)
- Salvar rascunho (ícone de disquete)
- Pré-visualizar DANFE (ícone de documento com lupa)
- Validar e transmitir (botão primário laranja; ícone de avião de papel)

**Abas / etapas**
- Operação ✓ — ativa
- Destinatário ✓
- Produtos
- Tributação
- Transporte
- Pagamento
- Informações

**Indicadores / cartões / gráficos**
- Totais da NF-e (Produtos R$ 1.480,00; Desconto R$ 0,00; Frete R$ 0,00; ICMS R$ 0,00; Tributos estimados R$ 374,14; Total da nota R$ 1.480,00)
- Validação fiscal (3 itens válidos + 1 alerta)
- Indicador de ambiente: Modelo 55 • Série 1 • Produção • SEFAZ CE disponível

**Estados e selos**
- Rascunho salvo às 11:08 (selo de salvamento automático)
- Check verde nas etapas concluídas (Operação, Destinatário)
- Check verde circular nas validações aprovadas
- Triângulo de alerta âmbar em 'Transporte incompleto'
- Campo obrigatório com asterisco laranja (Natureza da operação)

**Regras e políticas ilustradas (exemplos)**
- Emissão em 7 etapas: Operação, Destinatário, Produtos, Tributação, Transporte, Pagamento, Informações
- Validação fiscal antes da transmissão: destinatário (CNPJ e IE), produtos (NCM, CFOP e CSOSN), totais (base e pagamentos) e transporte (placa do veículo)
- Total da nota = Produtos − Desconto + Frete (+ impostos aplicáveis)
- Tributos estimados exibidos para transparência fiscal (R$ 374,14 sobre R$ 1.480,00)
- Uso de CSOSN indica regime do Simples Nacional (ICMS próprio R$ 0,00)
- Rascunho com salvamento automático (horário exibido)

**Inconsistências do protótipo**
- Datas em formato americano (09/23/2026) em vez de dd/mm/aaaa
- Validação marca 'Produtos configurados' e 'Totais conferidos (Base e pagamentos compatíveis)' como válidos, mas as etapas Produtos, Tributação e Pagamento não estão concluídas (sem check)
- Alerta 'Transporte incompleto: placa do veículo não informada' em operação presencial com consumidor final
- Destinatário validado por 'CNPJ e IE' com Consumidor final = Sim (consistência a validar)
- Totais idênticos aos da NF-e 000.000.218 (R$ 1.480,00), dado de exemplo reaproveitado
- CSOSN (Simples Nacional) e ICMS R$ 0,00 aqui × crédito de ICMS de R$ 2.898,00 na entrada da Tela 29 (regime tributário incoerente)
- Área central com grande espaço vazio abaixo do formulário

### Tela 32 — Gestão e emissão de NFS-e (p. 42)

Grupo: Fiscal

**Objetivo:** Reúne documentos de serviços e o formulário de emissão, incluindo tomador, descrição do serviço, valores e acompanhamento do processamento.

**Principais ações (comentário)**
- Consultar NFS-e, rascunhos e registros pendentes.
- Preencher os dados do tomador e do serviço.
- Revisar valores e acompanhar a emissão.

**Ponto de atenção**
- A integração e os campos exigidos dependem do padrão adotado para a operação. Códigos, retenções e alíquotas das imagens são exemplos a validar na parametrização.

**Regiões da tela**
- Barra superior escura: logotipo + 'Intercert ERP' / 'Notas fiscais de serviço'; indicador central com ponto verde 'Prefeitura de Juazeiro do Norte • Integração operacional'; avatar 'HB'
- Cabeçalho: título 'NFS-e de serviços' + subtítulo 'Emita e acompanhe notas de serviço, RPS, retenções e integrações municipais.' + botões 'Consultar RPS' e 'Emitir NFS-e'
- Faixa de 4 cartões de KPI
- Painel com barra de filtros (busca, status, município, mês, Filtros)
- Abas de situação
- Tabela de documentos
- Rodapé com contador e indicação textual de página

**Campos observados**
- Busca: 'Buscar número, RPS, tomador ou CNPJ/CP[F]' (texto; placeholder truncado)
- Status (select) (Todos os status)
- Município (select) (Todos os municípios)
- Competência/mês (month) (2026-09)
- NFS-e – número ou situação (NFS-e 001842; 'Aguardando'; 'Não gerada'; 'Rascunho')
- RPS – número (RPS 001925; 'Sem RPS')
- Emissão – data (23/09/2026)
- Emissão – hora (11:18)
- Tomador – nome (Cuida Digital; Empresa Modelo Ltda.; Clínica Cariri; Mercado Central; Escritório Modelo)
- Tomador – CNPJ (28.419.730/0001-44)
- Serviço – descrição (Implantação de software; Suporte técnico; Consultoria em TI; Treinamento de software; Manutenção mensal)
- Serviço – código LC 116 ou mensagem de erro (LC 116: 1.05; 1.07; 8.02; 'Código municipal inválido')
- Valor (R$ 7.800,00)
- ISS (R$ 312,00)
- Status (Emitida; Processando; Com erro; Cancelada; Rascunho)

**Botões e ações observados**
- Consultar RPS (ícone de atualizar)
- Emitir NFS-e (botão primário laranja; ícone de documento com +)
- Filtros (ícone de controles deslizantes)
- Emitida: ver (olho), imprimir (impressora), baixar XML (download de arquivo)
- Processando: atualizar/consultar (ícone de atualizar), ver (olho)
- Com erro: editar (lápis), reenviar/transmitir (avião de papel)
- Cancelada: ver (olho), imprimir (impressora)
- Rascunho: editar (lápis), transmitir (avião de papel)
- Número da NFS-e/RPS em link azul

**Abas / etapas**
- Todas — ativa
- Emitidas
- RPS pendentes
- Com erro
- Rascunhos

**Colunas de tabelas**
- NFS-e: NFS-e / RPS | Emissão | Tomador | Serviço | Valor | ISS | Status | Ações

**Filtros**
- Busca por número, RPS, tomador ou CNPJ/CPF
- Status (Todos os status)
- Município (Todos os municípios)
- Mês (2026-09)
- Filtros adicionais
- Abas por situação

**Indicadores / cartões / gráficos**
- Emitidas neste mês (74, verde) — 'R$ 118.460 em serviços'
- RPS em processamento (2, âmbar) — 'Aguardando retorno municipal'
- Com erro (1, vermelho) — 'Código de serviço inválido'
- ISS devido (R$ 4.738) — 'Alíquota média de 4%'
- Indicador de integração: Prefeitura de Juazeiro do Norte • Integração operacional (ponto verde)

**Estados e selos**
- Emitida (verde, ícone check)
- Processando (âmbar, ícone relógio)
- Com erro (vermelho, ícone triângulo)
- Cancelada (vermelho claro)
- Rascunho (cinza)
- Integração operacional (ponto verde)

**Regras e políticas ilustradas (exemplos)**
- ISS = Valor do serviço × 4% (7.800 → 312,00; 1.480 → 59,20; 2.500 → 100,00; 890 → 35,60; 680 → 27,20)
- ISS devido no mês = R$ 118.460 × 4% = R$ 4.738
- Fluxo RPS → NFS-e: RPS fica 'Aguardando' retorno da prefeitura; em erro a NFS-e fica 'Não gerada'
- Serviço classificado pelo item da LC 116 (1.05, 1.07, 8.02); código municipal inválido gera erro
- Rascunho fica sem RPS ('Sem RPS')
- Total de documentos = Emitidas + RPS em processamento + Com erro (74 + 2 + 1 = 77)

**Inconsistências do protótipo**
- Título e objetivo citam o formulário de emissão (tomador, descrição do serviço), mas a imagem mostra só a listagem, sem formulário
- Paginação textual 'Página 1 de 16' difere do padrão de botões numerados (1, 2, 3, ›) das outras listagens
- Ordem das ações varia: em 'Processando' o botão atualizar vem antes do 'ver'; linhas 'Com erro' e 'Rascunho' não têm 'ver'
- Nomenclatura diferente da NF-e para situações equivalentes ('Emitida' × 'Autorizada'; 'Com erro' × 'Rejeitada')
- Total 77 = 74+2+1 não inclui canceladas/rascunhos, que aparecem na aba 'Todas'
- Filtro 'Todos os municípios', mas a barra superior mostra integração com um único município (Juazeiro do Norte)
- Mix de negócio: serviços de software/TI aqui × varejo de vestuário (camisetas, calças, tênis) nas telas de compras e recebimento
- Filtro de mês em formato ISO (2026-09), diferente das outras telas
- Placeholder da busca truncado ('...ou CNPJ/CF')

### Tela 32 — Formulário de emissão de NFS-e (Gestão e emissão de NFS-e – detalhe) (p. 43)

_Visão complementar: Tela 32: Formulário de emissão de NFS-e (modal 'Emitir nova NFS-e'); a visão principal está na página 42_

Grupo: Fiscal

**Objetivo:** O formulário reúne no mesmo contexto o tomador, o serviço, a competência, os valores e as retenções. Comentário: campos e cálculos devem seguir a parametrização validada para a operação de serviços.

**Principais ações (comentário)**
- (Página de detalhe) O que este detalhe mostra: o formulário conecta tomador, serviço, competência, valores e retenções no mesmo contexto.
- Ligação com a tela: complementa a Tela 32 'Gestão e emissão de NFS-e'; visão principal e comentários gerais na página 42.

**Ponto de atenção**
- Comentário: os campos e os cálculos devem seguir a parametrização validada para a operação de serviços.

**Regiões da tela**
- Modal/diálogo centralizado com título 'Emitir nova NFS-e' e subtítulo do prestador ('Prestador: Loja Modelo Ltda. • Juazeiro do Norte — CE')
- Botão fechar (X) no canto superior direito
- Seção 'Tomador do serviço' com seletor de cliente, município e faixa somente leitura com os dados do tomador (CNPJ, Inscrição municipal, E-mail, Optante Simples)
- Seção 'Serviço prestado' em grade de 3 colunas
- Área de texto 'Discriminação do serviço' em largura total
- Linha de valores (Valor dos serviços, Desconto incondicionado, Alíquota ISS)
- Seção 'Retenções federais' com 5 cartões de entrada (INSS, IR, CSLL, PIS, COFINS)
- Faixa-resumo calculada (Base de cálculo, ISS calculado, Retenções, Valor líquido em destaque)
- Rodapé do modal com botões Cancelar, Salvar rascunho e Emitir NFS-e (primário laranja)

**Campos observados**
- Prestador (texto informativo no cabeçalho: razão social • município/UF) (Loja Modelo Ltda. • Juazeiro do Norte — CE)
- Cliente * (select obrigatório, nome — CNPJ) (Cuida Digital — 28.419.730/0001-44)
- Município (campo do tomador, input) (Juazeiro do Norte — CE)
- CNPJ (somente leitura, dados do tomador) (28.419.730/0001-44)
- Inscrição municipal (somente leitura) (0148821)
- E-mail (somente leitura) (fiscal@cuidadigital.com.br)
- Optante Simples (somente leitura, Sim/Não) (Sim)
- Data de competência (date picker) (09/23/2026)
- Item da lista de serviços * (select obrigatório) (1.05 — Licenciamento ou cessão de direito de uso)
- Código municipal (select) (10501 — Licenciamento de s…)
- Local da prestação (select de município) (Juazeiro do Norte — CE)
- Exigibilidade do ISS (select) (Exigível)
- Discriminação do serviço * (textarea obrigatória) (Implantação, configuração e treinamento do sistema ERP conforme contrato comercial.)
- Valor dos serviços (numérico decimal) (7800.00)
- Desconto incondicionado (numérico decimal) (0.00)
- Alíquota ISS (% numérico) (4.00)
- INSS (retenção federal, moeda) (0,00)
- IR (retenção federal, moeda) (0,00)
- CSLL (retenção federal, moeda) (0,00)
- PIS (retenção federal, moeda) (0,00)
- COFINS (retenção federal, moeda) (0,00)
- Base de cálculo (calculado, somente leitura) (R$ 7.800,00)
- ISS calculado (calculado, somente leitura) (R$ 312,00)
- Retenções (calculado, somente leitura) (R$ 0,00)
- Valor líquido (calculado, destaque) (R$ 7.800,00)

**Botões e ações observados**
- Fechar modal (X)
- Abrir seletor de Cliente (dropdown)
- Abrir calendário da Data de competência (ícone de calendário)
- Abrir select Item da lista de serviços
- Abrir select Código municipal
- Abrir select Local da prestação
- Abrir select Exigibilidade do ISS
- Cancelar
- Salvar rascunho (ícone de disquete)
- Emitir NFS-e (botão primário laranja com ícone de avião de papel/enviar)

**Indicadores / cartões / gráficos**
- Resumo calculado: Base de cálculo (R$ 7.800,00)
- Resumo calculado: ISS calculado (R$ 312,00)
- Resumo calculado: Retenções (R$ 0,00)
- Resumo calculado: Valor líquido (R$ 7.800,00, em destaque azul)

**Estados e selos**
- Asterisco vermelho de obrigatoriedade em Cliente, Item da lista de serviços e Discriminação do serviço

**Regras e políticas ilustradas (exemplos)**
- Ao selecionar o cliente, os dados do tomador (CNPJ, inscrição municipal, e-mail e se é optante do Simples) são preenchidos automaticamente em modo somente leitura
- Base de cálculo = Valor dos serviços − Desconto incondicionado (7.800,00 − 0,00 = 7.800,00)
- ISS calculado = Base de cálculo × Alíquota ISS (7.800,00 × 4% = 312,00)
- Retenções = soma de INSS + IR + CSLL + PIS + COFINS (0,00)
- Valor líquido = Valor dos serviços − desconto incondicionado − retenções; o ISS exigível e não retido não é descontado (7.800,00)
- Item da lista de serviços (LC 116), código de tributação municipal, local da prestação e exigibilidade do ISS são escolhidos em listas, não digitados
- A NFS-e pode ser guardada como rascunho antes da emissão

**Inconsistências do protótipo**
- A Data de competência aparece no formato americano MM/DD/AAAA (09/23/2026), mas o restante do protótipo usa DD/MM/AAAA
- Os campos de valor usam ponto decimal sem máscara (7800.00, 0.00, 4.00), enquanto as retenções e o resumo usam vírgula e R$ (0,00 / R$ 7.800,00)
- O texto do Código municipal está cortado no select ('10501 — Licenciamento de s…')
- Possível divergência semântica: o item 1.05 (licenciamento ou cessão de direito de uso) não combina com a discriminação 'Implantação, configuração e treinamento', que se enquadraria em outros itens da LC 116
- O prestador se chama 'Loja Modelo Ltda.', enquanto outras telas usam 'Loja Centro' (Tela 34 tem CNAE de comércio varejista 4713-0/02), o que destoa de uma prestação de serviços de ERP

### Tela 33 — Gestão de NFC-e do PDV (p. 44)

Grupo: Fiscal

**Objetivo:** Permite acompanhar os documentos originados no caixa e identificar operações autorizadas, rejeitadas, canceladas ou pendentes de transmissão.

**Principais ações (comentário)**
- Localizar documentos pela venda ou consumidor.
- Consultar detalhes e arquivos fiscais.
- Acompanhar contingência e pendências.

**Ponto de atenção**
- A fila fiscal deve preservar a relação com cada venda. Situações de contingência e retransmissão precisam evitar duplicidade e apresentar o retorno real do serviço fiscal.

**Regiões da tela**
- Barra superior azul-marinho escura com logo quadrado laranja 'I', título 'Intercert ERP' e subtítulo 'NFC-e do PDV'
- Indicadores fiscais no centro da barra superior: '● SEFAZ CE online' (ponto verde), 'CSC configurado', 'Série 1'
- Avatar circular do usuário 'HB' no canto superior direito
- Cabeçalho da página: título 'NFC-e e documentos do PDV' e subtítulo 'Acompanhe as vendas fiscais, contingências, cancelamentos e transmissões do caixa.'
- Botões de ação no canto direito do cabeçalho (Ativar contingência, Abrir PDV)
- Linha com 4 cartões de KPI (rótulo, valor grande colorido, legenda)
- Painel de listagem: linha de busca + 3 filtros + botão Filtros; linha de abas de status em formato de pílula; tabela de documentos; rodapé com contagem e paginação
- Sem menu lateral nesta tela (layout próprio do PDV, diferente do shell do ERP)

**Campos observados**
- Busca (texto, ícone de lupa; placeholder 'Buscar número, venda, cliente, chave ou…', cortado)
- Status (select) (Todos os status)
- Caixa (select) (Todos os caixas)
- Data (date picker nativo, ícone de calendário) (09/23/2026)
- Rótulo de dado: Número da NFC-e (000.001.492)
- Rótulo de dado: Série (Série 1)
- Rótulo de dado: Data (23/09/2026) e hora (11:42:18)
- Rótulo de dado: Número da venda (Venda #10493)
- Rótulo de dado: Consumidor ('Consumidor não identificado' ou nome • CPF, ex.: Mariana Oliveira • 123.456.789-00; João Carlos de Lima • 987.654.321-00)
- Rótulo de dado: Caixa (Caixa 01 / 02 / 03)
- Rótulo de dado: Operador (Vinícius, Igor, Lando)
- Rótulo de dado: Forma de pagamento (Pix, Cartão de crédito, Dinheiro)
- Rótulo de dado: Valor (R$ 189,90; R$ 458,00; R$ 79,90; R$ 116,90; R$ 249,80)
- Indicador da barra superior: Status da SEFAZ (SEFAZ CE online)
- Indicador da barra superior: CSC (CSC configurado)
- Indicador da barra superior: Série em uso (Série 1)

**Botões e ações observados**
- Ativar contingência (botão secundário branco, ícone de wi-fi riscado)
- Abrir PDV (botão primário laranja, ícone de monitor/caixa)
- Filtros (botão com ícone de ajustes/sliders, abre filtros avançados)
- Abas de status clicáveis: Todas / Autorizadas / Offline / Com erro / Canceladas
- Link no número da NFC-e (texto azul, ex.: 000.001.492) para abrir o detalhe
- Ação na linha: Visualizar (ícone de olho) – presente em todas as linhas
- Ação na linha: Imprimir DANFE NFC-e/cupom (ícone de impressora) – em autorizadas e cancelada
- Ação na linha: Baixar XML/arquivo fiscal (ícone de arquivo com seta para baixo) – apenas em autorizadas
- Ação na linha: Editar/corrigir (ícone de lápis) – apenas na rejeitada
- Ação na linha: Retransmitir/enviar à SEFAZ (ícone de avião de papel) – apenas na rejeitada
- Paginação (texto 'Página 1 de 38', sem botões de anterior/próxima visíveis)
- Avatar 'HB' (menu do usuário)

**Abas / etapas**
- Todas (ativa, pílula azul-escura)
- Autorizadas
- Offline
- Com erro
- Canceladas

**Colunas de tabelas**
- Documentos NFC-e: NFC-e (número em link azul + série abaixo, ex.: 000.001.492 / Série 1)
- Documentos NFC-e: Data / hora (23/09/2026 / 11:42:18)
- Documentos NFC-e: Venda / consumidor (Venda #10493 / Consumidor não identificado; ou nome • CPF)
- Documentos NFC-e: Caixa / operador (Caixa 01 / Vinícius)
- Documentos NFC-e: Pagamento (Pix / Cartão de crédito / Dinheiro)
- Documentos NFC-e: Valor (R$ 189,90)
- Documentos NFC-e: Status (selo)
- Documentos NFC-e: Ações (botões de ícone)

**Filtros**
- Busca textual por número, venda, cliente, chave (texto cortado)
- Status (select 'Todos os status')
- Caixa (select 'Todos os caixas')
- Data (09/23/2026)
- Botão Filtros (filtros avançados)
- Abas de status: Todas / Autorizadas / Offline / Com erro / Canceladas

**Indicadores / cartões / gráficos**
- Autorizadas hoje (184, valor em verde; legenda 'R$ 28.460 em vendas')
- Pendentes de transmissão (0, valor em âmbar; legenda 'Nenhuma NFC-e offline')
- Rejeitadas (2, valor em vermelho; legenda 'Precisam de correção')
- Canceladas hoje (3, valor em preto; legenda 'R$ 486,70 cancelados')
- Rodapé da tabela: 'Exibindo 5 de 189 documentos de hoje'
- Rodapé da tabela: 'Página 1 de 38'
- Linhas de exemplo: 000.001.492 Venda #10493 Caixa 01/Vinícius Pix R$ 189,90 Autorizada; 000.001.491 Venda #10492 Mariana Oliveira Caixa 02/Igor Cartão de crédito R$ 458,00 Autorizada; 000.001.490 Venda #10491 Caixa 01/Vinícius Dinheiro R$ 79,90 Rejeitada 391; 000.001.489 Venda #10490 João Carlos de Lima Caixa 03/Lando Pix R$ 116,90 Cancelada; 000.001.488 Venda #10489 Caixa 02/Igor Dinheiro R$ 249,80 Autorizada

**Estados e selos**
- Autorizada (selo verde-claro com ícone de check em círculo)
- Rejeitada 391 (selo vermelho-claro com ícone de triângulo de alerta e código de rejeição)
- Cancelada (selo rosa/vermelho-claro, sem ícone)
- Barra superior: '● SEFAZ CE online' (ponto verde)
- Barra superior: 'CSC configurado'
- Barra superior: 'Série 1'
- Implícitos pelas abas/KPIs: Offline (contingência / pendente de transmissão) e Com erro

**Itens de menu**
- Sem menu lateral; cabeçalho próprio 'Intercert ERP – NFC-e do PDV' com logo 'I'

**Regras e políticas ilustradas (exemplos)**
- Cada NFC-e fica vinculada a uma venda (NFC-e 000.001.492 ↔ Venda #10493), a um caixa e a um operador; numeração da venda e da NFC-e avança em paralelo (1:1)
- Numeração sequencial única na Série 1 compartilhada entre Caixa 01, 02 e 03 (000.001.488 a 000.001.492 alternando caixas)
- As ações mudam conforme o status: autorizada = visualizar, imprimir, baixar XML; rejeitada = visualizar, corrigir, retransmitir; cancelada = visualizar, imprimir
- Rejeições exibem o código de retorno da SEFAZ no selo (Rejeitada 391)
- Consumidor é opcional: 'Consumidor não identificado' ou nome + CPF
- Contingência offline é ativada manualmente pelo botão 'Ativar contingência'; documentos offline aparecem em 'Pendentes de transmissão' e na aba Offline
- Total do dia = autorizadas + pendentes + rejeitadas + canceladas (184 + 0 + 2 + 3 = 189)
- Paginação de 5 documentos por página (189 → 38 páginas)
- A barra superior mostra disponibilidade da SEFAZ da UF (CE), CSC configurado e série em uso — pré-requisitos para emitir NFC-e
- Cores de KPI por severidade: verde (autorizadas), âmbar (pendentes), vermelho (rejeitadas), neutro (canceladas)
- Listagem padrão filtrada pelo dia corrente ('documentos de hoje'), ordenada da mais recente para a mais antiga

**Inconsistências do protótipo**
- Filtro de data em formato americano (09/23/2026) enquanto a tabela usa 23/09/2026
- Layout diferente do restante do ERP: logo 'I' + 'Intercert ERP', sem menu lateral, em vez do logotipo INTERCERT com sidebar das Telas 35 e 36
- KPI 'R$ 28.460 em vendas' sem centavos; demais valores com centavos
- Linha cancelada não oferece baixar XML, embora o XML da nota e do evento de cancelamento continue necessário
- Placeholder da busca cortado ('…chave ou')
- Nomenclatura diferente entre KPIs e abas: 'Pendentes de transmissão' × aba 'Offline'; 'Rejeitadas' × aba 'Com erro'
- KPI 'Rejeitadas' não diz 'hoje' como 'Autorizadas hoje' e 'Canceladas hoje' (escopo ambíguo)
- Filtro select 'Todos os status' duplica as abas de status
- Selo 'Cancelada' sem ícone, enquanto 'Autorizada' e 'Rejeitada' têm ícone
- Ritmo incoerente: 189 documentos no dia até 11:42, mas as 5 NFC-e consecutivas (488–492) levaram 37 minutos (11:05–11:42) somando todos os caixas
- Divergência com a Tela 35: 189 NFC-e e R$ 28 mil em um único dia (23/09) contra 1.147 NFC-e e R$ 142.943,70 no mês de setembro inteiro
- Numeração 000.001.492 baixa para o histórico do gráfico da Tela 35 (centenas de NFC-e por mês desde abril)
- Possível incoerência: se o código 391 corresponder à rejeição por ausência de dados de cartão, não combina com a venda paga em Dinheiro
- Operadores Vinícius, Igor e Lando não constam da lista de usuários da Tela 36 (o único perfil Caixa é Lucas Pereira)

### Tela 33 — Detalhes de uma NFC-e (p. 45)

_Visão complementar: Tela 33: Detalhes de uma NFC-e (painel lateral/modal); a visão principal está na página 44_

Grupo: Fiscal

**Objetivo:** Mostrar o documento vinculado à venda, ao operador e à forma de pagamento. Impressão, envio e cancelamento dependem da situação real e da autorização do usuário.

**Principais ações (comentário)**
- O que este detalhe mostra: o documento continua vinculado à venda, ao operador e à forma de pagamento.
- Ligação com a tela: complementa a Tela 33 'Gestão de NFC-e do PDV'; visão principal na página 44.

**Ponto de atenção**
- Comentário: impressão, envio e cancelamento dependem da situação real do documento e da autorização do usuário.

**Regiões da tela**
- Painel/drawer com título 'NFC-e 000.001.492' e subtítulo 'Série 1 • Venda #10493 • 23/09/2026 às 11:42'
- Botão fechar (X)
- Faixa de alerta verde de autorização com ícone de escudo
- Grade 2×3 de cartões informativos
- Seção 'Chave de acesso' com a chave em caixa
- Seção 'Pagamento' com linha de transação e valor
- Grade 2×2 de botões de ação

**Campos observados**
- Número da NFC-e (cabeçalho) (000.001.492)
- Série (1)
- Venda vinculada (#10493)
- Data/hora de emissão (23/09/2026 às 11:42)
- Situação/retorno SEFAZ (Documento autorizado pela SEFAZ)
- Protocolo (135260184992804)
- Tipo de autorização (Autorização normal)
- Consumidor (Não identificado)
- Operador (Vinícius • Caixa 01)
- Produtos (3 itens • 4 unidades)
- Valor total (R$ 189,90)
- Tributos estimados (R$ 45,81)
- Forma de pagamento (Pix)
- Chave de acesso (44 dígitos agrupados de 4 em 4) (2326 0912 8453 3000 0142 6500 1000 0014 9213 5260 1849)
- Pagamento: meio + identificador da transação (Pix • Transação E9040088820260923)
- Pagamento: valor (R$ 189,90)

**Botões e ações observados**
- Fechar (X)
- Imprimir DANFE (ícone de impressora)
- Baixar XML (ícone de arquivo com download)
- Enviar por e-mail (ícone de envelope)
- Cancelar NFC-e (vermelho, ícone de proibido)

**Indicadores / cartões / gráficos**
- Cartão Consumidor (Não identificado)
- Cartão Operador (Vinícius • Caixa 01)
- Cartão Produtos (3 itens • 4 unidades)
- Cartão Valor total (R$ 189,90)
- Cartão Tributos estimados (R$ 45,81)
- Cartão Forma de pagamento (Pix)

**Estados e selos**
- Faixa verde 'Documento autorizado pela SEFAZ' com escudo/check, protocolo e 'Autorização normal'

**Regras e políticas ilustradas (exemplos)**
- A chave de acesso tem 44 dígitos na estrutura oficial: cUF 23 (CE) + AAMM 2609 + CNPJ 12845330000142 + modelo 65 + série 001 + número 000001492 + tpEmis 1 (normal) + código numérico 35260184 + DV 9; ela bate com o CNPJ da Tela 34 e com o número da NFC-e
- Tipo de emissão 1 = 'Autorização normal' (o contrário seria contingência)
- Os tributos estimados aparecem por documento (Lei da Transparência) (R$ 45,81 sobre R$ 189,90 ≈ 24%)
- O pagamento guarda o meio e o identificador da transação (end-to-end do Pix)
- O cancelamento é uma ação sensível (botão em vermelho) que exige permissão (ver Tela 36: 'Cancelar documento fiscal')

**Inconsistências do protótipo**
- O protocolo 135260184992804 começa com '135', o que no padrão do protocolo SEFAZ indicaria UF 35 (SP), e não 23 (CE)
- O identificador da transação Pix (E9040088820260923) é mais curto que um end-to-end ID real, de 32 caracteres
- O botão se chama 'Imprimir DANFE', mas o documento auxiliar da NFC-e é o DANFE NFC-e/cupom; a nomenclatura é genérica

### Tela 34 — Configurações fiscais (p. 46)

Grupo: Fiscal

**Objetivo:** Reunir os parâmetros necessários para habilitar a operação fiscal da empresa e da filial, incluindo certificado, ambiente e documentos eletrônicos.

**Principais ações (comentário)**
- Conferir identificação e parâmetros fiscais.
- Administrar certificado e ambiente de emissão.
- Revisar configurações de documentos e regras.

**Ponto de atenção**
- Separar homologação de produção e restringir o acesso a dados sensíveis. Os parâmetros devem ser versionados e revisados antes de qualquer emissão real.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, breadcrumb 'Administração / Configurações fiscais', seletor de filial 'Loja Centro ▾' e avatar 'HM'
- Menu lateral escuro com seção 'PRINCIPAL'
- Cabeçalho da página com título 'Configurações fiscais', subtítulo 'Parâmetros de emissão e tributação da empresa.' e botões Descartar / Salvar alterações
- Linha com 4 cartões de status
- Submenu vertical à esquerda com as seções de configuração
- Cartão 'Identificação fiscal' com formulário em grade de 3 colunas e selo 'Cadastro validado'
- Cartão 'Ambiente e validação' com 3 chaves (toggles) e selo 'Produção'

**Campos observados**
- CNPJ (input) (12.845.330/0001-4…, cortado)
- Inscrição estadual (input) (06.492.815-7)
- Inscrição municipal (input) (1538472)
- Regime tributário (select) (Simples Nacional)
- CRT (select) (1 — Simples Nacional)
- CNAE principal (input) (4713-0/02 — Lojas…)
- UF de emissão (select) (CE — Ceará)
- Código do município (input) (2307304 — Juazeiro do Norte)
- Indicador de presença padrão (select) (1 — Operação presencial)
- Ambiente de produção (toggle ligado), ajuda: 'Documentos emitidos possuem validade fiscal.'
- Validar cadastro do destinatário (toggle ligado), ajuda: 'Impede emissão quando houver dados fiscais obrigatórios ausentes.'
- Consultar disponibilidade dos serviços (toggle ligado), ajuda: 'Verifica SEFAZ e prefeitura antes de transmitir.'
- Seletor de filial no cabeçalho (Loja Centro)

**Botões e ações observados**
- Descartar
- Salvar alterações (primário laranja)
- Seletor de filial 'Loja Centro ▾'
- Avatar/menu do usuário (HM)
- Navegação do submenu: Dados fiscais ›
- Navegação do submenu: Certificado digital ›
- Navegação do submenu: NF-e, NFC-e e NFS-e ›
- Navegação do submenu: Tributação padrão ›
- Navegação do submenu: Contingência ›
- Toggles de ambiente e validação (liga/desliga)

**Abas / etapas**
- Dados fiscais (ativa)
- Certificado digital
- NF-e, NFC-e e NFS-e
- Tributação padrão
- Contingência

**Filtros**
- Seletor de filial no cabeçalho (Loja Centro)

**Indicadores / cartões / gráficos**
- Ambiente de emissão (● Produção)
- Certificado digital (A1 válido; 'Expira em 18/08/2027')
- Documentos ativos (3 de 3; 'NF-e, NFC-e e NFS-e')
- Última verificação (Hoje, 10:42; 'Todos os serviços operacionais')

**Estados e selos**
- Cadastro validado (selo verde no cartão Identificação fiscal)
- Produção (selo azul no cartão Ambiente e validação)
- ● Produção (ponto verde no KPI)
- A1 válido (verde)
- Toggles ligados (verde)

**Itens de menu**
- Visão geral
- Vendas
- Estoque
- Financeiro
- Configurações (ativo)

**Regras e políticas ilustradas (exemplos)**
- A configuração é por empresa/filial (seletor de filial no cabeçalho)
- CRT 1 corresponde ao regime Simples Nacional
- O certificado digital é do tipo A1 e tem data de expiração monitorada (18/08/2027)
- Três documentos eletrônicos podem ser habilitados: NF-e, NFC-e e NFS-e (3 de 3 ativos)
- Com 'Validar cadastro do destinatário' ligado, a emissão é bloqueada quando faltam dados fiscais obrigatórios
- Com 'Consultar disponibilidade dos serviços' ligado, a SEFAZ e a prefeitura são consultadas antes da transmissão
- O código do município segue o IBGE (2307304 = Juazeiro do Norte/CE)
- Há um indicador de presença padrão para as operações (1 — Operação presencial)
- A última verificação de serviços fica registrada com horário

**Inconsistências do protótipo**
- O menu lateral desta tela não tem o item 'Fiscal', que aparece nas Telas 35, 36 e 37; os ícones do menu também seguem outro estilo
- O avatar do usuário é 'HM' aqui (e na Tela 35), mas 'HB' nas Telas 33, 36 e 37
- O breadcrumb diz 'Administração / Configurações fiscais', mas o item ativo do menu é 'Configurações'
- Vários valores estão cortados nos inputs/selects (CNPJ, Regime tributário, CRT, CNAE, Código do município, Indicador de presença)
- O CNAE principal 4713-0/02 é de varejo (lojas), enquanto a Tela 32 emite NFS-e de licenciamento/implantação de ERP
- Ambiente de produção é um toggle simples na mesma tela, o que vai contra o ponto de atenção de separar homologação e produção com acesso restrito

### Tela 35 — Relatórios fiscais (parte 1 de 2) (p. 47)

Grupo: Fiscal

**Objetivo:** Consolida informações sobre documentos e valores fiscais para conferência, acompanhamento e preparação das informações destinadas à contabilidade.

**Principais ações (comentário)**
- Selecionar período e consultar emissões.
- Comparar os resumos por documento.
- Acessar relatórios e acompanhar pendências.

**Ponto de atenção**
- Cada relatório deve explicitar quais documentos e estados entram nos totais. Prazos e obrigações ilustrados não substituem a configuração fiscal validada da empresa.

**Regiões da tela**
- Cabeçalho superior branco: logotipo INTERCERT ('INTER' laranja, 'CERT' azul), breadcrumb 'Fiscal / Relatórios e obrigações', seletor de filial 'Loja Centro ▾' e avatar 'HM'
- Menu lateral azul-marinho escuro com seção 'PRINCIPAL' e item Fiscal ativo (destaque azul)
- Cabeçalho da página: título 'Relatórios fiscais e obrigações', subtítulo 'Acompanhe documentos, impostos e entregas fiscais da empresa.' e botões Agendar relatório / Exportar à direita
- Painel de filtros em cartão com 3 selects rotulados e botão Aplicar filtros
- Linha com 4 cartões de KPI, cada um com ícone azul no canto superior direito
- Topo de dois painéis inferiores cortados (Emissões por período e Obrigações e prazos, continuam na página 48)

**Campos observados**
- Período (select) (Setembro de 2026)
- Empresa / filial (select) (Loja Centro)
- Documento (select) (Todos os documentos)
- Seletor de filial no cabeçalho (Loja Centro ▾)
- Rótulo de dado: Faturamento fiscal (R$ 284.760,40)
- Rótulo de dado: Documentos emitidos (1.482)
- Rótulo de dado: Tributos estimados (R$ 28.193,20)
- Rótulo de dado: Pendências fiscais (7)

**Botões e ações observados**
- Agendar relatório (botão secundário, ícone de calendário com +)
- Exportar (botão primário laranja, ícone de download)
- Aplicar filtros (botão secundário, ícone de funil)
- Seletor de filial 'Loja Centro ▾' no cabeçalho
- Avatar do usuário 'HM'
- Itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações)

**Filtros**
- Período (Setembro de 2026)
- Empresa / filial (Loja Centro)
- Documento (Todos os documentos)
- Botão Aplicar filtros (aplicação explícita, não automática)
- Seletor global de filial no cabeçalho (Loja Centro)

**Indicadores / cartões / gráficos**
- Faturamento fiscal (R$ 284.760,40; '↑ 8,4% sobre agosto' em verde), ícone de cifrão em círculo
- Documentos emitidos (1.482; '1.461 autorizados' em verde), ícone de documentos/cópia
- Tributos estimados (R$ 28.193,20; '9,90% do faturamento'), ícone de calculadora
- Pendências fiscais (7; '5 rejeições · 2 cancelamentos'), ícone de triângulo de alerta

**Estados e selos**
- Variação positiva '↑ 8,4% sobre agosto' (texto verde)
- '1.461 autorizados' (texto verde)
- Item de menu Fiscal ativo (fundo azul)

**Itens de menu**
- PRINCIPAL
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal (ativo)
- Configurações

**Regras e políticas ilustradas (exemplos)**
- Tributos estimados como percentual do faturamento (28.193,20 / 284.760,40 = 9,90%), compatível com empresa do Simples Nacional (ver PGDAS-D/DEFIS na parte 2)
- Faturamento fiscal comparado com o mês anterior (↑ 8,4% sobre agosto)
- Pendências fiscais = rejeições + cancelamentos (5 + 2 = 7)
- Faturamento fiscal = soma dos valores por documento da parte 2 (124.580,20 + 142.943,70 + 17.236,50 = 284.760,40)
- Documentos emitidos = soma por documento da parte 2 (219 + 1.147 + 116 = 1.482) = barra de setembro do gráfico
- Filtros por período mensal, filial e tipo de documento, aplicados por botão
- Relatórios podem ser agendados e exportados

**Inconsistências do protótipo**
- KPI 'Pendências fiscais' informa '2 cancelamentos', mas a tabela 'Resumo por documento' (página 48) soma 7 cancelados (2 + 4 + 1)
- Documentos emitidos 1.482 × 1.461 autorizados: diferença de 21 não fecha com 5 rejeições + 7 cancelados (12) nem com 5 + 2 (7)
- O '↑ 8,4% sobre agosto' do faturamento coincide exatamente com o crescimento da quantidade de documentos no gráfico (1.482 / 1.367 = +8,4%), sugerindo métrica trocada
- Avatar 'HM' difere do 'HB' das Telas 33 e 36 e não corresponde a nenhum usuário listado na Tela 36
- Seletor de filial do cabeçalho ('Loja Centro ▾') duplica o filtro 'Empresa / filial'
- Título da página do guia ('Relatórios fiscais') difere do título da tela ('Relatórios fiscais e obrigações') e do breadcrumb ('Relatórios e obrigações')
- Valor do Faturamento fiscal quebra em duas linhas no cartão ('R$' / '284.760,40')
- Menu Fiscal não mostra subitens, enquanto a Tela 36 mostra submenu sob Configurações
- Cabeçalho difere da Tela 36 (aqui sem selo 'PRÉVIA DO ERP' e com seletor de filial; lá o contrário)
- 'Pendências fiscais' inclui cancelamentos, que normalmente são eventos concluídos e não pendências (critério não explicado)

### Tela 35 — Relatórios fiscais (parte 2 de 2) (p. 48)

Grupo: Fiscal

**Objetivo:** Continuação da mesma visão: consolida informações sobre documentos e valores fiscais para conferência, acompanhamento e preparação das informações destinadas à contabilidade.

**Principais ações (comentário)**
- Continuação: Parte 2 de 2 da mesma visão. A divisão mantém os campos e valores legíveis, sem criar uma nova tela no escopo.
- Contexto: Consolida informações sobre documentos e valores fiscais para conferência, acompanhamento e preparação das informações destinadas à contabilidade.
- Consulta: Tela 35 - Relatórios fiscais. Visão principal e comentários na página 47.

**Ponto de atenção**
- (Herdado da parte 1) Cada relatório deve explicitar quais documentos e estados entram nos totais. Prazos e obrigações ilustrados não substituem a configuração fiscal validada da empresa.

**Regiões da tela**
- Menu lateral escuro recortado (sem itens visíveis)
- Borda inferior dos 4 cartões de KPI da parte 1 no topo (cortada)
- Painel 'Emissões por período' (esquerda, superior) com gráfico de barras empilhadas e legenda
- Painel 'Obrigações e prazos' (direita, superior) com selo de período e 4 obrigações com barra de progresso
- Painel 'Resumo por documento' (esquerda, inferior) com botão e tabela
- Painel 'Relatórios rápidos' (direita, inferior) com grade 2×3 de atalhos com ícones

**Campos observados**
- Rótulo de dado: Quantidade de documentos (eixo/legenda do gráfico)
- Rótulo de dado: Obrigação (PGDAS-D, DEFIS, Livro fiscal, XML para contabilidade)
- Rótulo de dado: Descrição da obrigação ('Apuração mensal do Simples Nacional'; 'Declaração anual entregue em 28/03/2026'; 'Conferência de entradas e saídas do período'; 'Pacote de documentos fiscais de setembro')
- Rótulo de dado: Prazo/estado da obrigação (Vence em 27 dias; Em dia; Revisar; Até 05/10)
- Rótulo de dado: Progresso da obrigação (barra)
- Rótulos da tabela: Documento, Emitidos, Valor total, Cancelados, Situação

**Botões e ações observados**
- Ver detalhamento (botão secundário no painel Resumo por documento)
- Atalho Relatórios rápidos: Livro de saídas (ícone de documento)
- Atalho Relatórios rápidos: Tributos por NCM (ícone de recibo)
- Atalho Relatórios rápidos: Cancelamentos (ícone de círculo proibido)
- Atalho Relatórios rápidos: Rejeições (ícone de exclamação em círculo)
- Atalho Relatórios rápidos: XML do período (ícone de arquivo compactado)
- Atalho Relatórios rápidos: Resumo contábil (ícone de balança)

**Colunas de tabelas**
- Resumo por documento: Documento (nome em negrito + modelo: NF-e / Modelo 55; NFC-e / Modelo 65; NFS-e / Serviços)
- Resumo por documento: Emitidos (219 / 1.147 / 116)
- Resumo por documento: Valor total (R$ 124.580,20 / R$ 142.943,70 / R$ 17.236,50)
- Resumo por documento: Cancelados (2 / 4 / 1)
- Resumo por documento: Situação (selo: Regular / 5 rejeições / Regular)

**Filtros**
- Selo de período 'Setembro' no painel Obrigações e prazos (reflete o filtro Período da parte 1)
- Legenda do gráfico por tipo: NF-e / NFC-e / NFS-e

**Indicadores / cartões / gráficos**
- Gráfico 'Emissões por período' (barras empilhadas mensais, rótulo 'Quantidade de documentos'): Abr 1.052; Mai 1.164; Jun 1.230; Jul 1.311; Ago 1.367; Set 1.482; legenda NF-e (azul), NFC-e (laranja), NFS-e (verde)
- Obrigação PGDAS-D: 'Apuração mensal do Simples Nacional', 'Vence em 27 dias' (âmbar), barra azul (~72%)
- Obrigação DEFIS: 'Declaração anual entregue em 28/03/2026', selo 'Em dia', barra verde completa (100%)
- Obrigação Livro fiscal: 'Conferência de entradas e saídas do período', 'Revisar' (âmbar), barra laranja (~46%)
- Obrigação XML para contabilidade: 'Pacote de documentos fiscais de setembro', 'Até 05/10' (âmbar), barra azul (~84%)
- Painel Relatórios rápidos com 6 atalhos

**Estados e selos**
- Regular (selo verde-claro) – NF-e e NFS-e
- 5 rejeições (selo âmbar/laranja-claro) – NFC-e
- Em dia (selo verde-claro) – DEFIS
- Vence em 27 dias (texto âmbar) – PGDAS-D
- Revisar (texto âmbar) – Livro fiscal
- Até 05/10 (texto âmbar) – XML para contabilidade
- Setembro (selo azul-claro do período)

**Regras e políticas ilustradas (exemplos)**
- NF-e = Modelo 55; NFC-e = Modelo 65; NFS-e = Serviços (sem modelo numérico)
- Situação do documento é 'Regular' quando não há rejeições; com rejeições mostra a contagem (5 rejeições na NFC-e); cancelados não alteram a situação
- Cada obrigação acessória tem prazo/estado e barra de progresso de preparação (PGDAS-D mensal do Simples Nacional; DEFIS anual; Livro fiscal; pacote XML para a contabilidade)
- Com data de referência 23/09/2026 (Tela 33), 'Vence em 27 dias' = 20/10, dia de vencimento do PGDAS-D
- Pacote XML do mês entregue à contabilidade até o dia 05 do mês seguinte (Até 05/10)
- Total de setembro no gráfico (1.482) = Documentos emitidos da parte 1 = soma da tabela (219 + 1.147 + 116)
- Série histórica de 6 meses (Abr–Set) com crescimento contínuo
- Relatórios rápidos: Livro de saídas, Tributos por NCM, Cancelamentos, Rejeições, XML do período, Resumo contábil
- Cores por tipo de documento: NF-e azul, NFC-e laranja, NFS-e verde

**Inconsistências do protótipo**
- Cancelados da tabela somam 7, mas o KPI da parte 1 informa '2 cancelamentos' em Pendências fiscais
- Barras de Ago (1.367) e Set (1.482) têm altura e segmentos idênticos (medido em pixels)
- Barras não proporcionais aos totais: Abr (1.052) tem ~83% da altura de Set, mas deveria ter ~71%; eixo sem escala nem origem visível
- Proporções da barra de setembro não batem com a tabela: NFC-e ~64% da barra × 77% (1.147/1.482); NF-e ~22% × 15%; NFS-e ~11% × 8%
- Atalhos da coluna direita de Relatórios rápidos (Tributos por NCM, Rejeições, Resumo contábil) ultrapassam a borda do cartão
- Ícones da coluna direita dos atalhos são menores e de estilo diferente dos da coluna esquerda
- Em Obrigações, apenas 'Em dia' é selo; 'Vence em 27 dias', 'Revisar' e 'Até 05/10' são texto solto
- DEFIS (anual, entregue em 28/03/2026) aparece sob o selo de período 'Setembro'
- Barras de progresso sem valor numérico nem critério explicado
- Sidebar da continuação aparece em escala diferente da parte 1

### Tela 36 — Usuários e permissões (p. 49)

Grupo: Administração e suporte

**Objetivo:** Controla quem utiliza o ERP e quais operações cada perfil pode realizar, conectando acesso aos módulos, unidades, limites e requisitos de segurança.

**Principais ações (comentário)**
- Consultar e manter usuários.
- Editar perfis, permissões e limites.
- Definir acesso a unidades e requisitos de segurança.

**Ponto de atenção**
- Aplicar as restrições também nas operações do sistema, além da interface. Mudanças de acesso e limites devem ser registradas para auditoria.

**Regiões da tela**
- Cabeçalho superior branco: logotipo INTERCERT em negrito ('INTER' laranja, 'CERT' azul), breadcrumb 'Administração / Usuários e permissões', selo 'PRÉVIA DO ERP' e avatar 'HB'
- Menu lateral azul-marinho escuro 'PRINCIPAL' com Configurações ativo e subitem 'Usuários e permissões' destacado com barra laranja
- Cabeçalho da página: título 'Usuários e permissões', subtítulo 'Defina quem acessa o ERP e o que cada pessoa pode fazer.' e botão 'Novo usuário' à direita
- Abas com ícones e sublinhado laranja na ativa
- Cartão de listagem: linha de busca + select Situação; tabela de usuários; rodapé com contagem e resumo por situação
- Aviso no rodapé da página com ícone de frasco: 'Dados demonstrativos. Alterações apenas nesta prévia; nenhum acesso real é criado.'

**Campos observados**
- Buscar usuário (texto; placeholder 'Nome ou e-mail')
- Situação (select) (Todas)
- Rótulo de dado: Avatar com iniciais (HB, MC, LP, AR, CS, RL)
- Rótulo de dado: Nome do usuário (Hércules Benevides, Marina Costa, Lucas Pereira, Ana Ribeiro, Camila Santos, Rafael Lima)
- Rótulo de dado: E-mail (hercules@varejo.example, marina@varejo.example, lucas@varejo.example, ana@varejo.example, camila@varejo.example, rafael@varejo.example)
- Rótulo de dado: Perfil (Administrador, Gerente, Caixa, Estoquista, Financeiro, Fiscal)
- Rótulo de dado: Filiais (Centro + Crato / Centro)
- Rótulo de dado: Situação do acesso (Ativo / Convite pendente / Suspenso)
- Rótulo de dado: Último acesso ou detalhe (Hoje, 09:12; Hoje, 08:46; Hoje, 08:02; Hoje, 07:58; Sem primeiro acesso; Acesso bloqueado)

**Botões e ações observados**
- Novo usuário (botão primário laranja, ícone de pessoa com +)
- Aba Usuários (ícone de pessoas, contador 6)
- Aba Perfis e permissões (ícone de escudo com check)
- Editar (link azul em cada uma das 6 linhas)
- Item de menu Configurações e subitem 'Usuários e permissões'
- Demais itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal)
- Avatar do usuário 'HB'

**Abas / etapas**
- Usuários 6 (ativa, sublinhado laranja)
- Perfis e permissões

**Colunas de tabelas**
- Usuários: USUÁRIO (avatar com iniciais + nome em negrito + marcador '(você)' + e-mail)
- Usuários: PERFIL (selo azul-claro)
- Usuários: FILIAIS (Centro + Crato / Centro)
- Usuários: ACESSO (situação com ponto colorido + último acesso/detalhe)
- Usuários: Ações (link Editar)

**Filtros**
- Buscar usuário por nome ou e-mail
- Situação (select 'Todas'; opções implícitas: Ativo, Convite pendente, Suspenso)

**Indicadores / cartões / gráficos**
- Contador da aba Usuários (6)
- Rodapé da tabela: '6 de 6 usuários'
- Rodapé da tabela: '4 ativos · 1 pendentes · 1 suspensos'
- Aviso: 'Dados demonstrativos. Alterações apenas nesta prévia; nenhum acesso real é criado.'
- Linhas: Hércules Benevides (você) Administrador Centro + Crato Ativo Hoje 09:12; Marina Costa Gerente Centro + Crato Ativo Hoje 08:46; Lucas Pereira Caixa Centro Ativo Hoje 08:02; Ana Ribeiro Estoquista Centro Ativo Hoje 07:58; Camila Santos Financeiro Centro + Crato Convite pendente Sem primeiro acesso; Rafael Lima Fiscal Centro Suspenso Acesso bloqueado

**Estados e selos**
- Ativo (ponto e texto verdes)
- Convite pendente (ponto e texto âmbar/marrom)
- Suspenso (ponto e texto cinza)
- Selos de perfil (azul-claro): Administrador, Gerente, Caixa, Estoquista, Financeiro, Fiscal
- Marcador '(você)' ao lado do usuário logado
- Selo 'PRÉVIA DO ERP' no cabeçalho
- Subitem de menu ativo 'Usuários e permissões' (barra laranja)

**Itens de menu**
- PRINCIPAL
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Configurações (ativo)
- Configurações > Usuários e permissões (subitem ativo)

**Regras e políticas ilustradas (exemplos)**
- Cada usuário tem um único perfil (Administrador, Gerente, Caixa, Estoquista, Financeiro, Fiscal)
- O acesso é por filial: um usuário pode ter uma ou várias filiais (Centro; Centro + Crato)
- Perfis de gestão (Administrador, Gerente, Financeiro) acessam Centro + Crato; perfis operacionais (Caixa, Estoquista, Fiscal) apenas Centro
- Identificação e login por e-mail
- Novos usuários entram por convite: ficam 'Convite pendente / Sem primeiro acesso' até o primeiro login
- Situação do acesso: Ativo (mostra último acesso), Convite pendente, Suspenso (acesso bloqueado)
- Usuário logado marcado com '(você)'
- Totais do rodapé = soma por situação (4 ativos + 1 pendente + 1 suspenso = 6)
- Perfis e permissões são mantidos em aba própria, separada dos usuários
- Ambiente de prévia: alterações não criam acessos reais
- Mudanças de acesso e limites devem gerar registro de auditoria (comentário)

**Inconsistências do protótipo**
- Concordância no rodapé: '1 pendentes · 1 suspensos' (plural para quantidade 1)
- Cabeçalhos da tabela em maiúsculas (USUÁRIO, PERFIL, FILIAIS, ACESSO) exceto 'Ações'
- Breadcrumb 'Administração / Usuários e permissões', mas no menu a tela fica em 'Configurações'; não há item 'Administração'
- Cabeçalho diferente da Tela 35: aqui selo 'PRÉVIA DO ERP' e sem seletor de filial; lá 'Loja Centro ▾' e avatar 'HM' (nenhum usuário listado tem iniciais HM)
- Operadores da Tela 33 (Vinícius, Igor, Lando) não aparecem na lista; só há um usuário com perfil Caixa (Lucas Pereira, somente Centro)
- Filiais chamadas 'Centro' e 'Crato', enquanto a Tela 35 usa 'Loja Centro'
- Último acesso em formato relativo ('Hoje, 09:12'), sem data, diferente do dd/mm/aaaa usado nas outras telas
- Lacuna: só existe a ação 'Editar'; não aparecem ações para reenviar convite, suspender/reativar ou redefinir acesso, previstas pelas situações exibidas
- Lacuna: o comentário cita limites e requisitos de segurança, mas a aba Usuários não mostra nenhum deles (devem ficar na aba 'Perfis e permissões', não ilustrada)
- Não há filtro por perfil nem por filial, apenas Situação
- Domínio de e-mail genérico 'varejo.example' (placeholder)

### Tela 36 — Perfis e permissões de acesso (parte 1 de 2) (p. 50)

_Visão complementar: Tela 36: Perfis e permissões de acesso (aba 'Perfis e permissões'); a visão principal está na página 49_

Grupo: Administração e suporte

**Objetivo:** Permitir que a administração de perfis revise o alcance das ações de cada grupo de usuários. As restrições precisam valer nas operações do sistema e ser auditáveis.

**Principais ações (comentário)**
- O que este detalhe mostra: a administração de perfis permite revisar o alcance das ações de cada grupo de usuários.
- Ligação com a tela: complementa a Tela 36 'Usuários e permissões'; visão principal na página 49.

**Ponto de atenção**
- Comentário: as restrições precisam valer nas operações do sistema e ser auditáveis.

**Regiões da tela**
- Cabeçalho superior: INTERCERT, breadcrumb 'Administração / Usuários e permissões', selo 'PRÉVIA DO ERP' e avatar HB
- Menu lateral com Configurações > Usuários e permissões ativo
- Título 'Usuários e permissões' com botão Novo usuário
- Abas Usuários (6) e Perfis e permissões (ativa)
- Lista vertical de cartões de perfil à esquerda
- Painel do perfil selecionado à direita com matriz de permissões por módulo

**Campos observados**
- Matriz de permissões (checkboxes) por Módulo × Visualizar / Criar / Alterar / Excluir
- PDV e vendas: Visualizar ✔, Criar ✔, Alterar ☐, Excluir — (não se aplica)
- Produtos: Visualizar ✔, Criar ☐, Alterar ☐, Excluir ☐
- Estoque: Visualizar ☐, Criar ☐, Alterar ☐, Excluir —
- Financeiro: Visualizar ☐, Criar ☐, Alterar ☐, Excluir —
- Fiscal: Visualizar ✔, Criar ✔, Alterar ☐, Excluir —

**Botões e ações observados**
- Novo usuário (primário laranja)
- Aba Usuários (6)
- Aba Perfis e permissões
- Selecionar perfil: Administrador (1 usuário)
- Selecionar perfil: Gerente (1 usuário)
- Selecionar perfil: Caixa (1 usuário, selecionado)
- Selecionar perfil: Estoquista (1 usuário)
- Selecionar perfil: Financeiro (1 usuário)
- Marcar/desmarcar checkboxes de permissão

**Abas / etapas**
- Usuários (contador 6)
- Perfis e permissões (ativa)

**Colunas de tabelas**
- Matriz de permissões do perfil: Módulo
- Matriz de permissões do perfil: Visualizar
- Matriz de permissões do perfil: Criar
- Matriz de permissões do perfil: Alterar
- Matriz de permissões do perfil: Excluir

**Indicadores / cartões / gráficos**
- Cartões de perfil com contagem de usuários: Administrador (1 usuário), Gerente (1 usuário), Caixa (1 usuário), Estoquista (1 usuário), Financeiro (1 usuário)
- Cabeçalho do painel: 'Perfil: Caixa' – 'Vendas no PDV · permissões compartilhadas pelo perfil'

**Estados e selos**
- Sem alterações (indicador de alterações não salvas no painel do perfil)
- Cartão de perfil selecionado com borda azul (Caixa)
- Traço '—' para permissão não aplicável

**Itens de menu**
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Configurações (ativo)
- Subitem: Usuários e permissões (ativo)

**Regras e políticas ilustradas (exemplos)**
- As permissões são definidas por perfil e compartilhadas por todos os usuários do perfil
- Permissões CRUD por módulo (Visualizar, Criar, Alterar, Excluir)
- Alguns módulos não aceitam exclusão ('—' em PDV e vendas, Estoque, Financeiro e Fiscal)
- Perfil Caixa: vende no PDV (visualizar e criar vendas), consulta produtos e emite documentos fiscais (Fiscal: visualizar e criar)
- Indicador de alterações pendentes no perfil ('Sem alterações')

**Inconsistências do protótipo**
- Na aba Perfis e permissões o botão do cabeçalho continua 'Novo usuário'; não há ação visível para criar perfil ('Novo perfil')
- O breadcrumb diz 'Administração', mas o menu ativo é 'Configurações'

### Tela 36 — Perfis e permissões de acesso (parte 2 de 2) (p. 51)

_Visão complementar: Tela 36: Perfis e permissões de acesso (continuação do painel do perfil Caixa)_

Grupo: Administração e suporte

**Objetivo:** Continuação da mesma visão: revisar o alcance das ações de cada grupo de usuários, incluindo operações sensíveis, limite de desconto e segurança.

**Principais ações (comentário)**
- Continuação: parte 2 de 2 da mesma visão; a divisão só mantém campos e valores legíveis, sem criar nova tela.
- Consulta: Tela 36 'Usuários e permissões'; visão principal e comentários na página 49.

**Ponto de atenção**
- (Herdado) Aplicar as restrições também nas operações do sistema e registrar para auditoria as mudanças de acesso e limites.

**Regiões da tela**
- Menu lateral escuro (recortado)
- Lista de perfis (continuação) com cartão 'Fiscal – 1 usuário'
- Final da matriz de permissões (Relatórios, Configurações)
- Seção 'Operações sensíveis' com checkboxes em 2 colunas e nota explicativa
- Seção de limites e segurança (Desconto máximo e Segurança)
- Rodapé do painel com texto de aplicação e botões Descartar / Salvar perfil na prévia
- Nota de rodapé de dados demonstrativos

**Campos observados**
- Relatórios: Visualizar ☐, Criar —, Alterar —, Excluir —
- Configurações: Visualizar ☐, Criar ☐, Alterar ☐, Excluir ☐
- Operação sensível: Cancelar venda (checkbox) (desmarcado)
- Operação sensível: Reabrir caixa (checkbox) (desmarcado)
- Operação sensível: Cancelar documento fiscal (checkbox) (desmarcado)
- Operação sensível: Ajustar estoque (checkbox) (desmarcado)
- Operação sensível: Exportar dados (checkbox) (desmarcado)
- Operação sensível: Aprovar desconto excedente (checkbox) (desmarcado)
- Desconto máximo (%) (input numérico) (5)
- Segurança: Exigir autenticação em duas etapas (checkbox) (desmarcado)

**Botões e ações observados**
- Selecionar perfil: Fiscal (1 usuário)
- Descartar
- Salvar perfil na prévia (primário laranja)
- Marcar/desmarcar operações sensíveis
- Marcar/desmarcar 'Exigir autenticação em duas etapas'

**Colunas de tabelas**
- Matriz de permissões do perfil (continuação): Módulo / Visualizar / Criar / Alterar / Excluir

**Indicadores / cartões / gráficos**
- Cartão de perfil: Fiscal (1 usuário)

**Estados e selos**
- Traço '—' para permissão não aplicável (Relatórios: Criar/Alterar/Excluir)

**Regras e políticas ilustradas (exemplos)**
- Excluir vale só para cadastros sem movimentação; documentos fiscais nunca são excluídos (texto: 'Excluir: somente cadastros sem movimentação. Documentos fiscais não são excluídos.')
- Desconto máximo por perfil (5%); acima do limite é preciso pedir aprovação de um usuário autorizado ('Acima do limite: solicitar aprovação de um usuário autorizado.')
- Operações sensíveis são permissões separadas do CRUD: cancelar venda, reabrir caixa, cancelar documento fiscal, ajustar estoque, exportar dados e aprovar desconto excedente
- Autenticação em duas etapas pode ser exigida por perfil
- As alterações valem para todos os usuários do perfil ('Aplicação a todos os usuários deste perfil.')
- No ambiente de prévia o salvamento é só demonstrativo ('Salvar perfil na prévia'; 'Dados demonstrativos. Alterações apenas nesta prévia; nenhum acesso real é criado.')
- Relatórios só tem permissão de Visualizar

**Inconsistências do protótipo**
- O botão 'Salvar perfil na prévia' expõe o modo protótipo; o rótulo final provavelmente será 'Salvar perfil'
- O perfil Caixa tem Fiscal: Criar marcado, mas nenhuma operação sensível (nem cancelar venda ou documento fiscal); é coerente, mas deixa o cancelamento da Tela 33 dependente de outro perfil

### Tela 37 — Histórico e auditoria (parte 1 de 2) (p. 52)

Grupo: Administração e suporte

**Objetivo:** Investigar as ações feitas no ERP, identificando responsáveis, momentos e objetos alterados, para apoiar controle e rastreabilidade.

**Principais ações (comentário)**
- Filtrar atividades por contexto.
- Consultar o detalhamento de um evento.
- Relacionar a ação ao usuário e ao registro de origem.

**Ponto de atenção**
- O histórico precisa preservar sua integridade e limitar a exposição de dados sensíveis. A auditoria também deve registrar tentativas e alterações relevantes de permissão.

**Regiões da tela**
- Cabeçalho superior: INTERCERT, breadcrumb 'Administração / Auditoria', select de filiais 'Todas as filiais' e avatar HB
- Menu lateral com Configurações ativo e subitem 'Histórico e auditoria'
- Cabeçalho da página: título 'Histórico de atividades e auditoria', subtítulo 'Acompanhe acessos, alterações e autorizações no ERP.' e selo 'Somente consulta' (cadeado)
- Painel de filtros (busca, período, módulo, responsável), abas de situação, checkbox Ações sensíveis e link Limpar filtros
- Painel 'Atividades' (lista de eventos) à esquerda, com fuso horário e contador
- Painel 'Detalhes do evento' à direita (continua na página 53)

**Campos observados**
- Buscar no histórico (input, placeholder 'Ação, registro ou pessoa')
- Período (select) (23/09/2026)
- Módulo (select) (Todos)
- Responsável (select) (Todos)
- Ações sensíveis (checkbox) (desmarcado)
- Filial (select no cabeçalho) (Todas as filiais)
- Detalhe: identificador e data/hora do evento (AUD-0011 · 23/09/2026 às 10:43:07)
- Detalhe: título do evento (Permissões do perfil alteradas)
- Detalhe: responsável (Hércules Benevides)
- Detalhe: perfil do responsável no momento do evento (Administrador no momento do evento)
- Detalhe: Registro (Perfil Caixa)
- Detalhe: Filial (Loja Centro)
- Item da lista: data/hora (23/09 · 10:48:12)
- Item da lista: módulo · filial (PDV · Centro)
- Item da lista: ação (Desconto excedente autorizado)
- Item da lista: responsável (Marina Costa)
- Item da lista: situação (● Concluído)

**Botões e ações observados**
- Limpar filtros (link)
- Selecionar evento na lista (item destacado em laranja com barra lateral)
- Select 'Todas as filiais' no cabeçalho
- Somente consulta (selo/indicador com cadeado, sem edição)

**Abas / etapas**
- Todos (ativa)
- Concluídos
- Bloqueados

**Colunas de tabelas**
- Lista Atividades (cartões): data · hora
- Lista Atividades: módulo · filial
- Lista Atividades: ação/título do evento
- Lista Atividades: responsável
- Lista Atividades: situação

**Filtros**
- Buscar no histórico (ação, registro ou pessoa)
- Período (23/09/2026)
- Módulo (Todos)
- Responsável (Todos)
- Abas: Todos / Concluídos / Bloqueados
- Checkbox Ações sensíveis
- Filial no cabeçalho (Todas as filiais)
- Limpar filtros

**Indicadores / cartões / gráficos**
- Atividades: contador '9 eventos'
- Atividades: fuso 'Horário de Brasília · UTC−3'
- Evento 1: 23/09 · 10:48:12 – PDV · Centro – Desconto excedente autorizado – Marina Costa – Concluído
- Evento 2 (selecionado): 23/09 · 10:43:07 – Usuários · Centro – Permissões do perfil alteradas
- Cartão Detalhes do evento (AUD-0011)

**Estados e selos**
- ● Concluído (verde)
- Bloqueado (aba; indica tentativas bloqueadas)
- Somente consulta (selo azul com cadeado)
- Evento selecionado destacado (fundo laranja claro + barra lateral laranja)
- Avatar de iniciais HB no detalhe

**Itens de menu**
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Configurações (ativo)
- Subitem: Histórico e auditoria (ativo)

**Regras e políticas ilustradas (exemplos)**
- A auditoria é somente leitura (selo 'Somente consulta'); não permite editar nem excluir eventos
- Os eventos têm identificador sequencial (AUD-0011), data/hora com segundos e fuso explícito (Horário de Brasília · UTC−3)
- Cada evento registra módulo, filial, responsável, registro afetado e situação (Concluído/Bloqueado)
- Grava-se o perfil do responsável no momento do evento ('Administrador no momento do evento'), preservando o histórico mesmo que o perfil mude depois
- Tentativas bloqueadas também são registradas (aba Bloqueados)
- Ações sensíveis podem ser filtradas (ex.: desconto excedente autorizado, alteração de permissões)
- Rastreabilidade entre telas: a alteração do 'Perfil Caixa' (Tela 36) e a autorização de desconto excedente por Marina Costa (Gerente) aparecem como eventos

**Inconsistências do protótipo**
- O breadcrumb diz 'Administração / Auditoria', o menu diz 'Configurações > Histórico e auditoria' e o título diz 'Histórico de atividades e auditoria' (três nomes diferentes)
- O selo 'Somente consulta' tem cara de botão (fundo azul claro com ícone), o que pode confundir
- Período e filial aparecem como select, sem intervalo de datas visível
- Na Tela 36, a coluna Acesso mostra o último acesso de Marina Costa às 08:46 e de Hércules às 09:12, mas eles fizeram ações às 10:48 e 10:43; se a coluna indica 'último acesso', os horários não batem
- A página tem continuação (parte 2 de 2) na página 53, fora deste intervalo

### Tela 37 — Histórico e auditoria (Parte 2 de 2) (p. 53)

Grupo: Administração e suporte

**Objetivo:** Continuação (parte 2 de 2) da mesma visão. Contexto: permite investigar ações realizadas no ERP, identificando responsáveis, momentos e objetos alterados para apoiar controle e rastreabilidade. Visão principal e comentários na página 52.

**Regiões da tela**
- Menu lateral escuro (apenas a faixa aparece, recortada)
- Coluna esquerda: continuação da lista 'Atividades' (cartões de evento) com rodapé de paginação
- Coluna direita: continuação do painel 'Detalhes do evento' com grade de metadados, selo, seção 'O que mudou' (tabela Antes/Depois), seção 'Motivo / contexto', expansor 'Dados técnicos' e rodapé com contador e botão
- Nota de rodapé da prévia com ícone de frasco: 'Prévia com dados demonstrativos. Nenhuma operação real é executada.'

**Campos observados**
- Lista de atividades - cartão de evento: Data · hora (formato dd/mm · hh:mm:ss, ex.: 23/09 · 10:40:31)
- Lista de atividades - cartão de evento: Módulo · Filial (ex.: PDV · Centro; Estoque · Centro; Financeiro · Crato)
- Lista de atividades - cartão de evento: Título da ação (ex.: Permissões do perfil alteradas; Desconto acima do limite bloqueado; Saldo de estoque ajustado; Recebimento registrado)
- Lista de atividades - cartão de evento: Responsável (ex.: Hércules Benevides; Lucas Pereira; Ana Ribeiro; Marina Costa)
- Lista de atividades - cartão de evento: Situação (Concluído / Bloqueado)
- Contador de paginação: '1–5 de 9 eventos'
- Detalhes do evento: Registro (rótulo cortado nesta página; valor 'Perfil Caixa' - rótulo visível na página 52)
- Detalhes do evento: Filial (rótulo cortado nesta página; valor 'Loja Centro' - rótulo visível na página 52)
- Detalhes do evento: Módulo (Usuários)
- Detalhes do evento: Origem (ERP administrativo)
- Detalhes do evento: Selo 'Ação sensível'
- Seção 'O que mudou': tabela com Campo / Antes / Depois
- Linha 'Desconto máximo' (Antes 5% / Depois 8%)
- Linha 'Cancelar venda' (Antes Não permitido / Depois Permitido)
- Seção 'Motivo / contexto': texto em citação (Ajuste do perfil Caixa para a operação do cliente-piloto.)
- Expansor 'Dados técnicos' (recolhido)
- Rodapé do detalhe: '1 evento neste registro'

**Botões e ações observados**
- Selecionar cartão de evento na lista (evento selecionado 'Permissões do perfil alteradas' realçado com fundo laranja-claro e barra laranja à esquerda)
- Botão '← Anterior' (desabilitado na primeira página)
- Botão 'Próxima →'
- Expansor/acordeão '▶ Dados técnicos'
- Botão 'Ver relacionados'

**Colunas de tabelas**
- O que mudou: Campo | Antes | Depois (coluna 'Depois' realçada em verde)

**Indicadores / cartões / gráficos**
- Cartões de evento na lista (5 por página: 1–5 de 9 eventos)
- Contador '1 evento neste registro'

**Estados e selos**
- Concluído (verde, ponto)
- Bloqueado (vermelho, ponto)
- Ação sensível (selo laranja-claro)
- Evento selecionado realçado em laranja-claro
- Valores alterados realçados em verde na coluna 'Depois'

**Regras e políticas ilustradas (exemplos)**
- Alteração de permissões de perfil é marcada como 'Ação sensível'
- Perfil Caixa: desconto máximo alterado de 5% para 8%
- Perfil Caixa: permissão 'Cancelar venda' alterada de 'Não permitido' para 'Permitido'
- Desconto acima do limite no PDV é bloqueado e registrado na auditoria com situação 'Bloqueado' (ex.: Lucas Pereira, PDV · Centro, 10:40:31)
- Auditoria registra diff campo a campo (Antes/Depois) e exige/mostra motivo/contexto da alteração
- Lista paginada de 5 eventos por página
- Cada evento identifica Módulo · Filial, responsável e situação
- Detalhe agrupa eventos do mesmo registro ('1 evento neste registro') e permite ver relacionados

**Inconsistências do protótipo**
- Formato de data/hora na lista ('23/09 · 10:40:31', sem ano e com segundos) difere do detalhe ('23/09/2026 às 10:43:07', pág. 52) e de outras telas ('23/09/2026 · 10:18')
- Título da seção no guia 'Histórico e auditoria' difere do título interno da tela 'Histórico de atividades e auditoria' e do breadcrumb 'Administração / Auditoria' (pág. 52)
- Rótulos dos campos 'Registro' e 'Filial' ficam cortados na divisão entre as partes 1 e 2

### Tela 38 — Empresas e filiais (p. 54)

Grupo: Administração e suporte

**Objetivo:** Organiza as entidades e unidades que compõem a operação, reunindo dados cadastrais e configurações que determinam o contexto de trabalho.

**Principais ações (comentário)**
- Consultar empresas e suas filiais.
- Revisar dados e situação da unidade.
- Manter informações cadastrais e vínculos.

**Ponto de atenção**
- A separação de dados entre empresas deve ser explícita. Alterações de situação não podem comprometer a consulta dos movimentos e documentos já registrados.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, breadcrumb 'Administração / Empresas e filiais', seletor de empresa (Varejo Exemplo) e avatar do usuário (HB)
- Menu lateral escuro 'PRINCIPAL' com item 'Configurações' ativo e subitem 'Empresas e filiais'
- Cabeçalho da página: título 'Empresas e filiais', subtítulo 'Organize a matriz e as unidades de cada empresa.' e botões de ação à direita
- Cartão da empresa: avatar 'VE', razão social, linha de resumo e link 'Editar empresa'
- Painel de busca/filtro + tabela de unidades com rodapé de contagem
- Cartão de detalhe da unidade selecionada com abas e grade de dados (3 colunas x 2 linhas)
- Nota de rodapé: 'Dados e CNPJs ilustrativos. Alterações apenas nesta prévia, sem consulta cadastral.'

**Campos observados**
- Seletor de empresa no cabeçalho (dropdown) (Varejo Exemplo)
- Cartão da empresa: Razão social (Varejo Exemplo Comércio Ltda.)
- Cartão da empresa: Código da empresa (Empresa 01)
- Cartão da empresa: Quantidade de unidades cadastradas (3 unidade(s) cadastrada(s))
- Buscar unidade (texto; placeholder 'Nome, cidade ou CNPJ')
- Situação no ERP (select) (Todas)
- Tabela unidades: Unidade - nome (ex.: Loja Centro) + tipo (Matriz/Filial)
- Tabela unidades: CNPJ (ex.: 12.845.330/0001-42)
- Tabela unidades: Cidade / UF (ex.: Juazeiro do Norte / CE)
- Tabela unidades: Situação (Ativa / Em implantação)
- Rodapé da tabela: '3 de 3 unidades' e resumo '2 ativas · 1 em implantação'
- Detalhe da unidade - cabeçalho: Nome (Loja Centro)
- Detalhe da unidade - subtítulo: Tipo · CNPJ · indicação de sessão (Matriz · CNPJ 12.845.330/0001-42 · unidade em uso nesta sessão)
- Dados gerais: Responsável (Marina Costa)
- Dados gerais: E-mail (centro@varejo.example)
- Dados gerais: Telefone ((88) 0000-0000)
- Dados gerais: Endereço (Rua Exemplo, 100 · Centro)
- Dados gerais: Cidade / UF (Juazeiro do Norte / CE)
- Dados gerais: Identificação (Matriz · unidade 101)

**Botões e ações observados**
- Seletor de empresa (dropdown no cabeçalho)
- Avatar do usuário 'HB'
- Breadcrumb 'Administração' / 'Empresas e filiais'
- Botão 'Nova empresa' (secundário)
- Botão '+ Nova filial' (primário, laranja)
- Link 'Editar empresa'
- Campo de busca 'Buscar unidade'
- Select 'Situação no ERP'
- Link 'Abrir' (por linha da tabela)
- Selecionar linha da tabela (linha 'Loja Centro' realçada em azul-claro)
- Botão 'Editar cadastro'
- Abas 'Dados gerais' / 'Operação' / 'Fiscal'
- Itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações > Empresas e filiais)

**Abas / etapas**
- Dados gerais (ativa)
- Operação
- Fiscal

**Colunas de tabelas**
- Unidades: Unidade | CNPJ | Cidade / UF | Situação | Ação

**Filtros**
- Buscar unidade (Nome, cidade ou CNPJ)
- Situação no ERP (Todas)
- Seletor de empresa no cabeçalho (Varejo Exemplo)

**Indicadores / cartões / gráficos**
- Cartão da empresa (VE · Varejo Exemplo Comércio Ltda. · Empresa 01 · 3 unidade(s) cadastrada(s))
- Resumo do rodapé da tabela (3 de 3 unidades; 2 ativas · 1 em implantação)
- Cartão de detalhe da unidade (Loja Centro)

**Estados e selos**
- Ativa (verde, ponto)
- Em implantação (laranja, ponto)
- Tipo de unidade: Matriz / Filial
- 'unidade em uso nesta sessão'
- Linha selecionada realçada em azul-claro

**Itens de menu**
- PRINCIPAL: Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações (ativo)
- Subitem de Configurações: Empresas e filiais (ativo)

**Regras e políticas ilustradas (exemplos)**
- Empresa possui uma Matriz e N Filiais (Loja Centro = Matriz; Loja Crato e Loja Barbalha = Filiais)
- CNPJs das unidades compartilham a raiz da empresa (12.845.330) com sufixo sequencial /0001 (matriz), /0002, /0003 (filiais)
- Situações de unidade no ERP: Ativa e Em implantação
- A unidade em uso na sessão é indicada no detalhe ('unidade em uso nesta sessão')
- Unidade tem identificação interna (Matriz · unidade 101)
- Dados cadastrais organizados por abas: Dados gerais, Operação, Fiscal

**Inconsistências do protótipo**
- Rótulo do filtro 'Situação no ERP' difere do cabeçalho de coluna 'Situação'
- Cidade/UF aparece em duas linhas na tabela (Juazeiro do Norte / CE em linhas separadas) e como 'Juazeiro do Norte / CE' no detalhe
- Breadcrumb usa 'Administração' enquanto o menu lateral agrupa a tela em 'Configurações'
- Seletor do cabeçalho mostra empresa (Varejo Exemplo), enquanto Tela 39 mostra 'Todas as filiais' e Tela 40 mostra 'Centro' - semântica do seletor global varia entre telas
- Menu lateral não exibe o item 'Notificações' que aparece na Tela 42
- Responsável da Loja Centro (Marina Costa) aparece operando o caixa da Loja Crato na Tela 39 e registrando recebimento em Financeiro · Crato na Tela 37 (possível vínculo multiunidade não explicitado)

### Tela 39 — Terminais do PDV (p. 55)

Grupo: Administração e suporte

**Objetivo:** Relaciona os caixas físicos ou estações de atendimento à filial, reunindo os parâmetros operacionais necessários à abertura e ao uso do PDV.

**Principais ações (comentário)**
- Consultar terminais por filial e situação.
- Revisar dados de operação do caixa.
- Configurar vínculos e parâmetros do terminal.

**Ponto de atenção**
- Definir responsabilidades sobre numeração, periféricos e sessões. A alteração de um terminal em uso precisa preservar a continuidade e a rastreabilidade do caixa.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, breadcrumb 'Administração / Terminais do PDV', seletor de filial (Todas as filiais) e avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Configurações' ativo e subitem 'Terminais do PDV'
- Cabeçalho da página: título 'Terminais do PDV', subtítulo 'Configure os equipamentos e a operação de cada caixa.' e botão '+ Novo terminal'
- Coluna esquerda: lista 'Terminais' com contador (3) e cartões de terminal
- Painel direito: detalhe do terminal selecionado com abas, seções 'Impressora de comprovantes' e 'Leitor e gaveta' e rodapé de ações
- Nota de rodapé: 'Prévia demonstrativa. Não conecta equipamentos, processa pagamentos ou emite notas.'

**Campos observados**
- Seletor de filial no cabeçalho (dropdown) (Todas as filiais)
- Lista 'Terminais' - contador (3)
- Cartão de terminal: Código (PDV-01 / PDV-02)
- Cartão de terminal: Filial · Local (ex.: Loja Centro · Balcão principal; Loja Centro · Balcão de atendimento; Loja Crato · Balcão Crato)
- Cartão de terminal: Situação do terminal (Ativo)
- Cartão de terminal: Situação do caixa · operador (Caixa fechado; Caixa aberto · Lucas Pereira; Caixa aberto · Marina Costa)
- Detalhe: título Código · Nome do terminal (PDV-02 · Balcão de atendimento)
- Detalhe: subtítulo Filial · situação do caixa e operador (Loja Centro · caixa aberto por Lucas Pereira)
- Impressora de comprovantes: Conexão (select) (USB / impressora instalada)
- Impressora de comprovantes: Largura do papel (select) (80 mm)
- Impressora de comprovantes: Identificação da impressora (texto) (Térmica balcão 02)
- Leitor e gaveta: Leitor de código de barras (select) (USB · entrada pelo teclado)
- Leitor e gaveta: Gaveta de dinheiro - checkbox 'Abrir no recebimento em dinheiro' (marcado)
- Texto de ajuda: 'Gaveta acionada pela impressora configurada no terminal.'

**Botões e ações observados**
- Seletor de filial (dropdown no cabeçalho)
- Avatar 'HB'
- Botão '+ Novo terminal' (primário, laranja)
- Selecionar cartão de terminal (PDV-02 selecionado, borda azul e fundo azul-claro)
- Abas 'Identificação' / 'Periféricos' / 'Pagamentos'
- Botão 'Prévia de impressão'
- Checkbox 'Abrir no recebimento em dinheiro'
- Link 'Conferir configuração'
- Botão 'Descartar' (aparência desabilitada)
- Botão 'Salvar na prévia' (primário, aparência desabilitada/esmaecida)
- Itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações > Terminais do PDV)

**Abas / etapas**
- Identificação
- Periféricos (ativa)
- Pagamentos

**Filtros**
- Seletor de filial no cabeçalho (Todas as filiais)

**Indicadores / cartões / gráficos**
- Contador de terminais (3)
- Cartão PDV-01 (Loja Centro · Balcão principal · Ativo · Caixa fechado)
- Cartão PDV-02 (Loja Centro · Balcão de atendimento · Ativo · Caixa aberto · Lucas Pereira)
- Cartão PDV-01 (Loja Crato · Balcão Crato · Ativo · Caixa aberto · Marina Costa)

**Estados e selos**
- Ativo (verde, ponto)
- Caixa fechado
- Caixa aberto · <operador>
- Terminal selecionado realçado em azul

**Itens de menu**
- PRINCIPAL: Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações (ativo)
- Subitem de Configurações: Terminais do PDV (ativo)

**Regras e políticas ilustradas (exemplos)**
- Numeração de terminais é por filial (PDV-01 existe na Loja Centro e na Loja Crato)
- Terminal vinculado a uma filial e a um local de atendimento (balcão)
- Terminal mostra estado do caixa (aberto/fechado) e o operador da sessão aberta
- Impressora de comprovantes térmica com largura de papel configurável (80 mm) e conexão USB / impressora instalada
- Leitor de código de barras USB em modo entrada pelo teclado
- Gaveta de dinheiro é acionada pela impressora do terminal e abre no recebimento em dinheiro
- Configuração de terminal em uso (caixa aberto) pode ser editada, exigindo preservar continuidade do caixa
- Salvar/Descartar habilitados apenas quando há alteração pendente (aparência desabilitada sem alterações)

**Inconsistências do protótipo**
- Dois terminais com o mesmo código 'PDV-01' (Loja Centro e Loja Crato) exibidos lado a lado na visão 'Todas as filiais' - identificação ambígua sem a filial (a Tela 42 cita apenas 'PDV-01')
- Breadcrumb 'Administração' vs menu lateral 'Configurações'
- Botões 'Descartar' e 'Salvar na prévia' aparecem esmaecidos/desabilitados apesar de o formulário estar editável

### Tela 40 — Central de integrações (Parte 1 de 2) (p. 56)

Grupo: Administração e suporte

**Objetivo:** Concentra os serviços conectados ao ERP e suas configurações por filial, permitindo localizar pendências e entender onde cada integração é utilizada.

**Principais ações (comentário)**
- Consultar o catálogo de integrações.
- Editar parâmetros e vínculos de credenciais.
- Conferir dados e histórico de alterações.

**Ponto de atenção**
- As credenciais exibidas na prévia são referências demonstrativas. A operação real deverá proteger segredos e distinguir configuração válida de conexão efetivamente operacional.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, breadcrumb 'Administração / Integrações', seletor de filial (Centro) e avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Configurações' ativo e subitem 'Central de integrações'
- Cabeçalho da página: título 'Central de integrações', subtítulo 'Gerencie as conexões utilizadas por cada filial.' e selo 'PRÉVIA DO ERP'
- Barra de abas por categoria + botão 'Ver pendências'
- Linha de resumo da filial e contador de integrações
- Grade de cartões de integração (2 colunas), continua na página 57

**Campos observados**
- Seletor de filial no cabeçalho (dropdown) (Centro)
- Resumo: Filial · configuradas · pendentes · desativadas (Loja Centro · 4 configuradas · 2 pendentes · 0 desativadas)
- Contador: '6 de 6 integrações'
- Cartão de integração: Sigla/ícone (PX; TF)
- Cartão de integração: Nome (Pix integrado; Cartões / TEF)
- Cartão de integração: Categoria (Pagamentos)
- Cartão de integração: Descrição (Cobranças no PDV e confirmação do recebimento.; Autorização de cartões e retorno para o caixa.)
- Cartão de integração: Situação (Configurada)
- Cartão de integração: Ambiente (Produção)
- Cartão de integração: Mensagem de estado (Dados de configuração preenchidos.)

**Botões e ações observados**
- Seletor de filial (dropdown no cabeçalho)
- Avatar 'HB'
- Abas de categoria 'Todas' / 'Pagamentos' / 'Fiscal' / 'Financeiro' / 'Contabilidade'
- Botão 'Ver pendências'
- Link 'Atividade' (por cartão)
- Botão 'Gerenciar' (por cartão configurado)
- Itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações > Central de integrações)

**Abas / etapas**
- Todas (ativa)
- Pagamentos
- Fiscal
- Financeiro
- Contabilidade

**Filtros**
- Abas de categoria (Todas, Pagamentos, Fiscal, Financeiro, Contabilidade)
- Seletor de filial no cabeçalho (Centro)
- Botão 'Ver pendências' (filtro rápido de pendências)

**Indicadores / cartões / gráficos**
- Resumo da filial (4 configuradas · 2 pendentes · 0 desativadas)
- Contador (6 de 6 integrações)
- Cartão 'Pix integrado' (PX · Pagamentos · Configurada · Produção)
- Cartão 'Cartões / TEF' (TF · Pagamentos · Configurada · Produção)
- Cartões 'NF-e e NFC-e' e 'NFS-e' cortados no rodapé (continuam na pág. 57)

**Estados e selos**
- PRÉVIA DO ERP (selo no cabeçalho)
- Configurada (verde, ponto)
- Produção (selo de ambiente, cinza)

**Itens de menu**
- PRINCIPAL: Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações (ativo)
- Subitem de Configurações: Central de integrações (ativo)

**Regras e políticas ilustradas (exemplos)**
- Integrações são configuradas por filial
- Catálogo agrupado por categoria: Pagamentos, Fiscal, Financeiro, Contabilidade
- Estados de integração contabilizados: configuradas, pendentes, desativadas
- Integração configurada exibe ambiente (Produção) e botão 'Gerenciar'
- Cada integração possui histórico ('Atividade')

**Inconsistências do protótipo**
- Seletor do cabeçalho mostra uma filial ('Centro') enquanto outras telas mostram empresa ('Varejo Exemplo') ou 'Todas as filiais'; o resumo usa 'Loja Centro'
- Selo 'PRÉVIA DO ERP' no cabeçalho aparece apenas nesta tela (demais telas usam apenas nota de rodapé)
- Breadcrumb 'Administração / Integrações' vs subitem de menu 'Central de integrações' sob 'Configurações'
- Selo 'Produção' ao lado de 'Configurada' pode sugerir conexão validada, contrariando o ponto de atenção (configuração preenchida não equivale a conexão operacional)

### Tela 40 — Central de integrações (Parte 2 de 2) (p. 57)

Grupo: Administração e suporte

**Objetivo:** Continuação (parte 2 de 2) da mesma visão. Contexto: concentra os serviços conectados ao ERP e suas configurações por filial, permitindo localizar pendências e entender onde cada integração é utilizada. Visão principal e comentários na página 56.

**Regiões da tela**
- Menu lateral escuro (faixa recortada)
- Grade de cartões de integração (2 colunas x 2 linhas)
- Nota de rodapé: 'Integrações e credenciais fictícias. Nenhuma conexão, transmissão ou pagamento real.'

**Campos observados**
- Cartão de integração: Sigla/ícone (FE; FS; BC; CT)
- Cartão de integração: Nome (NF-e e NFC-e; NFS-e; Conexão bancária; Área da contabilidade)
- Cartão de integração: Categoria (Fiscal; Fiscal; Financeiro; Contabilidade)
- Cartão de integração: Descrição (Integração para emissão de notas de produtos e vendas.; Integração para emissão de notas de serviços.; Importação de extratos para a conciliação financeira.; Disponibilização de documentos para o escritório contábil.)
- Cartão de integração: Situação (Configurada / Pendente)
- Cartão de integração: Ambiente (Produção / Homologação)
- Cartão de integração: Mensagem de estado (Dados de configuração preenchidos. / 2 itens de configuração pendentes.)

**Botões e ações observados**
- Link 'Atividade' (por cartão)
- Botão 'Gerenciar' (cartões configurados: NF-e e NFC-e, NFS-e)
- Botão 'Configurar' (cartões pendentes: Conexão bancária, Área da contabilidade)

**Indicadores / cartões / gráficos**
- Cartão 'NF-e e NFC-e' (FE · Fiscal · Configurada · Produção · Dados de configuração preenchidos.)
- Cartão 'NFS-e' (FS · Fiscal · Configurada · Produção · Dados de configuração preenchidos.)
- Cartão 'Conexão bancária' (BC · Financeiro · Pendente · Homologação · 2 itens de configuração pendentes.)
- Cartão 'Área da contabilidade' (CT · Contabilidade · Pendente · Homologação · 2 itens de configuração pendentes.)

**Estados e selos**
- Configurada (verde, ponto)
- Pendente (laranja, ponto)
- Produção (selo de ambiente)
- Homologação (selo de ambiente)

**Regras e políticas ilustradas (exemplos)**
- Integração configurada → ação 'Gerenciar'; integração pendente → ação 'Configurar'
- Integrações pendentes exibem quantidade de itens de configuração pendentes (2 itens)
- Integrações pendentes estão em ambiente de Homologação; configuradas em Produção
- Integrações fiscais separadas: NF-e/NFC-e (produtos e vendas) e NFS-e (serviços)
- Conexão bancária usada para importação de extratos e conciliação financeira
- Área da contabilidade disponibiliza documentos ao escritório contábil

**Inconsistências do protótipo**
- Totais batem com o resumo da pág. 56 (4 configuradas, 2 pendentes, 6 integrações)
- A Tela 42 classifica o aviso 'Integração bancária requer configuração' na área 'Sistema', enquanto aqui a Conexão bancária pertence à categoria 'Financeiro'
- Nome 'Conexão bancária' aqui vs 'Integração bancária' no aviso da Tela 42

### Tela 40 — Configuração da integração fiscal (p. 58)

_Visão complementar: Configuração da integração fiscal (detalhe da integração NF-e e NFC-e)_

Grupo: Administração e suporte

**Objetivo:** A integração apresenta seus parâmetros, contexto de filial e vínculos de credenciais. Visão complementar da Tela 40: Central de integrações (visão principal e comentários gerais na página 56).

**Ponto de atenção**
- Uma configuração preenchida não equivale a uma conexão de produção validada.

**Regiões da tela**
- Link de retorno '← Voltar às integrações' no topo
- Cartão de detalhe da integração: ícone 'FE', nome, subtítulo filial · categoria e selo de situação
- Abas 'Configuração' / 'Atividade'
- Checkbox de habilitação
- Grade de campos 2x2 com texto de ajuda
- Seção 'Credencial da integração' com caixa de credencial vinculada
- Seção 'Uso no ERP' com texto explicativo em citação
- Rodapé de ações (link à esquerda, botões à direita)
- Sem cabeçalho do aplicativo e sem menu lateral (recorte do detalhe)

**Campos observados**
- Cabeçalho: Sigla/ícone (FE)
- Cabeçalho: Nome da integração (NF-e e NFC-e)
- Cabeçalho: Filial · Categoria (Loja Centro · Fiscal)
- Cabeçalho: Situação (Configurada)
- Checkbox 'Habilitar integração nesta filial' (marcado)
- Nome da conexão * (texto, obrigatório) (NF-e e NFC-e · Centro)
- Ambiente · configuração fiscal (select, somente leitura/desabilitado) (Produção)
- Perfil fiscal da filial (somente leitura) (Perfil fiscal · Centro)
- Filial vinculada (somente leitura) (Loja Centro)
- Texto de ajuda: 'Perfil e ambiente herdados das configurações fiscais da filial.'
- Credencial da integração: título 'Credencial de exemplo vinculada'
- Credencial da integração: identificador (DEMO-CENTRO-FISCAL-PRD)
- Uso no ERP: texto 'Vinculada à emissão de NF-e e NFC-e. Certificado, séries e numeração são definidos nas configurações fiscais.'

**Botões e ações observados**
- Link '← Voltar às integrações'
- Abas 'Configuração' / 'Atividade'
- Checkbox 'Habilitar integração nesta filial'
- Link 'Remover vínculo' (credencial)
- Link 'Conferir dados'
- Botão 'Descartar' (aparência desabilitada)
- Botão 'Salvar na prévia' (primário, aparência desabilitada/esmaecida)

**Abas / etapas**
- Configuração (ativa)
- Atividade

**Indicadores / cartões / gráficos**
- Caixa 'Credencial de exemplo vinculada' (DEMO-CENTRO-FISCAL-PRD)

**Estados e selos**
- Configurada (verde, ponto)
- Campos herdados/somente leitura com fundo cinza
- Asterisco de campo obrigatório em 'Nome da conexão'

**Regras e políticas ilustradas (exemplos)**
- Integração pode ser habilitada/desabilitada por filial
- Nome da conexão é obrigatório
- Ambiente fiscal e perfil fiscal são herdados das configurações fiscais da filial (não editáveis na integração)
- Integração vinculada a uma credencial (referência), com opção de remover vínculo
- Certificado, séries e numeração NÃO são definidos aqui, e sim nas configurações fiscais
- Integração NF-e/NFC-e é usada na emissão de NF-e e NFC-e

**Inconsistências do protótipo**
- Botões 'Descartar' e 'Salvar na prévia' esmaecidos apesar de o formulário ter campos editáveis
- Identificador da credencial 'DEMO-CENTRO-FISCAL-PRD' sugere produção ao lado do selo 'Configurada', enquanto o comentário alerta que configuração preenchida não equivale a conexão de produção validada
- Ação 'Gerenciar' no cartão (pág. 57) leva a um detalhe cujo título no guia é 'Configuração da integração fiscal', sem breadcrumb próprio

### Tela 41 — Backup e restauração (Parte 1 de 2) (p. 59)

Grupo: Administração e suporte

**Objetivo:** Apresenta a administração das cópias e o histórico de proteção dos dados, incluindo a revisão das opções de recuperação.

**Principais ações (comentário)**
- Consultar situação e histórico das cópias.
- Revisar parâmetros de proteção dos dados.
- Examinar as etapas de restauração.

**Ponto de atenção**
- Restauração requer escopo, permissões e conferência dos impactos. Uma indicação visual de sucesso na prévia não comprova que existe uma cópia real recuperável.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, breadcrumb 'Administração / Backup e restauração', seletor de empresa (Varejo Exemplo) e avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com 'Configurações' ativo e subitem 'Backup e restauração'
- Cabeçalho da página: título 'Backup e restauração', subtítulo 'Cópias completas dos dados sincronizados de cada empresa.' e botões 'Programação' e 'Simular nova cópia'
- Cartão de resumo com 3 colunas (Última cópia concluída / Programação da prévia / Abrangência)
- Cartão 'Histórico de cópias' com filtro de situação e tabela (continua na pág. 60)

**Campos observados**
- Seletor de empresa no cabeçalho (dropdown) (Varejo Exemplo)
- Última cópia concluída (23/09/2026 · 02:00) + nota 'Integridade verificada · exemplo'
- Programação da prévia (Diariamente às 02:00) + nota 'Retenção configurada: 30 dias'
- Abrangência (Varejo Exemplo) + nota 'Todas as unidades da empresa'
- Filtro Situação (select) (Todas)
- Tabela: Data / identificação (ex.: 23/09/2026 · 02:00 / BKP-0005)
- Tabela: Origem (Automática / Manual)
- Tabela: Tamanho (ex.: 1,82 GB)
- Tabela: Situação (Concluída)
- Tabela: Integridade (Verificada / Pendente)

**Botões e ações observados**
- Seletor de empresa (dropdown no cabeçalho)
- Avatar 'HB'
- Botão 'Programação' (ícone de calendário/relógio)
- Botão 'Simular nova cópia' (primário, laranja, ícone de banco de dados)
- Select 'Situação' (filtro do histórico)
- Link 'Detalhes' (por linha)
- Selecionar linha (BKP-0005 realçada em azul-claro)
- Itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações > Backup e restauração)

**Colunas de tabelas**
- Histórico de cópias: Data / identificação | Origem | Tamanho | Situação | Integridade | Ação

**Filtros**
- Situação (Todas)
- Seletor de empresa no cabeçalho (Varejo Exemplo)

**Indicadores / cartões / gráficos**
- Última cópia concluída (23/09/2026 · 02:00 · Integridade verificada · exemplo)
- Programação da prévia (Diariamente às 02:00 · Retenção configurada: 30 dias)
- Abrangência (Varejo Exemplo · Todas as unidades da empresa)
- Linhas visíveis: BKP-0005 (23/09/2026 · 02:00 · Automática · 1,82 GB · Concluída · Verificada); BKP-0004 (22/09/2026 · 16:30 · Manual · 1,81 GB · Concluída · Pendente); BKP-0003 (22/09/2026 · 02:00 · Automática · 1,80 GB · Concluída · Verificada)

**Estados e selos**
- Concluída (verde, ponto)
- Integridade Verificada (cinza)
- Integridade Pendente (laranja)
- Linha selecionada realçada em azul-claro

**Itens de menu**
- PRINCIPAL: Visão geral, Vendas, Estoque, Financeiro, Fiscal, Configurações (ativo)
- Subitem de Configurações: Backup e restauração (ativo)

**Regras e políticas ilustradas (exemplos)**
- Cópias completas dos dados sincronizados por empresa (abrangência: todas as unidades da empresa)
- Programação diária às 02:00
- Retenção configurada de 30 dias
- Cópias podem ter origem Automática (rotina) ou Manual
- Situação da cópia (Concluída/Falhou) é independente da verificação de integridade (Verificada/Pendente)
- Identificação sequencial das cópias (BKP-0001 … BKP-0005)

**Inconsistências do protótipo**
- Breadcrumb 'Administração' vs menu lateral 'Configurações'
- Botão 'Simular nova cópia' e rótulo 'Programação da prévia' misturam linguagem de prévia com a função real
- Formato de data aqui '23/09/2026 · 02:00' difere do usado na Tela 37 ('23/09 · 10:40:31')

### Tela 41 — Backup e restauração (Parte 2 de 2) (p. 60)

Grupo: Administração e suporte

**Objetivo:** Continuação (parte 2 de 2) da mesma visão. Contexto: apresenta a administração das cópias e o histórico de proteção dos dados, incluindo a revisão das opções de recuperação. Visão principal e comentários na página 59.

**Regiões da tela**
- Menu lateral escuro (faixa recortada)
- Continuação da tabela 'Histórico de cópias' com rodapé de contagem
- Cartão de detalhe da cópia selecionada (BKP-0005): cabeçalho, grade 3x2 de dados, caixa informativa, nota e rodapé de ações
- Nota de rodapé: 'Dados demonstrativos. Nenhum arquivo é criado, tarefa é agendada ou banco de dados é restaurado.'

**Campos observados**
- Tabela (continuação): Data / identificação, Origem, Tamanho, Situação, Integridade
- Rodapé da tabela: '5 de 5 registros · horários de Brasília (UTC−3)'
- Detalhe: Identificação (BKP-0005)
- Detalhe: Data/hora · empresa (23/09/2026 às 02:00 · Varejo Exemplo)
- Detalhe: Situação (Concluída)
- Detalhe: Conteúdo (Dados sincronizados, XML e anexos)
- Detalhe: Unidades (Centro, Crato e Barbalha)
- Detalhe: Destino (Armazenamento gerenciado · exemplo)
- Detalhe: Solicitado por (Rotina automática)
- Detalhe: Tipo da cópia (Completa)
- Detalhe: Integridade (Verificada · exemplo)
- Caixa informativa: 'Programação diária.'
- Nota: 'Movimentações ainda offline nos terminais ficam fora desta cópia central.'

**Botões e ações observados**
- Link 'Detalhes' (por linha)
- Botão 'Verificação concluída' (desabilitado)
- Botão 'Preparar restauração'

**Colunas de tabelas**
- Histórico de cópias (continuação): Data / identificação | Origem | Tamanho | Situação | Integridade | Ação

**Indicadores / cartões / gráficos**
- Linhas: BKP-0002 (21/09/2026 · 02:00 · Automática · — · Falhou · — · Detalhes); BKP-0001 (20/09/2026 · 02:00 · Automática · 1,79 GB · Concluída · Verificada · Detalhes)
- Cartão de detalhe BKP-0005

**Estados e selos**
- Concluída (verde, ponto)
- Falhou (vermelho, ponto)
- Integridade Verificada
- '—' para tamanho e integridade de cópia com falha

**Regras e políticas ilustradas (exemplos)**
- Cópia com falha não tem tamanho nem integridade (exibidos como '—')
- Horários exibidos em horário de Brasília (UTC−3)
- Conteúdo da cópia: dados sincronizados, XML e anexos
- Cópia abrange todas as unidades (Centro, Crato e Barbalha)
- Movimentações offline ainda não sincronizadas dos terminais ficam fora da cópia central
- Verificação de integridade é uma ação separada; fica desabilitada ('Verificação concluída') quando já verificada
- Restauração é iniciada por 'Preparar restauração' (etapa preparatória, não execução direta)

**Inconsistências do protótipo**
- Unidades da cópia incluem Barbalha, que na Tela 38 está 'Em implantação'
- Cópia BKP-0004 é 'Manual' mas o detalhe exibido (BKP-0005) mostra 'Solicitado por: Rotina automática' - para cópias manuais o solicitante não é mostrado no exemplo
- Rodapé '5 de 5 registros' com retenção de 30 dias e programação diária desde 20/09 - coerente, mas não há paginação visível

### Tela 42 — Central de notificações (Parte 1 de 2) (p. 61)

Grupo: Administração e suporte

**Objetivo:** Reúne avisos operacionais para que o usuário identifique pendências e consulte o contexto antes de atuar no módulo correspondente.

**Principais ações (comentário)**
- Filtrar avisos por tipo e situação.
- Abrir os detalhes de uma notificação.
- Marcar leitura e consultar o assunto relacionado.

**Ponto de atenção**
- Marcar um aviso como lido não resolve a ocorrência de origem. A aplicação deverá preservar essa distinção e respeitar o acesso do usuário ao conteúdo relacionado.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, breadcrumb 'Notificações / Central', seletor de empresa (Varejo Exemplo) e avatar (HB)
- Menu lateral escuro 'PRINCIPAL' com item 'Notificações' (badge 4) ativo
- Cabeçalho da página: título 'Central de notificações', subtítulo 'Avisos e pendências da operação em um só lugar.' e botão 'Preferências'
- Linha de filtros (Filial, Área, Exibir)
- Faixa de contadores (não lidas, pendências, prioridade alta) com legenda do escopo
- Coluna esquerda: lista 'Caixa de entrada' com link 'Marcar exibidas como lidas'
- Painel direito: detalhe da notificação selecionada (continua na pág. 62)

**Campos observados**
- Seletor de empresa no cabeçalho (dropdown) (Varejo Exemplo)
- Filtro Filial (select) (Todas as filiais)
- Filtro Área (select) (Todas as áreas)
- Filtro Exibir (select) (Caixa de entrada)
- Contador: não lidas (4)
- Contador: pendências (5)
- Contador: prioridade alta (1)
- Legenda do escopo: 'Caixa de entrada · filial e área selecionadas'
- Item da lista: indicador de não lida (ponto azul) + título (ex.: NFC-e aguardando correção; Estoque abaixo do mínimo; Conta a receber vencida)
- Item da lista: Prioridade (Alta / Atenção)
- Item da lista: Área (Fiscal / Estoque / Financeiro)
- Item da lista: Filial (Centro / Crato)
- Item da lista: Data · hora (ex.: 23/09/2026 · 10:18)
- Detalhe: Prioridade (Alta) e estado de leitura (Não lida)
- Detalhe: Título (NFC-e aguardando correção)
- Detalhe: Código · data/hora (ALR-0042 · 23/09/2026 às 10:18)
- Detalhe: Descrição (Uma venda finalizada no PDV-01 está com emissão pendente.)
- Detalhe: Área (Fiscal)
- Detalhe: Filial (Centro)
- Detalhe: Situação na origem (Pendente)
- Detalhe: Responsável na origem (Ana Ribeiro)
- Detalhe: Próxima ação (título visível, conteúdo na pág. 62)

**Botões e ações observados**
- Seletor de empresa (dropdown no cabeçalho)
- Avatar 'HB'
- Botão 'Preferências' (ícone de ajustes)
- Select 'Filial'
- Select 'Área'
- Select 'Exibir'
- Link 'Marcar exibidas como lidas'
- Selecionar notificação na lista (item 'NFC-e aguardando correção' realçado com fundo azul-claro e barra azul à esquerda)
- Item de menu 'Notificações' com badge de contagem (4)
- Itens do menu lateral (Visão geral, Vendas, Estoque, Financeiro, Fiscal, Notificações, Configurações)

**Filtros**
- Filial (Todas as filiais)
- Área (Todas as áreas)
- Exibir (Caixa de entrada)
- Seletor de empresa no cabeçalho (Varejo Exemplo)

**Indicadores / cartões / gráficos**
- 4 não lidas
- 5 pendências
- 1 prioridade alta
- Itens visíveis: NFC-e aguardando correção (Alta · Fiscal · Centro · 23/09/2026 · 10:18); Estoque abaixo do mínimo (Atenção · Estoque · Crato · 23/09/2026 · 09:52); Conta a receber vencida (Atenção · Financeiro · Centro - continua na pág. 62)

**Estados e selos**
- Alta (selo vermelho-claro)
- Atenção (selo laranja-claro)
- Não lida (texto no detalhe; ponto azul e título em negrito na lista)
- Pendente (laranja, ponto - situação na origem)
- Badge numérico '4' no menu Notificações
- Item selecionado realçado em azul-claro

**Itens de menu**
- PRINCIPAL: Visão geral, Vendas, Estoque, Financeiro, Fiscal, Notificações (ativo, badge 4), Configurações
- Item 'Notificações' aparece no menu (não exibido nas Telas 38–41)

**Regras e políticas ilustradas (exemplos)**
- Notificações com níveis de prioridade: Alta, Atenção, Informativa
- Contador de não lidas reflete o badge do menu (4)
- Pendências = avisos que exigem ação na origem (Alta/Atenção) (5)
- Cada aviso tem código (ALR-xxxx), área, filial, situação na origem e responsável na origem
- Contadores calculados sobre o escopo filtrado (caixa de entrada · filial e área selecionadas)
- Leitura (lida/não lida) é independente da situação na origem (Pendente)

**Inconsistências do protótipo**
- Breadcrumb 'Notificações / Central' (módulo próprio) enquanto as Telas 37–41 do mesmo grupo usam 'Administração / …'
- Menu lateral desta tela inclui 'Notificações', ausente nos menus das Telas 38–41
- Descrição cita 'PDV-01' sem filial explícita no texto, e existem dois PDV-01 (Centro e Crato) na Tela 39
- Áreas usadas nos avisos ('Vendas e caixa', 'Sistema') não correspondem aos itens do menu ('Vendas') nem às categorias de integração ('Financeiro')

### Tela 42 — Central de notificações (Parte 2 de 2) (p. 62)

Grupo: Administração e suporte

**Objetivo:** Continuação (parte 2 de 2) da mesma visão. Contexto: reúne avisos operacionais para que o usuário identifique pendências e consulte o contexto antes de atuar no módulo correspondente. Visão principal e comentários na página 61.

**Regiões da tela**
- Menu lateral escuro (faixa recortada)
- Coluna esquerda: continuação da lista 'Caixa de entrada' com rodapé de contagem
- Painel direito: continuação do detalhe ('Próxima ação', botões de ação, área de arquivamento com texto explicativo)
- Nota de rodapé: 'Dados demonstrativos. Nenhum aviso é enviado e os registros de origem não são alterados.'

**Campos observados**
- Item da lista: indicador de não lida (ponto azul) + título
- Item da lista: Prioridade (Atenção / Informativa)
- Item da lista: Área (Financeiro / Vendas e caixa / Fiscal / Sistema / Estoque)
- Item da lista: Filial (Centro / Crato / Barbalha / Todas as unidades)
- Item da lista: Data · hora
- Rodapé da lista: '8 notificações · horários de Brasília (UTC−3)'
- Detalhe - Próxima ação: texto (Consulte o retorno da emissão e revise os dados na central de NFC-e.)
- Detalhe - texto de ajuda: 'Ler o aviso não resolve a pendência. O arquivamento fica disponível após a resolução na origem.'

**Botões e ações observados**
- Selecionar notificação na lista
- Botão 'Consultar NFC-e' (primário, laranja - ação contextual que leva ao módulo de origem)
- Botão 'Marcar como lida'
- Link/botão 'Arquivar aviso' (desabilitado)

**Indicadores / cartões / gráficos**
- Itens: Conta a receber vencida (Atenção · Financeiro · Centro · 23/09/2026 · 09:35, não lida)
- Fechamento de caixa para conferência (Atenção · Vendas e caixa · Crato · 23/09/2026 · 09:10, lida)
- NF-e autorizada (Informativa · Fiscal · Centro · 23/09/2026 · 08:46, não lida)
- Cópia automática concluída (Informativa · Sistema · Todas as unidades · 23/09/2026 · 02:00, lida)
- Integração bancária requer configuração (Atenção · Sistema · Centro · 22/09/2026 · 17:42, lida)
- Inventário concluído (Informativa · Estoque · Barbalha · 22/09/2026 · 16:20, lida)
- Caixa 'Próxima ação'

**Estados e selos**
- Atenção (selo laranja-claro)
- Informativa (selo cinza)
- Ponto azul + título em negrito = não lida; sem ponto e título normal = lida
- 'Arquivar aviso' desabilitado (cinza-claro)

**Regras e políticas ilustradas (exemplos)**
- Marcar como lida não resolve a pendência na origem
- Arquivamento só fica disponível após a resolução da ocorrência na origem
- Cada aviso oferece ação contextual que leva ao módulo de origem (ex.: 'Consultar NFC-e')
- Total da caixa de entrada: 8 notificações (4 não lidas; 5 pendências Alta/Atenção; 3 informativas)
- Avisos de sistema podem abranger 'Todas as unidades' (ex.: cópia automática)
- Horários exibidos em horário de Brasília (UTC−3)

**Inconsistências do protótipo**
- Aviso 'Integração bancária requer configuração' classificado na área 'Sistema', enquanto na Tela 40 a 'Conexão bancária' pertence à categoria 'Financeiro' (e o nome difere: 'Integração' vs 'Conexão' bancária)
- Aviso 'Inventário concluído' na filial Barbalha, que está 'Em implantação' na Tela 38
- Área 'Vendas e caixa' não corresponde ao rótulo do menu lateral ('Vendas')
- Filial exibida como 'Centro'/'Crato' nos avisos e como 'Loja Centro'/'Loja Crato' nas Telas 38–40

### Tela 43 — Ajuda e suporte (p. 63)

Grupo: Administração e suporte

**Objetivo:** Facilita a orientação sobre o uso do ERP e o registro de solicitações de atendimento, reunindo conteúdos de ajuda e acompanhamento de chamados.

**Principais ações (comentário)**
- Buscar orientações e abrir artigos.
- Consultar chamados existentes.
- Registrar uma solicitação com seu contexto.

**Ponto de atenção**
- Definir o que será atendido pela base de conhecimento e o que depende da equipe. Chamados precisam de identificação, acompanhamento e tratamento adequado dos dados enviados.

**Regiões da tela**
- Cabeçalho superior: logotipo INTERCERT, trilha 'Ajuda / Suporte', seletor de empresa (Varejo Exemplo), avatar do usuário (HB)
- Menu lateral escuro 'PRINCIPAL' com item 'Ajuda e suporte' ativo
- Cabeçalho da página: título 'Ajuda e suporte', subtítulo 'Encontre orientações e acompanhe seus chamados.' e botão primário laranja '+ Novo chamado' à direita
- Barra de abas: 'Base de ajuda' / 'Meus chamados (4)'
- Painel de busca destacado (fundo azul claro) 'O que você precisa fazer?' com campo de busca e seletor de assunto
- Contador '6 orientações disponíveis'
- Grade de cartões de orientação (2 colunas x 3 linhas), cada cartão com etiqueta de assunto, título em negrito e descrição
- Rodapé de conteúdo: 'Precisa de ajuda com uma situação específica?' com link 'Abrir um chamado' à direita
- Aviso de demonstração com ícone de frasco: 'Demonstração. Chamados e respostas ficam apenas nesta prévia; nada é enviado ao suporte.'

**Campos observados**
- Seletor de empresa no cabeçalho (select; Varejo Exemplo)
- Buscar orientação (campo de texto; placeholder 'Ex.: conferir fechamento de caixa')
- Assunto (select; 'Todos os assuntos')
- Cartão de orientação: Assunto/categoria (etiqueta azul, ex.: Fiscal)
- Cartão de orientação: Título do artigo (ex.: Conferir uma NFC-e pendente)
- Cartão de orientação: Descrição resumida (ex.: Localize a venda e consulte o retorno da emissão.)
- Contador de resultados (6 orientações disponíveis)

**Botões e ações observados**
- + Novo chamado (botão primário laranja, canto superior direito)
- Aba 'Base de ajuda'
- Aba 'Meus chamados (4)'
- Cartão clicável 'Conferir uma NFC-e pendente' (Fiscal) — abrir artigo
- Cartão clicável 'Conferir o fechamento de caixa' (Vendas e PDV) — abrir artigo
- Cartão clicável 'Cadastrar um produto' (Estoque) — abrir artigo
- Cartão clicável 'Localizar uma conta recebida' (Financeiro) — abrir artigo
- Cartão clicável 'Revisar integrações da filial' (Configurações) — abrir artigo
- Cartão clicável 'Conferir uma solicitação de NFS-e' (Fiscal) — abrir artigo
- Link 'Abrir um chamado' (rodapé)
- Seletor de empresa (cabeçalho)
- Avatar do usuário HB (menu do usuário)
- Itens do menu lateral (navegação)

**Abas / etapas**
- Base de ajuda (ativa)
- Meus chamados (4)

**Filtros**
- Buscar orientação (texto livre)
- Assunto (Todos os assuntos; opções implícitas pelas etiquetas: Fiscal, Vendas e PDV, Estoque, Financeiro, Configurações)

**Indicadores / cartões / gráficos**
- Contador '6 orientações disponíveis'
- Cartão: Fiscal — Conferir uma NFC-e pendente — Localize a venda e consulte o retorno da emissão.
- Cartão: Vendas e PDV — Conferir o fechamento de caixa — Revise os valores e os movimentos do período.
- Cartão: Estoque — Cadastrar um produto — Organize identificação, preço e controle de estoque.
- Cartão: Financeiro — Localizar uma conta recebida — Encontre o título e consulte o histórico de recebimentos.
- Cartão: Configurações — Revisar integrações da filial — Confira o ambiente e as pendências de configuração.
- Cartão: Fiscal — Conferir uma solicitação de NFS-e — Consulte o serviço e a situação da solicitação.

**Estados e selos**
- Etiquetas de assunto nos cartões: Fiscal, Vendas e PDV, Estoque, Financeiro, Configurações
- Contagem de chamados na aba (4)
- Selo/aviso de Demonstração (ícone de frasco)

**Itens de menu**
- PRINCIPAL (rótulo de seção)
- Visão geral
- Vendas
- Estoque
- Financeiro
- Fiscal
- Configurações
- Ajuda e suporte (ativo)

**Regras e políticas ilustradas (exemplos)**
- Aba 'Meus chamados' exibe a quantidade de chamados do usuário entre parênteses (4)
- Orientações classificadas por assunto/módulo; filtro por assunto + busca textual
- Dois pontos de entrada para abrir chamado: botão 'Novo chamado' e link 'Abrir um chamado' após a base de ajuda
- Na prévia, chamados e respostas não são enviados ao suporte (apenas demonstração)

**Inconsistências do protótipo**
- Menu lateral desta tela inclui 'Ajuda e suporte' mas não inclui 'Relatórios' nem 'Compras', que aparecem nas Telas 44–46; nas Telas 44–46 o item 'Ajuda e suporte' não aparece no menu
- Trilha 'Ajuda / Suporte' difere do título da tela 'Ajuda e suporte'
- Ações redundantes para o mesmo fim ('Novo chamado' e 'Abrir um chamado') sem indicar se o link pré-preenche contexto

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

