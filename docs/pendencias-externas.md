# Pendências externas reais

Itens que dependem de recurso externo, credencial ou ação do titular. O código, os adaptadores e as telas correspondentes estão implementados; nenhum destes estados é apresentado como concluído na aplicação.

| # | Pendência | O que falta | Onde configurar | Impacto enquanto pendente |
|---|---|---|---|---|
| 1 | **Appwrite Cloud** | Endpoint (`https://<região>.cloud.appwrite.io/v1`) e Project ID. A API key já foi recebida (guardada fora do repositório). | Variáveis na Vercel; depois `/primeiro-acesso` (provisiona pelo próprio app) ou `npm run appwrite:setup` | Sem isso a publicação na Vercel mostra a página “configuração pendente” (nenhum dado gravado) |
| 2 | **Publicação na Vercel** | Vincular o repositório ao projeto `intercerterp` e cadastrar variáveis (1, `CRON_SECRET`, `SETUP_TOKEN`) | Vercel | — |
| 3 | **Focus NFe** | Token de homologação e de produção; certificado A1 e CSC cadastrados no painel da Focus; validar NFS-e nacional (`/v2/nfsen`) na homologação | Fiscal → Configurações / Integrações | Documentos ficam “pendente de configuração” (ou simulação rotulada na demo) |
| 4 | **Pix (Mercado Pago)** | `MERCADOPAGO_ACCESS_TOKEN` (o nome da variável precisa começar com `MERCADOPAGO_` ou `MP_`; o endereço da API é fixo) | Integrações → Pix | PDV aceita Pix manual com comprovante; cobrança integrada indisponível |
| 5 | **E-mail** | Resend (`RESEND_API_KEY`, remetente verificado) ou provedor no Appwrite Messaging | Integrações → E-mail | Convites mostram o link para copiar; envios registram “não enviado” |
| 6 | **TEF / periféricos** | Instalar o conector local em cada caixa (contrato HTTP em `docs/integracoes.md`) | Administração → Terminais | Cartão registrado manualmente (NSU); impressão pelo navegador |
| 7 | **Bancos** | Arquivos reais de retorno CNAB para homologar layouts (Itaú campo 254–266); API de cobrança/Open Finance para registro de boletos e sincronização automática | Conciliação | Importação de arquivos funciona; boletos não são registrados no banco |
| 8 | **Parâmetros fiscais da empresa real** | NCM/CFOP/CST por produto, grupos tributários, prazos de cancelamento e calendário de obrigações validados pela contabilidade | Produtos / Fiscal | Os valores da demonstração são exemplos |
| 9 | **Restauração em nova base Appwrite** | Plano do Appwrite que permita múltiplos bancos no mesmo projeto | Appwrite | Restauração em base de teste continua disponível |
| 10 | **Validação contábil das regras fiscais** | Conferir com a contabilidade a lista de CFOP que não compõem o faturamento (transferências, remessas, devoluções), CST 20 com redução de base e PIS/COFINS por CST | Fiscal → Relatórios / grupos tributários | Faturamento fiscal e tributos aproximados seguem as regras documentadas em `docs/regras-assumidas.md` |

## Riscos residuais conhecidos (não dependem de terceiros)

- Compras: pedido sem solicitação de aprovação não tem vaga de decisão para disputar — resta uma janela estreita de concorrência no cancelamento; “Registrar envio” concorrente com a atualização do saldo pode deixar o pedido “enviado” com tudo recebido (corrigível pelo próximo recebimento/encerramento); um XML em conferência impede o recebimento sem XML de assumir o frete do pedido (critério conservador).
- Crediário: títulos a receber criados fora da venda (manuais, renegociação) não disputam a trava de crédito do cliente; o limite é garantido entre vendas.
- Conferência cega: o valor de cada venda e de cada suprimento/sangria continua visível ao operador (necessário para operar); as somas e o recorte por sessão ficam ocultos até a contagem, e uma recontagem não apaga diferença já revelada.
- Juros da condição de parcelamento aplicam-se apenas a títulos manuais (vendas e compras não aplicam; o cadastro avisa).
