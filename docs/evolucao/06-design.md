# Relatório 6: estudo de design do INTERCERT ERP com referência no GDoor

**Data:** 13/10/2026 · **Natureza:** estudo e protótipos isolados. Nenhum arquivo de `/home/user/Intercerterp` foi alterado e o git não foi usado.
**Entregáveis:** este relatório e `prototipos/index.html` (14 telas navegáveis com três painéis cada: captura atual, referência GDoor e proposta). As capturas usadas estão listadas em `prototipos/README.md`.

---

## 1. Resumo e recomendação

**Recomendação: Opção C, híbrida.** Ficam a casca, os componentes e as regras do Intercert, que já são consistentes e mais densos em informação do que o GDoor. Entram, em fases, sete padrões de produtividade do GDoor redesenhados com identidade própria:

1. painel de atalhos por módulo;
2. lista e ficha lado a lado, com navegação ‹ ›;
3. cores fixas por prazo e situação no financeiro e no estoque;
4. teclas de atalho visíveis;
5. dicas sob os campos com link para a configuração;
6. telas vazias com orientação;
7. modo escuro.

As fases também corrigem os 18 problemas de UX que a auditoria encontrou nas capturas reais.

Motivos da escolha:

- **A opção A (só evolução)** corrige os defeitos, mas não ganha produtividade.
- **A opção B (estrutura GDoor)** traria regressão alta. Ela trocaria tabelas com totais por listas em cartões e reescreveria `DataTable`, `FilterBar` e os formulários usados em 38, 35 e dezenas de telas. Também importaria fraquezas documentadas do próprio GDoor: modais empilhados, campos sublinhados com pouco contraste e ícones sem rótulo.

---

## 2. Fontes e método

| Fonte | O que foi usado |
|---|---|
| GDoor: 7 inventários (`gdoor/inventario/*.json`), campo `designObservado` e capturas por item | Mais de 600 capturas indexadas. 25 imagens foram abertas e analisadas visualmente; 14 entraram nos protótipos (Gweb, Gpro/Gslim, Gview e Ajatus). |
| Intercert: 62 capturas reais em `docs/evidencias/` | 22 analisadas visualmente; 14 entraram nos protótipos. |
| Intercert: código | `src/app/globals.css` (tokens), `src/components/ui/*.tsx` (17 componentes), `src/components/shell/*` (menu, busca, unidade, usuário), `src/app/(app)/layout.tsx`, `src/components/shell/nav.ts`, `docs/arquitetura.md` (padrão de tela), `docs/referencia/especificacao-telas.md` (marca). |
| Auditoria | `auditoria/inventario.json`: `designObservado` e a lacuna 27, “UX recorrente nas capturas reais”. |

Medições no código que embasam o impacto estimado:

- `DataTable` é usada em 38 arquivos de tela, `FilterBar` em 35 e `Stat` em 62.
- `input type="date"` aparece em 61 arquivos.
- `window.confirm` aparece em 10 lugares.
- Há cerca de 1.660 classes de cor literais (`slate-*`, `bg-white`, `text-ink`, `bg-brand-*`) em `.tsx` e nenhuma variante `dark:`.
- As barras de ação `sticky` ficam em 10 formulários (produto, cliente, fornecedor, pedido, NFS-e, usuário, terminal, empresas, cliente contábil, reposição).
- A rota `/financeiro` hoje só redireciona para `/financeiro/receber`.

---

## 3. Os três mundos comparados

- **GDoor desktop (Gpro/Gslim, retaguarda Windows).** Cada módulo abre numa janela com dois modos, Listagem (grade) e Ficha (formulário). O rodapé tem ícones de linha com rótulo (Listagem, Ficha, Novo, Replica, Desfazer, Salvar, Apaga, Agrupa, Campos, Listas, Imprime), as setas « ‹ › » navegam entre registros e as teclas F1–F12 aparecem impressas nos botões. Os rótulos são laranja e os campos são só uma linha sublinhada. A densidade é muito alta, com corpo de 8–9 pt, não há paginação e as linhas são coloridas por situação.
- **GDoor web (Gweb, Ajatus, Gview, apps).** O menu lateral claro tem grupos recolhíveis. Um painel direito recolhível (») traz os blocos Acessos, Ações e Configurações, com letras mnemônicas. O botão “+” laranja flutua no canto e as listas são cartões de duas ou três linhas com chips de situação. A paginação fica no topo (“Por página 10 · 1–10/358”). O painel de filtros é expansível e tem filtro padrão por usuário. Há dicas sob os campos com link para a configuração, telas vazias ilustradas e modo escuro. No financeiro, as cores são fixas por situação: vencida em vermelho, vence hoje em azul, pendente em azul-claro, paga em verde.
- **Intercert hoje (Next.js + Tailwind v4).**
  - **Casca e página:** menu azul-marinho #0f2147 de 256 px com nove grupos sempre abertos e cabeçalho branco com unidade, busca Ctrl K, sino e usuário. Cada página segue um padrão único: `PageHeader` → cartões `Stat` que filtram → `FilterBar` GET → `DataTable` com totais, colunas configuráveis e exportação.
  - **Formulários e detalhes:** formulários com `ActionForm` idempotente; detalhes com `LinkTabs`, `DefinitionList` e `Timeline` de auditoria; selos vêm de um dicionário central (`STATUS` em `badge.tsx`).
  - **Aparência:** alta densidade (texto de 14 px, 11–14 colunas), só tema claro e a fonte Inter declarada mas não carregada.

---

## 4. Análise comparativa por elemento

Legenda da última coluna: **I+** o Intercert é melhor · **G+** o GDoor é melhor · **=** equivalente · **C** combinar.

| Elemento | Intercert hoje | GDoor desktop | GDoor web | Avaliação |
|---|---|---|---|---|
| **Menus** | 9 grupos fixos em caixa alta e ícones Lucide; rótulos longos truncados (“Caixa (abertura, movime…”); “Compras” abaixo da dobra em 1440 × 900 | Grade de 20 módulos com ícones laranja; barra lateral escura só de ícones, sem rótulo | Grupos recolhíveis com chevron; item ativo com barra laranja; rodapé com tema, usuário e versão | **G+ (web).** Grupos recolhíveis e rótulos curtos resolvem truncamento e dobra |
| **Navegação lateral e global** | Busca global Ctrl K só por registros; breadcrumbs; abas por URL | Janelas MDI; « ‹ › » entre registros; teclado em primeiro lugar | Três zonas: menu, página e painel direito de atalhos; botão “+” | **C.** Painel de atalhos, ‹ › entre registros e Ctrl K também para telas e ações |
| **Cabeçalhos** | Breadcrumb, título de 20 px, descrição de 1–3 linhas, ações à direita (laranja = principal) | Título da janela e faixa de ações em texto | Título grande e leve, sem breadcrumb | **I+.** Manter; encurtar descrições para uma linha |
| **Dashboards** | Painel completo e auditável (≈2.700 px): 8 KPIs com microcopy, gráfico, meta, alertas, resumos | Não há (o painel fica no Gview, um app separado) | Widgets móveis com filtro por widget; gráficos grandes e pouca leitura | **C.** Dados do Intercert, mais “precisa de atenção” no topo e personalização tipo widget |
| **Cards / indicadores** | `Stat` branco, valor grande e dica; clicável e filtra; cor só no número | Quadros de situação com checkbox e totais | Cartões sólidos coloridos que filtram (Ajatus); Gview com cores por sinal | **C.** Manter `Stat` e adicionar tom semântico com estado “ativo” preenchido |
| **Tabelas** | Cabeçalho em caixa alta, células de duas linhas, ordenação por URL, colunas configuráveis, total do recorte, exportação. Problemas: rolagem horizontal sem indicador e selo SIMULAÇÃO por linha | Grade densa com zebra, checkbox, linha colorida, mestre-detalhe, “Campos” e “Listas” salvas, sem paginação | Lista em cartões de 2–3 linhas, ações ao passar o mouse, seleção vira barra laranja | **I+ na estrutura, G+ em seleção em lote, cor de linha e ações em menu.** Manter tabela; adicionar faixa de cor, barra de seleção e menu ⋮ |
| **Formulários** | `FormSection` + `FormGrid` em cartões; rótulo pequeno; `*`; dicas; `MoneyInput`/`QtyInput`. Problemas: datas mm/dd/yyyy, barra fixa cobrindo campos | Rótulos laranja, campos sublinhados, seções recolhíveis, ícones de ação no campo (CEP, CNPJ) | Material: rótulo flutuante, contador 0/120, dica com tecla e link para configuração | **C.** Manter caixas (mais contraste e toque); adotar dicas com link, contador e ícones de consulta no campo |
| **Botões** | Relevo por gradiente; azul padrão; laranja para a ação principal; seis variantes | Rodapé de ícones finos com rótulo e tecla | Primário laranja em caixa alta; secundários em texto | **I+.** Manter; mostrar tecla de atalho no botão (`kbd`) |
| **Ícones** | Lucide com rótulo no menu; nas tabelas, ícones sem rótulo (olho, lápis, R$) | Família de linha consistente; menu lateral sem rótulo | Material Icons; muitos sem rótulo | **=.** Manter Lucide; dica (title/aria) obrigatória e ações raras no menu ⋮ |
| **Modais** | `Dialog` e `Drawer` nativos; `askReason`; 10 `window.confirm` destoando | Modais empilhados (recebimento → parcial → nova parcela) | Diálogos centrais e pré-visualização em modal | **I+ (evitar empilhar).** Trocar os `window.confirm` e usar `Drawer` para pré-visualizar |
| **Abas** | `LinkTabs` por URL com contador; 9 abas transbordam nos relatórios fiscais | Abas de texto simples | Sublinhado laranja e pílulas aninhadas em até três níveis | **I+.** Manter; indicador de rolagem e aviso na aba (“1 vence em 7 dias”) |
| **Filtros** | `FilterBar` GET sempre aberta (2 linhas e 9 campos em produtos), “Mais filtros” em `<details>` | Linha de filtros e construtor “Agrupa” | Busca única + funil que abre painel; filtro padrão por usuário; funil laranja quando ativo | **G+.** Busca e período visíveis, demais em “Filtros (n)” com chips removíveis e visão padrão |
| **Pesquisa** | Busca global (registros) e busca por lista | Busca incremental na coluna sob o cursor e fonética | Prefixos (“.”, “+”), autocomplete com estoque e preço | **C.** Paleta Ctrl K com telas, ações e registros; autocomplete do PDV já mostra preço |
| **Paginação** | “Anterior · n/m · Próxima” no rodapé; 25–50 por página | Não há (carrega tudo) | Topo, com “Por página” lembrado | **C.** Topo e rodapé, tamanho por usuário |
| **Telas de detalhe** | Cabeçalho com selos e ações por estado, `Notice`, mini-cards, abas, `DefinitionList`, `Timeline` | Ficha = detalhe = edição | Cabeçalho com avatar e auditoria; pares rótulo/valor | **I+.** Acrescentar cabeçalho 360° no cliente e ‹ › entre registros |
| **Cadastro / edição** | Produto em 5 abas; cliente com índice de seções; rascunho | Rodapé Novo/Replica/Salvar; consulta CNPJ/CEP; lista ↔ ficha | Página longa em cartões; revisão com “Ajustar” | **C.** Lista ↔ ficha (split), “Duplicar”, barra de ações que não sobrepõe |
| **Cores** | Azul-marinho e laranja; semântica emerald/amber/red/sky/fúcsia; só tema claro | Laranja de marca; linhas coloridas sem legenda | Laranja; cores fixas por situação financeira; modo escuro | **C.** Cores fixas por prazo e situação com legenda; tema escuro; manter a marca própria |
| **Tipografia** | Inter declarada sem carregar (cai na fonte do sistema); 14/12 px | Segoe/Tahoma 8–9 pt | Geométrica arredondada; títulos de 32 px leves | **I+ com ajuste.** Carregar Inter via `next/font`; números tabulares (já existe `.tabular`) |
| **Espaçamento** | Compacto e regular (p-4, gap-3) | Muito compacto | Generoso (24–32 px) | **I+.** Manter; oferecer densidade “compacta” por usuário |
| **Hierarquia** | Título → Stats → filtros → tabela; microcopy longa compete com números | Total sempre em destaque | Título → cartões → lista | **C.** Reduzir microcopy; o que pede ação vem antes do que só informa |
| **Densidade** | Alta e boa para retaguarda; páginas longas (2.700–6.200 px) | Altíssima | Média-baixa | **I+ com corte de altura.** Meta: até duas telas de altura na maioria das listas |
| **Usabilidade** | Estados claros, regras visíveis, auditoria. Problemas da lacuna 27 | Teclado, atalhos visíveis, Replica, cores com significado; modais empilhados | Dicas e links contextuais, telas vazias com ação, filtro padrão; formulários longos | **C** |

### 4.1 O que o GDoor faz melhor

- **Atalhos sempre à vista.** As teclas aparecem nos botões (F2, F10, Ctrl+1/2/3, letras A–F nos meios de pagamento) e o painel direito reúne Acessos, Ações e Configurações do módulo.
- **Ir de registro em registro** (« ‹ › ) e **Replica** para duplicar.
- **Cores fixas por situação no financeiro e nos lotes**, com cartões que filtram (Ajatus, Gpro).
- **Dicas sob os campos com link para onde o valor é configurado**, e telas vazias com ilustração e botão de ação.
- **Filtro padrão salvo por usuário** e paginação no topo com tamanho lembrado.
- **Modo escuro** e apps com navegação inferior no celular.
- **Liquidez em três níveis** no Gview (imediata, fim do dia, pagando atrasados).

### 4.2 O que o GDoor faz pior (não copiar)

- Modais empilhados em três níveis (recebimento → parcial → nova parcela).
- Campos só sublinhados e rótulos laranja pequenos, com baixo contraste e alvo de toque pequeno.
- Ícones sem rótulo no menu lateral; cores de linha sem legenda.
- Desktop sem paginação (carrega tudo) e parâmetros técnicos expostos ao usuário (SSL, DLL, timeouts).
- Web com baixa densidade: listas de cerca de 70 px por item e telas centrais quase vazias.
- Inconsistência entre produtos (desktop Delphi, Gweb Material, Ajatus Bootstrap) e imagens de ajuda quebradas (404).

### 4.3 Problemas do Intercert hoje e como cada um é tratado na proposta

| # | Problema (auditoria, lacuna 27) | Tratamento na opção C | Tela do protótipo |
|---|---|---|---|
| 1 | Datas nativas em mm/dd/yyyy | Componente `DateInput` com máscara dd/mm/aaaa e calendário; `FilterDef` do tipo `date` passa a usá-lo | 4, 7, 9, 10, 13 |
| 2 | Barra fixa cobre campos (v09, 21, 28, v07) | `ActionBar` ocupa espaço no fim do formulário; cabeçalho fixo da matriz dentro do próprio contêiner com rolagem | 3, 4, 14 |
| 3 | Tabelas mais largas que a tela, sem indicador | Ação principal visível e restantes no menu ⋮; colunas opcionais ocultas; sombra de rolagem no contêiner | 5, 9, 12 |
| 4 | Unidade e menu truncados | Unidade em duas linhas; rótulos curtos no menu | 2 |
| 5 | SIMULAÇÃO repetido em cada linha e faixa fúcsia em todas as telas | Um `Notice` por tela e chip “Demonstração” no topo | 1, 5, 11, 12 |
| 6 | Páginas muito longas (painel ≈2.700 px, NFC-e ≈2.800, integração ≈6.200) | Atenção primeiro, microcopy no ícone de informação, histórico paginado | 1, 7 |
| 7 | Termos técnicos (calcNfse, ref em mono) | Revisão de textos; nomes do usuário | Geral |
| 8 | `window.confirm` nativo (10 lugares) | `Dialog` do sistema | Geral |
| 9 | Operador logado diferente do operador da sessão de caixa, sem aviso | Chip de aviso no topo do PDV | 11 |
| 10 | Formulário de movimentação acima do histórico | `Drawer` lateral a partir da linha | 7 |
| 11 | Sem modo escuro, sem densidade, sem evidência em celular | Tokens semânticos + `data-theme`; densidade por usuário; trilho e navegação inferior | 2 e todas |
| 12 | Nove abas transbordando nos relatórios fiscais | Catálogo de relatórios com busca e segmentos | 13 |
| 13 | Fonte Inter não carregada | `next/font/google` em `layout.tsx` | Geral |

---

## 5. As três opções

### Opção A: evolução do design atual

Corrigir os 18 problemas de UX da auditoria (designObservado.problemas) e consolidar o design system sem mudar a estrutura: `DateInput`, `ActionBar` sem sobreposição, indicador de rolagem, aviso de simulação por tela, rótulos curtos, Inter carregada, `Dialog` no lugar de `window.confirm`, páginas mais curtas e tokens semânticos (o modo escuro pode ficar para depois).

- **Vantagens:** menor risco e menor custo; nenhum treinamento; preserva tudo o que funciona.
- **Desvantagens:** não traz ganhos de produtividade (atalhos, lista ↔ ficha, seleção em lote, filtros salvos); o menu continua longo; o financeiro segue sem visão consolidada.
- **Impacto no código:**
  - `src/app/globals.css` (tokens);
  - `src/app/layout.tsx` (fonte);
  - `src/components/ui/filters.tsx` e o novo `date-input.tsx`, que atinge os 61 arquivos com `type="date"`; os filtros mudam de forma central, os formulários um a um;
  - `ui/data-table.tsx` (sombra de rolagem, `simulated` por tela);
  - o novo `ui/action-bar.tsx` nos 10 formulários com barra `sticky`;
  - `ui/badge.tsx` (`SimBadge` por tela);
  - `shell/nav.ts` (rótulos);
  - `shell/unit-switcher.tsx`;
  - os 10 `window.confirm`.
- **Navegação:** igual.
- **Produtividade:** baixa a média (remove atritos).
- **Risco de regressão:** baixo; mudanças pontuais cobertas por e2e existentes.
- **Complexidade:** baixa (estimativa: 3–4 semanas de uma pessoa).

### Opção B: estrutura inspirada no GDoor, com identidade própria

Adotar o modelo do GDoor web de ponta a ponta:

- menu claro recolhível e painel direito em todos os módulos;
- listas em cartões de duas ou três linhas no lugar de tabelas;
- botão “+” flutuante como forma de criar registros;
- campos com rótulo flutuante e sublinhado;
- Listagem ↔ Ficha com rodapé de ações (Novo, Duplicar, Desfazer, Salvar, Apagar) e ‹ › em todos os cadastros.

A identidade continua Intercert (azul-marinho e laranja próprios).

- **Vantagens:** salto visível de modernização; navegação por teclado e por registro uniforme; experiência parecida com a do concorrente para quem migra do GDoor.
- **Desvantagens:**
  - perde densidade: listas em cartões mostram 3–4 vezes menos linhas por tela;
  - perde o total do recorte, a ordenação por coluna e as colunas configuráveis da `DataTable`;
  - importa as fraquezas do GDoor (baixo contraste, ícones sem rótulo);
  - exige treinar quem já usa o sistema;
  - aproxima o visual de um concorrente, com risco de parecer derivado.
- **Impacto no código:**
  - reescrita de `ui/data-table.tsx` (38 telas), `ui/filters.tsx` (35), `ui/form.tsx`, `ui/money-input.tsx`, `ui/card.tsx` (`Stat`, 62 telas) e `ui/page-header.tsx`;
  - novo shell: `shell/sidebar.tsx`, novo painel direito e `(app)/layout.tsx`;
  - revisão de praticamente todas as 142 `page.tsx`, inclusive detalhes que viram Ficha;
  - os testes e2e baseados em seletores de tabela precisam ser refeitos.
- **Navegação:** muda por completo (três zonas, “+”, Ficha).
- **Produtividade:** alta para quem vem do GDoor e menor no início para os usuários atuais; perde análise em tabela.
- **Risco de regressão:** alto, porque mexe em componentes compartilhados por todas as telas e em fluxos de formulário com idempotência.
- **Complexidade:** alta (estimativa: 10–14 semanas).

### Opção C: híbrida (recomendada)

Mantém a estrutura do Intercert (A) e acrescenta, por fases, os padrões do GDoor que aumentam a produtividade, sempre redesenhados e opcionais por tela:

1. **Painel “Atalhos do módulo”** à direita, recolhível, configurado por prefixo de rota (Acessos, Ações, Configurações, com teclas).
2. **Menu** com grupos recolhíveis, favoritos, rótulos curtos, modo trilho e navegação inferior no celular. A busca Ctrl K vira uma paleta “Ir para” com telas, ações e registros.
3. **Cartões `Stat` com tom semântico** e estado ativo, mais **faixa de cor na linha** da `DataTable`. Cores fixas por prazo no financeiro e semáforo no estoque, com legenda.
4. **Filtros recolhidos** em “Filtros (n)” com chips e **visão padrão por usuário**; **paginação no topo** com tamanho lembrado.
5. **Seleção em lote** com barra de ações e **menu ⋮** por linha; **pré-visualização em `Drawer`** (o componente já existe).
6. **Lista ↔ ficha** (split) com ‹ › e **Duplicar** em produtos, clientes e fornecedores.
7. **Dicas com link para a configuração** (o `Field.hint` já aceita ReactNode), contadores de caracteres e consulta CEP/CNPJ no campo.
8. **Telas vazias com orientação** (variante ilustrada de `EmptyState`), **teclas visíveis** (`kbd` nos botões) e **atalhos de teclado** (hook `useHotkeys`).
9. **Tema escuro e densidade** por usuário, com tokens semânticos.
10. Telas novas ou reorganizadas: **Visão financeira** em `/financeiro` (substitui o redirect), painel do gestor com “Precisa de atenção”, catálogo de relatórios e matriz de permissões com interruptores.

- **Vantagens:** corrige os problemas da auditoria e acrescenta produtividade sem perder densidade nem auditabilidade. Cada fase pode ser publicada e medida em separado. A identidade (azul-marinho #0f2147 + laranja, logotipo “I”) fica preservada e não há semelhança direta com o concorrente.
- **Desvantagens:** mais trabalho que A. O painel direito tira cerca de 196 px da área útil em telas de 1440 px (mitigado por ser recolhível e lembrado por usuário). O modo escuro exige migrar cerca de 1.660 classes de cor literais, por isso fica na última fase.
- **Impacto no código (arquivos reais):**

  | Área | Arquivos | Mudança |
  |---|---|---|
  | Tokens e tema | `src/app/globals.css`, `src/app/layout.tsx` | Tokens semânticos (`--color-surface/canvas/line/ink/muted` já existem; adicionar estados good/warn/bad/info/due e tom de borda), bloco `[data-theme="dark"]` + `prefers-color-scheme`, `@custom-variant dark`, Inter via `next/font`, `themeColor` por tema |
  | Shell | `src/components/shell/sidebar.tsx`, `nav.ts`, `global-search.tsx`, `unit-switcher.tsx`, `src/app/(app)/layout.tsx` | Grupos com `<details>` ou estado, favoritos, trilho, rodapé com tema e densidade; `nav.ts` ganha `short`, `description` e `shortcut`; a paleta usa `NAV` + registro de ações; unidade em duas linhas; faixa de demonstração vira chip; grade com coluna do painel direito |
  | Painel de atalhos (novo) | `src/components/shell/module-shortcuts.tsx` + `module-shortcuts.ts` | Mapa rota → seções; respeita `can`/`canDo` como o menu |
  | Listas | `ui/card.tsx` (`Stat` com `tone`/`active`), `ui/data-table.tsx` (paginação no topo, `rowTone`, seleção + `BulkBar`, `RowMenu`), `ui/filters.tsx` (recolher, chips, visão padrão), novos `ui/menu.tsx` e `ui/bulk-bar.tsx` | Mudanças compatíveis (props opcionais), sem quebrar as 38/35/62 telas que já usam |
  | Formulários | novos `ui/date-input.tsx` e `ui/action-bar.tsx`; `ui/form.tsx` (contador e ícone de ação no campo); `ui/empty.tsx` (variante ilustrada); novo `ui/kbd.tsx` + `lib/hotkeys.ts` | `DateInput` central nos filtros e progressivo nos 61 arquivos; `ActionBar` nos 10 formulários com barra `sticky` |
  | Telas reorganizadas | `(app)/dashboard`, `(app)/financeiro/page.tsx` (nova visão), `financeiro/pagar`, `financeiro/receber`, `(app)/estoque` + `estoque/movimentos`, `(app)/produtos/[id]`, `(app)/clientes/[id]`, `(app)/vendas`, `(app)/compras/pedidos`, `(app)/fiscal/nfe`, `(app)/relatorios/gerenciais`, `(app)/administracao/usuarios`, `(app)/pdv/pdv-app.tsx` (aviso de operador, letras dos meios) | Só apresentação; `queries.ts`, `actions.ts` e domínio não mudam |
  | Diálogos | 10 ocorrências de `window.confirm` (`action-form.tsx`, `pdv-app.tsx`, `variants-editor.tsx`, `nfe-wizard.tsx`, entre outras) | `Dialog` com motivo quando for o caso |

- **Navegação:** o menu fica igual em estrutura (mesmos 9 grupos e as mesmas permissões) e ganha recolhimento, favoritos, paleta e o painel de atalhos. Nenhuma rota existente muda; entra a rota `/financeiro` como página própria.
- **Produtividade:** alta. Menos cliques para ações frequentes (painel e teclas), menos rolagem (páginas mais curtas, filtros recolhidos), conferência sem sair da lista (`Drawer`), lote no financeiro e nos documentos, ‹ › nos cadastros.
- **Risco de regressão:** médio-baixo, desde que as mudanças nos componentes compartilhados sejam aditivas (props opcionais com o comportamento atual como padrão) e que cada fase passe por `vitest` + `playwright` (já configurados) e capturas comparativas nas mesmas 62 telas de `docs/evidencias`.
- **Complexidade:** média (estimativa: 6–8 semanas em 4 fases).

### 5.1 Quadro comparativo

| Critério | A — Evolução | B — Estrutura GDoor | C — Híbrida |
|---|---|---|---|
| Corrige os problemas da auditoria | Sim | Sim (reescrita) | Sim |
| Ganho de produtividade | Baixo | Alto, com curva de adaptação | Alto, sem perda de densidade |
| Preserva densidade e totais | Sim | Não | Sim |
| Identidade própria | Sim | Parcial (risco de parecer derivado) | Sim |
| Arquivos tocados | ~80 | ~200+ (quase todas as 142 páginas) | ~110 (fases independentes) |
| Mudança de navegação | Nenhuma | Total | Aditiva |
| Risco de regressão | Baixo | Alto | Médio-baixo |
| Complexidade e prazo estimado | Baixa · 3–4 sem. | Alta · 10–14 sem. | Média · 6–8 sem. |
| Modo escuro e celular | Opcional | Sim | Sim (fase 4) |

---

## 6. Recomendação justificada: opção C

1. **A base do Intercert é melhor que a do GDoor nos pontos estruturais**: tabelas com total e ordenação, estados independentes, auditoria visível, idempotência nos formulários e padrão de tela único. Trocar essa base (B) custaria caro e pioraria a análise de dados.
2. **Os ganhos do GDoor são padrões de interação**, não de estrutura (atalhos, ‹ ›, Duplicar, cores por prazo, filtros salvos, dicas com link, telas vazias, tema escuro). Eles entram como acréscimos nos componentes que já existem, com props opcionais, por isso o risco fica controlado.
3. **A opção A deixaria a principal diferença competitiva de fora.** Quem migra do GDoor espera teclas visíveis, navegação por registro e cores no financeiro; os protótipos mostram que isso cabe no visual do Intercert.

**Fases sugeridas (para autorização; nada foi executado):**

| Fase | Conteúdo | Telas do protótipo |
|---|---|---|
| 1. Correções e base | Problemas 1–13 da tabela 4.3, `DateInput`, `ActionBar`, Inter, tokens semânticos, aviso de simulação por tela | Todas |
| 2. Navegação | Menu recolhível, favoritos, rótulos, paleta Ctrl K, painel de atalhos, teclas | 2 e moldura de todas |
| 3. Listas e financeiro | `Stat` com tom, faixa de cor, filtros recolhidos com visão padrão, paginação no topo, seleção em lote, `Drawer` de pré-visualização, Visão financeira, Pagar, Receber, Estoque, Vendas, Compras, NF-e | 5–10, 12 |
| 4. Cadastros, análise e tema | Lista ↔ ficha (produto, cliente), Duplicar, painel com “Precisa de atenção”, relatórios, matriz de permissões, tema escuro e densidade, celular | 1, 3, 4, 13, 14 |

Critérios de aceite por fase:

- as mesmas capturas de `docs/evidencias` refeitas em 1440 × 900 e 400 px;
- nenhuma tabela cortando a coluna de ações;
- nenhuma barra cobrindo campos;
- datas em dd/mm/aaaa;
- painel e listas principais com até duas alturas de tela;
- `npm test` e `npm run e2e` verdes.

---

## 7. Diretrizes de identidade (o que não copiar)

- **Sem logotipo, imagem, cor de marca ou código do GDoor.** O laranja do Intercert é o já existente (#f2711c, accent), sempre como acento sobre o azul-marinho #0f2147 (theme-color atual); a marca “I” laranja + “Intercert ERP / Gestão inteligente para o varejo” vem de `docs/referencia/especificacao-telas.md`.
- O painel de atalhos, a lista ↔ ficha e as cores por prazo foram redesenhados com os componentes do Intercert: cartões com borda, selos arredondados, menu escuro e botões com relevo. Não reproduzem o menu claro, o botão flutuante, os campos sublinhados nem a tipografia arredondada do Gweb.
- As cores semânticas seguem o dicionário `STATUS` de `badge.tsx`: good, warn, bad e info, mais um tom novo, “vence hoje” (azul `due`). Assim os protótipos não criam um vocabulário paralelo.

---

## 8. Protótipos

- `prototipos/index.html`: arquivo único autocontido (~2,6 MB) com 14 telas. Cada tela tem as capturas real e de referência (data URI JPEG reduzida), o protótipo da opção C em HTML/CSS com dados de exemplo (R$, CNPJ/CPF fictícios, NCM, CFOP, CSOSN, cClassTrib) e as notas “o que muda e por quê” e “o que é preservado”.
- Interações de demonstração no protótipo:
  - tema automático, claro e escuro (no cabeçalho da página e no rodapé do menu);
  - densidade normal ou compacta;
  - painel de atalhos recolhível (»);
  - cartões que filtram as linhas em Estoque, Contas a pagar e Contas a receber;
  - grupos do menu recolhíveis;
  - chips de filtro removíveis.
- A moldura se adapta à própria largura: sem painel direito abaixo de 1040 px e sem menu lateral abaixo de 760 px (aparece o botão de menu).
- Verificado em Chromium a 1440, 1100 e 400 px, nos dois temas: sem rolagem horizontal da página e sem erros de script.
- `prototipos/README.md`: lista as capturas por tela, com a origem (arquivo em `docs/evidencias` e URL do artigo Gdoor).

## 9. Limitações

- As capturas do Intercert são todas desktop 1440 px; não há evidência real de uso em celular ou tablet, então as variações móveis são propostas não validadas.
- As referências GDoor vêm da documentação pública, com versões e datas variadas (2020–2026); não houve uso do produto.
- As estimativas de prazo são de ordem de grandeza, feitas a partir da contagem de arquivos, e não substituem um planejamento detalhado.
- Os protótipos são estáticos: não executam regras de negócio, e os números de exemplo foram conferidos só entre si (por exemplo, os totais de Pagar e Receber batem com a Visão financeira).
- Funções marcadas como “proposta” nos protótipos, como a leitura de código de barras de boleto e a comparação de perfis, não existem hoje no Intercert e dependem de implementação.
