# Relatório 4 — Recursos ausentes (D) e parciais relevantes (B) que valem a pena acrescentar

Base: `matriz.json` / `RELATORIO-3-matriz.md`. Inclui **todas** as linhas classe D e as linhas classe B de prioridade alta ou média; as dependências de integração (classe F) que destravam esses recursos estão na última seção. Esforço: P ≤ 1 semana, M 1–3 semanas, G > 3 semanas (uma pessoa, incluindo testes), estimativa de ordem de grandeza.

Regra: cada proposta indica **o que reutilizar**; nenhuma cria tabela/serviço que já exista com outro nome. Onde há criação inevitável (documento comercial de venda, componentes de kit/composição, escrituração de entradas), a justificativa está na coluna *Dependências/reuso* e no RELATORIO-5.

## Top 15 (D/B) por prioridade e impacto

| # | ID | Recurso | Classe | Prioridade | Esforço | Por que primeiro |
|---|---|---|---|---|---|---|
| 1 | VEN-01 | Documento comercial: orçamento | D | alta | G | Processo comercial pré-venda (materiais de construção, ferragens, B2B) dentro do ERP. |
| 2 | VEN-02 | Documento comercial: pedido de venda (reserva, entrega parcial, faturamento) | D | alta | G | Vendas B2B, entrega futura e televendas. |
| 3 | VEN-10 | Recebimento de parcelas do crediário no PDV | D | alta | M | Crediário próprio é central no varejo PME; cliente paga a parcela no balcão. |
| 4 | COM-07 | Precificação a partir da entrada (margem → novo preço, com prévia) | B | alta | M | Mantém margem após aumento de custo do fornecedor (dor nº 1 do varejo). |
| 5 | COM-04 | Cadastrar produto novo a partir do XML de compra | B | alta | M | Cadastro de mix novo direto da nota — maior ganho de tempo em compras. |
| 6 | COM-03 | Entrada de nota sem pedido + tributos de escrituração por item | B | alta | M | Entrada de notas sem pedido (compras do dia a dia) e base para escrituração. |
| 7 | FIS-12 | Regras de tributação: ICMS ST/MVA, alíquota por UF, resolução por NCM/operação | B | alta | G | Tributação correta para Regime Normal e ST; menos rejeições. |
| 8 | FIS-19 | Reforma tributária (IBS/CBS/IS) nos documentos | D | alta | G | Conformidade obrigatória no calendário da reforma (risco de rejeição). |
| 9 | FIN-05 | Boleto registrado (emissão/registro via API, PDF, linha digitável) | B | alta | G | Cobrança bancária do crediário/B2B sem sistema externo. |
| 10 | PDV-12 | Importar orçamento/pedido no PDV | D | alta | M | Fecha o ciclo orçamento/pedido → caixa. |
| 11 | PDV-06 | Código de barras de balança (peso/valor) no PDV | D | média | P | Indispensável para açougue, padaria, hortifrúti com balança etiquetadora. |
| 12 | CAD-17 | Etiquetas de gôndola/código de barras (inclusive após recebimento) | D | média | M | Precificação de gôndola e etiquetagem após recebimento. |
| 13 | VEN-05 | Comissões de vendedores | D | média | M | Remuneração variável de vendedores — rotina mensal de quase todo varejo. |
| 14 | CAD-12 | Kits de produtos | D | média | M | Cestas, combos e kits promocionais comuns no varejo. |
| 15 | FIN-24 | Taxas de cartão por bandeira/parcelas e conciliação com a adquirente | B | média | M | Conferência do que a maquininha realmente pagou. |

Critério do ranking: (1) fluxo diário do varejo PME parado ou feito fora do sistema; (2) risco fiscal/obrigação legal; (3) ganho para o escritório contábil; (4) esforço e dependências (itens que dependem de integração externa sobem só quando a integração já existe ou é simples).

## Por módulo

### Plataforma e administração

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| PLA-09 | Central de relatórios / Assistente de relatórios (+400 relatórios, lista com tags e parâmetros) | B | média | Gestor e contador obtêm informações sem planilhas externas. | M (1–3 semanas) | FIN-REL (DRE/aging), EST-05 (inventário valorizado), VEN-05 (comissões). | /relatorios/gerenciais, /relatorios/curva-abc, /fiscal/relatorios, /caixa/[id]/relatorio, exportações /api/export/[key]; src/domain/reports.ts, src/exports/reports.ts |
| PLA-19 | Importação de dados de outros sistemas (migração) | B | média | Reduz tempo de implantação de clientes vindos de outro ERP. | M (1–3 semanas) | product-import.ts (reutilizar motor), customers.ts, suppliers.ts, stock.ts (movimento 'initial'), finance.ts (createTitle). | /produtos/importar e /produtos/importar/[id] (product_imports, CSV até 1.000 linhas); src/domain/product-import.ts |
| PLA-27 | WhatsApp — mensagens padrão por módulo com variáveis | B | média | Cobrança e envio de orçamento/pedido pelo canal mais usado pelo PME. | P (≤ 1 semana) | settings (modelos), FIN-COB (cobrança), VEN-01/02. | Links wa.me em /vendas/[id]/conclusao (WhatsAppLink), /compras/pedidos/[id] (send-order.tsx), /contabil/certificados/[id] (charge-form.tsx) |
| PLA-14 | Aceite de termos de uso e políticas de privacidade (Gweb; apps móveis) | D | média | Conformidade LGPD e segurança jurídica do SaaS. | P (≤ 1 semana) | Texto jurídico; user_prefs (aceite por usuário) + audit_logs. | — (não há página de privacidade/termos; grep 'privacidade\|LGPD\|termos de uso' sem resultado em src/) |
| PLA-03 | Autenticação com verificação de IP (Gweb) | D | baixa | Segurança para empresas com acesso remoto; reduz uso indevido de credenciais. | M (1–3 semanas) | Parâmetros (settings) + sessions; preferir junto com 2FA/sessões ativas (lacuna 9). | sessions (campos ip e userAgent existem, userAgent não preenchido); src/app/actions/session.ts; src/lib/server/session.ts |
| PLA-12 | Modo escuro | D | baixa | Conforto visual. | M (1–3 semanas) | Tokens de cor em src/app/globals.css. | — |
| PLA-13 | Informativo de novidades e selo 'New' | D | baixa | Adoção de funcionalidades novas. | P (≤ 1 semana) | notifications, help_articles. | Central de notificações (/notificacoes) e artigos de ajuda |
| PLA-22 | Campos personalizados (6 por módulo: estoque, cliente, fornecedor) | D | baixa | Flexibilidade de cadastro sem customização. | M (1–3 semanas) | Campo json aditivo em products/customers/suppliers + definição em settings. | — |
| PLA-28 | Envio de SMS (SMSDev — Ajatus) | D | baixa | Lembretes de cobrança. | M (1–3 semanas) | Provedor de SMS (integração nova na Central de integrações). | — (canais externos de notificação inexistentes) |

### Cadastros

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| CAD-03 | Transportadoras | B | média | Menos digitação e menos rejeição por dados de transportador. | P (≤ 1 semana) | suppliers.category; nfe-wizard.tsx (passo transporte). | NF-e: bloco transporte digitado no assistente (src/domain/fiscal/nfe.ts NfeInput.transport: carrierName/Doc/UF, placa) — sem cadastro reutilizável |
| CAD-05 | Vendedores (cadastro) | B | média | Base para comissões e metas por vendedor. | P (≤ 1 semana) | users, roles; VEN-05 (comissões), VEN-06 (metas por vendedor). | Vendedor = usuário (carts.sellerId/sales.sellerId validados contra users em src/domain/carts.ts:151); customers.sellerId |
| CAD-11 | Fatores de conversão (entrada, por fornecedor e de referência na venda) | B | média | Vender/comprar em embalagens diferentes sem cadastros duplicados. | M (1–3 semanas) | unit_conversions, pricing-calc.ts, carts.ts. | unit_conversions (por produto, 1 CX = 12 UN); supplier_products.conversionFactor aprendido no recebimento (src/domain/receipts.ts:222, 860-873; conference.tsx campo 'Fator de conversão') |
| CAD-15 | Promoções (lista de promoções, leve X pague Y, clube Scanntech; Ajatus promoções por data/dia da semana) | B | média | Ferramenta comercial básica de mercado/varejo. | M (1–3 semanas) | prices, pricing-calc.ts (calcSale), carts.ts. | Tabela de preço do tipo 'Promocional' + vigência validFrom/validTo por preço (aux-forms.tsx:69; prices) |
| CAD-18 | Alteração em massa de produtos (cadastro e a partir da nota de compra) | B | média | Reajustes de preço e correções fiscais rápidas. | M (1–3 semanas) | product-import.ts (motor de atualização), pricing.savePrice/recordPriceHistory. | — (só edição individual e importação CSV 'só atualizar') |
| CAD-12 | Kits de produtos (venda de conjunto com baixa dos componentes) | D | média | Cestas, combos e kits promocionais comuns no varejo. | M (1–3 semanas) | products.type, stock.ts (postMovements), sales.ts, fiscal/service.ts (buildItems). | — |
| CAD-13 | Composição de produtos (ficha técnica, montagem/desmontagem, composição automática, desmembramento de carcaça; Gweb composição; tutorial) | D | média | Atende segmentos de açougue, padaria, materiais montados. | G (> 3 semanas) | CAD-12 (componentes), stock.ts, inventory/custo médio. | — |
| CAD-16 | Balança etiquetadora: informações nutricionais (RDC 359/360 e 429), carga da balança e configuração de etiquetas | D | média | Essencial para mercados, padarias e açougues (produtos pesados). | M (1–3 semanas) | Campos aditivos em products (plu, shelfLifeDays, nutrition json); exportação de arquivo; PDV-06 (leitura do código). | — |
| CAD-17 | Etiquetas de produtos (gerador com modelos, a partir da nota de compra; etiquetas personalizadas) | D | média | Precificação de gôndola e etiquetagem após recebimento. | M (1–3 semanas) | products/skus/prices; /compras/recebimentos/[id] (atalho 'Imprimir etiquetas'). | — (grep 'etiqueta' só aparece em gestão contábil) |
| CAD-21 | Clube de fidelidade (crédito por % da venda, uso em compras/parcelas; configuração no PDV; ocultar matéria-prima nas buscas) | D | média | Retenção de clientes no varejo. | M (1–3 semanas) | credit_vouchers, sales.ts (conclusão da venda), customers. | Vale-crédito (credit_vouchers, credit_voucher_moves) usado como meio de pagamento no PDV |
| CAD-04 | Veículos (placa, RNTRC, UF) | D | baixa | Pré-requisito de MDF-e. | P (≤ 1 semana) | TRA-02. | Placa/UF digitadas no transporte da NF-e |
| CAD-19 | Replicar código interno no código de barras | D | baixa | Etiquetas internas leem no PDV. | P (≤ 1 semana) | CAD-17. | skus.barcode opcional; busca do PDV por código interno, SKU e GTIN |

### Estoque

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| EST-02 | Controle de lotes e validades (lote na compra, seleção na venda, status por vencimento, notificações) | B | média | Perecíveis, farmácias (rastreabilidade obrigatória no XML), FEFO. | G (> 3 semanas) | stock.ts, receipts.ts (propagar lot), sales/carts (seleção de lote), fiscal/service.ts (rastro no XML), routines/stock.ts (alerta). | Campos lot/lotExpiry em stock_movements e lote/validade por item no recebimento (/compras/recebimentos/[id]); não propagados no confirmReceipt (lacuna 15) |
| EST-05 | Inventário de estoque fiscal (data-base, valoração, conferência; inclusão no SPED bloco H / Sintegra 74; Gweb relatório de inventário) | B | média | Obrigação anual entregue ao contador (Livro de Inventário/bloco H). | M (1–3 semanas) | stock_movements; fiscal/export.ts (incluir no pacote contábil). | stock_movements (balanceAfter, avgCostAfter, seq por saldo) permite reconstruir saldo e custo em data-base; nenhum relatório de inventário fiscal |

### Compras

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| COM-03 | Nota de compra — listagem, lançamento manual, detalhes e conclusão (Gpro; Gweb lista/detalhes/cadastro manual; comparativo; evolução de compras) | B | alta | Entrada de notas sem pedido (compras do dia a dia) e base para escrituração. | M (1–3 semanas) | receipts.ts; FIS-ESC (escrituração de entradas). | /compras/recebimentos, /compras/recebimentos/novo (modos Importar XML / Ler chave / Sem XML pelo pedido), /compras/recebimentos/[id] (receipts; conferência; conclusão idempotente gera estoque, custo e título a pagar); src/domain/receipts.ts (createManualReceipt, confirmReceipt) |
| COM-04 | Importação de XML de NF-e com vínculo de itens, fator de conversão, cadastro automático de fornecedor e de produtos novos (Gpro; Gweb; comparativo) | B | alta | Cadastro de mix novo direto da nota — maior ganho de tempo em compras. | M (1–3 semanas) | receipts.ts, products.ts (createProduct), supplier_products. | importNfeXml (src/domain/receipts.ts:437) — parse 4.00, chave com DV, fornecedor criado automaticamente, vínculo por código do fornecedor/GTIN/pedido memorizado em supplier_products, fator editável na conferência (conference.tsx) |
| COM-07 | Precificação a partir da nota de compra (composição do custo, margem, novo preço, variação; configuração de compras do Gweb) | B | alta | Mantém margem após aumento de custo do fornecedor (dor nº 1 do varejo). | M (1–3 semanas) | pricing.ts (savePrice, priceMetrics), receipts.ts (gancho pós-conclusão), settings (margem padrão). | confirmReceipt atualiza skus.costAcquisition/costTotal e price_history (receipts.ts:1018-1030); priceMetrics (margem/markup) em src/domain/pricing.ts; preço editado só em /produtos/[id]?tab=precos |
| COM-09 | Conversor de CFOP de entrada/saída | B | média | Escrituração correta de entradas com ST e devoluções. | P (≤ 1 semana) | settings ou tax_groups (tabela de pares), receipts.ts. | receipts.entryCfop (padrão 1102/2102 — docs/regras-assumidas.md §14) |
| COM-11 | Devolução a fornecedor importando a nota de compra | B | média | Trata avarias/divergências com fornecedor dentro do ERP. | M (1–3 semanas) | fiscal/nfe.ts (loadOrigin), receipts.ts, finance.ts; Focus para autorização. | NF-e de devolução a partir do pedido de compra (/fiscal/nfe/nova?origem=purchase_order:<id>; loadOrigin em src/domain/fiscal/nfe.ts:246-273, CFOP 5202/5411, chaves referenciadas dos recebimentos) |
| COM-10 | Lançar CT-e de entrada (frete) para Sintegra/SPED | D | baixa | Crédito de ICMS sobre frete e SPED completo (Regime Normal). | M (1–3 semanas) | FIS-ESC; receipts (vínculo); FIS-SPED. | Frete do recebimento rateado no custo (receipts.freight); 'Última compra' de fornecedores considera CT-e/NFS-e (item 121 da auditoria) |

### Vendas

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| VEN-01 | Orçamento (retaguarda Gpro; Gweb novo/lista/configurações com validade em dias úteis; comparativo) | D | alta | Processo comercial pré-venda (materiais de construção, ferragens, B2B) dentro do ERP. | G (> 3 semanas) | pricing-calc.ts (calcSale), pricing.ts (resolvePrices), counters (numeração), carts.ts (importar no PDV), fiscal/nfe.ts (nova origem). | — (auditoria item 156: Não implementado; grep 'orçamento' só em compras) |
| VEN-02 | Pedido de venda (retaguarda: reserva, entrega parcial Q.Sal, movimentar estoque/financeiro opcional, faturamento; Gweb novo/lista/configurações; comparativo; evolução) | D | alta | Vendas B2B, entrega futura e televendas. | G (> 3 semanas) | VEN-01 (mesmo documento), stock.ts (reservas), sales.ts, finance.createTitle, fiscal/nfe.ts loadOrigin('sales_order'). | — (não existe entidade de pedido de venda; stock_reservations existe e é usado por transferências) |
| VEN-10 | Recebimento de contas (parcelas) no PDV e estorno (Gpro F6; Gweb F9; comparativo) | D | alta | Crediário próprio é central no varejo PME; cliente paga a parcela no balcão. | M (1–3 semanas) | finance.ts, cash.ts, /pdv (nova ação), permissões finance.settle + pdv. | — (PDV só exibe saldo em aberto do cliente; baixa só em /financeiro/receber/[id] via finance.settleInstallment) |
| VEN-06 | Metas da empresa e por vendedor (rateio, barra de progresso, relatório) | B | média | Gestão de equipe de vendas. | P (≤ 1 semana) | goals, CAD-05. | /dashboard/metas (goals: receita, nº de vendas, ticket por mês e filial/empresa); src/domain/goals.ts |
| VEN-07 | Limite de crédito e inadimplência nos documentos (Gweb) | B | média | Reduz inadimplência no crediário. | P (≤ 1 semana) | installments (vencidos), settings, carts/pagamento. | customers.creditLimit (permissão customer.credit_limit); PDV mostra saldo em aberto e disponível (src/app/(app)/pdv/page.tsx customerInfo) e bloqueia crediário acima do limite |
| VEN-05 | Comissões (comissão preferencial do vendedor no Gweb; profissionais com comissão no Ajatus) | D | média | Remuneração variável de vendedores — rotina mensal de quase todo varejo. | M (1–3 semanas) | CAD-05 (vendedor), sales/returns, finance.createTitle, relatórios. | — (auditoria item 157: Não implementado; grep 'comiss' sem resultado); sales.sellerId registrado |
| VEN-13 | Consulta de preços (terminal de consulta) | D | baixa | Exigência de alguns PROCONs/mercados. | P (≤ 1 semana) | pricing.resolvePrices, /api/pdv/products. | Busca de produtos do PDV (/api/pdv/products) |
| VEN-15 | Força de vendas Gped (app de pedidos externos, versão antiga GLink, habilitação no Gweb, landing 'vendas externas', comparativo) | D | baixa | Distribuidoras e representantes. | G (> 3 semanas) | VEN-02. | — (PWA responsivo; não há pedido de venda) |

### PDV e caixa

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| PDV-12 | Importar documentos auxiliares (orçamento, pedido, OS, comandas) para a NFC-e/PDV (F5) | D | alta | Fecha o ciclo orçamento/pedido → caixa. | M (1–3 semanas) | VEN-01, VEN-02, carts.ts. | — (PDV retoma apenas as próprias pré-vendas) |
| PDV-06 | Código de barras com informação (balança etiquetadora: EAN iniciado em 2 com peso ou valor, produto de 4/5/6 dígitos) | D | média | Indispensável para açougue, padaria, hortifrúti com balança etiquetadora. | P (≤ 1 semana) | product-search.tsx, /api/pdv/products, settings (formato 4/5/6 dígitos, peso/valor), CAD-16. | — (busca do PDV por código/GTIN exato) |
| PDV-05 | Balança de checkout (serial, conectada ao PDV) | D | baixa | Mercados/hortifrutis sem etiquetadora. | M (1–3 semanas) | Conector local (novo endpoint /scale), carts.ts (quantidade em milésimos já suportada). | — (contrato do conector não prevê balança) |

### Financeiro

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| FIN-05 | Boletos registrados: emissão (A4/carnê/e-mail/PDF), remessa, configuração na conta bancária, APIs Banco Inter e Sicoob | B | alta | Cobrança bancária do crediário/B2B sem sistema externo. | G (> 3 semanas) | API de cobrança bancária (Inter, Sicoob, Itaú, ou agregador); Central de integrações; geração de PDF/linha digitável. | Meio 'boleto' (exige cliente), nosso número cadastrado manualmente na parcela, leitura de retorno CNAB (FIN-04); sem emissão/registro (auditoria item 264) |
| FIN-02 | Recebimento de vários títulos de uma vez (valor integral, forma de recebimento, lançar em banco/caixa) | B | média | Agilidade no recebimento de carnês/crediário. | P (≤ 1 semana) | finance.settleInstallment; VEN-10 (mesma lógica no PDV). | Baixa por parcela (finance.settleInstallment; diálogo 'Receber' em /financeiro/receber/[id]); baixa a partir do extrato/retorno na conciliação |
| FIN-06 | Impressos de cobrança: duplicata, carnê, recibo; detalhamento do carnê | B | média | Carnê é o instrumento de cobrança do crediário próprio. | P (≤ 1 semana) | titles/installments; página ?print=1. | Recibo de recebimento (/financeiro/receber/[id]/recibo); comprovante de pagamento (/financeiro/pagar/[id]/recibo) |
| FIN-19 | Plano de contas (6 níveis, sintéticas/analíticas) e centros de custo (3 níveis) — Gpro e Gweb | B | média | Base para DRE e integração contábil (escritório). | P (≤ 1 semana) | fin_categories, cost_centers; FIN-22, CTB-02. | /financeiro/cadastros?tab=categorias (fin_categories com parentId e dreGroup) e ?tab=centros (cost_centers planos) |
| FIN-22 | Relatórios financeiros (Assistente) e DRE simplificado (ZWeb) | B | média | Gestão financeira e conversa com o contador. | M (1–3 semanas) | cashflow.ts (competência), fin_categories.dreGroup, PLA-09. | Botão 'Relatório' (window.print) nas listas; exportações CSV; fin_categories.dreGroup cadastrado e não consumido (lacuna 17) |
| FIN-24 | Controle de taxas e recebimentos no cartão: operadoras, taxas por bandeira/operação/parcelas, antecipação, movimentações, importação do arquivo da operadora (Gpro; comparativo) | B | média | Conferência do que a maquininha realmente pagou. | M (1–3 semanas) | payment_methods, sale_payments (cardBrand, installments já gravados), bank imports (novo leitor CSV/EDI da adquirente). | /financeiro/cartoes (recebíveis por previsão, liquidação em lote 'Liquidar previstos até…'); payment_methods.feeBps/settlementDays; src/domain/finance.ts cardFeeByInstallment |
| FIN-21 | Livro caixa — fechamento do dia (bloqueio de lançamentos em período fechado) | D | média | Protege períodos já conferidos/enviados ao contador. | M (1–3 semanas) | settings (data de fechamento por empresa), finance.ts (validação central em postEntry), permissions. | — (fechamento existe só para sessões de caixa do PDV) |
| FIN-23 | Cheques pré-datados (cadastro gera contas a receber; compensação) | D | baixa | Lojas com clientela que ainda usa cheque. | P (≤ 1 semana) | payment_methods, titles. | — (meio 'other' com referência) |

### Fiscal

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| FIS-12 | Regras de tributação (ICMS/ST/MVA/FCP/diferimento/fórmulas por UF; IPI; PIS/COFINS) com prioridade operação → produto → NCM → origem → revenda/consumo → CEST → geral; localizar por NCM/CEST; assistente (Gpro Tributos; Gweb Impostos) | B | alta | Tributação correta para Regime Normal e ST; menos rejeições. | G (> 3 semanas) | tax_groups, fiscal/service.ts, products (ncm/cest), contabilidade. | tax_groups (cfopInternal/Interstate/Return, cstCsosn, icmsRateBps, redução de base, FCP, PIS/COFINS/IPI, vigência) vinculado ao produto ou padrão da configuração; taxFor em src/domain/fiscal/service.ts |
| FIS-19 | Reforma Tributária (CBS/IBS/IS): adesão, alíquotas, classificação por produto, campos nos documentos (Gpro; Gweb) | D | alta | Conformidade obrigatória no calendário da reforma (risco de rejeição). | G (> 3 semanas) | Notas técnicas vigentes, Focus NFe (suporte aos grupos), tax_groups/products, contabilidade. | — (grep 'IBS\|CBS\|reforma' sem implementação) |
| FIS-05 | Importações para a NF-e: integração de cupons/NFC-e (CFOP 5.929), comandas, pedido de venda, orçamento, OS | B | média | Faturamento B2B a partir de pedido e NF-e para cliente que comprou no PDV. | P (≤ 1 semana) | VEN-01/02; nfe.ts loadOrigin. | Origens da NF-e: sale, transfer, return, purchase_order, manual (src/domain/fiscal/nfe.ts NfeOriginType) |
| FIS-07 | NF-e de remessa e de devolução para Simples Nacional (CSOSN 900), venda no site/retirada | B | média | Remessas comuns sem depender do suporte. | P (≤ 1 semana) | FIS-11 (naturezas de operação). | Assistente avulso com natureza livre, finalidade e CFOP por item; grupos tributários (tax_groups) com CST/CSOSN |
| FIS-11 | Naturezas de operação / Operações (pré-cadastradas: venda, devolução, compra, transferência, remessas; 'para consumo') | B | média | Flexibilidade fiscal sem alterar código. | M (1–3 semanas) | tax_groups, fiscal/service.ts (taxFor/defaultCfop). | OperationKind fixo (sale, sale_return, supplier_return, transfer, purchase) + defaultCfop (src/domain/fiscal/service.ts:227) + campo 'natureza' texto no documento |
| FIS-26 | Validações prévias de cadastro e tributação (catálogo de rejeições: destinatário/IE, emitente/credenciamento/certificado, CST×CFOP×UF, natureza×finalidade, NCM/GTIN/unidade/medicamentos; Gweb rejeições de NF-e) | B | média | Menos rejeições e chamados de suporte. | M (1–3 semanas) | service.ts validateDocument, help-content.ts (artigos por código de rejeição). | validateDocument (src/domain/fiscal/service.ts:425), currentIssues (nfe.ts:482), situação fiscal do produto; documento fica 'pending' com notificação; provedor de simulação valida NCM/CFOP |
| FIS-13 | Alíquotas do SIMPLES (aproveitamento de crédito de ICMS — pCredSN/vCredICMSSN) | D | média | NF-e de Simples para lojistas contribuintes (B2B). | P (≤ 1 semana) | fiscal_configs ou settings (alíquota mensal), service.ts. | tax_groups (CSOSN) — sem percentual de crédito do Simples |
| FIS-16 | DIFAL — diferencial de alíquota (venda interestadual a consumidor final não contribuinte) | D | média | Vendas interestaduais a consumidor (e-commerce, telefone). | M (1–3 semanas) | FIS-12 (alíquotas por UF), service.ts. | — (grep 'difal' sem resultado) |
| FIS-22 | Gerador de arquivos fiscais: SPED Fiscal (EFD ICMS/IPI) e EFD Contribuições (Gfiscal; Gweb SPED; evolução; comparativo SPED/Sintegra) | D | média | Clientes do Regime Normal e escritórios que querem o arquivo pronto. | G (> 3 semanas) | FIS-24, EST-05, FIS-12, dados do contador (PLA-01). | Obrigações acessórias apenas acompanhadas (/fiscal/relatorios?tab=obrigacoes; fiscal_obligations) — sem geração (lacuna 8) |
| FIS-24 † | Escrituração fiscal de entradas (tributos por item da nota de compra, livro de entradas, crédito de ICMS) — base comum de nota de compra, CT-e de entrada e arquivos fiscais | D | média | Contador recebe entradas e créditos; pré-requisito de SPED/Sintegra. | G (> 3 semanas) | receipts.ts, nfe-xml.ts (tributos do XML), fiscal/export.ts. | Recebimento grava CFOP e plano de contas, mas 'não escritura o livro de entradas' (auditoria item 214, lacuna 7) |
| FIS-10 | NF-e de importação (Declaração de Importação/adições) e de exportação; nota fiscal de importação de entrada | D | baixa | Importadores/exportadores (minoria do varejo PME). | G (> 3 semanas) | fiscal/service.ts (grupos DI/exportação no payload). | — |
| FIS-14 | Produtor rural: contra-nota (NF-e de entrada) e alíquotas do FUNRURAL | D | baixa | Mercados/hortifrútis que compram de produtor rural. | M (1–3 semanas) | receipts, fiscal/nfe.ts (operationType entrada), finance (retenção). | — |
| FIS-20 | ECONF — Evento de Conciliação Financeira (NF-e/NFC-e) | D | baixa | Conformidade futura. | P (≤ 1 semana) | Focus NFe (suporte ao evento). | — (pagamentos gravados em fiscal_documents.payments e sale_payments) |
| FIS-23 | Sintegra (Convênio 57/95, registros 10/11/50/51/53/54/61/70/74/75) — Gfiscal e Gweb | D | baixa | UFs que ainda exigem Sintegra. | M (1–3 semanas) | FIS-24, EST-05. | — |
| FIS-25 | Arquivos estaduais específicos: eDoc/SEF 2012 (PE) e Nota Fiscal Gaúcha (RS) | D | baixa | Clientes de PE/RS. | M (1–3 semanas) | FIS-22. | — |

### Transporte

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| TRA-02 | MDF-e (emissão, lista por situação, encerramento, contingência, configurações; comparativo) | D | baixa | Distribuidoras/atacarejos com frota. | G (> 3 semanas) | CAD-04, Focus NFe (MDF-e). | — |

### Serviços (OS)

| ID | Recurso (GDoor) | Classe | Prioridade | Valor de negócio | Esforço | Dependências / reuso | Situação hoje no Intercert |
|---|---|---|---|---|---|---|---|
| SRV-01 | Gservice — ordem de serviço (lançamento, pagamento/parcelamento, listagem e status, técnicos/objetos/contratos/atividades, agenda por técnico, configurações de serviços; página; comparativo) | D | baixa | Segmentos de serviço do varejo (informática, eletrônica). | G (> 3 semanas) | VEN-01/02, FIS-18. | — (NFS-e avulsa existe; não há OS) |

† linha de apoio: não é recurso GDoor isolado, mas pré-requisito comum (escrituração de entradas) de COM-03, COM-10, FIS-22 e FIS-23.

## D de prioridade baixa — implementar só sob demanda

Já listados acima; resumo do motivo de ficarem para depois:

- **PLA-03** Autenticação com verificação de IP (Gweb) — Segurança para empresas com acesso remoto; reduz uso indevido de credenciais. Esforço M.
- **PLA-12** Modo escuro — Conforto visual. Esforço M.
- **PLA-13** Informativo de novidades e selo 'New' — Adoção de funcionalidades novas. Esforço P.
- **PLA-22** Campos personalizados (6 por módulo: estoque, cliente, fornecedor) — Flexibilidade de cadastro sem customização. Esforço M.
- **PLA-28** Envio de SMS (SMSDev — Ajatus) — Lembretes de cobrança. Esforço M.
- **CAD-04** Veículos (placa, RNTRC, UF) — Pré-requisito de MDF-e. Esforço P.
- **CAD-19** Replicar código interno no código de barras — Etiquetas internas leem no PDV. Esforço P.
- **COM-10** Lançar CT-e de entrada (frete) para Sintegra/SPED — Crédito de ICMS sobre frete e SPED completo (Regime Normal). Esforço M.
- **VEN-13** Consulta de preços (terminal de consulta) — Exigência de alguns PROCONs/mercados. Esforço P.
- **VEN-15** Força de vendas Gped (app de pedidos externos, versão antiga GLink, habilitação no Gweb, landing 'vendas externas', comparativo) — Distribuidoras e representantes. Esforço G.
- **PDV-05** Balança de checkout (serial, conectada ao PDV) — Mercados/hortifrutis sem etiquetadora. Esforço M.
- **FIN-23** Cheques pré-datados (cadastro gera contas a receber; compensação) — Lojas com clientela que ainda usa cheque. Esforço P.
- **FIS-10** NF-e de importação (Declaração de Importação/adições) e de exportação; nota fiscal de importação de entrada — Importadores/exportadores (minoria do varejo PME). Esforço G.
- **FIS-14** Produtor rural: contra-nota (NF-e de entrada) e alíquotas do FUNRURAL — Mercados/hortifrútis que compram de produtor rural. Esforço M.
- **FIS-20** ECONF — Evento de Conciliação Financeira (NF-e/NFC-e) — Conformidade futura. Esforço P.
- **FIS-23** Sintegra (Convênio 57/95, registros 10/11/50/51/53/54/61/70/74/75) — Gfiscal e Gweb — UFs que ainda exigem Sintegra. Esforço M.
- **FIS-25** Arquivos estaduais específicos: eDoc/SEF 2012 (PE) e Nota Fiscal Gaúcha (RS) — Clientes de PE/RS. Esforço M.
- **TRA-02** MDF-e (emissão, lista por situação, encerramento, contingência, configurações; comparativo) — Distribuidoras/atacarejos com frota. Esforço G.
- **SRV-01** Gservice — ordem de serviço (lançamento, pagamento/parcelamento, listagem e status, técnicos/objetos/contratos/atividades, agenda por técnico, configurações de serviços; página; comparativo) — Segmentos de serviço do varejo (informática, eletrônica). Esforço G.

## Integrações (F) que destravam ausentes

| ID | Integração | Prioridade | Destrava | Esforço |
|---|---|---|---|---|
| COM-08 | Manifestação do destinatário (MD-e) e download de XML de compra (Gpro; Gweb; comparativo) | alta | Nenhuma nota de compra fica sem lançamento; base para escrituração e para o escritório contábil. — depende de: Focus NFe (manifestação/DF-e) ou provedor equivalente; fiscal_events; /compras/recebimentos/novo. | M |
| FIS-01 | NF-e modelo 55 — lançamento/formulário, pré-requisitos, configurações da NF-e (certificado, ambiente, série, DANFE, contingência), comparativo NF-e e evolução por notas técnicas | alta | Emissão fiscal válida — bloqueio nº 1 para uso real. — depende de: Credencial Focus NFe, certificado A1 no provedor, homologação por UF. | M |
| FIS-03 | Funções fiscais da NF-e: testar servidor, validar/assinar, transmitir, consultar, cancelar, inutilizar, homologação | alta | Ciclo de vida fiscal real. — depende de: Focus NFe. | P |
| FIS-18 | NFS-e — emissão, lista, formulário, configurações (prefeitura, ambiente nacional), evolução (prefeituras, padrão nacional, Focus); comparativo | alta | Escritório contábil (honorários) e varejo com serviços. — depende de: Focus NFe (NFS-e nacional/municipal). | P |
| PDV-08 | Configurações da NFC-e (operação padrão, ambiente, Token/CSC, autorizados a baixar XML) e emissão de NFC-e via PDV_Server | alta | NFC-e real é obrigatória para varejo. — depende de: Focus NFe (credencial, homologação SEFAZ). | P |
| PDV-10 | Pix integrado no PDV e conta digital (Gdoor Pay Pix, conta Gdoor Pay, Conexão Itaú Pix; comparativo 'Recebimentos PIX') | alta | Pix é o meio de pagamento mais usado no varejo. — depende de: Credencial Mercado Pago (ou PSP equivalente); webhook (lacuna 22) opcional. | P |
| PLA-26 | E-mail / servidor SMTP para envio de XML, DANFE e documentos | alta | Destrava recuperação de senha, convites, envio de XML/DANFE, cobrança e pacote contábil. — depende de: Credencial RESEND_API_KEY ou Appwrite Messaging; domínio remetente verificado. | P |
| CAD-22 | Integrador iMendes (auditoria e correção tributária de produtos) | média | Reduz erro de NCM/CST/CEST e rejeições. — depende de: Contrato com provedor de base tributária (iMendes ou similar). | M |
| CTB-02 | Gcontábil — integração com Domínio (API Onvio) | média | Escritórios que usam Domínio importam sem retrabalho. — depende de: API Onvio/Domínio; fiscal/export.ts; Central de integrações. | M |
| FIS-04 | Carta de Correção Eletrônica (CC-e) | média | Correções sem cancelar a nota. — depende de: Focus NFe. | P |
| PDV-04 | Gaveta de dinheiro | média | Operação de caixa sem tecla manual. — depende de: Conector local de periféricos. | P |
| PDV-09 | Pagamentos com cartão integrados: TEF (Gdoor Payments/SiTef/Cappta), ZPOS/smart POS (Clover, Ingenico, Vero, Stone, PagSeguro, Sicredi, Caixa, BIN, Banricompras) e dispositivos de pagamento | média | Menos erro de digitação de NSU e conciliação de cartões automática. — depende de: Conector local + adquirente/subadquirente; FIN-CAR (conciliação). | G |
| PLA-24 | Impressoras e opções de impressão (impressora por documento, vias, impressão direta) | média | Agilidade no caixa (cupom sem diálogo). — depende de: Conector local de periféricos (componente externo), terminals.connectorUrl. | G |
| VEN-09 | Devolução de NF-e de venda (conversão saída→entrada, devolução financeiro) e nota de devolução do cliente para o emissor | média | Devoluções com documento fiscal válido. — depende de: Focus NFe (homologação). | P |
| FIS-08 | Nota de devolução manual (valores digitados ou dados cadastrados) | baixa | Devoluções atípicas. — depende de: Focus NFe. | P |
| VEN-16 | E-commerce e integrações com marketplaces (ZWeb) | baixa | Canal adicional de vendas. — depende de: API pública/webhooks (inexistentes — lacuna 22). | G |

## Dependências entre os ausentes (ordem lógica)

```
Canal de e-mail (PLA-26) ──► envio de orçamento/pedido, boletos, RFQ, pacote contábil
Focus NFe homologado (FIS-01/03, PDV-08, FIS-18) ──► MD-e (COM-08) ──► escrituração de entradas (FIS-24) ──► SPED/Sintegra (FIS-22/23)
                                                   └► Reforma tributária (FIS-19) ──► (exige FIS-12 ampliado)
Regras de tributação (FIS-12) ──► DIFAL (FIS-16), crédito Simples (FIS-13), naturezas de operação (FIS-11/FIS-07)
Documento comercial (VEN-01/02) ──► importar no PDV (PDV-12), NF-e por pedido (FIS-05), OS (SRV-01), Gped (VEN-15)
Vendedor sem login (CAD-05) ──► comissões (VEN-05), metas por vendedor (VEN-06)
Componentes (CAD-12 kits) ──► composição/montagem (CAD-13)
Campos de balança (CAD-16) ──► código de barras com peso/valor (PDV-06), balança checkout (PDV-05)
Recebimento no PDV (VEN-10) ──► requer correção da lacuna 4 (operador × sessão de caixa)
Inventário em data-base (EST-05) ──► bloco H / registro 74
```
