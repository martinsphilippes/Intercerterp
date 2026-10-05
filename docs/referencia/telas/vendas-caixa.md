# Telas do PDF — vendas-caixa

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

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

