# Registro de progresso

Arquivo para retomar a execução do ponto exato em outra sessão.

## Concluído
- [x] Base: esquema único (≈70 tabelas), `Store` Appwrite/local, provisionamento Appwrite (`npm run appwrite:setup`) testado em Appwrite 1.8 local.
- [x] Domínio: estoque, financeiro, caixa, vendas (venda/cancelamento/devolução/troca/vale), preços, Pix (Mercado Pago + simulação), fiscal (Focus NFe + simulação), integrações, clientes.
- [x] Seed de demonstração repetível (empresa DEMO, 2 filiais, 7 usuários/perfis, catálogo com variações, histórico de vendas, cenários do dia) — testado em memória e no Appwrite.
- [x] Shell: login (Appwrite Auth), recuperação, convite, primeiro acesso, seleção de unidade, navegação, pesquisa global, exportação CSV, executor de tarefas.
- [x] Módulo de referência: Clientes (telas 20–21).

## Em andamento
- Módulos em paralelo: PDV/vendas/caixa · produtos/estoque · financeiro · compras · fiscal/integrações · administração/suporte · painéis/relatórios.

## Pendências conhecidas
- Ver `docs/pendencias-externas.md` ao final.
