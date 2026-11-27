#!/usr/bin/env node
/**
 * Marca cada server action (runAction) com o módulo do catálogo que a governa: insere
 * `entitlement: "<chave>", action: "<nome da função>"` nas opções. Idempotente (chamadas já marcadas são mantidas).
 *
 * A tabela abaixo é o mapa rastreável AÇÃO → MÓDULO: padrão por arquivo e exceções por função. Depois de rodar, a
 * fonte de verdade é o próprio código; tests/modules-coverage.test.ts recusa runAction sem módulo ou com chave inexistente.
 *
 *   node scripts/modules/annotate-actions.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const APP = path.join(ROOT, "src/app");

const R = "financeiro.contas_receber", P = "financeiro.contas_pagar";
const MAP = {
  "(app)/administracao/backups/actions.ts": { "*": "plataforma.backup" },
  "(app)/administracao/empresas/actions.ts": { "*": "plataforma.administracao" },
  "(app)/administracao/importacao/actions.ts": { "*": "implantacao.importacao" },
  "(app)/administracao/integracoes/actions.ts": { "*": "plataforma.administracao" },
  "(app)/administracao/parametros/actions.ts": { "*": "plataforma.administracao" },
  "(app)/administracao/terminais/actions.ts": { "*": "vendas.pdv" },
  "(app)/administracao/usuarios/actions.ts": { "*": "plataforma.administracao" },
  "(app)/ajuda/chamados/actions.ts": { "*": "plataforma.painel" },
  "(app)/caixa/actions.ts": { "*": "caixa.operacao" },
  "(app)/clientes/actions.ts": { "*": "cadastros.clientes" },
  "(app)/compras/_shared/actions.ts": { "*": ["compras.pedidos", "compras.cotacoes", "compras.recebimento"] },
  "(app)/compras/aprovacoes/actions.ts": { "*": "compras.aprovacoes" },
  "(app)/compras/cotacoes/actions.ts": { "*": "compras.cotacoes" },
  "(app)/compras/cte/actions.ts": { "*": "compras.cte" },
  "(app)/compras/pedidos/actions.ts": { "*": "compras.pedidos", quotationFromFormAction: "compras.cotacoes" },
  "(app)/compras/recebimentos/[id]/precificacao/actions.ts": { "*": "compras.precificacao" },
  "(app)/compras/reposicao/actions.ts": { "*": "compras.reposicao", createDraftsAction: "compras.pedidos", quotationFromReplenishmentAction: "compras.cotacoes" },
  "(app)/compras/recebimentos/actions.ts": { "*": "compras.recebimento", pendingInvoiceEntryAction: "compras.nota_a_confirmar", invoiceConfirmAction: "compras.nota_a_confirmar", cancelScheduledAction: "compras.nota_a_confirmar" },
  "(app)/conta/seguranca/actions.ts": { "*": "plataforma.acesso" },
  "(app)/contabil/actions.ts": { "*": "contabil.carteira", reviewDeliveryAction: "contabil.entregas", acceptLinkCodeAction: "integracao.contabilidade", revokeLinkByCompanyAction: "integracao.contabilidade" },
  "(app)/contabil/certificados/actions.ts": {
    "*": "contabil.certificados",
    // equipe de certificação da Intercert (plataforma; a operação certification.operate continua exigida no domínio)
    teamRequestEmissionAction: "rede.plataforma", teamCancelRequestAction: "rede.plataforma", confirmPaymentAction: "rede.plataforma", scheduleValidationAction: "rede.plataforma",
    approveValidationAction: "rede.plataforma", rejectValidationAction: "rede.plataforma", registerEmissionAction: "rede.plataforma", emissionFailureAction: "rede.plataforma", saveCertificationSettingsAction: "rede.plataforma",
    // lado da empresa vinculada (Integrações › Contabilidade)
    recordAuthorizationAction: ["contabil.certificados", "integracao.contabilidade"], setCertificateTrackingAction: ["contabil.certificados", "integracao.contabilidade"], authorizeDownloadAction: ["contabil.certificados", "integracao.contabilidade"],
  },
  "(app)/dashboard/metas/actions.ts": { "*": "gestao.metas" },
  "(app)/financeiro/actions.ts": {
    "*": [R, P],
    approvePayableAction: P, revokeApprovalAction: P,
    renegotiateAction: R, undoRenegotiationAction: R, sendNoticeAction: R,
    saveAccountAction: "tec.financeiro", changeInitialBalanceAction: "tec.financeiro", rebuildBalancesAction: "tec.financeiro", savePaymentMethodAction: "tec.financeiro",
    savePaymentTermAction: "tec.financeiro", saveCategoryAction: "tec.financeiro", saveCostCenterAction: "tec.financeiro", setActiveAction: "tec.financeiro", saveFinanceParamsAction: "tec.financeiro",
    createEntryAction: "financeiro.fluxo_caixa", reverseEntryAction: "financeiro.fluxo_caixa", transferAction: "financeiro.fluxo_caixa",
    previewImportAction: "financeiro.conciliacao", importAction: "financeiro.conciliacao", reconcileAction: "financeiro.conciliacao", undoReconciliationAction: "financeiro.conciliacao",
    ignoreTxAction: "financeiro.conciliacao", restoreTxAction: "financeiro.conciliacao", settleFromTxAction: "financeiro.conciliacao",
    settleCardAction: "financeiro.cartoes", settleCardsBatchAction: "financeiro.cartoes",
  },
  "(app)/financeiro/cartoes/adquirente/actions.ts": { "*": "financeiro.taxas_adquirente" },
  "(app)/financeiro/cobranca/actions.ts": { "*": "financeiro.cobranca_whatsapp" },
  "(app)/financeiro/exportacao-dominio/actions.ts": { "*": "financeiro.exportacao_dominio" },
  "(app)/financeiro/fechamento/actions.ts": { "*": "financeiro.fechamento_periodo" },
  "(app)/fiscal/actions.ts": {
    // ciclo de vida de documentos existentes (transmitir, consultar, cancelar, CC-e): motor fiscal — obrigações continuam
    "*": "tec.fiscal",
    previewNfeAction: "fiscal.nfe", saveNfeAction: "fiscal.nfe", saveNfseAction: "fiscal.nfse",
    saveReformAdherenceAction: "fiscal.reforma_tributaria",
    saveNatureAction: "fiscal.tributacao_avancada", saveCompleteSettingsAction: "fiscal.tributacao_avancada", saveSimplesCreditAction: "fiscal.tributacao_avancada",
  },
  "(app)/fiscal/arquivos/actions.ts": { "*": "fiscal.sped" },
  "(app)/fiscal/arquivos/sintegra/actions.ts": { "*": "fiscal.sintegra" },
  "(app)/fiscal/entradas/actions.ts": { "*": "fiscal.livro_entradas" },
  "(app)/fornecedores/actions.ts": { "*": "cadastros.fornecedores" },
  "(app)/notificacoes/actions.ts": { "*": "plataforma.painel" },
  "(app)/modulo-indisponivel/actions.ts": { "*": "plataforma.painel" },
  "(app)/produtos/alteracao-em-massa/actions.ts": { "*": "produtos.alteracao_massa" },
  "(app)/produtos/balanca/actions.ts": { "*": "produtos.balanca" },
  "(app)/produtos/cadastros/actions.ts": { "*": "cadastros.produtos" },
  "(app)/produtos/etiquetas/actions.ts": { "*": "produtos.etiquetas" },
  "(app)/produtos/promocoes/actions.ts": { "*": "produtos.promocoes" },
  "(app)/produtos/actions.ts": {
    "*": "cadastros.produtos", setLotControlAction: "estoque.lotes",
    setCompositionAction: "produtos.kits", saveComponentAction: "produtos.kits", removeComponentAction: "produtos.kits", searchComponentSkusAction: "produtos.kits",
  },
  "(app)/estoque/actions.ts": {
    "*": "estoque.gestao", runAssemblyAction: "produtos.kits",
    saveTransferAction: "estoque.transferencias", warehouseTransferAction: "estoque.transferencias", separateTransferAction: "estoque.transferencias", shipTransferAction: "estoque.transferencias",
    receiveTransferAction: "estoque.transferencias", resolveTransferAction: "estoque.transferencias", cancelTransferAction: "estoque.transferencias", setTransferDocumentAction: "estoque.transferencias",
    createInventoryAction: "estoque.inventario", resumeInventoryAction: "estoque.inventario", saveCountsAction: "estoque.inventario", addInventoryItemAction: "estoque.inventario",
    concludeInventoryAction: "estoque.inventario", cancelInventoryAction: "estoque.inventario",
  },
  "(app)/pdv/actions.ts": {
    "*": "vendas.pdv", startExchangeAction: "vendas.devolucoes",
    pdvOpenInstallmentsAction: "pdv.recebimento_crediario", pdvReceiveInstallmentsAction: "pdv.recebimento_crediario", pdvSessionReceiptsAction: "pdv.recebimento_crediario", pdvReverseReceiptAction: "pdv.recebimento_crediario",
    billableDocumentsAction: "vendas.documentos", documentLinesAction: "vendas.documentos", importDocumentAction: "vendas.documentos",
  },
  "(app)/comercio-digital/actions.ts": {
    "*": "ecommerce.loja",
    saveCouponAction: "ecommerce.promocoes", setCouponActiveAction: "ecommerce.promocoes", testCouponAction: "ecommerce.promocoes", saveRecoveryDraftAction: "ecommerce.promocoes",
    simulateCreditsAction: "ecommerce.banco", reconcileAction: "ecommerce.banco", setSettlementAccountAction: "ecommerce.banco", preparePayoutAction: "ecommerce.banco",
    prepareChannelAction: "ecommerce.canais",
  },
  "(app)/rede/actions.ts": { "*": "rede.parceiro" },
  "(app)/rede/vendas/actions.ts": {
    "*": "rede.vendas",
    createCouponAction: "rede.vouchers_cupons", setCouponActiveAction: "rede.vouchers_cupons", createPackageAction: "rede.vouchers_cupons", purchasePackageAction: "rede.vouchers_cupons",
    setPackageActiveAction: "rede.vouchers_cupons", issueCodeAction: "rede.vouchers_cupons", cancelCodeAction: "rede.vouchers_cupons",
    registerContactAction: "rede.renovacoes", saveIdleDaysAction: "rede.renovacoes",
  },
  "(app)/rede/financeiro/actions.ts": { "*": "rede.financeiro" },
  "(app)/vendas/_documentos/actions.ts": { "*": "vendas.documentos" },
  "(app)/vendas/actions.ts": { "*": "vendas.pdv", refreshFiscalAction: "tec.fiscal", processReturnAction: "vendas.devolucoes", confirmCardReversalAction: "vendas.devolucoes" },
  "(app)/vendas/comissoes/actions.ts": { "*": "vendas.comissoes" },
  "(app)/vendas/vendedores/actions.ts": { "*": "vendas.comissoes" },
};

/** fim do primeiro argumento de runAction( a partir de `start` (logo após o parêntese) */
function firstArgEnd(src, start) {
  let depth = 0, i = start, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) { if (depth === 0) return i; depth--; }
    else if (c === "," && depth === 0) return i;
  }
  throw new Error("argumento sem fim");
}

function enclosingFunction(src, pos) {
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let name = null, m;
  while ((m = re.exec(src)) && m.index < pos) name = m[1];
  return name;
}

const check = process.argv.includes("--check");
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "actions.ts") files.push(p); } };
walk(APP);
let changed = 0, missing = [];
for (const file of files) {
  const rel = path.relative(APP, file).split(path.sep).join("/");
  let src = fs.readFileSync(file, "utf8");
  if (!src.includes("runAction(")) continue;
  const map = MAP[rel];
  if (!map) { missing.push(rel); continue; }
  let out = "", last = 0, idx;
  const re = /runAction\(/g;
  while ((idx = re.exec(src))) {
    const s0 = idx.index + "runAction(".length;
    const end = firstArgEnd(src, s0);
    const arg = src.slice(s0, end).trim();
    if (src.slice(idx.index - 20, idx.index).includes("function ")) continue; // definição
    if (arg.includes("entitlement:")) continue;
    const fn = enclosingFunction(src, idx.index);
    const key = map[fn] ?? map["*"];
    const lit = JSON.stringify(key).replace(/,/g, ", ");
    const tag = `entitlement: ${lit}, action: "${fn}"`;
    const repl = arg.startsWith("{") ? `{ ${tag}, ${arg.slice(1).trimStart()}` : `{ ${tag}, ...${arg} }`;
    out += src.slice(last, s0) + repl;
    last = end;
    changed++;
  }
  out += src.slice(last);
  if (!check && out !== src) fs.writeFileSync(file, out);
}
if (missing.length) { console.error("Arquivos de ações sem mapa de módulo:", missing); process.exit(1); }
console.log(check ? `${changed} chamada(s) sem módulo` : `${changed} chamada(s) marcada(s)`);
if (check && changed) process.exit(1);
