import { detId, isConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { DEFAULT_TZ, today } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import { setSetting } from "@/lib/core/settings";

/**
 * Cria uma empresa operacional com parâmetros iniciais simples e editáveis:
 * filial matriz, depósitos, perfis padrão, tabela de preço, contas, meios e condições de pagamento,
 * categorias financeiras e centro de custo. A configuração fiscal NÃO é presumida (fica pendente).
 */
export async function createCompanyWithDefaults(
  store: Store,
  input: { name: string; tradeName?: string; cnpj?: string; regime?: string; uf?: string; cityName?: string; cityCode?: string; branchName?: string; createdBy?: string; key?: string },
): Promise<{ company: Doc; branch: Doc; roles: Record<string, Doc> }> {
  // chave dos ids: única por empresa nova (key) — CNPJ/nome só na instalação (retomável)
  const key = input.key ?? (onlyDigits(input.cnpj) || input.name);
  const put = async (collection: string, k: string, data: Record<string, any>) => {
    const id = detId("setup", key, collection, k);
    const ex = await store.get(collection, id);
    if (ex) return ex;
    try {
      return await store.create(collection, data, id);
    } catch (e) {
      if (isConflict(e)) {
        const again = await store.get(collection, id);
        if (again) return again;
        // conflito de índice único (ex.: CNPJ já usado por outra empresa criada ao mesmo tempo): nunca reaproveita
        const { BusinessError } = await import("@/lib/core/errors");
        throw new BusinessError(collection === "companies" ? "Já existe empresa com este CNPJ." : "Registro duplicado na parametrização inicial da empresa.", "duplicate");
      }
      throw e;
    }
  };
  const company = await put("companies", "company", {
    name: input.name, tradeName: input.tradeName ?? input.name, cnpj: onlyDigits(input.cnpj) || null, regime: input.regime ?? "simples", crt: input.regime === "simples" || !input.regime ? "1" : "3",
    status: "active", isDemo: false, createdBy: input.createdBy ?? null, address: { uf: input.uf ?? "", cityName: input.cityName ?? "", cityCode: input.cityCode ?? "" },
  });
  // nunca devolver/atualizar uma empresa de terceiros por colisão de identificador
  if ((onlyDigits(input.cnpj) || null) !== (company.cnpj ?? null) || (!input.cnpj && company.name !== input.name)) {
    const { BusinessError } = await import("@/lib/core/errors");
    throw new BusinessError("Conflito de identificador com uma empresa existente. Tente novamente.", "duplicate");
  }
  const base = { companyId: company.id, createdBy: input.createdBy ?? null };
  const whId = detId("setup", key, "warehouses", "main");
  const branch = await put("branches", "matriz", {
    ...base, code: "01", name: input.branchName ?? "Matriz", cnpj: onlyDigits(input.cnpj) || null, uf: input.uf ?? null, cityName: input.cityName ?? null, cityCode: input.cityCode ?? null,
    status: "active", fiscalStatus: "pending", defaultWarehouseId: whId, timezone: DEFAULT_TZ,
  });
  await put("warehouses", "main", { ...base, branchId: branch.id, code: "PRINC", name: "Depósito principal", kind: "available", isDefault: true, status: "active" });
  await put("warehouses", "damaged", { ...base, branchId: branch.id, code: "AVARIA", name: "Avarias", kind: "damaged", isDefault: false, status: "active" });
  const roles: Record<string, Doc> = {};
  for (const r of DEFAULT_ROLES) roles[r.key] = await put("roles", r.key, { ...base, key: r.key, name: r.name, description: r.description, permissions: r.permissions, actions: r.actions, templateActions: r.actions, discountLimitBps: r.discountLimitBps, system: true, active: true });
  const table = await put("price_tables", "varejo", { ...base, name: "Varejo", kind: "retail", active: true, isDefault: true });
  await store.update("branches", branch.id, { defaultPriceTableId: table.id });
  for (const u of [["UN", "Unidade"], ["PC", "Peça"], ["CX", "Caixa"], ["KG", "Quilograma"], ["M", "Metro"], ["H", "Hora"]]) await put("units", u[0], { ...base, code: u[0], name: u[1], decimals: u[0] === "KG" ? 3 : 0, status: "active" });
  const cash = await put("financial_accounts", "caixa", { ...base, branchId: branch.id, name: "Caixa — Matriz", kind: "cash", initialBalance: 0, initialBalanceDate: today(), balance: 0, seq: 0, active: true });
  const bank = await put("financial_accounts", "banco", { ...base, name: "Conta bancária principal", kind: "bank", initialBalance: 0, initialBalanceDate: today(), balance: 0, seq: 0, active: true });
  const methods = [
    { k: "dinheiro", name: "Dinheiro", kind: "cash", accountId: cash.id, allowsChange: true },
    { k: "debito", name: "Cartão de débito", kind: "debit", settlementDays: 1 },
    { k: "credito", name: "Cartão de crédito", kind: "credit", settlementDays: 30, maxInstallments: 12 },
    { k: "pix", name: "Pix", kind: "pix", accountId: bank.id },
    { k: "crediario", name: "Crediário", kind: "crediario", requiresCustomer: true },
    { k: "boleto", name: "Boleto", kind: "boleto", requiresCustomer: true, accountId: bank.id },
    { k: "vale", name: "Vale-crédito", kind: "store_credit" },
  ];
  for (const [i, m] of methods.entries()) {
    await put("payment_methods", m.k, { ...base, name: m.name, kind: m.kind, accountId: m.accountId ?? null, feeBps: 0, settlementDays: m.settlementDays ?? 0, allowsChange: Boolean(m.allowsChange), requiresCustomer: Boolean(m.requiresCustomer), maxInstallments: m.maxInstallments ?? 1, active: true, sortOrder: i, availablePdv: true });
  }
  for (const t of [["avista", "À vista", 1, 0], ["30", "30 dias", 1, 30], ["30-60", "30/60 dias", 2, 30], ["30-60-90", "30/60/90 dias", 3, 30]] as const) {
    await put("payment_terms", t[0], { ...base, name: t[1], installments: t[2], firstDueDays: t[3], intervalDays: 30, interestBps: 0, active: true, kind: "both" });
  }
  const cats: Record<string, Doc> = {};
  for (const c of [["vendas", "Receita de vendas", "revenue"], ["servicos", "Receita de serviços", "revenue"], ["compras", "Compra de mercadorias", "expense"], ["despesas", "Despesas operacionais", "expense"], ["tarifas", "Tarifas e taxas", "expense"], ["impostos", "Impostos", "expense"]] as const) {
    cats[c[0]] = await put("fin_categories", c[0], { ...base, name: c[1], type: c[2], active: true });
  }
  await put("cost_centers", "geral", { ...base, name: "Geral", code: "100", active: true });
  await setSetting(store, company.id, null, "finance.category.sales", cats.vendas.id);
  await setSetting(store, company.id, null, "finance.category.purchases", cats.compras.id);
  await setSetting(store, company.id, null, "finance.category.fees", cats.tarifas.id);
  return { company, branch, roles };
}
