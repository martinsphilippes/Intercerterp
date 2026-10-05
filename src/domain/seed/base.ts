import { detId, isConflict } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { searchable } from "@/lib/core/text";
import { getAuth } from "@/lib/auth/provider";
import { addDays, monthStart, today } from "@/lib/dates";
import { toCtxUser } from "@/lib/auth/users";
import type { Ctx } from "@/lib/core/ctx";
import { priceScopeKey } from "../pricing";
import { balanceId, postMovements } from "../stock";

/**
 * Ambiente de DEMONSTRAÇÃO — empresa marcada com isDemo=true e nome "(DEMO)".
 * Repetível: todos os registros têm id determinístico; reexecutar não duplica.
 * Documentos fiscais e pagamentos da demonstração usam provedores de SIMULAÇÃO, sem validade.
 */

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Intercert@2026";

export class Seeder {
  constructor(public store: Store) {}
  id(collection: string, key: string) {
    return detId("demo", collection, key);
  }
  async put(collection: string, key: string, data: Record<string, any>): Promise<Doc> {
    const id = this.id(collection, key);
    const existing = await this.store.get(collection, id);
    if (existing) return existing;
    try {
      return await this.store.create(collection, data, id);
    } catch (e) {
      if (isConflict(e)) {
        const again = await this.store.get(collection, id);
        if (again) return again;
      }
      throw e;
    }
  }
}

export interface DemoRefs {
  ctxFor(userKey: string, branchKey?: string | null): Promise<Ctx>;
  company: Doc;
  branches: Record<string, Doc>;
  warehouses: Record<string, Doc>;
  terminals: Record<string, Doc>;
  users: Record<string, Doc>;
  accounts: Record<string, Doc>;
  methods: Record<string, Doc>;
  terms: Record<string, Doc>;
  categories: Record<string, Doc>;
  finCategories: Record<string, Doc>;
  costCenters: Record<string, Doc>;
  skus: Record<string, Doc>;
  products: Record<string, Doc>;
  customers: Record<string, Doc>;
  suppliers: Record<string, Doc>;
  priceTables: Record<string, Doc>;
  seeder: Seeder;
}

export async function seedBase(store: Store): Promise<DemoRefs> {
  const sd = new Seeder(store);
  const company = await sd.put("companies", "company", {
    name: "Intercert Comércio Varejista Ltda (DEMO)",
    tradeName: "Loja Demonstração Intercert",
    cnpj: "11222333000181",
    ie: "110042490114",
    im: "1234567",
    regime: "simples",
    crt: "1",
    cnae: "4781400",
    email: "contato@demo.intercert.local",
    phone: "1133334444",
    address: { street: "Rua das Flores", number: "100", district: "Centro", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "01001000" },
    status: "active",
    isDemo: true,
  });
  const companyId = company.id;
  const base = { companyId, isDemo: true };

  // Perfis
  const roles: Record<string, Doc> = {};
  for (const r of DEFAULT_ROLES) {
    roles[r.key] = await sd.put("roles", r.key, { ...base, key: r.key, name: r.name, description: r.description, permissions: r.permissions, actions: r.actions, discountLimitBps: r.discountLimitBps, system: true, active: true });
  }

  // Filiais, depósitos, terminais
  const branches: Record<string, Doc> = {};
  const warehouses: Record<string, Doc> = {};
  const branchDefs = [
    { key: "matriz", code: "01", name: "Matriz — Centro", cnpj: "11222333000181", ie: "110042490114", address: { street: "Rua das Flores", number: "100", district: "Centro", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "01001000" } },
    { key: "shopping", code: "02", name: "Filial — Shopping Norte", cnpj: "11222333000262", ie: "110042490220", address: { street: "Av. Otto Baumgart", number: "500", district: "Vila Guilherme", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "02049000" } },
  ];
  for (const b of branchDefs) {
    const wid = sd.id("warehouses", `${b.key}-main`);
    branches[b.key] = await sd.put("branches", b.key, {
      ...base, code: b.code, name: b.name, cnpj: b.cnpj, ie: b.ie, im: "1234567", uf: "SP", cityCode: "3550308", cityName: "São Paulo", address: b.address,
      phone: "1133334444", email: `${b.key}@demo.intercert.local`, status: "active", fiscalStatus: "simulation", defaultWarehouseId: wid, timezone: "America/Sao_Paulo",
    });
    warehouses[`${b.key}-main`] = await sd.put("warehouses", `${b.key}-main`, { ...base, branchId: branches[b.key].id, code: "PRINC", name: "Depósito principal", kind: "available", isDefault: true, status: "active" });
    warehouses[`${b.key}-damaged`] = await sd.put("warehouses", `${b.key}-damaged`, { ...base, branchId: branches[b.key].id, code: "AVARIA", name: "Avarias", kind: "damaged", isDefault: false, status: "active" });
  }
  const terminals: Record<string, Doc> = {};
  for (const t of [
    { key: "cx1", branch: "matriz", code: "CX01", name: "Caixa 01 — Matriz", series: 1 },
    { key: "cx2", branch: "matriz", code: "CX02", name: "Caixa 02 — Matriz", series: 2 },
    { key: "cx3", branch: "shopping", code: "CX03", name: "Caixa 01 — Shopping", series: 1 },
  ]) {
    terminals[t.key] = await sd.put("terminals", t.key, {
      ...base, branchId: branches[t.branch].id, code: t.code, name: t.name, status: "active", nfceSeries: t.series, printerMode: "browser", paperWidth: 80, scannerMode: "keyboard_wedge",
      tefProvider: "manual_pos", allowNegativeStock: false, defaultWarehouseId: warehouses[`${t.branch}-main`].id,
    });
  }

  // Usuários (senha de demonstração única, informada no README)
  const auth = getAuth();
  const users: Record<string, Doc> = {};
  const userDefs = [
    { key: "admin", name: "Ana Administradora", email: "admin@demo.intercert.local", login: "admin", role: "admin", isAdmin: true, branches: [] as string[] },
    { key: "manager", name: "Gustavo Gerente", email: "gerente@demo.intercert.local", login: "gerente", role: "manager", isAdmin: false, branches: [] },
    { key: "cashier", name: "Carla Caixa", email: "caixa@demo.intercert.local", login: "caixa", role: "cashier", isAdmin: false, branches: ["matriz"] },
    { key: "stockist", name: "Eduardo Estoquista", email: "estoque@demo.intercert.local", login: "estoque", role: "stockist", isAdmin: false, branches: ["matriz", "shopping"] },
    { key: "finance", name: "Fernanda Financeiro", email: "financeiro@demo.intercert.local", login: "financeiro", role: "finance", isAdmin: false, branches: [] },
    { key: "fiscal", name: "Fábio Fiscal", email: "fiscal@demo.intercert.local", login: "fiscal", role: "fiscal", isAdmin: false, branches: [] },
    { key: "director", name: "Diana Diretora", email: "diretoria@demo.intercert.local", login: "diretoria", role: "manager", isAdmin: false, branches: [] },
  ];
  for (const u of userDefs) {
    const existing = await store.get("users", sd.id("users", u.key));
    let doc = existing;
    if (!doc) {
      doc = await sd.put("users", u.key, {
        name: u.name, email: u.email, login: u.login, status: "active", roleId: roles[u.role].id, isAdmin: u.isAdmin, companyIds: [companyId],
        branchIds: u.branches.map((b) => branches[b].id), isDemo: true, firstAccessAt: new Date().toISOString(),
      });
    }
    if (!doc.authId) {
      const authId = await auth.createUser(u.email, DEMO_PASSWORD, u.name);
      doc = await store.update("users", doc.id, { authId });
    }
    users[u.key] = doc;
  }

  const ctxFor = async (userKey: string, branchKey: string | null = "matriz"): Promise<Ctx> => ({
    store,
    companyId,
    branchId: branchKey ? branches[branchKey].id : null,
    user: await toCtxUser(store, (await store.get("users", users[userKey].id))!),
  });

  // Unidades, categorias, marcas
  for (const u of [["UN", "Unidade", 0], ["PC", "Peça", 0], ["CX", "Caixa", 0], ["KG", "Quilograma", 3], ["M", "Metro", 2], ["PAR", "Par", 0], ["H", "Hora", 2]] as const) {
    await sd.put("units", u[0], { ...base, code: u[0], name: u[1], decimals: u[2], status: "active" });
  }
  const categories: Record<string, Doc> = {};
  for (const c of ["Vestuário", "Calçados", "Acessórios", "Papelaria", "Eletrônicos", "Casa", "Serviços"]) {
    categories[c] = await sd.put("categories", c, { ...base, name: c, status: "active" });
  }
  const brands: Record<string, Doc> = {};
  for (const b of ["Intercert Basics", "Urbano", "Passo Firme", "Escrita+", "VoltTech", "Casa Bela"]) brands[b] = await sd.put("brands", b, { ...base, name: b, status: "active" });

  // Fiscal: grupos tributários (Simples Nacional)
  const tgSimples = await sd.put("tax_groups", "simples-102", {
    ...base, name: "Simples Nacional — revenda (CSOSN 102)", regime: "simples", cfopInternal: "5102", cfopInterstate: "6102", cfopReturn: "1202", cstCsosn: "102",
    icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0, active: true, notes: "Parâmetros de demonstração — validar com a contabilidade.",
  });
  const tgST = await sd.put("tax_groups", "simples-500", {
    ...base, name: "Simples Nacional — ICMS ST (CSOSN 500)", regime: "simples", cfopInternal: "5405", cfopInterstate: "6404", cfopReturn: "1411", cstCsosn: "500",
    icmsRateBps: 0, pisCst: "49", pisRateBps: 0, cofinsCst: "49", cofinsRateBps: 0, active: true, notes: "Demonstração.",
  });

  // Fornecedores
  const suppliers: Record<string, Doc> = {};
  const supplierDefs = [
    { key: "textil", name: "Têxtil Paulista Indústria Ltda", tradeName: "Têxtil Paulista", doc: "45997418000153", lead: 7, min: 50000, terms: "30/60 dias" },
    { key: "calcados", name: "Calçados Franca S.A.", tradeName: "Franca Calçados", doc: "60701190000104", lead: 10, min: 100000, terms: "28 dias" },
    { key: "papel", name: "Distribuidora Papel & Cia Ltda", tradeName: "Papel & Cia", doc: "33000167000101", lead: 3, min: 20000, terms: "À vista" },
    { key: "eletro", name: "VoltTech Eletrônicos Importação Ltda", tradeName: "VoltTech", doc: "02558157000162", lead: 14, min: 150000, terms: "30/60/90 dias" },
  ];
  for (const s of supplierDefs) {
    suppliers[s.key] = await sd.put("suppliers", s.key, {
      ...base, personType: "PJ", doc: s.doc, code: s.key.toUpperCase(), name: s.name, tradeName: s.tradeName, email: `vendas@${s.key}.example.com`, phone: "1130303030",
      addresses: [{ type: "comercial", street: "Rua Industrial", number: "200", district: "Distrito Industrial", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "03000000" }],
      contacts: [{ name: "Comercial", email: `vendas@${s.key}.example.com`, phone: "11930303030" }], paymentTermsText: s.terms, leadTimeDays: s.lead, minOrderValue: s.min,
      status: "active", searchText: searchable(s.name, s.tradeName, s.doc),
    });
  }

  // Tabelas de preço
  const priceTables: Record<string, Doc> = {
    varejo: await sd.put("price_tables", "varejo", { ...base, name: "Varejo", kind: "retail", active: true, isDefault: true }),
    atacado: await sd.put("price_tables", "atacado", { ...base, name: "Atacado / Revenda", kind: "wholesale", active: true, isDefault: false }),
  };
  for (const b of Object.values(branches)) if (!b.defaultPriceTableId) await store.update("branches", b.id, { defaultPriceTableId: priceTables.varejo.id });

  // Produtos
  const products: Record<string, Doc> = {};
  const skus: Record<string, Doc> = {};
  type PDef = { key: string; name: string; cat: string; brand: string; supplier?: string; unit: string; ncm: string; cost: number; price: number; wholesale?: number; wsMin?: number; tg?: Doc; variants?: Array<{ key: string; attrs: Record<string, string>; barcode: string }>; barcode?: string; type?: string; service?: Record<string, any>; min?: number; maxQty?: number; stock?: Record<string, number>; multiple?: number };
  const pdefs: PDef[] = [
    {
      key: "camiseta", name: "Camiseta Algodão Básica", cat: "Vestuário", brand: "Intercert Basics", supplier: "textil", unit: "UN", ncm: "61091000", cost: 1890, price: 4990, wholesale: 3990, wsMin: 10, min: 6, maxQty: 30, multiple: 4,
      variants: [
        { key: "p-preta", attrs: { Tamanho: "P", Cor: "Preta" }, barcode: "7891000100011" },
        { key: "m-preta", attrs: { Tamanho: "M", Cor: "Preta" }, barcode: "7891000100028" },
        { key: "g-preta", attrs: { Tamanho: "G", Cor: "Preta" }, barcode: "7891000100035" },
        { key: "m-branca", attrs: { Tamanho: "M", Cor: "Branca" }, barcode: "7891000100042" },
        { key: "g-branca", attrs: { Tamanho: "G", Cor: "Branca" }, barcode: "7891000100059" },
      ],
      stock: { matriz: 12, shopping: 8 },
    },
    { key: "calca", name: "Calça Jeans Slim", cat: "Vestuário", brand: "Urbano", supplier: "textil", unit: "UN", ncm: "62034200", cost: 6200, price: 15990, min: 3, maxQty: 15, variants: [
      { key: "38", attrs: { Tamanho: "38" }, barcode: "7891000200018" }, { key: "40", attrs: { Tamanho: "40" }, barcode: "7891000200025" }, { key: "42", attrs: { Tamanho: "42" }, barcode: "7891000200032" },
    ], stock: { matriz: 6, shopping: 4 } },
    { key: "tenis", name: "Tênis Casual Couro", cat: "Calçados", brand: "Passo Firme", supplier: "calcados", unit: "PAR", ncm: "64039190", cost: 11900, price: 27990, min: 2, maxQty: 10, variants: [
      { key: "39", attrs: { Número: "39" }, barcode: "7891000300015" }, { key: "40", attrs: { Número: "40" }, barcode: "7891000300022" }, { key: "41", attrs: { Número: "41" }, barcode: "7891000300039" }, { key: "42", attrs: { Número: "42" }, barcode: "7891000300046" },
    ], stock: { matriz: 4, shopping: 3 } },
    { key: "meia", name: "Meia Esportiva (kit 3 pares)", cat: "Acessórios", brand: "Passo Firme", supplier: "calcados", unit: "UN", ncm: "61159500", cost: 1100, price: 2990, wholesale: 2390, wsMin: 12, barcode: "7891000400012", min: 10, maxQty: 60, stock: { matriz: 40, shopping: 25 }, multiple: 12 },
    { key: "bone", name: "Boné Aba Curva", cat: "Acessórios", brand: "Urbano", supplier: "textil", unit: "UN", ncm: "65050090", cost: 1500, price: 4490, barcode: "7891000500019", min: 4, maxQty: 20, stock: { matriz: 15, shopping: 10 } },
    { key: "cinto", name: "Cinto de Couro", cat: "Acessórios", brand: "Urbano", supplier: "calcados", unit: "UN", ncm: "42033000", cost: 2400, price: 6990, barcode: "7891000500026", min: 3, maxQty: 12, stock: { matriz: 8, shopping: 2 } },
    { key: "caderno", name: "Caderno Universitário 10 matérias", cat: "Papelaria", brand: "Escrita+", supplier: "papel", unit: "UN", ncm: "48202000", cost: 990, price: 2490, wholesale: 1990, wsMin: 20, barcode: "7891000600013", min: 20, maxQty: 100, stock: { matriz: 60, shopping: 30 }, multiple: 10 },
    { key: "caneta", name: "Caneta Esferográfica Azul (cx 50)", cat: "Papelaria", brand: "Escrita+", supplier: "papel", unit: "CX", ncm: "96081000", cost: 2100, price: 4590, barcode: "7891000600020", min: 5, maxQty: 25, stock: { matriz: 18, shopping: 6 } },
    { key: "fone", name: "Fone de Ouvido Bluetooth", cat: "Eletrônicos", brand: "VoltTech", supplier: "eletro", unit: "UN", ncm: "85183000", cost: 5900, price: 14990, barcode: "7891000700010", min: 3, maxQty: 15, stock: { matriz: 7, shopping: 5 }, tg: tgST },
    { key: "carregador", name: "Carregador USB-C 20W", cat: "Eletrônicos", brand: "VoltTech", supplier: "eletro", unit: "UN", ncm: "85044010", cost: 2800, price: 7990, barcode: "7891000700027", min: 5, maxQty: 25, stock: { matriz: 1, shopping: 9 }, tg: tgST },
    { key: "caneca", name: "Caneca Cerâmica 350 ml", cat: "Casa", brand: "Casa Bela", unit: "UN", ncm: "69120000", cost: 1250, price: 3490, barcode: "7891000800017", min: 6, maxQty: 24, stock: { matriz: 20, shopping: 12 } },
    { key: "vela", name: "Vela Aromática", cat: "Casa", brand: "Casa Bela", unit: "UN", ncm: "34060000", cost: 1600, price: 4290, barcode: "7891000800024", stock: { matriz: 0, shopping: 0 } },
    { key: "ajuste", name: "Ajuste de barra (costura)", cat: "Serviços", brand: "Intercert Basics", unit: "UN", ncm: "", cost: 0, price: 2500, type: "service", service: { serviceListItem: "14.09", municipalServiceCode: "07498", issRateBps: 200 } },
    { key: "consultoria", name: "Consultoria de imagem (hora)", cat: "Serviços", brand: "Intercert Basics", unit: "H", ncm: "", cost: 0, price: 18000, type: "service", service: { serviceListItem: "17.01", municipalServiceCode: "03115", issRateBps: 500 } },
  ];
  const stockInits: Array<{ sku: Doc; branch: string; qty: number; cost: number; min?: number; max?: number; multiple?: number }> = [];
  for (const p of pdefs) {
    const product = await sd.put("products", p.key, {
      ...base, type: p.type ?? "product", code: p.key.toUpperCase(), name: p.name, description: `${p.name} — produto de demonstração.`, gtin: p.barcode ?? null, unitCode: p.unit,
      categoryId: categories[p.cat].id, brandId: brands[p.brand].id, supplierId: p.supplier ? suppliers[p.supplier].id : null, active: true, availablePdv: true, availableEcommerce: p.type !== "service",
      hasVariants: Boolean(p.variants), variantAxes: p.variants ? Object.keys(p.variants[0].attrs) : [], ncm: p.ncm || null, origin: "0", taxGroupId: p.type === "service" ? null : (p.tg ?? tgSimples).id,
      serviceListItem: p.service?.serviceListItem ?? null, municipalServiceCode: p.service?.municipalServiceCode ?? null, issRateBps: p.service?.issRateBps ?? null,
      searchText: searchable(p.name, p.key, p.barcode, p.brand, p.cat), status: "active",
    });
    products[p.key] = product;
    const variants = p.variants ?? [{ key: "u", attrs: {}, barcode: p.barcode ?? "" }];
    for (const v of variants) {
      const skuCode = p.variants ? `${p.key.toUpperCase()}-${v.key.toUpperCase()}` : p.key.toUpperCase();
      const name = p.variants ? `${p.name} ${Object.values(v.attrs).join(" ")}` : p.name;
      const sku = await sd.put("skus", `${p.key}-${v.key}`, {
        ...base, productId: product.id, sku: skuCode, barcode: v.barcode || null, attributes: v.attrs, name, unitCode: p.unit, active: true, costAcquisition: p.cost, costAdditional: 0, costTotal: p.cost,
        searchText: searchable(name, skuCode, v.barcode),
      });
      skus[`${p.key}-${v.key}`] = sku;
      await sd.put("prices", `varejo-${p.key}-${v.key}`, {
        ...base, priceTableId: priceTables.varejo.id, skuId: sku.id, productId: product.id, scopeKey: priceScopeKey(priceTables.varejo.id, sku.id, null, null), price: p.price,
        wholesalePrice: p.wholesale ?? null, wholesaleMinQty: p.wsMin ? p.wsMin * 1000 : null, maxDiscountBps: 1500,
      });
      await sd.put("prices", `atacado-${p.key}-${v.key}`, {
        ...base, priceTableId: priceTables.atacado.id, skuId: sku.id, productId: product.id, scopeKey: priceScopeKey(priceTables.atacado.id, sku.id, null, null), price: p.wholesale ?? Math.round(p.price * 0.85),
        maxDiscountBps: 500,
      });
      if (p.supplier) {
        await sd.put("supplier_products", `${p.supplier}-${p.key}-${v.key}`, {
          ...base, supplierId: suppliers[p.supplier].id, skuId: sku.id, supplierCode: `F-${skuCode}`, supplierDescription: name.toUpperCase(), conversionFactor: 1000, lastCost: p.cost,
          leadTimeDays: supplierDefs.find((s) => s.key === p.supplier)!.lead, minQty: (p.multiple ?? 1) * 1000, multiple: (p.multiple ?? 1) * 1000, preferred: true,
        });
      }
      if (p.type !== "service" && p.stock) {
        for (const [branch, q] of Object.entries(p.stock)) {
          const perVariant = p.variants ? Math.max(0, Math.round(q / variants.length) + (v.key.startsWith("m") ? 1 : 0)) : q;
          stockInits.push({ sku, branch, qty: perVariant, cost: p.cost, min: p.min, max: p.maxQty, multiple: p.multiple });
        }
      }
    }
  }
  const adminCtx = await ctxFor("admin", "matriz");
  for (const s of stockInits) {
    const wh = warehouses[`${s.branch}-main`];
    if (s.qty > 0) {
      await postMovements(adminCtx, [{ warehouseId: wh.id, skuId: s.sku.id, qty: s.qty * 1000, type: "initial", unitCost: s.cost, originType: "seed", reason: "Saldo inicial (demonstração)", idemKey: `seed-initial:${wh.id}:${s.sku.id}`, occurredAt: new Date(Date.now() - 70 * 86400000).toISOString() }]);
    } else {
      const { ensureBalance } = await import("../stock");
      await ensureBalance(store, adminCtx, wh.id, s.sku.id);
    }
    if (s.min) await store.update("stock_balances", balanceId(wh.id, s.sku.id), { minQty: Math.ceil(s.min / (s.sku.attributes && Object.keys(s.sku.attributes).length ? 2 : 1)) * 1000, maxQty: (s.max ?? 0) * 1000, reorderMultiple: (s.multiple ?? 1) * 1000 });
  }

  // Clientes
  const customers: Record<string, Doc> = {};
  const cdefs = [
    { key: "maria", personType: "PF", doc: "52998224725", name: "Maria Aparecida Souza", email: "maria.souza@example.com", mobile: "11987654321", birthDate: "1988-04-12", gender: "Feminino", vip: true, creditLimit: 150000, profession: "Professora" },
    { key: "joao", personType: "PF", doc: "11144477735", name: "João Pedro Lima", email: "joao.lima@example.com", mobile: "11976543210", birthDate: "1995-09-30", gender: "Masculino", vip: false, creditLimit: 80000, profession: "Analista" },
    { key: "ana", personType: "PF", doc: "39053344705", name: "Ana Beatriz Rocha", email: "ana.rocha@example.com", mobile: "11965432109", birthDate: "2001-01-20", gender: "Feminino", vip: false, creditLimit: 0, profession: "Estudante" },
    { key: "escola", personType: "PJ", doc: "19131243000197", name: "Escola Saber Mais Ltda", tradeName: "Colégio Saber Mais", email: "compras@sabermais.example.com", mobile: "1132221111", vip: true, creditLimit: 500000, ie: "ISENTO" },
    { key: "mercado", personType: "PJ", doc: "06990590000123", name: "Mercadinho Bom Preço Eireli", tradeName: "Bom Preço", email: "financeiro@bompreco.example.com", mobile: "1134445555", vip: false, creditLimit: 200000, ie: "110042490301" },
  ];
  for (const c of cdefs) {
    customers[c.key] = await sd.put("customers", c.key, {
      ...base, personType: c.personType, doc: c.doc, code: `C${String(Object.keys(customers).length + 1).padStart(4, "0")}`, name: c.name, tradeName: (c as any).tradeName ?? null, email: c.email,
      mobile: c.mobile, birthDate: (c as any).birthDate ?? null, gender: (c as any).gender ?? null, profession: (c as any).profession ?? null, vip: c.vip, finalConsumer: c.personType === "PF",
      acceptsPromotions: true, promoChannels: ["email", "whatsapp"], ie: (c as any).ie ?? null, ieIndicator: c.personType === "PJ" ? ((c as any).ie === "ISENTO" ? "2" : "1") : "9",
      addresses: [{ type: "principal", street: "Rua Augusta", number: String(100 + Object.keys(customers).length * 10), district: "Consolação", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "01305000" }],
      contacts: [], creditLimit: c.creditLimit, paymentTermDays: c.creditLimit ? 30 : 0, status: "active", searchText: searchable(c.name, c.doc, c.email, c.mobile, (c as any).tradeName), sellerId: users.manager.id,
    });
  }

  // Financeiro
  const accounts: Record<string, Doc> = {};
  const initDate = addDays(today(), -75);
  for (const a of [
    { key: "caixa-matriz", name: "Caixa — Matriz", kind: "cash", branch: "matriz", initial: 50000 },
    { key: "caixa-shopping", name: "Caixa — Shopping", kind: "cash", branch: "shopping", initial: 30000 },
    { key: "banco", name: "Banco Itaú — c/c 12345-6", kind: "bank", branch: null, initial: 4500000, bankCode: "341", agency: "0001", accountNumber: "12345-6" },
    { key: "pix", name: "Conta digital (Pix)", kind: "bank", branch: null, initial: 0, bankCode: "323", agency: "0001", accountNumber: "998877-1" },
  ]) {
    accounts[a.key] = await sd.put("financial_accounts", a.key, {
      ...base, branchId: a.branch ? branches[a.branch].id : null, name: a.name, kind: a.kind, bankCode: (a as any).bankCode ?? null, agency: (a as any).agency ?? null, accountNumber: (a as any).accountNumber ?? null,
      initialBalance: a.initial, initialBalanceDate: initDate, balance: a.initial, seq: 0, active: true,
    });
  }
  const methods: Record<string, Doc> = {};
  for (const [i, m] of [
    { key: "dinheiro", name: "Dinheiro", kind: "cash", account: "caixa-matriz", allowsChange: true },
    { key: "debito", name: "Cartão de débito", kind: "debit", feeBps: 129, days: 1 },
    { key: "credito", name: "Cartão de crédito", kind: "credit", feeBps: 309, days: 30, maxInst: 6 },
    { key: "pix", name: "Pix", kind: "pix", account: "pix" },
    { key: "crediario", name: "Crediário próprio", kind: "crediario", requiresCustomer: true },
    { key: "boleto", name: "Boleto", kind: "boleto", requiresCustomer: true, account: "banco" },
    { key: "vale", name: "Vale-crédito", kind: "store_credit" },
  ].entries()) {
    methods[m.key] = await sd.put("payment_methods", m.key, {
      ...base, name: m.name, kind: m.kind, accountId: m.account ? accounts[m.account].id : null, feeBps: (m as any).feeBps ?? 0, settlementDays: (m as any).days ?? 0, allowsChange: Boolean((m as any).allowsChange),
      requiresCustomer: Boolean((m as any).requiresCustomer), maxInstallments: (m as any).maxInst ?? 1, active: true, sortOrder: i, availablePdv: true,
    });
  }
  const terms: Record<string, Doc> = {};
  for (const t of [
    { key: "avista", name: "À vista", installments: 1, first: 0, interval: 30 },
    { key: "30", name: "30 dias", installments: 1, first: 30, interval: 30 },
    { key: "30-60", name: "30/60 dias", installments: 2, first: 30, interval: 30 },
    { key: "30-60-90", name: "30/60/90 dias", installments: 3, first: 30, interval: 30 },
    { key: "28", name: "28 dias", installments: 1, first: 28, interval: 28 },
    { key: "crediario-3x", name: "Crediário 3x sem juros", installments: 3, first: 30, interval: 30 },
  ]) {
    terms[t.key] = await sd.put("payment_terms", t.key, { ...base, name: t.name, installments: t.installments, firstDueDays: t.first, intervalDays: t.interval, interestBps: 0, active: true, kind: "both" });
  }
  const finCategories: Record<string, Doc> = {};
  for (const c of [
    { key: "vendas", name: "Receita de vendas", type: "revenue", dre: "Receita bruta" },
    { key: "servicos", name: "Receita de serviços", type: "revenue", dre: "Receita bruta" },
    { key: "outras-receitas", name: "Outras receitas", type: "revenue", dre: "Outras receitas" },
    { key: "compras", name: "Compra de mercadorias", type: "expense", dre: "CMV" },
    { key: "aluguel", name: "Aluguel", type: "expense", dre: "Despesas operacionais" },
    { key: "energia", name: "Energia elétrica", type: "expense", dre: "Despesas operacionais" },
    { key: "salarios", name: "Salários e encargos", type: "expense", dre: "Despesas com pessoal" },
    { key: "tarifas", name: "Tarifas bancárias e taxas de cartão", type: "expense", dre: "Despesas financeiras" },
    { key: "impostos", name: "Impostos (DAS)", type: "expense", dre: "Deduções" },
    { key: "frete", name: "Fretes", type: "expense", dre: "Despesas operacionais" },
  ]) {
    finCategories[c.key] = await sd.put("fin_categories", c.key, { ...base, name: c.name, type: c.type, dreGroup: c.dre, active: true });
  }
  const costCenters: Record<string, Doc> = {};
  for (const c of [{ key: "loja-matriz", name: "Loja Matriz", code: "100" }, { key: "loja-shopping", name: "Loja Shopping", code: "200" }, { key: "adm", name: "Administrativo", code: "900" }]) {
    costCenters[c.key] = await sd.put("cost_centers", c.key, { ...base, name: c.name, code: c.code, active: true });
  }
  const { setSetting } = await import("@/lib/core/settings");
  await setSetting(store, companyId, null, "finance.category.sales", finCategories.vendas.id);
  await setSetting(store, companyId, null, "finance.category.purchases", finCategories.compras.id);
  await setSetting(store, companyId, null, "finance.category.fees", finCategories.tarifas.id);

  // Fiscal e integrações (SIMULAÇÃO)
  for (const b of Object.values(branches)) {
    const sk = `${companyId}|${b.id}`;
    await store.get("fiscal_configs", detId("fiscalcfg", sk)).then((x) =>
      x
        ? x
        : store.create(
            "fiscal_configs",
            {
              ...base, branchId: b.id, scopeKey: sk, provider: "simulated", environment: "homologacao", tokenRef: "FOCUSNFE_TOKEN", nfeEnabled: true, nfceEnabled: true, nfseEnabled: true,
              nfeSeries: 1, nfeNextNumber: 1, nfceSeries: 1, nfceNextNumber: 1, nfseSeries: "1", rpsNextNumber: 1, nfseStandard: "nacional", cscId: "000001", cscTokenRef: "NFCE_CSC",
              contingency: false, defaultPresence: "1", defaultTaxGroupId: tgSimples.id, connectionStatus: "configured_untested", certificate: null,
              lastTestResult: null,
            },
            detId("fiscalcfg", sk),
          ),
    );
  }
  const { saveIntegration } = await import("../integrations");
  for (const [kind, provider] of [["pix", "simulated"], ["fiscal_nfe", "simulated"], ["fiscal_nfse", "simulated"], ["card_tef", "manual_pos"], ["bank", "file_import"]] as const) {
    const sk = `${companyId}|*|${kind}`;
    if (!(await store.get("integrations", detId("integration", sk)))) {
      await saveIntegration(adminCtx, { kind, branchId: null, provider, environment: "homologacao", config: kind === "card_tef" ? { acquirer: "Adquirente demonstração", debitFeeBps: 129, creditFeeBps: 309 } : {} });
    }
  }

  // Metas do mês corrente e anterior
  const period = monthStart(today()).slice(0, 7);
  for (const b of Object.entries(branches)) {
    await sd.put("goals", `${b[0]}-${period}-revenue`, { ...base, branchId: b[1].id, period, metric: "revenue", target: b[0] === "matriz" ? 3500000 : 2000000 });
    await sd.put("goals", `${b[0]}-${period}-count`, { ...base, branchId: b[1].id, period, metric: "sales_count", target: b[0] === "matriz" ? 200 : 120 });
  }

  return { ctxFor, company, branches, warehouses, terminals, users, accounts, methods, terms, categories, finCategories, costCenters, skus, products, customers, suppliers, priceTables, seeder: sd };
}
