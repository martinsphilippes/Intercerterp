# Intercert ERP — comércio e varejo

ERP web para lojas de varejo: PDV, vendas e caixa, produtos e estoque, clientes, financeiro e conciliação, compras, fiscal (NF-e, NFC-e, NFS-e), administração, suporte e análises.

- **Stack:** Next.js 15 (App Router, Server Actions) + TypeScript + Tailwind 4
- **Banco:** Postgres conectado ao projeto na Vercel (transações reais; tabelas criadas e atualizadas sozinhas)
- **Login:** próprio do ERP (senha com hash e sessões no banco) · **Arquivos:** Vercel Blob privado
- **Hospedagem:** Vercel (aplicação + Cron em `/api/jobs`) — banco, arquivos e aplicação na mesma conta (`docs/regras-assumidas.md` §48)
- **Referência funcional:** `docs/referencia/Intercert_ERP_48_Telas_Comentadas.pdf` e a especificação extraída em `docs/referencia/especificacao-telas.md`

**No ar:** https://intercerterp.vercel.app — instalável como aplicativo (PWA).

## Aplicativo (PWA)

- **Android (Chrome):** abra o site → menu ⋮ → *Instalar app* (ou o botão **Instalar app** no topo).
- **iPhone/iPad (Safari):** Compartilhar → *Adicionar à Tela de Início*.
- **Windows/macOS (Chrome/Edge):** ícone de instalação na barra de endereço ou o botão **Instalar app**.

O app abre em tela cheia, com atalhos para PDV, Painel, Produtos e Contas a receber. O service worker guarda só arquivos estáticos; dados e ações sempre passam pelo servidor (sem cópia local de dados da empresa). Sem conexão, aparece uma página informando que o ERP precisa de internet — o PDV não opera offline.

**Acesso rápido (ambiente de teste):** com `SHOW_DEMO_LOGIN=1`, a tela de login lista os usuários da empresa de demonstração por setor, com a senha e um botão “Entrar” de um clique. Só aparecem usuários marcados como demonstração (nunca contas reais nem o administrador geral). Remova a variável ao entrar em operação real.

**Não consigo entrar / a lista de acessos sumiu:** quase sempre é o banco. A tela de login mostra o aviso “Acesso bloqueado…” com o motivo (banco sem resposta, acesso recusado ou limite do plano), o caminho para liberar e o botão “Tentar novamente”, e mantém os acessos da demonstração listados (`docs/regras-assumidas.md` §47). No Postgres o banco adormece quando ocioso e acorda sozinho — não há reativação manual. Em instalação antiga no Appwrite Cloud gratuito, o projeto é pausado após 7 dias sem atividade no console dele e a cota mensal conta cada linha lida: foi o que motivou a saída do Appwrite (§48).

## Gestão contábil (escritórios de contabilidade)

Uma empresa pode ser criada como **escritório contábil** (Administração → Empresas → Nova empresa → tipo). O escritório tem menu próprio (`/contabil`): carteira de clientes contábeis (PF/PJ, sócios, estabelecimentos, regime com vigência, grupos), departamentos e responsáveis (carteira restrita por responsável), caixa de entrada de entregas e o financeiro/fiscal de serviços do próprio escritório. Vários escritórios convivem na mesma instalação sem se enxergar.

**Vínculo com empresas que usam o ERP:** o escritório emite um código de vínculo para o cliente; o administrador da empresa informa o código em Administração → Integrações → Área da contabilidade. Com o vínculo ativo, o escritório consulta a situação fiscal da empresa (somente leitura) e o pacote mensal de XMLs chega sozinho na caixa de entrada do escritório. Regras em `docs/regras-assumidas.md` §21; o que falta para o escopo completo está em `docs/analise-gestao-contabil.md`.

Telas do escritório: painel da carteira (`/contabil`), clientes (lista com filtros e exportação, cadastro com consulta de CNPJ, ficha 360° em abas: resumo, pessoas, estabelecimentos, regime, responsáveis, fiscal, entregas, histórico), grupos, departamentos e equipe, caixa de entrada (conferência, exportação e download auditado). Cobertura por tela: `docs/matriz-gestao-contabil.md`.

**Certificados digitais (Tela 67):** o escritório solicita certificados (e-CNPJ/e-CPF A1) para os clientes em `/contabil/certificados` — cobrança da Intercert separada da mensalidade (e-mail real ou envio manual identificado), confirmação de pagamento com referência, validação do titular, emissão com o arquivo .pfx, autorização do titular e download com confirmação de senha, tudo registrado por protocolo. A equipe de certificação atende em Administração → Certificação digital; a empresa vinculada autoriza acompanhamento e download em Integrações → Contabilidade. Regras em `docs/regras-assumidas.md` §22.

Na demonstração: escritório "Contábil Horizonte (DEMO)" com os usuários `contador` (sócio), `analista` (carteira restrita) e `certificacao` (equipe de certificação), 5 clientes, 4 solicitações de certificado em etapas diferentes (e um cliente com certificado a vencer, para a renovação), a loja de demonstração já vinculada e dois pacotes recebidos (fechamento do mês anterior e parcial do mês corrente).

## Instalação automatizada (sem a tela de primeiro acesso)

`GET /api/setup/run?step=<etapa>` com o `SETUP_TOKEN` (cabeçalho `x-setup-token` ou `?token=`), em etapas retomáveis: `provision` (tabelas, índices e bucket), `demo` (repita até `done: true`), `demo-update` (reaplica cenários de demonstração novos numa instalação já concluída, idempotente), `status` (contagens), `owner&email=…&name=…` (cria o administrador geral; a senha aparece uma única vez), `check-login&login=…&password=…` (testa a autenticação) e `finish` (encerra; depois disso a rota só aceita `provision` para migrações de esquema).

## Início rápido (desenvolvimento local, sem banco)

```bash
npm install
DATA_BACKEND=local npm run seed      # carrega a demonstração em .data/local
DATA_BACKEND=local npm run dev       # http://localhost:3000
```

Usuários da demonstração (senha `Intercert@2026`): `admin`, `gerente`, `caixa`, `estoque`, `financeiro`, `fiscal`, `diretoria`. A empresa de demonstração é identificada como **DEMO** em todas as telas; documentos fiscais e cobranças simuladas exibem o selo **SIMULAÇÃO** e nunca são apresentados como operação real.

Fuso horário: único por instalação (`APP_TIMEZONE`, padrão `America/Sao_Paulo`), usado em filtros por período, relatórios, rotinas e exibição.

## Com Postgres

1. Tenha um banco Postgres (o da Vercel, um local ou qualquer outro) e ponha o endereço em `.env.local` (veja `.env.example`):
   ```
   DATABASE_URL=postgres://usuario:senha@host:5432/banco
   ```
2. As tabelas, colunas e índices são criados sozinhos na primeira consulta de cada versão (só acrescenta). Para preparar antes: `npm run db:setup`.
3. Opcional — demonstração: `npm run seed` (ou `npm run seed -- --days=14`).
4. `npm run dev`.

Sem linha de comando, abra a aplicação publicada: a tela **/primeiro-acesso** detecta a instalação vazia e permite criar a empresa + administrador ou carregar a demonstração. Defina `SETUP_TOKEN` para proteger essa etapa.

## Publicação na Vercel

Banco, arquivos e aplicação ficam na mesma conta:

1. Vercel → projeto → *Settings → Git*: conecte o repositório do GitHub (deploy a cada push na branch principal).
2. Projeto → **Storage** → *Create Database* → **Postgres (Neon)** e conecte ao projeto: a conexão cria `DATABASE_URL`. Escolha a região mais perto dos usuários (São Paulo, se listada) e ponha as funções na mesma região.
3. Projeto → **Storage** → **Blob**, acesso **privado**, e conecte ao projeto: cria `BLOB_READ_WRITE_TOKEN` (XML, anexos e cópias de segurança).
4. *Settings → Environment Variables*: `CRON_SECRET`, `SETUP_TOKEN` e `AUTH_ENCRYPTION_KEY` (sensíveis; a última cifra o segredo da autenticação em duas etapas — §44), `APP_TIMEZONE=America/Sao_Paulo` e, conforme as integrações, `FOCUSNFE_TOKEN`, `NFCE_CSC`, `MERCADOPAGO_ACCESS_TOKEN`, `RESEND_API_KEY`.
5. Faça o deploy e abra `/primeiro-acesso` (informe o `SETUP_TOKEN`), ou use a instalação automatizada (`/api/setup/run`, acima): cria a empresa e o administrador, ou carrega a demonstração identificada.

Atualizações que mudam o esquema não pedem passo manual: a primeira consulta da nova versão cria o que falta.

O `vercel.json` agenda `/api/jobs` **uma vez por dia** (compatível com o plano Hobby, que só permite cron diário): rotinas diárias de notificações, obrigações, backup e retenção. As tarefas vencidas (retentativas de efeitos de venda, envio/consulta fiscal, e-mails) também rodam **em segundo plano depois de cada ação de usuário** (sem atrasar a tela, com reivindicação única por tentativa) e pela Central de tarefas. `/api/keepalive` (também diário) é o monitor do banco: fora do ar, sem acesso ou limitado pelo plano fica registrado nos logs.

Sem banco conectado, a aplicação mostra a página **“configuração pendente”** com o que falta (nenhum dado é gravado). Somente para apresentação, `DATA_BACKEND=memory` sobe uma demonstração volátil (recriada a cada reinício e sem consistência entre instâncias).

**Instalação antiga no Appwrite:** continua funcionando enquanto as variáveis `APPWRITE_*` existirem e não houver `DATABASE_URL` (o Postgres tem prioridade). `npm run appwrite:setup` provisiona o esquema lá. O caminho de saída está em `docs/regras-assumidas.md` §48.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | Verificação de tipos |
| `npm run lint` | ESLint |
| `npm test` | Testes de regras de negócio (vitest, banco em memória) |
| `TEST_STORE=postgres npm test` | A mesma suíte sobre o Postgres (embutido; com `TEST_PG_URL=postgres://…`, num servidor de verdade pelo cliente de produção) |
| `npm run db:setup` | Cria no Postgres o que falta do esquema (o sistema também faz sozinho) |
| `npm run appwrite:setup` | Provisiona o esquema no Appwrite (instalações antigas) |
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
