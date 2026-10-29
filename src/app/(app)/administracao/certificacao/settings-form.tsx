"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import type { CertificationSettings, CertProduct } from "@/domain/accounting";
import { CERT_HOLDERS, CERT_PRODUCT_TYPES, CERT_SUPPLIERS } from "@/domain/accounting/cert-catalog";
import { saveCertificationSettingsAction } from "@/app/(app)/contabil/certificados/actions";

/** Linha do catálogo em edição: preço digitado em reais (texto), convertido em centavos ao enviar. */
interface RowState {
  uid: number;
  key: string;
  /** já existe no catálogo salvo: o identificador não muda (as solicitações apontam para ele) */
  existing: boolean;
  label: string;
  months: string;
  price: string;
  active: boolean;
  // rede de certificação (§43)
  acCost: string;
  type: string;
  holder: string;
  supplier: string;
  editable: boolean;
}

const fmtReais = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "1.234,56" ou "1234.56" → centavos (0 quando ilegível; o servidor valida o valor). */
function toCents(text: string): number {
  let s = text.trim().replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

let seq = 0;
const fromProduct = (p: CertProduct): RowState => ({
  uid: ++seq, key: p.key, existing: true, label: p.label, months: String(p.months), price: fmtReais(p.price), active: p.active !== false,
  acCost: p.acCost == null ? "" : fmtReais(p.acCost), type: p.type ?? "", holder: p.holder ?? "", supplier: p.supplier ?? "", editable: p.editable !== false,
});
const blank = (): RowState => ({ uid: ++seq, key: "", existing: false, label: "", months: "12", price: "", active: true, acCost: "", type: "a1", holder: "pj", supplier: "soluti", editable: true });
const sel = "focus-ring h-9 rounded-md border border-line bg-white px-2 text-sm";

/**
 * Parâmetros da certificação (equipe): catálogo editável em tabela, instruções de pagamento e base do link de pagamento.
 * O catálogo é serializado no campo oculto "catalog" (JSON com price em centavos) para saveCertificationSettingsAction.
 */
export function SettingsForm({ settings }: { settings: CertificationSettings }) {
  const [rows, setRows] = useState<RowState[]>(() => settings.catalog.map(fromProduct));
  const update = (uid: number, patch: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const remove = (uid: number) => setRows((rs) => rs.filter((r) => r.uid !== uid));
  const catalog = rows.map((r) => ({
    key: slug(r.key), label: r.label.trim(), months: Number(r.months) || 12, price: toCents(r.price), active: r.active,
    acCost: r.acCost.trim() ? toCents(r.acCost) : null, type: r.type || null, holder: r.holder || null, supplier: r.supplier || null, editable: r.editable,
  }));
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <ActionForm action={saveCertificationSettingsAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="catalog" value={JSON.stringify(catalog)} />
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Catálogo de produtos</h3>
                <p className="text-xs text-slate-500">Produtos que o escritório pode solicitar. Um produto inativo deixa de aparecer nas novas solicitações; as em andamento não mudam.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, blank()])} disabled={pending}>
                <Plus className="size-3.5" aria-hidden /> Adicionar produto
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Identificador</th>
                    <th className="px-3 py-2 text-left font-medium">Descrição</th>
                    <th className="px-3 py-2 text-left font-medium">Meses</th>
                    <th className="px-3 py-2 text-left font-medium">Preço (R$)</th>
                    <th className="px-3 py-2 text-left font-medium">Custo AC (R$)</th>
                    <th className="px-3 py-2 text-left font-medium">Tipo · titular · AC</th>
                    <th className="px-3 py-2 text-left font-medium">Preço editável na rede</th>
                    <th className="px-3 py-2 text-left font-medium">Ativo</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="sr-only">Remover</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-sm text-slate-500">
                        Nenhum produto. Adicione ao menos um produto ativo.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.uid} className={r.active ? undefined : "bg-slate-50/60"}>
                      <td className="px-3 py-2 align-top">
                        {r.existing ? (
                          <span className="block">
                            <span className="font-mono text-xs">{r.key}</span>
                            <Badge className="mt-1">já em uso</Badge>
                          </span>
                        ) : (
                          <Input value={r.key} onChange={(e) => update(r.uid, { key: e.target.value })} placeholder="ex.: ecnpj_a1_12m" required aria-label="Identificador do produto" className="min-w-[150px] font-mono text-xs" disabled={pending} />
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input value={r.label} onChange={(e) => update(r.uid, { label: e.target.value })} placeholder="ex.: e-CNPJ A1 · 12 meses" required aria-label="Descrição do produto" className="min-w-[200px]" disabled={pending} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input type="number" min={1} max={120} step={1} value={r.months} onChange={(e) => update(r.uid, { months: e.target.value })} required aria-label="Validade em meses" className="w-20" disabled={pending} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input inputMode="decimal" value={r.price} onChange={(e) => update(r.uid, { price: e.target.value })} onBlur={() => r.price.trim() && update(r.uid, { price: fmtReais(toCents(r.price)) })} placeholder="199,00" required aria-label="Preço em reais" className="tabular w-28 text-right" disabled={pending} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Input inputMode="decimal" value={r.acCost} onChange={(e) => update(r.uid, { acCost: e.target.value })} onBlur={() => r.acCost.trim() && update(r.uid, { acCost: fmtReais(toCents(r.acCost)) })} placeholder="opcional" aria-label="Custo pago à AC em reais" className="tabular w-28 text-right" disabled={pending} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex flex-wrap gap-1">
                          <select className={sel} value={r.type} onChange={(e) => update(r.uid, { type: e.target.value })} aria-label="Tipo" disabled={pending}>
                            <option value="">—</option>
                            {CERT_PRODUCT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <select className={sel} value={r.holder} onChange={(e) => update(r.uid, { holder: e.target.value })} aria-label="Titular" disabled={pending}>
                            <option value="">—</option>
                            {CERT_HOLDERS.map((o) => <option key={o.value} value={o.value}>{o.value.toUpperCase()}</option>)}
                          </select>
                          <select className={sel} value={r.supplier} onChange={(e) => update(r.uid, { supplier: e.target.value })} aria-label="AC de 1º nível" disabled={pending}>
                            <option value="">—</option>
                            {CERT_SUPPLIERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <label className="inline-flex h-9 items-center gap-2 text-sm">
                          <input type="checkbox" checked={r.editable} onChange={(e) => update(r.uid, { editable: e.target.checked })} className="focus-ring size-4 rounded border-line accent-brand-700" disabled={pending} aria-label="Preço editável na rede" />
                          {r.editable ? "Sim" : "Fixo"}
                        </label>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <label className="inline-flex h-9 items-center gap-2 text-sm">
                          <input type="checkbox" checked={r.active} onChange={(e) => update(r.uid, { active: e.target.checked })} className="focus-ring size-4 rounded border-line accent-brand-700" disabled={pending} aria-label="Produto ativo" />
                          {r.active ? "Ativo" : "Inativo"}
                        </label>
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <Button type="button" variant="ghost" size="sm" onClick={() => remove(r.uid)} disabled={pending} title={r.existing ? "Remove do catálogo (prefira inativar se houver solicitações em andamento)" : "Remover linha"}>
                          <Trash2 className="size-3.5" aria-hidden /> Remover
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {rows.length.toLocaleString("pt-BR")} {rows.length === 1 ? "produto" : "produtos"} · {activeCount.toLocaleString("pt-BR")} {activeCount === 1 ? "ativo" : "ativos"}
              {rows.length > 0 && ` · menor preço ${formatMoney(Math.min(...catalog.map((c) => c.price)))}`}
            </p>
          </section>

          <Field label="Instruções de pagamento" hint="Entram no texto da cobrança que o escritório envia ao cliente (chave Pix, dados bancários, prazo). Até 1000 caracteres.">
            <Textarea name="paymentInstructions" rows={3} maxLength={1000} defaultValue={settings.paymentInstructions} placeholder="Ex.: Pix para a chave pagamentos@intercert.com.br, informando o protocolo." disabled={pending} />
          </Field>
          <Field label="Base do link de pagamento (opcional)" hint="Endereço https:// do gateway; o protocolo (ex.: CERT-0001) é acrescentado ao final. O gateway de pagamento com confirmação automática é uma pendência externa (docs/pendencias-externas.md): até lá, a equipe confirma o pagamento pela referência da transação.">
            <Input type="url" name="paymentUrlBase" pattern="https://.*" defaultValue={settings.paymentUrlBase ?? ""} placeholder="https://pagamento.intercert.com.br" disabled={pending} />
          </Field>

          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>
              <Save className="size-4" aria-hidden /> Salvar parâmetros
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
