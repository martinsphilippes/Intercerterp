"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { Button, buttonClass } from "@/components/ui/button";
import { saveSellerAction } from "./actions";

type Opt = { value: string; label: string };

export interface SellerFormValue {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loginDisabled: boolean;
  commissionBps: number | null;
  commissionByCategory: Record<string, number>;
}

const pct = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100));

/** Cadastro de vendedor sem acesso ao sistema ou edição dos percentuais de comissão (CAD-05). */
export function SellerForm({ seller, categories }: { seller?: SellerFormValue | null; categories: Opt[] }) {
  const [rows, setRows] = useState<Array<{ key: number; cat: string; pct: string }>>(() =>
    Object.entries(seller?.commissionByCategory ?? {}).map(([cat, bps], i) => ({ key: i, cat, pct: pct(bps) })),
  );
  const [next, setNext] = useState(rows.length);
  const userOnly = Boolean(seller && !seller.loginDisabled);
  return (
    <ActionForm action={saveSellerAction} className="space-y-4" resetOnSuccess={!seller}>
      {({ pending, error }) => (
        <>
          {seller?.id && <input type="hidden" name="id" value={seller.id} />}
          {userOnly && <Notice tone="info">Usuário do sistema: nome, e-mail e acesso são alterados em Administração › Usuários. Aqui ficam só os percentuais de comissão.</Notice>}
          <FormGrid cols={2}>
            <Field label="Nome" required htmlFor="seller-name">
              <Input id="seller-name" name="name" defaultValue={seller?.name ?? ""} required minLength={2} maxLength={200} disabled={userOnly} />
            </Field>
            <Field label="Comissão geral (%)" htmlFor="seller-pct" hint="Sobre o valor líquido dos itens (após descontos). Vazio = sem comissão.">
              <Input id="seller-pct" name="commissionPct" type="number" min={0} max={100} step={0.01} inputMode="decimal" defaultValue={pct(seller?.commissionBps)} />
            </Field>
            {!userOnly && (
              <>
                <Field label="E-mail" htmlFor="seller-email" hint="Opcional — o vendedor não recebe convite nem acessa o sistema.">
                  <Input id="seller-email" name="email" type="email" maxLength={200} defaultValue={seller?.email ?? ""} />
                </Field>
                <Field label="Telefone" htmlFor="seller-phone">
                  <Input id="seller-phone" name="phone" inputMode="tel" maxLength={20} defaultValue={seller?.phone ?? ""} />
                </Field>
              </>
            )}
          </FormGrid>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Comissão por categoria de produto</legend>
            <p className="text-xs text-slate-500">Substitui o percentual geral nos itens da categoria.</p>
            {rows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-2">
                <Select
                  name="catId"
                  aria-label="Categoria"
                  className="min-w-0 flex-1"
                  value={r.cat}
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, cat: e.target.value } : x)))}
                  options={categories}
                  placeholder="Categoria…"
                />
                <Input name="catPct" aria-label="Percentual da categoria" type="number" min={0} max={100} step={0.01} inputMode="decimal" className="w-24" value={r.pct} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, pct: e.target.value } : x)))} />
                <span className="text-sm text-slate-500">%</span>
                <Button type="button" variant="ghost" size="sm" aria-label="Remover categoria" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!categories.length}
              onClick={() => {
                setRows((rs) => [...rs, { key: next, cat: "", pct: "" }]);
                setNext((n) => n + 1);
              }}
            >
              <Plus className="size-4" aria-hidden /> Percentual por categoria
            </Button>
          </fieldset>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            {seller && (
              <Link href="/vendas/vendedores" className={buttonClass("ghost")}>
                Cancelar edição
              </Link>
            )}
            <SubmitButton pending={pending}>{seller ? "Salvar" : "Cadastrar vendedor"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
