import Link from "@/components/ui/link";
import { SlidersHorizontal } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filters";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { qs, sp, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { can, canDo, MODULES, type ModuleKey } from "@/lib/permissions";
import { NOTIFICATION_TYPES, NEXT_ACTION, TYPE_LABEL, getNotificationPrefs, moduleOfLink, noticeCode, noticeLevel, notificationCounts, queryNotifications } from "@/domain/notifications";
import { Inbox, type InboxItem } from "./inbox";
import { DetailActions } from "./detail-actions";
import { PrefsForm } from "./prefs-form";

export const metadata = { title: "Central de notificações" };

const PAGE = 30;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("dashboard");
  const params = await searchParams;
  const tab = sp(params, "tab") || "caixa";
  const view = sp(params, "view") || "inbox";
  const branches = await listAll(s.ctx.store, "branches", { filters: [["eq", "companyId", s.ctx.companyId]] });
  const bname = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.name ?? "—") : "Todas as unidades");
  const f = { type: sp(params, "type"), view, branch: sp(params, "branch"), from: sp(params, "from"), to: sp(params, "to"), q: sp(params, "q"), occ: sp(params, "occ") as any };
  const rows = tab === "caixa" ? await queryNotifications(s.ctx, f) : [];
  const counts = await notificationCounts(s.ctx.store, s.user.id, s.ctx.companyId);
  const page = Math.max(1, Number(sp(params, "page")) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const selectedId = sp(params, "n") || shown[0]?.id || "";
  const sel = selectedId ? (rows.find((r) => r.id === selectedId) ?? (await s.ctx.store.get("notifications", selectedId))) : null;
  const selected = sel && sel.userId === s.user.id ? sel : null;
  const link = (extra: Record<string, string | number | null>) => `/notificacoes${qs(extra, params)}`;
  const items: InboxItem[] = shown.map((n) => ({
    id: n.id,
    title: n.title,
    area: TYPE_LABEL[n.type] ?? n.type,
    branch: bname(n.branchId),
    at: formatDateTime(n.createdAt),
    read: Boolean(n.readAt),
    occ: n.occurrenceStatus,
    level: noticeLevel(n),
    href: link({ n: n.id }),
    selected: n.id === selected?.id,
  }));
  const mod = moduleOfLink(selected?.link);
  const allowed = !mod || can(s.user, mod as ModuleKey);
  const next = selected ? (NEXT_ACTION[selected.type] ?? NEXT_ACTION.info) : null;
  const prefs = tab === "preferencias" ? await getNotificationPrefs(s.ctx.store, s.user.id) : null;
  const inboxAll = tab === "preferencias" ? await queryNotifications(s.ctx, {}) : [];
  return (
    <>
      <PageHeader
        title="Central de notificações"
        crumbs={[{ label: "Notificações" }, { label: tab === "preferencias" ? "Preferências" : "Central" }]}
        description="Avisos e pendências da operação em um só lugar. Ler um aviso não resolve a ocorrência na origem."
        actions={
          tab === "preferencias" ? (
            <LinkButton href="/notificacoes">Voltar à caixa de entrada</LinkButton>
          ) : (
            <LinkButton href="/notificacoes?tab=preferencias">
              <SlidersHorizontal className="size-4" /> Preferências
            </LinkButton>
          )
        }
      />
      {tab === "preferencias" && prefs && (
        <Card title="Preferências por tipo" description="Escolha quais tipos de aviso você quer receber.">
          <PrefsForm types={NOTIFICATION_TYPES.map((t) => ({ ...t, count: inboxAll.filter((n) => n.type === t.key).length }))} muted={prefs.muted} />
        </Card>
      )}
      {tab === "caixa" && (
        <>
          <FilterBar
            basePath="/notificacoes"
            values={params}
            filters={[
              { type: "select", name: "branch", label: "Filial", all: "Todas as filiais", options: branches.map((b) => ({ value: b.id, label: b.name })) },
              { type: "select", name: "type", label: "Área", all: "Todas as áreas", options: NOTIFICATION_TYPES.map((t) => ({ value: t.key, label: t.label })) },
              { type: "select", name: "view", label: "Exibir", all: "Caixa de entrada", options: [{ value: "unread", label: "Não lidas" }, { value: "pending", label: "Pendências abertas" }, { value: "high", label: "Prioridade alta" }, { value: "archived", label: "Arquivadas" }] },
              { type: "select", name: "occ", label: "Situação na origem", options: [{ value: "open", label: "Aberta" }, { value: "resolved", label: "Resolvida" }, { value: "informative", label: "Informativa" }] },
              { type: "date", name: "from", label: "De" },
              { type: "date", name: "to", label: "Até" },
              { type: "search", placeholder: "Título, texto ou responsável" },
            ]}
          />
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <Link href="/notificacoes?view=unread" className="hover:underline"><b className="text-lg">{counts.unread}</b> não lidas</Link>
            <Link href="/notificacoes?view=pending" className="hover:underline"><b className="text-lg">{counts.open}</b> pendências</Link>
            <Link href="/notificacoes?view=high" className="hover:underline"><b className="text-lg text-red-700">{counts.critical}</b> prioridade alta em aberto</Link>
            <span className="text-slate-500"><b className="text-lg text-ink">{counts.readButOpen}</b> lidas, mas ainda abertas na origem</span>
            <span className="ml-auto text-xs text-slate-500">Caixa de entrada completa · recorte abaixo: {rows.length} aviso(s) com os filtros escolhidos</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <section className="overflow-hidden rounded-lg border border-line bg-white">
              <header className="flex items-center justify-between border-b border-line px-3 py-2">
                <h2 className="text-sm font-semibold">{view === "archived" ? "Arquivadas" : "Caixa de entrada"}</h2>
              </header>
              {items.length === 0 ? (
                <EmptyState title="Nenhum aviso no recorte" description="Ajuste os filtros. Avisos novos aparecem aqui conforme ocorrências são detectadas na operação." />
              ) : (
                <Inbox items={items} archivedView={view === "archived"} />
              )}
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-slate-500">
                <span>
                  {rows.length} notificações · horários de Brasília (UTC−3)
                  {canDo(s.user, "data.export") && (
                    <>
                      {" · "}
                      <a className="text-brand-700 hover:underline" href={`/api/export/notifications${qs({ n: null, page: null, tab: null }, params)}`}>Exportar recorte (CSV)</a>
                    </>
                  )}
                </span>
                {pages > 1 && (
                  <span className="flex items-center gap-2">
                    <Link aria-disabled={page <= 1} className={buttonClass("secondary", "sm", page <= 1 ? "pointer-events-none opacity-50" : "")} href={link({ page: page - 1, n: null })}>Anterior</Link>
                    {page}/{pages}
                    <Link aria-disabled={page >= pages} className={buttonClass("secondary", "sm", page >= pages ? "pointer-events-none opacity-50" : "")} href={link({ page: page + 1, n: null })}>Próxima</Link>
                  </span>
                )}
              </footer>
            </section>
            <section className="self-start rounded-lg border border-line bg-white lg:sticky lg:top-20">
              {!selected ? (
                <EmptyState title="Selecione um aviso" description="O detalhe mostra a situação na origem, o responsável e a próxima ação." />
              ) : (
                <div className="space-y-4 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={noticeLevel(selected).tone}>{noticeLevel(selected).label}</Badge>
                    <span className={selected.readAt ? "text-slate-500" : "font-semibold text-brand-700"}>{selected.readAt ? `Lida em ${formatDateTime(selected.readAt)}` : "Não lida"}</span>
                    {selected.archivedAt && <Badge>Arquivada</Badge>}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{selected.title}</h2>
                    <p className="text-xs text-slate-500">{noticeCode(selected.id)} · {formatDateTime(selected.createdAt)}</p>
                  </div>
                  {selected.body && <p className="whitespace-pre-line text-sm text-slate-700">{selected.body}</p>}
                  <DefinitionList
                    items={[
                      { label: "Área", value: TYPE_LABEL[selected.type] ?? selected.type },
                      { label: "Filial", value: bname(selected.branchId) },
                      { label: "Situação na origem", value: <StatusBadge kind="occurrence" status={selected.occurrenceStatus} /> },
                      { label: "Responsável na origem", value: selected.responsibleName ?? "—" },
                      { label: "Módulo de origem", value: mod ? (MODULES.find((m) => m.key === mod)?.label ?? mod) : "—" },
                      { label: "Prioridade", value: { critical: "Crítica", high: "Alta", normal: "Normal", low: "Baixa" }[selected.priority as string] ?? selected.priority },
                    ]}
                  />
                  {next && (
                    <div className="rounded-md bg-slate-50 p-3">
                      <p className="text-sm font-semibold">Próxima ação</p>
                      <p className="mt-1 text-sm text-slate-600">{next.text}</p>
                      <div className="mt-3">
                        {selected.link && allowed ? (
                          <Link href={selected.link} className={buttonClass("accent")}>
                            {next.cta}
                          </Link>
                        ) : selected.link ? (
                          <p className="text-xs text-amber-700">Você não tem acesso ao módulo de origem; peça ao responsável para tratar a ocorrência.</p>
                        ) : (
                          <p className="text-xs text-slate-500">Sem registro de origem vinculado.</p>
                        )}
                      </div>
                    </div>
                  )}
                  <DetailActions id={selected.id} read={Boolean(selected.readAt)} canArchive={selected.occurrenceStatus !== "open"} archived={Boolean(selected.archivedAt)} />
                  <div className="border-t border-line pt-3">
                    <Notice tone={selected.occurrenceStatus === "open" ? "warn" : "info"}>
                      {selected.occurrenceStatus === "open"
                        ? "Ler o aviso não resolve a pendência. O arquivamento fica disponível após a resolução na origem."
                        : selected.occurrenceStatus === "resolved"
                          ? "Ocorrência resolvida na origem: o aviso pode ser arquivado."
                          : "Aviso informativo: pode ser arquivado a qualquer momento."}
                    </Notice>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
