import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nextNumber } from "@/lib/core/numbering";
import { normalizeSearch } from "@/lib/list";
import { nowIso } from "@/lib/dates";
import { parseMoney, parseQty } from "@/lib/money";
import { onlyDigits } from "@/lib/core/text";
import { createProduct, isValidGtin, normalizeSkuCode, saveSkuCosts, updateProduct, type ProductInput } from "./products";
import { defaultPriceTableId, savePrice } from "./pricing";
import { defaultWarehouse } from "./stock";

/**
 * Importação de produtos por CSV (Tela 15): mapeamento de colunas, prévia sem gravação,
 * resultado por linha e política de atualização explícita:
 *  - create_only: cria novos; existentes são ignorados;
 *  - update_only: atualiza existentes; novos são ignorados;
 *  - upsert: cria novos e atualiza existentes.
 * Existência por SKU (`matchBy=sku`) ou por código interno do produto (`matchBy=code`).
 * Repetir a mesma importação (mesma chave) não duplica produtos.
 */

export type ImportMode = "create_only" | "update_only" | "upsert";
export type MatchBy = "sku" | "code";

export const IMPORT_MODES: Array<{ value: ImportMode; label: string }> = [
  { value: "create_only", label: "Criar novos e ignorar existentes" },
  { value: "upsert", label: "Criar novos e atualizar existentes" },
  { value: "update_only", label: "Somente atualizar existentes (ignorar novos)" },
];

export const IMPORT_FIELDS: Array<{ key: string; label: string; aliases: string[] }> = [
  { key: "code", label: "Código interno", aliases: ["codigo", "cod", "code", "codigo interno", "cod interno", "codigo produto"] },
  { key: "sku", label: "SKU", aliases: ["sku", "referencia", "ref", "cod sku"] },
  { key: "name", label: "Nome / descrição", aliases: ["nome", "descricao", "produto", "name", "descricao produto", "nome produto"] },
  { key: "type", label: "Tipo (produto/serviço)", aliases: ["tipo", "type"] },
  { key: "barcode", label: "GTIN / EAN", aliases: ["ean", "gtin", "codigo de barras", "cod barras", "barcode", "ean13"] },
  { key: "unit", label: "Unidade", aliases: ["un", "unidade", "unid", "unit", "und"] },
  { key: "category", label: "Categoria", aliases: ["categoria", "category", "grupo", "departamento"] },
  { key: "brand", label: "Marca", aliases: ["marca", "brand", "fabricante"] },
  { key: "ncm", label: "NCM", aliases: ["ncm"] },
  { key: "cest", label: "CEST", aliases: ["cest"] },
  { key: "origin", label: "Origem (0–8)", aliases: ["origem", "origin"] },
  { key: "cost", label: "Custo de aquisição (R$)", aliases: ["custo", "cost", "preco de custo", "custo aquisicao", "preco custo"] },
  { key: "price", label: "Preço de venda (R$)", aliases: ["preco", "price", "preco venda", "preco de venda", "valor", "venda"] },
  { key: "wholesalePrice", label: "Preço de atacado (R$)", aliases: ["preco atacado", "atacado", "wholesale"] },
  { key: "wholesaleMinQty", label: "Qtd. mínima atacado", aliases: ["qtd atacado", "minimo atacado", "qtd minima atacado"] },
  { key: "active", label: "Ativo (S/N)", aliases: ["ativo", "active", "situacao"] },
  { key: "availablePdv", label: "Disponível no PDV (S/N)", aliases: ["pdv", "disponivel pdv", "vende no pdv"] },
  { key: "description", label: "Descrição detalhada", aliases: ["descricao detalhada", "detalhes", "observacao"] },
  { key: "initialQty", label: "Saldo inicial (filial atual)", aliases: ["estoque", "saldo", "saldo inicial", "quantidade", "qtd"] },
];

export const MAX_IMPORT_ROWS = 1000;

/** CSV com separador detectado (; , ou tab), aspas e BOM. */
export function parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/)[0] ?? "";
  const delimiter = [";", "\t", ","].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty.map((r) => r.map((c) => c.trim())), delimiter };
}

/** Sugestão de mapeamento: coluna → campo, pelo nome do cabeçalho. */
export function guessMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const n = normalizeSearch(h).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const f = IMPORT_FIELDS.find((x) => !used.has(x.key) && (x.key.toLowerCase() === n || x.aliases.includes(n)));
    if (f) {
      out[String(i)] = f.key;
      used.add(f.key);
    }
  });
  return out;
}

/** Leitura inicial do arquivo: cabeçalhos, amostra e mapeamento sugerido (nada é gravado). */
export function analyzeCsv(text: string) {
  assert(text && text.length <= 5_000_000, "Arquivo vazio ou maior que 5 MB.");
  const { headers, rows, delimiter } = parseCsv(text);
  assert(headers.length > 0, "Não foi possível ler o cabeçalho do CSV.");
  return { headers, sample: rows.slice(0, 5), rowCount: rows.length, delimiter, mapping: guessMapping(headers), fields: IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label })), maxRows: MAX_IMPORT_ROWS };
}

const truthy = (v: string) => ["s", "sim", "1", "true", "x", "y", "yes", "ativo", "verdadeiro"].includes(normalizeSearch(v));
const falsy = (v: string) => ["n", "nao", "0", "false", "no", "inativo", "falso"].includes(normalizeSearch(v));

export interface ImportRowResult {
  line: number;
  key: string;
  name?: string;
  action: "create" | "update" | "skip" | "error";
  productId?: string | null;
  messages: string[];
}

interface ParsedRow {
  line: number;
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
  data: Record<string, any>;
}

function parseRow(line: number, cells: string[], mapping: Record<string, string>): ParsedRow {
  const values: Record<string, string> = {};
  for (const [col, field] of Object.entries(mapping)) if (field) values[field] = (cells[Number(col)] ?? "").trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: Record<string, any> = {};
  const has = (k: string) => values[k] != null && values[k] !== "";
  const num = (k: string, fn: (v: string) => number, label: string) => {
    if (!has(k)) return;
    try {
      const n = fn(values[k]);
      if (n < 0) errors.push(`${label} negativo.`);
      else data[k] = n;
    } catch {
      errors.push(`${label} inválido ("${values[k]}").`);
    }
  };
  if (has("code")) data.code = values.code.toUpperCase().slice(0, 40);
  if (has("sku")) data.sku = normalizeSkuCode(values.sku);
  if (has("name")) data.name = values.name.slice(0, 200);
  if (has("type")) {
    const t = normalizeSearch(values.type);
    if (["servico", "service", "s"].includes(t)) data.type = "service";
    else if (["produto", "product", "mercadoria", "p"].includes(t)) data.type = "product";
    else errors.push(`Tipo "${values.type}" inválido (use produto ou serviço).`);
  }
  if (has("barcode")) {
    const b = values.barcode.replace(/\s/g, "");
    if (!isValidGtin(b)) errors.push(`GTIN/EAN ${values.barcode} inválido.`);
    else data.barcode = b;
  }
  if (has("unit")) data.unit = values.unit.toUpperCase();
  if (has("category")) data.category = values.category;
  if (has("brand")) data.brand = values.brand;
  if (has("ncm")) {
    const n = onlyDigits(values.ncm);
    if (n.length !== 8) errors.push(`NCM ${values.ncm} deve ter 8 dígitos.`);
    else data.ncm = n;
  }
  if (has("cest")) {
    const n = onlyDigits(values.cest);
    if (n.length !== 7) errors.push(`CEST ${values.cest} deve ter 7 dígitos.`);
    else data.cest = n;
  }
  if (has("origin")) {
    if (!/^[0-8]$/.test(values.origin)) errors.push(`Origem ${values.origin} inválida (0 a 8).`);
    else data.origin = values.origin;
  }
  num("cost", parseMoney, "Custo");
  num("price", parseMoney, "Preço");
  num("wholesalePrice", parseMoney, "Preço de atacado");
  num("wholesaleMinQty", parseQty, "Quantidade mínima de atacado");
  num("initialQty", parseQty, "Saldo inicial");
  for (const k of ["active", "availablePdv"]) {
    if (!has(k)) continue;
    if (truthy(values[k])) data[k] = true;
    else if (falsy(values[k])) data[k] = false;
    else errors.push(`Valor "${values[k]}" inválido para ${k === "active" ? "Ativo" : "PDV"} (use S ou N).`);
  }
  if (has("description")) data.description = values.description;
  if (data.wholesalePrice && !data.wholesaleMinQty) errors.push("Preço de atacado exige a quantidade mínima.");
  if (data.wholesalePrice && data.price != null && data.wholesalePrice > data.price) errors.push("Preço de atacado maior que o preço de venda.");
  return { line, values, errors, warnings, data };
}

interface PlanContext {
  units: Set<string>;
  categories: Map<string, Doc>;
  brands: Map<string, Doc>;
}

async function loadPlanContext(ctx: Ctx): Promise<PlanContext> {
  const [units, cats, brands] = await Promise.all([
    listAll(ctx.store, "units", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] }),
    listAll(ctx.store, "brands", { filters: [["eq", "companyId", ctx.companyId]] }),
  ]);
  return {
    units: new Set(units.map((u) => u.code)),
    categories: new Map(cats.map((c) => [normalizeSearch(c.name), c])),
    brands: new Map(brands.map((b) => [normalizeSearch(b.name), b])),
  };
}

async function findExisting(ctx: Ctx, row: ParsedRow, matchBy: MatchBy): Promise<{ product: Doc | null; sku: Doc | null; key: string }> {
  if (matchBy === "sku") {
    const key = row.data.sku ?? (row.data.code ? normalizeSkuCode(row.data.code) : "");
    if (!key) return { product: null, sku: null, key: "" };
    const sku = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["eq", "sku", key]]);
    const product = sku ? await ctx.store.get("products", sku.productId) : null;
    return { product, sku, key };
  }
  const key = row.data.code ?? "";
  if (!key) return { product: null, sku: null, key: "" };
  const product = await findOne(ctx.store, "products", [["eq", "companyId", ctx.companyId], ["eq", "code", key]]);
  return { product, sku: null, key };
}

interface Planned {
  row: ParsedRow;
  result: ImportRowResult;
  existing: { product: Doc | null; sku: Doc | null; key: string };
}

/** Planeja cada linha (validação + decisão criar/atualizar/ignorar) sem gravar nada. */
async function plan(ctx: Ctx, input: { text: string; mapping: Record<string, string>; mode: ImportMode; matchBy: MatchBy }): Promise<Planned[]> {
  const { rows } = parseCsv(input.text);
  assert(rows.length > 0, "O arquivo não tem linhas de dados.");
  assert(rows.length <= MAX_IMPORT_ROWS, `Máximo de ${MAX_IMPORT_ROWS} linhas por importação (o arquivo tem ${rows.length}).`);
  const mapped = new Set(Object.values(input.mapping).filter(Boolean));
  assert(mapped.size > 0, "Mapeie ao menos uma coluna.");
  const fieldsCount = Object.values(input.mapping).filter(Boolean).length;
  assert(fieldsCount === mapped.size, "Cada campo do sistema só pode ser mapeado para uma coluna.");
  assert(input.matchBy === "sku" ? mapped.has("sku") || mapped.has("code") : mapped.has("code"), input.matchBy === "sku" ? "Mapeie a coluna SKU (ou o código interno) para identificar os produtos." : "Mapeie a coluna Código interno para identificar os produtos.");
  const pc = await loadPlanContext(ctx);
  const seen = new Map<string, number>();
  const out: Planned[] = [];
  for (let i = 0; i < rows.length; i++) {
    const line = i + 2;
    const row = parseRow(line, rows[i], input.mapping);
    const existing = await findExisting(ctx, row, input.matchBy);
    const result: ImportRowResult = { line, key: existing.key || "(sem chave)", name: row.data.name ?? existing.product?.name, action: "error", productId: existing.product?.id ?? null, messages: [...row.errors] };
    if (existing.key) {
      const prev = seen.get(existing.key);
      if (prev) result.messages.push(`Chave repetida no arquivo (já na linha ${prev}).`);
      else seen.set(existing.key, line);
    }
    if (row.data.unit && !pc.units.has(row.data.unit)) result.messages.push(`Unidade ${row.data.unit} não cadastrada.`);
    if (result.messages.length) {
      out.push({ row, result, existing });
      continue;
    }
    if (existing.product) {
      if (input.mode === "create_only") {
        result.action = "skip";
        result.messages.push(`Já existe (${existing.product.code} — ${existing.product.name}): ignorado pela política "criar novos".`);
      } else {
        result.action = "update";
        const changes = Object.keys(row.data).filter((k) => !["code", "sku", "initialQty"].includes(k));
        if (!changes.length) {
          result.action = "skip";
          result.messages.push("Nenhum campo para atualizar.");
        } else result.messages.push(`Atualiza: ${changes.join(", ")}.`);
        if (row.data.initialQty) result.messages.push("Saldo inicial ignorado para item existente (use ajuste ou inventário).");
        if (row.data.type && row.data.type !== existing.product.type) result.messages.push("Tipo diferente do cadastro: mantido o tipo atual.");
      }
    } else if (input.mode === "update_only") {
      result.action = "skip";
      result.messages.push(`Não encontrado (${input.matchBy === "sku" ? "SKU" : "código"} ${existing.key || "vazio"}): ignorado pela política "somente atualizar".`);
    } else {
      if (!row.data.name) result.messages.push("Nome obrigatório para criar o produto.");
      if (input.matchBy === "code" && !row.data.code) result.messages.push("Código interno obrigatório para criar (identificação por código).");
      if (!row.data.unit && !pc.units.has("UN")) result.messages.push("Informe a unidade.");
      if (row.data.initialQty && !ctx.branchId) result.messages.push("Saldo inicial exige uma filial selecionada (não o consolidado).");
      if (row.data.initialQty && row.data.type === "service") result.messages.push("Serviço não tem saldo inicial.");
      if (row.data.barcode) {
        const hit = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["or", [["eq", "barcode", row.data.barcode], ["contains", "extraBarcodes", row.data.barcode]]]]);
        if (hit) result.messages.push(`GTIN ${row.data.barcode} já pertence ao SKU ${hit.sku}.`);
      }
      const skuCode = row.data.sku ?? (row.data.code ? normalizeSkuCode(row.data.code) : null);
      if (skuCode && input.matchBy === "code") {
        const hit = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["eq", "sku", skuCode]]);
        if (hit) result.messages.push(`SKU ${skuCode} já existe em outro produto.`);
      }
      if (!result.messages.length) {
        result.action = "create";
        const notes: string[] = [];
        if (row.data.category && !pc.categories.has(normalizeSearch(row.data.category))) notes.push(`categoria "${row.data.category}" será criada`);
        if (row.data.brand && !pc.brands.has(normalizeSearch(row.data.brand))) notes.push(`marca "${row.data.brand}" será criada`);
        result.messages.push(`Novo produto${notes.length ? ` (${notes.join("; ")})` : ""}.`);
      }
    }
    out.push({ row, result, existing });
  }
  return out;
}

function totalsOf(results: ImportRowResult[]) {
  return {
    rows: results.length,
    create: results.filter((r) => r.action === "create").length,
    update: results.filter((r) => r.action === "update").length,
    skip: results.filter((r) => r.action === "skip").length,
    error: results.filter((r) => r.action === "error").length,
  };
}

export async function previewImport(ctx: Ctx, input: { text: string; mapping: Record<string, string>; mode: ImportMode; matchBy: MatchBy }) {
  requirePerm(ctx, "products", input.mode === "update_only" ? "edit" : "create");
  const planned = await plan(ctx, input);
  const results = planned.map((p) => p.result);
  return { results, totals: totalsOf(results) };
}

async function ensureNamed(ctx: Ctx, collection: "categories" | "brands", name: string, cache: Map<string, Doc>): Promise<string> {
  const key = normalizeSearch(name);
  const hit = cache.get(key);
  if (hit) return hit.id;
  const id = detId(collection, ctx.companyId, key);
  let doc = await ctx.store.get(collection, id);
  if (!doc) {
    try {
      doc = await ctx.store.create(collection, { companyId: ctx.companyId, createdBy: ctx.user.id, name: name.trim().slice(0, 120), status: "active" }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      doc = await ctx.store.getOrThrow(collection, id);
    }
  }
  cache.set(key, doc);
  return doc.id;
}

/**
 * Executa a importação: registra o lote (`product_imports`), processa linha a linha e grava o resultado
 * por linha. Idempotente pela chave do envio: reenvio devolve o mesmo lote; reprocessar não duplica produtos.
 */
export async function runImport(ctx: Ctx, input: { fileName: string; text: string; mapping: Record<string, string>; mode: ImportMode; matchBy: MatchBy; idemKey: string }) {
  requirePerm(ctx, "products", input.mode === "update_only" ? "edit" : "create");
  if (input.mode !== "create_only") requirePerm(ctx, "products", "edit");
  assert(input.idemKey, "Chave de idempotência ausente.");
  const id = detId("pimport", ctx.companyId, input.idemKey);
  const existing = await ctx.store.get("product_imports", id);
  if (existing?.status === "completed") return existing;
  const planned = await plan(ctx, input);
  const rec =
    existing ??
    (await ctx.store.create(
      "product_imports",
      { companyId: ctx.companyId, branchId: ctx.branchId, createdBy: ctx.user.id, number: await nextNumber(ctx.store, `pimport:${ctx.companyId}`), fileName: input.fileName.slice(0, 250), mode: input.mode, matchBy: input.matchBy, mapping: input.mapping, status: "processing", idemKey: input.idemKey },
      id,
    ));
  const pc = await loadPlanContext(ctx);
  const tableId = await defaultPriceTableId(ctx.store, ctx.companyId);
  const wh = ctx.branchId ? await defaultWarehouse(ctx.store, ctx.branchId).catch(() => null) : null;
  const results: ImportRowResult[] = [];
  for (const p of planned) {
    const r = { ...p.result, messages: [...p.result.messages] };
    try {
      const d = p.row.data;
      if (r.action === "create") {
        const categoryId = d.category ? await ensureNamed(ctx, "categories", d.category, pc.categories) : null;
        const brandId = d.brand ? await ensureNamed(ctx, "brands", d.brand, pc.brands) : null;
        const type = d.type ?? "product";
        const productInput: ProductInput = {
          type, code: d.code ?? null, name: d.name, description: d.description ?? null, gtin: d.barcode ?? null, unitCode: d.unit ?? "UN", categoryId, brandId,
          active: d.active ?? true, availablePdv: d.availablePdv ?? true, ncm: d.ncm ?? null, cest: d.cest ?? null, origin: d.origin ?? "0",
        };
        if (d.initialQty && !wh) throw new BusinessError("Filial sem depósito padrão para o saldo inicial.");
        const product = await createProduct(ctx, productInput, {
          idemKey: `import:${rec.id}:${r.line}`,
          sku: d.sku ?? null,
          costAcquisition: d.cost ?? 0,
          price: d.price ?? null,
          wholesalePrice: d.wholesalePrice ?? null,
          wholesaleMinQty: d.wholesaleMinQty ?? null,
          stock: d.initialQty && type === "product" ? { warehouseId: wh!.id, qty: d.initialQty, unitCost: d.cost ?? null } : null,
        });
        r.productId = product.id;
        r.key = r.key === "(sem chave)" ? product.code : r.key;
        r.messages = [`Criado: ${product.code} — ${product.name}${d.initialQty ? ` com saldo inicial ${d.initialQty / 1000}` : ""}.`];
      } else if (r.action === "update") {
        const product = p.existing.product!;
        const patch: Partial<ProductInput> = {};
        if (d.name) patch.name = d.name;
        if (d.unit) patch.unitCode = d.unit;
        if (d.description) patch.description = d.description;
        if (d.active != null) patch.active = d.active;
        if (d.availablePdv != null) patch.availablePdv = d.availablePdv;
        if (d.category) patch.categoryId = await ensureNamed(ctx, "categories", d.category, pc.categories);
        if (d.brand) patch.brandId = await ensureNamed(ctx, "brands", d.brand, pc.brands);
        if (d.ncm) patch.ncm = d.ncm;
        if (d.cest) patch.cest = d.cest;
        if (d.origin) patch.origin = d.origin;
        if (Object.keys(patch).length) await updateProduct(ctx, product.id, patch, "all");
        const skus = p.existing.sku ? [p.existing.sku] : await listAll(ctx.store, "skus", { filters: [["eq", "productId", product.id]] });
        if (d.barcode && p.existing.sku && p.existing.sku.barcode !== d.barcode) {
          const hit = await findOne(ctx.store, "skus", [["eq", "companyId", ctx.companyId], ["or", [["eq", "barcode", d.barcode], ["contains", "extraBarcodes", d.barcode]]]]);
          if (hit && hit.id !== p.existing.sku.id) throw new BusinessError(`GTIN ${d.barcode} já pertence ao SKU ${hit.sku}.`);
          await ctx.store.update("skus", p.existing.sku.id, { barcode: d.barcode });
        }
        for (const s of skus) {
          if (d.cost != null) await saveSkuCosts(ctx, s.id, { costAcquisition: d.cost, additionalCosts: s.additionalCosts ?? [], reason: `Importação nº ${rec.number}` });
          if (d.price != null && tableId) {
            const current = await findOne(ctx.store, "prices", [["eq", "priceTableId", tableId], ["eq", "skuId", s.id], ["isNull", "branchId"], ["isNull", "validFrom"]]);
            await savePrice(ctx, {
              id: current?.id ?? null, priceTableId: tableId, skuId: s.id, branchId: null, price: d.price,
              wholesalePrice: d.wholesalePrice ?? current?.wholesalePrice ?? null, wholesaleMinQty: d.wholesaleMinQty ?? current?.wholesaleMinQty ?? null,
              maxDiscountBps: current?.maxDiscountBps ?? null, validFrom: null, validTo: current?.validTo ?? null, reason: `Importação nº ${rec.number}`,
            });
          }
        }
        r.messages = [`Atualizado: ${product.code} — ${d.name ?? product.name}.`, ...r.messages.filter((m) => !m.startsWith("Atualiza:"))];
      }
    } catch (e: any) {
      r.action = "error";
      r.messages = [e instanceof BusinessError ? e.message : `Erro inesperado: ${e?.message ?? e}`];
    }
    results.push(r);
  }
  const totals = totalsOf(results);
  const done = await ctx.store.update("product_imports", rec.id, { status: "completed", results, totals, finishedAt: nowIso() });
  await audit(ctx, {
    module: "products",
    action: "product.import",
    entityType: "product_import",
    entityId: rec.id,
    summary: `Importação nº ${rec.number} (${input.fileName}): ${totals.create} criado(s), ${totals.update} atualizado(s), ${totals.skip} ignorado(s), ${totals.error} com erro`,
    after: { mode: input.mode, matchBy: input.matchBy, totals },
  });
  return done;
}
