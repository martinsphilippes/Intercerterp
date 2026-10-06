# Arquitetura e convenções — Intercert ERP

## Stack (decisão de implementação)

| Camada | Escolha | Motivo |
|---|---|---|
| Aplicação | Next.js 15 (App Router) + TypeScript + Tailwind 4 | SSR/Server Actions, deploy nativo na Vercel |
| Banco e autenticação | **Appwrite** (TablesDB + Auth + Storage) | Infra do cliente; transações, índices únicos e incrementos atômicos com limite |
| Hospedagem | **Vercel** (app + Cron em `/api/jobs`) | Infra do cliente |
| Repositório | **GitHub** | Infra do cliente |
| Dev/testes | Armazenamento local (arquivo/memória) com a **mesma interface** do Appwrite | Testes rápidos e determinísticos |

Monólito modular: um modelo de dados (`src/lib/db/schema.ts`), serviços de domínio compartilhados (`src/domain`), telas em `src/app/(app)`.

## Camada de dados (`src/lib/db`)

- `Store` (interface) — `get`, `list`, `create`, `update`, `delete`, `increment(min/max)`, `transaction`.
- `AppwriteStore` (produção) e `MemoryStore` (dev/testes; `.data/local` quando `DATA_BACKEND=local`).
- **Esquema único** em `schema.ts` → `npm run appwrite:setup` provisiona tabelas/colunas/índices/buckets.
- Tipos: dinheiro em **centavos** (`money`), quantidade em **milésimos** (`qty`, 1 un = 1000), percentuais em **pontos-base** (`…Bps`, 1% = 100), datas de calendário `AAAA-MM-DD`, instantes ISO UTC, JSON serializado.
- Filtros: `["eq", campo, valor|valores]`, `["contains", "searchText", termo]`, `["between", …]`, `["or", [...]]` etc. Campos `id/createdAt/updatedAt` mapeiam para `$id/$createdAt/$updatedAt` no Appwrite.

## Consistência e concorrência

- **Idempotência por chave**: cada efeito recebe id determinístico `detId(...)`. Repetir uma operação (duplo clique, retentativa) encontra o registro existente em vez de duplicar. Formulários enviam `_idem` estável (`ActionForm`).
- **Sequência por agregado**: movimentos de estoque `(balanceId, seq)`, lançamentos em conta `(accountId, seq)` e baixas `(installmentId, seq)` têm índice único. Duas operações concorrentes sobre o mesmo saldo geram conflito → `retryOnConflict` relê e reaplica. Nenhuma baixa dupla do mesmo saldo nem consumo duplo de estoque.
- **Limites atômicos**: `increment(..., {min/max})` impede devolução acima do vendido e saldo negativo de vale/título.
- **Transações Appwrite** (máx. 100 operações): venda, baixa, estorno, transferência etc. gravam documento + efeitos juntos. Efeitos volumosos (estoque da venda) vão por tarefa durável idempotente.
- **Outbox** (`jobs`): emissão/consulta fiscal, efeitos da venda, notificações e rotinas. Executor em `/api/jobs` (Vercel Cron diário) e em segundo plano após cada ação de usuário (`after()`, a cada 30 s no máximo por instância), com reivindicação única por tentativa, recuo exponencial e limite geral de reagendamentos.

## Serviços de domínio (`src/domain`)

| Arquivo | Responsabilidade |
|---|---|
| `stock.ts` | movimentos, saldo físico/reservado/trânsito, custo médio ponderado |
| `finance.ts` | títulos, parcelas, baixa, estorno, lançamentos em conta, transferências |
| `cash.ts` | sessões de caixa, suprimento/sangria, fechamento, reabertura |
| `sales.ts` | venda (PDV), cancelamento, devolução/troca, vale-crédito |
| `pricing.ts` / `pricing-calc.ts` | resolução de preço (tabela/filial/vigência/atacado) e cálculo puro de totais e rateio |
| `payments/*` | contrato de Pix (Mercado Pago + simulação) e intenções |
| `fiscal/*` | documentos NF-e/NFC-e/NFS-e, provedor Focus NFe + simulação, eventos |
| `integrations.ts` | central de integrações (estados medidos, segredos por referência) |
| `customers.ts` | clientes (identidade única por CPF/CNPJ) |

Toda função de domínio recebe `ctx: Ctx` (`store`, `user`, `companyId`, `branchId`). Operações transacionais exigem filial (`requireBranch`); o contexto consolidado é somente consulta.

## Padrão de tela (referência: `src/app/(app)/clientes`)

- `page.tsx` (Server Component): `requireSession(módulo)`, lê `searchParams`, chama a consulta de `queries.ts`, renderiza `PageHeader` + `FilterBar` + `DataTable` (+ `Stat`).
- `queries.ts`: consulta única reutilizada pela tela **e** pela exportação (`src/exports/<área>.ts` com `defineExport`).
- `actions.ts` (`"use server"`): `runAction({ module, op, revalidate }, async (s) => …)` + funções de domínio. Retorne `{ ok: true, message, redirect }` quando quiser mensagem/redirecionamento.
- Formulários: `ActionForm` (client) — idempotência, bloqueio de duplo envio, mensagens de erro de regra.
- Detalhes: abas por URL (`LinkTabs`), `DefinitionList`, `Timeline` (eventos reais de `audit_logs`, incluindo relacionados via `related: ["tipo:id"]`).
- Estados: `StatusBadge kind=… status=…` (dicionário central em `components/ui/badge.tsx`); documentos/cobranças simuladas exibem `SimBadge`.
- Valores: `formatMoney`, `formatQty`, `formatDate`, `formatDateTime`; entradas `MoneyInput`/`QtyInput` enviam centavos/milésimos.

## Auditoria e notificações

- `audit(ctx, {...})` em toda alteração relevante (antes/depois saneados, sem segredos).
- `notify(store, {..., occurrenceKey, audience})` cria notificações por destinatário; `resolveOccurrence` marca a origem resolvida. Ler a notificação **não** resolve a ocorrência.

## Extensões por módulo

- Demonstração: `src/domain/seed/modules/<área>.ts` (idempotente).
- Rotinas diárias: `src/domain/routines/<área>.ts` (`registerRoutine`).
- Tarefas duráveis: `src/domain/jobs/<área>.ts` (`registerJob`).
- Exportações: `src/exports/<área>.ts` (`defineExport`).
