import { DEFAULT_CFOP_PAIRS } from "@/domain/cfop-entry";
import { OVERDUE_DEFAULTS, OVERDUE_POLICIES } from "@/domain/overdue";
import { SCALE_CONTENTS, SCALE_DEFAULTS, SCALE_LAYOUTS } from "@/domain/scale-barcode";

/** Catálogo de parâmetros editáveis (empresa e filial). Valores padrão vêm de DEFAULT_SETTINGS quando existem. */

/** `cfopPairs`: tabela de pares CFOP de saída → entrada (objeto { "5102": "1102" }), editada como texto "5102=1102" por linha. */
export type ParamType = "bool" | "int" | "bps" | "money" | "select" | "timezone" | "cfopPairs";

export interface ParamDef {
  key: string;
  group: string;
  label: string;
  help: string;
  type: ParamType;
  /** escopos em que pode ser definido */
  scopes: Array<"company" | "branch">;
  default: unknown;
  min?: number;
  max?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  /** onde o parâmetro é usado (transparência para o administrador) */
  usedBy: string;
  /** definido para toda a instalação (somente leitura na tela; não é gravado por empresa/filial) */
  installation?: boolean;
}

export const PARAM_GROUPS = ["Vendas e PDV", "Caixa", "Estoque e reposição", "Curva ABC", "Compras", "Financeiro", "Notificações", "Usuários", "Regional", "Fidelidade", "Recursos"];

export const PARAMS: ParamDef[] = [
  {
    key: "cash.operatorMismatch", group: "Caixa", label: "Venda em caixa aberto por outro operador", help: "O que fazer quando quem vende não é o operador que abriu o caixa do terminal. “Avisar” registra no histórico e notifica quem pode reabrir caixas; “Bloquear” exige que o vendedor use um terminal com o próprio caixa aberto (supervisores continuam liberados).", type: "select", scopes: ["company", "branch"], default: "warn",
    options: [{ value: "warn", label: "Permitir e avisar" }, { value: "block", label: "Bloquear" }, { value: "allow", label: "Permitir sem aviso" }], usedBy: "PDV (conclusão da venda)",
  },
  { key: "sales.allowNegativeStock", group: "Vendas e PDV", label: "Permitir venda sem saldo", help: "Quando desligado, o PDV bloqueia itens sem estoque disponível. O terminal também pode liberar individualmente.", type: "bool", scopes: ["company", "branch"], default: false, usedBy: "PDV (conclusão da venda)" },
  { key: "sales.consumerFinalAllowed", group: "Vendas e PDV", label: "Permitir venda a consumidor final (sem identificar cliente)", help: "Desligado, o PDV deve exigir cliente identificado em toda venda.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "PDV (identificação do cliente)" },
  {
    key: "sales.overduePolicy", group: "Vendas e PDV", label: "Cliente inadimplente na venda", type: "select", scopes: ["company", "branch"], default: OVERDUE_DEFAULTS.policy, options: OVERDUE_POLICIES,
    help: "Inadimplente = parcelas a receber vencidas há mais dias que a tolerância abaixo, somando pelo menos o valor mínimo. “Avisar” mostra o alerta no PDV (com atalho para receber) e registra no histórico a venda a prazo concluída. “Bloquear venda a prazo” impede crediário/boleto (à vista continua livre); “Bloquear qualquer venda” impede vender ao cliente identificado. O bloqueio é conferido no servidor e só é liberado, com motivo, por quem tem a permissão “Liberar venda para cliente inadimplente” (fica na auditoria).",
    usedBy: "PDV (identificação do cliente e conclusão da venda)",
  },
  { key: "sales.overdueGraceDays", group: "Vendas e PDV", label: "Tolerância de atraso para inadimplência", help: "Parcelas vencidas há até este número de dias não contam como inadimplência (ex.: 5 dias para compensação de pagamentos). Não altera multa e juros, que seguem os parâmetros de atraso do Financeiro.", type: "int", scopes: ["company", "branch"], default: OVERDUE_DEFAULTS.graceDays, min: 0, max: 365, unit: "dias", usedBy: "PDV (inadimplência) e rotina diária de inadimplentes" },
  { key: "sales.overdueMinAmount", group: "Vendas e PDV", label: "Valor mínimo vencido para inadimplência", help: "Soma mínima das parcelas vencidas (além da tolerância) para o cliente ser tratado como inadimplente. 0 = qualquer valor.", type: "money", scopes: ["company", "branch"], default: OVERDUE_DEFAULTS.minAmount, min: 0, usedBy: "PDV (inadimplência) e rotina diária de inadimplentes" },
  { key: "sales.quoteValidityDays", group: "Vendas e PDV", label: "Validade padrão do orçamento", help: "Dias corridos de validade sugeridos ao criar um orçamento (pode ser alterada em cada orçamento). Vencida a validade, a rotina diária marca o orçamento como expirado; orçamento expirado não é importado no PDV nem convertido em pedido.", type: "int", scopes: ["company", "branch"], default: 10, min: 1, max: 365, unit: "dias", usedBy: "Vendas (orçamentos) e rotina diária" },
  { key: "sales.orderReservationDays", group: "Vendas e PDV", label: "Reserva de estoque do pedido de venda", help: "Por quantos dias o pedido de venda reserva o estoque (disponível = físico − reservado) a partir da confirmação. Vencido o prazo, a rotina diária libera a reserva (o pedido continua aberto e pode renovar a reserva). 0 = o pedido não reserva estoque.", type: "int", scopes: ["company", "branch"], default: 15, min: 0, max: 365, unit: "dias", usedBy: "Vendas (pedidos), Estoque (disponível) e rotina diária" },
  { key: "sales.presaleExpiryHours", group: "Vendas e PDV", label: "Validade da pré-venda", help: "Atendimentos/pré-vendas não concluídos expiram após este prazo e liberam as reservas.", type: "int", scopes: ["company", "branch"], default: 72, min: 1, max: 720, unit: "horas", usedBy: "PDV (pré-vendas e reservas)" },
  { key: "cash.withdrawalApprovalAbove", group: "Caixa", label: "Sangria acima deste valor exige aprovação", help: "0 = sem exigência.", type: "money", scopes: ["company", "branch"], default: 0, min: 0, usedBy: "Caixa (sangria)" },
  { key: "replenishment.coverageDays", group: "Estoque e reposição", label: "Cobertura desejada", help: "Dias de venda que a sugestão de compra deve cobrir.", type: "int", scopes: ["company", "branch"], default: 14, min: 1, max: 365, unit: "dias", usedBy: "Planejamento de reposição" },
  { key: "replenishment.historyDays", group: "Estoque e reposição", label: "Histórico considerado na média de vendas", help: "Janela de dias usada para calcular a média diária de vendas.", type: "int", scopes: ["company", "branch"], default: 90, min: 7, max: 730, unit: "dias", usedBy: "Planejamento de reposição" },
  { key: "notifications.stockMin", group: "Notificações", label: "Notificar estoque abaixo do mínimo", help: "Gera aviso na central de notificações quando o saldo atinge o mínimo.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Estoque / vendas (alerta de mínimo)" },
  { key: "abc.limitA", group: "Curva ABC", label: "Limite da classe A (acumulado)", help: "Itens até este percentual acumulado são classe A.", type: "bps", scopes: ["company"], default: 8000, min: 100, max: 9900, unit: "%", usedBy: "Relatórios — curva ABC" },
  { key: "abc.limitB", group: "Curva ABC", label: "Limite da classe B (acumulado)", help: "De A até este percentual: classe B; acima: classe C. Deve ser maior que o limite A.", type: "bps", scopes: ["company"], default: 9500, min: 200, max: 10000, unit: "%", usedBy: "Relatórios — curva ABC" },
  {
    key: "purchase.revisionRequiresReview", group: "Compras", label: "Revisão de pedido aprovado volta para análise", help: "Define quando alterar um pedido já aprovado exige nova aprovação.", type: "select", scopes: ["company"], default: "relevant",
    options: [{ value: "relevant", label: "Somente alterações relevantes (valor, itens, fornecedor)" }, { value: "always", label: "Sempre" }, { value: "never", label: "Nunca" }], usedBy: "Compras (revisão de pedidos)",
  },
  {
    key: "purchase.receiptValueTolerance", group: "Compras", label: "Tolerância de valor no recebimento", type: "money", scopes: ["company", "branch"], default: 0, min: 0,
    help: "Diferença máxima aceita, sem registrar divergência, entre o total faturado informado na nota do fornecedor e o valor devido calculado no recebimento. Acima dela, a divergência de valor é registrada e exige justificativa. 0 = qualquer diferença é divergência.",
    usedBy: "Compras (recebimento de mercadorias)",
  },
  {
    key: "feature.entradaSemPedido", group: "Compras", label: "Entrada de nota sem pedido de compra", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Permite lançar a nota de compra manualmente com itens, frete e condição de pagamento sem pedido, e importar o XML marcando “sem pedido” (não vincula pedidos em aberto). Estoque, custo médio e contas a pagar seguem as mesmas regras do recebimento com pedido. Desligado, o lançamento manual exige pedido.",
    usedBy: "Compras (receber mercadorias)",
  },
  {
    key: "feature.conversorCfop", group: "Compras", label: "Converter CFOP do fornecedor em CFOP de entrada", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Na importação do XML, cada item recebe o CFOP de entrada pela tabela de pares abaixo (ex.: 5405 → 1403). Item sem par usa o padrão do recebimento (1102 interna / 2102 interestadual). O CFOP do item pode ser alterado na conferência.",
    usedBy: "Compras (importação do XML e conferência)",
  },
  {
    key: "purchase.cfopPairs", group: "Compras", label: "Pares de CFOP (saída do fornecedor → entrada)", type: "cfopPairs", scopes: ["company", "branch"], default: DEFAULT_CFOP_PAIRS,
    help: "Um par por linha no formato 5102=1102. A saída 5xxx corresponde à entrada 1xxx (interna) e a 6xxx à 2xxx (interestadual). A tabela padrão assume compra para comercialização; para uso e consumo (1556/2556) ou ativo (1551/2551), ajuste os pares ou o CFOP do item na conferência.",
    usedBy: "Compras (importação do XML)",
  },
  {
    key: "feature.devolucaoFornecedor", group: "Compras", label: "Devolução a fornecedor pelo recebimento", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra o atalho “Devolver ao fornecedor” no recebimento concluído e permite emitir a NF-e de devolução a partir dele (quantidade limitada ao recebido, valores da nota de entrada, chave referenciada). Na autorização a NF-e baixa o estoque e abate o valor do contas a pagar do recebimento; o cancelamento estorna. Desligado, a devolução continua possível pelo pedido de compra ou como NF-e avulsa.",
    usedBy: "Compras (recebimentos) e Fiscal (NF-e de devolução)",
  },
  {
    key: "purchase.pricingMode", group: "Compras", label: "Sugestão de preço após a entrada", type: "select", scopes: ["company", "branch"], default: "keep_margin",
    help: "Como a tela de precificação do recebimento sugere o novo preço quando o custo muda. “Manter a margem atual” aplica ao custo novo a margem que o produto tinha com o custo anterior (sem preço ou margem válida, usa a margem padrão abaixo). Nada é gravado sem a prévia e a confirmação do usuário.",
    options: [{ value: "keep_margin", label: "Manter a margem atual do produto" }, { value: "target_margin", label: "Usar a margem padrão" }], usedBy: "Compras (precificação após a entrada)",
  },
  { key: "pricing.defaultMarginBps", group: "Compras", label: "Margem padrão de venda", help: "Margem sobre o preço de venda: preço = custo ÷ (1 − margem). Ex.: custo R$ 7,00 com 30% → R$ 10,00. Usada na sugestão de preço após a entrada e no preço sugerido de produto cadastrado a partir da nota.", type: "bps", scopes: ["company", "branch"], default: 3000, min: 0, max: 9500, unit: "%", usedBy: "Compras (precificação após a entrada e cadastro pela nota)" },
  {
    key: "purchase.priceEnding", group: "Compras", label: "Arredondamento comercial do preço sugerido", type: "select", scopes: ["company", "branch"], default: "none",
    help: "Arredonda o preço sugerido para cima até o final escolhido (ex.: R$ 10,13 → R$ 10,90). Pode ser trocado na própria tela antes de aplicar.",
    options: [{ value: "none", label: "Sem arredondamento" }, { value: "90", label: "Terminar em ,90" }, { value: "99", label: "Terminar em ,99" }, { value: "00", label: "Valor inteiro (,00)" }], usedBy: "Compras (precificação após a entrada)",
  },
  {
    key: "purchase.pendingInvoice.dueDays", group: "Compras", label: "Prazo para a nota da entrada com nota a confirmar", type: "int", scopes: ["company", "branch"], default: 15, min: 1, max: 180, unit: "dias",
    help: "Quando a mercadoria chega antes da nota fiscal do fornecedor, a entrada pode ser lançada como “Nota a confirmar”. O prazo para receber e confirmar a nota é contado da data da entrada; depois dele a entrada aparece como vencida em Compras aguardando nota. Vale para os lançamentos feitos depois da alteração.",
    usedBy: "Compras (entrada com nota a confirmar e painel Compras aguardando nota)",
  },
  {
    key: "purchase.pendingInvoice.alert", group: "Compras", label: "Avisar sobre notas a confirmar vencendo ou vencidas", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Liga o aviso diário (Central de notificações) para quem tem a permissão “Confirmar com a nota e aprovar divergências”: uma ocorrência por recebimento quando o prazo da nota está para vencer (antecedência abaixo) ou venceu; a ocorrência é resolvida quando a nota é confirmada. Desligado, nenhum aviso é gerado — o painel continua mostrando as vencidas.",
    usedBy: "Rotina diária de compras e Central de notificações",
  },
  { key: "purchase.pendingInvoice.alertLeadDays", group: "Compras", label: "Antecedência do aviso de nota a confirmar", help: "Quantos dias antes do prazo da nota o aviso é gerado. 0 = avisar só no vencimento.", type: "int", scopes: ["company", "branch"], default: 3, min: 0, max: 60, unit: "dias", usedBy: "Rotina diária de compras (aviso de nota a confirmar)" },
  { key: "purchase.monthlyBudget", group: "Compras", label: "Orçamento mensal de compras", help: "0 = sem orçamento. Usado nas aprovações para indicar consumo do orçamento.", type: "money", scopes: ["company", "branch"], default: 0, min: 0, usedBy: "Aprovação de compras" },
  { key: "feature.precificacaoEntrada", group: "Recursos", label: "Precificação após a entrada de mercadorias", help: "Mostra a tela que sugere o novo preço de venda a partir do custo de cada recebimento concluído (com prévia antes de gravar). Desligado, o atalho e a tela ficam ocultos; nada é alterado nos preços.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Compras (recebimento concluído → Precificar)" },
  { key: "feature.alteracaoMassa", group: "Recursos", label: "Alteração de produtos em massa", help: "Mostra a tela de reajuste de preços e de alteração de categoria, marca, NCM, grupo tributário e situação de vários produtos de uma vez (sempre com prévia).", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Produtos (alteração em massa)" },
  { key: "feature.etiquetas", group: "Recursos", label: "Impressão de etiquetas de produtos", help: "Mostra a tela de etiquetas de gôndola e adesivas com preço e código de barras, inclusive a partir de um recebimento concluído.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Produtos (etiquetas) e Compras (recebimento)" },
  { key: "feature.inadimplencia", group: "Recursos", label: "Alerta e bloqueio de cliente inadimplente", help: "Liga a verificação de inadimplência na venda conforme a política em “Vendas e PDV” (aviso no PDV, bloqueio da venda a prazo ou de qualquer venda) e o aviso diário de clientes que entraram em inadimplência. Desligado, nenhuma venda é avisada ou bloqueada por atraso.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "PDV, Contas a receber e rotina diária" },
  { key: "feature.cobrancaWhatsapp", group: "Recursos", label: "Cobrança pelo WhatsApp com modelos de mensagem", help: "Mostra o botão “Cobrar no WhatsApp” nas parcelas a receber (título e cadastro do cliente): abre a conversa (wa.me, sem custo de API) com a mensagem do modelo preenchida e registra o contato no histórico do título. Os modelos são editados em Financeiro › Cobrança › Modelos de mensagem.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Contas a receber e Clientes" },
  {
    key: "feature.recebimentoPdv", group: "Recursos", label: "Receber parcelas do crediário no PDV", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra no PDV a ação “Receber parcelas” (F9): o operador localiza o cliente, escolhe as parcelas em aberto (com multa e juros por atraso) e recebe em dinheiro, cartão ou Pix no caixa aberto. O dinheiro recebido entra no dinheiro esperado do caixa e todos os meios aparecem no fechamento em “Recebimentos de crediário”. A baixa é a mesma do Financeiro (Contas a receber). Desligado, a ação não aparece e nenhum recebimento novo é registrado no caixa (estornos de recebimentos já feitos continuam possíveis).",
    usedBy: "PDV (Receber parcelas) e Caixa (previsto e fechamento)",
  },
  {
    key: "feature.documentoComercial", group: "Recursos", label: "Orçamentos e pedidos de venda", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Vendas › Orçamentos e Pedidos de venda: orçamento com validade (enviar pelo WhatsApp ou e-mail, imprimir), conversão em pedido com reserva de estoque, faturamento parcial no PDV (“Importar orçamento/pedido”) ou em NF-e com o número do pedido (xPed/nItemPed). O documento não movimenta estoque nem financeiro: quem baixa é a venda do PDV ou a NF-e. Desligado, o menu, as telas e a importação no PDV somem e nenhum documento novo é criado; vendas e NF-e já vinculadas continuam como estão.",
    usedBy: "Vendas (orçamentos e pedidos), PDV (importar) e Fiscal (NF-e de pedido)",
  },
  {
    key: "feature.balanca", group: "Recursos", label: "Balança etiquetadora (código de peso/valor e carga)", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Liga a leitura de etiquetas de balança no PDV (EAN-13 iniciado por 2: o produto é localizado pelo PLU e a quantidade sai do peso ou do valor da etiqueta, com o preço da tabela de preços), a aba “Balança” no cadastro do produto (PLU, validade, tara e informação nutricional) e a tela Produtos › Balança, que gera o arquivo de carga para Toledo (ITENSMGV.TXT) ou Filizola (CADTXT.TXT). Desligado, o PDV volta a tratar o código como um código de barras comum e a tela some; os dados já gravados no produto são mantidos.",
    usedBy: "PDV (leitura da etiqueta), Produtos (aba Balança) e Produtos › Balança (carga)",
  },
  {
    key: "scale.barcodeLayout", group: "Vendas e PDV", label: "Formato do código de barras da balança", type: "select", scopes: ["company", "branch"], default: SCALE_DEFAULTS.layout,
    options: SCALE_LAYOUTS.map((l) => ({ value: l.value, label: l.label })),
    help: "Como a balança monta a etiqueta EAN-13 (2 = circulação restrita; C = código do produto na balança, o PLU; V = peso ou valor; D = dígito verificador). Deve ser o mesmo configurado na balança. A posição marcada com 0 é ignorada na leitura. O PLU do produto precisa caber no número de dígitos do código.",
    usedBy: "PDV (leitura da etiqueta) e Produtos › Balança (conferência do PLU)",
  },
  {
    key: "scale.barcodeContent", group: "Vendas e PDV", label: "Informação na etiqueta da balança", type: "select", scopes: ["company", "branch"], default: SCALE_DEFAULTS.content,
    options: SCALE_CONTENTS.map((c) => ({ value: c.value, label: c.label })),
    help: "“Peso”: a quantidade lançada é o peso da etiqueta (produto em KG) e o total é peso × preço por kg da tabela de preços. “Valor”: a quantidade é o valor da etiqueta ÷ preço da tabela, arredondada ao milésimo; o total segue a regra de arredondamento da venda e pode diferir da etiqueta em alguns centavos quando o preço passa de R$ 9,99 por kg (o PDV mostra o valor calculado).",
    usedBy: "PDV (leitura da etiqueta)",
  },
  {
    key: "feature.kits", group: "Recursos", label: "Kits e composição de produtos", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra a aba “Componentes” no cadastro do produto e Estoque › Montagem e desmembramento. Kit: vendido como um item com preço próprio; na venda o estoque baixa os componentes pelo custo médio (o custo do item vendido é a soma) e o cancelamento ou a devolução devolvem os componentes. Disponível do kit = menor saldo de componente ÷ quantidade por kit. Composto: tem estoque próprio, montado (baixa os componentes, entra pelo custo somado) ou desmembrado (inverso). Na NFC-e/NF-e o kit sai como um único item. Desligado, a aba e a montagem somem e kits não podem ser vendidos; cancelamentos e devoluções de vendas já feitas continuam devolvendo os componentes.",
    usedBy: "Produtos (componentes), PDV (venda de kit), Estoque (montagem)",
  },
  {
    key: "feature.lotes", group: "Recursos", label: "Controle de lotes e validades", type: "bool", scopes: ["company"], default: false,
    help: "Permite marcar produtos com “Controla lote e validade”. Para esses produtos o saldo passa a ser controlado por lote em cada depósito: o recebimento exige o lote (lido do XML — rastro/med — ou digitado na conferência), a venda baixa automaticamente o lote que vence primeiro (FEFO) com opção de escolher o lote no PDV, devolução e cancelamento voltam ao lote de origem, transferência leva os lotes e o inventário pode ser contado por lote. A NF-e/NFC-e leva o rastro (lote, quantidade, fabricação e validade) e a rotina diária avisa lotes vencidos e a vencer. Muda a operação: nasce desligado. Produtos sem a marcação não mudam.",
    usedBy: "Produtos, Compras (conferência), PDV, Estoque (validades, transferências, inventário) e Fiscal (rastro)",
  },
  { key: "stock.lotExpiryAlertDays", group: "Recursos", label: "Antecedência do alerta de validade", help: "Lotes com validade dentro deste número de dias aparecem como “a vencer” no relatório de validades e geram aviso diário (lotes vencidos sempre avisam). 0 = avisar só os vencidos.", type: "int", scopes: ["company"], default: 30, min: 0, max: 365, unit: "dias", usedBy: "Estoque (validades) e rotina diária de alertas" },
  {
    key: "feature.reservaPreVenda", group: "Recursos", label: "Reserva de estoque na pré-venda", type: "bool", scopes: ["company", "branch"], default: false,
    help: "Ao salvar um atendimento como pré-venda (F6), os itens físicos são reservados no depósito do terminal (disponível = físico − reservado), até o disponível. A reserva é consumida na conclusão da venda e liberada no cancelamento do atendimento ou quando a pré-venda expira (validade da pré-venda em “Vendas e PDV”). Muda a operação: nasce desligado.",
    usedBy: "PDV (pré-vendas) e Estoque (disponível)",
  },
  { key: "feature.bipagemContagem", group: "Recursos", label: "Bipagem na contagem do inventário", help: "Mostra o modo “Bipar” na folha de contagem: cada leitura do código de barras (ou do SKU digitado) soma 1 — ou a quantidade informada antes, como 6*789… — ao item lido, com som de confirmação/erro, contagem acumulada e desfazer/corrigir antes de gravar.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Estoque (inventário — folha de contagem)" },
  {
    key: "feature.livroEntradas", group: "Recursos", label: "Livro de entradas e nota de entrada sem estoque", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Fiscal › Livro de entradas: por período, cada documento de entrada (recebimentos de mercadoria concluídos, notas sem estoque, CT-e de frete e NF-e de entrada emitidas pela empresa) com emitente, chave/número/série, CFOP de entrada, valor contábil, base/ICMS, IPI e ICMS-ST do XML, totais por CFOP, impressão e CSV. Permite registrar nota de entrada SEM estoque (serviço tomado, uso e consumo, despesa com nota), que gera só a conta a pagar. Inclui no pacote da contabilidade os XMLs de compra do período (pasta xml-entradas) e o livro de entradas. Desligado, a tela some e o pacote volta a ter só as saídas; nada do que é de saída muda.",
    usedBy: "Fiscal (livro de entradas), Compras (notas sem estoque) e pacote contábil",
  },
  {
    key: "feature.notaAConfirmar", group: "Recursos", label: "Entrada de mercadoria com nota a confirmar", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Permite registrar a ENTRADA de mercadoria que chegou antes da nota fiscal do fornecedor (Receber mercadorias › Nota a confirmar): o estoque entra no depósito escolhido como entrada normal, marcada “aguardando nota”, com conta a pagar provisória. Data/hora futura = entrada PREVISTA (“a chegar”, sem saldo nem custo; conta a pagar prevista), realizada automaticamente na data. Depois, “Confirmar com a nota” (XML ou dados da nota) corrige custo (ajuste de custo médio), quantidade (ajuste ou devolução) e a conta a pagar, e a nota entra no livro de entradas. Toda venda continua com NFC-e/NF-e: não há venda sem documento fiscal nem estoque separado. Desligado, a opção e o painel somem; as entradas já lançadas continuam e podem ser confirmadas pelo recebimento.",
    usedBy: "Compras (recebimento e Compras aguardando nota), Estoque (a chegar), Financeiro (contas a pagar e fluxo previsto) e rotina diária",
  },
  {
    key: "feature.cteEntrada", group: "Recursos", label: "CT-e de entrada (frete de compra)", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Compras › CT-e de frete: importa o XML do CT-e da transportadora (frete por conta da empresa), vincula-o a um ou mais recebimentos (sugeridos pelas NF-e transportadas) e rateia o frete no custo: no recebimento em conferência o frete entra no custo de entrada na conclusão; no já concluído vira ajuste de custo das unidades ainda em estoque. Gera a conta a pagar à transportadora (cadastrada a partir do XML se não existir). Desligado, a tela some e nenhum CT-e novo é lançado; os já lançados são mantidos.",
    usedBy: "Compras (recebimentos e CT-e), Estoque (custo médio) e Financeiro (contas a pagar)",
  },
  {
    key: "feature.exportacaoDominio", group: "Recursos", label: "Exportação de lançamentos para a Domínio", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Financeiro › Exportação Domínio: gera o arquivo texto de lançamentos contábeis (títulos emitidos e baixas do período, por competência ou caixa) no layout de importação da Domínio configurado em Central de integrações › Domínio, usando o código contábil das categorias e contas financeiras. Sem API: o escritório importa o arquivo. Desligado, a tela some.",
    usedBy: "Financeiro (exportação Domínio) e Central de integrações",
  },
  {
    key: "feature.inventarioFiscal", group: "Recursos", label: "Inventário em data-base (inventário fiscal)", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Estoque › Inventário em data-base: o saldo de cada produto por depósito numa data passada (ex.: 31/12), reconstruído dos movimentos de estoque e valorizado pelo custo médio vigente na data, com totais por NCM e categoria, impressão no modelo do Livro de Registro de Inventário e exportação CSV/XLSX. Na data de hoje confere com o saldo atual. Só consulta: nada é gravado. Desligado, a tela e a exportação somem.",
    usedBy: "Estoque (inventário em data-base) e Central de relatórios",
  },
  {
    key: "feature.importacaoCadastros", group: "Recursos", label: "Importação de cadastros e saldos (implantação)", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Administração › Importação: assistente por CSV (modelo para baixar, mapeamento de colunas, prévia linha a linha) para clientes, fornecedores, saldos iniciais de estoque (movimento “Saldo inicial” com custo) e títulos a receber/pagar em aberto. Aplica em lotes de até 100 linhas, com relatório de erros por linha; reimportar o mesmo arquivo não duplica nada. Só administradores importam. Desligado, a tela some; o que já foi importado continua como está.",
    usedBy: "Administração (importação), Clientes, Fornecedores, Estoque e Financeiro",
  },
  { key: "feature.baixaLote", group: "Recursos", label: "Baixa de títulos em lote", help: "Mostra a seleção múltipla de parcelas em Contas a receber e Contas a pagar com “Baixar selecionadas” (prévia por parcela, multa e juros sugeridos opcionais, resultado com o que foi baixado e o que falhou). Desligado, a baixa continua parcela a parcela.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Financeiro (contas a receber e a pagar)" },
  { key: "feature.carne", group: "Recursos", label: "Impressão de carnê", help: "Mostra “Imprimir carnê” no título a receber, na lista de contas a receber e na venda a prazo: uma lâmina por parcela com canhoto (3 por folha A4), multa e juros informativos e Pix copia e cola quando a conta tem chave Pix.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Financeiro (contas a receber) e Vendas (venda a prazo)" },
  {
    key: "feature.taxasCartao", group: "Recursos", label: "Taxas de cartão por bandeira e parcelas e conciliação com a adquirente", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra a tabela de taxas por bandeira × nº de parcelas no cadastro dos meios de cartão (Financeiro › Cadastros › Meios de pagamento) e a conciliação com o arquivo da adquirente (Financeiro › Recebíveis de cartão). Na venda, a taxa e o prazo de recebimento vêm da linha da bandeira/parcelas; sem tabela (ou sem linha para a bandeira) vale a taxa única do meio, como antes. Desligado, a tabela é ignorada na venda e as telas somem; recebíveis já gerados não mudam.",
    usedBy: "PDV (taxa e prazo do recebível de cartão) e Financeiro (cadastros e recebíveis de cartão)",
  },
  {
    key: "feature.dre", group: "Recursos", label: "Relatórios financeiros (DRE gerencial e aging)", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Financeiro › Relatórios financeiros: DRE gerencial por competência (receita bruta, deduções, CMV pelo custo das vendas, despesas por grupo do plano de contas e resultado) e aging de contas a receber e a pagar por faixa de atraso, com impressão e CSV. Somente leitura: não altera nenhum lançamento.",
    usedBy: "Financeiro (relatórios financeiros)",
  },
  {
    key: "feature.fechamentoPeriodo", group: "Recursos", label: "Fechamento de período financeiro", type: "bool", scopes: ["company"], default: false,
    help: "Liga a tela Financeiro › Fechamento de período: com uma data de fechamento definida, lançamentos em conta, baixas, estornos, títulos e alterações de competência com data até o fechamento são recusados no servidor (inclusive vendas, recebimentos e conciliação). Reabrir exige a permissão “Fechar e reabrir período financeiro” e motivo, e fica no histórico. Muda a operação: nasce desligado. Desligado, nenhuma data é verificada.",
    usedBy: "Financeiro (todos os lançamentos, baixas, estornos e títulos), PDV e Compras (conta a pagar do recebimento)",
  },
  {
    key: "feature.comissoes", group: "Recursos", label: "Comissões de vendedores", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Vendas › Comissões: apuração por período, filial e vendedor (prévia por venda, devoluções abatendo a comissão), fechamento que gera a conta a pagar ao vendedor no Financeiro, reabertura enquanto o título estiver em aberto, relatório imprimível e CSV. Desligado, a tela some e nada é apurado; títulos já gerados continuam no Financeiro.",
    usedBy: "Vendas (comissões) e Financeiro (contas a pagar)",
  },
  {
    key: "feature.promocoes", group: "Recursos", label: "Promoções (leve X pague Y, a partir de N unidades, dia da semana)", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Aplica no PDV as promoções cadastradas em Produtos › Promoções: “leve X, pague Y” e “a partir de N unidades, preço Z ou P% de desconto”, por SKU, produto ou categoria, com vigência, dias da semana e horário. A promoção aparece como desconto explícito do item (com o nome da regra no cupom e na venda) e não consome o limite de desconto manual do operador. Desligado, nenhuma promoção é aplicada (a venda volta a ser calculada como antes) e a tela some; vendas já feitas mantêm o desconto registrado.",
    usedBy: "Produtos (promoções), PDV (itens e totais) e Vendas (cupom)",
  },
  {
    key: "feature.fidelidade", group: "Recursos", label: "Programa de fidelidade (pontos)", type: "bool", scopes: ["company", "branch"], default: false,
    help: "Liga o acúmulo de pontos nas vendas com cliente identificado e o resgate de pontos como forma de pagamento no PDV, conforme o grupo “Fidelidade”. Mostra o saldo no cadastro do cliente, no PDV e no cupom. Desligado por padrão porque muda o cupom e o pagamento. Desligado, nada é acumulado nem resgatado; pontos já acumulados ficam guardados (estornos de devolução/cancelamento continuam sendo feitos).",
    usedBy: "PDV (cliente e pagamento), Vendas (cupom, devolução e cancelamento) e Clientes (saldo)",
  },
  {
    key: "feature.reformaTributaria", group: "Recursos", label: "Reforma tributária (IBS, CBS e IS nos documentos fiscais)", type: "bool", scopes: ["company", "branch"], default: false,
    help: "Mostra os campos da reforma tributária (CST e cClassTrib do IBS/CBS, alíquotas de IBS, CBS e IS, vigência) no grupo tributário, no produto e a adesão em Fiscal › Configurações › Tributação padrão. Os grupos IBS/CBS (e IS) só entram na NF-e/NFC-e quando, além deste recurso, a configuração fiscal marca a adesão e a data de início já chegou; ICMS, PIS, COFINS e o total da nota não mudam. Desligado por padrão porque muda o documento fiscal; desligar volta a emitir sem os grupos (os campos cadastrados ficam guardados). Valide a classificação com a contabilidade e em homologação.",
    usedBy: "Produtos (grupo tributário e aba Fiscal), Fiscal (configuração, NF-e e NFC-e)",
  },
  {
    key: "feature.tributacaoCompleta", group: "Recursos", label: "Tributação completa (ST/MVA, alíquota interestadual, FCP e DIFAL)", type: "bool", scopes: ["company", "branch"], default: false,
    help: "Liga o cálculo completo do ICMS no regime normal: ICMS próprio também nos CST 10 e 70, alíquota interestadual de 4%, 7% ou 12% conforme as UFs e a origem da mercadoria (4% para importados), ICMS-ST com MVA original (interna) ou ajustada (interestadual), FCP e FCP-ST, DIFAL na venda interestadual a consumidor final não contribuinte (por fora ou por dentro, por UF) e, se marcado em Fiscal › Configurações › Operações, a base do PIS/COFINS sem o ICMS. Mostra os campos de MVA, ST e alíquotas por UF no grupo tributário. Desligado por padrão porque muda os valores das notas; desligar volta ao cálculo anterior (os campos ficam guardados; documentos já montados mantêm o cálculo até “Atualizar do cadastro”). Valide com a contabilidade e emita primeiro em homologação.",
    usedBy: "Produtos (grupo tributário), Fiscal (configurações, NF-e) e NFC-e (ICMS próprio)",
  },
  {
    key: "feature.naturezasOperacao", group: "Recursos", label: "Naturezas de operação cadastradas (CFOP e CST por natureza)", type: "bool", scopes: ["company", "branch"], default: false,
    help: "Mostra a tabela de naturezas de operação (venda, devolução, remessa para conserto, demonstração, bonificação, transferência, consignação…) em Fiscal › Configurações › Operações e a escolha da natureza no assistente da NF-e: a natureza define o CFOP interno/interestadual e o CST/CSOSN padrão dos itens, ou aplica o grupo tributário dedicado a ela. Desligado, a natureza continua texto livre e o CFOP vem do grupo do produto, como antes.",
    usedBy: "Fiscal (configurações e assistente da NF-e), Produtos (grupo tributário)",
  },
  {
    key: "feature.creditoSimples", group: "Recursos", label: "Crédito de ICMS do Simples Nacional (CSOSN 101/201)", type: "bool", scopes: ["company"], default: false,
    help: "Para empresa do Simples Nacional: informa nos itens com CSOSN 101 e 201 da NF-e o percentual (pCredSN) e o valor do crédito (vCredICMSSN) e acrescenta a mensagem obrigatória do art. 23 da LC 123/2006 nas informações complementares. O percentual (alíquota do Anexo na faixa do mês anterior) é informado em Fiscal › Configurações › Operações. Desligado, a NF-e sai como antes.",
    usedBy: "Fiscal (configurações e NF-e)",
  },
  { key: "loyalty.pointsPerReal", group: "Fidelidade", label: "Pontos por R$ 1,00", help: "Pontos ganhos a cada R$ 1,00 do total da venda identificada (sem contar o que foi pago com pontos), arredondado para baixo. Ex.: 1 ponto por real numa venda de R$ 59,90 = 59 pontos. 0 = não acumula.", type: "int", scopes: ["company"], default: 1, min: 0, max: 1000, unit: "pontos", usedBy: "Vendas (acúmulo de pontos)" },
  { key: "loyalty.pointValue", group: "Fidelidade", label: "Valor de 1 ponto no resgate", help: "Quanto cada ponto vale como pagamento no PDV. Ex.: R$ 0,01 por ponto com 1 ponto por real = 1% de retorno.", type: "money", scopes: ["company"], default: 1, min: 1, usedBy: "PDV (resgate de pontos)" },
  { key: "loyalty.validityDays", group: "Fidelidade", label: "Validade dos pontos", help: "Dias corridos, a partir da venda que gerou os pontos, até eles vencerem. Pontos vencidos deixam de contar no saldo e não podem ser resgatados. 0 = não vencem. Vale para os pontos acumulados depois da alteração.", type: "int", scopes: ["company"], default: 365, min: 0, max: 3650, unit: "dias", usedBy: "Vendas (acúmulo) e PDV (saldo e resgate)" },
  { key: "loyalty.minRedeemPoints", group: "Fidelidade", label: "Mínimo de pontos por resgate", help: "Menor quantidade de pontos aceita num pagamento com pontos.", type: "int", scopes: ["company"], default: 100, min: 1, max: 10000000, unit: "pontos", usedBy: "PDV (resgate de pontos)" },
  {
    key: "commission.base", group: "Vendas e PDV", label: "Base de cálculo da comissão", type: "select", scopes: ["company", "branch"], default: "invoiced",
    help: "“Venda faturada”: a comissão nasce na data da venda concluída, sobre o valor líquido dos itens (após descontos, sem acréscimos), e devoluções no período abatem a comissão da venda devolvida na proporção da quantidade devolvida. “Valor recebido”: a comissão nasce quando o dinheiro entra — à vista na data da venda e, a prazo, conforme as parcelas recebidas no período; devoluções abatem a parte reembolsada ao cliente. Vendas canceladas nunca contam (se já estavam em um fechamento, a comissão é estornada no período do cancelamento). Troque o critério só na virada de um período já fechado.",
    options: [{ value: "invoiced", label: "Venda faturada (líquida de descontos)" }, { value: "received", label: "Valor recebido" }], usedBy: "Vendas (comissões)",
  },
  {
    key: "finance.dueDateNonBusinessDay", group: "Financeiro", label: "Vencimento em dia não útil", type: "select", scopes: ["company", "branch"], default: "keep",
    help: "Ao gerar parcelas por condição de pagamento (venda a prazo no PDV e lançamento manual de títulos), o vencimento que cair em sábado, domingo ou feriado nacional de data fixa pode ser levado ao próximo dia útil. Feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi), estaduais e municipais não são considerados. Não altera parcelas já geradas.",
    options: [{ value: "keep", label: "Manter a data gerada" }, { value: "next", label: "Levar para o próximo dia útil" }], usedBy: "PDV (venda a prazo) e Financeiro (novo título)",
  },
  { key: "users.inviteExpiryDays", group: "Usuários", label: "Validade do convite de primeiro acesso", help: "Depois deste prazo o link de convite deixa de funcionar e precisa ser reenviado.", type: "int", scopes: ["company"], default: 7, min: 1, max: 30, unit: "dias", usedBy: "Usuários e permissões (convites)" },
  {
    key: "timezone", group: "Regional", label: "Fuso horário", type: "timezone", scopes: ["company"], default: "America/Sao_Paulo", installation: true,
    help: "Único para toda a instalação (todas as empresas e filiais): define o dia de cada movimento nos recortes de período, o horário das rotinas e a agenda de backup. Para alterar, o responsável técnico define a variável de ambiente APP_TIMEZONE no servidor (ex.: America/Manaus) e reinicia a aplicação.",
    usedBy: "Relatórios, rotinas e backup (toda a instalação)",
  },
];

export const PARAM_MAP: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.key, p]));

export const BACKUP_FREQUENCIES = [
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanalmente" },
  { value: "monthly", label: "Mensalmente (dia 1)" },
];

export const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function describeSchedule(s: { enabled?: boolean; frequency?: string; time?: string; weekday?: number }) {
  if (!s.enabled) return "Cópia automática desligada";
  const f = s.frequency === "weekly" ? `Semanalmente (${WEEKDAYS[s.weekday ?? 0].toLowerCase()})` : s.frequency === "monthly" ? "Mensalmente (dia 1)" : "Diariamente";
  return `${f} às ${s.time ?? "02:00"}`;
}
