# Integrações

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
- Como o conector escuta em `127.0.0.1`, **somente o navegador daquele computador** o alcança. Por isso o teste em *Periféricos e testes* é feito pelo navegador e o resultado medido é gravado no terminal e no histórico de auditoria. O botão "Testar a partir do servidor" só serve para conectores expostos em endereço de rede alcançável pelo servidor.
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

- Implementado no ERP: cadastro da URL por terminal, teste real do `/status` (pelo navegador e pelo servidor) com registro do resultado, página de teste de impressão pelo navegador.
- O conector em si é um componente externo a ser instalado nas máquinas de caixa (não incluído neste repositório). Enquanto não houver conector, use impressão pelo navegador, leitor em modo teclado e maquininha avulsa com registro manual de NSU.
