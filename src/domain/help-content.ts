import { detId, isConflict, listAll } from "@/lib/db";
import type { Store } from "@/lib/db/types";
import { searchable } from "@/lib/core/text";

/**
 * Conteúdo de ajuda do ERP (Tela 43). Artigos globais (companyId nulo), sincronizados em `help_articles`.
 * `contextRoutes` liga o artigo às telas: a ajuda contextual mostra os artigos cuja rota é prefixo da tela atual.
 * Formato do corpo: Markdown simples (## título, listas "- " e "1. ", **negrito**, `código`, [texto](/rota)).
 */

export interface HelpArticle {
  slug: string;
  area: string;
  title: string;
  summary: string;
  tags: string[];
  contextRoutes: string[];
  body: string;
}

export const HELP_AREAS: Array<{ key: string; label: string; description: string }> = [
  { key: "inicio", label: "Primeiros passos", description: "Acesso, unidades, navegação e pesquisa." },
  { key: "vendas", label: "Vendas e caixa", description: "PDV, caixa, histórico, trocas e devoluções." },
  { key: "estoque", label: "Produtos e estoque", description: "Cadastro, preços, movimentos, transferências e inventário." },
  { key: "clientes", label: "Clientes", description: "Cadastro, crédito e histórico do cliente." },
  { key: "financeiro", label: "Financeiro", description: "Receber, pagar, fluxo de caixa, conciliação e cartões." },
  { key: "compras", label: "Compras", description: "Reposição, cotações, pedidos, aprovação e recebimento." },
  { key: "fiscal", label: "Fiscal", description: "NF-e, NFC-e, NFS-e, configurações e relatórios." },
  { key: "relatorios", label: "Análise", description: "Painel, relatórios gerenciais e curva ABC." },
  { key: "administracao", label: "Administração", description: "Usuários, empresas, terminais, integrações, backup e auditoria." },
  { key: "suporte", label: "Notificações e suporte", description: "Central de notificações e chamados." },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "primeiro-acesso-e-unidades",
    summary: "Entre com login ou convite, recupere a senha e escolha empresa e filial (consolidado é só consulta).",
    area: "inicio",
    title: "Primeiro acesso, senha e escolha da empresa/filial",
    tags: ["login", "senha", "convite", "filial", "consolidado"],
    contextRoutes: ["/dashboard", "/selecionar-unidade"],
    body: `## Como entrar
Use seu **login** (ou e-mail) e senha. Se você recebeu um convite, abra o link do e-mail (ou o link entregue pelo administrador) e defina sua senha — o convite tem validade e, depois de vencido, o administrador precisa reenviá-lo.

## Esqueci a senha
Na tela de login, use **Esqueci minha senha**. Quando o envio de e-mail não estiver configurado na instalação, peça ao administrador para redefinir sua senha em [Usuários e permissões](/administracao/usuarios).

## Empresa e filial
Tudo o que você vê e registra pertence à **empresa e filial ativas**, exibidas no topo da tela. Para trocar, clique no seletor de unidade.

- **Filial específica**: permite operar (vender, movimentar estoque, baixar títulos).
- **Consolidado**: mostra todas as filiais juntas, mas é **somente consulta** — para registrar operações, escolha uma filial.

## Acesso bloqueado
Se aparecer "acesso suspenso" ou "usuário inativo", o administrador bloqueou seu acesso. Use a opção **Suporte** na tela de login para registrar a solicitação.`,
  },
  {
    slug: "navegacao-pesquisa-e-listagens",
    summary: "Use a pesquisa global, filtros na URL, colunas configuráveis, totais do recorte e exportação CSV.",
    area: "inicio",
    title: "Navegação, pesquisa global, filtros e exportação",
    tags: ["pesquisa", "filtros", "exportar", "csv", "colunas"],
    contextRoutes: ["/dashboard", "/clientes", "/produtos", "/vendas"],
    body: `## Pesquisa global
A caixa de pesquisa no topo encontra produtos (nome, SKU, código de barras), clientes e fornecedores (nome ou CPF/CNPJ) e, digitando um número, vendas e pedidos de compra.

## Filtros e ordenação
Os filtros ficam na URL: ao abrir um registro e voltar, a listagem continua filtrada. Clique no título de uma coluna para ordenar.

## Colunas e totais
Em **Colunas** você escolhe o que aparece na tabela (a escolha fica salva no seu navegador). A linha **Total do recorte** soma apenas os registros filtrados.

## Exportar
O botão **Exportar** gera um CSV (compatível com Excel) **com os mesmos filtros da tela**. Exige a permissão "Exportar dados" e fica registrado no histórico de auditoria.

## Indicadores
Os cartões de indicadores mostram o período e o critério. Clique neles para abrir os registros que compõem o total.`,
  },
  {
    slug: "pdv-registrar-venda",
    summary: "Leia os itens, aplique descontos dentro do limite, identifique o cliente e receba em uma ou mais formas.",
    area: "vendas",
    title: "PDV: registrar uma venda do início ao fim",
    tags: ["pdv", "venda", "pagamento", "pix", "cartão", "desconto"],
    contextRoutes: ["/pdv"],
    body: `## Antes de vender
O caixa do terminal precisa estar **aberto** (veja "Abertura e fechamento de caixa"). Cada terminal tem um depósito padrão de onde sai o estoque.

## Passo a passo
1. Leia o código de barras ou pesquise o produto pelo nome/SKU. O leitor configurado como teclado funciona direto no campo de pesquisa.
2. Ajuste quantidade e, se permitido, o desconto do item. O limite de desconto vem do seu perfil ou do seu usuário; acima dele, é necessária aprovação de quem tem "Aprovar desconto acima do limite".
3. Identifique o cliente quando a venda for a prazo (crediário/boleto) ou se ele quiser CPF na nota.
4. Escolha as formas de pagamento. É possível dividir entre várias formas; o troco só é aceito em dinheiro.
5. Conclua. A venda gera os movimentos de estoque, os recebimentos no financeiro e a NFC-e quando configurada.

## Pix
O QR Code é gerado pelo provedor configurado e a venda só é concluída com a **confirmação real** do pagamento. Em ambiente de demonstração, o provedor é de simulação e não movimenta dinheiro.

## Cartão
Sem TEF integrado, informe o NSU/autorização da maquininha. As taxas e prazos de liquidação vêm do meio de pagamento.

## Venda sem saldo
Por padrão a venda é bloqueada quando falta estoque. O parâmetro "Permitir venda sem saldo" (empresa, filial ou terminal) libera a operação, registrando o saldo negativo.`,
  },
  {
    slug: "caixa-abertura-sangria-fechamento",
    summary: "Abra o caixa com fundo de troco, registre sangrias e suprimentos e confira o fechamento.",
    area: "vendas",
    title: "Abertura, sangria, suprimento e fechamento de caixa",
    tags: ["caixa", "sangria", "suprimento", "fechamento", "reabertura", "diferença"],
    contextRoutes: ["/caixa", "/pdv"],
    body: `## Abertura
Informe o fundo de troco contado. Só pode haver **uma sessão aberta por terminal**; se outro operador deixou o caixa aberto, ele (ou o gerente) precisa fechá-lo.

## Sangria e suprimento
Use **Sangria** para retirar dinheiro da gaveta (ex.: depósito no cofre) e **Suprimento** para reforçar o troco. Ambos exigem motivo e ficam no histórico da sessão.

## Fechamento
1. Conte o dinheiro e informe os valores por forma de pagamento.
2. O sistema mostra o **esperado** (fundo + vendas em dinheiro + suprimentos − sangrias − trocos) e a **diferença**.
3. Diferenças acima do limite configurado em Parâmetros exigem justificativa.

## Reabertura
Reabrir um caixa fechado exige a permissão "Reabrir caixa" e registra quem reabriu e por quê. Não é possível reabrir se já houver outra sessão aberta no mesmo terminal.`,
  },
  {
    slug: "trocas-devolucoes-e-vale-credito",
    summary: "Cancele vendas, registre devoluções e trocas e use o vale-crédito como forma de pagamento.",
    area: "vendas",
    title: "Cancelamento, devolução, troca e vale-crédito",
    tags: ["cancelamento", "devolução", "troca", "vale", "estorno"],
    contextRoutes: ["/vendas", "/vendas/devolucoes"],
    body: `## Cancelar ou devolver?
- **Cancelamento**: desfaz a venda inteira (normalmente no mesmo dia), estorna estoque e financeiro e cancela a NFC-e dentro do prazo legal. Exige a permissão "Cancelar venda" e motivo.
- **Devolução/troca**: o cliente devolve parte ou todos os itens depois da venda.

## Devolução
1. Abra a venda em [Histórico de vendas](/vendas) e escolha **Devolver itens**.
2. Informe as quantidades (nunca acima do vendido menos o já devolvido) e a condição: itens em bom estado voltam ao depósito disponível; avariados vão para o depósito de avarias.
3. Escolha a compensação: reembolso (dinheiro/Pix/estorno no cartão) ou **vale-crédito**.

## Vale-crédito
O vale tem código, saldo e validade e pode ser usado como forma de pagamento no PDV, total ou parcialmente. O saldo nunca fica negativo.

## Troca
Na troca, os itens devolvidos geram crédito que é abatido da nova venda; a diferença é paga ou devolvida ao cliente.`,
  },
  {
    slug: "cadastro-de-produtos-e-variacoes",
    summary: "Organize produto, variações (SKU), dados fiscais, tabelas de preço, atacado e custos.",
    area: "estoque",
    title: "Cadastro de produtos, variações (SKU) e preços",
    tags: ["produto", "sku", "variação", "preço", "tabela", "atacado", "ncm"],
    contextRoutes: ["/produtos"],
    body: `## Produto e variações
Um produto pode ter **variações** (ex.: tamanho e cor). Cada combinação é um **SKU** com código de barras e estoque próprios. Produtos sem variação têm um único SKU.

## Dados fiscais
Informe NCM, origem e grupo tributário. Sem esses dados a emissão de NF-e/NFC-e é recusada pelo emissor.

## Preços
- Os preços ficam em **tabelas** (ex.: Varejo, Atacado). Cada filial tem uma tabela padrão (definida em Empresas e filiais).
- O preço de **atacado** vale a partir da quantidade mínima informada.
- O desconto máximo por preço limita o desconto no PDV, além do limite do usuário.

## Custos
O custo médio é recalculado a cada entrada de estoque (recebimentos de compra). Alterações de preço e custo ficam no histórico do produto.

## Inativar
Produtos com movimentação não são excluídos: inative-os para que não apareçam no PDV, preservando o histórico.`,
  },
  {
    slug: "movimentos-transferencias-inventario",
    summary: "Ajuste saldos com motivo, transfira entre filiais e conclua inventários com rastreabilidade.",
    area: "estoque",
    title: "Movimentação de estoque, transferências e inventário",
    tags: ["estoque", "ajuste", "transferência", "inventário", "contagem", "mínimo"],
    contextRoutes: ["/estoque"],
    body: `## Saldo
O saldo é sempre resultado de **movimentos** (entrada, saída, ajuste, transferência, venda, devolução). Não existe edição direta de saldo: cada alteração fica rastreável com origem e usuário.

## Ajuste manual
Exige a permissão "Ajustar estoque" e motivo. Use para quebras, perdas e correções pontuais; para correções amplas, prefira o inventário.

## Transferência entre filiais
1. Crie a transferência (origem, destino e itens) e **separe**.
2. Ao **enviar**, o estoque sai da origem e fica "em trânsito".
3. No **recebimento** pela filial de destino, informe as quantidades conferidas; divergências ficam registradas.

## Inventário
1. Abra o inventário do depósito (total, por categoria ou localização).
2. Registre as contagens (é possível recontar).
3. Na conclusão, o sistema gera os ajustes considerando os movimentos ocorridos durante a contagem. Exige "Concluir inventário".

## Estoque mínimo
Quando o saldo atinge o mínimo, o sistema gera uma notificação (se habilitado em Parâmetros) e o item aparece no planejamento de reposição.`,
  },
  {
    slug: "clientes-cadastro-e-credito",
    summary: "Cadastro único por CPF/CNPJ, rascunho, limite de crédito do crediário e histórico do cliente.",
    area: "clientes",
    title: "Clientes: cadastro único, crédito e histórico",
    tags: ["cliente", "cpf", "cnpj", "crédito", "crediário", "limite"],
    contextRoutes: ["/clientes"],
    body: `## Um cadastro por CPF/CNPJ
O documento é único na empresa: ao tentar cadastrar um CPF/CNPJ já existente, o sistema mostra o cliente encontrado em vez de duplicar. Para pessoa jurídica, use a lupa ao lado do CNPJ para preencher os dados a partir da consulta pública (confira antes de salvar).

## Rascunho
Se faltar informação, salve como **rascunho** e complete depois.

## Limite de crédito
O limite do crediário é concedido manualmente. O disponível é o limite menos o saldo em aberto. Vendas a prazo acima do disponível são recusadas.

## Histórico
Na ficha do cliente você vê compras, títulos (com situação de vencimento), vales-crédito, documentos fiscais e a linha do tempo de alterações.`,
  },
  {
    slug: "contas-a-receber-e-pagar",
    summary: "Localize títulos, baixe parcelas com juros e descontos e estorne baixas lançadas por engano.",
    area: "financeiro",
    title: "Contas a receber e a pagar: baixa, juros e estorno",
    tags: ["receber", "pagar", "baixa", "estorno", "juros", "multa", "parcelas"],
    contextRoutes: ["/financeiro/receber", "/financeiro/pagar"],
    body: `## Títulos e parcelas
Vendas a prazo, compras recebidas e lançamentos manuais geram **títulos** com uma ou mais parcelas.

## Baixa
1. Abra a parcela e escolha **Baixar**.
2. Informe data, conta financeira, juros, multa e desconto. A baixa pode ser parcial.
3. O valor entra (ou sai) da conta financeira escolhida e aparece no extrato e no fluxo de caixa.

## Estorno
Uma baixa errada é **estornada** (nunca apagada): o lançamento é revertido na conta e a parcela volta a ter saldo. Exige "Estornar baixas" e motivo.

## Contas a pagar com autorização
Quando a política exigir, a conta a pagar precisa ser **autorizada** antes da baixa ("Autorizar contas a pagar").

## Vencimentos
Notificações avisam títulos vencidos e contas do dia. Ler a notificação não baixa o título: a pendência só some quando a parcela é liquidada.`,
  },
  {
    slug: "fluxo-de-caixa-e-conciliacao",
    summary: "Compare realizado e previsto, importe extratos OFX/CNAB e concilie com os lançamentos.",
    area: "financeiro",
    title: "Fluxo de caixa, conciliação bancária e recebíveis de cartão",
    tags: ["fluxo", "conciliação", "ofx", "cnab", "extrato", "cartão"],
    contextRoutes: ["/financeiro/fluxo-caixa", "/financeiro/conciliacao", "/financeiro/cartoes"],
    body: `## Fluxo de caixa
Mostra o **realizado** (lançamentos nas contas) e o **previsto** (parcelas em aberto por vencimento), por dia, semana ou mês.

## Conciliação
1. Importe o extrato (OFX ou CSV) ou o arquivo de retorno CNAB 240/400 do banco. O mesmo arquivo não é importado duas vezes.
2. O sistema sugere correspondências entre transações do banco e lançamentos do ERP.
3. Confirme as correspondências; diferenças de tarifa podem gerar o lançamento de despesa automaticamente.
4. Uma conciliação pode ser desfeita, voltando as transações para pendentes.

## Recebíveis de cartão
Vendas em cartão viram recebíveis com data prevista de liquidação e taxa do meio de pagamento. Ao conferir o extrato da adquirente, baixe os recebíveis pelo valor líquido.`,
  },
  {
    slug: "planejamento-de-reposicao-e-cotacoes",
    summary: "Gere a sugestão de compra pela cobertura, cote fornecedores e crie os pedidos.",
    area: "compras",
    title: "Planejamento de reposição, cotações e pedidos de compra",
    tags: ["reposição", "cotação", "pedido", "fornecedor", "cobertura"],
    contextRoutes: ["/compras/reposicao", "/compras/cotacoes", "/compras/pedidos", "/fornecedores"],
    body: `## Sugestão de reposição
A sugestão considera o saldo atual, o que está em trânsito, o estoque mínimo/de segurança, a média de vendas do **histórico** e os dias de **cobertura** desejados (ambos configuráveis em Parâmetros), arredondando para o múltiplo de compra do fornecedor.

## Cotação
1. Gere a cotação a partir da sugestão ou manualmente.
2. Registre as propostas de cada fornecedor (preço, frete, prazo de entrega e pagamento, validade).
3. Escolha a melhor proposta por item ou por fornecedor; o sistema cria os pedidos correspondentes.

## Pedido de compra
O pedido passa por **análise/aprovação** conforme a política (valor, fornecedor). Revisões relevantes depois de aprovado voltam para análise. Após aprovado, envie ao fornecedor.`,
  },
  {
    slug: "aprovacao-e-recebimento-de-mercadorias",
    summary: "Aprove pedidos pela política e receba mercadorias pelo XML da NF-e com conferência.",
    area: "compras",
    title: "Aprovação de compras e recebimento com XML da NF-e",
    tags: ["aprovação", "recebimento", "xml", "nf-e", "divergência", "custo"],
    contextRoutes: ["/compras/aprovacoes", "/compras/recebimentos"],
    body: `## Aprovação
As solicitações seguem as etapas da política de aprovação. Quem aprova vê o pedido, o histórico de revisões e o impacto financeiro. A decisão pode ser revogada com motivo enquanto o pedido não foi enviado.

## Recebimento
1. Importe o **XML da NF-e** do fornecedor (ou informe os itens manualmente).
2. Vincule os itens da nota aos SKUs (o vínculo fica salvo para as próximas notas) e aos pedidos.
3. Confira quantidades e valores: divergências contra o pedido ficam destacadas.
4. Confirme. A entrada gera o estoque (com custo médio atualizado) e o título a pagar com as parcelas da nota.

A mesma nota (chave de acesso) não pode ser recebida duas vezes.`,
  },
  {
    slug: "emissao-nfe-nfce-nfse",
    summary: "Acompanhe a situação dos documentos, corrija rejeições, cancele, corrija e inutilize números.",
    area: "fiscal",
    title: "Emissão de NF-e, NFC-e e NFS-e e tratamento de rejeições",
    tags: ["nf-e", "nfc-e", "nfs-e", "rejeição", "cancelamento", "cc-e", "inutilização", "contingência"],
    contextRoutes: ["/fiscal"],
    body: `## Situações do documento
**Na fila → Processando → Autorizado**, ou **Rejeitado/Denegado**, ou **Erro de comunicação**. O ERP só mostra "Autorizado" quando o retorno da SEFAZ/prefeitura confirma.

## Rejeição
Abra o documento para ver o código e a mensagem da rejeição. Corrija a causa (ex.: NCM, endereço, IE do destinatário) e **retransmita**. O documento mantém o mesmo número enquanto não autorizado.

## Cancelamento e carta de correção
- Cancelamento: dentro do prazo legal, com justificativa (mín. 15 caracteres). Exige "Cancelar documento fiscal".
- CC-e: corrige dados que não alteram valores, impostos ou destinatário.

## Inutilização
Números pulados (falha antes da autorização) devem ser **inutilizados** para não gerar pendência com o fisco.

## Simulação
Documentos com o selo **SIMULAÇÃO** foram gerados pelo provedor de demonstração e **não têm validade fiscal**. Para emitir de verdade, configure o emissor e o certificado em Configurações fiscais e Central de integrações.`,
  },
  {
    slug: "configuracoes-fiscais-e-certificado",
    summary: "Configure emissor, ambiente, séries, CSC e certificado por filial e teste a conexão.",
    area: "fiscal",
    title: "Configurações fiscais: emissor, certificado, séries e CSC",
    tags: ["configuração", "certificado", "série", "csc", "ambiente", "homologação"],
    contextRoutes: ["/fiscal/configuracoes", "/administracao/integracoes"],
    body: `## Por filial
Cada filial tem sua configuração: ambiente (homologação ou produção), séries e próxima numeração de NF-e/NFC-e/RPS, CSC da NFC-e e padrão de NFS-e.

## Certificado digital
O certificado A1 é enviado ao emissor. A tela mostra validade e titular; o sistema avisa quando estiver perto de vencer.

## Teste de conexão
Use **Testar conexão**: a situação só passa a "Operacional" com resposta real do emissor. Credenciais não ficam gravadas no banco — apenas a referência à variável de ambiente.

## Séries por terminal
Cada terminal do PDV usa sua própria série de NFC-e (Administração → Terminais) para evitar disputa de numeração entre caixas.`,
  },
  {
    slug: "relatorios-e-curva-abc",
    summary: "Leia os indicadores do painel, os relatórios gerenciais e a classificação ABC dos produtos.",
    area: "relatorios",
    title: "Painel do gestor, relatórios gerenciais e curva ABC",
    tags: ["relatórios", "abc", "margem", "painel", "metas"],
    contextRoutes: ["/dashboard", "/relatorios"],
    body: `## Painel
Indicadores do período (faturamento, ticket médio, margem, metas). Cada número abre a listagem com os registros que o compõem.

## Relatórios gerenciais
Vendas por período, vendedor, forma de pagamento e filial; devoluções; posição de estoque e giro. Todos aceitam filtros e exportação do recorte.

## Curva ABC
Os produtos são ordenados pela participação acumulada no critério escolhido (faturamento, margem ou quantidade):
- **A**: até o limite A (padrão 80%) do total acumulado;
- **B**: do limite A até o limite B (padrão 95%);
- **C**: o restante.

Os limites são alterados em [Parâmetros](/administracao/parametros).`,
  },
  {
    slug: "usuarios-perfis-e-permissoes",
    summary: "Crie acessos por senha ou convite, suspenda com motivo e ajuste perfis, permissões e limites.",
    area: "administracao",
    title: "Usuários, convites, perfis e permissões",
    tags: ["usuário", "perfil", "permissão", "convite", "suspender", "administrador", "desconto"],
    contextRoutes: ["/administracao/usuarios"],
    body: `## Criar acesso
- **Senha inicial**: o administrador define a senha e informa ao usuário.
- **Convite**: o sistema gera um link de primeiro acesso com validade. Se o e-mail estiver configurado, o convite é enviado; caso contrário, o link aparece para o administrador copiar (ele só é exibido uma vez — use **Reenviar** para gerar outro).

## Situação
- **Inativar**: o usuário deixa de acessar; o histórico é preservado.
- **Suspender**: bloqueio com motivo (mostrado no login). As sessões abertas são encerradas.
- Ninguém altera a situação do próprio acesso, e o **último administrador ativo** não pode ser suspenso, inativado ou rebaixado.

## Perfis
A matriz define, por módulo, **visualizar, criar, editar e excluir**. As **operações específicas** (cancelar venda, reabrir caixa, ajustar estoque, baixar títulos, aprovar descontos, exportar…) são concedidas à parte. Perfis de sistema podem ser editados, mas não excluídos; use **Duplicar** para criar variações.

## Limite de desconto
Cada perfil tem um limite; o usuário pode ter um limite próprio, que substitui o do perfil.

## Filiais
Sem filiais marcadas, o usuário acessa todas as filiais das empresas vinculadas.`,
  },
  {
    slug: "empresas-filiais-e-parametros",
    summary: "Cadastre empresas e filiais, defina tabela de preço e depósito e ajuste os parâmetros.",
    area: "administracao",
    title: "Empresas, filiais e parâmetros da operação",
    tags: ["empresa", "filial", "cnpj", "depósito", "tabela de preço", "fuso", "parâmetros"],
    contextRoutes: ["/administracao/empresas", "/administracao/parametros"],
    body: `## Nova empresa
Cria a matriz, depósitos, perfis padrão, tabela de preço, contas, meios e condições de pagamento. A configuração fiscal fica **pendente** até ser feita.

## Nova filial
Cria automaticamente os depósitos **principal** e **avarias** e a conta caixa da filial. Defina a tabela de preço padrão e o depósito padrão — são usados pelo PDV e pelos relatórios. O fuso horário é único para toda a instalação (definido pelo administrador do servidor) e aparece na filial apenas para consulta.

## Alterações cadastrais
Mudar endereço, razão social ou IE **não altera documentos já emitidos**: vendas e notas guardam os dados da época.

## Parâmetros
Em [Parâmetros](/administracao/parametros) ficam regras como venda sem saldo, consumidor final, validade da pré-venda, limites da curva ABC, cobertura da reposição, agenda de backup e alertas de estoque mínimo. Parâmetros da filial substituem os da empresa. Toda alteração fica no histórico de auditoria.`,
  },
  {
    slug: "terminais-impressoras-e-perifericos",
    summary: "Configure terminais, impressora (navegador ou conector), leitor, gaveta e TEF e teste-os.",
    area: "administracao",
    title: "Terminais do PDV, impressora, leitor e TEF",
    tags: ["terminal", "impressora", "conector", "leitor", "tef", "cupom", "papel"],
    contextRoutes: ["/administracao/terminais", "/pdv", "/caixa"],
    body: `## Cadastro
Cada caixa físico é um terminal: filial, série da NFC-e, depósito padrão e se permite venda sem saldo.

## Impressora
- **Navegador**: o cupom é impresso pelo diálogo de impressão do sistema operacional. Ajuste a largura (58 ou 80 mm) e, no navegador, desative cabeçalhos/rodapés e margens.
- **Conector local**: um pequeno serviço instalado no computador do caixa recebe a impressão por HTTP (ex.: http://127.0.0.1:9100) e fala direto com a impressora térmica.

## Testes
- **Imprimir página de teste** abre uma página de cupom e o diálogo de impressão. O navegador não informa se o papel saiu: confira na impressora.
- **Testar conector** consulta o endereço /status do conector e registra a resposta real (versão, impressora pronta, leitor, TEF). Sem conector configurado, o resultado é "não verificado".

## Leitor de código de barras
No modo teclado, o leitor "digita" o código e envia Enter: basta o cursor estar no campo de pesquisa do PDV.`,
  },
  {
    slug: "backup-e-restauracao",
    summary: "Programe cópias, comprove que são restauráveis em base de teste e restaure em nova base.",
    area: "administracao",
    title: "Backup, verificação e restauração",
    tags: ["backup", "cópia", "restauração", "retenção", "verificação"],
    contextRoutes: ["/administracao/backups"],
    body: `## Cópias
A cópia contém todos os dados da empresa (cadastros, operações, financeiro, fiscal, histórico) e, se marcado, o conteúdo dos arquivos (XML e anexos), compactados e com checksum SHA-256.

## Agenda e retenção
Defina frequência, horário e por quantos dias as cópias são mantidas. Cópias vencidas têm o arquivo removido; a cópia válida mais recente nunca é removida.

## Verificação
**Verificar** restaura a cópia em uma **base de teste isolada** e compara a quantidade de registros e os checksums de cada tabela. Só então a cópia aparece como "Verificado (restaurável)". A base em uso nunca é tocada.

## Restauração
Escolha a cópia e o destino: base de teste (verificação) ou **nova base Appwrite** com outro identificador. A restauração nunca sobrescreve a base em uso; para passar a usar a base restaurada, o responsável técnico altera a configuração da aplicação (APPWRITE_DATABASE_ID).`,
  },
  {
    slug: "historico-e-auditoria",
    summary: "Investigue quem fez o quê, quando, em qual registro e com quais valores antes e depois.",
    area: "administracao",
    title: "Histórico e auditoria: quem fez o quê",
    tags: ["auditoria", "histórico", "log", "alterações"],
    contextRoutes: ["/administracao/historico"],
    body: `## O que é registrado
Logins, cadastros e alterações (com valores antes e depois), cancelamentos, estornos, aprovações, exportações, testes de integração, backups e mudanças de parâmetros — com usuário, data/hora, filial, IP e resultado.

## Filtros
Filtre por período, usuário, módulo, filial, ação e resultado (sucesso/falha). O detalhe do evento mostra a diferença campo a campo e o link para o registro de origem.

## Segurança
Senhas, tokens e chaves nunca aparecem no histórico: esses campos são mascarados antes de gravar.`,
  },
  {
    slug: "central-de-notificacoes",
    summary: "Filtre avisos, abra o detalhe, vá à próxima ação e entenda por que ler não resolve a origem.",
    area: "suporte",
    title: "Central de notificações: ler não é resolver",
    tags: ["notificações", "alertas", "pendências", "preferências"],
    contextRoutes: ["/notificacoes"],
    body: `## Situação da ocorrência
Cada notificação mostra a situação **na origem**:
- **Aberta**: o problema ainda existe (ex.: estoque abaixo do mínimo, título vencido).
- **Resolvida**: foi tratado na origem.
- **Informativa**: apenas aviso.

Marcar como lida **não resolve** a ocorrência. Use o link de próxima ação para tratar o problema no lugar certo.

## Arquivar
Somente notificações informativas ou já resolvidas podem ser arquivadas; pendências continuam na caixa de entrada até serem resolvidas.

## Preferências
Na aba Preferências, silencie tipos que não interessam a você. Avisos de prioridade **crítica** são sempre entregues.`,
  },
  {
    slug: "abrir-e-acompanhar-chamados",
    summary: "Registre um chamado com contexto e anexos e acompanhe as respostas até a solução.",
    area: "suporte",
    title: "Como abrir e acompanhar um chamado de suporte",
    tags: ["chamado", "suporte", "anexo", "erro"],
    contextRoutes: ["/ajuda"],
    body: `## Antes de abrir
Pesquise na ajuda: muitos problemas têm solução descrita aqui.

## Abrir um chamado
1. Em [Ajuda e suporte](/ajuda/chamados/novo), escolha a categoria e a prioridade (crítica = operação parada).
2. Descreva o que fazia, o que esperava e o que aconteceu. Inclua número da venda, nota ou pedido quando houver.
3. Anexe capturas de tela, PDF ou XML (até 8 MB cada).

A tela de origem, a filial e o navegador são registrados automaticamente para agilizar o atendimento.

## Acompanhar
O chamado recebe um número. Você é notificado a cada resposta; responda pelo próprio chamado. Quando o suporte pede informações, a situação fica "Aguardando usuário" — ao responder, o chamado volta para a fila. Se o problema foi resolvido, marque como resolvido.`,
  },
];

/** Sincroniza os artigos globais (idempotente; atualiza quando o conteúdo mudou). */
export async function ensureHelpArticles(store: Store) {
  const existing = await listAll(store, "help_articles");
  const bySlug = new Map(existing.map((a) => [a.slug, a]));
  let created = 0;
  let updated = 0;
  for (const a of HELP_ARTICLES) {
    const id = detId("help", a.slug);
    const data = { companyId: null, area: a.area, title: a.title, summary: a.summary, slug: a.slug, body: a.body, tags: a.tags, contextRoutes: a.contextRoutes, published: true };
    const cur = bySlug.get(a.slug);
    if (!cur) {
      try {
        await store.create("help_articles", data, id);
        created++;
      } catch (e) {
        if (!isConflict(e)) throw e;
      }
    } else if (cur.companyId == null && (cur.body !== a.body || cur.title !== a.title || cur.summary !== a.summary || cur.area !== a.area || JSON.stringify(cur.contextRoutes) !== JSON.stringify(a.contextRoutes) || JSON.stringify(cur.tags) !== JSON.stringify(a.tags))) {
      await store.update("help_articles", cur.id, data);
      updated++;
    }
  }
  return { created, updated };
}

/** Pesquisa simples por relevância (título > tags > corpo). */
export function searchArticles<T extends { title: string; body: string; tags?: string[]; area?: string }>(articles: T[], q: string): T[] {
  const terms = searchable(q).split(" ").filter((t) => t.length >= 2);
  if (!terms.length) return articles;
  return articles
    .map((a) => {
      const title = searchable(a.title);
      const tags = searchable((a.tags ?? []).join(" "));
      const body = searchable(a.body);
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 5;
        if (tags.includes(t)) score += 3;
        if (body.includes(t)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

/** Artigos ligados à rota (o mais específico primeiro). */
export function articlesForRoute<T extends { contextRoutes?: string[] }>(articles: T[], route: string): T[] {
  const match = (a: T) => Math.max(-1, ...(a.contextRoutes ?? []).filter((r) => route === r || route.startsWith(`${r}/`)).map((r) => r.length));
  return articles
    .map((a) => ({ a, m: match(a) }))
    .filter((x) => x.m >= 0)
    .sort((x, y) => y.m - x.m)
    .map((x) => x.a);
}
