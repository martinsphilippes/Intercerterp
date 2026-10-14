# Relatório 10 — Riscos e proteções da evolução do Intercert a partir da comparação com o GDoor

Base: matriz (`RELATORIO-3`), plano (`RELATORIO-9`), auditoria (`auditoria/inventario.json`, 28 lacunas), `docs/regras-assumidas.md`, `docs/arquitetura.md`. Escala: **Probabilidade** (B/M/A) × **Impacto** (B/M/A).

---

## 1. Regressões

| # | Risco | Onde | P | I | Proteção |
|---|---|---|---|---|---|
| R1 | Ampliar o PDV (recebimento de parcelas, balança, kits, importação de documentos) quebrar a venda, o troco ou os efeitos | `src/domain/sales.ts`, `carts.ts`, `src/app/(app)/pdv/*` | M | A | Testes de caracterização da Fase 0; ações novas em diálogo/rota próprios atrás de flag; regressão completa de `tests/sales*.test.ts` e `tests/cash*.test.ts` a cada PR |
| R2 | Fórmula do "dinheiro esperado" do caixa mudar ao incluir recebimentos | `src/domain/cash.ts` (`sessionSummary`, `expectedOf`) | A (intencional) | A | Mudança só com decisão registrada em `docs/regras-assumidas.md` §5; teste de fechamento antes/depois; sem a flag o tipo novo não é gerado |
| R3 | Precificação/alteração em massa sobrescrever preços | `src/domain/pricing.ts`, `product-import.ts` | M | A | Prévia obrigatória, motivo, `price_history`, permissão nova, limite de itens por lote, sem aplicação automática por padrão |
| R4 | Novas origens de NF-e (documento comercial, recebimento, NFC-e) aplicarem efeito em dobro | `src/domain/fiscal/nfe.ts` (`loadOrigin`, `effectsLocked`) | M | A | Seguir o padrão "efeitos ficam com a operação de origem"; teste de idempotência (gerar, cancelar, regerar `-r<n>`) |
| R5 | Correção da lacuna 4 (operador × sessão) travar lojas que compartilham terminal | `src/domain/sales.ts` | M | M | Parâmetro com padrão "avisar"; bloqueio opcional |
| R6 | Telas/rotas fora da varredura passarem com erro | `scripts/dev/crawl.mjs` | A | M | Incluir rotas novas e as hoje não varridas (`/pdv/pagamento`, `/vendas/[id]/conclusao`, `/vendas/[id]/recibo`, `/caixa/abertura`, `/estoque/inventarios/[id]` — lacuna 13); criar specs E2E reais (`npm run e2e` não tem `playwright.config`) |
| R7 | Reserva de estoque nova (pré-venda/pedido) deixar reservas órfãs e "sumir" disponível | `src/domain/stock.ts` (`reserve/releaseReservations`) | M | M | Liberação na conclusão, cancelamento e expiração (rotina); relatório de reservas abertas; teste de expiração |

## 2. Duplicidade (estruturas e lógica)

| # | Tentação | Proteção (o que usar) |
|---|---|---|
| D1 | Criar `pessoas` unificada como o Gweb | Manter `customers`/`suppliers`; tags/categorias aditivas (RELATORIO-5 §2.2) |
| D2 | Criar `carriers`, `sellers`, `boletos`, `livro_caixa`, `plano_de_contas`, `promocoes`, `pontos_fidelidade`, `devolucoes_compra`, `notas_compra` | Fornecedor categoria transportadora; usuário vendedor; boleto na parcela; contas financeiras; `fin_categories`; `prices`; `credit_vouchers`; `loadOrigin`; `receipts` |
| D3 | Segunda consulta para relatório/exportação | Uma função de consulta usada por tela, CSV e XLSX (`src/exports/*`) |
| D4 | Segundo motor de cálculo de venda para orçamento/pedido | `calcSale`/`resolvePrices` |
| D5 | Baixa de título própria do PDV | `finance.settleInstallment` |
| D6 | Feature flags em variáveis de ambiente | `settings` por empresa/filial |
| D7 | Tabela de documentos de entrada separada | `fiscal_documents` com `issuer` (ausente = própria) |
| D8 | Portal do contador/app de BI separados | `/contabil/*`, `/dashboard`, `/relatorios/*`, PWA |

Gate de PR: toda coleção nova precisa citar no PR o item do RELATORIO-5 §3 que a justifica.

## 3. Perda de funcionalidade

| # | Risco | Proteção |
|---|---|---|
| P1 | "Copiar" comportamentos do GDoor que são inferiores aos do Intercert: lançar efeitos ao gravar a NF-e (antes da autorização), "zerar não listados" no balanço, livro caixa opcional, baixa parcial gerando nova parcela, extrato que não baixa títulos | Linhas classe C/A da matriz marcadas "manter"; qualquer mudança nelas exige decisão registrada |
| P2 | Perder o rigor de auditoria/idempotência ao criar telas rápidas | Revisão de PR com checklist (seção 9): `audit()`, `_idem`, `detId`, `applyOnce` |
| P3 | Simulação fiscal ser removida ao homologar o Focus | Manter provedor `simulated` para demonstração e testes |
| P4 | Remover o fallback de impressão pelo navegador ao integrar o conector | Conector é opcional; fallback permanece |

## 4. Cálculos fiscais e financeiros (não alterar silenciosamente)

Regras protegidas (detalhe em `RELATORIO-8` e `docs/regras-assumidas.md`): precisão em centavos/milésimos/pontos-base e arredondamento `roundDiv` (§1); rateio pelo maior resto e diferença de centavos na 1ª parcela (§1); resolução de preço e limites de desconto (§3, §12); custo médio ponderado e saldo só por movimento (§6); dinheiro esperado do caixa (§5); saldo de parcela, juros/multa, estorno (§7, §13); fluxo de caixa e conciliação (§13); devido e custo de entrada do recebimento (§14); CFOP padrão, CST 20, PIS/COFINS, faturamento fiscal, tributos aproximados, prazos de cancelamento (§15, §18); NFS-e (§8).

| # | Risco | P | I | Proteção |
|---|---|---|---|---|
| F1 | Ampliar `tax_groups`/`taxFor` (ST, UF, NCM, IBS/CBS, DIFAL) alterar o imposto de produtos já configurados | M | A | **Teste de igualdade** de payload/totais para todo o catálogo de teste antes/depois; resolução nova só quando não houver grupo no produto ou houver regra explícita da operação; flag por empresa; validação da contabilidade registrada no PR |
| F2 | Regras assumidas tratadas como validadas | A | A | Manter o rótulo "regra assumida — validar com a contabilidade" (`src/domain/fiscal/service.ts:226`); checklist de validação contábil por fase (2 e 7) |
| F3 | Documentos de terceiros (escrituração) entrarem no faturamento fiscal, no livro de saídas, no pacote ou na fila de transmissão | M | A | Filtro padrão `issuer != third_party` em `src/domain/fiscal/reports.ts`, `export.ts`, `service.ts` (jobs), listas `/fiscal/*`; mapa de consultas feito na Fase 0; teste "faturamento inalterado" |
| F4 | Composição do custo de compra mudar custo médio e CMV históricos | M | A | Opção explícita com padrão = cálculo atual; não recalcular movimentos passados |
| F5 | Promoções/kits/balança alterarem arredondamento da linha | M | M | Promoção como desconto de item explícito; quantidade derivada da etiqueta sem alterar o total impresso; testes de centavos |
| F6 | Taxas de cartão por bandeira mudarem o líquido previsto e conciliações já feitas | M | M | Tabela nova só para vendas novas; *fallback* `feeBps`; não reprocessar recebíveis liquidados |
| F7 | Comissões calculadas sobre base errada (bruto × líquido, devoluções) | M | M | Regra escrita e aprovada antes do código; apuração gera título a pagar auditável e reversível |
| F8 | Fechamento de período bloquear estorno legítimo | B | M | Reabertura com permissão e auditoria |

## 5. Permissões

| # | Risco | Proteção |
|---|---|---|
| S1 | Tela nova sem checagem de módulo/ação no servidor | `requireSession`/`requireAction` em toda action e rota; teste de "sem permissão" por ação nova |
| S2 | Ações novas não chegarem aos perfis padrão ou chegarem a perfis que não deveriam | Declarar em `SPECIAL_ACTIONS` (`src/lib/permissions.ts`) e usar a sincronização de `templateActions`; nunca reescrever matrizes de perfis existentes |
| S3 | Recebimento no PDV permitir baixa por operador sem permissão financeira | Exigir `pdv` + `finance.settle` (ou ação nova `pdv.receive_installment`), estorno com `finance.reverse` |
| S4 | Escritório contábil enxergar menus de varejo (ou o contrário) | Registrar módulos novos em `RETAIL_ONLY_MODULES`/`ACCOUNTING_MODULES` e no `navFor` (`src/components/shell/nav.ts`) |
| S5 | Manifestação do destinatário (evento irreversível) disparada por qualquer usuário | Ação nova `purchase.manifest` + confirmação |
| S6 | Endpoint público novo (consulta de preços, webhook) sem limite | Rate limit e escopo mínimo; webhooks com assinatura e `webhook_events` (idempotência por `externalId`) |

## 6. Dados de produção

| # | Risco | Proteção |
|---|---|---|
| DP1 | Migração destrutiva ou renomeação de campo | Proibido: só adição (`scripts/appwrite-setup.ts` já provisiona por adição); campos novos opcionais; ausência = comportamento atual |
| DP2 | Limites do Appwrite (tamanho de linha/atributos por coleção, ≤ 100 operações por transação) ao ampliar `products`, `receipts`, `fiscal_documents` ou em operações em lote | Preferir campos `json` agrupados; operações em lote particionadas e idempotentes por item; relatório de falhas |
| DP3 | Backfill em massa para preencher campos novos | Evitar; quando inevitável, script idempotente, executado em base de teste restaurada do backup antes da produção |
| DP4 | Testes/homologação gravarem na base de produção | Usar empresa de demonstração ou base restaurada; ambiente fiscal em homologação até aprovação; nunca `force` em dados reais |
| DP5 | Recuperação de desastre limitada (restauração só em nova base — lacuna 24) | Backup verificado antes de cada publicação de fase; plano de restauração documentado |
| DP6 | Dados pessoais novos (fidelidade, vendedores externos, termos) | LGPD: finalidade, aceite (PLA-14), exportação/anonimização sob pedido |

## 7. Integrações

| # | Risco | Proteção |
|---|---|---|
| I1 | Nenhuma integração exercitada de verdade (lacuna 1) | Fase 1 dedicada com roteiro e evidências; provedores atrás da Central de integrações |
| I2 | Emissão fiscal em produção por engano | Ambiente travado em homologação; troca para produção só por administrador com `fiscal.configure` e registro em auditoria |
| I3 | Retransmissão/duplicidade em falhas de rede | Manter `ref` única e "consultar antes de reenviar" (§18) |
| I4 | MD-e bloqueada por consumo indevido (consulta < 1 h) | Intervalo mínimo e NSU persistido; rotina, não botão repetível |
| I5 | Boleto/Pix confirmados por canal duplo (retorno + webhook + baixa manual) | Idempotência por parcela/`ourNumber`/`reference`; baixa única |
| I6 | TEF/conector local indisponível | Fluxo manual atual como fallback; venda nunca concluída sem confirmação do TEF quando o TEF for usado |
| I7 | Dependência de cron diário (rotinas 1×/dia — lacuna 3) para alertas novos (lotes, boletos, MD-e) | Executar também no executor em segundo plano ou aumentar a frequência do cron antes de depender de alertas próximos do tempo real |
| I8 | Mudança legal (notas técnicas da reforma, layouts SPED) | Acompanhar NT; campos por vigência; flag por empresa |

## 8. Desempenho

Listagens carregadas inteiras e paginadas em memória (lacuna 11). Recursos novos com volume (lotes, documentos comerciais, comissões, documentos de terceiros, MD-e) devem consultar com filtros indexados (índices novos declarados em `schema.ts`) e paginação no banco quando passarem de milhares de registros; medir com o seed antes de publicar.

---

## 9. Regra de segurança da implementação futura

1. **Branch isolada por fase/tema** (`feat/fase-N-<tema>`), a partir da branch principal atualizada; **nada direto na principal**.
2. **Incremental**: um item da matriz por PR (commits pequenos e descritivos); nenhum PR mistura refatoração com funcionalidade.
3. **Flag + rota nova**: recurso novo desligado por padrão (`settings` `features.*`), em rota nova; telas existentes só ganham pontos de entrada condicionados à flag.
4. **Banco aditivo**: só campos opcionais, índices e coleções novas; nenhum dado existente alterado em massa.
5. **Gate obrigatório em todo PR** (local e CI): `npm run lint` · `npm run typecheck` · `npm run build` · `npm test` · varredura de navegação (`node scripts/dev/crawl.mjs`) incluindo rotas novas · captura de evidência (`scripts/dev/evidence.mjs`) das telas novas · testes de caracterização da Fase 0 inalterados.
6. **Cálculos protegidos**: PR que toque `pricing-calc.ts`, `fiscal/service.ts`, `fiscal/nfe.ts`, `fiscal/calc.ts`, `finance.ts`, `cash.ts`, `stock.ts`, `receipts.ts` ou `cashflow.ts` precisa de: teste antes/depois com valores exatos, atualização de `docs/regras-assumidas.md` quando a regra mudar, e — se fiscal — validação da contabilidade anexada.
7. **Permissões**: toda ação nova declarada em `src/lib/permissions.ts`, checada no servidor e testada sem permissão.
8. **Documentação junto com o código**: `docs/progresso.md`, `docs/matriz-cobertura.md`, `docs/integracoes.md` atualizados no mesmo PR (lacuna 28 — documentação divergente).
9. **Sem deploy sem aprovação**: publicação na Vercel/Appwrite somente após aprovação explícita do responsável, com backup verificado imediatamente antes e plano de reversão (desligar flag → reverter commit) descrito no PR.
10. **Reversão sempre possível**: desligar a flag deve restaurar o comportamento anterior sem perda de dados; se não for possível, o PR não entra.

### Checklist do PR (copiar no template)
- [ ] Item da matriz (ID) e fase do plano
- [ ] Reuso declarado (RELATORIO-5) e, se houver estrutura nova, justificativa (§3 do RELATORIO-5)
- [ ] Flag `features.*` e rota nova (quando aplicável)
- [ ] Mudanças de banco somente aditivas
- [ ] Testes novos + caracterização inalterada; lint/typecheck/build/test verdes
- [ ] Varredura e evidência das telas novas
- [ ] Permissões declaradas e testadas
- [ ] Regras protegidas: nenhuma alterada OU decisão registrada em `docs/regras-assumidas.md` + validação contábil
- [ ] Plano de reversão e confirmação de que não haverá deploy sem aprovação
