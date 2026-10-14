# Fase 0 — comportamentos atuais suspeitos nos cálculos

Encontrados ao escrever `tests/baseline-calculos.test.ts` (52 testes de caracterização). **Nada foi corrigido**: os testes
congelam o comportamento de hoje (marcados com "ATENÇÃO (comportamento atual)"). Cada correção muda valores financeiros ou
fiscais e só será feita com aprovação; ao corrigir, o teste correspondente muda junto, de forma explícita.

| # | Onde | Comportamento atual | Impacto | Recomendação |
|---|---|---|---|---|
| 1 | `lateChargeParams` (`finance.late`) | parâmetro gravado na filial **substitui** o da empresa inteiro; filial com só `{graceDays: 5}` volta a multa para 2% | multa/juros errados na filial | mesclar campo a campo (corrigir) |
| 2 | `buildItems`, regime normal | CST 10 sem ICMS próprio; interestadual usa alíquota interna; base de PIS/COFINS inclui ICMS | NF-e de regime normal com valores discutíveis (Simples não é afetado) | validar com a contabilidade antes de mexer — entra na Fase 2 (tributação) |
| 3 | `computeTotals` | seguro cai no `extra.insurance` quando os itens não têm; frete e outras não | inconsistência entre os três acessórios | igualar regra (corrigir) |
| 4 | `splitInstallments` / `buildSchedule` | total menor que nº de parcelas gera parcelas de R$ 0,00 | título zerado no contas a receber | recusar ou reduzir o nº de parcelas |
| 5 | `computeReceipt` sem XML | custo unitário arredondado: 3 × 9,67 = 29,01 contra 29,00 pagos | estoque valorizado 1 centavo acima por linha | guardar custo da linha e ratear sobra (corrigir) |
| 6 | `postMovements` | saída com `unitCost` informado grava esse custo, não o médio; devolução registra custo mas não recalcula o médio | custo da venda/estoque pode divergir do médio | alinhar ao comentário do código (saída = custo médio) |
| 7 | menores | `defaultCfop("other")` sem grupo → vazio; juros após carência contam todos os dias; 1º vencimento do cartão +30 dias × crediário por mês-calendário; previsto do caixa inclui crediário (intencional) | baixo | decidir caso a caso |
