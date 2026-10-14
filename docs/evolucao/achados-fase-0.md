# Fase 0 — comportamentos atuais suspeitos nos cálculos

Encontrados ao escrever `tests/baseline-calculos.test.ts` (52 testes de caracterização). Os testes
congelam o comportamento (pontos ainda abertos marcados com "ATENÇÃO (comportamento atual)").

**Situação (aprovado em 14/10/2026):** itens 1, 3, 4, 5 e 6 **corrigidos** na branch `fix/calculos-fase-0`, com os testes
atualizados explicitamente (comentário "Corrigido (achado N)"). Item 2 fica para a Fase 2 (validação contábil). Item 7 sem mudança.

**Item 2 (Fase 7, tributação):** corrigido **somente com o recurso `feature.tributacaoCompleta` ligado** (desligado por padrão) — ICMS próprio no CST 10/70, alíquota interestadual 4/7/12% e base do PIS/COFINS sem ICMS (este como parâmetro separado). Sem o recurso o comportamento atual continua (teste de igualdade em `tests/tax-complete.test.ts`; regras em `docs/regras-assumidas.md` §38 — validar com a contabilidade e em homologação).

Detalhe das correções:
- 1: `lateChargeParams` mescla empresa + filial campo a campo.
- 3: `computeTotals` aplica a mesma regra (itens, senão total informado) a frete, seguro e outras.
- 4: `splitInstallments` nunca gera parcela de R$ 0,00 (reduz o nº de parcelas); `buildInstallmentPlan` de compras idem.
- 5: `postMovements` aceita `totalCost` exato da entrada; o recebimento informa o valor da linha com rateios (`landedValue`).
- 6: devolução e estorno de venda recompõem o custo médio (entram pelo custo da venda); saídas continuam pelo custo informado pela venda (o médio no momento da venda) ou pelo médio vigente.

| # | Onde | Comportamento atual | Impacto | Recomendação |
|---|---|---|---|---|
| 1 | `lateChargeParams` (`finance.late`) | parâmetro gravado na filial **substitui** o da empresa inteiro; filial com só `{graceDays: 5}` volta a multa para 2% | multa/juros errados na filial | mesclar campo a campo (corrigir) |
| 2 | `buildItems`, regime normal | CST 10 sem ICMS próprio; interestadual usa alíquota interna; base de PIS/COFINS inclui ICMS | NF-e de regime normal com valores discutíveis (Simples não é afetado) | validar com a contabilidade antes de mexer — entra na Fase 2 (tributação) |
| 3 | `computeTotals` | seguro cai no `extra.insurance` quando os itens não têm; frete e outras não | inconsistência entre os três acessórios | igualar regra (corrigir) |
| 4 | `splitInstallments` / `buildSchedule` | total menor que nº de parcelas gera parcelas de R$ 0,00 | título zerado no contas a receber | recusar ou reduzir o nº de parcelas |
| 5 | `computeReceipt` sem XML | custo unitário arredondado: 3 × 9,67 = 29,01 contra 29,00 pagos | estoque valorizado 1 centavo acima por linha | guardar custo da linha e ratear sobra (corrigir) |
| 6 | `postMovements` | saída com `unitCost` informado grava esse custo, não o médio; devolução registra custo mas não recalcula o médio | custo da venda/estoque pode divergir do médio | alinhar ao comentário do código (saída = custo médio) |
| 7 | menores | `defaultCfop("other")` sem grupo → vazio; juros após carência contam todos os dias; 1º vencimento do cartão +30 dias × crediário por mês-calendário; previsto do caixa inclui crediário (intencional) | baixo | decidir caso a caso |
