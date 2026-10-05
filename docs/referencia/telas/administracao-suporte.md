# Telas do PDF — administracao-suporte

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

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

