"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { formatMoney, QTY } from "@/lib/money";
import { applyPromotions, describePromotion, promotionProblem, WEEKDAY_LABEL, type PromoKind, type PromoRule, type PromoScope } from "@/domain/promotions-calc";
import { savePromotionAction } from "./actions";

export interface TargetOption {
  value: string;
  label: string;
  /** preço de tabela vigente (SKU) — usado na prévia */
  price?: number | null;
  hint?: string | null;
}

export interface PromotionFormValue {
  id: string;
  name: string;
  kind: PromoKind;
  scope: PromoScope;
  targetIds: string[];
  buyQty: number | null;
  payQty: number | null;
  minQty: number | null;
  promoPrice: number | null;
  percentBps: number | null;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  branchId: string | null;
  active: boolean;
  notes: string | null;
}

const units = (milli: number | null | undefined) => (milli == null ? "" : String(milli / QTY).replace(".", ","));
const toMilli = (v: string) => {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * QTY);
};

/** Cadastro/edição de promoção (CAD-15) com prévia de exemplo calculada pela mesma função do PDV. */
export function PromotionForm({ promo, options, branches }: { promo?: PromotionFormValue | null; options: Record<PromoScope, TargetOption[]>; branches: Array<{ value: string; label: string }> }) {
  const [name, setName] = useState(promo?.name ?? "");
  const [kind, setKind] = useState<PromoKind>(promo?.kind ?? "buy_x_pay_y");
  const [scope, setScope] = useState<PromoScope>(promo?.scope ?? "sku");
  const [targets, setTargets] = useState<string[]>(promo?.targetIds ?? []);
  const [filter, setFilter] = useState("");
  const [buy, setBuy] = useState(units(promo?.buyQty ?? 3000));
  const [pay, setPay] = useState(units(promo?.payQty ?? 2000));
  const [minQty, setMinQty] = useState(units(promo?.minQty ?? 1000));
  const [mode, setMode] = useState<"price" | "percent">(promo?.promoPrice != null ? "price" : "percent");
  const [price, setPrice] = useState(promo?.promoPrice ?? 0);
  const [percent, setPercent] = useState(promo?.percentBps != null ? String(promo.percentBps / 100).replace(".", ",") : "10");
  const [weekdays, setWeekdays] = useState<number[]>(promo?.weekdays ?? []);
  const [samplePrice, setSamplePrice] = useState<number>(() => options.sku.find((o) => promo?.targetIds.includes(o.value))?.price ?? 1000);

  const list = options[scope];
  const labelOf = useMemo(() => new Map(list.map((o) => [o.value, o.label])), [list]);
  const shown = useMemo(() => {
    const words = filter.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
    return list.filter((o) => words.every((w) => `${o.label} ${o.hint ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(w))).slice(0, 80);
  }, [list, filter]);

  const draft: Partial<PromoRule> = {
    name,
    kind,
    scope,
    targetIds: targets,
    buyQty: kind === "buy_x_pay_y" ? toMilli(buy) : null,
    payQty: kind === "buy_x_pay_y" ? toMilli(pay) : null,
    minQty: kind === "min_qty" ? toMilli(minQty) : null,
    promoPrice: kind === "min_qty" && mode === "price" ? price : null,
    percentBps: kind === "min_qty" && mode === "percent" ? Math.round(Number(percent.replace(",", ".") || 0) * 100) : null,
  };
  const problem = promotionProblem({ ...draft, name: name || "x", targetIds: targets.length ? targets : ["x"] });
  // prévia: a regra sem condições de data/dia/horário, aplicada a quantidades de exemplo com o preço informado
  const preview = useMemo(() => {
    if (problem || samplePrice <= 0) return [];
    const rule: PromoRule = { ...(draft as PromoRule), id: "preview", name: name || "Promoção", targetIds: ["S"], scope: "sku" };
    const base = kind === "buy_x_pay_y" ? (draft.buyQty ?? 3000) / QTY : Math.max(1, (draft.minQty ?? 1000) / QTY);
    const qtys = [...new Set([1, Math.max(1, base - 1), base, base * 2 + 1].map((q) => Math.round(q)))].filter((q) => q >= 1).sort((a, b) => a - b);
    return qtys.map((q) => {
      const [r] = applyPromotions([{ skuId: "S", qty: q * QTY, unitPrice: samplePrice }], [rule], { date: "2000-01-01", weekday: 0, time: "12:00" });
      const gross = Math.round(samplePrice * q);
      return { q, gross, discount: r.promoDiscount, total: gross - r.promoDiscount };
    });
  }, [problem, samplePrice, kind, name, draft.buyQty, draft.payQty, draft.minQty, draft.promoPrice, draft.percentBps]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTarget = (id: string) => setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const changeScope = (s: PromoScope) => {
    setScope(s);
    setTargets([]);
    setFilter("");
    if (s === "category" && mode === "price") setMode("percent");
  };

  return (
    <ActionForm action={savePromotionAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          {promo?.id && <input type="hidden" name="id" value={promo.id} />}
          <FormGrid cols={2}>
            <Field label="Nome da promoção" required htmlFor="promo-name" hint="Aparece no PDV, no cupom e na venda.">
              <Input id="promo-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} placeholder="Ex.: Meias — leve 3, pague 2" />
            </Field>
            <Field label="Tipo" htmlFor="promo-kind">
              <Select id="promo-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as PromoKind)} options={[{ value: "buy_x_pay_y", label: "Leve X, pague Y" }, { value: "min_qty", label: "A partir de N unidades (preço ou %)" }]} />
            </Field>
          </FormGrid>
          {kind === "buy_x_pay_y" ? (
            <FormGrid cols={2}>
              <Field label="Leve (unidades)" htmlFor="promo-buy" required>
                <Input id="promo-buy" name="buyQty" inputMode="numeric" value={buy} onChange={(e) => setBuy(e.target.value)} className="tabular text-right" />
              </Field>
              <Field label="Pague (unidades)" htmlFor="promo-pay" required hint="A cada grupo completo, as unidades de diferença saem de graça.">
                <Input id="promo-pay" name="payQty" inputMode="numeric" value={pay} onChange={(e) => setPay(e.target.value)} className="tabular text-right" />
              </Field>
            </FormGrid>
          ) : (
            <FormGrid cols={3}>
              <Field label="A partir de (unidades)" htmlFor="promo-min" required hint="1 = desconto em qualquer quantidade.">
                <Input id="promo-min" name="minQty" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} className="tabular text-right" />
              </Field>
              <Field label="Desconto" htmlFor="promo-mode">
                <Select id="promo-mode" name="discountMode" value={mode} onChange={(e) => setMode(e.target.value as "price" | "percent")} options={[{ value: "percent", label: "Percentual" }, { value: "price", label: "Preço unitário fixo", disabled: scope === "category" }]} />
              </Field>
              {mode === "price" ? (
                <Field label="Preço promocional (cada)" required>
                  <MoneyInput name="promoPrice" value={price} onChange={setPrice} ariaLabel="Preço promocional" />
                </Field>
              ) : (
                <Field label="Percentual de desconto" htmlFor="promo-pct" required>
                  <Input id="promo-pct" name="percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className="tabular text-right" />
                </Field>
              )}
            </FormGrid>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Vale para</legend>
            <div className="flex flex-wrap gap-3">
              {(["sku", "product", "category"] as PromoScope[]).map((s) => (
                <label key={s} className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="scope" value={s} checked={scope === s} onChange={() => changeScope(s)} className="accent-brand-700" />
                  {s === "sku" ? "Itens (SKU)" : s === "product" ? "Produtos (todas as variações)" : "Categorias"}
                </label>
              ))}
            </div>
            {targets.length > 0 && (
              <ul className="flex flex-wrap gap-1" aria-label="Escolhidos">
                {targets.map((t) => (
                  <li key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
                    {labelOf.get(t) ?? "Item removido"}
                    <button type="button" aria-label={`Remover ${labelOf.get(t) ?? ""}`} onClick={() => toggleTarget(t)} className="rounded-full hover:bg-brand-100"><X className="size-3" /></button>
                    <input type="hidden" name="targetIds" value={t} />
                  </li>
                ))}
              </ul>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={scope === "category" ? "Filtrar categorias…" : "Filtrar por nome, SKU ou código…"} className="pl-8" aria-label="Filtrar" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border border-line">
              {shown.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-500">Nada encontrado.</p>
              ) : (
                shown.map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-0 hover:bg-slate-50">
                    <input type="checkbox" checked={targets.includes(o.value)} onChange={() => toggleTarget(o.value)} className="size-4 accent-brand-700" />
                    <span className="min-w-0 flex-1 truncate">{o.label}{o.hint ? <span className="ml-1 text-xs text-slate-500">{o.hint}</span> : null}</span>
                    {o.price != null && <span className="tabular text-xs text-slate-500">{formatMoney(o.price)}</span>}
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-slate-500">A contagem de quantidade é por item (SKU): “leve 3” exige 3 unidades do mesmo item no atendimento.</p>
          </fieldset>

          <FormGrid cols={2}>
            <Field label="Início da vigência" htmlFor="promo-from" hint="Vazio = desde já.">
              <Input id="promo-from" type="date" name="validFrom" defaultValue={promo?.validFrom ?? ""} />
            </Field>
            <Field label="Fim da vigência" htmlFor="promo-to" hint="Vazio = sem data para acabar. O último dia está incluído.">
              <Input id="promo-to" type="date" name="validTo" defaultValue={promo?.validTo ?? ""} />
            </Field>
          </FormGrid>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">Dias da semana <span className="font-normal text-slate-500">(nenhum marcado = todos)</span></legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_LABEL.map((l, d) => (
                <Checkbox key={d} label={l} name="weekdays" value={String(d)} checked={weekdays.includes(d)} onChange={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))} />
              ))}
            </div>
          </fieldset>
          <FormGrid cols={3}>
            <Field label="Das" htmlFor="promo-start" hint="Vazio = dia todo.">
              <Input id="promo-start" type="time" name="startTime" defaultValue={promo?.startTime ?? ""} />
            </Field>
            <Field label="Até (exclusive)" htmlFor="promo-end">
              <Input id="promo-end" type="time" name="endTime" defaultValue={promo?.endTime ?? ""} />
            </Field>
            <Field label="Filial" htmlFor="promo-branch">
              <Select id="promo-branch" name="branchId" defaultValue={promo?.branchId ?? ""} options={branches} placeholder="Todas as filiais" />
            </Field>
          </FormGrid>
          <Field label="Observações internas" htmlFor="promo-notes">
            <Textarea id="promo-notes" name="notes" rows={2} maxLength={500} defaultValue={promo?.notes ?? ""} />
          </Field>
          <Checkbox label="Promoção ativa" name="active" defaultChecked={promo ? promo.active : true} />

          <section aria-label="Prévia" className="rounded-md border border-line bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="font-medium text-ink">Prévia de exemplo{!problem ? ` — ${describePromotion(draft as PromoRule, formatMoney)}` : ""}</p>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Preço de tabela do exemplo
                <span className="w-28"><MoneyInput value={samplePrice} onChange={setSamplePrice} ariaLabel="Preço do exemplo" /></span>
              </label>
            </div>
            {problem ? (
              <p className="mt-2 text-xs text-amber-800">{problem}</p>
            ) : (
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-slate-500"><tr><th>Quantidade</th><th className="text-right">Sem promoção</th><th className="text-right">Desconto</th><th className="text-right">Cliente paga</th></tr></thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.q} className="border-t border-line">
                      <td className="py-1">{r.q} un.</td>
                      <td className="tabular text-right">{formatMoney(r.gross)}</td>
                      <td className="tabular text-right text-emerald-700">{r.discount ? `−${formatMoney(r.discount)}` : "—"}</td>
                      <td className="tabular text-right font-medium">{formatMoney(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-slate-500">No PDV a promoção vira desconto do item com o nome da regra e não consome o limite de desconto do operador. Regras para o mesmo item não se somam: vale a de maior desconto.</p>
          </section>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            {promo && (
              <Link href="/produtos/promocoes" className={buttonClass("ghost")}>
                Cancelar edição
              </Link>
            )}
            <SubmitButton pending={pending}>{promo ? "Salvar promoção" : "Cadastrar promoção"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
