# Pendências externas reais

Itens que dependem de recurso externo, credencial ou ação do titular. O código, os adaptadores e as telas correspondentes estão implementados; nenhum destes estados é apresentado como concluído na aplicação.

| # | Pendência | O que falta | Onde configurar | Impacto enquanto pendente |
|---|---|---|---|---|
| 1 | **Appwrite Cloud** | Endpoint (`https://<região>.cloud.appwrite.io/v1`) e Project ID. A API key já foi recebida (guardada fora do repositório). | Variáveis na Vercel; depois `/primeiro-acesso` (provisiona pelo próprio app) ou `npm run appwrite:setup` | Sem isso a publicação na Vercel só roda em modo memória (demonstração volátil) |
| 2 | **Publicação na Vercel** | Vincular o repositório ao projeto `intercerterp` e cadastrar variáveis (1, `CRON_SECRET`, `SETUP_TOKEN`) | Vercel | — |
| 3 | **Focus NFe** | Token de homologação e de produção; certificado A1 e CSC cadastrados no painel da Focus; validar NFS-e nacional (`/v2/nfsen`) na homologação | Fiscal → Configurações / Integrações | Documentos ficam “pendente de configuração” (ou simulação rotulada na demo) |
| 4 | **Pix (Mercado Pago)** | `MERCADOPAGO_ACCESS_TOKEN` | Integrações → Pix | PDV aceita Pix manual com comprovante; cobrança integrada indisponível |
| 5 | **E-mail** | Resend (`RESEND_API_KEY`, remetente verificado) ou provedor no Appwrite Messaging | Integrações → E-mail | Convites mostram o link para copiar; envios registram “não enviado” |
| 6 | **TEF / periféricos** | Instalar o conector local em cada caixa (contrato HTTP em `docs/integracoes.md`) | Administração → Terminais | Cartão registrado manualmente (NSU); impressão pelo navegador |
| 7 | **Bancos** | Arquivos reais de retorno CNAB para homologar layouts (Itaú campo 254–266); API de cobrança/Open Finance para registro de boletos e sincronização automática | Conciliação | Importação de arquivos funciona; boletos não são registrados no banco |
| 8 | **Parâmetros fiscais da empresa real** | NCM/CFOP/CST por produto, grupos tributários, prazos de cancelamento e calendário de obrigações validados pela contabilidade | Produtos / Fiscal | Os valores da demonstração são exemplos |
| 9 | **Restauração em nova base Appwrite** | Plano do Appwrite que permita múltiplos bancos no mesmo projeto | Appwrite | Restauração em base de teste continua disponível |
