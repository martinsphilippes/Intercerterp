"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { ActionForm, ActionButton, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Checkbox, FormGrid } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { EmptyState } from "@/components/ui/empty";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SkuPicker } from "@/app/(app)/compras/_shared/sku-picker";
import { saveSupplierProductAction, removeSupplierProductAction } from "../actions";

export interface SpRow {
  id: string;
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  productId: string | null;
  supplierCode: string | null;
  supplierDescription: string | null;
  conversionFactor: number;
  lastCost: number | null;
  lastPurchaseAt: string | null;
  leadTimeDays: number | null;
  minQty: number | null;
  multiple: number | null;
  preferred: boolean;
}

export function SupplierProducts({ supplierId, rows, canEdit, defaultLead }: { supplierId: string; rows: SpRow[]; canEdit: boolean; defaultLead: number | null }) {
  const [editing, setEditing] = useState<Partial<SpRow> | null>(null);
  return (
    <div>
      {canEdit && (
        <div className="flex justify-end border-b border-line p-3">
          <Button size="sm" variant="primary" onClick={() => setEditing({ conversionFactor: 1000, preferred: false })}>
            <Plus className="size-4" /> Vincular produto
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title="Nenhum produto vinculado" description="Vincule produtos com o código do fornecedor para importar XML sem redigitação e sugerir custo/prazo nas compras. O recebimento também aprende os vínculos." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Produto (SKU interno)</th>
                <th>Cód. fornecedor</th>
                <th className="text-right">Conversão</th>
                <th className="text-right">Último custo</th>
                <th>Última compra</th>
                <th className="text-right">Prazo</th>
                <th className="text-right">Lote mínimo</th>
                <th className="text-right">Múltiplo</th>
                <th>Preferencial</th>
                {canEdit && <th className="text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.productId ? <Link className="text-brand-700 hover:underline" href={`/produtos/${r.productId}`}>{r.name}</Link> : r.name}
                    <span className="block text-xs text-slate-500">{r.sku}</span>
                  </td>
                  <td>
                    <span className="font-mono text-xs">{r.supplierCode ?? "—"}</span>
                    {r.supplierDescription && <span className="block text-xs text-slate-500">{r.supplierDescription}</span>}
                  </td>
                  <td className="tabular text-right">{r.conversionFactor === 1000 ? "1:1" : `1 = ${formatQty(r.conversionFactor)} ${r.unitCode}`}</td>
                  <td className="tabular text-right">{formatMoney(r.lastCost)}</td>
                  <td>{formatDate(r.lastPurchaseAt)}</td>
                  <td className="tabular text-right">{r.leadTimeDays != null ? `${r.leadTimeDays} d` : defaultLead != null ? <span className="text-slate-400">{defaultLead} d (cadastro)</span> : "—"}</td>
                  <td className="tabular text-right">{r.minQty ? formatQty(r.minQty, r.unitCode) : "—"}</td>
                  <td className="tabular text-right">{r.multiple ? formatQty(r.multiple, r.unitCode) : "—"}</td>
                  <td>{r.preferred ? <span className="inline-flex items-center gap-1 text-accent-700"><Star className="size-3.5 fill-current" /> Sim</span> : "—"}</td>
                  {canEdit && (
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" aria-label={`Editar ${r.sku}`} onClick={() => setEditing(r)}>
                          <Pencil className="size-4" />
                        </Button>
                        <ActionButton size="sm" variant="ghost" icon={<Trash2 className="size-4" />} label="" title="Remover vínculo" action={removeSupplierProductAction.bind(null, r.id, supplierId)} confirm={`Remover o vínculo de ${r.sku} com este fornecedor?`} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Editar vínculo — ${editing.sku}` : "Vincular produto ao fornecedor"} size="lg">
        {editing && (
          <ActionForm action={saveSupplierProductAction} onSuccess={() => setEditing(null)} className="space-y-4">
            {({ pending, error }) => (
              <>
                <input type="hidden" name="supplierId" value={supplierId} />
                <input type="hidden" name="skuId" value={editing.skuId ?? ""} />
                {!editing.id && (
                  <Field label="Produto" required>
                    {editing.skuId ? (
                      <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                        <span>{editing.name} <span className="text-xs text-slate-500">{editing.sku}</span></span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ ...editing, skuId: undefined })}>Trocar</Button>
                      </div>
                    ) : (
                      <SkuPicker autoFocus onPick={(h) => setEditing({ ...editing, skuId: h.id, sku: h.sku, name: h.name, unitCode: h.unitCode, lastCost: editing.lastCost ?? h.costAcquisition })} />
                    )}
                  </Field>
                )}
                <FormGrid cols={2} key={editing.skuId ?? "none"}>
                  <Field label="Código no fornecedor" hint="Usado para associar itens do XML da NF-e (cProd).">
                    <Input name="supplierCode" defaultValue={editing.supplierCode ?? ""} />
                  </Field>
                  <Field label="Descrição no fornecedor">
                    <Input name="supplierDescription" defaultValue={editing.supplierDescription ?? ""} />
                  </Field>
                  <Field label={`Conversão: 1 unidade do fornecedor = (${editing.unitCode ?? "un."} internas)`} hint="Ex.: caixa com 12 → 12.">
                    <QtyInput name="conversionFactor" defaultValue={editing.conversionFactor ?? 1000} ariaLabel="Fator de conversão" />
                  </Field>
                  <Field label="Último custo (por unidade interna)">
                    <MoneyInput name="lastCost" defaultValue={editing.lastCost ?? 0} />
                  </Field>
                  <Field label="Prazo de entrega (dias)" hint="Vazio = prazo do cadastro do fornecedor.">
                    <Input name="leadTimeDays" type="number" min={0} defaultValue={editing.leadTimeDays ?? ""} />
                  </Field>
                  <div />
                  <Field label="Lote mínimo (un. internas)">
                    <QtyInput name="minQty" defaultValue={editing.minQty ?? 0} ariaLabel="Lote mínimo" />
                  </Field>
                  <Field label="Múltiplo de compra (un. internas)">
                    <QtyInput name="multiple" defaultValue={editing.multiple ?? 0} ariaLabel="Múltiplo de compra" />
                  </Field>
                </FormGrid>
                <Checkbox name="preferred" label="Fornecedor preferencial para este produto (usado na reposição)" defaultChecked={Boolean(editing.preferred)} />
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                  <SubmitButton pending={pending}>Salvar vínculo</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )}
      </Dialog>
    </div>
  );
}
