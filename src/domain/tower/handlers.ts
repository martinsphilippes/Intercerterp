import type { ServiceCall, ServiceResult } from "@/lib/service/http";
import { openTower, parseEnum, parseFlag } from "./common";
import { returnTransactions, saleTransactions, salesByUnit, salesSeries, salesSummary, type SaleSituation } from "./sales";
import { productRanking, skuRanking } from "./products";
import { cashBlock, commerceBlock, commerceChannel, financeBlock, financeDetail, fiscalBlock, purchasesBlock, stockBlock, stockPositions } from "./operations";
import { adoptionBlock } from "./adoption";
import { anyContracted } from "../tenancy/contracted";

/**
 * Operações da Torre de Controle (uma por rota GET de /api/interos/v1/empresas/{idEmpresa}/torre/...). Cada uma abre a
 * consulta (empresa vinculada, parâmetros, contexto restrito) e devolve `{ meta, ... }`. Contrato e definições:
 * docs/interos/torre-indicadores.md.
 */

const done = (t: { companyId: string }, body: Record<string, unknown>): ServiceResult => ({ companyId: t.companyId, body });

/** GET .../torre/resumo — todos os blocos (torre:resumo). */
export async function towerSummary(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.resumo", period: true });
  // só os blocos dos módulos contratados (correção 6): o bloco de módulo não contratado vem null
  const has = (...keys: string[]) => anyContracted(t.areas, ...keys);
  const [sales, pdv, commerce, stock, purchases, finance, fiscal] = await Promise.all([
    has(...SALES_AREAS) ? salesSummary(t) : null,
    has("pdv") ? cashBlock(t) : null,
    has("comercio_digital") ? commerceBlock(t) : null,
    has("estoque") ? stockBlock(t) : null,
    has("compras") ? purchasesBlock(t) : null,
    has("financeiro") ? financeBlock(t) : null,
    // fiscal completo (documentos por modelo e situação): o mesmo corpo de /torre/fiscal
    has("fiscal") ? fiscalBlock(t, true) : null,
  ]);
  if (sales && commerce) sales.vendas.porCanal.comercioDigital = commerceChannel(commerce);
  return done(t, { meta: t.meta, vendas: sales?.vendas ?? null, devolucoes: sales?.devolucoes ?? null, pdv, comercioDigital: commerce, estoque: stock, compras: purchases, financeiro: finance, fiscal });
}

/** Vendas e devoluções existem com PDV, documentos de venda ou loja virtual. */
const SALES_AREAS = ["pdv", "vendas", "comercio_digital"];

/** GET .../torre/vendas/serie?granularidade=dia|mes (torre:resumo). */
export async function towerSalesSeries(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.vendas.serie", period: true, requires: SALES_AREAS, parse: (q, issues) => ({ granularidade: parseEnum(q, "granularidade", ["dia", "mes"] as const, "dia", issues) }) });
  return done(t, { meta: t.meta, ...(await salesSeries(t)) });
}

/** GET .../torre/vendas/por-unidade (torre:resumo). */
export async function towerSalesByUnit(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.vendas.por_unidade", period: true, requires: SALES_AREAS });
  return done(t, { meta: t.meta, ...(await salesByUnit(t)) });
}

const ranking = (op: string) => (call: ServiceCall) =>
  openTower(call, { op, period: true, paged: true, requires: SALES_AREAS, parse: (q, issues) => ({ incluirSemMovimento: parseFlag(q, "incluirSemMovimento", false, issues) }) });

/** GET .../torre/produtos (torre:detalhe). */
export async function towerProducts(call: ServiceCall): Promise<ServiceResult> {
  const t = await ranking("torre.produtos")(call);
  return done(t, { meta: t.meta, ...(await productRanking(t)) });
}

/** GET .../torre/skus (torre:detalhe). */
export async function towerSkus(call: ServiceCall): Promise<ServiceResult> {
  const t = await ranking("torre.skus")(call);
  return done(t, { meta: t.meta, ...(await skuRanking(t)) });
}

/** GET .../torre/transacoes/vendas?situacao=concluida|cancelada|todas (torre:transacoes). */
export async function towerSaleTransactions(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, {
    op: "torre.transacoes.vendas",
    period: true,
    paged: true,
    requires: SALES_AREAS,
    parse: (q, issues) => ({ situacao: parseEnum<SaleSituation>(q, "situacao", ["concluida", "cancelada", "todas"], "concluida", issues) }),
  });
  return done(t, { meta: t.meta, ...(await saleTransactions(t)) });
}

/** GET .../torre/transacoes/devolucoes (torre:transacoes). */
export async function towerReturnTransactions(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.transacoes.devolucoes", period: true, paged: true, requires: SALES_AREAS });
  return done(t, { meta: t.meta, ...(await returnTransactions(t)) });
}

/** GET .../torre/estoque — posições atuais (torre:detalhe; sem período). */
export async function towerStock(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.estoque", period: false, paged: true, requires: ["estoque"] });
  return done(t, { meta: t.meta, ...(await stockPositions(t)) });
}

/** GET .../torre/financeiro (torre:resumo). */
export async function towerFinance(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.financeiro", period: true, requires: ["financeiro"] });
  return done(t, { meta: t.meta, ...(await financeDetail(t)) });
}

/** GET .../torre/fiscal (torre:resumo). */
export async function towerFiscal(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.fiscal", period: true, requires: ["fiscal"] });
  return done(t, { meta: t.meta, ...(await fiscalBlock(t, true)) });
}

/** GET .../torre/compras (torre:resumo). */
export async function towerPurchases(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.compras", period: true, requires: ["compras"] });
  return done(t, { meta: t.meta, ...(await purchasesBlock(t, true)) });
}

/** GET .../torre/comercio-digital (torre:resumo). */
export async function towerCommerce(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.comercio_digital", period: true, requires: ["comercio_digital"] });
  return done(t, { meta: t.meta, ...(await commerceBlock(t, true)) });
}

/** GET .../torre/adocao (torre:resumo; sem período). */
export async function towerAdoption(call: ServiceCall): Promise<ServiceResult> {
  const t = await openTower(call, { op: "torre.adocao", period: false });
  return done(t, { meta: t.meta, ...(await adoptionBlock(t)) });
}
