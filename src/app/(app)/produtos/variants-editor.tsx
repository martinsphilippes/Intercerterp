"use client";

import { useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { saveVariantsAction, removeVariantAction } from "./actions";

export interface AxisDraft {
  name: string;
  values: string;
}
export interface VariantDraft {
  id?: string;
  sku: string;
  barcode: string;
  extraBarcodes: string;
  attributes: Record<string, string>;
  active: boolean;
  stockText?: string;
  inUse?: boolean;
}

export function normalizeSku(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export const parseAxes = (axes: AxisDraft[]) =>
  axes.map((a) => ({ name: a.name.trim(), values: [...new Set(a.values.split(",").map((v) => v.trim()).filter(Boolean))] })).filter((a) => a.name && a.values.length);

export const toVariantPayload = (variants: VariantDraft[]) =>
  variants.map((v) => ({ id: v.id || null, sku: v.sku, barcode: v.barcode || null, extraBarcodes: v.extraBarcodes.split(/[,;\s]+/).filter(Boolean), attributes: v.attributes, active: v.active }));

/** Combinações (cartesiano) dos eixos, preservando variações já existentes com os mesmos atributos. */
function combine(axes: Array<{ name: string; values: string[] }>, existing: VariantDraft[], code: string): VariantDraft[] {
  let combos: Array<Record<string, string>> = [{}];
  for (const a of axes) combos = combos.flatMap((o) => a.values.map((v) => ({ ...o, [a.name]: v })));
  return combos.map((attrs) => {
    const hit = existing.find((v) => axes.every((a) => v.attributes[a.name] === attrs[a.name]));
    if (hit) return { ...hit, attributes: attrs };
    return { sku: normalizeSku(`${code || "SKU"}-${Object.values(attrs).join("-")}`), barcode: "", extraBarcodes: "", attributes: attrs, active: true };
  });
}

/** Editor de eixos (ex.: Cor, Tamanho) e da grade de variações — SKU, códigos de barras e situação próprios. */
export function VariantsEditor({ axes, setAxes, variants, setVariants, productCode, onRemove }: { axes: AxisDraft[]; setAxes: (a: AxisDraft[]) => void; variants: VariantDraft[]; setVariants: (v: VariantDraft[]) => void; productCode: string; onRemove?: (v: VariantDraft) => void }) {
  const parsed = parseAxes(axes);
  const set = (i: number, patch: Partial<VariantDraft>) => setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-600">Atributos (eixos) e valores separados por vírgula</p>
        <div className="space-y-2">
          {axes.map((a, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
              <Input aria-label="Atributo" placeholder="Ex.: Cor" value={a.name} onChange={(e) => setAxes(axes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label="Valores" placeholder="Ex.: Preta, Branca, Azul" value={a.values} onChange={(e) => setAxes(axes.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
              <Button type="button" variant="ghost" aria-label="Remover atributo" onClick={() => setAxes(axes.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setAxes([...axes, { name: "", values: "" }])}>
            <Plus className="size-4" /> Atributo
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!parsed.length} onClick={() => setVariants(combine(parsed, variants, productCode))} title="Gera uma variação por combinação de valores (mantém as já existentes)">
            <Wand2 className="size-4" /> Gerar combinações ({parsed.reduce((a, x) => a * x.values.length, parsed.length ? 1 : 0)})
          </Button>
        </div>
      </div>
      {variants.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Atributos</th>
                <th>SKU</th>
                <th>GTIN/EAN</th>
                <th>Códigos adicionais</th>
                {variants.some((v) => v.stockText != null) && <th className="text-right">Saldo</th>}
                <th className="text-center">Ativa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.id ?? `n${i}`}>
                  <td className="whitespace-nowrap">{Object.entries(v.attributes).map(([k, val]) => `${k}: ${val}`).join(" · ") || <span className="text-slate-400">Sem atributos</span>}</td>
                  <td><Input aria-label="SKU" className="min-w-36 font-mono text-xs" value={v.sku} onChange={(e) => set(i, { sku: normalizeSku(e.target.value) })} /></td>
                  <td><Input aria-label="GTIN/EAN" className="min-w-36 font-mono text-xs" inputMode="numeric" value={v.barcode} onChange={(e) => set(i, { barcode: e.target.value.trim() })} /></td>
                  <td><Input aria-label="Códigos adicionais" className="min-w-36 font-mono text-xs" placeholder="separe por vírgula" value={v.extraBarcodes} onChange={(e) => set(i, { extraBarcodes: e.target.value })} /></td>
                  {variants.some((x) => x.stockText != null) && <td className="tabular text-right">{v.stockText ?? "—"}</td>}
                  <td className="text-center"><input type="checkbox" aria-label="Ativa" className="size-4 accent-brand-700" checked={v.active} onChange={(e) => set(i, { active: e.target.checked })} /></td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title={v.id ? (v.inUse ? "Inativar (possui histórico)" : "Excluir (sem uso)") : "Retirar da grade"}
                      onClick={() => (v.id && onRemove ? onRemove(v) : setVariants(variants.filter((_, j) => j !== i)))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Aba Variações do cadastro existente. */
export function VariantsForm({ productId, productCode, initialAxes, initialVariants }: { productId: string; productCode: string; initialAxes: AxisDraft[]; initialVariants: VariantDraft[] }) {
  const [axes, setAxes] = useState<AxisDraft[]>(initialAxes);
  const [variants, setVariants] = useState<VariantDraft[]>(initialVariants);
  const toast = useToast();
  const remove = async (v: VariantDraft) => {
    if (!window.confirm(v.inUse ? `Inativar a variação ${v.sku}? O histórico é preservado.` : `Excluir a variação ${v.sku}? Ela não tem uso.`)) return;
    const r = await removeVariantAction(productId, v.id!);
    if (!r.ok) return toast("error", r.error);
    toast("success", r.message ?? "Variação atualizada.");
    if (r.message?.includes("excluída")) setVariants((x) => x.filter((y) => y.id !== v.id));
    else setVariants((x) => x.map((y) => (y.id === v.id ? { ...y, active: false } : y)));
  };
  return (
    <ActionForm action={saveVariantsAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="axes" value={JSON.stringify(parseAxes(axes))} />
          <input type="hidden" name="variants" value={JSON.stringify(toVariantPayload(variants))} />
          <Notice tone="info">
            Cada variação é um SKU com código de barras, custo, preço e saldo próprios. Novas variações herdam custo e preços da primeira variação ativa. Variações com histórico são inativadas, nunca apagadas.
          </Notice>
          <VariantsEditor axes={axes} setAxes={setAxes} variants={variants} setVariants={setVariants} productCode={productCode} onRemove={remove} />
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Salvar variações</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

