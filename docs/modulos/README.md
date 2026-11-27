# Modularização do ERP por empresa contratante

Catálogo `catalogo-modulos-erp-v1`, versão **1.0.0**. Fonte única: `src/lib/modules/catalog.ts`.

| Documento | Conteúdo |
|---|---|
| [catalogo-modulos-erp-v1.json](catalogo-modulos-erp-v1.json) | Catálogo legível por máquina. É o mesmo documento servido em `GET /api/interos/v1/catalog`. Gerado com `npm run modules:catalog`. |
| [matriz-dependencias.md](matriz-dependencias.md) | Dependências diretas e transitivas, componentes técnicos, dependentes, integrações opcionais, pré-requisitos e política de desligamento. Gerado. |
| [inventario-capacidades.md](inventario-capacidades.md) | Mapa rastreável de capacidade para implementação: telas (arquivo), menu, server actions, abas e botões, APIs, exportações, tarefas, rotinas, avisos e permissões. Gerado do código. |
| [contrato-interos-erp-v1.md](contrato-interos-erp-v1.md) | Contrato da integração de gestão com o Interos. |
| [preservacao-lacunas-evidencias.md](preservacao-lacunas-evidencias.md) | O que foi preservado, as lacunas verificadas e a evidência dos testes. |
| [lancamento-gradual.md](lancamento-gradual.md) | Migração, homologação, monitoramento e reversão. |

> **Sobre a tabela de catálogo inicial.** A tabela citada como "enviada com o prompt" **não chegou junto com a solicitação**. O catálogo foi derivado do levantamento do repositório, usando como guia os exemplos do pedido (cotação, pedido, aprovação e recebimento de compras, PDV/NFC-e, SPED etc.). Quando a tabela for enviada, a conciliação é feita entrada por entrada. Uma chave proposta que já exista vira apelido documentado; uma chave nova entra como versão 1.1 do catálogo. As chaves publicadas aqui não são renomeadas.

## 1. Três camadas independentes

Uma pessoa só executa uma capacidade quando todas as condições abaixo valem:

1. **A empresa está apta a operar.** A sessão é válida, a empresa e a filial estão ativas e o contexto de trabalho foi escolhido (`requireSession` / `requireApiSession`).
2. **O módulo está habilitado.** É o contrato, gravado em `company_modules`. O ERP é a fonte oficial; o Interos altera. A habilitação é nova e é conferida antes do perfil.
3. **O módulo está configurado, quando isso é exigido.** Há duas formas:
   - o recurso `feature.<chave>` está ligado em Parâmetros;
   - os pré-requisitos estão cumpridos: terminal, configuração fiscal, loja publicada, integração de NFS-e.
4. **O perfil permite a ação.** São as permissões `can`/`canDo`, que não mudaram.
5. **O registro está no escopo autorizado.** O isolamento por empresa (`ScopedStore`) e a carteira restrita não mudaram.

**Habilitação** e **configuração** são coisas distintas.
- A habilitação diz o que a empresa contratou.
- O recurso em Parâmetros diz se a empresa ligou aquela função.
- `featureOn()` na interface só responde "ligado" quando as duas coisas valem. Por isso toda aba, botão e tela que já dependia de um recurso passou a respeitar o contrato sem precisar ser reescrita.
- As regras de domínio (`isFeatureOn`) **não** mudam com a habilitação. A integridade operacional (por exemplo, o saldo por lote) segue a configuração, e a transição fica a cargo da política de desligamento.

## 2. Classificação das entradas

| Classe | Quantas | Significado |
|---|---|---|
| `commercial` (módulo comercial) | 36 + 1 lacuna | Contratável sozinho e com utilidade própria |
| `optional_function` (função opcional) | 30 + 1 em confirmação + 2 lacunas | Exige o módulo-pai |
| `technical` (componente técnico compartilhado) | 5 | Motores de estoque, financeiro, fiscal, preços e pagamentos (Pix). **Não são contratáveis.** Ficam ativos enquanto algum módulo ativo precisar deles. |
| `platform` (obrigatório) | 6 | Acesso, administração essencial, backup, painel/notificações/suporte, arquivos e gestão da rede da plataforma |
| `permission` (permissão de usuário) | 60 | As operações específicas de perfil (`SPECIAL_ACTIONS`). Não são módulos: o catálogo indica o módulo que governa cada uma (`permissions[].governedBy`). |

A tabela completa, com chave, nome, família, dependências e política de cada módulo, está em [matriz-dependencias.md](matriz-dependencias.md).

### Decisões de recorte (menor unidade contratável com segurança)

**Compras** foi dividida em reposição, pedidos, cotações, aprovações e recebimento, além de três funções do recebimento: nota a confirmar, CT-e e precificação.
- Cotação exige pedidos: a cotação termina gerando pedidos.
- Aprovação exige pedidos.
- Recebimento **não** exige pedido. A entrada sem pedido já existe.
- Pedido sem o módulo de aprovação é aprovado automaticamente, e isso fica registrado na solicitação. Sem essa regra, o pedido ficaria em análise sem nenhuma tela para aprová-lo (`src/domain/approvals.ts`).

**Fiscal: SPED separado do Sintegra.** Hoje o mesmo recurso, `arquivosFiscais`, liga os dois. A habilitação separa as rotas (`/fiscal/arquivos` e `/fiscal/arquivos/sintegra`). Desligar o SPED não afeta o pacote contábil, que só inclui arquivos já gerados (`fiscal/export.ts`).

**NF-e, NFC-e e NFS-e são módulos separados.** O ciclo de vida de documentos **já criados** pertence ao motor fiscal e continua mesmo com o módulo desligado, porque é obrigação legal: transmitir, consultar, cancelar no prazo, CC-e, reenvio e contingência.

**Loja virtual exige NF-e.** A expedição só sai com a nota autorizada (`requireReleased`, orders.ts:346). A loja **não** depende do PDV: não usa venda, caixa nem terminal. Cupons, Banco Intercert e canais são funções da loja.

**PDV exige caixa e produtos.** São regras reais: a venda exige um caixa aberto (sales.ts:298) e um terminal. NFC-e, clientes, contas a receber e orçamentos são **integrações opcionais**:
- sem o módulo NFC-e, a venda sai com recibo não fiscal e o operador é avisado;
- sem contas a receber, a venda a prazo (crediário/boleto) é recusada com mensagem clara (`pdv/actions.ts finalizeCartAction`).

**Funções que tinham um interruptor próprio viraram funções opcionais.** O interruptor em Parâmetros continua existindo como configuração, sem criar um segundo interruptor para a mesma capacidade. É o caso de alteração em massa, etiquetas, balança, promoções, kits, lotes, inventário fiscal, carnê, WhatsApp, baixa em lote, fechamento de período e outras.

**Recursos de configuração pura** não viraram módulo, porque não têm utilidade contratável sozinhos: bipagem na contagem, entrada sem pedido, conversor de CFOP e devolução a fornecedor. Eles aparecem em `surfaces.features` do módulo que os contém.

## 3. Estados e regra de acesso

| Estado na empresa | Tela | Ações | Rotinas |
|---|---|---|---|
| `enabled` | aberta | todas | rodam |
| `scheduled_off` (agendado) | aberta | todas | rodam |
| `draining` (em desligamento) | consulta, com aviso | só as de conclusão (`drainActions`) e de histórico | rodam |
| `disabled`, histórico `read` | consulta, com aviso; menu mostra "(consulta)" | só as de correção de histórico (`historyActions`) | não rodam |
| `disabled`, histórico `none`, ou não contratado | `/modulo-indisponivel`; some do menu | nenhuma | não rodam |

- **Função opcional:** nunca vale mais do que o pai.
- **Componente técnico:**
  - fica `full` quando algum módulo habilitado usa o componente;
  - fica `drain` quando um módulo que o usa está em desligamento;
  - fica `read` quando um módulo que o usa já esteve contratado.
- **Superfície compartilhada** (rota ou ação com vários donos): basta um dos donos estar disponível.

**Modo de controle da empresa** (é ele que permite o lançamento gradual):
- `legacy`: comportamento anterior. É o modo de toda empresa existente depois da migração.
- `shadow`: avalia tudo e registra em `audit_logs` (`module.shadow_denied`) o que seria negado, sem bloquear nada.
- `enforced`: aplica a habilitação.

**Prazo de revogação.** A instância que aplicou a alteração passa a valer na hora. As demais instâncias passam a valer em até **15 segundos** (memória curta de `company_modules` em `src/lib/db/read-cache.ts`).
- O cache é por empresa: alterar uma empresa não invalida nem afeta outra.
- Permissões de perfil não são removidas: o perfil continua igual, e a habilitação é conferida antes dele. Por isso, reativar o módulo devolve exatamente os acessos anteriores.

## 4. Pontos de controle

| Superfície | Onde é conferida | Comportamento |
|---|---|---|
| Telas internas (`page.tsx`) | `requireSession` → `enforceScreenModule`, pelo caminho real que o middleware coloca em `x-ic-path` (o valor enviado pelo cliente é sempre sobrescrito) | Módulo `none` leva a `/modulo-indisponivel`. Nos estados `read` e `drain` aparece um aviso no topo. |
| Menu | `(app)/layout.tsx` | Módulo indisponível some; em consulta aparece "(consulta)" |
| Abas, botões e telas condicionados a recurso | `featureOn` / `requireFeature` / `requireFeaturePage` | Recurso de módulo não habilitado responde como desligado |
| Server actions (392) | `runAction({ entitlement, action })`, marcado em toda ação pelo script `scripts/modules/annotate-actions.mjs` (tabela ação → módulo) | Recusa com `module_disabled` e auditoria `module.denied`. O caminho de um POST de ação é escolhido pelo cliente, por isso a conferência é feita pela ação e não pelo caminho. |
| APIs internas (`/api/pdv/*`, `/api/certificados`, ver loja) | `requireApiSession(..., { modules })` | 403 com o motivo |
| Exportações (`/api/export/<chave>`) | Módulo da chave | Exporta inclusive em consulta histórica; módulo `none` responde 403 |
| Rotinas diárias | `runScheduled` | Pulam com `skipped: module_disabled`, exceto as que encerram obrigações (`ALWAYS_RUN_ROUTINES`): expiração de pedidos e reservas, documentos fiscais parados, obrigações fiscais, backup, perfis e a manutenção de módulos |
| Tarefas duráveis (fila) | não bloqueadas | Completam operações já confirmadas: efeitos de venda e devolução, transmissão e consulta fiscal, e-mail, backup |
| Vitrine pública `/loja` | `loadStore` | Módulo `none`: loja fora do ar. `drain`/`read`: loja em pausa, sem carrinho ou pedido novo. O acompanhamento do pedido continua. |
| Aviso do gateway (`/api/loja/gateway`) | não bloqueado (obrigação) | Só atualiza pedidos já existentes: pagamento, estorno, chargeback |
| Link público de orçamento (`/documento`) | rota do módulo `vendas.documentos` | Segue o recurso `documentoComercial` |
| Interos (`/api/interos/v1`) | Token servidor a servidor com escopos | Ver o contrato |

## 5. Política de desligamento

Antes de confirmar, `simulate` mostra:
- os módulos dependentes, em cascata;
- as integrações opcionais que deixam de funcionar;
- as pendências em andamento, com quantidade;
- as obrigações que continuam.

Nenhum dado, saldo, documento ou trilha é apagado. Reativar reaproveita a configuração (`config`) e o histórico.

| Política | Módulos | Efeito |
|---|---|---|
| **immediate** | cadastros, alteração em massa, cotações, conciliação, SPED, Sintegra, relatórios, metas, DRE, CT-e etc. | Bloqueia novas operações na hora. A tela fica em consulta, ou oculta quando `afterOff: hidden`. |
| **drain** | caixa (3 d), PDV (1 d), devoluções (90 d), pedidos de venda (30 d), loja (30 d), Banco Intercert (60 d), transferências (30 d), inventário (15 d), pedidos de compra (60 d), aprovações (15 d), recebimento (15 d), nota a confirmar (60 d), contas a receber/pagar (365 d), recebíveis de cartão (400 d), NFC-e/NF-e/NFS-e (30 d), certificados (60 d), vendas da rede (60 d) | Bloqueia novas operações na hora e deixa concluir as pendências. Desliga sozinho quando não há mais pendência. Passado o prazo **com** pendências, continua em conclusão e não interrompe obrigações. |
| **scheduled** | lotes, financeiro da rede | Continua operando até a pendência impeditiva acabar; então desliga |

Casos conferidos separadamente:

- **Caixa aberto** (`cash_sessions` em `open`/`reopened`): o módulo entra em conclusão.
  - Fechar, sangria/suprimento e retransferência continuam permitidos.
  - Não é possível abrir outro caixa.
  - Desligar o caixa obriga a desligar também o PDV e as funções dele (cascata).
- **Devoluções de vendas anteriores:** ficam permitidas por 90 dias depois do desligamento do PDV, por causa do CDC (prazo para reclamar de defeito em bens duráveis).
  - O PDV é desligado com `drainActions` de cancelamento.
  - A devolução em dinheiro ainda exige caixa aberto, como antes (sales.ts:1431).
- **Cobranças e recebimentos em curso:**
  - títulos em aberto continuam podendo ser baixados por até 365 dias;
  - Pix pendentes do PDV podem ser confirmados ou cancelados;
  - recebíveis de cartão continuam até a liquidação.
- **Emissão fiscal em processamento:** os documentos em `queued`, `processing`, `pending` ou `error` seguem pelo motor fiscal. A fila de tarefas nunca é bloqueada, e a rotina `fiscal.stuck` sempre roda.
- **Pedidos on-line:** pedidos em pagamento, nota, separação, expedição, retirada ou devolução seguem até o fim. Os pendentes expiram pela rotina e liberam as reservas.
- **Expedição:** pedido pago segue para nota e expedição. Transferências em trânsito precisam ser recebidas ou canceladas.
- **Rotinas obrigatórias:** ver `ALWAYS_RUN_ROUTINES`.
- **Lotes:** se algum produto tem controle de lote, o desligamento fica **agendado**. O saldo por lote mantém a integridade do PDV, do recebimento e da transferência (stock.ts:221). Quando o controle é desligado nos produtos, o módulo desliga sozinho.
- **Conciliação:** desfazer uma conciliação continua permitido. O estorno de uma baixa conciliada exige desfazer a conciliação antes (finance.ts:538), e sem isso a baixa não teria correção.

## 6. Combinações reais conferidas

Os testes estão em `tests/modules-combinations.test.ts` e `tests/modules-catalog.test.ts`.

| Combinação | Resultado | Bloqueio legítimo / dependência acidental |
|---|---|---|
| PDV com NFC-e, sem loja virtual | ✅ funciona | O PDV não importa nada da loja (sales.ts:1-28). As reservas antigas da loja ainda reduzem o disponível do PDV: é tabela compartilhada do motor de estoque e fica preservada. |
| Compras sem cotações | ✅ | Pedido direto (`origin: manual`). Os botões "criar cotação" do pedido e da reposição passam a ser recusados pela ação marcada `compras.cotacoes`. |
| Estoque sem lotes | ✅ | Quando há produto com lote, o desligamento fica agendado (aviso: "Desligue o controle nos produtos"). |
| Produtos sem edição em massa | ✅ | `product-bulk.ts` só é usado pela própria tela. `price-adjust.ts` é serviço compartilhado da precificação após a entrada e foi preservado. |
| Loja virtual sem PDV | ✅, desde que a NF-e esteja habilitada | Dependência real `fiscal.nfe`. A interface avisa na simulação ("Loja virtual exige NF-e no mesmo lote"). |
| Financeiro sem conciliação | ✅ | A baixa de boleto pelo retorno CNAB só existe na conciliação. Sem ela, os boletos são baixados manualmente (documentado nas notas do módulo). |
| Fiscal sem SPED na interface | ✅ | As obrigações e o pacote contábil não geram SPED (obligations.ts:14; export.ts:244). O Sintegra continua. |
| PDV sem contas a receber | ✅ para venda à vista | Venda a prazo é recusada: "Venda a prazo (crediário/boleto) indisponível: Contas a receber não contratado". |
| Compras sem aprovação | ✅ | Pedido aprovado automaticamente ("Sem etapa de aprovação…"). |

## 7. Lacunas e itens a confirmar

- **Lacunas** (`availability: planned`; não ativáveis; a API recusa com `module_planned`):
  - MDF-e;
  - PDV em contingência offline (o PWA só mostra a página sem conexão);
  - integração de pedidos com marketplaces (hoje só existem contas "preparadas").
- **A confirmar** (`needs_confirmation`):
  - `ecommerce.canais`: está em uso, mas sem integração real.
  - `financeiro.baixa_lote`: tem receber como pai. É preciso confirmar se pode ser contratada só com pagar.
  - Divisão da expedição/frete da loja como função separada: o código atual exige frete configurado para publicar.
- **Busca global** (`/api/search`): continua da plataforma. Ela respeita as permissões de perfil, mas não filtra os resultados por módulo. Isso é aceitável porque só exibe registros que já existem (consulta histórica). Fica registrado como melhoria.
