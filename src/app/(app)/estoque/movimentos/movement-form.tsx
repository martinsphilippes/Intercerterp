"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "@/components/ui/link";
import { PackagePlus, PackageMinus, SlidersHorizontal, Trash2, ArrowLeftRight, Package } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea, FormGrid } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { buttonClass } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { SkuPicker, type SkuHit } from "../sku-picker";
import { adjustStockAction, skuBalanceAction } from "../actions";

type Kind = "in" | "out" | "adjust" | "loss" | "transfer";

const KINDS: Array<{ key: Kind; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "in", label: "Entrada", icon: PackagePlus },
  { key: "out", label: "Saída", icon: PackageMinus },
  { key: "adjust", label: "Ajuste", icon: SlidersHorizontal },
  { key: "loss", label: "Perda", icon: Trash2 },
  { key: "transfer", label: "Transferência", icon: ArrowLeftRight },
];

const REASONS: Record<Exclude<Kind, "transfer">, string[]> = {
  in: ["Entrada avulsa", "Bonificação de fornecedor", "Retorno de empréstimo/consignação", "Produção/montagem interna", "Outro"],
  out: ["Consumo interno", "Brinde / amostra", "Empréstimo / consignação", "Uso em vitrine/mostruário", "Outro"],
  adjust: ["Correção de contagem", "Erro de lançamento anterior", "Conversão de unidade", "Outro"],
  loss: ["Avaria / quebra", "Produto vencido", "Furto / extravio", "Defeito sem garantia", "Outro"],
};

const fmt = (m: number) => (m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Nova movimentação avulsa (entrada, saída, ajuste, perda) — sempre por movimento rastreável com motivo. */
export function MovementForm({ warehouses, initialSku, branchName }: { warehouses: Array<{ value: string; label: string }>; initialSku: SkuHit | null; branchName: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [sku, setSku] = useState<SkuHit | null>(initialSku);
  const [kind, setKind] = useState<Kind>("in");
  const [dir, setDir] = useState<"in" | "out">("in");
  const [wh, setWh] = useState(warehouses[0]?.value ?? "");
  const [qty, setQty] = useState(0);
  const [bal, setBal] = useState<{ physical: number; reserved?: number; available: number; avgCost: number; location: string | null } | null>(initialSku ? { physical: initialSku.physical, reserved: initialSku.physical - initialSku.available, available: initialSku.available, avgCost: initialSku.avgCost, location: initialSku.location ?? null } : null);
  const [reason, setReason] = useState(REASONS.in[0]);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (!sku || !wh) return setBal(null);
    let alive = true;
    skuBalanceAction(sku.id, wh).then((r) => alive && r.ok && setBal(r.data as any));
    return () => {
      alive = false;
    };
  }, [sku, wh, formKey]);
  const choose = (s: SkuHit | null) => {
    setSku(s);
    const q = new URLSearchParams(sp.toString());
    if (s) q.set("sku", s.id);
    else q.delete("sku");
    q.delete("page");
    router.replace(`/estoque/movimentos?${q.toString()}`, { scroll: false });
  };
  const sign = kind === "in" || (kind === "adjust" && dir === "in") ? 1 : -1;
  const type = kind === "in" ? "manual_in" : kind === "out" ? "manual_out" : kind === "loss" ? "loss" : dir === "in" ? "adjust_in" : "adjust_out";
  const before = bal?.physical ?? 0;
  const after = before + sign * qty;
  const reserved = bal?.reserved ?? Math.max(0, before - (bal?.available ?? before));
  const available = bal?.available ?? before - reserved;
  // saídas manuais, ajustes de saída e perdas não podem consumir o reservado (disponível = físico − reservado)
  const overAvailable = sign < 0 && qty > 0 && after >= 0 && reserved > 0 && qty > available;
  return (
    <section className="rounded-lg border border-line bg-white">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Nova movimentação</h2>
        <p className="text-xs text-slate-500">Filial {branchName}. Ajustes e perdas exigem motivo e permissão — nada altera o saldo sem movimento.</p>
      </header>
      <ActionForm
        key={formKey}
        action={adjustStockAction}
        onSuccess={() => {
          setQty(0);
          setFormKey((k) => k + 1);
        }}
        className="space-y-4 p-4"
      >
        {({ pending, error }) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
            <Field label="Produto">
              <SkuPicker value={sku} onChange={choose} warehouseId={wh} />
            </Field>
            {sku && (
              <div className="flex items-start gap-3 rounded-md border border-line bg-slate-50 p-3 text-sm">
                <Package className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{sku.name}</p>
                  <p className="text-xs text-slate-500">
                    SKU <span className="font-mono">{sku.sku}</span> • Local {bal?.location ?? "—"} • Custo médio {formatMoney(bal?.avgCost ?? sku.avgCost)}
                  </p>
                </div>
              </div>
            )}
            <div role="radiogroup" aria-label="Tipo de movimentação" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.key}
                  onClick={() => {
                    setKind(k.key);
                    if (k.key !== "transfer") setReason(REASONS[k.key][0]);
                  }}
                  className={cn("focus-ring flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium", kind === k.key ? "border-accent-500 bg-accent-50 text-accent-700" : "border-line text-slate-600 hover:bg-slate-50")}
                >
                  <k.icon className="size-5" />
                  {k.label}
                </button>
              ))}
            </div>
            {kind !== "transfer" && sku && reserved > 0 && (
              <p className="text-xs text-slate-600">
                Reservado (transferências separadas): <span className="tabular font-semibold">{fmt(reserved)}</span> · Disponível: <span className="tabular font-semibold">{fmt(available)}</span> {sku.unitCode}
              </p>
            )}
            {kind !== "transfer" && (
              <dl className="grid grid-cols-3 gap-2 rounded-md bg-slate-50 p-3 text-center text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Saldo anterior</dt>
                  <dd className="tabular font-semibold">{sku ? `${fmt(before)} ${sku.unitCode}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Movimentação</dt>
                  <dd className={cn("tabular font-semibold", sign > 0 ? "text-emerald-700" : "text-red-700")}>{qty ? `${sign > 0 ? "+" : "−"} ${fmt(qty)}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Novo saldo estimado</dt>
                  <dd className={cn("tabular text-base font-bold", after < 0 ? "text-red-700" : "text-brand-800")}>{sku ? fmt(after) : "—"}</dd>
                </div>
              </dl>
            )}
            {kind !== "transfer" && after < 0 && <Notice tone="bad">A saída deixaria o saldo negativo; o sistema vai recusar.</Notice>}
            {kind !== "transfer" && overAvailable && <Notice tone="bad">A saída passa do disponível ({fmt(available)}): {fmt(reserved)} estão reservados para transferências separadas. Cancele ou ajuste a transferência antes, ou o sistema vai recusar.</Notice>}
            </div>
            <div className="space-y-4">
            {kind === "transfer" ? (
              <Notice tone="info" title="Transferência entre filiais">
                Transferências têm fluxo próprio (separação, expedição, trânsito e recebimento no destino).{" "}
                <Link className={buttonClass("secondary", "sm", "mt-2")} href={`/estoque/transferencias/novo${sku ? `?sku=${sku.id}` : ""}`}>
                  Abrir transferência{sku ? " com este item" : ""}
                </Link>
              </Notice>
            ) : (
              <>
                <input type="hidden" name="skuId" value={sku?.id ?? ""} />
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="reason" value={reason} />
                <FormGrid cols={2}>
                  <Field label="Depósito" required>
                    <Select name="warehouseId" value={wh} onChange={(e) => setWh(e.target.value)} options={warehouses} />
                  </Field>
                  {kind === "adjust" ? (
                    <Field label="Sentido do ajuste" required>
                      <Select value={dir} onChange={(e) => setDir(e.target.value as "in" | "out")} options={[{ value: "in", label: "Acréscimo (+)" }, { value: "out", label: "Redução (−)" }]} />
                    </Field>
                  ) : (
                    <Field label="Motivo" required>
                      <Select value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS[kind].map((r) => ({ value: r, label: r }))} />
                    </Field>
                  )}
                  {kind === "adjust" && (
                    <Field label="Motivo" required className="sm:col-span-2">
                      <Select value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS.adjust.map((r) => ({ value: r, label: r }))} />
                    </Field>
                  )}
                  <Field label={`Quantidade${sku ? ` (${sku.unitCode})` : ""}`} required>
                    <QtyInput name="qty" value={qty} onChange={setQty} min={0} />
                  </Field>
                  {sign > 0 ? (
                    <Field label="Custo unitário" hint="Recalcula o custo médio.">
                      <MoneyInput key={`${sku?.id}-${wh}`} name="unitCost" defaultValue={bal?.avgCost ?? sku?.avgCost ?? 0} />
                    </Field>
                  ) : (
                    <Field label="Custo unitário" hint="Saídas usam o custo médio vigente.">
                      <div className="tabular flex h-9 items-center rounded-md border border-line bg-slate-50 px-3 text-sm">{formatMoney(bal?.avgCost ?? sku?.avgCost ?? 0)}</div>
                    </Field>
                  )}
                  {sign > 0 && (
                    <>
                      <Field label="Lote">
                        <Input name="lot" maxLength={60} placeholder="Ex.: LT-0926-A" />
                      </Field>
                      <Field label="Validade">
                        <Input name="lotExpiry" type="date" />
                      </Field>
                    </>
                  )}
                  <Field label="Documento de referência">
                    <Input name="documentRef" maxLength={120} placeholder="NF-e, pedido, OS ou documento interno" />
                  </Field>
                  <Field label="Data do movimento" hint="Horário local da filial. Vazio = agora. Não pode ser futura.">
                    <Input name="occurredAt" type="datetime-local" />
                  </Field>
                </FormGrid>
                <Field label="Observações">
                  <Textarea name="notes" rows={2} placeholder="Detalhes adicionais para auditoria" />
                </Field>
                {error && <Notice tone="bad">{error}</Notice>}
                <SubmitButton pending={pending} variant="accent" className="w-full">
                  Confirmar movimentação
                </SubmitButton>
              </>
            )}
            </div>
          </div>
        )}
      </ActionForm>
    </section>
  );
}
