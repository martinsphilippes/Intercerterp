import Link from "@/components/ui/link";
import { Plus, Search } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { inputClass } from "@/components/ui/form";
import { sp, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { HELP_AREAS, articlesForRoute, ensureHelpArticles, searchArticles } from "@/domain/help-content";
import { queryTickets, TICKET_CATEGORIES } from "@/domain/support";

export const metadata = { title: "Ajuda e suporte" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("support");
  const params = await searchParams;
  const tab = sp(params, "tab") || "base";
  const q = sp(params, "q");
  const area = sp(params, "assunto");
  const route = sp(params, "rota");
  await ensureHelpArticles(s.ctx.store);
  const articles = (await listAll(s.ctx.store, "help_articles")).filter((a) => a.published !== false && (!a.companyId || a.companyId === s.ctx.companyId));
  let list = area ? articles.filter((a) => a.area === area) : articles;
  list = q ? searchArticles(list, q) : list.sort((a, b) => HELP_AREAS.findIndex((x) => x.key === a.area) - HELP_AREAS.findIndex((x) => x.key === b.area));
  const contextual = route ? articlesForRoute(articles, route) : [];
  const mine = await queryTickets(s.ctx, { scope: "mine" });
  const areaLabel = (k: string) => HELP_AREAS.find((a) => a.key === k)?.label ?? k;
  const newTicketHref = `/ajuda/chamados/novo${route ? `?origem=${encodeURIComponent(route)}` : ""}`;
  return (
    <>
      <PageHeader
        title="Ajuda e suporte"
        crumbs={[{ label: "Ajuda" }, { label: "Suporte" }]}
        description="Encontre orientações e acompanhe seus chamados."
        actions={can(s.user, "support", "create") && <LinkButton href={newTicketHref} variant="accent"><Plus className="size-4" /> Novo chamado</LinkButton>}
      />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {[
          { key: "base", label: "Base de ajuda", href: `/ajuda${route ? `?rota=${encodeURIComponent(route)}` : ""}` },
          { key: "chamados", label: `Meus chamados (${mine.length})`, href: "/ajuda?tab=chamados" },
        ].map((t) => (
          <Link key={t.key} role="tab" aria-selected={tab === t.key} href={t.href} className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? "border-accent-500 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t.label}
          </Link>
        ))}
        <Link href="/ajuda/chamados" className="ml-auto self-center text-sm text-brand-700 hover:underline">
          {canDo(s.user, "support.manage") ? "Atendimento de chamados" : "Todos os meus chamados"}
        </Link>
      </div>
      {tab === "base" && (
        <>
          <form method="get" action="/ajuda" className="mb-4 rounded-lg border border-brand-100 bg-brand-50/60 p-4">
            <h2 className="mb-3 text-base font-semibold text-ink">O que você precisa fazer?</h2>
            {route && <input type="hidden" name="rota" value={route} />}
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px_auto]">
              <label className="relative block">
                <span className="sr-only">Buscar orientação</span>
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" aria-hidden />
                <input name="q" defaultValue={q} placeholder="Ex.: conferir fechamento de caixa" className={`${inputClass} h-9 pl-8`} />
              </label>
              <label className="block">
                <span className="sr-only">Assunto</span>
                <select name="assunto" defaultValue={area} className={`${inputClass} h-9`}>
                  <option value="">Todos os assuntos</option>
                  {HELP_AREAS.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className={buttonClass("primary")}>Buscar</button>
            </div>
          </form>
          {contextual.length > 0 && (
            <Card className="mb-4" title={`Orientações para a tela ${route}`} description="Artigos ligados à tela de onde você abriu a ajuda.">
              <ul className="grid gap-2 md:grid-cols-2">
                {contextual.slice(0, 4).map((a) => (
                  <li key={a.id}><Link className="text-sm font-medium text-brand-700 hover:underline" href={`/ajuda/artigos/${a.slug}${route ? `?rota=${encodeURIComponent(route)}` : ""}`}>{a.title}</Link></li>
                ))}
              </ul>
            </Card>
          )}
          <p className="mb-2 text-xs text-slate-500">{list.length} orientação(ões) disponível(is){q ? ` para “${q}”` : ""}{area ? ` em ${areaLabel(area)}` : ""}</p>
          {list.length === 0 ? (
            <EmptyState title="Nenhuma orientação encontrada" description="Tente outras palavras ou abra um chamado." action={<LinkButton href={newTicketHref}>Abrir um chamado</LinkButton>} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((a) => (
                <Link key={a.id} href={`/ajuda/artigos/${a.slug}${route ? `?rota=${encodeURIComponent(route)}` : ""}`} className="focus-ring block rounded-lg border border-line bg-white p-4 hover:border-brand-300">
                  <span className="text-xs font-medium text-brand-700">{areaLabel(a.area)}</span>
                  <span className="mt-1 block text-sm font-semibold text-ink">{a.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{a.summary ?? ""}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <span className="text-slate-600">Precisa de ajuda com uma situação específica? O chamado registra a tela, a filial e o navegador para agilizar o atendimento.</span>
            <Link href={newTicketHref} className="font-medium text-brand-700 hover:underline">Abrir um chamado</Link>
          </div>
        </>
      )}
      {tab === "chamados" && (
        <Card bodyClass="p-0" title="Meus chamados" actions={<LinkButton size="sm" href="/ajuda/chamados">Abrir lista completa</LinkButton>}>
          {mine.length === 0 ? (
            <EmptyState title="Você ainda não abriu chamados" action={<LinkButton href={newTicketHref}>Abrir um chamado</LinkButton>} />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Nº</th><th>Assunto</th><th>Categoria</th><th>Última movimentação</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id}>
                    <td><Link className="text-brand-700 hover:underline" href={`/ajuda/chamados/${t.id}`}>{t.number}</Link></td>
                    <td>{t.subject}</td>
                    <td>{TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}</td>
                    <td>{formatDateTime(t.lastMessageAt)}</td>
                    <td><StatusBadge kind="ticket" status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
