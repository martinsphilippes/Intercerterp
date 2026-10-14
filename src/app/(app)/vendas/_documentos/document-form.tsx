"use client";

import Link from "@/components/ui/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, FormSection, Input, Select, Textarea, inputClass } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatBps, formatMoney, formatQty, QTY } from "@/lib/money";
import { cartTotals, effectiveUnitPrice, tablePrice, type CartItem } from "@/domain/cart-calc";
import { saveDocumentAction, searchDocSkusAction, type DocSkuHit } from "./actions";

type Opt = { value: string; label: string };
type Line = CartItem & { description?: string | null };

export interface DocFormInitial {
  id?: string;
  type: "quote" | "order";
  number?: number;
  customerId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  sellerId?: string | null;
  priceTableId?: string | null;
  items: Line[];
  globalDiscount?: number;
  globalDiscountBps?: number;
  surcharge?: number;
  validUntil?: string | null;
  deliveryDate?: string | null;
  paymentTermId?: string | null;
  paymentNotes?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
}

/** Pesquisa de produto com preço vigente da tabela escolhida (mesma resolução do PDV). */
function ProductPicker({ priceTableId, onPick }: { priceTableId: string | null; onPick: (h: DocSkuHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DocSkuHit[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => {
      start(async () => {
        const r = await searchDocSkusAction(q, priceTableId);
        if (!r.ok) return setError(r.error);
        setError(null);
        setHits(r.data ?? []);
        setOpen(true);
      });
    }, 250);
  }, [q, priceTableId]);
  const pick = (h: DocSkuHit) => {
    onPick(h);
    setQ("");
    setHits([]);
    setOpen(false);
  };
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = hits.find((h) => h.price > 0);
            if (first) pick(first);
          }
        }}
        placeholder="Pesquisar produto por nome, SKU ou código de barras"
        aria-label="Pesquisar produto"
        className={cn(inputClass, "h-9 pl-8")}
      />
      {pending && <span className="absolute right-2.5 top-2.5 size-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && q.trim().length >= 2 && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {hits.length === 0 && !pending && <li className="px-3 py-2 text-sm text-slate-500">Nenhum produto encontrado.</li>}
          {hits.map((h) => (
            <li key={h.skuId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                disabled={h.price <= 0}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <span>
                  <span className="font-medium text-ink">{h.name}</span>
                  <span className="block text-xs text-slate-500">{h.sku}{h.service ? " · serviço" : h.available != null ? ` · disponível ${formatQty(h.available, h.unitCode)}` : ""}</span>
                </span>
                <span className="tabular whitespace-nowrap text-xs text-slate-600">{h.price > 0 ? formatMoney(h.price) : "sem preço"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentForm({
  initial,
  customers,
  sellers,
  priceTables,
  terms,
  defaultValidUntil,
  discountLimitBps,
  canOverLimit,
}: {
  initial: DocFormInitial;
  customers: Array<Opt & { phone?: string | null }>;
  sellers: Opt[];
  priceTables: Opt[];
  terms: Opt[];
  defaultValidUntil: string | null;
  discountLimitBps: number;
  canOverLimit: boolean;
}) {
  const isQuote = initial.type === "quote";
  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const [contactName, setContactName] = useState(initial.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(initial.contactPhone ?? "");
  const [sellerId, setSellerId] = useState(initial.sellerId ?? "");
  const [priceTableId, setPriceTableId] = useState(initial.priceTableId ?? "");
  const [items, setItems] = useState<Line[]>(initial.items);
  const [discountMode, setDiscountMode] = useState<"value" | "pct">(initial.globalDiscountBps ? "pct" : "value");
  const [globalDiscount, setGlobalDiscount] = useState(initial.globalDiscount ?? 0);
  const [globalPct, setGlobalPct] = useState(initial.globalDiscountBps ? String(initial.globalDiscountBps / 100).replace(".", ",") : "");
  const [surcharge, setSurcharge] = useState(initial.surcharge ?? 0);
  const [validUntil, setValidUntil] = useState(initial.validUntil ?? defaultValidUntil ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initial.deliveryDate ?? "");
  const [termId, setTermId] = useState(initial.paymentTermId ?? "");
  const [paymentNotes, setPaymentNotes] = useState(initial.paymentNotes ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(initial.internalNotes ?? "");
  const [approvalLogin, setApprovalLogin] = useState("");
  const [approvalPassword, setApprovalPassword] = useState("");
  const pctBps = Math.round((Number(globalPct.replace(",", ".")) || 0) * 100);
  const totals = useMemo(() => cartTotals({ items, globalDiscount: discountMode === "value" ? globalDiscount : 0, globalDiscountBps: discountMode === "pct" ? pctBps : 0, surcharge }), [items, globalDiscount, pctBps, discountMode, surcharge]);
  const discBps = totals.subtotal > 0 ? Math.round((totals.discountTotal * 10000) / totals.subtotal) : 0;
  const overLimit = !canOverLimit && discBps > discountLimitBps;
  const setItem = (i: number, patch: Partial<Line>) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const payload = JSON.stringify({
    customerId: customerId || null,
    contactName: customerId ? null : contactName || null,
    contactPhone: customerId ? null : contactPhone || null,
    sellerId: sellerId || null,
    priceTableId: priceTableId || null,
    items: items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice ?? null, itemDiscount: i.itemDiscount ?? 0, itemSurcharge: i.itemSurcharge ?? 0, description: i.description ?? null })),
    globalDiscount: discountMode === "value" ? globalDiscount : 0,
    globalDiscountBps: discountMode === "pct" ? pctBps : 0,
    surcharge,
    validUntil: isQuote ? validUntil || null : null,
    deliveryDate: deliveryDate || null,
    paymentTermId: termId || null,
    paymentNotes,
    notes,
    internalNotes,
    approvalLogin: approvalLogin || null,
    approvalPassword: approvalPassword || null,
  });
  const back = initial.id ? `/vendas/${isQuote ? "orcamentos" : "pedidos"}/${initial.id}` : `/vendas/${isQuote ? "orcamentos" : "pedidos"}`;
  return (
    <ActionForm action={saveDocumentAction} className="space-y-5">
      {({ pending, error }) => (
        <>
          {initial.id && <input type="hidden" name="id" value={initial.id} />}
          <input type="hidden" name="type" value={initial.type} />
          <input type="hidden" name="payload" value={payload} />
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-5">
              <FormSection title="Cliente e vendedor">
                <FormGrid cols={isQuote ? 3 : 2}>
                  <Field label="Cliente cadastrado" required={!isQuote} hint={isQuote ? "Opcional no orçamento: sem cadastro, informe nome e telefone do contato." : "Pedido exige cliente cadastrado."}>
                    <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} options={customers} placeholder={isQuote ? "Sem cadastro (contato)" : "Selecione…"} aria-label="Cliente" />
                  </Field>
                  {isQuote && !customerId && (
                    <>
                      <Field label="Nome do contato"><Input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} placeholder="Ex.: Construtora Silva" /></Field>
                      <Field label="Telefone / WhatsApp"><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} inputMode="tel" placeholder="(11) 90000-0000" /></Field>
                    </>
                  )}
                  <Field label="Vendedor" hint="Registrado no documento e na venda gerada no PDV.">
                    <Select value={sellerId} onChange={(e) => setSellerId(e.target.value)} options={sellers} placeholder="Vendedor do cliente / você" aria-label="Vendedor" />
                  </Field>
                </FormGrid>
              </FormSection>

              <FormSection title="Produtos" description="Preço vigente da tabela escolhida (atacado pela quantidade). Preço digitado abaixo da tabela vira desconto do item, como no PDV; limites de desconto e aprovação são os mesmos da venda.">
                <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_220px]">
                  <ProductPicker
                    priceTableId={priceTableId || null}
                    onPick={(h) =>
                      setItems((a) => [
                        ...a,
                        { skuId: h.skuId, qty: QTY, unitPrice: null, itemDiscount: 0, itemSurcharge: 0, sku: h.sku, name: h.name, unitCode: h.unitCode, listPrice: h.price, wholesalePrice: h.wholesalePrice, wholesaleMinQty: h.wholesaleMinQty, available: h.available, service: h.service, maxDiscountBps: h.maxDiscountBps },
                      ])
                    }
                  />
                  <Select value={priceTableId} onChange={(e) => setPriceTableId(e.target.value)} options={priceTables} placeholder="Tabela padrão da filial" aria-label="Tabela de preço" />
                </div>
                {priceTableId !== (initial.priceTableId ?? "") && items.length > 0 && <p className="mb-2 text-xs text-amber-700">A tabela mudou: os preços dos itens já lançados serão recalculados no servidor ao salvar.</p>}
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-slate-500">Nenhum produto. Pesquise acima para adicionar.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-base w-full min-w-[720px] text-sm">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="w-28 text-right">Qtd.</th>
                          <th className="w-32 text-right">Preço unit.</th>
                          <th className="w-28 text-right">Desc. (R$)</th>
                          <th className="text-right">Total</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => {
                          const line = totals.items[i];
                          const table = tablePrice(it);
                          const short = !it.service && it.available != null && it.qty > it.available;
                          return (
                            <tr key={`${it.skuId}-${i}`}>
                              <td>
                                {it.description || it.name}
                                <span className="block text-xs text-slate-500">
                                  {it.sku} · {it.unitCode}
                                  {table !== (it.listPrice ?? 0) && <Badge tone="accent" className="ml-1">atacado</Badge>}
                                  {short && <Badge tone="warn" className="ml-1">disponível {formatQty(it.available)}</Badge>}
                                </span>
                              </td>
                              <td><QtyInput value={it.qty} onChange={(v) => setItem(i, { qty: v })} ariaLabel={`Quantidade de ${it.name}`} /></td>
                              <td>
                                <MoneyInput value={effectiveUnitPrice(it)} onChange={(v) => setItem(i, { unitPrice: v === table ? null : v })} ariaLabel={`Preço de ${it.name}`} />
                                {it.unitPrice != null && it.unitPrice !== table && <span className="block text-right text-xs text-slate-400 line-through">{formatMoney(table)}</span>}
                              </td>
                              <td><MoneyInput value={it.itemDiscount ?? 0} onChange={(v) => setItem(i, { itemDiscount: v })} ariaLabel={`Desconto de ${it.name}`} /></td>
                              <td className="tabular text-right">{formatMoney(line?.total ?? 0)}</td>
                              <td className="text-right">
                                <Button type="button" variant="ghost" size="sm" aria-label={`Remover ${it.name}`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>
                                  <Trash2 className="size-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </FormSection>

              <FormSection title="Condições e observações">
                <FormGrid cols={3}>
                  {isQuote && (
                    <Field label="Validade do orçamento" required>
                      <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                    </Field>
                  )}
                  <Field label="Previsão de entrega">
                    <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                  </Field>
                  <Field label="Condição de pagamento">
                    <Select value={termId} onChange={(e) => setTermId(e.target.value)} options={terms} placeholder="—" aria-label="Condição de pagamento" />
                  </Field>
                  <Field label="Forma de pagamento combinada" className={isQuote ? "sm:col-span-3" : "sm:col-span-1"}>
                    <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} maxLength={300} placeholder="Ex.: 30% de entrada + boleto 30/60" />
                  </Field>
                </FormGrid>
                <FormGrid cols={2} className="mt-4">
                  <Field label="Observações ao cliente" hint="Saem na impressão e na mensagem.">
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                  </Field>
                  <Field label="Observações internas" hint="Não saem na impressão.">
                    <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} />
                  </Field>
                </FormGrid>
              </FormSection>
            </div>

            <div className="space-y-5">
              <FormSection title="Resumo">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt>Subtotal ({items.length} itens)</dt><dd className="tabular">{formatMoney(totals.subtotal)}</dd></div>
                  <div className="flex justify-between text-slate-600"><dt>Descontos nos itens</dt><dd className="tabular">− {formatMoney(totals.itemDiscounts)}</dd></div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <dt>Desconto geral</dt>
                      <dd className="flex gap-1">
                        {(["value", "pct"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => setDiscountMode(m)} className={cn("rounded px-2 py-0.5 text-xs", discountMode === m ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700")}>{m === "value" ? "R$" : "%"}</button>
                        ))}
                      </dd>
                    </div>
                    {discountMode === "value" ? (
                      <MoneyInput value={globalDiscount} onChange={setGlobalDiscount} ariaLabel="Desconto geral em reais" />
                    ) : (
                      <Input value={globalPct} onChange={(e) => setGlobalPct(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Desconto geral em percentual" />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3"><dt>Acréscimo / frete</dt><dd className="w-36"><MoneyInput value={surcharge} onChange={setSurcharge} ariaLabel="Acréscimo" /></dd></div>
                  <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular">{formatMoney(totals.total)}</dd></div>
                  <p className="text-xs text-slate-500">Desconto total {formatBps(discBps)} · seu limite {formatBps(discountLimitBps)}{canOverLimit ? " (pode aprovar acima)" : ""}</p>
                </dl>
                {overLimit && (
                  <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-900">Desconto acima do seu limite: informe login e senha de quem pode aprovar (fica registrado no documento).</p>
                    <Input value={approvalLogin} onChange={(e) => setApprovalLogin(e.target.value)} placeholder="Login do aprovador" aria-label="Login do aprovador" autoComplete="off" />
                    <Input type="password" value={approvalPassword} onChange={(e) => setApprovalPassword(e.target.value)} placeholder="Senha" aria-label="Senha do aprovador" autoComplete="new-password" />
                  </div>
                )}
              </FormSection>
              <Notice tone="info" title={isQuote ? "O orçamento não movimenta nada" : "Pedido reserva estoque"}>
                {isQuote
                  ? "Estoque e financeiro só mudam quando o orçamento é vendido no PDV ou convertido em pedido e faturado."
                  : "Ao salvar, o pedido reserva o saldo disponível pelo prazo do parâmetro. Estoque e títulos são movimentados pela venda no PDV ou pela NF-e que faturar o pedido."}
              </Notice>
            </div>
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
            <Link href={back} className={buttonClass("ghost")}>Cancelar</Link>
            <SubmitButton pending={pending} variant="accent">{initial.id ? "Salvar alterações" : isQuote ? "Salvar orçamento" : "Salvar pedido"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
