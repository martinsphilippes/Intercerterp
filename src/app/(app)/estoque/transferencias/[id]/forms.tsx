"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { QtyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { QTY } from "@/lib/money";
import { receiveTransferAction, resolveTransferAction, setTransferDocumentAction } from "../../actions";

const fmt = (m: number) => (m / QTY).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export function PrintButton({ auto }: { auto?: boolean }) {
  useEffect(() => {
    if (auto) setTimeout(() => window.print(), 400);
  }, [auto]);
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="size-4" /> Imprimir
    </Button>
  );
}

/**
 * Conferência do recebimento no destino: bom, avariado e falta (o que não chegou continua em trânsito).
 * As edições ficam por SKU (não por posição): após um recebimento parcial, a lista de pendentes muda e
 * cada linha continua ligada ao seu produto; o envio usa só os itens pendentes atuais.
 */
export function ReceiveForm({ transferId, items }: { transferId: string; items: Array<{ skuId: string; sku: string; name: string; unitCode: string; pending: number }> }) {
  type Line = { receivedQty: number; damagedQty: number; note: string };
  const [edits, setEdits] = useState<Record<string, Line>>({});
  const lineOf = (it: { skuId: string; pending: number }): Line => edits[it.skuId] ?? { receivedQty: it.pending, damagedQty: 0, note: "" };
  const set = (it: { skuId: string; pending: number }, patch: Partial<Line>) => setEdits((e) => ({ ...e, [it.skuId]: { ...(e[it.skuId] ?? { receivedQty: it.pending, damagedQty: 0, note: "" }), ...patch } }));
  const lines = items.map((it) => ({ skuId: it.skuId, ...lineOf(it) }));
  return (
    <ActionForm action={receiveTransferAction} onSuccess={() => setEdits({})} className="space-y-3">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={transferId} />
          <input type="hidden" name="lines" value={JSON.stringify(lines)} />
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Produto</th><th className="text-right">Pendente</th><th className="w-32 text-right">Recebido (bom)</th><th className="w-32 text-right">Avariado</th><th className="text-right">Falta</th><th>Observação</th></tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const l = lineOf(it);
                  const miss = it.pending - l.receivedQty - l.damagedQty;
                  return (
                    <tr key={it.skuId}>
                      <td><span className="block">{it.name}</span><span className="font-mono text-xs text-slate-500">{it.sku}</span></td>
                      <td className="tabular text-right">{fmt(it.pending)} {it.unitCode}</td>
                      <td><QtyInput key={`r-${it.skuId}-${it.pending}`} ariaLabel={`Recebido de ${it.sku}`} value={l.receivedQty} min={0} onChange={(v) => set(it, { receivedQty: v })} /></td>
                      <td><QtyInput key={`d-${it.skuId}-${it.pending}`} ariaLabel={`Avariado de ${it.sku}`} value={l.damagedQty} min={0} onChange={(v) => set(it, { damagedQty: v })} /></td>
                      <td className={`tabular text-right font-semibold ${miss < 0 ? "text-red-700" : miss > 0 ? "text-amber-700" : "text-slate-400"}`}>{fmt(miss)}</td>
                      <td><Input aria-label="Observação" value={l.note} onChange={(e) => set(it, { note: e.target.value })} placeholder={miss > 0 || l.damagedQty > 0 ? "Descreva a divergência" : ""} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Bom entra no depósito de destino com o custo de origem; avariado vai para o depósito de avarias da filial. A falta permanece em trânsito até novo recebimento, retorno à origem ou baixa como perda.</p>
          <Field label="Observações do recebimento">
            <Input name="notes" placeholder="Ex.: conferido por …, lacre nº …" />
          </Field>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Confirmar recebimento</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Resolução do saldo pendente em trânsito: retorno à origem ou baixa como perda. */
export function ResolveForm({ transferId, pendingText }: { transferId: string; pendingText: string }) {
  const [mode, setMode] = useState("return");
  return (
    <ActionForm action={resolveTransferAction} confirm={mode === "loss" ? "Baixar o pendente como perda? Gera retorno contábil e perda na origem." : "Devolver o pendente à origem?"} className="grid items-end gap-3 md:grid-cols-[200px_minmax(0,1fr)_auto]">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={transferId} />
          <Field label={`Pendente: ${pendingText}`}>
            <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: "return", label: "Retornar à origem" }, { value: "loss", label: "Baixar como perda (falta)" }]} />
          </Field>
          <Field label="Motivo" required>
            <Input name="reason" placeholder={mode === "loss" ? "Ex.: extravio no transporte" : "Ex.: item não embarcado"} />
          </Field>
          <SubmitButton pending={pending} variant={mode === "loss" ? "danger" : "secondary"}>Registrar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DocumentForm({ transferId, value }: { transferId: string; value: string | null }) {
  return (
    <ActionForm action={setTransferDocumentAction} className="flex items-end gap-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={transferId} />
          <Field label="Documento de referência (número/chave)" className="flex-1">
            <Input name="documentRef" defaultValue={value ?? ""} maxLength={200} placeholder="Ex.: NF-e 1234 série 1 ou chave de acesso" />
          </Field>
          <SubmitButton pending={pending} variant="secondary">Salvar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
