# Intercert ERP — comércio e varejo

ERP web para lojas de varejo: PDV, vendas e caixa, produtos e estoque, clientes, financeiro e conciliação, compras, fiscal (NF-e, NFC-e, NFS-e), administração, suporte e análises.

- **Stack:** Next.js 15 (App Router, Server Actions) + TypeScript + Tailwind 4
- **Banco, autenticação e arquivos:** Appwrite (TablesDB com transações, Auth, Storage)
- **Hospedagem:** Vercel (aplicação + Cron em `/api/jobs`)
- **Referência funcional:** `docs/referencia/Intercert_ERP_48_Telas_Comentadas.pdf` e a especificação extraída em `docs/referencia/especificacao-telas.md`

**No ar:** https://intercerterp.vercel.app — instalável como aplicativo (PWA).

## Aplicativo (PWA)

- **Android (Chrome):** abra o site → menu ⋮ → *Instalar app* (ou o botão **Instalar app** no topo).
- **iPhone/iPad (Safari):** Compartilhar → *Adicionar à Tela de Início*.
- **Windows/macOS (Chrome/Edge):** ícone de instalação na barra de endereço ou o botão **Instalar app**.

O app abre em tela cheia, com atalhos para PDV, Painel, Produtos e Contas a receber. O service worker guarda só arquivos estáticos; dados e ações sempre passam pelo servidor (sem cópia local de dados da empresa). Sem conexão, aparece uma página informando que o ERP precisa de internet — o PDV não opera offline.

**Acesso rápido (ambiente de teste):** com `SHOW_DEMO_LOGIN=1`, a tela de login lista os usuários da empresa de demonstração por setor, com a senha e um botão “Entrar” de um clique. Só aparecem usuários marcados como demonstração (nunca contas reais nem o administrador geral). Remova a variável ao entrar em operação real.

## Gestão contábil (escritórios de contabilidade)

Uma empresa pode ser criada como **escritório contábil** (Administração → Empresas → Nova empresa → tipo). O escritório tem menu próprio (`/contabil`): carteira de clientes contábeis (PF/PJ, sócios, estabelecimentos, regime com vigência, grupos), departamentos e responsáveis (carteira restrita por responsável), caixa de entrada de entregas e o financeiro/fiscal de serviços do próprio escritório. Vários escritórios convivem na mesma instalação sem se enxergar.

**Vínculo com empresas que usam o ERP:** o escritório emite um código de vínculo para o cliente; o administrador da empresa informa o código em Administração → Integrações → Área da contabilidade. Com o vínculo ativo, o escritório consulta a situação fiscal da empresa (somente leitura) e o pacote mensal de XMLs chega sozinho na caixa de entrada do escritório. Regras em `docs/regras-assumidas.md` §21; o que falta para o escopo completo está em `docs/analise-gestao-contabil.md`.

Telas do escritório: painel da carteira (`/contabil`), clientes (lista com filtros e exportação, cadastro com consulta de CNPJ, ficha 360° em abas: resumo, pessoas, estabelecimentos, regime, responsáveis, fiscal, entregas, histórico), grupos, departamentos e equipe, caixa de entrada (conferência, exportação e download auditado). Cobertura por tela: `docs/matriz-gestao-contabil.md`.

Na demonstração: escritório "Contábil Horizonte (DEMO)" com os usuários `contador` (sócio) e `analista` (carteira restrita), 4 clientes, a loja de demonstração já vinculada e dois pacotes recebidos (fechamento do mês anterior e parcial do mês corrente).

## Instalação automatizada (sem a tela de primeiro acesso)

`GET /api/setup/run?step=<etapa>` com o `SETUP_TOKEN` (cabeçalho `x-setup-token` ou `?token=`), em etapas retomáveis: `provision` (tabelas, índices e bucket), `demo` (repita até `done: true`), `demo-update` (reaplica cenários de demonstração novos numa instalação já concluída, idempotente), `status` (contagens), `owner&email=…&name=…` (cria o administrador geral; a senha aparece uma única vez), `check-login&login=…&password=…` (testa a autenticação) e `finish` (encerra; depois disso a rota só aceita `provision` para migrações de esquema).

## Início rápido (desenvolvimento local, sem Appwrite)

```bash
npm install
DATA_BACKEND=local npm run seed      # carrega a demonstração em .data/local
DATA_BACKEND=local npm run dev       # http://localhost:3000
```

Usuários da demonstração (senha `Intercert@2026`): `admin`, `gerente`, `caixa`, `estoque`, `financeiro`, `fiscal`, `diretoria`. A empresa de demonstração é identificada como **DEMO** em todas as telas; documentos fiscais e cobranças simuladas exibem o selo **SIMULAÇÃO** e nunca são apresentados como operação real.

Fuso horário: único por instalação (`APP_TIMEZONE`, padrão `America/Sao_Paulo`), usado em filtros por período, relatórios, rotinas e exibição.

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

Variáveis do projeto: `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` (sensível), `APPWRITE_DATABASE_ID`, `APPWRITE_BUCKET_ID` (opcional; um único bucket para todos os arquivos, necessário no plano gratuito do Appwrite), `CRON_SECRET`, `SETUP_TOKEN`, `APP_TIMEZONE=America/Sao_Paulo` e, conforme integrações, `FOCUSNFE_TOKEN`, `NFCE_CSC`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`.
O `vercel.json` agenda `/api/jobs` **uma vez por dia** (compatível com o plano Hobby, que só permite cron diário): rotinas diárias de notificações, obrigações, backup e retenção. As tarefas vencidas (retentativas de efeitos de venda, envio/consulta fiscal, e-mails) também rodam **em segundo plano depois de cada ação de usuário** (sem atrasar a tela, com reivindicação única por tentativa) e pela Central de integrações (“Executar tarefas pendentes agora”). No plano Pro, o cron pode ser mais frequente (ex.: `*/10 * * * *`).

Sem as variáveis do Appwrite na Vercel, a aplicação mostra a página **“configuração pendente”** com a lista do que falta (nenhum dado é gravado). Somente para apresentação, `DATA_BACKEND=memory` sobe uma demonstração volátil (recriada a cada reinício e sem consistência entre instâncias).

Passo a passo:
1. Vercel → projeto → *Settings → Git*: conecte o repositório do GitHub (deploy a cada push na branch principal).
2. *Settings → Environment Variables*: cadastre as variáveis acima (marque `APPWRITE_API_KEY`, `CRON_SECRET` e `SETUP_TOKEN` como *Sensitive*).
3. Faça o deploy e abra `/primeiro-acesso` (informe o `SETUP_TOKEN`): o servidor provisiona as tabelas no Appwrite (retomável) e cria a empresa e o administrador, ou carrega a demonstração identificada.
4. Em atualizações que mudam o esquema, rode `npm run appwrite:setup` (ou reabra `/primeiro-acesso` — o provisionamento é idempotente e só cria o que falta).

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
| `MEMORY_TX_MODE=deferred npm test` | Mesmos testes com a semântica de transação do Appwrite (escritas visíveis só no commit, máx. 100 operações) |
| `node scripts/dev/crawl.mjs` | Varredura de navegação: login real, todos os links internos, erros de página/console e telas de erro |
| `node scripts/dev/evidence.mjs` | Captura as evidências de interface (48 telas + 14 visões) em `docs/evidencias/` |
| `node scripts/docs/build-matrix.mjs` | Regenera `docs/matriz-cobertura.md` a partir de `scripts/docs/coverage-map.json` |

## Documentação

- `docs/arquitetura.md` — camadas, consistência, idempotência, padrões de tela
- `docs/matriz-cobertura.md` — 48 telas + 14 visões: página do PDF, rota, situação e evidência
- `docs/regras-assumidas.md` — cálculos, estados e políticas iniciais
- `docs/integracoes.md` — provedores, configuração e resultado real dos testes
- `docs/validacao.md` — cenários executados e resultados
- `docs/pendencias-externas.md` — dependências externas restantes
- `docs/progresso.md` — registro para retomar o trabalho
