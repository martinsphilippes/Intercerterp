import Link from "@/components/ui/link";
import { RefreshCcw, X } from "lucide-react";
import { unscoped } from "@/lib/db/scoped-store";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { AREA_LABEL, eventCode, type CommerceArea, type CommerceEventStatus } from "@/domain/ecommerce/common";
import { EVENT_STATUS_LABEL, monitorCounts, monitorEvents, subjectHref } from "@/domain/ecommerce/monitor";
import { dismissEventAction, reprocessEventAction } from "../actions";
import { brDateTime, ecomStorePage } from "../_lib";

export const metadata = { title: "Monitor de integrações" };

const TONE: Record<CommerceEventStatus, "good" | "bad" | "neutral" | "warn"> = { ok: "good", failed: "bad", ignored: "neutral", pending: "warn" };
const TABS: Array<{ key: "all" | CommerceEventStatus; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "failed", label: "Falhas" },
  { key: "ok", label: "Concluídos" },
  { key: "ignored", label: "Ignorados" },
  { key: "pending", label: "Pendentes" },
];

/** Tela 60 — Monitoramento das integrações: falhas, tentativas e reprocessamento sem duplicar operações. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { s } = await ecomStorePage(["ecommerce.manage", "ecommerce.orders", "ecommerce.finance"]);
  const params = await searchParams;
  const status = (TABS.some((t) => t.key === sp(params, "estado")) ? sp(params, "estado") : "all") as "all" | CommerceEventStatus;
  const manage = canDo(s.user, "ecommerce.manage");
  const [rows, counts] = await Promise.all([monitorEvents(s.ctx, { status }), monitorCounts(s.ctx)]);
  const detailId = sp(params, "evento");
  const detail = detailId ? await unscoped(s.ctx.store).get("commerce_events", detailId) : null;
  const ev = detail && detail.companyId === s.ctx.companyId ? detail : null;
  const countOf = (k: string) => (k === "all" ? counts.all : (counts as any)[k] ?? 0);

  return (
    <>
      <PageHeader title="Monitoramento das integrações" crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Monitor de integrações" }]} description="Veja falhas, reprocessamentos e eventos que atravessam catálogo, pedidos, pagamento, fiscal, estoque, conciliação, entrega e domínio — sem duplicar operações." />
      <nav aria-label="Filtrar eventos" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "all" ? "/comercio-digital/monitor" : `/comercio-digital/monitor?estado=${t.key}`} aria-current={t.key === status ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${t.key === status ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-ink hover:bg-slate-50"}`}>
            {t.label} <span className="ml-1 text-xs text-slate-500">{countOf(t.key)}</span>
          </Link>
        ))}
      </nav>
      <Notice tone="info">Cada evento externo tem uma chave única: repetir o aviso só aumenta as tentativas — reserva, baixa, cobrança e etiqueta nunca são duplicadas. Corrija o cadastro de origem e reprocesse a validação.</Notice>
      <div className={`mt-4 grid gap-4 ${ev ? "xl:grid-cols-5" : ""} [&>*]:min-w-0`}>
        <Card bodyClass="p-0" className={ev ? "xl:col-span-3" : ""}>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Evento</th><th>Tipo / referência</th><th>Estado</th><th className="text-right">Tentativas</th><th>Última</th><th className="text-right"><span className="sr-only">Detalhes</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.id === ev?.id ? "bg-brand-50/60" : undefined}>
                      <td className="font-mono text-xs">{eventCode(r.number)}</td>
                      <td><span className="block font-medium text-ink">{AREA_LABEL[r.area as CommerceArea] ?? r.area}</span><span className="block text-xs text-slate-500">{r.reference ?? r.action}</span></td>
                      <td><Badge tone={TONE[r.status as CommerceEventStatus] ?? "neutral"}>{r.status === "failed" && r.area === "catalog" ? "Falha de validação" : EVENT_STATUS_LABEL[r.status as CommerceEventStatus] ?? r.status}</Badge></td>
                      <td className="tabular text-right">{r.attempts ?? 1}</td>
                      <td className="text-xs text-slate-500">{brDateTime(r.lastAttemptAt ?? r.createdAt)}</td>
                      <td className="text-right"><Link href={`/comercio-digital/monitor?${status === "all" ? "" : `estado=${status}&`}evento=${r.id}`} className={buttonClass("secondary", "sm")} scroll={false}>Detalhes</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nenhum evento" description="Validações do catálogo, pagamentos, notas, estoque, entregas, créditos e domínios aparecem aqui." />
          )}
        </Card>
        {ev && (
          <Card title={`Diagnóstico · ${eventCode(ev.number)}`} className="xl:col-span-2" actions={<Link href={`/comercio-digital/monitor${status === "all" ? "" : `?estado=${status}`}`} className={buttonClass("ghost", "sm")} aria-label="Fechar"><X className="size-4" aria-hidden /></Link>}>
            <DefinitionList
              cols={1}
              items={[
                { label: "Área", value: AREA_LABEL[ev.area as CommerceArea] ?? ev.area },
                { label: "Ação", value: <span className="font-mono text-xs">{ev.action}</span> },
                { label: "Referência", value: ev.reference ?? "—" },
                { label: "Estado", value: <Badge tone={TONE[ev.status as CommerceEventStatus] ?? "neutral"}>{EVENT_STATUS_LABEL[ev.status as CommerceEventStatus] ?? ev.status}</Badge> },
                { label: "Tentativas", value: ev.attempts ?? 1 },
                { label: "Diagnóstico", value: ev.diagnostic ?? "—" },
                ev.externalKey && { label: "Chave do evento", value: <span className="break-all font-mono text-xs">{ev.externalKey}</span> },
                { label: "Registrado", value: brDateTime(ev.createdAt) },
                ev.resolvedAt && { label: "Resolvido", value: brDateTime(ev.resolvedAt) },
              ]}
            />
            {ev.payload && <pre className="mt-3 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(ev.payload, null, 2)}</pre>}
            <div className="mt-3 flex flex-wrap gap-2">
              {subjectHref(ev) && <Link href={subjectHref(ev)!} className={buttonClass("secondary", "sm")}>Corrigir a origem</Link>}
              {manage && ev.status !== "ok" && <ActionButton action={reprocessEventAction.bind(null, ev.id)} label="Reprocessar" size="sm" variant="primary" icon={<RefreshCcw className="size-4" aria-hidden />} />}
              {manage && ev.status === "failed" && <ActionButton action={dismissEventAction.bind(null, ev.id)} label="Ignorar" size="sm" variant="ghost" askReason="Por que este evento pode ser ignorado?" />}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
