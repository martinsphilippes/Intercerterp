"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search, UserPlus, UserRound } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { formatMoney } from "@/lib/money";
import { formatDoc, formatPhone, isValidCnpj, isValidCpf, onlyDigits } from "@/lib/core/text";
import { quickCustomerAction } from "../clientes/actions";

export interface CustomerInfo {
  id: string;
  name: string;
  tradeName?: string | null;
  personType: string;
  doc: string | null;
  email: string | null;
  mobile: string | null;
  vip?: boolean;
  creditLimit: number;
  openBalance: number;
  creditAvailable: number;
  vouchers?: Array<{ code: string; balance: number; expiresAt: string | null }>;
}

/**
 * Identificação do cliente no PDV (Tela 6): pesquisa por nome, CPF/CNPJ, telefone ou e-mail; conferência;
 * cadastro rápido (mesma identidade do CRM); consumidor final com CPF na nota opcional.
 */
export function CustomerPicker({
  open,
  onClose,
  current,
  cpfOnInvoice,
  onSelect,
  onConsumer,
  canCreate,
}: {
  open: boolean;
  onClose: () => void;
  current: CustomerInfo | null;
  cpfOnInvoice: string | null;
  onSelect: (c: CustomerInfo) => void;
  onConsumer: (cpf: string | null) => void;
  canCreate: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CustomerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"search" | "create">("search");
  const [cpf, setCpf] = useState(cpfOnInvoice ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ personType: "PF", name: "", doc: "", mobile: "", email: "" });

  useEffect(() => {
    if (open) {
      setMode("search");
      setError(null);
      setCpf(cpfOnInvoice ?? "");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, cpfOnInvoice]);

  useEffect(() => {
    if (!open || mode !== "search") return;
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pdv/customers?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
        const body = await res.json();
        if (alive) {
          setItems(res.ok ? body.items : []);
          setActive(0);
          if (!res.ok) setError(body.error ?? "Falha na pesquisa");
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open, mode]);

  const cpfDigits = onlyDigits(cpf);
  const cpfValid = !cpfDigits || (cpfDigits.length === 11 ? isValidCpf(cpfDigits) : cpfDigits.length === 14 ? isValidCnpj(cpfDigits) : false);

  const createQuick = () => {
    setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    start(async () => {
      const res = await quickCustomerAction(fd);
      if (!res.ok) return setError(res.error);
      const c = res.data as any;
      onSelect({ id: c.id, name: c.name, personType: c.personType, doc: c.doc ?? null, email: c.email ?? null, mobile: c.mobile ?? null, creditLimit: c.creditLimit ?? 0, openBalance: 0, creditAvailable: c.creditLimit ?? 0 });
      setForm({ personType: "PF", name: "", doc: "", mobile: "", email: "" });
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Identificar cliente (F4)" size="lg">
      <div className="mb-3 flex gap-2">
        <Button type="button" size="sm" variant={mode === "search" ? "primary" : "secondary"} onClick={() => setMode("search")}>
          <Search className="size-4" /> Pesquisar
        </Button>
        {canCreate && (
          <Button type="button" size="sm" variant={mode === "create" ? "primary" : "secondary"} onClick={() => setMode("create")}>
            <UserPlus className="size-4" /> Cadastro rápido
          </Button>
        )}
      </div>
      {mode === "search" ? (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, CPF/CNPJ, telefone ou e-mail"
              aria-label="Pesquisar cliente"
              className={cn(inputClass, "h-9 pl-8")}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && items[active]) {
                  e.preventDefault();
                  onSelect(items[active]);
                }
              }}
            />
            {loading && <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-slate-400" />}
          </div>
          <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Clientes">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{q.trim().length < 2 ? "Digite ao menos 2 caracteres." : loading ? "Pesquisando…" : "Nenhum cliente encontrado. Use o cadastro rápido."}</li>}
            {items.map((c, i) => (
              <li key={c.id}>
                <button type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => onSelect(c)} className={cn("flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm", i === active ? "bg-brand-50" : "hover:bg-slate-50")}>
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{c.name}</span>
                    {c.vip && <Badge tone="accent" className="ml-2">VIP</Badge>}
                    <span className="block text-xs text-slate-500">{[c.doc ? formatDoc(c.doc) : "sem documento", formatPhone(c.mobile), c.email].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-right text-xs text-slate-500">
                    {c.creditLimit > 0 ? <>Crédito disponível <b className="tabular text-ink">{formatMoney(c.creditAvailable)}</b></> : "Sem crediário"}
                    {(c.vouchers ?? []).length > 0 && <span className="block text-emerald-700">Vale-crédito {formatMoney((c.vouchers ?? []).reduce((a, v) => a + v.balance, 0))}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={form.personType} onChange={(e) => setForm({ ...form, personType: e.target.value })} options={[{ value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" }]} />
          </Field>
          <Field label={form.personType === "PF" ? "CPF" : "CNPJ"} hint="Opcional; garante identidade única no CRM">
            <Input value={form.doc} inputMode="numeric" onChange={(e) => setForm({ ...form, doc: e.target.value })} />
          </Field>
          <Field label="Nome" required className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Celular">
            <Input value={form.mobile} inputMode="tel" onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <Input value={form.email} type="email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="button" variant="primary" loading={pending} onClick={createQuick} disabled={!form.name.trim()}>
              <UserPlus className="size-4" /> Cadastrar e selecionar
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="mt-4 rounded-md border border-line bg-slate-50 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <UserRound className="size-4" /> Consumidor final
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="CPF/CNPJ na nota (opcional)" error={cpfValid ? null : "CPF/CNPJ inválido"} className="min-w-[220px] flex-1">
            <Input value={cpf} inputMode="numeric" onChange={(e) => setCpf(e.target.value)} placeholder="Somente se o cliente pedir" aria-invalid={!cpfValid} />
          </Field>
          <Button type="button" disabled={!cpfValid} onClick={() => onConsumer(cpfDigits || null)}>
            Continuar como consumidor final
          </Button>
        </div>
        {current && <p className="mt-2 text-xs text-slate-500">Cliente atual: {current.name}. Continuar como consumidor final remove a identificação.</p>}
      </div>
    </Dialog>
  );
}
