# Registro de progresso

Arquivo para retomar a execução do ponto exato em outra sessão.

## Concluído
- [x] Base: esquema único (~75 tabelas), `Store` Appwrite/memória (modo `deferred` com semântica do Appwrite), provisionamento idempotente (`npm run appwrite:setup` e `/primeiro-acesso`), testado em Appwrite 1.8 local.
- [x] Todos os módulos do PDF: acesso, vendas e caixa (PDV), produtos e estoque, clientes, financeiro e conciliação, compras/cotação/reposição/aprovação, fiscal (NF-e, NFC-e, NFS-e), administração, suporte, notificações, backup, painel, gerenciais, curva ABC e metas.
- [x] Seed de demonstração repetível e identificada (empresa DEMO, duas filiais, terminais, perfis, histórico e cenários do dia).
- [x] Isolamento por empresa no acesso a dados (`ScopedStore`), contexto consolidado restrito, rotas `/api` com contexto completo.
- [x] Revisão adversarial (93 confirmados + 21 baixos) → correções → verificação independente (44 itens) → 2ª rodada de correções → revisão final.
- [x] Testes: suíte completa nos modos imediato e `deferred`; tsc, lint e build limpos.
- [x] Varredura de navegação (230 páginas, 0 problemas) e 62 evidências (48 telas + 14 visões).
- [x] Documentação: README, arquitetura, matriz de cobertura (gerada), regras assumidas, integrações, validação, pendências externas.

- [x] Publicado: https://intercerterp.vercel.app (Vercel, região fra1, acesso público) com Appwrite Cloud (fra) provisionado — 83 tabelas, bucket único, demonstração carregada e administrador geral criado pela instalação em etapas (`/api/setup/run`, encerrada com `step=finish`).
- [x] PWA: manifesto, ícones (inclusive maskable e Apple), service worker (estáticos em cache, dados sempre pela rede, página offline), botão “Instalar app” e atalhos (PDV, Painel, Produtos, Receber).

## Gestão contábil — Fase 0 (fundação) · 06/10/2026
- [x] Decisões do dono: produto para vários escritórios; cliente contábil é cadastro próprio do escritório, com vínculo opcional à empresa que usa o ERP (XMLs e situação fiscal chegam sozinhos); infraestrutura paga depois.
- [x] Núcleo: `companies.kind` (retail | accounting), 9 tabelas novas, módulo `accounting` + ações, perfis do escritório, parametrização enxuta, menu e painel por tipo de empresa.
- [x] Domínio (`src/domain/accounting`): clientes PF/PJ com consulta de CNPJ ampliada (CNAEs, natureza, porte, QSA), situação com transições, regime com vigência, pessoas, estabelecimentos, grupos, departamentos/membros/responsáveis, carteira restrita por responsável, código de vínculo + aceite pela empresa (consentimento), leitura somente-consulta da empresa vinculada, entrega automática do pacote mensal na caixa de entrada, download por entrega.
- [x] Testes: `tests/accounting.test.ts` (12 cenários: parametrização, unicidade por escritório, isolamento entre escritórios, regime com vigência, transições, sócios ≤100%, raiz do CNPJ, carteira restrita, código/aceite/revogação, somente leitura, entrega idempotente e obrigação concluída).
- [x] Produção: 92 tabelas provisionadas; escritório de demonstração carregado (`step=demo-update`), usuários `contador`/`analista` no acesso rápido. Telas publicadas em `0f02b4e` (deploy READY); `demo-update` reaplicado entregou o pacote parcial do mês corrente (58 XML) na caixa de entrada; sem erros nos logs de execução. A varredura autenticada em produção não roda do ambiente de build (política de rede bloqueia o domínio da Vercel): verificação final pelo acesso rápido como `contador`/`analista`.
- [x] Telas `/contabil` (painel, clientes com filtros/exportação, cadastro com consulta de CNPJ, 360° em abas, grupos, departamentos e equipe, caixa de entrada com conferência/exportação) e cartão de vínculo em Integrações → Contabilidade (lado da empresa). Cinco frentes paralelas + revisores independentes no navegador; correções transversais: `isConflict`/`isNotFound` por nome, filtros "sem responsável"/"sem grupo", responsável com atribuições, consulta de CNPJ na edição, mensagens com rótulos, página não encontrado em português.
- [x] tsc, lint, suíte completa (392 testes × 2 modos), build de produção e varredura com build de produção em memória: admin 230 páginas/140 padrões, contador 138/95, analista 74/64 — 0 problemas, 0 erros de console, 14 rotas `/contabil` por perfil. Matriz: `docs/matriz-gestao-contabil.md`.
- Próximas fases (ver `docs/analise-gestao-contabil.md`): 1 obrigações da carteira, trabalhos recorrentes, revisão, documentos; 2 contratos, honorários, NFS-e, cobrança; 3 portal do cliente e atendimento com SLA; 4 horas, rentabilidade, comercial; 5 BPO, regularidade, migração, IA.

## Pendente (depende de terceiros)
- Credenciais dos provedores (Focus NFe, Mercado Pago, e-mail, TEF, banco).

## Como retomar
1. `npm install` · `npm test` · `MEMORY_TX_MODE=deferred npm test` · `npx tsc --noEmit` · `npx next lint`.
2. Appwrite local (opcional): variáveis em `.env.local`, `npm run appwrite:setup`, `npm run seed`.
3. `npm run build && npm start` · `node scripts/dev/crawl.mjs` · `node scripts/dev/evidence.mjs` · `node scripts/docs/build-matrix.mjs`.
