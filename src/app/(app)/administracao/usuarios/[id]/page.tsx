import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { History, Pencil } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { Notice, EmptyState } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { inviteState, manageableCompanyIds } from "@/domain/users";
import { userRoleIn } from "@/lib/auth/users";
import { unscoped } from "@/lib/db/scoped-store";
import { MatrixView } from "../perfis/matrix-view";
import { setUserStatusAction, cancelInviteAction } from "../actions";
import { ResendInviteButton } from "../invite-link";
import { SetPasswordButton } from "../password-dialog";

export const metadata = { title: "Usuário" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const u = await s.ctx.store.get("users", id);
  if (!u || !(u.isAdmin || (u.companyIds ?? []).includes(s.ctx.companyId))) notFound();
  // perfil do usuário NESTA empresa (perfil por empresa)
  const role = u.isAdmin ? null : await userRoleIn(s.ctx.store, u, s.ctx.companyId);
  // nomes de empresas/filiais vinculadas (somente leitura, inclusive de outras empresas)
  const [companies, branches] = await Promise.all([listAll(unscoped(s.ctx.store), "companies"), listAll(unscoped(s.ctx.store), "branches")]);
  // quem não é administrador não gerencia o acesso de um administrador
  const manage = can(s.user, "admin", "edit") && canDo(s.user, "admin.users") && (!u.isAdmin || s.user.isAdmin);
  // senha, situação e convite valem em todas as empresas do usuário: exigem administrar usuários em todas elas
  const userCompanies: string[] = u.companyIds ?? [];
  const managed = manage && !s.user.isAdmin ? await manageableCompanyIds(s.ctx, userCompanies) : null;
  const manageAll = manage && (!managed || userCompanies.every((c) => managed.has(c)));
  const self = u.id === s.user.id;
  const inv = inviteState(u);
  const statusKey = inv === "expired" ? "invite_expired" : u.status;
  const base = `/administracao/usuarios/${id}`;
  const activities = tab === "atividades" ? await listAll(s.ctx.store, "audit_logs", { filters: [["eq", "userId", id], ["eq", "companyId", s.ctx.companyId]], orderBy: [{ field: "occurredAt", dir: "desc" }] }, 50) : [];
  const companyNames = u.isAdmin ? "Todas (administrador)" : (u.companyIds ?? []).map((c: string) => companies.find((x) => x.id === c)?.tradeName ?? companies.find((x) => x.id === c)?.name ?? c).join(", ");
  const branchNames = u.isAdmin || !(u.branchIds ?? []).length ? "Todas as filiais das empresas vinculadas" : (u.branchIds ?? []).map((b: string) => branches.find((x) => x.id === b)?.name ?? b).join(", ");
  const discount = u.discountLimitBps ?? (u.isAdmin ? 10000 : (role?.discountLimitBps ?? 0));
  return (
    <>
      <PageHeader
        title={u.name}
        crumbs={[{ label: "Administração" }, { label: "Usuários", href: "/administracao/usuarios" }, { label: u.name }]}
        badges={
          <>
            <StatusBadge kind="user" status={statusKey} />
            {u.isAdmin && <Badge tone="brand">Administrador</Badge>}
            {self && <Badge>Você</Badge>}
          </>
        }
        description={[u.email, u.login && `login ${u.login}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <LinkButton href={`/administracao/historico?user=${id}`}>
              <History className="size-4" /> Atividades
            </LinkButton>
            {manage && (
              <LinkButton href={`${base}/editar`} variant="primary">
                <Pencil className="size-4" /> Editar
              </LinkButton>
            )}
            {manageAll && !self && u.status === "active" && <SetPasswordButton id={id} name={u.name} />}
            {manageAll && !self && u.status === "active" && (
              <>
                <ActionButton action={setUserStatusAction.bind(null, id, "suspended")} label="Suspender" variant="danger" askReason="Motivo da suspensão (mostrado ao usuário ao tentar entrar):" />
                <ActionButton action={setUserStatusAction.bind(null, id, "inactive")} label="Inativar" confirm="Inativar o usuário? Ele não poderá mais entrar; o histórico é preservado." />
              </>
            )}
            {manageAll && !self && (u.status === "suspended" || u.status === "inactive") && u.authId && <ActionButton action={setUserStatusAction.bind(null, id, "active")} label="Reativar acesso" variant="primary" />}
            {manageAll && !self && u.status === "invited" && <ActionButton action={cancelInviteAction.bind(null, id)} label="Cancelar convite" confirm="Cancelar o convite? O link deixará de funcionar." />}
          </>
        }
      />
      {manage && !manageAll && !self && (
        <div className="mb-4">
          <Notice tone="info" title="Gestão parcial deste usuário">
            {u.name} também acessa empresa(s) em que você não administra usuários. Senha, situação do acesso, convite, e-mail/login e limite de desconto valem em todas elas e só podem ser alterados por um administrador ou por quem administra usuários em todas as empresas dele.
          </Notice>
        </div>
      )}
      {u.status === "suspended" && (
        <div className="mb-4">
          <Notice tone="bad" title={`Acesso suspenso${u.suspendedAt ? ` em ${formatDateTime(u.suspendedAt)}` : ""}`}>
            Motivo: {u.suspendedReason ?? "—"}. O login está bloqueado{u.authId ? " (também no serviço de autenticação)" : ""} e as sessões foram encerradas.
          </Notice>
        </div>
      )}
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Cadastro e acesso" },
          { key: "permissoes", label: "Permissões efetivas" },
          { key: "atividades", label: "Atividades recentes" },
          { key: "historico", label: "Histórico do cadastro" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identificação">
            <DefinitionList
              items={[
                { label: "Nome", value: u.name },
                { label: "E-mail", value: u.email },
                { label: "Login", value: u.login },
                { label: "Telefone", value: formatPhone(u.phone) || "—" },
                { label: "Cadastrado em", value: formatDateTime(u.createdAt) },
                { label: "Credencial de acesso", value: u.authId ? "Definida" : "Ainda não definida (aguardando primeiro acesso)" },
              ]}
            />
          </Card>
          <Card title="Acesso">
            <DefinitionList
              items={[
                { label: "Perfil nesta empresa", value: u.isAdmin ? "Administrador (acesso total)" : role ? <Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/perfis/${role.id}`}>{role.name}</Link> : "Sem perfil nesta empresa" },
                { label: "Limite de desconto", value: `${(discount / 100).toLocaleString("pt-BR")}% (${u.discountLimitBps != null ? "próprio do usuário" : "do perfil"})` },
                { label: "Empresas", value: companyNames },
                { label: "Filiais", value: branchNames },
                { label: "Primeiro acesso", value: u.firstAccessAt ? formatDateTime(u.firstAccessAt) : "Ainda não acessou" },
                { label: "Último acesso", value: u.lastAccessAt ? formatDateTime(u.lastAccessAt) : "Nunca" },
              ]}
            />
          </Card>
          {(u.status === "invited" || u.inviteSentAt) && (
            <Card title="Convite de primeiro acesso" className="lg:col-span-2">
              <DefinitionList
                cols={4}
                items={[
                  { label: "Situação", value: u.status === "invited" ? <StatusBadge kind="user" status={statusKey} /> : u.firstAccessAt ? "Aceito" : "Encerrado" },
                  { label: "Último envio", value: formatDateTime(u.inviteSentAt) },
                  { label: "Resultado do envio", value: u.inviteDelivery ?? "—" },
                  { label: "Expira em", value: u.status === "invited" ? formatDateTime(u.inviteExpiresAt) : "—" },
                ]}
              />
              {manageAll && (u.status === "invited" || (!u.authId && u.status === "inactive")) && (
                <div className="mt-4 flex flex-wrap items-start gap-2">
                  <ResendInviteButton id={id} label={u.status === "invited" ? "Reenviar convite (novo link)" : "Enviar novo convite"} />
                </div>
              )}
              {u.status === "invited" && <p className="mt-3 text-xs text-slate-500">Por segurança, o link só é exibido no momento da criação ou do reenvio. Reenviar invalida o link anterior.</p>}
            </Card>
          )}
        </div>
      )}
      {tab === "permissoes" && (
        <Card title={u.isAdmin ? "Administrador" : `Perfil: ${role?.name ?? "—"}`} actions={role && <LinkButton size="sm" href={`/administracao/usuarios/perfis/${role.id}`}>Abrir perfil</LinkButton>}>
          <MatrixView permissions={role?.permissions ?? {}} actions={role?.actions ?? []} isAdmin={u.isAdmin} />
        </Card>
      )}
      {tab === "atividades" && (
        <Card bodyClass="p-0" title="Últimas 50 ações deste usuário na empresa" actions={<LinkButton size="sm" href={`/administracao/historico?user=${id}`}>Ver no histórico completo</LinkButton>}>
          {activities.length === 0 ? (
            <EmptyState title="Nenhuma atividade registrada" />
          ) : (
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Data/hora</th><th>Módulo</th><th>Ação</th><th>Resumo</th><th>Resultado</th></tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap"><Link className="text-brand-700 hover:underline" href={`/administracao/historico/${a.id}`}>{formatDateTime(a.occurredAt)}</Link></td>
                    <td>{a.module}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td>{a.summary}</td>
                    <td><StatusBadge kind="audit" status={a.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo do cadastro">
          <Timeline store={s.ctx.store} refs={[`user:${id}`]} />
        </Card>
      )}
    </>
  );
}
