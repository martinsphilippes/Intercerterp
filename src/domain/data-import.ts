import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError, PermissionError } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { can, canDo } from "@/lib/permissions";
import { normalizeSearch } from "@/lib/list";
import { nowIso, parseDateInput, startOfLocalDay, today } from "@/lib/dates";
import { formatMoney, formatQty, parseMoney, parseQty } from "@/lib/money";
import { formatDoc, onlyDigits } from "@/lib/core/text";
import { analyzeCsvFor, assertMapping, csvTemplate, mappedValues, parseCsv, type ImportField } from "./csv-import";
import { canGrantCredit, createCustomer, normalizeDoc, type CustomerInput } from "./customers";
import { createSupplier, normalizeSupplierDoc, type SupplierInput } from "./suppliers";
import { normalizeSkuCode, postInitialBalance } from "./products";
import { balanceId, defaultWarehouse } from "./stock";
import { createTitle, titleId, type TitleKind } from "./finance";
import { UFS } from "./companies";

/**
 * Importação de cadastros e saldos de implantação (PLA-19): clientes, fornecedores, saldos iniciais de estoque e
 * títulos em aberto (a receber e a pagar), por CSV. Reutiliza o motor de `csv-import.ts` (o mesmo da importação de
 * produtos) e os serviços de cada cadastro — `createCustomer`, `createSupplier`, `postInitialBalance` (movimento
 * `initial` com custo) e `finance.createTitle` —, sem gravação paralela:
 *  - prévia linha a linha sem gravar nada (criar / ignorar / erro, com o motivo);
 *  - aplicação em lotes de até 100 linhas, cada linha na sua própria transação (≤ 100 operações por transação: um
 *    cadastro, um movimento + saldo, ou um título + 1 parcela); o progresso é gravado no fim de cada lote e reenviar o
 *    mesmo lote (mesma chave) retoma de onde parou;
 *  - idempotente por conteúdo: cada linha tem uma chave natural (CPF/CNPJ, código, SKU × depósito, título) e linhas
 *    já importadas — ou já cadastradas — viram "ignorar" ao importar o arquivo de novo;
 *  - o lote fica em `product_imports` com `kind` (ausente = importação de produtos), com o resultado por linha.
 */

export type DataImportKind = "customers" | "suppliers" | "stock" | "receivables" | "payables";
export type DataImportAction = "create" | "skip" | "error";

export const MAX_DATA_IMPORT_ROWS = 1000;
/** Linhas por lote (o progresso é gravado ao fim de cada lote). */
export const IMPORT_BATCH_SIZE = 100;

export interface DataImportRowResult {
  line: number;
  key: string;
  name?: string;
  action: DataImportAction;
  entityId?: string | null;
  messages: string[];
}

export interface DataImportDef {
  kind: DataImportKind;
  label: string;
  description: string;
  fields: ImportField[];
  /** grupos de campos obrigatórios no mapeamento (cada grupo: ao menos um dos campos) */
  required: string[][];
  template: string;
}

const partyFields = (who: string): ImportField[] => [
  { key: "personType", label: "Tipo de pessoa (PF/PJ)", aliases: ["tipo", "tipo pessoa", "tipo de pessoa", "pessoa", "pf pj", "fisica juridica"] },
  { key: "doc", label: "CPF/CNPJ", aliases: ["cpf cnpj", "cpf", "cnpj", "doc", "cnpj cpf", "documento"] },
  { key: "code", label: "Código", aliases: ["codigo", "cod", "code", `codigo ${who}`, `cod ${who}`] },
  { key: "name", label: "Nome / razão social", aliases: ["nome", "razao social", "name", who, "nome razao social", "razao"] },
  { key: "tradeName", label: "Nome fantasia", aliases: ["fantasia", "nome fantasia", "apelido"] },
  { key: "email", label: "E-mail", aliases: ["email", "e mail", "correio eletronico"] },
  { key: "phone", label: "Telefone", aliases: ["telefone", "fone", "phone", "tel", "telefone fixo"] },
  { key: "ie", label: "Inscrição estadual", aliases: ["ie", "inscricao estadual", "insc estadual", "rg ie"] },
  { key: "zip", label: "CEP", aliases: ["cep"] },
  { key: "street", label: "Logradouro", aliases: ["endereco", "logradouro", "rua"] },
  { key: "number", label: "Número", aliases: ["numero", "num", "nro", "n"] },
  { key: "complement", label: "Complemento", aliases: ["complemento"] },
  { key: "district", label: "Bairro", aliases: ["bairro"] },
  { key: "cityName", label: "Cidade", aliases: ["cidade", "municipio"] },
  { key: "cityCode", label: "Código IBGE do município", aliases: ["ibge", "codigo ibge", "cod municipio", "codigo municipio", "cod ibge"] },
  { key: "uf", label: "UF", aliases: ["uf", "estado"] },
  { key: "notes", label: "Observações", aliases: ["observacao", "observacoes", "obs", "notas"] },
];

const titleFields = (who: "cliente" | "fornecedor"): ImportField[] => [
  { key: "doc", label: `CPF/CNPJ do ${who}`, aliases: ["cpf cnpj", "cpf", "cnpj", "doc", "cnpj cpf", `cpf cnpj ${who}`, `cnpj ${who}`, `cpf ${who}`] },
  { key: "partyName", label: `Nome do ${who}`, aliases: ["nome", who, "razao social", who === "cliente" ? "sacado" : "favorecido", who === "cliente" ? "pagador" : "credor"] },
  { key: "documentNumber", label: "Nº do documento", aliases: ["documento", "numero documento", "n documento", "nota", "nf", "numero", "duplicata", "titulo", "num documento"] },
  { key: "installment", label: "Parcela (ex.: 1/3)", aliases: ["parcela", "parc", "prestacao"] },
  { key: "description", label: "Descrição / histórico", aliases: ["descricao", "historico", "description"] },
  { key: "issueDate", label: "Emissão", aliases: ["emissao", "data emissao", "data de emissao", "data"] },
  { key: "dueDate", label: "Vencimento", aliases: ["vencimento", "data vencimento", "vencto", "data de vencimento", "venc"] },
  { key: "amount", label: "Valor em aberto (R$)", aliases: ["valor", "valor aberto", "valor em aberto", "saldo", "saldo em aberto", "valor original"] },
  { key: "category", label: "Categoria financeira", aliases: ["categoria", "plano de contas", "conta", "natureza"] },
  { key: "competenceDate", label: "Competência", aliases: ["competencia", "data competencia"] },
];

export const DATA_IMPORTS: DataImportDef[] = [
  {
    kind: "customers",
    label: "Clientes",
    description: "Cadastro de clientes (PF/PJ) com documento, contatos e endereço principal. CPF/CNPJ já cadastrado é ignorado.",
    fields: [
      ...partyFields("cliente"),
      { key: "mobile", label: "Celular / WhatsApp", aliases: ["celular", "whatsapp", "movel", "mobile", "cel"] },
      { key: "birthDate", label: "Data de nascimento", aliases: ["nascimento", "data nascimento", "data de nascimento", "aniversario"] },
      { key: "creditLimit", label: "Limite de crédito (R$)", aliases: ["limite", "limite de credito", "limite credito", "credito"] },
    ],
    required: [["name"]],
    template: csvTemplate(
      ["Tipo", "CPF/CNPJ", "Código", "Nome", "Fantasia", "E-mail", "Telefone", "Celular", "Nascimento", "IE", "CEP", "Logradouro", "Número", "Complemento", "Bairro", "Cidade", "Código IBGE", "UF", "Limite de crédito", "Observações"],
      [
        ["PF", "529.982.247-25", "", "Maria Aparecida Souza", "", "maria@exemplo.com.br", "", "(11) 98888-7777", "15/03/1985", "", "01310-100", "Av. Paulista", "1000", "ap. 12", "Bela Vista", "São Paulo", "3550308", "SP", "0,00", ""],
        ["PJ", "11.444.777/0001-61", "", "Papelaria Modelo Ltda", "Papelaria Modelo", "compras@modelo.com.br", "(11) 3333-4444", "", "", "ISENTO", "", "", "", "", "", "", "", "SP", "", "Cliente migrado do sistema anterior"],
      ],
    ),
  },
  {
    kind: "suppliers",
    label: "Fornecedores",
    description: "Cadastro de fornecedores (e transportadoras) com documento, contato, endereço e condições. CPF/CNPJ já cadastrado é ignorado.",
    fields: [
      ...partyFields("fornecedor"),
      { key: "category", label: "Categoria", aliases: ["categoria", "segmento", "tipo fornecedor"] },
      { key: "leadTimeDays", label: "Prazo de entrega (dias)", aliases: ["prazo entrega", "prazo de entrega", "lead time", "entrega dias"] },
      { key: "paymentTermsText", label: "Condição de pagamento (texto)", aliases: ["condicao pagamento", "condicao de pagamento", "prazo pagamento", "prazo de pagamento"] },
    ],
    required: [["name"]],
    template: csvTemplate(
      ["Tipo", "CPF/CNPJ", "Código", "Razão social", "Fantasia", "E-mail", "Telefone", "IE", "CEP", "Logradouro", "Número", "Complemento", "Bairro", "Cidade", "Código IBGE", "UF", "Categoria", "Prazo de entrega", "Condição de pagamento", "Observações"],
      [["PJ", "11.222.333/0001-81", "", "Distribuidora Exemplo S.A.", "Exemplo Distribuidora", "vendas@exemplo.com.br", "(11) 2222-3333", "123456789110", "06454-000", "Al. Rio Negro", "500", "", "Alphaville", "Barueri", "3505708", "SP", "Mercadorias", "7", "28 dias", ""]],
    ),
  },
  {
    kind: "stock",
    label: "Saldos iniciais de estoque",
    description: "Saldo de implantação por SKU e depósito da filial atual (movimento “Saldo inicial” com custo). Só para saldos ainda sem movimento; depois, use ajuste ou inventário.",
    fields: [
      { key: "sku", label: "SKU / código do produto", aliases: ["sku", "referencia", "ref", "codigo", "cod", "codigo produto", "cod produto"] },
      { key: "barcode", label: "GTIN / EAN", aliases: ["ean", "gtin", "codigo de barras", "cod barras", "barcode", "ean13"] },
      { key: "warehouse", label: "Depósito (código ou nome)", aliases: ["deposito", "almoxarifado", "warehouse", "local estoque"] },
      { key: "qty", label: "Quantidade", aliases: ["quantidade", "qtd", "qtde", "saldo", "estoque", "saldo inicial"] },
      { key: "unitCost", label: "Custo unitário (R$)", aliases: ["custo", "custo unitario", "custo medio", "preco de custo", "valor unitario", "custo unit"] },
      { key: "date", label: "Data do saldo", aliases: ["data", "data saldo", "data do saldo", "data base"] },
      { key: "documentRef", label: "Documento / referência", aliases: ["referencia documento", "documento", "doc referencia"] },
    ],
    required: [["sku", "barcode"], ["qty"]],
    template: csvTemplate(["SKU", "EAN", "Depósito", "Quantidade", "Custo unitário", "Data do saldo", "Documento"], [["CADERNO-U", "", "", "25", "12,40", "31/12/2025", "Inventário de implantação"]]),
  },
  {
    kind: "receivables",
    label: "Títulos a receber em aberto",
    description: "Parcelas a receber do sistema anterior (uma linha = um título com uma parcela). Cliente pelo CPF/CNPJ cadastrado ou só pelo nome (pagador avulso).",
    fields: titleFields("cliente"),
    required: [["dueDate"], ["amount"], ["doc", "partyName"]],
    template: csvTemplate(["CPF/CNPJ", "Nome", "Documento", "Parcela", "Descrição", "Emissão", "Vencimento", "Valor", "Categoria"], [["529.982.247-25", "Maria Aparecida Souza", "VD-1020", "2/3", "Crediário migrado", "10/09/2026", "10/11/2026", "150,00", ""]]),
  },
  {
    kind: "payables",
    label: "Títulos a pagar em aberto",
    description: "Contas a pagar do sistema anterior (uma linha = um título com uma parcela, aguardando autorização como os demais). Fornecedor pelo CPF/CNPJ cadastrado ou só pelo nome (favorecido avulso).",
    fields: titleFields("fornecedor"),
    required: [["dueDate"], ["amount"], ["doc", "partyName"]],
    template: csvTemplate(["CPF/CNPJ", "Fornecedor", "Documento", "Parcela", "Descrição", "Emissão", "Vencimento", "Valor", "Categoria"], [["11.222.333/0001-81", "Distribuidora Exemplo S.A.", "NF 4512", "1/1", "Compra de mercadorias", "01/10/2026", "30/10/2026", "2.350,00", ""]]),
  },
];

export const DATA_IMPORT_LABEL: Record<DataImportKind, string> = Object.fromEntries(DATA_IMPORTS.map((d) => [d.kind, d.label])) as Record<DataImportKind, string>;

export function dataImportDef(kind: string): DataImportDef {
  const d = DATA_IMPORTS.find((x) => x.kind === kind);
  if (!d) throw new BusinessError("Tipo de importação desconhecido.", "invalid");
  return d;
}

/** Permissões: módulo Administração (criar) — só administradores importam — e a de criar no cadastro de destino. */
export function canImport(ctx: Pick<Ctx, "user">, kind: DataImportKind): boolean {
  if (!can(ctx.user, "admin", "create")) return false;
  switch (kind) {
    case "customers":
      return can(ctx.user, "customers", "create");
    case "suppliers":
      return can(ctx.user, "suppliers", "create");
    case "stock":
      return canDo(ctx.user, "stock.adjust") || can(ctx.user, "stock", "create");
    default:
      return can(ctx.user, "finance", "create");
  }
}

function requireImport(ctx: Ctx, kind: DataImportKind) {
  requirePerm(ctx, "admin", "create");
  if (!canImport(ctx, kind)) throw new PermissionError(`Você não tem permissão para importar ${DATA_IMPORT_LABEL[kind].toLowerCase()}.`);
}

/** Leitura inicial do arquivo (cabeçalhos, amostra, mapeamento sugerido) — nada é gravado. */
export function analyzeDataCsv(kind: DataImportKind, text: string) {
  return analyzeCsvFor(text, dataImportDef(kind).fields, MAX_DATA_IMPORT_ROWS);
}

// ───────────────────────────── Leitura de valores

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function dateOf(v: string, label: string, errors: string[]): string | null {
  if (!v) return null;
  try {
    const d = parseDateInput(v);
    if (d && isIsoDate(d)) return d;
  } catch {
    /* abaixo */
  }
  errors.push(`${label} inválida ("${v}") — use dd/mm/aaaa.`);
  return null;
}

function moneyOf(v: string, label: string, errors: string[]): number | null {
  if (!v) return null;
  try {
    const n = parseMoney(v);
    if (n < 0) errors.push(`${label} negativo.`);
    else return n;
  } catch {
    errors.push(`${label} inválido ("${v}").`);
  }
  return null;
}

const personTypeOf = (v: string, doc: string): "PF" | "PJ" => {
  const n = normalizeSearch(v);
  if (["pj", "juridica", "pessoa juridica", "j", "empresa"].includes(n)) return "PJ";
  if (["pf", "fisica", "pessoa fisica", "f"].includes(n)) return "PF";
  return doc.length === 14 ? "PJ" : "PF";
};

const docLabel = (t: "PF" | "PJ") => (t === "PJ" ? "CNPJ" : "CPF");

// ───────────────────────────── Planejamento (validação sem gravar)

interface PlannedRow {
  result: DataImportRowResult;
  apply?: (ctx: Ctx, rec: Doc) => Promise<{ id: string; message: string }>;
}

interface PlanInput {
  kind: DataImportKind;
  text: string;
  mapping: Record<string, string>;
}

async function plan(ctx: Ctx, input: PlanInput): Promise<PlannedRow[]> {
  const def = dataImportDef(input.kind);
  const { rows } = parseCsv(input.text);
  assert(rows.length > 0, "O arquivo não tem linhas de dados.");
  assert(rows.length <= MAX_DATA_IMPORT_ROWS, `Máximo de ${MAX_DATA_IMPORT_ROWS} linhas por importação (o arquivo tem ${rows.length}).`);
  const mapped = assertMapping(input.mapping);
  const labelOf = (k: string) => def.fields.find((f) => f.key === k)?.label ?? k;
  for (const group of def.required) assert(group.some((k) => mapped.has(k)), `Mapeie a coluna ${group.map(labelOf).join(" ou ")}.`);
  const valuesOf = rows.map((cells, i) => ({ line: i + 2, v: mappedValues(cells, input.mapping) }));
  switch (input.kind) {
    case "customers":
    case "suppliers":
      return planParties(ctx, input.kind, valuesOf);
    case "stock":
      return planStock(ctx, valuesOf);
    default:
      return planTitles(ctx, input.kind, valuesOf);
  }
}

type Lines = Array<{ line: number; v: Record<string, string> }>;

async function planParties(ctx: Ctx, kind: "customers" | "suppliers", lines: Lines): Promise<PlannedRow[]> {
  const collection = kind;
  const existing = await listAll(ctx.store, collection, { filters: [["eq", "companyId", ctx.companyId]] });
  const byDoc = new Map(existing.filter((d) => d.doc).map((d) => [String(d.doc), d]));
  const byCode = new Map(existing.filter((d) => d.code).map((d) => [String(d.code).toUpperCase(), d]));
  const byId = new Map(existing.map((d) => [d.id, d]));
  const byName = new Map(existing.map((d) => [normalizeSearch(d.name ?? ""), d]));
  const seen = new Map<string, number>();
  const who = kind === "customers" ? "cliente" : "fornecedor";
  const grant = canGrantCredit(ctx);
  return lines.map(({ line, v }) => {
    const errors: string[] = [];
    const notes: string[] = [];
    const digits = onlyDigits(v.doc);
    const personType = personTypeOf(v.personType ?? "", digits);
    let doc: string | null = null;
    if (digits) {
      try {
        doc = kind === "customers" ? normalizeDoc(personType, digits) : normalizeSupplierDoc(personType, digits);
      } catch {
        errors.push(`${docLabel(personType)} ${v.doc} inválido.`);
      }
    }
    const name = (v.name ?? "").trim().slice(0, 200);
    if (!name) errors.push(`Nome/razão social obrigatório.`);
    const code = (v.code ?? "").trim().toUpperCase().slice(0, 40) || null;
    const email = (v.email ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`E-mail "${v.email}" inválido.`);
    const uf = (v.uf ?? "").trim().toUpperCase();
    if (uf && !UFS.includes(uf)) errors.push(`UF "${v.uf}" inválida.`);
    const zip = onlyDigits(v.zip);
    if (v.zip && zip.length !== 8) errors.push(`CEP "${v.zip}" inválido.`);
    const cityCode = onlyDigits(v.cityCode);
    if (v.cityCode && cityCode.length !== 7) errors.push(`Código IBGE "${v.cityCode}" deve ter 7 dígitos.`);
    const birthDate = kind === "customers" ? dateOf(v.birthDate ?? "", "Data de nascimento", errors) : null;
    const creditLimit = kind === "customers" ? (moneyOf(v.creditLimit ?? "", "Limite de crédito", errors) ?? 0) : 0;
    if (creditLimit > 0 && !grant) errors.push("Limite de crédito exige a permissão “Conceder/alterar limite de crédito”.");
    let leadTimeDays: number | null = null;
    if (kind === "suppliers" && v.leadTimeDays) {
      const n = Number(onlyDigits(v.leadTimeDays));
      if (!/^\d+$/.test(v.leadTimeDays.trim())) errors.push(`Prazo de entrega "${v.leadTimeDays}" inválido (dias inteiros).`);
      else leadTimeDays = n;
    }
    // chave natural da linha (idempotência por conteúdo)
    const key = doc ? `doc:${doc}` : code ? `code:${code}` : `name:${normalizeSearch(name)}|${email || onlyDigits(v.mobile) || onlyDigits(v.phone)}`;
    const shown = doc ? `${docLabel(personType)} ${formatDoc(doc)}` : code ? `código ${code}` : "(sem documento)";
    const result: DataImportRowResult = { line, key: shown, name: name || undefined, action: "error", entityId: null, messages: errors };
    const prev = seen.get(key);
    if (prev) errors.push(`Linha repetida no arquivo (mesmo ${doc ? docLabel(personType) : code ? "código" : "nome"} da linha ${prev}).`);
    else seen.set(key, line);
    if (errors.length) return { result };
    const idemKey = `dimport:${key}`;
    const detIdOf = detId(kind === "customers" ? "customer" : "supplier", ctx.companyId, "idem", idemKey);
    const hit = (doc && byDoc.get(doc)) || (code && byCode.get(code)) || byId.get(detIdOf);
    if (hit) {
      result.action = "skip";
      result.entityId = hit.id;
      result.messages = [`Já cadastrado: ${hit.code ? `${hit.code} — ` : ""}${hit.tradeName || hit.name}.`];
      return { result };
    }
    if (!doc && byName.get(normalizeSearch(name))) notes.push(`há outro ${who} com o mesmo nome (sem documento nesta linha) — confira se não é o mesmo`);
    const status = personType === "PJ" && !doc ? "draft" : kind === "suppliers" && !doc ? "draft" : "active";
    if (status === "draft") notes.push(`sem ${docLabel(personType)}: entra como rascunho para completar depois`);
    result.action = "create";
    result.messages = [`Novo ${who}${notes.length ? ` (${notes.join("; ")})` : ""}.`];
    const address = v.street || zip || v.cityName ? [{ type: "principal", zip: zip || undefined, street: v.street || undefined, number: v.number || undefined, complement: v.complement || undefined, district: v.district || undefined, cityName: v.cityName || undefined, cityCode: cityCode || undefined, uf: uf || undefined }] : [];
    return {
      result,
      apply: async (c, rec) => {
        if (kind === "customers") {
          const inputC: CustomerInput = {
            personType, doc, code, name, tradeName: v.tradeName || null, email: email || null, phone: v.phone || null, mobile: v.mobile || null, birthDate,
            ie: v.ie || null, addresses: address, creditLimit, notes: v.notes || `Importado (importação nº ${rec.number})`, status: status as "active" | "draft",
          };
          const cst = await createCustomer(c, inputC, { idemKey });
          return { id: cst.id, message: `Cadastrado: ${cst.code} — ${cst.name}${status === "draft" ? " (rascunho)" : ""}.` };
        }
        const inputS: SupplierInput = {
          personType, doc, code, name, tradeName: v.tradeName || null, email: email || null, phone: v.phone || null, ie: v.ie || null, addresses: address,
          category: v.category || null, leadTimeDays, paymentTermsText: v.paymentTermsText || null, notes: v.notes || `Importado (importação nº ${rec.number})`, status: status as "active" | "draft",
        };
        const sup = await createSupplier(c, inputS, { idemKey, source: `importação nº ${rec.number}` });
        return { id: sup.id, message: `Cadastrado: ${sup.code} — ${sup.tradeName || sup.name}${status === "draft" ? " (rascunho)" : ""}.` };
      },
    };
  });
}

async function planStock(ctx: Ctx, lines: Lines): Promise<PlannedRow[]> {
  const branchId = ctx.branchId;
  const [skus, products, warehouses] = await Promise.all([
    listAll(ctx.store, "skus", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "products", { filters: [["eq", "companyId", ctx.companyId]] }),
    branchId ? listAll(ctx.store, "warehouses", { filters: [["eq", "companyId", ctx.companyId], ["eq", "branchId", branchId]] }) : Promise.resolve([] as Doc[]),
  ]);
  const product = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map(skus.map((s) => [String(s.sku).toUpperCase(), s]));
  const byBarcode = new Map<string, Doc>();
  for (const s of skus) {
    if (s.barcode) byBarcode.set(String(s.barcode), s);
    for (const b of s.extraBarcodes ?? []) byBarcode.set(String(b), s);
  }
  const skusOf = new Map<string, Doc[]>();
  for (const s of skus) skusOf.set(s.productId, [...(skusOf.get(s.productId) ?? []), s]);
  const byProductCode = new Map(products.filter((p) => p.code).map((p) => [String(p.code).toUpperCase(), p]));
  const whByKey = new Map<string, Doc>();
  for (const w of warehouses) {
    if (w.code) whByKey.set(String(w.code).toUpperCase(), w);
    whByKey.set(normalizeSearch(w.name ?? ""), w);
  }
  const defaultWh = branchId ? await defaultWarehouse(ctx.store, branchId).catch(() => null) : null;
  const hoje = today();
  const seen = new Map<string, number>();
  const out: PlannedRow[] = [];
  for (const { line, v } of lines) {
    const errors: string[] = [];
    const notes: string[] = [];
    const code = (v.sku ?? "").trim();
    let sku: Doc | undefined;
    if (code) sku = bySku.get(normalizeSkuCode(code)) ?? bySku.get(code.toUpperCase());
    if (!sku && code) {
      const p = byProductCode.get(code.toUpperCase());
      const list = p ? (skusOf.get(p.id) ?? []) : [];
      if (list.length === 1) sku = list[0];
      else if (list.length > 1) errors.push(`O produto ${code} tem ${list.length} variações: informe o SKU da variação.`);
    }
    if (!sku && v.barcode) sku = byBarcode.get(v.barcode.replace(/\s/g, ""));
    const p = sku ? product.get(sku.productId) : undefined;
    if (!sku && !errors.length) errors.push(`Produto não encontrado (${[code && `SKU/código ${code}`, v.barcode && `GTIN ${v.barcode}`].filter(Boolean).join(", ") || "sem código"}).`);
    if (p?.type === "service") errors.push("Serviço não tem estoque.");
    if (p?.composition === "kit") errors.push("Kit não tem estoque próprio (o estoque é dos componentes).");
    if (!branchId) errors.push("Selecione uma filial (o saldo inicial entra num depósito da filial atual).");
    let wh: Doc | null | undefined = defaultWh;
    if (v.warehouse) {
      wh = whByKey.get(v.warehouse.trim().toUpperCase()) ?? whByKey.get(normalizeSearch(v.warehouse));
      if (!wh) errors.push(`Depósito "${v.warehouse}" não encontrado na filial atual.`);
    } else if (branchId && !wh) errors.push("A filial não tem depósito padrão: informe o depósito.");
    let qty = 0;
    if (!v.qty) errors.push("Quantidade obrigatória.");
    else {
      try {
        qty = parseQty(v.qty);
        if (qty <= 0) errors.push("A quantidade deve ser maior que zero.");
      } catch {
        errors.push(`Quantidade inválida ("${v.qty}").`);
      }
    }
    const unitCost = moneyOf(v.unitCost ?? "", "Custo unitário", errors);
    const date = dateOf(v.date ?? "", "Data do saldo", errors);
    if (date && date > hoje) errors.push("A data do saldo não pode ser futura.");
    const key = sku && wh ? `${sku.sku} · ${wh.name}` : code || v.barcode || "(sem chave)";
    const result: DataImportRowResult = { line, key, name: sku?.name ?? p?.name, action: "error", entityId: p?.id ?? null, messages: errors };
    if (sku && wh) {
      const k = `${sku.id}:${wh.id}`;
      const prev = seen.get(k);
      if (prev) errors.push(`SKU e depósito repetidos no arquivo (linha ${prev}).`);
      else seen.set(k, line);
    }
    if (errors.length || !sku || !wh) {
      out.push({ result });
      continue;
    }
    const bid = balanceId(wh.id, sku.id);
    const initial = await ctx.store.get("stock_movements", detId("mov", `initial:${bid}`));
    if (initial) {
      result.action = "skip";
      result.messages = [`Saldo inicial já lançado (${formatQty(initial.qty)} ${sku.unitCode ?? ""} a ${formatMoney(initial.unitCost)}).`];
      out.push({ result });
      continue;
    }
    const bal = await ctx.store.get("stock_balances", bid);
    if (bal?.seq) {
      result.messages = ["Este saldo já tem movimentos: use um ajuste de estoque ou inventário."];
      out.push({ result });
      continue;
    }
    const cost = unitCost ?? (sku.costTotal as number) ?? 0;
    if (unitCost == null) notes.push(`custo do cadastro ${formatMoney(cost)}`);
    if (p?.lotControl) notes.push("entra como “sem lote” (classifique por inventário por lote)");
    if (date) notes.push(`data ${date.split("-").reverse().join("/")}`);
    result.action = "create";
    result.messages = [`Saldo inicial de ${formatQty(qty)} ${sku.unitCode ?? ""} em ${wh.name}${notes.length ? ` (${notes.join("; ")})` : ""}.`];
    const whId = wh.id;
    const skuId = sku.id;
    out.push({
      result,
      apply: async (c, rec) => {
        const mov = await postInitialBalance(c, {
          warehouseId: whId, skuId, qty, unitCost: cost, reason: `Saldo inicial importado (importação nº ${rec.number})`,
          occurredAt: date ? startOfLocalDay(date) : null, documentRef: v.documentRef || null,
        });
        return { id: p!.id, message: `Saldo inicial lançado: ${formatQty(mov?.qty ?? qty)} ${sku!.unitCode ?? ""} a ${formatMoney(mov?.unitCost ?? cost)}.` };
      },
    });
  }
  return out;
}

async function planTitles(ctx: Ctx, kind: "receivables" | "payables", lines: Lines): Promise<PlannedRow[]> {
  const titleKind: TitleKind = kind === "receivables" ? "receivable" : "payable";
  const partyCollection = kind === "receivables" ? "customers" : "suppliers";
  const [parties, cats] = await Promise.all([
    listAll(ctx.store, partyCollection, { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "fin_categories", { filters: [["eq", "companyId", ctx.companyId], ["eq", "type", titleKind === "receivable" ? "revenue" : "expense"]] }),
  ]);
  const byDoc = new Map(parties.filter((d) => d.doc).map((d) => [String(d.doc), d]));
  const catByName = new Map(cats.map((c) => [normalizeSearch(c.name ?? ""), c]));
  const who = kind === "receivables" ? "cliente" : "fornecedor";
  const seen = new Map<string, number>();
  const out: PlannedRow[] = [];
  for (const { line, v } of lines) {
    const errors: string[] = [];
    if (!ctx.branchId) errors.push("Selecione uma filial (o título pertence à filial atual).");
    const doc = onlyDigits(v.doc);
    let party: Doc | undefined;
    if (doc) {
      party = byDoc.get(doc);
      if (!party) errors.push(`${who === "cliente" ? "Cliente" : "Fornecedor"} com CPF/CNPJ ${v.doc} não cadastrado — importe os ${who}s antes.`);
    }
    const partyName = party ? (party.tradeName || party.name) : (v.partyName ?? "").trim().slice(0, 200);
    if (!party && !doc && !partyName) errors.push(`Informe o CPF/CNPJ ou o nome do ${who}.`);
    const dueDate = dateOf(v.dueDate ?? "", "Vencimento", errors);
    if (!v.dueDate) errors.push("Vencimento obrigatório.");
    const issueDate = dateOf(v.issueDate ?? "", "Emissão", errors);
    const competenceDate = dateOf(v.competenceDate ?? "", "Competência", errors);
    const amount = moneyOf(v.amount ?? "", "Valor", errors);
    if (!v.amount) errors.push("Valor obrigatório.");
    else if (amount === 0) errors.push("O valor deve ser maior que zero.");
    let categoryId: string | null = null;
    if (v.category) {
      const c = catByName.get(normalizeSearch(v.category));
      if (!c) errors.push(`Categoria financeira "${v.category}" não encontrada (${titleKind === "receivable" ? "receita" : "despesa"}).`);
      else categoryId = c.id;
    }
    const documentNumber = (v.documentNumber ?? "").trim().slice(0, 60) || null;
    const installment = (v.installment ?? "").trim().slice(0, 20) || null;
    const contentKey = [titleKind, party ? party.id : `nome:${normalizeSearch(partyName)}`, documentNumber ?? "", installment ?? "", dueDate ?? "", amount ?? ""].join("|");
    const shown = [documentNumber, installment && `parc. ${installment}`].filter(Boolean).join(" ") || (dueDate ? `venc. ${dueDate.split("-").reverse().join("/")}` : "(sem documento)");
    const result: DataImportRowResult = { line, key: shown, name: partyName || undefined, action: "error", entityId: null, messages: errors };
    if (!errors.length) {
      const prev = seen.get(contentKey);
      if (prev) errors.push(`Título repetido no arquivo (linha ${prev}).`);
      else seen.set(contentKey, line);
    }
    if (errors.length) {
      out.push({ result });
      continue;
    }
    const idemKey = `dimport:${detId("dimport-title", ctx.companyId, contentKey)}`;
    const existing = await ctx.store.get("titles", titleId(idemKey));
    if (existing) {
      result.action = "skip";
      result.entityId = existing.id;
      result.messages = [`Título já importado (nº ${existing.number}).`];
      out.push({ result });
      continue;
    }
    const issue = issueDate ?? today();
    const description = ((v.description ?? "").trim() || `Saldo em aberto importado${documentNumber ? ` — doc. ${documentNumber}` : ""}`) + (installment ? ` — parcela ${installment}` : "");
    result.action = "create";
    result.messages = [`${titleKind === "receivable" ? "A receber" : "A pagar"} ${formatMoney(amount!)} com vencimento em ${dueDate!.split("-").reverse().join("/")}${party ? "" : ` (${who} avulso, sem cadastro)`}.`];
    out.push({
      result,
      apply: async (c, rec) => {
        const t = await createTitle(c, {
          kind: titleKind,
          partyType: party ? (kind === "receivables" ? "customer" : "supplier") : "other",
          partyId: party?.id ?? null,
          partyName,
          description: description.slice(0, 250),
          documentNumber,
          originType: "data_import",
          originId: rec.id,
          issueDate: issue,
          competenceDate: competenceDate ?? issue,
          categoryId,
          installments: [{ dueDate: dueDate!, amount: amount! }],
          notes: `Importado na implantação (importação nº ${rec.number}, linha ${line}).`,
          idemKey,
          branchId: c.branchId,
        });
        return { id: t.id, message: `Título ${titleKind === "receivable" ? "a receber" : "a pagar"} nº ${t.number} criado (${formatMoney(t.total)}).` };
      },
    });
  }
  return out;
}

function totalsOf(results: DataImportRowResult[]) {
  return {
    rows: results.length,
    create: results.filter((r) => r.action === "create").length,
    update: 0,
    skip: results.filter((r) => r.action === "skip").length,
    error: results.filter((r) => r.action === "error").length,
  };
}

/** Prévia linha a linha (nada é gravado). */
export async function previewDataImport(ctx: Ctx, input: PlanInput) {
  requireImport(ctx, input.kind);
  const planned = await plan(ctx, input);
  const results = planned.map((p) => p.result);
  return { results, totals: totalsOf(results) };
}

/**
 * Aplica a importação em lotes de até `IMPORT_BATCH_SIZE` linhas. Registro do lote com id determinístico pela chave
 * do envio: reenviar devolve o mesmo lote (concluído) ou retoma de onde parou (as linhas já processadas não são
 * refeitas; as demais são idempotentes por conteúdo).
 */
export async function runDataImport(ctx: Ctx, input: PlanInput & { fileName: string; idemKey: string }) {
  requireImport(ctx, input.kind);
  assert(input.idemKey, "Chave de idempotência ausente.");
  const id = detId("dimport", ctx.companyId, input.idemKey);
  let rec = await ctx.store.get("product_imports", id);
  if (rec?.status === "completed") return rec;
  if (rec) assert(rec.kind === input.kind, "Chave de importação já usada para outro tipo de dado.");
  const planned = await plan(ctx, input);
  if (!rec) {
    try {
      rec = await ctx.store.create(
        "product_imports",
        {
          companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, number: await nextNumber(ctx.store, `dimport:${ctx.companyId}`), kind: input.kind,
          fileName: input.fileName.slice(0, 250), mode: "create_only", matchBy: null, mapping: input.mapping, status: "processing", results: [], idemKey: `dimport:${input.idemKey}`.slice(0, 120),
        },
        id,
      );
    } catch (e) {
      if (!isConflict(e)) throw e;
      rec = await ctx.store.getOrThrow("product_imports", id);
      if (rec.status === "completed") return rec;
    }
  }
  const results: DataImportRowResult[] = Array.isArray(rec.results) ? [...rec.results] : [];
  const done = new Set(results.map((r) => r.line));
  const pending = planned.filter((p) => !done.has(p.result.line));
  for (let i = 0; i < pending.length; i += IMPORT_BATCH_SIZE) {
    for (const p of pending.slice(i, i + IMPORT_BATCH_SIZE)) {
      const r: DataImportRowResult = { ...p.result, messages: [...p.result.messages] };
      if (r.action === "create" && p.apply) {
        try {
          const out = await p.apply(ctx, rec);
          r.entityId = out.id;
          r.messages = [out.message];
        } catch (e: any) {
          r.action = "error";
          r.messages = [e instanceof BusinessError ? e.message : `Erro inesperado: ${e?.message ?? e}`];
        }
      }
      results.push(r);
    }
    // progresso do lote: uma retomada continua daqui
    await ctx.store.update("product_imports", rec.id, { results: [...results].sort((a, b) => a.line - b.line) });
  }
  results.sort((a, b) => a.line - b.line);
  const totals = totalsOf(results);
  const finished = await ctx.store.update("product_imports", rec.id, { status: "completed", results, totals, finishedAt: nowIso() });
  await audit(ctx, {
    module: "admin",
    action: "data.import",
    entityType: "data_import",
    entityId: rec.id,
    summary: `Importação nº ${rec.number} — ${DATA_IMPORT_LABEL[input.kind]} (${input.fileName}): ${totals.create} criado(s), ${totals.skip} ignorado(s), ${totals.error} com erro`,
    after: { kind: input.kind, totals },
  });
  return finished;
}
