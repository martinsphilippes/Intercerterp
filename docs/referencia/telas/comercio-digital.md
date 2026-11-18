# Comércio digital — Telas 49 a 64 (guia visual v2.0)

Fonte oficial: `docs/referencia/Intercert_ERP_64_Telas_Comentadas.pdf` (v2.0, 125 páginas; Telas 49–64 nas páginas 81–125).
Decisões e regras assumidas: `docs/regras-assumidas.md` §49. Cobertura: `docs/matriz-cobertura.md` (seção “Comércio digital”).
Testes: `tests/ecommerce.test.ts` (12 cenários, banco em memória e PostgreSQL) e `tests/ecommerce-demo.test.ts` (demonstração).

## 1. Problema

O varejista que usa o ERP vende só no balcão. Para vender pela internet ele precisaria de outra plataforma, com outro
cadastro de produtos, outro estoque, outro financeiro e conciliação manual — retrabalho, venda sem estoque e divergência
entre o que entrou no banco e o que foi vendido.

## 2. Objetivo

Loja virtual **nativa do ERP**, uma por empresa cliente, com domínio próprio, que usa o mesmo produto, SKU, preço, estoque,
cliente, nota fiscal e financeiro da operação física. O pedido conserva a mesma referência no pagamento, na nota, na
expedição e no recebível (guia, p. 123). Gateway Intercert, Banco Intercert, logística e marketplaces entram depois, por
conectores — o ambiente fica pronto para recebê-los.

Decisões do titular (18/11/2026): cada empresa tem a própria loja com domínio próprio; Gateway e Banco Intercert serão
integrados depois (deixar o ambiente pronto); loja própria primeiro; entrega por retirada, entrega própria, entrega de
terceiros e transportadora.

## 3. Requisitos funcionais (por tela)

| Tela | Rota | O que faz |
|---|---|---|
| 49 Central | `/comercio-digital` | Cria a loja (rascunho); indicadores reais; “Preparar para vender” com as pendências reais; situação das integrações; atalhos. |
| 50 Modelos | `/comercio-digital/modelos` | Essencial (varejo geral), Coleção (destaque editorial), Campanha (oferta principal); prévia computador/celular; comparação; aplicar ao rascunho. |
| 51 Editor e domínio | `/comercio-digital/editor` | Nome, título, texto de apoio, cor, seções, benefícios, SEO, logotipo e destaque; dados do fornecedor; páginas legais; domínio próprio; requisitos de publicação; publicar e pausar. |
| 52 Catálogo | `/comercio-digital/catalogo` | Produtos do ERP marcados “venda on-line”; título, descrição, categoria, preço da loja e preço “de”, peso e medidas, fotos, destaque, presença; pendências; validar seleção. |
| 53 Canais | `/comercio-digital/canais` | Conectores planejados (Mercado Livre, Amazon, Shopee, Magalu, Instagram, Facebook, TikTok Shop, Google Shopping, YouTube Shopping, WhatsApp); preparar conta em rascunho. |
| 54 Pedidos | `/comercio-digital/pedidos` (+ `/[id]`) | Busca e situação; etapas; itens e totais; reserva; NF-e do pedido; expedição; cancelamento com estorno; devolução. |
| 55 Promoções | `/comercio-digital/promocoes` | Cupom (código, %, teto, mínimo, vigência, limites, frete grátis) com prévia e teste; recuperação de carrinhos em rascunho. |
| 56 Gateway e checkout | `/comercio-digital/pagamentos` | Pix, cartão (parcelas, parcela mínima), boleto, NF-e automática; simulador de retorno; regras do checkout; fluxo financeiro por origem. |
| 57 Banco Intercert | `/comercio-digital/banco` | Bruto, taxa, líquido e crédito previsto; créditos; conciliação no recebível; conta da loja; repasse em rascunho. |
| 58 Frete | `/comercio-digital/frete` | Quatro modalidades; filial de expedição; CEP de origem; prazo de separação; faixas de CEP da entrega própria; frete grátis; embalagem padrão; cotação de exemplo. |
| 59 Expedição | `/comercio-digital/expedicao` | Fila; conferência; etiqueta ou romaneio; despacho; retirada com código; entrega concluída; acompanhamento. |
| 60 Monitor | `/comercio-digital/monitor` | Eventos (EV-nnn) por área e situação; tentativas, diagnóstico e chave; corrigir a origem e reprocessar; ignorar com justificativa. |
| 61 Loja pública | `/loja/<endereço>` ou domínio | Modelo, busca, categorias, destaques, grade, benefícios, rodapé com o fornecedor. |
| 62 Produto | `…/produto/<produto>` | Fotos/ilustração, marca, SKU, descrição, variação, disponibilidade, quantidade, adicionar e comprar agora. |
| 63 Carrinho | `…/carrinho` | Quantidades, cupom, CEP e entrega, totais, bloqueios. |
| 64 Checkout e acompanhamento | `…/checkout`, `…/pedido/<código>` | Identificação, endereço, entrega, pagamento, aceite; acompanhamento com Pix, boleto, retirada, rastreio, cancelamento e devolução. |

## 4. Regras de negócio

1. **Uma loja por empresa** (id determinístico); endereço único (`/loja/<endereço>`); nasce em rascunho.
2. **Publicar exige**: identidade, ao menos um produto vendável, um meio de pagamento, uma forma de entrega, dados do
   fornecedor (razão social, CNPJ, endereço, contato — Decreto 7.962/2013) e termos/privacidade/trocas preenchidos.
   NF-e configurada e domínio próprio são avisos, não bloqueios.
3. **Vendável** = publicado no catálogo, sem pendência bloqueante (inativo, serviço, kit, sem SKU, sem preço, sem NCM e —
   com transportadora ou terceiros ligados — sem peso) e com preço > 0.
4. **Preço** = preço da loja (quando definido) ou o da tabela padrão do ERP para a filial de expedição.
5. **Disponível** = físico − reservado no depósito padrão da filial, menos o estoque de segurança da loja.
6. **Carrinho** guarda só SKU e quantidade; tudo é recalculado no servidor; quantidade limitada ao disponível (máx. 99).
7. **Cupom**: desconto só sobre os produtos (frete fora), com compra mínima e teto por pedido; uso contado ao fechar o
   pedido (limite atômico) e devolvido no cancelamento; limite por cliente (CPF/CNPJ ou e-mail).
8. **Frete grátis**: quando os produtos após desconto atingem o mínimo; só na entrega padrão da transportadora e nas
   modalidades marcadas. A cotação é refeita no fechamento: o preço nunca vem do navegador.
9. **Pedido** nasce “aguardando pagamento” com o estoque reservado (tudo ou nada). Pix vence no prazo da loja; boleto um
   dia após o vencimento. Vencido → cancelado e reserva liberada (rotina diária + oportunista no checkout e na gestão;
   gateway real tem 30 min de folga para aviso atrasado).
10. **Pagamento** por eventos idempotentes (chave do provedor): repetido não refaz efeito; antigo não faz retroceder;
    aprovação após cancelamento vira estorno pendente.
11. **Aprovado** → recebível contra o gateway (parcelas no prazo do meio; cartão parcelado mensal) + transação do gateway.
12. **NF-e** modelo 55, presença 2 (internet), destinatário do checkout, desconto rateado nos itens, frete no total,
    efeitos travados (o pedido cuida de estoque e financeiro). Autorização libera a expedição; cancelamento da nota volta
    o pedido a “pago — a faturar”.
13. **Expedição exige pagamento aprovado e NF-e autorizada**. A saída (despacho ou retirada com código) consome a reserva
    e lança a baixa de venda numa única transação, uma única vez.
14. **Cancelamento** antes da saída (NF-e autorizada precisa ser cancelada antes no Fiscal); pago → estorno e cancelamento
    do recebível ainda sem baixa.
15. **Arrependimento**: até 7 dias do recebimento/retirada (CDC art. 49); defeito pelos prazos do art. 26. Mercadoria
    recebida → entrada de devolução no estoque (uma vez) e estorno.
16. **Proteção da reserva**: no máximo 3 pedidos não pagos por acesso (IP) e 2 por e-mail na mesma loja.
17. **Domínio próprio** só abre a loja depois de verificado: apontamento (CNAME/A) **e** TXT `_intercert.<domínio>` com o
    código da loja (prova de propriedade). Enquanto pendente, outra loja pode cadastrar o mesmo domínio; só uma ativa.

## 5. Casos especiais

- Produto com variações: cada SKU tem estoque e disponibilidade próprios; a variação é obrigatória para comprar.
- Retirada em outra filial: a reserva e a nota saem da filial da retirada.
- Pedido de demonstração/prévia: checkout só com a loja publicada; prévia por cookie gerado pelo ERP.
- Cobrança não gerada (falha do gateway): o pedido fica aguardando, com “Gerar cobrança novamente”; vence normalmente.
- Domínio do próprio ERP: precisa estar em `APP_HOSTS` (senão o host vira vitrine e mostra “endereço não ligado”).
- Kit (baixa por componentes): bloqueado na loja nesta versão.

## 6. Fluxo do usuário

Lojista: Central → Modelos → Editor (identidade, dados, páginas, domínio) → Catálogo → Pagamentos → Frete → Publicar.
Cliente: Vitrine → Produto → Carrinho → Checkout → Acompanhamento. Operação: Pedidos → NF-e → Expedição → Entrega →
Banco (crédito e conciliação) → Monitor.

## 7. Papéis e permissões

Operações especiais (módulo Vendas): `ecommerce.manage` (loja, domínio, canais, pagamentos, frete, monitor),
`ecommerce.catalog`, `ecommerce.orders` (pedidos e expedição), `ecommerce.cancel` (cancelar e devolver),
`ecommerce.marketing` (cupons e carrinhos), `ecommerce.finance` (banco e conciliação). Gerente: todas; Caixa e Estoque:
pedidos; Financeiro: finanças; Administração: todas. Emitir NF-e continua exigindo `fiscal.issue`. Recurso
`feature.comercioDigital` (ligado para varejo).

## 8. Estrutura do banco

`stores`, `store_domains`, `store_products`, `store_carts`, `store_coupons`, `online_orders`, `online_order_events`,
`commerce_events`, `store_channels`, `gateway_transactions`, `store_payouts` (`src/lib/db/schema.ts`). Reutiliza
`products`, `skus`, `prices`, `stock_balances`, `stock_reservations`, `stock_movements`, `customers`, `fiscal_documents`,
`titles`, `installments`, `settlements`, `files`.

## 9. APIs e integrações

| Frente | Hoje | Ponto de ligação |
|---|---|---|
| Gateway Intercert | Simulação (Pix, cartão de teste, boleto) | `src/domain/ecommerce/providers.ts` (`intercertGateway`); avisos em `POST /api/loja/gateway/intercert/<loja>` com HMAC-SHA256 (`x-intercert-timestamp`, `x-intercert-signature`); segredos `GATEWAY_INTERCERT_*` na Central de integrações. |
| Banco Intercert | Simulação (crédito no prazo do meio; repasse em rascunho) | `bankFor` (`BANCO_INTERCERT_*`). |
| Logística | Simulação (tabela por faixa de CEP e peso tarifável) | `logisticsFor` — plataforma de fretes (`FRETES_*`) e entrega por aplicativo (`ENTREGAS_*`). |
| Domínios | DNS público (apontamento + TXT) | API da hospedagem (`DOMINIOS_API_TOKEN`, projeto) cadastra o domínio no projeto. |
| CEP | ViaCEP no navegador (preenche endereço e código IBGE) | — |
| E-mail ao cliente | Canal de e-mail da empresa, quando configurado | `sendEmail`. |

## 10. Automações

Expiração de pedidos não pagos (rotina diária `ecommerce.expire` + checkout + gestão); NF-e automática ao aprovar
(opcional); aviso ao cliente (pago, pronto para retirada, despachado, entregue, cancelado); notificação interna de pedido
pago, devolução, pagamento tardio e contestação; revalidação do catálogo ao salvar.

## 11–13. Relatórios, painéis e indicadores

Central: produtos no ERP, itens vendáveis, filiais, pedidos do dia (valor), a faturar, a expedir/retirar. Pedidos: por
situação. Catálogo: disponíveis, no catálogo, vendáveis, com pendência. Banco: creditado, conciliado, previsto, taxas,
disponível para repasse. Monitor: contagens por situação.

## 14. Auditoria

Toda ação de gestão gera `audit_logs` (módulo Vendas/Financeiro); cada pedido tem linha do tempo própria
(`online_order_events`); integrações no monitor (`commerce_events`, com payload saneado — sem dados de cartão, tokens ou
senhas).

## 15. Segurança

Carrinho por cookie httpOnly; pedido por token aleatório de 128 bits; vitrine lê só dados da empresa da loja; imagens
públicas só se ligadas à loja; número do cartão nunca chega ao servidor; avisos do gateway só com assinatura válida e
recente; domínio com prova de propriedade; limite de pedidos não pagos; nenhum segredo gravado no banco.

## 16. Lacunas encontradas e opções de desenvolvimento

**Lacunas tratadas nesta versão** (não estavam no guia): identificação do fornecedor e páginas legais obrigatórias
(Decreto 7.962/2013); direito de arrependimento (CDC art. 49) no acompanhamento; consentimento separado para mensagens
(LGPD) e recuperação de carrinho só com ele; NF-e (não NFC-e) com presença “internet” e destinatário identificado; código
de retirada; faixas de CEP da entrega própria; expiração da reserva; limite de pedidos não pagos; prova de propriedade do
domínio; SEO (sitemap, robots, JSON-LD, Open Graph); cartão sem dado no servidor.

**Depende de terceiros ou de decisão do titular** (ver `docs/pendencias-externas.md`): documentação e ambiente de testes do
Gateway e do Banco Intercert; escolha da plataforma de fretes; canal de e-mail transacional; plano pago da hospedagem e do
banco para loja pública com tráfego real; revisão jurídica dos textos padrão; NF-e de entrada na devolução on-line (hoje
pelo Fiscal, referenciando a chave).

**Opções de desenvolvimento (próximas fases sugeridas)**:
1. Conta do cliente (histórico de pedidos, endereços salvos, “compre de novo”) e login sem senha por e-mail.
2. Recuperação de carrinho automática por e-mail/WhatsApp (com consentimento) e cupom de retomada.
3. Avaliações de produtos e perguntas, com moderação.
4. Marketplaces por hub (pedidos, estoque e repasses do canal entrando no mesmo fluxo).
5. Lista de desejos, alerta de “voltou ao estoque” e frete grátis por região.
6. Painel de conversão (visitas → carrinho → pedido), ticket médio e abandono por etapa.
7. Busca inteligente com sinônimos e recomendação “quem comprou também levou” (IA sobre o histórico de vendas).
8. Retirada em ponto parceiro e agendamento de entrega própria por janela de horário.
