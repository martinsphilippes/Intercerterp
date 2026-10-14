# Evolução do Intercert ERP (referência GDoor) — documentação

Estudo aprovado em outubro/2026 e executado por fases, cada uma em branch própria, com testes de caracterização,
recursos novos atrás de parâmetro (`feature.*`, lido por `isFeatureOn`) e publicação em produção somente após aprovação.

| Documento | Conteúdo |
|---|---|
| `01-gdoor-funcionalidades.md` | Inventário funcional do GDoor a partir da base de conhecimento pública (sem código, marcas ou imagens) |
| `02-intercert-auditoria.md` | Auditoria do Intercert ERP: telas, módulos, regras, evidências |
| `03-matriz-comparativa.md` | Matriz A–F (existe igual / melhor / parcial / ausente / não se aplica / decidir) |
| `04-ausentes.md` | Funcionalidades ausentes com valor de negócio |
| `05-nao-duplicar.md` | O que reaproveitar e ampliar em vez de criar |
| `06-design.md` | Opções de design e a escolhida (C — híbrida) |
| `08-logica-negocio.md` | Regras de negócio das funcionalidades novas |
| `09-plano.md` | Plano por fases (0 a 8 + trilha de periféricos) |
| `10-riscos.md` | Riscos, mitigação e limitações do estudo |
| `achados-fase-0.md` | Fase 0: comportamentos suspeitos nos cálculos (relatados, não corrigidos) |
| `inventario-fiscal-documents.md` | Fase 0: leitores de `fiscal_documents` e decisão revista da escrituração de entradas |

## Andamento

| Fase | Branch | Situação |
|---|---|---|
| 0 — base de segurança | `feat/fase-0-baseline` | 52 testes de caracterização dos cálculos (`tests/baseline-calculos.test.ts`), `isFeatureOn`, regra "venda em caixa de outro operador" (parâmetro `cash.operatorMismatch`), inventário fiscal |
| Correções de cálculo | `fix/calculos-fase-0` | achados 1, 3, 4, 5 e 6 de `achados-fase-0.md` corrigidos, testes atualizados explicitamente |
| 3 — compras e precificação | `feat/fase-3-compras` | entrada sem pedido, produto a partir do XML, conversor de CFOP, precificação pós-entrada (margem sobre o preço de venda, padrão 30%), alteração em massa, etiquetas (EAN-13/Code 128), devolução a fornecedor com abatimento no pagar. MD-e pendente (credenciais Focus, Fase 1) |
| 4 — crediário e cobrança | `feat/fase-4-crediario` | receber parcelas no PDV (F9) com estorno e linha própria no caixa (§26), baixa em lote, carnê com Pix estático, vencimento em dia útil (opcional), inadimplência (avisar/bloquear com liberação), modelos de cobrança pelo WhatsApp. Boleto registrado pendente (contrato bancário) |
| 5 — documento comercial e vendedores | `feat/fase-5-documento-comercial` | orçamento e pedido de venda (`sales_documents`/`sales_document_items`), reserva, importação no PDV, NF-e com xPed/nItemPed, link público do documento, transportadora; vendedores sem acesso, comissões (faturado ou recebido) com fechamento em conta a pagar, metas por vendedor. Perfis de sistema existentes recebem as operações novas pela sincronização de modelos |
