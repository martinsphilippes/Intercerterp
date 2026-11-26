# O que foi preservado, lacunas verificadas e evidência dos testes

## 1. Mapa de preservação

| Item existente | Situação depois da modularização | Como é garantido |
|---|---|---|
| Telas e rotas (220 páginas + rotas de API) | Todas mantidas, nenhuma removida ou renomeada | Teste "toda tela interna e pública tem módulo" mapeia cada uma. Em `legacy`, o nível é sempre `full`. |
| Dados, saldos, documentos e trilhas | Nunca apagados ao desligar | Habilitação é um registro separado (`company_modules`); nenhuma rotina de módulo grava em tabelas de negócio |
| Permissões e perfis (`roles`, `SPECIAL_ACTIONS`) | Intactos | A habilitação é conferida antes do perfil e não altera perfis. Teste: perfis da empresa B iguais antes e depois de alterar A. |
| Recursos `feature.<chave>` em Parâmetros | Mesmo significado (configuração) | `featureOn` combina habilitação e recurso; o domínio (`isFeatureOn`) não mudou |
| Isolamento por empresa (`ScopedStore`) | Mantido | O registro de módulos é por empresa (id determinístico) e as consultas filtram `companyId` explicitamente |
| Fluxos de clientes atuais | Inalterados | Toda empresa existente fica em `legacy` após a linha de base. Suíte anterior: 983 testes, todos verdes. |
| Tarefas duráveis (fila) | Nunca bloqueadas | Completam operações já confirmadas |
| Rotinas obrigatórias | Sempre rodam | `ALWAYS_RUN_ROUTINES` |
| Avisos do gateway | Sempre processados | Atualizam só pedidos existentes |
| Autenticação, administração essencial, backup, auditoria e arquivos | Recursos da plataforma | `classification: platform`. A API recusa desligar (`not_contractable`). |
| Backup e restauração | Não restauram nem removem habilitação | Tabelas de módulos fora do backup (`SELF_EXCLUDED` em `src/domain/backup.ts`) |
| Empresa de demonstração e acesso rápido | Inalterados | Ficam em `legacy` |

**Mudanças de comportamento.** Valem só quando a empresa está em `enforced` e o módulo correspondente não está habilitado:

1. Ao concluir uma venda no PDV sem o módulo NFC-e, a venda sai sem NFC-e (recibo não fiscal) e a mensagem informa o motivo. Sem Contas a receber, a venda a prazo é recusada.
2. Sem o módulo de Aprovação de compras, o pedido enviado é aprovado automaticamente, com registro na solicitação.

Com a habilitação completa ou em `legacy`, nada disso muda.

## 2. Classificação do levantamento

O detalhe por módulo está em [inventario-capacidades.md](inventario-capacidades.md), com o campo **Situação no repositório**.

| Situação | Entradas |
|---|---|
| **Já existe, isolado** (`exists`) | Quase todas: cadastros, PDV, caixa, devoluções, documentos comerciais, comissões, loja e funções, estoque e funções, compras (5 módulos + 3 funções), financeiro (todos), NF-e/NFC-e/NFS-e, livro de entradas, relatórios, metas, importação, contabilidade, rede |
| **Usa tela/recurso compartilhado** (`shared_screen`) | `fiscal.sped` e `fiscal.sintegra` (um único recurso `arquivosFiscais`; a habilitação separa pela rota); `/financeiro` (hub do motor financeiro); ações de contas a receber e a pagar no mesmo arquivo (basta um dono); `compras/_shared` (pedidos, cotações ou recebimento); certificados (lado do escritório e lado da empresa vinculada) |
| **Precisa de confirmação** (`needs_confirmation`) | `ecommerce.canais` (só prepara a conta); `financeiro.baixa_lote` (pai é receber; serve também a pagar); divisão de frete e expedição da loja |
| **Lacuna** (`gap`, `availability: planned`) | `fiscal.mdfe`, `vendas.pdv_offline`, `ecommerce.marketplaces`. Documentadas e não ativáveis: a API recusa com `module_planned`. |

## 3. Dependências acidentais investigadas

Cada item foi verificado no código, com arquivo e linha.

- **PDV × loja:** nenhuma importação. O vínculo fiscal só existe quando a origem é `online_order`.
  - Preservado como componente técnico (`tec.estoque`): as reservas da loja ainda reduzem o disponível do PDV.
- **Aprovações × cotações:** a leitura de `quotation_proposals` é opcional (enriquecimento).
  - Os botões "criar cotação" nas telas de pedido e reposição foram marcados como `compras.cotacoes`.
- **Alteração em massa × precificação:** `price-adjust.ts` é serviço compartilhado e continua disponível. `product-bulk.ts` não é usado por nenhum outro módulo.
- **Conciliação:**
  - o estorno de baixa conciliada depende de desfazer a conciliação, que ficou como `historyActions`;
  - a baixa por retorno CNAB só existe ali (documentado);
  - o Banco Intercert não usa conciliação.
- **SPED × obrigações e pacote contábil:** o pacote contábil só inclui arquivos já gerados, e o SPED nunca é gerado sozinho.
- **Lotes:** o motor de estoque usa `products.lotControl`, independente do recurso.
  - Por isso o desligamento é `scheduled` enquanto houver produto com lote.

## 4. Evidência dos testes

Execução em 26/11/2026, neste repositório:

| Suíte | Resultado |
|---|---|
| `npm test` (memória) | **81 arquivos, 1033 testes, todos verdes**: os 983 anteriores + 50 novos |
| `TEST_STORE=postgres npm test` (suíte inteira) | **81 arquivos, 1033 testes, todos verdes** sobre o Postgres embutido (índice único de versão e transações reais) |
| `npx tsc --noEmit` | sem erros |
| `next lint` | sem erros (só avisos antigos de outros arquivos) |
| `next build` | concluído |
| Varredura de navegação com login real (modo legacy, demonstração) | **148 telas, 148 padrões de rota**, nenhum problema de aplicação. Uma tela (curva ABC) estourou o tempo só pela compilação do modo dev e respondeu 200 na nova tentativa. |
| Homologação local no build de produção (API do Interos + navegador) | Linha de base das 9 empresas da demonstração (201). Na loja de demonstração, um `apply` com `If-Match` desligou cotações, conciliação (`history: none`) e SPED, e passou o controle a `enforced` (201, versão 1 → 2). Resultado: `/compras/cotacoes` em consulta com aviso; `/financeiro/conciliacao` → `/modulo-indisponivel`; `/fiscal/arquivos` (SPED) em consulta; `/fiscal/arquivos/sintegra` e `/compras/pedidos` normais. No menu, "Cotações (consulta)" aparece e "Conciliação bancária" some. As demais empresas continuam em `legacy`. A mesma Idempotency-Key reenviada com outra versão esperada foi recusada com 409 `idempotency_mismatch`. |

Testes novos:

- `tests/modules-catalog.test.ts`
  - Grafo válido, detecção de ciclo e referência inválida.
  - Formato das chaves.
  - Dependências diretas, transitivas e dependentes.
  - As combinações reais.
  - Uma lacuna não é contratável.
  - O JSON publicado está em dia com o código.
  - **Rastreabilidade total:** toda tela, rota de API, server action (com chave existente), exportação, rotina, tarefa, recurso e permissão tem módulo.
  - Os nomes das ações de conclusão existem.
  - As tabelas e os campos das verificações de pendência existem.
- `tests/modules-enablement.test.ts`
  - **Linha de base:** legacy sem efeito, idempotente, divergências, dependências acrescentadas e lote de migração.
  - **Duas empresas fictícias, A e B:** alterar A não muda o estado, a versão, os perfis nem os dados de B, e vice-versa.
  - Modos shadow e enforced.
  - Ação negada auditada; ação de histórico permitida; "basta um dono".
  - Pai limita o filho.
  - Dependências: recusa, cascata e habilitação conjunta.
  - Recusa de plataforma, componente técnico, lacuna, tipo errado e módulo inexistente.
  - **Desligamento:** caixa aberto (conclusão e desligamento automático ao fechar); PDV com atendimento em espera; lotes agendados.
  - Reativação com configuração preservada.
  - **Versão:** esperada errada, concorrência real e lote inválido sem gravação.
  - Divergências exigidas para passar a `enforced`.
  - Rotinas puladas ou mantidas.
  - Situação da empresa com configuração pendente.
  - Provisionamento seletivo.
  - **Operações:** idempotência, divergência de corpo, `rejected` e agendada.
  - **API HTTP:** autenticação e escopos, catálogo, ETag, simulação sem `entries`, 400/403/201/200 com replay, `version_conflict`, isolamento de operação por cliente, histórico, 404 e 503.
- `tests/modules-combinations.test.ts`, sobre a demonstração:
  - compras sem cotação e sem aprovação (aprovação automática registrada);
  - loja sem PDV e com NF-e obrigatória;
  - fiscal sem SPED;
  - financeiro sem conciliação;
  - estoque sem lotes;
  - produtos sem edição em massa.

## 5. Pendências conhecidas

- A tabela de catálogo inicial citada no pedido **não foi recebida**. A conciliação com ela fica para o catálogo 1.1.
- A homologação em navegador com `enforced` foi feita localmente (banco em memória). Falta repeti-la no ambiente de homologação com Postgres, conforme `lancamento-gradual.md`.
- A busca global (`/api/search`) não filtra por módulo (só mostra dados existentes).
- O ciclo de vida de documentos fiscais pertence ao motor fiscal: mesmo com NF-e desligada, documentos existentes podem ser cancelados e corrigidos no prazo legal. Isso é intencional (obrigação).
