# Integrações

Princípios: contratos independentes de fornecedor, adaptador real + adaptador de **simulação** explicitamente rotulado, credenciais **somente por referência** (o banco guarda o nome da variável de ambiente, nunca o valor), estados **medidos** (`não configurada`, `configurada sem teste`, `operacional`, `indisponível`, `erro`; o simulador aparece como `Simulação`, nunca `Operacional`), referência única por operação externa, registro de execução saneado (`integration_logs`) e reprocessamento por tarefa durável.

## Resumo — o que foi comprovado e onde

| Integração | Adaptador real | Consumidor | Teste local (contrato) | Sandbox/homologação | Produção |
|---|---|---|---|---|---|
| Appwrite (banco, Auth, Storage) | `AppwriteStore`, `AppwriteAuth`, `AppwriteFileStorage`, `provisionAppwrite` | Todo o sistema | **Comprovado** em Appwrite 1.8.0 self-hosted (Docker): provisionamento de ~75 tabelas, transações, índices únicos, incrementos com limite, Auth, Storage, seed completo, backup e restauração em nova base | — | Appwrite Cloud: **não testado** (rede deste ambiente bloqueia `cloud.appwrite.io`; endpoint e Project ID não fornecidos) |
| NF-e / NFC-e / NFS-e — Focus NFe | `FocusNfeProvider` (API v2; NFS-e municipal `/v2/nfse` e nacional `/v2/nfsen`) | Fiscal, PDV, devoluções, compras | Contrato testado contra **servidor HTTP falso** que imita a Focus (envio 202/processando, consulta autorizado, 401 → erro) — `tests/fiscal.test.ts` | **Não executado** (sem token; rede bloqueia a Focus) | Não |
| Fiscal — simulação | `SimulatedFiscalProvider` (rotulado, valida NCM/CFOP, simula rejeição) | Demonstração | Comprovado | — | — |
| Pix — Mercado Pago | `MercadoPagoProvider` (`X-Idempotency-Key` = referência; consulta por `external_reference`; estorno) | PDV → pagamento | Contrato coberto por testes de intenção (pendente/confirmado/falha com consulta da referência anterior) usando o provedor de simulação | **Não executado** (sem `MERCADOPAGO_ACCESS_TOKEN`) | Não |
| Cartões | Registro manual de NSU/autorização (maquininha); recebível contra adquirente; liquidação com taxa | PDV, Financeiro → cartões | Comprovado | — | — |
| TEF | Conector local (contrato HTTP abaixo) | Terminais / PDV | Teste feito **pelo navegador do caixa** (o servidor nunca acessa o conector); a Central de integrações mostra o resultado medido dos terminais — `tests/integrations.test.ts`, `tests/admin-access.test.ts` | Depende do software do conector | Não |
| Banco — arquivos | Parsers OFX, CSV (mapeável), CNAB 240 (FEBRABAN T/U), CNAB 400 (Itaú, Bradesco) | Conciliação | Comprovado com arquivos de exemplo (`tests/fixtures`) | Layouts devem ser homologados com arquivos reais dos bancos | — |
| Banco — API/Open Finance | Não implementado (estado “indisponível” na central) | — | — | — | — |
| E-mail | Resend (API) e Appwrite Messaging | Convites, recuperação local, cobrança, documentos, chamados, contabilidade | Sem canal configurado: todas as telas registram “não enviado / canal não configurado” (comprovado) | Não executado (sem chave) | Não |
| Recuperação de senha | Appwrite Auth `createRecovery`/`updateRecovery` | Login | Fluxo local comprovado; Appwrite local sem SMTP | — | Appwrite Cloud envia pelo próprio SMTP |
| Consulta CNPJ | BrasilAPI (pública) | Clientes, fornecedores | Rede deste ambiente bloqueia; erro tratado e exibido | — | — |
| Contabilidade | Pacote ZIP (XMLs armazenados + CSVs + manifesto SHA-256) e envio por e-mail | Fiscal → relatórios | Pacote comprovado (ZIP inspecionado em teste) | — | — |

## Configuração (variáveis de ambiente)

| Variável | Uso |
|---|---|
| `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY`, `APPWRITE_DATABASE_ID` | Banco, Auth e Storage |
| `FOCUSNFE_TOKEN` (nome configurável em Fiscal → Configurações) | NF-e/NFC-e/NFS-e |
| `NFCE_CSC` (nome configurável) | CSC da NFC-e |
| `MERCADOPAGO_ACCESS_TOKEN` (nome configurável) | Pix |
| `RESEND_API_KEY` (nome configurável) | E-mail |
| `CRON_SECRET` | Protege `/api/jobs` (Vercel Cron) |
| `SETUP_TOKEN` | Protege o primeiro acesso/provisionamento |

Na Central de integrações (Administração → Integrações) cada integração mostra se a variável referenciada está **definida no servidor** (sem revelar o valor), o último teste medido, pendências (tarefas em retentativa/falhas) com reprocessamento e o histórico de execuções.

## Tarefas duráveis e rotinas

`/api/jobs` (Vercel Cron diário — limite do plano Hobby; tarefas vencidas também rodam em segundo plano após cada ação de usuário e por “Executar tarefas pendentes agora”) processa: efeitos da venda (`sale.effects`), transmissão/consulta/cancelamento fiscal, recálculo de saldo de conta, backup agendado e rotinas diárias (vencidos, contas a pagar do dia, obrigações fiscais, acompanhamento de compras, estoque, retenção de backup). Cada tentativa é reivindicada por registro único (nunca executa duas vezes em paralelo) e usa recuo exponencial; esgotadas as tentativas, a tarefa vira “morta” e gera notificação.

## Conector de periféricos

O PDV roda no navegador. Impressoras térmicas, leitores HID e pinpads TEF, porém, falam com o computador do caixa (USB/serial/rede local), não com o servidor na nuvem. O **conector de periféricos** é um pequeno serviço HTTP instalado **no computador de cada caixa** que faz essa ponte. Ele é opcional: sem conector, a impressão usa o diálogo do navegador e o leitor funciona como teclado.

### Topologia

```
[Navegador do caixa] ──HTTPS──> [ERP (Vercel) + Appwrite]
        │
        └──HTTP local──> [Conector] ──USB/serial/rede──> impressora · leitor HID · pinpad TEF
             http://127.0.0.1:9100
```

- O endereço do conector é configurado por terminal (Administração → Terminais → *URL do conector local*).
- Como o conector escuta em `127.0.0.1`, **somente o navegador daquele computador** o alcança. Por isso o teste em *Periféricos e testes* é feito pelo navegador e o resultado medido é gravado no terminal e no histórico de auditoria. **O servidor nunca faz requisições à URL do conector** (evita SSRF); a Central de integrações (Cartões/TEF → TEF via conector local) deriva o estado das verificações recentes (7 dias) registradas pelos navegadores dos terminais.
- Sem URL configurada, o teste registra **"não verificado"** — o ERP nunca presume periférico funcionando.

### Requisitos HTTP

- Escutar apenas em `127.0.0.1` (ou rede local confiável), porta padrão `9100`.
- CORS: responder a `OPTIONS` e incluir `Access-Control-Allow-Origin: <origem do ERP>`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization`.
- Private Network Access (Chrome): no preflight, responder `Access-Control-Allow-Private-Network: true`.
- Autenticação opcional por `Authorization: Bearer <token>` (token configurado no conector; no ERP fica apenas a referência ao segredo, nunca o valor).
- Respostas em JSON UTF-8. Tempo limite do ERP: 5 s no `/status`.

### Contrato

#### `GET /status`

Saúde do conector e dos periféricos. `200` quando o conector está no ar (mesmo que algum periférico esteja indisponível).

```json
{
  "ok": true,
  "version": "1.2.0",
  "printer": { "name": "Elgin i9", "ready": true, "paperWidth": 80, "error": null },
  "scanner": { "connected": true, "mode": "hid" },
  "tef": { "provider": "sitef", "ready": false, "error": "pinpad desconectado" }
}
```

O ERP considera o teste **OK** quando o HTTP é 2xx, `ok` não é `false` e, se o terminal imprime pelo conector, `printer.ready` não é `false`. Qualquer outro caso é registrado como falha com a mensagem recebida (ou o erro de rede/tempo limite).

#### `POST /print`

Imprime um cupom. O ERP envia o conteúdo já formatado para a largura do papel.

```json
{ "jobId": "venda-123-nfce", "paperWidth": 80, "format": "text", "content": "...linhas...", "cut": true, "openDrawer": false, "qrCode": "https://..." }
```

Resposta: `{ "jobId": "venda-123-nfce", "status": "printed" | "queued" | "failed", "error": null }`. O `jobId` é a chave de idempotência — reenviar o mesmo `jobId` não imprime duas vezes.

#### `POST /drawer/open`

Abre a gaveta de dinheiro. Resposta `{ "ok": true }`.

#### `GET /scanner/events` (opcional, leitor HID)

Server-Sent Events com `data: {"code":"7891000100011","at":"2026-10-05T12:00:00Z"}` a cada leitura. No modo "teclado" o leitor digita no campo ativo e este endpoint não é usado.

#### `POST /tef/transactions` (opcional, TEF)

```json
{ "reference": "venda-123-pag-1", "amount": 15990, "kind": "credit", "installments": 3 }
```

Resposta final (síncrona ou via `GET /tef/transactions/{reference}`): `{ "reference": "...", "status": "approved" | "denied" | "cancelled" | "pending", "nsu": "123456", "authCode": "A1B2C3", "brand": "VISA", "receipt": "...via do cliente..." }`. Valores sempre em centavos; `reference` é idempotente.

### Situação nesta versão

- Implementado no ERP: cadastro da URL por terminal (sem usuário/senha, parâmetros ou fragmento), teste real do `/status` pelo navegador do caixa com registro do resultado, estado do TEF na Central derivado dessas verificações, página de teste de impressão pelo navegador.
- O conector em si é um componente externo a ser instalado nas máquinas de caixa (não incluído neste repositório). Enquanto não houver conector, use impressão pelo navegador, leitor em modo teclado e maquininha avulsa com registro manual de NSU.
