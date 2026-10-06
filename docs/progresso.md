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

## Pendente (depende de terceiros)
- Publicação na Vercel conectada ao Appwrite Cloud: falta Endpoint e Project ID do projeto Appwrite (ver `docs/pendencias-externas.md`).
- Credenciais dos provedores (Focus NFe, Mercado Pago, e-mail, TEF, banco).

## Como retomar
1. `npm install` · `npm test` · `MEMORY_TX_MODE=deferred npm test` · `npx tsc --noEmit` · `npx next lint`.
2. Appwrite local (opcional): variáveis em `.env.local`, `npm run appwrite:setup`, `npm run seed`.
3. `npm run build && npm start` · `node scripts/dev/crawl.mjs` · `node scripts/dev/evidence.mjs` · `node scripts/docs/build-matrix.mjs`.
