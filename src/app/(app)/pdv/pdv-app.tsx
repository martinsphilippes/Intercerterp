"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeftRight, BadgePercent, Ban, CheckCircle2, ClipboardList, CloudOff, CreditCard, LogOut, Minus, Monitor, Pencil, Plus, RefreshCcw, Save, ShoppingCart, Trash2, UserRound, Wallet,
} from "lucide-react";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { formatMoney, formatQty, formatBps, QTY, pct } from "@/lib/money";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { cartTotals, effectiveUnitPrice, tablePrice, type CartItem } from "@/domain/cart-calc";
import { ProductSearch, type ProductHit, type ProductSearchHandle } from "./product-search";
import { CustomerPicker, type CustomerInfo } from "./customer-picker";
import { cancelCartAction, parkCartAction, resumeCartAction, saveCartAction, startExchangeAction, type PlainCart } from "./actions";

type Line = CartItem & { key?: string };

export interface PdvProps {
  branch: { id: string; name: string };
  companyName: string;
  operator: { id: string; name: string; discountLimitBps: number; canOverLimit: boolean; canCreateCustomer: boolean };
  terminal: { id: string; name: string; code: string; printerMode: string | null; scannerMode: string | null };
  terminals: Array<{ id: string; name: string; code: string; status: string }>;
  session: { id: string; number: number; openedAt: string; operatorName: string; status: string } | null;
  cart: PlainCart;
  customer: CustomerInfo | null;
  priceTables: Array<{ value: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
  brands: Array<{ value: string; label: string }>;
  sellers: Array<{ value: string; label: string }>;
  quickMethods: Array<{ id: string; name: string; kind: string }>;
  fiscal: { label: string; tone: "sim" | "warn" | "good" | "neutral" };
  parked: Array<{ id: string; name: string | null; customerName: string | null; total: number; itemsCount: number; parkedAt: string; expired: boolean; operatorName: string; terminalName: string }>;
  allowNegative: boolean;
  exchange: { returnId: string; number: number; saleNumber: number; voucherCode: string | null; voucherBalance: number } | null;
  pendingExchange: { returnId: string; number: number; itemsTotal: number } | null;
}

const TERMINAL_COOKIE = "ic_pdv_terminal";
const lsKey = (cartId: string) => `ic.pdv.cart.${cartId}`;

function isTyping(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    return input.value.length > 0 || !input.hasAttribute("data-pdv-search");
  }
  return (el as HTMLElement).isContentEditable;
}

/**
 * Frente de caixa (Tela 4) — modo dedicado em tela cheia: área de itens ampla, totais sempre visíveis,
 * operação por teclado e leitor, atendimento gravado no servidor (e cópia local) a cada alteração.
 */
export function PdvApp(props: PdvProps) {
  const router = useRouter();
  const toast = useToast();
  const [cart, setCart] = useState<PlainCart>(props.cart);
  const [customer, setCustomer] = useState<CustomerInfo | null>(props.customer);
  const [selected, setSelected] = useState(props.cart.items.length ? props.cart.items.length - 1 : -1);
  const [saveState, setSaveState] = useState<{ state: "saved" | "saving" | "error"; at?: string; error?: string }>({ state: "saved", at: props.cart.updatedAt });
  const [dialog, setDialog] = useState<null | "customer" | "discount" | "line" | "park" | "cancel" | "new" | "parked">(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<ProductSearchHandle>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  const totals = useMemo(() => cartTotals(cart), [cart]);
  const items = cart.items as Line[];

  // Outro atendimento (retomada, nova venda) chega com outro id e remonta o componente (key);
  // re-renderizações do servidor para o MESMO atendimento não sobrescrevem o estado local ainda não gravado.

  // ── terminal escolhido fica no navegador
  useEffect(() => {
    try {
      document.cookie = `${TERMINAL_COOKIE}=${props.branch.id}:${props.terminal.id}; path=/; max-age=31536000; samesite=lax`;
      localStorage.setItem(`ic.pdv.terminal.${props.branch.id}`, props.terminal.id);
    } catch {
      /* sem armazenamento */
    }
  }, [props.branch.id, props.terminal.id]);

  // ── recuperação: cópia local mais nova que a do servidor (ex.: queda de rede antes do autosalvamento)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey(props.cart.id));
      if (!raw) return;
      const backup = JSON.parse(raw);
      if (backup && backup.synced === false && backup.cart?.id === props.cart.id && backup.savedAt > (props.cart.updatedAt ?? "")) {
        setCart((c) => ({ ...c, ...backup.cart, id: c.id }));
        dirty.current = true;
        toast("info", "Atendimento recuperado da cópia local deste navegador.");
        scheduleSave(0);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.cart.id]);

  const persist = useCallback(async () => {
    if (!dirty.current) return true;
    const c = cartRef.current;
    dirty.current = false;
    setSaveState({ state: "saving" });
    const res = await saveCartAction(c.id, {
      items: c.items, customerId: c.customerId, cpfOnInvoice: c.cpfOnInvoice, priceTableId: c.priceTableId, globalDiscount: c.globalDiscount, globalDiscountBps: c.globalDiscountBps, surcharge: c.surcharge, notes: c.notes,
      sellerId: c.sellerId, emitFiscal: c.emitFiscal,
    });
    if (!res.ok) {
      setSaveState({ state: "error", error: res.error });
      if (res.code === "cart_converted" || res.code === "cart_not_open") {
        toast("error", res.error);
        router.refresh();
      } else dirty.current = true;
      return false;
    }
    try {
      localStorage.setItem(lsKey(c.id), JSON.stringify({ cart: c, savedAt: new Date().toISOString(), synced: true }));
    } catch {
      /* ignore */
    }
    setSaveState({ state: "saved", at: res.data!.updatedAt });
    return true;
  }, [router, toast]);

  const scheduleSave = useCallback(
    (delay = 500) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(), delay);
    },
    [persist],
  );

  const update = useCallback(
    (fn: (c: PlainCart) => PlainCart) => {
      setCart((c) => {
        const next = fn(c);
        try {
          localStorage.setItem(lsKey(next.id), JSON.stringify({ cart: next, savedAt: new Date().toISOString(), synced: false }));
        } catch {
          /* ignore */
        }
        return next;
      });
      dirty.current = true;
      scheduleSave();
    },
    [scheduleSave],
  );

  // grava pendências ao sair/atualizar
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        void persist();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [persist]);

  // ── itens
  const qtyInCart = (skuId: string, exceptIdx = -1) => items.reduce((a, l, i) => (l.skuId === skuId && i !== exceptIdx ? a + l.qty : a), 0);

  const stockBlocks = (line: Pick<Line, "service" | "available" | "skuId" | "name">, newQty: number, idx = -1) => {
    if (line.service || props.allowNegative || line.available == null) return null;
    const total = qtyInCart(line.skuId, idx) + newQty;
    if (total > line.available) return `Sem saldo disponível para ${line.name}: disponível ${formatQty(line.available)}, no atendimento ${formatQty(total)}. A configuração comercial não permite venda sem saldo.`;
    return null;
  };

  const addHit = (hit: ProductHit, qty: number) => {
    if (!hit.priced) {
      toast("error", `${hit.name} sem preço vigente na tabela selecionada.`);
      return false;
    }
    const existing = items.findIndex((l) => l.skuId === hit.skuId && l.unitPrice == null && !l.itemDiscount && !l.itemSurcharge);
    const block = stockBlocks({ ...hit }, existing >= 0 ? items[existing].qty + qty : qty, existing);
    if (block) {
      toast("error", block);
      return false;
    }
    if (!hit.service && hit.available != null && qtyInCart(hit.skuId) + qty > hit.available) toast("info", `Venda sem saldo permitida pela configuração comercial: ${hit.name} (disponível ${formatQty(hit.available)}).`);
    update((c) => {
      const list = [...(c.items as Line[])];
      if (existing >= 0) {
        list[existing] = { ...list[existing], qty: list[existing].qty + qty, available: hit.available };
        setSelected(existing);
      } else {
        list.push({
          skuId: hit.skuId, qty, unitPrice: null, itemDiscount: 0, itemSurcharge: 0, sku: hit.sku, name: hit.name, unitCode: hit.unitCode, listPrice: hit.listPrice,
          wholesalePrice: hit.wholesalePrice, wholesaleMinQty: hit.wholesaleMinQty, available: hit.available, service: hit.service, maxDiscountBps: hit.maxDiscountBps, attributes: hit.attributes,
        });
        setSelected(list.length - 1);
      }
      return { ...c, items: list };
    });
    return true;
  };

  const setQty = (idx: number, qty: number) => {
    const line = items[idx];
    if (!line) return;
    if (qty <= 0) return removeLine(idx);
    const block = stockBlocks(line, qty, idx);
    if (block && qty > line.qty) {
      toast("error", block);
      return;
    }
    update((c) => ({ ...c, items: (c.items as Line[]).map((l, i) => (i === idx ? { ...l, qty } : l)) }));
  };

  const removeLine = (idx: number) => {
    const line = items[idx];
    if (!line) return;
    update((c) => ({ ...c, items: (c.items as Line[]).filter((_, i) => i !== idx) }));
    setSelected((s) => Math.max(-1, Math.min(s, items.length - 2)));
    toast("info", `Item removido: ${line.name ?? line.sku}`);
  };

  // ── tabela de preço: reconsulta preços dos itens
  const changeTable = async (priceTableId: string) => {
    const ids = [...new Set(items.map((l) => l.skuId))];
    let map = new Map<string, ProductHit>();
    if (ids.length) {
      const res = await fetch(`/api/pdv/products?ids=${ids.join(",")}&tabela=${priceTableId}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) return toast("error", body.error ?? "Falha ao consultar preços.");
      map = new Map((body.items as ProductHit[]).map((h) => [h.skuId, h]));
      const missing = ids.filter((id) => !map.get(id)?.priced);
      if (missing.length) toast("error", `${missing.length} item(ns) sem preço na tabela escolhida — mantidos com o preço anterior até a revisão.`);
    }
    update((c) => ({
      ...c,
      priceTableId,
      items: (c.items as Line[]).map((l) => {
        const h = map.get(l.skuId);
        return h?.priced ? { ...l, listPrice: h.listPrice, wholesalePrice: h.wholesalePrice, wholesaleMinQty: h.wholesaleMinQty, maxDiscountBps: h.maxDiscountBps, available: h.available } : l;
      }),
    }));
  };

  // ── navegação
  const goPayment = async (methodId?: string) => {
    if (!items.length) return toast("error", "Adicione itens ao atendimento.");
    if (!props.session) return toast("error", "Caixa fechado neste terminal: abra o caixa para receber pagamentos.");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const ok = await persist();
    if (!ok && dirty.current) return toast("error", "Não foi possível gravar o atendimento. Verifique a conexão e tente novamente.");
    router.push(`/pdv/pagamento?carrinho=${cart.id}${methodId ? `&meio=${methodId}` : ""}`);
  };

  const anyDialog = dialog !== null;
  // ── atalhos de teclado (exibidos na interface). preventDefault evita F4/F10 do navegador.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        setDialog(null);
        searchRef.current?.focus();
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        setDialog("customer");
        return;
      }
      if (e.key === "F10") {
        e.preventDefault();
        if (!anyDialog) void goPayment();
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        if (items.length) setDialog("park");
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        setDialog("discount");
        return;
      }
      if (anyDialog) return; // Esc nos diálogos é tratado por eles
      if (e.key === "Escape") {
        if (searchRef.current?.isOpen() || searchRef.current?.hasText()) {
          e.preventDefault();
          searchRef.current?.close();
        }
        return;
      }
      const typing = isTyping(document.activeElement);
      if (typing) return;
      if (e.key === "Delete" && selected >= 0) {
        e.preventDefault();
        removeLine(selected);
      } else if ((e.key === "+" || e.code === "NumpadAdd") && selected >= 0) {
        e.preventDefault();
        setQty(selected, items[selected].qty + QTY);
      } else if ((e.key === "-" || e.code === "NumpadSubtract") && selected >= 0) {
        e.preventDefault();
        setQty(selected, items[selected].qty - QTY);
      } else if (e.key === "ArrowDown" && items.length) {
        e.preventDefault();
        setSelected((s) => Math.min(items.length - 1, s + 1));
      } else if (e.key === "ArrowUp" && items.length) {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter" && selected >= 0 && document.activeElement?.tagName !== "BUTTON") {
        e.preventDefault();
        setDialog("line");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // foco previsível: busca ao abrir e após fechar diálogos
  useEffect(() => {
    if (!dialog) searchRef.current?.focus();
  }, [dialog]);

  const terminalChange = (id: string) => {
    try {
      document.cookie = `${TERMINAL_COOKIE}=${props.branch.id}:${id}; path=/; max-age=31536000; samesite=lax`;
      localStorage.setItem(`ic.pdv.terminal.${props.branch.id}`, id);
    } catch {
      /* ignore */
    }
    router.push(`/pdv?terminal=${id}`);
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: any }>, after?: (d: any) => void) =>
    start(async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist();
      const res = await fn();
      if (!res.ok) return toast("error", res.error ?? "Falha.");
      if (res.message) toast("success", res.message);
      after?.(res.data);
      setDialog(null);
      router.refresh();
    });

  const line = selected >= 0 ? items[selected] : null;
  const discountBps = totals.subtotal > 0 ? Math.round((totals.discountTotal * 10000) / totals.subtotal) : 0;
  const overLimit = !props.operator.canOverLimit && discountBps > props.operator.discountLimitBps;
  const exchangeVoucher = props.exchange?.voucherBalance ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-canvas text-ink" data-pdv>
      {/* Barra superior: filial, terminal, operador e sessão de caixa */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-brand-900 px-3 py-2 text-sm text-white">
        <span className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="size-5 text-accent-500" /> PDV
        </span>
        <span className="hidden text-brand-200 xl:inline">{props.companyName} · {props.branch.name}</span>
        <span className="hidden flex-col leading-tight md:flex" title={`Atendimento ${cart.id}`}>
          <span className="text-[11px] text-brand-200">{cart.exchangeReturnId ? "Troca em andamento" : "Venda em andamento"}</span>
          <span className="font-mono text-xs">#{cart.id.slice(0, 8).toUpperCase()}</span>
        </span>
        <label className="flex items-center gap-1.5">
          <Monitor className="size-4 text-brand-200" aria-hidden />
          <span className="sr-only">Terminal</span>
          <select value={props.terminal.id} onChange={(e) => terminalChange(e.target.value)} className="rounded bg-brand-800 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-300" aria-label="Terminal ativo">
            {props.terminals.map((t) => (
              <option key={t.id} value={t.id} disabled={t.status !== "active"}>
                {t.code} — {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1.5 text-brand-100">
          <UserRound className="size-4" aria-hidden /> {props.operator.name}
        </span>
        {props.session ? (
          <Link href={`/caixa/${props.session.id}`} className="flex items-center gap-1.5 rounded bg-emerald-600/20 px-2 py-0.5 text-emerald-100 hover:bg-emerald-600/30">
            <Wallet className="size-4" /> {props.terminal.code} · <span className="size-2 rounded-full bg-emerald-400" aria-hidden /> {props.session.status === "reopened" ? "Reaberto" : "Aberto"} (sessão nº {props.session.number} · {props.session.operatorName})
          </Link>
        ) : (
          <Link href={`/caixa/abertura?terminal=${props.terminal.id}`} className="flex items-center gap-1.5 rounded bg-red-500/20 px-2 py-0.5 text-red-100 hover:bg-red-500/30">
            <AlertTriangle className="size-4" /> Caixa fechado — abrir
          </Link>
        )}
        <span className={cn("ml-auto flex items-center gap-1 text-xs", saveState.state === "error" ? "text-red-200" : "text-brand-200")} role="status" aria-live="polite">
          {saveState.state === "saving" ? <RefreshCcw className="size-3.5 animate-spin" /> : saveState.state === "error" ? <CloudOff className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
          {saveState.state === "saving" ? "Gravando…" : saveState.state === "error" ? "Não gravado no servidor (cópia local mantida)" : `Atendimento gravado ${saveState.at ? new Date(saveState.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}`}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setDialog("parked")} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-brand-800">
            <ClipboardList className="size-4" /> Pré-vendas{props.parked.length ? <span className="rounded-full bg-accent-500 px-1.5 text-xs">{props.parked.length}</span> : null}
          </button>
          <Link href="/caixa/movimentos" className="hidden items-center gap-1 rounded px-2 py-1 hover:bg-brand-800 lg:flex">
            <Wallet className="size-4" /> Caixa
          </Link>
          <Link href="/vendas" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-brand-800" title="Sair do PDV (histórico de vendas)">
            <LogOut className="size-4" /> <span className="hidden sm:inline">Sair do PDV</span>
          </Link>
        </div>
      </header>

      {!props.session && (
        <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="alert">
          <AlertTriangle className="size-4" /> Não há caixa aberto no terminal {props.terminal.name}. Você pode montar o atendimento, mas o pagamento exige caixa aberto.
          <LinkButton href={`/caixa/abertura?terminal=${props.terminal.id}`} size="sm" variant="primary">Abrir caixa</LinkButton>
        </div>
      )}
      {props.pendingExchange && (
        <div className="flex flex-wrap items-center gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <ArrowLeftRight className="size-4" /> Troca da devolução nº {props.pendingExchange.number} ({formatMoney(props.pendingExchange.itemsTotal)}) aguardando. O atendimento atual tem itens.
          <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => startExchangeAction(props.terminal.id, props.pendingExchange!.returnId))}>
            Salvar atual como pré-venda e iniciar a troca
          </Button>
        </div>
      )}
      {props.exchange && (
        <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          <ArrowLeftRight className="size-4" /> Troca — devolução nº {props.exchange.number} (venda nº {props.exchange.saleNumber}). Vale {props.exchange.voucherCode} com {formatMoney(exchangeVoucher)} será aplicado no pagamento.
          <span className="font-semibold">
            {totals.total >= exchangeVoucher ? `Diferença a pagar pelo cliente: ${formatMoney(totals.total - exchangeVoucher)}` : `Diferença a favor do cliente: ${formatMoney(exchangeVoucher - totals.total)} (permanece no vale)`}
          </span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Itens */}
        <section className="flex min-h-0 flex-col gap-3" aria-label="Itens do atendimento">
          <ProductSearch ref={searchRef} priceTableId={cart.priceTableId} categories={props.categories} brands={props.brands} branchName={props.branch.name} allowNegative={props.allowNegative} onAdd={addHit} />
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-white">
            {items.length === 0 ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-8 text-center text-slate-500">
                <ShoppingCart className="size-12 text-slate-300" />
                <p className="text-base font-medium text-slate-700">Atendimento vazio</p>
                <p className="text-sm">Leia o código de barras ou pesquise o produto (F2). Use 3*código para lançar quantidade.</p>
              </div>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2 text-center">Quantidade</th>
                    <th className="px-3 py-2 text-right">Preço un.</th>
                    <th className="px-3 py-2 text-right">Desc./acrés.</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                    <th className="px-3 py-2" aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((l, i) => {
                    const calc = totals.items[i];
                    const unit = effectiveUnitPrice(l);
                    const table = tablePrice(l);
                    const wholesale = l.unitPrice == null && table !== (l.listPrice ?? 0);
                    const short = !l.service && l.available != null && qtyInCart(l.skuId) > l.available;
                    return (
                      <tr
                        key={`${l.skuId}-${i}`}
                        onClick={() => setSelected(i)}
                        onDoubleClick={() => {
                          setSelected(i);
                          setDialog("line");
                        }}
                        aria-selected={i === selected}
                        className={cn("cursor-pointer border-b border-line", i === selected ? "bg-brand-50 ring-1 ring-inset ring-brand-300" : "hover:bg-slate-50")}
                      >
                        <td className="tabular px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-ink">{l.name ?? l.sku}</p>
                          <p className="font-mono text-xs text-slate-500">
                            {[l.sku, ...Object.values(l.attributes ?? {}), l.unitCode].filter(Boolean).join(" • ")}
                            {wholesale && <Badge tone="accent" className="ml-2">atacado</Badge>}
                            {short && <Badge tone="warn" className="ml-2">sem saldo ({formatQty(l.available)})</Badge>}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" aria-label="Diminuir quantidade (−)" className="focus-ring rounded border border-line p-1.5 hover:bg-slate-100" onClick={(e) => { e.stopPropagation(); setQty(i, l.qty - QTY); }}>
                              <Minus className="size-3.5" />
                            </button>
                            <span className="tabular min-w-[64px] text-center text-base font-semibold">{formatQty(l.qty)}</span>
                            <button type="button" aria-label="Aumentar quantidade (+)" className="focus-ring rounded border border-line p-1.5 hover:bg-slate-100" onClick={(e) => { e.stopPropagation(); setQty(i, l.qty + QTY); }}>
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {formatMoney(unit)}
                          {l.unitPrice != null && l.unitPrice !== table && <span className="block text-xs text-slate-400 line-through">{formatMoney(table)}</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-xs">
                          {calc && calc.itemDiscount + calc.globalDiscount > 0 && <span className="block text-red-700">−{formatMoney(calc.itemDiscount + calc.globalDiscount)}</span>}
                          {calc && calc.surcharge > 0 && <span className="block text-emerald-700">+{formatMoney(calc.surcharge)}</span>}
                          {calc && calc.itemDiscount + calc.globalDiscount === 0 && calc.surcharge === 0 && <span className="text-slate-300">—</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-base font-semibold">{formatMoney(calc?.total ?? 0)}</td>
                        <td className="px-2 py-2">
                          <div className="flex justify-end gap-1">
                            <button type="button" aria-label="Editar item (Enter)" className="focus-ring rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink" onClick={(e) => { e.stopPropagation(); setSelected(i); setDialog("line"); }}>
                              <Pencil className="size-4" />
                            </button>
                            <button type="button" aria-label="Remover item (Del)" className="focus-ring rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={(e) => { e.stopPropagation(); removeLine(i); }}>
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-slate-500" aria-live="polite">
            {items.length} {items.length === 1 ? "produto" : "produtos"} • {formatQty(items.reduce((a, l) => a + l.qty, 0))} {items.length === 1 && items[0].unitCode ? items[0].unitCode : "unidades"} na venda
            {selected >= 0 && items[selected] ? ` · selecionado: ${selected + 1}` : ""}
          </p>
        </section>

        {/* Painel lateral: cliente, tabela, totais e ações */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto" aria-label="Resumo do atendimento">
          <button type="button" onClick={() => setDialog("customer")} className="focus-ring rounded-lg border border-line bg-white p-3 text-left hover:border-brand-300">
            <p className="flex items-center justify-between text-xs font-medium text-slate-500">
              Cliente da venda <span className="flex items-center gap-1"><Pencil className="size-3.5" /><kbd className="rounded border border-line px-1">F4</kbd></span>
            </p>
            {customer ? (
              <>
                <p className="mt-1 font-semibold text-ink">{customer.name} {customer.vip && <Badge tone="accent">VIP</Badge>}</p>
                <p className="text-xs text-slate-500">{[customer.doc ? formatDoc(customer.doc) : "sem documento", formatPhone(customer.mobile)].filter(Boolean).join(" · ")}</p>
                {customer.creditLimit > 0 && <p className="text-xs text-slate-500">Crediário disponível: <b className="tabular">{formatMoney(customer.creditAvailable)}</b></p>}
              </>
            ) : (
              <>
                <p className="mt-1 font-semibold text-ink">Consumidor final</p>
                <p className="text-xs text-slate-500">{cart.cpfOnInvoice ? `CPF/CNPJ na nota: ${formatDoc(cart.cpfOnInvoice)}` : "CPF não informado · F4 identificar cliente"}</p>
              </>
            )}
          </button>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-3">
            <Field label="Tabela de preço">
              <Select value={cart.priceTableId ?? ""} onChange={(e) => void changeTable(e.target.value)} options={props.priceTables} aria-label="Tabela de preço" />
            </Field>
            <Field label="Vendedor">
              <Select value={cart.sellerId ?? ""} onChange={(e) => update((c) => ({ ...c, sellerId: e.target.value || null }))} options={props.sellers} placeholder="— operador —" aria-label="Vendedor" />
            </Field>
            <label className="col-span-2 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-brand-700" checked={cart.emitFiscal !== false} onChange={(e) => update((c) => ({ ...c, emitFiscal: e.target.checked }))} />
                Emitir NFC-e
              </span>
              <Badge tone={props.fiscal.tone}>{props.fiscal.label}</Badge>
            </label>
            {cart.emitFiscal === false && <p className="col-span-2 text-xs text-amber-800">Sem NFC-e, a venda fica como “Sem documento fiscal”. Emita o documento no módulo Fiscal quando exigido.</p>}
          </div>
          <div className="rounded-lg border border-line bg-white p-4" aria-live="polite">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600"><dt>Itens / quantidade</dt><dd className="tabular">{items.length} / {formatQty(items.reduce((a, l) => a + l.qty, 0))}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Subtotal bruto</dt><dd className="tabular">{formatMoney(totals.subtotal)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Descontos nos itens</dt><dd className="tabular text-red-700">−{formatMoney(totals.itemDiscounts)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Desconto geral {cart.globalDiscountBps ? `(${formatBps(cart.globalDiscountBps)})` : ""}</dt><dd className="tabular text-red-700">−{formatMoney(totals.globalDiscount)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Acréscimos</dt><dd className="tabular text-emerald-700">+{formatMoney(totals.surchargeTotal)}</dd></div>
            </dl>
            <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
              <span className="text-sm font-medium text-slate-500">Total</span>
              <span className="tabular text-4xl font-bold tracking-tight text-brand-800" data-testid="pdv-total">{formatMoney(totals.total)}</span>
            </div>
            {overLimit && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Desconto de {formatBps(discountBps)} acima do seu limite ({formatBps(props.operator.discountLimitBps)}). A conclusão exigirá um usuário com permissão.</p>}
          </div>
          <div className="rounded-lg border border-line bg-white p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Forma de pagamento (escolha na próxima etapa; combine meios se preciso)</p>
            <div className="grid grid-cols-4 gap-1.5">
              {props.quickMethods.map((m) => (
                <button key={m.id} type="button" disabled={!items.length || !props.session} onClick={() => void goPayment(m.id)} className="focus-ring rounded-md border border-line px-1 py-2 text-xs font-medium hover:border-accent-500 hover:bg-accent-50 disabled:opacity-50">
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          <Button size="lg" variant="accent" className="h-14 text-lg" onClick={() => void goPayment()} disabled={!items.length || !props.session}>
            <CreditCard className="size-5" /> Finalizar venda <kbd className="ml-1 rounded border border-white/40 px-1 text-xs">F10</kbd>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setDialog("discount")}><BadgePercent className="size-4" /> Desconto <kbd className="text-xs text-slate-400">F8</kbd></Button>
            <Button onClick={() => setDialog("park")} disabled={!items.length}><Save className="size-4" /> Pré-venda <kbd className="text-xs text-slate-400">F6</kbd></Button>
            <Button onClick={() => setDialog("cancel")} disabled={!items.length} variant="ghost" className="text-red-700 hover:bg-red-50"><Ban className="size-4" /> Cancelar venda</Button>
            <Button onClick={() => (items.length ? setDialog("new") : searchRef.current?.focus())} variant="ghost"><Plus className="size-4" /> Nova venda</Button>
          </div>
        </aside>
      </div>

      <footer className="hidden flex-wrap gap-x-4 gap-y-1 border-t border-line bg-white px-3 py-1.5 text-xs text-slate-500 md:flex" aria-label="Atalhos de teclado">
        {[["F2", "Buscar"], ["F4", "Cliente"], ["F6", "Pré-venda"], ["F8", "Desconto"], ["F10", "Pagamento"], ["↑↓", "Selecionar item"], ["Enter", "Editar item"], ["+ / −", "Quantidade"], ["Del", "Remover item"], ["Esc", "Fechar"]].map(([k, l]) => (
          <span key={k}><kbd className="rounded border border-line bg-slate-50 px-1 font-mono">{k}</kbd> {l}</span>
        ))}
        <span className="ml-auto">Leitor: {props.terminal.scannerMode === "keyboard_wedge" ? "teclado (emulação)" : (props.terminal.scannerMode ?? "—")} · Impressão: {props.terminal.printerMode === "browser" ? "navegador" : (props.terminal.printerMode ?? "—")}</span>
      </footer>

      <CustomerPicker
        open={dialog === "customer"}
        onClose={() => setDialog(null)}
        current={customer}
        cpfOnInvoice={cart.cpfOnInvoice}
        canCreate={props.operator.canCreateCustomer}
        total={totals.total}
        onSelect={(c) => {
          setCustomer(c);
          update((x) => ({ ...x, customerId: c.id, customerName: c.name, cpfOnInvoice: null }));
          setDialog(null);
          toast("success", `Cliente identificado: ${c.name}`);
          if (c.priceTableId && c.priceTableId !== cart.priceTableId) {
            void changeTable(c.priceTableId);
            toast("info", `Tabela de preço do cliente aplicada: ${c.priceTableName ?? "própria"}.`);
          }
        }}
        onConsumer={(cpf) => {
          setCustomer(null);
          update((x) => ({ ...x, customerId: null, customerName: null, cpfOnInvoice: cpf }));
          setDialog(null);
        }}
      />
      {line && dialog === "line" && (
        <LineDialog
          line={line}
          allowNegative={props.allowNegative}
          otherQty={qtyInCart(line.skuId, selected)}
          onClose={() => setDialog(null)}
          onSave={(patch) => {
            if (patch.qty !== undefined) {
              const block = stockBlocks(line, patch.qty, selected);
              if (block && patch.qty > line.qty) return toast("error", block);
            }
            update((c) => ({ ...c, items: (c.items as Line[]).map((l, i) => (i === selected ? { ...l, ...patch } : l)) }));
            setDialog(null);
          }}
          onRemove={() => {
            removeLine(selected);
            setDialog(null);
          }}
        />
      )}
      {dialog === "discount" && (
        <DiscountDialog
          cart={cart}
          totals={totals}
          limitBps={props.operator.discountLimitBps}
          canOverLimit={props.operator.canOverLimit}
          onClose={() => setDialog(null)}
          onSave={(p) => {
            update((c) => ({ ...c, ...p }));
            setDialog(null);
          }}
        />
      )}
      {dialog === "park" && <ParkDialog defaultName={customer?.name ?? ""} pending={pending} onClose={() => setDialog(null)} onConfirm={(name) => run(() => parkCartAction(cart.id, name || null))} />}
      {dialog === "cancel" && <CancelDialog pending={pending} total={totals.total} onClose={() => setDialog(null)} onConfirm={(reason) => run(() => cancelCartAction(cart.id, reason))} />}
      <Dialog open={dialog === "new"} onClose={() => setDialog(null)} title="Iniciar nova venda" size="sm" footer={<Button onClick={() => setDialog(null)}>Voltar ao atendimento</Button>}>
        <p className="text-sm text-slate-600">O atendimento atual tem {items.length} item(ns) — {formatMoney(totals.total)}. O que fazer com ele?</p>
        <div className="mt-4 grid gap-2">
          <Button variant="primary" onClick={() => setDialog("park")}><Save className="size-4" /> Salvar como pré-venda</Button>
          <Button variant="danger" onClick={() => setDialog("cancel")}><Ban className="size-4" /> Cancelar o atendimento</Button>
        </div>
      </Dialog>
      <Drawer open={dialog === "parked"} onClose={() => setDialog(null)} title="Pré-vendas em espera">
        {props.parked.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma pré-venda salva nesta filial.</p>
        ) : (
          <ul className="space-y-2">
            {props.parked.map((p) => (
              <li key={p.id} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{p.name ?? "Pré-venda"} {p.expired && <Badge tone="warn">vencida</Badge>}</p>
                    <p className="text-xs text-slate-500">{p.customerName ?? "Consumidor final"} · {p.itemsCount} item(ns) · {p.operatorName} · {p.terminalName}</p>
                    <p className="text-xs text-slate-500">Salva em {new Date(p.parkedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                  </div>
                  <span className="tabular font-semibold">{formatMoney(p.total)}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" loading={pending} onClick={() => run(() => resumeCartAction(p.id, props.terminal.id))}>Retomar neste terminal</Button>
                  <Button size="sm" variant="ghost" className="text-red-700" disabled={pending} onClick={() => { if (window.confirm("Descartar esta pré-venda? Ela fica registrada como cancelada.")) run(() => cancelCartAction(p.id, "Pré-venda descartada")); }}>Descartar</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-slate-500">Preços e saldos são revalidados na conclusão. Ao retomar, o atendimento atual com itens vai para a espera.</p>
      </Drawer>
    </div>
  );
}

function LineDialog({ line, allowNegative, otherQty, onClose, onSave, onRemove }: { line: Line; allowNegative: boolean; otherQty: number; onClose: () => void; onSave: (p: Partial<Line>) => void; onRemove: () => void }) {
  const table = tablePrice(line);
  const [qtyText, setQtyText] = useState(String(line.qty / QTY).replace(".", ","));
  const [price, setPrice] = useState(line.unitPrice ?? table);
  const [discMode, setDiscMode] = useState<"value" | "pct">("value");
  const [disc, setDisc] = useState(line.itemDiscount ?? 0);
  const [discPct, setDiscPct] = useState("");
  const [sur, setSur] = useState(line.itemSurcharge ?? 0);
  const qty = Math.round(Number(qtyText.replace(/\./g, "").replace(",", ".") || 0) * QTY);
  const gross = Math.round((Math.max(price, table) * qty) / QTY);
  const discount = discMode === "pct" ? pct(gross, Math.round(Number(discPct.replace(",", ".") || 0) * 100)) : disc;
  const stockMsg = !line.service && !allowNegative && line.available != null && qty + otherQty > line.available ? `Disponível na filial: ${formatQty(line.available, line.unitCode)}.` : null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={line.name ?? line.sku ?? "Item"}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-red-700" onClick={onRemove}><Trash2 className="size-4" /> Remover</Button>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={qty <= 0} onClick={() => onSave({ qty, unitPrice: price === table ? null : price, itemDiscount: Math.min(discount, gross), itemSurcharge: sur })}>Aplicar</Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (qty > 0) onSave({ qty, unitPrice: price === table ? null : price, itemDiscount: Math.min(discount, gross), itemSurcharge: sur }); }}>
        <Field label={`Quantidade (${line.unitCode ?? "un"})`} error={stockMsg}>
          <Input value={qtyText} onChange={(e) => setQtyText(e.target.value)} inputMode="decimal" autoFocus className="tabular text-right" />
        </Field>
        <Field label="Preço unitário" hint={`Tabela: ${formatMoney(table)}${line.wholesalePrice && line.wholesaleMinQty ? ` · atacado ${formatMoney(line.wholesalePrice)} a partir de ${formatQty(line.wholesaleMinQty)}` : ""}`}>
          <MoneyInput value={price} onChange={setPrice} ariaLabel="Preço unitário" />
        </Field>
        <Field label="Desconto no item" hint={line.maxDiscountBps ? `Máximo da tabela: ${formatBps(line.maxDiscountBps)}` : undefined}>
          <div className="flex gap-1">
            <select className="focus-ring h-9 rounded-md border border-line bg-white px-2 text-sm" value={discMode} onChange={(e) => setDiscMode(e.target.value as any)} aria-label="Tipo de desconto">
              <option value="value">R$</option>
              <option value="pct">%</option>
            </select>
            {discMode === "value" ? <div className="flex-1"><MoneyInput value={disc} onChange={setDisc} ariaLabel="Desconto em reais" /></div> : <Input value={discPct} onChange={(e) => setDiscPct(e.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Desconto em percentual" className="tabular text-right" />}
          </div>
        </Field>
        <Field label="Acréscimo no item">
          <MoneyInput value={sur} onChange={setSur} ariaLabel="Acréscimo" />
        </Field>
        <p className="sm:col-span-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
          Bruto {formatMoney(gross)} − desconto {formatMoney(Math.min(discount, gross) + (price < table ? Math.round(((table - price) * qty) / QTY) : 0))} + acréscimo {formatMoney(sur)}. Preço abaixo da tabela conta como desconto (limites do perfil e da tabela são validados na conclusão).
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function DiscountDialog({ cart, totals, limitBps, canOverLimit, onClose, onSave }: { cart: PlainCart; totals: ReturnType<typeof cartTotals>; limitBps: number; canOverLimit: boolean; onClose: () => void; onSave: (p: Partial<PlainCart>) => void }) {
  const [mode, setMode] = useState<"value" | "pct">(cart.globalDiscountBps ? "pct" : "value");
  const [value, setValue] = useState(cart.globalDiscount ?? 0);
  const [pctText, setPctText] = useState(cart.globalDiscountBps ? String(cart.globalDiscountBps / 100).replace(".", ",") : "");
  const [sur, setSur] = useState(cart.surcharge ?? 0);
  const bps = Math.round(Number(pctText.replace(",", ".") || 0) * 100);
  const net = totals.subtotal - totals.itemDiscounts;
  const global = mode === "pct" ? pct(net, bps) : Math.min(value, net);
  const totalDisc = totals.itemDiscounts + global;
  const effBps = totals.subtotal ? Math.round((totalDisc * 10000) / totals.subtotal) : 0;
  const save = () => onSave(mode === "pct" ? { globalDiscountBps: bps, globalDiscount: 0, surcharge: sur } : { globalDiscount: value, globalDiscountBps: 0, surcharge: sur });
  return (
    <Dialog open onClose={onClose} title="Desconto geral e acréscimo (F8)" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Aplicar</Button></>}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Desconto geral (rateado entre os itens)">
          <div className="flex gap-1">
            <select className="focus-ring h-9 rounded-md border border-line bg-white px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label="Tipo de desconto">
              <option value="value">R$</option>
              <option value="pct">%</option>
            </select>
            {mode === "value" ? <div className="flex-1"><MoneyInput value={value} onChange={setValue} autoFocus ariaLabel="Desconto em reais" /></div> : <Input value={pctText} onChange={(e) => setPctText(e.target.value)} inputMode="decimal" autoFocus placeholder="0,00" aria-label="Desconto percentual" className="tabular text-right" />}
          </div>
        </Field>
        <Field label="Acréscimo geral (ex.: entrega, embalagem)">
          <MoneyInput value={sur} onChange={setSur} ariaLabel="Acréscimo" />
        </Field>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <p>Desconto total: <b className="tabular">{formatMoney(totalDisc)}</b> ({formatBps(effBps)} do bruto) · Novo total: <b className="tabular">{formatMoney(net - global + totals.surchargeTotal - (cart.surcharge ?? 0) + sur)}</b></p>
          <p className={cn("mt-1 text-xs", !canOverLimit && effBps > limitBps ? "text-amber-800" : "text-slate-500")}>
            Seu limite de desconto: {canOverLimit ? "sem limite (aprovação de desconto)" : formatBps(limitBps)}.{!canOverLimit && effBps > limitBps ? " Acima do limite — a venda será recusada sem um usuário autorizado." : ""}
          </p>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function ParkDialog({ defaultName, pending, onClose, onConfirm }: { defaultName: string; pending: boolean; onClose: () => void; onConfirm: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  return (
    <Dialog open onClose={onClose} title="Salvar pré-venda (F6)" size="sm" footer={<><Button onClick={onClose}>Voltar</Button><Button variant="primary" loading={pending} onClick={() => onConfirm(name)}>Salvar e iniciar nova venda</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(name); }}>
        <Field label="Identificação" hint="Ex.: nome do cliente ou mesa. A pré-venda pode ser retomada em qualquer terminal da filial.">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
        </Field>
      </form>
    </Dialog>
  );
}

function CancelDialog({ pending, total, onClose, onConfirm }: { pending: boolean; total: number; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onClose={onClose} title="Cancelar atendimento" size="sm" footer={<><Button onClick={onClose}>Voltar</Button><Button variant="danger" loading={pending} onClick={() => onConfirm(reason)}>Cancelar atendimento</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(reason); }}>
        <p className="mb-3 text-sm text-slate-600">O atendimento de {formatMoney(total)} será encerrado sem venda (fica registrado como cancelado). Cobranças Pix pendentes deste atendimento são canceladas.</p>
        <Field label="Motivo (opcional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={300} />
        </Field>
      </form>
    </Dialog>
  );
}

