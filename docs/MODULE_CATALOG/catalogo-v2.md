# Catálogo de módulos v2 (2.0.0-proposta)

> Gerado por `npx tsx scripts/modules/build-catalog-v2.ts`. proposta — aguarda validação do titular antes de substituir o catálogo v1 em runtime.

| Módulos | Submódulos | Recursos | Operacionais | Parciais | Dependentes de integração | Futuros | Unidades comerciais | Aliases |
|---|---|---|---|---|---|---|---|---|
| 53 | 1016 | 0 | 319 | 220 | 31 | 446 | 67 | 37 |

Legenda — Classe: CORE · MOD (módulo comercial) · ADD (add-on) · INT (integração) · COMP (compartilhado) · PERM (permissão) · FUT (futuro). Unidade: **U** = vendida por si; → código = incluída em; ≡ código = alias de.

## 01 — CADASTROS BÁSICOS · `cadastros` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 01.01 | Cadastro de empresas e filiais | `cadastros.cadastro_empresas_filiais` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/companies.ts:139` `src/domain/companies.ts:273` — Empresa e filiais com CRUD, situação, depósitos e usuários |
| 01.02 | Cadastro de clientes | `cadastros.cadastro_clientes` | OP | MOD | **U** |  | `cadastros.clientes` | `src/domain/customers.ts:134` `src/app/(app)/clientes/customer-form.tsx` — CPF/CNPJ único, crédito, consulta CNPJ, ficha e histórico |
| 01.03 | Cadastro de fornecedores | `cadastros.cadastro_fornecedores` | OP | MOD | **U** |  | `cadastros.fornecedores` | `src/domain/suppliers.ts:124` `src/app/(app)/fornecedores/supplier-form.tsx` — Fornecedor com bloqueio, produtos por fornecedor, consulta CNPJ |
| 01.04 | Cadastro de produtos | `cadastros.cadastro_produtos` | OP | MOD | **U** |  | `cadastros.produtos` | `src/domain/products.ts:472` `src/app/(app)/produtos/product-form.tsx` — Produto com SKU/variações, preços, custos, imagem e importação |
| 01.05 | Cadastro de serviços | `cadastros.cadastro_servicos` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:28` `src/domain/products.ts:141` — Serviço é tipo de produto: LC116, ISS, código municipal |
| 01.06 | Categorias e subcategorias | `cadastros.categorias_subcategorias` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:965` `src/app/(app)/produtos/cadastros/aux-forms.tsx:47` — Categoria com pai (subcategorias) e checagem de ciclo |
| 01.07 | Cadastro de marcas | `cadastros.cadastro_marcas` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:1043` `src/app/(app)/produtos/cadastros/page.tsx` — Marcas com ativo/inativo |
| 01.08 | Unidades de medida | `cadastros.unidades_medida` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:1062` `src/domain/products.ts:927` — Unidades com casas decimais e conversões |
| 01.09 | Cadastro de vendedores | `cadastros.cadastro_vendedores` | OP | MOD | → 06.12 |  | `vendas.comissoes` | `src/domain/sellers.ts:100` `src/app/(app)/vendas/vendedores/page.tsx` — Vendedor (com ou sem login) com comissão por categoria |
| 01.10 | Cadastro de transportadoras | `cadastros.cadastro_transportadoras` | PARC | MOD | → 01.03 |  | `cadastros.fornecedores` | `src/lib/db/schema.ts:204` `src/app/(app)/fornecedores/supplier-form.tsx:89` — Só marca "É transportador" no fornecedor; sem cadastro próprio |
| 01.11 | Cadastro de entregadores | `cadastros.cadastro_entregadores` | NAO | FUT |  |  |  | Entregador só citado em texto da loja; sem cadastro |
| 01.12 | Formas de pagamento | `cadastros.formas_pagamento` | OP | COMP |  |  | `tec.financeiro` | `src/domain/finance.ts:1215` `src/app/(app)/financeiro/cadastros/page.tsx:279` — Meios de pagamento com taxa, prazo, parcelas, bandeira |
| 01.13 | Tabelas de preços | `cadastros.tabelas_precos` | OP | COMP |  |  | `tec.precos` | `src/domain/products.ts:1100` `src/domain/pricing.ts:126` — Tabelas com vigência, atacado, desconto máximo e histórico |
| 01.14 | Cadastro de representantes | `cadastros.cadastro_representantes` | PARC | MOD | → 06.12 |  | `vendas.comissoes` | `src/domain/sellers.ts:14` `src/app/(app)/vendas/vendedores/page.tsx:136` — Representante = vendedor sem acesso; força externa só planejada |
| 01.15 | Cadastro de fabricantes | `cadastros.cadastro_fabricantes` | NAO | FUT |  |  |  | Sem fabricante; só marca |
| 01.16 | Cadastro de parceiros | `cadastros.cadastro_parceiros` | NAO | FUT |  |  |  | Sem parceiros genéricos (cert_network_nodes é só a rede) |
| 01.17 | Cadastro de contatos | `cadastros.cadastro_contatos` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/app/(app)/clientes/customer-form.tsx:22` `src/app/(app)/fornecedores/supplier-form.tsx:23` — Contatos como lista no cliente/fornecedor; sem cadastro próprio |
| 01.18 | Cadastro de endereços | `cadastros.cadastro_enderecos` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/domain/customers.ts:97` `src/domain/companies.ts:87` — Vários endereços no cadastro; CEP só no checkout da loja |
| 01.19 | Campos personalizados | `cadastros.campos_personalizados` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:42` — PLA-22 campos personalizados documentado; sem código |
| 01.20 | Cadastro de condições comerciais | `cadastros.cadastro_condicoes_comerciais` | PARC | COMP |  |  | `tec.financeiro` | `src/domain/finance.ts:1262` `src/lib/db/schema.ts:190` — Condições de pagamento e limite por cliente; sem condição comercial |
| 01.21 | Consulta de CNPJ (BrasilAPI) nos cadastros *(achado na auditoria)* | `cadastros.consulta_cnpj_brasilapi_nos_cadastros` | OP | MOD | → 01.02 |  | `cadastros.clientes` | `src/domain/customers.ts:217` `src/domain/accounting/clients.ts:262` — Clientes, fornecedores e clientes contábeis |

## 02 — CADASTRO E CONFIGURAÇÃO FISCAL · `fiscal_config` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 02.01 | Cadastro fiscal de produtos | `fiscal_config.cadastro_fiscal_produtos` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:125` `src/domain/products.ts:183` — NCM, CEST, origem, grupo, CFOP e CST no produto |
| 02.02 | Classificação NCM | `fiscal_config.classificacao_ncm` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/products.ts:131` `src/domain/fiscal/service.ts:632` — NCM 8 dígitos e capítulo TIPI; sem tabela NCM |
| 02.03 | Cadastro CEST | `fiscal_config.cadastro_cest` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/products.ts:132` `src/domain/products.ts:193` — CEST 7 dígitos, exigido com ST; sem tabela CEST |
| 02.04 | Cadastro CFOP | `fiscal_config.cadastro_cfop` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:238` `src/domain/cfop-entry.ts:23` — CFOP por grupo, natureza e conversor; sem tabela mestre |
| 02.05 | Cadastro CST e CSOSN | `fiscal_config.cadastro_cst_csosn` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/products.ts:43` `src/domain/products.ts:1169` — Listas fixas CST/CSOSN validadas pelo regime; sem cadastro |
| 02.06 | Configuração de ICMS | `fiscal_config.configuracao_icms` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:274` `src/domain/fiscal/tax-complete.ts:157` — Alíquota, redução e interestadual 4/7/12% por grupo |
| 02.07 | Configuração de IPI | `fiscal_config.configuracao_ipi` | FALHA | COMP |  |  | `tec.fiscal` | `src/app/(app)/produtos/cadastros/aux-forms.tsx:97` `src/domain/fiscal/service.ts:214` — CST/alíquota de IPI cadastrados mas NÃO usados na emissão |
| 02.08 | Configuração de PIS e COFINS | `fiscal_config.configuracao_pis_cofins` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:290` `src/domain/fiscal/service.ts:834` — PIS/COFINS por grupo; base sem ICMS opcional |
| 02.09 | Substituição tributária | `fiscal_config.substituicao_tributaria` | OP | MOD | **U** |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/tax-complete.ts:157` `tests/tax-complete.test.ts` — ICMS-ST com MVA, redução e FCP-ST |
| 02.10 | Naturezas de operação | `fiscal_config.naturezas_operacao` | OP | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/tax-complete-codes.ts:166` `src/domain/fiscal/tax-complete.ts:416` — Naturezas com CFOP/CST padrão |
| 02.11 | Regimes tributários | `fiscal_config.regimes_tributarios` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/config.ts:21` `src/lib/db/schema.ts:75` — Regime e CRT guiam o cálculo |
| 02.12 | Certificados digitais | `fiscal_config.certificados_digitais` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/config.ts:163` `src/domain/fiscal/config.ts:121` — Envio .pfx, validade/CNPJ e alerta diário |
| 02.13 | Regras tributárias por operação | `fiscal_config.regras_tributarias_operacao` | OP | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/service.ts:265` `src/domain/fiscal/tax-complete.ts:363` — Prioridade item > natureza > produto > grupo |
| 02.14 | Configuração IBS e CBS | `fiscal_config.configuracao_ibs_cbs` | OP | MOD | **U** |  | `fiscal.reforma_tributaria` | `src/domain/fiscal/reform.ts:84` `tests/tax-reform.test.ts` — IBS/CBS/IS com adesão, CST e cClassTrib |
| 02.15 | Benefícios fiscais | `fiscal_config.beneficios_fiscais` | NAO | FUT |  |  |  | Sem cBenef nem cadastro de benefício fiscal |
| 02.16 | DIFAL | `fiscal_config.difal` | OP | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/tax-complete-codes.ts:135` `tests/tax-complete.test.ts` — DIFAL por fora/dentro por UF |
| 02.17 | Fundo de combate à pobreza | `fiscal_config.fundo_combate_pobreza` | OP | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/lib/db/schema.ts:856` `src/domain/fiscal/tax-complete.ts:157` — FCP e FCP-ST por grupo e UF |
| 02.18 | Retenções tributárias | `fiscal_config.retencoes_tributarias` | PARC | MOD | → 04.03 |  | `fiscal.nfse` | `src/domain/fiscal/calc.ts:25` `src/domain/fiscal/service.ts:738` — Retenções só na NFS-e emitida |
| 02.19 | Tributação por estado | `fiscal_config.tributacao_estado` | OP | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/tax-complete-codes.ts:60` `src/lib/db/schema.ts:866` — Alíquotas por UF de destino |
| 02.20 | Tributação por município | `fiscal_config.tributacao_municipio` | PARC | MOD | → 04.03 |  | `fiscal.nfse` | `src/domain/products.ts:141` `src/domain/fiscal/service.ts:731` — ISS e código municipal por produto; sem tabela por município |
| 02.21 | Tributação por cliente | `fiscal_config.tributacao_cliente` | PARC | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/tax-complete.ts:113` — Só indicador IE/consumidor final afeta ST/DIFAL |
| 02.22 | Tributação por produto | `fiscal_config.tributacao_produto` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/fiscal/service.ts:274` `src/domain/products.ts:1196` — Produto sobrepõe grupo, CFOP, CST e IBS/CBS |
| 02.23 | Validação de cadastros fiscais | `fiscal_config.validacao_cadastros_fiscais` | OP | COMP |  |  | `tec.fiscal` | `src/domain/products.ts:183` `src/domain/fiscal/service.ts:557` — Situação fiscal do produto e checklist do emitente |
| 02.24 | Atualização de tabelas tributárias | `fiscal_config.atualizacao_tabelas_tributarias` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:183` — iMendes/IBPT planejado |
| 02.25 | Tributos aproximados no documento (Lei 12.741) *(achado na auditoria)* | `fiscal_config.tributos_aproximados_documento_lei_12_741` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:227` |

## 03 — DOCUMENTOS FISCAIS DE ENTRADA · `fiscal_entrada` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 03.01 | Cadastro manual de nota fiscal de compra | `fiscal_entrada.cadastro_manual_nota_fiscal_compra` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:768` `src/app/(app)/compras/recebimentos/novo/new-receipt.tsx` — Recebimento manual, com ou sem pedido |
| 03.02 | Importação de XML | `fiscal_entrada.importacao_xml` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:516` `src/domain/nfe-xml.ts:178` — Importa XML NF-e |
| 03.03 | Consulta de documentos fiscais recebidos | `fiscal_entrada.consulta_documentos_fiscais_recebidos` | EXT | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:848` — Só baixa XML por chave via Focus; sem lista DF-e |
| 03.04 | Manifestação do destinatário | `fiscal_entrada.manifestacao_destinatario` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:176` — Manifestação do destinatário planejada |
| 03.05 | Conferência de notas fiscais | `fiscal_entrada.conferencia_notas_fiscais` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:302` `src/app/(app)/compras/recebimentos/[id]/conference.tsx` — Conferência item a item com divergências |
| 03.06 | Entrada automática no estoque | `fiscal_entrada.entrada_automatica_estoque` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:1257` — Entrada no estoque ao confirmar |
| 03.07 | Geração de contas a pagar | `fiscal_entrada.geracao_contas_pagar` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:447` `src/domain/receipts.ts:459` — Título a pagar pelas duplicatas ou condição |
| 03.08 | Devolução de compras | `fiscal_entrada.devolucao_compras` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/supplier-returns.ts:253` `src/domain/supplier-returns.ts:283` — Devolução a fornecedor; NF-e depende da Focus |
| 03.09 | Atualização de custos pela nota | `fiscal_entrada.atualizacao_custos_pela_nota` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:1302` `src/domain/receipts.ts:1453` — Custo de aquisição com histórico; frete CT-e rateado |
| 03.10 | Vinculação com pedidos de compra | `fiscal_entrada.vinculacao_pedidos_compra` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:260` `src/domain/receipts.ts:302` — Vínculo a vários pedidos, alocação por saldo |
| 03.11 | Conferência de impostos | `fiscal_entrada.conferencia_impostos` | PARC | MOD | → 22.05 |  | `fiscal.livro_entradas` | `src/domain/receipts.ts:120` `src/domain/fiscal/entries.ts:340` — Tributos do XML só informativos |
| 03.12 | Recebimento parcial de notas | `fiscal_entrada.recebimento_parcial_notas` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:338` `src/domain/receipts.ts:459` — Recebido menor que faturado gera divergência |
| 03.13 | Importação de CT-e recebido | `fiscal_entrada.importacao_ct_recebido` | OP | ADD | **U** | 05.06 | `compras.cte` | `src/domain/freight-cte.ts:94` `src/domain/cte-xml.ts:77` — CT-e de frete com rateio no custo · CT-e recebido usa a importação de XML |
| 03.14 | Importação de documentos de serviço | `fiscal_entrada.importacao_documentos_servico` | PARC | MOD | → 22.05 |  | `fiscal.livro_entradas` | `src/domain/no-stock-entries.ts:74` `src/domain/no-stock-entries.ts:34` — NFS-e tomada só digitada |
| 03.15 | Gestão de divergências fiscais | `fiscal_entrada.gestao_divergencias_fiscais` | PARC | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:139` `src/domain/receipts.ts:493` — Divergências comerciais; nenhuma tributária |
| 03.16 | Histórico de documentos recebidos | `fiscal_entrada.historico_documentos_recebidos` | OP | MOD | → 22.05 |  | `fiscal.livro_entradas` | `src/app/(app)/compras/recebimentos/page.tsx` `src/domain/fiscal/entries.ts:340` — Lista de recebimentos, CT-e e livro de entradas |
| 03.17 | Cadastro de produtos a partir da nota de compra *(achado na auditoria)* | `fiscal_entrada.cadastro_produtos_partir_nota_compra` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipt-products.ts:151` `src/app/(app)/compras/recebimentos/[id]/new-products.tsx` |
| 03.18 | Conversor de CFOP de entrada *(achado na auditoria)* | `fiscal_entrada.conversor_cfop_entrada` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/cfop-entry.ts:114` — Recurso entradaSemPedido/conversorCfop |

## 04 — EMISSÃO DE DOCUMENTOS FISCAIS · `fiscal_emissao` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 04.01 | Emissão de NF-e | `fiscal_emissao.emissao_nf` | EXT | MOD | **U** |  | `fiscal.nfe` | `src/domain/fiscal/nfe.ts:446` `src/domain/fiscal/service.ts:1520` — Assistente completo; Focus NFe sem credencial, opera em simulação |
| 04.02 | Emissão de NFC-e | `fiscal_emissao.emissao_nfc` | EXT | MOD | **U** |  | `fiscal.nfce` | `src/domain/fiscal/service.ts:1114` `tests/fiscal.test.ts` — NFC-e do PDV com QR Code; falta CSC/token |
| 04.03 | Emissão de NFS-e | `fiscal_emissao.emissao_nfs` | EXT | MOD | **U** |  | `fiscal.nfse` | `src/domain/fiscal/service.ts:2036` `src/domain/fiscal/providers.ts:105` — NFS-e municipal e nacional via Focus |
| 04.04 | Emissão de CT-e | `fiscal_emissao.emissao_ct` | NAO | FUT |  |  |  | Só CT-e de entrada; sem emissão |
| 04.05 | Emissão de MDF-e | `fiscal_emissao.emissao_mdf` | PLAN | FUT |  |  | `fiscal.mdfe` | `src/lib/modules/catalog.ts:629` `docs/evolucao/04-ausentes.md:138` — MDF-e planejado |
| 04.06 | Nota fiscal de devolução | `fiscal_emissao.nota_fiscal_devolucao` | EXT | MOD | → 04.01 |  | `fiscal.nfe` | `src/domain/fiscal/service.ts:1153` `src/domain/fiscal/nfe.ts:313` — Devoluções prontas; autorização via Focus |
| 04.07 | Nota fiscal de transferência | `fiscal_emissao.nota_fiscal_transferencia` | EXT | MOD | → 04.01 |  | `fiscal.nfe` | `src/domain/fiscal/nfe.ts:256` `src/domain/fiscal/service.ts:238` — NF-e de transferência entre filiais |
| 04.08 | Nota fiscal de remessa | `fiscal_emissao.nota_fiscal_remessa` | PARC | MOD | → 04.01 |  | `fiscal.nfe` | `src/domain/fiscal/tax-complete-codes.ts:171` `src/app/(app)/fiscal/nfe/nova/nfe-wizard.tsx:417` — Remessa só por NF-e manual |
| 04.09 | Cancelamento de documentos fiscais | `fiscal_emissao.cancelamento_documentos_fiscais` | EXT | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1743` `src/domain/fiscal/service.ts:1732` — Cancelamento no prazo legal |
| 04.10 | Carta de correção eletrônica | `fiscal_emissao.carta_correcao_eletronica` | EXT | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1828` `src/domain/fiscal/providers.ts:150` — CC-e via Focus |
| 04.11 | Inutilização de numeração | `fiscal_emissao.inutilizacao_numeracao` | EXT | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1854` `src/domain/fiscal/service.ts:1939` — Inutilização e detecção de lacunas |
| 04.12 | Armazenamento de XML | `fiscal_emissao.armazenamento_xml` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1356` `src/domain/fiscal/service.ts:1365` — XML autorizado guardado em arquivos |
| 04.13 | Emissão em contingência | `fiscal_emissao.emissao_contingencia` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:971` `src/domain/fiscal/service.ts:1721` — Fila retida NFC-e e contingência Focus; sem EPEC |
| 04.14 | Envio de documentos fiscais | `fiscal_emissao.envio_documentos_fiscais` | EXT | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1951` — Envio por e-mail depende de Resend |
| 04.15 | Nota fiscal complementar | `fiscal_emissao.nota_fiscal_complementar` | PARC | MOD | → 04.01 |  | `fiscal.nfe` | `src/app/(app)/fiscal/nfe/nova/nfe-wizard.tsx:218` `src/domain/fiscal/service.ts:795` — Complementar só como finalidade 2 manual |
| 04.16 | Nota fiscal de ajuste | `fiscal_emissao.nota_fiscal_ajuste` | PARC | MOD | → 04.01 |  | `fiscal.nfe` | `src/app/(app)/fiscal/nfe/nova/nfe-wizard.tsx:218` `src/domain/fiscal/service.ts:795` — Ajuste só como finalidade 3 manual |
| 04.17 | Nota fiscal de exportação | `fiscal_emissao.nota_fiscal_exportacao` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:128` — Exportação planejada |
| 04.18 | Nota fiscal de importação | `fiscal_emissao.nota_fiscal_importacao` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:128` — Importação (DI) planejada |
| 04.19 | Emissão fiscal em lote | `fiscal_emissao.emissao_fiscal_lote` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1700` — Só retransmissão em lote |
| 04.20 | Monitoramento de rejeições | `fiscal_emissao.monitoramento_rejeicoes` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/reports.ts:312` `src/domain/help-content.ts:49` — Relatório de rejeições e rotina fiscal.stuck |
| 04.21 | Consulta de situação fiscal | `fiscal_emissao.consulta_situacao_fiscal` | EXT | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1653` `src/domain/fiscal/providers.ts:132` — Consulta de situação via Focus |
| 04.22 | Impressão de documentos auxiliares | `fiscal_emissao.impressao_documentos_auxiliares` | OP | COMP |  |  | `tec.fiscal` | `src/app/(app)/fiscal/_components/print-docs.tsx:40` `src/app/(app)/fiscal/_components/print-page.tsx:26` — DANFE, DANFCE e DANFSE locais |
| 04.23 | Encerramento de MDF-e | `fiscal_emissao.encerramento_mdf` | PLAN | FUT |  |  | `fiscal.mdfe` | `docs/evolucao/04-ausentes.md:138` — Encerramento de MDF-e planejado |
| 04.24 | Gestão de eventos fiscais | `fiscal_emissao.gestao_eventos_fiscais` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1043` `src/lib/db/schema.ts:888` — Eventos de cada documento |
| 04.25 | Numeração e séries fiscais | `fiscal_emissao.numeracao_series_fiscais` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/config.ts:72` `src/domain/fiscal/config.ts:90` — Série e próximo número por filial/modelo |
| 04.26 | Reprocessamento de documentos fiscais | `fiscal_emissao.reprocessamento_documentos_fiscais` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/service.ts:1685` `src/domain/fiscal/nfe.ts:527` — Retransmissão unitária e em lote |

## 05 — GESTÃO DE COMPRAS · `compras` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 05.01 | Solicitação de compra | `compras.solicitacao_compra` | PARC | MOD | → 05.05 |  | `compras.aprovacoes` | `src/domain/approvals.ts:263` `src/lib/db/schema.ts:767` — Solicitação só nasce de pedidos enviados à aprovação |
| 05.02 | Cotação com fornecedores | `compras.cotacao_fornecedores` | OP | MOD | **U** | 05.04 | `compras.cotacoes` | `src/domain/quotations.ts:83` `src/app/(app)/compras/cotacoes/[id]/proposal-dialog.tsx` — Cotação com vários fornecedores, propostas e CSV |
| 05.03 | Comparação de cotações | `compras.comparacao_cotacoes` | OP | MOD | → 05.02 |  | `compras.cotacoes` | `src/domain/quotations.ts:317` `src/app/(app)/compras/cotacoes/[id]/comparison.tsx` — Mapa comparativo e seleção por item |
| 05.04 | Pedido de compra | `compras.pedido_compra` | OP | MOD | **U** | 01.03, 01.04 | `compras.pedidos` | `src/domain/purchases.ts:192` `src/domain/purchases.ts:430` — Fluxo completo; corridas residuais documentadas em docs/pendencias-externas.md:26 |
| 05.05 | Aprovação de compras | `compras.aprovacao_compras` | OP | MOD | **U** | 05.04 | `compras.aprovacoes` | `src/domain/approvals.ts:378` `src/app/(app)/compras/aprovacoes/politica/page.tsx` — Alçadas, etapas, aprovar/ajustar/rejeitar |
| 05.06 | Recebimento de mercadorias | `compras.recebimento_mercadorias` | OP | MOD | **U** | 01.03, 01.04 | `compras.recebimento` | `src/domain/receipts.ts:516` `src/app/(app)/compras/recebimentos/[id]/conference.tsx` — XML/manual, conferência, estoque e contas a pagar |
| 05.07 | Compras pendentes | `compras.compras_pendentes` | OP | MOD | → 05.04 |  | `compras.pedidos` | `src/app/(app)/compras/pedidos/page.tsx:51` `src/domain/routines/purchases.ts:14` — Abertos/atrasados e rotina diária |
| 05.08 | Sugestão de reposição | `compras.sugestao_reposicao` | OP | MOD | **U** | 01.04 | `compras.reposicao` | `src/domain/replenishment.ts:115` `src/app/(app)/compras/reposicao/page.tsx` — Sugestão por cobertura, gera rascunhos/cotação |
| 05.09 | Histórico de compras | `compras.historico_compras` | OP | MOD | → 05.04 |  | `compras.pedidos` | `src/lib/db/schema.ts:306` `src/app/(app)/fornecedores/[id]/supplier-products.tsx:77` — Pedidos/recebimentos e último custo por fornecedor |
| 05.10 | Custos de aquisição | `compras.custos_aquisicao` | OP | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:302` `src/domain/receipts.ts:1302` — Rateio de frete/IPI/despesas/CT-e no custo |
| 05.11 | Compras recorrentes | `compras.compras_recorrentes` | NAO | FUT |  |  |  | Sem pedido recorrente |
| 05.12 | Compras programadas | `compras.compras_programadas` | NAO | FUT |  |  |  | Sem programação de compras |
| 05.13 | Contratos de fornecimento | `compras.contratos_fornecimento` | NAO | FUT | ≡ 27.09 |  |  | Sem contratos de fornecimento · Contratos de fornecimento = contratos (tipo fornecimento) |
| 05.14 | Avaliação de fornecedores | `compras.avaliacao_fornecedores` | OP | MOD | → 01.03 |  | `cadastros.fornecedores` | `src/domain/suppliers.ts:365` `src/app/(app)/fornecedores/[id]/page.tsx:82` — Nota medida 0–5 (pontualidade/conformidade) |
| 05.15 | Compras por centro de custo | `compras.compras_centro_custo` | PARC | MOD | → 05.04 |  | `compras.pedidos` | `src/domain/purchases.ts:93` `src/domain/receipts.ts:644` — Centro de custo vai ao título; sem relatório |
| 05.16 | Controle de entregas de fornecedores | `compras.controle_entregas_fornecedores` | OP | MOD | → 05.04 |  | `compras.pedidos` | `src/domain/purchases.ts:549` `src/domain/routines/purchases.ts:14` — Em trânsito, alerta de atraso e pontualidade |
| 05.17 | Compras emergenciais | `compras.compras_emergenciais` | NAO | FUT |  |  |  | Sem compra emergencial |
| 05.18 | Portal do fornecedor | `compras.portal_fornecedor` | NAO | FUT |  |  |  | `src/app/(app)/compras/pedidos/[id]/send-order.tsx:48` — Só rótulo de canal de envio; sem portal |
| 05.19 | Entrada de mercadoria com nota a confirmar *(achado na auditoria)* | `compras.entrada_mercadoria_nota_confirmar` | OP | ADD | **U** | 05.06 | `compras.nota_a_confirmar` | `src/domain/pending-invoice.ts:118` `src/app/(app)/compras/aguardando-nota/page.tsx` |
| 05.20 | Precificação após a entrada *(achado na auditoria)* | `compras.precificacao_apos_entrada` | OP | ADD | **U** | 05.06 | `compras.precificacao` | `src/domain/receipt-pricing.ts:164` `src/app/(app)/compras/precificacao/page.tsx` |
| 05.21 | Orçamento mensal de compras por filial *(achado na auditoria)* | `compras.orcamento_mensal_compras_filial` | OP | MOD | → 05.05 |  | `compras.aprovacoes` | `src/domain/purchases.ts:622` |
| 05.22 | Revisões e envio do pedido de compra ao fornecedor *(achado na auditoria)* | `compras.revisoes_envio_pedido_compra_fornecedor` | OP | MOD | → 05.04 |  | `compras.pedidos` | `src/domain/purchases.ts:280` `src/domain/purchases.ts:477` |

## 06 — GESTÃO COMERCIAL E VENDAS · `vendas` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 06.01 | Orçamentos | `vendas.orcamentos` | OP | MOD | **U** | 01.04 | `vendas.documentos` | `src/domain/sales-documents.ts:254` `src/app/(app)/vendas/orcamentos/page.tsx` — Validade, envio, aprovação, expiração |
| 06.02 | Propostas comerciais | `vendas.propostas_comerciais` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/app/documento/[token]/page.tsx` `src/app/(app)/vendas/orcamentos/[id]/imprimir/page.tsx` — Orçamento serve de proposta; sem modelo próprio |
| 06.03 | Pedidos de venda | `vendas.pedidos_venda` | OP | MOD | → 06.01 |  | `vendas.documentos` | `src/domain/sales-documents.ts:254` `src/app/(app)/vendas/pedidos/page.tsx` — Pedido com reserva, entrega parcial e faturamento |
| 06.04 | Aprovação de pedidos | `vendas.aprovacao_pedidos` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/domain/sales-documents.ts:263` `src/domain/supervisor.ts:17` — Só autorização de desconto; sem aprovação de pedido |
| 06.05 | Conversão de orçamento em pedido | `vendas.conversao_orcamento_pedido` | OP | MOD | → 06.01 |  | `vendas.documentos` | `src/domain/sales-documents.ts:448` — Conversão com reserva |
| 06.06 | Faturamento de pedidos | `vendas.faturamento_pedidos` | OP | MOD | → 06.01 |  | `vendas.documentos` | `src/domain/sales-documents.ts:681` `src/domain/sales-documents.ts:917` — Faturamento parcial pelo PDV ou NF-e |
| 06.07 | Venda direta | `vendas.venda_direta` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/sales.ts:283` — Venda no PDV sem documento comercial |
| 06.08 | Venda futura | `vendas.venda_futura` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/lib/db/schema.ts:471` — Data de entrega e reserva; sem simples faturamento |
| 06.09 | Reserva de mercadorias | `vendas.reserva_mercadorias` | OP | ADD | **U** | 07.01 | `pdv.reserva_prevenda` | `src/domain/sales-documents.ts:539` `src/domain/carts.ts:231` — Reserva por pedido e pré-venda |
| 06.10 | Gestão de descontos | `vendas.gestao_descontos` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/sale-pricing.ts:36` `src/domain/roles.ts:65` — Limite por perfil e preço, autorização |
| 06.11 | Tabelas de preços comerciais | `vendas.tabelas_precos_comerciais` | OP | COMP |  |  | `tec.precos` | `src/domain/pricing.ts:30` `src/app/(app)/produtos/cadastros/page.tsx` — Tabelas com vigência, atacado, por cliente |
| 06.12 | Comissões de vendedores | `vendas.comissoes_vendedores` | OP | MOD | **U** |  | `vendas.comissoes` | `src/domain/commissions.ts:197` `src/app/(app)/vendas/comissoes/page.tsx` — Apuração, fechamento em título, reabertura |
| 06.13 | Metas comerciais | `vendas.metas_comerciais` | OP | MOD | **U** |  | `gestao.metas` | `src/domain/goals.ts:99` `src/app/(app)/dashboard/metas/page.tsx` — Metas por filial/vendedor |
| 06.14 | Histórico de vendas | `vendas.historico_vendas` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/vendas/page.tsx` `src/app/(app)/vendas/[id]/page.tsx` — Histórico, detalhe, recibo e segunda via |
| 06.15 | Cancelamento de pedidos | `vendas.cancelamento_pedidos` | OP | MOD | → 06.01 |  | `vendas.documentos` | `src/domain/sales-documents.ts:495` `src/domain/sales.ts:920` — Cancelamento de pedido e venda |
| 06.16 | Acompanhamento de pedidos | `vendas.acompanhamento_pedidos` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/lib/db/schema.ts:467` `src/domain/ecommerce/orders.ts:536` — Só situação/qtd faturada; linha do tempo só on-line |
| 06.17 | Venda por atacado | `vendas.venda_atacado` | PARC | COMP |  |  | `tec.precos` | `src/domain/pricing.ts:54` `src/domain/cart-calc.ts:50` — Só preço de atacado por quantidade |
| 06.18 | Venda por varejo | `vendas.venda_varejo` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/pdv-app.tsx` `src/domain/sales.ts:283` — Varejo pelo PDV |
| 06.19 | Venda em consignação | `vendas.venda_consignacao` | PARC | MOD | → 02.09 |  | `fiscal.tributacao_avancada` | `src/domain/fiscal/tax-complete-codes.ts:175` — Só natureza fiscal 5917 |
| 06.20 | Venda sob encomenda | `vendas.venda_sob_encomenda` | NAO | FUT |  |  |  | Sem venda sob encomenda |
| 06.21 | Venda por representantes | `vendas.venda_representantes` | PARC | MOD | → 06.12 |  | `vendas.comissoes` | `src/domain/sellers.ts:100` `src/app/(app)/vendas/vendedores/page.tsx:136` — Representante sem acesso com comissão |
| 06.22 | Carteira de clientes | `vendas.carteira_clientes` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/lib/db/schema.ts:189` `src/app/(app)/clientes/queries.ts:14` — Vendedor responsável no cliente |
| 06.23 | Políticas comerciais | `vendas.politicas_comerciais` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/lib/db/schema.ts:190` `src/domain/overdue.ts:94` — Regras soltas por cliente; sem cadastro de política |
| 06.24 | Pedidos recorrentes | `vendas.pedidos_recorrentes` | NAO | FUT |  |  |  | Sem pedido recorrente |
| 06.25 | Central de pedidos omnichannel | `vendas.central_pedidos_omnichannel` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/lib/db/schema.ts:1321` `src/app/(app)/comercio-digital/pedidos/page.tsx:75` — Central só da loja virtual · Central omnichannel agrega pedidos de todos os canais |

## 07 — PDV — PONTO DE VENDA · `pdv` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 07.01 | Frente de caixa | `pdv.frente_caixa` | OP | MOD | **U** | 01.04, 07.02 | `vendas.pdv` | `src/app/(app)/pdv/pdv-app.tsx` `src/domain/sales.ts:283` — PDV completo |
| 07.02 | Abertura de caixa | `pdv.abertura_caixa` | OP | MOD | **U** |  | `caixa.operacao` | `src/domain/cash.ts:81` `src/app/(app)/caixa/abertura/opening-form.tsx` — Fundo inicial e periféricos |
| 07.03 | Fechamento de caixa | `pdv.fechamento_caixa` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/domain/cash.ts:393` `src/domain/cash.ts:477` — Fechamento por forma, cego opcional |
| 07.04 | Sangria de caixa | `pdv.sangria_caixa` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/domain/cash.ts:127` `src/domain/cash.ts:161` — Sangria com transferência para conta |
| 07.05 | Suprimento de caixa | `pdv.suprimento_caixa` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/domain/cash.ts:127` `src/app/(app)/caixa/movimentos/movement-form.tsx` — Suprimento com comprovante |
| 07.06 | Venda por código de barras | `pdv.venda_codigo_barras` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/app/api/pdv/products/route.ts:46` — Busca por código de barras |
| 07.07 | Venda por balança | `pdv.venda_balanca` | OP | ADD | ≡ 46.01 |  | `produtos.balanca` | `src/domain/scale.ts:163` `src/domain/scale-barcode.ts:74` — EAN de balança; sem balança serial no caixa · Venda por balança usa a integração de balança etiquetadora |
| 07.08 | Múltiplas formas de pagamento | `pdv.multiplas_formas_pagamento` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/sales.ts:385` `src/app/(app)/pdv/pagamento/payment-app.tsx:48` — Pagamentos combinados |
| 07.09 | Venda suspensa | `pdv.venda_suspensa` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/carts.ts:282` `src/domain/carts.ts:292` — Estacionar e retomar |
| 07.10 | Cancelamento de venda | `pdv.cancelamento_venda` | OP | PERM | → 07.01 |  | `vendas.pdv` | `src/domain/sales.ts:920` `src/app/(app)/vendas/actions.ts` — Cancelamento com permissão · Cancelamento de venda é ação de perfil dentro do PDV |
| 07.11 | Desconto mediante autorização | `pdv.desconto_mediante_autorizacao` | OP | PERM | → 07.01 |  | `vendas.pdv` | `src/domain/supervisor.ts:17` `src/domain/sales.ts:290` — Senha de supervisor para desconto · Desconto acima do limite com autorização de supervisor |
| 07.12 | Integração TEF | `pdv.integracao_tef` | EXT | INT |  |  |  | `src/domain/integrations.ts:65` `src/domain/terminals.ts:30` — TEF só via conector local (inexistente); NSU manual · TEF depende de conector local externo |
| 07.13 | Integração PIX | `pdv.integracao_pix` | EXT | INT | ≡ 36.04 |  | `tec.pagamentos` | `src/domain/payments/providers.ts:76` `src/domain/payments/intents.ts:68` — Mercado Pago sem credencial; simulação · Pix PDV (Mercado Pago) · PIX do PDV usa o mesmo motor de intenções de pagamento (src/domain/payments) |
| 07.14 | Impressão de comprovantes | `pdv.impressao_comprovantes` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/vendas/[id]/recibo/page.tsx` `src/app/(app)/caixa/movimentos/[id]/comprovante/page.tsx` — Impressão pelo navegador |
| 07.15 | Conferência de caixa | `pdv.conferencia_caixa` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/domain/cash.ts:50` `src/domain/cash.ts:334` — Conferência cega com recontagem |
| 07.16 | Múltiplos caixas | `pdv.multiplos_caixas` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/lib/db/schema.ts:146` `src/app/(app)/administracao/terminais/page.tsx` — Vários terminais, uma sessão por terminal |
| 07.17 | Gestão de operadores | `pdv.gestao_operadores` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/domain/roles.ts:65` `tests/cash-operator-mismatch.test.ts` — Operadores = usuários/perfis |
| 07.18 | PDV offline e sincronização | `pdv.pdv_offline_sincronizacao` | PLAN | FUT |  |  | `vendas.pdv_offline` | `docs/evolucao/03-matriz-comparativa.md:192` — PDV offline planejado |
| 07.19 | Fechamento consolidado | `pdv.fechamento_consolidado` | PARC | MOD | → 07.02 |  | `caixa.operacao` | `src/app/(app)/caixa/page.tsx:47` — Somas por período/filial; sem fechamento consolidado · Fechamento consolidado do PDV alimenta o fechamento financeiro (são distintos: físico x financeiro) |
| 07.20 | Consulta rápida de preços | `pdv.consulta_rapida_precos` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/api/pdv/products/route.ts` — Só a busca do PDV mostra preço |
| 07.21 | Identificação de vendedor | `pdv.identificacao_vendedor` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/pdv-app.tsx:688` — Vendedor no atendimento |
| 07.22 | Identificação de cliente | `pdv.identificacao_cliente` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/customer-picker.tsx` `src/app/api/pdv/customers/route.ts` — Cliente/CPF na nota, cadastro rápido |
| 07.23 | Autoatendimento | `pdv.autoatendimento` | NAO | FUT |  |  |  | Sem autoatendimento |
| 07.24 | PDV móvel | `pdv.pdv_movel` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `public/sw.js` — PDV responsivo como PWA; sem smart POS nem offline |
| 07.25 | Reabertura de caixa | `pdv.reabertura_caixa` | OP | PERM | → 07.02 |  | `caixa.operacao` | `src/domain/cash.ts:569` `src/app/(app)/caixa/actions.ts` — Reabertura com motivo e permissão cash.reopen · Reabertura de caixa é ação de perfil |
| 07.26 | Controle de divergências de caixa | `pdv.controle_divergencias_caixa` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/domain/cash.ts:324` `src/app/(app)/caixa/page.tsx:45` — Diferenças com justificativa e acumulado |
| 07.27 | Recebimento de parcelas do crediário no PDV *(achado na auditoria)* | `pdv.recebimento_parcelas_crediario_pdv` | OP | ADD | **U** | 07.01, 18.02 | `pdv.recebimento_crediario` | `src/domain/pdv-receivables.ts:16` `src/app/(app)/pdv/receivables-dialog.tsx` |
| 07.28 | Terminais e checagem de periféricos *(achado na auditoria)* | `pdv.terminais_checagem_perifericos` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/terminals.ts:148` `src/app/(app)/administracao/terminais/[id]/teste-impressao/page.tsx` |

## 08 — TROCAS E DEVOLUÇÕES · `trocas` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 08.01 | Solicitação de troca | `trocas.solicitacao_troca` | PARC | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/ecommerce/orders.ts:476` — Solicitação só no pedido on-line |
| 08.02 | Troca de produto | `trocas.troca_produto` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1334` `src/app/(app)/pdv/actions.ts:84` — Troca com crédito da devolução |
| 08.03 | Troca por tamanho ou cor | `trocas.troca_tamanho_ou_cor` | OP | ADD | ≡ 08.02 |  | `vendas.devolucoes` | `src/app/(app)/vendas/[id]/devolucoes/return-form.tsx:13` — Troca para outra variação · Troca por tamanho ou cor é a troca de produto com variação |
| 08.04 | Devolução de produto | `trocas.devolucao_produto` | OP | ADD | **U** | 07.01 | `vendas.devolucoes` | `src/domain/sales.ts:1334` `src/app/(app)/vendas/[id]/devolucoes/page.tsx` — Devolução por item com efeitos |
| 08.05 | Política e prazo de troca | `trocas.politica_prazo_troca` | PARC | ADD | → 08.04 |  | `vendas.devolucoes` | `src/app/(app)/administracao/parametros/catalog.ts:324` `src/domain/ecommerce/common.ts:78` — Limite de valor; prazo só on-line |
| 08.06 | Vale-troca | `trocas.vale_troca` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/lib/db/schema.ts:564` `src/domain/sales.ts:385` — Vale-crédito com saldo e validade · Vale-troca é um voucher de crédito |
| 08.07 | Crédito para cliente | `trocas.credito_cliente` | OP | ADD | ≡ 18.23 |  | `vendas.devolucoes` | `src/lib/db/schema.ts:564` — Vale ligado ao cliente · Crédito para cliente = crédito de clientes |
| 08.08 | Restituição financeira | `trocas.restituicao_financeira` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1230` `src/domain/sales.ts:1643` — Reembolso dinheiro, Pix, conta ou cartão |
| 08.09 | Pagamento de diferença | `trocas.pagamento_diferenca` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:694` — Diferença da troca na nova venda |
| 08.10 | Reintegração ao estoque | `trocas.reintegracao_estoque` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1379` — Volta ao depósito; avaria ao depósito de avarias |
| 08.11 | Histórico de trocas | `trocas.historico_trocas` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/app/(app)/vendas/devolucoes/page.tsx:47` `src/app/(app)/vendas/devolucoes/[id]/page.tsx` — Lista, detalhe e exportação |
| 08.12 | Avarias e defeitos | `trocas.avarias_defeitos` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1362` `src/domain/supplier-returns.ts:253` — Condição avariado; devolução a fornecedor |
| 08.13 | Troca parcial | `trocas.troca_parcial` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1285` — Quantidade parcial por item |
| 08.14 | Devolução de vendas online | `trocas.devolucao_vendas_online` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:476` `src/domain/ecommerce/orders.ts:494` — Devolução on-line; estorno do gateway simulado |
| 08.15 | Logística reversa | `trocas.logistica_reversa` | NAO | FUT |  |  |  | Sem logística reversa |
| 08.16 | Aprovação de devoluções | `trocas.aprovacao_devolucoes` | OP | PERM | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1422` `tests/ajustes-telas.test.ts` — Autorização acima do valor máximo · Devolução acima do valor máximo |

## 09 — GESTÃO DE PRODUTOS E GRADES · `produtos` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 09.01 | Produtos simples | `produtos.produtos_simples` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:219` `src/domain/products.ts:485` — Produto simples com 1 SKU |
| 09.02 | Grade de tamanhos | `produtos.grade_tamanhos` | OP | MOD | ≡ 09.04 |  | `cadastros.produtos` | `src/app/(app)/produtos/product-form.tsx:198` `src/domain/products.ts:227` — Eixo Tamanho na grade · Grade de tamanhos é dimensão das variações |
| 09.03 | Grade de cores | `produtos.grade_cores` | OP | MOD | ≡ 09.04 |  | `cadastros.produtos` | `src/app/(app)/produtos/product-form.tsx:198` `src/domain/products.ts:227` — Eixo Cor na grade · Grade de cores é dimensão das variações |
| 09.04 | Variações de produtos | `produtos.variacoes_produtos` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:212` `src/app/(app)/produtos/variants-editor.tsx:55` — SKU por combinação de eixos, saldo próprio |
| 09.05 | Código de barras por variação | `produtos.codigo_barras_variacao` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:255` `src/app/(app)/produtos/variants-editor.tsx:103` — Código de barras por variação |
| 09.06 | Produtos vendidos por peso | `produtos.produtos_vendidos_peso` | OP | ADD | ≡ 46.02 |  | `produtos.balanca` | `src/domain/scale-barcode.ts:14` `src/app/(app)/produtos/balanca/page.tsx` — EAN prefixo 2, PLU, carga · Produto vendido por peso = código de peso variável |
| 09.07 | Produtos fracionados | `produtos.produtos_fracionados` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:216` `src/app/(app)/produtos/cadastros/aux-forms.tsx:62` — Qtd em milésimos; casas decimais não validadas na venda |
| 09.08 | Kits de produtos | `produtos.kits_produtos` | OP | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:150` `src/domain/product-components.ts:217` — Kit baixa componentes |
| 09.09 | Combos de produtos | `produtos.combos_produtos` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/seed/modules/kits.ts:13` `src/domain/promotions.ts:104` — Combo só como kit ou leve-pague |
| 09.10 | Produtos compostos | `produtos.produtos_compostos` | OP | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:346` `src/app/(app)/estoque/montagem/page.tsx` — Composto com montagem/desmembramento |
| 09.11 | Produtos personalizados | `produtos.produtos_personalizados` | NAO | FUT |  |  |  | Sem produto personalizável |
| 09.12 | Fotos e imagens | `produtos.fotos_imagens` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/app/(app)/produtos/actions.ts:130` `src/lib/db/schema.ts:223` — 1 foto no ERP; até 6 no anúncio |
| 09.13 | Etiquetas de produtos | `produtos.etiquetas_produtos` | OP | ADD | **U** | 01.04 | `produtos.etiquetas` | `src/domain/labels.ts:16` `src/app/(app)/produtos/etiquetas/page.tsx` — Gôndola/adesiva/A4 |
| 09.14 | Formação de preço | `produtos.formacao_preco` | OP | ADD | → 05.20 |  | `compras.precificacao` | `src/domain/price-adjust.ts:61` `src/domain/receipt-pricing.ts:20` — Custo+adicionais, preço por margem alvo |
| 09.15 | Margem de lucro | `produtos.margem_lucro` | OP | COMP |  |  | `tec.precos` | `src/domain/pricing.ts:70` `src/app/(app)/produtos/[id]/page.tsx:286` — Margem e markup por preço |
| 09.16 | Produtos equivalentes | `produtos.produtos_equivalentes` | NAO | FUT |  |  |  | Sem produto equivalente |
| 09.17 | Produtos substitutos | `produtos.produtos_substitutos` | NAO | FUT |  |  |  | Sem produto substituto |
| 09.18 | Múltiplos códigos de barras | `produtos.multiplos_codigos_barras` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:255` `src/app/api/pdv/products/route.ts:49` — Códigos adicionais no PDV e inventário |
| 09.19 | Características e atributos | `produtos.caracteristicas_atributos` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:255` `docs/evolucao/04-ausentes.md:42` — Só atributos de variação |
| 09.20 | Dimensões e peso | `produtos.dimensoes_peso` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:228` `src/lib/db/schema.ts:1294` — Peso no produto; dimensões só no anúncio |
| 09.21 | Embalagens comerciais | `produtos.embalagens_comerciais` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:927` `src/lib/db/schema.ts:305` — Conversões sem uso na venda; fator do fornecedor na entrada |
| 09.22 | Cadastro em massa | `produtos.cadastro_massa` | OP | ADD | **U** | 01.04 | `produtos.alteracao_massa` | `src/domain/product-import.ts:276` `src/domain/product-bulk.ts:134` — Importação CSV e alteração em massa |
| 09.23 | Ciclo de vida do produto | `produtos.ciclo_vida_produto` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:407` — Só rascunho/ativo/inativo |
| 09.24 | Produtos sazonais | `produtos.produtos_sazonais` | NAO | FUT |  |  |  | Sem sazonalidade |

## 10 — GESTÃO DE ESTOQUE · `estoque` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 10.01 | Saldo de estoque | `estoque.saldo_estoque` | OP | MOD | **U** | 01.04 | `estoque.gestao` | `src/lib/db/schema.ts:335` `src/app/(app)/estoque/page.tsx` — Físico, reservado, trânsito, custo médio |
| 10.02 | Entrada de mercadorias | `estoque.entrada_mercadorias` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/receipts.ts:1257` `src/domain/stock.ts:488` — Recebimento e entrada manual |
| 10.03 | Saída de mercadorias | `estoque.saida_mercadorias` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/stock.ts:488` — Venda, saída manual, devolução a fornecedor |
| 10.04 | Ajustes de estoque | `estoque.ajustes_estoque` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/stock.ts:122` `src/app/(app)/estoque/movimentos/movement-form.tsx` — Ajustes com motivo |
| 10.05 | Transferência entre estoques | `estoque.transferencia_entre_estoques` | OP | ADD | **U** | 10.01 | `estoque.transferencias` | `src/domain/transfers.ts:179` — Entre depósitos e filiais com divergência |
| 10.06 | Múltiplos depósitos | `estoque.multiplos_depositos` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/warehouse-rules.ts:17` `src/domain/warehouses.ts` — Venda/almoxarifado/consumo/avarias |
| 10.07 | Estoque por filial | `estoque.estoque_filial` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/lib/db/schema.ts:324` `src/domain/stock.ts:572` — Depósitos e saldo por filial |
| 10.08 | Estoque mínimo e máximo | `estoque.estoque_minimo_maximo` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/lib/db/schema.ts:338` `src/domain/sales.ts:882` — Mínimo/máximo, alerta |
| 10.09 | Inventário | `estoque.inventario` | OP | ADD | **U** | 10.01 | `estoque.inventario` | `src/domain/inventory.ts:158` `src/domain/inventory.ts:337` — Contagem com bipagem e ajuste |
| 10.10 | Controle de lotes | `estoque.controle_lotes` | OP | ADD | **U** | 10.01 | `estoque.lotes` | `src/domain/lots.ts:54` — Saldo por lote |
| 10.11 | Controle de validade | `estoque.controle_validade` | OP | ADD | → 10.10 |  | `estoque.lotes` | `src/domain/lots.ts:209` `src/domain/routines/stock.ts:62` — Validade e alerta diário · Validade é atributo do lote |
| 10.12 | Controle de número de série | `estoque.controle_numero_serie` | NAO | FUT |  |  |  | Sem número de série |
| 10.13 | Reserva de estoque | `estoque.reserva_estoque` | OP | COMP |  |  | `tec.estoque` | `src/domain/stock.ts:367` `src/domain/sales-documents.ts:548` — Reservas pré-venda, pedido, loja |
| 10.14 | Controle de perdas | `estoque.controle_perdas` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/stock.ts:25` — Movimento perda |
| 10.15 | Controle de avarias | `estoque.controle_avarias` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/warehouse-rules.ts:21` `src/domain/stock.ts:584` — Depósito de avarias |
| 10.16 | Histórico de movimentações | `estoque.historico_movimentacoes` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/lib/db/schema.ts:347` `src/app/(app)/estoque/movimentos/page.tsx` — Saldo antes/depois e origem |
| 10.17 | Curva ABC | `estoque.curva_abc` | OP | MOD | **U** |  | `relatorios.curva_abc` | `src/domain/abc.ts:91` `src/app/(app)/relatorios/curva-abc/page.tsx` — Curva ABC configurável |
| 10.18 | Giro de estoque | `estoque.giro_estoque` | PARC | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:85` — Só dias de cobertura |
| 10.19 | Endereçamento | `estoque.enderecamento` | PARC | MOD | → 10.01 |  | `estoque.gestao` | `src/lib/db/schema.ts:342` `src/domain/inventory.ts:73` — Local texto livre |
| 10.20 | Estoque multicanal | `estoque.estoque_multicanal` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/catalog.ts:15` — Loja e PDV compartilham saldo; marketplaces não |
| 10.21 | Estoque em trânsito | `estoque.estoque_transito` | OP | ADD | → 10.05 |  | `estoque.transferencias` | `src/lib/db/schema.ts:337` `src/domain/transfers.ts:61` — Trânsito de transferência |
| 10.22 | Estoque de terceiros | `estoque.estoque_terceiros` | NAO | FUT |  |  |  | Sem estoque de terceiros |
| 10.23 | Estoque consignado | `estoque.estoque_consignado` | NAO | FUT |  |  |  | `src/domain/fiscal/tax-complete-codes.ts:176` — Só CFOP 5917; sem saldo consignado |
| 10.24 | Estoque bloqueado | `estoque.estoque_bloqueado` | PARC | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/warehouse-rules.ts:9` — Avarias fora do disponível; sem quarentena |
| 10.25 | Contagem cíclica | `estoque.contagem_ciclica` | PARC | ADD | → 10.09 |  | `estoque.inventario` | `src/domain/inventory.ts:47` — Inventário por categoria/local; sem agenda cíclica |
| 10.26 | Rastreabilidade | `estoque.rastreabilidade` | PARC | ADD | → 10.10 |  | `estoque.lotes` | `src/lib/db/schema.ts:355` `src/lib/db/schema.ts:506` — Lote no movimento e venda; sem consulta lote→cliente |
| 10.27 | Valoração de estoque | `estoque.valoracao_estoque` | OP | ADD | → 10.32 |  | `estoque.inventario_fiscal` | `src/lib/db/schema.ts:338` `src/domain/inventory-fiscal.ts:22` — Custo médio e inventário em data-base |
| 10.28 | Sugestão de reposição | `estoque.sugestao_reposicao` | OP | MOD | ≡ 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:115` — Sugestão e rascunho de pedido · Sugestão de reposição é uma só |
| 10.29 | Controle FEFO e FIFO | `estoque.controle_fefo_fifo` | PARC | ADD | → 10.10 |  | `estoque.lotes` | `src/domain/lot-calc.ts:43` `src/domain/lots.ts:57` — Só FEFO · FEFO usa lotes e validade |
| 10.30 | Disponibilidade futura | `estoque.disponibilidade_futura` | PARC | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:85` — Ruptura/próxima chegada só na reposição |
| 10.31 | Venda com complemento entre depósitos por prioridade *(achado na auditoria)* | `estoque.venda_complemento_entre_depositos_prioridade` | OP | COMP |  |  | `tec.estoque` | `src/domain/warehouse-rules.ts:13` |
| 10.32 | Inventário em data-base (inventário fiscal) por NCM *(achado na auditoria)* | `estoque.inventario_data_base_inventario_fiscal_ncm` | OP | ADD | **U** | 10.01 | `estoque.inventario_fiscal` | `src/domain/inventory-fiscal.ts:22` `src/app/(app)/estoque/inventario-fiscal/page.tsx` |

## 11 — CATÁLOGO DIGITAL · `catalogo` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 11.01 | Catálogo público | `catalogo.catalogo_publico` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/page.tsx:13` `src/domain/ecommerce/catalog.ts:376` — Mesma vitrine da loja |
| 11.02 | Catálogo privado | `catalogo.catalogo_privado` | NAO | FUT |  |  |  | `src/domain/ecommerce/storefront.ts:35` — Só prévia interna por token |
| 11.03 | Personalização visual | `catalogo.personalizacao_visual` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/templates.ts:22` `src/domain/ecommerce/store.ts:370` — Modelos, cor, logo, hero |
| 11.04 | Exibição de preços | `catalogo.exibicao_precos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/page.tsx:152` `src/domain/ecommerce/catalog.ts:89` — Preço de/por |
| 11.05 | Exibição de disponibilidade | `catalogo.exibicao_disponibilidade` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/catalog.ts:102` `src/app/loja/[store]/page.tsx:155` — Indisponível pelo saldo |
| 11.06 | Categorias de produtos | `catalogo.categorias_produtos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/page.tsx:94` — Navegação por categoria |
| 11.07 | Compartilhamento por link | `catalogo.compartilhamento_link` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/page.tsx:138` `src/domain/ecommerce/store.ts:569` — Endereço público; sem compartilhar |
| 11.08 | Compartilhamento por QR Code | `catalogo.compartilhamento_qr_code` | NAO | FUT |  |  |  | Sem QR do catálogo |
| 11.09 | Sacola de compras | `catalogo.sacola_compras` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/cart.ts:56` `src/app/loja/[store]/carrinho/page.tsx` — Carrinho |
| 11.10 | Solicitação de orçamento | `catalogo.solicitacao_orcamento` | NAO | FUT |  |  |  | Sem pedido de orçamento na vitrine |
| 11.11 | Realização de pedidos | `catalogo.realizacao_pedidos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/checkout.ts:137` — Pedido on-line com reserva |
| 11.12 | Redirecionamento ao WhatsApp | `catalogo.redirecionamento_whatsapp` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/layout.tsx:88` — Só link Fale conosco wa.me |
| 11.13 | Catálogo B2B | `catalogo.catalogo_b2b` | NAO | FUT |  |  |  | `src/domain/ecommerce/fiscal.ts:37` — Sem catálogo B2B |
| 11.14 | Preços personalizados | `catalogo.precos_personalizados` | NAO | FUT |  |  |  | `src/domain/ecommerce/catalog.ts:89` — Preço único da loja |
| 11.15 | Múltiplos catálogos | `catalogo.multiplos_catalogos` | NAO | FUT |  |  |  | `src/lib/db/schema.ts:1277` — Uma loja por empresa |
| 11.16 | Catálogo por vendedor | `catalogo.catalogo_vendedor` | NAO | FUT |  |  |  | Sem catálogo por vendedor |
| 11.17 | Catálogo por filial | `catalogo.catalogo_filial` | NAO | FUT |  |  |  | `src/lib/db/schema.ts:1272` — Uma loja por empresa |
| 11.18 | Domínio personalizado | `catalogo.dominio_personalizado` | OP | MOD | ≡ 12.24 |  | `ecommerce.loja` | `src/domain/ecommerce/domains.ts:62` `src/middleware.ts` — Domínio próprio com DNS · Domínio do catálogo = domínio da loja |
| 11.19 | Indicadores de acesso | `catalogo.indicadores_acesso` | NAO | FUT |  |  |  | Sem métricas de acesso |
| 11.20 | Publicação programada | `catalogo.publicacao_programada` | NAO | FUT |  |  |  | `src/domain/ecommerce/store.ts:546` — Publicação só manual |

## 12 — E-COMMERCE E VENDAS DIGITAIS · `ecommerce` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 12.01 | Loja virtual | `ecommerce.loja_virtual` | OP | MOD | **U** | 01.04, 04.01 | `ecommerce.loja` | `src/app/loja/[store]/page.tsx` `src/domain/ecommerce/store.ts:271` — Vitrine publicada/pausada |
| 12.02 | Personalização da loja | `ecommerce.personalizacao_loja` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/store.ts:346` `src/app/(app)/comercio-digital/editor/page.tsx` — Modelos, identidade, páginas |
| 12.03 | Cadastro online de clientes | `ecommerce.cadastro_online_clientes` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/checkout.ts:102` — Cliente criado no checkout; sem login |
| 12.04 | Carrinho de compras | `ecommerce.carrinho_compras` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/cart.ts:18` — Carrinho com cupom e frete |
| 12.05 | Checkout | `ecommerce.checkout` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/checkout.ts:54` `src/app/loja/[store]/checkout/page.tsx` — Checkout completo; cobrança simulada |
| 12.06 | Pagamentos online | `ecommerce.pagamentos_online` | EXT | INT | ≡ 36.01 |  |  | `src/domain/ecommerce/providers.ts:75` — Gateway Intercert não ligado; simulação · Gateway da loja · Pagamentos on-line = gateway de pagamento |
| 12.07 | PIX online | `ecommerce.pix_online` | EXT | INT | ≡ 36.04 |  |  | `src/domain/ecommerce/providers.ts:80` — Pix simulado na loja · Pix da loja · PIX on-line da loja usa o provedor do gateway da loja; mesmo recurso comercial "Pagamento por PIX" |
| 12.08 | Cartão de crédito online | `ecommerce.cartao_credito_online` | EXT | INT | ≡ 36.03 |  |  | `src/domain/ecommerce/providers.ts:101` `src/domain/ecommerce/checkout.ts:23` — Cartão simulado · Cartão da loja · Cartão on-line = pagamento por cartão do gateway |
| 12.09 | Cupons promocionais | `ecommerce.cupons_promocionais` | OP | ADD | **U** | 12.01 | `ecommerce.promocoes` | `src/domain/ecommerce/promotions.ts:42` `src/domain/ecommerce/cart.ts:99` — Cupons %/teto/frete grátis |
| 12.10 | Recebimento automático de pedidos | `ecommerce.recebimento_automatico_pedidos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/checkout.ts:137` `src/app/(app)/comercio-digital/pedidos/page.tsx` — Pedido entra direto no ERP |
| 12.11 | Gestão de pedidos online | `ecommerce.gestao_pedidos_online` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:304` `src/app/(app)/comercio-digital/pedidos/[id]/page.tsx` — Cancelar, separar, despachar, devolver |
| 12.12 | Sincronização de estoque | `ecommerce.sincronizacao_estoque` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/catalog.ts:102` — Saldo do ERP em tempo real |
| 12.13 | Sincronização de preços | `ecommerce.sincronizacao_precos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/catalog.ts:89` — Preço da tabela ou override |
| 12.14 | Faturamento de pedidos online | `ecommerce.faturamento_pedidos_online` | EXT | MOD | → 04.01 |  | `fiscal.nfe` | `src/domain/ecommerce/fiscal.ts:12` — NF-e do pedido pelo motor fiscal (Focus ou simulação) |
| 12.15 | Retirada na loja | `ecommerce.retirada_loja` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:88` `src/domain/ecommerce/orders.ts:439` — Retirada por filial com código |
| 12.16 | Entrega em domicílio | `ecommerce.entrega_domicilio` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/store.ts:94` `src/domain/ecommerce/providers.ts:290` — Entrega própria; transportadora simulada |
| 12.17 | Agendamento de entrega | `ecommerce.agendamento_entrega` | NAO | FUT |  |  |  | Sem agendamento de entrega |
| 12.18 | Acompanhamento de pedidos | `ecommerce.acompanhamento_pedidos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/pedido/[token]/page.tsx` `src/domain/ecommerce/orders.ts:65` — Etapas e rastreio |
| 12.19 | Histórico de compras | `ecommerce.historico_compras` | NAO | FUT |  |  |  | `src/app/(app)/clientes/[id]/page.tsx:105` — Sem área do cliente |
| 12.20 | Integração com marketplaces | `ecommerce.integracao_marketplaces` | DEV | FUT |  |  | `ecommerce.canais` | `src/domain/ecommerce/channels.ts:29` — Contas só preparadas |
| 12.21 | Avaliação de produtos | `ecommerce.avaliacao_produtos` | NAO | FUT |  |  |  | Sem avaliação de produtos |
| 12.22 | Lista de desejos | `ecommerce.lista_desejos` | NAO | FUT |  |  |  | Sem lista de desejos |
| 12.23 | Recuperação de carrinho | `ecommerce.recuperacao_carrinho` | PARC | ADD | → 12.09 |  | `ecommerce.promocoes` | `src/domain/ecommerce/promotions.ts:123` — Lista abandonados; mensagem só rascunho |
| 12.24 | Domínio próprio | `ecommerce.dominio_proprio` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/domains.ts:62` `src/middleware.ts` — TXT+DNS real |
| 12.25 | Gestão de banners | `ecommerce.gestao_banners` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/page.tsx:30` `src/domain/ecommerce/store.ts:404` — Uma imagem hero |
| 12.26 | SEO e metadados | `ecommerce.seo_metadados` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/layout.tsx:14` `src/app/loja/[store]/sitemap.xml/route.ts` — Meta/OG, sitemap e robots |
| 12.27 | Gestão de campanhas | `ecommerce.gestao_campanhas` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/templates.ts:43` — Modelo Campanha + cupons |
| 12.28 | Venda digital B2B | `ecommerce.venda_digital_b2b` | NAO | FUT |  |  |  | `src/domain/ecommerce/fiscal.ts:37` — Sem B2B |
| 12.29 | Venda digital B2C | `ecommerce.venda_digital_b2c` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/checkout.ts:137` `src/domain/ecommerce/fiscal.ts:12` — Venda ao consumidor final |
| 12.30 | Loja virtual por filial | `ecommerce.loja_virtual_filial` | NAO | FUT |  |  |  | `src/lib/db/schema.ts:1277` — Uma loja por empresa |
| 12.31 | Monitor de integrações do comércio digital *(achado na auditoria)* | `ecommerce.monitor_integracoes_comercio_digital` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/monitor.ts:107` `src/app/(app)/comercio-digital/monitor/page.tsx` |
| 12.32 | Checklist de prontidão e pendências do anúncio *(achado na auditoria)* | `ecommerce.checklist_prontidao_pendencias_anuncio` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/store.ts:508` `src/domain/ecommerce/catalog.ts:68` |
| 12.33 | Arrependimento de 7 dias (CDC) e devolução do pedido on-line *(achado na auditoria)* | `ecommerce.arrependimento_7_dias_cdc_devolucao_pedido_on_line` | OP | MOD | ≡ 08.14 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:476` — Arrependimento/devolução on-line é a devolução de vendas on-line |

## 13 — WHATSAPP E ATENDIMENTO DIGITAL · `whatsapp` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 13.01 | Integração com WhatsApp | `whatsapp.integracao_whatsapp` | PARC | ADD |  |  |  | `src/lib/whatsapp.ts:14` — Só links wa.me, sem API; envio manual pelo operador |
| 13.02 | Atendimento centralizado | `whatsapp.atendimento_centralizado` | NAO | FUT |  |  |  | Sem caixa de atendimento; tickets é suporte interno |
| 13.03 | Múltiplos atendentes | `whatsapp.multiplos_atendentes` | NAO | FUT |  |  |  | Inexistente |
| 13.04 | Envio de catálogo | `whatsapp.envio_catalogo` | PLAN | FUT |  |  |  | `src/domain/ecommerce/channels.ts:38` — Canal WhatsApp só preparado; sem envio de catálogo |
| 13.05 | Envio de orçamento | `whatsapp.envio_orcamento` | OP | MOD | → 06.01 |  | `vendas.documentos` | `src/app/(app)/vendas/_documentos/actions.ts:104` — Orçamento/pedido via wa.me com link público vendas.documentos |
| 13.06 | Envio de link de pagamento | `whatsapp.envio_link_pagamento` | PARC | ADD | → 18.41 |  | `financeiro.cobranca_whatsapp` | `src/domain/collection.ts:99` — Só {link_pix} com chave Pix estática no modelo financeiro.cobranca_whatsapp |
| 13.07 | Confirmação de pedido | `whatsapp.confirmacao_pedido` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/vendas/[id]/conclusao/page.tsx:152` — Comprovante da venda via wa.me; pedido online só e-mail vendas.pdv |
| 13.08 | Notificação de status | `whatsapp.notificacao_status` | NAO | FUT |  |  |  | `src/domain/ecommerce/orders.ts:71` — Status do pedido online só por e-mail |
| 13.09 | Envio de documentos fiscais | `whatsapp.envio_documentos_fiscais` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/vendas/[id]/conclusao/page.tsx:45` — Só chave da NFC-e no texto wa.me; sem PDF/XML vendas.pdv |
| 13.10 | Histórico de atendimento | `whatsapp.historico_atendimento` | PARC | ADD | → 18.41 |  | `financeiro.cobranca_whatsapp` | `src/domain/collection.ts:131` — Registra conversa aberta no título; sem conversa financeiro.cobranca_whatsapp |
| 13.11 | Automação de atendimento | `whatsapp.automacao_atendimento` | NAO | FUT |  |  |  | Inexistente |
| 13.12 | Chatbot | `whatsapp.chatbot` | NAO | FUT |  |  |  | Inexistente |
| 13.13 | Distribuição de atendimentos | `whatsapp.distribuicao_atendimentos` | NAO | FUT |  |  |  | Inexistente |
| 13.14 | Filas de atendimento | `whatsapp.filas_atendimento` | NAO | FUT |  |  |  | Inexistente |
| 13.15 | Respostas rápidas | `whatsapp.respostas_rapidas` | NAO | FUT |  |  |  | Inexistente |
| 13.16 | Modelos de mensagens | `whatsapp.modelos_mensagens` | OP | ADD | → 18.41 |  | `financeiro.cobranca_whatsapp` | `src/domain/collection-templates.ts:1` — Só modelos de cobrança financeiro.cobranca_whatsapp |
| 13.17 | Atendimento por departamentos | `whatsapp.atendimento_departamentos` | NAO | FUT |  |  |  | Inexistente |
| 13.18 | Indicadores de atendimento | `whatsapp.indicadores_atendimento` | NAO | FUT |  |  |  | Inexistente |
| 13.19 | Integração com outros canais | `whatsapp.integracao_outros_canais` | PLAN | FUT |  |  |  | `src/domain/ecommerce/channels.ts:48` — Contas preparadas sem conector |
| 13.20 | Atendimento assistido por IA | `whatsapp.atendimento_assistido_ia` | NAO | FUT |  |  |  | Nenhuma IA no código |

## 14 — FOOD SERVICE · `food` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 14.01 | Cardápio digital | `food.cardapio_digital` | NAO | FUT |  |  |  | Só loja genérica, não é cardápio |
| 14.02 | Gestão de mesas | `food.gestao_mesas` | NAO | FUT |  |  |  | Sem mesas |
| 14.03 | Gestão de comandas | `food.gestao_comandas` | NAO | FUT |  |  |  | Sem comandas |
| 14.04 | Atendimento de balcão | `food.atendimento_balcao` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/page.tsx` — PDV genérico de varejo vendas.pdv |
| 14.05 | Aplicativo do garçom | `food.aplicativo_garcom` | NAO | FUT |  |  |  | Inexistente |
| 14.06 | Pedido por QR Code na mesa | `food.pedido_qr_code_mesa` | NAO | FUT |  |  |  | Inexistente |
| 14.07 | Pedido para retirada | `food.pedido_retirada` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:439` — Retirada com código na loja virtual ecommerce.loja |
| 14.08 | Pedido para delivery | `food.pedido_delivery` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:113` — Entrega própria por faixa de CEP na loja ecommerce.loja |
| 14.09 | Painel de cozinha — KDS | `food.painel_cozinha_kds` | NAO | FUT |  |  |  | Sem KDS |
| 14.10 | Impressão de pedidos na cozinha | `food.impressao_pedidos_cozinha` | NAO | FUT |  |  |  | Inexistente |
| 14.11 | Setores de preparação | `food.setores_preparacao` | NAO | FUT |  |  |  | Inexistente |
| 14.12 | Adicionais de produtos | `food.adicionais_produtos` | NAO | FUT |  |  |  | Sem adicionais/modificadores |
| 14.13 | Personalização de pedidos | `food.personalizacao_pedidos` | NAO | FUT |  |  |  | Inexistente |
| 14.14 | Combos de alimentação | `food.combos_alimentacao` | PARC | ADD | ≡ 09.09 |  | `produtos.kits` | `src/domain/product-components.ts:26` — Kit genérico serve de combo produtos.kits · Combos de alimentação = combos de produtos |
| 14.15 | Tempo de preparo | `food.tempo_preparo` | NAO | FUT |  |  |  | Inexistente |
| 14.16 | Divisão de conta | `food.divisao_conta` | NAO | FUT |  |  |  | Inexistente |
| 14.17 | Taxa de serviço | `food.taxa_servico` | NAO | FUT |  |  |  | Inexistente |
| 14.18 | Fechamento de mesa | `food.fechamento_mesa` | NAO | FUT |  |  |  | Inexistente |
| 14.19 | Ficha técnica de alimentos | `food.ficha_tecnica_alimentos` | PARC | ADD | ≡ 15.03 |  | `produtos.kits` | `src/domain/product-components.ts:245` — Composição genérica sem rendimento produtos.kits · Ficha técnica de alimentos = ficha técnica (composição) |
| 14.20 | Controle de ingredientes | `food.controle_ingredientes` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:134` — Ingrediente = componente com estoque comum produtos.kits · Ingredientes = matérias-primas |
| 14.21 | Baixa automática de ingredientes | `food.baixa_automatica_ingredientes` | PARC | ADD | ≡ 15.09 |  | `produtos.kits` | `src/domain/sales.ts:827` — Venda de kit baixa componentes produtos.kits · Baixa automática de ingredientes = baixa de componentes na venda |
| 14.22 | Integração com plataformas de delivery | `food.integracao_plataformas_delivery` | NAO | FUT |  |  |  | Sem iFood ou similares |
| 14.23 | Painel de retirada | `food.painel_retirada` | NAO | FUT |  |  |  | Só status ready_for_pickup, sem painel |
| 14.24 | Transferência de mesas | `food.transferencia_mesas` | NAO | FUT |  |  |  | Inexistente |
| 14.25 | Junção de comandas | `food.juncao_comandas` | NAO | FUT |  |  |  | Inexistente |
| 14.26 | Reservas de mesas | `food.reservas_mesas` | NAO | FUT |  |  |  | Inexistente |
| 14.27 | Fila de espera | `food.fila_espera` | NAO | FUT |  |  |  | Inexistente |
| 14.28 | Rodízio | `food.rodizio` | NAO | FUT |  |  |  | Inexistente |
| 14.29 | Buffet por peso | `food.buffet_peso` | PARC | ADD | → 46.01 |  | `produtos.balanca` | `src/domain/scale-barcode.ts:39` — Balança etiquetadora genérica produtos.balanca · Buffet por peso usa o código de peso variável |
| 14.30 | Buffet por pessoa | `food.buffet_pessoa` | NAO | FUT |  |  |  | Inexistente |
| 14.31 | Autoatendimento por totem | `food.autoatendimento_totem` | NAO | FUT |  |  |  | Inexistente |
| 14.32 | Controle de disponibilidade do cardápio | `food.controle_disponibilidade_cardapio` | NAO | FUT |  |  |  | Inexistente |
| 14.33 | Programação de cardápios | `food.programacao_cardapios` | NAO | FUT |  |  |  | Inexistente |
| 14.34 | Controle de desperdício alimentar | `food.controle_desperdicio_alimentar` | NAO | FUT |  |  |  | Inexistente |
| 14.35 | Monitoramento da operação de cozinha | `food.monitoramento_operacao_cozinha` | NAO | FUT |  |  |  | Inexistente |

## 15 — COMPOSIÇÃO DE PRODUTOS E FICHA TÉCNICA · `composicao` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 15.01 | Composição de produtos | `composicao.composicao_produtos` | OP | ADD | **U** | 01.04 | `produtos.kits` | `src/domain/product-components.ts:217` — Kit e composto, até 20 componentes produtos.kits |
| 15.02 | Cadastro de matérias-primas | `composicao.cadastro_materias_primas` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:26` — Sem tipo matéria-prima; só produto ou serviço cadastros.produtos |
| 15.03 | Ficha técnica | `composicao.ficha_tecnica` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/lib/db/schema.ts:241` — product_components: qtd e notas, sem processo produtos.kits |
| 15.04 | Composição multinível | `composicao.composicao_multinivel` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:265` — Composto pode conter composto; kit não produtos.kits |
| 15.05 | Custo da composição | `composicao.custo_composicao` | OP | ADD | → 15.01 |  | `produtos.kits` | `src/app/(app)/produtos/[id]/page.tsx:468` — Custo somado dos componentes produtos.kits |
| 15.06 | Montagem de kits | `composicao.montagem_kits` | OP | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:388` — runAssembly, /estoque/montagem produtos.kits |
| 15.07 | Desmontagem de kits | `composicao.desmontagem_kits` | OP | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:313` — Desmembramento rateia o custo produtos.kits |
| 15.08 | Transformação de matérias-primas | `composicao.transformacao_materias_primas` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:388` — Só via montagem do composto produtos.kits |
| 15.09 | Baixa de componentes na venda | `composicao.baixa_componentes_venda` | OP | ADD | → 15.01 |  | `produtos.kits` | `src/domain/sales.ts:827` — Kit baixa componentes; cancelamento estorna produtos.kits |
| 15.10 | Baixa de componentes na produção | `composicao.baixa_componentes_producao` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:388` — assembly_out na montagem; sem ordem de produção produtos.kits |
| 15.11 | Controle de rendimento | `composicao.controle_rendimento` | NAO | FUT |  |  |  | Inexistente |
| 15.12 | Controle de desperdício | `composicao.controle_desperdicio` | NAO | FUT |  |  |  | Inexistente |
| 15.13 | Conversão de unidades | `composicao.conversao_unidades` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:936` — unit_conversions só no produto/compra cadastros.produtos |
| 15.14 | Substituição de componentes | `composicao.substituicao_componentes` | NAO | FUT |  |  |  | Inexistente |
| 15.15 | Versionamento de composição | `composicao.versionamento_composicao` | NAO | FUT |  |  |  | Só auditoria das alterações |
| 15.16 | Simulação de custos | `composicao.simulacao_custos` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:346` — planAssembly mostra prévia de custo produtos.kits |
| 15.17 | Subprodutos | `composicao.subprodutos` | NAO | FUT |  |  |  | Inexistente |
| 15.18 | Coprodutos | `composicao.coprodutos` | NAO | FUT |  |  |  | Inexistente |
| 15.19 | Composição variável | `composicao.composicao_variavel` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/lib/db/schema.ts:245` — Componentes por variação (parentSkuId) produtos.kits |
| 15.20 | Composição por encomenda | `composicao.composicao_encomenda` | NAO | FUT |  |  |  | Inexistente |

## 16 — PRODUÇÃO E PCP · `pcp` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 16.01 | Ordem de produção | `pcp.ordem_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.02 | Planejamento de produção | `pcp.planejamento_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.03 | Programação de produção | `pcp.programacao_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.04 | Capacidade produtiva | `pcp.capacidade_produtiva` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.05 | Necessidade de materiais — MRP | `pcp.necessidade_materiais_mrp` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.06 | Reserva de matéria-prima | `pcp.reserva_materia_prima` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.07 | Requisição de matéria-prima | `pcp.requisicao_materia_prima` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.08 | Etapas de produção | `pcp.etapas_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.09 | Apontamento de produção | `pcp.apontamento_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.10 | Controle de mão de obra | `pcp.controle_mao_obra` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.11 | Controle de máquinas | `pcp.controle_maquinas` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.12 | Perdas produtivas | `pcp.perdas_produtivas` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.13 | Controle de qualidade | `pcp.controle_qualidade` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.14 | Rastreabilidade produtiva | `pcp.rastreabilidade_produtiva` | NAO | FUT |  |  |  | Só lotes de estoque, não produção · Rastreabilidade produtiva usa a rastreabilidade de estoque |
| 16.15 | Custo de produção | `pcp.custo_producao` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:388` — Montagem lança custo somado produtos.kits |
| 16.16 | Entrada de produto acabado | `pcp.entrada_produto_acabado` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:388` — assembly_in do composto produtos.kits |
| 16.17 | Produção sob encomenda | `pcp.producao_sob_encomenda` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.18 | Produção para estoque | `pcp.producao_estoque` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:388` — Montagem para estoque produtos.kits |
| 16.19 | Indicadores de produtividade | `pcp.indicadores_produtividade` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.20 | Centros de trabalho | `pcp.centros_trabalho` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.21 | Roteiro de fabricação | `pcp.roteiro_fabricacao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.22 | Terceirização de produção | `pcp.terceirizacao_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.23 | Produção parcial | `pcp.producao_parcial` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.24 | Reprocessamento | `pcp.reprocessamento` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.25 | Controle de refugos | `pcp.controle_refugos` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.26 | Planejamento de capacidade | `pcp.planejamento_capacidade` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.27 | Sequenciamento de produção | `pcp.sequenciamento_producao` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.28 | Ordens de produção recorrentes | `pcp.ordens_producao_recorrentes` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.29 | Painel de chão de fábrica | `pcp.painel_chao_fabrica` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |
| 16.30 | Eficiência de equipamentos | `pcp.eficiencia_equipamentos` | NAO | FUT |  |  |  | Inexistente (sem ordem de produção, MRP ou apontamento) |

## 17 — LOGÍSTICA E ENTREGAS · `logistica` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 17.01 | Regiões de entrega | `logistica.regioes_entrega` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:114` — Zonas de entrega própria por faixa de CEP ecommerce.loja |
| 17.02 | Taxa de entrega fixa | `logistica.taxa_entrega_fixa` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:116` — Preço fixo por zona de CEP ecommerce.loja |
| 17.03 | Taxa por bairro | `logistica.taxa_bairro` | NAO | FUT |  |  |  | Bairro só em endereço |
| 17.04 | Taxa por quilometragem | `logistica.taxa_quilometragem` | NAO | FUT |  |  |  | `src/domain/ecommerce/store.ts:95` — maxDistanceKm salvo mas nunca usado |
| 17.05 | Taxa por faixa de distância | `logistica.taxa_faixa_distancia` | NAO | FUT |  |  |  | Inexistente |
| 17.06 | Taxa por valor do pedido | `logistica.taxa_valor_pedido` | NAO | FUT |  |  |  | Só mínimo para frete grátis |
| 17.07 | Frete grátis condicionado | `logistica.frete_gratis_condicionado` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:82` — Frete grátis por mínimo e modalidades ecommerce.loja |
| 17.08 | Cálculo automático de frete | `logistica.calculo_automatico_frete` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:76` — Zona própria real; transportadora simulada ecommerce.loja |
| 17.09 | Entregadores próprios | `logistica.entregadores_proprios` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:381` — Entrega própria com romaneio; sem cadastro de entregador ecommerce.loja |
| 17.10 | Entregadores terceirizados | `logistica.entregadores_terceirizados` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:303` — Entrega por app só simulada (delivery_api) · Entrega por aplicativo |
| 17.11 | Distribuição de entregas | `logistica.distribuicao_entregas` | NAO | FUT |  |  |  | Inexistente |
| 17.12 | Roteirização | `logistica.roteirizacao` | NAO | FUT |  |  |  | Inexistente |
| 17.13 | Aplicativo do entregador | `logistica.aplicativo_entregador` | NAO | FUT |  |  |  | Inexistente |
| 17.14 | Rastreamento de entrega | `logistica.rastreamento_entrega` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:65` — Página pública do pedido; rastreio simulado ecommerce.loja |
| 17.15 | Comprovante de entrega | `logistica.comprovante_entrega` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:457` — Confirmação manual; código de retirada ecommerce.loja |
| 17.16 | Previsão de entrega | `logistica.previsao_entrega` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/shipping.ts:43` — Prazo real na zona; simulado na transportadora ecommerce.loja |
| 17.17 | Ocorrências de entrega | `logistica.ocorrencias_entrega` | NAO | FUT |  |  |  | Inexistente |
| 17.18 | Acerto com entregadores | `logistica.acerto_entregadores` | NAO | FUT |  |  |  | Inexistente |
| 17.19 | Expedição | `logistica.expedicao` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:422` — Despacho com baixa de estoque ecommerce.loja |
| 17.20 | Separação de pedidos | `logistica.separacao_pedidos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:352` — Separação exige NF-e emitida ecommerce.loja |
| 17.21 | Conferência de pedidos | `logistica.conferencia_pedidos` | OP | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:352` — Conferência junto da separação ecommerce.loja |
| 17.22 | Integração com transportadoras | `logistica.integracao_transportadoras` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:315` — carrier_api não ligado; simulação · Transportadoras |
| 17.23 | Gestão de coletas | `logistica.gestao_coletas` | NAO | FUT |  |  |  | Inexistente |
| 17.24 | Agendamento logístico | `logistica.agendamento_logistico` | NAO | FUT |  |  |  | Inexistente |
| 17.25 | Entrega parcial | `logistica.entrega_parcial` | NAO | FUT |  |  |  | Inexistente |
| 17.26 | Reentrega | `logistica.reentrega` | NAO | FUT |  |  |  | Inexistente |
| 17.27 | Controle de fretes | `logistica.controle_fretes` | PARC | ADD | → 03.13 |  | `compras.cte` | `src/domain/freight-cte.ts:17` — Frete de compra por CT-e compras.cte |
| 17.28 | Cotação de fretes | `logistica.cotacao_fretes` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:293` — Cotação por tabela simulada · Cotação de fretes |
| 17.29 | Gestão de cargas | `logistica.gestao_cargas` | NAO | FUT |  |  |  | MDF-e planejado |
| 17.30 | Indicadores logísticos | `logistica.indicadores_logisticos` | NAO | FUT |  |  |  | Inexistente |

## 18 — GESTÃO FINANCEIRA · `financeiro` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 18.01 | Contas a pagar | `financeiro.contas_pagar` | OP | MOD | **U** |  | `financeiro.contas_pagar` | `src/domain/finance.ts:99` — Títulos a pagar, baixa, estorno financeiro.contas_pagar |
| 18.02 | Contas a receber | `financeiro.contas_receber` | OP | MOD | **U** |  | `financeiro.contas_receber` | `src/domain/finance.ts:99` — Títulos a receber financeiro.contas_receber |
| 18.03 | Fluxo de caixa | `financeiro.fluxo_caixa` | OP | MOD | **U** |  | `financeiro.fluxo_caixa` | `src/domain/cashflow.ts:188` — Realizado e previsto financeiro.fluxo_caixa |
| 18.04 | Contas bancárias | `financeiro.contas_bancarias` | OP | COMP |  |  | `tec.financeiro` | `src/domain/finance.ts:1010` — Caixa, banco e carteira com chave Pix tec.financeiro |
| 18.05 | Emissão de boletos | `financeiro.emissao_boletos` | NAO | FUT |  |  |  | `src/domain/finance.ts:1186` — Boleto só como meio de venda com nosso número manual |
| 18.06 | Cobrança PIX | `financeiro.cobranca_pix` | PARC | COMP |  |  | `tec.pagamentos` | `src/domain/payments/providers.ts:76` — Pix dinâmico só no PDV; títulos só Pix estático tec.pagamentos · Cobrança PIX no financeiro reutiliza o recurso de PIX |
| 18.07 | Cobranças recorrentes | `financeiro.cobrancas_recorrentes` | NAO | FUT |  |  |  | Inexistente |
| 18.08 | Baixa manual de títulos | `financeiro.baixa_manual_titulos` | OP | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/finance.ts:320` — settleInstallment financeiro.contas_receber |
| 18.09 | Baixa automática de títulos | `financeiro.baixa_automatica_titulos` | PARC | MOD | → 18.10 |  | `financeiro.conciliacao` | `src/domain/reconciliation.ts:492` — Retorno CNAB casa nosso número; usuário confirma financeiro.conciliacao |
| 18.10 | Conciliação bancária | `financeiro.conciliacao_bancaria` | OP | MOD | **U** |  | `financeiro.conciliacao` | `src/domain/reconciliation.ts:123` — OFX, CSV e CNAB financeiro.conciliacao |
| 18.11 | Conciliação de cartões | `financeiro.conciliacao_cartoes` | OP | ADD | **U** | 18.44 | `financeiro.taxas_adquirente` | `src/domain/card-reconciliation.ts:151` — Arquivo da adquirente financeiro.taxas_adquirente |
| 18.12 | Conciliação PIX | `financeiro.conciliacao_pix` | PARC | COMP |  |  | `tec.pagamentos` | `src/domain/payments/intents.ts:124` — Confirmação do Pix PDV via MP; sem conciliação Pix tec.pagamentos |
| 18.13 | Inadimplência | `financeiro.inadimplencia` | OP | ADD | **U** | 18.02 | `financeiro.inadimplencia` | `src/domain/delinquency.ts:37` — Alerta e bloqueio na venda financeiro.inadimplencia |
| 18.14 | Renegociação de dívidas | `financeiro.renegociacao_dividas` | OP | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/finance.ts:1478` — Renegociação com desfazer financeiro.contas_receber |
| 18.15 | Juros e multas | `financeiro.juros_multas` | OP | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/finance.ts:810` — Multa e juros sugeridos na baixa financeiro.contas_receber |
| 18.16 | Centros de custos | `financeiro.centros_custos` | OP | COMP |  |  | `tec.financeiro` | `src/domain/finance.ts:1344` — Centros de custo em 3 níveis tec.financeiro |
| 18.17 | Plano de contas | `financeiro.plano_contas` | OP | COMP |  |  | `tec.financeiro` | `src/domain/finance.ts:1311` — Plano de contas até 6 níveis tec.financeiro |
| 18.18 | DRE gerencial | `financeiro.dre_gerencial` | OP | MOD | **U** |  | `financeiro.relatorios` | `src/domain/finance-reports.ts:113` — DRE por competência financeiro.relatorios |
| 18.19 | Controle de despesas | `financeiro.controle_despesas` | OP | MOD | → 18.01 |  | `financeiro.contas_pagar` | `src/domain/finance.ts:845` — Títulos manuais com categoria financeiro.contas_pagar |
| 18.20 | Controle de receitas | `financeiro.controle_receitas` | OP | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/finance.ts:845` — Títulos a receber manuais financeiro.contas_receber |
| 18.21 | Previsão financeira | `financeiro.previsao_financeira` | OP | MOD | → 18.03 |  | `financeiro.fluxo_caixa` | `src/domain/cashflow.ts:13` — Previsto pelas parcelas e cartões financeiro.fluxo_caixa |
| 18.22 | Fechamento consolidado | `financeiro.fechamento_consolidado` | PARC | ADD | **U** | 18.03 | `financeiro.fechamento_periodo` | `src/domain/period-close.ts:75` — Fechamento por empresa; DRE consolida filiais financeiro.fechamento_periodo |
| 18.23 | Crédito de clientes | `financeiro.credito_clientes` | OP | ADD | → 08.04 |  | `vendas.devolucoes` | `src/lib/db/schema.ts:564` — Vale-troca (credit_vouchers) vendas.devolucoes |
| 18.24 | Limite de crédito | `financeiro.limite_credito` | OP | MOD | → 01.02 |  | `cadastros.clientes` | `src/domain/sales.ts:416` — Limite de crédito checado no crediário cadastros.clientes |
| 18.25 | Crediário | `financeiro.crediario` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/sales.ts:406` — Crediário próprio com carnê vendas.pdv |
| 18.26 | Adiantamentos | `financeiro.adiantamentos` | PARC | ADD | → 52.07 |  | `rede.financeiro` | `src/domain/finance-reports.ts:36` — Só carteira pré-paga da rede rede.financeiro |
| 18.27 | Reembolsos | `financeiro.reembolsos` | PARC | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:950` — Estorno em cancelamento e devolução vendas.devolucoes |
| 18.28 | Rateio financeiro | `financeiro.rateio_financeiro` | NAO | FUT |  |  |  | Um centro de custo por título |
| 18.29 | Aprovação de pagamentos | `financeiro.aprovacao_pagamentos` | OP | PERM | → 18.01 |  | `financeiro.contas_pagar` | `src/domain/finance.ts:724` — Aprovação de contas a pagar financeiro.contas_pagar · Autorização de contas a pagar |
| 18.30 | Orçamento financeiro | `financeiro.orcamento_financeiro` | NAO | FUT |  |  |  | Budget existe só em compras |
| 18.31 | Gestão de investimentos | `financeiro.gestao_investimentos` | NAO | FUT |  |  |  | `src/domain/finance.ts:1273` — Só grupo Investimentos no DRE |
| 18.32 | Empréstimos e financiamentos | `financeiro.emprestimos_financiamentos` | NAO | FUT |  |  |  | Inexistente |
| 18.33 | Antecipação de recebíveis | `financeiro.antecipacao_recebiveis` | NAO | FUT |  |  |  | Inexistente |
| 18.34 | Controle de cheques | `financeiro.controle_cheques` | NAO | FUT |  |  |  | Cheque só como ocorrência no CNAB |
| 18.35 | Gestão de cartões corporativos | `financeiro.gestao_cartoes_corporativos` | NAO | FUT |  |  |  | Inexistente |
| 18.36 | Tesouraria | `financeiro.tesouraria` | PARC | MOD | → 18.03 |  | `financeiro.fluxo_caixa` | `src/domain/finance.ts:737` — Transferências e saldos entre contas financeiro.fluxo_caixa |
| 18.37 | Regime de caixa e competência | `financeiro.regime_caixa_competencia` | OP | MOD | → 18.18 |  | `financeiro.relatorios` | `src/domain/finance-reports.ts:73` — Fluxo realizado e visão competência financeiro.relatorios |
| 18.38 | Resultado por unidade de negócio | `financeiro.resultado_unidade_negocio` | PARC | MOD | → 18.18 |  | `financeiro.relatorios` | `src/app/(app)/relatorios/financeiros/page.tsx:86` — DRE por filial; sem unidade de negócio financeiro.relatorios |
| 18.39 | Gestão de moedas e câmbio | `financeiro.gestao_moedas_cambio` | NAO | FUT |  |  |  | Inexistente |
| 18.40 | Gestão de parcelamentos | `financeiro.gestao_parcelamentos` | OP | COMP |  |  | `tec.financeiro` | `src/domain/finance.ts:74` — Parcelas e condições com juros tec.financeiro |
| 18.41 | Cobrança pelo WhatsApp com modelos de mensagem *(achado na auditoria)* | `financeiro.cobranca_pelo_whatsapp_modelos_mensagem` | OP | ADD | **U** | 18.02 | `financeiro.cobranca_whatsapp` | `src/domain/collection.ts:23` `src/domain/collection-templates.ts:1` |
| 18.42 | Impressão de carnê *(achado na auditoria)* | `financeiro.impressao_carne` | OP | ADD | **U** | 18.02 | `financeiro.carne` | `src/domain/carne.ts:92` `src/app/(app)/financeiro/receber/[id]/carne/page.tsx` |
| 18.43 | Baixa de títulos em lote *(achado na auditoria)* | `financeiro.baixa_titulos_lote` | OP | ADD | **U** | 18.02 | `financeiro.baixa_lote` | `src/domain/finance-batch.ts:172` |
| 18.44 | Recebíveis de cartão das vendas *(achado na auditoria)* | `financeiro.recebiveis_cartao_vendas` | OP | MOD | **U** |  | `financeiro.cartoes` | `src/app/(app)/financeiro/cartoes/page.tsx` |
| 18.45 | Aging de contas a receber e a pagar *(achado na auditoria)* | `financeiro.aging_contas_receber_pagar` | OP | MOD | → 18.18 |  | `financeiro.relatorios` | `src/domain/finance-reports.ts:285` |
| 18.46 | Aviso de vencimento por e-mail e anexos do título *(achado na auditoria)* | `financeiro.aviso_vencimento_mail_anexos_titulo` | OP | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/finance.ts:1674` `src/domain/finance.ts:981` |

## 19 — INTEGRAÇÕES BANCÁRIAS · `bancos` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 19.01 | Integração bancária por API | `bancos.integracao_bancaria_api` | PLAN | FUT |  |  |  | `src/domain/integrations.ts:100` — open_finance no catálogo, não implementado |
| 19.02 | Registro de boletos | `bancos.registro_boletos` | NAO | FUT |  |  |  | Sem registro de boleto |
| 19.03 | Consulta de boletos | `bancos.consulta_boletos` | NAO | FUT |  |  |  | Inexistente |
| 19.04 | Cancelamento de boletos | `bancos.cancelamento_boletos` | NAO | FUT |  |  |  | Inexistente |
| 19.05 | Liquidação automática | `bancos.liquidacao_automatica` | PARC | MOD | → 18.10 |  | `financeiro.conciliacao` | `src/domain/reconciliation.ts:492` — Baixa pelo retorno CNAB, confirmada financeiro.conciliacao |
| 19.06 | Remessa CNAB | `bancos.remessa_cnab` | NAO | FUT |  |  |  | Sem geração de remessa |
| 19.07 | Retorno CNAB | `bancos.retorno_cnab` | OP | MOD | → 18.10 |  | `financeiro.conciliacao` | `src/domain/bank/cnab240.ts:69` `src/domain/bank/cnab400.ts:57` — CNAB 240 T/U e 400 Itaú/Bradesco financeiro.conciliacao |
| 19.08 | Consulta de extrato | `bancos.consulta_extrato` | PARC | MOD | → 18.10 |  | `financeiro.conciliacao` | `src/domain/bank/ofx.ts:25` — Extrato só por arquivo OFX/CSV financeiro.conciliacao |
| 19.09 | Consulta de saldo | `bancos.consulta_saldo` | PARC | MOD | → 18.10 |  | `financeiro.conciliacao` | `src/domain/reconciliation.ts:562` — Saldo do último extrato importado financeiro.conciliacao |
| 19.10 | PIX dinâmico | `bancos.pix_dinamico` | EXT | INT |  |  | `tec.pagamentos` | `src/domain/payments/providers.ts:76` — Pix dinâmico Mercado Pago só no PDV tec.pagamentos · PIX dinâmico (Mercado Pago) · PIX dinâmico bancário usa o conector bancário; o QR é o mesmo recurso |
| 19.11 | Notificações bancárias | `bancos.notificacoes_bancarias` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:127` — Webhook do Gateway Intercert reservado; simulação |
| 19.12 | Pagamento de fornecedores | `bancos.pagamento_fornecedores` | NAO | FUT |  |  |  | Pagamento só por baixa manual |
| 19.13 | Integração Bradesco | `bancos.integracao_bradesco` | PARC | INT | → 18.10 |  | `financeiro.conciliacao` | `src/domain/bank/cnab400.ts:43` — Só layout de retorno 400 Bradesco; sem API financeiro.conciliacao · Bradesco: só layout CNAB 400 de retorno |
| 19.14 | Integração com outros bancos | `bancos.integracao_outros_bancos` | PARC | INT | → 18.10 |  | `financeiro.conciliacao` | `src/domain/bank/cnab240.ts:4` — FEBRABAN 240 e Itaú 400; só retorno financeiro.conciliacao · Outros bancos: CNAB 240/400 de retorno |
| 19.15 | Alteração de vencimento | `bancos.alteracao_vencimento` | PARC | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/finance.ts:929` — Vencimento alterado só localmente financeiro.contas_receber |
| 19.16 | Alteração de instruções de cobrança | `bancos.alteracao_instrucoes_cobranca` | NAO | FUT |  |  |  | Inexistente |
| 19.17 | Segunda via de boleto | `bancos.segunda_via_boleto` | NAO | FUT |  |  |  | Inexistente |
| 19.18 | Protesto de títulos | `bancos.protesto_titulos` | NAO | FUT |  |  |  | `src/domain/bank/cnab400.ts:20` — Só rótulos de ocorrência |
| 19.19 | Pagamentos em lote | `bancos.pagamentos_lote` | PARC | ADD | → 18.43 |  | `financeiro.baixa_lote` | `src/domain/finance-batch.ts:172` — Baixa em lote interna financeiro.baixa_lote |
| 19.20 | Transferências bancárias | `bancos.transferencias_bancarias` | PARC | ADD | → 36.17 |  | `ecommerce.banco` | `src/domain/ecommerce/bank.ts:122` — Repasse do Banco Intercert em rascunho ecommerce.banco |
| 19.21 | Gestão de convênios bancários | `bancos.gestao_convenios_bancarios` | NAO | FUT |  |  |  | `src/lib/db/schema.ts:587` — Conta só tem banco, agência e número |
| 19.22 | Open Finance | `bancos.open_finance` | PLAN | FUT |  |  |  | `src/domain/integrations.ts:100` — Igual a 19.01 |
| 19.23 | Monitoramento de integrações | `bancos.monitoramento_integracoes` | PARC | CORE |  |  | `plataforma.administracao` | `src/domain/integrations.ts:736` — Logs de integração e monitor da loja plataforma.administracao |
| 19.24 | Reprocessamento bancário | `bancos.reprocessamento_bancario` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/monitor.ts:43` — Reprocessa só eventos do comércio digital ecommerce.loja |
| 19.25 | PIX recorrente e automático | `bancos.pix_recorrente_automatico` | NAO | FUT |  |  |  | Inexistente |

## 20 — CRM E FIDELIZAÇÃO DO CLIENTE DO ERP · `crm` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 20.01 | Histórico de relacionamento | `crm.historico_relacionamento` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/domain/customers.ts:247` — Ficha com compras, títulos, créditos e auditoria; sem registro de contatos cadastros.clientes |
| 20.02 | Segmentação de clientes | `crm.segmentacao_clientes` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/app/(app)/clientes/queries.ts:9` — Só filtros; sem segmentos salvos cadastros.clientes |
| 20.03 | Programa de fidelidade | `crm.programa_fidelidade` | OP | ADD | **U** | 01.02, 07.01 | `clientes.fidelidade` | `src/domain/loyalty.ts:10` — Pontos por venda, resgate no PDV, validade, estorno clientes.fidelidade |
| 20.04 | Pontuação | `crm.pontuacao` | OP | ADD | → 20.03 |  | `clientes.fidelidade` | `src/domain/loyalty.ts:59` — Pontos por R$ e extrato clientes.fidelidade |
| 20.05 | Cashback | `crm.cashback` | NAO | FUT |  |  |  | Sem cashback |
| 20.06 | Vale-presente | `crm.vale_presente` | NAO | FUT |  |  |  | `src/lib/db/schema.ts:564` — Só vale-crédito de devolução; sem vale-presente vendável · Vale-presente é um tipo de voucher |
| 20.07 | Campanhas promocionais | `crm.campanhas_promocionais` | PARC | ADD | → 25.01 |  | `produtos.promocoes` | `src/domain/promotions.ts:78` — Promoções de PDV e cupons; sem campanha de CRM produtos.promocoes |
| 20.08 | Recuperação de clientes inativos | `crm.recuperacao_clientes_inativos` | NAO | FUT |  |  |  | `src/app/(app)/clientes/queries.ts:48` — Só filtro comprou em 90 dias |
| 20.09 | Recuperação de carrinhos abandonados | `crm.recuperacao_carrinhos_abandonados` | PARC | ADD | ≡ 12.23 |  | `ecommerce.promocoes` | `src/domain/ecommerce/promotions.ts:123` — Carrinhos parados; mensagem só rascunho ecommerce.promocoes · Recuperação de carrinho é uma só |
| 20.10 | Frequência de compras | `crm.frequencia_compras` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/app/(app)/clientes/queries.ts:21` — Nº de compras e última compra cadastros.clientes |
| 20.11 | Funil comercial | `crm.funil_comercial` | NAO | FUT |  |  |  | Sem funil comercial |
| 20.12 | Gestão de oportunidades | `crm.gestao_oportunidades` | NAO | FUT |  |  |  | Sem oportunidades |
| 20.13 | Cadastro de leads | `crm.cadastro_leads` | NAO | FUT |  |  |  | Sem leads |
| 20.14 | Agenda comercial | `crm.agenda_comercial` | NAO | FUT |  |  |  | Sem agenda comercial |
| 20.15 | Follow-up | `crm.follow_up` | PARC | ADD | → 52.06 |  | `rede.renovacoes` | `src/domain/network/renewals.ts:108` — Só contatos de renovação da rede rede.renovacoes |
| 20.16 | Pesquisa de satisfação | `crm.pesquisa_satisfacao` | NAO | FUT |  |  |  | Sem pesquisa de satisfação |
| 20.17 | Gestão de reclamações | `crm.gestao_reclamacoes` | NAO | FUT |  |  |  | Sem reclamações de cliente |
| 20.18 | Perfil de consumo | `crm.perfil_consumo` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/domain/customers.ts:268` — Ticket médio e última compra cadastros.clientes |
| 20.19 | Aniversariantes | `crm.aniversariantes` | OP | MOD | → 01.02 |  | `cadastros.clientes` | `src/app/(app)/clientes/queries.ts:79` — Aniversariantes dos próximos 7 dias cadastros.clientes |
| 20.20 | Indicação de clientes | `crm.indicacao_clientes` | PARC | ADD | → 52.07 |  | `rede.financeiro` | `src/domain/network/billing-plan.ts:48` — Só indicação de contador na rede rede.financeiro |
| 20.21 | Clube de benefícios | `crm.clube_beneficios` | NAO | FUT |  |  |  | Sem clube de benefícios |
| 20.22 | Gestão de vouchers | `crm.gestao_vouchers` | PARC | ADD | → 52.04 |  | `rede.vouchers_cupons` | `src/domain/network/vouchers.ts:65` — Vouchers só da rede rede.vouchers_cupons |

## 21 — RELATÓRIOS E INTELIGÊNCIA DE NEGÓCIO · `bi` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 21.01 | Dashboard gerencial | `bi.dashboard_gerencial` | OP | CORE |  |  | `plataforma.painel` | `src/app/(app)/dashboard/page.tsx` — Painel com faturamento, ticket, margem e alertas plataforma.painel |
| 21.02 | Relatórios de vendas | `bi.relatorios_vendas` | OP | MOD | **U** |  | `relatorios.gerenciais` | `src/domain/reports.ts:505` — Gerenciais por dia, categoria, operador, pagamento relatorios.gerenciais |
| 21.03 | Relatórios de compras | `bi.relatorios_compras` | OP | MOD | → 05.04 |  | `compras.pedidos` | `src/exports/purchases.ts:11` — Pedidos, recebimentos, cotações compras.pedidos |
| 21.04 | Relatórios financeiros | `bi.relatorios_financeiros` | OP | MOD | → 18.18 |  | `financeiro.relatorios` | `src/domain/finance-reports.ts:113` — DRE, aging, fluxo financeiro.relatorios |
| 21.05 | Relatórios fiscais | `bi.relatorios_fiscais` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/reports.ts:79` — Resumo, livro de saídas, NCM, CFOP tec.fiscal |
| 21.06 | Relatórios de estoque | `bi.relatorios_estoque` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/exports/stock.ts:10` — Saldos, kardex, inventários, validades estoque.gestao · Relatórios de estoque reutilizam histórico e saldos |
| 21.07 | Relatórios de produção | `bi.relatorios_producao` | NAO | FUT |  |  |  | Sem produção |
| 21.08 | Relatórios de logística | `bi.relatorios_logistica` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/expedicao/page.tsx` — Só a tela de expedição ecommerce.loja |
| 21.09 | Relatórios de PDV | `bi.relatorios_pdv` | OP | MOD | → 07.02 |  | `caixa.operacao` | `src/exports/cash.ts:7` — Sessões e operações de caixa caixa.operacao |
| 21.10 | Relatórios de e-commerce | `bi.relatorios_commerce` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/page.tsx:126` — Contadores e lista de pedidos ecommerce.loja |
| 21.11 | Relatórios de lucratividade | `bi.relatorios_lucratividade` | OP | MOD | → 10.17 |  | `relatorios.curva_abc` | `src/domain/abc.ts:150` — Margem e curva ABC por margem relatorios.curva_abc |
| 21.12 | Relatórios de comissões | `bi.relatorios_comissoes` | OP | MOD | → 06.12 |  | `vendas.comissoes` | `src/exports/commissions.ts:8` — Apuração e fechamento vendas.comissoes · Relatório de comissões vem da apuração de comissões |
| 21.13 | Comparativo entre filiais | `bi.comparativo_entre_filiais` | OP | MOD | → 21.02 |  | `relatorios.gerenciais` | `src/exports/reports.ts:33` — Resultado por unidade e filial relatorios.gerenciais |
| 21.14 | Comparativo entre canais | `bi.comparativo_entre_canais` | NAO | FUT |  |  |  | Sem separação PDV × loja |
| 21.15 | Exportação de relatórios | `bi.exportacao_relatorios` | OP | CORE |  |  | `plataforma.administracao` | `src/lib/exporters.ts:102` — CSV/XLSX por chave plataforma.administracao |
| 21.16 | Indicadores personalizados | `bi.indicadores_personalizados` | NAO | FUT |  |  |  | Só limites da ABC configuráveis |
| 21.17 | Construtor de relatórios | `bi.construtor_relatorios` | NAO | FUT |  |  |  | `src/lib/report-catalog.ts:28` — Catálogo fixo |
| 21.18 | Relatórios programados | `bi.relatorios_programados` | NAO | FUT |  |  |  | Sem relatório programado |
| 21.19 | Análise de ticket médio | `bi.analise_ticket_medio` | OP | CORE |  |  | `plataforma.painel` | `src/app/(app)/dashboard/page.tsx` — Ticket médio com comparativo plataforma.painel |
| 21.20 | Análise de rentabilidade | `bi.analise_rentabilidade` | OP | MOD | → 18.18 |  | `financeiro.relatorios` | `src/domain/finance-reports.ts:113` — DRE com CMV financeiro.relatorios |
| 21.21 | Análise de sazonalidade | `bi.analise_sazonalidade` | NAO | FUT |  |  |  | Sem sazonalidade |
| 21.22 | Análise de clientes | `bi.analise_clientes` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/app/(app)/clientes/page.tsx:75` — Indicadores básicos de clientes cadastros.clientes |
| 21.23 | Projeção de demanda | `bi.projecao_demanda` | PARC | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:21` — Consumo médio, sem previsão compras.reposicao |
| 21.24 | Projeção de vendas | `bi.projecao_vendas` | PARC | MOD | → 06.13 |  | `gestao.metas` | `src/domain/goals.ts:198` — Projeção de fim de mês das metas gestao.metas |
| 21.25 | Dashboards personalizados | `bi.dashboards_personalizados` | NAO | FUT |  |  |  | Cartões fixos |
| 21.26 | Integração com ferramentas de BI | `bi.integracao_ferramentas_bi` | NAO | FUT |  |  |  | Sem conector de BI |

## 22 — GESTÃO CONTÁBIL E OBRIGAÇÕES FISCAIS · `contabil` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 22.01 | Exportação para contabilidade | `contabil.exportacao_contabilidade` | OP | MOD | → 22.07 |  | `integracao.contabilidade` | `src/domain/fiscal/export.ts:166` — Pacote ZIP de XML+CSV ao contador integracao.contabilidade |
| 22.02 | SPED Fiscal | `contabil.sped_fiscal` | OP | MOD | **U** |  | `fiscal.sped` | `src/domain/fiscal/files/sped-fiscal.ts:82` — EFD ICMS/IPI gerada; validar no PVA fiscal.sped |
| 22.03 | EFD Contribuições | `contabil.efd_contribuicoes` | OP | MOD | → 22.02 |  | `fiscal.sped` | `src/domain/fiscal/files/efd-contribuicoes.ts:100` — EFD Contribuições gerada fiscal.sped |
| 22.04 | Apuração de impostos | `contabil.apuracao_impostos` | PARC | MOD | → 22.02 |  | `fiscal.sped` | `src/domain/fiscal/files/sped-fiscal.ts:164` — Só E110 e PIS/COFINS fiscal.sped |
| 22.05 | Livros fiscais | `contabil.livros_fiscais` | OP | MOD | **U** |  | `fiscal.livro_entradas` | `src/domain/fiscal/entries.ts:340` — Livros de entradas e saídas fiscal.livro_entradas |
| 22.06 | Relatórios tributários | `contabil.relatorios_tributarios` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/reports.ts:222` — Tributos por NCM e CFOP tec.fiscal |
| 22.07 | Integração contábil | `contabil.integracao_contabil` | OP | MOD | **U** |  | `integracao.contabilidade` | `src/domain/accounting/link.ts:64` — Vínculo empresa–escritório com envio automático integracao.contabilidade |
| 22.08 | Portal do contador | `contabil.portal_contador` | PARC | ADD | → 51.04 |  | `contabil.entregas` | `src/domain/accounting/deliveries.ts:31` — Escritório recebe pacotes; não é portal completo contabil.entregas |
| 22.09 | Escrituração contábil | `contabil.escrituracao_contabil` | NAO | FUT |  |  |  | Sem escrituração |
| 22.10 | Lançamentos contábeis | `contabil.lancamentos_contabeis` | PARC | MOD | → 22.21 |  | `financeiro.exportacao_dominio` | `src/domain/accounting/dominio.ts:146` — Débito/crédito só no arquivo Domínio financeiro.exportacao_dominio |
| 22.11 | Plano de contas contábil | `contabil.plano_contas_contabil` | PARC | COMP |  |  | `tec.financeiro` | `src/lib/db/schema.ts:590` — Categorias com código contábil tec.financeiro |
| 22.12 | Balancete | `contabil.balancete` | NAO | FUT |  |  |  | Sem balancete |
| 22.13 | Balanço patrimonial | `contabil.balanco_patrimonial` | NAO | FUT |  |  |  | Sem balanço |
| 22.14 | DRE contábil | `contabil.dre_contabil` | NAO | FUT |  |  |  | Só DRE gerencial |
| 22.15 | ECD | `contabil.ecd` | NAO | FUT |  |  |  | Sem ECD |
| 22.16 | ECF | `contabil.ecf` | NAO | FUT |  |  |  | Sem ECF |
| 22.17 | Controle de retenções | `contabil.controle_retencoes` | PARC | MOD | → 04.03 |  | `fiscal.nfse` | `src/domain/fiscal/calc.ts:22` — Retenções só na NFS-e fiscal.nfse |
| 22.18 | Calendário de obrigações | `contabil.calendario_obrigacoes` | OP | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/obligations.ts:18` — Calendário e comprovação tec.fiscal |
| 22.19 | Fechamento contábil | `contabil.fechamento_contabil` | PARC | ADD | → 18.22 |  | `financeiro.fechamento_periodo` | `src/domain/period-close.ts:100` — Fechamento é financeiro financeiro.fechamento_periodo |
| 22.20 | Conciliação contábil | `contabil.conciliacao_contabil` | NAO | FUT |  |  |  | Sem conciliação contábil |
| 22.21 | Exportação de lançamentos para a Domínio *(achado na auditoria)* | `contabil.exportacao_lancamentos_dominio` | OP | MOD | **U** |  | `financeiro.exportacao_dominio` | `src/domain/accounting/dominio.ts:146` `src/app/(app)/financeiro/exportacao-dominio/page.tsx` |
| 22.22 | Sintegra *(achado na auditoria)* | `contabil.sintegra` | OP | MOD | **U** |  | `fiscal.sintegra` | `src/domain/fiscal/files/sintegra.ts` `src/app/(app)/fiscal/arquivos/sintegra/page.tsx` |

## 23 — INTEGRAÇÃO COM EQUIPAMENTOS · `equipamentos` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 23.01 | Impressora térmica | `equipamentos.impressora_termica` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/terminals.ts:20` — Impressão pelo navegador; conector ESC/POS externo vendas.pdv |
| 23.02 | Impressora de etiquetas | `equipamentos.impressora_etiquetas` | PARC | ADD | → 09.13 |  | `produtos.etiquetas` | `src/domain/labels.ts:18` — Etiquetas em folha; sem ZPL produtos.etiquetas · Impressora de etiquetas é o dispositivo do recurso de etiquetas |
| 23.03 | Leitor de código de barras | `equipamentos.leitor_codigo_barras` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/terminals.ts:25` — Leitor como teclado no PDV e inventário vendas.pdv |
| 23.04 | Balança eletrônica | `equipamentos.balanca_eletronica` | OP | ADD | ≡ 46.01 |  | `produtos.balanca` | `src/domain/scale.ts:277` — EAN 2 e carga Toledo/Filizola produtos.balanca · Balança eletrônica (dispositivo) = integração com balança |
| 23.05 | Gaveta de dinheiro | `equipamentos.gaveta_dinheiro` | DEV | FUT |  |  |  | `src/app/(app)/administracao/terminais/terminal-form.tsx:70` — drawerOnCash salvo mas nunca usado |
| 23.06 | Pin Pad | `equipamentos.pin_pad` | DEV | FUT |  |  |  | `src/domain/terminals.ts:30` — TEF por conector: só contrato e teste |
| 23.07 | Smart POS | `equipamentos.smart_pos` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/pagamento/payment-app.tsx:408` — Maquininha avulsa com NSU manual vendas.pdv |
| 23.08 | Terminal de autoatendimento | `equipamentos.terminal_autoatendimento` | NAO | FUT |  |  |  | Sem totem |
| 23.09 | Coletor de dados | `equipamentos.coletor_dados` | PARC | ADD | → 10.09 |  | `estoque.inventario` | `src/domain/count-scan.ts:33` — Bipagem na contagem estoque.inventario |
| 23.10 | Display de atendimento | `equipamentos.display_atendimento` | NAO | FUT |  |  |  | Sem display |
| 23.11 | Impressora de cozinha | `equipamentos.impressora_cozinha` | NAO | FUT |  |  |  | Sem impressora de cozinha |
| 23.12 | Impressora de escritório | `equipamentos.impressora_escritorio` | OP | COMP |  |  | `tec.fiscal` | `src/app/(app)/fiscal/_components/print-page.tsx:6` — A4 pelo navegador tec.fiscal |
| 23.13 | Equipamentos RFID | `equipamentos.equipamentos_rfid` | NAO | FUT |  |  |  | Sem RFID |
| 23.14 | Dispositivos móveis | `equipamentos.dispositivos_moveis` | PARC | CORE |  |  | `plataforma.painel` | `src/app/manifest.ts:14` — PWA instalável; offline só página plataforma.painel |
| 23.15 | Gerenciamento de dispositivos | `equipamentos.gerenciamento_dispositivos` | OP | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/terminals.ts:148` — Cadastro de terminais vendas.pdv |
| 23.16 | Monitoramento de equipamentos | `equipamentos.monitoramento_equipamentos` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/domain/terminals.ts:178` — Teste do conector gravado vendas.pdv |

## 24 — ADMINISTRAÇÃO E SEGURANÇA · `admin` · Implementado parcialmente · CORE

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 24.01 | Gestão de usuários | `admin.gestao_usuarios` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/users.ts:256` — Usuários com convite, suspensão e escopo plataforma.administracao |
| 24.02 | Gestão de cargos | `admin.gestao_cargos` | NAO | FUT |  |  |  | `src/lib/db/schema.ts:97` — Sem cargo · Cargos: um cadastro |
| 24.03 | Gestão de permissões | `admin.gestao_permissoes` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/roles.ts:212` — Perfis com módulos e ações plataforma.administracao |
| 24.04 | Gestão de filiais | `admin.gestao_filiais` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/companies.ts:273` — Filiais plataforma.administracao |
| 24.05 | Auditoria de operações | `admin.auditoria_operacoes` | OP | CORE |  |  | `plataforma.administracao` | `src/lib/core/audit.ts:35` — Auditoria com antes/depois plataforma.administracao |
| 24.06 | Histórico de alterações | `admin.historico_alteracoes` | OP | CORE |  |  | `plataforma.administracao` | `src/lib/core/audit.ts:64` — Diff na auditoria plataforma.administracao |
| 24.07 | Autenticação em dois fatores | `admin.autenticacao_dois_fatores` | OP | CORE |  |  | `plataforma.acesso` | `src/domain/two-factor.ts:68` — TOTP e recuperação plataforma.acesso |
| 24.08 | Gestão de sessões | `admin.gestao_sessoes` | PARC | CORE |  |  | `plataforma.acesso` | `src/domain/users.ts:439` — Sessões encerradas ao suspender; sem tela plataforma.acesso |
| 24.09 | Aprovação de operações | `admin.aprovacao_operacoes` | OP | MOD | → 05.05 |  | `compras.aprovacoes` | `src/domain/approvals.ts:95` — Política de compras, autorização de pagar, supervisor compras.aprovacoes |
| 24.10 | Configurações empresariais | `admin.configuracoes_empresariais` | OP | CORE |  |  | `plataforma.administracao` | `src/app/(app)/administracao/parametros/page.tsx` — Parâmetros por empresa/filial plataforma.administracao |
| 24.11 | API para integrações externas | `admin.api_integracoes_externas` | PARC | CORE |  |  | `plataforma.administracao` | `src/app/api/interos/v1/_lib.ts:12` — API só para o Interos plataforma.administracao |
| 24.12 | Webhooks | `admin.webhooks` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/api/loja/gateway/[provider]/[storeId]/route.ts:30` — Só recebe avisos ecommerce.loja |
| 24.13 | Importação de dados | `admin.importacao_dados` | OP | MOD | **U** |  | `implantacao.importacao` | `src/domain/data-import.ts:579` — CSV de cadastros, saldos e títulos implantacao.importacao |
| 24.14 | Exportação de dados | `admin.exportacao_dados` | OP | CORE |  |  | `plataforma.administracao` | `src/lib/exporters.ts:102` — Exportação CSV/XLSX plataforma.administracao |
| 24.15 | Gestão de departamentos | `admin.gestao_departamentos` | PARC | MOD | → 51.01 |  | `contabil.carteira` | `src/lib/db/schema.ts:1044` — Departamentos só no escritório contabil.carteira · Departamentos (segurança) e departamentos (RH): um cadastro |
| 24.16 | Gestão de funções | `admin.gestao_funcoes` | PARC | CORE |  |  | `plataforma.administracao` | `src/domain/roles.ts:212` — Funções = perfis plataforma.administracao |
| 24.17 | Políticas de segurança | `admin.politicas_seguranca` | PARC | CORE |  |  | `plataforma.acesso` | `src/app/actions/session.ts:60` — Bloqueio após 5 falhas, 2FA por perfil plataforma.acesso |
| 24.18 | Restrição de acesso | `admin.restricao_acesso` | OP | CORE |  |  | `plataforma.acesso` | `src/lib/server/session.ts:49` — Restrição por empresa, filial, módulo plataforma.acesso · Restrição por empresa/filial/módulo |
| 24.19 | Gestão de dispositivos autorizados | `admin.gestao_dispositivos_autorizados` | NAO | FUT |  |  |  | Sem dispositivos confiáveis |
| 24.20 | Backup e recuperação | `admin.backup_recuperacao` | OP | CORE |  |  | `plataforma.backup` | `src/domain/backup.ts:168` — Backup, verificação e restauração plataforma.backup |
| 24.21 | Privacidade e LGPD | `admin.privacidade_lgpd` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/store.ts:237` — Texto de privacidade; sem direitos do titular ecommerce.loja |
| 24.22 | Gestão de consentimentos | `admin.gestao_consentimentos` | PARC | MOD | → 01.02 |  | `cadastros.clientes` | `src/lib/db/schema.ts:189` — Opt-in de promoções cadastros.clientes |
| 24.23 | Gestão de credenciais | `admin.gestao_credenciais` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/integrations.ts:9` — Credenciais por referência; segredos cifrados plataforma.administracao |
| 24.24 | Configurações de notificações | `admin.configuracoes_notificacoes` | OP | CORE |  |  | `plataforma.painel` | `src/domain/notifications.ts:177` — Silenciar tipos por usuário plataforma.painel |
| 24.25 | Gestão de acessos externos | `admin.gestao_acessos_externos` | PARC | MOD | → 22.07 |  | `integracao.contabilidade` | `src/domain/accounting/link.ts:36` — Acesso externo só do escritório e do Interos integracao.contabilidade |

## 25 — PROMOÇÕES E PRECIFICAÇÃO AVANÇADA · `precificacao` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 25.01 | Promoção por produto | `precificacao.promocao_produto` | OP | ADD | **U** | 01.04 | `produtos.promocoes` | `src/domain/promotions-calc.ts:21` — Escopo por SKU ou produto produtos.promocoes |
| 25.02 | Promoção por categoria | `precificacao.promocao_categoria` | OP | ADD | → 25.01 |  | `produtos.promocoes` | `src/domain/promotions-calc.ts:21` — Escopo por categoria produtos.promocoes |
| 25.03 | Promoção por quantidade | `precificacao.promocao_quantidade` | OP | ADD | → 25.01 |  | `produtos.promocoes` | `src/domain/promotions-calc.ts:20` — A partir de N produtos.promocoes |
| 25.04 | Promoção progressiva | `precificacao.promocao_progressiva` | NAO | FUT |  |  |  | `src/domain/promotions-calc.ts:16` — Uma faixa por regra |
| 25.05 | Leve mais e pague menos | `precificacao.leve_mais_pague_menos` | OP | ADD | → 25.01 |  | `produtos.promocoes` | `src/domain/promotions-calc.ts:20` — Leve X pague Y produtos.promocoes |
| 25.06 | Combos promocionais | `precificacao.combos_promocionais` | NAO | FUT |  |  |  | Sem combo promocional |
| 25.07 | Desconto por forma de pagamento | `precificacao.desconto_forma_pagamento` | NAO | FUT |  |  |  | Sem desconto por forma de pagamento |
| 25.08 | Desconto por perfil de cliente | `precificacao.desconto_perfil_cliente` | PARC | COMP |  |  | `tec.precos` | `src/lib/db/schema.ts:191` — Tabela de preço do cliente no PDV tec.precos |
| 25.09 | Preços por filial | `precificacao.precos_filial` | OP | COMP |  |  | `tec.precos` | `src/domain/pricing.ts:10` — Preço da filial tec.precos |
| 25.10 | Preços por canal de venda | `precificacao.precos_canal_venda` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/catalog.ts:36` — Só preço on-line da loja ecommerce.loja |
| 25.11 | Preços por região | `precificacao.precos_regiao` | NAO | FUT |  |  |  | Sem preço por região |
| 25.12 | Preços por período | `precificacao.precos_periodo` | OP | ADD | → 25.01 |  | `produtos.promocoes` | `src/domain/promotions-calc.ts:16` — Vigência, dias e horário produtos.promocoes |
| 25.13 | Reajuste em massa | `precificacao.reajuste_massa` | OP | ADD | ≡ 09.22 |  | `produtos.alteracao_massa` | `src/domain/price-adjust.ts:82` — Reajuste em massa com prévia produtos.alteracao_massa · Reajuste em massa = cadastro/alteração em massa |
| 25.14 | Simulação de margem | `precificacao.simulacao_margem` | OP | ADD | → 05.20 |  | `compras.precificacao` | `src/domain/receipt-pricing.ts:96` — Margem antes/depois compras.precificacao |
| 25.15 | Precificação automática | `precificacao.precificacao_automatica` | PARC | ADD | → 05.20 |  | `compras.precificacao` | `src/domain/receipt-pricing.ts:14` — Sugestão por margem-alvo; aplicação manual compras.precificacao |
| 25.16 | Aprovação de alterações de preço | `precificacao.aprovacao_alteracoes_preco` | NAO | FUT |  |  |  | Sem fluxo de aprovação de preço |

## 26 — SERVIÇOS E ORDENS DE SERVIÇO · `servicos` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 26.01 | Cadastro de serviços | `servicos.cadastro_servicos` | PARC | MOD | ≡ 01.05 |  | `cadastros.produtos` | `src/lib/db/schema.ts:222` — produto tipo serviço com LC116/ISS; sem cadastro próprio cadastros.produtos · Cadastro de serviços é um só (produtos do tipo serviço) |
| 26.02 | Ordem de serviço | `servicos.ordem_servico` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:144` — SRV-01 ordem de serviço ausente |
| 26.03 | Orçamento de serviço | `servicos.orcamento_servico` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/domain/sales-documents.ts:196` — orçamento comercial aceita item serviço vendas.documentos |
| 26.04 | Aprovação de orçamento | `servicos.aprovacao_orcamento` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/app/(app)/vendas/_documentos/actions.ts:59` — aprovação de orçamento genérica, não de OS vendas.documentos |
| 26.05 | Agendamento de serviço | `servicos.agendamento_servico` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:144` — agenda por técnico prevista em SRV-01 |
| 26.06 | Distribuição de técnicos | `servicos.distribuicao_tecnicos` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:144` — técnicos previstos em SRV-01 |
| 26.07 | Apontamento de horas | `servicos.apontamento_horas` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:157` — apontamento de horas ausente |
| 26.08 | Controle de materiais utilizados | `servicos.controle_materiais_utilizados` | NAO | FUT |  |  |  | sem OS nem consumo de materiais |
| 26.09 | Serviço externo | `servicos.servico_externo` | NAO | FUT |  |  |  | inexistente |
| 26.10 | Aplicativo do técnico | `servicos.aplicativo_tecnico` | NAO | FUT |  |  |  | sem app do técnico |
| 26.11 | Checklist de atendimento | `servicos.checklist_atendimento` | NAO | FUT |  |  |  | inexistente |
| 26.12 | Assinatura do cliente | `servicos.assinatura_cliente` | NAO | FUT |  |  |  | sem assinatura do cliente |
| 26.13 | Laudos técnicos | `servicos.laudos_tecnicos` | NAO | FUT |  |  |  | sem laudos |
| 26.14 | Garantia de serviço | `servicos.garantia_servico` | NAO | FUT |  |  |  | sem garantia de serviço |
| 26.15 | Faturamento de serviço | `servicos.faturamento_servico` | EXT | MOD | → 04.03 |  | `fiscal.nfse` | `src/domain/fiscal/service.ts:2036` — NFS-e avulsa via Focus NFe fiscal.nfse |
| 26.16 | Serviços recorrentes | `servicos.servicos_recorrentes` | NAO | FUT |  |  |  | sem recorrência de serviço |
| 26.17 | Histórico de atendimentos | `servicos.historico_atendimentos` | NAO | FUT |  |  |  | inexistente |
| 26.18 | Indicadores de serviço | `servicos.indicadores_servico` | NAO | FUT |  |  |  | inexistente |

## 27 — CONTRATOS E RECORRÊNCIA · `contratos` · Não implementado · FUT

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 27.01 | Cadastro de contratos | `contratos.cadastro_contratos` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:63` — sem tabela de contratos |
| 27.02 | Modelos de contratos | `contratos.modelos_contratos` | NAO | FUT |  |  |  | sem modelos de contrato |
| 27.03 | Assinatura eletrônica | `contratos.assinatura_eletronica` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:65` — sem provedor de assinatura eletrônica |
| 27.04 | Gestão de vigência | `contratos.gestao_vigencia` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:63` — vigência de contrato ausente |
| 27.05 | Renovação contratual | `contratos.renovacao_contratual` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:64` — renovação ausente |
| 27.06 | Reajuste contratual | `contratos.reajuste_contratual` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:63` — reajuste ausente |
| 27.07 | Faturamento recorrente | `contratos.faturamento_recorrente` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:95` — faturamento recorrente ausente |
| 27.08 | Contratos de prestação de serviços | `contratos.contratos_prestacao_servicos` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:63` — contrato de serviços ausente |
| 27.09 | Contratos de fornecimento | `contratos.contratos_fornecimento` | NAO | FUT |  |  |  | inexistente |
| 27.10 | Contratos de locação | `contratos.contratos_locacao` | NAO | FUT |  |  |  | inexistente |
| 27.11 | Aditivos contratuais | `contratos.aditivos_contratuais` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:64` — aditivos ausentes |
| 27.12 | Rescisões | `contratos.rescisoes` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:64` — distrato ausente |
| 27.13 | Gestão de SLA | `contratos.gestao_sla` | NAO | FUT |  |  |  | sem SLA contratual |
| 27.14 | Controle de obrigações contratuais | `contratos.controle_obrigacoes_contratuais` | NAO | FUT |  |  |  | inexistente |
| 27.15 | Alertas de vencimento | `contratos.alertas_vencimento` | NAO | FUT |  |  |  | alertas só de certificados/obrigações |
| 27.16 | Histórico contratual | `contratos.historico_contratual` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:64` — histórico contratual ausente |

## 28 — LOCAÇÕES E RESERVAS · `locacoes` · Não implementado · FUT

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 28.01 | Cadastro de itens locáveis | `locacoes.cadastro_itens_locaveis` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.02 | Disponibilidade de locação | `locacoes.disponibilidade_locacao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.03 | Reserva de equipamentos | `locacoes.reserva_equipamentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.04 | Reserva de espaços | `locacoes.reserva_espacos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.05 | Contrato de locação | `locacoes.contrato_locacao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.06 | Retirada de itens | `locacoes.retirada_itens` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.07 | Devolução de itens | `locacoes.devolucao_itens` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.08 | Cobrança por período | `locacoes.cobranca_periodo` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.09 | Controle de caução | `locacoes.controle_caucao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.10 | Controle de avarias | `locacoes.controle_avarias` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.11 | Renovação de locação | `locacoes.renovacao_locacao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.12 | Controle de atrasos | `locacoes.controle_atrasos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.13 | Inspeção de devolução | `locacoes.inspecao_devolucao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 28.14 | Histórico de locações | `locacoes.historico_locacoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 29 — PATRIMÔNIO E ATIVO IMOBILIZADO · `patrimonio` · Não implementado · FUT

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 29.01 | Cadastro patrimonial | `patrimonio.cadastro_patrimonial` | NAO | FUT |  |  |  | `src/domain/fiscal/entries.ts:89` — só CFOP 1551 classifica entrada de imobilizado |
| 29.02 | Identificação patrimonial | `patrimonio.identificacao_patrimonial` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.03 | Inventário patrimonial | `patrimonio.inventario_patrimonial` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.04 | Depreciação | `patrimonio.depreciacao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.05 | Transferência de patrimônio | `patrimonio.transferencia_patrimonio` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.06 | Baixa patrimonial | `patrimonio.baixa_patrimonial` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.07 | Controle de responsáveis | `patrimonio.controle_responsaveis` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.08 | Localização de ativos | `patrimonio.localizacao_ativos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.09 | Valoração de ativos | `patrimonio.valoracao_ativos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.10 | Histórico patrimonial | `patrimonio.historico_patrimonial` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.11 | Controle de garantias | `patrimonio.controle_garantias` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 29.12 | Gestão de documentos patrimoniais | `patrimonio.gestao_documentos_patrimoniais` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 30 — MANUTENÇÃO · `manutencao` · Não implementado · FUT

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 30.01 | Cadastro de equipamentos | `manutencao.cadastro_equipamentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.02 | Manutenção preventiva | `manutencao.manutencao_preventiva` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.03 | Manutenção corretiva | `manutencao.manutencao_corretiva` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.04 | Manutenção preditiva | `manutencao.manutencao_preditiva` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.05 | Ordem de manutenção | `manutencao.ordem_manutencao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.06 | Plano de manutenção | `manutencao.plano_manutencao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.07 | Controle de peças | `manutencao.controle_pecas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.08 | Controle de custos | `manutencao.controle_custos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.09 | Controle de paradas | `manutencao.controle_paradas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.10 | Agenda de manutenção | `manutencao.agenda_manutencao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.11 | Checklist de manutenção | `manutencao.checklist_manutencao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.12 | Histórico de equipamentos | `manutencao.historico_equipamentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 30.13 | Indicadores de manutenção | `manutencao.indicadores_manutencao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 31 — RECURSOS HUMANOS E DEPARTAMENTO PESSOAL · `rh` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 31.01 | Cadastro de colaboradores | `rh.cadastro_colaboradores` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:156` — usuários sem cargo/jornada |
| 31.02 | Gestão de departamentos | `rh.gestao_departamentos` | PARC | MOD | → 51.01 |  | `contabil.carteira` | `src/lib/db/schema.ts:1044` — departamentos só do escritório contábil contabil.carteira |
| 31.03 | Gestão de cargos | `rh.gestao_cargos` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:156` — perfis são permissões, não cargos |
| 31.04 | Organograma | `rh.organograma` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.05 | Controle de ponto | `rh.controle_ponto` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.06 | Escalas de trabalho | `rh.escalas_trabalho` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.07 | Banco de horas | `rh.banco_horas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.08 | Gestão de férias | `rh.gestao_ferias` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:156` — férias ausentes |
| 31.09 | Gestão de afastamentos | `rh.gestao_afastamentos` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:156` — afastamentos ausentes |
| 31.10 | Gestão de benefícios | `rh.gestao_beneficios` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.11 | Gestão de documentos | `rh.gestao_documentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.12 | Folha de pagamento | `rh.folha_pagamento` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:295` — folha ausente |
| 31.13 | Integração com eSocial | `rh.integracao_esocial` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:295` — eSocial ausente |
| 31.14 | Recrutamento e seleção | `rh.recrutamento_selecao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.15 | Avaliação de desempenho | `rh.avaliacao_desempenho` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.16 | Treinamentos | `rh.treinamentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.17 | Portal do colaborador | `rh.portal_colaborador` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.18 | Gestão de admissões | `rh.gestao_admissoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.19 | Gestão de desligamentos | `rh.gestao_desligamentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 31.20 | Saúde e segurança ocupacional | `rh.saude_seguranca_ocupacional` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 32 — GESTÃO DE TAREFAS E PROCESSOS · `tarefas` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 32.01 | Cadastro de tarefas | `tarefas.cadastro_tarefas` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:149` — sem tabela de tarefas (jobs é fila técnica) |
| 32.02 | Distribuição de tarefas | `tarefas.distribuicao_tarefas` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:149` — inexistente |
| 32.03 | Gestão de responsáveis | `tarefas.gestao_responsaveis` | PARC | MOD | → 51.01 |  | `contabil.carteira` | `src/lib/db/schema.ts:1056` — responsáveis por cliente contábil contabil.carteira |
| 32.04 | Agenda operacional | `tarefas.agenda_operacional` | PARC | COMP |  |  | `tec.fiscal` | `src/app/(app)/fiscal/relatorios/page.tsx:451` — calendário só de obrigações fiscais tec.fiscal |
| 32.05 | Checklists | `tarefas.checklists` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:149` — checklists ausentes |
| 32.06 | Tarefas recorrentes | `tarefas.tarefas_recorrentes` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/obligations.ts:104` — obrigações recorrentes geradas, não tarefas genéricas tec.fiscal |
| 32.07 | Fluxos de aprovação | `tarefas.fluxos_aprovacao` | OP | MOD | → 05.05 |  | `compras.aprovacoes` | `src/domain/approvals.ts:263` — alçadas e etapas só para compras compras.aprovacoes · Fluxos de aprovação usam o mesmo motor de aprovação |
| 32.08 | Gestão de prazos | `tarefas.gestao_prazos` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/obligations.ts:43` — prazo de obrigação com alerta tec.fiscal |
| 32.09 | Gestão de projetos | `tarefas.gestao_projetos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 32.10 | Kanban | `tarefas.kanban` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:152` — Kanban ausente |
| 32.11 | Gestão de SLA | `tarefas.gestao_sla` | PLAN | FUT | ≡ 27.13 |  |  | `docs/analise-gestao-contabil.md:247` — SLA ausente · Gestão de SLA é uma só |
| 32.12 | Automação de processos | `tarefas.automacao_processos` | PARC | CORE |  |  | `plataforma.painel` | `src/domain/scheduler.ts:17` — rotinas fixas no código, não configuráveis plataforma.painel |
| 32.13 | Gestão de ocorrências | `tarefas.gestao_ocorrencias` | PARC | CORE |  |  | `plataforma.painel` | `src/lib/core/notify.ts:97` — ocorrências com resolução na origem plataforma.painel |
| 32.14 | Indicadores de produtividade | `tarefas.indicadores_produtividade` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 32.15 | Construtor de fluxos operacionais | `tarefas.construtor_fluxos_operacionais` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 33 — GESTÃO DOCUMENTAL · `documentos` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 33.01 | Armazenamento de documentos | `documentos.armazenamento_documentos` | PARC | CORE |  |  | `plataforma.arquivos` | `src/lib/db/schema.ts:1411` `src/app/api/files/[id]/route.ts` — arquivos com conferência de permissão plataforma.arquivos |
| 33.02 | Organização de pastas | `documentos.organizacao_pastas` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:240` — sem pastas |
| 33.03 | Classificação documental | `documentos.classificacao_documental` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:240` — só files.kind técnico |
| 33.04 | Controle de versões | `documentos.controle_versoes` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:240` — sem versões |
| 33.05 | Aprovação de documentos | `documentos.aprovacao_documentos` | PARC | ADD | → 51.04 |  | `contabil.entregas` | `src/lib/db/schema.ts:1062` — conferência de entregas do escritório contabil.entregas |
| 33.06 | Assinatura eletrônica | `documentos.assinatura_eletronica` | PLAN | FUT | ≡ 27.03 |  |  | `docs/analise-gestao-contabil.md:65` — sem assinatura eletrônica · Assinatura eletrônica é uma só |
| 33.07 | Controle de vencimentos | `documentos.controle_vencimentos` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:216` — vencimentos só de certificados |
| 33.08 | Compartilhamento de documentos | `documentos.compartilhamento_documentos` | PARC | MOD | → 06.01 |  | `vendas.documentos` | `src/app/documento/[token]/page.tsx:13` — link por token de orçamento/pedido vendas.documentos |
| 33.09 | Permissões documentais | `documentos.permissoes_documentais` | PARC | CORE |  |  | `plataforma.arquivos` | `src/app/api/files/[id]/route.ts:15` — download conferido por empresa e permissão plataforma.arquivos |
| 33.10 | Digitalização e OCR | `documentos.digitalizacao_ocr` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:244` — sem OCR |
| 33.11 | Modelos de documentos | `documentos.modelos_documentos` | PARC | ADD | → 18.41 |  | `financeiro.cobranca_whatsapp` | `src/domain/collection-templates.ts:1` — só modelos de mensagem de cobrança financeiro.cobranca_whatsapp |
| 33.12 | Geração automática de documentos | `documentos.geracao_automatica_documentos` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/export.ts:231` — pacote contábil, carnê e DANFE; sem gerador genérico tec.fiscal |
| 33.13 | Histórico de alterações | `documentos.historico_alteracoes` | PARC | CORE |  |  | `plataforma.administracao` | `src/lib/db/schema.ts:956` — audit_logs com antes/depois plataforma.administracao |

## 34 — MULTIEMPRESA E MULTIFILIAL · `multiempresa` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 34.01 | Gestão de múltiplas empresas | `multiempresa.gestao_multiplas_empresas` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/companies.ts:139` — Várias empresas por usuário plataforma.administracao |
| 34.02 | Gestão de múltiplas filiais | `multiempresa.gestao_multiplas_filiais` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/companies.ts:273` — Várias filiais plataforma.administracao |
| 34.03 | Consolidação de vendas | `multiempresa.consolidacao_vendas` | OP | MOD | → 21.02 |  | `relatorios.gerenciais` | `src/exports/reports.ts:33` — Consolidado e resultado por unidade relatorios.gerenciais |
| 34.04 | Consolidação financeira | `multiempresa.consolidacao_financeira` | OP | MOD | → 18.03 |  | `financeiro.fluxo_caixa` | `src/domain/cashflow.ts:28` — Fluxo e painel consolidados financeiro.fluxo_caixa |
| 34.05 | Consolidação de estoque | `multiempresa.consolidacao_estoque` | OP | MOD | → 10.01 |  | `estoque.gestao` | `src/app/(app)/estoque/page.tsx:73` — Saldos consolidados estoque.gestao |
| 34.06 | Transferências entre filiais | `multiempresa.transferencias_entre_filiais` | OP | ADD | ≡ 10.05 |  | `estoque.transferencias` | `src/domain/transfers.ts:179` — Transferência entre filiais estoque.transferencias · Transferência entre filiais = transferência entre estoques |
| 34.07 | Operações entre empresas | `multiempresa.operacoes_entre_empresas` | NAO | FUT |  |  |  | `src/domain/transfers.ts:120` — Outra empresa é recusada |
| 34.08 | Preços por unidade | `multiempresa.precos_unidade` | OP | COMP |  |  | `tec.precos` | `src/domain/pricing.ts:10` — Preço por filial tec.precos |
| 34.09 | Compras centralizadas | `multiempresa.compras_centralizadas` | NAO | FUT |  |  |  | `src/domain/purchases.ts:55` — Pedido amarrado à filial |
| 34.10 | Cadastros compartilhados autorizados | `multiempresa.cadastros_compartilhados_autorizados` | PARC | CORE |  |  | `plataforma.administracao` | `src/lib/db/scoped-store.ts` — Cadastros compartilhados entre filiais, não entre empresas plataforma.administracao |
| 34.11 | Permissões por filial | `multiempresa.permissoes_filial` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/users.ts:32` — branchIds restringe filiais plataforma.administracao |
| 34.12 | Indicadores consolidados | `multiempresa.indicadores_consolidados` | OP | CORE |  |  | `plataforma.painel` | `src/app/(app)/dashboard/page.tsx` — Painel consolidado plataforma.painel |
| 34.13 | Gestão de grupos econômicos | `multiempresa.gestao_grupos_economicos` | PARC | MOD | → 51.01 |  | `contabil.carteira` | `src/domain/accounting/common.ts:55` — Grupo econômico só no escritório contabil.carteira |
| 34.14 | Gestão de franquias | `multiempresa.gestao_franquias` | PARC | MOD | → 52.01 |  | `rede.parceiro` | `src/domain/network/nodes.ts:50` — Hierarquia só na rede rede.parceiro |
| 34.15 | Gestão de unidades de negócio | `multiempresa.gestao_unidades_negocio` | PARC | COMP |  |  | `tec.financeiro` | `src/lib/db/schema.ts:632` — Só centros de custo tec.financeiro |

## 35 — MARKETPLACES E INTEGRAÇÕES COMERCIAIS · `marketplaces` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 35.01 | Mercado Livre | `marketplaces.mercado_livre` | DEV | FUT |  |  | `ecommerce.canais` | `src/domain/ecommerce/channels.ts:28` — Conta só preparada ecommerce.canais |
| 35.02 | Shopee | `marketplaces.shopee` | DEV | FUT |  |  | `ecommerce.canais` | `src/domain/ecommerce/channels.ts:28` — Conta só preparada ecommerce.canais |
| 35.03 | Amazon | `marketplaces.amazon` | DEV | FUT |  |  | `ecommerce.canais` | `src/domain/ecommerce/channels.ts:28` — Conta só preparada ecommerce.canais |
| 35.04 | Magalu | `marketplaces.magalu` | DEV | FUT |  |  | `ecommerce.canais` | `src/domain/ecommerce/channels.ts:28` — Conta só preparada ecommerce.canais |
| 35.05 | iFood | `marketplaces.ifood` | NAO | FUT |  |  |  | iFood inexistente |
| 35.06 | Shopify | `marketplaces.shopify` | NAO | FUT |  |  |  | Shopify inexistente |
| 35.07 | WooCommerce | `marketplaces.woocommerce` | NAO | FUT |  |  |  | WooCommerce inexistente |
| 35.08 | Nuvemshop | `marketplaces.nuvemshop` | NAO | FUT |  |  |  | Nuvemshop inexistente |
| 35.09 | VTEX | `marketplaces.vtex` | NAO | FUT |  |  |  | VTEX inexistente |
| 35.10 | Sincronização de anúncios | `marketplaces.sincronizacao_anuncios` | PLAN | FUT |  |  | `ecommerce.marketplaces` | `src/lib/modules/catalog.ts:637` — Lacuna documentada ecommerce.marketplaces |
| 35.11 | Sincronização de pedidos | `marketplaces.sincronizacao_pedidos` | PLAN | FUT |  |  | `ecommerce.marketplaces` | `src/lib/modules/catalog.ts:637` — Lacuna documentada ecommerce.marketplaces |
| 35.12 | Sincronização de preços | `marketplaces.sincronizacao_precos` | PLAN | FUT |  |  | `ecommerce.marketplaces` | `src/lib/modules/catalog.ts:637` — Lacuna documentada ecommerce.marketplaces · Sincronização de preços com marketplaces usa a mesma resolução de preço |
| 35.13 | Sincronização de estoque | `marketplaces.sincronizacao_estoque` | PLAN | FUT |  |  | `ecommerce.marketplaces` | `src/lib/modules/catalog.ts:637` — Lacuna documentada ecommerce.marketplaces · Sincronização de estoque com marketplaces usa a mesma regra de disponibilidade |
| 35.14 | Gestão de comissões de marketplaces | `marketplaces.gestao_comissoes_marketplaces` | NAO | FUT |  |  |  | Sem comissões de marketplace |
| 35.15 | Conciliação de recebíveis | `marketplaces.conciliacao_recebiveis` | PARC | ADD | → 18.11 |  | `financeiro.taxas_adquirente` | `src/domain/card-reconciliation.ts:151` — Só adquirente e Banco Intercert financeiro.taxas_adquirente |
| 35.16 | Gestão de reputação | `marketplaces.gestao_reputacao` | NAO | FUT |  |  |  | Sem reputação |
| 35.17 | Gestão de devoluções | `marketplaces.gestao_devolucoes` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/orders.ts:476` — Só devoluções da loja própria ecommerce.loja |
| 35.18 | Hub multicanal | `marketplaces.hub_multicanal` | DEV | FUT | **U** | 12.01 | `ecommerce.canais` | `src/domain/ecommerce/channels.ts:48` — Tela só prepara contas ecommerce.canais |

## 36 — PAGAMENTOS E GATEWAYS · `pagamentos` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 36.01 | Gateway de pagamento | `pagamentos.gateway_pagamento` | EXT | INT | → 12.01 |  | `ecommerce.loja` | `src/domain/ecommerce/providers.ts:134` — Gateway Intercert não conectado; simulação ecommerce.loja · Gateway Intercert |
| 36.02 | Link de pagamento | `pagamentos.link_pagamento` | PARC | ADD | → 48.06 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:80` — Só URL fixa da certificação e {link_pix} contabil.certificados |
| 36.03 | Pagamento por cartão | `pagamentos.pagamento_cartao` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/pagamento/payment-app.tsx:408` — PDV com NSU manual; cartão da loja simulado vendas.pdv |
| 36.04 | Pagamento por PIX | `pagamentos.pagamento_pix` | EXT | INT |  |  | `tec.pagamentos` | `src/domain/payments/providers.ts:76` `src/lib/pix.ts` — Pix dinâmico Mercado Pago (sem credencial: simulação) e estático tec.pagamentos · Pix (Mercado Pago) |
| 36.05 | Pagamento por boleto | `pagamentos.pagamento_boleto` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:90` — Boleto só simulado na loja |
| 36.06 | Pagamento recorrente | `pagamentos.pagamento_recorrente` | NAO | FUT |  |  |  | Sem cobrança recorrente |
| 36.07 | Split de pagamento | `pagamentos.split_pagamento` | PARC | ADD | → 52.07 |  | `rede.financeiro` | `src/domain/network/ledger.ts:257` — Split modelado na rede rede.financeiro |
| 36.08 | Estorno de pagamento | `pagamentos.estorno_pagamento` | PARC | COMP |  |  | `tec.pagamentos` | `src/domain/payments/intents.ts:124` — Estorno Pix pelo Mercado Pago tec.pagamentos |
| 36.09 | Gestão de chargeback | `pagamentos.gestao_chargeback` | EXT | INT |  |  |  | `src/domain/ecommerce/orders.ts:150` — Chargeback via aviso do gateway (não conectado) |
| 36.10 | Antifraude | `pagamentos.antifraude` | NAO | FUT |  |  |  | Sem antifraude |
| 36.11 | Conciliação de transações | `pagamentos.conciliacao_transacoes` | OP | ADD | → 18.11 |  | `financeiro.taxas_adquirente` | `src/domain/card-reconciliation.ts:151` `src/domain/ecommerce/bank.ts:82` — Adquirente × vendas e gateway financeiro.taxas_adquirente |
| 36.12 | Tokenização por provedor | `pagamentos.tokenizacao_provedor` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:32` — Token de cartão só simulado |
| 36.13 | Gestão de taxas | `pagamentos.gestao_taxas` | OP | ADD | → 18.11 |  | `financeiro.taxas_adquirente` | `src/domain/card-fees.ts:25` — Taxas por bandeira e parcela financeiro.taxas_adquirente |
| 36.14 | Gestão de adquirentes | `pagamentos.gestao_adquirentes` | OP | MOD | → 18.44 |  | `financeiro.cartoes` | `src/domain/card-reconciliation.ts:90` — Layouts por adquirente financeiro.cartoes |
| 36.15 | Gestão de subadquirentes | `pagamentos.gestao_subadquirentes` | NAO | FUT |  |  |  | Sem subadquirentes |
| 36.16 | Integrações individuais por provedor | `pagamentos.integracoes_individuais_provedor` | PARC | INT |  |  | `plataforma.administracao` | `src/domain/integrations.ts:54` — Só Mercado Pago e Focus reais plataforma.administracao · Conectores por provedor |
| 36.17 | Banco Intercert: conciliação do gateway e repasses *(achado na auditoria)* | `pagamentos.banco_intercert_conciliacao_gateway_repasses` | EXT | ADD | **U** | 12.01 | `ecommerce.banco` | `src/domain/ecommerce/bank.ts:82` `src/app/(app)/comercio-digital/banco/page.tsx` — Provedor Banco Intercert reservado; simulação |

## 37 — APLICATIVOS E PORTAIS EXTERNOS · `apps` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 37.01 | Aplicativo do vendedor | `apps.aplicativo_vendedor` | PARC | ADD |  |  |  | `src/app/manifest.ts:4` — PWA genérico do ERP; sem app do vendedor |
| 37.02 | Aplicativo do representante | `apps.aplicativo_representante` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:91` — VEN-15 força de vendas ausente |
| 37.03 | Aplicativo do entregador | `apps.aplicativo_entregador` | NAO | FUT | ≡ 17.13 |  |  | Inexistente (grep sem ocorrência) · Aplicativo do entregador é um só |
| 37.04 | Aplicativo do garçom | `apps.aplicativo_garcom` | NAO | FUT | ≡ 14.05 |  |  | Inexistente (grep sem ocorrência) · Aplicativo do garçom é um só |
| 37.05 | Aplicativo do gestor | `apps.aplicativo_gestor` | PARC | CORE |  |  | `plataforma.painel` | `src/app/manifest.ts:4` — PWA com atalho do painel plataforma.painel |
| 37.06 | Aplicativo do cliente | `apps.aplicativo_cliente` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/loja/[store]/pedido/[token]/page.tsx:1` — acompanhamento do pedido na loja ecommerce.loja |
| 37.07 | Aplicativo do técnico | `apps.aplicativo_tecnico` | NAO | FUT | ≡ 26.10 |  |  | Inexistente (grep sem ocorrência) · Aplicativo do técnico é um só |
| 37.08 | Portal do fornecedor | `apps.portal_fornecedor` | NAO | FUT | ≡ 05.18 |  |  | sem portal do fornecedor · Portal do fornecedor é um só |
| 37.09 | Portal do contador | `apps.portal_contador` | OP | MOD | ≡ 22.08 |  | `contabil.carteira` | `src/app/(app)/contabil/page.tsx` `src/domain/accounting/link.ts` — área do escritório contábil com empresas vinculadas contabil.carteira · Portal do contador é um só |
| 37.10 | Portal do cliente | `apps.portal_cliente` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:249` — portal do cliente ausente |
| 37.11 | Portal do colaborador | `apps.portal_colaborador` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 37.12 | Portal B2B | `apps.portal_b2b` | NAO | FUT |  |  |  | loja só B2C |
| 37.13 | Aplicativo de inventário | `apps.aplicativo_inventario` | PARC | ADD | → 10.09 |  | `estoque.inventario` | `src/domain/count-scan.ts:1` — folha de contagem com bipagem estoque.inventario · Aplicativo de inventário reutiliza o inventário |
| 37.14 | Aplicativo de separação | `apps.aplicativo_separacao` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/expedicao/page.tsx:80` — separação web só de pedidos on-line ecommerce.loja · Aplicativo de separação reutiliza a separação de pedidos |
| 37.15 | Aplicativo de produção | `apps.aplicativo_producao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 37.16 | Aplicativo de autoatendimento | `apps.aplicativo_autoatendimento` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 38 — AUTOMAÇÕES E INTELIGÊNCIA ARTIFICIAL · `automacao` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 38.01 | Automação de cobranças | `automacao.automacao_cobrancas` | PARC | MOD | → 18.02 |  | `financeiro.contas_receber` | `src/domain/routines/finance.ts:16` — aviso interno de vencidos; WhatsApp manual financeiro.contas_receber |
| 38.02 | Automação de notificações | `automacao.automacao_notificacoes` | OP | CORE |  |  | `plataforma.painel` | `src/lib/core/notify.ts:61` — rotinas diárias geram notificações deduplicadas plataforma.painel |
| 38.03 | Automação de compras | `automacao.automacao_compras` | PARC | MOD | → 05.04 |  | `compras.pedidos` | `src/domain/routines/purchases.ts:14` — follow-up de pedidos compras.pedidos |
| 38.04 | Automação de reposição | `automacao.automacao_reposicao` | PARC | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:258` — sugestão vira rascunho manual compras.reposicao · Automação de reposição usa a sugestão de reposição |
| 38.05 | Automação de relatórios | `automacao.automacao_relatorios` | PARC | MOD | → 22.07 |  | `integracao.contabilidade` | `src/domain/routines/fiscal.ts:49` — só pacote contábil agendado integracao.contabilidade |
| 38.06 | Automação de atendimento | `automacao.automacao_atendimento` | NAO | FUT |  |  |  | `src/domain/ecommerce/promotions.ts:164` — recuperação de carrinho só rascunho |
| 38.07 | Assistente inteligente do ERP | `automacao.assistente_inteligente_erp` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:296` — IA ausente |
| 38.08 | Consulta de dados por linguagem natural | `automacao.consulta_dados_linguagem_natural` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:296` — IA ausente |
| 38.09 | Análise inteligente de vendas | `automacao.analise_inteligente_vendas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 38.10 | Análise inteligente de estoque | `automacao.analise_inteligente_estoque` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 38.11 | Previsão de demanda | `automacao.previsao_demanda` | PARC | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:1` — média de consumo, sem modelo preditivo compras.reposicao |
| 38.12 | Sugestão de compras | `automacao.sugestao_compras` | OP | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:115` — sugestão de compra por cobertura compras.reposicao · Sugestão de compras por IA usaria a mesma base |
| 38.13 | Sugestão de preços | `automacao.sugestao_precos` | OP | ADD | → 05.20 |  | `compras.precificacao` | `src/domain/receipt-pricing.ts:164` — preço sugerido após a entrada com prévia compras.precificacao |
| 38.14 | Identificação de anomalias | `automacao.identificacao_anomalias` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 38.15 | Classificação automática de documentos | `automacao.classificacao_automatica_documentos` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:244` — classificação OCR/IA ausente |
| 38.16 | Construtor de automações | `automacao.construtor_automacoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 38.17 | Aprovação humana de ações automatizadas | `automacao.aprovacao_humana_acoes_automatizadas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 38.18 | Histórico de execuções automatizadas | `automacao.historico_execucoes_automatizadas` | PARC | CORE |  |  | `plataforma.painel` | `src/domain/scheduler.ts:39` — marcador lastRun por rotina; fila jobs plataforma.painel |

## 39 — GESTÃO DE QUALIDADE · `qualidade` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 39.01 | Inspeção de recebimento | `qualidade.inspecao_recebimento` | PARC | MOD | → 05.06 |  | `compras.recebimento` | `src/domain/receipts.ts:35` — conferência quantitativa; sem inspeção de qualidade compras.recebimento |
| 39.02 | Inspeção de produção | `qualidade.inspecao_producao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.03 | Inspeção de produto acabado | `qualidade.inspecao_produto_acabado` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.04 | Controle de não conformidades | `qualidade.controle_nao_conformidades` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.05 | Ações corretivas | `qualidade.acoes_corretivas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.06 | Ações preventivas | `qualidade.acoes_preventivas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.07 | Gestão de certificações | `qualidade.gestao_certificacoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.08 | Controle de amostras | `qualidade.controle_amostras` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.09 | Laudos de qualidade | `qualidade.laudos_qualidade` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.10 | Rastreabilidade de inspeções | `qualidade.rastreabilidade_inspecoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.11 | Auditorias internas | `qualidade.auditorias_internas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.12 | Indicadores de qualidade | `qualidade.indicadores_qualidade` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 39.13 | Controle de produtos bloqueados | `qualidade.controle_produtos_bloqueados` | NAO | FUT |  |  |  | sem bloqueio/quarentena |
| 39.14 | Gestão de recolhimento de produtos | `qualidade.gestao_recolhimento_produtos` | PARC | ADD | → 10.10 |  | `estoque.lotes` | `src/domain/lots.ts:54` — lote rastreável na venda; sem fluxo de recall estoque.lotes |

## 40 — TRANSPORTES E GESTÃO DE FROTAS · `frotas` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 40.01 | Cadastro de veículos | `frotas.cadastro_veiculos` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:59` — CAD-04 veículos; placa digitada na NF-e |
| 40.02 | Cadastro de motoristas | `frotas.cadastro_motoristas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.03 | Controle de viagens | `frotas.controle_viagens` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.04 | Controle de abastecimento | `frotas.controle_abastecimento` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.05 | Controle de quilometragem | `frotas.controle_quilometragem` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.06 | Manutenção de veículos | `frotas.manutencao_veiculos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.07 | Controle de pneus | `frotas.controle_pneus` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.08 | Gestão de documentos veiculares | `frotas.gestao_documentos_veiculares` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.09 | Controle de multas | `frotas.controle_multas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.10 | Controle de custos por veículo | `frotas.controle_custos_veiculo` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.11 | Controle de pedágios | `frotas.controle_pedagios` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.12 | Rastreamento de veículos | `frotas.rastreamento_veiculos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.13 | Gestão de ocorrências | `frotas.gestao_ocorrencias` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.14 | Indicadores de frota | `frotas.indicadores_frota` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 40.15 | Gestão de fretes contratados | `frotas.gestao_fretes_contratados` | PARC | ADD | → 03.13 |  | `compras.cte` | `src/domain/freight-cte.ts:17` — só CT-e de frete de compra compras.cte |

## 41 — WMS E ARMAZENAGEM AVANÇADA · `wms` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 41.01 | Gestão de armazéns | `wms.gestao_armazens` | PARC | MOD | → 10.01 |  | `estoque.gestao` | `src/lib/db/schema.ts:324` — depósitos por filial, não WMS estoque.gestao |
| 41.02 | Mapeamento de endereços | `wms.mapeamento_enderecos` | PARC | MOD | → 10.01 |  | `estoque.gestao` | `src/lib/db/schema.ts:340` — campo texto location no saldo estoque.gestao |
| 41.03 | Recebimento por doca | `wms.recebimento_doca` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.04 | Agendamento de docas | `wms.agendamento_docas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.05 | Armazenagem direcionada | `wms.armazenagem_direcionada` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.06 | Picking | `wms.picking` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/expedicao/page.tsx:80` — separação de pedidos on-line ecommerce.loja |
| 41.07 | Packing | `wms.packing` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/expedicao/page.tsx:111` — conferência e volumes do pedido on-line ecommerce.loja |
| 41.08 | Cross-docking | `wms.cross_docking` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.09 | Separação por ondas | `wms.separacao_ondas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.10 | Separação por lotes | `wms.separacao_lotes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.11 | Reposição de posições | `wms.reposicao_posicoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.12 | Controle de ocupação | `wms.controle_ocupacao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.13 | Conferência por coletor | `wms.conferencia_coletor` | PARC | ADD | → 10.09 |  | `estoque.inventario` | `src/domain/count-scan.ts:1` — bipagem só na contagem estoque.inventario |
| 41.14 | Etiquetas logísticas | `wms.etiquetas_logisticas` | EXT | INT |  |  |  | `src/domain/ecommerce/providers.ts:312` — etiqueta só em simulação · Etiquetas logísticas são parte da expedição |
| 41.15 | Gestão de pallets | `wms.gestao_pallets` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 41.16 | Gestão de volumes | `wms.gestao_volumes` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/expedicao/page.tsx:111` — volumes do pedido on-line ecommerce.loja |
| 41.17 | Expedição avançada | `wms.expedicao_avancada` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/app/(app)/comercio-digital/expedicao/page.tsx:22` — expedição só e-commerce ecommerce.loja |
| 41.18 | Indicadores de armazenagem | `wms.indicadores_armazenagem` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 42 — COMÉRCIO EXTERIOR · `comex` · Não implementado · FUT

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 42.01 | Cadastro de fornecedores internacionais | `comex.cadastro_fornecedores_internacionais` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.02 | Pedidos internacionais | `comex.pedidos_internacionais` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.03 | Processos de importação | `comex.processos_importacao` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:128` — FIS-10 importação ausente |
| 42.04 | Processos de exportação | `comex.processos_exportacao` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:128` — FIS-10 exportação ausente |
| 42.05 | Gestão de embarques | `comex.gestao_embarques` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.06 | Gestão de containers | `comex.gestao_containers` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.07 | Documentação internacional | `comex.documentacao_internacional` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.08 | Commercial invoice | `comex.commercial_invoice` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.09 | Packing list | `comex.packing_list` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.10 | Controle cambial | `comex.controle_cambial` | NAO | FUT |  |  |  | moeda fixa BRL |
| 42.11 | Custos de importação | `comex.custos_importacao` | NAO | FUT |  |  |  | só rateio genérico no recebimento |
| 42.12 | Nacionalização de mercadorias | `comex.nacionalizacao_mercadorias` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:128` — nacionalização ausente |
| 42.13 | Desembaraço aduaneiro | `comex.desembaraco_aduaneiro` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.14 | Controle de Incoterms | `comex.controle_incoterms` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.15 | Acompanhamento de cargas internacionais | `comex.acompanhamento_cargas_internacionais` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 42.16 | Rateio de despesas de importação | `comex.rateio_despesas_importacao` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 43 — VENDAS EXTERNAS E REPRESENTANTES · `vendas_externas` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 43.01 | Carteira de representantes | `vendas_externas.carteira_representantes` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:91` — VEN-15; só vendedores |
| 43.02 | Territórios comerciais | `vendas_externas.territorios_comerciais` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 43.03 | Rotas de visitas | `vendas_externas.rotas_visitas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 43.04 | Registro de visitas | `vendas_externas.registro_visitas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 43.05 | Pedido externo | `vendas_externas.pedido_externo` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:91` — pedido externo ausente |
| 43.06 | Pedido offline | `vendas_externas.pedido_offline` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:91` — pedido offline ausente |
| 43.07 | Catálogo do representante | `vendas_externas.catalogo_representante` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:91` — catálogo do representante ausente |
| 43.08 | Comissão por representante | `vendas_externas.comissao_representante` | PARC | MOD | → 06.12 |  | `vendas.comissoes` | `src/domain/commissions.ts:197` — comissão por vendedor, não representante vendas.comissoes · Comissão por representante reutiliza o motor de comissões |
| 43.09 | Comissão por produto | `vendas_externas.comissao_produto` | PARC | MOD | → 06.12 |  | `vendas.comissoes` | `src/lib/db/schema.ts:106` — percentual por categoria, não produto vendas.comissoes · Comissão por produto reutiliza o motor de comissões |
| 43.10 | Comissão por recebimento | `vendas_externas.comissao_recebimento` | OP | MOD | → 06.12 |  | `vendas.comissoes` | `src/domain/commissions.ts:129` — base valor recebido vendas.comissoes · Comissão por recebimento reutiliza o motor de comissões |
| 43.11 | Prestação de contas | `vendas_externas.prestacao_contas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 43.12 | Metas individuais | `vendas_externas.metas_individuais` | OP | MOD | ≡ 06.13 |  | `gestao.metas` | `src/domain/goals.ts:99` — meta por vendedor/mês gestao.metas · Metas individuais = metas comerciais por vendedor |
| 43.13 | Supervisão comercial | `vendas_externas.supervisao_comercial` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 43.14 | Indicadores de vendas externas | `vendas_externas.indicadores_vendas_externas` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 44 — AGENDAMENTOS E ATENDIMENTOS · `agenda` · Não implementado · FUT

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 44.01 | Agenda de atendimentos | `agenda.agenda_atendimentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.02 | Agenda por profissional | `agenda.agenda_profissional` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.03 | Agenda por recurso | `agenda.agenda_recurso` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.04 | Agendamento online | `agenda.agendamento_online` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.05 | Confirmação automática | `agenda.confirmacao_automatica` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.06 | Lembretes de atendimento | `agenda.lembretes_atendimento` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.07 | Reagendamento | `agenda.reagendamento` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.08 | Cancelamento de agendamento | `agenda.cancelamento_agendamento` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.09 | Lista de espera | `agenda.lista_espera` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.10 | Atendimento recorrente | `agenda.atendimento_recorrente` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.11 | Gestão de disponibilidade | `agenda.gestao_disponibilidade` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.12 | Gestão de horários | `agenda.gestao_horarios` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.13 | Controle de comparecimento | `agenda.controle_comparecimento` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 44.14 | Histórico de atendimentos | `agenda.historico_atendimentos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 45 — GESTÃO DE GARANTIAS E PÓS-VENDA · `garantias` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 45.01 | Registro de garantia | `garantias.registro_garantia` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.02 | Garantia por número de série | `garantias.garantia_numero_serie` | NAO | FUT |  |  |  | sem número de série |
| 45.03 | Garantia estendida | `garantias.garantia_estendida` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.04 | Solicitação de assistência | `garantias.solicitacao_assistencia` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.05 | Autorização de assistência | `garantias.autorizacao_assistencia` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.06 | Envio para fabricante | `garantias.envio_fabricante` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.07 | Acompanhamento de reparos | `garantias.acompanhamento_reparos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.08 | Substituição de produtos | `garantias.substituicao_produtos` | PARC | ADD | → 08.04 |  | `vendas.devolucoes` | `src/domain/sales.ts:1334` — trocas e devoluções genéricas vendas.devolucoes |
| 45.09 | Controle de prazos | `garantias.controle_prazos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.10 | Gestão de reclamações | `garantias.gestao_reclamacoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.11 | Histórico de garantias | `garantias.historico_garantias` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 45.12 | Indicadores de pós-venda | `garantias.indicadores_pos_venda` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 46 — GESTÃO DE SUPERMERCADOS E VAREJO ALIMENTAR · `supermercado` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 46.01 | Integração com balanças etiquetadoras | `supermercado.integracao_balancas_etiquetadoras` | PARC | ADD | **U** | 01.04 | `produtos.balanca` | `src/domain/scale.ts:277` `src/domain/scale-files.ts:4` — arquivo de carga Toledo/Filizola; layout a conferir produtos.balanca |
| 46.02 | Produtos com código de peso variável | `supermercado.produtos_codigo_peso_variavel` | OP | ADD | → 46.01 |  | `produtos.balanca` | `src/domain/scale-barcode.ts:74` — EAN 2 peso/valor no PDV produtos.balanca |
| 46.03 | Controle de perecíveis | `supermercado.controle_pereciveis` | OP | ADD | → 10.10 |  | `estoque.lotes` | `src/domain/routines/stock.ts:62` — lotes, validades e alerta diário estoque.lotes · Perecíveis usam lotes e validade |
| 46.04 | Controle de hortifrúti | `supermercado.controle_hortifruti` | NAO | FUT |  |  |  | sem controle específico |
| 46.05 | Controle de açougue | `supermercado.controle_acougue` | NAO | FUT |  |  |  | sem controle de açougue |
| 46.06 | Controle de padaria | `supermercado.controle_padaria` | NAO | FUT |  |  |  | sem controle de padaria |
| 46.07 | Transformação e desossa | `supermercado.transformacao_desossa` | PARC | ADD | → 15.01 |  | `produtos.kits` | `src/domain/product-components.ts:312` — desmembramento com rateio de custo produtos.kits |
| 46.08 | Fracionamento de produtos | `supermercado.fracionamento_produtos` | PARC | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:262` — conversões e desmembramento cadastros.produtos |
| 46.09 | Controle de perdas alimentares | `supermercado.controle_perdas_alimentares` | PARC | MOD | → 10.01 |  | `estoque.gestao` | `src/domain/stock.ts:51` — movimento perda/avaria sem análise estoque.gestao |
| 46.10 | Etiquetas de gôndola | `supermercado.etiquetas_gondola` | OP | ADD | ≡ 09.13 |  | `produtos.etiquetas` | `src/domain/labels.ts:18` — gôndola/adesiva/A4 produtos.etiquetas · Etiquetas de gôndola = etiquetas de produtos |
| 46.11 | Consulta de preços em loja | `supermercado.consulta_precos_loja` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:90` — VEN-13 terminal de consulta ausente |
| 46.12 | Promoções de encarte | `supermercado.promocoes_encarte` | PARC | ADD | → 25.01 |  | `produtos.promocoes` | `src/lib/db/schema.ts:286` — promoções com vigência; sem encarte produtos.promocoes |
| 46.13 | Gestão de vasilhames retornáveis | `supermercado.gestao_vasilhames_retornaveis` | NAO | FUT |  |  |  | sem vasilhames |
| 46.14 | Gestão de embalagens retornáveis | `supermercado.gestao_embalagens_retornaveis` | NAO | FUT |  |  |  | inexistente |

## 47 — GESTÃO DE MODA E CONFECÇÃO · `moda` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 47.01 | Gestão de coleções | `moda.gestao_colecoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 47.02 | Gestão de estações | `moda.gestao_estacoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 47.03 | Matriz de cores e tamanhos | `moda.matriz_cores_tamanhos` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/domain/products.ts:227` — eixos livres cor/tamanho geram SKU cadastros.produtos · Matriz cor x tamanho usa as variações de produto |
| 47.04 | Compra por grade | `moda.compra_grade` | PARC | MOD | → 05.04 |  | `compras.pedidos` | `src/lib/db/schema.ts:755` — pedido por SKU, sem matriz compras.pedidos |
| 47.05 | Venda por grade | `moda.venda_grade` | PARC | MOD | → 07.01 |  | `vendas.pdv` | `src/app/(app)/pdv/product-search.tsx:59` — variação no PDV, sem matriz vendas.pdv |
| 47.06 | Reposição por grade | `moda.reposicao_grade` | PARC | MOD | → 05.08 |  | `compras.reposicao` | `src/domain/replenishment.ts:115` — reposição por SKU compras.reposicao |
| 47.07 | Transferência por grade | `moda.transferencia_grade` | PARC | ADD | → 10.05 |  | `estoque.transferencias` | `src/lib/db/schema.ts:370` — transferência por SKU estoque.transferencias |
| 47.08 | Inventário por grade | `moda.inventario_grade` | PARC | ADD | → 10.09 |  | `estoque.inventario` | `src/lib/db/schema.ts:390` — contagem por SKU estoque.inventario |
| 47.09 | Curva de tamanhos | `moda.curva_tamanhos` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 47.10 | Curva de cores | `moda.curva_cores` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |
| 47.11 | Etiquetagem por variação | `moda.etiquetagem_variacao` | OP | ADD | → 09.13 |  | `produtos.etiquetas` | `src/domain/labels.ts:98` — etiqueta por variação produtos.etiquetas |
| 47.12 | Análise de desempenho de coleções | `moda.analise_desempenho_colecoes` | NAO | FUT |  |  |  | Inexistente (grep sem ocorrência) |

## 48 — GESTÃO DE DOCUMENTOS E CERTIFICAÇÃO DIGITAL · `certificacao` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 48.01 | Cadastro de certificados digitais | `certificacao.cadastro_certificados_digitais` | OP | ADD | ≡ 02.12 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:769` `src/domain/fiscal/config.ts:163` — certificados conhecidos e A1 da empresa contabil.certificados · Cadastro de certificados digitais (o do emitente fiscal é o mesmo cadastro) |
| 48.02 | Controle de validade de certificados | `certificacao.controle_validade_certificados` | OP | ADD | ≡ 02.12 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:763` — validade e dias restantes contabil.certificados · Validade do certificado acompanha o cadastro |
| 48.03 | Alertas de vencimento | `certificacao.alertas_vencimento` | OP | ADD | → 48.06 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:872` `src/domain/routines/fiscal.ts:24` — alertas 30/7/vencido contabil.certificados |
| 48.04 | Assinatura digital de documentos | `certificacao.assinatura_digital_documentos` | EXT | INT |  |  |  | `src/domain/fiscal/config.ts:180` — só NF-e assinada na Focus · Assinatura digital (ICP) usa o recurso de assinatura com certificado |
| 48.05 | Validação de assinaturas | `certificacao.validacao_assinaturas` | NAO | FUT |  |  |  | sem validação de assinaturas |
| 48.06 | Gestão de solicitações de certificados | `certificacao.gestao_solicitacoes_certificados` | OP | ADD | **U** | 51.01 | `contabil.certificados` | `src/domain/accounting/certificates.ts:286` — protocolo, cobrança, validação, emissão, download contabil.certificados |
| 48.07 | Renovação de certificados | `certificacao.renovacao_certificados` | OP | ADD | → 52.06 |  | `rede.renovacoes` | `src/domain/network/renewals.ts:1` — renovações por camada rede.renovacoes |
| 48.08 | Integração com provedores de certificação | `certificacao.integracao_provedores_certificacao` | PARC | ADD | → 48.06 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:575` — emissão registrada manualmente; gateway pendente contabil.certificados |
| 48.09 | Histórico de utilização | `certificacao.historico_utilizacao` | OP | ADD | → 48.06 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:701` — cada download auditado contabil.certificados |
| 48.10 | Controle de credenciais de certificação | `certificacao.controle_credenciais_certificacao` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/config.ts:163` — senha A1 só por nome de variável tec.fiscal |
| 48.11 | Validação do titular e autorização de download do certificado *(achado na auditoria)* | `certificacao.validacao_titular_autorizacao_download_certificado` | OP | ADD | → 48.06 |  | `contabil.certificados` | `src/domain/accounting/certificates.ts:519` `src/domain/accounting/certificates.ts:145` |
| 48.12 | Fila da equipe de certificação Intercert *(achado na auditoria)* | `certificacao.fila_equipe_certificacao_intercert` | OP | CORE |  |  | `rede.plataforma` | `src/domain/accounting/certificates.ts:838` `src/app/(app)/administracao/certificacao/page.tsx` — Exclusivo da plataforma |

## 49 — SUPORTE E CENTRAL DE AJUDA · `suporte` · Implementado parcialmente · CORE

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 49.01 | Abertura de chamados | `suporte.abertura_chamados` | OP | CORE |  |  | `plataforma.painel` | `src/domain/support.ts:98` — chamados com categoria, prioridade e anexos plataforma.painel |
| 49.02 | Acompanhamento de chamados | `suporte.acompanhamento_chamados` | OP | CORE |  |  | `plataforma.painel` | `src/domain/support.ts:180` — resposta, status, responsável, notas plataforma.painel |
| 49.03 | Base de conhecimento | `suporte.base_conhecimento` | OP | CORE |  |  | `plataforma.painel` | `src/domain/help-content.ts:118` — artigos com busca plataforma.painel |
| 49.04 | Tutoriais | `suporte.tutoriais` | PARC | CORE |  |  | `plataforma.painel` | `src/domain/help-content.ts:118` — tutoriais = artigos plataforma.painel |
| 49.05 | Onboarding guiado | `suporte.onboarding_guiado` | PARC | CORE |  |  | `plataforma.acesso` | `src/app/(auth)/primeiro-acesso/page.tsx:1` — provisionamento; sem tour guiado plataforma.acesso |
| 49.06 | Comunicação de atualizações | `suporte.comunicacao_atualizacoes` | PLAN | FUT |  |  |  | `docs/evolucao/04-ausentes.md:41` — PLA-13 novidades ausente |
| 49.07 | Diagnóstico de problemas | `suporte.diagnostico_problemas` | PARC | CORE |  |  | `plataforma.administracao` | `src/domain/integrations.ts:542` — teste de integração, rejeições SEFAZ plataforma.administracao |
| 49.08 | Solicitação de funcionalidades | `suporte.solicitacao_funcionalidades` | PARC | CORE |  |  | `plataforma.painel` | `src/domain/support.ts:28` — categoria sugestão no chamado plataforma.painel |
| 49.09 | Status dos serviços | `suporte.status_servicos` | PARC | CORE |  |  | `plataforma.acesso` | `src/lib/db/outage.ts:16` — aviso de banco indisponível plataforma.acesso |
| 49.10 | Atendimento remoto autorizado | `suporte.atendimento_remoto_autorizado` | NAO | FUT |  |  |  | inexistente |
| 49.11 | Avaliação de suporte | `suporte.avaliacao_suporte` | PLAN | FUT |  |  |  | `docs/analise-gestao-contabil.md:245` — avaliação ausente |
| 49.12 | Histórico de atendimento | `suporte.historico_atendimento` | OP | CORE |  |  | `plataforma.painel` | `src/domain/support.ts:333` — mensagens do chamado plataforma.painel |
| 49.13 | Ajuda contextual por rota e catálogo de rejeições SEFAZ *(achado na auditoria)* | `suporte.ajuda_contextual_rota_catalogo_rejeicoes_sefaz` | OP | CORE |  |  | `plataforma.painel` | `src/domain/help-content.ts:687` `src/domain/help-content.ts:46` |

## 50 — CONFIGURAÇÕES E PERSONALIZAÇÃO · `configuracoes` · Implementado parcialmente · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 50.01 | Identidade visual da empresa | `configuracoes.identidade_visual_empresa` | PARC | MOD | → 12.01 |  | `ecommerce.loja` | `src/lib/db/schema.ts:1271` — tema só da loja virtual ecommerce.loja |
| 50.02 | Personalização de menus | `configuracoes.personalizacao_menus` | PARC | CORE |  |  | `plataforma.administracao` | `src/app/(app)/layout.tsx` — menu segue módulos ativos; sem personalização plataforma.administracao |
| 50.03 | Personalização de dashboards | `configuracoes.personalizacao_dashboards` | NAO | FUT |  |  |  | sem personalização de painel |
| 50.04 | Personalização de documentos | `configuracoes.personalizacao_documentos` | PARC | ADD | → 18.41 |  | `financeiro.cobranca_whatsapp` | `src/domain/collection-templates.ts:1` — modelos de etiqueta e mensagem; DANFE fixo financeiro.cobranca_whatsapp |
| 50.05 | Personalização de formulários | `configuracoes.personalizacao_formularios` | NAO | FUT |  |  |  | inexistente |
| 50.06 | Campos personalizados | `configuracoes.campos_personalizados` | PLAN | FUT | ≡ 01.19 |  |  | `docs/evolucao/04-ausentes.md:42` — PLA-22 campos personalizados · Campos personalizados é um só |
| 50.07 | Configuração de idiomas | `configuracoes.configuracao_idiomas` | NAO | FUT |  |  |  | só pt-BR |
| 50.08 | Configuração de moedas | `configuracoes.configuracao_moedas` | NAO | FUT |  |  |  | `src/lib/money.ts:66` — BRL fixo |
| 50.09 | Configuração de unidades | `configuracoes.configuracao_unidades` | OP | MOD | → 01.04 |  | `cadastros.produtos` | `src/lib/db/schema.ts:213` — unidades e conversões cadastros.produtos |
| 50.10 | Configuração de notificações | `configuracoes.configuracao_notificacoes` | OP | CORE | ≡ 24.24 |  | `plataforma.painel` | `src/domain/notifications.ts:167` — silenciar tipos por usuário plataforma.painel · Configuração de notificações é uma só |
| 50.11 | Configuração de numerações | `configuracoes.configuracao_numeracoes` | PARC | COMP |  |  | `tec.fiscal` | `src/domain/fiscal/config.ts:90` — só série/próximo número fiscal tec.fiscal · Numerações gerais e séries fiscais: mesmo numerador (src/lib/core/numbering.ts) |
| 50.12 | Configuração de fluxos | `configuracoes.configuracao_fluxos` | NAO | FUT |  |  |  | inexistente |
| 50.13 | Configuração de aprovações | `configuracoes.configuracao_aprovacoes` | PARC | MOD | ≡ 24.09 |  | `compras.aprovacoes` | `src/domain/approvals.ts:263` — alçadas de compras compras.aprovacoes · Configuração de aprovações = aprovação de operações |
| 50.14 | Personalização de relatórios | `configuracoes.personalizacao_relatorios` | NAO | FUT |  |  |  | relatórios fixos |
| 50.15 | Domínios personalizados | `configuracoes.dominios_personalizados` | OP | MOD | ≡ 12.24 |  | `ecommerce.loja` | `src/domain/ecommerce/domains.ts:73` — DNS/TXT verificado ecommerce.loja · Domínio personalizado é um só (loja e catálogo) |
| 50.16 | Gestão de configurações por filial | `configuracoes.gestao_configuracoes_filial` | OP | CORE |  |  | `plataforma.administracao` | `src/app/(app)/administracao/parametros/catalog.ts:41` — parâmetros por empresa/filial plataforma.administracao |

## 51 — Escritório contábil (gestão da carteira de clientes) · `escritorio_contabil` · Implementado e operacional · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 51.01 | Clientes contábeis (PF/PJ, sócios, estabelecimentos, regime com vigência) *(achado na auditoria)* | `escritorio_contabil.clientes_contabeis_pf_pj_socios_estabelecimentos_regime_vige` | OP | MOD | **U** |  | `contabil.carteira` | `src/domain/accounting/clients.ts` `src/app/(app)/contabil/clientes/page.tsx` — Ficha 360° e consulta de CNPJ |
| 51.02 | Grupos de clientes contábeis *(achado na auditoria)* | `escritorio_contabil.grupos_clientes_contabeis` | OP | MOD | → 51.01 |  | `contabil.carteira` | `src/domain/accounting/team.ts` `src/app/(app)/contabil/grupos/page.tsx` |
| 51.03 | Departamentos, equipe e carteira por responsável *(achado na auditoria)* | `escritorio_contabil.departamentos_equipe_carteira_responsavel` | OP | MOD | → 51.01 |  | `contabil.carteira` | `src/domain/accounting/team.ts` `src/app/(app)/contabil/equipe/page.tsx` — visibleClientIds restringe a carteira |
| 51.04 | Caixa de entrada de entregas (pacote mensal de XML) *(achado na auditoria)* | `escritorio_contabil.caixa_entrada_entregas_pacote_mensal_xml` | OP | ADD | **U** | 51.01 | `contabil.entregas` | `src/domain/accounting/deliveries.ts` `src/app/(app)/contabil/entregas/page.tsx` |
| 51.05 | Vínculo empresa ERP ↔ escritório (código de vínculo) *(achado na auditoria)* | `escritorio_contabil.vinculo_empresa_erp_escritorio_codigo_vinculo` | OP | MOD | → 22.07 |  | `integracao.contabilidade` | `src/domain/accounting/link.ts` `src/app/(app)/administracao/integracoes/accounting-link.tsx` — Lado da empresa |
| 51.06 | Painel da carteira *(achado na auditoria)* | `escritorio_contabil.painel_carteira` | OP | MOD | → 51.01 |  | `contabil.carteira` | `src/app/(app)/contabil/page.tsx` |

## 52 — Rede de certificação digital (Master, Regional, Revenda, Contador) · `rede_certificacao` · Implementado e operacional · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 52.01 | Hierarquia de parceiros da rede *(achado na auditoria)* | `rede_certificacao.hierarquia_parceiros_rede` | OP | MOD | **U** |  | `rede.parceiro` | `src/domain/network/nodes.ts` `src/app/(app)/rede/page.tsx` |
| 52.02 | Preços em cascata por nível *(achado na auditoria)* | `rede_certificacao.precos_cascata_nivel` | OP | MOD | → 52.01 |  | `rede.parceiro` | `src/domain/network/prices.ts` `src/app/(app)/rede/precos/page.tsx` |
| 52.03 | Vendas de certificados pela rede *(achado na auditoria)* | `rede_certificacao.vendas_certificados_pela_rede` | OP | ADD | **U** | 52.01 | `rede.vendas` | `src/domain/network/sales.ts` `src/app/(app)/rede/vendas/page.tsx` |
| 52.04 | Vouchers de certificado *(achado na auditoria)* | `rede_certificacao.vouchers_certificado` | OP | ADD | **U** | 52.03 | `rede.vouchers_cupons` | `src/domain/network/vouchers.ts` `src/app/(app)/rede/vouchers/page.tsx` |
| 52.05 | Cupons da rede *(achado na auditoria)* | `rede_certificacao.cupons_rede` | OP | ADD | → 52.04 |  | `rede.vouchers_cupons` | `src/domain/network/coupons.ts` `src/app/(app)/rede/cupons/page.tsx` |
| 52.06 | Renovações de certificados *(achado na auditoria)* | `rede_certificacao.renovacoes_certificados` | OP | ADD | **U** | 52.01 | `rede.renovacoes` | `src/domain/network/renewals.ts` `src/app/(app)/rede/renovacoes/page.tsx` |
| 52.07 | Financeiro em camadas da rede (pré/pós-pago, carteira, fechamentos) *(achado na auditoria)* | `rede_certificacao.financeiro_camadas_rede_pre_pos_pago_carteira_fechamentos` | OP | ADD | **U** | 52.01 | `rede.financeiro` | `src/domain/network/billing.ts` `src/app/(app)/rede/financeiro/page.tsx` |
| 52.08 | Gestão da rede pela plataforma Intercert *(achado na auditoria)* | `rede_certificacao.gestao_rede_pela_plataforma_intercert` | OP | CORE |  |  | `rede.plataforma` | `src/app/(app)/rede/parametros/page.tsx` — Exclusivo da plataforma |

## 53 — Licenciamento e habilitação de módulos (integração Interos) · `licenciamento` · Implementado e operacional · MOD

| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |
|---|---|---|---|---|---|---|---|---|
| 53.01 | Habilitação de módulos por empresa (estado, versão, regra de acesso) *(achado na auditoria)* | `licenciamento.habilitacao_modulos_empresa_estado_versao_regra_acesso` | OP | CORE |  |  | `plataforma.administracao` | `src/lib/modules/access.ts` `src/lib/server/modules.ts` |
| 53.02 | API de gestão para o Interos (v1) *(achado na auditoria)* | `licenciamento.api_gestao_interos_v1` | OP | CORE |  |  | `plataforma.administracao` | `src/app/api/interos/v1/_lib.ts` — Token, escopos, idempotência, versão |
| 53.03 | Linha de base e migração de direitos *(achado na auditoria)* | `licenciamento.linha_base_migracao_direitos` | OP | CORE |  |  | `plataforma.administracao` | `src/domain/modules/baseline.ts` |
| 53.04 | Consulta de módulos contratados (tela) *(achado na auditoria)* | `licenciamento.consulta_modulos_contratados_tela` | OP | CORE |  |  | `plataforma.administracao` | `src/app/(app)/administracao/modulos/page.tsx` |
