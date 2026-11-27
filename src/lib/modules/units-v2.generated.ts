// GERADO por scripts/modules/build-catalog-v2.ts — não edite. Catálogo 2.0.0-proposta.
export const CATALOG_V2_VERSION = "2.0.0-proposta";
export interface UnitV2 { code: string; name: string; slug: string; v1Key: string | null; devStatus: string; sellable: boolean; includedInParent: boolean; companyKinds: string[]; requires: string[]; requiresAny: string[][] }
export const UNITS_V2: UnitV2[] = [
 {
  "code": "01.02",
  "name": "Cadastro de clientes",
  "slug": "cadastros.cadastro_clientes",
  "v1Key": "cadastros.clientes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "01.03",
  "name": "Cadastro de fornecedores",
  "slug": "cadastros.cadastro_fornecedores",
  "v1Key": "cadastros.fornecedores",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "01.04",
  "name": "Cadastro de produtos",
  "slug": "cadastros.cadastro_produtos",
  "v1Key": "cadastros.produtos",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "02.09",
  "name": "Substituição tributária",
  "slug": "fiscal_config.substituicao_tributaria",
  "v1Key": "fiscal.tributacao_avancada",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": [
   [
    "04.01",
    "04.02"
   ]
  ]
 },
 {
  "code": "02.14",
  "name": "Configuração IBS e CBS",
  "slug": "fiscal_config.configuracao_ibs_cbs",
  "v1Key": "fiscal.reforma_tributaria",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": [
   [
    "04.01",
    "04.02"
   ]
  ]
 },
 {
  "code": "03.13",
  "name": "Importação de CT-e recebido",
  "slug": "fiscal_entrada.importacao_ct_recebido",
  "v1Key": "compras.cte",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "05.06"
  ],
  "requiresAny": []
 },
 {
  "code": "04.01",
  "name": "Emissão de NF-e",
  "slug": "fiscal_emissao.emissao_nf",
  "v1Key": "fiscal.nfe",
  "devStatus": "EXT",
  "sellable": false,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "04.02",
  "name": "Emissão de NFC-e",
  "slug": "fiscal_emissao.emissao_nfc",
  "v1Key": "fiscal.nfce",
  "devStatus": "EXT",
  "sellable": false,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "04.03",
  "name": "Emissão de NFS-e",
  "slug": "fiscal_emissao.emissao_nfs",
  "v1Key": "fiscal.nfse",
  "devStatus": "EXT",
  "sellable": false,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "05.02",
  "name": "Cotação com fornecedores",
  "slug": "compras.cotacao_fornecedores",
  "v1Key": "compras.cotacoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "05.04"
  ],
  "requiresAny": []
 },
 {
  "code": "05.04",
  "name": "Pedido de compra",
  "slug": "compras.pedido_compra",
  "v1Key": "compras.pedidos",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.03",
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "05.05",
  "name": "Aprovação de compras",
  "slug": "compras.aprovacao_compras",
  "v1Key": "compras.aprovacoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "05.04"
  ],
  "requiresAny": []
 },
 {
  "code": "05.06",
  "name": "Recebimento de mercadorias",
  "slug": "compras.recebimento_mercadorias",
  "v1Key": "compras.recebimento",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.03",
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "05.08",
  "name": "Sugestão de reposição",
  "slug": "compras.sugestao_reposicao",
  "v1Key": "compras.reposicao",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "05.19",
  "name": "Entrada de mercadoria com nota a confirmar",
  "slug": "compras.entrada_mercadoria_nota_confirmar",
  "v1Key": "compras.nota_a_confirmar",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "05.06"
  ],
  "requiresAny": []
 },
 {
  "code": "05.20",
  "name": "Precificação após a entrada",
  "slug": "compras.precificacao_apos_entrada",
  "v1Key": "compras.precificacao",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "05.06"
  ],
  "requiresAny": []
 },
 {
  "code": "06.01",
  "name": "Orçamentos",
  "slug": "vendas.orcamentos",
  "v1Key": "vendas.documentos",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "06.09",
  "name": "Reserva de mercadorias",
  "slug": "vendas.reserva_mercadorias",
  "v1Key": "pdv.reserva_prevenda",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "07.01"
  ],
  "requiresAny": []
 },
 {
  "code": "06.12",
  "name": "Comissões de vendedores",
  "slug": "vendas.comissoes_vendedores",
  "v1Key": "vendas.comissoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": [
   [
    "06.01",
    "07.01",
    "12.01"
   ]
  ]
 },
 {
  "code": "06.13",
  "name": "Metas comerciais",
  "slug": "vendas.metas_comerciais",
  "v1Key": "gestao.metas",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "07.01",
  "name": "Frente de caixa",
  "slug": "pdv.frente_caixa",
  "v1Key": "vendas.pdv",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04",
   "07.02"
  ],
  "requiresAny": []
 },
 {
  "code": "07.02",
  "name": "Abertura de caixa",
  "slug": "pdv.abertura_caixa",
  "v1Key": "caixa.operacao",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "07.27",
  "name": "Recebimento de parcelas do crediário no PDV",
  "slug": "pdv.recebimento_parcelas_crediario_pdv",
  "v1Key": "pdv.recebimento_crediario",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "07.01",
   "18.02"
  ],
  "requiresAny": []
 },
 {
  "code": "08.04",
  "name": "Devolução de produto",
  "slug": "trocas.devolucao_produto",
  "v1Key": "vendas.devolucoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "07.01"
  ],
  "requiresAny": []
 },
 {
  "code": "09.13",
  "name": "Etiquetas de produtos",
  "slug": "produtos.etiquetas_produtos",
  "v1Key": "produtos.etiquetas",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "09.22",
  "name": "Cadastro em massa",
  "slug": "produtos.cadastro_massa",
  "v1Key": "produtos.alteracao_massa",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "10.01",
  "name": "Saldo de estoque",
  "slug": "estoque.saldo_estoque",
  "v1Key": "estoque.gestao",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "10.05",
  "name": "Transferência entre estoques",
  "slug": "estoque.transferencia_entre_estoques",
  "v1Key": "estoque.transferencias",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "10.01"
  ],
  "requiresAny": []
 },
 {
  "code": "10.09",
  "name": "Inventário",
  "slug": "estoque.inventario",
  "v1Key": "estoque.inventario",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "10.01"
  ],
  "requiresAny": []
 },
 {
  "code": "10.10",
  "name": "Controle de lotes",
  "slug": "estoque.controle_lotes",
  "v1Key": "estoque.lotes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "10.01"
  ],
  "requiresAny": []
 },
 {
  "code": "10.17",
  "name": "Curva ABC",
  "slug": "estoque.curva_abc",
  "v1Key": "relatorios.curva_abc",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "10.32",
  "name": "Inventário em data-base (inventário fiscal) por NCM",
  "slug": "estoque.inventario_data_base_inventario_fiscal_ncm",
  "v1Key": "estoque.inventario_fiscal",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "10.01"
  ],
  "requiresAny": []
 },
 {
  "code": "12.01",
  "name": "Loja virtual",
  "slug": "ecommerce.loja_virtual",
  "v1Key": "ecommerce.loja",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04",
   "04.01"
  ],
  "requiresAny": []
 },
 {
  "code": "12.09",
  "name": "Cupons promocionais",
  "slug": "ecommerce.cupons_promocionais",
  "v1Key": "ecommerce.promocoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "12.01"
  ],
  "requiresAny": []
 },
 {
  "code": "15.01",
  "name": "Composição de produtos",
  "slug": "composicao.composicao_produtos",
  "v1Key": "produtos.kits",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "18.01",
  "name": "Contas a pagar",
  "slug": "financeiro.contas_pagar",
  "v1Key": "financeiro.contas_pagar",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "18.02",
  "name": "Contas a receber",
  "slug": "financeiro.contas_receber",
  "v1Key": "financeiro.contas_receber",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "18.03",
  "name": "Fluxo de caixa",
  "slug": "financeiro.fluxo_caixa",
  "v1Key": "financeiro.fluxo_caixa",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "18.10",
  "name": "Conciliação bancária",
  "slug": "financeiro.conciliacao_bancaria",
  "v1Key": "financeiro.conciliacao",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "18.11",
  "name": "Conciliação de cartões",
  "slug": "financeiro.conciliacao_cartoes",
  "v1Key": "financeiro.taxas_adquirente",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "18.44"
  ],
  "requiresAny": []
 },
 {
  "code": "18.13",
  "name": "Inadimplência",
  "slug": "financeiro.inadimplencia",
  "v1Key": "financeiro.inadimplencia",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "18.02"
  ],
  "requiresAny": []
 },
 {
  "code": "18.18",
  "name": "DRE gerencial",
  "slug": "financeiro.dre_gerencial",
  "v1Key": "financeiro.relatorios",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "18.22",
  "name": "Fechamento consolidado",
  "slug": "financeiro.fechamento_consolidado",
  "v1Key": "financeiro.fechamento_periodo",
  "devStatus": "PARC",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "18.03"
  ],
  "requiresAny": []
 },
 {
  "code": "18.41",
  "name": "Cobrança pelo WhatsApp com modelos de mensagem",
  "slug": "financeiro.cobranca_pelo_whatsapp_modelos_mensagem",
  "v1Key": "financeiro.cobranca_whatsapp",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "18.02"
  ],
  "requiresAny": []
 },
 {
  "code": "18.42",
  "name": "Impressão de carnê",
  "slug": "financeiro.impressao_carne",
  "v1Key": "financeiro.carne",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "18.02"
  ],
  "requiresAny": []
 },
 {
  "code": "18.43",
  "name": "Baixa de títulos em lote",
  "slug": "financeiro.baixa_titulos_lote",
  "v1Key": "financeiro.baixa_lote",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "18.02"
  ],
  "requiresAny": []
 },
 {
  "code": "18.44",
  "name": "Recebíveis de cartão das vendas",
  "slug": "financeiro.recebiveis_cartao_vendas",
  "v1Key": "financeiro.cartoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "20.03",
  "name": "Programa de fidelidade",
  "slug": "crm.programa_fidelidade",
  "v1Key": "clientes.fidelidade",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.02",
   "07.01"
  ],
  "requiresAny": []
 },
 {
  "code": "21.02",
  "name": "Relatórios de vendas",
  "slug": "bi.relatorios_vendas",
  "v1Key": "relatorios.gerenciais",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "22.02",
  "name": "SPED Fiscal",
  "slug": "contabil.sped_fiscal",
  "v1Key": "fiscal.sped",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "22.05",
  "name": "Livros fiscais",
  "slug": "contabil.livros_fiscais",
  "v1Key": "fiscal.livro_entradas",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "22.07",
  "name": "Integração contábil",
  "slug": "contabil.integracao_contabil",
  "v1Key": "integracao.contabilidade",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "22.21",
  "name": "Exportação de lançamentos para a Domínio",
  "slug": "contabil.exportacao_lancamentos_dominio",
  "v1Key": "financeiro.exportacao_dominio",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": [
   [
    "18.01",
    "18.02"
   ]
  ]
 },
 {
  "code": "22.22",
  "name": "Sintegra",
  "slug": "contabil.sintegra",
  "v1Key": "fiscal.sintegra",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "24.13",
  "name": "Importação de dados",
  "slug": "admin.importacao_dados",
  "v1Key": "implantacao.importacao",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "25.01",
  "name": "Promoção por produto",
  "slug": "precificacao.promocao_produto",
  "v1Key": "produtos.promocoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "35.18",
  "name": "Hub multicanal",
  "slug": "marketplaces.hub_multicanal",
  "v1Key": "ecommerce.canais",
  "devStatus": "DEV",
  "sellable": false,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "12.01"
  ],
  "requiresAny": []
 },
 {
  "code": "36.17",
  "name": "Banco Intercert: conciliação do gateway e repasses",
  "slug": "pagamentos.banco_intercert_conciliacao_gateway_repasses",
  "v1Key": "ecommerce.banco",
  "devStatus": "EXT",
  "sellable": false,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "12.01"
  ],
  "requiresAny": []
 },
 {
  "code": "46.01",
  "name": "Integração com balanças etiquetadoras",
  "slug": "supermercado.integracao_balancas_etiquetadoras",
  "v1Key": "produtos.balanca",
  "devStatus": "PARC",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "retail"
  ],
  "requires": [
   "01.04"
  ],
  "requiresAny": []
 },
 {
  "code": "48.06",
  "name": "Gestão de solicitações de certificados",
  "slug": "certificacao.gestao_solicitacoes_certificados",
  "v1Key": "contabil.certificados",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting"
  ],
  "requires": [
   "51.01"
  ],
  "requiresAny": []
 },
 {
  "code": "51.01",
  "name": "Clientes contábeis (PF/PJ, sócios, estabelecimentos, regime com vigência)",
  "slug": "escritorio_contabil.clientes_contabeis_pf_pj_socios_estabelecimentos_regime_vige",
  "v1Key": "contabil.carteira",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "51.04",
  "name": "Caixa de entrada de entregas (pacote mensal de XML)",
  "slug": "escritorio_contabil.caixa_entrada_entregas_pacote_mensal_xml",
  "v1Key": "contabil.entregas",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting"
  ],
  "requires": [
   "51.01"
  ],
  "requiresAny": []
 },
 {
  "code": "52.01",
  "name": "Hierarquia de parceiros da rede",
  "slug": "rede_certificacao.hierarquia_parceiros_rede",
  "v1Key": "rede.parceiro",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": true,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [],
  "requiresAny": []
 },
 {
  "code": "52.03",
  "name": "Vendas de certificados pela rede",
  "slug": "rede_certificacao.vendas_certificados_pela_rede",
  "v1Key": "rede.vendas",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "52.01"
  ],
  "requiresAny": []
 },
 {
  "code": "52.04",
  "name": "Vouchers de certificado",
  "slug": "rede_certificacao.vouchers_certificado",
  "v1Key": "rede.vouchers_cupons",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "52.03"
  ],
  "requiresAny": []
 },
 {
  "code": "52.06",
  "name": "Renovações de certificados",
  "slug": "rede_certificacao.renovacoes_certificados",
  "v1Key": "rede.renovacoes",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "52.01"
  ],
  "requiresAny": []
 },
 {
  "code": "52.07",
  "name": "Financeiro em camadas da rede (pré/pós-pago, carteira, fechamentos)",
  "slug": "rede_certificacao.financeiro_camadas_rede_pre_pos_pago_carteira_fechamentos",
  "v1Key": "rede.financeiro",
  "devStatus": "OP",
  "sellable": true,
  "includedInParent": false,
  "companyKinds": [
   "accounting",
   "certification",
   "retail"
  ],
  "requires": [
   "52.01"
  ],
  "requiresAny": []
 }
];
export const ALIAS_OF: Record<string, string> = {"05.13":"27.09","07.07":"46.01","07.13":"36.04","08.03":"08.02","08.07":"18.23","09.02":"09.04","09.03":"09.04","09.06":"46.02","10.28":"05.08","11.18":"12.24","12.06":"36.01","12.07":"36.04","12.08":"36.03","12.33":"08.14","14.14":"09.09","14.19":"15.03","14.21":"15.09","20.09":"12.23","23.04":"46.01","25.13":"09.22","26.01":"01.05","32.11":"27.13","33.06":"27.03","34.06":"10.05","37.03":"17.13","37.04":"14.05","37.07":"26.10","37.08":"05.18","37.09":"22.08","43.12":"06.13","46.10":"09.13","48.01":"02.12","48.02":"02.12","50.06":"01.19","50.10":"24.24","50.13":"24.09","50.15":"12.24"};
export const INCLUDED_IN: Record<string, string> = {"01.05":"01.04","01.06":"01.04","01.07":"01.04","01.08":"01.04","01.09":"06.12","01.10":"01.03","01.14":"06.12","01.17":"01.02","01.18":"01.02","01.21":"01.02","02.01":"01.04","02.10":"02.09","02.13":"02.09","02.16":"02.09","02.17":"02.09","02.18":"04.03","02.19":"02.09","02.20":"04.03","02.21":"02.09","02.22":"01.04","03.01":"05.06","03.02":"05.06","03.03":"05.06","03.05":"05.06","03.06":"05.06","03.07":"05.06","03.08":"05.06","03.09":"05.06","03.10":"05.06","03.11":"22.05","03.12":"05.06","03.14":"22.05","03.15":"05.06","03.16":"22.05","03.17":"05.06","03.18":"05.06","04.06":"04.01","04.07":"04.01","04.08":"04.01","04.15":"04.01","04.16":"04.01","05.01":"05.05","05.03":"05.02","05.07":"05.04","05.09":"05.04","05.10":"05.06","05.14":"01.03","05.15":"05.04","05.16":"05.04","05.21":"05.05","05.22":"05.04","06.02":"06.01","06.03":"06.01","06.04":"06.01","06.05":"06.01","06.06":"06.01","06.07":"07.01","06.08":"06.01","06.10":"07.01","06.14":"07.01","06.15":"06.01","06.16":"06.01","06.18":"07.01","06.19":"02.09","06.21":"06.12","06.22":"01.02","06.23":"07.01","06.25":"12.01","07.03":"07.02","07.04":"07.02","07.05":"07.02","07.06":"07.01","07.08":"07.01","07.09":"07.01","07.10":"07.01","07.11":"07.01","07.14":"07.01","07.15":"07.02","07.16":"07.01","07.17":"07.02","07.19":"07.02","07.20":"07.01","07.21":"07.01","07.22":"07.01","07.24":"07.01","07.25":"07.02","07.26":"07.02","07.28":"07.01","08.01":"08.04","08.02":"08.04","08.05":"08.04","08.06":"08.04","08.08":"08.04","08.09":"08.04","08.10":"08.04","08.11":"08.04","08.12":"08.04","08.13":"08.04","08.14":"12.01","08.16":"08.04","09.01":"01.04","09.04":"01.04","09.05":"01.04","09.07":"01.04","09.08":"15.01","09.09":"15.01","09.10":"15.01","09.12":"01.04","09.14":"05.20","09.18":"01.04","09.19":"01.04","09.20":"01.04","09.21":"01.04","09.23":"01.04","10.02":"10.01","10.03":"10.01","10.04":"10.01","10.06":"10.01","10.07":"10.01","10.08":"10.01","10.11":"10.10","10.14":"10.01","10.15":"10.01","10.16":"10.01","10.18":"05.08","10.19":"10.01","10.20":"12.01","10.21":"10.05","10.24":"10.01","10.25":"10.09","10.26":"10.10","10.27":"10.32","10.29":"10.10","10.30":"05.08","11.01":"12.01","11.03":"12.01","11.04":"12.01","11.05":"12.01","11.06":"12.01","11.07":"12.01","11.09":"12.01","11.11":"12.01","11.12":"12.01","12.02":"12.01","12.03":"12.01","12.04":"12.01","12.05":"12.01","12.10":"12.01","12.11":"12.01","12.12":"12.01","12.13":"12.01","12.14":"04.01","12.15":"12.01","12.16":"12.01","12.18":"12.01","12.23":"12.09","12.24":"12.01","12.25":"12.01","12.26":"12.01","12.27":"12.01","12.29":"12.01","12.31":"12.01","12.32":"12.01","13.05":"06.01","13.06":"18.41","13.07":"07.01","13.09":"07.01","13.10":"18.41","13.16":"18.41","14.04":"07.01","14.07":"12.01","14.08":"12.01","14.20":"15.01","14.29":"46.01","15.02":"01.04","15.03":"15.01","15.04":"15.01","15.05":"15.01","15.06":"15.01","15.07":"15.01","15.08":"15.01","15.09":"15.01","15.10":"15.01","15.13":"01.04","15.16":"15.01","15.19":"15.01","16.15":"15.01","16.16":"15.01","16.18":"15.01","17.01":"12.01","17.02":"12.01","17.07":"12.01","17.08":"12.01","17.09":"12.01","17.14":"12.01","17.15":"12.01","17.16":"12.01","17.19":"12.01","17.20":"12.01","17.21":"12.01","17.27":"03.13","18.08":"18.02","18.09":"18.10","18.14":"18.02","18.15":"18.02","18.19":"18.01","18.20":"18.02","18.21":"18.03","18.23":"08.04","18.24":"01.02","18.25":"07.01","18.26":"52.07","18.27":"08.04","18.29":"18.01","18.36":"18.03","18.37":"18.18","18.38":"18.18","18.45":"18.18","18.46":"18.02","19.05":"18.10","19.07":"18.10","19.08":"18.10","19.09":"18.10","19.13":"18.10","19.14":"18.10","19.15":"18.02","19.19":"18.43","19.20":"36.17","19.24":"12.01","20.01":"01.02","20.02":"01.02","20.04":"20.03","20.07":"25.01","20.10":"01.02","20.15":"52.06","20.18":"01.02","20.19":"01.02","20.20":"52.07","20.22":"52.04","21.03":"05.04","21.04":"18.18","21.06":"10.01","21.08":"12.01","21.09":"07.02","21.10":"12.01","21.11":"10.17","21.12":"06.12","21.13":"21.02","21.20":"18.18","21.22":"01.02","21.23":"05.08","21.24":"06.13","22.01":"22.07","22.03":"22.02","22.04":"22.02","22.08":"51.04","22.10":"22.21","22.17":"04.03","22.19":"18.22","23.01":"07.01","23.02":"09.13","23.03":"07.01","23.07":"07.01","23.09":"10.09","23.15":"07.01","23.16":"07.01","24.09":"05.05","24.12":"12.01","24.15":"51.01","24.21":"12.01","24.22":"01.02","24.25":"22.07","25.02":"25.01","25.03":"25.01","25.05":"25.01","25.10":"12.01","25.12":"25.01","25.14":"05.20","25.15":"05.20","26.03":"06.01","26.04":"06.01","26.15":"04.03","31.02":"51.01","32.03":"51.01","32.07":"05.05","33.05":"51.04","33.08":"06.01","33.11":"18.41","34.03":"21.02","34.04":"18.03","34.05":"10.01","34.13":"51.01","34.14":"52.01","35.15":"18.11","35.17":"12.01","36.01":"12.01","36.02":"48.06","36.03":"07.01","36.07":"52.07","36.11":"18.11","36.13":"18.11","36.14":"18.44","37.06":"12.01","37.13":"10.09","37.14":"12.01","38.01":"18.02","38.03":"05.04","38.04":"05.08","38.05":"22.07","38.11":"05.08","38.12":"05.08","38.13":"05.20","39.01":"05.06","39.14":"10.10","40.15":"03.13","41.01":"10.01","41.02":"10.01","41.06":"12.01","41.07":"12.01","41.13":"10.09","41.16":"12.01","41.17":"12.01","43.08":"06.12","43.09":"06.12","43.10":"06.12","45.08":"08.04","46.02":"46.01","46.03":"10.10","46.07":"15.01","46.08":"01.04","46.09":"10.01","46.12":"25.01","47.03":"01.04","47.04":"05.04","47.05":"07.01","47.06":"05.08","47.07":"10.05","47.08":"10.09","47.11":"09.13","48.03":"48.06","48.07":"52.06","48.08":"48.06","48.09":"48.06","48.11":"48.06","50.01":"12.01","50.04":"18.41","50.09":"01.04","51.02":"51.01","51.03":"51.01","51.05":"22.07","51.06":"51.01","52.02":"52.01","52.05":"52.04"};
export const KNOWN_CODES: string[] = ["01","01.01","01.02","01.03","01.04","01.05","01.06","01.07","01.08","01.09","01.10","01.11","01.12","01.13","01.14","01.15","01.16","01.17","01.18","01.19","01.20","01.21","02","02.01","02.02","02.03","02.04","02.05","02.06","02.07","02.08","02.09","02.10","02.11","02.12","02.13","02.14","02.15","02.16","02.17","02.18","02.19","02.20","02.21","02.22","02.23","02.24","02.25","03","03.01","03.02","03.03","03.04","03.05","03.06","03.07","03.08","03.09","03.10","03.11","03.12","03.13","03.14","03.15","03.16","03.17","03.18","04","04.01","04.02","04.03","04.04","04.05","04.06","04.07","04.08","04.09","04.10","04.11","04.12","04.13","04.14","04.15","04.16","04.17","04.18","04.19","04.20","04.21","04.22","04.23","04.24","04.25","04.26","05","05.01","05.02","05.03","05.04","05.05","05.06","05.07","05.08","05.09","05.10","05.11","05.12","05.13","05.14","05.15","05.16","05.17","05.18","05.19","05.20","05.21","05.22","06","06.01","06.02","06.03","06.04","06.05","06.06","06.07","06.08","06.09","06.10","06.11","06.12","06.13","06.14","06.15","06.16","06.17","06.18","06.19","06.20","06.21","06.22","06.23","06.24","06.25","07","07.01","07.02","07.03","07.04","07.05","07.06","07.07","07.08","07.09","07.10","07.11","07.12","07.13","07.14","07.15","07.16","07.17","07.18","07.19","07.20","07.21","07.22","07.23","07.24","07.25","07.26","07.27","07.28","08","08.01","08.02","08.03","08.04","08.05","08.06","08.07","08.08","08.09","08.10","08.11","08.12","08.13","08.14","08.15","08.16","09","09.01","09.02","09.03","09.04","09.05","09.06","09.07","09.08","09.09","09.10","09.11","09.12","09.13","09.14","09.15","09.16","09.17","09.18","09.19","09.20","09.21","09.22","09.23","09.24","10","10.01","10.02","10.03","10.04","10.05","10.06","10.07","10.08","10.09","10.10","10.11","10.12","10.13","10.14","10.15","10.16","10.17","10.18","10.19","10.20","10.21","10.22","10.23","10.24","10.25","10.26","10.27","10.28","10.29","10.30","10.31","10.32","11","11.01","11.02","11.03","11.04","11.05","11.06","11.07","11.08","11.09","11.10","11.11","11.12","11.13","11.14","11.15","11.16","11.17","11.18","11.19","11.20","12","12.01","12.02","12.03","12.04","12.05","12.06","12.07","12.08","12.09","12.10","12.11","12.12","12.13","12.14","12.15","12.16","12.17","12.18","12.19","12.20","12.21","12.22","12.23","12.24","12.25","12.26","12.27","12.28","12.29","12.30","12.31","12.32","12.33","13","13.01","13.02","13.03","13.04","13.05","13.06","13.07","13.08","13.09","13.10","13.11","13.12","13.13","13.14","13.15","13.16","13.17","13.18","13.19","13.20","14","14.01","14.02","14.03","14.04","14.05","14.06","14.07","14.08","14.09","14.10","14.11","14.12","14.13","14.14","14.15","14.16","14.17","14.18","14.19","14.20","14.21","14.22","14.23","14.24","14.25","14.26","14.27","14.28","14.29","14.30","14.31","14.32","14.33","14.34","14.35","15","15.01","15.02","15.03","15.04","15.05","15.06","15.07","15.08","15.09","15.10","15.11","15.12","15.13","15.14","15.15","15.16","15.17","15.18","15.19","15.20","16","16.01","16.02","16.03","16.04","16.05","16.06","16.07","16.08","16.09","16.10","16.11","16.12","16.13","16.14","16.15","16.16","16.17","16.18","16.19","16.20","16.21","16.22","16.23","16.24","16.25","16.26","16.27","16.28","16.29","16.30","17","17.01","17.02","17.03","17.04","17.05","17.06","17.07","17.08","17.09","17.10","17.11","17.12","17.13","17.14","17.15","17.16","17.17","17.18","17.19","17.20","17.21","17.22","17.23","17.24","17.25","17.26","17.27","17.28","17.29","17.30","18","18.01","18.02","18.03","18.04","18.05","18.06","18.07","18.08","18.09","18.10","18.11","18.12","18.13","18.14","18.15","18.16","18.17","18.18","18.19","18.20","18.21","18.22","18.23","18.24","18.25","18.26","18.27","18.28","18.29","18.30","18.31","18.32","18.33","18.34","18.35","18.36","18.37","18.38","18.39","18.40","18.41","18.42","18.43","18.44","18.45","18.46","19","19.01","19.02","19.03","19.04","19.05","19.06","19.07","19.08","19.09","19.10","19.11","19.12","19.13","19.14","19.15","19.16","19.17","19.18","19.19","19.20","19.21","19.22","19.23","19.24","19.25","20","20.01","20.02","20.03","20.04","20.05","20.06","20.07","20.08","20.09","20.10","20.11","20.12","20.13","20.14","20.15","20.16","20.17","20.18","20.19","20.20","20.21","20.22","21","21.01","21.02","21.03","21.04","21.05","21.06","21.07","21.08","21.09","21.10","21.11","21.12","21.13","21.14","21.15","21.16","21.17","21.18","21.19","21.20","21.21","21.22","21.23","21.24","21.25","21.26","22","22.01","22.02","22.03","22.04","22.05","22.06","22.07","22.08","22.09","22.10","22.11","22.12","22.13","22.14","22.15","22.16","22.17","22.18","22.19","22.20","22.21","22.22","23","23.01","23.02","23.03","23.04","23.05","23.06","23.07","23.08","23.09","23.10","23.11","23.12","23.13","23.14","23.15","23.16","24","24.01","24.02","24.03","24.04","24.05","24.06","24.07","24.08","24.09","24.10","24.11","24.12","24.13","24.14","24.15","24.16","24.17","24.18","24.19","24.20","24.21","24.22","24.23","24.24","24.25","25","25.01","25.02","25.03","25.04","25.05","25.06","25.07","25.08","25.09","25.10","25.11","25.12","25.13","25.14","25.15","25.16","26","26.01","26.02","26.03","26.04","26.05","26.06","26.07","26.08","26.09","26.10","26.11","26.12","26.13","26.14","26.15","26.16","26.17","26.18","27","27.01","27.02","27.03","27.04","27.05","27.06","27.07","27.08","27.09","27.10","27.11","27.12","27.13","27.14","27.15","27.16","28","28.01","28.02","28.03","28.04","28.05","28.06","28.07","28.08","28.09","28.10","28.11","28.12","28.13","28.14","29","29.01","29.02","29.03","29.04","29.05","29.06","29.07","29.08","29.09","29.10","29.11","29.12","30","30.01","30.02","30.03","30.04","30.05","30.06","30.07","30.08","30.09","30.10","30.11","30.12","30.13","31","31.01","31.02","31.03","31.04","31.05","31.06","31.07","31.08","31.09","31.10","31.11","31.12","31.13","31.14","31.15","31.16","31.17","31.18","31.19","31.20","32","32.01","32.02","32.03","32.04","32.05","32.06","32.07","32.08","32.09","32.10","32.11","32.12","32.13","32.14","32.15","33","33.01","33.02","33.03","33.04","33.05","33.06","33.07","33.08","33.09","33.10","33.11","33.12","33.13","34","34.01","34.02","34.03","34.04","34.05","34.06","34.07","34.08","34.09","34.10","34.11","34.12","34.13","34.14","34.15","35","35.01","35.02","35.03","35.04","35.05","35.06","35.07","35.08","35.09","35.10","35.11","35.12","35.13","35.14","35.15","35.16","35.17","35.18","36","36.01","36.02","36.03","36.04","36.05","36.06","36.07","36.08","36.09","36.10","36.11","36.12","36.13","36.14","36.15","36.16","36.17","37","37.01","37.02","37.03","37.04","37.05","37.06","37.07","37.08","37.09","37.10","37.11","37.12","37.13","37.14","37.15","37.16","38","38.01","38.02","38.03","38.04","38.05","38.06","38.07","38.08","38.09","38.10","38.11","38.12","38.13","38.14","38.15","38.16","38.17","38.18","39","39.01","39.02","39.03","39.04","39.05","39.06","39.07","39.08","39.09","39.10","39.11","39.12","39.13","39.14","40","40.01","40.02","40.03","40.04","40.05","40.06","40.07","40.08","40.09","40.10","40.11","40.12","40.13","40.14","40.15","41","41.01","41.02","41.03","41.04","41.05","41.06","41.07","41.08","41.09","41.10","41.11","41.12","41.13","41.14","41.15","41.16","41.17","41.18","42","42.01","42.02","42.03","42.04","42.05","42.06","42.07","42.08","42.09","42.10","42.11","42.12","42.13","42.14","42.15","42.16","43","43.01","43.02","43.03","43.04","43.05","43.06","43.07","43.08","43.09","43.10","43.11","43.12","43.13","43.14","44","44.01","44.02","44.03","44.04","44.05","44.06","44.07","44.08","44.09","44.10","44.11","44.12","44.13","44.14","45","45.01","45.02","45.03","45.04","45.05","45.06","45.07","45.08","45.09","45.10","45.11","45.12","46","46.01","46.02","46.03","46.04","46.05","46.06","46.07","46.08","46.09","46.10","46.11","46.12","46.13","46.14","47","47.01","47.02","47.03","47.04","47.05","47.06","47.07","47.08","47.09","47.10","47.11","47.12","48","48.01","48.02","48.03","48.04","48.05","48.06","48.07","48.08","48.09","48.10","48.11","48.12","49","49.01","49.02","49.03","49.04","49.05","49.06","49.07","49.08","49.09","49.10","49.11","49.12","49.13","50","50.01","50.02","50.03","50.04","50.05","50.06","50.07","50.08","50.09","50.10","50.11","50.12","50.13","50.14","50.15","50.16","51","51.01","51.02","51.03","51.04","51.05","51.06","52","52.01","52.02","52.03","52.04","52.05","52.06","52.07","52.08","53","53.01","53.02","53.03","53.04","53.05","53.06","53.07"];
