import "server-only";
import Link from "@/components/ui/link";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BILLING_MODE_LABEL, FIN_KIND_LABEL, WALLET_MOVE_LABEL, describeTerms, type RelationFinance } from "@/domain/network";
import { AdjustForm, AgreementForm, CancelRechargeForm, CloseNowForm, ConfirmRechargeForm, RechargeForm } from "./forms";

const CLOSING_STATUS: Record<string, { label: string; tone: "good" | "warn" | "neutral" }> = { closed: { label: "fechado", tone: "good" }, pending_titles: { label: "título pendente", tone: "warn" }, closing: { label: "em fechamento", tone: "warn" } };
const RECHARGE_STATUS: Record<string, { label: string; tone: "good" | "warn" | "neutral" }> = { pending: { label: "aguardando pagamento", tone: "warn" }, paid: { label: "confirmada", tone: "good" }, cancelled: { label: "cancelada", tone: "neutral" } };

/**
 * Financeiro de uma relação pai→filho (§46): modalidade e vigência, carteira pré-paga com extrato e recargas, prévia
 * do próximo fechamento, fechamentos feitos e as ações de quem pode (pai com network.billing ou plataforma).
 */
export function RelationFinanceView({ f }: { f: RelationFinance }) {
  const t = f.agreement.terms;
  const w = f.wallet;
  const childLabel = f.asChild ? "você" : f.child.name;
  // prévias relevantes: as que têm lançamentos ou que a modalidade vigente usa (custo no pós-pago; comissão no comissionado por período)
  const previews = f.previews.filter((p) => p.entries.length > 0 || (p.direction === "child_pays" ? t.mode === "postpaid" : t.mode === "commission" && t.commissionSettlement === "period"));
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo do financeiro da relação">
        <Stat label="Modalidade" value={BILLING_MODE_LABEL[t.mode] ?? t.mode} hint={f.agreement.source === "default" ? "padrão (sem modalidade definida)" : `desde ${formatDate(f.agreement.validFrom)}`} />
        {w ? <Stat label="Saldo pré-pago" value={formatMoney(w.balance)} hint={`reservado ${formatMoney(w.held)} · disponível ${formatMoney(w.available)}`} tone={Number(w.available) < 0 ? "bad" : Number(w.available) < t.lowBalanceAlert ? "warn" : "default"} /> : <Stat label="Saldo pré-pago" value="—" hint="sem carteira" />}
        {previews.map((p) => (
          <Stat key={p.relationKey} label={p.direction === "child_pays" ? "A fechar (custo)" : "A fechar (comissão)"} value={formatMoney(p.total)} hint={`${p.entries.length} lançamento(s) · próximo fechamento ${formatDate(p.nextClosing)}`} tone={p.total < 0 ? "warn" : "default"} />
        ))}
      </section>

      <Card title={`Modalidade de ${f.child.name} com ${f.parentName}`} description={describeTerms(t, formatMoney)}>
        <DefinitionList cols={2} items={[
          { label: "Vigência", value: f.agreement.source === "default" ? "Padrão do sistema: pós-pago mensal (dia 1), vencimento em 10 dias" : `${formatDate(f.agreement.validFrom)} ${f.agreement.validTo ? `a ${formatDate(f.agreement.validTo)}` : "em diante"}` },
          { label: "Quem cobra o cliente final", value: t.mode === "commission" ? `${f.parentName} (ou o primeiro nível acima não comissionado)` : `${f.child.name}` },
          t.referralKind !== "none" ? { label: "Comissão de indicação", value: t.referralKind === "percent" ? `${(t.referralBps / 100).toLocaleString("pt-BR")}% do preço final` : formatMoney(t.referralCents) } : null,
        ]} />
        {f.canBill && (
          <details className="mt-4 rounded-md border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">Definir nova modalidade</summary>
            <div className="mt-3"><AgreementForm childNodeId={f.child.id} current={t} childName={f.child.name} /></div>
          </details>
        )}
        {f.history.length > 1 && (
          <div className="mt-4 overflow-x-auto">
            <h3 className="mb-1 text-sm font-semibold">Histórico de modalidades</h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Modalidade</th><th className="py-1 text-left font-medium">Vigência</th><th className="py-1 text-left font-medium">Por</th><th className="py-1 text-left font-medium">Situação</th></tr></thead>
              <tbody className="divide-y divide-line">
                {f.history.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5">{describeTerms(a.terms, formatMoney)}</td>
                    <td className="py-1.5 text-xs">{formatDate(a.validFrom)} {a.validTo ? `a ${formatDate(a.validTo)}` : "em diante"}</td>
                    <td className="py-1.5 text-xs">{a.byName ?? "—"}{a.reason ? ` · ${a.reason}` : ""}</td>
                    <td className="py-1.5 text-xs">{a.active === false ? <Badge>substituída</Badge> : a.validTo ? <Badge>encerrada</Badge> : <Badge tone="good">vigente</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(w || t.mode === "prepaid") && (
        <Card title="Carteira de créditos pré-pagos" description={`Cada venda reserva o custo de ${childLabel} na abertura e o debita no pagamento; o cancelamento libera e o estorno devolve.`}>
          {w && Number(w.available) < t.lowBalanceAlert && t.mode === "prepaid" && <div className="mb-3"><Notice tone="warn">Saldo disponível abaixo do aviso ({formatMoney(t.lowBalanceAlert)}).{t.overdraftLimit > 0 ? "" : " Sem saldo, as vendas são bloqueadas."}</Notice></div>}
          <div className="grid gap-4 lg:grid-cols-2">
            {f.canRecharge && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Recarregar créditos</h3>
                <RechargeForm childNodeId={f.child.id} />
              </div>
            )}
            {f.canBill && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Ajuste manual</h3>
                <AdjustForm childNodeId={f.child.id} />
              </div>
            )}
          </div>
          {f.recharges.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">Recargas</h3>
              <ul className="divide-y divide-line text-sm">
                {f.recharges.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono text-xs">{r.code}</span>
                    <span className="tabular font-medium">{formatMoney(r.amount)}</span>
                    <span className="text-xs text-slate-500">vence {formatDate(r.dueDate)} · por {r.byName ?? "—"}</span>
                    <Badge tone={RECHARGE_STATUS[r.status]?.tone ?? "neutral"}>{RECHARGE_STATUS[r.status]?.label ?? r.status}</Badge>
                    {r.confirmRef && <span className="text-xs text-slate-500">ref. {r.confirmRef}</span>}
                    {r.financeNote && <span className="text-xs text-amber-700">{r.financeNote}</span>}
                    {r.status === "pending" && f.canBill && (
                      <span className="flex w-full flex-wrap gap-3"><ConfirmRechargeForm id={r.id} code={r.code} amount={r.amount} /><CancelRechargeForm id={r.id} /></span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <h3 className="mb-1 text-sm font-semibold">Extrato</h3>
            {f.moves.length === 0 ? <p className="text-sm text-slate-500">Sem movimentos.</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Data</th><th className="py-1 text-left font-medium">Movimento</th><th className="py-1 text-left font-medium">Venda / motivo</th><th className="py-1 text-right font-medium">Saldo</th><th className="py-1 text-right font-medium">Reservado</th><th className="py-1 text-right font-medium">Disponível</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {f.moves.map((m) => (
                    <tr key={m.id}>
                      <td className="py-1.5 text-xs">{formatDateTime(m.createdAt)}</td>
                      <td className="py-1.5">{WALLET_MOVE_LABEL[m.kind] ?? m.kind}</td>
                      <td className="py-1.5 text-xs">{m.requestId ? <Link href={`/rede/vendas/${m.requestId}`} className="text-brand-700 hover:underline">{m.protocol ?? "venda"}</Link> : null} {m.reason ?? ""} <span className="text-slate-400">· {m.userName}</span></td>
                      <td className={`tabular py-1.5 text-right ${Number(m.amount) < 0 ? "text-red-700" : ""}`}>{m.amount ? formatMoney(m.amount) : "—"}</td>
                      <td className="tabular py-1.5 text-right">{m.heldDelta ? formatMoney(m.heldDelta) : "—"}</td>
                      <td className={`tabular py-1.5 text-right ${Number(m.availableDelta) < 0 ? "text-red-700" : ""}`}>{m.availableDelta ? formatMoney(m.availableDelta) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {previews.map((p) => (
        <Card key={p.relationKey} title={`Prévia do próximo fechamento — ${p.label}`} description={`Lançamentos acumulados até hoje (vendas pagas; estornos entram como crédito). Próximo fechamento automático: ${formatDate(p.nextClosing)}.`} actions={f.canBill ? <CloseNowForm childNodeId={f.child.id} relationKey={p.relationKey} total={p.total} count={p.entries.length} /> : undefined}>
          {p.entries.length === 0 ? <p className="text-sm text-slate-500">Nada acumulado.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Pagamento</th><th className="py-1 text-left font-medium">Venda</th><th className="py-1 text-left font-medium">Produto</th><th className="py-1 text-left font-medium">Tipo</th><th className="py-1 text-right font-medium">Valor</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {p.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="py-1.5 text-xs">{formatDate(e.date)}</td>
                      <td className="py-1.5"><Link href={`/rede/vendas/${e.requestId}`} className="text-brand-700 hover:underline">{e.protocol}</Link></td>
                      <td className="py-1.5 text-xs">{e.productLabel}</td>
                      <td className="py-1.5 text-xs">{e.event === "reversal" ? <Badge tone="warn">estorno (crédito)</Badge> : FIN_KIND_LABEL[e.kind] ?? e.kind}</td>
                      <td className={`tabular py-1.5 text-right ${Number(e.amount) < 0 ? "text-red-700" : ""}`}>{formatMoney(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={4} className="py-1.5 text-right text-xs font-semibold">Total</td><td className="tabular py-1.5 text-right font-semibold">{formatMoney(p.total)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </Card>
      ))}

      <ClosingsTable rows={f.closings} />
    </div>
  );
}

export function ClosingsTable({ rows, title = "Fechamentos" }: { rows: any[]; title?: string }) {
  return (
    <Card title={title} description="Cada fechamento gera UM título a pagar (de quem deve) e a receber (de quem recebe), com o extrato das vendas incluídas.">
      {rows.length === 0 ? <p className="text-sm text-slate-500">Nenhum fechamento ainda.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1 text-left font-medium">Fechamento</th><th className="py-1 text-left font-medium">Tipo</th><th className="py-1 text-left font-medium">De → para</th><th className="py-1 text-left font-medium">Período</th><th className="py-1 text-right font-medium">Total</th><th className="py-1 text-left font-medium pl-3">Vencimento</th><th className="py-1 text-left font-medium">Situação</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5"><Link href={`/rede/fechamentos/${c.id}`} className="font-mono text-brand-700 hover:underline">{c.code}</Link>{c.manual && <span className="ml-1 text-xs text-slate-400">manual</span>}</td>
                  <td className="py-1.5 text-xs">{FIN_KIND_LABEL[c.kind] ?? c.kind}</td>
                  <td className="py-1.5 text-xs">{c.payerName} → {c.payeeName}</td>
                  <td className="py-1.5 text-xs">{formatDate(c.periodFrom)} a {formatDate(c.periodTo)}</td>
                  <td className="tabular py-1.5 text-right">{formatMoney(c.total)}</td>
                  <td className="py-1.5 pl-3 text-xs">{formatDate(c.dueDate)}</td>
                  <td className="py-1.5 text-xs"><Badge tone={CLOSING_STATUS[c.status]?.tone ?? "neutral"}>{CLOSING_STATUS[c.status]?.label ?? c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
