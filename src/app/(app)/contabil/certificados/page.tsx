import Link from "@/components/ui/link";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { requireFirmSession } from "../guard";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty";
import { paginate, parseList, sp, type SearchParams } from "@/lib/list";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { CERT_DUE_SOON_DAYS, CERT_KIND_LABEL, CERT_SOURCE_LABEL, certificateOverview, listCertificateRequests, listKnownCertificates, requestDisplayStatus, type KnownCertificate } from "@/domain/accounting";
import { queryPortfolio } from "../queries";
import { knownByClient, nextActionLabel, sortRequests, STAGE_OPTIONS, stageFilter, validityPhrase } from "./queries";
import { KnownCertificateForm } from "./known-certificate-form";

export const metadata = { title: "Certificados digitais" };

const BASE = "/contabil/certificados";
const TABS = ["acompanhamento", "validades"] as const;
type Tab = (typeof TABS)[number];

const n = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;

interface RequestRow {
  id: string;
  protocol: string;
  kindLabel: string;
  clientId: string;
  clientName: string;
  holderDoc: string | null;
  productLabel: string;
  months: number | null;
  currentValidTo: string | null;
  currentDaysLeft: number | null;
  status: string;
  displayStatus: string;
  paymentLine: string;
  amount: number;
  createdAt: string;
  actionLabel: string;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireFirmSession();
  const params = await searchParams;
  const rawTab = sp(params, "tab");
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "acompanhamento";
  const clientId = sp(params, "cliente").trim();
  const stage = stageFilter(sp(params, "status").trim());
  const showAll = sp(params, "exibir") === "todos";
  const canCert = canDo(s.user, "accounting.certificates");
  const canRegister = canCert && can(s.user, "accounting", "edit");
  const wholePortfolio = s.user.isAdmin || canDo(s.user, "accounting.all_clients");

  const [overview, clients] = await Promise.all([certificateOverview(s.ctx), queryPortfolio(s.ctx, { q: "", f: {} })]);
  const clientOptions = clients.map((c) => ({ value: c.id, label: c.code ? `${c.code} — ${c.name}` : c.name }));
  const tabBase = clientId ? `${BASE}?cliente=${encodeURIComponent(clientId)}` : BASE;
  const filtered = Boolean(clientId || stage);

  return (
    <>
      <PageHeader
        title="Certificados digitais"
        crumbs={[{ label: "Carteira", href: "/contabil" }, { label: "Certificados digitais" }]}
        description={
          <>
            Acompanhe seus clientes, do pagamento à emissão e à entrega.
            {!wholePortfolio && <span className="block text-xs">Você vê apenas os clientes da sua carteira (responsável ou com atribuição ativa).</span>}
          </>
        }
        actions={
          canCert && (
            <LinkButton href={`${BASE}/nova`} variant="primary">
              <Plus className="size-4" aria-hidden /> Nova solicitação
            </LinkButton>
          )
        }
      />

      <section aria-label="Indicadores dos certificados" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Precisam renovar" value={overview.needRenewal.toLocaleString("pt-BR")} hint={`Vencidos ou a vencer em até ${CERT_DUE_SOON_DAYS} dias`} href={`${BASE}?tab=validades`} tone={overview.needRenewal ? "warn" : "good"} />
        <Stat
          label="Aguardando pagamento"
          value={overview.awaitingPayment.toLocaleString("pt-BR")}
          hint={overview.overdueCharges ? `${n(overview.overdueCharges, "cobrança vencida", "cobranças vencidas")} — atualize o vencimento e reenvie` : "Nenhuma cobrança vencida"}
          href={`${BASE}?status=awaiting_payment`}
          tone={overview.overdueCharges ? "bad" : "default"}
        />
        <Stat label="Prontos para baixar" value={overview.readyToDownload.toLocaleString("pt-BR")} hint="Download com confirmação de senha, registrado no protocolo" href={`${BASE}?status=ready_to_download`} tone={overview.readyToDownload ? "good" : "default"} />
        <Stat label="Aguardando autorização" value={overview.awaitingAuthorization.toLocaleString("pt-BR")} hint="Emitidos; o titular ainda não autorizou o download pelo escritório" href={`${BASE}?status=awaiting_authorization`} tone={overview.awaitingAuthorization ? "warn" : "default"} />
      </section>

      <LinkTabs
        basePath={tabBase}
        active={tab}
        tabs={[
          { key: "acompanhamento", label: "Acompanhamento", count: overview.open },
          { key: "validades", label: "Validades e renovações", count: overview.needRenewal },
        ]}
      />

      {tab === "acompanhamento" ? (
        <TrackingTab s={s} params={params} clientId={clientId} stage={stage} clientOptions={clientOptions} filtered={filtered} canCert={canCert} />
      ) : (
        <ValidityTab s={s} params={params} clientId={clientId} showAll={showAll} clientOptions={clientOptions} canCert={canCert} canRegister={canRegister} />
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------- Acompanhamento

async function TrackingTab({
  s, params, clientId, stage, clientOptions, filtered, canCert,
}: {
  s: Awaited<ReturnType<typeof requireFirmSession>>;
  params: SearchParams;
  clientId: string;
  stage: string;
  clientOptions: Array<{ value: string; label: string }>;
  filtered: boolean;
  canCert: boolean;
}) {
  const p = parseList(params);
  const [requests, known] = await Promise.all([listCertificateRequests(s.ctx, { clientId: clientId || null, status: stage || null }), knownByClient(s.ctx, clientId || null)]);
  const rows: RequestRow[] = sortRequests(requests).map((r) => {
    const cur = known.get(r.clientId) ?? null;
    const paid = Boolean(r.paymentConfirmedAt);
    return {
      id: r.id,
      protocol: r.protocol,
      kindLabel: CERT_KIND_LABEL[r.kind] ?? r.kind,
      clientId: r.clientId,
      clientName: r.holderName,
      holderDoc: r.holderDoc ?? null,
      productLabel: r.productLabel,
      months: r.months ?? null,
      currentValidTo: cur?.validTo ?? null,
      currentDaysLeft: cur?.daysLeft ?? null,
      status: r.status,
      displayStatus: requestDisplayStatus(r),
      paymentLine: r.status === "cancelled" ? (paid ? "Pagamento confirmado" : "Sem pagamento") : paid ? "Pagamento confirmado" : "Pagamento pendente",
      amount: r.amount ?? 0,
      createdAt: r.createdAt,
      actionLabel: nextActionLabel(r),
    };
  });
  const { rows: pageRows, total } = paginate(rows, p);

  const columns: Column<RequestRow>[] = [
    {
      key: "protocol", label: "Protocolo", sortable: true, fixed: true,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="font-medium">{r.protocol}</span>
          <span className="block text-xs font-normal text-slate-500">{r.kindLabel}</span>
        </span>
      ),
    },
    {
      key: "clientName", label: "Cliente", sortable: true, className: "min-w-[160px]",
      cell: (r) => (
        <span className="block">
          <span className="font-medium text-ink">{r.clientName}</span>
          <span className="block text-xs text-slate-500">{r.holderDoc ? formatDoc(r.holderDoc) : "Sem CPF/CNPJ informado"}</span>
        </span>
      ),
    },
    {
      key: "productLabel", label: "Produto", sortable: true,
      cell: (r) => (
        <span className="block">
          {r.productLabel}
          {r.months != null && <span className="block text-xs text-slate-500">{n(r.months, "mês", "meses")} de validade</span>}
        </span>
      ),
    },
    {
      key: "currentValidTo", label: "Validade atual", sortable: true,
      cell: (r) => (r.currentValidTo ? <span className="whitespace-nowrap">Validade atual: {formatDate(r.currentValidTo)}</span> : <span className="text-xs text-slate-500">Primeiro certificado nesta carteira</span>),
    },
    {
      key: "displayStatus", label: "Etapa", sortable: true,
      cell: (r) => {
        const warn = r.currentDaysLeft != null && r.currentDaysLeft <= CERT_DUE_SOON_DAYS ? validityPhrase(r.currentDaysLeft) : null;
        return (
          <span className="block">
            <StatusBadge kind="certificate_request" status={r.displayStatus} />
            <span className="mt-1 block text-xs text-slate-500">{r.paymentLine}</span>
            {warn && r.status !== "downloaded" && r.status !== "cancelled" && <span className={`block text-xs ${r.currentDaysLeft! < 0 ? "text-red-700" : "text-amber-700"}`}>Certificado atual: {warn.toLowerCase()}</span>}
          </span>
        );
      },
    },
    {
      key: "amount", label: "Valor", sortable: true, align: "right",
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="tabular">{formatMoney(r.amount)}</span>
          <span className="block text-xs font-normal text-slate-500">Pagamento único</span>
        </span>
      ),
    },
    {
      key: "actions", label: "Próxima ação", fixed: true,
      cell: (r) => (
        <LinkButton href={`${BASE}/${r.id}`} variant={r.displayStatus === "overdue" || r.displayStatus === "ready_to_download" ? "primary" : "secondary"} size="sm" title={`Abrir o protocolo ${r.protocol}`}>
          {r.actionLabel} <ArrowRight className="size-3.5" aria-hidden />
        </LinkButton>
      ),
    },
  ];

  return (
    <>
      <FilterBar
        basePath={BASE}
        values={params}
        filters={[
          { type: "select", name: "cliente", label: "Cliente", options: clientOptions, all: "Todos os clientes" },
          { type: "select", name: "status", label: "Etapa", options: STAGE_OPTIONS, all: "Todas as etapas" },
        ]}
      />
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink">Solicitações da carteira</h2>
        <p className="text-xs text-slate-500">
          {n(rows.length, "solicitação", "solicitações")} · cobrança separada da mensalidade do ERP · as ações acontecem no protocolo
        </p>
      </div>
      <DataTable
        id="accounting-certificate-requests"
        basePath={BASE}
        params={params}
        columns={columns}
        rows={pageRows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(r) => `${BASE}/${r.id}`}
        empty={
          filtered ? (
            <EmptyState
              title="Nenhuma solicitação no recorte"
              description="Ajuste o cliente ou a etapa para ver outras solicitações."
              action={
                <Link href={BASE} className="text-sm text-brand-700 underline">
                  Limpar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="Nenhuma solicitação na carteira"
              description={canCert ? "Abra a primeira em Nova solicitação: o pedido é cadastrado, a cobrança é enviada ao cliente e a equipe de certificação cuida do restante." : "Nenhum certificado foi solicitado para os clientes da sua carteira até agora."}
              action={
                canCert ? (
                  <LinkButton href={`${BASE}/nova`} variant="primary" size="sm">
                    <Plus className="size-4" aria-hidden /> Nova solicitação
                  </LinkButton>
                ) : undefined
              }
            />
          )
        }
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------ Validades

async function ValidityTab({
  s, params, clientId, showAll, clientOptions, canCert, canRegister,
}: {
  s: Awaited<ReturnType<typeof requireFirmSession>>;
  params: SearchParams;
  clientId: string;
  showAll: boolean;
  clientOptions: Array<{ value: string; label: string }>;
  canCert: boolean;
  canRegister: boolean;
}) {
  const p = parseList(params);
  const rows = await listKnownCertificates(s.ctx, { clientId: clientId || null, attention: !showAll });
  const { rows: pageRows, total } = paginate(rows, p);
  const expired = rows.filter((k) => k.validity === "expired").length;
  const dueSoon = rows.filter((k) => k.validity === "due_soon").length;

  const columns: Column<KnownCertificate>[] = [
    {
      key: "clientName", label: "Cliente", sortable: true, fixed: true, className: "min-w-[160px]",
      cell: (k) => (
        <span className="block">
          <span className="font-medium">{k.clientName}</span>
          <span className="block text-xs font-normal text-slate-500">{k.holderDoc ? formatDoc(k.holderDoc) : "Sem CPF/CNPJ informado"}</span>
        </span>
      ),
    },
    {
      key: "productLabel", label: "Produto", sortable: true,
      cell: (k) => (
        <span className="block">
          {k.productLabel}
          {k.source === "erp" && k.branchName && <span className="block text-xs text-slate-500">{k.branchName}</span>}
          {k.serial && <span className="block text-xs text-slate-500">Série {k.serial}</span>}
        </span>
      ),
    },
    { key: "source", label: "Origem", sortable: true, cell: (k) => <span className="text-xs text-slate-500">{CERT_SOURCE_LABEL[k.source] ?? k.source}</span> },
    {
      key: "daysLeft", label: "Validade", sortable: true,
      cell: (k) => {
        const phrase = validityPhrase(k.daysLeft);
        return (
          <span className="block">
            <StatusBadge kind="certificate_validity" status={k.validity} />
            <span className="mt-1 block whitespace-nowrap text-xs text-slate-600">{phrase ?? "Validade não informada"}</span>
            {k.validTo && <span className="block whitespace-nowrap text-xs text-slate-500">Vencimento: {formatDate(k.validTo)}</span>}
          </span>
        );
      },
    },
    {
      key: "situation", label: "Situação", fixed: true,
      cell: (k) =>
        k.openRequest ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="block">
              <span className="block whitespace-nowrap text-xs text-slate-600">Solicitação aberta · {k.openRequest.protocol}</span>
              <StatusBadge kind="certificate_request" status={k.openRequest.status} className="mt-0.5" />
            </span>
            <LinkButton href={`${BASE}/${k.openRequest.id}`} size="sm" title={`Abrir o protocolo ${k.openRequest.protocol}`}>
              Acompanhar <ArrowRight className="size-3.5" aria-hidden />
            </LinkButton>
          </span>
        ) : canCert ? (
          <LinkButton href={`${BASE}/nova?cliente=${encodeURIComponent(k.clientId)}&kind=renewal${k.source !== "erp" ? `&previous=${encodeURIComponent(k.id)}` : ""}`} variant={k.validity === "expired" || k.validity === "due_soon" ? "primary" : "secondary"} size="sm" title="Abre uma nova solicitação de renovação para este cliente">
            <RefreshCw className="size-3.5" aria-hidden /> Renovar
          </LinkButton>
        ) : (
          <span className="text-xs text-slate-400">Somente consulta</span>
        ),
    },
  ];

  return (
    <>
      <FilterBar
        basePath={BASE}
        clearHref={`${BASE}?tab=validades`}
        values={params}
        filters={[
          { type: "select", name: "cliente", label: "Cliente", options: clientOptions, all: "Todos os clientes" },
          { type: "select", name: "exibir", label: "Exibir", options: [{ value: "todos", label: "Todos" }], all: "Vencidos e próximos de vencer" },
        ]}
      >
        <input type="hidden" name="tab" value="validades" />
      </FilterBar>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Validade dos certificados</h2>
          <p className="text-xs text-slate-500">
            Vencimento e renovação por cliente · {showAll ? n(rows.length, "certificado conhecido", "certificados conhecidos") : `${n(expired, "vencido", "vencidos")} · ${n(dueSoon, "a vencer", "a vencer")} em até ${CERT_DUE_SOON_DAYS} dias`}
          </p>
        </div>
        {canRegister && <KnownCertificateForm clients={clientOptions} defaultClientId={clientId || null} dueSoonDays={CERT_DUE_SOON_DAYS} />}
      </div>
      <DataTable
        id="accounting-certificate-validity"
        basePath={BASE}
        params={params}
        columns={columns}
        rows={pageRows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(k) => `/contabil/clientes/${k.clientId}`}
        footer={
          <p className="border-t border-line px-3 py-2 text-xs text-slate-500">
            Uma renovação abre uma nova solicitação. O certificado anterior permanece no histórico com sua validade original.
            {" "}Certificados de emissão fiscal das empresas vinculadas aparecem aqui quando o titular autoriza o acompanhamento no ERP.
          </p>
        }
        empty={
          showAll || clientId ? (
            <EmptyState
              title={showAll ? "Nenhum certificado conhecido" : "Nenhum certificado vencido ou a vencer no recorte"}
              description={
                showAll
                  ? "Os certificados emitidos pelo Intercert entram aqui automaticamente. Certificados emitidos por outra origem podem ser registrados pelo escritório; os de emissão fiscal das empresas vinculadas aparecem quando o titular autoriza o acompanhamento."
                  : "Troque o filtro para ver todos os certificados ou outro cliente."
              }
              action={
                <Link href={`${BASE}?tab=validades${showAll ? "" : "&exibir=todos"}`} className="text-sm text-brand-700 underline">
                  {showAll ? "Ver vencidos e próximos de vencer" : "Ver todos os certificados"}
                </Link>
              }
            />
          ) : (
            <EmptyState
              title={`Nenhum certificado vencido ou a vencer nos próximos ${CERT_DUE_SOON_DAYS} dias`}
              description="Quando um certificado conhecido se aproximar do vencimento, ele aparece aqui com o botão para abrir a renovação."
              action={
                <Link href={`${BASE}?tab=validades&exibir=todos`} className="text-sm text-brand-700 underline">
                  Ver todos os certificados
                </Link>
              }
            />
          )
        }
      />
    </>
  );
}
