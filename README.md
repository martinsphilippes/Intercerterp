# Intercert ERP — comércio e varejo

ERP web para lojas de varejo: PDV, vendas e caixa, produtos e estoque, clientes, financeiro e conciliação, compras, fiscal (NF-e, NFC-e, NFS-e), administração, suporte e análises.

- **Stack:** Next.js 15 (App Router, Server Actions) + TypeScript + Tailwind 4
- **Banco, autenticação e arquivos:** Appwrite (TablesDB com transações, Auth, Storage)
- **Hospedagem:** Vercel (aplicação + Cron em `/api/jobs`)
- **Referência funcional:** `docs/referencia/Intercert_ERP_48_Telas_Comentadas.pdf` e a especificação extraída em `docs/referencia/especificacao-telas.md`

## Início rápido (desenvolvimento local, sem Appwrite)

```bash
npm install
DATA_BACKEND=local npm run seed      # carrega a demonstração em .data/local
DATA_BACKEND=local npm run dev       # http://localhost:3000
```

Usuários da demonstração (senha `Intercert@2026`): `admin`, `gerente`, `caixa`, `estoque`, `financeiro`, `fiscal`, `diretoria`.

## Com Appwrite

1. Crie um projeto no Appwrite (Cloud ou self-hosted ≥ 1.8) e uma **API key** com escopos de databases/tables/rows/columns/indexes, users, sessions, buckets/files (e messaging, se usar e-mail pelo Appwrite).
2. Configure `.env.local` (veja `.env.example`):
   ```
   APPWRITE_ENDPOINT=https://<região>.cloud.appwrite.io/v1
   APPWRITE_PROJECT_ID=...
   APPWRITE_API_KEY=...
   APPWRITE_DATABASE_ID=intercert
   ```
3. Provisione tabelas, colunas, índices e buckets (idempotente; rode de novo após atualizações):
   ```bash
   npm run appwrite:setup
   ```
4. Opcional — demonstração: `npm run seed` (ou `npm run seed -- --days=14`).
5. `npm run dev`.

Sem acesso de linha de comando ao Appwrite, abra a aplicação publicada: a tela **/primeiro-acesso** detecta o banco vazio, provisiona as tabelas pelo próprio servidor (retomável) e permite criar a empresa + administrador ou carregar a demonstração. Defina `SETUP_TOKEN` para proteger essa etapa.

## Publicação na Vercel

Variáveis do projeto: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` (sensível), `APPWRITE_DATABASE_ID`, `CRON_SECRET`, `SETUP_TOKEN`, `APP_TIMEZONE=America/Sao_Paulo` e, conforme integrações, `FOCUSNFE_TOKEN`, `NFCE_CSC`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`.
O `vercel.json` agenda `/api/jobs` (tarefas fiscais, efeitos de venda, rotinas diárias de notificações e backup). Em plano sem cron frequente, a Central de integrações oferece “Executar tarefas pendentes agora”.

Sem variáveis do Appwrite na Vercel, a aplicação sobe em **modo memória** (demonstração volátil, recriada a cada reinício e sem consistência entre instâncias) — apenas para visualização.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | Verificação de tipos |
| `npm run lint` | ESLint |
| `npm test` | Testes de regras de negócio (vitest, banco em memória) |
| `npm run appwrite:setup` | Provisiona o esquema no Appwrite |
| `npm run seed` | Carrega a demonstração (repetível, sem duplicar) |
| `npm run jobs` | Executa tarefas pendentes e rotinas (equivalente ao cron) |
| `npm run e2e` | Testes de navegador (Playwright) |

## Documentação

- `docs/arquitetura.md` — camadas, consistência, idempotência, padrões de tela
- `docs/matriz-cobertura.md` — 48 telas + 14 visões: página do PDF, rota, situação e evidência
- `docs/regras-assumidas.md` — cálculos, estados e políticas iniciais
- `docs/integracoes.md` — provedores, configuração e resultado real dos testes
- `docs/validacao.md` — cenários executados e resultados
- `docs/pendencias-externas.md` — dependências externas restantes
- `docs/progresso.md` — registro para retomar o trabalho
