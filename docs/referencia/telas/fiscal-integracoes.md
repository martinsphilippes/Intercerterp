# Telas do PDF — fiscal-integracoes

> Extraído das imagens e comentários do PDF `Intercert_ERP_48_Telas_Comentadas.pdf` (v1.0, 03/10/2026). Valores entre parênteses são **demonstrativos** do protótipo, não regras nem dados reais.

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

