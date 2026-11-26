import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { abcReport, classifyAbc, getAbcLimits, type AbcLimits, type Classification } from "@/domain/abc";
import { emptyTotals, groupTotals, loadFacts, type Totals } from "@/domain/reports";
import { reportScope, type TowerRequest } from "./common";
import { pageBy } from "./pagination";

/**
 * Produtos e SKUs (escopo torre:detalhe): receita, quantidade, custo, margem e classe ABC sobre a MESMA base comercial.
 *  - SKUs: `abcReport` (curva ABC da tela, critério receita líquida) — classe, posição, participação e acumulado iguais aos
 *    da tela para o mesmo recorte e os mesmos limites (`getAbcLimits`: parâmetros da empresa, ou da filial quando o
 *    filtro tem uma única unidade, como na tela).
 *  - Produtos: totais por produto com `groupTotals` e a MESMA política de classificação (`classifyAbc`, mesmos limites).
 * Ordem das listas: receita líquida (desc), quantidade líquida (desc), código (asc) — a ordem da curva ABC.
 */

export interface RankingOptions {
  incluirSemMovimento: boolean;
}

async function limitsFor(t: TowerRequest<any>): Promise<AbcLimits> {
  const single = t.branchIds && t.branchIds.length === 1 ? t.branchIds[0] : null;
  return getAbcLimits(t.store, t.companyId, single);
}

/** Valores de um agregado (SKU ou produto). Margem só com custo registrado nas vendas (custo ausente vira 0 no ERP). */
function figures(r: Totals) {
  const withCost = r.costSold > 0;
  return {
    receitaBrutaCentavos: r.gross,
    descontosCentavos: r.discounts,
    acrescimosCentavos: r.surcharges,
    devolucoesCentavos: r.returns,
    receitaLiquidaCentavos: r.netRevenue,
    quantidadeVendidaMilesimos: r.qtySold,
    quantidadeDevolvidaMilesimos: r.qtyReturned,
    quantidadeLiquidaMilesimos: r.qtyNet,
    quantidadeVendas: r.salesCount,
    custoRegistrado: withCost,
    custoMercadoriaVendidaCentavos: withCost ? r.cmv : null,
    lucroBrutoCentavos: withCost ? r.grossProfit : null,
    margemBrutaBps: withCost ? r.marginBps : null,
  };
}

function classOf<T>(cls: Classification<T>) {
  const ranked = new Map<T, { klass: string; rank: number; shareBps: number; cumAfterBps: number }>();
  for (const x of cls.base) ranked.set(x.row, { klass: x.klass, rank: x.rank, shareBps: x.shareBps, cumAfterBps: x.cumAfterBps });
  return (row: T) => {
    const r = ranked.get(row);
    return { classeAbc: r?.klass ?? null, posicaoAbc: r?.rank ?? null, participacaoBps: r?.shareBps ?? null, acumuladoBps: r?.cumAfterBps ?? null };
  };
}

function curveSummary<T>(cls: Classification<T>, limits: AbcLimits, noMovement: (r: T) => boolean, revenue: { total: number; base: number; excluded: number }) {
  return {
    criterio: "receita_liquida",
    limites: { classeABps: limits.a, classeBBps: limits.b },
    receitaLiquidaCentavos: revenue.total,
    receitaNaCurvaCentavos: revenue.base,
    receitaForaDaCurvaCentavos: revenue.excluded,
    classes: Object.fromEntries((["A", "B", "C"] as const).map((k) => [k, { quantidade: cls.classes[k].count, receitaLiquidaCentavos: cls.classes[k].value, participacaoBps: cls.classes[k].shareBps }])),
    semClasse: { comMovimento: cls.excluded.filter((x) => !noMovement(x.row)).length, semMovimento: cls.excluded.filter((x) => noMovement(x.row)).length },
  };
}

const RANK_DIRS = ["desc", "desc", "asc", "asc"] as const;

/** SKUs do recorte (curva ABC da tela). */
export async function skuRanking(t: TowerRequest<RankingOptions>) {
  const limits = await limitsFor(t);
  const rep = await abcReport(t.store, reportScope(t), { criterion: "receita", limits, includeNoMovement: true });
  const cls = rep.classification;
  const klass = classOf(cls);
  const all = [...cls.base.map((x) => x.row), ...cls.excluded.map((x) => x.row)];
  const rows = all
    .filter((r) => t.extra.incluirSemMovimento || !r.noMovement)
    .map((r) => ({
      idSku: r.skuId,
      codigoSku: r.sku,
      descricao: r.description,
      idProduto: r.productId,
      nomeProduto: r.productName,
      idCategoria: r.categoryId,
      nomeCategoria: r.categoryName,
      unidadeMedida: r.unitCode,
      ...figures(r),
      ...klass(r),
      semMovimento: r.noMovement,
    }));
  const page = pageBy(rows, (r) => [r.receitaLiquidaCentavos, r.quantidadeLiquidaMilesimos, String(r.codigoSku), String(r.idSku)], [...RANK_DIRS], t.page!);
  return { ...page, curva: curveSummary(cls, limits, (r) => r.noMovement, rep.revenue) };
}

interface ProductRow extends Totals {
  id: string;
  productId: string | null;
  code: string;
  name: string;
  categoryId: string | null;
  skusWithMovement: number;
  noMovement: boolean;
}

/** Produtos do recorte: mesmas linhas da base comercial agrupadas por produto e a mesma política ABC. */
export async function productRanking(t: TowerRequest<RankingOptions>) {
  const limits = await limitsFor(t);
  const facts = await loadFacts(t.store, reportScope(t));
  const [products, categories] = await Promise.all([
    listAll(t.store, "products", { filters: [["eq", "companyId", t.companyId]] }),
    listAll(t.store, "categories", { filters: [["eq", "companyId", t.companyId]] }),
  ]);
  const prodById = new Map(products.map((p) => [p.id, p]));
  const catName = new Map(categories.map((c) => [c.id, c.name as string]));
  const skusOf = new Map<string, Set<string>>();
  const lineCategory = new Map<string, string | null>();
  for (const l of facts.lines) {
    const k = l.productId ?? "__none__";
    const set = skusOf.get(k) ?? new Set<string>();
    set.add(l.skuId);
    skusOf.set(k, set);
    if (!lineCategory.has(k) || (l.kind === "sale" && l.categoryId)) lineCategory.set(k, l.categoryId);
  }
  const rows: ProductRow[] = [...groupTotals(facts.lines, (l) => l.productId)].map(([pid, tot]) => {
    const p: Doc | undefined = pid === "__none__" ? undefined : prodById.get(pid);
    return {
      ...tot,
      id: pid,
      productId: pid === "__none__" ? null : pid,
      code: String(p?.code ?? ""),
      name: String(p?.name ?? "Produto não identificado"),
      categoryId: (p?.categoryId ?? lineCategory.get(pid) ?? null) as string | null,
      skusWithMovement: skusOf.get(pid)?.size ?? 0,
      noMovement: false,
    };
  });
  // produtos ativos sem movimento no recorte (mesma regra da curva ABC para SKUs ativos de produtos ativos)
  const seen = new Set(rows.map((r) => r.id));
  for (const p of products) {
    if (seen.has(p.id) || p.active === false || p.status === "inactive") continue;
    rows.push({ ...emptyTotals(), id: p.id, productId: p.id, code: String(p.code ?? ""), name: String(p.name ?? ""), categoryId: (p.categoryId ?? null) as string | null, skusWithMovement: 0, noMovement: true });
  }
  const cls = classifyAbc(rows, { value: (r) => r.netRevenue, qty: (r) => r.qtyNet, sku: (r) => r.code || r.id }, limits);
  const klass = classOf(cls);
  const items = rows
    .filter((r) => t.extra.incluirSemMovimento || !r.noMovement)
    .map((r) => ({
      idProduto: r.productId,
      codigoProduto: r.code || null,
      nomeProduto: r.name,
      idCategoria: r.categoryId,
      nomeCategoria: r.categoryId ? (catName.get(r.categoryId) ?? null) : null,
      quantidadeSkusComMovimento: r.skusWithMovement,
      ...figures(r),
      ...klass(r),
      semMovimento: r.noMovement,
    }));
  // desempate igual ao da classificação (código do produto, ou o id quando não há código)
  const page = pageBy(items, (r) => [r.receitaLiquidaCentavos, r.quantidadeLiquidaMilesimos, String(r.codigoProduto || r.idProduto || "__none__"), String(r.idProduto ?? "__none__")], [...RANK_DIRS], t.page!);
  const base = cls.base.reduce((a, x) => a + x.row.netRevenue, 0);
  const total = rows.reduce((a, r) => a + r.netRevenue, 0);
  return { ...page, curva: curveSummary(cls, limits, (r) => r.noMovement, { total, base, excluded: total - base }) };
}
