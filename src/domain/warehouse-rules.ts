import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";

/**
 * Regras de depósito (§39) sem dependências de cadastro — usadas por vendas, recebimentos, terminais e filiais.
 *
 * Tipos (tipo = `kind` + `purpose`):
 *  - Venda (`available`/`sale`) e Almoxarifado / reserva (`available`/`storage`): ENTRAM no disponível para venda;
 *  - Uso e consumo (`consumption`): fora do disponível (inventário e relatórios contam);
 *  - Avarias (`damaged`): o depósito de avarias do sistema (um por filial, criado com a filial) — tipo fixo.
 * Depósitos antigos sem `purpose` valem como Venda (`available`) ou Avarias (`damaged`): nada muda para eles.
 *
 * Venda com complemento: a baixa tira primeiro do depósito do terminal (ou o padrão da filial) e completa com os
 * demais depósitos `available` ativos da filial pela prioridade (`salePriority`, menor primeiro; depois o código).
 */

export type WarehouseType = "sale" | "storage" | "consumption" | "damaged";

export const WAREHOUSE_TYPE_LABEL: Record<WarehouseType, string> = {
  sale: "Venda",
  storage: "Almoxarifado / reserva",
  consumption: "Uso e consumo",
  damaged: "Avarias",
};

export const WAREHOUSE_TYPE_HINT: Record<WarehouseType, string> = {
  sale: "Estoque da loja: entra no disponível para venda.",
  storage: "Estoque guardado (depósito, reserva): entra no disponível e completa a venda quando o depósito do terminal não tem saldo.",
  consumption: "Material de uso interno: não entra no disponível para venda (aparece no inventário).",
  damaged: "Avarias do sistema: recebe devoluções e transferências com avaria; fora do disponível.",
};

/** Tipos que o usuário pode escolher no cadastro (o de avarias é do sistema). */
export const SELECTABLE_TYPES: WarehouseType[] = ["sale", "storage", "consumption"];

export const TYPE_DEF: Record<Exclude<WarehouseType, "damaged">, { kind: string; purpose: string }> = {
  sale: { kind: "available", purpose: "sale" },
  storage: { kind: "available", purpose: "storage" },
  consumption: { kind: "consumption", purpose: "consumption" },
};

type WLike = Record<string, any> | null | undefined;

export function warehouseType(w: WLike): WarehouseType {
  if (!w) return "sale";
  if (w.kind === "damaged") return "damaged";
  if (w.kind === "consumption") return "consumption";
  return w.purpose === "storage" ? "storage" : "sale";
}

export const isActiveWarehouse = (w: WLike) => Boolean(w) && (w!.status ?? "active") !== "inactive";
/** Pode ser depósito padrão da filial ou de terminal: venda ou almoxarifado, ativo. */
export const canBeDefaultWarehouse = (w: WLike) => isActiveWarehouse(w) && w!.kind === "available";
/** Recebe mercadoria de compra: ativo e não é de avarias (venda, almoxarifado, uso e consumo). */
export const receivesGoods = (w: WLike) => isActiveWarehouse(w) && w!.kind !== "damaged";
/** Rótulo curto para seletores: "Almoxarifado (almoxarifado)". */
export function warehouseOptionLabel(w: Record<string, any>) {
  const t = warehouseType(w);
  return t === "sale" ? w.name : `${w.name} (${WAREHOUSE_TYPE_LABEL[t].toLowerCase()})`;
}

/** Ordem de exibição: venda, almoxarifado, uso e consumo, avarias; depois prioridade e código. */
export function sortWarehouses<T extends Record<string, any>>(list: T[]): T[] {
  const rank: Record<WarehouseType, number> = { sale: 0, storage: 1, consumption: 2, damaged: 3 };
  return [...list].sort((a, b) => rank[warehouseType(a)] - rank[warehouseType(b)] || priorityOf(a) - priorityOf(b) || String(a.code ?? "").localeCompare(String(b.code ?? "")));
}

/** Prioridade de baixa (ausente = 1). */
export const priorityOf = (w: Record<string, any>) => (Number.isInteger(w.salePriority) ? (w.salePriority as number) : 1);

// ───────────────────────────── divisão da baixa por depósito (venda com complemento)

export interface WhPart {
  warehouseId: string;
  qty: number;
}

/** Sufixo curto e determinístico do depósito para chaves de idempotência (limite de 120 caracteres). */
export const whTag = (warehouseId: string) => `w${warehouseId.replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}`;

/**
 * Chave do movimento de uma parte da divisão: a parte do depósito principal (terminal) mantém a chave de sempre;
 * as complementares recebem o sufixo do depósito.
 */
export const partIdem = (base: string, primaryId: string, warehouseId: string) => (warehouseId === primaryId ? base : `${base}:${whTag(warehouseId)}`);

/** A divisão só é gravada quando algo saiu de outro depósito além do principal. */
export const isRealSplit = (parts: WhPart[] | null | undefined, primaryId: string) => Boolean(parts?.length) && !(parts!.length === 1 && parts![0].warehouseId === primaryId);

/**
 * Distribui `need` entre os depósitos: primeiro o principal (até o disponível dele), depois os complementares na
 * ordem dada (até o disponível de cada um, nunca negativo); o que faltar fica no principal (venda sem saldo
 * permitida — único depósito que pode ficar negativo). `pool` (disponível por depósito) é consumido.
 */
export function allocateSplit(need: number, primaryId: string, order: string[], pool: Map<string, number>): WhPart[] {
  const parts = new Map<string, number>();
  let rest = need;
  for (const wid of [primaryId, ...order.filter((w) => w !== primaryId)]) {
    if (rest <= 0) break;
    const avail = Math.max(0, pool.get(wid) ?? 0);
    const take = Math.min(rest, avail);
    if (take <= 0) continue;
    parts.set(wid, (parts.get(wid) ?? 0) + take);
    pool.set(wid, avail - take);
    rest -= take;
  }
  if (rest > 0) {
    parts.set(primaryId, (parts.get(primaryId) ?? 0) + rest);
    pool.set(primaryId, (pool.get(primaryId) ?? 0) - rest);
  }
  // ordem gravada: principal primeiro, depois a ordem de baixa
  return [primaryId, ...order.filter((w) => w !== primaryId)].filter((w) => parts.has(w)).map((w) => ({ warehouseId: w, qty: parts.get(w)! }));
}

/**
 * Devolução parcial (regra §39): devolve primeiro aos depósitos complementares, na ORDEM INVERSA da baixa
 * (o último depósito de onde a venda tirou é o primeiro a receber), e por último ao principal. `already` é a
 * quantidade do item já devolvida antes (ocupa as primeiras posições dessa ordem inversa).
 */
export function lifoReturnParts(parts: WhPart[], already: number, qty: number): WhPart[] {
  const out: WhPart[] = [];
  let skip = Math.max(0, already);
  let need = qty;
  for (const p of [...parts].reverse()) {
    if (need <= 0) break;
    let room = p.qty;
    const s = Math.min(skip, room);
    skip -= s;
    room -= s;
    const take = Math.min(need, room);
    if (take > 0) {
      out.push({ warehouseId: p.warehouseId, qty: take });
      need -= take;
    }
  }
  // arredondamento de componente de kit: o resto volta ao principal
  if (need > 0 && parts.length) {
    const first = out.find((p) => p.warehouseId === parts[0].warehouseId);
    if (first) first.qty += need;
    else out.push({ warehouseId: parts[0].warehouseId, qty: need });
  }
  return out;
}

/** Depósitos da filial que completam a venda (available, ativos), na ordem de baixa, sem o principal. */
export async function complementWarehouses(store: Store, branchId: string, primaryId: string): Promise<Doc[]> {
  const whs = await listAll(store, "warehouses", { filters: [["eq", "branchId", branchId], ["eq", "kind", "available"]] });
  return whs
    .filter((w) => w.id !== primaryId && isActiveWarehouse(w))
    .sort((a, b) => priorityOf(a) - priorityOf(b) || String(a.code ?? "").localeCompare(String(b.code ?? "")) || a.id.localeCompare(b.id));
}

/** Reservas ativas de uma origem por depósito e SKU (a própria reserva conta como disponível para quem a fez). */
export async function reservedByWarehouse(store: Store, originType: string, originId: string, branchId: string): Promise<Array<{ warehouseId: string; skuId: string; qty: number }>> {
  const rs = await listAll(store, "stock_reservations", { filters: [["eq", "originType", originType], ["eq", "originId", originId], ["eq", "status", "active"]] });
  return rs.filter((r) => r.branchId === branchId).map((r) => ({ warehouseId: r.warehouseId, skuId: r.skuId, qty: r.qty ?? 0 }));
}

/**
 * Planejador da venda com complemento. Devolve null quando a filial não tem outro depósito de venda/almoxarifado
 * ativo além do principal (caminho idêntico ao de sempre: nada é lido nem gravado a mais).
 */
export async function saleSplitPlanner(store: Store, input: { branchId: string; primaryId: string; skuIds: string[]; own?: () => Promise<Array<{ warehouseId: string; skuId: string; qty: number }>> }) {
  if (!input.skuIds.length) return null;
  const others = await complementWarehouses(store, input.branchId, input.primaryId);
  if (!others.length) return null;
  const order = others.map((w) => w.id);
  const ids = new Set([input.primaryId, ...order]);
  const pools = new Map<string, Map<string, number>>();
  const pool = (skuId: string) => {
    if (!pools.has(skuId)) pools.set(skuId, new Map());
    return pools.get(skuId)!;
  };
  for (let i = 0; i < input.skuIds.length; i += 100) {
    const bals = await listAll(store, "stock_balances", { filters: [["eq", "skuId", input.skuIds.slice(i, i + 100)], ["eq", "branchId", input.branchId]] });
    for (const b of bals) if (ids.has(b.warehouseId)) pool(b.skuId).set(b.warehouseId, (b.physical ?? 0) - (b.reserved ?? 0));
  }
  for (const r of (await input.own?.()) ?? []) if (ids.has(r.warehouseId)) pool(r.skuId).set(r.warehouseId, (pool(r.skuId).get(r.warehouseId) ?? 0) + r.qty);
  return {
    order,
    /** divisão da quantidade do SKU; null = tudo no principal (sem divisão) */
    take(skuId: string, qty: number): WhPart[] | null {
      const parts = allocateSplit(qty, input.primaryId, order, pool(skuId));
      return isRealSplit(parts, input.primaryId) ? parts : null;
    },
  };
}
