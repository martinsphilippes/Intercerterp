# Homologação multiempresa — isolamento entre duas contratantes

> **Teste automatizado:** `tests/multiempresa-homologacao.test.ts` (Vitest). **Estado:** branch `claude/eager-tesla-oark2w`,
> 26/11/2026, isolamento em modo `estrito` (`MULTIEMPRESA_ISOLAMENTO`, padrão). Este documento é gerado a partir dos
> resultados reais do teste nos dois armazenamentos (memória e Postgres embutido) — §8 explica como regenerar. A
> verificação no ambiente publicado (HTTP, telas e cookies reais) está em `homologacao-previa.md`.

## 1. Objetivo

Comprovar, com duas empresas contratantes **fictícias** implantadas pelo mesmo caminho que o Interos usa em produção,
que:

1. cada empresa opera normalmente os fluxos principais do ERP (regressão): PDV, venda, devolução, estoque, compras,
   financeiro e fiscal (em simulação), além de arquivo, notificação, integração, tarefa, cópia de segurança e loja virtual;
2. **nenhuma empresa alcança a outra**: toda tentativa de ler, alterar, excluir, listar, pesquisar, relatar, exportar,
   baixar ou referenciar registros da outra empresa é recusada ou devolve só os dados da própria empresa, **sem nenhum valor
   da outra** (nome, documento, e-mail, inscrição estadual, identificador de registro) — nem no resultado, nem na mensagem
   de erro;
3. depois de todas as tentativas, **os registros da empresa-alvo continuam idênticos** (comparação registro a registro);
4. o usuário restrito a uma filial e a um perfil de vendedor não vê a outra filial onde a filial restringe e não executa
   operações fora do perfil.

## 2. As duas empresas fictícias

Os dados são inventados; CNPJ e CPF têm dígitos verificadores válidos e os e-mails usam o domínio reservado `.example`.

| Item | Empresa A — Alfa Utilidades | Empresa B — Bravo Calçados |
|---|---|---|
| Conta do Interos | `conta-homolog-alfa-0001` | `conta-homolog-bravo-0002` |
| Razão social | Alfa Utilidades Domésticas Homologação Ltda | Bravo Calçados e Acessórios Homologação Ltda |
| CNPJ (matriz) / IE | 12.345.678/0001-95 / 110.042.490.114 | 98.765.432/0001-98 / 062.307.904.0081 |
| Endereço | Av. Paulista, 1000 — São Paulo/SP | Av. Afonso Pena, 500 — Belo Horizonte/MG |
| Unidade inicial (pela API) | 01 — Alfa — Paulista (Matriz) | 01 — Bravo — Savassi (Matriz) |
| Segunda filial (pela tela de filiais) | 02 — Alfa — Moema (12.345.678/0002-76) | 02 — Bravo — Pampulha (98.765.432/0002-79) |
| Módulos contratados | PDV, vendas, estoque, compras, financeiro, fiscal, **relatórios**, comércio digital | PDV, vendas, estoque, compras, financeiro, fiscal, comércio digital (**sem relatórios**) |
| Administrador (convite aceito) | Ana Alfa — ana.admin@alfa-homolog.example | Bruno Bravo — bruno.admin@bravo-homolog.example |
| Perfil restrito (criado na empresa) | "Vendedor de loja (Alfa Utilidades)": painel, PDV, vendas (ver/criar), caixa, clientes, produtos (ver) e "Registrar devolução" | "Vendedor de loja (Bravo Calçados)": o mesmo desenho |
| Usuário restrito | Vitor Vendedor Alfa — só a Matriz | Vera Vendedora Bravo — só a Matriz |
| Produtos | Panela Alfa Inox 20cm (R$ 99,90) e Chaleira Alfa Esmaltada (R$ 79,90) | Tênis Bravo Corrida 42 (R$ 299,90) e Sandália Bravo Couro 38 (R$ 159,90) |
| Clientes | Carla Cliente Alfa (CPF 123.123.123-87), Comercial Cliente Alfa Ltda (77.788.899/0001-83), Cliente Compartilhado Alfa | Diego Cliente Bravo (CPF 456.456.456-00), Distribuidora Cliente Bravo Ltda (22.233.344/0001-83), Cliente Compartilhado Bravo |
| Fornecedor | Fornecedora Alfa Metais Ltda (11.122.233/0001-83) | Fornecedora Bravo Couros Ltda (44.455.566/0001-83) |
| Credencial de e-mail (nome da variável) | `RESEND_API_KEY_LOJA_0001` | `RESEND_API_KEY_LOJA_0002` |
| Loja virtual | Loja Alfa Utilidades (`/loja/loja-alfa-utilidades`) | Loja Bravo Calçados (`/loja/loja-bravo-calcados`) |

**Coincidências deliberadas** (para provar que a unicidade é por empresa e que a busca nunca cruza): o **mesmo CPF**
(529.982.247-25) é cliente nas duas empresas, o **mesmo código de barras** (7891234567895) está no primeiro produto das
duas, e as duas começam a numeração do zero (produto `000001`, venda nº 1, NFC-e nº 1, título nº 1…).

## 3. Como a homologação funciona

### 3.1 Implantação pelo contrato real

As empresas são criadas chamando os **handlers reais** de `POST /api/interos/v1/empresas` (credencial de serviço de teste,
`Idempotency-Key`, e-mail simulado — o mesmo padrão de `tests/interos-provisionamento.test.ts`). O convite do
administrador é aceito com `acceptInvite` (token = último trecho de `convite.link`). Tudo o mais é feito **pela empresa**,
com as funções de domínio que as telas usam: segunda filial (`createBranch`), perfil (`createRole`), usuário com senha e
filial por empresa (`createUser` com `companyBranchIds`), terminais, grupo tributário, configuração fiscal em simulação,
produtos, clientes, fornecedor, estoque etc.

### 3.2 Contexto igual ao da sessão

Cada chamada roda com o mesmo contexto que a sessão monta: `{ store: scopeStore(store, empresa.id, { platform }),
companyId, branchId, user: toCtxUser(store, usuário, empresa.id) }` (como `ctxFor` em `tests/multiempresa-vinculos.test.ts`).
Para as funções que recebem a sessão (exportações), a sessão é composta como em `getSession` (`accessibleUnits` +
`toCtxUser` + Store restrito), **sem cookie** — a camada HTTP fica para o roteiro da prévia (§7;
`homologacao-previa.md`, roteiro `scripts/interos/homologacao-previa.mjs`).

### 3.3 O que conta como vazamento

Cada tentativa da matriz é executada e o retorno é conferido automaticamente:

- **marcadores de texto** da empresa-alvo: o nome (`alfa`/`bravo`, sem diferenciar maiúsculas — inclui endereços da loja,
  domínio dos e-mails e nomes de produtos, clientes, filiais), os CNPJs da matriz e da filial, os CPFs/CNPJs exclusivos de
  clientes e fornecedor e as inscrições estaduais. Valem para o resultado **e** para a mensagem de erro;
- **registros da empresa-alvo**: qualquer objeto com o `id` de um registro dela (`"id":"…"`; o id que a própria tentativa
  informou — como filtro, escopo ou na auditoria da tentativa — não é dado da outra empresa);
- a recusa precisa ser **deliberada** (regra de negócio, permissão ou registro inexistente): erro de programação
  (`TypeError`, `ReferenceError`…) no caminho reprova a linha;
- linhas "só dados da própria empresa" conferem também, quando faz sentido, que os dados da própria empresa **estão**
  lá (a ausência da outra não é vazia por acaso).

### 3.4 Integridade da empresa-alvo

Antes da matriz de cada sentido é tirada uma **fotografia completa** da empresa-alvo: todos os registros de todas as
coleções com `companyId`, os usuários vinculados, o cadastro da empresa e os numeradores (`counters`) cuja chave contém o
id da empresa ou de qualquer registro dela (filial, terminal, sessão de caixa). Depois de todas as tentativas a fotografia
é refeita e comparada **registro a registro** (conteúdo serializado idêntico, nenhum registro novo ou removido). Na
execução: 258 registros da Bravo e 264 da Alfa.

As tentativas barradas pelo Store restrito também precisam aparecer em `tenancy_violations` (trilha da plataforma),
registradas em modo `estrito`.

### 3.5 A homologação detecta a falta de isolamento

Prova de sensibilidade (não faz parte da execução normal): o mesmo arquivo rodado com o isolamento desligado reprova
**68 de 620** verificações com `MULTIEMPRESA_ISOLAMENTO=legado` e **66 de 620** com `observar` — leitura e listagem de
outra empresa, alteração/exclusão/incremento por id, consultas que citam `companyId`, identidades globais, relatórios com
o escopo da outra empresa, cópia de segurança e as duas verificações de integridade. As linhas que continuam aprovadas
sem o isolamento estrito têm uma segunda barreira: a leitura por id, que esconde o registro de outra empresa em todos os
modos, e as conferências explícitas das funções (todas as exportações filtram a empresa da sessão; `updateProduct`,
`getReceipt`, `readFile` e `settleInstallment` conferem `companyId`) — defesa em profundidade.

Sem a correção do §10, **6** verificações reprovam (as duas linhas de numeração fiscal e a integridade, nos dois sentidos),
com `novo: counters/… (rps:<filial da outra empresa>)`.

## 4. Regressão dos fluxos dentro de cada empresa

Todos os fluxos concluem nas duas empresas, nos dois armazenamentos (os números são os da própria empresa — as duas
numeram do zero):

| Empresa | Fluxo | Resultado (memória) | Postgres |
|---|---|---|---|
| Alfa Utilidades | Segunda filial, perfil restrito, vendedor limitado à Matriz e terminais | concluído | igual |
| Alfa Utilidades | Cadastros (grupo tributário, configuração fiscal, produtos, clientes, fornecedor) | concluído | igual |
| Alfa Utilidades | Estoque — entrada de saldo inicial (Matriz e filial 02) | concluído | igual |
| Alfa Utilidades | PDV — caixa aberto pelo vendedor, venda dinheiro + crediário, NFC-e simulada autorizada | venda nº 1 autorizada (NFC-e nº 1) | igual |
| Alfa Utilidades | Devolução — item devolvido ao estoque e abatido do crediário | devolução nº 1, R$ 79,90 abatidos do crediário | igual |
| Alfa Utilidades | Venda — pedido de venda faturado por NF-e simulada (estoque e conta a receber) | pedido nº 1, NF-e nº 1 autorizada | igual |
| Alfa Utilidades | Compras — pedido aprovado, recebimento conferido, estoque e conta a pagar | pedido nº 1, recebimento nº 1 | igual |
| Alfa Utilidades | Financeiro — conta a receber baixada, conta a pagar autorizada, comprovante anexado | receber nº 3, pagar nº 2 | igual |
| Alfa Utilidades | Notificação, integração de e-mail, tarefa agendada e cópia de segurança | cópia nº 1 com 242 registros | igual |
| Alfa Utilidades | Comércio digital — loja publicada com produto e foto | loja /loja-alfa-utilidades | igual |
| Bravo Calçados | Segunda filial, perfil restrito, vendedor limitado à Matriz e terminais | concluído | igual |
| Bravo Calçados | Cadastros (grupo tributário, configuração fiscal, produtos, clientes, fornecedor) | concluído | igual |
| Bravo Calçados | Estoque — entrada de saldo inicial (Matriz e filial 02) | concluído | igual |
| Bravo Calçados | PDV — caixa aberto pelo vendedor, venda dinheiro + crediário, NFC-e simulada autorizada | venda nº 1 autorizada (NFC-e nº 1) | igual |
| Bravo Calçados | Devolução — item devolvido ao estoque e abatido do crediário | devolução nº 1, R$ 159,90 abatidos do crediário | igual |
| Bravo Calçados | Venda — pedido de venda faturado por NF-e simulada (estoque e conta a receber) | pedido nº 1, NF-e nº 1 autorizada | igual |
| Bravo Calçados | Compras — pedido aprovado, recebimento conferido, estoque e conta a pagar | pedido nº 1, recebimento nº 1 | igual |
| Bravo Calçados | Financeiro — conta a receber baixada, conta a pagar autorizada, comprovante anexado | receber nº 3, pagar nº 2 | igual |
| Bravo Calçados | Notificação, integração de e-mail, tarefa agendada e cópia de segurança | cópia nº 1 com 242 registros | igual |
| Bravo Calçados | Comércio digital — loja publicada com produto e foto | loja /loja-bravo-calcados | igual |

Ao final (§ 5 do teste), depois de toda a matriz, cada empresa ainda vende no PDV com NFC-e autorizada e mantém as
próprias configurações (recurso do comércio digital, credencial de e-mail).

## 5. Usuário restrito: perfil e filial

Para o vendedor de cada empresa (restrito à Matriz):

| Verificação | Resultado |
|---|---|
| Unidades acessíveis (`accessibleUnits`) | só a própria empresa e só a Matriz; a filial 02 não é selecionável; `ctxForCompany` na outra empresa é recusado |
| Detalhe da venda da filial 02 pelo id (`saleDetail`) | não encontrado (a venda da Matriz abre) |
| Listas com o filtro da filial 02 (`querySales`, `queryBalances`, `queryDocuments`, `querySessions`) | só registros da Matriz (a NFC-e e o caixa da filial 02 não aparecem) |
| Abrir caixa no terminal da filial 02 | recusado ("Terminal pertence a outra filial") |
| Operações fora do perfil, recusadas no domínio | cadastrar produto, ajustar estoque, pedido de compra, transferência, cancelar venda, configurar fiscal, configurar integração, cópia de segurança, criar usuário, criar perfil, criar filial, cadastrar terminal, pedido de venda — todas com `PermissionError` (permissão do perfil, não validação de dados) |
| Operações cuja regra está na entrada (ação/rota) | `can()`/`canDo()` negam financeiro, compras, estoque, fiscal, relatórios, administração e fornecedores, além de "Baixar títulos", "Estornar baixas", "Autorizar contas a pagar", "Exportar dados", "Cancelar venda", backup, usuários e emissão fiscal — exatamente o que `runAction` e `/api/export/[key]` conferem |
| Download do comprovante financeiro (regra da rota `/api/files/[id]`) | `fileAccessDenial` recusa para o vendedor e libera para o administrador |
| O que o perfil permite | PDV, venda e devolução continuam liberados (o vendedor abre o caixa e vende na regressão) |

## 6. Matriz de acesso cruzado

Cada tentativa roda **nos dois sentidos** (Alfa → Bravo e Bravo → Alfa) e **nos dois armazenamentos**. As tentativas
usam o administrador da empresa atacante (todas as permissões dela, o pior caso), exceto as vendas no PDV e a última
superfície, que usam o vendedor restrito. Esperado: **recusa** (erro deliberado), **não encontrado** (nulo/falso ou erro
de registro inexistente), **vazio**, **só dados da própria empresa** ou, nas exportações com parâmetros da outra empresa,
**recusa ou só dados da própria empresa**; em todos os casos sem nenhum valor da outra empresa.

| Superfície | Tentativas por sentido | Nos dois sentidos |
|---|---:|---:|
| Store da sessão — leitura por id | 29 | 58 |
| Store da sessão — gravação por id | 16 | 32 |
| Store da sessão — consultas e buscas | 11 | 22 |
| Telas e serviços — leitura por id | 16 | 32 |
| Funções de domínio — alterar ou excluir registro da outra empresa | 37 | 74 |
| Criação na própria empresa com referência à outra | 33 | 66 |
| Seletores e listas das telas | 28 | 56 |
| Relatórios gerenciais, curva ABC e painel | 13 | 26 |
| Exportações CSV/XLSX (função da rota /api/export/[key]) | 64 | 128 |
| Arquivos (funções da rota /api/files/[id] e da imagem da vitrine) | 5 | 10 |
| Notificações | 3 | 6 |
| Cópias de segurança e exportação dos dados da empresa | 7 | 14 |
| Tarefas em segundo plano | 5 | 10 |
| Configuração de integrações | 5 | 10 |
| Vitrine pública (loja virtual) | 7 | 14 |
| Usuário restrito (vendedor) contra a outra empresa | 12 | 24 |
| **Total** | **291** | **582** |

Além das 582 linhas, cada sentido tem 3 verificações: todas as exportações registradas no código entram
na matriz, integridade da empresa-alvo (§3.4) e registro em `tenancy_violations`.

**Todas as 582 linhas foram aprovadas nos dois armazenamentos; nenhum resultado difere entre os sentidos
ou entre os armazenamentos.** Nas exportações, "os parâmetros apontando para a outra empresa" são todos os filtros que as telas aceitam, de uma vez:
`empresa`, `filial`/`branch`, `cliente`, `fornecedor`, `conta`/`account`, `sku`, `produto`, `deposito`, `sessao` e `id` com
ids da outra empresa (mais o período de 30 dias); o CSV gerado é conferido inteiro. Coluna "Bravo → Alfa": "igual" = a mesma tentativa, com os papéis trocados, teve o mesmo
resultado. Coluna "Postgres": "igual" = mesmo resultado no Postgres embutido (PGlite).

### 6.1 Store da sessão — leitura por id (29 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 1 | ler companies da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 2 | ler branches da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 3 | ler warehouses da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 4 | ler terminals da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 5 | ler users da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 6 | ler roles da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 7 | ler products da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 8 | ler skus da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 9 | ler customers da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 10 | ler suppliers da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 11 | ler cash_sessions da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 12 | ler sales da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 13 | ler returns da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 14 | ler sales_documents da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 15 | ler purchase_orders da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 16 | ler receipts da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 17 | ler titles da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 18 | ler installments da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 19 | ler settlements da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 20 | ler financial_accounts da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 21 | ler fiscal_documents da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 22 | ler files da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 23 | ler notifications da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 24 | ler integrations da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 25 | ler jobs da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 26 | ler backups da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 27 | ler stores da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 28 | ler tax_groups da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 29 | ler, um a um, todos os registros da Bravo (fotografia completa) pelo id | não encontrado | não encontrado (null) | igual | igual |

### 6.2 Store da sessão — gravação por id (16 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 30 | alterar produto da Bravo pelo id | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 31 | alterar cliente da Bravo pelo id | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 32 | alterar título da Bravo pelo id | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 33 | alterar o cadastro da empresa Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 34 | alterar usuário administrador da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 35 | mover produto próprio para a Bravo (companyId) | recusa | recusado — BusinessError: Operação bloqueada: o registro pertence a outra empresa. | igual | igual |
| 36 | tornar produto próprio global (companyId nulo) | recusa | recusado — BusinessError: Registro sem empresa não pode ser gravado a partir de uma empresa. | igual | igual |
| 37 | criar cliente com companyId da Bravo | recusa | recusado — BusinessError: Operação bloqueada: o registro pertence a outra empresa. | igual | igual |
| 38 | criar usuário vinculado à Bravo | recusa | recusado — BusinessError: O usuário criado a partir de uma empresa precisa estar vinculado a ela. | igual | igual |
| 39 | criar empresa a partir de uma contratante | recusa | recusado — BusinessError: Empresas novas são criadas pela plataforma (provisionamento), não a partir de outra empresa. | igual | igual |
| 40 | excluir cliente da Bravo pelo id | não encontrado | não encontrado (false) | igual | igual |
| 41 | excluir produto da Bravo pelo id | não encontrado | não encontrado (false) | igual | igual |
| 42 | excluir arquivo da Bravo pelo id | não encontrado | não encontrado (false) | igual | igual |
| 43 | incrementar saldo da conta bancária da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 44 | incrementar estoque físico da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 45 | tabela da plataforma (tenant_provisionings) a partir de uma contratante | vazio | vazio | igual | igual |

### 6.3 Store da sessão — consultas e buscas (11 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 46 | listar clientes com filtro companyId = Bravo | vazio | vazio | igual | igual |
| 47 | listar produtos com filtro companyId ≠ Alfa | vazio | vazio | igual | igual |
| 48 | listar SKUs pelos ids da Bravo (consulta de /api/pdv/products?ids=) | vazio | vazio | igual | igual |
| 49 | buscar cliente pelo id da Bravo (consulta de /api/pdv/customers?id=) | não encontrado | não encontrado (null) | igual | igual |
| 50 | pesquisa global pelo nome do cliente da Bravo (consultas de /api/search) | vazio | vazio | igual | igual |
| 51 | código de barras presente nas duas empresas devolve só o SKU da Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 52 | CPF presente nas duas empresas devolve só o cliente da Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 53 | CPF consultado com a empresa Bravo no parâmetro | não encontrado | não encontrado (null) | igual | igual |
| 54 | listar usuários (identidade global) devolve só os vinculados | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 55 | listar empresas devolve só a própria | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 56 | numerador próprio não consome a sequência de vendas da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.4 Telas e serviços — leitura por id (16 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 57 | detalhe da venda da Bravo | não encontrado | não encontrado (null) | igual | igual |
| 58 | detalhe do título da Bravo | não encontrado | não encontrado (null) | igual | igual |
| 59 | recebimento de compra da Bravo | não encontrado | não encontrado — NotFoundError: Registro não encontrado | igual | igual |
| 60 | pedido de compra da Bravo | não encontrado | não encontrado — NotFoundError: Registro não encontrado | igual | igual |
| 61 | NF-e da Bravo (consulta ao provedor) | não encontrado | não encontrado — NotFoundError: Registro não encontrado | igual | igual |
| 62 | resumo do caixa da Bravo | não encontrado | não encontrado — NotFoundError: Registro não encontrado | igual | igual |
| 63 | resumo do cliente da Bravo | vazio | vazio | igual | igual |
| 64 | resumo do fornecedor da Bravo | vazio | vazio | igual | igual |
| 65 | itens devolvíveis da venda da Bravo | vazio | vazio | igual | igual |
| 66 | itens do pedido de venda da Bravo | vazio | vazio | igual | igual |
| 67 | configuração fiscal da Bravo pelo Store da sessão | não encontrado | não encontrado (null) | igual | igual |
| 68 | numeração fiscal da filial da Bravo (numerador do RPS por filial) | recusa | recusado — BusinessError: Filial não encontrada nesta empresa. | igual | igual |
| 69 | linha do tempo (auditoria) da venda da Bravo | vazio | vazio | igual | igual |
| 70 | disponível em estoque dos SKUs da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 71 | preço de venda do SKU da Bravo pela tabela da Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 72 | vendedores da empresa Bravo pelo Store da sessão | vazio | vazio | igual | igual |

### 6.5 Funções de domínio — alterar ou excluir registro da outra empresa (37 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 73 | alterar produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 74 | inativar produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 75 | excluir produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 76 | alterar cliente da Bravo | recusa | recusado — BusinessError: Cliente não encontrado. | igual | igual |
| 77 | inativar cliente da Bravo | recusa | recusado — BusinessError: Cliente não encontrado. | igual | igual |
| 78 | excluir cliente da Bravo | recusa | recusado — BusinessError: Cliente não encontrado. | igual | igual |
| 79 | alterar fornecedor da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 80 | bloquear fornecedor da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 81 | excluir fornecedor da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 82 | cancelar venda da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 83 | devolver item da venda da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 84 | cancelar título da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 85 | editar título da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 86 | baixar parcela da Bravo na conta da Alfa | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 87 | estornar baixa da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 88 | autorizar conta a pagar da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 89 | anexar arquivo ao título da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 90 | cancelar pedido de compra da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 91 | cancelar recebimento da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 92 | alterar pedido de venda da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 93 | cancelar pedido de venda da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 94 | cancelar NF-e da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 95 | transmitir NFC-e da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 96 | ajustar estoque da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 97 | movimentar o caixa da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 98 | fechar o caixa da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 99 | alterar cadastro da empresa Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 100 | inativar a empresa Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 101 | alterar filial da Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 102 | inativar filial da Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 103 | alterar terminal da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 104 | alterar perfil da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 105 | alterar usuário da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 106 | suspender usuário da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 107 | editar anúncio da vitrine da Bravo | recusa | recusado — BusinessError: Produto não encontrado no catálogo da loja. | igual | igual |
| 108 | marcar como lida notificação da Bravo | recusa | recusado — BusinessError: Notificação não encontrada. | igual | igual |
| 109 | arquivar notificação da Bravo | recusa | recusado — BusinessError: Notificação não encontrada. | igual | igual |

### 6.6 Criação na própria empresa com referência à outra (33 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 110 | venda no PDV com produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 111 | venda no PDV para cliente da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 112 | venda no terminal da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 113 | venda paga com meio de pagamento da Bravo | recusa | recusado — BusinessError: Meio de pagamento inválido. | igual | igual |
| 114 | abrir caixa no terminal da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 115 | pedido de venda para cliente da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 116 | pedido de venda com produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 117 | pedido de compra com fornecedor da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 118 | pedido de compra com produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 119 | pedido de compra para depósito da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 120 | recebimento vinculado a pedido de compra da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 121 | recebimento sem pedido com fornecedor da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 122 | conta a receber para cliente da Bravo | recusa | recusado — BusinessError: Cliente inválido(a). | igual | igual |
| 123 | conta a receber com categoria financeira da Bravo | recusa | recusado — BusinessError: Categoria inválido(a). | igual | igual |
| 124 | baixa de parcela própria na conta bancária da Bravo | recusa | recusado — BusinessError: Conta financeira inválida: selecione uma conta desta empresa. | igual | igual |
| 125 | saldo inicial no depósito da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 126 | ajuste de estoque próprio com produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 127 | transferência de estoque para filial da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 128 | terminal na filial da Bravo | recusa | recusado — BusinessError: Selecione uma filial da empresa. | igual | igual |
| 129 | terminal próprio com depósito da Bravo | recusa | recusado — BusinessError: O depósito padrão deve pertencer à filial do terminal. | igual | igual |
| 130 | depósito na filial da Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 131 | filial nova dentro da empresa Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 132 | produto com grupo tributário da Bravo | recusa | recusado — BusinessError: Grupo tributário inválido(a). | igual | igual |
| 133 | produto com fornecedor da Bravo | recusa | recusado — BusinessError: Fornecedor inválido(a). | igual | igual |
| 134 | preço próprio para SKU da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 135 | usuário vinculado também à Bravo | recusa | recusado — PermissionError: Empresa fora do seu acesso: você só pode vincular usuários às empresas a que tem acesso. | igual | igual |
| 136 | usuário com perfil da Bravo | recusa | recusado — BusinessError: Perfil de outra empresa: escolha um perfil da empresa em uso. | igual | igual |
| 137 | notificação gravada na Bravo | recusa | recusado — BusinessError: Operação bloqueada: o registro pertence a outra empresa. | igual | igual |
| 138 | tarefa enfileirada na Bravo | recusa | recusado — BusinessError: Operação bloqueada: o registro pertence a outra empresa. | igual | igual |
| 139 | catálogo da loja com produto da Bravo | vazio | vazio | igual | igual |
| 140 | anúncio próprio com foto da Bravo | recusa | recusado — BusinessError: Foto inválida: envie a imagem pela tela do produto na loja. | igual | igual |
| 141 | numeração fiscal ajustada na filial da Bravo | recusa | recusado — BusinessError: Filial não encontrada nesta empresa. | igual | igual |
| 142 | meta de vendas para a filial da Bravo | recusa | recusado — BusinessError: Filial inválida. | igual | igual |

### 6.7 Seletores e listas das telas (28 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 143 | seletor de clientes | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 144 | seletor de fornecedores | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 145 | seletor de filiais | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 146 | seletor de depósitos | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 147 | seletor de terminais | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 148 | seletor de usuários | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 149 | seletor de vendedores | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 150 | seletor de perfis | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 151 | seletor de contas | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 152 | seletor de meios de pagamento | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 153 | seletor de grupos tributários | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 154 | seletor de nomes de usuários | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 155 | depósitos da filial da Bravo no seletor | vazio | vazio | igual | igual |
| 156 | terminais da filial da Bravo no seletor | vazio | vazio | igual | igual |
| 157 | lista de clientes | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 158 | lista de clientes buscando o nome da Bravo | vazio | vazio | igual | igual |
| 159 | lista de clientes buscando o CPF presente nas duas empresas | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 160 | lista de produtos | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 161 | lista de fornecedores | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 162 | vendas com filtro de filial da Bravo (consolidado) | vazio | vazio | igual | igual |
| 163 | vendas filtradas pelo cliente da Bravo | vazio | vazio | igual | igual |
| 164 | devoluções | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 165 | contas a receber com filtro de filial da Bravo | vazio | vazio | igual | igual |
| 166 | saldos de estoque com filtro de filial da Bravo | vazio | vazio | igual | igual |
| 167 | movimentos de estoque com filtro de SKU da Bravo | vazio | vazio | igual | igual |
| 168 | NFC-e com filtro de filial da Bravo | vazio | vazio | igual | igual |
| 169 | caixas com filtro de filial da Bravo | vazio | vazio | igual | igual |
| 170 | pedidos de compra | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.8 Relatórios gerenciais, curva ABC e painel (13 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 171 | relatório gerencial da própria empresa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 172 | relatório gerencial com a empresa Bravo no escopo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 173 | totais com as filiais da Bravo no escopo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 174 | operações por filial da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 175 | visão comercial com a empresa Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 176 | meios de pagamento com a empresa Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 177 | curva ABC da própria empresa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 178 | curva ABC com a empresa Bravo no escopo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 179 | painel: últimas vendas das filiais da Bravo | vazio | vazio | igual | igual |
| 180 | painel: caixas abertos das filiais da Bravo | vazio | vazio | igual | igual |
| 181 | painel: alertas de estoque das filiais da Bravo | vazio | vazio | igual | igual |
| 182 | painel: financeiro das filiais da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 183 | painel: fiscal das filiais da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.9 Exportações CSV/XLSX (função da rota /api/export/[key]) (64 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 184 | todas as exportações da própria empresa (CSV e XLSX gerados) | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 185 | exportação "accounting_clients" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 186 | exportação "accounting_deliveries" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | recusado — PermissionError: Você não tem permissão para esta ação. | igual | igual |
| 187 | exportação "admin.audit" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 188 | exportação "admin.backups" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 189 | exportação "admin.branches" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (2 linha(s)) | igual | igual |
| 190 | exportação "admin.companies" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 191 | exportação "admin.roles" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (7 linha(s)) | igual | igual |
| 192 | exportação "admin.terminals" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 193 | exportação "admin.users" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 194 | exportação "cash_movements" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 195 | exportação "cash_sessions" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 196 | exportação "customers" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (3 linha(s)) | igual | igual |
| 197 | exportação "fin-account-entries" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 198 | exportação "fin-acquirer-lines" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 199 | exportação "fin-aging" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (3 linha(s)) | igual | igual |
| 200 | exportação "fin-bank-transactions" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 201 | exportação "fin-cards" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 202 | exportação "fin-cashflow" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 203 | exportação "fin-chart-of-accounts" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (6 linha(s)) | igual | igual |
| 204 | exportação "fin-dre" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (42 linha(s)) | igual | igual |
| 205 | exportação "fin-payables" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 206 | exportação "fin-receivables" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 207 | exportação "fiscal-cancelamentos" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 208 | exportação "fiscal-cfop" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 209 | exportação "fiscal-documentos" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 210 | exportação "fiscal-entradas-cfop" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 211 | exportação "fiscal-livro-entradas" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 212 | exportação "fiscal-livro-saidas" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 213 | exportação "fiscal-ncm" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 214 | exportação "fiscal-nfce" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 215 | exportação "fiscal-nfe" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 216 | exportação "fiscal-nfse" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 217 | exportação "fiscal-obrigacoes" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 218 | exportação "fiscal-rejeicoes" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 219 | exportação "fiscal-servicos" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 220 | exportação "integration-logs" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (3 linha(s)) | igual | igual |
| 221 | exportação "inventories" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 222 | exportação "inventory-items" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 223 | exportação "network-closing" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | recusado — BusinessError: Fechamento não encontrado. | igual | igual |
| 224 | exportação "notifications" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 225 | exportação "products" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (2 linha(s)) | igual | igual |
| 226 | exportação "purchase-pending-invoices" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 227 | exportação "purchase_orders" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 228 | exportação "purchase_requests" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 229 | exportação "quotations" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 230 | exportação "receipts" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 231 | exportação "replenishment" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 232 | exportação "reports-abc" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (2 linha(s)) | igual | igual |
| 233 | exportação "reports-abc-product" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 234 | exportação "reports-branch-ops" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 235 | exportação "reports-breakdown" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (33 linha(s)) | igual | igual |
| 236 | exportação "reports-goals" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 237 | exportação "reports-units" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (3 linha(s)) | igual | igual |
| 238 | exportação "returns" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 239 | exportação "sales" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 240 | exportação "sales-commissions" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | recusado — BusinessError: Filial inválida. | igual | igual |
| 241 | exportação "stock-balances" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 242 | exportação "stock-fiscal-inventory" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 243 | exportação "stock-movements" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 244 | exportação "suppliers" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (1 linha(s)) | igual | igual |
| 245 | exportação "support.tickets" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 246 | exportação "transfers" com os parâmetros apontando para a Bravo | recusa ou só dados da própria empresa | somente dados da própria empresa (0 linha(s)) | igual | igual |
| 247 | vendedor restrito: nenhuma exportação passa na regra da rota (módulo + 'Exportar dados') | vazio | vazio | igual | igual |

### 6.10 Arquivos (funções da rota /api/files/[id] e da imagem da vitrine) (5 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 248 | baixar comprovante da Bravo pelo id | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 249 | baixar artefato da cópia de segurança da Bravo pelo id | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 250 | rota de download: metadados do arquivo da Bravo no Store da sessão | não encontrado | não encontrado (null) | igual | igual |
| 251 | imagem da Bravo servida pela vitrine da Alfa | não encontrado | não encontrado (false) | igual | igual |
| 252 | comprovante próprio continua baixável | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.11 Notificações (3 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 253 | central de notificações | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 254 | central filtrada pela filial da Bravo | vazio | vazio | igual | igual |
| 255 | contadores do administrador da Bravo na empresa Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.12 Cópias de segurança e exportação dos dados da empresa (7 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 256 | conteúdo da cópia de segurança da Alfa (com arquivos) | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 257 | montar cópia da empresa Bravo pelo Store da sessão | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 258 | ler artefato da cópia da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 259 | verificar cópia da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 260 | restaurar cópia da Bravo em base de teste | recusa | recusado — BusinessError: Cópia de outra empresa: a restauração só pode ser solicitada na empresa da cópia. | igual | igual |
| 261 | resumo de cópias com a empresa Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 262 | nova cópia da Alfa não leva nada da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.13 Tarefas em segundo plano (5 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 263 | executar tarefa da Bravo pelo id | vazio | vazio | igual | igual |
| 264 | reprocessar tarefa da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 265 | executar tarefas pendentes da empresa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 266 | tarefas da central de integrações | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 267 | tarefas pela chave de deduplicação da Bravo | vazio | vazio | igual | igual |

### 6.14 Configuração de integrações (5 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 268 | integração de e-mail da Bravo | não encontrado | não encontrado (null) | igual | igual |
| 269 | lista de integrações com a empresa Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 270 | vincular a credencial (variável) da Bravo | recusa | recusado — BusinessError: A variável <variável da outra empresa> já é a credencial de outra empresa desta instalação. Crie uma variável pró… | igual | igual |
| 271 | configuração fiscal própria | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 272 | histórico de integrações | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.15 Vitrine pública (loja virtual) (7 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 273 | catálogo público da Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 274 | produto da Bravo pelo endereço na loja da Alfa | não encontrado | não encontrado (null) | igual | igual |
| 275 | carrinho da loja da Alfa com produto da Bravo | recusa | recusado — BusinessError: Produto indisponível na loja. | igual | igual |
| 276 | carrinho da loja da Alfa com SKU da Bravo | recusa | recusado — BusinessError: Escolha a variação (tamanho, cor) antes de adicionar ao carrinho. | igual | igual |
| 277 | mapa do site da loja da Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 278 | endereço da loja da Alfa resolve a própria loja | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 279 | telas internas da loja resolvem só a loja da Alfa | só dados da própria empresa | somente dados da própria empresa | igual | igual |

### 6.16 Usuário restrito (vendedor) contra a outra empresa (12 por sentido)

| # | Tentativa (Alfa → Bravo) | Esperado | Resultado obtido | Bravo → Alfa | Postgres |
|---:|---|---|---|---|---|
| 280 | contexto do vendedor na empresa Bravo | recusa | recusado — PermissionError: Você não tem acesso a esta empresa. | igual | igual |
| 281 | perfil do vendedor dentro da Bravo | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 282 | vendedor lê venda da Bravo pelo id | não encontrado | não encontrado (null) | igual | igual |
| 283 | vendedor vende produto da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 284 | vendedor devolve item da venda da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 285 | vendedor lista clientes | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 286 | vendedor edita cliente da Bravo | recusa | recusado — BusinessError: Cliente não encontrado. | igual | igual |
| 287 | vendedor abre caixa no terminal da Bravo | recusa | recusado — NotFoundError: Registro não encontrado | igual | igual |
| 288 | vendedor consulta o caixa da Bravo | não encontrado | não encontrado — NotFoundError: Registro não encontrado | igual | igual |
| 289 | vendedor lista vendas | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 290 | vendedor lista produtos | só dados da própria empresa | somente dados da própria empresa | igual | igual |
| 291 | vendedor busca cliente com CPF presente nas duas empresas | só dados da própria empresa | somente dados da própria empresa | igual | igual |

## 7. Rotas e telas HTTP cobertas pela função por trás

As rotas e páginas abaixo dependem do cookie de sessão do Next. A homologação **não simula cookie**: testa a função de
domínio ou de serviço que a rota chama, com o mesmo contexto da sessão. Em todas: **coberta pela função indicada;
verificação HTTP no roteiro da prévia** (`homologacao-previa.md`).

| Rota / tela | Coberta pela função | Superfície da matriz |
|---|---|---|
| `GET /api/search` | as mesmas consultas `store.list` da rota (clientes, fornecedores, SKUs por texto; número/chave) pelo Store da sessão | Store da sessão — consultas e buscas |
| `GET /api/pdv/products` | `store.list("skus", { ids })`, código de barras (`barcode`) | Store da sessão — consultas e buscas |
| `GET /api/pdv/customers` | `store.get("customers")` + conferência de empresa; `findCustomerByDoc` | Store da sessão — consultas e buscas |
| `GET /api/export/[key]` | `getExport(key).rows(sessão, parâmetros)` de **todas** as exportações registradas, `toCsv` e `toXlsx`; regra de entrada `can(módulo) && canDo("data.export")` | Exportações CSV/XLSX |
| `GET /api/files/[id]` | `ctx.store.get("files")`, `fileAccessDenial`, `readFile` | Arquivos |
| `GET /administracao/backups/[id]/download` | `ctx.store.get("backups")`, `loadBackupPayload`, `readFile` do artefato | Cópias de segurança |
| `GET /loja/[store]/imagem/[id]` | `isPublicImage` (e a conferência `meta.companyId = loja.companyId` da rota) | Arquivos; Vitrine pública |
| `/loja/[store]`, `/produto/[slug]`, `/carrinho`, `robots.txt`, `sitemap.xml` (carregador `loadStore`) | `resolveStore`, `publicCatalog`, `publicProduct`, `addToCart`, `sitemapEntries` | Vitrine pública |
| `/vendas`, `/vendas/[id]`, `/vendas/devolucoes` | `querySales`, `saleDetail`, `queryReturns`, `returnableItems` | Seletores e listas; Telas e serviços; Usuário restrito |
| `/vendas/pedidos/[id]` | `documentItems`, `updateSalesDocument`, `cancelOrder` (documento comercial) | Telas e serviços; Funções de domínio |
| `/estoque`, `/estoque/movimentos` | `queryBalances`, `queryMovements`, `availableMap` | Seletores e listas; Telas e serviços |
| `/financeiro/receber`, `/financeiro/pagar/[id]` | `queryInstallments`, `titleDetail` | Seletores e listas; Telas e serviços |
| `/fiscal/nfce`, `/fiscal/nfe/[id]`, `/fiscal/configuracoes` | `queryDocuments`, `queryDocument`, `getFiscalConfig`, `numberingStatus`, `setNextNumber` | Seletores e listas; Telas e serviços |
| `/caixa`, `/caixa/[id]` | `querySessions`, `sessionSummary` | Seletores e listas; Telas e serviços |
| `/clientes`, `/produtos`, `/fornecedores`, `/compras/pedidos` | `queryCustomers`, `queryProducts`, `querySuppliers`, `queryOrders`, `customerSummary`, `supplierSummary` | Seletores e listas; Telas e serviços |
| `/dashboard` | `latestSales`, `openCashSessions`, `stockAlerts`, `financeSnapshot`, `fiscalSnapshot` | Relatórios e painel |
| `/relatorios/gerenciais`, `/relatorios/curva-abc` | `managerialReport`, `reportTotals`, `branchOperations`, `commercialOverview`, `paymentBreakdown`, `abcReport` | Relatórios e painel |
| `/notificacoes` | `queryNotifications`, `markNotifications`, `archiveNotifications`, `notificationCounts` | Notificações |
| `/administracao/integracoes` | `listIntegrations`, `getIntegration`, `saveIntegration`, `integrationJobs`, `requeueJob`, `runCompanyJobs`, `integrationLogs` | Integrações; Tarefas |
| `/administracao/backups` | `createBackup`, `verifyBackup`, `createRestoreJob`, `backupSummary`, `buildPayload` | Cópias de segurança |
| `/comercio-digital/catalogo` | `requireStore`, `addToCatalog`, `saveListing` | Vitrine pública; Criação com referência |
| Seletores das telas (`lookups.*`, `nameMap`) | `lookups.customers/suppliers/branches/warehouses/terminals/users/sellers/roles/accounts/paymentMethods/taxGroups`, `nameMap("users")` | Seletores e listas |
| `/selecionar-unidade`, `GET /api/unit` | `accessibleUnits`, `branchScopeOf`, `ctxForCompany` | §5 e Usuário restrito |
| Server actions (`runAction`) | a função de domínio da ação + a regra `can(módulo, operação)` que `runAction` aplica | todas |

## 8. Como rodar

```bash
# memória (padrão)
npx vitest run tests/multiempresa-homologacao.test.ts
# Postgres embutido (PGlite) — mesma suíte sobre o PostgresStore
TEST_STORE=postgres npx vitest run tests/multiempresa-homologacao.test.ts
# relatório da execução em JSON (alimenta as tabelas deste documento)
HOMOLOGACAO_RELATORIO=/caminho/relatorio.json npx vitest run tests/multiempresa-homologacao.test.ts
```

O arquivo roda **inteiro e em sequência** (cada etapa usa o que a anterior criou): filtrar um teste isolado com `-t` não
funciona. Nenhuma rede é usada (e-mail, fiscal e Pix em simulação).

## 9. Resultados por armazenamento

| Armazenamento | Testes | Aprovados | Duração (Vitest) | Tempo total do comando |
|---|---:|---:|---:|---:|
| Memória (`MemoryStore`) | 620 | 620 | 4,2 s | 4,8 s |
| Postgres embutido (`TEST_STORE=postgres`, PGlite) | 620 | 620 | 10,3 s | 11,0 s |

Tempos da última execução (variam cerca de 1 s entre execuções), muito abaixo do limite de 3 minutos por armazenamento.

Composição dos 620 testes: implantação (5), regressão (10 × 2 empresas), usuário restrito (3 × 2), matriz
(291 tentativas + 3 verificações, × 2 sentidos) e fecho (1). A suíte completa do projeto continua
aprovada com este arquivo e a correção: memória — 88 arquivos, 1.692 testes, 73 s; Postgres embutido — 86 arquivos
aprovados e 2 ignorados por desenho (só rodam na memória), 1.686 testes aprovados e 6 ignorados, 316 s.

## 10. Vazamento encontrado e correção

**Numeração fiscal por filial de outra empresa** — `src/domain/fiscal/config.ts`.

- **Antes:** `setNextNumber(ctx, filial, "nfse", série, próximo)` e `numberingStatus(ctx, filial, cfg)` aceitavam o id de
  uma filial de **outra empresa**. O numerador do RPS tem a chave `rps:<filial>` (sem a empresa) e a coleção `counters`
  não tem `companyId`, então o Store restrito não barra: com o contexto da Alfa e o id de uma filial da Bravo,
  `setNextNumber` **criava/avançava a sequência de RPS da Bravo** (a próxima NFS-e da Bravo pularia números) e gravava a
  auditoria na Alfa apontando para a filial da Bravo; `numberingStatus` lia o valor da sequência dela. A matriz acusou nas
  duas direções e a verificação de integridade reprovou (`novo: counters/<id>` com `key: rps:<filial da Bravo>`,
  `value: 899`).
- **Depois:** `assertOwnBranch` (linhas 72-80) confere que a filial é da empresa ativa antes de ler (linha 83) ou ajustar
  (linha 103) a numeração; filial de outra empresa recebe "Filial não encontrada nesta empresa." e nada é gravado. Na
  empresa dona, o comportamento é o mesmo de antes.
- **Alcance:** a tela e a ação passam a filial da sessão (`src/app/(app)/fiscal/actions.ts:318` usa `requireBranch(s.ctx)`;
  `fiscal/configuracoes/page.tsx` usa `s.branch`), então não havia caminho HTTP para escolher a filial — a falha era da
  função de domínio (defesa em profundidade).
- **Prova:** linhas "numeração fiscal ajustada na filial da …" e "numeração fiscal da filial da … (numerador do RPS por
  filial)" da matriz e as verificações de integridade. Testes fiscais existentes conferidos depois da correção
  (`fiscal`, `fiscal-fixes`, `fiscal-round2`, `fiscal-round3`, `tax-complete`, `tax-reform`: 101 aprovados na memória;
  os quatro `fiscal*` também no Postgres).

## 11. Achados sem vazamento reproduzido

> **Integração (26/11/2026):** os itens 2, 3 e 4 foram corrigidos depois desta homologação, com a validação de
> referência no servidor. A filial e o arquivo precisam ser da empresa ativa, e os destinatários informados de uma
> notificação são filtrados pelo vínculo com a empresa. Os testes estão em `tests/multiempresa-referencias.test.ts`, em
> memória e em Postgres. Os itens 1, 5, 6 e 7 continuam como riscos latentes documentados.

Os itens 2 a 5 foram confirmados por sondagem durante a homologação; os itens 1, 6 e 7, pela leitura do código. Nenhum
leva dados de uma empresa à outra nem altera a outra pelos caminhos atuais das telas e rotas. Ficam como riscos latentes,
com a direção sugerida:

| # | Achado | Situação atual | Direção sugerida |
|---|---|---|---|
| 1 | `counters` (numeradores) e `user_prefs` não têm `companyId`; o Store restrito os repassa | As chaves levam a empresa (`sale:<empresa>`, `fiscalnum:<empresa>:…`) ou um registro lido antes pelo Store restrito (`cash:<terminal>`, `cashmov:<sessão>`, `transfer-separation:<id>`); a única chave montada com um id não conferido (`rps:<filial>`) foi corrigida no §10 | Empresa na chave de todos os numeradores (ou `companyId` + condição de dono) |
| 2 | **Corrigido na integração.** `saveFiscalConfig(ctx, filial)` e `saveIntegration({ branchId })` aceitam o id de uma filial de outra empresa | Gravam um registro **da própria empresa** com aquela filial (órfão): a outra empresa nunca o lê (a busca usa a chave dela) e nada dela muda. Tela e ação passam a filial da sessão | A mesma conferência de filial do §10 |
| 3 | **Corrigido na integração.** `addTitleAttachment` aceita um `fileId` sem conferir a empresa do arquivo | O anexo fica apontando para o id, mas o download continua recusado (`readFile`) e o detalhe do título não lê o arquivo (Store restrito). As ações sempre anexam o arquivo que acabaram de gravar | Conferir `files.companyId` ao anexar |
| 4 | **Corrigido na integração.** `notify(..., { audience: { userIds } })` usa os destinatários sem conferir o vínculo | A notificação fica na empresa de origem e é invisível ao destinatário de outra empresa (central e contadores filtram a empresa da sessão). Só chamadas internas informam `userIds` | Filtrar `userIds` pelo vínculo com a empresa |
| 5 | `toCtxUser(store, usuário, outraEmpresa)` resolve o perfil de sistema equivalente pelo `roleId` legado, mesmo sem vínculo (o administrador da Alfa teria o "Administrador" da Bravo) | Não explorável: toda entrada confere o vínculo antes (`accessibleUnits` na sessão, `ctxForCompany` na administração multiempresa) — verificado na implantação (§1 do teste) | Sem vínculo, perfil vazio (defesa em profundidade) |
| 6 | Comércio digital: idempotência dos eventos por `detId("cevent", externalKey)` e índice único global em `commerce_events.externalKey` (R11 do mapeamento 01) | `simulateEventAction` aceita `repeatOf` livre: com a chave de evento de outra loja, o evento dela ganha uma tentativa e o da própria é tratado como repetido. Exige conhecer a chave da outra loja (ids aleatórios) e não foi exercitado aqui (sem pedidos on-line) | Chave por loja e índice por loja (mudança de esquema) |
| 7 | `storeOfCompany(store, empresa)` lê sem escopo, por desenho (vitrine pública) | As telas internas usam `requireStore(ctx)`, que só resolve a loja da empresa ativa (coberto na matriz) | — |

## 12. Fora do escopo desta homologação

- **Camada HTTP com cookie** (páginas, `requireSession`, `requireApiSession`, `runAction`): coberta pelas funções por
  trás (§7); a verificação com navegador e sessão real fica para o roteiro da prévia (`homologacao-previa.md`).
- **Escritório contábil, rede de certificação e certificados**: as duas empresas são de varejo; esses fluxos entre
  empresas, que são deliberados e controlados por vínculo, têm testes próprios (`accounting`, `certificates`, `network*`,
  `multiempresa-vinculos`).
- **Pedidos on-line, gateway e monitor do comércio digital**: a loja, o catálogo e a vitrine estão na matriz; pedido,
  pagamento e expedição não (ver achado 6).
- **Pix no PDV, vale-crédito e lotes** (`/api/pdv/intents`, `/api/pdv/vouchers`, `/api/pdv/lots`): não fazem parte do
  cenário; usam o mesmo Store restrito e conferência explícita de empresa.
- **Rotinas diárias** (`runScheduled`) e o executor global de tarefas (cron): percorrem todas as empresas por desenho;
  a matriz cobre as tarefas pelo contexto da empresa (executar/reprocessar tarefa da outra empresa).
- **Telas de administração de usuários e a Torre de Controle do Interos**: mantidas por outras frentes; aqui entram só
  as funções `createUser`, `updateUser` e `setUserStatus` com alvo na outra empresa.
- **Chamados públicos da tela de login e artigos de ajuda globais**: cobertos por `tests/scoped-store.test.ts`.
