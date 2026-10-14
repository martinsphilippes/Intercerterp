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

export const PARAM_GROUPS = ["Vendas e PDV", "Caixa", "Estoque e reposição", "Curva ABC", "Compras", "Financeiro", "Notificações", "Usuários", "Regional", "Recursos"];

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
  { key: "feature.baixaLote", group: "Recursos", label: "Baixa de títulos em lote", help: "Mostra a seleção múltipla de parcelas em Contas a receber e Contas a pagar com “Baixar selecionadas” (prévia por parcela, multa e juros sugeridos opcionais, resultado com o que foi baixado e o que falhou). Desligado, a baixa continua parcela a parcela.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Financeiro (contas a receber e a pagar)" },
  { key: "feature.carne", group: "Recursos", label: "Impressão de carnê", help: "Mostra “Imprimir carnê” no título a receber, na lista de contas a receber e na venda a prazo: uma lâmina por parcela com canhoto (3 por folha A4), multa e juros informativos e Pix copia e cola quando a conta tem chave Pix.", type: "bool", scopes: ["company", "branch"], default: true, usedBy: "Financeiro (contas a receber) e Vendas (venda a prazo)" },
  {
    key: "feature.comissoes", group: "Recursos", label: "Comissões de vendedores", type: "bool", scopes: ["company", "branch"], default: true,
    help: "Mostra Vendas › Comissões: apuração por período, filial e vendedor (prévia por venda, devoluções abatendo a comissão), fechamento que gera a conta a pagar ao vendedor no Financeiro, reabertura enquanto o título estiver em aberto, relatório imprimível e CSV. Desligado, a tela some e nada é apurado; títulos já gerados continuam no Financeiro.",
    usedBy: "Vendas (comissões) e Financeiro (contas a pagar)",
  },
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
