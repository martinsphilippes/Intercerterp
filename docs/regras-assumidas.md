# Regras assumidas, cálculos e estados

Classificação usada em todo o documento: **[PDF]** requisito explícito do PDF/prompt · **[Fluxo]** complemento necessário para o fluxo funcionar · **[Decisão]** melhoria ou regra assumida na implementação.

## 1. Unidades, precisão e arredondamento [Decisão]

| Grandeza | Armazenamento | Observação |
|---|---|---|
| Dinheiro | inteiro em **centavos** | nunca ponto flutuante para totais |
| Quantidade | inteiro em **milésimos** (1 un = 1000) | suporta frações (kg, m) com 3 casas |
| Percentual | inteiro em **pontos-base** (1% = 100) | ex.: alíquota 18% = 1800 |
| Data de calendário | `AAAA-MM-DD` | vencimento, competência |
| Instante | ISO-8601 UTC | exibido em America/Sao_Paulo (configurável) |

- Arredondamento: metade para longe de zero (`roundDiv`).
- Valor da linha = arredondar(preço unitário × quantidade).
- **Rateio** (desconto/acréscimo global, frete, parcelas): método do maior resto — a soma das partes é sempre igual ao total, centavo a centavo.
- Parcelas iguais: diferença de centavos na **primeira** parcela.
- Os totais são calculados no servidor pela mesma função (`calcSale`, `computeTotals`) usada na tela, no documento fiscal e nos relatórios.

## 2. Períodos e fuso [PDF]

Filtros por data usam o intervalo técnico `[00:00 do primeiro dia, 00:00 do dia seguinte ao último)` no fuso da empresa — o último dia é incluído integralmente. Datas exibidas em `dd/mm/aaaa`.

## 3. Venda (PDV) [PDF/Fluxo]

- Estados independentes: **comercial** (`completed`, `cancelled`), **pagamento** (`paid`, `pending`, `refunded`) e **fiscal** (`pending`, `queued`, `processing`, `authorized`, `rejected`, `error`, `cancelled`, `discarded`). Venda paga pode ter documento pendente; nota autorizada não prova recebimento.
- Preço: tabela informada → padrão da filial → padrão da empresa; preço da filial prevalece sobre o geral; vigência por data; **atacado** quando a quantidade ≥ quantidade mínima de atacado.
- Preço digitado menor que o de tabela vira desconto do item (sujeito a limites). Limites: desconto máximo do preço (tabela) e limite do perfil/usuário; acima disso só com a permissão “Aprovar desconto acima do limite”.
- Desconto global rateado entre os itens pelo valor líquido de cada item; desconto, acréscimo e **custo unitário (custo médio vigente)** ficam gravados no item.
- Sem saldo: bloqueia, salvo configuração explícita (`sales.allowNegativeStock` ou terminal). Concorrência rara após a validação é registrada como saldo negativo, nunca como venda perdida.
- Idempotência: a chave do atendimento gera o id da venda; repetir a confirmação devolve a mesma venda (sem nova cobrança, baixa ou movimento).
- Pagamentos:
  - **Dinheiro**: lançamento na conta Caixa da filial; troco = recebido − aplicado.
  - **Pix**: somente com cobrança **confirmada** pelo provedor, ou manual com identificador do comprovante (marcado como manual).
  - **Cartão**: venda bruta → **recebível** (título contra a adquirente, vencimento pelo prazo de liquidação; crédito parcelado mensalmente) → **liquidação** em conta bancária com **taxa** como lançamento separado.
  - **Crediário/boleto**: título do cliente com parcelas pela condição de pagamento. Crediário exige limite de crédito concedido no cadastro (sem concessão automática): em aberto + nova compra ≤ limite.
  - **Vale-crédito**: consome saldo do vale (limite atômico; nunca negativo).
- Pagamento imediato não gera título do cliente em aberto (o dinheiro/Pix já está na conta; cartão vira recebível da adquirente).

## 4. Cancelamento e devolução [PDF]

- Cancelamento gera efeitos inversos vinculados: estorno de caixa/conta, retorno ao estoque (`sale_cancel`), cancelamento dos títulos sem baixa (com baixa → exige estorno antes), devolução do vale, cancelamento fiscal enfileirado (autorizada) ou descarte (não transmitida). Cartão: estornar na maquininha/TEF.
- Devolução: quantidade devolvida acumulada ≤ vendida (limite atômico, seguro em concorrência). Valor proporcional ao líquido pago no item. Revenda → depósito disponível; avaria → depósito de avarias. Compensação: vale-crédito, reembolso (dinheiro/Pix/conta) ou troca (vale aplicado na nova venda vinculada; diferença paga com outros meios). Estorno em cartão fica “em processamento” como obrigação até a confirmação da adquirente. Documento fiscal de devolução criado como rascunho referenciando o documento original.
- Devoluções entram nos relatórios na **data do movimento**, com origem e custo revertido.

## 5. Caixa [PDF]

- **Dinheiro esperado** = fundo + recebimentos em espécie (valor aplicado à venda) + suprimentos − sangrias − devoluções em espécie. O troco não é deduzido novamente. **Alterado na Fase 4 (§25):** soma também os recebimentos de parcelas do crediário em espécie feitos no PDV (sem recebimento, o resultado é o mesmo).
- Fundo não é receita; suprimento não é venda; sangria não reduz faturamento (quando informada a conta de destino, é transferência entre contas).
- Uma sessão aberta por terminal (trava única). Fechamento grava previsto × informado por meio de pagamento e as diferenças, com justificativa obrigatória quando houver divergência — sem ajuste automático. Reabertura preserva o fechamento no histórico e cria nova versão de conferência.

## 6. Estoque [PDF]

- Saldo físico muda **somente** por movimento (com saldo anterior/posterior, custo, origem e motivo); sequência única por saldo garante que duas saídas simultâneas não consumam a mesma mercadoria.
- **Disponível = físico − reservado.** Trânsito é grandeza própria (não disponível em nenhuma filial).
- **Custo médio ponderado** por SKU e depósito: entradas com custo recalculam `(saldo × médio + qtd × custo) / (saldo + qtd)` (saldo negativo tratado como zero); saídas usam o médio vigente.

## 7. Financeiro [PDF]

- **Saldo da parcela** = valor − principal baixado; baixa: principal reduz o saldo; valor movimentado = principal − desconto + juros + multa; tarifa é lançamento separado.
- Estorno gera baixa inversa e lançamento inverso vinculados; recompõe o saldo sem nova obrigação. Baixa conciliada exige desconciliar antes.
- Lançamentos em conta formam o extrato interno (sequência única por conta). Transferências entre contas não são receita nem despesa.
- Contas a pagar: autorização (conferência) é etapa distinta do pagamento.

## 8. Fiscal [PDF]

- Estados medidos a partir do retorno do provedor; documentos do provedor de **simulação** ficam marcados (`isSimulated`) e exibem o selo “SIMULAÇÃO” — nunca são apresentados como emissão válida.
- Referência única por documento (`ref`): retransmissão e consulta usam a mesma referência — não duplicam documento, venda ou recebimento. Antes de reenviar após falha, consulta-se a referência.
- Pendência de cadastro (NCM, CFOP, CST/CSOSN, IE, configuração ou credencial ausentes) deixa o documento em `pending` sem transmitir, com notificação.
- NFS-e: base = serviços − desconto incondicionado − deduções; ISS = base × alíquota; ISS calculado ≠ ISS retido; líquido = serviços − desconto incondicionado − retenções marcadas.

## 9. Concorrência e idempotência [Decisão]

Ver `docs/arquitetura.md`. Resumo: ids determinísticos por efeito, sequência única por agregado, incrementos atômicos com limite, transações Appwrite (≤ 100 operações), tarefas duráveis com reivindicação única e recuo exponencial.

## 10. Acesso [PDF]

- Login por usuário ou e-mail; tentativas registradas no histórico; **bloqueio temporário de 15 min após 5 tentativas inválidas** [Decisão].
- Seleção de empresa → unidade (pula etapas com opção única). Consolidado é contexto explícito de consulta; operações exigem filial.


## 11. Isolamento por empresa e filial [Decisão]

- Toda requisição e toda tarefa em segundo plano usam um armazenamento **restrito à empresa ativa** (`ScopedStore`): registro de outra empresa é tratado como inexistente, consultas recebem o filtro da empresa e gravações com empresa diferente são recusadas. Operações multiempresa (criar empresa, administrar outra empresa autorizada) usam um contexto explícito e validado (`ctxForCompany`).
- O contexto **consolidado** (todas as filiais) é somente consulta e só aparece para quem tem acesso a todas as filiais da empresa (administrador ou usuário sem restrição de filial).
- Arquivos (XML, anexos, comprovantes, backups, certificado) só são baixados por usuários da mesma empresa e com permissão do módulo de origem; certificado exige “Configurar fiscal” e backup exige “Backup”. Tipos potencialmente executáveis são sempre baixados como anexo.
- Exportações CSV neutralizam células que começam com `= + - @` (injeção de fórmula).

## 12. Produtos, preços e estoque [PDF/Decisão]

- Situação fiscal do produto: **Configurado**, **Revisar** (classificação incompleta para algum regime) ou **Incompleto** (sem NCM etc.); produto pode ser salvo incompleto, mas não é vendido como “Configurado”.
- Produto em **rascunho** fica inativo e fora do PDV; produto inativo não pode ser vendido.
- Margem = (preço − custo) / preço; **markup** = (preço − custo) / custo — exibidos separadamente.
- Preço: preço da filial prevalece sobre o geral; vigência pelo início mais recente ≤ hoje; atacado a partir da quantidade mínima; tabela inativa → tabela padrão. Toda alteração grava histórico (anterior, novo, motivo, usuário).
- Saldo inicial é um movimento do tipo `initial` (nunca edição direta do saldo).
- Abaixo do mínimo: disponível ≤ mínimo (laranja); sem estoque: disponível ≤ 0 (vermelho).
- **Transferência**: rascunho → separada (reserva na origem) → em trânsito (sai da origem, entra no trânsito do destino) → recebida parcial/total; cancelada. Pendente = expedido − recebido − avariado − devolvido − perdido. Avaria vai para o depósito de avarias do destino; pendência volta à origem ou vira perda, com motivo.
- **Inventário**: código `INV-AAAA-NNN`; esperado = saldo-base + movimentos ocorridos entre a base e a contagem (exceto os do próprio inventário); diferença = contado (ou recontagem) − esperado; impacto = diferença × custo médio na conclusão; conclusão em duas fases (ajustes idempotentes).
- **Importação de produtos**: políticas “só criar”, “só atualizar” ou “criar e atualizar” por SKU/código; prévia por linha antes de gravar; lote idempotente.

## 13. Financeiro [PDF/Decisão]

- Multa sugerida = principal × multa% (padrão 2%); juros sugeridos = principal × juros% a.m. × dias de atraso / 30 (padrão 1%); tolerância em dias (parâmetro). Sugestão sempre editável.
- Valor movimentado na baixa = principal − desconto + juros + multa; tarifa é lançamento separado.
- Saldo inicial da conta: vale a partir da data informada, que deve ser ≤ primeiro lançamento; é um marcador na sequência da conta.
- **Fluxo de caixa**: realizado = lançamentos em conta (exceto transferências e marcadores); previsto = saldo das parcelas abertas com vencimento ≥ hoje; recebível de cartão entra pelo **líquido previsto**; vencidos aparecem separados (não somam no projetado, salvo opção “incluir vencidos”).
- Categoria efetiva: lançamento → tarifa → título → categoria padrão.
- **Competência**: pela data de competência do título; tarifa de baixa estornada não conta.
- **Conciliação**: pontuação de sugestão = valor (60) + data exata (25) / ±1 dia (20) / ±3 dias (12) / janela (5) + documento (20), normalizada; somas de 2–3 lançamentos; 1:1, 1:N e N:1 (N:N não suportado). Diferença = Σ extrato − Σ ERP. Identidade do arquivo = SHA-256 + conta (reimportação não duplica); transação = FITID + data + valor (ou hash da linha).
- Formatos: OFX, CSV com mapeamento, CNAB 240 (ocorrências 06/17) e CNAB 400 (Itaú 06/07/08; Bradesco 06/15/16/17; 28 = tarifa). Arquivo CNAB de outro banco é recusado.
- Contas a pagar: autorização (conferência) é etapa separada e revogável enquanto não houver baixa.

## 14. Compras e reposição [PDF/Decisão]

- Pedido: linha = qtd × custo − desconto + IPI; total = subtotal − descontos + IPI + frete + seguro + outras despesas. Fornecedor não muda após aprovação; revisão relevante após aprovação volta para aprovação; pedido com recebimento não é revisado.
- **Aprovação**: a faixa é a de maior valor ultrapassado; autoaprovação somente estritamente abaixo do limite; decide quem tem “Aprovar compras” e é responsável pela etapa; aprovação vencida segue a política (bloquear/observação/permitir); revogar a última decisão apenas antes do envio ao fornecedor.
- **Reposição**: horizonte = prazo do fornecedor + dias de cobertura; consumo diário = (vendas − devoluções da filial nos últimos N dias) / N; alvo = máx(mínimo, ⌈consumo × horizonte⌉) + segurança (sem histórico: máx(mínimo, máximo) + segurança); necessidade = máx(0, alvo − disponível − confirmado); confirmado = pedidos aprovados/enviados/parciais com previsão dentro do horizonte; rascunhos aparecem à parte; arredondamento para lote mínimo e múltiplo.
- **Cotação**: linha = bruto − desconto%; frete contado uma vez por fornecedor; sugestão “menor total com frete” é heurística (gulosa + busca local), rotulada como sugestão — não garante ótimo.
- **Recebimento**: devido = Σ(recebido × custo) − desconto + frete + outras despesas (inclui IPI, ST, seguro do XML); rateio por valor; custo de entrada = (linha + rateios) / qtd; título a pagar = devido (valor faturado diferente só com justificativa). Chave da NF-e única por empresa; destinatário diferente bloqueia; CFOP de entrada 1102/2102.
- Desempenho do fornecedor = 60% pontualidade + 40% conformidade (medido, sem nota manual).
- **Entrada sem pedido (COM-03)** — parâmetro `feature.entradaSemPedido` (padrão ligado; empresa/filial): a nota de compra pode ser (a) importada por XML marcando “sem pedido” (não vincula os pedidos em aberto do fornecedor) ou (b) lançada manualmente com itens (SKU, quantidade, custo e desconto da linha), frete, outras despesas (IPI/ST/seguro) e desconto da nota e condição de pagamento. Não há saldo previsto nem divergência “fora do pedido”; a conclusão é a mesma `confirmReceipt`: devido = Σ(linha líquida do desconto da linha) − desconto da nota + frete + outras despesas, rateio por valor, custo de entrada = (linha + rateios) / qtd, custo médio ponderado, título a pagar = devido com parcelas pela condição a partir da data de emissão (sem condição: uma parcela na emissão). O recebimento grava `origin` (xml | manual) e `orderLink` (with_order | without_order). Desligado, o lançamento manual exige pedido (comportamento anterior); com pedido nada muda (itens do saldo, encargos do pedido cobrados uma única vez).
- **Produto a partir do item do XML (COM-04)** — na conferência, item sem vínculo pode virar produto pelo cadastro padrão (`createProduct`: mesmas validações de GTIN, NCM, CEST e unidade) com descrição, GTIN (só se o dígito verificador for válido), NCM (8 dígitos), CEST (7 dígitos), unidade (código igual ao `uCom` ou sinônimo comum, senão UN), fornecedor e custo do item. GTIN já cadastrado em outro SKU (código principal ou adicional) nunca gera produto novo: o item é vinculado ao existente, com aviso. O vínculo código do fornecedor + fator de conversão é gravado em `supplier_products` na hora. Preço inicial = custo × (1 + margem padrão) quando há parâmetro de margem (`pricing.defaultMarginBps`, ou `purchase.defaultMarginBps`); sem margem, o preço fica em branco (ou o informado na prévia) e só é gravado por quem pode alterar produtos. Repetir o cadastro do mesmo item não cria outro produto (chave idempotente por recebimento e item).
- **Conversor de CFOP de entrada (COM-09)** — parâmetro `feature.conversorCfop` (padrão ligado) e tabela `purchase.cfopPairs` (empresa/filial, editável em Administração → Parâmetros → Compras, um par `5102=1102` por linha). Na importação do XML cada item recebe `entryCfop` pelo CFOP de saída informado pelo fornecedor; item sem par usa o CFOP do recebimento (1102 interna / 2102 interestadual, como antes); se todos os itens convergem para o mesmo CFOP, ele passa a ser o do recebimento. Os pares exigem a mesma abrangência (5xxx → 1xxx, 6xxx → 2xxx, 7xxx → 3xxx). Fonte: tabela de CFOP do Convênio SINIEF s/nº de 15/12/1970 (redação do Ajuste SINIEF 07/2001 e alterações). **Hipótese:** o CFOP de entrada depende da finalidade da compra, não só do CFOP do fornecedor; a tabela padrão assume compra para comercialização (varejo): 5101–5106 → 1102; 6101–6106 → 2102; 5401/5402/5403/5405 → 1403; 6401/6402/6403/6404 → 2403; 5116/5117 → 1117 (6xxx → 2117); 5922 → 1922; 5923 → 1923; 5152 → 1152; 5409 → 1409; 5202 → 1202; 5411 → 1411; 5910 → 1910; 5911 → 1911; 5912 → 1912; 5913 → 1913; 5917 → 1917; 5551 → 1551; 5949 → 1949 (e os equivalentes 6xxx → 2xxx). Uso e consumo (1556/2556) e ativo (1551/2551) por outra finalidade são ajustados por item na conferência ou com pares próprios. O CFOP de entrada é informativo (escrituração/contabilidade): não altera devido, custo nem título.

## 15. Fiscal [PDF/Decisão]

- Faturamento fiscal = Σ notas autorizadas de saída (exceto devoluções) pela data de emissão; líquido = bruto − NF-e de entrada de devolução. Excluídos: canceladas, rejeitadas, denegadas, descartadas, rascunhos e pendentes.
- Tributos aproximados = total do item × percentual do grupo tributário (parâmetro, não IBPT).
- CFOP padrão: venda 5102/6102; devolução de venda 1202/2202; devolução a fornecedor 5202/6202 (5411 com ST); transferência 5152/6152 (5409 com ST).
- Prazo de cancelamento: NF-e 24 h, NFC-e 30 min (parâmetros). Numeração atribuída na primeira transmissão, por filial/modelo/série; NFC-e usa a série do terminal (exclusiva).
- Contingência do sistema retém a fila até o encerramento; ao encerrar, transmite em lote.
- Obrigações acessórias: vencimento no dia N do mês seguinte (parâmetro).
- Conexão nunca testada aparece como “configurada sem teste”; provedor de simulação aparece como “Simulação”.
- Pacote contábil: ZIP com XML + CSV + LEIA-ME + manifesto SHA-256; envio por e-mail registra o resultado real do canal (“não enviado” quando não há canal).

## 16. Painel, gerenciais e curva ABC [PDF/Decisão]

- Receita líquida = Σ bruto − Σ descontos (item + rateio) + Σ acréscimos − Σ devoluções do período; somente vendas concluídas.
- CMV = Σ custo dos itens vendidos − Σ custo dos itens devolvidos; margem calculada pelos totais (não média de margens).
- Ticket médio = receita líquida / nº de vendas concluídas.
- Devoluções entram na data do movimento e na filial onde foram registradas; o operador considerado é o da venda original.
- Comparação = janela imediatamente anterior com o mesmo nº de dias.
- **Curva ABC**: ordena pelo valor do critério (receita, quantidade ou margem), desempate por quantidade líquida e SKU; a classe usa o acumulado **anterior** ao item (< A → A; < B → B; senão C); base só com valor > 0; SKUs ativos sem vendas = “Sem classe”. Filtro de exibição não recalcula o denominador.
- Metas: realizado do dia 1º até min(fim do mês, hoje); ritmo esperado = meta × dias decorridos / dias do mês (ticket: a própria meta).
- Estoque crítico = disponível < mínimo, por SKU × depósito.

## 17. Administração [PDF/Decisão]

- Convite com validade (parâmetro, padrão 7 dias), link de uso único (hash do token gravado); sem canal de e-mail o link é exibido uma única vez ao administrador.
- Último administrador ativo não pode ser removido, inativado ou rebaixado. Só administrador concede administração.
- Limite de desconto efetivo = do usuário, senão do perfil. Permissão de editar/criar/excluir implica visualizar.
- Backup: JSON compactado (gzip) com checksum por coleção e geral; partes de até 25 MB; restauração em base de teste ou nova base, com verificação de contagens e checksums; retenção sem nunca remover a cópia mais recente.
- Filial “Em implantação” = ativa sem configuração fiscal.
- Notificações: ler ≠ resolver; arquivar só notificação informativa ou com ocorrência resolvida; crítica ignora silêncio por tipo.

## 18. Regras consolidadas após a revisão adversarial [Decisão]

Resultado da revisão independente (achados confirmados corrigidos com testes de regressão). Complementam e, quando conflitam, substituem as seções anteriores.

#### Clientes, metas e painel
- Cliente: id não deriva do CPF/CNPJ; unicidade pelo índice (empresa, documento atual) — trocar/remover o documento libera o antigo na mesma gravação; cadastro idempotente pela chave do formulário.
- Conceder/alterar limite de crédito exige a ação “Conceder limite de crédito” (customer.credit_limit; Gerente e Administrador); demais usuários veem somente leitura e o servidor preserva o valor.
- Meta: id determinístico pela chave; se a posição estiver ocupada por meta cuja chave mudou, usa a próxima posição determinística.
- Metas da empresa (sem filial) só aparecem — inclusive na exportação — para quem tem acesso a todas as filiais.
- Detalhamento do painel/gerenciais só abre uma listagem operacional quando ela mostra exatamente o mesmo recorte; caso contrário, leva às operações do gerencial.
- Painel: “autorizados” exclui documentos do provedor de simulação, mostrados à parte com o selo SIMULAÇÃO.

#### Financeiro
- Baixa de parcela renegociada/cancelada não é estornada diretamente: desfaça antes a renegociação (exige título novo sem recebimentos ativos).
- Desfazer renegociação cancela o título novo e devolve as parcelas originais com saldo = valor − principal pago (sem lançamento em conta).
- Renegociação limitada a 49 parcelas no total (selecionadas + novas) — cabe no limite de 100 operações por transação; parcelas repetidas são recusadas.
- Toda movimentação exige conta financeira da empresa ativa e ativa.
- Recebível de cartão é liquidado somente pela tela de Cartões (com a taxa da adquirente).
- Nosso número é gravado sem carteira, dígito verificador e zeros à esquerda (retorno CNAB casa em qualquer formato).
- Juros da condição = total × juros%, somado ao valor parcelado.
- Limites de cadastro: taxa do meio de pagamento ≤ 20%; juros da condição ≤ 50%. Percentual aceita vírgula ou ponto decimal.
- Categoria “Sem categoria” é filtrável; detalhamentos e listas usam a categoria efetiva.

#### Fiscal
- Uma operação → um documento fiscal ativo (venda, transferência, devolução, pedido). Encerrados: cancelado, denegado, inutilizado, descartado. Nova emissão após cancelamento usa referência `-r<n>`.
- Escritas fiscais exigem a filial do documento (consolidado é consulta).
- Documento já enviado é sempre consultado no provedor antes de qualquer decisão: só volta a “pendente” quando é certo que não há autorização; descartar exige essa consulta; origem cancelada nunca reenvia.
- Faturamento fiscal exclui transferências e CFOP de saída que não são receita (x15x, x408/x409, x552–x557, x20x/x21x/x41x e x9xx, exceto x922/x933) — total mostrado à parte. **Validar com a contabilidade.**
- CST 20: base = valor × (1 − redução do grupo); sem redução cadastrada → pendência. PIS/COFINS CST 01/02 sem alíquota → pendência; CST 03 não suportado.
- Inutilização: repetição idempotente; faixa sobreposta recusada; documentos da faixa passam a “inutilizado”.
- Pacote contábil: gerar exige “Exportar dados”; enviar exige “Configurar fiscal”; a obrigação de entrega de XML só se conclui com pacote de todas as filiais enviado ao e-mail da contabilidade.
- Envio ao provedor com reivindicação por tentativa (envios simultâneos → um único envio); reivindicação parada > 5 min conta como envio interrompido.

#### Compras
- Recebimento sem XML: IPI por linha e desconto geral proporcionais ao recebido; frete, seguro e outras despesas entram inteiros uma única vez por pedido (marca de cobrança gravada na confirmação; cancelar libera). Alterar esses valores na conferência desliga o cálculo automático.
- Total faturado × devido: divergência acima de `purchase.receiptValueTolerance` (padrão R$ 0,00) exige justificativa (sem XML sempre; com XML quando o devido supera o faturado).
- NF-e do fornecedor: denegada é recusada; homologação (sem valor fiscal) só é aceita em empresa de demonstração; sem protocolo só com justificativa.
- Cancelar recebimento libera a chave da NF-e para nova importação; a duplicidade de recebimento ativo é barrada por índice único.
- Decisões de aprovação: sequência por solicitação com vaga única (aprovar e rejeitar simultâneos → só uma vence); a tela envia etapa e revisão, página desatualizada é recusada.
- Edição de pedido acima de 100 gravações por transação é recusada com orientação (salvar em duas etapas); SKU repetido no pedido só com o mesmo custo (IPI/quantidade/desconto somados).
- Escritas de compras exigem a filial do documento; consolidado só consulta.
- Fornecedor: id independente do CNPJ (unicidade por empresa + documento atual); idempotência pela chave do formulário. Reposição e cotação ignoram fornecedores bloqueados, inativos ou em rascunho (exibidos como indisponíveis).

#### Produtos e estoque
- No máximo um inventário em andamento por depósito (inclui inventário em preparação); abertura grava as contagens em lotes idempotentes e só então fica “aberto” — “Retomar abertura” completa uma abertura interrompida.
- Transferência ganhou o estado “Expedição incompleta”: expedição que falha no meio pode ser concluída ou cancelada; o cancelamento devolve à origem o que já saiu. Receber/resolver exige expedição concluída. Consumo do trânsito por item limitado ao expedido (recebimentos simultâneos não passam do expedido).
- Saída manual, ajuste de saída e perda não consomem o reservado (disponível = físico − reservado).
- Referência do documento da transferência editável só na filial de origem.
- Data/hora do movimento manual interpretada no fuso da instalação.
- Cadastro de produto valida tudo (preço, parâmetros, saldo inicial e permissões) antes de gravar; repetição completa o que faltou.
- Consultas de estoque respeitam as filiais permitidas ao usuário.

#### Administração e acesso
- Perfil é por empresa (`roleByCompany`); sem perfil explícito vale o perfil legado se for da empresa ou o perfil de sistema de mesma chave daquela empresa; perfil personalizado de outra empresa não concede nada.
- Administrar outra empresa exige acesso a ela e perfil de administração nela. Não administrador não altera administrador global, não concede administração e não altera o próprio vínculo/perfil/limite.
- Edição de usuário preserva vínculos e filiais das empresas fora do alcance do editor. Limite de desconto individual e filiais permanecem globais por usuário.
- Último administrador ativo protegido também sob operações simultâneas (conferência após gravar, com desfazer).
- Empresa inativa não é selecionável (nem no consolidado); filial inativa só aparece no consolidado para consulta; sessão em unidade inativada volta à seleção.
- Teste do conector de periféricos é feito pelo navegador do caixa (o servidor nunca acessa a URL do conector — sem SSRF).
- Fuso horário único por instalação (`APP_TIMEZONE`, padrão America/Sao_Paulo); parâmetro e fuso da filial são somente leitura.
- Perfis de sistema recebem automaticamente operações novas dos modelos (sem remover o que o administrador configurou), com histórico.
- Login: o parâmetro `next` só aceita caminho interno.
- Chamado de suporte: anexos validados antes de criar; cada nova mensagem do solicitante notifica o atendimento.

#### Vendas e caixa
- Devolução de venda a prazo abate primeiro o saldo em aberto do título da venda (da última parcela para a primeira); reembolso/vale só sobre o que já foi pago e ainda não devolvido; título sem baixa real zerado pela devolução é cancelado. O abatimento é uma baixa do tipo “abatimento” (sem lançamento em conta). Na troca, o crédito é o valor compensado em vale (a parte abatida não vira crédito).
- Efeitos pós-confirmação de venda, cancelamento e devolução: tarefa durável com id determinístico gravada na mesma transação; repetir a operação completa os efeitos.
- Cada transação usa no máximo 95 escritas; venda limitada a 200 linhas (itens excedentes gravados pela tarefa); parcelas a prazo limitadas pela condição/meio.
- Travas otimistas com id determinístico: uso único de cobrança Pix por venda, vínculo único de troca, crédito por cliente, devolução por venda, sangria por sessão.
- Gaveta (sangria, suprimento, fechamento, saída de dinheiro em cancelamento/devolução): somente o operador da sessão ou quem pode “Reabrir caixa”, e somente na filial ativa.
- Recolhimento do fechamento: conta de destino da empresa, ativa e diferente do Caixa; valor ≤ dinheiro contado; fechamento interrompido é concluído pela repetição (“Concluir recolhimento”).
- Conferência cega imposta pelo servidor: a contagem é registrada na primeira apuração de cada versão; o previsto fica oculto para não supervisores até a contagem (recontagem: ver “Vendas e caixa (rodada 3)”).
- Pix: “cancelada” só com confirmação do provedor; estorno de Pix integrado fica “pendente no provedor” até a confirmação (repetido por tarefa); Pix manual → “Devolver ao cliente (manual)”.
- Estorno em cartão fica “em processamento” até a confirmação manual (NSU/protocolo da adquirente).
- Consulta da situação fiscal a partir da venda é feita pela tarefa durável (não exige permissão fiscal do usuário).

#### Drill-down do painel
- As listagens operacionais respeitam a filial da sessão (o consolidado só existe para quem tem acesso a todas as filiais). Um indicador só abre a listagem quando ela mostra exatamente o mesmo recorte; caso contrário, leva às operações do relatório gerencial no mesmo período.

#### Publicação
- Publicação na Vercel sem as variáveis do Appwrite mostra a página “configuração pendente” (nenhum dado é gravado); a demonstração em memória só existe se pedida explicitamente (`DATA_BACKEND=memory`).

#### Vendas e caixa (rodada 2)
- Na devolução, “já pago” = principal − desconto das baixas; a parte coberta por desconto concedido não é reembolsada.
- Cancelamento da venda: estoque e cancelamento fiscal acontecem sempre; títulos sem baixa são cancelados (com as renegociações em cascata); títulos com baixa são mantidos como pendência da venda e o financeiro é notificado. A recusa antes da confirmação também vale para renegociações com baixa.
- Conferência cega: qualquer mudança no previsto depois da contagem exige nova contagem (a anterior fica no histórico); até a contagem, recebimentos de venda em dinheiro e totais vendidos ficam ocultos para quem não é supervisor (telas e CSV).
- Venda a prazo cuja cadeia de títulos fica sem saldo após devolução passa a “paga”.
- Cobrança Pix integrada vencida, sem provedor configurado, pode ser encerrada localmente (“expirada”) com registro do risco.

#### Fiscal e integrações (rodada 2)
- O endereço da API de cada provedor é fixo no código (URL base não é configurável).
- A variável de credencial deve ter o formato `[A-Z][A-Z0-9_]{2,63}`, não pode ser variável do sistema (Appwrite, sessão, rotinas, hospedagem) e deve começar com o prefixo do provedor; vínculos gravados fora dessa regra contam como “não configurado” (o segredo nunca é lido). “Remover vínculo” deixa a integração sem credencial.
- A obrigação “Entrega de XML” só é concluída por pacote do mês inteiro, de todas as filiais; listar/baixar pacotes exige “Exportar dados”.
- Registro de inutilização não é descartado, consultado nem retransmitido: repete-se o pedido da mesma faixa (idempotente).
- A NF-e de uma operação é emitida pela filial da operação; o depósito dos efeitos é sempre da filial emitente.
- Envio ao provedor interrompido por falha libera a reivindicação e a tarefa é reagendada.

#### Painel e relatórios (rodada 2)
- Quebra por meio de pagamento: devolução de venda a prazo dividida em “Devolução — abatimento do título a prazo” (sem saída de caixa) e na forma de compensação (o restante); devoluções antigas sem abatimento registrado ficam inteiras na forma de compensação. Pagamentos − devoluções = receita líquida.
- Devolução com efeitos pendentes entra na receita, CMV e quantidade pelas linhas do próprio documento (data de registro); quando os itens são gravados, substituem essas linhas sem contagem dupla.
- CSV: número negativo já formatado (sinal, R$, dígitos, separadores, %) não é tratado como fórmula; fórmulas continuam neutralizadas.

#### Administração (rodada 2)
- Alcance do gestor de usuários = empresas em que ele tem Administração/editar e “Gerenciar usuários” no perfil daquela empresa; vínculos e filiais fora do alcance são preservados; incluir filial fora do alcance é recusado.
- Senha, situação, convite, e-mail, login e limite de desconto valem em todas as empresas do usuário: quem não é administrador só os altera se administra usuários em todas as empresas do alvo.
- Rotas `/api` e downloads exigem contexto de trabalho completo (empresa + filial ativa, ou consolidado); sem isso, 409 “Selecione a empresa e a filial…”.
- Download do pacote contábil exige “Exportar dados” além da consulta ao fiscal.
- Ações sobre outra empresa/filial exigem a permissão na empresa em uso e na empresa-alvo.
- Vincular usuário sem perfil equivalente é permitido com aviso e marca “sem perfil nesta empresa”.

#### Compras (rodada 2)
- Encargos sem XML só passam a “informados” quando o usuário altera um valor em relação ao exibido ao carregar o formulário; “Recalcular encargos pelo pedido” volta ao cálculo automático.
- Frete único do pedido: ver “Compras (rodada 3)” — vale quem confirmar a cobrança primeiro.
- Frete já cobrado em outro recebimento + valores informados > 0: a confirmação exige zerar, recalcular pelo pedido ou marcar “nova cobrança do fornecedor” com justificativa.
- Valor da linha sem XML = líquido exato da linha do pedido proporcional ao recebido (arredondamento acumulado; parciais somam exatamente o total).
- Cancelamento e registro de envio de pedido de uma solicitação disputam a mesma vaga de decisão da aprovação (só um vence; o perdedor relê).
- Cotação: rascunho reaproveitado é sempre ressincronizado (itens, condição, data).

##### Risco residual (compras)
- Confirmação de recebimento (aprovado → parcial) e revisão de pedido (→ em análise) ainda não disputam a vaga da decisão; uma revogação concorrente pode sobrescrever o estado do pedido (janela estreita).

#### Financeiro (rodada 2)
- Título com parcela renegociada em título de renegociação vigente não é cancelado: desfaça antes a renegociação. Cancelamento em cascata (somente renegociações sem recebimento) é usado apenas ao extinguir a dívida de origem (cancelamento da venda).
- Desfazer renegociação cujo título original está cancelado apenas cancela o título novo.
- Competência: abatimento por devolução reduz a receita na data do abatimento, na categoria do título, em linha própria “Devoluções (abatimento)”; abatimento de título cancelado não conta.
- “Recebido” = principal das baixas ativas; o abatido por devolução aparece à parte (não é desconto); exportação de contas a receber tem coluna “Abatido (devolução)”.
- Juros da condição valem só em títulos manuais; vendas e compras não os aplicam e o cadastro avisa explicitamente.
- Conflitos de concorrência (renegociação × cancelamento) respondem com mensagem de negócio (“alterado/cancelado por outra operação”).

#### Estoque (rodada 2)
- A reserva de estoque é serializada com os movimentos pela sequência do saldo; saídas manuais, ajustes de saída e perdas conferem no commit (limite atômico) que o reservado não passa do físico resultante. Vendas continuam podendo consumir o reservado.
- Cada reserva é encerrada (liberada ou consumida) uma única vez (marcador determinístico).
- Expedição × cancelamento simultâneos: o cancelamento prevalece; o que saiu volta à origem e a transferência nunca fica “em trânsito” sobre um cancelamento. Repetir o cancelamento conclui o que ficou pendente.
- /produtos e a exportação de produtos mostram só as filiais permitidas ao usuário.


## 19. Regras consolidadas na rodada final (revisão das correções) [Decisão]

Quando conflitam com as seções anteriores, estas prevalecem.

#### Administração e relatórios (rodada 3)
- A restrição de filiais é uma lista única e literal para todas as empresas do usuário. Quem não administra usuários em todas as empresas do alvo não inclui restrição em quem não tem e não remove a de quem tem; com restrição, empresa sem filial marcada fica sem acesso (nunca ampliação silenciosa) e desmarcar todas as filiais de uma empresa em que o usuário tinha acesso é recusado com pedido de escolha explícita.
- Quebra por meio de pagamento: a parte da devolução coberta por desconto concedido na baixa fica em linha própria (“coberta por desconto concedido no recebimento”) e não conta como reembolso.
- Detalhamento de abatimentos da competência: a coluna “Abatido” mostra só o valor do período (o total histórico fica à parte).

#### Vendas e caixa (rodada 3)
- Conferência cega — recontagem: se o previsto mudar depois da contagem, exige-se nova contagem, mas a diferença já revelada (por meio de pagamento) não pode ser apagada. Com D = diferença que vale da contagem anterior e N = diferença da nova contagem: vale N se D = 0, ou se N tem o mesmo sinal de D e é maior ou igual em valor absoluto; caso contrário mantém-se D (contado que vale = previsto atual + D, mínimo 0; o valor informado fica registrado). Se qualquer contagem da versão revelou diferença, o fechamento fica com divergência e exige justificativa. O recolhimento é limitado ao menor entre o contado que vale e o informado na última contagem.
- Valores ocultos até a contagem cega também no histórico de vendas filtrado pela sessão (tela e CSV), na coluna Total da aba de vendas da sessão e na soma de suprimentos/sangrias; somas de sessões informam quantas sessões ocultas ficaram de fora.
- “Pendente no Financeiro” da venda cancelada é recalculado pela situação atual dos títulos (some quando o título é cancelado).

#### Fiscal e integrações (rodada 3)
- Reivindicação de envio fiscal vale 5 min: “em andamento” vencida ou “falhou” é retomada por um único processo (um registro de retomada por episódio); retomada que trava além da validade e o estado antigo “abandonada” consomem a tentativa; carimbos inválidos ou no futuro contam como vencidos.
- A tarefa `fiscal.transmit` aguarda o mesmo detentor por no máximo 15 min (reagenda a cada 60 s); depois para, alerta no documento e orienta “Retransmitir”.
- Núcleo: qualquer tarefa que se reagenda sozinha tem limite geral de 200 execuções; depois segue o caminho de falha (retentativas com recuo até “morta”, com notificação).
- Credencial salva sem vínculo não tem vínculo: o nome padrão da variável é só sugestão até o primeiro salvamento (tela e execução).
- Registros de inutilização não contam como pendentes/rejeitados na fila da NFC-e; aparecem à parte com a orientação de repetir a inutilização.

#### Compras (rodada 3)
- Frete do pedido é cobrado uma vez, pelo primeiro recebimento sem XML que confirmar a cobrança; o marcador é gravado na passagem para “confirmando” (rascunho não reserva). Entrega parcial confirmada sem o frete não impede o próximo recebimento de assumi-lo (a conclusão é interrompida uma vez para revisão). O frete conta como cobrado quando há recebimento de XML do pedido ou recebimento sem XML confirmado com encargos informados > 0. Desvincular o pedido ou cancelar o recebimento libera o marcador.
- Revogação da aprovação é recusada quando há recebimento em conferência, em confirmação ou confirmado; a conclusão do recebimento disputa a vaga de decisão da solicitação.
- Cancelamento e revisão do pedido são recusados com recebimento em confirmação (inclusive confirmação interrompida).

#### Riscos residuais conhecidos
- Ver `docs/pendencias-externas.md` (seção “Riscos residuais conhecidos”).

## 20. Desempenho e experiência de navegação [Decisão]

- **Medição (06/10/2026, produção):** cada consulta ao Appwrite Cloud (região fra, função Vercel fra1) levou de 36 a 98 ms (≈70 ms). Antes das otimizações, uma navegação por 12 telas fazia 314 consultas (13 a 45 por tela) e cada tela disparava ~28 requisições de pré-carga em segundo plano.
- **Memória por requisição** (`src/lib/db/read-cache.ts`): durante a montagem de uma tela, a mesma consulta (tabela + filtros) vai ao banco uma única vez. Qualquer gravação limpa a memória. Fora da renderização (ações, tarefas, scripts, testes) nada é memorizado por requisição. Resultado: 314 → ~190 consultas na mesma navegação.
- **Memória curta entre requisições — 15 s por instância** para `companies`, `branches`, `roles`, `settings` e `payment_methods`. Na mesma instância, a gravação invalida na hora; em outra instância a alteração pode levar até 15 s para aparecer (ex.: perfil de permissão alterado, filial inativada, parâmetro mudado). Tabelas com contadores, saldos ou estado operacional (terminais, depósitos, estoque, caixa, títulos) **não** entram nessa memória.
- **Pré-carga só na intenção** (`src/components/ui/link.tsx`): links pré-carregam ao passar o mouse, tocar ou focar, e não mais todos os links visíveis do menu e das tabelas.
- **Gráficos sob demanda** (`src/components/charts/lazy.tsx`): a biblioteca de gráficos (~120 KB) carrega depois da página; painel inicial de 227 KB para 110 KB de JavaScript.
- **Retorno visual imediato:** botões com relevo e indicador de carregamento, barra de progresso global (`src/components/ui/nav-progress.tsx`) e tela "Carregando…" entre páginas (`src/app/(app)/loading.tsx`).
- **Diagnóstico:** `STORE_TRACE=1` registra cada leitura com a duração (`[store] list users 70ms`) nos logs; deixe `0` em operação normal.
- **Limite estrutural:** o banco (Appwrite fra) e o servidor (Vercel fra1) estão na Europa; quem acessa do Brasil soma ~200 ms de ida e volta por navegação. O Appwrite Cloud não oferece região no Brasil; mover só o servidor para São Paulo pioraria (cada consulta cruzaria o oceano).

## 21. Gestão contábil — fase 0 (escritório, carteira e vínculo) [Decisão]

- **Escritório = empresa do tipo `accounting`** (`companies.kind`). Convive com empresas operacionais (`retail`, padrão quando o campo está ausente) na mesma instalação; vários escritórios não se enxergam (isolamento por `companyId`, como qualquer empresa). O tipo é definido na criação e não muda. Um escritório nasce enxuto: unidade matriz, perfis próprios (`firm_admin`, `firm_manager`, `firm_analyst`, `firm_finance`), departamentos padrão (fiscal, contábil, pessoal, societário, BPO), contas caixa/banco, meios de recebimento (Pix, boleto, transferência, dinheiro), condições e categorias de honorários — sem depósitos, tabela de preço, unidades nem meios de PDV. Menu e painel são os do escritório (`navFor(kind)`, `/dashboard` → `/contabil`).
- **Cliente contábil é um cadastro próprio** (`accounting_clients`), PF ou PJ, do escritório — não é a empresa operacional do ERP. CPF/CNPJ único por escritório (outro escritório pode ter o mesmo CNPJ na carteira dele). Código sequencial `C0001` por escritório. Situações: implantação → ativo → em encerramento → encerrado (encerrar exige motivo; cliente vinculado não encerra antes de desfazer o vínculo; encerrado pode voltar a ativo). Serviços contratados são uma lista do catálogo fixo (contabilidade, fiscal, DP, societário, consultoria, IRPF, BPO, certidões) — contratos e honorários vêm na fase 2.
- **Regime tributário com vigência**: o cadastro guarda o regime atual; mudanças só pelo histórico (`accounting_client_regimes`): a vigência anterior é encerrada na véspera e a nova começa na data informada; vigência futura não altera o regime atual até a data; a edição do cadastro nunca sobrescreve regime nem situação. `regimeAt(cliente, data)` responde o regime vigente numa data.
- **Pessoas**: sócios (participação em pontos-base, soma ≤ 100% entre os ativos, um principal por tipo), representante legal, procurador e contatos. **Estabelecimentos**: só PJ; filial precisa ter a mesma raiz do CNPJ do cliente e não pode repetir CNPJ.
- **Equipe e carteira**: departamentos (com gestor e membros) e responsáveis por cliente (titular/substituto por departamento ou geral; um único titular por departamento — o anterior vira substituto). **Visibilidade**: quem tem "Ver toda a carteira" (ou é administrador) vê tudo; os demais veem só os clientes em que são responsável geral, titular/substituto, ou cujo departamento atribuído tem o usuário como gestor. A restrição vale para listas, detalhes e caixa de entrada.
- **Vínculo com a empresa do ERP exige consentimento das duas partes**: o escritório emite um código de vínculo (10 caracteres, válido por 30 dias, só o hash é guardado); o administrador da empresa no ERP (operação "Configurar integrações") informa o código em Integrações → Área da contabilidade. O aceite exige CNPJ coincidente (quando ambos existem), código não usado e não expirado, e a empresa não pode estar vinculada a outro escritório. Qualquer lado desfaz o vínculo; entregas já recebidas permanecem; um novo vínculo exige novo código.
- **Leitura da empresa vinculada é somente consulta**: o escritório lê a situação fiscal (documentos por mês, obrigações, certificados, pacotes, documentos parados) por um Store restrito à empresa vinculada e **somente leitura** (`ReadOnlyStore`): qualquer gravação é recusada. Sem vínculo ativo não há leitura.
- **Entrega automática**: quando a empresa vinculada gera o pacote mensal (manual ou pela rotina), uma **entrega** é registrada na caixa de entrada do escritório (idempotente por cliente + arquivo) e os usuários do escritório com o módulo são notificados. Sem e-mail da contabilidade, a entrega na caixa de entrada conta como envio do pacote e conclui a obrigação "Entrega de XML" da competência (pacote do mês inteiro). O escritório baixa o arquivo pela entrega (auditado); outro escritório nunca o vê. Salvar a configuração da integração não apaga o vínculo.
- **Telas do escritório** (`/contabil`): painel da carteira, clientes (lista com 9 filtros e exportação; cadastro com consulta de CNPJ; 360° em abas: resumo, pessoas, estabelecimentos, regime, responsáveis, fiscal, entregas, histórico), grupos, departamentos e equipe, caixa de entrada (conferir/reabrir, exportação, download auditado). Filtro "Responsável" na carteira considera responsável geral **ou** atribuição ativa (titular/substituto); "Sem responsável" = nenhum dos dois, mesma régua do painel; "Sem grupo" filtra clientes sem grupo. Consultar CNPJ exige apenas ver o módulo (dados públicos). Reconsultar o CNPJ na edição atualiza a situação na Receita e a fonte/data da consulta. Mensagens de situação usam os rótulos em português, nunca o código interno. Do lado da empresa, o cartão "Escritório contábil no Intercert" em Integrações → Contabilidade aceita o código (espaços e minúsculas são normalizados), mostra o escritório vinculado e o histórico do vínculo.
- **Erros de duplicidade e de registro inexistente** são reconhecidos pelo nome da classe além do `instanceof` (`isConflict`/`isNotFound`): em desenvolvimento o store é um singleton em `globalThis` criado por outro grafo de módulos, e o `instanceof` falhava mostrando o erro técnico no lugar da mensagem da regra.
- **Página "não encontrado" da área autenticada** (`src/app/(app)/not-found.tsx`) em português, com retorno ao painel; a resposta chega com HTTP 200 porque o shell é transmitido antes do `notFound()` (comportamento do framework com `loading.tsx`).
- **Demonstração**: o escritório recebe dois pacotes da loja — o fechamento do mês anterior (conclui a obrigação "Entrega de XML") e uma parcial do mês corrente, onde estão as notas da demonstração (emitidas no dia da carga).
- **Correções aproveitadas**: `simples_excesso` passou a ser aceito também na configuração fiscal (enumeração única de regimes).
- **Fora da fase 0** (registrado em `docs/analise-gestao-contabil.md`): comercial/propostas, contratos e honorários recorrentes, processos/tarefas e revisão, obrigações da carteira, regularidade/certidões/procurações, documentos e solicitações, atendimento com SLA, portal do cliente, horas/rentabilidade, BPO, migração, IA, identidade INTEROS (sem arquivos de marca no projeto).

## 22. Certificados digitais dos clientes (Tela 67 do Portal do Contador) [Decisão]

Fonte: `docs/referencia/Intercert_ERP_Tela_67_Certificados_Digitais_Comentada.pdf` (guia visual comentado, 13 páginas). A prévia do documento é simulada; aqui cada etapa é uma ação real de quem responde por ela.

- **Três atores.** Escritório (operação `accounting.certificates`: abre a solicitação, envia/reenvia a cobrança, pede a emissão, registra a autorização do titular quando o cliente não usa o ERP, baixa o certificado); **equipe de certificação Intercert** (operação `certification.operate`; administradores da plataforma a têm por padrão e ela pode ser delegada a um perfil): confirma o pagamento com a referência da transação, agenda/reagenda/aprova/recusa a validação do titular (ICP-Brasil, presencial ou vídeo), registra a emissão (arquivo .pfx) ou a falha, mantém o catálogo e as instruções de pagamento; **titular** (empresa vinculada no ERP, operação `admin.integrations`): autoriza o escritório a acompanhar e solicitar certificados e, por solicitação, a baixar o arquivo. A permissão de acompanhamento é independente do vínculo fiscal: sem ela, o escritório vê o aviso e prepara o pedido de acesso (notificação aos administradores da empresa). Cliente sem ERP não depende dessa autorização; o download exige a autorização registrada pelo escritório com descrição (≥ 10 caracteres) e evidência opcional.
- **Protocolo** `CERT-0001` sequencial por escritório; uma solicitação em atendimento por cliente (a tela direciona ao atendimento existente). Etapas: aguardando pagamento → validação do titular → pronto para emitir → emissão em andamento → (falha na emissão → nova tentativa, mesmo protocolo, **sem nova cobrança**) → aguardando autorização / pronto para baixar → download realizado. Cancelamento só enquanto não paga, com motivo; fica no histórico e bloqueia o resto. "Cobrança vencida" é um alerta dentro de "aguardando pagamento": reenviar exige atualizar o vencimento; a confirmação do pagamento continua possível.
- **Cobrança é da Intercert, separada da mensalidade do ERP**, pagamento único. Produto e valor vêm do catálogo da plataforma (padrão e-CNPJ A1 · 12 meses; valor editável por solicitação). Envio por e-mail é real pelo canal do escritório (falha não conta como envio); WhatsApp/telefone/outro são **envios manuais identificados** (texto pronto para copiar; o sistema registra quem, quando, canal e destinatário). A mensagem inclui as instruções de pagamento configuradas e, quando houver base configurada, o link `base/<protocolo>`; o gateway com confirmação automática é pendência externa — até lá a confirmação é feita pela equipe com a referência.
- **Emissão**: o arquivo .pfx/.p12 é obrigatório; com a senha (usada só na leitura, nunca gravada) o sistema lê validade, série e emissor e confere o CNPJ do titular contra a solicitação; sem senha, a validade é informada. O certificado emitido entra em `accounting_certificates` (origem "emitido") e desativa o anterior da renovação; o anterior permanece no histórico com as datas originais.
- **Download protegido**: só pela solicitação (`POST /api/certificados/<id>`), com **confirmação da senha do usuário** (sessão temporária criada e encerrada; nenhuma sessão fica aberta), contado e registrado (autor, momento, lado). A rota genérica de arquivos recusa o certificado emitido. A senha do certificado não existe no sistema nem nas mensagens. O titular baixa pela integração com `fiscal.configure`; o escritório, só com a autorização.
- **Validades e renovações**: certificados conhecidos = emitidos aqui + informados pelo escritório + A1 de emissão fiscal da empresa vinculada (só com a autorização de acompanhamento). Vence em até 30 dias ou vencido = atenção; renovação abre nova solicitação apontando o anterior. Rotina diária `accounting.certificates`: alerta ao responsável do cliente (ou a quem vê a carteira) por certificado vencido/≤ 7/≤ 30 dias e por cobrança vencida.
- **Histórico** do protocolo = auditoria da empresa do escritório (`certificate_request:<id>`): a equipe e o titular escrevem lá com o papel identificado ("Equipe de certificação", "Empresa vinculada"); o titular também recebe os eventos no histórico da integração.
- **Fora deste documento** (não implementado): itens do menu da prévia que não existem — Clientes e licenças, Minhas comissões, Análise e BPO — e a integração real com a certificadora/InterSuite (a fila da equipe é o ponto de troca para um conector futuro).


## 23. Devolução a fornecedor pelo recebimento (COM-11, Fase 3) [Decisão]

Evolução da NF-e de devolução (origem nova `receipt` em `loadOrigin`, `src/domain/fiscal/nfe.ts`; regras em `src/domain/supplier-returns.ts`). A origem por pedido de compra (`purchase_order`) continua igual (sem abatimento automático). Parâmetro `feature.devolucaoFornecedor` (padrão **ligado**): desligado, some o atalho "Devolver ao fornecedor" do recebimento e a origem `receipt` fica bloqueada.

- **Quando**: só recebimento **confirmado**, emitida pela filial do recebimento (operação `fiscal.issue`). Várias NF-e por recebimento (devoluções parciais sucessivas), mas **uma em andamento por vez** (rascunho/pendente/rejeitada é reaproveitada; na fila/processando/erro bloqueia a próxima). Referência determinística `nfe-receipt-<id>` e `-r<n>` a cada nova emissão (autorizadas e encerradas avançam a geração).
- **Quantidade**: devolvível por item = recebido − devolvido em NF-e de devolução **ativas** do recebimento (autorizadas ou em andamento). Canceladas, descartadas, denegadas e inutilizadas liberam a quantidade. Acima do restante → recusa (`over_return`), também na pré-visualização. Devoluções pelo pedido de compra não entram nessa conta.
- **Valores (servidor)**: por item, proporcionais à linha do recebimento — produtos (`lineValue`, o valor da linha da NF-e de entrada), desconto, frete e outras despesas (IPI/ST/seguro) rateados — `total × qtd ÷ recebido` (meio para cima); a devolução do **restante** do item fecha os centavos (total da linha − já devolvido). Preço unitário da NF-e = custo unitário da conferência; a diferença de arredondamento entre `qtd × preço` e o valor proporcional vai para o desconto do item (sobra) ou para outras despesas (falta), de modo que **total da NF-e = valor devolvido**. O formulário só escolhe itens e quantidades (e CFOP/CST/grupo/descrição); preços, desconto, frete, outras despesas, destinatário (fornecedor) e chave referenciada (chave da NF-e de entrada) vêm do recebimento.
- **CFOP** (validar com a contabilidade): CFOP de entrada do item quando houver (x101→x201, x102→x202, x401→x410, x403→x411); senão CFOP de entrada do recebimento x401/x403/x101; senão CFOP de saída do fornecedor com ST (x401, x402, x403, x404, x405) → x411; demais → x202. Prefixo 5 (mesma UF) ou 6 (fornecedor de outra UF). Sobreponível no passo Tributação.
- **Efeitos na AUTORIZAÇÃO** (também em simulação — mesmo `applyDocumentEffects` das demais NF-e): (1) estoque, se marcado (padrão = o recebimento deu entrada): saída tipo **"Saída por devolução ao fornecedor"** (`supplier_return`) pelo custo médio vigente, idempotente por item; (2) **abatimento no contas a pagar** do título gerado pelo recebimento.
- **Regra de abatimento escolhida: da ÚLTIMA parcela em aberto para a PRIMEIRA** (mesma regra da devolução de venda a prazo, §18) — o fornecedor continua recebendo as parcelas mais próximas e o crédito consome o fim do parcelamento. É uma baixa do tipo "abatimento" (sem lançamento em conta; principal = desconto = valor abatido; `methodKind = supplier_return`), na sequência da parcela (concorrência segura com pagamentos).
- **Título já pago**: o que exceder o saldo em aberto vira **título a receber do fornecedor** (origem `supplier_return`, parte = fornecedor, vencimento na data, mesma categoria/centro de custo do título a pagar), limitado ao **efetivamente pago** (principal − desconto das baixas) e ainda não creditado por outras devoluções do mesmo título. Não havia conceito de crédito/adiantamento de fornecedor; o título a receber é cobrado ou compensado pelo Financeiro. Excedente sem título em aberto nem pagamento (ex.: título cancelado) não gera efeito financeiro e notifica quem baixa títulos. Recebimento sem título a pagar: sem abatimento.
- **Uma única vez**: o marcador `operations` `supret-abate` (id determinístico pelo documento) é gravado na **mesma transação** das baixas de abatimento e do crédito; retentativas (consulta repetida, falha após autorizar) devolvem o resultado gravado.
- **Cancelamento da NF-e** (efeitos com `reversedAt`): estoque volta com o tipo "Estorno de devolução ao fornecedor" (`supplier_return_cancel`) pelo custo com que saiu; baixas de abatimento são estornadas (registro "estorno", parcelas voltam ao saldo, título recalculado) numa transação que marca o marcador como "reversed"; o crédito com o fornecedor é cancelado (com baixa → não cancela e notifica). Parcela/título cancelado depois do abatimento não é reaberto (registrado no histórico do documento).
- **Relatórios**: competência — abatimento de título a pagar reduz a **despesa** da categoria do título na data do abatimento (linha "Devoluções (abatimento)"); contas a pagar — "Pago" sem o abatido, coluna "Abatido (devolução)" como no a receber.
- **Recebimento**: botão "Devolver ao fornecedor" (recebimento concluído, `fiscal.issue`, filial do recebimento, parâmetro ligado) e cartão "Devoluções ao fornecedor" com recebido × devolvido × em andamento × restante por item e as NF-e emitidas.

## 24. Fase 3 — precificação após a entrada, alteração em massa e etiquetas [Decisão]

- **Motor único de reajuste de preço** (`src/domain/price-adjust.ts`), usado pela precificação após a entrada (COM-07) e pela alteração em massa (CAD-18). Regras: margem-alvo (preço = custo ÷ (1 − margem)), markup (custo × (1 + markup)), % sobre o preço atual, valor fixo e "manter a margem atual" (margem do preço atual sobre o custo **anterior** aplicada ao custo novo; sem preço ou margem válida, vale a margem padrão). Margem/markup exibidos continuam os de `priceMetrics` (§12) — o motor só faz o caminho inverso.
- **Arredondamento comercial** opcional: terminar em ,90, ,99 ou ,00, **para cima** por padrão (menor valor ≥ calculado com o final escolhido; ex.: 10,13 → 10,90; 10,95 → 11,90); "mais próximo" disponível na alteração em massa (empate para cima). Valor fixo nunca é arredondado.
- **Prévia obrigatória** e aplicação explícita linha a linha. Só o **preço geral** da tabela escolhida (sem filial e sem início de vigência) é alterado, pelo `savePrice` (histórico em `price_history` com motivo + auditoria do preço); preço por filial e vigências não são tocados. A linha só é gravada se o preço atual ainda for o da prévia (senão é ignorada: "o preço mudou desde a prévia"). Preço de atacado maior que o novo preço é erro da linha (não grava; os demais seguem). Preço abaixo do custo é permitido com aviso.
- **Lotes**: até 24 SKUs/produtos por transação (marcador + preço + até 2 linhas de histórico + auditoria ≤ 100 escritas — limite do Appwrite). Cada lote grava um marcador em `operations` (chave do envio + itens do lote) na mesma transação; repetir o envio devolve o mesmo resultado sem regravar. Lote com item inválido é refeito item a item. O trabalho inteiro fica em `operations` (`price.adjust` / `products.bulk_edit`) e numa auditoria-resumo (`price.bulk_adjust` / `product.bulk_edit`) com o motivo.
- **Precificação após a entrada** (`/compras/recebimentos/[id]/precificacao`, recebimento **confirmado**): custo novo = custo de entrada do recebimento (com frete/despesas rateados, ponderado quando o SKU aparece em mais de uma linha) + custos adicionais do SKU; custo anterior = o registrado no histórico pela confirmação (ids determinísticos), ou o custo atual quando não houve mudança. Parâmetros: `purchase.pricingMode` (padrão "manter a margem atual"), `pricing.defaultMarginBps` (padrão 30%; mesma chave usada no preço sugerido do produto cadastrado a partir da nota) e `purchase.priceEnding` (padrão sem arredondamento). Ao aplicar, o recebimento recebe `pricingStatus = "done"` (ausente = pendente); só itens do próprio recebimento podem ser precificados. Exige a operação **"Precificar após a entrada de mercadorias"** (`purchase.pricing`) e alterar produtos.
- **Alteração em massa** (`/produtos/alteracao-em-massa`): filtros iguais aos da lista de produtos (mesma consulta) + tabela de preço; até 500 SKUs na tela e 2.000 por aplicação. Campos cadastrais permitidos: categoria, marca, NCM (8 dígitos), grupo tributário, situação ativo/inativo e disponível no PDV — sempre pelos serviços da edição individual (`updateProduct`/`setProductStatus`, mesmas validações). Serviços são ignorados em NCM/grupo tributário; produto em rascunho não é ativado em massa. Exige **"Alterar produtos e preços em massa"** (`products.bulk_edit`) e alterar produtos. Não há "desfazer": o histórico de preços e a auditoria permitem rastrear e reverter manualmente.
- **Etiquetas** (`/produtos/etiquetas`, impressão por `?print=1`): modelos gôndola (64 × 34 mm, 21 por folha A4), adesiva (50 × 25 mm, rolo de 2 colunas) e folha A4 (3 × 10, tipo Pimaco 6180). Preço = resolução do PDV (tabela escolhida, filial do contexto, vigência do dia, sem atacado). Código de barras: EAN-13 quando o GTIN do SKU é um EAN-13 válido; senão Code 128 do GTIN ou do SKU (gerados em SVG, sem dependência). A partir do recebimento (`?recebimento=<id>`): uma etiqueta por unidade recebida (fração arredonda para cima). Até 2.000 etiquetas e 150 produtos por impressão; cada impressão é auditada.
- **Liga/desliga**: `feature.precificacaoEntrada`, `feature.alteracaoMassa` e `feature.etiquetas` (Parâmetros › Recursos), **ligados por padrão**; desligado, o menu e os atalhos somem e as rotas respondem como inexistentes. Perfis padrão Administrador e Gerente recebem as duas operações novas.

## 25. Fase 4 — recebimento de parcelas do crediário no PDV e fórmula do caixa (VEN-10) [Decisão]

**Mudança deliberada da fórmula do caixa (§5).** A partir desta fase, o dinheiro esperado passa a ser:

> **Dinheiro esperado = fundo + vendas em espécie (valor aplicado) + recebimentos de crediário em espécie (líquidos de estornos) + suprimentos − sangrias − devoluções em espécie.** O troco continua não deduzido de novo.

- Caixas **sem** recebimento de parcelas têm exatamente o mesmo resultado de antes (o termo novo é zero; `tests/baseline-calculos.test.ts` inalterado). Sessões antigas não mudam (não há movimento do tipo novo nelas).
- O recebimento **não é venda**: não entra em "Vendas", "Vendas em dinheiro", "Troco entregue" (`totals` do resumo), faturamento, CMV nem metas. Aparece em linha própria **"Recebimentos de crediário"** na sessão, nos movimentos, no fechamento e no relatório de caixa (resumo `receivables` de `sessionSummary`: total, dinheiro, lançamentos e por meio).
- **Meios não-dinheiro** (Pix, cartão, outros) entram no **previsto do próprio meio** (`byMethod`/`expectedOf`), como os das vendas — o fechamento confere-os junto (e a conferência de cartões/Pix passa a ser exigida quando houver recebimento nesses meios).
- **Conferência cega**: os valores dos recebimentos seguem a mesma ocultação dos recebimentos de venda em dinheiro até a contagem; um recebimento ou estorno depois da contagem invalida a contagem (o previsto mudou).

**Registro.** Cada parcela recebida = baixa do Financeiro (`finance.settleInstallment`, a mesma da tela Contas a receber — não há baixa própria do PDV) **+** movimento de caixa `type = "receivable"` (campo existente, valor novo) com `method` (meio) e `settlementId` (campo novo, opcional), **na mesma transação**. O recebimento (uma ou várias parcelas, inclusive de clientes distintos) é um registro em `operations` (`type = "pdv_receivable"`, id determinístico pela chave do formulário, número sequencial por empresa) com o plano das parcelas, valores, recebido e troco — base do recibo e do estorno.
- **Idempotência**: repetir a mesma chave devolve o mesmo recebimento e conclui parcelas pendentes; a baixa tem chave determinística por recebimento + parcela, e baixa e movimento nascem juntos (nunca há baixa sem movimento de caixa ou o contrário). Uma parcela já paga recusa novo recebimento (saldo). Se uma parcela falhar por regra de negócio no meio do recebimento (ex.: paga por outra operação no mesmo instante), o recebimento fica "parcial" com as parcelas concluídas e o operador é avisado para devolver a diferença.
- **Conta**: dinheiro → conta Caixa da filial (como as vendas em dinheiro); Pix/cartão/outros → a conta financeira vinculada ao meio de pagamento (meio sem conta não é oferecido). Cartão: a taxa do meio (`feeBps`) é lançada como tarifa da baixa (mesmo campo `fee` do Financeiro). Meios a prazo (crediário, boleto), vale e voucher não são aceitos. Recebível de cartão (`sale_card`) não aparece (liquidado só em Cartões).
- **Encargos**: multa e juros de atraso calculados no servidor no dia do recebimento por `lateChargeParams` + `suggestLateCharges` (mesma regra do Financeiro: multa única + juros simples pro rata dia, carência). Não são editáveis no PDV; quem precisar dispensá-los usa o desconto.
- **Desconto**: opcional, sobre o recebimento, rateado entre as parcelas pelo principal (maior resto), limitado ao saldo das parcelas. Limite = limite de desconto do operador (% do valor atualizado); acima, exige "Aprovar desconto acima do limite" (`sale.discount_over_limit`) — do próprio operador ou de um supervisor que informa login e senha no terminal (registrado no recebimento e na auditoria).
- **Caixa**: exige sessão aberta no terminal. Caixa aberto por outro operador segue o mesmo parâmetro da venda (`cash.operatorMismatch`: avisar — padrão, bloquear, permitir; supervisores de caixa sempre liberados); o aviso usa a mesma ocorrência da venda (um por sessão e operador).
- **Permissões**: "Receber parcelas do crediário no PDV" (`pdv.receive_installments`; perfis Caixa, Gerente e Administrador) e "Estornar recebimento de parcelas no PDV" (`pdv.reverse_receipt`; Gerente e Administrador — o caixa estorna com login e senha de um supervisor).

**Estorno no PDV.** Somente com a **mesma sessão de caixa ainda aberta** (o valor sai da mesma gaveta). Para cada parcela: `finance.reverseSettlement` (recompõe saldo, juros/multa/desconto da parcela e o título; lançamento inverso na conta) **+** movimento de caixa inverso (`type = "receivable"`, valor negativo, mesmo `settlementId`) na mesma transação. Idempotente (repetir não estorna duas vezes). O estorno pelo Financeiro de uma baixa recebida no PDV é **recusado enquanto o caixa do recebimento estiver aberto** (deve ser feito no PDV); com o caixa já fechado, o estorno é feito no Financeiro (o caixa fechado não é alterado; a saída de dinheiro, se houver, é registrada no caixa atual por sangria).

**Recibo.** `/caixa/recebimentos/[id]` (80 mm, padrão `?print=1`), agrupado por cliente, com principal, multa + juros, desconto, total, forma, recebido e troco; estornado aparece marcado. O recibo por título continua em Financeiro → Contas a receber → Recibo (link a partir do recibo do PDV para quem acessa o Financeiro).

**Liga/desliga.** `feature.recebimentoPdv` (Parâmetros › Recursos), **ligado por padrão** (aditivo). Desligado: a ação "Receber parcelas" (F9) some do PDV e nenhum recebimento novo é registrado (nenhum movimento do tipo novo); estornos de recebimentos já feitos continuam possíveis.
