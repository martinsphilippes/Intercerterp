import type { DemoRefs } from "../base";
import { addDays, today } from "@/lib/dates";
import { balanceId } from "../../stock";
import { createTransfer, receiveTransfer, shipTransfer } from "../../transfers";
import { createInventory, saveCounts } from "../../inventory";

/**
 * Demonstração do estoque (idempotente — ids determinísticos e transições idempotentes):
 *  - transferência Matriz → Shopping EM TRÂNSITO;
 *  - transferência Matriz → Shopping recebida PARCIALMENTE com avaria (divergência);
 *  - inventário ABERTO no Shopping com contagens parciais.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const sd = refs.seeder;
  const matriz = await refs.ctxFor("stockist", "matriz");
  const shopping = await refs.ctxFor("stockist", "shopping");
  const wMatriz = refs.warehouses["matriz-main"].id;
  const avail = async (key: string) => {
    const b = await store.get("stock_balances", balanceId(wMatriz, refs.skus[key].id));
    return b ? b.physical - b.reserved : 0;
  };
  const pick = async (key: string, want: number) => Math.min(want, Math.max(0, (await avail(key)) - 1000));
  const out: Record<string, unknown> = {};

  // 1) em trânsito
  const tid = sd.id("transfers", "demo-in-transit");
  let t = await store.get("transfers", tid);
  if (!t) {
    const items = [
      { skuId: refs.skus["caderno-u"].id, qty: await pick("caderno-u", 6000) },
      { skuId: refs.skus["caneca-u"].id, qty: await pick("caneca-u", 4000) },
      { skuId: refs.skus["bone-u"].id, qty: await pick("bone-u", 3000) },
    ].filter((i) => i.qty > 0);
    if (items.length) t = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items, responsibleId: refs.users.stockist.id, expectedAt: addDays(today(), 2), notes: "Reposição semanal da filial (demonstração)." }, { id: tid });
  }
  if (t) {
    t = await shipTransfer(matriz, t.id);
    out.inTransit = t.id;
  }

  // 2) recebida parcialmente, com avaria
  const pid = sd.id("transfers", "demo-partial");
  let p = await store.get("transfers", pid);
  if (!p) {
    const items = [{ skuId: refs.skus["meia-u"].id, qty: await pick("meia-u", 6000) }].filter((i) => i.qty > 0);
    if (items.length) p = await createTransfer(matriz, { toBranchId: refs.branches.shopping.id, items, responsibleId: refs.users.stockist.id, expectedAt: addDays(today(), -1) }, { id: pid });
  }
  if (p) {
    p = await shipTransfer(matriz, p.id);
    const q = p.items[0].qty;
    const rec = Math.max(0, q - 3000);
    if (rec > 0) p = await receiveTransfer(shopping, p.id, { idemKey: "demo-partial-receipt-1", lines: [{ skuId: p.items[0].skuId, receivedQty: rec, damagedQty: 1000, note: "Embalagem rasgada no transporte" }] });
    out.partial = p.id;
  }

  // 3) inventário aberto com contagens parciais (Papelaria + Acessórios do Shopping)
  const iid = sd.id("inventories", "demo-open");
  let inv = await store.get("inventories", iid);
  if (!inv) inv = await createInventory(shopping, { warehouseId: refs.warehouses["shopping-main"].id, scope: "category", categoryId: refs.categories["Acessórios"].id, notes: "Contagem cíclica de acessórios (demonstração)." }, { id: iid });
  if (inv && ["open", "counting"].includes(inv.status)) {
    const counts = await store.list("inventory_counts", { filters: [["eq", "inventoryId", inv.id]], limit: 100 });
    const pending = counts.items.filter((c) => !c.counted);
    if (pending.length === counts.items.length && counts.items.length > 1) {
      const entries = counts.items.slice(0, Math.ceil(counts.items.length / 2)).map((c, i) => ({ skuId: c.skuId, qty: Math.max(0, c.baseQty + (i === 0 ? -1000 : i === 1 ? 1000 : 0)), note: i === 0 ? "Uma unidade não localizada" : undefined }));
      await saveCounts(shopping, inv.id, entries);
    }
    out.inventory = inv.id;
  }
  return out;
}
