// Gera docs/matriz-cobertura.md a partir de scripts/docs/coverage-map.json (fonte única) e da lista de visões/continuações do PDF.
// Uso: node scripts/docs/build-matrix.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const map = JSON.parse(fs.readFileSync(path.join(root, "scripts/docs/coverage-map.json"), "utf8"));
const spec = JSON.parse(fs.readFileSync(path.join(root, "scripts/docs/pdf-spec.json"), "utf8"));

const SPEC_FILE = {
  acesso: ["01", "02"], "vendas-caixa": ["04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"], "produtos-estoque": ["15", "16", "17", "18", "19"],
  clientes: ["20", "21"], financeiro: ["22", "23", "24", "25"], compras: ["26", "27", "28", "29", "46", "47", "48"],
  "fiscal-integracoes": ["30", "31", "32", "33", "34", "35", "40"], "administracao-suporte": ["36", "37", "38", "39", "41", "42", "43"],
  "painel-relatorios": ["03", "44", "45"],
};
const specFile = (n) => Object.keys(SPEC_FILE).find((k) => SPEC_FILE[k].includes(n));
/** Resumo do que o PDF mostra na tela (todas as páginas/visões do mesmo número). */
function observed(n) {
  const pages = spec.screens.filter((x) => x.number === n);
  const count = (k) => pages.reduce((a, x) => a + (x[k]?.length ?? 0), 0);
  const parts = [
    `${count("fields")} campos`,
    `${count("buttonsAndActions")} ações`,
    count("tabs") ? `${count("tabs")} abas` : null,
    count("filters") ? `${count("filters")} filtros` : null,
    count("tableColumns") ? `${count("tableColumns")} tabelas` : null,
    count("kpisAndCards") ? `${count("kpisAndCards")} cartões` : null,
  ].filter(Boolean);
  const f = specFile(n);
  return `${parts.join(", ")} — [especificação](referencia/telas/${f}.md)`;
}
/** Situação: implementada; quando há integração externa, indica a dependência para operação real. */
function situation(m) {
  const i = String(m.integ ?? "");
  if (/simula|Focus|Mercado Pago|TEF|canal|Open Finance|API banc|NFC-e|NF-e|provedor|conexão|convite|Conector|Pix/i.test(i)) return "Implementada · operação real depende de credencial externa";
  return "Implementada";
}

const SCREENS = [
  ["01", "Login", "Acesso e gestão", "5"], ["02", "Seleção de empresa e filial", "Acesso e gestão", "6"], ["03", "Painel do gestor", "Acesso e gestão", "7"],
  ["04", "Frente de caixa — PDV", "Vendas e caixa", "8"], ["05", "Busca de produtos no PDV", "Vendas e caixa", "9"], ["06", "Identificação do cliente", "Vendas e caixa", "10"],
  ["07", "Pagamento da venda", "Vendas e caixa", "11"], ["08", "Venda concluída", "Vendas e caixa", "12"], ["09", "Histórico de vendas", "Vendas e caixa", "13"],
  ["10", "Detalhes da venda", "Vendas e caixa", "14"], ["11", "Trocas e devoluções", "Vendas e caixa", "15"], ["12", "Abertura de caixa", "Vendas e caixa", "16"],
  ["13", "Suprimentos e sangrias", "Vendas e caixa", "17"], ["14", "Fechamento de caixa", "Vendas e caixa", "18"], ["15", "Lista de produtos", "Produtos e estoque", "19"],
  ["16", "Cadastro de produto", "Produtos e estoque", "20–22"], ["17", "Movimentação de estoque", "Produtos e estoque", "23"], ["18", "Transferência entre filiais", "Produtos e estoque", "24"],
  ["19", "Inventário e contagem", "Produtos e estoque", "25"], ["20", "Gestão de clientes", "Clientes", "26"], ["21", "Cadastro de cliente", "Clientes", "27"],
  ["22", "Contas a receber", "Financeiro", "28–29"], ["23", "Contas a pagar", "Financeiro", "30–31"], ["24", "Fluxo de caixa", "Financeiro", "32"],
  ["25", "Conciliação bancária", "Financeiro", "33–34"], ["26", "Gestão de fornecedores", "Compras", "35"], ["27", "Pedidos de compra", "Compras", "36"],
  ["28", "Novo pedido de compra", "Compras", "37"], ["29", "Recebimento de mercadorias", "Compras", "38"], ["30", "Gestão de NF-e de produtos", "Fiscal", "39–40"],
  ["31", "Emissão de NF-e", "Fiscal", "41"], ["32", "Gestão e emissão de NFS-e", "Fiscal", "42–43"], ["33", "Gestão de NFC-e do PDV", "Fiscal", "44–45"],
  ["34", "Configurações fiscais", "Fiscal", "46"], ["35", "Relatórios fiscais", "Fiscal", "47–48"], ["36", "Usuários e permissões", "Administração e suporte", "49–51"],
  ["37", "Histórico e auditoria", "Administração e suporte", "52–53"], ["38", "Empresas e filiais", "Administração e suporte", "54"], ["39", "Terminais do PDV", "Administração e suporte", "55"],
  ["40", "Central de integrações", "Administração e suporte", "56–58"], ["41", "Backup e restauração", "Administração e suporte", "59–60"], ["42", "Central de notificações", "Administração e suporte", "61–62"],
  ["43", "Ajuda e suporte", "Administração e suporte", "63"], ["44", "Relatórios gerenciais", "Análise e planejamento", "64–66"], ["45", "Produtos e curva ABC", "Análise e planejamento", "67–69"],
  ["46", "Planejamento de compras e reposição", "Análise e planejamento", "70–73"], ["47", "Cotação e comparação de fornecedores", "Análise e planejamento", "74–76"], ["48", "Aprovação de compras", "Análise e planejamento", "77–79"],
];

const VIEWS = [
  [1, "Cadastro do produto — dados fiscais", "21", "16", "/produtos/[id]?tab=fiscal", "tests/products.test.ts; tests/fiscal.test.ts (CST/CSOSN por regime)"],
  [2, "Cadastro do produto — custos e preços", "22", "16", "/produtos/[id]?tab=precos", "tests/products.test.ts (vigência, atacado, histórico de preço)"],
  [3, "Recebimento de um título (Receber título)", "29", "22", "/financeiro/receber/[id] (formulário de baixa)", "tests/finance.test.ts (baixa parcial/total, encargos)"],
  [4, "Baixa de pagamento (Baixar pagamento)", "31", "23", "/financeiro/pagar/[id] (formulário de baixa)", "tests/finance.test.ts"],
  [5, "Importação do extrato bancário", "34", "25", "/financeiro/conciliacao/importar", "tests/bank.test.ts (OFX, CSV, CNAB 240/400, duplicidade)"],
  [6, "Detalhes de uma NF-e", "40", "30", "/fiscal/nfe/[id]", "tests/fiscal.test.ts"],
  [7, "Formulário de emissão de NFS-e", "43", "32", "/fiscal/nfse/nova", "tests/fiscal.test.ts (cálculo ISS/retenções, título único)"],
  [8, "Detalhes de uma NFC-e", "45", "33", "/fiscal/nfce/[id]", "tests/fiscal.test.ts (cancelamento no prazo, contingência)"],
  [9, "Perfis e permissões de acesso", "50–51", "36", "/administracao/usuarios/perfis (+ /[id], /novo)", "tests/admin.test.ts"],
  [10, "Configuração da integração fiscal", "58", "40", "/administracao/integracoes/fiscal", "tests/integrations.test.ts"],
  [11, "Detalhamento do resultado por filial", "66", "44", "/relatorios/gerenciais/filial/[id]", "tests/reports.test.ts (conferência vendas − devoluções = receita)"],
  [12, "Detalhamento da sugestão de reposição", "73", "46", "/compras/reposicao/[skuId]", "tests/replenishment.test.ts"],
  [13, "Revisão dos fornecedores selecionados", "76", "47", "/compras/cotacoes/[id]?tab=revisao", "tests/purchases.test.ts"],
  [14, "Análise de uma solicitação de compra", "78–79", "48", "/compras/aprovacoes/[id]", "tests/purchases.test.ts (alçadas, concorrência de decisão)"],
];

const CONTINUATIONS = [
  ["35", "48", "Relatórios fiscais — parte 2 (relatórios, pacote contábil, obrigações)", "/fiscal/relatorios"],
  ["36", "51", "Perfis e permissões — parte 2 (painel do perfil Caixa)", "/administracao/usuarios/perfis/[id]"],
  ["37", "53", "Histórico e auditoria — parte 2 (detalhe do evento)", "/administracao/historico/[id]"],
  ["40", "57", "Central de integrações — parte 2 (detalhe/atividade)", "/administracao/integracoes/[kind]"],
  ["41", "60", "Backup e restauração — parte 2 (detalhe, restauração)", "/administracao/backups/[id]"],
  ["42", "62", "Central de notificações — parte 2 (detalhe, preferências)", "/notificacoes"],
  ["44", "65", "Relatórios gerenciais — parte 2 (quebras e comparação)", "/relatorios/gerenciais"],
  ["45", "68–69", "Produtos e curva ABC — partes 2 e 3 (Pareto, tabela, detalhe do produto)", "/relatorios/curva-abc (+ /produto/[skuId])"],
  ["46", "71–72", "Planejamento de reposição — partes 2 e 3 (tabela, seleção, criação de rascunhos)", "/compras/reposicao"],
  ["47", "75", "Cotação — parte 2 (matriz de propostas, seleção)", "/compras/cotacoes/[id]"],
];

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const evidence = (name) => {
  if (!name) return "—";
  for (const ext of ["jpg", "png"]) {
    if (fs.existsSync(path.join(root, `docs/evidencias/${name}.${ext}`))) return `[${name}](evidencias/${name}.${ext})`;
  }
  return `${name} (pendente)`;
};

let md = `# Matriz de cobertura — 48 telas, 14 visões complementares e continuações

Fonte: \`docs/referencia/Intercert_ERP_48_Telas_Comentadas.pdf\` (v1.0, 80 páginas). Este arquivo é gerado por \`node scripts/docs/build-matrix.mjs\`
a partir de \`scripts/docs/coverage-map.json\`. Especificação detalhada por tela (regiões, campos, ações, regras): \`docs/referencia/telas/*.md\`.

Legenda de integração: **real** = chamada ao serviço externo quando a credencial existe; **simulação** = provedor de simulação rotulado (selo “SIMULAÇÃO”),
nunca apresentado como operação real. Estados e dependências externas: \`docs/integracoes.md\` e \`docs/pendencias-externas.md\`.

## Telas (48)

| Nº | Tela | Grupo | Pág. PDF | Campos e ações observados no PDF | Rota(s) | Integrações | Validação (testes / e2e) | Situação | Evidência | Observações e decisões |
|---|---|---|---|---|---|---|---|---|---|---|
`;
for (const [n, name, group, pages] of SCREENS) {
  const m = map[n] ?? {};
  md += `| ${n} | ${esc(name)} | ${esc(group)} | ${pages} | ${observed(n)} | ${esc(m.route)} | ${esc(m.integ)} | ${esc(m.test)} | ${situation(m)} | ${evidence(m.evid)} | ${esc(m.notes)} |\n`;
}
md += `
## Visões complementares (14)

| # | Visão | Pág. PDF | Tela | Rota | Validação | Evidência |
|---|---|---|---|---|---|---|
`;
const VIEW_EVID = ["v01-produto-fiscal", "v02-produto-precos", "v03-receber-titulo", "v04-baixa-pagamento", "v05-importar-extrato", "v06-nfe-detalhe", "v07-nfse-formulario", "v08-nfce-detalhe", "v09-perfil-permissoes", "v10-integracao-fiscal", "v11-gerenciais-filial", "v12-reposicao-detalhe", "v13-cotacao-revisao", "v14-aprovacao-analise"];
for (const [i, name, pages, screen, route, test] of VIEWS) md += `| ${i} | ${esc(name)} | ${pages} | ${screen} | \`${esc(route)}\` | ${esc(test)} | ${evidence(VIEW_EVID[i - 1])} |\n`;
md += `
## Continuações (partes 2/3 das telas)

| Tela | Pág. PDF | Conteúdo | Rota |
|---|---|---|---|
`;
for (const [screen, pages, name, route] of CONTINUATIONS) md += `| ${screen} | ${pages} | ${esc(name)} | \`${esc(route)}\` |\n`;
md += `
## Inconsistências do PDF e decisões

Cada tela tem a lista de inconsistências do protótipo em \`docs/referencia/telas/*.md\` (seção “Inconsistências do protótipo”). As orientações gerais foram aplicadas assim:

| Inconsistência | Decisão implementada |
|---|---|
| Condições de pagamento do fornecedor diferem entre comparação (p. 74) e revisão (p. 76) | Proposta, revisão e pedido leem a mesma condição comercial vigente da proposta selecionada (versão preservada no pedido via \`proposalRef\`). |
| Comparação e revisão mostram seleções/totais diferentes | Toda mudança de seleção recalcula produtos, fretes e pedidos agrupados no servidor; revisão e comparação usam a mesma função. |
| Datas em formato mês/dia nas imagens | Exibição \`dd/mm/aaaa\`; armazenamento \`AAAA-MM-DD\`/ISO UTC; filtros com intervalo \`[início, dia seguinte ao fim)\` no fuso da instalação. |
| Devolução de venda anterior ao recorte nos gerenciais | Entra na data do movimento, com origem, custo revertido e selo “anterior ao período”. |
| Produto sem receita positiva na curva ABC | Fica “Sem classe”, fora da base; reconciliação entre receita total do recorte e base da curva exibida. |
| Estados “saltados” (aprovar ≠ enviar ≠ receber ≠ obrigação ≠ pagar) | Eventos distintos, cada um com seu registro, permissão e auditoria. |
| Selos demonstrativos (“autorizada”, “integridade verificada”, “conexão configurada”, “sucesso”) | Substituídos por estados medidos (retorno do provedor, checksum verificado, teste de conexão executado, resultado real do envio). |
| “4 itens” contando unidades × 3 linhas (PDV) | Contador mostra linhas e unidades separadamente. |
| Atalho F2 com significados diferentes (telas 04 e 08) | F2 = buscar produto no PDV; “Nova venda” tem atalho próprio. |
| Pix pré-selecionado sem ação do operador | Nenhum meio pré-selecionado. |

## Páginas que não são telas

- Págs. 1–4: capa, apresentação e sumário (navegação do guia).
- Pág. 80: consolidação do escopo — usada como referência de módulos e prioridades.
- Elementos do guia (rótulo “TELA NN”, link “SUMÁRIO”) não fazem parte do produto.

## Complementos além do PDF (necessários ao fluxo)

| Rota | Motivo |
|---|---|
| \`/primeiro-acesso\` | Instalação inicial segura (provisiona o banco Appwrite, cria empresa e administrador; exige \`SETUP_TOKEN\` em produção). |
| \`/recuperar-senha\`, \`/redefinir-senha\`, \`/convite/[token]\` | Recuperação de senha (Appwrite Auth) e ativação por convite. |
| \`/suporte\` | Chamado público a partir da tela de login (sem sessão). |
| \`/caixa/[id]\`, \`/caixa/[id]/relatorio\`, \`/caixa/movimentos/[id]/comprovante\` | Consulta da sessão de caixa, relatório de fechamento e comprovante de suprimento/sangria. |
| \`/vendas/[id]/recibo\`, \`/fiscal/*/[id]/imprimir\` | Recibo 80 mm e impressão de DANFE/DANFCE/DANFSE. |
| \`/financeiro/contas/[id]\`, \`/financeiro/cadastros\`, \`/financeiro/cartoes\` | Extrato interno da conta, cadastros financeiros e recebíveis de cartão. |
| \`/produtos/cadastros\`, \`/produtos/importar\` | Categorias, marcas, unidades, tabelas de preço, grupos tributários; importação em lote. |
| \`/dashboard/metas\` | Cadastro de metas usadas no painel. |
| \`/api/jobs\` | Executor de tarefas duráveis (Vercel Cron) — emissão/consulta fiscal, efeitos de venda, rotinas. |
| \`/api/files/[id]\`, \`/api/export/[key]\` | Download controlado de arquivos e exportações CSV. |
`;
fs.writeFileSync(path.join(root, "docs/matriz-cobertura.md"), md);
console.log("docs/matriz-cobertura.md gerado");
