"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { ActionForm, ActionButton, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid, Checkbox } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { formatBps, formatMoney, marginBps, markupBps } from "@/lib/money";
import {
  uploadImageAction,
  removeImageAction,
  saveConversionAction,
  deleteConversionAction,
  saveCostsAction,
  savePriceAction,
  deletePriceAction,
  saveStockParamsAction,
  initialBalanceAction,
} from "../actions";

type Opt = { value: string; label: string };

// ───────────────────────────── Imagem

export function ImagePanel({ productId, imageFileId, canEdit }: { productId: string; imageFileId: string | null; canEdit: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex aspect-square w-full max-w-[220px] items-center justify-center overflow-hidden rounded-md border border-line bg-slate-50">
        {imageFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${imageFileId}?inline=1`} alt="Imagem do produto" className="size-full object-contain" />
        ) : (
          <span className="text-xs text-slate-400">Sem imagem</span>
        )}
      </div>
      {canEdit && (
        <ActionForm action={uploadImageAction} resetOnSuccess className="space-y-2">
          {({ pending }) => (
            <>
              <input type="hidden" name="id" value={productId} />
              <input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" className="block w-full text-xs file:mr-2 file:rounded file:border file:border-line file:bg-white file:px-2 file:py-1" />
              <div className="flex gap-2">
                <SubmitButton pending={pending} size="sm" variant="secondary">
                  <Upload className="size-4" /> Enviar imagem
                </SubmitButton>
                {imageFileId && <ActionButton size="sm" variant="ghost" action={removeImageAction.bind(null, productId)} label="Remover" icon={<X className="size-4" />} confirm="Remover a imagem do produto?" />}
              </div>
              <p className="text-xs text-slate-500">PNG, JPG, WEBP ou GIF até 5 MB.</p>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}

// ───────────────────────────── Conversões de unidade

export function ConversionsPanel({ productId, unitCode, units, conversions, canEdit }: { productId: string; unitCode: string; units: Opt[]; conversions: Array<{ id: string; fromUnit: string; toUnit: string; factor: number }>; canEdit: boolean }) {
  return (
    <div className="space-y-3">
      {conversions.length === 0 ? (
        <p className="text-sm text-slate-500">Sem conversões. Ex.: compra em CX com 12 {unitCode}.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {conversions.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1.5">
              <span className="tabular">
                1 {c.fromUnit} = {(c.factor / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {c.toUnit}
              </span>
              {canEdit && <ActionButton size="sm" variant="ghost" action={deleteConversionAction.bind(null, productId, c.id)} label="" icon={<Trash2 className="size-4" />} confirm="Remover a conversão?" />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <ActionForm action={saveConversionAction} resetOnSuccess className="space-y-2">
          {({ pending }) => (
            <>
              <input type="hidden" name="productId" value={productId} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="1 unidade de">
                  <Select name="fromUnit" defaultValue={units.find((u) => u.value !== unitCode)?.value ?? ""} options={units.map((u) => ({ value: u.value, label: u.value }))} />
                </Field>
                <Field label="Equivale a">
                  <QtyInput name="factor" defaultValue={1000} />
                </Field>
                <Field label="Unidade" className="col-span-2">
                  <Select name="toUnit" defaultValue={unitCode} options={units} />
                </Field>
              </div>
              <div className="flex justify-end">
                <SubmitButton pending={pending} size="sm" variant="secondary">
                  <Plus className="size-4" /> Adicionar conversão
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}

// ───────────────────────────── Custos

export interface SkuCost {
  id: string;
  sku: string;
  name: string;
  costAcquisition: number;
  additionalCosts: Array<{ name: string; amount: number }>;
  costTotal: number;
}

export function CostDialogButton({ productId, sku, variantsCount }: { productId: string; sku: SkuCost; variantsCount: number }) {
  const [open, setOpen] = useState(false);
  const [acq, setAcq] = useState(sku.costAcquisition ?? 0);
  const [extra, setExtra] = useState(sku.additionalCosts ?? []);
  const total = acq + extra.reduce((a, c) => a + (c.amount || 0), 0);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Custo
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Custo — ${sku.sku}`} size="lg">
        <ActionForm action={saveCostsAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="skuId" value={sku.id} />
              <input type="hidden" name="additionalCosts" value={JSON.stringify(extra.filter((c) => c.name.trim()))} />
              <FormGrid cols={2}>
                <Field label="Custo de aquisição">
                  <MoneyInput name="costAcquisition" value={acq} onChange={setAcq} />
                </Field>
                <Field label="Custo total (aquisição + adicionais)">
                  <div className="tabular flex h-9 items-center rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold">{formatMoney(total)}</div>
                </Field>
              </FormGrid>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">Custos adicionais</p>
                {extra.map((c, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
                    <Input aria-label="Nome do custo" placeholder="Ex.: Frete, embalagem" value={c.name} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
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
              <Field label="Motivo da alteração" hint="Fica no histórico de custos.">
                <Input name="reason" placeholder="Ex.: reajuste do fornecedor" />
              </Field>
              {variantsCount > 1 && <Checkbox name="applyToAll" label={`Aplicar a todas as ${variantsCount} variações`} />}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>Salvar custo</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

// ───────────────────────────── Preços

export interface PriceRowData {
  id: string;
  priceTableId: string;
  skuId: string;
  branchId: string | null;
  price: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  maxDiscountBps: number | null;
  validFrom: string | null;
  validTo: string | null;
}

export function PriceDialogButton({ productId, tables, branches, skus, price, defaultTableId, label }: { productId: string; tables: Opt[]; branches: Opt[]; skus: Array<{ id: string; sku: string; name: string; costTotal: number }>; price?: PriceRowData; defaultTableId: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(price?.price ?? 0);
  const [selected, setSelected] = useState<string[]>(price ? [price.skuId] : skus.map((s) => s.id));
  const cost = skus.find((s) => s.id === (price?.skuId ?? selected[0]))?.costTotal ?? 0;
  return (
    <>
      <Button type="button" size="sm" variant={price ? "ghost" : "primary"} onClick={() => setOpen(true)}>
        {price ? <Pencil className="size-4" /> : <Plus className="size-4" />} {label ?? (price ? "" : "Novo preço")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={price ? "Alterar preço" : "Novo preço"} size="lg">
        <ActionForm action={savePriceAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="productId" value={productId} />
              {price && <input type="hidden" name="id" value={price.id} />}
              {price && <input type="hidden" name="skuId" value={price.skuId} />}
              <FormGrid cols={2}>
                <Field label="Tabela de preço" required>
                  <Select name="priceTableId" defaultValue={price?.priceTableId ?? defaultTableId ?? ""} options={tables} />
                </Field>
                <Field label="Filial" hint="Preço específico da filial tem prioridade sobre o geral.">
                  <Select name="branchId" defaultValue={price?.branchId ?? ""} options={branches} placeholder="Todas as filiais" />
                </Field>
              </FormGrid>
              {!price && skus.length > 1 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-600">Variações</p>
                  <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                    {skus.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="skuIds" value={s.id} className="size-4 accent-brand-700" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                        <span className="font-mono text-xs">{s.sku}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {!price && skus.length === 1 && <input type="hidden" name="skuIds" value={skus[0].id} />}
              <FormGrid cols={4}>
                <Field label="Preço" required>
                  <MoneyInput name="price" value={value} onChange={setValue} />
                </Field>
                <Field label="Preço de atacado">
                  <MoneyInput name="wholesalePrice" defaultValue={price?.wholesalePrice ?? 0} />
                </Field>
                <Field label="Qtd. mínima atacado">
                  <QtyInput name="wholesaleMinQty" defaultValue={price?.wholesaleMinQty ?? 0} />
                </Field>
                <Field label="Desconto máximo (%)">
                  <Input name="maxDiscount" inputMode="decimal" defaultValue={price?.maxDiscountBps != null ? String(price.maxDiscountBps / 100).replace(".", ",") : ""} />
                </Field>
                <Field label="Vigência — início" hint="Vazio = imediato.">
                  <Input type="date" name="validFrom" defaultValue={price?.validFrom ?? ""} />
                </Field>
                <Field label="Vigência — fim" hint="Vazio = sem fim.">
                  <Input type="date" name="validTo" defaultValue={price?.validTo ?? ""} />
                </Field>
                <Field label="Motivo" className="lg:col-span-2">
                  <Input name="reason" placeholder="Ex.: promoção de inverno" />
                </Field>
              </FormGrid>
              <p className="text-xs text-slate-500">
                Custo de referência {formatMoney(cost)} · margem {formatBps(marginBps(value, cost))} · markup {formatBps(markupBps(value, cost))}. Toda alteração fica no histórico de preços.
              </p>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>Salvar preço</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function DeletePriceButton({ productId, priceId }: { productId: string; priceId: string }) {
  return <ActionButton size="sm" variant="ghost" action={deletePriceAction.bind(null, productId, priceId)} label="" icon={<Trash2 className="size-4" />} confirm="Remover este preço? A remoção fica registrada no histórico." title="Remover preço" />;
}

// ───────────────────────────── Estoque

export function StockParamsButton({ productId, row }: { productId: string; row: { warehouseId: string; skuId: string; sku: string; warehouseName: string; minQty: number; maxQty: number; safetyQty: number; reorderMultiple: number; location: string | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} title="Parâmetros de estoque">
        <Pencil className="size-4" />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Parâmetros — ${row.sku} · ${row.warehouseName}`}>
        <ActionForm action={saveStockParamsAction} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="warehouseId" value={row.warehouseId} />
              <input type="hidden" name="skuId" value={row.skuId} />
              <FormGrid cols={2}>
                <Field label="Estoque mínimo"><QtyInput name="minQty" defaultValue={row.minQty} /></Field>
                <Field label="Máximo / alvo"><QtyInput name="maxQty" defaultValue={row.maxQty} /></Field>
                <Field label="Estoque de segurança"><QtyInput name="safetyQty" defaultValue={row.safetyQty} /></Field>
                <Field label="Múltiplo de compra"><QtyInput name="reorderMultiple" defaultValue={row.reorderMultiple} /></Field>
                <Field label="Localização" className="sm:col-span-2"><Input name="location" defaultValue={row.location ?? ""} maxLength={60} placeholder="Ex.: A-03-2" /></Field>
              </FormGrid>
              <p className="text-xs text-slate-500">Parâmetros não alteram o saldo. Mínimo e segurança alimentam alertas e a reposição.</p>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>Salvar</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function InitialBalanceForm({ productId, skus, warehouses }: { productId: string; skus: Array<{ value: string; label: string; cost: number }>; warehouses: Opt[] }) {
  const [sku, setSku] = useState(skus[0]?.value ?? "");
  const cost = skus.find((s) => s.value === sku)?.cost ?? 0;
  return (
    <ActionForm action={initialBalanceAction} resetOnSuccess className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {({ pending }) => (
        <>
          <input type="hidden" name="productId" value={productId} />
          <Field label="Variação">
            <Select name="skuId" value={sku} onChange={(e) => setSku(e.target.value)} options={skus} />
          </Field>
          <Field label="Depósito">
            <Select name="warehouseId" options={warehouses} />
          </Field>
          <Field label="Quantidade">
            <QtyInput name="qty" defaultValue={0} />
          </Field>
          <Field label="Custo unitário" hint={`Padrão: custo total ${formatMoney(cost)}`}>
            <MoneyInput key={sku} name="unitCost" defaultValue={cost} />
          </Field>
          <SubmitButton pending={pending} variant="secondary">Lançar saldo inicial</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
