# Matriz de dependências (catálogo 1.0.0)

> Gerado por `npm run modules:inventory`. Dependência **obrigatória** = regra real de negócio; **componente técnico** = serviço compartilhado que fica ativo sozinho; **integração opcional** = funciona quando o outro módulo também está habilitado.

| Módulo | Classe | Pai | Obrigatórias diretas | Basta um de | Transitivas | Componentes técnicos | Dependentes | Integrações opcionais | Pré-requisitos de configuração | Desligamento |
|---|---|---|---|---|---|---|---|---|---|---|
| `plataforma.acesso` Autenticação e sessão | platform | — | — | — | — | — | — | — | — | immediate → consulta |
| `plataforma.administracao` Administração essencial | platform | — | — | — | — | — | — | — | — | immediate → consulta |
| `plataforma.backup` Backup e restauração | platform | — | — | — | — | — | — | — | — | immediate → consulta |
| `plataforma.painel` Painel, notificações e suporte | platform | — | — | — | — | — | — | — | — | immediate → consulta |
| `plataforma.arquivos` Arquivos e documentos | platform | — | — | — | — | — | — | — | — | immediate → consulta |
| `tec.estoque` Motor de estoque | technical | — | — | — | — | — | — | — | — | immediate → consulta |
| `tec.financeiro` Motor financeiro | technical | — | — | — | — | — | — | — | — | immediate → consulta |
| `tec.fiscal` Motor fiscal | technical | — | — | — | — | — | — | — | — | immediate → consulta |
| `tec.precos` Motor de preços | technical | — | — | — | — | — | — | — | — | immediate → consulta |
| `tec.pagamentos` Intenções de pagamento (Pix) | technical | — | — | — | — | — | — | — | — | immediate → consulta |
| `cadastros.produtos` Produtos e serviços | commercial | — | — | — | — | `tec.precos`, `tec.estoque` | `produtos.alteracao_massa`, `produtos.etiquetas`, `produtos.balanca`, `produtos.promocoes`, `produtos.kits`, `vendas.pdv`, `vendas.documentos`, `ecommerce.loja`, `estoque.gestao`, `compras.reposicao`, `compras.pedidos`, `compras.recebimento`, `clientes.fidelidade`, `vendas.devolucoes`, `pdv.recebimento_crediario`, `pdv.reserva_prevenda`, `ecommerce.promocoes`, `ecommerce.banco`, `ecommerce.canais`, `estoque.transferencias`, `estoque.inventario`, `estoque.lotes`, `estoque.inventario_fiscal`, `compras.cotacoes`, `compras.aprovacoes`, `compras.nota_a_confirmar`, `compras.cte`, `compras.precificacao`, `vendas.pdv_offline`, `ecommerce.marketplaces` | — | — | immediate → consulta |
| `produtos.alteracao_massa` Alteração de produtos em massa | optional_function | `cadastros.produtos` | — | — | `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | — | — | immediate → oculto |
| `produtos.etiquetas` Etiquetas de produtos | optional_function | `cadastros.produtos` | — | — | `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | `compras.recebimento`: Atalho de etiquetas a partir do recebimento concluído | — | immediate → oculto |
| `produtos.balanca` Balança etiquetadora | optional_function | `cadastros.produtos` | — | — | `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | `vendas.pdv`: Leitura da etiqueta de balança no PDV | — | immediate → oculto |
| `produtos.promocoes` Promoções | optional_function | `cadastros.produtos` | — | — | `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | — | — | immediate → consulta |
| `produtos.kits` Kits e composição | optional_function | `cadastros.produtos` | — | — | `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | — | — | immediate → consulta |
| `cadastros.clientes` Gestão de clientes | commercial | — | — | — | — | — | `clientes.fidelidade` | — | — | immediate → consulta |
| `clientes.fidelidade` Programa de fidelidade | optional_function | `cadastros.clientes` | `vendas.pdv` | — | `cadastros.clientes`, `vendas.pdv`, `caixa.operacao`, `cadastros.produtos` | `tec.estoque`, `tec.precos`, `tec.financeiro`, `tec.pagamentos` | — | — | — | immediate → consulta |
| `cadastros.fornecedores` Fornecedores | commercial | — | — | — | — | — | `compras.pedidos`, `compras.recebimento`, `compras.cotacoes`, `compras.aprovacoes`, `compras.nota_a_confirmar`, `compras.cte`, `compras.precificacao` | — | — | immediate → consulta |
| `caixa.operacao` Caixa | commercial | — | — | — | — | `tec.financeiro` | `vendas.pdv`, `clientes.fidelidade`, `vendas.devolucoes`, `pdv.recebimento_crediario`, `pdv.reserva_prevenda`, `vendas.pdv_offline` | — | — | drain (3 d) → consulta |
| `vendas.pdv` Frente de caixa (PDV) | commercial | — | `caixa.operacao`, `cadastros.produtos` | — | `caixa.operacao`, `cadastros.produtos` | `tec.estoque`, `tec.precos`, `tec.financeiro`, `tec.pagamentos` | `clientes.fidelidade`, `vendas.devolucoes`, `pdv.recebimento_crediario`, `pdv.reserva_prevenda`, `vendas.pdv_offline` | `fiscal.nfce`: Emissão da NFC-e na conclusão da venda; sem ele a venda sai com recibo não fiscal<br>`cadastros.clientes`: Identificação e cadastro rápido do cliente no PDV<br>`financeiro.contas_receber`: Venda a prazo (crediário) gera títulos a receber<br>`vendas.documentos`: Importar orçamento/pedido no PDV | Ao menos um terminal ativo na filial (Administração › Terminais) | drain (1 d) → consulta |
| `vendas.devolucoes` Trocas e devoluções | optional_function | `vendas.pdv` | — | — | `vendas.pdv`, `caixa.operacao`, `cadastros.produtos` | `tec.estoque`, `tec.precos`, `tec.financeiro`, `tec.pagamentos` | — | — | — | drain (90 d) → consulta |
| `pdv.recebimento_crediario` Recebimento de parcelas no PDV | optional_function | `vendas.pdv` | `financeiro.contas_receber` | — | `vendas.pdv`, `caixa.operacao`, `cadastros.produtos`, `financeiro.contas_receber` | `tec.estoque`, `tec.precos`, `tec.financeiro`, `tec.pagamentos` | — | — | — | immediate → consulta |
| `pdv.reserva_prevenda` Reserva de estoque na pré-venda | optional_function | `vendas.pdv` | — | — | `vendas.pdv`, `caixa.operacao`, `cadastros.produtos` | `tec.estoque`, `tec.precos`, `tec.financeiro`, `tec.pagamentos` | — | — | — | drain (3 d) → oculto |
| `vendas.documentos` Orçamentos e pedidos de venda | commercial | — | `cadastros.produtos` | — | `cadastros.produtos` | `tec.estoque`, `tec.precos` | — | `vendas.pdv`: Faturar no PDV (importar documento)<br>`fiscal.nfe`: Faturar pedido em NF-e | — | drain (30 d) → consulta |
| `vendas.comissoes` Vendedores e comissões | commercial | — | — | vendas.pdv / vendas.documentos / ecommerce.loja | — | — | — | — | — | immediate → consulta |
| `ecommerce.loja` Loja virtual | commercial | — | `cadastros.produtos`, `fiscal.nfe` | — | `cadastros.produtos`, `fiscal.nfe` | `tec.estoque`, `tec.precos`, `tec.fiscal`, `tec.financeiro` | `ecommerce.promocoes`, `ecommerce.banco`, `ecommerce.canais`, `ecommerce.marketplaces` | — | Loja criada, com dados legais, pagamentos e frete configurados e publicada | drain (30 d) → consulta |
| `ecommerce.promocoes` Cupons e recuperação de carrinhos | optional_function | `ecommerce.loja` | — | — | `ecommerce.loja`, `cadastros.produtos`, `fiscal.nfe` | `tec.estoque`, `tec.precos`, `tec.fiscal`, `tec.financeiro` | — | — | — | immediate → consulta |
| `ecommerce.banco` Banco Intercert e repasses | optional_function | `ecommerce.loja` | — | — | `ecommerce.loja`, `cadastros.produtos`, `fiscal.nfe` | `tec.estoque`, `tec.precos`, `tec.fiscal`, `tec.financeiro` | — | — | — | drain (60 d) → consulta |
| `ecommerce.canais` Canais de venda (marketplaces e redes) | optional_function (needs_confirmation) | `ecommerce.loja` | — | — | `ecommerce.loja`, `cadastros.produtos`, `fiscal.nfe` | `tec.estoque`, `tec.precos`, `tec.fiscal`, `tec.financeiro` | — | — | — | immediate → consulta |
| `estoque.gestao` Saldos e movimentação de estoque | commercial | — | `cadastros.produtos` | — | `cadastros.produtos` | `tec.estoque`, `tec.precos` | `estoque.transferencias`, `estoque.inventario`, `estoque.lotes`, `estoque.inventario_fiscal` | — | — | immediate → consulta |
| `estoque.transferencias` Transferências entre depósitos e filiais | optional_function | `estoque.gestao` | — | — | `estoque.gestao`, `cadastros.produtos` | `tec.estoque`, `tec.precos` | — | — | — | drain (30 d) → consulta |
| `estoque.inventario` Inventário e contagem | optional_function | `estoque.gestao` | — | — | `estoque.gestao`, `cadastros.produtos` | `tec.estoque`, `tec.precos` | — | — | — | drain (15 d) → consulta |
| `estoque.lotes` Lotes e validades | optional_function | `estoque.gestao` | — | — | `estoque.gestao`, `cadastros.produtos` | `tec.estoque`, `tec.precos` | — | — | — | scheduled → consulta |
| `estoque.inventario_fiscal` Inventário em data-base | optional_function | `estoque.gestao` | — | — | `estoque.gestao`, `cadastros.produtos` | `tec.estoque`, `tec.precos` | — | — | — | immediate → oculto |
| `compras.reposicao` Planejamento de reposição | commercial | — | `cadastros.produtos` | — | `cadastros.produtos` | `tec.estoque`, `tec.precos` | — | `compras.pedidos`: Gerar pedido de compra a partir da sugestão<br>`compras.cotacoes`: Gerar cotação a partir da sugestão | — | immediate → consulta |
| `compras.pedidos` Pedidos de compra | commercial | — | `cadastros.fornecedores`, `cadastros.produtos` | — | `cadastros.fornecedores`, `cadastros.produtos` | `tec.precos`, `tec.estoque` | `compras.cotacoes`, `compras.aprovacoes` | `compras.aprovacoes`: Pedido passa pela política de aprovação<br>`compras.recebimento`: Receber mercadorias contra o pedido | — | drain (60 d) → consulta |
| `compras.cotacoes` Cotações de compra | commercial | — | `compras.pedidos` | — | `compras.pedidos`, `cadastros.fornecedores`, `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | — | — | immediate → consulta |
| `compras.aprovacoes` Aprovação de compras | commercial | — | `compras.pedidos` | — | `compras.pedidos`, `cadastros.fornecedores`, `cadastros.produtos` | `tec.precos`, `tec.estoque` | — | — | — | drain (15 d) → consulta |
| `compras.recebimento` Recebimento de mercadorias | commercial | — | `cadastros.produtos`, `cadastros.fornecedores` | — | `cadastros.produtos`, `cadastros.fornecedores` | `tec.estoque`, `tec.financeiro`, `tec.fiscal`, `tec.precos` | `compras.nota_a_confirmar`, `compras.cte`, `compras.precificacao` | `compras.pedidos`: Conferência contra o pedido; sem ele a entrada é sem pedido | — | drain (15 d) → consulta |
| `compras.nota_a_confirmar` Entrada com nota a confirmar | optional_function | `compras.recebimento` | — | — | `compras.recebimento`, `cadastros.produtos`, `cadastros.fornecedores` | `tec.estoque`, `tec.financeiro`, `tec.fiscal`, `tec.precos` | — | — | — | drain (60 d) → consulta |
| `compras.cte` CT-e de frete (entrada) | optional_function | `compras.recebimento` | — | — | `compras.recebimento`, `cadastros.produtos`, `cadastros.fornecedores` | `tec.estoque`, `tec.financeiro`, `tec.fiscal`, `tec.precos` | — | — | — | immediate → consulta |
| `compras.precificacao` Precificação após a entrada | optional_function | `compras.recebimento` | — | — | `compras.recebimento`, `cadastros.produtos`, `cadastros.fornecedores` | `tec.estoque`, `tec.financeiro`, `tec.fiscal`, `tec.precos` | — | — | — | immediate → oculto |
| `financeiro.contas_receber` Contas a receber | commercial | — | — | — | — | `tec.financeiro` | `pdv.recebimento_crediario`, `financeiro.inadimplencia`, `financeiro.cobranca_whatsapp`, `financeiro.carne`, `financeiro.baixa_lote` | — | — | drain (365 d) → consulta |
| `financeiro.inadimplencia` Alerta e bloqueio de inadimplentes | optional_function | `financeiro.contas_receber` | — | — | `financeiro.contas_receber` | `tec.financeiro` | — | — | — | immediate → oculto |
| `financeiro.cobranca_whatsapp` Cobrança pelo WhatsApp | optional_function | `financeiro.contas_receber` | — | — | `financeiro.contas_receber` | `tec.financeiro` | — | — | — | immediate → oculto |
| `financeiro.carne` Impressão de carnê | optional_function | `financeiro.contas_receber` | — | — | `financeiro.contas_receber` | `tec.financeiro` | — | — | — | immediate → oculto |
| `financeiro.contas_pagar` Contas a pagar | commercial | — | — | — | — | `tec.financeiro` | — | — | — | drain (365 d) → consulta |
| `financeiro.baixa_lote` Baixa de títulos em lote | optional_function | `financeiro.contas_receber` | — | — | `financeiro.contas_receber` | `tec.financeiro` | — | — | — | immediate → oculto |
| `financeiro.fluxo_caixa` Fluxo de caixa | commercial | — | — | — | — | `tec.financeiro` | `financeiro.fechamento_periodo` | — | — | immediate → consulta |
| `financeiro.conciliacao` Conciliação bancária | commercial | — | — | — | — | `tec.financeiro` | — | — | — | immediate → consulta |
| `financeiro.cartoes` Recebíveis de cartão | commercial | — | — | — | — | `tec.financeiro` | `financeiro.taxas_adquirente` | — | — | drain (400 d) → consulta |
| `financeiro.taxas_adquirente` Taxas por bandeira e arquivo da adquirente | optional_function | `financeiro.cartoes` | — | — | `financeiro.cartoes` | `tec.financeiro` | — | — | — | immediate → consulta |
| `financeiro.relatorios` DRE gerencial e aging | commercial | — | — | — | — | `tec.financeiro` | — | — | — | immediate → consulta |
| `financeiro.fechamento_periodo` Fechamento de período | optional_function | `financeiro.fluxo_caixa` | — | — | `financeiro.fluxo_caixa` | `tec.financeiro` | — | — | — | immediate → consulta |
| `financeiro.exportacao_dominio` Exportação para a Domínio | commercial | — | — | financeiro.contas_receber / financeiro.contas_pagar | — | — | — | — | — | immediate → consulta |
| `fiscal.nfce` NFC-e | commercial | — | — | — | — | `tec.fiscal` | — | — | Configuração fiscal da filial, certificado e CSC | drain (30 d) → consulta |
| `fiscal.nfe` NF-e | commercial | — | — | — | — | `tec.fiscal` | `ecommerce.loja`, `ecommerce.promocoes`, `ecommerce.banco`, `ecommerce.canais`, `ecommerce.marketplaces` | — | Configuração fiscal da filial e certificado | drain (30 d) → consulta |
| `fiscal.nfse` NFS-e | commercial | — | — | — | — | `tec.fiscal` | — | — | Integração de NFS-e do município | drain (30 d) → consulta |
| `fiscal.livro_entradas` Livro de entradas | commercial | — | — | — | — | `tec.fiscal` | — | — | — | immediate → consulta |
| `fiscal.sped` SPED Fiscal e EFD Contribuições | commercial | — | — | — | — | `tec.fiscal` | — | — | — | immediate → consulta |
| `fiscal.sintegra` Sintegra | commercial | — | — | — | — | `tec.fiscal` | — | — | — | immediate → consulta |
| `fiscal.tributacao_avancada` Tributação avançada | commercial | — | — | fiscal.nfe / fiscal.nfce | — | — | — | — | — | immediate → consulta |
| `fiscal.reforma_tributaria` Reforma tributária (IBS/CBS/IS) | commercial | — | — | fiscal.nfe / fiscal.nfce | — | — | — | — | — | immediate → consulta |
| `relatorios.gerenciais` Central de relatórios e relatórios gerenciais | commercial | — | — | — | — | — | — | — | — | immediate → consulta |
| `relatorios.curva_abc` Curva ABC de produtos | commercial | — | — | — | — | — | — | — | — | immediate → consulta |
| `gestao.metas` Metas de vendas | commercial | — | — | — | — | — | — | — | — | immediate → consulta |
| `implantacao.importacao` Importação de cadastros e saldos | commercial | — | — | — | — | — | — | — | — | immediate → consulta |
| `integracao.contabilidade` Área da contabilidade (vínculo com escritório) | commercial | — | — | — | — | `tec.fiscal` | — | — | — | immediate → consulta |
| `contabil.carteira` Carteira de clientes contábeis | commercial | — | — | — | — | — | `contabil.entregas`, `contabil.certificados` | — | — | immediate → consulta |
| `contabil.entregas` Caixa de entrada de entregas | optional_function | `contabil.carteira` | — | — | `contabil.carteira` | — | — | — | — | immediate → consulta |
| `contabil.certificados` Certificados digitais dos clientes | optional_function | `contabil.carteira` | — | — | `contabil.carteira` | — | — | — | — | drain (60 d) → consulta |
| `rede.parceiro` Rede de certificação — nó do parceiro | commercial | — | — | — | — | — | `rede.vendas`, `rede.renovacoes`, `rede.financeiro`, `rede.vouchers_cupons` | — | — | immediate → consulta |
| `rede.vendas` Vendas de certificados pela rede | optional_function | `rede.parceiro` | — | — | `rede.parceiro` | — | `rede.vouchers_cupons` | — | — | drain (60 d) → consulta |
| `rede.vouchers_cupons` Vouchers e cupons da rede | optional_function | `rede.vendas` | — | — | `rede.vendas`, `rede.parceiro` | — | — | — | — | immediate → consulta |
| `rede.renovacoes` Renovações | optional_function | `rede.parceiro` | — | — | `rede.parceiro` | — | — | — | — | immediate → consulta |
| `rede.financeiro` Financeiro em camadas da rede | optional_function | `rede.parceiro` | — | — | `rede.parceiro` | — | — | — | — | scheduled → consulta |
| `rede.plataforma` Gestão da rede (plataforma Intercert) | platform | — | — | — | — | — | — | — | — | immediate → consulta |
| `fiscal.mdfe` MDF-e | commercial (planned) | — | — | — | — | — | — | — | — | immediate → consulta |
| `vendas.pdv_offline` PDV em contingência offline | optional_function (planned) | `vendas.pdv` | — | — | `vendas.pdv`, `caixa.operacao`, `cadastros.produtos` | `tec.estoque`, `tec.precos`, `tec.financeiro`, `tec.pagamentos` | — | — | — | immediate → consulta |
| `ecommerce.marketplaces` Integração de pedidos com marketplaces | optional_function (planned) | `ecommerce.loja` | — | — | `ecommerce.loja`, `cadastros.produtos`, `fiscal.nfe` | `tec.estoque`, `tec.precos`, `tec.fiscal`, `tec.financeiro` | — | — | — | immediate → consulta |
