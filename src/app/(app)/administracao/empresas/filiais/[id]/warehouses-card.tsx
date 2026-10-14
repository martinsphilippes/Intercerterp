"use client";

import { useState } from "react";
import Link from "@/components/ui/link";
import { Pencil, Plus, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton, ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { formatMoney, formatQty } from "@/lib/money";
import { saveWarehouseAction, setDefaultWarehouseAction, setWarehouseStatusAction } from "../../actions";

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  type: "sale" | "storage" | "consumption" | "damaged";
  typeLabel: string;
  salePriority: number | null;
  notes: string | null;
  status: string;
  isBranchDefault: boolean;
  terminals: string[];
  items: number;
  physical: number;
  reserved: number;
  value: number;
}

const TYPE_TONE: Record<WarehouseRow["type"], "brand" | "info" | "neutral" | "warn"> = { sale: "brand", storage: "info", consumption: "neutral", damaged: "warn" };

/**
 * Quadro "Depósitos" da filial (§39): saldo por depósito, cadastro, edição, depósito padrão e ativação.
 * As travas (saldo, reservado, padrão da filial/terminal, último depósito de venda, avarias) são conferidas no servidor.
 */
export function WarehousesCard({ branchId, rows, canManage, types, typeHints, stockHref }: { branchId: string; rows: WarehouseRow[]; canManage: boolean; types: Array<{ value: string; label: string }>; typeHints: Record<string, string>; stockHref: string | null }) {
  const [editing, setEditing] = useState<WarehouseRow | "new" | null>(null);
  const current = editing && editing !== "new" ? editing : null;
  const [type, setType] = useState<string>("sale");
  const open = (w: WarehouseRow | "new") => {
    setType(w === "new" ? "storage" : w.type);
    setEditing(w);
  };
  return (
    <Card
      title="Depósitos"
      description="Venda e almoxarifado entram no disponível para venda (a venda tira primeiro do depósito do terminal e completa pelos demais, pela prioridade); uso e consumo e avarias ficam fora."
      bodyClass="p-0"
      actions={
        canManage && (
          <Button size="sm" variant="primary" onClick={() => open("new")}>
            <Plus className="size-4" /> Novo depósito
          </Button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th>Código</th>
              <th>Depósito</th>
              <th>Tipo</th>
              <th className="text-right" title="Ordem em que completa a venda (menor primeiro)">Prioridade</th>
              <th className="text-right">Saldo</th>
              <th>Situação</th>
              {canManage && <th className="text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td className="font-mono text-xs">{w.code}</td>
                <td>
                  <span className="font-medium">{w.name}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {w.isBranchDefault && <Badge tone="brand">Padrão da filial</Badge>}
                    {w.terminals.length > 0 && <Badge title={w.terminals.join(", ")}>Padrão de {w.terminals.length} terminal(is)</Badge>}
                  </span>
                  {w.notes && <span className="mt-0.5 block max-w-xs text-xs text-slate-500">{w.notes}</span>}
                </td>
                <td>
                  <Badge tone={TYPE_TONE[w.type]}>{w.typeLabel}</Badge>
                </td>
                <td className="text-right tabular">{w.type === "sale" || w.type === "storage" ? (w.salePriority ?? 1) : "—"}</td>
                <td className="whitespace-nowrap text-right tabular">
                  {stockHref ? (
                    <Link className="text-brand-700 hover:underline" href={`${stockHref}&deposito=${w.id}`}>
                      {w.items} item(ns)
                    </Link>
                  ) : (
                    <span>{w.items} item(ns)</span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {formatQty(w.physical)} un. · {formatMoney(w.value)}
                    {w.reserved > 0 && ` · reservado ${formatQty(w.reserved)}`}
                  </span>
                </td>
                <td>
                  <StatusBadge kind="generic" status={w.status} />
                </td>
                {canManage && (
                  <td>
                    <span className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => open(w)} title="Editar">
                        <Pencil className="size-4" /> <span className="sr-only sm:not-sr-only">Editar</span>
                      </Button>
                      {!w.isBranchDefault && w.status === "active" && (w.type === "sale" || w.type === "storage") && (
                        <ActionButton size="sm" variant="ghost" action={setDefaultWarehouseAction.bind(null, w.id, branchId)} confirm={`Tornar ${w.name} o depósito padrão da filial (recebimentos, devoluções sem origem e terminais sem depósito próprio)?`} icon={<Star className="size-4" />} label="Tornar padrão" />
                      )}
                      {w.status === "active" && w.type !== "damaged" && !w.isBranchDefault && (
                        <ActionButton size="sm" variant="ghost" action={setWarehouseStatusAction.bind(null, w.id, branchId, "inactive")} askReason={`Motivo para desativar ${w.name} (o depósito precisa estar sem saldo e sem reservas):`} label="Desativar" />
                      )}
                      {w.status === "inactive" && <ActionButton size="sm" variant="ghost" action={setWarehouseStatusAction.bind(null, w.id, branchId, "active")} label="Reativar" />}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={current ? `Editar depósito ${current.code}` : "Novo depósito"} size="lg">
        {editing !== null && (
          <ActionForm action={saveWarehouseAction} onSuccess={() => setEditing(null)} className="space-y-4">
            {({ pending }) => (
              <>
                <input type="hidden" name="branchId" value={branchId} />
                {current && <input type="hidden" name="id" value={current.id} />}
                <FormGrid cols={2}>
                  <Field label="Nome" required>
                    <Input name="name" required maxLength={120} defaultValue={current?.name ?? ""} placeholder="Ex.: Almoxarifado" autoFocus />
                  </Field>
                  <Field label="Código" required hint="Único na filial: letras, números, hífen ou sublinhado.">
                    <Input name="code" required maxLength={20} defaultValue={current?.code ?? ""} placeholder="Ex.: ALMOX" className="uppercase" />
                  </Field>
                  <Field label="Tipo" required hint={typeHints[type]}>
                    {current?.type === "damaged" ? (
                      <>
                        <input type="hidden" name="type" value="damaged" />
                        <Input value="Avarias (do sistema — tipo fixo)" disabled readOnly />
                      </>
                    ) : (
                      <Select name="type" value={type} onChange={(e) => setType(e.target.value)} options={types} />
                    )}
                  </Field>
                  {(type === "sale" || type === "storage") && (
                    <Field label="Prioridade de baixa" hint="Ordem em que este depósito completa a venda quando o do terminal não tem saldo (1 = primeiro).">
                      <Input name="salePriority" type="number" min={1} max={99} step={1} defaultValue={current?.salePriority ?? (type === "storage" ? 2 : 1)} />
                    </Field>
                  )}
                  <Field label="Observações" className="sm:col-span-2">
                    <Textarea name="notes" rows={2} maxLength={500} defaultValue={current?.notes ?? ""} />
                  </Field>
                </FormGrid>
                {current && current.type !== type && (
                  <Notice tone="info">Mudar entre “disponível para venda” (venda, almoxarifado) e “uso e consumo” exige o depósito sem saldo e sem ser padrão da filial ou de terminal.</Notice>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                  <SubmitButton pending={pending}>{current ? "Salvar" : "Cadastrar depósito"}</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )}
      </Dialog>
    </Card>
  );
}
