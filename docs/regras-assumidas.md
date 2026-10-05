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

> As seções de cada módulo (compras, reposição, curva ABC, conciliação, inventário etc.) estão a seguir.
