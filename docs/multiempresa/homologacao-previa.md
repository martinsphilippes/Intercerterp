# Homologação multiempresa na prévia (ambiente real)

> A homologação **automatizada**, com duas empresas, matriz de acesso cruzado e regressões, está em
> `homologacao.md`. Este documento traz a homologação de ponta a ponta no **ambiente publicado**: Vercel + Neon São
> Paulo, branch `claude/eager-tesla-oark2w`, modo `estrito`, demonstração carregada. Tudo passa pelas mesmas portas que
> o Interos e as pessoas usam: a interface de serviço, as telas no navegador, as APIs e as exportações.
>
> Roteiro: `scripts/interos/homologacao-previa.mjs`. Evidências (relatórios JSON e capturas, sem tokens, senhas nem
> links de convite): `docs/multiempresa/evidencias/homologacao-previa/`.

## 1. Resultado

**68 verificações, nenhuma falha.** Execução de 2026-11-26 02:25 UTC, na publicação final da branch (commit `2685639`).

As duas empresas fictícias foram criadas pelo Interos nesta execução:

| Empresa | idEmpresa | contaInterosId | Módulos |
|---|---|---|---|
| A — Aurora Utilidades | `c87769bf7702aa1419b00da2316f3d9b` | `homolog-a-202611260225` | pdv, vendas, estoque, compras, financeiro, fiscal, relatórios |
| B — Boreal Papelaria | `f9c6992ff11fd516b26a3d90727640af` | `homolog-b-202611260225` | pdv, vendas, estoque, financeiro |

A "outra empresa" das tentativas cruzadas é, além da A e da B, a **demonstração**: uma empresa com vendas, produtos,
clientes, fornecedores, documentos fiscais e arquivos de verdade no banco.

## 2. O que foi verificado

| # | Verificação | Resultado |
|---|---|---|
| 1 | status com a credencial de provisionamento | OK |
| 2 | status com a credencial da Torre | OK |
| 3 | sem credencial → 401 nao_autenticado | OK |
| 4 | segredo errado → 401 (mesma resposta) | OK |
| 5 | credencial da Torre não provisiona → 403 | OK |
| 6 | credencial de provisionamento não lê a Torre → 403 | OK |
| 7 | produção sem credenciais → 503 servico_nao_configurado (ou ainda sem a rota) | OK |
| 8 | migração simular: conferência antes/depois sem diferença | OK |
| 9 | migração aplicar: conferência antes/depois sem diferença | OK |
| 10 | empresa A criada pelo Interos → 201 | OK |
| 11 | empresa A: reenvio com a mesma chave devolve a resposta original sem o link | OK |
| 12 | empresa A: reenvio com outra chave não duplica (200) | OK |
| 13 | empresa B criada pelo Interos → 201 | OK |
| 14 | empresa B: reenvio com a mesma chave devolve a resposta original sem o link | OK |
| 15 | empresa B: reenvio com outra chave não duplica (200) | OK |
| 16 | convite A aceito pela tela (volta ao login) | OK |
| 17 | convite A é de uso único (o mesmo link não ativa de novo) | OK |
| 18 | administrador A entra no ERP | OK |
| 19 | convite B aceito pela tela (volta ao login) | OK |
| 20 | convite B é de uso único (o mesmo link não ativa de novo) | OK |
| 21 | administrador B entra no ERP | OK |
| 22 | empresa A: cliente próprio cadastrado pela tela | OK |
| 23 | empresa B: cliente próprio cadastrado pela tela | OK |
| 24 | ids da demonstração coletados para as tentativas cruzadas | OK |
| 25 | A → tela: cliente da empresa B: bloqueado, sem vazar dados | OK |
| 26 | A → tela: cliente da demonstração: bloqueado, sem vazar dados | OK |
| 27 | A → tela: produto da demonstração: bloqueado, sem vazar dados | OK |
| 28 | A → tela: venda da demonstração: bloqueado, sem vazar dados | OK |
| 29 | A → tela: fornecedor da demonstração: bloqueado, sem vazar dados | OK |
| 30 | A → tela: editar cliente da demonstração: bloqueado, sem vazar dados | OK |
| 31 | A → arquivo da demonstração: 404 | OK |
| 32 | A → lista de clientes: só o próprio | OK |
| 33 | A → exportação de clientes: só o próprio | OK |
| 34 | A → busca global: nada de outra empresa | OK |
| 35 | A → busca pelo cliente de B: nada | OK |
| 36 | A → troca para a empresa B: recusada (continua na própria) | OK |
| 37 | A → relatórios: sem dados de outra empresa | OK |
| 38 | B → tela: cliente da empresa A: bloqueado, sem vazar dados | OK |
| 39 | B → tela: cliente da demonstração: bloqueado, sem vazar dados | OK |
| 40 | B → tela: produto da demonstração: bloqueado, sem vazar dados | OK |
| 41 | B → tela: venda da demonstração: bloqueado, sem vazar dados | OK |
| 42 | B → tela: fornecedor da demonstração: bloqueado, sem vazar dados | OK |
| 43 | B → tela: editar cliente da demonstração: bloqueado, sem vazar dados | OK |
| 44 | B → arquivo da demonstração: 404 | OK |
| 45 | B → lista de clientes: só o próprio | OK |
| 46 | B → exportação de clientes: só o próprio | OK |
| 47 | B → busca global: nada de outra empresa | OK |
| 48 | B → busca pelo cliente de A: nada | OK |
| 49 | B → troca para a empresa A: recusada (continua na própria) | OK |
| 50 | B → relatórios: sem dados de outra empresa | OK |
| 51 | Torre A: resumo só da própria empresa (sem as vendas da demonstração) | OK |
| 52 | Torre A: adoção com o próprio administrador ativo | OK |
| 53 | Torre A: unidade de outra empresa no filtro → 422 | OK |
| 54 | Torre B: resumo só da própria empresa (sem as vendas da demonstração) | OK |
| 55 | Torre B: adoção com o próprio administrador ativo | OK |
| 56 | Torre B: unidade de outra empresa no filtro → 422 | OK |
| 57 | provisionamento: lista só empresas vinculadas (A e B presentes; nenhuma da demonstração) | OK |
| 58 | provisionamento: empresa existente mas não vinculada (demonstração) não existe para o Interos (404) | OK |
| 59 | Torre: empresa não vinculada (demonstração) → 404 | OK |
| 60 | B suspensa em somente leitura | OK |
| 61 | B em somente leitura: consulta continua | OK |
| 62 | B em somente leitura: gravação recusada | OK |
| 63 | B suspensa em bloqueio | OK |
| 64 | B em bloqueio: a sessão aberta perde o acesso | OK |
| 65 | B em bloqueio: novo login não entra na empresa | OK |
| 66 | B reativada, com o histórico das suspensões | OK |
| 67 | B reativada: o administrador entra de novo, na hora | OK |
| 68 | B reativada: tarefas liberadas e histórico preservado na consulta | OK |

**Regressão das telas.** O rastreador (`scripts/dev/crawl.mjs`) percorreu a prévia como Administração da
demonstração: **336 páginas, 208 padrões de rota, nenhuma com problema** (status, tela de erro, erro de página ou de
console). Os **21 acessos rápidos** continuam na tela de login, na prévia e na produção, conforme a decisão do
titular.

## 3. O que a primeira execução encontrou (e foi corrigido)

A primeira execução (evidência em `.../homologacao-previa-execucao-1/`) apontou dois problemas reais e dois do
próprio roteiro. As execuções seguintes, depois das correções, passaram inteiras: a do commit `dbb6a2c` e a da
publicação final.

| Achado | Causa | Correção |
|---|---|---|
| **Gravação aceita logo depois da suspensão em somente leitura** | O cadastro de empresas e o de perfis ficavam numa memória de 15 s por instância. A suspensão feita pelo Interos numa instância demorava até 15 s para valer nas outras. | Empresas e perfis saíram da memória entre requisições (continuam memorizados dentro da requisição). A suspensão vale na hora em todas as instâncias. |
| **Login recusado logo depois da reativação** | A mesma memória de 15 s | Mesma correção |
| Telas de outra empresa "com status 200" (roteiro) | Com o carregamento progressivo, o Next envia a página de "não encontrado" com status 200 | O roteiro passou a exigir a página de "não encontrado" **e** a ausência, na resposta inteira, dos nomes do registro da outra empresa. Nenhum dado vazou nas duas execuções. |
| Exportação "404" (roteiro) | Chave de exportação errada no roteiro (`clientes` em vez de `customers`) | Chave corrigida |

Na mesma rodada, a recusa em somente leitura passou a explicar a suspensão (antes falava de "dados de outra
empresa"), e a trilha de auditoria continua registrando consultas e exportações nesse modo.

## 4. Como repetir

```
BASE=https://intercerterp-git-claude-eager-tesla-oark2w-martinsphilippes.vercel.app \
PROV_TOKEN_FILE=<arquivo com o token de provisionamento> TORRE_TOKEN_FILE=<arquivo com o token da Torre> \
SETUP_TOKEN_FILE=<arquivo com o SETUP_TOKEN> OUT=<pasta de evidências> \
node scripts/interos/homologacao-previa.mjs
```

Cada execução cria duas empresas novas, com conta, CNPJ e e-mails únicos da execução. Nada é reaproveitado, e o
relatório sai em `OUT/homologacao.json`.
