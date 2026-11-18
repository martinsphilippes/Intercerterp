import { describe, it, expect, beforeAll } from "vitest";
import { freshStore } from "./helpers";
import { seedDemo } from "@/domain/seed";
import { listAll } from "@/lib/db";
import type { MemoryStore } from "@/lib/db/memory-store";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { publicCatalog, storePreviewData } from "@/domain/ecommerce/catalog";
import { StorePreview } from "@/app/(app)/comercio-digital/_components/store-preview";
import { formatMoney } from "@/lib/money";
import { seed as seedEcommerce } from "@/domain/seed/modules/ecommerce";
import { seedBase } from "@/domain/seed/base";

/** Demonstração da "Loja Modelo" (§49): montada pelo fluxo real e idempotente ao rodar de novo. */
let store: MemoryStore;

beforeAll(async () => {
  store = freshStore();
  // DEMO_HISTORY_DAYS=30 reproduz a demonstração completa (com 30 dias de vendas no PDV consumindo estoque)
  await seedDemo(store, { historyDays: Number(process.env.DEMO_HISTORY_DAYS || 1) });
}, 600_000);

describe("demonstração do comércio digital", () => {
  it("loja publicada, vitrine, pendência de peso, cupom, canal e pedidos em todas as etapas", async () => {
    const st = (await listAll(store, "stores"))[0];
    expect(st).toMatchObject({ name: "Loja Modelo", slug: "loja-modelo", status: "published", orderPrefix: "IC" });
    const cat = await publicCatalog(store, st);
    expect(cat.cards.length).toBe(10); // 11 no catálogo; o Cinto (peso pendente) não aparece
    const cinto = (await listAll(store, "store_products", { filters: [["eq", "storeId", st.id]] })).find((l) => l.title.startsWith("Cinto"));
    expect(cinto.issues.map((i: any) => i.code)).toContain("no_weight");
    const events = await listAll(store, "commerce_events", { filters: [["eq", "storeId", st.id]] });
    // uma linha por produto no monitor, mesmo com várias validações (Tela 60)
    const catalogFailures = events.filter((e) => e.area === "catalog" && e.status === "failed");
    expect(catalogFailures).toHaveLength(1);
    expect(catalogFailures[0].reference).toMatch(/^Cinto/);
    expect(catalogFailures[0].attempts).toBeGreaterThan(1);
    const orders = await listAll(store, "online_orders", { filters: [["eq", "storeId", st.id]] });
    const by = (email: string) => orders.find((o) => o.customer.email === `${email}.cliente@demo.intercert.local`)!;
    expect(orders).toHaveLength(7);
    expect(by("ana")).toMatchObject({ status: "ready_for_pickup", fiscalStatus: "authorized" });
    expect(by("bruno")).toMatchObject({ status: "shipped" });
    expect(by("carla")).toMatchObject({ status: "invoiced" });
    expect(by("diego")).toMatchObject({ status: "pending_payment" });
    expect(by("elisa")).toMatchObject({ status: "cancelled", paymentStatus: "failed" });
    expect(by("fabio")).toMatchObject({ status: "delivered" });
    expect(by("gabriela")).toMatchObject({ status: "pending_payment" });
    expect(orders.map((o) => o.code).sort()).toEqual(["IC-1041", "IC-1042", "IC-1043", "IC-1044", "IC-1045", "IC-1046", "IC-1047"]);
    const tx = (await listAll(store, "gateway_transactions", { filters: [["eq", "orderId", by("fabio").id]] }))[0];
    expect(tx.status).toBe("reconciled");
    const carts = (await listAll(store, "store_carts", { filters: [["eq", "storeId", st.id], ["eq", "status", "open"]] })).filter((c) => c.itemsCount > 0);
    expect(carts.length).toBe(3);
    expect((await listAll(store, "store_channels", { filters: [["eq", "storeId", st.id]] }))[0].status).toBe("prepared");
  });

  it("miniatura da loja no ERP: os produtos, preços e categorias da vitrine, na mesma ordem (Telas 49–51)", async () => {
    const st = (await listAll(store, "stores"))[0];
    const cat = await publicCatalog(store, st);
    const prev = await storePreviewData(store, st, 8);
    expect(prev.total).toBe(10);
    expect(prev.cards).toHaveLength(8);
    expect(prev.cards.map((c) => [c.title, c.price])).toEqual(cat.cards.slice(0, 8).map((c) => [c.title, c.price]));
    expect(prev.cards.some((c) => c.title.startsWith("Cinto"))).toBe(false); // peso pendente: fora da vitrine, fora da prévia
    expect(prev.categories).toEqual(cat.categories.map((c) => c.name));
    expect(prev.offer).toBeNull();
    // oferta do modelo Campanha: o produto escolhido, enquanto estiver à venda
    const chosen = cat.cards[3];
    await store.update("stores", st.id, { theme: { ...st.theme, offerProductId: chosen.productId } });
    expect((await storePreviewData(store, (await store.get("stores", st.id))!, 8)).offer).toMatchObject({ title: chosen.title, price: chosen.price });
    await store.update("stores", st.id, { theme: st.theme });

    // a miniatura mostra o que a loja vende; exemplos só para loja sem produto, e rotulados
    const props = { template: "essencial", accent: "#1f448c", storeName: st.name, title: "Tudo para o seu dia a dia.", compact: true };
    const html = renderToStaticMarkup(createElement(StorePreview, { ...props, products: prev.cards.map((c) => ({ ...c, imageUrl: null })), categories: prev.categories }));
    for (const c of prev.cards.slice(0, 3)) {
      expect(html).toContain(c.title);
      expect(html).toContain(formatMoney(c.price));
    }
    expect(html).toContain(prev.categories[0]);
    expect(html).not.toContain("Cafeteira elétrica");
    expect(html).not.toContain("Produtos de exemplo");
    expect(html).toContain("Carrinho (0)");
    const empty = renderToStaticMarkup(createElement(StorePreview, { ...props, storeName: "Loja nova" }));
    expect(empty).toContain("Cafeteira elétrica");
    expect(empty).toContain("Produtos de exemplo");
    // foto por cima da ilustração da categoria (se a foto não abrir, a miniatura volta para a ilustração)
    const withPhoto = renderToStaticMarkup(createElement(StorePreview, { ...props, products: [{ title: "Caneca", price: 2990, category: "Casa", imageUrl: "/loja/loja-modelo/imagem/abc12345" }] }));
    expect(withPhoto).toMatch(/<svg[^>]*>.*<\/svg><img[^>]*src="\/loja\/loja-modelo\/imagem\/abc12345"/s);
  });

  it("rodar a demonstração de novo não duplica pedidos, reservas nem recebíveis", async () => {
    const before = { orders: (await listAll(store, "online_orders")).length, titles: (await listAll(store, "titles", { filters: [["eq", "originType", "online_order"]] })).length, movs: (await listAll(store, "stock_movements", { filters: [["eq", "originType", "online_order"]] })).length };
    const refs = await seedBase(store);
    await seedEcommerce(refs);
    expect((await listAll(store, "online_orders")).length).toBe(before.orders);
    expect((await listAll(store, "titles", { filters: [["eq", "originType", "online_order"]] })).length).toBe(before.titles);
    expect((await listAll(store, "stock_movements", { filters: [["eq", "originType", "online_order"]] })).length).toBe(before.movs);
  }, 120_000);
});
