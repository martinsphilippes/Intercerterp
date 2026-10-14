"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, CheckCircle2, Eye, RotateCcw, Tag } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { ApplyResultTable, MarginCell, PricePreviewTable, Variation, previewSummary, type ApplyRow, type PreviewRow } from "@/components/pricing/price-preview";
import { formatBps, formatMoney, formatQty, marginBps } from "@/lib/money";
import type { ReceiptPricingLine, PricingMode } from "@/domain/receipt-pricing";
import type { PriceEnding } from "@/domain/price-adjust";
import { applyReceiptPricingAction, previewReceiptPricingAction, suggestReceiptPricingAction } from "./actions";

type Opt = { value: string; label: string };
type Settings = { mode: PricingMode; targetMarginBps: number; ending: PriceEnding };
type Totals = { change: number; same: number; skip: number; error: number; belowCost?: number };

const ENDINGS: Opt[] = [
  { value: "none", label: "Sem arredondamento" },
  { value: "90", label: "Terminar em ,90" },
  { value: "99", label: "Terminar em ,99" },
  { value: "00", label: "Valor inteiro (,00)" },
];

function initialState(lines: ReceiptPricingLine[]) {
  const prices: Record<string, number | null> = {};
  const include: Record<string, boolean> = {};
  for (const l of lines) {
    prices[l.skuId] = l.suggestedPrice;
    include[l.skuId] = l.status === "change";
  }
  return { prices, include };
}

export function ReceiptPricingEditor({
  receiptId,
  initial,
  tables,
  canApply,
  labelsHref,
}: {
  receiptId: string;
  initial: { lines: ReceiptPricingLine[]; settings: Settings; tableId: string };
  tables: Opt[];
  canApply: boolean;
  labelsHref: string | null;
}) {
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [marginText, setMarginText] = useState(String(initial.settings.targetMarginBps / 100).replace(".", ","));
  const [tableId, setTableId] = useState(initial.tableId);
  const [lines, setLines] = useState(initial.lines);
  const init = useMemo(() => initialState(initial.lines), [initial.lines]);
  const [prices, setPrices] = useState(init.prices);
  const [include, setInclude] = useState(init.include);
  const [preview, setPreview] = useState<{ lines: PreviewRow[]; totals: Totals } | null>(null);
  const [result, setResult] = useState<ApplyRow[] | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();

  const selected = lines.filter((l) => include[l.skuId] && prices[l.skuId] != null);
  const touch = () => {
    setPreview(null);
    setResult(null);
  };

  const recalc = () =>
    start(async () => {
      const pctNum = Number(marginText.replace(",", "."));
      if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum >= 100) return toast("error", "Informe a margem padrão entre 0% e 99,99%.");
      const next = { ...settings, targetMarginBps: Math.round(pctNum * 100) };
      const r = await suggestReceiptPricingAction(receiptId, { ...next, priceTableId: tableId });
      if (!r.ok) return toast("error", r.error);
      const d = r.data!;
      setSettings(next);
      setLines(d.lines);
      const st = initialState(d.lines);
      setPrices(st.prices);
      setInclude(st.include);
      touch();
    });

  const runPreview = () =>
    start(async () => {
      if (!selected.length) return toast("error", "Marque ao menos um item com novo preço.");
      const r = await previewReceiptPricingAction(receiptId, { priceTableId: tableId, lines: selected.map((l) => ({ skuId: l.skuId, newPrice: prices[l.skuId] })) });
      if (!r.ok) return toast("error", r.error);
      setPreview(r.data as { lines: PreviewRow[]; totals: Totals });
      setResult(null);
    });

  const apply = () =>
    start(async () => {
      if (!preview) return;
      const ok = preview.lines.filter((l) => l.status === "change");
      const r = await applyReceiptPricingAction(receiptId, { priceTableId: tableId, lines: ok.map((l) => ({ skuId: l.skuId, newPrice: l.newPrice!, expectedPrice: l.currentPrice })), idemKey: `${idem}:${tableId}:${ok.map((l) => `${l.skuId}=${l.newPrice}`).join(",")}`, note: note || null });
      if (!r.ok) return toast("error", r.error);
      toast("success", r.message ?? "Preços atualizados.");
      setResult((r.data as { lines: ApplyRow[] }).lines);
      setPreview(null);
      router.refresh();
    });

  const allOn = lines.length > 0 && lines.every((l) => include[l.skuId]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Regra da sugestão</h2>
        <p className="mt-0.5 text-xs text-slate-500">A sugestão parte do custo desta entrada (com frete e despesas rateados). Você pode ajustar o preço de cada item antes de revisar.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Sugerir preço por">
            <Select value={settings.mode} onChange={(e) => setSettings({ ...settings, mode: e.target.value as PricingMode })} options={[{ value: "keep_margin", label: "Manter a margem atual do produto" }, { value: "target_margin", label: "Margem padrão" }]} />
          </Field>
          <Field label="Margem padrão (%)" hint={settings.mode === "keep_margin" ? "Usada quando o produto não tem margem atual." : "Preço = custo ÷ (1 − margem)."}>
            <Input inputMode="decimal" value={marginText} onChange={(e) => setMarginText(e.target.value)} className="tabular" />
          </Field>
          <Field label="Arredondamento">
            <Select value={settings.ending} onChange={(e) => setSettings({ ...settings, ending: e.target.value as PriceEnding })} options={ENDINGS} />
          </Field>
          <Field label="Tabela de preço">
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)} options={tables} />
          </Field>
          <div className="flex items-end">
            <Button type="button" onClick={recalc} loading={pending}>
              <Calculator className="size-4" /> Recalcular sugestões
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Itens do recebimento</h2>
            <p className="text-xs text-slate-500">Margem = (preço − custo) ÷ preço. Itens marcados entram na revisão; os demais ficam como estão.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const st = initialState(lines);
                setPrices(st.prices);
                setInclude(st.include);
                touch();
              }}
            >
              <RotateCcw className="size-4" /> Voltar às sugestões
            </Button>
            <Button type="button" variant="primary" onClick={runPreview} loading={pending} disabled={!selected.length}>
              <Eye className="size-4" /> Revisar {selected.length} alteração(ões)
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Marcar todos"
                    checked={allOn}
                    onChange={(e) => {
                      setInclude(Object.fromEntries(lines.map((l) => [l.skuId, e.target.checked])));
                      touch();
                    }}
                  />
                </th>
                <th>Produto</th>
                <th className="text-right">Qtd. recebida</th>
                <th className="text-right">Custo anterior</th>
                <th className="text-right">Custo novo</th>
                <th className="text-right">Preço atual</th>
                <th className="text-right" title="Preço atual sobre o custo anterior">Margem antes</th>
                <th className="text-right" title="Preço atual sobre o custo novo">Margem atual</th>
                <th className="text-right">Sugerido</th>
                <th className="w-40 text-right">Novo preço</th>
                <th className="text-right">Margem resultante</th>
                <th className="text-right">Variação</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = prices[l.skuId];
                const m = p != null && l.cost ? marginBps(p, l.cost) : null;
                const varBps = p != null && l.currentPrice ? Math.round(((p - l.currentPrice) * 10000) / l.currentPrice) : null;
                return (
                  <tr key={l.skuId} className={cn(!include[l.skuId] && "text-slate-500")}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${l.name}`}
                        checked={Boolean(include[l.skuId])}
                        onChange={(e) => {
                          setInclude({ ...include, [l.skuId]: e.target.checked });
                          touch();
                        }}
                      />
                    </td>
                    <td>
                      {l.name}
                      <span className="block font-mono text-xs text-slate-500">{l.sku}</span>
                      {l.message && <span className="block text-xs text-slate-500">{l.message}</span>}
                    </td>
                    <td className="tabular text-right">{formatQty(l.qty)}</td>
                    <td className="tabular text-right">{formatMoney(l.oldCost)}</td>
                    <td className="tabular text-right">
                      {formatMoney(l.cost)}
                      <span className="block text-xs"><Variation bps={l.costVariationBps} /></span>
                    </td>
                    <td className="tabular text-right">{l.currentPrice == null ? <span className="text-amber-700">Sem preço</span> : formatMoney(l.currentPrice)}</td>
                    <td className="text-right"><MarginCell bps={l.marginBeforeEntry} /></td>
                    <td className="text-right"><MarginCell bps={l.marginBefore} /></td>
                    <td className="tabular text-right text-slate-600">{formatMoney(l.suggestedPrice)}</td>
                    <td>
                      <MoneyInput
                        ariaLabel={`Novo preço de ${l.name}`}
                        value={p ?? 0}
                        onChange={(v) => {
                          setPrices({ ...prices, [l.skuId]: v > 0 ? v : null });
                          if (!include[l.skuId] && v > 0) setInclude({ ...include, [l.skuId]: true });
                          touch();
                        }}
                      />
                    </td>
                    <td className="text-right"><MarginCell bps={m} /></td>
                    <td className="text-right"><Variation bps={varBps} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lines.length === 0 && <p className="p-4 text-sm text-slate-500">Nenhum item estocado neste recebimento.</p>}
      </section>

      {preview && (
        <section className="rounded-lg border-2 border-brand-300 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Prévia — nada foi gravado ainda</h2>
              <p className="mt-0.5 text-xs text-slate-600">{previewSummary(preview.totals)}. Margem-alvo usada: {settings.mode === "keep_margin" ? "margem atual de cada produto" : formatBps(settings.targetMarginBps)}.</p>
            </div>
          </div>
          {preview.totals.belowCost ? <div className="mt-3"><Notice tone="warn">Há preço abaixo do custo na lista. Confira antes de aplicar.</Notice></div> : null}
          <div className="mt-3"><PricePreviewTable rows={preview.lines} /></div>
          {canApply ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Field label="Observação (opcional — vai para o histórico de preços)" className="min-w-[260px] flex-1">
                <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: reajuste do fornecedor em outubro" />
              </Field>
              <Button type="button" variant="accent" onClick={apply} loading={pending} disabled={!preview.totals.change}>
                <CheckCircle2 className="size-4" /> Confirmar e aplicar {preview.totals.change} preço(s)
              </Button>
            </div>
          ) : (
            <div className="mt-3"><Notice tone="warn">Para aplicar os preços é preciso a permissão de alterar produtos. Peça a quem tem a permissão.</Notice></div>
          )}
        </section>
      )}

      {result && (
        <section className="rounded-lg border border-line bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Resultado da aplicação</h2>
            {labelsHref && (
              <LinkButton href={labelsHref} size="sm">
                <Tag className="size-4" /> Imprimir etiquetas com os novos preços
              </LinkButton>
            )}
          </div>
          <ApplyResultTable rows={result} />
        </section>
      )}
    </div>
  );
}
