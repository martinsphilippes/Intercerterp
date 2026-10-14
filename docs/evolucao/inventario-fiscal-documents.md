# Inventário — quem lê `fiscal_documents` (Fase 0 da evolução)

Objetivo: antes de qualquer fase que grave documentos fiscais **de terceiros** (escrituração de entradas, plano RELATORIO-9, Fase 7),
saber quem lê a tabela e quem seria contaminado se ela passasse a conter documentos não emitidos pela empresa.

Levantamento: `grep "\"fiscal_documents\""` em `src/` (113 ocorrências, 26 arquivos), outubro/2026.

## Classificação

### A. Leitura por origem ou por id — seguro (não muda com documentos de terceiros)

| Onde | Como lê |
|---|---|
| `domain/sales.ts` (995, 1452, 1473, 1493) | `originType = sale` + `originId` / `sale.fiscalDocumentId` |
| `domain/fiscal/nfe.ts` (169, 187, 189, 283, 286, 378, 411–475) | origem + modelo / id do rascunho |
| `domain/transfers.ts:630` | `originType = transfer` |
| `domain/integrations.ts:540`, `routines` de reprocessamento por id | `payload.documentId` |
| `fiscal/service.ts` (722–1109, 1201–1559, 1661–1900) | operações sobre um documento por id, irmãos pela mesma origem |
| telas de detalhe: `fiscal/nfe/[id]`, `fiscal/nfce/[id]`, `fiscal/nfse/[id]`, `_components/print-page`, `fiscal/nfe/nova`, `fiscal/nfse/nova`, `vendas/[id]/*`, `vendas/devolucoes/[id]`, `administracao/historico/origin.ts`, `dashboard/queries.ts:23` | por id |

### B. Listagens e somatórios por empresa/filial/modelo — **seriam contaminados**

| Onde | O que faria de errado |
|---|---|
| `fiscal/service.ts:1578, 1582, 1631, 1648` (inutilização e próximo número por modelo/série) | **crítico**: número/série de NF-e de fornecedor entraria na sequência e nas faixas de inutilização da empresa |
| `fiscal/service.ts:1413` (retransmissão em lote) e `:1431` (fim de contingência) | tentaria transmitir documento de terceiro se o status coincidir |
| `domain/routines/fiscal.ts:56` (documentos presos em processamento) | idem, consulta ao provedor de documento que não é nosso |
| `domain/fiscal/reports.ts:51, 305` (relatórios fiscais do período e cancelados) | totais de saída somariam entradas |
| `dashboard/queries.ts:137, 139` (autorizadas e pendências do painel) | indicadores do painel inflados |
| `fiscal/queries.ts:48`, `fiscal/nfce/page.tsx:50–51` (listas e fila) | documentos de terceiros na lista de emitidas e na fila |
| `domain/accounting/link.ts:161` (visão do escritório contábil) | faturamento do cliente contábil somaria compras |
| `domain/customers.ts:260–261` (360° do cliente) | NF-e em que o cliente é emitente apareceria como venda a ele |
| `api/search/route.ts:72, 80` (busca global por número/chave) | ambíguo, mas aceitável se o resultado mostrar o emitente |

## Conclusão e decisão revista

1. O plano previa reaproveitar `fiscal_documents` com um campo `issuer` para a escrituração de entradas. O inventário mostra
   **15 leitores agregados** que precisariam de filtro novo — e quatro deles (numeração e inutilização) com risco fiscal real
   se algum for esquecido.
2. O sistema **já guarda a NF-e de entrada** em `receipts` (recebimento de compra: `nfeKey`, `nfeNumber`, `nfeSeries`,
   `nfeIssueDate`, `xmlFileId`, importação do XML). Escriturar entradas de mercadoria é, portanto, **evoluir `receipts`**
   (relatório de entradas, livro, CFOP/CST de entrada), não criar registro paralelo nem misturar com documentos emitidos.
3. Recomendação para a Fase 7: `fiscal_documents` continua sendo **só documentos emitidos pela empresa**. Entradas de
   mercadoria → `receipts`. Entradas sem estoque (serviço tomado, despesa com nota) ficam para decidir na Fase 7, com
   dados reais de uso — sem tabela nova antes disso.
4. Se um dia for indispensável gravar terceiros em `fiscal_documents`, os 15 pontos da seção B são a lista de verificação
   obrigatória, começando pelos quatro de numeração.
