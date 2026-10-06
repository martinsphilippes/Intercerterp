import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/dates";
import { canDo, can } from "@/lib/permissions";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUS, getTicketFor, ticketMessages } from "@/domain/support";
import { setTicketStatusAction } from "../actions";
import { ReplyForm, ManageForm } from "./reply-form";

export const metadata = { title: "Chamado" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("support");
  const { id } = await params;
  const t = await getTicketFor(s.ctx, id);
  if (!t) notFound();
  const agent = canDo(s.user, "support.manage");
  const isRequester = t.userId === s.user.id;
  const messages = await ticketMessages(s.ctx.store, id, agent);
  const users = await listAll(s.ctx.store, "users");
  const agents = users.filter((u) => u.status === "active" && (u.isAdmin || (u.companyIds ?? []).includes(s.ctx.companyId))).map((u) => ({ value: u.id, label: u.name }));
  const ctx = t.context ?? {};
  const isPublic = t.companyId === "public";
  const code = isPublic ? `P-${t.number}` : String(t.number);
  return (
    <>
      <PageHeader
        title={`Chamado nº ${code} — ${t.subject}`}
        crumbs={[{ label: "Ajuda", href: "/ajuda" }, { label: "Chamados", href: "/ajuda/chamados" }, { label: `nº ${code}` }]}
        badges={
          <>
            <StatusBadge kind="ticket" status={t.status} />
            <StatusBadge kind="priority" status={t.priority} />
            {isPublic && <Badge tone="warn">Aberto na tela de login</Badge>}
          </>
        }
        description={`${TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category} · aberto em ${formatDateTime(t.createdAt)} por ${ctx.userName ?? ctx.name ?? "—"}`}
        actions={
          <>
            {(isRequester || agent) && t.status !== "resolved" && t.status !== "closed" && <ActionButton action={setTicketStatusAction.bind(null, id, "resolved")} label="Marcar como resolvido" />}
            {(isRequester || agent) && t.status === "resolved" && <ActionButton action={setTicketStatusAction.bind(null, id, "closed")} label="Encerrar" confirm="Encerrar o chamado? Depois de encerrado, não recebe novas mensagens." />}
            {isRequester && t.status === "resolved" && <ActionButton action={setTicketStatusAction.bind(null, id, "open")} label="Reabrir" askReason="O que ainda não foi resolvido?" />}
            {agent && t.status === "closed" && <ActionButton action={setTicketStatusAction.bind(null, id, "open")} label="Reabrir (suporte)" askReason="Motivo da reabertura:" />}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card title="Conversa" bodyClass="p-0">
            <ol className="divide-y divide-line">
              {messages.map((m) => {
                const fromSupport = m.userId !== t.userId;
                return (
                  <li key={m.id} className={`px-4 py-3 ${m.internal ? "bg-amber-50/70" : fromSupport ? "bg-brand-50/40" : ""}`}>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-ink">{m.userName ?? "—"}</span>
                      {fromSupport && !m.internal && <Badge tone="brand">Suporte</Badge>}
                      {m.internal && <Badge tone="warn">Nota interna</Badge>}
                      <span>{formatDateTime(m.createdAt)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{m.body}</p>
                    {(m.attachments ?? []).length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {m.attachments.map((a: any) => (
                          <li key={a.fileId}>
                            <a href={`/api/files/${a.fileId}`} className="inline-flex items-center gap-1 rounded border border-line bg-white px-2 py-1 text-xs text-brand-700 hover:underline">
                              <Paperclip className="size-3" /> {a.name} ({Math.max(1, Math.round((a.sizeBytes ?? 0) / 1024))} KB)
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
          {t.status === "closed" ? (
            <Notice tone="info">Chamado encerrado. Se o problema voltar, abra um novo chamado.</Notice>
          ) : (isRequester || agent) && can(s.user, "support", "view") ? (
            <Card title={agent && !isRequester ? "Responder" : "Responder ao suporte"}>
              {t.status === "waiting" && isRequester && <div className="mb-3"><Notice tone="warn">O suporte aguarda sua resposta.</Notice></div>}
              {isPublic && agent && <div className="mb-3"><Notice tone="info">Chamado público: a resposta é enviada por e-mail para {ctx.email ?? "—"} se o canal de e-mail estiver configurado; caso contrário fica registrada aqui e deve ser comunicada por outro meio.</Notice></div>}
              <ReplyForm id={id} agent={agent} isRequester={isRequester} statuses={TICKET_STATUS} currentStatus={t.status} />
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card title="Identificação e contexto">
            <DefinitionList
              cols={1}
              items={[
                { label: "Número", value: code },
                { label: "Solicitante", value: ctx.userName ? `${ctx.userName}${ctx.userEmail ? ` <${ctx.userEmail}>` : ""}` : `${ctx.name ?? "—"} <${ctx.email ?? "—"}>` },
                { label: "Perfil do solicitante", value: ctx.roleName },
                { label: "Tela de origem", value: ctx.route ? <Link className="text-brand-700 hover:underline" href={ctx.route}>{ctx.route}</Link> : ctx.origin === "login" ? "Tela de login" : "—" },
                { label: "Filial", value: ctx.branchName ?? "—" },
                { label: "Navegador", value: ctx.userAgent ? <span className="text-xs">{String(ctx.userAgent).slice(0, 160)}</span> : "—" },
                { label: "Resolução da tela", value: ctx.screen },
                { label: "Responsável", value: t.assigneeId ? (users.find((u) => u.id === t.assigneeId)?.name ?? "—") : "Sem responsável" },
                { label: "Última movimentação", value: formatDateTime(t.lastMessageAt) },
                { label: "Resolvido em", value: formatDateTime(t.resolvedAt) },
                { label: "Envio externo (e-mail)", value: t.externalStatus ?? "—" },
              ]}
            />
          </Card>
          {agent && t.status !== "closed" && (
            <Card title="Atendimento">
              <ManageForm id={id} status={t.status} priority={t.priority} assigneeId={t.assigneeId} statuses={TICKET_STATUS} priorities={TICKET_PRIORITIES.map((p) => ({ value: p.value, label: p.label.split(" —")[0] }))} agents={agents} />
            </Card>
          )}
          <Card title="Histórico">
            <Timeline store={s.ctx.store} refs={[`ticket:${id}`]} />
          </Card>
        </div>
      </div>
    </>
  );
}
