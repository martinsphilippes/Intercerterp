"use client";

import { useState } from "react";
import { Laptop, Smartphone, Columns3, Check } from "lucide-react";
import { ActionButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import type { ActionResult } from "@/lib/server/action";
import { TEMPLATES, TEMPLATE_KEYS, type TemplateKey } from "@/domain/ecommerce/templates";
import { StorePreview, type PreviewProduct } from "./store-preview";

/** Tela 50: visualizar e comparar os três modelos (computador/celular); aplicar muda só o rascunho da loja. */
export function TemplateGallery({
  current,
  accent,
  storeName,
  title,
  tagline,
  canApply,
  apply,
  products = [],
  categories = [],
  offer = null,
}: {
  current: TemplateKey;
  accent: string;
  storeName: string;
  title: string;
  tagline: string;
  canApply: boolean;
  apply: Record<TemplateKey, (fd: FormData) => Promise<ActionResult<any>>>;
  /** produtos reais da vitrine: cada modelo aparece com o catálogo da loja */
  products?: PreviewProduct[];
  categories?: string[];
  offer?: PreviewProduct | null;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [compare, setCompare] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Modelo no rascunho: <strong className="text-ink">{TEMPLATES[current].name}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label="Dispositivo da prévia" className="inline-flex overflow-hidden rounded-md border border-slate-300">
            <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${device === "desktop" ? "bg-brand-50 font-medium text-brand-800" : "bg-white text-slate-600"}`}>
              <Laptop className="size-4" aria-hidden /> Computador
            </button>
            <button type="button" onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"} className={`flex items-center gap-1.5 border-l border-slate-300 px-3 py-1.5 text-sm ${device === "mobile" ? "bg-brand-50 font-medium text-brand-800" : "bg-white text-slate-600"}`}>
              <Smartphone className="size-4" aria-hidden /> Celular
            </button>
          </div>
          <button type="button" onClick={() => setCompare((v) => !v)} aria-pressed={compare} className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50">
            <Columns3 className="size-4" aria-hidden /> {compare ? "Ocultar comparação" : "Comparar modelos"}
          </button>
        </div>
      </div>
      {compare && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table-base w-full text-sm">
            <caption className="sr-only">Comparação dos modelos</caption>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Foco da página</th>
                <th>Composição inicial</th>
                <th>Grade (computador)</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_KEYS.map((k) => (
                <tr key={k}>
                  <td className="font-medium text-ink">{TEMPLATES[k].name}</td>
                  <td>{TEMPLATES[k].purpose}</td>
                  <td className="text-slate-600">{TEMPLATES[k].description}</td>
                  <td>{TEMPLATES[k].gridColumns} produtos por linha</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Escolher a estrutura é uma decisão de apresentação: catálogo, estoque, pedidos, checkout e pagamento continuam os mesmos em qualquer modelo.</p>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {TEMPLATE_KEYS.map((k) => {
          const t = TEMPLATES[k];
          const isCurrent = k === current;
          return (
            <article key={k} className={`flex flex-col rounded-xl border bg-white ${isCurrent ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200"}`}>
              <div className="rounded-t-xl bg-slate-50 p-3">
                <StorePreview template={k} accent={isCurrent ? accent : t.suggestedAccent} storeName={storeName} title={title} tagline={tagline} device={device} compact products={products} categories={categories} offer={offer} />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-ink">{t.name}</h3>
                  {isCurrent ? <Badge tone="good">No rascunho</Badge> : <Badge>{t.purpose}</Badge>}
                </div>
                <p className="flex-1 text-sm text-slate-600">{t.description}</p>
                {canApply &&
                  (isCurrent ? (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                      <Check className="size-4" aria-hidden /> Modelo aplicado
                    </p>
                  ) : (
                    <ActionButton action={apply[k]} label="Aplicar ao rascunho" variant="primary" confirm={`Aplicar o modelo ${t.name} ao rascunho da loja? Produtos, pedidos e configurações continuam como estão.`} />
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
