import { ProductBarcode } from "@/components/ui/barcode";
import { formatMoney } from "@/lib/money";
import type { LabelItem, LabelModel } from "@/domain/labels";

/**
 * Folhas de etiquetas em milímetros (impressão pelo navegador em escala 100%):
 *  - gondola: 64 × 34 mm, 3 por linha em A4 (21 por folha);
 *  - adesiva: 50 × 25 mm, rolo de 2 colunas (largura 104 mm);
 *  - a4: 66,7 × 25,4 mm, 3 × 10 por folha (tipo Pimaco 6180), quebra de página a cada 30.
 */
const PAGE_CSS: Record<LabelModel, string> = {
  gondola: "@page { size: A4; margin: 8mm; }",
  adesiva: "@page { size: 104mm 25mm; margin: 0; }",
  a4: "@page { size: A4; margin: 12.7mm 4.7mm 0 4.7mm; }",
};

const GRID: Record<LabelModel, React.CSSProperties> = {
  gondola: { display: "grid", gridTemplateColumns: "repeat(3, 64mm)", gridAutoRows: "34mm", gap: "2mm" },
  adesiva: { display: "grid", gridTemplateColumns: "repeat(2, 50mm)", gridAutoRows: "25mm", columnGap: "2mm", rowGap: 0, width: "104mm", paddingLeft: "1mm" },
  a4: { display: "grid", gridTemplateColumns: "repeat(3, 66.7mm)", gridAutoRows: "25.4mm", columnGap: "3.1mm", rowGap: 0 },
};

const PER_PAGE: Record<LabelModel, number> = { gondola: 21, adesiva: 2, a4: 30 };

function Label({ item, model }: { item: LabelItem; model: LabelModel }) {
  const code = item.barcode || item.sku;
  const price = item.price != null ? formatMoney(item.price) : "Sem preço";
  if (model === "gondola") {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-[1mm] border border-dashed border-slate-400 bg-white p-[1.5mm] text-black">
        <p className="line-clamp-2 text-[8.5pt] font-semibold uppercase leading-tight">{item.name}</p>
        <div className="mt-auto flex items-end justify-between gap-[1mm]">
          <div className="min-w-0">
            <p className="text-[6.5pt] leading-none">{item.unitCode ? `${item.unitCode} · ` : ""}{item.sku}</p>
            <p className="tabular text-[17pt] font-extrabold leading-none">{price}</p>
          </div>
          <ProductBarcode value={code} className="h-[12mm] w-[26mm] shrink-0" />
        </div>
      </div>
    );
  }
  if (model === "adesiva") {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-white px-[1.5mm] py-[1mm] text-black">
        <p className="truncate text-[6.5pt] font-semibold uppercase leading-tight">{item.name}</p>
        <ProductBarcode value={code} className="mx-auto h-[12mm] w-[42mm]" />
        <p className="tabular text-center text-[10pt] font-extrabold leading-none">{price}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center gap-[1.5mm] overflow-hidden bg-white px-[2mm] text-black">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[7pt] font-semibold uppercase leading-tight">{item.name}</p>
        <p className="tabular mt-[0.5mm] text-[12pt] font-extrabold leading-none">{price}</p>
        <p className="truncate text-[5.5pt] leading-none">{item.sku}</p>
      </div>
      <ProductBarcode value={code} className="h-[15mm] w-[30mm] shrink-0" />
    </div>
  );
}

export function LabelSheet({ items, model }: { items: LabelItem[]; model: LabelModel }) {
  const flat = items.flatMap((i) => Array.from({ length: i.copies }, () => i));
  const per = PER_PAGE[model];
  const pages: LabelItem[][] = [];
  for (let i = 0; i < flat.length; i += per) pages.push(flat.slice(i, i + per));
  return (
    <>
      <style>{`${PAGE_CSS[model]} @media print { .lg\\:pl-64 { padding-left: 0 !important; } main { padding: 0 !important; max-width: none !important; } body { background: #fff !important; } .label-page { break-after: page; box-shadow: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; } .label-page:last-child { break-after: auto; } }`}</style>
      <div className="overflow-x-auto rounded-lg border border-line bg-slate-100 p-4 print:overflow-visible print:border-0 print:bg-white print:p-0">
        {pages.map((pg, n) => (
          <div key={n} className="label-page mx-auto mb-4 w-fit bg-white p-[4mm] shadow-sm" style={GRID[model]}>
            {pg.map((it, i) => (
              <Label key={`${it.skuId}-${i}`} item={it} model={model} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
