import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Pencil, ShieldCheck, Trash2, UserX } from "lucide-react";
import { requireFirmSession } from "../../guard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { formatDate, formatDateTime, formatMonth, today } from "@/lib/dates";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { BusinessError } from "@/lib/core/errors";
import { NotFoundError } from "@/lib/db/types";
import { UFS } from "@/domain/companies";
import { CLIENT_STATUS, LINK_CODE_DAYS } from "@/domain/accounting";
import { OBLIGATION_KIND_LABEL } from "@/domain/fiscal/obligations";
import { REGIME_LABEL_MAP } from "../../queries";
import { removePersonAction, removeEstablishmentAction, endAssignmentAction } from "../../actions";
import { clientDetail, CLIENT_TABS, type ClientDetail, type ClientTab } from "./queries";
import { StatusForm } from "./status-form";
import { LinkCard } from "./link-card";
import { PersonForm } from "./person-form";
import { EstablishmentForm } from "./establishment-form";
import { RegimeForm } from "./regime-form";
import { AssignmentForm } from "./assignment-form";

export const metadata = { title: "Cliente contábil" };

const COMM_CHANNEL: Record<string, string> = { email: "E-mail", whatsapp: "WhatsApp", phone: "Telefone" };
const BRANCH_FISCAL: Record<string, [string, "good" | "warn" | "sim" | "neutral"]> = { operational: ["Fiscal operacional", "good"], simulation: ["Fiscal em simulação", "sim"], pending: ["Fiscal pendente", "warn"] };
const SOURCE_LABEL: Record<string, string> = { manual: "Registro manual" };

const n = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
const pct = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
/** Período dos pacotes vem como "início:fim" (datas); competência das obrigações como AAAA-MM ou AAAA. */
const periodLabel = (p: string | null | undefined) => {
  if (!p) return "—";
  const m = /^(\d{4}-\d{2})-\d{2}/.exec(p);
  if (m) return formatMonth(m[1]);
  if (/^\d{4}-\d{2}$/.test(p)) return formatMonth(p);
  return p;
};
const addressLine = (a: Record<string, any> | null | undefined) => {
  if (!a) return null;
  const line1 = [a.street, a.number ? `nº ${a.number}` : null, a.complement].filter(Boolean).join(", ");
  const line2 = [a.district, a.cityName && a.uf ? `${a.cityName}/${a.uf}` : a.cityName || a.uf, a.zip ? `CEP ${String(a.zip).replace(/(\d{5})(\d{3})/, "$1-$2")}` : null].filter(Boolean).join(" · ");
  const out = [line1, line2].filter(Boolean).join(" — ");
  return out || null;
};

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireFirmSession();
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  let tab: ClientTab = CLIENT_TABS.includes(rawTab as ClientTab) ? (rawTab as ClientTab) : "resumo";
  const base = `/contabil/clientes/${id}`;
  let d: ClientDetail;
  try {
    d = await clientDetail(s.ctx, id, tab);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof BusinessError && e.code === "forbidden") {
      return (
        <>
          <PageHeader title="Cliente fora da sua carteira" crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Clientes", href: "/contabil/clientes" }, { label: "Cliente" }]} />
          <Notice tone="warn" title="Este cliente não está na sua carteira">
            Você só acessa os clientes em que é responsável geral, titular ou substituto numa atribuição, ou cujo departamento atribuído você gerencia. Para ver toda a carteira do escritório é preciso a permissão “Ver toda a carteira de clientes”.{" "}
            <Link href="/contabil/clientes" className="underline">
              Voltar à lista de clientes
            </Link>
            .
          </Notice>
        </>
      );
    }
    throw e;
  }
  const c = d.client;
  const isPJ = c.personType === "PJ";
  if (!isPJ && tab === "estabelecimentos") tab = "resumo";
  const canEdit = can(s.user, "accounting", "edit");
  const canLink = canDo(s.user, "accounting.link");
  const canTeam = canDo(s.user, "accounting.manage_team");
  const activeAssignments = d.assignments.filter((a) => a.isActive);
  const t = today();
  // vigência em curso hoje (a que o cadastro reflete), a última registrada (sem fim, referência do domínio) e uma futura, se houver
  const currentRegime = d.regimes.find((r) => r.validFrom <= t && (!r.validTo || r.validTo >= t)) ?? null;
  const openRegime = d.regimes.find((r) => !r.validTo) ?? null;
  const futureRegime = d.regimes.find((r) => r.validFrom > t) ?? null;
  const regimeHint = currentRegime ? `Desde ${formatDate(currentRegime.validFrom)}${futureRegime ? ` · muda para ${futureRegime.regimeLabel} em ${formatDate(futureRegime.validFrom)}` : ""}` : futureRegime ? `Passa a ${futureRegime.regimeLabel} em ${formatDate(futureRegime.validFrom)}` : "Registre a vigência na aba Regime";
  const linked = c.linkStatus === "active";
  const addr = addressLine(c.address);
  const lookupAt = c.rfbCheckedAt ?? c.docLookup?.consultedAt ?? null;

  const tabs: Array<{ key: ClientTab; label: string; count?: number }> = [
    { key: "resumo", label: "Resumo" },
    { key: "pessoas", label: "Pessoas", count: d.people.length },
    ...(isPJ ? [{ key: "estabelecimentos" as const, label: "Estabelecimentos", count: d.establishments.length }] : []),
    { key: "regime", label: "Regime", count: d.regimes.length },
    { key: "responsaveis", label: "Responsáveis", count: activeAssignments.length + (c.responsibleUserId ? 1 : 0) },
    { key: "fiscal", label: "Fiscal (ERP)" },
    { key: "entregas", label: "Entregas", count: d.deliveries.length },
    { key: "historico", label: "Histórico" },
  ];

  return (
    <>
      <PageHeader
        title={`${d.code} · ${d.name}`}
        crumbs={[{ label: "Gestão contábil", href: "/contabil" }, { label: "Clientes", href: "/contabil/clientes" }, { label: d.name }]}
        badges={
          <>
            <StatusBadge kind="accounting_client" status={c.status} />
            <StatusBadge kind="link" status={c.linkStatus ?? "none"} />
            <Badge>{isPJ ? "Pessoa jurídica" : "Pessoa física"}</Badge>
          </>
        }
        description={[c.doc ? `${isPJ ? "CNPJ" : "CPF"} ${formatDoc(c.doc)}` : "Sem documento informado", c.tradeName && c.tradeName !== c.name ? c.tradeName : null, c.cityName ? `${c.cityName}/${c.uf ?? ""}` : null, d.regimeLabel].filter(Boolean).join(" · ")}
        actions={
          canEdit && (
            <>
              <StatusForm clientId={id} status={c.status} statusOptions={CLIENT_STATUS.map((x) => ({ value: x.value, label: x.label }))} linked={linked} />
              <LinkButton href={`${base}/editar`} variant="primary">
                <Pencil className="size-4" aria-hidden /> Editar
              </LinkButton>
            </>
          )
        }
      />

      <section aria-label="Resumo do cliente" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Regime vigente" value={d.regimeLabel ?? "Não informado"} hint={regimeHint} href={`${base}?tab=regime`} tone={d.regimeLabel ? "default" : "warn"} />
        <Stat label="Pessoas" value={d.people.length.toLocaleString("pt-BR")} hint={n(d.activePartnersCount, "sócio ativo", "sócios ativos")} href={`${base}?tab=pessoas`} />
        <Stat label="Responsáveis" value={(activeAssignments.length + (c.responsibleUserId ? 1 : 0)).toLocaleString("pt-BR")} hint={d.responsibleName ? `Geral: ${d.responsibleName}` : "Sem responsável geral"} href={`${base}?tab=responsaveis`} tone={!d.responsibleName && !activeAssignments.length && c.status !== "closed" ? "bad" : "default"} />
        <Stat label="Entregas recebidas" value={d.deliveries.length.toLocaleString("pt-BR")} hint={d.deliveries[0] ? `Última: ${formatMonth(d.deliveries[0].period)}` : linked ? "Nenhum pacote recebido ainda" : "Só chegam com vínculo ativo"} href={`${base}?tab=entregas`} tone={d.deliveries.some((x) => x.status === "received") ? "warn" : "default"} />
      </section>

      <LinkTabs basePath={base} active={tab} tabs={tabs} />

      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Identificação">
              <DefinitionList
                cols={3}
                items={[
                  { label: "Tipo", value: isPJ ? "Pessoa jurídica" : "Pessoa física" },
                  { label: isPJ ? "CNPJ" : "CPF", value: c.doc ? <span className="tabular">{formatDoc(c.doc)}</span> : "—" },
                  { label: "Código na carteira", value: <span className="font-mono">{d.code}</span> },
                  { label: isPJ ? "Razão social" : "Nome completo", value: d.name },
                  isPJ && { label: "Nome fantasia", value: c.tradeName },
                  isPJ && { label: "Natureza jurídica", value: c.legalNature },
                  isPJ && { label: "Porte", value: c.size },
                  isPJ && { label: "Abertura (Receita)", value: c.openedAt ? formatDate(c.openedAt) : "—" },
                  isPJ && {
                    label: "Situação na Receita",
                    value: c.rfbStatus ? (
                      <span>
                        {c.rfbStatus}
                        {c.docLookup && <span className="block text-xs text-slate-500">Fonte: {c.docLookup.source ?? "consulta pública"}{lookupAt ? ` · consulta em ${formatDateTime(lookupAt)}` : ""}</span>}
                      </span>
                    ) : (
                      <span className="text-slate-500">Não consultada{c.docLookup ? "" : " — use “Consultar CNPJ” no cadastro"}</span>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title="Dados fiscais" actions={canEdit && <Link href={`${base}?tab=regime`} className="text-xs text-brand-700 hover:underline">Mudar regime</Link>}>
              <DefinitionList
                cols={3}
                items={[
                  { label: "Regime tributário vigente", value: d.regimeLabel ? <span>{d.regimeLabel}{currentRegime || futureRegime ? <span className="block text-xs text-slate-500">{regimeHint}</span> : null}</span> : <span className="text-amber-700">Não informado</span> },
                  { label: "CRT", value: d.crtLabel },
                  isPJ && { label: "Inscrição estadual", value: c.ie },
                  isPJ && { label: "Inscrição municipal", value: c.im },
                  isPJ && { label: "CNAE principal", value: c.cnae ? <span className="font-mono">{c.cnae}</span> : "—" },
                  isPJ && { label: "CNAEs secundários", value: (c.cnaes ?? []).length ? <span className="font-mono text-xs">{(c.cnaes as string[]).join(", ")}</span> : "—" },
                ]}
              />
            </Card>
            <Card title="Endereço e contato">
              <DefinitionList
                cols={2}
                items={[
                  { label: "Endereço", value: addr },
                  { label: "E-mail", value: c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{c.email}</a> : "—" },
                  { label: "Telefone / WhatsApp", value: formatPhone(c.phone) || "—" },
                  { label: "Canal preferido", value: c.commPrefs?.channel ? (COMM_CHANNEL[c.commPrefs.channel] ?? c.commPrefs.channel) : "—" },
                  { label: "Combinados de comunicação", value: c.commPrefs?.notes },
                ]}
              />
            </Card>
            <Card title="Serviços e atendimento">
              <DefinitionList
                cols={2}
                items={[
                  { label: "Serviços contratados", value: d.servicesLabels.length ? <span className="flex flex-wrap gap-1">{d.servicesLabels.map((l) => <Badge key={l} tone="brand">{l}</Badge>)}</span> : <span className="text-amber-700">Nenhum serviço marcado</span> },
                  { label: "Grupo de clientes", value: d.groupName ? <Link href={`/contabil/clientes?grupo=${c.groupId}`} className="text-brand-700 hover:underline">{d.groupName}</Link> : "—" },
                  { label: "Responsável geral", value: d.responsibleName ?? <span className="text-amber-700">Não definido</span> },
                  { label: "Responsáveis por departamento", value: activeAssignments.length ? <Link href={`${base}?tab=responsaveis`} className="text-brand-700 hover:underline">{n(activeAssignments.length, "atribuição ativa", "atribuições ativas")}</Link> : "Nenhuma" },
                  { label: "Etiquetas", value: (c.tags ?? []).length ? <span className="flex flex-wrap gap-1">{(c.tags as string[]).map((t) => <Badge key={t}>{t}</Badge>)}</span> : "—" },
                ]}
              />
            </Card>
            <Card title="Volume e sistemas">
              <DefinitionList
                cols={4}
                items={[
                  { label: "Funcionários", value: c.employeesCount != null ? Number(c.employeesCount).toLocaleString("pt-BR") : "—" },
                  { label: "Documentos por mês", value: c.monthlyDocs != null ? Number(c.monthlyDocs).toLocaleString("pt-BR") : "—" },
                  { label: "Lançamentos por mês", value: c.monthlyEntries != null ? Number(c.monthlyEntries).toLocaleString("pt-BR") : "—" },
                  { label: "Sistemas usados", value: (c.systems ?? []).length ? (c.systems as Array<{ name: string; kind?: string | null }>).map((x) => `${x.name}${x.kind ? ` (${x.kind})` : ""}`).join(", ") : "—" },
                ]}
              />
            </Card>
            <Card title="Observações">
              {c.notes ? <p className="whitespace-pre-wrap text-sm text-ink">{c.notes}</p> : <p className="text-sm text-slate-500">Sem observações.</p>}
            </Card>
          </div>
          <div className="space-y-4">
            <LinkCard
              clientId={id}
              clientDoc={c.doc ?? null}
              personType={isPJ ? "PJ" : "PF"}
              clientStatus={c.status}
              linkStatus={c.linkStatus ?? "none"}
              linkCodeExpiresAt={c.linkCodeExpiresAt ?? null}
              linkedAt={c.linkedAt ?? null}
              linkedCompany={d.linkedCompany ? { name: d.linkedCompany.name, tradeName: d.linkedCompany.tradeName, cnpj: d.linkedCompany.cnpj } : null}
              canLink={canLink}
              codeDays={LINK_CODE_DAYS}
            />
            <Card title="Datas">
              <DefinitionList
                cols={1}
                items={[
                  { label: "Entrada no escritório", value: formatDate(c.onboardedAt) },
                  { label: "Início dos serviços", value: c.serviceStartAt ? formatDate(c.serviceStartAt) : <span className="text-slate-500">Ainda não iniciado</span> },
                  (c.status === "closed" || c.endedAt) && { label: "Encerramento", value: <span>{formatDate(c.endedAt)}{c.endReason && <span className="block text-xs text-slate-500">Motivo: {c.endReason}</span>}</span> },
                  { label: "Cadastrado em", value: formatDateTime(c.createdAt) },
                  { label: "Última alteração", value: formatDateTime(c.updatedAt) },
                ]}
              />
            </Card>
          </div>
        </div>
      )}

      {tab === "pessoas" && (
        <Card
          title="Sócios, representantes, procuradores e contatos"
          description={d.activePartnersCount ? `Participação dos sócios ativos: ${pct(d.partnerShareBps)} em ${n(d.activePartnersCount, "sócio", "sócios")}.` : "Nenhum sócio ativo cadastrado."}
          actions={
            <>
              {d.activePartnersCount > 0 && (d.partnerShareBps === 10000 ? <Badge tone="good">Quadro societário fecha em 100%</Badge> : <Badge tone="warn">Participações somam {pct(d.partnerShareBps)}</Badge>)}
              {canEdit && <PersonForm clientId={id} personType={isPJ ? "PJ" : "PF"} />}
            </>
          }
          bodyClass="p-0"
        >
          {d.people.length === 0 ? (
            <EmptyState title="Nenhuma pessoa cadastrada" description={isPJ ? "Cadastre os sócios (com participação), o representante legal e os contatos do dia a dia. A consulta do CNPJ no cadastro lista o quadro societário da Receita." : "Cadastre procuradores e contatos ligados a este cliente."} action={canEdit ? <PersonForm clientId={id} personType={isPJ ? "PJ" : "PF"} /> : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Nome</th>
                    <th>CPF/CNPJ</th>
                    <th>Qualificação</th>
                    <th className="text-right">Participação</th>
                    <th>E-mail</th>
                    <th>Telefone</th>
                    <th>Principal</th>
                    <th>Entrada / saída</th>
                    {canEdit && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.people.map((p) => (
                    <tr key={p.id} className={p.active === false ? "text-slate-400" : undefined}>
                      <td><Badge tone={p.kind === "partner" ? "brand" : "neutral"}>{p.kindLabel}</Badge></td>
                      <td>
                        <span className="font-medium text-ink">{p.name}</span>
                        {p.department && <span className="block text-xs text-slate-500">{p.department}</span>}
                        {p.active === false && <Badge tone="neutral" className="mt-0.5">Saiu</Badge>}
                      </td>
                      <td className="tabular whitespace-nowrap">{p.doc ? formatDoc(p.doc) : "—"}</td>
                      <td>{p.qualification ?? "—"}</td>
                      <td className="tabular text-right">{p.sharePct != null ? pct(p.shareBps) : "—"}</td>
                      <td>{p.email ? <a href={`mailto:${p.email}`} className="text-brand-700 hover:underline">{p.email}</a> : "—"}</td>
                      <td className="whitespace-nowrap">{formatPhone(p.phone) || "—"}</td>
                      <td>{p.isPrimary ? <Badge tone="good">Principal</Badge> : "—"}</td>
                      <td className="whitespace-nowrap text-xs">{p.startAt || p.endAt ? `${p.startAt ? formatDate(p.startAt) : "—"} → ${p.endAt ? formatDate(p.endAt) : "atual"}` : "—"}</td>
                      {canEdit && (
                        <td>
                          <span className="flex items-center gap-1">
                            <PersonForm clientId={id} person={p} personType={isPJ ? "PJ" : "PF"} />
                            <ActionButton action={removePersonAction.bind(null, p.id)} label={<Trash2 className="size-4" aria-hidden />} variant="ghost" size="sm" title="Remover pessoa" confirm={`Remover ${p.name} do cadastro do cliente? Para registrar a saída de um sócio sem apagar o histórico, prefira preencher a data de saída.`} />
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "estabelecimentos" && isPJ && (
        <Card
          title="Estabelecimentos"
          description="Matriz e filiais do cliente (CNPJ com a mesma raiz). Uma empresa vinculada ao ERP mostra as filiais dela na aba Fiscal."
          actions={canEdit && <EstablishmentForm clientId={id} ufs={UFS} clientDoc={c.doc ?? null} />}
          bodyClass="p-0"
        >
          {d.establishments.length === 0 ? (
            <EmptyState title="Nenhum estabelecimento cadastrado" description="Cadastre a matriz e as filiais com CNPJ, inscrições e endereço. Não é obrigatório para clientes com um único estabelecimento." action={canEdit ? <EstablishmentForm clientId={id} ufs={UFS} clientDoc={c.doc ?? null} /> : undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Nome</th>
                    <th>CNPJ</th>
                    <th>IE / IM</th>
                    <th>Cidade/UF</th>
                    <th>Situação</th>
                    {canEdit && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.establishments.map((e) => (
                    <tr key={e.id}>
                      <td><Badge tone={e.kind === "matriz" ? "brand" : "neutral"}>{e.kind === "matriz" ? "Matriz" : "Filial"}</Badge></td>
                      <td className="font-medium text-ink">{e.name ?? "—"}</td>
                      <td className="tabular whitespace-nowrap">{e.cnpj ? formatDoc(e.cnpj) : "—"}</td>
                      <td className="text-xs">{[e.ie ? `IE ${e.ie}` : null, e.im ? `IM ${e.im}` : null].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{e.cityName ? `${e.cityName}/${e.uf ?? ""}` : e.uf ?? "—"}</td>
                      <td><StatusBadge kind="generic" status={e.status ?? "active"} /></td>
                      {canEdit && (
                        <td>
                          <span className="flex items-center gap-1">
                            <EstablishmentForm clientId={id} establishment={e} ufs={UFS} clientDoc={c.doc ?? null} />
                            <ActionButton action={removeEstablishmentAction.bind(null, e.id)} label={<Trash2 className="size-4" aria-hidden />} variant="ghost" size="sm" title="Remover estabelecimento" confirm={`Remover o estabelecimento ${e.name ?? formatDoc(e.cnpj) ?? ""}? Para um estabelecimento baixado, prefira marcá-lo como inativo.`} />
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "regime" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Histórico de regime tributário" description="Cada linha é uma vigência. A vigência em curso aparece como “vigente”; o histórico nunca é sobrescrito." bodyClass="p-0" className="lg:col-span-2">
            {d.regimes.length === 0 ? (
              <EmptyState title="Sem histórico de regime" description={d.regimeLabel ? `O cadastro indica ${d.regimeLabel}, mas nenhuma vigência foi registrada.` : "O cliente foi cadastrado sem regime tributário. Registre a primeira vigência ao lado."} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Regime</th>
                      <th>CRT</th>
                      <th>Vigência de</th>
                      <th>Até</th>
                      <th>Motivo</th>
                      <th>Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.regimes.map((r) => {
                      const future = r.validFrom > t;
                      const inForce = !future && (!r.validTo || r.validTo >= t);
                      return (
                      <tr key={r.id} className={inForce || future ? undefined : "text-slate-500"}>
                        <td className="font-medium text-ink">
                          {r.regimeLabel}
                          {future && <Badge tone="info" className="ml-2">Vigência futura</Badge>}
                          {inForce && <Badge tone="good" className="ml-2">Vigente</Badge>}
                        </td>
                        <td>{r.crtLabel ?? "—"}</td>
                        <td className="whitespace-nowrap">{formatDate(r.validFrom)}</td>
                        <td className="whitespace-nowrap">{r.validTo ? formatDate(r.validTo) : "vigente"}</td>
                        <td>{r.reason ?? "—"}</td>
                        <td className="text-xs">{r.source ? (SOURCE_LABEL[r.source] ?? r.source) : "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {canEdit ? (
            <Card title="Registrar nova vigência" description="Mudança de regime com data de início. O cadastro só reflete a mudança quando a data chega.">
              <RegimeForm clientId={id} regimes={d.regimeOptions} crts={d.crtOptions} current={openRegime?.regime ?? c.regime ?? null} currentFrom={openRegime?.validFrom ?? null} />
            </Card>
          ) : (
            <Card title="Registrar nova vigência">
              <p className="text-sm text-slate-500">Mudar o regime exige permissão de edição em Gestão contábil.</p>
            </Card>
          )}
        </div>
      )}

      {tab === "responsaveis" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card
              title="Responsável geral"
              description="Quem responde pelo cliente como um todo; definido no cadastro."
              actions={canEdit && <Link href={`${base}/editar#servicos`} className="text-xs text-brand-700 hover:underline">Editar no cadastro</Link>}
            >
              {d.responsibleName ? (
                <p className="flex items-center gap-2 text-sm text-ink">
                  <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> {d.responsibleName}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-amber-800">
                  <UserX className="size-4" aria-hidden /> Nenhum responsável geral definido{activeAssignments.length ? " (há responsáveis por departamento)" : ""}.
                </p>
              )}
            </Card>
            <Card title="Responsáveis por departamento" description="Titular e substitutos por departamento (ou “Geral”, sem departamento). Quem está aqui enxerga o cliente mesmo sem ver toda a carteira." bodyClass="p-0">
              {d.assignments.length === 0 ? (
                <EmptyState title="Nenhuma atribuição" description={canTeam ? "Defina ao lado quem cuida deste cliente em cada departamento." : "Atribuições são definidas por quem gere a equipe da carteira."} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base w-full text-sm">
                    <thead>
                      <tr>
                        <th>Departamento</th>
                        <th>Responsável</th>
                        <th>Papel</th>
                        <th>Vigência</th>
                        <th>Situação</th>
                        {canTeam && <th>Ação</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {d.assignments.map((a) => (
                        <tr key={a.id} className={a.isActive ? undefined : "text-slate-400"}>
                          <td>{a.departmentLabel}</td>
                          <td className="font-medium text-ink">{a.userName}</td>
                          <td><Badge tone={a.role === "titular" ? "brand" : "neutral"}>{a.role === "titular" ? "Titular" : "Substituto"}</Badge></td>
                          <td className="whitespace-nowrap text-xs">{a.validFrom || a.validTo ? `${a.validFrom ? formatDate(a.validFrom) : "—"} → ${a.validTo ? formatDate(a.validTo) : "sem fim"}` : "Sem prazo"}</td>
                          <td>{a.isActive ? <Badge tone="good">Ativa</Badge> : <Badge tone="neutral">Encerrada</Badge>}</td>
                          {canTeam && <td>{a.isActive && <ActionButton action={endAssignmentAction.bind(null, a.id)} label="Encerrar" variant="outline" size="sm" confirm={`Encerrar a responsabilidade de ${a.userName} (${a.departmentLabel})? A atribuição fica no histórico como encerrada.`} />}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          {canTeam ? (
            <Card title="Definir responsável" description="Por departamento ou geral; um titular por departamento.">
              <AssignmentForm clientId={id} departments={d.refs.departments} users={d.refs.users} />
            </Card>
          ) : (
            <Card title="Definir responsável">
              <p className="text-sm text-slate-500">Definir ou encerrar responsáveis exige a permissão “Gerir departamentos e responsáveis da carteira”.</p>
            </Card>
          )}
        </div>
      )}

      {tab === "fiscal" && (
        <>
          {!linked ? (
            <Notice tone="info" title="Sem vínculo ativo com uma empresa do ERP">
              {isPJ ? (
                <>
                  A situação fiscal só aparece quando o cliente está vinculado à empresa que usa o ERP. Para vincular, emita um código de vínculo no cartão “Vínculo com o ERP” da{" "}
                  <Link href={`${base}?tab=resumo`} className="underline">
                    aba Resumo
                  </Link>{" "}
                  e peça ao administrador da empresa que o informe no ERP (Administração → Integrações → Área da contabilidade). Com o vínculo ativo, o escritório lê documentos, obrigações e certificados da empresa e recebe o pacote mensal de XMLs automaticamente.
                </>
              ) : (
                <>Somente pessoa jurídica pode ser vinculada a uma empresa do ERP; para pessoa física não há situação fiscal a consultar.</>
              )}
            </Notice>
          ) : d.snapshotError ? (
            <Notice tone="bad" title="Não foi possível ler a situação fiscal da empresa vinculada">{d.snapshotError}</Notice>
          ) : d.snapshot ? (
            <FiscalTab d={d} snapshot={d.snapshot} base={base} />
          ) : null}
        </>
      )}

      {tab === "entregas" && (
        <Card
          title="Entregas recebidas"
          description="Pacotes mensais (XMLs e relatórios) que a empresa vinculada gerou no ERP e chegaram sozinhos à caixa de entrada do escritório."
          actions={<Link href={`/contabil/entregas?cliente=${id}`} className="text-xs text-brand-700 hover:underline">Abrir na caixa de entrada</Link>}
          bodyClass="p-0"
        >
          {d.deliveries.length === 0 ? (
            <EmptyState title="Nenhuma entrega recebida" description={linked ? "Quando a empresa gerar o pacote mensal no ERP (Fiscal → Relatórios → Pacote contábil), ele aparece aqui sem que ninguém precise anexar nada." : "As entregas só chegam de empresas vinculadas ao ERP. Vincule o cliente pela aba Resumo."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Arquivo</th>
                    <th>Conteúdo</th>
                    <th>Recebida em</th>
                    <th>Situação</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {d.deliveries.map((x) => {
                    const pl = x.payload ?? {};
                    return (
                      <tr key={x.id}>
                        <td className="whitespace-nowrap">
                          {formatMonth(x.period)}
                          {x.periodFrom && x.periodTo && <span className="block text-xs text-slate-500">{formatDate(x.periodFrom)} a {formatDate(x.periodTo)}</span>}
                        </td>
                        <td>
                          <a href={`/api/files/${x.fileId}`} className="inline-flex max-w-[260px] items-center gap-1 text-brand-700 hover:underline" title={`Baixar ${x.fileName}`}>
                            <Download className="size-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{x.fileName}</span>
                          </a>
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="tabular">{Number(pl.xmlCount ?? 0).toLocaleString("pt-BR")} XML · {n(Number(pl.docs ?? 0), "documento", "documentos")}</span>
                          {Number(pl.missingXml ?? 0) > 0 && <Badge tone="warn" className="ml-1.5">{n(Number(pl.missingXml), "XML ausente", "XMLs ausentes")}</Badge>}
                          {Number(pl.simulatedXml ?? 0) > 0 && <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-fuchsia-700"><SimBadge /> {Number(pl.simulatedXml).toLocaleString("pt-BR")}</span>}
                        </td>
                        <td className="whitespace-nowrap">{formatDateTime(x.receivedAt)}</td>
                        <td>
                          <StatusBadge kind="delivery" status={x.status} />
                          {x.notes && <span className="block max-w-[220px] truncate text-xs italic text-slate-600" title={x.notes}>“{x.notes}”</span>}
                        </td>
                        <td>
                          <Link href={`/contabil/entregas?cliente=${id}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                            Conferir <ExternalLink className="size-3" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "historico" && (
        <Card title="Linha do tempo" description="Tudo o que aconteceu com este cliente: cadastro, situação, regime, pessoas, responsáveis, vínculo e entregas.">
          <Timeline store={s.ctx.store} refs={[`accounting_client:${id}`]} />
        </Card>
      )}
    </>
  );
}

/** Aba Fiscal: leitura da empresa vinculada (snapshot somente leitura). */
function FiscalTab({ d, snapshot, base }: { d: ClientDetail; snapshot: NonNullable<ClientDetail["snapshot"]>; base: string }) {
  const sn = snapshot;
  const late = sn.obligations.filter((o) => o.status === "late").length;
  const dueSoon = sn.obligations.filter((o) => o.status === "due_soon").length;
  const worstCert = sn.certificates.length ? Math.min(...sn.certificates.map((x) => x.daysLeft ?? 9999)) : null;
  const pendingDocs = sn.months.reduce((a, m) => a + m.pending + m.rejected, 0);
  const simulated = sn.months.some((m) => m.simulated > 0);
  return (
    <div className="space-y-4">
      <Notice tone="info">
        Leitura da situação fiscal de <b>{sn.company.tradeName || sn.company.name}</b> diretamente do ERP, somente consulta: nada aqui altera dados da empresa. Pacotes gerados pela empresa só podem ser baixados quando constam como entrega na{" "}
        <Link href={`${base}?tab=entregas`} className="underline">
          aba Entregas
        </Link>
        .
      </Notice>
      <section aria-label="Indicadores fiscais da empresa vinculada" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Obrigações atrasadas" value={late.toLocaleString("pt-BR")} tone={late ? "bad" : "good"} hint={dueSoon ? n(dueSoon, "obrigação vence em breve", "obrigações vencem em breve") : "Nenhuma a vencer nos próximos dias"} />
        <Stat label="Documentos pendentes ou rejeitados" value={pendingDocs.toLocaleString("pt-BR")} tone={pendingDocs ? "warn" : "good"} hint={`Últimos ${sn.months.length} meses`} />
        <Stat label="Documentos parados na fila" value={sn.stuckDocs.toLocaleString("pt-BR")} tone={sn.stuckDocs ? "bad" : "good"} hint="Na fila de envio há mais de 30 minutos" />
        <Stat label="Certificado digital" value={worstCert == null ? "Não informado" : worstCert < 0 ? "Vencido" : n(worstCert, "dia", "dias")} tone={worstCert == null ? "default" : worstCert <= 0 ? "bad" : worstCert <= 30 ? "warn" : "good"} hint={worstCert == null ? "Empresa sem certificado configurado" : "Menor prazo entre empresa e filiais"} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Empresa vinculada">
          <DefinitionList
            cols={1}
            items={[
              { label: "Razão social", value: sn.company.name },
              { label: "Nome fantasia", value: sn.company.tradeName },
              { label: "CNPJ", value: sn.company.cnpj ? <span className="tabular">{formatDoc(sn.company.cnpj)}</span> : "—" },
              { label: "Regime no ERP", value: sn.company.regime ? (REGIME_LABEL_MAP[sn.company.regime] ?? sn.company.regime) : "—" },
              d.regimeLabel && sn.company.regime && sn.company.regime !== d.client.regime ? { label: "Atenção", value: <span className="text-amber-700">O regime no ERP difere do regime vigente no cadastro contábil ({d.regimeLabel}). Confira com a empresa.</span> } : null,
              {
                label: "Filiais",
                value: sn.branches.length ? (
                  <ul className="space-y-1">
                    {sn.branches.map((b) => {
                      const f = b.fiscalStatus ? BRANCH_FISCAL[b.fiscalStatus] : null;
                      return (
                        <li key={b.id} className="flex flex-wrap items-center gap-2">
                          <span>{b.name}</span>
                          {f ? <Badge tone={f[1]}>{f[0]}</Badge> : b.fiscalStatus ? <Badge>{b.fiscalStatus}</Badge> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </Card>
        <Card title={`Documentos fiscais por mês`} description={simulated ? "Há documentos de simulação (sem validade fiscal) no período." : `Últimos ${sn.months.length} meses, por situação.`} bodyClass="p-0" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="text-right">Autorizados</th>
                  <th className="text-right">Cancelados</th>
                  <th className="text-right">Rejeitados</th>
                  <th className="text-right">Pendentes</th>
                  <th className="text-right">Simulação</th>
                </tr>
              </thead>
              <tbody>
                {sn.months.map((m) => (
                  <tr key={m.period}>
                    <td className="font-medium text-ink">{formatMonth(m.period)}</td>
                    <td className="tabular text-right">{m.authorized.toLocaleString("pt-BR")}</td>
                    <td className="tabular text-right">{m.cancelled.toLocaleString("pt-BR")}</td>
                    <td className={`tabular text-right ${m.rejected ? "text-red-700" : ""}`}>{m.rejected.toLocaleString("pt-BR")}</td>
                    <td className={`tabular text-right ${m.pending ? "text-amber-700" : ""}`}>{m.pending.toLocaleString("pt-BR")}</td>
                    <td className="text-right">{m.simulated > 0 ? <span className="inline-flex items-center gap-1"><span className="tabular">{m.simulated.toLocaleString("pt-BR")}</span><SimBadge /></span> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Obrigações fiscais" description="Prazos da empresa no ERP; a situação considera o atraso em relação a hoje." bodyClass="p-0">
          {sn.obligations.length === 0 ? (
            <EmptyState title="Nenhuma obrigação no período" description="A empresa não tem obrigações registradas no ERP para os últimos meses." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Obrigação</th>
                    <th>Competência</th>
                    <th>Prazo</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {sn.obligations.map((o) => {
                    // a leitura devolve a chave técnica quando a obrigação não tem título: mostra o nome conhecido do tipo
                    const label = OBLIGATION_KIND_LABEL[o.kind] ?? o.title;
                    const detail = o.title && o.title !== o.kind && o.title !== label ? o.title : null;
                    return (
                    <tr key={o.id}>
                      <td className="font-medium text-ink">
                        {label}
                        {detail && <span className="block text-xs font-normal text-slate-500">{detail}</span>}
                      </td>
                      <td className="whitespace-nowrap">{periodLabel(o.period)}</td>
                      <td className="whitespace-nowrap">{formatDate(o.dueDate)}</td>
                      <td><StatusBadge kind="obligation" status={o.status} /></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Certificados digitais" description="Validade do certificado A1 da empresa e das filiais com configuração própria.">
            {sn.certificates.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum certificado configurado no ERP da empresa.</p>
            ) : (
              <ul className="divide-y divide-line">
                {sn.certificates.map((x, i) => {
                  const days = x.daysLeft;
                  const tone = days == null ? "neutral" : days < 0 ? "bad" : days <= 30 ? "warn" : "good";
                  return (
                    <li key={`${x.branchId ?? "company"}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="font-medium text-ink">{x.branchName}</span>
                      <span className="flex items-center gap-2">
                        <span className={days != null && days <= 30 ? "text-red-700" : "text-slate-600"}>Válido até {formatDate(x.validTo)}</span>
                        {days != null && <Badge tone={tone}>{days < 0 ? `Vencido há ${n(-days, "dia", "dias")}` : days === 0 ? "Vence hoje" : `${n(days, "dia", "dias")}`}</Badge>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Pacotes gerados pela empresa" description="Pacotes mensais gerados no ERP. O download só é liberado para os que foram entregues ao escritório." bodyClass="p-0">
            {sn.packages.length === 0 ? (
              <EmptyState title="Nenhum pacote gerado" description="A empresa ainda não gerou o pacote contábil no ERP." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Arquivo</th>
                      <th>Gerado em</th>
                      <th>Entrega</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sn.packages.map((pk) => {
                      const delivered = d.deliveredFileIds.has(pk.fileId);
                      return (
                        <tr key={pk.fileId}>
                          <td className="whitespace-nowrap">{periodLabel(pk.period)}</td>
                          <td>
                            {delivered ? (
                              <a href={`/api/files/${pk.fileId}`} className="inline-flex max-w-[220px] items-center gap-1 text-brand-700 hover:underline" title={`Baixar ${pk.name}`}>
                                <Download className="size-3.5 shrink-0" aria-hidden />
                                <span className="truncate">{pk.name}</span>
                              </a>
                            ) : (
                              <span className="block max-w-[220px] truncate text-slate-600" title={pk.name}>{pk.name}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap" title={formatDateTime(pk.createdAt)}>{formatDate(pk.createdAt)}</td>
                          <td>{delivered ? <Badge tone="good" title="Consta como entrega na caixa de entrada do escritório; download liberado">Entregue</Badge> : <Badge tone="neutral" title="Gerado pela empresa, não entregue: o pacote é anterior ao vínculo ou a entrega não ocorreu; a empresa pode gerá-lo novamente">Não entregue</Badge>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
