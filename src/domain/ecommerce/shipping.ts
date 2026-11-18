import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { onlyDigits } from "@/lib/core/text";
import { QTY } from "@/lib/money";
import { commerceEvent, DELIVERY_LABEL, type DeliveryMode } from "./common";
import { logisticsFor, type PackageInfo } from "./providers";
import { shippingOf } from "./store";

/**
 * Entrega e retirada (Telas 58 e 63): as quatro modalidades da loja — retirada na loja, entrega própria por faixa de
 * CEP, entrega por terceiros (aplicativo) e transportadora — viram opções com preço e prazo no carrinho e no checkout.
 * O servidor sempre recalcula a cotação da opção escolhida ao fechar o pedido: o preço nunca vem do navegador.
 */

export interface DeliveryOption {
  /** identificador estável da opção (o checkout confere a opção escolhida contra uma cotação nova) */
  id: string;
  mode: DeliveryMode;
  service: string;
  label: string;
  detail: string;
  price: number;
  originalPrice: number;
  daysMin: number;
  daysMax: number;
  /** retirada: filial onde o cliente retira (e que reserva o estoque) */
  branchId: string | null;
  provider: string;
  simulated: boolean;
  free: boolean;
}

export interface CartLine {
  skuId: string;
  productId: string;
  qty: number;
  unitPrice: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function daysLabel(min: number, max: number, mode: DeliveryMode) {
  if (mode === "third_party" && max <= 1) return "No mesmo dia ou no próximo dia útil após o despacho";
  if (min === max) return `${plural(min, "dia útil", "dias úteis")}`;
  return `${min} a ${max} dias úteis`;
}

/** Pacote do pedido: soma dos pesos (gramas) e caixa padrão quando o produto não tem medidas. */
export async function packageFor(store: Store, st: Doc, lines: CartLine[]): Promise<PackageInfo> {
  const ship = shippingOf(st);
  let weight = 0;
  let maxH = 0;
  let maxW = 0;
  let sumL = 0;
  let value = 0;
  const base = unscoped(store);
  for (const l of lines) {
    const listing = (await listAll(base, "store_products", { filters: [["eq", "storeId", st.id], ["eq", "productId", l.productId]] }))[0];
    const product = await base.get("products", l.productId);
    const units = Math.max(1, Math.round(l.qty / QTY));
    const w = listing?.weightGrams || product?.weightGrams || ship.package.weightGrams;
    weight += w * units;
    maxH = Math.max(maxH, listing?.heightCm || ship.package.heightCm);
    maxW = Math.max(maxW, listing?.widthCm || ship.package.widthCm);
    sumL += (listing?.lengthCm || ship.package.lengthCm) * Math.min(units, 3);
    value += Math.round((l.unitPrice * l.qty) / QTY);
  }
  return { weightGrams: Math.max(weight, 1), heightCm: Math.max(maxH, 1), widthCm: Math.max(maxW, 1), lengthCm: Math.min(Math.max(sumL, 1), 150), value };
}

/**
 * Opções de entrega para o CEP e os itens. `goodsAfterDiscount` decide o frete grátis (Tela 58: "o mínimo considera
 * produtos após desconto"); só a entrega padrão (transportadora) e as modalidades marcadas ficam grátis.
 */
export async function deliveryOptions(store: Store, st: Doc, input: { zip: string | null; lines: CartLine[]; goodsAfterDiscount: number; freeShipping?: boolean }): Promise<{ options: DeliveryOption[]; problems: string[] }> {
  const ship = shippingOf(st);
  const zip = onlyDigits(input.zip ?? "");
  const options: DeliveryOption[] = [];
  const problems: string[] = [];
  const base = unscoped(store);
  const freeByRule = ship.freeShippingMin > 0 && input.goodsAfterDiscount >= ship.freeShippingMin;
  const isFree = (mode: DeliveryMode, service: string) => Boolean(input.freeShipping) || (freeByRule && ship.freeShippingModes.includes(mode) && (mode !== "carrier" || service === "standard"));
  const push = (o: Omit<DeliveryOption, "free" | "originalPrice"> & { price: number }) => {
    const free = o.price > 0 && isFree(o.mode, o.service);
    options.push({ ...o, originalPrice: o.price, price: free ? 0 : o.price, free });
  };
  if (ship.modes.pickup.enabled) {
    const ids = (st.pickupBranchIds ?? []).length ? st.pickupBranchIds : [st.fulfillmentBranchId];
    for (const bid of ids) {
      const b = bid ? await base.get("branches", bid) : null;
      if (!b || b.companyId !== st.companyId || b.status === "inactive") continue;
      const hours = ship.modes.pickup.readyHours;
      push({
        id: `pickup:${b.id}`,
        mode: "pickup",
        service: "pickup",
        label: ids.length > 1 ? `Retirada na loja — ${b.name}` : "Retirada na loja",
        detail: hours > 0 ? `Após confirmação de preparo (em até ${plural(hours, "hora", "horas")} úteis)` : "Após confirmação de preparo",
        price: 0,
        daysMin: 0,
        daysMax: 0,
        branchId: b.id,
        provider: "own",
        simulated: false,
      });
    }
  }
  if (zip.length !== 8) {
    if (ship.modes.own.enabled || ship.modes.carrier.enabled || ship.modes.third_party.enabled) problems.push("Informe o CEP para calcular a entrega.");
    return { options, problems };
  }
  if (ship.modes.own.enabled) {
    const zone = ship.modes.own.zones.find((z) => zip >= z.zipFrom && zip <= z.zipTo);
    if (zone)
      push({ id: `own:${zone.zipFrom}-${zone.zipTo}`, mode: "own", service: "own", label: "Entrega própria", detail: `${zone.name} · ${zone.days === 0 ? "no mesmo dia útil" : daysLabel(zone.days, zone.days, "own")}`, price: zone.price, daysMin: zone.days, daysMax: zone.days, branchId: null, provider: "own", simulated: false });
  }
  const remote: Array<"carrier" | "third_party"> = [];
  if (ship.modes.carrier.enabled) remote.push("carrier");
  if (ship.modes.third_party.enabled) remote.push("third_party");
  if (remote.length) {
    if (ship.originZip.length !== 8) problems.push("A loja ainda não informou o CEP de origem: a cotação de transportadora não está disponível.");
    else {
      try {
        const provider = await logisticsFor(store, st.companyId);
        const pkg = await packageFor(store, st, input.lines);
        const quotes = await provider.quote({ originZip: ship.originZip, destZip: zip, pkg, modes: remote, thirdPartyLabel: ship.modes.third_party.label });
        for (const q of quotes) {
          const handling = ship.handlingDays;
          push({
            id: `${q.mode}:${q.service}`,
            mode: q.mode,
            service: q.service,
            label: q.label,
            detail: daysLabel(q.daysMin + handling, q.daysMax + handling, q.mode),
            price: q.price,
            daysMin: q.daysMin + handling,
            daysMax: q.daysMax + handling,
            branchId: null,
            provider: q.provider,
            simulated: q.simulated,
          });
        }
      } catch (e: any) {
        problems.push("Cotação de transportadora indisponível no momento: escolha outra forma de entrega ou tente novamente.");
        await commerceEvent(store, { companyId: st.companyId, storeId: st.id, area: "shipping", action: "shipping.quote", status: "failed", reference: `CEP ${zip}`, diagnostic: String(e?.message ?? e).slice(0, 500) }).catch(() => undefined);
      }
    }
  }
  if (!options.length && !problems.length) problems.push("Não há entrega disponível para este CEP. Escolha a retirada na loja, se disponível.");
  return { options, problems };
}

export const modeLabel = (m: DeliveryMode) => DELIVERY_LABEL[m];
