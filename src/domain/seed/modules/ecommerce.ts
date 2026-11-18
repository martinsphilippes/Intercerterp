import crypto from "node:crypto";
import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { addDays, nowIso, today } from "@/lib/dates";
import type { DemoRefs } from "../base";
import { storeOfCompany } from "@/domain/ecommerce/common";
import { createStore, publishStore, saveCheckout, saveIdentity, saveLegalContact, savePayments, saveShipping, applyTemplate, paymentsOf, shippingOf } from "@/domain/ecommerce/store";
import { addToCatalog, saveListing, validateListings } from "@/domain/ecommerce/catalog";
import { addToCart, getCart, setDeliveryZip, selectDelivery } from "@/domain/ecommerce/cart";
import { saveCoupon } from "@/domain/ecommerce/promotions";
import { placeOrder, simulatePaymentEvent, type CheckoutInput } from "@/domain/ecommerce/checkout";
import { confirmPicking, confirmPickup, dispatchOrder, generateLabel, confirmDelivery } from "@/domain/ecommerce/orders";
import { invoiceOrder } from "@/domain/ecommerce/fiscal";
import { prepareChannel } from "@/domain/ecommerce/channels";
import { reconcileTransaction, setSettlementAccount, simulateCredits } from "@/domain/ecommerce/bank";

/**
 * Comércio digital (§49) — "Loja Modelo" da empresa de demonstração, montada pelas MESMAS regras da operação (nada
 * gravado por fora do domínio, exceto o recuo de datas para mostrar créditos já conciliados):
 *  - loja publicada (modelo Essencial, Azul Intercert), retirada nas duas filiais, entrega própria no centro de SP,
 *    entrega por aplicativo e transportadora (simulação), frete grátis acima de R$ 300;
 *  - 11 produtos na vitrine; o Cinto fica com "Peso pendente" (falha de validação no monitor, como no guia);
 *  - cupom BEMVINDO10; carrinhos parados (com e sem consentimento); conta preparada no Mercado Livre;
 *  - 7 pedidos pelo checkout real: retirada pronta, transportadora despachada, entrega própria a preparar, Pix
 *    aguardando, cartão recusado, boleto aguardando e um pedido entregue com o crédito do gateway conciliado.
 * Idempotente: carrinhos com token determinístico viram no máximo um pedido; cada etapa confere a situação antes.
 */

const LISTINGS: Array<{ key: string; grams: number | null; featured?: boolean; description: string }> = [
  { key: "caneca", grams: 350, featured: true, description: "Caneca de cerâmica de 350 ml com acabamento esmaltado. Pode ir ao micro-ondas e à lava-louças. Ideal para o café da manhã." },
  { key: "vela", grams: 260, description: "Vela aromática em pote de vidro, com fragrância suave e cerca de 30 horas de queima. Ótima para presentear." },
  { key: "camiseta", grams: 180, featured: true, description: "Camiseta de algodão penteado com modelagem básica e caimento leve. Escolha o tamanho e a cor." },
  { key: "calca", grams: 620, description: "Calça jeans de corte slim, com elastano para mais conforto no dia a dia." },
  { key: "tenis", grams: 900, description: "Tênis casual de couro com solado de borracha e palmilha acolchoada." },
  { key: "bone", grams: 150, description: "Boné de aba curva com regulagem traseira e tecido respirável." },
  { key: "cinto", grams: null, description: "Cinto de couro legítimo com fivela metálica. Disponível em tamanho único ajustável." },
  { key: "meia", grams: 120, description: "Kit com 3 pares de meias esportivas com reforço no calcanhar e na ponta." },
  { key: "caderno", grams: 450, description: "Caderno universitário de 10 matérias, 200 folhas, capa dura e espiral reforçado." },
  { key: "fone", grams: 250, featured: true, description: "Fone de ouvido Bluetooth com até 20 horas de bateria, microfone embutido e estojo de carga." },
  { key: "carregador", grams: 120, description: "Carregador USB-C de 20 W com carga rápida, compatível com celulares e fones." },
];

/** CPF válido a partir de 9 dígitos (dados fictícios da demonstração). */
function cpf(base9: string) {
  const d = base9.split("").map(Number);
  const dv = (arr: number[]) => {
    const s = arr.reduce((a, n, i) => a + n * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join("");
}

const token = (k: string) => crypto.createHash("sha256").update(`demo-store-cart:${k}`).digest("hex").slice(0, 32);
const ADDR = { zip: "01310100", street: "Avenida Paulista", number: "1000", district: "Bela Vista", cityName: "São Paulo", cityCode: "3550308", uf: "SP" };

export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const admin = await refs.ctxFor("admin", "matriz");
  const out: Record<string, unknown> = {};

  // ── loja
  let st = await storeOfCompany(store, admin.companyId);
  if (!st) st = await createStore(admin, { name: "Loja Modelo", fulfillmentBranchId: refs.branches.matriz.id });
  const company = refs.company;
  await saveLegalContact(
    admin,
    { companyName: company.name, cnpj: company.cnpj ?? "11222333000181", address: "Rua das Flores, 100 — Centro — São Paulo/SP — CEP 01001-000", email: "loja@demo.intercert.local", phone: "1133334444" },
    { whatsapp: "11999990000", email: "loja@demo.intercert.local", phone: "1133334444", hours: "Segunda a sábado, das 9h às 18h" },
  );
  if (st.template !== "essencial") await applyTemplate(admin, "essencial");
  await saveIdentity(admin, {
    name: "Loja Modelo",
    title: "Tudo para o seu dia a dia.",
    tagline: "Escolhas práticas para sua casa, seu estilo e sua rotina.",
    accentColor: "#1f448c",
    sections: { categories: true, benefits: true, featured: true },
    benefits: ["Produtos do nosso catálogo", "Entrega ou retirada na loja", "Checkout integrado: Pix, cartão e boleto", "Troca em até 7 dias"],
    seoTitle: "Loja Modelo — loja de demonstração Intercert",
    seoDescription: "Casa, moda, acessórios e eletrônicos com retirada na loja ou entrega. Loja de demonstração do Intercert ERP.",
  });
  await saveCheckout(admin, { requireDoc: true, minOrder: 0, orderPrefix: "IC", safetyStockQty: 0 });
  st = (await storeOfCompany(store, admin.companyId))!;
  const pay = paymentsOf(st);
  await savePayments(admin, { ...pay, methods: { pix: { enabled: true, expiresMinutes: 1440 }, card: { enabled: true, maxInstallments: 6, minInstallment: 2000 }, boleto: { enabled: true, dueDays: 3 } }, autoInvoice: false });
  const ship = shippingOf(st);
  await saveShipping(admin, {
    ...ship,
    originZip: "01001000",
    handlingDays: 1,
    freeShippingMin: 30000,
    freeShippingModes: ["carrier", "own"],
    modes: {
      pickup: { enabled: true, readyHours: 2, instructions: "Apresente o código de retirada e um documento com foto no balcão." },
      own: { enabled: true, zones: [{ name: "Centro expandido", zipFrom: "01000000", zipTo: "01599999", price: 990, days: 1 }, { name: "Zona Norte", zipFrom: "02000000", zipTo: "02999999", price: 1490, days: 2 }] },
      third_party: { enabled: true, provider: "simulated", label: "Entrega expressa por aplicativo", maxDistanceKm: 20 },
      carrier: { enabled: true, provider: "simulated" },
    },
    pickupBranchIds: [refs.branches.matriz.id, refs.branches.shopping.id],
    fulfillmentBranchId: refs.branches.matriz.id,
  });

  // ── catálogo
  const pids = LISTINGS.map((l) => refs.products[l.key]?.id).filter(Boolean) as string[];
  await addToCatalog(admin, pids);
  for (const l of LISTINGS) {
    const p = refs.products[l.key];
    if (!p) continue;
    const cur = (await listAll(unscoped(store), "store_products", { filters: [["eq", "storeId", st.id], ["eq", "productId", p.id]] }))[0];
    if (cur?.published && cur.description === l.description) continue;
    if (l.grams == null) await store.update("products", p.id, { weightGrams: null });
    await saveListing(admin, p.id, { title: p.name, description: l.description, images: cur?.images ?? [], featured: Boolean(l.featured), published: true, weightGrams: l.grams });
  }
  await validateListings(admin, pids);
  out.listings = pids.length;

  // ── cupom e canal
  await saveCoupon(admin, { code: "BEMVINDO10", description: "Boas-vindas da loja virtual", percentBps: 1000, capAmount: 2000, minOrder: 10000, freeShipping: false, active: true, usageLimit: null, perCustomerLimit: 1 });
  const channels = await listAll(unscoped(store), "store_channels", { filters: [["eq", "storeId", st.id]] });
  if (!channels.some((c) => c.channel === "mercado_livre")) await prepareChannel(admin, "mercado_livre", { accountName: "Loja Modelo no Mercado Livre", catalogScope: "all", categoryIds: [], notes: "Rascunho da demonstração: o conector depende de homologação." });

  if (st.status !== "published") await publishStore(admin);
  st = (await storeOfCompany(store, admin.companyId))!;

  const S: Doc = st!;
  // ── pedidos pelo checkout real (numeração a partir de IC-1041, como no guia)
  const counterId = detId("counter", `online_order:${admin.companyId}`);
  if (!(await store.get("counters", counterId))) await store.create("counters", { key: `online_order:${admin.companyId}`, value: 1040 }, counterId);
  const slug = async (k: string) => (await listAll(unscoped(store), "store_products", { filters: [["eq", "storeId", S.id], ["eq", "productId", refs.products[k].id]] }))[0]?.slug as string;
  // reposição da demonstração: com o histórico de vendas do PDV, parte dos itens zera na Matriz — os produtos da loja
  // recebem uma entrada rastreável (movimento de ajuste) até 15 unidades disponíveis em cada filial, para os cenários
  // abaixo serem sempre os mesmos
  const { postMovements } = await import("@/domain/stock");
  for (const branch of ["matriz", "shopping"]) {
    const whId = refs.warehouses[`${branch}-main`].id;
    const moves = [];
    for (const l of LISTINGS) {
      for (const [key, sku] of Object.entries(refs.skus)) {
        if (!key.startsWith(`${l.key}-`)) continue;
        const b = await store.get("stock_balances", detId("bal", whId, sku.id));
        const avail = (b?.physical ?? 0) - (b?.reserved ?? 0);
        if (avail >= 10000) continue;
        moves.push({ warehouseId: whId, skuId: sku.id, qty: 15000 - Math.max(avail, 0), type: "adjust_in" as const, unitCost: sku.costTotal ?? null, reason: "Reposição para a loja virtual (demonstração)", idemKey: `demo-ecom-stock:${branch}:${sku.id}:${today()}` });
      }
    }
    if (moves.length) await postMovements({ ...admin, branchId: refs.branches[branch].id }, moves);
  }

  // produto com variações (tamanho/cor) exige a variação, como na vitrine: a de maior saldo disponível na Matriz
  const wh = refs.warehouses["matriz-main"].id;
  const best = new Map<string, string | null>();
  for (const k of ["camiseta", "tenis", "calca", "caneca", "vela", "meia", "bone", "caderno", "fone", "carregador", "cinto"]) {
    let pick: string | null = null;
    let top = 0;
    for (const [key, sku] of Object.entries(refs.skus)) {
      if (!key.startsWith(`${k}-`)) continue;
      const b = await store.get("stock_balances", detId("bal", wh, sku.id));
      const avail = (b?.physical ?? 0) - (b?.reserved ?? 0);
      if (avail > top) {
        top = avail;
        pick = sku.id;
      }
    }
    best.set(k, pick);
  }
  const skuOf = (k: string) => best.get(k) ?? null;
  const camisetaSku = skuOf("camiseta");
  type Scenario = { key: string; name: string; base9: string; items: Array<[string, number, string | null]>; delivery: string; zip?: string; pay: CheckoutInput["payment"]; then: string[]; marketing?: boolean };
  const scenarios: Scenario[] = [
    { key: "ana", name: "Ana Martins", base9: "123456781", items: [["caneca", 2, null], ["vela", 1, null]], delivery: `pickup:${refs.branches.matriz.id}`, pay: { method: "pix", installments: 1 }, then: ["pay", "invoice", "pick"], marketing: true },
    { key: "bruno", name: "Bruno Souza", base9: "234567892", items: [["tenis", 1, skuOf("tenis")], ["meia", 2, null]], delivery: "carrier:standard", pay: { method: "card", installments: 3, simulate: "approve" }, then: ["invoice", "pick", "label", "dispatch"] },
    { key: "carla", name: "Carla Ribeiro", base9: "345678903", items: [["fone", 1, null]], delivery: "own:01000000-01599999", pay: { method: "card", installments: 1, simulate: "approve" }, then: ["invoice"] },
    { key: "diego", name: "Diego Lima", base9: "456789014", items: [["caderno", 3, null], ["carregador", 1, null]], delivery: "carrier:express", pay: { method: "pix", installments: 1 }, then: [] },
    { key: "elisa", name: "Elisa Prado", base9: "567890125", items: [["bone", 1, null]], delivery: `pickup:${refs.branches.shopping.id}`, pay: { method: "card", installments: 1, simulate: "decline" }, then: [] },
    { key: "fabio", name: "Fábio Nunes", base9: "678901236", items: [["camiseta", 2, camisetaSku], ["caneca", 1, null]], delivery: `pickup:${refs.branches.matriz.id}`, pay: { method: "pix", installments: 1 }, then: ["pay", "invoice", "pick", "pickup", "credit"] },
    { key: "gabriela", name: "Gabriela Costa", base9: "789012347", items: [["calca", 1, skuOf("calca")]], delivery: "third_party:app", pay: { method: "boleto", installments: 1 }, then: [] },
  ];
  const orders: Record<string, Doc> = {};
  for (const sc of scenarios) {
    try {
      await runScenario(sc);
    } catch (e: any) {
      // um cenário que não fecha (ex.: saldo consumido por outra rotina) não derruba a carga da demonstração
      console.warn(`[demo] comércio digital: cenário ${sc.key} não concluído — ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  async function runScenario(sc: Scenario) {
    const t = token(sc.key);
    let cart = await getCart(store, S, t);
    if (cart?.status === "ordered" && cart.orderId) {
      orders[sc.key] = (await unscoped(store).get("online_orders", cart.orderId))!;
    } else {
      if (!cart || !(cart.items ?? []).length) for (const [k, qty, skuId] of sc.items) await addToCart(store, S, t, { productSlug: await slug(k), skuId, qty });
      await setDeliveryZip(store, S, t, sc.zip ?? ADDR.zip);
      await selectDelivery(store, S, t, sc.delivery);
      cart = await getCart(store, S, t);
      orders[sc.key] = await placeOrder(store, S, t, {
        submissionKey: crypto.createHash("sha256").update(`demo-sub:${sc.key}`).digest("hex").slice(0, 32),
        customer: { name: sc.name, email: `${sc.key}.cliente@demo.intercert.local`, phone: "11987654321", doc: cpf(sc.base9) },
        address: ADDR,
        deliveryOptionId: sc.delivery,
        payment: sc.pay,
        acceptTerms: true,
        marketingConsent: Boolean(sc.marketing),
      });
    }
    let o = orders[sc.key];
    for (const step of sc.then) {
      o = (await unscoped(store).get("online_orders", o.id))!;
      if (step === "pay" && o.status === "pending_payment") o = (await simulatePaymentEvent(store, o, "approved", { repeatOf: `demo-pay:${sc.key}` })).order;
      if (step === "invoice" && o.paymentStatus === "paid" && o.fiscalStatus !== "authorized") {
        o = await invoiceOrder(admin, o.id);
        if (o.fiscalDocumentId && o.fiscalStatus !== "authorized") {
          const { queryDocument } = await import("@/domain/fiscal/service");
          await queryDocument({ ...admin, branchId: o.branchId }, o.fiscalDocumentId).catch(() => undefined);
        }
      }
      o = (await unscoped(store).get("online_orders", o.id))!;
      if (step === "pick" && o.status === "invoiced" && !o.delivery?.pickedAt) o = await confirmPicking({ ...admin, branchId: o.branchId }, o.id, { volumes: 1 });
      if (step === "label" && o.delivery?.pickedAt && !o.delivery?.trackingCode) o = await generateLabel(admin, o.id);
      if (step === "dispatch" && o.status === "invoiced" && o.delivery?.pickedAt) o = await dispatchOrder(admin, o.id);
      if (step === "pickup" && o.status === "ready_for_pickup") o = await confirmPickup({ ...admin, branchId: o.branchId }, o.id, o.pickupCode);
      if (step === "deliver" && o.status === "shipped") o = await confirmDelivery(admin, o.id);
      if (step === "credit") {
        // crédito do gateway já ocorrido (data recuada) e conciliado na conta da loja
        const txId = detId("gwtx", o.id);
        const tx = await store.get("gateway_transactions", txId);
        if (tx && tx.status === "awaiting_credit") {
          if (tx.titleId) for (const i of await listAll(store, "installments", { filters: [["eq", "titleId", tx.titleId]] })) await store.update("installments", i.id, { dueDate: addDays(today(), -1) });
          await store.update("gateway_transactions", txId, { expectedAt: addDays(today(), -1) });
        }
        await simulateCredits(admin);
        const acc = await refs.seeder.put("financial_accounts", "banco-intercert", {
          companyId: admin.companyId, branchId: null, isDemo: true, name: "Banco Intercert — conta da loja (simulação)", kind: "bank", bankCode: null, agency: null, accountNumber: null, initialBalance: 0, initialBalanceDate: addDays(today(), -75), balance: 0, seq: 0, active: true,
        });
        if (!S.payments?.bankAccountId) await setSettlementAccount(admin, acc.id);
        const fresh = await store.get("gateway_transactions", txId);
        if (fresh && ["credited", "partial"].includes(fresh.status)) await reconcileTransaction(admin, txId, acc.id);
      }
    }
    orders[sc.key] = (await unscoped(store).get("online_orders", o.id))!;
  }
  out.orders = Object.fromEntries(Object.entries(orders).map(([k, o]) => [k, `${o.code} ${o.status}`]));

  // ── carrinhos parados (recuperação, Tela 55)
  for (const [k, consent, hoursAgo, items] of [
    ["parado-helena", true, 3, [["fone", 1], ["carregador", 1]]],
    ["parado-igor", true, 26, [["meia", 2], ["caneca", 1]]],
    ["parado-visitante", false, 5, [["caderno", 2]]],
  ] as Array<[string, boolean, number, Array<[string, number]>]>) {
    const t = token(k);
    let cart = await getCart(store, S, t).catch(() => null);
    if (!cart) {
      // ilustrativo: item que ficou sem saldo (reservado pelos pedidos acima) simplesmente não entra
      for (const [p, q] of items) await addToCart(store, S, t, { productSlug: await slug(p), skuId: skuOf(p), qty: q }).catch(() => null);
      cart = await getCart(store, S, t);
    }
    if (cart && cart.status === "open") {
      const name = k === "parado-helena" ? "Helena Alves" : k === "parado-igor" ? "Igor Mendes" : "";
      await unscoped(store).update("store_carts", cart.id, {
        customer: name ? { name, email: `${k.replace("parado-", "")}.cliente@demo.intercert.local`, phone: "11976543210" } : null,
        marketingConsent: consent,
        lastActivityAt: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
      });
    }
  }
  out.carts = 3;
  out.at = nowIso();
  return out;
}
