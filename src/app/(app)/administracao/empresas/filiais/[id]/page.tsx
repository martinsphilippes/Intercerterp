import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
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
import { can } from "@/lib/permissions";
import { UFS, branchKind, branchSituation, branchSummary } from "@/domain/companies";
import { DEFAULT_TZ } from "@/lib/dates";
import { branchView } from "../../access";
import { setBranchStatusAction } from "../../actions";
import { BranchForm } from "../../forms";

export const metadata = { title: "Filial" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { tab = "dados" } = await searchParams;
  // filial da empresa ativa ou de outra empresa autorizada: lê pelo contexto da empresa da filial
  const view = await branchView(s, id);
  if (!view || !s.companies.some((c) => c.id === view.branch.companyId)) notFound();
  const { ctx: bc, branch: b } = view;
  const company = await bc.store.getOrThrow("companies", b.companyId);
  const sum = await branchSummary(bc.store, b);
  const tables = await listAll(bc.store, "price_tables", { filters: [["eq", "companyId", b.companyId]] });
  const fiscal = await listAll(bc.store, "fiscal_configs", { filters: [["eq", "branchId", id]] });
  const base = `/administracao/empresas/filiais/${id}`;
  // as ações exigem a permissão na empresa em uso (runAction) E no perfil da empresa da filial (branchAdminCtx)
  const edit = can(s.user, "admin", "edit") && can(bc.user, "admin", "edit");
  const a = b.address ?? {};
  const wh = sum.warehouses.find((w) => w.id === b.defaultWarehouseId);
  const kind = branchKind(b);
  const situation = branchSituation(b, new Set(fiscal.map((f) => f.branchId as string)));
  const manager = b.managerUserId ? await bc.store.get("users", b.managerUserId) : null;
  const companyUsers = sum.users.filter((u) => u.status === "active").map((u) => ({ value: u.id, label: u.name }));
  const table = tables.find((t) => t.id === b.defaultPriceTableId);
  return (
    <>
      <PageHeader
        title={b.name}
        crumbs={[{ label: "Administração" }, { label: "Empresas", href: "/administracao/empresas" }, { label: company.tradeName || company.name, href: `/administracao/empresas/${company.id}?tab=filiais` }, { label: b.name }]}
        badges={
          <>
            <StatusBadge kind="branch" status={situation} />
            <Badge>{kind}</Badge>
            {id === s.ctx.branchId && <Badge tone="brand">Unidade em uso nesta sessão</Badge>}
          </>
        }
        description={[`${kind} · unidade ${b.code}`, b.cnpj && `CNPJ ${formatDoc(b.cnpj)}`, company.tradeName || company.name].filter(Boolean).join(" · ")}
        actions={
          <>
            {edit && (
              <LinkButton href={`${base}?tab=editar`} variant="primary">
                <Pencil className="size-4" /> Editar
              </LinkButton>
            )}
            {edit && (b.status ?? "active") === "active" && id !== s.ctx.branchId && <ActionButton action={setBranchStatusAction.bind(null, id, "inactive")} label="Inativar" askReason="Motivo da inativação da filial:" />}
            {edit && b.status === "inactive" && <ActionButton action={setBranchStatusAction.bind(null, id, "active")} label="Reativar" />}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Depósitos" value={sum.warehouses.length} href={`${base}?tab=operacao`} />
        <Stat label="Terminais" value={sum.terminals.length} hint={`${sum.terminals.filter((t) => t.status !== "inactive").length} ativos`} href={`${base}?tab=operacao`} />
        <Stat label="Caixas abertos agora" value={sum.openSessions.length} tone={sum.openSessions.length ? "warn" : "default"} href={`${base}?tab=operacao`} />
        <Stat label="Usuários com acesso" value={sum.users.length} href={`${base}?tab=usuarios`} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "dados", label: "Dados gerais" },
          { key: "operacao", label: "Operação" },
          { key: "fiscal", label: "Fiscal" },
          { key: "usuarios", label: "Usuários", count: sum.users.length },
          { key: "historico", label: "Histórico" },
          ...(edit ? [{ key: "editar", label: "Editar cadastro" }] : []),
        ]}
      />
      {tab === "dados" && (
        <Card title="Dados gerais" actions={edit && <LinkButton size="sm" href={`${base}?tab=editar`}>Editar cadastro</LinkButton>}>
          <DefinitionList
            cols={3}
            items={[
              { label: "Responsável", value: manager ? <Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/${manager.id}`}>{manager.name}</Link> : "Não definido" },
              { label: "E-mail", value: b.email },
              { label: "Telefone", value: formatPhone(b.phone) || "—" },
              { label: "Endereço", value: a.street ? `${a.street}, ${a.number || "s/n"}${a.complement ? ` — ${a.complement}` : ""} · ${a.district ?? ""}` : "—" },
              { label: "Cidade / UF", value: `${a.cityName ?? b.cityName ?? "—"} / ${a.uf ?? b.uf ?? ""}` },
              { label: "Identificação", value: `${kind} · unidade ${b.code}` },
              { label: "CEP", value: a.zip },
              { label: "Situação no ERP", value: <StatusBadge kind="branch" status={situation} /> },
              { label: "Cadastrada em", value: formatDateTime(b.createdAt) },
            ]}
          />
        </Card>
      )}
      {tab === "operacao" && (
        <div className="space-y-4">
          <Card title="Parametrização da unidade" description="Alimenta o PDV, a precificação e os recortes de período desta filial.">
            <DefinitionList
              cols={3}
              items={[
                { label: "Tabela de preço padrão", value: table?.name ?? "Tabela padrão da empresa" },
                { label: "Depósito padrão (vendas)", value: wh?.name ?? "—" },
                { label: "Fuso horário", value: `${DEFAULT_TZ} (único da instalação)` },
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">O fuso horário vale para toda a instalação (recortes de período, rotinas e agenda de backup) e é alterado pelo responsável técnico na variável APP_TIMEZONE do servidor.</p>
            <p className="mt-3 text-xs text-slate-500">Parâmetros comerciais por filial (venda sem saldo, pré-venda, alertas): <Link className="text-brand-700 hover:underline" href={`/administracao/parametros?escopo=${id}`}>Parâmetros da filial</Link>.</p>
          </Card>
          <Card title="Depósitos" bodyClass="p-0">
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Código</th><th>Depósito</th><th>Tipo</th><th>Padrão</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {sum.warehouses.map((w) => (
                  <tr key={w.id}>
                    <td>{w.code}</td>
                    <td>{w.name}</td>
                    <td>{w.kind === "damaged" ? "Avarias" : w.kind === "available" ? "Disponível para venda" : w.kind}</td>
                    <td>{w.id === b.defaultWarehouseId ? <Badge tone="brand">Padrão</Badge> : "—"}</td>
                    <td><StatusBadge kind="generic" status={w.status ?? "active"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card bodyClass="p-0" actions={can(s.user, "admin", "create") && <LinkButton size="sm" href="/administracao/terminais/novo">Novo terminal</LinkButton>} title="Terminais do PDV">
            {sum.terminals.length === 0 ? (
              <EmptyState title="Nenhum terminal nesta filial" />
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Código</th><th>Terminal</th><th>Série NFC-e</th><th>Caixa</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {sum.terminals.map((t) => {
                    const open = sum.openSessions.find((x) => x.terminalId === t.id);
                    return (
                      <tr key={t.id}>
                        <td>{t.code}</td>
                        <td><Link className="text-brand-700 hover:underline" href={`/administracao/terminais/${t.id}`}>{t.name}</Link></td>
                        <td>{t.nfceSeries ?? "—"}</td>
                        <td>{open ? <Link className="text-brand-700 hover:underline" href={`/caixa/${open.id}`}>Aberto desde {formatDateTime(open.openedAt)}</Link> : "Fechado"}</td>
                        <td><StatusBadge kind="generic" status={t.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
      {tab === "fiscal" && (
        <Card title="Dados fiscais da unidade" actions={<LinkButton size="sm" href="/fiscal/configuracoes">Configurações fiscais</LinkButton>}>
          <DefinitionList
            cols={3}
            items={[
              { label: "CNPJ", value: b.cnpj ? formatDoc(b.cnpj) : "—" },
              { label: "Inscrição estadual", value: b.ie },
              { label: "Inscrição municipal", value: b.im },
              { label: "Município (IBGE)", value: b.cityCode },
              { label: "UF", value: b.uf },
              { label: "Regime da empresa", value: company.regime },
              { label: "Emissor", value: fiscal.length ? (fiscal[0].provider === "simulated" ? "Simulação (sem validade fiscal)" : fiscal[0].provider) : "Não configurado" },
              { label: "Ambiente", value: fiscal[0]?.environment ?? "—" },
              { label: "Séries", value: fiscal.length ? `NF-e ${fiscal[0].nfeSeries ?? "—"} · NFC-e ${fiscal[0].nfceSeries ?? "—"} · RPS ${fiscal[0].nfseSeries ?? "—"}` : "—" },
            ]}
          />
          {!fiscal.length && <div className="mt-3"><Notice tone="warn" title="Unidade em implantação">Sem configuração fiscal, a filial não emite NF-e/NFC-e/NFS-e. Configure em Fiscal → Configurações.</Notice></div>}
        </Card>
      )}
      {tab === "editar" && edit && (
        <BranchForm
          branch={b}
          companyId={b.companyId}
          warehouses={sum.warehouses.filter((w) => w.status !== "inactive").map((w) => ({ value: w.id, label: `${w.name} (${w.kind === "damaged" ? "avarias" : "disponível"})` }))}
          priceTables={tables.filter((t) => t.active !== false).map((t) => ({ value: t.id, label: t.name }))}
          timezone={DEFAULT_TZ}
          ufs={UFS}
          users={companyUsers}
        />
      )}
      {tab === "usuarios" && (
        <Card bodyClass="p-0" description="Administradores, usuários sem restrição de filial na empresa e usuários com esta filial marcada.">
          <table className="table-base w-full text-sm">
            <thead>
              <tr><th>Usuário</th><th>E-mail</th><th>Acesso</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {sum.users.map((u) => (
                <tr key={u.id}>
                  <td><Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/${u.id}`}>{u.name}</Link></td>
                  <td>{u.email}</td>
                  <td>{u.isAdmin ? "Administrador" : (u.branchIds ?? []).length ? "Filial marcada" : "Todas as filiais da empresa"}</td>
                  <td><StatusBadge kind="user" status={u.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={bc.store} refs={[`branch:${id}`]} />
        </Card>
      )}
    </>
  );
}
