# Telas do PDF — acesso

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

