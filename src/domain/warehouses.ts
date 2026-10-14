import { detId, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { QTY } from "@/lib/money";
import { branchAdminCtx } from "./companies";
import { INVENTORY_ACTIVE_STATUSES } from "./inventory";
import { SELECTABLE_TYPES, TYPE_DEF, WAREHOUSE_TYPE_LABEL, canBeDefaultWarehouse, isActiveWarehouse, warehouseType, type WarehouseType } from "./warehouse-rules";

export * from "./warehouse-rules";

/**
 * Cadastro de depósitos por filial (§39): novo, editar, ativar/desativar e depósito padrão da filial, com as travas
 * no servidor. Exige a operação `stock.warehouses` no perfil da empresa da filial. Regras de tipo e da divisão da
 * baixa por depósito em `warehouse-rules.ts`.
 */

// ───────────────────────────── cadastro

export interface WarehouseInput {
  name: string;
  code: string;
  type: WarehouseType;
  salePriority?: number | null;
  notes?: string | null;
}

async function adminCtx(ctx: Ctx, branchId: string) {
  // filial da empresa ativa ou de outra autorizada; a operação exige `stock.warehouses` no perfil DAQUELA empresa
  const { ctx: c, branch } = await branchAdminCtx(ctx, branchId, "view");
  requireAction(c, "stock.warehouses");
  return { c: { ...c, branchId }, branch };
}

async function loadWarehouse(ctx: Ctx, id: string) {
  const w0 = await ctx.store.get("warehouses", id);
  if (!w0) throw new BusinessError("Depósito não encontrado.", "not_found");
  const { c, branch } = await adminCtx(ctx, w0.branchId);
  const w = await c.store.getOrThrow("warehouses", id);
  assert(w.companyId === branch.companyId, "Depósito de outra empresa.");
  return { c, branch, w };
}

function normalize(input: WarehouseInput) {
  const name = input.name?.trim() ?? "";
  const code = (input.code ?? "").trim().toUpperCase();
  assert(name, "Informe o nome do depósito.");
  assert(name.length <= 120, "Nome do depósito com mais de 120 caracteres.");
  assert(code, "Informe o código do depósito.");
  assert(/^[A-Z0-9_-]{1,20}$/.test(code), "Código do depósito: até 20 letras, números, hífen ou sublinhado (sem espaços).");
  const p = input.salePriority;
  assert(p == null || (Number.isInteger(p) && p >= 1 && p <= 99), "Prioridade de baixa deve ser um número inteiro de 1 a 99.");
  const notes = input.notes?.trim() || null;
  assert(!notes || notes.length <= 500, "Observações com mais de 500 caracteres.");
  return { name, code, salePriority: p ?? null, notes };
}

async function assertUniqueCode(store: Store, branchId: string, code: string, selfId?: string) {
  const all = await listAll(store, "warehouses", { filters: [["eq", "branchId", branchId]] });
  const dup = all.find((w) => w.id !== selfId && String(w.code ?? "").toUpperCase() === code);
  if (dup) throw new BusinessError(`Já existe o depósito ${dup.name} com o código ${code} nesta filial.`, "duplicate");
  return all;
}

/** Saldos do depósito que impedem desativar ou mudar a natureza (físico ≠ 0, reservado > 0, trânsito ≠ 0). */
async function blockingBalances(store: Store, warehouseId: string) {
  const bals = await listAll(store, "stock_balances", { filters: [["eq", "warehouseId", warehouseId]] });
  return bals.filter((b) => (b.physical ?? 0) !== 0 || (b.reserved ?? 0) > 0 || (b.inTransit ?? 0) !== 0);
}

async function describeBalances(store: Store, bals: Doc[]) {
  const parts: string[] = [];
  for (const b of bals.slice(0, 3)) {
    const sku = await store.get("skus", b.skuId);
    const bits = [(b.physical ?? 0) !== 0 && `físico ${(b.physical ?? 0) / QTY}`, (b.reserved ?? 0) > 0 && `reservado ${(b.reserved ?? 0) / QTY}`, (b.inTransit ?? 0) !== 0 && `em trânsito ${(b.inTransit ?? 0) / QTY}`].filter(Boolean);
    parts.push(`${sku?.sku ?? b.skuId} (${bits.join(", ")})`);
  }
  return `${parts.join("; ")}${bals.length > 3 ? ` e mais ${bals.length - 3} item(ns)` : ""}`;
}

async function terminalsUsing(store: Store, branchId: string, warehouseId: string) {
  return (await listAll(store, "terminals", { filters: [["eq", "branchId", branchId]] })).filter((t) => t.defaultWarehouseId === warehouseId);
}

/** Toda filial mantém ao menos um depósito de venda ativo (o que sobraria sem este?). */
async function assertAnotherSale(store: Store, branchId: string, selfId: string, what: string) {
  const others = (await listAll(store, "warehouses", { filters: [["eq", "branchId", branchId]] })).filter((w) => w.id !== selfId && isActiveWarehouse(w) && warehouseType(w) === "sale");
  if (!others.length) throw new BusinessError(`A filial precisa de ao menos um depósito de venda ativo: cadastre ou ative outro depósito de venda antes de ${what}.`, "last_sale_warehouse");
}

export async function createWarehouse(ctx: Ctx, branchId: string, input: WarehouseInput, opts: { idemKey?: string | null } = {}) {
  const { c, branch } = await adminCtx(ctx, branchId);
  const id = opts.idemKey ? detId("warehouse", branchId, "form", opts.idemKey) : undefined;
  if (id) {
    const existing = await c.store.get("warehouses", id);
    if (existing) return existing; // reenvio do mesmo formulário
  }
  assert(SELECTABLE_TYPES.includes(input.type), "Tipo de depósito inválido (o de avarias é criado com a filial).");
  assert(branch.status !== "inactive", "Filial inativa.");
  const data = normalize(input);
  await assertUniqueCode(c.store, branchId, data.code);
  const def = TYPE_DEF[input.type as Exclude<WarehouseType, "damaged">];
  const w = await c.store.create(
    "warehouses",
    {
      companyId: branch.companyId, branchId, createdBy: ctx.user.id, code: data.code, name: data.name, kind: def.kind, purpose: def.purpose, isDefault: false, status: "active",
      salePriority: data.salePriority ?? (input.type === "consumption" ? null : input.type === "storage" ? 2 : 1), notes: data.notes, ...(branch.isDemo ? { isDemo: true } : {}),
    },
    id,
  );
  await audit(c, {
    module: "stock", action: "warehouse.create", entityType: "warehouse", entityId: w.id,
    summary: `Depósito ${w.code} — ${w.name} (${WAREHOUSE_TYPE_LABEL[input.type]}) cadastrado na filial ${branch.name}`,
    after: { code: w.code, name: w.name, type: input.type, salePriority: w.salePriority, notes: w.notes }, related: [`branch:${branchId}`, `warehouse:${w.id}`],
  });
  return w;
}

export async function updateWarehouse(ctx: Ctx, id: string, input: WarehouseInput) {
  const { c, branch, w } = await loadWarehouse(ctx, id);
  const data = normalize(input);
  const before = warehouseType(w);
  if (before === "damaged") assert(input.type === "damaged", "O depósito de avarias do sistema não muda de tipo.");
  else assert(SELECTABLE_TYPES.includes(input.type), "Tipo de depósito inválido (não é possível transformar um depósito em avarias).");
  await assertUniqueCode(c.store, w.branchId, data.code, id);
  const patch: Record<string, any> = { code: data.code, name: data.name, notes: data.notes, salePriority: data.salePriority ?? w.salePriority ?? null };
  if (input.type !== before && before !== "damaged") {
    const def = TYPE_DEF[input.type as Exclude<WarehouseType, "damaged">];
    if (def.kind !== w.kind) {
      // muda a natureza (entra/sai do disponível): padrão da filial e de terminal precisam ser de venda/almoxarifado
      assert(branch.defaultWarehouseId !== id, `${w.name} é o depósito padrão da filial: o padrão precisa ser de venda ou almoxarifado. Defina outro depósito como padrão antes.`);
      const terms = await terminalsUsing(c.store, w.branchId, id);
      assert(!terms.length, `${w.name} é o depósito padrão do(s) terminal(is) ${terms.map((t) => t.name).join(", ")}: altere o terminal antes de mudar o tipo.`);
      const blocking = await blockingBalances(c.store, id);
      if (blocking.length) {
        throw new BusinessError(`${w.name} tem saldo: ${await describeBalances(c.store, blocking)}. Transfira o estoque para outro depósito (Estoque › Transferências › Entre depósitos) antes de mudar entre “disponível para venda” e “uso e consumo”.`, "warehouse_has_stock");
      }
    }
    if (before === "sale" && isActiveWarehouse(w)) await assertAnotherSale(c.store, w.branchId, id, `mudar ${w.name} para ${WAREHOUSE_TYPE_LABEL[input.type].toLowerCase()}`);
    Object.assign(patch, def);
  }
  const after = await c.store.update("warehouses", id, patch);
  const d = diff(w, after);
  if (Object.keys(d.after).length) {
    await audit(c, {
      module: "stock", action: "warehouse.update", entityType: "warehouse", entityId: id,
      summary: `Depósito ${after.code} — ${after.name} alterado${input.type !== before ? ` (tipo: ${WAREHOUSE_TYPE_LABEL[before]} → ${WAREHOUSE_TYPE_LABEL[input.type]})` : ""}`,
      before: d.before, after: d.after, related: [`branch:${w.branchId}`, `warehouse:${id}`],
    });
  }
  return after;
}

/**
 * Ativa/desativa. Desativar exige: saldo físico zero, nada reservado nem em trânsito, sem inventário em andamento,
 * não ser o padrão da filial nem de terminal, não ser o de avarias e a filial manter outro depósito de venda ativo.
 */
export async function setWarehouseStatus(ctx: Ctx, id: string, status: "active" | "inactive", reason?: string | null) {
  const { c, branch, w } = await loadWarehouse(ctx, id);
  if ((w.status ?? "active") === status) return w;
  if (status === "inactive") {
    assert(warehouseType(w) !== "damaged", "O depósito de avarias do sistema não pode ser desativado (recebe devoluções e transferências com avaria).");
    assert(branch.defaultWarehouseId !== id, `${w.name} é o depósito padrão da filial. Defina outro depósito como padrão antes de desativá-lo.`);
    const terms = await terminalsUsing(c.store, w.branchId, id);
    assert(!terms.length, `${w.name} é o depósito padrão do(s) terminal(is) ${terms.map((t) => t.name).join(", ")}. Altere o depósito do terminal (Administração › Terminais) antes de desativar.`);
    const blocking = await blockingBalances(c.store, id);
    if (blocking.length) {
      throw new BusinessError(`${w.name} ainda tem estoque: ${await describeBalances(c.store, blocking)}. Transfira o saldo para outro depósito (Estoque › Transferências › Entre depósitos), libere as reservas e receba o que estiver em trânsito antes de desativar.`, "warehouse_has_stock");
    }
    const inv = await listAll(c.store, "inventories", { filters: [["eq", "warehouseId", id], ["eq", "status", INVENTORY_ACTIVE_STATUSES]] });
    assert(!inv.length, `${w.name} tem inventário em andamento: conclua ou cancele antes de desativar.`);
    if (warehouseType(w) === "sale") await assertAnotherSale(c.store, w.branchId, id, `desativar ${w.name}`);
  }
  const after = await c.store.update("warehouses", id, { status });
  await audit(c, {
    module: "stock", action: status === "inactive" ? "warehouse.deactivate" : "warehouse.activate", entityType: "warehouse", entityId: id,
    summary: `Depósito ${w.code} — ${w.name} ${status === "inactive" ? "desativado (deixa de receber e de completar vendas)" : "reativado"}`,
    reason: reason?.trim() || null, before: { status: w.status ?? "active" }, after: { status }, related: [`branch:${w.branchId}`, `warehouse:${id}`],
  });
  return after;
}

/** Define o depósito padrão da filial (venda ou almoxarifado, ativo). */
export async function setBranchDefaultWarehouse(ctx: Ctx, id: string) {
  const { c, branch, w } = await loadWarehouse(ctx, id);
  assert(canBeDefaultWarehouse(w), "O depósito padrão da filial precisa ser de venda ou almoxarifado e estar ativo.");
  if (branch.defaultWarehouseId === id) return w;
  const previous = branch.defaultWarehouseId ? await c.store.get("warehouses", branch.defaultWarehouseId) : null;
  await c.store.update("branches", branch.id, { defaultWarehouseId: id });
  if (previous && previous.isDefault) await c.store.update("warehouses", previous.id, { isDefault: false });
  const after = await c.store.update("warehouses", id, { isDefault: true });
  await audit(c, {
    module: "stock", action: "warehouse.set_default", entityType: "warehouse", entityId: id,
    summary: `Depósito padrão da filial ${branch.name}: ${previous ? `${previous.name} → ` : ""}${w.name} (recebimentos, devoluções sem origem e terminais sem depósito próprio)`,
    before: { defaultWarehouseId: branch.defaultWarehouseId ?? null }, after: { defaultWarehouseId: id }, related: [`branch:${branch.id}`, `warehouse:${id}`, ...(previous ? [`warehouse:${previous.id}`] : [])],
  });
  return after;
}

/** Resumo de saldo por depósito da filial (itens com saldo, físico, reservado e valor ao custo médio). */
export async function warehouseStockSummary(store: Store, branchId: string) {
  const bals = await listAll(store, "stock_balances", { filters: [["eq", "branchId", branchId]] });
  const out = new Map<string, { items: number; physical: number; reserved: number; inTransit: number; value: number }>();
  for (const b of bals) {
    const cur = out.get(b.warehouseId) ?? { items: 0, physical: 0, reserved: 0, inTransit: 0, value: 0 };
    if ((b.physical ?? 0) !== 0) cur.items++;
    cur.physical += b.physical ?? 0;
    cur.reserved += b.reserved ?? 0;
    cur.inTransit += b.inTransit ?? 0;
    cur.value += Math.round(((b.physical ?? 0) * (b.avgCost ?? 0)) / QTY);
    out.set(b.warehouseId, cur);
  }
  return out;
}
