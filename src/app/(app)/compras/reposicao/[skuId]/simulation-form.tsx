"use client";

import Link from "@/components/ui/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select } from "@/components/ui/form";
import { MoneyInput, QtyInput } from "@/components/ui/money-input";
import { Button, buttonClass } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { formatMoney, lineTotal } from "@/lib/money";
import { createDraftsAction } from "../actions";

/** Parâmetros desta simulação (fornecedor, custo e prazo) — "Aplicar à prévia" recalcula; o rascunho usa os valores aplicados. */
export function SimulationForm({ skuId, branchId, coverageDays, historyDays, supplierId, unitCost, leadTimeDays, suggested, options, backHref }: { skuId: string; branchId: string; coverageDays: number; historyDays: number; supplierId: string | null; unitCost: number; leadTimeDays: number; suggested: number; options: Array<{ value: string; label: string }>; backHref: string }) {
  const [sup, setSup] = useState(supplierId ?? "");
  const [cost, setCost] = useState(unitCost);
  const [lead, setLead] = useState(String(leadTimeDays));
  const [qty, setQty] = useState(suggested);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const idem = useIdemKey();
  const apply = () => {
    const u = new URLSearchParams({ branch: branchId, cobertura: String(coverageDays), historico: String(historyDays) });
    if (sup) u.set("fornecedor", sup);
    u.set("custo", String(cost));
    if (lead !== "") u.set("prazo", lead);
    router.push(`/compras/reposicao/${skuId}?${u.toString()}`);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fornecedor">
          <Select value={sup} onChange={(e) => setSup(e.target.value)} options={options} placeholder="—" aria-label="Fornecedor" />
        </Field>
        <Field label="Custo estimado / UN">
          <MoneyInput value={cost} onChange={setCost} ariaLabel="Custo estimado" />
        </Field>
        <Field label="Prazo estimado (dias)">
          <Input type="number" min={0} max={365} value={lead} onChange={(e) => setLead(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={backHref} className={buttonClass("ghost")}>Cancelar</Link>
        <Button variant="accent" onClick={apply}>Aplicar à prévia</Button>
      </div>
      <div className="flex flex-wrap items-end justify-end gap-3 border-t border-line pt-4">
        <Field label="Quantidade do rascunho" className="w-40">
          <QtyInput value={qty} onChange={setQty} ariaLabel="Quantidade do rascunho" />
        </Field>
        <p className="pb-2 text-sm text-slate-600">Estimativa {formatMoney(lineTotal(cost, qty))}</p>
        <Button
          variant="primary"
          loading={pending}
          disabled={!sup || qty <= 0}
          onClick={() =>
            start(async () => {
              const fd = new FormData();
              fd.set("branchId", branchId);
              fd.set("coverageDays", String(coverageDays));
              fd.set("lines", JSON.stringify([{ skuId, qty, supplierId: sup, unitCost: cost }]));
              fd.set("_idem", idem);
              const r = await createDraftsAction(fd);
              if (!r.ok) return toast("error", r.error);
              toast("success", r.message ?? "Rascunho criado.");
              if (r.redirect) router.push(r.redirect);
            })
          }
        >
          Criar rascunho deste item
        </Button>
      </div>
    </div>
  );
}
