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
  status?: string;
  creditLimit: number;
  openBalance: number;
  creditAvailable: number;
  priceTableId?: string | null;
  priceTableName?: string | null;
  lastPurchaseAt?: string | null;
  vouchers?: Array<{ code: string; balance: number; expiresAt: string | null }>;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

function daysAgo(iso: string | null | undefined) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "Última compra hoje" : d === 1 ? "Última compra ontem" : `Última compra há ${d} dias`;
}

/**
 * Identificação do cliente no PDV (Tela 6): busca incremental por nome, CPF/CNPJ, telefone ou e-mail; conferência do
 * cliente selecionado antes de usar; cadastro rápido (mesma identidade do CRM, sem duplicar CPF/CNPJ);
 * consumidor final com CPF na nota opcional.
 */
export function CustomerPicker({
  open,
  onClose,
  current,
  cpfOnInvoice,
  onSelect,
  onConsumer,
  canCreate,
  total,
}: {
  open: boolean;
  onClose: () => void;
  current: CustomerInfo | null;
  cpfOnInvoice: string | null;
  onSelect: (c: CustomerInfo) => void;
  onConsumer: (cpf: string | null) => void;
  canCreate: boolean;
  total: number;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CustomerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
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
      setActive(-1);
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
          setActive(res.ok && body.items.length ? 0 : -1);
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
  const chosen = active >= 0 ? items[active] : null;
  const formDocDigits = onlyDigits(form.doc);
  const formDocValid = !formDocDigits || (form.personType === "PF" ? isValidCpf(formDocDigits) : isValidCnpj(formDocDigits));

  const createQuick = () => {
    setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) fd.set(k, v);
    start(async () => {
      const res = await quickCustomerAction(fd);
      if (!res.ok) return setError(res.error);
      const c = res.data as any;
      onSelect({ id: c.id, name: c.name, personType: c.personType, doc: c.doc ?? null, email: c.email ?? null, mobile: c.mobile ?? null, creditLimit: c.creditLimit ?? 0, openBalance: 0, creditAvailable: c.creditLimit ?? 0, status: "active" });
      setForm({ personType: "PF", name: "", doc: "", mobile: "", email: "" });
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Identificar cliente — total ${formatMoney(total)}`}
      size="lg"
      footer={
        mode === "search" ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!chosen} onClick={() => chosen && onSelect(chosen)}>
              Usar este cliente
            </Button>
          </>
        ) : undefined
      }
    >
      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {(["search", "create"] as const).filter((m) => m === "search" || canCreate).map((m) => (
          <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", mode === m ? "border-accent-500 text-brand-800" : "border-transparent text-slate-500")}>
            {m === "search" ? <><Search className="size-4" /> Buscar cliente</> : <><UserPlus className="size-4" /> Cadastro rápido</>}
          </button>
        ))}
      </div>
      {mode === "search" ? (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Digite CPF, CNPJ, nome, telefone ou e-mail"
              aria-label="Pesquisar cliente"
              className={cn(inputClass, "h-9 pl-8")}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && chosen) {
                  e.preventDefault();
                  onSelect(chosen);
                }
              }}
            />
            {loading && <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-slate-400" />}
          </div>
          <p className="mt-1 text-xs text-slate-500">A busca começa automaticamente enquanto você digita. Clique para conferir; Enter ou “Usar este cliente” para confirmar.</p>
          <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line" role="listbox" aria-label="Clientes">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{q.trim().length < 2 ? "Digite ao menos 2 caracteres." : loading ? "Pesquisando…" : "Nenhum cliente encontrado. Use o cadastro rápido."}</li>}
            {items.map((c, i) => (
              <li key={c.id}>
                <button type="button" role="option" aria-selected={i === active} onClick={() => setActive(i)} onDoubleClick={() => onSelect(c)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active ? "bg-brand-50 ring-1 ring-inset ring-brand-300" : "hover:bg-slate-50")}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800" aria-hidden>{initials(c.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{c.name}</span>
                    {c.vip && <Badge tone="accent" className="ml-2">VIP</Badge>}
                    <span className="block text-xs text-slate-500">{[c.doc ? `${c.personType === "PJ" ? "CNPJ" : "CPF"} ${formatDoc(c.doc)}` : "sem documento", formatPhone(c.mobile), c.email].filter(Boolean).join(" • ")}</span>
                  </span>
                  <span className="text-right text-xs text-slate-500">
                    <span className="flex justify-end gap-1">
                      <Badge tone={c.status === "active" ? "good" : "neutral"}>{c.status === "active" ? "Cliente ativo" : c.status === "draft" ? "Rascunho" : "Inativo"}</Badge>
                      {c.personType === "PJ" && <Badge tone="info">Pessoa jurídica</Badge>}
                    </span>
                    <span className="mt-0.5 block">{daysAgo(c.lastPurchaseAt) ?? "Sem compras"}</span>
                    {c.creditLimit > 0 && <span className="block">Crédito disponível: <b className="tabular text-ink">{formatMoney(c.creditAvailable)}</b></span>}
                    {c.priceTableName && <span className="block">Tabela de preço: {c.priceTableName}</span>}
                    {(c.vouchers ?? []).length > 0 && <span className="block text-emerald-700">Vale-crédito {formatMoney((c.vouchers ?? []).reduce((a, v) => a + v.balance, 0))}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {chosen && (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Conferência: <b>{chosen.name}</b> — {chosen.doc ? formatDoc(chosen.doc) : "sem CPF/CNPJ (a NFC-e sairá sem identificação do consumidor)"}{chosen.email ? ` · ${chosen.email}` : ""}. Os dados do cadastro serão usados na nota, no histórico e no crédito.
            </p>
          )}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={form.personType} onChange={(e) => setForm({ ...form, personType: e.target.value })} options={[{ value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" }]} />
          </Field>
          <Field label={form.personType === "PF" ? "CPF" : "CNPJ"} hint="Evita duplicidade: o CRM recusa documento já cadastrado" error={formDocValid ? null : "Documento inválido"}>
            <Input value={form.doc} inputMode="numeric" onChange={(e) => setForm({ ...form, doc: e.target.value })} aria-invalid={!formDocValid} />
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
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" onClick={() => setMode("search")}>Voltar à busca</Button>
            <Button type="button" variant="primary" loading={pending} onClick={createQuick} disabled={!form.name.trim() || !formDocValid}>
              <UserPlus className="size-4" /> Cadastrar e usar
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="mt-4 rounded-md border border-line bg-slate-50 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <UserRound className="size-4" /> Continuar como consumidor final
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
