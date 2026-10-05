"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/empty";
import { createInventoryAction } from "../actions";

type Opt = { value: string; label: string };

export function NewInventoryButton({ warehouses, categories, locations, users, currentUserId }: { warehouses: Opt[]; categories: Opt[]; locations: string[]; users: Opt[]; currentUserId: string }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("all");
  return (
    <>
      <Button type="button" variant="accent" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Novo inventário
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Novo inventário" size="lg">
        <ActionForm action={createInventoryAction} className="space-y-4">
          {({ pending, error }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Depósito" required>
                  <Select name="warehouseId" options={warehouses} />
                </Field>
                <Field label="Responsável">
                  <Select name="responsibleId" defaultValue={currentUserId} options={users} />
                </Field>
                <Field label="Escopo" required>
                  <Select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} options={[{ value: "all", label: "Todos os produtos do depósito" }, { value: "category", label: "Por categoria (inclui subcategorias)" }, { value: "location", label: "Por localização / setor" }]} />
                </Field>
                {scope === "category" && (
                  <Field label="Categoria" required>
                    <Select name="categoryId" options={categories} />
                  </Field>
                )}
                {scope === "location" && (
                  <Field label="Localização (prefixo)" required hint={locations.length ? `Em uso: ${locations.slice(0, 6).join(", ")}${locations.length > 6 ? "…" : ""}` : "Defina a localização nos parâmetros de estoque do produto."}>
                    <Input name="location" list="inv-locations" placeholder="Ex.: A-02" />
                    <datalist id="inv-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
                  </Field>
                )}
              </div>
              <Field label="Observações">
                <Textarea name="notes" rows={2} />
              </Field>
              <Notice tone="info">
                Ao abrir, o sistema registra a <strong>base</strong> (saldo e sequência de movimentos de cada item neste instante). A loja continua operando: vendas e entradas após a base entram no esperado de cada item até o momento da sua contagem.
              </Notice>
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <SubmitButton pending={pending}>Abrir inventário</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
