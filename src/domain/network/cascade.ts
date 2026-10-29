/**
 * Retrato da cascata de uma venda de certificado (§45) — funções PURAS (sem servidor), usadas no domínio, nas telas e
 * nos testes.
 *
 * O retrato é gravado na solicitação no momento da venda e nunca mais muda: base do financeiro em cascata (etapa 3) e
 * das comissões. Para cada nível do caminho (do mais alto até o vendedor) guarda o nó e o custo pago ao de cima; mais o
 * custo AC da Intercert, o preço de tabela/mínimo do vendedor, o preço final ao cliente e, quando houver, o cupom (quem
 * emitiu e quem absorve o desconto) e o voucher (pacote e preço unitário pré-pago).
 *
 * Visibilidade (`maskCascade`): a plataforma vê tudo; um nó vê o PRÓPRIO custo (o que paga ao pai) e a margem dele e
 * dos níveis abaixo, o nome do pai direto e nada acima disso — nunca o custo do pai nem o custo AC.
 */

export interface CascadeLevel {
  nodeId: string;
  name: string;
  level: string;
  /** quanto este nó paga ao de cima (centavos) */
  cost: number;
}

export interface CascadeCoupon {
  id: string;
  code: string;
  /** nó que emitiu (null = plataforma Intercert) */
  issuerNodeId: string | null;
  issuerName: string;
  /** desconto aplicado (centavos) */
  discount: number;
  /** o desconto pedido pelo cupom foi limitado para o preço não ficar abaixo do custo do vendedor */
  capped: boolean;
  /** quanto o preço final ficou abaixo do mínimo do vendedor (absorvido por quem emitiu o cupom) */
  belowMin: number;
  /** quem absorve o desconto (o emissor; null = plataforma) */
  absorbedByNodeId: string | null;
}

export interface CascadeVoucher {
  redemptionId: string;
  lotId: string;
  purchaseId: string;
  packageId: string;
  packageName: string;
  /** preço unitário pago antecipadamente pelo vendedor no pacote (centavos) */
  unitPrice: number;
  /** quem vendeu o pacote ao vendedor (null = plataforma) */
  soldByNodeId: string | null;
  code: string | null;
  /** voucher presente: preço ao cliente final R$ 0 */
  gift: boolean;
}

export interface CascadeSnapshot {
  version: 1;
  date: string;
  productKey: string;
  productLabel: string;
  /** custo pago pela Intercert à AC de 1º nível (só a plataforma vê) */
  acCost: number | null;
  /** do nível mais alto até o vendedor */
  levels: CascadeLevel[];
  sellerNodeId: string;
  sellerCost: number;
  listPrice: number;
  minPrice: number;
  canEdit: boolean;
  /** preço pedido pelo vendedor antes do cupom */
  requestedPrice: number;
  /** preço final ao cliente (centavos) */
  finalPrice: number;
  /** margem do vendedor = preço final − custo do vendedor (com voucher: − preço unitário pago no pacote) */
  sellerMargin: number;
  coupon: CascadeCoupon | null;
  voucher: CascadeVoucher | null;
  /** o custo do vendedor nesta venda já foi pago antecipadamente (voucher) — não é cobrado de novo na cascata */
  costCovered: boolean;
  free: boolean;
}

export interface MaskedLevel {
  nodeId: string;
  name: string;
  level: string;
  /** null = oculto para quem está olhando */
  cost: number | null;
  /** quanto este nó ganha na venda (preço que recebe de baixo − o que paga ao de cima); null = oculto */
  earns: number | null;
  /** nível acima do pai de quem olha: aparece só como "níveis acima" */
  hidden: boolean;
  mine: boolean;
}

export interface MaskedCascade {
  levels: MaskedLevel[];
  acCost: number | null;
  finalPrice: number;
  listPrice: number;
  minPrice: number;
  sellerCost: number | null;
  sellerMargin: number | null;
  coupon: (Omit<CascadeCoupon, "issuerName"> & { issuerName: string }) | null;
  voucher: (Omit<CascadeVoucher, "unitPrice"> & { unitPrice: number | null }) | null;
  costCovered: boolean;
  free: boolean;
  /** quantos níveis acima do pai ficaram ocultos */
  hiddenAbove: number;
  platform: boolean;
}

/** Visão do VENDEDOR (gravada na própria solicitação): sem custo AC e sem custos acima do pai. */
export function sellerView(s: CascadeSnapshot): MaskedCascade {
  return maskCascade(s, { platform: false, myNodeId: s.sellerNodeId });
}

/** Quanto cada nível do caminho ganha: o que recebe de baixo (custo do filho no caminho ou preço final) − o próprio custo. */
export function levelEarnings(s: Pick<CascadeSnapshot, "levels" | "finalPrice">): number[] {
  return s.levels.map((l, i) => (i + 1 < s.levels.length ? s.levels[i + 1].cost : s.finalPrice) - l.cost);
}

/**
 * Retrato visível a quem olha. `myNodeId` = nó da empresa de quem olha (null sem nó). Um nó fora do caminho (não
 * deveria ver a venda) recebe só o preço final.
 */
export function maskCascade(s: CascadeSnapshot, viewer: { platform: boolean; myNodeId: string | null }): MaskedCascade {
  const earns = levelEarnings(s);
  if (viewer.platform) {
    return {
      levels: s.levels.map((l, i) => ({ ...l, earns: earns[i], hidden: false, mine: l.nodeId === viewer.myNodeId })),
      acCost: s.acCost, finalPrice: s.finalPrice, listPrice: s.listPrice, minPrice: s.minPrice, sellerCost: s.sellerCost, sellerMargin: s.sellerMargin,
      coupon: s.coupon, voucher: s.voucher, costCovered: s.costCovered, free: s.free, hiddenAbove: 0, platform: true,
    };
  }
  const i = s.levels.findIndex((l) => l.nodeId === viewer.myNodeId);
  if (i < 0) {
    return { levels: [], acCost: null, finalPrice: s.finalPrice, listPrice: s.listPrice, minPrice: s.minPrice, sellerCost: null, sellerMargin: null, coupon: null, voucher: null, costCovered: s.costCovered, free: s.free, hiddenAbove: s.levels.length, platform: false };
  }
  const visibleIds = new Set(s.levels.slice(Math.max(0, i - 1)).map((l) => l.nodeId));
  const levels: MaskedLevel[] = s.levels.map((l, k) => {
    if (k < i - 1) return { nodeId: "", name: "Nível acima", level: l.level, cost: null, earns: null, hidden: true, mine: false };
    if (k === i - 1) return { nodeId: l.nodeId, name: l.name, level: l.level, cost: null, earns: null, hidden: false, mine: false }; // pai direto: só o nome
    return { ...l, earns: earns[k], hidden: false, mine: k === i };
  });
  const coupon = s.coupon ? { ...s.coupon, issuerName: s.coupon.issuerNodeId == null ? "Intercert (plataforma)" : visibleIds.has(s.coupon.issuerNodeId) ? s.coupon.issuerName : "Parceiro acima na rede" } : null;
  return {
    levels: levels.filter((l) => !l.hidden),
    acCost: null, finalPrice: s.finalPrice, listPrice: s.listPrice, minPrice: s.minPrice, sellerCost: s.sellerCost, sellerMargin: s.sellerMargin,
    coupon, voucher: s.voucher, costCovered: s.costCovered, free: s.free, hiddenAbove: Math.max(0, i - 1), platform: false,
  };
}

/** Desconto de um cupom sobre um preço (centavos, arredondado para baixo no percentual — nunca a favor do cupom). */
export function couponDiscount(c: { kind: string; valueBps?: number | null; valueCents?: number | null }, base: number): number {
  if (base <= 0) return 0;
  if (c.kind === "percent") return Math.min(base, Math.floor((base * Number(c.valueBps ?? 0)) / 10000));
  return Math.min(base, Math.max(0, Math.round(Number(c.valueCents ?? 0))));
}

export interface PriceQuoteInput {
  /** termos do vendedor (preço efetivo do nó) */
  cost: number;
  minPrice: number;
  defaultPrice: number;
  canEdit: boolean;
  /** preço pedido (centavos); null = padrão */
  requested: number | null;
  coupon?: { kind: string; valueBps?: number | null; valueCents?: number | null; issuedAbove: boolean } | null;
  gift?: boolean;
}

export interface PriceQuote {
  requestedPrice: number;
  discount: number;
  capped: boolean;
  belowMin: number;
  finalPrice: number;
  errors: string[];
}

/**
 * Preço final (função pura). Regras: sem `canEdit` o preço é o padrão; com `canEdit`, nunca abaixo do mínimo. Cupom:
 * o preço com desconto nunca fica abaixo do CUSTO do vendedor (o desconto é limitado); abaixo do MÍNIMO só quando o
 * cupom foi emitido por um nível ACIMA do vendedor (ou pela plataforma), que absorve a diferença; cupom do próprio nó
 * respeita o mínimo. Voucher presente: preço ao cliente R$ 0 (sem cupom).
 */
export function quotePrice(q: PriceQuoteInput, fmt: (c: number) => string = (c) => (c / 100).toFixed(2)): PriceQuote {
  const errors: string[] = [];
  const requested = q.requested == null ? q.defaultPrice : Math.round(q.requested);
  if (q.gift) {
    if (q.coupon) errors.push("Voucher presente já zera o preço ao cliente: não combine com cupom.");
    return { requestedPrice: requested, discount: 0, capped: false, belowMin: q.minPrice, finalPrice: 0, errors };
  }
  if (!Number.isInteger(requested) || requested < 0) errors.push("Preço inválido.");
  if (requested !== q.defaultPrice && !q.canEdit) errors.push(`Preço fixo para este produto: ${fmt(q.defaultPrice)} (o parceiro acima não permite alterar).`);
  if (requested < q.minPrice) errors.push(`O preço (${fmt(requested)}) não pode ficar abaixo do mínimo do seu nó (${fmt(q.minPrice)}).`);
  let discount = 0;
  let capped = false;
  if (q.coupon) {
    const wanted = couponDiscount(q.coupon, requested);
    const floor = q.coupon.issuedAbove ? q.cost : Math.max(q.cost, q.minPrice);
    discount = Math.max(0, Math.min(wanted, requested - floor));
    capped = discount < wanted;
  }
  const finalPrice = requested - discount;
  return { requestedPrice: requested, discount, capped, belowMin: Math.max(0, q.minPrice - finalPrice), finalPrice, errors };
}
