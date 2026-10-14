# Relatório 9 — Plano de evolução em fases (sem reescrever o ERP)

Base: matriz (`RELATORIO-3-matriz.md`, `matriz.json`), ausentes (`RELATORIO-4`), não duplicar (`RELATORIO-5`), lógica (`RELATORIO-8`), riscos (`RELATORIO-10`).

**Princípios**
1. Ordem por **impacto operacional → dependências → risco**. Nenhuma fase reescreve módulo existente; todas ampliam serviços em `src/domain/*` e rotas em `src/app/(app)/*`.
2. **Design só depois dos fluxos**: cada fase começa por um documento curto do fluxo (entrada → efeitos → estados → regras) aprovado pelo responsável de negócio (e pela contabilidade quando houver tributo). Telas seguem o padrão existente (`docs/arquitetura.md` "Padrão de tela — referência `src/app/(app)/clientes`"); nada de redesenho visual nesta trilha.
3. **Banco só aditivo**: campos opcionais, índices e coleções novas declarados em `src/lib/db/schema.ts` e provisionados por `scripts/appwrite-setup.ts` (que só adiciona). Nenhum campo removido/renomeado; nenhuma conversão de dados obrigatória — ausência do campo = comportamento atual.
4. **Feature flag por parâmetro**: cada recurso novo nasce desligado, controlado por `settings` (`getSetting`, `src/lib/core/settings.ts`) e exposto no catálogo `src/app/(app)/administracao/parametros/catalog.ts` com chave `features.<nome>`; telas novas em **rotas novas**.
5. **Reversão**: branch isolada por fase (`feat/fase-N-<tema>`), commits pequenos por item da matriz, PR por item; desligar a flag reverte o comportamento sem deploy; reverter o commit não exige migração (dados aditivos ficam inertes).
6. **Gate de cada entrega**: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (vitest), varredura de navegação (`scripts/dev/crawl.mjs`) incluindo as rotas novas, evidência (`scripts/dev/evidence.mjs`); sem deploy sem aprovação explícita.

Estimativas de esforço: ordem de grandeza (1 pessoa, com testes). Fases 0–2 são pré-requisito de produção; 3–6 podem correr em paralelo por pessoas diferentes desde que não toquem o mesmo serviço ao mesmo tempo (ver "conflitos" em cada fase).

---

## Fase 0 — Linha de base e proteções (1–2 semanas)

- **Objetivo:** congelar o comportamento atual dos cálculos críticos antes de qualquer ampliação e criar o mecanismo de flags.
- **Funcionalidades:** nenhuma visível ao usuário; (a) testes de caracterização; (b) helper `isFeatureOn(ctx, key)`; (c) correção da **lacuna 4** (venda × operador da sessão de caixa) — pré-requisito da Fase 4; (d) inventário das consultas que leem `fiscal_documents` (pré-requisito da escrituração de terceiros).
- **Requisitos:** suíte atual verde (403 testes em 40 arquivos, segundo a auditoria); ambiente de demonstração (`npm run seed`).
- **Reutilizar:** `tests/helpers.ts`, `tests/report-fixtures.ts`, `src/lib/core/settings.ts`, `src/domain/sales.ts` (`resolveCashSession`).
- **Componentes novos:** `tests/baseline-calculos.test.ts` (caracterização de `calcSale`, `computeTotals`/`buildItems`, `computeReceipt`, `expectedOf`, `lateChargeParams`, `defaultCfop`, custo médio em `postMovements`, `calcNfse`); helper de flag em `src/lib/core/settings.ts`.
- **Arquivos afetados:** `src/lib/core/settings.ts`, `src/domain/sales.ts` (resolveCashSession/finalizeSale — conferência do operador), `src/app/(app)/pdv/actions.ts`, `tests/*`.
- **Banco:** nenhum (flags usam `settings`).
- **Dependências externas:** nenhuma.
- **Testes:** os de caracterização (valores exatos em centavos/milésimos); teste da lacuna 4 (operador diferente → bloqueio ou aviso conforme parâmetro `cash.requireOperatorMatch`, padrão = aviso para não travar lojas).
- **Riscos:** correção da lacuna 4 bloquear vendas em lojas que compartilham terminal — mitigar com parâmetro.
- **Reversão:** branch `feat/fase-0-baseline`; parâmetro desliga a nova checagem.
- **Aceite:** testes de caracterização verdes e versionados; lint/typecheck/build/test verdes; varredura sem regressão.

---

## Fase 1 — Integrações que destravam produção (2–3 semanas, dependente de credenciais)

- **Objetivo:** sair da simulação nos fluxos já implementados (classe F alta).
- **Funcionalidades:** PLA-26 e-mail transacional; FIS-01/FIS-03/FIS-04/PDV-08/FIS-18/VEN-09/FIS-08 homologação Focus (NF-e, NFC-e, NFS-e, CC-e, cancelamento, inutilização, devolução); PDV-10 Pix real (Mercado Pago).
- **Requisitos:** credenciais (RESEND_API_KEY ou Appwrite Messaging; token Focus; certificado A1 no provedor; CSC; credencial Mercado Pago); UF/município de homologação.
- **Reutilizar:** `src/domain/fiscal/providers.ts`, `src/domain/payments/providers.ts`, `src/lib/core/email.ts`, `/administracao/integracoes/[kind]`, jobs `fiscal.*`.
- **Componentes novos:** nenhum de domínio; roteiro de homologação em `docs/integracoes.md`; (opcional) rota de webhook para Pix/Focus usando `webhook_events` (já no esquema) — só se o polling se mostrar insuficiente.
- **Arquivos afetados:** `docs/integracoes.md`, `docs/pendencias-externas.md`, eventuais correções de payload em `src/domain/fiscal/service.ts` (`toProviderPayload`) e `src/domain/payments/providers.ts`.
- **Banco:** nenhum.
- **Dependências externas:** Focus NFe, SEFAZ (homologação), prefeitura/ADN (NFS-e), Mercado Pago, provedor de e-mail.
- **Testes:** testes de contrato existentes com servidor falso + roteiro manual em homologação com evidência (XML autorizado, protocolo); cenários: autorização, rejeição, cancelamento fora do prazo, contingência, CC-e, inutilização, Pix expirado/estornado.
- **Riscos:** emissão em produção acidental — ambiente travado em homologação até aprovação; diferenças de payload por UF.
- **Reversão:** voltar provedor para `simulated` na configuração fiscal (já suportado).
- **Aceite:** NF-e, NFC-e e NFS-e autorizadas em homologação com XML arquivado; CC-e e cancelamento registrados; e-mail entregue (convite, DANFE, pacote contábil); Pix confirmado automaticamente; nenhum teste existente quebrado.

---

## Fase 2 — Conformidade fiscal com prazo (3–5 semanas)

- **Objetivo:** atender a reforma tributária no calendário e reduzir rejeições, sem alterar a tributação atual.
- **Funcionalidades:** FIS-19 (IBS/CBS/IS — campos e grupos no payload, classificação por produto/grupo, vigência); base mínima de FIS-12 (campos aditivos em `tax_groups` necessários à reforma); FIS-26/FIS-27 (validações prévias como **aviso** e catálogo de rejeições na ajuda); PLA-08 (glossário fiscal).
- **Requisitos:** Fase 1 (provedor homologado e com suporte aos grupos da reforma); notas técnicas vigentes; validação da contabilidade (cClassTrib, CST IBS/CBS por grupo).
- **Reutilizar:** `tax_groups`, `taxFor`/`buildItems`/`toProviderPayload` (`src/domain/fiscal/service.ts`), `validateDocument`, `currentIssues` (`src/domain/fiscal/nfe.ts`), `src/domain/help-content.ts`, `/produtos/[id]?tab=fiscal`.
- **Componentes novos:** bloco "Reforma tributária" na aba fiscal do produto e no grupo tributário; artigos de rejeição na ajuda.
- **Arquivos afetados:** `src/lib/db/schema.ts` (tax_groups: `ibsCbsCst`, `cClassTrib`, `ibsRateBps`, `cbsRateBps`, `isRateBps`, `reformValidFrom` — opcionais; companies/fiscal_configs: `reformAdherence`), `src/domain/fiscal/service.ts`, `src/domain/fiscal/nfe.ts`, `src/app/(app)/produtos/[id]/panels.tsx`, `src/app/(app)/produtos/cadastros/aux-forms.tsx`, `src/app/(app)/fiscal/configuracoes/page.tsx`, `src/domain/help-content.ts`.
- **Banco:** somente campos opcionais acima.
- **Dependências externas:** Focus (grupos IBS/CBS), legislação/NT.
- **Testes:** **teste de igualdade** — para todos os produtos/grupos do seed, XML/payload de ICMS/PIS/COFINS idêntico antes e depois; testes novos para os grupos IBS/CBS por CST; validação em homologação.
- **Riscos:** ALTO (cálculo fiscal). Mitigação: flag `features.reformaTributaria` por empresa e data de vigência; nada muda para quem não aderir.
- **Reversão:** desligar a flag; campos ficam inertes.
- **Aceite:** NF-e/NFC-e com grupos IBS/CBS autorizadas em homologação; teste de igualdade verde; contabilidade aprova a tabela de classificação.

---

## Fase 3 — Compras e precificação (3–4 semanas)

- **Objetivo:** cobrir o dia a dia de entrada de mercadorias do varejo PME.
- **Funcionalidades:** COM-03 (entrada sem pedido), COM-04 (cadastrar produto a partir do item do XML), COM-07 (precificação pós-entrada com prévia), COM-09 (conversor de CFOP), COM-08 (MD-e via Focus), COM-11 (devolução a fornecedor a partir do recebimento + abatimento no pagar), CAD-17 (etiquetas, inclusive a partir do recebimento), CAD-18 (alteração em massa, motor compartilhado com a precificação), CAD-11 (fator de referência na venda — opcional).
- **Requisitos:** Fase 0; para MD-e, Fase 1.
- **Reutilizar:** `src/domain/receipts.ts` (`createManualReceipt`, `importNfeXml`, `confirmReceipt`, `fetchXmlByKey`), `supplier_products`, `src/domain/products.ts`, `src/domain/pricing.ts` (`savePrice`, `priceMetrics`, `recordPriceHistory`), `src/domain/product-import.ts` (motor de atualização), `src/domain/fiscal/nfe.ts` (`loadOrigin`), `finance.ts` (abatimento), padrão de impressão `?print=1`.
- **Componentes novos:** rota `/compras/recebimentos/[id]/precificacao`; rota `/produtos/etiquetas` (impressão); rota `/produtos/alteracao-em-massa`; modo "Manifestação" em `/compras/recebimentos/novo`; tabela de pares CFOP em parâmetros.
- **Arquivos afetados:** `src/domain/receipts.ts`, `src/app/(app)/compras/recebimentos/novo/new-receipt.tsx`, `src/app/(app)/compras/recebimentos/[id]/conference.tsx`, `src/app/(app)/compras/recebimentos/actions.ts`, `src/domain/pricing.ts`, `src/domain/products.ts`, `src/domain/product-import.ts`, `src/domain/fiscal/nfe.ts`, `src/domain/integrations.ts`, `src/lib/permissions.ts` (ações `purchase.pricing`, `products.bulk_edit`, `purchase.manifest`), `src/app/(app)/administracao/parametros/catalog.ts`, `src/components/shell/nav.ts`.
- **Banco:** `receipts.pricingStatus` (opcional); `settings` para margem padrão e pares de CFOP; manifestação em `fiscal_events`/`integration_logs` (já existem) e NSU em `integrations.config`.
- **Dependências externas:** Focus (MD-e/DF-e).
- **Testes:** `tests/purchases*.test.ts` + novos: entrada sem pedido (devido e título iguais à regra §14), produto criado a partir do XML não duplica GTIN existente, precificação grava `price_history` e respeita prévia, devolução por recebimento referencia a chave e abate o pagar uma única vez, MD-e respeita intervalo/NSU (servidor falso), alteração em massa em lotes ≤ 100 operações por transação.
- **Riscos:** alteração de preço em massa indevida; duplicidade de produtos; efeito duplo na devolução; limite de transação do Appwrite.
- **Reversão:** flags `features.precificacaoEntrada`, `features.entradaSemPedido`, `features.manifestacao`, `features.alteracaoMassa`; rotas novas.
- **Aceite:** fluxo XML → produto novo → conferência → conclusão → precificação → etiquetas executado ponta a ponta na demonstração; números do recebimento idênticos aos da linha de base para os mesmos dados.

---

## Fase 4 — Crediário e cobrança (3–5 semanas)

- **Objetivo:** fechar o ciclo do crediário próprio no balcão.
- **Funcionalidades:** VEN-10 (receber parcelas no PDV e estorno), FIN-02 (baixa em lote), FIN-06 (carnê), VEN-07 (alerta/bloqueio por inadimplência), PLA-27 (modelos de WhatsApp para cobrança), FIN-05 (boleto registrado via API bancária), FIN-26 (vencimento em dia útil — opcional).
- **Requisitos:** Fase 0 (lacuna 4 corrigida); para boleto, contrato com banco/API.
- **Reutilizar:** `finance.settleInstallment`, `reverseSettlement`, `lateChargeParams`, `sendCollectionNotice`, `installments.ourNumber`, leitores CNAB (`src/domain/bank/*`), `cash.addCashMovement`/`sessionSummary`/`expectedOf`, `/financeiro/receber/[id]/recibo`, componente de link WhatsApp existente.
- **Componentes novos:** ação/diálogo "Receber parcelas" no `/pdv`; seleção múltipla com "Baixar selecionadas" em `/financeiro/receber`; página `/financeiro/receber/[id]/carne`; integração `kind = "bank_billing"` na Central.
- **Arquivos afetados:** `src/domain/finance.ts`, `src/domain/cash.ts` (novo tipo `receivable` somado no esperado), `src/app/(app)/pdv/pdv-app.tsx`, `src/app/(app)/pdv/actions.ts`, `src/app/(app)/financeiro/receber/page.tsx`, `src/app/(app)/financeiro/actions.ts`, `src/app/(app)/caixa/[id]/relatorio/page.tsx`, `src/domain/integrations.ts`, `src/lib/permissions.ts`, `src/app/(app)/administracao/parametros/catalog.ts`.
- **Banco:** `cash_movements.type` aceita `receivable` (valor novo; campo existente); `cash_movements.settlementId` (opcional); `installments.billing` json (linha digitável, URL/arquivo do boleto, status de registro); `settings` (inadimplência, modelos de mensagem).
- **Dependências externas:** API de cobrança bancária (Inter/Sicoob/Itaú ou agregador); canal de e-mail (Fase 1).
- **Testes:** `tests/cash*.test.ts` e `tests/finance*.test.ts` + novos: recebimento em espécie no PDV entra no dinheiro esperado e no relatório; estorno no PDV recompõe saldo da parcela e do caixa; baixa em lote com falha parcial não deixa baixa órfã; boleto registrado e retorno CNAB baixam a mesma parcela uma única vez.
- **Riscos:** mudança deliberada da fórmula do caixa (§5) — registrar em `docs/regras-assumidas.md`; dupla baixa (PDV + retorno bancário) — idempotência por parcela.
- **Reversão:** flags `features.recebimentoPdv`, `features.boleto`; sem a flag a ação não aparece e o tipo novo não é gerado.
- **Aceite:** operador recebe 2 parcelas de clientes distintos no caixa, imprime recibo, fecha o caixa com previsto correto; boleto emitido em homologação bancária e baixado pelo retorno.

---

## Fase 5 — Documento comercial de venda (4–6 semanas)

- **Objetivo:** orçamento e pedido de venda com faturamento no PDV ou em NF-e, sem duplicar o motor de venda.
- **Funcionalidades:** VEN-01 (orçamento), VEN-02 (pedido: reserva, entrega/faturamento parcial), PDV-12 (importar no PDV), FIS-05 (NF-e com origem documento comercial e NF-e referente a NFC-e), CAD-05 (vendedor sem acesso), VEN-05 (comissões), VEN-06 (metas por vendedor), VEN-12 (vendedor por item/intermediador — opcional), CAD-03 (transportadora = fornecedor categoria).
- **Requisitos:** Fases 0 e 1; regra de comissão aprovada (base: líquido recebido × faturado, tratamento de devoluções).
- **Reutilizar:** `resolvePrices`, `calcSale`, `stock.reserve/releaseReservations`, `carts.createCart`, `sales.finalizeSale`, `fiscal/nfe.ts` `loadOrigin`/`saveNfe`, `finance.createTitle`, `counters`/`numbering.ts`, `goals.ts`, `users`.
- **Componentes novos:** coleções `sales_documents` e `sales_document_items`; serviço `src/domain/sales-documents.ts`; rotas `/vendas/orcamentos`, `/vendas/orcamentos/novo`, `/vendas/orcamentos/[id]`, `/vendas/pedidos`, `/vendas/pedidos/[id]`, página de impressão; serviço `src/domain/commissions.ts` (apuração → título a pagar); rota `/vendas/comissoes`.
- **Arquivos afetados:** `src/lib/db/schema.ts`, `src/domain/carts.ts` (criar a partir de documento), `src/domain/sales.ts` (marcar documento faturado na conclusão, via vínculo), `src/domain/fiscal/nfe.ts` (`NfeOriginType` + `sales_document`), `src/domain/goals.ts`, `src/lib/permissions.ts` (módulo/ações novos), `src/components/shell/nav.ts`, `src/app/(app)/pdv/pdv-app.tsx` (botão importar), `src/app/(app)/dashboard/metas/*`, `src/app/(app)/fiscal/nfe/nova/nfe-wizard.tsx` (seletor de transportadora).
- **Banco:** coleções novas acima; `goals.sellerId`, `users.commissionBps`, `users.loginDisabled` (opcionais); `sales.salesDocumentId` (opcional).
- **Dependências externas:** e-mail/WhatsApp para envio do orçamento (Fase 1).
- **Testes:** novos `tests/sales-documents.test.ts` (conversão idempotente, reserva liberada no faturamento/cancelamento/expiração, faturamento parcial, NF-e com xPed/nItemPed sem efeito duplo), `tests/commissions.test.ts`; regressão de `tests/sales*.test.ts` e `tests/fiscal*.test.ts`.
- **Riscos:** efeito duplo (pedido + venda); reservas órfãs; conflito com a lista de pré-vendas do PDV.
- **Reversão:** flag `features.documentoComercial`; rotas novas; venda direta no PDV intacta.
- **Aceite:** orçamento → pedido → faturamento parcial em NF-e + restante no PDV, com estoque, títulos e comissões conferidos; nenhum teste de venda existente alterado.

---

## Fase 6 — Varejo de balcão e segmentos (4–6 semanas)

- **Objetivo:** atender mercados, açougues, padarias, farmácias e lojas com kits/promoções.
- **Funcionalidades:** PDV-06 (código de barras com peso/valor), CAD-16 (dados de balança e carga), CAD-12 (kits), CAD-13 (composição/montagem/desmembramento), CAD-15 (promoções leve-X-pague-Y, dia da semana), CAD-21 (fidelidade), EST-02 (lotes e validades com seleção na venda e alertas), VEN-03 (reserva de estoque na pré-venda), EST-04 (bipagem na contagem).
- **Requisitos:** Fase 0; regras fiscais de kit (item kit × componentes no XML) e de composição validadas pela contabilidade.
- **Reutilizar:** `product-search.tsx`, `/api/pdv/products`, `calcSale`, `postMovements`, `applyOnce`, `reserve`, `credit_vouchers`, `stock_movements.lot/lotExpiry`, `src/domain/routines/stock.ts`, `count-sheet.tsx`.
- **Componentes novos:** coleção `product_components`; aba "Componentes" em `/produtos/[id]`; rota `/estoque/montagem`; exportação de carga de balança (arquivo); seleção de lote no PDV.
- **Arquivos afetados:** `src/lib/db/schema.ts`, `src/domain/products.ts`, `src/domain/sales.ts` (baixa de componentes/lote), `src/domain/receipts.ts` (propagar lote), `src/domain/stock.ts`, `src/domain/pricing-calc.ts` (promoção como desconto explícito), `src/domain/carts.ts`, `src/app/(app)/pdv/*`, `src/app/(app)/produtos/[id]/panels.tsx`, `src/app/(app)/estoque/inventarios/[id]/count-sheet.tsx`, `src/domain/fiscal/service.ts` (rastro de lote no XML).
- **Banco:** `product_components` (nova); `products.plu`, `products.shelfLifeDays`, `products.nutrition`, `products.scaleBarcode` (opcionais); `prices.promoRule` json (opcional); `credit_vouchers.kind` (opcional, padrão "credit").
- **Dependências externas:** formatos de arquivo de balanças (Toledo/Filizola/Urano).
- **Testes:** decomposição do código de balança (peso e valor) sem alterar a regra de arredondamento; kit baixa componentes com custo correto; inventário/CMV com componentes; lote FEFO e alerta; reserva da pré-venda liberada na conclusão e na expiração.
- **Riscos:** custo/CMV de kits; saldo de lote divergente; promoções afetando limite de desconto.
- **Reversão:** flags por recurso (`features.balanca`, `features.kits`, `features.lotes`, `features.promocoes`, `features.fidelidade`).
- **Aceite:** venda com etiqueta de balança, kit e item com lote em uma mesma venda, conferida em estoque, CMV e NFC-e (homologação).

---

## Fase 7 — Gestão financeira, tributação completa e escrituração (5–8 semanas)

- **Objetivo:** dar ao gestor e ao contador a visão financeira e fiscal completa.
- **Funcionalidades:** FIN-24 (taxas por bandeira/parcelas + arquivo da adquirente), FIN-19/FIN-22 (plano de contas ampliado, DRE, aging), FIN-21 (fechamento de período), EST-05 (inventário em data-base), FIS-12 completo (ST/MVA, alíquota por UF, resolução por NCM/operação), FIS-11/FIS-07 (naturezas de operação e remessas), FIS-13 (crédito do Simples), FIS-16 (DIFAL), FIS-24 (escrituração de entradas como documentos de terceiros), COM-10 (CT-e de entrada), FIS-21 (XML de compras no pacote), CTB-02 (integração Domínio), PLA-09/PLA-11 (central de relatórios + XLSX), PLA-19 (importação de clientes/fornecedores/saldos/títulos).
- **Requisitos:** Fases 1–3; validação contábil de cada regra tributária.
- **Reutilizar:** `payment_methods`, `cardFeeByInstallment`, `src/domain/bank/*`, `fin_categories.dreGroup`, `cashflow.ts` (competência), `postEntry`, `stock_movements`, `tax_groups`/`taxFor`, `fiscal_documents`, `fiscal/export.ts`, `product-import.ts`.
- **Componentes novos:** leitor de arquivo da adquirente em `src/domain/bank/`; rotas `/relatorios/financeiros` (DRE, aging), `/estoque/inventario-fiscal`; cadastro de naturezas de operação em `/fiscal/configuracoes?tab=operacoes`; integração `kind = "accounting_dominio"`.
- **Arquivos afetados:** `src/domain/finance.ts`, `src/domain/cashflow.ts`, `src/domain/reports.ts`, `src/exports/finance.ts`, `src/exports/reports.ts`, `src/domain/inventory.ts`, `src/domain/fiscal/service.ts`, `src/domain/fiscal/nfe.ts`, `src/domain/fiscal/reports.ts`, `src/domain/fiscal/export.ts`, `src/domain/receipts.ts`, `src/app/(app)/financeiro/*`, `src/app/(app)/fiscal/*`.
- **Banco:** `payment_methods.feeTable` json; `fin_categories.code/level/accountingCode`; `cost_centers.parentId`; `settings` (data de fechamento); `tax_groups.stMvaBps/stRateBps/ufRates` json; coleção `operation_natures` **somente se** `tax_groups` não comportar a prioridade (avaliar; preferência por campo `operationKey` em `tax_groups`); `fiscal_documents.issuer` (ausente = própria).
- **Dependências externas:** layouts de arquivo das adquirentes; API Onvio/Domínio.
- **Testes:** teste de igualdade fiscal (como na Fase 2) para produtos sem regra nova; DIFAL "por fora" e "por dentro" com casos da fonte (110 × (18% − 7%) = 12,10); filtros de `issuer` em todos os relatórios fiscais (faturamento não muda); DRE fecha com a competência; fechamento de período bloqueia `postEntry` retroativo e permite reabertura auditada.
- **Riscos:** ALTO em tributação e em relatórios fiscais (documentos de terceiros vazando no faturamento).
- **Reversão:** flags por recurso; `issuer` ausente mantém tudo como hoje.

> **Revisão da Fase 0 (inventário `inventario-fiscal-documents.md`):** entradas de mercadoria serão escrituradas evoluindo `receipts` (que já guarda chave, número, série e XML da NF-e de entrada); `fiscal_documents` permanece só com documentos emitidos pela empresa. O campo `issuer` deixa de ser o caminho padrão — 15 leitores agregados (4 de numeração/inutilização) seriam contaminados.

- **Aceite:** contabilidade valida tributação de 3 cenários (Simples, Normal com ST, interestadual a consumidor); DRE e aging conferidos com planilha; livro de entradas gerado do mês de teste.

---

## Fase 8 — Arquivos fiscais e itens sob demanda (contínuo)

- **Objetivo:** atender demandas específicas sem comprometer o núcleo.
- **Funcionalidades (sob demanda):** FIS-22/FIS-23/FIS-25 (SPED Fiscal, Contribuições, Sintegra, arquivos estaduais — só após Fase 7), TRA-02 + CAD-04 (MDF-e e veículos), SRV-01 (OS sobre o documento comercial), FIS-10 (importação/exportação), FIS-14 (contra-nota de produtor), FIS-09/FIS-17 (assistentes de complementar/ajuste, NF-e conjugada), FIN-23 (cheques), VEN-13 (consulta de preços), VEN-15 (força de vendas na PWA), VEN-16 (e-commerce/API), CAD-22 (base tributária externa), PLA-03/PLA-12/PLA-13/PLA-14/PLA-22/PLA-28/PLA-30/CAD-07/CAD-19/CAD-23/FIN-20/FIS-20.
- **Requisitos/dependências:** cada item lista as suas no `RELATORIO-4-ausentes.md`. PLA-14 (termos/LGPD) deve ser antecipado se houver exigência jurídica.
- **Reversão/aceite:** mesmos princípios (flag + rota nova + testes + validação contábil quando fiscal).

---

## Trilha P (paralela) — Conector de periféricos e operação offline

- **Objetivo:** PDV-09 (TEF/POS integrados), PLA-24 (impressão direta), PDV-04 (gaveta), PDV-05 (balança serial), PDV-13 (contingência/offline).
- **Requisitos:** componente local (conector em `127.0.0.1:9100`, contrato em `docs/integracoes.md`: `/status`, `/print`, `/drawer/open`, `/scanner/events`, `/tef/transactions`) desenvolvido/fornecido fora deste repositório; decisão de produto sobre venda offline.
- **Reutilizar:** `terminals` (connectorUrl, tefProvider, tefConfig, drawerOnCash), teste de impressão `/administracao/terminais/[id]/teste-impressao`, `sale_payments` (NSU/autorização), efeitos inversos do cancelamento.
- **Arquivos afetados:** `src/app/(app)/pdv/pagamento/payment-app.tsx`, `src/app/(app)/pdv/pdv-app.tsx`, `src/domain/terminals.ts`, `src/app/(app)/administracao/terminais/*`, `docs/integracoes.md`.
- **Banco:** nenhum obrigatório.
- **Riscos:** venda concluída sem confirmação TEF; numeração offline duplicada.
- **Reversão:** sem conector configurado, o fluxo atual (manual + diálogo de impressão) permanece.
- **Aceite:** transação TEF aprovada/negada/cancelada refletida na venda e no cancelamento; impressão sem diálogo; gaveta abre só após venda em dinheiro.

---

## Resumo das fases

| Fase | Tema | Itens principais (IDs) | Esforço |
|---|---|---|---|
| 0 | Linha de base e proteções | testes de caracterização, flags, lacuna 4 | 1–2 sem |
| 1 | Integrações de produção | PLA-26, FIS-01/03/04/08/18, PDV-08, PDV-10, VEN-09 | 2–3 sem + credenciais |
| 2 | Conformidade fiscal com prazo | FIS-19, FIS-12 (mínimo), FIS-26/27, PLA-08 | 3–5 sem |
| 3 | Compras e precificação | COM-03/04/07/08/09/11, CAD-17/18/11 | 3–4 sem |
| 4 | Crediário e cobrança | VEN-10, FIN-02/05/06/26, VEN-07, PLA-27 | 3–5 sem |
| 5 | Documento comercial de venda | VEN-01/02/05/06/12, PDV-12, FIS-05, CAD-03/05 | 4–6 sem |
| 6 | Varejo de balcão e segmentos | PDV-06, CAD-12/13/15/16/21, EST-02/04, VEN-03 | 4–6 sem |
| 7 | Gestão financeira, tributação completa e escrituração | FIN-19/21/22/24, EST-05, FIS-07/11/12/13/16/21/24, COM-10, CTB-02, PLA-09/11/19 | 5–8 sem |
| 8 | Arquivos fiscais e sob demanda | FIS-22/23/25, TRA-02, SRV-01, demais D baixa | contínuo |
| P | Periféricos e offline (paralela) | PDV-04/05/09/13, PLA-24 | depende do conector |
