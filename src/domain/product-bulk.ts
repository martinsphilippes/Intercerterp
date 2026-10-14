import { detId, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { assert, BusinessError } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import { categoryPath, companyRegime, formatNcm, normalizeFiscal, refreshProductSearch, setProductStatus, updateProduct, type ProductInput } from "./products";
import { MAX_APPLY_LINES, runIdempotentBatches } from "./price-adjust";

/**
 * Alteração em massa de campos cadastrais seguros (CAD-18): categoria, marca, NCM, grupo tributário, situação
 * (ativo/inativo) e disponibilidade no PDV. Usa os mesmos serviços da edição individual (`updateProduct`,
 * `setProductStatus` — validações, auditoria e busca), sempre com prévia, em lotes de até 24 produtos por transação
 * (≤ 100 escritas) e idempotente pela chave do envio. Preços em massa usam o motor de `price-adjust.ts`.
 */

export type BulkField = "categoryId" | "brandId" | "ncm" | "taxGroupId" | "active" | "availablePdv";

export const BULK_FIELDS: Array<{ value: BulkField; label: string; hint: string }> = [
  { value: "categoryId", label: "Categoria", hint: "Move os produtos para a categoria escolhida." },
  { value: "brandId", label: "Marca", hint: "Define (ou remove) a marca." },
  { value: "ncm", label: "NCM", hint: "Classificação fiscal (8 dígitos). Serviços não usam NCM e são ignorados." },
  { value: "taxGroupId", label: "Grupo tributário", hint: "Regra de tributação do produto. Serviços são ignorados." },
  { value: "active", label: "Situação (ativo/inativo)", hint: "Inativar preserva o histórico; produto em rascunho não é ativado por aqui." },
  { value: "availablePdv", label: "Disponível no PDV", hint: "Mostra ou oculta os produtos na frente de caixa." },
];

/** Escritas por produto: cadastro + busca + auditoria (+ folga). */
export const FIELD_OPS_PER_ITEM = 4;
export const FIELD_ITEMS_PER_TX = 24;

export interface FieldLine {
  productId: string;
  code: string;
  name: string;
  type: string;
  currentLabel: string;
  newLabel: string;
  status: "change" | "same" | "skip" | "error";
  message: string | null;
}

interface Resolved {
  field: BulkField;
  value: string | boolean | null;
  label: string;
}

async function resolveValue(ctx: Ctx, field: BulkField, raw: unknown): Promise<Resolved> {
  switch (field) {
    case "categoryId":
    case "brandId":
    case "taxGroupId": {
      const id = typeof raw === "string" && raw ? raw : null;
      const coll = field === "categoryId" ? "categories" : field === "brandId" ? "brands" : "tax_groups";
      const what = field === "categoryId" ? "Categoria" : field === "brandId" ? "Marca" : "Grupo tributário";
      if (!id) return { field, value: null, label: `Sem ${what.toLowerCase()}` };
      const d = await ctx.store.get(coll, id);
      assert(d && d.companyId === ctx.companyId, `${what} inválido(a).`);
      assert(d.status !== "inactive" && d.active !== false, `${what} inativo(a): reative em Cadastros auxiliares antes de usar.`);
      if (field === "categoryId") {
        const cats = await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] });
        return { field, value: id, label: categoryPath(cats, id) || d.name };
      }
      return { field, value: id, label: d.name };
    }
    case "ncm": {
      const n = onlyDigits(typeof raw === "string" ? raw : "");
      assert(n.length === 8, "NCM deve ter 8 dígitos.");
      return { field, value: n, label: formatNcm(n) };
    }
    case "active":
    case "availablePdv": {
      assert(typeof raw === "boolean", "Escolha o novo valor.");
      return { field, value: raw, label: field === "active" ? (raw ? "Ativo" : "Inativo") : raw ? "Disponível no PDV" : "Fora do PDV" };
    }
    default:
      throw new BusinessError("Campo não permitido na alteração em massa.");
  }
}

async function labelMaps(ctx: Ctx, field: BulkField) {
  if (field === "categoryId") {
    const cats = await listAll(ctx.store, "categories", { filters: [["eq", "companyId", ctx.companyId]] });
    return (id: string | null) => (id ? categoryPath(cats, id) || "—" : "Sem categoria");
  }
  if (field === "brandId" || field === "taxGroupId") {
    const docs = await listAll(ctx.store, field === "brandId" ? "brands" : "tax_groups", { filters: [["eq", "companyId", ctx.companyId]] });
    const m = new Map(docs.map((d) => [d.id, d.name as string]));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : field === "brandId" ? "Sem marca" : "Sem grupo tributário");
  }
  return null;
}

function currentLabel(p: Doc, field: BulkField, names: ((id: string | null) => string) | null): string {
  if (names) return names(p[field] ?? null);
  if (field === "ncm") return p.ncm ? formatNcm(p.ncm) : "Sem NCM";
  if (field === "active") return p.status === "draft" ? "Rascunho" : p.active === false ? "Inativo" : "Ativo";
  return p.availablePdv === false ? "Fora do PDV" : "Disponível no PDV";
}

/** Decide a situação de cada produto (sem gravar). */
function planLine(p: Doc, r: Resolved, names: ((id: string | null) => string) | null, regime: ReturnType<typeof companyRegime>): FieldLine {
  const line: FieldLine = { productId: p.id, code: p.code ?? "", name: p.name, type: p.type, currentLabel: currentLabel(p, r.field, names), newLabel: r.label, status: "change", message: null };
  if ((r.field === "ncm" || r.field === "taxGroupId") && p.type === "service") return { ...line, status: "skip", message: "Serviço: não usa NCM nem grupo tributário de mercadoria." };
  if (r.field === "active") {
    if (r.value === true && p.status === "draft") return { ...line, status: "skip", message: "Produto em rascunho: conclua o cadastro na ficha do produto." };
    const isActive = p.status !== "draft" && p.active !== false;
    if (isActive === r.value) return { ...line, status: "same", message: null };
    return line;
  }
  const cur = r.field === "availablePdv" ? p.availablePdv !== false : (p[r.field] ?? null);
  if (cur === r.value) return { ...line, status: "same", message: null };
  if (r.field === "ncm" || r.field === "taxGroupId") {
    try {
      normalizeFiscal(p.type, { ...(p as any), [r.field]: r.value }, regime);
    } catch (e) {
      return { ...line, status: "error", message: e instanceof BusinessError ? `Cadastro fiscal com pendência: ${e.message}` : String(e) };
    }
  }
  return line;
}

async function loadProducts(ctx: Ctx, productIds: string[]) {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out: Doc[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await listAll(ctx.store, "products", { filters: [["eq", "id", ids.slice(i, i + 100)]] })));
  const byId = new Map(out.filter((p) => p.companyId === ctx.companyId).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as Doc[];
}

/** Prévia da alteração de um campo (nada é gravado). */
export async function previewFieldChange(ctx: Ctx, input: { productIds: string[]; field: BulkField; value: unknown }) {
  requirePerm(ctx, "products", "view");
  requireAction(ctx, "products.bulk_edit");
  assert(input.productIds.length > 0, "Selecione ao menos um produto.");
  assert(input.productIds.length <= MAX_APPLY_LINES, `Selecione no máximo ${MAX_APPLY_LINES} produtos por vez.`);
  const r = await resolveValue(ctx, input.field, input.value);
  const [products, names, company] = await Promise.all([loadProducts(ctx, input.productIds), labelMaps(ctx, input.field), ctx.store.getOrThrow("companies", ctx.companyId)]);
  const regime = companyRegime(company);
  const lines = products.map((p) => planLine(p, r, names, regime));
  return { field: r.field, newLabel: r.label, lines, totals: fieldTotals(lines) };
}

function fieldTotals(lines: Array<{ status: string }>) {
  return {
    lines: lines.length,
    change: lines.filter((l) => l.status === "change").length,
    same: lines.filter((l) => l.status === "same").length,
    skip: lines.filter((l) => l.status === "skip").length,
    error: lines.filter((l) => l.status === "error").length,
  };
}

export interface FieldApplyResult {
  jobId: string;
  replayed: boolean;
  applied: number;
  same: number;
  skipped: number;
  errors: number;
  lines: Array<FieldLine & { result: "applied" | "same" | "skipped" | "error" }>;
}

/**
 * Aplica a alteração (revisada na prévia) aos produtos. Exige "Alterar produtos e preços em massa" e alterar produtos.
 * Cada produto passa pelas validações do cadastro; um produto com erro não impede os demais.
 */
export async function applyFieldChange(ctx: Ctx, input: { productIds: string[]; field: BulkField; value: unknown; idemKey: string; note?: string | null }): Promise<FieldApplyResult> {
  requireAction(ctx, "products.bulk_edit");
  requirePerm(ctx, "products", "edit");
  assert(input.idemKey, "Chave de idempotência ausente.");
  assert(input.productIds.length > 0, "Selecione ao menos um produto.");
  assert(input.productIds.length <= MAX_APPLY_LINES, `Selecione no máximo ${MAX_APPLY_LINES} produtos por vez.`);
  const jobId = detId("fieldjob", ctx.companyId, input.idemKey);
  const job = await ctx.store.get("operations", jobId);
  if (job?.status === "done" && job.result?.summary) return { ...(job.result.summary as FieldApplyResult), replayed: true };
  const r = await resolveValue(ctx, input.field, input.value);
  const [products, names, company] = await Promise.all([loadProducts(ctx, input.productIds), labelMaps(ctx, input.field), ctx.store.getOrThrow("companies", ctx.companyId)]);
  const regime = companyRegime(company);
  const planned = products.map((p) => planLine(p, r, names, regime));
  if (!job) await ctx.store.create("operations", { companyId: ctx.companyId, type: "products.bulk_edit", status: "running", entityType: "product_bulk", entityId: null, result: { field: r.field, startedAt: nowIso() }, createdBy: ctx.user.id }, jobId).catch(() => null);
  const todo = planned.filter((l) => l.status === "change").map((l) => ({ key: l.productId }));
  const outcomes = await runIdempotentBatches(ctx, {
    jobId,
    type: "products.bulk_edit.batch",
    items: todo,
    perTx: FIELD_ITEMS_PER_TX,
    opsPerItem: FIELD_OPS_PER_ITEM,
    apply: async (txCtx, it) => {
      if (r.field === "active") await setProductStatus(txCtx, it.key, r.value as boolean);
      else if (r.field === "ncm" || r.field === "taxGroupId") await updateProduct(txCtx, it.key, { [r.field]: r.value } as Partial<ProductInput>, "fiscal");
      else await updateProduct(txCtx, it.key, { [r.field]: r.value } as Partial<ProductInput>, "all");
    },
  });
  // nome da categoria/marca entra na busca: recalcula fora da transação (leituras transacionais não veem a própria escrita)
  if (r.field === "categoryId" || r.field === "brandId") for (const t of todo) if (outcomes.get(t.key)?.ok) await refreshProductSearch(ctx.store, t.key);
  const lines = planned.map((l) => {
    if (l.status !== "change") return { ...l, result: (l.status === "same" ? "same" : l.status === "skip" ? "skipped" : "error") as "same" | "skipped" | "error" };
    const o = outcomes.get(l.productId);
    return o?.ok ? { ...l, result: "applied" as const, message: o.replayed ? "Aplicado anteriormente." : null } : { ...l, result: "error" as const, message: o?.message ?? "Não aplicado." };
  });
  const summary: FieldApplyResult = {
    jobId,
    replayed: false,
    applied: lines.filter((l) => l.result === "applied").length,
    same: lines.filter((l) => l.result === "same").length,
    skipped: lines.filter((l) => l.result === "skipped").length,
    errors: lines.filter((l) => l.result === "error").length,
    lines,
  };
  const label = BULK_FIELDS.find((f) => f.value === r.field)?.label ?? r.field;
  await ctx.store.update("operations", jobId, { status: "done", result: { field: r.field, value: r.value, finishedAt: nowIso(), summary: { ...summary, lines: summary.lines.slice(0, 300) } } });
  await audit(ctx, {
    module: "products",
    action: "product.bulk_edit",
    entityType: "product_bulk",
    entityId: jobId,
    summary: `Alteração em massa — ${label}: “${r.label}” em ${summary.applied} produto(s)${summary.same ? `, ${summary.same} já estavam assim` : ""}${summary.skipped ? `, ${summary.skipped} ignorado(s)` : ""}${summary.errors ? `, ${summary.errors} com erro` : ""}`,
    after: { field: r.field, value: r.value, products: lines.filter((l) => l.result === "applied").map((l) => ({ code: l.code, de: l.currentLabel })) },
    reason: input.note?.trim() || null,
    related: lines.filter((l) => l.result === "applied").slice(0, 200).map((l) => `product:${l.productId}`),
  });
  return summary;
}
