import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { formatDateTime } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { CRT_OPTIONS, REGIMES } from "@/domain/companies";
import { queryBranches } from "../queries";
import { setCompanyStatusAction } from "../actions";
import { CompanyUsersForm } from "../forms";
import { companyView } from "../access";
import { unscoped } from "@/lib/db/scoped-store";
import { resolveRoleId } from "@/lib/auth/users";

export const metadata = { title: "Empresa" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { tab = "cadastro" } = await searchParams;
  // empresa ativa ou outra autorizada: contexto da empresa (acesso e perfil daquela empresa)
  const cc = s.companies.some((x) => x.id === id) ? await companyView(s, id) : null;
  if (!cc) notFound();
  const c = await cc.store.getOrThrow("companies", id);
  const branches = await queryBranches(s, id);
  const users = await listAll(cc.store, "users");
  const linked = users.filter((u) => u.isAdmin || (u.companyIds ?? []).includes(id));
  const fiscal = await listAll(cc.store, "fiscal_configs", { filters: [["eq", "companyId", id]] });
  // vinculados sem perfil nesta empresa (ex.: sem perfil equivalente ao vincular): não acessam nenhum módulo nela
  const roles = tab === "usuarios" ? await listAll(unscoped(cc.store), "roles") : [];
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const noRole = (u: Record<string, any>) => tab === "usuarios" && !u.isAdmin && (u.companyIds ?? []).includes(id) && !resolveRoleId(u, id, rolesById, roles);
  const base = `/administracao/empresas/${id}`;
  const a = c.address ?? {};
  // as ações exigem a permissão na empresa em uso (runAction) E no perfil da empresa-alvo (companyAdminCtx)
  const edit = can(s.user, "admin", "edit") && can(cc.user, "admin", "edit");
  const create = can(s.user, "admin", "create") && can(cc.user, "admin", "create");
  const inactive = c.status === "inactive";
  return (
    <>
      <PageHeader
        title={c.tradeName || c.name}
        crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: c.tradeName || c.name }]}
        badges={
          <>
            <StatusBadge kind="generic" status={c.status ?? "active"} />
            {id === s.ctx.companyId && <Badge tone="brand">Em uso</Badge>}
            {c.isDemo && <Badge tone="sim">Demonstração</Badge>}
          </>
        }
        description={[c.name, c.cnpj && formatDoc(c.cnpj)].filter(Boolean).join(" · ")}
        actions={
          <>
            {edit && (
              <LinkButton href={`${base}/editar`} variant="primary">
                <Pencil className="size-4" /> Editar
              </LinkButton>
            )}
            {create && !inactive && (
              <LinkButton href={`${base}/filiais/nova`}>
                <Plus className="size-4" /> Nova filial
              </LinkButton>
            )}
            {edit && (c.status ?? "active") === "active" && id !== s.ctx.companyId && <ActionButton action={setCompanyStatusAction.bind(null, id, "inactive")} label="Inativar" askReason="Motivo da inativação da empresa:" />}
            {edit && c.status === "inactive" && <ActionButton action={setCompanyStatusAction.bind(null, id, "active")} label="Reativar" />}
          </>
        }
      />
      {inactive && (
        <div className="mb-4">
          <Notice tone="warn" title="Empresa inativa">A empresa não pode ser selecionada como unidade de trabalho nem operar (vendas, caixa, estoque, financeiro). Reative-a para voltar a usá-la.</Notice>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Filiais" value={branches.length} hint={`${branches.filter((b) => b.status !== "inactive").length} ativas`} href={`${base}?tab=filiais`} />
        <Stat label="Usuários vinculados" value={linked.filter((u) => !u.isAdmin && u.status !== "inactive").length} hint="+ administradores" href={`${base}?tab=usuarios`} />
        <Stat label="Terminais ativos" value={branches.reduce((x, b) => x + b.terminalsCount, 0)} href="/administracao/terminais" />
        <Stat label="Configuração fiscal" value={fiscal.length ? `${fiscal.length} filial(is)` : "Pendente"} tone={fiscal.length ? "default" : "warn"} href="/fiscal/configuracoes" />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "cadastro", label: "Cadastro" },
          { key: "filiais", label: "Filiais", count: branches.length },
          { key: "usuarios", label: "Usuários", count: linked.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "cadastro" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identificação e contatos">
            <DefinitionList
              items={[
                { label: "Razão social", value: c.name },
                { label: "Nome fantasia", value: c.tradeName },
                { label: "CNPJ", value: c.cnpj ? formatDoc(c.cnpj) : "—" },
                { label: "E-mail", value: c.email },
                { label: "Telefone", value: formatPhone(c.phone) || "—" },
                { label: "Cadastrada em", value: formatDateTime(c.createdAt) },
              ]}
            />
          </Card>
          <Card title="Dados fiscais">
            <DefinitionList
              items={[
                { label: "Regime tributário", value: REGIMES.find((r) => r.value === c.regime)?.label ?? c.regime },
                { label: "CRT", value: CRT_OPTIONS.find((r) => r.value === c.crt)?.label ?? c.crt },
                { label: "Inscrição estadual", value: c.ie },
                { label: "Inscrição municipal", value: c.im },
                { label: "CNAE", value: c.cnae },
                { label: "Município (IBGE)", value: a.cityCode },
              ]}
            />
          </Card>
          <Card title="Endereço" className="lg:col-span-2">
            <p className="text-sm">{a.street ? `${a.street}, ${a.number || "s/n"}${a.complement ? ` — ${a.complement}` : ""} · ${a.district ?? ""} · ${a.cityName ?? ""}/${a.uf ?? ""} · CEP ${a.zip ?? "—"}` : "Endereço não informado."}</p>
            {c.notes && <p className="mt-2 text-sm text-slate-600">{c.notes}</p>}
          </Card>
          {!fiscal.length && (
            <div className="lg:col-span-2">
              <Notice tone="warn" title="Configuração fiscal pendente">Cadastre emissor, séries e certificado em <Link className="underline" href="/fiscal/configuracoes">Configurações fiscais</Link> antes de emitir documentos por esta empresa.</Notice>
            </div>
          )}
        </div>
      )}
      {tab === "filiais" && (
        <Card bodyClass="p-0" actions={create && !inactive && <LinkButton size="sm" href={`${base}/filiais/nova`}><Plus className="size-4" /> Nova filial</LinkButton>} title="Filiais (unidades)">
          {branches.length === 0 ? (
            <EmptyState title="Nenhuma filial" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Código</th><th>Filial</th><th>CNPJ</th><th>Município</th><th>Tabela padrão</th><th>Depósito padrão</th><th className="text-right">Terminais</th><th className="text-right">Caixas abertos</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.id}>
                      <td>{b.code}</td>
                      <td><Link className="font-medium text-brand-700 hover:underline" href={`/administracao/empresas/filiais/${b.id}`}>{b.name}</Link></td>
                      <td>{b.cnpj ? formatDoc(b.cnpj) : "—"}</td>
                      <td>{b.city}</td>
                      <td>{b.priceTableName}</td>
                      <td>{b.warehouseName}</td>
                      <td className="tabular text-right">{b.terminalsCount}</td>
                      <td className="tabular text-right">{b.openSessions}</td>
                      <td><StatusBadge kind="generic" status={b.status ?? "active"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "usuarios" && (
        <Card title="Usuários com acesso a esta empresa" description="Marque para vincular; desmarque para remover o acesso (as filiais desta empresa também são removidas do usuário).">
          <CompanyUsersForm
            companyId={id}
            disabled={!edit || !canDo(cc.user, "admin.users")}
            users={users
              .filter((u) => u.isAdmin || s.user.isAdmin || (u.companyIds ?? []).some((x: string) => s.user.companyIds.includes(x)))
              .sort((x, y) => x.name.localeCompare(y.name, "pt-BR"))
              .map((u) => ({ id: u.id, name: u.name, email: u.email, linked: (u.companyIds ?? []).includes(id), isAdmin: Boolean(u.isAdmin), status: u.status, self: !s.user.isAdmin && u.id === s.user.id, noRole: noRole(u) }))}
          />
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={cc.store} refs={[`company:${id}`]} />
        </Card>
      )}
    </>
  );
}
