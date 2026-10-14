"use client";

import { useState } from "react";
import { PackagePlus, Link2, AlertTriangle } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { createProductsFromReceiptAction } from "../actions";

export interface NewProductPreview {
  idx: number;
  cProd: string | null;
  xProd: string;
  name: string;
  gtin: string | null;
  invalidGtin: string | null;
  existing: { skuId: string; sku: string; name: string } | null;
  ncm: string | null;
  cest: string | null;
  unitCode: string;
  uCom: string | null;
  cost: number;
  price: number | null;
}

interface Row {
  idx: number;
  include: boolean;
  name: string;
  unitCode: string;
  ncm: string;
  cest: string;
  price: number;
}

/**
 * Itens do XML sem vínculo: prévia do cadastro de produto com os dados da nota (descrição, GTIN, NCM, CEST, unidade e
 * custo) e preço de venda inicial. GTIN já cadastrado é vinculado ao produto existente, sem criar outro.
 */
export function NewProducts({ receiptId, items, units, marginBps, canPrice }: { receiptId: string; items: NewProductPreview[]; units: Array<{ value: string; label: string }>; marginBps: number; canPrice: boolean }) {
  const [rows, setRows] = useState<Row[]>(items.map((i) => ({ idx: i.idx, include: true, name: i.name, unitCode: i.unitCode, ncm: i.ncm ?? "", cest: i.cest ?? "", price: i.price ?? 0 })));
  const set = (idx: number, patch: Partial<Row>) => setRows((a) => a.map((r) => (r.idx === idx ? { ...r, ...patch } : r)));
  // todas as linhas vão no envio; o servidor usa a do botão "Cadastrar" da linha (only) ou as marcadas
  const payload = JSON.stringify(rows.map((r) => ({ idx: r.idx, include: r.include, name: r.name, unitCode: r.unitCode, ncm: r.ncm || null, cest: r.cest || null, price: r.price > 0 ? r.price : null })));
  const included = items.filter((i) => rows.find((r) => r.idx === i.idx)?.include);
  return (
    <section id="novos-produtos" className="mb-5 rounded-lg border border-accent-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><PackagePlus className="size-4 text-accent-600" aria-hidden /> Itens do XML sem produto cadastrado ({items.length})</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Confira a prévia: o produto nasce com descrição, GTIN, NCM, CEST, unidade e custo da nota e o código do fornecedor fica lembrado para as próximas notas.
            {marginBps > 0 ? ` Preço sugerido = custo × (1 + ${(marginBps / 100).toLocaleString("pt-BR")}% de margem padrão).` : " Sem margem padrão definida: informe o preço de venda ou deixe em branco para definir depois em Produtos."}
          </p>
        </div>
      </header>
      <ActionForm action={createProductsFromReceiptAction} className="space-y-3 p-5">
        {({ pending, error }) => (
          <>
            <input type="hidden" name="id" value={receiptId} />
            <input type="hidden" name="rows" value={payload} />
            <div className="-mx-5 overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-8"><span className="sr-only">Incluir</span></th>
                    <th>Item da nota</th>
                    <th>Nome do produto</th>
                    <th className="w-28">Unidade</th>
                    <th className="w-28">NCM</th>
                    <th className="w-28">CEST</th>
                    <th className="text-right">Custo</th>
                    <th className="w-36 text-right">Preço de venda</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const r = rows.find((x) => x.idx === it.idx)!;
                    return (
                      <tr key={it.idx} id={`novo-produto-${it.idx}`} className={cn("scroll-mt-24 target:bg-accent-50", !r.include && "opacity-60")}>
                        <td><input type="checkbox" aria-label={`Incluir ${it.xProd}`} className="accent-brand-700" checked={r.include} onChange={(e) => set(it.idx, { include: e.target.checked })} /></td>
                        <td className="min-w-[200px]">
                          <span className="block text-xs text-slate-500">{it.cProd} · {it.uCom}</span>
                          <span className="block">{it.xProd}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {it.gtin ? <Badge tone="neutral">GTIN {it.gtin}</Badge> : <Badge tone="warn">sem GTIN</Badge>}
                            {it.invalidGtin && <Badge tone="warn" title="Dígito verificador inválido: o código não será gravado">cEAN {it.invalidGtin} inválido</Badge>}
                          </span>
                        </td>
                        {it.existing ? (
                          <td colSpan={5} className="text-sm">
                            <span className="flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> O GTIN já pertence a <strong>{it.existing.name}</strong> (SKU {it.existing.sku}): o item será vinculado a esse produto — nenhum cadastro duplicado.</span>
                          </td>
                        ) : (
                          <>
                            <td className="min-w-[220px]"><Input aria-label="Nome do produto" value={r.name} maxLength={200} onChange={(e) => set(it.idx, { name: e.target.value })} className="h-8" /></td>
                            <td><Select aria-label="Unidade" value={r.unitCode} onChange={(e) => set(it.idx, { unitCode: e.target.value })} options={units} className="h-8" /></td>
                            <td><Input aria-label="NCM" value={r.ncm} inputMode="numeric" maxLength={8} onChange={(e) => set(it.idx, { ncm: e.target.value.replace(/\D/g, "") })} className="h-8" placeholder="8 dígitos" /></td>
                            <td><Input aria-label="CEST" value={r.cest} inputMode="numeric" maxLength={7} onChange={(e) => set(it.idx, { cest: e.target.value.replace(/\D/g, "") })} className="h-8" placeholder="opcional" /></td>
                            <td className="tabular text-right">{formatMoney(it.cost)}</td>
                          </>
                        )}
                        <td>{it.existing ? <span className="text-xs text-slate-500">—</span> : canPrice ? <MoneyInput value={r.price} onChange={(v) => set(it.idx, { price: v })} ariaLabel={`Preço de venda de ${r.name}`} /> : <span className="text-xs text-slate-500">sem permissão para preço</span>}</td>
                        <td>
                          <SubmitButton pending={pending} size="sm" variant="secondary" name="only" value={String(it.idx)}>
                            {it.existing ? <><Link2 className="size-4" /> Vincular</> : <><PackagePlus className="size-4" /> Cadastrar</>}
                          </SubmitButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {error && <Notice tone="bad">{error}</Notice>}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs text-slate-500" aria-live="polite">
                {included.length} selecionado(s): {included.filter((i) => !i.existing).length} produto(s) novo(s), {included.filter((i) => i.existing).length} vínculo(s) por GTIN já cadastrado.
              </p>
              <SubmitButton pending={pending} variant="accent">Cadastrar todos os selecionados</SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    </section>
  );
}
