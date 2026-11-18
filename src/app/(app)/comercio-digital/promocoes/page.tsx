import Link from "@/components/ui/link";
import { Power, PowerOff, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatBps, formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { abandonedCarts, couponSummary, defaultRecoveryMessage, listCoupons } from "@/domain/ecommerce/promotions";
import { CouponForm, type CouponValue } from "../_components/coupon-form";
import { saveCouponAction, saveRecoveryDraftAction, setCouponActiveAction, testCouponAction } from "../actions";
import { brDate, brDateTime, ecomStorePage } from "../_lib";

export const metadata = { title: "Promoções e carrinhos" };

/** Tela 55 — Promoções e recuperação de carrinhos: cupom da loja e mensagens de retomada em rascunho (sem envio). */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s, st } = await ecomStorePage(["ecommerce.marketing", "ecommerce.manage"]);
  const params = await searchParams;
  const canEdit = canDo(s.user, "ecommerce.marketing");
  const coupons = await listCoupons(s.ctx);
  const editCode = sp(params, "cupom");
  const editing = editCode ? (coupons.find((c) => c.code === editCode) ?? null) : null;
  const carts = canEdit ? await abandonedCarts(s.ctx) : [];
  const draftFor = sp(params, "carrinho");
  const initial: CouponValue = editing
    ? { code: editing.code, description: editing.description ?? "", percent: editing.percentBps ? String(editing.percentBps / 100).replace(".", ",") : "", capAmount: editing.capAmount ?? 0, minOrder: editing.minOrder ?? 0, freeShipping: Boolean(editing.freeShipping), active: Boolean(editing.active), validFrom: editing.validFrom ?? "", validTo: editing.validTo ?? "", usageLimit: editing.usageLimit ? String(editing.usageLimit) : "", perCustomerLimit: editing.perCustomerLimit ? String(editing.perCustomerLimit) : "" }
    : { code: "", description: "", percent: "10", capAmount: 2000, minOrder: 10000, freeShipping: false, active: true, validFrom: "", validTo: "", usageLimit: "", perCustomerLimit: "1" };
  const activeCoupon = coupons.find((c) => c.active) ?? null;

  return (
    <>
      <PageHeader title="Promoções e carrinhos" crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Promoções e carrinhos" }]} description="Defina ofertas da loja e prepare a recuperação de compras interrompidas, respeitando as preferências de contato dos clientes." />
      <div className="space-y-4">
        <Card title={editing ? `Cupom ${editing.code}` : "Cupom da loja"} actions={editing ? <Badge tone={editing.active ? "good" : "neutral"}>{editing.active ? "Ativo" : "Pausado"}</Badge> : <Link href="/comercio-digital/promocoes" className="text-sm text-brand-700 hover:underline">Novo cupom</Link>}>
          <CouponForm key={editing?.id ?? "novo"} initial={initial} action={saveCouponAction} disabled={!canEdit} />
          {editing && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold text-ink">Testar no carrinho</p>
              <ActionForm action={testCouponAction.bind(null, editing.id)} className="flex flex-wrap items-end gap-2">
                <Field label="Valor dos produtos no carrinho"><MoneyInput name="goods" defaultValue={Math.max(editing.minOrder ?? 0, 15000)} ariaLabel="Valor dos produtos" /></Field>
                <button type="submit" className={buttonClass("secondary")}>Testar no carrinho →</button>
              </ActionForm>
              <p className="mt-1 text-xs text-slate-500">O resultado aparece no aviso: desconto calculado ou o motivo de não se aplicar (mínimo, validade, esgotado, pausado).</p>
            </div>
          )}
        </Card>
        <Card title="Cupons cadastrados" bodyClass="p-0">
          {coupons.length ? (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Código</th><th>Oferta</th><th>Vigência</th><th className="text-right">Usos</th><th>Situação</th><th className="text-right"><span className="sr-only">Ações</span></th></tr></thead>
                <tbody>
                  {coupons.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono font-semibold">{c.code}</td>
                      <td className="text-slate-700">{couponSummary(c)}</td>
                      <td className="text-xs text-slate-600">{c.validFrom || c.validTo ? `${brDate(c.validFrom)} a ${brDate(c.validTo)}` : "Sem prazo"}</td>
                      <td className="tabular text-right">{c.usedCount ?? 0}{c.usageLimit ? ` / ${c.usageLimit}` : ""}</td>
                      <td><Badge tone={c.active ? "good" : "neutral"}>{c.active ? "Ativo" : "Pausado"}</Badge></td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Link href={`/comercio-digital/promocoes?cupom=${encodeURIComponent(c.code)}`} className={buttonClass("ghost", "sm")} title="Editar" aria-label={`Editar ${c.code}`}><Pencil className="size-4" aria-hidden /></Link>
                          {canEdit && <ActionButton action={setCouponActiveAction.bind(null, c.id, !c.active)} label="" title={c.active ? "Pausar" : "Ativar"} variant="ghost" size="sm" icon={c.active ? <PowerOff className="size-4" aria-hidden /> : <Power className="size-4" aria-hidden />} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nenhum cupom" description="Crie acima o primeiro cupom (ex.: BEMVINDO10)." />
          )}
        </Card>
        <Card title="Recuperação de carrinhos" actions={<Badge tone="warn">Envio automático não conectado</Badge>} description="Carrinhos parados há mais de 1 hora. Mensagens só para quem autorizou o contato no checkout (LGPD); o texto fica em rascunho — nenhuma mensagem é enviada nesta versão.">
          {carts.length ? (
            <ul className="divide-y divide-slate-100">
              {carts.slice(0, 30).map((c) => (
                <li key={c.cart.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{c.customerName} <span className="text-sm font-normal text-slate-500">· {c.units} item(ns) · {formatMoney(c.subtotal)} · parado há {c.idleMinutes >= 120 ? `${Math.round(c.idleMinutes / 60)} h` : `${c.idleMinutes} min`}</span></p>
                      <p className="text-xs text-slate-500">{c.contact || "Sem contato informado"} · {c.consent ? "autorizou mensagens" : "sem autorização de contato"}{c.cart.recoveryAt ? ` · rascunho salvo em ${brDateTime(c.cart.recoveryAt)}` : ""}</p>
                    </div>
                    {c.consent ? <Link href={`/comercio-digital/promocoes?carrinho=${c.cart.id}#rascunho`} className={buttonClass("secondary", "sm")}>Preparar mensagem</Link> : <Badge>Contato não autorizado</Badge>}
                  </div>
                  {draftFor === c.cart.id && c.consent && (
                    <ActionForm action={saveRecoveryDraftAction.bind(null, c.cart.id)} className="mt-2 space-y-2" redirectTo="/comercio-digital/promocoes">
                      <Field label="Rascunho da mensagem" htmlFor="rascunho"><Textarea id="rascunho" name="message" rows={3} defaultValue={c.cart.recoveryDraft ?? defaultRecoveryMessage(st.name, c.customerName, activeCoupon?.code)} /></Field>
                      <button type="submit" className={buttonClass("primary", "sm")}>Salvar mensagem em rascunho</button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Nenhum carrinho parado no momento.</p>
          )}
          <div className="mt-3"><Notice tone="info">A automação futura precisa validar a preferência de contato e as regras do canal escolhido (e-mail, WhatsApp). Cupons com {activeCoupon ? `${formatBps(activeCoupon.percentBps ?? 0, 0)} (${activeCoupon.code})` : "desconto"} podem ser citados no texto.</Notice></div>
        </Card>
      </div>
    </>
  );
}
