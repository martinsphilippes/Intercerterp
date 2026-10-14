"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, FormGrid, Input } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { buildScaleBarcode, maxPluFor, scaleLayoutDef, type ScaleContent, type ScaleLayout } from "@/domain/scale-barcode";
import { saveScaleDataAction } from "../balanca/actions";

const NUTRITION: Array<{ key: string; label: string; unit: string }> = [
  { key: "kcal", label: "Valor energético", unit: "kcal" },
  { key: "carbs", label: "Carboidratos", unit: "g" },
  { key: "proteins", label: "Proteínas", unit: "g" },
  { key: "totalFat", label: "Gorduras totais", unit: "g" },
  { key: "saturatedFat", label: "Gorduras saturadas", unit: "g" },
  { key: "transFat", label: "Gorduras trans", unit: "g" },
  { key: "fiber", label: "Fibra alimentar", unit: "g" },
  { key: "sodium", label: "Sódio", unit: "mg" },
];

export interface ScalePanelProps {
  productId: string;
  unitCode: string;
  hasVariants: boolean;
  canEdit: boolean;
  price: number | null;
  config: { layout: ScaleLayout; content: ScaleContent };
  data: { plu: number | null; shelfLifeDays: number | null; scaleTare: number | null; scaleEnabled: boolean; nutrition: Record<string, any> | null };
}

const fmtNum = (v: unknown) => (v == null || v === "" ? "" : String(v).replace(".", ","));

/** Aba "Balança" do produto (CAD-16): PLU, validade, tara, informação nutricional e envio ao arquivo de carga. */
export function ScalePanel({ productId, unitCode, hasVariants, canEdit, price, config, data }: ScalePanelProps) {
  const [plu, setPlu] = useState(data.plu == null ? "" : String(data.plu));
  const layout = scaleLayoutDef(config.layout);
  const pluNum = Number(plu);
  const validPlu = Number.isInteger(pluNum) && pluNum >= 1;
  const fits = validPlu && pluNum <= maxPluFor(config.layout);
  // etiqueta de exemplo: 1,000 kg (peso) ou o preço de 1 kg (valor)
  const sampleAmount = config.content === "weight" ? 1000 : (price ?? 0);
  let sample: string | null = null;
  try {
    sample = fits && sampleAmount > 0 ? buildScaleBarcode(pluNum, sampleAmount, config.layout) : null;
  } catch {
    sample = null;
  }
  const n = data.nutrition ?? {};
  const kg = unitCode.toUpperCase() === "KG";

  return (
    <ActionForm action={saveScaleDataAction} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      {({ pending }) => (
        <>
          <input type="hidden" name="productId" value={productId} />
          <div className="space-y-4">
            {hasVariants && <Notice tone="warn">Produto com variações não pode ter PLU: a etiqueta da balança identifica um único item.</Notice>}
            {!kg && <Notice tone="info">O produto é vendido em {unitCode}. Etiquetas por peso exigem produto em KG; no arquivo de carga ele vai como item unitário.</Notice>}
            <Card title="Balança etiquetadora" description="O PLU é o código do produto na balança e vai impresso na etiqueta. O preço por kg vem sempre da tabela de preços.">
              <FormGrid cols={2}>
                <Field label="PLU (código na balança)" hint={`1 a 999999 · a etiqueta (${layout.mask}) comporta até ${maxPluFor(config.layout)}`}>
                  <Input name="plu" inputMode="numeric" value={plu} onChange={(e) => setPlu(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={!canEdit || hasVariants} />
                </Field>
                <Field label="Validade (dias)" hint="Impressa na etiqueta (0 = sem validade)">
                  <Input name="shelfLifeDays" inputMode="numeric" defaultValue={data.shelfLifeDays ?? ""} disabled={!canEdit} />
                </Field>
                <Field label="Tara (kg)" hint="Peso da embalagem descontado pela balança">
                  <QtyInput name="scaleTare" defaultValue={data.scaleTare ?? 0} />
                </Field>
                <Field label="Envio à balança">
                  <Checkbox name="scaleEnabled" label="Enviar no arquivo de carga" defaultChecked={data.scaleEnabled} disabled={!canEdit || hasVariants} />
                </Field>
              </FormGrid>
              {validPlu && !fits && <p className="mt-3 text-xs text-amber-700">PLU {pluNum} não cabe no código de {layout.codeDigits} dígitos configurado em Parâmetros (formato da etiqueta).</p>}
            </Card>
            <Card title="Informação nutricional" description="Dados por porção, para a tabela nutricional da etiqueta (valores em gramas, sódio em miligramas).">
              <FormGrid cols={3}>
                <Field label="Porção">
                  <Input name="nutrition.portion" placeholder="Ex.: 100 g" defaultValue={n.portion ?? ""} disabled={!canEdit} maxLength={40} />
                </Field>
                {NUTRITION.map((f) => (
                  <Field key={f.key} label={`${f.label} (${f.unit})`}>
                    <Input name={`nutrition.${f.key}`} inputMode="decimal" defaultValue={fmtNum(n[f.key])} disabled={!canEdit} />
                  </Field>
                ))}
              </FormGrid>
            </Card>
            {canEdit && (
              <div className="flex justify-end">
                <SubmitButton pending={pending}>
                  <Save className="size-4" /> Salvar dados de balança
                </SubmitButton>
              </div>
            )}
          </div>
          <Card title="Etiqueta no PDV" description="Como o código da etiqueta é lido na frente de caixa.">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-slate-500">Formato</dt><dd className="font-mono">{layout.mask}</dd></div>
              <div><dt className="text-xs text-slate-500">Informação</dt><dd>{config.content === "weight" ? "Peso (kg com 3 casas)" : "Valor total (centavos)"}</dd></div>
              <div><dt className="text-xs text-slate-500">Preço por {kg ? "kg" : unitCode} (tabela padrão)</dt><dd className="tabular">{price ? formatMoney(price) : "Sem preço"}</dd></div>
              <div>
                <dt className="text-xs text-slate-500">Etiqueta de exemplo {config.content === "weight" ? "(1,000 kg)" : `(${formatMoney(sampleAmount)})`}</dt>
                <dd className="font-mono">{sample ?? "—"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">O formato e a informação da etiqueta são definidos em Administração › Parâmetros (Vendas e PDV) e devem ser os mesmos configurados na balança.</p>
          </Card>
        </>
      )}
    </ActionForm>
  );
}
