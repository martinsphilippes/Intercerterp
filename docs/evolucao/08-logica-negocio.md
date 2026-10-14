# Relatório 8 — Lógica operacional comparada (GDoor × Intercert)

Somente fluxos **documentados** no inventário do GDoor (artigos bdc.gdoor.com.br e help.gdoorweb.com.br citados). Para o Intercert, arquivos conferidos no repositório em 13/10/2026. IDs entre colchetes remetem à `matriz.json`. Regras citadas como "§n" estão em `docs/regras-assumidas.md`.

Convenção: **[não alterar]** = regra de cálculo/estado que não pode mudar silenciosamente; qualquer ajuste exige decisão registrada em `docs/regras-assumidas.md`, teste de caracterização antes/depois e, no caso fiscal, validação da contabilidade.

---

## 1. Compras — pedido → nota de compra/XML → vínculo e fator → precificação → estoque → financeiro

### 1.1 Como funciona no GDoor
1. **Pedido de compra** (Gpro): fornecedor, datas, local de entrega; geração automática de itens por fornecedor/abaixo do ideal; não movimenta estoque nem financeiro; controla saldo a receber (Q.Sal). Fonte: https://bdc.gdoor.com.br/artigos/pedido-de-compra/ [COM-01]
2. **Cotação** opcional com ranking por total, impressa/enviada sem valores ao fornecedor (não gera pedido). Fonte: https://bdc.gdoor.com.br/artigos/cotacao-de-compra/ [COM-02]
3. **Manifestação do destinatário**: consulta NF-e emitidas contra o CNPJ, ciência/confirmação, download do XML e importação no Compras. Fontes: https://bdc.gdoor.com.br/artigos/manifestacao-do-destinatario-md-e/ ; https://help.gdoorweb.com.br/movimentos/compras [COM-08]
4. **Nota de compra**: manual (CFOP de entrada 1/2, bases de ICMS/ST/IPI escolhidas pelo usuário, frete do destinatário soma ao total) ou por **XML**; estados *Em processamento → Pendente → Concluído*; só *Concluído* gera estoque e financeiro. Fonte: https://bdc.gdoor.com.br/artigos/compras/ [COM-03]
5. **Vínculo de itens** (Relação Estoque × Fornecedor) por código/barras/descrição com cores; **fator de conversão** = qtd total em estoque ÷ qtd do XML, memorizado por fornecedor; CFOP vinculado memorizado; fornecedor e produtos sem vínculo cadastrados automaticamente. Fontes: https://bdc.gdoor.com.br/artigos/compras/ ; https://bdc.gdoor.com.br/artigos/fatores-de-conversao/ [COM-04, CAD-11]
6. **Comparação nota × pedido** (não localizado, divergência de valor) e baixa do saldo do pedido. [COM-05]
7. **Pagamento/prazo**: parcelas no Pagar com plano de contas e centro de custo; diferença de centavos na 1ª parcela. [COM-06]
8. **Precificação** (opcional/automática ao concluir): custo = compra ± componentes selecionados (ST, IPI, frete, crédito de ICMS) + adicionais rateados; novo preço = custo × (1 + margem) ou fixo; variação de custo em cores; aplicar só nos itens marcados. Gweb: se custo sobe e preço não é informado, recalcula pela margem do cadastro. Fontes: https://bdc.gdoor.com.br/artigos/compras/ ; https://help.gdoorweb.com.br/movimentos/compras [COM-07]
9. **Pós-entrada**: alteração em massa e etiquetas a partir da nota. [CAD-18, CAD-17]

### 1.2 Como funciona no Intercert
1. Reposição sugere compra (`src/domain/replenishment.ts`, `/compras/reposicao`) → cotação opcional (`src/domain/quotations.ts`) → **pedido** com máquina de estados e **aprovação por alçada** (`src/domain/purchases.ts`, `src/domain/approvals.ts`, `/compras/pedidos`, `/compras/aprovacoes`).
2. **Recebimento** (`src/domain/receipts.ts`, `/compras/recebimentos/novo`): *Importar XML* (`importNfeXml`, parse 4.00 em `src/domain/nfe-xml.ts`, chave com DV, destinatário conferido, fornecedor criado automaticamente), *Ler chave* (busca XML na Focus — `fetchXmlByKey`, dependente) ou *Sem XML pelo pedido* (`createManualReceipt` — exige pedido).
3. **Conferência** (`/compras/recebimentos/[id]`, `conference.tsx`): associação por código do fornecedor/GTIN/pedido (`supplier_products`), fator editável, quantidade recebida, custo, lote/validade, divergências tipificadas, alocação por pedido.
4. **Conclusão** (`confirmReceipt`, idempotente com estado *confirmando*): movimentos de entrada (`postMovements`, custo médio §6), atualização de `skus.costAcquisition/costTotal` + `price_history`, vínculo/fator gravado em `supplier_products`, título a pagar (`finance.createTitle`) pelas duplicatas do XML ou condição, baixa do saldo do pedido.
5. Devolução ao fornecedor: NF-e com origem `purchase_order` (`src/domain/fiscal/nfe.ts` `loadOrigin`), sem abatimento automático no pagar.

### 1.3 Diferenças
| Ponto | GDoor | Intercert |
|---|---|---|
| Nota sem pedido | Sim (manual completa) | Só por XML; sem XML exige pedido |
| Produto novo a partir do XML | Cadastra automaticamente | Só associa a produto existente |
| Tributos de escrituração por item | Sim (bases, ST, C197) | Não (lacuna 7) |
| Precificação na entrada | Sim (margem, composição do custo) | Só atualiza custo |
| MD-e | Sim | Não (só busca por chave, dependente) |
| Aprovação/alçada do pedido | Não | Sim (superior) |
| Divergências e tolerância | Cores/legenda | Tipificadas, com justificativa (superior) |

### 1.4 Abordagem recomendada
Ampliar o **recebimento** (não criar "nota de compra" separada): (a) `createManualReceipt` sem pedido; (b) ação "cadastrar produto" na conferência buscando antes por GTIN/código do fornecedor; (c) passo opcional **Precificação** após `confirmReceipt` usando `pricing.savePrice` com prévia e motivo; (d) MD-e como novo modo de entrada pela Central de integrações; (e) conversor de CFOP em `settings`; (f) escrituração de entradas como `fiscal_documents` de terceiros (fase posterior).

**O que ampliar:** `src/domain/receipts.ts`, `src/app/(app)/compras/recebimentos/novo/new-receipt.tsx`, `src/app/(app)/compras/recebimentos/[id]/conference.tsx`, `src/domain/pricing.ts`, `src/domain/products.ts`, `src/app/(app)/administracao/parametros/catalog.ts`.
**Módulos afetados:** Compras, Produtos/Preços, Estoque, Financeiro (pagar), Fiscal (entradas).

### 1.5 Regras que não podem ser alteradas silenciosamente
- **[não alterar]** Devido = Σ(recebido × custo) − desconto + frete + outras despesas (inclui IPI/ST/seguro do XML); rateio por valor; custo de entrada = (linha + rateios)/qtd (§14 Recebimento).
- **[não alterar]** Custo médio ponderado e "saldo só muda por movimento" (§6).
- **[não alterar]** Frete/seguro/outras despesas uma única vez por pedido; tolerância de valor com justificativa (§18 Compras).
- **[não alterar]** Chave única por empresa; destinatário diferente bloqueia; denegada recusada (§18).
- Composição do custo (incluir/excluir ST, IPI, crédito de ICMS) muda custo médio e CMV — só como opção explícita, com padrão = comportamento atual.
- Preço de venda só muda com prévia, motivo e `price_history` (§12).

---

## 2. Vendas — orçamento → pedido → faturamento/DAV/pré-venda → recebimento

### 2.1 Como funciona no GDoor
1. **Orçamento**: cliente, vendedor, validade, situação; não movimenta estoque/financeiro; faturado no módulo Faturamento ou importado no PDV/DAV/pré-venda; Gweb converte em pedido, pré-venda, NFC-e ou NF-e e trava a edição após a conversão. Fontes: https://bdc.gdoor.com.br/artigos/orcamento/ ; https://help.gdoorweb.com.br/movimentos/orcamento [VEN-01]
2. **Pedido de venda**: atualiza "pendentes" na ficha; reserva opcional; Q.Sal (entrega parcial); conferência por código de barras; movimentar estoque e gerar financeiro opcionais (estornáveis); faturamento total/parcial; xPed/nItemPed no XML. Fontes: https://bdc.gdoor.com.br/artigos/pedido-de-venda/ ; https://help.gdoorweb.com.br/movimentos/pedidos [VEN-02]
3. **Pré-venda gerencial**: já movimenta estoque e financeiro; o PDV "Gera Venda" (F9). DAV e pré-venda PAF existem para ECF (fora de escopo). Fontes: https://bdc.gdoor.com.br/artigos/pre-venda-gerencial/ ; https://bdc.gdoor.com.br/artigos/dav/ [VEN-03, VEN-04]
4. **Faturamento**: NF-e importa pedido/orçamento/OS/cupons (cupom → CFOP 5929/6929 sem nova baixa); pedido com estoque/financeiro já movimentado não pode ser alterado na importação. Fonte: https://bdc.gdoor.com.br/artigos/nf-e/ [FIS-05]
5. **Recebimento**: parcelas pela configuração de parcelamento; recebimento no PDV (F6/F9), no Receber, por retorno bancário. [VEN-10, FIN-02, FIN-04]

### 2.2 Como funciona no Intercert
1. Não há orçamento nem pedido de venda (auditoria itens 156; grep confirma).
2. **Atendimento/pré-venda** (`src/domain/carts.ts`): carrinho por terminal, `parkCart`/`resumeCart` em qualquer terminal da filial, validade (`sales.presaleExpiryHours`), sem reserva de estoque (lacuna 14).
3. **Venda** (`src/domain/sales.ts`): `prepareSale` → `finalizeSale` (idempotente pela chave do atendimento) → `completeSalePostCommit` → `applySaleEffects` (estoque, caixa/conta, títulos, NFC-e opcional via job).
4. **Faturamento em NF-e** a partir da venda (`/fiscal/nfe/nova?origem=sale:<id>`, efeitos travados na origem).
5. **Recebimento** de parcelas somente no Financeiro (`finance.settleInstallment`) ou por conciliação/retorno CNAB.

### 2.3 Diferenças
O GDoor tem o ciclo comercial completo antes do caixa; o Intercert começa no atendimento do PDV. Intercert é mais seguro nos efeitos (uma única aplicação, idempotente), mas não suporta venda B2B com entrega futura/parcial nem proposta com validade.

### 2.4 Abordagem recomendada
Criar **um** documento comercial (`sales_documents`, estágio orçamento|pedido) que **reutiliza**: `resolvePrices`/`calcSale` (preço e totais), `stock.reserve/releaseReservations` (reserva do pedido), `createCart` (importar no PDV), `finalizeSale` (efeitos na conversão), `loadOrigin` com nova origem `sales_document` (NF-e), `finance.createTitle` (parcelas). Conversão gera venda/NF-e e grava vínculo; efeitos ocorrem **só no faturamento** (não oferecer "movimentar estoque/gerar financeiro no pedido" do GDoor — evita efeito duplo). Pré-venda do PDV ganha **reserva** opcional em vez de movimentar estoque.
Recebimento no PDV: nova ação em `/pdv` que chama `settleInstallment` e registra `cash_movements` (tipo novo) — depois de corrigir a lacuna 4 (venda × operador da sessão).

**O que ampliar:** `src/lib/db/schema.ts` (coleções novas aditivas), `src/domain/carts.ts`, `src/domain/sales.ts`, `src/domain/fiscal/nfe.ts`, `src/domain/cash.ts`, `src/app/(app)/pdv/*`, `src/lib/permissions.ts`, `src/components/shell/nav.ts`.
**Módulos afetados:** Vendas, PDV, Caixa, Estoque (reservas), Financeiro, Fiscal.

### 2.5 Regras que não podem ser alteradas silenciosamente
- **[não alterar]** Resolução de preço: tabela informada → padrão da filial → padrão da empresa; atacado por quantidade mínima; vigência (§3, §12).
- **[não alterar]** Valor da linha = round(preço × qtd); rateio de desconto global pelo maior resto; diferença de centavos na 1ª parcela (§1, §3).
- **[não alterar]** Limite de desconto (tabela e perfil) e aprovação acima do limite (§3, §17).
- **[não alterar]** Crediário só com limite concedido; em aberto + nova compra ≤ limite (§3).
- **[não alterar]** Idempotência da venda pela chave do atendimento; efeitos aplicados uma única vez; cancelamento com efeitos inversos (§3, §4).
- **[não alterar]** "Dinheiro esperado" do caixa (§5) — recebimento de parcela no PDV **muda a fórmula** (soma de recebimentos em espécie): decisão a registrar explicitamente.
- **[não alterar]** Disponível = físico − reservado (§6).

---

## 3. Estoque — entrada → movimentação → ajuste → inventário/balanço → relatórios

### 3.1 Como funciona no GDoor
1. **Entrada** pela conclusão da nota de compra (estoque × fator) [COM-03]; **saídas** por venda/faturamento; composição automática baixa o produto base quando o corte está zerado (https://bdc.gdoor.com.br/artigos/composicao-automatica/) [CAD-13]; lote baixado na venda com seleção (https://bdc.gdoor.com.br/artigos/controle-de-lotes-e-validades/) [EST-02].
2. Gweb: sem aviso, permite lançar e bloqueia na transmissão (https://help.gdoorweb.com.br/configuracoes/geral) [EST-01].
3. **Balanço**: lista temporária multi-terminal (soma leituras), *Aplicar* substitui o estoque pela quantidade nova e pode zerar não listados; integra Gcoletor (https://bdc.gdoor.com.br/artigos/balanco-de-estoque/) [EST-03, EST-04].
4. **Inventário** fiscal na data-base com/sem recálculo, valoração (médio/compra/venda/última compra) e conferência: inventário + compras + entradas − vendas − saídas = atual; também dentro de Sintegra/SPED bloco H (https://bdc.gdoor.com.br/artigos/inventario-de-estoque/) [EST-05].
5. Relatórios pelo Assistente (https://bdc.gdoor.com.br/artigos/relatorios/ — citado no inventário mov:19) [PLA-09].

### 3.2 Como funciona no Intercert
1. Todo saldo muda por **movimento** (`src/domain/stock.ts` `postMovements`, sequência única por saldo, `balanceBefore/After`, `avgCostAfter`); entradas por `confirmReceipt`, saídas por `applySaleEffects`, avulsos em `/estoque/movimentos` (`adjustStock`, motivo obrigatório), transferências (`src/domain/transfers.ts`) com trânsito e reserva.
2. **Reservas** (`stock_reservations`, `reserve/releaseReservations`) usadas por transferências.
3. **Inventário** (`src/domain/inventory.ts`, `/estoque/inventarios/[id]`): base temporal pela sequência, esperado = base + movimentos durante a contagem, recontagem, conclusão em duas fases com ajustes idempotentes, um inventário ativo por depósito.
4. Relatórios: `/estoque` (saldos, mínimo), `/relatorios/curva-abc`, `/compras/reposicao`, alertas de mínimo (rotina).

### 3.3 Diferenças
Intercert é mais rigoroso na consistência (concorrência, base temporal); falta **saldo por lote/validade**, **composição/kit**, **relatório de inventário fiscal em data-base** e **bipagem** na contagem. GDoor "zera não listados" no balanço — o Intercert conta apenas itens do escopo do inventário.

### 3.4 Abordagem recomendada
- Lote: propagar `lot/lotExpiry` de `confirmReceipt` para `stock_movements` e derivar saldo por lote dos próprios movimentos; seleção de lote na venda; alerta de vencimento em `src/domain/routines/stock.ts`.
- Kits/composição: `product_components` + baixa dos componentes por `postMovements` dentro do mesmo `applyOnce` da venda.
- Inventário fiscal: relatório em `src/domain/reports.ts` (ou `inventory.ts`) usando o último movimento ≤ data-base por saldo; incluir no pacote contábil (`src/domain/fiscal/export.ts`).
- Contagem: bipagem que soma 1 por leitura em `count-sheet.tsx`.

**Módulos afetados:** Estoque, Compras, Vendas/PDV, Fiscal (pacote/SPED), Relatórios.

### 3.5 Regras que não podem ser alteradas silenciosamente
- **[não alterar]** Saldo físico só muda por movimento; disponível = físico − reservado; trânsito não é disponível (§6).
- **[não alterar]** Custo médio ponderado `(saldo × médio + qtd × custo)/(saldo + qtd)`, saldo negativo tratado como zero; saídas pelo médio vigente (§6).
- **[não alterar]** Inventário: esperado = base + movimentos entre base e contagem; impacto = diferença × custo médio na conclusão; conclusão em duas fases (§12).
- Saída manual/perda não consome reservado (§18).
- Venda sem saldo bloqueada, salvo parâmetro/terminal (§3).

---

## 4. Financeiro — título → vencimento → cobrança → baixa → conciliação (e cartões)

### 4.1 Como funciona no GDoor
1. **Título**: gerado por vendas a prazo (faturamento, PDV, pedido) e compras a prazo, ou manual com *Replica*. Fontes: https://bdc.gdoor.com.br/artigos/modulo-receber/ ; https://bdc.gdoor.com.br/artigos/modulo-pagar/ [FIN-01, FIN-10, FIN-13]
2. **Vencimento/encargos**: juros simples/compostos, multa, carência, ajuste de vencimento em feriados, coeficientes. Fonte: https://bdc.gdoor.com.br/artigos/configuracoes-parcelamento/ ; Gweb juros automático desde 09/2024 (https://help.gdoorweb.com.br/financeiro/receitas) [FIN-26]
3. **Cobrança**: boleto registrado (A4/carnê/e-mail, remessa ou API Inter/Sicoob), carnê, duplicata, WhatsApp com modelos. Fontes: https://bdc.gdoor.com.br/artigos/configuracao-para-geracao-de-boletos/ ; https://bdc.gdoor.com.br/artigos/configuracoes-whatsapp/ (inventário cad:38) [FIN-05, FIN-06, PLA-27]
4. **Baixa**: vários títulos de uma vez; parcial gera nova parcela do restante; lançar no caixa/banco opcional; recebimento no PDV; renegociação cancela antigas e gera novas (REAF…). [FIN-02, FIN-03, FIN-07, VEN-10, FIN-11]
5. **Conciliação**: importação de extrato XLS/OFX/OFC **não baixa títulos** (só lança no banco ou compensa mesmo documento); retorno CNAB baixa boletos. Fonte: https://bdc.gdoor.com.br/artigos/modulo-bancos/ [FIN-16, FIN-04]
6. **Cartões**: operadora/bandeira/taxa por operação e parcelas, antecipação; venda gera receber contra a operadora; arquivo de retorno da operadora baixa os recebíveis e cria conta paga da taxa. Fonte: https://bdc.gdoor.com.br/artigos/controle-de-taxas-e-recebimentos-no-cartao/ [FIN-24]
7. **Livro caixa** com fechamento diário que bloqueia lançamentos. Fonte: https://bdc.gdoor.com.br/artigos/modulo-livro-caixa/ [FIN-18, FIN-21]

### 4.2 Como funciona no Intercert
1. **Título** (`titles` + `installments`) por `finance.createTitle`: origens venda a prazo, cartão (recebível contra a adquirente, `sale_card`), recebimento de compra, manual com condição (`payment_terms`).
2. **Encargos**: multa% e juros% a.m. pró-rata com tolerância (`lateChargeParams`, §13), sugeridos e editáveis.
3. **Cobrança**: aviso por e-mail por parcela (`sendCollectionNotice`, dependente do canal), nosso número digitado; sem emissão de boleto/carnê.
4. **Baixa** (`settleInstallment`): parcial mantém saldo na mesma parcela; sempre gera lançamento em conta (`postEntry`); estorno vinculado (`reverseSettlement`); renegociação com desfazer (`renegotiate`/`undoRenegotiation`); contas a pagar exigem autorização antes do pagamento.
5. **Conciliação** (`src/domain/reconciliation.ts`, `src/domain/bank/*`, `/financeiro/conciliacao`): OFX/CSV/CNAB, sugestão por pontuação (valor/data/documento), 1:1, 1:N, N:1, baixa de parcela a partir da linha ou do retorno.
6. **Cartões** (`/financeiro/cartoes`): recebíveis pela previsão, liquidação em lote com taxa como lançamento separado; taxa/prazo únicos por meio.
7. **Fluxo de caixa** realizado × previsto × competência (`src/domain/cashflow.ts`).

### 4.3 Diferenças
Intercert é superior em conciliação, autorização do pagar, estorno e rastreabilidade; inferior em **instrumentos de cobrança** (boleto, carnê, régua), **baixa em lote**, **taxas de cartão detalhadas/arquivo da adquirente**, **fechamento de período**, **DRE/aging**.

### 4.4 Abordagem recomendada
Boleto como **atributo da parcela** + registro pela API bancária (integração); carnê como página de impressão; baixa em lote como orquestração de `settleInstallment` (respeitando o limite de 100 operações por transação do Appwrite — processar por parcela, com relatório de falhas); taxas por bandeira/parcelas em `payment_methods` com *fallback*; leitor da adquirente em `src/domain/bank/`; fechamento de período validado no `postEntry`; DRE pela competência já existente.

**Módulos afetados:** Financeiro, PDV/Caixa (recebimento no balcão), Vendas (crediário), Integrações.

### 4.5 Regras que não podem ser alteradas silenciosamente
- **[não alterar]** Saldo da parcela = valor − principal baixado; valor movimentado = principal − desconto + juros + multa; tarifa é lançamento separado (§7, §13).
- **[não alterar]** Multa = principal × multa%; juros = principal × juros% a.m. × dias/30; tolerância (§13).
- **[não alterar]** Estorno = baixa inversa + lançamento inverso; baixa conciliada exige desconciliar (§7).
- **[não alterar]** Recebível de cartão liquidado só pela tela de Cartões, com taxa da adquirente (§18).
- **[não alterar]** Fluxo previsto: recebível de cartão pelo líquido; vencidos à parte (§13).
- **[não alterar]** Pontuação e cardinalidades da conciliação; identidade de arquivo SHA-256 + conta (§13).
- Renegociação ≤ 49 parcelas (limite de transação) (§18).

---

## 5. Fiscal — operação/regras de tributação → documento → autorização → registro → SPED/contador

### 5.1 Como funciona no GDoor
1. **Operação e regras**: naturezas de operação (CFOP, ST, alíquotas por UF, diferimento, fórmulas, FCP, IBS/CBS) — https://bdc.gdoor.com.br/artigos/configuracoes-tributos/ ; Gweb regras por operação/produto/NCM/CEST com **prioridade** (1 operação, 2 produto, 3 NCM, 4 importados, 5 revenda, 6 consumo, 7 CEST, 8 geral), cada imposto tirado da primeira regra que o configura — https://help.gdoorweb.com.br/configuracoes/impostos/regras-de-tributacao [FIS-11, FIS-12]
2. **Documento**: NF-e (gravar já baixa estoque/financeiro no Gpro), importações de pedido/orçamento/cupom; DIFAL; complementar/ajuste; devolução — https://bdc.gdoor.com.br/artigos/nf-e/ ; https://bdc.gdoor.com.br/artigos/difal-diferencial-de-aliquota/ [FIS-01, FIS-05, FIS-16, FIS-09]
3. **Autorização**: validar/assinar → transmitir → consultar; cancelar estorna operações; inutilização; contingência; CC-e — https://bdc.gdoor.com.br/artigos/nf-e/ [FIS-03, FIS-04, PDV-14]
4. **Registro**: XML do mês (manual ou agendado) com cancelamentos/CC-e/inutilizações — https://help.gdoorweb.com.br/movimentos/nf-e [FIS-21]
5. **SPED/contador**: Gfiscal gera Sintegra, SPED Fiscal (C170, C190, E110, H010, K200…), Contribuições; envio automático no dia configurado — https://bdc.gdoor.com.br/artigos/gfiscal-gerador-de-arquivos-fiscais/ ; https://bdc.gdoor.com.br/artigos/sped-fiscal/ ; https://bdc.gdoor.com.br/artigos/envio-automatico-dos-arquivos-fiscais-para-contabilidade/ [FIS-22, FIS-23]
6. **Reforma tributária**: adesão no emitente, alíquotas IBS/CBS, classificação no produto; cronograma citado: Regime Normal em produção 05/01/2026, Simples 04/01/2027 — https://bdc.gdoor.com.br/artigos/alteracoes-da-reforma-tributaria/ [FIS-19]

### 5.2 Como funciona no Intercert
1. **Tributação**: `tax_groups` por produto (ou padrão da configuração) com CFOP interno/interestadual/devolução, CST/CSOSN, ICMS, redução de base, FCP, PIS/COFINS, IPI, vigência; `taxFor` + `defaultCfop` por tipo de operação (`src/domain/fiscal/service.ts:227`) — "regra assumida, validar com a contabilidade".
2. **Documento**: assistente (`/fiscal/nfe/nova`, `src/domain/fiscal/nfe.ts`) com origens venda/transferência/devolução/pedido de compra/manual; totais e tributos **sempre recalculados no servidor** (`buildItems`, `computeTotals`); pendências de cadastro deixam o documento `pending` com notificação (`validateDocument`).
3. **Autorização**: tarefas duráveis `fiscal.transmit/query/cancel` (`transmitDocument`, `queryDocument`, `cancelDocument`), referência única (`ref`) — consulta antes de reenviar; provedor Focus ou **simulação rotulada** (`src/domain/fiscal/providers.ts`); CC-e, inutilização com detecção de lacunas; efeitos da operação avulsa aplicados **na autorização**.
4. **Registro**: `fiscal_documents` + `fiscal_events` + XML em `files`; relatórios fiscais e livro de saídas (CSV de apoio) em `/fiscal/relatorios`.
5. **Contador**: pacote contábil ZIP (XML + 7 CSV + manifesto SHA-256) manual ou agendado; entrega na caixa de entrada do escritório vinculado (`/contabil/entregas`); obrigações acessórias **acompanhadas** (calendário), não geradas.

### 5.3 Diferenças
Intercert tem arquitetura mais segura (idempotência, recálculo no servidor, simulação rotulada, entrega direta ao escritório), mas o **motor de tributação é mais simples** (sem ST/MVA, alíquota por UF, prioridade por NCM/operação, DIFAL, crédito Simples, IBS/CBS) e **não escritura entradas nem gera SPED/Sintegra**. A emissão real não foi homologada (lacuna 1).

### 5.4 Abordagem recomendada
1. Homologar Focus (NF-e, NFC-e, NFS-e, CC-e, cancelamento, inutilização) sem mudar código de domínio.
2. Ampliar `tax_groups`/`taxFor` de forma aditiva, com **teste de igualdade**: para todos os produtos já configurados, o resultado (CFOP, CST, bases, valores) antes e depois deve ser idêntico; resolução por NCM/operação só quando não houver grupo no produto ou quando a operação tiver regra explícita.
3. IBS/CBS como campos e grupos novos no payload, controlados por parâmetro/data de vigência.
4. Escrituração de entradas como `fiscal_documents` de terceiros; SPED/Sintegra só depois de entradas + inventário.

**Módulos afetados:** Fiscal, Produtos (classificação), Compras (entradas), Vendas/PDV (NFC-e), Estoque (inventário), Contábil (pacote).

### 5.5 Regras que não podem ser alteradas silenciosamente
- **[não alterar]** CFOP padrão por operação (venda 5102/6102; devolução de venda 1202/2202; devolução a fornecedor 5202/6202 ou 5411; transferência 5152/6152 ou 5409; compra 1102/2102) (§15).
- **[não alterar]** CST 20: base = valor × (1 − redução); PIS/COFINS CST 01/02 sem alíquota → pendência (§18 Fiscal).
- **[não alterar]** Tributos aproximados = total × % do grupo (não IBPT) (§15).
- **[não alterar]** Faturamento fiscal = Σ autorizadas de saída, exclusões de CFOP não-receita (§15, §18).
- **[não alterar]** Uma operação → um documento ativo; `ref` única; consulta antes de reenviar; numeração na 1ª transmissão por filial/modelo/série (§8, §15, §18).
- **[não alterar]** Prazos de cancelamento (NF-e 24 h, NFC-e 30 min — parâmetros) e contingência que retém a fila (§15).
- **[não alterar]** NFS-e: base, ISS, retenções e líquido (§8).
- **[não alterar]** Simulação nunca apresentada como emissão válida (§8).

---

## 6. PDV — abertura → venda → ação ao salvar → fechamento

### 6.1 Como funciona no GDoor
1. **Abertura**: com "Trabalhar com controle de caixa", Ctrl+A abre com suprimento; Gweb exige caixa aberto para gerar documentos fiscais e permite "utilizar caixa já aberto" em vários computadores. Fontes: https://bdc.gdoor.com.br/artigos/controle-de-caixa/ ; https://help.gdoorweb.com.br/tutoriais/controle-de-caixa [PDV-03]
2. **Venda**: F2/digitar produto; cliente F7, vendedor (por item no Gweb), intermediador; balança e código de barras com peso/valor; importação de orçamento/pedido/OS (F4/F5). Fontes: https://bdc.gdoor.com.br/artigos/gpdv-nfc-e/ ; https://help.gdoorweb.com.br/movimentos/pdv [PDV-01, PDV-06, PDV-12]
3. **Pagamento**: multiespécie, prazo (gera receber), TEF/POS/ZPOS/Pix integrados; "Falta" = total − pagamentos. [PDV-02, PDV-09, PDV-10]
4. **Ação ao salvar** (Gweb, configurável): apenas salvar (pré-venda editável), concluir pré-venda, gerar NFC-e (transmite e movimenta), gerar CF-e, perguntar sempre. [PDV-01]
5. **Durante o turno**: sangria/suprimento; recebimento de parcelas (F6/F9) que entra no fechamento; troca (Ctrl+T) gera crédito. [VEN-10, VEN-08]
6. **Fechamento**: Ctrl+F, sangria de fechamento sugerida (soma em espécie), conferência por espécie, fechamento cego, relatório reimprimível; contingência offline da NFC-e e PDV híbrido offline. [PDV-03, PDV-13]

### 6.2 Como funciona no Intercert
1. **Abertura** (`src/domain/cash.ts` `openSession`, `/caixa/abertura`): fundo de troco, conferência de periféricos; uma sessão por terminal (trava `lockKey`).
2. **Venda** (`/pdv`, `pdv-app.tsx` com F2/F4/F6/F8/F10; `carts.ts`): busca por descrição/SKU/GTIN, cliente, tabela de preço, vendedor (por venda), descontos com limite e supervisor, pré-venda em espera.
3. **Pagamento** (`/pdv/pagamento`, `payment-app.tsx`): dinheiro/Pix/cartão manual/crediário/boleto/vale/outros; Pix dinâmico (Mercado Pago, dependente); cartão vira recebível.
4. **Ação ao concluir**: `finalizeSale` aplica efeitos; NFC-e conforme checkbox "Emitir NFC-e" do atendimento (job `sale.effects` → `createNfceForSale`); comprovante não fiscal 80 mm, e-mail/WhatsApp.
5. **Durante o turno**: sangria/suprimento (`addCashMovement`, aprovação acima de `cash.withdrawalApprovalAbove`, transferência para conta), devolução/troca com vale.
6. **Fechamento** (`closeSession`, `/caixa/fechamento`): previsto × informado por meio, justificativa de divergência, conferência cega (`blindCount`), reabertura com versões, relatório A4.

### 6.3 Diferenças
- Intercert não recebe parcelas no caixa; não tem "ação ao salvar" por empresa (decide por atendimento); não tem TEF/gaveta/impressão direta (conector não entregue); não opera offline.
- Lacuna 4: a venda entra na sessão aberta do terminal sem conferir o operador.
- Intercert é superior no fechamento (versões, cega no servidor, justificativa obrigatória) e na idempotência.

### 6.4 Abordagem recomendada
1. Corrigir a lacuna 4 (venda × operador da sessão) **antes** de qualquer ampliação do caixa.
2. Recebimento de parcelas no PDV via `settleInstallment` + `cash_movements` novo tipo; somar em `sessionSummary`/`expectedOf` com teste de fechamento.
3. Parâmetro de empresa/filial "padrão de emissão" (NFC-e marcado/desmarcado por padrão) reaproveitando o checkbox existente — sem criar modos novos.
4. Leitura de código de balança na busca do PDV.
5. Periféricos/TEF/offline em trilha separada (dependem de componente externo e decisão de arquitetura).

**Módulos afetados:** PDV, Caixa, Financeiro, Fiscal (NFC-e), Administração (terminais/parâmetros).

### 6.5 Regras que não podem ser alteradas silenciosamente
- **[não alterar]** Dinheiro esperado = fundo + recebimentos em espécie (valor aplicado) + suprimentos − sangrias − devoluções em espécie; troco não deduzido de novo (§5).
- **[não alterar]** Fundo não é receita; suprimento não é venda; sangria com conta de destino é transferência (§5).
- **[não alterar]** Uma sessão aberta por terminal; fechamento sem ajuste automático; justificativa obrigatória com divergência; reabertura preserva histórico (§5).
- **[não alterar]** Pix só com cobrança confirmada ou manual identificado (§3).
- **[não alterar]** Estados independentes comercial × pagamento × fiscal; venda paga pode ter documento pendente (§3).
- **[não alterar]** Série NFC-e exclusiva por terminal; numeração na 1ª transmissão (§15).
