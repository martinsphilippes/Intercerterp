# Modularização integral do ERP Intercert — relatório das Fases 1 a 5

> **Situação:** levantamento e planejamento concluídos (26/11/2026). Nenhuma migração destrutiva, nenhuma mudança de contrato e nenhum bloqueio de acesso em produção foi feito nesta etapa.
>
> O runtime de habilitação v1 (`docs/modulos/`) já existe. Todo cliente atual está em `legacy`, ou seja, com o comportamento anterior.
>
> **As Fases 6 a 10 aguardam a validação das decisões do §7.**

## Onde está cada entrega

| Entrega | Arquivo |
|---|---|
| Taxonomia de referência (literal) | [../MODULE_CATALOG/taxonomia-referencia.txt](../MODULE_CATALOG/taxonomia-referencia.txt) |
| Auditoria item a item (status + evidência) | [../MODULE_CATALOG/auditoria/](../MODULE_CATALOG/auditoria/) (6 arquivos, 971 códigos) |
| Funcionalidades encontradas fora da taxonomia | [../MODULE_CATALOG/extras.tsv](../MODULE_CATALOG/extras.tsv) |
| Catálogo v2 em JSON (para o Interos) | [../MODULE_CATALOG/catalogo-modulos-erp-v2.json](../MODULE_CATALOG/catalogo-modulos-erp-v2.json) |
| Catálogo v2 legível (módulo → submódulo, status, classe, unidade, dependências, evidência) | [../MODULE_CATALOG/catalogo-v2.md](../MODULE_CATALOG/catalogo-v2.md) |
| Proprietário técnico e aliases (duplicidades) | [../MODULE_CATALOG/duplicidades.tsv](../MODULE_CATALOG/duplicidades.tsv) |
| Unidades comerciais (v1 ↔ v2) | [../MODULE_CATALOG/unidades.tsv](../MODULE_CATALOG/unidades.tsv) |
| Mapeamento das 136 tabelas do banco | [../MODULE_CATALOG/tabelas.tsv](../MODULE_CATALOG/tabelas.tsv) |
| Mapeamento de rotas, APIs, ações, exportações, rotinas e recursos | [../modulos/inventario-capacidades.md](../modulos/inventario-capacidades.md) (gerado do código) |
| Matriz de dependências (runtime) | [../modulos/matriz-dependencias.md](../modulos/matriz-dependencias.md) |
| Matriz de permissões | `catalogo-modulos-erp-v2.json` › `permissions` (60 permissões → unidades) |
| Contrato Interos v1 (implementado) | [../modulos/contrato-interos-erp-v1.md](../modulos/contrato-interos-erp-v1.md) |
| Contrato Interos v2 (proposta) | [../INTEGRATIONS/INTEROS/contrato-interos-erp-v2-proposta.md](../INTEGRATIONS/INTEROS/contrato-interos-erp-v2-proposta.md) |
| Política de segurança | [../SECURITY/politica-modularizacao.md](../SECURITY/politica-modularizacao.md) |
| Plano de migração, testes e rollback | [../MIGRATION/plano-migracao-v2.md](../MIGRATION/plano-migracao-v2.md) |

Para gerar de novo: `npx tsx scripts/modules/build-catalog-v2.ts`. O teste `tests/modules-catalog-v2.test.ts` impede, entre outras coisas:
- item "implementado" sem arquivo real de código como evidência (evidência que é só catálogo ou documentação também é recusada);
- código sem classificação;
- tabela sem módulo dono;
- alias em cadeia;
- ciclo de dependência;
- chave do runtime v1 sem unidade v2.

## 1. Como a auditoria foi feita

- A taxonomia de 50 módulos e 971 submódulos foi registrada literalmente.
- Seis frentes independentes classificaram cada código **no código-fonte**, por busca em português e inglês nos nomes, campos do esquema e rótulos de tela. Cada código recebeu status, evidência (arquivo:linha) e observação.
- O menu não foi usado como fonte. O inventário gerado do código cobre também o que não aparece no menu:
  - as 220 páginas e todas as rotas de API;
  - as 392 server actions;
  - as 59 exportações;
  - as 21 rotinas e as 10 tarefas;
  - os 2 webhooks;
  - as páginas públicas.
- Evidências abreviadas foram resolvidas para o arquivo real. Um teste confere que cada uma existe.

## 2. Números finais

| | Quantidade |
|---|---|
| **Módulos** | **53** (50 da taxonomia + 3 novos: 51, 52 e 53) |
| **Submódulos** | **1016** (971 da taxonomia + 45 achados na auditoria) |
| **Recursos (nível 4)** | **0 por enquanto**. Nenhum submódulo existente precisou ser dividido para ser vendido com segurança; o nível fica reservado para a divisão comercial (decisão 7.4). |
| Implementados e operacionais (OP) | **319** |
| Implementados parcialmente | **219** |
| Implementados com falha conhecida | **1** (02.07: IPI cadastrado mas não usado na emissão) |
| Dependentes de integração externa (EXT) | **31** (NF-e, NFC-e, NFS-e, CC-e, cancelamento e inutilização via Focus NFe; Pix via Mercado Pago; gateway, Banco e frete Intercert; TEF) |
| Em desenvolvimento | **8** (contas de marketplace "preparadas", gaveta e TEF por conector) |
| Planejados (documentados como lacuna) | **64** |
| Não implementados | **374** |
| Unidades comerciais (o que o Interos licencia) | **67**: 60 liberáveis agora e 7 ainda não (ver §5) |
| Aliases (mesma capacidade com outro código) | **37** |
| Tabelas do banco mapeadas para um dono | **136 de 136** |

Classificação comercial dos 1016 submódulos:

| Classe | Quantidade |
|---|---|
| CORE | 54 |
| MÓDULO COMERCIAL | 304 |
| ADD-ON | 133 |
| RECURSO COMPARTILHADO | 54 |
| INTEGRAÇÃO | 20 |
| PERMISSÃO | 5 |
| RECURSO FUTURO | 446 |

### Por módulo

| Módulo | Operacional | Parcial/falha | Dep. externa | Futuro | Unidades comerciais |
|---|---|---|---|---|---|
| 01 — CADASTROS BÁSICOS | 12 | 5 | 0 | 4 | 3 |
| 02 — CADASTRO E CONFIGURAÇÃO FISCAL | 15 | 8 | 0 | 2 | 2 |
| 03 — DOCUMENTOS FISCAIS DE ENTRADA | 13 | 3 | 1 | 1 | 1 |
| 04 — EMISSÃO DE DOCUMENTOS FISCAIS | 6 | 5 | 10 | 5 | 3 |
| 05 — GESTÃO DE COMPRAS | 15 | 2 | 0 | 5 | 7 |
| 06 — GESTÃO COMERCIAL E VENDAS | 13 | 10 | 0 | 2 | 4 |
| 07 — PDV — PONTO DE VENDA | 21 | 3 | 2 | 2 | 3 |
| 08 — TROCAS E DEVOLUÇÕES | 13 | 2 | 0 | 1 | 1 |
| 09 — GESTÃO DE PRODUTOS E GRADES | 14 | 6 | 0 | 4 | 2 |
| 10 — GESTÃO DE ESTOQUE | 21 | 8 | 0 | 3 | 6 |
| 11 — CATÁLOGO DIGITAL | 8 | 2 | 0 | 10 | 0 |
| 12 — E-COMMERCE E VENDAS DIGITAIS | 17 | 5 | 4 | 7 | 2 |
| 13 — WHATSAPP E ATENDIMENTO DIGITAL | 2 | 5 | 0 | 13 | 0 |
| 14 — FOOD SERVICE | 0 | 8 | 0 | 27 | 0 |
| 15 — COMPOSIÇÃO DE PRODUTOS E FICHA TÉCNICA | 5 | 8 | 0 | 7 | 1 |
| 16 — PRODUÇÃO E PCP | 0 | 3 | 0 | 27 | 0 |
| 17 — LOGÍSTICA E ENTREGAS | 5 | 7 | 3 | 15 | 0 |
| 18 — GESTÃO FINANCEIRA | 28 | 8 | 0 | 10 | 12 |
| 19 — INTEGRAÇÕES BANCÁRIAS | 1 | 10 | 2 | 12 | 0 |
| 20 — CRM E FIDELIZAÇÃO DO CLIENTE DO ERP | 3 | 9 | 0 | 10 | 1 |
| 21 — RELATÓRIOS E INTELIGÊNCIA DE NEGÓCIO | 13 | 5 | 0 | 8 | 1 |
| 22 — GESTÃO CONTÁBIL E OBRIGAÇÕES FISCAIS | 9 | 6 | 0 | 7 | 5 |
| 23 — INTEGRAÇÃO COM EQUIPAMENTOS | 4 | 6 | 0 | 6 | 0 |
| 24 — ADMINISTRAÇÃO E SEGURANÇA | 14 | 9 | 0 | 2 | 1 |
| 25 — PROMOÇÕES E PRECIFICAÇÃO AVANÇADA | 8 | 3 | 0 | 5 | 1 |
| 26 — SERVIÇOS E ORDENS DE SERVIÇO | 0 | 3 | 1 | 14 | 0 |
| 27 — CONTRATOS E RECORRÊNCIA | 0 | 0 | 0 | 16 | 0 |
| 28 — LOCAÇÕES E RESERVAS | 0 | 0 | 0 | 14 | 0 |
| 29 — PATRIMÔNIO E ATIVO IMOBILIZADO | 0 | 0 | 0 | 12 | 0 |
| 30 — MANUTENÇÃO | 0 | 0 | 0 | 13 | 0 |
| 31 — RECURSOS HUMANOS E DEPARTAMENTO PESSOAL | 0 | 1 | 0 | 19 | 0 |
| 32 — GESTÃO DE TAREFAS E PROCESSOS | 1 | 6 | 0 | 8 | 0 |
| 33 — GESTÃO DOCUMENTAL | 0 | 7 | 0 | 6 | 0 |
| 34 — MULTIEMPRESA E MULTIFILIAL | 9 | 4 | 0 | 2 | 0 |
| 35 — MARKETPLACES E INTEGRAÇÕES COMERCIAIS | 0 | 2 | 0 | 16 | 1 |
| 36 — PAGAMENTOS E GATEWAYS | 3 | 5 | 6 | 3 | 1 |
| 37 — APLICATIVOS E PORTAIS EXTERNOS | 1 | 5 | 0 | 10 | 0 |
| 38 — AUTOMAÇÕES E INTELIGÊNCIA ARTIFICIAL | 3 | 6 | 0 | 9 | 0 |
| 39 — GESTÃO DE QUALIDADE | 0 | 2 | 0 | 12 | 0 |
| 40 — TRANSPORTES E GESTÃO DE FROTAS | 0 | 1 | 0 | 14 | 0 |
| 41 — WMS E ARMAZENAGEM AVANÇADA | 0 | 7 | 1 | 10 | 0 |
| 42 — COMÉRCIO EXTERIOR | 0 | 0 | 0 | 16 | 0 |
| 43 — VENDAS EXTERNAS E REPRESENTANTES | 2 | 2 | 0 | 10 | 0 |
| 44 — AGENDAMENTOS E ATENDIMENTOS | 0 | 0 | 0 | 14 | 0 |
| 45 — GESTÃO DE GARANTIAS E PÓS-VENDA | 0 | 1 | 0 | 11 | 0 |
| 46 — GESTÃO DE SUPERMERCADOS E VAREJO ALIMENTAR | 3 | 5 | 0 | 6 | 1 |
| 47 — GESTÃO DE MODA E CONFECÇÃO | 2 | 5 | 0 | 5 | 0 |
| 48 — GESTÃO DE DOCUMENTOS E CERTIFICAÇÃO DIGITAL | 8 | 2 | 1 | 1 | 1 |
| 49 — SUPORTE E CENTRAL DE AJUDA | 5 | 5 | 0 | 3 | 0 |
| 50 — CONFIGURAÇÕES E PERSONALIZAÇÃO | 4 | 5 | 0 | 7 | 0 |
| 51 — Escritório contábil (gestão da carteira de clientes) | 6 | 0 | 0 | 0 | 2 |
| 52 — Rede de certificação digital (Master, Regional, Revenda, Contador) | 8 | 0 | 0 | 0 | 5 |
| 53 — Licenciamento e habilitação de módulos (integração Interos) | 4 | 0 | 0 | 0 | 0 |

- **Módulos sem nenhuma funcionalidade no código:** 27 Contratos, 28 Locações, 29 Patrimônio, 30 Manutenção, 42 Comércio exterior e 44 Agendamentos.
- **Praticamente vazios:** 14 Food Service, 16 PCP, 31 RH, 39 Qualidade, 40 Frotas e 45 Garantias. Só há aproveitamentos genéricos (kits, balança, montagem).
- Esses módulos ficam no catálogo como **RECURSO FUTURO**, indisponíveis comercialmente. **Nada foi simulado como pronto.**

## 3. Funcionalidades encontradas fora da taxonomia

- **Módulo 51 — Escritório contábil:** carteira de clientes PF/PJ, regime com vigência, grupos, departamentos e responsáveis, caixa de entrada do pacote mensal, vínculo empresa ↔ escritório.
- **Módulo 52 — Rede de certificação digital:** hierarquia Master → Regional → Revenda → Contador, preço em cascata, vendas, vouchers, cupons, renovações e financeiro em camadas.
- **Módulo 53 — Licenciamento e habilitação de módulos:** o próprio controle de contratação e a API do Interos (CORE).
- **Submódulos novos em módulos existentes:**

  | Códigos | Funcionalidade |
  |---|---|
  | 01.21 | Consulta de CNPJ |
  | 02.25 | Tributos aproximados (Lei 12.741) |
  | 03.17, 03.18 | Produto a partir da nota; conversor de CFOP |
  | 05.19–05.22 | Nota a confirmar, precificação após a entrada, orçamento mensal de compras, revisões de pedido |
  | 07.27, 07.28 | Recebimento de crediário no PDV; terminais e periféricos |
  | 10.31, 10.32 | Complemento entre depósitos; inventário em data-base |
  | 12.31–12.33 | Monitor de integrações, prontidão da loja, arrependimento de 7 dias |
  | 18.41–18.46 | Cobrança por WhatsApp, carnê, baixa em lote, recebíveis de cartão, aging, aviso de vencimento |
  | 22.21, 22.22 | Exportação Domínio; Sintegra |
  | 36.17 | Banco Intercert |
  | 48.11, 48.12 | Validação do titular; fila da equipe de certificação |
  | 49.13 | Ajuda contextual e catálogo de rejeições SEFAZ |

## 4. Duplicidades

**Comerciais.** Em `duplicidades.tsv` há 37 aliases e 32 reusos. Cada um tem proprietário técnico único e nunca é cobrado à parte. Exemplos:
- Pix: 07.13, 12.07, 18.06 e 19.10 → 36.04;
- grade: 09.02, 09.03 e 47.03 → 09.04;
- ficha técnica e ingredientes do Food → 15.03 e 15.02;
- serviços: 26.01 → 01.05;
- certificado: 48.01 → 02.12;
- campos personalizados: 50.06 → 01.19;
- domínio: 11.18 e 50.15 → 12.24;
- curva ABC, reposição, transferências entre filiais, etiquetas e balança.

**Técnicas** (código repetido, encontrado pela auditoria; risco de manutenção, não de cobrança):

| Duplicidade | Onde | Risco |
|---|---|---|
| Pix em 3 implementações | Mercado Pago no PDV (`payments/providers.ts`), gateway da loja (`ecommerce/providers.ts`), BR Code estático (`lib/pix.ts`) | Regras divergentes de estorno e confirmação |
| 2 contratos de provedor de pagamento | `PaymentProvider` (PDV) e `GatewayProvider` (loja) | — |
| 3 motores de conciliação | Banco, adquirente e gateway | Todos baixam pelo mesmo `settleInstallment` (correto) |
| 2 modelos de pedido de venda sem central comum | `sales_documents` e `online_orders` | Bloqueia a "Central de pedidos omnichannel" (06.25) |
| 2 fluxos de devolução | PDV (`returns` / vale) e loja (`online_orders.returnRequest`) | A devolução on-line não gera vale |
| 2 motores de promoção | PDV (`promotions`) e cupons da loja | A loja não aplica as promoções do ERP |
| 2 motores de cupom com a mesma regra | Loja e rede | — |
| Grupo tributário com duas telas e duas validações | `products.ts` × `fiscal/config.ts` | Validação diferente conforme a tela |
| Chamada à Focus fora do provedor | `receipts.ts:860` | — |
| Consulta de CNPJ copiada | `customers.ts` × `accounting/clients.ts` | — |
| NF-e de devolução de venda por dois caminhos | Rascunho automático × assistente | — |
| Listas de CST/CSOSN com ST repetidas e levemente diferentes | Três arquivos | Resultado diferente conforme o caminho |
| Mais duas repetições | Busca de SKU (4 ações, 2 componentes); `listSellers` (cópia não usada) | — |

**Recomendação:** unificar Pix, pedidos e promoções antes dos módulos 06.25, 12.20 e 35.x (omnichannel e marketplaces). Isso não bloqueia a modularização.

## 5. Divergências entre o runtime v1 (ERP) e o catálogo v2 (comercial)

Itens que o runtime v1 aceita contratar, mas que a auditoria **não** considera liberáveis comercialmente agora:

| Unidade v2 | Chave v1 | Motivo | Proposta |
|---|---|---|---|
| 04.01 NF-e, 04.02 NFC-e, 04.03 NFS-e | `fiscal.nfe`, `fiscal.nfce`, `fiscal.nfse` | Lado ERP completo e testado. Sem token Focus e homologação SEFAZ, opera só em simulação. | Manter para os atuais. Liberar para venda nova após a homologação (pendência externa 1). |
| 36.17 Banco Intercert | `ecommerce.banco` | Provedor reservado; só simulação | Não vender até haver conector |
| 35.18 Canais | `ecommerce.canais` | Só "prepara" contas | Não vender (já marcado "a confirmar" na v1) |
| 18.22 Fechamento de período | `financeiro.fechamento_periodo` | Fechamento por empresa; consolidado parcial | Vender como "fechamento financeiro" (o que existe); o consolidado fica futuro |
| 46.01 Balança | `produtos.balanca` | Leitura do código no PDV OK; layout do arquivo de carga Toledo/Filizola ainda a conferir com o equipamento | Vender a leitura; homologar a carga |

Também há ausências relevantes que impactam o catálogo comercial: boleto (emissão, registro e remessa), API bancária e Bradesco API, conta do cliente na loja, catálogo B2B, uma loja por filial, número de série, FIFO, manifestação do destinatário, MDF-e e CT-e de emissão.

## 6. Dependências principais (já em runtime, sem ciclos)

- PDV → caixa e produtos.
- Loja → produtos e **NF-e**: a expedição exige nota autorizada.
- Cotação e aprovação → pedido de compra.
- Recebimento → produtos e fornecedores. **Não** depende de pedido.
- Fidelidade → PDV.
- Funções opcionais → módulo-pai.
- Componentes técnicos compartilhados: estoque, financeiro, fiscal, preços e Pix. Não são contratados; ativam-se com quem precisa deles.

Combinações conferidas com teste:
- PDV sem loja;
- loja sem PDV;
- compras sem cotação e sem aprovação;
- estoque sem lotes;
- produtos sem edição em massa;
- financeiro sem conciliação;
- fiscal sem SPED;
- Food com composição sem PCP (não exige PCP; PCP não existe).

Matriz completa: `docs/modulos/matriz-dependencias.md` (runtime) e `dependencies` de cada item no JSON v2.

## 7. Decisões que dependem de você (antes das Fases 6 a 10)

1. **Integração externa conta como "operacional"?** NF-e, NFC-e, NFS-e e Pix estão completos no ERP, mas dependem do token da Focus e da homologação na SEFAZ, e da credencial do Mercado Pago.
   - Proposta: **não liberar para venda nova** até a homologação.
   - Os clientes atuais mantêm o acesso que já têm.
2. **Carência e contingência.**
   - Proposta: **7 dias** de carência depois do vencimento sem renovação, então modo somente leitura.
   - Proposta: **7 dias** de teste vencido antes de suspender.
   - Obrigações fiscais nunca são interrompidas.
3. **Limite de documentos fiscais.** Proposta: **nunca bloquear** a emissão legal; só avisar e gerar cobrança de excedente.
4. **Granularidade comercial.** O runtime v1 já vende 67 unidades. Quer dividir mais nas Fases 6 e 7?
   - Exemplo: separar no caixa a conferência cega (07.15) e o controle de divergências (07.26) como recursos 07.03.01 e 07.03.02.
   - Proposta: manter as 67 unidades na primeira onda e dividir só o que tiver demanda comercial.
5. **Exibição de módulo não contratado.** Proposta:
   - `oculto` para os clientes atuais;
   - `oportunidade` (com "Solicitar contratação") para os planos novos.
6. **Autenticação servidor a servidor da v2.** Manter token com hash e HMAC por evento, ou exigir mTLS / OAuth2 client credentials? Depende do que o Interos suporta.
7. **Reconciliação ativa.** O ERP deve consultar o Interos uma vez por dia (exige o endereço do Interos), ou basta o Interos reenviar quando a versão divergir?
8. **Cargos, departamentos e funções.**
   - Proposta: atributos do usuário que aplicam modelos de perfil;
   - o perfil continua sendo o único contêiner de permissões.

## 8. Próximas fases (incrementais e reversíveis)

O detalhe está em `docs/MIGRATION/plano-migracao-v2.md`:

1. Publicar o catálogo v2 como dado.
2. Retrato de licença (`company_licenses`).
3. API v2 com eventos assinados.
4. Estados de teste, vigência e suspensão programada.
5. Limites só com aviso; depois, com bloqueio de novos cadastros.
6. Telemetria.
7. Interface bloqueada / oportunidade.
8. Divisão fina das unidades.

Cada etapa é aplicada por empresa e tem reversão documentada.

## 9. Riscos remanescentes

- 220 submódulos estão parciais. O texto comercial precisa descrever **o que existe**, não o nome da taxonomia. Por exemplo, "Integração com WhatsApp" hoje é só um link `wa.me`.
- As duplicidades técnicas de Pix, pedidos e promoções tornam caro o omnichannel e os marketplaces.
- Documentos antigos (`docs/evolucao/03-matriz-comparativa.md` e `04-ausentes.md`) estão parcialmente desatualizados: listam como ausentes itens que já existem, como etiquetas, CT-e de entrada e transportador.
