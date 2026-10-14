import { listAll } from "@/lib/db";
import { addDays, dayRange, monthStart, today } from "@/lib/dates";
import { getAuth } from "@/lib/auth/provider";
import { BusinessError } from "@/lib/core/errors";
import { DEMO_PASSWORD, type DemoRefs } from "../base";
import { PLACEHOLDER_EMAIL_DOMAIN } from "../../sellers";

/**
 * Demonstração de vendedores, comissões e metas por vendedor (CAD-05, VEN-05, VEN-06) — idempotente:
 *  - Vera Vendedora (usuária do sistema, perfil Caixa, 2,5%) e Rafael Representante (SEM acesso ao sistema, 4% e 6% em Calçados);
 *  - vendas concluídas do mês anterior e do atual sem vendedor recebem um deles (só as que ainda não têm vendedor);
 *  - metas de receita do mês corrente para os dois vendedores na Matriz;
 *  - categoria financeira "Comissões sobre vendas" e o fechamento do mês anterior da Vera (título a pagar).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const store = sd.store;
  const companyId = refs.company.id;
  const base = { companyId, isDemo: true };
  const out: Record<string, unknown> = {};

  // Vendedora com acesso (login "vendedora", mesma senha de demonstração)
  let vera = await sd.put("users", "seller-vera", {
    name: "Vera Vendedora", email: "vendedora@demo.intercert.local", login: "vendedora", status: "active", roleId: refs.users.cashier.roleId ?? null, isAdmin: false,
    companyIds: [companyId], branchIds: [refs.branches.matriz.id], isDemo: true, firstAccessAt: new Date().toISOString(), commissionBps: 250,
  });
  if (!vera.authId) {
    const authId = await getAuth().createUser(vera.email, DEMO_PASSWORD, vera.name);
    vera = await store.update("users", vera.id, { authId });
  }
  // Representante sem acesso ao sistema
  const rafaelId = sd.id("users", "seller-rafael");
  const rafael = await sd.put("users", "seller-rafael", {
    name: "Rafael Representante", email: `vendedor.${rafaelId}@${PLACEHOLDER_EMAIL_DOMAIN}`, login: null, phone: "11988887777", status: "active", loginDisabled: true, isAdmin: false, roleId: null,
    companyIds: [companyId], branchIds: [], isDemo: true, commissionBps: 400, commissionByCategory: { [refs.categories["Calçados"].id]: 600 },
  });
  out.sellers = [vera.id, rafael.id];

  await sd.put("fin_categories", "comissoes", { ...base, name: "Comissões sobre vendas", type: "expense", dreGroup: "Despesas com pessoal", active: true });

  // Vendas do mês anterior e do atual sem vendedor: atribuídas de forma determinística (pelo número da venda)
  const prevStart = monthStart(addDays(monthStart(today()), -1));
  const { start, end } = dayRange(prevStart, today());
  const sales = await listAll(store, "sales", { filters: [["eq", "companyId", companyId], ["gte", "completedAt", start], ["lt", "completedAt", end]] });
  let assigned = 0;
  for (const s of sales) {
    if (s.sellerId || s.status !== "completed") continue;
    const k = (s.number ?? 0) % 3;
    if (k === 2) continue; // parte das vendas fica sem vendedor (atribuída ao operador)
    await store.update("sales", s.id, { sellerId: k === 0 ? rafael.id : vera.id });
    assigned++;
  }
  out.assigned = assigned;

  // Metas de receita do mês corrente por vendedor (Matriz)
  const period = today().slice(0, 7);
  for (const [key, seller, target] of [["vera", vera, 600000], ["rafael", rafael, 800000]] as const) {
    await sd.put("goals", `seller-${key}-${period}-revenue`, { ...base, branchId: refs.branches.matriz.id, sellerId: seller.id, period, metric: "revenue", target, notes: "Meta individual de demonstração" });
  }

  // Fechamento do mês anterior da Vera (gera a conta a pagar); repetir não duplica
  try {
    const { closeCommission } = await import("../../commissions");
    const ctx = await refs.ctxFor("admin", null);
    const prevEnd = addDays(monthStart(today()), -1);
    const t = await closeCommission(ctx, { from: prevStart, to: prevEnd, sellerId: vera.id, base: "invoiced", dueDate: addDays(monthStart(today()), 9) });
    out.closing = t.id;
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e; // já fechado ou sem comissão no mês anterior
    out.closing = e.code;
  }
  return out;
}
