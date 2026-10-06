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

- **Dinheiro esperado** = fundo + recebimentos em espécie (valor aplicado à venda) + suprimentos − sangrias − devoluções em espécie. O troco não é deduzido novamente.
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
- **Correções aproveitadas**: `simples_excesso` passou a ser aceito também na configuração fiscal (enumeração única de regimes).
- **Fora da fase 0** (registrado em `docs/analise-gestao-contabil.md`): comercial/propostas, contratos e honorários recorrentes, processos/tarefas e revisão, obrigações da carteira, regularidade/certidões/procurações, documentos e solicitações, atendimento com SLA, portal do cliente, horas/rentabilidade, BPO, migração, IA, identidade INTEROS (sem arquivos de marca no projeto).
