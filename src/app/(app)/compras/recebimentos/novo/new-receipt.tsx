"use client";

import { useEffect, useState } from "react";
import { FileCode2, KeyRound, ClipboardList, Trash2, FileClock } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, FormGrid, Checkbox, Textarea } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty, lineTotal } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { SkuPicker } from "../../_shared/sku-picker";
import { importXmlAction, fetchByKeyAction, manualReceiptAction, pendingInvoiceEntryAction } from "../actions";

export interface OpenOrder {
  id: string;
  number: number;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedDate: string | null;
  remainingValue: number;
}

type Mode = "xml" | "key" | "manual" | "pending";
type Opt = { value: string; label: string };

interface ManualRow {
  key: number;
  skuId: string;
  sku: string;
  name: string;
  unitCode: string;
  qty: number;
  unitCost: number;
  discount: number;
}

export function NewReceipt({
  orders,
  suppliers,
  initialOrderId,
  noOrderEnabled = false,
  terms = [],
  methods = [],
  supplierTerms = {},
  warehouses = [],
  defaultWarehouseName = "",
  canReceive = true,
  pendingInvoice = null,
  initialMode = null,
}: {
  orders: OpenOrder[];
  suppliers: Opt[];
  initialOrderId?: string | null;
  /** parâmetro feature.entradaSemPedido */
  noOrderEnabled?: boolean;
  terms?: Opt[];
  methods?: Opt[];
  /** condição de pagamento padrão de cada fornecedor */
  supplierTerms?: Record<string, string>;
  /** §39: depósitos ativos da filial que recebem mercadoria (venda, almoxarifado, uso e consumo) */
  warehouses?: Opt[];
  defaultWarehouseName?: string;
  /** permissão "Receber mercadorias" (sem ela, só a entrada com nota a confirmar) */
  canReceive?: boolean;
  /** §40: entrada com nota a confirmar (recurso ligado e permissão "Lançar entrada com nota a confirmar") */
  pendingInvoice?: { dueDays: number } | null;
  initialMode?: Mode | null;
}) {
  const initialOrder = orders.find((o) => o.id === initialOrderId) ?? null;
  const [mode, setMode] = useState<Mode>(initialMode ?? (canReceive ? "xml" : "pending"));
  const [supplierId, setSupplierId] = useState<string>(initialOrder?.supplierId ?? "");
  const [selected, setSelected] = useState<string[]>(initialOrder ? [initialOrder.id] : []);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [typedKey, setTypedKey] = useState("");
  const [xmlNoOrder, setXmlNoOrder] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  // §39: depósito de destino (vazio = o do pedido vinculado ou, sem pedido, o padrão da filial); pode mudar na conferência
  const warehouseField = warehouses.length > 1 && (
    <Field label="Depósito de destino" hint="Onde a mercadoria dá entrada. Pode ser alterado na conferência.">
      <Select name="warehouseId" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} options={warehouses} placeholder={`Padrão — ${defaultWarehouseName || "depósito padrão da filial"} (ou o do pedido)`} />
    </Field>
  );
  const [orderMode, setOrderMode] = useState<"order" | "none">(initialOrder || !noOrderEnabled ? "order" : "none");
  const supplierOrders = orders.filter((o) => o.supplierId === supplierId);
  const pickSupplier = (id: string) => {
    setSupplierId(id);
    setSelected([]);
    // fornecedor sem pedido em aberto: o lançamento manual passa a ser sem pedido
    if (noOrderEnabled && id && !orders.some((o) => o.supplierId === id)) setOrderMode("none");
  };
  const modes: Array<{ key: Mode; label: string; hint: string; icon: any }> = [
    ...(canReceive
      ? [
          { key: "xml" as Mode, label: "Importar XML", hint: "Arquivo da NF-e recebido do fornecedor (recomendado)", icon: FileCode2 },
          { key: "key" as Mode, label: "Ler chave de acesso", hint: "Busca o XML se houver integração capaz", icon: KeyRound },
          noOrderEnabled
            ? { key: "manual" as Mode, label: "Lançar nota sem XML", hint: "Pelo saldo do pedido ou nota avulsa sem pedido", icon: ClipboardList }
            : { key: "manual" as Mode, label: "Sem XML (pelo pedido)", hint: "Itens a partir do saldo dos pedidos", icon: ClipboardList },
        ]
      : []),
    ...(pendingInvoice ? [{ key: "pending" as Mode, label: "Nota a confirmar", hint: "A mercadoria chegou antes da nota fiscal", icon: FileClock }] : []),
  ];
  const ordersPicker = (name: string) =>
    supplierOrders.length > 0 && (
      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-slate-600">Pedidos a vincular</legend>
        <div className="mt-1 space-y-1">
          {supplierOrders.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} value={o.id} checked={selected.includes(o.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))} className="accent-brand-700" />
              Pedido nº {o.number} · saldo {formatMoney(o.remainingValue)} · previsão {formatDate(o.expectedDate)}
            </label>
          ))}
        </div>
      </fieldset>
    );
  return (
    <div className="space-y-5">
      <div role="tablist" className={cn("grid gap-3", modes.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : modes.length === 1 ? "sm:grid-cols-1" : "sm:grid-cols-3")}>
        {modes.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)} className={cn("focus-ring flex items-start gap-3 rounded-lg border bg-white p-4 text-left", mode === m.key ? "border-accent-500 ring-1 ring-accent-500" : "border-line hover:border-brand-300")}>
              <Icon className="mt-0.5 size-5 text-brand-700" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-slate-500">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <section className="rounded-lg border border-line bg-white p-5">
        {mode === "xml" && (
          <ActionForm action={importXmlAction} className="space-y-4">
            {({ pending, error }) => (
              <>
                <Field label="Arquivo XML da NF-e (modelo 55)" required hint="O XML é validado (estrutura, chave e dígito verificador). Emitente identifica o fornecedor pelo CNPJ; itens são associados pelo código do fornecedor ou código de barras.">
                  <input type="file" name="xml" accept=".xml,application/xml,text/xml" required className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-800" />
                </Field>
                {noOrderEnabled && (
                  <div>
                    <Checkbox name="withoutOrder" value="1" checked={xmlNoOrder} onChange={(e) => setXmlNoOrder(e.target.checked)} label="Entrada sem pedido (compra do dia a dia — não vincular pedidos em aberto)" />
                    <p className="mt-1 pl-6 text-xs text-slate-500">Estoque, custo médio e contas a pagar seguem as mesmas regras; os itens não baixam saldo de pedido.</p>
                  </div>
                )}
                {!xmlNoOrder && (
                  <>
                    <Field label="Fornecedor (opcional — para escolher pedidos manualmente)">
                      <Select value={supplierId} onChange={(e) => pickSupplier(e.target.value)} options={suppliers} placeholder="Vincular automaticamente pelos pedidos em aberto" />
                    </Field>
                    {ordersPicker("orderIds")}
                  </>
                )}
                {warehouseField}
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex justify-end"><SubmitButton pending={pending} variant="accent">Importar e conferir</SubmitButton></div>
              </>
            )}
          </ActionForm>
        )}
        {mode === "key" && (
          <ActionForm action={fetchByKeyAction} className="space-y-4">
            {({ pending, error }) => (
              <>
                <Field label="Chave de acesso (44 dígitos)" required hint="Leia com o leitor de código de barras do DANFE ou digite.">
                  <Input name="key" value={typedKey} onChange={(e) => setTypedKey(e.target.value)} inputMode="numeric" autoFocus placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" />
                </Field>
                {warehouseField}
                {error && (
                  <Notice tone="warn" title="XML não obtido pela chave">
                    {error}{" "}
                    <button type="button" className="font-medium underline" onClick={() => { setKeyMessage(typedKey); setMode("xml"); }}>Importar o arquivo XML</button> ou{" "}
                    <button type="button" className="font-medium underline" onClick={() => { setKeyMessage(typedKey); setMode("manual"); }}>receber sem XML com esta chave</button>.
                  </Notice>
                )}
                <div className="flex justify-end"><SubmitButton pending={pending}>Buscar XML</SubmitButton></div>
              </>
            )}
          </ActionForm>
        )}
        {mode === "pending" && pendingInvoice && (
          <PendingInvoiceForm suppliers={suppliers} warehouses={warehouses} defaultWarehouseName={defaultWarehouseName} terms={terms} methods={methods} supplierTerms={supplierTerms} dueDays={pendingInvoice.dueDays} />
        )}
        {mode === "manual" && (
          <ActionForm action={manualReceiptAction} className="space-y-4">
            {({ pending, error }) => (
              <>
                <input type="hidden" name="orderMode" value={orderMode} />
                {noOrderEnabled && (
                  <div role="radiogroup" aria-label="Vínculo com pedido" className="flex flex-wrap gap-2">
                    {([["order", "Pelo pedido de compra", "Itens a partir do saldo dos pedidos aprovados"], ["none", "Sem pedido", "Nota avulsa: informe itens, frete e condição"]] as const).map(([k, label, hint]) => (
                      <button key={k} type="button" role="radio" aria-checked={orderMode === k} onClick={() => setOrderMode(k)} className={cn("focus-ring rounded-md border px-3 py-2 text-left text-sm", orderMode === k ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-line hover:border-brand-300")}>
                        <span className="block font-medium">{label}</span>
                        <span className="block text-xs text-slate-500">{hint}</span>
                      </button>
                    ))}
                  </div>
                )}
                <Notice tone="info">
                  {orderMode === "none"
                    ? "Lance os itens como estão na nota do fornecedor. Na conclusão, o estoque, o custo médio e o contas a pagar são gerados pelas mesmas regras do recebimento com pedido."
                    : "Sem XML, os itens vêm do saldo dos pedidos selecionados e o valor faturado é informado manualmente. Prefira importar o XML para conferir quantidades e duplicatas."}
                </Notice>
                <FormGrid cols={2}>
                  <Field label="Fornecedor" required>
                    <Select name="supplierId" value={supplierId} onChange={(e) => pickSupplier(e.target.value)} options={suppliers} placeholder="Selecione…" />
                  </Field>
                  <Field label="Chave de acesso (opcional)">
                    <Input name="nfeKey" defaultValue={keyMessage ?? ""} inputMode="numeric" />
                  </Field>
                  <Field label="Número da NF-e">
                    <Input name="nfeNumber" inputMode="numeric" />
                  </Field>
                  <Field label="Série">
                    <Input name="nfeSeries" inputMode="numeric" />
                  </Field>
                  <Field label="Data de emissão" hint={orderMode === "none" ? "Base dos vencimentos da condição de pagamento." : undefined}>
                    <Input key={orderMode} name="issueDate" type="date" max={today()} defaultValue={orderMode === "none" ? today() : undefined} />
                  </Field>
                  <Field label="Valor total da NF-e (faturado)" hint={orderMode === "none" ? "Opcional: diferença para o valor devido exige justificativa na conferência." : undefined}>
                    <MoneyInput name="invoicedTotal" />
                  </Field>
                </FormGrid>
                {orderMode === "order" && (
                  <>
                    {supplierId && !supplierOrders.length && <p className="text-sm text-amber-700">Este fornecedor não tem pedidos aprovados/enviados com saldo nesta filial.{noOrderEnabled ? " Use “Sem pedido” para lançar a nota avulsa." : ""}</p>}
                    {ordersPicker("orderIds")}
                  </>
                )}
                {orderMode === "none" && <NoOrderItems key={supplierId} supplierId={supplierId} terms={terms} methods={methods} defaultTermId={supplierTerms[supplierId] ?? ""} />}
                {warehouseField}
                {error && <p className="text-sm text-red-700">{error}</p>}
                <div className="flex justify-end"><SubmitButton pending={pending} variant="accent">Abrir conferência</SubmitButton></div>
              </>
            )}
          </ActionForm>
        )}
      </section>
    </div>
  );
}

/** Data/hora local atual no formato do campo datetime-local (AAAA-MM-DDTHH:mm). */
function nowLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * §40 — entrada com nota a confirmar: a mercadoria chegou antes da nota do fornecedor. Data/hora atual ou passada =
 * entrada realizada agora (estoque e conta a pagar provisória); futura = entrada PREVISTA (a chegar).
 */
function PendingInvoiceForm({ suppliers, warehouses, defaultWarehouseName, terms, methods, supplierTerms, dueDays }: { suppliers: Opt[]; warehouses: Opt[]; defaultWarehouseName: string; terms: Opt[]; methods: Opt[]; supplierTerms: Record<string, string>; dueDays: number }) {
  const [supplierId, setSupplierId] = useState("");
  // relógio do navegador (fuso de quem lança): preenchido depois da montagem para não divergir da renderização no servidor
  const [entryAt, setEntryAt] = useState("");
  useEffect(() => setEntryAt(nowLocal()), []);
  const future = Boolean(entryAt) && entryAt > nowLocal();
  const entryDate = entryAt.slice(0, 10);
  const due = entryDate ? new Date(Date.parse(`${entryDate}T12:00:00Z`) + dueDays * 86400000).toISOString().slice(0, 10) : "";
  return (
    <ActionForm action={pendingInvoiceEntryAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <Notice tone="info" title="Mercadoria chegou antes da nota fiscal">
            O estoque entra no depósito escolhido como uma entrada normal, marcada <strong>aguardando nota</strong>, com a conta a pagar <strong>provisória</strong> pelo custo previsto. As vendas continuam normais e sempre com NFC-e/NF-e. Quando a nota chegar, use “Confirmar com a nota” no recebimento: custo, quantidade e conta a pagar são corrigidos pela nota. Data/hora <strong>futura</strong> registra uma entrada <strong>prevista</strong> (a chegar), sem mexer no saldo nem no custo até a data.
          </Notice>
          <FormGrid cols={3}>
            <Field label="Fornecedor" required>
              <Select name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers} placeholder="Selecione…" />
            </Field>
            <Field label="Data e hora da entrada" required hint={future ? "Futura: entrada PREVISTA (a chegar) — realizada automaticamente na data." : "Agora ou no passado: entrada realizada ao salvar."}>
              <Input name="entryAt" type="datetime-local" value={entryAt} onChange={(e) => setEntryAt(e.target.value)} required />
            </Field>
            <Field label="Depósito de destino" hint="Onde a mercadoria dá entrada.">
              <Select name="warehouseId" defaultValue="" options={warehouses} placeholder={`Padrão — ${defaultWarehouseName || "depósito padrão da filial"}`} />
            </Field>
            <Field label="Número da nota (se já souber)">
              <Input name="nfeNumber" inputMode="numeric" />
            </Field>
            <Field label="Série">
              <Input name="nfeSeries" inputMode="numeric" />
            </Field>
            <Field label="Chave de acesso (se já souber)">
              <Input name="nfeKey" inputMode="numeric" />
            </Field>
          </FormGrid>
          <NoOrderItems key={supplierId} supplierId={supplierId} terms={terms} methods={methods} defaultTermId={supplierTerms[supplierId] ?? ""} costLabel="Custo previsto" termHint="Gera as parcelas provisórias a partir da data da entrada (corrigidas pela nota)." dueLabel="Valor previsto" termPlaceholder="À vista (vencimento na data da entrada)" />
          <Field label="Observações">
            <Textarea name="notes" rows={2} placeholder="Ex.: entregue pelo vendedor; nota prometida para a próxima semana." />
          </Field>
          <p className="text-sm text-slate-600">Prazo para a nota: <strong>{due ? due.split("-").reverse().join("/") : "—"}</strong> ({dueDays} dias após a entrada — parâmetro de Compras).</p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end"><SubmitButton pending={pending} variant="accent">{future ? "Registrar entrada prevista" : "Lançar entrada aguardando nota"}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}

/** Itens, encargos e condição de pagamento da nota lançada sem pedido. */
function NoOrderItems({ supplierId, terms, methods, defaultTermId, costLabel = "Custo unit.", termHint = "Gera as parcelas do contas a pagar a partir da data de emissão.", dueLabel = "Valor devido", termPlaceholder = "À vista (vencimento na emissão)" }: { supplierId: string; terms: Opt[]; methods: Opt[]; defaultTermId: string; costLabel?: string; termHint?: string; dueLabel?: string; termPlaceholder?: string }) {
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [seq, setSeq] = useState(1);
  const [freight, setFreight] = useState(0);
  const [other, setOther] = useState(0);
  const [discount, setDiscount] = useState(0);
  const set = (key: number, patch: Partial<ManualRow>) => setRows((a) => a.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const lineValue = (r: ManualRow) => Math.max(0, lineTotal(r.unitCost, r.qty) - r.discount);
  const products = rows.reduce((a, r) => a + lineValue(r), 0);
  const due = products - Math.min(discount, products) + freight + other;
  const payload = JSON.stringify(rows.map((r) => ({ skuId: r.skuId, qty: r.qty, unitCost: r.unitCost, discount: r.discount })));
  if (!supplierId) return <p className="text-sm text-slate-500">Selecione o fornecedor para lançar os itens.</p>;
  return (
    <div className="space-y-4">
      <input type="hidden" name="itemsJson" value={payload} />
      <input type="hidden" name="freight" value={freight} />
      <input type="hidden" name="otherExpenses" value={other} />
      <input type="hidden" name="discount" value={discount} />
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Itens da nota</legend>
        <SkuPicker
          className="mt-2"
          supplierId={supplierId}
          placeholder="Adicionar produto: nome, SKU, código de barras ou código do fornecedor"
          onPick={(h) => {
            setRows((a) => [...a, { key: seq, skuId: h.id, sku: h.sku, name: h.name, unitCode: h.unitCode, qty: 1000, unitCost: h.lastCost ?? h.costAcquisition ?? 0, discount: 0 }]);
            setSeq((n) => n + 1);
          }}
        />
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nenhum item lançado. Pesquise o produto acima; se ele ainda não existe, cadastre em Produtos ou importe o XML (que permite cadastrar a partir da nota).</p>
        ) : (
          <div className="-mx-5 mt-3 overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Produto</th><th className="w-28 text-right">Quantidade</th><th className="w-36 text-right">{costLabel}</th><th className="w-36 text-right">Desconto</th><th className="text-right">Total</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="min-w-[200px]"><span className="font-medium">{r.name}</span><span className="block text-xs text-slate-500">{r.sku} · {r.unitCode}</span></td>
                    <td><QtyInput value={r.qty} onChange={(v) => set(r.key, { qty: v })} ariaLabel={`Quantidade de ${r.name}`} min={0} /></td>
                    <td><MoneyInput value={r.unitCost} onChange={(v) => set(r.key, { unitCost: v })} ariaLabel={`Custo de ${r.name}`} /></td>
                    <td><MoneyInput value={r.discount} onChange={(v) => set(r.key, { discount: v })} ariaLabel={`Desconto de ${r.name}`} /></td>
                    <td className="tabular text-right">{formatMoney(lineValue(r))}</td>
                    <td><Button type="button" size="sm" variant="ghost" aria-label={`Remover ${r.name}`} onClick={() => setRows((a) => a.filter((x) => x.key !== r.key))}><Trash2 className="size-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <FormGrid cols={2}>
          <Field label="Condição de pagamento" hint={termHint}>
            <Select name="paymentTermId" defaultValue={defaultTermId} options={terms} placeholder={termPlaceholder} />
          </Field>
          <Field label="Forma de pagamento">
            <Select name="paymentMethodId" defaultValue="" options={methods} placeholder="—" />
          </Field>
        </FormGrid>
        <dl className="space-y-2 rounded-md border border-line p-3 text-sm">
          <div className="flex justify-between"><dt>Produtos ({rows.length} item(ns), {formatQty(rows.reduce((a, r) => a + r.qty, 0))} un.)</dt><dd className="tabular">{formatMoney(products)}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt>Frete</dt><dd className="w-32"><MoneyInput value={freight} onChange={setFreight} ariaLabel="Frete" /></dd></div>
          <div className="flex items-center justify-between gap-3"><dt title="Outras despesas, seguro, IPI e ST da nota">Outras despesas/IPI/ST</dt><dd className="w-32"><MoneyInput value={other} onChange={setOther} ariaLabel="Outras despesas" /></dd></div>
          <div className="flex items-center justify-between gap-3"><dt>Desconto da nota</dt><dd className="w-32"><MoneyInput value={discount} onChange={setDiscount} ariaLabel="Desconto da nota" /></dd></div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>{dueLabel}</dt><dd className="tabular">{formatMoney(due)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
