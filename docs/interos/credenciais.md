# Credenciais do Interos no ERP: um esquema para as três APIs

> **Situação:** implementado em 26/11/2026 (pendência 2 da integração).
> - Código: `src/lib/service/credentials.ts` (registro), `src/lib/service/signature.ts` (assinatura),
>   `src/lib/service/http.ts` (provisionamento e Torre) e `src/lib/integrations/interos-auth.ts` (licenças e módulos).
> - Testes: `tests/interos-credenciais.test.ts`.
> - Substitui `INTEROS_CLIENTS` (registro separado das licenças, retirado) e o gerador `new-interos-token.ts`.

## 1. Uma credencial, três APIs

Todas as APIs ficam no mesmo endereço do ERP (`ERP_INTERCERT_URL`). As variáveis temporárias
`ERP_INTERCERT_URL_PROVISIONAMENTO` e `ERP_INTERCERT_URL_TORRE` deixam de ser necessárias.

| API | Caminhos | Família de escopos | Variável no Interos |
|---|---|---|---|
| Provisionamento | `/api/interos/v1/status`, `/api/interos/v1/empresas/...` | `provisionamento:leitura`, `provisionamento:escrita` | `ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO` |
| Torre de Controle | `/api/interos/v1/empresas/{id}/torre/...` | `torre:resumo`, `torre:detalhe`, `torre:transacoes` | `ERP_INTERCERT_CREDENCIAL_TORRE` |
| Licenças e módulos | `/api/interos/v2/...`; v1 de módulos: `/api/interos/v1/catalog`, `/companies/...`, `/operations/...` | `erp.license.read`, `erp.license.write`, `erp.modules.read`, `erp.modules.write`, `erp.usage.read` | `ERP_INTERCERT_TOKEN_LICENCAS` e `ERP_INTERCERT_SEGREDO_ASSINATURA` |

- **Formato único do token:** `Authorization: Bearer <id>.<segredo>`.
  - `id`: 3 a 64 caracteres (`A–Z a–z 0–9 . _ -`);
  - `segredo`: 43 caracteres base64url (256 bits).
- **Escopos separados:** cada credencial tem escopos de uma só família. Uma credencial que misture famílias é
  recusada inteira (`401`). Quem consulta indicadores não cria empresas; quem aplica licença não suspende conta.
- `GET /api/interos/v1/status` aceita qualquer família. Ele devolve `cliente.familia`, `escopos`, `empresas` e
  `assinaturaExigida`: serve para conferir a credencial sem efeito nenhum.

## 2. Registro no ERP (`INTEROS_CREDENCIAIS`)

O ERP guarda **só o hash SHA-256 do segredo**, numa lista JSON:

```json
[
  { "id": "interos-prov-hml", "nome": "Interos — provisionamento (homologação)",
    "escopos": ["provisionamento:leitura", "provisionamento:escrita"], "hash": "sha256:<hex>" },
  { "id": "interos-torre-hml", "nome": "Interos — Torre (homologação)",
    "escopos": ["torre:resumo", "torre:detalhe", "torre:transacoes"], "hash": "sha256:<hex>" },
  { "id": "interos-licencas-hml", "nome": "Interos — licenças (homologação)",
    "escopos": ["erp.license.read", "erp.license.write", "erp.modules.read", "erp.usage.read"], "hash": "sha256:<hex>",
    "empresas": ["<id ERP da empresa do piloto>", "…"], "assinatura": "INTEROS_ASSINATURA_HML" }
]
```

| Campo | Obrigatório | Uso |
|---|---|---|
| `id` | sim | Primeira parte do token. Aparece na trilha de cada chamada. |
| `nome` | não | Descrição legível. |
| `escopos` | sim | Uma família só (§1). |
| `hash` | sim | `sha256:` + hex do SHA-256 do segredo. |
| `empresas` | não | As únicas empresas (id ERP) que a credencial alcança (§4). Ausente = todas. |
| `assinatura` | só para gravar licença | **Nome** da variável do ERP com o segredo HMAC (§3). Durante a troca do segredo, uma lista com os dois nomes. |
| `ativo` | não | `false` desliga a credencial sem apagá-la. |

**Gerador:** `node scripts/interos/credencial.mjs <id> <escopo...> [--empresas=a,b] [--assinatura=VARIAVEL]`.
- Mostra o token e, com `--assinatura`, o segredo HMAC **uma única vez**.
- Imprime a entrada pronta para `INTEROS_CREDENCIAIS`.
- Recusa misturar famílias e recusa uma credencial de licenças com escrita sem `--assinatura`.

## 3. Assinatura das gravações (`X-Interos-Signature`)

**Formato:** `X-Interos-Signature: t=<unix>,v1=<hex>`, em que `v1 = HMAC-SHA256(segredo, "<t>.<corpo bruto>")`.
- A janela é de ±5 minutos, contra repetição.
- A comparação é feita em tempo constante.
- Os eventos do ERP para o Interos usam o mesmo formato, em `X-ERP-Signature`.

| Quando | Regra |
|---|---|
| Gravação de licença (`PUT /api/interos/v2/companies/{id}/license`) | Sempre assinada, mais `X-Interos-Event-Id` único (8 a 200 caracteres). Sem segredo configurado no ERP, responde `503 signing_not_configured`: nunca aceita sem assinatura. |
| Qualquer gravação de uma credencial com `assinatura` (provisionamento, v1 de módulos) | Assinada. Sem o cabeçalho: `401 assinatura_obrigatoria` / `signature_required`. Com assinatura errada: `401 assinatura_invalida` / `signature_invalid`. |
| Leituras | Nunca exigem assinatura. |

O segredo tem 32 caracteres ou mais e fica só nas variáveis do servidor, dos dois lados. O mesmo valor vai na variável
indicada em `assinatura` (ERP) e em `ERP_INTERCERT_SEGREDO_ASSINATURA` (Interos).

## 4. Restrição por empresa (`empresas`)

Na homologação, a credencial de licenças alcança **só as empresas do piloto**.

| API | Empresa fora da lista |
|---|---|
| Licenças v2 | `403 company_not_allowed`. As listas (`/companies`, `/errors`, `/upsell-requests`) só trazem as empresas da credencial. |
| Módulos v1 (leitura, simulação, aplicação, linha de base, histórico, operações) | `403 company_not_allowed`. A lista `/companies` só traz as empresas da credencial. |
| Provisionamento e Torre | `403 empresa_nao_permitida`. A lista `/empresas` só traz as empresas da credencial. Uma credencial restrita também não cria nem vincula empresas (`POST /empresas` e `POST /empresas/vincular`). |

A recusa acontece **antes** de qualquer leitura ou gravação: nada muda na empresa recusada (teste automatizado em
`tests/modules-enablement.test.ts` e `tests/interos-credenciais.test.ts`).

## 5. Rotação sem parada

**Token:**
1. O ERP cadastra a credencial nova (outro `id`, mesmos escopos) **junto** com a antiga e publica.
2. O Interos troca o valor da variável e publica.
3. O ERP retira a antiga e publica. Daí em diante o token antigo responde `401`.

**Segredo de assinatura:**
1. O ERP cadastra a variável nova e põe os dois nomes em `assinatura` (`["INTEROS_ASSINATURA_HML_2", "INTEROS_ASSINATURA_HML"]`).
   Assinaturas com qualquer um dos dois valem.
2. O Interos troca `ERP_INTERCERT_SEGREDO_ASSINATURA`.
3. O ERP deixa só o nome novo e apaga a variável antiga.

**Revogação:** retirar a credencial (ou `"ativo": false`) e publicar derruba o acesso em seguida.

## 6. Respostas de autenticação

| Situação | Provisionamento e Torre (`{erro}`) | Licenças e módulos (`{error}`) |
|---|---|---|
| Nenhuma credencial configurada no ERP | `503 servico_nao_configurado` | `503 integration_not_configured` |
| Token ausente, malformado, desconhecido ou errado (mesma resposta: não revela se o `id` existe) | `401 nao_autenticado` | `401 unauthenticated` |
| Escopo de outra família ou insuficiente | `403 sem_permissao` | `403 insufficient_scope` |
| Empresa fora de `empresas` | `403 empresa_nao_permitida` | `403 company_not_allowed` |
| Gravação sem assinatura exigida / com assinatura errada | `401 assinatura_obrigatoria` / `assinatura_invalida` | `401 signature_required` / `signature_invalid` |

## 7. Entrega dos valores

**Passo a passo (homologação)**, feito por quem tem acesso às duas contas da Vercel, no próprio computador:
1. Gere as três credenciais com o gerador do ERP (`node scripts/interos/credencial.mjs`, que usa gerador
   criptográfico e mostra cada valor uma única vez, só no terminal):
   - licenças: `interos-licencas-hml erp.license.read erp.license.write erp.modules.read erp.usage.read --empresas=<ids do piloto> --assinatura=INTEROS_ASSINATURA_HML`;
   - provisionamento: `interos-prov-hml provisionamento:leitura provisionamento:escrita`;
   - Torre: `interos-torre-hml torre:resumo torre:detalhe torre:transacoes`.
2. Cole na Vercel do **Interos** (ambiente Preview):
   - `ERP_INTERCERT_URL`: o endereço da homologação do ERP;
   - `ERP_INTERCERT_TOKEN_LICENCAS`, `ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO` e `ERP_INTERCERT_CREDENCIAL_TORRE`: os tokens;
   - `ERP_INTERCERT_SEGREDO_ASSINATURA`: o segredo de assinatura.
3. Cole na Vercel do **ERP** (Preview da branch de homologação):
   - o mesmo segredo de assinatura em `INTEROS_ASSINATURA_HML`;
   - o segredo dos avisos do ERP para o Interos em `INTEROS_OUTBOUND_SECRET`. É o valor que o Interos manda pelo cofre
     de senhas, o mesmo do `ERP_INTERCERT_SEGREDO_EVENTOS` deles. O destino (`INTEROS_EVENTS_URL`) já está configurado.
4. Acrescente ao `INTEROS_CREDENCIAIS` do ERP as três "entradas" que o gerador imprimiu. São só hashes, não
   segredos.
5. Publique de novo os dois projetos: a Vercel só aplica variável nova na próxima publicação.
6. Depois que o Interos confirmar as credenciais novas, retire do registro as anteriores (`interos-equipe-*`).

- Cada valor vai **direto para as variáveis da Vercel**, colado por quem tem acesso a elas. Do lado do ERP, isso
  vale para `INTEROS_CREDENCIAIS` (só hashes) e para a variável do segredo de assinatura. Do lado do Interos, para o
  token e o segredo.
- Nunca por chat, e-mail ou documento.
- Primeiro os de homologação, restritos às empresas do piloto. Os de produção só depois da homologação aprovada.
- Homologação e produção têm credenciais e segredos **diferentes** (ids com sufixo `-hml` e `-prd`).
