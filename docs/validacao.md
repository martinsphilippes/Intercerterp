# Validação — cenários executados e resultados

Data da validação: 06/10/2026. Este documento registra **o que foi executado e onde** — sem misturar ambiente local, homologação e produção.

## 1. Ambientes usados

| Ambiente | O que é | Usado para |
|---|---|---|
| **Testes automatizados** | `vitest` com o `MemoryStore` (mesma interface do Appwrite) em dois modos: imediato e `MEMORY_TX_MODE=deferred` (escritas visíveis só no commit e limite de 100 operações por transação, como o Appwrite TablesDB) | Regras de negócio, concorrência, idempotência, cenários ponta a ponta de domínio |
| **Appwrite 1.8 local (Docker)** | Instância self-hosted completa (banco, Auth, Storage, workers) em `localhost:8090` | Provisionamento do esquema (~75 tabelas), login real, seed de demonstração, backup e restauração em nova base, navegação |
| **Aplicação em build de produção** | `next build` + `next start` apontando para a base `intercert_demo` do Appwrite local | Varredura de navegação e captura de evidências em Chromium (Playwright), fuso `America/Sao_Paulo` |
| Appwrite Cloud / Vercel | **Não executado** | Endpoint e Project ID do Appwrite Cloud não foram informados (ver `docs/pendencias-externas.md`) |
| Provedores externos (Focus NFe, Mercado Pago, Resend, adquirente/TEF, banco) | **Não executado em homologação nem produção** | Contratos testados contra servidores HTTP falsos/adaptadores de teste identificados — isso **não comprova** a integração real |

## 2. Verificações automatizadas (estado final)

| Verificação | Resultado |
|---|---|
| Verificação de tipos (`npx tsc --noEmit`) | 0 erros |
| Lint (`next lint`) | 0 avisos, 0 erros |
| Build de produção (`next build`) | concluído (81 páginas geradas) |
| Testes — modo imediato (`npm test`) | __TESTS__ |
| Testes — modo Appwrite (`MEMORY_TX_MODE=deferred npm test`) | __TESTS__ |
| Provisionamento Appwrite (`npm run appwrite:setup`) | idempotente; aplicado nas bases `intercert` e `intercert_demo` |
| Varredura de navegação (`scripts/dev/crawl.mjs`, login real, fuso de Brasília) | **230 páginas, 140 padrões de rota, 0 problemas** (sem HTTP ≥ 400, sem erro de página/console, sem tela de erro, sem erro de hidratação) |
| Evidências (`scripts/dev/evidence.mjs`) | **62 capturas** (48 telas + 14 visões) em `docs/evidencias/`, sem erro registrado |

## 3. Cenários obrigatórios (seção 14 do pedido)

| # | Cenário obrigatório | Testes automatizados (vitest, normal + deferred) | Verificação no navegador / Appwrite | Resultado |
|---|---|---|---|---|
| 1 | Login, troca de filial e contexto correto dos registros | core.test.ts; scoped-store.test.ts (isolamento por empresa); admin.test.ts (convite → login, suspensão) | Login real no Appwrite local; seleção Empresa → Unidade; troca de filial no cabeçalho; consolidado restrito | **Aprovado** |
| 2 | Produto com variações e preços padrão/atacado, importação e persistência após recarregar | products.test.ts (combinações, atacado, vigência, histórico; importação CSV com prévia e política) | Cadastro com 2 variações e recarga da página (Appwrite) | **Aprovado** |
| 3 | Caixa aberto → venda com múltiplos meios → estoque/caixa/financeiro/fiscal coerentes | sales.test.ts “venda com múltiplos meios…” | PDV → pagamento → conclusão | **Aprovado** |
| 4 | Duplo clique e repetição não duplicam venda, baixa ou movimento | sales.test.ts “duplo clique e repetição (sequencial e paralela)…”; finance.test.ts “duas baixas concorrentes…” ; purchases.test.ts “confirmação concorrente/repetida…” | `ActionForm` com chave idempotente | **Aprovado** |
| 5 | Venda a prazo → parcelas → baixa parcial → conciliação sem nova entrada | finance.test.ts “venda a prazo → parcelas → baixa parcial → conciliação sem nova entrada → estorno bloqueado até desconciliar” | Conciliação na tela 25 | **Aprovado** |
| 6 | Pix/cartão pendente, confirmado e falha/timeout, com consulta de referência anterior | sales.test.ts “Pix: pendente bloqueia, falha permite nova cobrança após consultar a anterior…”, “cartão sem TEF exige NSU…”; integrations.test.ts | Pix em simulação rotulada (sem credencial Mercado Pago) | **Aprovado** |
| 7 | Devolução parcial e nova devolução excedente, vale-crédito e troca com diferença | sales.test.ts “devolução parcial, excedente bloqueado (inclusive em paralelo)…”, “troca com diferença…” | Tela 11 | **Aprovado** |
| 8 | Caixa com sangria/suprimento e fechamento com divergência preservada | cash.test.ts “sangria/suprimento e fechamento com divergência preservada…”, “reabertura…” | Telas 12–14 | **Aprovado** |
| 9 | Cotação com frete, mínimos e validade → pedidos agrupados → aprovação/revisão | purchases.test.ts “compara propostas com frete, mínimo e validade…”, “aprova em duas etapas…”, “alteração após aprovação gera revisão…” | Telas 47–48 | **Aprovado** |
| 10 | Pedido parcialmente recebido → nova entrada → saldo e obrigação corretos; XML repetido não duplica | purchases.test.ts “pedido parcialmente recebido → nova entrada…”, “confirmação concorrente/repetida…” | Tela 29 com XML de exemplo | **Aprovado** |
| 11 | Transferência parcial com trânsito e divergência | stock.test.ts “parcial com trânsito e divergência conserva o saldo físico total” | Tela 18 (TR-00003) | **Aprovado** |
| 12 | Inventário com movimentação ocorrida durante contagem | stock.test.ts “considera movimentos durante a contagem…”, “conclusões simultâneas…” | Tela 19 | **Aprovado** |
| 13 | Nota rejeitada/pendente, consulta/retransmissão e cancelamento suportado, sem falsos estados | fiscal.test.ts (rejeição → correção → retransmissão; pendente; contrato Focus contra servidor HTTP falso) | Simulação rotulada; Focus real depende de token | **Aprovado** |
| 14 | Fluxo e gerenciais conciliados com os registros, margem agregada pelos totais | reports.test.ts (margem pelos totais; resumo = detalhe = operações; painel = gerenciais); finance.test.ts (fluxo realizado) | Telas 03, 24, 44 | **Aprovado** |
| 15 | ABC com filtro de classe mantendo denominador e produtos sem receita | abc.test.ts | Tela 45 | **Aprovado** |
| 16 | Reposição com lote/múltiplo, entrega fora do horizonte e rascunho separado do confirmado | replenishment.test.ts | Tela 46 | **Aprovado** |
| 17 | Notificação lida com ocorrência ainda aberta, chamado e histórico reais | admin.test.ts “ler não resolve a ocorrência…”, “chamado com resposta…” | Telas 42–43, 37 | **Aprovado** |
| 18 | Backup gerado e recuperação comprovada em base de teste | backup.test.ts | Backup real no Appwrite local (1.264 registros/28 arquivos) e restauração em nova base | **Aprovado** |
| 19 | Operações concorrentes sobre mesmo título/estoque preservando saldo consistente | finance.test.ts “duas baixas concorrentes…”; stock.test.ts “duas saídas paralelas…”; sales.test.ts (paralelo) | — | **Aprovado** |
| 20 | Navegação e ações das 48 telas e 14 visões, sem rotas quebradas, botões inertes ou totais fixos | — | Varredura automática (crawler) + captura de evidências | **Aprovado** |

Observações:
- Cenário 6: Pix confirmado/pendente/falha validado com o provedor de **simulação** (rotulado) e contrato do Mercado Pago com servidor falso; nenhuma cobrança real foi emitida.
- Cenário 13: autorização SEFAZ real **não** foi executada (sem token Focus); os estados vêm do provedor de simulação rotulado e do contrato da Focus contra servidor falso.
- Cenário 18: backup real gerado no Appwrite local (1.264 registros / 28 arquivos, SHA-256 verificado) e restaurado em base nova; os testes automatizados repetem a geração, a adulteração detectada e a retenção.

## 4. Revisão adversarial e correções

| Etapa | O que foi feito | Resultado |
|---|---|---|
| Revisão adversarial 1 | Revisores por módulo procuraram defeitos; cada achado foi verificado de forma independente | **93 confirmados** (19 críticos, 29 altos, 45 médios) + 21 baixos; 3 refutados |
| Correções 1 | Núcleo (isolamento por empresa no acesso a dados, consolidado restrito, tarefas travadas, arquivos, login, CSV) + 7 frentes por módulo | todos tratados, com testes de regressão para críticos e altos |
| Verificação independente | Revisores céticos tentaram contornar cada correção e procuraram regressões, com testes temporários | 14 correções parciais e 30 novos achados (2 altos — um deles pré-existente: credenciais do sistema exfiltráveis pela configuração do Pix) |
| Correções 2 | 7 frentes por módulo | todos tratados, com testes de regressão |
| Revisão final | Revisão das mudanças da 2ª rodada com dupla verificação de cada achado | __FINAL__ |

Detalhes das regras resultantes: `docs/regras-assumidas.md` (seção 18).

## 5. O que a validação **não** cobre

- Emissão fiscal real (SEFAZ/prefeitura), cobrança Pix real, TEF/adquirente, envio de e-mail real, API bancária: dependem de credenciais e contratos externos (`docs/pendencias-externas.md`).
- Appwrite Cloud e Vercel: não publicados nesta execução por falta do Endpoint e do Project ID do projeto Appwrite.
- Carga/volume: os testes cobrem concorrência lógica (corridas determinísticas e paralelas), não desempenho com milhares de usuários simultâneos.
