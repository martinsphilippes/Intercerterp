# Telas do PDF — clientes

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

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

