"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { ApplyResultTable, MarginCell, PricePreviewTable, previewSummary, type ApplyRow, type PreviewRow } from "@/components/pricing/price-preview";
import { formatMoney } from "@/lib/money";
import type { PriceEnding, PriceRule, RoundingMode } from "@/domain/price-adjust";
import type { BulkField } from "@/domain/product-bulk";
import { applyBulkFieldAction, applyBulkPriceAction, previewBulkFieldAction, previewBulkPriceAction } from "./actions";

type Opt = { value: string; label: string };

export interface BulkRow {
  skuId: string;
  productId: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  status: string;
  type: string;
  cost: number;
  price: number | null;
  marginBps: number | null;
}

type FieldLine = { productId: string; code: string; name: string; currentLabel: string; newLabel: string; status: "change" | "same" | "skip" | "error"; message: string | null; result?: "applied" | "same" | "skipped" | "error" };
type Totals = { change: number; same: number; skip: number; error: number; belowCost?: number };

const ENDINGS: Opt[] = [
  { value: "none", label: "Sem arredondamento" },
  { value: "90", label: "Terminar em ,90" },
  { value: "99", label: "Terminar em ,99" },
  { value: "00", label: "Valor inteiro (,00)" },
];
const FIELD_STATUS: Record<FieldLine["status"], [string, "good" | "neutral" | "warn" | "bad"]> = { change: ["Altera", "good"], same: ["Sem mudança", "neutral"], skip: ["Ignorado", "warn"], error: ["Erro", "bad"] };
const FIELD_RESULT: Record<NonNullable<FieldLine["result"]>, [string, "good" | "neutral" | "warn" | "bad"]> = { applied: ["Aplicado", "good"], same: ["Sem mudança", "neutral"], skipped: ["Ignorado", "warn"], error: ["Erro", "bad"] };
const STATUS_LABEL: Record<string, string> = { active: "Ativo", inactive: "Inativo", draft: "Rascunho" };

function parsePct(text: string): number | null {
  const n = Number(text.replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function BulkEditor({
  rows,
  tableId,
  tableName,
  canEdit,
  options,
}: {
  rows: BulkRow[];
  tableId: string;
  tableName: string;
  canEdit: boolean;
  options: { categories: Opt[]; brands: Opt[]; taxGroups: Opt[]; rules: Opt[]; fields: Array<Opt & { hint: string }> };
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [op, setOp] = useState<"price" | "field">("price");
  const [ruleKind, setRuleKind] = useState<PriceRule["kind"]>("percent");
  const [pctText, setPctText] = useState("");
  const [fixed, setFixed] = useState(0);
  const [ending, setEnding] = useState<PriceEnding>("none");
  const [rounding, setRounding] = useState<RoundingMode>("up");
  const [field, setField] = useState<BulkField>("categoryId");
  const [fieldValue, setFieldValue] = useState("");
  const [note, setNote] = useState("");
  const [pricePreview, setPricePreview] = useState<{ lines: PreviewRow[]; totals: Totals; rule: PriceRule } | null>(null);
  const [fieldPreview, setFieldPreview] = useState<{ lines: FieldLine[]; totals: Totals; value: string | boolean | null } | null>(null);
  const [priceResult, setPriceResult] = useState<ApplyRow[] | null>(null);
  const [fieldResult, setFieldResult] = useState<FieldLine[] | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();

  const chosen = rows.filter((r) => selected[r.skuId]);
  const productIds = [...new Set(chosen.map((r) => r.productId))];
  const allOn = rows.length > 0 && rows.every((r) => selected[r.skuId]);
  const reset = () => {
    setPricePreview(null);
    setFieldPreview(null);
    setPriceResult(null);
    setFieldResult(null);
  };

  const buildRule = (): PriceRule | string => {
    if (ruleKind === "fixed") return fixed > 0 ? { kind: "fixed", price: fixed } : "Informe o valor fixo.";
    const bps = parsePct(pctText);
    if (bps == null || pctText.trim() === "") return "Informe o percentual.";
    if (ruleKind === "percent") return { kind: "percent", percentBps: bps };
    if (ruleKind === "margin") return { kind: "margin", marginBps: bps };
    return { kind: "markup", markupBps: bps };
  };

  const fieldPayload = (): string | boolean | null | undefined => {
    if (field === "active" || field === "availablePdv") return fieldValue === "1" ? true : fieldValue === "0" ? false : undefined;
    if (field === "ncm") return fieldValue;
    return fieldValue || null;
  };

  const preview = () =>
    start(async () => {
      if (!chosen.length) return toast("error", "Marque ao menos um produto na lista.");
      reset();
      if (op === "price") {
        if (!tableId) return toast("error", "Cadastre uma tabela de preço.");
        const rule = buildRule();
        if (typeof rule === "string") return toast("error", rule);
        const r = await previewBulkPriceAction({ skuIds: chosen.map((c) => c.skuId), priceTableId: tableId, rule, ending: rule.kind === "fixed" ? "none" : ending, rounding });
        if (!r.ok) return toast("error", r.error);
        setPricePreview({ ...(r.data as { lines: PreviewRow[]; totals: Totals }), rule });
      } else {
        const value = fieldPayload();
        if (value === undefined) return toast("error", "Escolha o novo valor.");
        const r = await previewBulkFieldAction({ productIds, field, value });
        if (!r.ok) return toast("error", r.error);
        setFieldPreview({ ...(r.data as { lines: FieldLine[]; totals: Totals }), value });
      }
    });

  const apply = () =>
    start(async () => {
      if (op === "price" && pricePreview) {
        const ok = pricePreview.lines.filter((l) => l.status === "change");
        const r = await applyBulkPriceAction({
          priceTableId: tableId,
          rule: pricePreview.rule,
          ending: pricePreview.rule.kind === "fixed" ? "none" : ending,
          lines: ok.map((l) => ({ skuId: l.skuId, newPrice: l.newPrice!, expectedPrice: l.currentPrice })),
          idemKey: `${idem}:${tableId}:${ok.map((l) => `${l.skuId}=${l.newPrice}`).join(",")}`,
          note: note || null,
        });
        if (!r.ok) return toast("error", r.error);
        toast("success", r.message ?? "Preços atualizados.");
        setPriceResult((r.data as { lines: ApplyRow[] }).lines);
        setPricePreview(null);
        router.refresh();
      } else if (op === "field" && fieldPreview) {
        const ids = fieldPreview.lines.filter((l) => l.status === "change").map((l) => l.productId);
        const r = await applyBulkFieldAction({ productIds: ids, field, value: fieldPreview.value, idemKey: `${idem}:${field}:${String(fieldPreview.value)}:${ids.join(",")}`, note: note || null });
        if (!r.ok) return toast("error", r.error);
        toast("success", r.message ?? "Produtos alterados.");
        setFieldResult((r.data as { lines: FieldLine[] }).lines);
        setFieldPreview(null);
        router.refresh();
      }
    });

  const fieldDef = options.fields.find((f) => f.value === field);
  const changeCount = op === "price" ? (pricePreview?.totals.change ?? 0) : (fieldPreview?.totals.change ?? 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-sm font-semibold">1. Alteração</h2>
          {(["price", "field"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setOp(k);
                reset();
              }}
              className={cn("rounded-full border px-3 py-1 text-sm", op === k ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line text-slate-600 hover:bg-slate-50")}
            >
              {k === "price" ? "Reajustar preço" : "Alterar cadastro"}
            </button>
          ))}
        </div>
        {op === "price" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Regra">
              <Select value={ruleKind} onChange={(e) => { setRuleKind(e.target.value as PriceRule["kind"]); reset(); }} options={options.rules} />
            </Field>
            {ruleKind === "fixed" ? (
              <Field label="Novo preço">
                <MoneyInput value={fixed} onChange={(v) => { setFixed(v); reset(); }} />
              </Field>
            ) : (
              <Field label={ruleKind === "percent" ? "Reajuste (%)" : ruleKind === "margin" ? "Margem-alvo (%)" : "Markup (%)"} hint={ruleKind === "percent" ? "Use número negativo para reduzir (ex.: -5)." : ruleKind === "margin" ? "Preço = custo ÷ (1 − margem)." : "Preço = custo × (1 + markup)."}>
                <Input inputMode="decimal" value={pctText} onChange={(e) => { setPctText(e.target.value); reset(); }} placeholder={ruleKind === "percent" ? "10" : "30"} className="tabular" />
              </Field>
            )}
            <Field label="Arredondamento comercial">
              <Select value={ending} disabled={ruleKind === "fixed"} onChange={(e) => { setEnding(e.target.value as PriceEnding); reset(); }} options={ENDINGS} />
            </Field>
            <Field label="Direção do arredondamento">
              <Select value={rounding} disabled={ruleKind === "fixed" || ending === "none"} onChange={(e) => { setRounding(e.target.value as RoundingMode); reset(); }} options={[{ value: "up", label: "Para cima (nunca abaixo do calculado)" }, { value: "nearest", label: "Mais próximo" }]} />
            </Field>
            <Field label="Tabela de preço" hint="Troque no filtro acima.">
              <Input value={tableName} readOnly disabled />
            </Field>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Campo" hint={fieldDef?.hint}>
              <Select value={field} onChange={(e) => { setField(e.target.value as BulkField); setFieldValue(""); reset(); }} options={options.fields} />
            </Field>
            <Field label="Novo valor">
              {field === "categoryId" || field === "brandId" || field === "taxGroupId" ? (
                <Select
                  value={fieldValue}
                  onChange={(e) => { setFieldValue(e.target.value); reset(); }}
                  options={[{ value: "", label: field === "categoryId" ? "— sem categoria —" : field === "brandId" ? "— sem marca —" : "— sem grupo tributário —" }, ...(field === "categoryId" ? options.categories : field === "brandId" ? options.brands : options.taxGroups)]}
                />
              ) : field === "ncm" ? (
                <Input value={fieldValue} onChange={(e) => { setFieldValue(e.target.value); reset(); }} placeholder="0000.00.00" inputMode="numeric" className="tabular" />
              ) : (
                <Select
                  value={fieldValue}
                  onChange={(e) => { setFieldValue(e.target.value); reset(); }}
                  options={[{ value: "", label: "Escolha…" }, ...(field === "active" ? [{ value: "1", label: "Ativo" }, { value: "0", label: "Inativo" }] : [{ value: "1", label: "Disponível no PDV" }, { value: "0", label: "Fora do PDV" }])]}
                />
              )}
            </Field>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-sm text-slate-600">
            {chosen.length} SKU(s) marcado(s){op === "field" ? ` · ${productIds.length} produto(s)` : ""} de {rows.length} no filtro.
          </p>
          <Button type="button" variant="primary" onClick={preview} loading={pending} disabled={!chosen.length}>
            <Eye className="size-4" /> Gerar prévia
          </Button>
        </div>
      </section>

      {(pricePreview || fieldPreview) && (
        <section className="rounded-lg border-2 border-brand-300 bg-white p-4">
          <h2 className="text-sm font-semibold">2. Prévia — nada foi gravado ainda</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {op === "price" && pricePreview ? previewSummary(pricePreview.totals) : fieldPreview ? `${fieldPreview.totals.change} produto(s) a alterar${fieldPreview.totals.same ? ` · ${fieldPreview.totals.same} já estão assim` : ""}${fieldPreview.totals.skip ? ` · ${fieldPreview.totals.skip} ignorado(s)` : ""}${fieldPreview.totals.error ? ` · ${fieldPreview.totals.error} com erro` : ""}` : null}
          </p>
          {pricePreview?.totals.belowCost ? <div className="mt-3"><Notice tone="warn">Há preço abaixo do custo na lista. Confira antes de aplicar.</Notice></div> : null}
          <div className="mt-3">
            {op === "price" && pricePreview && <PricePreviewTable rows={pricePreview.lines} />}
            {op === "field" && fieldPreview && <FieldTable lines={fieldPreview.lines} />}
          </div>
          {canEdit ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Field label="Observação (opcional — vai para o histórico)" className="min-w-[260px] flex-1">
                <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: tabela do fornecedor de outubro" />
              </Field>
              <Button type="button" variant="accent" onClick={apply} loading={pending} disabled={!changeCount}>
                <CheckCircle2 className="size-4" /> Confirmar e aplicar em {changeCount} {op === "price" ? "preço(s)" : "produto(s)"}
              </Button>
            </div>
          ) : (
            <div className="mt-3"><Notice tone="warn">Aplicar exige a permissão de alterar produtos.</Notice></div>
          )}
        </section>
      )}

      {priceResult && (
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Resultado</h2>
          <ApplyResultTable rows={priceResult} />
        </section>
      )}
      {fieldResult && (
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Resultado</h2>
          <FieldTable lines={fieldResult} result />
        </section>
      )}

      <section className="rounded-lg border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Produtos no filtro</h2>
          <p className="text-xs text-slate-500">Preço da tabela {tableName} (geral, sem filial). Margem = (preço − custo) ÷ preço.</p>
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="table-base w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label="Marcar todos" checked={allOn} onChange={(e) => { setSelected(Object.fromEntries(rows.map((r) => [r.skuId, e.target.checked]))); reset(); }} />
                </th>
                <th>Produto</th>
                <th>Categoria · marca</th>
                <th>Situação</th>
                <th className="text-right">Custo</th>
                <th className="text-right">Preço</th>
                <th className="text-right">Margem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.skuId} className={cn(selected[r.skuId] && "bg-brand-50/50")}>
                  <td>
                    <input type="checkbox" aria-label={`Marcar ${r.name}`} checked={Boolean(selected[r.skuId])} onChange={(e) => { setSelected({ ...selected, [r.skuId]: e.target.checked }); reset(); }} />
                  </td>
                  <td>{r.name}<span className="block font-mono text-xs text-slate-500">{r.sku}{r.type === "service" ? " · serviço" : ""}</span></td>
                  <td>{r.category}<span className="block text-xs text-slate-500">{r.brand}</span></td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="tabular text-right">{formatMoney(r.cost)}</td>
                  <td className="tabular text-right">{r.price == null ? <span className="text-amber-700">Sem preço</span> : formatMoney(r.price)}</td>
                  <td className="text-right"><MarginCell bps={r.marginBps} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Nenhum produto no filtro.</p>}
        </div>
      </section>
    </div>
  );
}

function FieldTable({ lines, result }: { lines: FieldLine[]; result?: boolean }) {
  return (
    <div className="max-h-[480px] overflow-auto rounded-md border border-line">
      <table className="table-base w-full text-sm">
        <thead className="sticky top-0"><tr><th>Produto</th><th>Atual</th><th>Novo</th><th>{result ? "Resultado" : "Situação"}</th></tr></thead>
        <tbody>
          {lines.map((l) => {
            const [label, tone] = result && l.result ? FIELD_RESULT[l.result] : FIELD_STATUS[l.status];
            return (
              <tr key={l.productId}>
                <td>{l.name}<span className="block font-mono text-xs text-slate-500">{l.code}</span></td>
                <td>{l.currentLabel}</td>
                <td className="font-medium">{l.newLabel}</td>
                <td><Badge tone={tone}>{label}</Badge>{l.message && <span className="mt-0.5 block max-w-xs text-xs text-slate-600">{l.message}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
