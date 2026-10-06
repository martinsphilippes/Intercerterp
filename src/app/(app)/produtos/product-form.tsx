"use client";

import { useState } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, Checkbox, FormGrid, FormSection } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatBps, formatMoney, marginBps, markupBps } from "@/lib/money";
import { createProductAction, updateProductAction } from "./actions";
import { VariantsEditor, parseAxes, toVariantPayload, type AxisDraft, type VariantDraft } from "./variants-editor";

type Opt = { value: string; label: string };

export interface ProductFormOptions {
  units: Opt[];
  categories: Opt[];
  brands: Opt[];
  suppliers: Opt[];
  taxGroups: Array<Opt & { detail?: string }>;
  origins: Opt[];
  cstOptions: Opt[];
  regimeLabel: string;
  warehouses: Opt[];
  canStock: boolean;
  branchName: string | null;
  defaultTableName: string | null;
}

const CREATE_TABS = [
  { key: "geral", label: "Dados gerais" },
  { key: "variacoes", label: "Variações" },
  { key: "precos", label: "Custos e preços" },
  { key: "estoque", label: "Estoque" },
  { key: "fiscal", label: "Fiscal" },
];

/** Campos gerais (compartilhados por cadastro e edição). */
function ImagePicker() {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <label className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-md border-2 border-dashed border-line bg-slate-50 text-center text-xs text-slate-500 hover:border-brand-300">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Prévia da imagem" className="size-full object-contain" />
      ) : (
        <>
          <ImagePlus className="size-7 text-slate-400" aria-hidden />
          <span className="font-medium text-slate-700">Imagem principal</span>
          <span>PNG, JPG, WEBP · até 5 MB</span>
          <span className="text-brand-700 underline">Selecionar imagem</span>
        </>
      )}
      <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => {
        const f = e.target.files?.[0];
        setUrl(f ? URL.createObjectURL(f) : null);
      }} />
    </label>
  );
}

function GeneralFields({ p, o, type, setType, code, setCode, withImage }: { p: Record<string, any>; o: ProductFormOptions; type: string; setType: (t: string) => void; code: string; setCode: (c: string) => void; withImage?: boolean }) {
  return (
    <div className={withImage ? "grid gap-5 lg:grid-cols-[180px_1fr]" : undefined}>
      {withImage && <div><ImagePicker /></div>}
      <div>
      <FormGrid cols={4}>
        <Field label="Tipo" required>
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: "product", label: "Produto" }, { value: "service", label: "Serviço" }]} />
        </Field>
        <Field label="Nome" required className="sm:col-span-2 lg:col-span-3">
          <Input name="name" maxLength={200} defaultValue={p.name ?? ""} placeholder="Ex.: Camiseta algodão básica" />
        </Field>
        <Field label="Código interno" hint={p.id ? undefined : "Gerado automaticamente se vazio."}>
          <Input name="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} className="font-mono" />
        </Field>
        <Field label="GTIN/EAN" hint={type === "service" ? "Não se aplica a serviço." : "Código de barras principal (validado)."}>
          <Input name="gtin" defaultValue={p.gtin ?? ""} inputMode="numeric" className="font-mono" disabled={type === "service"} />
        </Field>
        <Field label="Unidade" required>
          <Select name="unitCode" defaultValue={p.unitCode ?? "UN"} options={o.units} />
        </Field>
        <Field label="Peso (g)">
          <Input name="weightGrams" type="number" min={0} defaultValue={p.weightGrams ?? ""} />
        </Field>
        <Field label="Categoria">
          <Select name="categoryId" defaultValue={p.categoryId ?? ""} options={o.categories} placeholder="—" />
        </Field>
        <Field label="Marca">
          <Select name="brandId" defaultValue={p.brandId ?? ""} options={o.brands} placeholder="—" />
        </Field>
        <Field label="Fornecedor principal" className="lg:col-span-2">
          <Select name="supplierId" defaultValue={p.supplierId ?? ""} options={o.suppliers} placeholder="—" />
        </Field>
      </FormGrid>
      <Field label="Descrição" className="mt-4">
        <Textarea name="description" defaultValue={p.description ?? ""} rows={3} />
      </Field>
      <div className="mt-4 flex flex-wrap gap-6">
        <Checkbox name="active" label="Ativo" defaultChecked={p.active ?? true} />
        <Checkbox name="availablePdv" label="Disponível no PDV" defaultChecked={p.availablePdv ?? true} />
        <Checkbox name="availableEcommerce" label="Disponível para loja virtual (atributo de integração)" defaultChecked={p.availableEcommerce ?? false} />
      </div>
      </div>
    </div>
  );
}

/** Campos fiscais conforme tipo e regime — nada é fixo para todos os produtos. */
function FiscalFields({ p, o, type }: { p: Record<string, any>; o: ProductFormOptions; type: string }) {
  const [tg, setTg] = useState<string>(p.taxGroupId ?? "");
  const detail = o.taxGroups.find((t) => t.value === tg)?.detail;
  if (type === "service") {
    return (
      <>
        <Notice tone="info">Serviço: tributação municipal (ISS) para NFS-e. NCM, CFOP e ICMS não se aplicam.</Notice>
        <FormGrid cols={4} className="mt-4">
          <Field label="Item da lista (LC 116)" hint="Ex.: 14.09">
            <Input name="serviceListItem" defaultValue={p.serviceListItem ?? ""} placeholder="00.00" />
          </Field>
          <Field label="Código de tributação municipal">
            <Input name="municipalServiceCode" defaultValue={p.municipalServiceCode ?? ""} />
          </Field>
          <Field label="Alíquota de ISS (%)" hint="Entre 0% e 5%.">
            <Input name="issRate" inputMode="decimal" defaultValue={p.issRateBps != null ? String(p.issRateBps / 100).replace(".", ",") : ""} />
          </Field>
          <Field label="CNAE do serviço">
            <Input name="cnaeService" defaultValue={p.cnaeService ?? ""} inputMode="numeric" />
          </Field>
        </FormGrid>
      </>
    );
  }
  return (
    <>
      <p className="mb-3 text-xs text-slate-500">Regime da empresa: <strong>{o.regimeLabel}</strong>. CFOP e CST/CSOSN do produto são opcionais: quando vazios, valem os do grupo tributário para cada operação.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-line p-4">
          <p className="mb-3 text-sm font-semibold">Classificação fiscal</p>
          <FormGrid cols={2}>
            <Field label="NCM" required hint="8 dígitos — sem NCM o produto fica “Incompleto” e não pode ser emitido.">
              <Input name="ncm" defaultValue={p.ncm ? `${p.ncm.slice(0, 4)}.${p.ncm.slice(4, 6)}.${p.ncm.slice(6)}` : ""} inputMode="numeric" maxLength={10} className="font-mono" placeholder="0000.00.00" />
            </Field>
            <Field label="CEST" hint="7 dígitos, obrigatório com substituição tributária.">
              <Input name="cest" defaultValue={p.cest ? `${p.cest.slice(0, 2)}.${p.cest.slice(2, 5)}.${p.cest.slice(5)}` : ""} inputMode="numeric" maxLength={9} className="font-mono" placeholder="00.000.00" />
            </Field>
            <Field label="Origem da mercadoria" className="sm:col-span-2">
              <Select name="origin" defaultValue={p.origin ?? "0"} options={o.origins} />
            </Field>
          </FormGrid>
        </div>
        <div className="rounded-md border border-line p-4">
          <p className="mb-3 text-sm font-semibold">Regras tributárias</p>
          <FormGrid cols={2}>
            <Field label="Grupo tributário" className="sm:col-span-2" hint={detail}>
              <Select name="taxGroupId" value={tg} onChange={(e) => setTg(e.target.value)} options={o.taxGroups} placeholder="—" />
            </Field>
            <Field label="CFOP padrão (venda interna)" hint="Opcional; interestadual usa 6xxx.">
              <Input name="cfop" defaultValue={p.cfop ?? ""} inputMode="numeric" maxLength={4} className="font-mono" placeholder="Do grupo" />
            </Field>
            <Field label={o.regimeLabel.startsWith("Simples") ? "CSOSN" : "CST ICMS"}>
              <Select name="cstCsosn" defaultValue={p.cstCsosn ?? ""} options={o.cstOptions} placeholder="Do grupo tributário" />
            </Field>
          </FormGrid>
        </div>
      </div>
      <div className="mt-4">
        <Notice tone="warn">A configuração tributária deve ser validada pelo contador antes da emissão em produção. Os grupos de demonstração não são regra tributária universal.</Notice>
      </div>
    </>
  );
}

/** Progresso do preenchimento por seção (obrigatórias × opcionais). */
function ProgressSteps({ steps }: { steps: Array<{ label: string; done: boolean; optional?: boolean }> }) {
  const required = steps.filter((x) => !x.optional);
  const done = required.filter((x) => x.done).length;
  return (
    <div aria-label={`Preenchimento: ${done} de ${required.length} seções obrigatórias`}>
      <div className="flex gap-1">
        {steps.map((x) => (
          <div key={x.label} title={`${x.label}: ${x.done ? "preenchido" : x.optional ? "opcional" : "pendente"}`} className={cn("h-1.5 flex-1 rounded-full", x.done ? (x.optional ? "bg-brand-200" : "bg-brand-600") : "bg-slate-200")} />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">{done} de {required.length} seções obrigatórias preenchidas (nome, preço e NCM); variações e estoque são opcionais.</p>
    </div>
  );
}

/** Cadastro de produto com abas (estado único; a aba ativa fica na URL). */
export function ProductCreateForm({ o, initialTab }: { o: ProductFormOptions; initialTab: string }) {
  const [tab, setTabState] = useState(CREATE_TABS.some((t) => t.key === initialTab) ? initialTab : "geral");
  const [type, setType] = useState("product");
  const [code, setCode] = useState("");
  const [withVariants, setWithVariants] = useState(false);
  const [axes, setAxes] = useState<AxisDraft[]>([{ name: "Cor", values: "" }, { name: "Tamanho", values: "" }]);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [cost, setCost] = useState(0);
  const [extra, setExtra] = useState<Array<{ name: string; amount: number }>>([]);
  const [price, setPrice] = useState(0);
  const [wholesale, setWholesale] = useState(0);
  const [filled, setFilled] = useState({ name: false, ncm: false });
  const totalCost = cost + extra.reduce((a, c) => a + (c.amount || 0), 0);
  const setTab = (k: string) => {
    setTabState(k);
    window.history.replaceState(null, "", `?tab=${k}`);
  };
  const hasVariants = withVariants && parseAxes(axes).length > 0 && variants.length > 0;
  return (
    <ActionForm action={createProductAction} className="space-y-4">
      {({ pending, error }) => (
        <div
          onInput={(e) => {
            const t = e.target as HTMLInputElement;
            if (t.name === "name") setFilled((f) => ({ ...f, name: t.value.trim().length > 0 }));
            if (t.name === "ncm") setFilled((f) => ({ ...f, ncm: t.value.replace(/\D/g, "").length === 8 }));
          }}
          className="space-y-4"
        >
          <ProgressSteps
            steps={[
              { label: "Dados gerais", done: filled.name },
              { label: "Variações", done: !withVariants || hasVariants, optional: true },
              { label: "Custos e preços", done: price > 0 },
              { label: "Estoque", done: true, optional: true },
              { label: "Fiscal", done: type === "service" || filled.ncm },
            ]}
          />
          <div role="tablist" className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line">
            {CREATE_TABS.filter((t) => !(type === "service" && (t.key === "estoque" || t.key === "variacoes"))).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab}
                onClick={() => setTab(t.key)}
                className={cn("focus-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === tab ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="axes" value={hasVariants ? JSON.stringify(parseAxes(axes)) : "[]"} />
          <input type="hidden" name="variants" value={hasVariants ? JSON.stringify(toVariantPayload(variants)) : "[]"} />
          <input type="hidden" name="additionalCosts" value={JSON.stringify(extra.filter((c) => c.name.trim()))} />

          <div hidden={tab !== "geral"}>
            <FormSection title="Dados gerais" description="Identificação comercial, classificação e disponibilidade nos canais.">
              <GeneralFields p={{}} o={o} type={type} setType={setType} code={code} setCode={setCode} withImage />
            </FormSection>
          </div>

          <div hidden={tab !== "variacoes"}>
            <FormSection title="Variações" description="Produtos com grade (cor, tamanho…) têm um SKU por combinação, com código de barras e saldo próprios.">
              <Checkbox label="Este produto tem variações" checked={withVariants} onChange={(e) => setWithVariants(e.target.checked)} />
              {withVariants ? (
                <div className="mt-4">
                  <VariantsEditor axes={axes} setAxes={setAxes} variants={variants} setVariants={setVariants} productCode={code} />
                  {!hasVariants && <p className="mt-3 text-xs text-amber-700">Preencha os valores e clique em “Gerar combinações”.</p>}
                </div>
              ) : (
                <FormGrid cols={3} className="mt-4">
                  <Field label="SKU" hint="Vazio = código interno.">
                    <Input name="sku" className="font-mono" placeholder={code || "Automático"} />
                  </Field>
                </FormGrid>
              )}
            </FormSection>
          </div>

          <div hidden={tab !== "precos"}>
            <FormSection title="Custos" description="Custo de aquisição e custos adicionais nomeados (frete, embalagem, impostos não recuperáveis). Aplicados a todas as variações.">
              <FormGrid cols={4}>
                <Field label="Custo de aquisição">
                  <MoneyInput name="costAcquisition" value={cost} onChange={setCost} />
                </Field>
                <Field label="Custo total" hint="Aquisição + adicionais.">
                  <div className="tabular flex h-9 items-center rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold">{formatMoney(totalCost)}</div>
                </Field>
              </FormGrid>
              <div className="mt-3 space-y-2">
                {extra.map((c, i) => (
                  <div key={i} className="grid max-w-xl gap-2 sm:grid-cols-[1fr_180px_auto]">
                    <Input aria-label="Custo adicional" placeholder="Ex.: Frete" value={c.name} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <MoneyInput ariaLabel="Valor" value={c.amount} onChange={(v) => setExtra(extra.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                    <Button type="button" variant="ghost" aria-label="Remover" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => setExtra([...extra, { name: "", amount: 0 }])}>
                  <Plus className="size-4" /> Custo adicional
                </Button>
              </div>
            </FormSection>
            <div className="mt-4">
              <FormSection title="Preço padrão" description={`Gravado na tabela padrão${o.defaultTableName ? ` (${o.defaultTableName})` : ""}, sem vigência. Outras tabelas e vigências na aba Preços após salvar.`}>
                <FormGrid cols={4}>
                  <Field label="Preço de venda">
                    <MoneyInput name="price" value={price} onChange={setPrice} />
                  </Field>
                  <Field label="Preço de atacado" hint="Aplicado a partir da quantidade mínima.">
                    <MoneyInput name="wholesalePrice" value={wholesale} onChange={setWholesale} />
                  </Field>
                  <Field label="Qtd. mínima para atacado">
                    <QtyInput name="wholesaleMinQty" defaultValue={0} />
                  </Field>
                  <Field label="Desconto máximo (%)">
                    <Input name="maxDiscount" inputMode="decimal" placeholder="Ex.: 10" />
                  </Field>
                </FormGrid>
                <div className="mt-4 overflow-x-auto">
                  <table className="table-base w-full max-w-2xl text-sm">
                    <thead><tr><th>Preço</th><th className="text-right">Valor</th><th className="text-right">Lucro bruto</th><th className="text-right">Margem estimada (s/ preço)</th><th className="text-right">Markup (s/ custo)</th></tr></thead>
                    <tbody>
                      <tr><td>Tabela padrão</td><td className="tabular text-right">{formatMoney(price)}</td><td className="tabular text-right">{price ? formatMoney(price - totalCost) : "—"}</td><td className="tabular text-right font-semibold text-emerald-700">{formatBps(marginBps(price, totalCost), 1)}</td><td className="tabular text-right">{formatBps(markupBps(price, totalCost), 1)}</td></tr>
                      <tr><td>Atacado</td><td className="tabular text-right">{wholesale ? formatMoney(wholesale) : "—"}</td><td className="tabular text-right">{wholesale ? formatMoney(wholesale - totalCost) : "—"}</td><td className="tabular text-right font-semibold text-emerald-700">{wholesale ? formatBps(marginBps(wholesale, totalCost), 1) : "—"}</td><td className="tabular text-right">{wholesale ? formatBps(markupBps(wholesale, totalCost), 1) : "—"}</td></tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-slate-500">Margem = (preço − custo total) ÷ preço. Markup = (preço − custo total) ÷ custo total.</p>
                </div>
              </FormSection>
            </div>
          </div>

          <div hidden={tab !== "estoque"}>
            <FormSection title="Estoque" description={o.branchName ? `Parâmetros e saldo inicial no depósito da filial ${o.branchName}.` : "Selecione uma filial para definir parâmetros e saldo inicial."}>
              {!o.branchName || type === "service" ? (
                <Notice tone="info">{type === "service" ? "Serviços não controlam estoque." : "No contexto consolidado não há lançamento de estoque. Após salvar, use a aba Estoque do produto em uma filial."}</Notice>
              ) : (
                <>
                  <FormGrid cols={4}>
                    <Field label="Depósito">
                      <Select name="stockWarehouseId" defaultValue={o.warehouses[0]?.value ?? ""} options={o.warehouses} />
                    </Field>
                    <Field label="Saldo inicial" hint={hasVariants ? "Com variações, lance por variação na aba Estoque após salvar." : o.canStock ? "Gera movimento “Saldo inicial” ao custo total." : "Sem permissão de ajuste de estoque."}>
                      {o.canStock ? <QtyInput name="initialQty" defaultValue={0} /> : <div className="flex h-9 items-center rounded-md border border-line bg-slate-50 px-3 text-sm text-slate-500">—</div>}
                    </Field>
                    <Field label="Localização" hint="Ex.: A-03-2 (usada no inventário).">
                      <Input name="location" maxLength={60} />
                    </Field>
                  </FormGrid>
                  <FormGrid cols={4} className="mt-4">
                    <Field label="Estoque mínimo"><QtyInput name="minQty" defaultValue={0} /></Field>
                    <Field label="Máximo / alvo"><QtyInput name="maxQty" defaultValue={0} /></Field>
                    <Field label="Estoque de segurança"><QtyInput name="safetyQty" defaultValue={0} /></Field>
                    <Field label="Múltiplo de compra"><QtyInput name="reorderMultiple" defaultValue={0} /></Field>
                  </FormGrid>
                </>
              )}
            </FormSection>
          </div>

          <div hidden={tab !== "fiscal"}>
            <FormSection title="Dados fiscais" description="Usados na emissão de NF-e/NFC-e (produto) ou NFS-e (serviço).">
              <FiscalFields p={{}} o={o} type={type} />
            </FormSection>
          </div>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <p className="text-xs text-slate-500">Todas as abas são salvas juntas. {hasVariants ? `${variants.length} variações serão criadas.` : "Produto simples (1 SKU)."} Rascunho fica inativo (fora do PDV) até concluir.</p>
            <div className="flex gap-2">
              <SubmitButton pending={pending} variant="secondary" name="status" value="draft">Salvar rascunho</SubmitButton>
              <SubmitButton pending={pending} name="status" value="active">Salvar produto</SubmitButton>
            </div>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

/** Edição de uma seção (dados gerais ou fiscais) do produto existente. */
export function ProductEditForm({ product, o, section }: { product: Record<string, any>; o: ProductFormOptions; section: "general" | "fiscal" }) {
  const [type, setType] = useState<string>(product.type);
  const [code, setCode] = useState<string>(product.code ?? "");
  return (
    <ActionForm action={updateProductAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="section" value={section} />
          {section === "general" ? (
            <FormSection title="Dados gerais">
              <GeneralFields p={product} o={o} type={type} setType={setType} code={code} setCode={setCode} />
            </FormSection>
          ) : (
            <FormSection title="Dados fiscais" description="Usados na emissão de NF-e/NFC-e (produto) ou NFS-e (serviço).">
              <input type="hidden" name="type" value={product.type} />
              <FiscalFields p={product} o={o} type={product.type} />
            </FormSection>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>{section === "general" ? "Salvar dados gerais" : "Salvar dados fiscais"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
